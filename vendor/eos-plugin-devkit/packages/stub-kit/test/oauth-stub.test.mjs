import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createOAuthStubServer } from '@eos/plugin-stub-kit/oauth-stub';
import { mintBridgeToken, STUB_INSTALLATION_ID, STUB_TENANT_ID, STUB_USER_ID } from '@eos/plugin-stub-kit';
import { verifyBridgeTokenLive } from '@eos/plugin-verify';

const REDIRECT_URI = 'http://localhost:5100/oauth/callback';
const CLIENT_ID = 'test-client';
const CLIENT_SECRET = 'test-client-secret';

function base64url(buf) {
  return buf.toString('base64url');
}

function makePkcePair() {
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier, 'ascii').digest());
  return { codeVerifier, codeChallenge };
}

async function startServer(overrides = {}) {
  return createOAuthStubServer({
    port: 0,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUris: [REDIRECT_URI],
    ...overrides,
  });
}

async function authorize(baseUrl, { codeChallenge, state = 'state-1', codeChallengeMethod = 'S256', responseType = 'code' } = {}) {
  const url = new URL(`${baseUrl}/plugin-api/v1/oauth/authorize`);
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('response_type', responseType);
  url.searchParams.set('scope', 'tenant.read');
  if (state) url.searchParams.set('state', state);
  if (codeChallenge) url.searchParams.set('code_challenge', codeChallenge);
  if (codeChallengeMethod) url.searchParams.set('code_challenge_method', codeChallengeMethod);

  const res = await fetch(url, { redirect: 'manual' });
  assert.equal(res.status, 302, 'expected /authorize to redirect');
  const location = new URL(res.headers.get('location'));
  return location;
}

function basicAuthHeader(clientId, clientSecret) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`;
}

/**
 * Default behavior matches the contract's canonical (and, since the strict-
 * by-default fix, this stub's DEFAULT-enforced) form: `client_secret_basic`
 * (an Authorization: Basic header) + a JSON body (contract §4 C11). Pass
 * `useBasicAuth: false` and/or `contentType: 'application/x-www-form-urlencoded'`
 * to exercise the non-conforming forms that are now rejected UNLESS the
 * server was started with `{ lenient: true }`.
 */
async function requestToken(
  baseUrl,
  params,
  { useBasicAuth = true, contentType = 'application/json', clientId = CLIENT_ID, clientSecret = CLIENT_SECRET } = {},
) {
  const headers = { 'content-type': contentType };
  if (useBasicAuth) {
    headers.authorization = basicAuthHeader(clientId, clientSecret);
  }
  const body =
    contentType === 'application/json' ? JSON.stringify(params) : new URLSearchParams(params).toString();
  const res = await fetch(`${baseUrl}/plugin-api/v1/oauth/token`, { method: 'POST', headers, body });
  const json = await res.json();
  return { status: res.status, json };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test('OAuth stub happy path: authorize -> token (code+PKCE) -> jwks -> bridge/verify, end to end', async () => {
  const handle = await startServer();
  try {
    const { codeVerifier, codeChallenge } = makePkcePair();

    const redirectBack = await authorize(handle.baseUrl, { codeChallenge, state: 'abc123' });
    assert.equal(redirectBack.origin + redirectBack.pathname, REDIRECT_URI);
    assert.equal(redirectBack.searchParams.get('state'), 'abc123');
    const code = redirectBack.searchParams.get('code');
    assert.ok(code, 'expected a code in the redirect');

    const { status, json } = await requestToken(handle.baseUrl, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    });

    assert.equal(status, 200);
    assert.equal(json.token_type, 'Bearer');
    assert.equal(json.expires_in, 600);
    assert.equal(json.scope, 'tenant.read');
    assert.equal(json.access_token.split('.').length, 3, 'access_token should be a JWT');
    assert.ok(json.refresh_token.startsWith('rt_'), 'refresh_token should be an opaque rt_ token');

    // JWKS route serves the same test keyset the rest of the kit uses.
    const jwksRes = await fetch(`${handle.pluginApiBaseUrl}/.well-known/jwks.json`);
    const jwks = await jwksRes.json();
    assert.ok(Array.isArray(jwks.keys) && jwks.keys.length >= 1);
    assert.equal(jwks.keys[0].kty, 'EC');

    // bridge/verify: mint an independent bridge token and check this stub's
    // responder against it, via @eos/plugin-verify's OWN client — proves
    // wire-compatibility with the rest of the kit, not just a hand-rolled body shape.
    const bridgeToken = await mintBridgeToken({});
    const liveResult = await verifyBridgeTokenLive(bridgeToken, { baseUrl: handle.pluginApiBaseUrl });
    assert.equal(liveResult.active, true);
    assert.equal(liveResult.installationId, STUB_INSTALLATION_ID);
    assert.equal(liveResult.tenantId, STUB_TENANT_ID);
    assert.equal(liveResult.userId, STUB_USER_ID);
    assert.ok(Array.isArray(liveResult.permissions));
  } finally {
    await handle.close();
  }
});

// ---------------------------------------------------------------------------
// PKCE mismatch rejection
// ---------------------------------------------------------------------------

test('OAuth stub rejects a token exchange whose code_verifier does not match the code_challenge (PKCE)', async () => {
  const handle = await startServer();
  try {
    const { codeChallenge } = makePkcePair();
    const redirectBack = await authorize(handle.baseUrl, { codeChallenge });
    const code = redirectBack.searchParams.get('code');

    const wrongVerifier = base64url(randomBytes(32)); // does NOT hash to codeChallenge
    const { status, json } = await requestToken(handle.baseUrl, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: wrongVerifier,
    });

    assert.equal(status, 400);
    assert.equal(json.error, 'invalid_grant');
  } finally {
    await handle.close();
  }
});

test('OAuth stub /authorize rejects a non-S256 code_challenge_method', async () => {
  const handle = await startServer();
  try {
    const { codeChallenge } = makePkcePair();
    const redirectBack = await authorize(handle.baseUrl, { codeChallenge, codeChallengeMethod: 'plain' });
    assert.equal(redirectBack.searchParams.get('error'), 'invalid_request');
    assert.equal(redirectBack.searchParams.get('code'), null);
  } finally {
    await handle.close();
  }
});

test('OAuth stub rejects reusing an already-consumed authorization code', async () => {
  const handle = await startServer();
  try {
    const { codeVerifier, codeChallenge } = makePkcePair();
    const redirectBack = await authorize(handle.baseUrl, { codeChallenge });
    const code = redirectBack.searchParams.get('code');

    const first = await requestToken(handle.baseUrl, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    });
    assert.equal(first.status, 200);

    const replay = await requestToken(handle.baseUrl, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    });
    assert.equal(replay.status, 400);
    assert.equal(replay.json.error, 'invalid_grant');
  } finally {
    await handle.close();
  }
});

// ---------------------------------------------------------------------------
// Refresh-token rotation reuse-detection -> family revoke
// ---------------------------------------------------------------------------

test('OAuth stub: reusing a rotated-out refresh token revokes the whole family', async () => {
  const handle = await startServer();
  try {
    const { codeVerifier, codeChallenge } = makePkcePair();
    const redirectBack = await authorize(handle.baseUrl, { codeChallenge });
    const code = redirectBack.searchParams.get('code');

    const initial = await requestToken(handle.baseUrl, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    });
    assert.equal(initial.status, 200);
    const refreshToken1 = initial.json.refresh_token;

    // Normal rotation: refreshToken1 -> refreshToken2. Must succeed.
    const rotated = await requestToken(handle.baseUrl, { grant_type: 'refresh_token', refresh_token: refreshToken1 });
    assert.equal(rotated.status, 200);
    const refreshToken2 = rotated.json.refresh_token;
    assert.notEqual(refreshToken2, refreshToken1);

    // Reuse the OLD (already-rotated-out) token: must be rejected AND revoke the family.
    const reuse = await requestToken(handle.baseUrl, { grant_type: 'refresh_token', refresh_token: refreshToken1 });
    assert.equal(reuse.status, 400);
    assert.equal(reuse.json.error, 'invalid_grant');

    // The family is now revoked — even the otherwise-still-fresh refreshToken2 must ALSO be rejected.
    const afterRevoke = await requestToken(handle.baseUrl, { grant_type: 'refresh_token', refresh_token: refreshToken2 });
    assert.equal(afterRevoke.status, 400);
    assert.equal(afterRevoke.json.error, 'invalid_grant');
  } finally {
    await handle.close();
  }
});

test('OAuth stub: two independent server instances do not share auth-code/refresh-token state', async () => {
  const a = await startServer();
  const b = await startServer();
  try {
    const { codeVerifier, codeChallenge } = makePkcePair();
    const redirectBack = await authorize(a.baseUrl, { codeChallenge });
    const code = redirectBack.searchParams.get('code');

    // The code was issued by server A; server B must not recognize it.
    const { status, json } = await requestToken(b.baseUrl, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    });
    assert.equal(status, 400);
    assert.equal(json.error, 'invalid_grant');
  } finally {
    await a.close();
    await b.close();
  }
});

test('OAuth stub: --inactive-equivalent (active:false) makes bridge/verify report inactive and refuses refresh rotation', async () => {
  const handle = await startServer({ active: false });
  try {
    const bridgeToken = await mintBridgeToken({});
    const liveResult = await verifyBridgeTokenLive(bridgeToken, { baseUrl: handle.pluginApiBaseUrl });
    assert.equal(liveResult.active, false);
    // Contract §5's worked example for an inactive installation: identity/
    // permission fields are blanked, never leaked, even though the
    // installationId itself is still reported.
    assert.equal(liveResult.installationId, STUB_INSTALLATION_ID);
    assert.equal(liveResult.tenantId, '');
    assert.equal(liveResult.userId, '');
    assert.deepEqual(liveResult.permissions, []);

    const { codeVerifier, codeChallenge } = makePkcePair();
    const redirectBack = await authorize(handle.baseUrl, { codeChallenge });
    const code = redirectBack.searchParams.get('code');
    const initial = await requestToken(handle.baseUrl, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    });
    // Initial code exchange is unaffected by `active` (contract only ties
    // the live check to refresh ROTATION and bridge/verify).
    assert.equal(initial.status, 200);

    const rotated = await requestToken(handle.baseUrl, {
      grant_type: 'refresh_token',
      refresh_token: initial.json.refresh_token,
    });
    assert.equal(rotated.status, 400);
    assert.equal(rotated.json.error, 'invalid_grant');
  } finally {
    await handle.close();
  }
});

// ---------------------------------------------------------------------------
// Strict-by-default token-endpoint client authentication (contract §4 C11) —
// a form-encoded body or body-embedded credentials must be REJECTED unless
// the server is started with `lenient: true`.
// ---------------------------------------------------------------------------

test('OAuth stub token endpoint rejects a non-JSON (form-encoded) body by default (strict mode)', async () => {
  const handle = await startServer();
  try {
    const { status, json } = await requestToken(
      handle.baseUrl,
      { grant_type: 'authorization_code' },
      { contentType: 'application/x-www-form-urlencoded' },
    );
    assert.equal(status, 400);
    assert.equal(json.error, 'invalid_request');
  } finally {
    await handle.close();
  }
});

test('OAuth stub token endpoint rejects body-embedded client credentials without Basic auth by default (strict mode)', async () => {
  const handle = await startServer();
  try {
    const { status, json } = await requestToken(
      handle.baseUrl,
      { grant_type: 'authorization_code', client_id: CLIENT_ID, client_secret: CLIENT_SECRET },
      { useBasicAuth: false },
    );
    assert.equal(status, 401);
    assert.equal(json.error, 'invalid_client');
  } finally {
    await handle.close();
  }
});

test('OAuth stub token endpoint accepts a well-formed Basic-auth + JSON request by default (strict mode is not over-strict)', async () => {
  const handle = await startServer();
  try {
    const { codeVerifier, codeChallenge } = makePkcePair();
    const redirectBack = await authorize(handle.baseUrl, { codeChallenge });
    const code = redirectBack.searchParams.get('code');

    const { status, json } = await requestToken(handle.baseUrl, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    });
    assert.equal(status, 200);
    assert.equal(json.token_type, 'Bearer');
  } finally {
    await handle.close();
  }
});

test('OAuth stub --lenient mode accepts a form-encoded body with body-embedded client credentials', async () => {
  const handle = await startServer({ lenient: true });
  try {
    const { codeVerifier, codeChallenge } = makePkcePair();
    const redirectBack = await authorize(handle.baseUrl, { codeChallenge });
    const code = redirectBack.searchParams.get('code');

    const { status, json } = await requestToken(
      handle.baseUrl,
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      },
      { useBasicAuth: false, contentType: 'application/x-www-form-urlencoded' },
    );
    assert.equal(status, 200);
    assert.equal(json.token_type, 'Bearer');
  } finally {
    await handle.close();
  }
});

test('OAuth stub --lenient mode still rejects wrong body-embedded credentials', async () => {
  const handle = await startServer({ lenient: true });
  try {
    const { status, json } = await requestToken(
      handle.baseUrl,
      { grant_type: 'authorization_code', client_id: CLIENT_ID, client_secret: 'wrong-secret' },
      { useBasicAuth: false, contentType: 'application/x-www-form-urlencoded' },
    );
    assert.equal(status, 401);
    assert.equal(json.error, 'invalid_client');
  } finally {
    await handle.close();
  }
});
