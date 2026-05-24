/**
 * PAY-V2-P5 — Admin Payouts Queue (operational surface).
 *
 * Authority rule (Pr-7 queue-first + WEB-P4 backend authority):
 *   This page does ZERO client-side derivation of payout state.
 *   Every number on screen reads from one of:
 *     • GET /api/payouts-v2/admin/worker/status   (queue_health, counts, amounts)
 *     • GET /api/payouts-v2/admin/queue           (items + batches summary)
 *
 *   No `.reduce` / `.filter` on items for totals. If you find yourself
 *   computing a payout aggregate in JSX, add a backend summary endpoint
 *   instead and read it.
 *
 * Surface:
 *   • Worker status strip — worker_id, queue health (6 categories), config
 *   • Counts-by-status grid — 10 canonical states with amounts
 *   • Failing items table — top 20 (attempt_count, last_error, next_attempt_at)
 *   • Recent batches table — clickable → /admin/payouts-v2/batches/:id
 *   • Force-retry / dead-letter / drain-once actions (admin-only)
 */
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { runtime } from '@/runtime';
import {
  AlertTriangle, RefreshCw, PlayCircle, Skull, Loader2, CheckCircle2,
  Clock, ArrowRight, Activity, ExternalLink,
} from 'lucide-react';

const STATE_GROUPS = [
  { key: 'queued',     label: 'Queued',     tone: 'neutral'  },
  { key: 'initiated',  label: 'Initiated',  tone: 'info'     },
  { key: 'in_flight',  label: 'In Flight',  tone: 'info'     },
  { key: 'confirmed',  label: 'Confirmed',  tone: 'info'     },
  { key: 'settled',    label: 'Settled',    tone: 'success'  },
  { key: 'reconciled', label: 'Reconciled', tone: 'success'  },
  { key: 'failed',     label: 'Failed',     tone: 'danger'   },
  { key: 'returned',   label: 'Returned',   tone: 'danger'   },
  { key: 'disputed',   label: 'Disputed',   tone: 'warning'  },
  { key: 'cancelled',  label: 'Cancelled',  tone: 'muted'    },
];

function fmtMoney(amt, currency = 'USD') {
  const n = Number(amt || 0);
  return `$${n.toFixed(2)}`;
}

function fmtRelative(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function ToneBadge({ tone, children }) {
  // Tone → token classes (uses design-system tokens via tailwind)
  const map = {
    success:  { bg: 'var(--token-success-tint)', fg: 'var(--token-success)', bd: 'var(--token-success-border)' },
    info:     { bg: 'var(--token-info-tint)',    fg: 'var(--token-info)',    bd: 'var(--token-info-border)' },
    danger:   { bg: 'var(--token-danger-tint)',  fg: 'var(--token-danger)',  bd: 'var(--token-danger-border)' },
    warning:  { bg: 'var(--token-warning-tint)', fg: 'var(--token-warning)', bd: 'var(--token-warning-border)' },
    neutral:  { bg: 'var(--token-surface-elevated)', fg: 'var(--token-primary)', bd: 'var(--token-border)' },
    muted:    { bg: 'transparent', fg: 'var(--token-muted)', bd: 'var(--token-border)' },
  };
  const s = map[tone] || map.neutral;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium"
      style={{ background: s.bg, color: s.fg, border: `1px solid ${s.bd}` }}
    >
      {children}
    </span>
  );
}

export default function AdminPayoutsQueue() {
  const [status, setStatus] = useState(null);     // /worker/status
  const [queue, setQueue] = useState(null);       // /admin/queue
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [s, q] = await Promise.all([
        runtime.get('/api/payouts-v2/admin/worker/status'),
        runtime.get('/api/payouts-v2/admin/queue'),
      ]);
      setStatus(s.data || s);
      setQueue(q.data || q);
    } catch (e) {
      setMsg({ kind: 'error', text: `Load failed: ${e?.message || e}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Auto-refresh every 5s (worker drain cycle cadence)
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const drainOnce = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await runtime.post('/api/payouts-v2/admin/worker/drain-once', {});
      const d = r.data || r;
      const drained = d?.drained?.processed ?? 0;
      const advanced = d?.advanced?.advanced ?? 0;
      const reaped = d?.reaped?.reclaimed ?? 0;
      setMsg({ kind: 'ok', text: `Drain: ${drained} processed, ${advanced} advanced, ${reaped} reaped.` });
      load();
    } catch (e) {
      setMsg({ kind: 'error', text: `Drain failed: ${e?.message || e}` });
    } finally {
      setBusy(false);
    }
  }, [load]);

  const forceRetry = useCallback(async (itemId) => {
    setBusy(true);
    setMsg(null);
    try {
      await runtime.post(`/api/payouts-v2/admin/items/${itemId}/force-retry`, {});
      setMsg({ kind: 'ok', text: `Force-retry queued for ${itemId}` });
      load();
    } catch (e) {
      setMsg({ kind: 'error', text: `Force-retry failed: ${e?.message || e}` });
    } finally {
      setBusy(false);
    }
  }, [load]);

  const deadLetter = useCallback(async (itemId) => {
    // eslint-disable-next-line no-alert
    const reason = window.prompt(`Dead-letter ${itemId} — short reason:`, 'admin_terminated');
    if (reason == null) return;
    setBusy(true);
    setMsg(null);
    try {
      await runtime.post(`/api/payouts-v2/admin/items/${itemId}/dead-letter`, { reason });
      setMsg({ kind: 'ok', text: `Dead-lettered ${itemId}` });
      load();
    } catch (e) {
      setMsg({ kind: 'error', text: `Dead-letter failed: ${e?.message || e}` });
    } finally {
      setBusy(false);
    }
  }, [load]);

  if (loading && !status) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-token-muted">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading payout engine…
      </div>
    );
  }

  const qh = status?.queue_health || {};
  const counts = status?.counts_by_status || {};
  const amounts = status?.amount_by_status || {};
  const failing = status?.failing_items || [];
  const recentBatches = queue?.batches?.recent || [];
  const batchCounts = queue?.batches?.counts_by_status || {};

  return (
    <div className="p-6 space-y-6" data-testid="admin-payouts-queue">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-token-primary">Payouts v2 — Operational Queue</h1>
          <p className="text-sm text-token-muted mt-1">
            Worker <code className="font-mono">{status?.worker_id || 'n/a'}</code> ·
            mock advancer {status?.config?.mock_advance_enabled ? 'on' : 'off'} ·
            providers {Object.entries(status?.providers || {}).map(([rail, name]) => `${rail}=${name}`).join(', ')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="px-3 py-2 rounded-lg text-sm flex items-center gap-2 text-token-primary hover:bg-app-surface-elevated"
            style={{ border: '1px solid var(--token-border)' }}
            data-testid="payouts-refresh-btn"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button
            onClick={drainOnce}
            disabled={busy}
            className="px-3 py-2 rounded-lg text-sm flex items-center gap-2"
            style={{
              background: 'var(--token-primary)',
              color: 'var(--token-on-primary, #fff)',
              opacity: busy ? 0.6 : 1,
            }}
            data-testid="payouts-drain-once-btn"
          >
            <PlayCircle className="w-4 h-4" /> Drain Once
          </button>
        </div>
      </div>

      {msg && (
        <div
          className="px-4 py-3 rounded-lg text-sm"
          style={{
            background: msg.kind === 'error' ? 'var(--token-danger-tint)' : 'var(--token-success-tint)',
            color:      msg.kind === 'error' ? 'var(--token-danger)'      : 'var(--token-success)',
            border:     `1px solid ${msg.kind === 'error' ? 'var(--token-danger-border)' : 'var(--token-success-border)'}`,
          }}
          data-testid="payouts-msg"
        >
          {msg.text}
        </div>
      )}

      {/* Queue health strip — Pr-7 attention-first */}
      <section
        className="grid grid-cols-2 md:grid-cols-6 gap-3"
        data-testid="payouts-health-strip"
      >
        <HealthTile label="Ready"          value={qh.ready ?? 0}          tone="neutral" icon={<Clock className="w-4 h-4" />} testid="health-ready" />
        <HealthTile label="Pending Retry"  value={qh.pending_retry ?? 0}  tone="warning" icon={<RefreshCw className="w-4 h-4" />} testid="health-pending-retry" />
        <HealthTile label="In-flight Owned" value={qh.in_flight_owned ?? 0} tone="info"   icon={<Activity className="w-4 h-4" />} testid="health-in-flight" />
        <HealthTile label="Stale Leases"   value={qh.stale_leases ?? 0}   tone={(qh.stale_leases || 0) > 0 ? 'warning' : 'muted'} icon={<AlertTriangle className="w-4 h-4" />} testid="health-stale" />
        <HealthTile label="Stuck"          value={qh.stuck ?? 0}          tone={(qh.stuck || 0) > 0 ? 'danger' : 'muted'}        icon={<AlertTriangle className="w-4 h-4" />} testid="health-stuck" />
        <HealthTile label="Exhausted"      value={qh.exhausted ?? 0}      tone={(qh.exhausted || 0) > 0 ? 'danger' : 'muted'}    icon={<Skull className="w-4 h-4" />}        testid="health-exhausted" />
      </section>

      {/* Counts by status grid */}
      <section
        className="rounded-xl p-4"
        style={{ background: 'var(--token-surface-elevated)', border: '1px solid var(--token-border)' }}
        data-testid="payouts-status-grid"
      >
        <h2 className="text-sm font-medium text-token-primary mb-3">Items by status</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {STATE_GROUPS.map(s => (
            <div
              key={s.key}
              className="rounded-lg p-3"
              style={{ background: 'var(--token-surface)', border: '1px solid var(--token-border)' }}
              data-testid={`status-${s.key}`}
            >
              <div className="flex items-center justify-between mb-1">
                <ToneBadge tone={s.tone}>{s.label}</ToneBadge>
                <span className="text-lg font-semibold text-token-primary">{counts[s.key] ?? 0}</span>
              </div>
              <div className="text-xs text-token-muted">{fmtMoney(amounts[s.key])}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Failing items table — Pr-7 needs-attention first */}
      <section
        className="rounded-xl"
        style={{ background: 'var(--token-surface-elevated)', border: '1px solid var(--token-border)' }}
        data-testid="payouts-failing-section"
      >
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--token-border)' }}>
          <h2 className="text-sm font-medium text-token-primary">Needs attention — failing items</h2>
          <p className="text-xs text-token-muted mt-1">
            Items in queue with attempt_count {'>'} 0. Force-retry resets next_attempt_at; dead-letter terminates.
          </p>
        </div>
        {failing.length === 0 ? (
          <div className="px-4 py-6 text-sm text-token-muted flex items-center gap-2" data-testid="payouts-failing-empty">
            <CheckCircle2 className="w-4 h-4" /> No items currently retrying. Queue is healthy.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--token-border)' }}>
                  <Th>Item</Th><Th>Developer</Th><Th>Rail</Th><Th>Amount</Th>
                  <Th>Attempts</Th><Th>Next Attempt</Th><Th>Error</Th><Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {failing.map(it => (
                  <tr key={it.item_id} data-testid={`failing-row-${it.item_id}`}>
                    <Td><code className="text-xs font-mono">{it.item_id}</code></Td>
                    <Td>{it.developer_id}</Td>
                    <Td><ToneBadge tone="neutral">{it.rail}</ToneBadge></Td>
                    <Td>{fmtMoney(it.amount, it.currency)}</Td>
                    <Td><span className="font-medium text-token-warning">{it.attempt_count}</span></Td>
                    <Td>{fmtRelative(it.next_attempt_at)}</Td>
                    <Td>
                      <div className="text-xs text-token-danger truncate max-w-[200px]" title={it.last_error}>
                        {it.last_error_code ? <code className="font-mono mr-1">[{it.last_error_code}]</code> : null}
                        {it.last_error || '—'}
                      </div>
                    </Td>
                    <Td>
                      <div className="flex gap-1">
                        <button
                          onClick={() => forceRetry(it.item_id)}
                          disabled={busy}
                          className="px-2 py-1 rounded text-xs flex items-center gap-1"
                          style={{ background: 'var(--token-info-tint)', color: 'var(--token-info)', border: '1px solid var(--token-info-border)' }}
                          data-testid={`force-retry-${it.item_id}`}
                          title="Force retry now"
                        >
                          <RefreshCw className="w-3 h-3" /> Retry
                        </button>
                        <button
                          onClick={() => deadLetter(it.item_id)}
                          disabled={busy}
                          className="px-2 py-1 rounded text-xs flex items-center gap-1"
                          style={{ background: 'var(--token-danger-tint)', color: 'var(--token-danger)', border: '1px solid var(--token-danger-border)' }}
                          data-testid={`dead-letter-${it.item_id}`}
                          title="Force terminate (dead-letter)"
                        >
                          <Skull className="w-3 h-3" /> Kill
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent batches */}
      <section
        className="rounded-xl"
        style={{ background: 'var(--token-surface-elevated)', border: '1px solid var(--token-border)' }}
        data-testid="payouts-batches-section"
      >
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--token-border)' }}>
          <div>
            <h2 className="text-sm font-medium text-token-primary">Recent batches</h2>
            <p className="text-xs text-token-muted mt-1">
              Proposed {batchCounts.proposed || 0} · Released {batchCounts.released || 0} ·
              Cancelled {batchCounts.cancelled || 0} · Closed {batchCounts.closed || 0}
            </p>
          </div>
        </div>
        {recentBatches.length === 0 ? (
          <div className="px-4 py-6 text-sm text-token-muted" data-testid="payouts-batches-empty">
            No batches yet. The hybrid-cadence scheduler proposes batches automatically.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--token-border)' }}>
                  <Th>Batch</Th><Th>Label</Th><Th>Status</Th>
                  <Th>Devs</Th><Th>Items</Th><Th>Amount</Th><Th>Proposed</Th><Th>Released</Th><Th></Th>
                </tr>
              </thead>
              <tbody>
                {recentBatches.map(b => (
                  <tr key={b.batch_id} data-testid={`batch-row-${b.batch_id}`}>
                    <Td><code className="text-xs font-mono">{b.batch_id}</code></Td>
                    <Td>{b.label || '—'}</Td>
                    <Td>
                      <ToneBadge tone={b.status === 'released' ? 'success' : b.status === 'cancelled' ? 'muted' : 'info'}>
                        {b.status}
                      </ToneBadge>
                    </Td>
                    <Td>{b.totals?.developers ?? 0}</Td>
                    <Td>{b.item_count ?? b.totals?.earnings ?? '—'}</Td>
                    <Td>{fmtMoney(b.totals?.amount)}</Td>
                    <Td>{fmtRelative(b.proposed_at)}</Td>
                    <Td>{fmtRelative(b.released_at)}</Td>
                    <Td>
                      <Link
                        to={`/admin/payouts-v2/batches/${b.batch_id}`}
                        className="text-xs flex items-center gap-1 text-token-info hover:underline"
                        data-testid={`batch-link-${b.batch_id}`}
                      >
                        Open <ArrowRight className="w-3 h-3" />
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Config (read-only — knobs are env-driven) */}
      <section
        className="rounded-xl p-4 text-xs text-token-muted"
        style={{ background: 'var(--token-surface-elevated)', border: '1px solid var(--token-border)' }}
        data-testid="payouts-config-strip"
      >
        <span className="font-medium text-token-primary mr-2">Worker config (env-driven):</span>
        interval={status?.config?.interval_sec}s · batch={status?.config?.batch_size} ·
        lease={status?.config?.lease_sec}s · heartbeat={status?.config?.heartbeat_sec}s ·
        max_attempts={status?.config?.max_attempts} · timeout={status?.config?.timeout_sec}s ·
        backoff={status?.config?.backoff_base_sec}-{status?.config?.backoff_max_sec}s ·
        stuck_after={status?.config?.stuck_after_sec}s
      </section>
    </div>
  );
}

function HealthTile({ label, value, tone, icon, testid }) {
  const map = {
    success:  { fg: 'var(--token-success)', bd: 'var(--token-success-border)' },
    info:     { fg: 'var(--token-info)',    bd: 'var(--token-info-border)' },
    warning:  { fg: 'var(--token-warning)', bd: 'var(--token-warning-border)' },
    danger:   { fg: 'var(--token-danger)',  bd: 'var(--token-danger-border)' },
    neutral:  { fg: 'var(--token-primary)', bd: 'var(--token-border)' },
    muted:    { fg: 'var(--token-muted)',   bd: 'var(--token-border)' },
  };
  const s = map[tone] || map.neutral;
  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: 'var(--token-surface-elevated)',
        border: `1px solid ${s.bd}`,
      }}
      data-testid={testid}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-token-muted">{label}</span>
        <span style={{ color: s.fg }}>{icon}</span>
      </div>
      <div className="text-2xl font-semibold mt-1" style={{ color: s.fg }}>{value}</div>
    </div>
  );
}

function Th({ children }) {
  return <th className="text-left px-4 py-2 text-xs font-medium text-token-muted uppercase tracking-wider">{children}</th>;
}

function Td({ children }) {
  return <td className="px-4 py-2 text-token-primary" style={{ borderBottom: '1px solid var(--token-border)' }}>{children}</td>;
}
