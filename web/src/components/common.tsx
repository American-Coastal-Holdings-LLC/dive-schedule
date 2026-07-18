'use client';

import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { initials, isSafePhoto } from '@/lib/format';

// Context-sensitive floating action button. Rendered by the tab that owns the primary create action
// (Jobs, Stock, Sales) and gated by that tab on the relevant manage permission.
export function Fab({ onClick, label, icon = 'plus' }: { onClick: () => void; label: string; icon?: IconName }) {
  return (
    <button className="fab" onClick={onClick} aria-label={label} title={label}>
      <Icon name={icon} />
    </button>
  );
}

export function EmptyState({ icon, title, desc }: { icon: IconName; title: string; desc?: string }) {
  return (
    <div className="empty">
      <div className="ico">
        <Icon name={icon} />
      </div>
      <div className="t">{title}</div>
      {desc ? <div className="d">{desc}</div> : null}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="banner error">
      <Icon name="alert-triangle" />
      <div>{message}</div>
    </div>
  );
}

export function InfoBanner({ children }: { children: ReactNode }) {
  return (
    <div className="banner">
      <Icon name="info" />
      <div>{children}</div>
    </div>
  );
}

// Renders an already-validated image data URL. next/image is unsuitable for arbitrary user-supplied
// data URLs (no remote host, no optimization benefit), so a plain <img> is used deliberately — the
// one place the no-img-element rule is opted out of.
export function DataImg({ src, alt = '', className }: { src?: string; alt?: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} />;
}

// Avatar: renders a genuine image data URL if present, otherwise initials. Never injects HTML.
export function Avatar({ photo, name, className }: { photo?: string; name?: string; className: string }) {
  return (
    <div className={className}>
      {isSafePhoto(photo) ? <DataImg src={photo} /> : <span>{initials(name)}</span>}
    </div>
  );
}
