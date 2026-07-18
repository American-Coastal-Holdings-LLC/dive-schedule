// The 19 dive.* permissions (mirror of PLATFORM_INTEGRATION_NEEDS.md §4).
// Frontend keeps its own copy in web/src/lib/permissions.ts.
export const P = {
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
} as const;

export type Permission = (typeof P)[keyof typeof P];

// Order preserved for stable listing / consent display.
export const ALL_PERMISSIONS: string[] = Object.values(P);
