import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Calendar, Users, Bell, LogOut, Menu, ChevronRight, CheckCircle2, Settings, Stethoscope, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef, type ReactNode } from "react";
import { useClinicVerification } from "@/hooks/useClinicVerification";
import Logo from "@/assets/logo2.png";
interface ClinicLayoutProps {
  children: ReactNode;
}
const sidebarLinks = [
  { label: "Dashboard", path: "/clinic", icon: LayoutDashboard, requiresVerified: false },
  { label: "Appointments", path: "/clinic/appointments", icon: Calendar, requiresVerified: true },
  { label: "Patients", path: "/clinic/patients", icon: Users, requiresVerified: true },
  { label: "Doctors", path: "/clinic/doctors", icon: Stethoscope, requiresVerified: true },
  { label: "Clinic Settings", path: "/clinic/settings", icon: Settings, requiresVerified: false },
];
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "react-router-dom";

import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import ClinicNotifications from "@/pages/clinic/ClinicNotifications";
import { useRoleNotifications } from "@/lib/notificationService";

export default function ClinicLayout({ children }: ClinicLayoutProps) {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const notifRef = useRef<HTMLDivElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const { clinicName, clinicLogo, clinicId, status: verificationStatus, loading } = useClinicVerification();

  const [localLogo, setLocalLogo] = useState<string>(() => {
    try {
      const s = localStorage.getItem("dermai_clinic_settings");
      if (s) {
        const p = JSON.parse(s);
        if (p?.logo) return p.logo;
      }
      const c = localStorage.getItem("dermai_clinic_profile_cache");
      if (c) {
        const p = JSON.parse(c);
        if (p?.clinicLogo) return p.clinicLogo;
      }
      const a = localStorage.getItem("dermai_clinic_applications");
      if (a) {
        const list = JSON.parse(a);
        if (Array.isArray(list) && list[0]?.logo) return list[0].logo;
      }
    } catch { }
    return "";
  });

  const [localName, setLocalName] = useState<string>(() => {
    try {
      const s = localStorage.getItem("dermai_clinic_settings");
      if (s) {
        const p = JSON.parse(s);
        if (p?.name) return p.name;
      }
      const c = localStorage.getItem("dermai_clinic_profile_cache");
      if (c) {
        const p = JSON.parse(c);
        if (p?.clinicName) return p.clinicName;
      }
    } catch { }
    return "";
  });

  // Sync with hook values when available
  useEffect(() => {
    if (clinicLogo) setLocalLogo(clinicLogo);
    if (clinicName) setLocalName(clinicName);
  }, [clinicLogo, clinicName]);

  // Live sync when clinic updates their profile photo or settings
  useEffect(() => {
    const handleProfileSync = () => {
      try {
        const s = localStorage.getItem("dermai_clinic_settings");
        if (s) {
          const p = JSON.parse(s);
          if (p?.logo) setLocalLogo(p.logo);
          if (p?.name) setLocalName(p.name);
        }
        const c = localStorage.getItem("dermai_clinic_profile_cache");
        if (c) {
          const p = JSON.parse(c);
          if (p?.clinicLogo) setLocalLogo(p.clinicLogo);
          if (p?.clinicName) setLocalName(p.clinicName);
        }
      } catch { }
    };

    window.addEventListener("clinicSettingsUpdated", handleProfileSync);
    window.addEventListener("dermai_clinic_profile_updated", handleProfileSync);
    window.addEventListener("dermai_clinic_updated", handleProfileSync);
    window.addEventListener("storage", handleProfileSync);

    return () => {
      window.removeEventListener("clinicSettingsUpdated", handleProfileSync);
      window.removeEventListener("dermai_clinic_profile_updated", handleProfileSync);
      window.removeEventListener("dermai_clinic_updated", handleProfileSync);
      window.removeEventListener("storage", handleProfileSync);
    };
  }, []);

  const displayLogo = localLogo || clinicLogo;
  const displayName = localName || clinicName || "Clinic Portal";

  const { unreadCount } = useRoleNotifications("clinic", {
    clinicId: clinicId || undefined,
    userId: user?.id,
    userEmail: user?.email,
  });

  const handleLogout = async () => {
    try {
      localStorage.removeItem("dermai_clinic_profile_cache");
    } catch { }
    await signOut();
    navigate("/", { replace: true });
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  const currentPage = sidebarLinks.find((l) => l.path === location.pathname)?.label || "Dashboard";
  return (<div className="min-h-screen bg-gray-50/80 flex">
    {sidebarOpen && (<div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />)}

    <aside className={cn("flex flex-col w-65 bg-white border-r border-gray-100 min-h-screen fixed left-0 top-0 z-50 transition-transform duration-300 text-[14px]", sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0")}>
      <div className="flex items-center gap-2.5 px-6 h-16 border-b border-gray-100 shrink-0">
        <img src={Logo} alt="DERMAI logo" className="h-8 w-auto object-contain" />
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold border border-emerald-200 ml-0.5">
          Clinic
        </span>
      </div>

      {/* Upper Sidebar: Clinic Logo, Name & Verified Badge */}
      <div className="px-3.5 py-3 border-b border-gray-100 shrink-0">
        <Link
          to="/clinic/settings"
          title="Clinic Profile & Settings"
          className="flex items-center gap-3 p-2 rounded-2xl hover:bg-gray-50/80 transition-all group cursor-pointer"
        >
          {displayLogo ? (
            <img
              src={displayLogo}
              alt={displayName || "Clinic"}
              className="w-10 h-10 rounded-full object-cover border-2 border-[#c0166a] shadow-2xs shrink-0"
              onError={(e) => {
                (e.currentTarget as HTMLElement).style.display = "none";
                const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                if (fallback) fallback.style.display = "flex";
              }}
            />
          ) : null}
          <div
            className="w-10 h-10 rounded-full bg-[#c0166a] items-center justify-center border-2 border-[#c0166a] shadow-2xs shrink-0"
            style={{ display: displayLogo ? "none" : "flex" }}
          >
            <span className="text-white text-xs font-bold">
              {(displayName || "C").charAt(0).toUpperCase()}
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold text-gray-900 truncate group-hover:text-[#c0166a] transition-colors leading-tight">
                {displayName || "Clinic Portal"}
              </p>
              {verificationStatus === "verified" && (
                <VerifiedBadge size={14} className="w-3.5 h-3.5 shrink-0" title="Verified Clinic" />
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5 truncate leading-tight">Dermatology Clinic</p>
          </div>
        </Link>
      </div>

      <p className="px-5 pt-3.5 pb-1 text-[10px] font-semibold tracking-[0.14em] text-gray-400 uppercase">
        Menu
      </p>

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto text-[13px]">
        {sidebarLinks.map((link) => {
          const Icon = link.icon;
          const isActive =
            link.path === "/clinic"
              ? location.pathname === "/clinic" || location.pathname === "/clinic/"
              : location.pathname.startsWith(link.path);
          const isLocked = !loading && link.requiresVerified && verificationStatus !== "verified";

          return (
            <Link
              key={link.path}
              to={isLocked ? "/clinic" : link.path}
              onClick={() => setSidebarOpen(false)}
              className={cn(
                "relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors select-none",
                isActive
                  ? "bg-magenta-50 text-magenta-700 font-semibold"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
                isLocked && "opacity-60 cursor-not-allowed"
              )}
            >
              {isActive && !isLocked && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-magenta-600" />
              )}
              <Icon
                className={cn(
                  "w-[18px] h-[18px] shrink-0 transition-colors",
                  isActive ? "text-magenta-700" : "text-gray-400"
                )}
              />
              <span className="flex-1 truncate">{link.label}</span>
              {isLocked && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold ml-auto">
                  Locked
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-gray-100 space-y-2">
        {verificationStatus === "verified" && (
          <div className="px-3 py-1.5 rounded-xl bg-emerald-50/70 border border-emerald-200/60 flex items-center gap-1.5 text-emerald-700 text-xs font-bold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Active Clinic</span>
          </div>
        )}
        {verificationStatus === "pending" && (
          <div className="px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-1.5 text-amber-700 text-xs font-bold">
            <Clock className="w-3.5 h-3.5" />
            <span>Pending Review</span>
          </div>
        )}

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-[14px] font-medium text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer"
        >
          <LogOut className="w-4.5 h-4.5" />
          Logout
        </button>
      </div>
    </aside>

    <main className="flex-1 lg:ml-65 min-h-screen">
      <div className="bg-white border-b border-gray-100 px-4 sm:px-6 h-16 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <button className="lg:hidden p-2 rounded-xl hover:bg-gray-50 text-gray-500" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-gray-400">Clinic</span>
            <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
            <span className="font-semibold text-gray-900">{currentPage}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">

          <div ref={notifRef} className="relative">
            <button onClick={() => setNotifOpen((o) => !o)} className="relative p-2.5 rounded-xl hover:bg-gray-50 transition-colors">
              <Bell className={cn("w-5 h-5", notifOpen ? "text-magenta-500" : "text-gray-500")} />
              {unreadCount > 0 && (<span className="absolute top-1 right-1 min-w-4 h-4 px-0.5 flex items-center justify-center bg-magenta-500 rounded-full text-white text-[10px] font-bold leading-none">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>)}
            </button>

            {notifOpen && (
              <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-2xl shadow-[0_8px_32px_rgba(160,25,90,0.15)] border border-gray-100 z-50 overflow-hidden">
                <ClinicNotifications isDropdown onClose={() => setNotifOpen(false)} />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 lg:p-8">{children}</div>
    </main>
  </div>);
}