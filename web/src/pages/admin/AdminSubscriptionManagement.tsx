import { useMemo, useState, useEffect } from "react";
import { CreditCard, RefreshCcw, DollarSign, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { withVat } from "@/lib/vat";
import { syncAllExpiredSubscriptions } from "@/lib/subscriptionService";

type SubscriptionStatus = "active" | "expired" | "cancelled";

type PremiumUser = {
    id: string | number;
    name: string;
    email: string;
    plan: string;
    startedAt: string;
    renewsAt: string;
    status: SubscriptionStatus;
    isAccessActive?: boolean;
    cancelledAtDate?: string;
};

type Transaction = {
    id: string;
    user: string;
    plan: string;
    amount: number;
    date: string;
    method: "GCash" | "Maya" |  "Unknown";
    status: "paid";
};

const statusClasses: Record<SubscriptionStatus, string> = {
    active: "bg-gray-100 border-gray-300 text-black",
    expired: "bg-magenta-50 border-magenta-200 text-black",
    cancelled: "bg-magenta-100 border-magenta-300 text-black",
};

const statusLabels: Record<SubscriptionStatus, string> = {
    active: "Active",
    expired: "Expired",
    cancelled: "Cancelled",
};

function formatPhp(amount: number) {
    return new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: "PHP",
        maximumFractionDigits: 0,
    }).format(amount);
}

export default function AdminSubscriptionManagement() {
    const [premiumUsers, setPremiumUsers] = useState<PremiumUser[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<"all" | SubscriptionStatus>("all");

    useEffect(() => {
        async function loadData() {
            setLoading(true);
            try {
                // Proactively synchronize any expired subscriptions in the database
                await syncAllExpiredSubscriptions().catch(() => {});

                // 1. Load subscriptions
                const { data: subsData } = await supabase
                    .from("user_plan_subscription")
                    .select(`
                        subscription_id,
                        started_at,
                        renews_at,
                        current_period_start,
                        current_period_end,
                        cancel_at_period_end,
                        cancelled_at,
                        status,
                        billing_cycle,
                        user:user_id (
                            full_name,
                            email
                        ),
                        plan:plan_id (
                            name,
                            price
                        )
                    `)
                    .order("started_at", { ascending: false });

                if (subsData) {
                    const users: PremiumUser[] = subsData.map((s: any, idx: number) => {
                        const userObj: any = Array.isArray(s.user) ? s.user[0] : s.user;
                        const planObj: any = Array.isArray(s.plan) ? s.plan[0] : s.plan;

                        // Start date fallback
                        const startRaw = s.started_at || s.current_period_start;
                        const startedAt = startRaw
                            ? new Date(startRaw).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                            : "—";

                        // Renewal / Expiration date fallback
                        const renewRaw = s.renews_at || s.current_period_end;
                        const renewsAt = renewRaw
                            ? new Date(renewRaw).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                            : "—";

                        // Period end calculation
                        const periodEndMs = s.current_period_end
                            ? new Date(s.current_period_end).getTime()
                            : (s.renews_at ? new Date(s.renews_at).getTime() : null);
                        const isPeriodExpired = periodEndMs !== null && periodEndMs <= Date.now();

                        // Cancellation check: user flagged cancel_at_period_end, or has cancelled_at date, or status is cancelled
                        const isCancelled = Boolean(
                            s.cancel_at_period_end === true ||
                            s.cancelled_at ||
                            s.status === "cancelled" ||
                            s.status === "cancelling"
                        );

                        let calculatedStatus: SubscriptionStatus = "active";
                        if (isCancelled) {
                            calculatedStatus = "cancelled";
                        } else if (s.status === "expired" || isPeriodExpired) {
                            calculatedStatus = "expired";
                        } else {
                            calculatedStatus = "active";
                        }

                        const cancelledAtDate = s.cancelled_at
                            ? new Date(s.cancelled_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                            : undefined;

                        const isAccessActive = isCancelled && periodEndMs !== null && periodEndMs > Date.now();

                        return {
                            id: s.subscription_id || idx,
                            name: userObj?.full_name || "Patient",
                            email: userObj?.email || "",
                            plan: planObj?.name || (s.billing_cycle === "yearly" ? "Premium Annual" : "Premium Monthly"),
                            startedAt,
                            renewsAt,
                            status: calculatedStatus,
                            isAccessActive,
                            cancelledAtDate,
                        };
                    });
                    setPremiumUsers(users);
                }

                // 2. Load transactions
                const { data: payData } = await supabase
                    .from("user_payment")
                    .select(`
                        payment_id,
                        amount,
                        payment_date,
                        method,
                        status,
                        user:user_id (
                            full_name,
                            email
                        ),
                        plan:plan_id (
                            name,
                            price
                        )
                    `)
                    .order("payment_date", { ascending: false });

                if (payData) {
                    const txns: Transaction[] = payData.map((p: any) => {
                        const userObj: any = Array.isArray(p.user) ? p.user[0] : p.user;
                        const planObj: any = Array.isArray(p.plan) ? p.plan[0] : p.plan;
                        const rawAmount = Number(p.total_amount ?? p.amount_paid ?? p.amount ?? 0);

                        let resolvedTotal = rawAmount;
                        if (p.total_amount != null && Number(p.total_amount) > 0) {
                            resolvedTotal = Number(p.total_amount);
                        } else if (p.amount_paid != null && Number(p.amount_paid) > 0) {
                            resolvedTotal = Number(p.amount_paid);
                        } else if (planObj?.price != null && Number(planObj.price) > 0) {
                            resolvedTotal = withVat(Number(planObj.price));
                        } else if (rawAmount === 177.68) {
                            resolvedTotal = 199.00;
                        }

                        return {
                            id: p.payment_id.slice(0, 8).toUpperCase(),
                            user: userObj?.full_name || userObj?.email || "Patient",
                            plan: planObj?.name || "Premium Plan",
                            amount: resolvedTotal,
                            date: new Date(p.payment_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
                            method: p.method === "gcash" ? "GCash" : p.method === "paymaya" ? "Maya" : "Unknown",
                            status: "paid",
                        };
                    });
                    setTransactions(txns);
                }
            } catch {
                /* ignore */
            } finally {
                setLoading(false);
            }
        }
        loadData();
    }, []);

    const visibleUsers = premiumUsers.filter((user) => statusFilter === "all" ? true : user.status === statusFilter);
    const totalRevenue = useMemo(() => transactions.reduce((sum, txn) => sum + txn.amount, 0), [transactions]);
    const activeCount = premiumUsers.filter((u) => u.status === "active").length;
    const cancelledCount = premiumUsers.filter((u) => u.status === "cancelled").length;

    return (<div className="space-y-8">
      <div>
        <h1 className="text-2xl font-display font-bold text-black">Subscription Management</h1>
        <p className="text-sm text-gray-600 mt-1">
          Subscriptions are managed automatically: active on payment, cancelled by the patient, expired on a missed renewal.
        </p>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl p-7 border border-gray-200 shadow-sm">
          <p className="text-sm font-semibold text-black">Free plan</p>
          <p className="text-3xl font-bold text-black mt-4">₱0</p>
          <p className="text-sm text-gray-600 mt-2">1 free skin scan, then upgrade required</p>
        </div>
        <div className="bg-white rounded-xl p-7 border border-magenta-200 shadow-sm">
          <p className="text-sm font-semibold text-black">Premium monthly</p>
          <p className="text-3xl font-bold text-black mt-4">₱199 <span className="text-base font-medium text-gray-600">/ month</span></p>
          <p className="text-sm text-gray-600 mt-2">Unlimited skin scans</p>
        </div>
        <div className="bg-white rounded-xl p-7 border-2 border-magenta-500 shadow-sm relative">
          <span className="absolute top-5 right-5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-magenta-600 text-white">SAVE 16%</span>
          <p className="text-sm font-semibold text-black">Premium annual</p>
          <p className="text-3xl font-bold text-black mt-4">₱1,999 <span className="text-base font-medium text-gray-600">/ year</span></p>
          <p className="text-sm text-gray-600 mt-2">Unlimited skin scans, best value</p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-xl p-7 border border-gray-200 shadow-sm min-h-[156px]">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-black">Premium users</p>
            <CreditCard className="w-5 h-5 text-magenta-600"/>
          </div>
          <p className="mt-5 text-4xl font-bold text-black tabular-nums">{premiumUsers.length}</p>
          <p className="mt-2 text-sm text-gray-600">All subscriptions</p>
        </div>
        <div className="bg-white rounded-xl p-7 border border-gray-200 shadow-sm min-h-[156px]">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-black">Revenue</p>
            <DollarSign className="w-5 h-5 text-magenta-600"/>
          </div>
          <p className="mt-5 text-4xl font-bold text-black tabular-nums">{formatPhp(totalRevenue)}</p>
          <p className="mt-2 text-sm text-gray-600">Total paid transactions</p>
        </div>
        <div className="bg-white rounded-xl p-7 border border-gray-200 shadow-sm min-h-[156px]">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-black">Active plans</p>
            <RefreshCcw className="w-5 h-5 text-magenta-600"/>
          </div>
          <p className="mt-5 text-4xl font-bold text-black tabular-nums">{activeCount}</p>
          <p className="mt-2 text-sm text-gray-600">Currently renewing</p>
        </div>
        <div className="bg-white rounded-xl p-7 border border-gray-200 shadow-sm min-h-[156px]">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-black">Cancelled plans</p>
            <XCircle className="w-5 h-5 text-magenta-600"/>
          </div>
          <p className="mt-5 text-4xl font-bold text-black tabular-nums">{cancelledCount}</p>
          <p className="mt-2 text-sm text-gray-600">Will not renew</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-black mr-2">Status</span>
          {(["all", "active", "expired", "cancelled"] as const).map((status) => {
            const count = status === "all"
              ? premiumUsers.length
              : premiumUsers.filter((u) => u.status === status).length;
            return (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 cursor-pointer",
                  statusFilter === status
                    ? "bg-magenta-600 text-white"
                    : "bg-gray-100 text-black hover:bg-gray-200"
                )}
              >
                <span>{status === "all" ? "All" : statusLabels[status]}</span>
                <span
                  className={cn(
                    "text-xs px-2 py-0.5 rounded-full font-bold leading-none",
                    statusFilter === status
                      ? "bg-white/20 text-white"
                      : "bg-white text-black border border-gray-200"
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Subscriptions table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-7 py-5 border-b border-gray-200 flex items-baseline justify-between">
          <h3 className="text-lg font-semibold text-black">Premium user subscriptions</h3>
          <span className="text-sm text-gray-600">{visibleUsers.length} shown</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-black">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">User</th>
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Plan</th>
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Start date</th>
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Renewal date</th>
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-7 py-16 text-center text-sm text-gray-600">
                    <Loader2 className="w-6 h-6 text-magenta-600 animate-spin mx-auto mb-3"/>
                    Loading user subscriptions…
                  </td>
                </tr>
              ) : visibleUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-7 py-16 text-center text-sm text-gray-600">
                    No subscriptions found.
                  </td>
                </tr>
              ) : (
                visibleUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-7 py-5">
                      <p className="text-sm font-semibold text-black">{user.name}</p>
                      <p className="text-xs text-gray-600">{user.email}</p>
                    </td>
                    <td className="px-7 py-5 text-sm text-black">
                      <span className={cn("inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border text-black", user.plan === "Premium Annual"
                        ? "bg-magenta-50 border-magenta-300"
                        : user.plan === "Premium Monthly"
                            ? "bg-white border-magenta-200"
                            : "bg-gray-100 border-gray-200")}>
                        {user.plan}
                      </span>
                    </td>
                    <td className="px-7 py-5 text-sm text-black">{user.startedAt}</td>
                    <td className="px-7 py-5 text-sm text-black">
                      {user.status === "cancelled" ? (
                        <div>
                          <span>{user.renewsAt}</span>
                          <span className="block text-xs text-gray-600 font-medium">
                            {user.isAccessActive ? "Access until date" : "Does not renew"}
                          </span>
                        </div>
                      ) : (
                        user.renewsAt
                      )}
                    </td>
                    <td className="px-7 py-5">
                      <div className="flex flex-col items-start gap-1.5">
                        <span className={cn("inline-flex px-3 py-1 rounded-full border text-xs font-semibold", statusClasses[user.status])}>
                          {statusLabels[user.status]}
                        </span>
                        {user.status === "cancelled" && user.isAccessActive && (
                          <span className="text-xs text-gray-600 font-medium">
                            Active until period close
                          </span>
                        )}
                        {user.status === "cancelled" && !user.isAccessActive && user.cancelledAtDate && (
                          <span className="text-xs text-gray-600">
                            Cancelled {user.cancelledAtDate}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Transactions table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-7 py-5 border-b border-gray-200 flex items-baseline justify-between">
          <h3 className="text-lg font-semibold text-black">Transaction history</h3>
          <span className="text-sm text-gray-600">{transactions.length} transactions</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-black">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Transaction ID</th>
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">User</th>
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Plan</th>
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Amount</th>
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Date</th>
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Method</th>
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-7 py-16 text-center text-sm text-gray-600">
                    <Loader2 className="w-6 h-6 text-magenta-600 animate-spin mx-auto mb-3"/>
                    Loading payment transactions…
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-7 py-16 text-center text-sm text-gray-600">
                    No transactions recorded yet.
                  </td>
                </tr>
              ) : (
                transactions.map((txn) => (
                  <tr key={txn.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-7 py-5">
                      <span className="inline-block px-2.5 py-1 rounded-md bg-gray-100 font-mono text-xs font-semibold text-black">{txn.id}</span>
                    </td>
                    <td className="px-7 py-5 text-sm font-medium text-black">{txn.user}</td>
                    <td className="px-7 py-5 text-sm text-black">{txn.plan}</td>
                    <td className="px-7 py-5 text-sm font-semibold text-black">{formatPhp(txn.amount)}</td>
                    <td className="px-7 py-5 text-sm text-black">{txn.date}</td>
                    <td className="px-7 py-5 text-sm text-black">{txn.method}</td>
                    <td className="px-7 py-5">
                      <span className="inline-flex px-3 py-1 rounded-full border border-gray-300 bg-gray-100 text-xs font-semibold capitalize text-black">
                        {txn.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>);
}