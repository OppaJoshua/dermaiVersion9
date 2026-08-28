import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Calendar, Users, Bell, LogOut, Menu, ChevronRight, CheckCircle2, Lock, XCircle, Settings, Stethoscope } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef } from "react";
import { useClinicVerification } from "@/hooks/useClinicVerification";
import Logo from "../../assets/LogoDerm.png";
interface ClinicLayoutProps {
    children: React.ReactNode;
}
const sidebarLinks = [
    { label: "Dashboard", path: "/clinic", icon: LayoutDashboard, requiresVerified: false },
    { label: "Appointments", path: "/clinic/appointments", icon: Calendar, requiresVerified: true },
    { label: "Patients", path: "/clinic/patients", icon: Users, requiresVerified: true },
    { label: "Doctors", path: "/clinic/doctors", icon: Stethoscope, requiresVerified: true },
    { label: "Clinic Settings", path: "/clinic/settings", icon: Settings, requiresVerified: false },
];
export default function ClinicLayout({ children }: ClinicLayoutProps) {
    const location = useLocation();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [notifOpen, setNotifOpen] = useState(false);
    const notifRef = useRef<HTMLDivElement>(null);
    const { status: verificationStatus, clinicName } = useClinicVerification();
    // TODO: Load clinic notifications from Supabase real-time subscription
    const pendingAppointments: never[] = [];
    const doctorReviewNotifs: never[] = [];
    const unreadCount = 0;
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
        // TODO: Mark notifications as read via Supabase
    };
    const currentPage = sidebarLinks.find((l) => l.path === location.pathname)?.label || "Dashboard";
    return (<div className="min-h-screen bg-gray-50/80 flex">
      {sidebarOpen && (<div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden" onClick={() => setSidebarOpen(false)}/>)}

      <aside className={cn("flex flex-col w-[260px] bg-white border-r border-gray-100 min-h-screen fixed left-0 top-0 z-50 transition-transform duration-300", sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0")}>
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
            const isLocked = link.requiresVerified && verificationStatus !== "verified";
            return isLocked ? (<div key={link.path} className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-300 cursor-not-allowed select-none" title="Available for Verified clinics only">
                <Icon className="w-[18px] h-[18px] text-gray-300"/>
                <span className="flex-1">{link.label}</span>
                <Lock className="w-3.5 h-3.5 text-gray-300"/>
              </div>) : (<Link key={link.path} to={link.path} onClick={() => setSidebarOpen(false)} className={cn("flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all", isActive
                    ? "bg-magenta-50 text-magenta-600"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-900")}>
                <Icon className={cn("w-[18px] h-[18px]", isActive ? "text-magenta-500" : "text-gray-400")}/>
                <span className="flex-1">{link.label}</span>
                {isActive && <div className="w-1.5 h-1.5 rounded-full bg-magenta-500"/>}
              </Link>);
        })}
        </nav>

        <div className="px-3 py-4 border-t border-gray-100 space-y-2">
          <div className="px-4 py-2 rounded-xl bg-gray-50 border border-gray-100">
            <p className="text-sm font-semibold text-gray-900 truncate">{clinicName || "Clinic"}</p>
            <div className="mt-1">
              {verificationStatus === "verified" ? (<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500 text-white text-[10px] font-bold">
                  <CheckCircle2 className="w-3 h-3"/> Verified
                </span>) : verificationStatus === "rejected" ? (<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold border border-red-200">
                  <XCircle className="w-3 h-3"/> Rejected
                </span>) : (<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold border border-amber-200">
                  Pending Verification
                </span>)}
            </div>
          </div>

          <Link to="/" className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors">
            <LogOut className="w-[18px] h-[18px]"/>
            Logout
          </Link>
        </div>
      </aside>

      <main className="flex-1 lg:ml-[260px] min-h-screen">
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
              {unreadCount > 0 && (<span className="absolute top-1 right-1 min-w-[16px] h-4 px-0.5 flex items-center justify-center bg-magenta-500 rounded-full text-white text-[10px] font-bold leading-none">
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
                  {pendingAppointments.length === 0 && doctorReviewNotifs.length === 0 ? (<div className="py-10 text-center">
                      <Bell className="w-8 h-8 text-gray-200 mx-auto mb-2"/>
                      <p className="text-sm text-gray-400">No new notifications</p>
                    </div>) : null}
                </div>

                {/* Footer */}
                <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/50">
                  <Link to="/clinic/appointments" onClick={() => { setNotifOpen(false); markAllRead(); }} className="block text-center text-sm font-semibold text-magenta-500 hover:text-magenta-700 transition-colors">
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
