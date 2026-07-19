# Open Questions & Handoff Notes

Decisions the owner/platform still owe, and notes for the fresh chats (EOS core + the two vendor
apps). Captured at handoff, 2026-07-18. Companion to `docs/BUILD_STATE.md` and
`docs/CONTRACT_IMPACT.md`.

## Decisions for the owner

1. **Branded-domain login flow — compliance-critical.** The intended model: a white-labeled,
   standalone-looking ERP with its own domain, marketing, and branded login; EOS is the identity
   backbone. The EOS contract forbids the plugin from handling EOS passwords — *"you never handle
   their EOS passwords… never solicit EOS credentials in your surface."* So a branded login must be
   a **"Log in" button/page that redirects to EOS's hosted login** (password entered on EOS, redirect
   back as an EOS session) — **not** a username/password form the plugin renders. **Confirm this is
   the intended flow before building the branded surface.** This is the one place where a mistake
   becomes an EOS credential-harvesting vulnerability (the north-star risk).
2. **Marketing site — in scope? where?** A public, unauthenticated site ("what Dive Schedule is,
   install it on EOS"). Net-new, not built. Is it this repo or a separate project? What pages/content?
   Its "Log in" would redirect to EOS (per §1).
3. **Branded-domain app surface — build it?** The standalone `app.<vendor>.com` surface (same app,
   EOS-session login entry). Net-new. Today we have only the in-EOS-workspace iframe surface.
4. **Crypto deferral — confirm the resume trigger.** The owner said skip crypto for now, which defers
   Phase 1 (webhook HMAC) + Phase 2 (JWKS / OAuth2). What resumes it — EOS go-live, or the §13 stub
   kit landing?
5. **Permission catalog — declare canonical.** We built a refined **19-perm** `dive.*` catalog (with
   the security-important `view-all`/`view-assigned` split, `finance.*`, `pos.use`, `checklist.manage`,
   `settings.manage`; `certify` folded into `jobs.complete`). The kickoff/digest lists an older
   **17-perm** set (`jobs.read/write/complete/certify`, `records.read/send/delete`, `divers.read/write`,
   `pay.read.own`, `pay.read.all`, `sales.read/write/settings`, `inventory.read/write`, `backup.export`).
   One must be declared canonical for the manifest. **Recommend ours** (refined, enforcement-accurate) —
   confirm.
6. **POS / Venmo.** Kickoff Block A says "POS stays cash / Venmo deep-link as today." The restructure
   **dropped Venmo** (POS is cash + records-only, no card data). Confirm dropping Venmo is intended.

## For the EOS core / admin chat (platform still owes these)

The contract's §7 resource surface + §8 event list are **provisional** (freeze to v1.0 once the
e-bike pilot's needs report is in). Our §8 open questions still unanswered/partial — raise with EOS:

- **Q11 staff-portal handoff** *(unanswered)* — when platform staff enter a tenant workspace, what
  synthetic user / which `dive.*` perms surface? Needed so staff don't appear in crew pickers / pay.
- **Q14 offline / PWA** *(unanswered)* — any offline behavior permitted in the iframe, or
  vendor-domain-only?
- **Q4 crew onboarding / invite** *(partial)* — tenant-crew invite flow + identity mapping undefined
  (only partner-team invites are specified).
- **Q5 acting-on-behalf** *(partial)* — platform convention vs. our app-level audit.
- **Q9 iframe capabilities** *(partial)* — no `mailto`/`download`/`print` bridge primitive; confirm
  the server-side fallbacks (`notifications.send`, `files.*`, `export.read`).

## Tooling / access we may need

- **The §13 stub kit** (EOS dev kit): a mock bridge npm package, test JWKS + sample tokens, a webhook
  simulator CLI, and a local OAuth stub. We already built our **own equivalent** (the `/harness` +
  dev stubs), so the EOS kit is only needed to *conformance-test the crypto* later. **Does the team
  have it / a package name?**

## Notes for Fable (deep review)

Everything this session was **self-tested on Opus, not Fable-reviewed.** `docs/BUILD_PROVENANCE.md`
holds the full lens list. Added this session for Fable to scrutinize:

- **Phase 0 changes** (`2824f80`): verify the fail-closed guard's allow-list truly closes **every**
  non-dev environment (staging/canary/unset/case/whitespace) and that all four stubs abort boot; that
  dev / seed / build / QA still pass; the `frame-ancestors` CSP is on the actual embed HTML; and the
  bridge origin-pinning has no exfil bypass (and will work under the real strict sandbox once the SDK
  lands).
- **Contract-conformance claims** in `docs/CONTRACT_IMPACT.md`: produced + adversarially verified by
  Opus subagents against the code, **not** by Fable. Re-verify the ranked findings against the live
  code — especially the two **EOS-CRITICAL** webhook items, which are still **OPEN** (deferred to
  Phase 1): (1) header-only signature can't bind to the body + `@Public()` endpoint drives a
  cross-tenant cascade delete from an attacker-supplied `installationId`; (2) the event name is
  `installation.uninstalled` but the contract emits `installation.deleted`.
