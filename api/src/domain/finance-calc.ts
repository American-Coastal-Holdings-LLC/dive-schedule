import { Job, LedgerEntry, ServiceRecord } from '@prisma/client';
import { instantToCivil } from './dates';
import { num } from './serialize';

// ===========================================================================
// totalsSince — ported verbatim from the seed. Money-in = priced dive records
// (by completion date) + manual "in" ledger entries + completed jobs that don't
// yet have a record (deduped by job id so a just-completed job isn't double
// counted). Money-out = manual "out" ledger entries. Bounds are civil dates in
// the tenant timezone (inclusive of both cutoff and now).
// ===========================================================================
export interface FinanceContext {
  ledger: LedgerEntry[];
  records: ServiceRecord[];
  jobs: Job[]; // completed jobs
  tz: string;
}

export interface Totals {
  in: number;
  out: number;
  net: number;
}

export function totalsSince(cutoff: string, now: string, ctx: FinanceContext): Totals {
  let inSum = 0;
  let outSum = 0;

  for (const l of ctx.ledger) {
    const c = l.date;
    if (!c || c < cutoff || c > now) continue;
    const amt = num(l.amount);
    if (l.kind === 'out') outSum += amt;
    else inSum += amt;
  }

  const recordedJobIds = new Set<string>();
  for (const r of ctx.records) {
    if (r.jobId) recordedJobIds.add(r.jobId);
    const price = num(r.price);
    if (!(price > 0)) continue;
    const c = instantToCivil(r.completedAt, ctx.tz);
    if (!c || c < cutoff || c > now) continue;
    inSum += price;
  }

  for (const t of ctx.jobs) {
    if (t.status !== 'completed') continue;
    if (t.id && recordedJobIds.has(t.id)) continue; // already counted via its record
    const price = num(t.price);
    if (!(price > 0)) continue;
    const c = instantToCivil(t.completedAt, ctx.tz) || t.dueDate;
    if (!c || c < cutoff || c > now) continue;
    inSum += price;
  }

  return { in: inSum, out: outSum, net: inSum - outSum };
}
