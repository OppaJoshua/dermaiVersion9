import { motion } from "framer-motion";
import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { Microscope, Users, Building2, ClipboardList, AlertTriangle, ChevronDown, MapPin, TrendingUp, Activity, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import CebuSkinConditionMap from "./CebuSkinConditionMap";
import CebuAnalysisMap from "./CebuAnalysisMap";
import { fetchCebuScanCounts, fetchRecentScanActivity, type ScanActivity } from "@/lib/adminDashboardService";
import { supabase } from "@/lib/supabaseClient";
const dashboardFeatures = [
  { id: "overview", label: "Overview", icon: TrendingUp },
  { id: "analytics", label: "Analytics & Charts", icon: BarChart3 },
  { id: "activity", label: "Activity & Map", icon: Activity },
  { id: "skin-map", label: "Cebu Skin Condition Map", icon: MapPin },
];

// TODO: Load weekly trend data from Supabase — now loaded dynamically below

/** The 5 skin conditions tracked on the dashboard */
const TRACKED_CONDITIONS = [
  "Atopic Dermatitis",
  "Vitiligo",
  "Contact Dermatitis",
  "Melasma",
  "Acne Vulgaris",
];


export default function AdminDashboardPage() {
  const [selectedFeature, setSelectedFeature] = useState<string>("overview");
  const [showMenu, setShowMenu] = useState(false);

  // Live data from Supabase
  const [liveUsers, setLiveUsers] = useState<{ id: string }[]>([]);
  const [liveScans, setLiveScans] = useState<{ analysis_id: string; status: string; body_part: string | null; skin_condition: { name: string } | null }[]>([]);
  const [verifiedClinicCount, setVerifiedClinicCount] = useState(0);
  const [pendingClinicCount, setPendingClinicCount] = useState(0);
  const [trendData, setTrendData] = useState<Array<{ week: string; analyses: number }>>([]);
  const [activityLog, setActivityLog] = useState<ScanActivity[]>([]);

  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function refreshScans() {
      const [, activity] = await Promise.allSettled([
        fetchCebuScanCounts(), fetchRecentScanActivity(),
      ]);
      if (cancelled) return;
      setActivityError(activity.status === "rejected");
      if (activity.status === "fulfilled") setActivityLog(activity.value);
      setActivityLoading(false);
    }
    void refreshScans();
    const timer = window.setInterval(() => void refreshScans(), 60000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    async function loadData() {
      try {
        // Users
        const { data: users } = await supabase.from("user").select("user_id");
        setLiveUsers((users ?? []).map((u: { user_id: string }) => ({ id: u.user_id })));

        // Scans
        const { data: scans } = await supabase
          .from("ai_scan_result")
          .select("analysis_id, status, body_part, skin_condition:condition_id ( name )");
        setLiveScans((scans ?? []).map((s: any) => s));

        // Trend data — group by week
        const { data: trendRows } = await supabase
          .from("ai_scan_result")
          .select("scanned_at")
          .order("scanned_at");
        if (trendRows) {
          const weekMap: Record<string, number> = {};
          trendRows.forEach((r: { scanned_at: string }) => {
            const d = new Date(r.scanned_at);
            const week = `W${Math.ceil(d.getDate() / 7)} ${d.toLocaleString("en-PH", { month: "short" })}`;
            weekMap[week] = (weekMap[week] ?? 0) + 1;
          });
          setTrendData(Object.entries(weekMap).map(([week, analyses]) => ({ week, analyses })));
        }

        // Clinic counts
        const { count: approved } = await supabase.from("clinic").select("*", { count: "exact", head: true }).eq("status", "approved");
        const { count: pending } = await supabase.from("clinic").select("*", { count: "exact", head: true }).eq("status", "pending");
        setVerifiedClinicCount(approved ?? 0);
        setPendingClinicCount(pending ?? 0);


      } catch (err) {
        console.error("Failed to load admin dashboard data:", err);
      }
    }
    loadData();
  }, []);

  const flaggedScans = liveScans.filter((s) => s.status === "flagged" || s.status === "invalid");

  // Derive top-5 condition counts from real scan data
  const topConditions = useMemo(() =>
    TRACKED_CONDITIONS.map((name) => ({
      name,
      count: liveScans.filter(
        (s) => (s.skin_condition as { name: string } | null)?.name?.toLowerCase() === name.toLowerCase()
      ).length,
    })),
    [liveScans]);


  const stats = useMemo(() => [
    {
      label: "Total Analyses",
      value: liveScans.length.toLocaleString(),
      change: "Live",
      trend: "up" as const,
      icon: Microscope,
      color: "bg-magenta-50 text-magenta-500",
    },
    {
      label: "Total Users",
      value: liveUsers.length.toLocaleString(),
      change: "Live",
      trend: "up" as const,
      icon: Users,
      color: "bg-blue-50 text-blue-500",
    },
    {
      label: "Verified Clinics",
      value: verifiedClinicCount.toLocaleString(),
      change: "Live",
      trend: "up" as const,
      icon: Building2,
      color: "bg-emerald-50 text-emerald-500",
    },
    {
      label: "Pending Applications",
      value: pendingClinicCount.toLocaleString(),
      change: "Live",
      trend: "down" as const,
      icon: ClipboardList,
      color: "bg-amber-50 text-amber-500",
    },
    {
      label: "Flagged / Low Quality",
      value: String(flaggedScans.length),
      change: "Live",
      trend: "up" as const,
      icon: AlertTriangle,
      color: "bg-orange-50 text-orange-500",
    },
  ], [liveUsers.length, liveScans.length, flaggedScans.length, verifiedClinicCount, pendingClinicCount]);

  const axisTick = { fontSize: 12, fill: "#111827" };
  const tooltipStyle = {
    borderRadius: 8,
    border: "1px solid #e5e7eb",
    fontSize: 12,
    color: "#111827",
    boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
  };

  return (<div className="space-y-8">
    {/* Page Title + Feature Menu */}
    <div className="flex items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-display font-bold text-black">Dashboard</h1>
        <p className="text-sm text-gray-600 mt-1">Overview of your DERMAI platform activity.</p>
      </div>

      {/* Dropdown Menu */}
      <div className="relative">
        <button onClick={() => setShowMenu(!showMenu)} className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 text-sm font-semibold text-black transition-colors cursor-pointer">
          {dashboardFeatures.find((f) => f.id === selectedFeature)?.label || "Select Feature"}
          <ChevronDown className={cn("w-4 h-4 text-magenta-600 transition-transform", showMenu && "rotate-180")} />
        </button>

        {showMenu && (<motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="absolute right-0 top-full mt-2 bg-white border border-gray-200 rounded-xl shadow-lg z-50 min-w-70 overflow-hidden">
          {dashboardFeatures.map((feature) => {
            const isSelected = selectedFeature === feature.id;
            return (<button key={feature.id} onClick={() => {
              setSelectedFeature(feature.id);
              setShowMenu(false);
            }} className={cn("w-full px-5 py-3.5 text-left border-b border-gray-100 last:border-b-0 transition-colors cursor-pointer", isSelected
              ? "bg-magenta-50"
              : "hover:bg-gray-50")}>
              <p className="font-semibold text-sm text-black">{feature.label}</p>
              <p className="text-xs text-gray-600 mt-0.5">
                {feature.id === "overview"
                  ? "Key metrics and stats"
                  : feature.id === "analytics"
                    ? "Charts and trends"
                    : feature.id === "activity"
                      ? "Recent activity and Cebu map"
                      : "Geographic skin condition heatmap"}
              </p>
            </button>);
          })}
        </motion.div>)}
      </div>
    </div>

    {/* Conditional Content Rendering */}
    {selectedFeature === "overview" && (<>
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-6">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (<motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="bg-white rounded-xl p-7 min-h-[156px] border border-gray-200 shadow-sm hover:border-gray-300 transition-colors">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-black">{stat.label}</p>
              <Icon className="w-5 h-5 text-magenta-600" />
            </div>
            <p className="mt-5 text-4xl font-bold text-black tabular-nums">{stat.value}</p>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-gray-600">
              <span className="w-1.5 h-1.5 rounded-full bg-magenta-500" />
              {stat.change}
            </p>
          </motion.div>);
        })}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar Chart */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-white rounded-xl p-7 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-black">
              Top 5 detected conditions
            </h3>
            <span className="text-sm text-gray-600">This month</span>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topConditions}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={axisTick} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} />
                <YAxis tick={axisTick} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="#A0195A" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Line Chart */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-white rounded-xl p-7 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-black">
              Analysis trends
            </h3>
            <div className="flex gap-1">
              {["Weekly", "Monthly"].map((tab, i) => (<button key={tab} className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors ${i === 0
                ? "bg-magenta-50 text-black border border-magenta-200"
                : "text-gray-600 hover:bg-gray-50 border border-transparent"}`}>
                {tab}
              </button>))}
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="week" tick={axisTick} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} />
                <YAxis tick={axisTick} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="analyses" stroke="#A0195A" strokeWidth={2.5} dot={{ fill: "#A0195A", r: 4, strokeWidth: 2, stroke: "#fff" }} activeDot={{ r: 6, fill: "#A0195A" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>
    </>)}

    {selectedFeature === "analytics" && (<>
      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar Chart */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-white rounded-xl p-7 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-black">
              Top 5 detected conditions
            </h3>
            <span className="text-sm text-gray-600">This month</span>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topConditions}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={axisTick} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} />
                <YAxis tick={axisTick} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="#A0195A" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Line Chart */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-white rounded-xl p-7 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-black">
              Analysis trends
            </h3>
            <div className="flex gap-1">
              {["Weekly", "Monthly"].map((tab, i) => (<button key={tab} className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors ${i === 0
                ? "bg-magenta-50 text-black border border-magenta-200"
                : "text-gray-600 hover:bg-gray-50 border border-transparent"}`}>
                {tab}
              </button>))}
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="week" tick={axisTick} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} />
                <YAxis tick={axisTick} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="analyses" stroke="#A0195A" strokeWidth={2.5} dot={{ fill: "#A0195A", r: 4, strokeWidth: 2, stroke: "#fff" }} activeDot={{ r: 6, fill: "#A0195A" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>
    </>)}

    {selectedFeature === "activity" && (<div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Cebu Analysis Map */}
      <CebuAnalysisMap className="lg:col-span-2" />

      {/* Activity Log */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="lg:col-span-3 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-7 pt-6 pb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-black">
            Recent activity
          </h3>
          <Link to="/admin/ai-analyses" className="text-sm text-magenta-700 font-semibold hover:text-magenta-800 transition-colors">
            View all
          </Link>
        </div>
        {activityError && activityLog.length > 0 && <p role="alert" className="px-7 text-sm text-red-600">Unable to refresh scan activity. Displayed events may be out of date.</p>}
        {/* Scrollable table — sticky header, custom thin scrollbar */}
        <style>{`
          .activity-scroll::-webkit-scrollbar { width: 5px; }
          .activity-scroll::-webkit-scrollbar-track { background: transparent; }
          .activity-scroll::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 9999px; }
          .activity-scroll::-webkit-scrollbar-thumb:hover { background: #d1d5db; }
        `}</style>
        <div className="overflow-x-auto">
          <table className="w-full text-black">
            <thead>
              <tr className="bg-gray-50 border-y border-gray-200">
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Action</th>
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">User</th>
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Time</th>
              </tr>
            </thead>
          </table>
        </div>
        <div
          className="activity-scroll overflow-y-auto"
          style={{ maxHeight: "400px", scrollbarWidth: "thin", scrollbarColor: "#e5e7eb transparent" }}
        >
          <table className="w-full text-black">
            <tbody className="divide-y divide-gray-100">
              {activityLog.map((log) => (<tr key={log.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-7 py-4 w-[55%]">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex px-2.5 py-0.5 rounded-full border border-gray-300 text-[11px] font-semibold text-black capitalize shrink-0">
                      {log.type}
                    </span>
                    <span className="text-sm text-black">{log.action}</span>
                  </div>
                </td>
                <td className="px-7 py-4 text-sm text-black font-medium w-[25%]">{log.user}</td>
                <td className="px-7 py-4 text-sm text-gray-600 whitespace-nowrap w-[20%]">
                  <time dateTime={log.timestamp} title={new Date(log.timestamp).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}>
                    {log.time}
                  </time>
                </td>
              </tr>))}
              {activityLog.length === 0 && (<tr>
                <td colSpan={3} className="px-7 py-12 text-center text-sm text-gray-600">
                  {activityLoading ? "Loading scan activity..." : activityError ? "Unable to load scan activity." : "No recent patient scans."}
                </td>
              </tr>)}
            </tbody>
          </table>
        </div>

        {/* Alert Cards */}
        <div className="px-7 py-6 border-t border-gray-200">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-center gap-4 bg-gray-50 border border-gray-200 rounded-xl p-5">
              <AlertTriangle className="w-6 h-6 text-magenta-600 shrink-0" />
              <div>
                <p className="text-2xl font-display font-bold text-black tabular-nums">{flaggedScans.length}</p>
                <p className="text-sm text-gray-600">Out-of-scope alerts</p>
              </div>
            </div>
            {/* DOH Referrals card removed */}
          </div>
        </div>
      </motion.div>
    </div>)}

    {selectedFeature === "skin-map" && (<div>
      <CebuSkinConditionMap />
    </div>)}
  </div>);
}
