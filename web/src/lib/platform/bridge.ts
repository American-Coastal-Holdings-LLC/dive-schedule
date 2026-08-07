// The platform bridge — the single seam between this app and its host. Feature code imports only
// the PlatformBridge interface; the concrete implementation is chosen at runtime.
//
//   - IframeBridge      : real host path. Talks to the parent window via postMessage using the
//                         envelope { type: "dive-bridge:<verb>", requestId?, ...payload }.
//                         Child->parent verbs: ready, request-token, request-theme, toast, resize.
//                         Parent->child replies: token, theme (theme may also be pushed unsolicited
//                         so a live host theme toggle re-themes the app). 5s timeout -> rejection.
//   - StandaloneDevBridge : DEV fallback when the app is NOT framed. Mints a devtoken for the user
//                           in ?devUser= / localStorage (default dana); theme = stylesheet defaults.
//
// No frame-busting, no window.top access, no cookies, no service worker. Identity tokens live in
// memory only (never persisted); only the dev-user *key* may sit in localStorage for the dev bridge.

import { buildDevToken, DEFAULT_DEV_USER_KEY, findDevUser } from './dev-users';

export interface PlatformBridge {
  getIdentityToken(): Promise<string>;
  getTheme(): Promise<Record<string, string>>;
  toast(message: string): void;
  requestResize(heightPx: number): void;
}

const ENVELOPE_PREFIX = 'dive-bridge:';
const REQUEST_TIMEOUT_MS = 5000;
const DEV_USER_STORAGE_KEY = 'dive.devUser';

// Theme subscribers are module-scoped so subscribeTheme works uniformly regardless of which bridge
// is active; only IframeBridge ever notifies them (on a pushed theme map).
type ThemeListener = (vars: Record<string, string>) => void;
const themeListeners = new Set<ThemeListener>();

// Host theme -> our CSS custom properties.
//
// EOS does not send CSS variable names. It sends a SEMANTIC token object —
// `{ mode, colors: { background, foreground, primary, border, ... } }` — and the names it uses are
// not the names our stylesheet uses. Without this mapping a pushed theme lands on properties no
// rule reads (`--background`, `--foreground`), so the app silently keeps its own palette: a host
// in dark mode would render our light surfaces inside its dark chrome.
//
// Only the keys that actually arrived are emitted. Everything we do NOT map is derived from these
// inputs by globals.css (see its CONTRACT header), so four colours are enough to re-theme the app.
//
// Both shapes are accepted: the semantic object above, and a plain `--foo` map. The plain map is
// what /harness sends and is also the escape hatch for a host that wants to set a token we have
// not given a semantic name to.
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

  // The token shape is additive: pass through any explicit custom property the host sets, from
  // either container, while tolerating semantic colours we do not yet consume.
  for (const [key, value] of Object.entries(colors)) {
    if (key.startsWith('--') && typeof value === 'string') out[key] = value;
  }
  for (const [key, value] of Object.entries(theme.vars ?? {})) {
    if (typeof value === 'string') out[key.startsWith('--') ? key : `--${key}`] = value;
  }

  // Mode is a hook, not a colour: globals.css keys `:root[data-eos-mode='dark']` off it so the
  // host can be dark while the OS is light. PlatformProvider sets the attribute.
  if (theme.mode === 'dark' || theme.mode === 'light') out['--eos-mode'] = theme.mode;
  return out;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  replyType: string;
}

// The expected platform (host) origin for postMessage. The 5-minute identity token crosses this
// channel, so it must be pinned: post ONLY to this origin (never '*') and accept messages ONLY from
// it. Set NEXT_PUBLIC_PLATFORM_ORIGIN to the EOS workspace origin in production; in the same-origin
// dev harness it falls back to this app's own origin. (The real EOS bridge SDK will replace this
// hand-rolled channel with a MessageChannel port; until then this closes the token-exfiltration gap.)
function platformOrigin(): string {
  const configured = (process.env.NEXT_PUBLIC_PLATFORM_ORIGIN || '').trim();
  if (configured) {
    // Normalize so a trailing slash or case difference in the configured value doesn't silently break
    // the pin — the browser's event.origin is always a bare, normalized origin.
    try {
      return new URL(configured).origin;
    } catch {
      /* misconfigured value: fall through to same-origin rather than pin to a bad string */
    }
  }
  return typeof window !== 'undefined' ? window.location.origin : '';
}

class IframeBridge implements PlatformBridge {
  private pending = new Map<string, Pending>();
  private seq = 0;
  private readonly hostOrigin = platformOrigin();

  constructor() {
    if (!process.env.NEXT_PUBLIC_PLATFORM_ORIGIN) {
      // Framed but no explicit host origin configured: we pin to our own origin. Correct for the
      // same-origin dev harness; for a cross-origin host this must be set (at build time) or the
      // handshake silently times out instead of leaking anywhere.
      console.warn(
        `[bridge] NEXT_PUBLIC_PLATFORM_ORIGIN not set — pinning postMessage to ${this.hostOrigin}. ` +
          'Set it at build time to the EOS host origin for a cross-origin embed.',
      );
    }
    window.addEventListener('message', this.onMessage);
    this.post('ready', {});
  }

  private onMessage = (event: MessageEvent) => {
    // Only trust messages from the pinned host origin — a foreign frame must not inject a token/theme.
    if (event.origin !== this.hostOrigin) return;
    const data = event.data;
    if (!data || typeof data.type !== 'string' || !data.type.startsWith(ENVELOPE_PREFIX)) return;
    const verb = data.type.slice(ENVELOPE_PREFIX.length);

    // Resolve a pending request if this message carries its requestId.
    if (data.requestId && this.pending.has(data.requestId)) {
      const p = this.pending.get(data.requestId)!;
      if (verb === p.replyType) {
        clearTimeout(p.timer);
        this.pending.delete(data.requestId);
        p.resolve(data);
        return;
      }
    }

    // A pushed theme (no/unknown requestId) re-themes the app live.
    if (verb === 'theme') {
      const vars = themeToCss(data as HostTheme);
      themeListeners.forEach((cb) => {
        try {
          cb(vars);
        } catch {
          /* listener errors must not break the bridge */
        }
      });
    }
  };

  private post(verb: string, payload: Record<string, unknown>) {
    try {
      // Pin targetOrigin so the identity token is never broadcast to an unexpected parent frame.
      window.parent.postMessage({ type: ENVELOPE_PREFIX + verb, ...payload }, this.hostOrigin);
    } catch {
      /* posting to the parent can throw in exotic sandboxes; treated as no-op */
    }
  }

  private request<T>(verb: string, replyType: string, payload: Record<string, unknown> = {}): Promise<T> {
    const requestId = `${Date.now().toString(36)}-${(this.seq++).toString(36)}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Platform bridge timed out waiting for "${replyType}".`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        replyType,
      });
      this.post(verb, { requestId, ...payload });
    });
  }

  async getIdentityToken(): Promise<string> {
    const reply = await this.request<{ token?: string }>('request-token', 'token');
    if (!reply.token) throw new Error('Platform bridge returned no identity token.');
    return reply.token;
  }

  async getTheme(): Promise<Record<string, string>> {
    // Theme is non-fatal: a timeout falls back to stylesheet defaults rather than blocking the app.
    try {
      const reply = await this.request<HostTheme>('request-theme', 'theme');
      return themeToCss(reply);
    } catch {
      return {};
    }
  }

  toast(message: string): void {
    this.post('toast', { message });
  }

  requestResize(heightPx: number): void {
    this.post('resize', { height: Math.max(0, Math.round(heightPx)) });
  }
}

class StandaloneDevBridge implements PlatformBridge {
  private currentUserKey(): string {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromQuery = params.get('devUser');
      if (fromQuery) {
        try {
          window.localStorage.setItem(DEV_USER_STORAGE_KEY, fromQuery);
        } catch {
          /* storage may be unavailable */
        }
        return fromQuery;
      }
      const stored = window.localStorage.getItem(DEV_USER_STORAGE_KEY);
      if (stored) return stored;
    } catch {
      /* ignore */
    }
    return DEFAULT_DEV_USER_KEY;
  }

  async getIdentityToken(): Promise<string> {
    return buildDevToken(findDevUser(this.currentUserKey()));
  }

  async getTheme(): Promise<Record<string, string>> {
    return {}; // stylesheet defaults (prefers-color-scheme)
  }

  toast(message: string): void {
    // Un-framed dev: surfaced by the in-app toast host; log for visibility.
    if (typeof console !== 'undefined') console.info('[toast]', message);
  }

  requestResize(): void {
    /* no host to resize when un-framed */
  }
}

let cached: PlatformBridge | null = null;

export function getBridge(): PlatformBridge {
  if (cached) return cached;
  if (typeof window === 'undefined') {
    // Should never be exercised during SSR (all data fetching is client-side), but fail loudly.
    return {
      getIdentityToken: () => Promise.reject(new Error('Bridge unavailable during server render.')),
      getTheme: () => Promise.resolve({}),
      toast: () => {},
      requestResize: () => {},
    };
  }
  cached = window.parent !== window ? new IframeBridge() : new StandaloneDevBridge();
  return cached;
}

// Subscribe to live theme pushes from the host (IframeBridge only). Returns an unsubscribe fn.
export function subscribeTheme(cb: ThemeListener): () => void {
  themeListeners.add(cb);
  return () => themeListeners.delete(cb);
}

// True when running inside a host frame (affects whether live theme pushes are possible).
export function isFramed(): boolean {
  return typeof window !== 'undefined' && window.parent !== window;
}
