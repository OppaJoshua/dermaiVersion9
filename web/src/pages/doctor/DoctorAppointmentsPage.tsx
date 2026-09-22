import { useState, useMemo } from "react";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ScanSearch,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Calendar,
  User,
  FileText,
  Loader2,
  ClipboardList,
  Sparkles,
  Info,
} from "lucide-react";
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

const DECLINE_REASONS = [
  "Fully booked during requested timeframe",
  "Case requires different subspecialty (e.g., Surgery / Oncology / Pediatric)",
  "Skin photograph is too blurry / inadequate lighting",
  "Patient requires in-person hospital biopsy / patch testing",
  "Doctor on scheduled medical / academic leave",
];

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
      showAnalysis: false,
    });
    setSubmitError("");
  };

  const submitReview = async () => {
    if (!reviewModal) return;
    if (!reviewModal.decision) {
      setSubmitError("Please choose whether to accept or decline this patient referral.");
      return;
    }

    if (reviewModal.decision === "rejected" && !reviewModal.note.trim()) {
      setSubmitError("Please select or write a reason for declining so your clinic triage team can re-assign appropriately.");
      return;
    }

    setSubmitting(true);
    setSubmitError("");
    try {
      const diagnosisText = reviewModal.diagnosis.trim() || reviewModal.appointment.aiConditionName || reviewModal.appointment.conditionName || "";
      await submitDoctorReview(
        reviewModal.appointment.id,
        reviewModal.decision,
        reviewModal.decision === "approved" ? diagnosisText : "",
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

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-display font-bold text-gray-900">Pre-Consultation Patient Review</h1>
        <p className="text-sm text-gray-500 mt-1 max-w-3xl leading-relaxed">
          Review incoming patient cases assigned to you by the clinic. When you approve, your clinic will finalize the date and time. If you decline, your clinic will be notified internally to re-assign the patient to another doctor.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-100">
        {(["pending", "reviewed"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-semibold capitalize border-b-2 transition-colors cursor-pointer ${
              tab === t
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "pending" ? "Awaiting Your Review" : "All Reviewed"}
            <span
              className={`ml-2 text-[11px] px-2 py-0.5 rounded-full font-bold ${
                tab === t ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-500"
              }`}
            >
              {t === "pending" ? pendingReview.length : reviewed.length}
            </span>
          </button>
        ))}
      </div>

      {/* List */}
      {displayList.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
          <Calendar className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-500 font-medium">
            {tab === "pending" ? "No patient cases currently awaiting your review." : "No reviewed appointments recorded."}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {tab === "pending" ? "New appointments assigned by your clinic triage team will appear here." : "Your clinical review decisions will be archived here."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3.5">
          {displayList.map((appt, i) => {
            const condDetail = getConditionDetail(appt.conditionId);
            const isCompleted = appt.status === "completed" || appt.doctorDone;
            const isApproved = appt.doctorStatus === "approved" && !isCompleted;
            const isRejected = appt.doctorStatus === "rejected";
            const isScheduled = Boolean(
              appt.date && (appt.status === "scheduled" || appt.status === "confirmed") && !isCompleted
            );

            return (
              <motion.div
                key={appt.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="bg-white rounded-2xl border border-gray-100 p-5 shadow-xs hover:border-gray-200 transition-all"
              >
                <div className="flex items-start gap-4">
                  <img
                    src={
                      appt.patientAvatar ||
                      `https://ui-avatars.com/api/?name=${encodeURIComponent(appt.patientName || "P")}&background=dbeafe&color=1d4ed8`
                    }
                    alt={appt.patientName}
                    className="w-12 h-12 rounded-full object-cover border border-gray-200 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <p className="font-bold text-gray-900 text-base">{appt.patientName || "Patient"}</p>
                        {appt.patientAge && <p className="text-xs text-gray-400">{appt.patientAge} years old</p>}
                        <p className="text-xs font-semibold text-blue-600 mt-0.5">
                          {appt.conditionName || "Dermatology Consultation"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {appt.doctorStatus === "pending-review" && (
                          <span className="text-[10px] px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-bold flex items-center gap-1">
                            <Clock className="w-3 h-3 text-amber-600" /> Awaiting Your Review
                          </span>
                        )}
                        {isCompleted && (
                          <span className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-700" /> Consultation Completed
                          </span>
                        )}
                        {isApproved && !isScheduled && (
                          <span className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Approved by You — Awaiting Clinic Schedule
                          </span>
                        )}
                        {isApproved && isScheduled && (
                          <span className="text-[10px] px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-bold flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-blue-600" /> Confirmed Schedule: {appt.date} {appt.time}
                          </span>
                        )}
                        {isRejected && (
                          <span className="text-[10px] px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200 font-bold flex items-center gap-1">
                            <XCircle className="w-3 h-3 text-red-600" /> Declined by You (Clinic Notified)
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-500">
                      <span className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 shrink-0 text-gray-400" /> {appt.clinicName}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                        Requested{" "}
                        {new Date(appt.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </div>

                    {appt.notes && (
                      <p className="mt-2 text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2 line-clamp-2 border border-gray-100">
                        <strong className="text-gray-700">Patient Note: </strong>
                        {appt.notes}
                      </p>
                    )}

                    {/* Doctor Diagnosis Block */}
                    {appt.doctorDiagnosis && (
                      <div
                        className={`mt-2.5 rounded-xl p-3 border ${
                          isCompleted
                            ? "bg-emerald-50/90 border-emerald-200 text-emerald-950"
                            : isApproved
                            ? "bg-blue-50/90 border-blue-200 text-blue-950"
                            : "bg-red-50/90 border-red-200 text-red-950"
                        }`}
                      >
                        <p className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 text-blue-700">
                          <Sparkles className="w-3.5 h-3.5" /> Your Clinical Diagnosis / Assessment
                        </p>
                        <p className="text-sm font-bold mt-0.5">{appt.doctorDiagnosis}</p>
                        {appt.doctorNote && (
                          <p className="text-xs mt-1 pt-1 border-t border-black/5 text-gray-700">
                            <span className="font-semibold">Review / Advice Note: </span>
                            {appt.doctorNote}
                          </p>
                        )}
                      </div>
                    )}

                    {!appt.doctorDiagnosis && appt.doctorNote && (
                      <div
                        className={`mt-2.5 rounded-lg px-3 py-2 text-xs font-medium ${
                          isApproved
                            ? "bg-green-50 text-green-700 border border-green-200"
                            : "bg-red-50 text-red-700 border border-red-200"
                        }`}
                      >
                        <span className="font-bold">Your note: </span>
                        {appt.doctorNote}
                      </div>
                    )}

                    {/* Status workflow prompt info */}
                    {isApproved && !isScheduled && (
                      <div className="mt-2 text-[11px] text-emerald-800 bg-emerald-50/80 border border-emerald-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>
                          <strong>Case Approved:</strong> Your clinic scheduler has been notified to set the final consultation date &amp; time.
                        </span>
                      </div>
                    )}
                    {isRejected && (
                      <div className="mt-2 text-[11px] text-red-800 bg-red-50/80 border border-red-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5 text-red-600 shrink-0" />
                        <span>
                          <strong>Case Declined:</strong> Your clinic triage team was notified with your reason to re-assign this patient to another doctor. (Patient does not see internal rejections).
                        </span>
                      </div>
                    )}

                    {/* AI Analysis preview */}
                    {condDetail && !isDirectBooking(appt) && (
                      <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/50 p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <ScanSearch className="w-3.5 h-3.5 text-blue-500" />
                          <span className="text-[11px] font-bold text-blue-700 uppercase tracking-wide">
                            AI Pre-Screening Result
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-blue-800">{condDetail.name}</p>
                        <p className="text-[11px] text-blue-600 mt-0.5 line-clamp-2">{condDetail.description}</p>
                      </div>
                    )}
                  </div>

                  {appt.conditionImage && (
                    <img
                      src={appt.conditionImage}
                      alt={appt.conditionName}
                      className="w-16 h-16 rounded-xl object-cover border border-gray-100 shrink-0 hidden sm:block"
                    />
                  )}
                </div>

                {appt.doctorStatus === "pending-review" && (
                  <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between gap-3">
                    <p className="text-xs text-amber-700 font-medium hidden sm:block">
                      Pre-consultation clinical review required.
                    </p>
                    <button
                      onClick={() => openReview(appt)}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors shadow-xs cursor-pointer"
                    >
                      <FileText className="w-4 h-4" /> Review &amp; Accept Patient
                    </button>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Review Modal */}
      <AnimatePresence>
        {reviewModal && (() => {
          const isDirect = isDirectBooking(reviewModal.appointment);
          const cond = getConditionDetail(reviewModal.appointment.conditionId);

          return (
            <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
              >
                {/* Modal Header */}
                <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center gap-4 shrink-0">
                  <img
                    src={
                      reviewModal.appointment.patientAvatar ||
                      `https://ui-avatars.com/api/?name=${encodeURIComponent(
                        reviewModal.appointment.patientName || "P"
                      )}&background=fce7f3&color=c0166a`
                    }
                    alt={reviewModal.appointment.patientName}
                    className="w-12 h-12 rounded-full object-cover border border-gray-200"
                  />
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
                        <span className="text-gray-500 text-xs">
                          {reviewModal.appointment.patientAge} yrs old
                        </span>
                      ) : reviewModal.appointment.patientBirthdate ? (
                        <span className="text-gray-500 text-xs">
                          Born {reviewModal.appointment.patientBirthdate}
                        </span>
                      ) : null}
                      <span
                        className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
                          isDirect
                            ? "text-slate-700 bg-slate-100 border-slate-200"
                            : "text-blue-700 bg-blue-50 border-blue-200"
                        }`}
                      >
                        {isDirect
                          ? "Direct Consultation Request"
                          : reviewModal.appointment.conditionName || "Skin concern"}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setReviewModal(null)}
                    className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                  >
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
                      {
                        label: "Birthdate",
                        value: reviewModal.appointment.patientBirthdate
                          ? `${reviewModal.appointment.patientBirthdate}${
                              reviewModal.appointment.patientAge
                                ? ` (${reviewModal.appointment.patientAge} yrs old)`
                                : ""
                            }`
                          : undefined,
                      },
                      { label: "Email", value: reviewModal.appointment.patientEmail },
                      { label: "Address", value: reviewModal.appointment.patientAddress },
                      { label: "Contact", value: reviewModal.appointment.patientContact },
                    ].map(({ label, value }) => (
                      <div key={label} className="contents">
                        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide self-center">
                          {label}
                        </span>
                        <span className="text-sm text-gray-800 bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5">
                          {value || <span className="text-gray-300 italic">—</span>}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Pre-Screening Questionnaire Section */}
                  <div className="rounded-xl border border-blue-200 overflow-hidden bg-white">
                    <div className="px-4 py-3 bg-blue-50/80 border-b border-blue-100 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ClipboardList className="w-4 h-4 text-blue-600" />
                        <span className="text-xs font-bold text-blue-900 uppercase tracking-wide">
                          Patient Symptoms &amp; Pre-Screening Questionnaire
                        </span>
                      </div>
                      {reviewModal.appointment.questionnaireAnswers && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-200 text-blue-800">
                          {reviewModal.appointment.questionnaireAnswers.length} responses recorded
                        </span>
                      )}
                    </div>

                    <div className="p-4 space-y-2.5 max-h-56 overflow-y-auto">
                      {reviewModal.appointment.questionnaireAnswers &&
                      reviewModal.appointment.questionnaireAnswers.length > 0 ? (
                        reviewModal.appointment.questionnaireAnswers.map((qa, idx) => (
                          <div
                            key={idx}
                            className="p-2.5 rounded-lg bg-gray-50/80 border border-gray-100 text-xs"
                          >
                            <p className="font-semibold text-gray-800 mb-1">
                              {idx + 1}. {qa.question}
                            </p>
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-blue-700 font-medium bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
                                {qa.answer}
                              </span>
                              {qa.severity !== undefined && qa.severity !== null && (
                                <span
                                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                    qa.severity >= 3
                                      ? "bg-red-100 text-red-700"
                                      : qa.severity >= 2
                                      ? "bg-amber-100 text-amber-700"
                                      : qa.severity >= 1
                                      ? "bg-blue-100 text-blue-700"
                                      : "bg-gray-100 text-gray-600"
                                  }`}
                                >
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
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">
                      Uploaded Skin Photo
                    </p>
                    {reviewModal.appointment.skinPhotoUrl ? (
                      <img
                        src={reviewModal.appointment.skinPhotoUrl}
                        alt="Patient skin photo"
                        className="w-full max-h-56 object-contain rounded-xl border border-gray-200 bg-gray-50 shadow-inner"
                      />
                    ) : (
                      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-4 text-center text-xs text-gray-400 italic">
                        No skin photo uploaded.
                      </div>
                    )}
                  </div>

                  {/* Patient Notes */}
                  {reviewModal.appointment.notes && (
                    <div>
                      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">
                        Patient Notes
                      </p>
                      <div className="text-sm text-gray-700 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2.5">
                        {reviewModal.appointment.notes}
                      </div>
                    </div>
                  )}

                  {/* AI Analysis Result (if available) */}
                  {!isDirect && (
                    <div className="rounded-xl border border-blue-200 overflow-hidden">
                      <button
                        type="button"
                        onClick={() =>
                          setReviewModal((prev) => (prev ? { ...prev, showAnalysis: !prev.showAnalysis } : prev))
                        }
                        className="w-full flex items-center justify-between px-4 py-3 bg-blue-50 hover:bg-blue-100 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <ScanSearch className="w-4 h-4 text-blue-600" />
                          <span className="text-sm font-bold text-blue-700">AI Pre-Screening Analysis</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500 text-white font-bold">
                            {reviewModal.appointment.aiConditionName || reviewModal.appointment.conditionName}
                          </span>
                        </div>
                        {reviewModal.showAnalysis ? (
                          <ChevronUp className="w-4 h-4 text-blue-500" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-blue-500" />
                        )}
                      </button>

                      <AnimatePresence>
                        {reviewModal.showAnalysis && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="px-4 py-4 space-y-3 border-t border-blue-100">
                              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 space-y-2">
                                <p className="text-[11px] font-bold text-blue-700 uppercase tracking-wide">
                                  Algorithm Suggestion
                                </p>
                                <div className="flex gap-2 items-center">
                                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide w-28 shrink-0">
                                    Condition
                                  </span>
                                  <span className="text-sm font-semibold text-blue-800">
                                    {reviewModal.appointment.aiConditionName ||
                                      reviewModal.appointment.conditionName || (
                                        <span className="text-gray-300 italic">—</span>
                                      )}
                                  </span>
                                </div>
                                <div className="flex gap-2 items-center">
                                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide w-28 shrink-0">
                                    Confidence
                                  </span>
                                  {reviewModal.appointment.aiConfidence !== undefined ? (
                                    <div className="flex items-center gap-2 flex-1">
                                      <div className="flex-1 bg-blue-200 rounded-full h-1.5">
                                        <div
                                          className="h-1.5 rounded-full bg-blue-600"
                                          style={{
                                            width: `${Math.min(reviewModal.appointment.aiConfidence, 100)}%`,
                                          }}
                                        />
                                      </div>
                                      <span className="text-xs font-bold text-blue-700">
                                        {reviewModal.appointment.aiConfidence}%
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-sm text-gray-300 italic">—</span>
                                  )}
                                </div>
                              </div>

                              {cond && (
                                <>
                                  <div className="flex gap-4">
                                    <img
                                      src={reviewModal.appointment.conditionImage || cond.image}
                                      alt={cond.name}
                                      className="w-20 h-20 rounded-xl object-cover border border-blue-100 shrink-0"
                                    />
                                    <div>
                                      <p className="font-semibold text-blue-800">{cond.name}</p>
                                      {cond.filipinoName && (
                                        <p className="text-xs text-blue-600 italic mb-1">{cond.filipinoName}</p>
                                      )}
                                      <p className="text-xs text-gray-600 mt-2">{cond.description}</p>
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {/* Decision Section */}
                  <div className="pt-2 border-t border-gray-100">
                    <p className="text-sm font-bold text-gray-900 mb-2">
                      Do you accept this patient referral? <span className="text-red-500">*</span>
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setReviewModal((prev) => (prev ? { ...prev, decision: "approved" } : prev))}
                        className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-bold text-sm transition-all cursor-pointer ${
                          reviewModal.decision === "approved"
                            ? "border-green-500 bg-green-50 text-green-700 shadow-xs ring-2 ring-green-500/20"
                            : "border-gray-200 bg-white text-gray-600 hover:border-green-300"
                        }`}
                      >
                        <CheckCircle2 className="w-4 h-4 text-green-600" /> Accept Patient
                      </button>
                      <button
                        type="button"
                        onClick={() => setReviewModal((prev) => (prev ? { ...prev, decision: "rejected" } : prev))}
                        className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-bold text-sm transition-all cursor-pointer ${
                          reviewModal.decision === "rejected"
                            ? "border-red-500 bg-red-50 text-red-700 shadow-xs ring-2 ring-red-500/20"
                            : "border-gray-200 bg-white text-gray-600 hover:border-red-300"
                        }`}
                      >
                        <XCircle className="w-4 h-4 text-red-600" /> Decline / Cannot Take
                      </button>
                    </div>

                    {/* Explanatory Workflow Banners */}
                    {reviewModal.decision === "approved" && (
                      <div className="mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        <p className="leading-relaxed">
                          <strong>Accept Patient:</strong> Confirming acceptance will notify your clinic scheduler to finalize and lock the consultation date &amp; time with the patient.
                        </p>
                      </div>
                    )}

                    {reviewModal.decision === "rejected" && (
                      <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <p className="leading-relaxed">
                          <strong>Decline Referral:</strong> Declining will alert your clinic triage team to <strong>re-assign another doctor</strong> from your clinic. (The patient will not see this decline).
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Form fields conditional on decision */}
                  {reviewModal.decision === "approved" && (
                    <div className="space-y-3">
                      <div>
                        <label htmlFor="doctor-note" className="block text-sm font-bold text-gray-800 mb-1">
                          Pre-Consultation Notes / Instructions (Optional)
                        </label>
                        <textarea
                          id="doctor-note"
                          rows={2}
                          value={reviewModal.note}
                          onChange={(e) =>
                            setReviewModal((prev) => (prev ? { ...prev, note: e.target.value } : prev))
                          }
                          placeholder="e.g., Patient may proceed. Avoid applying topical creams 24 hours prior to consultation..."
                          className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
                        />
                        <p className="text-[11px] text-gray-400 mt-1">
                          Optional notes or instructions for the clinic scheduler before the visit.
                        </p>
                      </div>
                    </div>
                  )}

                  {reviewModal.decision === "rejected" && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label htmlFor="decline-reason" className="block text-sm font-bold text-gray-800">
                          Reason for Declining Referral <span className="text-red-500">*</span>
                        </label>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-bold">
                          Required for clinic re-assignment
                        </span>
                      </div>

                      {/* Quick reason pills */}
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {DECLINE_REASONS.map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() =>
                              setReviewModal((prev) => (prev ? { ...prev, note: r } : prev))
                            }
                            className={`text-[11px] px-2.5 py-1 rounded-lg border text-left transition-all cursor-pointer ${
                              reviewModal.note === r
                                ? "bg-red-50 border-red-300 text-red-700 font-semibold"
                                : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
                            }`}
                          >
                            {r}
                          </button>
                        ))}
                      </div>

                      <textarea
                        id="decline-reason"
                        rows={3}
                        value={reviewModal.note}
                        onChange={(e) =>
                          setReviewModal((prev) => (prev ? { ...prev, note: e.target.value } : prev))
                        }
                        placeholder="State your reason for declining so the clinic manager can re-assign appropriately..."
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
                      />
                    </div>
                  )}

                  {submitError && (
                    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      {submitError}
                    </p>
                  )}
                </div>

                {/* Modal Footer */}
                <div className="px-6 pb-6 pt-2 flex gap-3 shrink-0 border-t border-gray-100">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setReviewModal(null)}
                    className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={submitting || !reviewModal.decision}
                    onClick={submitReview}
                    className={`flex-1 py-3 rounded-xl text-white text-sm font-bold transition-all disabled:opacity-50 inline-flex items-center justify-center gap-2 cursor-pointer shadow-xs ${
                      reviewModal.decision === "rejected"
                        ? "bg-red-600 hover:bg-red-700"
                        : "bg-emerald-600 hover:bg-emerald-700"
                    }`}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" /> Saving...
                      </>
                    ) : reviewModal.decision === "rejected" ? (
                      <>
                        <XCircle className="w-4 h-4" /> Decline &amp; Notify Clinic
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" /> Accept Patient &amp; Send to Clinic
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}
