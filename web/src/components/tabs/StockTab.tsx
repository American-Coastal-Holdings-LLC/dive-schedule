'use client';

// Stock — inventory list with type filter chips (All / Inventory / Special parts / Diver tools),
// a low-stock red flag, ± stock movement, an item form and a paste importer
// (dive.inventory.manage). GET /api/inventory.

import { useCallback, useMemo, useState } from 'react';
import { useResource } from '@/lib/hooks';
import { api } from '@/lib/api';
import type { InventoryItem, InventoryType } from '@/lib/types';
import { money, num } from '@/lib/format';
import { usePermissions } from '../PermissionsProvider';
import { PERMISSIONS as P } from '@/lib/permissions';
import { EmptyState, ErrorBanner, Fab } from '../common';
import { Icon } from '../Icon';
import { StockFormModal } from '../modals/StockFormModal';
import { StockImportModal } from '../modals/StockImportModal';

type Filter = 'all' | InventoryType;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'item', label: 'Inventory' },
  { key: 'part', label: 'Special parts' },
  { key: 'tool', label: 'Diver tools' },
];

const typeTagClass = (t: InventoryType) => (t === 'part' ? 'tag part' : t === 'tool' ? 'tag tool' : 'tag');
const typeTagLabel = (t: InventoryType) => (t === 'part' ? 'Part' : t === 'tool' ? 'Tool' : 'Item');

export function StockTab() {
  const { can } = usePermissions();
  const canManage = can(P.INVENTORY_MANAGE);
  const { data, error, reload } = useResource<{ items: InventoryItem[] }>('/api/inventory');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [adjusting, setAdjusting] = useState<string | null>(null);

  const items = useMemo(() => data?.items ?? [], [data]);
  const shown = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.type === filter)),
    [items, filter],
  );

  // Receive / consume one unit. The delta is sent RELATIVE, never as a computed total: two people
  // working the same list would otherwise each post a total derived from their own stale copy and
  // the later write would erase the earlier one. The server owns the zero floor and refuses to
  // over-consume, so there is nothing to validate here beyond not firing twice at once.
  const adjust = useCallback(
    async (id: string, delta: number) => {
      if (adjusting) return;
      setAdjusting(id);
      try {
        await api.post(`/api/inventory/${id}/adjust`, { delta });
        reload();
      } catch {
        /* toast surfaced by api */
      } finally {
        setAdjusting(null);
      }
    },
    [adjusting, reload],
  );

  return (
    <>
      {canManage ? (
        <div className="inv-actions">
          <button className="btn btn-secondary btn-mini" onClick={() => setImporting(true)}>
            <Icon name="clipboard" /> Import
          </button>
        </div>
      ) : null}

      <div className="inv-filter">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={filter === f.key ? 'inv-filter-btn active' : 'inv-filter-btn'}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? <ErrorBanner message="Couldn’t load stock." /> : null}

      {shown.length === 0 && !error ? (
        <EmptyState
          icon="package"
          title="No stock items"
          desc={canManage ? 'Tap + to add your first item.' : 'Nothing here yet.'}
        />
      ) : (
        shown.map((i) => (
          <div key={i.id} className="inv-row">
            <button
              className="iv-main"
              onClick={() => canManage && setEditing(i)}
              disabled={!canManage}
              aria-label={canManage ? `Edit ${i.name || 'item'}` : undefined}
            >
              <div className="iv-name">{i.name || 'Untitled'}</div>
              <div className="iv-sub">
                <span className={typeTagClass(i.type)}>{typeTagLabel(i.type)}</span>
                {i.lowStock ? <span className="tag low">Low stock</span> : null}
                {i.sku ? <span>SKU {i.sku}</span> : null}
                {num(i.salePrice) > 0 ? <span>Sells {money(i.salePrice)}</span> : null}
                {num(i.unitCost) > 0 ? <span>Cost {money(i.unitCost)}</span> : null}
              </div>
            </button>
            <div className="iv-qty">
              <div className={i.lowStock ? 'iv-qnum low' : 'iv-qnum'}>{i.quantity}</div>
              <div className="iv-qlbl">in stock</div>
            </div>
            {canManage ? (
              <div className="iv-step">
                <button
                  aria-label={`Remove one ${i.name || 'item'}`}
                  onClick={() => adjust(i.id, -1)}
                  disabled={adjusting !== null || i.quantity <= 0}
                >
                  −
                </button>
                <button
                  aria-label={`Add one ${i.name || 'item'}`}
                  onClick={() => adjust(i.id, 1)}
                  disabled={adjusting !== null}
                >
                  +
                </button>
              </div>
            ) : null}
          </div>
        ))
      )}

      {canManage ? <Fab onClick={() => setAdding(true)} label="Add stock item" /> : null}

      {adding ? <StockFormModal item={null} onClose={() => setAdding(false)} onSaved={reload} /> : null}
      {editing ? <StockFormModal item={editing} onClose={() => setEditing(null)} onSaved={reload} /> : null}
      {importing ? <StockImportModal onClose={() => setImporting(false)} onSaved={reload} /> : null}
    </>
  );
}
