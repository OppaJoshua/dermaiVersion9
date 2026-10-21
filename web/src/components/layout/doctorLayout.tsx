import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Calendar,
  Bell,
  LogOut,
  Menu,
  ChevronRight,
  Stethoscope,
  History,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import Logo from "@/assets/logo2.png";
import { useAuth } from "@/context/AuthContext";

import { supabase } from "@/lib/supabaseClient";
import { DoctorAvatar } from "@/components/common/DoctorAvatar";
import DoctorNotifications from "@/pages/doctor/DoctorNotifications";
import { useRoleNotifications } from "@/lib/notificationService";

interface DoctorLayoutProps {
  children: ReactNode;
}

const sidebarMainLinks = [
  { label: "Dashboard", path: "/doctor", icon: LayoutDashboard },
  { label: "Schedules", path: "/doctor/scheduled", icon: Calendar },
  { label: "Review Patients", path: "/doctor/appointments", icon: Stethoscope },
  { label: "Patient History", path: "/doctor/history", icon: History },
];

const sidebarSupportLinks = [
  { label: "Help & Settings", path: "/doctor/settings", icon: Settings },
];

const sidebarLinks = [...sidebarMainLinks, ...sidebarSupportLinks];

export default function DoctorLayout({ children }: DoctorLayoutProps) {
  const { signOut, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [docProfile, setDocProfile] = useState<{ id?: string; name: string; clinic: string; photo?: string }>(() => {
    try {
      const stored = localStorage.getItem("dermai_doctor_profile");
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          id: parsed.id || "",
          name: parsed.fullName || parsed.name || "",
          clinic: parsed.clinic || parsed.clinicName || "",
          photo: parsed.photo !== undefined ? parsed.photo : (parsed.photo_url || ""),
        };
      }
    } catch {}
    return {
      id: "",
      name: "",
      clinic: "",
      photo: "",
    };
  });
  const bellRef = useRef<HTMLDivElement>(null);

  const { unreadCount } = useRoleNotifications("doctor", {
    userId: user?.id,
    userEmail: user?.email,
  });

  const loadProfile = useCallback(async () => {
    try {
      if (user) {
        const userEmail = (user.email || "").trim().toLowerCase();
        const { data: cd } = await supabase
          .from("clinic_doctor")
          .select("doctor_id, doctor_name, clinic:clinic_id(name), photo_url")
          .or(`user_id.eq.${user.id},email.ilike.${userEmail}`)
          .limit(1)
          .single();

        if (cd) {
          const clinicObj: any = Array.isArray(cd.clinic) ? cd.clinic[0] : cd.clinic;
          const newDoc = {
            id: cd.doctor_id,
            name: cd.doctor_name || "",
            clinic: clinicObj?.name || "",
            photo: cd.photo_url || "",
          };
          setDocProfile(newDoc);
          try {
            localStorage.setItem(
              "dermai_doctor_profile",
              JSON.stringify({
                id: newDoc.id,
                fullName: newDoc.name,
                clinic: newDoc.clinic,
                photo: newDoc.photo,
              })
            );
          } catch {}
          return;
        }
      }

      const stored = localStorage.getItem("dermai_doctor_profile");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.fullName || parsed.id) {
          setDocProfile((prev) => ({
            id: parsed.id || prev.id,
            name: parsed.fullName || prev.name,
            clinic: prev.clinic,
            photo: parsed.photo !== undefined ? parsed.photo : prev.photo,
          }));
        }
      }
      const clinicDocs = localStorage.getItem("dermai_clinic_doctors");
      if (clinicDocs) {
        const parsedDocs = JSON.parse(clinicDocs);
        if (Array.isArray(parsedDocs)) {
          const userEmail = (user?.email || "").trim().toLowerCase();
          const matched = parsedDocs.find((d: any) => {
            const cachedEmail = String(d?.email || "").trim().toLowerCase();
            return Boolean(userEmail && cachedEmail && cachedEmail === userEmail);
          });

          if (matched) {
            setDocProfile((prev) => ({
              id: matched.doctor_id || matched.id || prev.id,
              name: matched.name || prev.name || "",
              clinic: matched.clinicName || prev.clinic || "",
              photo: matched.photo !== undefined ? matched.photo : prev.photo,
            }));
          }
        }
      }
    } catch {
      /* ignore */
    }
  }, [user]);

  useEffect(() => {
    loadProfile();

    // Supabase Realtime channel for clinic_doctor updates
    const channel = supabase
      .channel("doctor-profile-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "clinic_doctor" },
        () => {
          loadProfile();
        }
      )
      .subscribe();

    window.addEventListener("storage", loadProfile);
    window.addEventListener("dermai_doctor_profile_updated", loadProfile);
    window.addEventListener("dermai_doctor_avatar_updated", loadProfile);
    window.addEventListener("focus", loadProfile);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("storage", loadProfile);
      window.removeEventListener("dermai_doctor_profile_updated", loadProfile);
      window.removeEventListener("dermai_doctor_avatar_updated", loadProfile);
      window.removeEventListener("focus", loadProfile);
    };
  }, [loadProfile]);

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

  const handleLogout = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  const currentPage =
    sidebarLinks.find((l) => l.path === location.pathname)?.label || "Dashboard";

  return (
    <div className="min-h-screen bg-[#F1F3F7] text-slate-800 flex font-sans">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/30 backdrop-blur-xs z-25 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          "flex flex-col w-[260px] bg-white border-r border-slate-200/80 min-h-screen fixed left-0 top-0 z-30 transition-transform duration-300 shadow-[1px_0_10px_rgba(0,0,0,0.02)]",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Brand / Logo */}
        <div className="flex items-center justify-between px-6 h-18 border-b border-slate-200/70 shrink-0">
          <div className="flex items-center gap-2.5">
            <img src={Logo} alt="DERMAI logo" className="h-9 w-auto object-contain" />
            <span className="text-[12px] px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-600 font-bold border border-blue-100/80">
              Doctor
            </span>
          </div>
        </div>

        {/* Navigation Sections */}
        <nav className="flex-1 px-3 space-y-4 overflow-y-auto pt-2 pb-4">
          <div>
            <p className="text-[14px] font-bold text-slate-400 uppercase tracking-wider px-3 mb-2">
              MAIN
            </p>
            <div className="space-y-1">
              {sidebarMainLinks.map((link) => {
                const Icon = link.icon;
                const isActive = location.pathname === link.path;
                return (
                  <Link
                    key={link.path}
                    to={link.path}
                    onClick={() => setSidebarOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-base font-semibold transition-all",
                      isActive
                        ? "bg-blue-50 text-blue-600 shadow-2xs"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    )}
                  >
                    <Icon className={cn("w-4 h-4", isActive ? "text-blue-600" : "text-slate-400")} />
                    <span className="flex-1">{link.label}</span>
                    {isActive && <div className="w-1.5 h-1.5 rounded-full bg-blue-600" />}
                  </Link>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-[14px] font-bold text-slate-400 uppercase tracking-wider px-3 mb-2">
              SUPPORT
            </p>
            <div className="space-y-1">
              {sidebarSupportLinks.map((link) => {
                const Icon = link.icon;
                const isActive = location.pathname === link.path;
                return (
                  <Link
                    key={link.path}
                    to={link.path}
                    onClick={() => setSidebarOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-base font-semibold transition-all",
                      isActive
                        ? "bg-blue-50 text-blue-600 shadow-2xs"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    )}
                  >
                    <Icon className={cn("w-4 h-4", isActive ? "text-blue-600" : "text-slate-400")} />
                    <span className="flex-1">{link.label}</span>
                    {isActive && <div className="w-1.5 h-1.5 rounded-full bg-blue-600" />}
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>

        {/* Doctor Profile card at bottom */}
        <div className="px-3 py-4 border-t border-slate-100 space-y-2 bg-white">
          <div className="px-3.5 py-3 rounded-2xl bg-slate-50 border border-slate-100/90">
            <div className="flex items-center gap-2.5">
              <DoctorAvatar
                doctorId={docProfile.id}
                userId={user?.id}
                doctor={{ photo_url: docProfile.photo, name: docProfile.name }}
                name={docProfile.name}
                className="w-9 h-9 rounded-full border border-slate-200 shrink-0 shadow-2xs"
              />
              <div className="min-w-0">
                <p className="text-base font-bold text-slate-900 truncate">
                  {docProfile.name || "Doctor"}
                </p>
                <p className="text-[12px] text-blue-600 truncate font-semibold">
                  {docProfile.clinic || "Clinic Staff"}
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 rounded-xl text-base font-semibold text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      <main className="flex-1 lg:ml-[260px] min-h-screen flex flex-col min-w-0">
        {/* Top Header */}
        <div className="bg-white border-b border-slate-200/80 px-5 sm:px-8 h-18 flex items-center justify-between sticky top-0 z-20 shadow-xs">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden p-2 rounded-xl hover:bg-slate-50 text-slate-500"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-1.5 text-base font-medium">
              <span className="text-slate-400">Doctor Portal</span>
              <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
              <span className="font-bold text-slate-900">{currentPage}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Notification Bell */}
            <div ref={bellRef} className="relative z-50">
              <button
                onClick={() => setBellOpen((prev) => !prev)}
                className="relative p-2.5 rounded-xl hover:bg-slate-50 text-slate-500 transition-colors border border-slate-100 shadow-2xs"
              >
                <Bell className={cn("w-4 h-4", bellOpen ? "text-blue-600" : "text-slate-500")} />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 flex items-center justify-center bg-blue-600 rounded-full text-white text-[9px] font-bold leading-none shadow-2xs">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>

              {bellOpen && (
                <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-2xl shadow-xl border border-slate-100 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                  <DoctorNotifications isDropdown onClose={() => setBellOpen(false)} />
                </div>
              )}
            </div>

            {/* Doctor Avatar */}
            <div className="flex items-center gap-2 pl-1">
              <DoctorAvatar
                doctorId={docProfile.id}
                userId={user?.id}
                doctor={{ photo_url: docProfile.photo, name: docProfile.name }}
                name={docProfile.name}
                className="w-9 h-9 rounded-full border border-slate-200 ring-2 ring-blue-50"
              />
            </div>
          </div>
        </div>

        {/* Content body */}
        <div className="p-5 sm:p-8 flex-1 min-w-0">{children}</div>
      </main>
    </div>
  );
}
