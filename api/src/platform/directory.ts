import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { assertDevStubAllowed } from '../common/dev-stub-guard';
import { DEV_USERS } from '../auth/dev-users';
import { scopedGet } from './scoped-api-client';

// "Which platform users belong to this installation?" — resolves names for
// job/record payloads and populates assignment / completed-by pickers. The real
// implementation reads the platform's tenant user directory; this dev stub reads
// the seeded dev-user table.
export interface PlatformUser {
  id: string;
  name: string;
  active: boolean;
}

export interface PlatformDirectory {
  listUsers(installationId: string): Promise<PlatformUser[]>;
  getUser(installationId: string, userId: string): Promise<PlatformUser | null>;
}

export const PLATFORM_DIRECTORY = 'PLATFORM_DIRECTORY';

@Injectable()
export class DevStubDirectory implements PlatformDirectory, OnModuleInit {
  // Own fail-closed tripwire: serves hardcoded seeded users, so it must never run outside dev/test —
  // not even if a real IdentityProvider is later wired and the app can boot in prod.
  onModuleInit(): void {
    assertDevStubAllowed('DevStubDirectory');
  }

  async listUsers(installationId: string): Promise<PlatformUser[]> {
    return DEV_USERS.filter((u) => u.installationId === installationId).map((u) => ({
      id: u.userId,
      name: u.name,
      active: true,
    }));
  }

  async getUser(installationId: string, userId: string): Promise<PlatformUser | null> {
    const u = DEV_USERS.find((x) => x.installationId === installationId && x.userId === userId);
    return u ? { id: u.userId, name: u.name, active: true } : null;
  }
}

/**
 * PRODUCTION directory — reads the tenant's platform users over the scoped API (§7, `users.read`).
 *
 * PII IS NULLED BY DEFAULT. `users.read` requested normally returns the resource with PII fields
 * nulled; the populated variant requires listing the same scope in the manifest's
 * `sensitiveScopes[]`, which is gated on an independent penetration test (§9) that has not been
 * booked. So `name` can legitimately arrive null, and this falls back to the user id rather than
 * rendering "null" into a job assignment or a service record. If real names become a requirement,
 * that is a manifest + pen-test decision, not a code change here.
 *
 * The list endpoint is paginated (§7). Only the first page is read today because a dive operation's
 * crew is a handful of people; if that assumption ever breaks, this silently truncates, so it logs
 * when a next-page cursor is present rather than hiding it.
 */
interface ScopedUser {
  id: string;
  name?: string | null;
  displayName?: string | null;
  active?: boolean;
}

interface ScopedUserList {
  data?: ScopedUser[];
  users?: ScopedUser[];
  nextCursor?: string | null;
}

function toPlatformUser(u: ScopedUser): PlatformUser {
  return {
    id: u.id,
    // Fall back through displayName → name → id. Never surface a null into the UI.
    name: (u.displayName ?? u.name ?? '').trim() || u.id,
    active: u.active !== false,
  };
}

@Injectable()
export class ScopedApiDirectory implements PlatformDirectory {
  private readonly logger = new Logger('ScopedApiDirectory');

  async listUsers(installationId: string): Promise<PlatformUser[]> {
    const res = await scopedGet<ScopedUserList>(installationId, 'users');
    const rows = res.data ?? res.users ?? [];
    if (res.nextCursor) {
      this.logger.warn(
        `users list for ${installationId} has more pages (cursor present) — only the first page is read. ` +
          'Add pagination if crews of this size are real.',
      );
    }
    return rows.map(toPlatformUser);
  }

  async getUser(installationId: string, userId: string): Promise<PlatformUser | null> {
    try {
      const u = await scopedGet<ScopedUser>(installationId, `users/${encodeURIComponent(userId)}`);
      return u?.id ? toPlatformUser(u) : null;
    } catch {
      // An unknown user is a null, not a crash: callers render "unassigned" from it.
      return null;
    }
  }
}
