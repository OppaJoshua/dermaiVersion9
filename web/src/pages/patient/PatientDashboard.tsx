import { Link } from "react-router-dom";
import {
  Camera,
  MapPin,
  ChevronRight,
  Calendar,
  User,
  TrendingUp,
  Shield,
  ArrowUpRight,
  Stethoscope,
} from "lucide-react";
import { cn, formatConfidencePercent } from "@/lib/utils";
import { motion } from "framer-motion";
import { useEffect, useState, useMemo } from "react";
import { skinConditions } from "../public/SkinLibrary";
import { supabase } from "@/lib/supabaseClient";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { getSignedSkinPhotoUrl } from "@/lib/storageUtils";
import { useAuth } from "@/context/AuthContext";

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

  useEffect(() => {
    const loadDashboardData = async () => {
      setLoading(true);

      // Guard outside try so the finally always fires
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      const userId = currentSession?.user?.id;
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

        const meta = currentSession?.user?.user_metadata || {};
        let localProfile: any = null;
        try {
          const raw = localStorage.getItem(`derm_profile_${userId}`);
          if (raw) localProfile = JSON.parse(raw);
        } catch { }

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
        } catch { }

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
            photo_url_wide,
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
              return (matchesId || matchesName) && Boolean(s.photo_url || s.photo_url_wide);
            });
            const photoToSign = matchedScan?.photo_url || matchedScan?.photo_url_wide;
            if (photoToSign) {
              const signed = await getSignedSkinPhotoUrl(photoToSign);
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
            confidence: Number(s.confidence_score ?? 0),
            date: new Date(s.scanned_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }),
            severity: s.confidence_score >= 80 ? "High" : s.confidence_score >= 50 ? "Moderate" : "Low",
            severityColor: s.confidence_score >= 80 ? "text-red-500" : s.confidence_score >= 50 ? "text-amber-500" : "text-green-500",
            bodyPart: s.body_part ?? "Skin Assessment",
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

  const firstName = useMemo(() => {
    if (!profile.fullName) return "there";
    const clean = profile.fullName.trim();
    if (clean.includes(",")) {
      const parts = clean.split(",");
      const first = parts[1]?.trim().split(" ")[0]?.trim();
      if (first) return first;
      return parts[0].trim().replace(/,/g, "");
    }
    return clean.split(" ")[0]?.trim().replace(/,/g, "") || "there";
  }, [profile.fullName]);

  const card = "bg-white rounded-3xl border border-gray-100";

  const statTiles = [
    { label: "Total Scans", value: stats.totalScans },
    { label: "Conditions Found", value: stats.conditionsFound },
    { label: "Clinics Saved", value: stats.clinicsSaved },
    { label: "Last Scan", value: stats.lastScan },
  ];

  return (
    <div className="w-full">
      <div className="px-4 sm:px-6 pb-6 pt-2">
        {/* Breadcrumb now rendered by the patient layout header */}

        {/* Title row */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4"
        >
          <div>
            <h1 className="text-3xl sm:text-4xl font-display font-bold text-gray-900 tracking-tight">
              Hello, {firstName}!
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              Here's your skin health overview — stay informed, stay healthy.
            </p>
          </div>
        </motion.div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Stat tiles */}
          {statTiles.map((stat, i) => {
            const featured = i === 0;
            return (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className={cn(
                  "lg:col-span-3 relative overflow-hidden rounded-3xl p-5 min-h-36 flex flex-col justify-between",
                  featured
                    ? "bg-gradient-to-br from-[#8a1553] via-[#b02a72] to-[#db6597] text-white shadow-lg shadow-[#8a1553]/20"
                    : "bg-white border border-gray-100 text-gray-900 shadow-2xs"
                )}
              >
                {featured && (
                  <div className="absolute -bottom-16 -right-10 w-44 h-44 rounded-full bg-white/10 pointer-events-none" />
                )}
                <div className="relative flex items-start justify-between gap-2">
                  <p className={cn("text-sm font-semibold", featured ? "text-white" : "text-gray-600")}>
                    {stat.label}
                  </p>
                  <span
                    className={cn(
                      "w-10 h-10 rounded-full border flex items-center justify-center shrink-0",
                      featured ? "border-white/60 text-white" : "border-gray-200 text-gray-800"
                    )}
                  >
                    <ArrowUpRight className="w-5 h-5" />
                  </span>
                </div>
                <p className="relative text-4xl font-display font-bold tracking-tight">
                  {loading ? (
                    <span
                      className={cn(
                        "inline-block w-10 h-8 rounded-lg animate-pulse",
                        featured ? "bg-white/25" : "bg-gray-100"
                      )}
                    />
                  ) : (
                    stat.value
                  )}
                </p>
              </motion.div>
            );
          })}

          {/* Left Column (8 cols): Recent Analyses + My Appointments */}
          <div className="lg:col-span-8 flex flex-col gap-4">
            {/* Recent Analyses */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className={cn(card, "p-5 sm:p-6 shadow-2xs")}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display font-bold text-gray-900 text-lg">Recent Analyses</h2>
                <Link
                  to="/dashboard/history"
                  className="text-xs text-[#c0166a] font-semibold flex items-center gap-1 hover:text-[#a01258] transition-colors"
                >
                  View All <ChevronRight className="w-3 h-3" />
                </Link>
              </div>

              <div className="space-y-2.5">
                {history.slice(0, 3).map((analysis, i) => (
                  <Link key={analysis.id} to="/dashboard/history" className="block">
                    <motion.div
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.25 + i * 0.08 }}
                      className="flex items-center gap-4 sm:gap-5 p-4 rounded-2xl border border-gray-100 bg-gray-50/40 hover:border-magenta-200 hover:bg-magenta-50/40 transition-colors group cursor-pointer"
                    >
                      {/* Confidence ring (lighter rose) */}
                      <div className="relative w-[68px] h-[68px] shrink-0">
                        <svg className="w-[68px] h-[68px] -rotate-90" viewBox="0 0 36 36">
                          <circle
                            cx="18"
                            cy="18"
                            r="15.9155"
                            fill="none"
                            stroke="#faeaf2"
                            strokeWidth="3"
                          />
                          <circle
                            cx="18"
                            cy="18"
                            r="15.9155"
                            fill="none"
                            stroke="#c95a8c"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeDasharray={`${Math.min(Math.max(analysis.confidence, 0), 100)}, 100`}
                          />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gray-900">
                          {formatConfidencePercent(analysis.confidence)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-gray-900 text-base truncate mb-1">
                          {analysis.condition}
                        </h4>
                        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs text-gray-500">
                          <span className="flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5 text-gray-400" /> {analysis.date}
                          </span>
                          <span className="w-1 h-1 rounded-full bg-gray-300" />
                          <span className="flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-gray-400" />
                            {analysis.bodyPart && analysis.bodyPart !== "Unknown"
                              ? analysis.bodyPart
                              : "Skin Assessment"}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-magenta-500 group-hover:translate-x-0.5 transition-all shrink-0" />
                    </motion.div>
                  </Link>
                ))}
                {!loading && history.length === 0 && (
                  <div className="text-center py-8">
                    <p className="text-gray-400 text-sm">No analysis history yet.</p>
                    <Link
                      to="/dashboard/scan"
                      className="text-[#c0166a] text-xs font-semibold mt-2 inline-block hover:underline"
                    >
                      Start your first scan
                    </Link>
                  </div>
                )}
              </div>
            </motion.div>

            {/* My Appointments */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.22 }}
              className={cn(card, "p-5 sm:p-6 shadow-2xs")}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display font-bold text-gray-900 text-lg">My Appointments</h2>
                <Link
                  to="/dashboard/appointment-status"
                  className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 text-gray-700 hover:border-magenta-400 hover:text-[#c0166a] transition-colors text-xs font-semibold px-3.5 py-1.5"
                >
                  Manage
                </Link>
              </div>
              <div className="space-y-2.5">
                {appointments.slice(0, 3).map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-gray-100 p-3.5 flex gap-4 items-center hover:border-gray-200 hover:shadow-2xs transition-all"
                  >
                    <img
                      src={item.conditionImage || fallbackImage}
                      alt={item.conditionName || "Skin condition"}
                      className="w-14 h-14 rounded-2xl object-cover shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {item.conditionName || "Skin concern"}
                        </p>
                        <span
                          className={`text-[11px] px-3 py-0.5 rounded-full font-semibold shrink-0 ${item.status === "scheduled" || item.status === "accepted"
                            ? "bg-emerald-100 text-emerald-700"
                            : item.status === "cancelled"
                              ? "bg-gray-200 text-gray-600"
                              : item.status === "rejected"
                                ? "bg-rose-100 text-rose-700"
                                : item.status === "completed"
                                  ? "bg-green-100 text-green-700"
                                  : "bg-amber-100 text-amber-700"
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
                        <p className="text-xs text-gray-600 truncate font-medium">{item.clinicName}</p>
                        <VerifiedBadge size={13} className="w-3.5 h-3.5" title="Verified Clinic" />
                      </div>
                      <div className="text-[11px] text-gray-500 mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap">
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-[#c0166a]" />
                          Face-to-face
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-[#c0166a]" /> {item.date || "Schedule pending"}{" "}
                          {item.time ? `· ${item.time}` : ""}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                {!loading && appointments.length === 0 && (
                  <div className="text-center py-6">
                    <p className="text-xs text-gray-400">No appointment requests yet.</p>
                    <Link
                      to="/dashboard/clinics"
                      className="text-xs text-[#c0166a] font-semibold mt-1.5 inline-block hover:underline"
                    >
                      Find a clinic &amp; book an appointment
                    </Link>
                  </div>
                )}
              </div>
            </motion.div>
          </div>

          {/* Right Column (4 cols): Quick Actions + Skin Care Tips + Reminder */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            {/* Skin Scan card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#8a1553] via-[#b02a72] to-[#db6597] p-6 text-white shadow-lg shadow-[#8a1553]/20"
            >
              <div className="absolute -top-16 -right-14 w-48 h-48 rounded-full bg-white/10 pointer-events-none" />
              <p className="relative text-sm font-semibold text-white/80">Skin Scan</p>
              <h3 className="relative font-display font-bold text-2xl leading-tight mt-1">Scan Your Skin</h3>
              <p className="relative text-white/85 text-sm mt-1.5">AI-powered analysis in seconds</p>
              <Link
                to="/dashboard/scan"
                className="group relative mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white text-[#881337] hover:bg-magenta-50 transition-colors py-3 text-sm font-bold shadow-xs"
              >
                <Camera className="w-4 h-4 text-[#881337]" /> Start Scan
                <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </Link>
            </motion.div>

            {/* Find a Clinic & Book Appointment */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className={cn(card, "p-3 shadow-2xs")}
            >
              <Link
                to="/dashboard/clinics"
                className="group flex items-center gap-4 rounded-2xl p-3 hover:bg-gray-50 transition-colors"
              >
                <div className="w-11 h-11 rounded-full bg-magenta-50 border border-magenta-100 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <MapPin className="w-5 h-5 text-[#c0166a]" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-display font-bold text-gray-900 text-sm">Find a Clinic</h3>
                  <p className="text-gray-500 text-xs">Verified dermatologists near you</p>
                </div>
                <ArrowUpRight className="w-4 h-4 text-magenta-300 group-hover:text-[#c0166a] transition-colors" />
              </Link>
              <div className="mx-3 border-t border-gray-100" />
              <Link
                to="/dashboard/clinics"
                className="group flex items-center gap-4 rounded-2xl p-3 hover:bg-gray-50 transition-colors"
              >
                <div className="w-11 h-11 rounded-full bg-magenta-50 border border-magenta-100 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <Calendar className="w-5 h-5 text-[#c0166a]" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-display font-bold text-gray-900 text-sm">Book Appointment</h3>
                  <p className="text-gray-500 text-xs">Find verified clinic and schedule</p>
                </div>
                <ArrowUpRight className="w-4 h-4 text-magenta-300 group-hover:text-[#c0166a] transition-colors" />
              </Link>
            </motion.div>

            {/* Skin Care Tips */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className={cn(card, "p-5 sm:p-6 shadow-2xs")}
            >
              <h2 className="font-display font-bold text-gray-900 text-lg mb-4">Skin Care Tips</h2>
              <div className="space-y-2.5">
                {skinTips.map((tip) => (
                  <div
                    key={tip.title}
                    className="flex items-start gap-4 rounded-2xl border border-gray-100 p-3.5 hover:border-gray-200 transition-colors"
                  >
                    <div className="w-11 h-11 rounded-full bg-magenta-50 border border-magenta-100 flex items-center justify-center shrink-0">
                      <tip.icon className="w-5 h-5 text-[#c0166a]" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold text-gray-900 mb-0.5">{tip.title}</h4>
                      <p className="text-xs text-gray-500 leading-relaxed">{tip.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Reminder */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="relative overflow-hidden rounded-3xl bg-magenta-50/70 border border-magenta-200 p-5 sm:p-6"
            >
              <div className="flex items-center gap-3 mb-2.5">
                <div className="w-10 h-10 rounded-full bg-white border border-magenta-200/80 flex items-center justify-center shrink-0">
                  <Stethoscope className="w-5 h-5 text-magenta-700" />
                </div>
                <h3 className="font-display font-bold text-lg text-magenta-900">Reminder</h3>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">
                DERMAI provides AI-assisted analysis only. Always consult a licensed dermatologist for proper diagnosis and treatment.
              </p>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
