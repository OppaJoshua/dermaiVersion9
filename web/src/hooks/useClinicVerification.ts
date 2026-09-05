// UI mode: Unlocked clinic account for frontend design review.
// Can be wired to real clinic auth/session lookup (e.g. Supabase clinic session) later.

export type ClinicVerificationStatus = "pending" | "verified" | "rejected";

export function useClinicVerification(): { status: ClinicVerificationStatus; clinicName: string } {
  try {
    const raw = localStorage.getItem("dermai_clinic_settings");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.name) {
        return { status: "verified", clinicName: parsed.name };
      }
    }
  } catch {
    /* ignore */
  }
  return { status: "verified", clinicName: "Clinic Portal" };
}

