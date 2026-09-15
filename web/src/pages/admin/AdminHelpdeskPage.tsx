import { useState, useEffect, useCallback, useMemo } from "react";
import {
  X,
  MessageSquare,
  Loader2,
  Search,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertCircle,
  Trash2,
  Send,
  User,
  Tag,
  Building2,
  Stethoscope,
  ChevronRight,
  ShieldCheck,
  Check,
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

type FilterStatus = "all" | HelpdeskTicketStatus;

const statusConfig: Record<
  HelpdeskTicketStatus,
  { label: string; bg: string; text: string; border: string; icon: typeof CheckCircle2 }
> = {
  open: {
    label: "Open",
    bg: "bg-rose-50",
    text: "text-rose-600",
    border: "border-rose-200",
    icon: AlertCircle,
  },
  "in-progress": {
    label: "In Progress",
    bg: "bg-amber-50",
    text: "text-amber-600",
    border: "border-amber-200",
    icon: Clock,
  },
  resolved: {
    label: "Resolved",
    bg: "bg-emerald-50",
    text: "text-emerald-600",
    border: "border-emerald-200",
    icon: CheckCircle2,
  },
};

const priorityBadge: Record<string, { bg: string; text: string }> = {
  urgent: { bg: "bg-red-100 text-red-700", text: "Urgent" },
  high: { bg: "bg-orange-100 text-orange-700", text: "High" },
  medium: { bg: "bg-blue-50 text-blue-600", text: "Medium" },
  low: { bg: "bg-slate-100 text-slate-600", text: "Low" },
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

export default function AdminHelpdeskPage() {
  const [tickets, setTickets] = useState<HelpdeskTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  // Admin reply draft state for modal
  const [replyText, setReplyText] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [replySuccess, setReplySuccess] = useState(false);

  const fetchTickets = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    try {
      const data = await getHelpdeskTicketsAsync();
      setTickets(data);
    } catch (err) {
      console.error("Failed to load helpdesk tickets:", err);
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
    window.addEventListener("storage", handleUpdate);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("dermai_tickets_updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, [fetchTickets]);

  const selectedTicket = useMemo(
    () => tickets.find((t) => t.id === selectedTicketId) || null,
    [tickets, selectedTicketId]
  );

  // Sync draft reply when selected ticket changes
  useEffect(() => {
    if (selectedTicket) {
      setReplyText(selectedTicket.response || "");
      setReplySuccess(false);
    }
  }, [selectedTicket]);

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
      const status = ticket.status || "open";
      const category = ticket.category || "General Support";
      const subject = ticket.subject || "";
      const message = ticket.message || "";
      const user = ticket.user || "Platform User";
      const email = ticket.email || "";
      const id = ticket.id || "";

      const matchesStatus =
        statusFilter === "all" || status === statusFilter;
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
  const openCount = tickets.filter((t) => t.status === "open").length;
  const inProgressCount = tickets.filter((t) => t.status === "in-progress").length;
  const resolvedCount = tickets.filter((t) => t.status === "resolved").length;

  // Actions
  const handleStatusChange = async (id: string, newStatus: HelpdeskTicketStatus) => {
    setTickets((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t))
    );
    await updateHelpdeskTicketStatus(id, newStatus);
  };

  const handleSaveReply = async (resolveTicket = false) => {
    if (!selectedTicket) return;
    setReplySubmitting(true);
    const targetStatus = resolveTicket ? "resolved" : selectedTicket.status;
    try {
      await updateHelpdeskTicketStatus(
        selectedTicket.id,
        targetStatus,
        replyText.trim()
      );
      setTickets((prev) =>
        prev.map((t) =>
          t.id === selectedTicket.id
            ? { ...t, status: targetStatus, response: replyText.trim() }
            : t
        )
      );
      setReplySuccess(true);
      setTimeout(() => setReplySuccess(false), 3000);
      if (resolveTicket) {
        setSelectedTicketId(null);
      }
    } catch (err) {
      console.error("Failed to update response:", err);
    } finally {
      setReplySubmitting(false);
    }
  };

  const handleDeleteTicket = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this ticket?")) return;
    setTickets((prev) => prev.filter((t) => t.id !== id));
    if (selectedTicketId === id) setSelectedTicketId(null);
    await deleteHelpdeskTicketAsync(id);
  };

  const getCategoryIcon = (category: string) => {
    const cat = category.toLowerCase();
    if (cat.includes("clinic")) return Building2;
    if (cat.includes("doctor") || cat.includes("clinical")) return Stethoscope;
    if (cat.includes("billing") || cat.includes("plan")) return ShieldCheck;
    return User;
  };

  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900 flex items-center gap-2.5">
            <MessageSquare className="w-6 h-6 text-magenta-600" />
            Helpdesk &amp; Support Tickets
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Real support tickets received from patients, clinics, and doctors.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchTickets(true)}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors shadow-xs cursor-pointer"
          >
            <RefreshCw className={cn("w-3.5 h-3.5 text-gray-500", (refreshing || loading) && "animate-spin")} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          onClick={() => setStatusFilter("all")}
          className={cn(
            "bg-white rounded-2xl p-4 border transition-all cursor-pointer shadow-xs",
            statusFilter === "all" ? "border-magenta-500 ring-2 ring-magenta-500/10" : "border-gray-100 hover:border-gray-200"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500">Total Tickets</span>
            <Tag className="w-4 h-4 text-gray-400" />
          </div>
          <p className="text-2xl font-display font-bold text-gray-900 mt-2">{totalCount}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">All real received inquiries</p>
        </div>

        <div
          onClick={() => setStatusFilter("open")}
          className={cn(
            "bg-white rounded-2xl p-4 border transition-all cursor-pointer shadow-xs",
            statusFilter === "open" ? "border-rose-500 ring-2 ring-rose-500/10" : "border-gray-100 hover:border-gray-200"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-rose-600">Open Tickets</span>
            <AlertCircle className="w-4 h-4 text-rose-500" />
          </div>
          <p className="text-2xl font-display font-bold text-rose-600 mt-2">{openCount}</p>
          <p className="text-[11px] text-rose-400 mt-0.5">Requires attention</p>
        </div>

        <div
          onClick={() => setStatusFilter("in-progress")}
          className={cn(
            "bg-white rounded-2xl p-4 border transition-all cursor-pointer shadow-xs",
            statusFilter === "in-progress" ? "border-amber-500 ring-2 ring-amber-500/10" : "border-gray-100 hover:border-gray-200"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-600">In Progress</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-display font-bold text-amber-600 mt-2">{inProgressCount}</p>
          <p className="text-[11px] text-amber-500 mt-0.5">Under investigation</p>
        </div>

        <div
          onClick={() => setStatusFilter("resolved")}
          className={cn(
            "bg-white rounded-2xl p-4 border transition-all cursor-pointer shadow-xs",
            statusFilter === "resolved" ? "border-emerald-500 ring-2 ring-emerald-500/10" : "border-gray-100 hover:border-gray-200"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-600">Resolved</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-display font-bold text-emerald-600 mt-2">{resolvedCount}</p>
          <p className="text-[11px] text-emerald-500 mt-0.5">Resolved inquiries</p>
        </div>
      </div>

      {/* Search & Filter Controls */}
      <div className="bg-white rounded-2xl border border-gray-200/80 p-4 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search bar */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Ticket ID, sender name, email, subject, or message..."
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-gray-200 text-gray-900 placeholder:text-gray-400 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Category Dropdown */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-gray-500 font-medium">Category:</span>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-xl border border-gray-200 bg-white text-gray-700 outline-none focus:border-magenta-500 font-medium cursor-pointer"
            >
              <option value="all">All Categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-gray-100">
          {(
            [
              { id: "all", label: "All Tickets", count: totalCount },
              { id: "open", label: "Open", count: openCount },
              { id: "in-progress", label: "In Progress", count: inProgressCount },
              { id: "resolved", label: "Resolved", count: resolvedCount },
            ] as const
          ).map((tab) => {
            const isActive = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer",
                  isActive
                    ? "bg-magenta-600 text-white shadow-xs"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200/80"
                )}
              >
                <span>{tab.label}</span>
                <span
                  className={cn(
                    "px-1.5 py-0.2 rounded-full text-[10px]",
                    isActive ? "bg-white/20 text-white" : "bg-gray-200 text-gray-700"
                  )}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tickets List Table */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/70 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3.5">Ticket ID</th>
                <th className="px-6 py-3.5">Sender</th>
                <th className="px-6 py-3.5">Subject &amp; Category</th>
                <th className="px-6 py-3.5">Date</th>
                <th className="px-6 py-3.5">Status</th>
                <th className="px-6 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center text-gray-400">
                    <Loader2 className="w-7 h-7 text-magenta-600 animate-spin mx-auto mb-2" />
                    Loading support tickets...
                  </td>
                </tr>
              ) : filteredTickets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center">
                    <div className="max-w-xs mx-auto text-center space-y-3">
                      <div className="w-12 h-12 rounded-full bg-magenta-50 text-magenta-600 flex items-center justify-center mx-auto">
                        <MessageSquare className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-800">No support tickets found</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {searchQuery || statusFilter !== "all" || categoryFilter !== "all"
                            ? "No tickets match the selected filters."
                            : "No user support tickets have been submitted to the database yet. New inquiries from patients, clinics, and doctors will appear here."}
                        </p>
                      </div>
                      <button
                        onClick={() => fetchTickets(true)}
                        disabled={refreshing || loading}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                      >
                        <RefreshCw className={cn("w-3.5 h-3.5 text-gray-500", (refreshing || loading) && "animate-spin")} />
                        <span>Check for Tickets</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredTickets.map((ticket) => {
                  const statusInfo = statusConfig[ticket.status] || statusConfig.open;
                  const StatusIcon = statusInfo.icon;
                  const CategoryIcon = getCategoryIcon(ticket.category);
                  const priority = priorityBadge[ticket.priority] || priorityBadge.medium;

                  return (
                    <tr
                      key={ticket.id}
                      className={cn(
                        "hover:bg-gray-50/80 transition-colors group cursor-pointer",
                        ticket.status === "open" && "bg-rose-50/15"
                      )}
                      onClick={() => setSelectedTicketId(ticket.id)}
                    >
                      {/* Ticket ID */}
                      <td className="px-6 py-4 font-mono font-bold text-gray-900 whitespace-nowrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 text-gray-800 text-[11px]">
                          {ticket.id.length > 12 ? ticket.id.slice(0, 8).toUpperCase() : ticket.id}
                        </span>
                      </td>

                      {/* Sender */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-magenta-100 text-magenta-700 font-bold flex items-center justify-center text-xs shrink-0">
                            {(ticket.user || "U").charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-900 truncate max-w-[150px]">
                              {ticket.user || "Platform User"}
                            </p>
                            <p className="text-[11px] text-gray-400 truncate max-w-[150px]">
                              {ticket.email || "No email"}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Subject & Category */}
                      <td className="px-6 py-4 max-w-xs">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-semibold">
                            <CategoryIcon className="w-3 h-3 text-slate-500" />
                            {ticket.category}
                          </span>
                          {ticket.priority && ticket.priority !== "medium" && (
                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold uppercase", priority.bg)}>
                              {priority.text}
                            </span>
                          )}
                        </div>
                        <p className="font-medium text-gray-900 truncate">{ticket.subject}</p>
                        <p className="text-[11px] text-gray-400 line-clamp-1 mt-0.5">
                          {ticket.message}
                        </p>
                      </td>

                      {/* Date */}
                      <td className="px-6 py-4 text-gray-500 whitespace-nowrap">
                        {new Date(ticket.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>

                      {/* Status */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border",
                            statusInfo.bg,
                            statusInfo.text,
                            statusInfo.border
                          )}
                        >
                          <StatusIcon className="w-3.5 h-3.5" />
                          {statusInfo.label}
                        </span>
                        {ticket.response && (
                          <span className="block text-[10px] text-emerald-600 font-medium mt-1">
                            ✓ Replied
                          </span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="px-6 py-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setSelectedTicketId(ticket.id)}
                            className="px-3 py-1.5 rounded-lg bg-magenta-50 text-magenta-600 font-semibold text-xs hover:bg-magenta-100 transition-colors inline-flex items-center gap-1 cursor-pointer"
                          >
                            <span>View</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ticket Detail & Resolution Modal */}
      <AnimatePresence>
        {selectedTicket && (
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
            onClick={() => setSelectedTicketId(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl p-6 sm:p-8 max-w-2xl w-full shadow-2xl border border-gray-100 my-8 space-y-6 max-h-[90vh] overflow-y-auto"
            >
              {/* Modal Header */}
              <div className="flex items-start justify-between border-b border-gray-100 pb-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs font-mono font-bold">
                      {selectedTicket.id}
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold",
                        statusConfig[selectedTicket.status]?.bg,
                        statusConfig[selectedTicket.status]?.text
                      )}
                    >
                      {statusConfig[selectedTicket.status]?.label}
                    </span>
                    <span className="text-xs text-gray-400 font-medium">
                      • {new Date(selectedTicket.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <h2 className="text-xl font-display font-bold text-gray-900">
                    {selectedTicket.subject}
                  </h2>
                </div>

                <button
                  onClick={() => setSelectedTicketId(null)}
                  className="p-2 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Sender Profile Box */}
              <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-magenta-600 text-white font-bold flex items-center justify-center text-sm shadow-xs">
                    {(selectedTicket.user || "U").charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">{selectedTicket.user || "Platform User"}</p>
                    <p className="text-gray-500">{selectedTicket.email || "No email on record"}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:self-center">
                  <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 font-semibold flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-slate-400" />
                    {selectedTicket.category}
                  </span>
                </div>
              </div>

              {/* Inquiry Message */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                  User Inquiry Details
                </label>
                <div className="bg-gray-50 rounded-2xl p-4 text-sm text-gray-800 leading-relaxed border border-gray-100 whitespace-pre-wrap">
                  {selectedTicket.message}
                </div>
              </div>

              {/* Status Selector */}
              <div className="space-y-2 pt-2 border-t border-gray-100">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                  Update Ticket Status
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(["open", "in-progress", "resolved"] as const).map((statusKey) => {
                    const active = selectedTicket.status === statusKey;
                    const config = statusConfig[statusKey];
                    const Icon = config.icon;
                    return (
                      <button
                        key={statusKey}
                        onClick={() => handleStatusChange(selectedTicket.id, statusKey)}
                        className={cn(
                          "flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold transition-all border cursor-pointer",
                          active
                            ? cn(config.bg, config.text, config.border, "ring-2 ring-magenta-500/10 shadow-xs")
                            : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                        )}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{config.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Admin Resolution & Reply */}
              <div className="space-y-2 pt-2 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-magenta-600" />
                    Admin Response &amp; Resolution Notes
                  </label>
                  {replySuccess && (
                    <span className="text-xs text-emerald-600 font-semibold inline-flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Response saved!
                    </span>
                  )}
                </div>
                <textarea
                  rows={3}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Enter support resolution note or reply to be shown to the user..."
                  className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 transition-all resize-none"
                />
              </div>

              {/* Modal Footer Actions */}
              <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3 pt-4 border-t border-gray-100">
                <button
                  onClick={() => handleDeleteTicket(selectedTicket.id)}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Delete Ticket</span>
                </button>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button
                    onClick={() => handleSaveReply(false)}
                    disabled={replySubmitting}
                    className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <span>Save Note</span>
                  </button>

                  <button
                    onClick={() => handleSaveReply(true)}
                    disabled={replySubmitting}
                    className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-magenta-600 hover:bg-magenta-700 text-white text-xs font-semibold shadow-md shadow-magenta-500/20 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{selectedTicket.status === "resolved" ? "Save & Close" : "Resolve & Reply"}</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
