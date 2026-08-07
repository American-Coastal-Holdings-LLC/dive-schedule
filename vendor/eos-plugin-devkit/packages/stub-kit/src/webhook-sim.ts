/**
 * @eos/plugin-stub-kit — webhook simulator (contract 02 §8, §13).
 *
 * POSTs a signed sample webhook delivery to a vendor's local receiver so
 * they can build/verify their handler (signature check, tolerance window,
 * idempotency) without a live platform. Reuses `@eos/plugin-verify`'s
 * `computeWebhookSignature()` for the actual HMAC (contract §8 as amended
 * 2026-07-19: signed content is `{deliveryId}.{timestamp}.{rawBody}`) — this
 * module never reimplements the crypto, only assembles deliveries and
 * (for the failure-mode switches) deliberately breaks one field at a time.
 *
 * This file holds the reusable core (importable programmatically); the thin
 * CLI wrapper lives in `bin/webhook-sim.ts`.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { computeWebhookSignature } from '@eos/plugin-verify';
import { STUB_INSTALLATION_ID } from './index.ts';

// ===========================================================================
// Sample event catalog (contract 02 §8's provisional event list)
// ===========================================================================

export const SAMPLE_EVENT_TYPES = [
  'installation.created',
  'installation.deleted',
  'subscription.activated',
  'subscription.trial_started',
  'subscription.expired',
  'subscription.canceled',
  'user.created',
  'user.updated',
  'user.deactivated',
  'user.role_changed',
  'tenant.branding_updated',
] as const;

export type SampleEventType = (typeof SAMPLE_EVENT_TYPES)[number];

/** Default `X-EOS-Webhook-Kid` value the simulator sends when none is given. */
export const DEFAULT_WEBHOOK_KID = 'stub-webhook-key-1';

/** Default replay-past offset used by `--stale-timestamp` (10 min — safely
 * past the contract's ±5 min / 300s tolerance window). */
export const DEFAULT_STALE_OFFSET_SECONDS = 600;

export interface BuildSamplePayloadOptions {
  installationId?: string;
  /** Per-event-type schema version (contract §8: "every delivery body
   * carries a `schemaVersion` integer"). Default 1. */
  schemaVersion?: number;
}

/**
 * Build a default sample payload for a given event type, matching contract
 * §8's worked delivery example EXACTLY: `{ id, type, schemaVersion,
 * createdAt, installationId, data: { resourceId } }`. `id` MUST equal the
 * delivery's `X-EOS-Webhook-Id` — the contract's worked example opens the
 * signed string with the same value that also appears as the body's `id`
 * field — so callers MUST pass the same `deliveryId` used for the headers
 * (see {@link buildDeliveryHeaders}); this function does not generate its
 * own, precisely so the two can never drift apart.
 */
export function buildSamplePayload(
  event: string,
  deliveryId: string,
  options: BuildSamplePayloadOptions = {},
): Record<string, unknown> {
  return {
    id: deliveryId,
    type: event,
    schemaVersion: options.schemaVersion ?? 1,
    createdAt: new Date().toISOString(),
    installationId: options.installationId ?? STUB_INSTALLATION_ID,
    data: { resourceId: `res_${randomUUID()}` },
  };
}

// ===========================================================================
// Delivery construction + sending
// ===========================================================================

export interface WebhookDeliveryOptions {
  /** Target URL the delivery is POSTed to. */
  url: string;
  /** Per-installation webhook signing secret (contract §8/§10). */
  secret: string;
  /** Exact raw bytes to sign and send — never re-serialized after signing. */
  rawBody: string;
  /** `X-EOS-Webhook-Kid` value. Default {@link DEFAULT_WEBHOOK_KID}. */
  kid?: string;
  /** `X-EOS-Webhook-Id` value (also the `Idempotency-Key`). Default: random. */
  deliveryId?: string;
  /** Unix seconds. Default: now. */
  timestampSeconds?: number;
  /** Failure-mode switch: compute the signature with a corrupted secret so
   * the receiver's HMAC check must fail (`X-EOS-Webhook-Signature` stays
   * well-formed `v1=<hex>` — only the value is wrong). */
  badSignature?: boolean;
  /** Failure-mode switch: push `timestampSeconds` into the past by
   * {@link DEFAULT_STALE_OFFSET_SECONDS} (overridable via `staleBySeconds`)
   * so the receiver's ±5min tolerance check must fail. Ignored if
   * `timestampSeconds` is explicitly given. */
  staleTimestamp?: boolean;
  /** Override the stale offset applied when `staleTimestamp` is set. */
  staleBySeconds?: number;
  /** Injectable for tests / non-global-fetch runtimes. */
  fetchImpl?: typeof fetch;
}

export interface WebhookDeliveryHeaders {
  headers: Record<string, string>;
  deliveryId: string;
  timestampSeconds: number;
  signatureHeader: string;
  kid: string;
}

/**
 * Build the exact headers for one delivery attempt, without sending it —
 * split out from {@link sendWebhookDelivery} so a caller (or a test) can
 * assert on signature correctness without a network round trip, and so
 * `--duplicate` can resend the identical headers+body pair unchanged.
 */
export function buildDeliveryHeaders(opts: WebhookDeliveryOptions): WebhookDeliveryHeaders {
  const deliveryId = opts.deliveryId ?? randomUUID();
  const baseTimestamp = opts.timestampSeconds ?? Math.floor(Date.now() / 1000);
  const timestampSeconds =
    opts.timestampSeconds === undefined && opts.staleTimestamp
      ? baseTimestamp - (opts.staleBySeconds ?? DEFAULT_STALE_OFFSET_SECONDS)
      : baseTimestamp;

  const signingSecret = opts.badSignature ? `${opts.secret}:intentionally-wrong-for---bad-signature` : opts.secret;
  const signatureHex = computeWebhookSignature(signingSecret, deliveryId, String(timestampSeconds), opts.rawBody);
  const signatureHeader = `v1=${signatureHex}`;
  const kid = opts.kid ?? DEFAULT_WEBHOOK_KID;

  return {
    deliveryId,
    timestampSeconds,
    signatureHeader,
    kid,
    headers: {
      'content-type': 'application/json',
      'X-EOS-Webhook-Signature': signatureHeader,
      'X-EOS-Webhook-Timestamp': String(timestampSeconds),
      'X-EOS-Webhook-Kid': kid,
      'X-EOS-Webhook-Id': deliveryId,
    },
  };
}

export interface WebhookDeliveryResult {
  deliveryId: string;
  timestampSeconds: number;
  signatureHeader: string;
  kid: string;
  status: number;
  ok: boolean;
  responseBody: string;
}

/** Build one delivery's headers and POST it. */
export async function sendWebhookDelivery(opts: WebhookDeliveryOptions): Promise<WebhookDeliveryResult> {
  const { headers, deliveryId, timestampSeconds, signatureHeader, kid } = buildDeliveryHeaders(opts);
  const doFetch = opts.fetchImpl ?? fetch;

  const res = await doFetch(opts.url, { method: 'POST', headers, body: opts.rawBody });
  const responseBody = await res.text().catch(() => '');

  return {
    deliveryId,
    timestampSeconds,
    signatureHeader,
    kid,
    status: res.status,
    ok: res.ok,
    responseBody,
  };
}

// ===========================================================================
// CLI argument parsing (shared by the bin wrapper and tests)
// ===========================================================================

export interface WebhookSimCliOptions {
  help: boolean;
  event: string;
  url?: string;
  secret: string;
  kid: string;
  deliveryId?: string;
  payloadInline?: string;
  payloadFile?: string;
  installationId?: string;
  timestampSeconds?: number;
  badSignature: boolean;
  staleTimestamp: boolean;
  duplicate: boolean;
}

const DEFAULT_EVENT: SampleEventType = 'installation.created';
/** Matches the stub-kit-wide test secret documented in `.env.example`'s
 * `STUB_WEBHOOK_SECRET` — obviously non-production. */
const DEFAULT_SECRET = 'whsec_test_do_not_use_in_prod';

export const WEBHOOK_SIM_HELP = `eos-webhook-sim — sign and POST a sample EOS platform webhook delivery (contract 02 §8, §13)

USAGE
  eos-webhook-sim --url <target-url> [options]

REQUIRED
  --url <url>                Target URL to POST the signed delivery to (your webhook receiver).

PAYLOAD (choose at most one; default: a synthesized sample payload for --event)
  --event <type>              Event type. Default: "${DEFAULT_EVENT}".
                               One of: ${SAMPLE_EVENT_TYPES.join(', ')}
                               (contract §8's list is provisional — any string is accepted so you
                               can test against future event types too.)
  --payload <json>            Inline JSON payload, sent and signed verbatim (no re-serialization).
  --payload-file <path>       Read the JSON payload from a file, sent and signed verbatim.

SIGNING
  --secret <secret>            Webhook signing secret. Default: the stub-kit test secret
                                ("${DEFAULT_SECRET}"), matching .env.example's STUB_WEBHOOK_SECRET.
                                Repeatable as kid=value pairs (e.g. --secret k1=sec1 --secret k2=sec2) to hold a
                                small kid-keyed pool for rotation-overlap testing (contract §8/§10) — which pool
                                entry actually signs THIS delivery is chosen by --kid (defaults to the first pair
                                given if --kid is omitted). A single bare value (no "=") is the plain legacy form
                                and is used verbatim regardless of --kid; mixing a bare value with kid=value pairs
                                is an error.
  --kid <kid>                   X-EOS-Webhook-Kid header value. Default: "${DEFAULT_WEBHOOK_KID}". Also selects
                                which --secret kid=value pool entry to sign with, when a pool is given.
  --delivery-id <id>            X-EOS-Webhook-Id header value (also your Idempotency-Key). Default: random UUID.
  --installation-id <id>        Used only when synthesizing a default payload. Default: the stub-kit fixture installationId.
  --timestamp <unix-seconds>    Override X-EOS-Webhook-Timestamp explicitly (advanced; overrides --stale-timestamp).

FAILURE-MODE SIMULATION (test your rejection paths)
  --bad-signature               Sign with a corrupted secret — X-EOS-Webhook-Signature is well-formed but
                                 wrong; your receiver's HMAC check must reject it.
  --stale-timestamp              Send a timestamp ${DEFAULT_STALE_OFFSET_SECONDS}s in the past — outside the
                                 contract's ±5 min (300s) tolerance window; your receiver must reject it.
  --duplicate                    Send the SAME delivery (identical delivery id, body, signature, timestamp)
                                 twice, back-to-back — for testing Idempotency-Key dedupe.

  -h, --help                     Show this help and exit.

EXAMPLES
  # Happy path against a local receiver on :4000
  eos-webhook-sim --url http://localhost:4000/eos/webhooks --secret whsec_dev_123

  # Exercise bad-signature rejection
  eos-webhook-sim --url http://localhost:4000/eos/webhooks --bad-signature

  # Exercise stale-timestamp rejection
  eos-webhook-sim --url http://localhost:4000/eos/webhooks --stale-timestamp

  # Exercise idempotency dedupe (same delivery sent twice)
  eos-webhook-sim --url http://localhost:4000/eos/webhooks --duplicate

  # A specific event with an inline payload
  eos-webhook-sim --url http://localhost:4000/eos/webhooks --event user.created --payload '{"userId":"u_1"}'

  # Rotation-overlap testing: hold two live secrets, sign this delivery with the "new" one
  eos-webhook-sim --url http://localhost:4000/eos/webhooks --secret old=whsec_old_123 --secret new=whsec_new_456 --kid new
`;

function nextArg(argv: string[], i: number, flag: string): string {
  const value = argv[i + 1];
  if (value === undefined) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

interface ParsedSecretArg {
  /** Present only for the `kid=value` form. */
  kid?: string;
  value: string;
}

function parseSecretArg(raw: string): ParsedSecretArg {
  const eq = raw.indexOf('=');
  if (eq === -1) return { value: raw };
  return { kid: raw.slice(0, eq), value: raw.slice(eq + 1) };
}

/**
 * Resolve one or more `--secret` occurrences into the single secret (and
 * kid) that will actually sign this delivery. Supports contract §8/§10's
 * rotation-overlap testing: pass `--secret k1=v1 --secret k2=v2`, then
 * `--kid` selects which pool entry signs — this is a small local mirror of
 * the two-live-secrets scenario a vendor's receiver must handle during a
 * real rotation, NOT a claim that this simulator itself rotates anything.
 */
function resolveSecretPool(rawSecrets: string[], kid: string, kidExplicit: boolean): { secret: string; kid: string } {
  const parsed = rawSecrets.map(parseSecretArg);
  const keyed = parsed.filter((entry): entry is Required<ParsedSecretArg> => entry.kid !== undefined);

  if (keyed.length === 0) {
    // Plain legacy form — last one wins if --secret was (unusually) repeated.
    return { secret: parsed[parsed.length - 1]!.value, kid };
  }
  if (keyed.length !== parsed.length) {
    throw new Error(
      '--secret: cannot mix a bare value with kid=value pairs — pass every --secret as kid=value when testing a rotation overlap.',
    );
  }

  const targetKid = kidExplicit ? kid : keyed[0]!.kid;
  const match = keyed.find((entry) => entry.kid === targetKid);
  if (!match) {
    throw new Error(
      `--secret pool has no entry for kid "${targetKid}" — pass --secret ${targetKid}=<value>, or set --kid to one of: ${keyed
        .map((entry) => entry.kid)
        .join(', ')}`,
    );
  }
  return { secret: match.value, kid: targetKid };
}

/** Parse `process.argv.slice(2)`-style args into {@link WebhookSimCliOptions}. Throws on an unknown/malformed flag. */
export function parseWebhookSimArgs(argv: string[]): WebhookSimCliOptions {
  const opts: WebhookSimCliOptions = {
    help: false,
    event: DEFAULT_EVENT,
    secret: DEFAULT_SECRET,
    kid: DEFAULT_WEBHOOK_KID,
    badSignature: false,
    staleTimestamp: false,
    duplicate: false,
  };

  const rawSecrets: string[] = [];
  let kidExplicit = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '--url':
        opts.url = nextArg(argv, i, arg);
        i++;
        break;
      case '--event':
        opts.event = nextArg(argv, i, arg);
        i++;
        break;
      case '--payload':
        opts.payloadInline = nextArg(argv, i, arg);
        i++;
        break;
      case '--payload-file':
        opts.payloadFile = nextArg(argv, i, arg);
        i++;
        break;
      case '--secret':
        rawSecrets.push(nextArg(argv, i, arg));
        i++;
        break;
      case '--kid':
        opts.kid = nextArg(argv, i, arg);
        kidExplicit = true;
        i++;
        break;
      case '--delivery-id':
        opts.deliveryId = nextArg(argv, i, arg);
        i++;
        break;
      case '--installation-id':
        opts.installationId = nextArg(argv, i, arg);
        i++;
        break;
      case '--timestamp': {
        const raw = nextArg(argv, i, arg);
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) {
          throw new Error(`--timestamp must be a unix-seconds integer, got: ${raw}`);
        }
        opts.timestampSeconds = parsed;
        i++;
        break;
      }
      case '--bad-signature':
        opts.badSignature = true;
        break;
      case '--stale-timestamp':
        opts.staleTimestamp = true;
        break;
      case '--duplicate':
        opts.duplicate = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg} (see --help)`);
    }
  }

  if (opts.payloadInline !== undefined && opts.payloadFile !== undefined) {
    throw new Error('--payload and --payload-file are mutually exclusive');
  }

  if (rawSecrets.length > 0) {
    const resolved = resolveSecretPool(rawSecrets, opts.kid, kidExplicit);
    opts.secret = resolved.secret;
    opts.kid = resolved.kid;
  }

  return opts;
}

export interface RunWebhookSimIO {
  log?: (msg: string) => void;
  error?: (msg: string) => void;
  fetchImpl?: typeof fetch;
  readFile?: (path: string) => string;
}

/**
 * Resolve the exact raw body string to sign+send from parsed CLI options.
 * `deliveryId` is required (not generated here) so a synthesized default
 * payload's `id` field is GUARANTEED to equal the `X-EOS-Webhook-Id` header
 * the caller will send it under (contract §8's worked example) — the caller
 * must compute the delivery id first and pass the same value to both this
 * function and {@link buildDeliveryHeaders}/{@link sendWebhookDelivery}. A
 * `--payload`/`--payload-file` body is sent verbatim and is NOT touched
 * here — it may or may not embed the delivery id, that's the caller's
 * choice.
 */
export function resolveRawBody(opts: WebhookSimCliOptions, deliveryId: string, io: RunWebhookSimIO = {}): string {
  if (opts.payloadInline !== undefined) {
    return opts.payloadInline;
  }
  if (opts.payloadFile !== undefined) {
    const readFile = io.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
    return readFile(opts.payloadFile);
  }
  return JSON.stringify(buildSamplePayload(opts.event, deliveryId, { installationId: opts.installationId }));
}

/**
 * Run the simulator end to end: parse args, build the delivery, send it
 * (twice, back-to-back, if `--duplicate`), and log results. Returns a
 * process exit code. Network/usage failures return 1; a completed HTTP
 * round trip returns 0 regardless of the receiver's response status — the
 * receiver's status/body is exactly what the vendor is here to inspect,
 * including on the failure-mode switches where a non-2xx IS the expected
 * (correct) outcome.
 */
export async function runWebhookSim(argv: string[], io: RunWebhookSimIO = {}): Promise<number> {
  const log = io.log ?? ((msg: string) => console.log(msg));
  const error = io.error ?? ((msg: string) => console.error(msg));

  let opts: WebhookSimCliOptions;
  try {
    opts = parseWebhookSimArgs(argv);
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    log(WEBHOOK_SIM_HELP);
    return 1;
  }

  if (opts.help) {
    log(WEBHOOK_SIM_HELP);
    return 0;
  }

  if (!opts.url) {
    error('Missing required --url\n');
    log(WEBHOOK_SIM_HELP);
    return 1;
  }

  const deliveryId = opts.deliveryId ?? randomUUID();

  let rawBody: string;
  try {
    rawBody = resolveRawBody(opts, deliveryId, io);
  } catch (err) {
    error(`Failed to resolve payload: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const baseOptions: WebhookDeliveryOptions = {
    url: opts.url,
    secret: opts.secret,
    rawBody,
    kid: opts.kid,
    deliveryId,
    ...(opts.timestampSeconds !== undefined ? { timestampSeconds: opts.timestampSeconds } : {}),
    badSignature: opts.badSignature,
    staleTimestamp: opts.staleTimestamp,
    ...(io.fetchImpl ? { fetchImpl: io.fetchImpl } : {}),
  };

  try {
    const first = await sendWebhookDelivery(baseOptions);
    log(
      `[1/${opts.duplicate ? 2 : 1}] POST ${opts.url} deliveryId=${first.deliveryId} event=${opts.event} ` +
        `ts=${first.timestampSeconds} sig=${first.signatureHeader} -> HTTP ${first.status}${first.ok ? '' : ' (rejected)'}`,
    );
    if (first.responseBody) log(`      response: ${first.responseBody}`);

    if (opts.duplicate) {
      // Resend the IDENTICAL delivery (same id/timestamp/body/signature) —
      // a genuine at-least-once redelivery, for Idempotency-Key dedupe testing.
      const second = await sendWebhookDelivery({ ...baseOptions, timestampSeconds: first.timestampSeconds });
      log(
        `[2/2] POST ${opts.url} deliveryId=${second.deliveryId} (duplicate of [1/2]) -> HTTP ${second.status}${
          second.ok ? '' : ' (rejected)'
        }`,
      );
      if (second.responseBody) log(`      response: ${second.responseBody}`);
    }

    return 0;
  } catch (err) {
    error(`Delivery failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
