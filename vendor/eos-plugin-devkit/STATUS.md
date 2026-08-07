# eos-plugin-devkit — STATUS

**Date:** 2026-07-24 (was 2026-07-19) · **State:** **ALL SIX deliverables IMPLEMENTED + tested.** #1–#5 done 2026-07-19 (fix-plan Track 3); **#6 (sample plugin) built + smoke-verified 2026-07-24 (Opus worker)** — see row #6 and "What remains → #6 CLOSED". Local-first; no commits/pushes.

This is the EOS plugin developer kit: the bridge client + verify helpers + stub kit + sample app that vendor apps build against, per `../platform-plugins/02-vendor-integration-contract.md` and `../platform-plugins/build-kickoffs/P2-1-developer-kit.md`. Fix-plan basis: `../platform-plugins/AUDIT-2026-07/03-fix-plan.md` Track 3 ("dev-kit completion").

## Deliverable table

| # | Deliverable | State |
|---|---|---|
| 1 | **Bridge client** (`packages/bridge-client`, `@eos/plugin-bridge`) — real + stub modes, full §5 bridge JS API | **DONE.** `MessageChannel` handshake on the `window` leg (host-sent port, `event.origin` pinned/validated, mismatches silently dropped), all subsequent traffic over the dedicated port. All 7 methods (`getIdentityToken`, `getThemeTokens`, `requestNavigate`, `resize`, `openModal`, `toast`, `syncUrl`) implemented for both modes, sharing one request/response engine. Stub mode runs fully offline (synthesizes its own internal `MessageChannel`, answers from `StubBridgeConfig`) — a vendor's embed code is identical between modes. Builds clean; 6/6 tests pass (handshake happy-path + origin-mismatch + timeout + stub round-trip). |
| 2 | **Verify package** (`packages/verify`, `@eos/plugin-verify`) — server-side token + webhook verification | **DONE.** `verifyBridgeToken()` pins `algorithms: ['ES256','EdDSA']` (rejects `alg:none`/HS* before any signature check — RFC 8725), checks `iss`/`aud`/`exp`/custom `typ==="bridge"` claim. `createRemoteJwks()`/`createLocalJwks()` for JWKS resolution (contract §5 step 1). `verifyBridgeTokenLive()` POSTs `/plugin-api/v1/bridge/verify` (§5 step 3, the cardinal-rule live re-check). `verifyWebhookSignature()` implements §8 **as amended 2026-07-19** (see Decisions). Builds clean; 10/10 tests pass (1 positive + all negative-fixture rejections with exact error-code assertions + 6 webhook cases). `packages/verify/tsconfig.json`'s previously-missing `src/` now exists and compiles. |
| 3 | **Webhook simulator CLI** (`packages/stub-kit/src/webhook-sim.ts` + `bin/webhook-sim.ts`, `eos-webhook-sim`) — contract §8, §13 | **DONE.** Signs and POSTs a sample webhook delivery to a vendor's local receiver, reusing `@eos/plugin-verify`'s `computeWebhookSignature()` for the HMAC (contract §8 as amended 2026-07-19 — no crypto reimplemented). The default synthesized payload matches contract §8's worked envelope EXACTLY — `{ id, type, schemaVersion, createdAt, installationId, data: { resourceId } }`, with the body `id` always equal to the `X-EOS-Webhook-Id` delivery id (fixed in the 2026-07-19 adversarial-review pass; was previously an independent `{event, id, ...}` shape). Flags: `--event` (+ the full §8 provisional event list) or `--payload`/`--payload-file` for a custom body sent verbatim (no re-serialization); `--url`, `--secret` (repeatable as `kid=value` pairs for rotation-overlap testing per §8/§10 — same pass), `--kid`, `--delivery-id`; failure-mode switches `--bad-signature` (corrupts the secret, keeps `v1=<hex>` well-formed), `--stale-timestamp` (pushes the timestamp 600s into the past, past the 300s tolerance), `--duplicate` (resends the byte-identical delivery — same id/body/signature/timestamp — for `Idempotency-Key` dedupe testing). `--help` is self-contained (usage, every flag, defaults, worked examples incl. the secret-pool form). Runs directly from TypeScript source (`node packages/stub-kit/src/bin/webhook-sim.ts`) or from the build (`node packages/stub-kit/dist/bin/webhook-sim.js`) — see "Run commands" below. Builds clean; 16/16 tests pass (contract-envelope-shape + secret-pool unit tests + true CLI-process spawn tests against a local HTTP receiver, asserting the delivered bytes independently verify via `@eos/plugin-verify`). |
| 4 | **Local OAuth stub server** (`packages/stub-kit/src/oauth-stub.ts` + `bin/oauth-stub.ts`, `eos-oauth-stub`) — contract §4, §5 step 3, §13, Appendix | **DONE.** In-memory `GET /plugin-api/v1/oauth/authorize` (Authorization Code + PKCE, S256-only) + `POST /plugin-api/v1/oauth/token` (code+PKCE exchange; rotating refresh with reuse-detection → whole-family revoke, contract §4) + `GET /plugin-api/v1/.well-known/jwks.json` (serves `@eos/plugin-stub-kit`'s own `getTestJwks()` directly) + `POST /plugin-api/v1/bridge/verify` (configurable fixture responder in the exact Decision #2 shape — the `active:false` case now blanks `tenantId`/`userId`/`permissions` matching contract §5's worked example exactly, cross-tested against `@eos/plugin-verify`'s own `verifyBridgeTokenLive()` client). Access tokens minted via this package's `mintAccessToken()` — same ES256 test keypair throughout the kit. **Token-endpoint client authentication strictly enforces contract §4 (C11) by default** (`client_secret_basic` + JSON body only — a non-Basic-auth or non-JSON request is rejected with a conformance error) since the 2026-07-19 adversarial-review pass; the previous silent form-encoded/body-credential leniency survives only behind an explicit `lenient: true` / `--lenient` opt-in (Decision #6). Config via flags or env (port, host, client id/secret, redirect-uri allowlist, tenant/installation/user/plugin-name fixtures, permissions, default scope, `--inactive` to simulate a killed installation, `--lenient` for legacy-client testing). Each server instance gets its own isolated in-memory store — safe to run many in one test process. Runs standalone with one documented command — see "Run commands" below. Builds clean; 12/12 tests pass: happy path (authorize → token → jwks → bridge/verify, the last cross-checked through `@eos/plugin-verify`'s live client), PKCE-mismatch rejection, refresh-reuse → family revoke (incl. proving the *newest* token also dies once the family is revoked), strict-by-default token-endpoint-auth rejection + `--lenient` acceptance, plus bonus coverage (non-S256 challenge method rejected, auth-code single-use, per-instance state isolation, `--inactive` simulation with the corrected blanked-fields shape). |
| 5 | **Stub-kit test JWKS + sample tokens** (`packages/stub-kit`, `@eos/plugin-stub-kit`) — new package, did not exist before this pass | **DONE.** Process-local ES256 test keypair (never persisted to disk), its public JWKS document, `mintBridgeToken()` / `mintAccessToken()` sample-token minters, and `mintBridgeNegativeFixtures()` producing 8 named negative fixtures: `algNone`, `wrongAlg` (HS256 algorithm-confusion), `expired`, `wrongAudience`, `wrongIssuer`, `wrongTyp`, `badSignature`, `tamperedPayload` — covering the task's required 6 plus 2 more the contract's §5 step 2 also mandates checking. Builds clean; 5/5 self-tests pass; all 8 fixtures independently proven-rejected by `@eos/plugin-verify` (deliverable #2's test suite). |
| 6 | **Sample plugin** (`examples/sample-plugin`) — runnable Next.js embed + NestJS backend reference, `manifest.json`, README | **DONE 2026-07-24 (Opus worker).** Next.js (14.2.35) embed UI on the stub bridge (`web/`, `startEmbedSession` shared with the smoke) + NestJS (10.4.22) backend (`api/`) that verifies bridge tokens with `@eos/plugin-verify` (JWKS → `verifyBridgeToken` → `verifyBridgeTokenLive`) and **gates a demo action on the LIVE `bridge/verify` response** — the cardinal rule is proven, not just described (a token whose *baked* claim carries `reports.export` is DENIED because the live response withholds it). Also: full OAuth2 client (authorize→token→scoped `/users`→refresh rotation; reuse→family-revoke shown directly against the stub), a webhook receiver (`{ rawBody: true }` → `verifyWebhookSignature` → idempotency dedupe), a `manifest.json` mirroring contract §2's field set exactly, a `.env.example` (dev placeholders only), and a README with the directory map + run commands + smoke. Backend built by `tsc` (ESM, `emitDecoratorMetadata`) and run from `dist` so NestJS DI works; the ESM-`.ts` `@eos/*` packages import cleanly under Node 26. **Scripted smoke `npm run smoke` = 22/22 checks green, fully offline (in-process stubs + backend, no browser).** Standalone/manual flow (separate `eos-oauth-stub` process + `node api/dist/main.js` + `next dev`) verified live. Grep-gate clean (no EOS service hostnames/`:300x`; only relative `/plugin-api/v1` paths + localhost stub addresses + vendor-placeholder `sample-vendor.example` manifest URLs). Root gates unchanged: build clean, typecheck clean, **test 49/49** (sample has no `test` script → not counted). |

## Build + test output (exact counts, 2026-07-19 — after the adversarial-review fix pass)

```
npm run build       → 3/3 packages compile clean (bridge-client, stub-kit, verify)
npm run typecheck   → 3/3 packages clean (tsc --noEmit)
npm run test        → 49/49 tests pass, 0 failures
  @eos/plugin-bridge        6 pass / 0 fail   (unchanged from before this pass)
  @eos/plugin-stub-kit     33 pass / 0 fail   (21 pre-existing + 12 new: 7 buildSamplePayload/contract-envelope-shape
                                               + kid=value secret-pool tests in webhook-sim.test.mjs, 5 strict-by-default /
                                               --lenient token-endpoint-auth tests in oauth-stub.test.mjs — tokens.test.mjs
                                               unchanged at 5)
  @eos/plugin-verify       10 pass / 0 fail   (unchanged from before this pass)
```

The prior pass's 37/37 all still pass unchanged; 12 new tests were added, all in `packages/stub-kit/test/` (`webhook-sim.test.mjs`, `oauth-stub.test.mjs`), covering this fix pass's items 1, 2, 5, and 6 (see "Decisions" #6 and the contract-envelope/kid-pool/inactive-shape fixes below).

Grep-gate (no EOS identity/authorization/console/workspace URLs or `eos-*` service hostnames anywhere under `packages/`): **clean, 0 matches** (re-run after adding #3/#4; the OAuth stub binds to a caller-configurable host/port, defaulting to `127.0.0.1`, and every route is a relative `/plugin-api/v1/...` path — no host is ever hardcoded).

## Run commands

**Webhook simulator CLI** (`eos-webhook-sim`) — one of:
```bash
# From TypeScript source directly, no build required (Node 26's native TS support):
node packages/stub-kit/src/bin/webhook-sim.ts --help
node packages/stub-kit/src/bin/webhook-sim.ts --url http://localhost:4000/eos/webhooks --secret whsec_dev_123

# From the build (after `npm run build`):
node packages/stub-kit/dist/bin/webhook-sim.js --url http://localhost:4000/eos/webhooks --bad-signature

# Or, once `npm install` has linked the workspace bin (after a build exists):
./node_modules/.bin/eos-webhook-sim --help
```

**Local OAuth stub server** (`eos-oauth-stub`) — one of:
```bash
# From TypeScript source directly:
node packages/stub-kit/src/bin/oauth-stub.ts --help
node packages/stub-kit/src/bin/oauth-stub.ts                       # listens on :5102 by default (STUB_OAUTH_PORT)

# From the build:
node packages/stub-kit/dist/bin/oauth-stub.js --redirect-uri http://localhost:5100/oauth/callback

# Or via the linked bin:
./node_modules/.bin/eos-oauth-stub --inactive
```
Both are also importable programmatically (not just as CLIs) via `@eos/plugin-stub-kit/webhook-sim` (`sendWebhookDelivery`, `buildDeliveryHeaders`, `buildSamplePayload`) and `@eos/plugin-stub-kit/oauth-stub` (`createOAuthStubServer`) — this is how `packages/stub-kit/test/*.test.mjs` exercises them without shelling out (except the CLI-specific tests, which genuinely spawn the bin as a child process to prove the actual command line works).

## Decisions

Wire-level details the contract (`02-vendor-integration-contract.md`) leaves unspecified, resolved with the simplest standards-conforming answer, per this pass's instructions:

1. **Webhook signed-content form — BINDING RULING (owner, 2026-07-19), not a default-invented decision.** The contract text at the time of this build still reads `v1:{timestamp}.{rawBody}`; the owner ruled the actual form is now **`{deliveryId}.{timestamp}.{rawBody}`** (Standard-Webhooks style — this is fix-plan item 2.4's "Standard-Webhooks signed-content adoption" ruled *yes*). Implemented in `@eos/plugin-verify`'s `buildWebhookSignedContent()`/`computeWebhookSignature()`/`verifyWebhookSignature()`, each commented `contract §8 as amended 2026-07-19`. **Left unchanged:** the `X-EOS-Webhook-Signature: v1=<hex>` header name and hex encoding — the amendment only changed what is signed, not how the signature is carried. `02-vendor-integration-contract.md` itself has NOT been edited by this pass (out of scope — that's Track 2 / fix-plan 2.4's job); this STATUS.md and inline code comments are the record until the contract doc is amended.

2. **`bridge/verify` response shape.** Contract §5 step 3 and §7 describe *what* the live check returns ("current effective permissions"; installation active/subscription live/not killed/`jti` not revoked) in prose only — no worked JSON example exists yet (§7 itself is marked provisional; fix-plan 2.1 tracks adding worked examples). `verifyBridgeTokenLive()` POSTs `{ "token": "<jwt>" }` and expects back `{ active: boolean, installationId: string, tenantId: string, userId: string, permissions: string[] }`. Chosen as the minimal shape that satisfies every check the contract text describes. Should be reconciled against the real platform's implementation (or fix-plan 2.1's worked example, once written) when either exists — flagging so kit and docs don't silently drift, per fix-plan Track 3's stated dependency on 3.2 feeding 2.1.

3. **Sample OAuth access-token claim shape.** Contract §4 fixes the access token's lifetime (10 min) and `aud = installationId` but, like above, publishes no full claim list. `mintAccessToken()` mints `{ typ: "access", iss, aud, scope: string[], iat, exp, jti }` — `typ` mirrors the bridge token's discriminator (so a verifier can tell the two apart, which §5 step 2 explicitly requires being able to do), `scope` mirrors §4's granted-scope-is-an-array semantics. No verifier for access tokens was built in `@eos/plugin-verify` — the contract only requires the vendor's *backend* to verify **bridge** tokens (§5); access tokens are simply presented as `Authorization: Bearer` to the platform, which verifies them itself (§6). Minting-only is therefore in-contract; inventing a vendor-side access-token verifier would not be.

4. **Negative-fixture scope.** The contract's own §13 list of required negative cases is bridge-token-specific (`alg:none`, wrong `aud`, wrong `typ`, expired) — it does not ask for negative *access*-token fixtures, consistent with Decision 3 (nothing in-repo verifies access tokens). `mintBridgeNegativeFixtures()` covers bridge tokens only, plus `wrongIssuer` and `badSignature`/`tamperedPayload` as directly-contract-grounded extras (§5 step 2 also requires checking `iss`, and RFC 8725-style signature-integrity checks are implied by "verify server-side").

5. **JWKS caching parameters.** Contract §5 step 1 says "cache by `kid`... keys rotate with dual-publish overlap" but doesn't fix a cooldown/timeout number. `createRemoteJwks()` defaults to a 300s refetch cooldown and a 5000ms fetch timeout (both overridable) — conservative, standard `jose` defaults in the same range.

6. **`POST /plugin-api/v1/oauth/token` client-authentication strictness — dev-kit adversarial-review fix (2026-07-19).** The stub originally accepted `client_secret_basic` (contract §4 C11's canonical form) but ALSO silently accepted body-embedded `client_id`/`client_secret` and `application/x-www-form-urlencoded` bodies as fallbacks — more permissive than the contract, which would let a vendor build a non-conforming client against this stub without ever finding out. Fixed: the stub now **strictly enforces §4 (C11)** by default — `Authorization: Basic base64(client_id:client_secret)` + a JSON body only; a non-Basic auth attempt or a non-JSON body is rejected with a conformance error naming the offending requirement. The old lenient behavior survives only behind an explicit `lenient: true` server option (CLI: `--lenient`), documented as legacy/non-conforming-client testing only. Implemented in `packages/stub-kit/src/oauth-stub.ts`'s `handleToken()`; covered by `packages/stub-kit/test/oauth-stub.test.mjs`'s strict-mode-rejection and `--lenient`-acceptance tests.

## What remains

**Nothing — all six deliverables are built.** #6 closed 2026-07-24 (record below).

### #6 Sample plugin — CLOSED 2026-07-24 (Opus worker)

`examples/sample-plugin/` — a runnable Next.js embed + NestJS backend reference, `manifest.json`, `.env.example`, README, and a scripted offline smoke. Covers P2-1 quality-gate items (a) embed/handshake, (b) server-side bridge-token verify + live gating, (c) webhook verify/dedupe, and (d) the OAuth flow against the #4 OAuth stub.

**Layout.** `api/` NestJS 10 backend (`main.ts` `bootstrap()`; `eos/verify.service.ts` = §5 steps 1-3; `bridge.controller.ts` = the live-gated demo action; `oauth.service.ts`/`oauth.controller.ts` = §4/§6 client; `webhook.controller.ts` = §8 receiver; `dev.controller.ts` = dev-only bridge-token minter). `web/` Next.js 14 embed (`app/page.tsx`, `lib/embedBridge.ts` shared with the smoke, `lib/branding.ts`). `manifest.json` mirrors §2's field set exactly (short `permissions[].key`, platform `scopes[]`, `sensitiveScopes: ["users.read"]`, `embed`, `webhooks` limited to the §8 frozen events, `oauth.redirect_uris`).

**Run commands (from `examples/sample-plugin`, or `-w @eos/sample-plugin` from the kit root):**
```bash
npm run smoke        # build:api then node smoke/smoke.mjs — 22/22 checks, fully offline
npm run build        # tsc (api) + next build (web)
npm run typecheck    # tsc --noEmit for api + web
# manual/browser flow (3 terminals):
node packages/stub-kit/src/bin/oauth-stub.ts --port 5102 --plugin-name sample-plugin \
     --permissions ext.sample-vendor.sample-plugin.reports.read   # from kit root
npm run dev:api      # backend on :5101 (devMode → verifies against stub-kit test JWKS)
npm run dev:web      # embed UI on :5100  → open http://localhost:5100
```

**Counts (recorded before → after adding #6):**
- Root `npm run build`: 3/3 packages → **4/4 workspaces** (adds the sample: `tsc` api + `next build` web), clean.
- Root `npm run typecheck`: 3/3 → **4/4 workspaces**, clean.
- Root `npm run test`: **49/49 → 49/49 unchanged** (sample-plugin defines no `test` script; its verification is the `smoke` script, not the unit-test gate).
- Sample `npm run smoke`: **22/22 checks green** (a: 4, b: 7, c: 4, d: 7). Standalone two-process flow (separate `eos-oauth-stub` + `node api/dist/main.js`) also verified live.
- Grep-gate: **clean** — 0 EOS service hostnames / `:300x` ports; only relative `/plugin-api/v1` paths, localhost stub addresses, and vendor-placeholder `*.sample-vendor.example` manifest URLs (the vendor's own HTTPS endpoints, §2-required).

**Engineering notes.** NestJS needs `tsc`-emitted decorator metadata, so the backend compiles to `dist` (ESM, `emitDecoratorMetadata`) and runs from there — Node 26's native type-stripping does not emit that metadata. The ESM-`.ts` `@eos/*` packages import cleanly into the compiled ESM backend at runtime. `NestFactory.create(..., { rawBody: true })` gives the webhook receiver the exact bytes the §8 HMAC must cover. `@eos/plugin-stub-kit` is imported **lazily and dev-only** (dev-token minter + dev JWKS), so production never loads it.

**Contract ambiguities flagged (not silently invented) — all inherited from this kit's own Decisions above, nothing new introduced:**
- `bridge/verify` response shape: the sample relies on `@eos/plugin-verify`'s `{ active, installationId, tenantId, userId, permissions }` (Decision #2 — §7 publishes no worked JSON for it). If the real platform differs, only the verify package changes.
- Access-token claim shape (Decision #3): the OAuth client only ever *presents* the access token as a Bearer credential and never decodes it (§4 C12 says you need not), so the sample takes no dependency on it.
- `{pluginName}` scoped-route slug set to `sample-plugin` (the platform assigns the real slug at onboarding).
- Dev-only JWKS source: because the browser's bridge token is minted by the sample's own `/dev/bridge-token` in dev, the backend verifies against the stub-kit test JWKS in dev (`config.localJwks`) and the platform's live JWKS endpoint in production — a single config-driven line in `verify.service.ts`, documented in the README.
