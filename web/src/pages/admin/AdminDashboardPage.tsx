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

export default function AdminDashboardPage() {
  const [selectedFeature, setSelectedFeature] = useState<string>("overview");
  const [showMenu, setShowMenu] = useState(false);
  const [trendTab, setTrendTab] = useState<"weekly" | "monthly">("weekly");

  // Live data from Supabase
  const [liveUsers, setLiveUsers] = useState<{ id: string }[]>([]);
  const [liveScans, setLiveScans] = useState<{ analysis_id: string; status: string; body_part: string | null; scanned_at?: string; skin_condition: { name: string } | null }[]>([]);
  const [verifiedClinicCount, setVerifiedClinicCount] = useState(0);
  const [pendingClinicCount, setPendingClinicCount] = useState(0);
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

        // Scans - load live scans from Supabase
        let rawScans: any[] = [];
        const { data: scans, error: scansErr } = await supabase
          .from("ai_scan_result")
          .select("analysis_id, status, body_part, scanned_at, skin_condition:condition_id ( name )")
          .order("scanned_at", { ascending: true });

        if (!scansErr && scans) {
          rawScans = scans;
        } else {
          const { data: altScans } = await supabase
            .from("ai_skin_analysis")
            .select("analysis_id, status, body_part, scanned_at, skin_condition:condition_id ( name )")
            .order("scanned_at", { ascending: true });
          if (altScans) rawScans = altScans;
        }
        setLiveScans(rawScans);

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

  // Top 5 detected conditions filtered by current month from live Supabase scans
  const topConditions = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const currentMonthScans = liveScans.filter((s) => {
      if (!s.scanned_at) return false;
      const d = new Date(s.scanned_at);
      return !isNaN(d.getTime()) && d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    });

    const conditionMap = new Map<string, number>();
    currentMonthScans.forEach((s) => {
      const cond = Array.isArray(s.skin_condition) ? s.skin_condition[0] : s.skin_condition;
      const name = cond?.name?.trim();
      if (name) {
        conditionMap.set(name, (conditionMap.get(name) ?? 0) + 1);
      }
    });

    return Array.from(conditionMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [liveScans]);

  // Weekly trend grouped from live Supabase scans
  const weeklyTrendData = useMemo(() => {
    const weekMap = new Map<string, number>();
    liveScans.forEach((r) => {
      if (!r.scanned_at) return;
      const d = new Date(r.scanned_at);
      if (isNaN(d.getTime())) return;
      const week = `W${Math.ceil(d.getDate() / 7)} ${d.toLocaleString("en-PH", { month: "short" })}`;
      weekMap.set(week, (weekMap.get(week) ?? 0) + 1);
    });
    return Array.from(weekMap.entries()).map(([period, analyses]) => ({
      period,
      week: period,
      month: period,
      analyses,
    }));
  }, [liveScans]);

  // Monthly trend grouped from live Supabase scans
  const monthlyTrendData = useMemo(() => {
    const monthMap = new Map<string, number>();
    liveScans.forEach((r) => {
      if (!r.scanned_at) return;
      const d = new Date(r.scanned_at);
      if (isNaN(d.getTime())) return;
      const month = d.toLocaleString("en-PH", { month: "short" });
      monthMap.set(month, (monthMap.get(month) ?? 0) + 1);
    });
    return Array.from(monthMap.entries()).map(([period, analyses]) => ({
      period,
      week: period,
      month: period,
      analyses,
    }));
  }, [liveScans]);

  const activeTrendData = trendTab === "weekly" ? weeklyTrendData : monthlyTrendData;


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
            {topConditions.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topConditions}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={axisTick} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} />
                  <YAxis tick={axisTick} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" fill="#A0195A" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-gray-400">
                No skin condition analyses recorded this month.
              </div>
            )}
          </div>
        </motion.div>

        {/* Line Chart */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-white rounded-xl p-7 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-black">
              Analysis trends
            </h3>
            <div className="flex gap-1">
              {(["weekly", "monthly"] as const).map((tab) => {
                const isActive = trendTab === tab;
                const label = tab === "weekly" ? "Weekly" : "Monthly";
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setTrendTab(tab)}
                    className={cn(
                      "px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer",
                      isActive
                        ? "bg-magenta-50 text-black border border-magenta-200"
                        : "text-gray-600 hover:bg-gray-50 border border-transparent"
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="h-72">
            {activeTrendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={activeTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="period" tick={axisTick} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} />
                  <YAxis tick={axisTick} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="analyses" stroke="#A0195A" strokeWidth={2.5} dot={{ fill: "#A0195A", r: 4, strokeWidth: 2, stroke: "#fff" }} activeDot={{ r: 6, fill: "#A0195A" }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-gray-400">
                No analysis trend data available.
              </div>
            )}
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
            {topConditions.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topConditions}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={axisTick} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} />
                  <YAxis tick={axisTick} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" fill="#A0195A" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-gray-400">
                No skin condition analyses recorded this month.
              </div>
            )}
          </div>
        </motion.div>

        {/* Line Chart */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-white rounded-xl p-7 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-black">
              Analysis trends
            </h3>
            <div className="flex gap-1">
              {(["weekly", "monthly"] as const).map((tab) => {
                const isActive = trendTab === tab;
                const label = tab === "weekly" ? "Weekly" : "Monthly";
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setTrendTab(tab)}
                    className={cn(
                      "px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer",
                      isActive
                        ? "bg-magenta-50 text-black border border-magenta-200"
                        : "text-gray-600 hover:bg-gray-50 border border-transparent"
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="h-72">
            {activeTrendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={activeTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="period" tick={axisTick} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} />
                  <YAxis tick={axisTick} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="analyses" stroke="#A0195A" strokeWidth={2.5} dot={{ fill: "#A0195A", r: 4, strokeWidth: 2, stroke: "#fff" }} activeDot={{ r: 6, fill: "#A0195A" }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-gray-400">
                No analysis trend data available.
              </div>
            )}
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
