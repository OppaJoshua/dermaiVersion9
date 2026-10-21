import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type ConfidenceUnit = "percent" | "fraction";

/**
 * Safely format an AI confidence score into a consistent 1-decimal percentage string.
 *
 * Explicit unit handling:
 * - "percent" (default): value is already on a 0–100 scale (e.g., 99.86 -> "99.9%", 0.85 -> "0.9%").
 * - "fraction": value is a probability on a 0–1 scale (e.g., 0.85 -> "85.0%").
 *
 * Design principles:
 * 1. No artificial score clamping: values naturally round to 1 decimal place without capping at 99.9%
 *    (e.g., 99.86 -> "99.9%", 99.95 -> "100.0%", 100 -> "100.0%").
 * 2. No automatic unit guessing: does not guess whether a number between 0 and 1 is a fraction or a low percentage.
 * 3. Safe boundaries: handles null, undefined, non-finite, out-of-range, and invalid values safely.
 * 4. Preserves valid zero scores (0 -> "0.0%").
 */
export function formatConfidencePercent(
  value: number | string | null | undefined,
  unitOrCallback?: ConfidenceUnit | string,
  fallbackParam: string = "—"
): string {
  let unit: ConfidenceUnit = "percent";
  let fallback: string = fallbackParam;

  if (unitOrCallback === "percent" || unitOrCallback === "fraction") {
    unit = unitOrCallback;
  } else if (typeof unitOrCallback === "string") {
    fallback = unitOrCallback;
  }

  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const num = typeof value === "number" ? value : Number(value);
  if (isNaN(num) || !isFinite(num) || num < 0) {
    return fallback;
  }

  // Range validation per unit (with small float epsilon for IEEE 754 precision)
  if (unit === "fraction") {
    if (num > 1.000001) {
      return fallback;
    }
  } else {
    if (num > 100.0001) {
      return fallback;
    }
  }

  const pct = unit === "fraction" ? num * 100 : num;
  const clampedPct = Math.min(Math.max(pct, 0), 100);
  const rounded = (Math.round((clampedPct + Number.EPSILON) * 10) / 10).toFixed(1);

  return `${rounded}%`;
}

/**
 * Explicit helper for formatting probability fractions in the 0–1 range.
 * (e.g., 0.85 -> "85.0%")
 */
export function formatConfidenceFraction(
  value: number | string | null | undefined,
  fallback: string = "—"
): string {
  return formatConfidencePercent(value, "fraction", fallback);
}

/**
 * Returns formatted confidence score without the '%' sign.
 */
export function formatConfidenceScore(
  value: number | string | null | undefined,
  unitOrCallback?: ConfidenceUnit | string,
  fallbackParam: string = "—"
): string {
  const formatted = formatConfidencePercent(value, unitOrCallback, fallbackParam);
  return formatted.endsWith("%") ? formatted.slice(0, -1) : formatted;
}
