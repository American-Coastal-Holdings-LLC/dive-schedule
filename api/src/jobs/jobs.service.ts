import { Inject, Injectable } from '@nestjs/common';
import { Job, Prisma } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { conflict, forbidden, notFound, unprocessable } from '../common/api-error';
import { Identity, hasPerm } from '../auth/identity';
import { P } from '../auth/permissions';
import { PrismaService } from '../db/prisma.service';
import { PLATFORM_DIRECTORY, PlatformDirectory } from '../platform/directory';
import { PLATFORM_TENANT, PlatformTenantProvider } from '../platform/tenant';
import { instantToCivil, nextDueDate } from '../domain/dates';
import { isSafePhoto, safeUrl, serializeJob, serializeRecord } from '../domain/serialize';
import { buildRecordData, syncableFields } from '../domain/record-builder';
import { AnswersDto, CertifyDto, CompleteJobDto, CreateJobDto, UpdateJobDto } from './jobs.dto';
import { chkKindOf, chkNormalizePercent } from '../checklist/inspection';

function toArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function sanitizeVideos(videos?: { title?: string; url?: string }[]): { title: string; url: string }[] {
  return toArray<{ title?: string; url?: string }>(videos)
    .map((v) => ({ title: String(v.title ?? ''), url: safeUrl(v.url) }))
    .filter((v) => v.url !== '');
}

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PLATFORM_DIRECTORY) private readonly directory: PlatformDirectory,
    @Inject(PLATFORM_TENANT) private readonly tenant: PlatformTenantProvider,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('jobs');
  }

  private async ctx(installationId: string): Promise<{ nameById: Map<string, string>; tz: string }> {
    const [users, profile] = await Promise.all([
      this.directory.listUsers(installationId),
      this.tenant.getProfile(installationId),
    ]);
    return { nameById: new Map(users.map((u) => [u.id, u.name])), tz: profile.timezone };
  }

  private isAssigned(job: Job, userId: string): boolean {
    return toArray<string>(job.assignedUserIds).includes(userId);
  }

  // Installation-scoped fetch + view-assigned visibility. Non-visible (or another
  // installation's) id -> 404, for detail AND every job-scoped sub-route.
  private async loadVisibleJob(identity: Identity, id: string): Promise<Job> {
    const job = await this.prisma.job.findFirst({
      where: { id, installationId: identity.installationId },
    });
    if (!job) throw notFound('Job not found');
    if (hasPerm(identity, P.JOBS_VIEW_ALL)) return job;
    if (hasPerm(identity, P.JOBS_VIEW_ASSIGNED) && this.isAssigned(job, identity.userId)) return job;
    throw notFound('Job not found');
  }

  async list(identity: Identity) {
    const canPrice = hasPerm(identity, P.JOBS_VIEW_PRICING);
    const viewAll = hasPerm(identity, P.JOBS_VIEW_ALL);
    const jobs = await this.prisma.job.findMany({
      where: { installationId: identity.installationId },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }],
    });
    const visible = viewAll ? jobs : jobs.filter((j) => this.isAssigned(j, identity.userId));
    const { nameById, tz } = await this.ctx(identity.installationId);
    return { jobs: visible.map((j) => serializeJob(j, { nameById, canPrice, tz })) };
  }

  async getOne(identity: Identity, id: string) {
    const job = await this.loadVisibleJob(identity, id);
    const { nameById, tz } = await this.ctx(identity.installationId);
    return { job: serializeJob(job, { nameById, canPrice: hasPerm(identity, P.JOBS_VIEW_PRICING), tz }) };
  }

  async create(identity: Identity, dto: CreateJobDto) {
    const job = await this.prisma.job.create({
      data: {
        installationId: identity.installationId,
        site: dto.site ?? '',
        boat: dto.boat ?? '',
        ownerName: dto.ownerName ?? '',
        customerEmail: dto.customerEmail ?? '',
        footage: dto.footage ?? 0,
        price: dto.price ?? 0,
        rotation: dto.rotation ?? 'weekly',
        dueDate: dto.dueDate ?? '',
        notes: dto.notes ?? '',
        videos: sanitizeVideos(dto.videos),
        assignedUserIds: dto.assignedUserIds ?? [],
      },
    });
    const { nameById, tz } = await this.ctx(identity.installationId);
    return { job: serializeJob(job, { nameById, canPrice: hasPerm(identity, P.JOBS_VIEW_PRICING), tz }) };
  }

  async update(identity: Identity, id: string, dto: UpdateJobDto) {
    const existing = await this.loadVisibleJob(identity, id);
    const data: Prisma.JobUncheckedUpdateInput = {};
    if (dto.site !== undefined) data.site = dto.site;
    if (dto.boat !== undefined) data.boat = dto.boat;
    if (dto.ownerName !== undefined) data.ownerName = dto.ownerName;
    if (dto.customerEmail !== undefined) data.customerEmail = dto.customerEmail;
    if (dto.footage !== undefined) data.footage = dto.footage;
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.rotation !== undefined) data.rotation = dto.rotation;
    if (dto.dueDate !== undefined) data.dueDate = dto.dueDate;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.videos !== undefined) data.videos = sanitizeVideos(dto.videos);
    if (dto.assignedUserIds !== undefined) data.assignedUserIds = dto.assignedUserIds;
    const job = await this.prisma.job.update({ where: { id: existing.id }, data });
    const { nameById, tz } = await this.ctx(identity.installationId);
    return { job: serializeJob(job, { nameById, canPrice: hasPerm(identity, P.JOBS_VIEW_PRICING), tz }) };
  }

  async remove(identity: Identity, id: string) {
    const existing = await this.loadVisibleJob(identity, id);
    await this.prisma.job.delete({ where: { id: existing.id } });
    return { ok: true };
  }

  async complete(identity: Identity, id: string, dto: CompleteJobDto) {
    const job = await this.loadVisibleJob(identity, id);
    if (job.status === 'completed') throw conflict('Job is already completed');
    const { nameById, tz } = await this.ctx(identity.installationId);

    // Attribution: completedBy is the token user, unless a jobs.manage holder
    // records on behalf of a crew member (audit-logged).
    let completedBy = identity.userId;
    if (dto.onBehalfOfUserId && dto.onBehalfOfUserId !== identity.userId) {
      if (!hasPerm(identity, P.JOBS_MANAGE)) {
        throw forbidden('Recording a completion on behalf of another user requires dive.jobs.manage');
      }
      const member = await this.directory.getUser(identity.installationId, dto.onBehalfOfUserId);
      if (!member) throw unprocessable('onBehalfOfUserId is not a member of this installation');
      completedBy = dto.onBehalfOfUserId;
      this.logger.info(
        {
          event: 'completion.on_behalf',
          actorUserId: identity.userId,
          onBehalfOfUserId: completedBy,
          jobId: job.id,
          installationId: identity.installationId,
        },
        'completion recorded on behalf of a crew member',
      );
    }
    const completedByName = nameById.get(completedBy) || completedBy;

    let photo = '';
    if (dto.photo) {
      if (!isSafePhoto(dto.photo)) throw unprocessable('completion photo must be an image data URL');
      photo = dto.photo;
    }

    const existingVideos = toArray<{ title?: string; url?: string }>(job.videos).map((v) => ({
      title: String(v.title ?? ''),
      url: String(v.url ?? ''),
    }));
    const safe = dto.videoUrl ? safeUrl(dto.videoUrl) : '';
    const videos = safe ? [...existingVideos, { title: 'Completion video', url: safe }] : existingVideos;

    // Allow backdating: use provided completedAt or default to now
    let completedAt: Date;
    if (dto.completedAt) {
      completedAt = new Date(dto.completedAt);
      // Validate it's a valid date
      if (isNaN(completedAt.getTime())) {
        throw unprocessable('completedAt must be a valid ISO 8601 datetime');
      }
      // Prevent future dates
      if (completedAt > new Date()) {
        throw unprocessable('completedAt cannot be in the future');
      }
      this.logger.info(
        {
          event: 'completion.backdated',
          jobId: job.id,
          completedAt: completedAt.toISOString(),
          installationId: identity.installationId,
        },
        'job completion backdated',
      );
    } else {
      completedAt = new Date();
    }

    const note = dto.note ?? '';
    const snapshot: Job = {
      ...job,
      status: 'completed',
      completedBy,
      completedByName,
      completedAt,
      completionNote: note,
      completionPhoto: photo,
      videos,
    };
    const recordData = buildRecordData(snapshot, nameById);

    const [savedJob, savedRecord] = await this.prisma.$transaction([
      this.prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          completedBy,
          completedByName,
          completedAt,
          completionNote: note,
          completionPhoto: photo,
          videos,
        },
      }),
      this.prisma.serviceRecord.create({ data: recordData }),
    ]);

    const canPrice = hasPerm(identity, P.JOBS_VIEW_PRICING);
    return {
      job: serializeJob(savedJob, { nameById, canPrice, tz }),
      record: serializeRecord(savedRecord, { canPrice }),
    };
  }

  async reopen(identity: Identity, id: string) {
    const job = await this.loadVisibleJob(identity, id);
    const { nameById, tz } = await this.ctx(identity.installationId);
    const lastDoneCivil = job.completedAt ? instantToCivil(job.completedAt, tz) : null;
    const videos = toArray<{ title?: string; url?: string }>(job.videos)
      .filter((v) => v.title !== 'Completion video')
      .map((v) => ({ title: String(v.title ?? ''), url: String(v.url ?? '') }));
    // Advance to the next rotation, anchored to when it was last cleaned; a job
    // with no due date stays without one. Records persist untouched.
    const dueDate = job.dueDate
      ? nextDueDate(job.rotation, lastDoneCivil || job.dueDate, tz)
      : job.dueDate;
    const saved = await this.prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'open',
        completedBy: null,
        completedByName: null,
        completedAt: null,
        completionNote: '',
        completionPhoto: '',
        videos,
        checkAnswers: [],
        certified: false,
        certifiedAt: null,
        dueDate,
      },
    });
    return { job: serializeJob(saved, { nameById, canPrice: hasPerm(identity, P.JOBS_VIEW_PRICING), tz }) };
  }

  async setAnswers(identity: Identity, id: string, dto: AnswersDto) {
    const job = await this.loadVisibleJob(identity, id);
    // Normalise percent answers server-side. The UI renders a select, so it already sends "50%" —
    // but the UI is not the only writer (an older client, a replayed request, or a direct API
    // call all reach here), and this column is snapshotted verbatim into the immutable service
    // record. A record reading "50", "50%" and "half" across three jobs is not comparable, and it
    // cannot be fixed after the fact once the record is sent. Normalising at the boundary is the
    // only place that holds for every writer.
    const answers = (dto.answers || []).map((a) => {
      const q = a.q ?? '';
      const raw = a.a ?? '';
      const isPercent = chkKindOf({ text: q }) === 'percent';
      return { id: a.id ?? '', q, a: isPercent ? chkNormalizePercent(raw) : raw };
    });
    const saved = await this.prisma.job.update({
      where: { id: job.id },
      data: { checkAnswers: answers },
    });
    const { nameById, tz } = await this.ctx(identity.installationId);
    if (saved.status === 'completed') await this.resyncRecord(saved, nameById);
    return { job: serializeJob(saved, { nameById, canPrice: hasPerm(identity, P.JOBS_VIEW_PRICING), tz }) };
  }

  async setCertify(identity: Identity, id: string, dto: CertifyDto) {
    const job = await this.loadVisibleJob(identity, id);
    const certifiedAt = dto.certified ? job.certifiedAt ?? new Date() : null;
    const saved = await this.prisma.job.update({
      where: { id: job.id },
      data: { certified: dto.certified, certifiedAt },
    });
    const { nameById, tz } = await this.ctx(identity.installationId);
    if (saved.status === 'completed') await this.resyncRecord(saved, nameById);
    return { job: serializeJob(saved, { nameById, canPrice: hasPerm(identity, P.JOBS_VIEW_PRICING), tz }) };
  }

  // Re-sync the UNSENT record for a completed job after checklist/certify edits.
  // Sent records are frozen; a missing record self-heals.
  private async resyncRecord(job: Job, nameById: Map<string, string>): Promise<void> {
    if (job.status !== 'completed') return;
    const rec = await this.prisma.serviceRecord.findFirst({
      where: { installationId: job.installationId, jobId: job.id, completedAt: job.completedAt },
    });
    if (rec) {
      if (rec.sent) return; // sent = frozen history
      await this.prisma.serviceRecord.update({
        where: { id: rec.id },
        data: {
          ...syncableFields(job, nameById, rec.photo),
          customerEmail: job.customerEmail || rec.customerEmail,
        },
      });
    } else {
      await this.prisma.serviceRecord.create({ data: buildRecordData(job, nameById) });
    }
  }
}
