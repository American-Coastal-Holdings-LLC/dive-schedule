// Fail-closed gate for the INSECURE dev stubs (unverified identity, static webhook signature,
// hardcoded directory/tenant profiles). They run ONLY in a known dev/test context; every other
// environment — staging, canary/preview, an unset or mistyped NODE_ENV, and especially production —
// refuses to boot rather than silently accepting spoofed identity or webhooks.
//
// This is an ALLOW-LIST (default-deny), deliberately not a deny-list: forgetting to set
// NODE_ENV=production must NOT re-open the stubs. Production is additionally hard-blocked so the
// ALLOW_DEV_STUBS escape hatch can never re-enable a stub there.
export function assertDevStubAllowed(stubName: string): void {
  const env = (process.env.NODE_ENV || '').trim().toLowerCase();
  if (env === 'production') {
    throw new Error(
      `${stubName} is an INSECURE dev stub and must NEVER run in production. ` +
        `Wire the real provider before deploying.`,
    );
  }
  if (env === 'development' || env === 'test') return;
  if (process.env.ALLOW_DEV_STUBS === 'true') return;
  throw new Error(
    `${stubName} is an INSECURE dev stub and refuses to boot outside a known dev/test environment ` +
      `(set NODE_ENV=development or NODE_ENV=test, or ALLOW_DEV_STUBS=true for a trusted local run). ` +
      `NODE_ENV is "${process.env.NODE_ENV ?? ''}". Wire the real provider before deploying.`,
  );
}
