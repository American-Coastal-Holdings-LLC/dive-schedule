/**
 * @eos/plugin-verify — server-side verification helpers (contract 02 §5
 * steps 1-3, §8; PLUGIN_SECURITY_REQUIREMENTS gates D & I).
 *
 * Three independent concerns, matching the contract exactly:
 *   1. JWKS resolution (§5 step 1) — {@link createRemoteJwks} / {@link createLocalJwks}.
 *   2. Bridge-token verification (§5 step 2) — {@link verifyBridgeToken}: pin
 *      `algorithms` to the platform's asymmetric algs (rejects `alg:none`
 *      and any HS*), check `iss`/`aud`/`exp`/`typ === "bridge"`.
 *   3. Live re-check (§5 step 3, the cardinal rule) — {@link verifyBridgeTokenLive}:
 *      POST the token to `/plugin-api/v1/bridge/verify` and authorize against
 *      *that* response's current effective permissions, never the token's
 *      baked `permissions` claim.
 *   4. Webhook signature verification (§8) — {@link verifyWebhookSignature}.
 *
 * All base URLs are caller-supplied. This package hardcodes no host.
 */

import { createRemoteJWKSet, createLocalJWKSet, jwtVerify, errors as joseErrors, type JWK, type JWTVerifyGetKey } from 'jose';
import { createHmac, timingSafeEqual } from 'node:crypto';

// ===========================================================================
// Constants (must match contract 02 / _DESIGN-BRIEF.md exactly)
// ===========================================================================

/** The bridge token's `typ` discriminator (contract 02 §5). */
export const BRIDGE_TOKEN_TYP = 'bridge';

/**
 * Algorithms the platform is allowed to sign bridge tokens with (contract 02
 * §5 step 1: "asymmetric ES256/EdDSA"). Passed as the `algorithms` allowlist
 * to `jose.jwtVerify`, which rejects `alg:none` and every symmetric (HS*)
 * algorithm outright — this is the algorithm-confusion defense (RFC 8725).
 */
export const SUPPORTED_BRIDGE_ALGS = ['ES256', 'EdDSA'] as const;

/** Webhook replay-tolerance window (contract 02 §8: "±5 minutes"). */
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;

// ===========================================================================
// Errors
// ===========================================================================

export type BridgeTokenVerifyErrorCode =
  | 'MALFORMED'
  | 'INVALID_ALG'
  | 'BAD_SIGNATURE'
  | 'EXPIRED'
  | 'WRONG_ISSUER'
  | 'WRONG_AUDIENCE'
  | 'WRONG_TYPE'
  | 'JWKS_ERROR';

/** Thrown by {@link verifyBridgeToken} for every rejection path. */
export class BridgeTokenVerifyError extends Error {
  readonly code: BridgeTokenVerifyErrorCode;

  constructor(code: BridgeTokenVerifyErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'BridgeTokenVerifyError';
    this.code = code;
  }
}

export type WebhookVerifyErrorCode = 'MALFORMED_HEADERS' | 'BAD_SIGNATURE' | 'STALE_TIMESTAMP';

/** Thrown by {@link verifyWebhookSignature} for every rejection path. */
export class WebhookVerifyError extends Error {
  readonly code: WebhookVerifyErrorCode;

  constructor(code: WebhookVerifyErrorCode, message: string) {
    super(message);
    this.name = 'WebhookVerifyError';
    this.code = code;
  }
}

/** Thrown by {@link verifyBridgeTokenLive} when the `/bridge/verify` call itself fails. */
export class BridgeVerifyClientError extends Error {
  readonly status?: number;

  constructor(message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'BridgeVerifyClientError';
    this.status = options?.status;
  }
}

// ===========================================================================
// 1. JWKS resolution (contract 02 §5 step 1)
// ===========================================================================

/**
 * Resolve keys from the platform's live JWKS endpoint
 * (`GET /plugin-api/v1/.well-known/jwks.json`), caching by `kid` and only
 * re-fetching on an unknown `kid` (subject to `cooldownSeconds`, which also
 * rate-limits refetch attempts against a hostile/broken endpoint).
 */
export function createRemoteJwks(
  jwksUrl: string | URL,
  options?: { cooldownSeconds?: number; timeoutMs?: number },
): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUrl), {
    cooldownDuration: (options?.cooldownSeconds ?? 300) * 1000,
    timeoutDuration: options?.timeoutMs ?? 5000,
  });
}

/**
 * Resolve keys from a JWKS document already in hand (e.g. one fetched and
 * cached by your own infra, or `@eos/plugin-stub-kit`'s test JWKS in dev).
 */
export function createLocalJwks(jwks: { keys: JWK[] }): JWTVerifyGetKey {
  return createLocalJWKSet(jwks);
}

// ===========================================================================
// 2. Bridge-token verification (contract 02 §5 step 2)
// ===========================================================================

export interface BridgeTokenClaims {
  typ: 'bridge';
  iss: string;
  aud: string;
  sub: string;
  tenantId: string;
  pluginName: string;
  permissions: string[];
  iat: number;
  exp: number;
  jti?: string;
  [key: string]: unknown;
}

export interface VerifyBridgeTokenOptions {
  /** A jose key-resolution function — see {@link createRemoteJwks}/{@link createLocalJwks}. */
  jwks: JWTVerifyGetKey;
  /** Expected `iss` (the platform plugin issuer given to you at onboarding). */
  issuer: string;
  /** Expected `aud` — YOUR installationId. */
  installationId: string;
  /** Clock-skew tolerance for `exp`, in seconds. Default 0 — bridge tokens
   * are 5-minute-lived; keep this tight in production. */
  clockToleranceSeconds?: number;
}

function mapJoseError(err: unknown): BridgeTokenVerifyError {
  const message = err instanceof Error ? err.message : String(err);

  if (err instanceof joseErrors.JWTExpired) {
    return new BridgeTokenVerifyError('EXPIRED', message, { cause: err });
  }
  if (err instanceof joseErrors.JWTClaimValidationFailed) {
    if (err.claim === 'iss') return new BridgeTokenVerifyError('WRONG_ISSUER', message, { cause: err });
    if (err.claim === 'aud') return new BridgeTokenVerifyError('WRONG_AUDIENCE', message, { cause: err });
    return new BridgeTokenVerifyError('MALFORMED', message, { cause: err });
  }
  if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
    return new BridgeTokenVerifyError('BAD_SIGNATURE', message, { cause: err });
  }
  if (err instanceof joseErrors.JOSEAlgNotAllowed || err instanceof joseErrors.JWSInvalid) {
    return new BridgeTokenVerifyError('INVALID_ALG', message, { cause: err });
  }
  if (
    err instanceof joseErrors.JWKSNoMatchingKey ||
    err instanceof joseErrors.JWKSMultipleMatchingKeys ||
    err instanceof joseErrors.JWKSTimeout ||
    err instanceof joseErrors.JWKSInvalid
  ) {
    return new BridgeTokenVerifyError('JWKS_ERROR', message, { cause: err });
  }
  return new BridgeTokenVerifyError('MALFORMED', message, { cause: err });
}

/**
 * Verify a bridge identity token server-side (contract 02 §5 step 2 — your
 * backend MUST do this before any data decision).
 *
 * - Pins `algorithms` to {@link SUPPORTED_BRIDGE_ALGS} — rejects `alg:none`
 *   and any HS* algorithm-confusion attempt outright (RFC 8725).
 * - Verifies `iss`, `aud === installationId`, `exp`.
 * - Verifies the custom `typ === "bridge"` claim (rejects an access token
 *   presented here).
 *
 * Returns the verified claims on success. **Do not authorize against
 * `claims.permissions`** — it is a snapshot at issuance. Call
 * {@link verifyBridgeTokenLive} and authorize against its response (the
 * contract's cardinal rule, §1/§5 step 3).
 */
export async function verifyBridgeToken(token: string, options: VerifyBridgeTokenOptions): Promise<BridgeTokenClaims> {
  if (typeof token !== 'string' || token.split('.').length !== 3) {
    throw new BridgeTokenVerifyError('MALFORMED', 'Token is not a well-formed compact JWS (expected 3 dot-separated segments).');
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(token, options.jwks, {
      algorithms: [...SUPPORTED_BRIDGE_ALGS],
      issuer: options.issuer,
      audience: options.installationId,
      clockTolerance: options.clockToleranceSeconds ?? 0,
    }));
  } catch (err) {
    throw mapJoseError(err);
  }

  if (payload.typ !== BRIDGE_TOKEN_TYP) {
    throw new BridgeTokenVerifyError(
      'WRONG_TYPE',
      `Expected typ "bridge", got ${JSON.stringify(payload.typ)}. Do not accept an access token here.`,
    );
  }
  if (typeof payload.sub !== 'string' || typeof payload.tenantId !== 'string' || typeof payload.pluginName !== 'string') {
    throw new BridgeTokenVerifyError('MALFORMED', 'Token is missing required claims (sub/tenantId/pluginName).');
  }
  if (!Array.isArray(payload.permissions)) {
    throw new BridgeTokenVerifyError('MALFORMED', 'Token is missing the `permissions` claim array.');
  }

  return payload as BridgeTokenClaims;
}

// ===========================================================================
// 3. Live re-check (contract 02 §5 step 3 — the cardinal rule)
// ===========================================================================

export interface BridgeVerifyLiveResult {
  /** Whether the installation is currently active (not killed/suspended/uninstalled). */
  active: boolean;
  installationId: string;
  tenantId: string;
  userId: string;
  /** The user's CURRENT effective plugin permissions — authorize against this, not the token claim. */
  permissions: string[];
}

export interface BridgeVerifyClientConfig {
  /** Your platform API base, e.g. `https://<host>/plugin-api/v1` (contract Appendix). */
  baseUrl: string;
  /** Injectable for tests / non-global-fetch runtimes. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * POST `/plugin-api/v1/bridge/verify` (contract §5 step 3): re-checks live
 * installation/subscription/`jti`-revocation state and returns the user's
 * *current* effective permissions. This is what makes revocation and
 * permission changes take effect within minutes without a redeploy —
 * authorize against this response, never the token's baked claim.
 *
 * Decision (contract §5/§7 describe what this endpoint checks and returns in
 * prose — "current effective permissions" — but §7's worked JSON examples are
 * still pending per the contract's own provisional-surface note; logged in
 * STATUS.md "Decisions"): this client POSTs `{ "token": "<jwt>" }` and
 * expects back `{ active, installationId, tenantId, userId, permissions }`.
 */
export async function verifyBridgeTokenLive(token: string, config: BridgeVerifyClientConfig): Promise<BridgeVerifyLiveResult> {
  const doFetch = config.fetchImpl ?? fetch;
  const url = `${config.baseUrl.replace(/\/+$/, '')}/bridge/verify`;

  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  } catch (err) {
    throw new BridgeVerifyClientError(`bridge/verify request failed: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  }

  if (!res.ok) {
    throw new BridgeVerifyClientError(`bridge/verify returned HTTP ${res.status}`, { status: res.status });
  }

  const body = (await res.json()) as Partial<BridgeVerifyLiveResult>;
  if (typeof body.active !== 'boolean' || !Array.isArray(body.permissions)) {
    throw new BridgeVerifyClientError('bridge/verify response is missing required fields (active, permissions).');
  }

  return body as BridgeVerifyLiveResult;
}

// ===========================================================================
// 4. Webhook signature verification (contract 02 §8)
// ===========================================================================

export interface WebhookHeaders {
  /** Raw `X-EOS-Webhook-Signature` value, e.g. `"v1=<hex>"`. */
  signature: string;
  /** Raw `X-EOS-Webhook-Timestamp` value (unix seconds, as sent). */
  timestamp: string;
  /** Raw `X-EOS-Webhook-Id` value — the delivery id; also your dedupe/`Idempotency-Key`. */
  deliveryId: string;
  /** Raw `X-EOS-Webhook-Kid` value, if you need to select among rotated secrets. */
  kid?: string;
}

export interface VerifyWebhookOptions {
  /** Per-installation webhook signing secret (contract §8/§10). */
  secret: string;
  /** Replay tolerance, seconds. Default 300 (contract §8: "±5 minutes"). */
  toleranceSeconds?: number;
  /** Injectable clock for tests. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Build the exact string that is HMAC-SHA256 signed for a webhook delivery.
 *
 * contract §8 as amended 2026-07-19: the signed-content form is
 * `{deliveryId}.{timestamp}.{rawBody}` (Standard-Webhooks style), replacing
 * the contract text's originally-drafted `v1:{timestamp}.{rawBody}`. Header
 * names and the `v1=<hex>` signature encoding are UNCHANGED by this
 * amendment — only this signed-content assembly changed. `rawBody` must be
 * the exact raw request body bytes, not a re-serialized copy.
 */
export function buildWebhookSignedContent(deliveryId: string, timestamp: string, rawBody: string | Buffer): string {
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  return `${deliveryId}.${timestamp}.${body}`;
}

/** Compute the `v1=<hex>` signature value for a webhook delivery (contract §8 as amended 2026-07-19). */
export function computeWebhookSignature(secret: string, deliveryId: string, timestamp: string, rawBody: string | Buffer): string {
  const signedContent = buildWebhookSignedContent(deliveryId, timestamp, rawBody);
  return createHmac('sha256', secret).update(signedContent, 'utf8').digest('hex');
}

/**
 * Verify an inbound webhook delivery (contract §8, gate I): recompute the
 * HMAC over `{deliveryId}.{timestamp}.{rawBody}` (§8 as amended 2026-07-19),
 * constant-time-compare against `X-EOS-Webhook-Signature`, and reject a
 * timestamp outside the tolerance window (replay defense) — all BEFORE
 * acting on the payload. Throws {@link WebhookVerifyError} on any failure;
 * returns normally (`void`) on success.
 */
export function verifyWebhookSignature(rawBody: string | Buffer, headers: WebhookHeaders, options: VerifyWebhookOptions): void {
  const { secret, toleranceSeconds = WEBHOOK_SIGNATURE_TOLERANCE_SECONDS, now = () => Date.now() } = options;

  if (!headers.signature || !headers.timestamp || !headers.deliveryId) {
    throw new WebhookVerifyError('MALFORMED_HEADERS', 'Missing X-EOS-Webhook-Signature, -Timestamp, or -Id header.');
  }

  const match = /^v1=([0-9a-f]+)$/i.exec(headers.signature.trim());
  if (!match) {
    throw new WebhookVerifyError('MALFORMED_HEADERS', `X-EOS-Webhook-Signature is not in "v1=<hex>" form: ${headers.signature}`);
  }
  const providedHex = (match[1] ?? '').toLowerCase();

  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts)) {
    throw new WebhookVerifyError('MALFORMED_HEADERS', `X-EOS-Webhook-Timestamp is not a unix-seconds integer: ${headers.timestamp}`);
  }
  const nowSeconds = Math.floor(now() / 1000);
  if (Math.abs(nowSeconds - ts) > toleranceSeconds) {
    throw new WebhookVerifyError(
      'STALE_TIMESTAMP',
      `Webhook timestamp ${ts} is outside the ±${toleranceSeconds}s tolerance window (now=${nowSeconds}).`,
    );
  }

  const expectedHex = computeWebhookSignature(secret, headers.deliveryId, headers.timestamp, rawBody);
  const provided = Buffer.from(providedHex, 'hex');
  const expected = Buffer.from(expectedHex, 'hex');

  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new WebhookVerifyError('BAD_SIGNATURE', 'Webhook signature does not match the recomputed HMAC.');
  }
}
