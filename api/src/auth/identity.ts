// THE identity interface. One server-side module answers "who is this, which
// tenant/installation, what permissions?" The only implementation today is the
// dev stub; the real one (platform-signed token verification via JWKS) slots in
// behind this same interface once the Vendor Integration Contract arrives.
export interface Identity {
  userId: string; // platform user id
  name: string; // display name
  tenantId: string;
  installationId: string;
  permissions: ReadonlySet<string>; // effective dive.* permissions
}

export interface IdentityProvider {
  verify(token: string): Promise<Identity | null>; // null = invalid
}

// Nest injection token.
export const IDENTITY_PROVIDER = 'IDENTITY_PROVIDER';

// ANY-of permission check helper.
export function hasPerm(identity: Identity, ...perms: string[]): boolean {
  return perms.some((p) => identity.permissions.has(p));
}
