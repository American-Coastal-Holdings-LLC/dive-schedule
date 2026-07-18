import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import { Identity } from '../auth/identity';
import { P } from '../auth/permissions';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CreateChecklistDto } from './checklist.dto';
import { ChecklistService } from './checklist.service';

@Controller('checklist')
export class ChecklistController {
  constructor(private readonly checklist: ChecklistService) {}

  @Get()
  @RequirePermissions(P.JOBS_VIEW_ALL, P.JOBS_VIEW_ASSIGNED)
  list(@CurrentIdentity() identity: Identity) {
    return this.checklist.list(identity);
  }

  @Post()
  @RequirePermissions(P.CHECKLIST_MANAGE)
  create(@CurrentIdentity() identity: Identity, @Body() dto: CreateChecklistDto) {
    return this.checklist.create(identity, dto);
  }

  @Delete(':id')
  @RequirePermissions(P.CHECKLIST_MANAGE)
  remove(@CurrentIdentity() identity: Identity, @Param('id') id: string) {
    return this.checklist.remove(identity, id);
  }
}
