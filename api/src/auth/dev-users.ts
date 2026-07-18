import { P, ALL_PERMISSIONS } from './permissions';

// The 5 seeded dev users, exactly per docs/ARCHITECTURE.md "Dev users" table.
// This module is dev-only scaffolding (the harness + Prisma seed + PlatformDirectory
// dev stub read it). The real platform supplies users/permissions once the Vendor
// Integration Contract lands.
export interface DevUser {
  key: string;
  userId: string;
  name: string;
  tenantId: string;
  installationId: string;
  permissions: string[];
}

export const DEV_USERS: DevUser[] = [
  {
    key: 'dana',
    userId: 'usr_dana',
    name: 'Dana Reyes',
    tenantId: 'tenant_demo',
    installationId: 'inst_demo',
    permissions: [...ALL_PERMISSIONS],
  },
  {
    key: 'sam',
    userId: 'usr_sam',
    name: 'Sam Okafor',
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
    userId: 'usr_riley',
    name: 'Riley Chen',
    tenantId: 'tenant_demo',
    installationId: 'inst_demo',
    permissions: [P.JOBS_VIEW_ASSIGNED, P.JOBS_COMPLETE, P.PAY_VIEW_OWN, P.INVENTORY_VIEW],
  },
  {
    key: 'casey',
    userId: 'usr_casey',
    name: 'Casey Marsh',
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
    userId: 'usr_olga',
    name: 'Olga Petrov',
    tenantId: 'tenant_two',
    installationId: 'inst_other',
    permissions: [...ALL_PERMISSIONS],
  },
];

export const DEV_USERS_BY_KEY: Record<string, DevUser> = Object.fromEntries(
  DEV_USERS.map((u) => [u.key, u]),
);

export const DEV_USERS_BY_ID: Record<string, DevUser> = Object.fromEntries(
  DEV_USERS.map((u) => [u.userId, u]),
);
