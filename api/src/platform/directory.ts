import { Injectable, OnModuleInit } from '@nestjs/common';
import { assertDevStubAllowed } from '../common/dev-stub-guard';
import { DEV_USERS } from '../auth/dev-users';

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
