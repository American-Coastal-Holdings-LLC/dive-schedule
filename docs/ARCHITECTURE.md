# Dive Schedule — Restructured Architecture (contract-pending build)

This document is the **binding internal contract** for the restructured app: repo layout, dev
identity model, bridge protocol, DB schema, and the full HTTP API. The platform's Vendor
Integration Contract (v0) has not arrived yet — every platform-facing surface here is a thin
interface with a clearly-marked dev stub, designed to be rewired without touching feature code.
See `PLATFORM_INTEGRATION_NEEDS.md` for the platform-facing needs report and
`legacy/index.html` for the original single-file seed (read-only reference).

## Stack (aligned with the EOS platform, per the kickoff amendment)

- **`web/`** — Next.js (App Router, React, TypeScript). The UI rendered inside the platform
  iframe. Dev port **4311**.
- **`api/`** — NestJS (TypeScript). Owns ALL data decisions. Dev port **4310**.
- **PostgreSQL** via **Prisma** (this vendor app owns its own DB + migrations). Local dev DB:
  `dive_schedule_dev` (`postgresql://localhost:5432/dive_schedule_dev`, OS-trust auth —
  already created).
- Root `package.json` (no workspaces — two independent apps): `npm run dev` runs both via
  concurrently; committed `.prettierrc` at root; `api` uses prettier + `typecheck`
  (EOS backend convention), `web` uses `next lint` + `typecheck`.

```
api/      NestJS backend — one obvious entry point: api/src/main.ts
web/      Next.js frontend — one obvious entry point: web/src/app/page.tsx (+ /harness page)
legacy/   The original seed PWA, unmodified. Never edit; reference only.
docs/     This file.
```

The web app calls the API **same-origin at `/api/*`** via a Next.js rewrite proxy
(`next.config.ts`: `/api/:path*` → `${API_URL}/api/:path*`, `API_URL` env, default
`http://localhost:4310`). No CORS dependence, no cookies anywhere — identity is a per-request
bearer token. Webhook callers hit the API directly (not through the web proxy).

## Identity & auth (THE interface)

One server-side module answers "who is this, which tenant/installation, what permissions?"

```ts
// api/src/auth/identity.ts
export interface Identity {
  userId: string;            // platform user id
  name: string;              // display name
  tenantId: string;
  installationId: string;
  permissions: ReadonlySet<string>;   // effective dive.* permissions
}
export interface IdentityProvider {
  verify(token: string): Promise<Identity | null>;   // null = invalid
}
```

- Provided via Nest injection token `IDENTITY_PROVIDER`. The ONLY implementation today is
  `DevStubIdentityProvider` (`api/src/auth/dev-stub.provider.ts`): accepts tokens of the form
  `devtoken.<base64url(JSON)>` where the JSON is
  `{ sub, name, tenantId, installationId, permissions: string[] }`. It does **no cryptographic
  verification** — clearly marked `// DEV STUB — NEVER SHIP`, loud warning log at boot. The
  real implementation will verify platform-signed identity tokens (JWKS) once the contract
  arrives, behind the same interface.
- Global `IdentityGuard` (APP_GUARD): reads `Authorization: Bearer <token>`, attaches
  `request.identity`; routes marked `@Public()` (healthz, webhooks) skip it.
  `PermissionsGuard` + `@RequirePermissions(...perms)` decorator = caller needs **any** of the
  listed permissions (most routes list one). Response-shaping rules (pricing-stripping,
  assigned-only filtering) live in the domain services, driven by `identity`.
- **No route reads or writes data without passing both guards**, and every query is scoped by
  `identity.installationId`.

### Permission catalog

The 19 `dive.*` permissions are defined in `PLATFORM_INTEGRATION_NEEDS.md` §4, mirrored as
constants in `api/src/auth/permissions.ts` and (frontend copy) `web/src/lib/permissions.ts`.
Rules enforced server-side:

- `dive.jobs.view-all` supersedes `dive.jobs.view-assigned`.
- With only `view-assigned`: job list includes only jobs whose `assignedUserIds` contains the
  caller; any other job id → **404** (list, detail, and job-scoped sub-routes).
- Without `dive.jobs.view-pricing`: `price` and crew-share fields are **removed** from every
  response (jobs, records, finance-adjacent payloads).
- Pay: `dive.pay.view-own` = self only (other userIds → 403); `dive.pay.view-all` unlocks any
  crew userId.
- Completion attribution: `completedBy` = token user. A caller with `dive.jobs.manage` may pass
  `onBehalfOfUserId` to record for a crew member (audit-logged).

### Dev users (seeded; used by harness picker and Prisma seed)

| key | name | tenant / installation | permissions |
|---|---|---|---|
| `dana` | Dana Reyes (Owner) | `tenant_demo` / `inst_demo` | all 19 |
| `sam` | Sam Okafor (Divemaster) | `tenant_demo` / `inst_demo` | jobs.view-all, jobs.manage, jobs.complete, jobs.view-pricing, checklist.manage, records.view, records.send, crew.view, pay.view-all, inventory.view, inventory.manage |
| `riley` | Riley Chen (Diver) | `tenant_demo` / `inst_demo` | jobs.view-assigned, jobs.complete, pay.view-own, inventory.view |
| `casey` | Casey Marsh (Front desk) | `tenant_demo` / `inst_demo` | jobs.view-all, records.view, records.send, pos.use, finance.view, inventory.view, inventory.manage, crew.view |
| `olga` | Olga Petrov (Owner, 2nd tenant) | `tenant_two` / `inst_other` | all 19 |

`olga` exists to demonstrate tenant isolation: she must never see `inst_demo` data. Dev-user
definitions live in `api/src/auth/dev-users.ts`; the harness duplicates them in a clearly
dev-only module (`web/src/lib/platform/dev-users.ts`).

`PlatformDirectory` interface (`api/src/platform/directory.ts`) answers "which platform users
belong to this installation?" (id, name, active) — dev stub returns the table above filtered by
installation. Used to resolve names in job/record payloads and populate assignment pickers.
`PlatformTenantProfile` interface (`api/src/platform/tenant.ts`) returns dev constants
(operation name, contact email, **timezone**).

## Bridge protocol (dev)

`web/src/lib/platform/bridge.ts`:

```ts
export interface PlatformBridge {
  getIdentityToken(): Promise<string>;
  getTheme(): Promise<Record<string, string>>;   // CSS custom-property map
  toast(message: string): void;
  requestResize(heightPx: number): void;
}
```

Two implementations, selected at runtime (`window.parent !== window`):
- **IframeBridge** — postMessage to parent. Envelope `{ type: "dive-bridge:<verb>",
  requestId?, ...payload }`. Child→parent verbs: `ready`, `request-token`, `request-theme`,
  `toast`, `resize`. Parent→child replies: `token`, `theme`. 5 s timeout → visible error state.
- **StandaloneDevBridge** — dev-only fallback when not framed: builds a `devtoken.` for the dev
  user named in `?devUser=` / localStorage (default `dana`); theme = built-in defaults.

The real platform bridge library later replaces IframeBridge's internals; app code only imports
`PlatformBridge`. No frame-busting, no `window.top` access, no third-party-cookie use, no
service worker.

## Database (PostgreSQL + Prisma; migrations committed in `api/prisma/migrations`)

Models (every one carries `installationId String` + `@@index([installationId])`; money/lengths
`Decimal`; arrays/structured blobs `Json`; dates: `dueDate`/`date`/`joined` as `YYYY-MM-DD`
strings — calendar dates, timezone-free by design; instants as `DateTime`):

- `Installation` — id (pk, e.g. `inst_demo`), tenantId, status (`active`|`uninstalled`), installedAt
- `CrewProfile` — @@id([installationId, userId]); certifications, bio, photo, joined
- `Job` — id (cuid), installationId, site, boat, ownerName, customerEmail, footage, price,
  rotation (`weekly`|`biweekly`|`monthly`|`bimonthly`), dueDate, status (`open`|`completed`),
  notes, videos Json `[{title,url}]`, assignedUserIds Json `string[]`, completedBy,
  completedByName, completedAt, completionNote, completionPhoto (data-URL), checkAnswers Json
  `[{id,q,a}]`, certified Boolean, certifiedAt, createdAt, updatedAt
- `ServiceRecord` — id, installationId, jobId, site, boat, ownerName, customerEmail,
  diverNames, completedBy, completedByName, completedAt, rotation, price, footage, note, photo,
  certified, certifiedAt, answers Json `[{q,a}]`, sent Boolean, sentAt, sentTo, createdAt
- `ChecklistQuestion` — id, installationId, text, ord Int
- `InventoryItem` — id, installationId, name, type (`item`|`part`|`tool`), quantity Int,
  unitCost, salePrice, sku, lowStockAt Int, notes
- `LedgerEntry` — id, installationId, kind (`in`|`out`), amount, description, category, date
- `InstallationSettings` — installationId @id, payRate (default 0.5), reportCcEmail,
  estimateRatePerFoot

`api/src/db/tenancy.service.ts` exposes `deleteInstallation(installationId)` — one transaction
cascading across all tables; exercised by the uninstall webhook.

Seed (`api/prisma/seed.ts`, run via `npm run seed`): wipes + seeds BOTH installations.
`inst_demo`: ~6 jobs across rotations (riley assigned to 2–3 open ones), 1–2 completed with
records — one **sent/frozen**, one active — riley credited with a completed record **this week**
(nonzero pay); ~5 checklist questions; ~8 inventory items (some sellable, one low-stock);
ledger entries spread over 6 months; settings row. `inst_other`: 1–2 jobs + settings for olga.

### Domain rules carried over from the seed (implemented in api services)

- **Rotation advances only on reopen**: `dueDate = nextDueDate(rotation, completedAt||today)`,
  month-clamped (Jan 31 + 1 mo → Feb 28/29). Reopen clears completion fields, checklist
  answers, certification, completion-tagged videos. Records persist.
- **Completing** a job snapshots an immutable `ServiceRecord`; while unsent, later checklist or
  certify edits on the completed job re-sync it. **Sent records are frozen.**
- Records survive job deletion; crew removal unassigns but never rewrites history.
- **Pay**: Monday-based weeks; `settings.payRate × record.price` credited to `completedBy`,
  bucketed by completion day; records are source of truth, plus completed record-less jobs,
  deduped by job id.
- **Finance totals**: money-in = priced records (by completedAt) + ledger `in` + completed
  record-less jobs (dedup by job id); money-out = ledger `out`. 6-month trend series.
- **POS sale**: one ledger `in` entry (category `POS · Cash`) + stock decrements, single
  transaction.

## HTTP API (all JSON; global prefix `/api` except `/webhooks/*` and `/healthz`)

Errors: `401` bad/missing token, `403` missing permission, `404` not found *or not visible*
(view-assigned), `422` validation (class-validator DTOs). Shape:
`{ "error": { "code", "message" } }` via a global exception filter.

| Route | Perm | Notes |
|---|---|---|
| GET `/api/me` | any valid token | `{ user:{id,name}, tenantId, installationId, permissions:[...] }` — frontend renders everything from this |
| GET `/api/jobs` | jobs.view-all \| view-assigned | `{ jobs:[Job] }`; assigned-only filtering; pricing stripped w/o view-pricing; assigned users resolved to `{id,name}` via directory |
| POST `/api/jobs` | jobs.manage | create boat/job |
| GET `/api/jobs/:id` | jobs.view-* | 404 if not visible |
| PATCH `/api/jobs/:id` | jobs.manage | partial update (site, boat, ownerName, customerEmail, footage, price, rotation, dueDate, notes, videos, assignedUserIds) |
| DELETE `/api/jobs/:id` | jobs.manage | records survive |
| POST `/api/jobs/:id/complete` | jobs.complete | body `{ note?, photo?, videoUrl?, onBehalfOfUserId? }` (last requires jobs.manage); sets completion, writes record |
| POST `/api/jobs/:id/reopen` | jobs.manage | clears completion, advances rotation |
| PUT `/api/jobs/:id/answers` | jobs.complete | body `{ answers:[{id,q,a}] }` (visible jobs only); re-syncs unsent record if completed |
| PUT `/api/jobs/:id/certify` | jobs.complete | body `{ certified: boolean }`; re-syncs unsent record |
| GET `/api/records` | records.view | pricing stripped w/o view-pricing |
| GET `/api/records/:id` | records.view | |
| POST `/api/records/:id/send` | records.send | body `{ sentTo }`; marks sent, saves email back to job, returns `{ mailto }` URL (client opens it) |
| POST `/api/records/:id/restore` | records.send | back to Active |
| DELETE `/api/records/:id` | records.manage | |
| GET `/api/checklist` | jobs.view-* | template questions |
| POST `/api/checklist` | checklist.manage | `{ text }` |
| DELETE `/api/checklist/:id` | checklist.manage | |
| GET `/api/crew` | crew.view | directory users + crew profiles merged |
| PATCH `/api/crew/:userId` | crew.manage | profile fields (certifications, bio, photo, joined) |
| GET `/api/pay?week=<offset>&userId=<id>` | pay.view-own \| view-all | userId ≠ self requires view-all; `{ weekStart, days:[...], weekTotal, totalFeet }` |
| GET `/api/inventory` | inventory.view | |
| POST `/api/inventory`, PATCH/DELETE `/api/inventory/:id` | inventory.manage | |
| POST `/api/inventory/:id/adjust` | inventory.manage | `{ delta }` relative stock movement; never below zero, 422 `Only N in stock` on over-consume |
| POST `/api/inventory/import/preview` | inventory.manage | `{ text }` CSV/TSV → `{ rows, errors, hasHeader }`; parses only, writes nothing |
| POST `/api/inventory/import` | inventory.manage | `{ text }` re-parsed server-side → `{ created, errors }` |
| GET `/api/finance/summary` | finance.view | week/month/year in/out/net + 6-month trend series |
| GET `/api/ledger` | finance.view | |
| POST `/api/ledger`, DELETE `/api/ledger/:id` | finance.manage | |
| POST `/api/pos/sale` | pos.use | `{ lines:[{itemId?, name, amount, qty}], method:'cash', received? }` → ledger entry + stock decrement |
| GET `/api/settings` | finance.view \| settings.manage | payRate, reportCcEmail, estimateRatePerFoot |
| PUT `/api/settings` | settings.manage | |
| GET `/api/backup` | finance.manage | JSON download of this installation's data |
| POST `/webhooks/platform` | signature (stub) | `WebhookVerifier` interface; dev stub accepts header `X-Dev-Signature: dev` (else 401). `installation.uninstalled` → full per-installation cascade delete; other events logged + 202 |
| GET `/healthz` | none | liveness |

## Frontend structure (Next.js, App Router, `web/src/`)

- `app/page.tsx` — the app shell (client-heavy): header, tab bar, active-tab view. All seven
  tabs ported from the seed with its look & feel (dark theme, cards, chips, bottom-sheet
  modals, segmented controls, toasts): **Jobs** (unfinished/finished filter, day grouping,
  due-status chips; job detail modal with complete flow incl. canvas photo-resize ≤500 px JPEG,
  debounced checklist answers → PUT `/answers`, certify → PUT `/certify`, edit/delete/assign
  with jobs.manage, reopen); **Records** (active/sent, document view, send = POST `/send` then
  open returned mailto via anchor click, print via print CSS, copy, restore, delete — **no
  jsPDF/CDN**); **Checks** (template editor); **Pay** (crew select only with pay.view-all,
  else locked to self; week navigator, total card, 7-day breakdown); **Divers** (roster cards
  + profile modal; edit with crew.manage); **Sales** (POS modal cash-only with change calc +
  tap-to-add sellable stock, estimate calculator from settings rate, 6-month SVG trend,
  week/month/year cards, ledger list, backup download — **no Venmo/QR, no trial gate, no demo
  mode, no admin PIN**); **Stock** (filter chips, low-stock flag, item form).
- `app/harness/page.tsx` — dev iframe harness faking the platform workspace: header
  "Platform Workspace (dev harness)", picker for the 5 dev users (with role captions),
  light/dark theme toggle (answers `request-theme` with different CSS custom-property maps),
  iframe embedding `/`, postMessage responder for `request-token`/`request-theme`, bridge
  traffic log (ready/toast/resize), user switch reloads the iframe.
- `lib/api.ts` — fetch wrapper: bearer token from bridge, one retry on 401 with fresh token,
  API errors surfaced as toasts. `lib/permissions.ts` — catalog copy + `can()`.
  `PermissionsProvider` context seeded from GET `/api/me` at boot.
- **Permission-driven rendering only**: tab visibility map (Jobs: jobs.view-*; Records:
  records.view; Checks: checklist.manage; Pay: pay.view-*; Divers: crew.view; Sales: pos.use
  \| finance.view; Stock: inventory.view); FAB/edit/delete affordances by manage permissions;
  price UI keyed off field absence + `can('dive.jobs.view-pricing')`. **No role names in any
  component.** Show/hide is cosmetic — the server enforces.
- Safety: React escaping only (no `dangerouslySetInnerHTML`); `safeUrl` (http(s) only) for
  video links; no cookies; no localStorage of tokens (memory only; the dev-user *key* may live
  in localStorage for StandaloneDevBridge).
- Refresh strategy: refetch active tab after each mutation and on window focus. No polling.

## Hygiene (platform review will enforce)

- No secrets in code or bundles; env-based config both sides, committed `.env.example`s
  (api: PORT, DATABASE_URL, LOG_LEVEL, CSP_FRAME_ANCESTORS, WEBHOOK_DEV_SIGNATURE;
  web: API_URL). TLS-ready (no scheme assumptions).
- API security headers via helmet with CSP configurable from env; **no X-Frame-Options /
  frame-ancestors lockout in dev** (the app must be iframable).
- Structured logging: nestjs-pino, one JSON line per request (method, path, status, ms, userId,
  installationId — never tokens or PII payloads).
- Committed formatting/lint config: root `.prettierrc`; web `next lint`.

## Deliberately NOT built (contract-pending / platform-owned)

Login/registration UI, payment processing (seed's Venmo deep-link dropped), email/SMS sending
(mailto handoff kept as interim), real token verification, real webhook signatures, platform
API client for tenant profile/branding (dev-constant interface), PDF generation (CDN dropped;
Print + Copy kept), the seed's trial/unlock gate and demo mode.
