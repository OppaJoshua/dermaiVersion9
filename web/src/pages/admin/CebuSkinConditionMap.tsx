import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { MapPin, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchSkinConditionData } from "@/lib/adminDashboardService";
import {
  SKIN_CONDITIONS as CONDITIONS, indexSkinDistribution, heatIntensity, heatColor,
  type ConditionId, type PlatformScanSummary,
} from "@/lib/skinConditionDistribution";

type Municipality = {
  id: string;
  name: string;
  grid: Array<{ row: number; col: number }>;
};

// Schematic geographic layout only. Case counts are fetched dynamically from Supabase.
const municipalities: Municipality[] = [
  { id: "consolacion",  name: "Consolacion",   grid: [{ row: 0, col: 11 }, { row: 0, col: 12 }, { row: 1, col: 11 }] },
  { id: "liloan",       name: "Liloan",         grid: [{ row: 1, col: 12 }, { row: 2, col: 11 }] },
  { id: "compostela",   name: "Compostela",     grid: [{ row: 1, col: 13 }, { row: 2, col: 13 }] },
  { id: "lapu-lapu",    name: "Lapu-Lapu City", grid: [{ row: 2, col: 14 }, { row: 3, col: 14 }, { row: 3, col: 13 }] },
  { id: "cordova",      name: "Cordova",        grid: [{ row: 2, col: 12 }, { row: 3, col: 12 }] },
  { id: "danao",        name: "Danao City",     grid: [{ row: 2, col: 10 }, { row: 3, col: 10 }] },
  { id: "mandaue",      name: "Mandaue City",   grid: [{ row: 3, col: 11 }, { row: 4, col: 12 }] },
  { id: "carmen",       name: "Carmen",         grid: [{ row: 3, col: 9  }, { row: 4, col: 9  }] },
  { id: "catmon",       name: "Catmon",         grid: [{ row: 4, col: 8  }] },
  { id: "cebu-city",    name: "Cebu City",      grid: [{ row: 4, col: 10 }, { row: 4, col: 11 }, { row: 5, col: 10 }, { row: 5, col: 11 }, { row: 6, col: 10 }, { row: 6, col: 11 }, { row: 7, col: 10 }] },
  { id: "sogod",        name: "Sogod",          grid: [{ row: 5, col: 8  }] },
  { id: "borbon",       name: "Borbon",         grid: [{ row: 5, col: 9  }] },
  { id: "tabogon",      name: "Tabogon",        grid: [{ row: 6, col: 8  }] },
  { id: "san-remigio",  name: "San Remigio",    grid: [{ row: 6, col: 7  }] },
  { id: "medellin",     name: "Medellin",       grid: [{ row: 7, col: 7  }] },
  { id: "bogo",         name: "Bogo City",      grid: [{ row: 7, col: 8  }, { row: 7, col: 9  }] },
  { id: "daanbantayan", name: "Daanbantayan",   grid: [{ row: 8, col: 7  }, { row: 8, col: 8  }] },
  { id: "santa-fe",     name: "Santa Fe",       grid: [{ row: 8, col: 6  }] },
  { id: "bantayan",     name: "Bantayan",       grid: [{ row: 9, col: 6  }, { row: 9, col: 7  }] },
  { id: "madridejos",   name: "Madridejos",     grid: [{ row: 10, col: 6 }] },
  { id: "tabuelan",     name: "Tabuelan",       grid: [{ row: 8, col: 5  }] },
  { id: "tuburan",      name: "Tuburan",        grid: [{ row: 6, col: 5  }, { row: 7, col: 5  }] },
  { id: "asturias",     name: "Asturias",       grid: [{ row: 5, col: 5  }] },
  { id: "balamban",     name: "Balamban",       grid: [{ row: 5, col: 6  }, { row: 6, col: 6  }] },
  { id: "pinamungajan", name: "Pinamungajan",   grid: [{ row: 7, col: 6  }] },
  { id: "toledo",       name: "Toledo City",    grid: [{ row: 4, col: 6  }, { row: 4, col: 7  }, { row: 5, col: 7  }] },
  { id: "minglanilla",  name: "Minglanilla",    grid: [{ row: 8, col: 9  }, { row: 9, col: 9  }] },
  { id: "talisay",      name: "Talisay City",   grid: [{ row: 8, col: 10 }, { row: 9, col: 10 }, { row: 10, col: 9 }] },
  { id: "san-fernando", name: "San Fernando",   grid: [{ row: 10, col: 8 }] },
  { id: "naga",         name: "Naga City",      grid: [{ row: 10, col: 7 }, { row: 11, col: 7 }] },
  { id: "aloguinsan",   name: "Aloguinsan",     grid: [{ row: 9, col: 5  }] },
  { id: "barili",       name: "Barili",         grid: [{ row: 10, col: 5 }, { row: 11, col: 5 }] },
  { id: "dumanjug",     name: "Dumanjug",       grid: [{ row: 11, col: 6 }] },
  { id: "ronda",        name: "Ronda",          grid: [{ row: 11, col: 4 }] },
  { id: "alcantara",    name: "Alcantara",      grid: [{ row: 12, col: 4 }] },
  { id: "sibonga",      name: "Sibonga",        grid: [{ row: 11, col: 8 }, { row: 12, col: 8 }] },
  { id: "carcar",       name: "Carcar City",    grid: [{ row: 11, col: 9 }, { row: 12, col: 9 }] },
  { id: "moalboal",     name: "Moalboal",       grid: [{ row: 12, col: 3 }] },
  { id: "badian",       name: "Badian",         grid: [{ row: 13, col: 3 }] },
  { id: "alegria",      name: "Alegria",        grid: [{ row: 14, col: 3 }] },
  { id: "ginatilan",    name: "Ginatilan",      grid: [{ row: 14, col: 2 }] },
  { id: "malabuyoc",    name: "Malabuyoc",      grid: [{ row: 15, col: 2 }] },
  { id: "samboan",      name: "Samboan",        grid: [{ row: 15, col: 3 }] },
  { id: "santander",    name: "Santander",      grid: [{ row: 16, col: 3 }] },
  { id: "boljoon",      name: "Boljoon",        grid: [{ row: 14, col: 4 }] },
  { id: "alcoy",        name: "Alcoy",          grid: [{ row: 13, col: 4 }] },
  { id: "dalaguete",    name: "Dalaguete",      grid: [{ row: 13, col: 5 }] },
  { id: "argao",        name: "Argao",          grid: [{ row: 13, col: 6 }, { row: 14, col: 6 }] },
  { id: "pilar", name: "Pilar", grid: [{ row: 0, col: 17 }] },
  { id: "poro", name: "Poro", grid: [{ row: 2, col: 17 }] },
  { id: "san-francisco", name: "San Francisco", grid: [{ row: 2, col: 16 }] },
  { id: "tudela", name: "Tudela", grid: [{ row: 3, col: 17 }] },
  { id: "oslob",        name: "Oslob",          grid: [{ row: 15, col: 4 }] },
];

const ROWS = 17;
const COLS = 18;

type HoveredCellState = {
  municipality: Municipality;
  row: number;
  col: number;
  rect: DOMRect;
};

export default function CebuSkinConditionMap() {
  const [selectedCondition, setSelectedCondition] = useState<ConditionId | "all">("all");
  const [hoveredMunicipality, setHoveredMunicipality] = useState<string | null>(null);
  const [hoveredCell, setHoveredCell] = useState<HoveredCellState | null>(null);
  const [summary, setSummary] = useState<PlatformScanSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!hoveredCell) return;
    const handleDismiss = () => {
      setHoveredCell(null);
      setHoveredMunicipality(null);
    };
    window.addEventListener("scroll", handleDismiss, { passive: true });
    window.addEventListener("resize", handleDismiss, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleDismiss);
      window.removeEventListener("resize", handleDismiss);
    };
  }, [hoveredCell]);

  const fetchDistributionData = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchSkinConditionData();
      setSummary(rows);
      setError(false);
    } catch (err) {
      console.error("Failed to load skin condition distribution:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDistributionData();
    const timer = window.setInterval(() => {
      void fetchDistributionData();
    }, 60000);
    return () => {
      window.clearInterval(timer);
    };
  }, [fetchDistributionData]);

  const counts = useMemo(() => indexSkinDistribution(summary?.distribution ?? []), [summary]);

  const sortedRows = useMemo(() => municipalities.map(m => {
    const cases = counts.get(m.name);
    return {
      ...m,
      atopic: cases?.atopic ?? 0,
      vitiligo: cases?.vitiligo ?? 0,
      contact: cases?.contact ?? 0,
      melasma: cases?.melasma ?? 0,
      acne: cases?.acne ?? 0,
      total: cases?.all ?? 0,
      selected: cases?.[selectedCondition] ?? 0,
    };
  }).sort((a, b) => b.selected - a.selected || a.name.localeCompare(b.name)), [counts, selectedCondition]);

  const platformTotal = summary?.totals.all ?? 0;

  // Maximum case count for the active condition filter across all municipalities
  const maxCases = useMemo(() => {
    let max = 0;
    for (const m of municipalities) {
      const c = counts.get(m.name)?.[selectedCondition] ?? 0;
      if (c > max) max = c;
    }
    return max;
  }, [counts, selectedCondition]);

  // Dynamic calculation of highest reported municipality by total scan count across all conditions
  const highestReportedArea = useMemo(() => {
    let topName = "";
    let maxTotal = 0;
    for (const m of municipalities) {
      const total = counts.get(m.name)?.all ?? 0;
      if (total > maxTotal) {
        maxTotal = total;
        topName = m.name;
      }
    }
    return { name: topName, count: maxTotal };
  }, [counts]);

  const intensityTiers = useMemo(() => {
    if (maxCases <= 0) {
      return {
        zero: { label: "Zero Scans", range: "0 cases", shade: "Neutral Gray", pct: "0%", desc: "No patient scans recorded", color: "#e5e7eb" },
        low: { label: "Low Activity", range: "—", shade: "Light Pink", pct: "1% – 33%", desc: "Light scan volume", color: heatColor(0.25) },
        moderate: { label: "Moderate Activity", range: "—", shade: "Mid Magenta", pct: "34% – 66%", desc: "Elevated scan volume", color: heatColor(0.6) },
        peak: { label: "Peak Concentration", range: "—", shade: "Deep Magenta", pct: "67% – 100%", desc: "Highest scan cluster", color: heatColor(1.0) },
      };
    }

    const lowMax = Math.max(1, Math.floor(maxCases * 0.33));
    const medMin = lowMax + 1;
    const medMax = Math.max(medMin, Math.floor(maxCases * 0.66));
    const peakMin = medMax + 1;

    let lowRange = `1–${lowMax} cases`;
    let medRange = `${medMin}–${medMax} cases`;
    let peakRange = `${peakMin}–${maxCases} cases`;

    if (maxCases === 1) {
      lowRange = "—";
      medRange = "—";
      peakRange = "1 case";
    } else if (maxCases === 2) {
      lowRange = "1 case";
      medRange = "—";
      peakRange = "2 cases";
    } else if (maxCases === 3) {
      lowRange = "1 case";
      medRange = "2 cases";
      peakRange = "3 cases";
    }

    return {
      zero: {
        label: "Zero Scans",
        range: "0 cases",
        shade: "Neutral Gray",
        pct: "0%",
        desc: "No patient scans recorded in this area",
        color: "#e5e7eb",
      },
      low: {
        label: "Low Activity",
        range: lowRange,
        shade: "Light Pink",
        pct: "1% – 33%",
        desc: "Light concentration of scans",
        color: heatColor(0.25),
      },
      moderate: {
        label: "Moderate Activity",
        range: medRange,
        shade: "Mid Magenta",
        pct: "34% – 66%",
        desc: "Elevated scan frequency",
        color: heatColor(0.6),
      },
      peak: {
        label: "Peak Concentration",
        range: peakRange,
        shade: "Deep Magenta",
        pct: "67% – 100%",
        desc: "Highest reported cluster in Cebu",
        color: heatColor(1.0),
      },
    };
  }, [maxCases]);

  const getCaseCount = (name: string, condition: ConditionId | "all") => counts.get(name)?.[condition] ?? 0;
  const getMunicipalityByGridPos = (row: number, col: number): Municipality | null =>
    municipalities.find(m => m.grid.some(cell => cell.row === row && cell.col === col)) ?? null;

  return (
    <div className="space-y-6" aria-busy={loading}>
      <div>
        <div className="flex items-center gap-2 mb-2">
          <MapPin className="w-5 h-5 text-magenta-600" />
          <h3 className="font-display font-bold text-gray-900">Skin Condition Distribution Map</h3>
        </div>
        <p className="text-sm text-gray-400">
          Geographic distribution of AI-analyzed skin conditions across Cebu municipalities
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between">
          <span>
            Unable to refresh scan data. Any displayed counts may be out of date.
          </span>
          <button
            type="button"
            className="ml-3 underline font-semibold text-red-700 hover:text-red-900 cursor-pointer"
            onClick={() => void fetchDistributionData()}
          >
            Retry
          </button>
        </div>
      )}

      <div className="bg-gradient-to-r from-magenta-50 to-purple-50 rounded-2xl border border-magenta-100 p-4 flex items-center gap-3">
        <TrendingUp className="w-5 h-5 text-magenta-600" />
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Highest Reported Area</p>
          <p className="text-lg font-display font-bold text-gray-900">
            {loading ? (
              <span className="text-base font-medium text-gray-500">Loading scan data...</span>
            ) : highestReportedArea.count > 0 ? (
              <>
                {highestReportedArea.name}{" "}
                <span className="text-magenta-600">
                  ({highestReportedArea.count.toLocaleString()} {highestReportedArea.count === 1 ? "case" : "cases"})
                </span>
              </>
            ) : (
              <span className="text-gray-400 text-base font-medium">No scan data yet</span>
            )}
          </p>
        </div>
      </div>


      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Filter by Condition</p>
        <div className="flex flex-wrap gap-2">
          <button aria-pressed={selectedCondition === "all"} onClick={() => setSelectedCondition("all")}
            className={cn("px-4 py-2 rounded-full text-xs font-semibold transition-colors",
              selectedCondition === "all" ? "bg-magenta-500 text-white" : "bg-gray-50 text-gray-600 hover:bg-gray-100")}>
            All Conditions {summary && `(${platformTotal.toLocaleString()})`}
          </button>
          {CONDITIONS.map((cond) => (
            <button key={cond.id} aria-pressed={selectedCondition === cond.id} onClick={() => setSelectedCondition(cond.id)}
              className={cn("px-4 py-2 rounded-full text-xs font-semibold transition-colors",
                selectedCondition === cond.id ? "bg-magenta-500 text-white" : "bg-gray-50 text-gray-600 hover:bg-gray-100")}>
              {cond.name} {summary && `(${summary.totals[cond.id].toLocaleString()})`}
            </button>
          ))}
        </div>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl border border-gray-100 p-6">
        <div className="bg-gray-50 rounded-xl p-4 overflow-x-auto">
          <div className="grid gap-1 inline-grid" style={{ gridTemplateColumns: `repeat(${COLS}, 36px)` }}>
            {Array.from({ length: ROWS * COLS }).map((_, idx) => {
              const row = Math.floor(idx / COLS);
              const col = idx % COLS;
              const mun = getMunicipalityByGridPos(row, col);
              const isHovered = hoveredMunicipality === mun?.id;
              return (
                <motion.div
                  key={idx}
                  className={cn(
                    "rounded transition-all cursor-pointer relative",
                    mun ? cn(isHovered ? "ring-2 ring-gray-900 scale-110 z-20 shadow-md" : "hover:scale-105") : "bg-gray-200 opacity-30"
                  )}
                  style={{
                    width: "36px",
                    height: "44px",
                    backgroundColor: mun ? heatColor(heatIntensity(getCaseCount(mun.name, selectedCondition), maxCases)) : undefined,
                  }}
                  tabIndex={mun ? 0 : undefined}
                  role={mun ? "img" : undefined}
                  aria-label={mun ? `${mun.name}: ${getCaseCount(mun.name, selectedCondition)} cases` : undefined}
                  onFocus={(e) => {
                    if (mun) {
                      setHoveredMunicipality(mun.id);
                      setHoveredCell({
                        municipality: mun,
                        row,
                        col,
                        rect: e.currentTarget.getBoundingClientRect(),
                      });
                    }
                  }}
                  onBlur={() => {
                    setHoveredMunicipality(null);
                    setHoveredCell(null);
                  }}
                  onMouseEnter={(e) => {
                    if (mun) {
                      setHoveredMunicipality(mun.id);
                      setHoveredCell({
                        municipality: mun,
                        row,
                        col,
                        rect: e.currentTarget.getBoundingClientRect(),
                      });
                    }
                  }}
                  onMouseLeave={() => {
                    setHoveredMunicipality(null);
                    setHoveredCell(null);
                  }}
                  whileHover={mun ? { scale: 1.15 } : {}}
                  whileTap={mun ? { scale: 0.95 } : {}}
                />
              );
            })}
          </div>
        </div>
        <div className="mt-6 pt-6 border-t border-gray-100 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-900">Intensity Scale</p>
                <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-magenta-50 text-magenta-700 border border-magenta-100">
                  Color Shade Reference
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Visual guide mapping each color shade to its scan frequency and case threshold across Cebu
              </p>
            </div>
            <div className="flex items-center gap-1.5 self-start sm:self-auto bg-gray-50 border border-gray-200/80 px-2.5 py-1 rounded-lg text-xs">
              <span className="text-gray-500 font-medium">Active Peak:</span>
              <strong className="text-magenta-700 font-bold tabular-nums">
                {maxCases.toLocaleString()} {maxCases === 1 ? "case" : "cases"} = 100%
              </strong>
            </div>
          </div>

          {/* 4-tier categorical breakdown cards explaining color shade meanings */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Zero Cases */}
            <div className="flex items-start gap-3 p-3 rounded-xl bg-gray-50/90 border border-gray-200 transition-all hover:bg-gray-50">
              <div
                className="w-7 h-9 rounded-md border border-gray-300 shadow-xs shrink-0 flex items-center justify-center text-[10px] font-bold text-gray-500"
                style={{ backgroundColor: intensityTiers.zero.color }}
              >
                0
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <p className="text-xs font-bold text-gray-900 truncate">{intensityTiers.zero.label}</p>
                  <span className="text-[10px] font-semibold text-gray-600 bg-white px-1.5 py-0.5 rounded border border-gray-200 shrink-0">
                    {intensityTiers.zero.range}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">{intensityTiers.zero.desc}</p>
                <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-gray-200/70 text-[10px] text-gray-500 font-medium">
                  <span className="font-semibold text-gray-700">{intensityTiers.zero.shade}</span>
                  <span>•</span>
                  <span>0%</span>
                </div>
              </div>
            </div>

            {/* Low Intensity */}
            <div className="flex items-start gap-3 p-3 rounded-xl bg-pink-50/30 border border-pink-100 transition-all hover:bg-pink-50/50">
              <div
                className="w-7 h-9 rounded-md border border-pink-200 shadow-xs shrink-0"
                style={{ backgroundColor: intensityTiers.low.color }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <p className="text-xs font-bold text-gray-900 truncate">{intensityTiers.low.label}</p>
                  <span className="text-[10px] font-semibold text-magenta-700 bg-white px-1.5 py-0.5 rounded border border-pink-200 shrink-0">
                    {intensityTiers.low.range}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">{intensityTiers.low.desc}</p>
                <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-pink-100 text-[10px] text-pink-700 font-medium">
                  <span className="font-semibold text-pink-900">{intensityTiers.low.shade}</span>
                  <span>•</span>
                  <span>1% – 33%</span>
                </div>
              </div>
            </div>

            {/* Moderate Intensity */}
            <div className="flex items-start gap-3 p-3 rounded-xl bg-pink-50/50 border border-pink-200 transition-all hover:bg-pink-50/70">
              <div
                className="w-7 h-9 rounded-md border border-pink-300 shadow-xs shrink-0"
                style={{ backgroundColor: intensityTiers.moderate.color }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <p className="text-xs font-bold text-gray-900 truncate">{intensityTiers.moderate.label}</p>
                  <span className="text-[10px] font-semibold text-magenta-800 bg-white px-1.5 py-0.5 rounded border border-pink-200 shrink-0">
                    {intensityTiers.moderate.range}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">{intensityTiers.moderate.desc}</p>
                <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-pink-200 text-[10px] text-magenta-800 font-medium">
                  <span className="font-semibold text-magenta-900">{intensityTiers.moderate.shade}</span>
                  <span>•</span>
                  <span>34% – 66%</span>
                </div>
              </div>
            </div>

            {/* Peak Intensity */}
            <div className="flex items-start gap-3 p-3 rounded-xl bg-magenta-50/40 border border-magenta-200 transition-all hover:bg-magenta-50/60">
              <div
                className="w-7 h-9 rounded-md border border-magenta-900 shadow-xs shrink-0"
                style={{ backgroundColor: intensityTiers.peak.color }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <p className="text-xs font-bold text-gray-900 truncate">{intensityTiers.peak.label}</p>
                  <span className="text-[10px] font-bold text-white bg-magenta-700 px-1.5 py-0.5 rounded shrink-0">
                    {intensityTiers.peak.range}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">{intensityTiers.peak.desc}</p>
                <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-magenta-200 text-[10px] text-magenta-900 font-medium">
                  <span className="font-bold text-magenta-950">{intensityTiers.peak.shade}</span>
                  <span>•</span>
                  <span>67% – 100%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h4 className="font-display font-bold text-gray-900">Municipality Breakdown</h4>
          <p className="text-xs text-gray-400 mt-0.5">All-condition totals from patient scans; rows ranked by the selected filter. Totals include scans with an unknown condition.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Municipality</th>
                <th className="text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-3">Atopic Dermatitis</th>
                <th className="text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-3">Vitiligo</th>
                <th className="text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-3">Contact Dermatitis</th>
                <th className="text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-3">Melasma</th>
                <th className="text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-3">Acne Vulgaris</th>
                <th className="text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.id} className="border-t border-gray-50 hover:bg-gray-50/70 transition-colors"
                  onMouseEnter={() => setHoveredMunicipality(row.id)}
                  onMouseLeave={() => setHoveredMunicipality(null)}>
                  <td className="px-6 py-3 text-sm font-semibold text-gray-900">{row.name}</td>
                  <td className="px-3 py-3 text-center text-sm text-gray-600">{row.atopic}</td>
                  <td className="px-3 py-3 text-center text-sm text-gray-600">{row.vitiligo}</td>
                  <td className="px-3 py-3 text-center text-sm text-gray-600">{row.contact}</td>
                  <td className="px-3 py-3 text-center text-sm text-gray-600">{row.melasma}</td>
                  <td className="px-3 py-3 text-center text-sm text-gray-600">{row.acne}</td>
                  <td className="px-3 py-3 text-center text-sm font-semibold text-magenta-600">{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* High-Contrast Floating Tooltip Portal with Automatic Flip Positioning Guard */}
      {hoveredCell &&
        createPortal(
          (() => {
            const { municipality, row, rect } = hoveredCell;
            const casesForActive = getCaseCount(municipality.name, selectedCondition);
            const totalCasesForMun = getCaseCount(municipality.name, "all");
            const selectedCondName =
              selectedCondition === "all"
                ? "All Conditions"
                : (CONDITIONS.find((c) => c.id === selectedCondition)?.name ?? selectedCondition);

            // Positioning Guard: top rows (row <= 2) render tooltip below the cell; lower rows render above
            const isTopRow = row <= 2;
            const centerX = rect.left + rect.width / 2;
            const clampedX = Math.max(130, Math.min(window.innerWidth - 130, centerX));
            const targetTop = isTopRow ? rect.bottom + 10 : rect.top - 10;
            const transform = isTopRow ? "translate(-50%, 0)" : "translate(-50%, -100%)";

            return (
              <div
                role="tooltip"
                style={{
                  position: "fixed",
                  top: targetTop,
                  left: clampedX,
                  transform,
                  zIndex: 9999,
                  pointerEvents: "none",
                }}
                className="bg-slate-900 text-white rounded-xl shadow-2xl border border-slate-700/90 p-3.5 min-w-[220px] max-w-[280px] pointer-events-none transition-all duration-150 animate-in fade-in zoom-in-95"
              >
                {/* Arrow indicator pointing toward the cell */}
                <div
                  className={cn(
                    "absolute left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-slate-900 border-slate-700/90 rotate-45",
                    isTopRow ? "-top-1.5 border-t border-l" : "-bottom-1.5 border-b border-r"
                  )}
                />

                <div className="relative z-10 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-sm text-white tracking-wide">{municipality.name}</p>
                    <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-slate-800 text-magenta-300 border border-slate-700">
                      Cebu
                    </span>
                  </div>

                  <div className="bg-slate-800/80 rounded-lg p-2 border border-slate-700/60 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-300 font-medium truncate max-w-[150px]">
                        {selectedCondName}
                      </span>
                      <span className="text-sm font-extrabold text-white tabular-nums">
                        {casesForActive.toLocaleString()} {casesForActive === 1 ? "case" : "cases"}
                      </span>
                    </div>

                    {selectedCondition !== "all" && (
                      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-700/50">
                        <span>Total all conditions:</span>
                        <span className="text-slate-200 font-semibold">{totalCasesForMun.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })(),
          document.body
        )}
    </div>
  );
}
