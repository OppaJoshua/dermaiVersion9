import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  ActivityIndicator,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import { logAuditEvent } from '@/lib/auditLogger';
import {
  getCurrentUser,
  getUserSubscription,
  getBillingHistory,
  cancelSubscriptionAtPeriodEnd,
  resumeSubscription,
} from '@/lib/store';
import type {
  PatientAccount,
  SubscriptionRecord,
  BillingHistoryItem,
} from '@/lib/store';

const GCASH_LOGO = require('@/assets/images/gcash.png');
const MAYA_LOGO = require('@/assets/images/maya.png');

interface AppointmentReceiptDetails {
  transactionReference: string;
  patientName: string;
  paymentMethod: string;
  mobileNumber?: string;
  clinicName: string;
  doctorName: string;
  confirmedSchedule: string;
  conditionName?: string;
  amountPaid: string;
  appointmentId?: string;
}

export default function BillingScreen() {
  const [user, setUser] = useState<PatientAccount | null>(null);
  const [sub, setSub] = useState<SubscriptionRecord | null>(null);
  const [billingHistory, setBillingHistory] = useState<BillingHistoryItem[]>([]);
  const [selectedSubscriptionReceipt, setSelectedSubscriptionReceipt] =
    useState<BillingHistoryItem | null>(null);
  const [selectedAppointmentReceipt, setSelectedAppointmentReceipt] =
    useState<AppointmentReceiptDetails | null>(null);
  const [loadingPaymentId, setLoadingPaymentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const u = await getCurrentUser();
      setUser(u);
      if (!u) {
        setSub(null);
        setBillingHistory([]);
        return;
      }

      const [s, history] = await Promise.all([
        getUserSubscription(u.id),
        getBillingHistory(u.id),
      ]);

      setSub(s);
      setBillingHistory(history);
    } catch (err) {
      console.warn('[BillingScreen] loadData error:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Re-fetch whenever the user navigates to or focuses this screen
  useFocusEffect(
    useCallback(() => {
      loadData(false);
    }, [loadData])
  );

  // Real-time synchronization with Web Portal changes on Supabase
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`mobile-billing-sync-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_plan_subscription',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          loadData(true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_payment',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          loadData(true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ai_scan_result',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          loadData(true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'plan',
        },
        () => {
          loadData(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, loadData]);

  const statusBadge = sub?.statusLabel || 'No Active Subscription';
  const isPro =
    Boolean(
      statusBadge === 'Premium Active' ||
        statusBadge === 'Basic Active' ||
        sub?.plan === 'premium' ||
        sub?.plan === 'pro' ||
        sub?.plan === 'basic'
    ) && !sub?.isExpired;
  const isExpired = Boolean(sub?.isExpired);

  // Plan Display Name matching Web BillingSettingsPage.tsx
  const displayPlanName = isPro ? sub?.planName || 'Pro' : 'Free Plan';

  // Price Display matching Web BillingSettingsPage.tsx (VAT-inclusive)
  const formattedPrice = (() => {
    if (!isPro || !sub?.totalPrice || sub.totalPrice <= 0) {
      return '₱0.00';
    }
    return `₱${sub.totalPrice.toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} / ${sub.billingCycle === 'yearly' ? 'year' : 'month'}`;
  })();

  const formattedRenewalDate = (() => {
    if (!sub?.endDate) return null;
    try {
      const d = new Date(sub.endDate);
      return isNaN(d.getTime())
        ? null
        : d.toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          });
    } catch {
      return null;
    }
  })();

  // Scan limit for the Current Plan card
  const maxScans =
    sub?.scanLimit === -1
      ? -1
      : typeof sub?.scanLimit === 'number' && sub.scanLimit >= 0
      ? sub.scanLimit
      : 0;

  async function handleCancel() {
    if (!isPro) return;

    setActionLoading(true);
    try {
      // Dynamically resolve authenticated patient ID from Supabase Auth
      const { data: authData } = await supabase.auth.getUser();
      const currentUserId = authData?.user?.id || user?.id;
      if (!currentUserId) {
        console.warn('[handleCancel] No authenticated user session found.');
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
      await loadData(true);

      logAuditEvent({
        user_id: currentUserId,
        user_type: 'patient',
        performer_name: user?.fullName || authData?.user?.email?.split('@')[0] || 'Patient',
        action: 'Subscription Cancelled',
        log_type: 'subscription',
        target: activeSub?.planName || 'Subscription Plan',
        details: `Patient cancelled renewal for "${activeSub?.planName || 'Subscription Plan'}" plan on mobile app.`,
        metadata: {
          subscriptionId: activeSubId || null,
          planName: activeSub?.planName || null,
          platform: 'Mobile App',
        },
      }).catch(() => {});
    } catch (err: any) {
      console.error('[handleCancel] Error cancelling subscription:', err);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleResume() {
    setActionLoading(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const currentUserId = authData?.user?.id || user?.id;
      if (!currentUserId) {
        console.warn('[handleResume] No authenticated user session found.');
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

      await loadData(true);

      logAuditEvent({
        user_id: currentUserId,
        user_type: 'patient',
        performer_name: user?.fullName || authData?.user?.email?.split('@')[0] || 'Patient',
        action: 'Subscription Resumed',
        log_type: 'subscription',
        target: activeSub?.planName || 'Subscription Plan',
        details: `Patient resumed renewal for "${activeSub?.planName || 'Subscription Plan'}" plan on mobile app.`,
        metadata: {
          subscriptionId: activeSubId || null,
          planName: activeSub?.planName || null,
          platform: 'Mobile App',
        },
      }).catch(() => {});
    } catch (err: any) {
      console.error('[handleResume] Error resuming subscription:', err);
    } finally {
      setActionLoading(false);
    }
  }

  // Matches Web BillingSettingsPage.tsx `handleViewReceipt`
  async function handleViewReceipt(row: BillingHistoryItem) {
    if (row.isAppointment) {
      setLoadingPaymentId(row.paymentId);
      try {
        let apptData: any = null;
        const targetApptId =
          row.appointmentId ||
          (row.paymentId && row.paymentId.length === 36 ? row.paymentId : null);

        if (targetApptId) {
          const { data } = await supabase
            .from('patient_appointment')
            .select(`
              appointment_id,
              patient_name,
              patient_contact,
              patient_email,
              date,
              time,
              batch_time,
              ai_condition_name,
              clinic_id,
              assigned_doctor_id,
              clinic:clinic_id ( name )
            `)
            .eq('appointment_id', targetApptId)
            .maybeSingle();
          apptData = data;
        }

        if (!apptData && user) {
          const { data } = await supabase
            .from('patient_appointment')
            .select(`
              appointment_id,
              patient_name,
              patient_contact,
              patient_email,
              date,
              time,
              batch_time,
              ai_condition_name,
              clinic_id,
              assigned_doctor_id,
              clinic:clinic_id ( name )
            `)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          apptData = data;
        }

        let doctorName = 'Assigned by Clinic upon Review';
        if (apptData?.assigned_doctor_id) {
          try {
            const { data: docData } = await supabase
              .from('clinic_doctor')
              .select('doctor_name')
              .eq('doctor_id', apptData.assigned_doctor_id)
              .maybeSingle();
            if (docData?.doctor_name) {
              doctorName = `Dr. ${String(docData.doctor_name).replace(/^dr\.\s*/i, '')}`;
            }
          } catch {}
        }

        const clinicObj: any = Array.isArray(apptData?.clinic)
          ? apptData.clinic[0]
          : apptData?.clinic;
        let clinicName = clinicObj?.name;
        if (!clinicName && apptData?.clinic_id) {
          try {
            const { data: cData } = await supabase
              .from('clinic')
              .select('name')
              .eq('clinic_id', apptData.clinic_id)
              .maybeSingle();
            clinicName = cData?.name;
          } catch {}
        }
        if (!clinicName) clinicName = 'Dermatology Clinic';

        const patientName =
          apptData?.patient_name || user?.fullName || 'Patient';
        const mobileNumber =
          apptData?.patient_contact || user?.phone || '';

        let confirmedSchedule = 'Schedule Confirmed';
        if (apptData?.date) {
          const parsedDate = new Date(apptData.date);
          if (!isNaN(parsedDate.getTime())) {
            const dStr = parsedDate.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            });
            const timeRaw =
              apptData.batch_time ||
              (apptData.time ? String(apptData.time).slice(0, 5) : '');
            let tStr = timeRaw;
            if (timeRaw && timeRaw.includes(':')) {
              const [h, m] = timeRaw.split(':');
              const hourNum = parseInt(h, 10);
              if (!isNaN(hourNum)) {
                const ampm = hourNum >= 12 ? 'PM' : 'AM';
                const hour12 = hourNum % 12 || 12;
                tStr = `${hour12}:${m} ${ampm}`;
              }
            }
            confirmedSchedule = tStr ? `${dStr} at ${tStr}` : dStr;
          }
        }

        const conditionName =
          apptData?.ai_condition_name || 'General Consultation';
        const txRef =
          row.paymongoPaymentId ||
          row.paymentReference ||
          (apptData?.appointment_id
            ? `pay_${String(apptData.appointment_id).replace(/-/g, '').slice(0, 16)}`
            : row.paymentId);

        setSelectedAppointmentReceipt({
          transactionReference: txRef,
          patientName,
          paymentMethod: row.method,
          mobileNumber,
          clinicName,
          doctorName,
          confirmedSchedule,
          conditionName,
          amountPaid: row.amount,
          appointmentId: apptData?.appointment_id,
        });
      } catch (err) {
        console.warn('[BillingScreen] Error loading appointment receipt:', err);
        setSelectedSubscriptionReceipt(row);
      } finally {
        setLoadingPaymentId(null);
      }
    } else {
      setSelectedSubscriptionReceipt(row);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Page Header matching Web BillingSettingsPage.tsx */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color={COLORS.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Billing</Text>
          <Text style={styles.headerSub}>Manage your subscription and payment details</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* ── 1. CURRENT PLAN SECTION (Mirrors Web BillingSettingsPage.tsx) ── */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>Current plan</Text>
            {!loading && (
              <View
                style={[
                  styles.statusBadge,
                  isPro
                    ? sub?.cancelAtPeriodEnd
                      ? styles.statusBadgeWarning
                      : styles.statusBadgeActive
                    : isExpired || sub?.freePlanActive === false
                    ? styles.statusBadgeExpired
                    : styles.statusBadgeFree,
                ]}
              >
                <Text
                  style={[
                    styles.statusBadgeTxt,
                    isPro
                      ? sub?.cancelAtPeriodEnd
                        ? styles.statusBadgeTxtWarning
                        : styles.statusBadgeTxtActive
                      : isExpired || sub?.freePlanActive === false
                      ? styles.statusBadgeTxtExpired
                      : styles.statusBadgeTxtFree,
                  ]}
                >
                  {isPro
                    ? sub?.cancelAtPeriodEnd
                      ? 'Cancelling'
                      : 'Active'
                    : isExpired
                    ? 'Expired'
                    : sub?.freePlanActive === false
                    ? 'Inactive'
                    : 'Free'}
                </Text>
              </View>
            )}
          </View>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.loadingTxt}>Loading billing details...</Text>
            </View>
          ) : (
            <>
              {/* 4 Plan Detail Cards (2x2 Grid) matching Web BillingSettingsPage.tsx */}
              <View style={styles.planDetailsGrid}>
                {/* Card 1: Plan */}
                <View style={styles.planDetailItem}>
                  <Text style={styles.planDetailLabel}>Plan</Text>
                  <Text style={styles.planDetailValue} numberOfLines={1}>
                    {displayPlanName}
                  </Text>
                </View>

                {/* Card 2: Price */}
                <View style={styles.planDetailItem}>
                  <Text style={styles.planDetailLabel}>Price</Text>
                  <Text style={styles.planDetailValue} numberOfLines={1}>
                    {formattedPrice}
                  </Text>
                </View>

                {/* Card 3: Billing cycle */}
                <View style={styles.planDetailItem}>
                  <Text style={styles.planDetailLabel}>Billing cycle</Text>
                  <Text style={styles.planDetailValue} numberOfLines={1}>
                    {isPro
                      ? sub?.billingCycle === 'yearly'
                        ? 'Yearly'
                        : 'Monthly'
                      : 'Free'}
                  </Text>
                </View>

                {/* Card 4: Next billing date / Pro access until / Scan limit (blush border) */}
                <View style={[styles.planDetailItem, styles.planDetailItemBlush]}>
                  <Text style={styles.planDetailLabel}>
                    {isPro
                      ? sub?.cancelAtPeriodEnd
                        ? 'Pro access until'
                        : 'Next billing date'
                      : 'Scan limit'}
                  </Text>
                  <Text style={styles.planDetailValue} numberOfLines={1}>
                    {isPro
                      ? formattedRenewalDate || 'N/A'
                      : sub?.freePlanActive === false
                      ? 'Unavailable (Inactive)'
                      : sub?.scansCountVerified === false
                      ? 'Verification required'
                      : maxScans === -1
                      ? 'Unlimited scans'
                      : `${maxScans} one-time ${maxScans === 1 ? 'scan' : 'scans'}`}
                  </Text>
                </View>
              </View>

              {/* Bottom Actions Area matching Web BillingSettingsPage.tsx */}
              {isPro ? (
                sub?.cancelAtPeriodEnd ? (
                  <View style={styles.planActionFooter}>
                    <Text style={styles.planActionNote}>
                      Your Pro access remains active until{' '}
                      <Text style={styles.planActionNoteStrong}>
                        {formattedRenewalDate || 'period end'}
                      </Text>
                      . You can resume your subscription before then without paying again.
                    </Text>
                    <TouchableOpacity
                      style={[
                        styles.maroonBtn,
                        Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                      ]}
                      onPress={handleResume}
                      disabled={actionLoading}
                      activeOpacity={0.85}
                    >
                      {actionLoading ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
                          <Text style={styles.maroonBtnTxt}>Resume subscription</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.planActionFooterRight}>
                    <TouchableOpacity
                      style={[
                        styles.cancelOutlineBtn,
                        Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                      ]}
                      onPress={handleCancel}
                      disabled={actionLoading}
                      activeOpacity={0.8}
                    >
                      {actionLoading ? (
                        <ActivityIndicator size="small" color="#dc2626" />
                      ) : (
                        <>
                          <Ionicons name="close-circle-outline" size={16} color="#dc2626" />
                          <Text style={styles.cancelOutlineBtnTxt}>Cancel subscription</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                )
              ) : (
                <View style={styles.planActionFooter}>
                  <Text
                    style={[
                      styles.planActionNote,
                      isExpired && { color: '#be123c', fontWeight: '600' },
                    ]}
                  >
                    {isExpired
                      ? 'Your Pro plan has expired. Upgrade or renew anytime to regain full Pro access and unlimited scans.'
                      : 'You are on the Free plan. Upgrade to Pro for unlimited AI scans and priority booking.'}
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.maroonBtn,
                      Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                    ]}
                    onPress={() => router.push('/(app)/subscription')}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.maroonBtnTxt}>
                      {isExpired ? 'Renew Subscription' : 'Upgrade to Pro'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </View>

        {/* ── 2. BILLING HISTORY & INVOICES LIST (Mirrors Web BillingSettingsPage.tsx) ── */}
        <View style={[styles.card, { paddingHorizontal: 0, paddingBottom: 8 }]}>
          <View style={[styles.cardHeaderRow, { paddingHorizontal: 20, marginBottom: 12 }]}>
            <Text style={styles.cardTitle}>Billing history</Text>
            <Text style={styles.historyCountTxt}>
              {billingHistory.length === 1
                ? '1 payment'
                : `${billingHistory.length} payments`}
            </Text>
          </View>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.loadingTxt}>Loading payment history...</Text>
            </View>
          ) : billingHistory.length === 0 ? (
            <Text style={styles.emptyHistoryTxt}>No billing history available.</Text>
          ) : (
            <View style={styles.historyListWrap}>
              {billingHistory.map((row, index) => {
                const rawMethod = String(row.method || '').toLowerCase();
                const isGcash = rawMethod.includes('gcash');
                const isMaya = rawMethod.includes('maya') || rawMethod.includes('paymaya');
                const methodLabel = isGcash
                  ? 'GCash'
                  : isMaya
                  ? 'Maya'
                  : row.method || 'Online Payment';
                const isRowLoading = loadingPaymentId === row.paymentId;
                const isPaidStatus = ['paid', 'success'].includes(
                  String(row.status || '').toLowerCase()
                );

                return (
                  <View
                    key={row.paymentId || `tx-${index}`}
                    style={[
                      styles.invoiceCardRow,
                      index > 0 && styles.invoiceCardRowBorder,
                    ]}
                  >
                    {/* Top Line: Description + Amount */}
                    <View style={styles.invoiceRowTop}>
                      <View style={{ flex: 1, paddingRight: 10 }}>
                        <Text style={styles.invoiceDesc} numberOfLines={1}>
                          {row.description}
                        </Text>
                        <Text style={styles.invoiceDate}>{row.date}</Text>
                      </View>
                      <Text style={styles.invoiceAmount}>{row.amount}</Text>
                    </View>

                    {/* Bottom Line: Method Badge + Transaction ID + Status Badge + View Action */}
                    <View style={styles.invoiceRowBottom}>
                      <View style={styles.invoiceBadgesLeft}>
                        <View
                          style={[
                            styles.methodBadge,
                            isGcash
                              ? styles.methodBadgeGcash
                              : isMaya
                              ? styles.methodBadgeMaya
                              : styles.methodBadgeDefault,
                          ]}
                        >
                          <Text
                            style={[
                              styles.methodBadgeTxt,
                              isGcash
                                ? styles.methodBadgeTxtGcash
                                : isMaya
                                ? styles.methodBadgeTxtMaya
                                : styles.methodBadgeTxtDefault,
                            ]}
                          >
                            {methodLabel}
                          </Text>
                        </View>

                        <Text
                          style={styles.invoiceTxId}
                          numberOfLines={1}
                          ellipsizeMode="middle"
                        >
                          {row.paymongoPaymentId || row.paymentReference || row.paymentId}
                        </Text>
                      </View>

                      <View style={styles.invoiceActionsRight}>
                        <View
                          style={[
                            styles.invoiceStatusPill,
                            !isPaidStatus && styles.invoiceStatusPillOther,
                          ]}
                        >
                          <Text
                            style={[
                              styles.invoiceStatusTxt,
                              !isPaidStatus && styles.invoiceStatusTxtOther,
                            ]}
                          >
                            {row.status}
                          </Text>
                        </View>

                        <TouchableOpacity
                          onPress={() => handleViewReceipt(row)}
                          disabled={isRowLoading}
                          style={[
                            styles.viewActionBtn,
                            Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                          ]}
                          activeOpacity={0.75}
                        >
                          {isRowLoading ? (
                            <ActivityIndicator size="small" color={COLORS.primary} />
                          ) : (
                            <Text style={styles.viewActionBtnTxt}>View</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      {/* ── MODAL A: SUBSCRIPTION PAYMENT RECEIPT MODAL (Mirrors Web BillingSettingsPage.tsx lines 880-1014) ── */}
      <Modal
        visible={Boolean(selectedSubscriptionReceipt)}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedSubscriptionReceipt(null)}
      >
        <SafeAreaView style={styles.receiptModalSafe}>
          <View style={styles.receiptBannerHeader}>
            <TouchableOpacity
              onPress={() => setSelectedSubscriptionReceipt(null)}
              style={styles.receiptBannerCloseBtn}
            >
              <Ionicons name="close" size={20} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.receiptBannerBrand}>DERMAI</Text>
            <Text style={styles.receiptBannerSubtitle}>
              DermAI - Official Payment Receipt
            </Text>
          </View>

          <View style={styles.receiptFloatingBadgeWrap}>
            <View style={styles.receiptFloatingBadgeInner}>
              <Ionicons name="checkmark-circle" size={38} color="#059669" />
            </View>
          </View>

          {selectedSubscriptionReceipt && (
            <ScrollView contentContainerStyle={styles.receiptModalContent}>
              <Text style={styles.receiptMainHeading}>Payment Details</Text>
              <Text style={styles.receiptMainSubheading}>
                Your DermAI subscription transaction record.
              </Text>

              <View style={styles.receiptTotalCard}>
                <Text style={styles.receiptTotalLabel}>TOTAL PAID</Text>
                <Text style={styles.receiptTotalAmount}>
                  {selectedSubscriptionReceipt.amount}
                </Text>
              </View>

              <Text style={styles.receiptSectionTitle}>PAYMENT DETAILS</Text>

              <View style={styles.receiptDlCard}>
                <View style={styles.receiptDlRow}>
                  <Text style={styles.receiptDt}>Account</Text>
                  <Text style={styles.receiptDd}>
                    {user?.email || 'Patient Account'}
                  </Text>
                </View>

                <View style={styles.receiptDlRow}>
                  <Text style={styles.receiptDt}>Description</Text>
                  <Text style={styles.receiptDd}>
                    {selectedSubscriptionReceipt.description || 'DermAI Subscription'}
                  </Text>
                </View>

                {selectedSubscriptionReceipt.baseAmount > 0 && (
                  <>
                    <View style={styles.receiptDlRow}>
                      <Text style={styles.receiptDt}>Subtotal (Net of VAT)</Text>
                      <Text style={styles.receiptDd}>
                        ₱{selectedSubscriptionReceipt.baseAmount.toLocaleString('en-PH', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </Text>
                    </View>
                    <View style={styles.receiptDlRow}>
                      <Text style={styles.receiptDt}>Value-Added Tax (12% VAT)</Text>
                      <Text style={styles.receiptDd}>
                        ₱{selectedSubscriptionReceipt.vatAmount.toLocaleString('en-PH', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </Text>
                    </View>
                  </>
                )}

                <View style={styles.receiptDlRow}>
                  <Text style={styles.receiptDt}>Payment Method</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="card-outline" size={15} color="#A21D5C" />
                    <Text style={styles.receiptDd}>
                      {String(selectedSubscriptionReceipt.method || '')
                        .toLowerCase()
                        .includes('gcash')
                        ? 'GCash'
                        : String(selectedSubscriptionReceipt.method || '')
                            .toLowerCase()
                            .includes('maya')
                        ? 'Maya'
                        : selectedSubscriptionReceipt.method || 'Online Payment'}
                    </Text>
                  </View>
                </View>

                <View style={styles.receiptDlRow}>
                  <Text style={styles.receiptDt}>Date</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="calendar-outline" size={15} color="#A21D5C" />
                    <Text style={styles.receiptDd}>
                      {selectedSubscriptionReceipt.paymentDate
                        ? new Date(
                            selectedSubscriptionReceipt.paymentDate
                          ).toLocaleString('en-PH', {
                            dateStyle: 'long',
                            timeStyle: 'short',
                          } as any)
                        : selectedSubscriptionReceipt.date}
                    </Text>
                  </View>
                </View>

                <View style={styles.receiptDlRow}>
                  <Text style={styles.receiptDt}>Transaction ID</Text>
                  <View style={styles.receiptTxCodeBox}>
                    <Text style={styles.receiptTxCodeTxt}>
                      {selectedSubscriptionReceipt.paymongoPaymentId ||
                        selectedSubscriptionReceipt.paymentReference ||
                        selectedSubscriptionReceipt.paymentId}
                    </Text>
                  </View>
                </View>

                <View style={[styles.receiptDlRow, { borderBottomWidth: 0 }]}>
                  <Text style={styles.receiptDt}>Status</Text>
                  <View style={styles.invoiceStatusPill}>
                    <Text style={styles.invoiceStatusTxt}>
                      {selectedSubscriptionReceipt.status}
                    </Text>
                  </View>
                </View>
              </View>

              <TouchableOpacity
                style={styles.closeReceiptFullBtn}
                onPress={() => setSelectedSubscriptionReceipt(null)}
                activeOpacity={0.85}
              >
                <Text style={styles.closeReceiptFullBtnTxt}>Close Receipt</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* ── MODAL B: APPOINTMENT & CONSULTATION RECEIPT MODAL (Mirrors Web BillingSettingsPage.tsx lines 1016-1163) ── */}
      <Modal
        visible={Boolean(selectedAppointmentReceipt)}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedAppointmentReceipt(null)}
      >
        <SafeAreaView style={styles.receiptModalSafe}>
          {selectedAppointmentReceipt && (
            <ScrollView contentContainerStyle={styles.apptReceiptContainer}>
              <TouchableOpacity
                onPress={() => setSelectedAppointmentReceipt(null)}
                style={styles.apptCloseIconBtn}
              >
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>

              <View style={styles.apptSuccessCircle}>
                <Ionicons name="checkmark-circle-outline" size={38} color="#059669" />
              </View>

              <Text style={styles.apptSuccessTitle}>Payment Successful!</Text>
              <Text style={styles.apptSuccessSub}>
                Your consultation payment has been received and your appointment request has been confirmed with{' '}
                <Text style={{ fontWeight: '800', color: '#0f172a' }}>
                  {selectedAppointmentReceipt.clinicName}
                </Text>
                .
              </Text>

              {selectedAppointmentReceipt.transactionReference ? (
                <View style={styles.apptRefPill}>
                  <Text style={styles.apptRefPillLabel}>TRANSACTION REFERENCE</Text>
                  <Text style={styles.apptRefPillValue}>
                    {selectedAppointmentReceipt.transactionReference}
                  </Text>
                </View>
              ) : null}

              <View style={styles.apptDetailsCard}>
                <Text style={styles.apptDetailsCardHeader}>
                  APPOINTMENT &amp; PAYMENT DETAILS
                </Text>

                <View style={styles.apptDetailRow}>
                  <Text style={styles.apptDetailLabel}>Patient Name</Text>
                  <Text style={styles.apptDetailValue}>
                    {selectedAppointmentReceipt.patientName}
                  </Text>
                </View>

                <View style={styles.apptDetailRow}>
                  <Text style={styles.apptDetailLabel}>Payment Method</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {String(selectedAppointmentReceipt.paymentMethod || '')
                      .toLowerCase()
                      .includes('maya') ? (
                      <Image
                        source={MAYA_LOGO}
                        style={{ width: 48, height: 20 }}
                        resizeMode="contain"
                      />
                    ) : String(selectedAppointmentReceipt.paymentMethod || '')
                        .toLowerCase()
                        .includes('gcash') ? (
                      <Image
                        source={GCASH_LOGO}
                        style={{ width: 52, height: 20 }}
                        resizeMode="contain"
                      />
                    ) : (
                      <Text style={styles.apptDetailValue}>
                        {selectedAppointmentReceipt.paymentMethod}
                      </Text>
                    )}
                  </View>
                </View>

                {selectedAppointmentReceipt.mobileNumber ? (
                  <View style={styles.apptDetailRow}>
                    <Text style={styles.apptDetailLabel}>Account Mobile Number</Text>
                    <Text style={[styles.apptDetailValue, styles.monoTxt]}>
                      {selectedAppointmentReceipt.mobileNumber}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.apptDetailRow}>
                  <Text style={styles.apptDetailLabel}>Clinic</Text>
                  <Text style={styles.apptDetailValue}>
                    {selectedAppointmentReceipt.clinicName}
                  </Text>
                </View>

                <View style={styles.apptDetailRow}>
                  <Text style={styles.apptDetailLabel}>Attending Dermatologist</Text>
                  <Text style={styles.apptDetailValue}>
                    {selectedAppointmentReceipt.doctorName}
                  </Text>
                </View>

                <View style={styles.apptDetailRow}>
                  <Text style={styles.apptDetailLabel}>Confirmed Schedule</Text>
                  <Text style={[styles.apptDetailValue, { color: COLORS.primary }]}>
                    {selectedAppointmentReceipt.confirmedSchedule}
                  </Text>
                </View>

                {selectedAppointmentReceipt.conditionName ? (
                  <View style={styles.apptDetailRow}>
                    <Text style={styles.apptDetailLabel}>Selected Condition</Text>
                    <Text style={[styles.apptDetailValue, { color: COLORS.primary }]}>
                      {selectedAppointmentReceipt.conditionName}
                    </Text>
                  </View>
                ) : null}

                <View style={[styles.apptDetailRow, styles.apptAmountDivider]}>
                  <Text style={[styles.apptDetailLabel, { fontWeight: '700', color: '#334155' }]}>
                    Amount Paid
                  </Text>
                  <Text style={styles.apptAmountPaidVal}>
                    {selectedAppointmentReceipt.amountPaid}
                  </Text>
                </View>

                <View style={styles.apptDetailRow}>
                  <Text style={styles.apptDetailLabel}>Payment Status</Text>
                  <View style={styles.invoiceStatusPill}>
                    <Text style={styles.invoiceStatusTxt}>Paid &amp; Confirmed</Text>
                  </View>
                </View>
              </View>

              <View style={styles.apptActionButtonsRow}>
                <TouchableOpacity
                  style={styles.apptPrimaryBtn}
                  onPress={() => {
                    setSelectedAppointmentReceipt(null);
                    router.push('/(app)/appointments');
                  }}
                  activeOpacity={0.85}
                >
                  <Ionicons name="calendar-outline" size={16} color="#fff" />
                  <Text style={styles.apptPrimaryBtnTxt}>VIEW APPOINTMENT</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.apptSecondaryBtn}
                  onPress={() => setSelectedAppointmentReceipt(null)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.apptSecondaryBtnTxt}>Close</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
    backgroundColor: '#ffffff',
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
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 44,
    gap: 16,
  },

  // Shared Card Container matching Web rounded-2xl border-gray-100 bg-white
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },

  // Status Badges matching Web BillingSettingsPage.tsx
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  statusBadgeActive: {
    backgroundColor: '#ecfdf5',
  },
  statusBadgeWarning: {
    backgroundColor: '#fffbeb',
  },
  statusBadgeExpired: {
    backgroundColor: '#fff1f2',
  },
  statusBadgeFree: {
    backgroundColor: '#f1f5f9',
  },
  statusBadgeTxt: {
    fontSize: 12,
    fontWeight: '700',
  },
  statusBadgeTxtActive: {
    color: '#059669',
  },
  statusBadgeTxtWarning: {
    color: '#b45309',
  },
  statusBadgeTxtExpired: {
    color: '#e11d48',
  },
  statusBadgeTxtFree: {
    color: '#475569',
  },

  loadingBox: {
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingTxt: {
    marginTop: 8,
    fontSize: 12,
    color: '#94a3b8',
  },

  // 4 Plan Detail Cards (2x2 Grid)
  planDetailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  planDetailItem: {
    width: '48%',
    flexGrow: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    backgroundColor: '#ffffff',
    padding: 14,
  },
  planDetailItemBlush: {
    borderColor: '#f8e1ea',
  },
  planDetailLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748b',
  },
  planDetailValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 4,
  },

  // Bottom Actions inside Current Plan
  planActionFooter: {
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    gap: 12,
  },
  planActionFooterRight: {
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    alignItems: 'flex-end',
  },
  planActionNote: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 19,
  },
  planActionNoteStrong: {
    fontWeight: '800',
    color: '#0f172a',
  },
  maroonBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#801336',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  maroonBtnTxt: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  cancelOutlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  cancelOutlineBtnTxt: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '700',
  },

  // 2. Billing History List
  historyCountTxt: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  emptyHistoryTxt: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    paddingVertical: 28,
  },
  historyListWrap: {
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  invoiceCardRow: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 10,
  },
  invoiceCardRowBorder: {
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  invoiceRowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  invoiceDesc: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  invoiceDate: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  invoiceAmount: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  invoiceRowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  invoiceBadgesLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  methodBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  methodBadgeGcash: {
    backgroundColor: '#eef4ff',
    borderColor: '#dbeafe',
  },
  methodBadgeMaya: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  methodBadgeDefault: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  methodBadgeTxt: {
    fontSize: 11,
    fontWeight: '700',
  },
  methodBadgeTxtGcash: {
    color: '#2563eb',
  },
  methodBadgeTxtMaya: {
    color: '#059669',
  },
  methodBadgeTxtDefault: {
    color: '#475569',
  },
  invoiceTxId: {
    fontSize: 11,
    color: '#94a3b8',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    flexShrink: 1,
  },
  invoiceActionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  invoiceStatusPill: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#d1fae5',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  invoiceStatusPillOther: {
    backgroundColor: '#fdf2f7',
    borderColor: '#f4c9dc',
  },
  invoiceStatusTxt: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  invoiceStatusTxtOther: {
    color: '#A21D5C',
  },
  viewActionBtn: {
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  viewActionBtnTxt: {
    fontSize: 13,
    fontWeight: '800',
    color: '#801336',
  },

  // Modal A: Subscription Payment Receipt Modal
  receiptModalSafe: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  receiptBannerHeader: {
    backgroundColor: '#A21D5C',
    paddingTop: 22,
    paddingBottom: 42,
    paddingHorizontal: 20,
    alignItems: 'center',
    position: 'relative',
  },
  receiptBannerCloseBtn: {
    position: 'absolute',
    right: 16,
    top: 16,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptBannerBrand: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2.5,
    color: 'rgba(252,231,243,0.9)',
  },
  receiptBannerSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(252,231,243,0.95)',
    marginTop: 4,
  },
  receiptFloatingBadgeWrap: {
    marginTop: -32,
    alignSelf: 'center',
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#ffffff',
    padding: 4,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  receiptFloatingBadgeInner: {
    flex: 1,
    borderRadius: 30,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptModalContent: {
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 40,
  },
  receiptMainHeading: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
  },
  receiptMainSubheading: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 4,
  },
  receiptTotalCard: {
    marginTop: 20,
    backgroundColor: '#FDF2F7',
    borderWidth: 1,
    borderColor: '#F4C9DC',
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  receiptTotalLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: '#64748b',
  },
  receiptTotalAmount: {
    fontSize: 30,
    fontWeight: '800',
    color: '#A21D5C',
    marginTop: 4,
  },
  receiptSectionTitle: {
    marginTop: 22,
    marginBottom: 8,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.8,
    color: '#64748b',
  },
  receiptDlCard: {
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  receiptDlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    gap: 12,
  },
  receiptDt: {
    fontSize: 13,
    color: '#64748b',
  },
  receiptDd: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
    textAlign: 'right',
    flexShrink: 1,
  },
  receiptTxCodeBox: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: '68%',
  },
  receiptTxCodeTxt: {
    fontSize: 11,
    color: '#334155',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  closeReceiptFullBtn: {
    marginTop: 24,
    backgroundColor: '#A21D5C',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  closeReceiptFullBtnTxt: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },

  // Modal B: Appointment & Consultation Receipt Modal
  apptReceiptContainer: {
    padding: 24,
    paddingBottom: 44,
    alignItems: 'center',
  },
  apptCloseIconBtn: {
    alignSelf: 'flex-end',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  apptSuccessCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  apptSuccessTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
  },
  apptSuccessSub: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 6,
    maxWidth: 320,
  },
  apptRefPill: {
    marginTop: 16,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center',
  },
  apptRefPillLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    color: '#64748b',
  },
  apptRefPillValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 2,
  },
  apptDetailsCard: {
    width: '100%',
    marginTop: 18,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#f1f5f9',
    borderRadius: 18,
    padding: 18,
    gap: 10,
  },
  apptDetailsCardHeader: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: '#94a3b8',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  apptDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  apptDetailLabel: {
    fontSize: 12,
    color: '#64748b',
  },
  apptDetailValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'right',
    flexShrink: 1,
  },
  apptAmountDivider: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  apptAmountPaidVal: {
    fontSize: 14,
    fontWeight: '800',
    color: '#047857',
  },
  apptActionButtonsRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
    marginTop: 22,
  },
  apptPrimaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 999,
    paddingVertical: 14,
  },
  apptPrimaryBtnTxt: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  apptSecondaryBtn: {
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  apptSecondaryBtnTxt: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  monoTxt: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
});
