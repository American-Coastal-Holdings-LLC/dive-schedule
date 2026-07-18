import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Identity, IdentityProvider } from './identity';

// ============================================================================
// DEV STUB — NEVER SHIP
// ----------------------------------------------------------------------------
// Decodes tokens of the form `devtoken.<base64url(JSON)>` where JSON is
// { sub, name, tenantId, installationId, permissions: string[] }.
// It performs NO cryptographic verification whatsoever — anyone can mint a token
// for anyone. This exists only so the app is fully exercisable before the real
// platform identity contract (JWKS-signed tokens) lands, behind the same
// IdentityProvider interface.
// ============================================================================
@Injectable()
export class DevStubIdentityProvider implements IdentityProvider, OnModuleInit {
  private readonly logger = new Logger('DevStubIdentityProvider');
  private static readonly PREFIX = 'devtoken.';

  onModuleInit(): void {
    this.logger.warn(
      'DEV STUB IDENTITY PROVIDER ACTIVE — identity tokens are NOT cryptographically verified. NEVER SHIP. Replace with platform JWKS verification before production.',
    );
  }

  async verify(token: string): Promise<Identity | null> {
    if (!token || !token.startsWith(DevStubIdentityProvider.PREFIX)) return null;
    try {
      const encoded = token.slice(DevStubIdentityProvider.PREFIX.length);
      const json = Buffer.from(encoded, 'base64url').toString('utf8');
      const payload = JSON.parse(json) as {
        sub?: unknown;
        name?: unknown;
        tenantId?: unknown;
        installationId?: unknown;
        permissions?: unknown;
      };
      if (typeof payload.sub !== 'string' || !payload.sub) return null;
      if (typeof payload.installationId !== 'string' || !payload.installationId) return null;
      const permissions = Array.isArray(payload.permissions)
        ? payload.permissions.filter((p): p is string => typeof p === 'string')
        : [];
      return {
        userId: payload.sub,
        name: typeof payload.name === 'string' ? payload.name : payload.sub,
        tenantId: typeof payload.tenantId === 'string' ? payload.tenantId : '',
        installationId: payload.installationId,
        permissions: new Set(permissions),
      };
    } catch {
      return null;
    }
  }
}
