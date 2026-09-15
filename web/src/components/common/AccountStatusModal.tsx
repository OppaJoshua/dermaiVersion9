import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ShieldAlert, Mail, LogOut, AlertCircle, User } from "lucide-react";
import { useAuth } from "../../context/AuthContext";

export default function AccountStatusModal() {
  const { accountStatus, user, signOut, role } = useAuth();
  const navigate = useNavigate();

  // Admins are never blocked
  if (!user || role === "admin" || accountStatus === "active") {
    return null;
  }

  const isSuspended = accountStatus === "suspended";

  const handleSignOut = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[99999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 8 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="bg-white rounded-2xl shadow-2xl border border-slate-100 max-w-[400px] w-full p-6 text-center relative"
        >
          {/* Minimalist Status Icon */}
          <div
            className={`w-11 h-11 rounded-full mx-auto mb-3.5 flex items-center justify-center ${
              isSuspended
                ? "bg-amber-50 text-amber-600 border border-amber-100"
                : "bg-slate-100 text-slate-600 border border-slate-200"
            }`}
          >
            {isSuspended ? (
              <ShieldAlert className="w-5 h-5" strokeWidth={2} />
            ) : (
              <AlertCircle className="w-5 h-5" strokeWidth={2} />
            )}
          </div>

          {/* Heading */}
          <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
            {isSuspended ? "Account Suspended" : "Account Deactivated"}
          </h2>

          {/* Subtext */}
          <p className="text-xs text-slate-500 leading-relaxed mt-1.5 px-1 font-normal">
            {isSuspended
              ? "Your account access has been temporarily restricted by an administrator. Booking and skin scan services are currently disabled."
              : "This account has been deactivated. Please reach out to our team if you wish to reactivate your access."}
          </p>

          {/* Clean User Information Row */}
          <div className="mt-4 mb-5 p-3 rounded-xl bg-slate-50/80 border border-slate-100 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 min-w-0 pr-2 text-left">
              <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="font-medium text-slate-700 truncate">
                {user.email}
              </span>
            </div>
            <span
              className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-md uppercase tracking-wider ${
                isSuspended
                  ? "bg-amber-100/70 text-amber-800 border border-amber-200/50"
                  : "bg-slate-200/70 text-slate-700 border border-slate-300/50"
              }`}
            >
              {accountStatus}
            </span>
          </div>

          {/* Minimalist Action Buttons */}
          <div className="space-y-2">
            <a
              href={`mailto:dermaisupport@gmail.com?subject=${encodeURIComponent(
                isSuspended
                  ? "Account Suspension Appeal - " + (user.email || "")
                  : "Account Reactivation Request - " + (user.email || "")
              )}`}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors shadow-xs active:scale-[0.99]"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>Contact Support</span>
            </a>

            <button
              type="button"
              onClick={handleSignOut}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 hover:text-slate-900 text-xs font-semibold transition-colors cursor-pointer active:scale-[0.99]"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
