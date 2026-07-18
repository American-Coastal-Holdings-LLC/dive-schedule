import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import { Identity } from '../auth/identity';
import { P } from '../auth/permissions';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { SendRecordDto } from './records.dto';
import { RecordsService } from './records.service';

@Controller('records')
export class RecordsController {
  constructor(private readonly records: RecordsService) {}

  @Get()
  @RequirePermissions(P.RECORDS_VIEW)
  list(@CurrentIdentity() identity: Identity) {
    return this.records.list(identity);
  }

  @Get(':id')
  @RequirePermissions(P.RECORDS_VIEW)
  getOne(@CurrentIdentity() identity: Identity, @Param('id') id: string) {
    return this.records.getOne(identity, id);
  }

  @Post(':id/send')
  @RequirePermissions(P.RECORDS_SEND)
  send(
    @CurrentIdentity() identity: Identity,
    @Param('id') id: string,
    @Body() dto: SendRecordDto,
  ) {
    return this.records.send(identity, id, dto);
  }

  @Post(':id/restore')
  @RequirePermissions(P.RECORDS_SEND)
  restore(@CurrentIdentity() identity: Identity, @Param('id') id: string) {
    return this.records.restore(identity, id);
  }

  @Delete(':id')
  @RequirePermissions(P.RECORDS_MANAGE)
  remove(@CurrentIdentity() identity: Identity, @Param('id') id: string) {
    return this.records.remove(identity, id);
  }
}
