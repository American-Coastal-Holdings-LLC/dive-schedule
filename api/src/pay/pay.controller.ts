import { Controller, Get, Query } from '@nestjs/common';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import { Identity } from '../auth/identity';
import { P } from '../auth/permissions';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { PayQueryDto } from './pay.dto';
import { PayService } from './pay.service';

@Controller('pay')
export class PayController {
  constructor(private readonly pay: PayService) {}

  @Get()
  @RequirePermissions(P.PAY_VIEW_OWN, P.PAY_VIEW_ALL)
  get(@CurrentIdentity() identity: Identity, @Query() query: PayQueryDto) {
    return this.pay.get(identity, query.week ?? 0, query.userId);
  }
}
