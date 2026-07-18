'use client';

// Stock — inventory list with type filter chips (All / Inventory / Special parts / Diver tools),
// a low-stock red flag, and an item form (dive.inventory.manage). GET /api/inventory.

import { useMemo, useState } from 'react';
import { useResource } from '@/lib/hooks';
import type { InventoryItem, InventoryType } from '@/lib/types';
import { money, num } from '@/lib/format';
import { usePermissions } from '../PermissionsProvider';
import { PERMISSIONS as P } from '@/lib/permissions';
import { EmptyState, ErrorBanner, Fab } from '../common';
import { StockFormModal } from '../modals/StockFormModal';

type Filter = 'all' | InventoryType;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'item', label: 'Inventory' },
  { key: 'part', label: 'Special parts' },
  { key: 'tool', label: 'Diver tools' },
];

const typeTagClass = (t: InventoryType) => (t === 'part' ? 'tag part' : t === 'tool' ? 'tag tool' : 'tag');
const typeTagLabel = (t: InventoryType) => (t === 'part' ? 'Part' : t === 'tool' ? 'Tool' : 'Item');

const isLow = (i: InventoryItem) => i.lowStockAt > 0 && i.quantity <= i.lowStockAt;

export function StockTab() {
  const { can } = usePermissions();
  const canManage = can(P.INVENTORY_MANAGE);
  const { data, error, reload } = useResource<{ items: InventoryItem[] }>('/api/inventory');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [adding, setAdding] = useState(false);

  const items = useMemo(() => data?.items ?? [], [data]);
  const shown = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.type === filter)),
    [items, filter],
  );

  return (
    <>
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
        shown.map((i) => {
          const low = isLow(i);
          const openEdit = () => canManage && setEditing(i);
          return (
            <button
              key={i.id}
              className="inv-row"
              onClick={openEdit}
              style={canManage ? undefined : { cursor: 'default' }}
            >
              <div className="iv-main">
                <div className="iv-name">{i.name || 'Untitled'}</div>
                <div className="iv-sub">
                  <span className={typeTagClass(i.type)}>{typeTagLabel(i.type)}</span>
                  {low ? <span className="tag low">Low stock</span> : null}
                  {i.sku ? <span>SKU {i.sku}</span> : null}
                  {num(i.salePrice) > 0 ? <span>Sells {money(i.salePrice)}</span> : null}
                  {num(i.unitCost) > 0 ? <span>Cost {money(i.unitCost)}</span> : null}
                </div>
              </div>
              <div className="iv-qty">
                <div className={low ? 'iv-qnum low' : 'iv-qnum'}>{i.quantity}</div>
                <div className="iv-qlbl">in stock</div>
              </div>
            </button>
          );
        })
      )}

      {canManage ? <Fab onClick={() => setAdding(true)} label="Add stock item" /> : null}

      {adding ? <StockFormModal item={null} onClose={() => setAdding(false)} onSaved={reload} /> : null}
      {editing ? <StockFormModal item={editing} onClose={() => setEditing(null)} onSaved={reload} /> : null}
    </>
  );
}
