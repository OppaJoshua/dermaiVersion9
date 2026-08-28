import { useState } from "react";
import { X, MessageSquare } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { updateHelpdeskTicketStatus } from "@/lib/store";
type TicketStatus = "open" | "in-progress" | "resolved";
type Ticket = {
    id: string;
    user: string;
    email: string;
    subject: string;
    message: string;
    status: TicketStatus;
    createdAt: string;
};
type FilterType = "all" | TicketStatus;
const statusBadge: Record<TicketStatus, string> = {
    open: "bg-red-50 text-red-600",
    "in-progress": "bg-amber-50 text-amber-600",
    resolved: "bg-green-50 text-green-700",
};
export default function AdminHelpdeskPage() {
    // TODO: Load helpdesk tickets from Supabase
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [filter, setFilter] = useState<FilterType>("all");
    const [selectedTicket, setSelectedTicket] = useState<string | null>(null);
    const filtered = tickets.filter((t) => filter === "all" || t.status === filter);
    const modalTicket = tickets.find((t) => t.id === selectedTicket);
    const openCount = tickets.filter((t) => t.status === "open").length;
    const inProgressCount = tickets.filter((t) => t.status === "in-progress").length;
    const resolvedCount = tickets.filter((t) => t.status === "resolved").length;
    const resolveTicket = (id: string) => {
        setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, status: "resolved" } : t)));
        updateHelpdeskTicketStatus(id, "resolved");
    };
    const markInProgress = (id: string) => {
        setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, status: "in-progress" } : t)));
        updateHelpdeskTicketStatus(id, "in-progress");
    };
    return (<div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-gray-900">Helpdesk</h1>
        <p className="text-sm text-gray-400 mt-0.5">View and manage user support tickets</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <p className="text-2xl font-display font-bold text-red-600">{openCount}</p>
          <p className="text-xs text-gray-400 mt-0.5">Open Tickets</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <p className="text-2xl font-display font-bold text-amber-600">{inProgressCount}</p>
          <p className="text-xs text-gray-400 mt-0.5">In Progress</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <p className="text-2xl font-display font-bold text-green-700">{resolvedCount}</p>
          <p className="text-xs text-gray-400 mt-0.5">Resolved</p>
        </div>
      </div>

      {/* Filter */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <div className="flex flex-wrap gap-2">
          {(["all", "open", "in-progress", "resolved"] as const).map((f) => (<button key={f} onClick={() => setFilter(f)} className={cn("px-4 py-2 rounded-full text-xs font-semibold capitalize transition-colors", filter === f
                ? "bg-magenta-500 text-white"
                : "bg-gray-50 text-gray-600 hover:bg-gray-100")}>
              {f.replace("-", " ")}
            </button>))}
        </div>
      </div>

      {/* Tickets Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Ticket ID</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">User</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Subject</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Date</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Status</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ticket) => (<tr key={ticket.id} className="border-t border-gray-50 hover:bg-gray-50/70 transition-colors">
                  <td className="px-6 py-4 text-sm font-medium text-gray-700">{ticket.id}</td>
                  <td className="px-6 py-4">
                    <p className="text-sm font-semibold text-gray-900">{ticket.user}</p>
                    <p className="text-xs text-gray-400">{ticket.email}</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700 max-w-xs truncate">
                    {ticket.subject}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{ticket.createdAt}</td>
                  <td className="px-6 py-4">
                    <span className={cn("px-3 py-1 rounded-full text-xs font-semibold capitalize", statusBadge[ticket.status])}>
                      {ticket.status.replace("-", " ")}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <button onClick={() => setSelectedTicket(ticket.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-xs font-medium hover:bg-blue-100 transition-colors">
                      <MessageSquare className="w-3.5 h-3.5"/> View
                    </button>
                  </td>
                </tr>))}
              {filtered.length === 0 && (<tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-sm text-gray-400">
                    No tickets in this category.
                  </td>
                </tr>)}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ticket Detail Modal */}
      <AnimatePresence>
        {selectedTicket && modalTicket && (<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelectedTicket(null)}>
            <motion.div initial={{ opacity: 0, y: 30, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 30 }} onClick={(e) => e.stopPropagation()} className="bg-white rounded-[24px] p-6 sm:p-8 max-w-lg w-full">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-xl font-display font-bold text-gray-900 leading-tight">
                    {modalTicket.subject}
                  </h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {modalTicket.id} · {modalTicket.createdAt}
                  </p>
                </div>
                <button onClick={() => setSelectedTicket(null)} className="p-2 rounded-full hover:bg-gray-100 transition-colors ml-4 shrink-0">
                  <X className="w-5 h-5 text-gray-400"/>
                </button>
              </div>

              <div className="space-y-4 mb-6">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Status</span>
                  <span className={cn("px-3 py-1 rounded-full text-xs font-semibold capitalize", statusBadge[modalTicket.status])}>
                    {modalTicket.status.replace("-", " ")}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-gray-400">From</span>
                  <p className="text-sm font-medium text-gray-900 mt-0.5">
                    {modalTicket.user} · {modalTicket.email}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-gray-400">Message</span>
                  <p className="text-sm text-gray-700 mt-1.5 bg-gray-50 rounded-xl p-3 leading-relaxed">
                    {modalTicket.message}
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                {modalTicket.status === "open" && (<button onClick={() => {
                    markInProgress(modalTicket.id);
                    setSelectedTicket(null);
                }} className="flex-1 px-4 py-2.5 rounded-lg bg-amber-50 text-amber-600 text-sm font-semibold hover:bg-amber-100 transition-colors">
                    Mark In Progress
                  </button>)}
                {modalTicket.status !== "resolved" && (<button onClick={() => {
                    resolveTicket(modalTicket.id);
                    setSelectedTicket(null);
                }} className="flex-1 px-4 py-2.5 rounded-lg bg-green-50 text-green-700 text-sm font-semibold hover:bg-green-100 transition-colors">
                    Mark Resolved
                  </button>)}
                <button onClick={() => setSelectedTicket(null)} className="flex-1 px-4 py-2.5 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200 transition-colors">
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>)}
      </AnimatePresence>
    </div>);
}
