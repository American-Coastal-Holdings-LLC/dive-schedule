import { Inject, Injectable } from '@nestjs/common';
import { forbidden } from '../common/api-error';
import { Identity, hasPerm } from '../auth/identity';
import { P } from '../auth/permissions';
import { PrismaService } from '../db/prisma.service';
import { PLATFORM_DIRECTORY, PlatformDirectory } from '../platform/directory';
import { PLATFORM_TENANT, PlatformTenantProvider } from '../platform/tenant';
import { addDaysCivil, instantToCivil, payWeekRange } from '../domain/dates';
import { num } from '../domain/serialize';

export interface PayJob {
  site: string;
  earning: number;
  feet: number;
}
export interface PayDay {
  date: string;
  jobs: PayJob[];
  total: number;
  feet: number;
}

// Weekly pay (Monday weeks). A crew member earns settings.payRate × price of each
// completed job, bucketed by completion day. Records are the source of truth (so
// earnings survive a job being reopened); completed jobs without a record yet are
// added as a fallback, deduped by job id. Ported from the seed's computePay.
@Injectable()
export class PayService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PLATFORM_DIRECTORY) private readonly directory: PlatformDirectory,
    @Inject(PLATFORM_TENANT) private readonly tenant: PlatformTenantProvider,
  ) {}

  async get(identity: Identity, weekOffset: number, requestedUserId?: string) {
    const targetUserId = requestedUserId || identity.userId;
    if (targetUserId !== identity.userId && !hasPerm(identity, P.PAY_VIEW_ALL)) {
      throw forbidden("Viewing another user's pay requires dive.pay.view-all");
    }

    const profile = await this.tenant.getProfile(identity.installationId);
    const tz = profile.timezone;
    const { start, endExcl } = payWeekRange(weekOffset, tz);

    const settings = await this.prisma.installationSettings.findUnique({
      where: { installationId: identity.installationId },
    });
    const payRate = settings ? num(settings.payRate) : 0.5;

    const users = await this.directory.listUsers(identity.installationId);
    const targetName =
      new Map(users.map((u) => [u.id, u.name])).get(targetUserId) || targetUserId;

    const [records, jobs] = await Promise.all([
      this.prisma.serviceRecord.findMany({ where: { installationId: identity.installationId } }),
      this.prisma.job.findMany({
        where: { installationId: identity.installationId, status: 'completed' },
      }),
    ]);

    const days: PayDay[] = [];
    for (let i = 0; i < 7; i++) {
      days.push({ date: addDaysCivil(start, i), jobs: [], total: 0, feet: 0 });
    }
    const idxByDate = new Map(days.map((d, i) => [d.date, i]));
    let weekTotal = 0;
    let totalFeet = 0;

    const addJob = (civil: string | null, price: number, feet: number, site: string) => {
      if (!civil || civil < start || civil >= endExcl) return;
      const idx = idxByDate.get(civil);
      if (idx === undefined) return;
      const earning = (price > 0 ? price : 0) * payRate;
      days[idx].jobs.push({ site, earning, feet });
      days[idx].total += earning;
      days[idx].feet += feet;
      weekTotal += earning;
      totalFeet += feet;
    };

    const recordedJobIds = new Set<string>();
    for (const r of records) {
      if (r.jobId) recordedJobIds.add(r.jobId);
      const mine =
        (r.completedBy && r.completedBy === targetUserId) ||
        (!r.completedBy && targetName && r.completedByName === targetName);
      if (!mine) continue;
      addJob(instantToCivil(r.completedAt, tz), num(r.price), num(r.footage), r.site);
    }
    for (const t of jobs) {
      if (t.completedBy !== targetUserId) continue;
      if (t.id && recordedJobIds.has(t.id)) continue; // already paid via its record
      addJob(instantToCivil(t.completedAt, tz) || t.dueDate || null, num(t.price), num(t.footage), t.site);
    }

    return {
      weekStart: start,
      weekOffset,
      userId: targetUserId,
      userName: targetName,
      payRate,
      days,
      weekTotal,
      totalFeet,
    };
  }
}
