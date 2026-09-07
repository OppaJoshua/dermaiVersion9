import { useMemo, useState, useEffect } from "react";
import { CreditCard, RefreshCcw, DollarSign, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";

type SubscriptionStatus = "active" | "expired" | "cancelled";

type PremiumUser = {
    id: string | number;
    name: string;
    email: string;
    plan: string;
    startedAt: string;
    renewsAt: string;
    status: SubscriptionStatus;
};

type Transaction = {
    id: string;
    user: string;
    plan: string;
    amount: number;
    date: string;
    method: "GCash" | "Card" | "Bank Transfer";
    status: "paid";
};

const statusClasses: Record<SubscriptionStatus, string> = {
    active: "bg-green-100 text-green-700",
    expired: "bg-amber-100 text-amber-700",
    cancelled: "bg-red-100 text-red-700",
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
                // 1. Load subscriptions
                const { data: subsData } = await supabase
                    .from("user_plan_subscription")
                    .select(`
                        subscription_id,
                        started_at,
                        renews_at,
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
                        return {
                            id: s.subscription_id || idx,
                            name: userObj?.full_name || "Patient",
                            email: userObj?.email || "",
                            plan: planObj?.name || (s.billing_cycle === "yearly" ? "Premium Annual" : "Premium Monthly"),
                            startedAt: new Date(s.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
                            renewsAt: s.renews_at ? new Date(s.renews_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—",
                            status: s.status as SubscriptionStatus,
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
                            name
                        )
                    `)
                    .order("payment_date", { ascending: false });

                if (payData) {
                    const txns: Transaction[] = payData.map((p: any) => {
                        const userObj: any = Array.isArray(p.user) ? p.user[0] : p.user;
                        const planObj: any = Array.isArray(p.plan) ? p.plan[0] : p.plan;
                        return {
                            id: p.payment_id.slice(0, 8).toUpperCase(),
                            user: userObj?.full_name || userObj?.email || "Patient",
                            plan: planObj?.name || "Premium Plan",
                            amount: Number(p.amount) || 0,
                            date: new Date(p.payment_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
                            method: p.method === "gcash" ? "GCash" : p.method === "card" ? "Card" : "Bank Transfer",
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
    return (<div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-gray-900">Subscription Management</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Subscriptions are managed automatically — Active on payment, Cancelled by patient, Expired on missed renewal.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Free Plan</p>
          <p className="text-lg font-display font-bold text-gray-900 mt-1">₱0</p>
          <p className="text-sm text-gray-500">1 free skin scan, then upgrade required</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-magenta-200">
          <p className="text-xs font-semibold uppercase tracking-wider text-magenta-500">Premium Monthly</p>
          <p className="text-lg font-display font-bold text-gray-900 mt-1">₱199 <span className="text-sm font-normal text-gray-400">/ month</span></p>
          <p className="text-sm text-gray-500">Unlimited skin scans</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border-2 border-magenta-400 relative overflow-hidden">
          <span className="absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-magenta-500 text-white">SAVE 16%</span>
          <p className="text-xs font-semibold uppercase tracking-wider text-magenta-500">Premium Annual</p>
          <p className="text-lg font-display font-bold text-gray-900 mt-1">₱1,999 <span className="text-sm font-normal text-gray-400">/ year</span></p>
          <p className="text-sm text-gray-500">Unlimited skin scans · best value</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <div className="flex items-center gap-2 text-magenta-600 mb-2">
            <CreditCard className="w-4 h-4"/>
            <p className="text-xs font-semibold uppercase tracking-wider">Premium Users</p>
          </div>
          <p className="text-2xl font-display font-bold text-gray-900">{premiumUsers.length}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <div className="flex items-center gap-2 text-green-700 mb-2">
            <DollarSign className="w-4 h-4"/>
            <p className="text-xs font-semibold uppercase tracking-wider">Revenue</p>
          </div>
          <p className="text-2xl font-display font-bold text-gray-900">{formatPhp(totalRevenue)}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <div className="flex items-center gap-2 text-blue-700 mb-2">
            <RefreshCcw className="w-4 h-4"/>
            <p className="text-xs font-semibold uppercase tracking-wider">Active Plans</p>
          </div>
          <p className="text-2xl font-display font-bold text-gray-900">{activeCount}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <div className="flex flex-wrap gap-2">
          {(["all", "active", "expired", "cancelled"] as const).map((status) => (<button key={status} onClick={() => setStatusFilter(status)} className={cn("px-4 py-2 rounded-full text-xs font-semibold transition-colors", statusFilter === status
                ? "bg-magenta-500 text-white"
                : "bg-gray-50 text-gray-600 hover:bg-gray-100")}>
              {status === "all" ? "All" : statusLabels[status]}
            </button>))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-display font-bold text-gray-900">Premium User Subscriptions</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">User</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Plan</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Start Date</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Renewal Date</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-sm text-gray-400">
                    <Loader2 className="w-8 h-8 text-magenta-500 animate-spin mx-auto mb-2" />
                    Loading user subscriptions...
                  </td>
                </tr>
              ) : visibleUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-sm text-gray-400">
                    No subscriptions found.
                  </td>
                </tr>
              ) : (
                visibleUsers.map((user) => (
                  <tr key={user.id} className="border-t border-gray-50 hover:bg-gray-50/70 transition-colors">
                    <td className="px-6 py-4">
                      <p className="text-sm font-semibold text-gray-900">{user.name}</p>
                      <p className="text-xs text-gray-400">{user.email}</p>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold", user.plan === "Premium Annual"
                        ? "bg-magenta-100 text-magenta-700 border border-magenta-200"
                        : user.plan === "Premium Monthly"
                            ? "bg-pink-50 text-pink-700 border border-pink-100"
                            : "bg-gray-100 text-gray-500")}>
                        {user.plan}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">{user.startedAt}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{user.renewsAt}</td>
                    <td className="px-6 py-4">
                      <span className={cn("px-3 py-1 rounded-full text-xs font-semibold", statusClasses[user.status])}>
                        {statusLabels[user.status]}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-display font-bold text-gray-900">Transaction History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Transaction ID</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">User</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Plan</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Amount</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Date</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Method</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-sm text-gray-400">
                    <Loader2 className="w-8 h-8 text-magenta-500 animate-spin mx-auto mb-2" />
                    Loading payment transactions...
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-sm text-gray-400">
                    No transactions recorded yet.
                  </td>
                </tr>
              ) : (
                transactions.map((txn) => (
                  <tr key={txn.id} className="border-t border-gray-50 hover:bg-gray-50/70 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-gray-700">{txn.id}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{txn.user}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{txn.plan}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{formatPhp(txn.amount)}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{txn.date}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{txn.method}</td>
                    <td className="px-6 py-4">
                      <span className="px-3 py-1 rounded-full text-xs font-semibold capitalize bg-green-100 text-green-700">
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
