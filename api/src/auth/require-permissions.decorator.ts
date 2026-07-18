import { SetMetadata } from '@nestjs/common';

// The caller needs ANY of the listed permissions (most routes list one).
export const PERMISSIONS_KEY = 'diveRequiredPermissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
