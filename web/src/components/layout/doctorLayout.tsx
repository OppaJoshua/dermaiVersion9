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
  LifeBuoy,
  User,
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

const sidebarLinks = [
  { label: "Dashboard", path: "/doctor", icon: LayoutDashboard },
  { label: "Review Patient", path: "/doctor/appointments", icon: Calendar },
  { label: "Assigned Appointment", path: "/doctor/scheduled", icon: Stethoscope },
  { label: "Patient History", path: "/doctor/history", icon: History },
  { label: "Help & Support", path: "/doctor/settings", icon: LifeBuoy },
];

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
      const { data: docData } = await supabase
        .from("clinic_doctor")
        .select("doctor_id, doctor_name")
        .or(`user_id.eq.${user.id},email.ilike.${userEmail}`);

      (docData || []).forEach((d) => {
        if (d.doctor_id) docIds.push(d.doctor_id);
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
          }
        }
      } catch { }

      const uniqueDocIds = Array.from(new Set(docIds.filter(Boolean)));

      if (uniqueDocIds.length > 0) {
        const { data: apps } = await supabase
          .from("patient_appointment")
          .select("appointment_id, patient_name, date, time, status, created_at")
          .in("assigned_doctor_id", uniqueDocIds)
          .order("created_at", { ascending: false })
          .limit(10);

        if (apps) {
          apps.forEach((a: any) => {
            list.push({
              id: `doc-app-${a.appointment_id}`,
              title: "New Assigned Patient",
              message: `${a.patient_name || "A patient"} was assigned to you for consultation.`,
              time: a.created_at,
              type: "assigned",
            });
          });
        }
      }

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
            name: cd.doctor_name || prev.name || "Dr. Audrey Saludaga",
            clinic: clinicObj?.name || prev.clinic || "DermAI Clinic",
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
        if (Array.isArray(parsedDocs) && parsedDocs.length > 0) {
          const first = parsedDocs[0];
          setDocProfile((prev) => ({
            name: first.name || prev.name || "Doctor",
            clinic: first.clinicName || prev.clinic || "DermAI Clinic",
            photo: prev.photo || first.photo,
          }));
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
    <div className="min-h-screen bg-gray-50/80 flex">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          "flex flex-col w-[260px] bg-white border-r border-gray-100 min-h-screen fixed left-0 top-0 z-50 transition-transform duration-300",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className="flex items-center gap-2.5 px-6 h-16 border-b border-gray-100 shrink-0">
          <img src={Logo} alt="DERMAI logo" className="h-9 w-auto object-contain" />
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold ml-0.5">
            Doctor
          </span>
        </div>

        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto mt-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 mb-2">
            Doctor Menu
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
                  "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all",
                  isActive
                    ? "bg-blue-50 text-blue-600"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <Icon className={cn("w-[18px] h-[18px]", isActive ? "text-blue-500" : "text-gray-400")} />
                <span className="flex-1">{link.label}</span>
                {isActive && <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 py-4 border-t border-gray-100 space-y-2">
          <div className="px-3.5 py-3 rounded-xl bg-blue-50/70 border border-blue-100">
            <div className="flex items-center gap-2.5">
              {docProfile.photo ? (
                <img
                  src={docProfile.photo}
                  alt={docProfile.name || "Doctor"}
                  className="w-8 h-8 rounded-full object-cover border border-blue-200 shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-blue-500" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {docProfile.name || "Doctor"}
                </p>
                <p className="text-[11px] text-blue-600 truncate">
                  {docProfile.clinic || "Clinic Doctor"}
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <LogOut className="w-[18px] h-[18px]" />
            Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 lg:ml-[260px] min-h-screen">
        <div className="bg-white border-b border-gray-100 px-4 sm:px-6 h-16 flex items-center justify-between sticky top-0 z-40">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden p-2 rounded-xl hover:bg-gray-50 text-gray-500"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-gray-400">Doctor</span>
              <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
              <span className="font-semibold text-gray-900">{currentPage}</span>
            </div>
          </div>

          <div ref={bellRef} className="relative">
            <button
              onClick={() => setBellOpen((prev) => !prev)}
              className="relative p-2.5 rounded-xl hover:bg-gray-50 transition-colors"
            >
              <Bell className={cn("w-5 h-5", bellOpen ? "text-blue-500" : "text-gray-500")} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] h-4 px-0.5 flex items-center justify-center bg-blue-500 rounded-full text-white text-[10px] font-bold leading-none">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            {bellOpen && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,80,200,0.12)] border border-gray-100 z-50 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-blue-500" />
                    <span className="font-semibold text-gray-900 text-sm">Notifications</span>
                  </div>
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllRead}
                      className="text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                    >
                      Mark all read
                    </button>
                  )}
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                  {notifications.length === 0 ? (
                    <div className="py-10 text-center">
                      <Bell className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                      <p className="text-sm text-gray-400">No notifications yet</p>
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
                            "flex items-start gap-3 px-4 py-3 hover:bg-blue-50/40 transition-colors cursor-pointer text-left",
                            isNew && "bg-blue-50/20"
                          )}
                        >
                          <div
                            className={cn(
                              "w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5",
                              n.type === "assigned"
                                ? "bg-blue-100 text-blue-600"
                                : "bg-purple-100 text-purple-600"
                            )}
                          >
                            {n.type === "assigned" ? (
                              <Stethoscope className="w-4 h-4" />
                            ) : (
                              <Bell className="w-4 h-4" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-gray-900 truncate">
                              {n.title}
                            </p>
                            <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-2 mt-0.5">
                              {n.message}
                            </p>
                            <p className="text-[10px] text-gray-400 mt-1">
                              {new Date(n.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date(n.time).toLocaleDateString()}
                            </p>
                          </div>
                          {isNew && (
                            <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-2" />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/50">
                  <Link
                    to="/doctor/scheduled"
                    onClick={() => {
                      setBellOpen(false);
                      markAllRead();
                    }}
                    className="block text-center text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors"
                  >
                    View assigned appointments →
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 sm:p-6">{children}</div>
      </main>
    </div>
  );
}
