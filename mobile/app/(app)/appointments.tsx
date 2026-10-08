import { useState, useCallback, useEffect } from 'react';
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
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
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
  syncAppointmentNotifications,
} from '@/lib/store';
import type { Appointment, PatientAccount, ClinicRecord, ClinicDoctor } from '@/lib/store';

type Tab = 'upcoming' | 'past';

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
  const params = useLocalSearchParams<{ openBooking?: string; clinicId?: string }>();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [user, setUser] = useState<PatientAccount | null>(null);
  const [showBooking, setShowBooking] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (params.openBooking === '1') {
      setShowBooking(true);
    }
  }, [params.openBooking]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  async function loadData() {
    setLoading(true);
    try {
      const u = await getCurrentUser();
      setUser(u);
      if (!u) return;
      const appts = await getAppointments(u.id);
      setAppointments(appts);
      await syncAppointmentNotifications(u.id, appts);
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
        <View style={{ flex: 1 }}>
          <Text style={styles.headerWelcome}>Your Schedule</Text>
          <Text style={styles.headerName}>Appointments</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowBooking(true)}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.addBtnTxt}>Book</Text>
        </TouchableOpacity>
      </View>

      {/* ── Tabs ── */}
      <View style={styles.tabRow}>
        {(['upcoming', 'past'] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabTxt, tab === t && styles.tabTxtActive]}>
              {t === 'upcoming' ? `Upcoming (${upcomingAppts.length})` : `Past (${pastAppts.length})`}
            </Text>
          </TouchableOpacity>
        ))}
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
                {tab === 'upcoming' ? 'No Upcoming Appointments' : 'No Past Appointments'}
              </Text>
              <Text style={styles.emptySub}>
                {tab === 'upcoming'
                  ? 'Book a consultation with a dermatologist to get started.'
                  : 'Your completed and cancelled appointments will show up here.'}
              </Text>
              {tab === 'upcoming' && (
                <TouchableOpacity style={styles.bookBtn} onPress={() => setShowBooking(true)}>
                  <Text style={styles.bookBtnTxt}>Book Appointment</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            (tab === 'upcoming' ? upcomingAppts : pastAppts).map((appt) => (
              <AppointmentCard
                key={appt.id}
                appt={appt}
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
        initialClinicId={params.clinicId}
        onClose={() => setShowBooking(false)}
        onSaved={() => {
          setShowBooking(false);
          loadData();
        }}
      />
    </SafeAreaView>
  );
}

function AppointmentCard({
  appt,
  onCancel,
}: {
  appt: Appointment;
  onCancel: () => void;
}) {
  const sc = STATUS_COLORS[appt.status] ?? STATUS_COLORS.pending;

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
    <View style={styles.card}>
      <View style={styles.cardTopRow}>
        <View style={[styles.listIconWrap, { backgroundColor: '#2563eb15' }]}>
          <Ionicons name="medkit-outline" size={20} color="#2563eb" />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={styles.cardHeader}>
            <Text style={styles.clinicName}>{appt.clinicName}</Text>
            <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.statusTxt, { color: sc.text }]}>{sc.label}</Text>
            </View>
          </View>
          {appt.doctorName ? <Text style={styles.doctorName}>{appt.doctorName}</Text> : null}
          {appt.specialty ? <Text style={styles.specialty}>{appt.specialty}</Text> : null}
        </View>
      </View>

      <View style={styles.apptMeta}>
        {appt.date ? (
          <View style={styles.apptMetaItem}>
            <Ionicons name="calendar-outline" size={11} color={COLORS.textSecondary} />
            <Text style={styles.apptMetaText}>{appt.date}</Text>
          </View>
        ) : null}
        {appt.batchTime || appt.time ? (
          <View style={styles.apptMetaItem}>
            <Ionicons name="time-outline" size={11} color={COLORS.textSecondary} />
            <Text style={styles.apptMetaText}>{appt.batchTime || appt.time}</Text>
          </View>
        ) : null}
        {appt.queueNumber ? (
          <View style={styles.apptMetaItem}>
            <Ionicons name="people-outline" size={11} color={COLORS.primary} />
            <Text style={[styles.apptMetaText, { color: COLORS.primary, fontWeight: '700' }]}>
              Queue #{appt.queueNumber}
            </Text>
          </View>
        ) : null}
        <View style={styles.apptMetaItem}>
          <Ionicons name="location-outline" size={11} color={COLORS.textSecondary} />
          <Text style={styles.apptMetaText}>In-Person</Text>
        </View>
      </View>

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
              <Text style={[styles.stepLabel, idx <= currentStep && { color: COLORS.primary, fontWeight: '600' }]}>
                {step}
              </Text>
            </View>
          ))}
        </View>
      )}

      {appt.notes ? (
        <Text style={styles.reason} numberOfLines={2}>
          Symptoms/Notes: {appt.notes}
        </Text>
      ) : null}
      {appt.clinicNote ? (
        <View style={styles.referralTag}>
          <Text style={styles.referralTagTxt}>Clinic Note: {appt.clinicNote}</Text>
        </View>
      ) : null}

      {/* Cancellation controls */}
      <View style={{ marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9', flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }}>
        {appt.status === 'pending' ? (
          <TouchableOpacity onPress={onCancel} style={styles.cancelActionBtn}>
            <Ionicons name="close-circle-outline" size={14} color="#dc2626" />
            <Text style={styles.cancelActionTxt}>Cancel Request</Text>
          </TouchableOpacity>
        ) : isFinalized ? (
          <View style={styles.lockedBadge}>
            <Ionicons name="lock-closed-outline" size={12} color="#64748b" />
            <Text style={styles.lockedBadgeTxt}>Finalized schedule (cancellation closed)</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function BookingModal({
  visible,
  user,
  initialClinicId,
  onClose,
  onSaved,
}: {
  visible: boolean;
  user: PatientAccount | null;
  initialClinicId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [clinics, setClinics] = useState<ClinicRecord[]>([]);
  const [selectedClinic, setSelectedClinic] = useState<ClinicRecord | null>(null);
  const [selectedDoctor, setSelectedDoctor] = useState<ClinicDoctor | null>(null);
  const [selectedBatch, setSelectedBatch] = useState(BATCH_SLOTS[0]);
  const [dateStr, setDateStr] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [notes, setNotes] = useState('');
  const [patientName, setPatientName] = useState('');
  const [patientEmail, setPatientEmail] = useState('');
  const [patientAddress, setPatientAddress] = useState('');
  const [patientContact, setPatientContact] = useState('');
  const [saving, setSaving] = useState(false);
  const [aiConditionName, setAiConditionName] = useState('');
  const [skinPhotoUri, setSkinPhotoUri] = useState<string | null>(null);

  // Load clinics from live Supabase
  useEffect(() => {
    if (visible) {
      getClinics().then((loaded) => {
        setClinics(loaded);
        if (loaded.length > 0) {
          const match = initialClinicId ? loaded.find((c) => String(c.id) === String(initialClinicId)) : loaded[0];
          const activeClinic = match || loaded[0];
          setSelectedClinic(activeClinic);
          setSelectedDoctor(activeClinic.doctors?.[0] || null);
        }
      });

      if (user) {
        setPatientName(user.fullName || '');
        setPatientEmail(user.email || '');
        setPatientAddress(user.address || '');
        setPatientContact(user.phone || '');
      }
    }
  }, [visible, initialClinicId, user]);

  async function handlePickImage(useCamera: boolean) {
    if (useCamera) {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow camera access to take a photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.7,
      });
      if (!result.canceled && result.assets.length > 0) {
        setSkinPhotoUri(result.assets[0].uri);
      }
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow gallery access to select a photo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.7,
      });
      if (!result.canceled && result.assets.length > 0) {
        setSkinPhotoUri(result.assets[0].uri);
      }
    }
  }

  function showPhotoOptions() {
    Alert.alert('Add Skin Photo', 'Choose an option', [
      { text: 'Take Photo with Camera', onPress: () => handlePickImage(true) },
      { text: 'Choose from Gallery', onPress: () => handlePickImage(false) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function handleBook() {
    if (!user) return;
    if (!selectedClinic) {
      Alert.alert('Please select a clinic');
      return;
    }
    if (!skinPhotoUri) {
      Alert.alert('Photo Required', 'Please attach a photo of your skin condition.');
      return;
    }
    if (!dateStr.trim()) {
      Alert.alert('Date Required', 'Please enter a valid consultation date.');
      return;
    }

    setSaving(true);
    try {
      await saveAppointment({
        userId: user.id,
        clinicId: selectedClinic.id,
        clinicName: selectedClinic.name,
        clinicAddress: selectedClinic.address,
        assignedDoctorId: selectedDoctor?.id,
        doctorName: selectedDoctor?.name,
        specialty: selectedDoctor?.specialization,
        consultationType: 'face-to-face',
        patientName: patientName.trim() || user.fullName,
        patientEmail: patientEmail.trim() || user.email,
        patientAddress: patientAddress.trim() || undefined,
        patientContact: patientContact.trim() || undefined,
        date: dateStr.trim(),
        time: selectedBatch.batchTime,
        batchTime: selectedBatch.label,
        queueNumber: 1,
        checkInStatus: 'scheduled',
        status: 'pending',
        notes: notes.trim() || undefined,
        conditionName: aiConditionName.trim() || undefined,
        skinPhotoUri: skinPhotoUri || undefined,
      });

      await addAppNotification(user.id, {
        type: 'appointment',
        title: 'Appointment Request Sent',
        message: `Your appointment request for ${selectedClinic.name} (${selectedBatch.label}) has been submitted.`,
        userId: user.id,
      });

      Alert.alert('Appointment Submitted!', 'Your booking is pending clinic review. You can track its live status here.');
      onSaved();
    } catch (err: any) {
      Alert.alert('Booking Error', err?.message ?? 'Failed to submit appointment.');
    } finally {
      setSaving(false);
    }
  }

  if (!selectedClinic) {
    return null;
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, backgroundColor: '#fff' }}>
            <TouchableOpacity onPress={onClose} style={styles.backBtn}>
              <Ionicons name="chevron-back" size={18} color={COLORS.text} />
              <Text style={styles.backBtnTxt}>Back</Text>
            </TouchableOpacity>

            <Text style={styles.modalHeading}>Book Appointment</Text>
            <Text style={styles.modalSub}>Select clinic, doctor, and arrival window</Text>

            {/* Clinic chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 14, marginBottom: 8 }}>
              {clinics.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.clinicChip, selectedClinic.id === c.id && styles.clinicChipActive]}
                  onPress={() => {
                    setSelectedClinic(c);
                    setSelectedDoctor(c.doctors?.[0] || null);
                  }}
                >
                  <Text style={[styles.clinicChipTxt, selectedClinic.id === c.id && styles.clinicChipTxtActive]}>
                    {c.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.clinicInfoCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.clinicInfoLabel}>Selected Clinic</Text>
                <Text style={styles.clinicInfoName} numberOfLines={1}>{selectedClinic.name}</Text>
                <Text style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 2 }}>{selectedClinic.address}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', marginLeft: 12 }}>
                <Text style={styles.clinicInfoLabel}>Mode</Text>
                <View style={styles.modePill}>
                  <Text style={styles.modePillTxt}>In-Person</Text>
                </View>
              </View>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            {/* Doctor Selection */}
            {selectedClinic.doctors && selectedClinic.doctors.length > 0 && (
              <View>
                <Text style={styles.modalLabel}>Preferred Dermatologist</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }}>
                  {selectedClinic.doctors.map((doc, idx) => (
                    <TouchableOpacity
                      key={doc.id || idx}
                      style={[
                        styles.doctorChip,
                        selectedDoctor?.id === doc.id && styles.doctorChipActive,
                      ]}
                      onPress={() => setSelectedDoctor(doc)}
                    >
                      <Ionicons
                        name="person-circle-outline"
                        size={16}
                        color={selectedDoctor?.id === doc.id ? '#fff' : COLORS.primary}
                      />
                      <Text
                        style={[
                          styles.doctorChipTxt,
                          selectedDoctor?.id === doc.id && styles.doctorChipTxtActive,
                        ]}
                      >
                        {doc.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Date Selection */}
            <Text style={styles.modalLabel}>Consultation Date (YYYY-MM-DD) *</Text>
            <TextInput
              style={styles.modalInput}
              value={dateStr}
              onChangeText={setDateStr}
              placeholder="e.g. 2026-10-15"
              placeholderTextColor={COLORS.textLight}
            />

            {/* Hourly Batch Window Selection */}
            <Text style={styles.modalLabel}>Arrival Time Window *</Text>
            <View style={styles.batchGrid}>
              {BATCH_SLOTS.map((b) => {
                const isSelected = selectedBatch.batchTime === b.batchTime;
                return (
                  <TouchableOpacity
                    key={b.batchTime}
                    style={[styles.batchCard, isSelected && styles.batchCardActive]}
                    onPress={() => setSelectedBatch(b)}
                  >
                    <Text style={[styles.batchCardTxt, isSelected && styles.batchCardTxtActive]}>
                      {b.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Patient Information Fields */}
            <Text style={styles.modalLabel}>Patient Details</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Full Name *"
                  placeholderTextColor={COLORS.textLight}
                  value={patientName}
                  onChangeText={setPatientName}
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Email"
                  placeholderTextColor={COLORS.textLight}
                  value={patientEmail}
                  onChangeText={setPatientEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
              <View style={{ flex: 1 }}>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Contact Number *"
                  placeholderTextColor={COLORS.textLight}
                  value={patientContact}
                  onChangeText={setPatientContact}
                  keyboardType="phone-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Address"
                  placeholderTextColor={COLORS.textLight}
                  value={patientAddress}
                  onChangeText={setPatientAddress}
                />
              </View>
            </View>

            {/* Skin Photo Attachment */}
            <Text style={styles.modalLabel}>
              Skin Photo Attachment <Text style={{ color: '#ef4444' }}>*</Text>
            </Text>
            {skinPhotoUri ? (
              <View style={styles.photoPreviewBox}>
                <Image source={{ uri: skinPhotoUri }} style={styles.photoPreview} resizeMode="cover" />
                <TouchableOpacity style={styles.photoRemoveBtn} onPress={() => setSkinPhotoUri(null)}>
                  <Ionicons name="close-circle" size={24} color="#ef4444" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.photoUploadBox} onPress={showPhotoOptions} activeOpacity={0.8}>
                <Ionicons name="camera-outline" size={28} color={COLORS.primary} />
                <Text style={styles.photoUploadTxt}>Tap to attach photo</Text>
                <Text style={styles.photoUploadSub}>Camera or Photo Library</Text>
              </TouchableOpacity>
            )}

            {/* AI Diagnosis Result Note */}
            <View style={styles.aiBox}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Ionicons name="scan-outline" size={18} color={COLORS.primary} />
                <Text style={styles.aiBoxTitle}>AI Skin Condition (Optional)</Text>
              </View>
              <TextInput
                style={[styles.modalInput, { marginTop: 6, backgroundColor: '#fff' }]}
                placeholder="Condition name from DermAI Scan (optional)"
                placeholderTextColor={COLORS.textLight}
                value={aiConditionName}
                onChangeText={setAiConditionName}
              />
            </View>

            {/* Symptoms & Notes */}
            <Text style={styles.modalLabel}>Consultation Notes / Symptoms</Text>
            <TextInput
              style={[styles.modalInput, styles.textArea]}
              placeholder="Describe your symptoms, how long you've had the condition, and any current treatments..."
              placeholderTextColor={COLORS.textLight}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={4}
            />

            <TouchableOpacity
              style={[styles.sendBtn, saving && { opacity: 0.7 }]}
              onPress={handleBook}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.sendBtnTxt}>Confirm & Submit Request</Text>
              )}
            </TouchableOpacity>
            <Text style={styles.sendNote}>
              Your appointment will be sent directly to {selectedClinic.name}&apos;s live schedule.
            </Text>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F8FA' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: '#fff',
  },
  headerWelcome: { fontSize: 12, color: COLORS.textSecondary, fontWeight: '500' },
  headerName: { fontSize: 20, fontWeight: '800', color: COLORS.text },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primary,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },

  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 8,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
  },
  tabBtnActive: { backgroundColor: COLORS.primary },
  tabTxt: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  tabTxtActive: { color: '#fff', fontWeight: '700' },

  container: { flex: 1 },
  list: { paddingHorizontal: 20, paddingTop: 16, gap: 14 },

  empty: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 32,
    alignItems: 'center',
    marginTop: 20,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primaryLight ?? '#e6f4ea',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  emptySub: { fontSize: 12, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 18, marginTop: 2 },
  bookBtn: { backgroundColor: COLORS.primary, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12, marginTop: 14 },
  bookBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Card
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start' },
  listIconWrap: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  clinicName: { fontSize: 14, fontWeight: '700', color: COLORS.text, flex: 1, marginRight: 8 },
  statusBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  statusTxt: { fontSize: 10, fontWeight: '700' },
  doctorName: { fontSize: 12, color: COLORS.text, fontWeight: '600', marginTop: 3 },
  specialty: { fontSize: 11, color: COLORS.primary, marginTop: 1 },

  apptMeta: { flexDirection: 'row', gap: 12, marginTop: 12, flexWrap: 'wrap' },
  apptMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  apptMetaText: { fontSize: 11, color: COLORS.textSecondary },

  reason: { fontSize: 12, color: COLORS.textSecondary, marginTop: 10 },
  referralTag: {
    marginTop: 8,
    backgroundColor: '#fff7ed',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  referralTagTxt: { fontSize: 11, color: '#c2410c' },

  cancelActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#fef2f2',
  },
  cancelActionTxt: { fontSize: 12, fontWeight: '700', color: '#dc2626' },
  lockedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
  },
  lockedBadgeTxt: { fontSize: 11, color: '#64748b', fontWeight: '500' },

  // Step tracker
  stepTracker: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    marginBottom: 2,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F0F1F5',
  },
  stepItem: { alignItems: 'center', flex: 1 },
  stepRow: { flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'center' },
  stepCircle: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stepCircleActive: { backgroundColor: COLORS.primary },
  stepCircleInactive: { backgroundColor: '#EDEEF2' },
  stepCheck: { color: '#fff', fontSize: 12, fontWeight: '700' },
  stepNum: { color: COLORS.textLight, fontSize: 11, fontWeight: '600' },
  stepLine: { flex: 1, height: 2, marginHorizontal: 2 },
  stepLineActive: { backgroundColor: COLORS.primary },
  stepLineInactive: { backgroundColor: '#EDEEF2' },
  stepLabel: { fontSize: 9, color: COLORS.textSecondary, marginTop: 4, textAlign: 'center' },

  // Modal
  modalSafe: { flex: 1, backgroundColor: '#F7F8FA' },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', paddingVertical: 4, marginBottom: 8 },
  backBtnTxt: { color: COLORS.text, fontWeight: '600', fontSize: 15 },
  modalHeading: { fontSize: 20, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  modalSub: { color: COLORS.primary, fontWeight: '600', fontSize: 13 },

  clinicChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: '#fff',
    borderRadius: 999,
    marginRight: 8,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  clinicChipActive: { backgroundColor: COLORS.primary },
  clinicChipTxt: { fontSize: 13, color: COLORS.text },
  clinicChipTxtActive: { color: '#fff', fontWeight: '600' },

  doctorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  doctorChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  doctorChipTxt: { fontSize: 12, color: COLORS.text, fontWeight: '600' },
  doctorChipTxtActive: { color: '#fff' },

  batchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  batchCard: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  batchCardActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  batchCardTxt: { fontSize: 12, color: COLORS.text, fontWeight: '600' },
  batchCardTxtActive: { color: '#fff' },

  clinicInfoCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  clinicInfoLabel: {
    color: COLORS.primary,
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  clinicInfoName: { fontWeight: '800', fontSize: 14, color: COLORS.text },
  modePill: { backgroundColor: COLORS.primary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  modePillTxt: { color: '#fff', fontWeight: '700', fontSize: 12 },

  modalContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },
  modalLabel: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 8, marginTop: 14 },
  modalInput: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  textArea: { height: 90, textAlignVertical: 'top', paddingTop: 12 },
  sendBtn: { backgroundColor: COLORS.primary, borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  sendBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
  sendNote: { fontSize: 12, color: COLORS.textSecondary, textAlign: 'center', marginTop: 10 },

  photoUploadBox: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 20,
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primaryLight ?? '#e6f4ea',
  },
  photoUploadTxt: { fontSize: 14, fontWeight: '700', color: COLORS.primary },
  photoUploadSub: { fontSize: 12, color: COLORS.textSecondary },
  photoPreviewBox: { borderRadius: 16, overflow: 'hidden', position: 'relative' },
  photoPreview: { width: '100%', height: 180, borderRadius: 16 },
  photoRemoveBtn: { position: 'absolute', top: 8, right: 8, backgroundColor: '#fff', borderRadius: 12 },

  aiBox: { backgroundColor: '#fff0fa', borderRadius: 16, padding: 14, marginTop: 14 },
  aiBoxTitle: { fontSize: 14, fontWeight: '700', color: COLORS.text },
});