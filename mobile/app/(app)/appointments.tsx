import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import BookingModal from '@/components/BookingModal';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, STATUS_COLORS } from '@/lib/constants';
import {
  getCurrentUser,
  getAppointments,
  saveAppointment,
  cancelAppointment,
  getClinics,
  addAppNotification,
} from '@/lib/store';
import type { Appointment, PatientAccount, ClinicRecord, ClinicDoctor } from '@/lib/store';

type Tab = 'upcoming' | 'past';

function normalizeDayName(day: string): string {
  const d = String(day || '').toLowerCase().trim();
  if (d.startsWith('mon')) return 'Monday';
  if (d.startsWith('tue')) return 'Tuesday';
  if (d.startsWith('wed')) return 'Wednesday';
  if (d.startsWith('thu')) return 'Thursday';
  if (d.startsWith('fri')) return 'Friday';
  if (d.startsWith('sat')) return 'Saturday';
  if (d.startsWith('sun')) return 'Sunday';
  return day;
}

function isDoctorOnDutyOnDay(doctor: ClinicDoctor | null | undefined, dayOfWeek: string): boolean {
  if (!doctor) return true;
  if (!doctor.dutyDays || !Array.isArray(doctor.dutyDays) || doctor.dutyDays.length === 0) {
    return true;
  }
  const normTarget = normalizeDayName(dayOfWeek);
  return doctor.dutyDays.some((d) => normalizeDayName(d) === normTarget);
}


function formatDateDisplay(dStr?: string): string {
  if (!dStr) return 'Date to be confirmed';
  try {
    const parts = dStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
      }
    }
    const d = new Date(dStr);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
  } catch {}
  return dStr;
}

const BATCH_SLOTS = [
  { batchTime: '09:00', label: '09:00 AM – 10:00 AM' },
  { batchTime: '10:00', label: '10:00 AM – 11:00 AM' },
  { batchTime: '11:00', label: '11:00 AM – 12:00 PM' },
  { batchTime: '13:00', label: '01:00 PM – 02:00 PM' },
  { batchTime: '14:00', label: '02:00 PM – 03:00 PM' },
  { batchTime: '15:00', label: '03:00 PM – 04:00 PM' },
  { batchTime: '16:00', label: '04:00 PM – 05:00 PM' },
];

export default function AppointmentsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ openBooking?: string; clinicId?: string }>();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [clinics, setClinics] = useState<ClinicRecord[]>([]);
  const [user, setUser] = useState<PatientAccount | null>(null);
  const [showBooking, setShowBooking] = useState(false);
  const [selectedApptForSummary, setSelectedApptForSummary] = useState<Appointment | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (params.openBooking === '1') {
      setShowBooking(true);
    }
  }, [params.openBooking, params.clinicId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
      if (params.openBooking === '1') {
        setShowBooking(true);
      }
    }, [params.openBooking, params.clinicId])
  );

  async function loadData() {
    setLoading(true);
    try {
      const [u, loadedClinics] = await Promise.all([
        getCurrentUser(),
        getClinics(),
      ]);
      setUser(u);
      setClinics(loadedClinics);
      if (!u) return;
      const appts = await getAppointments(u.id);
      setAppointments(appts);
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel(apptId: string) {
    Alert.alert(
      'Cancel Appointment',
      'Are you sure you want to cancel this pending appointment?',
      [
        { text: 'Keep It', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelAppointment(apptId);
              Alert.alert('Cancelled', 'Your appointment request has been cancelled.');
              loadData();
            } catch (err: any) {
              Alert.alert('Error', err?.message ?? 'Failed to cancel appointment.');
            }
          },
        },
      ]
    );
  }

  const upcomingAppts = appointments.filter(
    (a) => a.status === 'pending' || a.status === 'scheduled' || a.status === 'confirmed'
  );
  const pastAppts = appointments.filter(
    (a) => a.status === 'completed' || a.status === 'cancelled' || a.status === 'rejected'
  );

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerAvatarCircle}>
          <Ionicons name="calendar" size={20} color={COLORS.primary} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.headerWelcome}>Your Consultations</Text>
          <Text style={styles.headerName}>Appointments</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowBooking(true)}>
          <Ionicons name="add" size={17} color="#fff" />
          <Text style={styles.addBtnTxt}>Book New</Text>
        </TouchableOpacity>
      </View>

      {/* ── Tabs ── */}
      <View style={styles.tabContainer}>
        <View style={styles.tabRow}>
          {(['upcoming', 'past'] as Tab[]).map((t) => {
            const count = t === 'upcoming' ? upcomingAppts.length : pastAppts.length;
            const active = tab === t;
            return (
              <TouchableOpacity
                key={t}
                style={[styles.tabBtn, active && styles.tabBtnActive]}
                onPress={() => setTab(t)}
                activeOpacity={0.8}
              >
                <Text style={[styles.tabTxt, active && styles.tabTxtActive]}>
                  {t === 'upcoming' ? 'Upcoming' : 'Past & Completed'}
                </Text>
                <View style={[styles.tabCountBadge, active && styles.tabCountBadgeActive]}>
                  <Text style={[styles.tabCountTxt, active && styles.tabCountTxtActive]}>
                    {count}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 80 }}
      >
        <View style={styles.list}>
          {loading && appointments.length === 0 ? (
            <ActivityIndicator size="small" color={COLORS.primary} style={{ marginTop: 40 }} />
          ) : (tab === 'upcoming' ? upcomingAppts : pastAppts).length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="calendar-outline" size={32} color={COLORS.primary} />
              </View>
              <Text style={styles.emptyTitle}>
                {tab === 'upcoming' ? 'No Upcoming Consultations' : 'No Past Consultations'}
              </Text>
              <Text style={styles.emptySub}>
                {tab === 'upcoming'
                  ? 'Book a consultation with a licensed dermatologist to get personalized medical care.'
                  : 'Your completed and cancelled appointments will be recorded here.'}
              </Text>
              {tab === 'upcoming' && (
                <TouchableOpacity style={styles.bookBtn} onPress={() => setShowBooking(true)}>
                  <Ionicons name="add-circle-outline" size={18} color="#fff" />
                  <Text style={styles.bookBtnTxt}>Book an Appointment</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            (tab === 'upcoming' ? upcomingAppts : pastAppts).map((appt) => (
              <AppointmentCard
                key={appt.id}
                appt={appt}
                clinics={clinics}
                onViewSummary={() => setSelectedApptForSummary(appt)}
                onCancel={() => handleCancel(appt.id)}
              />
            ))
          )}
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>

      <BookingModal
        visible={showBooking}
        user={user}
        clinics={clinics}
        initialClinicId={params.clinicId}
        existingAppointments={appointments}
        onClose={() => {
          setShowBooking(false);
          router.setParams({ openBooking: undefined, clinicId: undefined });
        }}
        onSaved={() => {
          setShowBooking(false);
          router.setParams({ openBooking: undefined, clinicId: undefined });
          loadData();
        }}
      />

      <AppointmentSummaryModal
        visible={!!selectedApptForSummary}
        appt={selectedApptForSummary}
        clinics={clinics}
        onClose={() => setSelectedApptForSummary(null)}
        onCancel={() => {
          if (selectedApptForSummary) {
            const id = selectedApptForSummary.id;
            setSelectedApptForSummary(null);
            handleCancel(id);
          }
        }}
      />
    </SafeAreaView>
  );
}

function AppointmentCard({
  appt,
  clinics,
  onCancel,
  onViewSummary,
}: {
  appt: Appointment;
  clinics: ClinicRecord[];
  onCancel: () => void;
  onViewSummary: () => void;
}) {
  const sc = STATUS_COLORS[appt.status] ?? STATUS_COLORS.pending;
  const matchedClinic = clinics.find(
    (c) => String(c.id) === String(appt.clinicId) || c.name === appt.clinicName
  );

  const STEPS = ['Request Sent', 'Clinic Review', 'Scheduled', 'Completed'] as const;
  const getStepIndex = (status: string) => {
    if (status === 'completed') return 3;
    if (status === 'scheduled' || status === 'confirmed') return 2;
    if (status === 'pending') return 1;
    return 0;
  };
  const currentStep = appt.status === 'rejected' || appt.status === 'cancelled' ? -1 : getStepIndex(appt.status);
  const isFinalized = appt.status === 'confirmed' || appt.status === 'scheduled' || appt.status === 'completed';

  return (
    <TouchableOpacity activeOpacity={0.92} onPress={onViewSummary} style={styles.card}>
      {/* Top Clinic & Status Header */}
      <View style={styles.cardTopRow}>
        {matchedClinic?.logoUrl ? (
          <Image source={{ uri: matchedClinic.logoUrl }} style={styles.cardClinicLogo} />
        ) : (
          <View style={styles.cardClinicLogoFallback}>
            <Text style={styles.cardClinicLogoTxt}>
              {appt.clinicName.charAt(0) || 'C'}
            </Text>
          </View>
        )}
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text style={styles.clinicName} numberOfLines={1}>
                {appt.clinicName}
              </Text>
              {matchedClinic?.verified && (
                <View style={styles.verifiedTag}>
                  <Ionicons name="checkmark-circle" size={11} color="#059669" />
                  <Text style={styles.verifiedTagTxt}>Verified</Text>
                </View>
              )}
            </View>
            <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.statusTxt, { color: sc.text }]}>{sc.label}</Text>
            </View>
          </View>

          {/* Doctor Info */}
          <View style={styles.doctorRow}>
            <Ionicons name="medkit-outline" size={13} color={COLORS.primary} />
            <Text style={styles.doctorName} numberOfLines={1}>
              {appt.doctorName ? (appt.doctorName.startsWith('Dr') ? appt.doctorName : `Dr. ${appt.doctorName}`) : 'Attending Dermatologist'}
            </Text>
            {appt.specialty ? (
              <Text style={styles.specialtyTag}>• {appt.specialty}</Text>
            ) : null}
          </View>
        </View>
      </View>

      {/* Meta Pills (No Queue Number!) */}
      <View style={styles.apptMeta}>
        {appt.date ? (
          <View style={styles.apptMetaItem}>
            <Ionicons name="calendar-outline" size={12} color={COLORS.primary} />
            <Text style={styles.apptMetaText}>{formatDateDisplay(appt.date)}</Text>
          </View>
        ) : null}
        {appt.batchTime || appt.time ? (
          <View style={styles.apptMetaItem}>
            <Ionicons name="time-outline" size={12} color={COLORS.primary} />
            <Text style={styles.apptMetaText}>{appt.batchTime || appt.time}</Text>
          </View>
        ) : null}
        <View style={styles.apptMetaItem}>
          <Ionicons name="location-outline" size={12} color="#64748b" />
          <Text style={styles.apptMetaText}>In-Person Consultation</Text>
        </View>
        {Boolean(appt.paymentStatus === 'paid' || appt.paymentReference) && (
          <View style={[styles.apptMetaItem, { backgroundColor: '#ecfdf5', borderColor: '#a7f3d0' }]}>
            <Ionicons name="checkmark-circle" size={12} color="#059669" />
            <Text style={[styles.apptMetaText, { color: '#059669', fontWeight: '800' }]}>
              Paid {appt.paymentAmount ? `₱${appt.paymentAmount.toLocaleString()}` : ''}
            </Text>
          </View>
        )}
      </View>

      {/* 4-Step Progress Tracker */}
      {currentStep >= 0 && (
        <View style={styles.stepTracker}>
          {STEPS.map((step, idx) => (
            <View key={step} style={styles.stepItem}>
              <View style={styles.stepRow}>
                <View style={[styles.stepCircle, idx <= currentStep ? styles.stepCircleActive : styles.stepCircleInactive]}>
                  {idx <= currentStep ? (
                    <Text style={styles.stepCheck}>✓</Text>
                  ) : (
                    <Text style={styles.stepNum}>{idx + 1}</Text>
                  )}
                </View>
                {idx < STEPS.length - 1 && (
                  <View style={[styles.stepLine, idx < currentStep ? styles.stepLineActive : styles.stepLineInactive]} />
                )}
              </View>
              <Text style={[styles.stepLabel, idx <= currentStep && { color: COLORS.primary, fontWeight: '700' }]}>
                {step}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Optional AI Condition Banner */}
      {appt.conditionName ? (
        <View style={styles.cardConditionRow}>
          <Ionicons name="scan-outline" size={12} color={COLORS.primary} />
          <Text style={styles.cardConditionLabel}>AI Finding: </Text>
          <Text style={styles.cardConditionVal}>{appt.conditionName}</Text>
        </View>
      ) : null}

      {/* Symptoms / Notes Preview */}
      {appt.notes ? (
        <Text style={styles.reason} numberOfLines={2}>
          Symptoms: {appt.notes}
        </Text>
      ) : null}

      {/* Clinic Note from staff */}
      {appt.clinicNote ? (
        <View style={styles.referralTag}>
          <Ionicons name="chatbubble-ellipses-outline" size={13} color="#c2410c" />
          <Text style={styles.referralTagTxt} numberOfLines={2}>
            Clinic Note: {appt.clinicNote}
          </Text>
        </View>
      ) : null}

      {/* Summary button & Cancellation controls */}
      <View style={styles.cardFooterRow}>
        <TouchableOpacity onPress={onViewSummary} style={styles.viewSummaryBtn}>
          <Ionicons name="document-text-outline" size={13} color={COLORS.primary} />
          <Text style={styles.viewSummaryTxt}>Consultation Summary</Text>
          <Ionicons name="chevron-forward" size={12} color={COLORS.primary} />
        </TouchableOpacity>

        {appt.status === 'pending' ? (
          <TouchableOpacity onPress={onCancel} style={styles.cancelActionBtn}>
            <Ionicons name="close-circle-outline" size={14} color="#dc2626" />
            <Text style={styles.cancelActionTxt}>Cancel Request</Text>
          </TouchableOpacity>
        ) : isFinalized ? (
          <View style={styles.lockedBadge}>
            <Ionicons name="lock-closed-outline" size={12} color="#64748b" />
            <Text style={styles.lockedBadgeTxt}>Confirmed</Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

function AppointmentSummaryModal({
  visible,
  appt,
  clinics,
  onClose,
  onCancel,
}: {
  visible: boolean;
  appt: Appointment | null;
  clinics: ClinicRecord[];
  onClose: () => void;
  onCancel: () => void;
}) {
  if (!appt) return null;
  const sc = STATUS_COLORS[appt.status] ?? STATUS_COLORS.pending;
  const matchedClinic = clinics.find(
    (c) => String(c.id) === String(appt.clinicId) || c.name === appt.clinicName
  );
  const dynamicFee = matchedClinic?.consultationFee
    ? `₱${Number(matchedClinic.consultationFee).toLocaleString()}`
    : '₱500';

  const STEPS = ['Request Sent', 'Clinic Review', 'Scheduled', 'Completed'] as const;
  const getStepIndex = (status: string) => {
    if (status === 'completed') return 3;
    if (status === 'scheduled' || status === 'confirmed') return 2;
    if (status === 'pending') return 1;
    return 0;
  };
  const currentStep = appt.status === 'rejected' || appt.status === 'cancelled' ? -1 : getStepIndex(appt.status);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.modalSafe}>
        {/* Header */}
        <View style={styles.summaryModalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={18} color={COLORS.text} />
            <Text style={styles.backBtnTxt}>Close</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={styles.summaryModalHeading}>Consultation Summary</Text>
              <Text style={styles.summaryModalSub}>Details of your dermatologist consultation</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.statusTxt, { color: sc.text }]}>{sc.label}</Text>
            </View>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.summaryModalContent} showsVerticalScrollIndicator={false}>
          {/* Progress Tracker */}
          {currentStep >= 0 && (
            <View style={styles.summaryProgressCard}>
              <Text style={styles.summarySectionTitle}>Appointment Status</Text>
              <View style={styles.stepTracker}>
                {STEPS.map((step, idx) => (
                  <View key={step} style={styles.stepItem}>
                    <View style={styles.stepRow}>
                      <View style={[styles.stepCircle, idx <= currentStep ? styles.stepCircleActive : styles.stepCircleInactive]}>
                        {idx <= currentStep ? (
                          <Text style={styles.stepCheck}>✓</Text>
                        ) : (
                          <Text style={styles.stepNum}>{idx + 1}</Text>
                        )}
                      </View>
                      {idx < STEPS.length - 1 && (
                        <View style={[styles.stepLine, idx < currentStep ? styles.stepLineActive : styles.stepLineInactive]} />
                      )}
                    </View>
                    <Text style={[styles.stepLabel, idx <= currentStep && { color: COLORS.primary, fontWeight: '700' }]}>
                      {step}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Consultation Slot Details */}
          <View style={styles.summaryCard}>
            <View style={styles.summarySlotBox}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.summarySlotLabel}>Consultation Details</Text>
                <View style={styles.summaryDurationBadge}>
                  <Text style={styles.summaryDurationTxt}>In-Person</Text>
                </View>
              </View>
              <Text style={styles.summaryDoctorName}>
                {appt.doctorName ? (appt.doctorName.startsWith('Dr') ? appt.doctorName : `Dr. ${appt.doctorName}`) : 'Attending Dermatologist'}
              </Text>
              {appt.specialty ? (
                <Text style={styles.summaryDoctorSpec}>{appt.specialty}</Text>
              ) : null}
              <View style={styles.summarySlotRow}>
                <Ionicons name="calendar-outline" size={13} color={COLORS.primary} />
                <Text style={styles.summarySlotTime}>{formatDateDisplay(appt.date)}</Text>
              </View>
              {appt.batchTime || appt.time ? (
                <View style={[styles.summarySlotRow, { marginTop: 4 }]}>
                  <Ionicons name="time-outline" size={13} color={COLORS.primary} />
                  <Text style={styles.summarySlotTime}>Arrival Window: {appt.batchTime || appt.time}</Text>
                </View>
              ) : null}
            </View>

            {/* Clinic Details */}
            <View style={styles.summaryClinicBox}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {matchedClinic?.logoUrl ? (
                  <Image source={{ uri: matchedClinic.logoUrl }} style={styles.summaryClinicLogo} />
                ) : (
                  <View style={styles.summaryClinicLogoFallback}>
                    <Text style={styles.summaryClinicLogoTxt}>{appt.clinicName.charAt(0) || 'C'}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.summaryClinicName}>{appt.clinicName}</Text>
                  <Text style={styles.summaryClinicAddr}>{appt.clinicAddress || matchedClinic?.address || 'Dermatology Clinic'}</Text>
                </View>
              </View>

              <View style={styles.summaryDivider} />

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View>
                  <Text style={styles.summaryFeeLabel}>Consultation Fee</Text>
                  <Text style={styles.summaryFeeAmount}>{dynamicFee}</Text>
                </View>
                {Boolean(appt.paymentStatus === 'paid' || appt.paymentReference) ? (
                  <View style={[styles.summaryPayableBadge, { backgroundColor: '#ecfdf5', borderColor: '#a7f3d0' }]}>
                    <Ionicons name="checkmark-circle" size={13} color="#059669" />
                    <Text style={[styles.summaryPayableText, { color: '#059669', fontWeight: '800' }]}>Paid Online</Text>
                  </View>
                ) : (
                  <View style={styles.summaryPayableBadge}>
                    <Ionicons name="checkmark-circle-outline" size={13} color={COLORS.textSecondary} />
                    <Text style={styles.summaryPayableText}>Payable at clinic</Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Payment Receipt Card */}
          {Boolean(appt.paymentStatus === 'paid' || appt.paymentReference) && (
            <View style={styles.summaryCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="receipt-outline" size={15} color="#059669" />
                  <Text style={[styles.summarySectionTitle, { marginBottom: 0 }]}>Online Payment Receipt</Text>
                </View>
                <View style={{ backgroundColor: '#ecfdf5', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#a7f3d0' }}>
                  <Text style={{ fontSize: 10, fontWeight: '900', color: '#059669' }}>PAID</Text>
                </View>
              </View>
              {appt.paymentReference && (
                <View style={styles.summaryInfoRow}>
                  <Text style={styles.summaryInfoKey}>Reference Number</Text>
                  <Text style={[styles.summaryInfoVal, { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontWeight: '800', color: COLORS.primary }]}>
                    {appt.paymentReference}
                  </Text>
                </View>
              )}
              {appt.paymentAmount != null && (
                <View style={styles.summaryInfoRow}>
                  <Text style={styles.summaryInfoKey}>Amount Paid</Text>
                  <Text style={[styles.summaryInfoVal, { fontWeight: '800', color: '#059669' }]}>
                    ₱{Number(appt.paymentAmount).toFixed(2)}
                  </Text>
                </View>
              )}
              {appt.paidAt && (
                <View style={styles.summaryInfoRow}>
                  <Text style={styles.summaryInfoKey}>Paid At</Text>
                  <Text style={styles.summaryInfoVal}>
                    {new Date(appt.paidAt).toLocaleDateString()} {new Date(appt.paidAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Patient Details & Clinical Findings */}
          <View style={styles.summaryCard}>
            <Text style={styles.summarySectionTitle}>Patient Information</Text>
            <View style={styles.summaryInfoRow}>
              <Text style={styles.summaryInfoKey}>Patient Name</Text>
              <Text style={styles.summaryInfoVal}>{appt.patientName || 'Patient'}</Text>
            </View>
            {appt.patientContact ? (
              <View style={styles.summaryInfoRow}>
                <Text style={styles.summaryInfoKey}>Contact</Text>
                <Text style={styles.summaryInfoVal}>{appt.patientContact}</Text>
              </View>
            ) : null}
            {appt.patientEmail ? (
              <View style={styles.summaryInfoRow}>
                <Text style={styles.summaryInfoKey}>Email</Text>
                <Text style={styles.summaryInfoVal}>{appt.patientEmail}</Text>
              </View>
            ) : null}
            {appt.patientAddress ? (
              <View style={styles.summaryInfoRow}>
                <Text style={styles.summaryInfoKey}>Address</Text>
                <Text style={styles.summaryInfoVal}>{appt.patientAddress}</Text>
              </View>
            ) : null}

            {appt.conditionName ? (
              <View style={[styles.summaryInfoRow, { marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#f1f5f9' }]}>
                <Text style={styles.summaryInfoKey}>AI Detected Condition</Text>
                <View style={styles.conditionTag}>
                  <Text style={styles.conditionTagTxt}>{appt.conditionName}</Text>
                </View>
              </View>
            ) : null}

            {appt.notes ? (
              <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f1f5f9' }}>
                <Text style={styles.summaryInfoKey}>Patient Symptoms / Notes</Text>
                <Text style={styles.summaryNotesTxt}>{appt.notes}</Text>
              </View>
            ) : null}

            {appt.clinicNote ? (
              <View style={{ marginTop: 8, backgroundColor: '#fff7ed', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#ffedd5' }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#c2410c' }}>Clinic Note</Text>
                <Text style={{ fontSize: 12, color: '#9a3412', marginTop: 2 }}>{appt.clinicNote}</Text>
              </View>
            ) : null}

            {appt.skinPhotoUri ? (
              <View style={{ marginTop: 12 }}>
                <Text style={[styles.summaryInfoKey, { marginBottom: 6 }]}>Attached Skin Photo</Text>
                <Image source={{ uri: appt.skinPhotoUri }} style={styles.summaryPhoto} resizeMode="cover" />
              </View>
            ) : null}
          </View>

          {/* Action Buttons */}
          {appt.status === 'pending' ? (
            <TouchableOpacity onPress={onCancel} style={styles.summaryCancelBtn}>
              <Ionicons name="close-circle-outline" size={16} color="#dc2626" />
              <Text style={styles.summaryCancelBtnTxt}>Cancel Appointment Request</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity onPress={onClose} style={styles.summaryCloseBtn}>
            <Text style={styles.summaryCloseBtnTxt}>Close</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // ── Interactive Calendar (Matches Web) ──
  calendarSection: {
    marginBottom: 16,
  },
  calendarHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  calendarSubText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  calendarSelectedBold: {
    fontWeight: '700',
    color: COLORS.primary,
  },
  monthNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  monthTitleText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text,
    minWidth: 72,
    textAlign: 'center',
  },
  monthNavBtn: {
    padding: 3,
  },
  monthNavBtnDisabled: {
    opacity: 0.35,
  },
  dutyPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fdf2f8',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fbcfe8',
    marginBottom: 10,
  },
  dutyPillText: {
    fontSize: 11,
    color: COLORS.text,
  },
  dutyPillBold: {
    fontWeight: '700',
    color: COLORS.primary,
  },
  calendarContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  weekdayRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    marginBottom: 6,
  },
  weekdayLabel: {
    width: 38,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textLight ?? '#94a3b8',
    textTransform: 'uppercase',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    rowGap: 4,
  },
  dayCell: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  dayCellOtherMonth: {
    opacity: 0.15,
  },
  dayCellAvailable: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  dayCellToday: {
    borderWidth: 1.5,
    borderColor: COLORS.primary,
  },
  dayCellSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  dayCellDisabled: {
    backgroundColor: '#f8fafc',
    opacity: 0.35,
  },
  dayNumText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
  },
  dayNumTextOtherMonth: {
    color: '#cbd5e1',
  },
  dayNumTextAvailable: {
    color: COLORS.text,
    fontWeight: '700',
  },
  dayNumTextToday: {
    color: COLORS.primary,
    fontWeight: '800',
  },
  dayNumTextSelected: {
    color: '#ffffff',
    fontWeight: '800',
  },
  dayNumTextDisabled: {
    color: '#94a3b8',
  },
  availableDot: {
    position: 'absolute',
    bottom: 3,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#10b981',
  },
  calendarLegendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    paddingTop: 10,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  legendText: {
    fontSize: 10,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  queueCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fdf2f8',
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#fbcfe8',
  },
  queueIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text,
  },
  queueNumber: {
    color: COLORS.primary,
    fontWeight: '800',
    fontSize: 13,
  },
  queueSub: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginTop: 1,
  },

  safe: { flex: 1, backgroundColor: '#F8FAFC' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 10,
    backgroundColor: '#fff',
  },
  headerAvatarCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#fce7f3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerWelcome: { fontSize: 11, color: COLORS.textSecondary, letterSpacing: 0.2 },
  headerName: { fontSize: 19, fontWeight: '800', color: COLORS.text },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primary,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  addBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Tabs
  tabContainer: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 14,
    padding: 3,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 12,
    gap: 6,
  },
  tabBtnActive: {
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 2,
  },
  tabTxt: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  tabTxtActive: { color: '#fff', fontWeight: '700' },
  tabCountBadge: {
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  tabCountBadgeActive: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  tabCountTxt: { fontSize: 11, fontWeight: '700', color: COLORS.textSecondary },
  tabCountTxtActive: { color: '#fff' },

  container: { flex: 1 },
  list: { paddingHorizontal: 16, paddingTop: 14, gap: 12 },

  empty: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    marginTop: 20,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fce7f3',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  emptySub: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 19, marginTop: 4, maxWidth: 280 },
  bookBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 18,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  bookBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Card
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'center' },
  cardClinicLogo: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#f1f5f9' },
  cardClinicLogoFallback: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#fce7f3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardClinicLogoTxt: { color: COLORS.primary, fontWeight: '800', fontSize: 17 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  clinicName: { fontSize: 15, fontWeight: '800', color: COLORS.text },
  verifiedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  verifiedTagTxt: { fontSize: 9, fontWeight: '700', color: '#059669' },
  statusBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusTxt: { fontSize: 11, fontWeight: '700' },
  doctorRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  doctorName: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  specialtyTag: { fontSize: 11, color: COLORS.textSecondary },

  // Appt Meta Row
  apptMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  apptMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  apptMetaText: { fontSize: 11, fontWeight: '600', color: '#334155' },

  // Stepper
  stepTracker: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  stepItem: { flex: 1, alignItems: 'center' },
  stepRow: { flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'center' },
  stepCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCircleActive: { backgroundColor: COLORS.primary },
  stepCircleInactive: { backgroundColor: '#e2e8f0' },
  stepCheck: { color: '#fff', fontSize: 11, fontWeight: '700' },
  stepNum: { color: '#94a3b8', fontSize: 10, fontWeight: '700' },
  stepLine: { flex: 1, height: 2 },
  stepLineActive: { backgroundColor: COLORS.primary },
  stepLineInactive: { backgroundColor: '#e2e8f0' },
  stepLabel: { fontSize: 9, color: COLORS.textSecondary, marginTop: 4, textAlign: 'center' },

  cardConditionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fdf2f8',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 8,
  },
  cardConditionLabel: { fontSize: 11, fontWeight: '600', color: COLORS.primary },
  cardConditionVal: { fontSize: 11, fontWeight: '700', color: '#831843' },
  reason: { fontSize: 12, color: COLORS.textSecondary, marginTop: 8, lineHeight: 17 },
  referralTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff7ed',
    padding: 8,
    borderRadius: 8,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  referralTagTxt: { fontSize: 11, color: '#9a3412', fontWeight: '500', flex: 1 },

  cardFooterRow: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  viewSummaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#fdf2f8',
  },
  viewSummaryTxt: { fontSize: 12, fontWeight: '700', color: COLORS.primary },
  cancelActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  cancelActionTxt: { fontSize: 12, fontWeight: '600', color: '#dc2626' },
  lockedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
  },
  lockedBadgeTxt: { fontSize: 11, color: '#64748b', fontWeight: '600' },

  // Modal Common
  modalSafe: { flex: 1, backgroundColor: '#fff' },
  modalHeader: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginBottom: 6 },
  backBtnTxt: { fontSize: 13, color: COLORS.textSecondary, fontWeight: '600' },
  modalHeading: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  modalSub: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  modalContent: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 40 },
  modalLabel: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginBottom: 8, marginTop: 14 },
  modalInput: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  textArea: { height: 85, textAlignVertical: 'top', paddingTop: 12 },

  // Clinic chips in booking modal
  clinicChip: {
    padding: 10,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
  },
  clinicChipSelected: {
    borderColor: COLORS.primary,
    backgroundColor: '#fdf2f8',
  },
  chipLogo: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#f1f5f9' },
  chipLogoFallback: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#fce7f3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLogoTxt: { color: COLORS.primary, fontWeight: '800', fontSize: 14 },
  clinicChipTitle: { fontSize: 13, fontWeight: '700', color: COLORS.text },
  clinicChipTitleSelected: { color: '#831843' },
  clinicChipSub: { fontSize: 11, color: COLORS.textSecondary, marginTop: 1 },

  // Doctor selection chips
  doctorChipGrid: { gap: 8 },
  doctorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
  },
  doctorChipSelected: {
    borderColor: COLORS.primary,
    backgroundColor: '#fdf2f8',
  },
  docAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#fce7f3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doctorChipName: { fontSize: 13, fontWeight: '700', color: COLORS.text },
  doctorChipNameSelected: { color: '#831843' },
  doctorChipSpec: { fontSize: 11, color: COLORS.textSecondary },
  doctorChipSpecSelected: { color: COLORS.primary },
  noDoctorsNotice: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
  },
  noDoctorsNoticeTxt: { fontSize: 12, color: COLORS.textSecondary, fontStyle: 'italic' },

  // Quick dates
  quickDateRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  quickDateChip: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
  },
  quickDateChipActive: { backgroundColor: '#fdf2f8', borderColor: COLORS.primary },
  quickDateLabel: { fontSize: 11, fontWeight: '700', color: COLORS.text },
  quickDateLabelActive: { color: COLORS.primary },
  quickDateSub: { fontSize: 9, color: COLORS.textSecondary, marginTop: 2 },
  quickDateSubActive: { color: COLORS.primary, fontWeight: '600' },

  // Arrival window / Time slots
  batchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  batchSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  batchSlotSelected: {
    borderColor: COLORS.primary,
    backgroundColor: '#fdf2f8',
  },
  batchSlotTxt: { fontSize: 12, fontWeight: '600', color: '#334155' },
  batchSlotTxtSelected: { color: COLORS.primary, fontWeight: '700' },

  // Photo Upload
  photoUploadBox: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 22,
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fdf2f8',
  },
  photoUploadIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fce7f3',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  photoUploadTxt: { fontSize: 13, fontWeight: '700', color: COLORS.primary },
  photoUploadSub: { fontSize: 11, color: COLORS.textSecondary },
  photoPreviewBox: { borderRadius: 16, overflow: 'hidden', position: 'relative' },
  photoPreview: { width: '100%', height: 180, borderRadius: 16 },
  photoRemoveBtn: { position: 'absolute', top: 8, right: 8, backgroundColor: '#fff', borderRadius: 13 },

  // Summary Card
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginTop: 18,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    marginBottom: 12,
  },
  summaryIconBadge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: '#fce7f3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryTitle: { fontSize: 14, fontWeight: '800', color: COLORS.text },
  summaryModeBadge: {
    backgroundColor: '#fdf2f8',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#fbcfe8',
  },
  summaryModeTxt: { fontSize: 10, fontWeight: '700', color: COLORS.primary },

  summarySlotBox: {
    backgroundColor: '#fdf2f8',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fce7f3',
    marginBottom: 12,
  },
  summarySlotLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  summaryDurationBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  summaryDurationTxt: { color: '#fff', fontSize: 10, fontWeight: '700' },
  summaryDoctorName: { fontSize: 14, fontWeight: '800', color: COLORS.text, marginTop: 4 },
  summaryDoctorSpec: { fontSize: 11, color: COLORS.primary, fontWeight: '600', marginTop: 1 },
  summarySlotRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  summarySlotTime: { fontSize: 12, color: COLORS.text },

  summaryClinicBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  summaryClinicLogo: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#f1f5f9' },
  summaryClinicLogoFallback: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#fce7f3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryClinicLogoTxt: { color: COLORS.primary, fontWeight: '800', fontSize: 14 },
  summaryClinicName: { fontSize: 13, fontWeight: '700', color: COLORS.text },
  summaryClinicAddr: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  summaryDivider: { height: 1, backgroundColor: '#e2e8f0', marginVertical: 10 },
  summaryHoursText: { fontSize: 11, color: COLORS.textSecondary },
  summaryAppointmentOnly: { fontSize: 10, color: COLORS.textSecondary, fontStyle: 'italic', marginTop: 2 },
  summaryFeeLabel: { fontSize: 10, fontWeight: '700', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryFeeAmount: { fontSize: 16, fontWeight: '800', color: COLORS.text, marginTop: 1 },
  summaryPayableBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  summaryPayableText: { fontSize: 11, color: COLORS.textSecondary },

  sendBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 3,
  },
  sendBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  sendNote: { fontSize: 11, color: COLORS.textSecondary, textAlign: 'center', marginTop: 10 },

  // Summary Modal specific
  summaryModalHeader: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  summaryModalHeading: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  summaryModalSub: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  summaryModalContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },
  summaryProgressCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  summarySectionTitle: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginBottom: 10 },
  summaryInfoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  summaryInfoKey: { fontSize: 12, color: COLORS.textSecondary },
  summaryInfoVal: { fontSize: 12, fontWeight: '700', color: COLORS.text },
  conditionTag: {
    backgroundColor: '#fdf2f8',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#fce7f3',
  },
  conditionTagTxt: { fontSize: 11, fontWeight: '700', color: COLORS.primary },
  summaryNotesTxt: { fontSize: 12, color: COLORS.text, lineHeight: 18, marginTop: 4 },
  summaryPhoto: { width: '100%', height: 160, borderRadius: 14, marginTop: 4 },
  summaryCancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    marginTop: 10,
    marginBottom: 10,
  },
  summaryCancelBtnTxt: { fontSize: 13, fontWeight: '700', color: '#dc2626' },
  summaryCloseBtn: { paddingVertical: 14, borderRadius: 14, backgroundColor: '#f1f5f9', alignItems: 'center', marginTop: 4 },
  summaryCloseBtnTxt: { fontSize: 14, fontWeight: '700', color: COLORS.text },
});
