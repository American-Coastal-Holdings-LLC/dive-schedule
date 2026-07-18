import { Body, Controller, Get, Put } from '@nestjs/common';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import { Identity } from '../auth/identity';
import { P } from '../auth/permissions';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { SettingsDto } from './finance.dto';
import { FinanceService } from './finance.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly finance: FinanceService) {}

  @Get()
  @RequirePermissions(P.FINANCE_VIEW, P.SETTINGS_MANAGE)
  get(@CurrentIdentity() identity: Identity) {
    return this.finance.settingsGet(identity);
  }

  @Put()
  @RequirePermissions(P.SETTINGS_MANAGE)
  put(@CurrentIdentity() identity: Identity, @Body() dto: SettingsDto) {
    return this.finance.settingsPut(identity, dto);
  }
}
