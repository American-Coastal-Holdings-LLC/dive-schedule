// ===========================================================================
// Calendar-date helpers — ported from the seed (legacy/reference/seed-domain-logic.js)
// and made TENANT-TIMEZONE aware per docs/ARCHITECTURE.md.
//
// The seed used device-local time. The backend has no single device tz, so:
//   * Civil dates ('YYYY-MM-DD') are anchored to UTC midnight for DST-free
//     arithmetic (add days / add months, weekday, Monday-week start).
//   * Instants (completedAt, ...) are projected into the tenant timezone with
//     Intl to read their civil date, so "which day did this happen on / which
//     pay week does it fall in" uses the tenant's clock, not the server's.
// This preserves the seed's intent exactly (its local-midnight math) while being
// authoritative about the tenant timezone.
// ===========================================================================

const pad = (n: number) => String(n).padStart(2, '0');

// Parse 'YYYY-MM-DD' (or a longer ISO string, first 10 chars) to a UTC-midnight
// anchor Date. Returns null if unusable.
export function parseCivil(val: string | null | undefined): Date | null {
  if (!val) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(val));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d.getTime()) ? null : d;
}

export function fmtCivil(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// Project an instant into the tenant tz and return its civil date 'YYYY-MM-DD'.
export function instantToCivil(
  instant: Date | string | null | undefined,
  tz: string,
): string | null {
  if (!instant) return null;
  const d = instant instanceof Date ? instant : new Date(instant);
  if (isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const y = parts.find((p) => p.type === 'year')?.value;
    const mo = parts.find((p) => p.type === 'month')?.value;
    const da = parts.find((p) => p.type === 'day')?.value;
    if (y && mo && da) return `${y}-${mo}-${da}`;
  } catch {
    /* fall through to UTC */
  }
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function todayCivil(tz: string): string {
  return instantToCivil(new Date(), tz) as string;
}

// Monday-based start of the week containing `civil`.
export function startOfWeekCivil(civil: string): string {
  const d = parseCivil(civil);
  if (!d) return civil;
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return fmtCivil(d);
}

export function startOfMonthCivil(civil: string): string {
  const d = parseCivil(civil);
  if (!d) return civil;
  return fmtCivil(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

export function startOfYearCivil(civil: string): string {
  const d = parseCivil(civil);
  if (!d) return civil;
  return fmtCivil(new Date(Date.UTC(d.getUTCFullYear(), 0, 1)));
}

export function addDaysCivil(civil: string, n: number): string {
  const d = parseCivil(civil);
  if (!d) return civil;
  d.setUTCDate(d.getUTCDate() + n);
  return fmtCivil(d);
}

// Add whole months without rolling into the next month when the target month is
// shorter (Jan 31 + 1 month -> Feb 28/29, not Mar 3). Verbatim clamp from seed.
export function addMonthsCivil(civil: string, n: number): string {
  const d = parseCivil(civil);
  if (!d) return civil;
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return fmtCivil(d);
}

export function diffDaysCivil(a: string, b: string): number {
  const da = parseCivil(a);
  const db = parseCivil(b);
  if (!da || !db) return 0;
  return Math.round((da.getTime() - db.getTime()) / 86400000);
}

// nextDueDate(rotation, anchor) — anchor is a civil date; falls back to today
// (in the tenant tz). Month rotations use the shorter-month clamp above.
export function nextDueDate(
  rotation: string,
  anchorCivil: string | null | undefined,
  tz: string,
): string {
  const base = (anchorCivil && parseCivil(anchorCivil)) || parseCivil(todayCivil(tz));
  const civil = fmtCivil(base as Date);
  if (rotation === 'biweekly') return addDaysCivil(civil, 14);
  if (rotation === 'monthly') return addMonthsCivil(civil, 1);
  if (rotation === 'bimonthly') return addMonthsCivil(civil, 2);
  return addDaysCivil(civil, 7); // weekly (default)
}

export interface DueStatus {
  kind: 'overdue' | 'due-soon' | 'due-ok';
  label: string;
}

export function dueStatus(dueDate: string, tz: string): DueStatus | null {
  if (!dueDate || !parseCivil(dueDate)) return null;
  const days = diffDaysCivil(dueDate, todayCivil(tz));
  if (days < 0)
    return {
      kind: 'overdue',
      label: days === -1 ? 'Overdue by 1 day' : `Overdue by ${-days} days`,
    };
  if (days === 0) return { kind: 'due-soon', label: 'Due today' };
  if (days === 1) return { kind: 'due-soon', label: 'Due tomorrow' };
  if (days <= 7) return { kind: 'due-soon', label: `Due in ${days} days` };
  return { kind: 'due-ok', label: `Due in ${days} days` };
}

// Monday-based pay week range (civil), offset in weeks from the current week.
export function payWeekRange(offset: number, tz: string): { start: string; endExcl: string } {
  const start = addDaysCivil(startOfWeekCivil(todayCivil(tz)), offset * 7);
  return { start, endExcl: addDaysCivil(start, 7) };
}

export function rotationLabel(rotation: string): string {
  if (rotation === 'biweekly') return 'Bi-weekly';
  if (rotation === 'monthly') return 'Monthly';
  if (rotation === 'bimonthly') return 'Bi-monthly';
  return 'Weekly';
}

// Human-readable instant, formatted in the tenant timezone.
export function formatWhen(instant: Date | string | null | undefined, tz: string): string {
  if (!instant) return '';
  const d = instant instanceof Date ? instant : new Date(instant);
  if (isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d);
  } catch {
    return d.toISOString();
  }
}
