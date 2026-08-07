'use client';

// App shell: brand header, permission-filtered tab bar, and the active tab. Tab visibility is
// derived purely from dive.* permissions (docs/ARCHITECTURE.md §Frontend). No role names anywhere.

import { useMemo, useState } from 'react';
import { usePermissions } from './PermissionsProvider';
import { Icon } from './Icon';
import { PERMISSIONS as P } from '@/lib/permissions';
import { BRAND } from '@/lib/brand';
import { JobsTab } from './tabs/JobsTab';
import { RecordsTab } from './tabs/RecordsTab';
import { ChecksTab } from './tabs/ChecksTab';
import { PayTab } from './tabs/PayTab';
import { DiversTab } from './tabs/DiversTab';
import { SalesTab } from './tabs/SalesTab';
import { StockTab } from './tabs/StockTab';

interface TabDef {
  key: string;
  label: string;
  visible: (perm: { can: (p: string) => boolean; hasAny: (...p: string[]) => boolean }) => boolean;
  Comp: React.ComponentType;
}

const TABS: TabDef[] = [
  { key: 'jobs', label: 'Jobs', visible: (p) => p.hasAny(P.JOBS_VIEW_ALL, P.JOBS_VIEW_ASSIGNED), Comp: JobsTab },
  { key: 'records', label: 'Records', visible: (p) => p.can(P.RECORDS_VIEW), Comp: RecordsTab },
  { key: 'checks', label: 'Checks', visible: (p) => p.can(P.CHECKLIST_MANAGE), Comp: ChecksTab },
  { key: 'pay', label: 'Pay', visible: (p) => p.hasAny(P.PAY_VIEW_OWN, P.PAY_VIEW_ALL), Comp: PayTab },
  { key: 'divers', label: 'Divers', visible: (p) => p.can(P.CREW_VIEW), Comp: DiversTab },
  { key: 'sales', label: 'Sales', visible: (p) => p.hasAny(P.POS_USE, P.FINANCE_VIEW), Comp: SalesTab },
  { key: 'stock', label: 'Stock', visible: (p) => p.can(P.INVENTORY_VIEW), Comp: StockTab },
];

export function Shell() {
  const { me, can, hasAny } = usePermissions();
  const visibleTabs = useMemo(() => TABS.filter((t) => t.visible({ can, hasAny })), [can, hasAny]);
  const [active, setActive] = useState<string>(() => visibleTabs[0]?.key ?? 'jobs');

  const current = visibleTabs.find((t) => t.key === active) ?? visibleTabs[0];
  const Active = current?.Comp;

  return (
    <>
      <header>
        <div className="logo">
          <Icon name="anchor" />
        </div>
        <div className="title">
          {/* Product name from lib/brand.ts, never a literal — see that file on why the
              TENANT's name must not be rendered here. */}
          <h1>{BRAND.name}</h1>
          <div className="subtitle">{BRAND.tagline}</div>
        </div>
        <div className="who">
          <Icon name="user" />
          {me.user.name}
        </div>
      </header>

      {visibleTabs.length > 1 ? (
        // A real tablist: roving tabindex + arrow keys, so the bar is operable from the keyboard
        // and announces itself. Previously every tab was a tab stop with no arrow handling, which
        // is the one interaction a screen-reader user has to get through to reach any screen.
        <div className="tabs" role="tablist" aria-label={`${BRAND.name} sections`}>
          {visibleTabs.map((t) => {
            const selected = t.key === current?.key;
            return (
              <button
                key={t.key}
                id={`tab-${t.key}`}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls={`panel-${t.key}`}
                tabIndex={selected ? 0 : -1}
                className={selected ? 'tab-btn active' : 'tab-btn'}
                onClick={() => setActive(t.key)}
                onKeyDown={(e) => {
                  const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                  if (!delta) return;
                  e.preventDefault();
                  const i = visibleTabs.findIndex((x) => x.key === current?.key);
                  const next = visibleTabs[(i + delta + visibleTabs.length) % visibleTabs.length];
                  setActive(next.key);
                  document.getElementById(`tab-${next.key}`)?.focus();
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      ) : null}

      <main>
        {Active ? (
          <div
            className="tab-content"
            key={current?.key}
            id={`panel-${current?.key}`}
            role="tabpanel"
            aria-labelledby={`tab-${current?.key}`}
          >
            <Active />
          </div>
        ) : (
          <div className="empty">
            <div className="t">No screens available</div>
            <div className="d">Your account has no dive permissions on this installation.</div>
          </div>
        )}
      </main>
    </>
  );
}
