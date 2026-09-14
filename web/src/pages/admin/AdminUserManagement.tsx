import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { X, Eye, Lock, Unlock, UserX, ShieldCheck } from "lucide-react";
import { logAdminAction } from "@/lib/auditLog";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";

type UserStatus = "active" | "suspended" | "inactive";
type UserRole = "admin" | "patient" | "clinic" | "doctor";

type User = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  joinedAt: string;
  status: UserStatus;
  plan: "Free" | "Premium" | "Admin Access" | "Clinic Partner" | "Medical Staff";
  scansUsed: number;
  scansLimit: number;
};

type StatusType = "all" | "active" | "suspended" | "inactive";

const statusBadge: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  suspended: "bg-amber-100 text-amber-700",
  inactive: "bg-gray-100 text-gray-700",
};

const roleBadge: Record<UserRole, { bg: string; text: string; label: string }> = {
  admin: { bg: "bg-purple-100 text-purple-800 border-purple-200", text: "Admin", label: "Admin" },
  clinic: { bg: "bg-blue-100 text-blue-800 border-blue-200", text: "Clinic", label: "Clinic Owner" },
  doctor: { bg: "bg-emerald-100 text-emerald-800 border-emerald-200", text: "Doctor", label: "Doctor" },
  patient: { bg: "bg-slate-100 text-slate-700 border-slate-200", text: "Patient", label: "Patient" },
};

function getInitialUsers(): User[] {
  try {
    const raw = localStorage.getItem("dermai_admin_users_cache");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { }
  return [];
}

export default function AdminUserManagement() {
  const { user: currentAuthUser } = useAuth();
  const [users, setUsers] = useState<User[]>(getInitialUsers);
  const [activeTab, setActiveTab] = useState<StatusType>("all");
  const [reviewModal, setReviewModal] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadUsers() {
      try {
        const { data, error } = await supabase
          .from("user")
          .select("user_id, full_name, email, role, phone, account_status, created_at")
          .order("full_name");

        if (cancelled || error || !data) return;

        const mappedUsers: User[] = data.map((u: any) => {
          const userRole: UserRole = (u.role && ["admin", "clinic", "doctor", "patient"].includes(u.role))
            ? u.role
            : "patient";

          const joinedDate = u.created_at
            ? new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
            : "Registered";

          let displayPlan: User["plan"] = "Free";
          if (userRole === "admin") displayPlan = "Admin Access";
          else if (userRole === "clinic") displayPlan = "Clinic Partner";
          else if (userRole === "doctor") displayPlan = "Medical Staff";

          return {
            id: u.user_id,
            name: u.full_name || u.email?.split("@")[0] || "User",
            email: u.email || "",
            phone: u.phone || "N/A",
            role: userRole,
            joinedAt: joinedDate,
            status: (u.account_status === "suspended" ? "suspended" : u.account_status === "inactive" ? "inactive" : "active") as UserStatus,
            plan: displayPlan,
            scansUsed: 0,
            scansLimit: userRole === "patient" ? 3 : 999,
          };
        });

        setUsers(mappedUsers);
        try {
          localStorage.setItem("dermai_admin_users_cache", JSON.stringify(mappedUsers));
        } catch { }
      } catch (err) {
        console.error("Failed to load users:", err);
      }
    }
    loadUsers();
    return () => { cancelled = true; };
  }, []);

  const filtered = users.filter((u) => activeTab === "all" || u.status === activeTab);
  const modalUser = users.find((u) => u.id === reviewModal);

  const setUserStatus = async (id: string, newStatus: UserStatus, label: string) => {
    // Guard against modifying admins or self
    const targetUser = users.find((u) => u.id === id);
    if (targetUser?.role === "admin" || targetUser?.id === currentAuthUser?.id) {
      alert("Admin accounts cannot be suspended or deactivated.");
      return;
    }

    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, status: newStatus } : u)));

    try {
      await supabase
        .from("user")
        .update({ account_status: newStatus })
        .eq("user_id", id);
    } catch (err: any) {
      console.warn("Failed to persist account status in Supabase:", err.message);
    }

    if (targetUser) logAdminAction(label, targetUser.name, `Account ${newStatus} by admin.`, "user");
  };

  const suspendUser = (id: string) => setUserStatus(id, "suspended", "User Suspended");
  const unsuspendUser = (id: string) => setUserStatus(id, "active", "User Unsuspended");
  const deactivateUser = (id: string) => setUserStatus(id, "inactive", "User Deactivated");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-gray-900">
          User Management
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">Manage platform users, roles, and access credentials</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {(["all", "active", "suspended", "inactive"] as StatusType[]).map((tab) => {
          const count =
            tab === "all"
              ? users.length
              : users.filter((u) => u.status === tab).length;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-5 py-2 rounded-full text-sm font-semibold capitalize transition-all active:scale-[0.96]",
                activeTab === tab
                  ? "bg-magenta-500 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-200"
              )}
            >
              {tab} ({count})
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-3.5 whitespace-nowrap">User</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-3.5 whitespace-nowrap">Role</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-3.5 whitespace-nowrap">Email</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-3.5 whitespace-nowrap">Plan</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-3.5 whitespace-nowrap">Scans</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-3.5 whitespace-nowrap">Joined</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-3.5 whitespace-nowrap">Status</th>
                <th className="text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-3.5 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((user) => {
                const isSelf = user.id === currentAuthUser?.id;
                const isAdmin = user.role === "admin";
                const roleInfo = roleBadge[user.role] || roleBadge.patient;

                return (
                  <tr key={user.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-semibold text-gray-900">{user.name}</p>
                          {isSelf && (
                            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-magenta-50 text-magenta-600 border border-magenta-200/80 shrink-0">
                              You
                            </span>
                          )}
                        </div>
                        {user.phone && user.phone !== "N/A" && (
                          <p className="text-[11px] text-gray-400 mt-0.5">{user.phone}</p>
                        )}
                      </div>
                    </td>

                    {/* Role Badge */}
                    <td className="px-3 py-3.5 whitespace-nowrap">
                      <span className={cn("inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap shrink-0", roleInfo.bg)}>
                        {isAdmin && <ShieldCheck className="w-3 h-3 text-purple-700" />}
                        {roleInfo.label}
                      </span>
                    </td>

                    <td className="px-3 py-3.5 text-xs sm:text-sm text-gray-600 whitespace-nowrap">{user.email}</td>

                    <td className="px-3 py-3.5 whitespace-nowrap">
                      <span
                        className={cn(
                          "inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0",
                          user.plan === "Admin Access"
                            ? "bg-purple-50 text-purple-700 border border-purple-200/60"
                            : user.plan === "Medical Staff"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200/60"
                            : user.plan === "Clinic Partner"
                            ? "bg-blue-50 text-blue-700 border border-blue-200/60"
                            : user.plan === "Premium"
                            ? "bg-magenta-50 text-magenta-700"
                            : "bg-gray-100 text-gray-700"
                        )}
                      >
                        {user.plan}
                      </span>
                    </td>

                    <td className="px-3 py-3.5 text-xs text-gray-600 whitespace-nowrap">
                      {isAdmin || user.role === "doctor" || user.role === "clinic" ? (
                        <span className="text-gray-400 italic text-xs">Unlimited</span>
                      ) : (
                        `${user.scansUsed}/${user.scansLimit}`
                      )}
                    </td>

                    <td className="px-3 py-3.5 text-xs text-gray-500 whitespace-nowrap">{user.joinedAt}</td>

                    <td className="px-3 py-3.5 whitespace-nowrap">
                      <span className={cn("inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize whitespace-nowrap shrink-0", statusBadge[user.status])}>
                        {user.status}
                      </span>
                    </td>

                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end">
                        <button
                          onClick={() => setReviewModal(user.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-magenta-50 text-magenta-700 hover:bg-magenta-100 border border-magenta-200/70 text-xs font-semibold transition-all active:scale-95 shrink-0"
                        >
                          <Eye className="w-3.5 h-3.5" /> View & Manage
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="p-12 text-center text-gray-400 text-sm">
            No users found in this category
          </div>
        )}
      </div>

      {/* Review Modal */}
      <AnimatePresence>
        {reviewModal && modalUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setReviewModal(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 30, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-[24px] p-6 sm:p-8 max-w-lg w-full max-h-[80vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-display font-bold text-gray-900">
                  User Details
                </h2>
                <button
                  onClick={() => setReviewModal(null)}
                  className="p-2 rounded-full hover:bg-gray-100 transition-colors"
                >
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>

              <div className="space-y-4 mb-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Account Status</span>
                  <span className={cn("px-3 py-1 rounded-full text-xs font-semibold capitalize", statusBadge[modalUser.status])}>
                    {modalUser.status}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Platform Role</span>
                  <span className={cn("inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border", roleBadge[modalUser.role]?.bg)}>
                    {modalUser.role === "admin" && <ShieldCheck className="w-3.5 h-3.5 text-purple-700" />}
                    {roleBadge[modalUser.role]?.label || modalUser.role}
                  </span>
                </div>

                {[
                  { label: "Name", value: modalUser.name },
                  { label: "Email", value: modalUser.email },
                  { label: "Phone", value: modalUser.phone },
                  { label: "Access / Plan", value: modalUser.plan },
                  { label: "Joined", value: modalUser.joinedAt },
                  {
                    label: "Scans",
                    value: modalUser.role === "patient" ? `${modalUser.scansUsed}/${modalUser.scansLimit}` : "Unlimited (Staff Access)",
                  },
                ].map((item) => (
                  <div key={item.label}>
                    <span className="text-xs text-gray-400">{item.label}</span>
                    <p className="text-sm font-medium text-gray-900">{item.value}</p>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                {modalUser.role !== "admin" && modalUser.id !== currentAuthUser?.id ? (
                  <>
                    {modalUser.status === "active" && (
                      <button
                        onClick={() => {
                          suspendUser(modalUser.id);
                          setReviewModal(null);
                        }}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-50 text-amber-600 text-sm font-semibold hover:bg-amber-100 transition-colors"
                      >
                        <Lock className="w-4 h-4" /> Suspend
                      </button>
                    )}
                    {modalUser.status === "suspended" && (
                      <button
                        onClick={() => {
                          unsuspendUser(modalUser.id);
                          setReviewModal(null);
                        }}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-green-50 text-green-600 text-sm font-semibold hover:bg-green-100 transition-colors"
                      >
                        <Unlock className="w-4 h-4" /> Unsuspend
                      </button>
                    )}
                    {(modalUser.status === "active" || modalUser.status === "suspended") && (
                      <button
                        onClick={() => {
                          deactivateUser(modalUser.id);
                          setReviewModal(null);
                        }}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gray-100 text-gray-600 text-sm font-semibold hover:bg-gray-200 transition-colors"
                      >
                        <UserX className="w-4 h-4" /> Deactivate
                      </button>
                    )}
                  </>
                ) : (
                  <div className="flex-1 text-center py-2 text-xs font-semibold text-purple-700 bg-purple-50 rounded-lg border border-purple-200/80 flex items-center justify-center gap-1.5">
                    <ShieldCheck className="w-4 h-4" /> Protected Administrator Account
                  </div>
                )}

                <button
                  onClick={() => setReviewModal(null)}
                  className="px-6 py-2.5 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200 transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
