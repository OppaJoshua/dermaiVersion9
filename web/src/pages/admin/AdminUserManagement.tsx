import { useState } from "react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { X, Eye, Lock, Unlock, UserX } from "lucide-react";
import { logAdminAction } from "@/lib/auditLog";
import { updatePlatformUserStatus } from "@/lib/store";
type UserStatus = "active" | "suspended" | "inactive";
type User = {
    id: number;
    name: string;
    email: string;
    phone: string;
    joinedAt: string;
    status: UserStatus;
    plan: "Free" | "Premium";
    scansUsed: number;
    scansLimit: number;
};
type StatusType = "all" | "active" | "suspended" | "inactive";
const statusBadge: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    suspended: "bg-amber-100 text-amber-700",
    inactive: "bg-gray-100 text-gray-700",
};
export default function AdminUserManagement() {
    // TODO: Load users from Supabase
    const [users, setUsers] = useState<User[]>([]);
    const [activeTab, setActiveTab] = useState<StatusType>("all");
    const [reviewModal, setReviewModal] = useState<number | null>(null);
    const filtered = users.filter((u) => activeTab === "all" || u.status === activeTab);
    const modalUser = users.find((u) => u.id === reviewModal);
    const suspendUser = (id: number) => {
        const user = users.find((u) => u.id === id);
        setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, status: "suspended" } : u)));
        if (user) {
            updatePlatformUserStatus(user.email, "suspended");
            logAdminAction("User Suspended", user.name, `Account suspended by admin.`, "user");
        }
    };
    const unsuspendUser = (id: number) => {
        const user = users.find((u) => u.id === id);
        setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, status: "active" } : u)));
        if (user) {
            updatePlatformUserStatus(user.email, "active");
            logAdminAction("User Unsuspended", user.name, `Suspension lifted by admin.`, "user");
        }
    };
    const deactivateUser = (id: number) => {
        const user = users.find((u) => u.id === id);
        setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, status: "inactive" } : u)));
        if (user) {
            updatePlatformUserStatus(user.email, "inactive");
            logAdminAction("User Deactivated", user.name, `Account deactivated by admin.`, "user");
        }
    };
    return (<div>
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-gray-900">
          User Management
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">Manage platform users and their access</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {(["all", "active", "suspended", "inactive"] as StatusType[]).map((tab) => {
            const count = tab === "all"
                ? users.length
                : users.filter((u) => u.status === tab).length;
            return (<button key={tab} onClick={() => setActiveTab(tab)} className={cn("px-5 py-2 rounded-full text-sm font-semibold capitalize transition-all active:scale-[0.96]", activeTab === tab
                    ? "bg-magenta-500 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-200")}>
              {tab} ({count})
            </button>);
        })}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">User</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Email</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Plan</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Scans Used</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Joined</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Status</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => (<tr key={user.id} className="border-t border-gray-50 hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{user.name}</p>
                      <p className="text-xs text-gray-400">{user.phone}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{user.email}</td>
                  <td className="px-6 py-4">
                    <span className={cn("px-3 py-1 rounded-full text-xs font-semibold", user.plan === "Premium"
                ? "bg-magenta-50 text-magenta-700"
                : "bg-gray-100 text-gray-700")}>
                      {user.plan}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {user.scansUsed}/{user.scansLimit}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{user.joinedAt}</td>
                  <td className="px-6 py-4">
                    <span className={cn("px-3 py-1 rounded-full text-xs font-semibold capitalize", statusBadge[user.status])}>
                      {user.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex gap-2">
                      <button onClick={() => setReviewModal(user.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-xs font-medium hover:bg-blue-100 transition-colors">
                        <Eye className="w-3 h-3"/> View
                      </button>
                      {user.status === "active" && (<button onClick={() => suspendUser(user.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-50 text-amber-600 text-xs font-medium hover:bg-amber-100 transition-colors">
                          <Lock className="w-3 h-3"/> Suspend
                        </button>)}
                      {user.status === "suspended" && (<button onClick={() => unsuspendUser(user.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-50 text-green-600 text-xs font-medium hover:bg-green-100 transition-colors">
                          <Unlock className="w-3 h-3"/> Unsuspend
                        </button>)}
                      {(user.status === "active" || user.status === "suspended") && (<button onClick={() => deactivateUser(user.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-xs font-medium hover:bg-gray-200 transition-colors">
                          <UserX className="w-3 h-3"/> Deactivate
                        </button>)}

                    </div>
                  </td>
                </tr>))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (<div className="p-12 text-center text-gray-400 text-sm">
            No users found in this category
          </div>)}
      </div>

      {/* Review Modal */}
      <AnimatePresence>
        {reviewModal && modalUser && (<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setReviewModal(null)}>
            <motion.div initial={{ opacity: 0, y: 30, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 30 }} onClick={(e) => e.stopPropagation()} className="bg-white rounded-[24px] p-6 sm:p-8 max-w-lg w-full max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-display font-bold text-gray-900">
                  User Details
                </h2>
                <button onClick={() => setReviewModal(null)} className="p-2 rounded-full hover:bg-gray-100 transition-colors">
                  <X className="w-5 h-5 text-gray-400"/>
                </button>
              </div>

              <div className="space-y-4 mb-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Status</span>
                  <span className={cn("px-3 py-1 rounded-full text-xs font-semibold capitalize", statusBadge[modalUser.status])}>
                    {modalUser.status}
                  </span>
                </div>
                {[
                { label: "Name", value: modalUser.name },
                { label: "Email", value: modalUser.email },
                { label: "Phone", value: modalUser.phone },
                { label: "Plan", value: modalUser.plan },
                { label: "Joined", value: modalUser.joinedAt },
                { label: "Scans Used", value: `${modalUser.scansUsed}/${modalUser.scansLimit}` },
            ].map((item) => (<div key={item.label}>
                    <span className="text-xs text-gray-400">{item.label}</span>
                    <p className="text-sm font-medium text-gray-900">{item.value}</p>
                  </div>))}
              </div>

              <div className="flex gap-2">
                {modalUser.status === "active" && (<button onClick={() => {
                    suspendUser(modalUser.id);
                    setReviewModal(null);
                }} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-50 text-amber-600 text-sm font-semibold hover:bg-amber-100 transition-colors">
                    <Lock className="w-4 h-4"/> Suspend
                  </button>)}
                {modalUser.status === "suspended" && (<button onClick={() => {
                    unsuspendUser(modalUser.id);
                    setReviewModal(null);
                }} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-green-50 text-green-600 text-sm font-semibold hover:bg-green-100 transition-colors">
                    <Unlock className="w-4 h-4"/> Unsuspend
                  </button>)}
                {(modalUser.status === "active" || modalUser.status === "suspended") && (<button onClick={() => {
                    deactivateUser(modalUser.id);
                    setReviewModal(null);
                }} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gray-100 text-gray-600 text-sm font-semibold hover:bg-gray-200 transition-colors">
                    <UserX className="w-4 h-4"/> Deactivate
                  </button>)}

                <button onClick={() => setReviewModal(null)} className="flex-1 px-4 py-2.5 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200 transition-colors">
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>)}
      </AnimatePresence>


    </div>);
}
