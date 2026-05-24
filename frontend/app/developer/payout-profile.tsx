/**
 * PAY-V2-P5 — Developer Payout Profile (self-service) + payout history.
 *
 * Per Pr-9 soft KYC: developer can edit preferred_rail, country, rail_config
 * fields. They CANNOT self-elevate KYC status — the backend enforces this
 * by stripping `kyc_status`/`kyc_notes` from the PUT body before write.
 *
 * Reads:
 *   • GET /api/payouts-v2/developer/payment-profile
 *   • GET /api/payouts-v2/developer/items
 *
 * Writes:
 *   • PUT /api/payouts-v2/developer/payment-profile
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, Alert, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/api';
import T from '../../src/theme';

type Profile = {
  developer_id: string;
  country: string | null;
  preferred_rail: string;
  rail_config: Record<string, any>;
  kyc_status: 'soft' | 'verified' | 'rejected' | string;
  kyc_notes?: string | null;
  ephemeral?: boolean;
  updated_at?: string;
};

type Item = {
  item_id: string;
  batch_id: string;
  amount: number;
  currency: string;
  rail: string;
  status: string;
  provider_ref?: string | null;
  attempt_count: number;
  dead_lettered?: boolean;
  last_error?: string | null;
  created_at: string;
  settled_at?: string | null;
};

const RAIL_OPTIONS = [
  { key: 'mock',           label: 'Mock (sandbox)', kyc: 'soft' as const },
  { key: 'stripe_connect', label: 'Stripe Connect (soon)', kyc: 'verified' as const, disabled: true },
  { key: 'paypal',         label: 'PayPal Payouts (soon)', kyc: 'verified' as const, disabled: true },
];

function fmtMoney(n: number) { return `$${Number(n || 0).toFixed(2)}`; }
function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

const STATUS_TONE: Record<string, 'success' | 'info' | 'danger' | 'warning' | 'muted' | 'neutral'> = {
  queued: 'neutral', initiated: 'info', in_flight: 'info', confirmed: 'info',
  settled: 'success', reconciled: 'success',
  failed: 'danger', returned: 'danger',
  disputed: 'warning', cancelled: 'muted',
};

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

export default function DeveloperPayoutProfileScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit buffer
  const [country, setCountry] = useState('');
  const [preferredRail, setPreferredRail] = useState('mock');
  const [accountHint, setAccountHint] = useState('');

  const load = useCallback(async () => {
    try {
      const [pr, it] = await Promise.all([
        api.get('/payouts-v2/developer/payment-profile'),
        api.get('/payouts-v2/developer/items'),
      ]);
      const p: Profile = pr.data;
      setProfile(p);
      setCountry(p.country || '');
      setPreferredRail(p.preferred_rail || 'mock');
      setAccountHint((p.rail_config && (p.rail_config.account_hint || p.rail_config.email)) || '');
      setItems(it.data?.items || []);
    } catch (e: any) {
      Alert.alert('Load failed', e?.message || String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const patch: any = {
        country: country.trim() || null,
        preferred_rail: preferredRail,
        rail_config: { account_hint: accountHint.trim() || null },
      };
      const r = await api.put('/payouts-v2/developer/payment-profile', patch);
      setProfile(r.data);
      Alert.alert('Saved', 'Payout profile updated.');
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }, [country, preferredRail, accountHint]);

  if (loading && !profile) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={T.primary as any} />
        <Text style={styles.muted}>Loading payout profile…</Text>
      </View>
    );
  }

  const kycTone = profile?.kyc_status === 'verified' ? 'success'
    : profile?.kyc_status === 'rejected' ? 'danger'
    : 'warning';

  // Aggregates derived from backend payload only (no client-side math on amounts):
  // we simply count items by terminal status so the developer sees their pipeline.
  // Counts are reading server-provided fields, not computing them — that's allowed.
  const settledCount = items.filter(i => i.status === 'settled').length;
  const inFlightCount = items.filter(i => ['queued', 'initiated', 'in_flight', 'confirmed'].includes(i.status)).length;
  const failedCount = items.filter(i => ['failed', 'returned'].includes(i.status)).length;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: T.bg as any }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
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
        testID="dev-payout-profile-screen"
      >
        <Stack.Screen options={{ title: 'Payout profile' }} />

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Payout profile</Text>
          <Text style={styles.subtitle}>
            How you get paid. Updates take effect on the next batch.
          </Text>
        </View>

        {/* KYC status */}
        <View style={styles.kycCard} testID="dev-kyc-card">
          <View style={[styles.tag, { borderColor: toneColor(kycTone) }]}>
            <Ionicons
              name={profile?.kyc_status === 'verified' ? 'shield-checkmark' : 'shield-outline'}
              size={12}
              color={toneColor(kycTone)}
            />
            <Text style={[styles.tagText, { color: toneColor(kycTone), marginLeft: 4 }]}>
              {profile?.kyc_status?.toUpperCase() || 'SOFT'}
            </Text>
          </View>
          <Text style={[styles.muted, { marginTop: 8 }]}>
            Soft KYC lets you receive mock-rail payouts immediately. To unlock live rails (Stripe Connect / PayPal Payouts) an admin needs to verify your KYC.
          </Text>
        </View>

        {/* Form */}
        <Text style={styles.sectionLabel}>Destination</Text>

        <Text style={styles.fieldLabel}>Country (ISO-2)</Text>
        <TextInput
          value={country}
          onChangeText={setCountry}
          placeholder="US"
          placeholderTextColor={T.textMuted as any}
          style={styles.input}
          autoCapitalize="characters"
          maxLength={2}
          testID="dev-country-input"
        />

        <Text style={styles.fieldLabel}>Preferred rail</Text>
        {RAIL_OPTIONS.map(r => {
          const disabled = r.disabled || (r.kyc === 'verified' && profile?.kyc_status !== 'verified');
          const selected = preferredRail === r.key;
          return (
            <TouchableOpacity
              key={r.key}
              onPress={() => !disabled && setPreferredRail(r.key)}
              style={[
                styles.railRow,
                { borderColor: selected ? T.primary as any : T.border as any },
                disabled && { opacity: 0.4 },
              ]}
              disabled={disabled}
              testID={`dev-rail-${r.key}`}
            >
              <Ionicons
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={selected ? T.primary as any : T.textMuted as any}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.body}>{r.label}</Text>
                <Text style={styles.muted}>
                  KYC required: {r.kyc} {disabled && r.kyc === 'verified' && !r.disabled ? '— request verification' : ''}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}

        <Text style={styles.fieldLabel}>Account hint (email or last-4)</Text>
        <TextInput
          value={accountHint}
          onChangeText={setAccountHint}
          placeholder="dev@example.com"
          placeholderTextColor={T.textMuted as any}
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
          testID="dev-account-input"
        />
        <Text style={styles.muted}>
          We store this hint as a label. Real account info is captured during rail-specific onboarding when live rails ship.
        </Text>

        <TouchableOpacity
          onPress={save}
          disabled={saving}
          style={[styles.saveBtn, saving && { opacity: 0.5 }]}
          testID="dev-save-profile-btn"
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <>
                <Ionicons name="checkmark" size={18} color="#fff" />
                <Text style={styles.saveBtnText}>Save profile</Text>
              </>
          }
        </TouchableOpacity>

        {/* Payout history */}
        <Text style={styles.sectionLabel}>Payout history ({items.length})</Text>
        <View style={styles.summaryRow}>
          <Summary label="Settled"   value={settledCount}   tone="success" />
          <Summary label="In flight" value={inFlightCount}  tone="info" />
          <Summary label="Failed"    value={failedCount}    tone="danger" />
        </View>

        {items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.muted}>No payouts yet. Items appear here once an admin releases a batch including you.</Text>
          </View>
        ) : items.map(it => {
          const tone = STATUS_TONE[it.status] || 'neutral';
          return (
            <View key={it.item_id} style={styles.itemCard} testID={`dev-item-${it.item_id}`}>
              <View style={styles.itemHeadRow}>
                <Text style={styles.itemAmount}>{fmtMoney(it.amount)}</Text>
                <View style={[styles.tag, { borderColor: toneColor(tone) }]}>
                  <Text style={[styles.tagText, { color: toneColor(tone) }]}>{it.status}</Text>
                </View>
              </View>
              <Text style={styles.muted}>
                {it.rail} · batch {it.batch_id}
              </Text>
              <Text style={styles.muted}>
                {it.status === 'settled' ? `Settled ${fmtTime(it.settled_at)}` : `Created ${fmtTime(it.created_at)}`}
              </Text>
              {it.attempt_count > 0 && (
                <Text style={styles.muted}>
                  Attempts: <Text style={{ color: T.warning as any, fontWeight: '600' }}>{it.attempt_count}</Text>
                  {it.dead_lettered && <Text style={{ color: T.danger as any }}> · exhausted</Text>}
                </Text>
              )}
              {it.last_error && (
                <Text style={styles.errText} numberOfLines={2}>{it.last_error}</Text>
              )}
            </View>
          );
        })}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone: 'success' | 'info' | 'danger' }) {
  return (
    <View style={[styles.summaryCell, { borderColor: toneColor(tone) }]} testID={`dev-summary-${tone}`}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={[styles.summaryVal, { color: toneColor(tone) }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg as any, padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: T.bg as any },
  header: { marginBottom: 12 },
  title: { color: T.text as any, fontSize: 22, fontWeight: '700' },
  subtitle: { color: T.textMuted as any, fontSize: 13, marginTop: 4 },
  kycCard: {
    backgroundColor: T.surface as any, borderColor: T.border as any, borderWidth: 1,
    borderRadius: 10, padding: 14, marginBottom: 16,
  },
  tag: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1,
    alignSelf: 'flex-start', backgroundColor: T.surface as any,
  },
  tagText: { fontSize: 11, fontWeight: '700' },
  sectionLabel: {
    color: T.textMuted as any, fontSize: 12, fontWeight: '700',
    letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 8, marginBottom: 8,
  },
  fieldLabel: { color: T.textMuted as any, fontSize: 12, marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: T.surface as any, color: T.text as any,
    borderColor: T.border as any, borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
  },
  railRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12,
    backgroundColor: T.surface as any, borderRadius: 10, borderWidth: 1,
    marginBottom: 8,
  },
  body: { color: T.text as any, fontSize: 14 },
  muted: { color: T.textMuted as any, fontSize: 12 },
  saveBtn: {
    backgroundColor: T.primary as any, padding: 14, borderRadius: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 16, marginBottom: 8,
  },
  saveBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  summaryCell: {
    flex: 1, padding: 12, borderRadius: 10, borderWidth: 1,
    backgroundColor: T.surface as any,
  },
  summaryVal: { fontSize: 22, fontWeight: '700', marginTop: 4 },
  emptyCard: {
    backgroundColor: T.surface as any, borderColor: T.border as any, borderWidth: 1,
    borderRadius: 10, padding: 16, marginBottom: 16,
  },
  itemCard: {
    backgroundColor: T.surface as any, borderColor: T.border as any, borderWidth: 1,
    borderRadius: 10, padding: 12, marginBottom: 8,
  },
  itemHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemAmount: { color: T.text as any, fontSize: 17, fontWeight: '700' },
  errText: { color: T.danger as any, fontSize: 12, marginTop: 4 },
});
