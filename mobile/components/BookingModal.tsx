import React, { useState, useEffect, useMemo } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import LiveCameraModal from './LiveCameraModal';
import { COLORS } from '@/lib/constants';
import {
  getCurrentUser,
  getAppointments,
  getClinics,
  getSkinHistory,
  saveAppointment,
  recordUserPayment,
  generatePaymentReference,
  addAppNotification,
  getOccupiedSlotsForDate,
  acquireAppointmentSlotHold,
  cancelAppointmentSlotHold,
  releaseAppointmentHoldSafely,
  supabase,
  type Appointment,
  type PatientAccount,
  type ClinicRecord,
  type ClinicDoctor,
  type ScanResult,
} from '@/lib/store';
import {
  parseDoctorSchedule,
  generateDaySlotsForDoctor,
  isDoctorOnDutyOnDay as isDoctorOnDutyScheduling,
  formatTime12h,
  type ConsultationSlot,
} from '@/lib/scheduling';
import { processPayMongoBookingPayment, PayMongoPaymentError } from '@/lib/paymongo';
import { logAuditEvent } from '@/lib/auditLogger';

const GCASH_LOGO = require('@/assets/images/gcash.png');
const MAYA_LOGO = require('@/assets/images/maya.png');

export function normalizeDayName(day: string): string {
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

function DoctorAvatarImage({ uri, name, size = 36 }: { uri?: string; name: string; size?: number }) {
  const [loadError, setLoadError] = useState(false);
  const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'Doctor')}&background=fce7f3&color=be185d&bold=true`;
  const imageSource = (!loadError && uri) ? { uri } : { uri: fallbackUrl };

  return (
    <Image
      source={imageSource}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      onError={() => setLoadError(true)}
    />
  );
}

export function isDoctorOnDutyOnDay(
  doctor: ClinicDoctor | null | undefined,
  dayOfWeek: string,
  clinicSchedule?: { openTime?: string; closeTime?: string; operatingDays?: string } | null
): boolean {
  return isDoctorOnDutyScheduling(doctor, dayOfWeek, clinicSchedule);
}

export function formatDateDisplay(dStr?: string): string {
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

export const FILIPINO_ALIASES: Record<string, string> = {
  'Acne': 'Taghiyawat',
  'Acne Vulgaris': 'Karaniwang Taghiyawat',
  'Eczema': 'Eksema / Pangangati',
  'Atopic Dermatitis': 'Eksema sa Balat',
  'Melasma': 'Pekas / Maitim na Balat',
  'Psoriasis': 'Psoriasis / Kaliskis na Balat',
  'Tinea': 'Buni / Alipunga',
  'Contact Dermatitis': 'Alerdyi sa Balat',
  'Vitiligo': 'Pagputing balat',
  'Rosacea': 'Pamumula ng mukha',
};

export function formatConfidenceDisplay(rawVal: any): string {
  if (rawVal === undefined || rawVal === null || rawVal === '') return '98.0%';
  const num = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal));
  if (isNaN(num)) return '98.0%';
  const pct = num <= 1.0 ? num * 100 : num;
  const clamped = Math.max(0, Math.min(100, pct));
  return `${clamped.toFixed(1)}%`;
}

export function computeAge(birthdateStr?: string): number | null {
  if (!birthdateStr) return null;
  try {
    const b = new Date(birthdateStr);
    if (isNaN(b.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - b.getFullYear();
    const m = today.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < b.getDate())) {
      age--;
    }
    return age >= 0 ? age : null;
  } catch {
    return null;
  }
}

function findMatchingClinic(
  targetId: string | number | undefined,
  list: ClinicRecord[] | null | undefined
): ClinicRecord | null {
  if (!targetId || !list || list.length === 0) return list?.[0] || null;
  const strId = String(targetId).toLowerCase().trim();
  const direct = list.find((c) => String(c.id).toLowerCase().trim() === strId);
  if (direct) return direct;
  return list[0] || null;
}

export interface BookingModalProps {
  visible: boolean;
  user: PatientAccount | null;
  clinics: ClinicRecord[];
  initialClinicId?: string | number;
  existingAppointments?: Appointment[];
  onClose: () => void;
  onSaved: () => void;
}

export function BookingModal({
  visible,
  user,
  clinics,
  initialClinicId,
  existingAppointments,
  onClose,
  onSaved,
}: BookingModalProps) {
  // 3-Step Flow:
  // Step 1: Patient Profile & Skin Concern Photo
  // Step 2: Choose Schedule & Doctor
  // Step 3: Online Consultation Payment (GCash / Maya)
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [selectedClinic, setSelectedClinic] = useState<ClinicRecord | null>(() =>
    findMatchingClinic(initialClinicId, clinics)
  );
  const [selectedDoctor, setSelectedDoctor] = useState<ClinicDoctor | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<{ batchTime: string; label: string }>({ batchTime: '', label: '' });
  const [dateStr, setDateStr] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });

  const [currentUser, setCurrentUser] = useState<PatientAccount | null>(user || null);
  const [occupiedSlots, setOccupiedSlots] = useState<any[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [clinicScheduleSettings, setClinicScheduleSettings] = useState<{
    openTime: string;
    closeTime: string;
    slotDurationMinutes: number;
    operatingHours: { day_of_week: string; open_time: string; close_time: string }[];
  } | null>(null);

  // Fetch dynamic operating hours & slot duration from Supabase for the selected clinic
  useEffect(() => {
    let isCancelled = false;
    async function fetchClinicSchedule() {
      if (!selectedClinic?.id) return;
      try {
        const { data: clinicData } = await supabase
          .from('clinic')
          .select(`
            id,
            opening_time,
            closing_time,
            slot_duration_minutes,
            clinic_operating_hours (
              day_of_week,
              open_time,
              close_time
            )
          `)
          .eq('id', selectedClinic.id)
          .maybeSingle();

        if (isCancelled || !clinicData) return;

        const opHours = Array.isArray(clinicData.clinic_operating_hours)
          ? clinicData.clinic_operating_hours
          : selectedClinic.operatingHours || [];

        setClinicScheduleSettings({
          openTime: clinicData.opening_time ? String(clinicData.opening_time).slice(0, 5) : selectedClinic.openTime || '08:00',
          closeTime: clinicData.closing_time ? String(clinicData.closing_time).slice(0, 5) : selectedClinic.closeTime || '17:00',
          slotDurationMinutes: Number(clinicData.slot_duration_minutes) || selectedClinic.defaultSlotIntervalMinutes || 20,
          operatingHours: opHours,
        });
      } catch (err) {
        console.warn('[BookingModal] fetchClinicSchedule notice:', err);
      }
    }
    fetchClinicSchedule();
    return () => {
      isCancelled = true;
    };
  }, [selectedClinic?.id]);

  // Fetch dynamic doctor duty schedule from Supabase for the selected doctor
  useEffect(() => {
    let isCancelled = false;
    async function fetchDoctorSchedule() {
      if (!selectedClinic?.id || !selectedDoctor?.id) return;
      try {
        const { data: docData } = await supabase
          .from('clinic_doctor')
          .select(`
            doctor_id,
            duty_days,
            duty_start_time,
            duty_end_time,
            duty_schedule,
            status
          `)
          .eq('clinic_id', selectedClinic.id)
          .eq('doctor_id', selectedDoctor.id)
          .maybeSingle();

        if (isCancelled || !docData) return;

        setSelectedDoctor((prev) => {
          if (!prev || prev.id !== docData.doctor_id) return prev;
          return {
            ...prev,
            dutyDays: docData.duty_days || prev.dutyDays,
            dutyStartTime: docData.duty_start_time ? String(docData.duty_start_time).slice(0, 5) : prev.dutyStartTime,
            dutyEndTime: docData.duty_end_time ? String(docData.duty_end_time).slice(0, 5) : prev.dutyEndTime,
            dutySchedule: docData.duty_schedule || prev.dutySchedule,
          };
        });
      } catch (err) {
        console.warn('[BookingModal] fetchDoctorSchedule notice:', err);
      }
    }
    fetchDoctorSchedule();
    return () => {
      isCancelled = true;
    };
  }, [selectedClinic?.id, selectedDoctor?.id]);

  // Fetch dynamic occupied & booked slots from Supabase
  useEffect(() => {
    let isCancelled = false;
    async function fetchSlots() {
      if (!selectedClinic?.id || !dateStr) {
        setOccupiedSlots([]);
        return;
      }
      setLoadingSlots(true);
      try {
        // 1. RPC slot holds
        const occ = await getOccupiedSlotsForDate(
          selectedClinic.id,
          dateStr,
          selectedDoctor?.id
        );

        // 2. Direct query to patient_appointment table for booked appointments
        let query = supabase
          .from('patient_appointment')
          .select('appointment_id, time, batch_time, assigned_doctor_id, status')
          .eq('clinic_id', selectedClinic.id)
          .eq('date', dateStr)
          .not('status', 'in', '("cancelled","declined","rejected")');

        if (selectedDoctor?.id) {
          query = query.eq('assigned_doctor_id', selectedDoctor.id);
        }

        const { data: bookedAppts, error: apptErr } = await query;
        if (apptErr) {
          console.warn('[BookingModal] patient_appointment query notice:', apptErr.message);
        }

        const combinedOccupied = [
          ...(Array.isArray(occ) ? occ : []),
          ...(Array.isArray(bookedAppts) ? bookedAppts : []),
        ];

        if (!isCancelled) setOccupiedSlots(combinedOccupied);
      } catch (err) {
        if (!isCancelled) setOccupiedSlots([]);
      } finally {
        if (!isCancelled) setLoadingSlots(false);
      }
    }
    fetchSlots();
    return () => {
      isCancelled = true;
    };
  }, [selectedClinic?.id, selectedDoctor?.id, dateStr]);

  // Dynamic Time Slot Generator directly derived from clinic settings, doctor availability & appointments
  const computedDaySlots = useMemo<ConsultationSlot[]>(() => {
    if (!selectedDoctor || !dateStr || !selectedClinic) {
      return [];
    }

    const [y, m, d] = dateStr.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'long' });

    // Determine clinic operating hours for this specific day of week
    const opHoursList = clinicScheduleSettings?.operatingHours || selectedClinic.operatingHours || [];
    const daySchedule = opHoursList.find(
      (h) => normalizeDayName(h.day_of_week) === normalizeDayName(dayOfWeek)
    );

    const clinicOpenStr = daySchedule?.open_time
      ? String(daySchedule.open_time).slice(0, 5)
      : clinicScheduleSettings?.openTime || selectedClinic.openTime || '08:00';

    const clinicCloseStr = daySchedule?.close_time
      ? String(daySchedule.close_time).slice(0, 5)
      : clinicScheduleSettings?.closeTime || selectedClinic.closeTime || '17:00';

    const slotInterval =
      clinicScheduleSettings?.slotDurationMinutes ||
      selectedClinic.defaultSlotIntervalMinutes ||
      20;

    // Filter out dates where the doctor is off-duty
    const isDoctorOnDuty = isDoctorOnDutyOnDay(selectedDoctor, dayOfWeek, {
      openTime: clinicOpenStr,
      closeTime: clinicCloseStr,
    });

    if (!isDoctorOnDuty) {
      return [];
    }

    const docWeeklySchedule = parseDoctorSchedule(
      selectedDoctor.dutySchedule,
      selectedDoctor.dutyDays,
      selectedDoctor.dutyStartTime || clinicOpenStr,
      selectedDoctor.dutyEndTime || clinicCloseStr
    );

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    const currentMinutesNow = today.getHours() * 60 + today.getMinutes();

    const groups = generateDaySlotsForDoctor({
      doctorSchedule: docWeeklySchedule,
      dayOfWeek,
      doctorId: selectedDoctor.id,
      clinicDefaults: {
        openTime: clinicOpenStr,
        closeTime: clinicCloseStr,
        defaultSlotIntervalMinutes: slotInterval,
      },
      existingAppointments: occupiedSlots,
      isToday,
      currentMinutesNow,
    });

    return groups.flatMap((g) => g.slots);
  }, [selectedDoctor, dateStr, selectedClinic, occupiedSlots, clinicScheduleSettings]);

  // Synchronize selected batch with dynamic slots
  useEffect(() => {
    if (computedDaySlots.length > 0) {
      const match = computedDaySlots.find(
        (s) => s.slotTime === selectedBatch.batchTime && s.isAvailable
      );
      if (match) {
        setSelectedBatch({
          batchTime: match.slotTime,
          label: match.timeRange || `${formatTime12h(match.slotTime)} – ${formatTime12h(match.endTime)}`,
        });
      } else {
        const firstAvail = computedDaySlots.find((s) => s.isAvailable) || computedDaySlots[0];
        setSelectedBatch({
          batchTime: firstAvail.slotTime,
          label: firstAvail.timeRange || `${formatTime12h(firstAvail.slotTime)} – ${formatTime12h(firstAvail.endTime)}`,
        });
      }
    } else {
      setSelectedBatch({ batchTime: '', label: '' });
    }
  }, [computedDaySlots]);

  // Step 1: Patient details state
  const [patientName, setPatientName] = useState('');
  const [patientEmail, setPatientEmail] = useState('');
  const [patientContact, setPatientContact] = useState('');
  const [patientAddress, setPatientAddress] = useState('');
  const [patientGender, setPatientGender] = useState('Male');
  const [patientBirthdate, setPatientBirthdate] = useState('2003-03-31');

  // Step 1: Emergency contact state
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [emergencyRelationship, setEmergencyRelationship] = useState('Parent');

  // Step 1: Primary AI Skin Scan selection state
  const [patientScans, setPatientScans] = useState<ScanResult[]>([]);
  const [loadingScans, setLoadingScans] = useState(false);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [customPhotoUri, setCustomPhotoUri] = useState<string | null>(null);
  const [cameraModalVisible, setCameraModalVisible] = useState(false);

  // Step 2: Notes & Calendar
  const [notes, setNotes] = useState('');
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date());

  // Step 3: Payment Checkout State
  const [paymentMethod, setPaymentMethod] = useState<'gcash' | 'maya'>('gcash');
  const [payerName, setPayerName] = useState('');
  const [payerEmail, setPayerEmail] = useState('');
  const [payerAddress, setPayerAddress] = useState('');
  const [payerMobile, setPayerMobile] = useState('');
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [reservedApptId, setReservedApptId] = useState<string | null>(null);
  const [paymentReceipt, setPaymentReceipt] = useState<{
    reference: string;
    amount: number;
    method: 'gcash' | 'maya';
    mobileNumber: string;
    patientName: string;
    clinicName: string;
    doctorName: string;
    date: string;
    time: string;
    conditionName?: string;
    queueNumber?: number;
  } | null>(null);

  // Reset state when opening
  useEffect(() => {
    if (visible) {
      setStep(1);
      setPaymentReceipt(null);
      setPaymentProcessing(false);
      setReservedApptId(null);
    }
  }, [visible]);

  // Load user profile
  useEffect(() => {
    const applyUser = (u: PatientAccount) => {
      setCurrentUser(u);
      setPatientName(u.fullName || '');
      setPatientEmail(u.email || '');
      setPatientAddress(u.address || u.location || '');
      setPatientContact(u.phone || '');
      if (u.gender) setPatientGender(u.gender);
      if (u.dateOfBirth) setPatientBirthdate(u.dateOfBirth);

      setPayerName(u.fullName || '');
      setPayerEmail(u.email || '');
      setPayerAddress(u.address || u.location || 'Cebu City');
      setPayerMobile(u.phone || '');
    };

    if (user) {
      applyUser(user);
    } else if (visible) {
      getCurrentUser().then((u) => {
        if (u) applyUser(u);
      });
    }
  }, [user, visible]);

  // Load patient skin history
  useEffect(() => {
    const activeUserId = user?.id || currentUser?.id;
    if (visible && activeUserId) {
      setLoadingScans(true);
      getSkinHistory(activeUserId)
        .then((scans) => {
          setPatientScans(scans || []);
          if (scans && scans.length > 0 && !selectedScanId && !customPhotoUri) {
            setSelectedScanId(scans[0].id);
          }
        })
        .finally(() => setLoadingScans(false));
    }
  }, [visible, user?.id, currentUser?.id]);

  // Resolve clinic and doctors
  useEffect(() => {
    if (!visible) return;

    if (clinics && clinics.length > 0) {
      const match = findMatchingClinic(initialClinicId, clinics);
      if (match) {
        setSelectedClinic(match);
        if (!selectedDoctor || !match.doctors?.some((d) => d.id === selectedDoctor.id)) {
          setSelectedDoctor(match.doctors?.[0] || null);
        }
      }
    } else {
      getClinics().then((loadedClinics: ClinicRecord[]) => {
        if (loadedClinics && loadedClinics.length > 0) {
          const match = findMatchingClinic(initialClinicId, loadedClinics);
          if (match) {
            setSelectedClinic(match);
            setSelectedDoctor(match.doctors?.[0] || null);
          }
        }
      });
    }
  }, [visible, initialClinicId, clinics]);

  // 42-day Calendar cells
  const calendarCells = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDayOfWeek = firstDay.getDay();

    const gridStart = new Date(year, month, 1 - startDayOfWeek);
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + 90);

    return Array.from({ length: 42 }).map((_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      const cellDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const inCurrentMonth = d.getMonth() === month;
      const isPast = cellDateStr < todayStr;
      const isTooFar = d > maxDate;
      const isToday = cellDateStr === todayStr;

      const dayOfWeek = d.toLocaleDateString('en-US', { weekday: 'long' });
      const clinicSched = selectedClinic ? {
        openTime: selectedClinic.openTime,
        closeTime: selectedClinic.closeTime,
      } : null;
      const isOnDuty = isDoctorOnDutyOnDay(selectedDoctor, dayOfWeek, clinicSched);
      const isDisabled = isPast || isTooFar || !inCurrentMonth || !isOnDuty;

      return {
        dateStr: cellDateStr,
        dayNum: d.getDate(),
        dayOfWeek,
        inCurrentMonth,
        isPast,
        isToday,
        isOnDuty,
        isDisabled,
      };
    });
  }, [calendarMonth, selectedDoctor]);

  const canGoPrevMonth = useMemo(() => {
    const now = new Date();
    return (
      calendarMonth.getFullYear() > now.getFullYear() ||
      (calendarMonth.getFullYear() === now.getFullYear() && calendarMonth.getMonth() > now.getMonth())
    );
  }, [calendarMonth]);

  const handlePrevMonth = () => {
    if (!canGoPrevMonth) return;
    setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1));
  };

  async function handlePickImageFromGallery() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Needed', 'Please allow gallery access to select a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.7,
    });
    if (!result.canceled && result.assets.length > 0) {
      setCustomPhotoUri(result.assets[0].uri);
      setSelectedScanId(null);
    }
  }

  function showNewScanOptions() {
    Alert.alert('Attach New Skin Photo', 'Choose how you would like to provide your skin photo:', [
      { text: 'Take Live Photo (Camera)', onPress: () => setCameraModalVisible(true) },
      { text: 'Choose from Gallery', onPress: handlePickImageFromGallery },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const selectedScan = useMemo(() => {
    if (!selectedScanId) return null;
    return patientScans.find((s) => s.id === selectedScanId) || null;
  }, [selectedScanId, patientScans]);

  const activePhotoUri = customPhotoUri || selectedScan?.imageUri || null;
  const activeConditionName = selectedScan?.condition || (customPhotoUri ? 'Patient Photo Attachment' : 'Skin Consultation');

  // Step 1 -> Step 2 Validation
  function handleContinueToStep2() {
    if (!patientName.trim()) {
      Alert.alert('Required Field', 'Please enter your full name.');
      return;
    }
    if (!patientContact.trim()) {
      Alert.alert('Required Field', 'Please enter your contact number (11 digits).');
      return;
    }
    if (!patientAddress.trim()) {
      Alert.alert('Required Field', 'Please enter your city / complete address.');
      return;
    }
    if (!selectedScanId && !customPhotoUri) {
      Alert.alert(
        'Skin Scan Required',
        'Please select a completed AI skin scan from your history, or tap "Attach New" to provide a skin photo.'
      );
      return;
    }
    setStep(2);
  }

  // Step 2 -> Step 3 (Payment Checkout)
  function handleContinueToStep3() {
    const activeUser = user || currentUser;
    if (!activeUser) {
      Alert.alert('Sign In Required', 'Please sign in to proceed with booking.');
      return;
    }
    if (!selectedClinic) {
      Alert.alert('Clinic Required', 'Please select a clinic for your consultation.');
      return;
    }
    if (!dateStr.trim()) {
      Alert.alert('Date Required', 'Please select a consultation date from the calendar.');
      return;
    }
    if (!selectedBatch.batchTime) {
      Alert.alert('Time Slot Required', 'Please select an available consultation time slot before proceeding.');
      return;
    }

    if (!payerName.trim()) setPayerName(patientName.trim() || activeUser.fullName || 'Patient');
    if (!payerEmail.trim()) setPayerEmail(patientEmail.trim() || activeUser.email || '');
    if (!payerAddress.trim()) setPayerAddress(patientAddress.trim() || 'Cebu City');
    if (!payerMobile.trim()) setPayerMobile(patientContact.trim() || '09999999999');

    setStep(3);
  }

  // Step 3 Payment Processing via PayMongo Test Checkout and Supabase Sync
  async function handleProcessPayment() {
    const activeUser = user || currentUser;
    if (!activeUser) {
      Alert.alert('Sign In Required', 'Please sign in to complete payment.');
      return;
    }
    if (!selectedClinic) return;

    const cleanedMobile = payerMobile.replace(/\D/g, '');
    if (cleanedMobile.length !== 11 || !cleanedMobile.startsWith('09')) {
      Alert.alert(
        'Invalid Mobile Number',
        `Please enter a valid 11-digit Philippine mobile number starting with 09 for your ${paymentMethod === 'gcash' ? 'GCash' : 'Maya'} account.`
      );
      return;
    }
    if (!payerName.trim()) {
      Alert.alert('Full Name Required', 'Please enter your full name for the payment receipt.');
      return;
    }

    setPaymentProcessing(true);
    const feeNum = Number(selectedClinic.consultationFee) > 0 ? Number(selectedClinic.consultationFee) : 500;

    try {
      const docDispName = selectedDoctor?.name
        ? (selectedDoctor.name.startsWith('Dr') ? selectedDoctor.name : `Dr. ${selectedDoctor.name}`)
        : undefined;

      const resolvedPatientName = payerName.trim() || patientName.trim() || activeUser.fullName || 'Patient';
      const resolvedPatientEmail = payerEmail.trim() || patientEmail.trim() || activeUser.email || 'patient@dermai.com';
      const resolvedPatientAddress = payerAddress.trim() || patientAddress.trim() || 'Cebu City';

      // 1. Authoritative slot hold via Supabase RPC acquire_appointment_slot_hold
      let apptId = reservedApptId;

      // If we already held a slot from a previous attempt, verify authoritative status
      if (apptId) {
        try {
          const { data: existingAppt } = await supabase
            .from('patient_appointment')
            .select('appointment_id, payment_status, queue_number, payment_reference')
            .eq('appointment_id', apptId)
            .maybeSingle();

          if (existingAppt?.payment_status === 'paid') {
            // Already fulfilled by background webhook or server!
            const refNumber = existingAppt.payment_reference || generatePaymentReference();
            setReservedApptId(null);
            await addAppNotification(activeUser.id, {
              type: 'appointment',
              title: 'Payment Confirmed & Consultation Booked',
              message: `Payment of ₱${feeNum.toFixed(2)} via ${paymentMethod === 'gcash' ? 'GCash' : 'Maya'} received (Ref: ${refNumber}). Your consultation at ${selectedClinic.name} (${selectedBatch.label}) is confirmed.`,
              userId: activeUser.id,
            });
            setPaymentReceipt({
              reference: refNumber,
              amount: feeNum,
              method: paymentMethod,
              mobileNumber: cleanedMobile,
              patientName: resolvedPatientName,
              clinicName: selectedClinic.name,
              doctorName: docDispName || 'Attending Dermatologist',
              date: formatDateDisplay(dateStr),
              time: selectedBatch.label,
              conditionName: activeConditionName,
              queueNumber: existingAppt.queue_number != null ? Number(existingAppt.queue_number) : undefined,
            });
            setPaymentProcessing(false);
            return;
          }

          if (existingAppt?.payment_status === 'cancelled' || existingAppt?.payment_status === 'expired') {
            apptId = null;
            setReservedApptId(null);
          }
        } catch (checkErr) {
          console.warn('[BookingModal] Pre-payment hold check warning:', checkErr);
        }
      }

      if (!apptId) {
        const holdResult = await acquireAppointmentSlotHold({
          clinicId: selectedClinic.id,
          doctorId: selectedDoctor?.id,
          date: dateStr.trim(),
          time: selectedBatch.batchTime,
          batchTime: selectedBatch.label,
          patientName: resolvedPatientName,
          patientEmail: resolvedPatientEmail,
          patientContact: cleanedMobile,
          patientAddress: resolvedPatientAddress,
          patientGender: patientGender || undefined,
          patientBirthdate: patientBirthdate || undefined,
          emergencyContactName: emergencyName.trim() || undefined,
          emergencyContactPhone: emergencyPhone.trim() || undefined,
          emergencyContactRelationship: emergencyRelationship || undefined,
          notes: notes.trim() || undefined,
          clinicNote: docDispName
            ? `Assigned to ${docDispName} for pre-consultation review.`
            : 'Unassigned consultation request.',
          questionnaireAnswers: (selectedScan as any)?.answers || (selectedScan as any)?.questionnaire_answers || undefined,
          skinPhotoUrl: activePhotoUri || undefined,
          aiConditionName: activeConditionName,
          aiConfidence: selectedScan?.confidence != null ? Number(selectedScan.confidence) : undefined,
          conditionId: (selectedScan as any)?.conditionId || (selectedScan as any)?.condition_id || undefined,
          primaryScanId: selectedScanId || undefined,
          userId: activeUser.id,
          holdDurationMinutes: 10,
        });

        if (!holdResult.success || !holdResult.appointmentId) {
          Alert.alert(
            'Slot Unavailable',
            holdResult.message || 'This consultation slot is no longer available. Please choose another time.'
          );
          if (selectedClinic?.id && dateStr) {
            getOccupiedSlotsForDate(selectedClinic.id, dateStr, selectedDoctor?.id).then(setOccupiedSlots);
          }
          setPaymentProcessing(false);
          return;
        }

        apptId = holdResult.appointmentId;
        setReservedApptId(apptId);
      }

      // 2. Launch PayMongo Test Checkout (GCash / Maya) & verify payment intent
      let paymongoPaymentId: string;
      try {
        const payRes = await processPayMongoBookingPayment({
          amount: feeNum,
          paymentMethod,
          clinicId: selectedClinic.id,
          clinicName: selectedClinic.name,
          doctorId: selectedDoctor?.id,
          doctorName: docDispName,
          appointmentDate: dateStr.trim(),
          appointmentTime: selectedBatch.batchTime,
          appointmentId: apptId,
          patientName: resolvedPatientName,
          patientEmail: resolvedPatientEmail,
          patientContact: cleanedMobile,
          patientAddress: resolvedPatientAddress,
        });
        paymongoPaymentId = payRes.paymongoPaymentId;
      } catch (payErr: any) {
        console.warn('[BookingModal] PayMongo checkout failed or cancelled:', payErr?.message);

        const isTerminalFailure =
          payErr instanceof PayMongoPaymentError
            ? payErr.isConfirmedTerminal
            : false;
        const isUncertain =
          payErr instanceof PayMongoPaymentError
            ? payErr.status === 'uncertain' || payErr.status === 'timeout'
            : true;

        if (apptId) {
          if (isTerminalFailure) {
            try {
              await releaseAppointmentHoldSafely(apptId, { confirmedCancelledOrFailed: true });
              setReservedApptId(null);
            } catch (cancelErr) {
              console.warn('[BookingModal] Error releasing slot hold:', cancelErr);
            }
          } else {
            console.log('[BookingModal] Payment status is uncertain; preserving slot hold for background fulfillment:', apptId);
          }
        }

        if (isUncertain) {
          Alert.alert(
            'Payment Verification in Progress',
            'Your payment verification could not be completed immediately. If you completed payment on GCash or Maya, your consultation will be automatically confirmed once processed. Your reservation hold has been preserved for 10 minutes.'
          );
          setPaymentProcessing(false);
          return;
        }

        throw payErr;
      }

      const refNumber = paymongoPaymentId || generatePaymentReference();

      // 3. Atomically fulfilled by Edge Function; query authoritative queue number from DB
      let authoritativeQueueNumber: number | undefined = undefined;
      try {
        const { data: fulfilledRow } = await supabase
          .from('patient_appointment')
          .select('queue_number, payment_reference, payment_status')
          .eq('appointment_id', apptId)
          .maybeSingle();

        if (fulfilledRow?.queue_number != null) {
          authoritativeQueueNumber = Number(fulfilledRow.queue_number);
        }
      } catch (fetchErr) {
        console.warn('[BookingModal] Failed to fetch fulfilled appointment queue number:', fetchErr);
      }
      setReservedApptId(null);

      // Log audit events for appointment booking and payment
      logAuditEvent({
        user_id: activeUser.id,
        user_type: 'patient',
        performer_name: resolvedPatientName,
        action: 'Appointment Booked',
        log_type: 'appointment',
        target: `${selectedClinic.name} - ${dateStr.trim()} ${selectedBatch.label || selectedBatch.batchTime}`,
        details: `Booked consultation with ${docDispName || selectedClinic.name} on ${dateStr.trim()} at ${selectedBatch.label || selectedBatch.batchTime}`,
        metadata: {
          appointment_id: apptId,
          clinic_id: selectedClinic.id,
          clinic_name: selectedClinic.name,
          doctor_id: selectedDoctor?.id,
          doctor_name: docDispName,
          appointment_date: dateStr.trim(),
          batch_time: selectedBatch.label || selectedBatch.batchTime,
          fee: feeNum,
          platform: 'Mobile App',
        },
      }).catch(() => {});

      logAuditEvent({
        user_id: activeUser.id,
        user_type: 'patient',
        performer_name: resolvedPatientName,
        action: 'Payment Completed',
        log_type: 'appointment',
        target: `Consultation Payment (${paymentMethod.toUpperCase()})`,
        details: `Completed payment of ₱${feeNum.toFixed(2)} via ${paymentMethod.toUpperCase()} (Ref: ${refNumber})`,
        metadata: {
          appointment_id: apptId,
          payment_method: paymentMethod,
          payment_reference: refNumber,
          amount: feeNum,
          platform: 'Mobile App',
        },
      }).catch(() => {});

      // 4. Trigger in-app notification
      await addAppNotification(activeUser.id, {
        type: 'appointment',
        title: 'Payment Confirmed & Consultation Booked',
        message: `Payment of ₱${feeNum.toFixed(2)} via ${paymentMethod === 'gcash' ? 'GCash' : 'Maya'} received (Ref: ${refNumber}). Your consultation at ${selectedClinic.name} (${selectedBatch.label}) is confirmed.`,
        userId: activeUser.id,
      });

      // 5. Set receipt modal data
      setPaymentReceipt({
        reference: refNumber,
        amount: feeNum,
        method: paymentMethod,
        mobileNumber: cleanedMobile,
        patientName: resolvedPatientName,
        clinicName: selectedClinic.name,
        doctorName: docDispName || 'Attending Dermatologist',
        date: formatDateDisplay(dateStr),
        time: selectedBatch.label,
        conditionName: activeConditionName,
        queueNumber: authoritativeQueueNumber,
      });
    } catch (err: any) {
      console.error('[BookingModal] Payment booking error:', err);
      Alert.alert('Payment Notice', err?.message || 'Could not complete payment and booking. Please try again.');
    } finally {
      setPaymentProcessing(false);
    }
  }

  if (!visible) return null;

  if (!selectedClinic) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <SafeAreaView style={[styles.modalSafe, { justifyContent: 'center', alignItems: 'center' }]}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={{ marginTop: 14, color: COLORS.text, fontWeight: '700', fontSize: 16 }}>
            Book Consultation
          </Text>
          <Text style={{ marginTop: 6, color: COLORS.textSecondary, fontSize: 13 }}>
            Preparing clinic schedule and specialists...
          </Text>
        </SafeAreaView>
      </Modal>
    );
  }

  const dynamicFee = selectedClinic.consultationFee
    ? `₱${Number(selectedClinic.consultationFee).toLocaleString()}`
    : '₱500';

  const patientAge = computeAge(patientBirthdate);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <SafeAreaView style={styles.modalSafe}>
          {/* Top Tier 1: Action Bar */}
          <View style={styles.navBar}>
            <TouchableOpacity
              style={styles.navBtn}
              onPress={() => {
                if (paymentReceipt) {
                  setPaymentReceipt(null);
                  onSaved();
                } else if (step === 3) {
                  setStep(2);
                } else if (step === 2) {
                  setStep(1);
                } else {
                  onClose();
                }
              }}
              activeOpacity={0.7}
            >
              <Ionicons
                name={paymentReceipt ? 'close' : step > 1 ? 'chevron-back' : 'close'}
                size={20}
                color={COLORS.text}
              />
              <Text style={styles.navBtnTxt}>
                {paymentReceipt ? 'Close' : step > 1 ? 'Back' : 'Cancel'}
              </Text>
            </TouchableOpacity>

            <Text style={styles.navTitle} numberOfLines={1}>
              {paymentReceipt ? 'Payment Receipt' : step === 3 ? 'Payment Checkout' : 'Book Consultation'}
            </Text>

            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeTxt}>
                {paymentReceipt ? 'Confirmed' : `Step ${step}/3`}
              </Text>
            </View>
          </View>

          {/* Top Tier 2: Progress Timeline (Hidden on Receipt) */}
          {!paymentReceipt && (
            <View style={styles.stepperContainer}>
              <View style={styles.stepperRow}>
                {/* Step 1 Item */}
                <TouchableOpacity
                  style={styles.trackerItem}
                  onPress={() => setStep(1)}
                  activeOpacity={0.8}
                >
                  <View
                    style={[
                      styles.trackerCircle,
                      step === 1 && styles.trackerCircleActive,
                      step > 1 && styles.trackerCircleDone,
                    ]}
                  >
                    {step > 1 ? (
                      <Ionicons name="checkmark" size={12} color="#fff" />
                    ) : (
                      <Text style={[styles.trackerNum, step === 1 && styles.trackerNumActive]}>1</Text>
                    )}
                  </View>
                  <Text style={[styles.trackerLabel, step === 1 && styles.trackerLabelActive]}>
                    1. Patient
                  </Text>
                </TouchableOpacity>

                <View
                  style={[styles.trackerConnector, step >= 2 && styles.trackerConnectorDone]}
                />

                {/* Step 2 Item */}
                <TouchableOpacity
                  style={styles.trackerItem}
                  onPress={() => {
                    if (step === 3) setStep(2);
                  }}
                  disabled={step === 1}
                  activeOpacity={0.8}
                >
                  <View
                    style={[
                      styles.trackerCircle,
                      step === 2 && styles.trackerCircleActive,
                      step > 2 && styles.trackerCircleDone,
                    ]}
                  >
                    {step > 2 ? (
                      <Ionicons name="checkmark" size={12} color="#fff" />
                    ) : (
                      <Text style={[styles.trackerNum, step === 2 && styles.trackerNumActive]}>2</Text>
                    )}
                  </View>
                  <Text style={[styles.trackerLabel, step === 2 && styles.trackerLabelActive]}>
                    2. Schedule
                  </Text>
                </TouchableOpacity>

                <View
                  style={[styles.trackerConnector, step === 3 && styles.trackerConnectorDone]}
                />

                {/* Step 3 Item */}
                <View style={styles.trackerItem}>
                  <View
                    style={[
                      styles.trackerCircle,
                      step === 3 && styles.trackerCircleActive,
                    ]}
                  >
                    <Text style={[styles.trackerNum, step === 3 && styles.trackerNumActive]}>3</Text>
                  </View>
                  <Text style={[styles.trackerLabel, step === 3 && styles.trackerLabelActive]}>
                    3. Payment
                  </Text>
                </View>
              </View>

              <Text style={styles.stepSubtitleTxt}>
                {step === 1
                  ? 'Step 1 of 3: Patient Profile & Skin Concern Photo'
                  : step === 2
                  ? 'Step 2 of 3: Choose Schedule & Attending Dermatologist'
                  : 'Step 3 of 3: Online Consultation Payment (GCash / Maya)'}
              </Text>
            </View>
          )}

          {/* Clinic Info Pill */}
          {!paymentReceipt && (
            <View style={styles.clinicBanner}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                {selectedClinic.logoUrl ? (
                  <Image source={{ uri: selectedClinic.logoUrl }} style={styles.bannerLogo} resizeMode="cover" />
                ) : (
                  <View style={styles.bannerLogoFallback}>
                    <Ionicons name="business" size={16} color={COLORS.primary} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={styles.bannerClinicName} numberOfLines={1}>
                      {selectedClinic.name}
                    </Text>
                    {selectedClinic.verified && (
                      <Ionicons name="checkmark-circle" size={14} color="#0284c7" />
                    )}
                  </View>
                  <Text style={styles.bannerClinicAddr} numberOfLines={1}>
                    {selectedClinic.address}
                  </Text>
                </View>
              </View>
              <View style={styles.bannerFeePill}>
                <Text style={styles.bannerFeeTxt}>{dynamicFee}</Text>
              </View>
            </View>
          )}

          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* ════════════════════════════════════════════════════════════════════
                SCREEN: PAYMENT SUCCESS OFFICIAL RECEIPT
            ════════════════════════════════════════════════════════════════════ */}
            {paymentReceipt ? (
              <View style={styles.receiptContainer}>
                {/* Success Icon */}
                <View style={styles.receiptSuccessIconCircle}>
                  <Ionicons name="checkmark-circle" size={44} color="#059669" />
                </View>
                <Text style={styles.receiptSuccessTitle}>Payment Successful!</Text>
                <Text style={styles.receiptSuccessSub}>
                  Your appointment request and payment were confirmed. A notification was sent to your account.
                </Text>

                {/* Digital Receipt Card */}
                <View style={styles.receiptCard}>
                  <View style={styles.receiptCardHeader}>
                    <View>
                      <Text style={styles.receiptCardTitle}>Official Consultation Receipt</Text>
                      <Text style={styles.receiptRefNumber}>{paymentReceipt.reference}</Text>
                    </View>
                    <View style={styles.receiptPaidBadge}>
                      <Ionicons name="checkmark-done" size={11} color="#059669" />
                      <Text style={styles.receiptPaidBadgeTxt}>PAID</Text>
                    </View>
                  </View>

                  <View style={styles.receiptDashedLine} />

                  {/* Method & Amount */}
                  <View style={styles.receiptAmountRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Image
                        source={paymentReceipt.method === 'gcash' ? GCASH_LOGO : MAYA_LOGO}
                        style={styles.receiptMethodLogo}
                        resizeMode="contain"
                      />
                      <View>
                        <Text style={styles.receiptMethodLabel}>
                          {paymentReceipt.method === 'gcash' ? 'GCash E-Wallet' : 'Maya E-Wallet'}
                        </Text>
                        <Text style={styles.receiptAccountNum}>{paymentReceipt.mobileNumber}</Text>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.receiptAmountLabel}>Amount Paid</Text>
                      <Text style={styles.receiptAmountValue}>₱{paymentReceipt.amount.toFixed(2)}</Text>
                    </View>
                  </View>

                  <View style={styles.receiptDashedLine} />

                  {/* Consultation Particulars */}
                  <View style={styles.receiptDetailRow}>
                    <Text style={styles.receiptDetailKey}>Patient Name:</Text>
                    <Text style={styles.receiptDetailVal}>{paymentReceipt.patientName}</Text>
                  </View>
                  <View style={styles.receiptDetailRow}>
                    <Text style={styles.receiptDetailKey}>Clinic:</Text>
                    <Text style={styles.receiptDetailVal}>{paymentReceipt.clinicName}</Text>
                  </View>
                  <View style={styles.receiptDetailRow}>
                    <Text style={styles.receiptDetailKey}>Specialist:</Text>
                    <Text style={styles.receiptDetailVal}>{paymentReceipt.doctorName}</Text>
                  </View>
                  <View style={styles.receiptDetailRow}>
                    <Text style={styles.receiptDetailKey}>Appointment Date:</Text>
                    <Text style={styles.receiptDetailVal}>{paymentReceipt.date}</Text>
                  </View>
                  <View style={styles.receiptDetailRow}>
                    <Text style={styles.receiptDetailKey}>Arrival Window:</Text>
                    <Text style={[styles.receiptDetailVal, { color: COLORS.primary, fontWeight: '700' }]}>
                      {paymentReceipt.time}
                    </Text>
                  </View>
                  {paymentReceipt.queueNumber != null && (
                    <View style={styles.receiptDetailRow}>
                      <Text style={styles.receiptDetailKey}>Queue Number:</Text>
                      <Text style={[styles.receiptDetailVal, { color: COLORS.primary, fontWeight: '700' }]}>
                        #{paymentReceipt.queueNumber}
                      </Text>
                    </View>
                  )}
                  {paymentReceipt.conditionName && (
                    <View style={styles.receiptDetailRow}>
                      <Text style={styles.receiptDetailKey}>Primary Concern:</Text>
                      <Text style={[styles.receiptDetailVal, { color: '#0f766e', fontWeight: '700' }]}>
                        {paymentReceipt.conditionName}
                      </Text>
                    </View>
                  )}

                  <View style={styles.receiptFooterNoteBox}>
                    <Ionicons name="shield-checkmark" size={13} color="#059669" />
                    <Text style={styles.receiptFooterNoteTxt}>
                      Synchronized to Supabase database &amp; your transaction billing history.
                    </Text>
                  </View>
                </View>

                {/* Primary CTA */}
                <TouchableOpacity
                  style={styles.receiptCtaBtn}
                  onPress={() => {
                    setPaymentReceipt(null);
                    onSaved();
                  }}
                  activeOpacity={0.85}
                >
                  <Ionicons name="calendar-outline" size={18} color="#fff" />
                  <Text style={styles.receiptCtaBtnTxt}>View Appointment Status</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* ════════════════════════════════════════════════════════════════════
                STEP 1: Patient Details & Primary Skin Scan Selection
            ════════════════════════════════════════════════════════════════════ */}
            {!paymentReceipt && step === 1 && (
              <View>
                {/* 1. Patient Profile Information */}
                <View style={styles.sectionHeaderRow}>
                  <Ionicons name="person-outline" size={16} color={COLORS.primary} />
                  <Text style={styles.sectionHeading}>1. Patient Information</Text>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>
                    Full Name <Text style={styles.reqAsterisk}>*</Text>
                  </Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="e.g. Maria Santos"
                    placeholderTextColor="#94a3b8"
                    value={patientName}
                    onChangeText={setPatientName}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>
                    Email Address <Text style={styles.reqAsterisk}>*</Text>
                  </Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="patient@example.com"
                    placeholderTextColor="#94a3b8"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={patientEmail}
                    onChangeText={setPatientEmail}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>
                    Phone Number (11 Digits) <Text style={styles.reqAsterisk}>*</Text>
                  </Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="0917 123 4567"
                    placeholderTextColor="#94a3b8"
                    keyboardType="phone-pad"
                    value={patientContact}
                    onChangeText={setPatientContact}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>
                    City / Address <Text style={styles.reqAsterisk}>*</Text>
                  </Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="e.g. Cebu City, Central Visayas"
                    placeholderTextColor="#94a3b8"
                    value={patientAddress}
                    onChangeText={setPatientAddress}
                  />
                </View>

                {/* Gender & Birthdate row */}
                <View style={styles.fieldRow}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={styles.fieldLabel}>Gender</Text>
                    <View style={styles.genderRow}>
                      {['Male', 'Female'].map((g) => {
                        const active = patientGender === g;
                        return (
                          <TouchableOpacity
                            key={g}
                            style={[styles.genderChip, active && styles.genderChipActive]}
                            onPress={() => setPatientGender(g)}
                            activeOpacity={0.8}
                          >
                            <Text style={[styles.genderChipTxt, active && styles.genderChipTxtActive]}>
                              {g}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>

                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={styles.fieldLabel}>
                      Birthdate {patientAge !== null ? `(${patientAge} yrs)` : ''}
                    </Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="#94a3b8"
                      value={patientBirthdate}
                      onChangeText={setPatientBirthdate}
                    />
                  </View>
                </View>

                {/* 2. Emergency Contact */}
                <View style={[styles.sectionHeaderRow, { marginTop: 22 }]}>
                  <Ionicons name="call-outline" size={16} color={COLORS.primary} />
                  <Text style={styles.sectionHeading}>2. Emergency Contact</Text>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Emergency Contact Person</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="e.g. Juan Santos (Relative / Parent)"
                    placeholderTextColor="#94a3b8"
                    value={emergencyName}
                    onChangeText={setEmergencyName}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Emergency Phone</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="0918 765 4321"
                    placeholderTextColor="#94a3b8"
                    keyboardType="phone-pad"
                    value={emergencyPhone}
                    onChangeText={setEmergencyPhone}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Relationship</Text>
                  <View style={styles.relRow}>
                    {['Parent', 'Spouse', 'Sibling', 'Guardian', 'Friend'].map((r) => {
                      const active = emergencyRelationship === r;
                      return (
                        <TouchableOpacity
                          key={r}
                          style={[styles.relChip, active && styles.relChipActive]}
                          onPress={() => setEmergencyRelationship(r)}
                          activeOpacity={0.8}
                        >
                          <Text style={[styles.relChipTxt, active && styles.relChipTxtActive]}>
                            {r}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* 3. Primary AI Skin Scan Selection */}
                <View style={[styles.sectionHeaderRow, { marginTop: 22, justifyContent: 'space-between' }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                    <Ionicons name="scan-outline" size={16} color={COLORS.primary} />
                    <Text style={styles.sectionHeading}>3. Primary AI Skin Scan</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.newScanBtn}
                    onPress={showNewScanOptions}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="camera" size={13} color="#fff" />
                    <Text style={styles.newScanBtnTxt}>Attach New</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.scanNoticeTxt}>
                  Attach your recent AI skin assessment so the clinic dermatologist can review lesion findings before your visit.
                </Text>

                {/* Custom Photo Attachment Preview */}
                {customPhotoUri && (
                  <View style={styles.customPhotoCard}>
                    <Image source={{ uri: customPhotoUri }} style={styles.customPhotoThumb} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.customPhotoTitle}>Newly Attached Skin Photo</Text>
                      <Text style={styles.customPhotoSub}>Ready to be sent to attending dermatologist</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setCustomPhotoUri(null)}
                      style={styles.removePhotoBtn}
                    >
                      <Ionicons name="close-circle" size={22} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                )}

                {/* AI Skin Scan History List */}
                {loadingScans ? (
                  <View style={styles.scanLoadingBox}>
                    <ActivityIndicator size="small" color={COLORS.primary} />
                    <Text style={styles.scanLoadingTxt}>Loading your previous AI skin assessments...</Text>
                  </View>
                ) : patientScans.length === 0 ? (
                  <View style={styles.scanEmptyBox}>
                    <Ionicons name="images-outline" size={32} color="#94a3b8" />
                    <Text style={styles.scanEmptyTitle}>No AI Skin Scans Found</Text>
                    <Text style={styles.scanEmptySub}>
                      You haven't performed a skin scan yet. Tap "Attach New" above to take a photo of your skin concern.
                    </Text>
                    <TouchableOpacity
                      style={styles.takeScanCta}
                      onPress={showNewScanOptions}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="camera" size={15} color="#fff" />
                      <Text style={styles.takeScanCtaTxt}>Take Photo with Camera</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.scanGrid}>
                    {patientScans.map((scan) => {
                      const isSelected = selectedScanId === scan.id && !customPhotoUri;
                      const filipinoAlias = FILIPINO_ALIASES[scan.condition] || scan.condition;
                      return (
                        <TouchableOpacity
                          key={scan.id}
                          style={[styles.scanCard, isSelected && styles.scanCardSelected]}
                          onPress={() => {
                            setSelectedScanId(scan.id);
                            setCustomPhotoUri(null);
                          }}
                          activeOpacity={0.8}
                        >
                          {scan.imageUri ? (
                            <Image source={{ uri: scan.imageUri }} style={styles.scanThumb} />
                          ) : (
                            <View style={styles.scanThumbFallback}>
                              <Ionicons name="finger-print-outline" size={22} color={COLORS.primary} />
                            </View>
                          )}

                          <View style={{ flex: 1, marginLeft: 12 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                              <Text style={styles.scanConditionName} numberOfLines={1}>
                                {scan.condition}
                              </Text>
                              <View style={[styles.confidencePill, isSelected && styles.confidencePillSelected]}>
                                <Text style={styles.confidencePillTxt}>
                                  {formatConfidenceDisplay(scan.confidence)} Match
                                </Text>
                              </View>
                            </View>

                            {filipinoAlias !== scan.condition && (
                              <Text style={styles.scanAlias} numberOfLines={1}>
                                {filipinoAlias}
                              </Text>
                            )}

                            <View style={styles.scanDateRow}>
                              <Ionicons name="calendar-outline" size={11} color="#64748b" />
                              <Text style={styles.scanDateTxt}>
                                {formatDateDisplay(scan.date || (scan as any).createdAt)}
                              </Text>
                            </View>
                          </View>

                          {isSelected && (
                            <View style={styles.scanCheckmark}>
                              <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {/* Additional Notes */}
                <View style={[styles.sectionHeaderRow, { marginTop: 22 }]}>
                  <Ionicons name="document-text-outline" size={16} color={COLORS.primary} />
                  <Text style={styles.sectionHeading}>4. Symptoms &amp; Consultation Notes</Text>
                </View>
                <TextInput
                  style={[styles.textInput, styles.textArea]}
                  placeholder="Describe your symptoms, how long you have experienced them, or medications you currently take..."
                  placeholderTextColor="#94a3b8"
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  numberOfLines={4}
                />

                {/* Continue CTA */}
                <TouchableOpacity
                  style={styles.continueBtn}
                  onPress={handleContinueToStep2}
                  activeOpacity={0.85}
                >
                  <Text style={styles.continueBtnTxt} numberOfLines={1}>
                    Continue to Schedule &amp; Doctor
                  </Text>
                  <Ionicons name="arrow-forward" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            )}

            {/* ════════════════════════════════════════════════════════════════════
                STEP 2: Choose Schedule & Attending Dermatologist
            ════════════════════════════════════════════════════════════════════ */}
            {!paymentReceipt && step === 2 && (
              <View>
                {/* 1. Attending Dermatologist Selection */}
                <View style={styles.sectionHeaderRow}>
                  <Ionicons name="medkit-outline" size={16} color={COLORS.primary} />
                  <Text style={styles.sectionHeading}>1. Attending Dermatologist</Text>
                </View>

                {selectedClinic.doctors && selectedClinic.doctors.length > 0 ? (
                  <View style={styles.doctorChipGrid}>
                    {selectedClinic.doctors.map((doc) => {
                      const isSelected = selectedDoctor?.id === doc.id;
                      return (
                        <TouchableOpacity
                          key={doc.id}
                          style={[styles.doctorChip, isSelected && styles.doctorChipSelected]}
                          onPress={() => setSelectedDoctor(doc)}
                          activeOpacity={0.8}
                        >
                          <View style={styles.docAvatar}>
                            <DoctorAvatarImage
                              uri={doc.avatar_url || doc.avatarUrl}
                              name={doc.name}
                              size={36}
                            />
                          </View>
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={[styles.doctorChipName, isSelected && styles.doctorChipNameSelected]}>
                              {doc.name.startsWith('Dr') ? doc.name : `Dr. ${doc.name}`}
                            </Text>
                            <Text style={[styles.doctorChipSpec, isSelected && styles.doctorChipSpecSelected]}>
                              {doc.specialization}
                            </Text>
                            {doc.dutyDays && doc.dutyDays.length > 0 && (
                              <Text style={styles.docDutyText}>
                                Duty: {doc.dutyDays.map((d) => d.slice(0, 3)).join(', ')}
                              </Text>
                            )}
                          </View>
                          {isSelected && (
                            <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : (
                  <View style={styles.noDocBox}>
                    <Text style={styles.noDocTxt}>
                      Doctor will be assigned automatically by clinic upon confirmation.
                    </Text>
                  </View>
                )}

                {/* 2. Interactive Calendar */}
                <View style={[styles.sectionHeaderRow, { marginTop: 20 }]}>
                  <Ionicons name="calendar-outline" size={16} color={COLORS.primary} />
                  <Text style={styles.sectionHeading}>2. Select Consultation Date</Text>
                </View>

                <View style={styles.calendarCard}>
                  {/* Month header & navigation */}
                  <View style={styles.calMonthHeader}>
                    <TouchableOpacity
                      onPress={handlePrevMonth}
                      disabled={!canGoPrevMonth}
                      style={[styles.calNavBtn, !canGoPrevMonth && { opacity: 0.3 }]}
                    >
                      <Ionicons name="chevron-back" size={18} color={COLORS.text} />
                    </TouchableOpacity>
                    <Text style={styles.calMonthTitle}>
                      {calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    </Text>
                    <TouchableOpacity onPress={handleNextMonth} style={styles.calNavBtn}>
                      <Ionicons name="chevron-forward" size={18} color={COLORS.text} />
                    </TouchableOpacity>
                  </View>

                  {/* Weekday headers */}
                  <View style={styles.calWeekRow}>
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w, idx) => (
                      <Text key={w} style={[styles.calWeekCell, idx === 0 && { color: '#ef4444' }]}>
                        {w}
                      </Text>
                    ))}
                  </View>

                  {/* 42 Date Cells */}
                  <View style={styles.calGrid}>
                    {calendarCells.map((cell) => {
                      const isSelected = dateStr === cell.dateStr;
                      return (
                        <TouchableOpacity
                          key={cell.dateStr}
                          style={[
                            styles.calDayCell,
                            isSelected && styles.calDayCellSelected,
                            !cell.inCurrentMonth && styles.calDayCellOutside,
                            cell.isDisabled && styles.calDayCellDisabled,
                          ]}
                          disabled={cell.isDisabled}
                          onPress={() => setDateStr(cell.dateStr)}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.calDayNum,
                              isSelected && styles.calDayNumSelected,
                              cell.isToday && !isSelected && styles.calDayNumToday,
                              cell.isDisabled && styles.calDayNumDisabled,
                            ]}
                          >
                            {cell.dayNum}
                          </Text>
                          {cell.inCurrentMonth && !cell.isPast && cell.isOnDuty && !isSelected && (
                            <View style={styles.onDutyDot} />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Doctor Duty Legend */}
                  <View style={styles.calLegend}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#10b981' }]} />
                      <Text style={styles.legendText}>Doctor On Duty</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#e2e8f0' }]} />
                      <Text style={styles.legendText}>Off Duty</Text>
                    </View>
                  </View>
                </View>

                {/* 3. Arrival Window / Time Slot */}
                <View style={[styles.sectionHeaderRow, { marginTop: 20 }]}>
                  <Ionicons name="time-outline" size={16} color={COLORS.primary} />
                  <Text style={styles.sectionHeading}>3. Arrival Window / Time Slot</Text>
                </View>
                <View style={styles.batchGrid}>
                  {loadingSlots ? (
                    <View style={{ padding: 16, alignItems: 'center', width: '100%' }}>
                      <ActivityIndicator size="small" color={COLORS.primary} />
                      <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 6 }}>
                        Checking doctor schedule & slot availability...
                      </Text>
                    </View>
                  ) : computedDaySlots.length === 0 ? (
                    <View style={{ padding: 16, alignItems: 'center', width: '100%' }}>
                      <Text style={{ fontSize: 13, color: COLORS.textSecondary, textAlign: 'center' }}>
                        No consultation slots available for this doctor on the selected date.
                      </Text>
                    </View>
                  ) : (
                    computedDaySlots.map((slot) => {
                      const isSelected = selectedBatch.batchTime === slot.slotTime;
                      const isDisabled = !slot.isAvailable;
                      const isOccupied = slot.isOccupied;
                      const isReserved = slot.isReserved;
                      const isPast = slot.isPast;

                      return (
                        <TouchableOpacity
                          key={slot.slotTime}
                          style={[
                            styles.batchSlot,
                            isSelected && styles.batchSlotSelected,
                            isDisabled && {
                              backgroundColor: '#f1f5f9',
                              borderColor: '#e2e8f0',
                              opacity: 0.65,
                            },
                          ]}
                          disabled={isDisabled}
                          onPress={() =>
                            setSelectedBatch({
                              batchTime: slot.slotTime,
                              label: slot.timeRange || `${formatTime12h(slot.slotTime)} – ${formatTime12h(slot.endTime)}`,
                            })
                          }
                          activeOpacity={0.8}
                        >
                          <Ionicons
                            name={isDisabled ? "lock-closed-outline" : "time-outline"}
                            size={13}
                            color={
                              isSelected
                                ? COLORS.primary
                                : isDisabled
                                ? '#94a3b8'
                                : COLORS.textSecondary
                            }
                          />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text
                              style={[
                                styles.batchSlotTxt,
                                isSelected && styles.batchSlotTxtSelected,
                                isDisabled && { color: '#94a3b8' },
                              ]}
                              numberOfLines={1}
                            >
                              {slot.timeRange || `${formatTime12h(slot.slotTime)} – ${formatTime12h(slot.endTime)}`}
                            </Text>
                            {isDisabled && (
                              <Text
                                style={{
                                  fontSize: 10,
                                  fontWeight: '700',
                                  color: isPast ? '#94a3b8' : isReserved ? '#d97706' : '#e11d48',
                                  marginTop: 1,
                                }}
                              >
                                {isPast ? 'Passed' : isReserved ? 'Reserved' : 'Booked'}
                              </Text>
                            )}
                          </View>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>

                {/* 4. Consultation Summary Card */}
                <View style={[styles.sectionHeaderRow, { marginTop: 20 }]}>
                  <Ionicons name="receipt-outline" size={16} color={COLORS.primary} />
                  <Text style={styles.sectionHeading}>Consultation Summary</Text>
                </View>

                <View style={styles.summaryCard}>
                  <View style={styles.summarySlotBox}>
                    <Text style={styles.summarySlotLabel}>Selected Consultation Window</Text>
                    <Text style={styles.summaryDoctorName} numberOfLines={1}>
                      {selectedDoctor?.name
                        ? (selectedDoctor.name.startsWith('Dr') ? selectedDoctor.name : `Dr. ${selectedDoctor.name}`)
                        : 'Attending Dermatologist'}
                    </Text>
                    <Text style={styles.summaryDoctorSpec} numberOfLines={1}>
                      {selectedDoctor?.specialization || 'General Dermatology'}
                    </Text>
                    <View style={styles.summarySlotRow}>
                      <Ionicons name="calendar-outline" size={13} color={COLORS.primary} />
                      <Text style={styles.summarySlotTime}>
                        Date: <Text style={{ fontWeight: '700', color: COLORS.text }}>{formatDateDisplay(dateStr)}</Text>
                      </Text>
                    </View>
                    <View style={styles.summarySlotRow}>
                      <Ionicons name="time-outline" size={13} color={COLORS.primary} />
                      <Text style={styles.summarySlotTime}>
                        Window: <Text style={{ fontWeight: '700', color: COLORS.primary }}>{selectedBatch.label}</Text>
                      </Text>
                    </View>
                  </View>

                  {/* Patient & Scan preview */}
                  <View style={styles.summaryPatientBox}>
                    <Text style={styles.summarySlotLabel}>Patient &amp; Primary Scan</Text>
                    <Text style={styles.summaryPatientName}>{patientName}</Text>
                    <Text style={styles.summaryPatientSub}>
                      {patientContact} • {activeConditionName}
                    </Text>
                  </View>

                  <View style={styles.summaryDivider} />

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.summaryFeeLabel}>Consultation Fee</Text>
                    <Text style={styles.summaryFeeAmount}>{dynamicFee}</Text>
                  </View>
                </View>

                {/* Action Buttons Row */}
                <View style={styles.step2ActionRow}>
                  <TouchableOpacity
                    style={styles.stepBackBtn}
                    onPress={() => setStep(1)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="arrow-back" size={16} color={COLORS.text} />
                    <Text style={styles.stepBackBtnTxt}>Back</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.confirmBtn}
                    onPress={handleContinueToStep3}
                    activeOpacity={0.85}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.confirmBtnTxt}>Proceed to Payment ({dynamicFee})</Text>
                      <Ionicons name="arrow-forward" size={16} color="#fff" />
                    </View>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* ════════════════════════════════════════════════════════════════════
                STEP 3: Online Consultation Payment (GCash & Maya)
            ════════════════════════════════════════════════════════════════════ */}
            {!paymentReceipt && step === 3 && (
              <View>
                {/* Secure Checkout Banner */}
                <View style={styles.checkoutBanner}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                    <View style={styles.checkoutShieldCircle}>
                      <Ionicons name="shield-checkmark" size={18} color="#059669" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.checkoutBannerTitle}>Online Consultation Payment</Text>
                      <Text style={styles.checkoutBannerSub}>Fast &amp; secure checkout via E-Wallet</Text>
                    </View>
                  </View>
                  <View style={styles.checkoutSecureBadge}>
                    <Ionicons name="lock-closed" size={10} color="#059669" />
                    <Text style={styles.checkoutSecureBadgeTxt}>256-Bit SSL</Text>
                  </View>
                </View>

                {/* 1. Payer / Billing Information */}
                <View style={styles.sectionHeaderRow}>
                  <Ionicons name="person-outline" size={16} color={COLORS.primary} />
                  <Text style={styles.sectionHeading}>1. Payer Information</Text>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>
                    Full Name <Text style={styles.reqAsterisk}>*</Text>
                  </Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="e.g. Maria Santos"
                    placeholderTextColor="#94a3b8"
                    value={payerName}
                    onChangeText={setPayerName}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>
                    Email Address <Text style={styles.reqAsterisk}>*</Text>
                  </Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="patient@example.com"
                    placeholderTextColor="#94a3b8"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={payerEmail}
                    onChangeText={setPayerEmail}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>
                    Billing Address <Text style={styles.reqAsterisk}>*</Text>
                  </Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="Barangay, City, Province"
                    placeholderTextColor="#94a3b8"
                    value={payerAddress}
                    onChangeText={setPayerAddress}
                  />
                </View>

                {/* 2. Select E-Wallet */}
                <View style={[styles.sectionHeaderRow, { marginTop: 20 }]}>
                  <Ionicons name="wallet-outline" size={16} color={COLORS.primary} />
                  <Text style={styles.sectionHeading}>2. Select E-Wallet</Text>
                </View>

                <View style={styles.walletMethodRow}>
                  {/* GCash Option */}
                  <TouchableOpacity
                    style={[
                      styles.walletMethodCard,
                      paymentMethod === 'gcash' && styles.walletMethodCardGCashActive,
                    ]}
                    onPress={() => setPaymentMethod('gcash')}
                    activeOpacity={0.8}
                  >
                    <Image source={GCASH_LOGO} style={styles.walletLogo} resizeMode="contain" />
                    <Text style={[styles.walletMethodName, paymentMethod === 'gcash' && { color: '#007DFE', fontWeight: '800' }]}>
                      GCash
                    </Text>
                    {paymentMethod === 'gcash' && (
                      <View style={styles.walletCheckmark}>
                        <Ionicons name="checkmark-circle" size={16} color="#007DFE" />
                      </View>
                    )}
                  </TouchableOpacity>

                  {/* Maya Option */}
                  <TouchableOpacity
                    style={[
                      styles.walletMethodCard,
                      paymentMethod === 'maya' && styles.walletMethodCardMayaActive,
                    ]}
                    onPress={() => setPaymentMethod('maya')}
                    activeOpacity={0.8}
                  >
                    <Image source={MAYA_LOGO} style={styles.walletLogo} resizeMode="contain" />
                    <Text style={[styles.walletMethodName, paymentMethod === 'maya' && { color: '#00D632', fontWeight: '800' }]}>
                      Maya
                    </Text>
                    {paymentMethod === 'maya' && (
                      <View style={styles.walletCheckmark}>
                        <Ionicons name="checkmark-circle" size={16} color="#00D632" />
                      </View>
                    )}
                  </TouchableOpacity>
                </View>

                {/* Mobile Number Input */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>
                    {paymentMethod === 'gcash' ? 'GCash' : 'Maya'} Registered Mobile Number <Text style={styles.reqAsterisk}>*</Text>
                  </Text>
                  <View style={styles.phoneInputRow}>
                    <View style={styles.countryPill}>
                      <Text style={styles.countryFlag}>🇵🇭</Text>
                      <Text style={styles.countryCode}>+63</Text>
                    </View>
                    <TextInput
                      style={[styles.textInput, { flex: 1, marginLeft: 8 }]}
                      placeholder="09XXXXXXXXX"
                      placeholderTextColor="#94a3b8"
                      keyboardType="phone-pad"
                      maxLength={11}
                      value={payerMobile}
                      onChangeText={(t) => setPayerMobile(t.replace(/\D/g, '').slice(0, 11))}
                    />
                  </View>
                  <Text style={styles.phoneHelperTxt}>
                    Enter the 11-digit mobile number linked to your {paymentMethod === 'gcash' ? 'GCash' : 'Maya'} account.
                  </Text>
                </View>

                {/* 3. Payment Summary */}
                <View style={[styles.sectionHeaderRow, { marginTop: 20 }]}>
                  <Ionicons name="receipt-outline" size={16} color={COLORS.primary} />
                  <Text style={styles.sectionHeading}>3. Payment Summary</Text>
                </View>

                <View style={styles.summaryCard}>
                  <View style={styles.summaryDetailRow}>
                    <Text style={styles.summaryDetailKey}>Clinic:</Text>
                    <Text style={styles.summaryDetailVal}>{selectedClinic.name}</Text>
                  </View>
                  <View style={styles.summaryDetailRow}>
                    <Text style={styles.summaryDetailKey}>Specialist:</Text>
                    <Text style={styles.summaryDetailVal}>
                      {selectedDoctor?.name
                        ? (selectedDoctor.name.startsWith('Dr') ? selectedDoctor.name : `Dr. ${selectedDoctor.name}`)
                        : 'Attending Dermatologist'}
                    </Text>
                  </View>
                  <View style={styles.summaryDetailRow}>
                    <Text style={styles.summaryDetailKey}>Schedule:</Text>
                    <Text style={styles.summaryDetailVal}>
                      {formatDateDisplay(dateStr)} • {selectedBatch.label}
                    </Text>
                  </View>
                  <View style={styles.summaryDetailRow}>
                    <Text style={styles.summaryDetailKey}>Selected Concern:</Text>
                    <Text style={[styles.summaryDetailVal, { color: '#0f766e', fontWeight: '700' }]}>
                      {activeConditionName}
                    </Text>
                  </View>

                  <View style={styles.summaryDivider} />

                  <View style={styles.summaryDetailRow}>
                    <Text style={styles.summaryDetailKey}>Consultation Fee:</Text>
                    <Text style={styles.summaryDetailVal}>{dynamicFee}</Text>
                  </View>
                  <View style={styles.summaryDetailRow}>
                    <Text style={styles.summaryDetailKey}>Service / Processing Fee:</Text>
                    <Text style={[styles.summaryDetailVal, { color: '#059669', fontWeight: '700' }]}>
                      ₱0.00 (Waived)
                    </Text>
                  </View>

                  <View style={styles.summaryDivider} />

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.summaryFeeLabel}>Total Amount</Text>
                    <Text style={styles.summaryFeeAmount}>{dynamicFee}</Text>
                  </View>
                </View>

                {/* Step 3 Action Buttons */}
                <View style={styles.step2ActionRow}>
                  <TouchableOpacity
                    style={styles.stepBackBtn}
                    onPress={() => setStep(2)}
                    disabled={paymentProcessing}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="arrow-back" size={16} color={COLORS.text} />
                    <Text style={styles.stepBackBtnTxt}>Back</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.confirmBtn, paymentProcessing && { opacity: 0.7 }]}
                    onPress={handleProcessPayment}
                    disabled={paymentProcessing}
                    activeOpacity={0.85}
                  >
                    {paymentProcessing ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <ActivityIndicator color="#fff" size="small" />
                        <Text style={styles.confirmBtnTxt}>
                          Processing {paymentMethod === 'gcash' ? 'GCash' : 'Maya'}...
                        </Text>
                      </View>
                    ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name="lock-closed" size={15} color="#fff" />
                        <Text style={styles.confirmBtnTxt}>Proceed to Payment ({dynamicFee})</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>

      <LiveCameraModal
        visible={cameraModalVisible}
        onClose={() => setCameraModalVisible(false)}
        onCapture={(uri) => {
          setCustomPhotoUri(uri);
          setSelectedScanId(null);
          setCameraModalVisible(false);
        }}
      />
    </Modal>
  );
}

export default BookingModal;

const styles = StyleSheet.create({
  modalSafe: { flex: 1, backgroundColor: '#f8fafc' },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingRight: 8,
  },
  navBtnTxt: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  navTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
    flex: 1,
    marginHorizontal: 8,
  },
  stepBadge: {
    backgroundColor: '#e0e7ff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  stepBadgeTxt: { fontSize: 11, fontWeight: '800', color: '#4338ca' },

  stepperContainer: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  trackerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  trackerCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackerCircleActive: { backgroundColor: COLORS.primary },
  trackerCircleDone: { backgroundColor: '#10b981' },
  trackerNum: { fontSize: 11, fontWeight: '700', color: '#64748b' },
  trackerNumActive: { color: '#fff' },
  trackerLabel: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  trackerLabelActive: { color: COLORS.primary, fontWeight: '800' },
  trackerConnector: {
    flex: 1,
    height: 2,
    backgroundColor: '#e2e8f0',
    marginHorizontal: 6,
  },
  trackerConnectorDone: { backgroundColor: '#10b981' },
  stepSubtitleTxt: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 6,
    textAlign: 'center',
    fontWeight: '500',
  },

  clinicBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  bannerLogo: { width: 34, height: 34, borderRadius: 8 },
  bannerLogoFallback: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#e0e7ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerClinicName: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  bannerClinicAddr: { fontSize: 11, color: '#64748b', marginTop: 1 },
  bannerFeePill: {
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  bannerFeeTxt: { fontSize: 12, fontWeight: '800', color: '#059669' },

  modalScroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  sectionHeading: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.2,
  },

  fieldGroup: { marginBottom: 12 },
  fieldRow: { flexDirection: 'row', marginBottom: 12 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 5,
  },
  reqAsterisk: { color: '#ef4444' },
  textInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0f172a',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
    paddingTop: 10,
  },

  genderRow: { flexDirection: 'row', gap: 6 },
  genderChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  genderChipActive: {
    backgroundColor: '#eff6ff',
    borderColor: COLORS.primary,
  },
  genderChipTxt: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  genderChipTxtActive: { color: COLORS.primary, fontWeight: '800' },

  relRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  relChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
  },
  relChipActive: {
    backgroundColor: '#eff6ff',
    borderColor: COLORS.primary,
  },
  relChipTxt: { fontSize: 11, fontWeight: '600', color: '#64748b' },
  relChipTxtActive: { color: COLORS.primary, fontWeight: '800' },

  newScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  newScanBtnTxt: { fontSize: 11, fontWeight: '700', color: '#fff' },

  scanNoticeTxt: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 10,
    lineHeight: 16,
  },

  customPhotoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  customPhotoThumb: { width: 50, height: 50, borderRadius: 8 },
  customPhotoTitle: { fontSize: 12, fontWeight: '800', color: COLORS.primary },
  customPhotoSub: { fontSize: 10, color: '#64748b', marginTop: 2 },
  removePhotoBtn: { padding: 4 },

  scanLoadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 12,
  },
  scanLoadingTxt: { fontSize: 12, color: '#64748b' },

  scanEmptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 12,
  },
  scanEmptyTitle: { fontSize: 14, fontWeight: '800', color: '#334155', marginTop: 8 },
  scanEmptySub: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 14,
    lineHeight: 16,
  },
  takeScanCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
  },
  takeScanCtaTxt: { fontSize: 12, fontWeight: '700', color: '#fff' },

  scanGrid: { gap: 8, marginBottom: 14 },
  scanCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 10,
  },
  scanCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
  },
  scanThumb: { width: 48, height: 48, borderRadius: 8 },
  scanThumbFallback: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanConditionName: { fontSize: 13, fontWeight: '800', color: '#0f172a', flex: 1 },
  scanAlias: { fontSize: 11, color: '#64748b', marginTop: 1 },
  scanDateRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  scanDateTxt: { fontSize: 10, color: '#64748b' },
  confidencePill: {
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 6,
  },
  confidencePillSelected: { backgroundColor: '#dcfce7' },
  confidencePillTxt: { fontSize: 10, fontWeight: '800', color: '#059669' },
  scanCheckmark: { marginLeft: 8 },

  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    marginTop: 12,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 3,
  },
  continueBtnTxt: { fontSize: 13.5, fontWeight: '800', color: '#fff', letterSpacing: 0.1 },

  doctorChipGrid: { gap: 8, marginBottom: 12 },
  doctorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 10,
  },
  doctorChipSelected: {
    borderColor: COLORS.primary,
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
  },
  docAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doctorChipName: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  doctorChipNameSelected: { color: COLORS.primary },
  doctorChipSpec: { fontSize: 11, color: '#64748b' },
  doctorChipSpecSelected: { color: '#334155' },
  docDutyText: { fontSize: 10, color: '#10b981', fontWeight: '700', marginTop: 2 },
  noDocBox: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 12,
  },
  noDocTxt: { fontSize: 12, color: '#64748b', fontStyle: 'italic' },

  calendarCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    marginBottom: 12,
  },
  calMonthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  calNavBtn: { padding: 6 },
  calMonthTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  calWeekRow: { flexDirection: 'row', marginBottom: 6 },
  calWeekCell: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
  },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calDayCell: {
    width: '14.28%',
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    position: 'relative',
  },
  calDayCellSelected: { backgroundColor: COLORS.primary },
  calDayCellOutside: { opacity: 0.25 },
  calDayCellDisabled: { opacity: 0.35 },
  calDayNum: { fontSize: 12, fontWeight: '600', color: '#0f172a' },
  calDayNumSelected: { color: '#fff', fontWeight: '800' },
  calDayNumToday: { color: COLORS.primary, fontWeight: '800' },
  calDayNumDisabled: { color: '#94a3b8' },
  onDutyDot: {
    position: 'absolute',
    bottom: 3,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#10b981',
  },
  calLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 3.5 },
  legendText: { fontSize: 11, color: '#64748b' },

  batchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  batchSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    width: '48.5%',
  },
  batchSlotSelected: {
    borderColor: COLORS.primary,
    backgroundColor: '#eff6ff',
    borderWidth: 1.5,
  },
  batchSlotTxt: { fontSize: 11, fontWeight: '600', color: '#334155' },
  batchSlotTxtSelected: { color: COLORS.primary, fontWeight: '800' },

  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    marginBottom: 14,
  },
  summarySlotBox: { marginBottom: 10 },
  summarySlotLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  summaryDoctorName: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  summaryDoctorSpec: { fontSize: 11, color: '#64748b', marginBottom: 6 },
  summarySlotRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  summarySlotTime: { fontSize: 11, color: '#334155' },

  summaryPatientBox: {
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  summaryPatientName: { fontSize: 12, fontWeight: '700', color: '#0f172a' },
  summaryPatientSub: { fontSize: 11, color: '#64748b', marginTop: 1 },

  summaryDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  summaryDetailKey: { fontSize: 11, color: '#64748b' },
  summaryDetailVal: { fontSize: 12, fontWeight: '700', color: '#0f172a' },

  summaryDivider: { height: 1, backgroundColor: '#f1f5f9', marginVertical: 8 },
  summaryFeeLabel: { fontSize: 12, fontWeight: '800', color: '#0f172a' },
  summaryFeeAmount: { fontSize: 15, fontWeight: '900', color: '#059669' },

  step2ActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  stepBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
  },
  stepBackBtnTxt: { fontSize: 13, fontWeight: '700', color: COLORS.text },
  confirmBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
  },
  confirmBtnTxt: { fontSize: 13, fontWeight: '800', color: '#fff' },

  // Checkout banner
  checkoutBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  checkoutShieldCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#d1fae5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkoutBannerTitle: { fontSize: 13, fontWeight: '800', color: '#065f46' },
  checkoutBannerSub: { fontSize: 10, color: '#047857', marginTop: 1 },
  checkoutSecureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#d1fae5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  checkoutSecureBadgeTxt: { fontSize: 10, fontWeight: '800', color: '#065f46' },

  // E-Wallet selection
  walletMethodRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  walletMethodCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 8,
    position: 'relative',
  },
  walletMethodCardGCashActive: {
    borderColor: '#007DFE',
    backgroundColor: '#eff6ff',
  },
  walletMethodCardMayaActive: {
    borderColor: '#00D632',
    backgroundColor: '#ecfdf5',
  },
  walletLogo: { width: 80, height: 28 },
  walletMethodName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    marginTop: 6,
  },
  walletCheckmark: {
    position: 'absolute',
    top: 6,
    right: 6,
  },

  phoneInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  countryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 11,
  },
  countryFlag: { fontSize: 14 },
  countryCode: { fontSize: 12, fontWeight: '700', color: '#0f172a' },
  phoneHelperTxt: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 4,
  },

  // Receipt
  receiptContainer: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  receiptSuccessIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  receiptSuccessTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0f172a',
    textAlign: 'center',
  },
  receiptSuccessSub: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
    paddingHorizontal: 20,
    lineHeight: 18,
  },
  receiptCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    elevation: 2,
    marginBottom: 20,
  },
  receiptCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  receiptCardTitle: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  receiptRefNumber: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: COLORS.primary,
    fontWeight: '800',
    marginTop: 2,
  },
  receiptPaidBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  receiptPaidBadgeTxt: { fontSize: 10, fontWeight: '900', color: '#059669' },
  receiptDashedLine: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginVertical: 12,
  },
  receiptAmountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  receiptMethodLogo: { width: 50, height: 22 },
  receiptMethodLabel: { fontSize: 12, fontWeight: '800', color: '#0f172a' },
  receiptAccountNum: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#64748b',
  },
  receiptAmountLabel: { fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: '700' },
  receiptAmountValue: { fontSize: 16, fontWeight: '900', color: '#059669' },
  receiptDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  receiptDetailKey: { fontSize: 11, color: '#64748b' },
  receiptDetailVal: { fontSize: 11, fontWeight: '700', color: '#0f172a', textAlign: 'right', flex: 1, marginLeft: 12 },
  receiptFooterNoteBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f8fafc',
    padding: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  receiptFooterNoteTxt: { fontSize: 10, color: '#475569', flex: 1, lineHeight: 14 },
  receiptCtaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 3,
  },
  receiptCtaBtnTxt: { fontSize: 14, fontWeight: '800', color: '#fff' },
});
