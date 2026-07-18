import { Controller, Get } from '@nestjs/common';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import { Identity } from '../auth/identity';
import { P } from '../auth/permissions';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { FinanceService } from './finance.service';

@Controller('backup')
export class BackupController {
  constructor(private readonly finance: FinanceService) {}

  @Get()
  @RequirePermissions(P.FINANCE_MANAGE)
  backup(@CurrentIdentity() identity: Identity) {
    return this.finance.backup(identity);
  }
}
