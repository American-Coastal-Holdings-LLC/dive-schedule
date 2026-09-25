import { Prisma } from '@prisma/client';
import { operation, audit } from '../db/operations';
import { Inject, Injectable } from '@nestjs/common';
import { InstallationSettings } from '@prisma/client';
import { notFound, unprocessable } from '../common/api-error';
import { Identity, hasPerm } from '../auth/identity';
import { P } from '../auth/permissions';
import { PrismaService } from '../db/prisma.service';
import { PLATFORM_DIRECTORY, PlatformDirectory } from '../platform/directory';
import { PLATFORM_TENANT, PlatformTenantProvider } from '../platform/tenant';
import {
  addDaysCivil,
  addMonthsCivil,
  parseCivil,
  startOfMonthCivil,
  startOfWeekCivil,
  startOfYearCivil,
  todayCivil,
} from '../domain/dates';
import { totalsSince } from '../domain/finance-calc';
import { num, serializeItem, serializeJob, serializeLedger, serializeRecord } from '../domain/serialize';
import { CreateLedgerDto, PosSaleDto, SettingsDto } from './finance.dto';

function monthLabel(civil: string): string {
  const d = parseCivil(civil);
  if (!d) return civil;
  return new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(d);
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PLATFORM_DIRECTORY) private readonly directory: PlatformDirectory,
    @Inject(PLATFORM_TENANT) private readonly tenant: PlatformTenantProvider,
  ) {}

  private serializeSettings(s: InstallationSettings | null) {
    return {
      payRate: s ? num(s.payRate) : 0.5,
      reportCcEmail: s?.reportCcEmail ?? '',
      estimateRatePerFoot: s ? num(s.estimateRatePerFoot) : 0,
    };
  }

  async summary(identity: Identity) {
    const { timezone: tz } = await this.tenant.getProfile(identity.installationId);
    const today = todayCivil(tz);
    const [ledger, records, jobs] = await Promise.all([
      this.prisma.ledgerEntry.findMany({ where: { installationId: identity.installationId } }),
      this.prisma.serviceRecord.findMany({ where: { installationId: identity.installationId } }),
      this.prisma.job.findMany({
        where: { installationId: identity.installationId, status: 'completed' },
      }),
    ]);
    const ctx = { ledger, records, jobs, tz };

    const week = totalsSince(startOfWeekCivil(today), today, ctx);
    const month = totalsSince(startOfMonthCivil(today), today, ctx);
    const year = totalsSince(startOfYearCivil(today), today, ctx);

    const trend: { month: string; label: string; in: number; out: number; net: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const monthStart = addMonthsCivil(startOfMonthCivil(today), -i);
      const monthEndIncl = addDaysCivil(addMonthsCivil(monthStart, 1), -1);
      const now = monthEndIncl < today ? monthEndIncl : today;
      const t = totalsSince(monthStart, now, ctx);
      trend.push({ month: monthStart.slice(0, 7), label: monthLabel(monthStart), in: t.in, out: t.out, net: t.net });
    }

    return { week, month, year, trend };
  }

  async ledgerList(identity: Identity) {
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { installationId: identity.installationId },
      orderBy: [{ date: 'desc' }],
    });
    return { entries: entries.map(serializeLedger) };
  }

  async ledgerCreate(identity: Identity, dto: CreateLedgerDto) {
    const { timezone: tz } = await this.tenant.getProfile(identity.installationId);
    const entry = await this.prisma.ledgerEntry.create({
      data: {
        installationId: identity.installationId,
        kind: dto.kind,
        amount: dto.amount,
        description: dto.description ?? '',
        category: dto.category ?? '',
        date: dto.date || todayCivil(tz),
      },
    });
    return { entry: serializeLedger(entry) };
  }

  async ledgerRemove(identity: Identity, id: string) {
    const existing = await this.prisma.ledgerEntry.findFirst({
      where: { id, installationId: identity.installationId },
    });
    if (!existing) throw notFound('Ledger entry not found');
    if (['Stripe payment','Stripe refund','Venmo','POS · Cash'].includes(existing.category)) throw unprocessable('Payment and sale entries cannot be deleted; record a documented refund or correction');
    await this.prisma.$transaction(async tx=>{
      await audit(tx,identity,'ledger.deleted',existing.id,JSON.parse(JSON.stringify(existing)));
      await tx.ledgerEntry.delete({where:{id:existing.id}});
    });
    return { ok: true };
  }

  // POS sale (cash only): one ledger "in" entry + stock decrements, single transaction.
  async posSale(identity: Identity, dto: PosSaleDto) {
    const { timezone: tz } = await this.tenant.getProfile(identity.installationId);
    return operation(this.prisma, identity, dto.requestId, {action:'sale', dto}, async tx => {
      let total = new Prisma.Decimal(0);
      const sold: {itemId?:string; name:string; amount:number; qty:number}[] = [];
      for (const line of dto.lines) {
        const qty = line.qty ?? 1;
        if (!Number.isInteger(qty) || qty < 1) throw unprocessable('Quantity must be a positive whole number');
        let price = new Prisma.Decimal(line.amount);
        let name = line.name || 'Custom item';
        if (line.itemId) {
          const item = await tx.inventoryItem.findFirst({where:{id:line.itemId,installationId:identity.installationId}});
          if (!item) throw unprocessable('An item no longer exists; refresh the sale');
          if (item.quantity < qty) throw unprocessable(`Only ${item.quantity} of ${item.name} in stock`);
          price = new Prisma.Decimal(item.salePrice); name = item.name;
          const changed = await tx.inventoryItem.updateMany({where:{id:item.id,installationId:identity.installationId,quantity:{gte:qty}},data:{quantity:{decrement:qty}}});
          if (!changed.count) throw unprocessable('Stock changed; refresh the sale');
        }
        if (!price.isFinite() || price.lte(0)) throw unprocessable('Each item must have a positive price');
        price = price.toDecimalPlaces(2);
        total = total.add(price.mul(qty));
        sold.push({itemId:line.itemId,name,amount:price.toNumber(),qty});
      }
      if (!sold.length || !Number.isFinite(dto.received) || new Prisma.Decimal(dto.received).lt(total)) throw unprocessable('Cash received must cover the total');
      const entry = await tx.ledgerEntry.create({data:{installationId:identity.installationId,kind:'in',amount:total,description:sold.map(l=>`${l.qty}× ${l.name}`).join(', '),category:'POS · Cash',date:todayCivil(tz)}});
      await audit(tx,identity,'pos.sale',entry.id,JSON.parse(JSON.stringify({lines:sold,received:dto.received,total:total.toNumber()})));
      return {entry:serializeLedger(entry),total:total.toNumber(),received:dto.received,change:new Prisma.Decimal(dto.received).sub(total).toDecimalPlaces(2).toNumber()};
    });
  }

  async settingsGet(identity: Identity) {
    const settings = await this.prisma.installationSettings.findUnique({
      where: { installationId: identity.installationId },
    });
    return { settings: this.serializeSettings(settings) };
  }

  async settingsPut(identity: Identity, dto: SettingsDto) {
    // Ensure the Installation row exists (settings FK references it).
    await this.prisma.installation.upsert({
      where: { id: identity.installationId },
      create: { id: identity.installationId, tenantId: identity.tenantId },
      update: {},
    });
    const update: Record<string, unknown> = {};
    if (dto.payRate !== undefined) update.payRate = dto.payRate;
    if (dto.reportCcEmail !== undefined) update.reportCcEmail = dto.reportCcEmail;
    if (dto.estimateRatePerFoot !== undefined) update.estimateRatePerFoot = dto.estimateRatePerFoot;
    const settings = await this.prisma.installationSettings.upsert({
      where: { installationId: identity.installationId },
      create: {
        installationId: identity.installationId,
        payRate: dto.payRate ?? 0.5,
        reportCcEmail: dto.reportCcEmail ?? '',
        estimateRatePerFoot: dto.estimateRatePerFoot ?? 0,
      },
      update,
    });
    return { settings: this.serializeSettings(settings) };
  }

  // Full per-installation JSON export. Price fields honor view-pricing like every
  // other response.
  async backup(identity: Identity) {
    const canPrice = hasPerm(identity, P.JOBS_VIEW_PRICING);
    const [jobs, records, checklist, inventory, ledger, crewProfiles, settings, users, profile] =
      await Promise.all([
        this.prisma.job.findMany({ where: { installationId: identity.installationId } }),
        this.prisma.serviceRecord.findMany({ where: { installationId: identity.installationId } }),
        this.prisma.checklistQuestion.findMany({
          where: { installationId: identity.installationId },
          orderBy: { ord: 'asc' },
        }),
        this.prisma.inventoryItem.findMany({ where: { installationId: identity.installationId } }),
        this.prisma.ledgerEntry.findMany({ where: { installationId: identity.installationId } }),
        this.prisma.crewProfile.findMany({ where: { installationId: identity.installationId } }),
        this.prisma.installationSettings.findUnique({
          where: { installationId: identity.installationId },
        }),
        this.directory.listUsers(identity.installationId),
        this.tenant.getProfile(identity.installationId),
      ]);
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    const tz = profile.timezone;

    return {
      installationId: identity.installationId,
      tenantId: identity.tenantId,
      exportedAt: new Date().toISOString(),
      operation: { name: profile.operationName, contactEmail: profile.contactEmail, timezone: tz },
      settings: this.serializeSettings(settings),
      audit: canPrice ? await this.prisma.auditEvent.findMany({where:{installationId:identity.installationId}}) : [],
      payments: canPrice ? (await this.prisma.clientPayment.findMany({where:{installationId:identity.installationId}})).map(({publicToken,checkoutUrl,...p})=>p) : [],
      earningSnapshots: canPrice ? records.map(r=>({id:r.id,payAmount:r.payAmount,payRateSnapshot:r.payRateSnapshot,paySource:r.paySource,archived:r.archived})) : [],
      jobs: jobs.map((j) => serializeJob(j, { nameById, canPrice, tz })),
      records: records.map((r) => serializeRecord(r, { canPrice })),
      checklist: checklist.map((q) => ({ id: q.id, text: q.text, ord: q.ord })),
      inventory: inventory.map(serializeItem),
      ledger: ledger.map(serializeLedger),
      crew: crewProfiles.map((p) => ({
        userId: p.userId,
        name: nameById.get(p.userId) ?? p.name,
        email: p.email, local: p.local, active: p.active,
        certifications: p.certifications,
        bio: p.bio,
        photo: p.photo,
        joined: p.joined,
      })),
    };
  }
}
