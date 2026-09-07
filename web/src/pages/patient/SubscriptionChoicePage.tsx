import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Crown, Sparkles, CheckCircle2, Loader2, PackageOpen } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getSubscriptionPlansAsync, type SubscriptionPlan } from "@/lib/store";

export default function SubscriptionChoicePage() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const activePlans = await getSubscriptionPlansAsync(false);
        if (!cancelled) setPlans(activePlans);
      } catch {
        if (!cancelled) setPlans([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const setPlan = (_planId: string) => {
    navigate("/login", { state: { fromRegister: true } });
  };

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

        {loading ? (
          <div className="py-20 text-center">
            <Loader2 className="w-8 h-8 text-magenta-500 animate-spin mx-auto mb-2" />
            <p className="text-xs text-magenta-400 font-medium">Loading subscription plans...</p>
          </div>
        ) : plans.length === 0 ? (
          <div className="py-20 text-center">
            <PackageOpen className="w-12 h-12 text-magenta-200 mx-auto mb-3" />
            <p className="text-base text-gray-700 font-semibold">No subscription plans available</p>
            <p className="text-xs text-gray-400 mt-1">Please check back later or contact support.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            {plans.map((p) => {
              const isPremium = p.price > 0;
              return (
                <div
                  key={p.id}
                  className={`rounded-2xl p-6 ${
                    isPremium
                      ? "border-2 border-magenta-500 bg-gradient-to-b from-magenta-50 to-white"
                      : "border border-magenta-200 bg-white"
                  }`}
                >
                  {isPremium && (
                    <div className="inline-flex items-center px-2.5 py-1 rounded-full bg-magenta-500 text-white text-[11px] font-semibold mb-3">
                      Recommended
                    </div>
                  )}
                  <div className="flex items-center gap-2 mb-2">
                    {isPremium ? (
                      <Crown className="w-5 h-5 text-magenta-600" />
                    ) : (
                      <Sparkles className="w-5 h-5 text-magenta-500" />
                    )}
                    <h2 className="text-lg font-display font-bold text-magenta-900">{p.name}</h2>
                  </div>
                  <p className="text-3xl font-display font-bold text-magenta-900 mb-1">
                    {p.price === 0 ? "PHP 0" : `PHP ${p.price.toLocaleString()}`}
                  </p>
                  <p className="text-sm text-magenta-600 mb-4">{p.description}</p>
                  <ul className="space-y-2 text-sm text-magenta-700 mb-6">
                    {p.features.map((f, fi) => (
                      <li key={fi} className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-magenta-500 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => setPlan(p.id)}
                    className={`w-full py-3 rounded-full font-semibold text-sm transition-colors ${
                      isPremium
                        ? "bg-magenta-500 text-white hover:bg-magenta-600 shadow-lg shadow-magenta-500/20"
                        : "border-2 border-magenta-500 text-magenta-600 hover:bg-magenta-50"
                    }`}
                  >
                    Choose {p.name}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </motion.div>
    </div>
  );
}
