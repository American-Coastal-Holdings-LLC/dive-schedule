import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Identity } from './identity';

// Injects request.identity (attached by IdentityGuard) into a handler param.
export const CurrentIdentity = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Identity => {
    const request = ctx.switchToHttp().getRequest<{ identity: Identity }>();
    return request.identity;
  },
);
