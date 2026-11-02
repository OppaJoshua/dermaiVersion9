import React, { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { X, Loader2, ShieldCheck, FileText, CheckCircle2 } from "lucide-react";
import logo from "@/assets/logo2.png";
import loginBg from "@/assets/Login Background.png";
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

const USER_AGREEMENT_SECTIONS = [
  {
    title: "1. Acceptance of User Agreement",
    body: "By creating an account or signing in to DERMAI, you acknowledge that you have read, understood, and agree to be bound by this User Agreement, our Terms of Service, and our Data Privacy Policy.",
  },
  {
    title: "2. Preliminary AI Skin Assessment Disclaimer",
    body: "DERMAI's AI skin analysis provides preliminary, educational assessments only. It is NOT a substitute for professional medical diagnosis, advice, or treatment. Always consult a licensed dermatologist regarding any skin condition.",
  },
  {
    title: "3. Data Privacy & Consent (RA 10173)",
    body: "In compliance with the Philippine Data Privacy Act of 2012 (Republic Act No. 10173), you consent to the secure collection and processing of your personal profile information, skin scan photos, and symptom responses solely for AI skin analysis and dermatology clinic consultations.",
  },
  {
    title: "4. Account Responsibilities",
    body: "You are responsible for providing accurate personal information and maintaining the security of your account credentials. You must be at least 18 years old or have parental/guardian consent to use the platform.",
  },
  {
    title: "5. Clinic Consultations & Payments",
    body: "Appointments booked through DERMAI are subject to the participating dermatology clinic's policies and schedules. Online consultation payments processed via PayMongo (GCash / Maya) are recorded with official transaction references.",
  },
  {
    title: "6. Emergency Medical Situations",
    body: "DERMAI is not an emergency medical service. If you experience severe symptoms such as difficulty breathing, rapidly spreading rashes, or high fever, seek immediate emergency medical care or call the DOH Hotline 1555.",
  },
];

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
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [showAgreementModal, setShowAgreementModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<"google" | "email" | null>(null);

  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from;
  const { session, loading, role, roleLoading, isProfileComplete, signInWithMagicLink, signInWithGoogle } = useAuth();

  useEffect(() => {
    if (loading || roleLoading) return;
    if (session && role) {
      if (role === "patient" && !isProfileComplete) {
        navigate("/dashboard/profile?first_time=1", { replace: true });
      } else if (from && (role === "patient" || !ROLE_HOME[role])) {
        navigate(from, { replace: true });
      } else {
        navigate(ROLE_HOME[role] ?? "/dashboard", { replace: true });
      }
    }
  }, [session, loading, role, roleLoading, isProfileComplete, navigate, from]);

  const executeEmailSignIn = async () => {
    if (!email.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      localStorage.setItem("dermai_user_agreement_accepted", new Date().toISOString());
    } catch {}

    const { error: sendError } = await signInWithMagicLink(email.trim());
    setSubmitting(false);

    if (sendError) {
      setError("We couldn't send a sign-in link. Please check your email and try again.");
      return;
    }
    setLinkSent(true);
  };

  const executeGoogleSignIn = async () => {
    setError(null);
    try {
      localStorage.setItem("dermai_user_agreement_accepted", new Date().toISOString());
    } catch {}
    const { error: googleError } = await signInWithGoogle();
    if (googleError) setError(googleError);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email.trim()) return;

    if (!agreedToTerms) {
      setPendingAction("email");
      setShowAgreementModal(true);
      return;
    }

    await executeEmailSignIn();
  };

  const handleGoogleClick = async () => {
    if (!agreedToTerms) {
      setPendingAction("google");
      setShowAgreementModal(true);
      return;
    }
    await executeGoogleSignIn();
  };

  const handleAcceptAgreementModal = async () => {
    setAgreedToTerms(true);
    setShowAgreementModal(false);
    setError(null);

    const action = pendingAction;
    setPendingAction(null);
    if (action === "google") {
      await executeGoogleSignIn();
    } else if (action === "email" && email.trim()) {
      await executeEmailSignIn();
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-12 relative bg-cover bg-center bg-no-repeat overflow-hidden"
      style={{ backgroundImage: `url(${loginBg})` }}
    >
      {/* Subtle overlay for depth while preserving the vibrant polygonal background */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/15 pointer-events-none" />

      <button
        onClick={() => navigate("/")}
        aria-label="Close"
        className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/80 backdrop-blur-md flex items-center justify-center text-gray-700 hover:text-magenta-600 hover:bg-white shadow-lg transition-all cursor-pointer z-20"
      >
        <X className="w-5 h-5" />
      </button>

      <div className="w-full max-w-md bg-white/95 backdrop-blur-md rounded-3xl shadow-2xl p-8 sm:p-10 text-center relative z-10 border border-white/60">
        <div className="w-16 h-16 flex items-center justify-center mx-auto mb-4 overflow-hidden">
          <img src={logo} alt="DERMA-AI logo" className="w-15 h-15 object-contain" />
        </div>
        <h1 className="text-2xl font-display font-bold text-gray-900 mb-1">Welcome to DermAI</h1>
        <p className="text-magenta-400 text-sm mb-6">Sign in or create your patient account</p>

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
              onClick={handleGoogleClick}
              className="w-full flex items-center justify-center gap-2 border border-magenta-100 bg-magenta-50/60 rounded-full py-3 text-sm font-semibold text-gray-700 hover:bg-magenta-50 transition-colors cursor-pointer"
            >
              <GoogleIcon />
              Continue with Google
            </button>

            <div className="flex items-center gap-3 my-6">
              <span className="flex-1 h-px bg-magenta-100" />
              <span className="text-xs text-magenta-300">or</span>
              <span className="flex-1 h-px bg-magenta-100" />
            </div>

            <form onSubmit={handleSubmit} className="text-left mb-5">
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

              {/* User Agreement Checkbox */}
              <div className="flex items-start gap-2.5 mb-4 p-3 rounded-xl bg-magenta-50/40 border border-magenta-100/80">
                <input
                  id="user-agreement-checkbox"
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => {
                    setAgreedToTerms(e.target.checked);
                    if (e.target.checked) setError(null);
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-magenta-300 text-magenta-600 focus:ring-magenta-500 cursor-pointer accent-[#85134a]"
                />
                <label htmlFor="user-agreement-checkbox" className="text-xs text-gray-600 leading-relaxed select-none">
                  I have read and agree to the{" "}
                  <button
                    type="button"
                    onClick={() => setShowAgreementModal(true)}
                    className="font-semibold text-magenta-600 hover:text-magenta-700 underline cursor-pointer"
                  >
                    User Agreement &amp; Medical Disclaimer
                  </button>{" "}
                  and{" "}
                  <Link
                    to="/privacy"
                    target="_blank"
                    className="font-semibold text-magenta-600 hover:text-magenta-700 underline"
                  >
                    Privacy Policy
                  </Link>
                  .
                </label>
              </div>

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

        <p className="text-sm text-gray-500 mt-4">
          are you a clinic without account?{" "}
          <Link to="/register-clinic" className="font-semibold text-magenta-600 hover:text-magenta-700">
            Register
          </Link>
        </p>
      </div>

      {/* User Agreement & Medical Disclaimer Modal */}
      {showAgreementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-magenta-100 overflow-hidden flex flex-col max-h-[85vh]">
            {/* Modal Header */}
            <div className="bg-linear-to-r from-[#85134a] to-[#A0195A] px-6 py-4 flex items-center justify-between text-white">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-white" />
                <div className="text-left">
                  <h2 className="text-base font-bold leading-tight">DermAI User Agreement</h2>
                  <p className="text-[11px] text-white/80">Terms of Use, Medical Disclaimer &amp; Data Privacy</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowAgreementModal(false);
                  setPendingAction(null);
                }}
                className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-4 text-left text-sm text-gray-600">
              <div className="p-3.5 rounded-2xl bg-magenta-50/70 border border-magenta-100 flex items-start gap-3">
                <FileText className="w-5 h-5 text-magenta-600 shrink-0 mt-0.5" />
                <p className="text-xs text-gray-700 leading-relaxed">
                  Please review and accept our User Agreement before creating or accessing your DermAI account.
                </p>
              </div>

              {USER_AGREEMENT_SECTIONS.map((sec) => (
                <div key={sec.title} className="space-y-1">
                  <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wide">{sec.title}</h3>
                  <p className="text-xs text-gray-600 leading-relaxed">{sec.body}</p>
                </div>
              ))}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowAgreementModal(false);
                  setPendingAction(null);
                }}
                className="px-4 py-2.5 rounded-full text-xs font-semibold text-gray-600 hover:bg-gray-200/70 transition-colors cursor-pointer"
              >
                Decline
              </button>
              <button
                type="button"
                onClick={handleAcceptAgreementModal}
                className="px-5 py-2.5 rounded-full text-xs font-bold text-white bg-[#85134a] hover:bg-[#6b0f3c] flex items-center gap-1.5 shadow-md transition-all cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>I Agree &amp; Continue</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
