import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  CheckCircle2,
  XCircle,
  Clock,
  HelpCircle,
  Calendar,
  Sparkles,
  ArrowRight,
  CheckCheck,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useClinicVerification } from "@/hooks/useClinicVerification";
import { useRoleNotifications, type NotificationItem } from "@/lib/notificationService";

interface ClinicNotificationsProps {
  onClose?: () => void;
  isDropdown?: boolean;
}

export default function ClinicNotifications({ onClose, isDropdown = false }: ClinicNotificationsProps) {
  const { user } = useAuth();
  const { clinicId } = useClinicVerification();
  const { notifications, loading, unreadCount, markRead, markAllRead } = useRoleNotifications("clinic", {
    clinicId: clinicId || undefined,
    userId: user?.id,
    userEmail: user?.email,
  });

  const [activeTab, setActiveTab] = useState<"all" | "requests" | "doctor-action" | "ticket" | "broadcast">("all");

  const filtered = useMemo(() => {
    if (activeTab === "all") return notifications;
    if (activeTab === "requests") return notifications.filter((n) => n.type === "appointment-request" || n.type === "patient-reselection");
    if (activeTab === "doctor-action") return notifications.filter((n) => n.type.includes("doctor-") || n.type === "consultation-completed");
    if (activeTab === "ticket") return notifications.filter((n) => n.category === "ticket");
    if (activeTab === "broadcast") return notifications.filter((n) => n.category === "broadcast");
    return notifications;
  }, [notifications, activeTab]);

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const getItemIcon = (n: NotificationItem) => {
    if (n.type === "appointment-request") return <Clock className="w-4 h-4 text-blue-600" />;
    if (n.type === "doctor-accepted") return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
    if (n.type === "doctor-rejected") return <XCircle className="w-4 h-4 text-red-600" />;
    if (n.type === "patient-reselection") return <RefreshCw className="w-4 h-4 text-amber-600" />;
    if (n.type === "consultation-completed") return <Sparkles className="w-4 h-4 text-magenta-600" />;
    if (n.category === "ticket") return <HelpCircle className="w-4 h-4 text-purple-600" />;
    if (n.category === "broadcast") return <Bell className="w-4 h-4 text-cyan-600" />;
    return <Calendar className="w-4 h-4 text-gray-500" />;
  };

  return (
    <div className={cn("flex flex-col bg-white", isDropdown ? "w-full max-h-[500px]" : "w-full rounded-2xl border border-gray-100 shadow-sm")}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 bg-gray-50/50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-magenta-50 flex items-center justify-center text-magenta-600">
            <Bell className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">Clinic Activity</h3>
            <p className="text-[11px] text-gray-500">
              {unreadCount > 0 ? `${unreadCount} unread alert${unreadCount > 1 ? "s" : ""}` : "All clinic alerts resolved"}
            </p>
          </div>
        </div>

        {unreadCount > 0 && (
          <button
            onClick={() => markAllRead()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-magenta-600 hover:bg-magenta-50 transition-colors cursor-pointer"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            <span>Mark all read</span>
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-gray-100 bg-white overflow-x-auto no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden text-xs">
        {[
          { key: "all", label: "All" },
          { key: "requests", label: "Bookings & Reselections" },
          { key: "doctor-action", label: "Doctor Actions" },
          { key: "ticket", label: "Support" },
          { key: "broadcast", label: "Announcements" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={cn(
              "px-3 py-1 rounded-full font-medium transition-colors whitespace-nowrap cursor-pointer",
              activeTab === tab.key
                ? "bg-magenta-600 text-white font-semibold"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden divide-y divide-gray-100">
        {loading ? (
          <div className="py-12 text-center text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-magenta-600" />
            <p className="text-xs">Loading clinic notifications…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 px-6 text-center text-gray-400">
            <Bell className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p className="text-sm font-semibold text-gray-700">No new alerts</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {activeTab === "all"
                ? "Incoming bookings, doctor approvals, and completed consultations will appear here."
                : `No notifications under ${activeTab}.`}
            </p>
          </div>
        ) : (
          filtered.map((item) => (
            <div
              key={item.id}
              onClick={() => !item.isRead && markRead(item.id)}
              className={cn(
                "p-4 transition-colors relative flex gap-3 cursor-pointer",
                !item.isRead ? "bg-magenta-50/25 hover:bg-magenta-50/40" : "hover:bg-gray-50/70"
              )}
            >
                {/* Avatar with fallback */}
                <div className="relative shrink-0 w-10 h-10">
                  {item.senderAvatar ? (
                    <img
                      src={item.senderAvatar}
                      alt={item.senderName || "Sender"}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-xl object-cover border border-gray-200 bg-white shadow-2xs"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
                      {getItemIcon(item)}
                    </div>
                  )}
                  <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white border border-gray-200 flex items-center justify-center shadow-2xs">
                    {getItemIcon(item)}
                  </span>
                </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-magenta-700">
                    {item.senderName || item.category}
                  </span>
                  <span className="text-[10px] text-gray-400 whitespace-nowrap shrink-0">
                    {timeAgo(item.timestamp)}
                  </span>
                </div>

                <p className="text-xs font-semibold text-gray-900 mb-0.5">{item.title}</p>
                <p className="text-xs text-gray-600 leading-relaxed">{item.message}</p>

                {item.link && (
                  <Link
                    to={item.link}
                    onClick={onClose}
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-magenta-600 hover:text-magenta-800 transition-colors"
                  >
                    <span>Manage in Clinic Appointments</span>
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
              </div>

              {/* Unread indicator */}
              {!item.isRead && (
                <span className="w-2 h-2 rounded-full bg-magenta-500 shrink-0 mt-1.5" />
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer Link */}
      {isDropdown && (
        <div className="border-t border-gray-100 px-4 py-2.5 bg-gray-50/60 text-center">
          <Link
            to="/clinic/appointments"
            onClick={onClose}
            className="text-xs font-semibold text-magenta-600 hover:text-magenta-800 transition-colors"
          >
            Open Clinic Appointments Table →
          </Link>
        </div>
      )}
    </div>
  );
}
