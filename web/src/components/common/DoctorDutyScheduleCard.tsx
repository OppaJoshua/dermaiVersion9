import { CalendarDays, Clock } from "lucide-react";
import { ALL_DAYS_OF_WEEK, formatTime12h, type DoctorWeeklySchedule } from "@/lib/schedulingService";
import { useDoctorDutySchedule, useAllBranchesDutySchedules } from "@/hooks/useDoctorDutySchedule";
import type { DoctorAffiliatedClinic } from "@/lib/doctorBranches";

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

// ─── Colour palette for clinic branch section headers (cycles by index) ──────
const BRANCH_HEADER_COLORS = [
  "border-blue-100 bg-blue-50/40",
  "border-blue-100 bg-blue-50/40",
  "border-blue-100 bg-blue-50/40",
  "border-blue-100 bg-blue-50/40",
  "border-blue-100 bg-blue-50/40",
  "border-blue-100 bg-blue-50/40",
  "border-blue-100 bg-blue-50/40",
];

interface ConsolidatedDutyScheduleCardProps {
  affiliations: DoctorAffiliatedClinic[];
}

/**
 * Renders the duty schedules for ALL of a doctor's affiliated clinics in a
 * single unified card, with a colour-coded clinic name badge on each section
 * so the doctor can instantly tell which schedule belongs to which branch.
 */
export function ConsolidatedDutyScheduleCard({ affiliations }: ConsolidatedDutyScheduleCardProps) {
  const branchSchedules = useAllBranchesDutySchedules(affiliations);

  if (!affiliations.length) {
    return (
      <section className="min-w-0 rounded-2xl border border-sky-100 bg-white p-5 shadow-xs sm:p-8">
        <header className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
          <CalendarDays className="h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
          <h2 className="text-sm font-semibold uppercase text-slate-600">DUTY SCHEDULE — ALL CLINICS</h2>
        </header>
        <p className="mt-4 text-sm text-slate-400">No clinic affiliations found.</p>
      </section>
    );
  }

  return (
    <section
      className="min-w-0 rounded-2xl border border-sky-100 bg-white shadow-xs overflow-hidden"
      aria-label="Consolidated duty schedule — all clinics"
    >
      {/* Card header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-8">
        <div className="flex items-center gap-2.5">
          <CalendarDays className="h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
          <h2 className="text-sm font-semibold uppercase text-slate-600">DUTY SCHEDULE — ALL CLINICS</h2>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-600">
          <Clock className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
          <span>Clinic Hours</span>
        </div>
      </header>

      {/* One section per branch */}
      <div className="divide-y divide-slate-100">
        {branchSchedules.map((entry, idx) => {
          const { affiliation, schedule, loading, error } = entry;
          const clinicName = affiliation.clinic?.name || "Clinic Branch";
          const headerColor = BRANCH_HEADER_COLORS[idx % BRANCH_HEADER_COLORS.length];
          const days = ALL_DAYS_OF_WEEK.filter(
            (day) => day !== "Sunday" || schedule?.weeklyShifts.Sunday?.length
          );

          return (
            <div key={affiliation.clinic_id} aria-label={`${clinicName} duty schedule`} aria-busy={loading}>
              {/* Branch header with colour-coded clinic badge */}
              <div className={`flex items-center gap-2.5 px-5 py-3 sm:px-8 border-b ${headerColor}`}>
                <span className="text-xs font-semibold text-blue-700">
                  {clinicName}
                </span>
                {loading && (
                  <span className="ml-auto text-[11px] text-slate-400 animate-pulse">Loading…</span>
                )}
                {error && !loading && (
                  <span className="ml-auto text-[11px] text-red-500">Could not load</span>
                )}
              </div>

              {/* Weekly grid */}
              <div className="px-5 pb-4 pt-3 sm:px-8" role="region" aria-label={`${clinicName} weekly hours`}>
                {loading ? (
                  <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] divide-x divide-slate-100">
                    {ALL_DAYS_OF_WEEK.filter((d) => d !== "Sunday").map((day) => (
                      <div key={day} className="flex min-h-16 flex-col gap-1 px-3 py-3">
                        <span className="text-sm font-medium text-slate-500">{day}</span>
                        <span aria-hidden="true" className="mt-1 h-4 w-28 max-w-full animate-pulse rounded bg-slate-100" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid w-full min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] divide-x divide-slate-100">
                    {days.map((day) => (
                      <div key={day} className="flex min-h-16 min-w-0 flex-col gap-1 px-3 py-3">
                        <span className="text-sm font-medium text-slate-500">{day}</span>
                        {!error && schedule?.weeklyShifts[day]?.length ? (
                          schedule.weeklyShifts[day].map((shift, i) => (
                            <span key={shift.id || i} className="text-sm font-semibold leading-6 text-slate-900">
                              {formatTime12h(shift.startTime)} – {formatTime12h(shift.endTime)}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm leading-6 text-slate-400">
                            {error ? "—" : "Not Scheduled"}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <footer className="flex items-start gap-2 border-t border-slate-100 px-5 py-3 sm:px-8 text-xs leading-5 text-slate-400">
        <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0">Consolidated assigned clinic roster · {affiliations.length} branch{affiliations.length !== 1 ? "es" : ""}</span>
      </footer>
    </section>
  );
}
