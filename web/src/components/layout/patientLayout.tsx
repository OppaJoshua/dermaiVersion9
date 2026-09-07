import { useLocation, Link } from "react-router-dom";
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
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useState, useEffect, useRef } from "react";
import Logo from "../../assets/logo2.png";
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

interface UserLayoutProps {
  children: React.ReactNode;
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
      { label: "Account", path: "/dashboard/settings/account" },
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
  profile,
  onLogout,
}: UserLayoutProps) {
  const { user } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const [dynamicProfile, setDynamicProfile] = useState<UserProfileSummary>({
    fullName: profile?.fullName || "",
    membershipTier: profile?.membershipTier || "Free Plan",
    profilePictureUrl: profile?.profilePictureUrl,
    location: profile?.location,
  });
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadUserData() {
      if (!user) return;

      // 1. Fetch user name from DB "user" table
      let name = profile?.fullName || user.user_metadata?.full_name || user.email?.split("@")[0] || "Patient";
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
      let tier = profile?.membershipTier || "Free Plan";
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

      // 3. Fetch unread notification count
      try {
        const { count } = await supabase
          .from("user_notification")
          .select("*", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("is_read", false);

        if (!cancelled && count !== null) {
          setUnreadCount(count);
        }
      } catch {
        /* ignore */
      }

      if (!cancelled) {
        setDynamicProfile({
          fullName: name,
          membershipTier: tier,
        });
      }
    }

    loadUserData();
    return () => {
      cancelled = true;
    };
  }, [user, profile]);

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
              {dynamicProfile.profilePictureUrl ? (
                <img src={dynamicProfile.profilePictureUrl} alt="Profile" className="w-full h-full object-cover" />
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
          {onLogout ? (
            <button
              onClick={onLogout}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 transition-colors bg-white border border-gray-200"
            >
              <LogOut className="w-4.5 h-4.5" />
              Logout
            </button>
          ) : (
            <Link
              to="/"
              className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 transition-colors bg-white border border-gray-200"
            >
              <LogOut className="w-4.5 h-4.5" />
              Logout
            </Link>
          )}
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
                <span className="absolute top-1 right-1 min-w-4 h-4 px-0.5 flex items-center justify-center bg-magenta-500 rounded-full text-white text-[10px] font-bold leading-none">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-[0_8px_32px_rgba(160,25,90,0.15)] border border-gray-100 z-50 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
                  <Bell className="w-4 h-4 text-magenta-500" />
                  <span className="font-semibold text-gray-900 text-sm">Notifications</span>
                </div>
                <div className="py-10 text-center">
                  <Bell className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No new notifications</p>
                </div>
                <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/50">
                  <Link
                    to="/dashboard/history"
                    onClick={() => setNotifOpen(false)}
                    className="block text-center text-sm font-semibold text-magenta-500 hover:text-magenta-700 transition-colors"
                  >
                    View skin history →
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
