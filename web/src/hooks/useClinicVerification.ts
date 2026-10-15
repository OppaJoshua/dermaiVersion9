import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";

export type ClinicVerificationStatus = "pending" | "verified" | "rejected";

export interface ClinicProfile {
  status: ClinicVerificationStatus;
  clinicName: string;
  clinicLogo: string;
  clinicId: string | null;
  loading: boolean;
  refetch?: () => Promise<void>;
}

const CACHE_KEY = "dermai_clinic_profile_cache";

function getCachedProfile(): ClinicProfile | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.status === "string") {
        return {
          status: parsed.status as ClinicVerificationStatus,
          clinicName: parsed.clinicName || "",
          clinicLogo: parsed.clinicLogo || "",
          clinicId: parsed.clinicId || null,
          loading: false,
        };
      }
    }

    // Secondary fallback: check dermai_clinic_settings
    const settingsRaw = localStorage.getItem("dermai_clinic_settings");
    if (settingsRaw) {
      const parsed = JSON.parse(settingsRaw);
      if (parsed?.status === "verified" || parsed?.status === "approved") {
        return {
          status: "verified",
          clinicName: parsed.name || "",
          clinicLogo: parsed.logo || "",
          clinicId: parsed.id || null,
          loading: false,
        };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

// Module-level reactive singleton store so layout and pages share identical state
let inMemoryProfile: ClinicProfile = getCachedProfile() || {
  status: "pending",
  clinicName: "",
  clinicLogo: "",
  clinicId: null,
  loading: true,
};

const listeners = new Set<(profile: ClinicProfile) => void>();

function notifyListeners(profile: ClinicProfile) {
  inMemoryProfile = profile;
  listeners.forEach((fn) => {
    try {
      fn(profile);
    } catch {
      /* ignore */
    }
  });
}

function saveCachedProfile(profile: Omit<ClinicProfile, "loading">) {
  try {
    const fullProfile: ClinicProfile = { ...profile, loading: false };
    localStorage.setItem(CACHE_KEY, JSON.stringify(fullProfile));

    // When verified, also heal local storage applications & settings so they never revert to pending
    if (profile.status === "verified") {
      try {
        const appsRaw = localStorage.getItem("dermai_clinic_applications");
        if (appsRaw) {
          const apps = JSON.parse(appsRaw);
          if (Array.isArray(apps)) {
            let changed = false;
            const updated = apps.map((a: any) => {
              if (
                (profile.clinicId && String(a.id) === String(profile.clinicId)) ||
                (profile.clinicName && a.name && a.name.toLowerCase().trim() === profile.clinicName.toLowerCase().trim())
              ) {
                if (a.status !== "verified") {
                  changed = true;
                  return { ...a, status: "verified" };
                }
              }
              return a;
            });
            if (changed) {
              localStorage.setItem("dermai_clinic_applications", JSON.stringify(updated));
            }
          }
        }
      } catch {}

      try {
        const settingsRaw = localStorage.getItem("dermai_clinic_settings");
        if (settingsRaw) {
          const parsedSettings = JSON.parse(settingsRaw);
          if (parsedSettings && parsedSettings.status !== "verified") {
            parsedSettings.status = "verified";
            localStorage.setItem("dermai_clinic_settings", JSON.stringify(parsedSettings));
          }
        }
      } catch {}
    }

    notifyListeners(fullProfile);
    window.dispatchEvent(
      new CustomEvent("dermai_clinic_profile_updated", {
        detail: fullProfile,
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
      inMemoryProfile = cached;
      return cached;
    }
    return inMemoryProfile;
  });

  const loadInProgressRef = useRef(false);

  const load = useCallback(async () => {
    if (loadInProgressRef.current) return;
    loadInProgressRef.current = true;

    try {
      // 1. Resolve session with auto-refresh fallback
      let session = (await supabase.auth.getSession()).data.session;
      if (!session) {
        // Attempt getUser which triggers a token refresh if token expired
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user) {
          session = (await supabase.auth.getSession()).data.session;
        }
      }

      const userId = session?.user?.id;
      const userEmail = session?.user?.email?.toLowerCase().trim();

      // If session is temporarily null or loading:
      if (!userId) {
        // Anti-downgrade safeguard: DO NOT remove CACHE_KEY on transient session delay!
        const cached = getCachedProfile();
        if (cached && cached.status === "verified") {
          notifyListeners({ ...cached, loading: false });
        } else {
          notifyListeners({
            status: "pending",
            clinicName: "Clinic Portal",
            clinicLogo: "",
            clinicId: null,
            loading: false,
          });
        }
        return;
      }

      const cached = getCachedProfile();
      const knownClinicId = cached?.clinicId || inMemoryProfile.clinicId;

      let clinicData: any = null;

      // Strategy A: By clinic_id directly if known
      if (knownClinicId) {
        try {
          const { data: byId, error: errId } = await supabase
            .from("clinic")
            .select("clinic_id, name, status, verified, logo_url, owner_user_id, email")
            .eq("clinic_id", knownClinicId)
            .maybeSingle();

          if (byId && !errId) {
            clinicData = byId;
          }
        } catch {
          /* ignore */
        }
      }

      // Strategy B: By owner_user_id
      if (!clinicData) {
        try {
          const { data: byOwner, error: errOwner } = await supabase
            .from("clinic")
            .select("clinic_id, name, status, verified, logo_url, owner_user_id, email")
            .eq("owner_user_id", userId)
            .maybeSingle();

          if (byOwner && !errOwner) {
            clinicData = byOwner;
          }
        } catch {
          /* ignore */
        }
      }

      // Strategy C: By clinic email
      if (!clinicData && userEmail) {
        try {
          const { data: byEmail, error: errEmail } = await supabase
            .from("clinic")
            .select("clinic_id, name, status, verified, logo_url, owner_user_id, email")
            .ilike("email", userEmail)
            .maybeSingle();

          if (byEmail && !errEmail) {
            clinicData = byEmail;
          }
        } catch {
          /* ignore */
        }
      }

      // Handle successful DB retrieval
      if (clinicData) {
        // Auto-link owner_user_id if missing
        if (!clinicData.owner_user_id && userId) {
          try {
            await supabase
              .from("clinic")
              .update({ owner_user_id: userId, verified: true })
              .eq("clinic_id", clinicData.clinic_id);
          } catch {}
        }

        // Auto-ensure verified = true in DB if status is approved
        if ((clinicData.status === "approved" || clinicData.status === "verified") && !clinicData.verified) {
          try {
            await supabase
              .from("clinic")
              .update({ verified: true })
              .eq("clinic_id", clinicData.clinic_id);
          } catch {}
        }

        const isVerified =
          clinicData.verified === true ||
          clinicData.status === "approved" ||
          clinicData.status === "verified";

        const mappedStatus: ClinicVerificationStatus = isVerified
          ? "verified"
          : clinicData.status === "rejected" || clinicData.status === "suspended"
          ? "rejected"
          : "pending";

        let logoUrl = clinicData.logo_url || "";
        if (!logoUrl) {
          try {
            const { data: photos } = await supabase
              .from("clinic_photo")
              .select("photo_url")
              .eq("clinic_id", clinicData.clinic_id)
              .order("sort_order")
              .limit(1);
            if (photos?.[0]?.photo_url) {
              logoUrl = photos[0].photo_url;
            }
          } catch {}
        }

        const nextProfile = {
          status: mappedStatus,
          clinicName: clinicData.name || "Clinic Portal",
          clinicLogo: logoUrl,
          clinicId: clinicData.clinic_id,
        };

        saveCachedProfile(nextProfile);
        return;
      }

      // CRITICAL ANTI-DOWNGRADE PROTECTION:
      // If DB query had an error or was inconclusive, but we were already verified:
      // NEVER downgrade to pending! Preserve the verified state.
      if (cached?.status === "verified" || inMemoryProfile.status === "verified") {
        console.warn("[useClinicVerification] Query inconclusive, preserving existing verified status.");
        const preserved = {
          status: "verified" as ClinicVerificationStatus,
          clinicName: cached?.clinicName || inMemoryProfile.clinicName || "Clinic Portal",
          clinicLogo: cached?.clinicLogo || inMemoryProfile.clinicLogo || "",
          clinicId: cached?.clinicId || inMemoryProfile.clinicId || null,
        };
        saveCachedProfile(preserved);
        return;
      }

      // Check local storage application snapshot if genuinely never verified
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
            return;
          }
        }
      } catch {}

      notifyListeners({
        status: "pending",
        clinicName: "Clinic Portal",
        clinicLogo: "",
        clinicId: null,
        loading: false,
      });
    } finally {
      loadInProgressRef.current = false;
    }
  }, []);

  useEffect(() => {
    let active = true;

    const listener = (newProfile: ClinicProfile) => {
      if (active) setProfile(newProfile);
    };
    listeners.add(listener);

    // Sync in-memory profile if it updated
    if (inMemoryProfile && inMemoryProfile !== profile) {
      setProfile(inMemoryProfile);
    }

    const handleCustomSync = (e: Event) => {
      if (!active) return;
      const customEvent = e as CustomEvent<ClinicProfile>;
      if (customEvent.detail) {
        setProfile(customEvent.detail);
      }
    };

    window.addEventListener("dermai_clinic_profile_updated", handleCustomSync);

    load();

    return () => {
      active = false;
      listeners.delete(listener);
      window.removeEventListener("dermai_clinic_profile_updated", handleCustomSync);
    };
  }, [load]);

  // Real-time Supabase subscription to catch admin approval live
  useEffect(() => {
    const effectiveClinicId = profile.clinicId || inMemoryProfile.clinicId;
    if (!effectiveClinicId) return;

    subscribeToClinicRealtime(effectiveClinicId);
  }, [profile.clinicId]);

  return { ...profile, refetch: load };
}

let activeRealtimeChannel: any = null;
let activeRealtimeClinicId: string | null = null;

function subscribeToClinicRealtime(clinicId: string) {
  if (activeRealtimeClinicId === clinicId && activeRealtimeChannel) {
    return;
  }

  if (activeRealtimeChannel) {
    try {
      supabase.removeChannel(activeRealtimeChannel);
    } catch {
      /* ignore */
    }
    activeRealtimeChannel = null;
    activeRealtimeClinicId = null;
  }

  activeRealtimeClinicId = clinicId;
  const channelName = `clinic_verif_${clinicId}_${Date.now()}`;

  activeRealtimeChannel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "clinic",
        filter: `clinic_id=eq.${clinicId}`,
      },
      (payload) => {
        const newRow = payload.new as any;
        if (newRow) {
          const isVer =
            newRow.verified === true ||
            newRow.status === "approved" ||
            newRow.status === "verified";
          const nextStatus: ClinicVerificationStatus = isVer
            ? "verified"
            : newRow.status === "rejected" || newRow.status === "suspended"
            ? "rejected"
            : "pending";

          saveCachedProfile({
            status: nextStatus,
            clinicName: newRow.name || inMemoryProfile.clinicName,
            clinicLogo: newRow.logo_url || inMemoryProfile.clinicLogo,
            clinicId: newRow.clinic_id,
          });
        }
      }
    )
    .subscribe();
}
