import { Logger } from '@nestjs/common';
import { clientId, clientSecret, oauthTokenUrl } from './config';

/**
 * OAuth2 client for the scoped API (contract §4).
 *
 * WIRE SHAPE — two details the contract calls out explicitly, both easy to get wrong:
 *   · credentials go in an `Authorization: Basic base64(id:secret)` header, NOT in the body.
 *   · the body is JSON, NOT form-encoded.
 * A request that puts credentials in the body, or form-encodes, is rejected outright.
 *
 * GRANT: `grant_type=installation` exchanges our app credential for an access token scoped to one
 * installation, with no user interaction. That is what a backend calling `users.read`/`tenant.read`
 * needs, and it is why this module has no refresh-token store: tokens are short-lived and simply
 * re-acquired. The Authorization-Code + PKCE flow exists in the contract for user-consented
 * connections; nothing in this app needs it yet, so it is deliberately not built rather than built
 * untested. Add it here when a feature actually requires user-delegated access.
 *
 * CACHING: tokens are held in memory, keyed by installation, and expired 60s early to avoid racing
 * the boundary. In memory, never on disk — an access token is a bearer secret, and this process
 * already has to be trusted with the client secret. Losing the cache on restart is harmless; the
 * next call re-acquires.
 */

const logger = new Logger('OAuthClient');

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

const cache = new Map<string, CachedToken>();

/** Expire 60s early so a token cannot lapse mid-flight between our check and the platform's. */
const EXPIRY_SKEW_MS = 60_000;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
}

/** Discard a cached token — call after a 401 so the next attempt re-acquires rather than replaying. */
export function invalidateToken(installationId: string): void {
  cache.delete(installationId);
}

export async function getAccessToken(installationId: string): Promise<string> {
  const hit = cache.get(installationId);
  if (hit && hit.expiresAtMs > Date.now()) return hit.accessToken;

  const basic = Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64');

  let res: Response;
  try {
    res = await fetch(oauthTokenUrl(), {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ grant_type: 'installation', installation_id: installationId }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    throw new Error(`OAuth token endpoint unreachable: ${(err as Error).message}`);
  }

  if (!res.ok) {
    // Deliberately does NOT log the body: a token-endpoint error can echo back request context,
    // and this path handles the client secret.
    throw new Error(`OAuth token request failed with HTTP ${res.status}`);
  }

  const json = (await res.json()) as TokenResponse;
  if (!json.access_token) throw new Error('OAuth token response contained no access_token');

  const ttlMs = (json.expires_in ?? 3600) * 1000;
  cache.set(installationId, {
    accessToken: json.access_token,
    expiresAtMs: Date.now() + Math.max(0, ttlMs - EXPIRY_SKEW_MS),
  });
  logger.debug(`acquired access token for ${installationId} (ttl ${json.expires_in ?? 3600}s)`);
  return json.access_token;
}
