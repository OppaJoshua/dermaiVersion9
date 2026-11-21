import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock,
  Edit3,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  ALL_DAYS_OF_WEEK,
  formatTime12h,
  generateTimeOptionsForClinicHours,
  minutesToTime,
  normalizeDayName,
  timeToMinutes,
  validateDoctorShifts,
  type DoctorShift,
  type DoctorWeeklySchedule,
} from "@/lib/schedulingService";
import {
  useAllBranchesDutySchedules,
  useDoctorDutySchedule,
} from "@/hooks/useDoctorDutySchedule";
import type { DoctorAffiliatedClinic } from "@/lib/doctorBranches";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import {
  fetchDoctorOtherBranchSchedules,
  saveAuthorizedDoctorDutySchedule,
} from "@/lib/doctorDutySchedule";
import {
  findCrossClinicDutyConflicts,
  type DoctorDutyAssignment,
} from "@/lib/doctorScheduleConflicts";

type DoctorDutyScheduleCardProps = {
  doctorId: string | null;
  clinicId: string | null;
  clinicName: string;
};

export function DoctorDutyScheduleCard({
  doctorId,
  clinicId,
  clinicName,
}: DoctorDutyScheduleCardProps) {
  const roster = useDoctorDutySchedule(doctorId, clinicId);
  return (
    <DoctorDutyScheduleView
      clinicName={clinicName}
      doctorId={doctorId}
      clinicId={clinicId}
      editable={Boolean(doctorId && clinicId)}
      {...roster}
    />
  );
}

type DoctorDutyScheduleViewProps = {
  clinicName: string;
  schedule: DoctorWeeklySchedule | null;
  loading?: boolean;
  error?: boolean;
  doctorId?: string | null;
  clinicId?: string | null;
  editable?: boolean;
  onRefresh?: () => void;
};

type ScheduleDraftEntry = {
  id: string;
  day: string;
  startTime: string;
  endTime: string;
  slotIntervalMinutes?: number;
};

function buildDraftEntriesFromSchedule(
  schedule: DoctorWeeklySchedule | null
): ScheduleDraftEntry[] {
  if (!schedule || !schedule.weeklyShifts) return [];
  const entries: ScheduleDraftEntry[] = [];
  ALL_DAYS_OF_WEEK.forEach((day) => {
    const dayShifts = schedule.weeklyShifts[day] || [];
    dayShifts.forEach((shift, idx) => {
      if (shift && shift.startTime && shift.endTime) {
        entries.push({
          id: shift.id || `shift-${day.toLowerCase()}-${idx + 1}`,
          day,
          startTime: shift.startTime.slice(0, 5),
          endTime: shift.endTime.slice(0, 5),
          slotIntervalMinutes: shift.slotIntervalMinutes,
        });
      }
    });
  });
  return entries;
}

function buildWeeklyShiftsFromDraftEntries(entries: ScheduleDraftEntry[]): {
  dutyDays: string[];
  weeklyShifts: Record<string, DoctorShift[]>;
} {
  const weeklyShifts: Record<string, DoctorShift[]> = {};
  ALL_DAYS_OF_WEEK.forEach((d) => {
    weeklyShifts[d] = [];
  });

  entries.forEach((entry) => {
    const normDay = normalizeDayName(entry.day);
    if (!normDay || !weeklyShifts[normDay]) return;
    const nextIdx = weeklyShifts[normDay].length + 1;
    weeklyShifts[normDay].push({
      id: entry.id || `shift-${normDay.toLowerCase()}-${nextIdx}`,
      label:
        nextIdx === 1
          ? "Morning Shift"
          : nextIdx === 2
          ? "Afternoon Shift"
          : `Shift ${nextIdx}`,
      startTime: entry.startTime,
      endTime: entry.endTime,
      slotIntervalMinutes: entry.slotIntervalMinutes,
    });
  });

  // Sort each day's shifts chronologically by startTime
  ALL_DAYS_OF_WEEK.forEach((day) => {
    weeklyShifts[day].sort(
      (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime)
    );
  });

  const dutyDays = ALL_DAYS_OF_WEEK.filter(
    (day) => weeklyShifts[day] && weeklyShifts[day].length > 0
  );

  return { dutyDays, weeklyShifts };
}

interface BranchDutyScheduleEditorProps {
  doctorId: string;
  clinicId: string;
  clinicName: string;
  doctorName: string;
  userId?: string | null;
  initialSchedule: DoctorWeeklySchedule | null;
  otherBranchAssignments?: DoctorDutyAssignment[];
  onSaved: () => void;
  onCancel: () => void;
}

function BranchDutyScheduleEditor({
  doctorId,
  clinicId,
  clinicName,
  doctorName,
  userId,
  initialSchedule,
  otherBranchAssignments,
  onSaved,
  onCancel,
}: BranchDutyScheduleEditorProps) {
  const [entries, setEntries] = useState<ScheduleDraftEntry[]>(() =>
    buildDraftEntriesFromSchedule(initialSchedule)
  );
  const [clinicOpenTime, setClinicOpenTime] = useState("08:00");
  const [clinicCloseTime, setClinicCloseTime] = useState("21:00");
  const [clinicOperatingDays, setClinicOperatingDays] = useState("Monday - Sunday");
  const [otherAssignments, setOtherAssignments] = useState<DoctorDutyAssignment[]>(
    () => otherBranchAssignments || []
  );
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadBranchContext() {
      try {
        const { data: opData } = await supabase
          .from("clinic_operating_hours")
          .select("open_time, close_time, day_of_week")
          .eq("clinic_id", clinicId)
          .maybeSingle();

        if (!cancelled && opData) {
          if (opData.open_time) setClinicOpenTime(String(opData.open_time).slice(0, 5));
          if (opData.close_time) setClinicCloseTime(String(opData.close_time).slice(0, 5));
          if (opData.day_of_week) setClinicOperatingDays(String(opData.day_of_week));
        }
      } catch {
        // Use safe default operating hours if lookup fails
      }

      if (!otherBranchAssignments || otherBranchAssignments.length === 0) {
        try {
          const rows = await fetchDoctorOtherBranchSchedules(
            supabase,
            doctorId,
            clinicId,
            userId
          );
          if (!cancelled) setOtherAssignments(rows);
        } catch {
          if (!cancelled) setOtherAssignments([]);
        }
      }
    }

    void loadBranchContext();
    return () => {
      cancelled = true;
    };
  }, [clinicId, doctorId, userId, otherBranchAssignments]);

  const timeOptions = useMemo(() => {
    return generateTimeOptionsForClinicHours("06:00", "22:00", 30);
  }, []);

  const draftSchedule = useMemo(
    () => buildWeeklyShiftsFromDraftEntries(entries),
    [entries]
  );

  // Live cross-clinic conflict detection
  const liveCrossClinicConflicts = useMemo(() => {
    return findCrossClinicDutyConflicts(otherAssignments, {
      doctorId,
      clinicId,
      doctorName,
      days: draftSchedule.dutyDays,
      weeklyShifts: draftSchedule.weeklyShifts,
      perspective: "doctor",
    });
  }, [otherAssignments, doctorId, clinicId, doctorName, draftSchedule]);

  // Live intra-day validation errors
  const liveShiftErrors = useMemo(() => {
    const errs: string[] = [];
    for (const day of draftSchedule.dutyDays) {
      const shifts = draftSchedule.weeklyShifts[day] || [];
      const dayErrors = validateDoctorShifts(
        shifts,
        day,
        clinicOpenTime,
        clinicCloseTime,
        clinicOperatingDays
      );
      dayErrors.forEach((e) => errs.push(e.message));
    }
    return errs;
  }, [draftSchedule, clinicOpenTime, clinicCloseTime, clinicOperatingDays]);

  const handleAddSchedule = () => {
    setErrorMessage("");
    const existingDays = new Set(entries.map((e) => e.day));
    const nextAvailableDay =
      ALL_DAYS_OF_WEEK.find((d) => !existingDays.has(d)) || "Monday";

    let defaultStart = clinicOpenTime || "08:00";
    let defaultEnd = "12:00";

    const sameDayEntries = entries.filter((e) => e.day === nextAvailableDay);
    if (sameDayEntries.length > 0) {
      const last = sameDayEntries[sameDayEntries.length - 1];
      const lastEndM = timeToMinutes(last.endTime);
      const closeM = timeToMinutes(clinicCloseTime || "20:00");
      const candidateStartM = Math.min(closeM - 60, Math.max(lastEndM + 60, 13 * 60));
      const candidateEndM = Math.min(closeM, candidateStartM + 4 * 60);
      if (candidateStartM < candidateEndM) {
        defaultStart = minutesToTime(candidateStartM);
        defaultEnd = minutesToTime(candidateEndM);
      }
    } else {
      const openM = timeToMinutes(defaultStart);
      const closeM = timeToMinutes(clinicCloseTime || "17:00");
      const targetEndM = Math.min(closeM, Math.max(openM + 4 * 60, 12 * 60));
      defaultEnd = minutesToTime(targetEndM);
    }

    setEntries((prev) => [
      ...prev,
      {
        id: `shift-${nextAvailableDay.toLowerCase()}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 6)}`,
        day: nextAvailableDay,
        startTime: defaultStart,
        endTime: defaultEnd,
      },
    ]);
  };

  const handleUpdateEntry = (
    id: string,
    field: "day" | "startTime" | "endTime",
    value: string
  ) => {
    setErrorMessage("");
    setEntries((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const handleRemoveEntry = (id: string) => {
    setErrorMessage("");
    setEntries((prev) => prev.filter((item) => item.id !== id));
  };

  const handleSave = async () => {
    setErrorMessage("");
    if (liveCrossClinicConflicts.length > 0) {
      setErrorMessage(liveCrossClinicConflicts[0].doctorPerspectiveMessage);
      return;
    }
    if (liveShiftErrors.length > 0) {
      setErrorMessage(liveShiftErrors[0]);
      return;
    }

    setSaving(true);
    try {
      await saveAuthorizedDoctorDutySchedule({
        client: supabase,
        doctorId,
        clinicId,
        clinicName,
        doctorName,
        userId,
        actorRole: "doctor",
        dutyDays: draftSchedule.dutyDays,
        weeklyShifts: draftSchedule.weeklyShifts,
        slotIntervalMinutes: initialSchedule?.slotIntervalMinutes ?? 30,
        maxPatientsPerShift: initialSchedule?.maxPatientsPerShift,
        clinicOpenTime,
        clinicCloseTime,
        clinicOperatingDays,
      });
      onSaved();
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Could not save duty schedule. Please try again.";
      setErrorMessage(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="mt-3 rounded-xl border border-blue-100 bg-slate-50/70 p-4"
      aria-label={`Edit duty schedule for ${clinicName}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">
            Manage Duty Schedule · {clinicName}
          </h3>
          <p className="text-[11px] text-slate-500">
            Add, edit, or remove your duty days and consultation hours for this clinic branch.
          </p>
        </div>
        <button
          type="button"
          onClick={handleAddSchedule}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs transition hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>+ Add Schedule</span>
        </button>
      </div>

      {/* Live Conflict / Validation Alerts */}
      {(errorMessage || liveCrossClinicConflicts.length > 0 || liveShiftErrors.length > 0) && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
          <div className="space-y-1">
            {errorMessage ? (
              <p className="font-semibold">{errorMessage}</p>
            ) : liveCrossClinicConflicts.length > 0 ? (
              <p className="font-semibold">
                {liveCrossClinicConflicts[0].doctorPerspectiveMessage}
              </p>
            ) : (
              <p className="font-semibold">{liveShiftErrors[0]}</p>
            )}
          </div>
        </div>
      )}

      {/* Duty Rows */}
      <div className="mt-3 space-y-2.5">
        {entries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-5 text-center">
            <p className="text-xs font-medium text-slate-600">
              No duty days configured for {clinicName} (Off Duty).
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              Click <strong>+ Add Schedule</strong> to assign a duty day and time, or click{" "}
              <strong>Save Changes</strong> to set yourself Off Duty at this branch.
            </p>
          </div>
        ) : (
          entries.map((entry, idx) => (
            <div
              key={entry.id}
              className="flex flex-wrap items-center gap-2.5 rounded-lg border border-slate-200 bg-white p-2.5 shadow-2xs"
            >
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[11px] font-bold text-blue-700">
                {idx + 1}
              </span>

              {/* Day of Week Selector */}
              <div className="min-w-[8.5rem] flex-1 sm:flex-none">
                <label className="sr-only" htmlFor={`day-select-${entry.id}`}>
                  Day of the week
                </label>
                <select
                  id={`day-select-${entry.id}`}
                  aria-label="Day of the week"
                  value={entry.day}
                  disabled={saving}
                  onChange={(e) => handleUpdateEntry(entry.id, "day", e.target.value)}
                  className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-800 focus:border-blue-600 focus:outline-none"
                >
                  {ALL_DAYS_OF_WEEK.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </select>
              </div>

              {/* Start Time Selector */}
              <div className="min-w-[7.5rem] flex-1 sm:flex-none">
                <label className="sr-only" htmlFor={`start-select-${entry.id}`}>
                  Start time
                </label>
                <select
                  id={`start-select-${entry.id}`}
                  aria-label="Duty start time"
                  value={entry.startTime}
                  disabled={saving}
                  onChange={(e) =>
                    handleUpdateEntry(entry.id, "startTime", e.target.value)
                  }
                  className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-800 focus:border-blue-600 focus:outline-none"
                >
                  {timeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <span className="text-xs font-medium text-slate-400">to</span>

              {/* End Time Selector */}
              <div className="min-w-[7.5rem] flex-1 sm:flex-none">
                <label className="sr-only" htmlFor={`end-select-${entry.id}`}>
                  End time
                </label>
                <select
                  id={`end-select-${entry.id}`}
                  aria-label="Duty end time"
                  value={entry.endTime}
                  disabled={saving}
                  onChange={(e) =>
                    handleUpdateEntry(entry.id, "endTime", e.target.value)
                  }
                  className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-800 focus:border-blue-600 focus:outline-none"
                >
                  {timeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Remove Shift / Duty Day Button */}
              <button
                type="button"
                onClick={() => handleRemoveEntry(entry.id)}
                disabled={saving}
                aria-label={`Remove ${entry.day} ${formatTime12h(entry.startTime)} to ${formatTime12h(entry.endTime)} schedule`}
                className="ml-auto inline-flex items-center gap-1 rounded-lg border border-red-100 bg-red-50/70 px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-100 disabled:opacity-50 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Remove</span>
              </button>
            </div>
          ))
        )}
      </div>

      {/* Action Footer */}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200/80 pt-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Cancel</span>
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white shadow-2xs transition hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span>{saving ? "Saving…" : "Save Changes"}</span>
        </button>
      </div>
    </div>
  );
}

// The same presentation is used for authenticated doctor pages and the clinic's
// doctor details, where the authorized roster has already been fetched.
export function DoctorDutyScheduleView({
  clinicName,
  schedule,
  loading = false,
  error = false,
  doctorId = null,
  clinicId = null,
  editable = false,
  onRefresh,
}: DoctorDutyScheduleViewProps) {
  const { user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [savedBanner, setSavedBanner] = useState(false);

  const name = clinicName || "No clinic selected";
  const days = ALL_DAYS_OF_WEEK.filter(
    (day) => day !== "Sunday" || schedule?.weeklyShifts.Sunday?.length
  );

  const doctorName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "Doctor";

  return (
    <section
      className="min-w-0 rounded-2xl border border-sky-100 bg-white p-5 shadow-xs sm:p-8"
      aria-label={`${name} duty schedule`}
      aria-busy={loading}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2.5">
          <CalendarDays className="h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
          <h2 className="text-sm font-semibold uppercase text-slate-600">DUTY SCHEDULE</h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <Clock className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
            <span>Clinic Hours</span>
          </div>
          {editable && doctorId && clinicId && !loading && (
            <button
              type="button"
              onClick={() => {
                setSavedBanner(false);
                setIsEditing((prev) => !prev);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 cursor-pointer"
            >
              <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isEditing ? "Close Editor" : "Edit Schedule"}</span>
            </button>
          )}
        </div>
      </header>

      <p className="mb-4 mt-4 text-sm font-semibold text-blue-600 wrap-anywhere">{name}</p>
      {error && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          Could not load this clinic’s roster. Please try again.
        </p>
      )}
      {savedBanner && (
        <div
          role="status"
          className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
          <span>Duty schedule updated and synchronized across all portals.</span>
        </div>
      )}
      {loading && <span role="status" className="sr-only">Loading duty schedule…</span>}

      {isEditing && doctorId && clinicId ? (
        <BranchDutyScheduleEditor
          doctorId={doctorId}
          clinicId={clinicId}
          clinicName={name}
          doctorName={doctorName}
          userId={user?.id}
          initialSchedule={schedule}
          onCancel={() => setIsEditing(false)}
          onSaved={() => {
            setIsEditing(false);
            setSavedBanner(true);
            setTimeout(() => setSavedBanner(false), 4500);
            onRefresh?.();
          }}
        />
      ) : (
        <div className="min-w-0 pb-1" role="region" aria-label="Weekly duty hours">
          <div className="grid w-full min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] divide-x divide-slate-100">
            {days.map((day) => (
              <div key={day} className="flex min-h-22 min-w-0 flex-col gap-1 px-3 py-3">
                <span className="text-sm font-medium text-slate-500">{day}</span>
                {loading ? (
                  <span
                    aria-hidden="true"
                    className="mt-1 h-4 w-36 max-w-full animate-pulse rounded bg-slate-100"
                  />
                ) : !error && schedule?.weeklyShifts[day]?.length ? (
                  schedule.weeklyShifts[day].map((shift, index) => (
                    <span
                      key={shift.id || index}
                      className="text-sm font-semibold leading-6 text-slate-900"
                    >
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
        </div>
      )}

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
 * single unified card, with an Edit Schedule button for each clinic branch
 * and multi-clinic conflict detection across all branches.
 */
export function ConsolidatedDutyScheduleCard({
  affiliations,
}: ConsolidatedDutyScheduleCardProps) {
  const { user } = useAuth();
  const branchSchedules = useAllBranchesDutySchedules(affiliations);
  const [editingClinicId, setEditingClinicId] = useState<string | null>(null);
  const [savedClinicId, setSavedClinicId] = useState<string | null>(null);

  const doctorName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "Doctor";

  // Pre-build DoctorDutyAssignment objects from all loaded branches for instant cross-clinic conflict detection
  const allLoadedAssignments = useMemo<DoctorDutyAssignment[]>(() => {
    return branchSchedules.map((b) => ({
      doctor_id: b.affiliation.doctor_id,
      clinic_id: b.affiliation.clinic_id,
      duty_days: b.schedule
        ? ALL_DAYS_OF_WEEK.filter((d) => b.schedule?.weeklyShifts[d]?.length)
        : [],
      duty_schedule: b.schedule
        ? {
            weeklyShifts: b.schedule.weeklyShifts,
            slotIntervalMinutes: b.schedule.slotIntervalMinutes,
            isCustomSchedule: true,
          }
        : null,
      clinic: { name: b.affiliation.clinic?.name || "Clinic Branch" },
    }));
  }, [branchSchedules]);

  if (!affiliations.length) {
    return (
      <section className="min-w-0 rounded-2xl border border-sky-100 bg-white p-5 shadow-xs sm:p-8">
        <header className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
          <CalendarDays className="h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
          <h2 className="text-sm font-semibold uppercase text-slate-600">
            DUTY SCHEDULE — ALL CLINICS
          </h2>
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
          <h2 className="text-sm font-semibold uppercase text-slate-600">
            DUTY SCHEDULE — ALL CLINICS
          </h2>
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
          const isEditingThisBranch = editingClinicId === affiliation.clinic_id;
          const isSavedThisBranch = savedClinicId === affiliation.clinic_id;

          return (
            <div
              key={affiliation.clinic_id}
              aria-label={`${clinicName} duty schedule`}
              aria-busy={loading}
            >
              {/* Branch header with colour-coded clinic badge and Edit Schedule button */}
              <div
                className={`flex flex-wrap items-center justify-between gap-2.5 px-5 py-3 sm:px-8 border-b ${headerColor}`}
              >
                <span className="text-xs font-semibold text-blue-700">{clinicName}</span>
                <div className="flex items-center gap-2.5">
                  {loading && (
                    <span className="text-[11px] text-slate-400 animate-pulse">
                      Loading…
                    </span>
                  )}
                  {error && !loading && (
                    <span className="text-[11px] text-red-500">Could not load</span>
                  )}
                  {!loading && affiliation.doctor_id && affiliation.clinic_id && (
                    <button
                      type="button"
                      onClick={() => {
                        setSavedClinicId(null);
                        setEditingClinicId((prev) =>
                          prev === affiliation.clinic_id ? null : affiliation.clinic_id
                        );
                      }}
                      aria-label={`Edit schedule for ${clinicName}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 shadow-2xs transition hover:bg-blue-50 cursor-pointer"
                    >
                      <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{isEditingThisBranch ? "Close Editor" : "Edit Schedule"}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Weekly grid or branch schedule editor */}
              <div
                className="px-5 pb-4 pt-3 sm:px-8"
                role="region"
                aria-label={`${clinicName} weekly hours`}
              >
                {isSavedThisBranch && (
                  <div
                    role="status"
                    className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700"
                  >
                    <CheckCircle2
                      className="h-4 w-4 shrink-0 text-emerald-600"
                      aria-hidden="true"
                    />
                    <span>
                      {clinicName} duty schedule saved and synchronized in real time.
                    </span>
                  </div>
                )}

                {isEditingThisBranch ? (
                  <BranchDutyScheduleEditor
                    doctorId={affiliation.doctor_id}
                    clinicId={affiliation.clinic_id}
                    clinicName={clinicName}
                    doctorName={doctorName}
                    userId={user?.id}
                    initialSchedule={schedule}
                    otherBranchAssignments={allLoadedAssignments.filter(
                      (a) => a.clinic_id !== affiliation.clinic_id
                    )}
                    onCancel={() => setEditingClinicId(null)}
                    onSaved={() => {
                      setEditingClinicId(null);
                      setSavedClinicId(affiliation.clinic_id);
                      setTimeout(() => {
                        setSavedClinicId((curr) =>
                          curr === affiliation.clinic_id ? null : curr
                        );
                      }, 4500);
                    }}
                  />
                ) : loading ? (
                  <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] divide-x divide-slate-100">
                    {ALL_DAYS_OF_WEEK.filter((d) => d !== "Sunday").map((day) => (
                      <div key={day} className="flex min-h-16 flex-col gap-1 px-3 py-3">
                        <span className="text-sm font-medium text-slate-500">{day}</span>
                        <span
                          aria-hidden="true"
                          className="mt-1 h-4 w-28 max-w-full animate-pulse rounded bg-slate-100"
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid w-full min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] divide-x divide-slate-100">
                    {days.map((day) => (
                      <div
                        key={day}
                        className="flex min-h-16 min-w-0 flex-col gap-1 px-3 py-3"
                      >
                        <span className="text-sm font-medium text-slate-500">{day}</span>
                        {!error && schedule?.weeklyShifts[day]?.length ? (
                          schedule.weeklyShifts[day].map((shift, i) => (
                            <span
                              key={shift.id || i}
                              className="text-sm font-semibold leading-6 text-slate-900"
                            >
                              {formatTime12h(shift.startTime)} –{" "}
                              {formatTime12h(shift.endTime)}
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
        <span className="min-w-0">
          Consolidated assigned clinic roster · {affiliations.length} branch
          {affiliations.length !== 1 ? "es" : ""}
        </span>
      </footer>
    </section>
  );
}
