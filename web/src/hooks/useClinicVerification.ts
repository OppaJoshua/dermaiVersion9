import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

export type ClinicVerificationStatus = "pending" | "verified" | "rejected";

interface ClinicProfile {
  status: ClinicVerificationStatus;
  clinicName: string;
  clinicLogo: string;
  clinicId: string | null;
  loading: boolean;
}

export function useClinicVerification(): ClinicProfile {
  const [profile, setProfile] = useState<ClinicProfile>({
    status: "pending",
    clinicName: "",
    clinicLogo: "",
    clinicId: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;

      if (!userId) {
        if (!cancelled) {
          setProfile({ status: "pending", clinicName: "Clinic Portal", clinicLogo: "", clinicId: null, loading: false });
        }
        return;
      }

      const { data, error } = await supabase
        .from("clinic")
        .select("clinic_id, name, status")
        .eq("owner_user_id", userId)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        setProfile({ status: "pending", clinicName: "Clinic Portal", clinicLogo: "", clinicId: null, loading: false });
        return;
      }

      // Map Supabase status values → UI status values
      const statusMap: Record<string, ClinicVerificationStatus> = {
        approved: "verified",
        pending: "pending",
        rejected: "rejected",
        suspended: "rejected",
      };

      // Try to get logo from clinic_photo
      const { data: photos } = await supabase
        .from("clinic_photo")
        .select("photo_url")
        .eq("clinic_id", data.clinic_id)
        .order("sort_order")
        .limit(1);

      if (!cancelled) {
        setProfile({
          status: statusMap[data.status] ?? "pending",
          clinicName: data.name,
          clinicLogo: photos?.[0]?.photo_url ?? "",
          clinicId: data.clinic_id,
          loading: false,
        });
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return profile;
}
