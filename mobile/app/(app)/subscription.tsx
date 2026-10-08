import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import {
  getCurrentUser,
  getUserSubscription,
  setUserSubscription,
  pushAdminNotification,
  addPlatformTransaction,
  updatePlatformUserPlan,
} from '@/lib/store';
import type { PatientAccount, SubscriptionRecord } from '@/lib/store';

export default function SubscriptionScreen() {
  const [user, setUser] = useState<PatientAccount | null>(null);
  const [sub, setSub] = useState<SubscriptionRecord | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [loading, setLoading] = useState(false);
  const [showPayment, setShowPayment] = useState(false);

  useFocusEffect(
    useCallback(() => {
      console.log('[Subscription] Screen focused — loading data');
      loadData();
    }, [])
  );

  async function loadData() {
    console.log('[Subscription] loadData start');
    const u = await getCurrentUser();
    setUser(u);
    if (!u) return;
    const s = await getUserSubscription(u.id);
    setSub(s);
    console.log('[Subscription] loadData complete, user=', u?.id, 'sub=', s?.plan ?? 'none');
  }

  const isPremium = sub?.plan === 'premium';
  const price = billingCycle === 'monthly' ? 199 : 1999;
  const priceLabel = billingCycle === 'monthly' ? '₱199/mo' : '₱1,999/yr';

  async function handleUpgrade() {
    if (!user) return;
    console.log('[Subscription] handleUpgrade called');
    setShowPayment(true);
  }

  async function processPayment(cardLast4: string, cardExpiry: string) {
    if (!user) return;
    setLoading(true);
    try {
      const now = new Date();
      const end = new Date(now);
      if (billingCycle === 'monthly') end.setMonth(end.getMonth() + 1);
      else end.setFullYear(end.getFullYear() + 1);

      const txnId = `txn_${Date.now()}`;
      const newSub: SubscriptionRecord = {
        userId: user.id,
        email: user.email,
        plan: 'premium',
        billingCycle,
        startDate: now.toISOString(),
        endDate: end.toISOString(),
        transactionId: txnId,
        scansUsed: 0,
        cardLast4,
        cardExpiry,
      };

      await setUserSubscription(user.id, newSub);
      await updatePlatformUserPlan(user.email, 'premium');
      await addPlatformTransaction({
        id: txnId,
        userId: user.id,
        userEmail: user.email,
        userName: user.fullName,
        plan: 'Premium',
        amount: price,
        date: now.toISOString(),
        method: 'Demo Payment',
        billingCycle,
        status: 'paid',
      });
      await pushAdminNotification({
        type: 'new-subscription',
        title: 'New Premium Subscription',
        message: `${user.fullName} (${user.email}) subscribed to Premium — ${billingCycle} — ₱${price.toLocaleString()}`,
      });
      setSub(newSub);
      setShowPayment(false);
      Alert.alert(
        '🎉 Welcome to Premium!',
        'You now have access to all premium features. Enjoy unlimited skin scans and priority appointments.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Subscription</Text>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Premium plan banner (when subscribed) */}
        {isPremium && (
          <View style={[styles.planCard, styles.planCardPremium]}>
            <View style={styles.planTop}>
              <Text style={styles.planEmoji}>⭐</Text>
              <View>
                <Text style={styles.planName}>Pro Plan</Text>
                <Text style={styles.planDate}>₱199 / month · Active</Text>
              </View>
            </View>
            <View style={styles.activePill}>
              <Text style={styles.activePillTxt}>Active</Text>
            </View>
          </View>
        )}

        {/* Premium upgrade card (free users only) */}
        {!isPremium && (
          <>
            <View style={styles.premiumCard}>
              <Text style={styles.premiumCardTitle}>Upgrade to Premium</Text>

              <View style={styles.cycleToggle}>
                {(['monthly', 'yearly'] as const).map((cycle) => (
                  <TouchableOpacity
                    key={cycle}
                    style={[styles.cycleBtn, billingCycle === cycle && styles.cycleBtnActive]}
                    onPress={() => setBillingCycle(cycle)}
                  >
                    <Text style={[styles.cycleBtnTxt, billingCycle === cycle && styles.cycleBtnTxtActive]}>
                      {cycle === 'monthly' ? 'Monthly' : 'Yearly'}
                    </Text>
                    {cycle === 'yearly' && (
                      <View style={styles.saveBadge}>
                        <Text style={styles.saveBadgeTxt}>SAVE ~16%</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.premiumCardPrice}>
                {billingCycle === 'monthly' ? '₱199' : '₱1,999'}
                <Text style={styles.premiumCardPer}>{billingCycle === 'monthly' ? '/mo' : '/yr'}</Text>
              </Text>
              <Text style={styles.premiumCardSub}>
                Get the most out of DermAI with unlimited access
              </Text>

              <TouchableOpacity
                style={[styles.upgradeBtn, loading && styles.upgradeBtnDisabled]}
                onPress={handleUpgrade}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.upgradeBtnTxt}>⭐ Subscribe for {priceLabel}</Text>
                )}
              </TouchableOpacity>
              <Text style={styles.cancelNote}>Cancel anytime · No hidden fees</Text>
            </View>
          </>
        )}

        {/* Premium benefits card */}


      </ScrollView>

      {/* Payment Form Modal */}
      <PaymentModal
        visible={showPayment}
        billingCycle={billingCycle}
        price={price}
        priceLabel={priceLabel}
        loading={loading}
        user={user}
        onSubmit={(last4, expiry) => processPayment(last4, expiry)}
        onClose={() => setShowPayment(false)}
      />
    </SafeAreaView>
  );
}

function PaymentModal({
  visible,
  billingCycle,
  price,
  priceLabel,
  loading,
  user,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  billingCycle: string;
  price: number;
  priceLabel: string;
  loading: boolean;
  user: PatientAccount | null;
  onSubmit: (cardLast4: string, cardExpiry: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    console.log('[PaymentModal] visible=', visible, 'loading=', loading);
  }, [visible, loading]);
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [country, setCountry] = useState('Philippines');
  const [tin, setTin] = useState('');
  const [address, setAddress] = useState(user?.address ?? '');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');

  const tax = Math.round(price * 0.12 * 100) / 100;
  const total = Math.round((price + tax) * 100) / 100;

  function handleSubmit() {
    if (!fullName.trim()) {
      Alert.alert('Missing Field', 'Please enter your full name.');
      return;
    }
    if (cardNumber.replace(/\s/g, '').length < 16) {
      Alert.alert('Invalid Card', 'Please enter a valid 16-digit card number.');
      return;
    }
    if (!/^\d{2}\/\d{2}$/.test(expiry)) {
      Alert.alert('Invalid Expiry', 'Enter expiry in MM/YY format.');
      return;
    }
    if (cvc.length < 3) {
      Alert.alert('Invalid CVC', 'Enter a 3-digit security code.');
      return;
    }
    const digits = cardNumber.replace(/\s/g, '');
    onSubmit(digits.slice(-4), expiry);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <SafeAreaView style={payStyles.safe}>
          <View style={payStyles.header}>
            <Text style={payStyles.title}>Plan & Payment</Text>
            <TouchableOpacity onPress={onClose} style={payStyles.closeBtn}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={payStyles.content} keyboardShouldPersistTaps="handled">

            {/* Order Summary Card */}
            <View style={payStyles.summaryCard}>
              <View style={payStyles.planHeader}>
                <View style={payStyles.planIconBox}>
                  <Ionicons name="trophy" size={22} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={payStyles.planName}>Pro Plan</Text>
                  <Text style={payStyles.planSubName}>Unlimited Anomaly Scans</Text>
                </View>
              </View>

              <View style={payStyles.divider} />

              <View style={payStyles.summaryRow}>
                <Text style={payStyles.summaryLabel}>Billing</Text>
                <Text style={payStyles.summaryValue}>{billingCycle === 'monthly' ? 'Monthly' : 'Yearly'}</Text>
              </View>
              <View style={payStyles.summaryRow}>
                <Text style={payStyles.summaryLabel}>Subtotal</Text>
                <Text style={payStyles.summaryValue}>₱{price}</Text>
              </View>
              <View style={payStyles.summaryRow}>
                <Text style={payStyles.summaryLabel}>Tax (12%)</Text>
                <Text style={payStyles.summaryValue}>₱{tax.toFixed(2)}</Text>
              </View>

              <View style={payStyles.divider} />

              <View style={payStyles.summaryRow}>
                <Text style={payStyles.totalLabel}>Total Due Today</Text>
                <Text style={payStyles.totalValue}>₱{total.toFixed(2)}</Text>
              </View>

              <View style={payStyles.warningBox}>
                <Ionicons name="information-circle" size={15} color="#d97706" style={{ marginTop: 1 }} />
                <Text style={payStyles.warningText}>
                  Subscription renews automatically every {billingCycle === 'monthly' ? 'month' : 'year'} unless canceled. You can cancel at any time from your account settings.
                </Text>
              </View>
            </View>

            {/* Payment Information Card */}
            <View style={payStyles.paymentCard}>
              <Text style={payStyles.cardTitle}>Payment Information</Text>

              <View style={payStyles.field}>
                <Text style={payStyles.fieldLabel}>Full Name</Text>
                <TextInput
                  style={payStyles.input}
                  placeholder="Full name on card"
                  placeholderTextColor={COLORS.textLight}
                  value={fullName}
                  onChangeText={setFullName}
                  autoCapitalize="words"
                />
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={[payStyles.field, { flex: 1 }]}>
                  <Text style={payStyles.fieldLabel}>Country</Text>
                  <TextInput
                    style={payStyles.input}
                    value={country}
                    onChangeText={setCountry}
                    autoCapitalize="words"
                  />
                </View>
                <View style={[payStyles.field, { flex: 1 }]}>
                  <Text style={payStyles.fieldLabel}>Philippine TIN (Optional)</Text>
                  <TextInput
                    style={payStyles.input}
                    placeholder="XXX-XXX-XXX"
                    placeholderTextColor={COLORS.textLight}
                    value={tin}
                    onChangeText={setTin}
                    keyboardType="number-pad"
                  />
                </View>
              </View>

              <View style={payStyles.field}>
                <Text style={payStyles.fieldLabel}>Address</Text>
                <TextInput
                  style={payStyles.input}
                  placeholder="Street address, city, province"
                  placeholderTextColor={COLORS.textLight}
                  value={address}
                  onChangeText={setAddress}
                  autoCapitalize="words"
                />
              </View>

              <View style={payStyles.field}>
                <Text style={payStyles.fieldLabel}>Email Address</Text>
                <TextInput
                  style={[payStyles.input, payStyles.inputDisabled]}
                  value={user?.email ?? ''}
                  editable={false}
                />
              </View>

              <View style={payStyles.field}>
                <Text style={payStyles.fieldLabel}>Card Number</Text>
                <TextInput
                  style={payStyles.input}
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

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={[payStyles.field, { flex: 1 }]}>
                  <Text style={payStyles.fieldLabel}>Expiration Date</Text>
                  <TextInput
                    style={payStyles.input}
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
                <View style={[payStyles.field, { flex: 1 }]}>
                  <Text style={payStyles.fieldLabel}>Security Code</Text>
                  <TextInput
                    style={payStyles.input}
                    placeholder="CVC"
                    placeholderTextColor={COLORS.textLight}
                    value={cvc}
                    onChangeText={(v) => setCvc(v.replace(/\D/g, '').slice(0, 3))}
                    keyboardType="number-pad"
                    maxLength={3}
                    secureTextEntry
                  />
                </View>
              </View>

              <View style={payStyles.btnRow}>
                <TouchableOpacity style={payStyles.cancelBtn} onPress={onClose} disabled={loading}>
                  <Text style={payStyles.cancelBtnTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[payStyles.subscribeBtn, loading && { opacity: 0.6 }]}
                  onPress={handleSubmit}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Ionicons name="sparkles" size={15} color="#fff" />
                      <Text style={payStyles.subscribeBtnTxt}>Subscribe ₱{total.toFixed(2)}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            <Text style={payStyles.demoNote}>Demo mode — no real payment will be charged</Text>
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const payStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  title: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  closeBtn: { padding: 4 },
  content: { padding: 16 },
  summaryCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 14,
  },
  planHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  planIconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planName: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  planSubName: { fontSize: 12, color: COLORS.primary, marginTop: 2 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 12 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  summaryLabel: { fontSize: 14, color: COLORS.textSecondary },
  summaryValue: { fontSize: 14, color: COLORS.text, fontWeight: '500' },
  totalLabel: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  totalValue: { fontSize: 16, fontWeight: '800', color: COLORS.primary },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
  warningText: { flex: 1, fontSize: 12, color: '#92400e', lineHeight: 17 },
  paymentCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 14,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 16 },
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 6 },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 14,
    color: COLORS.text,
  },
  inputDisabled: { color: COLORS.textSecondary, backgroundColor: '#f3f4f6' },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnTxt: { color: COLORS.text, fontWeight: '600', fontSize: 14 },
  subscribeBtn: {
    flex: 2,
    backgroundColor: '#10b981',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  subscribeBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  demoNote: { textAlign: 'center', color: COLORS.textSecondary, fontSize: 12, marginBottom: 6 },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  backBtn: { padding: 2 },
  headerTitle: { fontSize: 24, fontWeight: '700', color: COLORS.text },
  activePill: {
    backgroundColor: COLORS.successLight,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  activePillTxt: { color: COLORS.success, fontWeight: '700', fontSize: 13 },
  planCard: {
    margin: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  planCardPremium: {
    backgroundColor: COLORS.primaryLight,
    borderColor: COLORS.primary,
  },
  planTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  planEmoji: { fontSize: 28 },
  planName: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  planDate: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  freeLimitTxt: { fontSize: 12, color: COLORS.textSecondary },
  cycleToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 10,
    padding: 3,
    marginBottom: 16,
    gap: 4,
  },
  cycleBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  cycleBtnActive: { backgroundColor: '#fff' },
  cycleBtnTxt: { color: 'rgba(255,255,255,0.8)', fontWeight: '600', fontSize: 13 },
  cycleBtnTxtActive: { color: COLORS.primary },
  saveBadge: {
    backgroundColor: '#fbbf24',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  saveBadgeTxt: { fontSize: 9, fontWeight: '800', color: '#1f2937' },
  premiumCard: {
    marginHorizontal: 16,
    backgroundColor: COLORS.primary,
    borderRadius: 20,
    padding: 22,
    marginBottom: 16,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  premiumCardTitle: { fontSize: 14, color: 'rgba(255,255,255,0.85)', marginBottom: 6 },
  premiumCardPrice: { fontSize: 36, fontWeight: '800', color: '#fff', marginBottom: 4 },
  premiumCardPer: { fontSize: 16, fontWeight: '400' },
  premiumCardSub: { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginBottom: 20 },
  featuresList: { gap: 8, marginBottom: 20 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  featureCheck: { color: '#a7f3d0', fontWeight: '700', fontSize: 14, marginTop: 1 },
  featureTxt: { color: '#fff', fontSize: 13, flex: 1, lineHeight: 19 },
  upgradeBtn: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  upgradeBtnDisabled: { opacity: 0.6 },
  upgradeBtnTxt: { color: COLORS.primary, fontWeight: '700', fontSize: 16 },
  cancelNote: { textAlign: 'center', color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  comparisonCard: {
    marginHorizontal: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  compTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text, marginBottom: 12 },
  compRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  compFeature: { flex: 2, fontSize: 13, color: COLORS.text },
  compFree: { flex: 1, fontSize: 12, color: COLORS.textSecondary, textAlign: 'center' },
  compPremium: { flex: 1, fontSize: 12, color: COLORS.primary, fontWeight: '600', textAlign: 'center' },
});
