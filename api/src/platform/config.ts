// Platform endpoint configuration (Vendor Integration Contract §4-§7).
//
// The single source of truth is EOS_API_BASE; every other plugin-api URL derives from it by the
// convention `${EOS_API_BASE}/plugin-api/v1/...`. The individual EOS_*_URL overrides exist only for
// the rare case where one endpoint must diverge — in practice you set EOS_API_BASE and nothing else.
//
// Mirrors SprocketSuite's src/server/platform/config.ts; the two plugins are deployed and operated
// the same way, so their platform seams are deliberately the same shape.

import { pluginSlug } from '../auth/permissions';

function trimmed(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t && t.length > 0 ? t : undefined;
}

/** EOS_API_BASE with any trailing slashes stripped. Defaults to the local dev-stub platform. */
export function eosApiBase(): string {
  return (process.env.EOS_API_BASE ?? 'http://localhost:4322').replace(/\/+$/, '');
}

/** JWKS document used to verify bridge tokens (§5). */
export function jwksUrl(): string {
  return trimmed(process.env.EOS_JWKS_URL) ?? `${eosApiBase()}/plugin-api/v1/.well-known/jwks.json`;
}

/** Live-state verification endpoint (§5) — the authorization source of record. */
export function bridgeVerifyUrl(): string {
  return trimmed(process.env.EOS_BRIDGE_VERIFY_URL) ?? `${eosApiBase()}/plugin-api/v1/bridge/verify`;
}

/** Expected `iss` on a bridge token. */
export function issuer(): string {
  return process.env.EOS_ISSUER ?? process.env.PLATFORM_ISSUER ?? 'eos-plugin-issuer-dev';
}

/** Scoped-API base (§6/§7), plugin-slug-derived. */
export function scopedApiBase(): string {
  return trimmed(process.env.EOS_SCOPED_API_BASE) ?? `${eosApiBase()}/plugin-api/v1/${pluginSlug()}`;
}

export function oauthAuthorizeUrl(): string {
  return trimmed(process.env.EOS_OAUTH_AUTHORIZE_URL) ?? `${eosApiBase()}/plugin-api/v1/oauth/authorize`;
}

export function oauthTokenUrl(): string {
  return trimmed(process.env.EOS_OAUTH_TOKEN_URL) ?? `${eosApiBase()}/plugin-api/v1/oauth/token`;
}

const DEV_CLIENT_ID = 'dev-client-id';
const DEV_CLIENT_SECRET = 'dev-client-secret';

/**
 * Refuse to run on a known dev placeholder in production. Client credentials cannot have a
 * build-time guard the way NEXT_PUBLIC_* can — they arrive purely at runtime — so this is the only
 * place a forgotten EOS_CLIENT_SECRET gets caught. Failing at boot beats authenticating as
 * "dev-client-id" against the live platform and getting a confusing 401 storm.
 */
function requireRealInProduction(value: string, devDefault: string, name: string): string {
  if (process.env.NODE_ENV === 'production' && value === devDefault) {
    throw new Error(`${name} is still the dev placeholder ('${devDefault}') in production. Set the real value.`);
  }
  return value;
}

export function clientId(): string {
  const v = process.env.EOS_CLIENT_ID ?? process.env.OAUTH_CLIENT_ID ?? DEV_CLIENT_ID;
  return requireRealInProduction(v, DEV_CLIENT_ID, 'EOS_CLIENT_ID');
}

export function clientSecret(): string {
  const v = process.env.EOS_CLIENT_SECRET ?? process.env.OAUTH_CLIENT_SECRET ?? DEV_CLIENT_SECRET;
  return requireRealInProduction(v, DEV_CLIENT_SECRET, 'EOS_CLIENT_SECRET');
}
