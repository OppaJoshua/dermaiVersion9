import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Crown, Zap, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

interface SubscriptionInfo {
  isPro: boolean;
  planName: string;
  billingCycle?: "monthly" | "yearly";
  renewsAt?: string;
  remainingDays?: number | null;
  maxScans: number;
  scansUsed: number;
}

interface BillingTransaction {
  id: string;
  date: string;
  description: string;
  amount: string;
  status: "paid" | "pending" | "failed";
}

const DEFAULT_MAX_FREE_SCANS = 3;

export default function SubscriptionStatusPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);

  const [subscription, setSubscription] = useState<SubscriptionInfo>({
    isPro: false,
    planName: "Free Plan",
    maxScans: DEFAULT_MAX_FREE_SCANS,
    scansUsed: 0,
    remainingDays: null,
  });

  const [billingHistory, setBillingHistory] = useState<BillingTransaction[]>([]);

  useEffect(() => {
    let isMounted = true;

    const loadSubscriptionStatus = async () => {
      setLoading(true);
      try {
        // TODO: Replace with real Supabase query once backend table is ready:
        // const { data: sub } = await supabase.from('subscriptions').select('*').eq('user_id', user?.id).single();
        // const { count: usedScans } = await supabase.from('ai_scans').select('*', { count: 'exact', head: true }).eq('user_id', user?.id);

        if (!isMounted) return;

        setSubscription({
          isPro: false,
          planName: "Free Plan",
          maxScans: DEFAULT_MAX_FREE_SCANS,
          scansUsed: 0,
          remainingDays: null,
        });
        setBillingHistory([]);
      } catch (err) {
        console.error("Failed to load subscription status:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadSubscriptionStatus();

    return () => {
      isMounted = false;
    };
  }, [user]);

  const { isPro, planName, maxScans, scansUsed, remainingDays } = subscription;
  const scansRemaining = isPro ? 999 : Math.max(0, maxScans - scansUsed);
  const remainingPercentage = isPro ? 100 : Math.min(100, Math.round((scansRemaining / maxScans) * 100));

  const planFeatures = isPro
    ? [
        "Unlimited AI Scans",
        "Priority Appointment Booking",
        "Advanced Skin Analytics & History",
      ]
    : [
        `${maxScans} Free AI Scans`,
        "Standard Booking",
        "Basic Skin Info",
      ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-display font-bold text-magenta-900">Subscription Status</h1>
        <p className="text-magenta-600">Manage your plan and usage limits</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Current Plan Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-[24px] p-8 shadow-[0_12px_48px_rgba(160,25,90,0.08)] border border-magenta-100 flex flex-col items-center text-center"
        >
          <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${isPro ? 'bg-amber-100 text-amber-600' : 'bg-magenta-100 text-magenta-600'}`}>
            {isPro ? <Crown className="w-8 h-8" /> : <Zap className="w-8 h-8" />}
          </div>
          <h2 className="text-xl font-bold text-magenta-900 mb-1">
            {planName}
          </h2>
          <p className="text-sm text-magenta-500 mb-6 font-medium">
            {isPro
              ? remainingDays !== null && remainingDays !== undefined
                ? `${remainingDays} days remaining`
                : "Active Subscription"
              : "Basic access"}
          </p>

          <div className="w-full space-y-3 text-left mb-8">
            {planFeatures.map((feat) => (
              <div key={feat} className="flex items-center gap-3 text-sm text-magenta-700">
                <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                <span>{feat}</span>
              </div>
            ))}
          </div>

          {!isPro && (
            <Link
              to="/dashboard/upgrade"
              className="w-full py-3 bg-magenta-500 text-white rounded-full font-semibold hover:bg-magenta-600 transition-colors shadow-lg shadow-magenta-500/20 text-center"
            >
              Upgrade to Pro
            </Link>
          )}
        </motion.div>

        {/* Usage Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-[24px] p-8 shadow-[0_12px_48px_rgba(160,25,90,0.08)] border border-magenta-100"
        >
          <h2 className="text-xl font-bold text-magenta-900 mb-6">Plan Usage</h2>
          
          <div className="space-y-6">
            <div>
              <div className="flex justify-between items-end mb-2">
                <span className="text-sm font-semibold text-magenta-900">AI Skin Scans</span>
                <span className="text-xs text-magenta-500 font-medium">
                  {loading
                    ? "Loading..."
                    : isPro
                    ? "Unlimited"
                    : `${scansRemaining} remaining (${scansUsed}/${maxScans} used)`}
                </span>
              </div>
              <div className="h-2 w-full bg-magenta-50 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-magenta-500 rounded-full transition-all duration-500"
                  style={{ width: `${remainingPercentage}%` }}
                />
              </div>
            </div>

            {!isPro && scansRemaining <= 0 && !loading && (
              <div className="bg-amber-50 border border-amber-100 p-4 rounded-xl flex gap-3">
                <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                <p className="text-xs text-amber-700 leading-relaxed">
                  You've reached your limit for free AI scans. Upgrade to Pro for unlimited scans and advanced insights.
                </p>
              </div>
            )}

            <div className="pt-4 border-t border-magenta-50">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-magenta-900">Billing History</h3>
                {billingHistory.length > 0 && (
                  <span className="text-xs text-magenta-500 font-medium">
                    {billingHistory.length} transaction{billingHistory.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {billingHistory.length > 0 ? (
                <div className="space-y-2">
                  {billingHistory.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-magenta-50/50 border border-magenta-100/60 text-xs"
                    >
                      <div>
                        <p className="font-semibold text-magenta-900">{item.description}</p>
                        <p className="text-magenta-500 text-[11px]">{item.date}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-magenta-900">{item.amount}</p>
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            item.status === "paid"
                              ? "bg-green-100 text-green-700"
                              : "bg-magenta-100 text-magenta-700"
                          }`}
                        >
                          {item.status.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-magenta-500 italic">No recent transactions found.</p>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
