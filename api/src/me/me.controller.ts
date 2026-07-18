import { Controller, Get } from '@nestjs/common';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import { Identity } from '../auth/identity';

// GET /api/me — any valid token. The frontend renders everything (tabs,
// affordances, pricing UI) from this response.
@Controller('me')
export class MeController {
  @Get()
  me(@CurrentIdentity() identity: Identity) {
    return {
      user: { id: identity.userId, name: identity.name },
      tenantId: identity.tenantId,
      installationId: identity.installationId,
      permissions: Array.from(identity.permissions),
    };
  }
}
