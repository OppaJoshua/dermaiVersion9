import { useState, useEffect, useCallback } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { type HelpdeskTicket, getHelpdeskTicketsAsync } from "@/lib/store";
import { TicketStatusBadge } from "./TicketStatusBadge";

interface MySupportTicketsProps {
  userId?: string;
  portalTheme?: "patient" | "doctor" | "clinic";
  onOpenSubmit?: () => void;
  className?: string;
  title?: string;
  hideWhenEmpty?: boolean;
}

export function MySupportTickets({
  userId,
  portalTheme = "patient",
  onOpenSubmit,
  className,
  title = "My support tickets",
  hideWhenEmpty = true,
}: MySupportTicketsProps) {
  const [tickets, setTickets] = useState<HelpdeskTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(userId);

  // Sync user id from session if not provided directly
  useEffect(() => {
    if (userId) {
      setCurrentUserId(userId);
      return;
    }
    let isMounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (isMounted && session?.user?.id) {
        setCurrentUserId(session.user.id);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [userId]);

  const fetchTickets = useCallback(async () => {
    try {
      const data = await getHelpdeskTicketsAsync(currentUserId);
      setTickets(data);
    } catch (err) {
      console.error("[MySupportTickets] Failed to load tickets:", err);
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    fetchTickets();

    // Supabase Real-time subscription to user_support_ticket
    const channelId = `my-tickets-${currentUserId || "all"}-${Math.random().toString(36).slice(2, 7)}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_support_ticket",
        },
        () => {
          // Re-fetch live data immediately when Admin updates or inserts ticket
          fetchTickets();
        }
      )
      .subscribe();

    const handleUpdate = () => fetchTickets();
    window.addEventListener("dermai_tickets_updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("dermai_tickets_updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, [fetchTickets, currentUserId]);

  if (hideWhenEmpty && !loading && tickets.length === 0) {
    return null;
  }

  // Theme styling helpers
  const primaryText =
    portalTheme === "doctor"
      ? "text-blue-600 hover:text-blue-700"
      : portalTheme === "clinic"
      ? "text-[#c0166a] hover:text-[#9c1256]"
      : "text-[#801336] hover:text-[#680f2b]";

  const replyBorder =
    portalTheme === "doctor"
      ? "border-l-blue-600 bg-blue-50/50"
      : portalTheme === "clinic"
      ? "border-l-[#c0166a] bg-pink-50/40"
      : "border-l-[#801336] bg-[#fae8ee]/50";

  const replyHeader =
    portalTheme === "doctor"
      ? "text-blue-900"
      : portalTheme === "clinic"
      ? "text-[#c0166a]"
      : "text-[#801336]";

  return (
    <div
      className={cn(
        "bg-white rounded-2xl border border-gray-100 shadow-2xs overflow-hidden",
        className
      )}
    >
      <div className="px-6 py-4.5 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
          <span>{title}</span>
          <span className="text-xs font-normal text-gray-400">
            ({tickets.length})
          </span>
        </h2>
        {onOpenSubmit && (
          <button
            type="button"
            onClick={onOpenSubmit}
            className={cn("text-xs font-bold hover:underline cursor-pointer", primaryText)}
          >
            + Submit new ticket
          </button>
        )}
      </div>

      <div className="divide-y divide-gray-100">
        {loading ? (
          <div className="p-8 text-center text-gray-500 text-xs">
            <Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400 mb-2" />
            Loading your tickets...
          </div>
        ) : tickets.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-xs space-y-1">
            <MessageSquare className="w-6 h-6 mx-auto text-gray-300 mb-1" />
            <p className="font-semibold text-gray-700">No support tickets found</p>
            <p className="text-gray-400">Your submitted tickets will appear here with live status updates.</p>
          </div>
        ) : (
          tickets.map((t) => {
            const displayId =
              t.id && t.id.length > 12
                ? t.id.slice(0, 8).toUpperCase()
                : t.id || "TICKET";

            return (
              <div key={t.id} className="px-6 py-5 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 text-xs text-gray-500">
                      <span className="font-mono font-bold text-gray-900">
                        #{displayId}
                      </span>
                      <span>•</span>
                      <span className="text-gray-600">{t.category}</span>
                    </div>
                    <h3 className="text-sm font-bold text-gray-900">{t.subject}</h3>
                  </div>

                  {/* Dynamic Status Badge */}
                  <TicketStatusBadge status={t.status} portalTheme={portalTheme} />
                </div>

                <p className="text-xs sm:text-sm text-gray-600 leading-relaxed bg-gray-50/70 rounded-xl p-3 border border-gray-100">
                  {t.message}
                </p>

                {/* Admin Support Response */}
                {t.response && (
                  <div
                    className={cn(
                      "border-l-[3px] px-4 py-2.5 rounded-r-xl text-xs sm:text-sm",
                      replyBorder
                    )}
                  >
                    <p className={cn("font-bold mb-0.5", replyHeader)}>
                      Admin support response
                    </p>
                    <p className="text-gray-700 leading-relaxed">{t.response}</p>
                  </div>
                )}

                <p className="text-[11px] text-gray-400">
                  Submitted on{" "}
                  {new Date(t.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
