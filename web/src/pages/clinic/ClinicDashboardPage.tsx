import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  XCircle,
  FileText,
  Users,
  CalendarX,
  ShieldCheck,
  Calendar,
  Stethoscope,
} from "lucide-react";
import { useClinicVerification } from "@/hooks/useClinicVerification";
import { motion } from "framer-motion";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";
import {
  parseDoctorSchedule,
  formatTime12h,
  normalizeDayName,
  isClinicCurrentlyOpen,
  isDoctorCurrentlyOnDuty,
} from "@/lib/schedulingService";

/* ── Types ─────────────────────────────────────────────────── */
type AppointmentRecord = {
  id: string;
  clinicId: string | number;
  clinicName: string;
  consultationType: "face-to-face";
  conditionName?: string;
  date: string;
  rawDate?: string;
  time: string;
  notes: string;
  status: "pending" | "accepted" | "scheduled" | "rejected" | "completed";
  meetingLink?: string;
  clinicNote?: string;
  assignedDoctorId?: string;
  assignedDoctorName?: string;
  doctorStatus?: "pending-review" | "approved" | "rejected";
  doctorNote?: string;
  doctorReviewedAt?: string;
  createdAt: string;
  patientName?: string;
  patientEmail?: string;
  patientAge?: number;
  patientAvatar?: string;
  skinPhotoUrl?: string;
  checkInStatus?: "scheduled" | "arrived" | "in-consultation" | "completed" | "no-show";
  paymentStatus?: string;
  paymentAmount?: number;
};

type ClinicDoctorInfo = {
  id: string;
  name: string;
  photo?: string;
  photo_url?: string;
  specialization?: string;
  specializations?: { id?: string; name: string }[];
  dutyDays?: string[];
  dutyStartTime?: string;
  dutyEndTime?: string;
  dutySchedule?: any;
  status?: string;
};

function parseDateStringSafe(str?: string): Date | null {
  if (!str || str === "Schedule pending" || str === "—") return null;
  if (str.includes("T")) {
    const parsed = new Date(str);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  const ymdMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    return new Date(year, month, day);
  }
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function formatTimeString(timeStr?: string): string {
  if (!timeStr || timeStr === "—") return "";
  if (timeStr.includes("AM") || timeStr.includes("PM")) return timeStr;
  const parts = timeStr.split(":");
  if (parts.length >= 2) {
    let hours = parseInt(parts[0], 10);
    const mins = parts[1].slice(0, 2);
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${hours}:${mins} ${ampm}`;
  }
  return timeStr;
}

function timeToMinutesSafe(timeStr?: string): number {
  if (!timeStr || timeStr === "—") return 0;
  const isPM = /pm/i.test(timeStr);
  const isAM = /am/i.test(timeStr);
  const cleaned = timeStr.replace(/\s*(am|pm)/i, "").trim();
  const parts = cleaned.split(":");
  let h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  if (isPM && h < 12) h += 12;
  if (isAM && h === 12) h = 0;
  return h * 60 + m;
}

function formatDoctorDisplay(name?: string): string {
  if (!name) return "";
  const cleaned = name.replace(/^(?:dr\.?|doctor)\s*/i, "").trim();
  if (!cleaned || cleaned.toLowerCase() === "dr") return "";
  return `Dr. ${cleaned}`;
}

/** Current time in Asia/Manila as minutes since midnight */
function getManilaMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    timeZone: "Asia/Manila",
  }).formatToParts(new Date());
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) % 24;
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return h * 60 + m;
}

function getGreeting(minutes: number): string {
  if (minutes < 12 * 60) return "Good morning";
  if (minutes < 18 * 60) return "Good afternoon";
  return "Good evening";
}

type DutyState = "on-duty" | "on-break" | "upcoming" | "finished";

const DUTY_STATE_LABEL: Record<DutyState, string> = {
  "on-duty": "On duty now",
  "on-break": "On break",
  upcoming: "Starts later",
  finished: "Shift ended",
};

const DUTY_STATE_DOT: Record<DutyState, string> = {
  "on-duty": "bg-emerald-500",
  "on-break": "bg-amber-400",
  upcoming: "bg-gray-300",
  finished: "bg-gray-300",
};

/* ── Doctor Avatar Component with Fallback ────────────────────────── */
function DashboardDoctorAvatar({ name, photo }: { name: string; photo?: string }) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [photo]);

  const cleanName = (name || "").replace(/^(?:dr\.?|doctor)\s*/i, "").trim();
  const parts = cleanName.split(/\s+/).filter(Boolean);
  let initials = "DR";
  if (parts.length >= 2) {
    const first = parts[0].replace(/[^A-Za-z]/g, "").charAt(0).toUpperCase();
    const last = parts[parts.length - 1].replace(/[^A-Za-z]/g, "").charAt(0).toUpperCase();
    initials = `${first || "D"}${last || "R"}`;
  } else if (parts.length === 1 && parts[0]) {
    const letters = parts[0].replace(/[^A-Za-z]/g, "");
    initials = letters.slice(0, 2).toUpperCase() || "DR";
  }

  let resolvedPhoto = photo;
  if (
    resolvedPhoto &&
    !resolvedPhoto.startsWith("http") &&
    !resolvedPhoto.startsWith("data:") &&
    !resolvedPhoto.startsWith("blob:")
  ) {
    try {
      const cleanPath = resolvedPhoto.replace(/^avatars\//, "");
      const { data: pubData } = supabase.storage.from("avatars").getPublicUrl(cleanPath);
      if (pubData?.publicUrl) resolvedPhoto = pubData.publicUrl;
    } catch { }
  }

  if (resolvedPhoto && !imgError) {
    return (
      <img
        src={resolvedPhoto}
        alt={name}
        onError={() => setImgError(true)}
        className="w-10 h-10 rounded-full object-cover border border-pink-100 shadow-2xs shrink-0"
      />
    );
  }

  return (
    <div className="w-10 h-10 rounded-full bg-pink-100 text-[#801336] font-bold text-xs flex items-center justify-center border border-pink-200 shrink-0">
      {initials}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number | string }>; label?: string }) => {
  if (active && payload && payload.length) {
    const val = Number(payload[0].value);
    return (
      <div className="bg-white/95 backdrop-blur-md border border-pink-100 text-gray-800 text-xs px-3.5 py-2.5 rounded-xl shadow-xl shadow-pink-900/10">
        <p className="font-bold text-gray-900 mb-1">{label}</p>
        <div className="flex items-center gap-1.5 text-xs text-[#801336] font-semibold">
          <span className="w-2 h-2 rounded-full bg-[#801336]"></span>
          <span>{val} {val === 1 ? "patient" : "patients"}</span>
        </div>
      </div>
    );
  }
  return null;
};

const ConditionTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number | string; payload?: { fullName?: string } }>; label?: string }) => {
  if (active && payload && payload.length) {
    const val = Number(payload[0].value);
    const fullName = (payload[0] as any)?.payload?.fullName || label;
    return (
      <div className="bg-white/95 backdrop-blur-md border border-pink-100 text-gray-800 text-xs px-3.5 py-2.5 rounded-xl shadow-xl shadow-pink-900/10">
        <p className="font-bold text-gray-900 mb-1">{fullName}</p>
        <div className="flex items-center gap-1.5 text-xs text-[#801336] font-semibold">
          <span className="w-2 h-2 rounded-full bg-[#801336]"></span>
          <span>{val} {val === 1 ? "consultation" : "consultations"}</span>
        </div>
      </div>
    );
  }
  return null;
};

export default function ClinicDashboardPage() {
  const now = new Date();
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [doctors, setDoctors] = useState<ClinicDoctorInfo[]>([]);
  const [clinicFee, setClinicFee] = useState<number>(500);
  const [timeframe, setTimeframe] = useState<"week" | "month" | "last-month" | "year">("month");
  const [chartMode, setChartMode] = useState<"trend" | "conditions">("trend");
  const [scheduleDate, setScheduleDate] = useState<Date>(new Date());
  const [nowMinutes, setNowMinutes] = useState<number>(() => getManilaMinutes());

  useEffect(() => {
    const t = window.setInterval(() => setNowMinutes(getManilaMinutes()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const { status: verificationStatus, clinicName, clinicId, loading } = useClinicVerification();

  useEffect(() => {
    let cancelled = false;

    async function loadAppointments() {
      let resolvedClinicId = clinicId;
      let resolvedClinicName = clinicName;

      // 1. Check cached profile
      if (!resolvedClinicId || !resolvedClinicName) {
        try {
          const cache = localStorage.getItem("dermai_clinic_profile_cache");
          if (cache) {
            const parsed = JSON.parse(cache);
            if (parsed.clinicId) resolvedClinicId = parsed.clinicId;
            if (parsed.clinicName) resolvedClinicName = parsed.clinicName;
          }
        } catch { }
      }

      // 2. Check active Supabase session
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
              resolvedClinicId = clinicRow.clinic_id;
              if (!resolvedClinicName && clinicRow.name) resolvedClinicName = clinicRow.name;
            }
          }
        } catch { }
      }

      const docMap = new Map<string, string>();
      const loadedDoctors: ClinicDoctorInfo[] = [];
      let dbList: any[] = [];
      if (resolvedClinicId) {
        // Fetch doctor names, photo, specializations, and duty schedules for clinic
        try {
          const { data: docRows } = await supabase
            .from("clinic_doctor")
            .select(`
              doctor_id,
              doctor_name,
              duty_days,
              duty_start_time,
              duty_end_time,
              duty_schedule,
              status,
              photo_url,
              doctor_specializations (
                specialization_id,
                specializations (
                  id,
                  name
                )
              )
            `)
            .eq("clinic_id", resolvedClinicId);
          if (docRows) {
            docRows.forEach((d: any) => {
              docMap.set(d.doctor_id, d.doctor_name);
              const specs = d.doctor_specializations?.map((ds: any) => ds.specializations).filter(Boolean) || [];
              loadedDoctors.push({
                id: d.doctor_id,
                name: d.doctor_name,
                photo: d.photo_url,
                specializations: specs,
                specialization: specs[0]?.name,
                dutyDays: Array.isArray(d.duty_days)
                  ? d.duty_days
                  : typeof d.duty_days === "string"
                  ? d.duty_days.split(",").map((s: string) => s.trim())
                  : [],
                dutyStartTime: d.duty_start_time || "08:00",
                dutyEndTime: d.duty_end_time || "17:00",
                dutySchedule: d.duty_schedule,
                status: d.status || "Active",
              });
            });
          }
        } catch { }

        try {
          const { data: clinicRow } = await supabase
            .from("clinic")
            .select("consultation_fee")
            .eq("clinic_id", resolvedClinicId)
            .maybeSingle();

          if (clinicRow?.consultation_fee && !cancelled) {
            setClinicFee(Number(clinicRow.consultation_fee));
          }
        } catch { }

        try {
          const { data: opData } = await supabase
            .from("clinic_operating_hours")
            .select("open_time, close_time, day_of_week")
            .eq("clinic_id", resolvedClinicId)
            .maybeSingle();

          if (opData && !cancelled) {
            setClinicSchedule({
              openTime: opData.open_time ? opData.open_time.slice(0, 5) : "08:00",
              closeTime: opData.close_time ? opData.close_time.slice(0, 5) : "17:00",
              operatingDays: opData.day_of_week || "Monday - Saturday",
            });
          }
        } catch { }

        const { data, error } = await supabase
          .from("patient_appointment")
          .select(`
            appointment_id,
            clinic_id,
            date,
            status,
            notes,
            clinic_note,
            assigned_doctor_id,
            doctor_status,
            doctor_note,
            doctor_reviewed_at,
            patient_name,
            patient_email,
            patient_contact,
            patient_address,
            skin_photo_url,
            ai_condition_name,
            ai_confidence,
            created_at,
            user:user_id ( full_name, avatar_url )
          `)
          .eq("clinic_id", resolvedClinicId)
          .order("created_at", { ascending: false });

        if (!error && data) {
          dbList = data;
        }
      }

      // Merge doctor names and duty schedules from local cache if missing
      try {
        const rawDocs = localStorage.getItem("dermai_clinic_doctors");
        if (rawDocs) {
          const parsed = JSON.parse(rawDocs);
          if (Array.isArray(parsed)) {
            parsed.forEach((d: any) => {
              if (d.id && d.name && !docMap.has(d.id)) {
                docMap.set(d.id, d.name);
              }
              const existingIdx = loadedDoctors.findIndex((doc) => doc.id === d.id);
              if (existingIdx >= 0) {
                if (!loadedDoctors[existingIdx].photo && (d.photo || d.photo_url)) {
                  loadedDoctors[existingIdx].photo = d.photo || d.photo_url;
                }
                if (!loadedDoctors[existingIdx].specialization && (d.specialization || d.specializations)) {
                  loadedDoctors[existingIdx].specialization = d.specialization || d.specializations?.[0]?.name;
                  loadedDoctors[existingIdx].specializations = d.specializations || [{ id: "1", name: d.specialization }];
                }
                if (!loadedDoctors[existingIdx].dutySchedule && d.dutySchedule) {
                  loadedDoctors[existingIdx].dutySchedule = d.dutySchedule;
                }
                if (
                  (!loadedDoctors[existingIdx].dutyDays || loadedDoctors[existingIdx].dutyDays!.length === 0) &&
                  d.dutyDays
                ) {
                  loadedDoctors[existingIdx].dutyDays = d.dutyDays;
                }
              } else if (d.id && d.name) {
                loadedDoctors.push({
                  id: d.id,
                  name: d.name,
                  photo: d.photo || d.photo_url,
                  specialization: d.specialization || d.specializations?.[0]?.name,
                  specializations: d.specializations || (d.specialization ? [{ id: "1", name: d.specialization }] : []),
                  dutyDays: d.dutyDays || [],
                  dutyStartTime: d.dutyStartTime || "08:00",
                  dutyEndTime: d.dutyEndTime || "17:00",
                  dutySchedule: d.dutySchedule,
                  status: d.status || "Active",
                });
              }
            });
          }
        }
      } catch { }

      setDoctors(loadedDoctors);

      const mapped: AppointmentRecord[] = dbList.map((a: any) => {
        const userObj = Array.isArray(a.user) ? a.user[0] : a.user;
        const pName = a.patient_name || userObj?.full_name || "Patient";

        // Use user's real avatar_url or undefined (NEVER use skin_photo_url as profile avatar)
        const userAvatar = (userObj?.avatar_url && !userObj.avatar_url.includes("scan-uploads"))
          ? userObj.avatar_url
          : undefined;

        const parsedDate = parseDateStringSafe(a.date);
        const assignedDocName = a.assigned_doctor_id ? docMap.get(a.assigned_doctor_id) : undefined;

        const isPaidOnline = Boolean(
          a.clinic_note &&
          /paid online|gcash ref|maya ref|paymongo|payment verified|payment.*success/i.test(a.clinic_note)
        );
        const isExplicitPaid =
          a.payment_status === "paid" ||
          a.status === "completed" ||
          a.check_in_status === "completed" ||
          a.status === "confirmed" ||
          a.status === "accepted" ||
          a.doctor_status === "approved" ||
          isPaidOnline;

        let extractedAmount: number | undefined;
        if (a.payment_amount) {
          extractedAmount = Number(a.payment_amount);
        } else if (a.clinic_note) {
          const match = a.clinic_note.match(/(?:amount|fee|paid):\s*(?:₱|PHP)?\s*([\d,]+(?:\.\d+)?)/i);
          if (match) {
            extractedAmount = parseFloat(match[1].replace(/,/g, ""));
          }
        }

        return {
          id: a.appointment_id,
          clinicId: resolvedClinicId || a.clinic_id || 0,
          clinicName: resolvedClinicName || "Clinic Portal",
          consultationType: "face-to-face" as const,
          conditionName: a.ai_condition_name ?? undefined,
          rawDate: a.date || undefined,
          date: parsedDate ? parsedDate.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "Schedule pending",
          time: parsedDate && a.date?.includes("T") ? parsedDate.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", hour12: true }) : "—",
          notes: a.notes || a.ai_condition_name || "",
          status: (a.status === "confirmed" || a.status === "scheduled" ? "scheduled" : a.status === "completed" ? "completed" : a.status === "cancelled" || a.status === "rejected" ? "rejected" : a.status === "accepted" ? "accepted" : "pending") as AppointmentRecord["status"],
          clinicNote: a.clinic_note || undefined,
          assignedDoctorId: a.assigned_doctor_id || undefined,
          assignedDoctorName: assignedDocName,
          doctorStatus: a.doctor_status || undefined,
          doctorNote: a.doctor_note || undefined,
          doctorReviewedAt: a.doctor_reviewed_at || undefined,
          createdAt: a.created_at || a.date || new Date().toISOString(),
          patientName: pName,
          patientEmail: a.patient_email || undefined,
          patientAvatar: userAvatar,
          skinPhotoUrl: a.skin_photo_url || undefined,
          checkInStatus: a.check_in_status || undefined,
          paymentStatus: a.payment_status || (isExplicitPaid ? "paid" : undefined),
          paymentAmount: extractedAmount,
        };
      });

      // Merge local cached appointments matching either clinic_id or clinicName
      try {
        const raw = localStorage.getItem("dermai_clinic_appointments");
        if (raw) {
          const localList = JSON.parse(raw);
          if (Array.isArray(localList)) {
            localList.forEach((localItem: any) => {
              if (!mapped.some((m) => m.id === localItem.id)) {
                const isMatch = Boolean(
                  (resolvedClinicId && localItem.clinicId && String(localItem.clinicId) === String(resolvedClinicId)) ||
                  (resolvedClinicName && localItem.clinicName && localItem.clinicName.toLowerCase().trim() === resolvedClinicName.toLowerCase().trim()) ||
                  (!resolvedClinicId && !resolvedClinicName)
                );
                if (isMatch) {
                  const localPName = localItem.patientName || "Patient";
                  const localUserAvatar = (localItem.patientAvatar && !localItem.patientAvatar.includes("scan-uploads"))
                    ? localItem.patientAvatar
                    : undefined;
                  const parsedDate = parseDateStringSafe(localItem.date);

                  const isPaidOnline = Boolean(
                    localItem.clinicNote &&
                    /paid online|gcash ref|maya ref|paymongo|payment verified|payment.*success/i.test(localItem.clinicNote)
                  );
                  const isExplicitPaid =
                    localItem.paymentStatus === "paid" ||
                    localItem.status === "completed" ||
                    localItem.status === "confirmed" ||
                    localItem.status === "accepted" ||
                    localItem.doctorStatus === "approved" ||
                    isPaidOnline;

                  let extractedAmount: number | undefined = localItem.paymentAmount ? Number(localItem.paymentAmount) : undefined;
                  if (!extractedAmount && localItem.clinicNote) {
                    const match = localItem.clinicNote.match(/(?:amount|fee|paid):\s*(?:₱|PHP)?\s*([\d,]+(?:\.\d+)?)/i);
                    if (match) {
                      extractedAmount = parseFloat(match[1].replace(/,/g, ""));
                    }
                  }

                  mapped.push({
                    id: localItem.id,
                    clinicId: resolvedClinicId || localItem.clinicId || 0,
                    clinicName: localItem.clinicName || resolvedClinicName || "Clinic",
                    consultationType: "face-to-face" as const,
                    conditionName: localItem.aiConditionName || localItem.conditionName || undefined,
                    rawDate: localItem.date || undefined,
                    date: parsedDate ? parsedDate.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : (localItem.date || "Schedule pending"),
                    time: localItem.time ? formatTimeString(localItem.time) : (parsedDate && localItem.date?.includes("T") ? parsedDate.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", hour12: true }) : "—"),
                    notes: localItem.notes || localItem.aiConditionName || "",
                    status: localItem.status || "pending",
                    clinicNote: localItem.clinicNote || undefined,
                    assignedDoctorId: localItem.assignedDoctorId || undefined,
                    assignedDoctorName: localItem.assignedDoctorName || (localItem.assignedDoctorId ? docMap.get(localItem.assignedDoctorId) : undefined),
                    doctorStatus: localItem.doctorStatus || undefined,
                    doctorNote: localItem.doctorNote || undefined,
                    doctorReviewedAt: localItem.doctorReviewedAt || undefined,
                    createdAt: localItem.createdAt || new Date().toISOString(),
                    patientName: localPName,
                    patientEmail: localItem.patientEmail || undefined,
                    patientAvatar: localUserAvatar,
                    skinPhotoUrl: localItem.skinPhotoUrl || undefined,
                    checkInStatus: localItem.checkInStatus || localItem.check_in_status || undefined,
                    paymentStatus: localItem.paymentStatus || (isExplicitPaid ? "paid" : undefined),
                    paymentAmount: extractedAmount,
                  });
                }
              }
            });
          }
        }
      } catch { }

      if (!cancelled) {
        setAppointments(mapped);
        try {
          localStorage.setItem("dermai_clinic_appointments", JSON.stringify(mapped));
        } catch { }

      }
    }

    loadAppointments();

    let channel: any = null;
    if (clinicId) {
      channel = supabase
        .channel(`clinic-dash-rt-${clinicId}-${Date.now()}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "patient_appointment", filter: `clinic_id=eq.${clinicId}` },
          () => {
            loadAppointments();
          }
        )
        .subscribe();
    }

    const handleSync = (e?: any) => {
      loadAppointments();
      try {
        if (e?.detail && (e.detail.openTime || e.detail.closeTime || e.detail.operatingDays)) {
          setClinicSchedule({
            openTime: e.detail.openTime || "08:00",
            closeTime: e.detail.closeTime || "17:00",
            operatingDays: e.detail.operatingDays || "Monday - Saturday",
          });
          return;
        }
        const raw = localStorage.getItem("dermai_clinic_settings");
        if (raw) {
          const s = JSON.parse(raw);
          setClinicSchedule({
            openTime: s.openTime || "08:00",
            closeTime: s.closeTime || "17:00",
            operatingDays: s.operatingDays || "Monday - Saturday",
          });
        }
      } catch { }
    };
    window.addEventListener("dermai_appointments_updated", handleSync);
    window.addEventListener("dermai_clinic_doctors_updated", handleSync);
    window.addEventListener("dermai_doctors_updated", handleSync);
    window.addEventListener("clinicSettingsUpdated", handleSync);
    window.addEventListener("dermai_clinic_updated", handleSync);
    window.addEventListener("appointmentCreated", handleSync);
    window.addEventListener("storage", handleSync);
    window.addEventListener("focus", handleSync);

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      window.removeEventListener("dermai_appointments_updated", handleSync);
      window.removeEventListener("dermai_clinic_doctors_updated", handleSync);
      window.removeEventListener("dermai_doctors_updated", handleSync);
      window.removeEventListener("clinicSettingsUpdated", handleSync);
      window.removeEventListener("dermai_clinic_updated", handleSync);
      window.removeEventListener("appointmentCreated", handleSync);
      window.removeEventListener("storage", handleSync);
      window.removeEventListener("focus", handleSync);
    };
  }, [clinicId, clinicName]);

  // 1. Total unique patients registered from appointment records
  const uniquePatientCount = useMemo(() => {
    const ids = new Set<string>();
    appointments.forEach((a) => {
      if (a.status === "rejected") return;
      const key = a.patientEmail?.toLowerCase().trim() || a.patientName?.toLowerCase().trim() || a.id;
      if (key) ids.add(key);
    });
    return ids.size;
  }, [appointments]);

  // 2. Appointments scheduled for today
  const todayAppointments = useMemo(() => {
    const today = new Date();
    return appointments
      .filter((a) => {
        if (a.status === "rejected" || a.checkInStatus === "no-show") return false;
        const d = parseDateStringSafe(a.rawDate || a.date);
        return d ? isSameDay(d, today) : false;
      })
      .sort((a, b) => {
        const da = parseDateStringSafe(a.rawDate || a.date)?.getTime() || 0;
        const db = parseDateStringSafe(b.rawDate || b.date)?.getTime() || 0;
        return da - db;
      });
  }, [appointments]);

  // 3. Total revenue from completed/paid consultations for active clinic
  const { paidAppointmentsCount, formattedRevenue } = useMemo(() => {
    let revenue = 0;
    let count = 0;

    appointments.forEach((a) => {
      const isPaidOnline = Boolean(
        a.clinicNote &&
        /paid online|gcash ref|maya ref|paymongo|payment verified|payment.*success/i.test(a.clinicNote)
      );

      const isCompletedOrActive =
        a.status === "completed" ||
        a.checkInStatus === "completed" ||
        a.status === "scheduled" ||
        a.status === "accepted" ||
        a.doctorStatus === "approved";

      const isPaid =
        a.paymentStatus === "paid" ||
        isPaidOnline ||
        (isCompletedOrActive && a.status !== "rejected" && a.doctorStatus !== "rejected");

      if (isPaid) {
        count += 1;
        const fee = a.paymentAmount && a.paymentAmount > 0 ? a.paymentAmount : clinicFee;
        revenue += fee;
      }
    });

    const formatted = `₱${revenue.toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

    return { totalRevenue: revenue, paidAppointmentsCount: count, formattedRevenue: formatted };
  }, [appointments, clinicFee]);

  // 4. Configured or average consultation slot time (minutes)
  const avgTimeMinutes = useMemo(() => {
    try {
      const raw = localStorage.getItem("dermai_clinic_settings");
      if (raw) {
        const s = JSON.parse(raw);
        if (s.slotIntervalMinutes && Number(s.slotIntervalMinutes) > 0) {
          return Number(s.slotIntervalMinutes);
        }
      }
    } catch { }

    const intervals: number[] = [];
    doctors.forEach((doc) => {
      if (doc.dutySchedule?.slotIntervalMinutes) {
        intervals.push(Number(doc.dutySchedule.slotIntervalMinutes));
      }
    });
    if (intervals.length > 0) {
      const sum = intervals.reduce((acc, v) => acc + v, 0);
      return Math.round(sum / intervals.length);
    }
    return 30;
  }, [doctors]);

  // Current clinic operating schedule
  const [clinicSchedule, setClinicSchedule] = useState(() => {
    try {
      const raw = localStorage.getItem("dermai_clinic_settings");
      if (raw) {
        const s = JSON.parse(raw);
        return {
          openTime: s.openTime || "08:00",
          closeTime: s.closeTime || "17:00",
          operatingDays: s.operatingDays || "Monday - Saturday",
        };
      }
    } catch { }
    return {
      openTime: "08:00",
      closeTime: "17:00",
      operatingDays: "Monday - Saturday",
    };
  });

  const clinicStatus = useMemo(() => {
    return isClinicCurrentlyOpen({
      openTime: clinicSchedule.openTime,
      closeTime: clinicSchedule.closeTime,
      operatingDays: clinicSchedule.operatingDays,
      timezone: "Asia/Manila",
    });
  }, [clinicSchedule, nowMinutes]);

  // Current Day Name in Asia/Manila
  const todayDayName = useMemo(() => {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: "Asia/Manila",
    }).format(new Date());
  }, []);

  // Compute doctors who are on duty today based on their active duty schedule
  // Strictly respects clinic opening hours, operating days, shift validity, and current local time
  const onDutyDoctors = useMemo(() => {
    return doctors
      .filter((doc) => doc.status !== "Inactive")
      .map((doc) => {
        const docSched = parseDoctorSchedule(
          doc.dutySchedule,
          doc.dutyDays,
          doc.dutyStartTime || "08:00",
          doc.dutyEndTime || "17:00"
        );

        let shifts: any[] = docSched.weeklyShifts[todayDayName] || [];

        // Fallback 1: Check legacy dutySchedule[todayDayName]
        if (
          shifts.length === 0 &&
          doc.dutySchedule &&
          typeof doc.dutySchedule === "object"
        ) {
          const dayData = doc.dutySchedule[todayDayName];
          if (dayData && dayData.startTime && dayData.endTime) {
            shifts = [
              {
                id: `shift-${todayDayName.toLowerCase()}-legacy`,
                label: "Duty Shift",
                startTime: dayData.startTime,
                endTime: dayData.endTime,
              },
            ];
          }
        }

        // Fallback 2: Check dutyDays array
        if (
          shifts.length === 0 &&
          doc.dutyDays &&
          Array.isArray(doc.dutyDays) &&
          doc.dutyDays.some((d) => normalizeDayName(d).toLowerCase() === todayDayName.toLowerCase())
        ) {
          shifts = [
            {
              id: `shift-${todayDayName.toLowerCase()}-default`,
              label: "Duty Shift",
              startTime: doc.dutyStartTime || "08:00",
              endTime: doc.dutyEndTime || "17:00",
            },
          ];
        }

        const validShifts = shifts.filter((s) => s.startTime && s.endTime);
        if (validShifts.length === 0) return null;

        const hoursDisplay = validShifts.length === 1
          ? `${formatTime12h(validShifts[0].startTime)} – ${formatTime12h(validShifts[0].endTime)}`
          : validShifts.map((s) => `${formatTime12h(s.startTime)} – ${formatTime12h(s.endTime)}`).join(", ");

        // Real shift progress, based on the current Asia/Manila time
        let totalMinutes = 0;
        let workedMinutes = 0;
        let firstStart = Infinity;
        let lastEnd = -Infinity;

        validShifts.forEach((s) => {
          const start = timeToMinutesSafe(s.startTime);
          const end = timeToMinutesSafe(s.endTime);
          if (end <= start) return;
          totalMinutes += end - start;
          workedMinutes += Math.min(Math.max(nowMinutes - start, 0), end - start);
          firstStart = Math.min(firstStart, start);
          lastEnd = Math.max(lastEnd, end);
        });

        const progress = totalMinutes > 0 ? Math.round((workedMinutes / totalMinutes) * 100) : 0;

        // Authoritative evaluation of duty status
        const dutyRes = isDoctorCurrentlyOnDuty({
          doctor: doc,
          clinicSchedule,
          timezone: "Asia/Manila",
        });

        let dutyState: DutyState = "finished";
        if (dutyRes.isOnDuty) {
          dutyState = "on-duty";
        } else if (!clinicStatus.isOpen) {
          dutyState = "finished";
        } else if (nowMinutes < firstStart) {
          dutyState = "upcoming";
        } else if (nowMinutes >= lastEnd) {
          dutyState = "finished";
        } else {
          dutyState = "on-break";
        }

        const primarySpec =
          doc.specializations && doc.specializations.length > 0 && doc.specializations[0]?.name
            ? doc.specializations[0].name
            : doc.specialization
              ? doc.specialization.split(",")[0].trim()
              : "Clinical Dermatology";

        const cleanDocName = doc.name.trim();
        const displayName = cleanDocName.startsWith("Dr.") ? cleanDocName : `Dr. ${cleanDocName}`;

        return {
          id: doc.id,
          name: doc.name,
          displayName,
          primarySpec,
          hoursDisplay,
          photo: doc.photo || doc.photo_url,
          progress,
          dutyState,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [doctors, todayDayName, nowMinutes, clinicSchedule, clinicStatus]);

  // Shifts and patient count for the selected schedule date
  const scheduledShifts = useMemo(() => {
    const dayName = scheduleDate.toLocaleDateString("en-US", { weekday: "long" });
    const dayAppointments = appointments.filter((appt) => {
      if (appt.status === "rejected" || appt.checkInStatus === "no-show") return false;
      const d = parseDateStringSafe(appt.rawDate || appt.date);
      return d ? isSameDay(d, scheduleDate) : false;
    });

    const activeDocs = doctors.filter((d) => d.status !== "Inactive");
    const slots: Array<{
      shiftId: string;
      doctorName: string;
      startTime: string;
      endTime: string;
      timeDisplay: string;
      patientCount: number;
    }> = [];

    activeDocs.forEach((doc) => {
      const parsedSched = parseDoctorSchedule(
        doc.dutySchedule,
        doc.dutyDays,
        doc.dutyStartTime || "08:00",
        doc.dutyEndTime || "17:00"
      );
      let shifts = parsedSched.weeklyShifts[dayName] || [];

      // Fallback: If weeklyShifts is empty for this day, but doctor's dutyDays includes this day, create shift from dutyStartTime/dutyEndTime
      if (
        shifts.length === 0 &&
        doc.dutyDays &&
        doc.dutyDays.map(normalizeDayName).includes(dayName)
      ) {
        shifts = [
          {
            id: `shift-${dayName.toLowerCase()}-1`,
            label: "Duty Shift",
            startTime: doc.dutyStartTime || "08:00",
            endTime: doc.dutyEndTime || "17:00",
          },
        ];
      }

      shifts.forEach((shift) => {
        const shiftStartM = timeToMinutesSafe(shift.startTime);
        const shiftEndM = timeToMinutesSafe(shift.endTime);

        // Count appointments falling into this shift for this doctor
        const count = dayAppointments.filter((appt) => {
          if (appt.assignedDoctorId && appt.assignedDoctorId === doc.id) {
            if (!appt.time || appt.time === "—") return true;
            const apptM = timeToMinutesSafe(appt.time);
            if (apptM === 0 && !appt.time.startsWith("00:") && !appt.time.startsWith("12:00 AM")) {
              return true;
            }
            return apptM >= shiftStartM && apptM < shiftEndM;
          }
          if (!appt.assignedDoctorId && appt.time && appt.time !== "—") {
            const apptM = timeToMinutesSafe(appt.time);
            return apptM >= shiftStartM && apptM < shiftEndM;
          }
          return false;
        }).length;

        const timeRangeStr = `${formatTime12h(shift.startTime)} – ${formatTime12h(shift.endTime)}`;

        slots.push({
          shiftId: `${doc.id}-${shift.id || shift.startTime}`,
          doctorName: formatDoctorDisplay(doc.name) || "Doctor",
          startTime: shift.startTime,
          endTime: shift.endTime,
          timeDisplay: timeRangeStr,
          patientCount: count,
        });
      });
    });

    return slots.sort((a, b) => timeToMinutesSafe(a.startTime) - timeToMinutesSafe(b.startTime));
  }, [scheduleDate, doctors, appointments]);

  const handlePrevDay = () => {
    setScheduleDate((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() - 1);
      return next;
    });
  };

  const handleNextDay = () => {
    setScheduleDate((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + 1);
      return next;
    });
  };

  const patientTrendData = useMemo(() => {
    const validAppts = appointments.filter((a) => a.status !== "rejected");
    const today = new Date();

    if (timeframe === "week") {
      const currentDay = today.getDay();
      const diffToMon = currentDay === 0 ? -6 : 1 - currentDay;
      const monday = new Date(today);
      monday.setDate(today.getDate() + diffToMon);
      monday.setHours(0, 0, 0, 0);

      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const dayLabel = d.toLocaleDateString("en-PH", { weekday: "short" });
        const dateNum = d.getDate();
        const count = validAppts.filter((a) => {
          const ad = parseDateStringSafe(a.createdAt) || parseDateStringSafe(a.rawDate || a.date);
          return ad && isSameDay(ad, d);
        }).length;
        return {
          label: `${dayLabel} ${dateNum}`,
          patients: count,
        };
      });
    }

    if (timeframe === "month") {
      const year = today.getFullYear();
      const month = today.getMonth();
      const lastDay = new Date(year, month + 1, 0).getDate();

      const buckets = [
        { label: "W1 (1-7)", start: 1, end: 7 },
        { label: "W2 (8-14)", start: 8, end: 14 },
        { label: "W3 (15-21)", start: 15, end: 21 },
        { label: "W4 (22-28)", start: 22, end: 28 },
        ...(lastDay > 28 ? [{ label: `W5 (29-${lastDay})`, start: 29, end: lastDay }] : []),
      ];

      return buckets.map((b) => {
        const count = validAppts.filter((a) => {
          const ad = parseDateStringSafe(a.createdAt) || parseDateStringSafe(a.rawDate || a.date);
          if (!ad) return false;
          return ad.getFullYear() === year && ad.getMonth() === month && ad.getDate() >= b.start && ad.getDate() <= b.end;
        }).length;
        return {
          label: b.label,
          patients: count,
        };
      });
    }

    if (timeframe === "last-month") {
      const ref = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const year = ref.getFullYear();
      const month = ref.getMonth();
      const lastDay = new Date(year, month + 1, 0).getDate();

      const buckets = [
        { label: "W1 (1-7)", start: 1, end: 7 },
        { label: "W2 (8-14)", start: 8, end: 14 },
        { label: "W3 (15-21)", start: 15, end: 21 },
        { label: "W4 (22-28)", start: 22, end: 28 },
        ...(lastDay > 28 ? [{ label: `W5 (29-${lastDay})`, start: 29, end: lastDay }] : []),
      ];

      return buckets.map((b) => {
        const count = validAppts.filter((a) => {
          const ad = parseDateStringSafe(a.createdAt) || parseDateStringSafe(a.rawDate || a.date);
          if (!ad) return false;
          return ad.getFullYear() === year && ad.getMonth() === month && ad.getDate() >= b.start && ad.getDate() <= b.end;
        }).length;
        return {
          label: b.label,
          patients: count,
        };
      });
    }

    if (timeframe === "year") {
      const year = today.getFullYear();
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return months.map((mName, mIdx) => {
        const count = validAppts.filter((a) => {
          const ad = parseDateStringSafe(a.createdAt) || parseDateStringSafe(a.rawDate || a.date);
          if (!ad) return false;
          return ad.getFullYear() === year && ad.getMonth() === mIdx;
        }).length;
        return {
          label: mName,
          patients: count,
        };
      });
    }

    return [];
  }, [appointments, timeframe]);

  const conditionData = useMemo(() => {
    const validAppts = appointments.filter((a) => a.status !== "rejected");
    const counts: Record<string, number> = {};

    validAppts.forEach((a) => {
      const cond = a.conditionName?.trim() || "General Consultation";
      counts[cond] = (counts[cond] || 0) + 1;
    });

    const entries = Object.entries(counts).map(([name, count]) => ({
      name: name.length > 22 ? name.slice(0, 20) + "…" : name,
      fullName: name,
      consultations: count,
    }));

    entries.sort((a, b) => b.consultations - a.consultations);
    return entries.slice(0, 5);
  }, [appointments]);

  // Builds clean integer Y-axis ticks (e.g. 0,1,2,3,4 or 0,2,4,6) so labels never repeat or show decimals
  const buildYAxis = (maxVal: number) => {
    const targetMax = Math.max(maxVal, 4);
    let step: number;
    if (targetMax <= 4) step = 1;
    else if (targetMax <= 8) step = 2;
    else if (targetMax <= 15) step = 3;
    else if (targetMax <= 20) step = 5;
    else step = Math.ceil(targetMax / 4);

    const max = Math.ceil(targetMax / step) * step;
    const ticks: number[] = [];
    for (let t = 0; t <= max; t += step) ticks.push(t);
    return { max, ticks };
  };

  const trendAxis = useMemo(
    () => buildYAxis(Math.max(...patientTrendData.map((d) => d.patients), 0)),
    [patientTrendData]
  );

  const condAxis = useMemo(
    () => buildYAxis(Math.max(...conditionData.map((d) => d.consultations), 0)),
    [conditionData]
  );

  const statCards = [
    {
      label: "Total Patients",
      value: String(uniquePatientCount),
      unit: undefined as string | undefined,
      sub:
        uniquePatientCount > 0
          ? uniquePatientCount === 1
            ? "1 registered patient"
            : `${uniquePatientCount} registered patients`
          : "No registered patients",
      highlight: true,
      link: "/clinic/patients",
    },
    {
      label: "Today's Appointments",
      value: String(todayAppointments.length),
      unit: undefined,
      sub:
        todayAppointments.length > 0
          ? todayAppointments.length === 1
            ? "1 scheduled today"
            : `${todayAppointments.length} scheduled today`
          : "No bookings today",
      highlight: false,
      link: "/clinic/appointments",
    },
    {
      label: "Total Revenue",
      value: formattedRevenue,
      unit: undefined,
      sub:
        paidAppointmentsCount > 0
          ? paidAppointmentsCount === 1
            ? "From 1 paid consultation"
            : `From ${paidAppointmentsCount} paid consultations`
          : "All-time clinic earnings",
      highlight: false,
      link: "/clinic/patients",
    },
    {
      label: "Avg. Time per Appointment",
      value: String(avgTimeMinutes),
      unit: "min",
      sub: "Standard consult",
      highlight: false,
      link: "/clinic/appointments",
    },
  ];

  if (loading && verificationStatus !== "verified") {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="h-6 w-44 bg-gray-200 rounded-lg"></div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gray-200"></div>
            <div className="space-y-1 hidden sm:block">
              <div className="h-3 w-24 bg-gray-200 rounded"></div>
              <div className="h-2 w-16 bg-gray-200 rounded"></div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1 grid grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-2xl p-4 bg-white border border-magenta-100 shadow-sm min-h-[110px] space-y-3">
                <div className="flex items-start justify-between">
                  <div className="h-3 w-16 bg-gray-200 rounded"></div>
                  <div className="w-8 h-8 rounded-full border border-gray-200 bg-gray-50 shrink-0"></div>
                </div>
                <div className="h-7 w-12 bg-gray-200 rounded"></div>
                <div className="h-2 w-20 bg-gray-100 rounded"></div>
              </div>
            ))}
          </div>
          <div className="lg:col-span-2 bg-white border border-magenta-100 shadow-sm rounded-2xl p-5 min-h-[220px]">
            <div className="h-4 w-28 bg-gray-200 rounded mb-4"></div>
            <div className="h-36 bg-gray-100 rounded-xl"></div>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-white border border-magenta-100 shadow-sm rounded-2xl p-5 min-h-[200px]">
            <div className="h-4 w-32 bg-gray-200 rounded mb-4"></div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-2xl border border-magenta-100 p-4 h-44 bg-gray-50/50"></div>
              ))}
            </div>
          </div>
          <div className="bg-white border border-magenta-100 shadow-sm rounded-2xl p-5 min-h-[200px]">
            <div className="h-4 w-24 bg-gray-200 rounded mb-4"></div>
            <div className="h-36 bg-gray-100 rounded-xl"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Verification Banner ───────────────────────────────── */}
      {!loading && verificationStatus === "pending" && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Pending Admin Verification</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Your clinic is awaiting approval. Appointments and patient management are locked until you're verified.
              <Link to="/clinic/settings" className="ml-1 underline font-medium">View your profile →</Link>
            </p>
          </div>
        </div>
      )}
      {!loading && verificationStatus === "rejected" && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
          <XCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-800">Clinic Registration Rejected</p>
            <p className="text-xs text-red-700 mt-0.5">
              Your clinic registration was rejected by the admin. Please update your profile information and contact support.
              <Link to="/clinic/settings" className="ml-1 underline font-medium">Update profile →</Link>
            </p>
          </div>
        </div>
      )}

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-display font-bold text-gray-900 tracking-tight">
            {getGreeting(nowMinutes)}{clinicName ? `, ${clinicName}` : ""}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          </p>
        </div>
        {verificationStatus === "verified" && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5" /> Active Clinic
          </span>
        )}
      </div>

      {/* ── Verified dashboard content ──────────────────────── */}
      {verificationStatus === "verified" ? (
        <>
          {/* ── Top Section: 2x2 Stats & Single Unified Analytics Graph ──── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Stats 2x2 Grid */}
            <div className="lg:col-span-1 grid grid-cols-2 gap-3.5">
              {statCards.map((card, i) => {
                return (
                  <motion.div
                    key={card.label}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 * (i + 1) }}
                    className="h-full"
                  >
                    <Link
                      to={card.link}
                      className={cn(
                        "rounded-2xl p-4 flex flex-col justify-between min-h-[118px] h-full relative overflow-hidden group transition-all duration-200 block",
                        card.highlight
                          ? "bg-gradient-to-br from-[#4a0b30] via-[#801336] to-[#b83a74] text-white shadow-lg shadow-[#801336]/25 hover:shadow-xl hover:shadow-[#801336]/35 hover:-translate-y-0.5"
                          : "bg-white border border-gray-100 shadow-2xs text-gray-900 hover:border-gray-200 hover:shadow-xs hover:-translate-y-0.5"
                      )}
                    >
                      {card.highlight && (
                        <>
                          <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-white/10 pointer-events-none" />
                          <div className="absolute -bottom-8 -left-4 w-24 h-24 rounded-full bg-white/10 pointer-events-none" />
                        </>
                      )}

                      <div className="relative flex items-start justify-between gap-2">
                        <p className={cn("text-xs font-semibold leading-snug", card.highlight ? "text-white" : "text-gray-600")}>
                          {card.label}
                        </p>
                        <span
                          className={cn(
                            "w-8 h-8 rounded-full border flex items-center justify-center shrink-0 transition-all",
                            card.highlight
                              ? "border-white/60 text-white group-hover:bg-white/10"
                              : "border-gray-200 text-gray-800 bg-white group-hover:border-gray-300"
                          )}
                        >
                          <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                        </span>
                      </div>

                      <div className="relative mt-3">
                        <p
                          className={cn(
                            "flex items-baseline gap-1 font-extrabold leading-none tracking-tight",
                            card.value.length > 8 ? "text-2xl xl:text-3xl" : "text-3xl"
                          )}
                        >
                          {card.value}
                          {card.unit && <span className="text-xs font-semibold text-gray-400">{card.unit}</span>}
                        </p>
                        <p className={cn("text-[11px] mt-1.5 truncate font-medium", card.highlight ? "text-pink-200" : "text-gray-400")}>
                          {card.sub}
                        </p>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </div>

            {/* Single Unified Analytics & Graphs Card */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="lg:col-span-2 bg-white border border-gray-100 shadow-2xs rounded-2xl p-5 flex flex-col justify-between"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-bold text-gray-900">
                    {chartMode === "trend" ? "Patient Trends" : "Consultations by Condition"}
                  </h2>
                  <div className="flex items-center bg-gray-100/90 p-0.5 rounded-lg text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setChartMode("trend")}
                      className={cn(
                        "px-2.5 py-1 rounded-md transition-all cursor-pointer text-xs",
                        chartMode === "trend"
                          ? "bg-white text-gray-900 font-bold shadow-xs"
                          : "text-gray-500 hover:text-gray-900"
                      )}
                    >
                      Trend
                    </button>
                    <button
                      type="button"
                      onClick={() => setChartMode("conditions")}
                      className={cn(
                        "px-2.5 py-1 rounded-md transition-all cursor-pointer text-xs",
                        chartMode === "conditions"
                          ? "bg-white text-gray-900 font-bold shadow-xs"
                          : "text-gray-500 hover:text-gray-900"
                      )}
                    >
                      Conditions
                    </button>
                  </div>
                </div>

                {chartMode === "trend" && (
                  <select
                    value={timeframe}
                    onChange={(e) => setTimeframe(e.target.value as any)}
                    aria-label="Select timeframe for patient trends chart"
                    className="text-xs border border-gray-200/90 rounded-xl px-3 py-1 text-gray-700 bg-white hover:bg-gray-50 transition-colors focus:outline-none focus:ring-1 focus:ring-[#801336] cursor-pointer font-semibold shadow-2xs"
                  >
                    <option value="week">This week</option>
                    <option value="month">This month</option>
                    <option value="last-month">Last month</option>
                    <option value="year">This year</option>
                  </select>
                )}
              </div>

              {chartMode === "trend" ? (
                <ResponsiveContainer width="100%" height={210}>
                  <AreaChart data={patientTrendData} margin={{ top: 12, right: 16, left: 4, bottom: 6 }}>
                    <defs>
                      <linearGradient id="patientTrendGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#c2417a" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#c2417a" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: "#888", fontWeight: 500 }}
                      axisLine={{ stroke: "#f3f4f6" }}
                      tickLine={false}
                      interval={0}
                      padding={{ left: 16, right: 16 }}
                      tickMargin={8}
                    />
                    <YAxis
                      allowDecimals={false}
                      domain={[0, trendAxis.max]}
                      ticks={trendAxis.ticks}
                      width={34}
                      tick={{ fontSize: 11, fill: "#888", fontWeight: 500 }}
                      axisLine={false}
                      tickLine={false}
                      tickMargin={6}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#80133640", strokeWidth: 1.5 }} />
                    <Area
                      type="monotone"
                      dataKey="patients"
                      stroke="#801336"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#patientTrendGrad)"
                      activeDot={{ r: 4.5, fill: "#801336", stroke: "#fff", strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : conditionData.length === 0 ? (
                <div className="h-[210px] flex flex-col items-center justify-center text-xs text-gray-400">
                  <p className="font-semibold text-gray-600">No condition consultation data available yet</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Condition metrics will populate automatically from consultations.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={conditionData} margin={{ top: 12, right: 16, left: 4, bottom: 6 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: "#888", fontWeight: 500 }}
                      axisLine={{ stroke: "#f3f4f6" }}
                      tickLine={false}
                      interval={0}
                      padding={{ left: 24, right: 24 }}
                      tickMargin={8}
                    />
                    <YAxis
                      allowDecimals={false}
                      domain={[0, condAxis.max]}
                      ticks={condAxis.ticks}
                      width={34}
                      tick={{ fontSize: 11, fill: "#888", fontWeight: 500 }}
                      axisLine={false}
                      tickLine={false}
                      tickMargin={6}
                    />
                    <Tooltip content={<ConditionTooltip />} cursor={{ fill: "#fce7f320" }} />
                    <Bar
                      dataKey="consultations"
                      fill="#801336"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={48}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </motion.div>
          </div>

          {/* ── On Duty Today ────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="bg-white border border-gray-100 shadow-2xs rounded-2xl p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-[#801336]" />
                <h2 className="text-sm sm:text-base font-bold text-gray-900">On Duty Today</h2>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-pink-100/70 text-[#801336] border border-pink-200/50">
                  {onDutyDoctors.length} {onDutyDoctors.length === 1 ? "doctor" : "doctors"}
                </span>
              </div>
              <Link
                to="/clinic/doctors"
                className="text-xs font-semibold text-[#801336] hover:underline transition-colors cursor-pointer"
              >
                Manage roster ›
              </Link>
            </div>

            {onDutyDoctors.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-400">
                No attending doctors scheduled on duty today.
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3.5 mt-3.5">
                {onDutyDoctors.map((doc) => (
                  <div
                    key={doc.id}
                    className="rounded-2xl border border-pink-100/80 bg-gradient-to-br from-pink-50/70 via-white to-white p-3.5 flex items-center gap-3.5 hover:shadow-md hover:-translate-y-0.5 transition-all text-left"
                  >
                    {/* Avatar: gradient ring + live status dot */}
                    <div className="relative shrink-0">
                      <div className="rounded-full p-[3px] bg-gradient-to-tr from-[#801336] via-pink-300 to-[#801336]">
                        <div className="rounded-full bg-white p-0.5">
                          <DashboardDoctorAvatar name={doc.name} photo={doc.photo} />
                        </div>
                      </div>
                      <span
                        className={cn("absolute bottom-0 right-0 w-3 h-3 rounded-full ring-2 ring-white", DUTY_STATE_DOT[doc.dutyState])}
                        title={DUTY_STATE_LABEL[doc.dutyState]}
                      />
                    </div>

                    {/* Details */}
                    <div className="min-w-0 flex-1">
                      <h3 className="font-bold text-[13px] text-gray-900 truncate" title={doc.displayName}>
                        {doc.displayName}
                      </h3>
                      <p className="text-xs text-gray-500 truncate mt-0.5 font-medium">{doc.primarySpec}</p>

                      <div
                        className="h-1.5 rounded-full bg-pink-100 overflow-hidden mt-2"
                        role="progressbar"
                        aria-label={`Shift progress for ${doc.displayName}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={doc.progress}
                      >
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#c2417a] to-[#801336] transition-all duration-500"
                          style={{ width: `${doc.progress}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between gap-2 mt-1.5">
                        <p className="text-xs font-bold text-gray-900 truncate">{doc.hoursDisplay}</p>
                        <span className="text-[10px] font-semibold text-gray-400 whitespace-nowrap">
                          {DUTY_STATE_LABEL[doc.dutyState]}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          {/* ── Today's Appointments & Upcoming Schedule ─────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left Card: Today's Appointments */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="lg:col-span-7 bg-white border border-gray-100 shadow-2xs rounded-2xl p-6 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2.5">
                    <Calendar className="w-5 h-5 text-[#801336]" />
                    <h2 className="text-base font-bold text-gray-900">Today's Appointments</h2>
                  </div>
                  <Link
                    to="/clinic/appointments"
                    className="text-xs text-[#801336] font-semibold hover:underline flex items-center gap-1"
                  >
                    View all &rarr;
                  </Link>
                </div>

                {/* Table Header */}
                <div className="grid grid-cols-12 items-center px-4 py-3 text-xs font-semibold text-gray-400 bg-gray-50/70 rounded-xl mb-1">
                  <span className="col-span-3 sm:col-span-2">Time</span>
                  <span className="col-span-3 sm:col-span-4">Patient</span>
                  <span className="col-span-3 sm:col-span-4">Doctor</span>
                  <span className="col-span-3 sm:col-span-2">Status</span>
                </div>

                {/* Table Rows */}
                {todayAppointments.length === 0 ? (
                  <div className="py-14 flex flex-col items-center justify-center text-center text-gray-400">
                    <div className="w-10 h-10 rounded-full bg-pink-50 flex items-center justify-center mb-2">
                      <Calendar className="w-5 h-5 text-[#801336]/70" />
                    </div>
                    <p className="text-xs font-bold text-gray-700">No appointments scheduled for today</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">Confirmed patient appointments for today will appear here.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {todayAppointments.map((appt) => {
                      const pName = appt.patientName || "Patient";
                      const docName = formatDoctorDisplay(appt.assignedDoctorName) || "Unassigned";
                      const timeStr = formatTimeString(appt.time) || "Schedule pending";

                      const isConfirmed =
                        appt.status === "scheduled" ||
                        appt.status === "accepted" ||
                        appt.doctorStatus === "approved";
                      const isCompleted =
                        appt.status === "completed" || appt.checkInStatus === "completed";
                      const isRejected =
                        appt.status === "rejected" || appt.doctorStatus === "rejected";

                      return (
                        <Link
                          key={appt.id}
                          to="/clinic/appointments"
                          className="grid grid-cols-12 items-center px-4 py-4 hover:bg-pink-50/20 transition-colors rounded-xl group cursor-pointer"
                        >
                          <div className="col-span-3 sm:col-span-2">
                            <span className="text-sm font-bold text-gray-900">{timeStr}</span>
                          </div>
                          <div className="col-span-3 sm:col-span-4 pr-3">
                            <p className="text-sm font-bold text-gray-900 leading-snug truncate group-hover:text-[#801336] transition-colors">{pName}</p>
                          </div>
                          <div className="col-span-3 sm:col-span-4 pr-3">
                            <span className="text-sm font-medium text-gray-700 truncate block">{docName}</span>
                          </div>
                          <div className="col-span-3 sm:col-span-2">
                            {isConfirmed ? (
                              <span className="inline-flex items-center px-3.5 py-1 rounded-full text-xs font-semibold bg-[#e6f9f0] text-[#10b981]">
                                Confirmed
                              </span>
                            ) : isCompleted ? (
                              <span className="inline-flex items-center px-3.5 py-1 rounded-full text-xs font-semibold bg-sky-50 text-sky-700">
                                Completed
                              </span>
                            ) : isRejected ? (
                              <span className="inline-flex items-center px-3.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700">
                                Declined
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-3.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700">
                                Pending
                              </span>
                            )}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>

            {/* Right Card: Upcoming Schedule */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              className="lg:col-span-5 bg-white border border-gray-100 shadow-2xs rounded-2xl p-6 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <Calendar className="w-5 h-5 text-[#801336]" />
                    <h2 className="text-base font-bold text-gray-900">Upcoming Schedule</h2>
                  </div>
                  <Link
                    to="/clinic/appointments"
                    className="text-xs text-[#801336] font-semibold hover:underline flex items-center gap-1"
                  >
                    View calendar &rarr;
                  </Link>
                </div>

                {/* Subheader: Date Navigator */}
                <div className="flex items-center justify-between py-2 mb-4 border-b border-gray-100">
                  <span className="text-sm font-bold text-gray-900">
                    {scheduleDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handlePrevDay}
                      className="w-7 h-7 rounded-lg border border-gray-200 hover:bg-pink-50 hover:text-[#801336] flex items-center justify-center transition-colors cursor-pointer text-gray-500"
                      title="Previous day"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleNextDay}
                      className="w-7 h-7 rounded-lg border border-gray-200 hover:bg-pink-50 hover:text-[#801336] flex items-center justify-center transition-colors cursor-pointer text-gray-500"
                      title="Next day"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Shifts List */}
                {scheduledShifts.length === 0 ? (
                  <div className="py-14 flex flex-col items-center justify-center text-center text-gray-400">
                    <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mb-2">
                      <Calendar className="w-5 h-5 text-gray-400" />
                    </div>
                    <p className="text-xs font-bold text-gray-700">No shifts scheduled for this day</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">Doctor duty hours will appear here once configured.</p>
                  </div>
                ) : (
                  <div className="space-y-4 pt-1">
                    {scheduledShifts.map((slot) => (
                      <div key={slot.shiftId} className="flex items-center justify-between gap-3 py-1">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={cn("w-1.5 h-10 rounded-full shrink-0", slot.patientCount > 0 ? "bg-[#801336]" : "bg-pink-200")} />
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-gray-900 leading-snug truncate">
                              {slot.timeDisplay}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5 truncate">
                              {slot.doctorName}
                            </p>
                          </div>
                        </div>
                        <div className="shrink-0">
                          {slot.patientCount > 0 ? (
                            <span className="inline-flex items-center px-3.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              {slot.patientCount} {slot.patientCount === 1 ? "patient" : "patients"}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-3.5 py-1 rounded-full text-xs font-medium bg-gray-50 border border-gray-100 text-gray-400">
                              No patients
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        </>
      ) : (
        /* ── Pending / Rejected verification state ────────────── */
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          {/* Verification steps */}
          <div className="bg-white border border-magenta-100 shadow-sm rounded-2xl p-6">
            <h2 className="text-sm font-bold text-gray-900 mb-4">Verification Steps</h2>
            <div className="space-y-4">
              {[
                { step: 1, label: "Submit Clinic Profile", desc: "Fill in your clinic details, operating hours, and license.", done: true },
                { step: 2, label: "Admin Review", desc: "Our team is reviewing your application. This typically takes 1–3 business days.", done: verificationStatus === "rejected" },
                { step: 3, label: "Get Verified & Go Live", desc: "Once approved, patients can discover and book appointments with your clinic.", done: false },
              ].map(({ step, label, desc, done }) => (
                <div key={step} className="flex items-start gap-4">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-bold ${done ? "bg-green-100 text-green-600" : verificationStatus === "rejected" && step === 2 ? "bg-red-100 text-red-500" : "bg-gray-100 text-gray-400"}`}>
                    {done ? <CheckCircle2 className="w-4 h-4" /> : step}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
                    {step === 2 && verificationStatus === "rejected" && (
                      <p className="text-xs text-red-600 font-medium mt-1">Application was rejected. Please update your profile and contact support.</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <Link to="/clinic/settings" className="mt-5 flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#c0166a] text-white text-sm font-semibold hover:bg-[#a01259] transition-colors">
              <ShieldCheck className="w-4 h-4" />
              {verificationStatus === "rejected" ? "Update Profile" : "View & Complete Profile"}
            </Link>
          </div>

          {/* What's locked */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { icon: CalendarX, label: "Appointments", desc: "Patients cannot book with your clinic until verified." },
              { icon: Users, label: "Patient List", desc: "Patient profiles and management are locked until verification." },
              { icon: FileText, label: "Reports & Stats", desc: "Dashboard analytics will appear once your clinic goes live." },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="bg-white border border-dashed border-gray-200 rounded-2xl p-5 flex flex-col items-center text-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center">
                  <Icon className="w-6 h-6 text-gray-300" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-500">{label}</p>
                  <p className="text-xs text-gray-400 mt-1 leading-snug">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
