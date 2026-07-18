import { Inject, Injectable } from '@nestjs/common';
import { Job, ServiceRecord } from '@prisma/client';
import { notFound } from '../common/api-error';
import { Identity, hasPerm } from '../auth/identity';
import { P } from '../auth/permissions';
import { PrismaService } from '../db/prisma.service';
import { PLATFORM_TENANT, PlatformTenantProvider } from '../platform/tenant';
import { serializeRecord } from '../domain/serialize';
import { recordText } from '../domain/record-builder';
import { SendRecordDto } from './records.dto';

function isAssigned(job: Job, userId: string): boolean {
  return Array.isArray(job.assignedUserIds) && (job.assignedUserIds as string[]).includes(userId);
}

@Injectable()
export class RecordsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PLATFORM_TENANT) private readonly tenant: PlatformTenantProvider,
  ) {}

  // Records derived from jobs are subject to view-assigned filtering: a
  // view-assigned (not view-all) caller only sees records for jobs they're on.
  private async assignedJobIds(identity: Identity): Promise<Set<string>> {
    const jobs = await this.prisma.job.findMany({
      where: { installationId: identity.installationId },
      select: { id: true, assignedUserIds: true },
    });
    return new Set(
      jobs
        .filter((j) => Array.isArray(j.assignedUserIds) && (j.assignedUserIds as string[]).includes(identity.userId))
        .map((j) => j.id),
    );
  }

  private async loadVisibleRecord(identity: Identity, id: string): Promise<ServiceRecord> {
    const rec = await this.prisma.serviceRecord.findFirst({
      where: { id, installationId: identity.installationId },
    });
    if (!rec) throw notFound('Record not found');
    if (hasPerm(identity, P.JOBS_VIEW_ALL)) return rec;
    if (hasPerm(identity, P.JOBS_VIEW_ASSIGNED)) {
      const job = await this.prisma.job.findFirst({
        where: { id: rec.jobId, installationId: identity.installationId },
      });
      if (job && isAssigned(job, identity.userId)) return rec;
      throw notFound('Record not found');
    }
    return rec; // records.view without a jobs view-* grant: no job-scoped restriction
  }

  async list(identity: Identity) {
    const canPrice = hasPerm(identity, P.JOBS_VIEW_PRICING);
    let records = await this.prisma.serviceRecord.findMany({
      where: { installationId: identity.installationId },
      orderBy: { createdAt: 'desc' },
    });
    if (!hasPerm(identity, P.JOBS_VIEW_ALL) && hasPerm(identity, P.JOBS_VIEW_ASSIGNED)) {
      const visible = await this.assignedJobIds(identity);
      records = records.filter((r) => visible.has(r.jobId));
    }
    return { records: records.map((r) => serializeRecord(r, { canPrice })) };
  }

  async getOne(identity: Identity, id: string) {
    const rec = await this.loadVisibleRecord(identity, id);
    return { record: serializeRecord(rec, { canPrice: hasPerm(identity, P.JOBS_VIEW_PRICING) }) };
  }

  async send(identity: Identity, id: string, dto: SendRecordDto) {
    const rec = await this.loadVisibleRecord(identity, id);
    const { timezone } = await this.tenant.getProfile(identity.installationId);
    const sentAt = new Date();

    // Mark sent + save the email back to the parent job (survives if job deleted).
    await this.prisma.$transaction([
      this.prisma.serviceRecord.update({
        where: { id: rec.id },
        data: { sent: true, sentAt, sentTo: dto.sentTo },
      }),
      this.prisma.job.updateMany({
        where: { id: rec.jobId, installationId: identity.installationId },
        data: { customerEmail: dto.sentTo },
      }),
    ]);

    const subject = `Dive service record — ${rec.boat || 'Service'}`;
    const body = recordText(
      {
        boat: rec.boat,
        site: rec.site,
        ownerName: rec.ownerName,
        completedByName: rec.completedByName,
        diverNames: rec.diverNames,
        completedAt: rec.completedAt,
        rotation: rec.rotation,
        footage: rec.footage,
        price: rec.price,
        answers: rec.answers,
        note: rec.note,
        certified: rec.certified,
        certifiedAt: rec.certifiedAt,
      },
      timezone,
    );
    const mailto = `mailto:${dto.sentTo}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    const updated: ServiceRecord = { ...rec, sent: true, sentAt, sentTo: dto.sentTo };
    const canPrice = hasPerm(identity, P.JOBS_VIEW_PRICING);
    return { record: serializeRecord(updated, { canPrice }), mailto };
  }

  async restore(identity: Identity, id: string) {
    const rec = await this.loadVisibleRecord(identity, id);
    const updated = await this.prisma.serviceRecord.update({
      where: { id: rec.id },
      data: { sent: false, sentAt: null, sentTo: '' },
    });
    return { record: serializeRecord(updated, { canPrice: hasPerm(identity, P.JOBS_VIEW_PRICING) }) };
  }

  async remove(identity: Identity, id: string) {
    const rec = await this.loadVisibleRecord(identity, id);
    await this.prisma.serviceRecord.delete({ where: { id: rec.id } });
    return { ok: true };
  }
}
