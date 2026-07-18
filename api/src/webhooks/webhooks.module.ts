import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { DevStubWebhookVerifier, WEBHOOK_VERIFIER } from './webhook-verifier';

@Module({
  controllers: [WebhooksController],
  providers: [{ provide: WEBHOOK_VERIFIER, useClass: DevStubWebhookVerifier }],
})
export class WebhooksModule {}
