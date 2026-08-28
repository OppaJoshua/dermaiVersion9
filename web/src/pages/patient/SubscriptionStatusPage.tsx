import { useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Crown, Zap, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";

export default function SubscriptionStatusPage() {
  // TODO: Load subscription status from Supabase using authenticated user session
  const [isPro] = useState(false);
  const [scanLimit] = useState(1);
  const remainingDays = 0;

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
            {isPro ? "Pro Plan" : "Free Plan"}
          </h2>
          <p className="text-sm text-magenta-500 mb-6 font-medium">
            {isPro ? `${remainingDays} days remaining` : "Basic access"}
          </p>

          <div className="w-full space-y-3 text-left mb-8">
            <div className="flex items-center gap-3 text-sm text-magenta-700">
              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
              <span>{isPro ? "Unlimited AI Scans" : "1 AI Scan per day"}</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-magenta-700">
              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
              <span>{isPro ? "Priority Appointment Booking" : "Standard Booking"}</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-magenta-700">
              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
              <span>{isPro ? "Advanced Skin Analytics" : "Basic Skin Info"}</span>
            </div>
          </div>

          {!isPro && (
            <Link
              to="/dashboard/upgrade"
              className="w-full py-3 bg-magenta-500 text-white rounded-full font-semibold hover:bg-magenta-600 transition-colors shadow-lg shadow-magenta-500/20"
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
          <h2 className="text-xl font-bold text-magenta-900 mb-6">Daily Usage</h2>
          
          <div className="space-y-6">
            <div>
              <div className="flex justify-between items-end mb-2">
                <span className="text-sm font-semibold text-magenta-900">AI Skin Scans</span>
                <span className="text-xs text-magenta-500 font-medium">
                  {isPro ? "Unlimited" : `${Math.max(0, scanLimit)} remaining`}
                </span>
              </div>
              <div className="h-2 w-full bg-magenta-50 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-magenta-500 rounded-full transition-all duration-500"
                  style={{ width: isPro ? '100%' : `${(scanLimit / 1) * 100}%` }}
                />
              </div>
            </div>

            {!isPro && scanLimit <= 0 && (
              <div className="bg-amber-50 border border-amber-100 p-4 rounded-xl flex gap-3">
                <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                <p className="text-xs text-amber-700 leading-relaxed">
                  You've reached your daily limit for AI scans. Upgrade to Pro for unlimited scans and advanced insights.
                </p>
              </div>
            )}

            <div className="pt-4 border-t border-magenta-50">
              <h3 className="text-sm font-bold text-magenta-900 mb-3">Billing History</h3>
              <p className="text-xs text-magenta-500 italic">No recent transactions found.</p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
