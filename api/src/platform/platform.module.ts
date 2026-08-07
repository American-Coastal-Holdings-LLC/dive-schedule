import { Global, Logger, Module } from '@nestjs/common';
import { DevStubDirectory, PLATFORM_DIRECTORY, ScopedApiDirectory } from './directory';
import { DevStubTenantProvider, PLATFORM_TENANT, ScopedApiTenantProvider } from './tenant';

// Which platform readers ship.
//
// DEFAULT IS REAL, same opt-in posture as the identity provider and webhook verifier: the stubs
// serve hardcoded users and tenant profiles, so an unset or mistyped env var must never silently
// select them. One switch covers both because they share a cause — no scoped API available — and
// splitting it would allow the incoherent half-stub state (real users, fake timezone) that is
// hardest to notice.
function useStubs(): boolean {
  return process.env.USE_DEV_PLATFORM_STUBS === 'true';
}

@Global()
@Module({
  providers: [
    { provide: PLATFORM_DIRECTORY, useClass: useStubs() ? DevStubDirectory : ScopedApiDirectory },
    { provide: PLATFORM_TENANT, useClass: useStubs() ? DevStubTenantProvider : ScopedApiTenantProvider },
  ],
  exports: [PLATFORM_DIRECTORY, PLATFORM_TENANT],
})
export class PlatformModule {
  constructor() {
    new Logger('PlatformModule').log(
      useStubs()
        ? 'Platform readers: DEV STUBS (hardcoded users + tenant profiles)'
        : 'Platform readers: ScopedApiDirectory + ScopedApiTenantProvider',
    );
  }
}
