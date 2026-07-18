// Fetch wrapper for the same-origin API (Next rewrites /api/* -> NestJS). Every request carries a
// fresh bearer token from the platform bridge. On 401 it retries exactly once with a new token
// (covers a token that expired mid-session). API errors ({ error: { code, message } }) are surfaced
// as a toast and thrown as ApiError so callers can also react.

import { getBridge } from './platform/bridge';

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// The toast sink is injected by PlatformProvider so the client can render errors without importing
// React state here. Defaults to a no-op until wired.
let toastSink: (message: string) => void = () => {};
export function setToastSink(fn: (message: string) => void): void {
  toastSink = fn;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  // internal: marks the single post-401 retry so we never loop
  _retried?: boolean;
  // suppress the automatic error toast (caller handles messaging)
  quiet?: boolean;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getBridge().getIdentityToken();
  return {
    Authorization: `Bearer ${token}`,
  };
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...(await authHeaders()) };
  const hasBody = opts.body !== undefined;
  if (hasBody) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  });

  // Single retry on 401 with a freshly-minted token.
  if (res.status === 401 && !opts._retried) {
    return request<T>(path, { ...opts, _retried: true });
  }

  if (!res.ok) {
    let code = 'error';
    let message = `Request failed (${res.status}).`;
    try {
      const j = await res.json();
      if (j?.error) {
        code = j.error.code || code;
        message = j.error.message || message;
      }
    } catch {
      /* non-JSON error body */
    }
    if (!opts.quiet) toastSink(message);
    throw new ApiError(res.status, code, message);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string, opts?: { quiet?: boolean }) => request<T>(path, { method: 'GET', ...opts }),
  post: <T>(path: string, body?: unknown, opts?: { quiet?: boolean }) =>
    request<T>(path, { method: 'POST', body, ...opts }),
  patch: <T>(path: string, body?: unknown, opts?: { quiet?: boolean }) =>
    request<T>(path, { method: 'PATCH', body, ...opts }),
  put: <T>(path: string, body?: unknown, opts?: { quiet?: boolean }) =>
    request<T>(path, { method: 'PUT', body, ...opts }),
  del: <T>(path: string, opts?: { quiet?: boolean }) => request<T>(path, { method: 'DELETE', ...opts }),

  // Fetch a binary payload (JSON backup export) with auth, returning a Blob for download.
  async getBlob(path: string): Promise<Blob> {
    const headers = { ...(await authHeaders()) } as Record<string, string>;
    let res = await fetch(path, { headers, cache: 'no-store' });
    if (res.status === 401) {
      const fresh = { ...(await authHeaders()) } as Record<string, string>;
      res = await fetch(path, { headers: fresh, cache: 'no-store' });
    }
    if (!res.ok) {
      const message = `Download failed (${res.status}).`;
      toastSink(message);
      throw new ApiError(res.status, 'error', message);
    }
    return res.blob();
  },
};
