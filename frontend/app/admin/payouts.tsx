/**
 * PAY-V2-P5 — Admin Payouts (Expo mobile).
 *
 * Pr-7 queue-first: attention-first surface. Operator sees needs-attention
 * items at the top, then queue health, then recent batches. No finance
 * dashboard overload — the heavy lifting lives in the web admin.
 *
 * Authority rule: ALL aggregates read from backend.
 *   • GET /api/payouts-v2/admin/worker/status
 *   • GET /api/payouts-v2/admin/queue
 *
 * Actions:
 *   • Force-retry / dead-letter on failing items
 *   • Drain Once (manual cycle kick — for impatience during demos)
 *
 * Roles allowed: admin (server enforces).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, Alert,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/api';
import T from '../../src/theme';

type WorkerStatus = {
  worker_id: string;
  config: Record<string, any>;
  queue_health: {
    ready: number;
    pending_retry: number;
    in_flight_owned: number;
    stale_leases: number;
    stuck: number;
    exhausted: number;
  };
  counts_by_status: Record<string, number>;
  amount_by_status: Record<string, number>;
  failing_items: Array<{
    item_id: string;
    developer_id: string;
    rail: string;
    amount: number;
    currency: string;
    attempt_count: number;
    last_error: string | null;
    last_error_code: string | null;
    next_attempt_at: string | null;
  }>;
  providers: Record<string, string>;
  as_of: string;
};

type Queue = {
  batches: {
    counts_by_status: Record<string, number>;
    recent: Array<{
      batch_id: string;
      label: string | null;
      status: string;
      totals: { developers: number; amount: number };
      proposed_at: string | null;
      released_at: string | null;
      item_count?: number;
    }>;
  };
};

function fmtMoney(n: number) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function fmtRel(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function AdminPayoutsScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, q] = await Promise.all([
        api.get('/payouts-v2/admin/worker/status'),
        api.get('/payouts-v2/admin/queue'),
      ]);
      setStatus(s.data);
      setQueue(q.data);
    } catch (e: any) {
      Alert.alert('Load failed', e?.message || String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const drain = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api.post('/payouts-v2/admin/worker/drain-once', {});
      const d = r.data || {};
      Alert.alert(
        'Drain complete',
        `Processed: ${d.drained?.processed ?? 0}\n` +
        `Advanced: ${d.advanced?.advanced ?? 0}\n` +
        `Reaped:   ${d.reaped?.reclaimed ?? 0}`
      );
      load();
    } catch (e: any) {
      Alert.alert('Drain failed', e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [load]);

  const forceRetry = useCallback((itemId: string) => {
    Alert.alert(
      'Force retry',
      `Move ${itemId} back into the claim pool now?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Retry now',
          onPress: async () => {
            setBusy(true);
            try {
              await api.post(`/payouts-v2/admin/items/${itemId}/force-retry`, {});
              load();
            } catch (e: any) {
              Alert.alert('Force-retry failed', e?.message || String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }, [load]);

  const deadLetter = useCallback((itemId: string) => {
    Alert.alert(
      'Dead-letter item',
      `Terminate ${itemId}? This is irreversible — the item moves to failed/exhausted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Terminate',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await api.post(`/payouts-v2/admin/items/${itemId}/dead-letter`, { reason: 'mobile_admin_terminated' });
              load();
            } catch (e: any) {
              Alert.alert('Dead-letter failed', e?.message || String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }, [load]);

  if (loading && !status) {
    return (
      <View style={styles.center} testID="admin-payouts-loading">
        <ActivityIndicator color={T.primary as any} />
        <Text style={styles.muted}>Loading payout engine…</Text>
      </View>
    );
  }

  const qh = status?.queue_health || { ready: 0, pending_retry: 0, in_flight_owned: 0, stale_leases: 0, stuck: 0, exhausted: 0 };
  const counts = status?.counts_by_status || {};
  const amounts = status?.amount_by_status || {};
  const failing = status?.failing_items || [];
  const recent = queue?.batches?.recent || [];

  const needsAttention = (qh.exhausted || 0) + (qh.stuck || 0) + (qh.stale_leases || 0) + failing.length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={T.primary as any}
        />
      }
      testID="admin-payouts-screen"
    >
      <Stack.Screen options={{ title: 'Payouts · Operations' }} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Payouts</Text>
        <Text style={styles.subtitle}>
          Worker {status?.worker_id?.slice(-8) || '—'} · {Object.keys(status?.providers || {}).length} rails
        </Text>
      </View>

      {/* Drain Once */}
      <TouchableOpacity
        onPress={drain}
        disabled={busy}
        style={[styles.drainBtn, busy && { opacity: 0.5 }]}
        testID="admin-payouts-drain-btn"
      >
        <Ionicons name="play-circle" size={18} color="#fff" />
        <Text style={styles.drainBtnText}>Drain Once</Text>
      </TouchableOpacity>

      {/* Needs attention strip — Pr-7 */}
      {needsAttention > 0 && (
        <View style={styles.attentionBanner} testID="admin-payouts-attention">
          <Ionicons name="warning" size={16} color={T.warning as any} />
          <Text style={styles.attentionText}>
            {needsAttention} item(s) need attention
          </Text>
        </View>
      )}

      {/* Health tiles — 2-col grid */}
      <View style={styles.healthGrid}>
        <HealthTile testID="health-ready" label="Ready"            value={qh.ready}            tone="neutral" icon="time-outline" />
        <HealthTile testID="health-pending-retry" label="Pending Retry"    value={qh.pending_retry}    tone="warning" icon="refresh-outline" />
        <HealthTile testID="health-in-flight" label="In Flight"        value={qh.in_flight_owned}  tone="info"    icon="pulse-outline" />
        <HealthTile testID="health-stale" label="Stale Leases"     value={qh.stale_leases}     tone={qh.stale_leases > 0 ? 'warning' : 'muted'} icon="alert-outline" />
        <HealthTile testID="health-stuck" label="Stuck"            value={qh.stuck}            tone={qh.stuck > 0 ? 'danger' : 'muted'}        icon="alert-circle-outline" />
        <HealthTile testID="health-exhausted" label="Exhausted"        value={qh.exhausted}        tone={qh.exhausted > 0 ? 'danger' : 'muted'}    icon="skull-outline" />
      </View>

      {/* Counts by status */}
      <Text style={styles.sectionLabel}>By status</Text>
      <View style={styles.statusGrid}>
        {[
          { key: 'queued',    label: 'Queued',    tone: 'neutral' as const },
          { key: 'initiated', label: 'Initiated', tone: 'info' as const },
          { key: 'in_flight', label: 'In Flight', tone: 'info' as const },
          { key: 'settled',   label: 'Settled',   tone: 'success' as const },
          { key: 'failed',    label: 'Failed',    tone: 'danger' as const },
          { key: 'cancelled', label: 'Cancelled', tone: 'muted' as const },
        ].map(s => (
          <View key={s.key} style={styles.statusCell} testID={`admin-status-${s.key}`}>
            <View style={[styles.statusDot, { backgroundColor: toneColor(s.tone) }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.statusLabel}>{s.label}</Text>
              <Text style={styles.statusValue}>
                {counts[s.key] ?? 0} <Text style={styles.muted}>· {fmtMoney(amounts[s.key])}</Text>
              </Text>
            </View>
          </View>
        ))}
      </View>

      {/* Failing items */}
      <Text style={styles.sectionLabel}>Needs attention — failing items</Text>
      {failing.length === 0 ? (
        <View style={styles.emptyCard} testID="admin-payouts-failing-empty">
          <Ionicons name="checkmark-circle" size={18} color={T.success as any} />
          <Text style={styles.body}>Queue is healthy. No retrying items.</Text>
        </View>
      ) : (
        failing.map(it => (
          <View key={it.item_id} style={styles.failingCard} testID={`failing-card-${it.item_id}`}>
            <View style={styles.failingHead}>
              <Text style={styles.failingTitle} numberOfLines={1}>
                {fmtMoney(it.amount)} · {it.rail}
              </Text>
              <Text style={styles.failingAttempts}>×{it.attempt_count}</Text>
            </View>
            <Text style={styles.muted} numberOfLines={1}>
              {it.developer_id} · {it.item_id}
            </Text>
            <Text style={styles.errText} numberOfLines={2}>
              {it.last_error_code && <Text style={styles.errCode}>[{it.last_error_code}] </Text>}
              {it.last_error || 'pending retry'}
            </Text>
            <Text style={styles.muted}>Next attempt: {fmtRel(it.next_attempt_at)}</Text>
            <View style={styles.actionRow}>
              <TouchableOpacity
                onPress={() => forceRetry(it.item_id)}
                disabled={busy}
                style={[styles.actionBtn, { borderColor: T.info as any }]}
                testID={`mobile-force-retry-${it.item_id}`}
              >
                <Ionicons name="refresh" size={14} color={T.info as any} />
                <Text style={[styles.actionBtnText, { color: T.info as any }]}>Retry</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => deadLetter(it.item_id)}
                disabled={busy}
                style={[styles.actionBtn, { borderColor: T.danger as any }]}
                testID={`mobile-dead-letter-${it.item_id}`}
              >
                <Ionicons name="skull" size={14} color={T.danger as any} />
                <Text style={[styles.actionBtnText, { color: T.danger as any }]}>Kill</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}

      {/* Recent batches */}
      <Text style={styles.sectionLabel}>Recent batches</Text>
      {recent.length === 0 ? (
        <View style={styles.emptyCard} testID="admin-payouts-batches-empty">
          <Ionicons name="hourglass-outline" size={18} color={T.textMuted as any} />
          <Text style={styles.body}>No batches yet. Scheduler proposes them automatically.</Text>
        </View>
      ) : (
        recent.map(b => (
          <TouchableOpacity
            key={b.batch_id}
            style={styles.batchCard}
            onPress={() => router.push({ pathname: '/admin/payout-batch/[batchId]', params: { batchId: b.batch_id } })}
            testID={`mobile-batch-${b.batch_id}`}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.batchTitle} numberOfLines={1}>
                {b.label || 'manual'} · {fmtMoney(b.totals?.amount)}
              </Text>
              <Text style={styles.muted} numberOfLines={1}>
                {b.batch_id} · {b.totals?.developers ?? 0} devs · {b.item_count ?? 0} items
              </Text>
              <Text style={styles.muted}>
                {b.status} · released {fmtRel(b.released_at)}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={T.textMuted as any} />
          </TouchableOpacity>
        ))
      )}

      {/* Worker config footer (env-driven, read-only) */}
      {status?.config && (
        <View style={styles.configCard} testID="admin-payouts-config">
          <Text style={styles.configHead}>Worker config (env-driven)</Text>
          <Text style={styles.configLine}>
            interval={status.config.interval_sec}s · batch={status.config.batch_size} · lease={status.config.lease_sec}s
          </Text>
          <Text style={styles.configLine}>
            max_attempts={status.config.max_attempts} · backoff {status.config.backoff_base_sec}-{status.config.backoff_max_sec}s · timeout={status.config.timeout_sec}s
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function toneColor(tone: 'neutral' | 'info' | 'success' | 'danger' | 'warning' | 'muted') {
  switch (tone) {
    case 'success': return T.success as any;
    case 'info':    return T.info as any;
    case 'danger':  return T.danger as any;
    case 'warning': return T.warning as any;
    case 'muted':   return T.textMuted as any;
    default:        return T.text as any;
  }
}

function HealthTile({
  label, value, tone, icon, testID,
}: { label: string; value: number; tone: 'neutral' | 'info' | 'success' | 'danger' | 'warning' | 'muted'; icon: any; testID?: string }) {
  return (
    <View style={[styles.healthTile, { borderColor: toneColor(tone) }]} testID={testID}>
      <View style={styles.healthRow}>
        <Text style={styles.healthLabel}>{label}</Text>
        <Ionicons name={icon} size={14} color={toneColor(tone)} />
      </View>
      <Text style={[styles.healthValue, { color: toneColor(tone) }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg as any, padding: 16 },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: T.bg as any, padding: 24 },
  header:    { marginBottom: 12 },
  title:     { color: T.text as any, fontSize: 24, fontWeight: '700' },
  subtitle:  { color: T.textMuted as any, fontSize: 12, marginTop: 4 },
  drainBtn:  {
    backgroundColor: T.primary as any, paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: 10, alignSelf: 'flex-start', flexDirection: 'row',
    alignItems: 'center', gap: 6, marginBottom: 16,
  },
  drainBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  attentionBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: T.surface as any, borderColor: T.warning as any,
    borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 16,
  },
  attentionText: { color: T.warning as any, fontWeight: '600', fontSize: 14 },
  healthGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16,
  },
  healthTile: {
    flexBasis: '31%', flexGrow: 1, minWidth: 100,
    backgroundColor: T.surface as any, borderWidth: 1, borderRadius: 10, padding: 10,
  },
  healthRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  healthLabel: { color: T.textMuted as any, fontSize: 11 },
  healthValue: { fontSize: 22, fontWeight: '700', marginTop: 4 },
  sectionLabel: {
    color: T.textMuted as any, fontSize: 12, fontWeight: '700',
    letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 8, marginBottom: 8,
  },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  statusCell: {
    flexBasis: '47%', flexGrow: 1, minWidth: 120,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: T.surface as any, borderColor: T.border as any,
    borderWidth: 1, borderRadius: 10, padding: 10,
  },
  statusDot:   { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { color: T.textMuted as any, fontSize: 11 },
  statusValue: { color: T.text as any, fontSize: 15, fontWeight: '600' },
  body:        { color: T.text as any, fontSize: 14 },
  muted:       { color: T.textMuted as any, fontSize: 12 },
  emptyCard:   {
    backgroundColor: T.surface as any, borderColor: T.border as any, borderWidth: 1,
    borderRadius: 10, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 16,
  },
  failingCard: {
    backgroundColor: T.surface as any, borderColor: T.danger as any, borderWidth: 1,
    borderRadius: 10, padding: 12, marginBottom: 10,
  },
  failingHead: { flexDirection: 'row', justifyContent: 'space-between' },
  failingTitle: { color: T.text as any, fontSize: 15, fontWeight: '600' },
  failingAttempts: { color: T.warning as any, fontSize: 13, fontWeight: '700' },
  errText: { color: T.danger as any, fontSize: 12, marginTop: 4 },
  errCode: { fontFamily: 'Courier', fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
    borderWidth: 1,
  },
  actionBtnText: { fontSize: 12, fontWeight: '600' },
  batchCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: T.surface as any, borderColor: T.border as any, borderWidth: 1,
    borderRadius: 10, padding: 12, marginBottom: 8,
  },
  batchTitle: { color: T.text as any, fontSize: 15, fontWeight: '600' },
  configCard: {
    marginTop: 16, padding: 12, borderRadius: 10, borderWidth: 1,
    borderColor: T.border as any, backgroundColor: T.surface as any,
  },
  configHead: { color: T.textMuted as any, fontSize: 11, fontWeight: '700', marginBottom: 4, textTransform: 'uppercase' },
  configLine: { color: T.textSecondary as any, fontSize: 11, fontFamily: 'Courier' },
});
