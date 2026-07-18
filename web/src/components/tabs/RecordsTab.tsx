'use client';

// Records — permanent dive-service records, split Active | Sent. GET /api/records. Rows open the
// printable record document. Pricing is stripped server-side without dive.jobs.view-pricing.

import { useMemo, useState } from 'react';
import { useResource } from '@/lib/hooks';
import type { ServiceRecord } from '@/lib/types';
import { formatDate } from '@/lib/format';
import { EmptyState, ErrorBanner } from '../common';
import { usePermissions } from '../PermissionsProvider';
import { PERMISSIONS as P } from '@/lib/permissions';
import { RecordModal } from '../modals/RecordModal';

export function RecordsTab() {
  const { can } = usePermissions();
  const canSend = can(P.RECORDS_SEND);
  const canManage = can(P.RECORDS_MANAGE);
  const canViewPricing = can(P.JOBS_VIEW_PRICING);
  const { data, error, reload } = useResource<{ records: ServiceRecord[] }>('/api/records');
  const [tab, setTab] = useState<'active' | 'sent'>('active');
  const [selected, setSelected] = useState<ServiceRecord | null>(null);

  const records = useMemo(() => data?.records ?? [], [data]);
  const active = useMemo(() => records.filter((r) => !r.sent), [records]);
  const sent = useMemo(() => records.filter((r) => r.sent), [records]);
  const shown = tab === 'active' ? active : sent;

  return (
    <>
      <div className="seg">
        <button className={tab === 'active' ? 'seg-btn active' : 'seg-btn'} onClick={() => setTab('active')}>
          Active <span className="seg-count">{active.length}</span>
        </button>
        <button className={tab === 'sent' ? 'seg-btn active' : 'seg-btn'} onClick={() => setTab('sent')}>
          Sent <span className="seg-count">{sent.length}</span>
        </button>
      </div>

      {error ? <ErrorBanner message="Couldn’t load records." /> : null}

      {shown.length === 0 && !error ? (
        <EmptyState
          icon="file-text"
          title={tab === 'active' ? 'No active records' : 'No sent records'}
          desc={
            tab === 'active'
              ? 'Completing a job creates a permanent service record here.'
              : 'Records you email to customers move here.'
          }
        />
      ) : (
        shown.map((r) => {
          const diver = r.completedByName || r.diverNames;
          return (
            <button className="rec-row" key={r.id} onClick={() => setSelected(r)}>
              <div className="rec-main">
                <div className="rec-title">
                  {r.boat || r.site || 'Dive service'}
                  {r.sent ? <span className="tag">Sent</span> : null}
                </div>
                <div className="rec-sub">
                  {[r.ownerName, diver].filter(Boolean).join(' · ') || 'Service record'}
                </div>
              </div>
              <div className="rec-date">{formatDate(r.completedAt ? r.completedAt.slice(0, 10) : '')}</div>
            </button>
          );
        })
      )}

      {selected ? (
        <RecordModal
          record={selected}
          canSend={canSend}
          canManage={canManage}
          canViewPricing={canViewPricing}
          onClose={() => setSelected(null)}
          onChanged={reload}
        />
      ) : null}
    </>
  );
}
