import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";

export type ClinicVerificationStatus = "pending" | "verified" | "rejected";

export interface ClinicProfile {
  status: ClinicVerificationStatus;
  clinicName: string;
  clinicLogo: string;
  clinicId: string | null;
  loading: boolean;
}

const CACHE_KEY = "dermai_clinic_profile_cache";

function getCachedProfile(): ClinicProfile | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.status === "string") {
        return {
          status: parsed.status,
          clinicName: parsed.clinicName || "",
          clinicLogo: parsed.clinicLogo || "",
          clinicId: parsed.clinicId || null,
          loading: false,
        };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveCachedProfile(profile: Omit<ClinicProfile, "loading">) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(profile));
    window.dispatchEvent(
      new CustomEvent("dermai_clinic_profile_updated", {
        detail: { ...profile, loading: false },
      })
    );
  } catch {
    /* ignore */
  }
}

export function useClinicVerification(): ClinicProfile {
  const [profile, setProfile] = useState<ClinicProfile>(() => {
    const cached = getCachedProfile();
    if (cached) {
      return cached;
    }
    return {
      status: "pending",
      clinicName: "",
      clinicLogo: "",
      clinicId: null,
      loading: true,
    };
  });

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;

    if (!userId) {
      try {
        localStorage.removeItem(CACHE_KEY);
      } catch {}
      setProfile({ status: "pending", clinicName: "Clinic Portal", clinicLogo: "", clinicId: null, loading: false });
      return;
    }

    const userEmail = session?.user?.email?.toLowerCase().trim();

    // Check by owner_user_id first, then fallback to matching email
    let clinicData: any = null;

    const { data: byOwner } = await supabase
      .from("clinic")
      .select("clinic_id, name, status, logo_url, owner_user_id")
      .eq("owner_user_id", userId)
      .maybeSingle();

    if (byOwner) {
      clinicData = byOwner;
    } else if (userEmail) {
      const { data: byEmail } = await supabase
        .from("clinic")
        .select("clinic_id, name, status, logo_url, owner_user_id")
        .ilike("email", userEmail)
        .maybeSingle();

      if (byEmail) {
        clinicData = byEmail;
        // Auto-link owner_user_id if not set
        if (!byEmail.owner_user_id) {
          await supabase
            .from("clinic")
            .update({ owner_user_id: userId })
            .eq("clinic_id", byEmail.clinic_id);
        }
      }
    }

    if (!clinicData) {
      // Check local storage application snapshot if database not updated yet
      try {
        const stored = localStorage.getItem("dermai_clinic_applications");
        if (stored) {
          const parsed = JSON.parse(stored);
          const matchedLocal = parsed.find((a: any) => a.email?.toLowerCase().trim() === userEmail);
          if (matchedLocal) {
            const nextProfile = {
              status: (matchedLocal.status === "verified" ? "verified" : "pending") as ClinicVerificationStatus,
              clinicName: matchedLocal.name || "My Clinic",
              clinicLogo: matchedLocal.logo || "",
              clinicId: matchedLocal.id || null,
            };
            saveCachedProfile(nextProfile);
            setProfile({ ...nextProfile, loading: false });
            return;
          }
        }
      } catch {
        /* ignore */
      }

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

    // Try to get logo from clinic record or clinic_photo
    let logoUrl = clinicData.logo_url || "";
    if (!logoUrl) {
      const { data: photos } = await supabase
        .from("clinic_photo")
        .select("photo_url")
        .eq("clinic_id", clinicData.clinic_id)
        .order("sort_order")
        .limit(1);
      if (photos?.[0]?.photo_url) {
        logoUrl = photos[0].photo_url;
      }
    }

    const nextProfile = {
      status: statusMap[clinicData.status] ?? "pending",
      clinicName: clinicData.name || "Clinic Portal",
      clinicLogo: logoUrl,
      clinicId: clinicData.clinic_id,
    };

    saveCachedProfile(nextProfile);
    setProfile({ ...nextProfile, loading: false });
  }, []);

  useEffect(() => {
    let active = true;

    const handleSync = (e: Event) => {
      if (!active) return;
      const customEvent = e as CustomEvent<ClinicProfile>;
      if (customEvent.detail) {
        setProfile(customEvent.detail);
      }
    };

    window.addEventListener("dermai_clinic_profile_updated", handleSync);
    load();

    return () => {
      active = false;
      window.removeEventListener("dermai_clinic_profile_updated", handleSync);
    };
  }, [load]);

  return profile;
}

