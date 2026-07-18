import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import { Identity } from '../auth/identity';
import { P } from '../auth/permissions';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { AnswersDto, CertifyDto, CompleteJobDto, CreateJobDto, UpdateJobDto } from './jobs.dto';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  @RequirePermissions(P.JOBS_VIEW_ALL, P.JOBS_VIEW_ASSIGNED)
  list(@CurrentIdentity() identity: Identity) {
    return this.jobs.list(identity);
  }

  @Post()
  @RequirePermissions(P.JOBS_MANAGE)
  create(@CurrentIdentity() identity: Identity, @Body() dto: CreateJobDto) {
    return this.jobs.create(identity, dto);
  }

  @Get(':id')
  @RequirePermissions(P.JOBS_VIEW_ALL, P.JOBS_VIEW_ASSIGNED)
  getOne(@CurrentIdentity() identity: Identity, @Param('id') id: string) {
    return this.jobs.getOne(identity, id);
  }

  @Patch(':id')
  @RequirePermissions(P.JOBS_MANAGE)
  update(
    @CurrentIdentity() identity: Identity,
    @Param('id') id: string,
    @Body() dto: UpdateJobDto,
  ) {
    return this.jobs.update(identity, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(P.JOBS_MANAGE)
  remove(@CurrentIdentity() identity: Identity, @Param('id') id: string) {
    return this.jobs.remove(identity, id);
  }

  @Post(':id/complete')
  @RequirePermissions(P.JOBS_COMPLETE)
  complete(
    @CurrentIdentity() identity: Identity,
    @Param('id') id: string,
    @Body() dto: CompleteJobDto,
  ) {
    return this.jobs.complete(identity, id, dto);
  }

  @Post(':id/reopen')
  @RequirePermissions(P.JOBS_MANAGE)
  reopen(@CurrentIdentity() identity: Identity, @Param('id') id: string) {
    return this.jobs.reopen(identity, id);
  }

  @Put(':id/answers')
  @RequirePermissions(P.JOBS_COMPLETE)
  setAnswers(
    @CurrentIdentity() identity: Identity,
    @Param('id') id: string,
    @Body() dto: AnswersDto,
  ) {
    return this.jobs.setAnswers(identity, id, dto);
  }

  @Put(':id/certify')
  @RequirePermissions(P.JOBS_COMPLETE)
  setCertify(
    @CurrentIdentity() identity: Identity,
    @Param('id') id: string,
    @Body() dto: CertifyDto,
  ) {
    return this.jobs.setCertify(identity, id, dto);
  }
}
