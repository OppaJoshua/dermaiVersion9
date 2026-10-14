import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";

export type UserRole = "patient" | "doctor" | "clinic" | "admin";
export type AccountStatus = "active" | "suspended" | "inactive";

export function isPatientProfileComplete(profile: {
  fullName?: string | null;
  phone?: string | null;
  contactNumber?: string | null;
  gender?: string | null;
  birthdate?: string | null;
  district?: string | null;
  address?: string | null;
  profile_completed?: boolean;
}): boolean {
  if (profile.profile_completed === true) return true;
  const name = (profile.fullName || "").trim();
  const phone = (profile.phone || profile.contactNumber || "").replace(/\D/g, "");
  const gender = (profile.gender || "").trim();
  const birthdate = (profile.birthdate || "").trim();
  const location = (profile.district || profile.address || "").trim();

  // Full name, 11-digit phone number, gender, birthdate, and at least district or address
  return (
    name.length > 0 &&
    phone.length === 11 &&
    gender.length > 0 &&
    birthdate.length > 0 &&
    location.length > 0
  );
}

type AuthContextType = {
  session: Session | null;
  user: User | null;
  role: UserRole | null;
  roleLoading: boolean;
  accountStatus: AccountStatus;
  loading: boolean;
  isProfileComplete: boolean;
  setIsProfileComplete: (complete: boolean) => void;
  signInWithMagicLink: (email: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole | null>(null);
  const [accountStatus, setAccountStatus] = useState<AccountStatus>("active");
  const [roleLoading, setRoleLoading] = useState(true);
  const [isProfileComplete, setIsProfileComplete] = useState<boolean>(true);

  useEffect(() => {
    // Check for an existing session on first load
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (error || !data.session) {
        setSession(null);
        setRole(null);
        setRoleLoading(false);
        setLoading(false);
        return;
      }

      // Check if user still exists in auth.users (prevents zombie session after database wipe)
      const { error: userErr } = await supabase.auth.getUser();
      if (userErr) {
        console.warn("[Auth] Stale session detected, auto-purging cached session.");
        await supabase.auth.signOut();
        setSession(null);
        setRole(null);
        setRoleLoading(false);
        setLoading(false);
        return;
      }

      setSession(data.session);
      const email = (data.session?.user?.email || "").toLowerCase().trim();
      if (email === "dermaisupport@gmail.com") {
        setRole("admin");
        setAccountStatus("active");
        setRoleLoading(false);
      } else if (!data.session) {
        setRoleLoading(false);
      }
      const cachedRole = localStorage.getItem(`derm_role_${data.session.user.id}`) as UserRole | null;
      if (cachedRole && ["admin", "clinic", "doctor", "patient"].includes(cachedRole)) {
        setRole(cachedRole);
      }
      setLoading(false);
    });

    // Keep session in sync across the app (login, logout, token refresh).
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      const email = (newSession?.user?.email || "").toLowerCase().trim();
      if (email === "dermaisupport@gmail.com") {
        setRole("admin");
        setAccountStatus("active");
        setRoleLoading(false);
      } else if (!newSession) {
        setRole(null);
        setAccountStatus("active");
        setRoleLoading(false);
      } else {
        const cachedRole = localStorage.getItem(`derm_role_${newSession.user.id}`) as UserRole | null;
        if (cachedRole && ["admin", "clinic", "doctor", "patient"].includes(cachedRole)) {
          setRole(cachedRole);
        }
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setRole(null);
      setAccountStatus("active");
      setRoleLoading(false);
      return;
    }

    const userEmail = (session.user.email || "").toLowerCase().trim();
    if (userEmail === "dermaisupport@gmail.com") {
      setRole("admin");
      setAccountStatus("active");
      setIsProfileComplete(true);
      setRoleLoading(false);
      return;
    }

    let cancelled = false;
    setRoleLoading(true);

    async function fetchUserRole() {
      // Keep track of any known role so we NEVER downgrade to patient on temporary failure
      let knownRole: UserRole | null = null;
      try {
        const cachedRole = localStorage.getItem(`derm_role_${session!.user.id}`) as UserRole | null;
        if (cachedRole && ["admin", "clinic", "doctor", "patient"].includes(cachedRole)) {
          knownRole = cachedRole;
        }

        const currentEmail = (session!.user.email || "").toLowerCase().trim();

        // 1. Check local manual admin override
        const overrideRole = localStorage.getItem("derm_override_role") as UserRole | null;
        if (overrideRole) {
          setRole(overrideRole);
          setIsProfileComplete(true);
          setRoleLoading(false);
          return;
        }

        // 2. Query user record in DB (Primary Authoritative Source)
        let dbUser: any = null;
        const { data: userById } = await supabase
          .from("user")
          .select("role, user_id, account_status, full_name, phone, gender, birthdate, district, address, avatar_url")
          .eq("user_id", session!.user.id)
          .maybeSingle();

        if (userById) {
          dbUser = userById;
        } else if (currentEmail) {
          const { data: userByEmail } = await supabase
            .from("user")
            .select("role, user_id, account_status, full_name, phone, gender, birthdate, district, address, avatar_url")
            .ilike("email", currentEmail)
            .maybeSingle();
          if (userByEmail) dbUser = userByEmail;
        }

        // If DB has an authoritative role, record it as known role
        if (dbUser?.role && ["admin", "clinic", "doctor", "patient"].includes(dbUser.role)) {
          knownRole = dbUser.role as UserRole;
        }

        const currentStatus: AccountStatus =
          dbUser?.account_status === "suspended" || dbUser?.account_status === "inactive"
            ? dbUser.account_status
            : "active";

        // 3. Check Clinic Affiliation (by owner ID or Email)
        let clinicFound: any = null;
        if (knownRole === "clinic") {
          clinicFound = { clinic_id: "authoritative", status: "active" };
        } else if (knownRole !== "doctor" && knownRole !== "admin") {
          const { data: c1 } = await supabase
            .from("clinic")
            .select("clinic_id, status, owner_user_id")
            .eq("owner_user_id", session!.user.id)
            .maybeSingle();

          if (c1) {
            clinicFound = c1;
          } else if (currentEmail) {
            const { data: c2 } = await supabase
              .from("clinic")
              .select("clinic_id, status, owner_user_id")
              .ilike("email", currentEmail)
              .maybeSingle();

            if (c2) {
              clinicFound = c2;
              if (!c2.owner_user_id) {
                try {
                  await supabase
                    .from("clinic")
                    .update({ owner_user_id: session!.user.id })
                    .eq("clinic_id", c2.clinic_id);
                } catch {
                  // Non-blocking affiliation link
                }
              }
            }
          }

          // Check local applications cache
          if (!clinicFound && currentEmail) {
            try {
              const localApps = localStorage.getItem("dermai_clinic_applications");
              if (localApps) {
                const parsed = JSON.parse(localApps);
                if (parsed.some((a: any) => a.email?.toLowerCase().trim() === currentEmail)) {
                  clinicFound = { clinic_id: "local", status: "pending" };
                }
              }
            } catch {
              /* ignore */
            }
          }
        }

        // 4. Check Doctor Affiliation (try user_id first, then email fallback)
        let doctorFound = false;
        if (knownRole === "doctor") {
          doctorFound = true;
        } else if (!clinicFound && knownRole !== "admin") {
          // 4a. First try by user_id = authenticated Supabase user ID
          const { data: dById } = await supabase
            .from("clinic_doctor")
            .select("doctor_id, clinic_id, user_id")
            .eq("user_id", session!.user.id)
            .maybeSingle();

          if (dById) {
            doctorFound = true;
          } else if (currentEmail) {
            // 4b. Fallback to email lookup if user_id was not linked yet
            const { data: dByEmail } = await supabase
              .from("clinic_doctor")
              .select("doctor_id, clinic_id, user_id")
              .ilike("email", currentEmail)
              .maybeSingle();

            if (dByEmail) {
              doctorFound = true;
              if (!dByEmail.user_id) {
                try {
                  await supabase
                    .from("clinic_doctor")
                    .update({ user_id: session!.user.id })
                    .eq("doctor_id", dByEmail.doctor_id);
                } catch {
                  // Non-blocking affiliation link
                }
              }
            }
          }

          // 4c. Secondary fallback to local doctor profile / clinic doctors cache
          if (!doctorFound) {
            try {
              const storedDocProfile = localStorage.getItem("dermai_doctor_profile");
              const storedClinicDocs = localStorage.getItem("dermai_clinic_doctors");
              if (storedDocProfile) {
                const parsed = JSON.parse(storedDocProfile);
                if (parsed.email?.toLowerCase().trim() === currentEmail || parsed.id === session!.user.id) {
                  doctorFound = true;
                }
              }
              if (!doctorFound && storedClinicDocs) {
                const parsedDocs = JSON.parse(storedClinicDocs);
                if (Array.isArray(parsedDocs) && parsedDocs.some((d: any) => d.email?.toLowerCase().trim() === currentEmail || d.userId === session!.user.id)) {
                  doctorFound = true;
                }
              }
            } catch {
              /* ignore */
            }
          }
        }

        // 5. Determine Final Role — PRIORITIZE AUTHORITATIVE DATABASE ROLE
        let finalRole: UserRole = "patient";
        if (dbUser?.role && ["admin", "clinic", "doctor"].includes(dbUser.role)) {
          // 1st priority: authoritative non-patient role already stored in public.user
          finalRole = dbUser.role as UserRole;
        } else if (clinicFound) {
          finalRole = "clinic";
        } else if (doctorFound) {
          finalRole = "doctor";
        } else if (dbUser?.role === "patient") {
          finalRole = "patient";
        } else if (session!.user.user_metadata?.role && ["admin", "clinic", "doctor", "patient"].includes(session!.user.user_metadata.role)) {
          finalRole = session!.user.user_metadata.role as UserRole;
        } else if (knownRole && ["admin", "clinic", "doctor"].includes(knownRole)) {
          // Preserve cached known role if lookup was inconclusive
          finalRole = knownRole;
        }

        // 6. Ensure user row exists and preserve existing account status & profile details
        const meta = session!.user.user_metadata || {};
        const fullName = dbUser?.full_name || meta.full_name || meta.name || session!.user.email?.split("@")[0] || "User";

        let localProfile: any = null;
        try {
          const saved = localStorage.getItem(`derm_profile_${session!.user.id}`);
          if (saved) localProfile = JSON.parse(saved);
        } catch {}

        // Patient-only profile completion check: non-patients are ALWAYS considered complete
        const profileComplete =
          finalRole !== "patient" ||
          isPatientProfileComplete({
            fullName: dbUser?.full_name || meta.full_name || meta.name || localProfile?.fullName || "",
            phone: dbUser?.phone || meta.phone || localProfile?.contactNumber || localProfile?.phone || "",
            gender: dbUser?.gender || meta.gender || localProfile?.gender || "",
            birthdate: dbUser?.birthdate || meta.birthdate || meta.birthday || localProfile?.birthdate || "",
            district: dbUser?.district || meta.district || localProfile?.district || "",
            address: dbUser?.address || meta.address || localProfile?.address || "",
            profile_completed: Boolean(
              meta.profile_completed ||
              localProfile?.profile_completed ||
              (dbUser?.phone && dbUser?.gender && dbUser?.birthdate && (dbUser?.district || dbUser?.address))
            ),
          });

        // NEVER write "patient" over an existing non-patient DB role
        const isExistingNonPatient = dbUser?.role && ["doctor", "clinic", "admin"].includes(dbUser.role);
        const roleToPersist = isExistingNonPatient && finalRole === "patient" ? dbUser.role : finalRole;

        await supabase.from("user").upsert({
          user_id: session!.user.id,
          email: session!.user.email || "",
          full_name: fullName,
          role: roleToPersist,
          account_status: currentStatus,
        });

        if (cancelled) return;

        setAccountStatus(currentStatus);
        setRole(roleToPersist);
        setIsProfileComplete(profileComplete);
        localStorage.setItem(`derm_role_${session!.user.id}`, roleToPersist);
      } catch (err) {
        console.error("Failed to resolve user role:", err);
        if (cancelled) return;
        const fallbackEmail = (session?.user?.email || "").toLowerCase().trim();

        // Safely preserve known role instead of blindly falling back to "patient"
        const preservedRole: UserRole | null =
          knownRole && ["admin", "clinic", "doctor"].includes(knownRole)
            ? knownRole
            : fallbackEmail === "dermaisupport@gmail.com"
            ? "admin"
            : null;

        if (preservedRole) {
          setRole(preservedRole);
          setIsProfileComplete(true);
        } else {
          // If role is genuinely unknown, do NOT assume patient for profile-completion
          setRole(null);
          setIsProfileComplete(true);
        }
      } finally {
        if (!cancelled) setRoleLoading(false);
      }
    }

    fetchUserRole();

    // Profile update event listener to reactively mark complete without re-fetch
    const handleProfileUpdate = () => {
      if (session?.user) {
        let localProfile: any = null;
        try {
          const saved = localStorage.getItem(`derm_profile_${session.user.id}`);
          if (saved) localProfile = JSON.parse(saved);
        } catch {}
        const meta = session.user.user_metadata || {};
        if (
          isPatientProfileComplete({
            ...meta,
            ...localProfile,
            profile_completed: Boolean(localProfile?.profile_completed || meta.profile_completed),
          })
        ) {
          setIsProfileComplete(true);
        }
      }
    };

    window.addEventListener("derm_profile_updated", handleProfileUpdate);
    window.addEventListener("storage", handleProfileUpdate);

    // 7. Realtime listener for account status changes on current user
    const statusChannel = supabase
      .channel(`public:user_status_${session.user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "user",
          filter: `user_id=eq.${session.user.id}`,
        },
        (payload: any) => {
          if (payload.new?.account_status) {
            setAccountStatus(payload.new.account_status as AccountStatus);
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.removeEventListener("derm_profile_updated", handleProfileUpdate);
      window.removeEventListener("storage", handleProfileUpdate);
      supabase.removeChannel(statusChannel);
    };
  }, [session]);

  const signInWithMagicLink = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    return { error: error?.message ?? null };
  };

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setRole(null);
    setIsProfileComplete(true);
    setAccountStatus("active");
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        role,
        roleLoading,
        accountStatus,
        loading,
        isProfileComplete,
        setIsProfileComplete,
        signInWithMagicLink,
        signInWithGoogle,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}