import React, { useState, useEffect, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";

interface Appointment {
  id: string;
  clinicName: string;
  doctor: string;
  date: string;
  time: string;
  status: "Pending" | "Scheduled" | "Rejected" | "Completed" | "Cancelled";
  clinicNote?: string;
  rejectionReason?: string;
}

const STEPS = ["Request Sent", "Clinic Review", "Scheduled", "Completed"];

function getStepIndex(status: Appointment["status"]): number {
  if (status === "Completed") return 3;
  if (status === "Scheduled") return 2;
  if (status === "Pending") return 1;
  return 0;
}

function StatusBadge({ status }: { status: Appointment["status"] }) {
  const styles: Record<string, string> = {
    Scheduled: "bg-blue-100 text-blue-700 border border-blue-200",
    Completed: "bg-green-100 text-green-700 border border-green-200",
    Pending: "bg-amber-100 text-amber-700 border border-amber-200",
    Rejected: "bg-red-100 text-red-700 border border-red-200",
    Cancelled: "bg-gray-100 text-gray-600 border border-gray-200",
  };
  return (
    <span
      className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-widest ${styles[status] ?? "bg-gray-100 text-gray-500"}`}
    >
      {status}
    </span>
  );
}

function StatusTracker({ app }: { app: Appointment }) {
  const isCancelled = app.status === "Cancelled" || app.status === "Rejected";
  const activeStep = isCancelled ? -1 : getStepIndex(app.status);

  return (
    <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50/60 p-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Appointment Progress</p>
        <StatusBadge status={app.status} />
      </div>

      {isCancelled ? (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-3.5">
          <svg className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-red-800">
              Appointment {app.status}
            </p>
            <p className="text-xs text-red-600 mt-0.5 leading-relaxed">
              {app.status === "Rejected"
                ? <span>Your appointment request with <strong className="inline-flex items-center gap-1 font-semibold text-gray-900">{app.clinicName} <VerifiedBadge size={13} className="w-3.5 h-3.5" /></strong> was declined.</span>
                : <span>This appointment with <strong className="inline-flex items-center gap-1 font-semibold text-gray-900">{app.clinicName} <VerifiedBadge size={13} className="w-3.5 h-3.5" /></strong> was cancelled.</span>}
            </p>
            {(app.clinicNote || app.rejectionReason) && (
              <div className="mt-2 rounded-lg bg-white border border-red-200 p-2.5 shadow-xs">
                <div className="flex items-center gap-1 text-red-700 font-bold text-[10px] uppercase tracking-wider mb-0.5">
                  <svg className="w-3.5 h-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                  </svg>
                  <span>Reason / Note from Clinic:</span>
                </div>
                <p className="text-xs text-gray-800 font-medium leading-relaxed">
                  "{app.clinicNote || app.rejectionReason}"
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
                      className={`w-5 h-5 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                        isDone
                          ? isActive
                            ? "bg-magenta-600 border-magenta-500 scale-105 shadow-xs"
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
                      className={`text-[9px] font-semibold text-center leading-tight uppercase tracking-wide ${
                        isDone ? "text-magenta-700" : "text-gray-400"
                      }`}
                    >
                      {step}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-start gap-2 bg-white border border-gray-100 rounded-xl p-3">
            <p className="text-[11px] text-gray-600 leading-relaxed">
              {app.status === "Completed" ? (
                <span>Your appointment with <strong className="inline-flex items-center gap-1 text-gray-900 font-semibold">{app.clinicName} <VerifiedBadge size={12} className="w-3 h-3" /></strong> has been completed.</span>
              ) : app.status === "Scheduled" ? (
                <span>Your appointment with <strong className="inline-flex items-center gap-1 text-gray-900 font-semibold">{app.clinicName} <VerifiedBadge size={12} className="w-3 h-3" /></strong> is scheduled on {app.date} at {app.time}.</span>
              ) : (
                <span>Your request to <strong className="inline-flex items-center gap-1 text-gray-900 font-semibold">{app.clinicName} <VerifiedBadge size={12} className="w-3 h-3" /></strong> is pending clinic review.</span>
              )}
            </p>
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
          clinic:clinic_id ( name ),
          doctor:assigned_doctor_id ( doctor_name )
        `)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (!error && data) {
        const mapped: Appointment[] = data.map((a: any) => {
          const apptDate = a.date ? new Date(a.date) : null;
          const dateStr = apptDate ? apptDate.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "Date pending";
          const timeStr = apptDate ? apptDate.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", hour12: true }) : "Time pending";

          const rawStatus = (a.status || "").toLowerCase();
          let displayStatus: Appointment["status"] = "Pending";
          if (rawStatus === "confirmed" || rawStatus === "scheduled") displayStatus = "Scheduled";
          else if (rawStatus === "completed") displayStatus = "Completed";
          else if (rawStatus === "cancelled") displayStatus = "Cancelled";
          else if (rawStatus === "rejected" || a.doctor_status === "rejected") displayStatus = "Rejected";

          const clinicObj: any = Array.isArray(a.clinic) ? a.clinic[0] : a.clinic;
          const doctorObj: any = Array.isArray(a.doctor) ? a.doctor[0] : a.doctor;

          return {
            id: a.appointment_id,
            clinicName: clinicObj?.name ?? "Clinic",
            doctor: doctorObj?.doctor_name ?? "Doctor Assigned by Clinic",
            date: dateStr,
            time: timeStr,
            status: displayStatus,
            clinicNote: a.clinic_note || (a.ai_condition_name ? `Condition noted: ${a.ai_condition_name}` : undefined),
            rejectionReason: a.doctor_note || undefined,
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
  }, [fetchAppointments]);

  const handleCancel = async (id?: string) => {
    if (!id) return;
    try {
      await supabase
        .from("patient_appointment")
        .update({ status: "cancelled" })
        .eq("appointment_id", id);

      setAllAppointments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: "Cancelled" } : a))
      );
    } catch (err) {
      console.error("Error cancelling appointment:", err);
    }
  };

  const upcomingAppointments = allAppointments.filter(
    (a) => a.status === "Scheduled" || a.status === "Pending"
  );
  const pastAppointments = allAppointments.filter(
    (a) => a.status === "Completed" || a.status === "Rejected" || a.status === "Cancelled"
  );

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
