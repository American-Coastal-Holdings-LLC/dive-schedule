#!/usr/bin/env node
// Produce the manifest revision to SUBMIT, from the annotated manifest.json we maintain.
//
//   node scripts/make-submission-manifest.mjs <host> [outfile]
//   e.g. node scripts/make-submission-manifest.mjs diveschedule.1.2.3.4.sslip.io
//
// Two jobs, both of which are easy to forget by hand at 1am:
//
//  1. STRIP the `$comment*` keys. We keep them in manifest.json because the reasoning behind the
//     scope choices and the slug is worth carrying next to the values. But Stage 3 intake does a
//     strict parse into a typed DTO with reject-at-intake string hygiene, and the contract is only
//     explicit that unknown ENVELOPE keys are dropped. Submitting the annotated file gambles on
//     that; submitting a clean one does not.
//
//  2. SUBSTITUTE the placeholder host into every URL that carries it — embed.url, embed.origin,
//     the webhook endpoint, and the OAuth redirect. These four must agree with each other AND with
//     the box's CSP_FRAME_ANCESTORS / NEXT_PUBLIC_APP_ORIGIN. Doing it by hand is how three of the
//     four end up right.
//
// Refuses to emit anything still containing PLACEHOLDER, so a half-substituted manifest cannot be
// submitted by accident.

import { readFileSync, writeFileSync } from 'node:fs';

const host = process.argv[2];
const outfile = process.argv[3] ?? 'manifest.submit.json';

if (!host) {
  console.error('usage: node scripts/make-submission-manifest.mjs <host> [outfile]');
  console.error('   eg: node scripts/make-submission-manifest.mjs diveschedule.34.225.80.4.sslip.io');
  process.exit(1);
}
if (/^https?:\/\//.test(host)) {
  console.error(`error: pass a bare host, not a URL (got "${host}")`);
  process.exit(1);
}

const src = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

// Drop every annotation key, at the envelope and one level in.
const strip = (obj) => {
  if (Array.isArray(obj)) return obj.map(strip);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([k]) => !k.startsWith('$comment'))
        .map(([k, v]) => [k, strip(v)]),
    );
  }
  return obj;
};

const out = strip(src);

// Substitute the host everywhere the placeholder appears.
const swap = (s) => s.replace(/dive-schedule\.PLACEHOLDER\.sslip\.io/g, host);
out.embed.url = swap(out.embed.url);
out.embed.origin = swap(out.embed.origin);
out.webhooks.endpointUrls = out.webhooks.endpointUrls.map(swap);
out.oauth.redirect_uris = out.oauth.redirect_uris.map(swap);

const serialized = JSON.stringify(out, null, 2);

if (serialized.includes('PLACEHOLDER')) {
  console.error('error: output still contains PLACEHOLDER — refusing to write a half-substituted manifest.');
  process.exit(1);
}

writeFileSync(outfile, serialized + '\n');

console.log(`wrote ${outfile}`);
console.log(`  embed.origin   ${out.embed.origin}`);
console.log(`  webhook        ${out.webhooks.endpointUrls[0]}`);
console.log(`  oauth redirect ${out.oauth.redirect_uris[0]}`);
console.log(`  permissions    ${out.permissions.length} (bare keys)`);
console.log('\nThese must match the box exactly:');
console.log(`  CSP_FRAME_ANCESTORS  -> the WORKSPACE origin (who may frame us), not this host`);
console.log(`  NEXT_PUBLIC_APP_ORIGIN -> https://${host}   (build arg, not runtime)`);
