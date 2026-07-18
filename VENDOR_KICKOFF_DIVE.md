# Dive App — Platform Integration Kickoff

You are taking over development of this dive-operations app. It is currently an early-stage seed (roughly a single large HTML prototype). It is becoming a **third-party plugin on a multi-tenant SaaS operations platform**: this app stays vendor-owned and vendor-hosted, and integrates with the platform under the model below. The platform's formal Vendor Integration Contract (v0) is being authored now and will arrive later; your job is to (A) produce the integration-needs report the platform team is waiting on, and (B) build the app forward on foundations that are safe bets under any version of that contract. Work in this repo. Do not push or publish anything unless the owner asks.

## The integration model (settled — build toward this)

- **Delivery:** each customer of this app (a dive operation) becomes a *tenant* on the platform. The platform owns tenant accounts, login, sessions, and roles. This app never builds its own user/identity system for production — it consumes identity from the platform.
- **UI:** the app's interface is embedded in the platform's workspace inside an **iframe**, talking to the host via a **bridge JS library** (postMessage-based) the platform will supply: identity token retrieval, theme tokens, navigation/resize/modal/toast requests. The app must look native via theming, not via code-sharing. It will also be served on the vendor's own domain later (e.g. `app.<vendor-domain>.com`).
- **Auth:** per-installation OAuth2 credentials (issued when a tenant installs the plugin); short-lived signed **identity tokens** delivered through the bridge carrying user, tenant, and that user's effective permissions for this plugin. Rule that will be enforced at review: client-side claims may shape UI only; **every data decision happens server-side against a verified token** — e.g. a "Diver" role user sees only their own bookings because the backend checked the verified claims, never because the frontend hid a tab.
- **Permissions:** the app declares a **permission catalog** in its manifest (e.g. `dive.trips.manage`, `dive.bookings.view-own`, `dive.equipment.checkout` — final names TBD). Tenant admins compose their own roles (Divemaster, Instructor, Diver, front desk…) from that catalog using platform tooling. The app receives *effective permissions*, never role names — design views around permission checks, not role identities.
- **Data:** the app reads/writes platform data only through a **scoped REST API** (per-resource read/write scopes, tenant-isolated) and receives pushes via **signed, timestamped webhooks**. App-domain data (trips, bookings, equipment) lives in the vendor's own database, keyed by platform tenant/installation ID from day one. Sensitive end-customer data (diver PII, anything medical-adjacent) will sit behind a stricter approval tier — collect the minimum and flag every such field in the needs report.
- **Lifecycle:** installations can be uninstalled per-tenant, and the platform holds a kill switch; on termination the vendor must delete tenant-derived data within a contractual window. Multi-tenant hygiene is therefore structural: every row traceable to an installation, deletable per-installation.

## Task A — Integration-needs report (do this first)

Produce `PLATFORM_INTEGRATION_NEEDS.md` in the repo root. The platform team derives the v1 scoped API from this document, so make it concrete and exhaustive:

1. **App inventory** — what the seed currently does, screen by screen / feature by feature, and what the intended v1 product is.
2. **Domain entities** — every entity the app owns (trips, bookings, equipment, certifications, waivers…), with which are vendor-database-local vs. which need platform API resources.
3. **Platform resources needed** — for each: the resource, whether read or write, why, and how often (drives scopes + rate limits). Think: tenant profile/branding, users + their effective permissions, anything scheduling/notification-shaped the platform should own.
4. **Permission catalog draft** — the `dive.*` permissions the app wants to declare, each with a one-line purpose string (shown to tenant admins at install consent).
5. **Roles envisioned** — example role compositions (Divemaster, Instructor, Diver, front desk) mapped to those permissions, including which views/data each sees. Mark every place "sees only their own X" applies — those are the server-side enforcement points.
6. **Webhook events needed** — what the app must be told about (install/uninstall, user/role changes, subscription state…).
7. **Sensitive data register** — every field of end-customer PII or medical-adjacent data the app touches, why, and where it's stored.
8. **Open questions for the platform team** — anything the contract must answer for this app specifically.

This file is the handoff artifact — the owner will carry it back to the platform side.

## Task B — Build forward on safe-bet foundations

Restructure the seed into a real application, in this order of priority:

1. **Split frontend/backend.** A proper backend API serving the UI; the UI must run inside an iframe without breakage (no frame-busting, no assumptions of top-level window, CSP-configurable, no third-party-cookie dependence — identity will arrive via bridge token, not cookies).
2. **Multi-tenant data model day one.** Every table keyed by tenant/installation ID; per-installation delete implementable.
3. **Auth as an interface.** A single server-side module answering "who is this, which tenant, what permissions?" — implemented today by an obvious **dev stub** (clearly marked, never shippable), swapped later for platform token verification. All authorization checks go through it; no permission logic in the frontend beyond show/hide.
4. **Permission-driven views.** UI renders from an effective-permissions object supplied by the backend — no hardcoded role names in components.
5. **Hygiene the platform review will enforce:** no secrets in code or client bundles (env-based config), TLS-ready, webhook receiver endpoint scaffolded with signature-verification stubbed as an interface, structured logging.
6. **Do not build:** production login/registration, payments, email/SMS infrastructure (likely platform-provided — record as open questions instead), or any final API client hardcoded to guessed endpoint shapes. Where the contract is pending, code against a thin interface you can rewire.

## Quality gate

- `PLATFORM_INTEGRATION_NEEDS.md` exists and a platform engineer could design an API from it without seeing this codebase.
- The app runs locally end-to-end with the dev-stub identity (multiple fake users with different permission sets demonstrate permission-driven views).
- Frontend renders correctly inside an iframe harness.
- No secrets, no parallel identity system, every data read/write passing through the auth interface.

## End state

Report back with: the needs report, a summary of the restructure (what exists, what's stubbed, what's blocked on the contract), and the open-questions list. The Vendor Integration Contract v0 will then be delivered, and the next stage wires the real bridge + OAuth + API client against it.
