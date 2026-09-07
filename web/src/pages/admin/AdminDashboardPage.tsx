import { motion } from "framer-motion";
import { useState, useMemo, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { Microscope, Users, Building2, ClipboardList, AlertTriangle, ArrowUpRight, ArrowDownRight, ChevronDown, MapPin, TrendingUp, Activity, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import CebuSkinConditionMap from "./CebuSkinConditionMap";
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

/** Geographic positions for each Cebu district (no hardcoded counts) */
const cebuDistrictGeo: Array<{ name: string; x: number; y: number }> = [
    { name: "Alcantara", x: 36, y: 72 },
    { name: "Alcoy", x: 40, y: 78 },
    { name: "Alegria", x: 34, y: 80 },
    { name: "Aloguinsan", x: 33, y: 62 },
    { name: "Argao", x: 38, y: 74 },
    { name: "Asturias", x: 30, y: 45 },
    { name: "Badian", x: 32, y: 82 },
    { name: "Balamban", x: 32, y: 50 },
    { name: "Bantayan", x: 46, y: 4 },
    { name: "Barili", x: 35, y: 68 },
    { name: "Bogo City", x: 58, y: 10 },
    { name: "Boljoon", x: 40, y: 82 },
    { name: "Borbon", x: 60, y: 18 },
    { name: "Carmen", x: 56, y: 20 },
    { name: "Carcar City", x: 40, y: 70 },
    { name: "Catmon", x: 57, y: 22 },
    { name: "Compostela", x: 60, y: 32 },
    { name: "Consolacion", x: 50, y: 28 },
    { name: "Cordova", x: 64, y: 42 },
    { name: "Daanbantayan", x: 55, y: 6 },
    { name: "Dalaguete", x: 42, y: 76 },
    { name: "Danao City", x: 56, y: 16 },
    { name: "Dumanjug", x: 34, y: 70 },
    { name: "Ginatilan", x: 36, y: 84 },
    { name: "Lapu-Lapu City", x: 62, y: 40 },
    { name: "Liloan", x: 55, y: 24 },
    { name: "Madridejos", x: 50, y: 3 },
    { name: "Malabuyoc", x: 35, y: 86 },
    { name: "Medellin", x: 54, y: 8 },
    { name: "Minglanilla", x: 44, y: 58 },
    { name: "Moalboal", x: 32, y: 76 },
    { name: "Naga City", x: 42, y: 64 },
    { name: "Oslob", x: 40, y: 86 },
    { name: "Pinamungajan", x: 31, y: 56 },
    { name: "Ronda", x: 34, y: 74 },
    { name: "Samboan", x: 38, y: 88 },
    { name: "San Fernando", x: 44, y: 62 },
    { name: "San Remigio", x: 52, y: 12 },
    { name: "Santa Fe", x: 48, y: 5 },
    { name: "Santander", x: 40, y: 90 },
    { name: "Sibonga", x: 41, y: 72 },
    { name: "Sogod", x: 60, y: 14 },
    { name: "Tabogon", x: 58, y: 12 },
    { name: "Tabuelan", x: 30, y: 40 },
    { name: "Talisay City", x: 46, y: 52 },
    { name: "Toledo City", x: 30, y: 52 },
    { name: "Tuburan", x: 28, y: 42 },
];

const activityColors: Record<string, string> = {
    user: "bg-blue-50 text-blue-500",
    clinic: "bg-emerald-50 text-emerald-500",
    scan: "bg-magenta-50 text-magenta-500",
    alert: "bg-red-50 text-red-500",
};
export default function AdminDashboardPage() {
    const [hoveredDistrict, setHoveredDistrict] = useState<string | null>(null);
    const [selectedFeature, setSelectedFeature] = useState<string>("overview");
    const [showMenu, setShowMenu] = useState(false);

    // Live data from Supabase
    const [liveUsers, setLiveUsers] = useState<{ id: string }[]>([]);
    const [liveScans, setLiveScans] = useState<{ analysis_id: string; status: string; body_part: string | null; skin_condition: { name: string } | null }[]>([]);
    const [districtCounts, setDistrictCounts] = useState<Record<string, number>>({});
    const [verifiedClinicCount, setVerifiedClinicCount] = useState(0);
    const [pendingClinicCount, setPendingClinicCount] = useState(0);
    const [trendData, setTrendData] = useState<Array<{ week: string; analyses: number }>>([]);
    const [activityLog, setActivityLog] = useState<Array<{ action: string; user: string; time: string; type: string }>>([]);

    useEffect(() => {
        async function loadData() {
            // Users
            const { data: users } = await supabase.from("user").select("user_id");
            setLiveUsers((users ?? []).map((u: { user_id: string }) => ({ id: u.user_id })));

            // Scans
            const { data: scans } = await supabase
                .from("ai_scan_result")
                .select("analysis_id, status, body_part, skin_condition:condition_id ( name )");
            setLiveScans((scans ?? []).map((s: { analysis_id: string; status: string; body_part: string | null; skin_condition: { name: string } | null }) => s));

            // District counts from clinics and appointments
            const counts: Record<string, number> = {};
            const { data: clinicsWithDistrict } = await supabase
                .from("clinic")
                .select("district");
            (clinicsWithDistrict ?? []).forEach((c: { district: string | null }) => {
                if (c.district) {
                    const key = c.district.trim().toLowerCase();
                    counts[key] = (counts[key] ?? 0) + 1;
                }
            });

            const { data: apptsWithDistrict } = await supabase
                .from("patient_appointment")
                .select("clinic:clinic_id ( district )");
            (apptsWithDistrict ?? []).forEach((a: any) => {
                const clinicObj: any = Array.isArray(a.clinic) ? a.clinic[0] : a.clinic;
                if (clinicObj?.district) {
                    const key = clinicObj.district.trim().toLowerCase();
                    counts[key] = (counts[key] ?? 0) + 1;
                }
            });
            setDistrictCounts(counts);

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

            // Activity log from system_audit_log
            const { data: logs } = await supabase
                .from("system_audit_log")
                .select("log_id, action, user_type, log_type, timestamp, user:user_id ( full_name )")
                .order("timestamp", { ascending: false })
                .limit(20);
            setActivityLog((logs ?? []).map((l: {
                log_id: string;
                action: string;
                user_type: string;
                log_type: string;
                timestamp: string;
                user: { full_name: string } | null;
            }) => ({
                action: l.action,
                user: (l.user as { full_name: string } | null)?.full_name ?? l.user_type,
                time: new Date(l.timestamp).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }),
                type: l.log_type,
            })));
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

    // Derive per-district counts from real clinic & appointment activity
    const cebuDistricts = useMemo(() => {
        return cebuDistrictGeo.map((d) => {
            const dNameLower = d.name.toLowerCase();
            let count = 0;
            for (const [key, val] of Object.entries(districtCounts)) {
                if (key.includes(dNameLower) || dNameLower.includes(key)) {
                    count += val;
                }
            }
            return {
                ...d,
                count,
            };
        }).sort((a, b) => b.count - a.count);
    }, [districtCounts]);

    const stats = useMemo(() => [
        {
            label: "Total Analyses",
            value: liveScans.length.toLocaleString(),
            change: "—",
            trend: "up" as const,
            icon: Microscope,
            color: "bg-magenta-50 text-magenta-500",
        },
        {
            label: "Total Users",
            value: liveUsers.length.toLocaleString(),
            change: "—",
            trend: "up" as const,
            icon: Users,
            color: "bg-blue-50 text-blue-500",
        },
        {
            label: "Verified Clinics",
            value: String(verifiedClinicCount),
            change: "—",
            trend: "up" as const,
            icon: Building2,
            color: "bg-emerald-50 text-emerald-500",
        },
        {
            label: "Pending Applications",
            value: String(pendingClinicCount),
            change: "—",
            trend: "down" as const,
            icon: ClipboardList,
            color: "bg-amber-50 text-amber-500",
        },
        {
            label: "Flagged / Low Quality",
            value: String(flaggedScans.length),
            change: "—",
            trend: "up" as const,
            icon: AlertTriangle,
            color: "bg-orange-50 text-orange-500",
        },
    ], [liveUsers.length, liveScans.length, flaggedScans.length, verifiedClinicCount, pendingClinicCount]);
    return (<div className="space-y-6">
      {/* Page Title + Feature Menu */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">Overview of your DERMAI platform activity</p>
        </div>

        {/* Dropdown Menu */}
        <div className="relative">
          <button onClick={() => setShowMenu(!showMenu)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-gray-200 hover:border-gray-300 text-sm font-semibold text-gray-700 transition-all">
            {dashboardFeatures.find((f) => f.id === selectedFeature)?.label || "Select Feature"}
            <ChevronDown className={cn("w-4 h-4 transition-transform", showMenu && "rotate-180")}/>
          </button>

          {showMenu && (<motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="absolute right-0 top-full mt-2 bg-white border border-gray-200 rounded-xl shadow-lg z-50 min-w-70 overflow-hidden">
              {dashboardFeatures.map((feature) => {
                const Icon = feature.icon;
                const isSelected = selectedFeature === feature.id;
                return (<button key={feature.id} onClick={() => {
                        setSelectedFeature(feature.id);
                        setShowMenu(false);
                    }} className={cn("w-full flex items-center gap-3 px-4 py-3 text-left border-b border-gray-100 last:border-b-0 transition-colors", isSelected
                        ? "bg-magenta-50 text-magenta-600"
                        : "text-gray-700 hover:bg-gray-50")}>
                    <Icon className={cn("w-4 h-4", isSelected ? "text-magenta-600" : "text-gray-400")}/>
                    <div>
                      <p className="font-medium text-sm">{feature.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {feature.id === "overview"
                        ? "Key metrics and stats"
                        : feature.id === "analytics"
                            ? "Charts and trends"
                            : feature.id === "activity"
                                ? "Recent activity and Cebu map"
                                : "Geographic skin condition heatmap"}
                      </p>
                    </div>
                  </button>);
            })}
            </motion.div>)}
        </div>
      </div>

      {/* Conditional Content Rendering */}
      {selectedFeature === "overview" && (<>
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {stats.map((stat, i) => {
                const Icon = stat.icon;
                return (<motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="bg-white rounded-2xl p-5 border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all">
                  <div className="flex items-center justify-between mb-4">
                    <div className={`w-10 h-10 rounded-xl ${stat.color} flex items-center justify-center`}>
                      <Icon className="w-5 h-5"/>
                    </div>
                    <span className={`text-xs font-semibold flex items-center gap-0.5 px-2 py-1 rounded-full ${stat.trend === "up"
                        ? "text-emerald-600 bg-emerald-50"
                        : "text-amber-600 bg-amber-50"}`}>
                      {stat.trend === "up" ? (<ArrowUpRight className="w-3 h-3"/>) : (<ArrowDownRight className="w-3 h-3"/>)}
                      {stat.change}
                    </span>
                  </div>
                  <p className="text-2xl font-display font-bold text-gray-900">{stat.value}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{stat.label}</p>
                </motion.div>);
            })}
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Bar Chart */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-white rounded-2xl p-6 border border-gray-100">
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-display font-bold text-gray-900">
                  Top 5 Detected Conditions
                </h3>
                <span className="text-xs text-gray-400">This month</span>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topConditions}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} />
                    <Tooltip contentStyle={{
                borderRadius: 12,
                border: "1px solid #f3f4f6",
                fontSize: 12,
                boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
            }}/>
                    <Bar dataKey="count" fill="#A0195A" radius={[8, 8, 0, 0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            {/* Line Chart */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-white rounded-2xl p-6 border border-gray-100">
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-display font-bold text-gray-900">
                  Analysis Trends
                </h3>
                <div className="flex gap-1">
                  {["Weekly", "Monthly"].map((tab, i) => (<button key={tab} className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${i === 0
                    ? "bg-magenta-50 text-magenta-600"
                    : "text-gray-400 hover:bg-gray-50"}`}>
                      {tab}
                    </button>))}
                </div>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
                    <XAxis dataKey="week" tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} />
                    <Tooltip contentStyle={{
                borderRadius: 12,
                border: "1px solid #f3f4f6",
                fontSize: 12,
                boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
            }}/>
                    <Line type="monotone" dataKey="analyses" stroke="#A0195A" strokeWidth={2.5} dot={{ fill: "#A0195A", r: 4, strokeWidth: 2, stroke: "#fff" }} activeDot={{ r: 6, fill: "#A0195A" }}/>
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
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-white rounded-2xl p-6 border border-gray-100">
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-display font-bold text-gray-900">
                  Top 5 Detected Conditions
                </h3>
                <span className="text-xs text-gray-400">This month</span>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topConditions}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} />
                    <Tooltip contentStyle={{
                borderRadius: 12,
                border: "1px solid #f3f4f6",
                fontSize: 12,
                boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
            }}/>
                    <Bar dataKey="count" fill="#A0195A" radius={[8, 8, 0, 0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            {/* Line Chart */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-white rounded-2xl p-6 border border-gray-100">
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-display font-bold text-gray-900">
                  Analysis Trends
                </h3>
                <div className="flex gap-1">
                  {["Weekly", "Monthly"].map((tab, i) => (<button key={tab} className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${i === 0
                    ? "bg-magenta-50 text-magenta-600"
                    : "text-gray-400 hover:bg-gray-50"}`}>
                      {tab}
                    </button>))}
                </div>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
                    <XAxis dataKey="week" tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={{ stroke: "#A0195A", strokeWidth: 1.5 }} tickLine={false} />
                    <Tooltip contentStyle={{
                borderRadius: 12,
                border: "1px solid #f3f4f6",
                fontSize: 12,
                boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
            }}/>
                    <Line type="monotone" dataKey="analyses" stroke="#A0195A" strokeWidth={2.5} dot={{ fill: "#A0195A", r: 4, strokeWidth: 2, stroke: "#fff" }} activeDot={{ r: 6, fill: "#A0195A" }}/>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          </div>
        </>)}

      {selectedFeature === "activity" && (<div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Cebu Analysis Map */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-6 pt-5 pb-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-gray-900">Cebu Analysis Map</h3>
              <span className="text-[10px] px-2.5 py-1 rounded-full bg-magenta-50 text-magenta-600 font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-magenta-500 animate-pulse"/>
                Live
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">Skin analysis density across Cebu</p>
          </div>

          <div className="px-6 pb-5">
            <div className="relative bg-gray-50/80 rounded-2xl overflow-hidden h-75 border border-gray-100">
              <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full" style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.03))" }}>
                <path d="M 52 5 C 54 8, 57 12, 58 18 C 59 22, 57 26, 56 30 C 55 34, 54 36, 53 38 C 52 40, 54 42, 55 44 C 56 46, 58 44, 60 42 C 62 40, 65 38, 66 40 C 67 42, 64 44, 62 46 C 60 48, 56 48, 54 48 C 52 48, 50 50, 49 52 C 48 54, 48 56, 47 58 C 46 60, 46 62, 45 64 C 44 66, 43 68, 42 70 C 41 72, 40 74, 39 76 C 38 78, 37 80, 36 82 C 35 84, 34 86, 35 88 C 36 90, 38 90, 39 88 C 40 86, 41 84, 42 82 C 43 80, 44 78, 44 76 C 44 74, 45 72, 46 70 C 47 68, 48 66, 48 64 C 48 62, 49 60, 50 58 C 51 56, 52 54, 52 52 C 52 50, 53 48, 55 46 C 57 44, 56 42, 55 40 C 54 38, 55 36, 56 34 C 57 32, 58 28, 57 24 C 56 20, 55 16, 54 12 C 53 8, 52 6, 52 5Z" fill="#f9fafb" stroke="#e5e7eb" strokeWidth="0.4"/>
                <ellipse cx="64" cy="42" rx="5" ry="2.5" fill="#f9fafb" stroke="#e5e7eb" strokeWidth="0.4"/>
              </svg>

              {cebuDistricts.map((district) => {
                const isHovered = hoveredDistrict === district.name;
                const size = Math.min(Math.max(district.count / 300, 1), 3.5);
                return (<div key={district.name} className="absolute cursor-pointer" style={{ left: `${district.x}%`, top: `${district.y}%`, transform: "translate(-50%, -50%)", zIndex: isHovered ? 30 : 10 }} onMouseEnter={() => setHoveredDistrict(district.name)} onMouseLeave={() => setHoveredDistrict(null)}>
                    <div className="absolute inset-0 rounded-full bg-magenta-400 opacity-20 animate-ping" style={{ width: `${12 * size}px`, height: `${12 * size}px`, left: `${-(12 * size - 10 * size) / 2}px`, top: `${-(12 * size - 10 * size) / 2}px`, animationDuration: "2.5s" }}/>
                    <div className={`rounded-full border-2 border-white shadow-md transition-all duration-200 ${isHovered ? "bg-magenta-600 scale-[1.3]" : "bg-magenta-500"}`} style={{ width: `${10 * size}px`, height: `${10 * size}px` }}/>
                    {isHovered && (<div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white rounded-xl shadow-lg border border-gray-100 px-3 py-2 whitespace-nowrap z-40">
                        <p className="text-xs font-bold text-gray-900">{district.name}</p>
                        <p className="text-[10px] text-magenta-500 font-semibold">{district.count.toLocaleString()} analyses</p>
                        <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-white border-r border-b border-gray-100 rotate-45 -mt-1"/>
                      </div>)}
                  </div>);
            })}

              <div className="absolute bottom-3 left-3 bg-white/95 backdrop-blur-sm rounded-xl px-3 py-2 border border-gray-100">
                <p className="text-[10px] font-semibold text-gray-500 mb-1.5">Density</p>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-magenta-300"/><span className="text-[9px] text-gray-400">Low</span></div>
                  <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-magenta-400"/><span className="text-[9px] text-gray-400">Med</span></div>
                  <div className="flex items-center gap-1"><div className="w-4 h-4 rounded-full bg-magenta-600"/><span className="text-[9px] text-gray-400">High</span></div>
                </div>
              </div>

              <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-sm rounded-xl px-3 py-2 border border-gray-100 text-center">
                <p className="text-lg font-display font-bold text-magenta-600">
                  {cebuDistricts.reduce((a, b) => a + b.count, 0).toLocaleString()}
                </p>
                <p className="text-[9px] text-gray-400">Total in Cebu</p>
              </div>
            </div>
          </div>

          {/* Top districts list */}
          <div className="px-6 pb-5 space-y-2">
            {cebuDistricts.slice(0, 5).map((d, i) => (<div key={d.name} className="flex items-center gap-3">
                <span className="text-[10px] font-bold text-gray-300 w-4">{i + 1}</span>
                <span className="text-xs font-medium text-gray-700 flex-1">{d.name}</span>
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-magenta-500 rounded-full transition-all" style={{ width: `${(d.count / cebuDistricts[0].count) * 100}%` }}/>
                </div>
                <span className="text-[11px] font-semibold text-gray-500 w-12 text-right">
                  {d.count.toLocaleString()}
                </span>
              </div>))}
          </div>
        </motion.div>

        {/* Activity Log */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="lg:col-span-3 bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-6 pt-5 pb-4 flex items-center justify-between">
            <h3 className="font-display font-bold text-gray-900">
              Recent Activity
            </h3>
            <a href="#" className="text-xs text-magenta-500 font-semibold hover:text-magenta-600 transition-colors">
              View all
            </a>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-t border-gray-50">
                  <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Action</th>
                  <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">User</th>
                  <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Time</th>
                </tr>
              </thead>
              <tbody>
                {activityLog.map((log, i) => (<tr key={i} className="border-t border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className={`w-7 h-7 rounded-lg ${activityColors[log.type]} flex items-center justify-center`}>
                          <span className="text-[10px]">
                            {log.type === "user" ? "👤" : log.type === "clinic" ? "🏥" : log.type === "scan" ? "🔬" : "⚠️"}
                          </span>
                        </div>
                        <span className="text-sm text-gray-700">{log.action}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3.5 text-sm text-gray-500 font-medium">{log.user}</td>
                    <td className="px-6 py-3.5 text-xs text-gray-400">{log.time}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>

          {/* Alert Cards */}
          <div className="px-6 py-5 border-t border-gray-50">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center gap-4 bg-amber-50 border border-amber-100 rounded-xl p-4">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-amber-600"/>
                </div>
                <div>
                  <p className="text-lg font-display font-bold text-amber-800">{flaggedScans.length}</p>
                  <p className="text-xs text-amber-600">Out-of-Scope Alerts</p>
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
