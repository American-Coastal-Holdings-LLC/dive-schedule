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

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  replyType: string;
}

class IframeBridge implements PlatformBridge {
  private pending = new Map<string, Pending>();
  private seq = 0;

  constructor() {
    window.addEventListener('message', this.onMessage);
    this.post('ready', {});
  }

  private onMessage = (event: MessageEvent) => {
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
      const vars = (data.vars as Record<string, string>) || {};
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
      window.parent.postMessage({ type: ENVELOPE_PREFIX + verb, ...payload }, '*');
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
      const reply = await this.request<{ vars?: Record<string, string> }>('request-theme', 'theme');
      return reply.vars || {};
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
