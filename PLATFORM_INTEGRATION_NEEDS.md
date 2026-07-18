# Platform Integration Needs — Dive Schedule

Vendor integration-needs report for the platform team, per the kickoff brief. This document is
self-contained: a platform engineer should be able to design the v1 scoped API for this app from
it without reading the codebase.

**What this app is.** "Dive Schedule" is an operations app for **hull-cleaning dive businesses**
(commercial divers who clean boat hulls in marinas on recurring rotations). It is *not* a
recreational dive-trip/booking product. Each customer of this vendor — one dive operation — becomes
one platform tenant. The seed being restructured is a single-file PWA backed by an openly-writable
Firestore with a client-side admin PIN; none of that survives. Everything below describes the app
as it is being rebuilt for platform delivery.

---

## 1. App inventory

### What the seed does today (feature-complete inventory)

Seven screens (tabs), phone-first UI:

| Screen | Behavior |
|---|---|
| **Jobs** | The core board. One card per boat under service; each carries site/marina, boat name, owner name, hull length, price, a cleaning **rotation** (weekly / biweekly / monthly / bimonthly), a due date with overdue/due-soon status, assigned divers, videos, notes. Filter: Unfinished vs Finished. |
| **Job detail** | Mark-complete flow (completed-by diver, note, photo proof, video link), a per-job **checklist** instantiated from a tenant-editable question template, and a **certify** checkbox acting as the diver's signature. Admin-only: edit/delete boat, assign divers, see price + crew share. Completing a job writes a permanent **dive record** snapshot. Reopening a completed job clears completion state and advances the due date by the rotation (recurrence is manual-reopen, not cron). |
| **Records** | Permanent dive-service records (Active vs Sent). Record detail is a printable service report: boat, owner, date, diver, checklist Q&A, certification, photo, price. Actions: **email report to customer** (currently a `mailto:` handoff — no email backend), save PDF, print, copy, move back to active, delete. Sent records are frozen (never re-synced from the job). |
| **Checks** | Admin editor for the operation-wide checklist question template. |
| **Pay** | Per-diver weekly pay view (Monday weeks): the diver credited with each completed job earns `pay-rate × job price` (currently a hardcoded 50%). Computed from dive records; day-by-day breakdown, week total, total footage cleaned. |
| **Divers** | Crew roster: name, photo, certifications, email, phone, bio, join date; per-diver profile with assigned jobs. |
| **Sales** | Point-of-sale (cash, and Venmo via deep-link/QR), a rate-per-foot estimate calculator, revenue trend chart (6 months), week/month/year money-in/out/net report, manual income & expense ledger, JSON backup export. |
| **Stock** | Inventory: items / special parts / diver tools, with quantity, unit cost, sale price, SKU, low-stock threshold. POS sales auto-decrement stock. |

Access control today: a hardcoded admin PIN toggles an admin/diver mode **per device, client-side
only**. "Diver" mode sees only Jobs + Pay, no prices — but this is cosmetic; the database is
openly writable. There is also a hardcoded 7-day trial + unlock-code gate (vendor's own
monetization — expected to be replaced by platform subscription state).

### Intended v1 product on the platform

Same domain feature set, restructured: real backend owning all data decisions; platform identity
replacing the PIN and the local diver roster identity; permission-driven views replacing the
binary admin/diver split; per-installation tenancy; service-report delivery via whatever
notification capability the platform offers (open question); trial/monetization replaced by
platform subscription state. Venmo/payment collection is out of scope for v1 (open question).

---

## 2. Domain entities

| Entity | Contents | Ownership |
|---|---|---|
| **Job (boat under service)** | site/marina, boat name, owner (customer) name, customer email, hull footage, price, rotation, due date, status, assigned crew (platform user ids), notes, videos, completion state (by whom, when, note, photo), checklist answers, certified flag | **Vendor DB**, keyed by installation |
| **Dive record (service report)** | immutable snapshot at completion: job fields + checklist Q&A + certification + photo + sent-state (sentAt, sentTo) | **Vendor DB** |
| **Checklist template** | ordered question list, per tenant | **Vendor DB** |
| **Crew profile** | app-specific extension of a **platform user**: dive certifications, bio, photo (if not platform-provided), pay participation | **Vendor DB**, keyed by (installation, platform user id). Identity fields (name, email, account state) come from the **platform**, not this table |
| **Customer (boat owner)** | name + email of the end customer receiving reports. Customers are *not* platform users | **Vendor DB**, flagged PII |
| **Inventory item** | name, type, qty, unit cost, sale price, SKU, low-stock threshold | **Vendor DB** |
| **Ledger entry** | in/out, amount, description, category, date (POS writes "in" entries) | **Vendor DB** |
| **Settings** | pay rate (replaces hardcoded 50%), report CC address, estimate rate-per-foot | **Vendor DB**, per installation |
| **Users & roles** | accounts, login, sessions, role composition, effective permissions | **Platform** |
| **Tenant profile** | operation name, branding/logo, primary contact, timezone | **Platform** (read by app) |
| **Subscription state** | active/trialing/suspended per installation | **Platform** (read + webhook) |

The old Firestore "divers" collection splits in two: identity → platform users; occupational
profile (certs, bio) → vendor crew-profile rows referencing platform user ids.

---

## 3. Platform resources needed (drives scopes + rate limits)

| # | Resource | R/W | Why | Frequency |
|---|---|---|---|---|
| 1 | **Identity token verification material** (JWKS or introspection) | R | Verify bridge-delivered identity tokens server-side; every data decision hangs off this | Keys cached; effectively per-deploy + rotation |
| 2 | **Current user claims** (in-token): user id, display name, tenant id, installation id, effective `dive.*` permissions | R | Authorize every request; attribute completions/certifications | Every request (from token, no API call) |
| 3 | **Tenant user directory** — members with access to this plugin: id, display name, email, avatar, active/deactivated | R | Assign crew to jobs; completed-by pickers; pay attribution; show deactivated state on historical records | Cached; refresh on webhook + daily. Burst: one list call per active session start |
| 4 | **Tenant profile / branding**: operation name, logo, primary contact email, **timezone** | R | Report header, default CC address, theming; due-date and pay-week math must use the tenant's timezone, not the device's | Cached; refresh on webhook. ~1 read/session |
| 5 | **Subscription / entitlement state** for this installation | R | Gate the app the way the seed's trial gate did; show renewal state to the owner | Cached; refresh on webhook |
| 6 | **Notification / email send** (if the platform offers it) | W | Deliver the service report to the end customer as a real email instead of a `mailto:` handoff; later: due-rotation reminders, low-stock alerts | ~1–20 sends/tenant/day |
| 7 | *(optional)* **File/blob storage** | R/W | Completion photos & crew photos; currently base64 blobs in the vendor DB (works, but a platform blob store with signed URLs would be better) | Low; photo per completed job |

Not needed from the platform: app-domain CRUD (jobs, records, inventory, ledger live in the vendor
DB); realtime channels (the app is fine with request/response + webhooks); scheduling infra
(rotation math is app logic).

Rate-limit note: the seed polled full collections every 30 s per device. The rebuilt app does
**not** poll the platform — steady-state platform traffic is token verification (local, cached
keys) plus webhook-invalidated caches of resources 3–5. Expect very low request volume per tenant.

---

## 4. Permission catalog draft (`dive.*`)

Purpose strings are what tenant admins will read at install/consent time.

| Permission | Purpose string |
|---|---|
| `dive.jobs.view-all` | See every boat, rotation, and due date on the job board |
| `dive.jobs.view-assigned` | See only jobs they are assigned to |
| `dive.jobs.manage` | Add, edit, delete, and reopen boats; assign crew; edit customer contact |
| `dive.jobs.complete` | Mark jobs complete, fill in checklists, and certify work |
| `dive.jobs.view-pricing` | See job prices and crew-share amounts |
| `dive.checklist.manage` | Edit the operation's inspection checklist template |
| `dive.records.view` | View past dive-service records |
| `dive.records.send` | Send service reports to customers and move records between Active and Sent |
| `dive.records.manage` | Delete dive-service records |
| `dive.crew.view` | See the crew roster and profiles |
| `dive.crew.manage` | Edit crew profiles (certifications, bio, photo) |
| `dive.pay.view-own` | See their own pay |
| `dive.pay.view-all` | See pay for the whole crew |
| `dive.pos.use` | Record point-of-sale sales |
| `dive.finance.view` | See revenue reports, the income/expense ledger, and trends |
| `dive.finance.manage` | Add and delete income/expense entries; export backups |
| `dive.inventory.view` | See stock levels |
| `dive.inventory.manage` | Add, edit, and delete stock items |
| `dive.settings.manage` | Change app settings (pay rate, report CC address, estimate rate) |

Semantics: `view-all` supersedes `view-assigned` when both are granted. `dive.jobs.complete`
without any `view` grant is inert (no jobs visible to complete).

---

## 5. Roles envisioned (compositions of the catalog)

Roles are tenant-composed; these are the presets we expect to document for tenant admins.
**Bolded grants are server-side enforcement points** — data must be filtered/stripped in the
backend, never merely hidden in the UI.

| Role | Grants | What they see |
|---|---|---|
| **Owner / Admin** | everything | All seven screens |
| **Divemaster (crew lead)** | jobs.view-all, jobs.manage, jobs.complete, jobs.view-pricing, checklist.manage, records.view, records.send, crew.view, pay.view-all, inventory.view, inventory.manage | Everything except finance ledger, POS, settings |
| **Diver** | **jobs.view-assigned**, jobs.complete, **pay.view-own**, inventory.view | Job board filtered to *their* assignments (list AND detail: an unassigned job id returns 404, not an empty screen); prices **stripped from API responses** (no `view-pricing`); Pay screen computes *only their own* pay server-side |
| **Front desk** | jobs.view-all, records.view, records.send, pos.use, finance.view, inventory.view, inventory.manage, crew.view | Board + records + sales, no pay data, no boat editing; prices visible only if also granted view-pricing |

Enforcement-point register ("sees only their own X"):
1. `dive.jobs.view-assigned` — job list, job detail, and any record derived from a job are
   filtered to jobs whose crew includes the caller's platform user id.
2. `dive.pay.view-own` — pay endpoints accept no arbitrary user id; the server resolves "me"
   from the verified token. `view-all` is required to query anyone else.
3. `dive.jobs.view-pricing` — `price`, crew-share, and revenue-derived fields are removed from
   every API response (jobs, records, reports) when absent.
4. Completion/certification attribution — `completedBy` / certifier is always the verified token
   user, never a client-supplied id (the seed let anyone pick anyone; the rebuild does not,
   except for users holding `dive.jobs.manage` recording on a crew member's behalf, which is
   audit-logged).

---

## 6. Webhook events needed

All signed + timestamped, per the integration model. Idempotent handling assumed (delivery
retries welcome; please document retry/backoff semantics).

| Event | Why the app needs it |
|---|---|
| `installation.created` | Provision tenant rows, store per-installation credentials, run onboarding defaults (checklist template seed, settings) |
| `installation.uninstalled` | Start the contractual deletion window for that installation's data |
| `installation.terminated` (kill switch) | Immediate access cut + deletion window start |
| `subscription.updated` | Gate/un-gate the app (replaces the seed's trial gate) |
| `user.added` / `user.removed` (plugin access granted/revoked for a tenant member) | Keep crew pickers accurate; on removal, keep historical attribution but block new assignment |
| `user.deactivated` / `user.updated` (name/avatar changes) | Directory cache invalidation; render deactivated crew correctly on old records |
| `permissions.updated` (a user's effective `dive.*` set changed) | Cache invalidation if effective permissions are ever cached server-side; otherwise informational |
| `tenant.updated` (profile/branding/timezone) | Invalidate tenant-profile cache; timezone changes affect due-date math |
| `credentials.rotated` (if the platform rotates installation OAuth secrets) | Re-fetch/replace stored credentials without downtime |

---

## 7. Sensitive data register

Every end-customer-PII or personal field the app touches. No medical data is collected anywhere
in the app today, and v1 adds none. Dive *certifications* are occupational credentials
(e.g. "PADI Divemaster"), not medical records — flagged here anyway in case the platform's
sensitive-data tier treats worker credentials specially.

| Field | Class | Where stored | Why needed |
|---|---|---|---|
| Customer (boat owner) name | End-customer PII | Vendor DB: jobs, records | Job identification; service-report addressee |
| Customer email | End-customer PII | Vendor DB: jobs, records (sentTo) | Delivering service reports |
| Boat name + site/marina (+ hull length) | End-customer-linked location data — identifies where a specific person's boat is kept | Vendor DB: jobs, records | Scheduling the physical work |
| Completion photo | May incidentally capture people/vessels | Vendor DB (base64 today; platform blob store if offered) | Proof of service on the customer report |
| Crew member name, email, avatar | Worker PII | **Platform** (user directory); names snapshotted into records for attribution | Assignment, attribution, certification signature |
| Crew phone, photo, bio, certifications | Worker PII | Vendor DB: crew profile (unless the platform profile exposes these — open question) | Roster/profile display; cert display on reports |
| Diver pay amounts | Worker financial data | Not stored — computed on demand from records × pay rate; visible only under `dive.pay.*` | Weekly pay view |
| Job price / ledger amounts / POS sales | Tenant financial data (not personal) | Vendor DB | Core bookkeeping |

Data minimization commitments: customer records hold **name + email only** (no phone/address
fields); pay is derived, never persisted; every row in the vendor DB carries the installation id,
so per-installation deletion (uninstall/termination window) is a single cascade.

---

## 8. Open questions for the platform team

1. **Report delivery.** Does the platform provide an email/notification send API (resource 6)?
   The seed's `mailto:` handoff survives as a fallback, but real delivery (and a sent-audit
   trail) is the single biggest product upgrade the platform could hand us. If provided: can the
   From/Reply-To reflect the tenant's identity?
2. **Timezone.** Is tenant timezone part of the tenant profile? Due-date rotation math and
   Monday-based pay weeks need an authoritative tenant timezone, not device time.
3. **User profile surface.** Which user fields does the platform expose to plugins (email? phone?
   avatar?), and may we *store* our own crew-profile extension keyed by platform user id (we
   assume yes — it's in the vendor DB)? Conversely, if the platform profile grows
   phone/photo, we'd rather read than duplicate.
4. **Crew onboarding flow.** Divers become platform users. Who invites them — tenant admin via
   platform tooling only, or can the app deep-link into an invite flow? Can a user belong to the
   tenant but lack access to this plugin?
5. **Acting-on-behalf.** The seed lets an admin record a completion *for* a diver. Is there a
   platform convention for on-behalf-of attribution, or is app-level audit logging sufficient?
6. **Payments.** POS today records cash and hands off to Venmo via deep-link. Does the platform's
   subscription/billing layer extend to tenant-to-end-customer payments, or should POS stay
   record-keeping only? (We build no payment processing in v1 either way.)
7. **Subscription mapping.** The seed had a 7-day trial + unlock code. What subscription states
   will `subscription.updated` carry (trialing/active/past-due/suspended?), and what UX does the
   platform expect a plugin to show in each state vs. what the platform shell itself shows?
8. **Deletion window.** What is the contractual deletion window after uninstall/termination, and
   is a deletion-completion attestation (API call or report) required?
9. **Iframe capabilities.** The app needs, inside the platform iframe: `mailto:` link opening
   (fallback send path), file download (`allow-downloads`: JSON backup, printable report),
   `window.print()` or a bridge print request, and clipboard write. Which of these does the
   host sandbox/CSP permit, and does the bridge offer print/download/toast primitives instead?
10. **Blob storage.** Is there platform file storage with signed URLs (resource 7), or should
    photos stay in the vendor DB long-term?
11. **Staff portal handoff.** When platform staff enter a tenant workspace via the handoff flow,
    what do this plugin's requests look like — a synthetic user with which `dive.*` permissions?
    We need this defined to avoid staff appearing in crew pickers or pay views.
12. **Sandbox tenant.** Will vendors get a sandbox tenant + test installation credentials +
    webhook replay tooling for integration testing before the contract's conformance review?
13. **Token/directory limits.** Identity token lifetime + refresh cadence via the bridge, and
    rate limits on the user-directory and tenant-profile reads (we cache both; just need the
    envelope).
14. **Offline.** The seed is an installable PWA used dockside on phones. Post-integration the
    app runs in the workspace iframe *and* later on our own domain. Is any offline/PWA behavior
    permissible in the iframe context, or is that vendor-domain-only?
