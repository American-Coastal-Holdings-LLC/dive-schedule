// Display + formatting helpers. The money/date/status helpers are ported VERBATIM from the seed
// (legacy/reference/seed-domain-logic.js) so the UI reads identically; field names are adapted to
// the restructured API payloads (e.g. record.owner -> record.ownerName). Heavy domain logic
// (rotation math, pay computation, totals) lives server-side in the API and is NOT duplicated here.

import type { Rotation, ServiceRecord } from './types';

// Coerce a Prisma Decimal (serialized as string) or number to a finite number.
export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return isFinite(n) ? n : 0;
};

// ----- money (verbatim) -----
export const money = (v: unknown): string => {
  const n = parseFloat(String(v));
  if (!isFinite(n)) return '$0';
  const abs = Math.abs(n);
  const s = abs.toLocaleString('en-US', {
    minimumFractionDigits: abs % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return (n < 0 ? '-$' : '$') + s;
};

// ----- dates (verbatim) -----
export const formatDate = (val: string | null | undefined): string => {
  if (!val) return '';
  // Parse date-only strings ("2026-07-15") as local time to avoid off-by-one.
  const d = String(val).length <= 10 ? new Date(val + 'T00:00:00') : new Date(val);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

// Formats an instant (completedAt/sentAt/certifiedAt) for reports & banners. The seed referenced
// formatWhen() from recordText; this is the natural implementation (date + time).
export const formatWhen = (val: string | null | undefined): string => {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

export const rotationLabel = (r: Rotation | string | null | undefined): string =>
  r === 'biweekly' ? 'Bi-weekly' : r === 'monthly' ? 'Monthly' : r === 'bimonthly' ? 'Bi-monthly' : 'Weekly';

export const initials = (name: string | null | undefined): string => {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};

// Only allow http(s) links — blocks javascript: and other script-y schemes (verbatim intent).
export const safeUrl = (u: string | null | undefined): string => {
  if (!u) return '';
  try {
    const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost';
    const proto = new URL(u, base).protocol;
    return proto === 'http:' || proto === 'https:' ? u : '';
  } catch {
    return '';
  }
};

// Only allow genuine image data URLs to be rendered inline.
export const isSafePhoto = (s: string | null | undefined): boolean =>
  typeof s === 'string' && /^data:image\/(png|jpe?g|gif|webp|bmp);/i.test(s);

export interface DueStatus {
  kind: 'overdue' | 'due-soon' | 'due-ok';
  label: string;
}

// ----- dueStatus (verbatim) -----
export const dueStatus = (dueDate: string | null | undefined): DueStatus | null => {
  if (!dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + 'T00:00:00');
  if (isNaN(due.getTime())) return null;
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { kind: 'overdue', label: days === -1 ? 'Overdue by 1 day' : `Overdue by ${-days} days` };
  if (days === 0) return { kind: 'due-soon', label: 'Due today' };
  if (days === 1) return { kind: 'due-soon', label: 'Due tomorrow' };
  if (days <= 7) return { kind: 'due-soon', label: `Due in ${days} days` };
  return { kind: 'due-ok', label: `Due in ${days} days` };
};

// ----- recordText (verbatim; owner -> ownerName) -----
// Plain-text rendering of a dive record, used by the Records "Copy" action.
export const recordText = (r: ServiceRecord): string => {
  const L = ['DIVE SERVICE RECORD'];
  const head = [r.boat, r.site].filter(Boolean).join(' — ');
  if (head) L.push(head);
  L.push('');
  const add = (k: string, v: string | null | undefined) => {
    if (v) L.push(`${k}: ${v}`);
  };
  add('Owner', r.ownerName);
  add('Completed by', r.completedByName || '');
  add('Divers', r.diverNames);
  add('Date completed', formatWhen(r.completedAt));
  add('Rotation', rotationLabel(r.rotation));
  if (r.footage) add('Boat length', r.footage + ' ft');
  if (r.price != null && num(r.price) > 0) add('Price', '$' + r.price);
  if (r.answers && r.answers.length) {
    L.push('');
    L.push('Checklist:');
    r.answers.forEach((a) => L.push(`  • ${a.q}  ${a.a}`));
  }
  if (r.note) {
    L.push('');
    L.push(`Notes: ${r.note}`);
  }
  if (r.certified) L.push(`Certified: yes${r.certifiedAt ? ' (' + formatWhen(r.certifiedAt) + ')' : ''}`);
  return L.join('\n');
};

// ----- daysSince (verbatim) -----
export const daysSince = (startISO: string | null | undefined): number => {
  if (!startISO) return 0;
  const start = String(startISO).length <= 10 ? new Date(startISO + 'T00:00:00') : new Date(startISO);
  if (isNaN(start.getTime())) return 0;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((now.getTime() - start.getTime()) / 86400000));
};

// Today as YYYY-MM-DD in local calendar terms (for date input defaults).
export const todayISO = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
