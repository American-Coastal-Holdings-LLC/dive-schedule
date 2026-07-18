'use client';

// Divers — crew roster (platform directory merged with vendor crew profiles). Cards open a profile
// modal; editing is gated on dive.crew.manage. GET /api/crew.

import { useState } from 'react';
import { useResource } from '@/lib/hooks';
import type { CrewMember } from '@/lib/types';
import { Avatar, EmptyState, ErrorBanner } from '../common';
import { usePermissions } from '../PermissionsProvider';
import { PERMISSIONS as P } from '@/lib/permissions';
import { DiverModal } from '../modals/DiverModal';

export function DiversTab() {
  const { can, hasAny } = usePermissions();
  const canManage = can(P.CREW_MANAGE);
  const canViewJobs = hasAny(P.JOBS_VIEW_ALL, P.JOBS_VIEW_ASSIGNED);
  const { data, error, reload } = useResource<{ crew: CrewMember[] }>('/api/crew');
  const [selected, setSelected] = useState<CrewMember | null>(null);

  const crew = data?.crew ?? [];

  return (
    <>
      {error ? <ErrorBanner message="Couldn’t load the crew roster." /> : null}

      {crew.length === 0 && !error ? (
        <EmptyState icon="users" title="No crew yet" desc="Crew appear here once they’re added to this installation." />
      ) : (
        <div className="diver-grid">
          {crew.map((c) => {
            const firstCert = (c.certifications || '').split(',')[0]?.trim();
            return (
              <button className="diver-card" key={c.id} onClick={() => setSelected(c)}>
                <Avatar photo={c.photo} name={c.name} className="diver-avatar" />
                <div className="diver-info">
                  <div className="diver-name">{c.name}</div>
                  <div className="diver-cert">
                    {firstCert || c.email || 'Crew member'}
                    {c.active === false ? ' · Deactivated' : ''}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected ? (
        <DiverModal
          member={selected}
          canManage={canManage}
          canViewJobs={canViewJobs}
          onClose={() => setSelected(null)}
          onSaved={reload}
        />
      ) : null}
    </>
  );
}
