import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Clock, ArrowUpRight, ChevronLeft, ChevronRight, MoreVertical, AlertTriangle, XCircle, FileText, Users, CalendarX, ShieldCheck } from "lucide-react";
import { useClinicVerification } from "@/hooks/useClinicVerification";
import { motion } from "framer-motion";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
/* ── Types ─────────────────────────────────────────────────── */
type AppointmentRecord = {
    id: string;
    clinicId: number;
    clinicName: string;
    consultationType: "face-to-face";
    conditionName?: string;
    date: string;
    time: string;
    notes: string;
    status: "pending" | "accepted" | "scheduled" | "rejected";
    meetingLink?: string;
    clinicNote?: string;
    createdAt: string;
    patientName?: string;
    patientAge?: number;
    patientAvatar?: string;
};
/* ── Static sample data ─────────────────────────────────────── */
// TODO: Load patient visit chart data from Supabase
const chartData: Array<{ day: string; patients: number }> = [];
const newPatients: Array<{
    name: string;
    age: number;
    concern: string;
    type: string;
    avatar: string;
}> = [];
const calendarAppointments: Array<{
    name: string;
    type: string;
    status: string;
    time?: string;
    avatar: string;
}> = [];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/* ── Custom Tooltip ─────────────────────────────────────────── */
const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number | string }>; label?: string }) => {
    if (active && payload && payload.length) {
        return (<div className="bg-[#c0166a] text-white text-xs px-3 py-2 rounded-xl shadow-lg">
        <p className="font-bold">Sep {label}</p>
        <p>{payload[0].value} patients</p>
      </div>);
    }
    return null;
};
/* ── Main Component ─────────────────────────────────────────── */
export default function ClinicDashboardPage() {
    // TODO: Load clinic name, logo, and appointments from Supabase using clinic auth session
    const clinicName = "";
    const now = new Date();
    const [calMonth] = useState(
        now.toLocaleString("en-PH", { month: "long", year: "numeric" })
    );
    const clinicLogo = "";
    const appointments: AppointmentRecord[] = [];
    const { status: verificationStatus } = useClinicVerification();
    const pending = appointments.filter((a) => a.status === "pending").length;
    const accepted = appointments.filter((a) => a.status === "accepted" || a.status === "scheduled").length;
    const uniquePatientCount = new Set(appointments.map((appointment) => appointment.patientName).filter(Boolean)).size;
    const newPatientReferrals = appointments.filter((appointment) => appointment.status === "pending").slice(0, 3);
    const upcomingAppointments = appointments
        .filter((appointment) => appointment.status === "scheduled" || appointment.status === "accepted")
        .sort((first, second) => `${first.date}${first.time}`.localeCompare(`${second.date}${second.time}`))
        .slice(0, 4);
    // Derive current week calendar days
    const today = now.getDate();
    const startOfWeek = today - now.getDay() + (now.getDay() === 0 ? -6 : 1);
    const calDays = Array.from({ length: 7 }, (_, i) => startOfWeek + i);
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
    return (<div className="min-h-screen bg-[#faf5f8] p-4 md:p-6 space-y-5 font-sans">

      {/* ── Verification Banner ───────────────────────────────── */}
      {verificationStatus === "pending" && (<div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0"/>
          <div>
            <p className="text-sm font-semibold text-amber-800">Pending Admin Verification</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Your clinic is awaiting approval. Appointments and patient management are locked until you're verified.
              <Link to="/clinic/settings" className="ml-1 underline font-medium">View your profile →</Link>
            </p>
          </div>
        </div>)}
      {verificationStatus === "rejected" && (<div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
          <XCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0"/>
          <div>
            <p className="text-sm font-semibold text-red-800">Clinic Registration Rejected</p>
            <p className="text-xs text-red-700 mt-0.5">
              Your clinic registration was rejected by the admin. Please update your profile information and contact support.
              <Link to="/clinic/settings" className="ml-1 underline font-medium">Update profile →</Link>
            </p>
          </div>
        </div>)}

      {/* ── Top nav ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-[#c0166a]"/>
          <span className="text-sm font-semibold text-gray-700">March 31, 2026</span>
          {verificationStatus === "verified" && (<span className="ml-2 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#c0166a] text-white text-[10px] font-bold">
              <CheckCircle2 className="w-3 h-3"/> Verified
            </span>)}
          {verificationStatus === "pending" && (<span className="ml-2 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-pink-100 text-pink-700 text-[10px] font-bold border border-pink-200">
              Pending Verification
            </span>)}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {clinicLogo ? (<img src={clinicLogo} className="w-8 h-8 rounded-full object-cover border-2 border-[#c0166a]" alt={clinicName}/>) : (<div className="w-8 h-8 rounded-full bg-[#c0166a] flex items-center justify-center border-2 border-[#c0166a]">
                <span className="text-white text-[10px] font-bold">
                  {clinicName.charAt(0).toUpperCase()}
                </span>
              </div>)}
            <div className="hidden sm:block">
              <p className="text-xs font-bold text-gray-800 leading-none truncate max-w-[120px]">{clinicName}</p>
              <p className="text-[10px] text-gray-400">Dermatology Clinic</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Stat cards + Chart ────────────────────────────────── */}
      {verificationStatus === "verified" ? (<>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Stats 2x2 */}
        <div className="lg:col-span-1 grid grid-cols-2 gap-4">
          {statCards.map((s, i) => (<motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }} className={`rounded-2xl p-4 flex flex-col justify-between min-h-[110px] relative overflow-hidden ${s.highlight
                    ? "bg-[#c0166a] text-white"
                    : "bg-white border border-gray-100 text-gray-900"}`}>
              {s.highlight && (<>
                  <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full bg-white/10"/>
                  <div className="absolute -bottom-6 -left-4 w-24 h-24 rounded-full bg-white/10"/>
                </>)}
              <div className="flex items-center justify-between relative">
                <p className={`text-xs font-semibold ${s.highlight ? "text-pink-100" : "text-gray-500"}`}>
                  {s.label}
                </p>
                <button className={`w-6 h-6 rounded-full flex items-center justify-center border ${s.highlight
                    ? "border-white/40 text-white"
                    : "border-gray-200 text-gray-400"}`}>
                  <ArrowUpRight className="w-3 h-3"/>
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
            </motion.div>))}
        </div>

        {/* Line chart */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="lg:col-span-2 bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-gray-900">New Patients</h2>
            <select className="text-xs border border-gray-100 rounded-lg px-2 py-1 text-gray-500 bg-gray-50 focus:outline-none">
              <option>This month</option>
              <option>Last month</option>
            </select>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0e8ec" vertical={false}/>
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#bbb" }} axisLine={false} tickLine={false}/>
              <YAxis tick={{ fontSize: 10, fill: "#bbb" }} axisLine={false} tickLine={false} domain={[0, 20]} ticks={[0, 5, 10, 15, 20]}/>
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#c0166a22", strokeWidth: 2 }}/>
              <Line type="monotone" dataKey="patients" stroke="#c0166a" strokeWidth={2.5} dot={false} activeDot={{ r: 5, fill: "#c0166a", strokeWidth: 0 }}/>
            </LineChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      {/* ── New Patients + Calendar ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* New patient cards */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="lg:col-span-2 bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-gray-900">New Patients</h2>
            <Link to="/clinic/appointments" className="text-xs text-[#c0166a] font-semibold hover:underline">
              See all
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(newPatientReferrals.length > 0 ? newPatientReferrals.map((appointment) => ({
                name: appointment.patientName || "Patient",
                age: appointment.patientAge,
                concern: appointment.notes || appointment.conditionName || "Appointment request",
                avatar: appointment.patientAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(appointment.patientName || "P")}&background=fce7f3&color=c0166a`,
            })) : newPatients).map((p) => (<div key={p.name} className="rounded-2xl border border-gray-100 p-4 flex flex-col items-center text-center gap-2 hover:border-pink-200 hover:shadow-sm transition-all">
                <div className="relative">
                  <img src={p.avatar} alt={p.name} className="w-16 h-16 rounded-full object-cover border-2 border-pink-100" onError={(e) => {
                    (e.target as HTMLImageElement).src =
                        `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=fce7f3&color=c0166a`;
                }}/>
                  <span className="absolute bottom-0 right-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-white bg-[#c0166a] text-white">
                    In-clinic
                  </span>
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">{p.name}</p>
                  {p.age && <p className="text-[10px] text-gray-400">{p.age} years old</p>}
                </div>
                <p className="text-[11px] text-gray-500 leading-snug line-clamp-2">{p.concern}</p>
                <div className="flex items-center gap-2 mt-auto w-full">
                  <Link to="/clinic/appointments" className="flex-1 bg-[#c0166a] hover:bg-[#a01258] text-white text-xs font-semibold py-2 rounded-xl transition-colors text-center">
                    Schedule Date & Time
                  </Link>
                  <button className="w-8 h-8 rounded-xl border border-gray-100 flex items-center justify-center hover:bg-gray-50 transition-colors">
                    <MoreVertical className="w-3.5 h-3.5 text-gray-400"/>
                  </button>
                </div>
              </div>))}
          </div>
        </motion.div>

        {/* Calendar */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
          {/* Month nav */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900">{calMonth}</h2>
            <div className="flex gap-1">
              <button className="w-6 h-6 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center hover:bg-pink-50">
                <ChevronLeft className="w-3.5 h-3.5 text-gray-400"/>
              </button>
              <button className="w-6 h-6 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center hover:bg-pink-50">
                <ChevronRight className="w-3.5 h-3.5 text-gray-400"/>
              </button>
            </div>
          </div>

          {/* Day labels */}
          <div className="grid grid-cols-7 text-center">
            {DAYS.map((d) => (<span key={d} className="text-[10px] text-gray-400 font-semibold">{d}</span>))}
          </div>

          {/* Date row */}
          <div className="grid grid-cols-7 text-center gap-y-1">
            {calDays.map((d) => (<button key={d} className={`w-7 h-7 mx-auto rounded-full text-[11px] font-semibold transition-colors ${d === today
                    ? "bg-[#c0166a] text-white shadow"
                    : d === 15 || d === 16
                        ? "bg-gray-900 text-white"
                        : "text-gray-600 hover:bg-pink-50"}`}>
                {d}
              </button>))}
          </div>

          {/* Appointments list */}
          <div className="space-y-2 pt-1">
            {(upcomingAppointments.length > 0 ? upcomingAppointments.map((appointment) => ({
                name: appointment.patientName || "Patient",
                type: appointment.conditionName || "Consultation",
                status: "today",
                time: appointment.time || "Schedule pending",
                avatar: appointment.patientAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(appointment.patientName || "P")}&background=fce7f3&color=c0166a`,
            })) : calendarAppointments).map((a) => (<div key={a.name} className="flex items-center gap-2">
                <img src={a.avatar} alt={a.name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" onError={(e) => {
                    (e.target as HTMLImageElement).src =
                        `https://ui-avatars.com/api/?name=${encodeURIComponent(a.name)}&background=fce7f3&color=c0166a&size=56`;
                }}/>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800 truncate">{a.name}</p>
                  <p className="text-[10px] text-gray-400">{a.type}</p>
                </div>
                {a.status === "visited" && (<span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Visited</span>)}
                {a.status === "today" && (<span className="text-[10px] font-semibold text-gray-500 whitespace-nowrap">Today at<br />{a.time}</span>)}
                {a.status === "cancelled" && (<span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">Cancelled</span>)}
              </div>))}
          </div>
        </motion.div>
      </div>
      </>) : (
        /* ── Pending / Rejected verification state ────────────── */
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          {/* Verification steps */}
          <div className="bg-white border border-gray-100 rounded-2xl p-6">
            <h2 className="text-sm font-bold text-gray-900 mb-4">Verification Steps</h2>
            <div className="space-y-4">
              {[
                { step: 1, label: "Submit Clinic Profile", desc: "Fill in your clinic details, operating hours, and license.", done: true },
                { step: 2, label: "Admin Review", desc: "Our team is reviewing your application. This typically takes 1–3 business days.", done: verificationStatus === "rejected" },
                { step: 3, label: "Get Verified & Go Live", desc: "Once approved, patients can discover and book appointments with your clinic.", done: false },
            ].map(({ step, label, desc, done }) => (<div key={step} className="flex items-start gap-4">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-bold ${done ? "bg-green-100 text-green-600" : verificationStatus === "rejected" && step === 2 ? "bg-red-100 text-red-500" : "bg-gray-100 text-gray-400"}`}>
                    {done ? <CheckCircle2 className="w-4 h-4"/> : step}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
                    {step === 2 && verificationStatus === "rejected" && (<p className="text-xs text-red-600 font-medium mt-1">Application was rejected. Please update your profile and contact support.</p>)}
                  </div>
                </div>))}
            </div>
            <Link to="/clinic/settings" className="mt-5 flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#c0166a] text-white text-sm font-semibold hover:bg-[#a01259] transition-colors">
              <ShieldCheck className="w-4 h-4"/>
              {verificationStatus === "rejected" ? "Update Profile" : "View & Complete Profile"}
            </Link>
          </div>

          {/* What's locked */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
                { icon: CalendarX, label: "Appointments", desc: "Patients cannot book with your clinic until verified." },
                { icon: Users, label: "Patient List", desc: "Patient profiles and management are locked until verification." },
                { icon: FileText, label: "Reports & Stats", desc: "Dashboard analytics will appear once your clinic goes live." },
            ].map(({ icon: Icon, label, desc }) => (<div key={label} className="bg-white border border-dashed border-gray-200 rounded-2xl p-5 flex flex-col items-center text-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center">
                  <Icon className="w-6 h-6 text-gray-300"/>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-500">{label}</p>
                  <p className="text-xs text-gray-400 mt-1 leading-snug">{desc}</p>
                </div>
              </div>))}
          </div>
        </motion.div>)}
    </div>);
}
