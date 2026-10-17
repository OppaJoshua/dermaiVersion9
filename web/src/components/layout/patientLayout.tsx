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
  ArrowRight,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Logo from "@/assets/logo2.png";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import { getCachedPatientNotifications } from "../../lib/notificationService";

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

export interface NavLink {
  label: string;
  path: string;
}

export interface NavSection {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  links: NavLink[];
}

const navSections: NavSection[] = [
  {
    id: "skin-scan",
    title: "Skin Scan",
    icon: ScanLine,
    links: [{ label: "Scan Skin", path: "/dashboard/scan" }],
  },
  {
    id: "profile-management",
    title: "Profile Management",
    icon: UserCircle,
    links: [{ label: "Personal Information", path: "/dashboard/profile" }],
  },
  {
    id: "appointment-booking",
    title: "Appointment Booking",
    icon: CalendarDays,
    links: [{ label: "Search Clinic", path: "/dashboard/clinics" }],
  },
  {
    id: "monitor",
    title: "Monitor",
    icon: ActivitySquare,
    links: [
      { label: "Skin History", path: "/dashboard/history" },
      { label: "Appointment Status", path: "/dashboard/appointment-status" },
      { label: "Subscription Status", path: "/dashboard/subscription-status" },
    ],
  },
  {
    id: "subscription",
    title: "Subscription",
    icon: CreditCard,
    links: [{ label: "Upgrade Plan", path: "/dashboard/upgrade" }],
  },
  {
    id: "settings",
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
  { label: "Upgrade Plan", path: "/dashboard/upgrade" },
  { label: "Upgrade Plan", path: "/user/upgrade" },
  { label: "Book Appointment", path: "/dashboard/appointment" },
  { label: "Book Appointment", path: "/appointment" },
  ...navSections.flatMap((s) => s.links),
];

function isLinkActive(linkPath: string, currentPath: string): boolean {
  if (linkPath === "/dashboard") {
    return currentPath === "/dashboard";
  }
  if (linkPath === "/dashboard/scan") {
    return (
      currentPath === "/dashboard/scan" ||
      currentPath === "/dashboard/scan-skin" ||
      currentPath === "/scan"
    );
  }
  if (linkPath === "/dashboard/profile") {
    return (
      currentPath === "/dashboard/profile" ||
      currentPath === "/dashboard/settings/account"
    );
  }
  if (linkPath === "/dashboard/clinics") {
    return (
      currentPath === "/dashboard/clinics" ||
      currentPath === "/find-clinics"
    );
  }
  if (linkPath === "/dashboard/upgrade") {
    return currentPath === "/dashboard/upgrade" || currentPath === "/user/upgrade";
  }
  return currentPath === linkPath;
}

function isSectionActive(sectionId: string, currentPath: string): boolean {
  if (sectionId === "skin-scan") {
    return (
      currentPath === "/dashboard/scan" ||
      currentPath === "/dashboard/scan-skin" ||
      currentPath === "/scan"
    );
  }
  if (sectionId === "profile-management") {
    return (
      currentPath === "/dashboard/profile" ||
      currentPath === "/dashboard/settings/account"
    );
  }
  if (sectionId === "appointment-booking") {
    return (
      currentPath === "/dashboard/clinics" ||
      currentPath === "/find-clinics" ||
      currentPath === "/dashboard/appointment" ||
      currentPath === "/appointment"
    );
  }
  if (sectionId === "monitor") {
    return (
      currentPath === "/dashboard/history" ||
      currentPath === "/dashboard/appointment-status" ||
      currentPath === "/dashboard/subscription-status"
    );
  }
  if (sectionId === "subscription") {
    return (
      currentPath === "/dashboard/upgrade" ||
      currentPath === "/user/upgrade"
    );
  }
  if (sectionId === "settings") {
    return (
      currentPath.startsWith("/dashboard/settings") &&
      currentPath !== "/dashboard/settings/account"
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// COMPONENT
// ---------------------------------------------------------------------------

export default function UserLayout({
  children,
  profile: customProfile,
  onLogout,
}: UserLayoutProps) {
  const { user, session, loading, role, roleLoading, isProfileComplete, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<PatientNotif[]>([]);
  const notifRef = useRef<HTMLDivElement>(null);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const section of navSections) {
      if (isSectionActive(section.id, location.pathname)) {
        initial[section.id] = true;
      }
    }
    return initial;
  });

  const toggleSection = (sectionId: string) => {
    setOpenSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  // Automatically expand parent section of active route on route change
  useEffect(() => {
    for (const section of navSections) {
      if (isSectionActive(section.id, location.pathname)) {
        setOpenSections((prev) => {
          if (prev[section.id]) return prev;
          return { ...prev, [section.id]: true };
        });
      }
    }
  }, [location.pathname]);

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
      } else if (role === "patient" && !isProfileComplete && location.pathname !== "/dashboard/profile") {
        navigate("/dashboard/profile?incomplete=1", { replace: true });
      }
    }
  }, [user, session, loading, role, roleLoading, isProfileComplete, location.pathname, location.search, navigate]);

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
    let picture =
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

    // 1. Fetch user name and avatar from DB "user" table
    try {
      const { data: userData } = await supabase
        .from("user")
        .select("full_name, avatar_url")
        .eq("user_id", user.id)
        .maybeSingle();

      if (userData?.full_name) {
        name = userData.full_name;
      }
      if (userData?.avatar_url) {
        picture = userData.avatar_url;
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
      const { data: notifRows, error: notifErr } = await supabase
        .from("user_notification")
        .select("notif_id, type, title, body, is_read, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);

      let finalNotifs: PatientNotif[] = [];
      if (!notifErr && notifRows && notifRows.length > 0) {
        finalNotifs = notifRows.map((n) => ({
          id: n.notif_id,
          type: n.type || "system",
          title: n.title,
          body: n.body || "",
          isRead: Boolean(n.is_read),
          createdAt: n.created_at,
        }));
      } else {
        // Fallback to local cached notifications for this patient
        const cached = getCachedPatientNotifications(user.id);
        if (cached && cached.length > 0) {
          finalNotifs = cached.map((n: any) => ({
            id: n.id,
            type: n.type || "system",
            title: n.title,
            body: n.body || "",
            isRead: Boolean(n.isRead),
            createdAt: n.createdAt,
          }));
        }
      }

      setNotifications(finalNotifs);
      setUnreadCount(finalNotifs.filter((n) => !n.isRead).length);
    } catch {
      const cached = getCachedPatientNotifications(user.id);
      if (cached && cached.length > 0) {
        const mapped = cached.map((n: any) => ({
          id: n.id,
          type: n.type || "system",
          title: n.title,
          body: n.body || "",
          isRead: Boolean(n.isRead),
          createdAt: n.createdAt,
        }));
        setNotifications(mapped);
        setUnreadCount(mapped.filter((n: any) => !n.isRead).length);
      }
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

    // Update local cache
    if (user?.id) {
      try {
        const key = `dermai_patient_notifications_${user.id}`;
        const raw = localStorage.getItem(key);
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            const patched = list.map((item: any) =>
              item.id === notifId ? { ...item, isRead: true } : item
            );
            localStorage.setItem(key, JSON.stringify(patched));
          }
        }
      } catch { }
    }

    try {
      await supabase
        .from("user_notification")
        .update({ is_read: true })
        .eq("notif_id", notifId);
    } catch { }
  };

  const markAllRead = async () => {
    if (!user) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);

    // Update local cache
    try {
      const key = `dermai_patient_notifications_${user.id}`;
      const raw = localStorage.getItem(key);
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          const patched = list.map((item: any) => ({ ...item, isRead: true }));
          localStorage.setItem(key, JSON.stringify(patched));
        }
      }
    } catch { }

    try {
      await supabase
        .from("user_notification")
        .update({ is_read: true })
        .eq("user_id", user.id)
        .eq("is_read", false);
    } catch { }
  };

  useEffect(() => {
    loadUserData();

    const handleProfileUpdate = () => {
      loadUserData();
    };

    window.addEventListener("derm_profile_updated", handleProfileUpdate);
    window.addEventListener("dermai_notifications_updated", handleProfileUpdate);
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
      window.removeEventListener("dermai_notifications_updated", handleProfileUpdate);
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
    <div className="min-h-screen bg-[#f7f2f4] p-0 lg:p-3 flex flex-col lg:flex-row">
      {/* Backdrop Overlay */}
      <div
        className={cn(
          "fixed inset-0 bg-black/30 backdrop-blur-sm z-40 lg:hidden transition-all duration-300 ease-in-out",
          sidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar — floating box */}
      <aside
        className={cn(
          "flex flex-col w-64 bg-white border border-gray-200/80 rounded-3xl fixed z-50 overflow-hidden text-[14px]",
          "left-3 top-3 bottom-3",
          "transition-transform duration-300 ease-in-out",
          "shadow-xl lg:shadow-none",
          sidebarOpen ? "translate-x-0" : "-translate-x-[110%] lg:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <img src={Logo} alt="DERMAI logo" className="h-8 w-auto object-contain" />
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-magenta-50 text-magenta-600 font-semibold">
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

        <p className="px-6 pt-2 pb-1.5 text-[10px] font-semibold tracking-[0.14em] text-gray-400 uppercase">
          Menu
        </p>

        {/* Navigation Sections */}
        <div className="flex-1 overflow-y-auto no-scrollbar pb-3 px-3 space-y-1">
          {/* 1. Dashboard */}
          <Link
            to="/dashboard"
            onClick={() => setSidebarOpen(false)}
            className={cn(
              "relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-colors",
              location.pathname === "/dashboard"
                ? "bg-magenta-50 text-magenta-700"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            )}
          >
            {location.pathname === "/dashboard" && (
              <span className="absolute -left-3 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r-full bg-magenta-600" />
            )}
            <LayoutGrid className="w-[18px] h-[18px] shrink-0" />
            <span>Dashboard</span>
          </Link>

          {/* Collapsible Sections */}
          {navSections.map((section) => {
            const SectionIcon = section.icon;
            const isOpen = !!openSections[section.id];
            const isChildActive = isSectionActive(section.id, location.pathname);

            return (
              <div key={section.id} className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => toggleSection(section.id)}
                  className={cn(
                    "relative w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors select-none text-left cursor-pointer",
                    isChildActive
                      ? "text-magenta-700 bg-magenta-50/60"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                  )}
                >
                  {isChildActive && (
                    <span className="absolute -left-3 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r-full bg-magenta-600" />
                  )}
                  <div className="flex items-center gap-3 min-w-0">
                    <SectionIcon
                      className={cn(
                        "w-[18px] h-[18px] shrink-0 transition-colors",
                        isChildActive ? "text-magenta-600" : "text-gray-400"
                      )}
                    />
                    <span className="truncate">{section.title}</span>
                  </div>
                  <ChevronRight
                    className={cn(
                      "w-3.5 h-3.5 shrink-0 transition-transform duration-200 text-gray-300",
                      isOpen ? "rotate-90 text-gray-500" : "rotate-0"
                    )}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      key={`content-${section.id}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="pt-0.5 pb-1 space-y-0.5 ml-[22px] pl-3 border-l border-gray-100">
                        {section.links.map((link) => {
                          const isActive = isLinkActive(link.path, location.pathname);
                          return (
                            <Link
                              key={link.path}
                              to={link.path}
                              onClick={() => setSidebarOpen(false)}
                              className={cn(
                                "block px-3 py-2 rounded-xl text-[13px] transition-colors",
                                isActive
                                  ? "bg-magenta-50 text-magenta-700 font-semibold"
                                  : "text-gray-500 font-medium hover:bg-gray-50 hover:text-gray-900"
                              )}
                            >
                              {link.label}
                            </Link>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        {/* Logout */}
        <div className="px-3 py-3 shrink-0">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-gray-600 hover:bg-magenta-50 hover:text-magenta-700 transition-colors cursor-pointer"
          >
            <LogOut className="w-[18px] h-[18px]" />
            Log out
          </button>
        </div>
      </aside>

      {/* Main Content — boxed panel */}
      <main className="flex-1 lg:ml-[17.25rem] min-w-0 flex flex-col w-full">
        <div className="flex-1 flex flex-col bg-white lg:border border-gray-200/80 lg:rounded-3xl lg:min-h-[calc(100vh-1.5rem)] overflow-hidden">
        {/* Top Header — breadcrumb pill + bell + profile */}
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-40 bg-white/90 backdrop-blur">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden p-2 rounded-xl hover:bg-gray-50 text-gray-500"
              onClick={() => setSidebarOpen((prev) => !prev)}
              aria-label="Open sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white border border-gray-200/80 text-xs text-gray-500 font-medium">
              <span>Patient</span>
              <ChevronRight className="w-3 h-3 text-gray-300" />
              <span className="font-semibold text-gray-800">{currentPage}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
          <div ref={notifRef} className="relative">
            <button
              onClick={() => setNotifOpen((o) => !o)}
              className="relative w-10 h-10 flex items-center justify-center rounded-full border border-gray-200/80 bg-white hover:bg-magenta-50 transition-colors"
            >
              <Bell className={cn("w-[18px] h-[18px]", notifOpen ? "text-magenta-600" : "text-gray-500")} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-0.5 flex items-center justify-center bg-magenta-600 rounded-full text-white text-[10px] font-bold leading-none">
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
                              navigate("/dashboard/appointment-status");
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
                            <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1.5">
                              <span>{new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              <span>•</span>
                              <span>{new Date(n.createdAt).toLocaleDateString()}</span>
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
                    className="font-semibold text-magenta-600 hover:text-magenta-800 transition-colors inline-flex items-center gap-1"
                  >
                    <span>Skin scan history</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                  <Link
                    to="/dashboard/appointment-status"
                    onClick={() => setNotifOpen(false)}
                    className="font-semibold text-magenta-600 hover:text-magenta-800 transition-colors inline-flex items-center gap-1"
                  >
                    <span>Appointments</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* Profile pill */}
          <div className="hidden sm:flex items-center gap-2.5 pl-1.5 pr-4 py-1.5 rounded-full border border-gray-200/80 bg-white">
            <div className="w-9 h-9 rounded-full bg-magenta-500 overflow-hidden flex items-center justify-center text-white text-sm font-bold shrink-0">
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
            <div className="min-w-0 leading-tight">
              <p className="text-xs font-semibold text-gray-900 truncate max-w-40">{displayFullName}</p>
              <p className="text-[10px] text-gray-400 truncate max-w-40">
                {[dynamicProfile.membershipTier, dynamicProfile.location].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
          </div>
        </div>

        <div className="flex-1 overflow-x-hidden">{children}</div>
        </div>
      </main>
    </div>
  );
}


