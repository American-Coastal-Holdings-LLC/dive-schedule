import { Global, Module } from '@nestjs/common';
import { DevStubDirectory, PLATFORM_DIRECTORY } from './directory';
import { DevStubTenantProvider, PLATFORM_TENANT } from './tenant';

@Global()
@Module({
  providers: [
    { provide: PLATFORM_DIRECTORY, useClass: DevStubDirectory },
    { provide: PLATFORM_TENANT, useClass: DevStubTenantProvider },
  ],
  exports: [PLATFORM_DIRECTORY, PLATFORM_TENANT],
})
export class PlatformModule {}
