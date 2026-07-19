# Vendor Integration Contract — Impact & Wiring Roadmap

**Status:** analysis of the platform's Vendor Integration Contract (v0.x — provisional) against this
build. Produced through an **EOS platform-security lens**: this plugin is a trust boundary for the
multi-tenant platform, so the organizing principle is *no vendor-side wiring may introduce an EOS or
cross-tenant vulnerability*. Every conflict below was verified against the actual code, not just the
docs. Companion to [`ARCHITECTURE.md`](./ARCHITECTURE.md) (our build spec),
[`../PLATFORM_INTEGRATION_NEEDS.md`](../PLATFORM_INTEGRATION_NEEDS.md) (our needs report, §8 = 14 open
questions), and [`BUILD_PROVENANCE.md`](./BUILD_PROVENANCE.md).

> The contract's resource/event/scope surface (§7/§8) is **provisional** and will grow additively
> before v1.0. Wire to the shape now; confirm the provisional surface before deep work.

## Bottom line

The contract **validates the architecture** — the interface seams, permission-driven server-side
enforcement, and multi-tenant model are the right shape. An adversarial audit of our own code
confirmed the best possible headline: **backend tenant isolation is solid** — every Prisma query is
`installationId`-scoped (including by-id lookups, the backup dump, and POS), mass-assignment is
blocked, `safeUrl` prevents XSS/SSRF, and logs are redacted.

The entire exposure lives at **two trust boundaries** (the **webhook receiver** and the **iframe
bridge**) plus the **real-verification layer not yet built**. Because nothing is wired to real EOS
yet, these are *must-be-true-before-go-live*, not live breaches — with one exception now fixed: the
dev stubs previously did not fail closed.

Two findings rate **EOS-CRITICAL**, both in the webhook path.

## §8 open-questions scorecard — 9 answered · 3 partial · 2 unanswered

| Answered | Partial | Unanswered |
|---|---|---|
| Q1 email → `notifications.send` · Q2 timezone in `tenant.read` · Q3 user profile via `users.read` (PII sensitive-tier) · Q6 no platform payments (POS stays records-only) · Q7 subscription states `{trial, active, suspended, cancelled}` · Q8 30-day delete + attestation · Q10 blobs → `files.*` · Q12 sandbox tenant + webhook simulator · Q13 token lifetimes (bridge 5m / access 10m / refresh 30d rotating) | Q4 crew onboarding/invite · Q5 acting-on-behalf (app-level audit) · Q9 iframe caps (no mailto/download/print primitive) | **Q11** staff→workspace handoff (synthetic user & perms) · **Q14** offline/PWA in-iframe |

## What the contract now decides (shapes to build to)

- **Identity:** 5-min signed JWT (`typ:"bridge"`, `aud=installationId`), ES256/EdDSA via JWKS — **and**
  a mandatory `POST /plugin-api/v1/bridge/verify` for *live* effective permissions (do not authorize
  off the baked claim).
- **Bridge:** the published EOS npm SDK over a `MessageChannel` **port**, origin-pinned both ways.
- **Backend↔platform:** OAuth2 Auth-Code + PKCE, per-installation `client_secret`, 10-min access /
  30-day rotating refresh, scoped calls to `/plugin-api/v1/{pluginName}/*` (no tenant id in requests).
- **Webhooks:** HMAC-SHA256 over `v1:{timestamp}.{rawBody}`, `X-EOS-Webhook-*` headers, ±5-min window,
  constant-time compare, idempotency dedupe, manifest-declared endpoints.
- **Manifest:** plugin = data, not code — bare permission keys registered as `ext.<vendor>.dive.*`,
  `scopes`/`sensitiveScopes`, webhook endpoints, `redirect_uris`, `majorVersion`.

## Verified findings, ranked by EOS-security impact

| # | Severity | Finding | Where | Cross-tenant? | Status |
|---|---|---|---|---|---|
| 1 | **EOS-CRITICAL** | Webhook spoofing → cross-tenant cascade delete. Verifier gets headers only (can't bind sig to body); handler trusts `body.installationId`; `deleteInstallation` is an immediate hard cascade; `main.ts` has no `rawBody`, so even a correct HMAC verifier can't get the bytes. No replay/idempotency. | `webhooks.controller.ts`, `webhook-verifier.ts`, `main.ts`, `tenancy.service.ts` | **Yes — destructive** | open (Phase 1) |
| 2 | **EOS-CRITICAL** | Dev stubs were wired unconditionally and only warned — no production guard. | `dev-stub.provider.ts`, `webhook-verifier.ts` | **Yes — full breach** | **FIXED (Phase 0)** |
| 3 | **CRITICAL to get right** | Identity verification is a stub (expected). The swap needs *both* JWKS+alg-pin (reject `alg:none`/HS*) *and* `bridge/verify` for live perms/revocation — JWKS alone leaves revocation/kill-switch/subscription stale. | `dev-stub.provider.ts`, `permissions.guard.ts` | Yes if wrong | open (Phase 2) |
| 4 | **MAJOR** | Bridge posted to `'*'` and never validated `event.origin` → identity-token exfil / forged token & theme injection. | `bridge.ts`, `harness/page.tsx` | Boundary | **FIXED (Phase 0)** |
| 5 | **MAJOR** | `frame-ancestors` was set on the API (JSON), not the Next embed HTML (which shipped no CSP) → clickjacking surface. | `main.ts` vs `next.config.ts` | Clickjacking | **FIXED (Phase 0)** |
| 6 | **MAJOR** | Wrong webhook event name — cascade fires on `installation.uninstalled`; real event is `installation.deleted` → real deletions no-op → data retained past the window. | `webhooks.controller.ts` | Privacy/retention | open (Phase 1) |
| 7 | **MEDIUM** | Sandbox-reality gap — harness over-grants (`allow-same-origin` etc.), so QA never tested the real `allow-scripts allow-forms`; `mailto`/download/print and the same-origin `/api` layer break under it, and `mailto` pushes customer PII client-side instead of `notifications.send`. | `harness/page.tsx`, `RecordModal`, `SalesTab` | PII egress | open (Phase 4) |
| 8 | **MEDIUM** | OAuth2 + scoped-API channel entirely absent, and with no interface seam (unlike the 3 stubs). Largest future attack surface: per-install secret storage, refresh rotation/reuse-detection. | `platform/*` | Secret handling | open (Phase 2/3) |
| 9 | **MEDIUM** | PII assumed always-present — `customerEmail`, crew `phone`/`photo` are sensitive-tier; no `sensitiveScopes[]` declared; sync backup dump pulls all customer PII in one request (should be `export.read` async). | jobs/records/crew, `finance.service.ts` | Data minimization | open (Phase 3/5) |
| 10 | **MINOR / intra-tenant** | Perm namespace `dive.*` vs `ext.<vendor>.dive.*` (fails **closed** — 403, not a leak); `records.view` sees all records without job-scope; pay `earning/payRate`→price derivable; DTO strips-not-rejects; base64 photos vs `files.*`; no durable audit/attestation. | various | No | open (Phase 5) |

**Verified clean (probed, no issue):** by-id tenant scoping across every model + backup + POS;
mass-assignment (`whitelist:true` + explicit mapping; `onBehalfOfUserId` gated *and* directory-checked);
`safeUrl`/no-SSRF/no `dangerouslySetInnerHTML`; pino redaction of auth/PII; timezone already modeled.

## Phase 0 — hardening applied (platform-independent)

Three fixes that need nothing from the platform and reduce real cross-tenant risk now:

1. **Fail-closed dev stubs** — `DevStubIdentityProvider` and `DevStubWebhookVerifier` now **throw on boot
   when `NODE_ENV=production`** instead of merely warning. Verified: the app refuses to boot in
   production (throws, exits non-zero, never binds the port) and boots normally in dev. *(Fix #2.)*
2. **`frame-ancestors` on the Next embed HTML** — `web/next.config.ts` sets
   `Content-Security-Policy: frame-ancestors`, default `'self'` (allows the same-origin dev harness),
   `FRAME_ANCESTORS`-configurable for the EOS workspace origin + vendor domain in production. *(Fix #5.)*
3. **Bridge origin-pinning** — `bridge.ts` (and the dev harness) stop posting to `'*'`: they pin
   `targetOrigin` to the host origin and validate inbound `event.origin`. `NEXT_PUBLIC_PLATFORM_ORIGIN`
   sets the production origin; falls back to same-origin for the dev harness. *(Fix #4.)*

## Wiring roadmap (phased by dependency & EOS-security priority)

- **Phase 1 — webhook security** (the only destructive cross-tenant primitive): enable raw-body capture;
  change `WebhookVerifier.verify(headers)` → `(rawBody, headers)`; HMAC over `v1:{ts}.{rawBody}`,
  constant-time, ±5-min, idempotency dedupe; derive `installationId` from the **signed** context, never
  the body; rename to `installation.deleted`; add a grace window + deletion attestation.
- **Phase 2 — identity** (foundation; dependency-ordered): build the **OAuth2 PKCE per-install client +
  encrypted secret store first** (it *gates* `bridge/verify`); then the JWKS-verifying `IdentityProvider`
  + the `bridge/verify` live-permissions call; resolve `name` via `users.read`; invert `PermissionsGuard`
  to deny-by-default.
- **Phase 3 — scoped-API adapters** replace the stubs: `directory`/`tenant` → `users.read`/`tenant.read`;
  add `notifications.send` (kills `mailto`), `files.*` (kills base64 photos), `export.read` async (kills
  the sync backup dump), `audit.write`.
- **Phase 4 — bridge SDK + sandbox reality:** adopt the EOS bridge client (MessageChannel); fix
  `mailto`/download/print under the strict sandbox; allowlist theme CSS-vars + ship a frontend CSP.
- **Phase 5 — manifest, subscription, namespace:** author the manifest (bare keys, scopes,
  sensitiveScopes, webhooks, redirect_uris, majorVersion); add the `ext.<vendor>.dive.*` mapping at the
  guard boundary; reconcile the permission catalog; wire `subscription.read` + the 4 webhooks + trial UX.
- **Phase 6 — listing/SOP:** security self-attestation + security/support contacts, git-history secret
  scan (clean-structure is already strong).

## Send back to the platform before the v1.0 freeze

The §7/§8 surface is provisional — lock these: **Q11** staff→workspace handoff (synthetic user & perms,
so staff don't leak into crew pickers/pay), **Q14** offline/PWA stance, **Q4** tenant-crew onboarding +
identity mapping, **Q5** on-behalf convention, **Q9** iframe fallbacks for mailto/download/print.

## Already compliant (do not re-litigate)

Architecture aligned; backend tenant isolation proven; mass-assignment blocked; `safeUrl`/no-SSRF/no
`dangerouslySetInnerHTML`; log redaction; timezone modeled; clean frontend/backend structure with README
+ `.env.example`s and no committed secrets; permission-driven rendering that the server enforces; the
seed's PIN/trial/unlock/secrets already dropped.

---

*How this was produced: parallel readers digested the contract, security/dataflow spec, and platform
architecture; ~10 load-bearing conflict claims were adversarially verified against the actual code
(default-to-refuted); a completeness critic and an EOS-vulnerability hunt audited our own code for
cross-tenant holes. Findings here reflect the verified results. This document is analysis + roadmap; it
contains no platform-internal review material.*
