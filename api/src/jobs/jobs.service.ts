import { operation, audit } from '../db/operations';
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
import { AnswersDto, CertifyDto, CompleteJobDto, CreateJobDto, UpdateJobDto, ReopenJobDto } from './jobs.dto';
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
    const local = await this.prisma.crewProfile.findMany({ where: { installationId, local: true, active: true } });
    return { nameById: new Map([...users.filter(u=>u.active).map((u) => [u.id, u.name] as const), ...local.map(u => [u.userId, u.name] as const)]), tz: profile.timezone };
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

  private async validateInput(identity: Identity, dto: CreateJobDto) {
    if (dto.price !== undefined && !hasPerm(identity, P.JOBS_VIEW_PRICING)) throw forbidden('Pricing access is required to set a price');
    if (dto.assignedUserIds) {
      const users = await this.directory.listUsers(identity.installationId);
      const local = await this.prisma.crewProfile.findMany({ where: { installationId: identity.installationId, local: true, active: true } });
      const ids = new Set([...users.filter(u => u.active).map(u => u.id), ...local.map(u => u.userId)]);
      if (new Set(dto.assignedUserIds).size !== dto.assignedUserIds.length || dto.assignedUserIds.some(id => !ids.has(id))) throw unprocessable('Assigned divers must be unique active members of this team');
    }
  }

  async create(identity: Identity, dto: CreateJobDto) {
    if (!dto.boat?.trim() && !dto.site?.trim()) throw unprocessable('A boat or site name is required');
    await this.validateInput(identity, dto);
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
    await this.validateInput(identity, dto);
    if (!(dto.boat ?? existing.boat).trim() && !(dto.site ?? existing.site).trim()) throw unprocessable('A boat or site name is required');
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
    const changed = await this.prisma.job.updateMany({ where: { id: existing.id, installationId: identity.installationId, updatedAt: new Date(dto.expectedUpdatedAt) }, data });
    if (!changed.count) throw conflict('This job changed. Reload before saving your edits.');
    const job = await this.prisma.job.findUniqueOrThrow({ where: { id: existing.id } });
    const { nameById, tz } = await this.ctx(identity.installationId);
    return { job: serializeJob(job, { nameById, canPrice: hasPerm(identity, P.JOBS_VIEW_PRICING), tz }) };
  }

  async remove(identity: Identity, id: string) {
    const existing = await this.loadVisibleJob(identity, id);
    await this.prisma.job.delete({ where: { id: existing.id } });
    return { ok: true };
  }

  async complete(identity: Identity, id: string, dto: CompleteJobDto) {
    await this.loadVisibleJob(identity, id);
    const { nameById, tz } = await this.ctx(identity.installationId);
    let completedBy = identity.userId;
    if (dto.onBehalfOfUserId && dto.onBehalfOfUserId !== identity.userId) {
      if (!hasPerm(identity, P.JOBS_MANAGE)) throw forbidden('Only a manager may record another diver’s work');
      if (!nameById.has(dto.onBehalfOfUserId)) throw unprocessable('Diver is not an active team member');
      completedBy = dto.onBehalfOfUserId;
    }
    if (dto.completedAt && !hasPerm(identity, P.JOBS_MANAGE)) throw forbidden('Only a manager may backdate work');
    const completedAt = dto.completedAt ? new Date(dto.completedAt) : new Date();
    if (!Number.isFinite(completedAt.getTime()) || completedAt > new Date()) throw unprocessable('Completion time must be a valid time in the past');
    if (dto.photo && !isSafePhoto(dto.photo)) throw unprocessable('Invalid proof image');
    return operation(this.prisma, identity, dto.requestId, { action: 'complete', id, dto }, async tx => {
      const job = await tx.job.findFirst({ where: { id, installationId: identity.installationId } });
      if (!job) throw notFound('Job not found');
      if (!hasPerm(identity, P.JOBS_VIEW_ALL) && !this.isAssigned(job, identity.userId)) throw notFound('Job not found');
      if (job.status !== 'open' || job.occurrence !== dto.occurrence) throw conflict('This service occurrence has changed. Reload the job.');
      const settings = await tx.installationSettings.findUnique({ where: { installationId: identity.installationId } });
      const rate = new Prisma.Decimal(settings?.payRate ?? 0.5);
      const videos = sanitizeVideos(toArray<{title?: string; url?: string}>(job.videos));
      if (dto.videoUrl) {
        const url = safeUrl(dto.videoUrl);
        if (!url) throw unprocessable('Video link must use HTTPS or HTTP');
        videos.push({title: 'Completion video', url});
      }
      const checkAnswers = dto.answers ? dto.answers.map(a => ({ id: a.id ?? '', q: a.q ?? '', a: chkKindOf({ text: a.q ?? '' }) === 'percent' ? chkNormalizePercent(a.a ?? '') : a.a ?? '' })) : job.checkAnswers;
      const savedJob = await tx.job.update({ where: { id }, data: {
        status: 'completed', completedBy, completedByName: nameById.get(completedBy) ?? completedBy,
        completedAt, completionNote: dto.note ?? '', completionPhoto: dto.photo ?? '', videos,
        checkAnswers: checkAnswers as Prisma.InputJsonValue,
      } });
      const savedRecord = await tx.serviceRecord.create({ data: {
        ...buildRecordData(savedJob, nameById), occurrence: job.occurrence,
        payRateSnapshot: rate, payAmount: new Prisma.Decimal(job.price).mul(rate).toDecimalPlaces(2), paySource: 'completion',
        videos,
      } });
      await audit(tx, identity, 'job.completed', id, { recordId: savedRecord.id, completedBy, completedAt: completedAt.toISOString(), backdated: !!dto.completedAt });
      const canPrice = hasPerm(identity, P.JOBS_VIEW_PRICING);
      return { job: serializeJob(savedJob, {nameById, canPrice, tz}), record: serializeRecord(savedRecord, {canPrice}) };
    });
  }

  async reopen(identity: Identity, id: string, dto: ReopenJobDto) {
    await this.loadVisibleJob(identity, id);
    const { nameById, tz } = await this.ctx(identity.installationId);
    return operation(this.prisma, identity, dto.requestId, {action: 'reopen', id, dto}, async tx => {
      const job = await tx.job.findFirst({where: {id, installationId: identity.installationId}});
      if (!job) throw notFound();
      if (job.status !== 'completed' || job.occurrence !== dto.occurrence) throw conflict('Only the current completed occurrence can be reopened');
      const dueDate = job.dueDate ? nextDueDate(job.rotation, job.completedAt ? instantToCivil(job.completedAt, tz) : job.dueDate, tz) : '';
      const videos = sanitizeVideos(toArray<{title?: string; url?: string}>(job.videos).filter(v => v.title !== 'Completion video'));
      const saved = await tx.job.update({where: {id}, data: {status:'open', occurrence:{increment:1}, completedBy:null, completedByName:null,
        completedAt:null, completionNote:'', completionPhoto:'', videos, checkAnswers:[], certified:false, certifiedAt:null, dueDate}});
      await audit(tx, identity, 'job.next_rotation', id, {dueDate, occurrence:saved.occurrence});
      return {job:serializeJob(saved,{nameById,canPrice:hasPerm(identity,P.JOBS_VIEW_PRICING),tz})};
    });
  }

  async setAnswers(identity: Identity, id: string, dto: AnswersDto) {
    const job = await this.loadVisibleJob(identity, id);
    const answers = dto.answers.map(a => ({id:a.id ?? '',q:a.q ?? '',a:chkKindOf({text:a.q ?? ''}) === 'percent' ? chkNormalizePercent(a.a ?? '') : a.a ?? ''}));
    const changed = await this.prisma.job.updateMany({where:{id,installationId:identity.installationId,status:'open',updatedAt:job.updatedAt},data:{checkAnswers:answers}});
    if (!changed.count) throw conflict('Job changed or is completed; reopen before editing');
    return this.getOne(identity,id);
  }

  async setCertify(identity: Identity, id: string, dto: CertifyDto) {
    const job = await this.loadVisibleJob(identity, id);
    const changed = await this.prisma.job.updateMany({where:{id,installationId:identity.installationId,status:'open',updatedAt:job.updatedAt},data:{certified:dto.certified,certifiedAt:dto.certified ? new Date() : null}});
    if (!changed.count) throw conflict('Job changed or is completed; reopen before editing');
    return this.getOne(identity,id);
  }

}
