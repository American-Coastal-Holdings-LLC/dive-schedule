# Build State — Fresh-Chat Resume Point

**Read this first if you are picking up dive-schedule in a new session.** Then read
`docs/CONTRACT_IMPACT.md` (contract analysis + phased wiring roadmap) and `docs/OPEN_QUESTIONS.md`
(decisions the owner/platform still owe). Everything is on disk and pushed.

## TL;DR

The seed PWA is now a working **Next.js + NestJS + PostgreSQL** plugin, restructured for the EOS
multi-tenant platform, **built end-to-end and EOS-security-hardened**. It runs today entirely on
**dev stubs** (a local "fake EOS" harness); the real **cryptographic** handshake to EOS is
**deliberately deferred** (owner's call — see NEXT). Nothing is blocked; the app is fully
exercisable now via `/harness`.

Branch `main`, synced to `origin/main` (`AmericanCoastalHoldingsLLC/dive-schedule`). HEAD: `2824f80`.

## What the app is

A vendor-owned hull-cleaning **dive-ops ERP**, shipped as a **third-party plugin inside the EOS
multi-tenant SaaS platform** — embedded in an iframe in the EOS workspace, identity via a platform
bridge token, data per-installation-scoped. It is **white-labeled**: it looks like a complete
standalone product; EOS is the identity + data backbone. Authoritative contract: the live EOS docs
at **https://eos-developer-docs.vercel.app** (Vendor Integration Contract + Kickoff Block A). Our
conformance analysis: `docs/CONTRACT_IMPACT.md`. Internal build spec: `docs/ARCHITECTURE.md`.

## DONE (committed + pushed — do not redo)

1. **Foundation** (`05e36b0`, `81b055a`): api/ + web/ scaffolds, deps, Prisma schema + `init`
   migration (8 models, all `installationId`-keyed, migrated to `dive_schedule_dev`), `legacy/`
   reference extracts.
2. **Full app source** (`6c3a1fb`): NestJS api (auth/guards, 19 perms, 5 dev users, every route with
   server-side enforcement, ported domain logic, webhooks, platform stubs, seed) + Next.js web
   (bridge, api client, PermissionsProvider, 7 tabs + modals, `/harness`). Integrated live —
   **28/28 smoke green** (identity, permissions, tenant isolation, pay, POS atomicity, uninstall
   cascade). Live browser QA passed (5 users, permission-driven views, tenant isolation, theme push).
3. **EOS-security contract analysis** (`docs/CONTRACT_IMPACT.md`): 14-agent EOS-security-first
   conformance workflow (2 doc digests + 10 adversarial verifiers + completeness critic + EOS-vuln
   hunt). Headline: **backend tenant isolation is verified solid** (every query `installationId`-
   scoped, mass-assignment blocked, safeUrl/no-SSRF, logs redacted); exposure is at the webhook +
   bridge trust boundaries + the un-built crypto. §8 scorecard: **9 answered / 3 partial / 2
   unanswered**.
4. **Phase 0 hardening** (`2824f80`) — the platform-independent EOS-security fixes:
   - **Fail-closed dev stubs** (all 4: identity, webhook, directory, tenant) — refuse to boot outside
     a known dev/test env; production hard-blocked. Shared guard `api/src/common/dev-stub-guard.ts`.
   - Removed the `X-Dev-Signature: dev` global-constant default (rejects when unset).
   - `frame-ancestors` CSP on the **Next embed HTML** (was only on the API's JSON responses).
   - Bridge stops posting the identity token to `'*'` — pins `targetOrigin` + validates `event.origin`.
   - Adversarially reviewed: the first cut's guard was fail-**open** for any env name != exactly
     "production" → fixed to a default-deny allow-list, verified **9/9** matrix.
5. **Live EOS docs reviewed** — confirmed the analysis line-for-line (token semantics, `bridge/verify`,
   JWKS/alg-pin, OAuth2 PKCE, HMAC `v1:{ts}.{rawBody}` webhooks, `installation.deleted`, sensitive
   tier, 30-day deletion + attestation, §9 security MUSTs). The docs are a **living source** — build
   against them, not a downloaded copy.

6. **Brand + design-system pass** (this session) — turned the app from "a working seed" into a
   first-class American Coastal Holdings plugin alongside SprocketSuite:
   - **`web/src/lib/brand.ts`** — single source for product name/tagline/description/vendor/colour.
     The name is a **working title**; the rename is now a one-file edit. Nothing renders a literal.
   - **Token layer rewritten** (`web/src/app/globals.css`) — adopted the platform's contract names
     (`--bg`/`--surface`/`--text`/`--muted`/`--border`/`--primary`/…), with ~30 tokens **derived**
     from them via `color-mix()`. Dark mode is now six re-pointed inputs instead of ~50 hand-tuned
     literals. Old private names (`--ink*`, `--line*`, `--accent*`) were swept repo-wide.
   - **Real bug fixed — the host theme was being ignored.** The bridge applied whatever `vars` map
     arrived, but EOS sends a *semantic* object (`{mode, colors:{background, foreground, …}}`), so
     a pushed theme landed on properties no rule reads. Added `themeToCss` (bridge.ts) + the
     `data-eos-mode` hook. **Verified**: an alien slate/amber host palette now re-themes the whole
     app; measured contrast 8.7:1 subtext, 5.6:1 status chips, 7.6:1 active tab.
   - **Second bug fixed — dark fallbacks beat the derivation.** The no-`color-mix` dark literals sat
     after the `@supports` block at equal specificity, so under *OS dark + host light* the app
     rendered `#a7b4ca` text and `#1a2740` chips on white cards. Now guarded by `@supports not`.
   - **Third fix — elevation inverted between themes.** Segmented tracks used `--border-soft`,
     which is darker than the surface in light themes and lighter in dark, so the selected pill's
     raised affordance flipped. Added `--surface-sunken`, mixed toward `--bg` (recessed in both).
   - **Typography** — ships Inter Variable (47 KB, latin subset, one preload) via `next/font/local`,
     replacing the system stack that changed metrics per machine. Tabular figures for money.
   - **Chrome + a11y** — refined navy header (sheen + waterline detail), real tablist semantics
     (roving tabindex, arrow keys, `tabpanel`), and a global `:focus-visible` ring.
   - **`manifest.json`** — EOS plugin registration: 19 `dive.*` permissions with display copy, 4
     scopes with purposes, webhooks, OAuth redirect. **Embed host is a PLACEHOLDER** (no vendor box
     allocated). Also accepted the contract's renamed `installation.deleted` event alongside the
     old `installation.uninstalled` in the webhook controller, so declaring it cannot silently
     fail the deletion cascade.

   **Two open questions this raised** (both flagged in `manifest.json`): whether permission keys
   should carry the `dive.` prefix (SprocketSuite's manifest declares them unprefixed, suggesting
   the platform namespaces per plugin), and the real embed host/IP once a box exists.

7. **Deployability pass — the deferred crypto, now built.** Goal: EOS login → workspace → this app
   embedded as a plugin. Mirrors SprocketSuite throughout (owner's directive: same delivery and
   operation as its sibling, not a bespoke design).
   - **Permission namespacing** (`api/src/auth/permissions.ts`) — `fullKey`/`stripNamespace`/
     `assertSlugCoherence`, the three-form model from SprocketSuite. **This was a latent
     app-killer**: contract §2 registers bare keys into `ext.<vendorSlug>.<pluginSlug>.*`, so the
     wire delivers that form while every guard compares `dive.*`. Nothing throws — the sets never
     intersect, so every user would see an empty app the moment real identity landed.
   - **Manifest corrected to bare keys** (`jobs.view-all`, not `dive.jobs.view-all`).
   - **Real identity** (`auth/jwks-identity.provider.ts`) — JWKS with a pinned ES256/EdDSA
     allowlist (rejects `alg:none` + HS* confusion), issuer/expiry, `typ==='bridge'`,
     `pluginName===pluginSlug()`, then `POST /bridge/verify` for live state. Authorizes against the
     verify response, never the baked claim. Fails closed if the platform is unreachable.
   - **Real webhook HMAC** (`webhooks/webhook-verifier.ts`) — `{deliveryId}.{timestamp}.{rawBody}`,
     `v1=<hex>`, ±300s, constant-time compare, **kid→secret map** for the rotation overlap window.
     Required widening the verifier interface to take the raw body and `rawBody: true` in `main.ts`
     — the old headers-only interface made real verification impossible to implement.
     **Verified 8/8** (`scripts/dev-checks/webhook-signature.mjs`): valid, rotated-kid valid,
     cross-tenant body tamper, wrong secret, stale timestamp, unknown kid, malformed header, no
     headers.
   - **OAuth + scoped API** (`platform/oauth-client.ts`, `scoped-api-client.ts`) — Basic-auth header
     + JSON body (§4), `grant_type=installation`, in-memory token cache, one retry on generic 401,
     `PluginRevokedError` on the §6 kill-switch code. Authorization-Code+PKCE deliberately NOT built
     — nothing needs user-delegated access yet.
   - **Real directory + tenant** (`platform/directory.ts`, `tenant.ts`) — scoped-API reads. PII is
     nulled without sensitive-tier scope, so names fall back to user id and a missing timezone falls
     back to UTC **loudly** (it drives rotation due-dates and pay weeks).
   - **All three stub families are now opt-IN** (`USE_DEV_IDENTITY_STUB`, `USE_DEV_WEBHOOK_STUB`,
     `USE_DEV_PLATFORM_STUBS`); unset selects the real implementation. Boot logs which is active.
   - **Dockerfile + entrypoint** matching hosting-ops' actual contract (one image, port 8080, Caddy
     + Postgres siblings). Next serves 8080 and proxies `/api/*` + `/webhooks/*` to the loopback
     API, reusing the rewrite the app already develops against.
   - **Verified**: `NODE_ENV=production` now boots clean with all three real providers (it used to
     die on `DevStubDirectory`); `npm run dev` still boots all stubs. Both confirmed by running them.

   **Not done / blocked:** Docker image never built (Docker not installed on this machine — the
   Dockerfile is verified only by confirming every COPY source exists against a real build). No
   vendor box provisioned. Manifest not submitted; vendor/plugin slugs still proposed, not assigned.
   No end-to-end run against a live EOS — every crypto path is verified against the contract and the
   vendored devkit's reference implementation, not against the pilot.

## Interfaces we have ready (the seams)

Every EOS touchpoint is a clean interface with a **dev-stub** behind it; the app runs end-to-end on
these (the `/harness` proves it). The only thing NOT real is the crypto/network handshake:

| Interface | File(s) | Real version (deferred = crypto) |
|---|---|---|
| Identity ("who / tenant / perms") | `api/src/auth/identity.ts` + `dev-stub.provider.ts` | JWKS verify + `POST /bridge/verify` |
| Front-end bridge | `web/src/lib/platform/bridge.ts` | EOS bridge SDK (MessageChannel) |
| Directory (users on an installation) | `api/src/platform/directory.ts` | `users.read` scoped API |
| Tenant profile (name, timezone) | `api/src/platform/tenant.ts` | `tenant.read` scoped API |
| Webhook verifier | `api/src/webhooks/webhook-verifier.ts` | HMAC-SHA256 signature |
| Permissions + guards | `api/src/auth/*.guard.ts`, `permissions.ts` | **already real** |
| Multi-tenant data scoping | every Prisma query | **already real** |

## NEXT (deferred / not started)

**Crypto wiring is deferred per the owner** ("if it's a feature involving crypto we can skip it"):
- **Phase 1** — real webhook signature (HMAC), raw-body binding, ±5-min + idempotency,
  `installation.uninstalled` → `installation.deleted`. *(Top EOS-critical cross-tenant item; still open.)*
- **Phase 2** — real identity: JWKS verification + `bridge/verify`; OAuth2 PKCE client + encrypted
  per-installation token/secret store.
- **Phase 3** — scoped-API clients (`notifications.send`, `files.*`, `subscription.read`, `users.read`).

Full phased roadmap + severity-ranked findings: `docs/CONTRACT_IMPACT.md`.

**Non-crypto work available now** (does not need EOS live):
- **Marketing site** + **branded-domain app surface** (standalone front door with an EOS-redirect
  login) — net-new, not built. See `docs/OPEN_QUESTIONS.md` §1 (login-form compliance boundary).
- Scoped-API **interface stubs** (notifications / files / subscription) — buildable without crypto.
- The plugin **manifest** (registration file, contract §2).
- **Permission-catalog reconciliation** — our 19 `dive.*` vs the kickoff digest's 17.

## Gotchas / environment

- Standalone vendor repo at `/Users/jv/Desktop/Projects/dive-schedule` (sibling of `EZDock`, the EOS
  platform workspace). Remote `origin` = `AmericanCoastalHoldingsLLC/dive-schedule`, branch `main`.
- **The owner now authorizes committing + pushing** (established this session). **No AI trailer** in
  commit messages. Stage by explicit path.
- Dev ports: api **4310**, web **4311**. `npm run dev` runs both. `api start:dev` sets
  `NODE_ENV=development` so the fail-closed stub guard passes locally (or set `ALLOW_DEV_STUBS=true`).
- Postgres via Homebrew trust auth; role in the URL (`postgresql://jv@localhost:5432/dive_schedule_dev`).
  DB is migrated + seeded — **do NOT reset**.
- **Do NOT put EOS platform-internal docs in this repo** (esp. the `_`-prefixed files from the platform
  doc bundle). See project memory.
- `docs/BUILD_PROVENANCE.md` is the **Fable review handoff** — what's self-tested vs. UNreviewed.
