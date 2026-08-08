'use client';

// Bulk-add stock from a pasted spreadsheet selection (dive.inventory.manage). The paste is parsed
// SERVER-side — POST /api/inventory/import/preview while typing, POST /api/inventory/import to
// commit — so what the preview shows and what gets written come from one parser that the browser
// cannot disagree with. Nothing here validates; it renders what the server said.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { InventoryImportRow } from '@/lib/types';
import { money } from '@/lib/format';
import { Modal } from '../Modal';
import { usePlatform } from '../PlatformProvider';

interface PreviewResponse {
  rows: InventoryImportRow[];
  errors: string[];
  hasHeader: boolean;
}

const PREVIEW_ROWS = 20;
const PREVIEW_ERRORS = 8;

export function StockImportModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = usePlatform();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Debounced: the source re-parsed on every keystroke for free because the parser was local. It is
  // a round trip now, so typing settles first — a paste is one burst anyway.
  useEffect(() => {
    if (!text.trim()) {
      setPreview(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api.post<PreviewResponse>('/api/inventory/import/preview', { text }, { quiet: true });
        if (alive.current) setPreview(res);
      } catch {
        if (alive.current) setPreview({ rows: [], errors: ['Couldn’t read that paste.'], hasHeader: false });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [text]);

  const readFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      try {
        setText(await file.text());
      } catch {
        toast('Couldn’t read that file');
      }
    },
    [toast],
  );

  const rows = preview?.rows ?? [];
  const errors = preview?.errors ?? [];

  const confirm = async () => {
    if (!rows.length || busy) return;
    setBusy(true);
    try {
      const res = await api.post<{ created: number }>('/api/inventory/import', { text });
      toast(`Imported ${res.created} item${res.created === 1 ? '' : 's'}`);
      onSaved();
      onClose();
    } catch {
      setBusy(false); // toast surfaced by api; leave the paste on screen so it can be fixed
    }
  };

  return (
    <Modal
      title="Import stock"
      onClose={onClose}
      actions={
        <button className="btn btn-primary" onClick={confirm} disabled={busy || !rows.length}>
          {rows.length ? `Import ${rows.length} item${rows.length === 1 ? '' : 's'}` : 'Import'}
        </button>
      }
    >
      <p className="import-help">
        Paste a CSV (or tab-separated rows straight out of a spreadsheet). Header names like{' '}
        <code>name</code>, <code>type</code>, <code>quantity</code>, <code>sku</code>, <code>cost</code>,{' '}
        <code>price</code>, <code>low</code>, <code>notes</code> are recognised. Without a header row,
        columns are read in that order. Types: item, part, tool.
      </p>

      <label htmlFor="imp-paste">Paste stock</label>
      <textarea
        id="imp-paste"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder={'name,type,quantity,sku,cost,price,low,notes\nHull scraper,tool,4,HS-1,12.50,0,2,Blue handle'}
      />

      <label htmlFor="imp-file">Or choose a .csv file</label>
      <input
        id="imp-file"
        type="file"
        accept=".csv,.tsv,text/csv,text/tab-separated-values,text/plain"
        onChange={(e) => readFile(e.target.files?.[0])}
      />

      {rows.length ? (
        <div className="import-preview">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Qty</th>
                <th>SKU</th>
                <th>Cost</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                <tr key={`${r.sku}-${r.name}-${i}`}>
                  <td>{r.name}</td>
                  <td>{r.type}</td>
                  <td>{r.quantity}</td>
                  <td>{r.sku || '—'}</td>
                  <td>{r.unitCost > 0 ? money(r.unitCost) : '—'}</td>
                  <td>{r.salePrice > 0 ? money(r.salePrice) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {rows.length > PREVIEW_ROWS ? (
        <div className="import-note">
          Showing first {PREVIEW_ROWS} of {rows.length}.
        </div>
      ) : null}

      {errors.length ? (
        <div className="import-errors">
          {errors.slice(0, PREVIEW_ERRORS).map((e, i) => (
            <div key={i}>{e}</div>
          ))}
          {errors.length > PREVIEW_ERRORS ? <div>…and {errors.length - PREVIEW_ERRORS} more</div> : null}
        </div>
      ) : null}
    </Modal>
  );
}
