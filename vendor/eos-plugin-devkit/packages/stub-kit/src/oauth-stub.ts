/**
 * @eos/plugin-stub-kit — local OAuth stub server (contract 02 §4, §5 step 3,
 * §13; Appendix endpoint quick reference).
 *
 * A standalone, in-memory implementation of the platform endpoints a
 * vendor's backend talks to before the real platform is available:
 *
 *   GET  /plugin-api/v1/oauth/authorize        — Authorization Code + PKCE (S256 only)
 *   POST /plugin-api/v1/oauth/token             — code+PKCE exchange, and rotating refresh
 *                                                 with reuse-detection -> family revoke
 *   GET  /plugin-api/v1/.well-known/jwks.json    — serves @eos/plugin-stub-kit's getTestJwks()
 *   POST /plugin-api/v1/bridge/verify            — fixture responder, contract §5 step 3 /
 *                                                  STATUS.md Decision #2 shape
 *   GET  /plugin-api/v1/{pluginName}/users       — demo scoped resource (contract §6's worked
 *                                                  example: envelope, pagination, error-code
 *                                                  taxonomy, plugin_revoked kill-switch signal)
 *                                                  so a vendor can exercise a real scoped API
 *                                                  call shape against this stub
 *
 * Access/bridge tokens are minted via this package's own `mintAccessToken`
 * (same test ES256 keypair `getTestJwks()` publishes) — no crypto is
 * reimplemented here beyond PKCE's S256 challenge/verifier check, which is
 * not signature verification and has no home in `@eos/plugin-verify`.
 *
 * In-memory only (dev stub): all state (auth codes, refresh-token families)
 * is scoped to one `createOAuthStubServer()` call and lost on close/restart
 * — never valid against the real platform. This file holds the reusable
 * server core (importable programmatically, e.g. from tests); the thin CLI
 * wrapper lives in `bin/oauth-stub.ts`.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { URL, URLSearchParams } from 'node:url';
import {
  getTestJwks,
  mintAccessToken,
  STUB_INSTALLATION_ID,
  STUB_PLUGIN_NAME,
  STUB_TENANT_ID,
  STUB_USER_ID,
} from './index.ts';

// ===========================================================================
// Config
// ===========================================================================

/** Same default bridge-permission fixture `index.ts` mints on an unconfigured
 * `mintBridgeToken()` call (kept as a literal here — that default is not
 * exported, this is a fixture-value duplication, not a crypto one). */
const DEFAULT_BRIDGE_PERMISSIONS = ['ext.stub.plugin.demo.read'];

const DEFAULT_CLIENT_ID = 'stub-client';
const DEFAULT_CLIENT_SECRET = 'stub-client-secret-do-not-use-in-prod';
const DEFAULT_SCOPE = ['tenant.read'];

/** Contract 02 §4: auth codes are single-use, 60 seconds. */
const DEFAULT_AUTH_CODE_TTL_SECONDS = 60;
/** Contract 02 §4: access token lifetime, 10 minutes. */
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 600;
/** Contract 02 §4: refresh token family, 30-day absolute lifetime. */
const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 30;

export interface OAuthStubServerOptions {
  /** Port to listen on. Default: 0 (OS-assigned ephemeral port — read back via the returned handle). */
  port?: number;
  /** Host to bind. Default: '127.0.0.1'. */
  host?: string;
  clientId?: string;
  clientSecret?: string;
  /**
   * Exact-match allowlist for `redirect_uri` (contract §4: "must exactly
   * match a manifest-registered HTTPS URI"). If omitted/empty, ANY
   * `redirect_uri` is accepted — a dev-stub convenience with no manifest to
   * register against; logged as a Decision in STATUS.md. Set this to
   * exercise the real exact-match rejection path.
   */
  redirectUris?: string[];
  installationId?: string;
  tenantId?: string;
  userId?: string;
  pluginName?: string;
  /** Bridge-token / bridge-verify permissions fixture. */
  permissions?: string[];
  /** Default granted scope when `/authorize` doesn't request one. */
  defaultScope?: string[];
  /**
   * Dev-stub leniency switch. Default `false` — Decision 6 in STATUS.md.
   * When `false` (the default), `POST /plugin-api/v1/oauth/token` strictly
   * enforces contract §4 (C11, amended 2026-07-19): `client_secret_basic`
   * (an `Authorization: Basic base64(client_id:client_secret)` header) and a
   * JSON request body — a non-Basic auth attempt or a non-JSON body is
   * rejected with a conformance error. Set `true` (CLI: `--lenient`) to
   * ADDITIONALLY accept `application/x-www-form-urlencoded` bodies and
   * body-embedded `client_id`/`client_secret` fields (RFC 6749 §4.1.3), for
   * testing against legacy/non-conforming clients only — never the default,
   * since it would otherwise mask a vendor building against a more
   * permissive shadow of the real contract.
   */
  lenient?: boolean;
  authCodeTtlSeconds?: number;
  accessTokenTtlSeconds?: number;
  refreshTokenTtlDays?: number;
  /** `bridge/verify`'s `active` fixture value — set false to simulate a
   * killed/suspended installation and test your revocation handling. */
  active?: boolean;
  log?: (msg: string) => void;
}

interface ResolvedConfig {
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
  installationId: string;
  tenantId: string;
  userId: string;
  pluginName: string;
  permissions: string[];
  defaultScope: string[];
  lenient: boolean;
  authCodeTtlSeconds: number;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  active: boolean;
  log: (msg: string) => void;
}

function resolveConfig(options: OAuthStubServerOptions): ResolvedConfig {
  return {
    clientId: options.clientId ?? DEFAULT_CLIENT_ID,
    clientSecret: options.clientSecret ?? DEFAULT_CLIENT_SECRET,
    redirectUris: options.redirectUris ?? [],
    installationId: options.installationId ?? STUB_INSTALLATION_ID,
    tenantId: options.tenantId ?? STUB_TENANT_ID,
    userId: options.userId ?? STUB_USER_ID,
    pluginName: options.pluginName ?? STUB_PLUGIN_NAME,
    permissions: options.permissions ?? DEFAULT_BRIDGE_PERMISSIONS,
    defaultScope: options.defaultScope ?? DEFAULT_SCOPE,
    lenient: options.lenient ?? false,
    authCodeTtlSeconds: options.authCodeTtlSeconds ?? DEFAULT_AUTH_CODE_TTL_SECONDS,
    accessTokenTtlSeconds: options.accessTokenTtlSeconds ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlDays: options.refreshTokenTtlDays ?? DEFAULT_REFRESH_TOKEN_TTL_DAYS,
    active: options.active ?? true,
    log: options.log ?? (() => {}),
  };
}

// ===========================================================================
// In-memory state — one instance per `createOAuthStubServer()` call (never
// module-level: multiple stub servers, e.g. in a test suite, must not share
// auth codes / refresh-token families).
// ===========================================================================

interface AuthCodeRecord {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string[];
  expiresAt: number;
}

interface RefreshTokenRecord {
  familyId: string;
  clientId: string;
  scope: string[];
  absoluteExpiresAt: number;
  /** Rotated out (exchanged for a newer token) — reuse of this token is now an attack signal. */
  rotatedOut: boolean;
  /** Whole family revoked (set on first detected reuse of a rotated-out token). */
  revoked: boolean;
}

interface OAuthStubStore {
  authCodes: Map<string, AuthCodeRecord>;
  refreshTokens: Map<string, RefreshTokenRecord>;
}

function createStore(): OAuthStubStore {
  return { authCodes: new Map(), refreshTokens: new Map() };
}

function base64url(input: Buffer): string {
  return input.toString('base64url');
}

/** PKCE S256: `code_challenge == BASE64URL(SHA256(code_verifier))` (RFC 7636 §4.6). */
function pkceS256Matches(codeVerifier: string, codeChallenge: string): boolean {
  const computed = base64url(createHash('sha256').update(codeVerifier, 'ascii').digest());
  return computed === codeChallenge;
}

// ===========================================================================
// HTTP plumbing
// ===========================================================================

interface JsonResponse {
  status: number;
  body: unknown;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

function oauthError(status: number, error: string, description: string): JsonResponse {
  return { status, body: { error, error_description: description } };
}

// ===========================================================================
// Route handlers
// ===========================================================================

function handleAuthorize(url: URL, cfg: ResolvedConfig, store: OAuthStubStore, res: ServerResponse): void {
  const q = url.searchParams;
  const clientId = q.get('client_id');
  const redirectUri = q.get('redirect_uri');
  const responseType = q.get('response_type');
  const scopeParam = q.get('scope');
  const state = q.get('state');
  const codeChallenge = q.get('code_challenge');
  const codeChallengeMethod = q.get('code_challenge_method');

  // A redirect_uri we cannot trust must NOT receive a redirect at all
  // (OAuth security BCP) — every failure below this point responds inline.
  if (!redirectUri) {
    sendJson(res, 400, { error: 'invalid_request', error_description: 'Missing redirect_uri' });
    return;
  }
  if (cfg.redirectUris.length > 0 && !cfg.redirectUris.includes(redirectUri)) {
    sendJson(res, 400, {
      error: 'invalid_request',
      error_description: 'redirect_uri is not in the configured allowlist (exact-match required)',
    });
    return;
  }
  if (!clientId || clientId !== cfg.clientId) {
    sendJson(res, 400, { error: 'invalid_client', error_description: 'Unknown client_id' });
    return;
  }

  // From here on, redirect_uri is trusted — redirect errors back to it (RFC 6749 §4.1.2.1).
  const redirectWithError = (error: string, description: string): void => {
    const target = new URL(redirectUri);
    target.searchParams.set('error', error);
    target.searchParams.set('error_description', description);
    if (state) target.searchParams.set('state', state);
    res.writeHead(302, { location: target.toString() });
    res.end();
  };

  if (!state) {
    // Contract §4: "state is mandatory".
    redirectWithError('invalid_request', 'state is mandatory');
    return;
  }
  if (responseType !== 'code') {
    redirectWithError('unsupported_response_type', 'Only response_type=code is supported');
    return;
  }
  if (!codeChallenge) {
    redirectWithError('invalid_request', 'code_challenge is required (PKCE)');
    return;
  }
  if (codeChallengeMethod !== 'S256') {
    // PKCE S256 only (task requirement; contract §4/§9 requires PKCE and
    // does not call out the legacy "plain" method, so this stub does not
    // accept it).
    redirectWithError('invalid_request', 'code_challenge_method must be S256');
    return;
  }

  const scope = scopeParam ? scopeParam.split(/\s+/).filter(Boolean) : cfg.defaultScope;
  const code = `code_${randomUUID()}`;
  store.authCodes.set(code, {
    clientId,
    redirectUri,
    codeChallenge,
    scope,
    expiresAt: Date.now() + cfg.authCodeTtlSeconds * 1000,
  });

  // Dev-stub auto-approval: no interactive tenant-admin login/consent screen
  // (that screen is EOS-hosted per contract §3 and out of scope for a local
  // stub) — immediately redirect back with `code` + `state`.
  const target = new URL(redirectUri);
  target.searchParams.set('code', code);
  target.searchParams.set('state', state);
  res.writeHead(302, { location: target.toString() });
  res.end();
}

function revokeFamily(store: OAuthStubStore, familyId: string): void {
  for (const record of store.refreshTokens.values()) {
    if (record.familyId === familyId) record.revoked = true;
  }
}

async function mintTokenPair(
  cfg: ResolvedConfig,
  store: OAuthStubStore,
  scope: string[],
  familyId: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = await mintAccessToken({
    installationId: cfg.installationId,
    scope,
    ttlSeconds: cfg.accessTokenTtlSeconds,
  });
  const refreshToken = `rt_${base64url(randomBytes(32))}`;
  const absoluteExpiresAt = Date.now() + cfg.refreshTokenTtlDays * 24 * 60 * 60 * 1000;
  store.refreshTokens.set(refreshToken, {
    familyId,
    clientId: cfg.clientId,
    scope,
    absoluteExpiresAt,
    rotatedOut: false,
    revoked: false,
  });
  return { accessToken, refreshToken };
}

async function handleAuthorizationCodeGrant(
  params: URLSearchParams,
  cfg: ResolvedConfig,
  store: OAuthStubStore,
): Promise<JsonResponse> {
  const code = params.get('code');
  const redirectUri = params.get('redirect_uri');
  const codeVerifier = params.get('code_verifier');

  if (!code || !redirectUri || !codeVerifier) {
    return oauthError(400, 'invalid_request', 'code, redirect_uri, and code_verifier are all required');
  }

  const record = store.authCodes.get(code);
  // Single-use: consume it now regardless of outcome below, so a retried
  // request with the same code can never succeed twice.
  store.authCodes.delete(code);

  if (!record || record.expiresAt < Date.now()) {
    return oauthError(400, 'invalid_grant', 'Unknown, expired, or already-consumed authorization code');
  }
  if (record.redirectUri !== redirectUri) {
    return oauthError(400, 'invalid_grant', 'redirect_uri does not match the one used at /authorize');
  }
  if (!pkceS256Matches(codeVerifier, record.codeChallenge)) {
    return oauthError(400, 'invalid_grant', 'code_verifier does not match code_challenge (PKCE S256 check failed)');
  }

  const familyId = randomUUID();
  const { accessToken, refreshToken } = await mintTokenPair(cfg, store, record.scope, familyId);

  return {
    status: 200,
    body: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: cfg.accessTokenTtlSeconds,
      refresh_token: refreshToken,
      scope: record.scope.join(' '),
    },
  };
}

async function handleRefreshTokenGrant(
  params: URLSearchParams,
  cfg: ResolvedConfig,
  store: OAuthStubStore,
): Promise<JsonResponse> {
  const refreshToken = params.get('refresh_token');
  if (!refreshToken) {
    return oauthError(400, 'invalid_request', 'refresh_token is required');
  }

  const record = store.refreshTokens.get(refreshToken);
  if (!record) {
    return oauthError(400, 'invalid_grant', 'Unknown refresh token');
  }

  if (record.rotatedOut || record.revoked) {
    // Reuse of an already-rotated (or already-revoked) refresh token:
    // revoke the WHOLE family (contract §4: "reusing a rotated (old) refresh
    // token revokes the whole family"), including the current newest token.
    revokeFamily(store, record.familyId);
    return oauthError(400, 'invalid_grant', 'Refresh token reuse detected — the entire token family has been revoked');
  }

  if (record.absoluteExpiresAt < Date.now()) {
    return oauthError(400, 'invalid_grant', 'Refresh token family has exceeded its 30-day absolute lifetime');
  }

  if (!cfg.active) {
    // Contract §4: "Every rotation re-checks live installation state and refuses if inactive."
    return oauthError(400, 'invalid_grant', 'Installation is not active');
  }

  // Rotate: mark this token consumed, mint a fresh pair in the same family.
  record.rotatedOut = true;
  const { accessToken, refreshToken: newRefreshToken } = await mintTokenPair(cfg, store, record.scope, record.familyId);

  return {
    status: 200,
    body: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: cfg.accessTokenTtlSeconds,
      refresh_token: newRefreshToken,
      scope: record.scope.join(' '),
    },
  };
}

/**
 * Decision 6 (logged in STATUS.md "Decisions", 2026-07-19): the contract's
 * canonical token request (§4 C11, amended 2026-07-19) is
 * `client_secret_basic` — an `Authorization: Basic
 * base64(client_id:client_secret)` header — with a JSON body. By DEFAULT
 * (`cfg.lenient === false`) this stub enforces exactly that and rejects
 * both a non-JSON body and body-embedded client credentials with a
 * conformance error, so a vendor building against this stub is honestly
 * tested against the real contract rather than a more permissive shadow of
 * it. Pass `--lenient` (CLI) / `{ lenient: true }` (programmatic) to
 * ADDITIONALLY accept `application/x-www-form-urlencoded` bodies and
 * body-embedded `client_id`/`client_secret` fields (RFC 6749 §4.1.3) — for
 * testing against legacy/non-conforming clients only, never the default.
 * The JSON success-response `scope` is a space-delimited string (RFC 6749
 * §5.1) — distinct from the access token JWT's own `scope` claim, which
 * STATUS.md Decision #3 already fixed as an array; these are two different
 * layers and are allowed to differ.
 */
async function handleToken(req: IncomingMessage, cfg: ResolvedConfig, store: OAuthStubStore): Promise<JsonResponse> {
  const rawBody = await readBody(req);
  const contentType = req.headers['content-type'] ?? '';
  const isJson = contentType.includes('application/json');

  let params: URLSearchParams;
  if (isJson) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return oauthError(400, 'invalid_request', 'Malformed JSON body');
    }
    params = new URLSearchParams();
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') params.set(key, value);
    }
  } else if (cfg.lenient) {
    params = new URLSearchParams(rawBody);
  } else {
    return oauthError(
      400,
      'invalid_request',
      'Contract 02 §4 (C11) requires a JSON request body (Content-Type: application/json) for ' +
        '/plugin-api/v1/oauth/token — application/x-www-form-urlencoded is not accepted. Start the stub with ' +
        '--lenient (or { lenient: true }) to relax this for legacy-client testing.',
    );
  }

  const grantType = params.get('grant_type');

  // client_secret_basic (the contract's canonical, and by-default ONLY
  // accepted, form). Body-embedded credentials are only honored in lenient mode.
  let clientId: string | null;
  let clientSecret: string | null;
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice('Basic '.length), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    clientId = sep >= 0 ? decoded.slice(0, sep) : decoded;
    clientSecret = sep >= 0 ? decoded.slice(sep + 1) : null;
  } else if (cfg.lenient) {
    clientId = params.get('client_id');
    clientSecret = params.get('client_secret');
  } else {
    return oauthError(
      401,
      'invalid_client',
      'Contract 02 §4 (C11) requires client_secret_basic — an "Authorization: Basic base64(client_id:client_secret)" ' +
        'header. Body-embedded client credentials are not accepted. Start the stub with --lenient ' +
        '(or { lenient: true }) to relax this for legacy-client testing.',
    );
  }

  if (clientId !== cfg.clientId || clientSecret !== cfg.clientSecret) {
    return oauthError(401, 'invalid_client', 'Unknown client_id/client_secret');
  }

  if (grantType === 'authorization_code') {
    return handleAuthorizationCodeGrant(params, cfg, store);
  }
  if (grantType === 'refresh_token') {
    return handleRefreshTokenGrant(params, cfg, store);
  }
  return oauthError(400, 'unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
}

async function handleJwks(res: ServerResponse): Promise<void> {
  const jwks = await getTestJwks();
  sendJson(res, 200, jwks);
}

/**
 * Decodes the bridge/access token's payload segment WITHOUT verifying its
 * signature. That is correct here (and only here): this stub server is the
 * same authority that MINTED the token via `getTestJwks()`'s keypair, so
 * there is nothing to authenticate against itself — it is standing in for
 * the platform's own `bridge/verify`, whose job (contract §5 step 3) is to
 * report *current* live state given whatever the token claims about
 * identity, not to re-derive trust in the token's signature.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const json = Buffer.from(parts[1] as string, 'base64url').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function handleBridgeVerify(req: IncomingMessage, cfg: ResolvedConfig, res: ServerResponse): Promise<void> {
  const rawBody = await readBody(req);
  let parsed: { token?: unknown };
  try {
    parsed = JSON.parse(rawBody) as { token?: unknown };
  } catch {
    sendJson(res, 400, { error: 'invalid_request', error_description: 'Malformed JSON body' });
    return;
  }
  if (typeof parsed.token !== 'string') {
    sendJson(res, 400, { error: 'invalid_request', error_description: '"token" (string) is required' });
    return;
  }

  const claims = decodeJwtPayload(parsed.token);
  const installationId = (claims?.aud as string | undefined) ?? cfg.installationId;

  if (!cfg.active) {
    // Contract §5's worked example for a killed/uninstalled/inactive
    // installation: installationId is still reported (so a caller knows
    // WHICH installation is inactive) but tenantId/userId/permissions are
    // blanked — never leak live identity/permission data for an inactive
    // installation.
    sendJson(res, 200, { active: false, installationId, tenantId: '', userId: '', permissions: [] });
    return;
  }

  // STATUS.md Decision #2 shape: { active, installationId, tenantId, userId, permissions }.
  sendJson(res, 200, {
    active: true,
    installationId,
    tenantId: (claims?.tenantId as string | undefined) ?? cfg.tenantId,
    userId: (claims?.sub as string | undefined) ?? cfg.userId,
    permissions: cfg.permissions,
  });
}

// ===========================================================================
// Demo scoped resource — GET /plugin-api/v1/{pluginName}/users (contract §6)
// ===========================================================================

/** Scope the demo `users` resource requires (contract §7's Users row). */
export const DEMO_USERS_REQUIRED_SCOPE = 'users.read';

/** §6 sanitized error envelope: `{ error: { code, message, requestId } }`. */
function sendApiError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message, requestId: `req_${randomUUID()}` } });
}

/** Three fixture users; the first is the configured fixture userId so the
 * bridge/verify `userId` resolves to a row here, like it would for real. */
function demoUsers(cfg: ResolvedConfig): Array<Record<string, unknown>> {
  return [cfg.userId, 'user_stub_test_0002', 'user_stub_test_0003'].map((id, i) => ({
    id,
    name: ['Jordan Alvarez', 'Sam Whitfield', 'Riley Chen'][i],
    // PII fields are present in the shape but null — this stub does not
    // model the sensitive tier, matching §6's worked example exactly.
    email: null,
    phone: null,
    photoUrl: `https://cdn.eos.example/avatars/${id}.png`,
    active: true,
  }));
}

/**
 * A demo scoped resource so a vendor can exercise the full §6 call shape
 * (Bearer token, scope gating, envelope, cursor pagination, error-code
 * taxonomy incl. the C15 `plugin_revoked` kill-switch signal) against this
 * stub. Mirrors the contract's `GET /plugin-api/v1/dive/users` worked
 * example. Token checks decode-without-signature-verify for the same reason
 * `handleBridgeVerify` does: this stub IS the authority that minted the
 * token (see {@link decodeJwtPayload}'s doc comment).
 */
function handleScopedUsers(req: IncomingMessage, url: URL, pathPluginName: string, cfg: ResolvedConfig, res: ServerResponse): void {
  const auth = req.headers.authorization ?? '';
  const bearer = /^Bearer\s+(.+)$/i.exec(auth);
  if (!bearer) {
    sendApiError(res, 401, 'invalid_token', 'Access token missing.');
    return;
  }
  const claims = decodeJwtPayload(bearer[1] as string);
  if (!claims || claims.typ !== 'access') {
    sendApiError(res, 401, 'invalid_token', 'Access token malformed (or not an access token).');
    return;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) {
    sendApiError(res, 401, 'invalid_token', 'Access token expired.');
    return;
  }
  if (claims.aud !== cfg.installationId) {
    sendApiError(res, 401, 'invalid_token', 'Access token audience does not match this installation.');
    return;
  }
  if (!cfg.active) {
    // Contract §6 C15: the distinguishable kill-switch signal.
    sendApiError(res, 401, 'plugin_revoked', 'The installation has been kill-switched, paused, or uninstalled.');
    return;
  }
  if (pathPluginName !== cfg.pluginName) {
    // "A token for plugin X can only address plugin X's resources" — and a
    // non-owned resource is a 404, never a 403 (§6's BOLA note).
    sendApiError(res, 404, 'not_found', 'Resource id does not resolve within your installation\'s tenant scope.');
    return;
  }
  const scope = Array.isArray(claims.scope) ? (claims.scope as unknown[]) : [];
  if (!scope.includes(DEMO_USERS_REQUIRED_SCOPE)) {
    sendApiError(res, 403, 'forbidden_scope', `Your access token does not include the '${DEMO_USERS_REQUIRED_SCOPE}' scope.`);
    return;
  }

  // Cursor pagination (§6: default 25, hard cap 100, limit above the cap is
  // silently clamped; cursor is opaque — this stub's happens to be
  // base64url({"offset":n}), same as the contract's illustration).
  const limitRaw = Number(url.searchParams.get('limit') ?? '25');
  const limit = Math.min(Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.floor(limitRaw) : 25, 100);
  let offset = 0;
  const cursor = url.searchParams.get('cursor');
  if (cursor !== null) {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset?: unknown };
      if (typeof parsed.offset !== 'number' || parsed.offset < 0) throw new Error('bad cursor');
      offset = Math.floor(parsed.offset);
    } catch {
      sendApiError(res, 400, 'invalid_request', 'Malformed cursor — pass back exactly the nextCursor you were given.');
      return;
    }
  }

  const all = demoUsers(cfg);
  const page = all.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  const hasMore = nextOffset < all.length;
  sendJson(res, 200, {
    data: page,
    pageInfo: {
      nextCursor: hasMore ? Buffer.from(JSON.stringify({ offset: nextOffset }), 'utf8').toString('base64url') : null,
      hasMore,
    },
  });
}

// ===========================================================================
// Server lifecycle
// ===========================================================================

export interface OAuthStubServerHandle {
  server: http.Server;
  /** e.g. `http://127.0.0.1:54321` — the bare origin, no path suffix. */
  baseUrl: string;
  /** `${baseUrl}/plugin-api/v1` — matches every `BridgeVerifyClientConfig.baseUrl` / JWKS-url shape the rest of the kit expects. */
  pluginApiBaseUrl: string;
  port: number;
  close(): Promise<void>;
}

export const AUTHORIZE_PATH = '/plugin-api/v1/oauth/authorize';
export const TOKEN_PATH = '/plugin-api/v1/oauth/token';
export const JWKS_PATH = '/plugin-api/v1/.well-known/jwks.json';
export const BRIDGE_VERIFY_PATH = '/plugin-api/v1/bridge/verify';

/** Start the local OAuth stub server. Resolves once it is listening. Each
 * call gets its own isolated in-memory store (auth codes + refresh-token
 * families) — independent server instances never share state. */
export function createOAuthStubServer(options: OAuthStubServerOptions = {}): Promise<OAuthStubServerHandle> {
  const cfg = resolveConfig(options);
  const store = createStore();

  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://stub-oauth.invalid');

    void (async () => {
      try {
        if (method === 'GET' && url.pathname === AUTHORIZE_PATH) {
          handleAuthorize(url, cfg, store, res);
          return;
        }
        if (method === 'POST' && url.pathname === TOKEN_PATH) {
          const result = await handleToken(req, cfg, store);
          sendJson(res, result.status, result.body);
          return;
        }
        if (method === 'GET' && url.pathname === JWKS_PATH) {
          await handleJwks(res);
          return;
        }
        if (method === 'POST' && url.pathname === BRIDGE_VERIFY_PATH) {
          await handleBridgeVerify(req, cfg, res);
          return;
        }
        const scopedUsers = /^\/plugin-api\/v1\/([^/]+)\/users$/.exec(url.pathname);
        if (method === 'GET' && scopedUsers && scopedUsers[1] !== 'oauth' && scopedUsers[1] !== 'bridge') {
          handleScopedUsers(req, url, scopedUsers[1] as string, cfg, res);
          return;
        }
        sendJson(res, 404, { error: 'not_found', error_description: `No route for ${method} ${url.pathname}` });
      } catch (err) {
        cfg.log(`[eos-oauth-stub] unhandled error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
        sendJson(res, 500, { error: 'server_error', error_description: 'stub server internal error' });
      }
    })();
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Failed to determine listening port'));
        return;
      }
      const host = options.host ?? '127.0.0.1';
      const baseUrl = `http://${host}:${address.port}`;
      cfg.log(`[eos-oauth-stub] listening at ${baseUrl}`);
      resolve({
        server,
        baseUrl,
        pluginApiBaseUrl: `${baseUrl}/plugin-api/v1`,
        port: address.port,
        close: () => new Promise((res2, rej2) => server.close((err) => (err ? rej2(err) : res2()))),
      });
    });
  });
}
