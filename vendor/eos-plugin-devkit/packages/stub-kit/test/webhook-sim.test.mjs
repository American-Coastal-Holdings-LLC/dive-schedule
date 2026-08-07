import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  verifyWebhookSignature,
  WebhookVerifyError,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
} from '@eos/plugin-verify';
import { buildDeliveryHeaders, buildSamplePayload } from '@eos/plugin-stub-kit/webhook-sim';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_BIN = path.join(__dirname, '..', 'src', 'bin', 'webhook-sim.ts');

/** Start a bare HTTP server that records every request it receives (method,
 * headers, raw body) and answers 200. Returns { url, close(), requests }. */
function startCapturingReceiver() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      requests.push({
        headers: req.headers,
        rawBody: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ received: true }));
    });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/webhooks`,
        requests,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

/** Run the webhook-sim CLI (from its TypeScript source — no build required)
 * as a real child process and collect its outcome. */
function runCli(args, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_BIN, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`eos-webhook-sim did not exit within ${timeoutMs}ms. stdout=${stdout} stderr=${stderr}`));
    }, timeoutMs);
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// ---------------------------------------------------------------------------
// buildSamplePayload: must match contract 02 §8's worked delivery example
// EXACTLY — { id, type, schemaVersion, createdAt, installationId, data }
// — with `id` equal to the caller-supplied deliveryId (never generated
// independently, so it can never drift from X-EOS-Webhook-Id).
// ---------------------------------------------------------------------------

test('buildSamplePayload matches contract §8\'s worked envelope shape exactly', () => {
  const payload = buildSamplePayload('subscription.activated', 'whd_test_envelope');

  assert.deepEqual(Object.keys(payload).sort(), ['createdAt', 'data', 'id', 'installationId', 'schemaVersion', 'type'].sort());
  assert.equal(payload.id, 'whd_test_envelope');
  assert.equal(payload.type, 'subscription.activated');
  assert.equal(payload.schemaVersion, 1);
  assert.equal(typeof payload.createdAt, 'string');
  assert.ok(!Number.isNaN(Date.parse(payload.createdAt)), 'createdAt must be an ISO timestamp');
  assert.equal(typeof payload.installationId, 'string');
  assert.equal(typeof payload.data, 'object');
  assert.equal(typeof payload.data.resourceId, 'string');

  // No leftover fields from the old (pre-fix) shape.
  assert.equal('event' in payload, false);
  assert.equal('occurredAt' in payload, false);
  assert.equal('tenantId' in payload, false);
  assert.equal('pluginName' in payload, false);
});

test('buildSamplePayload: the body id always equals the passed-in deliveryId, never an independently generated one', () => {
  const a = buildSamplePayload('installation.created', 'whd_aaa');
  const b = buildSamplePayload('installation.created', 'whd_bbb');
  assert.equal(a.id, 'whd_aaa');
  assert.equal(b.id, 'whd_bbb');
  assert.notEqual(a.id, b.id);
});

test('buildSamplePayload honors an explicit schemaVersion override', () => {
  const payload = buildSamplePayload('installation.created', 'whd_test_schema', { schemaVersion: 2 });
  assert.equal(payload.schemaVersion, 2);
});

// ---------------------------------------------------------------------------
// Fast unit test: the core signing function's output verifies via
// @eos/plugin-verify with no network round trip.
// ---------------------------------------------------------------------------

test('buildDeliveryHeaders: a default (non-corrupted) delivery verifies via @eos/plugin-verify', () => {
  const secret = 'whsec_unit_test';
  const rawBody = JSON.stringify({ event: 'installation.created', id: 'evt_1' });

  const { headers, deliveryId, timestampSeconds } = buildDeliveryHeaders({
    url: 'http://unused.invalid/webhooks',
    secret,
    rawBody,
    deliveryId: 'whd_unit_1',
  });

  assert.equal(deliveryId, 'whd_unit_1');
  assert.equal(headers['X-EOS-Webhook-Id'], 'whd_unit_1');
  assert.equal(headers['X-EOS-Webhook-Timestamp'], String(timestampSeconds));
  assert.match(headers['X-EOS-Webhook-Signature'], /^v1=[0-9a-f]+$/);

  assert.doesNotThrow(() =>
    verifyWebhookSignature(
      rawBody,
      {
        signature: headers['X-EOS-Webhook-Signature'],
        timestamp: headers['X-EOS-Webhook-Timestamp'],
        deliveryId: headers['X-EOS-Webhook-Id'],
        kid: headers['X-EOS-Webhook-Kid'],
      },
      { secret },
    ),
  );
});

test('buildDeliveryHeaders: badSignature produces a well-formed but wrong signature', () => {
  const secret = 'whsec_unit_test';
  const rawBody = '{"event":"installation.created"}';

  const { headers } = buildDeliveryHeaders({
    url: 'http://unused.invalid/webhooks',
    secret,
    rawBody,
    deliveryId: 'whd_unit_2',
    badSignature: true,
  });

  assert.match(headers['X-EOS-Webhook-Signature'], /^v1=[0-9a-f]+$/);
  assert.throws(
    () =>
      verifyWebhookSignature(
        rawBody,
        { signature: headers['X-EOS-Webhook-Signature'], timestamp: headers['X-EOS-Webhook-Timestamp'], deliveryId: 'whd_unit_2' },
        { secret },
      ),
    (err) => {
      assert.ok(err instanceof WebhookVerifyError);
      assert.equal(err.code, 'BAD_SIGNATURE');
      return true;
    },
  );
});

test('buildDeliveryHeaders: staleTimestamp pushes the timestamp outside the tolerance window', () => {
  const secret = 'whsec_unit_test';
  const rawBody = '{"event":"installation.created"}';
  const nowSeconds = Math.floor(Date.now() / 1000);

  const { headers, timestampSeconds } = buildDeliveryHeaders({
    url: 'http://unused.invalid/webhooks',
    secret,
    rawBody,
    deliveryId: 'whd_unit_3',
    staleTimestamp: true,
  });

  assert.ok(nowSeconds - timestampSeconds > WEBHOOK_SIGNATURE_TOLERANCE_SECONDS);
  assert.throws(
    () =>
      verifyWebhookSignature(
        rawBody,
        { signature: headers['X-EOS-Webhook-Signature'], timestamp: headers['X-EOS-Webhook-Timestamp'], deliveryId: 'whd_unit_3' },
        { secret },
      ),
    (err) => {
      assert.ok(err instanceof WebhookVerifyError);
      assert.equal(err.code, 'STALE_TIMESTAMP');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// True CLI tests: spawn the actual bin (from source, no build step needed)
// against a local receiver and inspect what it actually sent on the wire.
// ---------------------------------------------------------------------------

test('CLI happy path: signs a real HTTP delivery whose signature verifies via @eos/plugin-verify', async () => {
  const receiver = await startCapturingReceiver();
  try {
    const { code, stdout } = await runCli([
      '--url',
      receiver.url,
      '--event',
      'installation.created',
      '--secret',
      'whsec_cli_test',
      '--kid',
      'cli-test-key',
    ]);

    assert.equal(code, 0, `expected exit 0, got ${code}. stdout=${stdout}`);
    assert.equal(receiver.requests.length, 1);

    const [delivered] = receiver.requests;
    assert.equal(delivered.headers['x-eos-webhook-kid'], 'cli-test-key');
    assert.match(delivered.headers['x-eos-webhook-signature'], /^v1=[0-9a-f]+$/);

    assert.doesNotThrow(() =>
      verifyWebhookSignature(
        delivered.rawBody,
        {
          signature: delivered.headers['x-eos-webhook-signature'],
          timestamp: delivered.headers['x-eos-webhook-timestamp'],
          deliveryId: delivered.headers['x-eos-webhook-id'],
          kid: delivered.headers['x-eos-webhook-kid'],
        },
        { secret: 'whsec_cli_test' },
      ),
    );

    const payload = JSON.parse(delivered.rawBody);
    assert.equal(payload.type, 'installation.created');
    assert.equal(payload.schemaVersion, 1);
    assert.equal(typeof payload.createdAt, 'string');
    // Contract §8: the body `id` MUST equal the X-EOS-Webhook-Id delivery id.
    assert.equal(payload.id, delivered.headers['x-eos-webhook-id']);
  } finally {
    await receiver.close();
  }
});

test('CLI --bad-signature: the delivered signature fails verification with BAD_SIGNATURE', async () => {
  const receiver = await startCapturingReceiver();
  try {
    const { code } = await runCli(['--url', receiver.url, '--secret', 'whsec_cli_test', '--bad-signature']);
    assert.equal(code, 0);
    assert.equal(receiver.requests.length, 1);

    const [delivered] = receiver.requests;
    assert.throws(
      () =>
        verifyWebhookSignature(
          delivered.rawBody,
          {
            signature: delivered.headers['x-eos-webhook-signature'],
            timestamp: delivered.headers['x-eos-webhook-timestamp'],
            deliveryId: delivered.headers['x-eos-webhook-id'],
          },
          { secret: 'whsec_cli_test' },
        ),
      (err) => {
        assert.ok(err instanceof WebhookVerifyError);
        assert.equal(err.code, 'BAD_SIGNATURE');
        return true;
      },
    );
  } finally {
    await receiver.close();
  }
});

test('CLI --stale-timestamp: the delivered timestamp fails verification with STALE_TIMESTAMP', async () => {
  const receiver = await startCapturingReceiver();
  try {
    const { code } = await runCli(['--url', receiver.url, '--secret', 'whsec_cli_test', '--stale-timestamp']);
    assert.equal(code, 0);
    assert.equal(receiver.requests.length, 1);

    const [delivered] = receiver.requests;
    assert.throws(
      () =>
        verifyWebhookSignature(
          delivered.rawBody,
          {
            signature: delivered.headers['x-eos-webhook-signature'],
            timestamp: delivered.headers['x-eos-webhook-timestamp'],
            deliveryId: delivered.headers['x-eos-webhook-id'],
          },
          { secret: 'whsec_cli_test' },
        ),
      (err) => {
        assert.ok(err instanceof WebhookVerifyError);
        assert.equal(err.code, 'STALE_TIMESTAMP');
        return true;
      },
    );
  } finally {
    await receiver.close();
  }
});

test('CLI --duplicate: sends the identical delivery twice for idempotency testing', async () => {
  const receiver = await startCapturingReceiver();
  try {
    const { code } = await runCli(['--url', receiver.url, '--secret', 'whsec_cli_test', '--duplicate']);
    assert.equal(code, 0);
    assert.equal(receiver.requests.length, 2);

    const [first, second] = receiver.requests;
    assert.equal(first.headers['x-eos-webhook-id'], second.headers['x-eos-webhook-id']);
    assert.equal(first.headers['x-eos-webhook-signature'], second.headers['x-eos-webhook-signature']);
    assert.equal(first.headers['x-eos-webhook-timestamp'], second.headers['x-eos-webhook-timestamp']);
    assert.equal(first.rawBody, second.rawBody);

    // Both copies of the duplicate must themselves be genuinely valid —
    // the point of the switch is testing the RECEIVER's dedupe, not
    // producing an invalid delivery.
    for (const delivered of receiver.requests) {
      assert.doesNotThrow(() =>
        verifyWebhookSignature(
          delivered.rawBody,
          {
            signature: delivered.headers['x-eos-webhook-signature'],
            timestamp: delivered.headers['x-eos-webhook-timestamp'],
            deliveryId: delivered.headers['x-eos-webhook-id'],
          },
          { secret: 'whsec_cli_test' },
        ),
      );
    }
  } finally {
    await receiver.close();
  }
});

test('CLI --secret kid=value pool: --kid selects which pooled secret signs the delivery', async () => {
  const receiver = await startCapturingReceiver();
  try {
    const { code } = await runCli([
      '--url',
      receiver.url,
      '--secret',
      'old=whsec_old_123',
      '--secret',
      'new=whsec_new_456',
      '--kid',
      'new',
    ]);
    assert.equal(code, 0);
    assert.equal(receiver.requests.length, 1);

    const [delivered] = receiver.requests;
    assert.equal(delivered.headers['x-eos-webhook-kid'], 'new');

    // Signed with the "new" pool entry, not "old" — the "old" secret must NOT verify.
    assert.throws(() =>
      verifyWebhookSignature(
        delivered.rawBody,
        {
          signature: delivered.headers['x-eos-webhook-signature'],
          timestamp: delivered.headers['x-eos-webhook-timestamp'],
          deliveryId: delivered.headers['x-eos-webhook-id'],
        },
        { secret: 'whsec_old_123' },
      ),
    );
    assert.doesNotThrow(() =>
      verifyWebhookSignature(
        delivered.rawBody,
        {
          signature: delivered.headers['x-eos-webhook-signature'],
          timestamp: delivered.headers['x-eos-webhook-timestamp'],
          deliveryId: delivered.headers['x-eos-webhook-id'],
        },
        { secret: 'whsec_new_456' },
      ),
    );
  } finally {
    await receiver.close();
  }
});

test('CLI --secret kid=value pool: without --kid, defaults to the first pool entry given', async () => {
  const receiver = await startCapturingReceiver();
  try {
    const { code } = await runCli([
      '--url',
      receiver.url,
      '--secret',
      'first=whsec_first_111',
      '--secret',
      'second=whsec_second_222',
    ]);
    assert.equal(code, 0);
    const [delivered] = receiver.requests;
    assert.equal(delivered.headers['x-eos-webhook-kid'], 'first');
    assert.doesNotThrow(() =>
      verifyWebhookSignature(
        delivered.rawBody,
        {
          signature: delivered.headers['x-eos-webhook-signature'],
          timestamp: delivered.headers['x-eos-webhook-timestamp'],
          deliveryId: delivered.headers['x-eos-webhook-id'],
        },
        { secret: 'whsec_first_111' },
      ),
    );
  } finally {
    await receiver.close();
  }
});

test('CLI --secret kid=value pool: an unknown --kid is a usage error', async () => {
  const { code, stderr } = await runCli([
    '--url',
    'http://unused.invalid/webhooks',
    '--secret',
    'a=secret_a',
    '--secret',
    'b=secret_b',
    '--kid',
    'not-in-pool',
  ]);
  assert.notEqual(code, 0);
  assert.match(stderr, /no entry for kid "not-in-pool"/);
});

test('CLI --secret: mixing a bare value with kid=value pairs is a usage error', async () => {
  const { code, stderr } = await runCli([
    '--url',
    'http://unused.invalid/webhooks',
    '--secret',
    'bare_secret',
    '--secret',
    'a=secret_a',
  ]);
  assert.notEqual(code, 0);
  assert.match(stderr, /cannot mix a bare value with kid=value pairs/);
});

test('CLI --help exits 0 and prints usage without requiring --url', async () => {
  const { code, stdout } = await runCli(['--help']);
  assert.equal(code, 0);
  assert.match(stdout, /USAGE/);
  assert.match(stdout, /--bad-signature/);
});

test('CLI missing --url exits non-zero', async () => {
  const { code, stderr } = await runCli([]);
  assert.notEqual(code, 0);
  assert.match(stderr, /--url/);
});
