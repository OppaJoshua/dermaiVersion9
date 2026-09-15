import { useState, useMemo } from "react";
import { CheckCircle2, XCircle, Clock, ScanSearch, ChevronDown, ChevronUp, AlertTriangle, Calendar, User, FileText, Loader2, ClipboardList } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { skinConditions } from "@/pages/public/SkinLibrary";
import { useDoctorAppointments, type DoctorAppointmentRecord } from "@/hooks/useDoctorAppointments";

type AppointmentRecord = DoctorAppointmentRecord;

type ReviewModal = {
  appointment: AppointmentRecord;
  decision: "approved" | "rejected" | null;
  diagnosis: string;
  note: string;
  showAnalysis: boolean;
};

function getConditionDetail(conditionId?: string) {
  return skinConditions.find((c) => c.id === conditionId);
}
export default function DoctorAppointmentsPage() {
  const { doctorName: _doctorName, appointments: allAppointments, loading, submitDoctorReview } = useDoctorAppointments();
  const [tab, setTab] = useState<"pending" | "reviewed">("pending");
  const [reviewModal, setReviewModal] = useState<ReviewModal | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const pendingReview = useMemo(
    () =>
      allAppointments.filter(
        (appointment) =>
          appointment.status !== "rejected" &&
          appointment.status !== "cancelled" &&
          appointment.status !== "completed" &&
          appointment.doctorStatus !== "rejected" &&
          appointment.doctorStatus !== "approved"
      ),
    [allAppointments]
  );
  const reviewed = useMemo(
    () =>
      allAppointments.filter(
        (appointment) =>
          appointment.doctorStatus === "approved" ||
          appointment.doctorStatus === "rejected" ||
          appointment.status === "rejected" ||
          appointment.status === "cancelled" ||
          appointment.status === "completed"
      ),
    [allAppointments]
  );

  const isDirectBooking = (appt?: AppointmentRecord | null) => {
    if (!appt) return true;
    const condName = (appt.aiConditionName || appt.conditionName || "").toLowerCase();
    const isGeneric = !condName || condName.includes("general") || condName.includes("consultation");
    const hasScore = appt.aiConfidence !== undefined && appt.aiConfidence !== null;
    return isGeneric && !hasScore;
  };

  const openReview = (appt: AppointmentRecord) => {
    const isDirect = isDirectBooking(appt);
    const initialDiagnosis = appt.doctorDiagnosis || (!isDirect ? (appt.aiConditionName || "") : "");
    setReviewModal({
      appointment: appt,
      decision: null,
      diagnosis: initialDiagnosis,
      note: "",
      showAnalysis: false
    });
    setSubmitError("");
  };

  const submitReview = async () => {
    if (!reviewModal) return;
    if (!reviewModal.decision) {
      setSubmitError("Please select Approve or Reject before submitting.");
      return;
    }
    if (!reviewModal.diagnosis.trim()) {
      setSubmitError("Please enter your final diagnosis before submitting.");
      return;
    }
    if (reviewModal.decision === "rejected" && !reviewModal.note.trim()) {
      setSubmitError("A rejection note is required — please explain why.");
      return;
    }

    setSubmitting(true);
    try {
      await submitDoctorReview(
        reviewModal.appointment.id,
        reviewModal.decision,
        reviewModal.diagnosis.trim(),
        reviewModal.note.trim()
      );
      setReviewModal(null);
    } catch (e: any) {
      setSubmitError(e?.message || "Failed to submit review. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const displayList = tab === "pending" ? pendingReview : reviewed;

  if (loading) {
    return (
      <div className="py-24 text-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-400">Loading patient review records...</p>
      </div>
    );
  }
  return (<div className="space-y-6">
    <div>
      <h1 className="text-2xl font-display font-bold text-gray-900">Review Patient</h1>
      <p className="text-sm text-gray-400 mt-0.5">
        Review each patient's AI analysis and approve or reject the appointment.
      </p>
    </div>

    {/* Tabs */}
    <div className="flex gap-2 border-b border-gray-100">
      {(["pending", "reviewed"] as const).map((t) => (<button key={t} onClick={() => setTab(t)} className={`px-4 py-2.5 text-sm font-semibold capitalize border-b-2 transition-colors ${tab === t
        ? "border-blue-500 text-blue-600"
        : "border-transparent text-gray-500 hover:text-gray-700"}`}>
        {t === "pending" ? "Pending Review" : "Reviewed"}
        <span className={`ml-2 text-[11px] px-1.5 py-0.5 rounded-full font-bold ${tab === t ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-500"}`}>
          {t === "pending" ? pendingReview.length : reviewed.length}
        </span>
      </button>))}
    </div>

    {/* List */}
    {displayList.length === 0 ? (<div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
      <Calendar className="w-10 h-10 text-gray-200 mx-auto mb-3" />
      <p className="text-sm text-gray-500">
        {tab === "pending" ? "No appointments pending your review." : "No reviewed appointments yet."}
      </p>
    </div>) : (<div className="grid gap-3">
      {displayList.map((appt, i) => {
        const condDetail = getConditionDetail(appt.conditionId);
        return (<motion.div key={appt.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="flex items-start gap-4">
            <img src={appt.patientAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(appt.patientName || "P")}&background=dbeafe&color=1d4ed8`} alt={appt.patientName} className="w-12 h-12 rounded-full object-cover border border-gray-200 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <p className="font-semibold text-gray-900">{appt.patientName || "Unknown Patient"}</p>
                  {appt.patientAge && <p className="text-xs text-gray-400">{appt.patientAge} years old</p>}
                  <p className="text-xs font-medium text-blue-600 mt-0.5">{appt.conditionName || "Skin concern"}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {appt.doctorStatus === "pending-review" && (<span className="text-[10px] px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
                    Pending Review
                  </span>)}
                  {appt.doctorStatus === "approved" && (<span className="text-[10px] px-2 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Approved
                  </span>)}
                  {appt.doctorStatus === "rejected" && (<span className="text-[10px] px-2 py-1 rounded-full bg-red-50 text-red-700 border border-red-200 font-semibold flex items-center gap-1">
                    <XCircle className="w-3 h-3" /> Rejected
                  </span>)}
                  {appt.scheduleSentToDoctor && appt.date && (<span className="text-[10px] px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-semibold flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> {appt.date} {appt.time}
                  </span>)}
                </div>
              </div>

              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-500">
                <span className="flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 shrink-0" /> {appt.clinicName}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  Submitted {new Date(appt.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              </div>

              {appt.notes && (<p className="mt-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 line-clamp-2">
                {appt.notes}
              </p>)}

              {appt.doctorNote && (<div className={`mt-2 rounded-lg px-3 py-2 text-xs font-medium ${appt.doctorStatus === "approved"
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-red-50 text-red-700 border border-red-200"}`}>
                <span className="font-bold">Your note: </span>{appt.doctorNote}
              </div>)}

              {/* AI Analysis preview (only if patient ran AI scan) */}
              {condDetail && !isDirectBooking(appt) && (
                <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/50 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <ScanSearch className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-[11px] font-bold text-blue-700 uppercase tracking-wide">AI Analysis Result</span>
                  </div>
                  <p className="text-xs font-semibold text-blue-800">{condDetail.name}</p>
                  <p className="text-[11px] text-blue-600 mt-0.5 line-clamp-2">{condDetail.description}</p>
                </div>
              )}
            </div>

            {appt.conditionImage && (<img src={appt.conditionImage} alt={appt.conditionName} className="w-16 h-16 rounded-xl object-cover border border-gray-100 shrink-0 hidden sm:block" />)}
          </div>

          {appt.doctorStatus === "pending-review" && (<div className="mt-4 pt-4 border-t border-gray-100">
            <button onClick={() => openReview(appt)} className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition-colors">
              <FileText className="w-4 h-4" /> Review &amp; Decide
            </button>
          </div>)}
        </motion.div>);
      })}
    </div>)}

    {/* Review Modal */}
    <AnimatePresence>
      {reviewModal && (() => {
        const isDirect = isDirectBooking(reviewModal.appointment);
        const cond = getConditionDetail(reviewModal.appointment.conditionId);

        return (<div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
          {/* Modal Header */}
          <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center gap-4 shrink-0">
            <img src={reviewModal.appointment.patientAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(reviewModal.appointment.patientName || "P")}&background=fce7f3&color=c0166a`} alt={reviewModal.appointment.patientName} className="w-12 h-12 rounded-full object-cover border border-gray-200" />
            <div className="flex-1 min-w-0">
              <p className="text-gray-900 font-bold text-base leading-tight truncate">
                {reviewModal.appointment.patientName || "Unknown Patient"}
              </p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {reviewModal.appointment.patientGender && (
                  <span className="text-[11px] font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded-full">
                    {reviewModal.appointment.patientGender}
                  </span>
                )}
                {reviewModal.appointment.patientAge ? (
                  <span className="text-gray-500 text-xs">{reviewModal.appointment.patientAge} yrs old</span>
                ) : reviewModal.appointment.patientBirthdate ? (
                  <span className="text-gray-500 text-xs">Born {reviewModal.appointment.patientBirthdate}</span>
                ) : null}
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                  isDirect
                    ? "text-slate-700 bg-slate-100 border-slate-200"
                    : "text-magenta-700 bg-magenta-50 border-magenta-100"
                }`}>
                  {isDirect ? "Direct General Consultation" : (reviewModal.appointment.conditionName || "Skin concern")}
                </span>
              </div>
            </div>
            <button onClick={() => setReviewModal(null)} className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
              <XCircle className="w-5 h-5" />
            </button>
          </div>

          {/* Modal Body */}
          <div className="overflow-y-auto flex-1 p-6 space-y-5">
            {/* Patient Info */}
            <div className="grid grid-cols-[130px_1fr] gap-3">
              {[
                { label: "Full Name", value: reviewModal.appointment.patientName },
                { label: "Gender", value: reviewModal.appointment.patientGender },
                { label: "Birthdate", value: reviewModal.appointment.patientBirthdate ? `${reviewModal.appointment.patientBirthdate}${reviewModal.appointment.patientAge ? ` (${reviewModal.appointment.patientAge} yrs old)` : ''}` : undefined },
                { label: "Email", value: reviewModal.appointment.patientEmail },
                { label: "Address", value: reviewModal.appointment.patientAddress },
                { label: "Contact", value: reviewModal.appointment.patientContact },
              ].map(({ label, value }) => (<div key={label} className="contents">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide self-center">{label}</span>
                <span className="text-sm text-gray-800 bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5">
                  {value || <span className="text-gray-300 italic">—</span>}
                </span>
              </div>))}
            </div>

            {/* Pre-Screening Questionnaire Section */}
            <div className="rounded-xl border border-magenta-200 overflow-hidden bg-white">
              <div className="px-4 py-3 bg-magenta-50/80 border-b border-magenta-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-magenta-600" />
                  <span className="text-xs font-bold text-magenta-900 uppercase tracking-wide">
                    Patient Pre-Screening Questionnaire
                  </span>
                </div>
                {reviewModal.appointment.questionnaireAnswers && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-magenta-200 text-magenta-800">
                    {reviewModal.appointment.questionnaireAnswers.length} questions answered
                  </span>
                )}
              </div>

              <div className="p-4 space-y-2.5 max-h-56 overflow-y-auto">
                {reviewModal.appointment.questionnaireAnswers && reviewModal.appointment.questionnaireAnswers.length > 0 ? (
                  reviewModal.appointment.questionnaireAnswers.map((qa, idx) => (
                    <div key={idx} className="p-2.5 rounded-lg bg-gray-50/80 border border-gray-100 text-xs">
                      <p className="font-semibold text-gray-800 mb-1">
                        {idx + 1}. {qa.question}
                      </p>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-magenta-700 font-medium bg-magenta-50 px-2 py-0.5 rounded-md border border-magenta-100">
                          {qa.answer}
                        </span>
                        {qa.severity !== undefined && qa.severity !== null && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            qa.severity >= 3
                              ? "bg-red-100 text-red-700"
                              : qa.severity >= 2
                              ? "bg-amber-100 text-amber-700"
                              : qa.severity >= 1
                              ? "bg-blue-100 text-blue-700"
                              : "bg-gray-100 text-gray-600"
                          }`}>
                            Severity: Level {qa.severity}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-gray-400 italic text-center py-2">
                    No pre-screening questionnaire answers recorded for this appointment.
                  </p>
                )}
              </div>
            </div>

            {/* Uploaded Skin Photo */}
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Uploaded Skin Photo</p>
              {reviewModal.appointment.skinPhotoUrl ? (<img src={reviewModal.appointment.skinPhotoUrl} alt="Patient skin photo" className="w-full max-h-52 object-contain rounded-xl border border-gray-200 bg-gray-50" />) : (<div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-4 text-center text-xs text-gray-400 italic">
                No skin photo uploaded.
              </div>)}
            </div>

            {/* Patient Notes */}
            {reviewModal.appointment.notes && (<div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">Patient Notes</p>
              <div className="text-sm text-gray-700 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2.5">
                {reviewModal.appointment.notes}
              </div>
            </div>)}

            {/* AI Analysis / Consultation Context Section */}
            {isDirect ? (
              <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50/60 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
                    <ClipboardList className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                      Direct Consultation Booking
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Patient did not perform an AI scan prior to booking
                    </p>
                  </div>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed mt-1">
                  This patient directly booked a General Dermatology Consultation. Please review their pre-screening questionnaire answers, symptoms, and medical notes above, then formulate and enter your final clinical diagnosis below.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-blue-200 overflow-hidden">
                <button onClick={() => setReviewModal((prev) => prev ? { ...prev, showAnalysis: !prev.showAnalysis } : prev)} className="w-full flex items-center justify-between px-4 py-3 bg-blue-50 hover:bg-blue-100 transition-colors">
                  <div className="flex items-center gap-2">
                    <ScanSearch className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-bold text-blue-700">AI Analysis Result</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500 text-white font-bold">
                      {reviewModal.appointment.aiConditionName || reviewModal.appointment.conditionName}
                    </span>
                  </div>
                  {reviewModal.showAnalysis
                    ? <ChevronUp className="w-4 h-4 text-blue-500" />
                    : <ChevronDown className="w-4 h-4 text-blue-500" />}
                </button>

                <AnimatePresence>
                  {reviewModal.showAnalysis && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="px-4 py-4 space-y-3 border-t border-blue-100">
                        {/* Patient-submitted AI result */}
                        <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 space-y-2">
                          <p className="text-[11px] font-bold text-blue-700 uppercase tracking-wide">Patient-Submitted AI Result</p>
                          <div className="flex gap-2 items-center">
                            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide w-28 shrink-0">Condition</span>
                            <span className="text-sm font-semibold text-blue-800">
                              {reviewModal.appointment.aiConditionName || reviewModal.appointment.conditionName || <span className="text-gray-300 italic">—</span>}
                            </span>
                          </div>
                          <div className="flex gap-2 items-center">
                            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide w-28 shrink-0">Confidence</span>
                            {reviewModal.appointment.aiConfidence !== undefined ? (<div className="flex items-center gap-2 flex-1">
                              <div className="flex-1 bg-blue-200 rounded-full h-1.5">
                                <div className="h-1.5 rounded-full bg-blue-600" style={{ width: `${Math.min(reviewModal.appointment.aiConfidence, 100)}%` }} />
                              </div>
                              <span className="text-xs font-bold text-blue-700">{reviewModal.appointment.aiConfidence}%</span>
                            </div>) : (<span className="text-sm text-gray-300 italic">—</span>)}
                          </div>
                        </div>

                        {cond && (<>
                          <div className="flex gap-4">
                            <img src={reviewModal.appointment.conditionImage || cond.image} alt={cond.name} className="w-20 h-20 rounded-xl object-cover border border-blue-100 shrink-0" />
                            <div>
                              <p className="font-semibold text-blue-800">{cond.name}</p>
                              {cond.filipinoName && (<p className="text-xs text-blue-600 italic mb-1">{cond.filipinoName}</p>)}
                              <p className="text-xs text-gray-600 mt-2">{cond.description}</p>
                            </div>
                          </div>

                          <div>
                            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Key Symptoms</p>
                            <ul className="space-y-1">
                              {cond.symptoms.slice(0, 4).map((s) => (<li key={s} className="flex items-start gap-1.5 text-xs text-gray-600">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                                {s}
                              </li>))}
                            </ul>
                          </div>

                          <div>
                            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Who Is Affected</p>
                            <p className="text-xs text-gray-600">{cond.whoAffected}</p>
                          </div>

                          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                            <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wide mb-0.5">When to See Doctor</p>
                            <p className="text-xs text-amber-700">{cond.whenToSeeDoctor}</p>
                          </div>
                        </>)}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Final diagnosis */}
            <div>
              <label htmlFor="doctor-diagnosis" className="block text-sm font-bold text-gray-700 mb-1.5">
                Final Diagnosis <span className="text-red-500">*</span>
              </label>
              <input
                id="doctor-diagnosis"
                type="text"
                value={reviewModal.diagnosis}
                onChange={(e) => setReviewModal((prev) => prev ? { ...prev, diagnosis: e.target.value } : prev)}
                placeholder={isDirect ? "Enter clinical diagnosis (e.g., Acne Vulgaris, Atopic Dermatitis, Eczema)..." : "e.g. Acne vulgaris"}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <p className="mt-1.5 text-xs text-gray-400">
                {isDirect
                  ? "Enter your clinical diagnosis for this consultation record."
                  : "This diagnosis is used to evaluate AI accuracy in the admin review dashboard."}
              </p>
            </div>

            {/* Decision */}
            <div>
              <p className="text-sm font-bold text-gray-700 mb-3">Your Decision</p>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setReviewModal((prev) => prev ? { ...prev, decision: "approved" } : prev)} className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-semibold text-sm transition-all ${reviewModal.decision === "approved"
                  ? "border-green-500 bg-green-50 text-green-700"
                  : "border-gray-200 bg-white text-gray-500 hover:border-green-300"}`}>
                  <CheckCircle2 className="w-4 h-4" /> Approve
                </button>
                <button onClick={() => setReviewModal((prev) => prev ? { ...prev, decision: "rejected" } : prev)} className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-semibold text-sm transition-all ${reviewModal.decision === "rejected"
                  ? "border-red-500 bg-red-50 text-red-700"
                  : "border-gray-200 bg-white text-gray-500 hover:border-red-300"}`}>
                  <XCircle className="w-4 h-4" /> Reject
                </button>
              </div>
            </div>

            {/* Note */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <p className="text-sm font-bold text-gray-700">Review Note</p>
                {reviewModal.decision === "rejected" && (<span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-bold">Required for rejection</span>)}
              </div>
              <textarea rows={3} value={reviewModal.note} onChange={(e) => setReviewModal((prev) => prev ? { ...prev, note: e.target.value } : prev)} placeholder={reviewModal.decision === "rejected"
                ? "Explain why you are rejecting — e.g. AI result appears inaccurate, clinic does not offer this service..."
                : "Optional: add any notes for the clinic..."} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none" />
            </div>

            {reviewModal.decision === "rejected" && (<div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">
                <strong>Note:</strong> Rejection reasons — the AI result is inaccurate, or the clinic does not offer a service for this skin condition.
              </p>
            </div>)}

            {submitError && (<p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {submitError}
            </p>)}
          </div>

          {/* Modal Footer */}
          <div className="px-6 pb-6 pt-2 flex gap-3 shrink-0 border-t border-gray-100">
            <button
              type="button"
              disabled={submitting}
              onClick={() => setReviewModal(null)}
              className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={submitReview}
              className="flex-1 py-3 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Submitting...
                </>
              ) : (
                "Submit Review"
              )}
            </button>
          </div>
        </motion.div>
      </div>); })()}
    </AnimatePresence>
  </div>);
}
