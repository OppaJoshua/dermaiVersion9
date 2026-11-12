import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { fetchDoctorDutySchedule } from "@/lib/doctorDutySchedule";
import type { DoctorWeeklySchedule } from "@/lib/schedulingService";
import type { DoctorAffiliatedClinic } from "@/lib/doctorBranches";

export function useDoctorDutySchedule(doctorId: string | null, clinicId: string | null) {
  const { user } = useAuth();
  const userId = user?.id || "";
  const scope = `${userId}:${doctorId || ""}:${clinicId || ""}`;
  const [result, setResult] = useState<{ scope: string; schedule: DoctorWeeklySchedule | null; loading: boolean; error: boolean } | null>(null);

  useEffect(() => {
    let disposed = false;
    let requestId = 0;
    const load = async (isBackground = false) => {
      const request = ++requestId;
      // Clear before fetching on scope changes, but keep existing data on background updates.
      if (!isBackground) {
        setResult({ scope, schedule: null, loading: true, error: false });
      }
      if (!userId || !doctorId || !clinicId) {
        setResult({ scope, schedule: null, loading: false, error: false });
        return;
      }
      try {
        const schedule = await fetchDoctorDutySchedule(supabase, doctorId, clinicId, userId);
        if (!disposed && request === requestId) setResult({ scope, schedule, loading: false, error: false });
      } catch {
        if (!disposed && request === requestId) setResult({ scope, schedule: null, loading: false, error: true });
      }
    };
    void load(false);
    if (!userId || !doctorId || !clinicId) return () => { disposed = true; };
    const handleBackgroundRefresh = () => { void load(true); };
    const channel = supabase.channel(`doctor-duty-roster-${userId}-${clinicId}-${doctorId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "clinic_doctor", filter: `doctor_id=eq.${doctorId}` }, handleBackgroundRefresh)
      .subscribe();
    window.addEventListener("focus", handleBackgroundRefresh);
    window.addEventListener("dermai_doctor_profile_updated", handleBackgroundRefresh);
    return () => {
      disposed = true;
      void supabase.removeChannel(channel);
      window.removeEventListener("focus", handleBackgroundRefresh);
      window.removeEventListener("dermai_doctor_profile_updated", handleBackgroundRefresh);
    };
  }, [userId, doctorId, clinicId, scope]);

  // Suppress the previous result during the switch render, before effects run.
  const current = result?.scope === scope ? result : null;
  return {
    schedule: current?.schedule || null,
    loading: current?.loading ?? Boolean(userId && doctorId && clinicId),
    error: current?.error || false,
  };
}

export interface BranchScheduleEntry {
  affiliation: DoctorAffiliatedClinic;
  schedule: DoctorWeeklySchedule | null;
  loading: boolean;
  error: boolean;
}

/**
 * Fetches duty schedules for ALL of the doctor's affiliated clinic branches in
 * parallel. Used by the "All Clinics (Consolidated)" view in DoctorSettingsPage.
 */
export function useAllBranchesDutySchedules(
  affiliations: DoctorAffiliatedClinic[]
): BranchScheduleEntry[] {
  const { user } = useAuth();
  const userId = user?.id || "";

  const [entries, setEntries] = useState<BranchScheduleEntry[]>(() =>
    affiliations.map((aff) => ({
      affiliation: aff,
      schedule: null,
      loading: Boolean(userId && aff.doctor_id && aff.clinic_id),
      error: false,
    }))
  );

  useEffect(() => {
    if (!userId || !affiliations.length) {
      setEntries(
        affiliations.map((aff) => ({
          affiliation: aff,
          schedule: null,
          loading: false,
          error: false,
        }))
      );
      return;
    }

    let disposed = false;

    // Initialise loading state for each branch
    setEntries(
      affiliations.map((aff) => ({
        affiliation: aff,
        schedule: null,
        loading: true,
        error: false,
      }))
    );

    const fetchAll = async () => {
      await Promise.all(
        affiliations.map(async (aff, idx) => {
          try {
            const schedule = await fetchDoctorDutySchedule(
              supabase,
              aff.doctor_id,
              aff.clinic_id,
              userId
            );
            if (!disposed) {
              setEntries((prev) => {
                const next = [...prev];
                next[idx] = { affiliation: aff, schedule, loading: false, error: false };
                return next;
              });
            }
          } catch {
            if (!disposed) {
              setEntries((prev) => {
                const next = [...prev];
                next[idx] = { affiliation: aff, schedule: null, loading: false, error: true };
                return next;
              });
            }
          }
        })
      );
    };

    void fetchAll();

    const handleRefresh = () => { if (!disposed) void fetchAll(); };
    window.addEventListener("focus", handleRefresh);
    window.addEventListener("dermai_doctor_profile_updated", handleRefresh);

    return () => {
      disposed = true;
      window.removeEventListener("focus", handleRefresh);
      window.removeEventListener("dermai_doctor_profile_updated", handleRefresh);
    };
    // affiliations reference is stable from context; userId rarely changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, affiliations.map((a) => `${a.clinic_id}:${a.doctor_id}`).join(",")]);

  return entries;
}
