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
  Crown,
  Stethoscope,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import Logo from "@/assets/logo2.png";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { withCacheBuster } from "@/lib/doctorAvatarService";
import { AdminNotifications } from "@/pages/admin/AdminNotificationsPage";
import { useRoleNotifications } from "@/lib/notificationService";

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

export default function AdminLayout({ children }: AdminLayoutProps) {
  const { session, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  const [photoError, setPhotoError] = useState(false);

  const [adminPhoto, setAdminPhoto] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem("dermai_admin_profile");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.profilePicture) return parsed.profilePicture;
      }
    } catch {}
    const meta = session?.user?.user_metadata || {};
    return meta.avatar_url || meta.picture || null;
  });

  const [adminNameState, setAdminNameState] = useState<string>(() => {
    try {
      const stored = localStorage.getItem("dermai_admin_profile");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.fullName) return parsed.fullName;
      }
    } catch {}
    const meta = session?.user?.user_metadata || {};
    return meta.full_name || meta.name || session?.user?.email?.split("@")[0] || "Admin";
  });

  const meta = session?.user?.user_metadata || {};
  const adminName = adminNameState || meta.full_name || meta.name || session?.user?.email?.split("@")[0] || "Admin";
  const adminEmail = session?.user?.email || "admin@dermai.ph";

  useEffect(() => {
    setPhotoError(false);
  }, [adminPhoto]);

  const loadAdminProfile = useCallback(async () => {
    let photo: string | null = null;
    let name: string | null = null;

    // 1. Authoritative: Database user table (primary source of truth)
    const userId = session?.user?.id;
    const userEmail = session?.user?.email || "dermaisupport@gmail.com";
    if (userId || userEmail) {
      try {
        let query = supabase.from("user").select("user_id, full_name, avatar_url");
        if (userId) {
          query = query.or(`user_id.eq.${userId},email.eq.${userEmail}`);
        } else {
          query = query.eq("email", userEmail);
        }
        const { data: dbUser } = await query.maybeSingle();
        if (dbUser) {
          if (dbUser.avatar_url) {
            photo = dbUser.avatar_url;
          }
          if (dbUser.full_name) {
            name = dbUser.full_name;
          }

          // If dbUser has no avatar_url but OAuth metadata does, backfill DB
          const currentMeta = session?.user?.user_metadata || {};
          const metaPhoto = currentMeta.avatar_url || currentMeta.picture;
          if (!dbUser.avatar_url && metaPhoto) {
            photo = metaPhoto;
            try {
              await supabase
                .from("user")
                .update({ avatar_url: metaPhoto })
                .eq("user_id", dbUser.user_id || userId);
            } catch {}
          }
        }
      } catch (err) {
        console.warn("[AdminLayout] Error loading admin profile from DB:", err);
      }
    }

    // 2. Auth metadata (Google OAuth) fallback
    if (!photo) {
      const currentMeta = session?.user?.user_metadata || {};
      photo = currentMeta.avatar_url || currentMeta.picture || null;
      if (!name) name = currentMeta.full_name || currentMeta.name || null;
    }

    // 3. LocalStorage fallback
    if (!photo || !name) {
      try {
        const stored = localStorage.getItem("dermai_admin_profile");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (!photo && parsed.profilePicture) photo = parsed.profilePicture;
          if (!name && parsed.fullName) name = parsed.fullName;
        }
      } catch {}
    }

    if (photo) {
      setAdminPhoto(withCacheBuster(photo));
      try {
        const raw = localStorage.getItem("dermai_admin_profile");
        const parsed = raw ? JSON.parse(raw) : {};
        localStorage.setItem(
          "dermai_admin_profile",
          JSON.stringify({ ...parsed, profilePicture: photo, fullName: name || parsed.fullName || adminName })
        );
      } catch {}
    }
    if (name) {
      setAdminNameState(name);
    }
  }, [session, adminName]);

  useEffect(() => {
    loadAdminProfile();

    const handleUpdate = () => loadAdminProfile();
    window.addEventListener("dermai_admin_profile_updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener("dermai_admin_profile_updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, [loadAdminProfile]);

  const handleLogout = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  const { unreadCount } = useRoleNotifications("admin", {
    userId: session?.user?.id,
  });

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

  const currentPage = sidebarLinks.find(
    (l) => l.path === location.pathname
  )?.label || "Dashboard";

  return (
    <div className="min-h-screen bg-gray-50/80 flex">
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[1090] lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — White */}
      <aside
        className={cn(
          "flex flex-col w-65 bg-white border-r border-gray-100 min-h-screen fixed left-0 top-0 z-[1100] transition-transform duration-300",
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
            {adminPhoto && !photoError ? (
              <img
                src={adminPhoto}
                alt={adminName}
                referrerPolicy="no-referrer"
                className="w-9 h-9 rounded-xl object-cover border border-gray-200 shrink-0 shadow-2xs"
                onError={() => {
                  console.warn("[AdminLayout] Avatar failed to load, falling back to initial badge:", adminPhoto);
                  setPhotoError(true);
                }}
              />
            ) : (
              <div
                className="w-9 h-9 rounded-xl bg-magenta-500 flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-2xs"
              >
                {adminName[0]?.toUpperCase() || "A"}
              </div>
            )}
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
        <div className="bg-white border-b border-gray-100 px-4 sm:px-6 h-16 flex items-center justify-between sticky top-0 z-[1000]">
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
            <div className="relative z-[1050]" ref={bellRef}>
              <button
                onClick={() => setBellOpen((prev) => !prev)}
                className="relative p-2.5 rounded-xl hover:bg-gray-50 transition-colors cursor-pointer"
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
                <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-2xl shadow-xl border border-gray-100 z-[1050] overflow-hidden">
                  <AdminNotifications isDropdown onClose={() => setBellOpen(false)} />
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