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
  status: "pending" | "accepted" | "scheduled" | "rejected";
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
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [profile, setProfile] = useState<{ fullName: string; profilePicture?: string }>({
    fullName: "",
  });
  const [history, setHistory] = useState<AnalysisRecord[]>([]);
  const [stats, setStats] = useState<QuickStats>({
    totalScans: "—",
    conditionsFound: "—",
    clinicsSaved: "—",
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

  // TODO: replace with DELETE /api/notifications/:id
  const dismissNotif = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  // TODO: replace with a bulk-clear endpoint (e.g. POST /api/notifications/clear)
  const clearAllNotifs = () => {
    setNotifications([]);
  };

  useEffect(() => {
    const loadDashboardData = async () => {
      setLoading(true);
      try {
        // TODO: fetch data from Supabase
        setProfile({ fullName: "" });
        setAppointments([]);
        setHistory([]);
        setStats({
          totalScans: "0",
          conditionsFound: "0",
          clinicsSaved: "0",
          lastScan: "—",
        });
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
      } finally {
        setLoading(false);
      }
    };

    loadDashboardData();
  }, []);

  const fallbackImage = skinConditions[0]?.image;

  const firstName = profile.fullName ? profile.fullName.split(" ")[0] : "there";

  return (
    <div className="w-full">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-gray-900">
            Good morning, {firstName}! 👋
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
            { label: "Total Scans", value: stats.totalScans, icon: Camera, color: "text-magenta-500 bg-magenta-50" },
            { label: "Conditions Found", value: stats.conditionsFound, icon: Calendar, color: "text-blue-500 bg-blue-50" },
            { label: "Clinics Saved", value: stats.clinicsSaved, icon: MapPin, color: "text-emerald-500 bg-emerald-50" },
            { label: "Last Scan", value: stats.lastScan, icon: Clock, color: "text-amber-500 bg-amber-50" },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="bg-white rounded-2xl p-4 border border-gray-100 hover:border-gray-200 transition-all hover:shadow-sm"
            >
              <div className={`w-9 h-9 rounded-xl ${stat.color} flex items-center justify-center mb-3`}>
                <stat.icon className="w-4 h-4" />
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
              <div className="w-14 h-14 rounded-2xl bg-magenta-50 flex items-center justify-center group-hover:scale-105 transition-transform shrink-0">
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
              to="/appointment"
              className="group flex items-center gap-5 bg-white rounded-2xl p-6 border border-gray-100 hover:border-magenta-200 hover:shadow-sm transition-all"
            >
              <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center group-hover:scale-105 transition-transform shrink-0">
                <Calendar className="w-7 h-7 text-amber-500" />
              </div>
              <div className="flex-1">
                <h3 className="font-display font-bold text-lg text-gray-900 mb-0.5">Book Appointment</h3>
                <p className="text-gray-400 text-sm">Submit request for clinic scheduling</p>
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
            <Link to="/appointment" className="text-xs text-magenta-600 font-semibold hover:text-magenta-700">
              Manage
            </Link>
          </div>
          <div className="px-6 pb-5 space-y-3">
            {appointments.slice(0, 3).map((item) => (
              <div key={item.id} className="rounded-xl border border-gray-100 bg-gray-50/70 p-3 flex gap-3">
                <img
                  src={item.conditionImage || fallbackImage}
                  alt={item.conditionName || "Skin condition"}
                  className="w-14 h-14 rounded-lg object-cover border border-gray-200"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-xs font-semibold text-gray-900 truncate">{item.conditionName || "Skin concern"}</p>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold capitalize ${
                        (item.status === "accepted" ? "scheduled" : item.status) === "scheduled"
                          ? "bg-green-50 text-green-700 border-green-200"
                          : item.status === "rejected"
                          ? "bg-red-50 text-red-700 border-red-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                      }`}
                    >
                      {item.status === "accepted" ? "scheduled" : item.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-600 truncate">{item.clinicName}</p>
                  <div className="text-[11px] text-gray-500 mt-1 flex items-center gap-3">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      Face-to-face
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> {item.date || "To be assigned"}
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
                <Link key={analysis.id} to={`/library/${analysis.conditionId || ""}`} className="block">
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
                <div className="w-10 h-10 rounded-xl bg-magenta-50 flex items-center justify-center shrink-0">
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
