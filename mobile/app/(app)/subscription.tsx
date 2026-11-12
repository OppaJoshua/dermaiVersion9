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
import { supabase } from '@/lib/supabase';
import {
  getCurrentUser,
  getUserSubscription,
  setUserSubscription,
  getActiveSubscriptionPlans,
  cancelSubscriptionAtPeriodEnd,
  resumeSubscription,
  calculatePricing,
  pushAdminNotification,
} from '@/lib/store';
import type {
  PatientAccount,
  SubscriptionRecord,
  SubscriptionPlanOption,
} from '@/lib/store';
import { processPayMongoSubscriptionPayment, verifyPayMongoIntentOnce } from '@/lib/paymongo';
import { logAuditEvent } from '@/lib/auditLogger';

const GCASH_LOGO = require('@/assets/images/gcash.png');
const MAYA_LOGO = require('@/assets/images/maya.png');

export default function SubscriptionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const [user, setUser] = useState<PatientAccount | null>(null);
  const [sub, setSub] = useState<SubscriptionRecord | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlanOption[]>([]);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [initialLoading, setInitialLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showPayment, setShowPayment] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [u, activePlans] = await Promise.all([
        getCurrentUser(),
        getActiveSubscriptionPlans(),
      ]);
      setUser(u);
      setPlans(activePlans);

      if (u) {
        const s = await getUserSubscription(u.id);
        setSub(s);
        if (s?.billingCycle) {
          setBillingCycle(s.billingCycle);
        }
      }
    } finally {
      setInitialLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

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

  const statusLabel = sub?.statusLabel || 'Plan usage';

  const isCancelling = Boolean(
    sub?.cancelAtPeriodEnd ||
    sub?.status === 'canceling' ||
    sub?.status === 'cancelling'
  );

  const isProOrPremium = Boolean(
    (sub?.plan === 'premium' ||
      sub?.plan === 'pro' ||
      sub?.plan === 'basic' ||
      sub?.statusLabel === 'Premium Active' ||
      sub?.statusLabel === 'Basic Active') &&
    !sub?.isExpired
  );

  const isPremium = isProOrPremium;
  const isUnlimitedScans = isPremium && sub?.scanLimit === -1;

  const headerBadgeLabel = isCancelling
    ? 'Canceling'
    : sub?.statusLabel || (isPremium ? 'Premium Active' : 'No Active Subscription');

  const cardBadgeLabel = isCancelling
    ? 'CANCELING'
    : sub?.statusLabel === 'Basic Active' || sub?.plan === 'basic'
    ? 'BASIC ACTIVE'
    : 'PREMIUM ACTIVE';

  // Resolve dynamic monthly & yearly plans from Supabase `plan` table
  const paidPlans = plans.filter((p) => p.price > 0);
  const monthlyPlan =
    paidPlans.find((p) => p.billingType === 'monthly') ||
    paidPlans[0] ||
    null;
  const yearlyPlan =
    paidPlans.find((p) => p.billingType === 'yearly') ||
    null;

  const selectedPlan =
    billingCycle === 'yearly' && yearlyPlan
      ? yearlyPlan
      : monthlyPlan;

  const basePrice = selectedPlan?.price ?? (sub?.basePrice && sub.basePrice > 0 ? sub.basePrice : 0);
  const pricing = calculatePricing(basePrice);
  const totalPrice = selectedPlan?.totalPrice ?? pricing.totalPrice;
  const vatAmount = selectedPlan?.vatAmount ?? pricing.vatAmount;

  const formatMoney = (amount: number) =>
    `₱${amount.toLocaleString('en-PH', {
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    })}`;

  const priceLabel = `${formatMoney(totalPrice)}/${billingCycle === 'yearly' ? 'year' : 'month'}`;
  const scansUsed = sub?.scansUsed ?? 0;
  const freePlanActive = isPremium ? true : Boolean(sub?.freePlanActive);
  const freePlanVerified = isPremium ? true : sub?.freePlanVerified !== false;
  const freePlanAmbiguous = isPremium ? false : Boolean(sub?.freePlanAmbiguous);
  const usageVerified = isUnlimitedScans || (sub?.scansCountVerified !== false && freePlanVerified);
  const isAdminDeactivated = !isPremium && freePlanVerified && !freePlanActive && !freePlanAmbiguous;
  const isAmbiguousConfig = !isPremium && freePlanAmbiguous;
  const freeQuota =
    typeof sub?.scanLimit === 'number' && sub.scanLimit >= 0
      ? sub.scanLimit
      : 0;

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

  const dynamicRemainingDays = (() => {
    const renewalDate = sub?.endDate;
    if (!renewalDate) return sub?.remainingDays ?? 0;
    try {
      const targetTime = new Date(renewalDate).getTime();
      if (isNaN(targetTime)) return sub?.remainingDays ?? 0;
      return Math.max(0, Math.ceil((targetTime - new Date().getTime()) / (1000 * 60 * 60 * 24)));
    } catch {
      return sub?.remainingDays ?? 0;
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
    setLoading(true);
    try {
      // Dynamically resolve authenticated patient ID from Supabase Auth
      const { data: authData } = await supabase.auth.getUser();
      const currentUserId = authData?.user?.id || user?.id;
      if (!currentUserId) {
        console.warn('[handleCancelSubscription] No authenticated user session found.');
        return;
      }

      // Dynamically obtain active subscription record from state or Supabase
      let activeSub = sub;
      if (!activeSub) {
        activeSub = await getUserSubscription(currentUserId);
      }

      const activeSubId = activeSub?.subscriptionId;

      // Immediately execute the cancellation without alert/confirmation dialog
      await cancelSubscriptionAtPeriodEnd(currentUserId, activeSubId);

      // Optimistically update React state immediately so badge transitions in real-time
      setSub((prev) => (prev ? { ...prev, cancelAtPeriodEnd: true, status: 'canceling' } : prev));

      // Refresh active state dynamically from Supabase
      await loadData();

      // Log audit trail dynamically
      logAuditEvent({
        user_id: currentUserId,
        user_type: 'patient',
        performer_name: user?.fullName || authData?.user?.email?.split('@')[0] || 'Patient',
        action: 'Subscription Auto-Renewal Cancelled',
        log_type: 'subscription',
        target: activeSub?.planName || 'Pro Plan',
        details: 'Patient scheduled subscription cancellation at period end on mobile app',
        metadata: {
          previous_plan: activeSub?.planName || 'Pro Plan',
          platform: 'Mobile App',
          subscription_id: activeSubId || null,
        },
      }).catch(() => {});
    } catch (err: any) {
      console.error('[handleCancelSubscription] Error cancelling subscription:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleResumeSubscription() {
    setLoading(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const currentUserId = authData?.user?.id || user?.id;
      if (!currentUserId) {
        console.warn('[handleResumeSubscription] No authenticated user session found.');
        return;
      }

      let activeSub = sub;
      if (!activeSub) {
        activeSub = await getUserSubscription(currentUserId);
      }

      const activeSubId = activeSub?.subscriptionId;

      await resumeSubscription(currentUserId, activeSubId);

      // Optimistically update React state immediately so badge toggles back seamlessly
      setSub((prev) => (prev ? { ...prev, cancelAtPeriodEnd: false, status: 'active' } : prev));

      await loadData();

      logAuditEvent({
        user_id: currentUserId,
        user_type: 'patient',
        performer_name: user?.fullName || authData?.user?.email?.split('@')[0] || 'Patient',
        action: 'Subscription Auto-Renewal Resumed',
        log_type: 'subscription',
        target: activeSub?.planName || 'Pro Plan',
        details: 'Patient resumed subscription auto-renewal on mobile app',
        metadata: {
          plan: activeSub?.planName || 'Pro Plan',
          platform: 'Mobile App',
          subscription_id: activeSubId || null,
        },
      }).catch(() => {});
    } catch (err: any) {
      console.error('[handleResumeSubscription] Error resuming subscription:', err);
    } finally {
      setLoading(false);
    }
  }

  const DEFAULT_FEATURES = [
    { title: 'Unlimited AI Skin Scans', desc: 'No monthly scan limits or quota restrictions' },
    { title: '15-Question Clinical Pre-Screening', desc: 'Complete symptom evidence mapping' },
    { title: 'High-Resolution Dual-Photo Comparison', desc: 'Close-up & wide angle lesion inspection' },
    { title: 'Priority Clinic Consultations', desc: 'Direct face-to-face appointment scheduling' },
    { title: 'Confidential DOH Referral Alerts', desc: 'Instant warnings on severe or reportable signs' },
    { title: 'Permanent Skin Scan History', desc: 'Store, compare, and share records with doctors' },
  ];

  const activeFeatureStrings =
    isPremium && sub?.planFeatures && sub.planFeatures.length > 0
      ? sub.planFeatures
      : selectedPlan?.features && selectedPlan.features.length > 0
      ? selectedPlan.features
      : null;

  const dynamicFeatures = activeFeatureStrings
    ? activeFeatureStrings.map((f) => ({
        title: f,
        desc: `Included in your ${isPremium ? sub?.planName || 'DermAI' : selectedPlan?.name || 'DermAI Pro'} subscription plan`,
      }))
    : DEFAULT_FEATURES;

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Header with reliable back navigation ── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          style={[styles.backBtn, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color={COLORS.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.headerTitle}>Manage Subscription</Text>
          <Text style={styles.headerSub}>Choose your skin health coverage</Text>
        </View>
        <View
          style={[
            styles.headerStatusPill,
            isCancelling
              ? styles.headerStatusCancelling
              : headerBadgeLabel === 'Premium Active'
              ? styles.headerStatusPremium
              : headerBadgeLabel === 'Basic Active'
              ? styles.headerStatusBasic
              : styles.headerStatusNone,
          ]}
        >
          <Text
            style={[
              styles.headerStatusTxt,
              isCancelling
                ? { color: '#b45309' }
                : headerBadgeLabel === 'Premium Active'
                ? { color: '#047857' }
                : headerBadgeLabel === 'Basic Active'
                ? { color: '#0369a1' }
                : { color: '#64748b' },
            ]}
          >
            {headerBadgeLabel}
          </Text>
        </View>
      </View>

      {initialLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={{ marginTop: 12, fontSize: 13, color: COLORS.textSecondary, fontWeight: '600' }}>
            Syncing subscription &amp; live plans from Supabase...
          </Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {/* ── Active Status Banner ── */}
          {isPremium && (
            <View style={styles.activePremiumCard}>
              <View style={styles.activePremiumTop}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={styles.activePremiumTitle}>
                    {sub?.planName || 'DermAI Pro Plan'}
                  </Text>
                </View>
                <View
                  style={[
                    styles.activeBadge,
                    isCancelling && { backgroundColor: '#fffbeb' },
                  ]}
                >
                  <Text
                    style={[
                      styles.activeBadgeTxt,
                      isCancelling && { color: '#b45309' },
                    ]}
                  >
                    {cardBadgeLabel}
                  </Text>
                </View>
              </View>

              <View style={styles.activeDivider} />

              <View style={styles.activeMetaRow}>
                <View>
                  <Text style={styles.activeMetaLabel}>Time left</Text>
                  <Text style={styles.activeMetaVal}>
                    {dynamicRemainingDays} Day{dynamicRemainingDays === 1 ? '' : 's'}
                  </Text>
                </View>
                {formattedRenewalDate ? (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.activeMetaLabel}>
                      {sub?.cancelAtPeriodEnd ? 'Expires On' : 'Next renewal'}
                    </Text>
                    <Text style={styles.activeMetaVal}>{formattedRenewalDate}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          )}

          {/* ── Plan Usage Card (Unlimited vs Limited) ── */}
          <View style={styles.freeTierCard}>
            <View style={[styles.freeTierHeader, { justifyContent: 'space-between', alignItems: 'center' }]}>
              <View style={{ flex: 1, marginRight: 10 }}>
                <Text style={styles.freeTierTitle}>Plan usage</Text>
                <Text style={styles.freeTierSub}>AI skin scans</Text>
              </View>
              {isAdminDeactivated || isAmbiguousConfig ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: '#fffbeb',
                    borderColor: '#fde68a',
                    borderWidth: 1,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 999,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#b45309' }}>
                    Unavailable
                  </Text>
                </View>
              ) : !usageVerified && !isUnlimitedScans ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: '#fff1f2',
                    borderColor: '#fecdd3',
                    borderWidth: 1,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 999,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#be123c' }}>
                    Verification required
                  </Text>
                </View>
              ) : isUnlimitedScans ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: '#fdf2f8',
                    borderColor: '#fce7f3',
                    borderWidth: 1,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 999,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#be185d' }}>
                    ∞ Unlimited
                  </Text>
                </View>
              ) : (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: '#f8fafc',
                    borderColor: '#e2e8f0',
                    borderWidth: 1,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 999,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#334155' }}>
                    Limited — {freeQuota} {freeQuota === 1 ? 'scan' : 'scans'}
                  </Text>
                </View>
              )}
            </View>

            {isAdminDeactivated ? (
              <View style={styles.quotaBarSection}>
                <Text style={styles.freeTierSub}>
                  Free AI skin scanning is currently unavailable. Please view the available subscription plans to continue scanning.
                </Text>
                {scansUsed > 0 && (
                  <Text style={[styles.freeTierSub, { marginTop: 6, fontWeight: '600' }]}>
                    Your historical scan records ({scansUsed} completed free {scansUsed === 1 ? 'scan' : 'scans'}) are safely preserved.
                  </Text>
                )}
              </View>
            ) : isAmbiguousConfig ? (
              <View style={styles.quotaBarSection}>
                <Text style={styles.freeTierSub}>
                  {sub?.freePlanError ||
                    'Free AI skin scanning is temporarily unavailable due to a plan configuration issue.'}
                </Text>
              </View>
            ) : !usageVerified && !isUnlimitedScans ? (
              <View style={styles.quotaBarSection}>
                <Text style={styles.freeTierSub}>
                  Unable to verify your scan allowance. Please check your internet connection and try again.
                </Text>
              </View>
            ) : isUnlimitedScans ? (
              <View style={styles.quotaBarSection}>
                <Text style={styles.freeTierSub}>
                  Your {sub?.planName || 'Pro'} plan has no limit on AI skin scans.
                </Text>
              </View>
            ) : (
              <View style={styles.quotaBarSection}>
                <View style={styles.quotaLabels}>
                  <Text style={styles.quotaCountTxt}>
                    {scansUsed} of {freeQuota} Scans Used
                  </Text>
                  <Text style={styles.quotaRemainingTxt}>
                    {Math.max(0, freeQuota - scansUsed)} remaining
                  </Text>
                </View>
                <View style={styles.quotaTrack}>
                  <View
                    style={[
                      styles.quotaFill,
                      {
                        width: `${
                          freeQuota > 0
                            ? Math.min(100, (Math.min(scansUsed, freeQuota) / freeQuota) * 100)
                            : 0
                        }%`,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.freeTierSub, { marginTop: 8 }]}>
                  {isPremium
                    ? `You have used ${scansUsed} of ${freeQuota} AI skin ${freeQuota === 1 ? 'scan' : 'scans'} in your current ${sub?.planName || 'plan'} billing cycle.`
                    : Math.max(0, freeQuota - scansUsed) === 0
                    ? 'You have used all your available free AI skin scans. Please subscribe to continue scanning.'
                    : `You have used ${scansUsed} of ${freeQuota} one-time free AI skin ${freeQuota === 1 ? 'scan' : 'scans'}.`}
                </Text>
              </View>
            )}
          </View>

          {/* ── Billing Cycle Selector (if Free/Basic or Upgrading, and both cycles exist) ── */}
          {!isPremium && yearlyPlan && (
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
                  {monthlyPlan && (
                    <Text style={[styles.cyclePriceTxt, billingCycle === 'monthly' && styles.cyclePriceTxtActive]}>
                      {formatMoney(monthlyPlan.totalPrice)}/mo
                    </Text>
                  )}
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
                  </View>
                  <Text style={[styles.cyclePriceTxt, billingCycle === 'yearly' && styles.cyclePriceTxtActive]}>
                    {formatMoney(yearlyPlan.totalPrice)}/yr
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ── Subscription Plan Summary Card ── */}
          {!isPremium && selectedPlan && (
            <View style={styles.planSummaryCard}>
              <View style={styles.planSummaryHeader}>
                <Text style={styles.planSummaryTitle}>
                  {selectedPlan.name}
                </Text>
              </View>

              <View style={styles.planSummaryDivider} />

              <View style={styles.planSummaryRow}>
                <Text style={styles.planSummaryLabel}>Billing Plan</Text>
                <Text style={styles.planSummaryValue}>
                  {billingCycle === 'monthly' ? 'Monthly' : 'Yearly'}
                </Text>
              </View>

              <View style={styles.planSummaryRow}>
                <Text style={styles.planSummaryLabel}>Price</Text>
                <Text style={styles.planSummaryValue}>
                  ₱{totalPrice.toLocaleString('en-PH', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </Text>
              </View>

              <View style={styles.planSummaryDivider} />

              <View style={styles.planSummaryTotalRow}>
                <Text style={styles.planSummaryTotalLabel}>Total Due Today</Text>
                <Text style={styles.planSummaryTotalValue}>
                  ₱{totalPrice.toLocaleString('en-PH', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </Text>
              </View>

              <TouchableOpacity
                style={[
                  styles.upgradeBtn,
                  loading && styles.upgradeBtnDisabled,
                  Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                ]}
                onPress={handleUpgrade}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={styles.upgradeBtnTxt}>
                      Upgrade to Pro ({priceLabel})
                    </Text>
                  </View>
                )}
              </TouchableOpacity>

              <View style={styles.securityRow}>
                <Text style={styles.securityTxt}>
                  Cancel anytime directly from your billing settings.
                </Text>
              </View>
            </View>
          )}

          {/* ── Premium Features Checklist ── */}
          <View style={styles.featuresSection}>
            <Text style={styles.featuresTitle}>
              What&apos;s Included in {isPremium ? sub?.planName || 'Your Plan' : selectedPlan?.name || 'DermAI Pro'}
            </Text>
            <View style={styles.featuresCard}>
              {dynamicFeatures.map((item, idx) => (
                <View
                  key={`${item.title}-${idx}`}
                  style={[
                    styles.featureRow,
                    idx === dynamicFeatures.length - 1 && { borderBottomWidth: 0 },
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
      )}

      {/* PayMongo E-Wallet Payment Modal */}
      <PaymentModal
        visible={showPayment}
        billingCycle={billingCycle}
        selectedPlan={selectedPlan}
        basePrice={basePrice}
        vatAmount={vatAmount}
        totalPrice={totalPrice}
        user={user}
        onCompleted={async (receiptParams) => {
          await loadData();
          setShowPayment(false);
          if (receiptParams) {
            router.push({
              pathname: '/payment-success',
              params: receiptParams,
            });
          }
        }}
        onClose={() => setShowPayment(false)}
      />
    </SafeAreaView>
  );
}

function PaymentModal({
  visible,
  billingCycle,
  selectedPlan,
  basePrice,
  vatAmount,
  totalPrice,
  user,
  onCompleted,
  onClose,
}: {
  visible: boolean;
  billingCycle: 'monthly' | 'yearly';
  selectedPlan: SubscriptionPlanOption | null;
  basePrice: number;
  vatAmount: number;
  totalPrice: number;
  user: PatientAccount | null;
  onCompleted: (receiptParams?: Record<string, string>) => void;
  onClose: () => void;
}) {
  const [paymentMethod, setPaymentMethod] = useState<'gcash' | 'maya'>('gcash');
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [address, setAddress] = useState(user?.address || user?.location || '');
  const [mobileNumber, setMobileNumber] = useState(user?.phone ?? '');
  const [processing, setProcessing] = useState(false);
  const [showAgreementModal, setShowAgreementModal] = useState(false);
  const [agreementAccepted, setAgreementAccepted] = useState(false);

  // Sync live user profile & billing details from Supabase (matching Web SubscriptionUpgradePage.tsx)
  useEffect(() => {
    if (!visible || !user) return;
    setProcessing(false);
    setShowAgreementModal(false);
    setAgreementAccepted(false);
    setFullName(user.fullName || '');
    setEmail(user.email || '');
    setAddress(user.address || user.location || '');
    setMobileNumber((user.phone || '').replace(/\D/g, '').slice(0, 11));

    let mounted = true;
    (async () => {
      try {
        const [{ data: profileRow }, { data: subRow }] = await Promise.all([
          supabase
            .from('user')
            .select('full_name, email, phone, address, city')
            .eq('user_id', user.id)
            .maybeSingle(),
          supabase
            .from('user_plan_subscription')
            .select('billing_address')
            .eq('user_id', user.id)
            .maybeSingle(),
        ]);

        if (!mounted) return;
        if (profileRow?.full_name) setFullName(profileRow.full_name);
        if (profileRow?.email) setEmail(profileRow.email);
        if (profileRow?.phone) {
          setMobileNumber(String(profileRow.phone).replace(/\D/g, '').slice(0, 11));
        }
        const resolvedAddress =
          subRow?.billing_address ||
          [profileRow?.address, profileRow?.city].filter(Boolean).join(', ') ||
          user.address ||
          user.location ||
          'Cebu City';
        setAddress(resolvedAddress);
      } catch {
        // Ignore autofill errors
      }
    })();

    return () => {
      mounted = false;
    };
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
        `Please enter a valid 11-digit Philippine mobile number starting with 09 for your ${
          paymentMethod === 'gcash' ? 'GCash' : 'Maya'
        } account.`
      );
      return;
    }

    // Intercept payment redirect: present the Subscription Agreement Modal first
    setAgreementAccepted(false);
    setShowAgreementModal(true);
  }

  async function proceedWithPayment() {
    if (!user) return;
    const cleanedMobile = mobileNumber.replace(/\D/g, '');
    setProcessing(true);
    try {
      // Launch PayMongo Checkout via the shared `paymongo-payment` Edge Function
      const result = await processPayMongoSubscriptionPayment({
        userId: user.id,
        billingCycle,
        paymentMethod,
        fullName: fullName.trim(),
        email: email.trim(),
        address: address.trim() || 'Cebu City',
        mobileNumber: cleanedMobile,
        planId: selectedPlan?.id,
      });

      // On Web, `window.location.href` redirects the browser to PayMongo and then back to `/payment-success`
      if (result.redirectedInBrowser) {
        return;
      }

      const now = new Date();
      const end = new Date(now);
      if (billingCycle === 'monthly') end.setMonth(end.getMonth() + 1);
      else end.setFullYear(end.getFullYear() + 1);

      const newSub: SubscriptionRecord = {
        userId: user.id,
        email: email.trim() || user.email,
        plan: 'premium',
        planId: result.planId,
        planName: result.planName || selectedPlan?.name || 'Pro Plan',
        statusLabel: 'Premium Active',
        billingCycle,
        startDate: now.toISOString(),
        endDate: end.toISOString(),
        transactionId: result.paymongoPaymentId,
        scansUsed: 0,
        scanLimit: typeof selectedPlan?.scanLimit === 'number' ? selectedPlan.scanLimit : -1,
        basePrice: result.basePrice,
        vatAmount: result.vatAmount,
        totalPrice: result.amount,
        paymentMethod: paymentMethod === 'maya' ? 'Maya' : 'GCash',
        mobileNumber: cleanedMobile,
        billingAddress: address.trim() || 'Cebu City',
      };

      // Log audit event for subscription payment
      logAuditEvent({
        user_id: user.id,
        user_type: 'patient',
        performer_name: fullName.trim() || user.fullName || 'Patient',
        action: 'Payment Completed',
        log_type: 'subscription',
        target: `Subscription Payment (${paymentMethod.toUpperCase()})`,
        details: `Subscribed to ${newSub.planName} (${billingCycle}) for ₱${result.amount.toLocaleString(
          'en-PH',
          { minimumFractionDigits: 2, maximumFractionDigits: 2 }
        )} via ${paymentMethod.toUpperCase()} (Ref: ${result.paymongoPaymentId})`,
        metadata: {
          billing_cycle: billingCycle,
          plan: newSub.planName,
          payment_method: paymentMethod,
          payment_reference: result.paymongoPaymentId,
          amount: result.amount,
          platform: 'Mobile App',
        },
      }).catch(() => {});

      // Client write is best-effort (RLS may block flipping an expired row to active).
      try {
        await setUserSubscription(user.id, newSub);
      } catch (subWriteErr) {
        console.warn('[Subscription] client-side activation notice:', subWriteErr);
      }

      // Authoritative re-fetch for the signed-in patient (auth.uid()). If the plan is not Pro/active
      // yet (GCash and Maya alike), re-run server-side fulfillment and re-check.
      const isProActive = (s: SubscriptionRecord | null) =>
        !!s &&
        s.status === 'active' &&
        (s.scanLimit === -1 || s.plan === 'premium' || s.plan === 'pro' || s.plan === 'basic');
      let confirmedSub = await getUserSubscription(user.id);
      for (let syncTry = 0; syncTry < 3 && !isProActive(confirmedSub); syncTry++) {
        await verifyPayMongoIntentOnce(result.paymentIntentId, result.clientKey);
        confirmedSub = await getUserSubscription(user.id);
        if (!isProActive(confirmedSub)) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
      // In-app subscription notification disabled: receipts are handled strictly via email.
      await pushAdminNotification({
        type: 'new-subscription',
        title: 'New Premium Subscription',
        message: `${fullName.trim()} (${email.trim()}) subscribed to ${
          newSub.planName
        } (${billingCycle}) via ${
          paymentMethod === 'gcash' ? 'GCash' : 'Maya'
        } — ₱${result.amount.toLocaleString('en-PH', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} (Ref: ${result.paymongoPaymentId})`,
      });

      // Navigate directly to the Mobile Receipt View screen (`/payment-success`)
      onCompleted({
        flow: 'subscription',
        status: 'success',
        payment_intent: result.paymentIntentId,
        client_key: result.clientKey,
        payment_id: result.paymongoPaymentId,
        amount: String(result.amount),
        base_price: String(result.basePrice),
        vat_amount: String(result.vatAmount),
        cycle: billingCycle,
        method: paymentMethod,
        plan_name: result.planName || selectedPlan?.name || 'Pro Plan',
        email: email.trim(),
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
              onPress={onClose}
              style={payStyles.backBtn}
              disabled={processing}
            >
              <Ionicons name="chevron-back" size={18} color={COLORS.text} />
              <Text style={payStyles.backBtnTxt}>Cancel</Text>
            </TouchableOpacity>
            <Text style={payStyles.title}>E-Wallet Checkout</Text>
            <View style={{ width: 50 }} />
          </View>

          <ScrollView contentContainerStyle={payStyles.content} keyboardShouldPersistTaps="handled">
            {/* Order Summary Card matching the exact clean design */}
            <View style={payStyles.summaryCard}>
              <View style={payStyles.planHeader}>
                <Text style={payStyles.planName}>
                  {selectedPlan?.name || 'Pro'}
                </Text>
              </View>

              <View style={payStyles.divider} />

              <View style={payStyles.summaryRow}>
                <Text style={payStyles.summaryLabel}>Billing Plan</Text>
                <Text style={payStyles.summaryValue}>
                  {billingCycle === 'monthly' ? 'Monthly' : 'Yearly'}
                </Text>
              </View>
              <View style={payStyles.summaryRow}>
                <Text style={payStyles.summaryLabel}>Price</Text>
                <Text style={payStyles.summaryValue}>
                  ₱{totalPrice.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Text>
              </View>

              <View style={payStyles.divider} />

              <View style={payStyles.totalRow}>
                <Text style={payStyles.totalLabel}>Total Due Today</Text>
                <Text style={payStyles.totalValue}>
                  ₱{totalPrice.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Text>
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
                  {paymentMethod === 'gcash'}
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
                  {paymentMethod === 'maya'}
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
                <Text style={payStyles.fieldLabel}>Email Address (for Official Receipt) *</Text>
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
                style={[
                  payStyles.payBtn,
                  processing && { opacity: 0.7 },
                  Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                ]}
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
                    <Text style={payStyles.payBtnTxt}>
                      Pay & Activate (₱{totalPrice.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) 
                    </Text>
                  </View>
                )}
              </TouchableOpacity>

              <Text style={payStyles.disclaimerTxt}>
                You will be directed to the PayMongo Checkout page to authorize your {paymentMethod === 'gcash' ? 'GCash' : 'Maya'} payment. An official receipt will be emailed immediately upon completion.
              </Text>
            </View>
          </ScrollView>

          {/* ── Subscription Agreement Modal Overlay (Web Parity) ── */}
          {showAgreementModal && (
            <View style={agreementStyles.backdrop}>
              <View style={agreementStyles.modalBox}>
                {/* Header */}
                <View style={agreementStyles.headerRow}>
                  <View style={agreementStyles.headerLeft}>
                    <View style={agreementStyles.iconWrap}>
                      <Ionicons name="shield-checkmark" size={20} color={COLORS.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={agreementStyles.modalTitle}>Subscription Agreement</Text>
                      <Text style={agreementStyles.modalSubtitle}>
                        Please review terms and medical disclaimer before payment
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setShowAgreementModal(false);
                      setAgreementAccepted(false);
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={agreementStyles.closeBtn}
                  >
                    <Ionicons name="close" size={20} color="#64748b" />
                  </TouchableOpacity>
                </View>

                {/* Scrollable Terms Content */}
                <ScrollView
                  style={agreementStyles.termsScroll}
                  contentContainerStyle={agreementStyles.termsScrollContent}
                  showsVerticalScrollIndicator={true}
                >
                  {/* Medical Disclaimer Box */}
                  <View style={agreementStyles.disclaimerBox}>
                    <Ionicons name="warning" size={18} color="#d97706" style={{ marginTop: 2 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={agreementStyles.disclaimerTitle}>Medical Disclaimer</Text>
                      <Text style={agreementStyles.disclaimerTxt}>
                        DermAI provides AI-powered dermatological analysis and triage support for educational and informational purposes only. It does not provide medical diagnoses or replace an in-person clinical consultation with a licensed physician.
                      </Text>
                    </View>
                  </View>

                  {/* Terms Sections */}
                  <View style={agreementStyles.termCard}>
                    <View style={agreementStyles.termCardTitleRow}>
                      <Ionicons name="document-text-outline" size={15} color={COLORS.primary} />
                      <Text style={agreementStyles.termCardTitle}>1. Plan Scope & Services</Text>
                    </View>
                    <Text style={agreementStyles.termCardBody}>
                      Your DermAI Pro subscription unlocks enhanced skin scan analyses, full historical condition tracking, and priority appointment booking at participating partner dermatological clinics.
                    </Text>
                  </View>

                  <View style={agreementStyles.termCard}>
                    <Text style={agreementStyles.termCardTitle}>2. Pricing & 12% Value Added Tax (VAT)</Text>
                    <Text style={agreementStyles.termCardBody}>
                      In compliance with Philippine Bureau of Internal Revenue (BIR) regulations, all billed charges include a 12% Value Added Tax (VAT). Your billing breakdown will explicitly reflect the net subscription fee and applicable VAT.
                    </Text>
                  </View>

                  <View style={agreementStyles.termCard}>
                    <Text style={agreementStyles.termCardTitle}>3. Billing Cycles & Renewal</Text>
                    <Text style={agreementStyles.termCardBody}>
                      Subscriptions are billed in advance according to your chosen cycle (Monthly or Yearly). You may cancel renewal at any time through your Billing Settings; your active Pro access will remain in effect until the end of the paid billing period.
                    </Text>
                  </View>

                  <View style={agreementStyles.termCard}>
                    <Text style={agreementStyles.termCardTitle}>4. Data Privacy & Confidentiality</Text>
                    <Text style={agreementStyles.termCardBody}>
                      Your skin scans, consultation notes, and health records are encrypted and protected pursuant to the Philippine Data Privacy Act of 2012 (RA 10173). Your records are never sold or shared without your explicit authorization.
                    </Text>
                  </View>
                </ScrollView>

                {/* Footer with Checkbox & Actions */}
                <View style={agreementStyles.footer}>
                  <TouchableOpacity
                    style={agreementStyles.checkboxRow}
                    activeOpacity={0.8}
                    onPress={() => setAgreementAccepted(!agreementAccepted)}
                  >
                    <View
                      style={[
                        agreementStyles.checkbox,
                        agreementAccepted && agreementStyles.checkboxChecked,
                      ]}
                    >
                      {agreementAccepted && <Ionicons name="checkmark" size={13} color="#ffffff" />}
                    </View>
                    <Text style={agreementStyles.checkboxLabel}>
                      I have read, understood, and accept the{' '}
                      <Text style={{ fontWeight: '700', color: '#0f172a' }}>
                        DermAI Subscription Agreement
                      </Text>{' '}
                      and acknowledge the medical disclaimer.
                    </Text>
                  </TouchableOpacity>

                  <View style={agreementStyles.btnRow}>
                    <TouchableOpacity
                      style={agreementStyles.cancelBtn}
                      onPress={() => {
                        setShowAgreementModal(false);
                        setAgreementAccepted(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={agreementStyles.cancelBtnTxt}>Cancel</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        agreementStyles.agreeBtn,
                        !agreementAccepted && agreementStyles.agreeBtnDisabled,
                      ]}
                      disabled={!agreementAccepted}
                      onPress={() => {
                        setShowAgreementModal(false);
                        proceedWithPayment();
                      }}
                      activeOpacity={0.85}
                    >
                      <Text
                        style={[
                          agreementStyles.agreeBtnTxt,
                          !agreementAccepted && agreementStyles.agreeBtnTxtDisabled,
                        ]}
                      >
                        Agree & Proceed to Payment
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>
          )}
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
  headerStatusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  headerStatusPremium: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  headerStatusCancelling: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  headerStatusBasic: {
    backgroundColor: '#f0f9ff',
    borderColor: '#bae6fd',
  },
  headerStatusNone: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  headerStatusTxt: {
    fontSize: 11,
    fontWeight: '800',
  },

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
    marginTop: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  cardEndingTxt: { fontSize: 11, color: 'rgba(255, 255, 255, 0.9)', flex: 1 },
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

  // Subscription Plan Summary Card (Matching screenshot design)
  planSummaryCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  planSummaryHeader: {
    marginBottom: 8,
  },
  planSummaryTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.4,
  },
  planSummaryDesc: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 6,
    lineHeight: 19,
  },
  planSummaryDivider: {
    height: 1,
    backgroundColor: '#f1f5f9',
    marginVertical: 18,
  },
  planSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
  },
  planSummaryLabel: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
  },
  planSummaryValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  planSummaryTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 2,
    marginBottom: 16,
  },
  planSummaryTotalLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  planSummaryTotalValue: {
    fontSize: 24,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: -0.5,
  },
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
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  planHeader: {
    marginBottom: 4,
  },
  planName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  planSubName: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 6,
    lineHeight: 18,
  },
  divider: {
    height: 1,
    backgroundColor: '#f1f5f9',
    marginVertical: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 4,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  totalValue: {
    fontSize: 24,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: -0.5,
  },

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
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    minHeight: 52,
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
    width: 68,
    height: 26,
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
});

const agreementStyles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    zIndex: 9999,
  },
  modalBox: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    width: '100%',
    maxWidth: 500,
    maxHeight: '88%',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
    flexDirection: 'column',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    backgroundColor: '#fdf4f7',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    paddingRight: 10,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#fce7f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  modalSubtitle: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
    lineHeight: 15,
  },
  closeBtn: {
    padding: 4,
    borderRadius: 8,
  },
  termsScroll: {
    flexGrow: 1,
    flexShrink: 1,
  },
  termsScrollContent: {
    padding: 20,
    gap: 12,
  },
  disclaimerBox: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  disclaimerTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400e',
    marginBottom: 2,
  },
  disclaimerTxt: {
    fontSize: 11,
    color: '#92400e',
    lineHeight: 16,
  },
  termCard: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    backgroundColor: '#f8fafc',
  },
  termCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  termCardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  termCardBody: {
    fontSize: 11,
    color: '#475569',
    lineHeight: 16,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    padding: 18,
    backgroundColor: '#fafbfc',
    gap: 14,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  checkboxLabel: {
    fontSize: 11,
    color: '#475569',
    lineHeight: 16,
    flex: 1,
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
  },
  cancelBtnTxt: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  agreeBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  agreeBtnDisabled: {
    backgroundColor: '#e2e8f0',
    shadowOpacity: 0,
    elevation: 0,
  },
  agreeBtnTxt: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  agreeBtnTxtDisabled: {
    color: '#94a3b8',
  },
});
