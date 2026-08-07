import { Body, Controller, Headers, HttpCode, Inject, Post, Req, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { unauthorized } from '../common/api-error';
import { Public } from '../auth/public.decorator';
import { TenancyService } from '../db/tenancy.service';
import { WEBHOOK_VERIFIER, WebhookVerifier } from './webhook-verifier';

interface WebhookBody {
  event?: string;
  type?: string;
  installationId?: string;
  data?: { installationId?: string };
}

// Platform webhook receiver. Public (no identity token); guarded by signature
// verification instead. installation.uninstalled triggers the full per-installation
// cascade delete; every other event is logged and acknowledged with 202.
@Public()
@Controller('webhooks')
export class WebhooksController {
  constructor(
    @Inject(WEBHOOK_VERIFIER) private readonly verifier: WebhookVerifier,
    private readonly tenancy: TenancyService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('webhooks');
  }

  @Post('platform')
  @HttpCode(202)
  async handle(
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: WebhookBody,
    @Req() req: RawBodyRequest<Request>,
  ) {
    // req.rawBody is the exact bytes the platform signed (main.ts sets rawBody: true). Passing the
    // parsed `body` here instead would be the classic re-serialization bug — see webhook-verifier.
    if (!this.verifier.verify(headers, req.rawBody)) throw unauthorized('Invalid webhook signature');

    const event = body?.event || body?.type || 'unknown';
    const installationId = body?.installationId || body?.data?.installationId || '';

    // The contract amendment of 2026-07-19 renamed this event to `installation.deleted`; the
    // manifest declares that name. The old name is still accepted because a manifest change and a
    // platform redeploy are not simultaneous, and the cost of the two being briefly out of step is
    // a tenant's data NOT being erased on uninstall — a deletion-obligation miss, not a cosmetic
    // one. Accepting both is the only version of this that cannot silently fail.
    if (event === 'installation.deleted' || event === 'installation.uninstalled') {
      if (installationId) await this.tenancy.deleteInstallation(installationId);
      this.logger.warn({ event, installationId }, 'installation deletion processed — data deleted');
      return { ok: true, event, deleted: Boolean(installationId) };
    }

    this.logger.info({ event, installationId }, 'webhook received (logged, no-op)');
    return { ok: true, event };
  }
}
