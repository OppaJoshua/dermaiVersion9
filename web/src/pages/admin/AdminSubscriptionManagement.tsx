import { useMemo, useState } from "react";
import { CreditCard, RefreshCcw, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { logAdminAction } from "@/lib/auditLog";
type SubscriptionStatus = "active" | "expired" | "cancelled";
type PremiumUser = {
    id: number;
    name: string;
    email: string;
    plan: "Premium Monthly" | "Premium Annual" | "Free";
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
    // TODO: Load subscription users and transactions from Supabase
    const [premiumUsers] = useState<PremiumUser[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [statusFilter, setStatusFilter] = useState<"all" | SubscriptionStatus>("all");
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
              {visibleUsers.map((user) => (<tr key={user.id} className="border-t border-gray-50 hover:bg-gray-50/70 transition-colors">
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
                </tr>))}
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
              {transactions.map((txn) => (<tr key={txn.id} className="border-t border-gray-50 hover:bg-gray-50/70 transition-colors">
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
                </tr>))}
            </tbody>
          </table>
        </div>
      </div>

    </div>);
}
