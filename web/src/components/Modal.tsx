'use client';

import { type ReactNode, useEffect } from 'react';
import { Icon } from './Icon';

// Bottom-sheet modal matching the seed look. Rendered only while open (the caller conditionally
// mounts it). Esc and the scrim close it. `id` / `contentId` allow the Records print CSS to target
// the record sheet (#recordModal / #recordContent).

export function Modal({
  title,
  onClose,
  children,
  actions,
  headerAccessory,
  id,
  contentId,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  headerAccessory?: ReactNode;
  id?: string;
  contentId?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="modal" id={id}>
      <button className="modal-overlay" aria-label="Close" onClick={onClose} />
      <div className="modal-box" role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2>{title}</h2>
          {headerAccessory}
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-content" id={contentId}>
          {children}
        </div>
        {actions ? <div className="modal-actions">{actions}</div> : null}
      </div>
    </div>
  );
}
