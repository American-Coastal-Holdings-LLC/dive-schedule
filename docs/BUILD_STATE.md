# Build State — Fresh-Chat Resume Point

**Read this first if you are picking up the dive-schedule restructure in a new session.**
Everything needed to continue is on disk; this file is the index. Keep your context lean —
you should NOT need to read `legacy/index.html` (200 KB) at all.

## One-line resume (do this)

Run the concurrent build workflow (it builds api + web in parallel, then integrates live):

```
Workflow({ scriptPath: "/Users/jv/Desktop/Projects/dive-schedule/.build/build-workflow.mjs" })
```

Run the session on **Opus 4.8** (Fable 5 credits are exhausted; the workflow also pins
`model: 'opus'` on its agents so it's robust either way). It runs in the background and notifies
on completion. Then do the human-in-the-loop finish: live browser QA of the harness, then a
local commit (no push). The **Fable deep review is deliberately deferred** — see
`docs/BUILD_PROVENANCE.md`.

## What the app is

Vendor-owned hull-cleaning dive-ops app being restructured from a single-file seed PWA into a
Next.js + NestJS + PostgreSQL app that will run as a **third-party plugin inside a multi-tenant
SaaS platform (EOS)** — embedded in an iframe, identity via a platform bridge token, data
per-installation-scoped. Full brief: `VENDOR_KICKOFF_DIVE.md`. Contract/spec: `docs/ARCHITECTURE.md`.

## DONE (committed / on disk — do not redo)

- **Task A complete:** `PLATFORM_INTEGRATION_NEEDS.md` (the platform-team handoff report).
- **Contract:** `docs/ARCHITECTURE.md` — binding internal spec (stack, identity interface + dev
  stub, 5 dev users, bridge protocol, Prisma schema, full HTTP API table, hygiene). The API
  table and enforcement points are authoritative for the build.
- **Seed moved** to `legacy/` (unmodified reference). Key bits pre-extracted so nobody re-reads
  the 200 KB file:
  - `legacy/reference/seed-domain-logic.js` — domain functions to port VERBATIM.
  - `legacy/reference/seed-styles.css` — the seed CSS to reuse.
- **api/ scaffolded + deps installed** (`api/node_modules` present): package.json, tsconfig,
  nest-cli.json, `.env.example`, local `.env` (gitignored, `DATABASE_URL=postgresql://jv@localhost:5432/dive_schedule_dev`).
- **Prisma schema written + MIGRATED** (`api/prisma/schema.prisma` + `api/prisma/migrations/*/migration.sql`),
  client generated, DB `dive_schedule_dev` created. Do NOT reset it.
- **web/ scaffolded + deps installed** (`web/node_modules` present): package.json, tsconfig,
  next.config.ts (proxy to api), eslint, `.env.example`, `.env.local`.
- Root: `package.json` (dev/build/typecheck/seed across api+web), `.prettierrc`, `.gitignore`.

## TODO (the workflow does the first three; you do the rest)

1. **Build api source** — auth (dev-stub identity + guards + 19 perms + 5 dev users), Prisma
   service, all modules/routes per the API table with exact enforcement points, domain logic
   ported, webhooks, platform stubs, `prisma/seed.ts` for both installations. (Workflow: build:api)
2. **Build web source** — bridge, api client, PermissionsProvider, the 7 tabs ported with the
   seed CSS, the `/harness` dev page. (Workflow: build:web)
3. **Integrate + README + provenance** — boot both, run the full 10-item smoke suite, fix
   contract mismatches, write `README.md`, update `docs/BUILD_PROVENANCE.md`. (Workflow: integrate)
4. **Human finish (you, after the workflow):**
   - Live browser QA: open `http://localhost:4311/harness`, switch through all 5 dev users,
     confirm permission-driven views (riley sees only his jobs + no prices; casey no pay; olga
     isolated), toggle harness theme, confirm the app renders inside the iframe.
   - **Commit locally, staged by explicit path, no AI trailer, NO push** (owner pushes).
   - Report back: what exists, what's stubbed, what's blocked on the Vendor Integration Contract,
     the open-questions list (already in `PLATFORM_INTEGRATION_NEEDS.md` §8).

## Why prior build attempts failed (so you don't repeat it)

Three earlier runs died: two on Fable-5 credit/session limits, one on **context exhaustion** —
build agents tried to read all 4167 lines of `legacy/index.html` in dozens of chunks plus huge
`npm install` output, blew their context, terminally errored, and retried into the same wall
(112 reads / 4 writes, zero code produced). Fixes now in place and baked into the workflow:
**(1)** deps pre-installed + schema pre-migrated (agents don't install or migrate);
**(2)** `legacy/index.html` reading forbidden — agents use the small reference files.

## Gotchas

- **Location:** this is a standalone third-party vendor app at
  `/Users/jv/Desktop/Projects/dive-schedule` (a top-level project, sibling of `EZDock`). It was
  moved out of `EZDock/vendors/` on 2026-07-18 precisely because a vendor-owned app should not
  live inside the platform workspace. Open THIS folder as the project root in a fresh session.
- `plugins/` and other notes in the EZDock root memory do NOT apply here — separate repo, its own
  git (`AmericanCoastalHoldingsLLC/dive-schedule`, remote `origin/main`, default branch `main`).
  Do not push.
- Dev ports: **api 4310, web 4311**. Never 3000–3006 (EOS platform).
- Postgres connection needs the role in the URL under Homebrew trust auth
  (`postgresql://jv@localhost:5432/...`), else Prisma throws P1010.
- `.build/` (the workflow script) is gitignored — orchestration, not deliverable.
