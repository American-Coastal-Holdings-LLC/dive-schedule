import { Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { Identity, IdentityProvider } from './identity';
import { pluginSlug, stripNamespace } from './permissions';
import { bridgeVerifyUrl, issuer, jwksUrl } from '../platform/config';

/**
 * PRODUCTION identity provider — the code that SHIPS. Performs the contract §5 server-side
 * verification of a bridge token:
 *
 *   step 1  fetch the platform JWKS (cached by kid) — asymmetric keys only.
 *   step 2  jwtVerify with a PINNED algorithm allowlist (ES256/EdDSA), which rejects `alg: none`
 *           and every HS* (algorithm confusion — an attacker signing with the PUBLIC key as an HMAC
 *           secret), plus expiry and issuer; then assert `typ === 'bridge'` (an access token must
 *           not authenticate a user) and `pluginName === pluginSlug()` (a token minted for another
 *           vendor's plugin must not work here).
 *   step 3  POST /bridge/verify for LIVE state and authorize against ITS permissions, never the
 *           baked token claim. This is what makes revocation and role changes take effect within
 *           minutes without a redeploy (§5 step 3). active:false → deny.
 *
 * Any failure resolves to null, which the identity guard turns into a 401. Nulls are deliberately
 * indistinguishable from each other: an attacker probing with forged tokens learns nothing about
 * which check failed.
 *
 * PERMISSION NAMESPACE: bridge/verify returns `ext.<vendorSlug>.<pluginSlug>.*` keys; the guards
 * compare the internal `dive.*` form. stripNamespace() converts at this seam — see permissions.ts
 * for why skipping it fails silently rather than loudly.
 *
 * `aud`: §5 also pins `aud == your installationId`. One backend here hosts MULTIPLE installations,
 * so it cannot statically pin a single aud; the per-installation active check is delegated to
 * /bridge/verify, which resolves the installation and returns its live permissions.
 */

/** Canonical bridge/verify response (§5, amended 2026-07-19): always HTTP 200. */
interface BridgeVerifyResponse {
  active: boolean;
  installationId: string;
  tenantId: string;
  userId: string;
  permissions: string[];
}

// Algorithm allowlist. Asymmetric only — the whole point of JWKS verification is that we hold no
// signing secret, so any symmetric alg arriving here is an attack, not a configuration.
const ALLOWED_ALGS = ['ES256', 'EdDSA'];

@Injectable()
export class JwksIdentityProvider implements IdentityProvider {
  private readonly logger = new Logger('JwksIdentityProvider');

  // Lazily built and memoized so jose's internal kid-cache survives across requests, and so the
  // JWKS URL is read from env at first use rather than at module load.
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  private keys(): ReturnType<typeof createRemoteJWKSet> {
    if (!this.jwks) {
      this.jwks = createRemoteJWKSet(new URL(jwksUrl()), {
        cooldownDuration: 300_000, // 300s between refetches on an unknown kid (§5/C6)
        timeoutDuration: 5_000, // 5s fetch timeout (§5/C6)
      });
    }
    return this.jwks;
  }

  async verify(token: string): Promise<Identity | null> {
    if (!token) return null;

    // ── steps 1-2: signature, algorithm, issuer, expiry, token type, plugin binding ──
    let claims: Record<string, unknown>;
    try {
      const { payload } = await jwtVerify(token, this.keys(), {
        algorithms: ALLOWED_ALGS,
        issuer: issuer(),
      });
      claims = payload as Record<string, unknown>;
    } catch (err) {
      this.logger.debug(`bridge token rejected at verify: ${(err as Error).message}`);
      return null;
    }

    if (claims.typ !== 'bridge') {
      this.logger.warn('bridge token rejected: typ is not "bridge" (an access token cannot authenticate a user)');
      return null;
    }
    if (typeof claims.pluginName === 'string' && claims.pluginName !== pluginSlug()) {
      this.logger.warn('bridge token rejected: minted for a different plugin');
      return null;
    }

    // ── step 3: live state. Authorize against THIS, never the baked claim. ──
    let live: BridgeVerifyResponse;
    try {
      const res = await fetch(bridgeVerifyUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        this.logger.warn(`bridge/verify returned ${res.status} — denying`);
        return null;
      }
      live = (await res.json()) as BridgeVerifyResponse;
    } catch (err) {
      // Fail CLOSED. A reachable-but-erroring platform must not become "allow everything".
      this.logger.error(`bridge/verify unreachable: ${(err as Error).message} — denying`);
      return null;
    }

    if (!live?.active) return null;
    if (!live.installationId || !live.userId) return null;

    return {
      userId: live.userId,
      name: typeof claims.name === 'string' ? claims.name : live.userId,
      tenantId: live.tenantId ?? '',
      installationId: live.installationId,
      permissions: new Set((live.permissions ?? []).map(stripNamespace)),
    };
  }
}
