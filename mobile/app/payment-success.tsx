import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { COLORS } from '@/lib/constants';
import { verifyPayMongoIntentOnce } from '@/lib/paymongo';
import {
  releaseAppointmentHoldSafely,
  getCurrentUser,
  getUserSubscription,
  setUserSubscription,
  splitVat,
  addAppNotification,
} from '@/lib/store';

try {
  WebBrowser.maybeCompleteAuthSession();
} catch {
  // Ignore if not running inside a browser popup
}

interface AppointmentReceiptDetails {
  kind: 'appointment';
  appointmentId: string;
  reference: string;
  amount: number;
  paymentMethod: string;
  clinicName: string;
  clinicAddress?: string;
  doctorName: string;
  date: string;
  time: string;
  patientName: string;
  queueNumber?: number;
}

interface SubscriptionReceiptDetails {
  kind: 'subscription';
  reference: string;
  totalAmount: number;
  basePrice: number;
  vatAmount: number;
  paymentMethod: string;
  planName: string;
  billingCycle: string;
  date: string;
  email: string;
  patientName: string;
}

type ReceiptData = AppointmentReceiptDetails | SubscriptionReceiptDetails;

function formatReceiptDate(input?: Date | string | number | null): string {
  const d = input ? new Date(input) : new Date();
  if (isNaN(d.getTime())) return new Date().toLocaleDateString('en-US');

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const month = monthNames[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();

  let hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;

  return `${month} ${day}, ${year} at ${hours}:${minutes} ${ampm}`;
}

export default function PaymentSuccessScreen() {
  const router = useRouter();
  const searchParams = useLocalSearchParams();

  const flowParam = ((searchParams.flow || '') as string).toLowerCase().trim();
  const appointmentId = ((searchParams.appointment_id || searchParams.booking_id || '') as string).trim();
  const urlPaymentIntentId = ((searchParams.payment_intent_id || searchParams.payment_intent || '') as string).trim();
  const urlClientKey = ((searchParams.client_key || searchParams.payment_intent_client_key || '') as string).trim();
  const urlPaymentId = ((searchParams.payment_id || '') as string).trim();
  const rawStatus = ((searchParams.status || 'success') as string).toLowerCase().trim();

  const isSubscriptionFlow = flowParam === 'subscription' || (!appointmentId && Boolean(urlPaymentIntentId || urlPaymentId));

  const [loading, setLoading] = useState(true);
  const [outcome, setOutcome] = useState<'success' | 'cancelled' | 'failed' | 'uncertain'>('success');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function handlePaymentReturn() {
      // Resolve payment_intent and client_key from URL or sessionStorage (matching Web PaymentSuccessPage.tsx)
      let paymentIntentId = urlPaymentIntentId;
      let clientKey = urlClientKey;

      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        try {
          if (!paymentIntentId) {
            paymentIntentId = window.sessionStorage.getItem('dermai_pending_payment_intent_id') || '';
          }
          if (!clientKey) {
            clientKey = window.sessionStorage.getItem('dermai_pending_payment_intent_client_key') || '';
          }
        } catch {
          // Ignore storage read errors
        }
      }

      if (rawStatus === 'cancel' || rawStatus === 'cancelled') {
        if (isMounted) {
          setOutcome('cancelled');
          setLoading(false);
        }
        if (appointmentId) {
          try {
            await releaseAppointmentHoldSafely(appointmentId, { confirmedCancelledOrFailed: true });
          } catch (err) {
            console.warn('[PaymentSuccess] Hold release notice:', err);
          }
        }
        return;
      }

      if (rawStatus === 'failed') {
        if (isMounted) {
          setOutcome('failed');
          setErrorMessage('Payment authorization failed on GCash / Maya. Please try again.');
          setLoading(false);
        }
        if (appointmentId) {
          try {
            await releaseAppointmentHoldSafely(appointmentId, { confirmedCancelledOrFailed: true });
          } catch (err) {
            console.warn('[PaymentSuccess] Hold release notice:', err);
          }
        }
        return;
      }

      // Step 1: Verify payment intent via server-side Edge Function (`paymongo-payment` verify_payment_intent)
      // This updates `user_plan_subscription` + `user_payment` and triggers the Email Payment Receipt.
      let verifiedData: any = null;
      if (paymentIntentId && clientKey) {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const vRes = await verifyPayMongoIntentOnce(paymentIntentId, clientKey);
            if (vRes) {
              verifiedData = vRes.raw || vRes;
              const status = vRes.status || vRes.raw?.attributes?.status;
              if (status === 'succeeded' || vRes.raw?.fulfillment?.fulfilled) {
                break;
              }
            }
          } catch (vErr) {
            console.warn('[PaymentSuccess] verifyPayMongoIntentOnce notice:', vErr);
          }
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 1200));
          }
        }
      }

      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        try {
          window.sessionStorage.removeItem('dermai_pending_payment_intent_id');
          window.sessionStorage.removeItem('dermai_pending_payment_intent_client_key');
        } catch {
          // Ignore
        }
      }

      // ── SUBSCRIPTION RECEIPT FLOW ──
      if (isSubscriptionFlow || (!appointmentId && verifiedData?.attributes?.metadata?.plan_id)) {
        const currentUser = await getCurrentUser();
        const userId =
          currentUser?.id ||
          verifiedData?.attributes?.metadata?.user_id ||
          '';

        let payerEmail =
          ((searchParams.email as string) ||
            currentUser?.email ||
            '').trim();

        if (!payerEmail && userId) {
          try {
            const { data: authUser } = await supabase.auth.getUser();
            payerEmail = authUser?.user?.email || '';
          } catch {}
        }

        // Refresh live subscription from Supabase
        const liveSub = userId ? await getUserSubscription(userId) : null;
        if (!payerEmail && liveSub?.email) {
          payerEmail = liveSub.email;
        }

        // Query latest user_payment to retrieve recorded payment details if available
        let latestPaymentRow: any = null;
        if (userId) {
          try {
            const { data: pData } = await supabase
              .from('user_payment')
              .select('*')
              .eq('user_id', userId)
              .order('payment_date', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (pData) {
              latestPaymentRow = pData;
            }
          } catch (pErr) {
            console.warn('[PaymentSuccess] user_payment lookup notice:', pErr);
          }
        }

        const payments = verifiedData?.attributes?.payments || [];
        const firstPayment = payments[0] || null;

        if (!payerEmail && firstPayment?.attributes?.billing?.email) {
          payerEmail = firstPayment.attributes.billing.email;
        }

        // Resolve transaction ID: prioritize real PayMongo payment intent ID / payment ID (pay_...)
        const paymongoRef =
          firstPayment?.id ||
          (urlPaymentId && urlPaymentId.startsWith('pay_') ? urlPaymentId : null) ||
          latestPaymentRow?.paymongo_payment_id ||
          (latestPaymentRow?.reference_number && String(latestPaymentRow.reference_number).startsWith('pay_') ? latestPaymentRow.reference_number : null) ||
          urlPaymentId ||
          latestPaymentRow?.reference_number ||
          paymentIntentId ||
          liveSub?.transactionId ||
          'pay_confirmed';

        const verifiedCentavos = Number(
          verifiedData?.attributes?.amount ||
            firstPayment?.attributes?.amount ||
            0
        );
        const paramAmount = Number(searchParams.amount || 0);
        const totalAmount =
          verifiedCentavos > 0
            ? Math.round(verifiedCentavos) / 100
            : paramAmount > 0
            ? paramAmount
            : latestPaymentRow?.amount && Number(latestPaymentRow.amount) > 0
            ? Number(latestPaymentRow.amount)
            : liveSub?.totalPrice && liveSub.totalPrice > 0
            ? liveSub.totalPrice
            : 199.0;

        // Dynamic 12% VAT calculations
        const basePrice = Math.round((totalAmount / 1.12) * 100) / 100;
        const vatAmount = Math.round((totalAmount - basePrice) * 100) / 100;

        const rawMethod =
          ((searchParams.method as string) ||
            firstPayment?.attributes?.source?.type ||
            firstPayment?.attributes?.payment_method_details?.type ||
            latestPaymentRow?.method ||
            verifiedData?.attributes?.metadata?.payment_method ||
            liveSub?.paymentMethod ||
            'gcash')
            .toLowerCase();
        const paymentMethod = rawMethod.includes('maya') ? 'Maya' : 'GCash';

        const planName =
          ((searchParams.plan_name as string) ||
            liveSub?.planName ||
            'Pro Plan').trim();

        const cycleRaw =
          ((searchParams.cycle as string) ||
            verifiedData?.attributes?.metadata?.billing_cycle ||
            latestPaymentRow?.billing_cycle ||
            liveSub?.billingCycle ||
            'monthly')
            .toLowerCase();
        const billingCycle = cycleRaw === 'yearly' ? 'Annual' : 'Monthly';

        const patientName =
          firstPayment?.attributes?.billing?.name ||
          currentUser?.fullName ||
          'Patient';

        const paidUnix = firstPayment?.attributes?.paid_at;
        const paidRawDate = paidUnix
          ? new Date(paidUnix * 1000)
          : latestPaymentRow?.payment_date
          ? new Date(latestPaymentRow.payment_date)
          : new Date();
        const formattedDate = formatReceiptDate(paidRawDate);

        // Ensure local store is also synced if redirected from Web PayMongo
        if (userId && liveSub) {
          await setUserSubscription(userId, liveSub);
          if (Platform.OS === 'web') {
            await addAppNotification(userId, {
              type: 'subscription',
              title: `${planName} Activated`,
              message: `Your ${billingCycle} ${planName} subscription (₱${totalAmount.toLocaleString(
                'en-PH',
                { minimumFractionDigits: 2, maximumFractionDigits: 2 }
              )}) via ${paymentMethod} is now active. Ref: ${paymongoRef}`,
              userId,
            }).catch(() => {});
          }
        }

        if (!isMounted) return;

        setReceipt({
          kind: 'subscription',
          reference: paymongoRef,
          totalAmount,
          basePrice,
          vatAmount,
          paymentMethod,
          planName: 'DermAI Subscription',
          billingCycle,
          date: formattedDate,
          email: payerEmail || 'patient@dermai.com',
          patientName,
        });
        setOutcome('success');
        setLoading(false);
        return;
      }

      // ── APPOINTMENT CONSULTATION RECEIPT FLOW ──
      let apptData: any = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const { data, error } = await supabase
            .from('patient_appointment')
            .select(`
              appointment_id,
              appointment_date,
              appointment_time,
              status,
              payment_status,
              payment_method,
              payment_reference,
              consultation_fee,
              queue_number,
              patient_name,
              clinic:clinic_id (name, address),
              doctor:doctor_id (full_name)
            `)
            .eq('appointment_id', appointmentId)
            .maybeSingle();

          if (!error && data) {
            apptData = data;
            if (data.payment_status === 'paid' || data.status === 'confirmed' || data.status === 'scheduled') {
              break;
            }
          }
        } catch (dbErr) {
          console.warn('[PaymentSuccess] Appointment check error:', dbErr);
        }
        if (attempt < 3) {
          await new Promise((res) => setTimeout(res, 1200));
        }
      }

      if (!isMounted) return;

      if (apptData) {
        const isPaid =
          apptData.payment_status === 'paid' ||
          apptData.status === 'confirmed' ||
          apptData.status === 'scheduled';

        if (isPaid) {
          const ref = apptData.payment_reference || paymentIntentId || 'PAY-CONFIRMED';
          const method = (apptData.payment_method || 'gcash').toUpperCase();
          const fee = Number(apptData.consultation_fee) || 500;

          setReceipt({
            kind: 'appointment',
            appointmentId: apptData.appointment_id,
            reference: ref,
            amount: fee,
            paymentMethod: method,
            clinicName: apptData.clinic?.name || 'Dermatology Clinic',
            clinicAddress: apptData.clinic?.address || undefined,
            doctorName: apptData.doctor?.full_name || 'Attending Dermatologist',
            date: apptData.appointment_date || 'Scheduled Date',
            time: apptData.appointment_time || 'Scheduled Time',
            patientName: apptData.patient_name || 'Patient',
            queueNumber: apptData.queue_number != null ? Number(apptData.queue_number) : undefined,
          });
          setOutcome('success');
        } else {
          setOutcome('uncertain');
        }
      } else {
        setReceipt({
          kind: 'appointment',
          appointmentId,
          reference: paymentIntentId || 'PAY-CONFIRMED',
          amount: 500,
          paymentMethod: 'E-WALLET',
          clinicName: 'Dermatology Clinic',
          doctorName: 'Attending Dermatologist',
          date: 'Scheduled Date',
          time: 'Scheduled Time',
          patientName: 'Patient',
        });
        setOutcome('success');
      }

      setLoading(false);
    }

    handlePaymentReturn();

    return () => {
      isMounted = false;
    };
  }, [appointmentId, urlPaymentIntentId, urlClientKey, urlPaymentId, rawStatus, isSubscriptionFlow]);

  if (loading) {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingTitle}>Verifying Payment</Text>
        <Text style={styles.loadingSubtitle}>
          Confirming your payment authorization with PayMongo and DermAI...
        </Text>
      </SafeAreaView>
    );
  }

  if (outcome === 'cancelled') {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <View style={[styles.iconCircle, { backgroundColor: '#fef2f2' }]}>
          <Ionicons name="close-circle" size={48} color="#ef4444" />
        </View>
        <Text style={styles.errorTitle}>Payment Cancelled</Text>
        <Text style={styles.errorSubtitle}>
          {isSubscriptionFlow
            ? 'Your subscription upgrade payment was not completed. No charges were made.'
            : 'Your consultation payment was not completed. Your provisional reservation hold has been released.'}
        </Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() =>
            router.replace(isSubscriptionFlow ? '/(app)/subscription' : '/(app)/appointments')
          }
        >
          <Text style={styles.primaryBtnTxt}>
            {isSubscriptionFlow ? 'Back to Subscription' : 'Back to Appointments'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => router.replace('/(app)')}
        >
          <Text style={styles.secondaryBtnTxt}>Return to Dashboard</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (outcome === 'failed') {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <View style={[styles.iconCircle, { backgroundColor: '#fef2f2' }]}>
          <Ionicons name="alert-circle" size={48} color="#ef4444" />
        </View>
        <Text style={styles.errorTitle}>Payment Failed</Text>
        <Text style={styles.errorSubtitle}>
          {errorMessage || 'The payment transaction could not be completed by your e-wallet provider.'}
        </Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() =>
            router.replace(isSubscriptionFlow ? '/(app)/subscription' : '/(app)/appointments')
          }
        >
          <Text style={styles.primaryBtnTxt}>
            {isSubscriptionFlow ? 'Try Upgrading Again' : 'Try Booking Again'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => router.replace('/(app)')}
        >
          <Text style={styles.secondaryBtnTxt}>Return to Dashboard</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (outcome === 'uncertain') {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <View style={[styles.iconCircle, { backgroundColor: '#fffbeb' }]}>
          <Ionicons name="time" size={48} color="#d97706" />
        </View>
        <Text style={styles.errorTitle}>Verification in Progress</Text>
        <Text style={styles.errorSubtitle}>
          We received your payment redirect. Status verification is actively finalizing in the background.
        </Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() =>
            router.replace(isSubscriptionFlow ? '/(app)/subscription' : '/(app)/appointments')
          }
        >
          <Text style={styles.primaryBtnTxt}>
            {isSubscriptionFlow ? 'View Subscription' : 'View Appointments'}
          </Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── OFFICIAL SUBSCRIPTION PAYMENT RECEIPT VIEW (WEB PARITY) ──
  if (outcome === 'success' && receipt?.kind === 'subscription') {
    return (
      <SafeAreaView style={styles.receiptScreenSafe}>
        <ScrollView
          contentContainerStyle={styles.receiptScreenContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.webReceiptCard}>
            {/* Dark burgundy top banner */}
            <View style={styles.receiptBrandBanner}>
              <Text style={styles.receiptBrandTitle}>DERMAI</Text>
              <Text style={styles.receiptBrandSubtitle}>Official Payment Receipt</Text>
            </View>

            {/* Centered green checkmark badge icon floating at bottom edge of banner */}
            <View style={styles.floatingCheckmarkWrapper}>
              <View style={styles.floatingCheckmarkCircle}>
                <Ionicons name="checkmark" size={36} color="#FFFFFF" />
              </View>
            </View>

            {/* Confirmation headings */}
            <View style={styles.receiptHeaderContainer}>
              <Text style={styles.receiptHeading}>Payment Received</Text>
              <Text style={styles.receiptSubheading}>
                Your DermAI subscription payment was successfully confirmed.
              </Text>
            </View>

            {/* Highlighted Total Box */}
            <View style={styles.totalPaidBox}>
              <Text style={styles.totalPaidLabel}>TOTAL PAID</Text>
              <Text style={styles.totalPaidAmount}>
                ₱{receipt.totalAmount.toLocaleString('en-PH', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </Text>
            </View>

            {/* Payment Details Breakdown Table */}
            <View style={styles.detailsContainer}>
              <Text style={styles.detailsHeaderLabel}>PAYMENT DETAILS</Text>

              {/* Account */}
              <View style={styles.receiptTableRow}>
                <Text style={styles.receiptTableLabel}>Account</Text>
                <Text style={styles.receiptTableValue} numberOfLines={1}>
                  {receipt.email}
                </Text>
              </View>

              {/* Description */}
              <View style={styles.receiptTableRow}>
                <Text style={styles.receiptTableLabel}>Description</Text>
                <Text style={styles.receiptTableValue}>DermAI Subscription</Text>
              </View>

              {/* Subtotal (Net of VAT) */}
              <View style={styles.receiptTableRow}>
                <Text style={styles.receiptTableLabel}>Subtotal (Net of VAT)</Text>
                <Text style={styles.receiptTableValue}>
                  ₱{receipt.basePrice.toLocaleString('en-PH', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </Text>
              </View>

              {/* VAT (12%) */}
              <View style={styles.receiptTableRow}>
                <Text style={styles.receiptTableLabel}>VAT (12%)</Text>
                <Text style={styles.receiptTableValue}>
                  ₱{receipt.vatAmount.toLocaleString('en-PH', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </Text>
              </View>

              {/* Payment Method */}
              <View style={styles.receiptTableRow}>
                <Text style={styles.receiptTableLabel}>Payment Method</Text>
                <View style={styles.methodValueContainer}>
                  <Ionicons name="card-outline" size={16} color="#A21D5C" />
                  <Text style={styles.methodValueText}>{receipt.paymentMethod}</Text>
                </View>
              </View>

              {/* Date */}
              <View style={styles.receiptTableRow}>
                <Text style={styles.receiptTableLabel}>Date</Text>
                <View style={styles.dateValueContainer}>
                  <Ionicons name="calendar-outline" size={16} color="#A21D5C" />
                  <Text style={styles.dateValueText}>{receipt.date}</Text>
                </View>
              </View>

              {/* Transaction ID */}
              <View style={[styles.receiptTableRow, { borderBottomWidth: 0 }]}>
                <Text style={styles.receiptTableLabel}>Transaction ID</Text>
                <View style={styles.transactionPill}>
                  <Text style={styles.transactionPillText} numberOfLines={1}>
                    {receipt.reference}
                  </Text>
                </View>
              </View>

              {/* Primary action button: Continue to Dashboard */}
              <TouchableOpacity
                style={[
                  styles.continueDashboardBtn,
                  Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                ]}
                onPress={async () => {
                  try {
                    const currentUser = await getCurrentUser();
                    if (currentUser?.id) {
                      const updatedSub = await getUserSubscription(currentUser.id);
                      if (updatedSub) await setUserSubscription(currentUser.id, updatedSub);
                    }
                  } catch {}
                  router.replace('/(app)');
                }}
                activeOpacity={0.88}
              >
                <Text style={styles.continueDashboardBtnText}>Continue to Dashboard</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── APPOINTMENT CONSULTATION SUCCESS VIEW ──
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header Success Badge */}
        <View style={styles.headerBox}>
          <View style={styles.successIconBox}>
            <Ionicons name="checkmark-circle" size={54} color="#059669" />
          </View>
          <Text style={styles.mainHeading}>Payment Confirmed!</Text>
          <Text style={styles.mainSubheading}>
            Your consultation appointment has been officially booked.
          </Text>
        </View>

        {/* Appointment consultation receipt card */}
        {receipt?.kind === 'appointment' && (
          <View style={styles.receiptCard}>
            <View style={styles.receiptHeader}>
              <View>
                <Text style={styles.receiptTitle}>OFFICIAL RECEIPT</Text>
                <Text style={styles.receiptRef}>{receipt.reference}</Text>
              </View>
              <View style={styles.badgePaid}>
                <Ionicons name="checkmark-sharp" size={12} color="#059669" />
                <Text style={styles.badgePaidTxt}>PAID</Text>
              </View>
            </View>

            <View style={styles.dashedDivider} />

            {/* Amount Section */}
            <View style={styles.amountBox}>
              <Text style={styles.amountLabel}>Consultation Fee Paid</Text>
              <Text style={styles.amountValue}>₱{receipt.amount.toFixed(2)}</Text>
              <Text style={styles.amountVat}>VAT Inclusive</Text>
            </View>

            <View style={styles.dashedDivider} />

            {/* Details Table */}
            <View style={styles.detailRow}>
              <Text style={styles.detailKey}>Payment Method</Text>
              <Text style={styles.detailVal}>{receipt.paymentMethod}</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailKey}>Clinic</Text>
              <Text style={styles.detailVal}>{receipt.clinicName}</Text>
            </View>

            {receipt.clinicAddress ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailKey}>Address</Text>
                <Text style={styles.detailVal}>{receipt.clinicAddress}</Text>
              </View>
            ) : null}

            <View style={styles.detailRow}>
              <Text style={styles.detailKey}>Attending Doctor</Text>
              <Text style={styles.detailVal}>{receipt.doctorName}</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailKey}>Confirmed Schedule</Text>
              <Text style={styles.detailVal}>
                {receipt.date} • {receipt.time}
              </Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailKey}>Patient Name</Text>
              <Text style={styles.detailVal}>{receipt.patientName}</Text>
            </View>

            {receipt.queueNumber != null && (
              <View style={styles.detailRow}>
                <Text style={styles.detailKey}>Queue Priority</Text>
                <Text style={[styles.detailVal, { color: COLORS.primary, fontWeight: '800' }]}>
                  #{receipt.queueNumber}
                </Text>
              </View>
            )}

            {/* Reminders Note */}
            <View style={styles.reminderBox}>
              <Ionicons name="information-circle" size={16} color="#0284c7" />
              <Text style={styles.reminderTxt}>
                Please arrive 10–15 minutes early at the clinic. Have your Reference Number ready upon check-in.
              </Text>
            </View>
          </View>
        )}

        {/* Action Buttons */}
        <View style={styles.actionsBox}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.replace('/(app)/appointments')}
          >
            <Ionicons name="calendar-outline" size={18} color="#fff" />
            <Text style={styles.primaryBtnTxt}>View My Appointments</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.replace('/(app)')}
          >
            <Ionicons name="home-outline" size={18} color={COLORS.primary} />
            <Text style={styles.secondaryBtnTxt}>Back to Dashboard</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingTitle: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  loadingSubtitle: {
    marginTop: 6,
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 8,
  },
  errorSubtitle: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 300,
    marginBottom: 24,
  },
  headerBox: {
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 10,
  },
  successIconBox: {
    marginBottom: 8,
  },
  mainHeading: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
  },
  mainSubheading: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 4,
  },
  receiptCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  receiptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  receiptTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: '#94a3b8',
  },
  receiptRef: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: COLORS.primary,
    marginTop: 2,
  },
  badgePaid: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  badgePaidTxt: {
    fontSize: 10,
    fontWeight: '800',
    color: '#059669',
  },
  dashedDivider: {
    height: 1,
    backgroundColor: '#f1f5f9',
    marginVertical: 14,
  },
  amountBox: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  amountLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  amountValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#059669',
    marginTop: 2,
  },
  amountVat: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  detailKey: {
    fontSize: 12,
    color: '#64748b',
    flex: 1,
  },
  detailVal: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
    flex: 1.5,
    textAlign: 'right',
  },
  reminderBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f9ff',
    borderRadius: 10,
    padding: 12,
    gap: 8,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#e0f2fe',
  },
  reminderTxt: {
    fontSize: 11,
    color: '#0369a1',
    flex: 1,
    lineHeight: 16,
  },
  actionsBox: {
    marginTop: 24,
    gap: 12,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  primaryBtnTxt: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 8,
  },
  secondaryBtnTxt: {
    color: COLORS.primary,
    fontSize: 15,
    fontWeight: '700',
  },

  // ── Web Parity Official Subscription Receipt Styles ──
  receiptScreenSafe: {
    flex: 1,
    backgroundColor: '#FDF2F7',
  },
  receiptScreenContent: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webReceiptCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F4C9DC',
    overflow: 'hidden',
    shadowColor: '#A21D5C',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 5,
  },
  receiptBrandBanner: {
    backgroundColor: '#7E1448',
    paddingTop: 30,
    paddingBottom: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptBrandTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    color: 'rgba(253, 242, 247, 0.9)',
  },
  receiptBrandSubtitle: {
    fontSize: 12,
    color: 'rgba(253, 242, 247, 0.75)',
    marginTop: 4,
    letterSpacing: 0.3,
  },
  floatingCheckmarkWrapper: {
    alignItems: 'center',
    marginTop: -32,
    marginBottom: 4,
  },
  floatingCheckmarkCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#10B981',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  receiptHeaderContainer: {
    alignItems: 'center',
    paddingHorizontal: 24,
    marginTop: 10,
  },
  receiptHeading: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  receiptSubheading: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  totalPaidBox: {
    backgroundColor: '#FDF2F7',
    borderWidth: 1,
    borderColor: '#F4C9DC',
    borderRadius: 12,
    marginHorizontal: 24,
    marginTop: 20,
    paddingVertical: 16,
    alignItems: 'center',
  },
  totalPaidLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: '#6B7280',
  },
  totalPaidAmount: {
    fontSize: 30,
    fontWeight: '800',
    color: '#A21D5C',
    marginTop: 4,
  },
  detailsContainer: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 28,
  },
  detailsHeaderLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: '#6B7280',
    marginBottom: 6,
  },
  receiptTableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 12,
  },
  receiptTableLabel: {
    fontSize: 13,
    color: '#6B7280',
    flexShrink: 0,
  },
  receiptTableValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'right',
    flex: 1,
  },
  methodValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  methodValueText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  dateValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateValueText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  transactionPill: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: '70%',
  },
  transactionPillText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#374151',
  },
  continueDashboardBtn: {
    backgroundColor: '#A21D5C',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 26,
  },
  continueDashboardBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
