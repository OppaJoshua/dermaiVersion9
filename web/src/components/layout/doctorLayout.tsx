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
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef } from "react";
import Logo from "../../assets/logo2.png";

interface DoctorLayoutProps {
  children: React.ReactNode;
}

const sidebarLinks = [
  { label: "Dashboard", path: "/doctor", icon: LayoutDashboard },
  { label: "Review Patient", path: "/doctor/appointments", icon: Calendar },
  { label: "Assigned Appointment", path: "/doctor/scheduled", icon: Stethoscope },
  { label: "Patient History", path: "/doctor/history", icon: History },
];

// TODO: Replace with Supabase auth session
const doctorName = "";
const doctorClinic = "";

export default function DoctorLayout({ children }: DoctorLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  // TODO: Load doctor notifications from Supabase real-time subscription
  const notifications: never[] = [];
  const unreadCount = 0;
  const bellRef = useRef<HTMLDivElement>(null);

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

  const handleLogout = () => {
    // TODO: Supabase signOut()
    navigate("/login", { replace: true });
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
          <div className="px-4 py-3 rounded-xl bg-blue-50 border border-blue-100">
            <div className="flex items-center gap-2">
              <Stethoscope className="w-4 h-4 text-blue-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{doctorName || "Doctor"}</p>
                {doctorClinic && (
                  <p className="text-[11px] text-blue-600 truncate">{doctorClinic}</p>
                )}
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
                  <button
                    onClick={() => setBellOpen(false)}
                    className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                  {notifications.length === 0 ? (
                    <div className="py-10 text-center">
                      <Bell className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                      <p className="text-sm text-gray-400">No notifications yet</p>
                    </div>
                  ) : null}
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
