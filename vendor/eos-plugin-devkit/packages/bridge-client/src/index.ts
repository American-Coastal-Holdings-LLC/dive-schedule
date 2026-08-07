/**
 * @eos/plugin-bridge — EOS bridge client (contract 02 §5).
 *
 * The framework-agnostic library a plugin's iframe imports. It completes the
 * host-initiated MessageChannel handshake and exposes the bridge JS API over
 * the pinned port. Two modes share identical embed code:
 *   - `real`: talks to a live EOS workspace host.
 *   - `stub`: standalone, no host — synthesizes the port and returns a
 *     configurable sample identity token + theme tokens (contract 02 §13).
 *
 * SECURITY INVARIANTS (contract 02 §5, PLUGIN_SECURITY_REQUIREMENTS gate D):
 *   - The only message exchanged over `window` is the host's handshake init;
 *     every inbound `window` message validates `event.origin` against the
 *     configured host origin — mismatches are silently dropped, never acted
 *     on. All messaging AFTER the handshake goes over the dedicated
 *     MessagePort transferred in that init (contract 02 §5: "All bridge
 *     messaging goes over that port"), which is inherently point-to-point —
 *     only the two endpoints that hold a reference to the port can exchange
 *     messages on it, so there is no `targetOrigin`/`event.origin` surface
 *     left to pin on that leg. If a future host variant ever needs to post
 *     directly on `window` again, pin `targetOrigin` to `hostOrigin` there too.
 *   - The identity token is delivered ONLY over the pinned port. This library
 *     never puts it in a URL, query, fragment, localStorage, or a log.
 *
 * This library performs NO token verification. Client claims shape UI only;
 * the vendor backend re-verifies server-side (see @eos/plugin-verify).
 */

// ===========================================================================
// Protocol constants
// ===========================================================================

/** Wire protocol tag stamped on every bridge envelope. Bump on a breaking wire change. */
export const BRIDGE_PROTOCOL = 'eos.bridge/1' as const;
export type BridgeProtocol = typeof BRIDGE_PROTOCOL;

/** Bridge identity token lifetime (contract 02 §5 / _DESIGN-BRIEF Token universe). */
export const BRIDGE_TOKEN_TTL_SECONDS = 300 as const; // 5 minutes

/**
 * The host's resize clamp (contract 02 §5: *"`resize` clamps; it never rejects"* —
 * height 100–4000, width 200–4000).
 *
 * ⚠️ These numbers are the HOST'S, mirrored here. The kit cannot import them: the
 * host owns them in a Next.js client hook inside a private app repo
 * (`eos-workspace-web` → `useBridgeHost.ts`), which no vendor install can resolve.
 * A mirror is the only option — so the mirror is GATED, not trusted:
 * `test/resize-clamp.test.mjs` reads the host's own constants and the frozen
 * contract and FAILS if either has moved away from this block. Change these only
 * when the host changes, and expect that test to be the thing that tells you.
 */
export const RESIZE_MIN_HEIGHT = 100 as const;
export const RESIZE_MAX_HEIGHT = 4000 as const;
export const RESIZE_MIN_WIDTH = 200 as const;
export const RESIZE_MAX_WIDTH = 4000 as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** The bridge methods a plugin may invoke on the host (contract 02 §5 "Bridge JS API"). */
export type BridgeMethod =
  | 'getIdentityToken'
  | 'getThemeTokens'
  | 'requestNavigate'
  | 'resize'
  | 'openModal'
  | 'toast'
  | 'syncUrl';

// ===========================================================================
// The message envelope — the single shape all sides (plugin, real host, stub
// host) agree on. Everything flows over the MessageChannel port after the
// handshake, EXCEPT the one handshake init which arrives on `window`.
// ===========================================================================

/**
 * Handshake init — the ONLY message received on `window` (not the port).
 * The host posts this to the iframe with the plugin-side port transferred in
 * `event.ports[0]`. The plugin validates `event.origin === hostOrigin`, keeps
 * the port, and posts {@link BridgeHandshakeAck} back over that port.
 */
export interface BridgeHandshakeInit {
  eos: BridgeProtocol;
  kind: 'handshake/init';
  /** Monotonic protocol version the host speaks; client checks compatibility. */
  protocolVersion: number;
  /** Opaque nonce echoed in the ack so the host can correlate the channel. */
  nonce: string;
}

/** Plugin → host, first message over the port, confirming the channel is live. */
export interface BridgeHandshakeAck {
  eos: BridgeProtocol;
  kind: 'handshake/ack';
  /** Echoes {@link BridgeHandshakeInit.nonce}. */
  nonce: string;
  /** Bridge-client library version, for host-side diagnostics. */
  clientVersion: string;
}

/** Plugin → host request. `id` correlates the matching {@link BridgeResponse}. */
export interface BridgeRequest<M extends BridgeMethod = BridgeMethod> {
  eos: BridgeProtocol;
  kind: 'request';
  /** Correlation id (unique per in-flight request; e.g. crypto.randomUUID()). */
  id: string;
  method: M;
  params: BridgeParamsMap[M];
}

/** Host → plugin success reply. `id` matches the originating request. */
export interface BridgeResponse<M extends BridgeMethod = BridgeMethod> {
  eos: BridgeProtocol;
  kind: 'response';
  id: string;
  ok: true;
  result: BridgeResultMap[M];
}

/** Host → plugin failure reply. `id` matches the originating request. */
export interface BridgeErrorResponse {
  eos: BridgeProtocol;
  kind: 'response';
  id: string;
  ok: false;
  error: BridgeError;
}

/** Host → plugin unsolicited event (no correlation id), e.g. a theme change. */
export interface BridgeHostEvent<T = unknown> {
  eos: BridgeProtocol;
  kind: 'event';
  event: BridgeHostEventName;
  payload: T;
}

/** Any frame that can travel over the port. */
export type BridgeEnvelope =
  | BridgeHandshakeAck
  | BridgeRequest
  | BridgeResponse
  | BridgeErrorResponse
  | BridgeHostEvent;

/** Host-initiated event names the client re-emits to `.on(...)` subscribers. */
export type BridgeHostEventName =
  | 'theme.changed'
  | 'host.resized'
  | 'modal.closed'
  | 'connection.lost';

/** Uniform error shape carried by {@link BridgeErrorResponse.error}. */
export interface BridgeError {
  code: BridgeErrorCode;
  message: string;
  /** Optional structured detail; never contains secrets or host internals. */
  data?: unknown;
}

export type BridgeErrorCode =
  | 'BAD_ORIGIN' // inbound event.origin did not match the configured host origin
  | 'NOT_CONNECTED' // call made before the handshake completed
  | 'HANDSHAKE_TIMEOUT' // host never sent the port within handshakeTimeoutMs
  | 'REQUEST_TIMEOUT' // no response for a request within requestTimeoutMs
  | 'UNKNOWN_METHOD' // host does not implement the requested method
  | 'INVALID_PARAMS' // params failed host-side validation
  | 'REJECTED' // host declined (e.g. resize beyond the allowed region)
  | 'HOST_ERROR'; // opaque host-side failure

// ===========================================================================
// Per-method params/results
// ===========================================================================

export interface BridgeParamsMap {
  getIdentityToken: void;
  getThemeTokens: void;
  requestNavigate: NavigateParams;
  resize: ResizeParams;
  openModal: ModalParams;
  toast: ToastParams;
  syncUrl: SyncUrlParams;
}

export interface BridgeResultMap {
  getIdentityToken: IdentityTokenResult;
  getThemeTokens: ThemeTokens;
  requestNavigate: void;
  resize: ResizeResult;
  openModal: ModalResult;
  toast: void;
  syncUrl: void;
}

/** Result of {@link BridgeClient.getIdentityToken}. The JWT is opaque to the client. */
export interface IdentityTokenResult {
  /** Signed 5-minute bridge JWT (typ "bridge"). Send to YOUR backend to verify. */
  token: string;
  /** Server-declared expiry (unix seconds), for client-side refresh scheduling only. */
  expiresAt: number;
}

/**
 * Theme tokens (contract 02 §5 — "native feel comes from theming tokens, not
 * shared components"). Design-token key/value maps; shape is host-owned and
 * additive, so consumers read known keys and tolerate unknown ones.
 */
export interface ThemeTokens {
  mode: 'light' | 'dark';
  colors: Record<string, string>;
  typography?: Record<string, string | number>;
  spacing?: Record<string, string | number>;
  radii?: Record<string, string | number>;
  /** Additive, host-owned extension surface. */
  [key: string]: unknown;
}

export interface NavigateParams {
  /** A host workspace path to navigate the top-level app to. Host validates. */
  path: string;
  replace?: boolean;
}

export interface ResizeParams {
  /** Desired content height in CSS px. Host clamps to its owned region. */
  height: number;
  width?: number;
}

export interface ResizeResult {
  /** The height the host actually applied after clamping. */
  appliedHeight: number;
  appliedWidth?: number;
}

export interface ModalParams {
  title?: string;
  /** Plain text body. No markup — the host renders it in host chrome. */
  body: string;
  actions?: ModalAction[];
  dismissible?: boolean;
}

export interface ModalAction {
  id: string;
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
}

export interface ModalResult {
  /** The chosen action id, or null if dismissed. */
  actionId: string | null;
}

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastParams {
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
}

export interface SyncUrlParams {
  /** Plugin-owned sub-path to reflect into the host URL (deep-linkable). */
  path?: string;
  /** Query params to reflect; undefined values are removed. */
  query?: Record<string, string | undefined>;
  replace?: boolean;
}

// ===========================================================================
// Client configuration
// ===========================================================================

export type BridgeMode = 'real' | 'stub';

export interface BridgeClientConfig {
  /**
   * The EOS workspace host origin (scheme + host + port). Outbound messages pin
   * `targetOrigin` to this; inbound messages are validated against it. Required
   * in `real` mode; in `stub` mode a synthetic value is used if omitted.
   */
  hostOrigin?: string;
  /** Defaults to `real`. Flip to `stub` to run standalone with no host. */
  mode?: BridgeMode;
  /** Max wait for the host's handshake init (ms). Default 10_000. */
  handshakeTimeoutMs?: number;
  /** Max wait for a single request's response (ms). Default 15_000. */
  requestTimeoutMs?: number;
  /** Injectable window (testing / SSR guard). Defaults to the global `window`. */
  windowRef?: Window;
  /** Stub-mode fixtures; ignored in `real` mode. */
  stub?: StubBridgeConfig;
}

/**
 * Stub-mode fixtures (contract 02 §13). The stub synthesizes the port and
 * answers every bridge method locally so the vendor's embed code is unchanged
 * between stub and real hosts.
 */
export interface StubBridgeConfig {
  /**
   * The sample identity token the stub returns. May be a literal JWT string or
   * a (possibly async) factory — e.g. wired to @eos/plugin-stub-kit's minter to
   * get a real test-key-signed bridge token. Clearly non-production.
   */
  identityToken?: string | (() => string | Promise<string>);
  /** Expiry (unix seconds) the stub reports for the identity token. */
  identityTokenExpiresAt?: number;
  /** Theme tokens the stub returns from getThemeTokens(). */
  themeTokens?: ThemeTokens;
  /** Synthetic host origin the stub pins/validates against. Default 'https://stub.host.local'. */
  hostOrigin?: string;
  /** Fixed result for openModal() (default: dismissed). */
  modalResult?: ModalResult;
  /** Observe simulated host actions (nav/resize/modal/toast/urlSync) in dev UIs. */
  onNavigate?: (params: NavigateParams) => void;
  onResize?: (params: ResizeParams) => void;
  onModal?: (params: ModalParams) => void;
  onToast?: (params: ToastParams) => void;
  onSyncUrl?: (params: SyncUrlParams) => void;
}

// ===========================================================================
// Errors
// ===========================================================================

/** Thrown by every client-side bridge call that fails (local or host-reported). */
export class BridgeClientError extends Error {
  readonly code: BridgeErrorCode;
  readonly data?: unknown;

  constructor(code: BridgeErrorCode, message: string, data?: unknown) {
    super(message);
    this.name = 'BridgeClientError';
    this.code = code;
    this.data = data;
  }
}

function toBridgeError(err: unknown): BridgeError {
  if (err instanceof BridgeClientError) {
    return { code: err.code, message: err.message, data: err.data };
  }
  return { code: 'HOST_ERROR', message: err instanceof Error ? err.message : String(err) };
}

// ===========================================================================
// Envelope helpers
// ===========================================================================

/** Type guard: is `value` a well-formed bridge envelope (has the protocol tag)?
 * Matches everything that travels over the PORT (request/response/event) —
 * the window-level handshake init is a separate frame, checked by
 * {@link isHandshakeInit} below, since it is deliberately excluded from
 * {@link BridgeEnvelope} (see that type's doc comment). */
export function isBridgeEnvelope(value: unknown): value is BridgeEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { eos?: unknown }).eos === BRIDGE_PROTOCOL &&
    typeof (value as { kind?: unknown }).kind === 'string' &&
    (value as { kind?: unknown }).kind !== 'handshake/init'
  );
}

/** Type guard for the one `window`-level frame: the host's handshake init. */
function isHandshakeInit(value: unknown): value is BridgeHandshakeInit {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { eos?: unknown }).eos === BRIDGE_PROTOCOL &&
    (value as { kind?: unknown }).kind === 'handshake/init'
  );
}

/**
 * Bridge-client library version, echoed in the handshake ack for host-side
 * diagnostics. Kept in sync with package.json's `version` by hand (this
 * package has no build-time way to read its own package.json under the
 * NodeNext + browser-target setup, so this is the single source to bump).
 */
export const BRIDGE_CLIENT_VERSION = '0.1.0';

/** Correlation-id generator. Not security-relevant — only used to match a
 * response to its request over an already-authenticated, point-to-point
 * MessagePort — so a non-cryptographic fallback is acceptable when no CSPRNG
 * is available. */
function generateId(): string {
  const g = globalThis as { crypto?: Crypto };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  if (g.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    g.crypto.getRandomValues(bytes);
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

// ===========================================================================
// Stub-mode host responder (contract 02 §13)
// ===========================================================================

/** Obviously-fake default so an unconfigured stub still round-trips a
 * 3-segment JWT-shaped string instead of throwing. Wire `stub.identityToken`
 * to `@eos/plugin-stub-kit`'s `mintBridgeToken()` for a token your backend's
 * `verify()` can actually validate. */
const DEFAULT_STUB_IDENTITY_TOKEN = 'stub-header.stub-payload.stub-signature';

const DEFAULT_STUB_THEME: ThemeTokens = {
  mode: 'light',
  colors: {
    background: '#ffffff',
    foreground: '#111111',
    primary: '#2563eb',
    border: '#e5e7eb',
  },
};

/** Answers every {@link BridgeMethod} locally from a {@link StubBridgeConfig},
 * with no host on the other end (contract 02 §13). */
class StubHostResponder {
  readonly #config: StubBridgeConfig;
  #warnedDefaultToken = false;

  constructor(config: StubBridgeConfig) {
    this.#config = config;
  }

  async handle<M extends BridgeMethod>(method: M, params: BridgeParamsMap[M]): Promise<BridgeResultMap[M]> {
    switch (method) {
      case 'getIdentityToken': {
        const factory = this.#config.identityToken;
        let token: string;
        if (typeof factory === 'function') {
          token = await factory();
        } else if (factory) {
          token = factory;
        } else {
          if (!this.#warnedDefaultToken) {
            this.#warnedDefaultToken = true;
            console.warn(
              '[@eos/plugin-bridge stub] No stub.identityToken configured — returning a placeholder ' +
                'that will NOT pass server-side verification. Wire it to @eos/plugin-stub-kit\'s ' +
                'mintBridgeToken() to exercise your real verify() path.',
            );
          }
          token = DEFAULT_STUB_IDENTITY_TOKEN;
        }
        const expiresAt =
          this.#config.identityTokenExpiresAt ?? Math.floor(Date.now() / 1000) + BRIDGE_TOKEN_TTL_SECONDS;
        const result: IdentityTokenResult = { token, expiresAt };
        return result as BridgeResultMap[M];
      }
      case 'getThemeTokens': {
        const result: ThemeTokens = this.#config.themeTokens ?? DEFAULT_STUB_THEME;
        return result as BridgeResultMap[M];
      }
      case 'requestNavigate': {
        this.#config.onNavigate?.(params as NavigateParams);
        return undefined as BridgeResultMap[M];
      }
      case 'resize': {
        // Mirrors the real host's resize handler exactly (validate → clamp →
        // omit `appliedWidth` when no width was asked for). Before this, the
        // stub echoed the request back as "applied", so a vendor asserting
        // `appliedHeight === 5000` went GREEN here and got 4000 in production.
        // The contract's standing instruction — "always read appliedHeight
        // rather than assuming you got what you asked for" — was unfalsifiable
        // against the stub, which is what made the kit teach the wrong reflex.
        const p = params as ResizeParams;
        if (p === null || typeof p !== 'object') {
          throw new BridgeClientError('INVALID_PARAMS', 'resize requires a params object.');
        }
        if (typeof p.height !== 'number' || !Number.isFinite(p.height)) {
          throw new BridgeClientError('INVALID_PARAMS', 'resize requires a finite numeric "height".');
        }
        if (p.width !== undefined && (typeof p.width !== 'number' || !Number.isFinite(p.width))) {
          throw new BridgeClientError('INVALID_PARAMS', '"width" must be a finite number when provided.');
        }
        // Observation hook still sees the REQUEST, as `onNavigate` does — the
        // clamp shows up in the returned result, which is what vendors read.
        this.#config.onResize?.(p);
        const appliedHeight = clamp(p.height, RESIZE_MIN_HEIGHT, RESIZE_MAX_HEIGHT);
        const appliedWidth = p.width === undefined ? undefined : clamp(p.width, RESIZE_MIN_WIDTH, RESIZE_MAX_WIDTH);
        const result: ResizeResult =
          appliedWidth === undefined ? { appliedHeight } : { appliedHeight, appliedWidth };
        return result as BridgeResultMap[M];
      }
      case 'openModal': {
        this.#config.onModal?.(params as ModalParams);
        const result: ModalResult = this.#config.modalResult ?? { actionId: null };
        return result as BridgeResultMap[M];
      }
      case 'toast': {
        this.#config.onToast?.(params as ToastParams);
        return undefined as BridgeResultMap[M];
      }
      case 'syncUrl': {
        this.#config.onSyncUrl?.(params as SyncUrlParams);
        return undefined as BridgeResultMap[M];
      }
      default: {
        throw new BridgeClientError('UNKNOWN_METHOD', `Stub host does not implement "${String(method)}".`);
      }
    }
  }
}

// ===========================================================================
// Public client
// ===========================================================================

export type BridgeEventHandler<T = unknown> = (payload: T) => void;
export type Unsubscribe = () => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/** Minimal shape this client needs from `window` — real DOM `Window` satisfies
 * it, and tests can inject any `EventTarget`-like object via `windowRef`. */
export interface BridgeWindowLike {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

/**
 * The bridge client. Construct with config, `await connect()` to complete the
 * handshake, then call the bridge JS API. Same surface in real and stub modes.
 */
export class BridgeClient {
  readonly #config: BridgeClientConfig;
  readonly #mode: BridgeMode;
  readonly #handshakeTimeoutMs: number;
  readonly #requestTimeoutMs: number;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #eventHandlers = new Map<BridgeHostEventName, Set<BridgeEventHandler>>();

  #port: MessagePort | undefined;
  /** Stub mode's internal "host-side" port (the channel's other half). Only
   * ever set in stub mode; closed alongside `#port` in {@link disconnect} so
   * a stub client doesn't leak an open MessageChannel (which otherwise keeps
   * the process/event loop alive — Node and browsers both treat a live
   * MessagePort as a reason not to exit). */
  #stubHostPort: MessagePort | undefined;
  #connected = false;
  #connecting: Promise<void> | undefined;
  #cleanupHandshakeListener: (() => void) | undefined;

  constructor(config: BridgeClientConfig) {
    this.#config = config;
    this.#mode = config.mode ?? 'real';
    this.#handshakeTimeoutMs = config.handshakeTimeoutMs ?? 10_000;
    this.#requestTimeoutMs = config.requestTimeoutMs ?? 15_000;
  }

  get mode(): BridgeMode {
    return this.#mode;
  }

  isConnected(): boolean {
    return this.#connected;
  }

  connect(): Promise<void> {
    if (this.#connecting) return this.#connecting;
    this.#connecting = this.#mode === 'stub' ? this.#connectStub() : this.#connectReal();
    return this.#connecting;
  }

  async #connectStub(): Promise<void> {
    const stub = this.#config.stub ?? {};
    const responder = new StubHostResponder(stub);
    const channel = new MessageChannel();

    // The stub plays "host" on port1: it answers requests exactly like a real
    // host would, over the exact same envelope, so the client's request/
    // response machinery below is identical in real and stub modes.
    channel.port1.onmessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (!isBridgeEnvelope(data) || data.kind !== 'request') return;
      responder.handle(data.method, data.params).then(
        (result) => {
          const response: BridgeResponse = { eos: BRIDGE_PROTOCOL, kind: 'response', id: data.id, ok: true, result };
          channel.port1.postMessage(response);
        },
        (err: unknown) => {
          const response: BridgeErrorResponse = {
            eos: BRIDGE_PROTOCOL,
            kind: 'response',
            id: data.id,
            ok: false,
            error: toBridgeError(err),
          };
          channel.port1.postMessage(response);
        },
      );
    };

    this.#stubHostPort = channel.port1;
    this.#bindPort(channel.port2);
    this.#connected = true;
  }

  #connectReal(): Promise<void> {
    return new Promise((resolve, reject) => {
      const configWin = this.#config.windowRef as BridgeWindowLike | undefined;
      const win: BridgeWindowLike | undefined =
        configWin ?? (typeof window !== 'undefined' ? (window as unknown as BridgeWindowLike) : undefined);
      if (!win) {
        reject(new BridgeClientError('NOT_CONNECTED', 'real mode requires a window (pass windowRef, or run in a browser/iframe).'));
        return;
      }
      const hostOrigin = this.#config.hostOrigin;
      if (!hostOrigin) {
        reject(new BridgeClientError('NOT_CONNECTED', 'real mode requires config.hostOrigin.'));
        return;
      }

      const timeout = setTimeout(() => {
        win.removeEventListener('message', onMessage);
        reject(
          new BridgeClientError(
            'HANDSHAKE_TIMEOUT',
            `No handshake/init received from ${hostOrigin} within ${this.#handshakeTimeoutMs}ms.`,
          ),
        );
      }, this.#handshakeTimeoutMs);

      const onMessage = (event: MessageEvent): void => {
        // Both directions, both sides (contract 02 §5): drop anything not
        // from the exact configured host origin, no matter how well-formed.
        if (event.origin !== hostOrigin) return;
        const data: unknown = event.data;
        if (!isHandshakeInit(data)) return;
        const port = event.ports?.[0];
        if (!port) return;

        clearTimeout(timeout);
        win.removeEventListener('message', onMessage);
        this.#cleanupHandshakeListener = undefined;

        this.#bindPort(port);

        const ack: BridgeHandshakeAck = {
          eos: BRIDGE_PROTOCOL,
          kind: 'handshake/ack',
          nonce: data.nonce,
          clientVersion: BRIDGE_CLIENT_VERSION,
        };
        port.postMessage(ack);

        this.#connected = true;
        resolve();
      };

      win.addEventListener('message', onMessage);
      this.#cleanupHandshakeListener = () => win.removeEventListener('message', onMessage);
    });
  }

  #bindPort(port: MessagePort): void {
    this.#port = port;
    port.onmessage = (event: MessageEvent) => this.#handlePortMessage(event.data);
  }

  #handlePortMessage(data: unknown): void {
    if (!isBridgeEnvelope(data)) return;
    if (data.kind === 'response') {
      const pending = this.#pending.get(data.id);
      if (!pending) return; // stale/unknown correlation id — drop
      this.#pending.delete(data.id);
      clearTimeout(pending.timeout);
      if (data.ok) {
        pending.resolve(data.result);
      } else {
        pending.reject(new BridgeClientError(data.error.code, data.error.message, data.error.data));
      }
    } else if (data.kind === 'event') {
      const handlers = this.#eventHandlers.get(data.event);
      if (!handlers) return;
      for (const handler of handlers) handler(data.payload);
    }
  }

  #request<M extends BridgeMethod>(method: M, params: BridgeParamsMap[M]): Promise<BridgeResultMap[M]> {
    if (!this.#connected || !this.#port) {
      return Promise.reject(new BridgeClientError('NOT_CONNECTED', `Cannot call ${method}() before connect() resolves.`));
    }
    const port = this.#port;
    const id = generateId();
    return new Promise<BridgeResultMap[M]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new BridgeClientError('REQUEST_TIMEOUT', `${method}() timed out after ${this.#requestTimeoutMs}ms.`));
      }, this.#requestTimeoutMs);

      this.#pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      const request: BridgeRequest<M> = { eos: BRIDGE_PROTOCOL, kind: 'request', id, method, params };
      port.postMessage(request);
    });
  }

  getIdentityToken(): Promise<IdentityTokenResult> {
    return this.#request('getIdentityToken', undefined);
  }

  getThemeTokens(): Promise<ThemeTokens> {
    return this.#request('getThemeTokens', undefined);
  }

  requestNavigate(params: NavigateParams): Promise<void> {
    return this.#request('requestNavigate', params);
  }

  resize(params: ResizeParams): Promise<ResizeResult> {
    return this.#request('resize', params);
  }

  openModal(params: ModalParams): Promise<ModalResult> {
    return this.#request('openModal', params);
  }

  toast(params: ToastParams): Promise<void> {
    return this.#request('toast', params);
  }

  syncUrl(params: SyncUrlParams): Promise<void> {
    return this.#request('syncUrl', params);
  }

  on<T = unknown>(event: BridgeHostEventName, handler: BridgeEventHandler<T>): Unsubscribe {
    let handlers = this.#eventHandlers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.#eventHandlers.set(event, handlers);
    }
    handlers.add(handler as BridgeEventHandler);
    return () => {
      handlers?.delete(handler as BridgeEventHandler);
    };
  }

  disconnect(): void {
    this.#cleanupHandshakeListener?.();
    this.#cleanupHandshakeListener = undefined;

    if (this.#port) {
      this.#port.onmessage = null;
      this.#port.close();
      this.#port = undefined;
    }
    if (this.#stubHostPort) {
      this.#stubHostPort.onmessage = null;
      this.#stubHostPort.close();
      this.#stubHostPort = undefined;
    }

    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new BridgeClientError('NOT_CONNECTED', 'disconnect() was called.'));
    }
    this.#pending.clear();
    this.#eventHandlers.clear();
    this.#connected = false;
    this.#connecting = undefined;
  }
}

/** Convenience factory: `const bridge = await createBridgeClient(cfg)` (connects for you). */
export async function createBridgeClient(config: BridgeClientConfig): Promise<BridgeClient> {
  const client = new BridgeClient(config);
  await client.connect();
  return client;
}
