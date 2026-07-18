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
    await this.prisma.ledgerEntry.delete({ where: { id: existing.id } });
    return { ok: true };
  }

  // POS sale (cash only): one ledger "in" entry + stock decrements, single transaction.
  async posSale(identity: Identity, dto: PosSaleDto) {
    if (dto.method !== 'cash') throw unprocessable('Only cash sales are supported');
    const lines = dto.lines || [];
    if (!lines.length) throw unprocessable('At least one line item is required');

    const { timezone: tz } = await this.tenant.getProfile(identity.installationId);
    let total = 0;
    const descParts: string[] = [];
    for (const ln of lines) {
      const amount = num(ln.amount);
      const qty = Math.max(1, Math.floor(num(ln.qty) || 1));
      total += amount * qty;
      descParts.push(`${qty}× ${ln.name || 'Item'}`);
    }

    const entry = await this.prisma.$transaction(async (tx) => {
      const created = await tx.ledgerEntry.create({
        data: {
          installationId: identity.installationId,
          kind: 'in',
          amount: total,
          description: descParts.join(', ') || 'POS sale',
          category: 'POS · Cash',
          date: todayCivil(tz),
        },
      });
      for (const ln of lines) {
        if (!ln.itemId) continue;
        const item = await tx.inventoryItem.findFirst({
          where: { id: ln.itemId, installationId: identity.installationId },
        });
        if (!item) continue;
        const qty = Math.max(1, Math.floor(num(ln.qty) || 1));
        await tx.inventoryItem.update({
          where: { id: item.id },
          data: { quantity: Math.max(0, item.quantity - qty) },
        });
      }
      return created;
    });

    const received = dto.received != null ? num(dto.received) : null;
    const change = received != null ? Math.max(0, received - total) : null;
    return { entry: serializeLedger(entry), total, received, change };
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
      jobs: jobs.map((j) => serializeJob(j, { nameById, canPrice, tz })),
      records: records.map((r) => serializeRecord(r, { canPrice })),
      checklist: checklist.map((q) => ({ id: q.id, text: q.text, ord: q.ord })),
      inventory: inventory.map(serializeItem),
      ledger: ledger.map(serializeLedger),
      crew: crewProfiles.map((p) => ({
        userId: p.userId,
        name: nameById.get(p.userId) ?? null,
        certifications: p.certifications,
        bio: p.bio,
        photo: p.photo,
        joined: p.joined,
      })),
    };
  }
}
