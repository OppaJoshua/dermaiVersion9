import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Appointment {
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
    <div className="mt-4 rounded-2xl border border-magenta-100 bg-gradient-to-r from-magenta-50 via-white to-rose-50 p-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-semibold text-magenta-700 uppercase tracking-wider">Appointment Progress</p>
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
                ? `Your appointment request with ${app.clinicName} was declined.`
                : `This appointment with ${app.clinicName} was cancelled.`}
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
          {/* Step tracker */}
          <div className="relative flex items-start mb-4 px-2">
            {/* Connecting line background */}
            <div className="absolute top-2.5 left-[calc(3.5rem/2)] right-[calc(3.5rem/2)] h-0.5 bg-gray-200 z-0" />
            {/* Active progress line */}
            <div
              className="absolute top-2.5 left-[calc(3.5rem/2)] h-0.5 bg-gradient-to-r from-magenta-400 to-magenta-600 z-0 transition-all duration-700"
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
                            ? "bg-magenta-500 border-magenta-400 scale-110 shadow-md"
                            : "bg-magenta-400 border-magenta-300 shadow-sm"
                          : "bg-white border-gray-200"
                      }`}
                    >
                      {isDone ? (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <div className="w-1.5 h-1.5 rounded-full bg-gray-200" />
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

          {/* Status message */}
          <div className="flex items-start gap-2 bg-white/70 border border-magenta-100 rounded-xl p-3">
            <svg className="w-3.5 h-3.5 text-magenta-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <p className="text-[11px] text-gray-600 leading-relaxed">
              {app.status === "Completed"
                ? `Your appointment with ${app.clinicName} has been completed.`
                : app.status === "Scheduled"
                ? `Your appointment with ${app.clinicName} is scheduled on ${app.date} at ${app.time}.`
                : `Your request to ${app.clinicName} is pending clinic review.`}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function AppointmentCard({ app }: { app: Appointment }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
      {/* Top accent strip */}
      <div className="h-1 w-full bg-gradient-to-r from-magenta-400 via-magenta-500 to-magenta-600" />
      <div className="p-5">
        {/* Info grid – no Consultation Type column */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Clinic Name</p>
            <p className="text-sm font-semibold text-gray-800 leading-tight">{app.clinicName}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Doctor</p>
            <p className="text-sm font-medium text-gray-700">{app.doctor}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Date</p>
            <p className="text-sm font-medium text-gray-700">{app.date}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Time</p>
            <p className="text-sm font-medium text-gray-700">{app.time}</p>
          </div>
        </div>

        <StatusTracker app={app} />
      </div>
    </div>
  );
}


const AppointmentStatusPage = () => {
  // TODO: Load appointments from Supabase using authenticated user session
  const allAppointments: Appointment[] = [];

  // Scheduled and pending appointments appear in Upcoming
  const upcomingAppointments = allAppointments.filter(
    (a) => a.status === "Scheduled" || a.status === "Pending"
  );
  // Completed (Done), Rejected, and Cancelled appointments appear in Past
  const pastAppointments = allAppointments.filter(
    (a) => a.status === "Completed" || a.status === "Rejected" || a.status === "Cancelled"
  );

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
        {apps.map((app, i) => (
          <AppointmentCard key={i} app={app} />
        ))}
      </div>
    );
  };

  return (
    <div className="container mx-auto p-4 md:p-6 lg:p-8 max-w-4xl">
      {/* Page Header */}
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
                Upcoming
              </TabsTrigger>
              <TabsTrigger
                value="past"
                className="rounded-lg py-2 text-sm font-semibold transition-all data-[state=active]:bg-magenta-500 data-[state=active]:text-white data-[state=active]:shadow-sm text-gray-500"
              >
                Past
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
