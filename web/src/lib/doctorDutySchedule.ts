import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAssignedDoctorSchedule } from "./schedulingService.ts";

export const parseAssignedDutySchedule = parseAssignedDoctorSchedule;

export async function fetchDoctorDutySchedule(client: SupabaseClient, doctorId: string, clinicId: string, userId: string) {
  if (!doctorId || !clinicId || !userId) return null;
  const { data, error } = await client.from("clinic_doctor")
    .select("duty_days, duty_schedule, duty_start_time, duty_end_time")
    .eq("doctor_id", doctorId).eq("clinic_id", clinicId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return parseAssignedDutySchedule(data);
}
