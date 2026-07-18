'use client';

// Sales — POS (dive.pos.use), an estimate calculator (rate-per-foot × length + crew share, from
// /api/settings), a revenue report with a 6-month SVG trend and week/month/year in/out/net
// (dive.finance.view), the income/expense ledger (delete + add under dive.finance.manage), and a
// JSON backup download (dive.finance.manage). No Venmo/QR, trial gate, demo mode, or jsPDF.

import { useState } from 'react';
import { api } from '@/lib/api';
import { useResource } from '@/lib/hooks';
import type { FinanceSummary, LedgerEntry, Settings, TrendPoint } from '@/lib/types';
import { formatDate, money, num, todayISO } from '@/lib/format';
import { usePermissions } from '../PermissionsProvider';
import { PERMISSIONS as P } from '@/lib/permissions';
import { Icon } from '../Icon';
import { EmptyState, ErrorBanner, Fab } from '../common';
import { usePlatform } from '../PlatformProvider';
import { PosModal } from '../modals/PosModal';
import { LedgerFormModal } from '../modals/LedgerFormModal';

const compactMoney = (v: unknown): string => {
  const n = num(v);
  const a = Math.abs(n);
  if (a >= 1000) return (n < 0 ? '-$' : '$') + (a / 1000).toFixed(a % 1000 === 0 ? 0 : 1) + 'k';
  return money(n);
};

function TrendChart({ points }: { points: TrendPoint[] }) {
  if (!points || points.length === 0) {
    return <div className="trend-empty">No revenue yet — completed jobs and ledger income will chart here.</div>;
  }
  const W = 320;
  const H = 150;
  const padTop = 18;
  const padBottom = 24;
  const plotH = H - padTop - padBottom;
  const nets = points.map((p) => num(p.net));
  const posMax = Math.max(0, ...nets);
  const negMax = Math.max(0, ...nets.map((n) => -n));
  const total = posMax + negMax || 1;
  const zeroY = padTop + (posMax / total) * plotH;
  const slot = W / points.length;
  const bw = Math.min(34, slot * 0.52);

  return (
    <svg className="trend-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Six-month revenue trend">
      <line className="tb-base" x1="0" y1={zeroY} x2={W} y2={zeroY} />
      {points.map((p, i) => {
        const v = num(p.net);
        const cx = slot * i + slot / 2;
        const x = cx - bw / 2;
        const h = Math.max(1, (Math.abs(v) / total) * plotH);
        const y = v >= 0 ? zeroY - h : zeroY;
        const cls = v > 0 ? 'tb-bar' : v < 0 ? undefined : 'tb-zero';
        return (
          <g key={i}>
            <rect className={cls} style={v < 0 ? { fill: 'var(--danger)' } : undefined} x={x} y={y} width={bw} height={h} rx="3" />
            <text className="tb-vlabel" x={cx} y={v >= 0 ? y - 4 : y + h + 11} textAnchor="middle">
              {v === 0 ? '' : compactMoney(v)}
            </text>
            <text className="tb-mlabel" x={cx} y={H - 7} textAnchor="middle">
              {p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function StatGrid({ title, period }: { title: string; period?: { in: unknown; out: unknown; net: unknown } }) {
  const net = num(period?.net);
  return (
    <div className="report-card">
      <div className="rc-title">
        <Icon name="dollar-sign" />
        {title}
      </div>
      <div className="rc-grid">
        <div className="stat">
          <div className="lbl">In</div>
          <div className="val in">{money(num(period?.in))}</div>
        </div>
        <div className="stat">
          <div className="lbl">Out</div>
          <div className="val out">{money(num(period?.out))}</div>
        </div>
        <div className="stat">
          <div className="lbl">Net</div>
          <div className={net < 0 ? 'val net neg' : 'val net'}>{money(net)}</div>
        </div>
      </div>
    </div>
  );
}

export function SalesTab() {
  const { can } = usePermissions();
  const { toast } = usePlatform();
  const canPos = can(P.POS_USE);
  const canFinance = can(P.FINANCE_VIEW);
  const canFinanceManage = can(P.FINANCE_MANAGE);
  const canSettings = can(P.SETTINGS_MANAGE);

  const settings = useResource<Settings>(canFinance || canSettings ? '/api/settings' : null);
  const summary = useResource<FinanceSummary>(canFinance ? '/api/finance/summary' : null);
  const ledger = useResource<{ entries: LedgerEntry[] }>(canFinance ? '/api/ledger' : null);

  const [pos, setPos] = useState(false);
  const [addLedger, setAddLedger] = useState(false);
  const [estLength, setEstLength] = useState('');

  const rate = num(settings.data?.estimateRatePerFoot);
  const payRate = num(settings.data?.payRate);
  const estPrice = rate * num(estLength);
  const estCrew = estPrice * payRate;

  const reloadFinance = () => {
    summary.reload();
    ledger.reload();
  };

  const delEntry = async (id: string) => {
    try {
      await api.del(`/api/ledger/${id}`);
      toast('Entry removed');
      reloadFinance();
    } catch {
      /* toast surfaced by api */
    }
  };

  const downloadBackup = async () => {
    try {
      const blob = await api.getBlob('/api/backup');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dive-schedule-backup-${todayISO()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('Backup downloaded');
    } catch {
      /* toast surfaced by api */
    }
  };

  const entries = ledger.data?.entries ?? [];

  return (
    <>
      {/* Estimate calculator */}
      {settings.data ? (
        <div className="sales-section">
          <div className="sales-h">Estimate</div>
          <div className="report-card">
            <div className="calc-grid">
              <div>
                <label htmlFor="est-len">Hull length (ft)</label>
                <input
                  id="est-len"
                  inputMode="decimal"
                  value={estLength}
                  onChange={(e) => setEstLength(e.target.value)}
                  placeholder="0"
                  style={{ marginBottom: 0 }}
                />
              </div>
              <div>
                <label htmlFor="est-rate">Rate / ft</label>
                <input id="est-rate" value={rate ? money(rate) : '—'} readOnly style={{ marginBottom: 0 }} />
              </div>
            </div>
            <div className="calc-out">
              <div className="calc-line">
                <span>Estimated price</span>
                <b>{money(estPrice)}</b>
              </div>
              <div className="calc-line sub">
                <span>Crew share ({Math.round(payRate * 100)}%)</span>
                <b>{money(estCrew)}</b>
              </div>
            </div>
          </div>
          {rate <= 0 ? (
            <div className="calc-note">
              <Icon name="info" />
              <span>Set an estimate rate-per-foot in settings to use the calculator.</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Revenue report */}
      {canFinance ? (
        <div className="sales-section">
          <div className="sales-h">Revenue</div>
          {summary.error ? <ErrorBanner message="Couldn’t load the revenue report." /> : null}
          <div className="report-card">
            <div className="rc-title">
              <Icon name="trending-up" />
              Last 6 months
            </div>
            <div className="trend-wrap">
              <TrendChart points={summary.data?.trend ?? []} />
            </div>
          </div>
          <StatGrid title="This week" period={summary.data?.week} />
          <StatGrid title="This month" period={summary.data?.month} />
          <StatGrid title="This year" period={summary.data?.year} />
        </div>
      ) : null}

      {/* Ledger */}
      {canFinance ? (
        <div className="sales-section">
          <div className="sales-h" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Ledger</span>
            <span style={{ display: 'flex', gap: 8 }}>
              {canFinanceManage ? (
                <button className="btn btn-secondary btn-mini" onClick={downloadBackup}>
                  <Icon name="download" /> Backup
                </button>
              ) : null}
              {canFinanceManage ? (
                <button className="btn btn-primary btn-mini" onClick={() => setAddLedger(true)}>
                  <Icon name="plus" /> Add
                </button>
              ) : null}
            </span>
          </div>
          {entries.length === 0 ? (
            <EmptyState icon="file-text" title="No ledger entries" desc="POS sales and manual entries appear here." />
          ) : (
            entries.map((e) => (
              <div className="ledger-row" key={e.id}>
                <div className={`lr-ico ${e.kind}`}>
                  <Icon name={e.kind === 'in' ? 'arrow-down' : 'arrow-up'} />
                </div>
                <div className="lr-main">
                  <div className="lr-desc">{e.description || (e.kind === 'in' ? 'Income' : 'Expense')}</div>
                  <div className="lr-sub">
                    {[e.category, formatDate(e.date)].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className={`lr-amt ${e.kind}`}>
                  {e.kind === 'out' ? '-' : '+'}
                  {money(e.amount)}
                </div>
                {canFinanceManage ? (
                  <button className="lr-del" aria-label="Delete entry" onClick={() => delEntry(e.id)}>
                    <Icon name="trash" />
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}

      {canPos ? <Fab onClick={() => setPos(true)} label="New sale" icon="cart" /> : null}

      {pos ? (
        <PosModal
          onClose={() => setPos(false)}
          onSaved={() => {
            reloadFinance();
          }}
        />
      ) : null}
      {addLedger ? <LedgerFormModal onClose={() => setAddLedger(false)} onSaved={reloadFinance} /> : null}
    </>
  );
}
