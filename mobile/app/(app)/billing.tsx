import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import {
  getCurrentUser,
  getUserSubscription,
  setUserSubscription,
} from '@/lib/store';
import type { PatientAccount, SubscriptionRecord } from '@/lib/store';

export default function BillingScreen() {
  const [user, setUser] = useState<PatientAccount | null>(null);
  const [sub, setSub] = useState<SubscriptionRecord | null>(null);
  const [transactions, setTransactions] = useState<{ date: string; amount: number; label: string }[]>([]);
  const [showUpdateCard, setShowUpdateCard] = useState(false);
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  async function loadData() {
    const u = await getCurrentUser();
    setUser(u);
    if (!u) return;
    const s = await getUserSubscription(u.id);
    setSub(s);

    const isDemo = u.id === 'demo_patient';
    const isYearly = s?.billingCycle === 'yearly';
    const cyclePrice = isYearly ? 1999 : 199;
    const label = isYearly ? 'DermAI Pro Plan — Annual' : 'DermAI Pro Plan — Monthly';

    if (isDemo) {
      // Always show 3 demo billing entries regardless of stored state
      const now = new Date();
      setTransactions([
        { date: new Date(now.getFullYear(), now.getMonth() - 2, 4).toISOString(), amount: 199, label: 'DermAI Pro Plan — Monthly' },
        { date: new Date(now.getFullYear(), now.getMonth() - 1, 4).toISOString(), amount: 199, label: 'DermAI Pro Plan — Monthly' },
        { date: new Date(now.getFullYear(), now.getMonth(), 4).toISOString(), amount: 199, label: 'DermAI Pro Plan — Monthly' },
      ]);
    } else if (s?.plan === 'premium' && s.startDate) {
      const start = new Date(s.startDate);
      const monthStep = isYearly ? 12 : 1;
      const entries = [];
      for (let i = 0; i < 3; i++) {
        const d = new Date(start);
        d.setMonth(d.getMonth() + i * monthStep);
        if (d <= new Date()) {
          entries.push({ date: d.toISOString(), amount: cyclePrice, label });
        }
      }
      setTransactions(entries);
    }
  }

  async function handleCancel() {
    if (!user || !sub) return;
    Alert.alert(
      'Cancel Subscription',
      'Are you sure you want to downgrade to the free plan?',
      [
        { text: 'Keep Premium', style: 'cancel' },
        {
          text: 'Downgrade',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              const updated: SubscriptionRecord = {
                ...sub,
                plan: 'free',
                endDate: new Date().toISOString(),
              };
              await setUserSubscription(user.id, updated);
              setSub(updated);
              Alert.alert('Downgraded', 'You are now on the free plan.', [
                { text: 'OK', onPress: () => router.back() },
              ]);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>Billing</Text>
          <Text style={styles.headerSub}>Manage your subscription and payment details</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* Pro Plan card */}
        <View style={styles.planCard}>
          <View style={styles.planTop}>
            <View style={styles.planIconBox}>
              <Ionicons name="trophy" size={20} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.planName}>Pro Plan</Text>
              <Text style={styles.planPrice}>
                {sub?.billingCycle === 'yearly' ? '₱1,999 / year' : '₱199 / month'}
              </Text>
            </View>
            <View style={styles.activePill}>
              <Text style={styles.activePillTxt}>Active</Text>
            </View>
          </View>

          {sub?.endDate && (
            <View style={styles.dateRow}>
              <Ionicons name="calendar-outline" size={14} color={COLORS.primary} />
              <Text style={styles.dateTxt}>
                Next billing date:{' '}
                <Text style={{ fontWeight: '700' }}>
                  {new Date(sub.endDate).toLocaleDateString('en-PH', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </Text>
              </Text>
            </View>
          )}

          <View style={styles.featureList}>
            {[
              'Unlimited AI skin scans',
              'Priority clinic recommendations',
              'Full skin analysis history',
              'Cancel anytime',
            ].map((f) => (
              <View key={f} style={styles.featureRow}>
                <Ionicons name="checkmark-circle" size={17} color={COLORS.success} />
                <Text style={styles.featureTxt}>{f}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.cancelSubRow} onPress={handleCancel} disabled={loading}>
            <Ionicons name="close-circle" size={17} color={COLORS.danger} />
            <Text style={styles.cancelSubTxt}>Cancel Subscription</Text>
          </TouchableOpacity>
        </View>

        {/* Payment Method */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PAYMENT METHOD</Text>
          <View style={styles.payRow}>
            <View style={styles.payIconBox}>
              <Ionicons name="card-outline" size={18} color={COLORS.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.payNumber}>{'●●●● ●●●● ●●●● '}{sub?.cardLast4 ?? '----'}</Text>
              <Text style={styles.payExpiry}>{'Expires '}{sub?.cardExpiry ?? '--/--'}</Text>
            </View>
            <TouchableOpacity onPress={() => setShowUpdateCard(true)}>
              <Text style={styles.payUpdate}>Update</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Billing History */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>BILLING HISTORY</Text>
          {transactions.length === 0 ? (
            <Text style={styles.emptyTxt}>No billing history yet.</Text>
          ) : (
            transactions.map((t, i) => (
              <View key={i} style={[styles.historyRow, i > 0 && styles.historyRowBorder]}>
                <Text style={styles.historyDate}>
                  {new Date(t.date).toLocaleDateString('en-PH', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </Text>
                <Text style={styles.historyAmount}>₱{t.amount.toLocaleString()}</Text>
                <View style={styles.paidBadge}>
                  <Text style={styles.paidTxt}>Paid</Text>
                </View>
              </View>
            ))
          )}
        </View>

      </ScrollView>

      <UpdateCardModal
        visible={showUpdateCard}
        currentExpiry={sub?.cardExpiry}
        onSave={async (last4, expiry) => {
          if (!user || !sub) return;
          const updated = { ...sub, cardLast4: last4, cardExpiry: expiry };
          await setUserSubscription(user.id, updated);
          setSub(updated);
          setShowUpdateCard(false);
          Alert.alert('Card Updated', 'Your payment method has been updated.');
        }}
        onClose={() => setShowUpdateCard(false)}
      />
    </SafeAreaView>
  );
}

function UpdateCardModal({
  visible,
  currentExpiry,
  onSave,
  onClose,
}: {
  visible: boolean;
  currentExpiry?: string;
  onSave: (cardLast4: string, cardExpiry: string) => void;
  onClose: () => void;
}) {
  const [cardNumber, setCardNumber] = useState('');
  const [cardName, setCardName] = useState('');
  const [expiry, setExpiry] = useState(currentExpiry ?? '');
  const [cvc, setCvc] = useState('');

  function handleSave() {
    if (cardNumber.replace(/\s/g, '').length < 16) {
      Alert.alert('Invalid Card', 'Please enter a valid 16-digit card number.');
      return;
    }
    if (!cardName.trim()) {
      Alert.alert('Missing Field', 'Please enter the cardholder name.');
      return;
    }
    if (!/^\d{2}\/\d{2}$/.test(expiry)) {
      Alert.alert('Invalid Expiry', 'Enter expiry in MM/YY format.');
      return;
    }
    if (cvc.length < 3) {
      Alert.alert('Invalid CVV', 'Enter a 3-digit security code.');
      return;
    }
    const digits = cardNumber.replace(/\s/g, '');
    onSave(digits.slice(-4), expiry);
  }

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={ucStyles.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={ucStyles.sheet}>
            <View style={ucStyles.header}>
              <Text style={ucStyles.title}>Update Payment Method</Text>
              <TouchableOpacity onPress={onClose} style={ucStyles.closeBtn}>
                <Ionicons name="close" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={ucStyles.field}>
              <Text style={ucStyles.label}>Card Number</Text>
              <View style={ucStyles.inputRow}>
                <Ionicons name="card-outline" size={18} color={COLORS.textLight} style={{ marginRight: 8 }} />
                <TextInput
                  style={ucStyles.inputFlex}
                  placeholder="1234 5678 9012 3456"
                  placeholderTextColor={COLORS.textLight}
                  value={cardNumber}
                  onChangeText={(v) => {
                    const digits = v.replace(/\D/g, '').slice(0, 16);
                    setCardNumber(digits.replace(/(\d{4})/g, '$1 ').trim());
                  }}
                  keyboardType="number-pad"
                  maxLength={19}
                />
              </View>
            </View>

            <View style={ucStyles.field}>
              <Text style={ucStyles.label}>Cardholder Name</Text>
              <TextInput
                style={ucStyles.input}
                placeholder="Juan Dela Cruz"
                placeholderTextColor={COLORS.textLight}
                value={cardName}
                onChangeText={setCardName}
                autoCapitalize="words"
              />
            </View>

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={[ucStyles.field, { flex: 1 }]}>
                <Text style={ucStyles.label}>Expiry Date</Text>
                <TextInput
                  style={ucStyles.input}
                  placeholder="MM/YY"
                  placeholderTextColor={COLORS.textLight}
                  value={expiry}
                  onChangeText={(v) => {
                    const digits = v.replace(/\D/g, '').slice(0, 4);
                    setExpiry(digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits);
                  }}
                  keyboardType="number-pad"
                  maxLength={5}
                />
              </View>
              <View style={[ucStyles.field, { flex: 1 }]}>
                <Text style={ucStyles.label}>CVV</Text>
                <TextInput
                  style={ucStyles.input}
                  placeholder="●●●"
                  placeholderTextColor={COLORS.textLight}
                  value={cvc}
                  onChangeText={(v) => setCvc(v.replace(/\D/g, '').slice(0, 3))}
                  keyboardType="number-pad"
                  maxLength={3}
                  secureTextEntry
                />
              </View>
            </View>

            <TouchableOpacity style={ucStyles.saveBtn} onPress={handleSave}>
              <Text style={ucStyles.saveBtnTxt}>Save Card</Text>
            </TouchableOpacity>

            <Text style={ucStyles.note}>Your card details are stored locally for demo purposes only.</Text>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const ucStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  sheet: { backgroundColor: COLORS.surface, borderRadius: 20, padding: 24, width: '100%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  title: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center' },
  field: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 6 },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: COLORS.text,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  inputFlex: { flex: 1, fontSize: 15, color: COLORS.text, padding: 0 },
  saveBtn: { backgroundColor: COLORS.primary, borderRadius: 30, paddingVertical: 15, alignItems: 'center', marginTop: 4, marginBottom: 14 },
  saveBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
  note: { textAlign: 'center', fontSize: 12, color: COLORS.textSecondary },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  backBtn: { padding: 2 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text },
  headerSub: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  planCard: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 14,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    padding: 18,
  },
  planTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  planIconBox: { width: 42, height: 42, borderRadius: 10, backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center' },
  planName: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  planPrice: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  activePill: { backgroundColor: COLORS.successLight, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  activePillTxt: { color: COLORS.success, fontWeight: '700', fontSize: 13 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  dateTxt: { fontSize: 13, color: COLORS.text },
  featureList: { gap: 10, marginBottom: 16 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureTxt: { fontSize: 14, color: COLORS.text },
  cancelSubRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  cancelSubTxt: { color: COLORS.danger, fontWeight: '600', fontSize: 14 },
  section: {
    marginHorizontal: 16,
    marginBottom: 14,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 18,
  },
  sectionLabel: { fontSize: 13, fontWeight: '800', color: COLORS.text, letterSpacing: 0.8, marginBottom: 14 },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  payIconBox: { width: 38, height: 38, borderRadius: 8, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center' },
  payNumber: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  payExpiry: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  payUpdate: { color: COLORS.primary, fontWeight: '600', fontSize: 14 },
  historyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  historyRowBorder: { borderTopWidth: 1, borderTopColor: COLORS.border },
  historyDate: { flex: 1, fontSize: 14, color: COLORS.text },
  historyAmount: { fontSize: 14, fontWeight: '700', color: COLORS.text, marginRight: 12 },
  paidBadge: { backgroundColor: COLORS.successLight, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 4 },
  paidTxt: { color: COLORS.success, fontWeight: '700', fontSize: 12 },
  emptyTxt: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', paddingVertical: 8 },
});
