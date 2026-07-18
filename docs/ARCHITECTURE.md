# Dive Schedule — Restructured Architecture (contract-pending build)

This document is the **binding internal contract** for the restructured app: repo layout, dev
identity model, bridge protocol, DB schema, and the full HTTP API. The platform's Vendor
Integration Contract (v0) has not arrived yet — every platform-facing surface here is a thin
interface with a clearly-marked dev stub, designed to be rewired without touching feature code.
See `PLATFORM_INTEGRATION_NEEDS.md` for the platform-facing needs report and
`legacy/index.html` for the original single-file seed (read-only reference).

## Repo layout

```
server/   Express + TypeScript backend. Owns ALL data decisions. SQLite (better-sqlite3).
web/      Vite + TypeScript frontend (vanilla TS, no framework — continuity with the seed).
          web/harness/ = dev iframe harness faking the platform workspace + bridge.
legacy/   The original seed PWA, unmodified. Never edit; delete after parity is confirmed.
docs/     This file.
```

Ports (dev): **server 4310**, **web 4311** (Vite, proxies `/api` and `/webhooks` → 4310).
Root `package.json` uses npm workspaces; `npm run dev` runs both.

## Identity & auth (THE interface)

One server-side module answers "who is this, which tenant/installation, what permissions?"

```ts
// server/src/auth/identity.ts
export interface Identity {
  userId: string;            // platform user id
  name: string;              // display name
  tenantId: string;
  installationId: string;
  permissions: ReadonlySet<string>;   // effective dive.* permissions
}
export interface IdentityProvider {
  // Verifies the bearer token and returns the identity, or null if invalid.
  verify(token: string): Promise<Identity | null>;
}
```

- **Dev stub** (`server/src/auth/dev-stub.ts`, the ONLY implementation today): accepts tokens of
  the form `devtoken.<base64url(JSON)>` where the JSON is
  `{ sub, name, tenantId, installationId, permissions: string[] }`. It does **no cryptographic
  verification** — it is clearly marked `// DEV STUB — NEVER SHIP` and logs a warning at boot.
  The real implementation will verify platform-signed identity tokens (JWKS) once the contract
  arrives.
- Express middleware `requireIdentity` attaches `req.identity`; `requirePermission(perm)` (and
  `requireAnyPermission(...perms)`) gate every route. **No route touches the DB without going
  through both.** Every query is additionally scoped by `req.identity.installationId`.
- No cookies anywhere. The token arrives per-request: `Authorization: Bearer <token>`.

### Permission catalog

The 19 `dive.*` permissions and their semantics are defined in `PLATFORM_INTEGRATION_NEEDS.md`
§4 and mirrored in `server/src/auth/permissions.ts` (single source of constants, shared to the
frontend via `web/src/permissions.ts` copy). Rules enforced server-side:

- `dive.jobs.view-all` supersedes `dive.jobs.view-assigned`.
- With only `view-assigned`: job list/detail (and pay-irrelevant derived data) include only jobs
  whose `assigned_user_ids` contains the caller; other job ids → **404**.
- Without `dive.jobs.view-pricing`: `price` and crew-share fields are **removed** from every
  response (jobs, records, finance-adjacent).
- Pay: `dive.pay.view-own` = self only (server ignores/rejects other userIds);
  `dive.pay.view-all` unlocks arbitrary crew userIds.
- Completion attribution: `completedBy` = token user. A caller with `dive.jobs.manage` may
  record on behalf of another crew member (logged).

### Dev users (seeded, used by harness picker and server seed)

| key | name | tenant / installation | permissions |
|---|---|---|---|
| `dana` | Dana Reyes (Owner) | `tenant_demo` / `inst_demo` | all 19 |
| `sam` | Sam Okafor (Divemaster) | `tenant_demo` / `inst_demo` | jobs.view-all, jobs.manage, jobs.complete, jobs.view-pricing, checklist.manage, records.view, records.send, crew.view, pay.view-all, inventory.view, inventory.manage |
| `riley` | Riley Chen (Diver) | `tenant_demo` / `inst_demo` | jobs.view-assigned, jobs.complete, pay.view-own, inventory.view |
| `casey` | Casey Marsh (Front desk) | `tenant_demo` / `inst_demo` | jobs.view-all, records.view, records.send, pos.use, finance.view, inventory.view, inventory.manage, crew.view |
| `olga` | Olga Petrov (Owner, 2nd tenant) | `tenant_two` / `inst_other` | all 19 |

`olga` exists to demonstrate tenant isolation: she must never see `inst_demo` data.
Dev-user definitions live in `server/src/auth/dev-users.ts`; the harness builds its tokens from
the same shapes (duplicated constant, fine for a stub).

There is also a `PlatformDirectory` interface (`server/src/platform/directory.ts`) answering
"which platform users belong to this installation?" (id, name, active) — dev stub returns the
table above filtered by installation. Used to resolve names into job/record payloads and to
populate assignment pickers.

## Bridge protocol (dev)

`web/src/platform/bridge.ts` defines:

```ts
export interface PlatformBridge {
  getIdentityToken(): Promise<string>;
  getTheme(): Promise<Record<string, string>>;   // CSS custom-property map
  toast(message: string): void;
  requestResize(heightPx: number): void;
}
```

Two implementations, selected at runtime (`window.parent !== window`):
- **IframeBridge** — postMessage to parent. Envelope: `{ type: "dive-bridge:<verb>",
  requestId?, ...payload }`. Child→parent verbs: `ready`, `request-token`, `request-theme`,
  `toast`, `resize`. Parent→child replies: `token`, `theme`. 5s timeout → error surface.
- **StandaloneDevBridge** — dev-only fallback when not framed: builds a `devtoken.` for the dev
  user named in `?devUser=` / localStorage (default `dana`), theme = built-in defaults.

The real platform bridge library replaces IframeBridge's internals; the app only ever imports
`PlatformBridge`. No frame-busting, no `window.top` access, no third-party-cookie use anywhere.

## Database (SQLite via better-sqlite3, file `server/data/dive.db`, WAL)

Schema in `server/src/db/schema.sql`, applied idempotently at boot; seed via
`npm run seed -w server` (`server/src/db/seed.ts`, wipes + reseeds dev data for both
installations). **Every table carries `installation_id TEXT NOT NULL`** (indexed); deleting an
installation is one cascade (`deleteInstallation(installationId)` in `server/src/db/tenancy.ts`,
exercised by the uninstall webhook).

Tables (columns abbreviated; money/lengths REAL, booleans INTEGER 0/1, dates TEXT ISO,
JSON-in-TEXT for arrays):

- `installations` — id PK, tenant_id, status ('active'|'uninstalled'), installed_at
- `crew_profiles` — (installation_id, user_id) PK, certifications, bio, photo, joined
- `jobs` — id PK (uuid), installation_id, site, boat, owner_name, customer_email, footage,
  price, rotation ('weekly'|'biweekly'|'monthly'|'bimonthly'), due_date (YYYY-MM-DD), status
  ('open'|'completed'), notes, videos JSON `[ {title,url} ]`, assigned_user_ids JSON,
  completed_by, completed_by_name, completed_at, completion_note, completion_photo (data-URL),
  check_answers JSON `[ {id,q,a} ]`, certified, certified_at, created_at, updated_at
- `records` — id PK, installation_id, job_id, site, boat, owner_name, customer_email,
  diver_names, completed_by, completed_by_name, completed_at, rotation, price, footage, note,
  photo, certified, certified_at, answers JSON `[ {q,a} ]`, sent, sent_at, sent_to, created_at
- `checklist_questions` — id PK, installation_id, text, ord (INTEGER)
- `inventory_items` — id PK, installation_id, name, type ('item'|'part'|'tool'), quantity,
  unit_cost, sale_price, sku, low_stock_at, notes
- `ledger_entries` — id PK, installation_id, kind ('in'|'out'), amount, description, category,
  date (YYYY-MM-DD)
- `settings` — installation_id PK, pay_rate (default 0.5), report_cc_email,
  estimate_rate_per_foot

Domain rules carried over from the seed (implemented server-side):
- **Rotation** advances only on reopen: `due_date = nextDueDate(rotation, completed_at||today)`
  with month-clamping (Jan 31 + 1mo → Feb 28/29). Reopen clears completion fields, checklist
  answers, certification, and completion-tagged videos, and re-syncs nothing (records persist).
- **Completing** a job snapshots an immutable record; while a record is unsent, later checklist
  or certify edits on the completed job re-sync it. **Sent records are frozen.**
- Records survive job deletion. Crew removal unassigns from jobs but never rewrites history.
- **Pay**: Monday-based weeks; `pay = settings.pay_rate × record.price` credited to
  `completed_by`, bucketed by completion day (tenant-local calendar); records are the source of
  truth, plus completed jobs lacking a record, deduped by job id.
- **Finance totals**: money-in = priced records (by completed_at) + ledger 'in' + completed
  record-less jobs (dedup by job id); money-out = ledger 'out'.
- **POS sale**: writes one ledger 'in' entry (category `POS · Cash`) and decrements sold stock
  quantities in the same transaction.

## HTTP API (all JSON; all under `/api`; every route auth'd + permission-gated)

Errors: `401` bad/missing token, `403` missing permission, `404` not found *or not visible*
(view-assigned), `422` validation. Shape: `{ "error": { "code", "message" } }`.

| Route | Perm | Notes |
|---|---|---|
| GET `/api/me` | any valid token | `{ user:{id,name}, tenantId, installationId, permissions:[...] }` — the frontend renders everything from this |
| GET `/api/jobs` | jobs.view-all \| view-assigned | `{ jobs:[Job] }`; assigned-only filtering; pricing stripped w/o view-pricing; assigned users resolved to `{id,name}` via directory |
| POST `/api/jobs` | jobs.manage | create boat/job |
| GET `/api/jobs/:id` | jobs.view-* | 404 if not visible |
| PATCH `/api/jobs/:id` | jobs.manage | partial update (site, boat, owner_name, customer_email, footage, price, rotation, due_date, notes, videos, assigned_user_ids) |
| DELETE `/api/jobs/:id` | jobs.manage | records survive |
| POST `/api/jobs/:id/complete` | jobs.complete | body `{ note?, photo?, videoUrl?, onBehalfOfUserId? }` (last needs jobs.manage); sets completion, writes record |
| POST `/api/jobs/:id/reopen` | jobs.manage | clears completion, advances rotation |
| PUT `/api/jobs/:id/answers` | jobs.complete | body `{ answers:[{id,q,a}] }` (visible jobs only); re-syncs unsent record if completed |
| PUT `/api/jobs/:id/certify` | jobs.complete | body `{ certified: boolean }`; re-syncs unsent record |
| GET `/api/records` | records.view | pricing stripped w/o view-pricing |
| GET `/api/records/:id` | records.view | |
| POST `/api/records/:id/send` | records.send | body `{ sentTo }`; marks sent, saves email back to job, returns `{ mailto }` URL (client opens it — see needs report Q1) |
| POST `/api/records/:id/restore` | records.send | back to Active |
| DELETE `/api/records/:id` | records.manage | |
| GET `/api/checklist` | jobs.view-* | template questions |
| POST `/api/checklist` | checklist.manage | `{ text }` |
| DELETE `/api/checklist/:id` | checklist.manage | |
| GET `/api/crew` | crew.view | directory users + crew_profiles merged |
| PATCH `/api/crew/:userId` | crew.manage | profile fields (certifications, bio, photo, joined) |
| GET `/api/pay?week=<offset>&userId=<id>` | pay.view-own \| view-all | userId ≠ self requires view-all; `{ days:[...], weekTotal, totalFeet, weekStart }` |
| GET `/api/inventory` | inventory.view | |
| POST `/api/inventory` / PATCH,DELETE `/api/inventory/:id` | inventory.manage | |
| GET `/api/finance/summary` | finance.view | week/month/year in/out/net + 6-month trend series |
| GET `/api/ledger` | finance.view | |
| POST `/api/ledger` / DELETE `/api/ledger/:id` | finance.manage | |
| POST `/api/pos/sale` | pos.use | `{ lines:[{itemId?, name, amount, qty}], method:'cash', received? }` → ledger entry + stock decrement |
| GET `/api/settings` | finance.view \| settings.manage | pay_rate, report_cc_email, estimate_rate_per_foot |
| PUT `/api/settings` | settings.manage | |
| GET `/api/backup` | finance.manage | JSON download of this installation's data |
| POST `/webhooks/platform` | signature (stub) | `WebhookVerifier` interface; dev stub accepts header `X-Dev-Signature: dev`. Handles `installation.uninstalled` → full per-installation cascade delete; other events logged + 202 |
| GET `/healthz` | none | liveness |

## Hygiene (platform review will enforce)

- No secrets in code or bundles; server config via env (`server/.env.example`: PORT,
  DATABASE_PATH, LOG_LEVEL, CORS_ORIGINS, CSP directives). TLS-ready (no http-only assumptions).
- CSP sent by the server for the web app is **configurable via env**, defaults permissive enough
  for dev iframing; no `X-Frame-Options` deny, no `frame-ancestors` lockout in dev.
- Structured logging: pino JSON logs, one line per request (method, path, status, ms, userId,
  installationId — never tokens or PII payloads).
- Frontend: renders from the `/api/me` permissions object only (`can()` helper); **no role
  names in components**; show/hide only — every real decision is server-side.

## Deliberately NOT built (contract-pending / platform-owned)

Login/registration UI, payment processing (seed's Venmo deep-link dropped for v1), email/SMS
sending (mailto handoff kept as interim), real token verification, real webhook signatures,
platform API client for tenant profile/branding (interface `server/src/platform/tenant.ts`
returns dev constants), PDF generation (CDN dependency dropped; Print + Copy kept), the seed's
trial/unlock gate and demo mode.
