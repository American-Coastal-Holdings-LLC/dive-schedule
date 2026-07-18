import { Body, Controller, Headers, HttpCode, Inject, Post } from '@nestjs/common';
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
  ) {
    if (!this.verifier.verify(headers)) throw unauthorized('Invalid webhook signature');

    const event = body?.event || body?.type || 'unknown';
    const installationId = body?.installationId || body?.data?.installationId || '';

    if (event === 'installation.uninstalled') {
      if (installationId) await this.tenancy.deleteInstallation(installationId);
      this.logger.warn({ event, installationId }, 'installation.uninstalled processed — data deleted');
      return { ok: true, event, deleted: Boolean(installationId) };
    }

    this.logger.info({ event, installationId }, 'webhook received (logged, no-op)');
    return { ok: true, event };
  }
}
