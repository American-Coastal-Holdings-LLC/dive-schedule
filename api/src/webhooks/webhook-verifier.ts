import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

// Verifies inbound platform webhooks. The real verifier will check a signed +
// timestamped signature per the integration contract; this dev stub accepts a
// static header. Same interface either way.
export interface WebhookVerifier {
  verify(headers: Record<string, string | undefined>): boolean;
}

export const WEBHOOK_VERIFIER = 'WEBHOOK_VERIFIER';

// DEV STUB — NEVER SHIP. Accepts requests carrying `X-Dev-Signature` equal to
// WEBHOOK_DEV_SIGNATURE (default "dev"); everything else is rejected as 401.
@Injectable()
export class DevStubWebhookVerifier implements WebhookVerifier, OnModuleInit {
  private readonly logger = new Logger('DevStubWebhookVerifier');

  onModuleInit(): void {
    this.logger.warn(
      'DEV STUB WEBHOOK VERIFIER ACTIVE — accepts a static X-Dev-Signature header instead of a real signature. NEVER SHIP.',
    );
  }

  verify(headers: Record<string, string | undefined>): boolean {
    const expected = process.env.WEBHOOK_DEV_SIGNATURE || 'dev';
    return (headers['x-dev-signature'] || '') === expected;
  }
}
