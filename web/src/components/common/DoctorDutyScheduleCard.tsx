import { CalendarDays, Clock } from "lucide-react";
import { ALL_DAYS_OF_WEEK, formatTime12h, type DoctorWeeklySchedule } from "@/lib/schedulingService";
import { useDoctorDutySchedule } from "@/hooks/useDoctorDutySchedule";

type DoctorDutyScheduleCardProps = {
  doctorId: string | null;
  clinicId: string | null;
  clinicName: string;
};

export function DoctorDutyScheduleCard({ doctorId, clinicId, clinicName }: DoctorDutyScheduleCardProps) {
  const roster = useDoctorDutySchedule(doctorId, clinicId);
  return <DoctorDutyScheduleView clinicName={clinicName} {...roster} />;
}

type DoctorDutyScheduleViewProps = {
  clinicName: string;
  schedule: DoctorWeeklySchedule | null;
  loading?: boolean;
  error?: boolean;
};

// The same presentation is used for authenticated doctor pages and the clinic's
// doctor details, where the authorized roster has already been fetched.
export function DoctorDutyScheduleView({ clinicName, schedule, loading = false, error = false }: DoctorDutyScheduleViewProps) {
  const name = clinicName || "No clinic selected";
  const days = ALL_DAYS_OF_WEEK.filter(day => day !== "Sunday" || schedule?.weeklyShifts.Sunday?.length);

  return (
    <section className="min-w-0 rounded-2xl border border-sky-100 bg-white p-5 shadow-xs sm:p-8" aria-label={`${name} duty schedule`} aria-busy={loading}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2.5">
          <CalendarDays className="h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
          <h2 className="text-sm font-semibold uppercase text-slate-600">DUTY SCHEDULE</h2>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-600">
          <Clock className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
          <span>Clinic Hours</span>
        </div>
      </header>

      <p className="mb-4 mt-4 text-sm font-semibold text-blue-600 wrap-anywhere">{name}</p>
      {error && <p role="alert" className="mb-3 text-sm text-red-600">Could not load this clinic’s roster. Please try again.</p>}
      {loading && <span role="status" className="sr-only">Loading duty schedule…</span>}

      <div className="min-w-0 pb-1" role="region" aria-label="Weekly duty hours">
        <div className="grid w-full min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] divide-x divide-slate-100">
          {days.map(day => (
            <div key={day} className="flex min-h-22 min-w-0 flex-col gap-1 px-3 py-3">
              <span className="text-sm font-medium text-slate-500">{day}</span>
              {loading ? (
                <span aria-hidden="true" className="mt-1 h-4 w-36 max-w-full animate-pulse rounded bg-slate-100" />
              ) : !error && schedule?.weeklyShifts[day]?.length ? (
                schedule.weeklyShifts[day].map((shift, index) => (
                  <span key={shift.id || index} className="text-sm font-semibold leading-6 text-slate-900">
                    {formatTime12h(shift.startTime)} – {formatTime12h(shift.endTime)}
                  </span>
                ))
              ) : (
                <span className="text-sm leading-6 text-slate-400">{error ? "—" : "Not Scheduled"}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <footer className="mt-4 flex items-start gap-2 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-400">
        <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 wrap-anywhere">Assigned clinic roster · {name}</span>
      </footer>
    </section>
  );
}
