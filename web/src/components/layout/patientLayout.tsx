import { useLocation, Link, useNavigate } from "react-router-dom";
import {
  UserCircle,
  CalendarDays,
  CreditCard,
  ActivitySquare,
  LayoutGrid,
  Settings,
  ScanLine,
  LogOut,
  X,
  Bell,
  Menu,
  ChevronRight,
  Megaphone,
  Calendar,
  ScanSearch,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import Logo from "@/assets/logo2.png";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabaseClient";

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export interface UserProfileSummary {
  fullName: string;
  profilePictureUrl?: string;
  membershipTier?: string;
  location?: string;
}

export interface PatientNotif {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

interface UserLayoutProps {
  children: ReactNode;
  profile?: UserProfileSummary;
  onLogout?: () => void;
}

// ---------------------------------------------------------------------------
// STATIC NAV CONFIG
// ---------------------------------------------------------------------------

const sidebarSections = [
  {
    title: "Skin Scan",
    icon: ScanLine,
    links: [{ label: "Scan Skin", path: "/dashboard/scan" }],
  },
  {
    title: "Profile Management",
    icon: UserCircle,
    links: [{ label: "Personal Information", path: "/dashboard/profile" }],
  },
  {
    title: "Appointment Booking",
    icon: CalendarDays,
    links: [{ label: "Search Clinic", path: "/dashboard/clinics" }],
  },
  {
    title: "Monitor",
    icon: ActivitySquare,
    links: [
      { label: "Skin History", path: "/dashboard/history" },
      { label: "Appointment Status", path: "/dashboard/appointment-status" },
      { label: "Subscription Status", path: "/dashboard/subscription-status" },
    ],
  },
  {
    title: "Subscription",
    icon: CreditCard,
    links: [{ label: "Upgrade Plan", path: "/dashboard/upgrade" }],
  },
  {
    title: "Settings",
    icon: Settings,
    links: [
      { label: "Help", path: "/dashboard/settings/help" },
      { label: "Billing", path: "/dashboard/settings/billing" },
    ],
  },
];

const allLinks = [
  { label: "Dashboard", path: "/dashboard" },
  ...sidebarSections.flatMap((s) => s.links),
];

// ---------------------------------------------------------------------------
// COMPONENT
// ---------------------------------------------------------------------------

export default function UserLayout({
  children,
  profile: customProfile,
  onLogout,
}: UserLayoutProps) {
  const { user, session, loading, role, roleLoading, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<PatientNotif[]>([]);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && !roleLoading && (location.pathname.startsWith("/dashboard") || location.pathname === "/appointment")) {
      if (!user && !session) {
        navigate("/login", { replace: true, state: { from: location.pathname + location.search } });
        return;
      }
      if (role === "admin") {
        navigate("/admin", { replace: true });
      } else if (role === "clinic") {
        navigate("/clinic", { replace: true });
      } else if (role === "doctor") {
        navigate("/doctor", { replace: true });
      }
    }
  }, [user, session, loading, role, roleLoading, location.pathname, location.search, navigate]);

  const getLocalProfile = (userId?: string) => {
    if (!userId) return null;
    try {
      const localSaved = localStorage.getItem(`derm_profile_${userId}`);
      return localSaved ? JSON.parse(localSaved) : null;
    } catch {
      return null;
    }
  };

  const localData = getLocalProfile(user?.id);
  const userMeta = session?.user?.user_metadata || user?.user_metadata;
  const displayName =
    customProfile?.fullName ||
    localData?.fullName ||
    userMeta?.full_name ||
    userMeta?.name ||
    user?.email?.split("@")[0] ||
    "Patient User";

  const resolvedInitialPicture =
    customProfile?.profilePictureUrl ||
    localData?.profilePicture ||
    userMeta?.avatar_url ||
    userMeta?.picture ||
    undefined;

  const resolvedInitialLocation =
    customProfile?.location ||
    localData?.district ||
    localData?.address ||
    undefined;

  const profile = {
    fullName: displayName,
    membershipTier: customProfile?.membershipTier || "Free Plan",
    profilePictureUrl: resolvedInitialPicture,
    location: resolvedInitialLocation,
  };

  const [dynamicProfile, setDynamicProfile] = useState<UserProfileSummary>({
    fullName: profile.fullName || "",
    membershipTier: profile.membershipTier || "Free Plan",
    profilePictureUrl: profile.profilePictureUrl,
    location: profile.location,
  });
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [dynamicProfile.profilePictureUrl]);

  const loadUserData = useCallback(async () => {
    if (!user) return;

    const localProfile = getLocalProfile(user.id);
    const meta = user.user_metadata || {};
    let name =
      customProfile?.fullName ||
      localProfile?.fullName ||
      meta.full_name ||
      meta.name ||
      user.email?.split("@")[0] ||
      "Patient";
    const picture =
      customProfile?.profilePictureUrl ||
      localProfile?.profilePicture ||
      meta.avatar_url ||
      meta.picture ||
      undefined;
    const loc =
      customProfile?.location ||
      localProfile?.district ||
      localProfile?.address ||
      undefined;

    // 1. Fetch user name from DB "user" table
    try {
      const { data: userData } = await supabase
        .from("user")
        .select("full_name")
        .eq("user_id", user.id)
        .maybeSingle();

      if (userData?.full_name) {
        name = userData.full_name;
      }
    } catch {
      /* ignore */
    }

    // 2. Fetch membership tier
    let tier = customProfile?.membershipTier || "Free Plan";
    try {
      const { data: subData } = await supabase
        .from("user_plan_subscription")
        .select(`
          status,
          plan:plan_id (
            name,
            price
          )
        `)
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (subData) {
        const planObj: any = Array.isArray(subData.plan) ? subData.plan[0] : subData.plan;
        tier = planObj?.name || "Pro Plan";
      }
    } catch {
      /* ignore */
    }

    // 3. Fetch notifications & unread count
    try {
      const { data: notifRows } = await supabase
        .from("user_notification")
        .select("notif_id, type, title, body, is_read, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(15);

      if (notifRows) {
        const mapped = notifRows.map((n) => ({
          id: n.notif_id,
          type: n.type || "system",
          title: n.title,
          body: n.body || "",
          isRead: Boolean(n.is_read),
          createdAt: n.created_at,
        }));
        setNotifications(mapped);
        setUnreadCount(mapped.filter((n) => !n.isRead).length);
      }
    } catch {
      /* ignore */
    }

    setDynamicProfile({
      fullName: name,
      membershipTier: tier,
      profilePictureUrl: picture,
      location: loc,
    });
  }, [user, customProfile]);

  const markAsRead = async (notifId: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notifId ? { ...n, isRead: true } : n))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      await supabase
        .from("user_notification")
        .update({ is_read: true })
        .eq("notif_id", notifId);
    } catch {}
  };

  const markAllRead = async () => {
    if (!user) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    try {
      await supabase
        .from("user_notification")
        .update({ is_read: true })
        .eq("user_id", user.id)
        .eq("is_read", false);
    } catch {}
  };

  useEffect(() => {
    loadUserData();

    const handleProfileUpdate = () => {
      loadUserData();
    };

    window.addEventListener("derm_profile_updated", handleProfileUpdate);
    window.addEventListener("storage", handleProfileUpdate);

    // Realtime notifications for logged-in patient
    let channel: any = null;
    if (user?.id) {
      channel = supabase
        .channel(`patient-notifs-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "user_notification",
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            loadUserData();
          }
        )
        .subscribe();
    }

    return () => {
      window.removeEventListener("derm_profile_updated", handleProfileUpdate);
      window.removeEventListener("storage", handleProfileUpdate);
      if (channel) supabase.removeChannel(channel);
    };
  }, [loadUserData, user?.id]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const displayFullName = dynamicProfile.fullName || (user?.email?.split("@")[0] ?? "Patient");
  const initial = displayFullName.charAt(0)?.toUpperCase() ?? "P";
  const currentPage = allLinks.find((l) => l.path === location.pathname)?.label || "Dashboard";

  const handleLogout = async () => {
    if (onLogout) {
      onLogout();
    } else {
      await signOut();
      navigate("/");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50/80 flex flex-col lg:flex-row">
      {/* Backdrop Overlay */}
      <div
        className={cn(
          "fixed inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden transition-all duration-300 ease-in-out",
          sidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col w-70 bg-white border-r border-gray-100 h-screen fixed left-0 top-0 z-50 overflow-hidden",
          "transition-transform duration-300 ease-in-out",
          "shadow-[4px_0_32px_rgba(0,0,0,0.08)] lg:shadow-none",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-6 h-16 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <img src={Logo} alt="DERMAI logo" className="h-9 w-auto object-contain" />
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-magenta-50 text-magenta-600 font-semibold ml-0.5">
              Patient
            </span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Patient Account Info */}
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-full ring-2 ring-magenta-100 bg-magenta-500 overflow-hidden flex items-center justify-center text-white text-lg font-bold shrink-0">
              {dynamicProfile.profilePictureUrl && !imgError ? (
                <img
                  src={dynamicProfile.profilePictureUrl}
                  alt="Profile"
                  className="w-full h-full object-cover"
                  onError={() => setImgError(true)}
                />
              ) : (
                initial
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-gray-900 leading-tight truncate">{displayFullName}</p>
              {dynamicProfile.membershipTier && (
                <p className="text-xs text-gray-500 mt-0.5">{dynamicProfile.membershipTier}</p>
              )}
            </div>
          </div>
          {dynamicProfile.location && <p className="text-xs text-gray-400">{dynamicProfile.location}</p>}
        </div>

        {/* Navigation Sections */}
        <div className="flex-1 overflow-y-auto scrollbar-hide py-4 px-3 space-y-6">
          <div className="space-y-1">
            <Link
              to="/dashboard"
              onClick={() => setSidebarOpen(false)}
              className={cn(
                "flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors",
                location.pathname === "/dashboard"
                  ? "bg-magenta-50 text-magenta-600"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              )}
            >
              <LayoutGrid className="w-5 h-5" />
              Dashboard
            </Link>
          </div>

          {sidebarSections.map((section, idx) => {
            const SectionIcon = section.icon;
            return (
              <div key={idx} className="space-y-1">
                <div className="flex items-center gap-2 px-3 mb-2 text-gray-400">
                  <SectionIcon className="w-4 h-4" />
                  <p className="text-[11px] font-semibold uppercase tracking-wider">{section.title}</p>
                </div>
                <div className="space-y-0.5">
                  {section.links.map((link) => {
                    const isActive = location.pathname === link.path;
                    return (
                      <Link
                        key={link.path}
                        to={link.path}
                        onClick={() => setSidebarOpen(false)}
                        className={cn(
                          "block px-3 py-2 rounded-xl text-sm font-medium pl-9 transition-colors",
                          isActive
                            ? "bg-magenta-50 text-magenta-600"
                            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                        )}
                      >
                        {link.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Logout */}
        <div className="p-4 border-t border-gray-100 bg-gray-50/50">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 transition-colors bg-white border border-gray-200"
          >
            <LogOut className="w-4.5 h-4.5" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 lg:ml-70 min-h-screen flex flex-col relative w-full">
        {/* Top Header — clinic-style breadcrumb + bell */}
        <div className="bg-white border-b border-gray-100 px-4 sm:px-6 h-16 flex items-center justify-between sticky top-0 z-40">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden p-2 rounded-xl hover:bg-gray-50 text-gray-500"
              onClick={() => setSidebarOpen((prev) => !prev)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-gray-400">Patient</span>
              <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
              <span className="font-semibold text-gray-900">{currentPage}</span>
            </div>
          </div>

          <div ref={notifRef} className="relative">
            <button
              onClick={() => setNotifOpen((o) => !o)}
              className="relative p-2.5 rounded-xl hover:bg-gray-50 transition-colors"
            >
              <Bell className={cn("w-5 h-5", notifOpen ? "text-magenta-500" : "text-gray-500")} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-4 h-4 px-0.5 flex items-center justify-center bg-magenta-500 rounded-full text-white text-[10px] font-bold leading-none animate-pulse">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 top-full mt-2 w-80 sm:w-88 bg-white rounded-2xl shadow-[0_8px_32px_rgba(160,25,90,0.15)] border border-gray-100 z-50 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50">
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-magenta-500" />
                    <span className="font-semibold text-gray-900 text-sm">Notifications</span>
                  </div>
                  {unreadCount > 0 ? (
                    <button
                      onClick={markAllRead}
                      className="text-[11px] font-semibold text-magenta-600 hover:text-magenta-700"
                    >
                      Mark all read
                    </button>
                  ) : (
                    <span className="text-[11px] text-gray-400">All caught up</span>
                  )}
                </div>

                {notifications.length === 0 ? (
                  <div className="py-10 text-center">
                    <Bell className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">No new notifications</p>
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                    {notifications.map((n) => {
                      const isBroadcast = n.type === "broadcast";
                      const isAppointment = n.type.includes("appointment");
                      const isScan = n.type.includes("scan");

                      return (
                        <div
                          key={n.id}
                          onClick={() => {
                            if (!n.isRead) markAsRead(n.id);
                            setNotifOpen(false);
                            if (isAppointment) {
                              navigate("/patient/appointments");
                            } else if (isScan) {
                              navigate("/dashboard/history");
                            }
                          }}
                          className={cn(
                            "flex items-start gap-3 px-4 py-3 hover:bg-magenta-50/30 transition-colors cursor-pointer text-left",
                            !n.isRead && "bg-magenta-50/20"
                          )}
                        >
                          <div
                            className={cn(
                              "w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5",
                              isBroadcast
                                ? "bg-amber-100 text-amber-600"
                                : isAppointment
                                ? "bg-blue-100 text-blue-600"
                                : isScan
                                ? "bg-magenta-100 text-magenta-600"
                                : "bg-purple-100 text-purple-600"
                            )}
                          >
                            {isBroadcast ? (
                              <Megaphone className="w-4 h-4" />
                            ) : isAppointment ? (
                              <Calendar className="w-4 h-4" />
                            ) : isScan ? (
                              <ScanSearch className="w-4 h-4" />
                            ) : (
                              <Bell className="w-4 h-4" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-gray-900 truncate">
                              {n.title}
                            </p>
                            <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-2 mt-0.5">
                              {n.body}
                            </p>
                            <p className="text-[10px] text-gray-400 mt-1">
                              {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date(n.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                          {!n.isRead && (
                            <span className="w-2 h-2 rounded-full bg-magenta-500 shrink-0 mt-2" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between text-xs">
                  <Link
                    to="/dashboard/history"
                    onClick={() => setNotifOpen(false)}
                    className="font-semibold text-magenta-600 hover:text-magenta-800 transition-colors"
                  >
                    Skin scan history →
                  </Link>
                  <Link
                    to="/patient/appointments"
                    onClick={() => setNotifOpen(false)}
                    className="font-semibold text-magenta-600 hover:text-magenta-800 transition-colors"
                  >
                    Appointments →
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-x-hidden">{children}</div>
      </main>
    </div>
  );
}
