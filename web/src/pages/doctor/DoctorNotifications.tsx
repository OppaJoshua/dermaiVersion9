import { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Bell,
  ArrowRight,
  CheckCheck,
  Loader2,
  AlertTriangle,
  Megaphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useRoleNotifications } from "@/lib/notificationService";

interface DoctorNotificationsProps {
  onClose?: () => void;
  isDropdown?: boolean;
}

export default function DoctorNotifications({ onClose, isDropdown = false }: DoctorNotificationsProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { notifications, loading, unreadCount, markRead, markAllRead } = useRoleNotifications("doctor", {
    userId: user?.id,
    userEmail: user?.email,
  });

  const [activeTab, setActiveTab] = useState<"all" | "appointment" | "ticket" | "broadcast">("all");

  const filtered = useMemo(() => {
    if (activeTab === "all") return notifications;
    if (activeTab === "broadcast") {
      return notifications.filter(
        (n) =>
          n.category === "broadcast" ||
          n.type === "broadcast" ||
          n.metadata?.subtype === "admin_announcement" ||
          n.metadata?.subtype === "maintenance_alert" ||
          n.type === "maintenance_alert"
      );
    }
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
            <h3 className="text-base font-semibold text-gray-900">Notification</h3>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-magenta-600 text-white text-xs font-semibold leading-none">
                {unreadCount}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {unreadCount > 0 ? `${unreadCount} unread request${unreadCount > 1 ? "s" : ""}` : "All requests up to date"}
          </p>
        </div>

        {unreadCount > 0 && (
          <button
            onClick={() => markAllRead()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer shrink-0"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            <span>Mark all as read</span>
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="border-b border-gray-200 px-3">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {[
            { key: "all", label: "All" },
            { key: "appointment", label: "Patient Bookings" },
            { key: "ticket", label: "Support Tickets" },
            { key: "broadcast", label: "Announcements & Maintenance" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={cn(
                "border-b-2 transition-colors whitespace-nowrap cursor-pointer",
                isDropdown ? "px-2.5 py-2 text-xs font-semibold" : "px-3 py-2.5 text-sm font-medium",
                activeTab === tab.key
                  ? "border-blue-600 text-blue-700"
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
            <p className="text-sm">Loading clinical notifications…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <Bell className="w-5 h-5 text-gray-400" />
            </div>
            <p className="text-sm font-semibold text-gray-900">No new notifications</p>
            <p className="text-sm text-gray-500 mt-1">
              {activeTab === "all"
                ? "New patient requests, clinic assignments, and announcements will appear here."
                : `No notifications under ${activeTab}.`}
            </p>
          </div>
        ) : (
          filtered.map((item) => {
            const isMaintenance =
              item.metadata?.subtype === "maintenance_alert" ||
              item.type === "maintenance_alert" ||
              item.metadata?.priority === "high";
            const isBroadcast =
              item.category === "broadcast" ||
              item.type === "broadcast" ||
              item.metadata?.subtype === "admin_announcement";

            const isAppointmentRequest =
              item.category === "appointment" ||
              item.type === "appointment_request" ||
              item.type === "appointment-request" ||
              item.type.includes("delegated") ||
              item.type.includes("appointment");

            const clinicId = item.metadata?.clinicId || item.metadata?.clinic_id;
            const patientId = item.metadata?.patientId || item.metadata?.patient_id || item.metadata?.user_id;
            const appointmentId = item.metadata?.appointmentId || item.metadata?.appointment_id;

            const targetLink = item.link || (
              item.metadata?.clinicId && item.metadata?.patientId
                ? `/doctor/clinics/${item.metadata.clinicId}/patients/${item.metadata.patientId}${
                    item.metadata?.appointmentId ? `?appointmentId=${item.metadata.appointmentId}` : ""
                  }`
                : clinicId && patientId
                ? `/doctor/clinics/${clinicId}/patients/${patientId}${
                    appointmentId ? `?appointmentId=${appointmentId}` : ""
                  }`
                : null
            );

            const handleItemClick = () => {
              if (!item.isRead) {
                markRead(item.id);
              }
              onClose?.();
              if (targetLink) {
                navigate(targetLink);
              }
            };

            let actionLabel = "View Consultation";
            if (isMaintenance) {
              actionLabel = "View System Status";
            } else if (isAppointmentRequest) {
              actionLabel = item.metadata?.branch_name ? "Review Patient Request" : "View Patient Details";
            }

            return (
              <div
                key={item.id}
                onClick={handleItemClick}
                className={cn(
                  "relative flex items-start gap-3 px-5 py-4 transition-colors cursor-pointer",
                  !item.isRead
                    ? isMaintenance
                      ? "bg-amber-50/50 hover:bg-amber-50/80"
                      : "bg-magenta-50/40 hover:bg-magenta-50/70"
                    : "hover:bg-gray-50"
                )}
              >
                {!item.isRead && (
                  <span
                    className={cn(
                      "absolute left-0 top-0 bottom-0 w-0.5",
                      isMaintenance ? "bg-amber-500" : "bg-magenta-600"
                    )}
                  />
                )}

                {/* Avatar with real profile picture & fallback initials */}
                <div className="relative shrink-0 w-10 h-10">
                  {item.senderAvatar ? (
                    <img
                      src={item.senderAvatar}
                      alt={item.senderName || "Sender"}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-full object-cover border border-gray-200 bg-white"
                      onError={(e) => {
                        (e.currentTarget as HTMLElement).style.display = "none";
                        const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                        if (fallback) fallback.style.display = "flex";
                      }}
                    />
                  ) : null}
                  <div
                    className={cn(
                      "w-10 h-10 rounded-full items-center justify-center font-semibold text-xs border",
                      isMaintenance
                        ? "bg-amber-100 text-amber-800 border-amber-300"
                        : isBroadcast
                        ? "bg-magenta-50 text-magenta-700 border-magenta-200"
                        : "bg-magenta-50 text-magenta-700 border-magenta-100"
                    )}
                    style={{ display: item.senderAvatar ? "none" : "flex" }}
                  >
                    {isMaintenance ? (
                      <AlertTriangle className="w-5 h-5 text-amber-600" />
                    ) : isBroadcast ? (
                      <Megaphone className="w-5 h-5 text-magenta-600" />
                    ) : (
                      (item.senderName || "PT").slice(0, 2).toUpperCase()
                    )}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={cn(
                          "text-xs font-semibold truncate",
                          isMaintenance ? "text-amber-800" : "text-magenta-700"
                        )}
                      >
                        {item.senderName || (isBroadcast || isMaintenance ? "Platform Administrator" : item.category)}
                      </span>
                      {isMaintenance && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 shrink-0">
                          <AlertTriangle className="w-3 h-3 text-amber-600" />
                          High Priority
                        </span>
                      )}
                    </div>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-gray-500 whitespace-nowrap">{timeAgo(item.timestamp)}</span>
                      {!item.isRead && (
                        <span
                          className={cn(
                            "w-2 h-2 rounded-full",
                            isMaintenance ? "bg-amber-500" : "bg-magenta-600"
                          )}
                        />
                      )}
                    </span>
                  </div>

                  <p className="text-sm font-semibold text-gray-900 mt-0.5">{item.title}</p>
                  <p className="text-sm text-gray-600 leading-relaxed mt-0.5 break-words">{item.message}</p>

                  {/* Branch badge for cross-branch notifications */}
                  {item.metadata?.branch_name && isAppointmentRequest && (
                    <span className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                      {item.metadata.branch_name}
                    </span>
                  )}

                  {targetLink && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleItemClick();
                      }}
                      className={cn(
                        "mt-2 inline-flex items-center gap-1 text-sm font-medium transition-colors cursor-pointer",
                        isMaintenance
                          ? "text-amber-800 hover:text-amber-900"
                          : "text-magenta-700 hover:text-magenta-800"
                      )}
                    >
                      <span>{actionLabel}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Link */}
      {isDropdown && (
        <div className="border-t border-gray-200 px-5 py-3 bg-gray-50 text-center">
          <Link
            to="/doctor/appointments"
            onClick={onClose}
            className="text-sm font-medium text-magenta-700 hover:text-magenta-800 transition-colors"
          >
            Go to Doctor Review Table →
          </Link>
        </div>
      )}
    </div>
  );
}