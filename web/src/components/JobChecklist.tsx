'use client';

// The inspection checklist as a diver actually fills it in: typed controls, grouped into sections,
// with the template's header rows removed.
//
// Ported from the standalone build (dive-schedule-update_2 @ db8d22c), which had moved well past
// the free-text row this plugin inherited from the seed. Two things it fixes:
//
//  1. Template headers ("Areas lacking paint", "Electrolysis / rust / corrosion") were stored as
//     ordinary rows, so they rendered as questions nobody could answer and completion never hit
//     100%. organizeJobChecklistSections drops them and uses them to open a section instead.
//  2. Percent and severity answers were free text, so "50", "50%" and "half" all landed in the
//     same column. They are now selects, and the server re-normalises on write anyway.
//
// All rules live in lib/inspection.ts (mirrored from api/src/checklist/inspection.ts). Nothing here
// decides what a question means — this file only renders what that module reports.

import {
  chkDisplayLabel,
  chkKindOf,
  chkOptionsOf,
  organizeJobChecklistSections,
  type ChecklistQuestion,
} from '@/lib/inspection';

interface Props {
  questions: ChecklistQuestion[];
  answers: Record<string, string>;
  canComplete: boolean;
  onAnswerChange: (id: string, value: string) => void;
  onAnswerBlur: () => void;
}

function Answer({
  q,
  value,
  canComplete,
  onAnswerChange,
  onAnswerBlur,
}: {
  q: ChecklistQuestion;
  value: string;
  canComplete: boolean;
  onAnswerChange: (id: string, value: string) => void;
  onAnswerBlur: () => void;
}) {
  const id = q.id as string;
  const label = chkDisplayLabel(q.text ?? '');

  if (!canComplete) {
    return (
      <div className="chk-answer chk-answer-ro">{value || '—'}</div>
    );
  }

  const kind = chkKindOf(q);

  if (kind === 'checkbox') {
    // Stored as "Yes"/"" so a saved record reads the same as it always did.
    return (
      <input
        type="checkbox"
        className="chk-check"
        checked={value === 'Yes'}
        onChange={(e) => {
          onAnswerChange(id, e.target.checked ? 'Yes' : '');
          onAnswerBlur();
        }}
        aria-label={label}
      />
    );
  }

  if (kind === 'percent' || kind === 'select') {
    const options = chkOptionsOf(q);

    // PRESERVE AN OFF-LIST ANSWER. Kind is inferred from question text, so a question that has
    // always been free text can start rendering as a select — "Anodes / zincs checked and rated"
    // matches the anode rule and becomes a percent, while its stored answer is "Yes". A plain
    // select would show blank, and the diver would silently lose an answer they had already given
    // (and re-certify a record that no longer says what they recorded). Carrying the stored value
    // as an extra option keeps the data and makes the mismatch visible instead.
    const hasStored = value !== '' && !options.includes(value);

    return (
      <select
        className="chk-answer"
        value={value}
        onChange={(e) => {
          onAnswerChange(id, e.target.value);
          onAnswerBlur(); // a select has no meaningful "still typing" state — save immediately
        }}
        aria-label={label}
      >
        <option value="">—</option>
        {hasStored ? <option value={value}>{value} (previously recorded)</option> : null}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      className="chk-answer"
      value={value}
      onChange={(e) => onAnswerChange(id, e.target.value)}
      onBlur={onAnswerBlur}
      placeholder="—"
      aria-label={label}
    />
  );
}

export function JobChecklist({ questions, answers, canComplete, onAnswerChange, onAnswerBlur }: Props) {
  const { sections, anodes, anodeHeading } = organizeJobChecklistSections(questions);

  const row = (q: ChecklistQuestion) => (
    <div className="chk-row" key={q.id}>
      <div className="chk-q">{chkDisplayLabel(q.text ?? '')}</div>
      <Answer
        q={q}
        value={answers[q.id as string] ?? ''}
        canComplete={canComplete}
        onAnswerChange={onAnswerChange}
        onAnswerBlur={onAnswerBlur}
      />
    </div>
  );

  const nothingToAnswer = !sections.some((s) => s.items.length) && anodes.length === 0;
  if (nothingToAnswer) return null;

  return (
    <>
      {sections.map((s, i) => (
        <div key={s.heading?.id ?? `section-${i}`}>
          {s.heading ? <div className="chk-section">{s.heading.text}</div> : null}
          {s.items.map(row)}
        </div>
      ))}

      {anodes.length ? (
        <div>
          {/* Anodes are scattered through the template but checked in one pass on the boat, so
              they are collected into a single group regardless of where they appeared. */}
          <div className="chk-section">{anodeHeading?.text ?? 'Anodes'}</div>
          {anodes.map(row)}
        </div>
      ) : null}
    </>
  );
}
