import { useState, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  CheckCircle2,
  XCircle,
  ScanSearch,
  ChevronDown,
  ChevronUp,
  Calendar,
  Loader2,
  ClipboardList,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { skinConditions } from "@/pages/public/SkinLibrary";
import { useDoctorAppointments, type DoctorAppointmentRecord } from "@/hooks/useDoctorAppointments";
import { LazySkinPhoto } from "@/components/common/LazySkinPhoto";

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


function formatScheduleDateTime(dateStr?: string, timeStr?: string): string {
  if (!dateStr) return "Schedule pending";
  try {
    const dt = new Date(
      dateStr.includes("T")
        ? dateStr
        : `${dateStr}T${timeStr && timeStr !== "—" && timeStr !== "\u2014" ? timeStr : "00:00"}:00`
    );
    if (isNaN(dt.getTime())) return dateStr;

    const dateFormatted = dt.toLocaleDateString("en-PH", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    if (!timeStr || timeStr === "—" || timeStr === "\u2014") {
      return dateFormatted;
    }

    const timeFormatted = formatTimeSlot(timeStr);
    return `${dateFormatted} at ${timeFormatted}`;
  } catch {
    return dateStr;
  }
}

function formatPreferredSchedule(dateStr?: string, timeStr?: string): string {
  if (!dateStr) return "N/A";
  try {
    let cleanDate = dateStr;
    let cleanTime = timeStr && timeStr !== "—" && timeStr !== "\u2014" ? timeStr.trim() : "";
    if (dateStr.includes("T")) {
      const parts = dateStr.split("T");
      cleanDate = parts[0];
      if (!cleanTime && parts[1]) {
        cleanTime = parts[1].slice(0, 5);
      }
    }
    const [y, m, d] = cleanDate.split("-").map(Number);
    if (!y || !m || !d) return dateStr;

    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    if (isNaN(dt.getTime())) return dateStr;

    const dateFormatted = dt.toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    if (!cleanTime) return dateFormatted;

    const timeFormatted = formatTimeSlot(cleanTime);
    return `${dateFormatted} at ${timeFormatted}`;
  } catch {
    return dateStr || "N/A";
  }
}

function formatRequestedDate(createdAtStr?: string): string {
  if (!createdAtStr) return "N/A";
  try {
    const dt = new Date(createdAtStr);
    if (isNaN(dt.getTime())) return createdAtStr;

    const datePart = dt.toLocaleDateString("en-US", {
      timeZone: "Asia/Manila",
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    const timePart = dt.toLocaleTimeString("en-US", {
      timeZone: "Asia/Manila",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    return `${datePart} at ${timePart}`;
  } catch {
    return createdAtStr || "N/A";
  }
}

function formatPatientId(appt: AppointmentRecord): string {
  const year = appt.createdAt ? new Date(appt.createdAt).getFullYear() : 2026;
  const digits = appt.id.replace(/\D/g, "");
  const num = digits.length >= 4
    ? digits.slice(-4)
    : (appt.queueNumber ? String(appt.queueNumber).padStart(4, "0") : appt.id.slice(0, 4).toUpperCase());
  return `P-${year}-${num}`;
}

function formatTimeSlot(timeStr: string): string {
  if (!timeStr) return "";
  if (timeStr.includes("AM") || timeStr.includes("PM")) return timeStr;
  try {
    const [h, m] = timeStr.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
  } catch {
    return timeStr;
  }
}

function getConditionDetail(conditionId?: string) {
  return skinConditions.find((c) => c.id === conditionId);
}

export default function DoctorAppointmentsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { doctorName: _doctorName, appointments: allAppointments, loading, submitDoctorReview } = useDoctorAppointments();
  const [tab, setTab] = useState<"pending" | "reviewed">("pending");
  const [sortOrder, setSortOrder] = useState<"newest" | "name">("newest");
  const [reviewModal, setReviewModal] = useState<ReviewModal | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successInfo, setSuccessInfo] = useState<{
    patientName: string;
    decision: "approved" | "rejected";
    date: string;
    time: string;
    diagnosis?: string;
  } | null>(null);

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

  const isGenericPlaceholder = (str?: string) =>
    !str ||
    str.toLowerCase().includes("general dermatol") ||
    str.toLowerCase().includes("general consult");

  const openReview = (appt: AppointmentRecord, defaultDecision?: "approved" | "rejected") => {
    const isDirect = isDirectBooking(appt);
    const initialDiagnosis = appt.doctorDiagnosis && !isGenericPlaceholder(appt.doctorDiagnosis)
      ? appt.doctorDiagnosis
      : (!isDirect && appt.aiConditionName && !isGenericPlaceholder(appt.aiConditionName) ? appt.aiConditionName : "");

    setReviewModal({
      appointment: appt,
      decision: defaultDecision || null,
      diagnosis: initialDiagnosis,
      note: "",
      showAnalysis: false,
    });
    setSubmitError("");
  };

  useEffect(() => {
    const reviewId = searchParams.get("review");
    if (!reviewId || loading || reviewModal) return;

    const appointment = allAppointments.find((appt) => appt.id === reviewId);
    if (!appointment) return;

    openReview(appointment);
    setSearchParams({}, { replace: true });
  }, [searchParams, loading, allAppointments, reviewModal, setSearchParams]);

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
    const appt = reviewModal.appointment;
    const dec = reviewModal.decision;
    const rawDiag = reviewModal.diagnosis.trim();
    const diagnosisText = !isGenericPlaceholder(rawDiag) ? rawDiag : "";

    try {
      await submitDoctorReview(
        appt.id,
        dec,
        dec === "approved" ? diagnosisText : "",
        reviewModal.note.trim()
      );
      setReviewModal(null);
      setSuccessInfo({
        patientName: appt.patientName || "Not provided",
        decision: dec,
        date: appt.date,
        time: appt.time,
        diagnosis: diagnosisText,
      });
    } catch (e: any) {
      setSubmitError(e?.message || "Failed to submit review. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const filteredList = useMemo(() => {
    const list = [...(tab === "pending" ? pendingReview : reviewed)];
    if (sortOrder === "name") {
      list.sort((a, b) =>
        (a.patientName || "").localeCompare(b.patientName || "", undefined, { sensitivity: "base" })
      );
    } else {
      list.sort((a, b) => {
        const timeA = new Date(a.createdAt || a.date || 0).getTime();
        const timeB = new Date(b.createdAt || b.date || 0).getTime();
        return timeB - timeA;
      });
    }
    return list;
  }, [tab, pendingReview, reviewed, sortOrder]);

  if (loading) {
    return (
      <div className="py-24 text-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-3" />
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
          Review incoming patient cases assigned to you by the clinic. When you accept, the consultation schedule is finalized immediately and added to your upcoming calendar. If you decline, your clinic will be notified to re-assign another doctor.
        </p>
      </div>

      {/* Tabs */}

      <div className="flex gap-2 border-b border-slate-200/80">
        {(["pending", "reviewed"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-semibold capitalize border-b-2 transition-colors cursor-pointer ${
              tab === t
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "pending" ? "Awaiting Your Review" : "All Reviewed"}
            <span
              className={`ml-2 text-[11px] px-2 py-0.5 rounded-full font-bold ${
                tab === t ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-500"
              }`}
            >
              {t === "pending" ? pendingReview.length : reviewed.length}
            </span>
          </button>
        ))}
      </div>

      {/* Table Card matching layout */}
      {/* Patient Table Card */}
<div className="grid grid-cols-1 gap-6">
  <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">

    {/* Card Header */}
    <div className="flex items-center justify-between p-5 border-b border-slate-100">
      {/* Table Section Title */}
    <div className="px-5 py-4 border-b border-slate-100">
      <h2 className="text-base font-bold text-slate-900">
        {tab === "pending"
          ? "Patients Awaiting Your Review"
          : "All Reviewed Patients"}
      </h2>
    </div>

      {/* Sort */}
      <button
        type="button"
        onClick={() =>
          setSortOrder((prev) =>
            prev === "newest" ? "name" : "newest"
          )
        }
        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
      >
        <span>
          Sort: {sortOrder === "newest" ? "Newest" : "A - Z"}
        </span>

        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>
    </div>


    {/* Responsive Table */}
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[1100px] text-left text-xs">

        {/* Table Header */}
        <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 tracking-wider">
          <tr>
            <th className="py-3.5 px-5 font-semibold whitespace-nowrap">
              PATIENT NAME
            </th>

            <th className="py-3.5 px-4 font-semibold whitespace-nowrap">
              AGE / GENDER
            </th>

            <th className="py-3.5 px-4 font-semibold whitespace-nowrap">
              REASON FOR VISIT
            </th>

            <th className="py-3.5 px-4 font-semibold whitespace-nowrap">
              PREFERRED SCHEDULE
            </th>

            <th className="py-3.5 px-4 font-semibold whitespace-nowrap">
              REQUESTED DATE
            </th>

            <th className="py-3.5 px-4 font-semibold whitespace-nowrap">
              STATUS
            </th>

            <th className="py-3.5 px-5 font-semibold text-center whitespace-nowrap">
              ACTIONS
            </th>
          </tr>
        </thead>

        {/* Table Body */}
        <tbody className="divide-y divide-slate-100 bg-white">

          {filteredList.length === 0 ? (
            <tr>
              <td colSpan={7} className="py-16 px-4 text-center">

                <Calendar className="w-9 h-9 text-slate-300 mx-auto mb-2" />

                <p className="text-sm font-semibold text-slate-700">
                  {tab === "pending"
                    ? "No patient cases currently awaiting your review"
                    : "No reviewed appointments recorded"}
                </p>

                <p className="text-xs text-slate-400 mt-1">
                  {tab === "pending"
                    ? "New appointments assigned by your clinic triage team will appear here."
                    : "Your clinical review decisions will be archived here."}
                </p>

              </td>
            </tr>
          ) : (
            filteredList.map((appt) => {

              const isCompleted =
                appt.status === "completed" || appt.doctorDone;

              const isApproved =
                appt.doctorStatus === "approved" ||
                appt.status === "scheduled" ||
                appt.status === "confirmed";

              const isRejected =
                appt.doctorStatus === "rejected" ||
                appt.status === "rejected";

              return (
                <tr
                  key={appt.id}
                  className="hover:bg-slate-50/70 transition-colors"
                >

                  {/* Patient Name */}
                  <td className="py-4 px-5">
                    <div className="flex items-center gap-3 min-w-[220px]">

                      <img
                        src={
                          appt.patientAvatar ||
                          `https://ui-avatars.com/api/?name=${encodeURIComponent(
                            appt.patientName || "P"
                          )}&background=EFF6FF&color=2563EB`
                        }
                        alt={appt.patientName || "Patient"}
                        className="w-10 h-10 rounded-full object-cover border border-slate-200 shrink-0 shadow-2xs"
                      />

                      <div className="min-w-0">
                        <p className="font-bold text-slate-900 text-sm truncate">
                          {appt.patientName || "Anonymous Patient"}
                        </p>

                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Patient ID: {formatPatientId(appt)}
                        </p>
                      </div>

                    </div>
                  </td>

                  {/* Age / Gender */}
                  <td className="py-4 px-4">
                    <div className="min-w-[110px]">
                      <p className="text-slate-800 font-medium">
                        {appt.patientAge
                          ? `${appt.patientAge} years old`
                          : "\u2014"}
                      </p>

                      <p className="text-slate-500 mt-0.5">
                        {appt.patientGender || "\u2014"}
                      </p>
                    </div>
                  </td>

                  {/* Reason */}
                  <td className="py-4 px-4">
                    <p className="text-slate-700 max-w-[220px] line-clamp-2 leading-relaxed">
                      {appt.notes ||
                        appt.conditionName ||
                        appt.aiConditionName ||
                        "Consultation Request"}
                    </p>
                  </td>

                  {/* Preferred Schedule */}
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-1.5 text-slate-700 font-medium whitespace-nowrap">
                      <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />

                      <span>
                        {formatPreferredSchedule(
                          appt.date,
                          appt.time
                        )}
                      </span>
                    </div>
                  </td>

                  {/* Requested Date */}
                  <td className="py-4 px-4">
                    <span className="text-slate-700 font-medium whitespace-nowrap">
                      {formatRequestedDate(appt.createdAt)}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="py-4 px-4">
                    {isCompleted ? (
                      <span className="inline-flex px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
                        Completed
                      </span>
                    ) : isApproved ? (
                      <span className="inline-flex px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
                        Accepted
                      </span>
                    ) : isRejected ? (
                      <span className="inline-flex px-3 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200 whitespace-nowrap">
                        Declined
                      </span>
                    ) : (
                      <span className="inline-flex px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap">
                        Awaiting Review
                      </span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="py-4 px-5 text-center">
                    {tab === "pending" &&
                    !isApproved &&
                    !isRejected &&
                    !isCompleted ? (
                      <button
                        type="button"
                        onClick={() =>
                          openReview(appt, "approved")
                        }
                        className="inline-flex items-center justify-center px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white transition-colors cursor-pointer shadow-xs whitespace-nowrap"
                      >
                        View Detail
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openReview(appt)}
                        className="inline-flex items-center justify-center px-3.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        View Details
                      </button>
                    )}
                  </td>

                </tr>
              );
            })
          )}

        </tbody>
      </table>
    </div>
  </div>
</div>

      {/* Review Modal */}
      <AnimatePresence>
        {reviewModal && (() => {
          const isDirect = isDirectBooking(reviewModal.appointment);
          const cond = getConditionDetail(reviewModal.appointment.conditionId);
          const isAlreadyReviewed =
            tab === "reviewed" ||
            reviewModal.appointment.doctorStatus === "approved" ||
            reviewModal.appointment.doctorStatus === "rejected" ||
            reviewModal.appointment.status === "completed" ||
            reviewModal.appointment.doctorDone;

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
                            : "text-slate-700 bg-slate-100 border-slate-200"
                        }`}
                      >
                        {isDirect
                          ? "Direct Consultation Request"
                          : reviewModal.appointment.conditionName || "Not provided"}
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
                <div className="overflow-y-auto flex-1 p-6 space-y-5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                  {/* Patient's Selected Schedule Banner */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Patient's Preferred Schedule</p>
                      <p className="text-sm font-bold text-slate-900 truncate">
                        {formatScheduleDateTime(reviewModal.appointment.date, reviewModal.appointment.time)}
                      </p>
                    </div>
                    <span className="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                      Selected Slot
                    </span>
                  </div>

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
                      {
                        label: "Emergency",
                        value: reviewModal.appointment.emergencyContactName
                          ? `${reviewModal.appointment.emergencyContactName} ${reviewModal.appointment.emergencyRelationship ? `(${reviewModal.appointment.emergencyRelationship})` : ""} \u2022 ${reviewModal.appointment.emergencyContactPhone || ""}`
                          : undefined,
                      },
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
                  <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ClipboardList className="w-4 h-4 text-slate-600" />
                        <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                          Patient Symptoms &amp; Pre-Screening Questionnaire
                        </span>
                      </div>
                      {reviewModal.appointment.questionnaireAnswers && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200/70 text-slate-700">
                          {reviewModal.appointment.questionnaireAnswers.length} responses recorded
                        </span>
                      )}
                    </div>

                    <div className="p-4 space-y-2.5 max-h-56 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                      {reviewModal.appointment.questionnaireAnswers &&
                      reviewModal.appointment.questionnaireAnswers.length > 0 ? (
                        reviewModal.appointment.questionnaireAnswers.map((qa, idx) => (
                          <div
                            key={idx}
                            className="p-2.5 rounded-lg bg-slate-50/80 border border-slate-200/60 text-xs"
                          >
                            <p className="font-semibold text-slate-800 mb-1">
                              {idx + 1}. {qa.question}
                            </p>
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-slate-800 font-medium bg-white px-2 py-0.5 rounded-md border border-slate-200">
                                {qa.answer}
                              </span>
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
                      <LazySkinPhoto
                        pathOrUrl={reviewModal.appointment.skinPhotoUrl}
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
                    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
                      <button
                        type="button"
                        onClick={() =>
                          setReviewModal((prev) => (prev ? { ...prev, showAnalysis: !prev.showAnalysis } : prev))
                        }
                        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <ScanSearch className="w-4 h-4 text-slate-600" />
                          <span className="text-sm font-bold text-slate-800">AI Pre-Screening Analysis</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-800 font-bold border border-slate-300/60">
                            {reviewModal.appointment.aiConditionName || reviewModal.appointment.conditionName}
                          </span>
                        </div>
                        {reviewModal.showAnalysis ? (
                          <ChevronUp className="w-4 h-4 text-slate-600" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-600" />
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
                            <div className="px-4 py-4 space-y-3 border-t border-slate-200">
                              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2">
                                <p className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                                  Algorithm Suggestion
                                </p>
                                <div className="flex gap-2 items-center">
                                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide w-28 shrink-0">
                                    Condition
                                  </span>
                                  <span className="text-sm font-semibold text-slate-900">
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
                                      <div className="flex-1 bg-slate-200 rounded-full h-1.5">
                                        <div
                                          className="h-1.5 rounded-full bg-slate-700"
                                          style={{
                                            width: `${Math.min(reviewModal.appointment.aiConfidence, 100)}%`,
                                          }}
                                        />
                                      </div>
                                      <span className="text-xs font-bold text-slate-800">
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
                                      className="w-20 h-20 rounded-xl object-cover border border-slate-200 shrink-0"
                                    />
                                    <div>
                                      <p className="font-semibold text-slate-900">{cond.name}</p>
                                      {cond.filipinoName && (
                                        <p className="text-xs text-slate-500 italic mb-1">{cond.filipinoName}</p>
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

                  {/* Decision Section - Only shown for pending appointments awaiting review */}
                  {!isAlreadyReviewed ? (
                    <>
                      <div className="pt-2 border-t border-gray-100">
                        <p className="text-sm font-bold text-gray-900 mb-2">
                          Review &amp; Decision for this Schedule <span className="text-red-500">*</span>
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
                            Accept &amp; Finalize Schedule
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
                            Decline (Reassign)
                          </button>
                        </div>

                        {/* Explanatory Workflow Banners */}
                        {reviewModal.decision === "approved" && (
                          <div className="mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
                            <p className="leading-relaxed">
                              <strong>Accept &amp; Finalize Schedule:</strong> Confirming acceptance will <strong>immediately finalize and lock</strong> this consultation schedule. It will appear on your upcoming appointments calendar and clinic records.
                            </p>
                          </div>
                        )}

                        {reviewModal.decision === "rejected" && (
                          <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                            <p className="leading-relaxed">
                              <strong>Decline Referral:</strong> Declining will notify your clinic triage team to <strong>re-assign another doctor</strong> from your clinic roster.
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
                    </>
                  ) : (
                    /* Read-only Review Summary for Reviewed Patients */
                    <div className="pt-2 border-t border-gray-100">
                      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                            Clinical Review Decision
                          </span>
                          <span
                            className={`text-xs font-bold px-3 py-1 rounded-full border ${
                              reviewModal.appointment.doctorStatus === "approved" ||
                              reviewModal.appointment.status === "scheduled" ||
                              reviewModal.appointment.status === "confirmed" ||
                              reviewModal.appointment.status === "completed"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-red-50 text-red-700 border-red-200"
                            }`}
                          >
                            {reviewModal.appointment.doctorStatus === "approved" ||
                            reviewModal.appointment.status === "scheduled" ||
                            reviewModal.appointment.status === "confirmed" ||
                            reviewModal.appointment.status === "completed"
                              ? "Accepted & Finalized"
                              : "Declined"}
                          </span>
                        </div>
                        {reviewModal.appointment.doctorNote && (
                          <div className="pt-2 border-t border-slate-200/70 text-xs">
                            <span className="font-semibold text-slate-600">Review Note: </span>
                            <span className="text-slate-800 leading-relaxed">{reviewModal.appointment.doctorNote}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Modal Footer */}
                <div className="px-6 pb-6 pt-3 flex gap-3 shrink-0 border-t border-gray-100">
                  {isAlreadyReviewed ? (
                    <button
                      type="button"
                      onClick={() => setReviewModal(null)}
                      className="w-full py-3 rounded-xl border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      Close
                    </button>
                  ) : (
                    <>
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
                          "Decline & Send for Reassignment"
                        ) : (
                          "Accept & Finalize Schedule"
                        )}
                      </button>
                    </>
                  )}
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>

      {/* Review Submission Feedback Modal */}
      <AnimatePresence>
        {successInfo && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 sm:p-7 text-center space-y-4"
            >
              <div className={`w-14 h-14 rounded-2xl mx-auto flex items-center justify-center shadow-xs ${
                successInfo.decision === "approved"
                  ? "bg-emerald-100 text-emerald-600"
                  : "bg-red-100 text-red-600"
              }`}>
                {successInfo.decision === "approved" ? (
                  <CheckCircle2 className="w-8 h-8" />
                ) : (
                  <XCircle className="w-8 h-8" />
                )}
              </div>

              <div>
                <h3 className="text-xl font-display font-bold text-gray-900">
                  {successInfo.decision === "approved"
                    ? "Consultation Accepted & Finalized!"
                    : "Patient Referral Declined"}
                </h3>
                <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                  {successInfo.decision === "approved"
                    ? `${successInfo.patientName}'s appointment schedule has been locked and confirmed. The patient has been notified.`
                    : `${successInfo.patientName}'s referral was declined. Your clinic triage team has been alerted to re-assign another doctor.`}
                </p>
              </div>

              {/* Consultation Details Card */}
              {successInfo.decision === "approved" && (
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-left space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Patient</span>
                    <span className="font-bold text-gray-900">{successInfo.patientName}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Confirmed Schedule</span>
                    <span className="font-semibold text-slate-900">
                      {formatScheduleDateTime(successInfo.date, successInfo.time)}
                    </span>
                  </div>
                  {successInfo.diagnosis && (
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Assessment</span>
                      <span className="font-medium text-gray-700 truncate max-w-[200px]">{successInfo.diagnosis}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-200">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Next Step</span>
                    <span className="text-[11px] font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                      Assigned to Your Calendar
                    </span>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
                {successInfo.decision === "approved" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setSuccessInfo(null);
                        navigate("/doctor/scheduled");
                      }}
                      className="flex-1 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Calendar className="w-4 h-4" /> Go to Assigned Appointments
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSuccessInfo(null);
                        setTab("reviewed");
                      }}
                      className="py-3 px-4 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-semibold transition-all cursor-pointer"
                    >
                      View All Reviewed
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSuccessInfo(null)}
                    className="w-full py-2.5 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-xs font-bold transition-all cursor-pointer"
                  >
                    Close
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
