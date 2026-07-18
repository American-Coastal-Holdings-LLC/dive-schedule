'use client';

// Point of sale — cash only. Build a sale from custom lines and/or tap-to-add sellable stock, take
// cash, show change, and POST /api/pos/sale (one ledger "in" entry + stock decrements server-side).
// Venmo / QR from the seed are intentionally dropped.

import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useResource } from '@/lib/hooks';
import type { InventoryItem, PosLine } from '@/lib/types';
import { money, num } from '@/lib/format';
import { Modal } from '../Modal';
import { Icon } from '../Icon';
import { usePlatform } from '../PlatformProvider';

export function PosModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = usePlatform();
  // Sellable stock is optional (needs inventory.view); custom lines always work.
  const inventory = useResource<{ items: InventoryItem[] }>('/api/inventory');
  const sellable = (inventory.data?.items ?? []).filter((i) => num(i.salePrice) > 0);

  const [lines, setLines] = useState<PosLine[]>([]);
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [received, setReceived] = useState('');
  const [busy, setBusy] = useState(false);

  const total = useMemo(() => lines.reduce((s, l) => s + num(l.amount) * num(l.qty), 0), [lines]);
  const change = num(received) - total;

  const addCustom = () => {
    const amt = num(amount);
    if (amt <= 0) {
      toast('Enter an amount for the line.');
      return;
    }
    setLines((cur) => [...cur, { name: desc.trim() || 'Custom item', amount: amt, qty: 1 }]);
    setAmount('');
    setDesc('');
  };

  const addStock = (item: InventoryItem) => {
    setLines((cur) => {
      const idx = cur.findIndex((l) => l.itemId === item.id);
      if (idx >= 0) {
        const next = [...cur];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...cur, { itemId: item.id, name: item.name, amount: num(item.salePrice), qty: 1 }];
    });
  };

  const removeLine = (i: number) => setLines((cur) => cur.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (lines.length === 0 || busy) {
      if (lines.length === 0) toast('Add at least one line.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/pos/sale', {
        lines: lines.map((l) => ({ itemId: l.itemId, name: l.name, amount: num(l.amount), qty: num(l.qty) })),
        method: 'cash',
        received: num(received) || undefined,
      });
      toast(`Sale recorded — ${money(total)}`);
      onSaved();
      onClose();
    } catch {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New sale"
      onClose={onClose}
      actions={
        <button className="btn btn-primary" onClick={submit} disabled={busy || lines.length === 0}>
          <Icon name="dollar-sign" /> Take cash {money(total)}
        </button>
      }
    >
      <div className="pos-lines">
        {lines.length === 0 ? (
          <div className="pos-empty">No items yet — add a custom line or tap stock below.</div>
        ) : (
          lines.map((l, i) => (
            <div className="pos-line" key={i}>
              <div className="pos-line-name">
                {l.name}
                {l.qty > 1 ? <b> ×{l.qty}</b> : null}
              </div>
              <div className="pos-line-amt">{money(num(l.amount) * num(l.qty))}</div>
              <button className="pos-line-del" aria-label="Remove line" onClick={() => removeLine(i)}>
                <Icon name="x" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="pos-total">
        <span>Total</span>
        <b>{money(total)}</b>
      </div>

      <label>Add a custom line</label>
      <div className="pos-addrow">
        <input
          className="pos-amt"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="$"
          aria-label="Amount"
        />
        <input
          className="pos-desc"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Description"
          onKeyDown={(e) => {
            if (e.key === 'Enter') addCustom();
          }}
          aria-label="Description"
        />
        <button className="btn btn-secondary" style={{ flex: 'none' }} onClick={addCustom}>
          <Icon name="plus" />
        </button>
      </div>

      {sellable.length ? (
        <>
          <label>Tap to add stock</label>
          <div className="pos-stock">
            {sellable.map((i) => (
              <button
                key={i.id}
                className="pos-stockbtn"
                onClick={() => addStock(i)}
                disabled={i.quantity <= 0}
                title={i.quantity <= 0 ? 'Out of stock' : undefined}
              >
                {i.name} · {money(i.salePrice)}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <label htmlFor="pos-recv" style={{ marginTop: 16 }}>
        Cash received
      </label>
      <input
        id="pos-recv"
        inputMode="decimal"
        value={received}
        onChange={(e) => setReceived(e.target.value)}
        placeholder="$"
      />
      {received.trim() && num(received) > 0 ? (
        <div className={change < 0 ? 'pos-change neg' : 'pos-change'}>
          {change < 0 ? `Short ${money(-change)}` : `Change ${money(change)}`}
        </div>
      ) : null}
    </Modal>
  );
}
