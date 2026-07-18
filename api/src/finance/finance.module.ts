import { Module } from '@nestjs/common';
import { BackupController } from './backup.controller';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { LedgerController } from './ledger.controller';
import { PosController } from './pos.controller';
import { SettingsController } from './settings.controller';

@Module({
  controllers: [
    FinanceController,
    LedgerController,
    SettingsController,
    PosController,
    BackupController,
  ],
  providers: [FinanceService],
})
export class FinanceModule {}
