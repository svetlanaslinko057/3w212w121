/**
 * PAY-V2-P5 — Admin Batch Detail (drill-down).
 *
 * Authority rule: reads /api/payouts-v2/admin/batches/{id} and per-item
 * /api/payouts-v2/admin/items/{id} for timeline. No client derivation.
 *
 * Surface:
 *   • Batch header — id, label, status, totals
 *   • Items table — each item with status, attempts, provider_ref, last_error
 *   • Per-item drill-down — expandable row showing the event timeline
 *     (worker_claimed, provider_called, initiated, in_flight, confirmed,
 *      settled, retry_scheduled, lease_expired, exhausted, failed, …)
 *   • Item-level force-retry / dead-letter inline
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { runtime } from '@/runtime';
import {
  ArrowLeft, RefreshCw, Skull, Loader2, ChevronDown, ChevronRight,
  Clock, AlertTriangle, CheckCircle2, Activity, Hash,
} from 'lucide-react';

function fmtMoney(amt) { return `$${Number(amt || 0).toFixed(2)}`; }
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

const STATE_TONE = {
  queued:     'neutral',
  initiated:  'info',
  in_flight:  'info',
  confirmed:  'info',
  settled:    'success',
  reconciled: 'success',
  failed:     'danger',
  returned:   'danger',
  disputed:   'warning',
  cancelled:  'muted',
};

function ToneBadge({ tone, children, mono }) {
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
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs ${mono ? 'font-mono' : 'font-medium'}`}
      style={{ background: s.bg, color: s.fg, border: `1px solid ${s.bd}` }}
    >
      {children}
    </span>
  );
}

export default function AdminPayoutBatchDetail() {
  const { batchId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedItem, setExpandedItem] = useState(null);
  const [itemHistory, setItemHistory] = useState({});  // {item_id: events[]}
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await runtime.get(`/api/payouts-v2/admin/batches/${batchId}`);
      setData(r.data || r);
    } catch (e) {
      setMsg({ kind: 'error', text: `Load failed: ${e?.message || e}` });
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  const loadItemHistory = useCallback(async (itemId) => {
    try {
      const r = await runtime.get(`/api/payouts-v2/admin/items/${itemId}`);
      const d = r.data || r;
      setItemHistory(prev => ({ ...prev, [itemId]: d.events || [] }));
    } catch (e) {
      setMsg({ kind: 'error', text: `History load failed: ${e?.message || e}` });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleItem = useCallback((itemId) => {
    setExpandedItem(prev => {
      if (prev === itemId) return null;
      if (!itemHistory[itemId]) loadItemHistory(itemId);
      return itemId;
    });
  }, [itemHistory, loadItemHistory]);

  const forceRetry = useCallback(async (itemId) => {
    setBusy(true);
    try {
      await runtime.post(`/api/payouts-v2/admin/items/${itemId}/force-retry`, {});
      setMsg({ kind: 'ok', text: `Force-retry queued for ${itemId}` });
      load();
      if (expandedItem === itemId) loadItemHistory(itemId);
    } catch (e) {
      setMsg({ kind: 'error', text: `Force-retry failed: ${e?.message || e}` });
    } finally {
      setBusy(false);
    }
  }, [load, loadItemHistory, expandedItem]);

  const deadLetter = useCallback(async (itemId) => {
    // eslint-disable-next-line no-alert
    const reason = window.prompt(`Dead-letter ${itemId} — short reason:`, 'admin_terminated');
    if (reason == null) return;
    setBusy(true);
    try {
      await runtime.post(`/api/payouts-v2/admin/items/${itemId}/dead-letter`, { reason });
      setMsg({ kind: 'ok', text: `Dead-lettered ${itemId}` });
      load();
      if (expandedItem === itemId) loadItemHistory(itemId);
    } catch (e) {
      setMsg({ kind: 'error', text: `Dead-letter failed: ${e?.message || e}` });
    } finally {
      setBusy(false);
    }
  }, [load, loadItemHistory, expandedItem]);

  if (loading && !data) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-token-muted">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading batch…
      </div>
    );
  }
  if (!data) {
    return <div className="p-6 text-token-danger">Batch not found.</div>;
  }

  const { batch, items = [], events = [] } = data;

  return (
    <div className="p-6 space-y-6" data-testid="admin-batch-detail">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            to="/admin/payouts-v2"
            className="text-xs text-token-muted hover:text-token-primary inline-flex items-center gap-1 mb-2"
            data-testid="batch-back-link"
          >
            <ArrowLeft className="w-3 h-3" /> Back to queue
          </Link>
          <h1 className="text-2xl font-semibold text-token-primary">
            Batch <code className="font-mono">{batch.batch_id}</code>
          </h1>
          <p className="text-sm text-token-muted mt-1">
            <ToneBadge tone={STATE_TONE[batch.status] || 'info'}>{batch.status}</ToneBadge>{' '}
            label: <strong>{batch.label || '—'}</strong> ·
            developers: {batch.totals?.developers ?? 0} ·
            amount: <strong>{fmtMoney(batch.totals?.amount)}</strong> ·
            proposed {fmtTime(batch.proposed_at)}{' · '}
            released {fmtTime(batch.released_at)}
          </p>
        </div>
        <button
          onClick={load}
          className="px-3 py-2 rounded-lg text-sm flex items-center gap-2 text-token-primary hover:bg-app-surface-elevated"
          style={{ border: '1px solid var(--token-border)' }}
          data-testid="batch-refresh-btn"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {msg && (
        <div
          className="px-4 py-3 rounded-lg text-sm"
          style={{
            background: msg.kind === 'error' ? 'var(--token-danger-tint)' : 'var(--token-success-tint)',
            color:      msg.kind === 'error' ? 'var(--token-danger)'      : 'var(--token-success)',
            border:     `1px solid ${msg.kind === 'error' ? 'var(--token-danger-border)' : 'var(--token-success-border)'}`,
          }}
          data-testid="batch-msg"
        >
          {msg.text}
        </div>
      )}

      {/* Items */}
      <section
        className="rounded-xl"
        style={{ background: 'var(--token-surface-elevated)', border: '1px solid var(--token-border)' }}
        data-testid="batch-items-section"
      >
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--token-border)' }}>
          <h2 className="text-sm font-medium text-token-primary">
            Items ({items.length})
          </h2>
          <p className="text-xs text-token-muted mt-1">
            Click a row to expand the event timeline (worker / provider / lifecycle).
          </p>
        </div>
        {items.length === 0 ? (
          <div className="px-4 py-6 text-sm text-token-muted">
            No items materialised yet. (Batches in `proposed` state have no items — release to create them.)
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--token-border)' }}>
                  <Th></Th>
                  <Th>Item</Th><Th>Developer</Th><Th>Rail</Th><Th>Amount</Th>
                  <Th>Status</Th><Th>Attempts</Th><Th>Provider Ref</Th><Th>Worker</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => {
                  const open = expandedItem === it.item_id;
                  const tone = STATE_TONE[it.status] || 'neutral';
                  return (
                    <>
                      <tr
                        key={it.item_id}
                        onClick={() => toggleItem(it.item_id)}
                        className="cursor-pointer hover:bg-app-surface-elevated"
                        data-testid={`batch-item-row-${it.item_id}`}
                      >
                        <Td>{open ? <ChevronDown className="w-4 h-4 text-token-muted" /> : <ChevronRight className="w-4 h-4 text-token-muted" />}</Td>
                        <Td><code className="text-xs font-mono">{it.item_id}</code></Td>
                        <Td>{it.developer_id}</Td>
                        <Td><ToneBadge tone="neutral">{it.rail}</ToneBadge></Td>
                        <Td>{fmtMoney(it.amount)}</Td>
                        <Td><ToneBadge tone={tone}>{it.status}</ToneBadge></Td>
                        <Td>
                          {it.attempt_count > 0 ? (
                            <span className="font-medium text-token-warning">{it.attempt_count}</span>
                          ) : (
                            <span className="text-token-muted">0</span>
                          )}
                          {it.dead_lettered && (
                            <ToneBadge tone="danger" mono>
                              <Skull className="w-3 h-3 mr-1" /> exhausted
                            </ToneBadge>
                          )}
                        </Td>
                        <Td>
                          {it.provider_ref ? (
                            <code className="text-xs font-mono text-token-muted">{it.provider_ref}</code>
                          ) : '—'}
                        </Td>
                        <Td>
                          {it.claimed_by ? (
                            <span className="text-xs text-token-info flex items-center gap-1">
                              <Activity className="w-3 h-3" /> {it.claimed_by.slice(-6)}
                            </span>
                          ) : '—'}
                        </Td>
                        <Td onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-1">
                            <button
                              onClick={() => forceRetry(it.item_id)}
                              disabled={busy || it.status !== 'queued'}
                              className="px-2 py-1 rounded text-xs flex items-center gap-1 disabled:opacity-30"
                              style={{ background: 'var(--token-info-tint)', color: 'var(--token-info)', border: '1px solid var(--token-info-border)' }}
                              data-testid={`batch-item-retry-${it.item_id}`}
                            >
                              <RefreshCw className="w-3 h-3" /> Retry
                            </button>
                            <button
                              onClick={() => deadLetter(it.item_id)}
                              disabled={busy || it.status !== 'queued'}
                              className="px-2 py-1 rounded text-xs flex items-center gap-1 disabled:opacity-30"
                              style={{ background: 'var(--token-danger-tint)', color: 'var(--token-danger)', border: '1px solid var(--token-danger-border)' }}
                              data-testid={`batch-item-kill-${it.item_id}`}
                            >
                              <Skull className="w-3 h-3" /> Kill
                            </button>
                          </div>
                        </Td>
                      </tr>
                      {open && (
                        <tr style={{ background: 'var(--token-surface)' }} data-testid={`batch-item-timeline-${it.item_id}`}>
                          <td colSpan={10} className="px-4 py-3">
                            <ItemTimeline
                              item={it}
                              events={itemHistory[it.item_id] || []}
                              loading={!itemHistory[it.item_id]}
                            />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Batch event history */}
      <section
        className="rounded-xl"
        style={{ background: 'var(--token-surface-elevated)', border: '1px solid var(--token-border)' }}
        data-testid="batch-events-section"
      >
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--token-border)' }}>
          <h2 className="text-sm font-medium text-token-primary">Batch event log</h2>
        </div>
        {events.length === 0 ? (
          <div className="px-4 py-6 text-sm text-token-muted">No batch events yet.</div>
        ) : (
          <ul className="px-4 py-3 space-y-1.5 text-xs">
            {events.map(e => (
              <li key={e.event_id} className="flex items-center gap-3" data-testid={`batch-event-${e.event_id}`}>
                <span className="text-token-muted font-mono w-44 flex-shrink-0">{fmtTime(e.created_at)}</span>
                <ToneBadge tone="info" mono>{e.kind}</ToneBadge>
                <span className="text-token-muted">by</span>
                <span className="text-token-primary font-mono">{e.actor}</span>
                {e.reason && <span className="text-token-muted italic">— {e.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ItemTimeline({ item, events, loading }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-token-muted">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading timeline…
      </div>
    );
  }
  // Worker tracking fields → small strip on top
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <Fact label="Idempotency key" mono value={item.idempotency_key} />
        <Fact label="Next attempt at"    value={fmtTime(item.next_attempt_at)} />
        <Fact label="Lease until"        value={fmtTime(item.lease_until)} />
        <Fact label="Last heartbeat"     value={fmtTime(item.last_heartbeat)} />
        <Fact label="Last error code" mono value={item.last_error_code || '—'} />
        <Fact label="Last error"         value={item.last_error || '—'} />
        <Fact label="Initiated at"       value={fmtTime(item.initiated_at)} />
        <Fact label="Settled at"         value={fmtTime(item.settled_at)} />
      </div>
      <div>
        <h3 className="text-xs font-medium text-token-muted uppercase tracking-wider mb-2">
          Event timeline ({events.length})
        </h3>
        {events.length === 0 ? (
          <div className="text-xs text-token-muted">No events recorded.</div>
        ) : (
          <ul className="space-y-1.5">
            {events.map(e => (
              <li key={e.event_id} className="flex items-start gap-3 text-xs">
                <span className="text-token-muted font-mono w-44 flex-shrink-0">{fmtTime(e.created_at)}</span>
                <ToneBadge tone={timelineTone(e.kind)} mono>{e.kind}</ToneBadge>
                <span className="text-token-muted">by</span>
                <span className="text-token-primary font-mono flex-shrink-0">{e.actor}</span>
                {e.payload && Object.keys(e.payload).length > 0 && (
                  <code className="text-token-muted text-[10px] truncate">
                    {JSON.stringify(e.payload)}
                  </code>
                )}
                {e.reason && <span className="text-token-muted italic">— {e.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value, mono }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-token-muted">{label}</div>
      <div className={`text-token-primary ${mono ? 'font-mono text-[11px]' : 'text-xs'}`}>
        {value || '—'}
      </div>
    </div>
  );
}

function timelineTone(kind) {
  if (['settled', 'reconciled', 'confirmed'].includes(kind)) return 'success';
  if (['failed', 'exhausted', 'admin_force_dead_letter', 'lease_expired', 'returned'].includes(kind)) return 'danger';
  if (['retry_scheduled', 'admin_force_retry', 'disputed'].includes(kind)) return 'warning';
  if (['worker_claimed', 'provider_called', 'initiated', 'in_flight'].includes(kind)) return 'info';
  return 'neutral';
}

function Th({ children }) {
  return <th className="text-left px-4 py-2 text-xs font-medium text-token-muted uppercase tracking-wider">{children}</th>;
}
function Td({ children, onClick }) {
  return <td className="px-4 py-2 text-token-primary" style={{ borderBottom: '1px solid var(--token-border)' }} onClick={onClick}>{children}</td>;
}
