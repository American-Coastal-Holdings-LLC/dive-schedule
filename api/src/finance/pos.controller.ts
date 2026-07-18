import { Body, Controller, Post } from '@nestjs/common';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import { Identity } from '../auth/identity';
import { P } from '../auth/permissions';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { PosSaleDto } from './finance.dto';
import { FinanceService } from './finance.service';

@Controller('pos')
export class PosController {
  constructor(private readonly finance: FinanceService) {}

  @Post('sale')
  @RequirePermissions(P.POS_USE)
  sale(@CurrentIdentity() identity: Identity, @Body() dto: PosSaleDto) {
    return this.finance.posSale(identity, dto);
  }
}
