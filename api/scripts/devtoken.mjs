#!/usr/bin/env node
// ============================================================================
// DEV STUB token minter — NEVER SHIP.
// Prints `devtoken.<base64url(JSON)>` for one of the 5 seeded dev users, for use
// as `Authorization: Bearer <token>` against the API in local dev / curl / the
// harness. The DevStubIdentityProvider decodes these WITHOUT any signature check.
//
// Usage:
//   node scripts/devtoken.mjs                 # dana (default)
//   node scripts/devtoken.mjs riley           # riley
//   node scripts/devtoken.mjs --curl sam      # also print an example curl
//
// This duplicates api/src/auth/dev-users.ts on purpose (a standalone dev tool);
// keep the two in sync if you change the dev-user table.
// ============================================================================

const P = {
  JOBS_VIEW_ALL: 'dive.jobs.view-all',
  JOBS_VIEW_ASSIGNED: 'dive.jobs.view-assigned',
  JOBS_MANAGE: 'dive.jobs.manage',
  JOBS_COMPLETE: 'dive.jobs.complete',
  JOBS_VIEW_PRICING: 'dive.jobs.view-pricing',
  CHECKLIST_MANAGE: 'dive.checklist.manage',
  RECORDS_VIEW: 'dive.records.view',
  RECORDS_SEND: 'dive.records.send',
  RECORDS_MANAGE: 'dive.records.manage',
  CREW_VIEW: 'dive.crew.view',
  CREW_MANAGE: 'dive.crew.manage',
  PAY_VIEW_OWN: 'dive.pay.view-own',
  PAY_VIEW_ALL: 'dive.pay.view-all',
  POS_USE: 'dive.pos.use',
  FINANCE_VIEW: 'dive.finance.view',
  FINANCE_MANAGE: 'dive.finance.manage',
  INVENTORY_VIEW: 'dive.inventory.view',
  INVENTORY_MANAGE: 'dive.inventory.manage',
  SETTINGS_MANAGE: 'dive.settings.manage',
};
const ALL = Object.values(P);

const USERS = {
  dana: { sub: 'usr_dana', name: 'Dana Reyes', tenantId: 'tenant_demo', installationId: 'inst_demo', permissions: ALL },
  sam: {
    sub: 'usr_sam',
    name: 'Sam Okafor',
    tenantId: 'tenant_demo',
    installationId: 'inst_demo',
    permissions: [
      P.JOBS_VIEW_ALL, P.JOBS_MANAGE, P.JOBS_COMPLETE, P.JOBS_VIEW_PRICING, P.CHECKLIST_MANAGE,
      P.RECORDS_VIEW, P.RECORDS_SEND, P.CREW_VIEW, P.PAY_VIEW_ALL, P.INVENTORY_VIEW, P.INVENTORY_MANAGE,
    ],
  },
  riley: {
    sub: 'usr_riley',
    name: 'Riley Chen',
    tenantId: 'tenant_demo',
    installationId: 'inst_demo',
    permissions: [P.JOBS_VIEW_ASSIGNED, P.JOBS_COMPLETE, P.PAY_VIEW_OWN, P.INVENTORY_VIEW],
  },
  casey: {
    sub: 'usr_casey',
    name: 'Casey Marsh',
    tenantId: 'tenant_demo',
    installationId: 'inst_demo',
    permissions: [
      P.JOBS_VIEW_ALL, P.RECORDS_VIEW, P.RECORDS_SEND, P.POS_USE, P.FINANCE_VIEW,
      P.INVENTORY_VIEW, P.INVENTORY_MANAGE, P.CREW_VIEW,
    ],
  },
  olga: { sub: 'usr_olga', name: 'Olga Petrov', tenantId: 'tenant_two', installationId: 'inst_other', permissions: ALL },
};

const args = process.argv.slice(2);
const withCurl = args.includes('--curl');
const key = args.find((a) => !a.startsWith('--')) || 'dana';

const user = USERS[key];
if (!user) {
  console.error(`Unknown dev user "${key}". Choose one of: ${Object.keys(USERS).join(', ')}`);
  process.exit(1);
}

const token = 'devtoken.' + Buffer.from(JSON.stringify(user)).toString('base64url');
const port = process.env.PORT || '4310';

if (withCurl) {
  console.log(`# ${key} (${user.name}) — ${user.permissions.length} permission(s)`);
  console.log(`curl -s http://localhost:${port}/api/me -H 'Authorization: Bearer ${token}'`);
} else {
  console.log(token);
}
