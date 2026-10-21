import { useState, useEffect, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/lib/supabaseClient";
import { logAuditEvent } from "@/utils/auditLogger";
import { useAuth } from "@/context/AuthContext";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { DoctorAvatar } from "@/components/common/DoctorAvatar";
import {
  CheckCircle2,
  Clock,
  Calendar,
  Stethoscope,
  AlertTriangle,
  AlertCircle,
  UserCheck,
  X,
  RotateCcw,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import type { AppointmentHistoryEntry } from "@/lib/schedulingService";
import { ModalPortal } from "@/components/common/ModalPortal";
import { SelectAlternateDoctorModal } from "./SelectAlternateDoctorModal";

interface Appointment {
  id: string;
  clinicId?: string | number;
  clinicName: string;
  doctor: string;
  assignedDoctorName?: string;
  assignedDoctorId?: string;
  previousDoctorId?: string;
  previousDoctorName?: string;
  doctorStatus?: "pending-review" | "approved" | "rejected";
  hasDate: boolean;
  date: string;
  time: string;
  batchTime?: string;
  queueNumber?: number;
  checkInStatus?: "scheduled" | "arrived" | "in-consultation" | "completed" | "no-show";
  isWalkIn?: boolean;
  status: "Pending" | "Scheduled" | "Rejected" | "Completed" | "Cancelled";
  clinicNote?: string;
  doctorNote?: string;
  doctorDiagnosis?: string;
  rejectionReason?: string;
  createdAt?: string;
  doctorReviewedAt?: string;
  userId?: string;
  patientEmail?: string;
  primaryScanId?: string;
  rescheduleRequested?: boolean;
  rescheduleDate?: string;
  rescheduleTime?: string;
  rescheduleReason?: string;
  needsPatientReschedule?: boolean;
  appointmentHistory?: AppointmentHistoryEntry[];
  paymentStatus?: "pending_hold" | "paid" | "failed" | "cancelled" | "expired" | "exempt";
  paymentAmount?: number;
  paymentReference?: string;
  paidAt?: string;
}

const STEPS = ["Request Sent", "Doctor Review", "Scheduled", "Completed"];

function getStepIndex(app: Appointment): number {
  if (app.status === "Completed") return 3;
  if (app.status === "Scheduled" || app.doctorStatus === "approved") return 2;
  if (app.status === "Pending") return 1;
  return 0;
}

function StatusBadge({ app }: { app: Appointment }) {
  if (app.checkInStatus === "no-show") {
    return (
      <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-300">
        Missed / No-Show
      </span>
    );
  }

  if (app.status === "Completed") {
    return (
      <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider bg-green-100 text-green-700 border border-green-200">
        Completed
      </span>
    );
  }

  if (app.rescheduleRequested) {
    return (
      <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider bg-purple-100 text-purple-800 border border-purple-200">
        Reschedule Under Review
      </span>
    );
  }
  if (app.status === "Scheduled" || app.doctorStatus === "approved") {
    return (
      <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
        Confirmed &amp; Scheduled
      </span>
    );
  }
  if (app.status === "Rejected") {
    return (
      <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider bg-red-100 text-red-700 border border-red-200">
        Declined
      </span>
    );
  }
  if (app.status === "Cancelled") {
    return (
      <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider bg-gray-100 text-gray-600 border border-gray-200">
        Cancelled
      </span>
    );
  }

  // Pending / Review states
  if (app.doctorStatus === "rejected") {
    return (
      <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-200">
        Action Required • Select Doctor
      </span>
    );
  }
  if (app.assignedDoctorId && app.doctorStatus === "pending-review") {
    return (
      <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider bg-sky-100 text-sky-800 border border-sky-200">
        Under Doctor Review
      </span>
    );
  }
  return (
    <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-200">
      Awaiting Doctor Assignment
    </span>
  );
}

function StatusTracker({ app }: { app: Appointment }) {
  const isCancelled = app.status === "Cancelled" || app.status === "Rejected" || app.checkInStatus === "no-show";
  const activeStep = isCancelled ? -1 : getStepIndex(app);

  const isConfirmedScheduled = app.status === "Scheduled" || app.doctorStatus === "approved";
  const isUnderDoctorReview = !!app.assignedDoctorId && app.doctorStatus === "pending-review";
  const isDoctorDeclined = app.doctorStatus === "rejected";

  return (
    <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50/60 p-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Appointment Progress</p>
        <StatusBadge app={app} />
      </div>

      {isCancelled ? (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-3.5">
          <svg className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-red-800">
              {app.checkInStatus === "no-show"
                ? "Appointment Marked as Missed / No-Show"
                : `Appointment ${app.status === "Rejected" ? "Declined" : "Cancelled"}`}
            </p>
            <p className="text-xs text-red-600 mt-0.5 leading-relaxed">
              {app.checkInStatus === "no-show"
                ? <span>You did not attend this scheduled consultation with <strong className="inline-flex items-center gap-1 font-semibold text-gray-900">{app.clinicName} <VerifiedBadge size={13} className="w-3.5 h-3.5" /></strong> on {app.date} at {app.time || "scheduled time"}. Please contact the clinic or schedule a new appointment.</span>
                : app.status === "Rejected"
                  ? <span>Your appointment request with <strong className="inline-flex items-center gap-1 font-semibold text-gray-900">{app.clinicName} <VerifiedBadge size={13} className="w-3.5 h-3.5" /></strong> was declined.</span>
                  : <span>This appointment with <strong className="inline-flex items-center gap-1 font-semibold text-gray-900">{app.clinicName} <VerifiedBadge size={13} className="w-3.5 h-3.5" /></strong> was cancelled.</span>}
            </p>
            {app.doctorDiagnosis && (
              <div className="mt-2 rounded-lg bg-white border border-red-200 p-2.5 shadow-2xs">
                <div className="flex items-center gap-1 text-red-700 font-bold text-[10px] uppercase tracking-wider mb-0.5">
                  <Stethoscope className="w-3.5 h-3.5 text-red-500" />
                  <span>Doctor's Assessment / Diagnosis:</span>
                </div>
                <p className="text-xs text-gray-900 font-semibold leading-relaxed">
                  {app.doctorDiagnosis}
                </p>
                {app.doctorNote && (
                  <p className="text-xs text-gray-600 font-medium leading-relaxed mt-0.5">
                    "{app.doctorNote}"
                  </p>
                )}
              </div>
            )}
            {app.clinicNote && (
              <div className="mt-2 rounded-lg bg-white border border-red-200 p-2.5 shadow-2xs">
                <div className="flex items-center gap-1 text-red-700 font-bold text-[10px] uppercase tracking-wider mb-0.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                  <span>Reason / Note from Clinic:</span>
                </div>
                <p className="text-xs text-gray-800 font-medium leading-relaxed">
                  "{app.clinicNote}"
                </p>
              </div>
            )}
            <p className="text-[11px] text-gray-500 mt-2">
              You may search for other clinics and book a new consultation anytime.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="relative flex items-start mb-4 px-2">
            <div className="absolute top-2.5 left-[calc(3.5rem/2)] right-[calc(3.5rem/2)] h-0.5 bg-gray-200 z-0" />
            <div
              className="absolute top-2.5 left-[calc(3.5rem/2)] h-0.5 bg-magenta-500 z-0 transition-all duration-700"
              style={{
                width: activeStep > 0
                  ? `calc(${(activeStep / (STEPS.length - 1)) * 100}% - 0px)`
                  : "0%",
              }}
            />
            <div className="relative z-10 flex w-full justify-between">
              {STEPS.map((step, i) => {
                const isDone = i <= activeStep;
                const isActive = i === activeStep;
                return (
                  <div key={step} className="flex flex-col items-center gap-1.5 w-14">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${isDone
                        ? isActive
                          ? "bg-magenta-600 border-magenta-500 scale-105 shadow-2xs"
                          : "bg-magenta-500 border-magenta-400"
                        : "bg-white border-gray-200"
                        }`}
                    >
                      {isDone ? (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <div className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                      )}
                    </div>
                    <span
                      className={`text-[9px] font-semibold text-center leading-tight uppercase tracking-wide ${isDone ? "text-magenta-700" : "text-gray-400"
                        }`}
                    >
                      {step}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Dynamic Workflow Prompt Banners */}
          <div className="space-y-2.5">


            {/* Rule 1: Reschedule Request Pending Clinic Review Banner */}
            {app.rescheduleRequested && (
              <div className="rounded-2xl border border-purple-200 bg-purple-50/80 p-4 shadow-xs space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 text-purple-900 font-bold text-xs uppercase tracking-wider">
                    <Clock className="w-4 h-4 text-purple-600 shrink-0" />
                    <span>Reschedule Request Under Clinic Review</span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full bg-purple-200 text-purple-900 font-bold text-[10px] uppercase">
                    Awaiting Clinic Review
                  </span>
                </div>
                <div className="text-xs text-purple-900 space-y-1">
                  <p>
                    Requested New Slot: <strong className="text-purple-950">{app.rescheduleDate}</strong> at <strong className="text-purple-950">{app.rescheduleTime}</strong>
                  </p>
                  {app.rescheduleReason && (
                    <p className="text-[11px] text-purple-800 italic">
                      Reason: "{app.rescheduleReason}"
                    </p>
                  )}
                </div>
                <div className="p-2.5 rounded-xl bg-white/90 border border-purple-100 text-[11px] text-purple-800 leading-relaxed">
                  🔒 <strong>Current Slot Protected:</strong> Your appointment for <strong className="text-purple-950">{app.date} at {app.time}</strong> remains reserved and will not be changed unless the clinic approves this requested slot.
                </div>
              </div>
            )}

            {Boolean(isConfirmedScheduled || app.time || app.batchTime) && (
              <div className="rounded-2xl border border-magenta-200/90 bg-white p-3.5 shadow-2xs space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-magenta-800">
                    Consultation Schedule
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 font-medium">Scheduled Time:</span>
                  <strong className="text-gray-900 font-bold">
                    {app.time || (app.batchTime ? `${app.batchTime} Batch` : "Pending")}
                  </strong>
                </div>

                {/* Live Check-in Status */}
                {isConfirmedScheduled ? (
                  app.checkInStatus === "arrived" || app.checkInStatus === "in-consultation" ? (
                    <div className="p-2.5 rounded-xl bg-sky-50 border border-sky-200 text-sky-900 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-sky-500 shrink-0" />
                      <div>
                        <p className="text-xs font-bold text-sky-900">
                          Checked in at Clinic Lobby
                        </p>
                        <p className="text-[10px] text-sky-700">
                          Please wait in the lobby — the clinic will call you when the doctor is ready.
                        </p>
                      </div>
                    </div>
                  ) : app.checkInStatus === "no-show" ? (
                    <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 space-y-1">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                        <p className="text-xs font-bold text-rose-900">
                          Marked Absent / No-Show
                        </p>
                      </div>
                      <p className="text-[11px] text-rose-700 leading-relaxed pl-6">
                        You did not arrive during your scheduled time ({app.time || (app.batchTime ? `${app.batchTime} Batch` : "")}). Please rebook or coordinate with the clinic front desk.
                      </p>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-slate-50 border border-gray-100 text-gray-700 space-y-1">
                      <div className="flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-magenta-500 shrink-0" />
                        <p className="text-[11px] text-gray-600">
                          Expected Arrival: <strong className="text-gray-900">{app.time || (app.batchTime ? `${app.batchTime} Batch` : "")}</strong>. Please check in with the clinic receptionist upon arrival.
                        </p>
                      </div>
                      <p className="text-[10px] text-emerald-700 font-semibold pl-5.5">
                        💵 Consultation fee is paid physically at the clinic counter upon arrival.
                      </p>
                    </div>
                  )
                ) : (
                  <div className="p-2.5 rounded-xl bg-amber-50/80 border border-amber-200 text-amber-900 flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <p className="text-[11px] text-amber-800">
                      Appointment requested. Awaiting doctor's review &amp; confirmation.
                    </p>
                  </div>
                )}
              </div>
            )}

            {app.status === "Completed" ? (
              <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-emerald-900">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                <p className="text-[11px] leading-relaxed">
                  Your physical consultation with <strong className="inline-flex items-center gap-1 text-emerald-950 font-bold">{app.clinicName} <VerifiedBadge size={12} className="w-3 h-3" /></strong> has been completed.
                </p>
              </div>
            ) : isConfirmedScheduled ? (
              <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl p-3 text-blue-900">
                <Calendar className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                <p className="text-[11px] leading-relaxed">
                  Your appointment with <strong className="inline-flex items-center gap-1 text-blue-950 font-bold">{app.clinicName} <VerifiedBadge size={12} className="w-3 h-3" /></strong> is confirmed and finalized on <strong className="text-blue-950">{app.date}</strong> at <strong className="text-blue-950">{app.time}</strong> with <strong className="text-blue-950">{app.doctor}</strong>. Please arrive 10 minutes prior to your consultation.
                </p>
              </div>
            ) : isDoctorDeclined ? (
              (() => {
                const declinedTimestamp = app.doctorReviewedAt
                  ? new Date(app.doctorReviewedAt).getTime()
                  : app.createdAt
                  ? new Date(app.createdAt).getTime()
                  : Date.now();
                const remainingMs = Math.max(0, declinedTimestamp + 24 * 3600 * 1000 - Date.now());
                const is24HourExpired = remainingMs <= 0;
                const hoursLeft = Math.floor(remainingMs / (1000 * 60 * 60));
                const minsLeft = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
                const timeRemainingStr = hoursLeft > 0 ? `${hoursLeft}h ${minsLeft}m` : `${minsLeft}m`;

                return is24HourExpired ? (
                  <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200 rounded-xl p-3 text-rose-900">
                    <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <p className="text-xs font-bold text-rose-800">Clinic Reassigning Doctor</p>
                      <p className="text-[11px] text-rose-700 mt-0.5 leading-relaxed">
                        The 24-hour alternate doctor selection period has expired. <strong className="inline-flex items-center gap-1 text-rose-950 font-semibold">{app.clinicName} <VerifiedBadge size={12} className="w-3 h-3" /></strong> will reassign an available doctor on your behalf.
                      </p>
                      {app.doctorNote && (
                        <p className="text-[11px] text-rose-800/80 italic mt-1.5 pt-1.5 border-t border-rose-200/70">
                          <strong>Doctor's Reason:</strong> "{app.doctorNote}"
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-rose-200 bg-rose-50/90 p-3.5 text-rose-950 shadow-2xs space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-1.5 text-rose-900 font-bold text-xs uppercase tracking-wider">
                        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>Action Required: Select Alternate Doctor</span>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-900 border border-rose-200 font-bold text-[10px] flex items-center gap-1">
                        <Clock className="w-3 h-3 text-rose-600" />
                        <span>{timeRemainingStr} remaining</span>
                      </span>
                    </div>
                    <p className="text-[11px] text-rose-800 leading-relaxed">
                      The previously assigned doctor was unavailable for your requested schedule. Please select an alternate dermatologist within <strong>{timeRemainingStr}</strong> to keep your booked consultation schedule at <strong>no extra charge</strong>.
                    </p>
                    {app.doctorNote && (
                      <p className="text-[11px] text-rose-900/90 italic bg-white/80 rounded-lg p-2 border border-rose-200/70">
                        <span className="font-semibold text-rose-950 not-italic">Doctor's Note:</span> "{app.doctorNote}"
                      </p>
                    )}
                  </div>
                );
              })()
            ) : isUnderDoctorReview ? (
              <div className="flex items-start gap-2 bg-sky-50 border border-sky-200 rounded-xl p-3 text-sky-900">
                <Stethoscope className="w-4 h-4 text-sky-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-sky-800">Under Pre-Consultation Review</p>
                  <p className="text-[11px] text-sky-700 mt-0.5 leading-relaxed">
                    Assigned to <strong className="text-sky-950 font-semibold">{app.doctor}</strong> at <strong className="inline-flex items-center gap-1 text-sky-950 font-semibold">{app.clinicName} <VerifiedBadge size={12} className="w-3 h-3" /></strong>. The doctor is reviewing your skin concern and chosen schedule (<span className="font-semibold text-sky-950">{app.date} at {app.time}</span>). Once accepted, your schedule is finalized!
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-900">
                <Clock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-amber-800">Clinic Assignment Pending</p>
                  <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
                    Your appointment request for <strong className="text-amber-950 font-semibold">{app.date} at {app.time}</strong> was received by <strong className="inline-flex items-center gap-1 text-amber-950 font-semibold">{app.clinicName} <VerifiedBadge size={12} className="w-3 h-3" /></strong>. The clinic is assigning a dermatologist to review and finalize your schedule.
                  </p>
                </div>
              </div>
            )}

            {/* Doctor Clinical Diagnosis / Assessment Card (only when a real clinical diagnosis exists and doctor did not decline) */}
            {!isDoctorDeclined &&
              app.status !== "Cancelled" &&
              app.status !== "Rejected" &&
              app.doctorDiagnosis &&
              !app.doctorDiagnosis.toLowerCase().includes("general dermatol") &&
              !app.doctorDiagnosis.toLowerCase().includes("general consult") && (
                <div className="rounded-xl bg-gradient-to-r from-blue-50/90 to-indigo-50/90 border border-blue-200 p-3.5 shadow-2xs">
                  <div className="flex items-center gap-1.5 text-blue-800 font-bold text-[10px] uppercase tracking-wider mb-1">
                    <Stethoscope className="w-3.5 h-3.5 text-blue-600" />
                    <span>Dermatologist Clinical Assessment &amp; Diagnosis</span>
                  </div>
                  <p className="text-sm font-bold text-blue-950">{app.doctorDiagnosis}</p>
                  {app.doctorNote && (
                    <p className="text-xs text-blue-800/90 mt-1 pt-1 border-t border-blue-200/60 leading-relaxed">
                      <span className="font-semibold text-blue-900">Clinical Notes / Advice:</span> {app.doctorNote}
                    </p>
                  )}
                </div>
              )}

          </div>
        </>
      )}
    </div>
  );
}

function AppointmentCard({
  app,
  onCancel,
  onReschedule,
  onWithdrawReschedule,
  onSelectAlternateDoctor,
}: {
  app: Appointment;
  onCancel?: (app: Appointment) => void;
  onReschedule?: (app: Appointment) => void;
  onWithdrawReschedule?: (app: Appointment) => void;
  onSelectAlternateDoctor?: (app: Appointment) => void;
}) {
  const isFinalized = app.status === "Scheduled" || app.doctorStatus === "approved" || app.status === "Completed";
  const isConfirmed = app.status === "Scheduled" || app.status === "Completed";
  const isTerminal = app.status === "Completed" || app.status === "Cancelled" || app.status === "Rejected";
  // Pending appointments can be cancelled
  const canCancel = app.status === "Pending" && !isFinalized;
  // Patient can request reschedule as long as consultation is active (Rule 1)
  const canRequestReschedule = !isTerminal && app.checkInStatus !== "no-show";

  const rawStatus = (app.status || "").toLowerCase();
  const docStatus = (app.doctorStatus || "").toLowerCase();
  const isDeclined =
    docStatus === "rejected" ||
    rawStatus === "rejected" ||
    rawStatus === "declined" ||
    rawStatus === "clinic_reassigning" ||
    rawStatus === "needs_doctor";

  const declinedTimestamp = app.doctorReviewedAt
    ? new Date(app.doctorReviewedAt).getTime()
    : app.createdAt
    ? new Date(app.createdAt).getTime()
    : Date.now();
  const is24HourExpired = Date.now() - (isNaN(declinedTimestamp) ? Date.now() : declinedTimestamp) > 24 * 3600 * 1000;
  const canChooseAlternateDoctor = isDeclined && !is24HourExpired;

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-xs hover:border-gray-200 transition-all duration-200 overflow-hidden">
      <div className="p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Clinic</p>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <p className="text-sm font-semibold text-gray-900">{app.clinicName}</p>
              <VerifiedBadge size={15} className="w-3.5 h-3.5" title="Verified Clinic" />
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Doctor</p>
            <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
              {app.assignedDoctorId && app.doctor !== "To be assigned" ? (
                <DoctorAvatar
                  doctorId={app.assignedDoctorId}
                  name={app.doctor}
                  className="w-5 h-5 rounded-full border border-gray-200 shrink-0 text-[8px] font-bold"
                />
              ) : null}
              <p className="text-sm font-semibold text-gray-900 truncate">{app.doctor || "To be assigned"}</p>
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              {isConfirmed ? "Confirmed Date" : "Requested Date"}
            </p>
            <p className="text-sm font-semibold text-gray-900 mt-0.5">{app.date}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              {isConfirmed ? "Confirmed Time" : "Requested Time"}
            </p>
            <p className="text-sm font-semibold text-gray-900 mt-0.5">{app.time}</p>
          </div>
          {app.paymentReference && (
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Payment</p>
              <p className="text-xs font-semibold text-emerald-700 mt-0.5">
                Paid Online {app.paymentAmount ? `(₱${app.paymentAmount.toFixed(2)})` : ""}
              </p>
            </div>
          )}
        </div>

        <StatusTracker app={app} />

        {/* Action Controls */}
        <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Primary 'Select Alternate Doctor' button styled in brand #A21D5C */}
            {canChooseAlternateDoctor && (
              <button
                type="button"
                onClick={() => onSelectAlternateDoctor && onSelectAlternateDoctor(app)}
                className="text-xs font-bold text-white bg-[#A21D5C] hover:bg-[#88184d] px-3.5 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-[0.98]"
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Select Alternate Doctor</span>
              </button>
            )}

            {app.rescheduleRequested ? (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => onWithdrawReschedule && onWithdrawReschedule(app)}
                  className="text-xs font-semibold text-rose-600 hover:text-rose-700 px-3 py-1.5 rounded-xl border border-rose-200 hover:bg-rose-50 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Withdraw Reschedule Request</span>
                </button>
                <button
                  type="button"
                  onClick={() => onReschedule && onReschedule(app)}
                  className="text-xs font-semibold text-purple-700 hover:text-purple-800 px-3 py-1.5 rounded-xl border border-purple-200 hover:bg-purple-50 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Change Requested Slot</span>
                </button>
              </div>
            ) : canRequestReschedule && !isDeclined ? (
              <button
                type="button"
                onClick={() => onReschedule && onReschedule(app)}
                className="text-xs font-semibold text-magenta-700 hover:text-magenta-800 px-3.5 py-1.5 rounded-xl border border-magenta-200 hover:bg-magenta-50 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
              >
                <Calendar className="w-3.5 h-3.5 text-magenta-600" />
                <span>Request Reschedule</span>
              </button>
            ) : null}

            {isDeclined && is24HourExpired && (
              <div className="flex items-center gap-1.5 text-xs text-amber-700 font-medium">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>24-hour window expired • Clinic is assigning doctor</span>
              </div>
            )}
          </div>

          {canCancel && (
            <button
              type="button"
              onClick={() => onCancel && onCancel(app)}
              className="text-xs font-semibold text-rose-600 hover:text-rose-700 px-3.5 py-1.5 rounded-xl border border-rose-200 hover:bg-rose-50 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs ml-auto"
            >
              <span>Cancel Request</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function getCachedAppointments(): Appointment[] {
  try {
    const rawLocal = localStorage.getItem("dermai_clinic_appointments");
    if (!rawLocal) return [];
    const parsedLocal = JSON.parse(rawLocal);
    if (!Array.isArray(parsedLocal)) return [];
    return parsedLocal
      .map((localItem: any) => {
        const pDate = localItem.date ? new Date(localItem.date) : null;
        const isValid = pDate && !isNaN(pDate.getTime());
        let formattedLocalTime = "Time pending";
        if (localItem.time && localItem.time !== "Time pending") {
          if (localItem.time.includes("AM") || localItem.time.includes("PM")) {
            formattedLocalTime = localItem.time;
          } else if (localItem.time.includes(":")) {
            const [h, m] = localItem.time.split(":").map(Number);
            const ampm = (h || 0) >= 12 ? "PM" : "AM";
            const hr = (h || 0) % 12 || 12;
            formattedLocalTime = `${hr}:${String(m || 0).padStart(2, "0")} ${ampm}`;
          } else {
            formattedLocalTime = localItem.time;
          }
        } else if (isValid && localItem.date?.includes("T")) {
          formattedLocalTime = pDate.toLocaleTimeString("en-PH", {
            timeZone: "Asia/Manila",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          });
        }

        return {
          id: localItem.id || localItem.appointment_id,
          clinicId: localItem.clinicId || localItem.clinic_id,
          clinicName: localItem.clinicName || "Skin Clinic",
          doctor: localItem.doctor || (localItem.assignedDoctorName ? `Dr. ${localItem.assignedDoctorName.replace(/^dr\.\s*/i, "")}` : "To be assigned"),
          assignedDoctorName: localItem.assignedDoctorName,
          assignedDoctorId: localItem.assignedDoctorId,
          previousDoctorId: localItem.previousDoctorId,
          previousDoctorName: localItem.previousDoctorName,
          doctorStatus: localItem.doctorStatus,
          hasDate: Boolean(isValid || localItem.date),
          date: isValid
            ? pDate.toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" })
            : (localItem.date || "Date pending"),
          time: formattedLocalTime,
          status: (localItem.status === "cancelled" ? "Cancelled" : localItem.status === "confirmed" || localItem.status === "scheduled" || localItem.doctorStatus === "approved" ? "Scheduled" : localItem.status === "completed" ? "Completed" : localItem.status === "rejected" ? "Rejected" : "Pending") as Appointment["status"],
          clinicNote: localItem.clinicNote,
          doctorNote: localItem.doctorNote,
          doctorDiagnosis: localItem.conditionName || localItem.aiConditionName || localItem.doctorDiagnosis,
          createdAt: localItem.createdAt || new Date().toISOString(),
          userId: localItem.userId,
          patientEmail: localItem.patientEmail,
          primaryScanId: localItem.primaryScanId,
          rescheduleRequested: Boolean(localItem.rescheduleRequested || localItem.reschedule_requested),
          rescheduleDate: localItem.rescheduleDate || localItem.reschedule_date,
          rescheduleTime: localItem.rescheduleTime || localItem.reschedule_time,
          rescheduleReason: localItem.rescheduleReason || localItem.reschedule_reason,
          needsPatientReschedule: Boolean(localItem.needsPatientReschedule || localItem.needs_patient_reschedule),
          appointmentHistory: localItem.appointmentHistory || localItem.appointment_history || [],
          paymentStatus: localItem.paymentStatus || "paid",
          paymentAmount: localItem.paymentAmount ? Number(localItem.paymentAmount) : undefined,
          paymentReference: localItem.paymentReference || undefined,
          paidAt: localItem.paidAt || undefined,
        };
      })
      .filter((a: any) => {
        const paySt = String(a.paymentStatus || "").toLowerCase().trim();
        return paySt !== "pending_hold" && paySt !== "expired" && paySt !== "failed";
      });
  } catch {
    return [];
  }
}

const AppointmentStatusPage: React.FC = () => {
  const { user } = useAuth();
  const [allAppointments, setAllAppointments] = useState<Appointment[]>(() => getCachedAppointments());
  const [cancellingAppt, setCancellingAppt] = useState<Appointment | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Search parameters for notification routing & modal trigger
  const [searchParams] = useSearchParams();
  const paramApptId = searchParams.get("appointment_id") || searchParams.get("appointment");
  const paramAction = searchParams.get("action");

  // Tabs state
  const [activeTab, setActiveTab] = useState<"upcoming" | "past">("upcoming");

  // Reassign Alternate Doctor Modal State
  const [reassignModalAppt, setReassignModalAppt] = useState<Appointment | null>(null);

  // Reschedule Modal State
  const [rescheduleModalAppt, setRescheduleModalAppt] = useState<Appointment | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [minRescheduleDate] = useState(() =>
    new Date(Date.now() + 86400000).toISOString().split("T")[0]
  );
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [rescheduleSaving, setRescheduleSaving] = useState(false);
  const [rescheduleError, setRescheduleError] = useState("");

  // Withdraw Reschedule Modal State
  const [withdrawModalAppt, setWithdrawModalAppt] = useState<Appointment | null>(null);
  const [withdrawSaving, setWithdrawSaving] = useState(false);

  // Auto-open Alternate Doctor Modal if routed with ?appointment_id=[id]&action=reassign
  useEffect(() => {
    if (!paramApptId || allAppointments.length === 0) return;
    const targetAppt = allAppointments.find((a) => a.id === paramApptId);
    if (targetAppt) {
      if (paramAction === "reassign") {
        setReassignModalAppt(targetAppt);
      }
    }
  }, [paramApptId, paramAction, allAppointments]);

  const fetchAppointments = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = user?.id || session?.user?.id;
      const userEmail = user?.email || session?.user?.email;
      if (!userId && !userEmail) {
        return;
      }

      // Query patient_appointment using safe columns that exist in Supabase
      let query = supabase
        .from("patient_appointment")
        .select(`
          appointment_id,
          date,
          status,
          doctor_status,
          clinic_note,
          doctor_note,
          ai_condition_name,
          assigned_doctor_id,
          doctor_reviewed_at,
          created_at,
          queue_number,
          batch_time,
          check_in_status,
          clinic_id,
          patient_email,
          user_id,
          primary_scan_id,
          questionnaire_answers,
          clinic:clinic_id ( name )
        `)
        .order("created_at", { ascending: false });

      if (userId && userEmail) {
        query = query.or(`user_id.eq.${userId},patient_email.ilike.${userEmail}`);
      } else if (userId) {
        query = query.eq("user_id", userId);
      } else if (userEmail) {
        query = query.ilike("patient_email", userEmail);
      }

      let { data, error } = await query;

      // Resilient fallback query if nested relation or specific column had an issue
      if (error) {
        console.warn("[AppointmentStatusPage] Primary fetch warning, retrying with direct query:", error.message);
        let fallbackQuery = supabase
          .from("patient_appointment")
          .select("*")
          .order("created_at", { ascending: false });

        if (userId && userEmail) {
          fallbackQuery = fallbackQuery.or(`user_id.eq.${userId},patient_email.ilike.${userEmail}`);
        } else if (userId) {
          fallbackQuery = fallbackQuery.eq("user_id", userId);
        } else if (userEmail) {
          fallbackQuery = fallbackQuery.ilike("patient_email", userEmail);
        }

        const fallbackRes = await fallbackQuery;
        if (!fallbackRes.error && fallbackRes.data) {
          data = fallbackRes.data;
          error = null;
        } else {
          console.error("[AppointmentStatusPage] Fallback fetch error:", fallbackRes.error?.message);
        }
      }

      if (!error && data) {
        const docIds = data.map((a: any) => a.assigned_doctor_id).filter(Boolean);
        const docNameMap = new Map<string, string>();
        if (docIds.length > 0) {
          try {
            const { data: docData } = await supabase
              .from("clinic_doctor")
              .select("doctor_id, doctor_name")
              .in("doctor_id", docIds);
            if (docData) {
              docData.forEach((d: any) => docNameMap.set(d.doctor_id, d.doctor_name));
            }
          } catch { }
        }

        // Batch-resolve clinic names in case nested clinic join was missing
        const clinicIds = Array.from(new Set(data.map((a: any) => a.clinic_id).filter(Boolean)));
        const clinicNameMap = new Map<string, string>();
        if (clinicIds.length > 0) {
          try {
            const { data: clinicRows } = await supabase
              .from("clinic")
              .select("clinic_id, name")
              .in("clinic_id", clinicIds);
            if (clinicRows) {
              clinicRows.forEach((c: any) => clinicNameMap.set(String(c.clinic_id), c.name));
            }
          } catch { }
        }

        const mapped: Appointment[] = data.map((a: any) => {
          const apptDate = a.date ? new Date(a.date) : null;
          const isValidDate = apptDate && !isNaN(apptDate.getTime());
          const dateStr = isValidDate
            ? apptDate.toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" })
            : "Date pending";
          const timeStr = isValidDate
            ? apptDate.toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", hour12: true })
            : "Time pending";

          const rawStatus = (a.status || "").toLowerCase();
          const checkIn = (a.check_in_status || "").toLowerCase();
          let displayStatus: Appointment["status"] = "Pending";
          if (rawStatus === "confirmed" || rawStatus === "scheduled") {
            displayStatus = isValidDate ? "Scheduled" : "Pending";
          } else if (rawStatus === "completed") {
            displayStatus = "Completed";
          } else if (rawStatus === "cancelled") {
            displayStatus = "Cancelled";
          } else if (rawStatus === "rejected") {
            displayStatus = "Rejected";
          } else if (rawStatus === "no-show" || checkIn === "no-show") {
            displayStatus = "Cancelled";
          }

          const clinicObj: any = Array.isArray(a.clinic) ? a.clinic[0] : a.clinic;
          const resolvedClinicName = clinicObj?.name || clinicNameMap.get(String(a.clinic_id)) || "Skin Clinic";
          const isDocRejected = a.doctor_status === "rejected";
          const docName = (a.assigned_doctor_id && !isDocRejected && docNameMap.has(a.assigned_doctor_id))
            ? `Dr. ${docNameMap.get(a.assigned_doctor_id)!.replace(/^dr\.\s*/i, "")}`
            : (a.assigned_doctor_id && !isDocRejected)
              ? "Doctor Assigned"
              : "To be assigned";

          let docDiagnosis = "";
          let docNoteClean = "";
          if (isDocRejected) {
            // When doctor declined/rejected, doctor_note is their rejection note, NOT a diagnosis
            docNoteClean = a.doctor_note ? a.doctor_note.trim() : "";
          } else if (a.doctor_note) {
            const match = a.doctor_note.match(/^Diagnosis:\s*([^|\n]+)(?:[|\n]\s*(?:Note:\s*)?(.*))?$/is);
            if (match) {
              docDiagnosis = match[1]?.trim() || "";
              docNoteClean = match[2]?.trim() || "";
            } else {
              docDiagnosis = a.doctor_note.trim();
            }
          }

          const qAnswers = typeof a.questionnaire_answers === "object" && a.questionnaire_answers !== null ? a.questionnaire_answers : {};
          const rescheduleRequested = Boolean(a.reschedule_requested ?? qAnswers.reschedule_requested);
          const rDate = a.reschedule_date || qAnswers.reschedule_date || undefined;
          const rTime = a.reschedule_time || qAnswers.reschedule_time || undefined;
          const rReason = a.reschedule_reason || qAnswers.reschedule_reason || undefined;
          const needsPatientReschedule = Boolean(a.needs_patient_reschedule ?? qAnswers.needs_patient_reschedule);
          const appointmentHistory = Array.isArray(a.appointment_history)
            ? a.appointment_history
            : (Array.isArray(qAnswers.appointment_history) ? qAnswers.appointment_history : []);
          const primaryScanId = a.primary_scan_id || qAnswers.primary_scan_id || undefined;

          return {
            id: a.appointment_id,
            clinicId: a.clinic_id,
            clinicName: resolvedClinicName,
            doctor: docName,
            assignedDoctorName: a.assigned_doctor_id && !isDocRejected && docNameMap.has(a.assigned_doctor_id)
              ? docNameMap.get(a.assigned_doctor_id)
              : undefined,
            assignedDoctorId: !isDocRejected ? (a.assigned_doctor_id || undefined) : undefined,
            previousDoctorId: a.assigned_doctor_id || undefined,
            previousDoctorName: a.assigned_doctor_id && docNameMap.has(a.assigned_doctor_id)
              ? docNameMap.get(a.assigned_doctor_id)
              : undefined,
            doctorStatus: a.doctor_status || undefined,
            hasDate: Boolean(isValidDate),
            date: dateStr,
            time: timeStr,
            batchTime: a.batch_time || undefined,
            queueNumber: a.queue_number || 1,
            checkInStatus: (a.check_in_status || "scheduled") as any,
            isWalkIn: Boolean(a.is_walk_in),
            status: displayStatus,
            clinicNote: a.clinic_note || undefined,
            doctorNote: docNoteClean || undefined,
            doctorDiagnosis: !isDocRejected ? (docDiagnosis || undefined) : undefined,
            rejectionReason: a.clinic_note || undefined,
            createdAt: a.created_at,
            doctorReviewedAt: a.doctor_reviewed_at || undefined,
            userId: a.user_id || undefined,
            patientEmail: a.patient_email || undefined,
            primaryScanId,
            rescheduleRequested,
            rescheduleDate: rDate,
            rescheduleTime: rTime,
            rescheduleReason: rReason,
            needsPatientReschedule,
            appointmentHistory,
            paymentStatus: a.payment_status || (displayStatus === "Completed" || displayStatus === "Scheduled" ? "paid" : undefined),
            paymentAmount: a.payment_amount ? Number(a.payment_amount) : undefined,
            paymentReference: a.payment_reference || undefined,
            paidAt: a.paid_at || undefined,
          };
        });

        // Also merge any offline/optimistic records from local cache
        try {
          const rawLocal = localStorage.getItem("dermai_clinic_appointments");
          if (rawLocal) {
            const parsedLocal = JSON.parse(rawLocal);
            if (Array.isArray(parsedLocal)) {
              parsedLocal.forEach((localItem: any) => {
                const existing = mapped.find((m) => m.id === localItem.id);
                if (!existing) {
                  const pDate = localItem.date ? new Date(localItem.date) : null;
                  const isValid = pDate && !isNaN(pDate.getTime());

                  let formattedLocalTime = "Time pending";
                  if (localItem.time && localItem.time !== "Time pending") {
                    if (localItem.time.includes("AM") || localItem.time.includes("PM")) {
                      formattedLocalTime = localItem.time;
                    } else if (localItem.time.includes(":")) {
                      const [h, m] = localItem.time.split(":").map(Number);
                      const ampm = (h || 0) >= 12 ? "PM" : "AM";
                      const hr = (h || 0) % 12 || 12;
                      formattedLocalTime = `${hr}:${String(m || 0).padStart(2, "0")} ${ampm}`;
                    } else {
                      formattedLocalTime = localItem.time;
                    }
                  } else if (isValid && localItem.date?.includes("T")) {
                    formattedLocalTime = pDate.toLocaleTimeString("en-PH", {
                      timeZone: "Asia/Manila",
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                    });
                  }

                  mapped.push({
                    id: localItem.id,
                    clinicId: localItem.clinicId,
                    clinicName: localItem.clinicName || "Clinic",
                    doctor: localItem.assignedDoctorName ? `Dr. ${localItem.assignedDoctorName.replace(/^dr\.\s*/i, "")}` : "To be assigned",
                    assignedDoctorName: localItem.assignedDoctorName,
                    assignedDoctorId: localItem.assignedDoctorId,
                    doctorStatus: localItem.doctorStatus,
                    hasDate: Boolean(isValid || localItem.date),
                    date: isValid
                      ? pDate.toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" })
                      : (localItem.date || "Date pending"),
                    time: formattedLocalTime,
                    status: (localItem.status === "cancelled" ? "Cancelled" : localItem.status === "confirmed" || localItem.status === "scheduled" || localItem.doctorStatus === "approved" ? "Scheduled" : localItem.status === "completed" ? "Completed" : localItem.status === "rejected" ? "Rejected" : "Pending") as Appointment["status"],
                    clinicNote: localItem.clinicNote,
                    doctorNote: localItem.doctorNote,
                    doctorDiagnosis: localItem.conditionName || localItem.aiConditionName,
                    createdAt: localItem.createdAt || new Date().toISOString(),
                    userId: localItem.userId,
                    patientEmail: localItem.patientEmail,
                    primaryScanId: localItem.primaryScanId,
                    rescheduleRequested: Boolean(localItem.rescheduleRequested || localItem.reschedule_requested),
                    rescheduleDate: localItem.rescheduleDate || localItem.reschedule_date,
                    rescheduleTime: localItem.rescheduleTime || localItem.reschedule_time,
                    rescheduleReason: localItem.rescheduleReason || localItem.reschedule_reason,
                    needsPatientReschedule: Boolean(localItem.needsPatientReschedule || localItem.needs_patient_reschedule),
                    appointmentHistory: localItem.appointmentHistory || localItem.appointment_history || [],
                    paymentStatus: localItem.paymentStatus || "paid",
                    paymentAmount: localItem.paymentAmount ? Number(localItem.paymentAmount) : undefined,
                    paymentReference: localItem.paymentReference || undefined,
                    paidAt: localItem.paidAt || undefined,
                  });
                }
              });
            }
          }
        } catch { }

        // Exclude temporary unpaid holds and expired holds from active status list
        const confirmedAppointments = mapped.filter((a) => {
          const paySt = String(a.paymentStatus || "").toLowerCase().trim();
          return paySt !== "pending_hold" && paySt !== "expired" && paySt !== "failed";
        });

        setAllAppointments(confirmedAppointments);
      }
    } catch (err) {
      console.error("Failed to load appointments:", err);
    }
  }, [user]);

  useEffect(() => {
    fetchAppointments();

    const userId = user?.id;
    let channel: any = null;
    if (userId) {
      channel = supabase
        .channel(`patient-appointment-status-${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "patient_appointment", filter: `user_id=eq.${userId}` },
          () => fetchAppointments()
        )
        .subscribe();
    }

    const handleSync = () => fetchAppointments();
    window.addEventListener("dermai_appointments_updated", handleSync);
    window.addEventListener("dermai_doctor_avatar_updated", handleSync);
    window.addEventListener("appointmentCreated", handleSync);
    window.addEventListener("storage", handleSync);
    window.addEventListener("focus", handleSync);

    return () => {
      if (channel) supabase.removeChannel(channel);
      window.removeEventListener("dermai_appointments_updated", handleSync);
      window.removeEventListener("dermai_doctor_avatar_updated", handleSync);
      window.removeEventListener("appointmentCreated", handleSync);
      window.removeEventListener("storage", handleSync);
      window.removeEventListener("focus", handleSync);
    };
  }, [fetchAppointments, user?.id]);

  const handleOpenRescheduleModal = (app: Appointment) => {
    setRescheduleModalAppt(app);
    const tomorrow = new Date(Date.now() + 86400000);
    const dStr = tomorrow.toISOString().split("T")[0];
    setRescheduleDate(app.rescheduleDate || dStr);
    setRescheduleTime(app.rescheduleTime || "09:00");
    setRescheduleReason(app.rescheduleReason || "");
    setRescheduleError("");
  };

  // Rule 1: Patient Reschedule Request (Never silently alter scheduled date or time)
  const handleConfirmPatientReschedule = async () => {
    if (!rescheduleModalAppt) return;
    if (!rescheduleDate) {
      setRescheduleError("Please select a date for your consultation.");
      return;
    }
    if (!rescheduleTime) {
      setRescheduleError("Please select a preferred time slot.");
      return;
    }

    setRescheduleSaving(true);
    setRescheduleError("");

    try {
      const historyEntry: AppointmentHistoryEntry = {
        action: "reschedule_requested",
        actor: "patient",
        timestamp: new Date().toISOString(),
        previousDate: rescheduleModalAppt.date,
        previousTime: rescheduleModalAppt.time,
        requestedDate: rescheduleDate,
        requestedTime: rescheduleTime,
        reason: rescheduleReason.trim() || "Patient requested schedule adjustment.",
      };

      const updatedHistory = [...(rescheduleModalAppt.appointmentHistory || []), historyEntry];

      const currentQa = (rescheduleModalAppt as any)?.questionnaireAnswers || (rescheduleModalAppt as any)?.questionnaire_answers;
      const nextQa: Record<string, any> = (currentQa && typeof currentQa === "object" && !Array.isArray(currentQa))
        ? { ...currentQa }
        : (Array.isArray(currentQa) ? { answers: currentQa } : {});
      nextQa.reschedule_requested = true;
      nextQa.reschedule_date = rescheduleDate;
      nextQa.reschedule_time = rescheduleTime;
      nextQa.reschedule_reason = rescheduleReason.trim() || "Patient requested alternate schedule.";
      nextQa.needs_patient_reschedule = false;
      nextQa.appointment_history = updatedHistory;

      const { error: updateErr } = await supabase
        .from("patient_appointment")
        .update({
          questionnaire_answers: nextQa,
        })
        .eq("appointment_id", rescheduleModalAppt.id);

      if (updateErr) {
        console.error("[AppointmentStatusPage] Error updating reschedule request:", updateErr.message);
      }

      // Synchronize local cache
      try {
        const rawLocal = localStorage.getItem("dermai_clinic_appointments");
        if (rawLocal) {
          const parsed = JSON.parse(rawLocal);
          if (Array.isArray(parsed)) {
            const next = parsed.map((item: any) =>
              item.id === rescheduleModalAppt.id || item.appointment_id === rescheduleModalAppt.id
                ? {
                  ...item,
                  rescheduleRequested: true,
                  rescheduleDate,
                  rescheduleTime,
                  rescheduleReason: rescheduleReason.trim(),
                  needsPatientReschedule: false,
                  appointmentHistory: updatedHistory,
                }
                : item
            );
            localStorage.setItem("dermai_clinic_appointments", JSON.stringify(next));
          }
        }
      } catch (e) {
        console.error("Local storage sync error:", e);
      }

      // Update in-memory state
      setAllAppointments((prev) =>
        prev.map((a) =>
          a.id === rescheduleModalAppt.id
            ? {
              ...a,
              rescheduleRequested: true,
              rescheduleDate,
              rescheduleTime,
              rescheduleReason: rescheduleReason.trim(),
              needsPatientReschedule: false,
              appointmentHistory: updatedHistory,
            }
            : a
        )
      );

      window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
      window.dispatchEvent(new Event("storage"));

      logAuditEvent({
        userId: user?.id,
        role: "patient",
        category: "Appointment",
        action: "Appointment Reschedule Requested",
        target: `${rescheduleModalAppt.clinicName} - ${rescheduleDate} ${rescheduleTime}`,
        details: `Patient requested reschedule for appointment #${rescheduleModalAppt.id.slice(0, 8)} to ${rescheduleDate} at ${rescheduleTime}. Reason: "${rescheduleReason.trim() || "Schedule adjustment"}".`,
        metadata: {
          appointmentId: rescheduleModalAppt.id,
          clinicName: rescheduleModalAppt.clinicName,
          previousDate: rescheduleModalAppt.date,
          previousTime: rescheduleModalAppt.time,
          requestedDate: rescheduleDate,
          requestedTime: rescheduleTime,
        },
      }).catch(() => { });

      setRescheduleModalAppt(null);
      setSuccessToast(
        `Reschedule request submitted to ${rescheduleModalAppt.clinicName}. Your current schedule (${rescheduleModalAppt.date} at ${rescheduleModalAppt.time}) remains safely reserved while the clinic reviews your request.`
      );
      setTimeout(() => setSuccessToast(null), 7000);
    } catch (err: any) {
      console.error("Error submitting reschedule request:", err);
      setRescheduleError(err?.message || "Failed to submit reschedule request. Please try again.");
    } finally {
      setRescheduleSaving(false);
    }
  };

  const executeWithdrawReschedule = async (target: Appointment) => {
    setWithdrawSaving(true);
    try {
      const historyEntry: AppointmentHistoryEntry = {
        action: "reschedule_withdrawn",
        actor: "patient",
        timestamp: new Date().toISOString(),
        previousDate: target.rescheduleDate,
        previousTime: target.rescheduleTime,
        reason: "Patient cancelled pending reschedule request.",
      };
      const updatedHistory = [...(target.appointmentHistory || []), historyEntry];

      const currentQa = (target as any)?.questionnaireAnswers || (target as any)?.questionnaire_answers;
      const nextQa: Record<string, any> = (currentQa && typeof currentQa === "object" && !Array.isArray(currentQa))
        ? { ...currentQa }
        : (Array.isArray(currentQa) ? { answers: currentQa } : {});
      nextQa.reschedule_requested = false;
      nextQa.reschedule_date = null;
      nextQa.reschedule_time = null;
      nextQa.reschedule_reason = null;
      nextQa.appointment_history = updatedHistory;

      const { error } = await supabase
        .from("patient_appointment")
        .update({
          questionnaire_answers: nextQa,
        })
        .eq("appointment_id", target.id);

      if (error) {
        console.error("[AppointmentStatusPage] Error withdrawing reschedule request:", error.message);
      }

      // Synchronize local cache
      try {
        const rawLocal = localStorage.getItem("dermai_clinic_appointments");
        if (rawLocal) {
          const parsed = JSON.parse(rawLocal);
          if (Array.isArray(parsed)) {
            const next = parsed.map((item: any) =>
              item.id === target.id || item.appointment_id === target.id
                ? {
                  ...item,
                  rescheduleRequested: false,
                  rescheduleDate: undefined,
                  rescheduleTime: undefined,
                  rescheduleReason: undefined,
                  appointmentHistory: updatedHistory,
                }
                : item
            );
            localStorage.setItem("dermai_clinic_appointments", JSON.stringify(next));
          }
        }
      } catch (e) {
        console.error("Local storage sync error:", e);
      }

      setAllAppointments((prev) =>
        prev.map((a) =>
          a.id === target.id
            ? {
              ...a,
              rescheduleRequested: false,
              rescheduleDate: undefined,
              rescheduleTime: undefined,
              rescheduleReason: undefined,
              appointmentHistory: updatedHistory,
            }
            : a
        )
      );

      window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
      window.dispatchEvent(new Event("storage"));

      setWithdrawModalAppt(null);
      setSuccessToast(`Reschedule request withdrawn. Your confirmed schedule (${target.date} at ${target.time}) remains active.`);
      setTimeout(() => setSuccessToast(null), 5000);
    } catch (err) {
      console.error("Error withdrawing reschedule request:", err);
    } finally {
      setWithdrawSaving(false);
    }
  };

  const executeCancel = async (target: Appointment) => {
    if (target.status === "Scheduled" || target.doctorStatus === "approved" || target.status === "Completed") {
      setCancellingAppt(null);
      return;
    }
    const targetId = target.id;
    if (!targetId) return;

    setCancelLoading(true);
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId);
      if (isUuid) {
        const { error } = await supabase
          .from("patient_appointment")
          .update({ status: "cancelled", clinic_note: "Cancelled by patient." })
          .eq("appointment_id", targetId);

        if (error) {
          console.error("Supabase cancel error:", error);
        }
      }

      // Synchronize local cache so subsequent re-renders or window focus events do not revert
      try {
        const rawLocal = localStorage.getItem("dermai_clinic_appointments");
        if (rawLocal) {
          const parsed = JSON.parse(rawLocal);
          if (Array.isArray(parsed)) {
            const updated = parsed.map((item: any) =>
              item.id === targetId || (isUuid && item.appointment_id === targetId)
                ? { ...item, status: "cancelled", clinicNote: "Cancelled by patient." }
                : item
            );
            localStorage.setItem("dermai_clinic_appointments", JSON.stringify(updated));
          }
        }
      } catch (e) {
        console.error("LocalStorage cancel sync error:", e);
      }

      // Update in-memory state immediately
      setAllAppointments((prev) =>
        prev.map((a) =>
          a.id === targetId ? { ...a, status: "Cancelled", clinicNote: "Cancelled by patient." } : a
        )
      );

      // Notify other tabs and components (Clinic, Doctor, PatientDashboard)
      window.dispatchEvent(new Event("dermai_appointments_updated"));
      window.dispatchEvent(new Event("storage"));

      logAuditEvent({
        userId: user?.id,
        role: "patient",
        category: "Appointment",
        action: "Appointment Cancelled",
        target: `Appointment #${targetId.slice(0, 8)}`,
        details: `Patient cancelled appointment #${targetId.slice(0, 8)} with ${target.clinicName}.`,
        metadata: {
          appointmentId: targetId,
          clinicName: target.clinicName,
          date: target.date,
          time: target.time,
        },
      }).catch(() => { });

      setCancellingAppt(null);
      setSuccessToast("Appointment cancelled successfully. It has been moved to your Past tab.");
      setTimeout(() => setSuccessToast(null), 5000);
    } catch (err) {
      console.error("Error cancelling appointment:", err);
    } finally {
      setCancelLoading(false);
    }
  };

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const upcomingAppointments = allAppointments.filter((a) => {
    // If appointment is declined but within 24h re-selection window, keep it active in Upcoming!
    const rawSt = (a.status || "").toLowerCase();
    const docSt = (a.doctorStatus || "").toLowerCase();
    const isDeclined =
      docSt === "rejected" ||
      rawSt === "rejected" ||
      rawSt === "declined" ||
      rawSt === "clinic_reassigning" ||
      rawSt === "needs_doctor";

    const declinedTimestamp = a.doctorReviewedAt
      ? new Date(a.doctorReviewedAt).getTime()
      : a.createdAt
      ? new Date(a.createdAt).getTime()
      : Date.now();
    const is24HourExpired = Date.now() - (isNaN(declinedTimestamp) ? Date.now() : declinedTimestamp) > 24 * 3600 * 1000;

    if (isDeclined && !is24HourExpired) return true;

    // Past or terminal states never go in Upcoming
    if (a.status === "Completed" || a.status === "Rejected" || a.status === "Cancelled") return false;
    if (a.checkInStatus === "no-show") return false;

    // Always show Pending in Upcoming (no date constraint — awaiting clinic action / doctor review)
    if (a.status === "Pending") return true;

    // Scheduled = Upcoming only if the date is today or future
    if (a.status === "Scheduled") {
      const parsed = new Date(a.date);
      if (!isNaN(parsed.getTime())) return parsed.getTime() >= now.getTime();
      return true;
    }
    return false;
  });

  const pastAppointments = allAppointments.filter((a) => {
    const rawSt = (a.status || "").toLowerCase();
    const docSt = (a.doctorStatus || "").toLowerCase();
    const isDeclined =
      docSt === "rejected" ||
      rawSt === "rejected" ||
      rawSt === "declined" ||
      rawSt === "clinic_reassigning" ||
      rawSt === "needs_doctor";

    const declinedTimestamp = a.doctorReviewedAt
      ? new Date(a.doctorReviewedAt).getTime()
      : a.createdAt
      ? new Date(a.createdAt).getTime()
      : Date.now();
    const is24HourExpired = Date.now() - (isNaN(declinedTimestamp) ? Date.now() : declinedTimestamp) > 24 * 3600 * 1000;

    // If declined but still within 24h, it's active in Upcoming, not Past
    if (isDeclined && !is24HourExpired) return false;

    if (a.status === "Rejected" || a.status === "Cancelled" || a.status === "Completed") return true;
    if (a.checkInStatus === "no-show") return true;
    if (a.status === "Scheduled") {
      const parsed = new Date(a.date);
      if (!isNaN(parsed.getTime())) return parsed.getTime() < now.getTime();
    }
    return false;
  });

  const renderCards = (apps: Appointment[]) => {
    if (apps.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-14 gap-3">
          <div className="w-14 h-14 rounded-full bg-magenta-50 flex items-center justify-center">
            <svg className="w-7 h-7 text-magenta-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-sm text-gray-400 font-medium">No appointments to display.</p>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        {apps.map((app) => (
          <AppointmentCard
            key={app.id}
            app={app}
            onCancel={(item) => setCancellingAppt(item)}
            onReschedule={(item) => handleOpenRescheduleModal(item)}
            onWithdrawReschedule={(item) => setWithdrawModalAppt(item)}
            onSelectAlternateDoctor={(item) => setReassignModalAppt(item)}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="container mx-auto p-4 md:p-6 lg:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800 tracking-tight">Appointment Status</h1>
        <p className="text-sm text-gray-500 mt-1">Track and manage your physical consultation appointments</p>
      </div>

      {successToast && (
        <div className="mb-4 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-medium flex items-center justify-between gap-2 shadow-2xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successToast}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessToast(null)}
            className="text-emerald-700 hover:text-emerald-900 cursor-pointer p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <Tabs value={activeTab} onValueChange={(val: string) => setActiveTab(val as "upcoming" | "past")}>
          <div className="px-5 pt-5">
            <TabsList className="w-full grid grid-cols-2 rounded-xl bg-gray-100 p-1 h-auto">
              <TabsTrigger
                value="upcoming"
                className="rounded-lg py-2 text-sm font-semibold transition-all data-[state=active]:bg-magenta-500 data-[state=active]:text-white data-[state=active]:shadow-sm text-gray-500"
              >
                Upcoming ({upcomingAppointments.length})
              </TabsTrigger>
              <TabsTrigger
                value="past"
                className="rounded-lg py-2 text-sm font-semibold transition-all data-[state=active]:bg-magenta-500 data-[state=active]:text-white data-[state=active]:shadow-sm text-gray-500"
              >
                Past ({pastAppointments.length})
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="p-5">
            <TabsContent value="upcoming" className="mt-0 focus-visible:outline-none">
              {renderCards(upcomingAppointments)}
            </TabsContent>
            <TabsContent value="past" className="mt-0 focus-visible:outline-none">
              {renderCards(pastAppointments)}
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {/* Select Alternate Doctor Modal */}
      <SelectAlternateDoctorModal
        isOpen={Boolean(reassignModalAppt)}
        onClose={() => setReassignModalAppt(null)}
        appointment={reassignModalAppt}
        clinicId={reassignModalAppt?.clinicId ? String(reassignModalAppt.clinicId) : undefined}
        appointmentId={reassignModalAppt?.id}
        onSuccess={(newDoctorName) => {
          setSuccessToast(`Successfully assigned consultation to Dr. ${newDoctorName.replace(/^dr\.\s*/i, "")}. The doctor has been notified for review.`);
          fetchAppointments();
        }}
      />

      {/* Patient Reschedule Request Modal */}
      <ModalPortal isOpen={Boolean(rescheduleModalAppt)}>
        {rescheduleModalAppt && (
          <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
            <div className="relative z-[9999] bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-magenta-50 text-magenta-600 flex items-center justify-center">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">
                    Request Appointment Reschedule
                  </h3>
                  <p className="text-xs text-gray-500">
                    Clinic: <strong className="text-gray-800">{rescheduleModalAppt.clinicName}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRescheduleModalAppt(null)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Current Schedule Info Box */}
            <div className="mt-4 p-3 rounded-2xl bg-slate-50 border border-gray-200/80 text-xs text-gray-700 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-0.5">Current Schedule</span>
                <span className="font-semibold text-gray-900">{rescheduleModalAppt.date} at {rescheduleModalAppt.time}</span>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                Reserved
              </span>
            </div>

            {/* Rule 1 & Rule 2 Protection Guarantee */}
            <div className="mt-3 p-3 rounded-2xl bg-purple-50/80 border border-purple-200/70 text-purple-900 text-[11px] leading-relaxed">
              <strong>Patient Protection:</strong> Submitting this request does not alter your existing scheduled date or time without mutual clinic agreement. Your slot remains reserved until the clinic reviews and approves your requested slot.
            </div>

            {rescheduleError && (
              <div className="mt-3 p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-600 font-medium">
                {rescheduleError}
              </div>
            )}

            {/* Date Picker */}
            <div className="mt-4">
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                New Preferred Date <span className="text-magenta-600">*</span>
              </label>
              <input
                type="date"
                value={rescheduleDate}
                min={minRescheduleDate}
                onChange={(e) => {
                  setRescheduleDate(e.target.value);
                  setRescheduleError("");
                }}
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-xs text-gray-900 font-semibold focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 outline-none bg-white"
              />
            </div>

            {/* Preferred Time Slot Grid */}
            <div className="mt-4">
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                New Preferred Time <span className="text-magenta-600">*</span>
              </label>
              <div className="grid grid-cols-4 sm:grid-cols-4 gap-2">
                {[
                  { value: "08:30", label: "8:30 AM" },
                  { value: "09:00", label: "9:00 AM" },
                  { value: "09:30", label: "9:30 AM" },
                  { value: "10:00", label: "10:00 AM" },
                  { value: "10:30", label: "10:30 AM" },
                  { value: "11:00", label: "11:00 AM" },
                  { value: "11:30", label: "11:30 AM" },
                  { value: "13:00", label: "1:00 PM" },
                  { value: "13:30", label: "1:30 PM" },
                  { value: "14:00", label: "2:00 PM" },
                  { value: "14:30", label: "2:30 PM" },
                  { value: "15:00", label: "3:00 PM" },
                  { value: "15:30", label: "3:30 PM" },
                  { value: "16:00", label: "4:00 PM" },
                  { value: "16:30", label: "4:30 PM" },
                  { value: "17:00", label: "5:00 PM" },
                ].map((slot) => {
                  const isSelected = rescheduleTime === slot.value;
                  return (
                    <button
                      key={slot.value}
                      type="button"
                      onClick={() => {
                        setRescheduleTime(slot.value);
                        setRescheduleError("");
                      }}
                      className={`py-2 px-1 text-center rounded-xl text-xs font-semibold transition border cursor-pointer ${isSelected
                          ? "bg-magenta-600 border-magenta-600 text-white shadow-2xs"
                          : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-magenta-50 hover:border-magenta-200"
                        }`}
                    >
                      {slot.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quick Reason Presets */}
            <div className="mt-4">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                Quick Reason Suggestions
              </label>
              <div className="space-y-1">
                {[
                  "Schedule or work conflict",
                  "Personal or family emergency",
                  "Transportation or distance constraint",
                  "Doctor availability preference",
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setRescheduleReason(preset);
                      setRescheduleError("");
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-xl text-xs transition border cursor-pointer ${rescheduleReason === preset
                        ? "bg-magenta-50 border-magenta-200 text-magenta-800 font-semibold"
                        : "bg-gray-50 border-gray-100 text-gray-600 hover:bg-gray-100"
                      }`}
                  >
                    • {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Reason Textarea */}
            <div className="mt-3">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                Note for Clinic (Optional)
              </label>
              <textarea
                value={rescheduleReason}
                onChange={(e) => {
                  setRescheduleReason(e.target.value);
                  setRescheduleError("");
                }}
                rows={2}
                placeholder="Add any specific context or time flexibility for the clinic triage team..."
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-200 text-gray-900 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 bg-white"
              />
            </div>

            {/* Action Buttons */}
            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                disabled={rescheduleSaving}
                onClick={() => setRescheduleModalAppt(null)}
                className="flex-1 py-2.5 px-4 rounded-xl border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition cursor-pointer"
              >
                Keep Current Schedule
              </button>
              <button
                type="button"
                disabled={rescheduleSaving || !rescheduleDate || !rescheduleTime}
                onClick={handleConfirmPatientReschedule}
                className="flex-1 py-2.5 px-4 rounded-xl bg-magenta-600 hover:bg-magenta-700 text-white text-xs font-semibold shadow-xs transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {rescheduleSaving ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    <span>Submitting...</span>
                  </>
                ) : (
                  <span>Send Reschedule Request</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      </ModalPortal>

      {/* Withdraw Reschedule Request Modal */}
      <ModalPortal isOpen={Boolean(withdrawModalAppt)}>
        {withdrawModalAppt && (
          <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
            <div className="relative z-[9999] bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-100 animate-in fade-in zoom-in-95">
            <div className="w-12 h-12 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 mb-4 mx-auto">
              <RotateCcw className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-gray-900 text-center">
              Withdraw Reschedule Request?
            </h3>
            <p className="text-xs text-gray-600 text-center mt-2 leading-relaxed">
              Are you sure you want to withdraw your request to reschedule your consultation with <strong className="text-gray-900">{withdrawModalAppt.clinicName}</strong>?
            </p>
            <div className="mt-4 p-3 bg-slate-50 rounded-xl border border-gray-200 text-gray-700 text-[11px] leading-relaxed">
              ✅ Your confirmed schedule (<strong className="text-gray-900">{withdrawModalAppt.date} at {withdrawModalAppt.time}</strong>) will remain completely active and unaffected.
            </div>
            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                disabled={withdrawSaving}
                onClick={() => setWithdrawModalAppt(null)}
                className="flex-1 py-2.5 px-4 rounded-xl border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition cursor-pointer"
              >
                Back
              </button>
              <button
                type="button"
                disabled={withdrawSaving}
                onClick={() => executeWithdrawReschedule(withdrawModalAppt)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-xs transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {withdrawSaving ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    <span>Withdrawing...</span>
                  </>
                ) : (
                  <span>Yes, Withdraw Request</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      </ModalPortal>

      {/* Cancellation Confirmation Modal */}
      <ModalPortal isOpen={Boolean(cancellingAppt)}>
        {cancellingAppt && (
          <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
            <div className="relative z-[9999] bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-100 animate-in fade-in zoom-in-95">
            <div className="w-12 h-12 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 mb-4 mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-gray-900 text-center">
              Cancel {cancellingAppt.status === "Scheduled" ? "Appointment" : "Consultation Request"}?
            </h3>
            <p className="text-xs text-gray-600 text-center mt-2 leading-relaxed">
              Are you sure you want to cancel your consultation with <strong className="text-gray-900">{cancellingAppt.clinicName}</strong> on <strong className="text-gray-900">{cancellingAppt.date}</strong> at <strong className="text-gray-900">{cancellingAppt.time}</strong>?
            </p>
            <div className="mt-4 p-3 bg-amber-50 rounded-xl border border-amber-200/70 text-amber-900 text-[11px] leading-relaxed">
              ⚠️ This action cannot be undone. Your reserved appointment slot will be released.
            </div>
            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                disabled={cancelLoading}
                onClick={() => setCancellingAppt(null)}
                className="flex-1 py-2.5 px-4 rounded-xl border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition cursor-pointer"
              >
                Keep Appointment
              </button>
              <button
                type="button"
                disabled={cancelLoading}
                onClick={() => executeCancel(cancellingAppt)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-xs transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {cancelLoading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    <span>Cancelling...</span>
                  </>
                ) : (
                  <span>Yes, Cancel</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      </ModalPortal>
    </div>
  );
};

export default AppointmentStatusPage;
