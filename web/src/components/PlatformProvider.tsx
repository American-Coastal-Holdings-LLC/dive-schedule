'use client';

// Owns the platform bridge lifecycle: pulls the initial theme, applies live theme pushes to :root,
// reports content height back to the host for iframe auto-resize, and exposes a toast() that both
// renders an in-app toast and forwards to the host bridge. Also wires the API client's toast sink so
// request errors surface visibly.

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getBridge, subscribeTheme } from '@/lib/platform/bridge';
import { setToastSink } from '@/lib/api';

interface PlatformContextValue {
  toast: (message: string) => void;
}

const PlatformContext = createContext<PlatformContextValue | null>(null);

// The map arriving here has already been normalised to our CSS custom-property names by
// bridge.ts -> themeToCss. Setting them as INLINE styles on :root is what makes them outrank
// globals.css; every token the host does not send stays derived from the ones it does.
function applyTheme(vars: Record<string, string>) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    if (!value) continue;
    // --eos-mode is a signal, not a colour: it drives the :root[data-eos-mode='dark'] hook so a
    // dark host renders dark even when the OS is in light mode (and vice versa).
    if (key === '--eos-mode') {
      root.setAttribute('data-eos-mode', value);
      continue;
    }
    const prop = key.startsWith('--') ? key : `--${key}`;
    root.style.setProperty(prop, value);
  }
}

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [toastMsg, setToastMsg] = useState('');
  const [toastShown, setToastShown] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((message: string) => {
    if (!message) return;
    setToastMsg(message);
    setToastShown(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setToastShown(false), 2600);
    try {
      getBridge().toast(message);
    } catch {
      /* bridge toast is best-effort */
    }
  }, []);

  // Wire the API client's error toasts to this host.
  useEffect(() => {
    setToastSink(toast);
    return () => setToastSink(() => {});
  }, [toast]);

  // Initial theme + live theme pushes from the host.
  useEffect(() => {
    let cancelled = false;
    const bridge = getBridge();
    bridge
      .getTheme()
      .then((vars) => {
        if (!cancelled) applyTheme(vars);
      })
      .catch(() => {});
    const unsub = subscribeTheme(applyTheme);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // Report content height to the host so it can size the iframe. No polling — driven by layout.
  useEffect(() => {
    const bridge = getBridge();
    let raf = 0;
    const report = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        bridge.requestResize(document.documentElement.scrollHeight);
      });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(document.body);
    window.addEventListener('resize', report);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', report);
    };
  }, []);

  return (
    <PlatformContext.Provider value={{ toast }}>
      {children}
      <div className={toastShown ? 'toast show' : 'toast'} role="status" aria-live="polite">
        {toastMsg}
      </div>
    </PlatformContext.Provider>
  );
}

export function usePlatform(): PlatformContextValue {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error('usePlatform must be used within PlatformProvider');
  return ctx;
}
