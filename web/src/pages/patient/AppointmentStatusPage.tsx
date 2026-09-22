import React, { useState, useEffect, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { CheckCircle2, Clock, Calendar, Stethoscope, AlertTriangle } from "lucide-react";

interface Appointment {
  id: string;
  clinicName: string;
  doctor: string;
  assignedDoctorName?: string;
  assignedDoctorId?: string;
  doctorStatus?: "pending-review" | "approved" | "rejected";
  hasDate: boolean;
  date: string;
  time: string;
  status: "Pending" | "Scheduled" | "Rejected" | "Completed" | "Cancelled";
  clinicNote?: string;
  doctorNote?: string;
  doctorDiagnosis?: string;
  rejectionReason?: string;
  createdAt?: string;
}

const STEPS = ["Request Sent", "Clinic Review", "Scheduled", "Completed"];

function getStepIndex(app: Appointment): number {
  if (app.status === "Completed") return 3;
  if (app.status === "Scheduled" && app.hasDate) return 2;
  if (app.status === "Pending" || (app.doctorStatus === "approved" && !app.hasDate)) return 1;
  return 0;
}

function StatusBadge({ app }: { app: Appointment }) {
  if (app.status === "Completed") {
    return (
      <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider bg-green-100 text-green-700 border border-green-200">
        Completed
      </span>
    );
  }
  if (app.status === "Scheduled" && app.hasDate) {
    return (
      <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider bg-blue-100 text-blue-700 border border-blue-200">
        Scheduled
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
  if (app.doctorStatus === "approved" && !app.hasDate) {
    return (
      <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
        Doctor Approved
      </span>
    );
  }
  if (app.assignedDoctorId && app.doctorStatus === "pending-review") {
    return (
      <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider bg-blue-100 text-blue-800 border border-blue-200">
        Under Review
      </span>
    );
  }
  return (
    <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-200">
      Clinic Review
    </span>
  );
}

function StatusTracker({ app }: { app: Appointment }) {
  const isCancelled = app.status === "Cancelled" || app.status === "Rejected";
  const activeStep = isCancelled ? -1 : getStepIndex(app);

  const isDoctorApprovedAwaitingSchedule = app.doctorStatus === "approved" && !app.hasDate;
  const isUnderDoctorReview = !!app.assignedDoctorId && app.doctorStatus === "pending-review";

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
              Appointment {app.status === "Rejected" ? "Declined" : "Cancelled"}
            </p>
            <p className="text-xs text-red-600 mt-0.5 leading-relaxed">
              {app.status === "Rejected"
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
          <div className="space-y-2">
            {app.status === "Completed" ? (
              <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-emerald-900">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                <p className="text-[11px] leading-relaxed">
                  Your physical consultation with <strong className="inline-flex items-center gap-1 text-emerald-950 font-bold">{app.clinicName} <VerifiedBadge size={12} className="w-3 h-3" /></strong> has been completed.
                </p>
              </div>
            ) : app.status === "Scheduled" && app.hasDate ? (
              <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl p-3 text-blue-900">
                <Calendar className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                <p className="text-[11px] leading-relaxed">
                  Your appointment with <strong className="inline-flex items-center gap-1 text-blue-950 font-bold">{app.clinicName} <VerifiedBadge size={12} className="w-3 h-3" /></strong> is confirmed and scheduled on <strong className="text-blue-950">{app.date}</strong> at <strong className="text-blue-950">{app.time}</strong> with <strong className="text-blue-950">{app.doctor}</strong>. Please arrive 10 minutes prior to your consultation.
                </p>
              </div>
            ) : isDoctorApprovedAwaitingSchedule ? (
              <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-emerald-900">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-emerald-800">
                    {app.doctor} has approved your appointment!
                  </p>
                  <p className="text-[11px] text-emerald-700 mt-0.5 leading-relaxed">
                    <strong className="inline-flex items-center gap-1 text-emerald-950 font-semibold">{app.clinicName} <VerifiedBadge size={12} className="w-3 h-3" /></strong> is currently setting and finalizing your consultation schedule date and time.
                  </p>
                </div>
              </div>
            ) : isUnderDoctorReview ? (
              <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl p-3 text-blue-900">
                <Stethoscope className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-blue-800">Under Pre-Consultation Review</p>
                  <p className="text-[11px] text-blue-700 mt-0.5 leading-relaxed">
                    Assigned to <strong className="text-blue-950 font-semibold">{app.doctor}</strong> at <strong className="inline-flex items-center gap-1 text-blue-950 font-semibold">{app.clinicName} <VerifiedBadge size={12} className="w-3 h-3" /></strong>. The doctor is reviewing your skin concern and AI assessment.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-900">
                <Clock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-amber-800">Clinic Review</p>
                  <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
                    Your request was received by <strong className="inline-flex items-center gap-1 text-amber-950 font-semibold">{app.clinicName} <VerifiedBadge size={12} className="w-3 h-3" /></strong>. The clinic will coordinate your consultation schedule and assigned dermatologist shortly.
                  </p>
                </div>
              </div>
            )}

            {/* Doctor Clinical Diagnosis / Assessment Card */}
            {app.doctorDiagnosis && (
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

            {app.clinicNote && !isCancelled && (
              <div className="text-[11px] text-gray-600 bg-white border border-gray-200/80 rounded-xl px-3 py-2">
                <strong className="text-gray-700">Clinic Note:</strong> {app.clinicNote}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function AppointmentCard({ app, onCancel }: { app: Appointment; onCancel?: (id?: string) => void }) {
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
            <p className="text-sm font-semibold text-gray-900 mt-0.5">{app.doctor || "To be assigned"}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Date</p>
            <p className="text-sm font-semibold text-gray-900 mt-0.5">{app.date}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Time</p>
            <p className="text-sm font-semibold text-gray-900 mt-0.5">{app.time}</p>
          </div>
        </div>

        <StatusTracker app={app} />

        {app.status === "Pending" && (
          <div className="mt-4 flex justify-end">
            <button
              onClick={() => onCancel && onCancel(app.id)}
              className="text-xs font-semibold text-red-500 hover:text-red-700 px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 transition-colors"
            >
              Cancel Request
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const AppointmentStatusPage: React.FC = () => {
  const { user } = useAuth();
  const [allAppointments, setAllAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = user?.id || session?.user?.id;
      if (!userId) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
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
          created_at,
          clinic:clinic_id ( name )
        `)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

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

        const mapped: Appointment[] = data.map((a: any) => {
          const apptDate = a.date ? new Date(a.date) : null;
          const isValidDate = apptDate && !isNaN(apptDate.getTime());
          const dateStr = isValidDate ? apptDate.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "Date pending";
          const timeStr = isValidDate ? apptDate.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", hour12: true }) : "Time pending";

          const rawStatus = (a.status || "").toLowerCase();
          let displayStatus: Appointment["status"] = "Pending";
          if (rawStatus === "confirmed" || rawStatus === "scheduled") {
            displayStatus = isValidDate ? "Scheduled" : "Pending";
          } else if (rawStatus === "completed") {
            displayStatus = "Completed";
          } else if (rawStatus === "cancelled") {
            displayStatus = "Cancelled";
          } else if (rawStatus === "rejected") {
            displayStatus = "Rejected";
          }

          const clinicObj: any = Array.isArray(a.clinic) ? a.clinic[0] : a.clinic;
          const isDocRejected = a.doctor_status === "rejected";
          const docName = (a.assigned_doctor_id && !isDocRejected && docNameMap.has(a.assigned_doctor_id))
            ? `Dr. ${docNameMap.get(a.assigned_doctor_id)!.replace(/^dr\.\s*/i, "")}`
            : (a.assigned_doctor_id && !isDocRejected)
            ? "Doctor Assigned"
            : "To be assigned";

          let docDiagnosis = "";
          let docNoteClean = "";
          if (a.doctor_note) {
            const match = a.doctor_note.match(/^Diagnosis:\s*([^|\n]+)(?:[|\n]\s*(?:Note:\s*)?(.*))?$/is);
            if (match) {
              docDiagnosis = match[1]?.trim() || "";
              docNoteClean = match[2]?.trim() || "";
            } else {
              docDiagnosis = a.doctor_note.trim();
            }
          }

          return {
            id: a.appointment_id,
            clinicName: clinicObj?.name ?? "Clinic",
            doctor: docName,
            assignedDoctorName: a.assigned_doctor_id && !isDocRejected && docNameMap.has(a.assigned_doctor_id)
              ? docNameMap.get(a.assigned_doctor_id)
              : undefined,
            assignedDoctorId: !isDocRejected ? (a.assigned_doctor_id || undefined) : undefined,
            doctorStatus: a.doctor_status || undefined,
            hasDate: Boolean(isValidDate),
            date: dateStr,
            time: timeStr,
            status: displayStatus,
            clinicNote: a.clinic_note || undefined,
            doctorNote: docNoteClean || undefined,
            doctorDiagnosis: docDiagnosis || undefined,
            rejectionReason: a.clinic_note || undefined,
            createdAt: a.created_at,
          };
        });
        setAllAppointments(mapped);
      }
    } catch (err) {
      console.error("Failed to load appointments:", err);
    } finally {
      setLoading(false);
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
    window.addEventListener("appointmentCreated", handleSync);
    window.addEventListener("storage", handleSync);
    window.addEventListener("focus", handleSync);

    return () => {
      if (channel) supabase.removeChannel(channel);
      window.removeEventListener("dermai_appointments_updated", handleSync);
      window.removeEventListener("appointmentCreated", handleSync);
      window.removeEventListener("storage", handleSync);
      window.removeEventListener("focus", handleSync);
    };
  }, [fetchAppointments, user?.id]);

  const handleCancel = async (id?: string) => {
    if (!id) return;
    try {
      await supabase
        .from("patient_appointment")
        .update({ status: "cancelled", clinic_note: "Cancelled by patient." })
        .eq("appointment_id", id);

      setAllAppointments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: "Cancelled", clinicNote: "Cancelled by patient." } : a))
      );
    } catch (err) {
      console.error("Error cancelling appointment:", err);
    }
  };

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const upcomingAppointments = allAppointments.filter((a) => {
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
    if (a.status === "Rejected" || a.status === "Cancelled") return true;
    if (a.status === "Completed") return true;
    if (a.status === "Scheduled") {
      const parsed = new Date(a.date);
      if (!isNaN(parsed.getTime())) return parsed.getTime() < now.getTime();
    }
    return false;
  });

  const renderCards = (apps: Appointment[]) => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center py-14 gap-3">
          <div className="w-8 h-8 border-3 border-magenta-200 border-t-magenta-600 rounded-full animate-spin" />
          <p className="text-sm text-gray-500 font-medium">Loading your appointments...</p>
        </div>
      );
    }

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
          <AppointmentCard key={app.id} app={app} onCancel={handleCancel} />
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

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <Tabs defaultValue="upcoming">
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
    </div>
  );
};

export default AppointmentStatusPage;
