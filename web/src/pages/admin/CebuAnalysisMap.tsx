import { useState, useMemo, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { RefreshCw, MapPin } from "lucide-react";
import { cebuDistrictGeo } from "@/lib/cebuMunicipalities";
import { fetchCebuAnalysisMapData, type CebuScanCountSummary } from "@/lib/adminDashboardService";

export interface CebuAnalysisMapProps {
  className?: string;
  onDataLoaded?: (data: CebuScanCountSummary) => void;
}

export type DensityTier = "low" | "med" | "high";

function getDensityTier(count: number, maxCount: number): DensityTier {
  if (count <= 0 || maxCount <= 0) return "low";
  const ratio = count / maxCount;
  if (ratio > 0.66) return "high";
  if (ratio > 0.33) return "med";
  return "low";
}

const DENSITY_STYLES: Record<DensityTier, { pin: string; ping: string; label: string; dot: string; bar: string }> = {
  low: {
    pin: "bg-magenta-300",
    ping: "bg-magenta-300",
    label: "Low",
    dot: "bg-magenta-300",
    bar: "bg-magenta-300",
  },
  med: {
    pin: "bg-magenta-500",
    ping: "bg-magenta-400",
    label: "Med",
    dot: "bg-magenta-400",
    bar: "bg-magenta-500",
  },
  high: {
    pin: "bg-magenta-700",
    ping: "bg-magenta-600",
    label: "High",
    dot: "bg-magenta-600",
    bar: "bg-magenta-700",
  },
};

export default function CebuAnalysisMap({ className = "", onDataLoaded }: CebuAnalysisMapProps) {
  const [hoveredDistrict, setHoveredDistrict] = useState<string | null>(null);
  const [districtCounts, setDistrictCounts] = useState<Record<string, number>>({});
  const [totalInCebu, setTotalInCebu] = useState<number>(0);
  const [unmappedCount, setUnmappedCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);

  const loadMapData = useCallback(async () => {
    setLoading(true);
    try {
      const summary = await fetchCebuAnalysisMapData();
      setDistrictCounts(summary.counts);
      setTotalInCebu(summary.totalInCebu);
      setUnmappedCount(summary.unmappedCount);
      setError(false);
      onDataLoaded?.(summary);
    } catch (err) {
      console.error("Failed to load Cebu analysis map data:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [onDataLoaded]);

  useEffect(() => {
    void loadMapData();
    const interval = window.setInterval(() => {
      void loadMapData();
    }, 60000);
    return () => {
      window.clearInterval(interval);
    };
  }, [loadMapData]);

  // Map each Cebu municipality name to its coordinates and count
  const cebuDistricts = useMemo(() => {
    return cebuDistrictGeo
      .map((district) => ({
        ...district,
        count: districtCounts[district.name] ?? 0,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [districtCounts]);

  const maxDistrictCount = useMemo(() => {
    const max = Math.max(0, ...cebuDistricts.map((d) => d.count));
    return max > 0 ? max : 1;
  }, [cebuDistricts]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25 }}
      className={`bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="px-7 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-magenta-600" />
            <h3 className="text-lg font-semibold text-black">Cebu analysis map</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs px-3 py-1 rounded-full border border-magenta-200 bg-magenta-50 text-black font-semibold flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${loading ? "bg-amber-500 animate-pulse" : error ? "bg-red-500" : "bg-magenta-500 animate-pulse"}`} />
              {loading ? "Loading" : error ? "Unavailable" : "Live"}
            </span>
            {error && (
              <button
                type="button"
                onClick={() => void loadMapData()}
                className="p-1 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                title="Retry fetching map data"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        <p className="text-sm text-gray-600 mt-1">Skin analysis density across Cebu</p>
        {error && (
          <div className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5 flex items-center justify-between">
            <span>Unable to refresh scan counts. Any displayed counts may be out of date.</span>
            <button
              type="button"
              onClick={() => void loadMapData()}
              className="ml-2 font-semibold underline text-red-700 hover:text-red-800"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {/* SVG Map Section */}
      <div className="px-7 pb-5">
        <div className="relative bg-gray-50 rounded-xl overflow-hidden h-75 border border-gray-200">
          <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full" style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.03))" }}>
            <path
              d="M 52 5 C 54 8, 57 12, 58 18 C 59 22, 57 26, 56 30 C 55 34, 54 36, 53 38 C 52 40, 54 42, 55 44 C 56 46, 58 44, 60 42 C 62 40, 65 38, 66 40 C 67 42, 64 44, 62 46 C 60 48, 56 48, 54 48 C 52 48, 50 50, 49 52 C 48 54, 48 56, 47 58 C 46 60, 46 62, 45 64 C 44 66, 43 68, 42 70 C 41 72, 40 74, 39 76 C 38 78, 37 80, 36 82 C 35 84, 34 86, 35 88 C 36 90, 38 90, 39 88 C 40 86, 41 84, 42 82 C 43 80, 44 78, 44 76 C 44 74, 45 72, 46 70 C 47 68, 48 66, 48 64 C 48 62, 49 60, 50 58 C 51 56, 52 54, 52 52 C 52 50, 53 48, 55 46 C 57 44, 56 42, 55 40 C 54 38, 55 36, 56 34 C 57 32, 58 28, 57 24 C 56 20, 55 16, 54 12 C 53 8, 52 6, 52 5Z"
              fill="#f9fafb"
              stroke="#e5e7eb"
              strokeWidth="0.4"
            />
            <ellipse cx="64" cy="42" rx="5" ry="2.5" fill="#f9fafb" stroke="#e5e7eb" strokeWidth="0.4" />
          </svg>

          {/* Render Map Marker Pins dynamically ONLY for municipalities with count > 0 */}
          {cebuDistricts
            .filter((district) => district.count > 0)
            .map((district) => {
              const isHovered = hoveredDistrict === district.name;
              const tier = getDensityTier(district.count, maxDistrictCount);
              const styles = DENSITY_STYLES[tier];
              const size = 0.85 + 1.4 * Math.sqrt(district.count / maxDistrictCount);

              return (
                <div
                  key={district.name}
                  className="absolute cursor-pointer"
                  style={{
                    left: `${district.x}%`,
                    top: `${district.y}%`,
                    transform: "translate(-50%, -50%)",
                    zIndex: isHovered ? 30 : 10,
                  }}
                  onMouseEnter={() => setHoveredDistrict(district.name)}
                  onMouseLeave={() => setHoveredDistrict(null)}
                  tabIndex={0}
                  role="img"
                  aria-label={`${district.name}: ${district.count} scans (${styles.label} density)`}
                  onFocus={() => setHoveredDistrict(district.name)}
                  onBlur={() => setHoveredDistrict(null)}
                >
                  {/* Outer pulse animation matching density */}
                  <div
                    className={`absolute inset-0 rounded-full ${styles.ping} opacity-25 animate-ping`}
                    style={{
                      width: `${12 * size}px`,
                      height: `${12 * size}px`,
                      left: `${-(12 * size - 10 * size) / 2}px`,
                      top: `${-(12 * size - 10 * size) / 2}px`,
                      animationDuration: tier === "high" ? "1.8s" : tier === "med" ? "2.4s" : "3.0s",
                    }}
                  />
                  {/* Pin core with density-based color */}
                  <div
                    className={`rounded-full border-2 border-white shadow-md transition-all duration-200 ${styles.pin} ${
                      isHovered ? "scale-130 shadow-lg" : ""
                    }`}
                    style={{ width: `${10 * size}px`, height: `${10 * size}px` }}
                  />

                  {/* Hover Tooltip */}
                  {isHovered && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white rounded-lg shadow-xl border border-gray-200 px-3 py-2 whitespace-nowrap z-40">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={`w-2 h-2 rounded-full ${styles.dot}`} />
                        <p className="text-xs font-bold text-black">{district.name}</p>
                      </div>
                      <p className="text-[11px] text-gray-700 font-semibold">
                        {district.count.toLocaleString()} {district.count === 1 ? "analysis" : "analyses"}
                      </p>
                      <p className="text-[10px] text-gray-500 capitalize">{styles.label} Density</p>
                      <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-white border-r border-b border-gray-200 rotate-45 -mt-1" />
                    </div>
                  )}
                </div>
              );
            })}

          {/* Density Legend */}
          <div className="absolute bottom-3 left-3 bg-white/95 backdrop-blur-sm rounded-lg px-3 py-2 border border-gray-200 shadow-sm">
            <p className="text-[11px] font-semibold text-black mb-1.5">Density</p>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 rounded-full bg-magenta-300" />
                <span className="text-[10px] text-gray-700 font-medium">Low</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-full bg-magenta-500" />
                <span className="text-[10px] text-gray-700 font-medium">Med</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3.5 h-3.5 rounded-full bg-magenta-700" />
                <span className="text-[10px] text-gray-700 font-medium">High</span>
              </div>
            </div>
          </div>

          {/* Dynamic Total Counter Badge */}
          <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-sm rounded-lg px-3.5 py-2 border border-gray-200 text-center shadow-sm">
            <p className="text-lg font-display font-bold text-black">
              {loading ? "--" : totalInCebu.toLocaleString()}
            </p>
            <p className="text-[10px] text-gray-600 font-medium">Total in Cebu</p>
          </div>
        </div>
      </div>

      {/* Dynamic Municipality List & Relative Progress Bars */}
      <div className="px-7 pb-6 space-y-3 max-h-72 overflow-y-auto">
        {cebuDistricts.map((d, i) => {
          const tier = getDensityTier(d.count, maxDistrictCount);
          const barColor = d.count > 0 ? DENSITY_STYLES[tier].bar : "bg-transparent";
          const progressWidth = maxDistrictCount > 0 && d.count > 0 ? (d.count / maxDistrictCount) * 100 : 0;

          return (
            <div
              key={d.name}
              className="flex items-center gap-3 hover:bg-gray-50 px-2 py-1 rounded-lg transition-colors cursor-default"
              onMouseEnter={() => setHoveredDistrict(d.count > 0 ? d.name : null)}
              onMouseLeave={() => setHoveredDistrict(null)}
            >
              <span className="text-xs font-bold text-gray-500 w-5">{i + 1}</span>
              <span className={`text-sm flex-1 ${d.count > 0 ? "font-semibold text-black" : "font-normal text-gray-600"}`}>
                {d.name}
              </span>
              <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full ${barColor} rounded-full transition-all duration-500`}
                  style={{ width: `${progressWidth}%` }}
                />
              </div>
              <span className="text-xs font-semibold text-black w-12 text-right tabular-nums">
                {d.count.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>

      {/* Informational footer if any scans lacked verified Cebu municipality */}
      {unmappedCount > 0 && !loading && (
        <div className="px-7 py-2.5 bg-gray-50 border-t border-gray-100 text-[11px] text-gray-500">
          <span>{unmappedCount} patient {unmappedCount === 1 ? "scan has" : "scans have"} an unverified/outside-Cebu location and {unmappedCount === 1 ? "is" : "are"} cleanly excluded from the map.</span>
        </div>
      )}
    </motion.div>
  );
}
