'use client';

// Seeds the whole app from GET /api/me: who the caller is, and their effective dive.* permissions.
// Everything the UI shows/hides keys off can()/hasAny() — never off role names. The server still
// enforces every rule; these checks are cosmetic. While loading it shows a splash; on failure
// (e.g. the bridge/API is unreachable) it shows a visible error with retry.

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { Me } from '@/lib/types';
import { Icon } from './Icon';

interface PermissionsContextValue {
  me: Me;
  can: (perm: string) => boolean;
  hasAny: (...perms: string[]) => boolean;
  reload: () => void;
}

const PermissionsContext = createContext<PermissionsContextValue | null>(null);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<Me>('/api/me', { quiet: true });
      setMe(result);
    } catch (e) {
      const message =
        e instanceof ApiError
          ? e.status === 401
            ? 'Your session could not be verified. Please reopen the app from the platform.'
            : e.message
          : 'Could not reach the platform. Check that the API is running.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="boot">
        <div className="boot-logo">
          <Icon name="anchor" />
        </div>
        <div className="boot-msg">Loading…</div>
        <style>{bootCss}</style>
      </div>
    );
  }

  if (error || !me) {
    return (
      <div className="boot">
        <div className="boot-logo err">
          <Icon name="alert-triangle" />
        </div>
        <div className="boot-title">Can’t load Dive Schedule</div>
        <div className="boot-msg">{error}</div>
        <button className="btn btn-primary boot-retry" onClick={load}>
          <Icon name="rotate-ccw" /> Try again
        </button>
        <style>{bootCss}</style>
      </div>
    );
  }

  const permSet = new Set(me.permissions);
  const can = (perm: string) => permSet.has(perm);
  const hasAny = (...perms: string[]) => perms.some((p) => permSet.has(p));

  return (
    <PermissionsContext.Provider value={{ me, can, hasAny, reload: load }}>{children}</PermissionsContext.Provider>
  );
}

export function usePermissions(): PermissionsContextValue {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions must be used within PermissionsProvider');
  return ctx;
}

const bootCss = `
.boot { min-height: 70vh; display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: 40px 28px; gap: 12px; }
.boot-logo { width: 60px; height: 60px; border-radius: 18px; display: flex; align-items: center; justify-content: center;
  background: var(--primary-soft); color: var(--primary); border: 1px solid var(--primary-line); }
.boot-logo .icn { width: 28px; height: 28px; }
.boot-logo.err { background: var(--danger-soft); color: var(--danger); border-color: var(--danger-line); }
.boot-title { font-size: 17px; font-weight: 700; color: var(--text); }
.boot-msg { font-size: 14px; color: var(--text-soft); max-width: 340px; line-height: 1.5; }
.boot-retry { flex: none; margin-top: 8px; }
`;
