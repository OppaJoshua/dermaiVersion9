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
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, MAX_FREE_SCANS } from '@/lib/constants';
import {
  getCurrentUser,
  getUserSubscription,
  setUserSubscription,
  pushAdminNotification,
  updatePlatformUserPlan,
  addAppNotification,
} from '@/lib/store';
import type { PatientAccount, SubscriptionRecord } from '@/lib/store';
import { processPayMongoSubscriptionPayment } from '@/lib/paymongo';
import { logAuditEvent } from '@/lib/auditLogger';

const GCASH_LOGO = require('@/assets/images/gcash.png');
const MAYA_LOGO = require('@/assets/images/maya.png');

export default function SubscriptionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const [user, setUser] = useState<PatientAccount | null>(null);
  const [sub, setSub] = useState<SubscriptionRecord | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [loading, setLoading] = useState(false);
  const [showPayment, setShowPayment] = useState(false);

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
  }

  function handleBack() {
    if (params.from === 'settings') {
      router.replace('/(app)/settings');
    } else if (params.from === 'profile') {
      router.replace('/(app)/profile');
    } else if (params.from === 'scan') {
      router.replace('/(app)/scan');
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(app)/settings');
    }
  }

  const isPremium = sub?.plan === 'premium' || sub?.plan === 'pro' || sub?.scanLimit === -1;
  const price = billingCycle === 'monthly' ? 199 : 1999;
  const priceLabel = billingCycle === 'monthly' ? '₱199/month' : '₱1,999/year';
  const scansUsed = sub?.scansUsed ?? 0;

  const formattedRenewalDate = (() => {
    if (!sub?.endDate) return null;
    try {
      const d = new Date(sub.endDate);
      return isNaN(d.getTime())
        ? null
        : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return null;
    }
  })();

  async function handleUpgrade() {
    if (!user) {
      Alert.alert('Sign In Required', 'Please sign in to subscribe to DermAI Premium.');
      return;
    }
    setShowPayment(true);
  }

  async function handleCancelSubscription() {
    if (!user) return;
    Alert.alert(
      'Cancel Premium Plan',
      'Are you sure you want to cancel your Premium subscription? You will return to the Free Tier with 3 scans per month.',
      [
        { text: 'Keep Premium', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              const freeSub: SubscriptionRecord = {
                userId: user.id,
                email: user.email,
                plan: 'free',
                scansUsed: sub?.scansUsed ?? 0,
              };
              await setUserSubscription(user.id, freeSub);
              await updatePlatformUserPlan(user.id, 'free');
              setSub(freeSub);

              logAuditEvent({
                user_id: user.id,
                user_type: 'patient',
                performer_name: user.fullName || user.email?.split('@')[0] || 'Patient',
                action: 'Subscription Cancelled',
                log_type: 'subscription',
                target: 'Premium Plan',
                details: 'Patient cancelled premium subscription on mobile app, reverting to free tier',
                metadata: { previous_plan: sub?.plan || 'premium', platform: 'Mobile App' },
              }).catch(() => {});

              Alert.alert('Subscription Cancelled', 'Your account has been switched to the Free Plan.');
            } catch (err: any) {
              Alert.alert('Error', err?.message ?? 'Could not cancel subscription.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  }

  const FEATURES = [
    { title: 'Unlimited AI Skin Scans', desc: 'No monthly scan limits or quota restrictions' },
    { title: '15-Question Clinical Pre-Screening', desc: 'Complete symptom evidence mapping' },
    { title: 'High-Resolution Dual-Photo Comparison', desc: 'Close-up & wide angle lesion inspection' },
    { title: 'Priority Clinic Consultations', desc: 'Direct face-to-face appointment scheduling' },
    { title: 'Confidential DOH Referral Alerts', desc: 'Instant warnings on severe or reportable signs' },
    { title: 'Permanent Skin Scan History', desc: 'Store, compare, and share records with doctors' },
  ];

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Header with reliable back navigation ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={20} color={COLORS.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.headerTitle}>Manage Subscription</Text>
          <Text style={styles.headerSub}>Choose your skin health coverage</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        {/* ── Active Status Banner ── */}
        {isPremium ? (
          <View style={styles.activePremiumCard}>
            <View style={styles.activePremiumTop}>
              <View style={styles.trophyWrap}>
                <Ionicons name="star" size={22} color="#fff" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.activePremiumTitle}>DermAI Premium Active</Text>
                <Text style={styles.activePremiumSub}>Unlimited Clinical Assessments</Text>
              </View>
              <View style={styles.activeBadge}>
                <Text style={styles.activeBadgeTxt}>ACTIVE</Text>
              </View>
            </View>

            <View style={styles.activeDivider} />

            <View style={styles.activeMetaRow}>
              <View>
                <Text style={styles.activeMetaLabel}>Billing Cycle</Text>
                <Text style={styles.activeMetaVal}>
                  {sub?.billingCycle === 'yearly' ? '₱1,999 / Year' : '₱199 / Month'}
                </Text>
              </View>
              {formattedRenewalDate ? (
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.activeMetaLabel}>Renewal Date</Text>
                  <Text style={styles.activeMetaVal}>{formattedRenewalDate}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.cardEndingRow}>
              <Ionicons name="wallet-outline" size={14} color="rgba(255,255,255,0.85)" />
              <Text style={styles.cardEndingTxt}>
                Paid via {sub?.paymentMethod || 'GCash / Maya E-Wallet'} (PayMongo Verified)
              </Text>
            </View>

            <TouchableOpacity
              style={styles.cancelPlanBtn}
              onPress={handleCancelSubscription}
              disabled={loading}
              activeOpacity={0.8}
            >
              <Ionicons name="close-circle-outline" size={15} color="#fff" />
              <Text style={styles.cancelPlanBtnTxt}>Cancel Subscription</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.freeTierCard}>
            <View style={styles.freeTierHeader}>
              <View style={styles.freeIconCircle}>
                <Ionicons name="shield-outline" size={20} color={COLORS.primary} />
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.freeTierTitle}>Free Plan Tier</Text>
                <Text style={styles.freeTierSub}>{MAX_FREE_SCANS} free AI skin anomaly scans included</Text>
              </View>
            </View>

            {/* Scan quota bar */}
            <View style={styles.quotaBarSection}>
              <View style={styles.quotaLabels}>
                <Text style={styles.quotaCountTxt}>{scansUsed} of {MAX_FREE_SCANS} Scans Used</Text>
                <Text style={styles.quotaRemainingTxt}>
                  {Math.max(0, MAX_FREE_SCANS - scansUsed)} remaining
                </Text>
              </View>
              <View style={styles.quotaTrack}>
                <View
                  style={[
                    styles.quotaFill,
                    { width: `${Math.min(100, (scansUsed / MAX_FREE_SCANS) * 100)}%` },
                  ]}
                />
              </View>
            </View>
          </View>
        )}

        {/* ── Billing Cycle Selector (if Free or Upgrading) ── */}
        {!isPremium && (
          <View style={styles.cycleToggleContainer}>
            <View style={styles.cycleToggle}>
              <TouchableOpacity
                style={[styles.cycleBtn, billingCycle === 'monthly' && styles.cycleBtnActive]}
                onPress={() => setBillingCycle('monthly')}
                activeOpacity={0.8}
              >
                <Text style={[styles.cycleBtnTxt, billingCycle === 'monthly' && styles.cycleBtnTxtActive]}>
                  Monthly
                </Text>
                <Text style={[styles.cyclePriceTxt, billingCycle === 'monthly' && styles.cyclePriceTxtActive]}>
                  ₱199/mo
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.cycleBtn, billingCycle === 'yearly' && styles.cycleBtnActive]}
                onPress={() => setBillingCycle('yearly')}
                activeOpacity={0.8}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={[styles.cycleBtnTxt, billingCycle === 'yearly' && styles.cycleBtnTxtActive]}>
                    Yearly
                  </Text>
                  <View style={styles.saveBadge}>
                    <Text style={styles.saveBadgeTxt}>SAVE 16%</Text>
                  </View>
                </View>
                <Text style={[styles.cyclePriceTxt, billingCycle === 'yearly' && styles.cyclePriceTxtActive]}>
                  ₱1,999/yr
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Upgrade Card ── */}
        {!isPremium && (
          <View style={styles.planCard}>
            <View style={styles.planBadgeRow}>
              <View style={styles.proCrownBadge}>
                <Ionicons name="sparkles" size={12} color={COLORS.primary} />
                <Text style={styles.proCrownTxt}>PREMIUM CARE</Text>
              </View>
              <Text style={styles.billedFrequency}>
                {billingCycle === 'yearly' ? 'Billed ₱1,999 annually' : 'Billed monthly'}
              </Text>
            </View>

            <View style={styles.priceRow}>
              <Text style={styles.priceCurrency}>₱</Text>
              <Text style={styles.priceMain}>{billingCycle === 'monthly' ? '199' : '1,999'}</Text>
              <Text style={styles.pricePer}>{billingCycle === 'monthly' ? '/ month' : '/ year'}</Text>
            </View>
            <Text style={styles.priceDisclaimer}>Cancel anytime • GCash &amp; Maya accepted</Text>

            <TouchableOpacity
              style={[styles.upgradeBtn, loading && styles.upgradeBtnDisabled]}
              onPress={handleUpgrade}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="star" size={17} color="#fff" />
                  <Text style={styles.upgradeBtnTxt}>Upgrade to Premium — {priceLabel}</Text>
                </View>
              )}
            </TouchableOpacity>

            <View style={styles.securityRow}>
              <Ionicons name="lock-closed" size={12} color="#059669" />
              <Text style={styles.securityTxt}>Instant activation via PayMongo E-Wallet Checkout</Text>
            </View>
          </View>
        )}

        {/* ── Premium Features Checklist ── */}
        <View style={styles.featuresSection}>
          <Text style={styles.featuresTitle}>What&apos;s Included in Premium</Text>
          <View style={styles.featuresCard}>
            {FEATURES.map((item, idx) => (
              <View
                key={item.title}
                style={[
                  styles.featureRow,
                  idx === FEATURES.length - 1 && { borderBottomWidth: 0 },
                ]}
              >
                <View style={styles.checkCircle}>
                  <Ionicons name="checkmark" size={14} color="#059669" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.featureTitle}>{item.title}</Text>
                  <Text style={styles.featureDesc}>{item.desc}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

      </ScrollView>

      {/* PayMongo E-Wallet Payment Modal */}
      <PaymentModal
        visible={showPayment}
        billingCycle={billingCycle}
        price={price}
        user={user}
        onCompleted={async () => {
          await loadData();
          setShowPayment(false);
        }}
        onClose={() => setShowPayment(false)}
      />
    </SafeAreaView>
  );
}

function PaymentModal({
  visible,
  billingCycle,
  price,
  user,
  onCompleted,
  onClose,
}: {
  visible: boolean;
  billingCycle: 'monthly' | 'yearly';
  price: number;
  user: PatientAccount | null;
  onCompleted: () => void;
  onClose: () => void;
}) {
  const [paymentMethod, setPaymentMethod] = useState<'gcash' | 'maya'>('gcash');
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [address, setAddress] = useState(user?.address || user?.location || 'Cebu City');
  const [mobileNumber, setMobileNumber] = useState(user?.phone ?? '');
  const [processing, setProcessing] = useState(false);
  const [receipt, setReceipt] = useState<{
    reference: string;
    amount: number;
    method: 'gcash' | 'maya';
    mobileNumber: string;
    billingCycle: 'monthly' | 'yearly';
    date: string;
  } | null>(null);

  useEffect(() => {
    if (visible) {
      setReceipt(null);
      setProcessing(false);
      if (user) {
        setFullName(user.fullName || '');
        setEmail(user.email || '');
        setAddress(user.address || user.location || 'Cebu City');
        setMobileNumber(user.phone || '');
      }
    }
  }, [visible, user]);

  async function handlePayWithPayMongo() {
    if (!user) return;
    if (!fullName.trim()) {
      Alert.alert('Missing Field', 'Please enter your full name.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      Alert.alert('Invalid Email', 'Please enter a valid email address for your receipt.');
      return;
    }
    const cleanedMobile = mobileNumber.replace(/\D/g, '');
    if (cleanedMobile.length !== 11 || !cleanedMobile.startsWith('09')) {
      Alert.alert(
        'Invalid Mobile Number',
        `Please enter a valid 11-digit Philippine mobile number starting with 09 for your ${paymentMethod === 'gcash' ? 'GCash' : 'Maya'} account.`
      );
      return;
    }

    setProcessing(true);
    try {
      // Launch PayMongo Test Checkout (create_intent -> payment_methods -> attach_payment_method -> WebBrowser redirect -> verify_payment_intent)
      const result = await processPayMongoSubscriptionPayment({
        userId: user.id,
        billingCycle,
        paymentMethod,
        fullName: fullName.trim(),
        email: email.trim(),
        address: address.trim() || 'Cebu City',
        mobileNumber: cleanedMobile,
      });

      const now = new Date();
      const end = new Date(now);
      if (billingCycle === 'monthly') end.setMonth(end.getMonth() + 1);
      else end.setFullYear(end.getFullYear() + 1);

      const newSub: SubscriptionRecord = {
        userId: user.id,
        email: user.email,
        plan: 'premium',
        billingCycle,
        startDate: now.toISOString(),
        endDate: end.toISOString(),
        transactionId: result.paymongoPaymentId,
        scansUsed: 0,
        paymentMethod: paymentMethod === 'maya' ? 'Maya' : 'GCash',
        mobileNumber: cleanedMobile,
      };

      // Log audit event for subscription payment
      logAuditEvent({
        user_id: user.id,
        user_type: 'patient',
        performer_name: fullName.trim() || user.fullName || 'Patient',
        action: 'Payment Completed',
        log_type: 'subscription',
        target: `Subscription Payment (${paymentMethod.toUpperCase()})`,
        details: `Subscribed to DermAI Pro Plan (${billingCycle}) for ₱${price.toLocaleString()} via ${paymentMethod.toUpperCase()} (Ref: ${result.paymongoPaymentId})`,
        metadata: {
          billing_cycle: billingCycle,
          plan: 'premium',
          payment_method: paymentMethod,
          payment_reference: result.paymongoPaymentId,
          amount: price,
          platform: 'Mobile App',
        },
      }).catch(() => {});

      // Edge Function already fulfilled `user_plan_subscription` and `user_payment`,
      // and we also sync local state & notifications for immediate UI update.
      await setUserSubscription(user.id, newSub);
      await addAppNotification(user.id, {
        type: 'subscription',
        title: 'DermAI Pro Plan Activated',
        message: `Your ${billingCycle === 'yearly' ? 'Annual' : 'Monthly'} Pro subscription (₱${price.toLocaleString()}) via ${paymentMethod === 'gcash' ? 'GCash' : 'Maya'} is now active. Ref: ${result.paymongoPaymentId}`,
        userId: user.id,
      });
      await pushAdminNotification({
        type: 'new-subscription',
        title: 'New Premium Subscription',
        message: `${fullName.trim()} (${email.trim()}) subscribed to Premium (${billingCycle}) via ${paymentMethod === 'gcash' ? 'GCash' : 'Maya'} — ₱${price.toLocaleString()} (Ref: ${result.paymongoPaymentId})`,
      });

      setReceipt({
        reference: result.paymongoPaymentId,
        amount: price,
        method: paymentMethod,
        mobileNumber: cleanedMobile,
        billingCycle,
        date: now.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
      });
    } catch (err: any) {
      Alert.alert('Payment Notice', err?.message ?? 'Could not complete subscription payment.');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <SafeAreaView style={payStyles.safe}>
          <View style={payStyles.header}>
            <TouchableOpacity
              onPress={() => {
                if (receipt) {
                  setReceipt(null);
                  onCompleted();
                } else {
                  onClose();
                }
              }}
              style={payStyles.backBtn}
              disabled={processing}
            >
              <Ionicons name={receipt ? 'close' : 'chevron-back'} size={18} color={COLORS.text} />
              <Text style={payStyles.backBtnTxt}>{receipt ? 'Close' : 'Cancel'}</Text>
            </TouchableOpacity>
            <Text style={payStyles.title}>
              {receipt ? 'Subscription Receipt' : 'E-Wallet Checkout'}
            </Text>
            <View style={{ width: 50 }} />
          </View>

          <ScrollView contentContainerStyle={payStyles.content} keyboardShouldPersistTaps="handled">
            {receipt ? (
              <View style={payStyles.receiptWrap}>
                <View style={payStyles.receiptSuccessCircle}>
                  <Ionicons name="checkmark-circle" size={46} color="#059669" />
                </View>
                <Text style={payStyles.receiptTitle}>Subscription Activated!</Text>
                <Text style={payStyles.receiptSub}>
                  Your payment was verified via PayMongo and your DermAI Pro Plan is now active.
                </Text>

                <View style={payStyles.summaryCard}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View>
                      <Text style={payStyles.planName}>Official Subscription Receipt</Text>
                      <Text style={{ fontSize: 11, color: COLORS.primary, fontWeight: '700', marginTop: 2 }}>
                        {receipt.reference}
                      </Text>
                    </View>
                    <View style={payStyles.paidPill}>
                      <Text style={payStyles.paidPillTxt}>PAID</Text>
                    </View>
                  </View>

                  <View style={payStyles.divider} />

                  <View style={payStyles.summaryRow}>
                    <Text style={payStyles.summaryLabel}>Plan</Text>
                    <Text style={payStyles.summaryValue}>
                      DermAI Pro ({receipt.billingCycle === 'yearly' ? 'Annual' : 'Monthly'})
                    </Text>
                  </View>
                  <View style={payStyles.summaryRow}>
                    <Text style={payStyles.summaryLabel}>Payment Method</Text>
                    <Text style={payStyles.summaryValue}>
                      {receipt.method === 'gcash' ? 'GCash' : 'Maya'} ({receipt.mobileNumber})
                    </Text>
                  </View>
                  <View style={payStyles.summaryRow}>
                    <Text style={payStyles.summaryLabel}>Date</Text>
                    <Text style={payStyles.summaryValue}>{receipt.date}</Text>
                  </View>

                  <View style={payStyles.divider} />

                  <View style={payStyles.summaryRow}>
                    <Text style={payStyles.totalLabel}>Amount Paid</Text>
                    <Text style={payStyles.totalValue}>₱{receipt.amount.toLocaleString()}.00</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={payStyles.payBtn}
                  onPress={() => {
                    setReceipt(null);
                    onCompleted();
                  }}
                >
                  <Text style={payStyles.payBtnTxt}>Done &amp; Return to Subscription</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {/* Order Summary Card */}
                <View style={payStyles.summaryCard}>
                  <View style={payStyles.planHeader}>
                    <View style={payStyles.planIconBox}>
                      <Ionicons name="star" size={20} color={COLORS.primary} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={payStyles.planName}>DermAI Premium Plan</Text>
                      <Text style={payStyles.planSubName}>
                        {billingCycle === 'monthly' ? 'Monthly Subscription' : 'Annual Subscription'}
                      </Text>
                    </View>
                  </View>

                  <View style={payStyles.divider} />

                  <View style={payStyles.summaryRow}>
                    <Text style={payStyles.summaryLabel}>Plan Price</Text>
                    <Text style={payStyles.summaryValue}>₱{price.toLocaleString()}.00</Text>
                  </View>
                  <View style={payStyles.summaryRow}>
                    <Text style={payStyles.summaryLabel}>Processing Fee</Text>
                    <Text style={[payStyles.summaryValue, { color: '#059669' }]}>₱0.00 (Waived)</Text>
                  </View>

                  <View style={payStyles.divider} />

                  <View style={payStyles.summaryRow}>
                    <Text style={payStyles.totalLabel}>Total Due Today</Text>
                    <Text style={payStyles.totalValue}>₱{price.toLocaleString()}.00</Text>
                  </View>
                </View>

                {/* E-Wallet Selection & Payer Details */}
                <View style={payStyles.paymentCard}>
                  <Text style={payStyles.cardTitle}>1. Select E-Wallet (PayMongo Checkout)</Text>

                  <View style={payStyles.walletRow}>
                    <TouchableOpacity
                      style={[
                        payStyles.walletOption,
                        paymentMethod === 'gcash' && payStyles.walletOptionGCashActive,
                      ]}
                      onPress={() => setPaymentMethod('gcash')}
                      activeOpacity={0.8}
                    >
                      <Image source={GCASH_LOGO} style={payStyles.walletLogo} resizeMode="contain" />
                      <Text
                        style={[
                          payStyles.walletName,
                          paymentMethod === 'gcash' && { color: '#007DFE', fontWeight: '800' },
                        ]}
                      >
                        GCash
                      </Text>
                      {paymentMethod === 'gcash' && (
                        <Ionicons name="checkmark-circle" size={16} color="#007DFE" />
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        payStyles.walletOption,
                        paymentMethod === 'maya' && payStyles.walletOptionMayaActive,
                      ]}
                      onPress={() => setPaymentMethod('maya')}
                      activeOpacity={0.8}
                    >
                      <Image source={MAYA_LOGO} style={payStyles.walletLogo} resizeMode="contain" />
                      <Text
                        style={[
                          payStyles.walletName,
                          paymentMethod === 'maya' && { color: '#00D632', fontWeight: '800' },
                        ]}
                      >
                        Maya
                      </Text>
                      {paymentMethod === 'maya' && (
                        <Ionicons name="checkmark-circle" size={16} color="#00D632" />
                      )}
                    </TouchableOpacity>
                  </View>

                  <Text style={[payStyles.cardTitle, { marginTop: 6 }]}>2. Account &amp; Billing Details</Text>

                  <View style={payStyles.field}>
                    <Text style={payStyles.fieldLabel}>Full Name *</Text>
                    <TextInput
                      style={payStyles.input}
                      placeholder="e.g. Maria Santos"
                      placeholderTextColor={COLORS.textLight}
                      value={fullName}
                      onChangeText={setFullName}
                      autoCapitalize="words"
                    />
                  </View>

                  <View style={payStyles.field}>
                    <Text style={payStyles.fieldLabel}>Email Address *</Text>
                    <TextInput
                      style={payStyles.input}
                      placeholder="patient@example.com"
                      placeholderTextColor={COLORS.textLight}
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                  </View>

                  <View style={payStyles.field}>
                    <Text style={payStyles.fieldLabel}>
                      {paymentMethod === 'gcash' ? 'GCash' : 'Maya'} Registered Mobile Number *
                    </Text>
                    <TextInput
                      style={payStyles.input}
                      placeholder="09XXXXXXXXX (11 digits)"
                      placeholderTextColor={COLORS.textLight}
                      value={mobileNumber}
                      onChangeText={(val) => setMobileNumber(val.replace(/\D/g, '').slice(0, 11))}
                      keyboardType="phone-pad"
                      maxLength={11}
                    />
                  </View>

                  <View style={payStyles.field}>
                    <Text style={payStyles.fieldLabel}>Billing Address *</Text>
                    <TextInput
                      style={payStyles.input}
                      placeholder="Street address, city"
                      placeholderTextColor={COLORS.textLight}
                      value={address}
                      onChangeText={setAddress}
                    />
                  </View>

                  <TouchableOpacity
                    style={[payStyles.payBtn, processing && { opacity: 0.7 }]}
                    onPress={handlePayWithPayMongo}
                    disabled={processing}
                  >
                    {processing ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <ActivityIndicator color="#fff" size="small" />
                        <Text style={payStyles.payBtnTxt}>
                          Opening {paymentMethod === 'gcash' ? 'GCash' : 'Maya'} Checkout...
                        </Text>
                      </View>
                    ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name="lock-closed" size={15} color="#fff" />
                        <Text style={payStyles.payBtnTxt}>
                          Pay ₱{price.toLocaleString()}.00 via {paymentMethod === 'gcash' ? 'GCash' : 'Maya'}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>

                  <Text style={payStyles.disclaimerTxt}>
                    You will be directed to the PayMongo Test Checkout page to authorize your {paymentMethod === 'gcash' ? 'GCash' : 'Maya'} payment.
                  </Text>
                </View>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  headerSub: { fontSize: 11, color: COLORS.textSecondary, marginTop: 1 },

  scrollContent: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 50 },

  // Active Premium Banner
  activePremiumCard: {
    backgroundColor: '#85134a',
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
  },
  activePremiumTop: { flexDirection: 'row', alignItems: 'center' },
  trophyWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activePremiumTitle: { fontSize: 17, fontWeight: '800', color: '#fff' },
  activePremiumSub: { fontSize: 12, color: 'rgba(255, 255, 255, 0.85)', marginTop: 2 },
  activeBadge: {
    backgroundColor: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  activeBadgeTxt: { fontSize: 10, fontWeight: '800', color: COLORS.primary },
  activeDivider: { height: 1, backgroundColor: 'rgba(255, 255, 255, 0.2)', marginVertical: 14 },
  activeMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  activeMetaLabel: { fontSize: 11, color: 'rgba(255, 255, 255, 0.75)', textTransform: 'uppercase', letterSpacing: 0.4 },
  activeMetaVal: { fontSize: 14, fontWeight: '700', color: '#fff', marginTop: 2 },
  cardEndingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  cardEndingTxt: { fontSize: 11, color: 'rgba(255, 255, 255, 0.9)' },
  cancelPlanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  cancelPlanBtnTxt: { fontSize: 12, fontWeight: '700', color: '#fff' },

  // Free Tier Card
  freeTierCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  freeTierHeader: { flexDirection: 'row', alignItems: 'center' },
  freeIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#fce7f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  freeTierTitle: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  freeTierSub: { fontSize: 12, color: COLORS.textSecondary, marginTop: 1 },
  quotaBarSection: { marginTop: 14 },
  quotaLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  quotaCountTxt: { fontSize: 12, fontWeight: '700', color: COLORS.text },
  quotaRemainingTxt: { fontSize: 12, fontWeight: '600', color: COLORS.primary },
  quotaTrack: {
    height: 8,
    backgroundColor: '#f1f5f9',
    borderRadius: 4,
    overflow: 'hidden',
  },
  quotaFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 4,
  },

  // Cycle Toggle
  cycleToggleContainer: { marginBottom: 14 },
  cycleToggle: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 16,
    padding: 4,
    gap: 6,
  },
  cycleBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
  },
  cycleBtnActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cycleBtnTxt: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary },
  cycleBtnTxtActive: { color: COLORS.primary },
  cyclePriceTxt: { fontSize: 11, color: '#94a3b8', marginTop: 1 },
  cyclePriceTxtActive: { color: COLORS.text, fontWeight: '600' },
  saveBadge: {
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  saveBadgeTxt: { fontSize: 9, fontWeight: '800', color: '#059669' },

  // Upgrade Plan Card
  planCard: {
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 20,
    borderWidth: 2,
    borderColor: '#fbcfe1',
    marginBottom: 20,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  planBadgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  proCrownBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fdf2f7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  proCrownTxt: { fontSize: 10, fontWeight: '800', color: COLORS.primary, letterSpacing: 0.5 },
  billedFrequency: { fontSize: 11, color: COLORS.textSecondary },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 12 },
  priceCurrency: { fontSize: 20, fontWeight: '800', color: COLORS.text },
  priceMain: { fontSize: 36, fontWeight: '900', color: COLORS.text, letterSpacing: -0.5 },
  pricePer: { fontSize: 14, color: COLORS.textSecondary, marginLeft: 6, fontWeight: '600' },
  priceDisclaimer: { fontSize: 12, color: COLORS.textSecondary, marginTop: 4 },
  upgradeBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 16,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  upgradeBtnDisabled: { opacity: 0.5 },
  upgradeBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  securityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 10 },
  securityTxt: { fontSize: 11, color: '#059669', fontWeight: '600' },

  // Features
  featuresSection: { marginBottom: 20 },
  featuresTitle: { fontSize: 13, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8, paddingHorizontal: 4 },
  featuresCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  featureTitle: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  featureDesc: { fontSize: 11, color: '#64748b', marginTop: 1, lineHeight: 16 },
});

const payStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backBtnTxt: { fontSize: 14, color: COLORS.textSecondary, fontWeight: '600' },
  title: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  content: { padding: 16, paddingBottom: 40 },

  summaryCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
  },
  planHeader: { flexDirection: 'row', alignItems: 'center' },
  planIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#fce7f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  planName: { fontSize: 15, fontWeight: '800', color: COLORS.text },
  planSubName: { fontSize: 11, color: COLORS.textSecondary, marginTop: 1 },
  divider: { height: 1, backgroundColor: '#e2e8f0', marginVertical: 12 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  summaryLabel: { fontSize: 13, color: '#64748b' },
  summaryValue: { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  totalLabel: { fontSize: 14, fontWeight: '800', color: COLORS.text },
  totalValue: { fontSize: 18, fontWeight: '900', color: COLORS.primary },

  paymentCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  cardTitle: { fontSize: 14, fontWeight: '800', color: '#334155', marginBottom: 12 },
  walletRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  walletOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  walletOptionGCashActive: {
    borderColor: '#007DFE',
    backgroundColor: '#eff6ff',
  },
  walletOptionMayaActive: {
    borderColor: '#00D632',
    backgroundColor: '#f0fdf4',
  },
  walletLogo: {
    width: 26,
    height: 26,
    borderRadius: 6,
  },
  walletName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
  },
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6 },
  input: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0f172a',
  },
  payBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  payBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  disclaimerTxt: { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 10, lineHeight: 16 },
  receiptWrap: {
    paddingVertical: 12,
  },
  receiptSuccessCircle: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  receiptTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0f172a',
    textAlign: 'center',
  },
  receiptSub: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 20,
    lineHeight: 18,
  },
  paidPill: {
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  paidPillTxt: {
    fontSize: 11,
    fontWeight: '900',
    color: '#059669',
  },
});
