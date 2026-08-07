// Product identity — the single source of truth.
//
// WHY THIS IS ONE FILE: "Dive Schedule" is a working title. The rename to a real brand is a
// decided-but-deferred change, so every surface that says the product's name reads it from here
// — document title, app chrome, the plugin manifest, the docs. When the name lands, this file is
// the edit; there is no repo-wide find-and-replace to get wrong. The one thing that does NOT
// follow automatically is the `dive.*` permission-key prefix, which is a wire contract with the
// platform and must be renamed deliberately, with EOS, or not at all.
//
// WHAT DOES NOT BELONG HERE: the tenant's own name. Each dive operation is a platform tenant and
// its display name/logo arrive at runtime from the tenant profile. This file is the VENDOR's
// product brand — the name in the EOS plugin catalogue and on the vendor's own surfaces — never
// the customer's. Rendering BRAND.name where a tenant name belongs is a white-label bug.

export const BRAND = {
  /** Product name, as shown to humans. */
  name: 'Dive Schedule',

  /** Machine name: the plugin's stable id in the EOS registry, and the DNS label of the embed
   *  host. Renaming this is a platform-coordinated migration, not a cosmetic change. */
  slug: 'dive-schedule',

  /** One line, under the wordmark in the app chrome. Describes the work, not the software. */
  tagline: 'Dockside operations',

  /** One sentence, for the plugin catalogue and document metadata. */
  description:
    'Dive-operations system for commercial hull-cleaning outfits: recurring boat rotations, ' +
    'a checklist-and-certify workflow with an immutable service record per cleaning, crew pay, ' +
    'point-of-sale against inventory, and an income/expense ledger.',

  /** The vendor. This app is one of American Coastal Holdings' EOS plugins. */
  vendor: 'American Coastal Holdings',

  /** Deep-ocean navy — the brand constant, mirrored by --brand in globals.css. Used where a
   *  colour must exist outside CSS (browser theme-color, manifest, OG images). */
  color: '#14315e',
} as const;

// Embed origin. No vendor box is allocated yet, so this resolves to the local dev origin and the
// manifest carries a clearly-marked placeholder. When the box exists, set NEXT_PUBLIC_APP_ORIGIN
// (and the matching manifest entries) — it is referenced here, in the CSP frame-ancestors pin,
// and in the webhook/OAuth URLs, and those three must agree.
export const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'http://localhost:4311';
