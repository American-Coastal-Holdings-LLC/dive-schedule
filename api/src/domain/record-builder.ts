import { Job, Prisma } from '@prisma/client';
import { formatWhen, rotationLabel } from './dates';
import { num } from './serialize';

// ===========================================================================
// ServiceRecord snapshot logic — ported from the seed's buildRecordFromTrip /
// syncRecordFromTrip. A record is an immutable snapshot taken at completion.
// While UNSENT, later checklist/certify edits on the completed job re-sync it
// (so the report the customer receives is current). SENT records are frozen.
// ===========================================================================

interface AnswerLike {
  q?: unknown;
  a?: unknown;
}

function jobAnswers(job: Job): { q: string; a: string }[] {
  const raw = Array.isArray(job.checkAnswers) ? (job.checkAnswers as AnswerLike[]) : [];
  return raw
    .filter((x) => x && x.a)
    .map((x) => ({ q: String(x.q ?? ''), a: String(x.a ?? '') }));
}

export function diverNamesFor(
  assignedUserIds: unknown,
  nameById: Map<string, string>,
): string {
  const ids = Array.isArray(assignedUserIds) ? (assignedUserIds as string[]) : [];
  return ids
    .map((id) => nameById.get(id))
    .filter((n): n is string => Boolean(n))
    .join(', ');
}

// Full record snapshot for a freshly completed job (Prisma create input).
export function buildRecordData(
  job: Job,
  nameById: Map<string, string>,
): Prisma.ServiceRecordUncheckedCreateInput {
  return {
    installationId: job.installationId,
    jobId: job.id,
    site: job.site,
    boat: job.boat,
    ownerName: job.ownerName,
    customerEmail: job.customerEmail,
    diverNames: diverNamesFor(job.assignedUserIds, nameById),
    completedBy: job.completedBy ?? null,
    completedByName:
      job.completedByName ?? (job.completedBy ? nameById.get(job.completedBy) ?? null : null),
    completedAt: job.completedAt,
    rotation: job.rotation,
    price: job.price,
    footage: job.footage,
    note: job.completionNote,
    photo: job.completionPhoto,
    certified: !!job.certified,
    certifiedAt: job.certifiedAt ?? null,
    answers: jobAnswers(job),
    sent: false,
  };
}

// The mutable subset re-synced onto an UNSENT record when checklist/certify
// change after completion (mirrors the seed's syncRecordFromTrip write).
export function syncableFields(
  job: Job,
  nameById: Map<string, string>,
  existingPhoto: string,
): Prisma.ServiceRecordUpdateInput {
  return {
    answers: jobAnswers(job),
    certified: !!job.certified,
    certifiedAt: job.certifiedAt ?? null,
    note: job.completionNote,
    photo: job.completionPhoto || existingPhoto,
    diverNames: diverNamesFor(job.assignedUserIds, nameById),
    completedBy: job.completedBy ?? null,
    completedByName:
      job.completedByName ?? (job.completedBy ? nameById.get(job.completedBy) ?? null : null),
  };
}

// Plain-text service report (ported from the seed's recordText). Used for the
// mailto handoff body when a record is sent.
export interface RecordTextInput {
  boat: string;
  site: string;
  ownerName: string;
  completedByName: string | null;
  diverNames: string;
  completedAt: Date | null;
  rotation: string;
  footage: unknown;
  price: unknown;
  answers: unknown;
  note: string;
  certified: boolean;
  certifiedAt: Date | null;
}

export function recordText(r: RecordTextInput, tz: string): string {
  const lines: string[] = ['DIVE SERVICE RECORD'];
  const head = [r.boat, r.site].filter(Boolean).join(' — ');
  if (head) lines.push(head);
  lines.push('');
  const add = (k: string, v: string | number | null | undefined) => {
    if (v) lines.push(`${k}: ${v}`);
  };
  add('Owner', r.ownerName);
  add('Completed by', r.completedByName);
  add('Divers', r.diverNames);
  add('Date completed', r.completedAt ? formatWhen(r.completedAt, tz) : '');
  add('Rotation', rotationLabel(r.rotation));
  if (num(r.footage) > 0) add('Boat length', `${num(r.footage)} ft`);
  if (num(r.price) > 0) add('Price', `$${num(r.price)}`);
  const answers = Array.isArray(r.answers) ? (r.answers as { q: string; a: string }[]) : [];
  if (answers.length) {
    lines.push('');
    lines.push('Checklist:');
    answers.forEach((a) => lines.push(`  • ${a.q}  ${a.a}`));
  }
  if (r.note) {
    lines.push('');
    lines.push(`Notes: ${r.note}`);
  }
  if (r.certified) {
    lines.push(
      `Certified: yes${r.certifiedAt ? ` (${formatWhen(r.certifiedAt, tz)})` : ''}`,
    );
  }
  return lines.join('\n');
}
