import { Logger, Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { DevStubWebhookVerifier, HmacWebhookVerifier, WEBHOOK_VERIFIER } from './webhook-verifier';

// Which webhook verifier ships.
//
// DEFAULT IS THE REAL ONE, for the same reason as the identity provider: this is opt-IN to the
// insecure stub. The stub accepts a static header, so anything that can reach the endpoint can
// trigger installation.deleted — a cross-tenant cascade delete. An unset or mistyped env var must
// land on HMAC verification, never on that.
function verifierClass(): typeof DevStubWebhookVerifier | typeof HmacWebhookVerifier {
  if (process.env.USE_DEV_WEBHOOK_STUB === 'true') return DevStubWebhookVerifier;
  return HmacWebhookVerifier;
}

@Module({
  controllers: [WebhooksController],
  providers: [{ provide: WEBHOOK_VERIFIER, useClass: verifierClass() }],
})
export class WebhooksModule {
  constructor() {
    new Logger('WebhooksModule').log(
      `Webhook verifier: ${verifierClass().name}` +
        (process.env.USE_DEV_WEBHOOK_STUB === 'true' ? ' (DEV STUB — static header, not a signature)' : ''),
    );
  }
}
