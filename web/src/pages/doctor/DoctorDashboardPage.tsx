import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  Clock,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Loader2,
  ArrowRight,
  Building2,
  Stethoscope,
  FileCheck,
  X,
  FileText,
  ExternalLink,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useDoctorAppointments, type DoctorAppointmentRecord } from "@/hooks/useDoctorAppointments";

// Mini Sparkline Bar Chart matching the Mediczen aesthetic exactly (4 pastel bars + 1 royal blue bar)
function SparklineBars({ values, activeIndex = 3 }: { values: number[]; activeIndex?: number }) {
  return (
    <div className="flex items-end gap-1.5 h-11 sm:h-12 shrink-0 pb-0.5">
      {values.map((v, idx) => (
        <div
          key={idx}
          className={`w-2 sm:w-2.5 rounded-t-[2.5px] transition-all ${
            idx === activeIndex
              ? "bg-[#2563EB]"
              : "bg-[#D4E0FC]"
          }`}
          style={{ height: `${Math.max(20, Math.min(100, v))}%` }}
        />
      ))}
    </div>
  );
}



export default function DoctorDashboardPage() {
  const {
    doctorName,
    doctorClinic,
    appointments: allAppointments,
    loading,
    markAppointmentDone,
  } = useDoctorAppointments();

  // Consultation & Clinical Result Modal State
  const [consultingAppt, setConsultingAppt] = useState<DoctorAppointmentRecord | null>(null);
  const [clinicalDiagnosis, setClinicalDiagnosis] = useState("");
  const [consultationNotes, setConsultationNotes] = useState("");
  const [savingConsultation, setSavingConsultation] = useState(false);
  const [saveError, setSaveError] = useState("");

  const openConsultation = (appt: DoctorAppointmentRecord) => {
    setConsultingAppt(appt);
    setClinicalDiagnosis(appt.doctorDiagnosis || "");
    setConsultationNotes(appt.doctorNote || "");
    setSaveError("");
  };

  const handleCompleteConsultation = async () => {
    if (!consultingAppt) return;
    if (!clinicalDiagnosis.trim()) {
      setSaveError("Please enter your final clinical diagnosis before completing.");
      return;
    }

    const finalDiag = clinicalDiagnosis.trim();
    try {
      await markAppointmentDone(
        consultingAppt.id,
        finalDiag,
        consultationNotes.trim()
      );
      setConsultingAppt((prev) =>
        prev
          ? {
              ...prev,
              doctorDone: true,
              status: "completed",
              doctorDiagnosis: finalDiag,
              doctorNote: consultationNotes.trim(),
            }
          : prev
      );
    } catch (err: any) {
      setSaveError(err?.message || "Failed to save consultation result.");
    } finally {
      setSavingConsultation(false);
    }
  };

  // Close modal on Escape key
  useEffect(() => {
    if (!consultingAppt) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConsultingAppt(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prev;
    };
  }, [consultingAppt]);

  // Filter queues dynamically
  const pendingReview = useMemo(() => {
    return allAppointments.filter(
      (a) =>
        (a.status === "pending" || String(a.status) === "awaiting_review") &&
        a.doctorStatus !== "approved" &&
        a.doctorStatus !== "rejected"
    );
  }, [allAppointments]);


  const approved = useMemo(() => {
    return allAppointments.filter(
      (a) => a.doctorStatus === "approved"
    );
  }, [allAppointments]);

  const scheduledSent = useMemo(() => {
    return allAppointments.filter(
      (a) =>
        a.status !== "rejected" &&
        a.status !== "cancelled" &&
        a.status !== "completed" &&
        !!a.date &&
        (a.scheduleSentToDoctor || a.status === "confirmed" || a.status === "scheduled")
    );
  }, [allAppointments]);

  const completedList = useMemo(() => {
    return allAppointments.filter((a) => a.status === "completed" || a.doctorDone);
  }, [allAppointments]);


  // Greeting based on time of day
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 18) return "Good Afternoon";
    return "Good Evening";
  }, []);

  // Table sorting
  const [sortOrder, setSortOrder] = useState<"newest" | "name">("newest");

  const displayPatients = useMemo(() => {
    // Show pending cases only
    const list = pendingReview;
    const sorted = [...list];
    if (sortOrder === "name") {
      sorted.sort((a, b) => (a.patientName || "").localeCompare(b.patientName || "", undefined, { sensitivity: "base" }));
    } else {
      sorted.sort((a, b) => {
        const timeA = new Date(a.createdAt || a.date || 0).getTime();
        const timeB = new Date(b.createdAt || b.date || 0).getTime();
        return timeB - timeA;
      });
    }
    return sorted.slice(0, 5);
  }, [pendingReview, sortOrder]);

  // Calendar State
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

  // Map confirmed appointment schedules to date string for the calendar
  const appointmentsByDate = useMemo(() => {
    const map = new Map<string, DoctorAppointmentRecord[]>();
    for (const appt of allAppointments) {
      if (!appt.date) continue;
      // Exclude cases that are pending review, unapproved, rejected, or cancelled
      if (appt.doctorStatus === "pending-review" || appt.doctorStatus === "rejected") continue;
      if (appt.status === "pending" || appt.status === "rejected" || appt.status === "cancelled") continue;

      const isConfirmed =
        appt.status === "confirmed" ||
        appt.status === "scheduled" ||
        appt.doctorStatus === "approved" ||
        appt.status === "completed" ||
        appt.doctorDone ||
        appt.scheduleSentToDoctor;

      if (!isConfirmed) continue;

      const key = appt.date.includes("T") ? appt.date.split("T")[0] : appt.date;
      const arr = map.get(key) || [];
      arr.push(appt);
      map.set(key, arr);
    }
    return map;
  }, [allAppointments]);

  // Generate calendar days for current month view
  const calendarDays = useMemo(() => {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0 is Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Monday-based index: 0 = Mon, 6 = Sun
    const startPadding = (firstDayOfWeek + 6) % 7;

    const days: Array<{
      day: number;
      dateStr: string;
      isCurrentMonth: boolean;
      hasScheduled: boolean;
      hasCompleted: boolean;
    }> = [];

    // Prev month padding
    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = startPadding - 1; i >= 0; i--) {
      const d = prevMonthDays - i;
      const prevDate = new Date(year, month - 1, d);
      const mStr = String(prevDate.getMonth() + 1).padStart(2, "0");
      const dStr = String(d).padStart(2, "0");
      const dateStr = `${prevDate.getFullYear()}-${mStr}-${dStr}`;
      days.push({
        day: d,
        dateStr,
        isCurrentMonth: false,
        hasScheduled: false,
        hasCompleted: false,
      });
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const mStr = String(month + 1).padStart(2, "0");
      const dStr = String(d).padStart(2, "0");
      const dateStr = `${year}-${mStr}-${dStr}`;
      const apptsOnDate = appointmentsByDate.get(dateStr) || [];
      const hasScheduled = apptsOnDate.some(
        (a) => a.status !== "completed" && !a.doctorDone
      );
      const hasCompleted = apptsOnDate.some(
        (a) => a.status === "completed" || a.doctorDone
      );

      days.push({
        day: d,
        dateStr,
        isCurrentMonth: true,
        hasScheduled,
        hasCompleted,
      });
    }

    // Next month padding to fill out 35 or 42 cells
    const remaining = 35 - days.length > 0 ? 35 - days.length : (42 - days.length > 0 ? 42 - days.length : 0);
    for (let d = 1; d <= remaining; d++) {
      const nextDate = new Date(year, month + 1, d);
      const mStr = String(nextDate.getMonth() + 1).padStart(2, "0");
      const dStr = String(d).padStart(2, "0");
      const dateStr = `${nextDate.getFullYear()}-${mStr}-${dStr}`;
      days.push({
        day: d,
        dateStr,
        isCurrentMonth: false,
        hasScheduled: false,
        hasCompleted: false,
      });
    }

    return days;
  }, [calendarDate, appointmentsByDate]);

  const selectedDayAppointments = useMemo(() => {
    return appointmentsByDate.get(selectedCalendarDate) || [];
  }, [appointmentsByDate, selectedCalendarDate]);

  if (loading) {
    return (
      <div className="py-24 text-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-3" />
        <p className="text-xs text-slate-400 font-medium">Loading clinical dashboard...</p>
      </div>
    );
  }

  return (
    <div className="space-y-7 max-w-7xl mx-auto">
      {/* Top Welcome Header - Mediczen Style */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight font-sans">
            {greeting}, Dr. {doctorName || "Doctor"}!
          </h1>
          {doctorClinic ? (
            <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5 font-medium">
              <Building2 className="w-3.5 h-3.5 text-slate-400" />
              <span>{doctorClinic}</span>
            </p>
          ) : null}
          <p className="text-xs text-slate-400 mt-1 font-medium">
            {pendingReview.length > 0
              ? `I hope you're in a good mood because there are ${pendingReview.length} patients waiting for your review`
              : "All patient cases are up to date. Have a productive day in the clinic."}
          </p>
        </div>
      </div>

      {/* Top 4 Stat Cards - Framed container matching Mediczen styling with the 4 doctor cards */}
      <div className="rounded-3xl border border-slate-200/80 bg-[#F8F8FA] p-5 sm:p-6 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5">
          {/* Card 1: Awaiting Review */}
          <Link
            to="/doctor/appointments"
            className="bg-white rounded-2xl border border-slate-100 shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:border-slate-200 hover:shadow-xs transition-all block group overflow-hidden"
          >
            {/* Top row */}
            <div className="px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <Clock className="w-5.5 h-5.5 text-blue-600 stroke-[1.8] shrink-0" />
                <span className="text-base font-bold text-slate-800 tracking-tight truncate">Awaiting Review</span>
              </div>
              <ArrowRight className="w-4.5 h-4.5 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all shrink-0 ml-2" />
            </div>

            {/* Horizontal divider line matching Mediczen */}
            <div className="border-b border-slate-100" />

            {/* Bottom row: Dynamic count + subtitle on left, 5-bar sparkline on right */}
            <div className="px-6 pt-4.5 pb-5.5 flex items-end justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="text-3xl sm:text-[34px] font-black text-slate-900 tracking-tight leading-none block">
                  {pendingReview.length}
                </span>
                <p className="text-xs sm:text-[13px] text-slate-400 mt-2 font-medium tracking-tight truncate">
                  In triage queue
                </p>
              </div>
              <SparklineBars values={[35, 60, 45, 95, 70]} activeIndex={3} />
            </div>
          </Link>

          {/* Card 2: Approved Cases */}
          <Link
            to="/doctor/appointments"
            className="bg-white rounded-2xl border border-slate-100 shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:border-slate-200 hover:shadow-xs transition-all block group overflow-hidden"
          >
            {/* Top row */}
            <div className="px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <FileCheck className="w-5.5 h-5.5 text-blue-600 stroke-[1.8] shrink-0" />
                <span className="text-base font-bold text-slate-800 tracking-tight truncate">Approved</span>
              </div>
              <ArrowRight className="w-4.5 h-4.5 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all shrink-0 ml-2" />
            </div>

            {/* Horizontal divider line */}
            <div className="border-b border-slate-100" />

            {/* Bottom row */}
            <div className="px-6 pt-4.5 pb-5.5 flex items-end justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="text-3xl sm:text-[34px] font-black text-slate-900 tracking-tight leading-none block">
                  {approved.length}
                </span>
                <p className="text-xs sm:text-[13px] text-slate-400 mt-2 font-medium tracking-tight truncate">
                  Awaiting clinic lock
                </p>
              </div>
              <SparklineBars values={[25, 45, 70, 90, 50]} activeIndex={3} />
            </div>
          </Link>

          {/* Card 3: Consultations */}
          <Link
            to="/doctor/scheduled"
            className="bg-white rounded-2xl border border-slate-100 shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:border-slate-200 hover:shadow-xs transition-all block group overflow-hidden"
          >
            {/* Top row */}
            <div className="px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <Stethoscope className="w-5.5 h-5.5 text-blue-600 stroke-[1.8] shrink-0" />
                <span className="text-base font-bold text-slate-800 tracking-tight truncate">Consultations</span>
              </div>
              <ArrowRight className="w-4.5 h-4.5 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all shrink-0 ml-2" />
            </div>

            {/* Horizontal divider line */}
            <div className="border-b border-slate-100" />

            {/* Bottom row */}
            <div className="px-6 pt-4.5 pb-5.5 flex items-end justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="text-3xl sm:text-[34px] font-black text-slate-900 tracking-tight leading-none block">
                  {scheduledSent.length}
                </span>
                <p className="text-xs sm:text-[13px] text-slate-400 mt-2 font-medium tracking-tight truncate">
                  Locked sessions
                </p>
              </div>
              <SparklineBars values={[40, 55, 30, 85, 60]} activeIndex={3} />
            </div>
          </Link>

          {/* Card 4: Finished Consults */}
          <Link
            to="/doctor/history"
            className="bg-white rounded-2xl border border-slate-100 shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:border-slate-200 hover:shadow-xs transition-all block group overflow-hidden"
          >
            {/* Top row */}
            <div className="px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <CheckCircle2 className="w-5.5 h-5.5 text-blue-600 stroke-[1.8] shrink-0" />
                <span className="text-base font-bold text-slate-800 tracking-tight truncate">Finished Consults</span>
              </div>
              <ArrowRight className="w-4.5 h-4.5 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all shrink-0 ml-2" />
            </div>

            {/* Horizontal divider line */}
            <div className="border-b border-slate-100" />

            {/* Bottom row */}
            <div className="px-6 pt-4.5 pb-5.5 flex items-end justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="text-3xl sm:text-[34px] font-black text-slate-900 tracking-tight leading-none block">
                  {completedList.length}
                </span>
                <p className="text-xs sm:text-[13px] text-slate-400 mt-2 font-medium tracking-tight truncate">
                  Completed cases
                </p>
              </div>
              <SparklineBars values={[30, 65, 40, 100, 75]} activeIndex={3} />
            </div>
          </Link>
        </div>
      </div>

      {/* Middle Grid: Two Columns (Patient List on Left, Calendar on Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Patient List (approx 65% / 7 cols) */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs">
          <div className="flex items-center justify-between pb-5">
            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">Patient</h2>
              <p className="text-xs text-slate-400 mt-0.5 font-medium">
                 To Review Appointment list
              </p>
            </div>

            <div className="flex items-center gap-3">
              {/* Sort Pill */}
              <button
                type="button"
                onClick={() => setSortOrder((prev) => (prev === "newest" ? "name" : "newest"))}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
              >
                <span>Sort : {sortOrder === "newest" ? "Newest" : "A - Z"}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              <Link
                to="/doctor/appointments"
                className="text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline"
              >
                See All
              </Link>
            </div>
          </div>

          {/* Patient Table matching the Mediczen screenshot layout */}
          {displayPatients.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-[11px] text-slate-400 mt-0.5">
                No To Review patient appointments assigned yet.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-[#F8F9FB] border-b border-slate-200/80 text-[11px] font-semibold text-slate-500">
                      <th className="py-3 px-4 font-semibold">Name</th>
                      <th className="py-3 px-4 font-semibold">Ward No.</th>
                      <th className="py-3 px-4 font-semibold">Date</th>
                      <th className="py-3 px-4 font-semibold text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {displayPatients.map((appt) => {
                      const formattedDate = appt.date
                        ? new Date(appt.date).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : new Date(appt.createdAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          });

                      const caseRef = appt.queueNumber
                        ? `#Q-${String(appt.queueNumber).padStart(3, "0")}`
                        : `#${appt.id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

                      const ageText = appt.patientAge ? `${appt.patientAge} Years` : "Adult";
                      const genderText = appt.patientGender || "Patient";

                      return (
                        <tr key={appt.id} className="group hover:bg-slate-50/70 transition-colors">
                          {/* Name + Demographic subline */}
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-3">
                              <img
                                src={
                                  appt.patientAvatar ||
                                  `https://ui-avatars.com/api/?name=${encodeURIComponent(
                                    appt.patientName || "P"
                                  )}&background=EFF6FF&color=2563EB`
                                }
                                alt={appt.patientName || "Patient"}
                                className="w-9 h-9 rounded-full object-cover border border-slate-200 shrink-0 shadow-2xs"
                              />
                              <div className="min-w-0">
                                <p className="font-bold text-slate-900 text-xs truncate">
                                  {appt.patientName || "Anonymous Patient"}
                                </p>
                                <p className="text-[11px] text-slate-400 truncate mt-0.5 font-medium">
                                  {genderText}, {ageText}
                                </p>
                              </div>
                            </div>
                          </td>

                          {/* Case Ref / Ward */}
                          <td className="py-3.5 px-4 text-slate-500 font-medium text-xs">
                            {caseRef}
                          </td>

                          {/* Date */}
                          <td className="py-3.5 px-4 text-slate-600 font-medium text-xs">
                            {formattedDate}
                          </td>

                          {/* Action link */}
                          <td className="py-3.5 px-4 text-right">
                            <Link
                              to={`/doctor/appointments?review=${encodeURIComponent(appt.id)}`}
                              className="text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors"
                            >
                              Review
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Calendar Widget (approx 35% / 5 cols) */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs">
          {/* Calendar Header with Legend and Month Nav */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900 tracking-tight">
                {calendarDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </h3>
              {/* Legend dots matching Mediczen screenshot */}
              <div className="flex items-center gap-3.5 mt-2 text-[10px] font-medium text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-600 inline-block" />
                  <span>Scheduled</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                  <span>Completed</span>
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1))
                }
                className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors cursor-pointer shadow-2xs"
                title="Previous month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1))
                }
                className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors cursor-pointer shadow-2xs"
                title="Next month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 text-center pt-5 pb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            <span>MON</span>
            <span>TUE</span>
            <span>WED</span>
            <span>THU</span>
            <span>FRI</span>
            <span>SAT</span>
            <span>SUN</span>
          </div>

          {/* Day Grid */}
          <div className="grid grid-cols-7 gap-y-1.5 text-center text-xs">
            {calendarDays.map((cell, idx) => {
              const isSelected = cell.dateStr === selectedCalendarDate;
              const isToday =
                cell.dateStr ===
                `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(
                  new Date().getDate()
                ).padStart(2, "0")}`;

              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setSelectedCalendarDate(cell.dateStr)}
                  className="flex flex-col items-center justify-center py-1 rounded-xl transition-all cursor-pointer relative group"
                >
                  {isSelected ? (
                    <div className="w-7 h-7 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center shadow-xs">
                      {cell.day}
                    </div>
                  ) : (
                    <span
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs transition-colors ${
                        isToday
                          ? "bg-blue-50 text-blue-600 font-bold"
                          : cell.isCurrentMonth
                          ? "text-slate-700 font-medium group-hover:bg-slate-100"
                          : "text-slate-300 font-normal"
                      }`}
                    >
                      {cell.day}
                    </span>
                  )}

                  {/* Indicator dots beneath date matching Mediczen */}
                  <div className="flex items-center gap-0.5 mt-0.5 h-1.5">
                    {cell.hasScheduled && (
                      <span
                        className={`w-1 h-1 rounded-full ${
                          isSelected ? "bg-blue-200" : "bg-blue-600"
                        }`}
                      />
                    )}
                    {cell.hasCompleted && (
                      <span
                        className={`w-1 h-1 rounded-full ${
                          isSelected ? "bg-emerald-200" : "bg-emerald-500"
                        }`}
                      />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Mini preview of selected date */}
          <div className="mt-4 pt-3.5 border-t border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Appointments on {selectedCalendarDate}
            </p>
            {selectedDayAppointments.length === 0 ? (
              <p className="text-xs text-slate-400 mt-1">No confirmed sessions scheduled on this date.</p>
            ) : (
              <div className="space-y-2 mt-2.5 max-h-48 overflow-y-auto pr-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {selectedDayAppointments.map((a) => {
                  const isDone = a.status === "completed" || a.doctorDone;
                  return (
                    <div
                      key={a.id}
                      onClick={() => openConsultation(a)}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100/70 border border-slate-200/70 hover:border-slate-300 transition-all cursor-pointer group text-xs shadow-2xs"
                    >
                      <div className="truncate mr-2">
                        <p className="font-bold text-slate-900 truncate group-hover:text-blue-600 transition-colors">
                          {a.patientName}
                        </p>
                        <p className="text-[10px] text-slate-500 truncate mt-0.5">
                          {a.time || "Scheduled"} • {a.conditionName || "Consultation"}
                        </p>
                      </div>

                      {isDone ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openConsultation(a);
                          }}
                          className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200/80 transition-all cursor-pointer shadow-2xs shrink-0 hover:scale-102 active:scale-98"
                          title="Click to view consultation result & details"
                        >
                          Completed
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openConsultation(a);
                          }}
                          className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-blue-600 hover:bg-blue-700 text-white transition-all cursor-pointer shadow-2xs shrink-0 hover:scale-102 active:scale-98"
                          title="Click to conduct visit and complete consultation"
                        >
                          Conduct Visit
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>



      {/* ================= CONSULTATION & CLINICAL RESULT MODAL ================= */}
      <AnimatePresence>
        {consultingAppt && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-xs"
            onClick={() => setConsultingAppt(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col my-auto border border-slate-100"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700">
                    <Stethoscope className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">
                      Consultation &amp; Clinical Result
                    </h3>
                    <p className="text-xs text-slate-400">
                      Scheduled Visit: {consultingAppt.date} at {consultingAppt.time || "Scheduled"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setConsultingAppt(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body */}
              <div className="overflow-y-auto flex-1 p-6 space-y-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {/* Patient Header */}
                <div className="flex items-center gap-3.5 p-3 rounded-xl bg-slate-50/80 border border-slate-100">
                  <img
                    src={
                      consultingAppt.patientAvatar ||
                      `https://ui-avatars.com/api/?name=${encodeURIComponent(
                        consultingAppt.patientName || "P"
                      )}&background=EFF6FF&color=2563EB`
                    }
                    alt={consultingAppt.patientName || "Patient"}
                    className="w-12 h-12 rounded-full object-cover border border-slate-200 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-base font-bold text-slate-900 truncate">
                        {consultingAppt.patientName || "Patient"}
                      </p>
                      <span
                        className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                          consultingAppt.status === "completed" || consultingAppt.doctorDone
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-blue-50 text-blue-700 border border-blue-200"
                        }`}
                      >
                        {consultingAppt.status === "completed" || consultingAppt.doctorDone
                          ? "Completed"
                          : "Scheduled"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-slate-500">
                      {consultingAppt.patientGender && (
                        <span>{consultingAppt.patientGender}</span>
                      )}
                      {consultingAppt.patientGender && consultingAppt.patientAge && <span>•</span>}
                      {consultingAppt.patientAge ? (
                        <span>{consultingAppt.patientAge} years old</span>
                      ) : null}
                      {consultingAppt.patientContact && (
                        <>
                          <span>•</span>
                          <span>{consultingAppt.patientContact}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Patient Intake / Notes */}
                {(consultingAppt.notes || consultingAppt.conditionName) && (
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/60 text-xs">
                    <p className="font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-slate-600" />
                      Reason for Consultation &amp; Chief Complaint
                    </p>
                    <p className="text-slate-600 leading-relaxed">
                      {consultingAppt.notes || consultingAppt.conditionName}
                    </p>
                  </div>
                )}

                {/* Clinical Findings & Diagnosis Section */}
                <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-3.5">
                  <div className="flex items-center gap-2">
                    <FileCheck className="w-4 h-4 text-slate-700" />
                    <p className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Doctor's Clinical Decision &amp; Findings
                    </p>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed -mt-1">
                    Enter your official clinical diagnosis and consultation notes after conducting the examination.
                  </p>

                  {saveError && (
                    <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-600 font-medium">
                      {saveError}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Final Clinical Diagnosis <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      disabled={consultingAppt.status === "completed" || consultingAppt.doctorDone}
                      value={clinicalDiagnosis}
                      onChange={(e) => setClinicalDiagnosis(e.target.value)}
                      placeholder="Enter final clinical diagnosis..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Prescription, Treatment Plan &amp; Consultation Notes
                    </label>
                    <textarea
                      rows={3}
                      disabled={consultingAppt.status === "completed" || consultingAppt.doctorDone}
                      value={consultationNotes}
                      onChange={(e) => setConsultationNotes(e.target.value)}
                      placeholder="Enter prescription recommendations, topical medication, lifestyle care, and follow-up advice..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3 shrink-0 bg-white">
                <Link
                  to={`/doctor/scheduled?date=${consultingAppt.date}&id=${consultingAppt.id}`}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800 inline-flex items-center gap-1.5"
                >
                  <span>Open in Assigned Appointments</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>

                <div className="flex items-center gap-2">
                  {consultingAppt.status === "completed" || consultingAppt.doctorDone ? (
                    <div className="inline-flex items-center px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold">
                      Consultation Completed &amp; Saved
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={savingConsultation}
                      onClick={handleCompleteConsultation}
                      className="inline-flex items-center px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 shadow-2xs"
                    >
                      {savingConsultation ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Saving Result...
                        </>
                      ) : (
                        "Complete Consultation & Save"
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setConsultingAppt(null)}
                    className="py-2 px-4 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
