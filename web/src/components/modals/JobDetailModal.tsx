'use client';

// Job detail. Shows the boat, its due status, videos and notes; an editable checklist (answers save
// debounced 600ms while typing and immediately on blur via PUT /answers); a certify signature (PUT
// /certify); a complete flow with a client-resized proof photo (POST /complete); and — with
// dive.jobs.manage — edit and reopen. Pricing is shown only with dive.jobs.view-pricing (the field
// is also absent from the payload otherwise). Everything here re-syncs the unsent record server-side.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useResource } from '@/lib/hooks';
import type { ChecklistQuestion, CrewMember, Job } from '@/lib/types';
import { dueStatus, formatDate, formatWhen, isSafePhoto, money, num, rotationLabel, safeUrl } from '@/lib/format';
import { fileToResizedDataUrl } from '@/lib/photo';
import { Modal } from '../Modal';
import { Icon } from '../Icon';
import { DataImg } from '../common';
import { usePlatform } from '../PlatformProvider';
import { usePermissions } from '../PermissionsProvider';
import { PERMISSIONS as P } from '@/lib/permissions';

export function JobDetailModal({
  job,
  onClose,
  onEdit,
}: {
  job: Job;
  onClose: () => void;
  onEdit: (job: Job) => void;
}) {
  const { toast } = usePlatform();
  const { me, can } = usePermissions();
  const canManage = can(P.JOBS_MANAGE);
  const canComplete = can(P.JOBS_COMPLETE);
  const canViewPricing = can(P.JOBS_VIEW_PRICING);

  const checklist = useResource<{ questions: ChecklistQuestion[] }>('/api/checklist');
  const questions = useMemo(() => checklist.data?.questions ?? [], [checklist.data]);
  const crew = useResource<{ crew: CrewMember[] }>(canManage ? '/api/crew' : null);

  const completed = job.status === 'completed';
  const [view, setView] = useState<'detail' | 'complete'>('detail');
  const [busy, setBusy] = useState(false);

  // ----- checklist answers (debounced) -----
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const map: Record<string, string> = {};
    for (const q of questions) {
      const prev = (job.checkAnswers ?? []).find((a) => a.id === q.id || a.q === q.text);
      map[q.id] = prev?.a ?? '';
    }
    setAnswers(map);
  }, [questions, job.checkAnswers]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const flushAnswers = useCallback(
    async (map: Record<string, string>) => {
      if (!canComplete) return;
      const payload = questions.map((q) => ({ id: q.id, q: q.text, a: map[q.id] ?? '' }));
      try {
        await api.put(`/api/jobs/${job.id}/answers`, { answers: payload }, { quiet: true });
      } catch {
        /* best-effort; a final flush happens before completion */
      }
    },
    [questions, job.id, canComplete],
  );

  const onAnswerChange = (qid: string, val: string) => {
    setAnswers((prev) => {
      const next = { ...prev, [qid]: val };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => flushAnswers(next), 600);
      return next;
    });
  };
  const onAnswerBlur = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    flushAnswers(answersRef.current);
  };

  // ----- certify -----
  const [certified, setCertified] = useState(!!job.certified);
  useEffect(() => setCertified(!!job.certified), [job.certified]);
  const toggleCertify = async () => {
    if (!canComplete) return;
    const next = !certified;
    setCertified(next);
    try {
      await api.put(`/api/jobs/${job.id}/certify`, { certified: next }, { quiet: true });
    } catch {
      setCertified(!next);
      toast('Couldn’t update certification.');
    }
  };

  // ----- complete flow -----
  const [cBy, setCBy] = useState(me.user.id);
  const [cNote, setCNote] = useState('');
  const [cPhoto, setCPhoto] = useState('');
  const [cVideo, setCVideo] = useState('');

  const onCompletePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setCPhoto(await fileToResizedDataUrl(file));
    } catch {
      toast('Couldn’t process that image.');
    }
  };

  const submitComplete = async () => {
    if (busy) return;
    setBusy(true);
    // Land any pending checklist edit first so the record snapshots the full checklist.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await flushAnswers(answersRef.current);
    const body: Record<string, unknown> = { note: cNote.trim(), photo: cPhoto, videoUrl: cVideo.trim() };
    if (canManage && cBy && cBy !== me.user.id) body.onBehalfOfUserId = cBy;
    try {
      await api.post(`/api/jobs/${job.id}/complete`, body);
      toast('Job marked complete');
      onClose();
    } catch {
      setBusy(false);
    }
  };

  const reopen = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/api/jobs/${job.id}/reopen`);
      toast('Reopened for its next rotation');
      onClose();
    } catch {
      setBusy(false);
    }
  };

  const status = dueStatus(job.dueDate);
  const assignedNames = job.assignedUsers?.map((u) => u.name).filter(Boolean) ?? [];
  const title = job.boat || job.site || 'Job';

  // ---------- complete sub-view ----------
  if (view === 'complete') {
    const crewOptions = (() => {
      const list = crew.data?.crew ?? [];
      const has = list.some((c) => c.id === me.user.id);
      const base = has ? list : [{ id: me.user.id, name: me.user.name } as CrewMember, ...list];
      return base;
    })();
    return (
      <Modal
        title="Complete job"
        onClose={() => setView('detail')}
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => setView('detail')} disabled={busy}>
              Back
            </button>
            <button className="btn btn-primary" onClick={submitComplete} disabled={busy}>
              <Icon name="check" /> Mark completed
            </button>
          </>
        }
      >
        {canManage ? (
          <>
            <label htmlFor="cmp-by">Completed by</label>
            <select id="cmp-by" value={cBy} onChange={(e) => setCBy(e.target.value)}>
              {crewOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id === me.user.id ? `${c.name} (you)` : c.name}
                </option>
              ))}
            </select>
          </>
        ) : null}

        <div className="photo-uploader">
          <div className="photo-preview">{isSafePhoto(cPhoto) ? <DataImg src={cPhoto} /> : <Icon name="camera" />}</div>
          <div className="photo-actions">
            <label className="btn btn-secondary btn-mini" style={{ marginBottom: 0 }}>
              <Icon name="camera" /> {cPhoto ? 'Replace photo' : 'Add proof photo'}
              <input type="file" accept="image/*" onChange={onCompletePhoto} style={{ display: 'none' }} />
            </label>
            {cPhoto ? (
              <button className="btn btn-secondary btn-mini" onClick={() => setCPhoto('')}>
                Remove
              </button>
            ) : null}
          </div>
        </div>

        <label htmlFor="cmp-note">Completion note</label>
        <textarea id="cmp-note" value={cNote} onChange={(e) => setCNote(e.target.value)} placeholder="Optional" />

        <label htmlFor="cmp-video">Completion video link</label>
        <input id="cmp-video" value={cVideo} onChange={(e) => setCVideo(e.target.value)} placeholder="https://… (optional)" />
      </Modal>
    );
  }

  // ---------- detail view ----------
  const actionButtons: React.ReactNode[] = [];
  if (canManage) {
    actionButtons.push(
      <button key="edit" className="icon-btn" aria-label="Edit boat" onClick={() => onEdit(job)}>
        <Icon name="edit" />
      </button>,
    );
  }
  if (completed && canManage) {
    actionButtons.push(
      <button key="reopen" className="btn btn-secondary" onClick={reopen} disabled={busy}>
        <Icon name="rotate-ccw" /> Reopen
      </button>,
    );
  }
  if (!completed && canComplete) {
    actionButtons.push(
      <button key="complete" className="btn btn-primary" onClick={() => setView('complete')}>
        <Icon name="check" /> Mark complete
      </button>,
    );
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      actions={actionButtons.length ? <>{actionButtons}</> : undefined}
    >
      {completed ? (
        <div className="done-banner">
          <Icon name="check-circle" />
          <div>
            <div className="db-title">Completed{job.completedByName ? ` by ${job.completedByName}` : ''}</div>
            {job.completedAt ? <div className="db-sub">{formatWhen(job.completedAt)}</div> : null}
          </div>
        </div>
      ) : null}

      <div className="dl">
        <div className="k">Boat</div>
        <div className="v big">{title}</div>
      </div>

      {job.site ? (
        <div className="dl">
          <div className="k">Site / marina</div>
          <div className="v">{job.site}</div>
        </div>
      ) : null}

      {status ? (
        <div className="dl">
          <div className="k">Schedule</div>
          <div className="v" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className={`chip ${status.kind}`}>
              <Icon name="calendar" />
              {status.label}
            </span>
            <span style={{ color: 'var(--ink-mute)' }}>
              {rotationLabel(job.rotation)} · due {formatDate(job.dueDate)}
            </span>
          </div>
        </div>
      ) : null}

      {job.ownerName ? (
        <div className="dl">
          <div className="k">Owner</div>
          <div className="v">{job.ownerName}</div>
        </div>
      ) : null}

      {canManage && job.customerEmail ? (
        <div className="dl">
          <div className="k">Customer email</div>
          <div className="v">{job.customerEmail}</div>
        </div>
      ) : null}

      <div className="dl">
        <div className="k">Hull length</div>
        <div className="v">{num(job.footage) > 0 ? `${job.footage} ft` : '—'}</div>
      </div>

      {canViewPricing && job.price != null ? (
        <div className="dl">
          <div className="k">Price</div>
          <div className="v">{money(job.price)}</div>
        </div>
      ) : null}

      {assignedNames.length ? (
        <div className="dl">
          <div className="k">Assigned crew</div>
          <div className="v">{assignedNames.join(', ')}</div>
        </div>
      ) : null}

      {job.videos?.length ? (
        <div className="dl">
          <div className="k">Videos</div>
          <div className="v">
            {job.videos.map((vid, i) => {
              const href = safeUrl(vid.url);
              if (!href) return null;
              return (
                <a className="video-link" key={i} href={href} target="_blank" rel="noopener noreferrer">
                  <Icon name="video" />
                  {vid.title || 'Video'}
                </a>
              );
            })}
          </div>
        </div>
      ) : null}

      {job.notes ? (
        <div className="dl">
          <div className="k">Notes</div>
          <div className="v">{job.notes}</div>
        </div>
      ) : null}

      {completed && job.completionNote ? (
        <div className="dl">
          <div className="k">Completion note</div>
          <div className="v">{job.completionNote}</div>
        </div>
      ) : null}

      {completed && isSafePhoto(job.completionPhoto) ? (
        <div className="dl">
          <div className="k">Proof photo</div>
          <div className="proof-photo">
            <DataImg src={job.completionPhoto} alt="Proof of service" />
          </div>
        </div>
      ) : null}

      {/* ----- checklist ----- */}
      {questions.length ? (
        <div className="dl job-chk">
          <div className="k">Inspection checklist</div>
          {questions.map((q) => (
            <div className="chk-row" key={q.id}>
              <div className="chk-q">{q.text}</div>
              {canComplete ? (
                <input
                  className="chk-answer"
                  value={answers[q.id] ?? ''}
                  onChange={(e) => onAnswerChange(q.id, e.target.value)}
                  onBlur={onAnswerBlur}
                  placeholder="—"
                  aria-label={q.text}
                />
              ) : (
                <div className="chk-answer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {answers[q.id] || '—'}
                </div>
              )}
            </div>
          ))}

          {canComplete ? (
            <label className={certified ? 'cert-row on' : 'cert-row'}>
              <input type="checkbox" checked={certified} onChange={toggleCertify} />
              <span>
                Certify this service
                {certified && job.certifiedAt ? <em>Certified {formatWhen(job.certifiedAt)}</em> : null}
              </span>
            </label>
          ) : certified ? (
            <div className="done-banner" style={{ marginTop: 12 }}>
              <Icon name="check-circle" />
              <div>
                <div className="db-title">Certified</div>
                {job.certifiedAt ? <div className="db-sub">{formatWhen(job.certifiedAt)}</div> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
