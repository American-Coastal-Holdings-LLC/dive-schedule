import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import { Identity } from '../auth/identity';
import { P } from '../auth/permissions';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CreateLedgerDto } from './finance.dto';
import { FinanceService } from './finance.service';

@Controller('ledger')
export class LedgerController {
  constructor(private readonly finance: FinanceService) {}

  @Get()
  @RequirePermissions(P.FINANCE_VIEW)
  list(@CurrentIdentity() identity: Identity) {
    return this.finance.ledgerList(identity);
  }

  @Post()
  @RequirePermissions(P.FINANCE_MANAGE)
  create(@CurrentIdentity() identity: Identity, @Body() dto: CreateLedgerDto) {
    return this.finance.ledgerCreate(identity, dto);
  }

  @Delete(':id')
  @RequirePermissions(P.FINANCE_MANAGE)
  remove(@CurrentIdentity() identity: Identity, @Param('id') id: string) {
    return this.finance.ledgerRemove(identity, id);
  }
}
