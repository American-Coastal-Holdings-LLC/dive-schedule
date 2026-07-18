import { SetMetadata } from '@nestjs/common';

// Marks a route as not requiring identity/permission guards (healthz, webhooks).
export const IS_PUBLIC_KEY = 'diveIsPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
