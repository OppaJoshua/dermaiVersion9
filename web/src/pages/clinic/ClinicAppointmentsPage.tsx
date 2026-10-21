import { useMemo, useState, useEffect, useCallback } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Info,
  Lock,
  MapPin,
  Stethoscope,
  User,
  XCircle,
  X,
  RefreshCw,
  Send,
  History,
} from "lucide-react";
import { cn, formatConfidencePercent } from "@/lib/utils";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useClinicVerification } from "@/hooks/useClinicVerification";
import { supabase } from "@/lib/supabaseClient";
import { logAuditEvent } from "@/utils/auditLogger";
import { LazySkinPhoto } from "@/components/common/LazySkinPhoto";
import { DoctorAvatar } from "@/components/common/DoctorAvatar";
import { PatientAvatar } from "@/components/common/PatientAvatar";
import { resolveAvatarUrl } from "@/lib/avatarUrlResolver";
import { ModalPortal } from "@/components/common/ModalPortal";
import { createPatientNotification } from "@/lib/notificationService";
import {
  findAvailableDoctorsForSlot,
  validateDoctorReassignment,
  computeNextQueueNumber,
  sortAppointmentsByDailyQueue,
  isAppointmentExcludedFromIncomingQueue,
  type AppointmentHistoryEntry,
} from "@/lib/schedulingService";

function isMorningTime(timeStr?: string): boolean {
  if (!timeStr) return true;
  if (/am/i.test(timeStr)) {
    const hour = parseInt(timeStr, 10);
    return hour < 10 || hour === 12;
  }
  const hour = parseInt(timeStr, 10);
  return !isNaN(hour) && hour < 10;
}

type AppointmentRecord = {
  id: string;
  clinicId: number;
  clinicName: string;
  patientName?: string;
  patientAge?: number;
  patientGender?: string;
  patientBirthdate?: string;
  patientAvatar?: string;
  patientEmail?: string;
  patientAddress?: string;
  patientContact?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyRelationship?: string;
  consultationType: "face-to-face";
  conditionId?: string;
  conditionName?: string;
  conditionImage?: string;
  date: string;
  time: string;
  notes: string;
  status: "pending" | "accepted" | "scheduled" | "confirmed" | "rejected" | "completed" | "cancelled";
  meetingLink?: string;
  clinicNote?: string;
  assignedDoctorId?: string;
  assignedDoctorName?: string;
  doctorStatus?: "pending-review" | "approved" | "rejected";
  doctorNote?: string;
  doctorReviewedAt?: string;
  scheduleSentToDoctor?: boolean;
  createdAt: string;
  skinPhotoUrl?: string;
  aiConditionName?: string;
  aiConfidence?: number;
  queueNumber?: number;
  batchTime?: string;
  checkInStatus?: "scheduled" | "arrived" | "in-consultation" | "completed" | "no-show";
  isWalkIn?: boolean;
  userId?: string;
  rescheduleRequested?: boolean;
  rescheduleDate?: string;
  rescheduleTime?: string;
  rescheduleReason?: string;
  needsPatientReschedule?: boolean;
  appointmentHistory?: AppointmentHistoryEntry[];
  primaryScanId?: string;
  paymentStatus?: string;
  isPaid?: boolean;
  paymentAmount?: number;
  paymentMethod?: string;
  paymentReference?: string;
  questionnaireAnswers?: any;
};

type DoctorAccount = {
  id: string;
  name: string;
  email: string;
  specialization: string;
  clinicName: string;
  photo?: string;
  clinicId?: string;
  dutySchedule?: any;
  status?: string;
};

type ClinicSettings = {
  openTime: string;
  closeTime: string;
};

const DEFAULT_SETTINGS: ClinicSettings = {
  openTime: "09:00",
  closeTime: "18:00",
};

function formatDoctorDisplay(name?: string): string {
  if (!name) return "";
  const cleaned = name.replace(/^(?:dr\.?|doctor)\s*/i, "").trim();
  if (!cleaned || cleaned.toLowerCase() === "dr") return "";
  return `Dr. ${cleaned}`;
}


function formatAppointmentTime(timeStr?: string): string {
  if (!timeStr) return "TBD";
  const trimmed = timeStr.trim();
  if (/am|pm/i.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (match) {
    let hour = parseInt(match[1], 10);
    const minute = match[2];
    const ampm = hour >= 12 ? "PM" : "AM";
    hour = hour % 12 || 12;
    return `${hour}:${minute} ${ampm}`;
  }
  return trimmed;
}

function getManilaCurrentTime(): { year: number; month: number; day: number; hour: number; minute: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);

  const lookup: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") {
      lookup[p.type] = parseInt(p.value, 10);
    }
  }
  return {
    year: lookup.year || now.getFullYear(),
    month: lookup.month || now.getMonth() + 1,
    day: lookup.day || now.getDate(),
    hour: lookup.hour ?? now.getHours(),
    minute: lookup.minute ?? now.getMinutes(),
  };
}

function isAppointmentPastDue(appt: {
  date?: string;
  time?: string;
  status?: string;
  checkInStatus?: string;
}): boolean {
  if (!appt.date) return false;
  if (appt.status === "completed" || appt.checkInStatus === "completed") return false;
  if (appt.status === "cancelled" || appt.status === "rejected") return false;
  if (appt.checkInStatus === "no-show") return false;

  const manilaNow = getManilaCurrentTime();

  // Parse appt.date (expected YYYY-MM-DD)
  const dateMatch = appt.date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!dateMatch) return false;

  const apptYear = parseInt(dateMatch[1], 10);
  const apptMonth = parseInt(dateMatch[2], 10);
  const apptDay = parseInt(dateMatch[3], 10);

  // Compare calendar date first in clinic's timezone
  if (apptYear < manilaNow.year) return true;
  if (apptYear > manilaNow.year) return false;

  if (apptMonth < manilaNow.month) return true;
  if (apptMonth > manilaNow.month) return false;

  if (apptDay < manilaNow.day) return true;
  if (apptDay > manilaNow.day) return false;

  // Same date in Manila! Compare scheduled time.
  // Standard consultation window is 30 minutes; appointment is past-due once scheduled window ends.
  let apptHour = 23;
  let apptMinute = 59;

  if (appt.time) {
    const trimmedTime = appt.time.trim();
    const ampmMatch = trimmedTime.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
    if (ampmMatch) {
      let h = parseInt(ampmMatch[1], 10);
      const m = parseInt(ampmMatch[2], 10);
      const isPm = ampmMatch[3].toLowerCase() === "pm";
      if (isPm && h < 12) h += 12;
      if (!isPm && h === 12) h = 0;
      apptHour = h;
      apptMinute = m;
    } else {
      const match24 = trimmedTime.match(/^(\d{1,2}):(\d{2})/);
      if (match24) {
        apptHour = parseInt(match24[1], 10);
        apptMinute = parseInt(match24[2], 10);
      }
    }
  }

  const apptEndTotalMinutes = apptHour * 60 + apptMinute + 30;
  const currentTotalMinutes = manilaNow.hour * 60 + manilaNow.minute;

  return currentTotalMinutes >= apptEndTotalMinutes;
}

export default function ClinicAppointmentsPage() {
  const { status: verificationStatus, clinicName: verifiedClinicName, clinicId, loading } = useClinicVerification();
  let clinicName = verifiedClinicName || "";
  if (!clinicName) {
    try {
      const raw = localStorage.getItem("dermai_clinic_settings");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.name) clinicName = parsed.name;
      }
    } catch {
      /* ignore */
    }
  }

  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [clinicDoctors, setClinicDoctors] = useState<DoctorAccount[]>([]);
  const [clinicFee, setClinicFee] = useState<number>(500);
  const [loadingData, setLoadingData] = useState(true);

  const loadData = async () => {
    setLoadingData(true);
    let resolvedClinicId: string | null = clinicId ? String(clinicId) : null;

    // Step 1: Try localStorage profile cache
    if (!resolvedClinicId) {
      try {
        const cache = localStorage.getItem("dermai_clinic_profile_cache");
        if (cache) {
          const parsed = JSON.parse(cache);
          if (parsed.clinicId) resolvedClinicId = String(parsed.clinicId);
        }
      } catch { }
    }

    // Step 2: Try direct Supabase session query (same as Dashboard)
    if (!resolvedClinicId) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const userEmail = session.user.email?.toLowerCase().trim();
          const { data: clinicRow } = await supabase
            .from("clinic")
            .select("clinic_id, name")
            .or(`owner_user_id.eq.${session.user.id}${userEmail ? `,email.ilike.${userEmail}` : ""}`)
            .maybeSingle();
          if (clinicRow?.clinic_id) {
            resolvedClinicId = String(clinicRow.clinic_id);
          }
        }
      } catch { }
    }

    // Step 2b: Fetch clinic consultation fee
    let resolvedFee = 500;
    if (resolvedClinicId) {
      try {
        const { data: cRow } = await supabase
          .from("clinic")
          .select("consultation_fee")
          .eq("clinic_id", resolvedClinicId)
          .maybeSingle();
        if (cRow?.consultation_fee) {
          resolvedFee = Number(cRow.consultation_fee);
          setClinicFee(resolvedFee);
        }
      } catch (fErr) {
        console.warn("[ClinicAppointments] Failed to fetch clinic consultation fee:", fErr);
      }
    }

    // 1. Fetch clinic doctors from clinic_doctor table (joining user profile avatar)
    let docRows: any[] = [];
    if (resolvedClinicId) {
      const { data, error: docErr } = await supabase
        .from("clinic_doctor")
        .select(`
          doctor_id,
          doctor_name,
          email,
          photo_url,
          user_id,
          status,
          duty_schedule,
          clinic_id,
          user:user_id ( avatar_url )
        `)
        .eq("clinic_id", resolvedClinicId);
      if (docErr) {
        console.warn("[ClinicAppointmentsPage] Failed to fetch clinic_doctor:", docErr.message);
      }
      if (data && data.length > 0) {
        docRows = data.filter((d: any) => (d.status || "").toLowerCase() !== "inactive");
        setClinicDoctors(docRows.map((d: any) => {
          const userObj = Array.isArray(d.user) ? d.user[0] : d.user;
          const rawPhoto = d.photo_url || userObj?.avatar_url;
          return {
            id: d.doctor_id,
            name: d.doctor_name,
            email: d.email || "",
            photo: resolveAvatarUrl(rawPhoto),
            specialization: "Dermatology",
            clinicName: clinicName || "Clinic",
            clinicId: resolvedClinicId || undefined,
            dutySchedule: d.duty_schedule || undefined,
            status: d.status || "Active",
          };
        }));
      }
    }

    if (docRows.length === 0) {
      try {
        const raw = localStorage.getItem("dermai_clinic_doctors");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setClinicDoctors(parsed.map((d: any) => ({
              id: d.id,
              name: d.name,
              email: d.email || "",
              photo: resolveAvatarUrl(d.photo || d.photo_url),
              specialization: d.specialization || "Dermatology",
              clinicName: clinicName || d.clinicName || "Clinic",
              clinicId: resolvedClinicId || d.clinicId || undefined,
              dutySchedule: d.duty_schedule || d.dutySchedule || d.schedule || undefined,
              status: d.status || "Active",
            })));
          }
        }
      } catch { }
    }

    // 2. Fetch appointments from patient_appointment table (joining user profile for real avatar)
    let dbAppts: any[] = [];
    if (resolvedClinicId) {
      // Try exact match first
      const { data: apptRows, error: apptErr } = await supabase
        .from("patient_appointment")
        .select(`
          *,
          user:user_id ( full_name, email, avatar_url )
        `)
        .eq("clinic_id", resolvedClinicId)
        .order("created_at", { ascending: false });

      if (apptErr) {
        console.warn("[ClinicAppointmentsPage] Failed to fetch patient_appointment from Supabase:", apptErr.message);
      } else if (apptRows && apptRows.length > 0) {
        dbAppts = apptRows;
      } else {
        // Fallback: fetch all and filter client-side (handles type mismatch e.g. int vs string)
        const { data: allAppts } = await supabase
          .from("patient_appointment")
          .select(`
            *,
            user:user_id ( full_name, email, avatar_url )
          `)
          .order("created_at", { ascending: false })
          .limit(200);

        if (allAppts && allAppts.length > 0) {
          dbAppts = allAppts.filter((r: any) =>
            r.clinic_id !== null &&
            r.clinic_id !== undefined &&
            String(r.clinic_id) === String(resolvedClinicId)
          );
        }
      }
    }

    // 3. Batch resolve patient profile pictures from user table to ensure 100% real avatar coverage
    const userProfileMap = new Map<string, string>();
    const userIds = Array.from(new Set(dbAppts.map((a: any) => a.user_id).filter(Boolean)));
    const patientEmails = Array.from(new Set(dbAppts.map((a: any) => a.patient_email?.toLowerCase().trim()).filter(Boolean)));

    if (userIds.length > 0 || patientEmails.length > 0) {
      try {
        let orFilters: string[] = [];
        if (userIds.length > 0) orFilters.push(`user_id.in.(${userIds.join(",")})`);
        if (patientEmails.length > 0) orFilters.push(`email.in.(${patientEmails.map((e) => `"${e}"`).join(",")})`);

        const { data: userProfiles } = await supabase
          .from("user")
          .select("user_id, email, avatar_url")
          .or(orFilters.join(","));

        if (userProfiles) {
          userProfiles.forEach((u: any) => {
            const resolved = resolveAvatarUrl(u.avatar_url);
            if (resolved) {
              if (u.user_id) userProfileMap.set(u.user_id, resolved);
              if (u.email) userProfileMap.set(u.email.toLowerCase().trim(), resolved);
            }
          });
        }
      } catch (uErr) {
        console.warn("[ClinicAppointmentsPage] User avatar batch lookup warning:", uErr);
      }
    }

    // Map database records (excluding temporary holds and expired reservations)
    const mapped: AppointmentRecord[] = dbAppts
      .filter((a: any) => {
        const paySt = String(a.payment_status || "").toLowerCase().trim();
        return paySt !== "pending_hold" && paySt !== "expired" && paySt !== "failed" && paySt !== "cancelled";
      })
      .map((a: any) => {
      const photoUrl = a.skin_photo_url || undefined;

      const apptDate = a.date ? new Date(a.date) : null;
      const isValidDate = apptDate && !isNaN(apptDate.getTime());
      let dateStr = "";
      let timeStr = "";
      if (isValidDate) {
        const dFormatter = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Manila",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        dateStr = dFormatter.format(apptDate);
        const tFormatter = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Manila",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
        timeStr = tFormatter.format(apptDate);
      }
      if (a.time) {
        timeStr = a.time;
      }

      let displayStatus: AppointmentRecord["status"] = "pending";
      if (a.status === "confirmed" || a.status === "scheduled") displayStatus = "scheduled";
      else if (a.status === "completed") displayStatus = "completed";
      else if (a.status === "cancelled") displayStatus = "cancelled";
      else if (a.status === "rejected") displayStatus = "rejected";
      else if (a.status === "accepted") displayStatus = "accepted";

      // Robust doctor name resolution
      let docName: string | undefined = undefined;
      if (a.assigned_doctor_id) {
        const matchedDoc = docRows.find((d: any) => d.doctor_id === a.assigned_doctor_id);
        if (matchedDoc?.doctor_name) docName = matchedDoc.doctor_name;
      }
      if (!docName && a.assigned_doctor_id) {
        try {
          const rawDocs = localStorage.getItem("dermai_clinic_doctors");
          if (rawDocs) {
            const parsed = JSON.parse(rawDocs);
            if (Array.isArray(parsed)) {
              const found = parsed.find((d: any) => d.id === a.assigned_doctor_id);
              if (found?.name) docName = found.name;
            }
          }
        } catch { }
      }
      if (!docName && a.clinic_note) {
        const match = a.clinic_note.match(/(?:Assigned to|Re-assigned to|Attending Doctor:|Attending:?)\s*(?:Dr\.\s*)?([A-Za-z\s]+?)(?:\s+for|\s+accepted|\s+declined|\||\.|$)/i);
        if (match && match[1] && match[1].trim().toLowerCase() !== "dr") {
          docName = match[1].trim();
        }
      }
      const resolvedDoctorDisplay = formatDoctorDisplay(docName);

      let calculatedAge: number | undefined = undefined;
      if (a.patient_birthdate) {
        try {
          const b = new Date(a.patient_birthdate);
          if (!isNaN(b.getTime())) {
            const today = new Date();
            let age = today.getFullYear() - b.getFullYear();
            const m = today.getMonth() - b.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
            if (age >= 0 && age < 130) calculatedAge = age;
          }
        } catch { }
      }

      const qAnswers = typeof a.questionnaire_answers === "object" && a.questionnaire_answers !== null ? a.questionnaire_answers : {};
      const rescheduleRequested = Boolean(a.reschedule_requested ?? qAnswers.reschedule_requested);
      const rescheduleDate = a.reschedule_date || qAnswers.reschedule_date || undefined;
      const rescheduleTime = a.reschedule_time || qAnswers.reschedule_time || undefined;
      const rescheduleReason = a.reschedule_reason || qAnswers.reschedule_reason || undefined;
      const needsPatientReschedule = Boolean(a.needs_patient_reschedule ?? qAnswers.needs_patient_reschedule);
      const appointmentHistory = Array.isArray(a.appointment_history)
        ? a.appointment_history
        : (Array.isArray(qAnswers.appointment_history) ? qAnswers.appointment_history : []);
      const primaryScanId = a.primary_scan_id || qAnswers.primary_scan_id || undefined;

      // Extract payment details
      const rawPayStatus = String(a.payment_status || qAnswers.payment_status || "").toLowerCase().trim();
      const isPaidBool =
        a.is_paid === true ||
        qAnswers.is_paid === true ||
        rawPayStatus === "paid" ||
        rawPayStatus === "success" ||
        rawPayStatus === "completed" ||
        /paid online|gcash ref|maya ref|paymongo|payment verified|payment.*success/i.test(String(a.clinic_note || "")) ||
        /paid online|gcash ref|maya ref/i.test(String(a.notes || ""));

      let payMethod = a.payment_method || qAnswers.payment_method || "";
      if (!payMethod && a.clinic_note) {
        if (/maya/i.test(a.clinic_note)) payMethod = "Maya";
        else if (/gcash/i.test(a.clinic_note)) payMethod = "GCash";
      }
      let payRef = a.payment_reference || qAnswers.payment_reference || "";
      if (!payRef && a.clinic_note) {
        const refMatch = a.clinic_note.match(/(?:Ref|Reference):\s*([A-Za-z0-9_-]+)/i);
        if (refMatch) payRef = refMatch[1];
      }
      const payAmount = a.payment_amount || qAnswers.payment_amount || resolvedFee;

      // Resolve real patient profile avatar from user join or userProfileMap
      const userObj = Array.isArray(a.user) ? a.user[0] : a.user;
      const rawPatientAvatar =
        userObj?.avatar_url ||
        (a.user_id ? userProfileMap.get(a.user_id) : undefined) ||
        (a.patient_email ? userProfileMap.get(a.patient_email.toLowerCase().trim()) : undefined) ||
        a.patient_avatar ||
        qAnswers.patient_avatar;
      const resolvedPatientAvatar = resolveAvatarUrl(rawPatientAvatar);

      return {
        id: a.appointment_id,
        clinicId: 0,
        clinicName: clinicName || "Clinic",
        patientName: a.patient_name || userObj?.full_name || "Patient",
        patientAge: calculatedAge,
        patientGender: a.patient_gender || undefined,
        patientBirthdate: a.patient_birthdate || undefined,
        patientAvatar: resolvedPatientAvatar,
        patientEmail: a.patient_email || undefined,
        patientAddress: a.patient_address || undefined,
        patientContact: a.patient_contact || undefined,
        emergencyContactName: a.emergency_contact_name || undefined,
        emergencyContactPhone: a.emergency_contact_phone || undefined,
        emergencyRelationship: a.emergency_contact_relationship || undefined,
        consultationType: "face-to-face" as const,
        conditionName: a.ai_condition_name || undefined,
        date: dateStr,
        time: timeStr,
        notes: a.notes || "",
        status: displayStatus,
        clinicNote: a.clinic_note || undefined,
        assignedDoctorId: a.assigned_doctor_id || undefined,
        assignedDoctorName: resolvedDoctorDisplay || undefined,
        doctorStatus: a.doctor_status || undefined,
        doctorNote: a.doctor_note || undefined,
        doctorReviewedAt: a.doctor_reviewed_at || undefined,
        scheduleSentToDoctor: a.schedule_sent_to_doctor || false,
        createdAt: a.created_at || new Date().toISOString(),
        skinPhotoUrl: photoUrl,
        aiConditionName: a.ai_condition_name || undefined,
        aiConfidence: a.ai_confidence ? Number(a.ai_confidence) : undefined,
        queueNumber: a.queue_number || 1,
        batchTime: a.batch_time || undefined,
        checkInStatus: a.check_in_status || "scheduled",
        isWalkIn: Boolean(a.is_walk_in),
        userId: a.user_id || undefined,
        rescheduleRequested,
        rescheduleDate,
        rescheduleTime,
        rescheduleReason,
        needsPatientReschedule,
        appointmentHistory,
        primaryScanId,
        paymentStatus: isPaidBool ? "paid" : (rawPayStatus || "pending"),
        isPaid: isPaidBool,
        paymentAmount: payAmount,
        paymentMethod: payMethod || undefined,
        paymentReference: payRef || undefined,
      };
    });

    // Merge with local storage appointments
    try {
      const raw = localStorage.getItem("dermai_clinic_appointments");
      if (raw) {
        const localList = JSON.parse(raw);
        if (Array.isArray(localList)) {
          localList.forEach((localItem: any) => {
            const exists = mapped.some((m) => m.id === localItem.id);
            if (!exists) {
              const isClinicMatch =
                (resolvedClinicId && localItem.clinicId && String(localItem.clinicId) === String(resolvedClinicId)) ||
                (clinicName && localItem.clinicName && localItem.clinicName.toLowerCase().trim() === clinicName.toLowerCase().trim()) ||
                (!resolvedClinicId);
              if (isClinicMatch) {
                const localPayStatus = String(localItem.paymentStatus || localItem.payment_status || "").toLowerCase().trim();
                const localIsPaid =
                  localItem.isPaid === true ||
                  localItem.is_paid === true ||
                  localPayStatus === "paid" ||
                  localPayStatus === "success" ||
                  localPayStatus === "completed" ||
                  /paid online|gcash ref|maya ref|paymongo|payment verified|payment.*success/i.test(String(localItem.clinicNote || localItem.clinic_note || "")) ||
                  /paid online|gcash ref|maya ref/i.test(String(localItem.notes || ""));

                let localMethod = localItem.paymentMethod || localItem.payment_method || "";
                if (!localMethod && (localItem.clinicNote || localItem.clinic_note)) {
                  const combined = `${localItem.clinicNote || ""} ${localItem.clinic_note || ""}`;
                  if (/maya/i.test(combined)) localMethod = "Maya";
                  else if (/gcash/i.test(combined)) localMethod = "GCash";
                }
                let localRef = localItem.paymentReference || localItem.payment_reference || "";
                if (!localRef && (localItem.clinicNote || localItem.clinic_note)) {
                  const refMatch = `${localItem.clinicNote || ""} ${localItem.clinic_note || ""}`.match(/(?:Ref|Reference):\s*([A-Za-z0-9_-]+)/i);
                  if (refMatch) localRef = refMatch[1];
                }

                const localUserAvatar = resolveAvatarUrl(
                  localItem.patientAvatar ||
                  (localItem.userId ? userProfileMap.get(localItem.userId) : undefined) ||
                  (localItem.patientEmail ? userProfileMap.get(localItem.patientEmail.toLowerCase().trim()) : undefined)
                );

                mapped.push({
                  id: localItem.id,
                  clinicId: 0,
                  clinicName: localItem.clinicName || clinicName || "Clinic",
                  patientName: localItem.patientName || "Patient",
                  patientAvatar: localUserAvatar,
                  patientEmail: localItem.patientEmail || undefined,
                  patientAddress: localItem.patientAddress || undefined,
                  patientContact: localItem.patientContact || undefined,
                  emergencyContactName: localItem.emergencyContactName || localItem.emergency_contact_name || undefined,
                  emergencyContactPhone: localItem.emergencyContactPhone || localItem.emergency_contact_phone || undefined,
                  emergencyRelationship: localItem.emergencyRelationship || localItem.emergency_relationship || undefined,
                  consultationType: "face-to-face" as const,
                  conditionName: localItem.aiConditionName || localItem.conditionName || undefined,
                  date: localItem.date || "",
                  time: localItem.time || "",
                  notes: localItem.notes || "",
                  status: localItem.status || "pending",
                  clinicNote: localItem.clinicNote || undefined,
                  assignedDoctorId: localItem.assignedDoctorId || undefined,
                  assignedDoctorName: localItem.assignedDoctorName || undefined,
                  doctorStatus: localItem.doctorStatus || undefined,
                  doctorNote: localItem.doctorNote || undefined,
                  doctorReviewedAt: localItem.doctorReviewedAt || undefined,
                  scheduleSentToDoctor: localItem.scheduleSentToDoctor || false,
                  createdAt: localItem.createdAt || new Date().toISOString(),
                  skinPhotoUrl: localItem.skinPhotoUrl || undefined,
                  aiConditionName: localItem.aiConditionName || undefined,
                  aiConfidence: localItem.aiConfidence ? Number(localItem.aiConfidence) : undefined,
                  queueNumber: localItem.queueNumber || localItem.queue_number || 1,
                  batchTime: localItem.batchTime || localItem.batch_time || undefined,
                  checkInStatus: localItem.checkInStatus || localItem.check_in_status || "scheduled",
                  isWalkIn: Boolean(localItem.isWalkIn ?? localItem.is_walk_in),
                  userId: localItem.userId || localItem.user_id || undefined,
                  rescheduleRequested: localItem.rescheduleRequested,
                  rescheduleDate: localItem.rescheduleDate,
                  rescheduleTime: localItem.rescheduleTime,
                  rescheduleReason: localItem.rescheduleReason,
                  needsPatientReschedule: localItem.needsPatientReschedule,
                  appointmentHistory: localItem.appointmentHistory || [],
                  primaryScanId: localItem.primaryScanId,
                  paymentStatus: localIsPaid ? "paid" : (localPayStatus || "pending"),
                  isPaid: localIsPaid,
                  paymentAmount: localItem.paymentAmount || localItem.payment_amount || resolvedFee,
                  paymentMethod: localMethod || undefined,
                  paymentReference: localRef || undefined,
                });
              }
            }
          });
        }
      }
    } catch { }

    setAppointments(mapped);
    try {
      localStorage.setItem("dermai_clinic_appointments", JSON.stringify(mapped));
    } catch { }
    setLoadingData(false);
  };



  useEffect(() => {
    loadData();

    // Realtime channel for live incoming appointments and status updates
    let channel: any = null;
    if (clinicId) {
      channel = supabase
        .channel(`clinic-appointments-realtime-${clinicId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "patient_appointment", filter: `clinic_id=eq.${clinicId}` },
          () => {
            loadData();
          }
        )
        .subscribe();
    }

    const handleSync = () => loadData();
    window.addEventListener("dermai_appointments_updated", handleSync);
    window.addEventListener("appointmentCreated", handleSync);
    window.addEventListener("storage", handleSync);
    window.addEventListener("focus", handleSync);

    return () => {
      if (channel) supabase.removeChannel(channel);
      window.removeEventListener("dermai_appointments_updated", handleSync);
      window.removeEventListener("appointmentCreated", handleSync);
      window.removeEventListener("storage", handleSync);
      window.removeEventListener("focus", handleSync);
    };
  }, [clinicId, clinicName, loading]);

  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}`;
  });

  const [clinicSettings] = useState<ClinicSettings>(() => {
    try {
      const raw = localStorage.getItem("dermai_clinic_settings");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed) {
          return {
            openTime: parsed.openTime || DEFAULT_SETTINGS.openTime,
            closeTime: parsed.closeTime || DEFAULT_SETTINGS.closeTime,
          };
        }
      }
    } catch {
      /* ignore */
    }
    return DEFAULT_SETTINGS;
  });

  // Queue tab filter: all | needs_doctor | in_review | approved | reschedule_requests
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const validTabs = ["all", "needs_doctor", "in_review", "approved", "reschedule_requests"] as const;
  const [queueFilter, setQueueFilter] = useState<"all" | "needs_doctor" | "in_review" | "approved" | "reschedule_requests">(
    initialTab && (validTabs as readonly string[]).includes(initialTab) ? (initialTab as any) : "all"
  );

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab && (validTabs as readonly string[]).includes(tab)) {
      setQueueFilter(tab as any);
    }
  }, [searchParams]);

  // Modals
  const [viewingPatient, setViewingPatient] = useState<AppointmentRecord | null>(null);
  const [dayDetailDate, setDayDetailDate] = useState<string | null>(null);

  // Assign Doctor for Review Modal (also used for Re-assigning)
  const [assignDoctorModal, setAssignDoctorModal] = useState<{
    appointmentId: string;
    patientName?: string;
    isReassign?: boolean;
    currentDoctorId?: string;
    currentDoctorName?: string;
    doctorNote?: string;
    targetDate?: string;
    targetTime?: string;
    primaryScanId?: string;
    userId?: string;
  } | null>(null);
  const [selectedDoctorId, setSelectedDoctorId] = useState("");

  // Request Patient to Reschedule Modal (Clinic cannot change date/time directly)
  const [requestPatientRescheduleModal, setRequestPatientRescheduleModal] = useState<{
    appointmentId: string;
    patientName: string;
    currentDate: string;
    currentTime: string;
    userId?: string;
  } | null>(null);
  const [reschedulePromptReason, setReschedulePromptReason] = useState("");
  const [reschedulePromptError, setReschedulePromptError] = useState("");
  const [reschedulePromptSaving, setReschedulePromptSaving] = useState(false);

  // Decline Patient Reschedule Request Modal
  const [declinePatientRescheduleModal, setDeclinePatientRescheduleModal] = useState<{
    appointmentId: string;
    patientName: string;
    requestedDate?: string;
    requestedTime?: string;
    currentDate?: string;
    currentTime?: string;
    userId?: string;
  } | null>(null);
  const [declineRescheduleReason, setDeclineRescheduleReason] = useState("");
  const [declineRescheduleError, setDeclineRescheduleError] = useState("");
  const [declineRescheduleSaving, setDeclineRescheduleSaving] = useState(false);

  // Finalize Schedule Modal (Used after initial Doctor Approval)
  const [finalizeScheduleModal, setFinalizeScheduleModal] = useState<{
    appointmentId: string;
    patientName: string;
    assignedDoctorId?: string;
    assignedDoctorName?: string;
    date: string;
    time: string;
    isReschedule?: boolean;
  } | null>(null);

  // Reject / Decline Modal
  const [rejectModal, setRejectModal] = useState<{
    appointmentId: string;
    patientName: string;
    clinicName: string;
    patientEmail?: string;
    date?: string;
    time?: string;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [selectedPresetReason, setSelectedPresetReason] = useState("");
  const [rejectError, setRejectError] = useState("");
  const [assignError, setAssignError] = useState("");
  const [scheduleError, setScheduleError] = useState("");

  // No-Show Confirmation Modal
  const [noShowConfirmModal, setNoShowConfirmModal] = useState<AppointmentRecord | null>(null);
  const [markingNoShow, setMarkingNoShow] = useState(false);
  const [noShowError, setNoShowError] = useState("");
  const [noShowSuccess, setNoShowSuccess] = useState("");

  const calendarCells = useMemo(() => {
    const start = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const offset = (start.getDay() + 6) % 7;
    const gridStart = new Date(start);
    gridStart.setDate(start.getDate() - offset);

    return Array.from({ length: 42 }, (_, i) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + i);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
        date.getDate()
      ).padStart(2, "0")}`;

      return {
        key,
        date,
        inCurrentMonth: date.getMonth() === currentMonth.getMonth(),
      };
    });
  }, [currentMonth]);

  const appointmentsByDate = useMemo(() => {
    return appointments.reduce<Record<string, AppointmentRecord[]>>((acc, item) => {
      if (!item.date || item.status === "rejected" || item.status === "cancelled") return acc;
      if (!acc[item.date]) acc[item.date] = [];
      acc[item.date].push(item);
      return acc;
    }, {});
  }, [appointments]);

  // Verified Upfront Payment Enforcer:
  // Patient appointment booking workflow requires upfront payment before confirmation.
  // Only requests where payment has succeeded (payment_status = 'paid', is_paid = true, or verified note) are fetched and shown.
  const isUpfrontPaid = (a: AppointmentRecord): boolean => {
    if (a.isPaid === true) return true;
    const ps = String(a.paymentStatus || "").toLowerCase().trim();
    if (ps === "paid" || ps === "success" || ps === "completed") return true;
    const note = String(a.clinicNote || "");
    if (/paid online|gcash ref|maya ref|paymongo|payment verified|payment.*success/i.test(note)) return true;
    const patNotes = String(a.notes || "");
    if (/paid online|gcash ref|maya ref/i.test(patNotes)) return true;
    if (a.isWalkIn) return true;
    return false;
  };

  const getPaymentBadgeInfo = (appointment: AppointmentRecord) => {
    const fee = appointment.paymentAmount || clinicFee || 500;
    const formattedFee = `₱${Number(fee).toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

    let method = appointment.paymentMethod || "";
    if (!method) {
      const combined = `${appointment.clinicNote || ""} ${appointment.notes || ""}`;
      if (/maya/i.test(combined)) method = "Maya";
      else if (/gcash/i.test(combined)) method = "GCash";
    }

    const label = method ? `${formattedFee} • Paid via ${method}` : `${formattedFee} • Paid Online`;
    return {
      isPaid: true,
      label,
      method,
      fee: formattedFee,
    };
  };

  // Queues categorized by review lifecycle - strictly enforced verified upfront payment
  const incomingQueue = useMemo(() => {
    return appointments
      .filter(
        (a) =>
          !isAppointmentExcludedFromIncomingQueue(a) &&
          (a.status === "pending" || a.doctorStatus === "pending-review" || a.doctorStatus === "rejected") &&
          isUpfrontPaid(a)
      )
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [appointments]);

  const needsDoctorQueue = useMemo(
    () => incomingQueue.filter((a) => !a.assignedDoctorId && a.doctorStatus !== "rejected"),
    [incomingQueue]
  );
  const inReviewQueue = useMemo(
    () => incomingQueue.filter((a) => a.assignedDoctorId && a.doctorStatus === "pending-review"),
    [incomingQueue]
  );

  const approvedQueue = useMemo(
    () =>
      appointments.filter(
        (a) =>
          !isAppointmentExcludedFromIncomingQueue(a) &&
          a.doctorStatus !== "rejected" &&
          (a.status === "scheduled" ||
            a.status === "confirmed" ||
            a.status === "accepted" ||
            a.doctorStatus === "approved") &&
          isUpfrontPaid(a)
      ),
    [appointments]
  );
  const rescheduleRequestsQueue = useMemo(
    () =>
      appointments.filter(
        (a) =>
          Boolean(a.rescheduleRequested) &&
          !isAppointmentExcludedFromIncomingQueue(a) &&
          isUpfrontPaid(a)
      ),
    [appointments]
  );

  const displayedQueue = useMemo(() => {
    if (queueFilter === "needs_doctor") return needsDoctorQueue;
    if (queueFilter === "in_review") return inReviewQueue;
    if (queueFilter === "approved") return approvedQueue;
    if (queueFilter === "reschedule_requests") return rescheduleRequestsQueue;
    return incomingQueue;
  }, [queueFilter, incomingQueue, needsDoctorQueue, inReviewQueue, approvedQueue, rescheduleRequestsQueue]);

  const handleGoToToday = () => {
    const now = new Date();
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    setSelectedDate(todayKey);
  };

  const selectedDayAppointments = sortAppointmentsByDailyQueue(
    appointmentsByDate[selectedDate] || []
  );

  const monthLabel = currentMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const rejectRequest = async (id: string, reason?: string) => {
    const rejectionReason = reason?.trim() || "Request declined by clinic scheduling.";
    try {
      await supabase
        .from("patient_appointment")
        .update({
          status: "cancelled",
          doctor_status: "rejected",
          clinic_note: rejectionReason,
        })
        .eq("appointment_id", id);
    } catch (err: any) {
      console.error("Failed to reject appointment in Supabase:", err.message);
    }

    const appt = appointments.find((a) => a.id === id);
    if (appt?.userId) {
      createPatientNotification({
        userId: appt.userId,
        type: "appointment-rejected",
        subtype: "declined",
        title: "Appointment Declined",
        body: `Your appointment request for ${appt.date || "scheduled date"} was declined by ${clinicName || "the clinic"}: ${rejectionReason}`,
      });
    }

    setAppointments((prev) => {
      const next = prev.map((appt) =>
        appt.id === id
          ? {
            ...appt,
            status: "rejected" as const,
            doctorStatus: "rejected" as const,
            clinicNote: rejectionReason,
          }
          : appt
      );
      try {
        localStorage.setItem("dermai_clinic_appointments", JSON.stringify(next));
        window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
        window.dispatchEvent(new Event("storage"));
      } catch { }
      return next;
    });
  };

  const handleMarkArrived = async (id: string) => {
    try {
      await supabase
        .from("patient_appointment")
        .update({ check_in_status: "arrived" })
        .eq("appointment_id", id);
    } catch (err: any) {
      console.error("Failed to update check_in_status in Supabase:", err.message);
    }

    setAppointments((prev) => {
      const next = prev.map((appt) =>
        appt.id === id ? { ...appt, checkInStatus: "arrived" as const } : appt
      );
      try {
        localStorage.setItem("dermai_clinic_appointments", JSON.stringify(next));
        window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
        window.dispatchEvent(new Event("storage"));
      } catch { }
      return next;
    });
  };

  const handleConfirmNoShow = async () => {
    if (!noShowConfirmModal) return;
    setMarkingNoShow(true);
    setNoShowError("");
    setNoShowSuccess("");

    const targetId = noShowConfirmModal.id;

    try {
      // 1. Concurrency verification: verify persisted status in Supabase before changing
      const { data: latestRow, error: checkErr } = await supabase
        .from("patient_appointment")
        .select("appointment_id, status, check_in_status, clinic_id, user_id, questionnaire_answers")
        .eq("appointment_id", targetId)
        .maybeSingle();

      if (checkErr) {
        console.warn("[ClinicAppointments] Persisted status verification warning:", checkErr.message);
      }

      if (latestRow) {
        if (latestRow.status === "completed" || latestRow.check_in_status === "completed") {
          setNoShowError("This appointment was already completed by the attending doctor. No-Show cannot be applied.");
          setMarkingNoShow(false);
          await loadData();
          return;
        }
        if (latestRow.status === "cancelled" || latestRow.status === "rejected") {
          setNoShowError("This appointment has already been cancelled or declined.");
          setMarkingNoShow(false);
          await loadData();
          return;
        }
        if (latestRow.check_in_status === "no-show") {
          setNoShowError("This appointment is already recorded as No-Show.");
          setMarkingNoShow(false);
          await loadData();
          return;
        }
      }

      const patientUserId = noShowConfirmModal.userId || latestRow?.user_id;

      // 2. Persist status update to Supabase with audit history
      const noteText = `Marked as No-Show: Patient did not attend scheduled consultation (${noShowConfirmModal.date} ${noShowConfirmModal.time || ""}).`;

      const historyEntry: AppointmentHistoryEntry = {
        action: "cancelled",
        actor: "clinic",
        timestamp: new Date().toISOString(),
        previousDate: noShowConfirmModal.date,
        previousTime: noShowConfirmModal.time,
        reason: noteText,
      };
      const updatedHistory = [...(noShowConfirmModal.appointmentHistory || []), historyEntry];

      const currentQa = latestRow?.questionnaire_answers || (noShowConfirmModal as any)?.questionnaireAnswers || (noShowConfirmModal as any)?.questionnaire_answers;
      const nextQa: Record<string, any> = (currentQa && typeof currentQa === "object" && !Array.isArray(currentQa))
        ? { ...currentQa }
        : (Array.isArray(currentQa) ? { answers: currentQa } : {});
      nextQa.appointment_history = updatedHistory;
      nextQa.marked_no_show_at = new Date().toISOString();

      const { error: updateError } = await supabase
        .from("patient_appointment")
        .update({
          check_in_status: "no-show",
          clinic_note: noteText,
          questionnaire_answers: nextQa,
        })
        .eq("appointment_id", targetId);

      if (updateError) {
        throw new Error(updateError.message || "Failed to update appointment record in Supabase.");
      }

      // 3. Notify patient if linked
      if (patientUserId) {
        try {
          await createPatientNotification({
            userId: patientUserId,
            type: "system",
            subtype: "no-show",
            title: "Appointment Marked as Missed / No-Show",
            body: `Your consultation on ${noShowConfirmModal.date} at ${formatAppointmentTime(noShowConfirmModal.time)} was recorded as No-Show by ${clinicName || "the clinic"}. Please contact the clinic to reschedule.`,
          });
        } catch (notifErr) {
          console.warn("[ClinicAppointments] Failed to create patient notification:", notifErr);
        }
      }

      // 4. Update local state and cross-tab/queue caches
      setAppointments((prev) => {
        const next = prev.map((a) =>
          a.id === targetId
            ? { ...a, checkInStatus: "no-show" as const, clinicNote: noteText, appointmentHistory: updatedHistory }
            : a
        );
        try {
          localStorage.setItem("dermai_clinic_appointments", JSON.stringify(next));
          window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
          window.dispatchEvent(new Event("storage"));
        } catch { }
        return next;
      });

      setNoShowSuccess("Appointment successfully marked as No-Show.");
      setTimeout(() => {
        setNoShowConfirmModal(null);
        setNoShowSuccess("");
        setMarkingNoShow(false);
      }, 900);

      await loadData();
    } catch (err: any) {
      console.error("[ClinicAppointments] Error marking appointment as No-Show:", err);
      setNoShowError(err.message || "Could not save No-Show status. Please try again.");
      setMarkingNoShow(false);
    }
  };


  const handleConfirmRejection = () => {
    if (!rejectModal) return;
    const reasonToUse = rejectReason.trim() || selectedPresetReason.trim();
    if (!reasonToUse) {
      setRejectError("Please select a reason or enter a note for the patient.");
      return;
    }
    rejectRequest(rejectModal.appointmentId, reasonToUse);
    setRejectModal(null);
    setRejectReason("");
    setSelectedPresetReason("");
    setRejectError("");
  };

  // Check if patient's 24-hour doctor self-selection privilege window is active
  const getPatientPrivilegeStatus = useCallback((appt?: AppointmentRecord | null) => {
    if (!appt) return { isLocked: false, hoursRemaining: 0, minutesRemaining: 0, isWaived: false };
    const qa = appt.questionnaireAnswers;
    const isWaived = Boolean(qa?.patient_requested_clinic_reassign || qa?.patient_privilege_waived);
    if (isWaived) {
      return { isLocked: false, hoursRemaining: 0, minutesRemaining: 0, isWaived: true };
    }

    const declinedAtStr =
      appt.doctorReviewedAt ||
      qa?.declined_at ||
      qa?.appointment_history?.findLast?.((h: any) =>
        String(h.action || "").includes("decline") || String(h.action || "").includes("reject")
      )?.timestamp ||
      appt.createdAt ||
      new Date().toISOString();

    const declinedTime = new Date(declinedAtStr).getTime();
    const validDeclinedTime = isNaN(declinedTime) ? Date.now() : declinedTime;
    const expiresAt = validDeclinedTime + 24 * 3600 * 1000;
    const remainingMs = expiresAt - Date.now();

    if (remainingMs <= 0) {
      return { isLocked: false, hoursRemaining: 0, minutesRemaining: 0, isWaived: false };
    }

    const hrs = Math.floor(remainingMs / (1000 * 60 * 60));
    const mins = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
    return { isLocked: true, hoursRemaining: hrs, minutesRemaining: mins, isWaived: false };
  }, []);

  // Compute real-time availability for doctor reassignment modal
  const reassignAvailability = useMemo(() => {
    if (!assignDoctorModal || !assignDoctorModal.isReassign) {
      return {
        availableDoctors: clinicDoctors.map((doc) => ({ doctor: doc, matchedShift: undefined })),
        unavailableDoctors: [] as { doctor: any; reason: string }[],
      };
    }

    const targetDate = assignDoctorModal.targetDate || selectedDate;
    const targetTime = assignDoctorModal.targetTime || "09:00";

    return findAvailableDoctorsForSlot({
      doctors: clinicDoctors,
      targetClinicId: clinicId ? String(clinicId) : undefined,
      appointmentDate: targetDate,
      appointmentTime: targetTime,
      existingAppointments: appointments.filter((a) => a.id !== assignDoctorModal.appointmentId),
      excludeDoctorId: assignDoctorModal.currentDoctorId,
    });
  }, [assignDoctorModal, clinicDoctors, appointments, clinicId, selectedDate]);

  // 1. Assign doctor for pre-consultation review (or re-assign)
  const handleConfirmDoctorAssignment = async () => {
    if (!assignDoctorModal || !selectedDoctorId) return;
    setAssignError("");

    const doc = clinicDoctors.find((d) => d.id === selectedDoctorId);
    if (!doc) {
      setAssignError("Please select a doctor from your clinic roster.");
      return;
    }

    const targetAppt = appointments.find((a) => a.id === assignDoctorModal.appointmentId);

    // Rule: Enforce 24-hour patient privilege window
    if (assignDoctorModal.isReassign) {
      const privilege = getPatientPrivilegeStatus(targetAppt);
      if (privilege.isLocked) {
        setAssignError(`Cannot reassign doctor: Patient has an active 24-hour privilege window (${privilege.hoursRemaining}h ${privilege.minutesRemaining}m remaining) to select their own doctor.`);
        return;
      }
    }

    // Rule 6: Validate doctor-clinic association, shift schedule, slot conflict, shift capacity
    if (assignDoctorModal.isReassign) {
      const targetDate = assignDoctorModal.targetDate || targetAppt?.date || selectedDate;
      const targetTime = assignDoctorModal.targetTime || targetAppt?.time || "09:00";
      const valResult = validateDoctorReassignment({
        doctorId: doc.id,
        targetClinicId: clinicId ? String(clinicId) : undefined,
        appointmentDate: targetDate,
        appointmentTime: targetTime,
        doctor: doc,
        existingAppointments: appointments.filter((a) => a.id !== assignDoctorModal.appointmentId),
      });

      if (!valResult.isAvailable) {
        setAssignError(valResult.reason || "Doctor is not available at the original date and time.");
        return;
      }
    }

    const isUuid = (id?: string | null): boolean =>
      !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    let targetDoctorId: string | null = isUuid(doc.id) ? doc.id : null;

    if (!targetDoctorId && doc.email) {
      try {
        const { data: dbDoc } = await supabase
          .from("clinic_doctor")
          .select("doctor_id")
          .eq("email", doc.email.trim().toLowerCase())
          .maybeSingle();
        if (dbDoc?.doctor_id && isUuid(dbDoc.doctor_id)) {
          targetDoctorId = dbDoc.doctor_id;
        }
      } catch { }
    }

    if (!targetDoctorId && doc.name) {
      try {
        const { data: dbDoc } = await supabase
          .from("clinic_doctor")
          .select("doctor_id")
          .ilike("doctor_name", `%${doc.name.trim()}%`)
          .maybeSingle();
        if (dbDoc?.doctor_id && isUuid(dbDoc.doctor_id)) {
          targetDoctorId = dbDoc.doctor_id;
        }
      } catch { }
    }

    // Auto-create doctor record in clinic_doctor if not found in database
    let activeClinicId: string | null = clinicId ? String(clinicId) : null;
    if (!activeClinicId) {
      try {
        const cache = localStorage.getItem("dermai_clinic_profile_cache");
        if (cache) {
          const parsed = JSON.parse(cache);
          if (parsed.clinicId) activeClinicId = String(parsed.clinicId);
        }
      } catch { }
    }

    if (!targetDoctorId && activeClinicId && isUuid(activeClinicId)) {
      try {
        let linkedUserId: string | null = null;
        if (doc.email) {
          const { data: uRow } = await supabase
            .from("user")
            .select("user_id")
            .eq("email", doc.email.trim().toLowerCase())
            .maybeSingle();
          if (uRow?.user_id) linkedUserId = uRow.user_id;
        }

        const { data: createdDoc, error: createDocErr } = await supabase
          .from("clinic_doctor")
          .insert({
            clinic_id: activeClinicId,
            doctor_name: doc.name.trim(),
            email: doc.email?.trim().toLowerCase() || `${doc.name.toLowerCase().replace(/[^a-z0-9]/g, "")}@clinic.internal`,
            prc_license: (doc as any).prcLicense || "PRC-VERIFIED",
            user_id: linkedUserId,
            status: "Active",
          })
          .select("doctor_id")
          .maybeSingle();
        if (createdDoc?.doctor_id && isUuid(createdDoc.doctor_id)) {
          targetDoctorId = createdDoc.doctor_id;
        } else if (createDocErr) {
          console.error("Failed to auto-create clinic_doctor row:", createDocErr.message);
        }
      } catch (err: any) {
        console.error("Auto-create doctor exception:", err?.message);
      }
    }

    if (!targetDoctorId) {
      setAssignError("Could not link doctor to the clinic database. Please make sure the doctor is registered in the Doctors roster.");
      return;
    }

    const clinicNoteMsg = assignDoctorModal.isReassign
      ? `Re-assigned to Dr. ${doc.name.replace(/^dr\.\s*/i, "")} for review.`
      : `Assigned to Dr. ${doc.name.replace(/^dr\.\s*/i, "")} for pre-consultation review.`;

    const historyEntry: AppointmentHistoryEntry = {
      action: assignDoctorModal.isReassign ? "doctor_reassigned" : "doctor_assigned",
      actor: "clinic",
      timestamp: new Date().toISOString(),
      previousDoctorId: assignDoctorModal.currentDoctorId,
      previousDoctorName: assignDoctorModal.currentDoctorName,
      newDoctorId: targetDoctorId || doc.id,
      newDoctorName: doc.name,
      previousDate: targetAppt?.date,
      previousTime: targetAppt?.time,
    };
    const updatedHistory = [...(targetAppt?.appointmentHistory || []), historyEntry];

    // Rule 5: Doctor reassignment must retain original appointment date, time, and primary_scan_id
    const currentQa = (targetAppt as any)?.questionnaire_answers || (targetAppt as any)?.questionnaireAnswers;
    const nextQa: Record<string, any> = (currentQa && typeof currentQa === "object" && !Array.isArray(currentQa))
      ? { ...currentQa }
      : (Array.isArray(currentQa) ? { answers: currentQa } : {});
    nextQa.primary_scan_id = targetAppt?.primaryScanId;
    nextQa.appointment_history = updatedHistory;
    nextQa.needs_patient_reschedule = false;

    const updatePayload: Record<string, any> = {
      assigned_doctor_id: targetDoctorId,
      doctor_status: "pending-review",
      doctor_note: null,
      doctor_reviewed_at: null,
      clinic_note: clinicNoteMsg,
      primary_scan_id: targetAppt?.primaryScanId || null,
      questionnaire_answers: nextQa,
    };

    try {
      const { error: updateErr } = await supabase
        .from("patient_appointment")
        .update(updatePayload)
        .eq("appointment_id", assignDoctorModal.appointmentId);

      if (updateErr) {
        console.error("Failed to assign doctor in Supabase:", updateErr.message);
        setAssignError(`Failed to save doctor assignment: ${updateErr.message}`);
        return;
      }
    } catch (err: any) {
      console.error("Failed to assign doctor in Supabase:", err.message);
      setAssignError(err.message || "An error occurred while saving doctor assignment.");
      return;
    }

    // Rule 5: Notify patient about doctor change
    const patientUserId = assignDoctorModal.userId || targetAppt?.userId;
    if (patientUserId) {
      try {
        await createPatientNotification({
          userId: patientUserId,
          type: "doctor-assigned",
          subtype: assignDoctorModal.isReassign ? "reassigned" : "assigned",
          title: assignDoctorModal.isReassign ? "Doctor Reassigned for Review" : "Doctor Assigned for Review",
          body: assignDoctorModal.isReassign
            ? `Your consultation for ${targetAppt?.date || "scheduled date"} at ${formatAppointmentTime(targetAppt?.time)} has been reassigned to Dr. ${doc.name.replace(/^dr\.\s*/i, "")} for pre-consultation review.`
            : `Dr. ${doc.name.replace(/^dr\.\s*/i, "")} has been assigned to review your consultation request.`,
        });
      } catch (notifErr) {
        console.warn("Failed to notify patient of doctor assignment:", notifErr);
      }
    }

    setAppointments((prev) => {
      const next = prev.map((a) => {
        if (a.id !== assignDoctorModal.appointmentId) return a;
        return {
          ...a,
          assignedDoctorId: targetDoctorId || doc.id,
          assignedDoctorName: doc.name,
          doctorStatus: "pending-review" as const,
          doctorNote: undefined,
          doctorReviewedAt: undefined,
          clinicNote: clinicNoteMsg,
          needsPatientReschedule: false,
          appointmentHistory: updatedHistory,
        };
      });
      try {
        localStorage.setItem("dermai_clinic_appointments", JSON.stringify(next));
        window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
        window.dispatchEvent(new Event("storage"));
      } catch { }
      return next;
    });

    logAuditEvent({
      role: "clinic",
      category: "Appointment",
      action: assignDoctorModal.isReassign ? "Doctor Reassigned" : "Doctor Assigned",
      target: `Appointment #${assignDoctorModal.appointmentId.slice(0, 8)}`,
      details: `Clinic ${assignDoctorModal.isReassign ? "reassigned" : "assigned"} Dr. ${doc.name} to patient appointment #${assignDoctorModal.appointmentId.slice(0, 8)}.`,
      metadata: {
        appointmentId: assignDoctorModal.appointmentId,
        doctorId: doc.id,
        doctorName: doc.name,
        isReassign: assignDoctorModal.isReassign,
      },
    }).catch(() => {});

    setAssignDoctorModal(null);
    setSelectedDoctorId("");
    setAssignError("");
    setQueueFilter("in_review");
  };

  // Rule 4: If no doctor is available at the original date and time, notify patient to choose/request new schedule
  const handleNotifyPatientNoDoctorAvailable = async () => {
    if (!assignDoctorModal) return;
    const targetAppt = appointments.find((a) => a.id === assignDoctorModal.appointmentId);
    if (!targetAppt) return;

    try {
      const historyEntry: AppointmentHistoryEntry = {
        action: "patient_reschedule_needed",
        actor: "clinic",
        timestamp: new Date().toISOString(),
        previousDoctorId: assignDoctorModal.currentDoctorId,
        previousDoctorName: assignDoctorModal.currentDoctorName,
        date: targetAppt.date,
        time: targetAppt.time,
        reason: `Previous doctor declined and no replacement doctor was available at ${targetAppt.date} at ${formatAppointmentTime(targetAppt.time)}.`,
      };
      const updatedHistory = [...(targetAppt.appointmentHistory || []), historyEntry];
      const noteText = `Doctor declined schedule. No replacement doctor available for ${targetAppt.date} at ${formatAppointmentTime(targetAppt.time)}. Patient notified to select new schedule.`;

      const currentQa2 = (targetAppt as any)?.questionnaire_answers || (targetAppt as any)?.questionnaireAnswers;
      const nextQa2: Record<string, any> = (currentQa2 && typeof currentQa2 === "object" && !Array.isArray(currentQa2))
        ? { ...currentQa2 }
        : (Array.isArray(currentQa2) ? { answers: currentQa2 } : {});
      nextQa2.needs_patient_reschedule = true;
      nextQa2.appointment_history = updatedHistory;

      await supabase
        .from("patient_appointment")
        .update({
          clinic_note: noteText,
          questionnaire_answers: nextQa2,
        })
        .eq("appointment_id", targetAppt.id);

      if (targetAppt.userId) {
        await createPatientNotification({
          userId: targetAppt.userId,
          type: "appointment-reschedule-needed",
          subtype: "action-required",
          title: "Doctor Schedule Conflict - Action Needed",
          body: `Your assigned doctor is unavailable for ${targetAppt.date} at ${formatAppointmentTime(targetAppt.time)}, and no replacement doctor is available for this slot. Please choose another date and time that works for you.`,
        });
      }

      setAppointments((prev) => {
        const next = prev.map((a) => {
          if (a.id !== targetAppt.id) return a;
          return {
            ...a,
            needsPatientReschedule: true,
            clinicNote: noteText,
            appointmentHistory: updatedHistory,
          };
        });
        try {
          localStorage.setItem("dermai_clinic_appointments", JSON.stringify(next));
          window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
          window.dispatchEvent(new Event("storage"));
        } catch { }
        return next;
      });

      setAssignDoctorModal(null);
      setSelectedDoctorId("");
      setAssignError("");
    } catch (err: any) {
      console.error("Failed to notify patient of no doctor:", err);
      setAssignError(err?.message || "Failed to notify patient.");
    }
  };

  // Rule 1: Accept Patient Reschedule Request
  const handleAcceptPatientReschedule = async (appointment: AppointmentRecord) => {
    if (!appointment.rescheduleDate || !appointment.rescheduleTime) return;
    try {
      const newDateStr = appointment.rescheduleDate;
      const newTimeStr = appointment.rescheduleTime;
      const fullIsoDate = `${newDateStr}T${newTimeStr}:00+08:00`;
      const destQueueNumber = computeNextQueueNumber(
        appointments,
        appointment.assignedDoctorId,
        newDateStr
      );
      const historyEntry: AppointmentHistoryEntry = {
        action: "reschedule_accepted",
        actor: "clinic",
        timestamp: new Date().toISOString(),
        previousDate: appointment.date,
        previousTime: appointment.time,
        newDate: newDateStr,
        newTime: newTimeStr,
        reason: appointment.rescheduleReason,
      };
      const updatedHistory = [...(appointment.appointmentHistory || []), historyEntry];

      const currentQa3 = (appointment as any)?.questionnaireAnswers || (appointment as any)?.questionnaire_answers;
      const nextQa3: Record<string, any> = (currentQa3 && typeof currentQa3 === "object" && !Array.isArray(currentQa3))
        ? { ...currentQa3 }
        : (Array.isArray(currentQa3) ? { answers: currentQa3 } : {});
      nextQa3.reschedule_requested = false;
      nextQa3.reschedule_date = null;
      nextQa3.reschedule_time = null;
      nextQa3.reschedule_reason = null;
      nextQa3.needs_patient_reschedule = false;
      nextQa3.appointment_history = updatedHistory;

      const updatePayload: Record<string, any> = {
        date: fullIsoDate,
        time: newTimeStr,
        queue_number: destQueueNumber,
        clinic_note: `Reschedule request accepted by clinic for ${newDateStr} at ${formatAppointmentTime(newTimeStr)}.`,
        questionnaire_answers: nextQa3,
      };

      const { error: updateErr } = await supabase
        .from("patient_appointment")
        .update(updatePayload)
        .eq("appointment_id", appointment.id);

      if (updateErr) {
        console.error("Failed to accept reschedule in Supabase:", updateErr.message);
      }

      if (appointment.userId) {
        await createPatientNotification({
          userId: appointment.userId,
          type: "appointment-scheduled",
          subtype: "confirmed",
          title: "Reschedule Request Approved",
          body: `Your consultation at ${clinicName || "the clinic"} has been rescheduled to ${newDateStr} at ${formatAppointmentTime(newTimeStr)} as requested.`,
        });
      }

      setAppointments((prev) => {
        const next = prev.map((a) => {
          if (a.id !== appointment.id) return a;
          return {
            ...a,
            date: newDateStr,
            time: newTimeStr,
            queueNumber: destQueueNumber,
            rescheduleRequested: false,
            rescheduleDate: undefined,
            rescheduleTime: undefined,
            rescheduleReason: undefined,
            needsPatientReschedule: false,
            clinicNote: `Reschedule request accepted by clinic for ${newDateStr} at ${formatAppointmentTime(newTimeStr)}.`,
            appointmentHistory: updatedHistory,
          };
        });
        try {
          localStorage.setItem("dermai_clinic_appointments", JSON.stringify(next));
          window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
          window.dispatchEvent(new Event("storage"));
        } catch { }
        return next;
      });
    } catch (err: any) {
      console.error("Error accepting reschedule request:", err);
    }
  };

  // Rule 1: Decline Patient Reschedule Request (Original schedule is preserved)
  const handleConfirmDeclineReschedule = async () => {
    if (!declinePatientRescheduleModal) return;
    const reasonText = declineRescheduleReason.trim() || "The clinic cannot accommodate this requested date/time slot.";
    setDeclineRescheduleSaving(true);
    try {
      const appt = appointments.find((a) => a.id === declinePatientRescheduleModal.appointmentId);
      const historyEntry: AppointmentHistoryEntry = {
        action: "reschedule_declined",
        actor: "clinic",
        timestamp: new Date().toISOString(),
        previousDate: declinePatientRescheduleModal.currentDate,
        previousTime: declinePatientRescheduleModal.currentTime,
        requestedDate: declinePatientRescheduleModal.requestedDate,
        requestedTime: declinePatientRescheduleModal.requestedTime,
        reason: reasonText,
      };
      const updatedHistory = [...(appt?.appointmentHistory || []), historyEntry];

      const currentQa4 = (appt as any)?.questionnaireAnswers || (appt as any)?.questionnaire_answers;
      const nextQa4: Record<string, any> = (currentQa4 && typeof currentQa4 === "object" && !Array.isArray(currentQa4))
        ? { ...currentQa4 }
        : (Array.isArray(currentQa4) ? { answers: currentQa4 } : {});
      nextQa4.reschedule_requested = false;
      nextQa4.reschedule_date = null;
      nextQa4.reschedule_time = null;
      nextQa4.reschedule_reason = null;
      nextQa4.appointment_history = updatedHistory;

      const updatePayload: Record<string, any> = {
        clinic_note: `Reschedule request declined: ${reasonText}. Original schedule (${declinePatientRescheduleModal.currentDate} at ${formatAppointmentTime(declinePatientRescheduleModal.currentTime)}) remains active.`,
        questionnaire_answers: nextQa4,
      };

      const { error: updateErr } = await supabase
        .from("patient_appointment")
        .update(updatePayload)
        .eq("appointment_id", declinePatientRescheduleModal.appointmentId);

      if (updateErr) {
        console.error("Failed to decline reschedule in Supabase:", updateErr.message);
      }

      if (declinePatientRescheduleModal.userId) {
        await createPatientNotification({
          userId: declinePatientRescheduleModal.userId,
          type: "appointment-reschedule-declined",
          subtype: "declined",
          title: "Reschedule Request Declined",
          body: `Your request to reschedule to ${declinePatientRescheduleModal.requestedDate} could not be accepted: ${reasonText}. Your original appointment on ${declinePatientRescheduleModal.currentDate} at ${formatAppointmentTime(declinePatientRescheduleModal.currentTime)} remains reserved.`,
        });
      }

      setAppointments((prev) => {
        const next = prev.map((a) => {
          if (a.id !== declinePatientRescheduleModal.appointmentId) return a;
          return {
            ...a,
            rescheduleRequested: false,
            rescheduleDate: undefined,
            rescheduleTime: undefined,
            rescheduleReason: undefined,
            clinicNote: `Reschedule request declined: ${reasonText}. Original schedule remains active.`,
            appointmentHistory: updatedHistory,
          };
        });
        try {
          localStorage.setItem("dermai_clinic_appointments", JSON.stringify(next));
          window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
          window.dispatchEvent(new Event("storage"));
        } catch { }
        return next;
      });

      setDeclinePatientRescheduleModal(null);
      setDeclineRescheduleReason("");
      setDeclineRescheduleError("");
    } catch (err: any) {
      setDeclineRescheduleError(err?.message || "Failed to decline reschedule request.");
    } finally {
      setDeclineRescheduleSaving(false);
    }
  };

  // Rule 2: Request Patient to Reschedule (Clinic cannot directly change patient's schedule)
  const handleConfirmRequestPatientReschedule = async () => {
    if (!requestPatientRescheduleModal) return;
    const reasonText = reschedulePromptReason.trim();
    if (!reasonText) {
      setReschedulePromptError("Please provide a reason to help the patient choose a new schedule.");
      return;
    }
    setReschedulePromptSaving(true);
    try {
      const appt = appointments.find((a) => a.id === requestPatientRescheduleModal.appointmentId);
      const historyEntry: AppointmentHistoryEntry = {
        action: "patient_reschedule_needed",
        actor: "clinic",
        timestamp: new Date().toISOString(),
        previousDate: requestPatientRescheduleModal.currentDate,
        previousTime: requestPatientRescheduleModal.currentTime,
        reason: reasonText,
      };
      const updatedHistory = [...(appt?.appointmentHistory || []), historyEntry];
      const noteText = `Clinic requested patient reschedule: ${reasonText}`;

      const currentQa5 = (appt as any)?.questionnaireAnswers || (appt as any)?.questionnaire_answers;
      const nextQa5: Record<string, any> = (currentQa5 && typeof currentQa5 === "object" && !Array.isArray(currentQa5))
        ? { ...currentQa5 }
        : (Array.isArray(currentQa5) ? { answers: currentQa5 } : {});
      nextQa5.needs_patient_reschedule = true;
      nextQa5.appointment_history = updatedHistory;

      const updatePayload: Record<string, any> = {
        clinic_note: noteText,
        questionnaire_answers: nextQa5,
      };

      const { error: updateErr } = await supabase
        .from("patient_appointment")
        .update(updatePayload)
        .eq("appointment_id", requestPatientRescheduleModal.appointmentId);

      if (updateErr) {
        console.error("Failed to request patient reschedule in Supabase:", updateErr.message);
      }

      if (requestPatientRescheduleModal.userId) {
        await createPatientNotification({
          userId: requestPatientRescheduleModal.userId,
          type: "appointment-reschedule-needed",
          subtype: "action-required",
          title: "Reschedule Request from Clinic",
          body: `The clinic requested to reschedule your appointment for ${requestPatientRescheduleModal.currentDate}: ${reasonText}. Please choose an available schedule on your DermAI portal.`,
        });
      }

      setAppointments((prev) => {
        const next = prev.map((a) => {
          if (a.id !== requestPatientRescheduleModal.appointmentId) return a;
          return {
            ...a,
            needsPatientReschedule: true,
            clinicNote: noteText,
            appointmentHistory: updatedHistory,
          };
        });
        try {
          localStorage.setItem("dermai_clinic_appointments", JSON.stringify(next));
          window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
          window.dispatchEvent(new Event("storage"));
        } catch { }
        return next;
      });

      setRequestPatientRescheduleModal(null);
      setReschedulePromptReason("");
      setReschedulePromptError("");
    } catch (err: any) {
      setReschedulePromptError(err?.message || "Failed to notify patient.");
    } finally {
      setReschedulePromptSaving(false);
    }
  };

  // 2. Finalize schedule after doctor approval (or reschedule existing)
  const handleConfirmFinalizeSchedule = async () => {
    if (!finalizeScheduleModal) return;
    setScheduleError("");

    if (!finalizeScheduleModal.date) {
      setScheduleError("Please select a consultation date.");
      return;
    }
    if (!finalizeScheduleModal.time) {
      setScheduleError("Please select a consultation time.");
      return;
    }

    if (
      finalizeScheduleModal.time < clinicSettings.openTime ||
      finalizeScheduleModal.time > clinicSettings.closeTime
    ) {
      setScheduleError(
        `Time must be between ${clinicSettings.openTime} and ${clinicSettings.closeTime}.`
      );
      return;
    }

    const appt = appointments.find((a) => a.id === finalizeScheduleModal.appointmentId);
    const doctorDisplayName = finalizeScheduleModal.assignedDoctorName || appt?.assignedDoctorName || "Doctor";
    const docId = finalizeScheduleModal.assignedDoctorId || appt?.assignedDoctorId;
    const isDateChanged = Boolean(appt?.date && !appt.date.startsWith(finalizeScheduleModal.date));
    const finalQueueNumber = isDateChanged
      ? computeNextQueueNumber(appointments, docId, finalizeScheduleModal.date)
      : (appt?.queueNumber || 1);

    try {
      const updateData: Record<string, any> = {
        status: "confirmed",
        date: `${finalizeScheduleModal.date}T${finalizeScheduleModal.time}:00+08:00`,
        schedule_sent_to_doctor: true,
        clinic_note: `Consultation schedule confirmed for ${finalizeScheduleModal.date} at ${finalizeScheduleModal.time} with Dr. ${doctorDisplayName.replace(/^dr\.\s*/i, "")}.`,
      };
      if (isDateChanged) {
        updateData.queue_number = finalQueueNumber;
      }
      const { error: updateErr } = await supabase
        .from("patient_appointment")
        .update(updateData)
        .eq("appointment_id", finalizeScheduleModal.appointmentId);

      if (updateErr) {
        console.error("Failed to finalize schedule in Supabase:", updateErr.message);
      }
    } catch (err: any) {
      console.error("Failed to finalize schedule in Supabase:", err.message);
    }

    if (appt?.userId) {
      createPatientNotification({
        userId: appt.userId,
        type: "appointment-scheduled",
        subtype: "confirmed",
        title: "Appointment Confirmed",
        body: `Your consultation schedule with Dr. ${doctorDisplayName.replace(/^dr\.\s*/i, "")} at ${clinicName || "the clinic"} has been confirmed for ${finalizeScheduleModal.date} at ${finalizeScheduleModal.time}.`,
      });
    }

    setAppointments((prev) => {
      const next = prev.map((item) => {
        if (item.id !== finalizeScheduleModal.appointmentId) return item;
        return {
          ...item,
          date: finalizeScheduleModal.date,
          time: finalizeScheduleModal.time,
          status: "scheduled" as const,
          scheduleSentToDoctor: true,
          queueNumber: finalQueueNumber,
          clinicNote: `Consultation schedule confirmed for ${finalizeScheduleModal.date} at ${finalizeScheduleModal.time} with Dr. ${doctorDisplayName.replace(/^dr\.\s*/i, "")}.`,
        };
      });
      try {
        localStorage.setItem("dermai_clinic_appointments", JSON.stringify(next));
        window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
        window.dispatchEvent(new Event("storage"));
      } catch { }
      return next;
    });

    setFinalizeScheduleModal(null);
    setScheduleError("");
  };

  if (loading && verificationStatus !== "verified") {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-gray-200 rounded-lg"></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-white rounded-2xl border border-gray-100 p-4"></div>
          ))}
        </div>
        <div className="h-96 bg-white rounded-2xl border border-gray-100"></div>
      </div>
    );
  }

  if (verificationStatus !== "verified") {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-5">
          <Lock className="w-8 h-8 text-gray-400" />
        </div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">Verification Required</h2>
        <p className="text-sm text-gray-500 max-w-sm mb-6">
          {verificationStatus === "rejected"
            ? "Your clinic registration was rejected. Please update your profile and contact admin."
            : "Your clinic is pending admin verification. Appointment management will be available once approved."}
        </p>
        <Link
          to="/clinic/settings"
          className="px-5 py-2 rounded-xl bg-[#c0166a] text-white text-sm font-semibold hover:bg-[#a01259] transition-colors"
        >
          {verificationStatus === "rejected" ? "Update Profile" : "View Profile"}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Appointments</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Select a patient, set date and time in a modal, then confirm.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={loadData}
            disabled={loadingData}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors shadow-xs cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingData ? "animate-spin text-magenta-600" : "text-gray-500"}`} />
            <span>{loadingData ? "Syncing..." : "Refresh Appointments"}</span>
          </button>
        </div>
      </div>


      {assignError && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {assignError}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ── Left Column: Calendar + Scheduled on [Date] + Legend ── */}
        <div className="lg:col-span-7 xl:col-span-6 bg-white border border-gray-100 rounded-3xl p-5 shadow-xs">
          {/* Calendar Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <Calendar className="w-5 h-5 text-[#c0166a]" />
              <h2 className="font-display font-bold text-gray-900 text-base">
                {monthLabel}
              </h2>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
                }
                className="p-1.5 rounded-xl border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
                title="Previous month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
                }
                className="p-1.5 rounded-xl border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
                title="Next month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleGoToToday}
                className="px-3 py-1 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 transition-colors cursor-pointer shadow-2xs"
              >
                Today
              </button>
            </div>
          </div>

          {/* Day of Week Headers */}
          <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold text-gray-400 mb-1.5 px-1">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <p key={day}>{day}</p>
            ))}
          </div>

          {/* Calendar Cells Grid */}
          <div className="grid grid-cols-7 gap-1.5">
            {calendarCells.map((cell) => {
              const isSelected = selectedDate === cell.key;
              const dayAppointments = appointmentsByDate[cell.key] || [];
              const hasAppointment = dayAppointments.some(
                (a) => a.status !== "cancelled" && a.status !== "rejected"
              );

              return (
                <div
                  key={cell.key}
                  onClick={() => setSelectedDate(cell.key)}
                  className={cn(
                    "min-h-[54px] sm:min-h-[58px] rounded-xl p-1.5 sm:p-2 text-left transition-all cursor-pointer flex flex-col justify-between border",
                    !cell.inCurrentMonth
                      ? "bg-gray-50/50 border-gray-200/60 text-gray-300"
                      : isSelected
                      ? "bg-gradient-to-b from-rose-50/90 to-pink-50/50 border-rose-300 shadow-2xs"
                      : "bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50/50"
                  )}
                >
                  <p
                    className={cn(
                      "text-[11px] sm:text-xs font-semibold",
                      !cell.inCurrentMonth
                        ? "text-gray-300"
                        : isSelected
                        ? "text-[#c0166a] font-bold"
                        : "text-gray-800"
                    )}
                  >
                    {cell.date.getDate()}
                  </p>

                  {/* Status Indicator Line */}
                  <div className="flex items-center justify-center min-h-[10px] mt-1">
                    {hasAppointment ? (
                      <span className="w-5 sm:w-6 h-1 rounded-full bg-[#c0166a]" />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Scheduled on [selectedDate] Section ── */}
          <div className="mt-6">
            <h3 className="text-sm font-bold text-gray-900 mb-3">
              Scheduled on {selectedDate}
            </h3>

            <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-2xs">
              {selectedDayAppointments.length === 0 ? (
                <p className="py-6 text-center text-xs text-gray-400">
                  No scheduled appointments for this date.
                </p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {selectedDayAppointments.map((appointment) => {
                    const isEarly = isMorningTime(appointment.time);
                    const isPast = isAppointmentPastDue(appointment);
                    const isNoShow = appointment.checkInStatus === "no-show";
                    const isCompleted = appointment.status === "completed" || appointment.checkInStatus === "completed";
                    const isArrived = appointment.checkInStatus === "arrived";

                    return (
                      <motion.div
                        key={appointment.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        onClick={() => setViewingPatient(appointment)}
                        className={cn(
                          "py-3.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer group hover:bg-gray-50/80 rounded-2xl px-2.5 transition-all border border-transparent",
                          isPast && !isNoShow && !isCompleted && "bg-rose-50/30 hover:bg-rose-50/60 border-rose-100/80 shadow-2xs",
                          isNoShow && "bg-gray-50/40 opacity-80"
                        )}
                      >
                        {/* Left: Avatar with Initials & Details */}
                        <div className="flex items-center gap-3.5 min-w-0">
                          <PatientAvatar
                            fullName={appointment.patientName}
                            name={appointment.patientName}
                            avatarUrl={appointment.patientAvatar}
                            photoUrl={appointment.patientAvatar}
                            userId={appointment.userId}
                            className={cn(
                              "w-10 h-10 sm:w-11 sm:h-11 rounded-full shrink-0 border transition-all",
                              isNoShow
                                ? "border-rose-200"
                                : isPast && !isCompleted
                                ? "border-rose-200/90"
                                : "border-pink-100/80"
                            )}
                            fallbackClassName={cn(
                              isNoShow
                                ? "bg-rose-100 text-rose-700"
                                : isPast && !isCompleted
                                ? "bg-rose-100/70 text-rose-700"
                                : "bg-pink-50 text-[#c0166a]"
                            )}
                          />

                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-xs sm:text-sm font-bold text-gray-900 truncate group-hover:text-[#c0166a] transition-colors">
                                {appointment.patientName || "Patient"}
                              </p>

                              {/* Status Badges */}
                              {isNoShow ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200">
                                  <AlertTriangle className="w-3 h-3 text-rose-600" />
                                  Absent / No-Show
                                </span>
                              ) : isCompleted ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                  Completed
                                </span>
                              ) : isArrived ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">
                                  <span className="w-1.5 h-1.5 rounded-full bg-sky-500 inline-block animate-pulse" />
                                  In Lobby
                                </span>
                              ) : isPast ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200">
                                  <Clock className="w-3 h-3 text-rose-600" />
                                  Time Passed · Needs Action
                                </span>
                              ) : null}
                            </div>

                            <p className="text-[11px] text-gray-400 mt-0.5">
                              {appointment.patientAge ? `${appointment.patientAge} years old` : "Age not specified"}
                            </p>
                            <p className="text-[11px] text-[#c0166a] font-medium mt-0.5 truncate">
                              {appointment.conditionName || appointment.aiConditionName || "Skin Concern"}
                            </p>
                            <div className="flex items-center gap-1.5 text-[11px] text-gray-500 mt-0.5 truncate">
                              <User className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                              <span className="truncate">
                                {appointment.assignedDoctorName
                                  ? formatDoctorDisplay(appointment.assignedDoctorName)
                                  : "Doctor unassigned"}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Right: Actions, Time badge + Chevron */}
                        <div className="flex items-center gap-2 shrink-0 justify-between sm:justify-end pt-1 sm:pt-0">
                          {isPast && !isNoShow && !isCompleted && (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setNoShowConfirmModal(appointment);
                                  setNoShowError("");
                                  setNoShowSuccess("");
                                }}
                                className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
                                title="Mark patient as absent / no-show"
                              >
                                <AlertTriangle className="w-3.5 h-3.5" />
                                <span>Mark as No-Show</span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMarkArrived(appointment.id);
                                }}
                                className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-emerald-50 text-emerald-700 font-semibold text-xs border border-emerald-200 transition-colors cursor-pointer"
                                title="Patient arrived"
                              >
                                Arrived
                              </button>
                            </div>
                          )}

                          <span
                            className={cn(
                              "px-2.5 sm:px-3 py-1 rounded-full text-xs font-bold border whitespace-nowrap",
                              isPast && !isCompleted && !isNoShow
                                ? "bg-rose-50 text-rose-700 border-rose-200"
                                : isEarly
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200/80"
                                : "bg-blue-50 text-blue-700 border-blue-200/80"
                            )}
                          >
                            {formatAppointmentTime(appointment.time)}
                          </span>
                          <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Legend ── */}
          <div className="flex items-center gap-6 text-xs text-gray-500 pt-5 mt-6 border-t border-gray-100 flex-wrap px-1">
            <div className="flex items-center gap-2">
              <span className="w-5 h-1 sm:h-1.5 rounded-full bg-[#c0166a]" />
              <span className="text-[11px] text-gray-600 font-medium">Appointment</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-5 h-1 sm:h-1.5 rounded-full bg-gray-200" />
              <span className="text-[11px] text-gray-500 font-medium">No appointment</span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 xl:col-span-6 bg-white border border-gray-100 rounded-2xl p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <h2 className="font-display font-bold text-gray-900 text-base">Incoming Consultation Requests</h2>
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full bg-magenta-50 text-magenta-700 border border-magenta-200 font-bold shrink-0 whitespace-nowrap inline-flex items-center gap-1 self-start">
              {incomingQueue.length} pending
            </span>
          </div>

          {/* Queue Stage Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-3 pt-1 text-xs no-scrollbar">
            {[
              { key: "all", label: "All", count: incomingQueue.length },
              { key: "needs_doctor", label: "Needs Doctor", count: needsDoctorQueue.length, alert: needsDoctorQueue.length > 0 },
              { key: "in_review", label: "In Review", count: inReviewQueue.length },
              { key: "reschedule_requests", label: "Reschedules", count: rescheduleRequestsQueue.length, alert: rescheduleRequestsQueue.length > 0 },
              { key: "approved", label: "Confirmed", count: approvedQueue.length, highlight: approvedQueue.length > 0 },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setQueueFilter(tab.key as any)}
                className={`px-3 py-1.5 rounded-xl font-semibold shrink-0 transition-all flex items-center gap-1.5 cursor-pointer ${queueFilter === tab.key
                    ? "bg-magenta-600 text-white shadow-xs"
                    : tab.highlight
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                      : tab.alert
                        ? "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
              >
                <span>{tab.label}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${queueFilter === tab.key ? "bg-white/20 text-white" : "bg-white/80 text-gray-700"
                  }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          <div className="space-y-3 max-h-[660px] overflow-y-auto pr-1 no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {displayedQueue.length === 0 && (
              <div className="border border-dashed border-gray-200 rounded-2xl p-8 text-center bg-gray-50/50">
                <Clock className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-xs font-semibold text-gray-600">No requests in this category</p>
                <p className="text-[11px] text-gray-400 mt-1 max-w-xs mx-auto">
                  {queueFilter === "needs_doctor"
                    ? "All consultation requests have been assigned to doctors for review."
                    : queueFilter === "approved"
                      ? "No approved or confirmed appointments yet."
                      : queueFilter === "reschedule_requests"
                        ? "No pending patient reschedule requests to review."
                        : "Incoming consultation requests will appear here."}
                </p>
              </div>
            )}

            {displayedQueue.map((appointment) => {
              const isDoctorDeclined = appointment.doctorStatus === "rejected";
              const isInReview = !isDoctorDeclined && Boolean(appointment.assignedDoctorId) && appointment.doctorStatus === "pending-review";
              const isApproved = !isDoctorDeclined && !isInReview && (
                appointment.doctorStatus === "approved" ||
                appointment.status === "confirmed" ||
                appointment.status === "accepted" ||
                (appointment.status === "scheduled" && appointment.doctorStatus !== "rejected")
              );
              const isUnassigned = !isDoctorDeclined && !isInReview && !isApproved;
              const payBadge = getPaymentBadgeInfo(appointment);

              return (
                <div
                  key={appointment.id}
                  className={`rounded-2xl border p-4 transition-all ${isDoctorDeclined
                      ? "border-red-200 bg-red-50/30"
                      : isApproved
                        ? "border-emerald-200 bg-emerald-50/30"
                        : isInReview
                          ? "border-blue-100 bg-blue-50/20"
                          : "border-amber-100 bg-amber-50/20"
                    }`}
                >
                  <div className="flex items-start gap-3 mb-2.5">
                    <PatientAvatar
                      name={appointment.patientName}
                      photoUrl={appointment.patientAvatar}
                      userId={appointment.userId}
                      className="w-12 h-12"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-sm font-bold text-gray-900 truncate">
                              {appointment.patientName || `Patient #${appointment.id.slice(-4)}`}
                            </p>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10.5px] font-bold shrink-0">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              {payBadge.label}
                            </span>
                          </div>
                          {appointment.patientAge && (
                            <p className="text-[10px] text-gray-400">{appointment.patientAge} years old</p>
                          )}
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <p className="text-[11px] font-semibold text-magenta-600">
                              {appointment.conditionName || "General Consultation"}
                            </p>
                            <span className="text-gray-300">·</span>
                            <span className="text-[10px] font-semibold text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
                              Face-to-Face Consultation
                            </span>
                          </div>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            Requested: {new Date(appointment.createdAt).toLocaleString("en-US", {
                              month: "short",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>

                        {/* Status Badge */}
                        <div className="shrink-0 flex flex-col items-end gap-1">
                          {isDoctorDeclined ? (
                            <span className="text-[10px] px-2.5 py-1 rounded-full font-bold bg-red-100 text-red-800 border border-red-200 flex items-center gap-1">
                              <XCircle className="w-3 h-3 text-red-600" /> Doctor Declined
                            </span>
                          ) : isApproved ? (
                            <span className="text-[10px] px-2.5 py-1 rounded-full font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Confirmed
                            </span>
                          ) : isInReview ? (
                            <span className="text-[10px] px-2.5 py-1 rounded-full font-bold bg-blue-100 text-blue-800 border border-blue-200 flex items-center gap-1">
                              <Stethoscope className="w-3 h-3 text-blue-600" /> In Review
                            </span>
                          ) : (
                            <span className="text-[10px] px-2.5 py-1 rounded-full font-bold bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1">
                              <Clock className="w-3 h-3 text-amber-600" /> Needs Doctor
                            </span>
                          )}
                          {appointment.rescheduleRequested && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-purple-100 text-purple-800 border border-purple-200 flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5" /> Reschedule Req
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Patient Requested Schedule Banner with Queue Badge & Payment Verified Badge */}
                  <div className="mb-2.5 p-2 rounded-xl bg-magenta-50/70 border border-magenta-100 flex items-center justify-between text-xs flex-wrap gap-1.5">
                    <div className="flex items-center gap-1.5 font-bold text-magenta-950">
                      <Calendar className="w-3.5 h-3.5 text-magenta-600" />
                      <span>{appointment.date || "Date pending"} {appointment.batchTime ? `· ${appointment.batchTime} Batch` : appointment.time ? `· ${appointment.time}` : ""}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {isApproved && (
                        appointment.checkInStatus === "arrived" ? (
                          <span className="px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-800 font-bold text-[9px] flex items-center gap-0.5">
                            <span className="w-1 h-1 rounded-full bg-sky-500 inline-block" /> In Lobby
                          </span>
                        ) : appointment.checkInStatus === "in-consultation" ? (
                          <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[9px] flex items-center gap-0.5 animate-pulse">
                            <span className="w-1 h-1 rounded-full bg-emerald-500 inline-block" /> In Room
                          </span>
                        ) : appointment.checkInStatus === "no-show" ? (
                          <span className="px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold text-[9px]">
                            Absent / No-Show
                          </span>
                        ) : null
                      )}
                    </div>
                  </div>

                  {/* Stage Workflow Banners */}
                  {isDoctorDeclined ? (() => {
                    const privilege = getPatientPrivilegeStatus(appointment);
                    return (
                      <div className="mb-2.5 p-2.5 rounded-xl bg-red-100/70 border border-red-200 text-xs text-red-900 flex items-start gap-2">
                        <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="font-bold">Declined by {formatDoctorDisplay(appointment.assignedDoctorName) || "Doctor"}:</p>
                          <p className="text-[11px] text-red-700 italic mt-0.5">
                            "{appointment.doctorNote || "Doctor unavailable for consultation"}"
                          </p>
                          {privilege.isLocked ? (
                            <div className="mt-2 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex items-center justify-between">
                              <span className="flex items-center gap-1 font-semibold">
                                <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                Patient Selection Window Active
                              </span>
                              <span className="font-bold tabular-nums text-amber-800">
                                {privilege.hoursRemaining}h {privilege.minutesRemaining}m left
                              </span>
                            </div>
                          ) : privilege.isWaived ? (
                            <div className="mt-2 px-2.5 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-900 text-[11px] flex items-center gap-1.5 font-semibold">
                              <AlertCircle className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                              Patient requested clinic to manually assign an alternate doctor
                            </div>
                          ) : (
                            <p className="text-[10px] text-red-600 mt-1 font-semibold">
                              &rarr; 24h patient window expired. Clinic reassignment is available.
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })() : isApproved ? (
                    <div className="mb-2.5 p-2.5 rounded-xl bg-emerald-100/70 border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span className="font-medium truncate">
                          <strong>{formatDoctorDisplay(appointment.assignedDoctorName) || "Doctor"} accepted!</strong> Schedule confirmed &amp; finalized.
                        </span>
                      </div>
                    </div>
                  ) : isInReview ? (
                    <div className="mb-2.5 p-2 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-800 flex items-center gap-1.5">
                      <Stethoscope className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      <span className="font-medium">
                        Assigned to <strong>{formatDoctorDisplay(appointment.assignedDoctorName) || "Doctor"}</strong> for pre-consultation review.
                      </span>
                    </div>
                  ) : null}

                  {/* Rule 1: Patient Reschedule Request Banner */}
                  {appointment.rescheduleRequested && (
                    <div className="mb-3 p-3 rounded-xl bg-purple-50/90 border border-purple-200 text-purple-900 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-purple-800 flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-purple-600" /> Patient Reschedule Request
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-200 text-purple-800 font-bold">
                          Review Required
                        </span>
                      </div>
                      <div className="text-xs space-y-1">
                        <p className="text-gray-600">
                          Current Slot: <strong className="text-gray-900">{appointment.date} at {formatAppointmentTime(appointment.time)}</strong>
                        </p>
                        <p className="text-purple-950 font-semibold">
                          Requested Slot: <strong className="text-purple-700">{appointment.rescheduleDate} at {formatAppointmentTime(appointment.rescheduleTime)}</strong>
                        </p>
                        {appointment.rescheduleReason && (
                          <p className="text-[11px] text-purple-800 italic bg-white/70 p-2 rounded-lg border border-purple-100">
                            Reason: "{appointment.rescheduleReason}"
                          </p>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleAcceptPatientReschedule(appointment)}
                          className="py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-2xs cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Accept New Slot
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeclinePatientRescheduleModal({
                              appointmentId: appointment.id,
                              patientName: appointment.patientName || "Patient",
                              requestedDate: appointment.rescheduleDate,
                              requestedTime: appointment.rescheduleTime,
                              currentDate: appointment.date,
                              currentTime: appointment.time,
                              userId: appointment.userId,
                            });
                            setDeclineRescheduleReason("");
                            setDeclineRescheduleError("");
                          }}
                          className="py-2 px-3 rounded-xl border border-red-200 bg-white hover:bg-red-50 text-red-600 text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <X className="w-3.5 h-3.5" /> Decline Request
                        </button>
                      </div>
                    </div>
                  )}

                  {appointment.notes && (
                    <p className="text-[11px] text-gray-600 bg-white/80 border border-gray-100 rounded-lg px-2.5 py-1.5 mb-2.5 line-clamp-2">
                      <strong className="text-gray-700">Patient Note:</strong> {appointment.notes}
                    </p>
                  )}

                  {/* Contextual Action Buttons */}
                  <div className="pt-1">
                    {/* Scenario A: Unassigned -> Assign Doctor */}
                    {isUnassigned && (
                      <div className="space-y-2 w-full">
                        <div className="px-2.5 py-1.5 rounded-xl bg-emerald-50/90 border border-emerald-200/80 flex items-center justify-between text-[11px] text-emerald-900">
                          <span className="flex items-center gap-1.5 font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            Upfront Fee Verified
                          </span>
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                            Verified
                          </span>
                        </div>
                        <div className="flex items-center gap-2 w-full">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDoctorId("");
                              setAssignDoctorModal({
                                appointmentId: appointment.id,
                                patientName: appointment.patientName,
                                targetDate: appointment.date,
                                targetTime: appointment.time,
                                primaryScanId: appointment.primaryScanId,
                                userId: appointment.userId,
                              });
                            }}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-magenta-600 hover:bg-magenta-700 text-white text-xs font-semibold transition-all shadow-xs cursor-pointer"
                          >
                            <Stethoscope className="w-3.5 h-3.5" /> Assign Doctor for Review
                          </button>
                          <button
                            type="button"
                            onClick={() => setViewingPatient(appointment)}
                            className="py-2.5 px-4 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold transition-colors cursor-pointer shrink-0"
                          >
                            Details
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Scenario B: Under Doctor Review -> View Details / Change Doctor */}
                    {isInReview && (
                      <div className="flex items-center gap-2 w-full">
                        <button
                          type="button"
                          onClick={() => setViewingPatient(appointment)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-semibold transition-colors cursor-pointer"
                        >
                          <User className="w-3.5 h-3.5" /> View Details
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDoctorId("");
                            setAssignDoctorModal({
                              appointmentId: appointment.id,
                              patientName: appointment.patientName,
                              isReassign: true,
                              currentDoctorId: appointment.assignedDoctorId,
                              currentDoctorName: appointment.assignedDoctorName,
                              doctorNote: appointment.doctorNote,
                              targetDate: appointment.date,
                              targetTime: appointment.time,
                              primaryScanId: appointment.primaryScanId,
                              userId: appointment.userId,
                            });
                          }}
                          className="py-2.5 px-3.5 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold transition-colors cursor-pointer shrink-0"
                        >
                          Change Doctor
                        </button>
                      </div>
                    )}

                    {/* Scenario C: Doctor Approved -> View Details & Reschedule */}
                    {isApproved && (
                      <div className="flex items-center gap-2 w-full">
                        <button
                          type="button"
                          onClick={() => setViewingPatient(appointment)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold transition-colors cursor-pointer"
                        >
                          <User className="w-3.5 h-3.5" /> View Details
                        </button>
                        {appointment.rescheduleRequested && (
                          <button
                            type="button"
                            onClick={() => setQueueFilter("reschedule_requests")}
                            className="py-2.5 px-3.5 rounded-xl border border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-700 text-xs font-semibold transition-colors cursor-pointer shrink-0"
                          >
                            Review Reschedule
                          </button>
                        )}
                      </div>
                    )}

                    {/* Scenario D: Doctor Declined -> RE-ASSIGN DOCTOR OR DECLINE REQUEST */}
                    {isDoctorDeclined && (() => {
                      const privilege = getPatientPrivilegeStatus(appointment);
                      return (
                        <div className="flex items-center gap-2 w-full">
                          <button
                            type="button"
                            disabled={privilege.isLocked}
                            onClick={() => {
                              if (privilege.isLocked) return;
                              setSelectedDoctorId("");
                              setAssignDoctorModal({
                                appointmentId: appointment.id,
                                patientName: appointment.patientName,
                                isReassign: true,
                                currentDoctorId: appointment.assignedDoctorId,
                                currentDoctorName: appointment.assignedDoctorName,
                                doctorNote: appointment.doctorNote,
                                targetDate: appointment.date,
                                targetTime: appointment.time,
                                primaryScanId: appointment.primaryScanId,
                                userId: appointment.userId,
                              });
                            }}
                            title={
                              privilege.isLocked
                                ? `Patient has an exclusive 24-hour privilege window to select an alternate doctor (${privilege.hoursRemaining}h ${privilege.minutesRemaining}m remaining). Clinic cannot reassign until this window expires or the patient requests clinic assistance.`
                                : undefined
                            }
                            className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-semibold transition-all shadow-xs ${
                              privilege.isLocked
                                ? "bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed"
                                : "bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                            }`}
                          >
                            {privilege.isLocked ? (
                              <>
                                <Lock className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                <span className="truncate">Locked ({privilege.hoursRemaining}h {privilege.minutesRemaining}m left)</span>
                              </>
                            ) : (
                              <>
                                <Stethoscope className="w-3.5 h-3.5" />
                                <span>Re-assign Doctor</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectModal({
                                appointmentId: appointment.id,
                                patientName: appointment.patientName || "Patient",
                                clinicName: appointment.clinicName || clinicName,
                                patientEmail: appointment.patientEmail,
                              });
                              setRejectReason(appointment.doctorNote ? `Declined by doctor: ${appointment.doctorNote}` : "Doctor unavailable.");
                              setSelectedPresetReason("");
                              setRejectError("");
                            }}
                            className="py-2.5 px-3 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold transition-colors cursor-pointer shrink-0"
                          >
                            Decline Request
                          </button>
                          <button
                            type="button"
                            onClick={() => setViewingPatient(appointment)}
                            className="py-2.5 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold transition-colors cursor-pointer shrink-0"
                          >
                            Details
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 rounded-xl bg-gray-50 border border-gray-100 p-3 text-[11px] text-gray-600">
            <p className="font-bold text-gray-900 mb-1">Appointment Approval Workflow</p>
            <p>1. Assign doctor for review &rarr; 2. Attending doctor decides (Approve/Decline) &rarr; 3. If approved, clinic finalizes schedule date &amp; time. If declined, clinic re-assigns or declines request.</p>
          </div>
        </div>
      </div>      {/* ── Day Detail Modal ─────────────────────────────────── */}
      <ModalPortal isOpen={Boolean(dayDetailDate)}>
        {dayDetailDate && (() => {
        const dayModalAll = appointmentsByDate[dayDetailDate] || [];
        const dayModalCompletedCount = dayModalAll.filter(
          (a) => a.status === "completed" || a.checkInStatus === "completed"
        ).length;
        const dayModalActionable = sortAppointmentsByDailyQueue(
          dayModalAll.filter(
            (a) =>
              a.status !== "completed" &&
              a.checkInStatus !== "completed" &&
              a.status !== "cancelled" &&
              a.status !== "rejected" &&
              a.checkInStatus !== "no-show"
          )
        );

        return (
          <div className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setDayDetailDate(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.2 }}
              className="relative z-[9999] w-full max-w-md bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden text-left"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-gray-100 bg-white flex items-start justify-between">
                <div>
                  <h3 className="text-base font-bold text-gray-900 leading-tight">
                    {new Date(dayDetailDate + "T00:00:00").toLocaleDateString("en-US", {
                      weekday: "long", month: "long", day: "numeric", year: "numeric",
                    })}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5 font-medium">
                    {dayModalActionable.length} patient(s) scheduled
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDayDetailDate(null)}
                  className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                  title="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 max-h-[62vh] overflow-y-auto space-y-3.5 no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {dayModalActionable.length === 0 ? (
                  <div className="border border-dashed border-gray-200 rounded-2xl p-7 text-center bg-gray-50/50">
                    {dayModalCompletedCount > 0 ? (
                      <>
                        <div className="w-10 h-10 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto mb-2 text-emerald-600">
                          <CheckCircle2 className="w-5 h-5" />
                        </div>
                        <p className="text-xs font-bold text-gray-800">
                          All scheduled visits for this date are completed
                        </p>
                        <p className="text-[11px] text-gray-500 mt-1 max-w-xs mx-auto leading-relaxed">
                          {dayModalCompletedCount} completed appointment{dayModalCompletedCount > 1 ? "s" : ""} on record. Completed visits are preserved in patient records and appointment history.
                        </p>
                      </>
                    ) : (
                      <>
                        <Calendar className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                        <p className="text-xs font-semibold text-gray-500">No actionable patients scheduled for this date.</p>
                      </>
                    )}
                  </div>
                ) : (
                  dayModalActionable.map((appt) => {
                    const isOverdue = isAppointmentPastDue(appt);
                    return (
                      <div
                        key={appt.id}
                        className={`rounded-2xl border transition-all p-4 space-y-3 shadow-2xs ${isOverdue
                            ? "bg-[#fff5f5] border-rose-200/90"
                            : "bg-white border-gray-100"
                          }`}
                      >
                        {/* Patient Info Row */}
                        <div className="flex items-center gap-3">
                          <PatientAvatar
                            name={appt.patientName}
                            photoUrl={appt.patientAvatar}
                            userId={appt.userId}
                            className="w-11 h-11"
                          />

                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-bold text-gray-900 truncate">
                              {appt.patientName || "Unknown Patient"}
                            </h4>
                            {appt.patientAge ? (
                              <p className="text-xs text-gray-500 font-normal mt-0.5">
                                {appt.patientAge} years old
                              </p>
                            ) : (
                              <p className="text-xs text-gray-400 font-normal mt-0.5">
                                Patient
                              </p>
                            )}
                          </div>

                          <div className="shrink-0 flex items-center gap-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-white text-gray-700 border border-gray-200 shadow-2xs">
                              <Clock className="w-3.5 h-3.5 text-gray-400" />
                              {formatAppointmentTime(appt.time)}
                            </span>
                          </div>
                        </div>

                        {/* Overdue Banner if scheduled time has passed */}
                        {isOverdue && (
                          <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-rose-100/60 border border-rose-200/80 text-xs">
                            <div className="flex items-center gap-1.5 text-rose-700 font-medium min-w-0">
                              <Clock className="w-3.5 h-3.5 shrink-0 text-rose-600" />
                              <span className="truncate">Due Date Past — Patient did not attend</span>
                              <span
                                className="w-3.5 h-3.5 rounded-full border border-rose-400 text-rose-700 flex items-center justify-center text-[10px] font-bold shrink-0 cursor-help"
                                title="Scheduled consultation date/time has passed and attendance needs confirmation."
                              >
                                i
                              </span>
                            </div>
                            <span className="shrink-0 text-xs px-2.5 py-0.5 rounded-full font-semibold border border-rose-300 text-rose-700 bg-rose-50">
                              missed
                            </span>
                          </div>
                        )}

                        {/* Doctor & Status Row */}
                        <div className="flex items-center justify-between text-xs pt-0.5">
                          <div className="flex items-center gap-1.5 min-w-0 text-gray-700">
                            <Stethoscope className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <span className="font-medium truncate">
                              {appt.assignedDoctorName || <span className="text-gray-400 italic">No doctor assigned</span>}
                            </span>
                          </div>
                          {!isOverdue && (
                            <span className="text-xs px-2.5 py-0.5 rounded-full font-medium border bg-emerald-50/60 text-emerald-700 border-emerald-200">
                              {appt.status === "scheduled" || appt.status === "confirmed" ? "scheduled" : appt.status}
                            </span>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="space-y-2 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              setDayDetailDate(null);
                              setViewingPatient(appt);
                            }}
                            className="w-full py-2.5 rounded-xl bg-[#7a123a] hover:bg-[#600e2e] text-white text-xs font-semibold transition-colors shadow-xs cursor-pointer text-center"
                          >
                            View Appointment Details
                          </button>

                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setDayDetailDate(null);
                                if (appt.rescheduleRequested) {
                                  setQueueFilter("reschedule_requests");
                                } else {
                                  setRequestPatientRescheduleModal({
                                    appointmentId: appt.id,
                                    patientName: appt.patientName || "Patient",
                                    currentDate: appt.date,
                                    currentTime: appt.time,
                                    userId: appt.userId,
                                  });
                                  setReschedulePromptReason("");
                                  setReschedulePromptError("");
                                }
                              }}
                              className="py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold transition-colors cursor-pointer text-center"
                            >
                              {appt.rescheduleRequested ? "Review Reschedule" : "Request Reschedule"}
                            </button>

                            {isOverdue ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setNoShowConfirmModal(appt);
                                  setNoShowError("");
                                  setNoShowSuccess("");
                                }}
                                className="py-2 rounded-xl border border-rose-300 bg-white hover:bg-rose-50 text-rose-700 text-xs font-semibold transition-colors cursor-pointer text-center"
                              >
                                Mark as No-Show
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setRejectModal({
                                    appointmentId: appt.id,
                                    patientName: appt.patientName || "Patient",
                                    clinicName: appt.clinicName || clinicName,
                                    patientEmail: appt.patientEmail,
                                    date: appt.date,
                                    time: appt.time,
                                  });
                                  setRejectReason("");
                                  setSelectedPresetReason("");
                                  setRejectError("");
                                  setDayDetailDate(null);
                                }}
                                className="py-2 rounded-xl border border-rose-200 bg-white hover:bg-rose-50 text-rose-600 text-xs font-semibold transition-colors cursor-pointer text-center"
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Footer */}
              <div className="px-6 pb-5 pt-3 border-t border-gray-100 bg-white">
                <button
                  type="button"
                  onClick={() => setDayDetailDate(null)}
                  className="w-full py-2.5 rounded-full border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        );
      })()}
      </ModalPortal>

      {/* ── No-Show Confirmation Modal ───────────────────────── */}
      <ModalPortal isOpen={Boolean(noShowConfirmModal)}>
        {noShowConfirmModal && (
          <div className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative z-[9999] w-full max-w-md bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden text-left"
              onClick={(e) => e.stopPropagation()}
            >
            <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900 leading-tight">
                    Confirm Patient No-Show
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Attendance review confirmation
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!markingNoShow) {
                    setNoShowConfirmModal(null);
                    setNoShowError("");
                  }
                }}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Appointment Details Summary */}
              <div className="rounded-2xl border border-gray-200/80 bg-gray-50/70 p-4 space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500 font-medium">Patient:</span>
                  <span className="font-bold text-gray-900">
                    {noShowConfirmModal.patientName || "Patient"}
                    {noShowConfirmModal.patientAge ? ` (${noShowConfirmModal.patientAge} years old)` : ""}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500 font-medium">Scheduled Date:</span>
                  <span className="font-semibold text-gray-800">
                    {noShowConfirmModal.date}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500 font-medium">Scheduled Time:</span>
                  <span className="font-semibold text-gray-800">
                    {formatAppointmentTime(noShowConfirmModal.time)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500 font-medium">Assigned Doctor:</span>
                  <span className="font-semibold text-gray-800">
                    {noShowConfirmModal.assignedDoctorName || "Unassigned"}
                  </span>
                </div>
              </div>

              {/* Consequence Explanation Banner */}
              <div className="p-3.5 rounded-2xl bg-rose-50/70 border border-rose-200/70 text-xs text-rose-900 space-y-1">
                <p className="font-bold flex items-center gap-1.5 text-rose-800">
                  <Info className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  Attendance Confirmation Notice
                </p>
                <p className="text-[11px] text-rose-700 leading-relaxed">
                  This records that the patient was absent and did not attend their consultation. Once finalized, ordinary appointment actions (such as rescheduling or conducting visit) will be disabled.
                </p>
              </div>

              {noShowError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
                  {noShowError}
                </div>
              )}

              {noShowSuccess && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 font-medium flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  {noShowSuccess}
                </div>
              )}
            </div>

            <div className="px-6 pb-6 pt-2 border-t border-gray-100 flex items-center justify-end gap-3 bg-gray-50/50">
              <button
                type="button"
                disabled={markingNoShow}
                onClick={() => {
                  setNoShowConfirmModal(null);
                  setNoShowError("");
                }}
                className="px-4 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={markingNoShow || !!noShowSuccess}
                onClick={handleConfirmNoShow}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-all shadow-xs cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {markingNoShow ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Finalizing...
                  </>
                ) : (
                  "Confirm No-Show"
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
      </ModalPortal>

      {/* ── Patient Details Review Modal ─────────────────────── */}
      <ModalPortal isOpen={Boolean(viewingPatient)}>
        {viewingPatient && (
          <div className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.2 }}
              className="relative z-[9999] w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[88vh] text-left"
            >
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 bg-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <PatientAvatar
                  name={viewingPatient.patientName}
                  photoUrl={viewingPatient.patientAvatar}
                  userId={viewingPatient.userId}
                  className="w-11 h-11"
                />
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-base font-bold text-gray-900 leading-tight">
                      {viewingPatient.patientName || "Unknown Patient"}
                    </p>
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                      <MapPin className="w-2.5 h-2.5 text-gray-400" /> Face-to-Face
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" /> {getPaymentBadgeInfo(viewingPatient).label}
                    </span>
                  </div>
                  {viewingPatient.patientAge ? (
                    <p className="text-xs text-gray-500 mt-0.5">{viewingPatient.patientAge} years old</p>
                  ) : (
                    <p className="text-xs text-gray-400 mt-0.5">Appointment Request</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingPatient(null)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4 overflow-y-auto no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {/* Doctor Review Status Summary */}
              {viewingPatient.assignedDoctorName && (
                <div className={`p-3 rounded-2xl border ${viewingPatient.doctorStatus === "approved"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                    : viewingPatient.doctorStatus === "rejected"
                      ? "bg-red-50 border-red-200 text-red-900"
                      : "bg-blue-50 border-blue-200 text-blue-900"
                  }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider">Attending Doctor</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${viewingPatient.doctorStatus === "approved"
                        ? "bg-emerald-200 text-emerald-800"
                        : viewingPatient.doctorStatus === "rejected"
                          ? "bg-red-200 text-red-800"
                          : "bg-blue-200 text-blue-800"
                      }`}>
                      {viewingPatient.doctorStatus === "approved"
                        ? "Approved"
                        : viewingPatient.doctorStatus === "rejected"
                          ? "Declined"
                          : "Reviewing"}
                    </span>
                  </div>
                  <p className="text-xs font-bold mt-1">Dr. {viewingPatient.assignedDoctorName.replace(/^dr\.\s*/i, "")}</p>
                  {viewingPatient.doctorNote && (
                    <p className="text-[11px] mt-1 italic">
                      Note: "{viewingPatient.doctorNote}"
                    </p>
                  )}
                </div>
              )}

              {/* Personal Information */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Personal Information</p>
                <div className="space-y-1.5 bg-gray-50 border border-gray-100 rounded-2xl p-3.5">
                  {(
                    [
                      { label: "Full Name", value: viewingPatient.patientName },
                      { label: "Email", value: viewingPatient.patientEmail },
                      { label: "Address", value: viewingPatient.patientAddress },
                      { label: "Contact", value: viewingPatient.patientContact },
                      {
                        label: "Emergency Contact",
                        value: viewingPatient.emergencyContactName
                          ? `${viewingPatient.emergencyContactName} ${viewingPatient.emergencyRelationship ? `(${viewingPatient.emergencyRelationship})` : ""} - ${viewingPatient.emergencyContactPhone || ""}`
                          : undefined,
                      },
                    ] as { label: string; value?: string }[]
                  ).map(({ label, value }) => (
                    <div key={label} className="grid grid-cols-[120px_1fr] items-center text-xs">
                      <span className="font-semibold text-gray-400">{label}:</span>
                      <span className="text-gray-900 font-medium truncate">{value || <span className="text-gray-300 italic">—</span>}</span>
                    </div>
                  ))}
                  {viewingPatient.date && (
                    <div className="grid grid-cols-[120px_1fr] items-start text-xs pt-1.5 border-t border-gray-200/60 mt-1">
                      <span className="font-semibold text-green-700">Schedule:</span>
                      <div className="text-gray-900 font-semibold">
                        {new Date(`${viewingPatient.date.includes("T") ? viewingPatient.date.split("T")[0] : viewingPatient.date}T${viewingPatient.time || "00:00"}`).toLocaleString("en-US", {
                          weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
                        })}
                      </div>
                    </div>
                  )}
                  {viewingPatient.checkInStatus === "no-show" ? (
                    <div className="mt-2.5 p-2.5 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-rose-800 text-xs font-bold">
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                      <span>Recorded as Absent / No-Show</span>
                    </div>
                  ) : isAppointmentPastDue(viewingPatient) && viewingPatient.status !== "completed" && viewingPatient.checkInStatus !== "completed" ? (
                    <div className="mt-2.5 p-2.5 rounded-xl bg-rose-50/90 border border-rose-200 flex items-start gap-2.5 text-xs text-rose-900">
                      <Clock className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">Consultation Date &amp; Time Has Passed</p>
                        <p className="text-[11px] text-rose-700 mt-0.5">
                          Patient did not attend during the scheduled time window. You can mark this appointment as No-Show to notify the patient and update records.
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Uploaded Skin Photo */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Uploaded Skin Photo</p>
                {viewingPatient.skinPhotoUrl ? (
                  <div className="rounded-2xl border border-gray-100 bg-gray-50 overflow-hidden">
                    <LazySkinPhoto
                      pathOrUrl={viewingPatient.skinPhotoUrl}
                      alt="Patient skin photo"
                      className="w-full max-h-48 object-contain"
                    />
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 px-4 py-5 text-center text-xs text-gray-400 italic">
                    No skin photo uploaded.
                  </div>
                )}
              </div>

              {/* AI Analysis Result */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">AI Scan Result</p>
                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-500">Condition:</span>
                    <span className="font-bold text-gray-900">
                      {viewingPatient.aiConditionName || viewingPatient.conditionName || "General Consultation"}
                    </span>
                  </div>
                  {viewingPatient.aiConfidence !== undefined && (
                    <div className="flex items-center justify-between pt-1 border-t border-gray-200/60">
                      <span className="font-semibold text-gray-500">Confidence:</span>
                      <span className="font-bold text-magenta-700">{formatConfidencePercent(viewingPatient.aiConfidence)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Additional Notes */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Patient Notes</p>
                <div className="text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded-2xl p-3.5 leading-relaxed">
                  {viewingPatient.notes || <span className="text-gray-400 italic">No additional notes provided.</span>}
                </div>
              </div>

              {/* Rule 1: Reschedule Request Card if present */}
              {viewingPatient.rescheduleRequested && (
                <div className="p-3.5 rounded-2xl bg-purple-50/90 border border-purple-200 text-purple-900 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-purple-800 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-purple-600" /> Patient Requested Reschedule
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-200 text-purple-800 font-bold">
                      Pending Review
                    </span>
                  </div>
                  <div className="text-xs space-y-1">
                    <p className="text-gray-600">
                      Current Reserved: <strong className="text-gray-900">{viewingPatient.date} at {formatAppointmentTime(viewingPatient.time)}</strong>
                    </p>
                    <p className="text-purple-950 font-semibold">
                      Proposed Slot: <strong className="text-purple-700">{viewingPatient.rescheduleDate} at {formatAppointmentTime(viewingPatient.rescheduleTime)}</strong>
                    </p>
                    {viewingPatient.rescheduleReason && (
                      <p className="text-[11px] text-purple-800 italic bg-white/70 p-2 rounded-lg border border-purple-100">
                        Reason: "{viewingPatient.rescheduleReason}"
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        const appt = viewingPatient;
                        setViewingPatient(null);
                        handleAcceptPatientReschedule(appt);
                      }}
                      className="py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-2xs cursor-pointer flex items-center justify-center gap-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Accept New Slot
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const appt = viewingPatient;
                        setViewingPatient(null);
                        setDeclinePatientRescheduleModal({
                          appointmentId: appt.id,
                          patientName: appt.patientName || "Patient",
                          requestedDate: appt.rescheduleDate,
                          requestedTime: appt.rescheduleTime,
                          currentDate: appt.date,
                          currentTime: appt.time,
                          userId: appt.userId,
                        });
                        setDeclineRescheduleReason("");
                        setDeclineRescheduleError("");
                      }}
                      className="py-2 px-3 rounded-xl border border-red-200 bg-white hover:bg-red-50 text-red-600 text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-1"
                    >
                      <X className="w-3.5 h-3.5" /> Decline Request
                    </button>
                  </div>
                </div>
              )}

              {/* Rule 5: Traceable Appointment History & Audit Trail */}
              {viewingPatient.appointmentHistory && viewingPatient.appointmentHistory.length > 0 && (
                <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-100">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-700 mb-2.5">
                    <History className="w-4 h-4 text-magenta-600" />
                    <span>Appointment History &amp; Audit Trail</span>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1 no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                    {viewingPatient.appointmentHistory.map((item, idx) => (
                      <div key={idx} className="p-2.5 rounded-xl bg-white border border-gray-100 text-xs shadow-2xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-gray-900 capitalize">
                            {item.action.replace(/_/g, " ")}
                          </span>
                          <span className="text-[10px] text-gray-400 shrink-0">
                            {new Date(item.timestamp).toLocaleDateString("en-PH", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        {item.actor && (
                          <p className="text-[11px] text-gray-500 mt-0.5">By: <strong className="text-gray-700 capitalize">{item.actor}</strong></p>
                        )}
                        {item.previousDoctorName && item.newDoctorName && (
                          <p className="text-[11px] text-blue-700 mt-0.5 font-medium">
                            Reassigned from {item.previousDoctorName} &rarr; {item.newDoctorName}
                          </p>
                        )}
                        {item.newDate && item.newTime && (
                          <p className="text-[11px] text-purple-700 mt-0.5 font-medium">
                            Target slot: {item.newDate} at {item.newTime}
                          </p>
                        )}
                        {item.reason && (
                          <p className="text-[11px] text-gray-600 italic mt-0.5">
                            "{item.reason}"
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Submission timestamp */}
              <p className="text-[11px] text-gray-400 pt-1">
                Requested: {new Date(viewingPatient.createdAt).toLocaleString("en-US", {
                  month: "short", day: "numeric", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })}
              </p>
            </div>

            {/* Contextual Footer actions */}
            <div className="px-6 pb-5 pt-3 border-t border-gray-100 bg-white">
              {viewingPatient.checkInStatus === "no-show" ? (
                <button
                  type="button"
                  onClick={() => setViewingPatient(null)}
                  className="w-full py-3 rounded-full border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  Close
                </button>
              ) : viewingPatient.status === "scheduled" ? (
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <button
                    type="button"
                    onClick={() => setViewingPatient(null)}
                    className="flex-1 py-3 rounded-full border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
                  >
                    Close
                  </button>
                  {isAppointmentPastDue(viewingPatient) && viewingPatient.checkInStatus !== "completed" && (
                    <button
                      type="button"
                      onClick={() => {
                        const target = viewingPatient;
                        setViewingPatient(null);
                        setNoShowConfirmModal(target);
                        setNoShowError("");
                        setNoShowSuccess("");
                      }}
                      className="flex-1 py-3 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Mark as No-Show</span>
                    </button>
                  )}
                  {viewingPatient.rescheduleRequested && (
                    <button
                      type="button"
                      onClick={() => {
                        setViewingPatient(null);
                        setQueueFilter("reschedule_requests");
                      }}
                      className="flex-1 py-3 rounded-full bg-magenta-600 hover:bg-magenta-700 text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer"
                    >
                      Review Reschedule
                    </button>
                  )}
                </div>
              ) : viewingPatient.doctorStatus === "approved" ? (
                <button
                  type="button"
                  onClick={() => setViewingPatient(null)}
                  className="w-full py-3 rounded-full border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  Close
                </button>
              ) : viewingPatient.doctorStatus === "rejected" ? (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setRejectModal({
                        appointmentId: viewingPatient.id,
                        patientName: viewingPatient.patientName || "Patient",
                        clinicName: viewingPatient.clinicName || clinicName,
                        patientEmail: viewingPatient.patientEmail,
                      });
                      setRejectReason(viewingPatient.doctorNote ? `Doctor declined: ${viewingPatient.doctorNote}` : "Declined by clinic.");
                      setSelectedPresetReason("");
                      setRejectError("");
                      setViewingPatient(null);
                    }}
                    className="py-3 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer"
                  >
                    Confirm Decline
                  </button>
                  {(() => {
                    const privilege = viewingPatient ? getPatientPrivilegeStatus(viewingPatient) : null;
                    const isLocked = Boolean(privilege?.isLocked);
                    return (
                      <button
                        type="button"
                        disabled={isLocked}
                        onClick={() => {
                          const apptToReassign = viewingPatient;
                          setViewingPatient(null);
                          setSelectedDoctorId("");
                          setAssignDoctorModal({
                            appointmentId: apptToReassign.id,
                            patientName: apptToReassign.patientName,
                            isReassign: true,
                            currentDoctorId: apptToReassign.assignedDoctorId,
                            currentDoctorName: apptToReassign.assignedDoctorName,
                            doctorNote: apptToReassign.doctorNote,
                            targetDate: apptToReassign.date,
                            targetTime: apptToReassign.time,
                            primaryScanId: apptToReassign.primaryScanId,
                            userId: apptToReassign.userId,
                          });
                        }}
                        title={
                          isLocked && privilege
                            ? `Patient has an exclusive 24-hour privilege window (${privilege.hoursRemaining}h ${privilege.minutesRemaining}m remaining).`
                            : undefined
                        }
                        className={`py-3 rounded-full text-xs font-semibold transition-colors shadow-sm flex items-center justify-center gap-1.5 ${
                          isLocked
                            ? "bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed"
                            : "bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                        }`}
                      >
                        {isLocked ? (
                          <>
                            <Lock className="w-3.5 h-3.5 text-gray-400" />
                            <span>Re-assign (Patient Privilege Active)</span>
                          </>
                        ) : (
                          <span>Re-assign Doctor</span>
                        )}
                      </button>
                    );
                  })()}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setViewingPatient(null)}
                  className="w-full py-3 rounded-full border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  Close
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}
      </ModalPortal>

      {/* ── Finalize Schedule Modal (After Doctor Approval) ─────────────────────── */}
      <ModalPortal isOpen={Boolean(finalizeScheduleModal)}>
        {finalizeScheduleModal && (
          <div className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.2 }}
              className="relative z-[9999] w-full max-w-md bg-white rounded-3xl border border-gray-100 shadow-2xl p-6 text-left"
            >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-600" />
                {finalizeScheduleModal.isReschedule ? "Reschedule Consultation" : "Finalize Consultation Schedule"}
              </h3>
              <button
                type="button"
                onClick={() => setFinalizeScheduleModal(null)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Patient: <strong className="text-gray-800">{finalizeScheduleModal.patientName}</strong>
              {finalizeScheduleModal.assignedDoctorName && (
                <span> &bull; Attending: <strong className="text-gray-800">Dr. {finalizeScheduleModal.assignedDoctorName.replace(/^dr\.\s*/i, "")}</strong></span>
              )}
            </p>

            {scheduleError && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-600 font-medium">
                {scheduleError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Consultation Date</label>
                <input
                  type="date"
                  value={finalizeScheduleModal.date}
                  onChange={(e) =>
                    setFinalizeScheduleModal((prev) =>
                      prev ? { ...prev, date: e.target.value } : prev
                    )
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 transition-all bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Consultation Time</label>
                <input
                  type="time"
                  value={finalizeScheduleModal.time}
                  onChange={(e) =>
                    setFinalizeScheduleModal((prev) =>
                      prev ? { ...prev, time: e.target.value } : prev
                    )
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 transition-all bg-white"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  Operating hours: {clinicSettings.openTime} &ndash; {clinicSettings.closeTime}
                </p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setFinalizeScheduleModal(null)}
                className="py-3 rounded-full border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmFinalizeSchedule}
                className="py-3 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer"
              >
                Confirm &amp; Schedule
              </button>
            </div>
          </motion.div>
        </div>
      )}
      </ModalPortal>

      {/* ── Assign Doctor for Review Modal (also used for Re-assigning) ─────────────────────── */}
      <ModalPortal isOpen={Boolean(assignDoctorModal)}>
        {assignDoctorModal && (
          <div className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.2 }}
              className="relative z-[9999] w-full max-w-md bg-white rounded-3xl border border-gray-100 shadow-2xl p-6 text-left"
            >
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-gray-900 text-base flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-magenta-600" />
                {assignDoctorModal.isReassign ? "Re-assign Doctor" : "Assign Doctor for Review"}
              </h3>
              <button
                type="button"
                onClick={() => { setAssignDoctorModal(null); setSelectedDoctorId(""); setAssignError(""); }}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              {assignDoctorModal.isReassign
                ? `Reassign to an available doctor in your clinic at the original consultation schedule.`
                : `Select a doctor to review this patient's case and approve the consultation.`}
            </p>

            {/* Upfront Payment Verification Banner */}
            <div className="mb-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-semibold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Upfront Consultation Fee Verified (₱{clinicFee.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>
              </div>
              <span className="text-[10px] text-emerald-700 bg-emerald-100/90 px-2 py-0.5 rounded-full font-bold">
                Paid
              </span>
            </div>

            {/* Original Appointment Slot Reminder */}
            {assignDoctorModal.targetDate && (
              <div className="mb-3 p-2.5 rounded-xl bg-purple-50 border border-purple-200 text-xs text-purple-900 flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-medium">
                  <Calendar className="w-3.5 h-3.5 text-purple-600" />
                  <span>Original Slot: <strong>{assignDoctorModal.targetDate} at {formatAppointmentTime(assignDoctorModal.targetTime)}</strong></span>
                </div>
                <span className="text-[10px] text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full font-bold">Slot Preserved</span>
              </div>
            )}

            {assignDoctorModal.doctorNote && (
              <div className="mb-3 p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
                <strong>Previous Doctor's Note:</strong> "{assignDoctorModal.doctorNote}"
              </div>
            )}

            {assignError && (
              <div className="mb-3 p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-600 font-medium">
                {assignError}
              </div>
            )}

            {/* Doctors list or No Doctor Available alert */}
            {assignDoctorModal.isReassign && reassignAvailability.availableDoctors.length === 0 ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-center my-3">
                <AlertTriangle className="w-7 h-7 text-amber-600 mx-auto mb-2" />
                <p className="text-xs font-bold text-amber-900">No Doctor Available for This Slot</p>
                <p className="text-[11px] text-amber-700 mt-1 leading-relaxed">
                  None of the registered clinic dermatologists have an open shift or available capacity for <strong>{assignDoctorModal.targetDate} at {formatAppointmentTime(assignDoctorModal.targetTime)}</strong>.
                </p>
                <p className="text-[11px] text-gray-600 mt-2">
                  Per DermAI policy, the clinic cannot automatically reschedule the patient. Please notify the patient so they can select a new schedule.
                </p>
                <button
                  type="button"
                  onClick={handleNotifyPatientNoDoctorAvailable}
                  className="mt-3.5 w-full py-2.5 px-3 rounded-xl bg-magenta-600 hover:bg-magenta-700 text-white text-xs font-bold transition shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" /> Notify Patient to Select New Schedule
                </button>
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1 no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {clinicDoctors.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-center">
                    <p className="text-xs text-gray-500">No doctors registered yet.</p>
                    <Link
                      to="/clinic/doctors"
                      className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-magenta-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-magenta-700 transition-colors shadow-xs"
                    >
                      <Stethoscope className="w-3.5 h-3.5" /> Add Doctor
                    </Link>
                  </div>
                ) : assignDoctorModal.isReassign ? (
                  <>
                    {/* Available Doctors */}
                    {reassignAvailability.availableDoctors.map(({ doctor }) => (
                      <button
                        key={doctor.id}
                        type="button"
                        onClick={() => setSelectedDoctorId(doctor.id)}
                        className={`w-full text-left px-3.5 py-2.5 rounded-2xl border text-xs transition-colors cursor-pointer flex items-center gap-3 ${selectedDoctorId === doctor.id
                          ? "border-magenta-500 bg-magenta-50/50 text-magenta-900 ring-2 ring-magenta-500/20 shadow-xs"
                          : "border-gray-200 hover:border-gray-300 bg-white"
                          }`}
                      >
                        <DoctorAvatar
                          doctorId={doctor.id}
                          doctor={doctor}
                          name={doctor.name}
                          className="w-9 h-9 rounded-xl border border-magenta-200 shrink-0 font-bold text-xs"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <p className="font-bold text-gray-900 truncate">{doctor.name}</p>
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 shrink-0">
                              Available
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-500 mt-0.5 truncate">{doctor.specialization}</p>
                        </div>
                      </button>
                    ))}

                    {/* Unavailable Doctors */}
                    {reassignAvailability.unavailableDoctors.map(({ doctor, reason }) => (
                      <div
                        key={doctor.id}
                        className="w-full text-left px-3.5 py-2 rounded-2xl border border-gray-100 bg-gray-50/60 text-xs opacity-60 flex items-center gap-3"
                      >
                        <DoctorAvatar
                          doctorId={doctor.id}
                          doctor={doctor}
                          name={doctor.name}
                          className="w-9 h-9 rounded-xl border border-gray-200 shrink-0 font-bold text-xs opacity-60"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <p className="font-semibold text-gray-700 truncate">{doctor.name}</p>
                            <span className="text-[9px] px-1.5 py-0.5 rounded-md font-semibold bg-gray-200 text-gray-600 shrink-0 truncate max-w-[150px]">
                              {reason}
                            </span>
                          </div>
                          <p className="text-[10px] text-gray-400 mt-0.5 truncate">{doctor.specialization}</p>
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  clinicDoctors.map((doc) => (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => setSelectedDoctorId(doc.id)}
                      className={`w-full text-left px-3.5 py-2.5 rounded-2xl border text-xs transition-colors cursor-pointer flex items-center gap-3 ${selectedDoctorId === doc.id
                        ? "border-magenta-500 bg-magenta-50/50 text-magenta-900 ring-2 ring-magenta-500/20 shadow-xs"
                        : "border-gray-200 hover:border-gray-300 bg-white"
                        }`}
                    >
                      <DoctorAvatar
                        doctorId={doc.id}
                        doctor={doc}
                        name={doc.name}
                        className="w-9 h-9 rounded-xl border border-magenta-200 shrink-0 font-bold text-xs"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-gray-900 truncate">{doc.name}</p>
                        <p className="text-[11px] text-gray-500 mt-0.5 truncate">{doc.specialization}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => { setAssignDoctorModal(null); setSelectedDoctorId(""); setAssignError(""); }}
                className="py-2.5 rounded-full border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDoctorAssignment}
                disabled={!selectedDoctorId}
                className="py-2.5 rounded-full bg-magenta-600 text-white text-xs font-semibold hover:bg-magenta-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-xs cursor-pointer"
              >
                {assignDoctorModal.isReassign ? "Confirm Reassignment" : "Assign for Review"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
      </ModalPortal>

      {/* ── Request Patient to Reschedule Modal (Clinic permissions: cannot change date/time unilaterally) ── */}
      <ModalPortal isOpen={Boolean(requestPatientRescheduleModal)}>
        {requestPatientRescheduleModal && (
          <div className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.2 }}
              className="relative z-[9999] w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 border border-gray-100 text-left"
            >
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-gray-900 text-base flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-magenta-600" />
                  Request Patient to Reschedule
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Patient: <span className="font-semibold text-gray-800">{requestPatientRescheduleModal.patientName}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRequestPatientRescheduleModal(null);
                  setReschedulePromptReason("");
                  setReschedulePromptError("");
                }}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-3.5 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed">
              <strong>DermAI Scheduling Policy:</strong> The clinic cannot unilaterally change a patient's date or time. Submitting this will notify the patient to select a new available date and time.
            </div>

            <div className="mb-3 text-xs text-gray-600">
              Current schedule: <strong className="text-gray-900">{requestPatientRescheduleModal.currentDate} at {formatAppointmentTime(requestPatientRescheduleModal.currentTime)}</strong>
            </div>

            {reschedulePromptError && (
              <div className="mb-3 p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-600 font-medium">
                {reschedulePromptError}
              </div>
            )}

            {/* Presets */}
            <div className="mb-3">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                Quick Reason Suggestions
              </label>
              <div className="space-y-1">
                {[
                  "Attending doctor on emergency leave for this day",
                  "Clinic undergoing facility maintenance on this date",
                  "Doctor shift schedule adjusted by clinic management",
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setReschedulePromptReason(preset);
                      setReschedulePromptError("");
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-xl text-xs transition-colors border cursor-pointer ${reschedulePromptReason === preset
                      ? "bg-magenta-50 border-magenta-200 text-magenta-800 font-semibold"
                      : "bg-gray-50 border-gray-100 text-gray-600 hover:bg-gray-100"
                      }`}
                  >
                    • {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Note Textarea */}
            <div className="mb-5">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                Note to Patient (Required)
              </label>
              <textarea
                value={reschedulePromptReason}
                onChange={(e) => {
                  setReschedulePromptReason(e.target.value);
                  setReschedulePromptError("");
                }}
                rows={3}
                placeholder="Explain why the patient should choose a new schedule..."
                className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-gray-200 text-gray-900 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 bg-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setRequestPatientRescheduleModal(null);
                  setReschedulePromptReason("");
                  setReschedulePromptError("");
                }}
                className="py-3 rounded-full border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={reschedulePromptSaving || !reschedulePromptReason.trim()}
                onClick={handleConfirmRequestPatientReschedule}
                className="py-3 rounded-full bg-magenta-600 hover:bg-magenta-700 text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer disabled:opacity-50"
              >
                {reschedulePromptSaving ? "Sending..." : "Send Request to Patient"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
      </ModalPortal>

      {/* ── Decline Patient Reschedule Request Modal (Retains original schedule) ── */}
      <ModalPortal isOpen={Boolean(declinePatientRescheduleModal)}>
        {declinePatientRescheduleModal && (
          <div className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.2 }}
              className="relative z-[9999] w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 border border-gray-100 text-left"
            >
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-gray-900 text-base">Decline Reschedule Request</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Patient: <span className="font-semibold text-gray-800">{declinePatientRescheduleModal.patientName}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDeclinePatientRescheduleModal(null);
                  setDeclineRescheduleReason("");
                  setDeclineRescheduleError("");
                }}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-3.5 p-3 rounded-xl bg-slate-50 border border-gray-200 text-xs text-gray-700 space-y-1">
              <p>
                Patient requested: <strong>{declinePatientRescheduleModal.requestedDate} at {formatAppointmentTime(declinePatientRescheduleModal.requestedTime)}</strong>
              </p>
              <p className="text-emerald-700 font-semibold">
                Original schedule ({declinePatientRescheduleModal.currentDate} at {formatAppointmentTime(declinePatientRescheduleModal.currentTime)}) will remain active.
              </p>
            </div>

            {declineRescheduleError && (
              <div className="mb-3 p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-600 font-medium">
                {declineRescheduleError}
              </div>
            )}

            <div className="mb-4">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                Reason for Patient (Optional)
              </label>
              <textarea
                value={declineRescheduleReason}
                onChange={(e) => {
                  setDeclineRescheduleReason(e.target.value);
                  setDeclineRescheduleError("");
                }}
                rows={3}
                placeholder="e.g. Doctor is fully booked at this requested time..."
                className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-gray-200 text-gray-900 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-400/10 bg-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setDeclinePatientRescheduleModal(null);
                  setDeclineRescheduleReason("");
                  setDeclineRescheduleError("");
                }}
                className="py-3 rounded-full border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={declineRescheduleSaving}
                onClick={handleConfirmDeclineReschedule}
                className="py-3 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer disabled:opacity-50"
              >
                {declineRescheduleSaving ? "Saving..." : "Decline (Keep Original)"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
      </ModalPortal>

      {/* ── Reject Request with Reason Modal ─────────────────────── */}
      <ModalPortal isOpen={Boolean(rejectModal)}>
        {rejectModal && (
          <div className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.2 }}
              className="relative z-[9999] w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 border border-gray-100 text-left"
            >
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-gray-900 text-base">Decline Appointment</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Patient: <span className="font-semibold text-gray-800">{rejectModal.patientName}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRejectModal(null);
                  setRejectReason("");
                  setSelectedPresetReason("");
                  setRejectError("");
                }}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-gray-600 mb-3.5 leading-relaxed">
              Please provide a reason. The patient will receive a notification with this note.
            </p>

            {rejectError && (
              <div className="mb-3 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-600 font-medium">
                {rejectError}
              </div>
            )}

            {/* Quick Reason Presets */}
            <div className="space-y-1.5 mb-3.5">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                Common Reasons
              </label>
              <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                {[
                  "Doctor unavailable for the requested consultation",
                  "Clinic has reached full capacity for consultations",
                  "Condition requires specialized tertiary hospital facility",
                  "Incomplete or unclear patient skin condition details",
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setSelectedPresetReason(preset);
                      setRejectReason(preset);
                      setRejectError("");
                    }}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-colors border cursor-pointer ${selectedPresetReason === preset || rejectReason === preset
                      ? "bg-red-50 border-red-200 text-red-700 font-semibold"
                      : "bg-gray-50 border-gray-100 text-gray-600 hover:bg-gray-100"
                      }`}
                  >
                    • {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Reason Note */}
            <div className="mb-5">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                Note for Patient
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => {
                  setRejectReason(e.target.value);
                  setRejectError("");
                }}
                rows={3}
                placeholder="Type the decline note for the patient..."
                className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-gray-200 text-gray-900 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-400/10 bg-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setRejectModal(null);
                  setRejectReason("");
                  setSelectedPresetReason("");
                  setRejectError("");
                }}
                className="py-3 rounded-full border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRejection}
                className="py-3 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer"
              >
                Confirm Decline
              </button>
            </div>
          </motion.div>
        </div>
      )}
      </ModalPortal>

    </div>
  );
}
