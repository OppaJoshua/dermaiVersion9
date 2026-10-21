import { useState, useEffect, useCallback, useMemo } from "react";
import {
  X,
  Loader2,
  MessageSquare,
  AlertCircle,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  type HelpdeskTicket,
  type HelpdeskTicketStatus,
  getHelpdeskTicketsAsync,
  updateHelpdeskTicketStatus,
  deleteHelpdeskTicketAsync,
} from "@/lib/store";
import { supabase } from "@/lib/supabaseClient";
import { ModalPortal } from "@/components/common/ModalPortal";

type FilterStatus = "all" | "pending" | "open" | "in_progress" | "resolved";

const statusConfig: Record<
  string,
  { label: string; pill: string }
> = {
  pending: { label: "Pending", pill: "bg-amber-50 border-amber-200 text-amber-800" },
  open: { label: "Open", pill: "bg-magenta-50 border-magenta-200 text-magenta-900" },
  in_progress: { label: "In Progress", pill: "bg-blue-50 border-blue-200 text-blue-800" },
  "in-progress": { label: "In Progress", pill: "bg-blue-50 border-blue-200 text-blue-800" },
  resolved: { label: "Resolved", pill: "bg-emerald-50 border-emerald-200 text-emerald-800" },
  closed: { label: "Resolved", pill: "bg-emerald-50 border-emerald-200 text-emerald-800" },
};

const priorityLabel: Record<string, { label: string; cls: string }> = {
  urgent: { label: "Urgent", cls: "bg-magenta-50 border-magenta-300 text-black" },
  high: { label: "High", cls: "bg-magenta-50 border-magenta-200 text-black" },
  medium: { label: "Medium", cls: "bg-gray-50 border-gray-200 text-black" },
  low: { label: "Low", cls: "bg-gray-50 border-gray-200 text-black" },
};

const CATEGORIES = [
  "General Support",
  "Patient Support",
  "Clinic Support",
  "Doctor Clinical Support",
  "Billing & Subscription",
  "AI Skin Scan Issue",
  "Clinic Booking",
  "Technical Support",
];

function StatusPill({ status }: { status?: string }) {
  const normalized = (status || "pending").toLowerCase();
  const cfg = statusConfig[normalized] || statusConfig.pending;
  return (
    <span
      className={cn(
        "inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border",
        cfg.pill
      )}
    >
      {cfg.label}
    </span>
  );
}

function SenderAvatar({
  name,
  avatarUrl,
  size = "sm",
}: {
  name?: string;
  avatarUrl?: string;
  size?: "sm" | "md";
}) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [avatarUrl]);

  const initial = (name || "U").trim().charAt(0).toUpperCase() || "U";

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={name || "Sender"}
        className={cn(
          "rounded-full object-cover shrink-0 border border-gray-200",
          size === "sm" ? "w-10 h-10" : "w-12 h-12"
        )}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded-full font-semibold flex items-center justify-center shrink-0 bg-gray-100 text-black",
        size === "sm" ? "w-10 h-10 text-sm" : "w-12 h-12 text-base"
      )}
    >
      {initial}
    </div>
  );
}

// Maps a stored status onto the value used by the modal's status controls.
// Reflects exactly what the database holds (no defaulting pending -> open).
function toModalStatus(status: HelpdeskTicketStatus): HelpdeskTicketStatus {
  if (status === "in-progress") return "in_progress";
  if (status === "closed") return "resolved";
  return status;
}

export default function AdminHelpdeskPage() {
  const [tickets, setTickets] = useState<HelpdeskTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  // Admin reply draft state for modal
  const [replyText, setReplyText] = useState("");
  const [modalStatus, setModalStatus] = useState<HelpdeskTicketStatus>("open");
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [replySuccess, setReplySuccess] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchTickets = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    try {
      const data = await getHelpdeskTicketsAsync(undefined, { requireDatabase: true });
      setTickets(data);
      setFetchError(null);
    } catch (err) {
      console.error("Failed to load helpdesk tickets:", err);
      setFetchError(
        err && typeof err === "object" && "message" in err
          ? String(err.message)
          : "Unable to load support tickets from the database. Please try again."
      );
    } finally {
      setLoading(false);
      if (isManualRefresh) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchTickets();

    // Realtime channel
    const channel = supabase
      .channel("admin-helpdesk-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_support_ticket" },
        () => fetchTickets()
      )
      .subscribe();

    // Local & Cross-Tab custom events
    const handleUpdate = () => fetchTickets();
    window.addEventListener("dermai_tickets_updated", handleUpdate);
    window.addEventListener("dermai_doctor_avatar_updated", handleUpdate);
    window.addEventListener("dermai_doctor_profile_updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("dermai_tickets_updated", handleUpdate);
      window.removeEventListener("dermai_doctor_avatar_updated", handleUpdate);
      window.removeEventListener("dermai_doctor_profile_updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, [fetchTickets]);

  const selectedTicket = useMemo(
    () => tickets.find((t) => t.id === selectedTicketId) || null,
    [tickets, selectedTicketId]
  );

  // Sync draft reply and exact status when selected ticket changes
  useEffect(() => {
    if (selectedTicketId) {
      const current = tickets.find((t) => t.id === selectedTicketId);
      if (current) {
        setReplyText(current.response || "");
        setReplySuccess(false);
        setModalStatus(toModalStatus(current.status));
      }
    }
  }, [selectedTicketId]);

  // Derived category list
  const categories = useMemo(() => {
    const set = new Set<string>();
    CATEGORIES.forEach((c) => set.add(c));
    tickets.forEach((t) => {
      if (t.category) set.add(t.category);
    });
    return Array.from(set);
  }, [tickets]);

  // Filtered tickets
  const filteredTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      if (!ticket) return false;
      const status = ticket.status || "pending";
      const category = ticket.category || "General Support";
      const subject = ticket.subject || "";
      const message = ticket.message || "";
      const user = ticket.user || "Platform User";
      const email = ticket.email || "";
      const id = ticket.id || "";

      const matchesStatus =
        statusFilter === "all" ||
        status === statusFilter ||
        (statusFilter === "in_progress" && status === "in-progress");
      const matchesCategory =
        categoryFilter === "all" ||
        category.toLowerCase() === categoryFilter.toLowerCase();
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        subject.toLowerCase().includes(q) ||
        message.toLowerCase().includes(q) ||
        user.toLowerCase().includes(q) ||
        email.toLowerCase().includes(q) ||
        id.toLowerCase().includes(q);

      return matchesStatus && matchesCategory && matchesSearch;
    });
  }, [tickets, statusFilter, categoryFilter, searchQuery]);

  // Counts
  const totalCount = tickets.length;
  const pendingCount = tickets.filter((t) => t.status === "pending").length;
  const openCount = tickets.filter((t) => t.status === "open").length;
  const inProgressCount = tickets.filter(
    (t) => t.status === "in_progress" || (t.status as string) === "in-progress"
  ).length;
  const resolvedCount = tickets.filter(
    (t) => t.status === "resolved" || (t.status as string) === "closed"
  ).length;

  // Handler when opening a ticket to view
  const handleViewTicket = async (ticket: HelpdeskTicket) => {
    setSelectedTicketId(ticket.id);
    setActionError(null);
    setReplySuccess(false);

    setModalStatus(toModalStatus(ticket.status));

    // A 'pending' ticket becomes 'open' only once an admin actually views it, and the
    // modal switches to 'open' only after the database has confirmed the change.
    if (ticket.status === "pending") {
      try {
        await updateHelpdeskTicketStatus(ticket.id, "open", undefined, {
          ticketSubject: ticket.subject,
          ticketUserId: ticket.userId,
          previousStatus: ticket.status,
        });
        setModalStatus("open");
        setTickets((prev) =>
          prev.map((t) => (t.id === ticket.id ? { ...t, status: "open" } : t))
        );
      } catch (err) {
        console.warn("Auto-transition pending to open warning:", err);
      }
    }
  };

  // Actions
  const handleStatusChange = async (id: string, newStatus: HelpdeskTicketStatus) => {
    setActionError(null);
    setReplySuccess(false);
    const persistedStatus = toModalStatus(
      tickets.find((t) => t.id === id)?.status ?? modalStatus
    );
    setModalStatus(newStatus);

    try {
      await updateHelpdeskTicketStatus(
        id,
        newStatus,
        replyText.trim() || undefined,
        {
          ticketSubject: selectedTicket?.subject,
          ticketUserId: selectedTicket?.userId,
          previousStatus: selectedTicket?.status,
        }
      );
      setTickets((prev) =>
        prev.map((ticket) =>
          ticket.id === id ? { ...ticket, status: newStatus } : ticket
        )
      );
    } catch (err) {
      console.error("Failed to update ticket status:", err);
      // The save failed, so show the status that is actually stored.
      setModalStatus(persistedStatus);
      setActionError(
        err instanceof Error
          ? err.message
          : "Unable to update the ticket status. Please try again."
      );
    }
  };

  const handleSaveReply = async (resolveTicket = false) => {
    if (!selectedTicket) return;
    setActionError(null);
    setReplySubmitting(true);
    const targetStatus: HelpdeskTicketStatus = resolveTicket ? "resolved" : modalStatus;
    try {
      await updateHelpdeskTicketStatus(
        selectedTicket.id,
        targetStatus,
        replyText.trim(),
        {
          ticketSubject: selectedTicket.subject,
          ticketUserId: selectedTicket.userId,
          previousStatus: selectedTicket.status,
        }
      );
      setTickets((prev) =>
        prev.map((t) =>
          t.id === selectedTicket.id
            ? { ...t, status: targetStatus, response: replyText.trim() }
            : t
        )
      );
      setModalStatus(targetStatus);
      setReplySuccess(true);
      setTimeout(() => setReplySuccess(false), 3000);
      if (resolveTicket) {
        setSelectedTicketId(null);
      }
    } catch (err) {
      console.error("Failed to update response:", err);
      setReplySuccess(false);
      setActionError(
        err instanceof Error
          ? err.message
          : "Unable to save the response. Please try again."
      );
    } finally {
      setReplySubmitting(false);
    }
  };

  const handleDeleteTicket = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this ticket?")) return;

    setActionError(null);

    try {
      await deleteHelpdeskTicketAsync(id);
      setTickets((prev) => prev.filter((ticket) => ticket.id !== id));

      if (selectedTicketId === id) {
        setSelectedTicketId(null);
      }
    } catch (err) {
      console.error("Failed to delete ticket:", err);
      setActionError(
        err instanceof Error
          ? err.message
          : "Unable to delete the ticket. Please try again."
      );
    }
  };

  const statCards = [
    { id: "all", label: "Total tickets", count: totalCount, hint: "All received inquiries", Icon: MessageSquare },
    { id: "pending", label: "Pending", count: pendingCount, hint: "Awaiting admin review", Icon: AlertCircle },
    { id: "open", label: "Open", count: openCount, hint: "Actively viewed", Icon: Clock },
    { id: "in_progress", label: "In progress", count: inProgressCount, hint: "Being worked on", Icon: Clock },
    { id: "resolved", label: "Resolved", count: resolvedCount, hint: "Closed inquiries", Icon: CheckCircle2 },
  ] as const;

  return (
    <div className="space-y-8 pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-black">Helpdesk</h1>
          <p className="text-sm text-gray-600 mt-1">
            Support tickets submitted by patients, clinics, and doctors.
          </p>
        </div>
        <button
          onClick={() => fetchTickets(true)}
          disabled={refreshing || loading}
          className="self-start sm:self-auto px-5 py-2.5 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-black hover:bg-gray-50 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {refreshing || loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Stat cards (click to filter) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {statCards.map(({ id, label, count, hint, Icon }) => {
          const active = statusFilter === id;
          return (
            <button
              key={id}
              onClick={() => setStatusFilter(id)}
              className={cn(
                "text-left bg-white rounded-xl border p-7 min-h-[156px] shadow-sm transition-all cursor-pointer",
                active
                  ? "border-magenta-500 ring-2 ring-magenta-500/15"
                  : "border-gray-200 hover:border-gray-300"
              )}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-black">{label}</p>
                <Icon className="w-5 h-5 text-magenta-600" />
              </div>
              <p className="mt-5 text-4xl font-bold text-black tabular-nums">{count}</p>
              <p className="mt-2 text-sm text-gray-600">{hint}</p>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex flex-col md:flex-row md:items-center gap-4">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by ticket ID, sender, email, subject, or message"
            className="w-full px-4 py-3 text-sm rounded-lg border border-gray-300 bg-white text-black placeholder:text-gray-500 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/15"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-black"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="text-sm font-medium text-black">Category</span>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-4 py-3 text-sm rounded-lg border border-gray-300 bg-white text-black outline-none focus:border-magenta-500 cursor-pointer"
          >
            <option value="all">All categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tickets table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-7 py-5 border-b border-gray-200 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-black">Tickets</h2>
          <span className="text-sm text-gray-600">{filteredTickets.length} shown</span>
        </div>
        <div className="overflow-x-auto no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-black uppercase tracking-wider">
                <th className="px-7 py-4">Ticket</th>
                <th className="px-7 py-4">Sender</th>
                <th className="px-7 py-4">Subject</th>
                <th className="px-7 py-4">Date</th>
                <th className="px-7 py-4">Status</th>
                <th className="px-7 py-4 text-right"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm text-black">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-7 py-16 text-center text-gray-600">
                    <Loader2 className="w-6 h-6 text-magenta-600 animate-spin mx-auto mb-3" />
                    Loading tickets…
                  </td>
                </tr>
              ) : fetchError ? (
                <tr>
                  <td colSpan={6} className="px-7 py-16 text-center">
                    <div className="max-w-md mx-auto space-y-2">
                      <p className="text-base font-semibold text-black">Could not load support tickets</p>
                      <p role="alert" className="text-sm text-gray-700 break-words">{fetchError}</p>
                      <button
                        onClick={() => fetchTickets(true)}
                        disabled={refreshing || loading}
                        className="mt-2 px-5 py-2.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-black text-sm font-semibold cursor-pointer"
                      >
                        Retry
                      </button>
                    </div>
                  </td>
                </tr>
              ) : filteredTickets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-7 py-16 text-center">
                    <div className="max-w-sm mx-auto space-y-1">
                      <p className="text-base font-semibold text-black">No tickets found</p>
                      <p className="text-sm text-gray-600">
                        {searchQuery || statusFilter !== "all" || categoryFilter !== "all"
                          ? "No tickets match the selected filters."
                          : "No support tickets have been submitted yet. New inquiries will appear here."}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredTickets.map((ticket) => {
                  const priority = priorityLabel[ticket.priority] || priorityLabel.medium;

                  return (
                    <tr
                      key={ticket.id}
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => handleViewTicket(ticket)}
                    >
                      {/* Ticket ID */}
                      <td className="px-7 py-5 whitespace-nowrap">
                        <span className="inline-block px-2.5 py-1 rounded-md bg-gray-100 font-mono text-xs font-semibold text-black">
                          {ticket.id.length > 12 ? ticket.id.slice(0, 8).toUpperCase() : ticket.id}
                        </span>
                      </td>

                      {/* Sender */}
                      <td className="px-7 py-5">
                        <div className="flex items-center gap-3">
                          <SenderAvatar
                            name={ticket.user}
                            avatarUrl={ticket.avatarUrl}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <p className="font-semibold text-black truncate max-w-[170px]">
                              {ticket.user || "Platform User"}
                            </p>
                            <p className="text-xs text-gray-600 truncate max-w-[170px]">
                              {ticket.email || "No email"}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Subject */}
                      <td className="px-7 py-5 max-w-xs">
                        <p className="font-semibold text-black truncate">{ticket.subject}</p>
                        <p className="text-xs text-gray-600 mt-1 line-clamp-1">{ticket.message}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex px-2 py-0.5 rounded-md bg-gray-100 text-black text-[11px] font-medium">
                            {ticket.category}
                          </span>
                          {ticket.priority && ticket.priority !== "medium" && (
                            <span className={cn("inline-flex px-2 py-0.5 rounded-md border text-[11px] font-semibold", priority.cls)}>
                              {priority.label}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Date */}
                      <td className="px-7 py-5 text-black whitespace-nowrap">
                        {new Date(ticket.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>

                      {/* Status */}
                      <td className="px-7 py-5 whitespace-nowrap">
                        <StatusPill status={ticket.status} />
                        {ticket.response && (
                          <span className="block text-xs text-gray-600 mt-1.5">Replied</span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="px-7 py-5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleViewTicket(ticket)}
                          className="px-5 py-2 rounded-lg border border-magenta-300 text-magenta-700 text-sm font-semibold hover:bg-magenta-50 transition-colors cursor-pointer"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ticket detail modal */}
      <ModalPortal isOpen={Boolean(selectedTicket)}>
        <AnimatePresence>
          {selectedTicket && (
            <div
              className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
              onClick={() => setSelectedTicketId(null)}
            >
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 15 }}
                transition={{ duration: 0.15 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-gray-100 max-h-[82vh] flex flex-col overflow-hidden relative z-[9999]"
              >
              {/* Modal header */}
              <div className="flex items-start justify-between gap-4 px-6 sm:px-8 py-5 border-b border-gray-200 shrink-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="px-2.5 py-1 rounded-md bg-gray-100 font-mono text-xs font-semibold text-black">
                      {selectedTicket.id}
                    </span>
                    <StatusPill status={modalStatus} />
                    <span className="text-xs text-gray-600">
                      {new Date(selectedTicket.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <h2 className="mt-2 text-xl font-display font-bold text-black">
                    {selectedTicket.subject}
                  </h2>
                </div>

                <button
                  onClick={() => setSelectedTicketId(null)}
                  className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-black transition-colors"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="px-6 sm:px-8 py-5 space-y-4 overflow-y-auto no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden flex-1">
                {/* Sender card */}
                <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <SenderAvatar
                      name={selectedTicket.user}
                      avatarUrl={selectedTicket.avatarUrl}
                      size="md"
                    />
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-black truncate">{selectedTicket.user || "Platform User"}</p>
                      <p className="text-sm text-gray-600 truncate">{selectedTicket.email || "No email on record"}</p>
                    </div>
                  </div>
                  <span className="shrink-0 px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-medium text-black">
                    {selectedTicket.category}
                  </span>
                </div>

                {/* Inquiry */}
                <div>
                  <p className="text-sm font-semibold text-black mb-1.5">Inquiry</p>
                  <div className="rounded-xl bg-white border border-gray-200 px-4 py-3 text-sm text-black leading-relaxed whitespace-pre-wrap">
                    {selectedTicket.message}
                  </div>
                </div>

                {/* Status selector */}
                <div>
                  <p className="text-sm font-semibold text-black mb-1.5">Status</p>
                  <div className="grid grid-cols-3 gap-3">
                    {(["open", "in_progress", "resolved"] as const).map((statusKey) => {
                      const active =
                        modalStatus === statusKey ||
                        (statusKey === "in_progress" && (modalStatus as string) === "in-progress");
                      const label =
                        statusKey === "in_progress"
                          ? "In Progress"
                          : statusKey === "resolved"
                          ? "Resolved"
                          : "Open";

                      return (
                        <button
                          key={statusKey}
                          type="button"
                          onClick={() => handleStatusChange(selectedTicket.id, statusKey)}
                          className={cn(
                            "py-2.5 rounded-lg text-sm font-semibold border transition-colors cursor-pointer text-center",
                            active
                              ? statusKey === "in_progress"
                                ? "border-blue-500 bg-blue-50 text-blue-900 font-bold"
                                : statusKey === "resolved"
                                ? "border-emerald-500 bg-emerald-50 text-emerald-900 font-bold"
                                : "border-magenta-500 bg-magenta-50 text-magenta-900 font-bold"
                              : "bg-white border-gray-300 text-black hover:bg-gray-50"
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Response */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="admin-response" className="text-sm font-semibold text-black">
                      Response to user
                    </label>
                    {actionError && (
                      <p role="alert" className="text-xs text-rose-600 font-medium">
                        {actionError}
                      </p>
                    )}
                    {replySuccess && (
                      <span className="text-xs text-magenta-700 font-semibold">Response saved</span>
                    )}
                  </div>
                  <textarea
                    id="admin-response"
                    rows={3}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Write a resolution note or reply that will be shown to the user"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-300 text-sm text-black placeholder:text-gray-500 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/15 resize-none"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3 px-6 sm:px-8 py-4 border-t border-gray-200 bg-gray-50 rounded-b-2xl shrink-0">
                <button
                  onClick={() => handleDeleteTicket(selectedTicket.id)}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-lg text-sm font-semibold text-black hover:bg-gray-200/70 transition-colors cursor-pointer"
                >
                  Delete ticket
                </button>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <button
                    onClick={() => handleSaveReply(false)}
                    disabled={replySubmitting}
                    className="flex-1 sm:flex-none px-5 py-2.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-black text-sm font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    Save note
                  </button>

                  <button
                    onClick={() => handleSaveReply(true)}
                    disabled={replySubmitting}
                    className="flex-1 sm:flex-none px-5 py-2.5 rounded-lg bg-magenta-600 hover:bg-magenta-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {selectedTicket.status === "resolved" ? "Save & close" : "Resolve & reply"}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
        </AnimatePresence>
      </ModalPortal>
    </div>
  );
}