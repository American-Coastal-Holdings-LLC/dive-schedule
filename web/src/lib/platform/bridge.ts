// The platform bridge — the ONLY seam between this app and its host.
//
// WHY THIS WAS REWRITTEN. The first version spoke a homegrown protocol
// (`dive-bridge:<verb>` envelopes over window.postMessage) invented alongside the dev harness that
// answered it. Both sides agreed perfectly, every local test passed, and it was incompatible with
// the actual platform: EOS speaks `eos.bridge/1`, whose handshake transfers a MessagePort via a
// `handshake/init` on window and expects a `handshake/ack` back over that port. The host waited for
// an ack this app had no code to send, timed out three times, and the embed rendered
// "Could not reach the platform" — which named the wrong subsystem entirely.
//
// The lesson is in the failure mode, not the protocol: a self-authored harness can only ever prove
// the app agrees with itself. This now uses the platform's own client, so the wire format is
// theirs, not ours.
//
// WHAT DID NOT CHANGE: the PlatformBridge interface below. api.ts and PlatformProvider are
// untouched — the seam was the right shape, only the transport behind it was wrong.
//
// MODES. Framed → `real`, pinned to the workspace origin. Unframed (the /harness page, a bare
// localhost tab) → the official client's own `stub` mode, which synthesizes the port and answers
// every method locally. We no longer maintain a second implementation for dev; running the same
// client both ways is the point.

import { BridgeClient, type ThemeTokens } from '@eos/plugin-bridge';
import { buildDevToken, DEFAULT_DEV_USER_KEY, findDevUser } from './dev-users';

export interface PlatformBridge {
  getIdentityToken(): Promise<string>;
  getTheme(): Promise<Record<string, string>>;
  toast(message: string): void;
  requestResize(heightPx: number): void;
}

// Theme subscribers are module-scoped so subscribeTheme works regardless of which mode is active.
type ThemeListener = (vars: Record<string, string>) => void;
const themeListeners = new Set<ThemeListener>();

/**
 * The EOS host origins that may embed this app, as a space-separated allowlist.
 *
 * A LIST, not a value, because a plugin has more than one door: the platform workspace
 * (workspace.<pilot>.sslip.io) and its own branded door (diveschedule.<pilot>.sslip.io) are different
 * ORIGINS serving the same shell. Pinning one broke the other — the browser refused every postMessage
 * as an origin mismatch and the host reported "couldn't finish connecting", naming nothing useful.
 *
 * MUST be a build arg: NEXT_PUBLIC_* is inlined at build time, so a runtime value silently ships the
 * default. Keep it in step with CSP_FRAME_ANCESTORS on the API — same origins, two places, and a
 * disagreement blocks the frame outright rather than degrading.
 */
function allowedHostOrigins(): string[] {
  return (process.env.NEXT_PUBLIC_PLATFORM_ORIGIN || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((o) => o.replace(/\/$/, ''));
}

/**
 * Which of the allowed origins is actually hosting us right now.
 *
 * Resolved rather than configured, because the client needs ONE targetOrigin and only the embedder
 * knows which door the user came through. Two sources, in order of trustworthiness:
 *   1. A buffered handshake's own event.origin — the host has already spoken, so this is fact.
 *   2. document.referrer — the embedding page, available before the host says anything.
 * Both are validated against the allowlist, so a hostile framer cannot nominate itself; an
 * unrecognised embedder falls back to the first configured origin, which then fails closed at the
 * client's own origin check rather than silently trusting whoever framed us.
 */
function hostOrigin(): string {
  const allowed = allowedHostOrigins();
  if (typeof window === 'undefined') return allowed[0] ?? '';

  const buffered = window.__eosPendingBridgeHandshakes ?? [];
  for (const pending of buffered) {
    if (allowed.includes(pending.origin)) return pending.origin;
  }

  try {
    if (document.referrer) {
      const ref = new URL(document.referrer).origin;
      if (allowed.includes(ref)) return ref;
    }
  } catch {
    /* a malformed referrer is not worth failing over */
  }

  return allowed[0] ?? window.location.origin;
}

/** True when running inside a host frame. Decides real vs stub. */
export function isFramed(): boolean {
  try {
    return typeof window !== 'undefined' && window.parent !== window;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Host theme -> our CSS custom properties.
//
// EOS does not send CSS variable names. It sends a SEMANTIC token object and the names it uses are
// not the names our stylesheet uses. Without this mapping a pushed theme lands on properties no
// rule reads, so the app silently keeps its own palette — a host in dark mode would render our
// light surfaces inside its dark chrome.
//
// Only keys that actually arrived are emitted; everything unmapped is derived by globals.css from
// these inputs, so a handful of colours re-themes the whole app.
// ---------------------------------------------------------------------------
interface HostTheme {
  mode?: string;
  colors?: Record<string, string>;
  vars?: Record<string, string>;
}

export function themeToCss(theme: HostTheme | null | undefined): Record<string, string> {
  if (!theme) return {};
  const colors = theme.colors ?? {};
  const out: Record<string, string> = {};
  const put = (name: string, value: string | undefined): void => {
    if (typeof value === 'string' && value.trim()) out[name] = value;
  };

  put('--bg', colors.background);
  put('--surface', colors.surface);
  put('--text', colors.foreground);
  put('--muted', colors.muted);
  put('--border', colors.border);
  put('--primary', colors.primary);
  put('--primary-contrast', colors.primaryContrast);
  put('--accent', colors.accent);
  put('--danger', colors.danger);
  put('--ok', colors.success ?? colors.ok);
  put('--warn', colors.warning ?? colors.warn);

  // The token shape is additive: pass through explicit custom properties from either container
  // while tolerating semantic colours we do not yet consume.
  for (const [key, value] of Object.entries(colors)) {
    if (key.startsWith('--') && typeof value === 'string') out[key] = value;
  }
  for (const [key, value] of Object.entries(theme.vars ?? {})) {
    if (typeof value === 'string') out[key.startsWith('--') ? key : `--${key}`] = value;
  }

  // Mode is a hook, not a colour: globals.css keys :root[data-eos-mode='dark'] off it so the host
  // can be dark while the OS is light. PlatformProvider sets the attribute.
  if (theme.mode === 'dark' || theme.mode === 'light') out['--eos-mode'] = theme.mode;
  return out;
}

// ---------------------------------------------------------------------------
// Replay of the parse-time handshake buffer.
//
// layout.tsx catches `handshake/init` from HTML-parse time because the host's MessagePort is
// TRANSFERRED and arrives once — possibly before this module exists. The official client does not
// know about that buffer, so nothing consumes it unless we replay it here.
//
// ⛔ ORDER IS LOAD-BEARING — snapshot, tear down, THEN replay.
// The catcher listens on `window`, and the replay below dispatches ON `window` with the buffered
// event's own origin/data/port, which satisfies every check the catcher makes. A catcher still
// armed during replay therefore re-buffers its own replay into the array being iterated: the loop
// never terminates and allocates a MessageEvent per turn until the browser kills the frame. It
// only bites when the host's handshake beats this module's startup — presenting as "refresh a few
// times and it eventually loads" — and no boot deadline can catch it, because this runs
// synchronously before any timer exists.
// ---------------------------------------------------------------------------
interface BufferedHandshake {
  data: unknown;
  origin: string;
  source: MessageEventSource | null;
  port: MessagePort;
}

declare global {
  interface Window {
    __eosPendingBridgeHandshakes?: BufferedHandshake[];
    __eosBridgeBufferTeardown?: () => void;
  }
}

function replayBufferedHandshakes(): void {
  if (typeof window === 'undefined') return;
  const buffered = window.__eosPendingBridgeHandshakes ?? [];
  window.__eosBridgeBufferTeardown?.();

  // Re-enter every buffered init through the client's ordinary listener so exact-origin and
  // envelope checks stay single-sourced there. Replaying ALL of them means a hostile fake can never
  // have evicted the genuine one — the client drops the ones that fail its checks.
  for (const pending of buffered) {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: pending.data,
        origin: pending.origin,
        source: pending.source,
        ports: [pending.port],
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// The client. One instance, created lazily, shared.
// ---------------------------------------------------------------------------
let clientPromise: Promise<BridgeClient> | undefined;

function client(): Promise<BridgeClient> {
  if (!clientPromise) {
    const framed = isFramed();
    const c = new BridgeClient({
      mode: framed ? 'real' : 'stub',
      hostOrigin: hostOrigin(),
      // Stub fixtures mirror the dev users the API's dev-stub provider accepts, so an unframed run
      // is a working app rather than an empty shell.
      stub: framed
        ? undefined
        : {
            identityToken: buildDevToken(findDevUser(DEFAULT_DEV_USER_KEY)),
          },
    });

    // connect() attaches its window listener SYNCHRONOUSLY, then waits. So start it, replay the
    // buffered init into that listener, and only then await — replaying before connect() would hit
    // no listener, and awaiting first would deadlock when the init already arrived and will never
    // be sent again.
    const connected = c.connect();
    replayBufferedHandshakes();

    clientPromise = connected.then(() => {
      // A pushed theme re-themes the app live (a host toggling dark mode mid-session).
      c.on('theme.changed', (tokens) => {
        const vars = themeToCss(tokens as HostTheme);
        themeListeners.forEach((cb) => {
          try {
            cb(vars);
          } catch {
            /* one bad listener must not break the bridge */
          }
        });
      });
      return c;
    });

    // A failed connect must not be cached as a permanently rejected promise — the host may simply
    // have been slow. Clear it so the next call retries.
    clientPromise.catch(() => {
      clientPromise = undefined;
    });
  }
  return clientPromise;
}

const bridge: PlatformBridge = {
  async getIdentityToken(): Promise<string> {
    const c = await client();
    const { token } = await c.getIdentityToken();
    if (!token) throw new Error('Platform bridge returned no identity token.');
    return token;
  },

  async getTheme(): Promise<Record<string, string>> {
    // Theme is non-fatal: a failure falls back to the stylesheet defaults rather than blocking the
    // app, which is a cosmetic degradation instead of a blank screen.
    try {
      const c = await client();
      const tokens: ThemeTokens = await c.getThemeTokens();
      return themeToCss(tokens as HostTheme);
    } catch {
      return {};
    }
  },

  toast(message: string): void {
    if (!message) return;
    void client()
      .then((c) => c.toast({ message }))
      .catch(() => {
        /* best-effort; the in-app toast still renders */
      });
  },

  requestResize(heightPx: number): void {
    void client()
      .then((c) => c.resize({ height: Math.max(0, Math.round(heightPx)) }))
      .catch(() => {
        /* the host clamps and may refuse; never fatal */
      });
  },
};

export function getBridge(): PlatformBridge {
  return bridge;
}

/** Subscribe to live theme pushes from the host. Returns an unsubscribe fn. */
export function subscribeTheme(cb: ThemeListener): () => void {
  themeListeners.add(cb);
  return () => themeListeners.delete(cb);
}
