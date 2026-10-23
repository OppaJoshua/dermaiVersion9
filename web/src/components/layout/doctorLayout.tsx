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
  Building2,
  ChevronDown,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import Logo from "@/assets/logo2.png";
import { useAuth } from "@/context/AuthContext";

import { supabase } from "@/lib/supabaseClient";
import { DoctorAvatar } from "@/components/common/DoctorAvatar";
import DoctorNotifications from "@/pages/doctor/DoctorNotifications";
import { useRoleNotifications } from "@/lib/notificationService";

import { fetchDoctorBranches, resolveDoctorBranch, type DoctorAffiliatedClinic } from "@/lib/doctorBranches";
export type { DoctorAffiliatedClinic } from "@/lib/doctorBranches";

export interface DoctorClinicContextType {
  activeClinicId: string; // Empty only while loading or when no clinics are assigned
  setActiveClinicId: (id: string) => void;
  affiliations: DoctorAffiliatedClinic[];
  activeAffiliation: DoctorAffiliatedClinic | null;
  doctorName: string;
}

export const DoctorClinicContext = createContext<DoctorClinicContextType>({
  activeClinicId: "",
  setActiveClinicId: () => {},
  affiliations: [],
  activeAffiliation: null,
  doctorName: "",
});

export function useDoctorClinicContext() {
  return useContext(DoctorClinicContext);
}

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

function ClinicBranchAvatar({ logoUrl, isSelected }: { logoUrl?: string | null; isSelected: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  return (
    <div className={cn("w-7 h-7 rounded-lg overflow-hidden flex items-center justify-center shrink-0", isSelected ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600")}>
      {logoUrl && logoUrl !== failedUrl ? (
        <img src={logoUrl} alt="" className="w-full h-full object-cover" onError={() => setFailedUrl(logoUrl)} />
      ) : (
        <Building2 className="w-3.5 h-3.5" />
      )}
    </div>
  );
}

export default function DoctorLayout({ children }: DoctorLayoutProps) {
  const { user } = useAuth();
  return <DoctorLayoutContent key={user?.id || "signed-out"}>{children}</DoctorLayoutContent>;
}

function DoctorLayoutContent({ children }: DoctorLayoutProps) {
  const { signOut, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [clinicDropdownOpen, setClinicDropdownOpen] = useState(false);
  const selectionKey = `dermai_doctor_active_clinic:${user?.id || ""}`;
  const [selectedClinicId, setSelectedClinicId] = useState(() => {
    try { return localStorage.getItem(selectionKey) || ""; } catch { return ""; }
  });
  const [affiliations, setAffiliations] = useState<DoctorAffiliatedClinic[]>([]);
  const activeClinicId = resolveDoctorBranch(selectedClinicId, affiliations);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [branchesError, setBranchesError] = useState(false);
  const requestRef = useRef(0);
  const clinicDropdownRef = useRef<HTMLDivElement>(null);
  const [docProfile, setDocProfile] = useState<{ id?: string; name: string; clinic: string; photo?: string }>({
    name: user?.user_metadata?.full_name || "", clinic: "", photo: "",
  });
  const bellRef = useRef<HTMLDivElement>(null);

  const { unreadCount } = useRoleNotifications("doctor", {
    userId: user?.id,
    userEmail: user?.email,
  });

  const handleClinicChange = (clinicId: string) => {
    if (!affiliations.some(branch => branch.clinic_id === clinicId)) return;
    setSelectedClinicId(clinicId);
    setClinicDropdownOpen(false);
  };

  useEffect(() => {
    if (activeClinicId) {
      try { localStorage.setItem(selectionKey, activeClinicId); } catch {}
    }
    window.dispatchEvent(new CustomEvent("dermai_doctor_active_clinic_changed", { detail: activeClinicId }));
  }, [activeClinicId, selectionKey]);

  const loadProfile = useCallback(async () => {
    const requestId = ++requestRef.current;
    setBranchesLoading(true);
    setBranchesError(false);
    try {
      const branches = await fetchDoctorBranches(supabase, user?.id);
      if (requestId !== requestRef.current) return;
      setAffiliations(branches);
      setSelectedClinicId(current => resolveDoctorBranch(current, branches) || "");
      const primary = branches[0];
      const newDoc = {
        id: primary?.doctor_id,
        name: primary?.doctor_name || user?.user_metadata?.full_name || "",
        clinic: branches.length > 1 ? `${branches.length} Affiliated Clinics` : primary?.clinic?.name || "No clinic assignments found",
        photo: branches.find(branch => branch.photo_url)?.photo_url || "",
      };
      setDocProfile(newDoc);
      try {
        localStorage.setItem("dermai_doctor_profile", JSON.stringify({
          id: newDoc.id, userId: user?.id, fullName: newDoc.name, clinic: newDoc.clinic, photo: newDoc.photo,
        }));
      } catch {}
    } catch {
      if (requestId !== requestRef.current) return;
      setAffiliations([]);
      setBranchesError(true);
    } finally {
      if (requestId === requestRef.current) setBranchesLoading(false);
    }
  }, [user?.id, user?.user_metadata?.full_name]);

  useEffect(() => {
    loadProfile();

    // Supabase Realtime channel for clinic_doctor updates
    const channel = supabase
      .channel(`doctor-profile-realtime-${user?.id || "anon"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "clinic_doctor", filter: `user_id=eq.${user?.id}` },
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
      ++requestRef.current;
      supabase.removeChannel(channel);
      window.removeEventListener("storage", loadProfile);
      window.removeEventListener("dermai_doctor_profile_updated", loadProfile);
      window.removeEventListener("dermai_doctor_avatar_updated", loadProfile);
      window.removeEventListener("focus", loadProfile);
    };
  }, [loadProfile, user?.id]);

  useEffect(() => {
    if (!bellOpen && !clinicDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
      if (clinicDropdownRef.current && !clinicDropdownRef.current.contains(e.target as Node)) {
        setClinicDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [bellOpen, clinicDropdownOpen]);

  const handleLogout = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  const currentPage =
    sidebarLinks.find((l) => l.path === location.pathname)?.label || "Dashboard";

  const selectedClinicName = branchesError ? "Could not load clinics"
    : !affiliations.length ? (branchesLoading ? "Loading clinics..." : "No clinic assignments found")
    : affiliations.find(branch => branch.clinic_id === activeClinicId)?.clinic?.name || "Active Clinic";

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
                  {affiliations.find((a) => a.clinic_id === activeClinicId)?.clinic?.name || "No clinic assignments found"}
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
            {/* Active Clinic Switcher Dropdown */}
            <div ref={clinicDropdownRef} className="relative z-40">
              <button
                type="button"
                onClick={() => setClinicDropdownOpen((prev) => !prev)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs transition-all shadow-2xs cursor-pointer"
                title="Switch Active Clinic"
                aria-expanded={clinicDropdownOpen}
              >
                <Building2 className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="truncate max-w-[130px] sm:max-w-[210px] text-slate-800">
                  {selectedClinicName}
                </span>
                <ChevronDown
                  className={cn(
                    "w-3.5 h-3.5 text-slate-400 transition-transform duration-200 shrink-0",
                    clinicDropdownOpen && "rotate-180 text-blue-600"
                  )}
                />
              </button>

              {clinicDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-2xl shadow-xl border border-slate-100 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-3.5 py-2 border-b border-slate-100 flex items-center justify-between">
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      Branch Switcher
                    </p>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-blue-50 text-blue-600">
                      {affiliations.length} {affiliations.length === 1 ? "branch" : "branches"}
                    </span>
                  </div>

                  <div className="py-1">
                    {branchesError ? (
                      <div role="alert" className="px-3.5 py-3 text-xs text-red-600">
                        Could not load clinic assignments. <button type="button" className="underline" onClick={() => void loadProfile()}>Retry</button>
                      </div>
                    ) : affiliations.length === 0 && (
                      <p role="status" className="px-3.5 py-3 text-xs text-slate-500">
                        {branchesLoading ? "Loading clinics..." : "No clinic assignments found"}
                      </p>
                    )}
                    {affiliations.map((aff) => {
                      const clinicName = aff.clinic?.name || "Clinic Branch";
                      const isSelected = activeClinicId === aff.clinic_id;
                      return (
                        <button
                          key={aff.clinic_id}
                          type="button"
                          onClick={() => handleClinicChange(aff.clinic_id)}
                          className={cn(
                            "w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-semibold transition-colors text-left cursor-pointer",
                            isSelected
                              ? "bg-blue-50 text-blue-700"
                              : "text-slate-700 hover:bg-slate-50"
                          )}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <ClinicBranchAvatar logoUrl={aff.clinic?.logo_url} isSelected={isSelected} />
                            <div className="min-w-0">
                              <p className="truncate font-bold text-xs">{clinicName}</p>
                              {aff.clinic?.address && (
                                <p className="text-[10px] text-slate-400 truncate font-normal">
                                  {aff.clinic.address}
                                </p>
                              )}
                            </div>
                          </div>
                          {isSelected && (
                            <Check className="w-4 h-4 text-blue-600 shrink-0 ml-2" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Notification Bell */}
            <div ref={bellRef} className="relative z-50">
              <button
                onClick={() => setBellOpen((prev) => !prev)}
                className="relative p-2.5 rounded-xl hover:bg-slate-50 text-slate-500 transition-colors border border-slate-100 shadow-2xs cursor-pointer"
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

        {/* Content body with Context Provider */}
        <DoctorClinicContext.Provider
          value={{
            activeClinicId,
            setActiveClinicId: handleClinicChange,
            affiliations,
            activeAffiliation:
              affiliations.find((a) => a.clinic_id === activeClinicId) || null,
            doctorName: docProfile.name,
          }}
        >
          <div className="p-5 sm:p-8 flex-1 min-w-0">{children}</div>
        </DoctorClinicContext.Provider>
      </main>
    </div>
  );
}
