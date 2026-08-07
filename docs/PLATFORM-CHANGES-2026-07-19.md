# Platform Changes — 2026-07-19

The Vendor Integration Contract (02) has been amended (now dated 2026-07-19), and the developer kit
has gone from scaffold to a real, tested implementation. Since you haven't wired live crypto yet, this
is simply what to build against going forward — plus a short note on where your existing analysis
(done against the live docs before this amendment) diverges from the current contract.

## Build against this

**Contract:** 02, dated 2026-07-19. The shape (§§1–6, 8–13) is stable; §7's resource list and §8's
event list stay provisional until both pilots' integration needs are in.

**Dev kit:** now a real implementation, not a scaffold — a bridge client (real + stub modes, full
bridge JS API), a server-side verify package (bridge-token verification + webhook-signature
verification), a stub kit (test JWKS, sample bridge/access tokens, 8 negative-case fixtures covering
algorithm-confusion / expired / wrong-audience / wrong-type and more), a webhook simulator CLI, and a
local OAuth stub server (Authorization Code + PKCE, rotating refresh with reuse-detection) — 49/49
tests passing. This replaces hand-rolled stubs for identity, webhooks, directory, and tenant lookups
with something that actually matches the contract's wire format, so your Phase 1/2 crypto work
(webhook HMAC, JWKS verification, OAuth) doesn't have to guess at shapes. We'll share repo access
directly.

**Docs site:** now access-gated — you'll get an access key from your platform contact. Every wire
surface in 02 now has a full worked, copy-pasteable example: OAuth authorize + token exchange, the
JWKS document, a bridge token + `bridge/verify` call and response, a complete signed webhook delivery
(headers + body + the exact signed string), the error envelope and code taxonomy, a paginated
scoped-API list call, and rate-limit responses.

## Current state, section by section

- **Webhook signature (§8):** HMAC-SHA256 over `{deliveryId}.{timestamp}.{rawBody}` — the delivery id,
  a literal `.`, the unix-seconds timestamp, a literal `.`, the raw body bytes. Headers:
  `X-EOS-Webhook-Signature: v1=<hex>`, `X-EOS-Webhook-Timestamp`, `X-EOS-Webhook-Kid`,
  `X-EOS-Webhook-Id` (also your idempotency key, and equal to the body's `id` field). Reject deliveries
  outside a ±5-minute timestamp window.
- **Webhook envelope:** every delivery body is `{ id, type, schemaVersion, createdAt, installationId,
  data: { resourceId } }`. `schemaVersion` is mandatory. Delivery is at-least-once with **no ordering
  guarantee** — don't build handlers that assume arrival order encodes event order; derive ordering
  from a timestamp/version field fetched via the scoped API if you need it.
- **Webhook secret rotation (§8):** self-serve, with an overlap window where both the old and new
  `kid`/secret pair are valid. Keep a `kid → secret` map (two entries during rotation) and verify each
  delivery against the secret for that delivery's `kid`; reject and alert on an unrecognized `kid`.
- **OAuth token endpoint (§4):** `POST /plugin-api/v1/oauth/token` requires
  `Authorization: Basic base64(client_id:client_secret)` (not body-embedded credentials) and a JSON
  body (not form-encoded) — build your token-exchange client this way from the start.
- **`bridge/verify` response (§5):** `{ active, installationId, tenantId, userId, permissions }`. When
  `active: false`, `tenantId`/`userId` are empty strings and `permissions` is an empty array — always
  HTTP 200, never a 4xx/5xx to signal an inactive installation.
- **Sensitive/PII scopes (§2/§7):** for `users.read` / `tenant.read`, request the scope normally in
  `scopes[]` (you get the resource with PII fields nulled); additionally list the same scope name in
  `sensitiveScopes[]` to request the PII-populated variant, subject to per-vendor approval.
  `export.read` has no non-sensitive form — it can only be requested already paired with a
  `sensitiveScopes[]` entry.
- **Kill-switch signal (§6):** the scoped API returns `401` with `error.code: "plugin_revoked"` for a
  killed/paused/uninstalled installation — a stable code distinct from a generic invalid-token 401,
  worth branching your "integration paused" UX on directly.
- **Deletion attestation (§11):** submitted per installation through the partner portal today (dated,
  vendor-signed, what/when/who); becomes a direct API call
  (`POST /plugin-api/v1/{pluginName}/attestations/deletion`) at platform go-live.
- **Your branded domain (§15):** if you want a standalone, vendor-branded surface beyond the embed,
  your domain CNAMEs to a platform-given target (after DNS TXT ownership verification) and the
  platform serves a branded login + workspace shell there. You never build or host a login form — not
  on your branded domain, not anywhere. Marketing sites stay entirely on your own infrastructure. This
  is the answer to the standalone-login question in your open-questions doc.
- **Sensitive-scope pen-test gate (§9):** before your first production grant of any sensitive-tier
  scope (PII fields, `export.read`, event-firehose), an independent penetration test of your plugin is
  a gate condition — applies to pilots too, no exemption. Plan for this before you request a sensitive
  scope.

## If you already prototyped against the old draft

Your earlier contract analysis was done against the live docs before this amendment, so a couple of
things are worth a second look even though you haven't wired real crypto yet:

- Anywhere your design assumed the webhook signed string was `v1:{timestamp}.{rawBody}`, update it to
  `{deliveryId}.{timestamp}.{rawBody}` (§8, above) before you build your webhook-signature phase.
- The `bridge/verify` response shape above is now the documented contract; if your identity
  interface's real-mode stub was modeled on a guess, reconcile it against this shape before you wire
  real identity verification.
- Nothing else in your existing tenant-scoping, permission-catalog, or multi-tenant data work is
  affected — those are unrelated to this amendment.

---

Questions on any of the above — reach out to your platform contact.
