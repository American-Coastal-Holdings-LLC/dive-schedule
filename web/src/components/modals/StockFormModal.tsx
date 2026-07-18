'use client';

// Add / edit / delete a stock item (dive.inventory.manage). POST /api/inventory or
// PATCH/DELETE /api/inventory/:id.

import { useState } from 'react';
import { api } from '@/lib/api';
import type { InventoryItem, InventoryType } from '@/lib/types';
import { num } from '@/lib/format';
import { Modal } from '../Modal';
import { Icon } from '../Icon';
import { usePlatform } from '../PlatformProvider';

export function StockFormModal({
  item,
  onClose,
  onSaved,
}: {
  item: InventoryItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = usePlatform();
  const editing = !!item;
  const [name, setName] = useState(item?.name ?? '');
  const [type, setType] = useState<InventoryType>(item?.type ?? 'item');
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 0));
  const [unitCost, setUnitCost] = useState(item ? String(num(item.unitCost)) : '');
  const [salePrice, setSalePrice] = useState(item ? String(num(item.salePrice)) : '');
  const [sku, setSku] = useState(item?.sku ?? '');
  const [lowStockAt, setLowStockAt] = useState(String(item?.lowStockAt ?? 0));
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const body = {
      name: name.trim(),
      type,
      quantity: Math.max(0, Math.round(num(quantity))),
      unitCost: num(unitCost),
      salePrice: num(salePrice),
      sku: sku.trim(),
      lowStockAt: Math.max(0, Math.round(num(lowStockAt))),
      notes: notes.trim(),
    };
    try {
      if (editing) await api.patch(`/api/inventory/${item!.id}`, body);
      else await api.post('/api/inventory', body);
      toast(editing ? 'Item saved' : 'Item added');
      onSaved();
      onClose();
    } catch {
      /* toast surfaced by api */
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!editing || busy) return;
    setBusy(true);
    try {
      await api.del(`/api/inventory/${item!.id}`);
      toast('Item deleted');
      onSaved();
      onClose();
    } catch {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? 'Edit item' : 'Add stock item'}
      onClose={onClose}
      actions={
        <>
          {editing ? (
            <button className="icon-btn danger" aria-label="Delete item" onClick={del} disabled={busy}>
              <Icon name="trash" />
            </button>
          ) : null}
          <button className="btn btn-primary" onClick={save} disabled={busy || !name.trim()}>
            {editing ? 'Save' : 'Add item'}
          </button>
        </>
      }
    >
      <label htmlFor="stk-name">Name</label>
      <input id="stk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hull scraper" />

      <label htmlFor="stk-type">Type</label>
      <select id="stk-type" value={type} onChange={(e) => setType(e.target.value as InventoryType)}>
        <option value="item">Inventory item</option>
        <option value="part">Special part</option>
        <option value="tool">Diver tool</option>
      </select>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label htmlFor="stk-qty">Quantity</label>
          <input id="stk-qty" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div>
          <label htmlFor="stk-low">Low-stock at</label>
          <input id="stk-low" inputMode="numeric" value={lowStockAt} onChange={(e) => setLowStockAt(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label htmlFor="stk-cost">Unit cost</label>
          <input
            id="stk-cost"
            inputMode="decimal"
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
            placeholder="0"
          />
        </div>
        <div>
          <label htmlFor="stk-sale">Sale price</label>
          <input
            id="stk-sale"
            inputMode="decimal"
            value={salePrice}
            onChange={(e) => setSalePrice(e.target.value)}
            placeholder="0"
          />
        </div>
      </div>

      <label htmlFor="stk-sku">SKU</label>
      <input id="stk-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Optional" />

      <label htmlFor="stk-notes">Notes</label>
      <textarea id="stk-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
    </Modal>
  );
}
