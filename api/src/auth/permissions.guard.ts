import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { forbidden, unauthorized } from '../common/api-error';
import { Identity } from './identity';
import { PERMISSIONS_KEY } from './require-permissions.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

// Global guard (runs after IdentityGuard): enforces @RequirePermissions as ANY-of.
// Routes with no @RequirePermissions still require a valid identity (e.g. /api/me).
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || [];

    const request = context.switchToHttp().getRequest<{ identity?: Identity }>();
    const identity = request.identity;
    if (!identity) throw unauthorized('Missing identity');

    if (required.length === 0) return true;
    if (required.some((p) => identity.permissions.has(p))) return true;
    throw forbidden('Missing required permission');
  }
}
