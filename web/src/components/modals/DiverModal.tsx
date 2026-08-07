'use client';

// Diver profile: view certifications / contact / bio / assigned jobs, and (with dive.crew.manage)
// edit the vendor-owned profile fields — certifications, bio, photo, joined — via PATCH /api/crew/:id.
// Name and email come from the platform directory and are not editable here.

import { useState } from 'react';
import { api } from '@/lib/api';
import { useResource } from '@/lib/hooks';
import type { CrewMember, Job } from '@/lib/types';
import { formatDate, isSafePhoto } from '@/lib/format';
import { fileToResizedDataUrl } from '@/lib/photo';
import { Modal } from '../Modal';
import { Icon } from '../Icon';
import { Avatar, DataImg } from '../common';
import { usePlatform } from '../PlatformProvider';

export function DiverModal({
  member,
  canManage,
  canViewJobs,
  onClose,
  onSaved,
}: {
  member: CrewMember;
  canManage: boolean;
  canViewJobs: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = usePlatform();
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  // Edit state
  const [certifications, setCertifications] = useState(member.certifications ?? '');
  const [bio, setBio] = useState(member.bio ?? '');
  const [photo, setPhoto] = useState(member.photo ?? '');
  const [joined, setJoined] = useState(member.joined ?? '');
  const [busy, setBusy] = useState(false);

  const jobs = useResource<{ jobs: Job[] }>(mode === 'view' && canViewJobs ? '/api/jobs' : null);
  const assigned = (jobs.data?.jobs ?? []).filter((j) => (j.assignedUserIds ?? []).includes(member.id));

  const certList = (member.certifications ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setPhoto(await fileToResizedDataUrl(file));
    } catch {
      toast('Couldn’t process that image.');
    }
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.patch(`/api/crew/${encodeURIComponent(member.id)}`, {
        certifications: certifications.trim(),
        bio: bio.trim(),
        photo,
        joined: joined.trim(),
      });
      toast('Profile saved');
      onSaved();
      onClose();
    } catch {
      setBusy(false);
    }
  };

  if (mode === 'edit') {
    return (
      <Modal
        title="Edit profile"
        onClose={() => setMode('view')}
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => setMode('view')} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              Save
            </button>
          </>
        }
      >
        <div className="photo-uploader">
          <div className="photo-preview">{isSafePhoto(photo) ? <DataImg src={photo} /> : <Icon name="camera" />}</div>
          <div className="photo-actions">
            <label className="btn btn-secondary btn-mini" style={{ marginBottom: 0 }}>
              <Icon name="camera" /> {photo ? 'Replace photo' : 'Add photo'}
              <input type="file" accept="image/*" onChange={onPhoto} style={{ display: 'none' }} />
            </label>
            {photo ? (
              <button className="btn btn-secondary btn-mini" onClick={() => setPhoto('')}>
                Remove
              </button>
            ) : null}
          </div>
        </div>

        <label htmlFor="dv-cert">Certifications</label>
        <input
          id="dv-cert"
          value={certifications}
          onChange={(e) => setCertifications(e.target.value)}
          placeholder="e.g. PADI Divemaster, Rescue Diver"
        />

        <label htmlFor="dv-bio">Bio</label>
        <textarea id="dv-bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Optional" />

        <label htmlFor="dv-joined">Joined</label>
        <input id="dv-joined" type="date" value={joined} onChange={(e) => setJoined(e.target.value)} />
      </Modal>
    );
  }

  return (
    <Modal
      title="Diver"
      onClose={onClose}
      actions={
        canManage ? (
          <button className="btn btn-primary" onClick={() => setMode('edit')}>
            <Icon name="edit" /> Edit profile
          </button>
        ) : undefined
      }
    >
      <div className="profile-head">
        <Avatar photo={member.photo} name={member.name} className="profile-photo" />
        <div style={{ minWidth: 0 }}>
          <div className="profile-name">{member.name}</div>
          {certList.length ? (
            <div className="cert-chips">
              {certList.map((c, i) => (
                <span className="cert-chip" key={i}>
                  {c}
                </span>
              ))}
            </div>
          ) : (
            <div className="diver-cert">No certifications on file</div>
          )}
        </div>
      </div>

      {member.email ? (
        <div className="contact-row">
          <Icon name="mail" />
          <a href={`mailto:${member.email}`}>{member.email}</a>
        </div>
      ) : null}
      {member.joined ? (
        <div className="contact-row">
          <Icon name="calendar" />
          <span>Joined {formatDate(member.joined)}</span>
        </div>
      ) : null}
      {member.active === false ? (
        <div className="contact-row">
          <Icon name="info" />
          <span>Deactivated on the platform</span>
        </div>
      ) : null}

      {member.bio ? (
        <div className="dl" style={{ marginTop: 14 }}>
          <div className="k">Bio</div>
          <div className="v">{member.bio}</div>
        </div>
      ) : null}

      {canViewJobs ? (
        <div className="dl" style={{ marginTop: 14 }}>
          <div className="k">Assigned jobs</div>
          {assigned.length ? (
            assigned.map((j) => (
              <div className="assigned-job" key={j.id}>
                <div className="aj-main">
                  <div className="aj-title">{j.boat || j.site || 'Job'}</div>
                  <div className={j.status === 'completed' ? 'aj-sub done' : 'aj-sub'}>
                    {j.status === 'completed' ? 'Completed' : j.site || 'Scheduled'}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="v" style={{ color: 'var(--text-mute)' }}>
              None currently assigned.
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
