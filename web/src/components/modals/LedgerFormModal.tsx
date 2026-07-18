'use client';

// Add a manual income / expense ledger entry (dive.finance.manage). POST /api/ledger.

import { useState } from 'react';
import { api } from '@/lib/api';
import type { LedgerKind } from '@/lib/types';
import { num, todayISO } from '@/lib/format';
import { Modal } from '../Modal';
import { usePlatform } from '../PlatformProvider';

export function LedgerFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = usePlatform();
  const [kind, setKind] = useState<LedgerKind>('in');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (num(amount) <= 0 || busy) {
      if (num(amount) <= 0) toast('Enter an amount greater than zero.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/ledger', {
        kind,
        amount: num(amount),
        description: description.trim(),
        category: category.trim(),
        date: date.trim(),
      });
      toast(kind === 'in' ? 'Income recorded' : 'Expense recorded');
      onSaved();
      onClose();
    } catch {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add ledger entry"
      onClose={onClose}
      actions={
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          Save entry
        </button>
      }
    >
      <div className="seg" style={{ margin: '0 0 16px' }}>
        <button className={kind === 'in' ? 'seg-btn active' : 'seg-btn'} onClick={() => setKind('in')}>
          Income
        </button>
        <button className={kind === 'out' ? 'seg-btn active' : 'seg-btn'} onClick={() => setKind('out')}>
          Expense
        </button>
      </div>

      <label htmlFor="lg-amt">Amount</label>
      <input id="lg-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />

      <label htmlFor="lg-desc">Description</label>
      <input
        id="lg-desc"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="e.g. Fuel, supplies, tip"
      />

      <label htmlFor="lg-cat">Category</label>
      <input id="lg-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Optional" />

      <label htmlFor="lg-date">Date</label>
      <input id="lg-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
    </Modal>
  );
}
