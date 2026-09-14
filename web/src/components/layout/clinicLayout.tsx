import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Calendar, Users, Bell, LogOut, Menu, ChevronRight, CheckCircle2, Settings, Stethoscope, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
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

import { supabase } from "@/lib/supabaseClient";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";

type ClinicNotif = {
  id: string;
  type: "appointment-pending" | "doctor-reviewed" | "broadcast";
  title: string;
  message: string;
  time: string;
};

export default function ClinicLayout({ children }: ClinicLayoutProps) {
    const { signOut, user } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const notifRef = useRef<HTMLDivElement>(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [notifOpen, setNotifOpen] = useState(false);
    const { clinicName, clinicId, status: verificationStatus, loading } = useClinicVerification();
    
    const [notifications, setNotifications] = useState<ClinicNotif[]>([]);
    const [lastReadAt, setLastReadAt] = useState<string>(() => {
        try {
            return localStorage.getItem("dermai_clinic_last_read_notifs") || new Date(0).toISOString();
        } catch {
            return new Date(0).toISOString();
        }
    });

    const loadClinicNotifications = useCallback(async () => {
        if (!clinicId) return;
        try {
            const list: ClinicNotif[] = [];

            // 1. Pending incoming appointments
            const { data: pendingApps } = await supabase
                .from("patient_appointment")
                .select("appointment_id, patient_name, ai_condition_name, created_at, status")
                .eq("clinic_id", clinicId)
                .eq("status", "pending")
                .order("created_at", { ascending: false })
                .limit(10);

            if (pendingApps) {
                pendingApps.forEach((a: any) => {
                    list.push({
                        id: `app-${a.appointment_id}`,
                        type: "appointment-pending",
                        title: "New Appointment Request",
                        message: `${a.patient_name || "A patient"} requested an appointment${a.ai_condition_name ? ` for ${a.ai_condition_name}` : ""}.`,
                        time: a.created_at,
                    });
                });
            }

            // 2. User notifications
            if (user?.id) {
                const { data: userNotifs } = await supabase
                    .from("user_notification")
                    .select("notif_id, type, title, body, created_at")
                    .eq("user_id", user.id)
                    .order("created_at", { ascending: false })
                    .limit(10);

                if (userNotifs) {
                    userNotifs.forEach((n: any) => {
                        list.push({
                            id: n.notif_id,
                            type: "broadcast",
                            title: n.title,
                            message: n.body || "",
                            time: n.created_at,
                        });
                    });
                }
            }

            list.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
            setNotifications(list);
        } catch {
            /* ignore */
        }
    }, [clinicId, user?.id]);

    useEffect(() => {
        loadClinicNotifications();

        let channel: any = null;
        if (clinicId) {
            channel = supabase
                .channel(`clinic-layout-notifs-${clinicId}`)
                .on(
                    "postgres_changes",
                    { event: "*", schema: "public", table: "patient_appointment", filter: `clinic_id=eq.${clinicId}` },
                    () => loadClinicNotifications()
                )
                .subscribe();
        }

        return () => {
            if (channel) supabase.removeChannel(channel);
        };
    }, [clinicId, loadClinicNotifications]);

    const unreadCount = notifications.filter(
        (n) => new Date(n.time) > new Date(lastReadAt)
    ).length;

    const handleLogout = async () => {
        try {
            localStorage.removeItem("dermai_clinic_profile_cache");
        } catch {}
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

    const markAllRead = () => {
        const now = new Date().toISOString();
        setLastReadAt(now);
        try {
            localStorage.setItem("dermai_clinic_last_read_notifs", now);
        } catch {}
    };
    const currentPage = sidebarLinks.find((l) => l.path === location.pathname)?.label || "Dashboard";
    return (<div className="min-h-screen bg-gray-50/80 flex">
      {sidebarOpen && (<div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden" onClick={() => setSidebarOpen(false)}/>)}

      <aside className={cn("flex flex-col w-65 bg-white border-r border-gray-100 min-h-screen fixed left-0 top-0 z-50 transition-transform duration-300", sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0")}>
        <div className="flex items-center gap-2.5 px-6 h-16 border-b border-gray-100 shrink-0">
          <img src={Logo} alt="DERMAI logo" className="h-9 w-auto object-contain"/>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold ml-0.5">
            Clinic
          </span>
        </div>

        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto mt-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 mb-2">
            Clinic Menu
          </p>
          {sidebarLinks.map((link) => {
            const Icon = link.icon;
            const isActive = location.pathname === link.path;
            const isLocked = !loading && link.requiresVerified && verificationStatus !== "verified";

            return (
              <Link
                key={link.path}
                to={isLocked ? "/clinic" : link.path}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all",
                  isActive
                    ? "bg-magenta-50 text-magenta-600 font-semibold"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-900",
                  isLocked && "opacity-60 cursor-not-allowed"
                )}
              >
                <Icon className={cn("w-4.5 h-4.5", isActive ? "text-magenta-500" : "text-gray-400")} />
                <span className="flex-1">{link.label}</span>
                {isLocked && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold">
                    Locked
                  </span>
                )}
                {isActive && !isLocked && <div className="w-1.5 h-1.5 rounded-full bg-magenta-500" />}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 py-4 border-t border-gray-100 space-y-2">
          <div className="px-4 py-2 rounded-xl bg-gray-50 border border-gray-100">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-semibold text-gray-900 truncate">{clinicName || "Clinic Portal"}</p>
              {verificationStatus === "verified" && (
                <VerifiedBadge size={15} className="w-3.5 h-3.5" title="Verified Clinic" />
              )}
            </div>
            <div className="mt-1">
              {loading ? (
                <div className="h-4 w-20 bg-gray-200 animate-pulse rounded-full" />
              ) : verificationStatus === "verified" ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200">
                  <CheckCircle2 className="w-3 h-3" /> Active Clinic
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold border border-amber-200">
                  <Clock className="w-3 h-3" /> Pending Review
                </span>
              )}
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <LogOut className="w-4.5 h-4.5"/>
            Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 lg:ml-65 min-h-screen">
        <div className="bg-white border-b border-gray-100 px-4 sm:px-6 h-16 flex items-center justify-between sticky top-0 z-40">
          <div className="flex items-center gap-3">
            <button className="lg:hidden p-2 rounded-xl hover:bg-gray-50 text-gray-500" onClick={() => setSidebarOpen(true)}>
              <Menu className="w-5 h-5"/>
            </button>
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-gray-400">Clinic</span>
              <ChevronRight className="w-3.5 h-3.5 text-gray-300"/>
              <span className="font-semibold text-gray-900">{currentPage}</span>
            </div>
          </div>
          <div ref={notifRef} className="relative">
            <button onClick={() => setNotifOpen((o) => !o)} className="relative p-2.5 rounded-xl hover:bg-gray-50 transition-colors">
              <Bell className={cn("w-5 h-5", notifOpen ? "text-magenta-500" : "text-gray-500")}/>
              {unreadCount > 0 && (<span className="absolute top-1 right-1 min-w-4 h-4 px-0.5 flex items-center justify-center bg-magenta-500 rounded-full text-white text-[10px] font-bold leading-none">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>)}
            </button>

            {notifOpen && (<div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-[0_8px_32px_rgba(160,25,90,0.15)] border border-gray-100 z-50 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-magenta-500"/>
                    <span className="font-semibold text-gray-900 text-sm">Notifications</span>
                  </div>
                  {unreadCount > 0 && (<button onClick={markAllRead} className="text-[11px] text-magenta-500 hover:text-magenta-700 font-medium">
                      Mark all read
                    </button>)}
                </div>

                {/* Items */}
                <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                  {notifications.length === 0 ? (
                    <div className="py-10 text-center">
                      <Bell className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                      <p className="text-sm text-gray-400">No new notifications</p>
                    </div>
                  ) : (
                    notifications.map((n) => {
                      const isNew = new Date(n.time) > new Date(lastReadAt);
                      return (
                        <div
                          key={n.id}
                          onClick={() => {
                            setNotifOpen(false);
                            markAllRead();
                            navigate("/clinic/appointments");
                          }}
                          className={cn(
                            "flex items-start gap-3 px-4 py-3 hover:bg-magenta-50/30 transition-colors cursor-pointer text-left",
                            isNew && "bg-magenta-50/20"
                          )}
                        >
                          <div
                            className={cn(
                              "w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5",
                              n.type === "appointment-pending"
                                ? "bg-amber-100 text-amber-600"
                                : "bg-magenta-100 text-magenta-600"
                            )}
                          >
                            <Calendar className="w-4 h-4" />
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
                            <span className="w-2 h-2 rounded-full bg-magenta-500 shrink-0 mt-2" />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Footer */}
                <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/50">
                  <Link
                    to="/clinic/appointments"
                    onClick={() => {
                      setNotifOpen(false);
                      markAllRead();
                    }}
                    className="block text-center text-sm font-semibold text-magenta-500 hover:text-magenta-700 transition-colors"
                  >
                    View all appointments →
                  </Link>
                </div>
              </div>)}
          </div>
        </div>

        <div className="p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>);
}
