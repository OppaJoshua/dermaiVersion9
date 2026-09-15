import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import logo from "@/assets/logo2.png";
import { motion } from "framer-motion";
import { AlertCircle, ArrowRight } from "lucide-react";

const ROLE_HOME: Record<string, string> = {
  patient: "/dashboard",
  doctor: "/doctor",
  clinic: "/clinic",
  admin: "/admin",
};

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

    if (roleLoading || !role) return;

    const destination = ROLE_HOME[role] ?? "/dashboard";
    const timer = setTimeout(() => {
      navigate(destination, { replace: true });
    }, 500);

    return () => clearTimeout(timer);
  }, [session, loading, role, roleLoading, navigate]);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      {error ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-sm w-full bg-white rounded-2xl border border-slate-100 p-6 text-center shadow-xl shadow-slate-900/5 space-y-4"
        >
          <div className="w-12 h-12 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center mx-auto text-rose-500">
            <AlertCircle className="w-6 h-6" />
          </div>

          <div>
            <h2 className="text-base font-bold text-slate-900">
              Link Expired
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed mt-1">{error}</p>
          </div>

          <Link
            to="/login"
            className="inline-flex items-center justify-center gap-1.5 w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors shadow-xs"
          >
            <span>Return to Sign In</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </motion.div>
      ) : (
        /* Minimalist Centered Logo Animation */
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{
            opacity: [0.75, 1, 0.75],
            scale: [0.96, 1.04, 0.96],
          }}
          transition={{
            duration: 1.8,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="w-20 h-20 flex items-center justify-center"
        >
          <img
            src={logo}
            alt="DermAI Logo"
            className="w-full h-full object-contain"
          />
        </motion.div>
      )}
    </div>
  );
}