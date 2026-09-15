import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Building2,
  BarChart3,
  Bell,
  CreditCard,
  ScanSearch,
  LogOut,
  Menu,
  ChevronRight,
  Shield,
  Settings,
  HelpCircle,
  CheckCircle2,
  XCircle,
  Crown,
  Stethoscope,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import Logo from "@/assets/logo2.png";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";

interface AdminLayoutProps {
  children: ReactNode;
}

const sidebarLinks = [
  { label: "Dashboard", path: "/admin", icon: LayoutDashboard },
  { label: "User Management", path: "/admin/users", icon: Users },
  { label: "Clinic Management", path: "/admin/clinics", icon: Building2 },
  { label: "Subscription Management", path: "/admin/subscriptions", icon: CreditCard },
  { label: "Plan Management", path: "/admin/plans", icon: Crown },
  { label: "AI Skin Analysis", path: "/admin/ai-analyses", icon: ScanSearch },
  { label: "Doctor AI Review", path: "/admin/doctor-ai-review", icon: Stethoscope },
  { label: "Reports", path: "/admin/reports", icon: BarChart3 },
  { label: "Notifications", path: "/admin/notifications", icon: Bell },
  { label: "Audit Logs", path: "/admin/audit-logs", icon: Shield },
  { label: "Helpdesk", path: "/admin/helpdesk", icon: HelpCircle },
  { label: "System Settings", path: "/admin/settings", icon: Settings },
];

type RawNotif = {
  id: string;
  type: "clinic-pending" | "clinic-approved" | "clinic-rejected" | "new-subscription" | "new-ticket" | "broadcast";
  title?: string;
  clinicName?: string;
  message: string;
  timestamp: string;
};

export default function AdminLayout({ children }: AdminLayoutProps) {
  const { session, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [notifications, setNotifications] = useState<RawNotif[]>([]);
  const [lastReadAt, setLastReadAt] = useState<string>(() => {
    try {
      return localStorage.getItem("dermai_admin_last_read_notifs") || new Date(0).toISOString();
    } catch {
      return new Date(0).toISOString();
    }
  });
  const bellRef = useRef<HTMLDivElement>(null);

  const meta = session?.user?.user_metadata || {};
  const adminName = meta.full_name || meta.name || session?.user?.email?.split("@")[0] || "Admin";
  const adminEmail = session?.user?.email || "admin@dermai.ph";

  const handleLogout = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  const fetchAdminNotifications = useCallback(async () => {
    try {
      const list: RawNotif[] = [];

      // 1. Pending clinic registrations
      const { data: pendingClinics } = await supabase
        .from("clinic")
        .select("clinic_id, name, created_at")
        .eq("status", "pending")
        .order("name")
        .limit(10);

      if (pendingClinics) {
        pendingClinics.forEach((c: any) => {
          list.push({
            id: `clinic-${c.clinic_id}`,
            type: "clinic-pending",
            title: `New Clinic Application`,
            clinicName: c.name,
            message: `"${c.name}" submitted a registration application awaiting your review.`,
            timestamp: c.created_at || new Date().toISOString(),
          });
        });
      }

      // 2. Open Support Tickets
      const { data: tickets } = await supabase
        .from("user_support_ticket")
        .select("ticket_id, subject, message, created_at, status")
        .order("created_at", { ascending: false })
        .limit(10);

      if (tickets) {
        tickets.forEach((t: any) => {
          list.push({
            id: `ticket-${t.ticket_id}`,
            type: "new-ticket",
            title: `Support: ${t.subject || "Inquiry"}`,
            message: t.message || "A user submitted a support request.",
            timestamp: t.created_at,
          });
        });
      }

      // 3. User notifications
      const { data: notifData } = await supabase
        .from("user_notification")
        .select("notif_id, type, title, body, created_at")
        .order("created_at", { ascending: false })
        .limit(15);

      if (notifData) {
        notifData.forEach((n: any) => {
          let mappedType: RawNotif["type"] = "broadcast";
          if (n.type?.includes("clinic")) {
            mappedType = n.type.includes("reject") ? "clinic-rejected" : "clinic-approved";
          } else if (n.type?.includes("sub") || n.type?.includes("plan")) {
            mappedType = "new-subscription";
          } else if (n.type?.includes("ticket")) {
            mappedType = "new-ticket";
          }
          list.push({
            id: n.notif_id,
            type: mappedType,
            title: n.title,
            message: n.body || "",
            timestamp: n.created_at,
          });
        });
      }

      // Sort newest first
      list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setNotifications(list);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchAdminNotifications();

    // Realtime listeners for admin alerts
    const channel = supabase
      .channel("admin-layout-alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "clinic" }, () => fetchAdminNotifications())
      .on("postgres_changes", { event: "*", schema: "public", table: "user_support_ticket" }, () => fetchAdminNotifications())
      .on("postgres_changes", { event: "*", schema: "public", table: "user_notification" }, () => fetchAdminNotifications())
      .subscribe();

    const handleTicketUpdate = () => fetchAdminNotifications();
    window.addEventListener("dermai_tickets_updated", handleTicketUpdate);
    window.addEventListener("storage", handleTicketUpdate);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("dermai_tickets_updated", handleTicketUpdate);
      window.removeEventListener("storage", handleTicketUpdate);
    };
  }, [fetchAdminNotifications]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!bellOpen) return;
    const handler = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [bellOpen]);

  const unreadCount = notifications.filter(
    (n: RawNotif) => new Date(n.timestamp) > new Date(lastReadAt)
  ).length;

  const openBell = useCallback(() => {
    setBellOpen((prev) => !prev);
    // TODO: Mark notifications as read via Supabase
    const now = new Date().toISOString();
    setLastReadAt(now);
  }, []);

  const recentNotifs = notifications.slice(0, 8);

  const currentPage = sidebarLinks.find(
    (l) => l.path === location.pathname
  )?.label || "Dashboard";

  return (
    <div className="min-h-screen bg-gray-50/80 flex">
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — White */}
      <aside
        className={cn(
          "flex flex-col w-65 bg-white border-r border-gray-100 min-h-screen fixed left-0 top-0 z-50 transition-transform duration-300",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-6 h-16 border-b border-gray-100 shrink-0">
          <img
            src={Logo}
            alt="DERMAI logo"
            className="h-9 w-auto object-contain"
          />
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-magenta-50 text-magenta-600 font-semibold ml-0.5">
            Admin
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto mt-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 mb-2">
            Menu
          </p>
          {sidebarLinks.map((link) => {
            const Icon = link.icon;
            const isActive = location.pathname === link.path;
            return (
              <Link
                key={link.path}
                to={link.path}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap",
                  isActive
                    ? "bg-magenta-50 text-magenta-600"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <Icon className={cn("w-4.5 h-4.5 shrink-0", isActive ? "text-magenta-500" : "text-gray-400")} />
                <span className="flex-1 min-w-0 truncate">{link.label}</span>
                {isActive && (
                  <div className="w-1.5 h-1.5 rounded-full bg-magenta-500 shrink-0" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Admin Profile + Logout */}
        <div className="px-3 py-4 border-t border-gray-100 space-y-2">
          <div className="flex items-center gap-3 px-4 py-2">
            <div className="w-9 h-9 rounded-xl bg-magenta-500 flex items-center justify-center text-white text-sm font-bold">
              {adminName[0]?.toUpperCase() || "A"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{adminName}</p>
              <p className="text-[11px] text-gray-400 truncate">{adminEmail}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <LogOut className="w-4.5 h-4.5" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 lg:ml-65 min-h-screen">
        {/* Top Bar */}
        <div className="bg-white border-b border-gray-100 px-4 sm:px-6 h-16 flex items-center justify-between sticky top-0 z-40">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden p-2 rounded-xl hover:bg-gray-50 text-gray-500"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-gray-400">Admin</span>
              <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
              <span className="font-semibold text-gray-900">{currentPage}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative" ref={bellRef}>
              <button
                onClick={openBell}
                className="relative p-2.5 rounded-xl hover:bg-gray-50 transition-colors"
                title="Notifications"
              >
                <Bell className="w-5 h-5 text-gray-500" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 min-w-4.5 h-4.5 px-1 bg-magenta-500 rounded-full text-white text-[10px] font-bold flex items-center justify-center leading-none animate-pulse">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>

              {/* Dropdown panel */}
              {bellOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50">
                    <div className="flex items-center gap-2">
                      <Bell className="w-4 h-4 text-magenta-500" />
                      <p className="text-sm font-semibold text-gray-900">Notifications</p>
                    </div>
                    {unreadCount > 0 ? (
                      <button
                        onClick={() => {
                          const now = new Date().toISOString();
                          setLastReadAt(now);
                          try {
                            localStorage.setItem("dermai_admin_last_read_notifs", now);
                          } catch {}
                        }}
                        className="text-[11px] font-semibold text-magenta-600 hover:text-magenta-700"
                      >
                        Mark read
                      </button>
                    ) : (
                      <span className="text-[11px] text-gray-400 font-medium">All caught up</span>
                    )}
                  </div>

                  {recentNotifs.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <Bell className="w-7 h-7 text-gray-300 mx-auto mb-2" />
                      <p className="text-xs text-gray-400">No notifications yet.</p>
                    </div>
                  ) : (
                    <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                      {recentNotifs.map((n: RawNotif) => {
                        const isNew = new Date(n.timestamp) > new Date(lastReadAt);
                        return (
                          <div
                            key={n.id}
                            onClick={() => {
                              setBellOpen(false);
                              if (n.type === "clinic-pending") {
                                navigate("/admin/clinics");
                              } else if (n.type === "new-ticket") {
                                navigate("/admin/support");
                              } else {
                                navigate("/admin/notifications");
                              }
                            }}
                            className={cn(
                              "flex items-start gap-3 px-4 py-3 hover:bg-magenta-50/30 transition-colors cursor-pointer",
                              isNew && "bg-magenta-50/20"
                            )}
                          >
                            <div
                              className={cn(
                                "w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5",
                                n.type === "clinic-pending"
                                  ? "bg-amber-100 text-amber-600"
                                  : n.type === "clinic-approved"
                                  ? "bg-green-100 text-green-600"
                                  : n.type === "new-subscription"
                                  ? "bg-blue-100 text-blue-600"
                                  : n.type === "new-ticket"
                                  ? "bg-purple-100 text-purple-600"
                                  : "bg-red-100 text-red-600"
                              )}
                            >
                              {n.type === "new-subscription" ? (
                                <CreditCard className="w-4 h-4 text-blue-600" />
                              ) : n.type === "new-ticket" ? (
                                <HelpCircle className="w-4 h-4 text-purple-600" />
                              ) : n.type === "clinic-approved" || n.type === "clinic-pending" ? (
                                <CheckCircle2 className="w-4 h-4" />
                              ) : (
                                <XCircle className="w-4 h-4" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-gray-900 truncate">
                                {n.title || n.clinicName || "Notification"}
                              </p>
                              <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-2">{n.message}</p>
                              <p className="text-[10px] text-gray-400 mt-1">
                                {new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date(n.timestamp).toLocaleDateString()}
                              </p>
                            </div>
                            {isNew && (
                              <span className="w-2 h-2 rounded-full bg-magenta-500 shrink-0 mt-2" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="border-t border-gray-100 px-4 py-2.5 bg-gray-50/50">
                    <button
                      onClick={() => {
                        setBellOpen(false);
                        navigate("/admin/notifications");
                      }}
                      className="w-full text-center text-xs font-semibold text-magenta-600 hover:text-magenta-800 transition-colors"
                    >
                      View all notifications →
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
