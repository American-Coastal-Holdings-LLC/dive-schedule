// Adversarial check: HmacWebhookVerifier against the contract §8 wire format.
//
// Run against an API booted with the REAL verifier and a two-key secret map (a rotation in
// progress), on a throwaway port:
//
//   cd api && NODE_ENV=development USE_DEV_IDENTITY_STUB=true PORT=4399 \
//     EOS_WEBHOOK_SECRETS='{"whsec_test_1":"super-secret-value-for-testing","whsec_test_2":"the-rotated-partner-secret"}' \
//     node dist/main.js
//   node scripts/dev-checks/webhook-signature.mjs
//
// Not a unit-test framework — a black-box probe of the deployed surface, matching the posture of
// SprocketSuite's scripts/dev-checks/.
// Uses ONLY benign event types — never installation.deleted — so this cannot trigger the
// per-installation cascade delete against the dev database.
import { createHmac } from 'node:crypto';

const URL_ = 'http://127.0.0.1:4399/webhooks/platform';
const KID = 'whsec_test_1';
const SECRET = 'super-secret-value-for-testing';
const OTHER_KID = 'whsec_test_2';
const OTHER_SECRET = 'the-rotated-partner-secret';

const sign = (secret, deliveryId, ts, rawBody) =>
  createHmac('sha256', secret).update(`${deliveryId}.${ts}.${rawBody}`, 'utf8').digest('hex');

async function post({ label, body, deliveryId, ts, kid, secret, tamper, sigOverride }) {
  const raw = JSON.stringify(body);
  const signature = sigOverride ?? `v1=${sign(secret, deliveryId, ts, raw)}`;
  // Tamper with the INSTALLATION ID — the cross-tenant attack that matters: sign a delivery for
  // your own installation, then swap in someone else's before sending.
  const sent = tamper ? raw.replace('inst_demo', 'inst_other') : raw;
  const res = await fetch(URL_, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-EOS-Webhook-Signature': signature,
      'X-EOS-Webhook-Timestamp': String(ts),
      'X-EOS-Webhook-Id': deliveryId,
      ...(kid ? { 'X-EOS-Webhook-Kid': kid } : {}),
    },
    body: sent,
  });
  return { label, status: res.status };
}

const now = Math.floor(Date.now() / 1000);
const body = { id: 'evt_1', type: 'subscription.activated', schemaVersion: 1, installationId: 'inst_demo', data: {} };

const results = [];
// 1. correct signature, current kid → accepted
results.push(await post({ label: 'valid signature (kid 1)', body, deliveryId: 'dlv_1', ts: now, kid: KID, secret: SECRET }));
// 2. correct signature under the ROTATED kid → also accepted (overlap window)
results.push(await post({ label: 'valid signature (rotated kid 2)', body, deliveryId: 'dlv_2', ts: now, kid: OTHER_KID, secret: OTHER_SECRET }));
// 3. body tampered after signing → rejected
results.push(await post({ label: 'tampered body', body, deliveryId: 'dlv_3', ts: now, kid: KID, secret: SECRET, tamper: true }));
// 4. signed with the wrong secret → rejected
results.push(await post({ label: 'wrong secret', body, deliveryId: 'dlv_4', ts: now, kid: KID, secret: 'not-the-secret' }));
// 5. timestamp outside ±300s → rejected (replay defense)
results.push(await post({ label: 'stale timestamp (-900s)', body, deliveryId: 'dlv_5', ts: now - 900, kid: KID, secret: SECRET }));
// 6. unknown kid → rejected
results.push(await post({ label: 'unknown kid', body, deliveryId: 'dlv_6', ts: now, kid: 'whsec_nope', secret: SECRET }));
// 7. malformed signature header → rejected
results.push(await post({ label: 'malformed signature header', body, deliveryId: 'dlv_7', ts: now, kid: KID, secret: SECRET, sigOverride: 'not-a-signature' }));
// 8. no signature headers at all → rejected
{
  const res = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  results.push({ label: 'no signature headers', status: res.status });
}

const expected = { 'valid signature (kid 1)': 202, 'valid signature (rotated kid 2)': 202 };
let pass = 0;
for (const r of results) {
  const want = expected[r.label] ?? 401;
  const ok = r.status === want;
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.label.padEnd(34)} got ${r.status}, want ${want}`);
}
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
