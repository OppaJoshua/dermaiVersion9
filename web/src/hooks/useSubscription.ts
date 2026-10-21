import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import {
  validateAndSyncSubscription,
  type UserSubscriptionInfo,
} from "@/lib/subscriptionService";

/**
 * Custom hook for subscribing to real-time subscription status.
 * Dynamically evaluates whether the authenticated patient has active Pro access:
 * const isPro = subscription && subscription.status === 'active' && new Date(subscription.current_period_end).getTime() > Date.now();
 */
export function useSubscription() {
  const { user } = useAuth();
  const [subInfo, setSubInfo] = useState<UserSubscriptionInfo>({
    tier: "Free",
    tierLabel: "Free Plan",
    isPro: false,
    isExpired: false,
    status: "none",
    currentPeriodStart: null,
    currentPeriodEnd: null,
    scanLimit: 3,
    subscription: null,
    plan: null,
  });
  const [loading, setLoading] = useState(true);

  const fetchSubscription = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    try {
      const res = await validateAndSyncSubscription(user.id);
      setSubInfo(res);
    } catch (err) {
      console.warn("[useSubscription] Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchSubscription();

    const handleUpdate = () => {
      fetchSubscription();
    };

    window.addEventListener("dermai_subscription_updated", handleUpdate);
    window.addEventListener("derm_profile_updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);

    const channel = user?.id
      ? supabase
          .channel(`use-subscription-${user.id}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "user_plan_subscription",
              filter: `user_id=eq.${user.id}`,
            },
            () => {
              fetchSubscription();
            }
          )
          .subscribe()
      : null;

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
      window.removeEventListener("dermai_subscription_updated", handleUpdate);
      window.removeEventListener("derm_profile_updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, [fetchSubscription, user?.id]);

  // Dynamic Plan Evaluation strictly matching requirements
  const isPro = useMemo(() => {
    const subscription = subInfo.subscription;
    return Boolean(
      subscription &&
        (subscription.status === "active" ||
          subscription.status === "cancelling" ||
          subscription.status === "pending_downgrade") &&
        subscription.current_period_end &&
        new Date(subscription.current_period_end).getTime() > Date.now()
    );
  }, [subInfo.subscription]);

  return {
    ...subInfo,
    isPro,
    loading,
    refetch: fetchSubscription,
  };
}
