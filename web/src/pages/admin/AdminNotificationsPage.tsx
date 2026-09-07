import { useState, useEffect } from "react";
import { Bell, CheckCircle2, Filter, AlertTriangle, Send, Megaphone, CreditCard, HelpCircle, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { logAdminAction } from "@/lib/auditLog";
import { supabase } from "@/lib/supabaseClient";

type Broadcast = {
    id: string;
    title: string;
    message: string;
    audience: "All Users" | "Premium Only" | "Free Only";
    sentAt: string;
};

type AdminNotification = {
    id: string;
    type: "clinic-approved" | "clinic-rejected" | "new-subscription" | "new-ticket";
    title?: string;
    clinicName?: string;
    message: string;
    timestamp: string;
};

type FilterType = "all" | "clinic-approved" | "clinic-rejected" | "new-subscription" | "new-ticket";

const seedAlerts: Array<{ id: string; title: string; text: string; level: string }> = [];

export default function AdminNotificationsPage() {
    const [filter, setFilter] = useState<FilterType>("all");
    const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
    const [notifications, setNotifications] = useState<AdminNotification[]>([]);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [title, setTitle] = useState("");
    const [message, setMessage] = useState("");
    const [audience, setAudience] = useState<"All Users" | "Premium Only" | "Free Only">("All Users");

    const fetchNotifications = async () => {
        setLoading(true);
        try {
            const list: AdminNotification[] = [];

            // 1. Fetch from user_notification
            const { data: notifs } = await supabase
                .from("user_notification")
                .select("notif_id, type, title, body, created_at")
                .order("created_at", { ascending: false })
                .limit(25);

            if (notifs) {
                notifs.forEach((n) => {
                    let mappedType: AdminNotification["type"] = "new-ticket";
                    if (n.type?.includes("clinic")) {
                        mappedType = n.type.includes("reject") ? "clinic-rejected" : "clinic-approved";
                    } else if (n.type?.includes("sub") || n.type?.includes("plan")) {
                        mappedType = "new-subscription";
                    }
                    list.push({
                        id: n.notif_id,
                        type: mappedType,
                        title: n.title,
                        message: n.body || "",
                        timestamp: n.created_at,
                    });
                });
            }

            // 2. Fetch recent support tickets
            const { data: tickets } = await supabase
                .from("user_support_ticket")
                .select("ticket_id, subject, message, created_at")
                .order("created_at", { ascending: false })
                .limit(10);

            if (tickets) {
                tickets.forEach((t) => {
                    list.push({
                        id: t.ticket_id,
                        type: "new-ticket",
                        title: `Support Ticket: ${t.subject}`,
                        message: t.message,
                        timestamp: t.created_at,
                    });
                });
            }

            // 3. Fetch recent clinics
            const { data: clinics } = await supabase
                .from("clinic")
                .select("clinic_id, name, status")
                .in("status", ["approved", "rejected"])
                .limit(10);

            if (clinics) {
                clinics.forEach((c) => {
                    list.push({
                        id: c.clinic_id,
                        type: c.status === "approved" ? "clinic-approved" : "clinic-rejected",
                        clinicName: c.name,
                        message: `Clinic status set to ${c.status}.`,
                        timestamp: new Date().toISOString(),
                    });
                });
            }

            // Sort by timestamp
            list.sort((a, b) => (new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
            setNotifications(list);
        } catch {
            setNotifications([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchNotifications();
    }, []);

    const sendBroadcast = async () => {
        if (!title.trim() || !message.trim())
            return;
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
            await fetchNotifications();
        } catch {
            /* ignore */
        } finally {
            setSending(false);
        }
    };

    const filtered = notifications.filter((n) => filter === "all" || n.type === filter);
    return (<div>
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-gray-900">Notifications</h1>
        <p className="text-sm text-gray-400 mt-0.5">Clinic approvals, system alerts, and broadcast announcements</p>
      </div>

      {/* Broadcast Section */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-5">
        <div className="flex items-center gap-2 mb-4">
          <Megaphone className="w-4 h-4 text-magenta-500"/>
          <h2 className="text-sm font-semibold text-gray-900">Send Broadcast Announcement</h2>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">Title</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Scheduled Maintenance" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-magenta-500"/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">Audience</label>
              <select value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 bg-white">
                <option>All Users</option>
                <option>Premium Only</option>
                <option>Free Only</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Message</label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Write your announcement message here..." rows={3} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-magenta-500 resize-none"/>
          </div>
          <button onClick={sendBroadcast} disabled={!title.trim() || !message.trim()} className={cn("flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-colors", title.trim() && message.trim()
            ? "bg-magenta-500 text-white hover:bg-magenta-600 shadow-md shadow-magenta-500/20"
            : "bg-gray-100 text-gray-400 cursor-not-allowed")}>
            <Send className="w-4 h-4"/> Send Broadcast
          </button>
        </div>
      </div>

      {/* Sent Broadcasts */}
      {broadcasts.length > 0 && (<div className="bg-white rounded-2xl border border-gray-100 p-5 mb-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Sent Broadcasts</h2>
          <div className="space-y-2">
            {broadcasts.map((b) => (<div key={b.id} className="rounded-xl bg-magenta-50 border border-magenta-100 px-4 py-3">
                <div className="flex items-center justify-between mb-0.5">
                  <p className="text-xs font-semibold text-magenta-800">{b.title}</p>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-magenta-100 text-magenta-600">
                    {b.audience}
                  </span>
                </div>
                <p className="text-xs text-magenta-700 leading-relaxed">{b.message}</p>
                <p className="text-[10px] text-magenta-400 mt-1">
                  {new Date(b.sentAt).toLocaleString()}
                </p>
              </div>))}
          </div>
        </div>)}

      <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-5 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-magenta-500"/>
          <p className="text-sm font-semibold text-gray-800">Filter</p>
        </div>
        <div className="flex gap-2">
          {([
            { key: "all", label: "All" },
            { key: "new-ticket", label: "Support Tickets" },
            { key: "new-subscription", label: "Subscriptions" },
            { key: "clinic-approved", label: "Approved" },
            { key: "clinic-rejected", label: "Rejected" },
        ] as const).map((tab) => (<button key={tab.key} onClick={() => setFilter(tab.key)} className={`px-4 py-2 rounded-full text-xs font-semibold transition-colors ${filter === tab.key
                ? "bg-magenta-500 text-white"
                : "bg-magenta-50 text-magenta-700 hover:bg-magenta-100"}`}>
              {tab.label}
            </button>))}
        </div>
      </div>

      <div className="space-y-3 mb-6">
        {loading ? (
          <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center">
            <Loader2 className="w-8 h-8 text-magenta-500 animate-spin mx-auto mb-2" />
            <p className="text-sm text-gray-400">Loading notifications...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-dashed border-magenta-200 rounded-2xl p-8 text-center">
            <Bell className="w-8 h-8 text-magenta-300 mx-auto mb-2"/>
            <p className="text-sm text-magenta-500">No notifications found.</p>
          </div>
        ) : null}

        {filtered.map((item, i) => (<motion.div key={item.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="bg-white border border-magenta-100 rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${item.type === "clinic-approved"
                ? "bg-green-100"
                : item.type === "new-subscription"
                    ? "bg-blue-100"
                    : item.type === "new-ticket"
                        ? "bg-purple-100"
                        : "bg-red-100"}`}>
                {item.type === "new-subscription" ? (<CreditCard className="w-5 h-5 text-blue-700"/>) : item.type === "new-ticket" ? (<HelpCircle className="w-5 h-5 text-purple-700"/>) : (<CheckCircle2 className={`w-5 h-5 ${item.type === "clinic-approved" ? "text-green-700" : "text-red-700"}`}/>)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">
                  {item.title || item.clinicName}
                </p>
                <p className="text-xs text-gray-600 mt-0.5">{item.message}</p>
                <p className="text-[11px] text-gray-400 mt-1.5">{new Date(item.timestamp).toLocaleString()}</p>
              </div>
            </div>
          </motion.div>))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3 inline-flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500"/> System Quality Alerts
        </h2>
        <div className="space-y-2">
          {seedAlerts.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">No system quality alerts at this time.</p>
          )}
          {seedAlerts.map((alert) => (<div key={alert.id} className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5">
              <p className="text-xs font-semibold text-amber-800">{alert.title}</p>
              <p className="text-xs text-amber-700 mt-0.5">{alert.text}</p>
            </div>))}
        </div>
      </div>
    </div>);
}
