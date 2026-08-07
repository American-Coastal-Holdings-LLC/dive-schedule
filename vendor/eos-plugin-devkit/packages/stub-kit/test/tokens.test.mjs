import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getTestJwks,
  mintBridgeToken,
  mintAccessToken,
  mintBridgeNegativeFixtures,
  STUB_ISSUER,
  STUB_INSTALLATION_ID,
} from '@eos/plugin-stub-kit';

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

test('getTestJwks returns a well-formed public JWKS document', async () => {
  const jwks = await getTestJwks();
  assert.ok(Array.isArray(jwks.keys));
  assert.equal(jwks.keys.length, 1);
  const key = jwks.keys[0];
  assert.equal(key.alg, 'ES256');
  assert.equal(key.use, 'sig');
  assert.equal(typeof key.kid, 'string');
  // Public JWK only — never a private key component.
  assert.equal('d' in key, false);
});

test('mintBridgeToken produces a well-formed JWT matching contract 02 §5 claims', async () => {
  const token = await mintBridgeToken();
  const [header, payload] = token.split('.');
  assert.equal(token.split('.').length, 3);
  assert.equal(decodeSegment(header).alg, 'ES256');

  const claims = decodeSegment(payload);
  assert.equal(claims.typ, 'bridge');
  assert.equal(claims.iss, STUB_ISSUER);
  assert.equal(claims.aud, STUB_INSTALLATION_ID);
  assert.equal(typeof claims.sub, 'string');
  assert.equal(typeof claims.tenantId, 'string');
  assert.equal(typeof claims.pluginName, 'string');
  assert.ok(Array.isArray(claims.permissions));
  assert.equal(claims.exp - claims.iat, 300, 'default bridge TTL is 5 minutes');
});

test('mintBridgeToken honors overrides', async () => {
  const token = await mintBridgeToken({ installationId: 'inst_custom', permissions: ['ext.x.y.z'] });
  const claims = decodeSegment(token.split('.')[1]);
  assert.equal(claims.aud, 'inst_custom');
  assert.deepEqual(claims.permissions, ['ext.x.y.z']);
});

test('mintAccessToken produces a well-formed JWT with the 10-minute contract TTL', async () => {
  const token = await mintAccessToken();
  const claims = decodeSegment(token.split('.')[1]);
  assert.equal(claims.typ, 'access');
  assert.equal(claims.aud, STUB_INSTALLATION_ID);
  assert.ok(Array.isArray(claims.scope));
  assert.equal(claims.exp - claims.iat, 600, 'default access-token TTL is 10 minutes');
});

test('mintBridgeNegativeFixtures returns the full required set with distinct tokens', async () => {
  const fixtures = await mintBridgeNegativeFixtures();
  const names = fixtures.map((f) => f.name);

  for (const required of ['algNone', 'wrongAlg', 'expired', 'wrongAudience', 'badSignature', 'tamperedPayload']) {
    assert.ok(names.includes(required), `missing required negative fixture: ${required}`);
  }

  const tokens = new Set(fixtures.map((f) => f.token));
  assert.equal(tokens.size, fixtures.length, 'every fixture token must be distinct');

  for (const fixture of fixtures) {
    assert.equal(fixture.token.split('.').length, 3, `${fixture.name} must still be a 3-segment JWT shape`);
    assert.equal(typeof fixture.description, 'string');
    assert.ok(fixture.description.length > 0);
  }
});
