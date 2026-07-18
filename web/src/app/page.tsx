'use client';

// The app rendered inside the platform iframe. PlatformProvider owns the bridge (identity/theme/
// toast/resize); PermissionsProvider seeds identity + permissions from GET /api/me; Shell renders the
// permission-filtered tabs.

import { PlatformProvider } from '@/components/PlatformProvider';
import { PermissionsProvider } from '@/components/PermissionsProvider';
import { Shell } from '@/components/Shell';

export default function Page() {
  return (
    <PlatformProvider>
      <PermissionsProvider>
        <Shell />
      </PermissionsProvider>
    </PlatformProvider>
  );
}
