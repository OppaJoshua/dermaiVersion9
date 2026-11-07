import React, { type FormEvent, useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ShieldX,
  X,
  Loader2,
  Calendar,
  Clock,
  Stethoscope,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  HeartPulse,
  AlertCircle,
  Camera,
  User,
  ZoomIn,
  CreditCard,
  ShieldCheck,
  Lock,
  RefreshCw,
  HelpCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { logAuditEvent } from "@/utils/auditLogger";
import { useAuth } from "@/context/AuthContext";
import { formatConfidencePercent } from "@/lib/utils";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { createPatientNotification, createDoctorAppointmentNotification } from "@/lib/notificationService";
import { DoctorAvatar } from "@/components/common/DoctorAvatar";
import { getDoctorAvatarUrl } from "@/lib/doctorAvatarService";
import { ModalPortal } from "@/components/common/ModalPortal";
import {
  type DoctorWeeklySchedule,
  type ConsultationSlot,
  type DayShiftSlotsGroup,
  timeToMinutes,
  formatTime12h,
  normalizeDayName,
  parseDoctorSchedule,
  getEffectiveShiftSettings,
  generateDaySlotsForDoctor,
  computeNextQueueNumber,
  isClinicOpenOnDay,
  isDoctorOnDutyOnDay,
  getManilaCalendarDate,
} from "@/lib/schedulingService";
import {
  type DemoCheckoutData,
  evaluateAppointmentSubmission,
} from "@/lib/appointmentPaymentDemo";
import { cn } from "@/lib/utils";
import gcashLogo from "@/assets/gcash.png";
import mayaLogo from "@/assets/maya.png";
import {
  useSlotAvailabilityRealtime,
  broadcastSlotChange,
  fetchAuthoritativeOccupiedSlots,
  type BroadcastSlotChangePayload,
} from "@/lib/slotAvailabilityRealtime";
import {
  SlotAvailabilityTracker,
  HeldSlotTracker,
  type HeldSlotMetadata,
  classifyHoldFailure,
  doctorScopesOverlap,
  normalizeSlotTime,
} from "@/lib/slotAvailabilityState";
import {
  acquireAppointmentSlotHold,
  extractEdgeFunctionError,
  releaseAppointmentHoldSafely,
  setCheckoutRedirectRecord,
  isCheckoutRedirectActiveForAppointment,
  clearCheckoutRedirectRecord,
} from "@/lib/appointmentPaymentService";
import { resolveAvatarUrl } from "@/utils/storage";

const PAYMONGO_PUBLIC_KEY = import.meta.env.VITE_PAYMONGO_PUBLIC_KEY || "";

/**
 * Sanitizes technical error codes into user-friendly booking and payment notifications.
 */
export function isValidUuid(val?: string | null): boolean {
  if (!val) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(val).trim());
}

function formatUserFriendlyBookingError(errStr?: string | null, slotRange?: string): string {
  if (!errStr) return "Unable to reserve this consultation slot. Please choose another available slot.";
  const lower = errStr.toLowerCase();
  if (
    lower.includes("err_slot_unavailable") ||
    lower.includes("err_duplicate_slot") ||
    lower.includes("already reserved") ||
    lower.includes("already booked") ||
    lower.includes("reserved by another patient") ||
    lower.includes("booked by another patient") ||
    lower.includes("exclusive_doctor_slot")
  ) {
    const range = slotRange || "selected";
    return `The ${range} consultation slot was just reserved by another patient. Please choose another available consultation slot.`;
  }
  if (lower.includes("err_schedule_config") || lower.includes("appointment interval") || lower.includes("duty schedule")) {
    return "This doctor's consultation schedule has not been configured with appointment intervals by the clinic. Please select another available doctor or contact the clinic.";
  }
  // Strip any raw tech codes like "ERR_SOMETHING: "
  return errStr.replace(/^[A-Z0-9_]+:\s*/, "");
}

export type ClinicDoctorItem = {
  id: string;
  name: string;
  specialization: string;
  specializations?: string[];
  photo?: string;
  dutyDays: string[];
  dutyStartTime: string;
  dutyEndTime: string;
  dutySchedule?: Record<string, any>;
  weeklySchedule?: DoctorWeeklySchedule;
  status?: string;
  maxPatientsPerDay?: number;
  slotIntervalMinutes?: number;
};

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
      } catch { }
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
      } catch { }
    }
    if (schedObj && typeof schedObj === "object" && !Array.isArray(schedObj)) {
      if (schedObj.weeklyShifts && typeof schedObj.weeklyShifts === "object") {
        const wDays = Object.keys(schedObj.weeklyShifts).filter(
          (d) => Array.isArray(schedObj.weeklyShifts[d]) && schedObj.weeklyShifts[d].length > 0
        );
        if (wDays.length > 0) return wDays.map(normalizeDayName);
      }
      const schedKeys = Object.keys(schedObj).filter(Boolean);
      if (schedKeys.length > 0 && days.length === 0) {
        days = schedKeys;
      }
    }
  }

  const normalized = days.map(normalizeDayName).filter(Boolean);
  return Array.from(new Set(normalized));
}

export function formatCleanDoctorTitle(name?: string | null): string {
  if (!name) return "";
  const cleaned = name.replace(/^dr\.?\s*/i, "").trim();
  return cleaned ? `Dr. ${cleaned}` : "";
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
  }
  return undefined;
}

export { isDoctorOnDutyOnDay };

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
  const centralUrl = getDoctorAvatarUrl(doc.id || doc.doctor_id, doc);
  if (centralUrl) {
    return centralUrl;
  }
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
  } catch { }

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
  } catch { }

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
  slotIntervalMinutes?: number;
  maxPatientsPerDay?: number;
  openTime?: string;
  closeTime?: string;
  operatingDays?: string;
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
  } catch { }
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
    } catch { }
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
  const [availableClinics, setAvailableClinics] = useState<{ id: string; name: string; district?: string }[]>([]);
  const [loadingClinic, setLoadingClinic] = useState(true);
  const [showClinicDetailsModal, setShowClinicDetailsModal] = useState(false);
  const [showInstructionsModal, setShowInstructionsModal] = useState(false);
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
  const [isDoctorDropdownOpen, setIsDoctorDropdownOpen] = useState(false);
  const doctorDropdownRef = useRef<HTMLDivElement>(null);

  // Close doctor dropdown when clicking outside or changing date
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (doctorDropdownRef.current && !doctorDropdownRef.current.contains(e.target as Node)) {
        setIsDoctorDropdownOpen(false);
      }
    }
    if (isDoctorDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isDoctorDropdownOpen]);

  useEffect(() => {
    setIsDoctorDropdownOpen(false);
  }, [selectedDate]);
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

  // PayMongo Return Verification Loading & Error States
  // Synchronously initialized to true if payment_intent is present in URL to eliminate Step 1 form flash
  const [isVerifyingReturn, setIsVerifyingReturn] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      return Boolean(p.get("payment_intent"));
    }
    return false;
  });
  const [returnVerificationError, setReturnVerificationError] = useState<string | null>(null);
  const [verificationRetryCount, setVerificationRetryCount] = useState<number>(0);

  // Online Payment Checkout Modal State
  const [showDemoCheckoutModal, setShowDemoCheckoutModal] = useState<boolean>(false);
  const [demoCheckoutData, setDemoCheckoutData] = useState<DemoCheckoutData | null>(null);
  const [demoSimulating, setDemoSimulating] = useState<boolean>(false);
  const [paymentConfirmedDetails, setPaymentConfirmedDetails] = useState<{
    reference: string;
    amount: number;
    method: "gcash" | "maya";
    mobileNumber: string;
    patientName: string;
    clinicName: string;
    doctorName: string;
    date: string;
    time: string;
    conditionName?: string;
  } | null>(null);


  const selectedScan = useMemo(() => {
    return patientScans.find((s) => s.id === selectedScanId) || null;
  }, [patientScans, selectedScanId]);

  useEffect(() => {
    let cancelled = false;

    async function loadPatientScans() {
      if (!user?.id) {
        setPatientScans([]);
        setSelectedScanId("");
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
            status,
            skin_condition:condition_id (
              name,
              local_name
            )
          `)
          .eq("user_id", user.id)
          .order("scanned_at", { ascending: false });

        if (cancelled) return;

        let resolvedList: CompletedScanItem[] = [];

        if (!error && Array.isArray(data)) {
          resolvedList = await Promise.all(
            data.map(async (row: any) => {
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
                } catch { }
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
        } else if (error) {
          console.warn("[AppointmentPage] ai_scan_result fetch warning:", error.message);
        }

        if (!cancelled) {
          setPatientScans(resolvedList);

          // If a scanId was passed in URL, booking context, or draft, select it if valid
          const requestedScanId =
            searchParams.get("scanId") ||
            scanContext?.scanId ||
            (isDraftValid ? draft?.primaryScanId : "");

          if (requestedScanId && resolvedList.some((s) => s.id === requestedScanId)) {
            setSelectedScanId(requestedScanId);
          } else if (selectedScanId && resolvedList.some((s) => s.id === selectedScanId)) {
            // Keep existing selection
          } else if (resolvedList.length > 0) {
            setSelectedScanId(resolvedList[0].id);
          } else {
            setSelectedScanId("");
          }
        }
      } catch (err) {
        console.error("Error fetching patient scans:", err);
        if (!cancelled) {
          setPatientScans([]);
          setSelectedScanId("");
        }
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
      } else {
        sessionStorage.removeItem("dermai_booking_return_clinic");
      }
    } catch { }
    const targetUrl = targetClinic
      ? `/dashboard/scan?fromAppointment=1&clinic=${encodeURIComponent(targetClinic)}`
      : `/dashboard/scan?fromAppointment=1`;
    navigate(targetUrl, {
      state: {
        fromAppointment: true,
        clinicId: targetClinic,
      },
    });
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
      } catch { }
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

  // Active chosen doctor on duty (only when explicitly selected or if clinic has exactly 1 doctor)
  const activeDutyDoctor = useMemo<ClinicDoctorItem | null>(() => {
    const docs = selectedClinic?.doctors || [];
    if (docs.length === 0) return null;
    if (!selectedDoctorId) {
      if (docs.length === 1) return docs[0];
      return null;
    }
    const found = docs.find((d) => d.id === selectedDoctorId);
    return found || null;
  }, [selectedClinic?.doctors, selectedDoctorId]);

  // Only auto-initialize selectedDoctorId if the clinic has exactly 1 doctor
  useEffect(() => {
    if (!selectedDoctorId && selectedClinic?.doctors && selectedClinic.doctors.length === 1) {
      setSelectedDoctorId(selectedClinic.doctors[0].id);
    }
  }, [selectedClinic?.doctors, selectedDoctorId]);

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
    const clinicSchedule = {
      openTime: selectedClinic?.openTime,
      closeTime: selectedClinic?.closeTime,
      operatingDays: selectedClinic?.operatingDays,
    };

    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const inCurrentMonth = d.getMonth() === month;
      const isPast = dateStr < todayStr;
      const isTooFar = d > maxDate;
      const isToday = dateStr === todayStr;

      const dayOfWeek = d.toLocaleDateString("en-US", { weekday: "long" });
      const onDutyDocs = doctors.filter((doc) => isDoctorOnDutyOnDay(doc, dayOfWeek, clinicSchedule));

      // Strictly evaluate availability based on the SELECTED doctor's schedule!
      const isSelectedDocOnDuty = activeDutyDoctor
        ? isDoctorOnDutyOnDay(activeDutyDoctor, dayOfWeek, clinicSchedule)
        : onDutyDocs.length > 0;

      const isDisabled = isPast || isTooFar || !isSelectedDocOnDuty;

      return {
        dateStr,
        dayNum: d.getDate(),
        dayOfWeek,
        inCurrentMonth,
        isPast,
        isDisabled,
        isToday,
        onDutyDocs,
        hasDoctorsOnDuty: isSelectedDocOnDuty,
      };
    });
  }, [calendarMonth, selectedClinic?.doctors, activeDutyDoctor, selectedClinic?.openTime, selectedClinic?.closeTime, selectedClinic?.operatingDays]);

  // Filter doctors who are on duty on this day of week
  const onDutyDoctorsForDate = useMemo(() => {
    if (!selectedClinic?.doctors || selectedClinic.doctors.length === 0) return [];
    if (!dayOfWeekForSelectedDate) return [];

    const clinicSchedule = {
      openTime: selectedClinic.openTime,
      closeTime: selectedClinic.closeTime,
      operatingDays: selectedClinic.operatingDays,
    };

    return selectedClinic.doctors.filter((doc) =>
      isDoctorOnDutyOnDay(doc, dayOfWeekForSelectedDate, clinicSchedule)
    );
  }, [selectedClinic?.doctors, dayOfWeekForSelectedDate, selectedClinic?.openTime, selectedClinic?.closeTime, selectedClinic?.operatingDays]);

  // Doctor consultation schedule hours summary for selected date
  const activeDoctorHours = useMemo(() => {
    if (!activeDutyDoctor) {
      return "General Consultation";
    }
    const docSched =
      activeDutyDoctor.weeklySchedule ||
      parseDoctorSchedule(activeDutyDoctor.dutySchedule, activeDutyDoctor.dutyDays);
    const shifts = docSched.weeklyShifts[normalizeDayName(dayOfWeekForSelectedDate)] || [];
    if (shifts.length === 0) {
      return `${formatTime12h(activeDutyDoctor.dutyStartTime || "08:00")} – ${formatTime12h(activeDutyDoctor.dutyEndTime || "17:00")}`;
    }
    return shifts
      .map((s) => `${formatTime12h(s.startTime)} – ${formatTime12h(s.endTime)}`)
      .join(", ");
  }, [activeDutyDoctor, dayOfWeekForSelectedDate]);

  // Doctor specializations helper
  const getDoctorSpecializations = useCallback((doc: ClinicDoctorItem | null | undefined): string[] => {
    if (!doc) return [];
    if (doc.specializations && doc.specializations.length > 0) {
      return doc.specializations;
    }
    if (doc.specialization && typeof doc.specialization === "string") {
      const parts = doc.specialization.split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length > 0) return parts;
    }
    return ["General Dermatology"];
  }, []);

  const activeDoctorSpecializations = useMemo(() => {
    return getDoctorSpecializations(activeDutyDoctor);
  }, [activeDutyDoctor, getDoctorSpecializations]);

  const clinicDoctors = useMemo(() => {
    return selectedClinic?.doctors || [];
  }, [selectedClinic?.doctors]);

  const handleDoctorSelect = useCallback(
    (doc: ClinicDoctorItem) => {
      setSelectedDoctorId(doc.id);
      setIsDoctorDropdownOpen(false);
    },
    []
  );

  const [existingBookings, setExistingBookings] = useState<any[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [hasAuthoritativeOccupancy, setHasAuthoritativeOccupancy] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [realtimeRefreshTick, setRealtimeRefreshTick] = useState(0);
  const [, setSlotConflictWarning] = useState<string | null>(null);

  // Authoritative slot availability tracker (database is single source of truth;
  // Realtime broadcasts are short-lived hints superseded only by fetches started after the event)
  const fetchBookingsSeqRef = useRef<number>(0);
  const availabilityTrackerRef = useRef<SlotAvailabilityTracker>(new SlotAvailabilityTracker());
  const heldSlotTrackerRef = useRef<HeldSlotTracker>(new HeldSlotTracker());
  const [myActiveHold, setMyActiveHold] = useState<HeldSlotMetadata | null>(() => heldSlotTrackerRef.current.get());

  // Discover and synchronize current authenticated patient's own active hold securely
  useEffect(() => {
    let isCancelled = false;

    const syncMyActiveHold = async () => {
      if (!user?.id) {
        setMyActiveHold(null);
        return;
      }

      try {
        // 1. Authoritative check via security definer get_my_active_appointment_hold RPC
        const { data: holdRows, error: rpcErr } = await supabase.rpc(
          "get_my_active_appointment_hold",
          { p_clinic_id: selectedClinic?.id ? String(selectedClinic.id) : null }
        );

        if (!isCancelled && !rpcErr && Array.isArray(holdRows) && holdRows.length > 0) {
          const row = holdRows[0];
          const rec = heldSlotTrackerRef.current.record({
            appointmentId: row.appointment_id,
            clinicId: String(row.clinic_id),
            date: row.slot_date,
            doctorId: row.assigned_doctor_id,
            slotTime: row.slot_time,
          });
          setMyActiveHold(rec);
          if (typeof window !== "undefined") {
            sessionStorage.setItem("dermai_pending_appointment_id", row.appointment_id);
          }
          if (row.slot_date && (!selectedDate || selectedDate === row.slot_date)) {
            setSelectedDate(row.slot_date);
            setSelectedTime(row.slot_time);
          }
          return;
        }

        // 2. Fallback check: verify session pending appointment id against patient_appointment
        const pendingSessionId = typeof window !== "undefined" ? sessionStorage.getItem("dermai_pending_appointment_id") : null;
        if (!isCancelled && pendingSessionId && isValidUuid(pendingSessionId)) {
          const { data: appt, error: apptErr } = await supabase
            .from("patient_appointment")
            .select("appointment_id, payment_status, payment_hold_expires_at, clinic_id, assigned_doctor_id, date, time, batch_time, user_id")
            .eq("appointment_id", pendingSessionId)
            .eq("user_id", user.id)
            .maybeSingle();

          if (!isCancelled && !apptErr && appt && appt.payment_status === "pending_hold") {
            const exp = appt.payment_hold_expires_at ? new Date(appt.payment_hold_expires_at).getTime() : 0;
            if (exp > Date.now()) {
              const rowDate = appt.date ? getManilaCalendarDate(appt.date) : "";
              const rowTime = normalizeSlotTime(appt.time || appt.batch_time);
              const rec = heldSlotTrackerRef.current.record({
                appointmentId: appt.appointment_id,
                clinicId: String(appt.clinic_id),
                date: rowDate,
                doctorId: appt.assigned_doctor_id,
                slotTime: rowTime,
              });
              setMyActiveHold(rec);
              if (rowDate && (!selectedDate || selectedDate === rowDate)) {
                setSelectedDate(rowDate);
                setSelectedTime(rowTime);
              }
              return;
            }
          }

          if (typeof window !== "undefined") {
            sessionStorage.removeItem("dermai_pending_appointment_id");
          }
        }

        if (!isCancelled) {
          const currentHeld = heldSlotTrackerRef.current.get();
          if (currentHeld) {
            heldSlotTrackerRef.current.clearConfirmedInactive(currentHeld.appointmentId);
            setMyActiveHold(null);
          }
        }
      } catch (err) {
        console.warn("[AppointmentPage] Error checking active hold:", err);
      }
    };

    syncMyActiveHold();

    return () => {
      isCancelled = true;
    };
  }, [user?.id, selectedClinic?.id]);

  // Keep tracker view synchronized with selected clinic, date, and doctor
  useEffect(() => {
    if (!selectedDate) return;
    availabilityTrackerRef.current.setView(
      selectedDate,
      activeDutyDoctor?.id,
      String(selectedClinic?.id || "")
    );
    setExistingBookings(availabilityTrackerRef.current.visible());
  }, [selectedDate, activeDutyDoctor?.id, selectedClinic?.id]);

  // Clear slot conflict warning when date or doctor changes
  useEffect(() => {
    setSlotConflictWarning(null);
  }, [selectedDate, activeDutyDoctor?.id]);

  // Supabase Realtime multi-patient availability synchronization & active polling
  useSlotAvailabilityRealtime({
    clinicId: selectedClinic?.id,
    selectedDate,
    doctorId: activeDutyDoctor?.id,
    enabled: !!selectedClinic?.id && !!selectedDate,
    pollingIntervalMs: 5000,
    onRefresh: (payload?: BroadcastSlotChangePayload) => {
      if (selectedDate) {
        availabilityTrackerRef.current.setView(
          selectedDate,
          activeDutyDoctor?.id,
          String(selectedClinic?.id || "")
        );
      }

      if (payload && payload.slotTime && payload.date) {
        const payloadDate = getManilaCalendarDate(payload.date);
        const timeClean = payload.slotTime.slice(0, 5);

        heldSlotTrackerRef.current.onRealtimeEvent({
          date: payloadDate,
          slotTime: timeClean,
          doctorId: payload.doctorId,
          changeType: payload.changeType,
          timestamp: payload.timestamp,
        });

        const isOwnHold = heldSlotTrackerRef.current.matches(payloadDate, timeClean, payload.doctorId);

        if (payload.changeType === "hold_acquired") {
          if (!isOwnHold) {
            if (
              selectedDate === payloadDate &&
              selectedTime === timeClean &&
              doctorScopesOverlap(payload.doctorId, activeDutyDoctor?.id)
            ) {
              setSelectedTime("");
              const timeLabel = formatTime12h(timeClean);
              setSlotConflictWarning(`The ${timeLabel} consultation slot was just reserved by another patient. Please select another available time.`);
            }
          }
        } else if (payload.changeType === "payment_completed") {
          const held = heldSlotTrackerRef.current.get();
          const isMyPaid = Boolean(held && held.date === payloadDate && held.slotTime === timeClean && doctorScopesOverlap(held.doctorId, payload.doctorId));
          if (!isMyPaid) {
            if (
              selectedDate === payloadDate &&
              selectedTime === timeClean &&
              doctorScopesOverlap(payload.doctorId, activeDutyDoctor?.id)
            ) {
              setSelectedTime("");
              const timeLabel = formatTime12h(timeClean);
              setSlotConflictWarning(`The ${timeLabel} consultation slot was just booked by another patient. Please select another available time.`);
            }
          }
        }

        const changed = availabilityTrackerRef.current.applyEvent({
          date: payloadDate,
          slotTime: timeClean,
          doctorId: payload.doctorId,
          changeType: payload.changeType,
          timestamp: payload.timestamp,
        });
        if (changed) {
          setExistingBookings(availabilityTrackerRef.current.visible());
        }
      }

      setRealtimeRefreshTick((t) => t + 1);
    },
  });

  // Modal Escape key dismissal listener
  useEffect(() => {
    if (!showDemoCheckoutModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !demoSimulating) {
        handleDemoReturnToBooking();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showDemoCheckoutModal, demoSimulating]);

  // Tab unload / navigate away checkout hold cleanup
  useEffect(() => {
    const handleUnload = () => {
      const held = heldSlotTrackerRef.current.get();
      const pendingApptId = held?.appointmentId || sessionStorage.getItem("dermai_pending_appointment_id");
      try {
        if (isCheckoutRedirectActiveForAppointment(pendingApptId)) {
          return; // PayMongo checkout redirect in progress for this specific appointment; NEVER release or cancel hold!
        }
      } catch { }
      if (pendingApptId && showDemoCheckoutModal) {
        const slotTime = held?.slotTime || normalizeSlotTime(selectedTime) || undefined;
        releaseAppointmentHoldSafely(pendingApptId, "Checkout abandoned on tab close.", {
          clinicId: held?.clinicId || (selectedClinic?.id ? String(selectedClinic.id) : undefined),
          date: held?.date || selectedDate || undefined,
          doctorId: held ? held.doctorId : activeDutyDoctor?.id,
          slotTime,
        });
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
    };
  }, [showDemoCheckoutModal, selectedClinic?.id, selectedDate, selectedTime, activeDutyDoctor?.id]);

  const handleRetryAvailability = useCallback(() => {
    setAvailabilityError(null);
    setRealtimeRefreshTick((t) => t + 1);
  }, []);

  // Fetch real-time active bookings for the clinic and chosen date
  useEffect(() => {
    let cancelled = false;
    const currentSeq = ++fetchBookingsSeqRef.current;

    async function fetchBookings() {
      if (!selectedDate) {
        setHasAuthoritativeOccupancy(false);
        setAvailabilityError(null);
        return;
      }
      const clinicId = selectedClinic?.id;
      if (!clinicId) {
        setHasAuthoritativeOccupancy(false);
        setAvailabilityError(null);
        return;
      }

      const scopeKey = String(clinicId);
      availabilityTrackerRef.current.setView(selectedDate, activeDutyDoctor?.id, scopeKey);
      const fetchStartedAt = Date.now();
      setLoadingBookings(true);

      try {
        // Query clinic-wide occupied slots for the date; SlotAvailabilityTracker.visible()
        // filters per selected doctor while keeping unassigned clinic-wide holds active.
        const authoritativeSlots = await fetchAuthoritativeOccupiedSlots({
          clinicId,
          date: selectedDate,
          doctorId: null,
        });
        if (!cancelled) {
          const nextVisible = availabilityTrackerRef.current.applyAuthoritative(
            authoritativeSlots,
            fetchStartedAt,
            { forDate: selectedDate, scopeKey }
          );
          setExistingBookings(nextVisible);
          setHasAuthoritativeOccupancy(true);
          setAvailabilityError(null);
        }
      } catch (rpcErr) {
        // On transient RPC failure, preserve the existing tracker state (unknown != free;
        // never overwrite known reservations with an RLS-filtered table query).
        console.debug("[AppointmentPage] authoritative slots fetch note:", rpcErr);
        if (!cancelled) {
          setExistingBookings(availabilityTrackerRef.current.visible());
          setHasAuthoritativeOccupancy(false);
          setAvailabilityError(
            "Unable to verify real-time slot availability for this date. Booking is paused to prevent double-booking."
          );
        }
      } finally {
        if (!cancelled && currentSeq === fetchBookingsSeqRef.current) {
          setLoadingBookings(false);
        }
      }
    }
    fetchBookings();
    return () => {
      cancelled = true;
    };
  }, [selectedDate, selectedClinic?.id, activeDutyDoctor?.id, realtimeRefreshTick]);

  // Dynamically generate consecutive consultation slots grouped by shift using unified schedulingService
  const dayShiftGroups = useMemo<DayShiftSlotsGroup[]>(() => {
    if (!activeDutyDoctor || !selectedDate || !dayOfWeekForSelectedDate) return [];
    const clinicSchedule = {
      openTime: selectedClinic?.openTime,
      closeTime: selectedClinic?.closeTime,
      operatingDays: selectedClinic?.operatingDays,
    };
    if (!isDoctorOnDutyOnDay(activeDutyDoctor, dayOfWeekForSelectedDate, clinicSchedule)) return [];

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const isToday = selectedDate === todayStr;
    const currentMinutesNow = now.getHours() * 60 + now.getMinutes();

    const docSchedule =
      activeDutyDoctor.weeklySchedule ||
      parseDoctorSchedule(activeDutyDoctor.dutySchedule, activeDutyDoctor.dutyDays);

    const clinicDefaults = {
      defaultSlotIntervalMinutes: selectedClinic?.slotIntervalMinutes || 30,
      openTime: selectedClinic?.openTime,
      closeTime: selectedClinic?.closeTime,
      operatingDays: selectedClinic?.operatingDays,
    };

    return generateDaySlotsForDoctor({
      doctorSchedule: docSchedule,
      dayOfWeek: dayOfWeekForSelectedDate,
      doctorId: activeDutyDoctor.id,
      clinicDefaults,
      existingAppointments: existingBookings,
      isToday,
      currentMinutesNow,
    });
  }, [activeDutyDoctor, selectedDate, dayOfWeekForSelectedDate, selectedClinic, existingBookings]);

  // Flattened consultation slots across all shifts for quick lookup
  const consultationSlots = useMemo<ConsultationSlot[]>(() => {
    return dayShiftGroups.flatMap((g) => g.slots);
  }, [dayShiftGroups]);

  // Detect if currently selectedTime was just occupied by another patient
  useEffect(() => {
    if (!selectedTime || consultationSlots.length === 0) return;
    const currentSlot = consultationSlots.find((s) => s.slotTime === selectedTime);
    if (!currentSlot) return;

    const isOwnHold = Boolean(
      myActiveHold &&
      myActiveHold.clinicId === String(selectedClinic?.id) &&
      myActiveHold.date === selectedDate &&
      myActiveHold.slotTime === selectedTime &&
      doctorScopesOverlap(myActiveHold.doctorId, activeDutyDoctor?.id)
    );

    if (!currentSlot.isAvailable && !isOwnHold) {
      // Immediately clear the selected time if taken by someone else and notify
      setSelectedTime("");
      const timeLabel = currentSlot.label || formatTime12h(selectedTime);
      const isSlotReserved = Boolean(currentSlot.occupancyType === "reserved" || currentSlot.isReserved);
      setSlotConflictWarning(
        `The ${timeLabel} consultation slot was just ${isSlotReserved ? "reserved" : "booked"} by another patient. Please select another available time.`
      );
    }
  }, [consultationSlots, selectedTime, myActiveHold, selectedClinic?.id, selectedDate, activeDutyDoctor?.id]);

  const selectedSlot = useMemo<ConsultationSlot | null>(() => {
    if (consultationSlots.length === 0) return null;
    return consultationSlots.find((s) => s.slotTime === selectedTime) || null;
  }, [consultationSlots, selectedTime]);

  const isSelectedSlotOwnHold = useMemo<boolean>(() => {
    return Boolean(
      myActiveHold &&
      myActiveHold.clinicId === String(selectedClinic?.id) &&
      myActiveHold.date === selectedDate &&
      myActiveHold.slotTime === selectedTime &&
      doctorScopesOverlap(myActiveHold.doctorId, activeDutyDoctor?.id)
    );
  }, [myActiveHold, selectedClinic?.id, selectedDate, selectedTime, activeDutyDoctor?.id]);


  const isDailyCapacityReached = useMemo(() => {
    if (dayShiftGroups.length === 0) return false;
    return dayShiftGroups.every((g) => g.isCapacityReached);
  }, [dayShiftGroups]);

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
    return selectedSlot ? selectedSlot.timeRange : selectedTime ? formatTime12h(selectedTime) : activeDoctorHours;
  }, [selectedSlot, selectedTime, activeDoctorHours]);

  // Note: AI condition, confidence, questionnaire, and photo are cleanly initialized
  // in useState from draft / scanContext, avoiding harmful overwrites on step navigation.

  // Fetch approved clinic strictly from database with rich details
  useEffect(() => {
    let cancelled = false;
    async function loadClinic() {
      setLoadingClinic(true);
      let targetClinicId = searchParams.get("clinic");

      // Query available approved clinics from Supabase and select default if none in URL
      try {
        const { data: allClinics } = await supabase
          .from("clinic")
          .select("clinic_id, name, district")
          .eq("status", "approved");

        if (allClinics && allClinics.length > 0) {
          setAvailableClinics(allClinics.map((c: any) => ({ id: c.clinic_id, name: c.name, district: c.district })));
          if (!targetClinicId) {
            targetClinicId = allClinics[0].clinic_id;
          }
        }
      } catch (err) {
        console.warn("[AppointmentPage] Error loading clinic list:", err);
      }

      if (!targetClinicId) {
        try {
          const cachedClinicId = sessionStorage.getItem("dermai_selected_clinic_id");
          if (cachedClinicId) {
            targetClinicId = cachedClinicId;
          } else {
            const { data: anyClinic } = await supabase
              .from("clinic")
              .select("clinic_id")
              .limit(1)
              .maybeSingle();
            if (anyClinic?.clinic_id) {
              targetClinicId = anyClinic.clinic_id;
            }
          }
        } catch { }
      }

      if (!targetClinicId) {
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
          .eq("clinic_id", targetClinicId)
          .maybeSingle();

        // Fetch doctors with resilient query and local cache fallback
        let rawDoctorRows: any[] = [];
        try {
          const { data: docRows1, error: err1 } = await supabase
            .from("clinic_doctor")
            .select(`
              *,
              user:user_id ( avatar_url ),
              doctor_specializations (
                specialization_id,
                specializations (
                  id,
                  name
                )
              )
            `)
            .eq("clinic_id", targetClinicId);

          if (!err1 && Array.isArray(docRows1) && docRows1.length > 0) {
            rawDoctorRows = docRows1;
          } else if (data?.clinic_id && String(data.clinic_id) !== String(clinicIdFromUrl)) {
            const { data: docRows2, error: err2 } = await supabase
              .from("clinic_doctor")
              .select(`
                *,
                user:user_id ( avatar_url ),
                doctor_specializations (
                  specialization_id,
                  specializations (
                    id,
                    name
                  )
                )
              `)
              .eq("clinic_id", data.clinic_id);

            if (!err2 && Array.isArray(docRows2) && docRows2.length > 0) {
              rawDoctorRows = docRows2;
            }
          }

          // Fallback to select("*") if relation query failed
          if (rawDoctorRows.length === 0) {
            const { data: fallbackRows } = await supabase
              .from("clinic_doctor")
              .select("*")
              .eq("clinic_id", targetClinicId);
            if (Array.isArray(fallbackRows) && fallbackRows.length > 0) {
              rawDoctorRows = fallbackRows;
            }
          }
        } catch (docErr) {
          console.warn("Direct clinic_doctor fetch error:", docErr);
        }

        // Fallback to local storage cache if database returned no doctors
        if (rawDoctorRows.length === 0) {
          try {
            const allCachedDocs: any[] = [];
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && k.startsWith("dermai_clinic_doctors")) {
                const val = localStorage.getItem(k);
                if (val) {
                  const parsed = JSON.parse(val);
                  if (Array.isArray(parsed)) {
                    allCachedDocs.push(...parsed);
                  }
                }
              }
            }
            if (allCachedDocs.length > 0) {
              const targetClinicName = (data?.name || "").toLowerCase().trim();
              const targetClinicId = String(data?.clinic_id || clinicIdFromUrl || "").toLowerCase().trim();

              const matched = allCachedDocs.filter((d: any) => {
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
                rawDoctorRows = allCachedDocs.filter((d: any) => String(d.status || "active").toLowerCase() !== "inactive");
              }
            }
          } catch { }
        }

        // Map raw doctor rows to ClinicDoctorItem objects
        const doctorsList: ClinicDoctorItem[] = rawDoctorRows
          .filter((d: any) => {
            const st = String(d.status || "active").toLowerCase();
            return st !== "inactive" && (d.doctor_name || d.name);
          })
          .map((d: any) => {
            const docName = d.doctor_name || d.name || "Attending Dermatologist";

            const rawSchedObj = d.duty_schedule || d.dutySchedule;
            let weeklySched = parseDoctorSchedule(
              rawSchedObj,
              d.duty_days || d.dutyDays,
              d.duty_start_time || d.dutyStartTime || "08:00",
              d.duty_end_time || d.dutyEndTime || "17:00"
            );

            let pDays = Object.keys(weeklySched.weeklyShifts).filter(
              (day) => weeklySched.weeklyShifts[day] && weeklySched.weeklyShifts[day].length > 0
            );
            if (pDays.length === 0) {
              pDays = parseDoctorDutyDays(d.duty_days || d.dutyDays, rawSchedObj);
            }

            let startT = d.duty_start_time || d.dutyStartTime || "08:00";
            let endT = d.duty_end_time || d.dutyEndTime || "17:00";
            let maxPatients = weeklySched.maxPatientsPerShift || 10;
            let slotInterval = weeklySched.slotIntervalMinutes || 30;

            // Live synchronization with clinic roster settings (from ClinicDoctorsPage)
            let localMatch: any = null;
            try {
              for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith("dermai_clinic_doctors")) {
                  const val = localStorage.getItem(k);
                  if (val) {
                    const parsed = JSON.parse(val);
                    if (Array.isArray(parsed)) {
                      const match = parsed.find((cd: any) => isDoctorMatch(cd, d));
                      if (match) {
                        localMatch = match;
                        const localWeekly = parseDoctorSchedule(
                          match.dutySchedule || match.duty_schedule || (match.weeklyShifts ? match : undefined),
                          match.dutyDays || match.duty_days,
                          match.dutyStartTime || "08:00",
                          match.dutyEndTime || "17:00"
                        );
                        const localActiveDays = Object.keys(localWeekly.weeklyShifts).filter(
                          (day) => localWeekly.weeklyShifts[day] && localWeekly.weeklyShifts[day].length > 0
                        );
                        if (localActiveDays.length > 0) {
                          weeklySched = localWeekly;
                          pDays = localActiveDays;
                        }
                        if (match.dutyStartTime) startT = match.dutyStartTime;
                        if (match.dutyEndTime) endT = match.dutyEndTime;
                        if (match.maxPatientsPerDay || match.maxPatientsPerShift) {
                          maxPatients = Number(match.maxPatientsPerDay || match.maxPatientsPerShift);
                          weeklySched.maxPatientsPerShift = maxPatients;
                        }
                        if (match.slotIntervalMinutes) {
                          slotInterval = Number(match.slotIntervalMinutes);
                          weeklySched.slotIntervalMinutes = slotInterval;
                        }
                        break;
                      }
                    }
                  }
                }
              }
            } catch { }

            // If duty days are unconfigured, default to Mon-Fri
            if (pDays.length === 0) {
              pDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
            }

            // Real specializations extraction (junction table, local cache, or fields)
            let resolvedSpecializations: string[] = [];

            // 1. From doctor_specializations junction table join
            if (Array.isArray(d.doctor_specializations) && d.doctor_specializations.length > 0) {
              resolvedSpecializations = d.doctor_specializations
                .map((ds: any) => ds.specializations?.name || ds.name)
                .filter(Boolean);
            }

            // 2. From localMatch (Clinic roster cache from ClinicDoctorsPage)
            if (resolvedSpecializations.length === 0 && localMatch) {
              if (Array.isArray(localMatch.specializations) && localMatch.specializations.length > 0) {
                resolvedSpecializations = localMatch.specializations
                  .map((s: any) => (typeof s === "string" ? s : s.name))
                  .filter(Boolean);
              } else if (localMatch.specialization && typeof localMatch.specialization === "string") {
                resolvedSpecializations = localMatch.specialization
                  .split(",")
                  .map((s: string) => s.trim())
                  .filter(Boolean);
              }
            }

            // 3. From d.specializations array
            if (resolvedSpecializations.length === 0 && Array.isArray(d.specializations) && d.specializations.length > 0) {
              resolvedSpecializations = d.specializations
                .map((s: any) => (typeof s === "string" ? s : s.name))
                .filter(Boolean);
            }

            // 4. From d.specialization string
            if (resolvedSpecializations.length === 0 && d.specialization && typeof d.specialization === "string") {
              resolvedSpecializations = d.specialization
                .split(",")
                .map((s: string) => s.trim())
                .filter(Boolean);
            }

            // 5. Default fallback
            if (resolvedSpecializations.length === 0) {
              resolvedSpecializations = ["General Dermatology"];
            }

            const specStr = resolvedSpecializations.join(", ");

            const userObj = Array.isArray(d.user) ? d.user[0] : d.user;
            let resolvedPhoto = d.photo_url || d.photo || d.photoUrl || userObj?.avatar_url || d.avatar_url;
            if (resolvedPhoto) {
              resolvedPhoto = resolveAvatarUrl(resolvedPhoto) || resolvedPhoto;
            } else {
              resolvedPhoto = getDoctorPhoto({ id: d.doctor_id || d.id, name: docName, email: d.email });
            }

            return {
              id: String(d.doctor_id || d.id || `doc-${docName}`),
              name: docName,
              specialization: specStr,
              specializations: resolvedSpecializations,
              photo: resolvedPhoto || undefined,
              dutyDays: pDays,
              dutyStartTime: startT,
              dutyEndTime: endT,
              dutySchedule: rawSchedObj,
              weeklySchedule: weeklySched,
              maxPatientsPerDay: maxPatients,
              slotIntervalMinutes: slotInterval,
              status: d.status || "Active",
            };
          });

        if (!cancelled && !error && data) {
          let hoursStr = "";
          let clinicOpenTime = "08:00";
          let clinicCloseTime = "17:00";
          let clinicOpDays = "Monday - Saturday";

          if (Array.isArray(data.clinic_operating_hours) && data.clinic_operating_hours.length > 0) {
            const h = data.clinic_operating_hours[0];
            if (h.open_time) clinicOpenTime = String(h.open_time).slice(0, 5);
            if (h.close_time) clinicCloseTime = String(h.close_time).slice(0, 5);
            if (h.day_of_week) clinicOpDays = h.day_of_week;
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
          let clinicFee = data.consultation_fee ? String(data.consultation_fee) : "";
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
                  if (matched?.openTime) clinicOpenTime = matched.openTime;
                  if (matched?.closeTime) clinicCloseTime = matched.closeTime;
                  if (matched?.operatingDays) clinicOpDays = matched.operatingDays;
                }
              }
            } catch { }
          }

          let clinicInterval = 30;
          let clinicMaxPatients = 20;

          // Overlay real-time clinic settings
          try {
            const settRaw = localStorage.getItem("dermai_clinic_settings");
            if (settRaw) {
              const sett = JSON.parse(settRaw);
              const isMatch = (sett.id && String(sett.id) === String(data.clinic_id)) ||
                (sett.name && data.name && sett.name.toLowerCase().trim() === data.name.toLowerCase().trim()) ||
                (sett.email && data.email && sett.email.toLowerCase().trim() === data.email.toLowerCase().trim());
              if (isMatch) {
                if (sett.openTime) clinicOpenTime = sett.openTime;
                if (sett.closeTime) clinicCloseTime = sett.closeTime;
                if (sett.operatingDays) clinicOpDays = sett.operatingDays;
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
                if (sett.slotIntervalMinutes) clinicInterval = Number(sett.slotIntervalMinutes);
                if (sett.maxPatientsPerDay) clinicMaxPatients = Number(sett.maxPatientsPerDay);
              }
            }
          } catch { }

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
            slotIntervalMinutes: clinicInterval,
            maxPatientsPerDay: clinicMaxPatients,
            openTime: clinicOpenTime,
            closeTime: clinicCloseTime,
            operatingDays: clinicOpDays,
          });
        } else if (!cancelled) {
          // Fallback query if nested relations were not available
          const { data: simpleData } = await supabase
            .from("clinic")
            .select("clinic_id, name, logo_url, district, address, phone, status, description, consultation_fee")
            .eq("clinic_id", targetClinicId)
            .maybeSingle();

          if (simpleData) {
            let logoUrl = simpleData.logo_url || "";
            let photosList: string[] = [];
            let hoursStr = "";
            let clinicFee = simpleData.consultation_fee ? String(simpleData.consultation_fee) : "";
            let clinicAddress = simpleData.address || simpleData.district || "";
            let clinicPhone = simpleData.phone || "";
            let clinicDesc = (simpleData.description || "").trim();

            try {
              const { data: pRows } = await supabase
                .from("clinic_photo")
                .select("photo_url")
                .eq("clinic_id", targetClinicId)
                .order("sort_order");
              if (pRows && pRows.length > 0) {
                photosList = pRows.map((p: any) => p.photo_url).filter(Boolean);
              }
            } catch { }

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
            } catch { }

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

  // Listen for PayMongo 3DS redirect return (e.g. from GCash / Maya)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const intentId = params.get("payment_intent");
    const clientKey = params.get("payment_intent_client_key") || sessionStorage.getItem("dermai_pending_payment_intent_client_key");
    const returnedApptId = params.get("appointment_id") || sessionStorage.getItem("dermai_pending_appointment_id");

    if (!intentId) {
      setIsVerifyingReturn(false);
      // Browser Back handling:
      // If no payment_intent in URL, any redirect session has ended (user clicked Back or directly navigated).
      // Invalidate/clear the redirect record so subsequent bookings or cancellations are not blocked.
      clearCheckoutRedirectRecord(null, "Browser Back or direct navigation without payment_intent");
      return;
    }

    if (!clientKey) {
      console.warn("[AppointmentPage] PayMongo payment intent ID present but client key missing");
      setIsVerifyingReturn(false);
      setReturnVerificationError("Payment verification credentials were not found. If your payment was deducted, your appointment will be updated automatically via webhook.");
      return;
    }

    let cancelled = false;

    async function handlePayMongoReturn() {
      try {
        try {
          clearCheckoutRedirectRecord(returnedApptId, "Payment return verification initiated");
        } catch { }
        setIsVerifyingReturn(true);
        setReturnVerificationError(null);
        setSubmitting(true);
        const { data, error: vErr } = await supabase.functions.invoke("paymongo-payment", {
          body: {
            action: "verify_payment_intent",
            paymentIntentId: intentId,
            clientKey,
          },
        });

        if (cancelled) return;
        if (vErr) {
          console.warn("[AppointmentPage] PayMongo return verification warning:", vErr);
        }

        const status = data?.attributes?.status || data?.status;
        if (status === "succeeded") {
          const payments = data?.attributes?.payments || [];
          const primaryPayment = payments[0];
          const payId = primaryPayment?.id || data?.attributes?.latest_payment_id || intentId;
          const meta = data?.attributes?.metadata || {};
          const feePaid = (data?.attributes?.amount || primaryPayment?.attributes?.amount || 0) / 100;

          let apptPatientName = meta.patient_name || patientName;
          const apptClinicName = meta.clinic_name || selectedClinic?.name || "Skin Clinic";
          const apptDoctorName = meta.doctor_name || activeDutyDoctor?.name || "Attending Dermatologist";
          let apptDate = meta.appointment_date || formattedPreviewDate;
          let apptTime = meta.appointment_time || formattedPreviewTime;

          let dbApptRow: any = null;
          if (returnedApptId) {
            const { data: dbAppt } = await supabase
              .from("patient_appointment")
              .select("patient_name, date, time, batch_time, clinic_id, assigned_doctor_id, clinic_note")
              .eq("appointment_id", returnedApptId)
              .maybeSingle();

            if (dbAppt) {
              dbApptRow = dbAppt;
              if (dbAppt.patient_name) apptPatientName = dbAppt.patient_name;
              if (dbAppt.date) {
                const parsedD = new Date(dbAppt.date);
                if (!isNaN(parsedD.getTime())) {
                  apptDate = parsedD.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                }
              }
              if (dbAppt.time) {
                apptTime = formatTime12h(dbAppt.time.slice(0, 5));
              }
            }
          }

          setPaymentConfirmedDetails({
            reference: payId,
            amount: feePaid || Number(selectedClinic?.consultationFee || 0),
            method: (meta.payment_method === "maya" || meta.payment_method === "paymaya") ? "maya" : "gcash",
            mobileNumber: meta.patient_contact || patientContact,
            patientName: apptPatientName,
            clinicName: apptClinicName,
            doctorName: apptDoctorName,
            date: apptDate,
            time: apptTime,
          });

          const completedHold = heldSlotTrackerRef.current.get();
          heldSlotTrackerRef.current.clearOnPaymentSuccess(returnedApptId);
          setMyActiveHold(null);
          setSubmitted(true);
          setIsVerifyingReturn(false);
          sessionStorage.removeItem("dermai_appointment_draft");
          sessionStorage.removeItem("dermai_pending_payment_intent_client_key");
          sessionStorage.removeItem("dermai_pending_appointment_id");

          const targetClinic = dbApptRow?.clinic_id || completedHold?.clinicId || selectedClinic?.id || searchParams.get("clinic");
          if (targetClinic) {
            const completedDate = dbApptRow?.date
              ? getManilaCalendarDate(dbApptRow.date)
              : (completedHold?.date || selectedDate || apptDate);
            const completedTime =
              normalizeSlotTime(dbApptRow?.time || dbApptRow?.batch_time) ||
              completedHold?.slotTime ||
              normalizeSlotTime(selectedTime) ||
              apptTime;
            broadcastSlotChange(targetClinic, {
              date: completedDate,
              doctorId: dbApptRow?.assigned_doctor_id ?? completedHold?.doctorId ?? activeDutyDoctor?.id,
              slotTime: completedTime,
              type: "payment_completed",
            });
            setRealtimeRefreshTick((t) => t + 1);
          }
        } else {
          const failureReason =
            data?.error ||
            (status === "cancelled"
              ? "Payment was cancelled on the checkout page."
              : `Payment status: ${status || "pending verification"}.`);
          setReturnVerificationError(failureReason);
          setIsVerifyingReturn(false);
        }
      } catch (err: any) {
        console.error("[AppointmentPage] PayMongo return handler error:", err);
        if (!cancelled) {
          setReturnVerificationError(err?.message || "An unexpected error occurred while verifying your payment with PayMongo.");
          setIsVerifyingReturn(false);
        }
      } finally {
        if (!cancelled) setSubmitting(false);
      }
    }

    handlePayMongoReturn();
    return () => { cancelled = true; };
  }, [searchParams, verificationRetryCount]);

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
      } catch { }
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
      const cleanContact = patientContact.replace(/\D/g, "");
      if (cleanContact.length < 10 || cleanContact.length > 12) {
        setSubmitError("Patient phone number must be a valid 11-digit number (e.g. 09171234567).");
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
      const cleanEmergency = emergencyContactPhone.replace(/\D/g, "");
      if (cleanEmergency.length < 10 || cleanEmergency.length > 12) {
        setSubmitError("Emergency contact phone number must be a valid 11-digit number (e.g. 09171234567).");
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

    // All bookings require online payment checkout
    const decision = evaluateAppointmentSubmission({
      isDemoMode: true,
      clinic: selectedClinic,
      selectedDate: formattedPreviewDate,
      selectedTime: formattedPreviewTime,
      doctorName: activeDutyDoctor?.name,
      scan: selectedScan
        ? {
          id: selectedScan.id,
          conditionName: selectedScan.conditionName,
          confidence: selectedScan.confidence ? Number(selectedScan.confidence) : null,
        }
        : null,
      patientName,
      patientEmail,
      patientAddress,
      patientContact,
    });

    if (decision.action === "error") {
      setSubmitError(decision.errorMessage);
      return;
    }

    if (decision.action === "open_demo_checkout") {
      setSubmitting(true);
      try {
        const isValidUuid = (val?: string | null): boolean =>
          Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(val).trim()));

        let activeUserId = user?.id;
        if (!activeUserId) {
          try {
            const { data: sess } = await supabase.auth.getSession();
            activeUserId = sess.session?.user?.id;
          } catch { }
        }

        let resolvedDoctorId: string | undefined = isValidUuid(activeDutyDoctor?.id) ? activeDutyDoctor!.id : undefined;
        if (!resolvedDoctorId && activeDutyDoctor?.name && selectedClinic?.id) {
          try {
            const cleanName = activeDutyDoctor.name.replace(/^Dr\.?\s*/i, "").trim();
            const { data: dbDoc } = await supabase
              .from("clinic_doctor")
              .select("doctor_id")
              .eq("clinic_id", String(selectedClinic.id))
              .ilike("doctor_name", `%${cleanName}%`)
              .maybeSingle();
            if (dbDoc?.doctor_id && isValidUuid(dbDoc.doctor_id)) {
              resolvedDoctorId = dbDoc.doctor_id;
            }
          } catch { }
        }
        if (!resolvedDoctorId && isValidUuid(selectedDoctorId)) {
          resolvedDoctorId = selectedDoctorId;
        }

        const validScanId = isValidUuid(selectedScanId) ? selectedScanId : undefined;
        const validCondId = (selectedScan && isValidUuid(selectedScan.conditionId)) ? selectedScan.conditionId : undefined;

        const requestedSlotTime = normalizeSlotTime(selectedTime);
        if (!requestedSlotTime) {
          setSubmitError("Please select an available consultation time slot.");
          setSubmitting(false);
          return;
        }
        const holdDoctorId = resolvedDoctorId || activeDutyDoctor?.id || null;

        let existingHoldId: string | null = null;
        const pendingSessionApptId =
          heldSlotTrackerRef.current.get()?.appointmentId ||
          (typeof window !== "undefined" ? sessionStorage.getItem("dermai_pending_appointment_id") : null);
        if (pendingSessionApptId && isValidUuid(pendingSessionApptId)) {
          try {
            const { data: existingAppt } = await supabase
              .from("patient_appointment")
              .select("appointment_id, payment_status, payment_hold_expires_at, clinic_id, assigned_doctor_id, date, time, batch_time")
              .eq("appointment_id", pendingSessionApptId)
              .maybeSingle();

            const existingDate = existingAppt?.date ? getManilaCalendarDate(existingAppt.date) : "";
            const existingTime = normalizeSlotTime(existingAppt?.time || existingAppt?.batch_time);
            const existingDocId = existingAppt?.assigned_doctor_id ?? null;
            const isSameSlot =
              existingDate === selectedDate &&
              existingTime === requestedSlotTime &&
              String(existingDocId || "") === String(holdDoctorId || "");

            if (
              existingAppt &&
              existingAppt.payment_status === "pending_hold" &&
              existingAppt.clinic_id === String(selectedClinic?.id) &&
              isSameSlot &&
              (!existingAppt.payment_hold_expires_at || new Date(existingAppt.payment_hold_expires_at) > new Date())
            ) {
              existingHoldId = existingAppt.appointment_id;
              const rec = heldSlotTrackerRef.current.record({
                appointmentId: existingAppt.appointment_id,
                clinicId: String(existingAppt.clinic_id),
                date: existingDate || selectedDate,
                doctorId: existingDocId,
                slotTime: existingTime || requestedSlotTime,
              });
              setMyActiveHold(rec);
            } else if (existingAppt && existingAppt.payment_status === "pending_hold") {
              const relOld = await releaseAppointmentHoldSafely(pendingSessionApptId, "Released to acquire fresh hold for checkout.");
              if (relOld.success) {
                heldSlotTrackerRef.current.clearOnReleaseResult(relOld);
                setMyActiveHold(null);
                sessionStorage.removeItem("dermai_pending_appointment_id");
                if (relOld.releasedSlot?.date && relOld.releasedSlot?.slotTime) {
                  availabilityTrackerRef.current.applyEvent({
                    date: relOld.releasedSlot.date,
                    slotTime: relOld.releasedSlot.slotTime,
                    doctorId: relOld.releasedSlot.doctorId,
                    changeType: "hold_released",
                  });
                  setExistingBookings(availabilityTrackerRef.current.visible());
                }
              }
            } else if (
              !existingAppt ||
              existingAppt.payment_status === "cancelled" ||
              existingAppt.payment_status === "expired"
            ) {
              heldSlotTrackerRef.current.clearConfirmedInactive(pendingSessionApptId);
              setMyActiveHold(null);
              sessionStorage.removeItem("dermai_pending_appointment_id");
            } else if (existingAppt.payment_status === "paid") {
              heldSlotTrackerRef.current.clearOnPaymentSuccess(pendingSessionApptId);
              setMyActiveHold(null);
              sessionStorage.removeItem("dermai_pending_appointment_id");
            }
          } catch { }
        }

        let holdApptId = existingHoldId;
        if (!holdApptId) {
          const holdRes = await acquireAppointmentSlotHold({
            clinicId: String(selectedClinic.id),
            doctorId: resolvedDoctorId,
            date: `${selectedDate}T${requestedSlotTime}:00+08:00`,
            time: `${requestedSlotTime}:00`,
            batchTime: requestedSlotTime,
            patientName: patientName.trim() || user?.user_metadata?.full_name || "Patient",
            patientEmail: patientEmail.trim() || user?.email || undefined,
            patientContact: patientContact.trim() || undefined,
            patientAddress: patientAddress.trim() || undefined,
            patientGender: patientGender || undefined,
            patientBirthdate: patientBirthdate || undefined,
            emergencyContactName: emergencyContactName.trim() || undefined,
            emergencyContactPhone: emergencyContactPhone.trim() || undefined,
            emergencyContactRelationship: emergencyRelationship.trim() || undefined,
            notes: notes.trim() || undefined,
            clinicNote: activeDutyDoctor?.name ? `Assigned to ${formatCleanDoctorTitle(activeDutyDoctor.name)} for pre-consultation review.` : undefined,
            questionnaireAnswers: selectedScan?.questionnaireAnswers || questionnaireData || undefined,
            skinPhotoUrl: selectedScan?.photoUrl || undefined,
            aiConditionName: selectedScan?.conditionName || "Skin Assessment",
            aiConfidence: selectedScan?.confidence ? Number(selectedScan.confidence) : undefined,
            conditionId: validCondId,
            primaryScanId: validScanId,
            holdDurationMinutes: 10,
            userId: activeUserId || user?.id || "",
          });

          if (holdRes.success && holdRes.appointmentId) {
            holdApptId = holdRes.appointmentId;
            // Preserve the exact held slot details independently of `selectedTime`
            // (`acquireAppointmentSlotHold` already broadcasted `hold_acquired`).
            const rec = heldSlotTrackerRef.current.record({
              appointmentId: holdRes.appointmentId,
              clinicId: String(selectedClinic.id),
              date: selectedDate,
              doctorId: holdDoctorId,
              slotTime: requestedSlotTime,
            });
            setMyActiveHold(rec);
            setRealtimeRefreshTick((t) => t + 1);
          } else if (classifyHoldFailure(holdRes.code, holdRes.message) === "schedule_config") {
            const docName = activeDutyDoctor?.name ? formatCleanDoctorTitle(activeDutyDoctor.name) : "This doctor";
            const failureMsg = `${docName}'s consultation schedule has not been configured with appointment intervals by the clinic. Please select another available doctor or contact the clinic.`;
            setSubmitError(failureMsg);
            setSubmitting(false);
            return;
          } else if (!holdRes.success && classifyHoldFailure(holdRes.code, holdRes.message) === "slot_conflict") {
            // Slot conflict: another patient owns this slot.
            // Never release a hold we do not own, never invent expiration timestamps,
            // and never broadcast on behalf of another patient; refresh from database truth.
            const isBookedConflict =
              Boolean(holdRes.message?.toLowerCase().includes("booked")) &&
              !holdRes.message?.toLowerCase().includes("reserved");
            availabilityTrackerRef.current.applyEvent({
              date: selectedDate,
              slotTime: requestedSlotTime,
              doctorId: holdDoctorId,
              changeType: isBookedConflict ? "payment_completed" : "hold_acquired",
            });
            setExistingBookings(availabilityTrackerRef.current.visible());
            setRealtimeRefreshTick((t) => t + 1);
            setSelectedTime("");
            const timeLabel = formatTime12h(requestedSlotTime);
            setSlotConflictWarning(`The ${timeLabel} consultation slot was just ${isBookedConflict ? "booked" : "reserved"} by another patient. Please select another available time.`);
            setSubmitError(null);
            setSubmitting(false);
            return;
          } else {
            const fallbackRes = await executeAppointmentCreation();
            if (fallbackRes.success && fallbackRes.appointmentId) {
              holdApptId = fallbackRes.appointmentId;
              const rec = heldSlotTrackerRef.current.record({
                appointmentId: fallbackRes.appointmentId,
                clinicId: String(selectedClinic.id),
                date: selectedDate,
                doctorId: holdDoctorId,
                slotTime: requestedSlotTime,
              });
              setMyActiveHold(rec);
            } else {
              const rawFailure = fallbackRes.error || holdRes.message || "Unable to reserve this consultation slot. Please choose another available slot.";
              const isSlotTaken = rawFailure.toLowerCase().includes("reserved") || rawFailure.toLowerCase().includes("booked") || rawFailure.toLowerCase().includes("exclusive_doctor_slot") || rawFailure.toLowerCase().includes("err_slot_unavailable");
              if (isSlotTaken) {
                setSelectedTime("");
                setSubmitError(null);
              } else {
                const slotRange = selectedSlot?.timeRange || (selectedTime ? formatTime12h(selectedTime) : "selected");
                const failureMsg = formatUserFriendlyBookingError(rawFailure, slotRange);
                setSubmitError(failureMsg);
              }
              setSubmitting(false);
              return;
            }
          }
        }

        if (holdApptId) {
          try {
            clearCheckoutRedirectRecord(null, "New slot hold acquired");
            sessionStorage.setItem("dermai_pending_appointment_id", holdApptId);
          } catch { }

          setDemoCheckoutData({
            ...decision.checkoutData,
            appointmentId: holdApptId,
          });
          setShowDemoCheckoutModal(true);
        }
      } catch (err: any) {
        setSubmitError(err?.message || "Failed to reserve appointment slot. Please try again.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    await executeAppointmentCreation();
  };

  // Execute actual appointment creation and persist to Supabase & local cache
  const executeAppointmentCreation = async (paymentData?: {
    reference: string;
    amount: number;
    method: "gcash" | "maya";
    mobileNumber?: string;
    payerName?: string;
  }): Promise<{ success: boolean; appointmentId?: string; error?: string }> => {
    if (!selectedClinic) {
      const err = "No clinic selected. Please choose a clinic first.";
      setSubmitError(err);
      return { success: false, error: err };
    }

    let activeUserId = user?.id;
    if (!activeUserId) {
      try {
        const { data: sess } = await supabase.auth.getSession();
        activeUserId = sess.session?.user?.id;
      } catch { }
    }

    if (!activeUserId) {
      const err = "You must be logged in to book an appointment. Redirecting to login...";
      setSubmitError(err);
      setTimeout(() => {
        navigate("/login", { state: { from: window.location.pathname + window.location.search } });
      }, 1200);
      return { success: false, error: err };
    }

    if (!selectedScanId) {
      const err = "Please select a completed AI skin scan for this appointment.";
      setSubmitError(err);
      return { success: false, error: err };
    }

    setSubmitting(true);
    try {
      let scanIdToSave: string | null = null;
      let photoPath: string | null = null;
      let conditionLabel = selectedScan?.conditionName || "Skin Assessment";
      let confNum: number | null = selectedScan?.confidence ? Number(selectedScan.confidence) : null;
      let condId: string | null = selectedScan?.conditionId || null;
      let qAnswers: any = selectedScan?.questionnaireAnswers || null;

      try {
        const { data: verifiedScan } = await supabase
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
          .maybeSingle();

        if (verifiedScan) {
          scanIdToSave = verifiedScan.analysis_id;
          photoPath = verifiedScan.photo_url || selectedScan?.photoUrl || null;
          const verifiedCondObj = Array.isArray(verifiedScan.skin_condition)
            ? verifiedScan.skin_condition[0]
            : verifiedScan.skin_condition;
          conditionLabel = verifiedCondObj?.name || selectedScan?.conditionName || "Skin Assessment";
          confNum = verifiedScan.confidence_score !== undefined && verifiedScan.confidence_score !== null
            ? Number(verifiedScan.confidence_score)
            : confNum;
          condId = verifiedScan.condition_id || condId;
          qAnswers = verifiedScan.questionnaire_answers || qAnswers;
        } else if (selectedScan) {
          scanIdToSave = selectedScan.id;
          photoPath = selectedScan.photoUrl || null;
          conditionLabel = selectedScan.conditionName || "Skin Assessment";
          confNum = selectedScan.confidence ? Number(selectedScan.confidence) : null;
          condId = selectedScan.conditionId || null;
          qAnswers = selectedScan.questionnaireAnswers || null;
        }
      } catch (scanErr) {
        console.warn("[AppointmentPage] Scan resolution note:", scanErr);
        if (selectedScan) {
          scanIdToSave = selectedScan.id;
          photoPath = selectedScan.photoUrl || null;
          conditionLabel = selectedScan.conditionName || "Skin Assessment";
        }
      }

      if (!scanIdToSave) {
        const err = "The selected AI skin scan is invalid or does not belong to your account.";
        setSubmitError(err);
        setSubmitting(false);
        return { success: false, error: err };
      }

      // 2. Prepare appointment payload with valid UUID clinic ID
      const targetClinicId = String(selectedClinic.id);
      const targetSlotTime = heldSlotTrackerRef.current.get()?.slotTime || normalizeSlotTime(selectedTime);
      if (!targetSlotTime) {
        const err = "Please select an available consultation time slot.";
        setSubmitError(err);
        setSubmitting(false);
        return { success: false, error: err };
      }
      const scheduledDateTimeIso = `${selectedDate}T${targetSlotTime}:00+08:00`;

      const isValidUuid = (val?: string | null): boolean =>
        Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(val).trim()));

      let assignedDocId: string | undefined = undefined;
      if (isValidUuid(activeDutyDoctor?.id)) {
        assignedDocId = activeDutyDoctor!.id;
      }

      // If activeDutyDoctor.id is temporary (e.g. doc-local-123) or not a UUID, attempt to resolve real Supabase UUID
      if (!assignedDocId && activeDutyDoctor?.name) {
        try {
          const cleanName = activeDutyDoctor.name.replace(/^Dr\.?\s*/i, "").trim();
          let { data: dbDoc } = await supabase
            .from("clinic_doctor")
            .select("doctor_id")
            .eq("clinic_id", targetClinicId)
            .ilike("doctor_name", `%${cleanName}%`)
            .maybeSingle();

          if (!dbDoc?.doctor_id) {
            const { data: anyDoc } = await supabase
              .from("clinic_doctor")
              .select("doctor_id")
              .ilike("doctor_name", `%${cleanName}%`)
              .maybeSingle();
            dbDoc = anyDoc;
          }

          if (dbDoc?.doctor_id && isValidUuid(dbDoc.doctor_id)) {
            assignedDocId = dbDoc.doctor_id;
          }
        } catch { }
      }

      // Fallback: check selectedDoctorId if valid UUID
      if (!assignedDocId && isValidUuid(selectedDoctorId)) {
        assignedDocId = selectedDoctorId;
      }

      // Validate clinic operating days
      if (
        selectedClinic?.operatingDays &&
        !isClinicOpenOnDay(
          dayOfWeekForSelectedDate,
          selectedClinic.operatingDays
        )
      ) {
        const err = `The clinic is closed on ${dayOfWeekForSelectedDate}s (${selectedClinic.name} operating days: ${selectedClinic.operatingDays}). Please select another date.`;
        setSubmitError(err);
        setSubmitting(false);
        return { success: false, error: err };
      }

      const clinicSchedule = {
        openTime: selectedClinic?.openTime,
        closeTime: selectedClinic?.closeTime,
        operatingDays: selectedClinic?.operatingDays,
      };

      // Validate that doctor is scheduled to work on this weekday and respects clinic operating hours
      const targetDay = normalizeDayName(dayOfWeekForSelectedDate);
      const docSchedule =
        activeDutyDoctor?.weeklySchedule ||
        (activeDutyDoctor ? parseDoctorSchedule(activeDutyDoctor.dutySchedule, activeDutyDoctor.dutyDays) : null);
      const doctorShifts = docSchedule?.weeklyShifts[targetDay] || [];

      if (activeDutyDoctor) {
        if (!isDoctorOnDutyOnDay(activeDutyDoctor, dayOfWeekForSelectedDate, clinicSchedule)) {
          const err = `${formatCleanDoctorTitle(activeDutyDoctor.name)} is not available or scheduled to work on ${dayOfWeekForSelectedDate}.`;
          setSubmitError(err);
          setSubmitting(false);
          return { success: false, error: err };
        }
      }

      const reqStartM = timeToMinutes(targetSlotTime);
      const matchedShift = doctorShifts.find((s) => {
        const sStart = timeToMinutes(s.startTime);
        const sEnd = timeToMinutes(s.endTime);
        return reqStartM >= sStart && reqStartM < sEnd;
      });

      if (activeDutyDoctor && doctorShifts.length > 0 && !matchedShift) {
        const err = `The selected time (${formatTime12h(targetSlotTime)}) is outside ${formatCleanDoctorTitle(activeDutyDoctor.name)}'s scheduled shifts on ${dayOfWeekForSelectedDate}. Please choose a valid slot.`;
        setSubmitError(err);
        setSubmitting(false);
        return { success: false, error: err };
      }

      const clinicDefaults = {
        defaultSlotIntervalMinutes: selectedClinic?.slotIntervalMinutes || 30,
        openTime: selectedClinic?.openTime,
        closeTime: selectedClinic?.closeTime,
        operatingDays: selectedClinic?.operatingDays,
      };

      const effectiveSettings = matchedShift
        ? getEffectiveShiftSettings(matchedShift, docSchedule, clinicDefaults)
        : {
          interval: activeDutyDoctor?.slotIntervalMinutes || selectedClinic?.slotIntervalMinutes || 30,
          effectiveCapacity: 999,
          intervalSource: "clinic" as const,
          capacitySource: "clinic" as const,
          possibleSlots: 999,
          capacity: 999,
        };

      // Strict validation against clinic operating hours
      if (selectedClinic?.openTime && selectedClinic?.closeTime) {
        const clinicOpenM = timeToMinutes(selectedClinic.openTime);
        const clinicCloseM = timeToMinutes(selectedClinic.closeTime);
        const interval = effectiveSettings.interval;
        if (reqStartM < clinicOpenM || reqStartM + interval > clinicCloseM) {
          const err = `The selected appointment time (${formatTime12h(targetSlotTime)}) is outside the clinic's operating hours (${formatTime12h(selectedClinic.openTime)} – ${formatTime12h(selectedClinic.closeTime)}).`;
          setSubmitError(err);
          setSubmitting(false);
          return { success: false, error: err };
        }
      }

      if (matchedShift) {
        const shiftStartM = timeToMinutes(matchedShift.startTime);
        const shiftEndM = timeToMinutes(matchedShift.endTime);

        if (reqStartM + effectiveSettings.interval > shiftEndM) {
          const err = `The selected consultation slot (${formatTime12h(targetSlotTime)}) exceeds the shift end time (${formatTime12h(matchedShift.endTime)}). Please choose a valid slot.`;
          setSubmitError(err);
          setSubmitting(false);
          return { success: false, error: err };
        }

        // Validate interval alignment
        if ((reqStartM - shiftStartM) % effectiveSettings.interval !== 0) {
          const err = `The selected appointment time does not match the configured ${effectiveSettings.interval}-minute interval.`;
          setSubmitError(err);
          setSubmitting(false);
          return { success: false, error: err };
        }

        // Validate breaks
        if (Array.isArray(matchedShift.breaks)) {
          for (const brk of matchedShift.breaks) {
            const bStart = timeToMinutes(brk.startTime);
            const bEnd = timeToMinutes(brk.endTime);
            if (reqStartM < bEnd && reqStartM + effectiveSettings.interval > bStart) {
              const err = `The selected consultation slot overlaps with a scheduled break (${formatTime12h(brk.startTime)} – ${formatTime12h(brk.endTime)}).`;
              setSubmitError(err);
              setSubmitting(false);
              return { success: false, error: err };
            }
          }
        }
      }

      // Validate not past if appointment date is today
      const nowCheck = new Date();
      const todayIsoStr = `${nowCheck.getFullYear()}-${String(nowCheck.getMonth() + 1).padStart(2, "0")}-${String(nowCheck.getDate()).padStart(2, "0")}`;
      if (selectedDate === todayIsoStr && reqStartM <= nowCheck.getHours() * 60 + nowCheck.getMinutes()) {
        const err = `The selected consultation slot (${formatTime12h(targetSlotTime)}) has already passed today.`;
        setSubmitError(err);
        setSubmitting(false);
        return { success: false, error: err };
      }

      // Enforce doctor shift capacity and exclusive slot reservation directly against Supabase
      try {
        let capQuery = supabase
          .from("patient_appointment")
          .select("appointment_id, time, batch_time, date, status, assigned_doctor_id, payment_status, payment_hold_expires_at")
          .gte("date", `${selectedDate}T00:00:00+08:00`)
          .lte("date", `${selectedDate}T23:59:59+08:00`)
          .neq("status", "cancelled")
          .neq("status", "rejected");

        if (assignedDocId) {
          capQuery = capQuery.eq("assigned_doctor_id", assignedDocId);
        } else {
          capQuery = capQuery.eq("clinic_id", targetClinicId);
        }

        const { data: dbDayAppts } = await capQuery;
        const activeDayBookings = (dbDayAppts || []).filter((b: any) => {
          const st = String(b.status || "").toLowerCase().trim();
          if (st === "cancelled" || st === "rejected" || st === "declined") return false;
          // Filter out expired, cancelled, or timed-out temporary holds
          const paySt = String(b.payment_status || "").toLowerCase().trim();
          if (paySt === "cancelled" || paySt === "expired" || paySt === "failed") return false;
          if (paySt === "pending_hold" && b.payment_hold_expires_at && new Date(b.payment_hold_expires_at) <= new Date()) {
            return false;
          }
          // Multi-doctor isolation: only count appointments assigned to this doctor
          if (assignedDocId && b.assigned_doctor_id && String(b.assigned_doctor_id) !== String(assignedDocId)) {
            return false;
          }
          return true;
        });

        // Enforce shift-specific capacity
        if (matchedShift) {
          const shiftStartM = timeToMinutes(matchedShift.startTime);
          const shiftEndM = timeToMinutes(matchedShift.endTime);
          const activeShiftBookings = activeDayBookings.filter((b: any) => {
            const bTime = (b.time || b.batch_time || "").slice(0, 5);
            const bM = timeToMinutes(bTime);
            return bM >= shiftStartM && bM < shiftEndM;
          });

          if (activeShiftBookings.length >= effectiveSettings.effectiveCapacity) {
            const err = `${formatCleanDoctorTitle(activeDutyDoctor?.name) || "The attending doctor"} has no remaining available slots for this ${matchedShift.label} shift. Please select another shift or date.`;
            setSubmitError(err);
            setSubmitting(false);
            return { success: false, error: err };
          }
        }

        // Check if this specific slot is already occupied for this doctor
        const isSlotTaken = activeDayBookings.some((b: any) => {
          if (assignedDocId && b.assigned_doctor_id && String(b.assigned_doctor_id) !== String(assignedDocId)) {
            return false;
          }
          const bTime = (b.time || b.batch_time || "").slice(0, 5);
          if (bTime === targetSlotTime) return true;
          if (b.date) {
            const d = new Date(b.date);
            if (!isNaN(d.getTime())) {
              const timeParts = new Intl.DateTimeFormat("en-GB", {
                timeZone: "Asia/Manila",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              }).format(d);
              if (timeParts === targetSlotTime) return true;
            }
          }
          return false;
        });

        if (isSlotTaken) {
          availabilityTrackerRef.current.applyEvent({
            date: selectedDate,
            slotTime: targetSlotTime,
            doctorId: assignedDocId,
            changeType: "hold_acquired",
          });
          setExistingBookings(availabilityTrackerRef.current.visible());
          setRealtimeRefreshTick((t) => t + 1);
          setSelectedTime("");
          setSubmitError(null);
          setSubmitting(false);
          return { success: false };
        }
      } catch (capErr) {
        console.warn("[AppointmentPage] Capacity pre-check warning:", capErr);
      }

      // Compute safe daily queue number scoped to this doctor and calendar date (Asia/Manila)
      let assignedQueueNum = 1;
      try {
        const { data: qData, error: qErr } = await supabase.rpc("get_next_queue_number", {
          p_clinic_id: targetClinicId,
          p_doctor_id: assignedDocId || null,
          p_date: scheduledDateTimeIso,
        });
        if (!qErr && typeof qData === "number" && qData > 0) {
          assignedQueueNum = qData;
        } else {
          // Fallback query directly from patient_appointment table
          const { data: dayAppts } = await supabase
            .from("patient_appointment")
            .select("queue_number, date, assigned_doctor_id, status")
            .eq("clinic_id", targetClinicId);
          assignedQueueNum = computeNextQueueNumber(dayAppts || existingBookings, assignedDocId, selectedDate);
        }
      } catch {
        assignedQueueNum = computeNextQueueNumber(existingBookings, assignedDocId, selectedDate);
      }

      const payerName = paymentData?.payerName || patientName.trim() || user?.user_metadata?.full_name || "Patient";
      const payerContact = paymentData?.mobileNumber || patientContact.trim() || "";
      const feeAmount = paymentData?.amount !== undefined ? paymentData.amount : Number(selectedClinic.consultationFee || 0);

      let initialClinicNote: string | null = null;
      const docDispName = activeDutyDoctor?.name
        ? formatCleanDoctorTitle(activeDutyDoctor.name)
        : null;

      if (paymentData) {
        const payMethodLabel = (paymentData.method === "maya" || (paymentData.method as string) === "paymaya") ? "Maya" : "GCash";
        const paySummary = `Paid Online (${payMethodLabel} Ref: ${paymentData.reference})`;
        initialClinicNote = docDispName
          ? `Assigned to ${docDispName} for pre-consultation review. | ${paySummary}`
          : `Unassigned consultation request. | ${paySummary}`;
      } else {
        initialClinicNote = docDispName
          ? `Assigned to ${docDispName} for pre-consultation review.`
          : null;
      }

      const apptPayload: Record<string, any> = {
        user_id: activeUserId,
        clinic_id: targetClinicId,
        date: scheduledDateTimeIso,
        time: `${targetSlotTime}:00`,
        status: "pending",
        patient_name: payerName,
        patient_email: (demoCheckoutData?.payerEmail || patientEmail).trim() || user?.email || null,
        patient_contact: payerContact || null,
        patient_address: (demoCheckoutData?.payerAddress || patientAddress).trim() || null,
        patient_gender: patientGender || null,
        patient_birthdate: patientBirthdate || null,
        emergency_contact_name: emergencyContactName.trim() || null,
        emergency_contact_phone: emergencyContactPhone.trim() || null,
        emergency_contact_relationship: emergencyRelationship.trim() || null,
        questionnaire_answers: qAnswers || questionnaireData || null,
        notes: notes.trim() || null,
        clinic_note: initialClinicNote,
        primary_scan_id: scanIdToSave,
        skin_photo_url: photoPath,
        ai_condition_name: conditionLabel,
        ai_confidence: confNum,
        condition_id: condId,
        assigned_doctor_id: (assignedDocId && isValidUuid(assignedDocId)) ? assignedDocId : null,
        doctor_status: "pending-review",
        schedule_sent_to_doctor: true,
        queue_number: assignedQueueNum,
        batch_time: targetSlotTime,
        check_in_status: "scheduled",
      };

      if (paymentData) {
        apptPayload.payment_status = "paid";
        apptPayload.payment_reference = paymentData.reference;
        apptPayload.payment_amount = feeAmount;
        apptPayload.paid_at = new Date().toISOString();
      } else {
        apptPayload.payment_status = "pending_hold";
        apptPayload.payment_hold_expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        apptPayload.payment_amount = feeAmount;
      }

      // 3. Insert appointment request into Supabase with resilient dynamic schema stripping loop
      let insertedApptId: string | null = null;
      const currentPayload: Record<string, any> = { ...apptPayload };
      let lastInsertError: any = null;

      for (let attempt = 0; attempt < 8; attempt++) {
        const { data: insertedData, error: insertError } = await supabase
          .from("patient_appointment")
          .insert(currentPayload)
          .select("appointment_id, queue_number")
          .maybeSingle();

        if (!insertError) {
          if (insertedData?.appointment_id) {
            insertedApptId = String(insertedData.appointment_id);
          }
          if (insertedData?.queue_number) {
            assignedQueueNum = Number(insertedData.queue_number);
          }
          lastInsertError = null;
          break;
        }

        lastInsertError = insertError;

        // Handle duplicate booking error gracefully
        if (
          classifyHoldFailure(insertError.code, insertError.message) === "slot_conflict" ||
          insertError.message.includes("duplicate")
        ) {
          availabilityTrackerRef.current.applyEvent({
            date: selectedDate,
            slotTime: targetSlotTime,
            doctorId: assignedDocId,
            changeType: "hold_acquired",
          });
          setExistingBookings(availabilityTrackerRef.current.visible());
          setRealtimeRefreshTick((t) => t + 1);
          setSelectedTime("");
          setSubmitError(null);
          setSubmitting(false);
          return { success: false };
        }

        // Dynamic Foreign Key Protection: If doctor or scan reference fails in remote schema, strip and retry
        if (insertError.message.includes("violates foreign key constraint")) {
          if (insertError.message.includes("assigned_doctor_id") && currentPayload.assigned_doctor_id !== null) {
            console.warn("[AppointmentPage] Assigned doctor foreign key mismatch, falling back to unassigned clinic appointment...");
            currentPayload.assigned_doctor_id = null;
            continue;
          }
          if (insertError.message.includes("primary_scan_id") && currentPayload.primary_scan_id !== undefined) {
            console.warn("[AppointmentPage] Primary scan foreign key mismatch, stripping primary_scan_id...");
            delete currentPayload.primary_scan_id;
            continue;
          }
          if (insertError.message.includes("condition_id") && currentPayload.condition_id !== undefined) {
            console.warn("[AppointmentPage] Condition foreign key mismatch, stripping condition_id...");
            delete currentPayload.condition_id;
            continue;
          }
        }

        // Dynamic Doctor Schedule Interval Protection: Surface clean actionable error if doctor schedule interval is unconfigured
        if (
          insertError.message.includes("ERR_SCHEDULE_CONFIG") ||
          insertError.message.includes("duty schedule") ||
          insertError.message.includes("appointment interval")
        ) {
          const docName = activeDutyDoctor?.name ? formatCleanDoctorTitle(activeDutyDoctor.name) : "This doctor";
          const err = `${docName}'s consultation schedule has not been configured with appointment intervals by the clinic. Please select another available doctor or contact the clinic.`;
          setSubmitError(err);
          setSubmitting(false);
          return { success: false, error: err };
        }

        // Check constraint mismatch protection (e.g. check_appointment_payment_status)
        if (insertError.message.includes("check_appointment_payment_status") || insertError.message.includes("payment_status")) {
          console.warn("[AppointmentPage] Database payment_status constraint mismatch, stripping hold payment fields...");
          delete currentPayload.payment_status;
          delete currentPayload.payment_hold_expires_at;
          delete currentPayload.payment_amount;
          continue;
        }

        // Schema cache missing column error (PGRST204) — extract column and strip from retry
        const missingColMatch = insertError.message.match(/Could not find the '([^']+)' column/i);
        if (missingColMatch && missingColMatch[1]) {
          const badCol = missingColMatch[1];
          console.warn(`[AppointmentPage] Unknown schema column '${badCol}', stripping and retrying insert...`);
          delete currentPayload[badCol];
          continue;
        }

        // Known optional columns fallback check
        const candidateCols = [
          "paid_at",
          "payment_amount",
          "payment_reference",
          "payment_status",
          "payment_hold_expires_at",
          "is_walk_in",
          "primary_scan_id",
          "condition_id",
          "assigned_doctor_id",
          "check_in_status",
          "batch_time",
          "emergency_contact_name",
          "emergency_contact_phone",
          "emergency_contact_relationship",
        ];
        let strippedCandidate = false;
        for (const col of candidateCols) {
          if (insertError.message.includes(col) && currentPayload[col] !== undefined) {
            delete currentPayload[col];
            strippedCandidate = true;
          }
        }
        if (strippedCandidate) {
          continue;
        }

        // Unrecoverable database error
        break;
      }

      if (lastInsertError) {
        console.warn("[AppointmentPage] Database insert fallback note:", lastInsertError.message);
        if (!insertedApptId) {
          setSubmitError(lastInsertError.message || "Failed to reserve appointment slot.");
        }
      }

      // Log payment transaction into user_payment ledger table if paid online
      if (paymentData && activeUserId) {
        try {
          await supabase.from("user_payment").insert({
            user_id: activeUserId,
            amount: feeAmount,
            method: (paymentData.method === "maya" || (paymentData.method as string) === "paymaya") ? "Maya" : "GCash",
            status: "success",
            reference_number: paymentData.reference,
            paymongo_payment_id: paymentData.reference,
            payment_date: new Date().toISOString(),
          });
        } catch (payLogErr) {
          console.warn("[AppointmentPage] user_payment ledger logging note:", payLogErr);
        }
      }

      // Concurrency collision protection: Verify that this booking was first in time
      if (insertedApptId && assignedDocId) {
        try {
          const { data: collisionCheck } = await supabase
            .from("patient_appointment")
            .select("appointment_id, created_at, queue_number")
            .eq("assigned_doctor_id", assignedDocId)
            .gte("date", `${selectedDate}T00:00:00+08:00`)
            .lte("date", `${selectedDate}T23:59:59+08:00`)
            .or(`time.eq.${targetSlotTime}:00,batch_time.eq.${targetSlotTime}`)
            .neq("status", "cancelled")
            .neq("status", "rejected")
            .order("created_at", { ascending: true });

          if (collisionCheck && collisionCheck.length > 1 && String(collisionCheck[0].appointment_id) !== insertedApptId) {
            // Concurrent race collision: another patient booked first, rollback this one
            await supabase.from("patient_appointment").delete().eq("appointment_id", insertedApptId);
            setExistingBookings((prev) => [
              ...prev,
              {
                date: selectedDate,
                time: targetSlotTime,
                batch_time: targetSlotTime,
                assigned_doctor_id: assignedDocId,
                clinic_id: targetClinicId,
                status: "pending",
                doctor_status: "approved",
                payment_status: "pending_hold",
                occupancy_type: "reserved",
              },
            ]);
            setSelectedTime("");
            setSubmitError(null);
            setSubmitting(false);
            return { success: false };
          }
        } catch (colErr) {
          console.warn("[AppointmentPage] Concurrency check warning:", colErr);
        }
      }

      // 4. Save to local cache & notify listeners
      try {
        const newLocalAppt = {
          id: insertedApptId,
          clinicId: targetClinicId,
          clinicName: selectedClinic.name || "Skin Clinic",
          patientName: payerName,
          patientEmail: (demoCheckoutData?.payerEmail || patientEmail).trim() || user?.email || "",
          patientContact: payerContact,
          patientAddress: (demoCheckoutData?.payerAddress || patientAddress).trim() || "",
          patientGender: patientGender || "",
          patientBirthdate: patientBirthdate || "",
          emergencyContactName: emergencyContactName.trim() || "",
          emergencyContactPhone: emergencyContactPhone.trim() || "",
          emergencyRelationship: emergencyRelationship.trim() || "",
          date: formattedPreviewDate || selectedDate,
          time: formattedPreviewTime || selectedTime,
          status: "pending",
          queueNumber: assignedQueueNum,
          primaryScanId: scanIdToSave || undefined,
          conditionId: condId || undefined,
          notes: notes.trim() || "",
          clinicNote: initialClinicNote || undefined,
          skinPhotoUrl: photoPath,
          aiConditionName: conditionLabel,
          aiConfidence: confNum,
          assignedDoctorId: (assignedDocId && isValidUuid(assignedDocId)) ? assignedDocId : activeDutyDoctor?.id,
          assignedDoctorName: activeDutyDoctor?.name || undefined,
          assignedDoctorPhoto: getDoctorPhoto(activeDutyDoctor) || undefined,
          assignedDoctorSpecialization: activeDutyDoctor?.specialization || undefined,
          doctorStatus: "pending-review",
          scheduleSentToDoctor: true,
          paymentStatus: paymentData ? "paid" : "unpaid",
          paymentAmount: paymentData ? feeAmount : undefined,
          paymentReference: paymentData?.reference || undefined,
          paidAt: paymentData ? new Date().toISOString() : undefined,
          createdAt: new Date().toISOString(),
        };
        const existing = localStorage.getItem("dermai_clinic_appointments");
        const list = existing ? JSON.parse(existing) : [];
        if (insertedApptId && Array.isArray(list)) {
          list.unshift(newLocalAppt);
          localStorage.setItem("dermai_clinic_appointments", JSON.stringify(list));
        }
        if (activeUserId) {
          createPatientNotification({
            userId: activeUserId,
            type: "appointment-scheduled",
            subtype: paymentData ? "confirmed" : "requested",
            title: paymentData ? "Payment Received & Appointment Booked" : "Appointment Requested",
            body: paymentData
              ? `Your payment of ₱${feeAmount.toLocaleString()} for ${selectedClinic?.name || "the clinic"} on ${formattedPreviewDate} at ${formattedPreviewTime} was successful.`
              : `Your consultation request with ${selectedClinic?.name || "the clinic"} for ${selectedDate} at ${selectedTime} has been submitted.`,
          });
        }

        if (targetClinicId && insertedApptId) {
          createDoctorAppointmentNotification({
            doctorId: (assignedDocId && isValidUuid(assignedDocId)) ? assignedDocId : activeDutyDoctor?.id,
            clinicId: targetClinicId,
            clinicName: selectedClinic?.name || "Clinic",
            patientId: activeUserId || user?.id || "",
            patientName: payerName || patientName.trim() || "Patient",
            appointmentId: insertedApptId,
            scheduledDate: formattedPreviewDate || selectedDate,
            scheduledTime: formattedPreviewTime || selectedTime,
            consultationType: conditionLabel || "Consultation",
          }).catch((err) => {
            console.warn("[AppointmentPage] Doctor notification trigger note:", err);
          });
        }
        window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
        window.dispatchEvent(new Event("appointmentCreated"));

        logAuditEvent({
          userId: user?.id,
          role: "patient",
          category: "Appointment",
          action: "Appointment Booked",
          target: `${selectedClinic?.name || "Clinic"} - ${selectedDate} ${selectedTime}`,
          details: `${patientName.trim() || "Patient"} requested consultation at ${selectedClinic?.name || "Clinic"} on ${selectedDate} at ${selectedTime}.`,
          performerName: patientName.trim() || user?.user_metadata?.full_name || "Patient",
          metadata: {
            clinicId: targetClinicId,
            clinicName: selectedClinic?.name,
            appointmentDate: selectedDate,
            appointmentTime: selectedTime,
            appointmentId: insertedApptId,
          },
        }).catch(() => { });
      } catch { }

      if (paymentData) {
        setPaymentConfirmedDetails({
          reference: paymentData.reference,
          amount: feeAmount,
          method: paymentData.method,
          mobileNumber: payerContact,
          patientName: payerName,
          clinicName: selectedClinic?.name || "Skin Clinic",
          doctorName: activeDutyDoctor?.name || "Assigned by Clinic upon Review",
          date: formattedPreviewDate,
          time: formattedPreviewTime,
          conditionName: selectedScan?.conditionName || undefined,
        });
        setSubmitted(true);
        try {
          sessionStorage.removeItem("dermai_appointment_draft");
          sessionStorage.removeItem("dermai_selected_clinic_id");
          sessionStorage.removeItem("dermai_booking_return_clinic");
          sessionStorage.removeItem("dermai_scan_booking_context");
        } catch { }
      }

      if (!insertedApptId && lastInsertError) {
        const err = lastInsertError.message || "Failed to save appointment reservation.";
        setSubmitError(err);
        return { success: false, error: err };
      }

      return { success: true, appointmentId: insertedApptId || undefined };
    } catch (err: any) {
      console.error("Submission error:", err);
      const errStr = err?.message || "An unexpected error occurred during submission.";
      setSubmitError(errStr);
      return { success: false, error: errStr };
    } finally {
      setSubmitting(false);
    }
  };

  // Online Payment Handler with PayMongo E-Wallets (GCash & Maya)
  const handleDemoSimulateSuccess = async () => {
    setDemoSimulating(true);
    setSubmitError(null);
    setDemoCheckoutData((prev) => (prev ? { ...prev, errorMessage: undefined, outcome: "idle" } : null));

    const apptFee = Number(selectedClinic?.consultationFee || demoCheckoutData?.consultationFee || 0);
    const chosenMethod = demoCheckoutData?.paymentMethod === "maya" ? "maya" : "gcash";
    const userPhone = (demoCheckoutData?.mobileNumber || patientContact || "09999999999").trim();
    const payer = (demoCheckoutData?.payerName || patientName).trim() || user?.user_metadata?.full_name || "Patient";
    const payerEmail = (demoCheckoutData?.payerEmail || patientEmail).trim() || user?.email || "";

    // Resolve active authenticated user ID reliably
    let activeUserId = user?.id;
    if (!activeUserId) {
      try {
        const { data: sess } = await supabase.auth.getSession();
        activeUserId = sess?.session?.user?.id;
      } catch { }
    }

    if (!activeUserId) {
      const authErrMsg = "You must be logged in to book an appointment. Please sign in and try again.";
      setSubmitError(authErrMsg);
      setDemoCheckoutData((prev) => (prev ? { ...prev, outcome: "failed", errorMessage: authErrMsg } : null));
      setDemoSimulating(false);
      return;
    }

    const isValidUuid = (val?: string | null): boolean =>
      Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(val).trim()));

    // Resolve doctor UUID if duty doctor uses local/display identifier
    let resolvedDoctorId: string | undefined = isValidUuid(activeDutyDoctor?.id) ? activeDutyDoctor!.id : undefined;
    if (!resolvedDoctorId && activeDutyDoctor?.name && selectedClinic?.id) {
      try {
        const cleanName = activeDutyDoctor.name.replace(/^Dr\.?\s*/i, "").trim();
        const { data: dbDoc } = await supabase
          .from("clinic_doctor")
          .select("doctor_id")
          .eq("clinic_id", String(selectedClinic.id))
          .ilike("doctor_name", `%${cleanName}%`)
          .maybeSingle();
        if (dbDoc?.doctor_id && isValidUuid(dbDoc.doctor_id)) {
          resolvedDoctorId = dbDoc.doctor_id;
        }
      } catch { }
    }
    if (!resolvedDoctorId && isValidUuid(selectedDoctorId)) {
      resolvedDoctorId = selectedDoctorId;
    }

    const validScanId = isValidUuid(selectedScanId) ? selectedScanId : undefined;
    const validCondId = (selectedScan && isValidUuid(selectedScan.conditionId)) ? selectedScan.conditionId : undefined;

    let insertedApptId: string | null = null;
    const initialRetainedHold = heldSlotTrackerRef.current.get();
    const effectiveClinicId = initialRetainedHold?.clinicId || String(selectedClinic?.id || "");
    const effectiveDate = initialRetainedHold?.date || selectedDate;
    const effectiveDoctorId = initialRetainedHold
      ? initialRetainedHold.doctorId
      : (resolvedDoctorId || activeDutyDoctor?.id || null);
    const effectiveSlotTime = initialRetainedHold?.slotTime || normalizeSlotTime(selectedTime);

    try {
      // Check for existing active hold in session storage to avoid duplicate holds on retry
      const pendingSessionApptId =
        initialRetainedHold?.appointmentId ||
        (typeof window !== "undefined" ? sessionStorage.getItem("dermai_pending_appointment_id") : null);
      if (pendingSessionApptId && isValidUuid(pendingSessionApptId)) {
        try {
          const { data: existingAppt } = await supabase
            .from("patient_appointment")
            .select("appointment_id, payment_status, payment_hold_expires_at, clinic_id, assigned_doctor_id, date, time, batch_time")
            .eq("appointment_id", pendingSessionApptId)
            .maybeSingle();

          if (
            existingAppt &&
            existingAppt.payment_status === "pending_hold" &&
            existingAppt.clinic_id === String(selectedClinic?.id) &&
            (!existingAppt.payment_hold_expires_at || new Date(existingAppt.payment_hold_expires_at) > new Date())
          ) {
            insertedApptId = existingAppt.appointment_id;
            const dbDate = existingAppt.date ? getManilaCalendarDate(existingAppt.date) : effectiveDate;
            const dbTime = normalizeSlotTime(existingAppt.time || existingAppt.batch_time) || effectiveSlotTime;
            if (dbDate && dbTime) {
              const rec = heldSlotTrackerRef.current.record({
                appointmentId: existingAppt.appointment_id,
                clinicId: String(existingAppt.clinic_id),
                date: dbDate,
                doctorId: existingAppt.assigned_doctor_id ?? effectiveDoctorId,
                slotTime: dbTime,
              });
              setMyActiveHold(rec);
            }
          } else if (existingAppt && existingAppt.payment_status === "pending_hold") {
            const relOld = await releaseAppointmentHoldSafely(pendingSessionApptId, "Released to acquire fresh hold for checkout.");
            if (relOld.success) {
              heldSlotTrackerRef.current.clearOnReleaseResult(relOld);
              setMyActiveHold(null);
              sessionStorage.removeItem("dermai_pending_appointment_id");
            }
          } else if (
            !existingAppt ||
            existingAppt.payment_status === "cancelled" ||
            existingAppt.payment_status === "expired"
          ) {
            heldSlotTrackerRef.current.clearConfirmedInactive(pendingSessionApptId);
            setMyActiveHold(null);
            sessionStorage.removeItem("dermai_pending_appointment_id");
          } else if (existingAppt.payment_status === "paid") {
            heldSlotTrackerRef.current.clearOnPaymentSuccess(pendingSessionApptId);
            setMyActiveHold(null);
            sessionStorage.removeItem("dermai_pending_appointment_id");
          }
        } catch (checkErr) {
          console.warn("[AppointmentPage] Existing hold verification note:", checkErr);
        }
      }

      // 1. Acquire an atomic temporary slot hold via Postgres RPC to prevent race conditions and duplicate slots
      let creationFailureMessage = "";
      if (!insertedApptId) {
        if (!effectiveSlotTime) {
          throw new Error("Please select an available consultation time slot.");
        }
        try {
          const holdRes = await acquireAppointmentSlotHold({
            clinicId: effectiveClinicId,
            doctorId: resolvedDoctorId,
            date: `${effectiveDate}T${effectiveSlotTime}:00+08:00`,
            time: `${effectiveSlotTime}:00`,
            batchTime: effectiveSlotTime,
            patientName: payer,
            patientEmail: payerEmail,
            patientContact: userPhone,
            patientAddress: (demoCheckoutData?.payerAddress || patientAddress || "").trim() || undefined,
            patientGender: patientGender || undefined,
            patientBirthdate: patientBirthdate || undefined,
            emergencyContactName: emergencyContactName.trim() || undefined,
            emergencyContactPhone: emergencyContactPhone.trim() || undefined,
            emergencyContactRelationship: emergencyRelationship.trim() || undefined,
            notes: notes.trim() || undefined,
            clinicNote: activeDutyDoctor?.name ? `Assigned to ${formatCleanDoctorTitle(activeDutyDoctor.name)} for pre-consultation review.` : undefined,
            questionnaireAnswers: selectedScan?.questionnaireAnswers || questionnaireData || undefined,
            skinPhotoUrl: selectedScan?.photoUrl || undefined,
            aiConditionName: selectedScan?.conditionName || "Skin Assessment",
            aiConfidence: selectedScan?.confidence ? Number(selectedScan.confidence) : undefined,
            conditionId: validCondId,
            primaryScanId: validScanId,
            holdDurationMinutes: 10,
            userId: activeUserId,
          });

          if (holdRes.success && holdRes.appointmentId) {
            insertedApptId = holdRes.appointmentId;
            // Preserve the exact held slot details independently of `selectedTime`
            // (`acquireAppointmentSlotHold` already broadcasted `hold_acquired`).
            const rec = heldSlotTrackerRef.current.record({
              appointmentId: holdRes.appointmentId,
              clinicId: effectiveClinicId,
              date: effectiveDate,
              doctorId: effectiveDoctorId,
              slotTime: effectiveSlotTime,
            });
            setMyActiveHold(rec);
            setRealtimeRefreshTick((t) => t + 1);
          } else if (!holdRes.success && classifyHoldFailure(holdRes.code, holdRes.message) === "slot_conflict") {
            const isBookedConflict =
              Boolean(holdRes.message?.toLowerCase().includes("booked")) &&
              !holdRes.message?.toLowerCase().includes("reserved");
            availabilityTrackerRef.current.applyEvent({
              date: effectiveDate,
              slotTime: effectiveSlotTime,
              doctorId: effectiveDoctorId,
              changeType: isBookedConflict ? "payment_completed" : "hold_acquired",
            });
            setExistingBookings(availabilityTrackerRef.current.visible());
            setRealtimeRefreshTick((t) => t + 1);
            const slotRange = selectedSlot?.timeRange || (effectiveSlotTime ? formatTime12h(effectiveSlotTime) : "selected");
            throw new Error(`The ${slotRange} consultation slot was just reserved by another patient. Please choose another available consultation slot.`);
          } else if (!holdRes.success && classifyHoldFailure(holdRes.code, holdRes.message) === "schedule_config") {
            throw new Error(holdRes.message || "This doctor's consultation schedule has not been configured with appointment intervals by the clinic. Please select another available doctor or contact the clinic.");
          } else {
            if (holdRes.message) creationFailureMessage = holdRes.message;
            const fallbackRes = await executeAppointmentCreation();
            if (fallbackRes.success && fallbackRes.appointmentId) {
              insertedApptId = fallbackRes.appointmentId;
              const rec = heldSlotTrackerRef.current.record({
                appointmentId: fallbackRes.appointmentId,
                clinicId: effectiveClinicId,
                date: effectiveDate,
                doctorId: effectiveDoctorId,
                slotTime: effectiveSlotTime,
              });
              setMyActiveHold(rec);
              creationFailureMessage = "";
            } else if (fallbackRes.error) {
              creationFailureMessage = fallbackRes.error;
            }
          }
        } catch (holdErr: any) {
          if (
            holdErr?.message?.includes("reserved by another patient") ||
            holdErr?.message?.includes("already reserved") ||
            holdErr?.message?.includes("already booked") ||
            holdErr?.message?.includes("ERR_SLOT_UNAVAILABLE") ||
            holdErr?.message?.includes("ERR_DUPLICATE_SLOT") ||
            holdErr?.message?.includes("ERR_SCHEDULE_CONFIG")
          ) {
            throw holdErr;
          }
          console.warn("[AppointmentPage] acquireAppointmentSlotHold fallback note:", holdErr?.message);
          const fallbackRes = await executeAppointmentCreation();
          if (fallbackRes.success && fallbackRes.appointmentId) {
            insertedApptId = fallbackRes.appointmentId;
            heldSlotTrackerRef.current.record({
              appointmentId: fallbackRes.appointmentId,
              clinicId: effectiveClinicId,
              date: effectiveDate,
              doctorId: effectiveDoctorId,
              slotTime: effectiveSlotTime,
            });
            creationFailureMessage = "";
          } else if (fallbackRes.error) {
            creationFailureMessage = fallbackRes.error;
          }
        }
      }

      // Critical Guard: Ensure appointment was successfully created and persisted before starting PayMongo checkout
      if (!insertedApptId) {
        throw new Error(
          creationFailureMessage || "Unable to save appointment reservation. Please verify your details and try again."
        );
      }

      // Immediately track the acquired appointment slot hold ID for failure cleanup and cancellation
      try {
        sessionStorage.setItem("dermai_pending_appointment_id", insertedApptId);
      } catch { }

      // 2. If PayMongo key is configured, process through PayMongo
      if (PAYMONGO_PUBLIC_KEY) {
        // Create PayMongo booking intent
        const { data: intentJson, error: intentError } = await supabase.functions.invoke("paymongo-payment", {
          body: {
            action: "create_booking_intent",
            amount: apptFee,
            paymentMethod: chosenMethod,
            clinicId: selectedClinic?.id,
            clinicName: selectedClinic?.name,
            doctorId: resolvedDoctorId || activeDutyDoctor?.id,
            doctorName: activeDutyDoctor?.name,
            appointmentDate: formattedPreviewDate,
            appointmentTime: formattedPreviewTime,
            appointmentId: insertedApptId,
            appointment_id: insertedApptId,
            patientName: payer,
            patientEmail: payerEmail,
            patientContact: userPhone,
          },
        });

        if (intentError) {
          const extracted = await extractEdgeFunctionError(intentError);
          console.warn("[AppointmentPage] PayMongo intent creation error:", {
            status: extracted.status,
            message: extracted.message,
            error: extracted.rawError,
          });
          throw new Error(extracted.message || "Failed to initialize PayMongo booking checkout.");
        }

        const { paymentIntentId, clientKey } = intentJson || {};
        if (paymentIntentId && clientKey) {
          sessionStorage.setItem("dermai_pending_payment_intent_client_key", clientKey);
          if (insertedApptId) {
            sessionStorage.setItem("dermai_pending_appointment_id", insertedApptId);
          }

          // Register payment method with PayMongo
          const pmRes = await fetch("https://api.paymongo.com/v1/payment_methods", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Basic " + btoa(PAYMONGO_PUBLIC_KEY + ":"),
            },
            body: JSON.stringify({
              data: {
                attributes: {
                  type: chosenMethod === "maya" ? "paymaya" : chosenMethod,
                  billing: {
                    name: payer,
                    email: payerEmail,
                    phone: userPhone,
                    address: {
                      line1: (demoCheckoutData?.payerAddress || patientAddress || "Cebu City").trim(),
                      city: "Cebu City",
                      country: "PH",
                    },
                  },
                },
              },
            }),
          });

          const pmJson = await pmRes.json();
          if (pmRes.ok && pmJson?.data?.id) {
            const paymentMethodId = pmJson.data.id;
            const returnUrl = `${window.location.origin}${window.location.pathname}?status=success&payment_intent=${paymentIntentId}&payment_intent_client_key=${encodeURIComponent(clientKey)}&appointment_id=${insertedApptId || ""}&clinic=${selectedClinic?.id || ""}`;

            const { data: attachData, error: attachError } = await supabase.functions.invoke("paymongo-payment", {
              body: {
                action: "attach_payment_method",
                paymentIntentId,
                paymentMethodId,
                clientKey,
                returnUrl,
              },
            });

            if (attachError) {
              const extracted = await extractEdgeFunctionError(attachError);
              console.warn("[AppointmentPage] PayMongo attach payment method error:", {
                status: extracted.status,
                message: extracted.message,
                error: extracted.rawError,
              });
              throw new Error(extracted.message || "Failed to attach PayMongo payment method.");
            }

            if (!attachError) {
              const status = attachData?.attributes?.status || attachData?.status;
              if (status === "awaiting_next_action") {
                const redirectUrl = attachData.attributes?.next_action?.redirect?.url;
                if (redirectUrl) {
                  try {
                    setCheckoutRedirectRecord(insertedApptId);
                  } catch { }
                  setShowDemoCheckoutModal(false);
                  window.location.href = redirectUrl;
                  return;
                }
              } else if (status === "succeeded") {
                // Auto fulfilled by verify
                await supabase.functions.invoke("paymongo-payment", {
                  body: {
                    action: "verify_payment_intent",
                    paymentIntentId,
                    clientKey,
                  },
                });

                const completedHold = heldSlotTrackerRef.current.get();
                heldSlotTrackerRef.current.clearOnPaymentSuccess(insertedApptId);
                setMyActiveHold(null);
                try {
                  sessionStorage.removeItem("dermai_pending_appointment_id");
                  sessionStorage.removeItem("dermai_pending_payment_intent_client_key");
                } catch { }

                setPaymentConfirmedDetails({
                  reference: paymentIntentId,
                  amount: apptFee,
                  method: chosenMethod,
                  mobileNumber: userPhone,
                  patientName: payer,
                  clinicName: selectedClinic?.name || "Skin Clinic",
                  doctorName: activeDutyDoctor?.name || "Attending Dermatologist",
                  date: formattedPreviewDate,
                  time: formattedPreviewTime,
                });

                broadcastSlotChange(completedHold?.clinicId || selectedClinic?.id, {
                  date: completedHold?.date || effectiveDate,
                  doctorId: completedHold ? completedHold.doctorId : activeDutyDoctor?.id,
                  slotTime: completedHold?.slotTime || effectiveSlotTime,
                  type: "payment_completed",
                });

                setSubmitted(true);
                setShowDemoCheckoutModal(false);
                setDemoSimulating(false);
                return;
              }
            }
          }
        }
      }

      if (!PAYMONGO_PUBLIC_KEY) {
        throw new Error("Online payment gateway is not configured. Please contact the clinic administrator.");
      }

      throw new Error("Unable to initialize PayMongo checkout redirect. Please verify your details and try again.");
    } catch (err: any) {
      console.error("[AppointmentPage] Payment failure:", err);

      const held = heldSlotTrackerRef.current.get();
      const targetClinicId = held?.clinicId || (selectedClinic?.id ? String(selectedClinic.id) : undefined);
      const targetDate = held?.date || selectedDate || undefined;
      const targetDoctorId = held ? held.doctorId : (resolvedDoctorId || activeDutyDoctor?.id || null);
      const targetTime = held?.slotTime || normalizeSlotTime(selectedTime) || undefined;
      const isSlotConflict = classifyHoldFailure(err?.code, err?.message) === "slot_conflict";

      if (!isSlotConflict) {
        // Clean up the temporary hold created for this failed checkout attempt before redirect occurred
        const holdToRelease =
          held?.appointmentId ||
          insertedApptId ||
          (typeof window !== "undefined" ? sessionStorage.getItem("dermai_pending_appointment_id") : null);
        let released = false;
        let releasedSlot: { date?: string; doctorId?: string | null; slotTime?: string } | undefined;
        if (holdToRelease) {
          try {
            clearCheckoutRedirectRecord(holdToRelease, "Checkout initialization failed");
            // releaseAppointmentHoldSafely broadcasts hold_released if and only if the database release succeeds
            const releaseRes = await releaseAppointmentHoldSafely(
              holdToRelease,
              "Hold released after failed payment authorization.",
              {
                clinicId: targetClinicId,
                date: targetDate,
                doctorId: targetDoctorId,
                slotTime: targetTime,
              }
            );
            released = Boolean(releaseRes?.success);
            releasedSlot = releaseRes?.releasedSlot;
            if (releaseRes?.alreadyPaid) {
              heldSlotTrackerRef.current.clearOnPaymentSuccess(holdToRelease);
              setMyActiveHold(null);
              try {
                sessionStorage.removeItem("dermai_pending_appointment_id");
                sessionStorage.removeItem("dermai_pending_payment_intent_client_key");
              } catch { }
            } else if (heldSlotTrackerRef.current.clearOnReleaseResult(releaseRes)) {
              setMyActiveHold(null);
              try {
                sessionStorage.removeItem("dermai_pending_appointment_id");
                sessionStorage.removeItem("dermai_pending_payment_intent_client_key");
              } catch { }
            }
          } catch (cleanupErr: any) {
            console.warn("[AppointmentPage] Non-fatal hold cleanup error:", cleanupErr?.message);
          }
        }

        const finalReleasedDate = releasedSlot?.date || targetDate;
        const finalReleasedTime = releasedSlot?.slotTime || targetTime;
        const finalReleasedDoctorId = releasedSlot?.doctorId !== undefined ? releasedSlot.doctorId : targetDoctorId;
        if (released && finalReleasedDate && finalReleasedTime) {
          availabilityTrackerRef.current.applyEvent({
            date: finalReleasedDate,
            slotTime: finalReleasedTime,
            doctorId: finalReleasedDoctorId,
            changeType: "hold_released",
          });
          setExistingBookings(availabilityTrackerRef.current.visible());
        }
        setRealtimeRefreshTick((t) => t + 1);
      } else {
        // Slot is reserved/booked by another patient!
        // Never release a hold we do not own, never broadcast hold_released or a fake hold_acquired,
        // and immediately refresh authoritative occupancy from the database.
        if (targetDate && targetTime) {
          availabilityTrackerRef.current.applyEvent({
            date: targetDate,
            slotTime: targetTime,
            doctorId: targetDoctorId,
            changeType: "hold_acquired",
          });
          setExistingBookings(availabilityTrackerRef.current.visible());
        }
        setRealtimeRefreshTick((t) => t + 1);
      }

      const isSchedErr = classifyHoldFailure(err?.code, err?.message) === "schedule_config";
      const cleanErrMsg = isSchedErr
        ? "This doctor's consultation schedule has not been configured with appointment intervals by the clinic. Please select another available doctor or contact the clinic."
        : (err?.message || "Payment authorization failed. Please try again or select another payment method.");

      setDemoCheckoutData((prev) => prev ? {
        ...prev,
        outcome: "failed",
        errorMessage: cleanErrMsg
      } : null);
    } finally {
      setDemoSimulating(false);
    }
  };

  const handleDemoCancelPayment = async () => {
    const held = heldSlotTrackerRef.current.get();
    const pendingApptId = held?.appointmentId || sessionStorage.getItem("dermai_pending_appointment_id");
    const targetClinicId = held?.clinicId || (selectedClinic?.id ? String(selectedClinic.id) : undefined);
    const targetDate = held?.date || selectedDate || undefined;
    const targetDoctorId = held ? held.doctorId : (activeDutyDoctor?.id || selectedDoctorId || null);
    const targetTime = held?.slotTime || normalizeSlotTime(selectedTime) || undefined;
    let released = false;
    let releasedSlot: { date?: string; doctorId?: string | null; slotTime?: string } | undefined;

    if (pendingApptId) {
      try {
        // releaseAppointmentHoldSafely broadcasts hold_released only when the DB release succeeds
        const releaseRes = await releaseAppointmentHoldSafely(
          pendingApptId,
          "Reservation hold cancelled by patient.",
          {
            clinicId: targetClinicId,
            date: targetDate,
            doctorId: targetDoctorId,
            slotTime: targetTime,
          }
        );
        released = Boolean(releaseRes?.success);
        releasedSlot = releaseRes?.releasedSlot;
        if (releaseRes?.alreadyPaid) {
          heldSlotTrackerRef.current.clearOnPaymentSuccess(pendingApptId);
          setMyActiveHold(null);
          try {
            sessionStorage.removeItem("dermai_pending_appointment_id");
            sessionStorage.removeItem("dermai_pending_payment_intent_client_key");
          } catch { }
        } else if (heldSlotTrackerRef.current.clearOnReleaseResult(releaseRes)) {
          setMyActiveHold(null);
          try {
            sessionStorage.removeItem("dermai_pending_appointment_id");
            sessionStorage.removeItem("dermai_pending_payment_intent_client_key");
          } catch { }
        }
      } catch (err: any) {
        console.warn("[AppointmentPage] Cancel hold error:", err?.message);
      }
    }

    const finalReleasedDate = releasedSlot?.date || targetDate;
    const finalReleasedTime = releasedSlot?.slotTime || targetTime;
    const finalReleasedDoctorId = releasedSlot?.doctorId !== undefined ? releasedSlot.doctorId : targetDoctorId;
    if (released && finalReleasedDate && finalReleasedTime) {
      availabilityTrackerRef.current.applyEvent({
        date: finalReleasedDate,
        slotTime: finalReleasedTime,
        doctorId: finalReleasedDoctorId,
        changeType: "hold_released",
      });
      setExistingBookings(availabilityTrackerRef.current.visible());
    }
    setRealtimeRefreshTick((t) => t + 1);

    setShowDemoCheckoutModal(false);
    setDemoCheckoutData(null);
  };

  const handleDemoReturnToBooking = async () => {
    const held = heldSlotTrackerRef.current.get();
    const pendingApptId = held?.appointmentId || sessionStorage.getItem("dermai_pending_appointment_id");
    clearCheckoutRedirectRecord(pendingApptId, "Modal closed / cancelled before redirect");
    const targetClinicId = held?.clinicId || (selectedClinic?.id ? String(selectedClinic.id) : undefined);
    const targetDate = held?.date || selectedDate || undefined;
    const targetDoctorId = held ? held.doctorId : (activeDutyDoctor?.id || selectedDoctorId || null);
    const targetTime = held?.slotTime || normalizeSlotTime(selectedTime) || undefined;
    let released = false;
    let releasedSlot: { date?: string; doctorId?: string | null; slotTime?: string } | undefined;

    if (pendingApptId) {
      try {
        // releaseAppointmentHoldSafely broadcasts hold_released only when the DB release succeeds
        const releaseRes = await releaseAppointmentHoldSafely(
          pendingApptId,
          "Reservation hold released on exit.",
          {
            clinicId: targetClinicId,
            date: targetDate,
            doctorId: targetDoctorId,
            slotTime: targetTime,
          }
        );
        released = Boolean(releaseRes?.success);
        releasedSlot = releaseRes?.releasedSlot;
        if (releaseRes?.alreadyPaid) {
          heldSlotTrackerRef.current.clearOnPaymentSuccess(pendingApptId);
          setMyActiveHold(null);
          try {
            sessionStorage.removeItem("dermai_pending_appointment_id");
            sessionStorage.removeItem("dermai_pending_payment_intent_client_key");
          } catch { }
        } else if (heldSlotTrackerRef.current.clearOnReleaseResult(releaseRes)) {
          setMyActiveHold(null);
          try {
            sessionStorage.removeItem("dermai_pending_appointment_id");
            sessionStorage.removeItem("dermai_pending_payment_intent_client_key");
          } catch { }
        }
      } catch (err: any) {
        console.warn("[AppointmentPage] Release hold error:", err?.message);
      }
    }

    const finalReleasedDate = releasedSlot?.date || targetDate;
    const finalReleasedTime = releasedSlot?.slotTime || targetTime;
    const finalReleasedDoctorId = releasedSlot?.doctorId !== undefined ? releasedSlot.doctorId : targetDoctorId;
    if (released && finalReleasedDate && finalReleasedTime) {
      availabilityTrackerRef.current.applyEvent({
        date: finalReleasedDate,
        slotTime: finalReleasedTime,
        doctorId: finalReleasedDoctorId,
        changeType: "hold_released",
      });
      setExistingBookings(availabilityTrackerRef.current.visible());
    }
    setRealtimeRefreshTick((t) => t + 1);

    setShowDemoCheckoutModal(false);
    setDemoCheckoutData(null);
  };

  // ════════════════ SUCCESS SUBMISSION & PAYMENT CONFIRMATION SCREEN ════════════════
  if (submitted) {
    const feeDisplay = paymentConfirmedDetails?.amount !== undefined
      ? `₱${Number(paymentConfirmedDetails.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : selectedClinic?.consultationFee && !isNaN(Number(selectedClinic.consultationFee))
        ? `₱${Number(selectedClinic.consultationFee).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "—";

    return (
      <div className="min-h-screen bg-patient-bg py-12 px-4 sm:px-6 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="max-w-lg w-full bg-white rounded-3xl p-6 sm:p-8 border border-gray-200/90 shadow-xl text-center space-y-5"
        >
          {/* Success Check Icon */}
          <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600 mx-auto flex items-center justify-center shadow-xs">
            <CheckCircle2 className="w-9 h-9" />
          </div>

          <div className="space-y-1.5">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Payment Successful!</h1>
            <p className="text-xs text-gray-500 max-w-md mx-auto">
              Your consultation payment has been received and your appointment request has been confirmed with{" "}
              <strong className="text-gray-900">{paymentConfirmedDetails?.clinicName || selectedClinic?.name || "Skin Clinic"}</strong>.
            </p>
          </div>

          {/* Transaction Reference Badge */}
          {paymentConfirmedDetails?.reference && (
            <div className="inline-block bg-slate-50 border border-slate-200 px-4 py-1.5 rounded-2xl shadow-2xs">
              <span className="text-[10px] text-gray-500 font-bold block uppercase tracking-wider">
                Transaction Reference
              </span>
              <span className="font-mono font-bold text-xs text-gray-900">
                {paymentConfirmedDetails.reference}
              </span>
            </div>
          )}

          {/* Appointment & Payment Schedule Information Card */}
          <div className="bg-slate-50/80 p-5 rounded-2xl border border-gray-100 text-left space-y-2.5 text-xs">
            <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider pb-1.5 border-b border-gray-200/70">
              Appointment &amp; Payment Details
            </div>

            <div className="flex items-center justify-between">
              <span className="text-gray-500">Patient Name</span>
              <span className="font-bold text-gray-900">{paymentConfirmedDetails?.patientName || patientName}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-gray-500">Payment Method</span>
              <div className="flex items-center">
                <img
                  src={paymentConfirmedDetails?.method === "maya" ? mayaLogo : gcashLogo}
                  alt={paymentConfirmedDetails?.method === "maya" ? "Maya" : "GCash"}
                  className="h-5 w-auto object-contain"
                />
              </div>
            </div>

            {paymentConfirmedDetails?.mobileNumber && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Account Mobile Number</span>
                <span className="font-mono font-bold text-gray-900">{paymentConfirmedDetails.mobileNumber}</span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-gray-500">Clinic</span>
              <span className="font-bold text-gray-900">{paymentConfirmedDetails?.clinicName || selectedClinic?.name || "Skin Clinic"}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-gray-500">Attending Dermatologist</span>
              <span className="font-bold text-gray-900">
                {paymentConfirmedDetails?.doctorName || activeDutyDoctor?.name || "Assigned by Clinic upon Review"}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-gray-500">Confirmed Schedule</span>
              <span className="font-bold text-magenta-700">
                {paymentConfirmedDetails?.date || formattedPreviewDate} at {paymentConfirmedDetails?.time || formattedPreviewTime}
              </span>
            </div>

            {(paymentConfirmedDetails?.conditionName || selectedScan?.conditionName) && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Selected Condition</span>
                <span className="font-semibold text-magenta-700">
                  {paymentConfirmedDetails?.conditionName || selectedScan?.conditionName}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-gray-200">
              <span className="font-bold text-gray-700">Amount Paid</span>
              <span className="font-extrabold text-emerald-700 text-sm">
                {feeDisplay}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-gray-500">Payment Status</span>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold border border-emerald-200 text-[10px]">
                Paid &amp; Confirmed
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              type="button"
              onClick={() => navigate("/dashboard/appointment-status")}
              className="flex-1 py-3.5 bg-magenta-600 hover:bg-magenta-700 text-white rounded-full font-bold text-xs uppercase tracking-wider transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
            >
              <Calendar className="w-4 h-4" />
              <span>View Appointment</span>
            </button>
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="px-6 py-3.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-full font-semibold text-xs transition-all text-center cursor-pointer"
            >
              Dashboard
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // ════════════════ PAYMONGO RETURN VERIFICATION LOADING SCREEN ════════════════
  if (isVerifyingReturn) {
    return (
      <div
        id="paymongo-verifying-container"
        className="min-h-screen bg-patient-bg py-12 px-4 sm:px-6 flex items-center justify-center relative"
      >
        <section
          role="status"
          aria-live="polite"
          aria-label="Verifying consultation payment"
          className="w-full max-w-[420px] rounded-3xl border border-pink-100/90 bg-white p-7 sm:p-9 text-center shadow-[0_20px_45px_-20px_rgba(128,19,54,0.22)]"
        >
          {/* Spinner with credit card icon */}
          <div className="relative mx-auto mb-6 h-[76px] w-[76px]" aria-hidden="true">
            <span className="absolute inset-0 rounded-full border-4 border-pink-100" />
            <span className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-[#801336] motion-reduce:animate-none" />
            <span className="absolute inset-[14px] flex items-center justify-center rounded-full bg-pink-50 text-[#801336]">
              <CreditCard className="h-[26px] w-[26px]" strokeWidth={1.9} />
            </span>
          </div>

          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
            Verifying consultation payment
          </h1>
          <p className="mt-2.5 text-sm sm:text-[15px] leading-relaxed text-gray-500 max-w-sm mx-auto">
            Please wait while we confirm your payment with PayMongo and prepare your consultation receipt.
          </p>

          {/* Footer note */}
          <div className="mt-7 pt-4 border-t border-pink-100/60 flex items-center justify-center gap-2 text-xs sm:text-[13px] text-gray-500">
            <Lock className="h-3.5 w-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
            <span>Secure payment · Please don’t close or refresh this page</span>
          </div>
        </section>
      </div>
    );
  }

  // ════════════════ PAYMONGO RETURN VERIFICATION ERROR / CANCELLED SCREEN ════════════════
  if (returnVerificationError) {
    return (
      <div
        id="paymongo-error-container"
        className="min-h-screen bg-patient-bg py-12 px-4 sm:px-6 flex items-center justify-center relative overflow-hidden"
      >
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-gradient-to-tr from-amber-300/15 to-rose-400/15 rounded-full blur-3xl pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="max-w-md w-full bg-white/95 backdrop-blur-md rounded-3xl p-7 sm:p-9 border border-gray-200 shadow-xl text-center space-y-6 relative z-10"
        >
          <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 mx-auto flex items-center justify-center shadow-xs">
            <AlertCircle className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-800">
              Payment Status Notice
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
              Payment Verification Pending
            </h1>
            <p className="text-xs text-gray-500 leading-relaxed max-w-sm mx-auto">
              {returnVerificationError}
            </p>
          </div>

          <div className="bg-slate-50 p-4 rounded-2xl border border-gray-100 text-left text-xs text-gray-600 space-y-1.5">
            <p className="font-semibold text-gray-800">What should I do?</p>
            <p className="text-[11px] text-gray-500">
              • If your payment was deducted in GCash or Maya, your consultation slot will be confirmed automatically via our webhook.
            </p>
            <p className="text-[11px] text-gray-500">
              • If the payment timed out or was cancelled, you may retry verification or select another payment option.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-1">
            <button
              type="button"
              id="btn-retry-payment-verification"
              onClick={() => {
                setReturnVerificationError(null);
                setIsVerifyingReturn(true);
                setVerificationRetryCount((c) => c + 1);
              }}
              className="flex-1 py-3 bg-magenta-600 hover:bg-magenta-700 text-white rounded-full font-bold text-xs uppercase tracking-wider transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Verification</span>
            </button>
            <button
              type="button"
              id="btn-return-to-appointments"
              onClick={() => navigate("/dashboard/appointment-status")}
              className="px-5 py-3 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-full font-semibold text-xs transition-all text-center cursor-pointer"
            >
              View Appointments
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (loadingClinic) {
    return (
      <div className="min-h-screen bg-patient-bg flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-7 h-7 animate-spin text-magenta-500" />
          <p className="text-xs font-semibold text-gray-500">Loading clinic &amp; doctor schedule...</p>
        </div>
      </div>
    );
  }

  if (!selectedClinic) {
    return (
      <div className="min-h-screen bg-patient-bg flex items-center justify-center px-4">
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
    <div className="min-h-screen bg-patient-bg py-8 px-4 sm:px-6 lg:px-8">
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
        {submitError && !submitError.toLowerCase().includes("reserved") && !submitError.toLowerCase().includes("exclusive_doctor_slot") && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-center gap-2.5"
          >
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
            <span className="flex-1">{formatUserFriendlyBookingError(submitError, selectedSlot?.timeRange || (selectedTime ? formatTime12h(selectedTime) : undefined))}</span>
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
                    {availableClinics.length > 1 && (
                      <select
                        value={selectedClinic.id}
                        onChange={(e) => {
                          const newClinicId = e.target.value;
                          setSearchParams((prev) => {
                            const next = new URLSearchParams(prev);
                            next.set("clinic", newClinicId);
                            return next;
                          });
                        }}
                        className="text-[11px] font-semibold bg-slate-50 border border-gray-200 rounded-lg px-2 py-0.5 text-gray-700 ml-1.5 focus:outline-none focus:border-magenta-500"
                      >
                        {availableClinics.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Step 1 of 2: Patient Profile &amp; Skin Concern Photo
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInstructionsModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-white hover:bg-pink-50 text-[#801336] border border-pink-200 transition-colors cursor-pointer shadow-2xs shrink-0"
                  title="View appointment booking instructions & guide"
                >
                  <HelpCircle className="w-3.5 h-3.5 text-[#801336]" />
                  <span>Instructions</span>
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
                              className={`relative rounded-2xl border p-3.5 transition-all cursor-pointer flex items-center justify-between gap-3 ${isSelected
                                ? "border-magenta-500 bg-magenta-50/30 ring-2 ring-magenta-500/20 shadow-xs"
                                : "border-gray-200 bg-white hover:border-gray-300 hover:bg-slate-50/50"
                                }`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div
                                  className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${isSelected
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
                                      {formatConfidencePercent(scan.confidence)} AI confidence
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
                        * The attending doctor will conduct an in-person physical clinical skin examination and provide the official diagnosis.
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
                  onClick={() => setShowInstructionsModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-white hover:bg-pink-50 text-[#801336] border border-pink-200 transition-colors cursor-pointer shadow-2xs shrink-0"
                  title="View appointment booking instructions & guide"
                >
                  <HelpCircle className="w-3.5 h-3.5 text-[#801336]" />
                  <span>Instructions</span>
                </button>
              </div>

              <div className="space-y-4 text-left">


                {/* Modern Landscape Two-Column Layout */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  {/* ════════ LEFT COLUMN: Attending Doctor Selection & Minimal Landscape Calendar (7 cols on lg/xl) ════════ */}
                  <div className="lg:col-span-7 xl:col-span-7 w-full min-w-0 space-y-3.5">
                    {/* 1. Attending Doctor Selection Card */}
                    <div className="bg-white rounded-3xl border border-gray-200/90 p-4 sm:p-5 shadow-xs space-y-3">
                      <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                        <div>
                          <h4 className="text-xs sm:text-sm font-bold text-gray-900 flex items-center gap-1.5">
                            <Stethoscope className="w-3.5 h-3.5 text-magenta-600" />
                            <span>Attending Dermatologist</span>
                          </h4>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {clinicDoctors.length > 1
                              ? `${clinicDoctors.length} Doctors available`
                              : `Scheduled for ${formattedPreviewDate}`}
                          </p>
                        </div>
                        {clinicDoctors.length > 1 && (
                          <span className="text-[10px] font-bold text-magenta-700 bg-magenta-50 px-2 py-0.5 rounded-full border border-magenta-200/60">
                            Select Doctor
                          </span>
                        )}
                      </div>

                      {clinicDoctors.length === 0 ? (
                        <div className="p-3.5 rounded-2xl bg-slate-50 border border-dashed border-gray-200 text-center space-y-1 min-h-[76px] flex flex-col justify-center">
                          <p className="text-xs font-bold text-gray-700">General Clinic Consultation</p>
                          <p className="text-[11px] text-gray-400">
                            No specific doctor is scheduled for this clinic. Your consultation will be attended by an on-duty clinic doctor.
                          </p>
                        </div>
                      ) : (
                        <div ref={doctorDropdownRef} className="relative w-full">
                          {/* Compact Dropdown Trigger Button */}
                          <button
                            type="button"
                            disabled={clinicDoctors.length <= 1}
                            onClick={() => setIsDoctorDropdownOpen((prev) => !prev)}
                            className={`w-full flex items-center justify-between p-3 sm:p-4 rounded-2xl border bg-white transition-all text-left ${isDoctorDropdownOpen
                              ? "border-[#801336] ring-2 ring-[#801336]/10 shadow-xs"
                              : clinicDoctors.length > 1
                                ? "border-pink-200/90 hover:border-pink-300 hover:bg-pink-50/20 cursor-pointer shadow-2xs"
                                : "border-pink-200/80 shadow-2xs cursor-default"
                              }`}
                          >
                            {activeDutyDoctor ? (
                              <div className="flex items-center gap-3 sm:gap-3.5 min-w-0 flex-1">
                                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full border-2 border-pink-300 p-0.5 shrink-0 flex items-center justify-center bg-white shadow-2xs">
                                  <DoctorAvatar
                                    doctorId={activeDutyDoctor.id}
                                    doctor={activeDutyDoctor}
                                    name={activeDutyDoctor.name}
                                    className="w-full h-full rounded-full object-cover"
                                  />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <span className="font-bold text-gray-900 text-sm sm:text-base block truncate">
                                    {activeDutyDoctor.name}
                                  </span>
                                  <p className="text-[11px] sm:text-xs text-magenta-700 font-medium truncate mt-0.5">
                                    {activeDoctorSpecializations.join(", ")}
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-3 sm:gap-3.5 min-w-0 flex-1 py-1">
                                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full border-2 border-dashed border-pink-300 p-0.5 shrink-0 flex items-center justify-center bg-pink-50/50 text-[#801336]">
                                  <Stethoscope className="w-6 h-6" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <span className="font-bold text-gray-800 text-sm sm:text-base block">
                                    Select an attending doctor
                                  </span>
                                  <p className="text-[11px] text-gray-500 mt-0.5">
                                    {clinicDoctors.length > 0
                                      ? `${clinicDoctors.length} doctors available · Click to choose`
                                      : "Click to choose an attending specialist"}
                                  </p>
                                </div>
                              </div>
                            )}

                            {clinicDoctors.length > 1 && (
                              <ChevronDown
                                className={`w-4 h-4 text-gray-400 shrink-0 ml-3 transition-transform duration-200 ${isDoctorDropdownOpen ? "rotate-180 text-[#801336]" : ""
                                  }`}
                              />
                            )}
                          </button>

                          {/* Dropdown Popover */}
                          <AnimatePresence>
                            {isDoctorDropdownOpen && clinicDoctors.length > 0 && (
                              <motion.div
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                transition={{ duration: 0.12 }}
                                className="absolute left-0 right-0 top-full mt-1.5 max-h-64 overflow-y-auto rounded-2xl border border-gray-100 bg-white shadow-2xl z-50 p-1.5 divide-y divide-gray-50"
                              >
                                {clinicDoctors.map((doc) => {
                                  const isSelected = activeDutyDoctor?.id === doc.id;
                                  const docSpecs = getDoctorSpecializations(doc);
                                  const specsText = docSpecs.join(", ");

                                  return (
                                    <button
                                      key={doc.id}
                                      type="button"
                                      onClick={() => handleDoctorSelect(doc)}
                                      className={`w-full flex items-center justify-between p-2.5 rounded-xl transition-all text-left cursor-pointer ${isSelected
                                        ? "bg-magenta-50/80 text-magenta-900 font-semibold"
                                        : "hover:bg-gray-50 text-gray-800"
                                        }`}
                                    >
                                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                        <DoctorAvatar
                                          doctorId={doc.id}
                                          doctor={doc}
                                          name={doc.name}
                                          className="w-9 h-9 rounded-full border border-pink-200 shrink-0"
                                        />
                                        <div className="min-w-0 flex-1">
                                          <p className="text-xs sm:text-sm font-bold text-gray-900 truncate">
                                            {doc.name}
                                          </p>
                                          <p className="text-[11px] text-magenta-700 font-medium truncate mt-0.5">
                                            {specsText}
                                          </p>
                                        </div>
                                      </div>

                                      <div className="w-5 flex items-center justify-end shrink-0 ml-2">
                                        {isSelected && (
                                          <Check className="w-4 h-4 text-magenta-600 stroke-[3]" />
                                        )}
                                      </div>
                                    </button>
                                  );
                                })}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}
                    </div>

                    {/* 2. Minimal Landscape Calendar Card */}
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
                          const isAvailable = !cell.isPast && cell.inCurrentMonth && cell.hasDoctorsOnDuty;
                          const isDisabled = cell.isDisabled || !cell.inCurrentMonth || !isAvailable;

                          return (
                            <button
                              key={idx}
                              type="button"
                              disabled={isDisabled}
                              onClick={() => {
                                if (!isDisabled) {
                                  setSelectedDate(cell.dateStr);
                                }
                              }}
                              className={`min-h-[58px] sm:min-h-[64px] p-2 sm:p-2.5 rounded-2xl border text-left transition-all relative flex flex-col justify-between ${isSelected
                                ? "border-2 border-magenta-600 bg-magenta-50/90 ring-2 ring-magenta-500/20 shadow-xs cursor-pointer"
                                : isDisabled
                                  ? "border-[#f2e5eb] bg-[#faf4f6] text-[#c4b0b8] cursor-not-allowed select-none"
                                  : isToday
                                    ? "border-magenta-300 bg-pink-50/40 hover:border-magenta-400 hover:bg-pink-50/60 hover:shadow-2xs cursor-pointer"
                                    : "border-pink-200/90 bg-white hover:border-magenta-400 hover:bg-pink-50/20 hover:shadow-2xs cursor-pointer"
                                }`}
                            >
                              {/* Top row: Date Number & Today / Selected indicator */}
                              <div className="flex items-center justify-between w-full">
                                <span
                                  className={`text-xs sm:text-sm font-bold leading-none ${isSelected
                                    ? "text-magenta-900"
                                    : isToday && !isDisabled
                                      ? "text-magenta-700"
                                      : isDisabled
                                        ? "text-[#c4b0b8]"
                                        : "text-gray-900"
                                    }`}
                                >
                                  {cell.dayNum}
                                </span>

                                {isToday && (
                                  <span
                                    className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full leading-none ${isDisabled
                                      ? "bg-[#f0e2e8] text-[#aa939d]"
                                      : "bg-magenta-100 text-magenta-700"
                                      }`}
                                  >
                                    Today
                                  </span>
                                )}

                                {isSelected && !isToday && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-magenta-600" />
                                )}
                              </div>

                              {/* Empty alignment spacer to keep date numbers aligned at top */}
                              <div className="min-h-[10px]" aria-hidden="true" />
                            </button>
                          );
                        })}
                      </div>

                      {/* Minimal Calendar Legend */}
                      <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-[10px] text-gray-500">
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-md border border-pink-200/90 bg-white inline-block shadow-2xs" /> Available
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-md border border-[#f2e5eb] bg-[#faf4f6] inline-block" /> Not Available
                          </span>
                        </div>
                        <span className="flex items-center gap-1.5 font-semibold text-magenta-700">
                          <span className="w-2.5 h-2.5 rounded-full bg-magenta-600 inline-block ring-1 ring-magenta-200" /> Selected Date
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* ════════ RIGHT COLUMN: Time Slots & Consultation Summary (5 cols on lg/xl) ════════ */}
                  <div className="lg:col-span-5 xl:col-span-5 w-full min-w-0 space-y-3.5">
                    {/* 1. Dynamic Consultation Time Slots Grouped by Shift */}
                    <div className="bg-white rounded-3xl border border-gray-200/90 p-4 sm:p-5 shadow-xs space-y-3.5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-gray-100 pb-2.5 gap-2">
                        <div>
                          <h4 className="text-xs sm:text-sm font-bold text-gray-900 flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-magenta-600" />
                            <span>Select Consultation Time Slot</span>
                          </h4>
                        </div>

                        {/* Overall Day Status */}
                        {dayShiftGroups.length > 0 && (
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-[10px] font-bold px-2.5 py-1 rounded-full border shadow-2xs ${isDailyCapacityReached
                                ? "bg-rose-50 text-rose-700 border-rose-200"
                                : "bg-emerald-50 text-emerald-700 border-emerald-200"
                                }`}
                            >
                              {isDailyCapacityReached
                                ? "All Shifts at Capacity"
                                : `${dayShiftGroups.length} Active Shift${dayShiftGroups.length > 1 ? "s" : ""}`}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Shift groups rendering */}
                      {dayShiftGroups.length === 0 ? (
                        <div className="p-5 text-center text-xs border border-dashed border-gray-200 rounded-2xl bg-slate-50/50 space-y-2 min-h-[220px] flex flex-col justify-center items-center">
                          {activeDutyDoctor && !isDoctorOnDutyOnDay(activeDutyDoctor, dayOfWeekForSelectedDate, {
                            openTime: selectedClinic?.openTime,
                            closeTime: selectedClinic?.closeTime,
                            operatingDays: selectedClinic?.operatingDays,
                          }) ? (
                            <>
                              <div className="w-10 h-10 rounded-full bg-pink-50 border border-pink-200 flex items-center justify-center text-[#801336]">
                                <Calendar className="w-5 h-5" />
                              </div>
                              <p className="text-xs sm:text-sm font-bold text-gray-800">
                                {activeDutyDoctor.name} is not on duty on {dayOfWeekForSelectedDate}.
                              </p>
                              {onDutyDoctorsForDate.length > 0 ? (
                                <p className="text-[11px] text-magenta-700 font-semibold">
                                  Select an attending doctor from the dropdown above.
                                </p>
                              ) : (
                                <p className="text-[11px] text-gray-500">
                                  No doctors are on duty for this date. Please pick another day on the calendar.
                                </p>
                              )}
                            </>
                          ) : !activeDutyDoctor ? (
                            <>
                              <div className="w-10 h-10 rounded-full bg-pink-50 border border-pink-200 flex items-center justify-center text-[#801336]">
                                <Stethoscope className="w-5 h-5" />
                              </div>
                              <p className="text-xs sm:text-sm font-bold text-gray-800">
                                Select an attending doctor.
                              </p>
                              <p className="text-gray-500 text-[11px] max-w-xs">
                                Choose an attending doctor from the dropdown above to view available consultation slots.
                              </p>
                            </>
                          ) : (
                            <p className="text-gray-400">No consultation shifts or slots available for this duty date.</p>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-4 max-h-[320px] overflow-y-auto pr-1.5">
                          {availabilityError && (
                            <div className="mb-3.5 p-3 sm:p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-950 text-xs sm:text-[13px] flex items-center justify-between gap-3 shadow-xs">
                              <div className="flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                                <span className="font-medium">{availabilityError}</span>
                              </div>
                              <button
                                type="button"
                                onClick={handleRetryAvailability}
                                disabled={loadingBookings}
                                className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs cursor-pointer disabled:opacity-50 shrink-0 flex items-center gap-1.5 transition-colors"
                              >
                                {loadingBookings && <Loader2 className="w-3 h-3 animate-spin" />}
                                Retry
                              </button>
                            </div>
                          )}
                          {dayShiftGroups.map((group) => {
                            return (
                              <div
                                key={group.shift.id}
                                className={`p-3.5 rounded-2xl border transition-all ${group.isCapacityReached
                                  ? "bg-rose-50/30 border-rose-200"
                                  : "bg-slate-50/40 border-gray-200/90"
                                  }`}
                              >
                                {/* Shift Header */}
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 pb-2 border-b border-gray-100">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-bold text-gray-900">
                                      {group.shift.label}
                                    </span>
                                    <span className="text-[11px] font-semibold text-magenta-700 bg-magenta-50 px-2 py-0.5 rounded-full border border-magenta-200/60">
                                      {formatTime12h(group.shift.startTime)} – {formatTime12h(group.shift.endTime)}
                                    </span>
                                    <span className="text-[10px] text-gray-500 font-medium">
                                      {group.effectiveSettings.interval}m interval
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <span
                                      className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${group.isCapacityReached
                                        ? "bg-rose-100 text-rose-700 border-rose-200"
                                        : group.remainingCapacity <= 2
                                          ? "bg-amber-100 text-amber-700 border-amber-200"
                                          : "bg-emerald-100 text-emerald-800 border-emerald-200"
                                        }`}
                                    >
                                      {group.isCapacityReached
                                        ? `Shift Full (${group.effectiveSettings.effectiveCapacity} slots)`
                                        : group.totalReserved > 0 && group.totalConfirmedBooked > 0
                                          ? `${group.totalConfirmedBooked} Booked · ${group.totalReserved} Reserved (${group.remainingCapacity} left)`
                                          : group.totalReserved > 0
                                            ? `${group.totalReserved} Reserved (${group.remainingCapacity} left)`
                                            : `${group.totalBooked} / ${group.effectiveSettings.effectiveCapacity} Booked (${group.remainingCapacity} left)`}
                                    </span>
                                  </div>
                                </div>

                                {/* Notice if shift reached capacity */}
                                {group.isCapacityReached && (
                                  <div className="mt-2 p-2 rounded-xl bg-rose-50 border border-rose-200 text-[11px] text-rose-800 flex items-center gap-1.5 font-medium">
                                    <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                    <span>
                                      All {group.effectiveSettings.effectiveCapacity} consultation slots for this shift are fully booked.
                                    </span>
                                  </div>
                                )}

                                {/* Slot Grid */}
                                {group.slots.length === 0 ? (
                                  <p className="text-[11px] text-gray-400 mt-2 text-center py-2">
                                    No slots fit within this shift duration.
                                  </p>
                                ) : (
                                  <div className="grid grid-cols-3 gap-2.5 sm:gap-3 mt-3">
                                    {group.slots.map((slot) => {
                                      const isOwnHold = Boolean(
                                        myActiveHold &&
                                        myActiveHold.clinicId === String(selectedClinic?.id) &&
                                        myActiveHold.date === selectedDate &&
                                        myActiveHold.slotTime === slot.slotTime &&
                                        doctorScopesOverlap(myActiveHold.doctorId, activeDutyDoctor?.id)
                                      );
                                      const isSlotSelected = selectedTime === slot.slotTime;
                                      const isClickable = ((hasAuthoritativeOccupancy && !availabilityError && slot.isAvailable) || isOwnHold);
                                      const isSlotReserved = Boolean(!isOwnHold && (slot.occupancyType === "reserved" || slot.isReserved));
                                      const isSlotBooked = Boolean(!isOwnHold && (slot.occupancyType === "booked" || (slot.isBooked && !slot.isReserved)));

                                      return (
                                        <button
                                          key={slot.slotTime}
                                          type="button"
                                          disabled={!isClickable}
                                          onClick={() => {
                                            if (isClickable) {
                                              setSelectedTime(slot.slotTime);
                                              setSlotConflictWarning(null);
                                            }
                                          }}
                                          className={`py-2.5 sm:py-3 px-3 rounded-2xl border text-left transition-all relative flex items-center justify-between gap-1.5 ${isOwnHold
                                            ? isSlotSelected
                                              ? "bg-amber-50 border-2 border-amber-500 text-amber-950 ring-2 ring-amber-400/30 shadow-xs cursor-pointer font-bold"
                                              : "bg-amber-50/70 border border-amber-400 text-amber-900 hover:bg-amber-100/60 cursor-pointer shadow-2xs font-semibold"
                                            : isSlotReserved
                                              ? "bg-amber-50/85 border-amber-300 text-amber-900 cursor-not-allowed select-none pointer-events-none opacity-85 shadow-none"
                                              : isSlotBooked
                                                ? "bg-rose-50/60 border-rose-200 text-rose-900 cursor-not-allowed select-none pointer-events-none opacity-75 shadow-none"
                                                : !slot.isAvailable || (!hasAuthoritativeOccupancy || Boolean(availabilityError))
                                                  ? "bg-slate-50/70 border-gray-200 text-gray-400 cursor-not-allowed select-none pointer-events-none opacity-60 shadow-none"
                                                  : isSlotSelected
                                                    ? "bg-magenta-50/90 border-2 border-magenta-600 text-magenta-950 ring-2 ring-magenta-500/20 shadow-xs cursor-pointer font-bold"
                                                    : "bg-white border-gray-200 text-gray-800 hover:border-magenta-300 hover:bg-magenta-50/30 cursor-pointer shadow-2xs"
                                            }`}
                                          title={
                                            isOwnHold
                                              ? "Your reserved slot — pending payment. Click to proceed with booking."
                                              : isSlotReserved
                                                ? "Temporarily reserved by another patient for checkout"
                                                : isSlotBooked
                                                  ? "Already booked by another patient"
                                                  : slot.isPast
                                                    ? "Time slot has passed"
                                                    : slot.isCapacityFull
                                                      ? "Shift capacity full"
                                                      : !hasAuthoritativeOccupancy || Boolean(availabilityError)
                                                        ? "Slot availability could not be verified"
                                                        : `${slot.timeRange} (Available)`
                                          }
                                        >
                                          <span className={`text-xs sm:text-[13px] font-bold leading-tight ${isOwnHold
                                            ? isSlotSelected
                                              ? "text-amber-950 font-extrabold"
                                              : "text-amber-900 font-bold"
                                            : isSlotReserved
                                              ? "text-amber-950/70"
                                              : isSlotSelected
                                                ? "text-magenta-950 font-extrabold"
                                                : !slot.isAvailable || (!hasAuthoritativeOccupancy || Boolean(availabilityError))
                                                  ? "text-gray-400"
                                                  : "text-gray-900"
                                            }`}>
                                            {slot.label}
                                          </span>

                                          {isOwnHold ? (
                                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-500 text-white uppercase tracking-wide shrink-0 shadow-2xs">
                                              Your Hold
                                            </span>
                                          ) : isSlotReserved ? (
                                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 uppercase tracking-wide shrink-0">
                                              Reserved
                                            </span>
                                          ) : isSlotBooked ? (
                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 uppercase tracking-wide shrink-0">
                                              Booked
                                            </span>
                                          ) : slot.isPast ? (
                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200 uppercase tracking-wide shrink-0">
                                              Passed
                                            </span>
                                          ) : slot.isCapacityFull ? (
                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 uppercase tracking-wide shrink-0">
                                              Full
                                            </span>
                                          ) : !hasAuthoritativeOccupancy || Boolean(availabilityError) ? (
                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 uppercase tracking-wide shrink-0">
                                              {loadingBookings ? "Checking..." : "Unavailable"}
                                            </span>
                                          ) : isSlotSelected ? (
                                            <span className="w-4 h-4 rounded-full bg-magenta-600 text-white flex items-center justify-center text-[10px] shrink-0 font-bold shadow-2xs">
                                              ✓
                                            </span>
                                          ) : (
                                            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" title="Available" />
                                          )}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* 3. Consultation Summary Card */}
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

                      {/* Clean Minimal Schedule Details */}
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

                        {/* Prominent Slot Consultation Details */}
                        {selectedSlot ? (
                          <div className="p-3.5 rounded-2xl bg-magenta-50/80 border border-magenta-200/80 space-y-1.5 min-h-[96px] flex flex-col justify-center">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-magenta-800">
                                Selected Consultation Slot
                              </span>
                              <span className="px-2.5 py-0.5 rounded-full bg-magenta-600 text-white font-bold text-xs shadow-2xs">
                                {selectedSlot.durationMinutes} mins
                              </span>
                            </div>
                            <p className="text-xs font-bold text-gray-900 truncate">
                              {activeDutyDoctor?.name ? (activeDutyDoctor.name.startsWith("Dr") ? activeDutyDoctor.name : `Dr. ${activeDutyDoctor.name}`) : "Attending Dermatologist"}
                            </p>
                            <p className="text-[11px] text-gray-700">
                              Time Slot: <strong className="text-magenta-900 font-semibold">{selectedSlot.timeRange}</strong>
                            </p>
                            <p className="text-[10px] text-gray-500 italic">
                              Slot #{selectedSlot.slotIndex} of shift • Individual patient consultation
                            </p>
                          </div>
                        ) : (
                          <div className="p-3.5 rounded-2xl bg-slate-50/80 border border-dashed border-gray-200/90 space-y-1 text-center min-h-[96px] flex flex-col justify-center">
                            <p className="text-xs font-semibold text-gray-700">No Time Slot Selected</p>
                            <p className="text-[11px] text-gray-400">Please choose an available consultation slot.</p>
                          </div>
                        )}

                        <div className="pt-2 border-t border-gray-200/70 flex items-center justify-between">
                          <div>
                            <span className="text-[10px] font-bold text-gray-400 block uppercase tracking-wider">Fee</span>
                            <span className="font-bold text-gray-900 text-sm">
                              {selectedClinic.consultationFee && !isNaN(Number(selectedClinic.consultationFee)) && Number(selectedClinic.consultationFee) > 0
                                ? `₱${Number(selectedClinic.consultationFee).toLocaleString()}`
                                : "Not configured"}
                            </span>
                          </div>
                          <span className="text-[10px] text-gray-500 font-medium">
                            Payable Online
                          </span>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="space-y-2 pt-2 border-t border-gray-100">
                        <button
                          type="button"
                          onClick={() => handleSubmitAppointment()}
                          disabled={
                            submitting ||
                            !hasAuthoritativeOccupancy ||
                            Boolean(availabilityError) ||
                            (selectedSlot ? !selectedSlot.isAvailable && !isSelectedSlotOwnHold : true) ||
                            isDailyCapacityReached
                          }
                          className="w-full py-3 rounded-full font-bold text-xs uppercase tracking-wider shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] bg-magenta-600 hover:bg-magenta-700 text-white"
                        >
                          {submitting ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Submitting Appointment...</span>
                            </>
                          ) : availabilityError ? (
                            <>
                              <AlertCircle className="w-3.5 h-3.5" />
                              <span>Availability Unavailable</span>
                            </>
                          ) : !hasAuthoritativeOccupancy && loadingBookings ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Verifying Availability...</span>
                            </>
                          ) : (
                            <>
                              <span>Proceed to Payment</span>
                              <CreditCard className="w-3.5 h-3.5" />
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

      {/* ── Booking Instructions Modal ────────────────────────────── */}
      <ModalPortal isOpen={Boolean(showInstructionsModal)}>
        <AnimatePresence>
          {showInstructionsModal && (
            <div className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 8 }}
                className="relative z-[9999] w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-100 max-h-[90vh] flex flex-col text-left"
              >
                {/* Header */}
                <div className="px-6 pt-5 pb-4 flex items-start justify-between border-b border-gray-100 bg-pink-50/50 shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-2xl bg-magenta-100 text-[#801336] flex items-center justify-center shrink-0 shadow-2xs">
                      <HelpCircle className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm sm:text-base font-bold text-gray-900">How to Book an Appointment</h3>
                      <p className="text-[11px] text-gray-500 mt-0.5">Step-by-step patient guide for scheduling consultations</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowInstructionsModal(false)}
                    className="p-1.5 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto space-y-3.5 text-xs">
                  {/* Step 1 */}
                  <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-gray-50/80 border border-gray-100">
                    <div className="w-6 h-6 rounded-lg bg-[#801336] text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 shadow-2xs">
                      1
                    </div>
                    <div className="space-y-1">
                      <h4 className="font-bold text-gray-900 text-xs sm:text-[13px]">Patient &amp; Clinical Details</h4>
                      <p className="text-gray-600 leading-relaxed text-[11px]">
                        Fill in your patient profile and select your primary skin concern. You can attach a past AI skin scan report or take a new scan for your doctor to review beforehand.
                      </p>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-gray-50/80 border border-gray-100">
                    <div className="w-6 h-6 rounded-lg bg-gray-200 text-gray-800 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                      2
                    </div>
                    <div className="space-y-1">
                      <h4 className="font-bold text-gray-900 text-xs sm:text-[13px]">Choose Your Attending Dermatologist</h4>
                      <p className="text-gray-600 leading-relaxed text-[11px]">
                        Click on the <strong>Attending Dermatologist</strong> dropdown to select which specialist you prefer. You can see their photo, full name, and registered clinical specializations.
                      </p>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-gray-50/80 border border-gray-100">
                    <div className="w-6 h-6 rounded-lg bg-gray-200 text-gray-800 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                      3
                    </div>
                    <div className="space-y-1">
                      <h4 className="font-bold text-gray-900 text-xs sm:text-[13px]">Select an Available Date on the Calendar</h4>
                      <p className="text-gray-600 leading-relaxed text-[11px]">
                        The calendar updates to show your chosen doctor's schedule:
                      </p>
                      <ul className="list-disc pl-4 space-y-1 text-gray-600 text-[11px] mt-1">
                        <li>
                          <strong>White boxes with pink borders</strong> indicate available duty days.
                        </li>
                        <li>
                          <strong>Light pink-gray boxes</strong> indicate days when the doctor is not on duty or off-schedule.
                        </li>
                      </ul>
                    </div>
                  </div>

                  {/* Step 4 */}
                  <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-gray-50/80 border border-gray-100">
                    <div className="w-6 h-6 rounded-lg bg-gray-200 text-gray-800 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                      4
                    </div>
                    <div className="space-y-1">
                      <h4 className="font-bold text-gray-900 text-xs sm:text-[13px]">Pick a Consultation Time Slot</h4>
                      <p className="text-gray-600 leading-relaxed text-[11px]">
                        Browse morning or afternoon shifts and click on an available time slot (indicated by a green dot). Slots temporarily held by other patients or already booked will be marked accordingly.
                      </p>
                    </div>
                  </div>

                  {/* Step 5 */}
                  <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-gray-50/80 border border-gray-100">
                    <div className="w-6 h-6 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 shadow-2xs">
                      5
                    </div>
                    <div className="space-y-1">
                      <h4 className="font-bold text-gray-900 text-xs sm:text-[13px]">Review Summary &amp; Confirm</h4>
                      <p className="text-gray-600 leading-relaxed text-[11px]">
                        Review your clinic details, selected doctor, consultation fee, and schedule in the <strong>Consultation Summary</strong> card. Click <strong>Proceed to Payment</strong> to finalize your appointment securely.
                      </p>
                    </div>
                  </div>

                  {/* Clinic details prompt */}
                  <div className="p-3.5 rounded-2xl bg-pink-50/50 border border-pink-200/80 flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <p className="text-[11px] font-bold text-gray-900">Looking for clinic information?</p>
                      <p className="text-[10px] text-gray-500">View clinic operating hours, services offered, and contact info.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowInstructionsModal(false);
                        setShowClinicDetailsModal(true);
                      }}
                      className="px-3 py-1 rounded-xl bg-white hover:bg-pink-100 text-[#801336] border border-pink-300 text-[11px] font-semibold transition-colors cursor-pointer shrink-0"
                    >
                      Clinic Details
                    </button>
                  </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-3.5 bg-gray-50/80 border-t border-gray-100 flex items-center justify-end shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowInstructionsModal(false)}
                    className="px-5 py-2 rounded-xl bg-magenta-600 hover:bg-magenta-700 text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
                  >
                    Got It
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </ModalPortal>

      {/* Clinic Details Modal */}
      <ModalPortal isOpen={Boolean(showClinicDetailsModal)}>
        <AnimatePresence>
          {showClinicDetailsModal && (
            <div className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative z-[9999] w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-100 max-h-[90vh] flex flex-col text-left"
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
                          <DoctorAvatar
                            doctorId={d.id}
                            doctor={d}
                            name={d.name}
                            className="w-8 h-8 rounded-full border border-magenta-200/60 shrink-0 text-xs font-bold"
                          />
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
      </ModalPortal>

      {/* Online Consultation Payment Modal (PayMongo) */}
      <ModalPortal isOpen={Boolean(showDemoCheckoutModal && demoCheckoutData)}>
        <AnimatePresence>
          {showDemoCheckoutModal && demoCheckoutData && (
            <div
              onClick={!demoSimulating ? handleDemoReturnToBooking : undefined}
              className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 cursor-pointer"
            >
              <motion.div
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, scale: 0.95, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 12 }}
                className="relative z-[9999] w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-100 flex flex-col text-left cursor-default"
              >
                {/* Header */}
                <div className="px-6 pt-5 pb-4 bg-gradient-to-r from-magenta-50/80 via-pink-50/50 to-white border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-magenta-600 text-white flex items-center justify-center shadow-sm">
                      <CreditCard className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-gray-900 text-sm">
                          Consultation Payment
                        </h3>
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-200">
                          <ShieldCheck className="w-3 h-3" />
                          Secure Checkout
                        </span>
                      </div>
                    </div>
                  </div>
                  {!demoSimulating && (
                    <button
                      type="button"
                      onClick={handleDemoReturnToBooking}
                      className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
                      title="Close"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Body */}
                <div className="p-6 space-y-4 text-xs overflow-y-auto max-h-[80vh]">
                  <div className="space-y-4">
                    {/* Inline Error Message if previous payment attempt failed */}
                    {demoCheckoutData.errorMessage && (
                      <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 flex items-start gap-3 shadow-2xs">
                        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                        <div className="text-xs space-y-0.5 flex-1">
                          <p className="font-bold text-rose-800">Payment Authorization Failed</p>
                          <p className="text-rose-700 text-[11px] leading-relaxed">{demoCheckoutData.errorMessage}</p>
                        </div>
                      </div>
                    )}

                    {/* Payment Information Form Card */}
                    <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-5 space-y-3.5 shadow-xs">
                      <div>
                        <h4 className="text-base font-bold text-gray-900 tracking-tight">Payment Information</h4>
                        <p className="text-[11px] text-gray-500 mt-0.5">Secure payment processing via PayMongo</p>
                      </div>

                      {/* Full Name */}
                      <div>
                        <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                          Full Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Maria Santos"
                          value={demoCheckoutData.payerName ?? patientName}
                          onChange={(e) =>
                            setDemoCheckoutData((prev) => (prev ? { ...prev, payerName: e.target.value } : null))
                          }
                          className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all"
                        />
                      </div>

                      {/* Email & Billing Address */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                            Email Address <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="email"
                            placeholder="patient@example.com"
                            value={demoCheckoutData.payerEmail ?? patientEmail}
                            onChange={(e) =>
                              setDemoCheckoutData((prev) => (prev ? { ...prev, payerEmail: e.target.value } : null))
                            }
                            className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                            Billing Address <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            placeholder="Barangay, City, Province"
                            value={demoCheckoutData.payerAddress ?? patientAddress}
                            onChange={(e) =>
                              setDemoCheckoutData((prev) => (prev ? { ...prev, payerAddress: e.target.value } : null))
                            }
                            className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all"
                          />
                        </div>
                      </div>

                      {/* Select E-Wallet with GCash & Maya Logos */}
                      <div className="pt-1">
                        <label className="block text-[11px] font-semibold text-gray-700 mb-2">
                          Select E-Wallet <span className="text-red-500">*</span>
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              setDemoCheckoutData((prev) => (prev ? { ...prev, paymentMethod: "gcash" } : null))
                            }
                            className={cn(
                              "flex items-center justify-center h-14 px-4 rounded-2xl border transition-all cursor-pointer",
                              demoCheckoutData.paymentMethod === "gcash"
                                ? "border-blue-500 bg-blue-50/50 ring-2 ring-blue-500/20 shadow-xs"
                                : "border-gray-200 bg-white hover:bg-gray-50/60"
                            )}
                            aria-label="Pay with GCash"
                          >
                            <img
                              src={gcashLogo}
                              alt="GCash"
                              className="h-6 w-auto object-contain"
                            />
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              setDemoCheckoutData((prev) => (prev ? { ...prev, paymentMethod: "maya" } : null))
                            }
                            className={cn(
                              "flex items-center justify-center h-14 px-4 rounded-2xl border transition-all cursor-pointer",
                              demoCheckoutData.paymentMethod === "maya"
                                ? "border-emerald-500 bg-emerald-50/50 ring-2 ring-emerald-500/20 shadow-xs"
                                : "border-gray-200 bg-white hover:bg-gray-50/60"
                            )}
                            aria-label="Pay with Maya"
                          >
                            <img
                              src={mayaLogo}
                              alt="Maya"
                              className="h-6 w-auto object-contain"
                            />
                          </button>
                        </div>
                      </div>

                      {/* Dynamic Mobile Number Field */}
                      <div>
                        <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                          {demoCheckoutData.paymentMethod === "gcash" ? "GCash" : "Maya"} Mobile Number <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="tel"
                          inputMode="numeric"
                          placeholder="09999999999"
                          maxLength={11}
                          value={demoCheckoutData.mobileNumber || ""}
                          onChange={(e) => {
                            const cleaned = e.target.value.replace(/\D/g, "").slice(0, 11);
                            setDemoCheckoutData((prev) => (prev ? { ...prev, mobileNumber: cleaned } : null));
                          }}
                          className="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all font-mono tracking-wide"
                        />
                        <p className="text-[10px] text-gray-400 mt-1">
                          Enter the 11-digit number linked to your {demoCheckoutData.paymentMethod === "gcash" ? "GCash" : "Maya"} account.
                        </p>
                      </div>
                    </div>

                    {/* Summary of Consultation Selection */}
                    <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-gray-100 space-y-2 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">Clinic:</span>
                        <span className="font-bold text-gray-900">{demoCheckoutData.clinicName}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">Attending Doctor:</span>
                        <span className="font-bold text-gray-900">{demoCheckoutData.doctorName}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">Appointment Date &amp; Time:</span>
                        <span className="font-semibold text-gray-800">
                          {demoCheckoutData.date} at {demoCheckoutData.time}
                        </span>
                      </div>
                      {demoCheckoutData.conditionName && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500">Selected Condition:</span>
                          <span className="font-semibold text-magenta-700">
                            {demoCheckoutData.conditionName}
                            {demoCheckoutData.confidenceScore !== null && demoCheckoutData.confidenceScore !== undefined && (
                              <span className="text-gray-400 font-normal ml-1">
                                ({formatConfidencePercent(demoCheckoutData.confidenceScore)} match)
                              </span>
                            )}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between pt-1.5 border-t border-gray-200">
                        <span className="font-bold text-gray-700">Consultation Fee:</span>
                        <span className="font-extrabold text-magenta-700 text-sm">
                          ₱{demoCheckoutData.consultationFee.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    {/* Submit Button */}
                    <div className="space-y-2.5 pt-1">
                      <button
                        type="button"
                        disabled={demoSimulating}
                        onClick={handleDemoSimulateSuccess}
                        className="w-full py-3.5 bg-magenta-600 hover:bg-magenta-700 text-white rounded-full font-bold text-xs uppercase tracking-wider shadow-sm transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-wait flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {demoSimulating ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Processing Payment...</span>
                          </>
                        ) : (
                          <>
                            <Lock className="w-3.5 h-3.5" />
                            <span>Pay &amp; Confirm (₱{demoCheckoutData.consultationFee.toFixed(2)})</span>
                          </>
                        )}
                      </button>

                      <div className="text-center pt-1">
                        <button
                          type="button"
                          disabled={demoSimulating}
                          onClick={handleDemoCancelPayment}
                          className="text-xs text-gray-500 hover:text-gray-700 font-medium hover:underline cursor-pointer disabled:opacity-50"
                        >
                          Cancel and return to booking
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-center gap-1.5 text-[11px] text-gray-400 pt-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                      <span>256-bit SSL encrypted • Instant clinic appointment confirmation</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </ModalPortal>

      {/* Lightbox for Photos */}
      <ModalPortal isOpen={Boolean(lightboxPhoto)}>
        <AnimatePresence>
          {lightboxPhoto && (
            <div
              onClick={() => setLightboxPhoto(null)}
              className="fixed inset-0 z-[9998] bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 cursor-pointer"
            >
              <div className="relative z-[9999] max-w-3xl max-h-[85vh]">
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
      </ModalPortal>
    </div>
  );
}
