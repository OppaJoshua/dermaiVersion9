import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";

export type UserRole = "patient" | "doctor" | "clinic" | "admin";

type AuthContextType = {
  session: Session | null;
  user: User | null;
  role: UserRole | null;
  roleLoading: boolean;
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
  const [roleLoading, setRoleLoading] = useState(false);

  useEffect(() => {
    // Check for an existing session on first load (also picks up the
    // session Supabase parses from the URL after a magic link click).
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    // Keep session in sync across the app (login, logout, token refresh).
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // Once we have a session, look up which role the DB trigger assigned
    // this account (patient by default, doctor/clinic/admin if matched).
    if (!session?.user) {
      setRole(null);
      return;
    }

    let cancelled = false;
    setRoleLoading(true);

    supabase
      .from("user")
      .select("role")
      .eq("user_id", session.user.id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        setRole(error ? null : (data?.role as UserRole) ?? null);
        setRoleLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const signInWithMagicLink = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Patients can self-register just by entering an email — no
        // approval needed. Clinics never hit this path: they submit an
        // application via RegisterClinic, and an account only gets
        // created once an admin approves it. Doctors don't sign up at
        // all — a clinic adds their email to clinic_doctor first; when
        // that same email later logs in here, the handle_new_user
        // trigger matches it and assigns role = 'doctor' instead of the
        // default 'patient'.
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
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        role,
        roleLoading,
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