// Inspection checklist domain — ported from the standalone build (dive-schedule-update_2,
// steep-voice-runtime, commit db8d22c), which is ahead of the seed this plugin was built from.
//
// WHAT THIS MODEL IS. A hull-cleaning checklist is not a list of free-text questions. It is a
// typed inspection form whose control is a function of the question text: percentages for paint
// coverage and anode wear, a severity scale for corrosion, checkboxes for through-holes, and
// heading rows that structure the form rather than asking anything. chkKindOf() is that mapping.
//
// WHY INFERENCE AND NOT JUST A COLUMN. Every stored question is plain text today, so a schema
// column alone would leave existing rows untyped. chkKindOf() prefers an explicit `kind` when one
// exists and falls back to inferring from the text, which means old rows and new rows render
// identically and no backfill is required to get correct behaviour.
//
// FRONTEND COPY of api/src/checklist/inspection.ts — same rules, same order, kept in lock-step the
// way permissions.ts already is. The server is authoritative: it re-derives kind and re-normalises
// every answer on write, so a divergence here is a rendering bug, never a data-integrity one.

/** Paint coverage / anode wear, in 10% steps. */
export const PERCENT_OPTIONS = [
  '0%', '10%', '20%', '30%', '40%', '50%', '60%', '70%', '80%', '90%', '100%',
] as const;

/** Corrosion severity scale. */
export const CORROSION_SEVERITY_OPTIONS = ['None', 'Light', 'Moderate', 'Severe'] as const;

/** The hull areas an inspection is broken down by. */
export const INSPECTION_AREAS = [
  'Hull', 'Water Line', 'Transom', 'Keel', 'Rudder', 'Pod Drives', 'Hydraulic Swim Platform',
] as const;

/** Where on the hull a finding is located. */
export const HULL_PART_OPTIONS = [
  'None', 'Bow', 'Port bow', 'Starboard bow', 'Port side', 'Starboard side', 'Keel',
  'Waterline', 'Amidships', 'Stern', 'Transom', 'Rudder', 'Multiple areas',
] as const;

export type ChecklistKind = 'heading' | 'checkbox' | 'percent' | 'select' | 'text';

export interface ChecklistQuestion {
  id?: string;
  /** Question text. `q` is the legacy field name from the seed's saved answers. */
  text?: string;
  q?: string;
  /** Explicit kind, when stored. Takes precedence over inference. */
  kind?: ChecklistKind;
  /** Explicit options, when stored. Takes precedence over the derived list. */
  options?: string[];
}

const questionText = (q: ChecklistQuestion | null | undefined): string =>
  String((q && (q.text ?? q.q)) ?? '').trim();

/**
 * THE FIX this port exists for.
 *
 * The stock template ships section HEADERS as ordinary rows — "Areas lacking paint", "Paint
 * condition", "Electrolysis / rust / corrosion". Rendered naively they appear as questions the
 * diver is expected to answer, so every inspection carried three permanently-blank rows and the
 * completion count could never reach 100%. These are structure, not questions: they are dropped
 * from the answerable set and used to open a section instead.
 */
export function chkIsPaintCorrosionTemplateNoise(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  return (
    /^areas lacking paint$/i.test(t) ||
    /^area is lacking paint$/i.test(t) ||
    /^lacking paint\b/i.test(t) ||
    /^paint condition\b/i.test(t) ||
    /^electrolysis\s*\/\s*rust\s*\/\s*corrosion\b/i.test(t)
  );
}

/** True for a row naming a specific anode (not the "Anodes" heading, not a paint/corrosion row). */
export function chkIsAnodeItem(text: string): boolean {
  const t = String(text || '').trim();
  if (!t || /^anodes?$/i.test(t)) return false;
  // Paint/corrosion wording can overlap with anode wording; those rows are never anodes.
  if (chkIsPaintCorrosionTemplateNoise(t)) return false;
  return /\banodes?\b/i.test(t);
}

/** Which control this question renders as. Explicit `kind` wins; otherwise inferred from text. */
export function chkKindOf(q: ChecklistQuestion | null | undefined): ChecklistKind {
  if (q?.kind) return q.kind;
  const t = questionText(q);
  if (/^areas lacking paint$/i.test(t)) return 'heading';
  if (/^electrolysis\s*\/\s*rust\s*\/\s*corrosion$/i.test(t)) return 'heading';
  if (/^anodes?$/i.test(t)) return 'heading';
  if (/through holes/i.test(t)) return 'checkbox';
  if (/^lacking paint\b/i.test(t)) return 'checkbox';
  if (chkIsAnodeItem(t) || /bottom\s*paint/i.test(t) || /%\s*$/.test(t) || /\bpercent/i.test(t)) {
    return 'percent';
  }
  if (/electrolysis|rust|corrosion/i.test(t)) return 'select';
  if (/area is lacking/i.test(t)) return 'select';
  return 'text';
}

/** The option list for a question. Explicit `options` wins; otherwise derived from its kind. */
export function chkOptionsOf(q: ChecklistQuestion | null | undefined): string[] {
  if (q?.options?.length) return [...q.options];
  const kind = chkKindOf(q);
  if (kind === 'percent') return [...PERCENT_OPTIONS];
  if (kind !== 'select') return [];
  return /electrolysis|rust|corrosion/i.test(questionText(q))
    ? [...CORROSION_SEVERITY_OPTIONS]
    : [...HULL_PART_OPTIONS];
}

/**
 * Coerce a percent answer to canonical `N%` form, clamped 0-100.
 * Accepts "50", "50%", " 50 " — a diver typing on a phone on a dock produces all three.
 * Anything unparseable is returned untouched rather than destroyed.
 */
export function chkNormalizePercent(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^\d{1,3}%$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,3})\s*%?$/);
  if (!m) return raw;
  return `${Math.max(0, Math.min(100, Number(m[1])))}%`;
}

/**
 * Strip the template prefix for display. Stored text is fully qualified ("Lacking paint — Keel")
 * so it stands alone in a saved record; under its section heading only the area should show.
 */
export function chkDisplayLabel(text: string): string {
  const t = String(text || '').trim();
  for (const re of [
    /^Lacking paint\s*[—–-]\s*(.+)$/i,
    /^Paint condition\s*[—–-]\s*(.+)$/i,
    /^Electrolysis\s*\/\s*rust\s*\/\s*corrosion\s*[—–-]\s*(.+)$/i,
  ]) {
    const m = t.match(re);
    if (m) return m[1].trim();
  }
  const anode = t.match(/^(.+?)\s+anodes?\s*%?\s*$/i);
  return anode ? anode[1].trim() : t;
}

export const encodePaintAreasAnswer = (areas: string[]): string =>
  INSPECTION_AREAS.filter((a) => areas.includes(a)).join(', ');

export function parsePaintAreasAnswer(raw: unknown): string[] {
  const s = String(raw ?? '').trim();
  if (!s) return [];
  const out: string[] = [];
  for (const part of s.split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean)) {
    const hit = INSPECTION_AREAS.find((a) => a.toLowerCase() === part.toLowerCase());
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

export interface ChecklistSection {
  heading: ChecklistQuestion | null;
  items: ChecklistQuestion[];
}

export interface OrganizedChecklist {
  sections: ChecklistSection[];
  /** Anodes are collected across the whole form and presented as one group. */
  anodes: ChecklistQuestion[];
  anodeHeading: ChecklistQuestion | null;
}

/**
 * Group flat checklist rows into the sections the form actually has.
 *
 * Anodes are pulled out wherever they appear and shown as a single group — the template scatters
 * them, but a diver checks every anode in one pass, so a form that matches the template order
 * makes them hunt.
 */
export function organizeJobChecklistSections(
  rows: ChecklistQuestion[],
  isAnswerRowId: (id?: string) => boolean = () => false,
): OrganizedChecklist {
  const anodes: ChecklistQuestion[] = [];
  let anodeHeading: ChecklistQuestion | null = null;
  const rest: ChecklistQuestion[] = [];

  for (const r of rows) {
    const text = String(r.text ?? '').trim();
    if (chkIsPaintCorrosionTemplateNoise(text)) continue; // structure, never a question
    if (isAnswerRowId(r.id)) continue;
    if (chkKindOf(r) === 'heading' && /^anodes?$/i.test(text)) {
      anodeHeading = r;
      continue;
    }
    if (chkIsAnodeItem(text)) {
      anodes.push(r);
      continue;
    }
    rest.push(r);
  }

  const sections: ChecklistSection[] = [];
  let cur: ChecklistSection = { heading: null, items: [] };
  const flush = (): void => {
    if (cur.heading || cur.items.length) sections.push(cur);
    cur = { heading: null, items: [] };
  };

  for (const r of rest) {
    if (chkKindOf(r) === 'heading') {
      flush();
      cur = { heading: r, items: [] };
    } else {
      cur.items.push(r);
    }
  }
  flush();

  return { sections, anodes, anodeHeading };
}
