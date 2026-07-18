'use client';

// ============================================================================
// DEV HARNESS — fakes the platform workspace that hosts this plugin in an iframe.
// It is NOT part of the shipped product; it exists to exercise the bridge contract
// locally: identity token delivery, host-driven theming, and the child->parent
// traffic (ready/toast/resize). Pick a dev user (identity), toggle the host theme
// (two DIFFERENT CSS custom-property maps pushed to the app), and watch the log.
// Switching users reloads the embedded app so it re-boots with the new identity.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEV_USERS, buildDevToken, findDevUser } from '@/lib/platform/dev-users';

const PREFIX = 'dive-bridge:';

// Two clearly-distinct host theme maps applied to the app's :root at runtime. The app applies
// whatever the host sends (setProperty), so these override the stylesheet defaults — proving theming
// is host-driven, not just prefers-color-scheme.
const LIGHT_THEME: Record<string, string> = {
  '--brand': '#14315e',
  '--brand-600': '#1b4a86',
  '--brand-700': '#0f2547',
  '--accent': '#1f5fe0',
  '--accent-strong': '#1a4ec4',
  '--accent-ink': '#1546a6',
  '--accent-soft': '#eaf1ff',
  '--accent-line': '#cfddfb',
  '--ink': '#0c1a33',
  '--ink-soft': '#46536b',
  '--ink-mute': '#8794aa',
  '--line': '#e4eaf3',
  '--line-soft': '#eef2f9',
  '--line-strong': '#d2dcea',
  '--surface': '#ffffff',
  '--surface-2': '#f6f9ff',
  '--bg': '#f3f6fc',
  '--success': '#0e8f68',
  '--success-soft': '#e6f6ef',
  '--success-line': '#c6e8d8',
  '--danger': '#d63a49',
  '--danger-strong': '#b4242f',
  '--danger-ink': '#a71f2b',
  '--danger-soft': '#fdecee',
  '--danger-line': '#f4cdd2',
  '--toast-bg': '#14213a',
  '--toast-ink': '#ffffff',
};

const DARK_THEME: Record<string, string> = {
  '--brand': '#142a49',
  '--brand-600': '#1d3f68',
  '--brand-700': '#0c1c34',
  '--accent': '#4b83ff',
  '--accent-strong': '#6a99ff',
  '--accent-ink': '#a9c6ff',
  '--accent-soft': 'rgba(75, 131, 255, .15)',
  '--accent-line': 'rgba(75, 131, 255, .34)',
  '--ink': '#e9f0fb',
  '--ink-soft': '#a7b4ca',
  '--ink-mute': '#6d7d97',
  '--line': '#24324b',
  '--line-soft': '#1a2740',
  '--line-strong': '#32425f',
  '--surface': '#121d31',
  '--surface-2': '#17233c',
  '--bg': '#0a1120',
  '--success': '#34d8a0',
  '--success-soft': 'rgba(46, 200, 150, .15)',
  '--success-line': 'rgba(46, 200, 150, .32)',
  '--danger': '#ff6b78',
  '--danger-strong': '#ff8a94',
  '--danger-ink': '#ff8a94',
  '--danger-soft': 'rgba(255, 90, 105, .15)',
  '--danger-line': 'rgba(255, 90, 105, .34)',
  '--toast-bg': '#26374f',
  '--toast-ink': '#eef3fb',
};

interface LogEntry {
  id: number;
  dir: 'in' | 'out';
  text: string;
  at: string;
}

export default function HarnessPage() {
  const [userKey, setUserKey] = useState(DEV_USERS[0].key);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [iframeNonce, setIframeNonce] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [iframeHeight, setIframeHeight] = useState(820);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const logSeq = useRef(0);

  // Keep the latest identity/theme readable from the (stable) message handler.
  const userKeyRef = useRef(userKey);
  userKeyRef.current = userKey;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const pushLog = useCallback((dir: 'in' | 'out', text: string) => {
    logSeq.current += 1;
    const entry: LogEntry = {
      id: logSeq.current,
      dir,
      text,
      at: new Date().toLocaleTimeString('en-US', { hour12: false }),
    };
    setLog((cur) => [entry, ...cur].slice(0, 50));
  }, []);

  const themeMap = useCallback((t: 'light' | 'dark') => (t === 'dark' ? DARK_THEME : LIGHT_THEME), []);

  const reply = useCallback((source: MessageEventSource | null, message: Record<string, unknown>, note: string) => {
    try {
      (source as Window | null)?.postMessage(message, '*');
      pushLog('out', note);
    } catch {
      /* ignore */
    }
  }, [pushLog]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data.type !== 'string' || !data.type.startsWith(PREFIX)) return;
      const verb = data.type.slice(PREFIX.length);

      switch (verb) {
        case 'ready':
          pushLog('in', 'ready — app handshake');
          break;
        case 'request-token': {
          const user = findDevUser(userKeyRef.current);
          const token = buildDevToken(user);
          reply(event.source, { type: `${PREFIX}token`, requestId: data.requestId, token }, `token → ${user.name}`);
          break;
        }
        case 'request-theme': {
          const vars = themeMap(themeRef.current);
          reply(event.source, { type: `${PREFIX}theme`, requestId: data.requestId, vars }, `theme → ${themeRef.current}`);
          break;
        }
        case 'toast':
          pushLog('in', `toast — "${String(data.message ?? '')}"`);
          break;
        case 'resize': {
          const h = Math.max(400, Math.round(Number(data.height) || 0));
          setIframeHeight(h);
          pushLog('in', `resize — ${h}px`);
          break;
        }
        default:
          pushLog('in', `${verb}`);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [pushLog, reply, themeMap]);

  // Push a theme update to the running app when the host theme toggles (live re-theme).
  const applyTheme = (t: 'light' | 'dark') => {
    setTheme(t);
    themeRef.current = t;
    const win = iframeRef.current?.contentWindow;
    if (win) {
      win.postMessage({ type: `${PREFIX}theme`, vars: themeMap(t) }, '*');
      pushLog('out', `theme push → ${t}`);
    }
  };

  const switchUser = (key: string) => {
    setUserKey(key);
    userKeyRef.current = key;
    setIframeNonce((n) => n + 1); // reload the iframe so the app re-boots with the new identity
    pushLog('out', `switch user → ${findDevUser(key).name} (reloading app)`);
  };

  const currentUser = useMemo(() => findDevUser(userKey), [userKey]);

  return (
    <div className="hx-root">
      <style>{HARNESS_CSS}</style>

      <div className="hx-topbar">
        <div className="hx-brand">
          <span className="hx-dot" />
          Platform Workspace
          <span className="hx-badge">dev harness</span>
        </div>
        <div className="hx-topbar-note">Embeds the vendor app at <code>/</code> and speaks the bridge protocol.</div>
      </div>

      <div className="hx-body">
        <aside className="hx-panel">
          <div className="hx-group">
            <div className="hx-h">Signed-in user</div>
            <div className="hx-users">
              {DEV_USERS.map((u) => (
                <button
                  key={u.key}
                  className={u.key === userKey ? 'hx-user on' : 'hx-user'}
                  onClick={() => switchUser(u.key)}
                >
                  <div className="hx-user-name">{u.name}</div>
                  <div className="hx-user-role">{u.role}</div>
                  <div className="hx-user-meta">
                    {u.installationId} · {u.permissions.length} perms
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="hx-group">
            <div className="hx-h">Host theme</div>
            <div className="hx-theme">
              <button className={theme === 'light' ? 'hx-seg on' : 'hx-seg'} onClick={() => applyTheme('light')}>
                Light
              </button>
              <button className={theme === 'dark' ? 'hx-seg on' : 'hx-seg'} onClick={() => applyTheme('dark')}>
                Dark
              </button>
            </div>
            <div className="hx-hint">Pushes a different CSS variable map; the app applies it to :root.</div>
          </div>

          <div className="hx-group hx-grow">
            <div className="hx-h">
              Bridge traffic
              <button className="hx-clear" onClick={() => setLog([])}>
                clear
              </button>
            </div>
            <div className="hx-log">
              {log.length === 0 ? (
                <div className="hx-log-empty">Waiting for the app to connect…</div>
              ) : (
                log.map((e) => (
                  <div className="hx-log-row" key={e.id}>
                    <span className={e.dir === 'in' ? 'hx-arrow in' : 'hx-arrow out'}>{e.dir === 'in' ? '▸' : '◂'}</span>
                    <span className="hx-log-time">{e.at}</span>
                    <span className="hx-log-text">{e.text}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>

        <main className="hx-stage">
          <div className="hx-stage-head">
            <span className="hx-stage-title">{currentUser.name}</span>
            <span className="hx-stage-sub">iframe · sandboxed · bearer identity via bridge</span>
          </div>
          <div className="hx-frame-wrap">
            <iframe
              key={iframeNonce}
              ref={iframeRef}
              className="hx-frame"
              src="/"
              title="Dive Schedule (embedded)"
              style={{ height: iframeHeight }}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
            />
          </div>
        </main>
      </div>
    </div>
  );
}

const HARNESS_CSS = `
.hx-root { min-height: 100vh; display: flex; flex-direction: column; background: #0b1220; color: #e6edf7;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.hx-root code { background: rgba(255,255,255,.08); padding: 1px 5px; border-radius: 5px; font-size: 12px; }
.hx-topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 12px 18px; background: #0f1830; border-bottom: 1px solid #1e2a44; position: sticky; top: 0; z-index: 5; }
.hx-brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 15px; letter-spacing: -.2px; }
.hx-dot { width: 9px; height: 9px; border-radius: 50%; background: #34d399; box-shadow: 0 0 0 3px rgba(52,211,153,.2); }
.hx-badge { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px;
  color: #9fb4d8; background: rgba(120,150,200,.14); border: 1px solid rgba(120,150,200,.25);
  padding: 2px 8px; border-radius: 999px; }
.hx-topbar-note { font-size: 12px; color: #8698ba; }
.hx-body { flex: 1; display: grid; grid-template-columns: 320px 1fr; min-height: 0; }
@media (max-width: 780px) { .hx-body { grid-template-columns: 1fr; } }
.hx-panel { border-right: 1px solid #1e2a44; padding: 16px; display: flex; flex-direction: column; gap: 20px;
  background: #0c1526; min-height: 0; }
.hx-group { display: flex; flex-direction: column; gap: 10px; }
.hx-grow { flex: 1; min-height: 0; }
.hx-h { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .7px; color: #7f93b8;
  display: flex; align-items: center; justify-content: space-between; }
.hx-users { display: flex; flex-direction: column; gap: 8px; }
.hx-user { text-align: left; background: #111d33; border: 1px solid #223354; border-radius: 12px; padding: 11px 13px;
  cursor: pointer; color: inherit; transition: border-color .15s, background .15s; }
.hx-user:hover { border-color: #34507f; }
.hx-user.on { border-color: #4b83ff; background: rgba(75,131,255,.14); box-shadow: 0 0 0 1px rgba(75,131,255,.4); }
.hx-user-name { font-size: 14px; font-weight: 700; }
.hx-user-role { font-size: 12px; color: #9fb1d2; margin-top: 2px; }
.hx-user-meta { font-size: 11px; color: #6a7ea3; margin-top: 4px; font-variant-numeric: tabular-nums; }
.hx-theme { display: flex; gap: 6px; background: #111d33; border: 1px solid #223354; border-radius: 10px; padding: 4px; }
.hx-seg { flex: 1; padding: 8px; font-size: 13px; font-weight: 600; border: none; border-radius: 7px;
  background: transparent; color: #9fb1d2; cursor: pointer; font-family: inherit; }
.hx-seg.on { background: #4b83ff; color: #fff; }
.hx-hint { font-size: 11.5px; color: #6a7ea3; line-height: 1.4; }
.hx-clear { font-size: 11px; font-weight: 600; color: #7f93b8; background: none; border: none; cursor: pointer;
  text-transform: none; letter-spacing: 0; }
.hx-clear:hover { color: #c7d5ee; }
.hx-log { flex: 1; overflow-y: auto; background: #0a1120; border: 1px solid #1c2740; border-radius: 10px;
  padding: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; min-height: 140px; }
.hx-log-empty { color: #5a6c8c; padding: 8px; }
.hx-log-row { display: flex; gap: 7px; align-items: baseline; padding: 3px 4px; border-bottom: 1px solid #121c30; }
.hx-arrow { font-size: 11px; }
.hx-arrow.in { color: #34d399; }
.hx-arrow.out { color: #4b83ff; }
.hx-log-time { color: #5a6c8c; }
.hx-log-text { color: #c7d5ee; word-break: break-word; }
.hx-stage { padding: 16px; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.hx-stage-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.hx-stage-title { font-size: 14px; font-weight: 700; }
.hx-stage-sub { font-size: 12px; color: #7f93b8; }
.hx-frame-wrap { border: 1px solid #223354; border-radius: 18px; overflow: hidden; background: #060b15;
  box-shadow: 0 20px 60px -30px rgba(0,0,0,.9); max-width: 620px; width: 100%; margin: 0 auto; }
.hx-frame { width: 100%; border: 0; display: block; background: transparent; }
`;
