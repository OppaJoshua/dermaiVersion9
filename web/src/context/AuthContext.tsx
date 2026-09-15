import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";

export type UserRole = "patient" | "doctor" | "clinic" | "admin";
export type AccountStatus = "active" | "suspended" | "inactive";

type AuthContextType = {
  session: Session | null;
  user: User | null;
  role: UserRole | null;
  roleLoading: boolean;
  accountStatus: AccountStatus;
  loading: boolean;
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

  useEffect(() => {
    // Check for an existing session on first load
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      const email = (data.session?.user?.email || "").toLowerCase().trim();
      if (email === "dermaisupport@gmail.com") {
        setRole("admin");
        setAccountStatus("active");
        setRoleLoading(false);
      } else if (!data.session) {
        setRoleLoading(false);
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
      setRoleLoading(false);
      return;
    }

    let cancelled = false;
    setRoleLoading(true);

    async function fetchUserRole() {
      try {
        const currentEmail = (session!.user.email || "").toLowerCase().trim();

        // 1. Check local manual admin override
        const overrideRole = localStorage.getItem("derm_override_role") as UserRole | null;
        if (overrideRole) {
          setRole(overrideRole);
          setRoleLoading(false);
          return;
        }

        // 2. Query user record in DB
        let dbUser: any = null;
        const { data: userById } = await supabase
          .from("user")
          .select("role, user_id, account_status")
          .eq("user_id", session!.user.id)
          .maybeSingle();

        if (userById) {
          dbUser = userById;
        } else if (currentEmail) {
          const { data: userByEmail } = await supabase
            .from("user")
            .select("role, user_id, account_status")
            .ilike("email", currentEmail)
            .maybeSingle();
          if (userByEmail) dbUser = userByEmail;
        }

        const currentStatus: AccountStatus =
          dbUser?.account_status === "suspended" || dbUser?.account_status === "inactive"
            ? dbUser.account_status
            : "active";

        // 3. Check Clinic Affiliation (by owner ID or Email)
        let clinicFound: any = null;

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
              await supabase
                .from("clinic")
                .update({ owner_user_id: session!.user.id })
                .eq("clinic_id", c2.clinic_id);
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

        // 4. Check Doctor Affiliation
        let doctorFound = false;
        if (!clinicFound && currentEmail) {
          const { data: d1 } = await supabase
            .from("clinic_doctor")
            .select("doctor_id")
            .ilike("email", currentEmail)
            .maybeSingle();
          if (d1) doctorFound = true;
        }

        // 5. Determine Final Role
        let finalRole: UserRole = "patient";
        if (clinicFound) {
          finalRole = "clinic";
        } else if (doctorFound) {
          finalRole = "doctor";
        } else if (dbUser?.role && ["admin", "clinic", "doctor", "patient"].includes(dbUser.role)) {
          finalRole = dbUser.role as UserRole;
        } else if (session!.user.user_metadata?.role) {
          finalRole = session!.user.user_metadata.role as UserRole;
        }

        // 6. Ensure user row exists and preserve existing account status
        const meta = session!.user.user_metadata || {};
        const fullName = meta.full_name || meta.name || session!.user.email?.split("@")[0] || "User";

        await supabase.from("user").upsert({
          user_id: session!.user.id,
          email: session!.user.email || "",
          full_name: fullName,
          role: finalRole,
          account_status: currentStatus,
        });

        if (cancelled) return;

        setAccountStatus(currentStatus);
        setRole(finalRole);
        localStorage.setItem(`derm_role_${session!.user.id}`, finalRole);
      } catch (err) {
        console.error("Failed to resolve user role:", err);
        const fallbackEmail = (session?.user?.email || "").toLowerCase().trim();
        if (!cancelled) setRole(fallbackEmail === "dermaisupport@gmail.com" ? "admin" : "patient");
      } finally {
        if (!cancelled) setRoleLoading(false);
      }
    }

    fetchUserRole();

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