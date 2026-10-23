import type { SupabaseClient } from "@supabase/supabase-js";

export async function fetchClinicDoctorRows(
  client: SupabaseClient, clinicId: string | null, userId: string | undefined, selection: string,
) {
  if (!clinicId || !userId) return [];
  // A cached clinic ID is a hint, never evidence of ownership.
  const { data: clinic, error: clinicError } = await client.from("clinic")
    .select("clinic_id").eq("clinic_id", clinicId).eq("owner_user_id", userId).maybeSingle();
  if (clinicError) throw clinicError;
  if (!clinic) return [];

  const rows: any[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from("clinic_doctor").select(selection)
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false }).order("doctor_id")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}
