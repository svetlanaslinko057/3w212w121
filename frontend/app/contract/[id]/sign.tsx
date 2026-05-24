import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../../src/api';
import T from '../../../src/theme';

/**
 * Legal Contract Signing — Phase 2, mobile.
 *
 * 5-step click-wrap + OTP flow backed by /api/contracts/*.
 *   Step 1: Legal details        (collect ONLY at signing)
 *   Step 2: Agreement preview    (render HTML snapshot)
 *   Step 3: Acknowledgements     (3 required checkboxes)
 *   Step 4: OTP                  (email verification)
 *   Step 5: Signed → Continue to payment
 *
 * Wording rules (per spec):
 *   CTA = "Sign agreement & continue" (NOT "Accept terms")
 *   After sign = "Agreement signed / Next step: continue to payment"
 *
 * Template status marker is shown as a subtle caption only — we do NOT
 * scare the client with "pending legal review" language.
 */

type LegalProfile = {
  legal_type: 'individual' | 'company';
  first_name: string;
  last_name: string;
  middle_name?: string;
  phone: string;
  billing_address: string;
  country: string;
  city: string;
  postal_code: string;
  company_name?: string;
  company_registration_number?: string;
  tax_id?: string;
};

const EMPTY: LegalProfile = {
  legal_type: 'individual',
  first_name: '',
  last_name: '',
  middle_name: '',
  phone: '',
  billing_address: '',
  country: '',
  city: '',
  postal_code: '',
  company_name: '',
  company_registration_number: '',
  tax_id: '',
};

type Acks = {
  legal_details_correct: boolean;
  scope_terms_agreed: boolean;
  start_after_payment_understood: boolean;
};

const EMPTY_ACKS: Acks = {
  legal_details_correct: false,
  scope_terms_agreed: false,
  start_after_payment_understood: false,
};

export default function ContractSignScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const contractId = String(id || '');

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [contract, setContract] = useState<any>(null);
  const [html, setHtml] = useState<string>('');
  const [profile, setProfile] = useState<LegalProfile>(EMPTY);
  const [acks, setAcks] = useState<Acks>(EMPTY_ACKS);
  const [otpCode, setOtpCode] = useState('');
  const [otpMeta, setOtpMeta] = useState<{
    dev_mode?: boolean;
    dev_code?: string;
    expires_at?: string;
  } | null>(null);

  const loadContract = useCallback(async () => {
    setLoading(true);
    try {
      const [c, p] = await Promise.all([
        api.get(`/contracts/${contractId}`),
        api.get(`/legal/profile`),
      ]);
      setContract(c.data.contract);
      setHtml(c.data.html || '');
      const existing = p.data?.profile;
      if (existing) {
        setProfile({
          legal_type: (existing.legal_type === 'company' ? 'company' : 'individual'),
          first_name: existing.first_name || '',
          last_name: existing.last_name || '',
          middle_name: existing.middle_name || '',
          phone: existing.phone || '',
          billing_address: existing.billing_address || existing.registered_address || '',
          country: existing.country || '',
          city: existing.city || '',
          postal_code: existing.postal_code || '',
          company_name: existing.company_name || '',
          company_registration_number: existing.company_registration_number || '',
          tax_id: existing.tax_id || '',
        });
      }
      if (c.data.is_signed) setStep(5);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Could not load contract');
    } finally {
      setLoading(false);
    }
  }, [contractId]);

  useEffect(() => {
    if (contractId) loadContract();
  }, [contractId, loadContract]);

  const profileValid = useMemo(() => {
    const base =
      profile.first_name.trim().length >= 1 &&
      profile.last_name.trim().length >= 1 &&
      profile.phone.trim().length >= 4 &&
      profile.billing_address.trim().length >= 3 &&
      profile.country.trim().length >= 2 &&
      profile.city.trim().length >= 1 &&
      profile.postal_code.trim().length >= 1;
    if (!base) return false;
    if (profile.legal_type === 'company') {
      return !!(profile.company_name?.trim()) && !!(profile.company_registration_number?.trim());
    }
    return true;
  }, [profile]);

  const buildLegalPayload = () => ({
    legal_type: profile.legal_type,
    first_name: profile.first_name.trim(),
    last_name: profile.last_name.trim(),
    middle_name: (profile.middle_name || '').trim() || undefined,
    phone: profile.phone.trim(),
    billing_address: profile.billing_address.trim(),
    country: profile.country.trim(),
    city: profile.city.trim(),
    postal_code: profile.postal_code.trim(),
    company_name: profile.legal_type === 'company' ? (profile.company_name || '').trim() : undefined,
    company_registration_number: profile.legal_type === 'company' ? (profile.company_registration_number || '').trim() : undefined,
    tax_id: (profile.tax_id || '').trim() || undefined,
  });

  const allAcked = acks.legal_details_correct && acks.scope_terms_agreed && acks.start_after_payment_understood;

  // ---- Step transitions ----
  const goNextFrom1 = () => {
    if (!profileValid) {
      Alert.alert('Check your details', 'Full name, tax ID, address and country are required.');
      return;
    }
    setStep(2);
  };

  const goNextFrom2 = () => setStep(3);

  const goNextFrom3 = async () => {
    if (!allAcked) {
      Alert.alert('Please confirm', 'All three acknowledgements are required before signing.');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const r = await api.post(`/contracts/${contractId}/sign/request-otp`, {
        legal_profile: buildLegalPayload(),
      });
      setOtpMeta(r.data.otp || {});
      setStep(4);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Could not send verification code';
      Alert.alert('Error', typeof msg === 'string' ? msg : 'Could not send verification code');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmSign = async () => {
    if (!otpCode.trim()) {
      Alert.alert('Enter code', 'Please enter the verification code sent to your email.');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const r = await api.post(`/contracts/${contractId}/sign/confirm`, {
        legal_profile: buildLegalPayload(),
        acknowledgements: acks,
        otp_code: otpCode.trim(),
        terms_version: 'v1.0-placeholder',
      });
      setContract(r.data.contract);
      setStep(5);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Could not confirm signature';
      Alert.alert('Error', typeof msg === 'string' ? msg : 'Could not confirm signature');
    } finally {
      setSubmitting(false);
    }
  };

  const resendOtp = async () => {
    setSubmitting(true);
    try {
      const r = await api.post(`/contracts/${contractId}/sign/request-otp`, {
        legal_profile: buildLegalPayload(),
      });
      setOtpMeta(r.data.otp || {});
      Alert.alert('Sent', 'A fresh code was sent to your email.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Could not resend');
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Render ----
  if (loading) {
    return (
      <View style={s.center}><ActivityIndicator size="large" color={T.primary} /></View>
    );
  }
  if (err && !contract) {
    return (
      <View style={s.center}>
        <Text style={s.errorText}>{err}</Text>
        <TouchableOpacity style={s.btnSecondary} onPress={loadContract}>
          <Text style={s.btnSecondaryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: T.bg }}
    >
      <ScrollView
        style={s.container}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        testID={`contract-sign-step-${step}`}
      >
        <StepIndicator step={step} />

        {step === 1 && (
          <Step1Legal
            profile={profile}
            setProfile={setProfile}
            valid={profileValid}
            onNext={goNextFrom1}
          />
        )}

        {step === 2 && (
          <Step2Preview
            contract={contract}
            html={html}
            onBack={() => setStep(1)}
            onNext={goNextFrom2}
          />
        )}

        {step === 3 && (
          <Step3Acks
            acks={acks}
            setAcks={setAcks}
            allAcked={allAcked}
            submitting={submitting}
            onBack={() => setStep(2)}
            onNext={goNextFrom3}
          />
        )}

        {step === 4 && (
          <Step4Otp
            otpCode={otpCode}
            setOtpCode={setOtpCode}
            otpMeta={otpMeta}
            submitting={submitting}
            onBack={() => setStep(3)}
            onConfirm={confirmSign}
            onResend={resendOtp}
          />
        )}

        {step === 5 && (
          <Step5Done contract={contract} router={router} />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ---------- Step indicator ---------- */
function StepIndicator({ step }: { step: number }) {
  const items = [
    { k: 1, label: 'Details' },
    { k: 2, label: 'Preview' },
    { k: 3, label: 'Confirm' },
    { k: 4, label: 'Verify' },
    { k: 5, label: 'Signed' },
  ];
  return (
    <View style={s.stepRow}>
      {items.map((it, idx) => {
        const active = step === it.k;
        const done = step > it.k;
        return (
          <View key={it.k} style={s.stepCell}>
            <View style={[s.stepDot, active && s.stepDotActive, done && s.stepDotDone]}>
              {done ? (
                <Ionicons name="checkmark" size={12} color={T.primaryInk} />
              ) : (
                <Text style={[s.stepDotNum, active && { color: T.primaryInk }]}>{it.k}</Text>
              )}
            </View>
            <Text style={[s.stepLabel, active && s.stepLabelActive]} numberOfLines={1}>{it.label}</Text>
            {idx < items.length - 1 && <View style={s.stepLine} />}
          </View>
        );
      })}
    </View>
  );
}

/* ---------- Step 1: Legal details ---------- */
function Step1Legal({
  profile,
  setProfile,
  valid,
  onNext,
}: {
  profile: LegalProfile;
  setProfile: (p: LegalProfile) => void;
  valid: boolean;
  onNext: () => void;
}) {
  return (
    <View>
      <Text style={s.h1}>Legal details</Text>
      <Text style={s.lede}>
        We only ask for this now — at the moment of signing your first agreement.
        Tax ID and passport details are not required by default.
      </Text>

      {/* Legal type toggle (individual / company) */}
      <View style={s.segmented}>
        <TouchableOpacity
          style={[s.segBtn, profile.legal_type === 'individual' && s.segBtnActive]}
          onPress={() => setProfile({ ...profile, legal_type: 'individual' })}
          testID="contract-legal-type-individual"
        >
          <Ionicons name="person-outline" size={14} color={profile.legal_type === 'individual' ? T.primaryInk : T.subtle} />
          <Text style={[s.segBtnText, profile.legal_type === 'individual' && s.segBtnTextActive]}>Individual</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.segBtn, profile.legal_type === 'company' && s.segBtnActive]}
          onPress={() => setProfile({ ...profile, legal_type: 'company' })}
          testID="contract-legal-type-company"
        >
          <Ionicons name="business-outline" size={14} color={profile.legal_type === 'company' ? T.primaryInk : T.subtle} />
          <Text style={[s.segBtnText, profile.legal_type === 'company' && s.segBtnTextActive]}>Company</Text>
        </TouchableOpacity>
      </View>

      <Field
        label="First name"
        value={profile.first_name}
        onChangeText={(v) => setProfile({ ...profile, first_name: v })}
        autoCapitalize="words"
        testID="contract-legal-first_name"
      />
      <Field
        label="Last name"
        value={profile.last_name}
        onChangeText={(v) => setProfile({ ...profile, last_name: v })}
        autoCapitalize="words"
        testID="contract-legal-last_name"
      />
      <Field
        label="Middle name (optional)"
        value={profile.middle_name || ''}
        onChangeText={(v) => setProfile({ ...profile, middle_name: v })}
        autoCapitalize="words"
        testID="contract-legal-middle_name"
      />
      <Field
        label="Phone"
        value={profile.phone}
        onChangeText={(v) => setProfile({ ...profile, phone: v })}
        keyboardType="phone-pad"
        testID="contract-legal-phone"
      />
      <Field
        label="Billing address"
        value={profile.billing_address}
        onChangeText={(v) => setProfile({ ...profile, billing_address: v })}
        multiline
        testID="contract-legal-address"
      />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 2 }}>
          <Field
            label="City"
            value={profile.city}
            onChangeText={(v) => setProfile({ ...profile, city: v })}
            testID="contract-legal-city"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Postal code"
            value={profile.postal_code}
            onChangeText={(v) => setProfile({ ...profile, postal_code: v })}
            testID="contract-legal-postal"
          />
        </View>
      </View>
      <Field
        label="Country"
        value={profile.country}
        onChangeText={(v) => setProfile({ ...profile, country: v })}
        testID="contract-legal-country"
      />

      {/* Company-only fields */}
      {profile.legal_type === 'company' ? (
        <>
          <Field
            label="Company name"
            value={profile.company_name || ''}
            onChangeText={(v) => setProfile({ ...profile, company_name: v })}
            testID="contract-legal-company_name"
          />
          <Field
            label="Company registration number"
            value={profile.company_registration_number || ''}
            onChangeText={(v) => setProfile({ ...profile, company_registration_number: v })}
            testID="contract-legal-company_reg"
          />
        </>
      ) : null}

      <Field
        label="Tax ID / VAT (optional)"
        value={profile.tax_id || ''}
        onChangeText={(v) => setProfile({ ...profile, tax_id: v })}
        testID="contract-legal-tax_id"
      />

      <Text style={[s.lede, { fontSize: 11, marginTop: 4 }]}>
        Your tax/registration numbers are stored encrypted at rest and are
        visible only to you. Admin access is logged.
      </Text>

      <TouchableOpacity
        style={[s.btnPrimary, !valid && s.btnDisabled]}
        disabled={!valid}
        onPress={onNext}
        testID="contract-legal-next"
      >
        <Text style={s.btnPrimaryText}>Continue</Text>
        <Ionicons name="arrow-forward" size={16} color={T.primaryInk} />
      </TouchableOpacity>
    </View>
  );
}

/* ---------- Step 2: Preview ---------- */
function Step2Preview({
  contract,
  html,
  onBack,
  onNext,
}: {
  contract: any;
  html: string;
  onBack: () => void;
  onNext: () => void;
}) {
  const stripped = useMemo(() => htmlToPlainBlocks(html), [html]);
  return (
    <View>
      <Text style={s.h1}>Review agreement</Text>
      <Text style={s.lede}>
        Project: <Text style={s.strong}>{contract?.project_title || '—'}</Text>
        {'  ·  '}Price: <Text style={s.strong}>{contract?.price || '—'}</Text>
      </Text>

      <View style={s.docBox} testID="contract-preview-body">
        {stripped.map((blk, i) => (
          <View key={i} style={{ marginBottom: 10 }}>
            {blk.kind === 'h1' && <Text style={s.docH1}>{blk.text}</Text>}
            {blk.kind === 'h2' && <Text style={s.docH2}>{blk.text}</Text>}
            {blk.kind === 'li' && <Text style={s.docLi}>• {blk.text}</Text>}
            {blk.kind === 'p' && <Text style={s.docP}>{blk.text}</Text>}
            {blk.kind === 'meta' && <Text style={s.docMeta}>{blk.text}</Text>}
          </View>
        ))}
      </View>

      <View style={s.rowGap}>
        <TouchableOpacity style={s.btnSecondary} onPress={onBack} testID="contract-preview-back">
          <Ionicons name="arrow-back" size={16} color={T.text} />
          <Text style={s.btnSecondaryText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.btnPrimary} onPress={onNext} testID="contract-preview-next">
          <Text style={s.btnPrimaryText}>Continue</Text>
          <Ionicons name="arrow-forward" size={16} color={T.primaryInk} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ---------- Step 3: Acknowledgements ---------- */
function Step3Acks({
  acks,
  setAcks,
  allAcked,
  submitting,
  onBack,
  onNext,
}: {
  acks: Acks;
  setAcks: (a: Acks) => void;
  allAcked: boolean;
  submitting: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <View>
      <Text style={s.h1}>Confirm & sign</Text>
      <Text style={s.lede}>All three confirmations are required.</Text>

      <AckRow
        label="I confirm my legal details are correct."
        checked={acks.legal_details_correct}
        onToggle={() => setAcks({ ...acks, legal_details_correct: !acks.legal_details_correct })}
        testID="contract-ack-details"
      />
      <AckRow
        label="I agree to the project scope, payment schedule and terms."
        checked={acks.scope_terms_agreed}
        onToggle={() => setAcks({ ...acks, scope_terms_agreed: !acks.scope_terms_agreed })}
        testID="contract-ack-scope"
      />
      <AckRow
        label="I understand development starts after initial payment."
        checked={acks.start_after_payment_understood}
        onToggle={() =>
          setAcks({ ...acks, start_after_payment_understood: !acks.start_after_payment_understood })
        }
        testID="contract-ack-start"
      />

      <View style={s.rowGap}>
        <TouchableOpacity style={s.btnSecondary} onPress={onBack} testID="contract-acks-back">
          <Ionicons name="arrow-back" size={16} color={T.text} />
          <Text style={s.btnSecondaryText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.btnPrimary, (!allAcked || submitting) && s.btnDisabled]}
          disabled={!allAcked || submitting}
          onPress={onNext}
          testID="contract-acks-send-otp"
        >
          {submitting ? (
            <ActivityIndicator color={T.primaryInk} />
          ) : (
            <>
              <Text style={s.btnPrimaryText}>Send verification code</Text>
              <Ionicons name="mail" size={16} color={T.primaryInk} />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ---------- Step 4: OTP ---------- */
function Step4Otp({
  otpCode,
  setOtpCode,
  otpMeta,
  submitting,
  onBack,
  onConfirm,
  onResend,
}: {
  otpCode: string;
  setOtpCode: (v: string) => void;
  otpMeta: any;
  submitting: boolean;
  onBack: () => void;
  onConfirm: () => void;
  onResend: () => void;
}) {
  return (
    <View>
      <Text style={s.h1}>Verify it's you</Text>
      <Text style={s.lede}>
        Enter the 6-digit code we sent to your email to confirm your signature.
      </Text>

      {otpMeta?.dev_code ? (
        <View style={s.devBox}>
          <Text style={s.devText}>
            DEV code: <Text style={s.devCode}>{otpMeta.dev_code}</Text>
          </Text>
          <Text style={s.devHint}>
            (Shown because the email provider isn't configured on this environment.)
          </Text>
        </View>
      ) : null}

      <TextInput
        value={otpCode}
        onChangeText={(v) => setOtpCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
        placeholder="• • • • • •"
        placeholderTextColor={T.textMuted}
        style={s.otpInput}
        testID="contract-otp-input"
      />

      <TouchableOpacity
        onPress={onResend}
        disabled={submitting}
        style={{ alignSelf: 'center', padding: 8, marginBottom: 8 }}
        testID="contract-otp-resend"
      >
        <Text style={{ color: T.primary, fontWeight: '700', fontSize: T.small }}>
          Resend code
        </Text>
      </TouchableOpacity>

      <View style={s.rowGap}>
        <TouchableOpacity style={s.btnSecondary} onPress={onBack} testID="contract-otp-back">
          <Ionicons name="arrow-back" size={16} color={T.text} />
          <Text style={s.btnSecondaryText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.btnPrimary, (otpCode.length < 4 || submitting) && s.btnDisabled]}
          disabled={otpCode.length < 4 || submitting}
          onPress={onConfirm}
          testID="contract-otp-confirm"
        >
          {submitting ? (
            <ActivityIndicator color={T.primaryInk} />
          ) : (
            <>
              <Text style={s.btnPrimaryText}>Sign agreement & continue</Text>
              <Ionicons name="checkmark-circle" size={16} color={T.primaryInk} />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ---------- Step 5: Done ---------- */
function Step5Done({ contract, router }: { contract: any; router: any }) {
  const projectId = contract?.project_id;
  const goPayment = () => {
    if (projectId) {
      router.replace(`/client/project/${projectId}` as any);
    } else {
      router.replace('/client/home' as any);
    }
  };
  const goDocuments = () => router.push('/documents' as any);

  return (
    <View testID="contract-sign-done">
      <View style={s.doneCard}>
        <View style={s.doneIcon}>
          <Ionicons name="checkmark-circle" size={44} color={T.primary} />
        </View>
        <Text style={s.h1}>Agreement signed</Text>
        <Text style={s.lede}>Next step: continue to payment.</Text>

        <View style={s.kv}>
          <Text style={s.kvLabel}>Project</Text>
          <Text style={s.kvValue}>{contract?.project_title || '—'}</Text>
        </View>
        <View style={s.kv}>
          <Text style={s.kvLabel}>Amount</Text>
          <Text style={s.kvValue}>{contract?.price || '—'}</Text>
        </View>
        <View style={s.kv}>
          <Text style={s.kvLabel}>Signed at</Text>
          <Text style={s.kvValue}>{contract?.signed_at?.slice(0, 19).replace('T', ' ') || '—'}</Text>
        </View>
        <View style={s.kv}>
          <Text style={s.kvLabel}>Evidence hash</Text>
          <Text style={[s.kvValue, s.monoText]} numberOfLines={1}>
            {(contract?.sha256_hash || '').slice(0, 16)}…
          </Text>
        </View>
      </View>

      <TouchableOpacity style={s.btnPrimary} onPress={goPayment} testID="contract-continue-payment">
        <Text style={s.btnPrimaryText}>Continue to payment</Text>
        <Ionicons name="arrow-forward" size={16} color={T.primaryInk} />
      </TouchableOpacity>
      <TouchableOpacity style={[s.btnSecondary, { marginTop: 10 }]} onPress={goDocuments} testID="contract-goto-documents">
        <Ionicons name="document-text" size={16} color={T.text} />
        <Text style={s.btnSecondaryText}>View in Documents</Text>
      </TouchableOpacity>
    </View>
  );
}

/* ---------- Primitives ---------- */
function Field(props: any) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.fieldLabel}>{props.label}</Text>
      <TextInput
        {...props}
        style={[s.input, props.multiline && { minHeight: 64 }]}
        placeholderTextColor={T.textMuted}
      />
    </View>
  );
}

function AckRow({
  label,
  checked,
  onToggle,
  testID,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      style={[s.ack, checked && s.ackOn]}
      onPress={onToggle}
      activeOpacity={0.8}
      testID={testID}
    >
      <View style={[s.ackBox, checked && s.ackBoxOn]}>
        {checked ? <Ionicons name="checkmark" size={14} color={T.primaryInk} /> : null}
      </View>
      <Text style={s.ackText}>{label}</Text>
    </TouchableOpacity>
  );
}

/* ---------- HTML → very simple blocks for preview ---------- */
type Blk = { kind: 'h1' | 'h2' | 'li' | 'p' | 'meta'; text: string };

function htmlToPlainBlocks(html: string): Blk[] {
  if (!html) return [];
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<section[^>]*>|<\/section>/gi, '')
    .replace(/\n+/g, '\n');
  const blocks: Blk[] = [];
  const regex = /<(h1|h2|p|li)([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(cleaned))) {
    const tag = m[1].toLowerCase() as 'h1' | 'h2' | 'p' | 'li';
    const attrs = m[2] || '';
    const inner = m[3]
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!inner) continue;
    if (tag === 'p' && /class="meta"/.test(attrs)) {
      blocks.push({ kind: 'meta', text: inner });
    } else {
      blocks.push({ kind: tag, text: inner });
    }
  }
  return blocks;
}

/* ---------- Styles ---------- */
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.md, paddingBottom: T.xxl },
  center: { flex: 1, backgroundColor: T.bg, alignItems: 'center', justifyContent: 'center', padding: T.md },

  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: T.lg,
    gap: 4,
  },
  stepCell: { flex: 1, alignItems: 'center', position: 'relative' },
  stepDot: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: T.surface2,
    borderWidth: 1, borderColor: T.border,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  stepDotActive: { backgroundColor: T.primary, borderColor: T.primary },
  stepDotDone: { backgroundColor: T.primary, borderColor: T.primary },
  stepDotNum: { color: T.textMuted, fontSize: 11, fontWeight: '800' },
  stepLabel: { color: T.textMuted, fontSize: 10, fontWeight: '600' },
  stepLabelActive: { color: T.text, fontWeight: '800' },
  stepLine: {
    position: 'absolute', top: 13, left: '60%', right: '-40%',
    height: 1, backgroundColor: T.border,
  },

  h1: { color: T.text, fontSize: 22, fontWeight: '800', marginBottom: 8 },
  lede: { color: T.textSecondary, fontSize: T.body, marginBottom: T.md, lineHeight: 20 },
  strong: { color: T.text, fontWeight: '800' },
  errorText: { color: T.danger, fontSize: T.body, textAlign: 'center', marginBottom: 12 },

  fieldLabel: { color: T.textMuted, fontSize: T.tiny, marginBottom: 6, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  input: {
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    borderWidth: 1, borderColor: T.border,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: T.body, color: T.text,
  },

  docBox: {
    backgroundColor: T.surface1, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    padding: T.md, marginBottom: T.md,
  },
  docH1: { color: T.text, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  docH2: { color: T.text, fontSize: 14, fontWeight: '700', marginTop: 10 },
  docP: { color: T.textSecondary, fontSize: 13, lineHeight: 19 },
  docLi: { color: T.textSecondary, fontSize: 13, lineHeight: 19, paddingLeft: 6 },
  docMeta: { color: T.textMuted, fontSize: 11, fontStyle: 'italic' },

  ack: {
    flexDirection: 'row', alignItems: 'center',
    gap: 12, padding: 12,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radiusSm, marginBottom: 10,
    backgroundColor: T.surface1,
  },
  ackOn: { borderColor: T.primaryBorderStrong, backgroundColor: T.primaryBg },
  ackBox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1, borderColor: T.border,
    backgroundColor: T.surface2,
    alignItems: 'center', justifyContent: 'center',
  },
  ackBoxOn: { backgroundColor: T.primary, borderColor: T.primary },
  ackText: { color: T.text, fontSize: T.body, flex: 1, lineHeight: 20 },

  otpInput: {
    backgroundColor: T.surface1, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    paddingHorizontal: 14, paddingVertical: 16,
    fontSize: 26, color: T.text, textAlign: 'center',
    letterSpacing: 8, marginBottom: 8, fontWeight: '700',
  },
  devBox: {
    backgroundColor: T.warningBg, borderColor: T.warningBorder,
    borderWidth: 1, borderRadius: T.radiusSm,
    padding: 10, marginBottom: 10,
  },
  devText: { color: T.warning, fontSize: T.small },
  devCode: { fontWeight: '900', letterSpacing: 2 },
  devHint: { color: T.textMuted, fontSize: T.tiny, marginTop: 4 },

  rowGap: { flexDirection: 'row', gap: 10, marginTop: 8 },

  btnPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: T.primary, borderRadius: T.radius,
    paddingVertical: 14, flex: 1,
  },
  btnPrimaryText: { color: T.primaryInk, fontSize: T.body, fontWeight: '800' },
  btnDisabled: { opacity: 0.4 },
  btnSecondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border,
    borderRadius: T.radius, paddingVertical: 14, flex: 1,
  },
  btnSecondaryText: { color: T.text, fontSize: T.body, fontWeight: '700' },

  doneCard: {
    backgroundColor: T.surface1, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    padding: T.lg, marginBottom: T.md, alignItems: 'stretch',
  },
  doneIcon: { alignItems: 'center', marginBottom: 8 },
  kv: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: T.border,
    marginTop: 2, gap: 12,
  },
  kvLabel: { color: T.textMuted, fontSize: T.small },
  kvValue: { color: T.text, fontSize: T.small, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  monoText: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
