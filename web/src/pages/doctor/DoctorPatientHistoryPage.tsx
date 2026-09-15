import { useState, useMemo } from "react";
import {
  CheckCircle2,
  Calendar,
  User,
  X,
  FileText,
  Loader2,
  ClipboardList,
  Search,
  Clock,
  XCircle,
  Users,
  Maximize2,
  Sparkles,
  Phone,
  Mail,
  MapPin,
  ScanSearch,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { skinConditions } from "@/pages/public/SkinLibrary";
import { useDoctorAppointments, type DoctorAppointmentRecord } from "@/hooks/useDoctorAppointments";

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
  const [viewingAppt, setViewingAppt] = useState<AppointmentRecord | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "completed" | "approved" | "pending" | "rejected">("all");

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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Patient History</h1>
          <p className="text-sm text-gray-500 mt-1">
            Review past consultations, approved clinical diagnoses, and completed visits.
          </p>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search patient, diagnosis..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 w-64 md:w-80"
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

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-xs flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xl font-bold text-gray-900">{history.length}</p>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Total Consultations</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-xs flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xl font-bold text-emerald-600">{completedList.length}</p>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Completed Visits</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-xs flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xl font-bold text-indigo-600">{approvedList.length}</p>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Approved &amp; Diagnosed</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-xs flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xl font-bold text-amber-600">{pendingList.length}</p>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Pending Review</p>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 border-b border-gray-100 overflow-x-auto pb-px">
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
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
              tab === t.key
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
            <span
              className={`ml-2 text-[11px] px-1.5 py-0.5 rounded-full font-bold ${
                tab === t.key ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-500"
              }`}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 flex flex-col items-center justify-center py-20 text-center px-6">
          <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mb-4">
            <CheckCircle2 className="w-7 h-7 text-blue-400" />
          </div>
          <p className="text-base font-semibold text-gray-700 mb-1">
            {search ? "No matching records found" : "No consultation history yet"}
          </p>
          <p className="text-sm text-gray-400 max-w-xs">
            {search
              ? "Try a different search term or filter tab."
              : "Patients will appear here automatically when appointments or consultations are booked."}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50/70 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
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
              <tbody className="divide-y divide-gray-50">
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
                          <img
                            src={
                              appt.patientAvatar ||
                              `https://ui-avatars.com/api/?name=${encodeURIComponent(
                                appt.patientName || "P"
                              )}&background=dbeafe&color=1d4ed8`
                            }
                            alt={appt.patientName}
                            className="w-9 h-9 rounded-full object-cover border border-gray-200 shrink-0"
                          />
                          <div>
                            <p className="font-semibold text-gray-900">{appt.patientName || "Patient"}</p>
                            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                              {appt.patientGender && (
                                <span className="text-[10px] font-semibold text-gray-600 bg-gray-100 px-1.5 py-0.2 rounded">
                                  {appt.patientGender}
                                </span>
                              )}
                              {appt.patientAge && (
                                <span className="text-xs text-gray-400">{appt.patientAge} yrs old</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {appt.doctorDiagnosis ? (
                          <div>
                            <p className="font-semibold text-gray-900 text-sm">{appt.doctorDiagnosis}</p>
                            <p className="text-[11px] text-gray-400 mt-0.5">{appt.conditionName || "Consultation"}</p>
                          </div>
                        ) : (
                          <p className="text-blue-600 font-medium text-sm">{appt.conditionName || "General Consultation"}</p>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        {isCompleted ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Completed
                          </span>
                        ) : isApproved ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-xs font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Approved
                          </span>
                        ) : isPending ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold">
                            <Clock className="w-3.5 h-3.5" /> Pending Review
                          </span>
                        ) : isRejected ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 text-xs font-semibold">
                            <XCircle className="w-3.5 h-3.5" /> Declined
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gray-50 text-gray-600 border border-gray-200 text-xs font-semibold">
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
      <AnimatePresence>
        {viewingAppt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={() => setViewingAppt(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
                <div>
                  <h2 className="text-base font-bold text-gray-900">Consultation History Record</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Patient consultation &amp; diagnosis archive</p>
                </div>
                <div className="flex items-center gap-2">
                  {viewingAppt.status === "completed" || viewingAppt.doctorDone ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Completed
                    </span>
                  ) : viewingAppt.doctorStatus === "approved" ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Approved
                    </span>
                  ) : viewingAppt.doctorStatus === "rejected" || viewingAppt.status === "rejected" || viewingAppt.status === "cancelled" ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
                      <XCircle className="w-3.5 h-3.5" /> Declined
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold">
                      <Clock className="w-3.5 h-3.5" /> Pending Review
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

              <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
                {/* Patient Header */}
                <div className="flex items-center gap-4">
                  <img
                    src={
                      viewingAppt.patientAvatar ||
                      `https://ui-avatars.com/api/?name=${encodeURIComponent(
                        viewingAppt.patientName || "P"
                      )}&background=dbeafe&color=1d4ed8`
                    }
                    alt={viewingAppt.patientName}
                    className="w-14 h-14 rounded-full object-cover border border-gray-200 shrink-0"
                  />
                  <div>
                    <p className="text-lg font-bold text-gray-900">{viewingAppt.patientName || "Patient"}</p>
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
                      <span className="text-xs font-medium text-blue-600">
                        {viewingAppt.conditionName || "General Consultation"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Doctor Diagnosis Box */}
                {viewingAppt.doctorDiagnosis && (
                  <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 space-y-1.5">
                    <p className="text-[10px] text-blue-600 font-bold uppercase tracking-wide flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> Doctor's Final Diagnosis
                    </p>
                    <p className="text-base font-bold text-blue-950">{viewingAppt.doctorDiagnosis}</p>
                    {viewingAppt.doctorNote && (
                      <p className="text-xs text-blue-800 leading-relaxed pt-1 border-t border-blue-100/80">
                        <span className="font-semibold">Review Note:</span> {viewingAppt.doctorNote}
                      </p>
                    )}
                  </div>
                )}

                {/* AI Scan Analysis result preview if available */}
                {(viewingAppt.aiConditionName || viewCond) && (
                  <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <ScanSearch className="w-4 h-4 text-blue-600" />
                        <span className="text-xs font-bold text-blue-900 uppercase tracking-wide">
                          AI Scan Pre-Screening Result
                        </span>
                      </div>
                      {viewingAppt.aiConfidence !== undefined && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-200 text-blue-800">
                          {viewingAppt.aiConfidence}% AI Confidence
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-bold text-blue-950">
                      {viewingAppt.aiConditionName || viewingAppt.conditionName || viewCond?.name}
                    </p>
                    {viewCond && (
                      <p className="text-xs text-blue-700 leading-relaxed">
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
                    <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-gray-500" /> Personal Information
                    </p>
                    {viewingAppt.patientGender && (
                      <div className="flex gap-2 text-sm">
                        <span className="text-xs font-semibold text-gray-400 w-20 shrink-0 pt-0.5">Gender</span>
                        <span className="text-gray-700">{viewingAppt.patientGender}</span>
                      </div>
                    )}
                    {viewingAppt.patientBirthdate && (
                      <div className="flex gap-2 text-sm">
                        <span className="text-xs font-semibold text-gray-400 w-20 shrink-0 pt-0.5">Birthdate</span>
                        <span className="text-gray-700">
                          {viewingAppt.patientBirthdate}
                          {viewingAppt.patientAge ? ` (${viewingAppt.patientAge} yrs old)` : ""}
                        </span>
                      </div>
                    )}
                    {viewingAppt.patientEmail && (
                      <div className="flex gap-2 text-sm">
                        <span className="text-xs font-semibold text-gray-400 w-20 shrink-0 pt-0.5 flex items-center gap-1">
                          <Mail className="w-3 h-3" /> Email
                        </span>
                        <span className="text-gray-700">{viewingAppt.patientEmail}</span>
                      </div>
                    )}
                    {viewingAppt.patientContact && (
                      <div className="flex gap-2 text-sm">
                        <span className="text-xs font-semibold text-gray-400 w-20 shrink-0 pt-0.5 flex items-center gap-1">
                          <Phone className="w-3 h-3" /> Contact
                        </span>
                        <span className="text-gray-700">{viewingAppt.patientContact}</span>
                      </div>
                    )}
                    {viewingAppt.patientAddress && (
                      <div className="flex gap-2 text-sm">
                        <span className="text-xs font-semibold text-gray-400 w-20 shrink-0 pt-0.5 flex items-center gap-1">
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
                      <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">
                        Uploaded Skin Photo
                      </p>
                      <button
                        onClick={() => setLightboxPhoto(viewingAppt.skinPhotoUrl!)}
                        className="text-[11px] text-blue-600 font-semibold hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Maximize2 className="w-3 h-3" /> Enlarge
                      </button>
                    </div>
                    <img
                      src={viewingAppt.skinPhotoUrl}
                      alt="Patient Skin"
                      onClick={() => setLightboxPhoto(viewingAppt.skinPhotoUrl!)}
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
                    <div className="p-3.5 space-y-2 max-h-48 overflow-y-auto">
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
                      <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">Date</p>
                      <p className="text-sm font-bold text-gray-800">
                        {formatDate(viewingAppt.date, viewingAppt.createdAt)}
                      </p>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 text-center">
                      <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">Time</p>
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
                    <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">
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

      {/* Lightbox Modal */}
      <AnimatePresence>
        {lightboxPhoto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-60 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm"
            onClick={() => setLightboxPhoto(null)}
          >
            <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center">
              <button
                onClick={() => setLightboxPhoto(null)}
                className="absolute -top-10 right-0 text-white hover:text-gray-300 p-1 cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>
              <img
                src={lightboxPhoto}
                alt="Skin Photo Full Size"
                className="max-h-[85vh] max-w-full object-contain rounded-xl border border-white/20"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
