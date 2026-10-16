import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  Clock,
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
  ArrowLeft,
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
};

type ClinicDoctorInfo = {
  id: string;
  name: string;
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



const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number | string }>; label?: string }) => {
  if (active && payload && payload.length) {
    const val = Number(payload[0].value);
    return (
      <div className="bg-white/95 backdrop-blur-md border border-magenta-100 text-gray-800 text-xs px-3.5 py-2.5 rounded-xl shadow-xl shadow-magenta-900/10">
        <p className="font-bold text-gray-900 mb-1">{label}</p>
        <div className="flex items-center gap-1.5 text-xs text-[#c0166a] font-semibold">
          <span className="w-2 h-2 rounded-full bg-[#c0166a]"></span>
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
      <div className="bg-white/95 backdrop-blur-md border border-magenta-100 text-gray-800 text-xs px-3.5 py-2.5 rounded-xl shadow-xl shadow-magenta-900/10">
        <p className="font-bold text-gray-900 mb-1">{fullName}</p>
        <div className="flex items-center gap-1.5 text-xs text-[#c0166a] font-semibold">
          <span className="w-2 h-2 rounded-full bg-[#c0166a]"></span>
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
  const [timeframe, setTimeframe] = useState<"week" | "month" | "last-month" | "year">("month");
  const [chartMode, setChartMode] = useState<"trend" | "conditions">("trend");
  const [scheduleDate, setScheduleDate] = useState<Date>(new Date());

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

      let docMap = new Map<string, string>();
      const loadedDoctors: ClinicDoctorInfo[] = [];
      let dbList: any[] = [];
      if (resolvedClinicId) {
        // Fetch doctor names and duty schedules for clinic
        try {
          const { data: docRows } = await supabase
            .from("clinic_doctor")
            .select("doctor_id, doctor_name, duty_days, duty_start_time, duty_end_time, duty_schedule, status")
            .eq("clinic_id", resolvedClinicId);
          if (docRows) {
            docRows.forEach((d: any) => {
              docMap.set(d.doctor_id, d.doctor_name);
              loadedDoctors.push({
                id: d.doctor_id,
                name: d.doctor_name,
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

    const handleSync = () => loadAppointments();
    window.addEventListener("dermai_appointments_updated", handleSync);
    window.addEventListener("dermai_clinic_doctors_updated", handleSync);
    window.addEventListener("appointmentCreated", handleSync);
    window.addEventListener("storage", handleSync);
    window.addEventListener("focus", handleSync);

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      window.removeEventListener("dermai_appointments_updated", handleSync);
      window.removeEventListener("dermai_clinic_doctors_updated", handleSync);
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

  // 3. Upcoming appointments (future scheduled consultations after today)
  const upcomingAppointmentsCount = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return appointments.filter((a) => {
      if (a.status === "rejected" || a.status === "completed") return false;
      if (a.checkInStatus === "completed" || a.checkInStatus === "no-show") return false;
      const d = parseDateStringSafe(a.rawDate || a.date);
      if (!d) return a.status === "pending" || a.doctorStatus === "pending-review";
      const apptDate = new Date(d);
      apptDate.setHours(0, 0, 0, 0);
      return apptDate.getTime() > today.getTime();
    }).length;
  }, [appointments]);

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

  const handleResetToToday = () => {
    setScheduleDate(new Date());
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
    let step = 1;
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
      label: "Total Patient",
      value: uniquePatientCount,
      sub: uniquePatientCount > 0 ? (uniquePatientCount === 1 ? "1 registered patient" : `${uniquePatientCount} registered patients`) : "From appointments",
      highlight: true,
      link: "/clinic/patients",
    },
    {
      label: "Today's Appointment",
      value: todayAppointments.length,
      sub: todayAppointments.length > 0 ? (todayAppointments.length === 1 ? "1 scheduled today" : `${todayAppointments.length} scheduled today`) : "No bookings today",
      highlight: false,
      link: "/clinic/appointments",
    },
    {
      label: "Upcoming Appointments",
      value: upcomingAppointmentsCount,
      sub: upcomingAppointmentsCount > 0 ? (upcomingAppointmentsCount === 1 ? "1 scheduled ahead" : `${upcomingAppointmentsCount} scheduled ahead`) : "No upcoming dates",
      highlight: false,
      link: "/clinic/appointments",
    },
    {
      label: "Avg Time for Appointment",
      value: `${avgTimeMinutes}`,
      sub: "Standard consult (min)",
      highlight: false,
      link: "/clinic/settings",
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
                <div className="h-3 w-16 bg-gray-200 rounded"></div>
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

      {/* ── Top nav ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-[#c0166a]" />
          <span className="text-sm font-semibold text-gray-700">
            {now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </span>
          {verificationStatus === "verified" && (
            <span className="ml-2 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200">
              <CheckCircle2 className="w-3 h-3" /> Active Clinic
            </span>
          )}
        </div>
      </div>

      {/* ── Verified dashboard content ──────────────────────── */}
      {verificationStatus === "verified" ? (
        <>
          {/* ── Top Section: 2x2 Stats & Single Unified Analytics Graph ──── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Stats 2x2 Grid */}
            <div className="lg:col-span-1 grid grid-cols-2 gap-3.5">
              {statCards.map((s, i) => (
                <motion.div
                  key={s.label}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className={`rounded-2xl p-4 flex flex-col justify-between min-h-[115px] relative overflow-hidden shadow-xs hover:shadow-sm transition-all ${
                    s.highlight
                      ? "bg-[#c0166a] text-white"
                      : "bg-white border border-gray-100 text-gray-900"
                  }`}
                >
                  {s.highlight && (
                    <>
                      <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full bg-white/10 pointer-events-none" />
                      <div className="absolute -bottom-6 -left-4 w-24 h-24 rounded-full bg-white/10 pointer-events-none" />
                    </>
                  )}
                  <div className="flex items-center justify-between relative">
                    <p className={`text-xs font-semibold ${s.highlight ? "text-pink-100" : "text-gray-500"}`}>
                      {s.label}
                    </p>
                    <Link
                      to={s.link}
                      className={`w-6 h-6 rounded-full flex items-center justify-center border transition-colors ${
                        s.highlight
                          ? "border-white/40 text-white hover:bg-white/10"
                          : "border-gray-200 text-gray-400 hover:text-gray-700 hover:bg-gray-50"
                      }`}
                      title={`Open ${s.label}`}
                    >
                      <ArrowUpRight className="w-3 h-3" />
                    </Link>
                  </div>
                  <div className="relative">
                    <p className={`text-2xl font-bold leading-none ${s.highlight ? "text-white" : "text-gray-900"}`}>
                      {s.value}
                    </p>
                    <p className={`text-[10px] mt-1 truncate ${s.highlight ? "text-pink-200" : "text-gray-400"}`}>
                      {s.sub}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Single Unified Analytics & Graphs Card */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="lg:col-span-2 bg-white border border-magenta-100/80 shadow-xs rounded-2xl p-5 flex flex-col justify-between"
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
                    className="text-xs border border-gray-200 rounded-lg px-2.5 py-1 text-gray-700 bg-gray-50 hover:bg-gray-100 transition-colors focus:outline-none focus:ring-1 focus:ring-magenta-500 cursor-pointer font-medium"
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
                        <stop offset="5%" stopColor="#c0166a" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#c0166a" stopOpacity={0.0} />
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
                    <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#c0166a40", strokeWidth: 1.5 }} />
                    <Area
                      type="monotone"
                      dataKey="patients"
                      stroke="#c0166a"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#patientTrendGrad)"
                      activeDot={{ r: 5, fill: "#c0166a", stroke: "#fff", strokeWidth: 2 }}
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
                      fill="#c0166a"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={48}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </motion.div>
          </div>

          {/* ── Today's Appointments & Upcoming Schedule ─────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left Card: Today's Appointments */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="lg:col-span-7 bg-white border border-gray-100 shadow-sm rounded-2xl p-6 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2.5">
                    <Calendar className="w-5 h-5 text-[#c0166a]" />
                    <h2 className="text-base font-bold text-gray-900">Today's Appointments</h2>
                  </div>
                  <Link
                    to="/clinic/appointments"
                    className="text-xs text-[#c0166a] font-semibold hover:underline flex items-center gap-1"
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
                      <Calendar className="w-5 h-5 text-[#c0166a]/70" />
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
                            <p className="text-sm font-bold text-gray-900 leading-snug truncate group-hover:text-[#c0166a] transition-colors">{pName}</p>
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
              className="lg:col-span-5 bg-white border border-gray-100 shadow-sm rounded-2xl p-6 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <Calendar className="w-5 h-5 text-[#c0166a]" />
                    <h2 className="text-base font-bold text-gray-900">Upcoming Schedule</h2>
                  </div>
                  <Link
                    to="/clinic/appointments"
                    className="text-xs text-[#c0166a] font-semibold hover:underline flex items-center gap-1"
                  >
                    View calendar &rarr;
                  </Link>
                </div>

                {/* Subheader: Date Navigator */}
                <div className="flex items-center justify-between py-2 mb-4 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handlePrevDay}
                      className="text-gray-500 hover:text-[#c0166a] transition-colors cursor-pointer"
                      title="Previous day"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <span className="text-sm font-bold text-gray-900">
                      {scheduleDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </span>
                    {!isSameDay(scheduleDate, new Date()) && (
                      <button
                        onClick={handleResetToToday}
                        className="text-[10px] font-bold text-[#c0166a] bg-pink-50 hover:bg-pink-100 px-2 py-0.5 rounded-full transition-colors cursor-pointer ml-1"
                      >
                        Today
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handlePrevDay}
                      className="w-7 h-7 rounded-lg border border-gray-100 hover:bg-pink-50 hover:text-[#c0166a] flex items-center justify-center transition-colors cursor-pointer"
                      title="Previous day"
                    >
                      <ChevronLeft className="w-4 h-4 text-gray-400" />
                    </button>
                    <button
                      onClick={handleNextDay}
                      className="w-7 h-7 rounded-lg border border-gray-100 hover:bg-pink-50 hover:text-[#c0166a] flex items-center justify-center transition-colors cursor-pointer"
                      title="Next day"
                    >
                      <ChevronRight className="w-4 h-4 text-gray-400" />
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
                          <div
                            className={cn(
                              "w-1.5 h-10 rounded-full shrink-0",
                              slot.patientCount > 0 ? "bg-[#c0166a]" : "bg-slate-400"
                            )}
                          />
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
                            <span className="inline-flex items-center px-3.5 py-1 rounded-full text-xs font-medium bg-[#fdeef3] text-[#c0166a]">
                              {slot.patientCount} {slot.patientCount === 1 ? "patient" : "patients"}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-3.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
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
