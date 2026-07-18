'use client';

// Add / edit / delete a boat under service (dive.jobs.manage). Price is only shown/sent when the
// caller has dive.jobs.view-pricing (the server also strips/ignores it otherwise). Crew assignment
// uses the roster picker (needs the directory via GET /api/crew). POST /api/jobs or
// PATCH/DELETE /api/jobs/:id.

import { useState } from 'react';
import { api } from '@/lib/api';
import { useResource } from '@/lib/hooks';
import type { CrewMember, Job, JobVideo, Rotation } from '@/lib/types';
import { num } from '@/lib/format';
import { Modal } from '../Modal';
import { Icon } from '../Icon';
import { Avatar } from '../common';
import { usePlatform } from '../PlatformProvider';

const ROTATIONS: { value: Rotation; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'bimonthly', label: 'Bi-monthly' },
];

export function JobFormModal({
  job,
  canViewPricing,
  onClose,
  onSaved,
}: {
  job: Job | null;
  canViewPricing: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = usePlatform();
  const editing = !!job;
  const crew = useResource<{ crew: CrewMember[] }>('/api/crew');

  const [site, setSite] = useState(job?.site ?? '');
  const [boat, setBoat] = useState(job?.boat ?? '');
  const [ownerName, setOwnerName] = useState(job?.ownerName ?? '');
  const [customerEmail, setCustomerEmail] = useState(job?.customerEmail ?? '');
  const [footage, setFootage] = useState(job ? String(num(job.footage) || '') : '');
  const [price, setPrice] = useState(job && job.price != null ? String(num(job.price) || '') : '');
  const [rotation, setRotation] = useState<Rotation>(job?.rotation ?? 'weekly');
  const [dueDate, setDueDate] = useState(job?.dueDate ?? '');
  const [notes, setNotes] = useState(job?.notes ?? '');
  const [videos, setVideos] = useState<JobVideo[]>(job?.videos ?? []);
  const [vTitle, setVTitle] = useState('');
  const [vUrl, setVUrl] = useState('');
  const [assigned, setAssigned] = useState<string[]>(
    job?.assignedUserIds ?? job?.assignedUsers?.map((u) => u.id) ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const toggleAssign = (id: string) =>
    setAssigned((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const addVideo = () => {
    const url = vUrl.trim();
    if (!url) return;
    setVideos((v) => [...v, { title: vTitle.trim() || 'Video', url }]);
    setVTitle('');
    setVUrl('');
  };

  const save = async () => {
    if (!boat.trim() && !site.trim()) {
      toast('Add a boat or site name first.');
      return;
    }
    if (busy) return;
    setBusy(true);
    const body: Record<string, unknown> = {
      site: site.trim(),
      boat: boat.trim(),
      ownerName: ownerName.trim(),
      customerEmail: customerEmail.trim(),
      footage: num(footage),
      rotation,
      dueDate: dueDate.trim(),
      notes: notes.trim(),
      videos,
      assignedUserIds: assigned,
    };
    if (canViewPricing) body.price = num(price);
    try {
      if (editing) await api.patch(`/api/jobs/${job!.id}`, body);
      else await api.post('/api/jobs', body);
      toast(editing ? 'Boat saved' : 'Boat added');
      onSaved();
      onClose();
    } catch {
      setBusy(false);
    }
  };

  const del = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.del(`/api/jobs/${job!.id}`);
      toast('Boat deleted');
      onSaved();
      onClose();
    } catch {
      setBusy(false);
      setConfirmDel(false);
    }
  };

  const roster = crew.data?.crew ?? [];

  return (
    <Modal
      title={editing ? 'Edit boat' : 'Add boat'}
      onClose={onClose}
      actions={
        <>
          {editing ? (
            confirmDel ? (
              <button className="btn btn-danger" onClick={del} disabled={busy}>
                Confirm delete
              </button>
            ) : (
              <button className="icon-btn danger" aria-label="Delete boat" onClick={() => setConfirmDel(true)}>
                <Icon name="trash" />
              </button>
            )
          ) : null}
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {editing ? 'Save' : 'Add boat'}
          </button>
        </>
      }
    >
      <label htmlFor="jb-boat">Boat name</label>
      <input id="jb-boat" value={boat} onChange={(e) => setBoat(e.target.value)} placeholder="e.g. Sea Breeze" />

      <label htmlFor="jb-site">Site / marina</label>
      <input id="jb-site" value={site} onChange={(e) => setSite(e.target.value)} placeholder="e.g. Harbor Point" />

      <label htmlFor="jb-owner">Owner name</label>
      <input id="jb-owner" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Customer name" />

      <label htmlFor="jb-email">Customer email</label>
      <input
        id="jb-email"
        type="email"
        value={customerEmail}
        onChange={(e) => setCustomerEmail(e.target.value)}
        placeholder="customer@email.com"
      />

      <div style={{ display: 'grid', gridTemplateColumns: canViewPricing ? '1fr 1fr' : '1fr', gap: 12 }}>
        <div>
          <label htmlFor="jb-feet">Hull length (ft)</label>
          <input id="jb-feet" inputMode="decimal" value={footage} onChange={(e) => setFootage(e.target.value)} />
        </div>
        {canViewPricing ? (
          <div>
            <label htmlFor="jb-price">Price</label>
            <input id="jb-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
        ) : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label htmlFor="jb-rot">Rotation</label>
          <select id="jb-rot" value={rotation} onChange={(e) => setRotation(e.target.value as Rotation)}>
            {ROTATIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="jb-due">Next due</label>
          <input id="jb-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>

      <label>Assigned crew</label>
      {roster.length ? (
        <div className="pick-list">
          {roster.map((c) => {
            const on = assigned.includes(c.id);
            return (
              <button
                type="button"
                key={c.id}
                className={on ? 'pick-row on' : 'pick-row'}
                onClick={() => toggleAssign(c.id)}
              >
                <Avatar photo={c.photo} name={c.name} className="pick-av" />
                <div className="pick-main">
                  <div className="pick-name">{c.name}</div>
                  {c.certifications ? <div className="pick-sub">{c.certifications.split(',')[0]?.trim()}</div> : null}
                </div>
                <div className="pick-check">
                  <Icon name="check" />
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="pick-empty">
          {crew.error ? 'Crew roster unavailable — assignment needs crew access.' : 'No crew to assign yet.'}
        </div>
      )}

      <label>Videos</label>
      {videos.length ? (
        <div className="item-list">
          {videos.map((v, i) => (
            <div className="item-row" key={i}>
              <input value={v.title} readOnly />
              <button
                type="button"
                className="chk-del"
                aria-label="Remove video"
                onClick={() => setVideos((cur) => cur.filter((_, idx) => idx !== i))}
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="pos-addrow">
        <input
          className="pos-desc"
          value={vTitle}
          onChange={(e) => setVTitle(e.target.value)}
          placeholder="Video title"
        />
      </div>
      <div className="pos-addrow">
        <input value={vUrl} onChange={(e) => setVUrl(e.target.value)} placeholder="https://…" />
        <button type="button" className="btn btn-secondary" style={{ flex: 'none' }} onClick={addVideo}>
          <Icon name="plus" /> Add
        </button>
      </div>

      <label htmlFor="jb-notes">Notes</label>
      <textarea id="jb-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
    </Modal>
  );
}
