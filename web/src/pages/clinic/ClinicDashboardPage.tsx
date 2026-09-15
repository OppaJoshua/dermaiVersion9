import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  Clock,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  AlertTriangle,
  XCircle,
  FileText,
  Users,
  CalendarX,
  ShieldCheck,
  Calendar,
} from "lucide-react";
import { useClinicVerification } from "@/hooks/useClinicVerification";
import { motion } from "framer-motion";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "@/lib/supabaseClient";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";

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
  status: "pending" | "accepted" | "scheduled" | "rejected";
  meetingLink?: string;
  clinicNote?: string;
  createdAt: string;
  patientName?: string;
  patientEmail?: string;
  patientAge?: number;
  patientAvatar?: string;
  skinPhotoUrl?: string;
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function parseDateStringSafe(str?: string): Date | null {
  if (!str || str === "Schedule pending" || str === "—") return null;
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

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number | string }>; label?: string }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#c0166a] text-white text-xs px-3 py-2 rounded-xl shadow-lg">
        <p className="font-bold">{label}</p>
        <p>{payload[0].value} patients</p>
      </div>
    );
  }
  return null;
};

export default function ClinicDashboardPage() {
  const now = new Date();
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [chartData, setChartData] = useState<Array<{ day: string; patients: number }>>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [weekOffset, setWeekOffset] = useState<number>(0);

  const { status: verificationStatus, clinicName, clinicLogo, clinicId, loading } = useClinicVerification();

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

      let dbList: any[] = [];
      if (resolvedClinicId) {
        const { data, error } = await supabase
          .from("patient_appointment")
          .select(`
            appointment_id,
            clinic_id,
            date,
            status,
            notes,
            clinic_note,
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

      const mapped: AppointmentRecord[] = dbList.map((a: any) => {
        const userObj = Array.isArray(a.user) ? a.user[0] : a.user;
        const pName = a.patient_name || userObj?.full_name || "Patient";
        
        // Use user's real avatar_url or undefined (NEVER use skin_photo_url as profile avatar)
        const userAvatar = (userObj?.avatar_url && !userObj.avatar_url.includes("scan-uploads")) 
          ? userObj.avatar_url 
          : undefined;

        const parsedDate = parseDateStringSafe(a.date);

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
          status: (a.status === "confirmed" || a.status === "scheduled" ? "scheduled" : a.status === "completed" ? "accepted" : a.status === "cancelled" || a.status === "rejected" ? "rejected" : "pending") as AppointmentRecord["status"],
          createdAt: a.created_at || a.date || new Date().toISOString(),
          patientName: pName,
          patientEmail: a.patient_email || undefined,
          patientAvatar: userAvatar,
          skinPhotoUrl: a.skin_photo_url || undefined,
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
                    createdAt: localItem.createdAt || new Date().toISOString(),
                    patientName: localPName,
                    patientEmail: localItem.patientEmail || undefined,
                    patientAvatar: localUserAvatar,
                    skinPhotoUrl: localItem.skinPhotoUrl || undefined,
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

        // Build chart data — count appointments per day-of-week label (excluding rejected)
        const dayCounts: Record<string, number> = {};
        mapped.filter((a) => a.status !== "rejected").forEach((appt) => {
          if (appt.createdAt) {
            const d = new Date(appt.createdAt);
            if (!isNaN(d.getTime())) {
              const label = d.toLocaleDateString("en-PH", { weekday: "short" });
              dayCounts[label] = (dayCounts[label] ?? 0) + 1;
            }
          }
        });
        setChartData(Object.entries(dayCounts).map(([day, patients]) => ({ day, patients })));
      }
    }

    loadAppointments();

    let channel: any = null;
    if (clinicId) {
      channel = supabase
        .channel(`clinic-dashboard-realtime-${clinicId}`)
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
    window.addEventListener("appointmentCreated", handleSync);
    window.addEventListener("storage", handleSync);
    window.addEventListener("focus", handleSync);

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      window.removeEventListener("dermai_appointments_updated", handleSync);
      window.removeEventListener("appointmentCreated", handleSync);
      window.removeEventListener("storage", handleSync);
      window.removeEventListener("focus", handleSync);
    };
  }, [clinicId, clinicName]);

  const pending = appointments.filter((a) => a.status === "pending").length;
  const accepted = appointments.filter((a) => a.status === "accepted" || a.status === "scheduled").length;
  const uniquePatientCount = new Set(appointments.filter((a) => a.status !== "rejected").map((appointment) => appointment.patientName).filter(Boolean)).size;
  const newPatientReferrals = appointments.filter((appointment) => appointment.status === "pending").slice(0, 3);

  // Calendar week calculations
  const displayedWeekDays = useMemo(() => {
    const base = new Date();
    base.setDate(base.getDate() + weekOffset * 7);
    const currentDay = base.getDay();
    const diffToMon = currentDay === 0 ? -6 : 1 - currentDay;
    const monday = new Date(base);
    monday.setDate(base.getDate() + diffToMon);
    monday.setHours(0, 0, 0, 0);

    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
  }, [weekOffset]);

  const calMonth = useMemo(() => {
    if (displayedWeekDays.length < 4) return "";
    const midDay = displayedWeekDays[3];
    return midDay.toLocaleString("en-PH", { month: "long", year: "numeric" });
  }, [displayedWeekDays]);

  // Appointments on currently selected date (excluding rejected/cancelled)
  const selectedDayAppointments = useMemo(() => {
    return appointments.filter((appt) => {
      if (appt.status === "rejected") return false;
      const d = parseDateStringSafe(appt.rawDate || appt.date);
      if (!d) return false;
      return isSameDay(d, selectedDate);
    });
  }, [appointments, selectedDate]);

  // Upcoming scheduled appointments (scheduled or accepted on or after today)
  const upcomingScheduled = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    return appointments
      .filter((appt) => {
        if (appt.status !== "scheduled" && appt.status !== "accepted") return false;
        const d = parseDateStringSafe(appt.rawDate || appt.date);
        if (!d) return false;
        return d.getTime() >= startOfToday.getTime();
      })
      .sort((a, b) => {
        const da = parseDateStringSafe(a.rawDate || a.date)?.getTime() || 0;
        const db = parseDateStringSafe(b.rawDate || b.date)?.getTime() || 0;
        return da - db;
      });
  }, [appointments]);

  const statCards = [
    {
      label: "Total Patients",
      value: uniquePatientCount || pending + accepted,
      sub: uniquePatientCount > 0 || pending + accepted > 0 ? "From appointments" : "No data yet",
      highlight: true,
    },
    {
      label: "Patients Online",
      value: 0,
      sub: "No data yet",
      highlight: false,
    },
    {
      label: "In-Clinic Visit",
      value: accepted,
      sub: accepted > 0 ? "Scheduled appointments" : "No data yet",
      highlight: false,
    },
    {
      label: "Avg Time for Appointment",
      value: "—",
      sub: "min",
      highlight: false,
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
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {clinicLogo ? (
              <img src={clinicLogo} className="w-8 h-8 rounded-full object-cover border-2 border-[#c0166a]" alt={clinicName || "Clinic"} />
            ) : (
              <div className="w-8 h-8 rounded-full bg-[#c0166a] flex items-center justify-center border-2 border-[#c0166a]">
                <span className="text-white text-[10px] font-bold">
                  {(clinicName || "C").charAt(0).toUpperCase()}
                </span>
              </div>
            )}
            <div className="hidden sm:block">
              <div className="flex items-center gap-1">
                <p className="text-xs font-bold text-gray-800 leading-none truncate max-w-[140px]">{clinicName || "Clinic Portal"}</p>
                {verificationStatus === "verified" && (
                  <VerifiedBadge size={14} className="w-3.5 h-3.5" title="Verified Clinic" />
                )}
              </div>
              <p className="text-[10px] text-gray-400 mt-0.5">Dermatology Clinic</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Verified dashboard content ──────────────────────── */}
      {verificationStatus === "verified" ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Stats 2x2 */}
            <div className="lg:col-span-1 grid grid-cols-2 gap-4">
              {statCards.map((s, i) => (
                <motion.div
                  key={s.label}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.07 }}
                  className={`rounded-2xl p-4 flex flex-col justify-between min-h-[110px] relative overflow-hidden shadow-sm ${
                    s.highlight
                      ? "bg-[#c0166a] text-white"
                      : "bg-white border border-magenta-100 text-gray-900"
                  }`}
                >
                  {s.highlight && (
                    <>
                      <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full bg-white/10" />
                      <div className="absolute -bottom-6 -left-4 w-24 h-24 rounded-full bg-white/10" />
                    </>
                  )}
                  <div className="flex items-center justify-between relative">
                    <p className={`text-xs font-semibold ${s.highlight ? "text-pink-100" : "text-gray-500"}`}>
                      {s.label}
                    </p>
                    <button
                      className={`w-6 h-6 rounded-full flex items-center justify-center border ${
                        s.highlight
                          ? "border-white/40 text-white"
                          : "border-gray-200 text-gray-400"
                      }`}
                    >
                      <ArrowUpRight className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="relative">
                    <p className={`text-2xl font-bold leading-none ${s.highlight ? "text-white" : "text-gray-900"}`}>
                      {s.value}
                    </p>
                    <p className={`text-[10px] mt-1 ${s.highlight ? "text-pink-200" : "text-gray-400"}`}>
                      {s.sub}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Line chart */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="lg:col-span-2 bg-white border border-magenta-100 shadow-sm rounded-2xl p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-gray-900">New Patients</h2>
                <select className="text-xs border border-gray-100 rounded-lg px-2 py-1 text-gray-500 bg-gray-50 focus:outline-none">
                  <option>This month</option>
                  <option>Last month</option>
                </select>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#bbb" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#bbb" }} axisLine={false} tickLine={false} domain={[0, 20]} ticks={[0, 5, 10, 15, 20]} />
                  <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#c0166a22", strokeWidth: 2 }} />
                  <Line type="monotone" dataKey="patients" stroke="#c0166a" strokeWidth={2.5} dot={false} activeDot={{ r: 5, fill: "#c0166a", strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            </motion.div>
          </div>

          {/* ── New Patients + Calendar ───────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* New patient referral cards */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="lg:col-span-2 bg-white border border-magenta-100 shadow-sm rounded-2xl p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-gray-900">New Patients</h2>
                <Link to="/clinic/appointments" className="text-xs text-[#c0166a] font-semibold hover:underline">
                  See all
                </Link>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {newPatientReferrals.length === 0 ? (
                  <div className="sm:col-span-3 py-10 flex flex-col items-center justify-center text-center text-gray-400">
                    <Users className="w-8 h-8 text-pink-200 mb-2" />
                    <p className="text-xs font-semibold text-gray-600">No new patient requests yet</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">When patients request an appointment, their referral will appear here.</p>
                  </div>
                ) : (
                  newPatientReferrals.map((appointment) => {
                    const pName = appointment.patientName || "Patient";
                    const avatar = appointment.patientAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(pName)}&background=fce7f3&color=c0166a&bold=true`;
                    const p = {
                      id: appointment.id,
                      name: pName,
                      age: appointment.patientAge,
                      concern: appointment.notes || appointment.conditionName || "Appointment request",
                      avatar,
                    };
                    return (
                      <div key={p.id} className="rounded-2xl border border-magenta-100 shadow-sm p-4 flex flex-col items-center text-center gap-2 hover:border-pink-200 transition-all bg-white">
                        <div className="relative">
                          <img
                            src={p.avatar}
                            alt={p.name}
                            className="w-16 h-16 rounded-full object-cover border-2 border-pink-100 shadow-sm"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src =
                                `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=fce7f3&color=c0166a&bold=true`;
                            }}
                          />
                          <span className="absolute bottom-0 right-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-white bg-[#c0166a] text-white">
                            In-clinic
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-gray-900">{p.name}</p>
                          {p.age && <p className="text-[10px] text-gray-400">{p.age} years old</p>}
                        </div>
                        <p className="text-[11px] text-gray-500 leading-snug line-clamp-2">{p.concern}</p>
                        <div className="flex items-center gap-2 mt-auto w-full pt-1">
                          <Link to="/clinic/appointments" className="flex-1 bg-[#c0166a] hover:bg-[#a01258] text-white text-xs font-semibold py-2 rounded-xl transition-colors text-center shadow-sm">
                            Schedule Date & Time
                          </Link>
                          <Link to="/clinic/appointments" className="w-8 h-8 rounded-xl border border-gray-100 flex items-center justify-center hover:bg-pink-50 transition-colors" title="View details">
                            <MoreVertical className="w-3.5 h-3.5 text-gray-400" />
                          </Link>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>

            {/* Calendar & Scheduled Visits */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              className="bg-white border border-magenta-100 shadow-sm rounded-2xl p-5 space-y-3 flex flex-col justify-between"
            >
              <div>
                {/* Month nav */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-gray-900">{calMonth}</h2>
                    {weekOffset !== 0 && (
                      <button
                        onClick={() => {
                          setWeekOffset(0);
                          setSelectedDate(new Date());
                        }}
                        className="text-[10px] font-bold text-[#c0166a] bg-pink-50 hover:bg-pink-100 px-2 py-0.5 rounded-full transition-colors cursor-pointer"
                      >
                        Today
                      </button>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setWeekOffset((prev) => prev - 1)}
                      className="w-6 h-6 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center hover:bg-pink-50 hover:text-[#c0166a] transition-colors cursor-pointer"
                      title="Previous week"
                    >
                      <ChevronLeft className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                    <button
                      onClick={() => setWeekOffset((prev) => prev + 1)}
                      className="w-6 h-6 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center hover:bg-pink-50 hover:text-[#c0166a] transition-colors cursor-pointer"
                      title="Next week"
                    >
                      <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                  </div>
                </div>

                {/* Day labels */}
                <div className="grid grid-cols-7 text-center mb-1">
                  {DAYS.map((d) => (
                    <span key={d} className="text-[10px] text-gray-400 font-semibold">{d}</span>
                  ))}
                </div>

                {/* Date row */}
                <div className="grid grid-cols-7 text-center gap-y-1">
                  {displayedWeekDays.map((d) => {
                    const isSelected = isSameDay(d, selectedDate);
                    const isToday = isSameDay(d, new Date());
                    const hasAppt = appointments.some((a) => {
                      if (a.status === "rejected") return false;
                      const apptDate = parseDateStringSafe(a.rawDate || a.date);
                      return apptDate ? isSameDay(apptDate, d) : false;
                    });

                    return (
                      <button
                        key={d.toISOString()}
                        onClick={() => setSelectedDate(d)}
                        className={`w-7 h-7 mx-auto rounded-full text-[11px] font-semibold flex flex-col items-center justify-center relative transition-all cursor-pointer ${
                          isSelected
                            ? "bg-[#c0166a] text-white shadow-md font-bold"
                            : isToday
                            ? "text-[#c0166a] border border-[#c0166a]/40 bg-pink-50/60 hover:bg-pink-100"
                            : "text-gray-600 hover:bg-pink-50"
                        }`}
                      >
                        <span>{d.getDate()}</span>
                        {hasAppt && (
                          <span
                            className={`absolute bottom-0.5 w-1 h-1 rounded-full ${
                              isSelected ? "bg-white" : "bg-[#c0166a]"
                            }`}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Selected Date subheader */}
                <div className="flex items-center justify-between pt-3 pb-1 border-b border-gray-100">
                  <p className="text-[11px] font-bold text-gray-700">
                    {isSameDay(selectedDate, new Date())
                      ? "Today's Visits"
                      : selectedDate.toLocaleDateString("en-PH", { month: "short", day: "numeric", weekday: "short" })}
                  </p>
                  <span className="text-[10px] font-semibold text-gray-400">
                    {selectedDayAppointments.length} scheduled
                  </span>
                </div>
              </div>

              {/* Appointments list */}
              <div className="space-y-2 pt-1 min-h-[140px] flex flex-col justify-center">
                {selectedDayAppointments.length > 0 ? (
                  <div className="space-y-2">
                    {selectedDayAppointments.slice(0, 3).map((appointment) => {
                      const pName = appointment.patientName || "Patient";
                      const avatar = appointment.patientAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(pName)}&background=fce7f3&color=c0166a&bold=true`;
                      const timeDisplay = appointment.time && appointment.time !== "—" ? appointment.time : "Scheduled";

                      return (
                        <Link
                          key={appointment.id}
                          to="/clinic/appointments"
                          className="flex items-center gap-2.5 p-2 rounded-xl border border-pink-100/60 bg-pink-50/30 hover:bg-pink-50 transition-colors group"
                        >
                          <img
                            src={avatar}
                            alt={pName}
                            className="w-8 h-8 rounded-full object-cover shrink-0 border border-pink-200"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(pName)}&background=fce7f3&color=c0166a&size=64`;
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-gray-800 truncate group-hover:text-[#c0166a] transition-colors">{pName}</p>
                            <p className="text-[10px] text-gray-400 truncate">{appointment.conditionName || "Consultation"}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-[10px] font-bold text-[#c0166a] bg-white px-2 py-0.5 rounded-md border border-pink-200 shadow-2xs">
                              {timeDisplay}
                            </span>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                ) : upcomingScheduled.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[10px] text-gray-400 font-medium px-1">
                      <span>No visits on this date</span>
                      <span className="text-[#c0166a] font-semibold">Upcoming:</span>
                    </div>
                    {upcomingScheduled.slice(0, 2).map((appointment) => {
                      const pName = appointment.patientName || "Patient";
                      const avatar = appointment.patientAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(pName)}&background=fce7f3&color=c0166a&bold=true`;
                      const parsedD = parseDateStringSafe(appointment.rawDate || appointment.date);
                      const dateLabel = parsedD ? parsedD.toLocaleDateString("en-PH", { month: "short", day: "numeric" }) : appointment.date;

                      return (
                        <Link
                          key={appointment.id}
                          to="/clinic/appointments"
                          className="flex items-center gap-2.5 p-2 rounded-xl border border-gray-100 bg-gray-50/50 hover:bg-pink-50/40 transition-colors group"
                        >
                          <img
                            src={avatar}
                            alt={pName}
                            className="w-7 h-7 rounded-full object-cover shrink-0 border border-gray-200"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(pName)}&background=fce7f3&color=c0166a&size=56`;
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-gray-800 truncate group-hover:text-[#c0166a] transition-colors">{pName}</p>
                            <p className="text-[10px] text-gray-400 truncate">{appointment.conditionName || "Consultation"}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-[9px] font-semibold text-gray-600 leading-tight block">
                              {dateLabel}
                              {appointment.time && appointment.time !== "—" && (
                                <span className="text-[#c0166a] block font-bold">{appointment.time}</span>
                              )}
                            </span>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                ) : pending > 0 ? (
                  <div className="py-4 px-3 flex flex-col items-center justify-center text-center rounded-xl bg-pink-50/40 border border-pink-100/60">
                    <Clock className="w-6 h-6 text-[#c0166a] mb-1.5 opacity-80" />
                    <p className="text-xs font-bold text-gray-800">No scheduled visits yet</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      {pending} patient request{pending > 1 ? "s" : ""} waiting for a schedule.
                    </p>
                    <Link
                      to="/clinic/appointments"
                      className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#c0166a] hover:bg-[#a01258] text-white text-[11px] font-bold rounded-xl transition-colors shadow-sm"
                    >
                      <Calendar className="w-3 h-3" />
                      Schedule Date & Time
                    </Link>
                  </div>
                ) : (
                  <div className="py-6 flex flex-col items-center justify-center text-center text-gray-400">
                    <CalendarX className="w-7 h-7 text-pink-200 mb-1.5" />
                    <p className="text-xs font-semibold text-gray-600">No appointments scheduled</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">When visits are scheduled, they will show here.</p>
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
