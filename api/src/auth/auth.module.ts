import { Global, Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { IDENTITY_PROVIDER } from './identity';
import { DevStubIdentityProvider } from './dev-stub.provider';
import { JwksIdentityProvider } from './jwks-identity.provider';
import { IdentityGuard } from './identity.guard';
import { PermissionsGuard } from './permissions.guard';

// Which identity provider ships.
//
// DEFAULT IS THE REAL ONE. The dev stub performs no cryptographic verification at all, so the
// selection is opt-IN to the stub, never opt-out of the real provider: an unset, empty or mistyped
// env var must land on JWKS verification, not on "anyone can mint a token for any tenant". This is
// the same default-deny posture as dev-stub-guard.ts, one layer up — the guard stops the stub from
// BOOTING in production; this stops it from being SELECTED anywhere it was not explicitly asked for.
//
// USE_DEV_IDENTITY_STUB=true is the only way in, and the stub's own boot guard still has to agree.
function identityProviderClass(): typeof DevStubIdentityProvider | typeof JwksIdentityProvider {
  if (process.env.USE_DEV_IDENTITY_STUB === 'true') return DevStubIdentityProvider;
  return JwksIdentityProvider;
}

// Global auth wiring. Guard order matters: IdentityGuard runs first (attaches
// request.identity), then PermissionsGuard enforces @RequirePermissions.
@Global()
@Module({
  providers: [
    { provide: IDENTITY_PROVIDER, useClass: identityProviderClass() },
    { provide: APP_GUARD, useClass: IdentityGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [IDENTITY_PROVIDER],
})
export class AuthModule {
  constructor() {
    new Logger('AuthModule').log(
      `Identity provider: ${identityProviderClass().name}` +
        (process.env.USE_DEV_IDENTITY_STUB === 'true' ? ' (DEV STUB — unverified tokens)' : ''),
    );
  }
}
