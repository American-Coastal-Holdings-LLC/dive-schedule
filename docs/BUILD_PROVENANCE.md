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
| 07-18 | **Opus 4.8** (this session) | **`api/` (NestJS) + `web/` (Next.js) restructure built here.** See scope + self-test results below. Committed `6c3a1fb`. |
| 07-18 (later, same session) | **Opus 4.8** | **Phase 0 EOS-security hardening** (`2824f80`); **EOS contract-conformance analysis** (`docs/CONTRACT_IMPACT.md`, via a 14-agent adversarial workflow); reviewed the **live EOS docs** (eos-developer-docs.vercel.app) and confirmed the analysis. Crypto wiring (Phases 1–2) deferred per the owner. |

## What Opus 4.8 built (needs Fable review)

*(Treat every item as UNREVIEWED by Fable. Filled in as the build completes.)*

Built directly in the Opus main loop (foundation):
- api/ + web/ scaffolds (package.json, tsconfig, nest-cli, next.config, eslint, .env.examples),
  deps installed.
- **`api/prisma/schema.prisma` + the `init` migration** (all 8 models, every table keyed by
  `installationId`) — hand-written by Opus, migrated against `dive_schedule_dev`.
- `legacy/reference/` extracts (CSS + domain functions) — verbatim from the seed, for porting.

Built by Opus workflow agents (`.build/build-workflow.mjs`), then integrated live:

**`api/` source (NestJS + Prisma)** — auth (dev-stub identity, guards, 19 perms, 5 dev users),
Prisma service + tenancy cascade, all modules/routes per the API table with the exact
enforcement points, domain logic ported from `legacy/reference/seed-domain-logic.js`, webhooks,
platform stubs, and `prisma/seed.ts`:

```
api/src/main.ts  app.module.ts
api/src/auth/           auth.module.ts current-identity.decorator.ts dev-stub.provider.ts
                        dev-users.ts identity.guard.ts identity.ts permissions.guard.ts
                        permissions.ts public.decorator.ts require-permissions.decorator.ts
api/src/common/         all-exceptions.filter.ts api-error.ts
api/src/db/             prisma.module.ts prisma.service.ts tenancy.service.ts
api/src/domain/         dates.ts finance-calc.ts record-builder.ts serialize.ts
api/src/platform/       directory.ts platform.module.ts tenant.ts
api/src/health/         health.controller.ts
api/src/me/             me.controller.ts
api/src/jobs/           jobs.controller.ts jobs.dto.ts jobs.module.ts jobs.service.ts
api/src/records/        records.controller.ts records.dto.ts records.module.ts records.service.ts
api/src/checklist/      checklist.controller.ts checklist.dto.ts checklist.module.ts checklist.service.ts
api/src/crew/           crew.controller.ts crew.dto.ts crew.module.ts crew.service.ts
api/src/pay/            pay.controller.ts pay.dto.ts pay.module.ts pay.service.ts
api/src/inventory/      inventory.controller.ts inventory.dto.ts inventory.module.ts inventory.service.ts
api/src/finance/        finance.controller.ts finance.dto.ts finance.module.ts finance.service.ts
                        ledger.controller.ts settings.controller.ts pos.controller.ts backup.controller.ts
api/src/webhooks/       webhook-verifier.ts webhooks.controller.ts webhooks.module.ts
api/scripts/devtoken.mjs   api/prisma/seed.ts   api/prisma/schema.prisma
```

**`web/` source (Next.js App Router, TS, `src/`)** — bridge, api client, PermissionsProvider +
PlatformProvider, the 7 tabs and their modals ported with the seed CSS, and the `/harness`:

```
web/src/app/            layout.tsx page.tsx harness/page.tsx globals.css
web/src/components/      Icon.tsx Modal.tsx Shell.tsx common.tsx
                         PermissionsProvider.tsx PlatformProvider.tsx
web/src/components/tabs/  JobsTab RecordsTab ChecksTab PayTab DiversTab SalesTab StockTab (.tsx)
web/src/components/modals/ JobDetailModal JobFormModal RecordModal DiverModal PosModal
                           StockFormModal LedgerFormModal (.tsx)
web/src/lib/             api.ts format.ts hooks.ts permissions.ts photo.ts types.ts
web/src/lib/platform/    bridge.ts dev-users.ts
```

### Final gate results (this Opus session — self-tested, NOT a Fable review)

| Gate | Result |
|---|---|
| api `npm run typecheck` | **pass** |
| api `npm run build` (nest build) | **pass** |
| api `npm run seed` (both installations) | **pass** — 8 jobs, 2 records, 10 inventory, 10 ledger |
| web `npm run typecheck` | **pass** |
| web `npm run build` (5 pages generated, 0 warnings) | **pass** |
| Next proxy `/api/me` via 4311 → API 4310 | **pass** |
| Full cross-stack smoke suite (items a–j) | **pass** — all 10 |

Smoke items verified live against the running stack: (a) `me` for dana/riley + 401 on
garbage/no token; (b) riley sees only his 4 assigned jobs, no `price` key, unassigned id +
its sub-routes → 404; (c) dana sees all 6 `inst_demo` jobs with prices; (d) olga sees only her
2 `inst_other` jobs (tenant isolation); (e) riley current-week pay nonzero, `?userId=usr_dana`
→ 403, same as sam → 200; (f) full lifecycle create → answers → certify → complete → record →
send (marks sent, returns mailto, writes customerEmail back to job) → answers on sent job leaves
the frozen record unchanged → reopen advances dueDate per rotation + clears completion/answers/
certify; (g) casey POS sale writes one `POS · Cash` ledger `in` + atomically decrements stock,
casey pay → 403; (h) `installation.uninstalled` with `X-Dev-Signature: dev` cascade-deletes a
scratch installation across **all 7 tables** (verified by direct SQL count), wrong signature →
401; (i) casey records carry no `price`, sam's do; (j) casey finance summary returns
week/month/year + 6-month trend, riley → 403.

### Integration fix applied during this session

- **`assignedUsers` vs `assignedCrew` field mismatch (web ↔ api).** The web job-detail modal
  reads `job.assignedUsers[]` to render assigned-crew names, but the API serialized the resolved
  `{id,name}` list only under `assignedCrew`, so names never rendered in the detail view. The
  spec (`docs/ARCHITECTURE.md`) does not fix the field name. Fixed on the **api** side
  (`api/src/domain/serialize.ts`): the resolved list is now emitted under **both** `assignedUsers`
  (what the web reads) and `assignedCrew` (the documented API alias).
- **Dev-user id mismatch (web harness ↔ api/seed).** `web/src/lib/platform/dev-users.ts` set the
  token `sub` to the bare key (`dana`, `riley`, …) while the api directory, `prisma/seed.ts`, and
  `scripts/devtoken.mjs` all use `usr_*` ids. Left unfixed, the browser-harness path would break
  job assignment and pay attribution (riley would see no assigned jobs). Fixed on the **web** side
  by prefixing the ids to `usr_*` to match the seed/directory.

## Phase 0 hardening + contract analysis (later in this session — also UNreviewed)

After the build, Opus ran an **EOS-security-first contract-conformance analysis** and applied
**Phase 0** hardening. Both were self-verified by Opus (incl. adversarial subagents), **NOT** by
Fable — treat as unreviewed.

- **`docs/CONTRACT_IMPACT.md`** — the analysis + severity-ranked findings + phased wiring roadmap +
  §8 scorecard. Produced by a 14-agent workflow (2 doc digests + 10 adversarial verifiers +
  completeness critic + EOS-vulnerability hunt). Confirmed against the **live** EOS docs. Fable should
  re-verify the ranked findings against the code — especially the **two EOS-CRITICAL webhook items,
  still OPEN** (deferred to Phase 1): header-only signature can't bind to the body while the
  `@Public()` webhook drives a cross-tenant cascade delete from `body.installationId`; and the event
  name is `installation.uninstalled` vs the contract's `installation.deleted`.
- **Phase 0 changes** (`2824f80`, 11 files): (1) **fail-closed dev-stub guards** — a shared allow-list
  (`api/src/common/dev-stub-guard.ts`) that all four stubs (identity, webhook, directory, tenant) call
  in `onModuleInit`; refuses to boot outside `development`/`test` (or explicit `ALLOW_DEV_STUBS=true`),
  production hard-blocked. (2) removed the `X-Dev-Signature: dev` default. (3) `frame-ancestors` CSP on
  the **Next embed HTML** (`web/next.config.ts`). (4) **bridge origin-pinning** (`web/src/lib/platform/
  bridge.ts` + harness) — no more `postMessage('*')`, validates `event.origin`.
  - Opus self-verified: typecheck + build clean; guard matrix **9/9 fail-closed** (production even with
    the flag, unset, staging, case/whitespace all blocked); live harness QA green (token handshake +
    theme push over the pinned bridge, no console errors); prod-boot test confirms the guard aborts
    boot + never binds the port.
  - Opus ran its **own adversarial review** of the Phase 0 diff, which caught a real hole in the first
    cut (the guard was fail-*open* for any env != exactly "production") — fixed to the allow-list above.
    Fable should still independently re-check: no exfil bypass in the origin pin; the CSP covers every
    HTML route; the guard has no residual fail-open; and the removed webhook default didn't break the
    dev flow.

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
