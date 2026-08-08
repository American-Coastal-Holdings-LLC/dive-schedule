// Checks the ported inventory domain rules (api/src/inventory/inventory-domain.ts).
//
//   npx tsx scripts/dev-checks/inventory-domain.mjs
//
// Two things here are worth more than the rest. THE ZERO FLOOR: nextQty is what stands between a
// mistyped consume and negative stock, and it has to report the shortfall rather than swallow it,
// because the service turns that into "Only N in stock" instead of a silent clamp. THE PARSER:
// preview and commit call parseInventoryImport on the same text, so anything it accepts here is
// something that gets written to the database — a row that parses wrong is a row nobody typed.

import {
  invTypeOf,
  invQtyOf,
  invHasLowStock,
  nextQty,
  parseInventoryImport,
  IMPORT_MAX_ROWS,
} from '../../api/src/inventory/inventory-domain.ts';

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}\n        got  ${g}\n        want ${w}`); }
};

// --- type classification ---
eq('type: part', invTypeOf('part'), 'part');
eq('type: tool', invTypeOf('TOOL'), 'tool');
eq('type: unknown falls back to item', invTypeOf('widget'), 'item');
eq('type: null falls back to item', invTypeOf(null), 'item');

// --- quantity coercion (the item form accepts all of these) ---
eq('qty: blank -> 0', invQtyOf(''), 0);
eq('qty: "12" -> 12', invQtyOf('12'), 12);
eq('qty: negative clamps to 0', invQtyOf('-4'), 0);
eq('qty: fractional truncates (Int column)', invQtyOf('3.9'), 3);
eq('qty: garbage -> 0', invQtyOf('n/a'), 0);

// --- low stock ---
eq('low: at threshold is low', invHasLowStock({ quantity: 2, lowStockAt: 2 }), true);
eq('low: under threshold is low', invHasLowStock({ quantity: 1, lowStockAt: 2 }), true);
eq('low: over threshold is not', invHasLowStock({ quantity: 5, lowStockAt: 2 }), false);
// Deliberate divergence from the standalone build: lowStockAt is a non-nullable Int here, so 0
// means "no threshold set", not "flag me at zero on hand".
eq('low: threshold 0 means unset, not "low at zero"', invHasLowStock({ quantity: 0, lowStockAt: 0 }), false);

// --- the zero floor ---
eq('nextQty: receive', nextQty(5, 3), { next: 8, applied: 3, shortfall: 0 });
eq('nextQty: consume', nextQty(5, -3), { next: 2, applied: -3, shortfall: 0 });
eq('nextQty: exact drain', nextQty(3, -3), { next: 0, applied: -3, shortfall: 0 });
eq('nextQty: over-consume reports the shortfall', nextQty(1, -4), { next: 0, applied: -1, shortfall: 3 });
eq('nextQty: stepper minus at zero is a no-op', nextQty(0, -1), { next: 0, applied: 0, shortfall: 1 });
eq('nextQty: non-numeric delta changes nothing', nextQty(4, 'x'), { next: 4, applied: 0, shortfall: 0 });

// --- import: headered CSV ---
{
  const text = [
    'name,type,quantity,sku,cost,price,low,notes',
    'Hull scraper,tool,4,HS-1,12.50,0,2,Blue handle',
    'Zinc anode,part,10,ZN-9,3,8,5,',
  ].join('\n');
  const { rows, errors, hasHeader } = parseInventoryImport(text);
  eq('import: header recognised', hasHeader, true);
  eq('import: no errors', errors, []);
  eq('import: row count', rows.length, 2);
  eq('import: first row', rows[0], {
    name: 'Hull scraper', type: 'tool', quantity: 4, unitCost: 12.5,
    salePrice: 0, sku: 'HS-1', lowStockAt: 2, notes: 'Blue handle',
  });
  eq('import: header aliases map (cost/price/low)', rows[1].unitCost + rows[1].salePrice + rows[1].lowStockAt, 16);
}

// --- import: tab-separated (what a spreadsheet copy/paste actually produces) ---
{
  const { rows, hasHeader } = parseInventoryImport('name\ttype\tquantity\nMask strap\titem\t7');
  eq('import: TSV header', hasHeader, true);
  eq('import: TSV row', rows[0]?.quantity, 7);
}

// --- import: headerless falls back to positional columns ---
{
  const { rows, hasHeader } = parseInventoryImport('Fin strap,part,3,FS-2,4,9,1,spare');
  eq('import: no header detected', hasHeader, false);
  eq('import: positional row kept', rows[0]?.name, 'Fin strap');
  eq('import: positional type', rows[0]?.type, 'part');
  eq('import: positional lowStockAt', rows[0]?.lowStockAt, 1);
}

// --- import: quoting, so a comma in notes does not shift every later column ---
{
  const text = 'name,notes\n"Brush, stiff","Use on hull, not props"';
  const { rows } = parseInventoryImport(text);
  eq('import: quoted delimiter in name', rows[0]?.name, 'Brush, stiff');
  eq('import: quoted delimiter in notes', rows[0]?.notes, 'Use on hull, not props');
}
{
  const { rows } = parseInventoryImport('name,notes\nGauge,"He said ""ok"""');
  eq('import: doubled quote unescapes', rows[0]?.notes, 'He said "ok"');
}

// --- import: rejections are reported, never silently written ---
{
  const { rows, errors } = parseInventoryImport('name,type,quantity\n,item,3\nGood item,item,1');
  eq('import: nameless row skipped', rows.map((r) => r.name), ['Good item']);
  eq('import: nameless row explained with its line number', errors[0], 'Row 2: no name — skipped.');
}
{
  const { rows, errors } = parseInventoryImport('name,type,quantity\nMystery,gizmo,1');
  eq('import: unknown type is refused, not defaulted', rows.length, 0);
  eq('import: unknown type explained', errors[0], 'Row 2: unknown type “gizmo” — use item, part or tool.');
}
{
  const { rows, errors } = parseInventoryImport('sku,notes\nA-1,hello');
  eq('import: a header with no name column imports nothing', rows.length, 0);
  eq('import: and says why', errors[0], 'No name column found. Include a “name” (or “item”) column.');
}

// --- import: blank lines, trailing newline, empty input ---
{
  const { rows } = parseInventoryImport('name,quantity\nA,1\n\n\nB,2\n');
  eq('import: blank lines ignored', rows.map((r) => r.name), ['A', 'B']);
}
eq('import: empty paste is empty, not an error', parseInventoryImport('   '), { rows: [], errors: [], hasHeader: false });

// --- import: the row cap holds (a wizard, not a migration tool) ---
{
  const lines = ['name,quantity'];
  for (let i = 0; i < IMPORT_MAX_ROWS + 10; i++) lines.push(`Item ${i},1`);
  const { rows, errors } = parseInventoryImport(lines.join('\n'));
  eq('import: capped at IMPORT_MAX_ROWS', rows.length, IMPORT_MAX_ROWS);
  eq('import: cap is reported', errors.length, 1);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
