// TODO: replace with real clinic auth/session lookup (e.g. Supabase clinic session).

export type ClinicVerificationStatus = "pending" | "verified" | "rejected";

export function useClinicVerification(): { status: ClinicVerificationStatus; clinicName: string } {
  return { status: "pending", clinicName: "" };
}
