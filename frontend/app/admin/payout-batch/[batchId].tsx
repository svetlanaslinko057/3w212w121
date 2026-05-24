/**
 * PAY-V2-P5 — Admin Batch Detail (Expo mobile).
 *
 * Lightweight drill-down. Items list with status + attempt count + last
 * error. Tap an item to expand its event timeline (worker_claimed,
 * provider_called, initiated, in_flight, confirmed, settled, retry_scheduled,
 * exhausted, failed, …).
 *
 * Reads:
 *   • GET /api/payouts-v2/admin/batches/{id}
 *   • GET /api/payouts-v2/admin/items/{id}
 *
 * Mutations (mirror web): force-retry, dead-letter.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, Alert,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../../src/api';
import T from '../../../src/theme';

type Item = {
  item_id: string;
  developer_id: string;
  rail: string;
  amount: number;
  status: string;
  attempt_count: number;
  dead_lettered?: boolean;
  provider_ref?: string | null;
  claimed_by?: string | null;
  last_error?: string | null;
  last_error_code?: string | null;
  next_attempt_at?: string | null;
  lease_until?: string | null;
  last_heartbeat?: string | null;
  initiated_at?: string | null;
  settled_at?: string | null;
  idempotency_key?: string;
};

type Event = {
  event_id: string;
  scope: string;
  subject_id: string;
  kind: string;
  actor: string;
  payload?: any;
  reason?: string | null;
  created_at: string;
};

type BatchPayload = {
  batch: any;
  items: Item[];
  events: Event[];
};

const STATE_TONE: Record<string, 'success' | 'info' | 'danger' | 'warning' | 'muted' | 'neutral'> = {
  queued: 'neutral', initiated: 'info', in_flight: 'info', confirmed: 'info',
  settled: 'success', reconciled: 'success',
  failed: 'danger', returned: 'danger',
  disputed: 'warning', cancelled: 'muted',
};

function fmtMoney(n: number) { return `$${Number(n || 0).toFixed(2)}`; }
function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function toneColor(t: string) {
  switch (t) {
    case 'success': return T.success as any;
    case 'info':    return T.info as any;
    case 'danger':  return T.danger as any;
    case 'warning': return T.warning as any;
    case 'muted':   return T.textMuted as any;
    default:        return T.text as any;
  }
}

function timelineTone(kind: string): 'success' | 'info' | 'danger' | 'warning' | 'neutral' {
  if (['settled', 'reconciled', 'confirmed'].includes(kind)) return 'success';
  if (['failed', 'exhausted', 'admin_force_dead_letter', 'lease_expired', 'returned'].includes(kind)) return 'danger';
  if (['retry_scheduled', 'admin_force_retry', 'disputed'].includes(kind)) return 'warning';
  if (['worker_claimed', 'provider_called', 'initiated', 'in_flight'].includes(kind)) return 'info';
  return 'neutral';
}

export default function BatchDetailScreen() {
  const { batchId } = useLocalSearchParams<{ batchId: string }>();
  const [data, setData] = useState<BatchPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [itemEvents, setItemEvents] = useState<Record<string, Event[]>>({});

  const load = useCallback(async () => {
    if (!batchId) return;
    try {
      const r = await api.get(`/payouts-v2/admin/batches/${batchId}`);
      setData(r.data);
    } catch (e: any) {
      Alert.alert('Load failed', e?.message || String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [batchId]);

  const loadItem = useCallback(async (itemId: string) => {
    try {
      const r = await api.get(`/payouts-v2/admin/items/${itemId}`);
      setItemEvents(prev => ({ ...prev, [itemId]: r.data.events || [] }));
    } catch (e: any) {
      Alert.alert('Item load failed', e?.message || String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = useCallback((itemId: string) => {
    setExpanded(prev => {
      if (prev === itemId) return null;
      if (!itemEvents[itemId]) loadItem(itemId);
      return itemId;
    });
  }, [itemEvents, loadItem]);

  const action = useCallback((itemId: string, kind: 'retry' | 'kill') => {
    const isKill = kind === 'kill';
    Alert.alert(
      isKill ? 'Dead-letter item' : 'Force retry',
      isKill ? `Terminate ${itemId}? Irreversible.` : `Retry ${itemId} now?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isKill ? 'Terminate' : 'Retry',
          style: isKill ? 'destructive' : 'default',
          onPress: async () => {
            setBusy(true);
            try {
              await api.post(
                `/payouts-v2/admin/items/${itemId}/${isKill ? 'dead-letter' : 'force-retry'}`,
                isKill ? { reason: 'mobile_admin_terminated' } : {},
              );
              load();
              if (expanded === itemId) loadItem(itemId);
            } catch (e: any) {
              Alert.alert('Action failed', e?.message || String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }, [load, loadItem, expanded]);

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={T.primary as any} />
        <Text style={styles.muted}>Loading batch…</Text>
      </View>
    );
  }
  if (!data) {
    return <View style={styles.center}><Text style={styles.danger}>Batch not found.</Text></View>;
  }
  const { batch, items, events } = data;
  const tone = STATE_TONE[batch.status] || 'neutral';

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
      testID="batch-detail-screen"
    >
      <Stack.Screen options={{ title: 'Batch · Detail' }} />

      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>{batch.batch_id}</Text>
        <View style={styles.headerRow}>
          <View style={[styles.tag, { borderColor: toneColor(tone), backgroundColor: T.surface as any }]}>
            <Text style={[styles.tagText, { color: toneColor(tone) }]}>{batch.status}</Text>
          </View>
          <Text style={styles.muted}>{batch.label || '—'}</Text>
        </View>
        <Text style={styles.muted}>
          {batch.totals?.developers ?? 0} devs · {fmtMoney(batch.totals?.amount)} · released {fmtTime(batch.released_at)}
        </Text>
      </View>

      <Text style={styles.sectionLabel}>Items ({items.length})</Text>
      {items.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.body}>No items materialised yet.</Text>
        </View>
      ) : items.map(it => {
        const itTone = STATE_TONE[it.status] || 'neutral';
        const open = expanded === it.item_id;
        const ev = itemEvents[it.item_id];
        return (
          <View key={it.item_id} style={styles.itemCard} testID={`mobile-item-${it.item_id}`}>
            <TouchableOpacity onPress={() => toggle(it.item_id)} style={styles.itemHead}>
              <View style={{ flex: 1 }}>
                <View style={styles.itemTopRow}>
                  <Text style={styles.itemTitle}>{fmtMoney(it.amount)} · {it.rail}</Text>
                  <View style={[styles.tag, { borderColor: toneColor(itTone) }]}>
                    <Text style={[styles.tagText, { color: toneColor(itTone) }]}>{it.status}</Text>
                  </View>
                </View>
                <Text style={styles.muted} numberOfLines={1}>
                  {it.developer_id} · {it.item_id}
                </Text>
                {it.attempt_count > 0 && (
                  <Text style={styles.muted}>
                    Attempts: <Text style={{ color: T.warning as any, fontWeight: '600' }}>{it.attempt_count}</Text>
                    {it.dead_lettered && <Text style={{ color: T.danger as any }}> · exhausted</Text>}
                  </Text>
                )}
                {it.last_error && (
                  <Text style={styles.errText} numberOfLines={2}>
                    {it.last_error_code && <Text style={styles.errCode}>[{it.last_error_code}] </Text>}
                    {it.last_error}
                  </Text>
                )}
              </View>
              <Ionicons
                name={open ? 'chevron-down' : 'chevron-forward'}
                size={20}
                color={T.textMuted as any}
              />
            </TouchableOpacity>

            {open && (
              <View style={styles.itemBody}>
                <Fact label="Idempotency" value={it.idempotency_key || '—'} mono />
                <Fact label="Provider ref" value={it.provider_ref || '—'} mono />
                <Fact label="Claimed by"   value={it.claimed_by || '—'} mono />
                <Fact label="Lease until"  value={fmtTime(it.lease_until)} />
                <Fact label="Last heartbeat" value={fmtTime(it.last_heartbeat)} />
                <Fact label="Initiated at" value={fmtTime(it.initiated_at)} />
                <Fact label="Settled at"   value={fmtTime(it.settled_at)} />
                <Fact label="Next attempt" value={fmtTime(it.next_attempt_at)} />

                <Text style={[styles.sectionLabel, { marginTop: 10 }]}>Timeline</Text>
                {!ev ? (
                  <ActivityIndicator color={T.primary as any} />
                ) : ev.length === 0 ? (
                  <Text style={styles.muted}>No events recorded.</Text>
                ) : ev.map(e => {
                  const t = timelineTone(e.kind);
                  return (
                    <View key={e.event_id} style={styles.eventRow}>
                      <Text style={styles.eventTime}>{fmtTime(e.created_at)}</Text>
                      <View style={[styles.tag, { borderColor: toneColor(t), backgroundColor: T.surface as any }]}>
                        <Text style={[styles.tagText, { color: toneColor(t) }]}>{e.kind}</Text>
                      </View>
                      <Text style={styles.muted} numberOfLines={1}>by {e.actor}</Text>
                    </View>
                  );
                })}

                {it.status === 'queued' && (
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      onPress={() => action(it.item_id, 'retry')}
                      disabled={busy}
                      style={[styles.actionBtn, { borderColor: T.info as any }]}
                      testID={`mobile-item-retry-${it.item_id}`}
                    >
                      <Ionicons name="refresh" size={14} color={T.info as any} />
                      <Text style={[styles.actionBtnText, { color: T.info as any }]}>Retry now</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => action(it.item_id, 'kill')}
                      disabled={busy}
                      style={[styles.actionBtn, { borderColor: T.danger as any }]}
                      testID={`mobile-item-kill-${it.item_id}`}
                    >
                      <Ionicons name="skull" size={14} color={T.danger as any} />
                      <Text style={[styles.actionBtnText, { color: T.danger as any }]}>Dead-letter</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          </View>
        );
      })}

      {/* Batch-scope events */}
      <Text style={styles.sectionLabel}>Batch events</Text>
      {events.length === 0 ? (
        <View style={styles.emptyCard}><Text style={styles.muted}>No batch events.</Text></View>
      ) : events.map(e => (
        <View key={e.event_id} style={styles.batchEventRow}>
          <Text style={styles.eventTime}>{fmtTime(e.created_at)}</Text>
          <View style={[styles.tag, { borderColor: toneColor(timelineTone(e.kind)), backgroundColor: T.surface as any }]}>
            <Text style={[styles.tagText, { color: toneColor(timelineTone(e.kind)) }]}>{e.kind}</Text>
          </View>
          <Text style={styles.muted} numberOfLines={1}>by {e.actor}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.factRow}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={[styles.factValue, mono && { fontFamily: 'Courier', fontSize: 11 }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg as any, padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: T.bg as any, padding: 24 },
  header: { marginBottom: 16 },
  title: { color: T.text as any, fontSize: 18, fontWeight: '700' },
  headerRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 6 },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1, backgroundColor: T.surface as any },
  tagText: { fontSize: 11, fontWeight: '700' },
  sectionLabel: {
    color: T.textMuted as any, fontSize: 12, fontWeight: '700',
    letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 8, marginBottom: 8,
  },
  emptyCard: {
    backgroundColor: T.surface as any, borderColor: T.border as any, borderWidth: 1,
    borderRadius: 10, padding: 16, marginBottom: 16,
  },
  itemCard: {
    backgroundColor: T.surface as any, borderColor: T.border as any, borderWidth: 1,
    borderRadius: 10, marginBottom: 10, overflow: 'hidden',
  },
  itemHead: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  itemTitle: { color: T.text as any, fontSize: 15, fontWeight: '600' },
  itemBody: { padding: 12, borderTopWidth: 1, borderTopColor: T.border as any, gap: 4 },
  factRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  factLabel: { color: T.textMuted as any, fontSize: 12 },
  factValue: { color: T.text as any, fontSize: 12, maxWidth: '60%' },
  eventRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4,
  },
  batchEventRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6,
    paddingHorizontal: 10, backgroundColor: T.surface as any,
    borderColor: T.border as any, borderWidth: 1, borderRadius: 8, marginBottom: 6,
  },
  eventTime: { color: T.textMuted as any, fontSize: 11, minWidth: 90 },
  errText: { color: T.danger as any, fontSize: 12, marginTop: 4 },
  errCode: { fontFamily: 'Courier', fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1,
  },
  actionBtnText: { fontSize: 12, fontWeight: '600' },
  body:  { color: T.text as any, fontSize: 14 },
  muted: { color: T.textMuted as any, fontSize: 12 },
  danger:{ color: T.danger as any, fontSize: 14 },
});
