import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { unauthorized } from '../common/api-error';
import { IDENTITY_PROVIDER, IdentityProvider } from './identity';
import { IS_PUBLIC_KEY } from './public.decorator';

// Global guard: reads `Authorization: Bearer <token>`, verifies it, and attaches
// request.identity. @Public() routes (healthz, webhooks) skip it.
@Injectable()
export class IdentityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(IDENTITY_PROVIDER) private readonly identityProvider: IdentityProvider,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      identity?: unknown;
    }>();
    const header = request.headers['authorization'] || '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const token = match ? match[1].trim() : '';
    const identity = token ? await this.identityProvider.verify(token) : null;
    if (!identity) {
      throw unauthorized('Missing or invalid identity token');
    }
    request.identity = identity;
    return true;
  }
}
