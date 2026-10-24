export type AppointmentSchedule = { status: string; date?: string | null; time?: string | null };

const URGENT_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Separate date/time fields are clinic wall time in Asia/Manila (UTC+08:00). */
export function appointmentTimestamp(appointment: AppointmentSchedule): number | null {
  const date = appointment.date?.trim();
  if (!date) return null;
  const day = date.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (!day) return null;
  const [year, month, dayOfMonth] = day.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, dayOfMonth));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== dayOfMonth) return null;

  const time = appointment.time?.trim();
  let timestamp: number;
  if (time && time !== "—") {
    const match = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const second = Number(match[3] || 0);
    if (minute > 59 || second > 59 || (match[4] ? hour < 1 || hour > 12 : hour > 23)) return null;
    if (match[4]) hour = hour % 12 + (match[4].toUpperCase() === "PM" ? 12 : 0);
    timestamp = Date.UTC(year, month - 1, dayOfMonth, hour - 8, minute, second);
  } else if (date.includes("T")) {
    timestamp = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(date) ? date : `${date}+08:00`);
  } else {
    // A date-only appointment starts at midnight in the clinic's timezone.
    timestamp = Date.UTC(year, month - 1, dayOfMonth, -8);
  }
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getPendingAppointmentUrgency(appointment: AppointmentSchedule, now: number): number | null {
  if (appointment.status !== "pending") return null;
  const timestamp = appointmentTimestamp(appointment);
  if (timestamp === null) return null;
  const remaining = timestamp - now;
  return remaining >= 0 && remaining <= URGENT_WINDOW_MS ? remaining : null;
}

/** Urgent requests first, then soonest urgent start; callers supply their normal tie-breaker. */
export function compareAppointmentUrgency(a: AppointmentSchedule, b: AppointmentSchedule, now: number): number {
  const aRemaining = getPendingAppointmentUrgency(a, now);
  const bRemaining = getPendingAppointmentUrgency(b, now);
  if (aRemaining !== null && bRemaining !== null) return aRemaining - bRemaining;
  return Number(bRemaining !== null) - Number(aRemaining !== null);
}

export type ReviewUrgencyTier = "critical" | "high" | "upcoming";
export interface ReviewUrgency {
  tier: ReviewUrgencyTier;
  label: string;
  remainingMs: number;
  countdown: string;
}

export function getReviewUrgency(appointment: AppointmentSchedule & { doctorStatus?: string }, now: number): ReviewUrgency | null {
  if (appointment.doctorStatus === "approved" || appointment.doctorStatus === "rejected") return null;
  const remainingMs = getPendingAppointmentUrgency(appointment, now);
  if (remainingMs === null) return null;
  const hour = 3_600_000;
  const minutes = Math.ceil(remainingMs / 60_000);
  const tier = remainingMs < 2 * hour ? "critical" : remainingMs < 24 * hour ? "high" : "upcoming";
  return {
    tier, remainingMs,
    label: tier === "critical" ? `⚠️ Immediate Review (${remainingMs < hour ? "< 1h" : "< 2h"})`
      : tier === "high" ? "⚡ Today" : "📅 Within 2 Days",
    countdown: minutes === 0 ? "Starts now" : minutes < 60 ? `Starts in ${minutes} min${minutes === 1 ? "" : "s"}`
      : `Starts in ${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`,
  };
}

/** Coarse DB bounds for date + wall-time storage; exact 48-hour filtering follows normalization. */
export function urgentReviewDateBounds(now: number): { from: string; until: string } {
  const day = (time: number) => new Date(time + 8 * 3_600_000).toISOString().slice(0, 10);
  return { from: `${day(now)}T00:00:00+08:00`, until: `${day(now + 72 * 3_600_000)}T00:00:00+08:00` };
}
