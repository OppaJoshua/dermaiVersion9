import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { fetchDoctorDutySchedule } from "@/lib/doctorDutySchedule";
import type { DoctorWeeklySchedule } from "@/lib/schedulingService";

export function useDoctorDutySchedule(doctorId: string | null, clinicId: string | null) {
  const { user } = useAuth();
  const userId = user?.id || "";
  const scope = `${userId}:${doctorId || ""}:${clinicId || ""}`;
  const [result, setResult] = useState<{ scope: string; schedule: DoctorWeeklySchedule | null; loading: boolean; error: boolean } | null>(null);

  useEffect(() => {
    let disposed = false;
    let requestId = 0;
    const load = async () => {
      const request = ++requestId;
      // Clear before fetching, including realtime/focus refreshes.
      setResult({ scope, schedule: null, loading: true, error: false });
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
    void load();
    if (!userId || !doctorId || !clinicId) return () => { disposed = true; };
    const channel = supabase.channel(`doctor-duty-roster-${userId}-${clinicId}-${doctorId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "clinic_doctor", filter: `doctor_id=eq.${doctorId}` }, () => { void load(); })
      .subscribe();
    window.addEventListener("focus", load);
    window.addEventListener("dermai_doctor_profile_updated", load);
    return () => {
      disposed = true;
      void supabase.removeChannel(channel);
      window.removeEventListener("focus", load);
      window.removeEventListener("dermai_doctor_profile_updated", load);
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
