'use client';

// Dive-service record — a printable document. Send emails the report to the customer (POST
// /api/records/:id/send returns a mailto: URL which the client opens via an anchor click); Print
// uses the print CSS scoped to #recordModal; Copy writes recordText to the clipboard. Restore
// (records.send) and Delete (records.manage) are gated. Sent records are frozen server-side.

import { useState } from 'react';
import { api } from '@/lib/api';
import type { ServiceRecord } from '@/lib/types';
import { formatWhen, isSafePhoto, money, num, recordText, rotationLabel } from '@/lib/format';
import { Modal } from '../Modal';
import { Icon } from '../Icon';
import { DataImg } from '../common';
import { usePlatform } from '../PlatformProvider';

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <tr>
      <td>{label}</td>
      <td>{value}</td>
    </tr>
  );
}

export function RecordModal({
  record,
  canSend,
  canManage,
  canViewPricing,
  onClose,
  onChanged,
}: {
  record: ServiceRecord;
  canSend: boolean;
  canManage: boolean;
  canViewPricing: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = usePlatform();
  const [email, setEmail] = useState(record.customerEmail || '');
  const [busy, setBusy] = useState(false);

  const showPrice = canViewPricing && record.price != null && num(record.price) > 0;

  const send = async () => {
    const to = email.trim();
    if (!to || busy) return;
    setBusy(true);
    try {
      const res = await api.post<{ mailto?: string }>(`/api/records/${record.id}/send`, { sentTo: to });
      if (res?.mailto) {
        const a = document.createElement('a');
        a.href = res.mailto;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      toast('Report sent to customer');
      onChanged();
      onClose();
    } catch {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/api/records/${record.id}/restore`);
      toast('Moved back to Active');
      onChanged();
      onClose();
    } catch {
      setBusy(false);
    }
  };

  const del = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.del(`/api/records/${record.id}`);
      toast('Record deleted');
      onChanged();
      onClose();
    } catch {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recordText(record));
      toast('Record copied');
    } catch {
      toast('Couldn’t copy to clipboard');
    }
  };

  const print = () => window.print();

  const head = [record.boat, record.site].filter(Boolean).join(' — ') || 'Dive service';

  return (
    <Modal
      id="recordModal"
      contentId="recordContent"
      title={record.sent ? 'Sent record' : 'Dive record'}
      onClose={onClose}
      actions={
        <>
          <button className="icon-btn" aria-label="Print" onClick={print}>
            <Icon name="printer" />
          </button>
          <button className="icon-btn" aria-label="Copy" onClick={copy}>
            <Icon name="copy" />
          </button>
          {record.sent ? (
            canSend ? (
              <button className="btn btn-secondary" onClick={restore} disabled={busy}>
                <Icon name="rotate-ccw" /> Restore
              </button>
            ) : null
          ) : null}
          {canManage ? (
            <button className="icon-btn danger" aria-label="Delete record" onClick={del} disabled={busy}>
              <Icon name="trash" />
            </button>
          ) : null}
        </>
      }
    >
      {!record.sent && canSend ? (
        <div className="send-bar">
          <label htmlFor="rec-email">Email report to customer</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="rec-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="customer@email.com"
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary" style={{ flex: 'none' }} onClick={send} disabled={busy || !email.trim()}>
              <Icon name="send" /> Send
            </button>
          </div>
          <div className="send-hint">
            <Icon name="info" />
            <span>Opens your mail app with the report ready to send, and files this record under Sent.</span>
          </div>
        </div>
      ) : null}

      {record.sent ? (
        <div className="done-banner">
          <Icon name="check-circle" />
          <div>
            <div className="db-title">Sent{record.sentTo ? ` to ${record.sentTo}` : ''}</div>
            {record.sentAt ? <div className="db-sub">{formatWhen(record.sentAt)}</div> : null}
          </div>
        </div>
      ) : null}

      <div className="rec-doc-head">
        <div className="rec-doc-title">Dive service record</div>
        <div className="rec-doc-sub">{head}</div>
      </div>

      <table className="rec-table">
        <tbody>
          <Row label="Owner" value={record.ownerName} />
          <Row label="Completed by" value={record.completedByName || ''} />
          <Row label="Divers" value={record.diverNames} />
          <Row label="Date completed" value={formatWhen(record.completedAt)} />
          <Row label="Rotation" value={rotationLabel(record.rotation)} />
          {num(record.footage) > 0 ? <Row label="Boat length" value={`${record.footage} ft`} /> : null}
          {showPrice ? <Row label="Price" value={money(record.price)} /> : null}
          {record.certified ? (
            <Row
              label="Certified"
              value={`Yes${record.certifiedAt ? ` (${formatWhen(record.certifiedAt)})` : ''}`}
            />
          ) : null}
        </tbody>
      </table>

      {record.answers && record.answers.length ? (
        <div className="dl" style={{ marginTop: 16 }}>
          <div className="k">Checklist</div>
          <table className="rec-table">
            <tbody>
              {record.answers.map((a, i) => (
                <Row key={i} label={a.q} value={a.a} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {record.note ? (
        <div className="dl" style={{ marginTop: 16 }}>
          <div className="k">Notes</div>
          <div className="v">{record.note}</div>
        </div>
      ) : null}

      {isSafePhoto(record.photo) ? (
        <div className="dl" style={{ marginTop: 16 }}>
          <div className="k">Proof photo</div>
          <div className="proof-photo">
            <DataImg src={record.photo} alt="Proof of service" />
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
