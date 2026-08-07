// Resize clamp: behaviour + the anti-drift gate.
//
// WHY THIS FILE EXISTS. The stub host used to return `{ appliedHeight: p.height,
// appliedWidth: p.width }` — the request echoed back as "applied", with no clamp,
// while the real host clamps height to 100–4000 and width to 200–4000. A vendor
// could call `resize({ height: 5000 })`, assert `appliedHeight === 5000`, go green
// against the kit, and have their content clipped at 4000px in production. The kit
// taught the wrong reflex and could not falsify it.
//
// The generating mechanism was not the missing `Math.min` — it was that ONE frozen
// contract had TWO independent implementations (the host's and the kit's) and
// NOTHING compared them. Fixing only the clamp would leave that mechanism intact
// and the next contract constant would drift the same way.
//
// The kit cannot import the host's constants: the host owns them in a Next.js
// `'use client'` hook inside a private app repo that no vendor install resolves,
// and `eos-workspace-web` does not depend on this package either. So the kit
// mirrors the numbers — and this gate makes the mirror non-silent by reading the
// host's own source and the frozen contract and failing when they disagree.
//
// The gate SKIPS when those sources are absent (a vendor checkout, a `git archive`
// extraction, CI without the meta-workspace). Skipping is correct there: the drift
// it guards can only be introduced where both repos exist, which is where it runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createBridgeClient,
  RESIZE_MIN_HEIGHT,
  RESIZE_MAX_HEIGHT,
  RESIZE_MIN_WIDTH,
  RESIZE_MAX_WIDTH,
} from '@eos/plugin-bridge';

const HOST_SOURCE = join(
  'eos-workspace-web',
  'src/app/dashboard/plugins/ext/[vendorSlug]/[pluginSlug]/useBridgeHost.ts',
);
const CONTRACT_SOURCE = join('platform-plugins', '02-vendor-integration-contract.md');

/** Walk up from this file for a meta-workspace root carrying both sibling repos. */
function findWorkspaceRoot() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, HOST_SOURCE)) && existsSync(join(dir, CONTRACT_SOURCE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** `const NAME = 123;` → 123 */
function readHostConstant(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)\\s*;`));
  assert.ok(match, `host no longer declares ${name} — the resize clamp was renamed or removed`);
  return Number(match[1]);
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

test('DRIFT GATE: the stub mirrors the real host\'s resize bounds', (t) => {
  const root = findWorkspaceRoot();
  if (root === null) {
    t.skip('meta-workspace not present (vendor checkout / archive) — nothing to compare against');
    return;
  }

  const host = readFileSync(join(root, HOST_SOURCE), 'utf8');

  assert.equal(readHostConstant(host, 'RESIZE_MIN_HEIGHT'), RESIZE_MIN_HEIGHT);
  assert.equal(readHostConstant(host, 'RESIZE_MAX_HEIGHT'), RESIZE_MAX_HEIGHT);
  assert.equal(readHostConstant(host, 'RESIZE_MIN_WIDTH'), RESIZE_MIN_WIDTH);
  assert.equal(readHostConstant(host, 'RESIZE_MAX_WIDTH'), RESIZE_MAX_WIDTH);

  // Equal numbers are not enough: the host could keep the constants and stop
  // applying them, which is the same divergence pointing the other way.
  assert.match(
    host,
    /clamp\(\s*height\s*,\s*RESIZE_MIN_HEIGHT\s*,\s*RESIZE_MAX_HEIGHT\s*\)/,
    'host no longer applies its own height clamp',
  );
  assert.match(
    host,
    /clamp\(\s*width\s*,\s*RESIZE_MIN_WIDTH\s*,\s*RESIZE_MAX_WIDTH\s*\)/,
    'host no longer applies its own width clamp',
  );
});

test('DRIFT GATE: the stub mirrors the bounds the frozen contract publishes', (t) => {
  const root = findWorkspaceRoot();
  if (root === null) {
    t.skip('meta-workspace not present (vendor checkout / archive) — nothing to compare against');
    return;
  }

  const contract = readFileSync(join(root, CONTRACT_SOURCE), 'utf8');
  const published = (dimension) => {
    const match = contract.match(new RegExp(`\`${dimension}\` clamped to \\*\\*(\\d+)[–-](\\d+)\\*\\*`));
    assert.ok(match, `contract §5 no longer publishes a ${dimension} clamp in the expected form`);
    return [Number(match[1]), Number(match[2])];
  };

  assert.deepEqual(published('height'), [RESIZE_MIN_HEIGHT, RESIZE_MAX_HEIGHT]);
  assert.deepEqual(published('width'), [RESIZE_MIN_WIDTH, RESIZE_MAX_WIDTH]);
});

// ---------------------------------------------------------------------------
// The behaviour the gate protects
// ---------------------------------------------------------------------------

const stub = () => createBridgeClient({ mode: 'stub', stub: {} });

test('stub clamps an over-tall resize instead of echoing it back', async () => {
  const client = await stub();
  // The exact call from the incident: green against the old stub, clipped in prod.
  assert.deepEqual(await client.resize({ height: 5000 }), { appliedHeight: RESIZE_MAX_HEIGHT });
  assert.deepEqual(await client.resize({ height: 10 }), { appliedHeight: RESIZE_MIN_HEIGHT });
  client.disconnect();
});

test('stub clamps width, and omits appliedWidth when no width was asked for', async () => {
  const client = await stub();

  assert.deepEqual(await client.resize({ height: 600, width: 9000 }), {
    appliedHeight: 600,
    appliedWidth: RESIZE_MAX_WIDTH,
  });
  assert.deepEqual(await client.resize({ height: 600, width: 5 }), {
    appliedHeight: 600,
    appliedWidth: RESIZE_MIN_WIDTH,
  });

  // The host omits the key entirely; the old stub always set it, to `undefined`.
  // `'appliedWidth' in result` must agree across the two.
  const noWidth = await client.resize({ height: 600 });
  assert.equal('appliedWidth' in noWidth, false);

  client.disconnect();
});

test('stub passes in-range resizes through untouched', async () => {
  const client = await stub();
  assert.deepEqual(await client.resize({ height: 400, width: 800 }), {
    appliedHeight: 400,
    appliedWidth: 800,
  });
  client.disconnect();
});

test('stub rejects malformed resize params with INVALID_PARAMS, as the host does', async () => {
  const client = await stub();
  const invalid = async (params) => {
    await assert.rejects(client.resize(params), (error) => {
      assert.equal(error.code, 'INVALID_PARAMS');
      return true;
    });
  };

  // Non-finite height must not reach the clamp: Math.min(Math.max(NaN, …)) is
  // NaN, which would be a fresh wrong-reflex in place of the old one.
  await invalid({ height: Number.NaN });
  await invalid({ height: Number.POSITIVE_INFINITY });
  await invalid({ height: '600' });
  await invalid({});
  await invalid(null);
  await invalid({ height: 600, width: Number.NaN });
  await invalid({ height: 600, width: '800' });

  client.disconnect();
});

test('the observation hook still reports the raw request, as onNavigate does', async () => {
  let seen = null;
  const client = await createBridgeClient({ mode: 'stub', stub: { onResize: (p) => (seen = p) } });

  const result = await client.resize({ height: 5000 });
  assert.deepEqual(seen, { height: 5000 }, 'dev UIs observe what the child asked for');
  assert.equal(result.appliedHeight, RESIZE_MAX_HEIGHT, 'the vendor reads what the host applied');

  client.disconnect();
});
