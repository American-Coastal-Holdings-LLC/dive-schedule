import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { assertDevStubAllowed } from '../common/dev-stub-guard';

// Verifies inbound platform webhooks (contract §8).
//
// NOTE THE rawBody PARAMETER. It is not optional detail: the signature covers the exact bytes the
// platform sent, so verifying against a re-serialized `JSON.stringify(body)` fails on any
// whitespace or key-order difference — and, worse, would pass for an attacker who reorders keys
// while keeping a stale signature valid. The previous interface took only headers, which made real
// verification impossible to implement behind it.
export interface WebhookVerifier {
  verify(headers: Record<string, string | undefined>, rawBody: Buffer | undefined): boolean;
}

export const WEBHOOK_VERIFIER = 'WEBHOOK_VERIFIER';

/** Contract §8: reject deliveries outside ±5 minutes. */
const TOLERANCE_SECONDS = 300;

/**
 * PRODUCTION webhook verifier (contract §8, as amended 2026-07-19).
 *
 *   signed content : `{deliveryId}.{timestamp}.{rawBody}`   (Standard-Webhooks style)
 *   signature      : X-EOS-Webhook-Signature: v1=<hex>      HMAC-SHA256
 *   timestamp      : X-EOS-Webhook-Timestamp                unix seconds, ±300s
 *   delivery id    : X-EOS-Webhook-Id                       also the idempotency key
 *   key id         : X-EOS-Webhook-Kid                      selects among rotated secrets
 *
 * ROTATION: secrets are a `kid -> secret` map, because rotation is self-serve with an overlap
 * window where BOTH the old and the new pair are valid. Verifying against a single "current"
 * secret would drop every delivery still signed with the old one, mid-rotation, silently. Each
 * delivery is verified against the secret for ITS OWN kid; an unrecognised kid is rejected.
 *
 * The signed string is assembled the same way the platform's own devkit assembles it
 * (vendor/eos-plugin-devkit/packages/verify) — that is the reference implementation, and this
 * matches it deliberately rather than re-deriving the format from prose.
 */
@Injectable()
export class HmacWebhookVerifier implements WebhookVerifier, OnModuleInit {
  private readonly logger = new Logger('HmacWebhookVerifier');
  private secrets: Record<string, string> = {};

  onModuleInit(): void {
    this.secrets = this.loadSecrets();
    const count = Object.keys(this.secrets).length;
    if (count === 0) {
      // Fail closed and say so loudly at boot rather than 401-ing every delivery at 3am. An empty
      // map means every webhook is rejected — including installation.deleted, which carries a
      // 30-day data-deletion obligation (§11).
      this.logger.error(
        'EOS_WEBHOOK_SECRETS is empty or unparseable — EVERY webhook delivery will be rejected, ' +
          'including installation.deleted (which drives the deletion obligation). ' +
          'Set EOS_WEBHOOK_SECRETS={"<kid>":"<secret>"}.',
      );
    } else {
      this.logger.log(`Webhook signature verification active (${count} key id(s) loaded).`);
    }
  }

  private loadSecrets(): Record<string, string> {
    const raw = (process.env.EOS_WEBHOOK_SECRETS || '').trim();
    if (!raw) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const out: Record<string, string> = {};
      for (const [kid, secret] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof secret === 'string' && secret) out[kid] = secret;
      }
      return out;
    } catch {
      return {};
    }
  }

  verify(headers: Record<string, string | undefined>, rawBody: Buffer | undefined): boolean {
    const signature = headers['x-eos-webhook-signature'];
    const timestamp = headers['x-eos-webhook-timestamp'];
    const deliveryId = headers['x-eos-webhook-id'];
    const kid = headers['x-eos-webhook-kid'];

    if (!signature || !timestamp || !deliveryId) {
      this.logger.warn('webhook rejected: missing signature/timestamp/id header');
      return false;
    }
    if (!rawBody) {
      // Without the exact bytes there is nothing trustworthy to verify against; never fall back to
      // a re-serialized body.
      this.logger.error('webhook rejected: raw body unavailable (is rawBody enabled in main.ts?)');
      return false;
    }

    const match = /^v1=([0-9a-f]+)$/i.exec(signature.trim());
    if (!match) {
      this.logger.warn('webhook rejected: signature is not in v1=<hex> form');
      return false;
    }

    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) {
      this.logger.warn('webhook rejected: timestamp is not unix seconds');
      return false;
    }
    if (Math.abs(Math.floor(Date.now() / 1000) - ts) > TOLERANCE_SECONDS) {
      this.logger.warn(`webhook rejected: timestamp outside ±${TOLERANCE_SECONDS}s (replay defense)`);
      return false;
    }

    // Select the secret by the delivery's OWN kid. A missing kid can only be honoured when exactly
    // one secret is configured — during a rotation there are two, and guessing between them is how
    // you accept a delivery signed by neither.
    const kids = Object.keys(this.secrets);
    const secret = kid ? this.secrets[kid] : kids.length === 1 ? this.secrets[kids[0]] : undefined;
    if (!secret) {
      this.logger.warn(`webhook rejected: unrecognised or ambiguous key id (kid=${kid ?? 'absent'})`);
      return false;
    }

    const expected = createHmac('sha256', secret)
      .update(`${deliveryId}.${timestamp}.${rawBody.toString('utf8')}`, 'utf8')
      .digest('hex');

    const provided = match[1].toLowerCase();
    // Constant-time compare. Length is checked first because timingSafeEqual throws on a mismatch,
    // and the length of a hex digest is not a secret.
    if (provided.length !== expected.length) {
      this.logger.warn('webhook rejected: signature mismatch');
      return false;
    }
    const ok = timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'));
    if (!ok) this.logger.warn('webhook rejected: signature mismatch');
    return ok;
  }
}

// DEV STUB — NEVER SHIP. Accepts requests carrying `X-Dev-Signature` equal to
// WEBHOOK_DEV_SIGNATURE; everything else is rejected as 401.
@Injectable()
export class DevStubWebhookVerifier implements WebhookVerifier, OnModuleInit {
  private readonly logger = new Logger('DevStubWebhookVerifier');

  onModuleInit(): void {
    // Fail closed: this stub accepts a static shared header instead of a real signature, so any caller
    // could trigger installation webhooks — including the cross-tenant cascade delete. Refuse to boot
    // outside a known dev/test context (see dev-stub-guard).
    assertDevStubAllowed('DevStubWebhookVerifier');
    this.logger.warn(
      'DEV STUB WEBHOOK VERIFIER ACTIVE — accepts a static X-Dev-Signature header instead of a real signature. NEVER SHIP.',
    );
  }

  verify(headers: Record<string, string | undefined>): boolean {
    // No global-constant default: without an explicitly configured signature, reject everything, so a
    // misconfigured verifier cannot be driven by the publicly-known "dev" value.
    const expected = process.env.WEBHOOK_DEV_SIGNATURE;
    if (!expected) return false;
    return (headers['x-dev-signature'] || '') === expected;
  }
}
