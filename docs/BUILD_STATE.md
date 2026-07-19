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
