import { motion } from "framer-motion";
import { Crown, Sparkles, CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getSubscriptionPlans } from "@/lib/store";


export default function SubscriptionChoicePage() {
  const navigate = useNavigate();

  const setPlan = (_plan: "free" | "premium") => {
    // TODO: Save subscription choice via Supabase and create subscription record
    navigate("/login", { state: { fromRegister: true } });
  };

  const plans = getSubscriptionPlans().filter((p) => p.status === "active");
  const freePlan = plans.find((p) => p.price === 0 && p.billingType === "one-time");
  const premiumPlan = plans.find((p) => p.billingType === "monthly" && p.scanLimit === null);

  return (
    <div className="min-h-screen bg-magenta-50 flex items-center justify-center px-4 py-12 sm:py-16">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-magenta-100/60 blur-3xl" />
        <div className="absolute -bottom-24 -right-24 w-72 h-72 rounded-full bg-magenta-200/50 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-4xl bg-white rounded-[24px] shadow-[0_12px_48px_rgba(160,25,90,0.12)] p-6 sm:p-8 border border-magenta-100 relative"
      >
        <div className="text-center mb-7">
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-magenta-900">Choose Your Plan</h1>
          <p className="text-sm text-magenta-500 mt-1">
            Select a subscription to continue your DERMAI account setup
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {/* Free Plan */}
          <div className="rounded-2xl border border-magenta-200 p-6 bg-white">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-5 h-5 text-magenta-500" />
              <h2 className="text-lg font-display font-bold text-magenta-900">{freePlan?.name ?? "Free Plan"}</h2>
            </div>
            <p className="text-3xl font-display font-bold text-magenta-900 mb-1">PHP 0</p>
            <p className="text-sm text-magenta-600 mb-4">{freePlan?.description ?? "1 skin scan per account"}</p>
            <ul className="space-y-2 text-sm text-magenta-700 mb-6">
              {(freePlan?.features ?? ["Basic AI skin analysis", "Access to skin library", "Clinic finder and booking"]).map((f) => (
                <li key={f} className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-magenta-500" /> {f}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setPlan("free")}
              className="w-full py-3 rounded-full border-2 border-magenta-500 text-magenta-600 font-semibold text-sm hover:bg-magenta-50 transition-colors"
            >
              Continue with Free
            </button>
          </div>

          {/* Premium Plan */}
          <div className="rounded-2xl border-2 border-magenta-500 p-6 bg-gradient-to-b from-magenta-50 to-white">
            <div className="inline-flex items-center px-2.5 py-1 rounded-full bg-magenta-500 text-white text-[11px] font-semibold mb-3">
              Recommended
            </div>
            <div className="flex items-center gap-2 mb-2">
              <Crown className="w-5 h-5 text-magenta-600" />
              <h2 className="text-lg font-display font-bold text-magenta-900">{premiumPlan?.name ?? "Premium Monthly"}</h2>
            </div>
            <p className="text-3xl font-display font-bold text-magenta-900 mb-1">PHP {premiumPlan?.price ?? 199}</p>
            <p className="text-sm text-magenta-600 mb-4">{premiumPlan?.description ?? "Unlimited skin scans"}</p>
            <ul className="space-y-2 text-sm text-magenta-700 mb-6">
              {(premiumPlan?.features ?? ["Unlimited AI skin analysis", "Priority analysis queue", "Premium support access"]).map((f) => (
                <li key={f} className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-magenta-500" /> {f}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setPlan("premium")}
              className="w-full py-3 rounded-full bg-magenta-500 text-white font-semibold text-sm hover:bg-magenta-600 transition-colors shadow-lg shadow-magenta-500/20"
            >
              Choose {premiumPlan?.name ?? "Premium Monthly"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
