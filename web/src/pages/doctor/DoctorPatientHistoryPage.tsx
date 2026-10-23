import { useState, useMemo } from "react";
import {
  Calendar,
  User,
  X,
  FileText,
  Loader2,
  ClipboardList,
  Search,
  Maximize2,
  Phone,
  Mail,
  MapPin,
  Stethoscope,
  CheckCircle2,
  FileCheck,
  Clock,
  Building2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { skinConditions } from "@/pages/public/SkinLibrary";
import { useDoctorAppointments, type DoctorAppointmentRecord } from "@/hooks/useDoctorAppointments";
import { LazySkinPhoto } from "@/components/common/LazySkinPhoto";
import { getSignedSkinPhotoUrl } from "@/lib/storageUtils";
import { formatConfidencePercent } from "@/lib/utils";
import { ModalPortal } from "@/components/common/ModalPortal";
import { PatientAvatar } from "@/components/common/PatientAvatar";
import { useDoctorClinicContext } from "@/components/layout/doctorLayout";


type AppointmentRecord = DoctorAppointmentRecord;

function formatDate(dateStr?: string, createdAt?: string): string {
  const target = dateStr || (createdAt ? createdAt.split("T")[0] : "");
  if (!target) return "—";
  try {
    return new Date(target + "T00:00:00").toLocaleDateString("en-PH", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return target;
  }
}

function formatTime(timeStr?: string): string {
  if (!timeStr) return "—";
  try {
    const [h, m] = timeStr.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
  } catch {
    return timeStr;
  }
}

export default function DoctorPatientHistoryPage() {
  const { appointments, loading } = useDoctorAppointments();
  const { activeClinicId, affiliations } = useDoctorClinicContext();
  const [viewingAppt, setViewingAppt] = useState<AppointmentRecord | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "completed" | "approved" | "pending" | "rejected">("all");

  // Derive the currently-active clinic name for contextual messages
  const activeClinicName = useMemo(() => {
    if (!activeClinicId) return null;
    return affiliations.find((a) => a.clinic_id === activeClinicId)?.clinic?.name || "Active Branch";
  }, [activeClinicId, affiliations]);

  // Include all consultation records for the doctor / clinic
  const history = useMemo(() => {
    return appointments;
  }, [appointments]);

  const completedList = useMemo(
    () => history.filter((a) => a.status === "completed" || a.doctorDone),
    [history]
  );
  const approvedList = useMemo(
    () => history.filter((a) => a.doctorStatus === "approved" && a.status !== "completed" && !a.doctorDone),
    [history]
  );
  const pendingList = useMemo(
    () =>
      history.filter(
        (a) =>
          (a.doctorStatus === "pending-review" || !a.doctorStatus) &&
          a.status !== "completed" &&
          a.status !== "rejected" &&
          a.status !== "cancelled"
      ),
    [history]
  );
  const rejectedList = useMemo(
    () => history.filter((a) => a.doctorStatus === "rejected" || a.status === "rejected" || a.status === "cancelled"),
    [history]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let base = history;
    if (tab === "completed") base = completedList;
    else if (tab === "approved") base = approvedList;
    else if (tab === "pending") base = pendingList;
    else if (tab === "rejected") base = rejectedList;

    if (!q) return base;

    return base.filter((a) => {
      return (
        (a.patientName || "").toLowerCase().includes(q) ||
        (a.patientEmail || "").toLowerCase().includes(q) ||
        (a.doctorDiagnosis || "").toLowerCase().includes(q) ||
        (a.conditionName || "").toLowerCase().includes(q) ||
        (a.clinicName || "").toLowerCase().includes(q) ||
        (a.notes || "").toLowerCase().includes(q)
      );
    });
  }, [history, completedList, approvedList, pendingList, rejectedList, tab, search]);

  const viewCond = viewingAppt?.conditionId
    ? skinConditions.find((c) => c.id === viewingAppt.conditionId)
    : viewingAppt?.aiConditionName
    ? skinConditions.find((c) => c.name.toLowerCase() === (viewingAppt.aiConditionName || "").toLowerCase())
    : null;

  if (loading) {
    return (
      <div className="py-24 text-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-400">Loading patient history records...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6 min-w-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-display font-bold text-gray-900">Patient History</h1>
          <p className="text-base text-slate-500 mt-1">
            Review past consultations, approved clinical diagnoses, and completed visits.
          </p>
          {/* Clinic branch isolation badge */}
          {activeClinicName ? (
            <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-xs font-semibold text-blue-700">
              <Building2 className="w-3 h-3 text-blue-500 shrink-0" />
              <span>Isolated to: {activeClinicName}</span>
            </div>
          ) : null}
        </div>
        <div className="relative w-full sm:w-auto">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search patient, diagnosis..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-8 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 w-full sm:w-64 md:w-80"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards - Framed container matching Dashboard summary cards styling */}
      <div className="rounded-2xl sm:rounded-3xl border border-slate-200/80 bg-[#F8F8FA] p-3.5 sm:p-5 lg:p-6 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5 sm:gap-5">
          {/* Card 1: Total Consultations */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-[0_2px_8px_rgba(0,0,0,0.03)] overflow-hidden">
            {/* Top row */}
            <div className="px-6 py-4 flex items-center gap-3">
              <Stethoscope className="w-5.5 h-5.5 text-blue-600 stroke-[1.8] shrink-0" />
              <span className="text-base font-bold text-slate-800 tracking-tight truncate">
                Total Consultations
              </span>
            </div>

            {/* Horizontal divider line */}
            <div className="border-b border-slate-100" />

            {/* Bottom row */}
            <div className="px-6 pt-4.5 pb-5.5">
              <span className="text-3xl sm:text-[34px] font-black text-slate-900 tracking-tight leading-none block">
                {history.length}
              </span>
              <p className="text-base sm:text-[13px] text-slate-400 mt-2 font-medium tracking-tight truncate">
                All patient records
              </p>
            </div>
          </div>

          {/* Card 2: Completed Visits */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-[0_2px_8px_rgba(0,0,0,0.03)] overflow-hidden">
            {/* Top row */}
            <div className="px-6 py-4 flex items-center gap-3">
              <CheckCircle2 className="w-5.5 h-5.5 text-blue-600 stroke-[1.8] shrink-0" />
              <span className="text-base font-bold text-slate-800 tracking-tight truncate">
                Completed Visits
              </span>
            </div>

            {/* Horizontal divider line */}
            <div className="border-b border-slate-100" />

            {/* Bottom row */}
            <div className="px-6 pt-4.5 pb-5.5">
              <span className="text-3xl sm:text-[34px] font-black text-slate-900 tracking-tight leading-none block">
                {completedList.length}
              </span>
              <p className="text-base sm:text-[13px] text-slate-400 mt-2 font-medium tracking-tight truncate">
                Finished consultations
              </p>
            </div>
          </div>

          {/* Card 3: Approved & Diagnosed */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-[0_2px_8px_rgba(0,0,0,0.03)] overflow-hidden">
            {/* Top row */}
            <div className="px-6 py-4 flex items-center gap-3">
              <FileCheck className="w-5.5 h-5.5 text-blue-600 stroke-[1.8] shrink-0" />
              <span className="text-base font-bold text-slate-800 tracking-tight truncate">
                Approved &amp; Diagnosed
              </span>
            </div>

            {/* Horizontal divider line */}
            <div className="border-b border-slate-100" />

            {/* Bottom row */}
            <div className="px-6 pt-4.5 pb-5.5">
              <span className="text-3xl sm:text-[34px] font-black text-slate-900 tracking-tight leading-none block">
                {approvedList.length}
              </span>
              <p className="text-base sm:text-[13px] text-slate-400 mt-2 font-medium tracking-tight truncate">
                Confirmed diagnosis
              </p>
            </div>
          </div>

          {/* Card 4: Pending Review */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-[0_2px_8px_rgba(0,0,0,0.03)] overflow-hidden">
            {/* Top row */}
            <div className="px-6 py-4 flex items-center gap-3">
              <Clock className="w-5.5 h-5.5 text-blue-600 stroke-[1.8] shrink-0" />
              <span className="text-base font-bold text-slate-800 tracking-tight truncate">
                Pending Review
              </span>
            </div>

            {/* Horizontal divider line */}
            <div className="border-b border-slate-100" />

            {/* Bottom row */}
            <div className="px-6 pt-4.5 pb-5.5">
              <span className="text-3xl sm:text-[34px] font-black text-slate-900 tracking-tight leading-none block">
                {pendingList.length}
              </span>
              <p className="text-base sm:text-[13px] text-slate-400 mt-2 font-medium tracking-tight truncate">
                Awaiting doctor review
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 border-b border-slate-200/80 overflow-x-auto whitespace-nowrap pb-px no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {[
          { key: "all", label: "All History", count: history.length },
          { key: "completed", label: "Completed Visits", count: completedList.length },
          { key: "approved", label: "Approved & Diagnosed", count: approvedList.length },
          { key: "pending", label: "Pending Review", count: pendingList.length },
          { key: "rejected", label: "Declined", count: rejectedList.length },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as any)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              tab === t.key
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
            <span
              className={`ml-2 text-[11px] px-1.5 py-0.5 rounded-full font-bold ${
                tab === t.key ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-500"
              }`}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/90 flex flex-col items-center justify-center py-20 text-center px-6 shadow-xs">
          {activeClinicName && !search ? (
            <>
              <Building2 className="w-8 h-8 text-blue-200 mb-3" />
              <p className="text-base font-semibold text-gray-700">
                No patient records recorded for {activeClinicName} yet.
              </p>
              <p className="text-sm text-gray-400 max-w-sm mt-1">
                Only records from the selected clinic appear here. Select another clinic in the Branch Switcher to view its records.
              </p>
            </>
          ) : (
            <>
              <p className="text-base font-semibold text-gray-700">
                {search ? "No matching records found" : "No consultation history yet"}
              </p>
              {search && (
                <p className="text-sm text-gray-400 max-w-xs mt-1">
                  Try a different search term or filter tab.
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/90 overflow-hidden shadow-xs min-w-0">
          <div className="overflow-x-auto no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-[#F8F9FA] border-b border-slate-200/80 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3">Patient</th>
                  <th className="px-4 py-3">Doctor Diagnosis / Concern</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Clinic</th>
                  <th className="px-4 py-3">Schedule Date</th>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((appt, i) => {
                  const isCompleted = appt.status === "completed" || appt.doctorDone;
                  const isApproved = appt.doctorStatus === "approved" && !isCompleted;
                  const isPending =
                    (appt.doctorStatus === "pending-review" || !appt.doctorStatus) &&
                    !isCompleted &&
                    appt.status !== "rejected" &&
                    appt.status !== "cancelled";
                  const isRejected =
                    appt.doctorStatus === "rejected" || appt.status === "rejected" || appt.status === "cancelled";

                  return (
                    <motion.tr
                      key={appt.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.03 }}
                      className="hover:bg-gray-50/60 transition-colors"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <PatientAvatar
                            avatarUrl={appt.patientAvatar}
                            fullName={appt.patientName}
                            sizeClass="w-9 h-9"
                            borderClass="border border-gray-200"
                            className="shrink-0"
                          />
                          <div>
                            <p className="font-semibold text-gray-900">{appt.patientName || "Not provided"}</p>
                            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                              {appt.patientGender && (
                                <span className="text-[11px] font-semibold text-gray-600 bg-gray-100 px-1.5 py-0.2 rounded">
                                  {appt.patientGender}
                                </span>
                              )}
                              {appt.patientAge && (
                                <span className="text-sm text-gray-400">{appt.patientAge} yrs old</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {appt.doctorDiagnosis ? (
                          <div>
                            <p className="font-semibold text-gray-900 text-sm">{appt.doctorDiagnosis}</p>
                            <p className="text-[11px] text-gray-400 mt-0.5">{appt.conditionName || "Not provided"}</p>
                          </div>
                        ) : (
                          <p className="text-blue-600 font-medium text-sm">{appt.conditionName || "Not provided"}</p>
                        )}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {isCompleted ? (
                          <span className="text-sm font-semibold text-emerald-700">
                            Completed
                          </span>
                        ) : isApproved ? (
                          <span className="text-sm font-semibold text-blue-700">
                            Approved
                          </span>
                        ) : isPending ? (
                          <span className="text-sm font-semibold text-amber-700">
                            Pending Review
                          </span>
                        ) : isRejected ? (
                          <span className="text-sm font-semibold text-red-700">
                            Declined
                          </span>
                        ) : (
                          <span className="text-sm font-semibold text-gray-700">
                            Reviewed
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-gray-500 text-xs">{appt.clinicName || "—"}</td>
                      <td className="px-4 py-3.5 text-gray-700 whitespace-nowrap text-xs">
                        {formatDate(appt.date, appt.createdAt)}
                      </td>
                      <td className="px-4 py-3.5 text-gray-700 whitespace-nowrap text-xs">
                        {formatTime(appt.time)}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={() => setViewingAppt(appt)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-100 text-xs font-semibold hover:bg-blue-100 transition-colors cursor-pointer"
                        >
                          <FileText className="w-3.5 h-3.5" /> View
                        </button>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      <ModalPortal isOpen={Boolean(viewingAppt)}>
        <AnimatePresence>
          {viewingAppt && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
              onClick={() => setViewingAppt(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                transition={{ duration: 0.2 }}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh] relative z-[9999]"
                onClick={(e) => e.stopPropagation()}
              >
              {/* Header */}
              <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-gray-100 shrink-0">
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-gray-900 truncate">Consultation History Record</h2>
                  <p className="text-sm text-gray-400 mt-0.5 truncate">Patient consultation &amp; diagnosis archive</p>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  {viewingAppt.status === "completed" || viewingAppt.doctorDone ? (
                    <span className="text-sm font-semibold text-emerald-700">
                      Completed
                    </span>
                  ) : viewingAppt.doctorStatus === "approved" ? (
                    <span className="text-sm font-semibold text-blue-700">
                      Approved
                    </span>
                  ) : viewingAppt.doctorStatus === "rejected" || viewingAppt.status === "rejected" || viewingAppt.status === "cancelled" ? (
                    <span className="text-sm font-semibold text-red-700">
                      Declined
                    </span>
                  ) : (
                    <span className="text-sm font-semibold text-amber-700">
                      Pending Review
                    </span>
                  )}
                  <button
                    onClick={() => setViewingAppt(null)}
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                </div>
              </div>

              <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-4 overflow-y-auto flex-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {/* Patient Header */}
                <div className="flex items-center gap-4">
                  <PatientAvatar
                    avatarUrl={viewingAppt.patientAvatar}
                    fullName={viewingAppt.patientName}
                    sizeClass="w-14 h-14"
                    borderClass="border border-gray-200"
                    className="shrink-0"
                  />
                  <div>
                    <p className="text-lg font-bold text-gray-900">{viewingAppt.patientName || "Not provided"}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {viewingAppt.patientGender && (
                        <span className="text-[11px] font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded-full">
                          {viewingAppt.patientGender}
                        </span> 
                      )}
                      {viewingAppt.patientAge ? (
                        <span className="text-sm text-gray-400">{viewingAppt.patientAge} years old</span>
                      ) : viewingAppt.patientBirthdate ? (
                        <span className="text-sm text-gray-400">Born {viewingAppt.patientBirthdate}</span>
                      ) : null}
                      <span className="text-sm font-medium text-blue-600">
                        {viewingAppt.conditionName || "Not provided"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Doctor Diagnosis Box */}
                {viewingAppt.doctorDiagnosis && (
                  <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 space-y-1.5">
                    <p className="text-[11px] text-blue-600 font-bold uppercase tracking-wide">
                      Doctor's Final Diagnosis
                    </p>
                    <p className="text-base font-bold text-slate-900">{viewingAppt.doctorDiagnosis}</p>
                    {viewingAppt.doctorNote && (
                      <p className="text-sm text-blue-800 leading-relaxed pt-1 border-t border-blue-100/80">
                        <span className="font-semibold">Review Note:</span> {viewingAppt.doctorNote}
                      </p>
                    )}
                  </div>
                )}

                {/* AI Scan Analysis result preview if available */}
                {(viewingAppt.aiConditionName || viewCond) && (
                  <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-blue-900 uppercase tracking-wide">
                        AI Scan Pre-Screening Result
                      </span>
                      {viewingAppt.aiConfidence !== undefined && (
                        <span className="text-sm font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                          {formatConfidencePercent(viewingAppt.aiConfidence)} AI Confidence
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-bold text-slate-900">
                      {viewingAppt.aiConditionName || viewingAppt.conditionName || viewCond?.name}
                    </p>
                    {viewCond && (
                      <p className="text-sm text-blue-700 leading-relaxed">
                        {viewCond.description}
                      </p>
                    )}
                  </div>
                )}

                {/* Personal Details */}
                {(viewingAppt.patientEmail ||
                  viewingAppt.patientAddress ||
                  viewingAppt.patientContact ||
                  viewingAppt.patientGender ||
                  viewingAppt.patientBirthdate) && (
                  <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 space-y-2">
                    <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-1 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-gray-500" /> Personal Information
                    </p>
                    {viewingAppt.patientGender && (
                      <div className="flex gap-2 text-sm">
                        <span className="text-sm font-semibold text-gray-400 w-20 shrink-0 pt-0.5">Gender</span>
                        <span className="text-gray-700">{viewingAppt.patientGender}</span>
                      </div>
                    )}
                    {viewingAppt.patientBirthdate && (
                      <div className="flex gap-2 text-sm">
                        <span className="text-sm font-semibold text-gray-400 w-20 shrink-0 pt-0.5">Birthdate</span>
                        <span className="text-gray-700">
                          {viewingAppt.patientBirthdate}
                          {viewingAppt.patientAge ? ` (${viewingAppt.patientAge} yrs old)` : ""}
                        </span>
                      </div>
                    )}
                    {viewingAppt.patientEmail && (
                      <div className="flex gap-2 text-sm">
                        <span className="text-sm font-semibold text-gray-400 w-20 shrink-0 pt-0.5 flex items-center gap-1">
                          <Mail className="w-3 h-3" /> Email
                        </span>
                        <span className="text-gray-700">{viewingAppt.patientEmail}</span>
                      </div>
                    )}
                    {viewingAppt.patientContact && (
                      <div className="flex gap-2 text-sm">
                        <span className="text-sm font-semibold text-gray-400 w-20 shrink-0 pt-0.5 flex items-center gap-1">
                          <Phone className="w-3 h-3" /> Contact
                        </span>
                        <span className="text-gray-700">{viewingAppt.patientContact}</span>
                      </div>
                    )}
                    {viewingAppt.patientAddress && (
                      <div className="flex gap-2 text-sm">
                        <span className="text-sm font-semibold text-gray-400 w-20 shrink-0 pt-0.5 flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> Address
                        </span>
                        <span className="text-gray-700">{viewingAppt.patientAddress}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Uploaded Skin Photo */}
                {viewingAppt.skinPhotoUrl && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide">
                        Uploaded Skin Photo
                      </p>
                      <button
                        onClick={async () => {
                          const url = await getSignedSkinPhotoUrl(viewingAppt.skinPhotoUrl);
                          if (url) setLightboxPhoto(url);
                        }}
                        className="text-[11px] text-blue-600 font-semibold hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Maximize2 className="w-3 h-3" /> Enlarge
                      </button>
                    </div>
                    <LazySkinPhoto
                      pathOrUrl={viewingAppt.skinPhotoUrl}
                      alt="Patient Skin"
                      onClick={async () => {
                        const url = await getSignedSkinPhotoUrl(viewingAppt.skinPhotoUrl);
                        if (url) setLightboxPhoto(url);
                      }}
                      className="w-full max-h-48 object-contain rounded-xl border border-gray-200 bg-gray-50 cursor-pointer hover:opacity-95 transition-opacity"
                    />
                  </div>
                )}

                {/* Questionnaire Section */}
                {viewingAppt.questionnaireAnswers && viewingAppt.questionnaireAnswers.length > 0 && (
                  <div className="rounded-xl border border-pink-200 overflow-hidden bg-white">
                    <div className="px-4 py-2.5 bg-pink-50 border-b border-pink-100 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <ClipboardList className="w-4 h-4 text-[#c0166a]" />
                        <span className="text-xs font-bold text-pink-900 uppercase tracking-wide">
                          Patient Questionnaire
                        </span>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-pink-200 text-pink-800">
                        {viewingAppt.questionnaireAnswers.length} responses
                      </span>
                    </div>
                    <div className="p-3.5 space-y-2 max-h-48 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                      {viewingAppt.questionnaireAnswers.map((qa, idx) => (
                        <div key={idx} className="p-2 rounded-lg bg-gray-50 border border-gray-100 text-xs">
                          <p className="font-semibold text-gray-800 mb-0.5">
                            {idx + 1}. {qa.question}
                          </p>
                          <p className="text-[#c0166a] font-medium">{qa.answer}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Schedule */}
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" /> Appointment Schedule
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 text-center">
                      <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-1">Date</p>
                      <p className="text-sm font-bold text-gray-800">
                        {formatDate(viewingAppt.date, viewingAppt.createdAt)}
                      </p>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 text-center">
                      <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-1">Time</p>
                      <p className="text-xl font-bold text-gray-800">{formatTime(viewingAppt.time)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <User className="w-3.5 h-3.5 shrink-0" />
                    <span className="font-medium">{viewingAppt.clinicName}</span>
                  </div>
                </div>

                {/* Notes */}
                {viewingAppt.notes && (
                  <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                    <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-1">
                      Patient Symptoms &amp; Notes
                    </p>
                    <p className="text-sm text-gray-700 italic">"{viewingAppt.notes}"</p>
                  </div>
                )}
              </div>

              <div className="px-6 py-4 border-t border-gray-100">
                <button
                  onClick={() => setViewingAppt(null)}
                  className="w-full py-2.5 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        </AnimatePresence>
      </ModalPortal>

      {/* Lightbox Modal */}
      <ModalPortal isOpen={Boolean(lightboxPhoto)}>
        <AnimatePresence>
          {lightboxPhoto && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[9998] bg-black/85 flex items-center justify-center p-4 backdrop-blur-md"
              onClick={() => setLightboxPhoto(null)}
            >
              <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center z-[9999]">
                <button
                  onClick={() => setLightboxPhoto(null)}
                  className="absolute -top-10 right-0 text-white hover:text-gray-300 p-1 cursor-pointer"
                >
                  <X className="w-6 h-6" />
                </button>
                <img
                  src={lightboxPhoto}
                  alt="Skin Photo Full Size"
                  className="max-h-[85vh] max-w-full object-contain rounded-xl border border-white/20 shadow-2xl"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </ModalPortal>
    </div>
  );
}
