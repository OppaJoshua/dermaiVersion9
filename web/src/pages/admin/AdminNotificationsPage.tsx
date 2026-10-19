import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  Building2,
  Scan,
  CreditCard,
  UserPlus,
  HelpCircle,
  ArrowRight,
  CheckCheck,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { logAdminAction } from "@/lib/auditLog";
import { supabase } from "@/lib/supabaseClient";
import { useRoleNotifications, type NotificationItem } from "@/lib/notificationService";

function AdminNotifAvatar({ item }: { item: NotificationItem }) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [item.senderAvatar]);

  const getBadgeIcon = () => {
    if (item.category === "clinic") return <Building2 className="w-2.5 h-2.5 text-amber-600" />;
    if (item.category === "ticket") return <HelpCircle className="w-2.5 h-2.5 text-purple-600" />;
    if (item.category === "scan") return <Scan className="w-2.5 h-2.5 text-cyan-600" />;
    if (item.category === "subscription") return <CreditCard className="w-2.5 h-2.5 text-blue-600" />;
    if (item.category === "user") return <UserPlus className="w-2.5 h-2.5 text-emerald-600" />;
    return <Bell className="w-2.5 h-2.5 text-magenta-600" />;
  };

  const getMainIcon = () => {
    if (item.category === "clinic") return <Building2 className="w-5 h-5 text-amber-600" />;
    if (item.category === "ticket") return <HelpCircle className="w-5 h-5 text-purple-600" />;
    if (item.category === "scan") return <Scan className="w-5 h-5 text-cyan-600" />;
    if (item.category === "subscription") return <CreditCard className="w-5 h-5 text-blue-600" />;
    if (item.category === "user") return <UserPlus className="w-5 h-5 text-emerald-600" />;
    return <Bell className="w-5 h-5 text-magenta-600" />;
  };

  const hasAvatar = Boolean(item.senderAvatar && item.senderAvatar.trim() !== "");

  return (
    <div className="relative shrink-0 w-11 h-11">
      {hasAvatar && !imgError ? (
        <img
          src={item.senderAvatar!}
          alt={item.senderName || item.category || "User"}
          referrerPolicy="no-referrer"
          className="w-11 h-11 rounded-2xl object-cover border border-slate-200/90 shadow-2xs bg-white"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="w-11 h-11 rounded-2xl bg-gray-100/90 flex items-center justify-center border border-gray-200/60 shadow-2xs">
          {getMainIcon()}
        </div>
      )}

      {/* Action category badge pinned to bottom right */}
      <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white border border-gray-200/90 flex items-center justify-center shadow-xs">
        {getBadgeIcon()}
      </span>
    </div>
  );
}

export interface AdminNotificationsProps {
  onClose?: () => void;
  isDropdown?: boolean;
}

export function AdminNotifications({ onClose, isDropdown = false }: AdminNotificationsProps) {
  const { notifications, loading, unreadCount, markRead, markAllRead } = useRoleNotifications("admin", {});

  const [activeTab, setActiveTab] = useState<
    "all" | "clinic" | "ticket" | "scan" | "subscription" | "user"
  >("all");

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

  return (
    <div className={cn("flex flex-col bg-white", isDropdown ? "w-full max-h-[520px]" : "w-full rounded-2xl border border-gray-100 shadow-sm")}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 bg-gray-50/50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-magenta-50 flex items-center justify-center text-magenta-600">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">Admin Notification Center</h3>
            <p className="text-[11px] text-gray-500">
              {unreadCount > 0 ? `${unreadCount} unread system event${unreadCount > 1 ? "s" : ""}` : "All platform events reviewed"}
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
          { key: "all", label: "All Events" },
          { key: "clinic", label: "Clinics" },
          { key: "ticket", label: "Tickets" },
          { key: "scan", label: "AI Scans & Reviews" },
          { key: "subscription", label: "Billing & Plans" },
          { key: "user", label: "New Users" },
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
            <p className="text-xs">Fetching system events from live database…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 px-6 text-center text-gray-400">
            <Bell className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p className="text-sm font-semibold text-gray-700">No events found</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {activeTab === "all"
                ? "All caught up! New clinic applications, tickets, scans, and billing events will appear here."
                : `No events recorded under ${activeTab}.`}
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
              {/* Real profile picture / logo with category badge */}
              <AdminNotifAvatar item={item} />

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
                    <span>Inspect record</span>
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
              </div>

              {/* Unread dot */}
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
            to="/admin/notifications"
            onClick={onClose}
            className="text-xs font-semibold text-magenta-600 hover:text-magenta-800 transition-colors"
          >
            Open Full Admin Notifications Log →
          </Link>
        </div>
      )}
    </div>
  );
}

type Broadcast = {
  id: string;
  title: string;
  message: string;
  audience: "All Users" | "Premium Only" | "Free Only";
  sentAt: string;
};

const seedAlerts: Array<{ id: string; title: string; text: string; level: string }> = [];

export default function AdminNotificationsPage() {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [, setSending] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState<"All Users" | "Premium Only" | "Free Only">("All Users");

  const sendBroadcast = async () => {
    if (!title.trim() || !message.trim()) return;
    setSending(true);
    try {
      const { data: users } = await supabase.from("user").select("user_id").limit(100);
      if (users && users.length > 0) {
        const notifRows = users.map((u) => ({
          user_id: u.user_id,
          type: "broadcast",
          title: title.trim(),
          body: message.trim(),
        }));
        await supabase.from("user_notification").insert(notifRows);
      }

      const newBroadcast: Broadcast = {
        id: `bcast-${Date.now()}`,
        title: title.trim(),
        message: message.trim(),
        audience,
        sentAt: new Date().toISOString(),
      };
      setBroadcasts((prev) => [newBroadcast, ...prev]);
      logAdminAction("Broadcast Sent", audience, `"${title.trim()}" sent to ${audience}.`, "system");
      setTitle("");
      setMessage("");
      setAudience("All Users");
    } catch {
      /* ignore */
    } finally {
      setSending(false);
    }
  };

  const canSend = Boolean(title.trim() && message.trim());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-display font-semibold text-gray-900">Notifications</h1>
        <p className="text-sm text-gray-500 mt-1">Live administrative alerts, verification requests, and platform announcements.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Consolidated Admin Notifications Feed */}
        <div className="lg:col-span-2">
          <AdminNotifications />
        </div>

        {/* Side column */}
        <div className="space-y-6">
          {/* Broadcast composer */}
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900">Send broadcast</h2>
            <p className="text-xs text-gray-500 mt-0.5">Deliver an announcement to users.</p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Scheduled maintenance"
                  className="w-full px-3.5 py-2 rounded-md border border-gray-300 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Audience</label>
                <select
                  value={audience}
                  onChange={(e) => setAudience(e.target.value as typeof audience)}
                  className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm text-gray-900 outline-none focus:border-magenta-500 bg-white"
                >
                  <option>All Users</option>
                  <option>Premium Only</option>
                  <option>Free Only</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Message</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Write your announcement"
                  rows={4}
                  className="w-full px-3.5 py-2 rounded-md border border-gray-300 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 resize-none"
                />
              </div>
              <button
                onClick={sendBroadcast}
                disabled={!canSend}
                className={cn(
                  "w-full px-4 py-2.5 rounded-md text-sm font-medium transition-colors",
                  canSend
                    ? "bg-magenta-600 text-white hover:bg-magenta-700 cursor-pointer"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                )}
              >
                Send broadcast
              </button>
            </div>
          </div>

          {/* Sent broadcasts */}
          {broadcasts.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200">
              <h2 className="px-5 py-3.5 text-sm font-semibold text-gray-900 border-b border-gray-200">Sent this session</h2>
              <ul className="divide-y divide-gray-100">
                {broadcasts.map((b) => (
                  <li key={b.id} className="px-5 py-3.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-medium text-gray-900">{b.title}</p>
                      <span className="text-xs text-gray-500 shrink-0">{b.audience}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-gray-600 leading-relaxed">{b.message}</p>
                    <p className="mt-1 text-xs text-gray-400">{new Date(b.sentAt).toLocaleString()}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* System quality alerts */}
          <div className="bg-white rounded-lg border border-gray-200">
            <h2 className="px-5 py-3.5 text-sm font-semibold text-gray-900 border-b border-gray-200">System quality alerts</h2>
            <div className="px-5 py-4">
              {seedAlerts.length === 0 && (
                <p className="text-sm text-gray-500">No alerts at this time.</p>
              )}
              <div className="space-y-2">
                {seedAlerts.map((alert) => (
                  <div key={alert.id} className="border-l-2 border-amber-400 pl-3 py-0.5">
                    <p className="text-sm font-medium text-gray-900">{alert.title}</p>
                    <p className="text-sm text-gray-600 mt-0.5">{alert.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
