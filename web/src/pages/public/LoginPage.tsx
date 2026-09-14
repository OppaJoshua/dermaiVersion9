import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { X, Loader2 } from "lucide-react";
import logo from "@/assets/logo2.png";
import { useAuth } from "../../context/AuthContext";

function GoogleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47c-.28 1.5-1.13 2.78-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.72-2.46 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.11C3.24 21.3 7.29 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.28V6.61H1.26A11.96 11.96 0 0 0 0 12c0 1.93.46 3.76 1.26 5.39l4.01-3.11Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.29 0 3.24 2.7 1.26 6.61l4.01 3.11C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}

const ROLE_HOME: Record<string, string> = {
  patient: "/dashboard",
  doctor: "/doctor",
  clinic: "/clinic",
  admin: "/admin",
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const navigate = useNavigate();
  const { session, loading, role, roleLoading, signInWithMagicLink, signInWithGoogle } = useAuth();

  useEffect(() => {
    if (loading || roleLoading) return;
    if (session && role) {
      navigate(ROLE_HOME[role] ?? "/dashboard", { replace: true });
    }
  }, [session, loading, role, roleLoading, navigate]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email.trim()) return;

    setSubmitting(true);
    setError(null);

    const { error: sendError } = await signInWithMagicLink(email.trim());

    setSubmitting(false);

    if (sendError) {
      // Supabase returns a generic error for unregistered emails when
      // shouldCreateUser is false — keep the message vague so we don't
      // leak which emails have accounts.
      setError("We couldn't send a sign-in link. Please check your email and try again.");
      return;
    }

    setLinkSent(true);
  };

  return (
    <div className="min-h-screen bg-magenta-600 flex items-center justify-center px-4 py-12 relative">
      <button
        onClick={() => navigate(-1)}
        aria-label="Close"
        className="absolute top-6 right-6 w-9 h-9 rounded-full bg-white/90 flex items-center justify-center text-magenta-600 hover:bg-white transition-colors"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8 sm:p-10 text-center">
        <div className="w-16 h-16 flex items-center justify-center mx-auto mb-4 overflow-hidden">
          <img src={logo} alt="DERMA-AI logo" className="w-15 h-15 object-contain" />
        </div>
        <h1 className="text-2xl font-display font-bold text-gray-900 mb-1">Welcome Back</h1>
        <p className="text-magenta-400 text-sm mb-6">Sign in to your account</p>

        {linkSent ? (
          <div className="py-6">
            <p className="text-gray-700 font-medium mb-2">Check your inbox</p>
            <p className="text-sm text-gray-500">
              We sent a sign-in link to <span className="font-semibold">{email}</span>. Click it to log in.
            </p>
            <button
              type="button"
              onClick={() => setLinkSent(false)}
              className="mt-6 text-sm font-semibold text-magenta-600 hover:text-magenta-700"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={async () => {
                setError(null);
                const { error: googleError } = await signInWithGoogle();
                if (googleError) setError(googleError);
                // On success, Supabase redirects the browser to Google, then
                // back to /auth/callback — no navigate() needed here.
              }}
              className="w-full flex items-center justify-center gap-2 border border-magenta-100 bg-magenta-50/60 rounded-full py-3 text-sm font-semibold text-gray-700 hover:bg-magenta-50 transition-colors"
            >
              <GoogleIcon />
              Continue with Google
            </button>

            <div className="flex items-center gap-3 my-6">
              <span className="flex-1 h-px bg-magenta-100" />
              <span className="text-xs text-magenta-300">or</span>
              <span className="flex-1 h-px bg-magenta-100" />
            </div>

            <form onSubmit={handleSubmit} className="text-left mb-6">
              <label className="block text-xs font-semibold text-magenta-600 uppercase tracking-wider mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-xl bg-magenta-50/60 border border-magenta-100 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 transition-all mb-4"
              />

              {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

              <button
                type="submit"
                disabled={!email.trim() || submitting}
                className="w-full py-3 rounded-full font-semibold text-sm text-white bg-magenta-600 hover:bg-magenta-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-magenta-600/20 active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Sending link...</span>
                  </>
                ) : (
                  <span>Send Sign-In Link</span>
                )}
              </button>
            </form>
          </>
        )}

        <p className="text-sm text-gray-500 mt-6">
          are you a clinic without account?{" "}
          <Link to="/register-clinic" className="font-semibold text-magenta-600 hover:text-magenta-700">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}