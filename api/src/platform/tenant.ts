import { Injectable, OnModuleInit } from '@nestjs/common';
import { assertDevStubAllowed } from '../common/dev-stub-guard';

// Tenant profile read from the platform (operation name, contact email, and —
// critically — the tenant timezone that due-date rotation math and Monday-based
// pay weeks are computed in). Dev stub returns constants per installation.
export interface TenantProfile {
  tenantId: string;
  installationId: string;
  operationName: string;
  contactEmail: string;
  timezone: string; // IANA tz, e.g. "America/Los_Angeles"
}

export interface PlatformTenantProvider {
  getProfile(installationId: string): Promise<TenantProfile>;
}

export const PLATFORM_TENANT = 'PLATFORM_TENANT';

const PROFILES: Record<string, TenantProfile> = {
  inst_demo: {
    tenantId: 'tenant_demo',
    installationId: 'inst_demo',
    operationName: 'Blue Horizon Dive Services',
    contactEmail: 'ops@bluehorizondive.example',
    timezone: 'America/Los_Angeles',
  },
  inst_other: {
    tenantId: 'tenant_two',
    installationId: 'inst_other',
    operationName: 'Reef Runners Marine',
    contactEmail: 'hello@reefrunners.example',
    timezone: 'America/New_York',
  },
};

@Injectable()
export class DevStubTenantProvider implements PlatformTenantProvider, OnModuleInit {
  // Own fail-closed tripwire: serves hardcoded tenant profiles (names, contact emails, timezones used
  // in pay/rotation math), so it must never run outside dev/test.
  onModuleInit(): void {
    assertDevStubAllowed('DevStubTenantProvider');
  }

  async getProfile(installationId: string): Promise<TenantProfile> {
    return (
      PROFILES[installationId] || {
        tenantId: '',
        installationId,
        operationName: 'Dive Operation',
        contactEmail: '',
        timezone: 'America/Los_Angeles',
      }
    );
  }
}
