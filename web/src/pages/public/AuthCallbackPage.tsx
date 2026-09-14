import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import logo from "@/assets/logo2.png";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, AlertCircle, ArrowRight, Sparkles, CheckCircle2 } from "lucide-react";

const ROLE_HOME: Record<string, string> = {
  patient: "/dashboard",
  doctor: "/doctor",
  clinic: "/clinic",
  admin: "/admin",
};

const LOADING_MESSAGES = [
  "Verifying secure credentials...",
  "Authenticating medical access token...",
  "Loading your personalized profile...",
  "Preparing your workspace...",
];

export default function AuthCallbackPage() {
  const { session, loading, role, roleLoading } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [messageIndex, setMessageIndex] = useState(0);

  // Cycle through reassuring authenticating messages
  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 1800);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (loading) return;

    if (!session) {
      setError("This sign-in link is invalid or has expired. Please request a new one.");
      return;
    }

    if (roleLoading || !role) return;

    const destination = ROLE_HOME[role] ?? "/dashboard";
    // Small graceful delay to give user a smooth visual confirmation
    const timer = setTimeout(() => {
      navigate(destination, { replace: true });
    }, 600);

    return () => clearTimeout(timer);
  }, [session, loading, role, roleLoading, navigate]);

  return (
    <div className="min-h-screen bg-linear-to-b from-magenta-50/60 via-white to-magenta-50/40 flex items-center justify-center px-4 relative overflow-hidden selection:bg-magenta-500 selection:text-white">
      {/* Ambient background glowing orbs */}
      <motion.div
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.35, 0.55, 0.35],
        }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        className="absolute -top-32 -left-32 w-96 h-96 bg-magenta-200/50 rounded-full blur-3xl pointer-events-none"
      />
      <motion.div
        animate={{
          scale: [1.2, 1, 1.2],
          opacity: [0.3, 0.5, 0.3],
        }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
        className="absolute -bottom-32 -right-32 w-96 h-96 bg-pink-200/40 rounded-full blur-3xl pointer-events-none"
      />

      {/* Main Glassmorphic Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-md bg-white/95 backdrop-blur-md rounded-3xl border border-slate-200/80 shadow-2xl shadow-magenta-900/10 p-8 sm:p-10 text-center relative z-10"
      >
        {error ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            <div className="w-16 h-16 rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center mx-auto text-rose-500 shadow-sm">
              <AlertCircle className="w-8 h-8" />
            </div>

            <div>
              <h2 className="text-xl sm:text-2xl font-display font-bold text-slate-900 mb-2">
                Authentication Link Expired
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">{error}</p>
            </div>

            <div className="pt-2">
              <Link
                to="/login"
                className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-magenta-500 text-white font-semibold text-sm hover:bg-magenta-600 transition-all shadow-lg shadow-magenta-500/20 active:scale-[0.96]"
              >
                Return to Sign In
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </motion.div>
        ) : (
          <div className="space-y-6">
            {/* Center Animated Logo & Concentric Ripple Rings */}
            <div className="relative w-28 h-28 mx-auto flex items-center justify-center">
              {/* Outer Pulse Ring 1 */}
              <motion.div
                animate={{
                  scale: [1, 1.45, 1.6],
                  opacity: [0.6, 0.25, 0],
                }}
                transition={{
                  duration: 2.4,
                  repeat: Infinity,
                  ease: "easeOut",
                }}
                className="absolute inset-0 rounded-full bg-magenta-400/20 border border-magenta-300/40"
              />

              {/* Outer Pulse Ring 2 (Staggered) */}
              <motion.div
                animate={{
                  scale: [1, 1.3, 1.45],
                  opacity: [0.7, 0.35, 0],
                }}
                transition={{
                  duration: 2.4,
                  repeat: Infinity,
                  ease: "easeOut",
                  delay: 0.8,
                }}
                className="absolute inset-2 rounded-full bg-magenta-300/25 border border-magenta-400/30"
              />

              {/* Spinning Gradient Orbital Ring */}
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 3.5, ease: "linear" }}
                className="absolute inset-1 rounded-full border-2 border-transparent border-t-magenta-500 border-r-pink-400 border-b-magenta-300"
              />

              {/* Inner Logo Badge */}
              <div className="relative z-10 w-20 h-20 rounded-full bg-white flex items-center justify-center overflow-hidden p-1.5">
                <img
                  src={logo}
                  alt="DermAI Logo"
                  className="w-full h-full object-contain rounded-full"
                />
              </div>

              {/* Sparkle micro badge */}
              <motion.div
                animate={{
                  scale: [1, 1.2, 1],
                  rotate: [0, 15, -15, 0],
                }}
                transition={{ duration: 2, repeat: Infinity }}
                className="absolute -top-1 -right-1 z-20 w-6 h-6 rounded-full bg-magenta-500 text-white flex items-center justify-center"
              >
                <Sparkles className="w-3.5 h-3.5" />
              </motion.div>
            </div>

            {/* Titles & Dynamic Progress */}
            <div>
              <h1 className="text-2xl sm:text-3xl font-display font-bold text-slate-900 mb-1.5">
                Signing You In
              </h1>

              {/* Animated Rotating Status Text */}
              <div className="h-6 flex items-center justify-center overflow-hidden">
                <AnimatePresence mode="wait">
                  <motion.p
                    key={messageIndex}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25 }}
                    className="text-xs sm:text-sm font-medium text-magenta-600"
                  >
                    {LOADING_MESSAGES[messageIndex]}
                  </motion.p>
                </AnimatePresence>
              </div>
            </div>

            {/* Smooth Shimmer Progress Bar */}
            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden relative shadow-inner">
              <motion.div
                className="h-full bg-linear-to-r from-magenta-400 via-magenta-500 to-pink-500 rounded-full shadow-sm"
                animate={{
                  x: ["-100%", "100%"],
                }}
                transition={{
                  repeat: Infinity,
                  duration: 1.6,
                  ease: "easeInOut",
                }}
                style={{ width: "65%" }}
              />
            </div>

            {/* Security Highlights */}
            <div className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-3.5 text-left space-y-2">
              <div className="flex items-center gap-2 text-xs text-slate-700">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>SSL Encrypted Handshake Verified</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-700">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>Synchronizing Clinical Permissions</span>
              </div>
            </div>

            {/* Footer Trust Badge */}
            <div className="pt-1 flex items-center justify-center gap-1.5 text-[11px] text-slate-400 font-medium">
              <Lock className="w-3 h-3 text-magenta-500" />
              <span>DermAI Secure Healthcare Portal</span>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}