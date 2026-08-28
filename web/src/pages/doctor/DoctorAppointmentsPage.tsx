import { useState, useMemo } from "react";
import { CheckCircle2, XCircle, Clock, ScanSearch, ChevronDown, ChevronUp, AlertTriangle, Calendar, User, FileText } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { skinConditions } from "@/pages/public/SkinLibrary";
type AppointmentRecord = {
    id: string;
    clinicName: string;
    patientName?: string;
    patientAge?: number;
    patientAvatar?: string;
    patientEmail?: string;
    patientAddress?: string;
    patientContact?: string;
    conditionId?: string;
    conditionName?: string;
    conditionImage?: string;
    date: string;
    time: string;
    notes: string;
    status: "pending" | "accepted" | "scheduled" | "rejected";
    assignedDoctorId?: string;
    assignedDoctorName?: string;
    doctorStatus?: "pending-review" | "approved" | "rejected";
    doctorNote?: string;
    doctorDiagnosis?: string;
    doctorReviewedAt?: string;
    scheduleSentToDoctor?: boolean;
    createdAt: string;
    skinPhotoUrl?: string;
    aiConditionName?: string;
    aiConfidence?: number;
};
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
// TODO: Notify clinic of doctor review via Supabase real-time
function addDoctorNotifToClinic(_clinicKey: string, _appointmentId: string, _patientName: string, _doctorName: string, _decision: string) {
    // no-op until backend is connected
}
export default function DoctorAppointmentsPage() {
    // TODO: Load doctor info from Supabase auth session
    const doctorName = "";
    const [tab, setTab] = useState<"pending" | "reviewed">("pending");
    const [allAppointments, setAllAppointments] = useState<AppointmentRecord[]>([]);
    const [reviewModal, setReviewModal] = useState<ReviewModal | null>(null);
    const [submitError, setSubmitError] = useState("");
    // TODO: Load doctor appointments from Supabase
    const reviewRequests = useMemo(() => allAppointments.filter((appointment) => appointment.status === "pending" && !appointment.date && !appointment.time), [allAppointments]);
    const pendingReview = useMemo(() => reviewRequests.filter((appointment) => appointment.doctorStatus === "pending-review"), [reviewRequests]);
    const reviewed = useMemo(() => reviewRequests.filter((appointment) => appointment.doctorStatus === "approved" || appointment.doctorStatus === "rejected"), [reviewRequests]);
    const openReview = (appt: AppointmentRecord) => {
        setReviewModal({ appointment: appt, decision: null, diagnosis: appt.doctorDiagnosis || "", note: "", showAnalysis: false });
        setSubmitError("");
    };
    const submitReview = () => {
        if (!reviewModal)
            return;
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
        // TODO: Submit doctor review to Supabase and trigger real-time clinic notification
        const appt = reviewModal.appointment;
        const clinicKey = appt.clinicName.toLowerCase().replace(/[^a-z0-9]/g, "");
        addDoctorNotifToClinic(clinicKey, appt.id, appt.patientName || "Patient", doctorName, reviewModal.decision!);
        setAllAppointments((prev) =>
          prev.map((item) =>
            item.id === appt.id
              ? {
                  ...item,
                  doctorStatus: reviewModal.decision === "approved" ? ("approved" as const) : ("rejected" as const),
                  doctorDiagnosis: reviewModal.diagnosis,
                  doctorNote: reviewModal.note,
                  doctorReviewedAt: new Date().toISOString(),
                }
              : item
          )
        );
        setReviewModal(null);
        // TODO: Reload appointments from Supabase after review
    };
    const displayList = tab === "pending" ? pendingReview : reviewed;
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
          <Calendar className="w-10 h-10 text-gray-200 mx-auto mb-3"/>
          <p className="text-sm text-gray-500">
            {tab === "pending" ? "No appointments pending your review." : "No reviewed appointments yet."}
          </p>
        </div>) : (<div className="grid gap-3">
          {displayList.map((appt, i) => {
                const condDetail = getConditionDetail(appt.conditionId);
                return (<motion.div key={appt.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="bg-white rounded-2xl border border-gray-100 p-5">
                <div className="flex items-start gap-4">
                  <img src={appt.patientAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(appt.patientName || "P")}&background=dbeafe&color=1d4ed8`} alt={appt.patientName} className="w-12 h-12 rounded-full object-cover border border-gray-200 shrink-0"/>
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
                            <CheckCircle2 className="w-3 h-3"/> Approved
                          </span>)}
                        {appt.doctorStatus === "rejected" && (<span className="text-[10px] px-2 py-1 rounded-full bg-red-50 text-red-700 border border-red-200 font-semibold flex items-center gap-1">
                            <XCircle className="w-3 h-3"/> Rejected
                          </span>)}
                        {appt.scheduleSentToDoctor && appt.date && (<span className="text-[10px] px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-semibold flex items-center gap-1">
                            <Calendar className="w-3 h-3"/> {appt.date} {appt.time}
                          </span>)}
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-500">
                      <span className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 shrink-0"/> {appt.clinicName}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 shrink-0"/>
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

                    {/* AI Analysis preview */}
                    {condDetail && (<div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/50 p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <ScanSearch className="w-3.5 h-3.5 text-blue-500"/>
                          <span className="text-[11px] font-bold text-blue-700 uppercase tracking-wide">AI Analysis Result</span>
                        </div>
                        <p className="text-xs font-semibold text-blue-800">{condDetail.name}</p>
                        <p className="text-[11px] text-blue-600 mt-0.5 line-clamp-2">{condDetail.description}</p>
                      </div>)}
                  </div>

                  {appt.conditionImage && (<img src={appt.conditionImage} alt={appt.conditionName} className="w-16 h-16 rounded-xl object-cover border border-gray-100 shrink-0 hidden sm:block"/>)}
                </div>

                {appt.doctorStatus === "pending-review" && (<div className="mt-4 pt-4 border-t border-gray-100">
                    <button onClick={() => openReview(appt)} className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition-colors">
                      <FileText className="w-4 h-4"/> Review &amp; Decide
                    </button>
                  </div>)}
              </motion.div>);
            })}
        </div>)}

      {/* Review Modal */}
      <AnimatePresence>
        {reviewModal && (<div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
              {/* Modal Header */}
              <div className="bg-gradient-to-r from-blue-600 to-blue-800 px-6 py-5 flex items-center gap-4 shrink-0">
                <img src={reviewModal.appointment.patientAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(reviewModal.appointment.patientName || "P")}&background=dbeafe&color=1d4ed8`} alt={reviewModal.appointment.patientName} className="w-14 h-14 rounded-full object-cover border-2 border-white/60"/>
                <div className="flex-1">
                  <p className="text-white font-bold text-lg leading-tight">
                    {reviewModal.appointment.patientName || "Unknown Patient"}
                  </p>
                  {reviewModal.appointment.patientAge && (<p className="text-blue-200 text-sm">{reviewModal.appointment.patientAge} years old</p>)}
                  <p className="text-blue-100 text-sm font-medium">
                    {reviewModal.appointment.conditionName || "Skin concern"}
                  </p>
                </div>
                <button onClick={() => setReviewModal(null)} className="ml-auto w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors">
                  <XCircle className="w-4 h-4 text-white"/>
                </button>
              </div>

              {/* Modal Body */}
              <div className="overflow-y-auto flex-1 p-6 space-y-5">
                {/* Patient Info */}
                <div className="grid grid-cols-[130px_1fr] gap-3">
                  {[
                { label: "Full Name", value: reviewModal.appointment.patientName },
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

                {/* Uploaded Skin Photo */}
                <div>
                  <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Uploaded Skin Photo</p>
                  {reviewModal.appointment.skinPhotoUrl ? (<img src={reviewModal.appointment.skinPhotoUrl} alt="Patient skin photo" className="w-full max-h-52 object-contain rounded-xl border border-gray-200 bg-gray-50"/>) : (<div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-4 text-center text-xs text-gray-400 italic">
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

                {/* AI Analysis Section */}
                <div className="rounded-xl border border-blue-200 overflow-hidden">
                  <button onClick={() => setReviewModal((prev) => prev ? { ...prev, showAnalysis: !prev.showAnalysis } : prev)} className="w-full flex items-center justify-between px-4 py-3 bg-blue-50 hover:bg-blue-100 transition-colors">
                    <div className="flex items-center gap-2">
                      <ScanSearch className="w-4 h-4 text-blue-600"/>
                      <span className="text-sm font-bold text-blue-700">AI Analysis Result</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500 text-white font-bold">
                        {reviewModal.appointment.aiConditionName || reviewModal.appointment.conditionName}
                      </span>
                    </div>
                    {reviewModal.showAnalysis
                ? <ChevronUp className="w-4 h-4 text-blue-500"/>
                : <ChevronDown className="w-4 h-4 text-blue-500"/>}
                  </button>

                  <AnimatePresence>
                    {reviewModal.showAnalysis && (() => {
                const cond = getConditionDetail(reviewModal.appointment.conditionId);
                return (<motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
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
                                        <div className="h-1.5 rounded-full bg-blue-600" style={{ width: `${Math.min(reviewModal.appointment.aiConfidence, 100)}%` }}/>
                                      </div>
                                      <span className="text-xs font-bold text-blue-700">{reviewModal.appointment.aiConfidence}%</span>
                                    </div>) : (<span className="text-sm text-gray-300 italic">—</span>)}
                                </div>
                              </div>

                            {cond ? (<>
                                <div className="flex gap-4">
                                  <img src={reviewModal.appointment.conditionImage || cond.image} alt={cond.name} className="w-20 h-20 rounded-xl object-cover border border-blue-100 shrink-0"/>
                                  <div>
                                    <p className="font-semibold text-blue-800">{cond.name}</p>
                                    {cond.filipinoName && (<p className="text-xs text-blue-600 italic mb-1">{cond.filipinoName}</p>)}
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold">
                                      {cond.category}
                                    </span>
                                    <p className="text-xs text-gray-600 mt-2">{cond.description}</p>
                                  </div>
                                </div>

                                <div>
                                  <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Key Symptoms</p>
                                  <ul className="space-y-1">
                                    {cond.symptoms.slice(0, 4).map((s) => (<li key={s} className="flex items-start gap-1.5 text-xs text-gray-600">
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0"/>
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
                              </>) : (<p className="text-sm text-gray-500">No AI analysis data found for this condition.</p>)}
                          </div>
                        </motion.div>);
            })()}
                  </AnimatePresence>
                </div>

                {/* Final diagnosis */}
                <div>
                  <label htmlFor="doctor-diagnosis" className="block text-sm font-bold text-gray-700 mb-1.5">
                    Final Diagnosis <span className="text-red-500">*</span>
                  </label>
                  <input id="doctor-diagnosis" type="text" value={reviewModal.diagnosis} onChange={(e) => setReviewModal((prev) => prev ? { ...prev, diagnosis: e.target.value } : prev)} placeholder="e.g. Acne vulgaris" className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"/>
                  <p className="mt-1.5 text-xs text-gray-400">This diagnosis is used to evaluate AI accuracy in the admin review dashboard.</p>
                </div>

                {/* Decision */}
                <div>
                  <p className="text-sm font-bold text-gray-700 mb-3">Your Decision</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => setReviewModal((prev) => prev ? { ...prev, decision: "approved" } : prev)} className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-semibold text-sm transition-all ${reviewModal.decision === "approved"
                ? "border-green-500 bg-green-50 text-green-700"
                : "border-gray-200 bg-white text-gray-500 hover:border-green-300"}`}>
                      <CheckCircle2 className="w-4 h-4"/> Approve
                    </button>
                    <button onClick={() => setReviewModal((prev) => prev ? { ...prev, decision: "rejected" } : prev)} className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-semibold text-sm transition-all ${reviewModal.decision === "rejected"
                ? "border-red-500 bg-red-50 text-red-700"
                : "border-gray-200 bg-white text-gray-500 hover:border-red-300"}`}>
                      <XCircle className="w-4 h-4"/> Reject
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
                : "Optional: add any notes for the clinic..."} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"/>
                </div>

                {reviewModal.decision === "rejected" && (<div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5"/>
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
                <button onClick={() => setReviewModal(null)} className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button onClick={submitReview} className="flex-1 py-3 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition-colors">
                  Submit Review
                </button>
              </div>
            </motion.div>
          </div>)}
      </AnimatePresence>
    </div>);
}
