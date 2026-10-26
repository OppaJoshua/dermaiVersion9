import { resolveCebuMunicipality } from "./cebuMunicipalities.ts";

export const SKIN_CONDITIONS = [
  { id: "atopic", name: "Atopic Dermatitis" },
  { id: "vitiligo", name: "Vitiligo" },
  { id: "contact", name: "Contact Dermatitis" },
  { id: "melasma", name: "Melasma" },
  { id: "acne", name: "Acne Vulgaris" },
] as const;

export type ConditionId = typeof SKIN_CONDITIONS[number]["id"];
export type SkinConditionDistribution = {
  municipality: string;
  condition: string;
  scan_count: number;
};

export type PlatformScanGroup = {
  district: string | null;
  address: string | null;
  condition: string | null;
  scan_count: number | string;
};

export function summarizePlatformScanGroups(groups: PlatformScanGroup[]) {
  const distribution = new Map<string, SkinConditionDistribution>();
  const totals: Record<ConditionId | "all", number> = {
    all: 0, atopic: 0, vitiligo: 0, contact: 0, melasma: 0, acne: 0,
  };
  let mappedTotal = 0;
  for (const group of groups) {
    const count = Number(group.scan_count);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid scan count returned by admin RPC");
    const condition = normalizeSkinCondition(group.condition);
    totals.all += count;
    const known = SKIN_CONDITIONS.find(item => item.name === condition);
    if (known) totals[known.id] += count;
    const municipality = resolveCebuMunicipality(group.district, group.address);
    if (!municipality) continue;
    mappedTotal += count;
    const key = JSON.stringify([municipality, condition]);
    const row = distribution.get(key) ?? { municipality, condition, scan_count: 0 };
    row.scan_count += count;
    distribution.set(key, row);
  }
  return { distribution: [...distribution.values()], totals, mappedTotal };
}

export type PlatformScanSummary = ReturnType<typeof summarizePlatformScanGroups>;

export function scanPoolPercentage(count: number, platformTotal: number): number {
  return platformTotal > 0 ? count / platformTotal * 100 : 0;
}

export function normalizeSkinCondition(name: string | null | undefined): string {
  const normalized = (name ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const condition = SKIN_CONDITIONS.find(item =>
    item.name.toLowerCase() === normalized || item.id === normalized);
  return condition?.name ?? (normalized || "Unknown condition");
}

/** Each grouped count contributes once to the municipality total, regardless
 * of how many cells represent that municipality in the schematic map. */
export function indexSkinDistribution(rows: SkinConditionDistribution[]) {
  const counts = new Map<string, Record<ConditionId | "all", number>>();
  for (const row of rows) {
    const current = counts.get(row.municipality) ?? {
      all: 0, atopic: 0, vitiligo: 0, contact: 0, melasma: 0, acne: 0,
    };
    current.all += row.scan_count;
    const condition = SKIN_CONDITIONS.find(item => item.name === normalizeSkinCondition(row.condition));
    if (condition) current[condition.id] += row.scan_count;
    counts.set(row.municipality, current);
  }
  return counts;
}

export function heatIntensity(count: number, maxCount: number): number {
  return maxCount > 0 ? Math.max(0, Math.min(1, count / maxCount)) : 0;
}

export function heatColor(intensity: number): string {
  // Blend pale pink into dark magenta. Zero cases stay neutral.
  if (intensity <= 0) return "#e5e7eb";
  const ratio = Math.min(1, intensity);
  const low = [253, 242, 248];
  const high = [134, 16, 78];
  return `rgb(${low.map((channel, index) => Math.round(channel + (high[index] - channel) * ratio)).join(", ")})`;
}
