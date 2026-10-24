export function AppointmentUrgencyBadge({ remainingMs }: { remainingMs: number | null }) {
  if (remainingMs === null) return null;
  const minutes = Math.ceil(remainingMs / 60_000);
  const remaining = minutes === 0 ? "starts now" : minutes < 60 ? `${minutes}m remaining` : `${Math.ceil(minutes / 60)}h remaining`;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900 whitespace-nowrap" title="Pending appointment within 48 hours. Review this request promptly.">
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-rose-500 motion-safe:animate-pulse" />
      Urgent · {remaining}
    </span>
  );
}
