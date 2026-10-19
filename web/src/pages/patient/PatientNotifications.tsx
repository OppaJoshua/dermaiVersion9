import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Building2,
  Calendar,
  Sparkles,
  ArrowRight,
  CheckCheck,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useRoleNotifications, type NotificationItem } from "@/lib/notificationService";

interface PatientNotificationsProps {
  onClose?: () => void;
  isDropdown?: boolean;
}

export default function PatientNotifications({ onClose, isDropdown = false }: PatientNotificationsProps) {
  const { user } = useAuth();
  const { notifications, loading, unreadCount, markRead, markAllRead } = useRoleNotifications("patient", {
    userId: user?.id,
  });

  const [activeTab, setActiveTab] = useState<"all" | "appointment" | "ticket" | "broadcast">("all");

  const filtered = useMemo(() => {
    if (activeTab === "all") return notifications;
    return notifications.filter((n) => n.category === activeTab);
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
    if (n.type === "appointment-accepted") return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
    if (n.type === "appointment-rejected") return <XCircle className="w-4 h-4 text-red-600" />;
    if (n.type === "appointment-completed") return <Sparkles className="w-4 h-4 text-magenta-600" />;
    if (n.category === "ticket") return <HelpCircle className="w-4 h-4 text-purple-600" />;
    if (n.category === "broadcast") return <Bell className="w-4 h-4 text-blue-600" />;
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
            <h3 className="text-sm font-bold text-gray-900">Notifications</h3>
            <p className="text-[11px] text-gray-500">
              {unreadCount > 0 ? `${unreadCount} unread update${unreadCount > 1 ? "s" : ""}` : "All updates read"}
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
          { key: "appointment", label: "Appointments" },
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
            <p className="text-xs">Loading notifications…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 px-6 text-center text-gray-400">
            <Bell className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p className="text-sm font-semibold text-gray-700">No notifications found</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {activeTab === "all"
                ? "You're all caught up! New updates from your clinic will appear here."
                : `No notifications under the ${activeTab} category.`}
            </p>
          </div>
        ) : (
          filtered.map((item) => {
            const isRejected = item.type === "appointment-rejected";

            return (
              <div
                key={item.id}
                onClick={() => !item.isRead && markRead(item.id)}
                className={cn(
                  "p-4 transition-colors relative flex gap-3 cursor-pointer",
                  !item.isRead ? "bg-magenta-50/25 hover:bg-magenta-50/40" : "hover:bg-gray-50/70"
                )}
              >
                {/* Sender Avatar / Icon */}
                <div className="relative shrink-0">
                  {item.senderAvatar ? (
                    <img
                      src={item.senderAvatar}
                      alt={item.senderName || "Clinic"}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-xl object-cover border border-gray-200"
                    />
                  ) : item.senderType === "clinic" ? (
                    <div className="w-10 h-10 rounded-xl bg-magenta-100 text-magenta-700 flex items-center justify-center font-bold text-xs">
                      <Building2 className="w-5 h-5" />
                    </div>
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
                    <p className="text-xs font-bold text-gray-900 truncate">
                      {item.senderName || "Clinic Update"}
                    </p>
                    <span className="text-[10px] text-gray-400 whitespace-nowrap shrink-0">
                      {timeAgo(item.timestamp)}
                    </span>
                  </div>

                  <p className="text-xs font-semibold text-gray-800 mb-1">{item.title}</p>
                  <p className="text-xs text-gray-600 leading-relaxed">{item.message}</p>

                  {/* Dynamic 24-Hour Re-selection Banner for Rejections */}
                  {isRejected && (
                    <div className="mt-2.5 p-2.5 rounded-xl bg-red-50/80 border border-red-200/80 text-[11px] text-red-900 space-y-2">
                      <div className="flex items-start gap-1.5 font-medium leading-relaxed">
                        <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
                        <span>
                          <strong>24-Hour Window:</strong> You can select another available doctor within 24 hours. If no selection is made within 24 hours, the clinic will automatically assign an available doctor to your booking.
                        </span>
                      </div>
                      <Link
                        to="/dashboard/appointment-status"
                        onClick={onClose}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors"
                      >
                        <span>Select Alternate Doctor</span>
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  )}

                  {/* Action Link for general notifications */}
                  {item.link && !isRejected && (
                    <Link
                      to={item.link}
                      onClick={onClose}
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-magenta-600 hover:text-magenta-800 transition-colors"
                    >
                      <span>View details</span>
                      <ArrowRight className="w-3 h-3" />
                    </Link>
                  )}
                </div>

                {/* Unread dot */}
                {!item.isRead && (
                  <span className="w-2 h-2 rounded-full bg-magenta-500 shrink-0 mt-1.5" />
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer view all link */}
      {isDropdown && (
        <div className="border-t border-gray-100 px-4 py-2.5 bg-gray-50/60 text-center">
          <Link
            to="/dashboard/appointment-status"
            onClick={onClose}
            className="text-xs font-semibold text-magenta-600 hover:text-magenta-800 transition-colors"
          >
            Check appointment status →
          </Link>
        </div>
      )}
    </div>
  );
}
