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
  Loader2,
  AlertCircle,
  CheckCheck,
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
    const cls = "w-5 h-5 text-magenta-600";
    if (n.type === "appointment-accepted") return <CheckCircle2 className={cls} />;
    if (n.type === "appointment-rejected") return <XCircle className={cls} />;
    if (n.type === "appointment-completed") return <Sparkles className={cls} />;
    if (n.category === "ticket") return <HelpCircle className={cls} />;
    if (n.category === "broadcast") return <Bell className={cls} />;
    return <Calendar className={cls} />;
  };

  return (
    <div
      className={cn(
        "flex flex-col bg-white overflow-hidden rounded-xl border border-gray-200",
        isDropdown ? "w-full max-h-[560px] shadow-lg" : "w-full shadow-sm"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-gray-200">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900">Notifications</h3>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-magenta-600 text-white text-xs font-semibold leading-none">
                {unreadCount}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {unreadCount > 0 ? `${unreadCount} unread update${unreadCount > 1 ? "s" : ""}` : "All updates read"}
          </p>
        </div>

        {unreadCount > 0 && (
          <button
            onClick={() => markAllRead()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer shrink-0"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            <span>Mark all read</span>
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="border-b border-gray-200 px-3">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
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
                "px-3 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer",
                activeTab === tab.key
                  ? "border-magenta-600 text-magenta-700"
                  : "border-transparent text-gray-500 hover:text-gray-900"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden divide-y divide-gray-100">
        {loading ? (
          <div className="py-16 text-center text-gray-500">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-magenta-600" />
            <p className="text-sm">Loading notifications…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <Bell className="w-5 h-5 text-gray-400" />
            </div>
            <p className="text-sm font-semibold text-gray-900">No notifications found</p>
            <p className="text-sm text-gray-500 mt-1">
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
                  "relative flex items-start gap-3 px-5 py-4 transition-colors cursor-pointer",
                  !item.isRead ? "bg-magenta-50/40 hover:bg-magenta-50/70" : "hover:bg-gray-50"
                )}
              >
                {!item.isRead && <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-magenta-600" />}

                {/* Sender Avatar / Icon */}
                <div className="shrink-0">
                  {item.senderAvatar ? (
                    <img
                      src={item.senderAvatar}
                      alt={item.senderName || "Clinic"}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-full object-cover border border-gray-200 bg-white"
                    />
                  ) : item.senderType === "clinic" ? (
                    <div className="w-10 h-10 rounded-full bg-magenta-50 border border-magenta-100 flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-magenta-600" />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-magenta-50 border border-magenta-100 flex items-center justify-center">
                      {getItemIcon(item)}
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-magenta-700 truncate">
                      {item.senderName || "Clinic Update"}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-gray-500 whitespace-nowrap">{timeAgo(item.timestamp)}</span>
                      {!item.isRead && <span className="w-2 h-2 rounded-full bg-magenta-600" />}
                    </span>
                  </div>

                  <p className="text-sm font-semibold text-gray-900 mt-0.5">{item.title}</p>
                  <p className="text-sm text-gray-600 leading-relaxed mt-0.5 break-words">{item.message}</p>

                  {/* Dynamic 24-Hour Re-selection Banner for Rejections */}
                  {isRejected && (
                    <div className="mt-3 p-3.5 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-800 space-y-3">
                      <div className="flex items-start gap-2.5 leading-relaxed">
                        <AlertCircle className="w-4 h-4 text-magenta-600 shrink-0 mt-0.5" />
                        <span>
                          <strong>24-hour window:</strong> You can select another available doctor within 24 hours. If no selection is made within 24 hours, the clinic will automatically assign an available doctor to your booking.
                        </span>
                      </div>
                      <Link
                        to="/dashboard/appointment-status"
                        onClick={onClose}
                        className="inline-flex items-center px-3.5 py-1.5 rounded-lg bg-magenta-600 text-white text-sm font-medium hover:bg-magenta-700 transition-colors"
                      >
                        Select alternate doctor
                      </Link>
                    </div>
                  )}

                  {/* Action Link for general notifications */}
                  {item.link && !isRejected && (
                    <Link
                      to={item.link}
                      onClick={onClose}
                      className="mt-2 inline-flex items-center text-sm font-medium text-magenta-700 hover:text-magenta-800 transition-colors"
                    >
                      View details →
                    </Link>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer view all link */}
      {isDropdown && (
        <div className="border-t border-gray-200 px-5 py-3 bg-gray-50 text-center">
          <Link
            to="/dashboard/appointment-status"
            onClick={onClose}
            className="text-sm font-medium text-magenta-700 hover:text-magenta-800 transition-colors"
          >
            Check appointment status →
          </Link>
        </div>
      )}
    </div>
  );
}