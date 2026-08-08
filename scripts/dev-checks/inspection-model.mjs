// Checks the ported inspection-checklist domain rules (api/src/checklist/inspection.ts).
//
//   npx tsx scripts/dev-checks/inspection-model.mjs
//
// The case that matters is TEMPLATE NOISE: the stock template ships section headers as ordinary
// rows, so rendered naively they become questions nobody can answer and completion never reaches
// 100%. Everything else here guards the inference table that decides which control each question
// renders as — get that wrong and a percent field becomes a free-text box.

import {
  chkIsPaintCorrosionTemplateNoise,
  chkIsAnodeItem,
  chkKindOf,
  chkOptionsOf,
  chkNormalizePercent,
  chkDisplayLabel,
  parsePaintAreasAnswer,
  encodePaintAreasAnswer,
  organizeJobChecklistSections,
  CORROSION_SEVERITY_OPTIONS,
  PERCENT_OPTIONS,
} from '../../api/src/checklist/inspection.ts';

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}\n        got  ${g}\n        want ${w}`); }
};

// --- the fix: template headers are structure, not questions ---
eq('noise: "Areas lacking paint"', chkIsPaintCorrosionTemplateNoise('Areas lacking paint'), true);
eq('noise: "Paint condition"', chkIsPaintCorrosionTemplateNoise('Paint condition'), true);
eq('noise: "Electrolysis / rust / corrosion"', chkIsPaintCorrosionTemplateNoise('Electrolysis / rust / corrosion'), true);
eq('noise: a real question is NOT noise', chkIsPaintCorrosionTemplateNoise('Through holes clear?'), false);

// --- control inference ---
eq('kind: anodes heading', chkKindOf({ text: 'Anodes' }), 'heading');
eq('kind: through holes -> checkbox', chkKindOf({ text: 'Through holes clear?' }), 'checkbox');
eq('kind: bottom paint -> percent', chkKindOf({ text: 'Bottom paint' }), 'percent');
eq('kind: trailing % -> percent', chkKindOf({ text: 'Keel anode %' }), 'percent');
eq('kind: corrosion -> select', chkKindOf({ text: 'Electrolysis / rust / corrosion — Keel' }), 'select');
eq('kind: fallback -> text', chkKindOf({ text: 'Notes for the owner' }), 'text');
eq('kind: explicit kind wins over inference', chkKindOf({ text: 'Bottom paint', kind: 'text' }), 'text');

// --- options ---
eq('options: corrosion severity', chkOptionsOf({ text: 'Electrolysis / rust / corrosion — Keel' }), [...CORROSION_SEVERITY_OPTIONS]);
eq('options: percent list', chkOptionsOf({ text: 'Bottom paint' }), [...PERCENT_OPTIONS]);
eq('options: explicit wins', chkOptionsOf({ text: 'Bottom paint', options: ['a', 'b'] }), ['a', 'b']);

// --- anodes ---
eq('anode: "Keel anode" is an item', chkIsAnodeItem('Keel anode'), true);
eq('anode: the "Anodes" heading is not an item', chkIsAnodeItem('Anodes'), false);
eq('anode: paint row is never an anode', chkIsAnodeItem('Lacking paint — anodes area'), false);

// --- percent coercion (a diver types all three of these) ---
eq('percent: "50" -> 50%', chkNormalizePercent('50'), '50%');
eq('percent: "50%" unchanged', chkNormalizePercent('50%'), '50%');
eq('percent: " 50 " -> 50%', chkNormalizePercent(' 50 '), '50%');
eq('percent: clamps over 100', chkNormalizePercent('150'), '100%');
eq('percent: empty stays empty', chkNormalizePercent(''), '');
eq('percent: unparseable is preserved, not destroyed', chkNormalizePercent('n/a'), 'n/a');

// --- display labels ---
eq('label: strips "Lacking paint —"', chkDisplayLabel('Lacking paint — Keel'), 'Keel');
eq('label: strips corrosion prefix', chkDisplayLabel('Electrolysis / rust / corrosion — Transom'), 'Transom');
eq('label: strips anode suffix', chkDisplayLabel('Keel anode %'), 'Keel');

// --- paint areas round-trip ---
eq('areas: parse', parsePaintAreasAnswer('Hull, Keel'), ['Hull', 'Keel']);
eq('areas: parse is case-insensitive + dedupes', parsePaintAreasAnswer('hull, HULL, keel'), ['Hull', 'Keel']);
eq('areas: unknown areas dropped', parsePaintAreasAnswer('Hull, Nonsense'), ['Hull']);
eq('areas: round-trip', encodePaintAreasAnswer(parsePaintAreasAnswer('Keel, Hull')), 'Hull, Keel');

// --- sectioning: the end-to-end shape ---
{
  const rows = [
    { id: '1', text: 'Areas lacking paint' },          // noise -> dropped
    { id: '2', text: 'Hull condition' },
    { id: '3', text: 'Anodes' },                       // anode heading
    { id: '4', text: 'Keel anode' },                   // anode item
    { id: '5', text: 'Electrolysis / rust / corrosion' }, // noise -> dropped
    { id: '6', text: 'Through holes clear?' },
  ];
  const { sections, anodes, anodeHeading } = organizeJobChecklistSections(rows);
  const flat = sections.flatMap((s) => s.items.map((i) => i.id));
  eq('sections: template noise removed', flat.includes('1') || flat.includes('5'), false);
  eq('sections: real questions kept', flat, ['2', '6']);
  eq('sections: anode item grouped', anodes.map((a) => a.id), ['4']);
  eq('sections: anode heading captured', anodeHeading?.id, '3');
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
