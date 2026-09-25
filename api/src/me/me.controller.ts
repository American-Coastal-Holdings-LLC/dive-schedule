import { isPaymentOwner } from '../payments/payment-settings';
import { Inject, Controller, Get } from '@nestjs/common';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import { Identity } from '../auth/identity';

import { PLATFORM_TENANT, PlatformTenantProvider } from '../platform/tenant';

// GET /api/me — any valid token. The frontend renders everything (tabs,
// affordances, pricing UI) from this response.
@Controller('me')
export class MeController {
  constructor(@Inject(PLATFORM_TENANT) private readonly tenant: PlatformTenantProvider) {}
  @Get()
  async me(@CurrentIdentity() identity: Identity) {
    const profile=await this.tenant.getProfile(identity.installationId);
    return {
      timezone:profile.timezone,
      paymentAdmin:isPaymentOwner(identity),
      user: { id: identity.userId, name: identity.name },
      tenantId: identity.tenantId,
      installationId: identity.installationId,
      permissions: Array.from(identity.permissions),
    };
  }
}
