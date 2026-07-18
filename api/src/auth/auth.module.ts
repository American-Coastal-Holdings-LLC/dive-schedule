import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { IDENTITY_PROVIDER } from './identity';
import { DevStubIdentityProvider } from './dev-stub.provider';
import { IdentityGuard } from './identity.guard';
import { PermissionsGuard } from './permissions.guard';

// Global auth wiring. Guard order matters: IdentityGuard runs first (attaches
// request.identity), then PermissionsGuard enforces @RequirePermissions.
@Global()
@Module({
  providers: [
    { provide: IDENTITY_PROVIDER, useClass: DevStubIdentityProvider },
    { provide: APP_GUARD, useClass: IdentityGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [IDENTITY_PROVIDER],
})
export class AuthModule {}
