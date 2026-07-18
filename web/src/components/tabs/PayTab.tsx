'use client';

// Pay — Monday-week pay view. With dive.pay.view-all a crew <select> appears; otherwise it is locked
// to the caller (the server rejects any other userId under view-own). Week nav's "next" is disabled
// at the current week. Totals + the 7-day breakdown come straight from GET /api/pay.

import { useMemo, useState } from 'react';
import { useResource } from '@/lib/hooks';
import type { CrewMember, PayWeek } from '@/lib/types';
import { formatDate, money, num } from '@/lib/format';
import { usePermissions } from '../PermissionsProvider';
import { PERMISSIONS as P } from '@/lib/permissions';
import { Icon } from '../Icon';
import { ErrorBanner } from '../common';

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const weekRelative = (offset: number) =>
  offset === 0 ? 'This week' : offset === -1 ? 'Last week' : offset < 0 ? `${-offset} weeks ago` : `In ${offset} weeks`;

export function PayTab() {
  const { me, can } = usePermissions();
  const canViewAll = can(P.PAY_VIEW_ALL);
  const [userId, setUserId] = useState(me.user.id);
  const [offset, setOffset] = useState(0);

  const crew = useResource<{ crew: CrewMember[] }>(canViewAll ? '/api/crew' : null);
  const pay = useResource<PayWeek>(`/api/pay?week=${offset}&userId=${encodeURIComponent(userId)}`);

  const crewOptions = useMemo(() => {
    const list = crew.data?.crew ?? [];
    const has = list.some((c) => c.id === me.user.id);
    const base = has ? list : [{ id: me.user.id, name: me.user.name } as CrewMember, ...list];
    return base.map((c) => ({ id: c.id, name: c.id === me.user.id ? `${c.name} (you)` : c.name }));
  }, [crew.data, me]);

  const data = pay.data;
  const weekEnd = data?.weekStart
    ? (() => {
        const d = new Date(data.weekStart + 'T00:00:00');
        d.setDate(d.getDate() + 6);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      })()
    : '';

  return (
    <>
      {canViewAll ? (
        <div className="pay-select">
          <select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Crew member">
            {crewOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="pay-weeknav">
        <button className="pay-nav" aria-label="Previous week" onClick={() => setOffset((o) => o - 1)}>
          <Icon name="chevron-left" />
        </button>
        <div className="pay-weeklabel">
          {weekRelative(offset)}
          <span>
            {data?.weekStart ? `${formatDate(data.weekStart)} – ${formatDate(weekEnd)}` : '—'}
          </span>
        </div>
        <button
          className="pay-nav"
          aria-label="Next week"
          disabled={offset >= 0}
          onClick={() => setOffset((o) => Math.min(0, o + 1))}
        >
          <Icon name="chevron-right" />
        </button>
      </div>

      {pay.error ? <ErrorBanner message="Couldn’t load pay for this week." /> : null}

      <div className="pay-total-card">
        <div className="ptc-lbl">Week total</div>
        <div className="ptc-val">{money(num(data?.weekTotal))}</div>
        <div className="ptc-sub">{num(data?.totalFeet).toLocaleString('en-US')} ft cleaned</div>
      </div>

      {(data?.days ?? []).map((day) => {
        const has = num(day.total) > 0 || day.jobs.length > 0;
        const dow = new Date(day.date + 'T00:00:00').getDay();
        return (
          <div className={has ? 'pay-day has' : 'pay-day'} key={day.date}>
            <div className="pay-day-head">
              <div className="pay-dow">
                {DOW[dow]}
                <span>{formatDate(day.date)}</span>
              </div>
              <div className="pay-damt">{money(num(day.total))}</div>
            </div>
            {day.jobs.length ? (
              <div className="pay-jobs">
                {day.jobs.map((j, idx) => (
                  <div className="pay-job" key={idx}>
                    <span>{j.site || 'Job'}</span>
                    <span>{money(num(j.earning))}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
