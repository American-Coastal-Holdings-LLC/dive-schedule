import { Logger } from '@nestjs/common';
import { scopedApiBase } from './config';
import { getAccessToken, invalidateToken } from './oauth-client';

/**
 * Client for the shared scoped API (contract §6/§7).
 *
 * Every read is per-installation: the access token IS the tenancy boundary, so a caller cannot
 * reach another installation's data by passing a different id — the platform resolves scope from
 * the token, not from our request.
 *
 * KILL-SWITCH (§6): a killed, paused or uninstalled installation answers 401 with
 * `error.code: "plugin_revoked"` — a stable code distinct from a generic invalid-token 401. That
 * distinction matters: a generic 401 means "our token went stale, retry with a fresh one", while
 * plugin_revoked means "stop, this installation is gone" and retrying is both useless and rude.
 * PluginRevokedError exists so callers can branch their "integration paused" UX on it.
 */

const logger = new Logger('ScopedApiClient');

export class PluginRevokedError extends Error {
  constructor(readonly installationId: string) {
    super(`Installation ${installationId} is revoked, paused or uninstalled (plugin_revoked).`);
    this.name = 'PluginRevokedError';
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

/**
 * GET a scoped resource. Retries EXACTLY once on a generic 401, after discarding the cached token:
 * the overwhelmingly likely cause is an expired token, and one retry turns that into a non-event.
 * It does not retry past that — a second 401 with a freshly-minted token is a real authorization
 * failure, and looping on it would hammer the platform.
 */
export async function scopedGet<T>(installationId: string, resource: string): Promise<T> {
  const attempt = async (): Promise<Response> => {
    const token = await getAccessToken(installationId);
    return fetch(`${scopedApiBase()}/${resource.replace(/^\/+/, '')}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
  };

  let res = await attempt();

  if (res.status === 401) {
    const body = (await res.clone().json().catch(() => ({}))) as ErrorEnvelope;
    if (body?.error?.code === 'plugin_revoked') throw new PluginRevokedError(installationId);

    invalidateToken(installationId);
    res = await attempt();

    if (res.status === 401) {
      const retryBody = (await res.clone().json().catch(() => ({}))) as ErrorEnvelope;
      if (retryBody?.error?.code === 'plugin_revoked') throw new PluginRevokedError(installationId);
      throw new Error(`Scoped API returned 401 for ${resource} after token refresh`);
    }
  }

  if (!res.ok) throw new Error(`Scoped API GET ${resource} failed with HTTP ${res.status}`);

  logger.debug(`scoped GET ${resource} ok for ${installationId}`);
  return (await res.json()) as T;
}
