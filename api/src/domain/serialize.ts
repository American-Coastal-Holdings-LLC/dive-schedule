import { InventoryItem, Job, LedgerEntry, ServiceRecord } from '@prisma/client';
import { invHasLowStock, invTypeOf } from '../inventory/inventory-domain';
import { dueStatus } from './dates';

// --- security/format helpers (ported verbatim from the seed) ---

// Prisma Decimal | number | string -> finite number (0 on garbage).
export function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && typeof (v as { toNumber?: () => number }).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

// Only genuine image data URLs (defends stored photo strings against HTML/JS injection).
export function isSafePhoto(s: unknown): boolean {
  return typeof s === 'string' && /^data:image\/(png|jpe?g|gif|webp|bmp);/i.test(s);
}

// Only http(s) links — blocks javascript: and other script-y schemes. The seed
// resolved relative to location.href; the backend requires an absolute URL.
export function safeUrl(u: unknown): string {
  try {
    const proto = new URL(String(u)).protocol;
    return proto === 'http:' || proto === 'https:' ? String(u) : '';
  } catch {
    return '';
  }
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export interface SerializeJobOpts {
  nameById: Map<string, string>;
  canPrice: boolean;
  tz: string;
}

// A Job payload for the client. assignedUserIds resolved to {id,name} via the
// directory; price stripped when the caller lacks dive.jobs.view-pricing; a
// tenant-tz-computed dueStatus attached for the board chips.
export function serializeJob(job: Job, opts: SerializeJobOpts): Record<string, unknown> {
  const assignedIds = asArray<string>(job.assignedUserIds).filter((x) => typeof x === 'string');
  const out: Record<string, unknown> = {
    id: job.id,
    site: job.site,
    boat: job.boat,
    ownerName: job.ownerName,
    customerEmail: job.customerEmail,
    footage: num(job.footage),
    rotation: job.rotation,
    dueDate: job.dueDate,
    dueStatus: dueStatus(job.dueDate, opts.tz),
    status: job.status,
    notes: job.notes,
    videos: asArray(job.videos),
    assignedUserIds: assignedIds,
    // Resolved {id,name} for display. Emitted under both keys: `assignedUsers`
    // (what the web reads) and `assignedCrew` (documented API convenience alias).
    assignedUsers: assignedIds.map((id) => ({ id, name: opts.nameById.get(id) || id })),
    assignedCrew: assignedIds.map((id) => ({ id, name: opts.nameById.get(id) || id })),
    completedBy: job.completedBy ?? null,
    completedByName:
      job.completedByName ??
      (job.completedBy ? opts.nameById.get(job.completedBy) ?? null : null),
    completedAt: iso(job.completedAt),
    completionNote: job.completionNote,
    completionPhoto: job.completionPhoto,
    checkAnswers: asArray(job.checkAnswers),
    certified: job.certified,
    certifiedAt: iso(job.certifiedAt),
    createdAt: iso(job.createdAt),
    updatedAt: iso(job.updatedAt),
  };
  if (opts.canPrice) out.price = num(job.price);
  return out;
}

export function serializeRecord(
  rec: ServiceRecord,
  opts: { canPrice: boolean },
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: rec.id,
    jobId: rec.jobId,
    site: rec.site,
    boat: rec.boat,
    ownerName: rec.ownerName,
    customerEmail: rec.customerEmail,
    diverNames: rec.diverNames,
    completedBy: rec.completedBy ?? null,
    completedByName: rec.completedByName ?? null,
    completedAt: iso(rec.completedAt),
    rotation: rec.rotation,
    footage: num(rec.footage),
    note: rec.note,
    photo: rec.photo,
    certified: rec.certified,
    certifiedAt: iso(rec.certifiedAt),
    answers: asArray(rec.answers),
    sent: rec.sent,
    sentAt: iso(rec.sentAt),
    sentTo: rec.sentTo,
    createdAt: iso(rec.createdAt),
  };
  if (opts.canPrice) out.price = num(rec.price);
  return out;
}

export function serializeItem(item: InventoryItem): Record<string, unknown> {
  return {
    id: item.id,
    name: item.name,
    // Normalised on the way out so a row written before the type vocabulary settled still lands in
    // one of the three filter chips instead of none of them.
    type: invTypeOf(item.type),
    quantity: item.quantity,
    unitCost: num(item.unitCost),
    salePrice: num(item.salePrice),
    sku: item.sku,
    lowStockAt: item.lowStockAt,
    notes: item.notes,
    // Derived here rather than in the browser: the UI reads these flags, so there is exactly one
    // definition of "low" and it is the server's.
    lowStock: invHasLowStock(item),
    sellable: num(item.salePrice) > 0,
  };
}

export function serializeLedger(entry: LedgerEntry): Record<string, unknown> {
  return {
    id: entry.id,
    kind: entry.kind,
    amount: num(entry.amount),
    description: entry.description,
    category: entry.category,
    date: entry.date,
  };
}
