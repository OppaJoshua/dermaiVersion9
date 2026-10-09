import { Link } from "react-router-dom";
import {
    Camera,
    MapPin,
    ChevronRight,
    Calendar,
    User,
    TrendingUp,
    Shield,
    Clock,
  Bell,
  CheckCircle2,
  XCircle,
  X,
} from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { skinConditions } from "../public/SkinLibrary";
import { supabase } from "@/lib/supabaseClient";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { getCachedPatientNotifications } from "@/lib/notificationService";
import { getSignedSkinPhotoUrl } from "@/lib/storageUtils";

type AppointmentRecord = {
  id: string;
  clinicId: number;
  clinicName: string;
  patientName?: string;
  patientAge?: number;
  patientAvatar?: string;
  consultationType: "face-to-face";
  conditionId?: string;
  conditionName?: string;
  conditionImage?: string;
  date: string;
  time: string;
  notes: string;
  status: "pending" | "accepted" | "scheduled" | "rejected" | "cancelled" | "completed";
  meetingLink?: string;
  clinicNote?: string;
  createdAt: string;
};

type AnalysisRecord = {
  id: string | number;
  conditionId?: string;
  condition: string;
  confidence: number;
  date: string;
  severity: string;
  severityColor: string;
  bodyPart: string;
};

type QuickStats = {
  totalScans: string;
  conditionsFound: string;
  clinicsSaved: string;
  lastScan: string;
};

const skinTips = [
  {
    title: "Daily Sunscreen",
    desc: "Apply SPF 30+ sunscreen daily, even on cloudy days in Cebu.",
    icon: Shield,
  },
  {
    title: "Stay Hydrated",
    desc: "Drink 8+ glasses of water daily for healthy skin.",
    icon: TrendingUp,
  },
];

import { useAuth } from "@/context/AuthContext";

export default function PatientDashboard() {
  const { session } = useAuth();
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [profile, setProfile] = useState<{ fullName: string; profilePicture?: string }>({
    fullName: "",
  });
  const [history, setHistory] = useState<AnalysisRecord[]>([]);
  const [stats, setStats] = useState<QuickStats>({
    totalScans: "0",
    conditionsFound: "0",
    clinicsSaved: "0",
    lastScan: "—",
  });
  const [loading, setLoading] = useState(true);

  type PatientNotif = {
    id: string;
    type: "appointment-scheduled" | "appointment-rejected";
    title: string;
    message: string;
    clinicName?: string;
    timestamp: string;
    read: boolean;
  };
  const [notifications, setNotifications] = useState<PatientNotif[]>([]);

  const dismissNotif = async (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        const key = `dermai_patient_notifications_${session.user.id}`;
        const raw = localStorage.getItem(key);
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            const patched = list.map((item: any) =>
              item.id === id ? { ...item, isRead: true } : item
            );
            localStorage.setItem(key, JSON.stringify(patched));
          }
        }
      }
    } catch {}
    await supabase.from("user_notification").update({ is_read: true }).eq("notif_id", id);
  };

  const clearAllNotifs = async () => {
    const ids = notifications.map((n) => n.id);
    setNotifications([]);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        const key = `dermai_patient_notifications_${session.user.id}`;
        const raw = localStorage.getItem(key);
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            const patched = list.map((item: any) => ({ ...item, isRead: true }));
            localStorage.setItem(key, JSON.stringify(patched));
          }
        }
      }
    } catch {}
    if (ids.length > 0) {
      await supabase.from("user_notification").update({ is_read: true }).in("notif_id", ids);
    }
  };

  useEffect(() => {
    const loadDashboardData = async () => {
      setLoading(true);

      // Guard outside try so the finally always fires
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) {
        setLoading(false);
        return;
      }

      try {
        // Fetch user profile
        const { data: userRow } = await supabase
          .from("user")
          .select("full_name, avatar_url")
          .eq("user_id", userId)
          .maybeSingle();

        const meta = session?.user?.user_metadata || {};
        let localProfile: any = null;
        try {
          const raw = localStorage.getItem(`derm_profile_${userId}`);
          if (raw) localProfile = JSON.parse(raw);
        } catch {}

        const avatar = userRow?.avatar_url || localProfile?.profilePicture || meta.avatar_url || meta.picture || "";
        const name = userRow?.full_name ?? localProfile?.fullName ?? meta.full_name ?? meta.name ?? "";
        setProfile({ fullName: name, profilePicture: avatar });

        // Fetch recent appointments
        const { data: apptRows } = await supabase
          .from("patient_appointment")
          .select(`
            appointment_id,
            date,
            status,
            doctor_status,
            doctor_note,
            ai_condition_name,
            condition_id,
            skin_photo_url,
            primary_scan_id,
            created_at,
            clinic:clinic_id ( name )
          `)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(10);

        // Pre-fetch scan photo for appointments that have primary_scan_id but missing skin_photo_url
        const missingScanIds = (apptRows ?? [])
          .filter((a: any) => !a.skin_photo_url && a.primary_scan_id)
          .map((a: any) => a.primary_scan_id);

        const scanPhotoMap = new Map<string, string>();
        if (missingScanIds.length > 0) {
          try {
            const { data: scanData } = await supabase
              .from("ai_scan_result")
              .select("analysis_id, photo_url")
              .in("analysis_id", missingScanIds);
            (scanData ?? []).forEach((s: any) => {
              if (s.analysis_id && s.photo_url) {
                scanPhotoMap.set(s.analysis_id, s.photo_url);
              }
            });
          } catch (err) {
            console.warn("Failed to fetch primary scan photos:", err);
          }
        }

        const mappedAppts: AppointmentRecord[] = await Promise.all(
          (apptRows ?? []).map(async (a: any) => {
            const clinicObj = Array.isArray(a.clinic) ? a.clinic[0] : a.clinic;
            const apptDate = a.date ? new Date(a.date) : null;
            const isValidDate = apptDate && !isNaN(apptDate.getTime());
            const dateStr = isValidDate
              ? apptDate.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })
              : "Date pending";

            const timeStr = isValidDate && a.date?.includes("T")
              ? apptDate.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", hour12: true })
              : "";

            let statusVal: AppointmentRecord["status"] = "pending";
            if (a.status === "confirmed" || a.status === "scheduled" || a.doctor_status === "approved") {
              statusVal = "scheduled";
            } else if (a.status === "completed") {
              statusVal = "completed";
            } else if (a.status === "cancelled") {
              statusVal = "cancelled";
            } else if (a.status === "rejected") {
              statusVal = "rejected";
            }

            let docDiagnosis = "";
            if (a.doctor_note) {
              const match = a.doctor_note.match(/^Diagnosis:\s*([^|\n]+)(?:[|\n]\s*(?:Note:\s*)?(.*))?$/is);
              if (match) {
                docDiagnosis = match[1]?.trim() || "";
              } else {
                docDiagnosis = a.doctor_note.trim();
              }
            }

            const rawPhotoPath = a.skin_photo_url || (a.primary_scan_id ? scanPhotoMap.get(a.primary_scan_id) : undefined);
            let conditionImage: string | undefined = undefined;
            if (rawPhotoPath) {
              const signed = await getSignedSkinPhotoUrl(rawPhotoPath);
              if (signed) {
                conditionImage = signed;
              }
            }

            return {
              id: a.appointment_id,
              clinicId: 0,
              clinicName: clinicObj?.name ?? "Clinic",
              consultationType: "face-to-face" as const,
              conditionId: a.condition_id || undefined,
              conditionName: docDiagnosis || a.ai_condition_name || undefined,
              conditionImage,
              date: dateStr,
              time: timeStr,
              notes: "",
              status: statusVal,
              createdAt: a.created_at || new Date().toISOString(),
            };
          })
        );

        // Merge offline/optimistic appointments from local storage
        try {
          const rawLocal = localStorage.getItem("dermai_clinic_appointments");
          if (rawLocal) {
            const parsedLocal = JSON.parse(rawLocal);
            if (Array.isArray(parsedLocal)) {
              for (const localItem of parsedLocal) {
                const localPhoto = localItem.skinPhotoUrl || localItem.conditionImage;
                const existing = mappedAppts.find((m) => m.id === localItem.id);
                if (existing) {
                  if (!existing.conditionImage && localPhoto) {
                    const signed = await getSignedSkinPhotoUrl(localPhoto);
                    if (signed) existing.conditionImage = signed;
                  }
                } else {
                  const pDate = localItem.date ? new Date(localItem.date) : null;
                  const isValid = pDate && !isNaN(pDate.getTime());
                  let localDisplayImage: string | undefined = undefined;
                  if (localPhoto) {
                    const signed = await getSignedSkinPhotoUrl(localPhoto);
                    if (signed) localDisplayImage = signed;
                  }
                  mappedAppts.unshift({
                    id: localItem.id,
                    clinicId: localItem.clinicId || 0,
                    clinicName: localItem.clinicName || "Clinic",
                    consultationType: "face-to-face" as const,
                    conditionId: localItem.conditionId || undefined,
                    conditionName: localItem.aiConditionName || localItem.conditionName || "Skin concern",
                    conditionImage: localDisplayImage,
                    date: isValid ? pDate.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : (localItem.date || "Date pending"),
                    time: localItem.time || (isValid && localItem.date?.includes("T") ? pDate.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", hour12: true }) : ""),
                    notes: localItem.notes || "",
                    status: (localItem.status === "cancelled" ? "cancelled" : localItem.status === "confirmed" || localItem.status === "scheduled" || localItem.doctorStatus === "approved" ? "scheduled" : localItem.status === "completed" ? "completed" : localItem.status === "rejected" ? "rejected" : "pending") as AppointmentRecord["status"],
                    createdAt: localItem.createdAt || new Date().toISOString(),
                  });
                }
              }
            }
          }
        } catch {}

        setAppointments(mappedAppts);

        // Fetch scan history
        const { data: scanRows } = await supabase
          .from("ai_scan_result")
          .select(`
            analysis_id,
            confidence_score,
            scanned_at,
            body_part,
            photo_url,
            condition_id,
            skin_condition:condition_id ( condition_id, name )
          `)
          .eq("user_id", userId)
          .eq("status", "completed")
          .order("scanned_at", { ascending: false })
          .limit(5);

        // Fallback: If any appointment is still missing an image, match with user's completed scans
        let appointmentsUpdated = false;
        for (const appt of mappedAppts) {
          if (!appt.conditionImage) {
            const matchedScan = (scanRows ?? []).find((s: any) => {
              const scObj = Array.isArray(s.skin_condition) ? s.skin_condition[0] : s.skin_condition;
              const matchesId = appt.conditionId && s.condition_id === appt.conditionId;
              const matchesName = appt.conditionName && scObj?.name && scObj.name.toLowerCase() === appt.conditionName.toLowerCase();
              return (matchesId || matchesName) && Boolean(s.photo_url);
            });
            if (matchedScan?.photo_url) {
              const signed = await getSignedSkinPhotoUrl(matchedScan.photo_url);
              if (signed) {
                appt.conditionImage = signed;
                appointmentsUpdated = true;
              }
            }
          }
        }
        if (appointmentsUpdated) {
          setAppointments([...mappedAppts]);
        }

        const mappedHistory: AnalysisRecord[] = (scanRows ?? []).map((s: any) => {
          const skinConditionObj = Array.isArray(s.skin_condition) ? s.skin_condition[0] : s.skin_condition;
          return {
            id: s.analysis_id,
            conditionId: skinConditionObj?.condition_id ?? undefined,
            condition: skinConditionObj?.name ?? "Unknown",
            confidence: Math.round(s.confidence_score),
            date: new Date(s.scanned_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }),
            severity: s.confidence_score >= 80 ? "High" : s.confidence_score >= 50 ? "Moderate" : "Low",
            severityColor: s.confidence_score >= 80 ? "text-red-500" : s.confidence_score >= 50 ? "text-amber-500" : "text-green-500",
            bodyPart: s.body_part ?? "Unknown",
          };
        });
        setHistory(mappedHistory);

        // Fetch exact total scans count from ai_scan_result
        const { count: exactScanCount } = await supabase
          .from("ai_scan_result")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("status", "completed");

        const conditions = new Set((scanRows ?? []).map((s: any) => {
          const sc = Array.isArray(s.skin_condition) ? s.skin_condition[0] : s.skin_condition;
          return sc?.name;
        }).filter(Boolean));
        const lastScan = (scanRows ?? []).length > 0
          ? new Date((scanRows![0] as { scanned_at: string }).scanned_at).toLocaleDateString("en-PH", { month: "short", day: "numeric" })
          : "—";

        // Fetch real saved-clinic count from user_saved_clinic table
        const { count: savedCount } = await supabase
          .from("user_saved_clinic")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId);

        setStats({
          totalScans: String(exactScanCount ?? 0),
          conditionsFound: String(conditions.size),
          clinicsSaved: String(savedCount ?? 0),
          lastScan,
        });

        // Fetch notifications ordered by created_at descending
        const { data: notifRows, error: notifErr } = await supabase
          .from("user_notification")
          .select("notif_id, type, subtype, title, body, is_read, created_at")
          .eq("user_id", userId)
          .eq("is_read", false)
          .order("created_at", { ascending: false })
          .limit(10);

        if (!notifErr && notifRows && notifRows.length > 0) {
          setNotifications(notifRows.map((n: {
            notif_id: string;
            type: string;
            subtype: string | null;
            title: string;
            body: string | null;
            is_read: boolean;
            created_at: string;
          }) => ({
            id: n.notif_id,
            type: (n.type === "appointment-rejected" ? "appointment-rejected" : "appointment-scheduled") as PatientNotif["type"],
            title: n.title,
            message: n.body || n.subtype || "",
            timestamp: n.created_at || new Date().toISOString(),
            read: n.is_read,
          })));
        } else {
          // Fallback to local cached unread notifications
          const cached = getCachedPatientNotifications(userId);
          const unreadCached = (Array.isArray(cached) ? cached : []).filter((n: any) => !n.isRead);
          setNotifications(unreadCached.map((n: any) => ({
            id: n.id,
            type: (n.type === "appointment-rejected" ? "appointment-rejected" : "appointment-scheduled") as PatientNotif["type"],
            title: n.title,
            message: n.body || n.subtype || "",
            timestamp: n.createdAt || new Date().toISOString(),
            read: Boolean(n.isRead),
          })));
        }
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
      } finally {
        setLoading(false);
      }
    };

    loadDashboardData();

    const handleProfileUpdate = () => {
      loadDashboardData();
    };

    window.addEventListener("derm_profile_updated", handleProfileUpdate);
    window.addEventListener("dermai_notifications_updated", handleProfileUpdate);
    window.addEventListener("dermai_appointments_updated", handleProfileUpdate);
    window.addEventListener("appointmentCreated", handleProfileUpdate);
    window.addEventListener("storage", handleProfileUpdate);

    return () => {
      window.removeEventListener("derm_profile_updated", handleProfileUpdate);
      window.removeEventListener("dermai_notifications_updated", handleProfileUpdate);
      window.removeEventListener("dermai_appointments_updated", handleProfileUpdate);
      window.removeEventListener("appointmentCreated", handleProfileUpdate);
      window.removeEventListener("storage", handleProfileUpdate);
    };
  }, [session]);

  const fallbackImage = skinConditions[0]?.image;

  const getConditionFallbackImage = (conditionName?: string) => {
    if (conditionName) {
      const clean = conditionName.trim().toLowerCase();
      const match = skinConditions.find((c) => {
        const cName = c.name.toLowerCase();
        return cName === clean || clean.includes(cName) || cName.includes(clean);
      });
      if (match?.image) return match.image;
    }
    return fallbackImage;
  };

  const firstName = profile.fullName ? profile.fullName.split(" ")[0] : "there";

  return (
    <div className="w-full">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-gray-900">
            Good morning, {firstName}!
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Here's your skin health overview — stay informed, stay healthy.
          </p>
        </motion.div>

        {/* Clinic Notifications */}
        {notifications.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-magenta-500" />
                <span className="text-sm font-bold text-gray-800">Clinic Notifications</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-magenta-500 text-white font-bold">{notifications.length}</span>
              </div>
              <button onClick={clearAllNotifs} className="text-xs text-gray-400 hover:text-gray-600 font-medium">Clear all</button>
            </div>
            <div className="space-y-2">
              {notifications.map((notif) => (
                <div
                  key={notif.id}
                  className={`flex items-start gap-3 p-4 rounded-2xl border ${
                    notif.type === "appointment-scheduled"
                      ? "bg-green-50 border-green-200"
                      : "bg-red-50 border-red-200"
                  }`}
                >
                  {notif.type === "appointment-scheduled" ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold ${notif.type === "appointment-scheduled" ? "text-green-800" : "text-red-800"}`}>
                      {notif.title}
                    </p>
                    <p className="text-xs text-gray-600 mt-0.5">{notif.message}</p>
                    <p className="text-[11px] text-gray-400 mt-1">
                      {new Date(notif.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      {" · "}
                      {new Date(notif.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
                    </p>
                  </div>
                  <button
                    onClick={() => dismissNotif(notif.id)}
                    className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center hover:bg-black/10 transition-colors"
                  >
                    <X className="w-3.5 h-3.5 text-gray-500" />
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Quick Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Total Scans", value: stats.totalScans, icon: Camera, color: "text-magenta-500" },
            { label: "Conditions Found", value: stats.conditionsFound, icon: Calendar, color: "text-blue-500" },
            { label: "Clinics Saved", value: stats.clinicsSaved, icon: MapPin, color: "text-emerald-500" },
            { label: "Last Scan", value: stats.lastScan, icon: Clock, color: "text-amber-500" },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="bg-white rounded-2xl p-4 border border-gray-100 hover:border-gray-200 transition-all hover:shadow-sm"
            >
              <div className={`${stat.color} mb-3`}>
                <stat.icon className="w-6 h-6" />
              </div>
              <p className="text-xl font-display font-bold text-gray-900">
                {loading ? <span className="inline-block w-6 h-4 rounded bg-gray-100 animate-pulse" /> : stat.value}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{stat.label}</p>
            </motion.div>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Link
              to="/dashboard/scan"
              className="group flex items-center gap-5 bg-linear-to-r from-magenta-500 to-magenta-600 rounded-2xl p-6 text-white hover:shadow-lg hover:shadow-magenta-500/20 transition-all"
            >
              <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center group-hover:scale-105 transition-transform shrink-0">
                <Camera className="w-7 h-7" />
              </div>
              <div className="flex-1">
                <h3 className="font-display font-bold text-lg mb-0.5">Scan Your Skin</h3>
                <p className="text-magenta-100 text-sm">AI-powered analysis in seconds</p>
              </div>
              <ChevronRight className="w-5 h-5 text-white/60 group-hover:translate-x-1 transition-transform" />
            </Link>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <Link
              to="/dashboard/clinics"
              className="group flex items-center gap-5 bg-white rounded-2xl p-6 border border-gray-100 hover:border-magenta-200 hover:shadow-sm transition-all"
            >
              <div className="flex items-center justify-center group-hover:scale-105 transition-transform shrink-0">
                <MapPin className="w-7 h-7 text-magenta-500" />
              </div>
              <div className="flex-1">
                <h3 className="font-display font-bold text-lg text-gray-900 mb-0.5">Find a Clinic</h3>
                <p className="text-gray-400 text-sm">Verified dermatologists near you</p>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-300 group-hover:translate-x-1 group-hover:text-magenta-400 transition-all" />
            </Link>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <Link
              to="/dashboard/clinics"
              className="group flex items-center gap-5 bg-white rounded-2xl p-6 border border-gray-100 hover:border-magenta-200 hover:shadow-sm transition-all"
            >
              <div className="flex items-center justify-center group-hover:scale-105 transition-transform shrink-0">
                <Calendar className="w-7 h-7 text-amber-500" />
              </div>
              <div className="flex-1">
                <h3 className="font-display font-bold text-lg text-gray-900 mb-0.5">Book Appointment</h3>
                <p className="text-gray-400 text-sm">Find verified clinic and schedule</p>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-300 group-hover:translate-x-1 group-hover:text-amber-500 transition-all" />
            </Link>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22 }}
          className="mb-8 bg-white rounded-2xl border border-gray-100 overflow-hidden"
        >
          <div className="px-6 pt-5 pb-3 flex items-center justify-between">
            <h2 className="font-display font-bold text-gray-900">My Appointments</h2>
            <Link to="/dashboard/appointment-status" className="text-xs text-magenta-600 font-semibold hover:text-magenta-700">
              Manage
            </Link>
          </div>
          <div className="px-6 pb-5 space-y-3">
            {appointments.slice(0, 3).map((item) => (
              <div key={item.id} className="rounded-xl border border-gray-100 bg-gray-50/70 p-3 flex gap-3">
                <img
                  src={item.conditionImage || getConditionFallbackImage(item.conditionName)}
                  alt={item.conditionName || "Skin condition"}
                  className="w-14 h-14 rounded-lg object-cover border border-gray-200"
                  onError={(e) => {
                    const fallback = getConditionFallbackImage(item.conditionName);
                    if ((e.currentTarget as HTMLImageElement).src !== fallback) {
                      (e.currentTarget as HTMLImageElement).src = fallback;
                    }
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-xs font-semibold text-gray-900 truncate">{item.conditionName || "Skin concern"}</p>
                    <span
                      className={`text-[10px] px-2.5 py-0.5 rounded-full border font-semibold ${
                        item.status === "scheduled" || item.status === "accepted"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : item.status === "cancelled"
                          ? "bg-gray-100 text-gray-600 border-gray-200"
                          : item.status === "rejected"
                          ? "bg-rose-50 text-rose-700 border-rose-200"
                          : item.status === "completed"
                          ? "bg-green-50 text-green-700 border-green-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                      }`}
                    >
                      {item.status === "scheduled" || item.status === "accepted"
                        ? "Scheduled"
                        : item.status === "cancelled"
                        ? "Cancelled"
                        : item.status === "rejected"
                        ? "Declined"
                        : item.status === "completed"
                        ? "Completed"
                        : "Pending Review"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <p className="text-[11px] text-gray-600 truncate font-medium">{item.clinicName}</p>
                    <VerifiedBadge size={13} className="w-3.5 h-3.5" title="Verified Clinic" />
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1 flex items-center gap-3">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      Face-to-face
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> {item.date || "Schedule pending"} {item.time ? `· ${item.time}` : ""}
                    </span>
                  </div>
                </div>
              </div>
            ))}
            {!loading && appointments.length === 0 && (
              <p className="text-xs text-gray-500">No appointment requests yet.</p>
            )}
          </div>
        </motion.div>

        <div className="space-y-6">
          {/* Recent Analyses */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-2xl border border-gray-100 overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 pt-5 pb-4">
              <h2 className="font-display font-bold text-gray-900">Recent Analyses</h2>
              <Link to="/dashboard/history" className="text-xs text-magenta-500 font-semibold flex items-center gap-1 hover:text-magenta-600 transition-colors">
                View All <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="px-6 pb-5 space-y-3">
              {history.map((analysis, i) => (
                <Link key={analysis.id} to="/dashboard/history" className="block">
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.25 + i * 0.08 }}
                    className="flex items-center gap-4 p-4 rounded-xl bg-gray-50/70 hover:bg-gray-50 transition-colors group cursor-pointer"
                  >
                    <div className="relative w-12 h-12 shrink-0">
                      <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
                        <path
                          className="text-gray-200"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        />
                        <path
                          className="text-magenta-500"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeDasharray={`${analysis.confidence}, 100`}
                        />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-gray-700">
                        {analysis.confidence}%
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-semibold text-gray-900 text-sm truncate">{analysis.condition}</h4>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-400">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" /> {analysis.date}
                        </span>
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" /> {analysis.bodyPart}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-magenta-400 group-hover:translate-x-0.5 transition-all shrink-0" />
                  </motion.div>
                </Link>
              ))}
              {!loading && history.length === 0 && (
                <div className="text-center py-6">
                  <p className="text-gray-400 text-sm">No analysis history yet.</p>
                  <Link to="/dashboard/scan" className="text-magenta-500 text-xs font-semibold mt-2 inline-block">Start your first scan</Link>
                </div>
              )}
            </div>
          </motion.div>

          {/* Skin Tips */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            {skinTips.map((tip) => (
              <div key={tip.title} className="bg-white rounded-2xl p-5 border border-gray-100 flex items-start gap-4">
                <div className="flex items-center justify-center shrink-0">
                  <tip.icon className="w-5 h-5 text-magenta-500" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-0.5">{tip.title}</h4>
                  <p className="text-xs text-gray-400 leading-relaxed">{tip.desc}</p>
                </div>
              </div>
            ))}
          </motion.div>

          {/* Health Reminder */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            className="bg-linear-to-br from-magenta-50 to-pink-50 rounded-2xl border border-magenta-100 p-5"
          >
            <p className="text-xs font-semibold text-magenta-600 mb-1">⚕️ Reminder</p>
            <p className="text-xs text-magenta-500 leading-relaxed">
              DERMAI provides AI-assisted analysis only. Always consult a licensed dermatologist for proper diagnosis and treatment.
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
