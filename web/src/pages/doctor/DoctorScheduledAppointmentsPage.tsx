import { useMemo, useState, useCallback } from "react";
import { Calendar, User, Stethoscope, ScanSearch, X, CheckCircle2, Loader2, ClipboardList } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { skinConditions } from "@/pages/public/SkinLibrary";
import { useDoctorAppointments, type DoctorAppointmentRecord } from "@/hooks/useDoctorAppointments";

type AppointmentRecord = DoctorAppointmentRecord;

function formatDate(dateStr: string): string {
  if (!dateStr)
    return "—";
  try {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-PH", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
  catch {
    return dateStr;
  }
}
function formatTime(timeStr: string): string {
  if (!timeStr)
    return "—";
  try {
    const [h, m] = timeStr.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
  }
  catch {
    return timeStr;
  }
}
export default function DoctorScheduledAppointmentsPage() {
  const { doctorName: _doctorName, appointments, loading, markAppointmentDone } = useDoctorAppointments();
  const [viewingAppt, setViewingAppt] = useState<AppointmentRecord | null>(null);

  const markAsDone = useCallback(async (id: string) => {
    try {
      await markAppointmentDone(id);
      setViewingAppt((prev) => prev?.id === id ? { ...prev, doctorDone: true, status: "completed" } : prev);
    } catch {
      /* ignore */
    }
  }, [markAppointmentDone]);

  const scheduled = useMemo<AppointmentRecord[]>(() => {
    return appointments
      .filter(
        (a) =>
          a.status !== "rejected" &&
          a.status !== "cancelled" &&
          a.status !== "completed" &&
          (a.status === "confirmed" || a.status === "scheduled" || a.scheduleSentToDoctor)
      )
      .sort((a, b) => (a.date > b.date ? 1 : -1));
  }, [appointments]);
  const viewCond = viewingAppt?.conditionId
    ? skinConditions.find((c) => c.id === viewingAppt.conditionId)
    : null;

  if (loading) {
    return (
      <div className="py-24 text-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-400">Loading assigned appointments...</p>
      </div>
    );
  }
  return (<div className="space-y-6">
    {/* Header */}
    <div>
      <h1 className="text-2xl font-display font-bold text-gray-900">Assigned Appointments</h1>
      <p className="text-sm text-gray-500 mt-1">
        Finalized schedules confirmed by the clinic — ready for your consultation.
      </p>
    </div>

    {scheduled.length === 0 ? (<div className="bg-white rounded-2xl border border-gray-100 flex flex-col items-center justify-center py-20 text-center px-6">
      <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mb-4">
        <Calendar className="w-7 h-7 text-blue-400" />
      </div>
      <p className="text-base font-semibold text-gray-700 mb-1">No assigned appointments yet</p>
      <p className="text-sm text-gray-400 max-w-xs">
        The clinic will send you finalized appointment schedules after your review is complete.
      </p>
    </div>) : (<div className="space-y-4">
      {scheduled.map((appt, i) => (<motion.div key={appt.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {/* Card row */}
        <div className="flex items-center gap-4 px-5 py-4">
          <img src={appt.patientAvatar ||
            `https://ui-avatars.com/api/?name=${encodeURIComponent(appt.patientName || "P")}&background=dbeafe&color=1d4ed8`} alt={appt.patientName} className="w-12 h-12 rounded-full object-cover border border-gray-200 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900 truncate">
              {appt.patientName || "Patient"}
            </p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {appt.patientGender && (
                <span className="text-[10px] font-semibold text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
                  {appt.patientGender}
                </span>
              )}
              {appt.patientAge && (<p className="text-xs text-gray-400">{appt.patientAge} years old</p>)}
            </div>
            <p className="text-xs text-blue-600 font-medium mt-0.5">
              {appt.conditionName || "Skin concern"}
            </p>
          </div>
          {appt.doctorDone && (<span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-50 border border-green-200 text-green-700 text-xs font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5" /> Done
          </span>)}
          <button onClick={() => setViewingAppt(appt)} className="shrink-0 px-4 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold transition-colors">
            View Details
          </button>
        </div>
      </motion.div>))}
    </div>)}

    {/* Detail Modal */}
    <AnimatePresence>
      {viewingAppt && (<div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4" onClick={() => setViewingAppt(null)}>
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.2 }} className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-500" />
              <h3 className="font-bold text-gray-900 text-base">Appointment Details</h3>
            </div>
            <button onClick={() => setViewingAppt(null)} className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1 p-6 space-y-4">
            {/* Patient Header */}
            <div className="flex items-center gap-3">
              <img src={viewingAppt.patientAvatar ||
                `https://ui-avatars.com/api/?name=${encodeURIComponent(viewingAppt.patientName || "P")}&background=dbeafe&color=1d4ed8`} alt={viewingAppt.patientName} className="w-12 h-12 rounded-full object-cover border border-gray-200 shrink-0" />
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
                </div>
                <p className="text-sm text-blue-600 font-medium">{viewingAppt.conditionName || "Skin concern"}</p>
              </div>
            </div>

            {/* Personal details */}
            {(viewingAppt.patientEmail || viewingAppt.patientAddress || viewingAppt.patientContact || viewingAppt.patientGender || viewingAppt.patientBirthdate) && (<div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 space-y-2">
              <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">Personal Information</p>
              {[
                { label: "Gender", value: viewingAppt.patientGender },
                { label: "Birthdate", value: viewingAppt.patientBirthdate ? `${viewingAppt.patientBirthdate}${viewingAppt.patientAge ? ` (${viewingAppt.patientAge} yrs old)` : ''}` : undefined },
                { label: "Email", value: viewingAppt.patientEmail },
                { label: "Address", value: viewingAppt.patientAddress },
                { label: "Contact", value: viewingAppt.patientContact },
              ].map(({ label, value }) => value ? (<div key={label} className="flex gap-2 text-sm">
                <span className="text-xs font-semibold text-gray-400 w-20 shrink-0 pt-0.5">{label}</span>
                <span className="text-gray-700">{value}</span>
              </div>) : null)}
            </div>)}

            {/* Questionnaire Section */}
            {viewingAppt.questionnaireAnswers && viewingAppt.questionnaireAnswers.length > 0 && (
              <div className="rounded-xl border border-magenta-200 overflow-hidden bg-white">
                <div className="px-4 py-2.5 bg-magenta-50 border-b border-magenta-100 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <ClipboardList className="w-4 h-4 text-magenta-600" />
                    <span className="text-xs font-bold text-magenta-900 uppercase tracking-wide">
                      Patient Questionnaire
                    </span>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-magenta-200 text-magenta-800">
                    {viewingAppt.questionnaireAnswers.length} responses
                  </span>
                </div>
                <div className="p-3.5 space-y-2 max-h-48 overflow-y-auto">
                  {viewingAppt.questionnaireAnswers.map((qa, idx) => (
                    <div key={idx} className="p-2 rounded-lg bg-gray-50 border border-gray-100 text-xs">
                      <p className="font-semibold text-gray-800 mb-0.5">
                        {idx + 1}. {qa.question}
                      </p>
                      <p className="text-magenta-700 font-medium">
                        {qa.answer}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Confirmed Schedule */}
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 space-y-3">
              <p className="text-xs font-bold text-blue-700 uppercase tracking-wide flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" /> Confirmed Schedule
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white rounded-xl border border-blue-100 px-4 py-3 text-center">
                  <p className="text-[10px] text-blue-400 font-semibold uppercase tracking-wide mb-1">Date</p>
                  <p className="text-sm font-bold text-blue-900">{formatDate(viewingAppt.date)}</p>
                </div>
                <div className="bg-white rounded-xl border border-blue-100 px-4 py-3 text-center">
                  <p className="text-[10px] text-blue-400 font-semibold uppercase tracking-wide mb-1">Time</p>
                  <p className="text-xl font-bold text-blue-900">{formatTime(viewingAppt.time)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-blue-600">
                <User className="w-3.5 h-3.5 shrink-0" />
                <span className="font-medium">{viewingAppt.clinicName}</span>
              </div>
            </div>

            {/* Uploaded Skin Photo */}
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5 mb-2">
                <Stethoscope className="w-3.5 h-3.5" /> Uploaded Skin Photo
              </p>
              {viewingAppt.skinPhotoUrl ? (<img src={viewingAppt.skinPhotoUrl} alt="Patient skin photo" className="w-full max-h-52 object-contain rounded-xl border border-gray-200 bg-gray-50" />) : (<div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-4 text-center text-xs text-gray-400 italic">
                No skin photo uploaded.
              </div>)}
            </div>

            {/* AI Analysis */}
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5 mb-3">
                <ScanSearch className="w-3.5 h-3.5" /> AI Analysis Result
              </p>
              {/* Patient-submitted AI data */}
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 space-y-2 mb-3">
                <p className="text-[11px] font-bold text-blue-700 uppercase tracking-wide">Patient-Submitted Result</p>
                <div className="flex gap-2 items-center">
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide w-24 shrink-0">Condition</span>
                  <span className="text-sm font-semibold text-blue-800">
                    {viewingAppt.aiConditionName || viewingAppt.conditionName || <span className="text-gray-300 italic">—</span>}
                  </span>
                </div>
                <div className="flex gap-2 items-center">
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide w-24 shrink-0">Confidence</span>
                  {viewingAppt.aiConfidence !== undefined ? (<div className="flex items-center gap-2 flex-1">
                    <div className="flex-1 bg-blue-200 rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-blue-600" style={{ width: `${Math.min(viewingAppt.aiConfidence, 100)}%` }} />
                    </div>
                    <span className="text-xs font-bold text-blue-700">{viewingAppt.aiConfidence}%</span>
                  </div>) : (<span className="text-sm text-gray-300 italic">—</span>)}
                </div>
              </div>
              {viewCond && (<div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-4 flex gap-4">
                <img src={viewingAppt.conditionImage || viewCond.image} alt={viewCond.name} className="w-24 h-24 rounded-xl object-cover border border-blue-100 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-blue-800 mb-1">{viewCond.name}</p>
                  <p className="text-xs text-blue-600 leading-relaxed">{viewCond.description}</p>
                </div>
              </div>)}
            </div>

            {/* Patient notes */}
            {viewingAppt.notes && (<div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">Patient Notes</p>
              <p className="text-sm text-gray-700 italic">"{viewingAppt.notes}"</p>
            </div>)}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
            {viewingAppt.doctorDone ? (<div className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-green-50 border border-green-200 text-green-700 text-sm font-semibold">
              <CheckCircle2 className="w-4 h-4" /> Consultation Done
            </div>) : (<button onClick={() => markAsDone(viewingAppt.id)} className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-colors">
              <CheckCircle2 className="w-4 h-4" /> Mark as Done
            </button>)}
            <button onClick={() => setViewingAppt(null)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 transition-colors">
              Close
            </button>
          </div>
        </motion.div>
      </div>)}
    </AnimatePresence>
  </div>);
}
