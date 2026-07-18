'use client';

// Small data-fetching hook: loads a GET resource, exposes { data, error, loading, reload }, and
// refetches on window focus. Callers call reload() after a mutation. Passing `path = null` skips
// the fetch (used when a permission is absent). No polling.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

export interface Resource<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

export function useResource<T>(path: string | null): Resource<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (path === null) {
      setData(undefined);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await api.get<T>(path, { quiet: true });
      if (!alive.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof ApiError ? e : new ApiError(0, 'error', 'Something went wrong.'));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    alive.current = true;
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      alive.current = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  return { data, error, loading, reload: load };
}
