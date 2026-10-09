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
  User,
  Settings,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import Logo from "@/assets/logo2.png";
import { useAuth } from "@/context/AuthContext";

import { supabase } from "@/lib/supabaseClient";

interface DoctorLayoutProps {
  children: ReactNode;
}

type DoctorNotif = {
  id: string;
  title: string;
  message: string;
  time: string;
  type: "assigned" | "system";
};

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
  const [docProfile, setDocProfile] = useState<{ name: string; clinic: string; photo?: string }>({
    name: "",
    clinic: "",
  });
  const [notifications, setNotifications] = useState<DoctorNotif[]>([]);
  const [lastReadAt, setLastReadAt] = useState<string>(() => {
    try {
      return localStorage.getItem("dermai_doctor_last_read_notifs") || new Date(0).toISOString();
    } catch {
      return new Date(0).toISOString();
    }
  });
  const bellRef = useRef<HTMLDivElement>(null);

  const loadDoctorNotifs = async () => {
    if (!user) return;
    try {
      const list: DoctorNotif[] = [];
      const userEmail = (user.email || "").trim().toLowerCase();
      const docIds: string[] = [user.id];

      // 1. Check clinic_doctor record
      let foundClinicId: string | null = null;
      const { data: docData } = await supabase
        .from("clinic_doctor")
        .select("doctor_id, doctor_name, clinic_id, email, user_id");

      (docData || []).forEach((d) => {
        const cdEmail = (d.email || "").trim().toLowerCase();
        if (
          d.user_id === user.id ||
          (cdEmail && userEmail && cdEmail === userEmail)
        ) {
          if (d.doctor_id) docIds.push(d.doctor_id);
          if (d.clinic_id) foundClinicId = d.clinic_id;
        }
      });

      // Also check localStorage
      try {
        const storedClinicDocs = localStorage.getItem("dermai_clinic_doctors");
        if (storedClinicDocs) {
          const parsed = JSON.parse(storedClinicDocs);
          if (Array.isArray(parsed)) {
            const matched = parsed.find(
              (d: any) =>
                (d.email && d.email.toLowerCase() === userEmail) ||
                (d.id && docIds.includes(d.id))
            );
            if (matched?.id) docIds.push(matched.id);
            if (matched?.clinicId || matched?.clinic_id) foundClinicId = matched.clinicId || matched.clinic_id;
          }
        }
      } catch { }

      const uniqueDocIds = Array.from(new Set(docIds.filter(Boolean)));
      const isUuid = (s?: string) => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
      const validDocIds = uniqueDocIds.filter(isUuid);

      try {
        let appQuery = supabase
          .from("patient_appointment")
          .select("appointment_id, patient_name, clinic_id, assigned_doctor_id, date, time, status, created_at")
          .order("created_at", { ascending: false })
          .limit(10);

        if (validDocIds.length > 0 && foundClinicId && isUuid(foundClinicId)) {
          appQuery = appQuery.or(`assigned_doctor_id.in.(${validDocIds.join(",")}),clinic_id.eq.${foundClinicId}`);
        } else if (validDocIds.length > 0) {
          appQuery = appQuery.in("assigned_doctor_id", validDocIds);
        } else if (foundClinicId && isUuid(foundClinicId)) {
          appQuery = appQuery.eq("clinic_id", foundClinicId);
        }

        const { data: apps } = await appQuery;

        if (apps && apps.length > 0) {
          apps.forEach((a: any) => {
            if (!a.created_at) return;
            const isAssigned = validDocIds.includes(String(a.assigned_doctor_id));
            list.push({
              id: `doc-app-${a.appointment_id}`,
              title: isAssigned ? "Assigned Consultation" : "Clinic Consultation",
              message: isAssigned
                ? `${a.patient_name || "Not provided"} was assigned to you for clinical review.`
                : `${a.patient_name || "Not provided"} booked a consultation at your clinic.`,
              time: a.created_at,
              type: "assigned",
            });
          });
        }
      } catch { }

      // Also check real local storage appointments
      try {
        const stored = localStorage.getItem("dermai_clinic_appointments");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            parsed
              .filter((a: any) => a.id && !String(a.id).startsWith("doc-seed-"))
              .slice(0, 5)
              .forEach((a: any) => {
                if (!a.createdAt) return;
                const alreadyExists = list.some((item) => item.id === `doc-app-${a.id}`);
                if (!alreadyExists) {
                  list.push({
                    id: `doc-app-${a.id}`,
                    title: a.doctorStatus === "approved" ? "Confirmed Consultation" : "New Assigned Patient",
                    message: `${a.patientName || "Not provided"} is scheduled for ${a.conditionName || "Not provided"}.`,
                    time: a.createdAt,
                    type: "assigned",
                  });
                }
              });
          }
        }
      } catch { }

      // 2. User notifications
      const { data: notifs } = await supabase
        .from("user_notification")
        .select("notif_id, title, body, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10);

      if (notifs) {
        notifs.forEach((n: any) => {
          list.push({
            id: n.notif_id,
            title: n.title,
            message: n.body || "",
            time: n.created_at,
            type: "system",
          });
        });
      }

      list.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      setNotifications(list);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    loadDoctorNotifs();

    const channel = supabase
      .channel(`doctor-notifs-${user?.id || "anon"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "patient_appointment" },
        () => {
          loadDoctorNotifs();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_notification" },
        () => {
          loadDoctorNotifs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const unreadCount = notifications.filter(
    (n) => new Date(n.time) > new Date(lastReadAt)
  ).length;

  const markAllRead = () => {
    const now = new Date().toISOString();
    setLastReadAt(now);
    try {
      localStorage.setItem("dermai_doctor_last_read_notifs", now);
    } catch { }
  };

  const loadProfile = useCallback(async () => {
    try {
      if (user) {
        const userEmail = (user.email || "").trim().toLowerCase();
        const { data: cd } = await supabase
          .from("clinic_doctor")
          .select("doctor_name, clinic:clinic_id(name), photo_url")
          .or(`user_id.eq.${user.id},email.ilike.${userEmail}`)
          .limit(1)
          .single();

        if (cd) {
          const clinicObj: any = Array.isArray(cd.clinic) ? cd.clinic[0] : cd.clinic;
          setDocProfile((prev) => ({
            name: cd.doctor_name || prev.name || "",
            clinic: clinicObj?.name || prev.clinic || "",
            photo: prev.photo || cd.photo_url,
          }));
          return;
        }
      }

      const stored = localStorage.getItem("dermai_doctor_profile");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.fullName) {
          setDocProfile((prev) => ({
            ...prev,
            name: parsed.fullName,
            photo: parsed.photo || prev.photo,
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
              name: matched.name || prev.name || "",
              clinic: matched.clinicName || prev.clinic || "",
              photo: prev.photo || matched.photo,
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
    window.addEventListener("focus", loadProfile);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("storage", loadProfile);
      window.removeEventListener("dermai_doctor_profile_updated", loadProfile);
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
          className="fixed inset-0 bg-slate-900/30 backdrop-blur-xs z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          "flex flex-col w-[260px] bg-white border-r border-slate-200/80 min-h-screen fixed left-0 top-0 z-50 transition-transform duration-300 shadow-[1px_0_10px_rgba(0,0,0,0.02)]",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Brand / Logo */}
        <div className="flex items-center justify-between px-6 h-18 border-b border-slate-200/70 shrink-0">
          <div className="flex items-center gap-2.5">
            <img src={Logo} alt="DERMAI logo" className="h-9 w-auto object-contain" />
            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-600 font-bold border border-blue-100/80">
              Doctor
            </span>
          </div>
        </div>

        {/* Sidebar Search Bar matching Mediczen */}
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-50/80 border border-slate-200/70 rounded-xl text-xs text-slate-400">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search..."
              className="bg-transparent text-xs text-slate-700 placeholder:text-slate-400 outline-none w-full"
            />
          </div>
        </div>

        {/* Navigation Sections */}
        <nav className="flex-1 px-3 space-y-4 overflow-y-auto pt-2 pb-4">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 mb-2">
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
                      "flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all",
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
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 mb-2">
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
                      "flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all",
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
              {docProfile.photo ? (
                <img
                  src={docProfile.photo}
                  alt={docProfile.name || ""}
                  className="w-9 h-9 rounded-full object-cover border border-slate-200 shrink-0 shadow-2xs"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 font-bold text-xs">
                  <User className="w-4 h-4 text-blue-600" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900 truncate">
                  {docProfile.name || "Doctor"}
                </p>
                <p className="text-[11px] text-blue-600 truncate font-semibold">
                  {docProfile.clinic || "Clinic Staff"}
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      <main className="flex-1 lg:ml-[260px] min-h-screen flex flex-col">
        {/* Top Header */}
        <div className="bg-white border-b border-slate-200/80 px-5 sm:px-8 h-18 flex items-center justify-between sticky top-0 z-40 shadow-xs">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden p-2 rounded-xl hover:bg-slate-50 text-slate-500"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <span className="text-slate-400">Doctor Portal</span>
              <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
              <span className="font-bold text-slate-900">{currentPage}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Notification Bell */}
            <div ref={bellRef} className="relative">
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
                <div className="absolute right-0 top-full mt-2 w-84 bg-white rounded-2xl shadow-xl border border-slate-100 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                    <div className="flex items-center gap-2">
                      <Bell className="w-4 h-4 text-blue-600" />
                      <span className="font-bold text-slate-900 text-xs">Notifications</span>
                    </div>
                    {unreadCount > 0 && (
                      <button
                        onClick={markAllRead}
                        className="text-[11px] font-bold text-blue-600 hover:text-blue-700 cursor-pointer"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>

                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-50 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                    {notifications.length === 0 ? (
                      <div className="py-10 text-center">
                        <Bell className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                        <p className="text-xs text-slate-400">No notifications yet</p>
                      </div>
                    ) : (
                      notifications.map((n) => {
                        const isNew = new Date(n.time) > new Date(lastReadAt);
                        return (
                          <div
                            key={n.id}
                            onClick={() => {
                              setBellOpen(false);
                              markAllRead();
                              if (n.type === "assigned") {
                                navigate("/doctor/scheduled");
                              } else {
                                navigate("/doctor/appointments");
                              }
                            }}
                            className={cn(
                              "flex items-start justify-between gap-3 px-4 py-3 hover:bg-blue-50/40 transition-colors cursor-pointer text-left",
                              isNew && "bg-blue-50/20"
                            )}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-slate-900 truncate">
                                {n.title}
                              </p>
                              <p className="text-[11px] text-slate-500 leading-relaxed line-clamp-2 mt-0.5">
                                {n.message}
                              </p>
                              <p className="text-[10px] text-slate-400 mt-1">
                                {new Date(n.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} &bull; {new Date(n.time).toLocaleDateString()}
                              </p>
                            </div>
                            {isNew && (
                              <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0 mt-1" />
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/50">
                    <Link
                      to="/doctor/scheduled"
                      onClick={() => {
                        setBellOpen(false);
                        markAllRead();
                      }}
                      className="block text-center text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors"
                    >
                      View assigned appointments &rarr;
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {/* Doctor Avatar */}
            <div className="flex items-center gap-2 pl-1">
              {docProfile.photo ? (
                <img
                  src={docProfile.photo}
                  alt={docProfile.name || "Doctor"}
                  className="w-9 h-9 rounded-full object-cover border border-slate-200 ring-2 ring-blue-50"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs ring-2 ring-blue-50">
                  {docProfile.name ? docProfile.name.charAt(0).toUpperCase() : "D"}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Content body */}
        <div className="p-5 sm:p-8 flex-1">{children}</div>
      </main>
    </div>
  );
}
