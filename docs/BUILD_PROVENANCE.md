# Build Provenance & Review Handoff

**Purpose.** This file records *who built what and with which model*, so a later deep review
knows exactly what to scrutinize and does not mistake self-tested green gates for an actual
adversarial review. Keep it honest and current.

> Standing rule for this repo: **green gates ≠ review strength.** Whoever runs the deep review
> must re-verify claims here against the live code, not trust them.

## Model timeline

| When (2026) | Session model | What was produced |
|---|---|---|
| 07-18 (earlier) | Fable 5 (orchestrator) | Seed inventory (2 Explore agents); `PLATFORM_INTEGRATION_NEEDS.md`; `docs/ARCHITECTURE.md` (contract); moved seed → `legacy/`. Committed `8aa0102` (local). |
| 07-18 | Fable 5 | Two build workflows launched — **both died on Fable-5 credit/session limits before producing code.** Partial scaffolds wiped; no Fable-built code survives in the tree. |
| 07-18 | **Opus 4.8** (this session) | **`api/` (NestJS) + `web/` (Next.js) restructure built here.** See scope + self-test results below. |

## What Opus 4.8 built (needs Fable review)

*(Treat every item as UNREVIEWED by Fable. Filled in as the build completes.)*

Built directly in the Opus main loop (foundation):
- api/ + web/ scaffolds (package.json, tsconfig, nest-cli, next.config, eslint, .env.examples),
  deps installed.
- **`api/prisma/schema.prisma` + the `init` migration** (all 8 models, every table keyed by
  `installationId`) — hand-written by Opus, migrated against `dive_schedule_dev`.
- `legacy/reference/` extracts (CSS + domain functions) — verbatim from the seed, for porting.

Built by Opus workflow agents (`.build/build-workflow.mjs`) — pending at time of writing:
- `api/` source — auth (dev-stub identity, guards, 19 perms, 5 dev users), Prisma service,
  modules/routes per the API table, ported domain logic, webhooks, platform stubs, seed.
- `web/` source — bridge, api client, PermissionsProvider, the 7 tabs, `/harness`.
- Integration fixes, `README.md`, this file's gate results.

Self-tests run on Opus (NOT a substitute for review): typecheck + build on both halves, plus a
live cross-stack smoke suite (see `docs/ARCHITECTURE.md` API table / workflow script for the
exact items). Passing gates are recorded in the final report, not here.

## Review lenses Fable must apply (deferred to Fable — do NOT skip)

The build was done on Opus; the **adversarial 5-lens review + verify + fix was NOT run on Fable
yet** (Fable credits were exhausted). When Fable credits reset, run the deep review with these
lenses, adversarially (default-to-refuted verifiers), before any push:

1. **Seed parity** — ported domain math vs `legacy/index.html`: `nextDueDate` month-clamp;
   rotation advances only on reopen (and reopen clears completion/answers/certify/completion
   videos); record snapshot-on-complete; unsent-record re-sync; **sent-record freeze**;
   Monday pay weeks + day buckets + record-less-job dedup by jobId; finance totals composition;
   POS atomic ledger+stock; due-status chip thresholds; checklist debounce+blur save; deletion
   semantics (records survive job/crew deletion).
2. **Security & enforcement points** — every route behind identity+permission guards;
   view-assigned filtering server-side incl. 404 on non-visible ids for detail AND job-scoped
   sub-routes; **pricing stripped server-side** (not just hidden); pay self-only; completion
   attribution from token (onBehalfOf gated by jobs.manage); webhook signature; no permission
   logic beyond show/hide in web; no secrets/tokens in code, bundles, or localStorage; no
   `dangerouslySetInnerHTML`; CSP env-configurable without iframe lockout; logs free of
   tokens/PII. *Actively try to craft a Diver-token request that leaks prices / others' pay /
   unassigned jobs.*
3. **Tenancy & lifecycle** — every Prisma query scoped by `installationId`; cross-installation
   id attacks (job/POS-item/record/crew ids from another tenant); `deleteInstallation` covers
   every table in one transaction; uninstall webhook wiring; seed split cleanly across
   `inst_demo` / `inst_other`.
4. **Structure & reviewability** (a listing requirement) — conventional Nest/Next layout; no
   dead/prototype files; accurate README; complete `.env.example`s; committed lint/format; a
   stranger understands it in minutes; `legacy/` untouched.
5. **Kickoff compliance** — walk `VENDOR_KICKOFF_DIVE.md` Task B 1–6, the stack amendment, and
   the Quality gate line by line; flag anything missing AND anything built that the kickoff said
   *not* to build.

## Deviations & decisions made on Opus

*(Recorded as they happen.)*

- Stack switched from an initial Express+SQLite+Vite direction to **Next.js + NestJS + PostgreSQL**
  after the kickoff's 07-17 "Target stack & structure" amendment (`a18013d`) was noticed
  mid-build. Contract doc (`docs/ARCHITECTURE.md`) rewritten accordingly before this build.
