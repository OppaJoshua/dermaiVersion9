import React, { type FormEvent, useRef, useState, useEffect, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ShieldX,
  Upload,
  X,
  Loader2,
  Calendar,
  Clock,
  Stethoscope,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  HeartPulse,
  AlertCircle,
  Camera,
  User,
  ZoomIn,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";

export type ClinicDoctorItem = {
  id: string;
  name: string;
  specialization: string;
  photo?: string;
  dutyDays: string[];
  dutyStartTime: string;
  dutyEndTime: string;
  dutySchedule?: Record<string, { startTime: string; endTime: string }>;
  status?: string;
};

function formatTime12h(timeStr: string): string {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  const ampm = (h || 0) >= 12 ? "PM" : "AM";
  const hour = (h || 0) % 12 || 12;
  return `${hour}:${String(m || 0).padStart(2, "0")} ${ampm}`;
}

export function normalizeDayName(d: string): string {
  if (!d) return "";
  const s = String(d).trim().toLowerCase();
  if (s.startsWith("mon")) return "Monday";
  if (s.startsWith("tue")) return "Tuesday";
  if (s.startsWith("wed")) return "Wednesday";
  if (s.startsWith("thu")) return "Thursday";
  if (s.startsWith("fri")) return "Friday";
  if (s.startsWith("sat")) return "Saturday";
  if (s.startsWith("sun")) return "Sunday";
  return d;
}

export function parseDoctorDutyDays(rawDays: any, rawSchedule?: any): string[] {
  let days: string[] = [];

  if (Array.isArray(rawDays)) {
    days = rawDays.map(String).map((d) => d.replace(/["'{}]/g, "").trim()).filter(Boolean);
  } else if (typeof rawDays === "string" && rawDays.trim()) {
    const trimmed = rawDays.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          days = parsed.map(String).map((d) => d.replace(/["'{}]/g, "").trim()).filter(Boolean);
        }
      } catch {}
    } else {
      days = trimmed
        .replace(/^\{|\}$/g, "")
        .split(",")
        .map((s) => s.replace(/["'\\]/g, "").trim())
        .filter(Boolean);
    }
  }

  if (rawSchedule) {
    let schedObj = rawSchedule;
    if (typeof rawSchedule === "string" && rawSchedule.trim().startsWith("{")) {
      try {
        schedObj = JSON.parse(rawSchedule);
      } catch {}
    }
    if (schedObj && typeof schedObj === "object" && !Array.isArray(schedObj)) {
      const schedKeys = Object.keys(schedObj).filter(Boolean);
      if (schedKeys.length > 0 && days.length === 0) {
        days = schedKeys;
      }
    }
  }

  const normalized = days.map(normalizeDayName).filter(Boolean);
  return Array.from(new Set(normalized));
}

export function parseDoctorDutySchedule(rawSched: any): Record<string, { startTime: string; endTime: string }> | undefined {
  if (!rawSched) return undefined;
  let obj = rawSched;
  if (typeof rawSched === "string") {
    try {
      obj = JSON.parse(rawSched);
    } catch {
      return undefined;
    }
  }

  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const result: Record<string, { startTime: string; endTime: string }> = {};
    for (const [day, shift] of Object.entries(obj)) {
      if (shift && typeof shift === "object") {
        const s = shift as any;
        const normDay = normalizeDayName(day);
        result[normDay] = {
          startTime: s.startTime || s.start_time || s.start || "09:00",
          endTime: s.endTime || s.end_time || s.end || "17:00",
        };
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  } else if (Array.isArray(obj)) {
    const result: Record<string, { startTime: string; endTime: string }> = {};
    obj.forEach((it: any) => {
      if (it?.day) {
        const normDay = normalizeDayName(it.day);
        result[normDay] = {
          startTime: it.startTime || it.start_time || it.start || "09:00",
          endTime: it.endTime || it.end_time || it.end || "17:00",
        };
      }
    });
    return Object.keys(result).length > 0 ? result : undefined;
  }
  return undefined;
}

export function isDoctorOnDutyOnDay(doc: ClinicDoctorItem, dayOfWeek: string): boolean {
  if (!doc) return false;
  if (doc.status === "Inactive") return false;
  const target = normalizeDayName(dayOfWeek);

  if (doc.dutySchedule && typeof doc.dutySchedule === "object") {
    const scheduleDays = Object.keys(doc.dutySchedule).map(normalizeDayName);
    if (scheduleDays.length > 0) {
      return scheduleDays.includes(target);
    }
  }

  if (Array.isArray(doc.dutyDays) && doc.dutyDays.length > 0) {
    return doc.dutyDays.some((d) => normalizeDayName(d) === target);
  }

  return !["Saturday", "Sunday"].includes(target);
}

function cleanDocName(name?: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/^(dr|doctor)\.?\s+/i, "")
    .replace(/[.,\-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isDoctorMatch(d1: any, d2: any): boolean {
  if (!d1 || !d2) return false;
  const id1 = String(d1.id || d1.doctor_id || "");
  const id2 = String(d2.id || d2.doctor_id || "");
  if (id1 && id2 && id1 === id2) return true;

  const em1 = String(d1.email || "").toLowerCase().trim();
  const em2 = String(d2.email || "").toLowerCase().trim();
  if (em1 && em2 && em1 === em2) return true;

  const n1 = cleanDocName(d1.name || d1.doctor_name || d1.fullName);
  const n2 = cleanDocName(d2.name || d2.doctor_name || d2.fullName);
  if (n1 && n2) {
    if (n1 === n2) return true;
    if (n1.length >= 3 && n2.length >= 3) {
      if (n1.includes(n2) || n2.includes(n1)) return true;
    }
  }

  return false;
}

export function getDoctorPhoto(doc?: { id?: string; doctor_id?: string; name?: string; email?: string; photo?: string; photo_url?: string } | null): string {
  if (!doc) return "";
  if (doc.photo && typeof doc.photo === "string" && doc.photo.trim().length > 0) {
    return doc.photo;
  }
  if (doc.photo_url && typeof doc.photo_url === "string" && doc.photo_url.trim().length > 0) {
    return doc.photo_url;
  }

  // Cross-reference with doctor accounts added in ClinicDoctorsPage
  try {
    const cached = localStorage.getItem("dermai_clinic_doctors");
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        const match = parsed.find((c: any) => isDoctorMatch(c, doc) && (c.photo || c.photo_url));
        if (match && (match.photo || match.photo_url)) {
          return match.photo || match.photo_url;
        }
      }
    }
  } catch {}

  // Cross-reference with logged in doctor profile
  try {
    const stored = localStorage.getItem("dermai_doctor_profile");
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.photo) {
        const cleanTarget = (doc.name || "").toLowerCase().replace(/^(dr|doctor)\.?\s+/i, "").trim();
        const profName = (parsed.fullName || parsed.name || "").toLowerCase().replace(/^(dr|doctor)\.?\s+/i, "").trim();
        if (cleanTarget && profName && (cleanTarget === profName || cleanTarget.includes(profName) || profName.includes(cleanTarget))) {
          return parsed.photo;
        }
      }
    }
  } catch {}

  return "";
}

type ClinicData = {
  id: string;
  name: string;
  logo?: string;
  address: string;
  phone: string;
  verified: boolean;
  description: string;
  hours: string;
  consultationFee: string;
  doctors: ClinicDoctorItem[];
  conditionsTreated: string[];
  photos?: string[];
};

type ConsultationType = "face-to-face";

interface AppointmentDraft {
  patientName?: string;
  patientEmail?: string;
  patientAddress?: string;
  patientContact?: string;
  patientGender?: string;
  patientBirthdate?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyRelationship?: string;
  notes?: string;
  questionnaireData?: any[];
  aiConditionName?: string;
  aiConfidence?: string;
  skinPhotoPreview?: string;
  photoFileName?: string;
  primaryScanId?: string;
  selectedDate?: string;
  selectedDoctorId?: string;
  selectedTime?: string;
  clinicId?: string;
  fromScan?: boolean;
}

export interface CompletedScanItem {
  id: string; // analysis_id
  conditionName: string;
  localName?: string;
  confidence: number;
  bodyPart?: string;
  scannedAt: string;
  photoUrl?: string;
  imageUrl?: string;
  conditionId?: string;
  questionnaireAnswers?: any;
}

function loadAppointmentDraft(): AppointmentDraft | null {
  try {
    const raw = sessionStorage.getItem("dermai_appointment_draft");
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}


export default function AppointmentPage({ defaultType: _defaultType }: {
  defaultType?: ConsultationType;
}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  // Check if this appointment was initiated explicitly from a Scan Skin result
  const isFromScan = searchParams.get("fromScan") === "1" || !!searchParams.get("scanId");
  const clinicIdFromUrl = searchParams.get("clinic") || "";

  // Specific scan booking context (ONLY used when isFromScan is true)
  const scanContext = useMemo(() => {
    if (!isFromScan) return null;
    try {
      const raw = sessionStorage.getItem("dermai_scan_booking_context");
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  }, [isFromScan]);

  const draft = useMemo(() => loadAppointmentDraft(), []);
  // Draft is only applicable if it matches the current clinic being booked
  const isDraftValid = draft && (!draft.clinicId || draft.clinicId === clinicIdFromUrl);

  // Step 1: Patient Details, Step 2: Schedule & Doctor
  const [currentStep, setCurrentStep] = useState<1 | 2>(() => {
    const stepInUrl = searchParams.get("step");
    if (stepInUrl === "2") {
      const d = loadAppointmentDraft();
      if (d?.patientName && d?.patientContact) return 2;
    }
    return 1;
  });

  // Keep currentStep synchronized with URL history (supports browser Back and Forward)
  useEffect(() => {
    const stepInUrl = searchParams.get("step");
    if (stepInUrl === "2") {
      setCurrentStep(2);
    } else {
      setCurrentStep(1);
    }
  }, [searchParams]);

  const [selectedClinic, setSelectedClinic] = useState<ClinicData | null>(null);
  const [loadingClinic, setLoadingClinic] = useState(true);
  const [showClinicDetailsModal, setShowClinicDetailsModal] = useState(false);
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Patient info fields (initialized with persisted draft values if present)
  const [patientName, setPatientName] = useState<string>(() => (isDraftValid ? draft?.patientName : "") || "");
  const [patientEmail, setPatientEmail] = useState<string>(() => (isDraftValid ? draft?.patientEmail : "") || user?.email || "");
  const [patientAddress, setPatientAddress] = useState<string>(() => (isDraftValid ? draft?.patientAddress : "") || "");
  const [patientContact, setPatientContact] = useState<string>(() => (isDraftValid ? draft?.patientContact : "") || "");
  const [patientGender, setPatientGender] = useState<string>(() => (isDraftValid ? draft?.patientGender : "") || "");
  const [patientBirthdate, setPatientBirthdate] = useState<string>(() => (isDraftValid ? draft?.patientBirthdate : "") || "");
  const [emergencyContactName, setEmergencyContactName] = useState<string>(() => (isDraftValid ? draft?.emergencyContactName : "") || "");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState<string>(() => (isDraftValid ? draft?.emergencyContactPhone : "") || "");
  const [emergencyRelationship, setEmergencyRelationship] = useState<string>(() => (isDraftValid ? draft?.emergencyRelationship : "") || "");
  const [notes, setNotes] = useState<string>(() => (isDraftValid ? draft?.notes : "") || "");
  const [questionnaireData, _setQuestionnaireData] = useState<any[]>(() => {
    if (isDraftValid && Array.isArray(draft?.questionnaireData) && draft.questionnaireData.length > 0) {
      return draft.questionnaireData;
    }
    if (isFromScan && Array.isArray(scanContext?.questionnaire) && scanContext.questionnaire.length > 0) {
      return scanContext.questionnaire;
    }
    return [];
  });

  // Schedule selection fields
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    if (isDraftValid && draft?.selectedDate) return draft.selectedDate;
    const tmrw = new Date();
    tmrw.setDate(tmrw.getDate() + 1);
    return `${tmrw.getFullYear()}-${String(tmrw.getMonth() + 1).padStart(2, "0")}-${String(tmrw.getDate()).padStart(2, "0")}`;
  });
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(() => (isDraftValid ? draft?.selectedDoctorId : "") || "");
  const [selectedTime, setSelectedTime] = useState<string>(() => (isDraftValid ? draft?.selectedTime : "") || "09:00");
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  // Primary AI skin scans of authenticated patient
  const [patientScans, setPatientScans] = useState<CompletedScanItem[]>([]);
  const [loadingScans, setLoadingScans] = useState<boolean>(true);
  const [selectedScanId, setSelectedScanId] = useState<string>(() => {
    const urlScanId = searchParams.get("scanId");
    if (urlScanId) return urlScanId;
    if (isDraftValid && draft?.primaryScanId) return draft.primaryScanId;
    return "";
  });
  const [submitted, setSubmitted] = useState(false);

  const selectedScan = useMemo(() => {
    return patientScans.find((s) => s.id === selectedScanId) || null;
  }, [patientScans, selectedScanId]);

  useEffect(() => {
    let cancelled = false;

    async function loadPatientScans() {
      if (!user?.id) {
        setPatientScans([]);
        setLoadingScans(false);
        return;
      }

      setLoadingScans(true);
      try {
        const { data, error } = await supabase
          .from("ai_scan_result")
          .select(`
            analysis_id,
            confidence_score,
            body_part,
            scanned_at,
            photo_url,
            condition_id,
            questionnaire_answers,
            skin_condition:condition_id (
              name,
              local_name
            )
          `)
          .eq("user_id", user.id)
          .eq("status", "completed")
          .order("scanned_at", { ascending: false });

        if (cancelled) return;

        if (error) {
          console.error("Failed to load completed AI scans:", error.message);
          setPatientScans([]);
          setLoadingScans(false);
          return;
        }

        const resolvedList: CompletedScanItem[] = await Promise.all(
          (data || []).map(async (row: any) => {
            const cond = Array.isArray(row.skin_condition) ? row.skin_condition[0] : row.skin_condition;
            let displayUrl = row.photo_url || "";

            if (row.photo_url && !row.photo_url.startsWith("http") && !row.photo_url.startsWith("data:")) {
              try {
                const { data: signedData } = await supabase.storage
                  .from("scan-uploads")
                  .createSignedUrl(row.photo_url, 3600);
                if (signedData?.signedUrl) {
                  displayUrl = signedData.signedUrl;
                }
              } catch {}
            }

            return {
              id: String(row.analysis_id),
              conditionName: cond?.name || "Skin Assessment",
              localName: cond?.local_name || undefined,
              confidence: Number(row.confidence_score) || 0,
              bodyPart: row.body_part || "Skin Assessment",
              scannedAt: row.scanned_at,
              photoUrl: row.photo_url || "",
              imageUrl: displayUrl,
              conditionId: row.condition_id || undefined,
              questionnaireAnswers: row.questionnaire_answers || null,
            };
          })
        );

        if (!cancelled) {
          setPatientScans(resolvedList);

          // If a scanId was passed in URL, booking context, or draft, select it ONLY IF it belongs to the verified scan list
          const requestedScanId =
            searchParams.get("scanId") ||
            scanContext?.scanId ||
            (isDraftValid ? draft?.primaryScanId : "");
          if (requestedScanId && resolvedList.some((s) => s.id === requestedScanId)) {
            setSelectedScanId(requestedScanId);
          } else if (selectedScanId && !resolvedList.some((s) => s.id === selectedScanId)) {
            setSelectedScanId("");
          }
        }
      } catch (err) {
        console.error("Error fetching patient scans:", err);
      } finally {
        if (!cancelled) setLoadingScans(false);
      }
    }

    loadPatientScans();

    return () => {
      cancelled = true;
    };
  }, [user?.id, scanContext?.scanId, searchParams]);

  const handlePerformNewScan = () => {
    const targetClinic = selectedClinic?.id || clinicIdFromUrl || searchParams.get("clinic") || "";
    try {
      const dataToSave = {
        patientName,
        patientEmail,
        patientAddress,
        patientContact,
        patientGender,
        patientBirthdate,
        emergencyContactName,
        emergencyContactPhone,
        emergencyRelationship,
        notes,
        primaryScanId: selectedScanId,
        selectedDate,
        selectedDoctorId,
        selectedTime,
        clinicId: targetClinic,
        fromScan: isFromScan,
      };
      sessionStorage.setItem("dermai_appointment_draft", JSON.stringify(dataToSave));
      if (targetClinic) {
        sessionStorage.setItem("dermai_booking_return_clinic", String(targetClinic));
      }
    } catch {}
    const targetUrl = targetClinic
      ? `/dashboard/scan?fromAppointment=1&clinic=${encodeURIComponent(targetClinic)}`
      : `/dashboard/scan?fromAppointment=1`;
    navigate(targetUrl);
  };

  // Continuously persist entered appointment/patient details so going back/forward never resets data
  useEffect(() => {
    try {
      const dataToSave = {
        patientName,
        patientEmail,
        patientAddress,
        patientContact,
        patientGender,
        patientBirthdate,
        emergencyContactName,
        emergencyContactPhone,
        emergencyRelationship,
        notes,
        questionnaireData: selectedScan?.questionnaireAnswers || questionnaireData,
        aiConditionName: selectedScan?.conditionName || "",
        aiConfidence: selectedScan?.confidence ? String(selectedScan.confidence) : "",
        skinPhotoPreview: selectedScan?.imageUrl || "",
        photoFileName: selectedScan?.photoUrl || "",
        primaryScanId: selectedScanId,
        selectedDate,
        selectedDoctorId,
        selectedTime,
        clinicId: selectedClinic?.id || searchParams.get("clinic") || "",
        fromScan: isFromScan,
      };
      sessionStorage.setItem("dermai_appointment_draft", JSON.stringify(dataToSave));
    } catch {
      try {
        const fallbackData = {
          patientName,
          patientEmail,
          patientAddress,
          patientContact,
          patientGender,
          patientBirthdate,
          emergencyContactName,
          emergencyContactPhone,
          emergencyRelationship,
          notes,
          primaryScanId: selectedScanId,
          selectedDate,
          selectedDoctorId,
          selectedTime,
          clinicId: selectedClinic?.id || searchParams.get("clinic") || "",
          fromScan: isFromScan,
        };
        sessionStorage.setItem("dermai_appointment_draft", JSON.stringify(fallbackData));
      } catch {}
    }
  }, [
    patientName,
    patientEmail,
    patientAddress,
    patientContact,
    patientGender,
    patientBirthdate,
    emergencyContactName,
    emergencyContactPhone,
    emergencyRelationship,
    notes,
    questionnaireData,
    selectedScanId,
    selectedScan,
    selectedDate,
    selectedDoctorId,
    selectedTime,
    selectedClinic?.id,
    isFromScan,
    searchParams,
  ]);

  // Calculate patient age from birthdate
  const patientAge = useMemo(() => {
    if (!patientBirthdate) return null;
    const dob = new Date(patientBirthdate);
    if (isNaN(dob.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) {
      age--;
    }
    return age >= 0 ? age : null;
  }, [patientBirthdate]);

  // Generate calendar days for the current calendarMonth (42 cells to support full 6 weeks)
  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDayOffset = (firstDay.getDay() + 6) % 7;
    const gridStart = new Date(firstDay);
    gridStart.setDate(firstDay.getDate() - startDayOffset);

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + 60);

    const doctors = selectedClinic?.doctors || [];

    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const inCurrentMonth = d.getMonth() === month;
      const isPast = dateStr < todayStr;
      const isTooFar = d > maxDate;
      const isDisabled = isPast || isTooFar;
      const isToday = dateStr === todayStr;

      const dayOfWeek = d.toLocaleDateString("en-US", { weekday: "long" });
      const onDutyDocs = doctors.filter((doc) => isDoctorOnDutyOnDay(doc, dayOfWeek));
      const hasDoctorsOnDuty = onDutyDocs.length > 0;

      return {
        dateStr,
        dayNum: d.getDate(),
        dayOfWeek,
        inCurrentMonth,
        isPast,
        isDisabled,
        isToday,
        onDutyDocs,
        hasDoctorsOnDuty,
      };
    });
  }, [calendarMonth, selectedClinic?.doctors]);

  // Determine day of week for selectedDate (e.g. "Monday", "Wednesday")
  const dayOfWeekForSelectedDate = useMemo(() => {
    if (!selectedDate) return "";
    try {
      const [y, m, d] = selectedDate.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      return dt.toLocaleDateString("en-US", { weekday: "long" });
    } catch {
      return "";
    }
  }, [selectedDate]);

  // Filter doctors who are on duty on this day of week
  const onDutyDoctorsForDate = useMemo(() => {
    if (!selectedClinic?.doctors || selectedClinic.doctors.length === 0) return [];
    if (!dayOfWeekForSelectedDate) return [];

    const matched = selectedClinic.doctors.filter((doc) =>
      isDoctorOnDutyOnDay(doc, dayOfWeekForSelectedDate)
    );

    return matched;
  }, [selectedClinic?.doctors, dayOfWeekForSelectedDate]);

  // Active chosen doctor on duty
  const activeDutyDoctor = useMemo<ClinicDoctorItem | null>(() => {
    if (onDutyDoctorsForDate.length === 0) {
      return null;
    }
    const found = onDutyDoctorsForDate.find((d) => d.id === selectedDoctorId);
    return found || onDutyDoctorsForDate[0];
  }, [onDutyDoctorsForDate, selectedDoctorId]);

  // Sync selectedDoctorId when onDutyDoctorsForDate updates
  useEffect(() => {
    if (onDutyDoctorsForDate.length > 0) {
      if (!onDutyDoctorsForDate.some((d) => d.id === selectedDoctorId)) {
        setSelectedDoctorId(onDutyDoctorsForDate[0].id);
      }
    }
  }, [onDutyDoctorsForDate, selectedDoctorId]);

  // Doctor consultation schedule hours for selected date
  const activeDoctorHours = useMemo(() => {
    if (!activeDutyDoctor) {
      return "General Consultation (Clinic Queue)";
    }
    const shift =
      activeDutyDoctor.dutySchedule &&
      dayOfWeekForSelectedDate &&
      activeDutyDoctor.dutySchedule[dayOfWeekForSelectedDate]
        ? activeDutyDoctor.dutySchedule[dayOfWeekForSelectedDate]
        : { startTime: activeDutyDoctor.dutyStartTime || "09:00", endTime: activeDutyDoctor.dutyEndTime || "17:00" };
    return `${formatTime12h(shift.startTime)} – ${formatTime12h(shift.endTime)}`;
  }, [activeDutyDoctor, dayOfWeekForSelectedDate]);

  // Consultation Batches and Real-time Slot Availability (NowServing model)
  const BATCH_CAPACITY = 3;

  type ConsultationBatch = {
    batchTime: string; // e.g. "09:00"
    label: string; // e.g. "09:00 AM Batch"
    timeRange: string; // e.g. "09:00 AM – 10:00 AM"
    totalSlots: number;
    bookedCount: number;
    availableSlots: number;
    isFull: boolean;
    nextQueueNumber: number;
    estimatedWindow: string;
  };

  const [existingBookings, setExistingBookings] = useState<any[]>([]);
  const [_loadingBookings, setLoadingBookings] = useState(false);

  // Fetch real-time active bookings for the chosen date and doctor
  useEffect(() => {
    let cancelled = false;
    async function fetchBookings() {
      if (!selectedDate) return;
      setLoadingBookings(true);
      try {
        const docId = activeDutyDoctor?.id;
        const clinicId = selectedClinic?.id;

        let query = supabase
          .from("patient_appointment")
          .select("appointment_id, date, batch_time, queue_number, status, doctor_status")
          .neq("status", "cancelled")
          .neq("status", "rejected");

        if (docId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(docId)) {
          query = query.eq("assigned_doctor_id", docId);
        } else if (clinicId) {
          query = query.eq("clinic_id", clinicId);
        }

        const { data, error } = await query;
        if (!cancelled && data && !error) {
          const matched = data.filter((row: any) => {
            if (!row.date) return false;
            return String(row.date).startsWith(selectedDate);
          });
          setExistingBookings(matched);
        }
      } catch (e) {
        console.warn("Could not query existing doctor bookings:", e);
      } finally {
        if (!cancelled) setLoadingBookings(false);
      }
    }
    fetchBookings();
    return () => {
      cancelled = true;
    };
  }, [selectedDate, activeDutyDoctor?.id, selectedClinic?.id]);

  // Dynamically compute 1-hour consultation batches within the attending doctor's duty shift
  const consultationBatches = useMemo<ConsultationBatch[]>(() => {
    let startH = 8;
    let endH = 20;

    if (activeDutyDoctor) {
      const shift =
        activeDutyDoctor.dutySchedule &&
        dayOfWeekForSelectedDate &&
        activeDutyDoctor.dutySchedule[dayOfWeekForSelectedDate]
          ? activeDutyDoctor.dutySchedule[dayOfWeekForSelectedDate]
          : { startTime: activeDutyDoctor.dutyStartTime || "09:00", endTime: activeDutyDoctor.dutyEndTime || "17:00" };

      startH = parseInt(shift.startTime.split(":")[0], 10) || 9;
      endH = parseInt(shift.endTime.split(":")[0], 10) || 17;
    } else if (selectedClinic?.hours) {
      // Parse clinic operating hours (e.g. "8:00 AM – 8:00 PM")
      const match = selectedClinic.hours.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*[-–—]\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (match) {
        let opH = parseInt(match[1], 10);
        const opAmpm = match[3].toUpperCase();
        if (opAmpm === "PM" && opH < 12) opH += 12;
        if (opAmpm === "AM" && opH === 12) opH = 0;

        let clH = parseInt(match[4], 10);
        const clAmpm = match[6].toUpperCase();
        if (clAmpm === "PM" && clH < 12) clH += 12;
        if (clAmpm === "AM" && clH === 12) clH = 0;

        if (clH > opH) {
          startH = opH;
          endH = clH;
        }
      }
    }

    if (endH <= startH) endH = startH + 8;

    const batches: ConsultationBatch[] = [];
    for (let h = startH; h < endH; h++) {
      const batchTime = `${String(h).padStart(2, "0")}:00`;
      const nextH = h + 1;
      const timeRange = `${formatTime12h(batchTime)} – ${formatTime12h(`${String(nextH).padStart(2, "0")}:00`)}`;

      // Count active bookings in this batch
      const bookedInBatch = existingBookings.filter((b) => {
        if (b.batch_time) {
          return b.batch_time === batchTime || b.batch_time.startsWith(`${String(h).padStart(2, "0")}:`);
        }
        if (b.date) {
          const dObj = new Date(b.date);
          return !isNaN(dObj.getTime()) && dObj.getHours() === h;
        }
        return false;
      });

      const bookedCount = bookedInBatch.length;
      const availableSlots = Math.max(0, BATCH_CAPACITY - bookedCount);
      const isFull = availableSlots === 0;
      const nextQueueNumber = isFull ? BATCH_CAPACITY : bookedCount + 1;

      // Estimated window for the next queue (e.g. #1: 00-20, #2: 20-40, #3: 40-60)
      const slotIndex = isFull ? BATCH_CAPACITY - 1 : bookedCount;
      const estStartM = slotIndex * 20;
      const estEndM = (slotIndex + 1) * 20;
      const estStartStr = formatTime12h(`${String(h).padStart(2, "0")}:${String(estStartM).padStart(2, "0")}`);
      const estEndStr = formatTime12h(
        estEndM === 60 ? `${String(nextH).padStart(2, "0")}:00` : `${String(h).padStart(2, "0")}:${String(estEndM).padStart(2, "0")}`
      );

      batches.push({
        batchTime,
        label: `${formatTime12h(batchTime)} Batch`,
        timeRange,
        totalSlots: BATCH_CAPACITY,
        bookedCount,
        availableSlots,
        isFull,
        nextQueueNumber,
        estimatedWindow: `${estStartStr} – ${estEndStr}`,
      });
    }

    return batches;
  }, [activeDutyDoctor, dayOfWeekForSelectedDate, existingBookings]);


  // Keep selectedTime synchronized to first available batch
  useEffect(() => {
    if (consultationBatches.length > 0) {
      const match = consultationBatches.find((b) => b.batchTime === selectedTime);
      if (!match || match.isFull) {
        const firstAvail = consultationBatches.find((b) => !b.isFull) || consultationBatches[0];
        if (firstAvail && firstAvail.batchTime !== selectedTime) {
          setSelectedTime(firstAvail.batchTime);
        }
      }
    }
  }, [consultationBatches, selectedTime]);

  const selectedBatch = useMemo<ConsultationBatch | null>(() => {
    if (consultationBatches.length === 0) return null;
    return consultationBatches.find((b) => b.batchTime === selectedTime) || consultationBatches[0];
  }, [consultationBatches, selectedTime]);

  const formattedPreviewDate = useMemo(() => {
    if (!selectedDate) return "Select date";
    try {
      const [y, m, d] = selectedDate.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      return dt.toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    } catch {
      return selectedDate;
    }
  }, [selectedDate]);

  const formattedPreviewTime = useMemo(() => {
    return selectedBatch ? selectedBatch.label : selectedTime ? formatTime12h(selectedTime) : activeDoctorHours;
  }, [selectedBatch, selectedTime, activeDoctorHours]);

  // Note: AI condition, confidence, questionnaire, and photo are cleanly initialized
  // in useState from draft / scanContext, avoiding harmful overwrites on step navigation.

  // Fetch approved clinic strictly from database with rich details
  useEffect(() => {
    let cancelled = false;
    async function loadClinic() {
      setLoadingClinic(true);
      const clinicIdFromUrl = searchParams.get("clinic");

      if (!clinicIdFromUrl) {
        setLoadingClinic(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("clinic")
          .select(`
            clinic_id,
            name,
            logo_url,
            district,
            address,
            phone,
            email,
            status,
            description,
            consultation_fee,
            clinic_photo ( photo_url, sort_order ),
            clinic_service_offered ( service_name ),
            clinic_operating_hours ( day_of_week, open_time, close_time )
          `)
          .eq("clinic_id", clinicIdFromUrl)
          .maybeSingle();

        // Fetch doctors with resilient query and local cache fallback
        let rawDoctorRows: any[] = [];
        try {
          const { data: docRows1, error: err1 } = await supabase
            .from("clinic_doctor")
            .select("*")
            .eq("clinic_id", clinicIdFromUrl);

          if (!err1 && Array.isArray(docRows1) && docRows1.length > 0) {
            rawDoctorRows = docRows1;
          } else if (data?.clinic_id && String(data.clinic_id) !== String(clinicIdFromUrl)) {
            const { data: docRows2 } = await supabase
              .from("clinic_doctor")
              .select("*")
              .eq("clinic_id", data.clinic_id);

            if (Array.isArray(docRows2) && docRows2.length > 0) {
              rawDoctorRows = docRows2;
            }
          }
        } catch (docErr) {
          console.warn("Direct clinic_doctor fetch error:", docErr);
        }

        // Fallback to local storage cache if database returned no doctors
        if (rawDoctorRows.length === 0) {
          try {
            const rawDocs = localStorage.getItem("dermai_clinic_doctors");
            if (rawDocs) {
              const parsedDocs = JSON.parse(rawDocs);
              if (Array.isArray(parsedDocs) && parsedDocs.length > 0) {
                const targetClinicName = (data?.name || "").toLowerCase().trim();
                const targetClinicId = String(data?.clinic_id || clinicIdFromUrl || "").toLowerCase().trim();

                const matched = parsedDocs.filter((d: any) => {
                  const statusLower = String(d.status || "active").toLowerCase();
                  if (statusLower === "inactive") return false;
                  if (!d.name && !d.doctor_name) return false;

                  const docClinicName = (d.clinicName || d.clinic_name || "").toLowerCase().trim();
                  if (targetClinicName && docClinicName && targetClinicName === docClinicName) return true;

                  const docClinicId = String(d.clinicId || d.clinic_id || "").toLowerCase().trim();
                  if (targetClinicId && docClinicId && targetClinicId === docClinicId) return true;

                  return true;
                });

                if (matched.length > 0) {
                  rawDoctorRows = matched;
                } else {
                  rawDoctorRows = parsedDocs.filter((d: any) => String(d.status || "active").toLowerCase() !== "inactive");
                }
              }
            }
          } catch {}
        }

        // Map raw doctor rows to ClinicDoctorItem objects
        let doctorsList: ClinicDoctorItem[] = rawDoctorRows
          .filter((d: any) => {
            const st = String(d.status || "active").toLowerCase();
            return st !== "inactive" && (d.doctor_name || d.name);
          })
          .map((d: any) => {
            const docName = d.doctor_name || d.name || "Attending Dermatologist";

            let pDays = parseDoctorDutyDays(d.duty_days || d.dutyDays, d.duty_schedule || d.dutySchedule);
            let parsedSched = parseDoctorDutySchedule(d.duty_schedule || d.dutySchedule);
            let startT = d.duty_start_time || d.dutyStartTime || "09:00";
            let endT = d.duty_end_time || d.dutyEndTime || "17:00";

            // Live synchronization with clinic roster settings
            try {
              const rawDocs = localStorage.getItem("dermai_clinic_doctors");
              if (rawDocs) {
                const parsed = JSON.parse(rawDocs);
                if (Array.isArray(parsed)) {
                  const match = parsed.find((cd: any) => isDoctorMatch(cd, d));
                  if (match) {
                    const localDays = parseDoctorDutyDays(match.dutyDays || match.duty_days, match.dutySchedule || match.duty_schedule);
                    if (localDays.length > 0) {
                      pDays = localDays;
                    }
                    const localSched = parseDoctorDutySchedule(match.dutySchedule || match.duty_schedule);
                    if (localSched) {
                      parsedSched = { ...(parsedSched || {}), ...localSched };
                    }
                    if (match.dutyStartTime) startT = match.dutyStartTime;
                    if (match.dutyEndTime) endT = match.dutyEndTime;
                  }
                }
              }
            } catch {}

            // If duty days are unconfigured, inherit from custom schedule days or weekdays
            if (pDays.length === 0) {
              if (parsedSched && Object.keys(parsedSched).length > 0) {
                pDays = Object.keys(parsedSched);
              } else {
                pDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
              }
            }

            let specStr = "General Dermatology";
            if (d.specialization && typeof d.specialization === "string") {
              specStr = d.specialization;
            } else if (Array.isArray(d.specializations) && d.specializations.length > 0) {
              specStr = d.specializations.map((s: any) => s.name || s).filter(Boolean).join(", ");
            }

            let resolvedPhoto = d.photo_url || d.photo || d.photoUrl || d.user?.avatar_url || d.avatar_url;
            if (!resolvedPhoto) {
              resolvedPhoto = getDoctorPhoto({ id: d.doctor_id || d.id, name: docName, email: d.email });
            }

            return {
              id: String(d.doctor_id || d.id || `doc-${docName}`),
              name: docName,
              specialization: specStr,
              photo: resolvedPhoto || undefined,
              dutyDays: pDays,
              dutyStartTime: startT,
              dutyEndTime: endT,
              dutySchedule: parsedSched,
              status: d.status || "Active",
            };
          });

        if (!cancelled && !error && data) {
          let hoursStr = "";
          if (Array.isArray(data.clinic_operating_hours) && data.clinic_operating_hours.length > 0) {
            const h = data.clinic_operating_hours[0];
            const op = h.open_time ? formatTime12h(h.open_time) : "8:00 AM";
            const cl = h.close_time ? formatTime12h(h.close_time) : "5:00 PM";
            hoursStr = `${h.day_of_week || "Monday - Saturday"}: ${op} – ${cl}`.trim();
          }

          let servicesList: string[] = [];
          if (Array.isArray(data.clinic_service_offered)) {
            servicesList = data.clinic_service_offered
              .map((s: any) => (typeof s === "string" ? s : s.service_name))
              .filter(Boolean);
          }

          let photosList: string[] = [];
          if (Array.isArray(data.clinic_photo) && data.clinic_photo.length > 0) {
            photosList = data.clinic_photo
              .map((p: any) => (typeof p === "string" ? p : p?.photo_url))
              .filter(Boolean);
          }

          let logoUrl = data.logo_url || "";
          let clinicFee = data.consultation_fee ? String(data.consultation_fee) : "500";
          let clinicAddress = data.address || data.district || "";
          let clinicPhone = data.phone || "";
          let clinicDesc = (data.description || "").trim();

          if (!logoUrl || photosList.length === 0) {
            try {
              const appsRaw = localStorage.getItem("dermai_clinic_applications");
              if (appsRaw) {
                const apps = JSON.parse(appsRaw);
                if (Array.isArray(apps)) {
                  const matched = apps.find((a: any) =>
                    String(a.id) === String(data.clinic_id) ||
                    (a.name && data.name && a.name.toLowerCase().trim() === data.name.toLowerCase().trim())
                  );
                  if (matched?.logo && !logoUrl) logoUrl = matched.logo;
                  if (photosList.length === 0 && Array.isArray(matched?.clinicPhotos)) {
                    photosList = matched.clinicPhotos.filter(Boolean);
                  }
                  if (matched?.hours && !hoursStr) hoursStr = matched.hours;
                }
              }
            } catch {}
          }

          // Overlay real-time clinic settings
          try {
            const settRaw = localStorage.getItem("dermai_clinic_settings");
            if (settRaw) {
              const sett = JSON.parse(settRaw);
              const isMatch = (sett.id && String(sett.id) === String(data.clinic_id)) ||
                (sett.name && data.name && sett.name.toLowerCase().trim() === data.name.toLowerCase().trim()) ||
                (sett.email && data.email && sett.email.toLowerCase().trim() === data.email.toLowerCase().trim());
              if (isMatch) {
                if (sett.operatingDays || sett.openTime || sett.closeTime) {
                  const oDays = sett.operatingDays || "Monday - Saturday";
                  const oOpen = sett.openTime ? formatTime12h(sett.openTime) : "8:00 AM";
                  const oClose = sett.closeTime ? formatTime12h(sett.closeTime) : "5:00 PM";
                  hoursStr = `${oDays}: ${oOpen} – ${oClose}`;
                }
                if (sett.consultationFee) clinicFee = String(sett.consultationFee);
                if (sett.address) clinicAddress = sett.address;
                if (sett.phone) clinicPhone = sett.phone;
                if (sett.description) clinicDesc = sett.description;
                if (sett.logo) logoUrl = sett.logo;
              }
            }
          } catch {}

          setSelectedClinic({
            id: String(data.clinic_id),
            name: data.name || "Clinic",
            logo: logoUrl,
            address: clinicAddress,
            phone: clinicPhone,
            verified: true,
            description: clinicDesc,
            hours: hoursStr,
            consultationFee: clinicFee,
            doctors: doctorsList,
            conditionsTreated: servicesList,
            photos: photosList,
          });
        } else if (!cancelled) {
          // Fallback query if nested relations were not available
          const { data: simpleData } = await supabase
            .from("clinic")
            .select("clinic_id, name, logo_url, district, address, phone, status, description, consultation_fee")
            .eq("clinic_id", clinicIdFromUrl)
            .maybeSingle();

          if (simpleData) {
            let logoUrl = simpleData.logo_url || "";
            let photosList: string[] = [];
            let hoursStr = "";
            let clinicFee = simpleData.consultation_fee ? String(simpleData.consultation_fee) : "500";
            let clinicAddress = simpleData.address || simpleData.district || "";
            let clinicPhone = simpleData.phone || "";
            let clinicDesc = (simpleData.description || "").trim();

            try {
              const { data: pRows } = await supabase
                .from("clinic_photo")
                .select("photo_url")
                .eq("clinic_id", clinicIdFromUrl)
                .order("sort_order");
              if (pRows && pRows.length > 0) {
                photosList = pRows.map((p: any) => p.photo_url).filter(Boolean);
              }
            } catch {}

            try {
              const settRaw = localStorage.getItem("dermai_clinic_settings");
              if (settRaw) {
                const sett = JSON.parse(settRaw);
                if (sett.operatingDays || sett.openTime || sett.closeTime) {
                  const oDays = sett.operatingDays || "Monday - Saturday";
                  const oOpen = sett.openTime ? formatTime12h(sett.openTime) : "8:00 AM";
                  const oClose = sett.closeTime ? formatTime12h(sett.closeTime) : "5:00 PM";
                  hoursStr = `${oDays}: ${oOpen} – ${oClose}`;
                }
                if (sett.consultationFee) clinicFee = String(sett.consultationFee);
                if (sett.address) clinicAddress = sett.address;
                if (sett.phone) clinicPhone = sett.phone;
                if (sett.description) clinicDesc = sett.description;
                if (sett.logo) logoUrl = sett.logo;
              }
            } catch {}

            setSelectedClinic({
              id: String(simpleData.clinic_id),
              name: simpleData.name || "Clinic",
              logo: logoUrl,
              address: clinicAddress,
              phone: clinicPhone,
              verified: true,
              description: clinicDesc,
              hours: hoursStr,
              consultationFee: clinicFee,
              doctors: doctorsList,
              conditionsTreated: [],
              photos: photosList,
            });
          }
        }
      } catch (err) {
        console.error("Error loading clinic for booking:", err);
      } finally {
        if (!cancelled) setLoadingClinic(false);
      }
    }

    loadClinic();

    const handleSync = () => loadClinic();
    window.addEventListener("storage", handleSync);
    window.addEventListener("clinicSettingsUpdated", handleSync);
    window.addEventListener("dermai_clinic_updated", handleSync);
    window.addEventListener("dermai_doctors_updated", handleSync);

    return () => {
      cancelled = true;
      window.removeEventListener("storage", handleSync);
      window.removeEventListener("clinicSettingsUpdated", handleSync);
      window.removeEventListener("dermai_clinic_updated", handleSync);
      window.removeEventListener("dermai_doctors_updated", handleSync);
    };
  }, [searchParams]);

  // Auto-fill patient information from authenticated session and profile
  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    const userEmail = user.email;
    let cancelled = false;

    async function loadUserProfile() {
      if (userEmail) {
        setPatientEmail((prev) => prev || userEmail || "");
      }
      try {
        const { data: prof } = await supabase
          .from("user")
          .select("full_name, phone, address, district, gender, birthdate")
          .eq("user_id", userId)
          .maybeSingle();

        if (cancelled) return;
        if (prof) {
          if (prof.full_name) setPatientName((prev) => prev || prof.full_name);
          if (prof.phone) setPatientContact((prev) => prev || prof.phone);
          if (prof.address || prof.district) setPatientAddress((prev) => prev || prof.address || prof.district);
          if (prof.gender) setPatientGender((prev) => prev || prof.gender);
          if (prof.birthdate) setPatientBirthdate((prev) => prev || prof.birthdate);
        }

        const localProfile = localStorage.getItem(`derm_profile_${userId}`);
        if (localProfile) {
          const parsed = JSON.parse(localProfile);
          if (parsed.fullName) setPatientName((prev) => prev || parsed.fullName);
          if (parsed.contactNumber) setPatientContact((prev) => prev || parsed.contactNumber);
          if (parsed.address || parsed.district) setPatientAddress((prev) => prev || parsed.address || parsed.district);
          if (parsed.gender) setPatientGender((prev) => prev || parsed.gender);
          if (parsed.birthdate) setPatientBirthdate((prev) => prev || parsed.birthdate);
          if (parsed.emergencyContactName) setEmergencyContactName((prev) => prev || parsed.emergencyContactName);
          if (parsed.emergencyContactPhone || parsed.emergencyPhone) setEmergencyContactPhone((prev) => prev || parsed.emergencyContactPhone || parsed.emergencyPhone);
          if (parsed.emergencyRelationship) setEmergencyRelationship((prev) => prev || parsed.emergencyRelationship);
        }

        const meta = user?.user_metadata || {};
        if (meta.full_name) setPatientName((prev) => prev || meta.full_name);
        if (meta.phone) setPatientContact((prev) => prev || meta.phone);
        if (meta.address) setPatientAddress((prev) => prev || meta.address);
        if (meta.emergency_contact_name) setEmergencyContactName((prev) => prev || meta.emergency_contact_name);
        if (meta.emergency_contact_phone) setEmergencyContactPhone((prev) => prev || meta.emergency_contact_phone);
        if (meta.emergency_relationship) setEmergencyRelationship((prev) => prev || meta.emergency_relationship);
      } catch {}
    }

    loadUserProfile();
    return () => { cancelled = true; };
  }, [user]);


  // Step Validation logic
  const validateStep = (stepNumber: number): boolean => {
    setSubmitError(null);
    if (stepNumber === 1) {
      if (!patientName.trim()) {
        setSubmitError("Please enter your full name.");
        return false;
      }
      if (!patientEmail.trim()) {
        setSubmitError("Please enter your email address.");
        return false;
      }
      if (!patientContact.trim()) {
        setSubmitError("Please enter your contact phone number.");
        return false;
      }
      if (patientContact.trim().length !== 11) {
        setSubmitError("Patient phone number must be exactly 11 digits (e.g. 09171234567).");
        return false;
      }
      if (!patientAddress.trim()) {
        setSubmitError("Please enter your city / address.");
        return false;
      }
      if (!patientGender) {
        setSubmitError("Please select your gender.");
        return false;
      }
      if (!patientBirthdate) {
        setSubmitError("Please provide your date of birth.");
        return false;
      }
      if (!emergencyContactName.trim()) {
        setSubmitError("Please enter your emergency contact's full name.");
        return false;
      }
      if (!emergencyContactPhone.trim()) {
        setSubmitError("Please enter your emergency contact's phone number.");
        return false;
      }
      if (emergencyContactPhone.trim().length !== 11) {
        setSubmitError("Emergency contact phone number must be exactly 11 digits (e.g. 09171234567).");
        return false;
      }
      if (!emergencyRelationship.trim()) {
        setSubmitError("Please select your relationship with the emergency contact.");
        return false;
      }
      if (!selectedScanId || !selectedScan) {
        setSubmitError("Please select a completed AI skin scan for this appointment.");
        return false;
      }
      return true;
    }

    if (stepNumber === 2) {
      if (!selectedDate) {
        setSubmitError("Please select an appointment date on the calendar.");
        return false;
      }
      return true;
    }

    return true;
  };

  const handleNextStep = () => {
    if (validateStep(1)) {
      setCurrentStep(2);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("step", "2");
        return next;
      }, { replace: false });
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handlePrevStep = () => {
    setSubmitError(null);
    setCurrentStep(1);
    if (searchParams.get("step") === "2") {
      if (window.history.length > 1) {
        navigate(-1);
      } else {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete("step");
          return next;
        }, { replace: true });
      }
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Appointment Submission to Supabase & local cache
  const handleSubmitAppointment = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    setSubmitError(null);

    if (!validateStep(1) || !validateStep(2) || !selectedClinic) {
      return;
    }

    let activeUserId = user?.id;
    if (!activeUserId) {
      try {
        const { data: sess } = await supabase.auth.getSession();
        activeUserId = sess.session?.user?.id;
      } catch { }
    }

    if (!activeUserId) {
      setSubmitError("You must be logged in to book an appointment. Redirecting to login...");
      setTimeout(() => {
        navigate("/login", { state: { from: window.location.pathname + window.location.search } });
      }, 1200);
      return;
    }

    if (!selectedScanId) {
      setSubmitError("Please select a primary AI skin scan for this appointment.");
      return;
    }

    setSubmitting(true);
    try {
      // 1. Strictly verify scan ownership and completion status in database
      const { data: verifiedScan, error: verifyError } = await supabase
        .from("ai_scan_result")
        .select(`
          analysis_id,
          confidence_score,
          body_part,
          scanned_at,
          photo_url,
          condition_id,
          questionnaire_answers,
          user_id,
          status,
          skin_condition:condition_id (
            name,
            local_name
          )
        `)
        .eq("analysis_id", selectedScanId)
        .eq("user_id", activeUserId)
        .eq("status", "completed")
        .maybeSingle();

      if (verifyError || !verifiedScan) {
        setSubmitError("The selected AI skin scan is invalid or does not belong to your account.");
        setSubmitting(false);
        return;
      }

      // 2. Prepare appointment payload
      let targetClinicId: any = selectedClinic.id;
      if (/^\d+$/.test(String(selectedClinic.id))) {
        targetClinicId = Number(selectedClinic.id);
      }

      const verifiedCondObj = Array.isArray(verifiedScan.skin_condition)
        ? verifiedScan.skin_condition[0]
        : verifiedScan.skin_condition;
      const conditionLabel = verifiedCondObj?.name || selectedScan?.conditionName || null;
      const confNum = verifiedScan.confidence_score !== undefined && verifiedScan.confidence_score !== null
        ? Number(verifiedScan.confidence_score)
        : null;
      const photoPath = verifiedScan.photo_url || selectedScan?.photoUrl || null;
      const scheduledDateTimeIso = `${selectedDate}T${selectedTime}:00+08:00`;

      let assignedDocId = activeDutyDoctor?.id && !activeDutyDoctor.id.startsWith("doc-")
        ? activeDutyDoctor.id
        : undefined;

      // If activeDutyDoctor.id is temporary (e.g. doc-local-123), attempt to resolve real Supabase UUID
      if (!assignedDocId && activeDutyDoctor?.name) {
        try {
          const cleanName = activeDutyDoctor.name.replace(/^Dr\.?\s*/i, "").trim();
          const { data: dbDoc } = await supabase
            .from("clinic_doctor")
            .select("doctor_id")
            .ilike("doctor_name", `%${cleanName}%`)
            .maybeSingle();
          if (dbDoc?.doctor_id) {
            assignedDocId = dbDoc.doctor_id;
          }
        } catch {}
      }

      const assignedQueueNum = selectedBatch?.nextQueueNumber || 1;

      const apptPayload: Record<string, any> = {
        user_id: activeUserId,
        clinic_id: targetClinicId,
        date: scheduledDateTimeIso,
        status: "pending",
        patient_name: patientName.trim() || user?.user_metadata?.full_name || "Patient",
        patient_email: patientEmail.trim() || user?.email || null,
        patient_contact: patientContact.trim() || null,
        patient_address: patientAddress.trim() || null,
        patient_gender: patientGender || null,
        patient_birthdate: patientBirthdate || null,
        emergency_contact_name: emergencyContactName.trim() || null,
        emergency_contact_phone: emergencyContactPhone.trim() || null,
        emergency_contact_relationship: emergencyRelationship.trim() || null,
        questionnaire_answers: verifiedScan.questionnaire_answers || selectedScan?.questionnaireAnswers || null,
        notes: notes.trim() || null,
        clinic_note: activeDutyDoctor?.name ? `Attending Doctor: ${activeDutyDoctor.name}` : null,
        primary_scan_id: verifiedScan.analysis_id, // Authoritative relationship
        skin_photo_url: photoPath,
        ai_condition_name: conditionLabel,
        ai_confidence: confNum,
        condition_id: verifiedScan.condition_id || null,
        assigned_doctor_id: assignedDocId || null,
        doctor_status: "pending-review",
        schedule_sent_to_doctor: true,
        queue_number: assignedQueueNum,
        batch_time: selectedTime,
        check_in_status: "scheduled",
        is_walk_in: false,
      };

      // 3. Insert appointment request with primary_scan_id
      let insertedApptId: string | null = null;
      let { data: insertedData, error: insertError } = await supabase
        .from("patient_appointment")
        .insert(apptPayload)
        .select("appointment_id")
        .maybeSingle();

      if (insertedData?.appointment_id) {
        insertedApptId = String(insertedData.appointment_id);
      }

      if (insertError && (insertError.message.includes("assigned_doctor_id") || insertError.message.includes("doctor_status") || insertError.message.includes("schedule_sent_to_doctor"))) {
        console.warn("Retrying appointment insert without assigned_doctor_id...", insertError.message);
        delete apptPayload.assigned_doctor_id;
        delete apptPayload.doctor_status;
        delete apptPayload.schedule_sent_to_doctor;
        const retry1 = await supabase
          .from("patient_appointment")
          .insert(apptPayload)
          .select("appointment_id")
          .maybeSingle();
        insertError = retry1.error;
        if (retry1.data?.appointment_id) {
          insertedApptId = String(retry1.data.appointment_id);
        }
      }

      // CRITICAL REQUIREMENT:
      // If primary_scan_id fails or insertion fails, STOP the booking operation and report error.
      // Do NOT fall back to creating an appointment without primary_scan_id!
      if (insertError) {
        console.error("Appointment creation failed:", insertError.message);
        setSubmitError(`Failed to submit appointment: ${insertError.message}`);
        setSubmitting(false);
        return;
      }


      // 4. Save to local cache & notify listeners
      try {
        const newLocalAppt = {
          id: insertedApptId || `appt-${Date.now()}`,
          clinicId: targetClinicId,
          clinicName: selectedClinic.name || "Skin Clinic",
          patientName: patientName.trim() || user?.user_metadata?.full_name || "Patient",
          patientEmail: patientEmail.trim() || user?.email || "",
          patientContact: patientContact.trim() || "",
          patientAddress: patientAddress.trim() || "",
          patientGender: patientGender || "",
          patientBirthdate: patientBirthdate || "",
          emergencyContactName: emergencyContactName.trim() || "",
          emergencyContactPhone: emergencyContactPhone.trim() || "",
          emergencyRelationship: emergencyRelationship.trim() || "",
          date: selectedDate,
          time: selectedTime,
          status: "pending",
          primaryScanId: verifiedScan.analysis_id,
          conditionId: verifiedScan.condition_id || undefined,
          notes: notes.trim() || "",
          skinPhotoUrl: photoPath,
          aiConditionName: conditionLabel,
          aiConfidence: confNum,
          assignedDoctorId: activeDutyDoctor?.id,
          assignedDoctorName: activeDutyDoctor?.name || undefined,
          assignedDoctorPhoto: getDoctorPhoto(activeDutyDoctor) || undefined,
          assignedDoctorSpecialization: activeDutyDoctor?.specialization || undefined,
          doctorStatus: "pending-review",
          scheduleSentToDoctor: true,
          createdAt: new Date().toISOString(),
        };
        const existing = localStorage.getItem("dermai_clinic_appointments");
        const list = existing ? JSON.parse(existing) : [];
        if (Array.isArray(list)) {
          list.unshift(newLocalAppt);
          localStorage.setItem("dermai_clinic_appointments", JSON.stringify(list));
        }
        window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
        window.dispatchEvent(new Event("appointmentCreated"));
      } catch { }

      setSubmitted(true);
      try {
        sessionStorage.removeItem("dermai_appointment_draft");
        sessionStorage.removeItem("dermai_selected_clinic_id");
        sessionStorage.removeItem("dermai_booking_return_clinic");
        sessionStorage.removeItem("dermai_scan_booking_context");
      } catch {}
    } catch (err: any) {
      console.error("Submission error:", err);
      setSubmitError(err?.message || "An unexpected error occurred during submission.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingClinic) {
    return (
      <div className="min-h-screen bg-slate-50/50 flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-7 h-7 animate-spin text-magenta-500" />
          <p className="text-xs font-semibold text-gray-500">Loading clinic &amp; doctor schedule...</p>
        </div>
      </div>
    );
  }

  if (!selectedClinic) {
    return (
      <div className="min-h-screen bg-slate-50/50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-3xl p-6 sm:p-8 border border-gray-200 text-center shadow-sm space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-500 mx-auto flex items-center justify-center">
            <ShieldX className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-gray-900">Clinic Not Found</h2>
          <p className="text-xs text-gray-500">
            The requested clinic could not be loaded or is not currently active.
          </p>
          <Link
            to={user ? "/dashboard/clinics" : "/find-clinics"}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-magenta-600 text-white text-xs font-semibold hover:bg-magenta-700 transition-colors shadow-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Browse Partner Clinics
          </Link>
        </div>
      </div>
    );
  }

  // ════════════════ SUCCESS SUBMISSION SCREEN ════════════════
  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50/60 py-10 px-4 sm:px-6 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-lg w-full bg-white rounded-3xl p-6 sm:p-8 border border-gray-200 shadow-lg text-center space-y-5"
        >
          <div className="w-16 h-16 rounded-3xl bg-emerald-50 border border-emerald-100 text-emerald-600 mx-auto flex items-center justify-center shadow-xs">
            <CheckCircle2 className="w-8 h-8" />
          </div>

          <div className="space-y-1.5">
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Appointment Request Sent!</h1>
            <p className="text-xs text-gray-500">
              Your consultation request has been submitted to <strong>{selectedClinic.name}</strong>.
            </p>
          </div>

          <div className="bg-slate-50 p-4 rounded-2xl border border-gray-100 text-left space-y-2.5 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-gray-200/60">
              <span className="text-gray-400 font-medium">Requested Schedule</span>
              <span className="font-bold text-magenta-700">{formattedPreviewDate} at {formattedPreviewTime}</span>
            </div>
            <div className="flex items-center justify-between pb-2 border-b border-gray-200/60">
              <span className="text-gray-400 font-medium">Attending Dermatologist</span>
              <span className="font-bold text-gray-900">
                {activeDutyDoctor?.name || "Assigned by Clinic upon Review"}
              </span>
            </div>
            <div className="flex items-center justify-between pb-2 border-b border-gray-200/60">
              <span className="text-gray-400 font-medium">Patient Name</span>
              <span className="font-bold text-gray-900">{patientName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400 font-medium">Status</span>
              <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-bold border border-amber-200 text-[10px]">
                Under Doctor Review
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => navigate("/dashboard/appointment-status")}
              className="flex-1 py-3 bg-magenta-600 hover:bg-magenta-700 text-white rounded-full font-bold text-xs uppercase tracking-wider transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>View Appointment Status</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="px-5 py-3 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-full font-semibold text-xs transition-all text-center cursor-pointer"
            >
              Dashboard
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  const handleBackToClinics = (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    const targetClinicId = selectedClinic?.id || searchParams.get("clinic") || "";
    if (targetClinicId) {
      sessionStorage.setItem("dermai_selected_clinic_id", String(targetClinicId));
    }
    const targetUrl = user
      ? `/dashboard/clinics${targetClinicId ? `?clinic=${targetClinicId}` : ""}`
      : `/find-clinics${targetClinicId ? `?clinic=${targetClinicId}` : ""}`;
    navigate(targetUrl);
  };

  return (
    <div className="min-h-screen bg-slate-50/50 py-8 px-4 sm:px-6 lg:px-8">
      <div className={`mx-auto space-y-4 transition-all duration-300 ${currentStep === 2 ? "max-w-6xl xl:max-w-7xl" : "max-w-3xl"}`}>
        {/* Back navigation */}
        <div className="flex items-center justify-between">
          {currentStep === 2 ? (
            <button
              type="button"
              onClick={handlePrevStep}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-magenta-600 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Patient Details
            </button>
          ) : (
            <button
              type="button"
              onClick={handleBackToClinics}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-magenta-600 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Clinics
            </button>
          )}
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400">
            <button
              type="button"
              onClick={() => {
                if (currentStep === 2) handlePrevStep();
              }}
              className={currentStep === 1 ? "text-magenta-600 font-bold cursor-default" : "text-gray-500 hover:text-magenta-600 transition-colors cursor-pointer"}
            >
              1. Patient Details
            </button>
            <span>→</span>
            <span className={currentStep === 2 ? "text-magenta-600 font-bold" : "text-gray-400"}>
              2. Schedule &amp; Doctor
            </span>
          </div>
        </div>

        {/* Global Error Banner */}
        {submitError && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-center gap-2.5"
          >
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
            <span className="flex-1">{submitError}</span>
            <button
              type="button"
              onClick={() => setSubmitError(null)}
              className="text-rose-400 hover:text-rose-600 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}

        {/* Unified Card Booking Container */}
        <AnimatePresence mode="wait">
          {/* ════════════════ STEP 1: PATIENT & SKIN DETAILS ════════════════ */}
          {currentStep === 1 && (
            <motion.div
              key="step-1"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.18 }}
              className="bg-white p-5 sm:p-7 rounded-3xl border border-gray-200/80 shadow-sm space-y-5"
            >
              {/* Card Header with Clinic info */}
              <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-4">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h2 className="text-lg sm:text-xl font-bold text-gray-900 tracking-tight">{selectedClinic.name}</h2>
                    {selectedClinic.verified && <VerifiedBadge size={16} className="w-4 h-4" />}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Step 1 of 2: Patient Profile &amp; Skin Concern Photo
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowClinicDetailsModal(true)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-50 border border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer shrink-0"
                >
                  Clinic Details
                </button>
              </div>

              {/* Form Content */}
              <div className="space-y-4 text-left">
                {/* 1. Patient Profile Info */}
                <div className="space-y-2.5">
                  <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-magenta-600" /> Patient Information
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        Full Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Juan Dela Cruz"
                        value={patientName}
                        onChange={(e) => setPatientName(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white text-gray-900 focus:outline-none focus:border-magenta-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        Email Address <span className="text-[10px] text-gray-400 font-normal">(Linked to account)</span>
                      </label>
                      <input
                        type="email"
                        disabled
                        readOnly
                        value={patientEmail}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-gray-50 text-gray-500 cursor-not-allowed select-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        Contact Number (11 digits) <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="tel"
                        required
                        maxLength={11}
                        placeholder="09171234567"
                        value={patientContact}
                        onChange={(e) => setPatientContact(e.target.value.replace(/\D/g, "").slice(0, 11))}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white text-gray-900 focus:outline-none focus:border-magenta-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        City / Complete Address <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Cebu City, Cebu"
                        value={patientAddress}
                        onChange={(e) => setPatientAddress(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white text-gray-900 focus:outline-none focus:border-magenta-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        Gender <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={patientGender}
                        onChange={(e) => setPatientGender(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white text-gray-900 focus:outline-none focus:border-magenta-500"
                      >
                        <option value="">Select gender</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Non-binary">Non-binary</option>
                        <option value="Prefer not to say">Prefer not to say</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        Date of Birth <span className="text-red-500">*</span>
                        {patientAge !== null && (
                          <span className="text-magenta-600 font-bold ml-1.5">({patientAge} yrs old)</span>
                        )}
                      </label>
                      <input
                        type="date"
                        required
                        value={patientBirthdate}
                        max={new Date().toISOString().split("T")[0]}
                        onChange={(e) => setPatientBirthdate(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white text-gray-900 focus:outline-none focus:border-magenta-500"
                      />
                    </div>
                  </div>
                </div>

                {/* 2. Emergency Contact Sub-Card */}
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-gray-100 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                      <HeartPulse className="w-3.5 h-3.5 text-rose-500" /> Emergency Contact
                    </h3>
                    <span className="text-[10px] text-gray-400 font-medium">Required for clinical records</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        Contact Person <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Maria Dela Cruz"
                        value={emergencyContactName}
                        onChange={(e) => setEmergencyContactName(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white text-gray-900 focus:outline-none focus:border-magenta-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        Emergency Phone (11 digits) <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="tel"
                        required
                        maxLength={11}
                        placeholder="09171234567"
                        value={emergencyContactPhone}
                        onChange={(e) => setEmergencyContactPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white text-gray-900 focus:outline-none focus:border-magenta-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        Relationship <span className="text-red-500">*</span>
                      </label>
                      <select
                        required
                        value={emergencyRelationship}
                        onChange={(e) => setEmergencyRelationship(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white text-gray-900 focus:outline-none focus:border-magenta-500"
                      >
                        <option value="">Select relationship</option>
                        <option value="Parent">Parent</option>
                        <option value="Spouse">Spouse</option>
                        <option value="Sibling">Sibling</option>
                        <option value="Child">Child</option>
                        <option value="Guardian">Guardian</option>
                        <option value="Friend">Friend</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* 3. Primary AI Skin Scan Selection */}
                <div className="space-y-3 pt-1">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 pb-0.5">
                    <div>
                      <label className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                        <Camera className="w-3.5 h-3.5 text-magenta-600" /> Primary AI Skin Scan <span className="text-red-500">*</span>
                      </label>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        Select the skin scan you want the doctor to review during this appointment.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handlePerformNewScan}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-magenta-600 hover:text-magenta-700 hover:underline cursor-pointer self-start sm:self-auto py-1"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Perform New AI Skin Scan</span>
                    </button>
                  </div>

                  {loadingScans ? (
                    <div className="flex items-center justify-center py-8 rounded-2xl border border-gray-200 bg-slate-50/50">
                      <Loader2 className="w-5 h-5 text-magenta-600 animate-spin mr-2" />
                      <span className="text-xs text-gray-500 font-medium">Loading your scan history...</span>
                    </div>
                  ) : patientScans.length === 0 ? (
                    <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-slate-50/50 p-6 text-center">
                      <div className="w-10 h-10 rounded-full bg-magenta-50 border border-magenta-100 flex items-center justify-center text-magenta-600 mx-auto mb-2.5">
                        <Camera className="w-5 h-5" />
                      </div>
                      <h4 className="text-xs font-bold text-gray-800 mb-1">No completed AI skin scans yet.</h4>
                      <p className="text-[11px] text-gray-500 max-w-sm mx-auto mb-3.5">
                        An appointment must be associated with a completed AI skin scan so the doctor can review the affected area and preliminary findings.
                      </p>
                      <button
                        type="button"
                        onClick={handlePerformNewScan}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-magenta-600 hover:bg-magenta-700 text-white font-semibold text-xs shadow-sm transition-all cursor-pointer active:scale-95"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        <span>Perform AI Skin Scan</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-1 gap-2.5 max-h-80 overflow-y-auto pr-1">
                        {patientScans.map((scan) => {
                          const isSelected = selectedScanId === scan.id;
                          const scanDateStr = scan.scannedAt
                            ? new Date(scan.scannedAt).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })
                            : "Recent";

                          return (
                            <div
                              key={scan.id}
                              onClick={() => setSelectedScanId(scan.id)}
                              className={`relative rounded-2xl border p-3.5 transition-all cursor-pointer flex items-center justify-between gap-3 ${
                                isSelected
                                  ? "border-magenta-500 bg-magenta-50/30 ring-2 ring-magenta-500/20 shadow-xs"
                                  : "border-gray-200 bg-white hover:border-gray-300 hover:bg-slate-50/50"
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div
                                  className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                                    isSelected
                                      ? "border-magenta-600 bg-magenta-600 text-white"
                                      : "border-gray-300 bg-white"
                                  }`}
                                >
                                  {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                                </div>

                                {scan.imageUrl ? (
                                  <div
                                    className="relative w-12 h-12 rounded-xl overflow-hidden border border-gray-200 bg-gray-100 shrink-0 group/thumb"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setLightboxPhoto(scan.imageUrl!);
                                    }}
                                    title="Click to view full image"
                                  >
                                    <img
                                      src={scan.imageUrl}
                                      alt={scan.conditionName}
                                      className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform"
                                    />
                                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition-opacity">
                                      <ZoomIn className="w-3.5 h-3.5 text-white" />
                                    </div>
                                  </div>
                                ) : (
                                  <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 shrink-0">
                                    <Camera className="w-5 h-5" />
                                  </div>
                                )}

                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-bold text-gray-900 truncate">
                                      {scan.conditionName}
                                    </span>
                                    {scan.localName && (
                                      <span className="text-[10px] text-gray-500">
                                        ({scan.localName})
                                      </span>
                                    )}
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/50">
                                      {scan.confidence.toFixed(1)}% AI confidence
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
                                    <span>Scanned {scanDateStr}</span>
                                    {scan.bodyPart && (
                                      <>
                                        <span>•</span>
                                        <span>{scan.bodyPart}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {scan.imageUrl && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setLightboxPhoto(scan.imageUrl!);
                                  }}
                                  className="text-[11px] font-semibold text-magenta-600 hover:text-magenta-700 shrink-0 px-2 py-1 rounded-lg hover:bg-magenta-50 cursor-pointer"
                                >
                                  View Image
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <p className="text-[10px] text-gray-400 italic">
                        * Preliminary AI assessment for physician review. The attending doctor will provide the official medical diagnosis.
                      </p>
                    </div>
                  )}

                  {/* 4. Symptoms & Medical Notes (Optional) */}
                  <div className="pt-1">
                    <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                      Symptoms &amp; Medical Notes <span className="text-gray-400 font-normal">(Optional)</span>
                    </label>
                    <textarea
                      placeholder="Describe itchiness, duration, triggers, or any notes for the doctor..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white text-gray-900 focus:outline-none focus:border-magenta-500 resize-none"
                    />
                  </div>
                </div>
              </div>

              {/* Step 1 Action Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleNextStep}
                  className="w-full py-3 bg-magenta-600 hover:bg-magenta-700 text-white rounded-full font-semibold text-sm shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
                >
                  <span>Continue to Step 2: Choose Schedule &amp; Doctor</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* ════════════════ STEP 2: CHOOSE SCHEDULE & DOCTOR ════════════════ */}
          {currentStep === 2 && (
            <motion.div
              key="step-2"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.18 }}
              className="bg-white p-5 sm:p-7 rounded-3xl border border-gray-200/80 shadow-sm space-y-5"
            >
              <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-4">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h2 className="text-lg sm:text-xl font-bold text-gray-900 tracking-tight">{selectedClinic.name}</h2>
                    {selectedClinic.verified && <VerifiedBadge size={16} className="w-4 h-4" />}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Step 2 of 2: Choose Consultation Date, Doctor &amp; Time
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowClinicDetailsModal(true)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-50 border border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer shrink-0"
                >
                  Clinic Details
                </button>
              </div>

              <div className="space-y-4 text-left">
                {/* Modern Landscape Two-Column Layout */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                  {/* ════════ LEFT COLUMN: Minimal Landscape Calendar (7 cols on lg, 8 cols on xl) ════════ */}
                  <div className="lg:col-span-7 xl:col-span-8 space-y-3">
                    <div className="bg-white rounded-3xl border border-gray-200/90 p-4 sm:p-5 shadow-xs space-y-3.5">
                      {/* Month Title & Prev/Next Navigation */}
                      <div className="flex items-center justify-between gap-3 pb-3 border-b border-gray-100">
                        <div>
                          <h3 className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-magenta-600" />
                            <span>{calendarMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
                          </h3>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Selected: <strong className="text-magenta-700 font-bold">{formattedPreviewDate}</strong>
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              const prev = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
                              const now = new Date();
                              if (prev.getFullYear() > now.getFullYear() || (prev.getFullYear() === now.getFullYear() && prev.getMonth() >= now.getMonth())) {
                                setCalendarMonth(prev);
                              }
                            }}
                            className="px-2.5 py-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                            title="Previous month"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                            <span>Prev</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const next = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
                              setCalendarMonth(next);
                            }}
                            className="px-2.5 py-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                            title="Next month"
                          >
                            <span>Next</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Weekday Headers */}
                      <div className="grid grid-cols-7 text-center">
                        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                          <span
                            key={d}
                            className="text-[11px] font-bold py-1 uppercase tracking-wider text-gray-400"
                          >
                            {d}
                          </span>
                        ))}
                      </div>

                      {/* Minimal Landscape Calendar Grid */}
                      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                        {calendarDays.map((cell, idx) => {
                          const isSelected = selectedDate === cell.dateStr;
                          const isToday = cell.isToday;
                          const isDisabled = cell.isDisabled || !cell.inCurrentMonth;
                          const hasDoctors = cell.onDutyDocs.length > 0 && cell.inCurrentMonth && !cell.isPast;

                          return (
                            <button
                              key={idx}
                              type="button"
                              disabled={isDisabled}
                              onClick={() => {
                                if (!isDisabled) {
                                  setSelectedDate(cell.dateStr);
                                  if (cell.onDutyDocs.length > 0) {
                                    setSelectedDoctorId(cell.onDutyDocs[0].id);
                                  }
                                }
                              }}
                              className={`min-h-[58px] sm:min-h-[64px] p-2 rounded-2xl border text-left transition-all relative flex flex-col justify-between ${
                                isSelected
                                  ? "border-2 border-magenta-600 bg-magenta-50/70 ring-2 ring-magenta-500/20 shadow-xs"
                                  : isDisabled
                                  ? "border-gray-100 bg-slate-50/40 text-gray-300 cursor-not-allowed"
                                  : isToday
                                  ? "border-magenta-300 bg-pink-50/20 hover:border-magenta-400 hover:shadow-2xs cursor-pointer"
                                  : "border-gray-200/80 bg-white hover:border-magenta-300 hover:bg-slate-50/40 hover:shadow-2xs cursor-pointer"
                              }`}
                            >
                              {/* Top row: Date Number & Today / Selected indicator */}
                              <div className="flex items-center justify-between w-full">
                                <span
                                  className={`text-xs sm:text-sm font-bold leading-none ${
                                    isSelected
                                      ? "text-magenta-800"
                                      : isToday
                                      ? "text-magenta-600"
                                      : !cell.inCurrentMonth || cell.isPast
                                      ? "text-gray-300"
                                      : "text-gray-800"
                                  }`}
                                >
                                  {cell.dayNum}
                                </span>

                                {isToday && (
                                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-magenta-100 text-magenta-700 leading-none">
                                    Today
                                  </span>
                                )}

                                {isSelected && !isToday && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-magenta-600" />
                                )}
                              </div>

                              {/* Doctor indicator - only shown when a doctor is actually on duty */}
                              <div className="w-full mt-1">
                                {hasDoctors ? (
                                  <div className={`px-1.5 py-0.5 rounded-lg flex items-center justify-center gap-1 transition-all ${
                                    isSelected
                                      ? "bg-magenta-600 text-white font-semibold"
                                      : "bg-magenta-50 text-magenta-700 font-semibold border border-magenta-100/80"
                                  }`}>
                                    <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
                                    <span className="text-[9px] font-bold leading-none truncate">
                                      {cell.onDutyDocs.length === 1
                                        ? cell.onDutyDocs[0].name.replace(/^Dr\.?\s*/i, "").split(" ")[0] || "Doctor"
                                        : `${cell.onDutyDocs.length} Docs`}
                                    </span>
                                  </div>
                                ) : null}
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {/* Minimal Calendar Legend */}
                      <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-[10px] text-gray-500">
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-magenta-500 inline-block" /> Doctor Available
                          </span>
                        </div>
                        <span className="flex items-center gap-1.5 font-semibold text-magenta-700">
                          <span className="w-2 h-2 rounded-full bg-magenta-600 inline-block ring-1 ring-magenta-200" /> Selected Date
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* ════════ RIGHT COLUMN: Attending Doctor Selection, Summary & Booking (5 cols on lg, 4 cols on xl) ════════ */}
                  <div className="lg:col-span-5 xl:col-span-4 space-y-3.5 lg:sticky lg:top-6">
                    {/* 1. Attending Doctor Selection Card */}
                    <div className="bg-white rounded-3xl border border-gray-200/90 p-4 sm:p-5 shadow-xs space-y-3">
                      <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                        <div>
                          <h4 className="text-xs sm:text-sm font-bold text-gray-900 flex items-center gap-1.5">
                            <Stethoscope className="w-3.5 h-3.5 text-magenta-600" />
                            <span>Attending Dermatologist</span>
                          </h4>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {onDutyDoctorsForDate.length > 1
                              ? `${onDutyDoctorsForDate.length} Doctors on duty on ${formattedPreviewDate}`
                              : `Scheduled for ${formattedPreviewDate}`}
                          </p>
                        </div>
                        {onDutyDoctorsForDate.length > 1 && (
                          <span className="text-[10px] font-bold text-magenta-700 bg-magenta-50 px-2 py-0.5 rounded-full border border-magenta-200/60">
                            Select Doctor
                          </span>
                        )}
                      </div>

                      {onDutyDoctorsForDate.length === 0 ? (
                        <div className="p-3.5 rounded-2xl bg-slate-50 border border-dashed border-gray-200 text-center space-y-1">
                          <p className="text-xs font-bold text-gray-700">General Clinic Queue</p>
                          <p className="text-[11px] text-gray-400">
                            No specific doctor is scheduled for this date. Your consultation will be attended on a first-come queue basis.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2.5 max-h-60 overflow-y-auto pr-0.5 no-scrollbar">
                          {onDutyDoctorsForDate.map((doc) => {
                            const isDocSelected = activeDutyDoctor?.id === doc.id;
                            const shift =
                              doc.dutySchedule && doc.dutySchedule[dayOfWeekForSelectedDate]
                                ? doc.dutySchedule[dayOfWeekForSelectedDate]
                                : { startTime: doc.dutyStartTime || "09:00", endTime: doc.dutyEndTime || "17:00" };
                            const docPhoto = getDoctorPhoto(doc);

                            return (
                              <button
                                key={doc.id}
                                type="button"
                                onClick={() => setSelectedDoctorId(doc.id)}
                                className={`w-full p-3 rounded-2xl border text-left transition-all cursor-pointer flex items-center gap-3 relative group ${
                                  isDocSelected
                                    ? "bg-magenta-50/90 border-magenta-500 ring-2 ring-magenta-500/20 shadow-xs"
                                    : "bg-white border-gray-200 hover:border-magenta-300 hover:bg-slate-50/50"
                                }`}
                              >
                                {docPhoto ? (
                                  <img
                                    src={docPhoto}
                                    alt={doc.name}
                                    className="w-12 h-12 rounded-2xl object-cover border border-magenta-200 shrink-0 shadow-2xs"
                                  />
                                ) : (
                                  <div className="w-12 h-12 rounded-2xl bg-magenta-100 text-magenta-700 font-bold flex items-center justify-center text-sm shrink-0 border border-magenta-200/60 shadow-2xs">
                                    {doc.name.replace(/^Dr\.?\s*/i, "").charAt(0) || "D"}
                                  </div>
                                )}

                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-1">
                                    <h5 className="text-xs sm:text-sm font-bold text-gray-900 truncate group-hover:text-magenta-700 transition-colors">
                                      {doc.name}
                                    </h5>
                                    {isDocSelected ? (
                                      <span className="w-4 h-4 rounded-full bg-magenta-600 text-white flex items-center justify-center shrink-0">
                                        <Check className="w-2.5 h-2.5" />
                                      </span>
                                    ) : (
                                      <span className="w-4 h-4 rounded-full border border-gray-300 shrink-0" />
                                    )}
                                  </div>
                                  <p className="text-[11px] text-magenta-700 font-medium truncate mt-0.5">
                                    {doc.specialization || "General Dermatology"}
                                  </p>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-[10px] text-gray-500 flex items-center gap-1 font-medium">
                                      <Clock className="w-3 h-3 text-magenta-500 shrink-0" />
                                      <span>{formatTime12h(shift.startTime)} – {formatTime12h(shift.endTime)}</span>
                                    </span>
                                    <span className="text-[9px] px-1.5 py-0.2 rounded-full font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                      Available
                                    </span>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* 2. NowServing-Style Consultation Batches (Linked to Doctor Shift) */}
                    <div className="bg-white rounded-3xl border border-gray-200/90 p-4 sm:p-5 shadow-xs space-y-3">
                      <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                        <div>
                          <h4 className="text-xs sm:text-sm font-bold text-gray-900 flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-magenta-600" />
                            <span>Select Consultation Time</span>
                          </h4>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {activeDutyDoctor ? (
                              <>Shift: <span className="font-bold text-magenta-700">{activeDoctorHours}</span> • 3 slots per batch</>
                            ) : (
                              <>General Clinic Hours • 3 slots per 1-hour batch</>
                            )}
                          </p>
                        </div>
                      </div>

                      {consultationBatches.length === 0 ? (
                        <div className="p-3 text-center text-xs text-gray-400">
                          No consultation batches available for this doctor's shift.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-0.5 no-scrollbar">
                          {consultationBatches.map((batch) => {
                            const isBatchSelected = selectedTime === batch.batchTime;
                            const isFull = batch.isFull;

                            return (
                              <button
                                key={batch.batchTime}
                                type="button"
                                disabled={isFull}
                                onClick={() => {
                                  if (!isFull) {
                                    setSelectedTime(batch.batchTime);
                                  }
                                }}
                                className={`p-3 rounded-2xl border text-left transition-all relative flex flex-col justify-between ${
                                  isFull
                                    ? "bg-slate-50/70 border-gray-200 text-gray-400 cursor-not-allowed opacity-60"
                                    : isBatchSelected
                                    ? "bg-magenta-50/90 border-2 border-magenta-600 text-gray-900 ring-2 ring-magenta-500/20 shadow-xs cursor-pointer"
                                    : "bg-white border-gray-200/90 text-gray-800 hover:border-magenta-300 hover:bg-slate-50/60 cursor-pointer"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1 w-full">
                                  <span className="text-xs font-bold leading-tight text-gray-900">
                                    {batch.timeRange}
                                  </span>
                                  {isFull ? (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 uppercase tracking-wide">
                                      Full
                                    </span>
                                  ) : isBatchSelected ? (
                                    <span className="w-4 h-4 rounded-full bg-magenta-600 text-white flex items-center justify-center text-[10px] shrink-0 font-bold">
                                      ✓
                                    </span>
                                  ) : null}
                                </div>

                                <div className="mt-2.5 pt-1.5 border-t border-gray-100/80 flex items-center justify-between text-[10px]">
                                  {isFull ? (
                                    <span className="text-rose-600 font-semibold">Booked out</span>
                                  ) : (
                                    <>
                                      <span className="text-emerald-700 font-semibold flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                                        {batch.availableSlots} of {batch.totalSlots} left
                                      </span>
                                      <span className="text-magenta-700 font-bold">
                                        Queue #{batch.nextQueueNumber}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* 3. NowServing-Style Consultation Summary Card */}
                    <div className="bg-white rounded-3xl border border-gray-200/90 p-4 sm:p-5 shadow-xs space-y-3.5">
                      <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                        <h4 className="text-xs sm:text-sm font-bold text-gray-900 flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-magenta-600" />
                          <span>Consultation Summary</span>
                        </h4>
                        <button
                          type="button"
                          onClick={handlePrevStep}
                          className="text-[11px] font-semibold text-magenta-600 hover:text-magenta-700 hover:underline cursor-pointer"
                        >
                          Edit Profile
                        </button>
                      </div>

                      {/* Prominent NowServing Queue Card */}
                      {selectedBatch && (
                        <div className="p-3.5 rounded-2xl bg-magenta-50/80 border border-magenta-200/80 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-magenta-800">
                              Your Assigned Queue
                            </span>
                            <span className="px-2.5 py-0.5 rounded-full bg-magenta-600 text-white font-bold text-xs shadow-2xs">
                              Queue #{selectedBatch.nextQueueNumber}
                            </span>
                          </div>
                          <p className="text-xs font-bold text-gray-900">
                            {activeDutyDoctor?.name || "Attending Dermatologist"}
                          </p>
                          <p className="text-[11px] text-gray-700">
                            Batch: <strong className="text-magenta-900 font-semibold">{selectedBatch.label}</strong> ({selectedBatch.timeRange})
                          </p>
                          <p className="text-[10px] text-gray-500 italic">
                            Estimated call window: ~{selectedBatch.estimatedWindow}
                          </p>
                        </div>
                      )}

                      {/* Clean Minimal NowServing Schedule Details */}
                      <div className="p-3.5 rounded-2xl bg-slate-50 border border-gray-100 space-y-2 text-xs">
                        <div className="flex items-start gap-3">
                          {selectedClinic.logo ? (
                            <img
                              src={selectedClinic.logo}
                              alt={selectedClinic.name}
                              className="w-11 h-11 rounded-xl object-cover border border-gray-200 shrink-0"
                            />
                          ) : (
                            <div className="w-11 h-11 rounded-xl bg-magenta-100 text-magenta-700 font-bold flex items-center justify-center text-xs shrink-0">
                              {selectedClinic.name.charAt(0) || "C"}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <h5 className="font-bold text-gray-900 text-xs truncate">
                              {selectedClinic.name}
                            </h5>
                            <p className="text-[11px] text-gray-500 truncate mt-0.5">
                              {selectedClinic.address || (selectedClinic as any).district || "Dermatology Clinic"}
                            </p>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-gray-200/70 space-y-0.5">
                          <p className="font-bold text-gray-900 text-xs">
                            {formattedPreviewDate}
                          </p>
                          <p className="text-gray-600 text-[11px]">
                            {activeDoctorHours}
                          </p>
                          <p className="text-[10px] text-gray-400 italic">
                            (By Appointment Only)
                          </p>
                        </div>

                        <div className="pt-2 border-t border-gray-200/70 flex items-center justify-between">
                          <div>
                            <span className="text-[10px] font-bold text-gray-400 block uppercase tracking-wider">Fee</span>
                            <span className="font-bold text-gray-900 text-sm">
                              ₱{Number(selectedClinic.consultationFee || 500).toLocaleString()}
                            </span>
                          </div>
                          <span className="text-[10px] text-gray-400">Payable at clinic</span>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="space-y-2 pt-2 border-t border-gray-100">
                        <button
                          type="button"
                          onClick={() => handleSubmitAppointment()}
                          disabled={submitting || (selectedBatch?.isFull ?? false)}
                          className="w-full py-3 bg-magenta-600 hover:bg-magenta-700 text-white rounded-full font-bold text-xs uppercase tracking-wider shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
                        >
                          {submitting ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Submitting Appointment...</span>
                            </>
                          ) : (
                            <>
                              <span>Book Here</span>
                              <Check className="w-3.5 h-3.5" />
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={handlePrevStep}
                          disabled={submitting}
                          className="w-full py-2.5 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 font-semibold text-xs transition-colors cursor-pointer text-center"
                        >
                          ← Back to Patient Details
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Clinic Details Modal */}
      <AnimatePresence>
        {showClinicDetailsModal && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-100 max-h-[90vh] flex flex-col text-left"
            >
              <div className="px-6 pt-5 pb-4 flex items-start justify-between border-b border-gray-100">
                <div className="flex items-center gap-3">
                  {selectedClinic.logo ? (
                    <img src={selectedClinic.logo} alt={selectedClinic.name} className="w-10 h-10 rounded-xl object-cover border border-gray-200" />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-magenta-50 border border-magenta-100 text-magenta-600 flex items-center justify-center font-bold">
                      {selectedClinic.name.charAt(0)}
                    </div>
                  )}
                  <div>
                    <h3 className="font-bold text-gray-900 text-base flex items-center gap-1.5">
                      {selectedClinic.name}
                      {selectedClinic.verified && <VerifiedBadge size={16} className="w-4 h-4" />}
                    </h3>
                    <p className="text-xs text-gray-500">{selectedClinic.address}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowClinicDetailsModal(false)}
                  className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto space-y-4 text-xs">
                {selectedClinic.photos && selectedClinic.photos.length > 0 && (
                  <div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">Clinic Photos</span>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {selectedClinic.photos.map((p, idx) => (
                        <img
                          key={idx}
                          src={p}
                          alt="Clinic facility"
                          onClick={() => setLightboxPhoto(p)}
                          className="w-24 h-16 rounded-xl object-cover border border-gray-200 shrink-0 cursor-pointer hover:opacity-90"
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">About</span>
                  <p className="text-gray-700 leading-relaxed">{selectedClinic.description || "Verified dermatology clinic in Cebu providing comprehensive skin care and medical consultations."}</p>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Attending Doctors</span>
                  <div className="space-y-1.5">
                    {selectedClinic.doctors.map((d) => (
                      <div key={d.id} className="p-2.5 rounded-xl bg-slate-50 border border-gray-100 flex items-center gap-2.5">
                        {d.photo ? (
                          <img src={d.photo} alt={d.name} className="w-8 h-8 rounded-full object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-magenta-100 text-magenta-700 font-bold flex items-center justify-center text-xs">
                            {d.name.replace("Dr.", "").trim().charAt(0) || "D"}
                          </div>
                        )}
                        <div>
                          <p className="font-bold text-gray-900">{d.name}</p>
                          <p className="text-[10px] text-magenta-700 font-semibold">{d.specialization}</p>
                          <p className="text-[10px] text-gray-400">
                            Duty: {d.dutyDays.map((x) => x.slice(0, 3)).join(", ")}{" "}
                            {d.dutySchedule && Object.keys(d.dutySchedule).length > 0
                              ? "• Flexible Shifts"
                              : `(${formatTime12h(d.dutyStartTime)} – ${formatTime12h(d.dutyEndTime)})`}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="px-6 py-3.5 bg-gray-50/80 border-t border-gray-100 text-right">
                <button
                  type="button"
                  onClick={() => setShowClinicDetailsModal(false)}
                  className="px-4 py-2 rounded-xl bg-magenta-600 text-white font-semibold text-xs hover:bg-magenta-700 transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Lightbox for Photos */}
      <AnimatePresence>
        {lightboxPhoto && (
          <div
            onClick={() => setLightboxPhoto(null)}
            className="fixed inset-0 z-60 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 cursor-pointer"
          >
            <div className="relative max-w-3xl max-h-[85vh]">
              <img src={lightboxPhoto} alt="Enlarged view" className="max-w-full max-h-[85vh] rounded-2xl object-contain shadow-2xl" />
              <button
                type="button"
                onClick={() => setLightboxPhoto(null)}
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
