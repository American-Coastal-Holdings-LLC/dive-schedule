// ============================================================================
// DEV ONLY — NEVER SHIP. Clearly-dev-only mirror of the 5 seeded platform users
// (docs/ARCHITECTURE.md §Dev users). Used by:
//   - StandaloneDevBridge, to mint a devtoken when the app runs un-framed.
//   - app/harness, to impersonate a user for the embedded iframe.
// The real platform delivers signed identity tokens via the bridge; this file has
// no place in a production build path. The `id` doubles as the platform user id
// (the `sub` claim) and MUST match the API's dev directory + Prisma seed so that
// job assignment and pay attribution line up.
// ============================================================================

import { PERMISSIONS as P, ALL_PERMISSIONS } from '../permissions';

export interface DevUser {
  key: string;
  id: string; // platform user id (token `sub`)
  name: string;
  role: string; // caption only — NOT used for any authorization decision
  tenantId: string;
  installationId: string;
  permissions: string[];
}

export const DEV_USERS: DevUser[] = [
  {
    key: 'dana',
    id: 'usr_dana',
    name: 'Dana Reyes',
    role: 'Owner — full access',
    tenantId: 'tenant_demo',
    installationId: 'inst_demo',
    permissions: [...ALL_PERMISSIONS],
  },
  {
    key: 'sam',
    id: 'usr_sam',
    name: 'Sam Okafor',
    role: 'Divemaster — crew lead',
    tenantId: 'tenant_demo',
    installationId: 'inst_demo',
    permissions: [
      P.JOBS_VIEW_ALL,
      P.JOBS_MANAGE,
      P.JOBS_COMPLETE,
      P.JOBS_VIEW_PRICING,
      P.CHECKLIST_MANAGE,
      P.RECORDS_VIEW,
      P.RECORDS_SEND,
      P.CREW_VIEW,
      P.PAY_VIEW_ALL,
      P.INVENTORY_VIEW,
      P.INVENTORY_MANAGE,
    ],
  },
  {
    key: 'riley',
    id: 'usr_riley',
    name: 'Riley Chen',
    role: 'Diver — assigned jobs only',
    tenantId: 'tenant_demo',
    installationId: 'inst_demo',
    permissions: [P.JOBS_VIEW_ASSIGNED, P.JOBS_COMPLETE, P.PAY_VIEW_OWN, P.INVENTORY_VIEW],
  },
  {
    key: 'casey',
    id: 'usr_casey',
    name: 'Casey Marsh',
    role: 'Front desk — sales & records',
    tenantId: 'tenant_demo',
    installationId: 'inst_demo',
    permissions: [
      P.JOBS_VIEW_ALL,
      P.RECORDS_VIEW,
      P.RECORDS_SEND,
      P.POS_USE,
      P.FINANCE_VIEW,
      P.INVENTORY_VIEW,
      P.INVENTORY_MANAGE,
      P.CREW_VIEW,
    ],
  },
  {
    key: 'olga',
    id: 'usr_olga',
    name: 'Olga Petrov',
    role: 'Owner — 2nd tenant (isolation)',
    tenantId: 'tenant_two',
    installationId: 'inst_other',
    permissions: [...ALL_PERMISSIONS],
  },
];

export const DEFAULT_DEV_USER_KEY = 'dana';

export function findDevUser(key: string | null | undefined): DevUser {
  return DEV_USERS.find((u) => u.key === key) || DEV_USERS[0];
}

// Build a `devtoken.<base64url(JSON)>` accepted by the API's DevStubIdentityProvider.
// JSON shape: { sub, name, tenantId, installationId, permissions: string[] }.
export function buildDevToken(user: DevUser): string {
  const claims = {
    sub: user.id,
    name: user.name,
    tenantId: user.tenantId,
    installationId: user.installationId,
    permissions: user.permissions,
  };
  const json = JSON.stringify(claims);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  const b64url = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `devtoken.${b64url}`;
}
