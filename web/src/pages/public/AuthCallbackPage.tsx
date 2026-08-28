import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

const ROLE_HOME: Record<string, string> = {
  patient: "/dashboard",
  doctor: "/doctor",
  clinic: "/clinic",
  admin: "/admin",
};

// Lands here after the user clicks the magic link in their email, or
// completes Google sign-in. Supabase automatically parses the session
// from the URL on load, then we look up the assigned role and redirect.
export default function AuthCallbackPage() {
  const { session, loading, role, roleLoading } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;

    if (!session) {
      setError("This sign-in link is invalid or has expired. Please request a new one.");
      return;
    }

    if (roleLoading) return;

    // role defaults to null only if the users-table lookup failed or the
    // handle_new_user trigger hasn't run yet — treat as patient fallback.
    const destination = ROLE_HOME[role ?? "patient"] ?? "/dashboard";
    navigate(destination, { replace: true });
  }, [session, loading, role, roleLoading, navigate]);

  return (
    <div className="min-h-screen bg-magenta-600 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8 text-center">
        {error ? (
          <>
            <p className="text-red-600 mb-4">{error}</p>
            <a href="/login" className="font-semibold text-magenta-600 hover:text-magenta-700">
              Back to login
            </a>
          </>
        ) : (
          <p className="text-gray-600">Signing you in...</p>
        )}
      </div>
    </div>
  );
}