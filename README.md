# Dive Schedule

An **American Coastal Holdings** plugin for the EOS operations platform, and the first piece of
an **ERP for the commercial dive industry**.

Operations app for **hull-cleaning dive businesses** — commercial divers who clean boat hulls
in marinas on recurring rotations. It keeps every boat on its cleaning rotation, tracks a
checklist / certify workflow and an immutable service record per cleaning, computes per-diver
weekly pay, runs a cash point-of-sale against inventory, and keeps a simple income/expense
ledger.

It is a sibling to [SprocketSuite](../SprocketSuite-Plugin) (e-bike shop operations): same
platform, same integration contract, same shape — a vendor-owned, vendor-hosted product that runs
white-labelled inside the EOS workspace.

> **The product name is a working title.** "Dive Schedule" describes the seed app, not the ERP
> this is becoming, and a rename is expected. Every surface that renders the name reads it from
> [`web/src/lib/brand.ts`](web/src/lib/brand.ts) so the rename is one edit — do not hard-code the
> product name anywhere. The one thing that will not follow automatically is the `dive.*`
> permission prefix, which is a wire contract with the platform.

This repo is the **restructure of a single-file seed PWA into a third-party plugin** for a
multi-tenant SaaS platform (EOS). The app runs embedded in the platform's workspace **iframe**;
identity arrives as a per-request **bearer token via a platform bridge**; all data is scoped
per **installation** (one dive operation = one platform tenant/installation). The platform's
Vendor Integration Contract has **not landed yet**, so every platform-facing surface is a thin
interface with a clearly-marked dev stub (see *Platform contract pending* below).

- **What it is not:** a recreational dive-trip/booking product. There is no login UI, no payment
  processing, no email backend — those are platform-owned or deferred.

## Directory map

```
api/       NestJS + Prisma backend. Owns ALL data decisions. Entry: api/src/main.ts. Dev port 4310.
web/       Next.js (App Router) frontend, rendered in the platform iframe. Entry: web/src/app/page.tsx
           (+ web/src/app/harness/page.tsx dev harness). Dev port 4311.
legacy/    The original single-file seed PWA, unmodified (reference only — never edit).
           legacy/reference/ holds the pre-extracted seed CSS + domain functions used for the port.
docs/      ARCHITECTURE.md (binding contract), BUILD_STATE.md, BUILD_PROVENANCE.md.
manifest.json  EOS plugin registration: the 19 dive.* permissions, requested scopes, webhook
           endpoint + event types, OAuth redirect. Carries a PLACEHOLDER embed host — no vendor
           box is allocated yet.
```

## Branding and the design system

The product brand is **ours** (the vendor's) and is the name in the EOS plugin catalogue. The
**tenant's** name and logo arrive at runtime from the tenant profile — the app is white-labelled,
so rendering the product name where a customer's name belongs is a bug.

`web/src/app/globals.css` is the token layer, and it has a contract worth reading before you touch
colour. EOS pushes its theme onto `:root` as inline styles, so the host always wins; the app is
built to follow. Six host-owned inputs (`--bg`, `--surface`, `--text`, `--muted`, `--border`,
`--primary`) drive roughly thirty derived tokens via `color-mix()` — hairlines, status tints,
scrim, toast, the recessed plane. Consequences:

- **Never hard-code a colour at a call site.** A literal is a colour that will not follow the
  theme. Add colour by deriving it in the token layer.
- **The deep-ocean navy `--brand` is deliberately NOT host-injectable** — it is the product's
  identity, not the tenant's theme, and it holds under any host palette.
- **Verify with the `/harness` "Host theme" toggle.** Its dark profile is an intentionally alien
  slate-and-amber palette that appears nowhere in the stylesheet; if the app still reads correctly
  under it, the derivation is genuinely working rather than falling back to our own dark literals.

`web/src/lib/platform/bridge.ts` → `themeToCss` maps EOS's semantic token object
(`{ mode, colors: { background, foreground, primary, … } }`) onto those CSS names. Without it a
pushed theme lands on properties no rule reads and is silently ignored.

The web app calls the API **same-origin at `/api/*`** through a Next.js rewrite proxy
(`web/next.config.ts` → `${API_URL}`), so there is no CORS dependence and no cookies. Webhook
callers hit the API directly at `/webhooks/platform` (not through the proxy).

## Run it locally

Prerequisites: Node 26, npm 11, PostgreSQL 16 (Homebrew, trust auth).

```bash
# 1. Database (once). Under Homebrew trust auth, put your OS role in the URL (api/.env).
createdb dive_schedule_dev

# 2. Dependencies (each app is independent — no workspaces).
npm --prefix api install
npm --prefix web install
#    root helper for the concurrent dev script:
npm install

# 3. Env: copy the examples and adjust DATABASE_URL's role to your local user.
cp api/.env.example api/.env         # PORT, DATABASE_URL, LOG_LEVEL, CSP_FRAME_ANCESTORS, WEBHOOK_DEV_SIGNATURE
cp web/.env.example web/.env.local   # API_URL

# 4. Migrate (already applied in this checkout) + seed both installations.
npm --prefix api run prisma:migrate  # only if migrations are not yet applied
npm --prefix api run seed

# 5. Run both halves (api on 4310, web on 4311).
npm run dev
```

Then open the dev harness at **http://localhost:4311/harness** — it fakes the platform
workspace: an iframe embedding the app plus a picker for the 5 dev users and a light/dark theme
toggle, so you can exercise permission-driven views without the real platform.

### The 5 dev users (harness picker + Prisma seed)

Identity is faked in dev by a `devtoken.<base64url(JSON)>` the harness mints; the API's
`DevStubIdentityProvider` decodes it **without any signature check** (dev only). Each user shows
a different slice of the app because rendering is **permission-driven**, never role-name-driven.

| Key | Name / role | Tenant · Installation | Demonstrates |
|---|---|---|---|
| `dana`  | Dana Reyes — Owner        | `tenant_demo` · `inst_demo`  | All 19 permissions; every screen; full lifecycle |
| `sam`   | Sam Okafor — Divemaster   | `tenant_demo` · `inst_demo`  | Crew lead: jobs+pricing, records, crew, all pay, inventory — no finance ledger/POS/settings |
| `riley` | Riley Chen — Diver        | `tenant_demo` · `inst_demo`  | **view-assigned** jobs only (unassigned ids → 404), **prices stripped**, **own pay only** |
| `casey` | Casey Marsh — Front desk  | `tenant_demo` · `inst_demo`  | Records + POS + finance, **no pay**, prices stripped (no view-pricing) |
| `olga`  | Olga Petrov — Owner (2nd) | `tenant_two` · `inst_other`  | **Tenant isolation** — never sees `inst_demo` data |

CLI token minter for curl/testing: `node api/scripts/devtoken.mjs <dana|sam|riley|casey|olga>`
(add `--curl <key>` for a ready curl line). Example:

```bash
curl -s http://localhost:4310/api/me -H "Authorization: Bearer $(node api/scripts/devtoken.mjs riley)"
```

## Environment variables

**api/.env** (see `api/.env.example`):

| Var | Purpose |
|---|---|
| `PORT` | API port (dev 4310) |
| `DATABASE_URL` | PostgreSQL URL; include your role, e.g. `postgresql://<role>@localhost:5432/dive_schedule_dev` |
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` |
| `CSP_FRAME_ANCESTORS` | Space-separated origins allowed to iframe the app; empty = no lockout (dev-friendly) |
| `WEBHOOK_DEV_SIGNATURE` | Dev-stub shared secret accepted in the `X-Dev-Signature` webhook header |

**web/.env.local** (see `web/.env.example`):

| Var | Purpose |
|---|---|
| `API_URL` | Base URL the Next rewrite proxies `/api/*` and `/webhooks/*` to (dev `http://localhost:4310`) |

No secrets live in code or bundles; identity tokens are held in memory only (never localStorage).

## Documentation

- **`docs/ARCHITECTURE.md`** — the binding internal contract: stack, repo layout, identity
  interface + dev stub, the 5 dev users, bridge protocol, Prisma schema, the full HTTP API
  table with enforcement points, and hygiene rules. Authoritative for the build.
- **`PLATFORM_INTEGRATION_NEEDS.md`** — the platform-team handoff: app inventory, domain
  entities, the 19-permission catalog (§4), the role → server-side enforcement register (§5),
  webhook events needed (§6), sensitive-data register (§7), and open questions (§8).
- **`docs/BUILD_PROVENANCE.md`** — who built what with which model, the final gate results, and
  the review lenses a later deep review must apply (green gates ≠ review strength).
- **`docs/BUILD_STATE.md`** — **start here in a fresh session.** Current state, what's done vs.
  deferred, the interface inventory, and how to resume.
- **`docs/CONTRACT_IMPACT.md`** — conformance analysis of the live EOS Vendor Integration Contract
  against this build: §8 scorecard, severity-ranked findings, and the phased wiring roadmap.
- **`docs/OPEN_QUESTIONS.md`** — decisions the owner/platform still owe, and notes for Fable.

## Platform contract pending (the dev stubs)

Until the Vendor Integration Contract arrives, four platform-facing surfaces are thin interfaces
with clearly-marked dev stubs, each swappable without touching feature code:

- **Identity** — `IdentityProvider` (`api/src/auth/identity.ts`). Only impl today is
  `DevStubIdentityProvider`, which decodes `devtoken.<base64url(JSON)>` with **no cryptographic
  verification** (`// DEV STUB — NEVER SHIP`, loud boot warning). Real impl will verify
  platform-signed (JWKS) tokens behind the same interface.
- **Webhook signature** — `WebhookVerifier` (`api/src/webhooks/webhook-verifier.ts`). Dev stub
  accepts the `X-Dev-Signature: dev` header (from `WEBHOOK_DEV_SIGNATURE`) and 401s otherwise.
  `installation.uninstalled` triggers a full per-installation cascade delete; other events are
  logged + 202.
- **Directory** — `PlatformDirectory` (`api/src/platform/directory.ts`). Dev stub resolves user
  names for job/record payloads and assignment pickers from the seeded dev-user table.
- **Tenant profile** — `PlatformTenantProfile` (`api/src/platform/tenant.ts`). Dev stub returns
  constants including **timezone** (`inst_demo` → America/Los_Angeles, `inst_other` →
  America/New_York), used for due-date rotation math and Monday-based pay weeks.

The web-side bridge (`web/src/lib/platform/bridge.ts`) mirrors this: an `IframeBridge`
(postMessage to the host) for the real workspace and a `StandaloneDevBridge` / harness path for
local dev. App code imports only the `PlatformBridge` interface.
