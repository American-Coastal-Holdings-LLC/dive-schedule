'use client';

// Jobs — the core board. Unfinished | Finished filter with counts, day-grouped cards, due-status
// chips. Cards open the detail modal; add/edit (dive.jobs.manage) uses the boat form. With only
// dive.jobs.view-assigned the server returns just the caller's jobs (and 404s the rest). Pricing is
// stripped without dive.jobs.view-pricing. GET /api/jobs.

import { useMemo, useState } from 'react';
import { useResource } from '@/lib/hooks';
import type { Job } from '@/lib/types';
import { dueStatus, formatDate, money, num } from '@/lib/format';
import { EmptyState, ErrorBanner, Fab } from '../common';
import { Icon } from '../Icon';
import { usePermissions } from '../PermissionsProvider';
import { PERMISSIONS as P } from '@/lib/permissions';
import { JobDetailModal } from '../modals/JobDetailModal';
import { JobFormModal } from '../modals/JobFormModal';

function groupByDay(list: Job[], dateKey: (j: Job) => string): { day: string; items: Job[] }[] {
  const map = new Map<string, Job[]>();
  for (const j of list) {
    const d = dateKey(j) || '';
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(j);
  }
  return Array.from(map.entries()).map(([day, items]) => ({ day, items }));
}

function JobCard({
  job,
  canViewPricing,
  onOpen,
}: {
  job: Job;
  canViewPricing: boolean;
  onOpen: () => void;
}) {
  const completed = job.status === 'completed';
  const status = dueStatus(job.dueDate);
  const assigned = job.assignedUsers?.length ?? job.assignedUserIds?.length ?? 0;
  const title = job.boat || job.site || 'Job';
  return (
    <button className={completed ? 'card done' : 'card'} onClick={onOpen}>
      <div className="site">{title}</div>
      {job.site && job.boat ? (
        <div className="sub">
          <Icon name="map-pin" />
          <span>{job.site}</span>
        </div>
      ) : null}
      {job.ownerName || num(job.footage) > 0 ? (
        <div className="sub">
          <Icon name="user" />
          <span>{job.ownerName || 'Owner'}</span>
          {num(job.footage) > 0 ? (
            <>
              <span className="sep">·</span>
              <span>{job.footage} ft</span>
            </>
          ) : null}
        </div>
      ) : null}
      <div className="meta">
        {completed ? (
          <span className="chip done">
            <Icon name="check-circle" />
            Completed{job.completedAt ? ` ${formatDate(job.completedAt.slice(0, 10))}` : ''}
          </span>
        ) : status ? (
          <span className={`chip ${status.kind}`}>
            <Icon name="calendar" />
            {status.label}
          </span>
        ) : null}
        {canViewPricing && job.price != null && num(job.price) > 0 ? (
          <span className="chip">
            <Icon name="dollar-sign" />
            {money(job.price)}
          </span>
        ) : null}
        {job.videos?.length ? (
          <span className="chip videos">
            <Icon name="video" />
            {job.videos.length}
          </span>
        ) : null}
        {assigned > 0 ? (
          <span className="chip">
            <Icon name="users" />
            {assigned}
          </span>
        ) : null}
      </div>
    </button>
  );
}

export function JobsTab() {
  const { can } = usePermissions();
  const canManage = can(P.JOBS_MANAGE);
  const canViewPricing = can(P.JOBS_VIEW_PRICING);
  const { data, error, reload } = useResource<{ jobs: Job[] }>('/api/jobs');

  const [tab, setTab] = useState<'unfinished' | 'finished'>('unfinished');
  const [detail, setDetail] = useState<Job | null>(null);
  const [editing, setEditing] = useState<Job | null>(null);
  const [adding, setAdding] = useState(false);

  const jobs = useMemo(() => data?.jobs ?? [], [data]);
  const unfinished = useMemo(
    () => jobs.filter((j) => j.status !== 'completed').sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')),
    [jobs],
  );
  const finished = useMemo(
    () =>
      jobs
        .filter((j) => j.status === 'completed')
        .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')),
    [jobs],
  );

  const groups =
    tab === 'unfinished'
      ? groupByDay(unfinished, (j) => j.dueDate)
      : groupByDay(finished, (j) => (j.completedAt ? j.completedAt.slice(0, 10) : ''));

  const dayLabel = (day: string) =>
    day ? formatDate(day) : tab === 'unfinished' ? 'Unscheduled' : 'Date unknown';

  const closeDetail = () => {
    setDetail(null);
    reload();
  };

  return (
    <>
      <div className="seg">
        <button
          className={tab === 'unfinished' ? 'seg-btn active' : 'seg-btn'}
          onClick={() => setTab('unfinished')}
        >
          Unfinished <span className="seg-count">{unfinished.length}</span>
        </button>
        <button className={tab === 'finished' ? 'seg-btn active' : 'seg-btn'} onClick={() => setTab('finished')}>
          Finished <span className="seg-count">{finished.length}</span>
        </button>
      </div>

      {error ? <ErrorBanner message="Couldn’t load jobs." /> : null}

      {groups.length === 0 && !error ? (
        <EmptyState
          icon="anchor"
          title={tab === 'unfinished' ? 'No unfinished jobs' : 'No finished jobs'}
          desc={
            tab === 'unfinished'
              ? canManage
                ? 'Tap + to add a boat under service.'
                : 'Nothing scheduled right now.'
              : 'Completed jobs will appear here.'
          }
        />
      ) : (
        groups.map((g) => (
          <div key={g.day || 'none'}>
            <div className="day-header">{dayLabel(g.day)}</div>
            {g.items.map((j) => (
              <JobCard key={j.id} job={j} canViewPricing={canViewPricing} onOpen={() => setDetail(j)} />
            ))}
          </div>
        ))
      )}

      {canManage ? <Fab onClick={() => setAdding(true)} label="Add boat" /> : null}

      {detail ? (
        <JobDetailModal
          job={detail}
          onClose={closeDetail}
          onEdit={(j) => {
            setDetail(null);
            setEditing(j);
          }}
        />
      ) : null}
      {adding ? (
        <JobFormModal job={null} canViewPricing={canViewPricing} onClose={() => setAdding(false)} onSaved={reload} />
      ) : null}
      {editing ? (
        <JobFormModal
          job={editing}
          canViewPricing={canViewPricing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      ) : null}
    </>
  );
}
