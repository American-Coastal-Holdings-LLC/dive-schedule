import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyBridgeToken,
  createLocalJwks,
  BridgeTokenVerifyError,
  verifyWebhookSignature,
  computeWebhookSignature,
  WebhookVerifyError,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
} from '@eos/plugin-verify';
import {
  getTestJwks,
  mintBridgeToken,
  mintBridgeNegativeFixtures,
  STUB_ISSUER,
  STUB_INSTALLATION_ID,
} from '@eos/plugin-stub-kit';

test('verifyBridgeToken accepts a validly signed sample bridge token and returns its claims', async () => {
  const jwks = createLocalJwks(await getTestJwks());
  const token = await mintBridgeToken();

  const claims = await verifyBridgeToken(token, {
    jwks,
    issuer: STUB_ISSUER,
    installationId: STUB_INSTALLATION_ID,
  });

  assert.equal(claims.typ, 'bridge');
  assert.equal(claims.iss, STUB_ISSUER);
  assert.equal(claims.aud, STUB_INSTALLATION_ID);
  assert.equal(typeof claims.sub, 'string');
  assert.equal(typeof claims.tenantId, 'string');
  assert.equal(typeof claims.pluginName, 'string');
  assert.ok(Array.isArray(claims.permissions));
});

test('verifyBridgeToken rejects a garbage / malformed token', async () => {
  const jwks = createLocalJwks(await getTestJwks());
  await assert.rejects(
    () => verifyBridgeToken('not-a-jwt', { jwks, issuer: STUB_ISSUER, installationId: STUB_INSTALLATION_ID }),
    (err) => {
      assert.ok(err instanceof BridgeTokenVerifyError);
      assert.equal(err.code, 'MALFORMED');
      return true;
    },
  );
});

test('verifyBridgeToken rejects every required negative fixture', async () => {
  const jwks = createLocalJwks(await getTestJwks());
  const fixtures = await mintBridgeNegativeFixtures();

  assert.ok(fixtures.length >= 6, 'expected at least the 6 required negative fixtures');

  for (const fixture of fixtures) {
    await assert.rejects(
      () => verifyBridgeToken(fixture.token, { jwks, issuer: STUB_ISSUER, installationId: STUB_INSTALLATION_ID }),
      (err) => {
        assert.ok(
          err instanceof BridgeTokenVerifyError,
          `fixture "${fixture.name}" (${fixture.description}): expected BridgeTokenVerifyError, got ${err}`,
        );
        return true;
      },
      `fixture "${fixture.name}" (${fixture.description}) should have been rejected`,
    );
  }
});

test('verifyBridgeToken negative fixtures map to the expected error code', async () => {
  const jwks = createLocalJwks(await getTestJwks());
  const fixtures = await mintBridgeNegativeFixtures();
  const byName = Object.fromEntries(fixtures.map((f) => [f.name, f.token]));

  const expectCode = async (name, code) => {
    await assert.rejects(
      () => verifyBridgeToken(byName[name], { jwks, issuer: STUB_ISSUER, installationId: STUB_INSTALLATION_ID }),
      (err) => {
        assert.equal(err.code, code, `fixture "${name}" expected code ${code}, got ${err.code}`);
        return true;
      },
    );
  };

  await expectCode('algNone', 'INVALID_ALG');
  await expectCode('wrongAlg', 'INVALID_ALG');
  await expectCode('expired', 'EXPIRED');
  await expectCode('wrongAudience', 'WRONG_AUDIENCE');
  await expectCode('wrongIssuer', 'WRONG_ISSUER');
  await expectCode('wrongTyp', 'WRONG_TYPE');
  await expectCode('badSignature', 'BAD_SIGNATURE');
  await expectCode('tamperedPayload', 'BAD_SIGNATURE');
});

// ---------------------------------------------------------------------------
// Webhook signature verification (contract §8 as amended 2026-07-19:
// {deliveryId}.{timestamp}.{rawBody})
// ---------------------------------------------------------------------------

test('webhook signature: a validly signed delivery verifies', () => {
  const secret = 'whsec_test_do_not_use_in_prod';
  const deliveryId = 'whd_test_1';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify({ type: 'installation.created', installationId: 'inst_x' });
  const signature = computeWebhookSignature(secret, deliveryId, timestamp, rawBody);

  assert.doesNotThrow(() =>
    verifyWebhookSignature(rawBody, { signature: `v1=${signature}`, timestamp, deliveryId }, { secret }),
  );
});

test('webhook signature: rejects a bad signature', () => {
  const secret = 'whsec_test_do_not_use_in_prod';
  const deliveryId = 'whd_test_2';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = '{"type":"installation.created"}';

  assert.throws(
    () => verifyWebhookSignature(rawBody, { signature: 'v1=' + 'ab'.repeat(32), timestamp, deliveryId }, { secret }),
    (err) => {
      assert.ok(err instanceof WebhookVerifyError);
      assert.equal(err.code, 'BAD_SIGNATURE');
      return true;
    },
  );
});

test('webhook signature: rejects a stale timestamp outside the ±5min window', () => {
  const secret = 'whsec_test_do_not_use_in_prod';
  const deliveryId = 'whd_test_3';
  const staleTimestamp = String(Math.floor(Date.now() / 1000) - (WEBHOOK_SIGNATURE_TOLERANCE_SECONDS + 60));
  const rawBody = '{"type":"installation.created"}';
  const signature = computeWebhookSignature(secret, deliveryId, staleTimestamp, rawBody);

  assert.throws(
    () => verifyWebhookSignature(rawBody, { signature: `v1=${signature}`, timestamp: staleTimestamp, deliveryId }, { secret }),
    (err) => {
      assert.ok(err instanceof WebhookVerifyError);
      assert.equal(err.code, 'STALE_TIMESTAMP');
      return true;
    },
  );
});

test('webhook signature: rejects a tampered body even with a correctly-shaped signature header', () => {
  const secret = 'whsec_test_do_not_use_in_prod';
  const deliveryId = 'whd_test_4';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const originalBody = '{"amount":100}';
  const signature = computeWebhookSignature(secret, deliveryId, timestamp, originalBody);
  const tamperedBody = '{"amount":100000}';

  assert.throws(
    () => verifyWebhookSignature(tamperedBody, { signature: `v1=${signature}`, timestamp, deliveryId }, { secret }),
    (err) => {
      assert.ok(err instanceof WebhookVerifyError);
      assert.equal(err.code, 'BAD_SIGNATURE');
      return true;
    },
  );
});

test('webhook signature: rejects the wrong secret', () => {
  const deliveryId = 'whd_test_5';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = '{"type":"installation.created"}';
  const signature = computeWebhookSignature('the-real-secret', deliveryId, timestamp, rawBody);

  assert.throws(
    () => verifyWebhookSignature(rawBody, { signature: `v1=${signature}`, timestamp, deliveryId }, { secret: 'a-different-secret' }),
    (err) => {
      assert.ok(err instanceof WebhookVerifyError);
      assert.equal(err.code, 'BAD_SIGNATURE');
      return true;
    },
  );
});

test('webhook signature: rejects malformed headers', () => {
  const secret = 'whsec_test_do_not_use_in_prod';
  assert.throws(
    () => verifyWebhookSignature('{}', { signature: 'not-the-right-shape', timestamp: '123', deliveryId: 'whd_1' }, { secret }),
    (err) => err instanceof WebhookVerifyError && err.code === 'MALFORMED_HEADERS',
  );
  assert.throws(
    () => verifyWebhookSignature('{}', { signature: '', timestamp: '', deliveryId: '' }, { secret }),
    (err) => err instanceof WebhookVerifyError && err.code === 'MALFORMED_HEADERS',
  );
});
