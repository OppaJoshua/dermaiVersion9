import type { SupabaseClient } from "@supabase/supabase-js";

export interface DoctorAffiliatedClinic {
  doctor_id: string;
  doctor_name: string;
  clinic_id: string;
  clinic: { clinic_id: string; name: string; address?: string; status?: string; logo_url?: string | null } | null;
  photo_url?: string;
  email?: string;
  prc_license?: string;
  contact_number?: string;
  specializations?: string[];
}

export function resolveDoctorBranch(selection: string, affiliations: DoctorAffiliatedClinic[]): string {
  if (!affiliations.length) return "";
  if (affiliations.length === 1) return affiliations[0].clinic_id;
  return selection === "all" || affiliations.some(branch => branch.clinic_id === selection) ? selection : "all";
}

function resolveClinicLogoUrl(client: SupabaseClient, value?: string | null): string | null {
  const logo = value?.trim();
  if (!logo) return null;
  if (/^(https?:|data:|blob:)/i.test(logo)) return logo;

  // Matches the public bucket used by clinic registration for logo uploads.
  const path = logo.replace(/^\/+/, "").replace(/^clinic-photos\//, "");
  return client.storage.from("clinic-photos").getPublicUrl(path).data.publicUrl;
}

export async function fetchDoctorBranches(client: SupabaseClient, userId?: string): Promise<DoctorAffiliatedClinic[]> {
  if (!userId) return [];
  let { data, error } = await client.from("clinic_doctor")
    .select("doctor_id, doctor_name, clinic_id, status, photo_url, email, prc_license, contact_number, clinic:clinic_id(clinic_id, name, address, status, logo_url), doctor_specializations(specialization_id, specializations(id, name))")
    .eq("user_id", userId)
    .ilike("status", "active")
    .order("created_at", { ascending: true }).order("doctor_id");

  if (error) {
    const fallback = await client.from("clinic_doctor")
      .select("doctor_id, doctor_name, clinic_id, status, photo_url, clinic:clinic_id(clinic_id, name, address, status, logo_url)")
      .eq("user_id", userId)
      .ilike("status", "active")
      .order("created_at", { ascending: true }).order("doctor_id");
    if (fallback.error) throw fallback.error;
    data = fallback.data as any;
  }

  const branches = new Map<string, DoctorAffiliatedClinic>();
  for (const record of (data || []) as any[]) {
    const clinic = Array.isArray(record.clinic) ? record.clinic[0] : record.clinic;
    if (!record.clinic_id || !clinic || branches.has(record.clinic_id)) continue;
    const rawSpecs = Array.isArray(record.doctor_specializations) ? record.doctor_specializations : [];
    const parsedSpecs = Array.from(
      new Set<string>(
        rawSpecs
          .map((item: any) => {
            const specObj = Array.isArray(item?.specializations)
              ? item.specializations[0]
              : item?.specializations;
            return String(specObj?.name || "").trim();
          })
          .filter(Boolean)
      )
    );
    branches.set(record.clinic_id, {
      doctor_id: record.doctor_id,
      doctor_name: record.doctor_name || "",
      clinic_id: record.clinic_id,
      photo_url: record.photo_url || "",
      email: typeof record.email === "string" ? record.email.trim() : "",
      prc_license: typeof record.prc_license === "string" ? record.prc_license.trim() : "",
      contact_number: typeof record.contact_number === "string" ? record.contact_number.trim() : "",
      specializations: parsedSpecs,
      clinic: {
        clinic_id: clinic.clinic_id,
        name: clinic.name || "Clinic Branch",
        address: clinic.address || "",
        status: clinic.status,
        logo_url: resolveClinicLogoUrl(client, clinic.logo_url),
      },
    });
  }
  return [...branches.values()];
}
