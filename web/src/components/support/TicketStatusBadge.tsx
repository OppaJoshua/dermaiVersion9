import { cn } from "@/lib/utils";

export type TicketStatusType =
  | "open"
  | "OPEN"
  | "in_progress"
  | "IN_PROGRESS"
  | "in-progress"
  | "resolved"
  | "RESOLVED"
  | "closed"
  | "CLOSED"
  | "pending"
  | "PENDING"
  | string;

export interface TicketBadgeConfig {
  key: "open" | "in_progress" | "resolved" | "pending";
  label: string;
  pill: string;
}

/**
 * Returns dynamic status badge metadata for support tickets.
 * Status Mapping Requirements:
 * - 'in_progress' / 'IN_PROGRESS' -> In Progress badge (amber/orange theme)
 * - 'resolved' / 'RESOLVED'       -> Resolved badge (emerald theme)
 * - 'open' / 'OPEN'               -> Open badge (existing patient/portal theme)
 * - 'pending' / 'PENDING'         -> Pending badge (neutral slate theme)
 */
export function getTicketStatusBadge(
  status: TicketStatusType | undefined | null,
  portalTheme: "patient" | "doctor" | "clinic" = "patient"
): TicketBadgeConfig {
  const normalized = String(status || "").toLowerCase().trim();

  if (
    normalized === "in_progress" ||
    normalized === "in-progress" ||
    normalized === "in progress"
  ) {
    return {
      key: "in_progress",
      label: "In Progress",
      pill: "bg-amber-50 border-amber-200 text-amber-800",
    };
  }

  if (normalized === "resolved" || normalized === "closed") {
    return {
      key: "resolved",
      label: "Resolved",
      pill: "bg-emerald-50 border-emerald-200 text-emerald-800",
    };
  }

  if (normalized === "pending") {
    return {
      key: "pending",
      label: "Pending",
      pill: "bg-slate-100 border-slate-200 text-slate-700",
    };
  }

  // Default to "open" badge
  let openPill = "bg-[#fae8ee] border-[#f2c6d4] text-[#801336]";
  if (portalTheme === "doctor") {
    openPill = "bg-sky-50 border-sky-200 text-sky-800";
  } else if (portalTheme === "clinic") {
    openPill = "bg-pink-50 border-pink-200 text-[#c0166a]";
  }

  return {
    key: "open",
    label: "Open",
    pill: openPill,
  };
}

export function TicketStatusBadge({
  status,
  portalTheme = "patient",
  className,
}: {
  status: TicketStatusType | undefined | null;
  portalTheme?: "patient" | "doctor" | "clinic";
  className?: string;
}) {
  const config = getTicketStatusBadge(status, portalTheme);

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border shrink-0 transition-colors",
        config.pill,
        className
      )}
      data-status={config.key}
    >
      {config.label}
    </span>
  );
}
