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

// ============================================================================
//  Platform namespacing (Vendor Integration Contract §2)
//
//  Three forms of the same permission exist; keep them straight:
//    1. INTERNAL / guard form   — `dive.jobs.view-all`   (the P constants above; what DEV_USERS
//       hold and what every guard checks — UNCHANGED)
//    2. MANIFEST-bare form      — `jobs.view-all`        (internal form with the plugin prefix
//       stripped; what manifest.json declares — the platform namespaces it on registration)
//    3. PLATFORM-namespaced form — `ext.<vendorSlug>.<pluginSlug>.jobs.view-all`
//       (what the bridge token and the bridge/verify response carry over the wire)
//
//  WHY THIS EXISTS: the contract registers your bare key into your namespace — "you write
//  `jobs.read`; it registers as `ext.acme.dive.jobs.read`". So the moment real identity is wired,
//  the wire delivers form (3) while every guard compares form (1). Nothing throws; the sets simply
//  never intersect, so EVERY permission check returns false and every user sees an empty app. That
//  is the failure this module prevents, and it is invisible until a real token arrives.
//
//  Form (1) is exactly form (3) minus the `ext.<vendorSlug>.` segment, which is what lets the
//  guards keep matching plain `dive.*` after stripNamespace(). That equivalence holds ONLY while
//  the runtime pluginSlug() equals the prefix the constants are compiled against — so the wire
//  seam asserts it rather than silently mis-stripping.
// ============================================================================

/**
 * The plugin slug the 19 internal constants above are hardcoded against.
 *
 * PENDING EOS ASSIGNMENT: SprocketSuite's slug of record is 'sprocketsuite' and is immutable once
 * registered. No slug has been assigned for this plugin yet, so this is our proposed value and the
 * manifest's `name` must agree with whatever EOS actually assigns. If they assign something else,
 * change this constant (and the 19 keys follow automatically) — assertSlugCoherence() will refuse
 * to run against a mismatch rather than let it fail silently.
 */
export const INTERNAL_PERMISSION_PREFIX = 'dive';

/**
 * American Coastal Holdings' assigned vendor slug, confirmed from the SprocketSuite vendor box.
 * Both plugins are the same legal vendor; this is reused, never re-minted. ('acme' is the
 * contract's example vendor and was never ours.)
 */
export function vendorSlug(): string {
  return process.env.EOS_VENDOR_SLUG ?? process.env.VENDOR_SLUG ?? 'ach';
}

export function pluginSlug(): string {
  return process.env.EOS_PLUGIN_SLUG ?? process.env.PLUGIN_SLUG ?? INTERNAL_PERMISSION_PREFIX;
}

/**
 * Fail loudly if the configured plugin slug disagrees with the prefix the constants are compiled
 * against. A mismatch re-namespaces the bridge/verify response to `<configuredSlug>.*` while the
 * guards stay `dive.*` — every check fails silently, which is a production outage that looks like
 * "the app shows nothing". Throwing at the wire seam turns it into a boot-time error instead.
 */
export function assertSlugCoherence(): void {
  const configured = pluginSlug();
  if (configured !== INTERNAL_PERMISSION_PREFIX) {
    throw new Error(
      `EOS_PLUGIN_SLUG='${configured}' disagrees with the compiled internal permission prefix ` +
        `'${INTERNAL_PERMISSION_PREFIX}'. The 19 permission constants are hardcoded ` +
        `'${INTERNAL_PERMISSION_PREFIX}.*'; a mismatch makes every permission check fail silently. ` +
        `Set EOS_PLUGIN_SLUG=${INTERNAL_PERMISSION_PREFIX} (the slug of record).`,
    );
  }
}

/**
 * Internal `dive.*` (or already manifest-bare) key → `ext.<vendorSlug>.<pluginSlug>.<bareKey>`.
 * Idempotent on already-namespaced input.
 */
export function fullKey(bareKey: string): string {
  if (bareKey.startsWith('ext.')) return bareKey;
  assertSlugCoherence();
  const plugin = pluginSlug();
  // Normalise the internal `dive.<x>` form down to manifest-bare `<x>` first, so an internal key
  // never double-prefixes the plugin slug.
  const manifestBare = bareKey.startsWith(`${plugin}.`) ? bareKey.slice(plugin.length + 1) : bareKey;
  return `ext.${vendorSlug()}.${plugin}.${manifestBare}`;
}

/**
 * Platform-namespaced `ext.<vendorSlug>.<pluginSlug>.<x>` → internal guard form `dive.<x>`.
 * Returns the input unchanged when it is not ext-namespaced (already bare/internal), so a dev-stub
 * token and a real bridge token both land on the same guard vocabulary.
 */
export function stripNamespace(fullKeyStr: string): string {
  assertSlugCoherence();
  const plugin = pluginSlug();
  const prefix = `ext.${vendorSlug()}.${plugin}.`;
  if (fullKeyStr.startsWith(prefix)) return `${plugin}.${fullKeyStr.slice(prefix.length)}`;
  return fullKeyStr;
}

/** Strip the internal plugin prefix for the manifest catalog. `dive.jobs.view-all` → `jobs.view-all`. */
export function manifestBareKey(internalKey: string): string {
  const plugin = pluginSlug();
  return internalKey.startsWith(`${plugin}.`) ? internalKey.slice(plugin.length + 1) : internalKey;
}
