import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { assertDevStubAllowed } from '../common/dev-stub-guard';
import { scopedGet } from './scoped-api-client';

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

/**
 * PRODUCTION tenant profile — reads the tenant over the scoped API (§7, `tenant.read`).
 *
 * TIMEZONE IS LOAD-BEARING, not decoration. Due-date rotation math and Monday-based pay weeks are
 * computed in it, so a wrong value silently shifts which jobs read as overdue and which shift lands
 * in which pay week. When the platform does not supply one we fall back to UTC and say so loudly —
 * a logged fallback is recoverable, a silently-guessed local timezone is not.
 *
 * PII (contact email) is nulled without the sensitive-tier scope; see ScopedApiDirectory.
 */
interface ScopedTenant {
  tenantId?: string;
  id?: string;
  name?: string | null;
  displayName?: string | null;
  contactEmail?: string | null;
  timezone?: string | null;
}

@Injectable()
export class ScopedApiTenantProvider implements PlatformTenantProvider {
  private readonly logger = new Logger('ScopedApiTenantProvider');

  async getProfile(installationId: string): Promise<TenantProfile> {
    const t = await scopedGet<ScopedTenant>(installationId, 'tenant');

    const timezone = (t.timezone ?? '').trim();
    if (!timezone) {
      this.logger.warn(
        `tenant ${installationId} returned no timezone — falling back to UTC. Rotation due-dates and ` +
          'pay-week boundaries will be computed in UTC until the platform supplies one.',
      );
    }

    return {
      tenantId: t.tenantId ?? t.id ?? '',
      installationId,
      operationName: (t.displayName ?? t.name ?? '').trim() || 'Dive Operation',
      contactEmail: (t.contactEmail ?? '').trim(),
      timezone: timezone || 'UTC',
    };
  }
}
