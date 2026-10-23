import { compareDoctorAppointments } from "@/lib/doctorAppointmentScope";
import { useMemo, useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Calendar,
  Clock,
  ChevronDown,
  Stethoscope,
  X,
  Loader2,
  ClipboardList,
  FileCheck,
  FileText,
  Building2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useDoctorAppointments, type DoctorAppointmentRecord } from "@/hooks/useDoctorAppointments";
import { LazySkinPhoto } from "@/components/common/LazySkinPhoto";
import { formatConfidencePercent } from "@/lib/utils";
import { ModalPortal } from "@/components/common/ModalPortal";
import { PatientAvatar } from "@/components/common/PatientAvatar";

type AppointmentRecord = DoctorAppointmentRecord;

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

// Safe date parsing that avoids timezone shifts
function parseLocalDate(dateStr: string): Date {
  if (!dateStr) return new Date(NaN);
  const clean = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
  const parts = clean.split("-").map(Number);
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date(NaN) : d;
}

function formatDateHeader(dateStr: string): string {
  try {
    const d = parseLocalDate(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function getWeekdayName(dateStr: string): string {
  try {
    const d = parseLocalDate(dateStr);
    return d.toLocaleDateString("en-US", { weekday: "long" });
  } catch {
    return "";
  }
}

function formatTime(timeStr?: string, dateStr?: string): string {
  if (timeStr && timeStr !== "—" && timeStr !== "\u2014") {
    try {
      if (timeStr.includes("AM") || timeStr.includes("PM")) return timeStr;
      const [h, m] = timeStr.split(":").map(Number);
      const ampm = h >= 12 ? "PM" : "AM";
      const hour = h % 12 || 12;
      return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
    } catch {
      return timeStr;
    }
  }
  if (dateStr && dateStr.includes("T")) {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed.toLocaleTimeString("en-PH", {
        timeZone: "Asia/Manila",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    }
  }
  return "Time not provided";
}


export default function DoctorScheduledAppointmentsPage() {
  const { appointments, loading, markAppointmentDone } = useDoctorAppointments();
  const [tab, setTab] = useState<"upcoming" | "completed">("upcoming");
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => new Date().getFullYear());
  const pickerRef = useRef<HTMLDivElement>(null);

  const yearOptions = useMemo(() => {
    const baseYear = new Date().getFullYear();
    const start = Math.min(baseYear - 5, pickerYear - 2);
    const end = Math.max(baseYear + 7, pickerYear + 2);
    const years: number[] = [];
    for (let y = start; y <= end; y++) {
      years.push(y);
    }
    return years;
  }, [pickerYear]);

  useEffect(() => {
    if (isPickerOpen) {
      setPickerYear(currentDate.getFullYear());
    }
  }, [isPickerOpen, currentDate]);

  useEffect(() => {
    if (!isPickerOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setIsPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isPickerOpen]);

  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const [viewingAppt, setViewingAppt] = useState<AppointmentRecord | null>(null);
  const [clinicalDiagnosis, setClinicalDiagnosis] = useState("");
  const [consultationNotes, setConsultationNotes] = useState("");
  const [savingResult, setSavingResult] = useState(false);
  const [saveError, setSaveError] = useState("");
  // Filter approved/accepted appointments only (excluding pending or under-review)
  const approvedAppointments = useMemo<AppointmentRecord[]>(() => {
    const realApproved: AppointmentRecord[] = appointments
      .filter((a) => {
        // Exclude pending or under-review
          if (a.doctorStatus === "pending-review" || a.doctorStatus === "rejected") return false;
          if (a.status === "pending" || a.status === "rejected" || a.status === "cancelled") return false;
          const isApprovedStatus =
            a.doctorStatus === "approved" ||
            a.status === "scheduled" ||
            a.status === "confirmed" ||
            (a as any).status === "accepted";
          return isApprovedStatus && Boolean(a.date);
        })

    return realApproved;
  }, [appointments]);


  // Scheduled and completed lists
  const scheduledList = useMemo(() => {
    return appointments.filter(
      (a) =>
        (a.status === "scheduled" || a.status === "confirmed" || (a as any).status === "accepted") &&
        a.doctorStatus === "approved" &&
        !a.doctorDone &&
        a.status !== "completed" &&
        a.checkInStatus !== "completed" &&
        a.checkInStatus !== "no-show" &&
        !!a.date
    );
  }, [appointments]);

  const completedList = useMemo(() => {
    return appointments.filter((a) => a.status === "completed" || a.doctorDone || a.checkInStatus === "completed" || a.checkInStatus === "no-show");
  }, [appointments]);

  // Counts for the tabs are derived only from real appointment data
  const scheduledCount = scheduledList.length;
  const completedCount = completedList.length;

  // Active appointments according to selected tab
  const activeTabAppointments = useMemo(() => {
    if (tab === "completed") {
      return approvedAppointments.filter((a) => a.status === "completed" || a.doctorDone || a.checkInStatus === "completed" || a.checkInStatus === "no-show");
    }
    return approvedAppointments.filter((a) => a.status !== "completed" && !a.doctorDone && a.checkInStatus !== "completed" && a.checkInStatus !== "no-show");
  }, [approvedAppointments, tab]);

  // Map of counts per date (YYYY-MM-DD -> count)
  const appointmentsByDate = useMemo(() => {
    const map = new Map<string, AppointmentRecord[]>();
    for (const appt of activeTabAppointments) {
      if (!appt.date) continue;
      const key = appt.date.includes("T") ? appt.date.split("T")[0] : appt.date;
      const existing = map.get(key) || [];
      existing.push(appt);
      map.set(key, existing);
    }
    return map;
  }, [activeTabAppointments]);

  // Appointments for the selected date
  const selectedDateAppointments = useMemo(() => {
    const list = appointmentsByDate.get(selectedDate) || [];
    return [...list].sort(compareDoctorAppointments);
  }, [appointmentsByDate, selectedDate]);

  // Generate calendar days for current month view
  const calendarDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0 = Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const days: Array<{
      day: number;
      dateStr: string;
      isCurrentMonth: boolean;
      approvedCount: number;
    }> = [];

    // Prev month padding
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const prevDate = new Date(year, month - 1, d);
      const y = prevDate.getFullYear();
      const m = String(prevDate.getMonth() + 1).padStart(2, "0");
      const dayNum = String(d).padStart(2, "0");
      const dateStr = `${y}-${m}-${dayNum}`;
      const count = (appointmentsByDate.get(dateStr) || []).length;
      days.push({ day: d, dateStr, isCurrentMonth: false, approvedCount: count });
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const m = String(month + 1).padStart(2, "0");
      const dayNum = String(d).padStart(2, "0");
      const dateStr = `${year}-${m}-${dayNum}`;
      const count = (appointmentsByDate.get(dateStr) || []).length;
      days.push({ day: d, dateStr, isCurrentMonth: true, approvedCount: count });
    }

    // Next month padding to fill out complete weeks (35 or 42 cells)
    const totalCells = days.length;
    const targetLength = totalCells <= 35 ? 35 : 42;
    const remaining = targetLength - totalCells;
    for (let d = 1; d <= remaining; d++) {
      const nextDate = new Date(year, month + 1, d);
      const y = nextDate.getFullYear();
      const m = String(nextDate.getMonth() + 1).padStart(2, "0");
      const dayNum = String(d).padStart(2, "0");
      const dateStr = `${y}-${m}-${dayNum}`;
      const count = (appointmentsByDate.get(dateStr) || []).length;
      days.push({ day: d, dateStr, isCurrentMonth: false, approvedCount: count });
    }

    return days;
  }, [currentDate, appointmentsByDate]);

  const currentMonthYearLabel = useMemo(() => {
    return currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }, [currentDate]);

  const [searchParams] = useSearchParams();

  // Modal open & consultation handlers
  const openApptModal = (appt: AppointmentRecord) => {
    setViewingAppt(appt);
    setClinicalDiagnosis(appt.doctorDiagnosis || "");
    setConsultationNotes(appt.doctorNote || "");
    setSaveError("");
  };

  // Sync date/id from URL search parameters if provided (e.g. from Dashboard click)
  useEffect(() => {
    const paramDate = searchParams.get("date");
    const paramId = searchParams.get("id");
    if (paramDate) {
      setSelectedDate(paramDate);
      const d = parseLocalDate(paramDate);
      if (!isNaN(d.getTime())) {
        setCurrentDate(d);
      }
    }
    if (paramId && appointments.length > 0) {
      const target = appointments.find((a) => String(a.id) === String(paramId));
      if (target) {
        if (target.status === "completed" || target.doctorDone) {
          setTab("completed");
        }
        openApptModal(target);
      }
    }
  }, [searchParams, appointments]);


  // Close modal with ESC key and prevent background scroll when open
  useEffect(() => {
    if (!viewingAppt) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setViewingAppt(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [viewingAppt]);

  const handleCompleteConsultation = async () => {
    if (!viewingAppt) return;
    if (!clinicalDiagnosis.trim()) {
      setSaveError("Please enter your final clinical diagnosis before completing.");
      return;
    }

    const finalDiagnosis = clinicalDiagnosis.trim();

    setSavingResult(true);
    setSaveError("");
    try {
      await markAppointmentDone(
        viewingAppt.id,
        finalDiagnosis,
        consultationNotes.trim()
      );
      setViewingAppt((prev) =>
        prev
          ? {
              ...prev,
              doctorDone: true,
              status: "completed",
              doctorDiagnosis: finalDiagnosis,
              doctorNote: consultationNotes.trim(),
            }
          : prev
      );
    } catch (err: any) {
      setSaveError(err?.message || "Failed to save consultation result.");
    } finally {
      setSavingResult(false);
    }
  };

  if (loading) {
    return (
      <div className="py-24 text-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-3" />
        <p className="text-sm text-slate-400">Loading assigned appointments...</p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-5 sm:space-y-6 min-w-0">
      {/* Top Header */}
      <div>
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-[#0f172a] tracking-tight">
          Assigned Appointments
        </h1>
        <p className="text-base text-slate-500 mt-1">
          Finalized schedules confirmed by the clinic &mdash; conduct consultation and record clinical results.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200/80 overflow-x-auto whitespace-nowrap pb-px no-scrollbar scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => setTab("upcoming")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer flex items-center shrink-0 ${
            tab === "upcoming"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Upcoming Schedules
          <span
            className={`ml-2 text-[11px] px-2 py-0.5 rounded-full font-bold ${
              tab === "upcoming"
                ? "bg-blue-50 text-blue-600"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {scheduledCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setTab("completed")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer flex items-center ${
            tab === "completed"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Completed Consultations
          <span
            className={`ml-2 text-[11px] px-2 py-0.5 rounded-full font-bold ${
              tab === "completed"
                ? "bg-blue-50 text-blue-600"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {completedCount}
          </span>
        </button>
      </div>

      {/* Responsive Two-Column Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start min-w-0">
        {/* ================= CARD 1 (LEFT): CALENDAR ================= */}
        <div className="bg-white rounded-2xl p-4 sm:p-6 md:p-7 border border-slate-200/90 shadow-xs flex flex-col justify-between min-h-140 min-w-0">
          <div>
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4">
              <div>
                <h2 className="text-base md:text-lg font-bold text-slate-900 leading-tight">
                  Assigned Appointment Calendar
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  View your scheduled patients. Click a date to see the list of approved appointments.
                </p>
              </div>

              {/* Month / Year Controls */}
              <div ref={pickerRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setIsPickerOpen((prev) => !prev)}
                  className="flex items-center gap-1.5 text-base font-bold text-slate-900 tracking-tight hover:text-blue-600 transition-colors cursor-pointer group px-2 py-1 rounded-lg hover:bg-slate-50"
                  title="Click to choose month and year"
                >
                  <span>{currentMonthYearLabel}</span>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 group-hover:text-blue-600 transition-transform ${
                      isPickerOpen ? "rotate-180 text-blue-600" : ""
                    }`}
                  />
                </button>

                {isPickerOpen && (
                  <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-100 p-3.5 z-50 animate-in fade-in zoom-in-95 duration-150">
                    {/* Year Selector */}
                    <div className="flex items-center justify-center pb-2 mb-2 border-b border-slate-100">
                      <div className="relative inline-flex items-center">
                        <select
                          value={pickerYear}
                          onChange={(e) => setPickerYear(Number(e.target.value))}
                          className="appearance-none font-bold text-sm text-slate-900 bg-transparent border-0 outline-none pl-1 pr-5 py-0.5 cursor-pointer hover:text-blue-600 transition-colors"
                          aria-label="Select year"
                        >
                          {yearOptions.map((y) => (
                            <option key={y} value={y}>
                              {y}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-0.5 pointer-events-none" />
                      </div>
                    </div>

                    {/* 12 Months Grid */}
                    <div className="grid grid-cols-3 gap-1.5 my-1">
                      {MONTH_NAMES.map((name, idx) => {
                        const isSelected =
                          currentDate.getFullYear() === pickerYear && currentDate.getMonth() === idx;
                        const isCurrentMonth =
                          new Date().getFullYear() === pickerYear && new Date().getMonth() === idx;

                        return (
                          <button
                            key={name}
                            type="button"
                            onClick={() => {
                              setCurrentDate(new Date(pickerYear, idx, 1));
                              setIsPickerOpen(false);
                            }}
                            className={`py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
                              isSelected
                                ? "bg-blue-600 text-white shadow-xs font-bold"
                                : isCurrentMonth
                                ? "bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold"
                                : "text-slate-700 hover:bg-slate-100"
                            }`}
                          >
                            {name}
                          </button>
                        );
                      })}
                    </div>

                    {/* Footer Shortcut */}
                    <div className="flex items-center justify-between pt-2.5 mt-2 border-t border-slate-100 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          const now = new Date();
                          setPickerYear(now.getFullYear());
                          setCurrentDate(now);
                          setIsPickerOpen(false);
                        }}
                        className="font-semibold text-blue-600 hover:text-blue-700 py-1 px-2 rounded-lg hover:bg-blue-50 transition-colors cursor-pointer"
                      >
                        This Month
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsPickerOpen(false)}
                        className="font-medium text-slate-400 hover:text-slate-600 py-1 px-2 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Standard Sunday-Saturday Grid Header */}
            <div className="grid grid-cols-7 border-t border-slate-100 pt-3">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dayName) => (
                <div
                  key={dayName}
                  className="text-center text-sm font-semibold text-slate-400 py-2"
                >
                  {dayName}
                </div>
              ))}
            </div>

            {/* Calendar Days Grid */}
            <div className="grid grid-cols-7 gap-y-2 gap-x-1 pt-1">
              {calendarDays.map((cell) => {
                const isSelected = cell.dateStr === selectedDate;
                const hasAppointments = cell.approvedCount > 0;

                return (
                  <button
                    key={cell.dateStr}
                    type="button"
                    onClick={() => {
                      setSelectedDate(cell.dateStr);
                      // If clicked day is from outside current month, automatically sync the month
                      if (!cell.isCurrentMonth) {
                        const target = parseLocalDate(cell.dateStr);
                        setCurrentDate(new Date(target.getFullYear(), target.getMonth(), 1));
                      }
                    }}
                    className={`min-h-16 p-1 flex flex-col items-center justify-start rounded-2xl transition-all cursor-pointer group ${
                      isSelected
                        ? "bg-blue-50/50"
                        : "hover:bg-slate-50/90"
                    }`}
                  >
                    {/* Day Number */}
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                        isSelected
                          ? "bg-blue-600 text-white shadow-xs"
                          : cell.isCurrentMonth
                          ? "text-slate-700 group-hover:text-slate-900"
                          : "text-slate-300"
                      }`}
                    >
                      {cell.day}
                    </div>

                    {/* Dot Indicator + Count Badge for days with approved appointments */}
                    {hasAppointments ? (
                      <div className="flex flex-col items-center mt-1 gap-1">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            tab === "completed" ? "bg-emerald-500" : "bg-blue-600"
                          }`}
                        />
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold leading-none ${
                            tab === "completed"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200/70"
                              : "bg-blue-50 text-blue-600 border border-blue-200/60"
                          }`}
                        >
                          {cell.approvedCount}
                        </span>
                      </div>
                    ) : (
                      <div className="h-6" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ================= CARD 2 (RIGHT): SELECTED DATE PATIENT LIST ================= */}
        <div className="bg-white rounded-2xl p-4 sm:p-6 md:p-7 border border-slate-200/90 shadow-xs flex flex-col justify-between min-h-140 min-w-0">
          <div>
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-base md:text-lg font-bold text-slate-900 leading-tight">
                  Appointments for {formatDateHeader(selectedDate)}
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {selectedDateAppointments.length}{" "}
                  {selectedDateAppointments.length === 1 ? "approved patient" : "approved patients"}
                </p>
              </div>

              {/* Weekday tag */}
              <div className="px-3.5 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold border border-blue-100/80 shrink-0 self-start sm:self-auto">
                {getWeekdayName(selectedDate)}
              </div>
            </div>

            {/* Patient Cards List */}
            {selectedDateAppointments.length === 0 ? (
              <div className="py-24 text-center px-4 flex flex-col items-center justify-center">
                <p className="text-base font-semibold text-slate-700 mb-1">
                  No approved appointments scheduled for this date.
                </p>
                <p className="text-sm text-slate-400 max-w-xs leading-relaxed">
                  Click on any highlighted date in the calendar to view approved scheduled patients.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 mt-2">
                {selectedDateAppointments.map((appt) => {
                  return (
                    <div
                      key={appt.id}
                      className="py-4.5 flex flex-col xl:flex-row xl:items-center justify-between gap-4 first:pt-4 last:pb-2 group transition-all"
                    >
                      {/* Left: Avatar + Name + Gender/Age + Diagnosis */}
                      <div className="flex items-center gap-3.5 min-w-0 xl:w-[35%]">
                        <PatientAvatar
                          avatarUrl={appt.patientAvatar}
                          fullName={appt.patientName}
                          sizeClass="w-12 h-12"
                          borderClass="border border-slate-100"
                          className="shrink-0 shadow-2xs"
                        />
                        <div className="min-w-0">
                          <h3 className="font-bold text-slate-900 text-sm md:text-base leading-snug truncate">
                            {appt.patientName}
                          </h3>
                          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium mt-0.5">
                            {appt.patientGender && <span>{appt.patientGender}</span>}
                            {appt.patientGender && (appt.patientAge || appt.patientBirthdate) && <span>&bull;</span>}
                            {(appt.patientAge || appt.patientBirthdate) && (
                              <span>
                                {appt.patientAge ? `${appt.patientAge} years old` : `Born ${appt.patientBirthdate}`}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-slate-600 mt-1 truncate">
                            <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="truncate">
                              {appt.doctorDiagnosis || appt.conditionName || "Not provided"}
                            </span>
                          </div>
                          {appt.clinicName && (
                            <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md mt-1.5 border border-blue-100/80">
                              <Building2 className="w-3 h-3 text-blue-500 shrink-0" />
                              <span className="truncate max-w-37.5">{appt.clinicName}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Middle: Time + Reason for Visit */}
                      <div className="flex flex-col gap-1.5 min-w-0 xl:w-[40%] xl:px-2">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                          <Clock className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                          <span>{formatTime(appt.time, appt.date)}</span>
                        </div>

                        {/* Reason for Visit */}
                        <div className="flex items-start gap-1.5 text-xs text-slate-600 mt-0.5">
                          <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                          <div className="leading-tight truncate">
                            <span className="text-slate-400 block text-[10.5px]">
                              Reason for Visit:
                            </span>
                            <span className="text-slate-700 font-medium text-xs truncate block">
                              {appt.notes || appt.conditionName || "Not provided"}
                            </span>
                          </div>
                        </div>
                      </div>
                      {/* Right: Conduct Visit Button */}
                      <div className="shrink-0 flex items-center xl:justify-end w-full sm:w-auto">
                        <button
                          type="button"
                          onClick={() => openApptModal(appt)}
                          className="h-10 px-4.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-xs shrink-0 cursor-pointer w-full sm:w-auto"
                        >
                          <ClipboardList className="w-3.5 h-3.5" />
                          <span>
                            {appt.checkInStatus === "no-show"
                              ? "View No-Show Record"
                              : tab === "completed" || appt.doctorDone || appt.status === "completed"
                              ? "View Result"
                              : "Conduct Visit"}
                          </span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ================= CONSULTATION & CLINICAL RESULT MODAL ================= */}
      <ModalPortal isOpen={Boolean(viewingAppt)}>
        <AnimatePresence>
          {viewingAppt && (
            <div
              className="fixed inset-0 z-9998 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-xs"
              onClick={() => setViewingAppt(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 8 }}
                transition={{ duration: 0.2 }}
                className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col my-auto relative z-9999"
                onClick={(e) => e.stopPropagation()}
              >
              {/* Header */}
              <div className="bg-white border-b border-slate-100 px-4 sm:px-6 py-3.5 sm:py-4 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <Stethoscope className="w-5 h-5 text-slate-700 shrink-0" />
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-900 text-base truncate">
                      Consultation &amp; Clinical Result
                    </h3>
                    <p className="text-sm text-slate-400 truncate">
                      Scheduled Visit for {formatDateHeader(viewingAppt.date)} at{" "}
                      {formatTime(viewingAppt.time, viewingAppt.date)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setViewingAppt(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shrink-0 ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body */}
              <div className="overflow-y-auto flex-1 p-4 sm:p-6 space-y-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] scrollbar-none">
                {/* Patient Header */}
                <div className="flex items-center gap-3">
                  <PatientAvatar
                    avatarUrl={viewingAppt.patientAvatar}
                    fullName={viewingAppt.patientName}
                    sizeClass="w-12 h-12"
                    borderClass="border border-slate-200"
                    className="shrink-0"
                  />
                  <div>
                    <p className="text-lg font-bold text-slate-900">
                      {viewingAppt.patientName || "Not provided"}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {viewingAppt.patientGender && (
                        <span className="text-[11px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full">
                          {viewingAppt.patientGender}
                        </span>
                      )}
                      {viewingAppt.patientAge ? (
                        <span className="text-sm text-slate-400">
                          {viewingAppt.patientAge} years old
                        </span>
                      ) : viewingAppt.patientBirthdate ? (
                        <span className="text-sm text-slate-400">
                          Born {viewingAppt.patientBirthdate}
                        </span>
                      ) : null}
                    </div>
                    {viewingAppt.emergencyContactName && (
                      <p className="text-sm text-rose-600 font-medium mt-1">
                        <span className="font-semibold text-rose-700">
                          Emergency Contact:
                        </span>{" "}
                        {viewingAppt.emergencyContactName}{" "}
                        {viewingAppt.emergencyRelationship
                          ? `(${viewingAppt.emergencyRelationship})`
                          : ""}{" "}
                        {viewingAppt.emergencyContactPhone
                          ? ` \u2022 ${viewingAppt.emergencyContactPhone}`
                          : ""}
                      </p>
                    )}
                  </div>
                </div>

                {/* Confirmed Schedule Banner */}
                <div className="rounded-2xl border border-slate-200 bg-white p-3.5 space-y-2">
                  <p className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                    Confirmed Schedule
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-slate-50/70 rounded-xl border border-slate-200/80 p-2.5">
                      <span className="text-[11px] text-slate-400 font-semibold block uppercase">
                        Date
                      </span>
                      <span className="font-bold text-slate-900 truncate block">
                        {formatDateHeader(viewingAppt.date)}
                      </span>
                    </div>
                    <div className="bg-slate-50/70 rounded-xl border border-slate-200/80 p-2.5">
                      <span className="text-[11px] text-slate-400 font-semibold block uppercase">
                        Time
                      </span>
                      <span className="font-bold text-slate-900 truncate block">
                        {formatTime(viewingAppt.time, viewingAppt.date)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Uploaded Skin Photo & AI Result */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">
                      Uploaded Skin Photo
                    </p>
                    {viewingAppt.skinPhotoUrl ? (
                      <LazySkinPhoto
                        pathOrUrl={viewingAppt.skinPhotoUrl}
                        alt="Skin photo"
                        className="w-full max-h-40 object-contain rounded-xl border border-slate-200 bg-slate-50"
                      />
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-xs text-slate-400 italic">
                        No photo uploaded
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">
                      AI Condition Prediction
                    </p>
                    <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 font-medium">
                          Predicted:
                        </span>
                        <span className="font-bold text-slate-900">
                          {viewingAppt.aiConditionName ||
                            viewingAppt.conditionName ||
                            "Not provided"}
                        </span>
                      </div>
                      {viewingAppt.aiConfidence !== undefined && (
                        <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                          <span className="text-slate-500 font-medium">
                            Confidence:
                          </span>
                          <span className="font-bold text-slate-900">
                            {formatConfidencePercent(viewingAppt.aiConfidence)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Questionnaire Answers */}
                {viewingAppt.questionnaireAnswers &&
                  viewingAppt.questionnaireAnswers.length > 0 && (
                    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
                      <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                        <span className="text-sm font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                          <ClipboardList className="w-3.5 h-3.5 text-slate-600" />{" "}
                          Pre-screening Responses
                        </span>
                        <span className="text-[11px] font-semibold text-slate-500">
                          {viewingAppt.questionnaireAnswers.length} questions
                        </span>
                      </div>
                      <div className="p-3 space-y-2 max-h-36 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] scrollbar-none">
                        {viewingAppt.questionnaireAnswers.map((qa, idx) => (
                          <div
                            key={idx}
                            className="p-2 rounded-lg bg-slate-50/80 border border-slate-100 text-xs"
                          >
                            <p className="font-semibold text-slate-800 mb-0.5">
                              {idx + 1}. {qa.question}
                            </p>
                            <p className="text-slate-700 font-medium">
                              {qa.answer}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Post-Consultation Clinical Result Form */}
                <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <FileCheck className="w-4 h-4 text-slate-700" />
                    <p className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                      Doctor's Clinical Decision &amp; Findings
                    </p>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed -mt-1">
                    Enter your official clinical diagnosis and consultation notes
                    after conducting the examination.
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
                      disabled={viewingAppt.doctorDone || viewingAppt.checkInStatus === "no-show" || viewingAppt.status === "completed"}
                      value={clinicalDiagnosis}
                      onChange={(e) => setClinicalDiagnosis(e.target.value)}
                      placeholder="Enter final clinical diagnosis..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">
                      Prescription, Treatment Plan &amp; Consultation Notes
                    </label>
                    <textarea
                      rows={3}
                      disabled={viewingAppt.doctorDone || viewingAppt.checkInStatus === "no-show" || viewingAppt.status === "completed"}
                      value={consultationNotes}
                      onChange={(e) => setConsultationNotes(e.target.value)}
                      placeholder="Enter prescription recommendations, topical medication, lifestyle care, and follow-up advice..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-t border-slate-100 flex flex-col sm:flex-row gap-2.5 sm:gap-3 shrink-0 bg-white">
                {viewingAppt.checkInStatus === "no-show" ? (
                  <div className="flex-1 flex items-center justify-center py-2.5 sm:py-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold text-center">
                    Appointment Finalized as No-Show (Patient Did Not Attend)
                  </div>
                ) : viewingAppt.doctorDone ? (
                  <div className="flex-1 flex items-center justify-center py-2.5 sm:py-3 rounded-xl bg-green-50 border border-green-200 text-green-700 text-xs font-bold text-center">
                    Consultation Completed &amp; Result Saved
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={savingResult}
                    onClick={handleCompleteConsultation}
                    className="flex-1 inline-flex items-center justify-center py-2.5 sm:py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 text-center"
                  >
                    {savingResult ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Saving Result...
                      </>
                    ) : (
                      "Complete Consultation & Save Clinical Result"
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setViewingAppt(null)}
                  className="py-2.5 sm:py-3 px-5 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors cursor-pointer w-full sm:w-auto text-center"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
        </AnimatePresence>
      </ModalPortal>
    </div>
  );
}
