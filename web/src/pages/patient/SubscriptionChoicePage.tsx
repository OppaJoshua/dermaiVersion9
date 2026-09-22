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
    // Persist plan choice so it survives the login/register redirect
    try {
      sessionStorage.setItem("dermai_chosen_plan", _planId);
    } catch {
      /* ignore storage errors in restricted environments */
    }
    navigate("/login", { state: { fromRegister: true } });
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 flex items-center justify-center px-4 py-12 sm:py-16 font-sans antialiased">
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-4xl bg-white rounded-3xl border border-gray-100 shadow-sm p-6 sm:p-10 relative"
      >
        <div className="text-center mb-8">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-magenta-50 text-magenta-600 text-xs font-semibold mb-3">
            <Sparkles className="w-3.5 h-3.5" /> Plans &amp; Pricing
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">Choose Your Plan</h1>
          <p className="text-sm text-gray-500 mt-1.5">
            Select a subscription to continue your DERMAI account setup
          </p>
        </div>

        {loading ? (
          <div className="py-20 text-center">
            <Loader2 className="w-8 h-8 text-magenta-500 animate-spin mx-auto mb-2" />
            <p className="text-xs text-gray-400 font-medium">Loading subscription plans...</p>
          </div>
        ) : plans.length === 0 ? (
          <div className="py-20 text-center">
            <PackageOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-base text-gray-700 font-semibold">No subscription plans available</p>
            <p className="text-xs text-gray-400 mt-1">Please check back later or contact support.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {plans.map((p) => {
              const isPremium = p.price > 0;
              return (
                <div
                  key={p.id}
                  className={`rounded-3xl p-6 sm:p-7 flex flex-col justify-between transition-all ${
                    isPremium
                      ? "border-2 border-magenta-500 bg-white shadow-xs relative"
                      : "border border-gray-200 bg-white"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isPremium ? 'bg-magenta-50 text-magenta-600' : 'bg-gray-100 text-gray-600'}`}>
                          {isPremium ? <Crown className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
                        </div>
                        <h2 className="text-lg font-bold text-gray-900">{p.name}</h2>
                      </div>
                      {isPremium && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-magenta-600 text-white text-[10px] font-bold tracking-wide uppercase">
                          Recommended
                        </span>
                      )}
                    </div>

                    <div className="mb-4">
                      <span className="text-3xl font-bold text-gray-900 tracking-tight">
                        {p.price === 0 ? "Free" : `₱${p.price.toLocaleString()}`}
                      </span>
                      {p.price > 0 && <span className="text-xs text-gray-400 ml-1.5 font-medium">/ month</span>}
                    </div>

                    <p className="text-xs text-gray-500 mb-6 leading-relaxed">{p.description}</p>

                    <div className="space-y-2.5 pt-4 border-t border-gray-100 mb-6">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Features</p>
                      {p.features.map((f, fi) => (
                        <div key={fi} className="flex items-center gap-2.5 text-xs text-gray-700">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                          <span>{f}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setPlan(p.id)}
                    className={`w-full py-3 rounded-full font-semibold text-xs tracking-wide transition-all active:scale-[0.98] ${
                      isPremium
                        ? "bg-magenta-600 text-white hover:bg-magenta-700 shadow-sm cursor-pointer"
                        : "border border-gray-200 text-gray-700 hover:bg-gray-50 cursor-pointer"
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
