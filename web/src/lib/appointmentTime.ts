/** Format stored 24-hour times and legacy AM/PM values without exposing NaN. */
export function formatAppointmentTime(value?: string | null, fallback = 'Not scheduled'): string {
  if (typeof value !== 'string') return fallback;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(AM|PM)?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/i);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  const suffix = match[4]?.toUpperCase();
  if (minute > 59 || second > 59 || (suffix ? hour < 1 || hour > 12 : hour > 23)) return fallback;
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${suffix || (hour >= 12 ? 'PM' : 'AM')}`;
}

function normalizedTime(value: string): string {
  const formatted = formatAppointmentTime(value, '');
  if (!formatted) return '';
  const [clock, suffix] = formatted.split(' ');
  const [hour, minute] = clock.split(':');
  const hour24 = Number(hour) % 12 + (suffix === 'PM' ? 12 : 0);
  return `${String(hour24).padStart(2, '0')}:${minute}`;
}

/** Prefer a valid saved time, then the batch time, then the schedule timestamp. */
export function resolveAppointmentTime(time: unknown, batchTime: unknown, date: unknown): string {
  for (const value of [time, batchTime]) {
    if (typeof value === 'string') {
      const formatted = normalizedTime(value);
      if (formatted) return formatted;
    }
  }
  if (typeof date !== 'string' || !/[T ]\d{2}:\d{2}/.test(date)) return '';
  // Database timestamps without an offset represent the clinic's local time.
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(date)) {
    return normalizedTime(date.split(/[T ]/)[1]);
  }
  const parsed = new Date(date);
  if (!Number.isFinite(parsed.getTime())) return '';
  return normalizedTime(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(parsed));
}
