// Inventory domain — ported from the standalone build (dive-schedule-update_2, steep-voice-runtime),
// which is ahead of the seed this plugin was built from. Sources: invTypeOf, invHasLowStock,
// adjustItemQty / nextQty (the ± stepper and the POS stock guard), the form's qtyRaw coercion, and
// the paste-import wizard (openImportWizard / renderImportPreview).
//
// WHY IT IS ALL PURE. The standalone build ran these on the client against an in-memory array, so
// "the rules" and "the DOM" were the same code. Here the client is untrusted: every rule that
// decides what gets written has to hold on the server, and the only way to keep it testable without
// a database is to keep the arithmetic and the parsing free of both Prisma and Nest. The service
// does the tenant-scoped I/O; this file does the deciding.
//
// NO WEB MIRROR, DELIBERATELY — unlike checklist/inspection.ts. The two flags the UI needs
// (`lowStock`, `sellable`) already ride on the serialized item, and the import parser is only ever
// invoked through an endpoint, so a second copy would be a second thing to keep in lock-step for no
// rendering benefit. If a future screen needs to classify an item the browser has never fetched,
// mirror invTypeOf/invHasLowStock then — and copy inspection.ts's lock-step header when you do.

/** The three kinds of stock this app tracks. Order is the Stock tab's filter-chip order. */
export const INVENTORY_TYPES = ['item', 'part', 'tool'] as const;

export type InventoryType = (typeof INVENTORY_TYPES)[number];

/** Anything that carries the quantity/threshold pair — a Prisma row or an unsaved draft. */
export interface StockLevels {
  quantity?: unknown;
  lowStockAt?: unknown;
}

/**
 * Normalise a stored/typed type string. Unknown values fall back to 'item' rather than throwing:
 * `type` is a plain String column, so a row written before the enum settled must still render.
 */
export function invTypeOf(value: unknown): InventoryType {
  const t = String(value ?? '').trim().toLowerCase();
  return t === 'part' || t === 'tool' ? t : 'item';
}

/**
 * Coerce a quantity the way the item form does: blank and unparseable both mean zero, and stock is
 * never negative. Whole units only — the column is an Int, and half a scraper is not a thing.
 */
export function invQtyOf(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '').trim());
  return isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/**
 * Is this item at or under its reorder threshold?
 *
 * BEHAVIOUR DIFFERENCE FROM THE SOURCE. There, lowStockAt was a free-text field, so "unset" was the
 * empty string and a threshold of 0 was a real, meaningful setting (0 on hand = low). Here the
 * column is `Int @default(0)`, which makes "never configured" and "configured to zero"
 * indistinguishable — so a literal port would flag every default-valued tool the moment it hit
 * zero. `<= 0` therefore means "no threshold", matching the behaviour this plugin already shipped.
 * Changing that needs a nullable column and a migration; it is not worth one.
 */
export function invHasLowStock(item: StockLevels | null | undefined): boolean {
  const threshold = Number(item?.lowStockAt ?? 0);
  if (!isFinite(threshold) || threshold <= 0) return false;
  const qty = Number(item?.quantity ?? 0);
  return isFinite(qty) && qty <= threshold;
}

export interface QtyAdjustment {
  /** The quantity after applying as much of `delta` as the stock allows. Never negative. */
  next: number;
  /** The signed change actually representable — equals `delta` unless stock ran out. */
  applied: number;
  /** How much of a consume request could NOT be met. Zero on any receive. */
  shortfall: number;
}

/**
 * The arithmetic behind both ± stepper taps and a POS line: clamp at zero, and report what was left
 * unmet so the caller can decide between the source's two reactions to the same situation — the
 * stepper silently clamped, POS refused with "Only N in stock".
 *
 * The caller here refuses, because clamping server-side destroys the difference between "consume 3"
 * and "consume 3 but only 1 was there" on a tenant where two divers share one stock list.
 */
export function nextQty(current: unknown, delta: unknown): QtyAdjustment {
  const base = invQtyOf(current);
  const d = Number(delta);
  const change = isFinite(d) ? Math.trunc(d) : 0;
  const raw = base + change;
  const next = Math.max(0, raw);
  return { next, applied: next - base, shortfall: raw < 0 ? -raw : 0 };
}

// ---------------------------------------------------------------------------
//  Paste import
//
//  The source wizard imported boats; this one imports stock, but the shape is the same and is what
//  actually made it usable: paste a spreadsheet selection, get a preview plus a plain-English error
//  list, then confirm. Parsing lives here (not in the browser) so preview and commit can never
//  disagree about what a paste means — the preview endpoint and the import endpoint call this same
//  function on the same text.
// ---------------------------------------------------------------------------

/** Ceiling on a single paste. A wizard is for a spreadsheet selection, not a bulk data migration. */
export const IMPORT_MAX_ROWS = 500;

/** Ceiling on the request body, enforced again by the DTO. ~500 rows of realistic width. */
export const IMPORT_MAX_CHARS = 200_000;

/** Column order used when the paste has no header row. Also the order the wizard's help text lists. */
export const IMPORT_POSITIONAL_COLUMNS = [
  'name', 'type', 'quantity', 'sku', 'unitCost', 'salePrice', 'lowStockAt', 'notes',
] as const;

type ImportField = (typeof IMPORT_POSITIONAL_COLUMNS)[number];

// Header spellings people actually paste, normalised to letters+digits only ("Unit Cost" ->
// "unitcost", "Part #" -> "part"). Generous on input because the alternative is a user re-typing a
// spreadsheet header to satisfy us.
const HEADER_ALIASES: Record<string, ImportField> = {
  name: 'name', item: 'name', itemname: 'name', description: 'name', title: 'name',
  type: 'type', category: 'type', kind: 'type',
  quantity: 'quantity', qty: 'quantity', count: 'quantity', onhand: 'quantity', stock: 'quantity',
  sku: 'sku', code: 'sku', part: 'sku', partnumber: 'sku', partno: 'sku',
  unitcost: 'unitCost', cost: 'unitCost', buy: 'unitCost', purchaseprice: 'unitCost',
  saleprice: 'salePrice', price: 'salePrice', sale: 'salePrice', sell: 'salePrice',
  lowstockat: 'lowStockAt', lowstock: 'lowStockAt', low: 'lowStockAt', reorder: 'lowStockAt',
  reorderat: 'lowStockAt', min: 'lowStockAt', minimum: 'lowStockAt',
  notes: 'notes', note: 'notes', comment: 'notes', comments: 'notes',
};

const normalizeHeader = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A validated row, shaped exactly like the columns InventoryItem needs (minus installationId). */
export interface ImportRow {
  name: string;
  type: InventoryType;
  quantity: number;
  unitCost: number;
  salePrice: number;
  sku: string;
  lowStockAt: number;
  notes: string;
}

export interface ImportParseResult {
  rows: ImportRow[];
  /** Human-readable, line-numbered. The wizard shows the first few; nothing is silently dropped. */
  errors: string[];
  /** True when a header row was recognised and consumed (the UI says so, so nobody loses row 1). */
  hasHeader: boolean;
}

/**
 * Split CSV/TSV into a grid. Delimiter is sniffed from the first line — a spreadsheet copy/paste is
 * tab-separated and a file export is comma-separated, and users do both without noticing which.
 * Quoted fields survive embedded delimiters and newlines, with "" as the escaped quote (RFC 4180),
 * because a notes column with a comma in it is the normal case, not the edge case.
 */
function splitDelimited(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? '\t' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field.trim() === '') { quoted = true; field = ''; continue; }
    if (c === delim) { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  row.push(field);
  rows.push(row);

  // A trailing newline yields one empty row; blank lines mid-paste are equally uninteresting.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Money: lenient like the source's form fields — strip currency noise, garbage becomes zero. */
function money(raw: string): number {
  const n = parseFloat(String(raw ?? '').replace(/[^0-9.-]/g, ''));
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

/**
 * Parse a pasted CSV/TSV block into importable rows plus the errors to show alongside them.
 *
 * Never throws and never returns a partially-valid row: a row either lands in `rows` ready to write
 * or lands in `errors` explaining why it did not. That is what lets the preview and the commit share
 * one code path — the preview is simply this result rendered, and the commit is this result written.
 */
export function parseInventoryImport(text: unknown): ImportParseResult {
  const src = String(text ?? '');
  const errors: string[] = [];
  if (!src.trim()) return { rows: [], errors, hasHeader: false };
  if (src.length > IMPORT_MAX_CHARS) {
    return { rows: [], errors: ['That paste is too large. Import it in smaller batches.'], hasHeader: false };
  }

  const grid = splitDelimited(src);
  if (!grid.length) return { rows: [], errors, hasHeader: false };

  // Header detection: a first row whose cells are mostly recognised names is a header, not data.
  // "mostly" rather than "any" so a genuine item literally called "Code" cannot eat row 1.
  const firstCells = grid[0].map((c) => normalizeHeader(c));
  const recognised = firstCells.filter((c) => c in HEADER_ALIASES).length;
  const hasHeader = recognised >= Math.max(2, Math.ceil(firstCells.length / 2));

  const columns: (ImportField | null)[] = hasHeader
    ? firstCells.map((c) => HEADER_ALIASES[c] ?? null)
    : IMPORT_POSITIONAL_COLUMNS.map((f) => f);

  if (hasHeader && !columns.includes('name')) {
    errors.push('No name column found. Include a “name” (or “item”) column.');
    return { rows: [], errors, hasHeader };
  }

  const body = hasHeader ? grid.slice(1) : grid;
  const rows: ImportRow[] = [];

  for (let i = 0; i < body.length; i++) {
    // Line number as the user sees it in their paste, so an error points at something they can find.
    const lineNo = i + 1 + (hasHeader ? 1 : 0);
    if (rows.length >= IMPORT_MAX_ROWS) {
      errors.push(`Only the first ${IMPORT_MAX_ROWS} rows were imported. Paste the rest separately.`);
      break;
    }

    const cells = body[i];
    const get = (field: ImportField): string => {
      const idx = columns.indexOf(field);
      return idx >= 0 ? String(cells[idx] ?? '').trim() : '';
    };

    const name = get('name');
    if (!name) {
      errors.push(`Row ${lineNo}: no name — skipped.`);
      continue;
    }

    // Type is the one field we refuse to guess at. Defaulting a mistyped "tools" to plain stock
    // would file a diver's gear under sellable inventory, and nothing in the UI would show it.
    const rawType = get('type');
    if (rawType && invTypeOf(rawType) === 'item' && normalizeHeader(rawType) !== 'item') {
      errors.push(`Row ${lineNo}: unknown type “${rawType}” — use item, part or tool.`);
      continue;
    }

    rows.push({
      name: name.slice(0, 200),
      type: invTypeOf(rawType),
      quantity: invQtyOf(get('quantity')),
      unitCost: money(get('unitCost')),
      salePrice: money(get('salePrice')),
      sku: get('sku').slice(0, 80),
      lowStockAt: invQtyOf(get('lowStockAt')),
      notes: get('notes').slice(0, 2000),
    });
  }

  if (!rows.length && !errors.length) errors.push('Nothing to import — check the columns and try again.');
  return { rows, errors, hasHeader };
}
