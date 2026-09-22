import { useMemo, useState } from "react";
import { Calendar, Stethoscope, X, CheckCircle2, Loader2, ClipboardList, FileCheck } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useDoctorAppointments, type DoctorAppointmentRecord } from "@/hooks/useDoctorAppointments";

type AppointmentRecord = DoctorAppointmentRecord;

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-PH", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatTime(timeStr: string): string {
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

export default function DoctorScheduledAppointmentsPage() {
  const { doctorName: _doctorName, appointments, loading, markAppointmentDone } = useDoctorAppointments();
  const [tab, setTab] = useState<"upcoming" | "completed">("upcoming");
  const [viewingAppt, setViewingAppt] = useState<AppointmentRecord | null>(null);
  const [clinicalDiagnosis, setClinicalDiagnosis] = useState("");
  const [consultationNotes, setConsultationNotes] = useState("");
  const [savingResult, setSavingResult] = useState(false);
  const [saveError, setSaveError] = useState("");

  const openApptModal = (appt: AppointmentRecord) => {
    setViewingAppt(appt);
    setClinicalDiagnosis(appt.doctorDiagnosis || appt.aiConditionName || (appt.conditionName !== "General Consultation" ? appt.conditionName || "" : ""));
    setConsultationNotes(appt.doctorNote || "");
    setSaveError("");
  };

  const handleCompleteConsultation = async () => {
    if (!viewingAppt) return;
    if (!clinicalDiagnosis.trim()) {
      setSaveError("Please enter your final clinical diagnosis before completing.");
      return;
    }

    setSavingResult(true);
    setSaveError("");
    try {
      await markAppointmentDone(viewingAppt.id, clinicalDiagnosis.trim(), consultationNotes.trim());
      setViewingAppt((prev) =>
        prev
          ? {
              ...prev,
              doctorDone: true,
              status: "completed",
              doctorDiagnosis: clinicalDiagnosis.trim(),
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

  const scheduled = useMemo<AppointmentRecord[]>(() => {
    return appointments
      .filter(
        (a) =>
          a.status !== "rejected" &&
          a.status !== "cancelled" &&
          a.status !== "completed" &&
          a.doctorStatus !== "rejected" &&
          !a.doctorDone &&
          !!a.date &&
          (a.status === "confirmed" || a.status === "scheduled" || a.scheduleSentToDoctor)
      )
      .sort((a, b) => (a.date > b.date ? 1 : -1));
  }, [appointments]);

  const completed = useMemo<AppointmentRecord[]>(() => {
    return appointments
      .filter((a) => a.status === "completed" || a.doctorDone)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [appointments]);

  const displayList = tab === "upcoming" ? scheduled : completed;

  if (loading) {
    return (
      <div className="py-24 text-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-400">Loading assigned appointments...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-display font-bold text-gray-900">Assigned Appointments</h1>
        <p className="text-sm text-gray-500 mt-1">
          Finalized schedules confirmed by the clinic — conduct consultation and record clinical results.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-100">
        <button
          onClick={() => setTab("upcoming")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
            tab === "upcoming"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Upcoming Schedules
          <span
            className={`ml-2 text-[11px] px-1.5 py-0.5 rounded-full font-bold ${
              tab === "upcoming" ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-500"
            }`}
          >
            {scheduled.length}
          </span>
        </button>
        <button
          onClick={() => setTab("completed")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
            tab === "completed"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Completed Consultations
          <span
            className={`ml-2 text-[11px] px-1.5 py-0.5 rounded-full font-bold ${
              tab === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
            }`}
          >
            {completed.length}
          </span>
        </button>
      </div>

      {displayList.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 flex flex-col items-center justify-center py-20 text-center px-6">
          <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mb-4">
            <Calendar className="w-7 h-7 text-blue-400" />
          </div>
          <p className="text-base font-semibold text-gray-700 mb-1">
            {tab === "upcoming" ? "No upcoming assigned appointments" : "No completed consultations yet"}
          </p>
          <p className="text-sm text-gray-400 max-w-xs">
            {tab === "upcoming"
              ? "The clinic will send you finalized appointment schedules after your pre-consultation review is complete."
              : "Completed patient consultations and clinical diagnoses will appear here."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {displayList.map((appt, i) => (
            <motion.div
              key={appt.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="bg-white rounded-2xl border border-gray-100 overflow-hidden"
            >
              {/* Card row */}
              <div className="flex items-center gap-4 px-5 py-4 flex-wrap sm:flex-nowrap">
                <img
                  src={
                    appt.patientAvatar ||
                    `https://ui-avatars.com/api/?name=${encodeURIComponent(
                      appt.patientName || "P"
                    )}&background=dbeafe&color=1d4ed8`
                  }
                  alt={appt.patientName}
                  className="w-12 h-12 rounded-full object-cover border border-gray-200 shrink-0"
                />
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
                    {appt.patientAge && (
                      <p className="text-xs text-gray-400">{appt.patientAge} years old</p>
                    )}
                  </div>
                  <p className="text-xs text-blue-600 font-medium mt-0.5">
                    {appt.doctorDiagnosis ? (
                      <span><strong>Diagnosed:</strong> {appt.doctorDiagnosis}</span>
                    ) : (
                      appt.conditionName || "Skin concern"
                    )}
                  </p>
                  {appt.doctorNote && (
                    <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-1">
                      <span className="font-semibold text-gray-700">Note:</span> {appt.doctorNote}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right hidden sm:block">
                  <p className="text-xs font-bold text-gray-900">{formatDate(appt.date)}</p>
                  <p className="text-xs font-semibold text-blue-600">{formatTime(appt.time)}</p>
                </div>
                {appt.status === "completed" || appt.doctorDone ? (
                  <button
                    onClick={() => openApptModal(appt)}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Completed (View)
                  </button>
                ) : (
                  <button
                    onClick={() => openApptModal(appt)}
                    className="shrink-0 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Conduct Consultation
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Detail & Consultation Completion Modal */}
      <AnimatePresence>
        {viewingAppt && (
          <div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4"
            onClick={() => setViewingAppt(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <Stethoscope className="w-5 h-5 text-blue-600" />
                  <div>
                    <h3 className="font-bold text-gray-900 text-base">Consultation &amp; Clinical Result</h3>
                    <p className="text-xs text-gray-400">Scheduled Visit for {formatDate(viewingAppt.date)} at {formatTime(viewingAppt.time)}</p>
                  </div>
                </div>
                <button
                  onClick={() => setViewingAppt(null)}
                  className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body */}
              <div className="overflow-y-auto flex-1 p-6 space-y-4">
                {/* Patient Header */}
                <div className="flex items-center gap-3">
                  <img
                    src={
                      viewingAppt.patientAvatar ||
                      `https://ui-avatars.com/api/?name=${encodeURIComponent(
                        viewingAppt.patientName || "P"
                      )}&background=dbeafe&color=1d4ed8`
                    }
                    alt={viewingAppt.patientName}
                    className="w-12 h-12 rounded-full object-cover border border-gray-200 shrink-0"
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
                    </div>
                  </div>
                </div>

                {/* Confirmed Schedule Banner */}
                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3.5 space-y-2">
                  <p className="text-xs font-bold text-blue-800 uppercase tracking-wide flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-blue-600" /> Confirmed Schedule
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-white rounded-xl border border-blue-100 p-2.5">
                      <span className="text-[10px] text-gray-400 font-semibold block uppercase">Date</span>
                      <span className="font-bold text-gray-900">{formatDate(viewingAppt.date)}</span>
                    </div>
                    <div className="bg-white rounded-xl border border-blue-100 p-2.5">
                      <span className="text-[10px] text-gray-400 font-semibold block uppercase">Time</span>
                      <span className="font-bold text-blue-700">{formatTime(viewingAppt.time)}</span>
                    </div>
                  </div>
                </div>

                {/* Uploaded Skin Photo & AI Result */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">
                      Uploaded Skin Photo
                    </p>
                    {viewingAppt.skinPhotoUrl ? (
                      <img
                        src={viewingAppt.skinPhotoUrl}
                        alt="Skin photo"
                        className="w-full max-h-40 object-contain rounded-xl border border-gray-200 bg-gray-50"
                      />
                    ) : (
                      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-xs text-gray-400 italic">
                        No photo uploaded
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">
                      AI Condition Prediction
                    </p>
                    <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-xs space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 font-medium">Predicted:</span>
                        <span className="font-bold text-blue-900">
                          {viewingAppt.aiConditionName || viewingAppt.conditionName || "General Concern"}
                        </span>
                      </div>
                      {viewingAppt.aiConfidence !== undefined && (
                        <div className="flex items-center justify-between pt-1 border-t border-blue-200/60">
                          <span className="text-gray-500 font-medium">Confidence:</span>
                          <span className="font-bold text-blue-700">{viewingAppt.aiConfidence}%</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Questionnaire Answers */}
                {viewingAppt.questionnaireAnswers && viewingAppt.questionnaireAnswers.length > 0 && (
                  <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
                    <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-800 uppercase tracking-wide flex items-center gap-1.5">
                        <ClipboardList className="w-3.5 h-3.5 text-gray-600" /> Pre-screening Responses
                      </span>
                      <span className="text-[10px] font-semibold text-gray-500">
                        {viewingAppt.questionnaireAnswers.length} questions
                      </span>
                    </div>
                    <div className="p-3 space-y-2 max-h-36 overflow-y-auto">
                      {viewingAppt.questionnaireAnswers.map((qa, idx) => (
                        <div key={idx} className="p-2 rounded-lg bg-gray-50/80 border border-gray-100 text-xs">
                          <p className="font-semibold text-gray-800 mb-0.5">{idx + 1}. {qa.question}</p>
                          <p className="text-magenta-700 font-medium">{qa.answer}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Post-Consultation Clinical Result Form ── */}
                <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <FileCheck className="w-4 h-4 text-emerald-700" />
                    <p className="text-xs font-bold text-emerald-950 uppercase tracking-wider">
                      Doctor's Clinical Decision &amp; Findings
                    </p>
                  </div>
                  <p className="text-[11px] text-emerald-800 leading-relaxed -mt-1">
                    Enter your official clinical diagnosis and consultation notes after conducting the in-person examination.
                  </p>

                  {saveError && (
                    <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-600 font-medium">
                      {saveError}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      Final Clinical Diagnosis <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      disabled={viewingAppt.doctorDone}
                      value={clinicalDiagnosis}
                      onChange={(e) => setClinicalDiagnosis(e.target.value)}
                      placeholder="e.g. Melasma, Acne Vulgaris, Atopic Dermatitis, Contact Dermatitis..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 disabled:bg-gray-100 disabled:text-gray-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      Prescription, Treatment Plan &amp; Consultation Notes
                    </label>
                    <textarea
                      rows={3}
                      disabled={viewingAppt.doctorDone}
                      value={consultationNotes}
                      onChange={(e) => setConsultationNotes(e.target.value)}
                      placeholder="Enter prescription recommendations, topical medication, lifestyle care, and follow-up advice..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 resize-none disabled:bg-gray-100 disabled:text-gray-500"
                    />
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
                {viewingAppt.doctorDone ? (
                  <div className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-green-50 border border-green-200 text-green-700 text-xs font-bold">
                    <CheckCircle2 className="w-4 h-4" /> Consultation Completed &amp; Result Saved
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={savingResult}
                    onClick={handleCompleteConsultation}
                    className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {savingResult ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" /> Saving Result...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" /> Complete Consultation &amp; Save Clinical Result
                      </>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setViewingAppt(null)}
                  className="py-3 px-5 rounded-xl border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
