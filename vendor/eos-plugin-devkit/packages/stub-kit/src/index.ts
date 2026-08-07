/**
 * @eos/plugin-stub-kit — pre-availability dev-kit tooling (contract 02 §13).
 *
 * "Sample tokens + test signing keys": a process-local ES256 test keypair,
 * its JWKS document (the shape `GET /plugin-api/v1/.well-known/jwks.json`
 * returns), and mint functions for sample **bridge** and **access** tokens —
 * including the negative fixtures a conforming `verifyBridgeToken()` (see
 * `@eos/plugin-verify`) MUST reject: `alg:none`, algorithm-confusion
 * (HS256), expired, wrong audience, wrong issuer, wrong `typ`, bad
 * signature, and tampered payload.
 *
 * Test keys are generated fresh per process (never persisted to disk, never
 * checked in) and are clearly non-production — they are never valid against
 * the real platform, whose keys are KMS-held and published on its own JWKS
 * endpoint.
 *
 * This module only mints tokens and fixtures. The package's other two
 * concerns live in their own modules: the webhook simulator
 * (`./webhook-sim.ts`, CLI in `./bin/webhook-sim.ts`) and the local OAuth
 * stub server (`./oauth-stub.ts`, CLI in `./bin/oauth-stub.ts`).
 */

import { generateKeyPair, exportJWK, SignJWT, type JWK, type KeyLike } from 'jose';
import { randomUUID } from 'node:crypto';

// ===========================================================================
// Test signing key
// ===========================================================================

/** Algorithm the test key is generated for. The real platform signs with
 * ES256 or EdDSA (contract 02 §5 step 1); ES256 is the one exercised here. */
export const TEST_KEY_ALG = 'ES256' as const;

/** Obviously-non-production issuer used on every sample token. */
export const STUB_ISSUER = 'https://stub.eos-plugin-devkit.test/plugin-issuer';

/** Default sample identity/scope values, overridable per mint call. */
export const STUB_INSTALLATION_ID = 'inst_stub_test_0001';
export const STUB_TENANT_ID = 'tenant_stub_test_0001';
export const STUB_PLUGIN_NAME = 'stub-plugin';
export const STUB_USER_ID = 'user_stub_test_0001';

export interface TestKeyset {
  kid: string;
  alg: typeof TEST_KEY_ALG;
  privateKey: KeyLike;
  publicJwk: JWK;
}

let cachedKeyset: Promise<TestKeyset> | undefined;

/**
 * Generate (or return the process-cached) ES256 test keypair. Regenerated
 * every process run — there is no long-lived test private key on disk to
 * ever mistake for a real secret.
 */
export async function getTestKeyset(): Promise<TestKeyset> {
  if (!cachedKeyset) {
    cachedKeyset = (async () => {
      const { publicKey, privateKey } = await generateKeyPair(TEST_KEY_ALG, { extractable: true });
      const kid = `stub-${randomUUID()}`;
      const publicJwk = await exportJWK(publicKey);
      publicJwk.kid = kid;
      publicJwk.alg = TEST_KEY_ALG;
      publicJwk.use = 'sig';
      return { kid, alg: TEST_KEY_ALG, privateKey, publicJwk };
    })();
  }
  return cachedKeyset;
}

/**
 * The JWKS document a vendor's JWKS resolver would fetch from
 * `GET /plugin-api/v1/.well-known/jwks.json` — public key only.
 */
export async function getTestJwks(): Promise<{ keys: JWK[] }> {
  const { publicJwk } = await getTestKeyset();
  return { keys: [publicJwk] };
}

// ===========================================================================
// Sample bridge token (contract 02 §5)
// ===========================================================================

export interface BridgeTokenClaimsInput {
  installationId?: string;
  tenantId?: string;
  pluginName?: string;
  userId?: string;
  permissions?: string[];
  issuer?: string;
  /** Seconds. Default 300 (the contract's fixed 5-minute bridge TTL). */
  ttlSeconds?: number;
  /** Unix seconds. Default: now. */
  issuedAt?: number;
  jti?: string;
}

const DEFAULT_PERMISSIONS = ['ext.stub.plugin.demo.read'];

/** Mint a validly-signed sample bridge token matching contract 02 §5's claim shape. */
export async function mintBridgeToken(options: BridgeTokenClaimsInput = {}): Promise<string> {
  const { privateKey, kid } = await getTestKeyset();
  const now = options.issuedAt ?? Math.floor(Date.now() / 1000);
  const ttl = options.ttlSeconds ?? 300;
  const payload = {
    typ: 'bridge',
    iss: options.issuer ?? STUB_ISSUER,
    aud: options.installationId ?? STUB_INSTALLATION_ID,
    sub: options.userId ?? STUB_USER_ID,
    tenantId: options.tenantId ?? STUB_TENANT_ID,
    pluginName: options.pluginName ?? STUB_PLUGIN_NAME,
    permissions: options.permissions ?? DEFAULT_PERMISSIONS,
    iat: now,
    exp: now + ttl,
    jti: options.jti ?? randomUUID(),
  };
  return new SignJWT(payload).setProtectedHeader({ alg: TEST_KEY_ALG, kid }).sign(privateKey);
}

// ===========================================================================
// Sample OAuth access token (contract 02 §4)
// ===========================================================================

export interface AccessTokenClaimsInput {
  installationId?: string;
  scope?: string[];
  issuer?: string;
  /** Seconds. Default 600 (the contract's fixed 10-minute access-token TTL). */
  ttlSeconds?: number;
  issuedAt?: number;
  jti?: string;
}

/**
 * Mint a validly-signed sample OAuth2 access token.
 *
 * Decision (contract §4 fixes the lifetime and `aud = installationId` but
 * does not publish a full claim shape — logged in STATUS.md "Decisions"):
 * sample access tokens carry `typ:"access"` (mirroring the bridge token's
 * `typ` discriminator so a verifier can tell the two apart) and a `scope`
 * array reflecting §4's granted-scope semantics.
 */
export async function mintAccessToken(options: AccessTokenClaimsInput = {}): Promise<string> {
  const { privateKey, kid } = await getTestKeyset();
  const now = options.issuedAt ?? Math.floor(Date.now() / 1000);
  const ttl = options.ttlSeconds ?? 600;
  const payload = {
    typ: 'access',
    iss: options.issuer ?? STUB_ISSUER,
    aud: options.installationId ?? STUB_INSTALLATION_ID,
    scope: options.scope ?? ['tenant.read'],
    iat: now,
    exp: now + ttl,
    jti: options.jti ?? randomUUID(),
  };
  return new SignJWT(payload).setProtectedHeader({ alg: TEST_KEY_ALG, kid }).sign(privateKey);
}

// ===========================================================================
// Negative fixtures (contract 02 §13 + this pass's required list)
// ===========================================================================

export type BridgeNegativeFixtureName =
  | 'algNone'
  | 'wrongAlg'
  | 'expired'
  | 'wrongAudience'
  | 'wrongIssuer'
  | 'wrongTyp'
  | 'badSignature'
  | 'tamperedPayload';

export interface BridgeNegativeFixture {
  name: BridgeNegativeFixtureName;
  /** Which contract 02 §5 step-2/3 check this fixture is meant to trip. */
  description: string;
  token: string;
}

function encodeSegment(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

/**
 * Mint every negative bridge-token fixture a conforming `verifyBridgeToken()`
 * must reject. Each is a real, otherwise well-formed JWT — same claim shape
 * as {@link mintBridgeToken} — with exactly one thing wrong.
 */
export async function mintBridgeNegativeFixtures(
  base: BridgeTokenClaimsInput = {},
): Promise<BridgeNegativeFixture[]> {
  const { privateKey, kid } = await getTestKeyset();
  const now = Math.floor(Date.now() / 1000);
  const installationId = base.installationId ?? STUB_INSTALLATION_ID;
  const issuer = base.issuer ?? STUB_ISSUER;
  const claimsBase = {
    tenantId: base.tenantId ?? STUB_TENANT_ID,
    pluginName: base.pluginName ?? STUB_PLUGIN_NAME,
    permissions: base.permissions ?? DEFAULT_PERMISSIONS,
  };

  // alg:none — RFC 7519 "Unsecured JWT": header alg:none, empty signature
  // segment. Must be rejected before any signature check is even attempted.
  const algNoneHeader = encodeSegment({ alg: 'none', typ: 'JWT' });
  const algNonePayload = encodeSegment({
    typ: 'bridge',
    iss: issuer,
    aud: installationId,
    sub: base.userId ?? STUB_USER_ID,
    iat: now,
    exp: now + 300,
    ...claimsBase,
  });
  const algNone = `${algNoneHeader}.${algNonePayload}.`;

  // wrongAlg — algorithm-confusion attempt (RFC 8725 §3.1): HMAC-signed with
  // an attacker-controlled secret, carrying the real key's `kid` so a
  // verifier that resolves the key by `kid` alone (without pinning
  // `algorithms` to the platform's real asymmetric algs) could be fooled
  // into treating the EC public key material as an HMAC secret.
  const wrongAlgSecret = new TextEncoder().encode('attacker-controlled-hmac-secret-do-not-trust');
  const wrongAlg = await new SignJWT({
    typ: 'bridge',
    iss: issuer,
    aud: installationId,
    sub: base.userId ?? STUB_USER_ID,
    iat: now,
    exp: now + 300,
    ...claimsBase,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid })
    .sign(wrongAlgSecret);

  const expired = await mintBridgeToken({ ...base, issuedAt: now - 3600, ttlSeconds: 1800 }); // expired 30 min ago

  const wrongAudience = await mintBridgeToken({ ...base, installationId: 'inst_some_other_installation' });

  const wrongIssuer = await mintBridgeToken({ ...base, issuer: 'https://not-the-real-issuer.example' });

  const wrongTyp = await new SignJWT({
    typ: 'access', // an access token presented where a bridge token is required
    iss: issuer,
    aud: installationId,
    sub: base.userId ?? STUB_USER_ID,
    iat: now,
    exp: now + 300,
    ...claimsBase,
  })
    .setProtectedHeader({ alg: TEST_KEY_ALG, kid })
    .sign(privateKey);

  // badSignature — correct `kid` (so JWKS key lookup succeeds and isolates
  // this from an "unknown kid" failure), but signed by a DIFFERENT ES256
  // keypair, so the cryptographic verification itself must fail.
  const { privateKey: otherPrivateKey } = await generateKeyPair(TEST_KEY_ALG, { extractable: true });
  const badSignature = await new SignJWT({
    typ: 'bridge',
    iss: issuer,
    aud: installationId,
    sub: base.userId ?? STUB_USER_ID,
    iat: now,
    exp: now + 300,
    ...claimsBase,
  })
    .setProtectedHeader({ alg: TEST_KEY_ALG, kid })
    .sign(otherPrivateKey);

  // tamperedPayload — start from a validly signed token, then swap the
  // payload segment for one with an escalated `permissions` claim WITHOUT
  // re-signing. The original signature no longer matches the new payload.
  const valid = await mintBridgeToken({ ...base, issuedAt: now, ttlSeconds: 300 });
  const [validHeader, , validSignature] = valid.split('.');
  const tamperedPayloadSegment = encodeSegment({
    typ: 'bridge',
    iss: issuer,
    aud: installationId,
    sub: base.userId ?? STUB_USER_ID,
    iat: now,
    exp: now + 300,
    ...claimsBase,
    permissions: ['ext.stub.plugin.admin.everything'],
  });
  const tamperedPayload = `${validHeader}.${tamperedPayloadSegment}.${validSignature}`;

  return [
    {
      name: 'algNone',
      description: 'header alg:none, empty signature — must be rejected before any signature check (RFC 8725 §3.1).',
      token: algNone,
    },
    {
      name: 'wrongAlg',
      description: 'HS256 algorithm-confusion attempt; must be rejected by pinning `algorithms` to ES256/EdDSA.',
      token: wrongAlg,
    },
    { name: 'expired', description: '`exp` in the past.', token: expired },
    { name: 'wrongAudience', description: '`aud` != the caller\'s installationId.', token: wrongAudience },
    { name: 'wrongIssuer', description: '`iss` != the expected platform issuer.', token: wrongIssuer },
    {
      name: 'wrongTyp',
      description: '`typ:"access"` presented where `typ:"bridge"` is required (contract 02 §5 step 2).',
      token: wrongTyp,
    },
    { name: 'badSignature', description: 'correct `kid`, but signed by a different keypair.', token: badSignature },
    {
      name: 'tamperedPayload',
      description: 'validly signed token with the payload swapped post-signature.',
      token: tamperedPayload,
    },
  ];
}
