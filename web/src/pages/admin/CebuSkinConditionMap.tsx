import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { MapPin, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPlatformScans } from "@/lib/store";

type Municipality = {
  id: string;
  name: string;
  grid: Array<{ row: number; col: number }>;
};

const CONDITIONS = [
  { id: "atopic",   name: "Atopic Dermatitis",  legend: "bg-blue-"   },
  { id: "vitiligo", name: "Vitiligo",            legend: "bg-violet-" },
  { id: "contact",  name: "Contact Dermatitis",  legend: "bg-orange-" },
  { id: "melasma",  name: "Melasma",             legend: "bg-purple-" },
  { id: "acne",     name: "Acne Vulgaris",       legend: "bg-red-"    },
] as const;

type ConditionId = typeof CONDITIONS[number]["id"];

const CONDITION_KEYWORDS: Record<ConditionId, string[]> = {
  atopic:   ["atopic dermatitis", "atopic"],
  vitiligo: ["vitiligo"],
  contact:  ["contact dermatitis", "contact"],
  melasma:  ["melasma"],
  acne:     ["acne vulgaris", "acne"],
};

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
  { id: "oslob",        name: "Oslob",          grid: [{ row: 15, col: 4 }] },
];

const ROWS = 17;
const COLS = 15;

// All case counts are derived live from getPlatformScans() — no hardcoded data.

export default function CebuSkinConditionMap() {
  const [selectedCondition, setSelectedCondition] = useState<ConditionId | "all">("all");
  const [hoveredMunicipality, setHoveredMunicipality] = useState<string | null>(null);

  // All counts come from real scan records — zero until Supabase is connected
  const liveScans = getPlatformScans();

  const getCaseCount = (municipalityName: string, condition: ConditionId | "all"): number =>
    liveScans.filter((scan) => {
      if (scan.district?.toLowerCase() !== municipalityName.toLowerCase()) return false;
      if (condition === "all") return true;
      const c = scan.condition?.toLowerCase() ?? "";
      return CONDITION_KEYWORDS[condition].some((kw) => c.includes(kw));
    }).length;

  const maxCases = useMemo(() => {
    const counts = municipalities.map((m) => getCaseCount(m.name, selectedCondition));
    return Math.max(...counts, 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCondition, liveScans]);

  const getIntensity = (name: string) =>
    Math.max(0.08, Math.min(1, getCaseCount(name, selectedCondition) / maxCases));

  const getMunicipalityByGridPos = (row: number, col: number): Municipality | null =>
    municipalities.find((m) => m.grid.some((g) => g.row === row && g.col === col)) ?? null;

  const condMeta = CONDITIONS.find((c) => c.id === selectedCondition);

  const getBackgroundColor = (mun: Municipality | null): string => {
    if (!mun) return "bg-gray-100";
    const level = Math.max(1, Math.round(getIntensity(mun.name) * 9)) * 100;
    return (condMeta?.legend ?? "bg-magenta-") + level;
  };

  const topMunicipality = useMemo(() => {
    let topName = municipalities[0].name;
    let topCount = 0;
    for (const m of municipalities) {
      const c = getCaseCount(m.name, selectedCondition);
      if (c > topCount) { topCount = c; topName = m.name; }
    }
    return { name: topName, cases: topCount };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCondition, liveScans]);

  const sortedRows = useMemo(() =>
    [...municipalities]
      .map((m) => ({
        ...m,
        atopic:   getCaseCount(m.name, "atopic"),
        vitiligo: getCaseCount(m.name, "vitiligo"),
        contact:  getCaseCount(m.name, "contact"),
        melasma:  getCaseCount(m.name, "melasma"),
        acne:     getCaseCount(m.name, "acne"),
        total:    getCaseCount(m.name, "all"),
      }))
      .sort((a, b) => b.total - a.total),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [liveScans]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <MapPin className="w-5 h-5 text-magenta-600" />
          <h3 className="font-display font-bold text-gray-900">Skin Condition Distribution Map</h3>
        </div>
        <p className="text-sm text-gray-400">
          Geographic distribution of AI-analyzed skin conditions across Cebu municipalities
        </p>
      </div>

      <div className="bg-gradient-to-r from-magenta-50 to-purple-50 rounded-2xl border border-magenta-100 p-4 flex items-center gap-3">
        <TrendingUp className="w-5 h-5 text-magenta-600" />
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Highest Reported Area</p>
          <p className="text-lg font-display font-bold text-gray-900">
            {topMunicipality.cases > 0
              ? <>{topMunicipality.name} <span className="text-magenta-600">({topMunicipality.cases.toLocaleString()} cases)</span></>
              : <span className="text-gray-400 text-base font-medium">No scan data yet</span>}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Filter by Condition</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setSelectedCondition("all")}
            className={cn("px-4 py-2 rounded-full text-xs font-semibold transition-colors",
              selectedCondition === "all" ? "bg-magenta-500 text-white" : "bg-gray-50 text-gray-600 hover:bg-gray-100")}>
            All Conditions
          </button>
          {CONDITIONS.map((cond) => (
            <button key={cond.id} onClick={() => setSelectedCondition(cond.id)}
              className={cn("px-4 py-2 rounded-full text-xs font-semibold transition-colors",
                selectedCondition === cond.id ? "bg-magenta-500 text-white" : "bg-gray-50 text-gray-600 hover:bg-gray-100")}>
              {cond.name}
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
                <motion.div key={idx}
                  className={cn("rounded transition-all cursor-pointer relative group",
                    mun ? cn(getBackgroundColor(mun), isHovered && "ring-2 ring-gray-900 scale-110") : "bg-gray-200 opacity-30")}
                  style={{ width: "36px", height: "44px" }}
                  onMouseEnter={() => mun && setHoveredMunicipality(mun.id)}
                  onMouseLeave={() => setHoveredMunicipality(null)}
                  whileHover={mun ? { scale: 1.15 } : {}}
                  whileTap={mun ? { scale: 0.95 } : {}}>
                  {mun && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-gray-900 text-white text-xs px-3 py-1.5 rounded-lg whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      <p className="font-semibold">{mun.name}</p>
                      <p className="text-gray-300">{getCaseCount(mun.name, selectedCondition).toLocaleString()} cases</p>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
        <div className="mt-6 pt-6 border-t border-gray-100">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Intensity Scale</p>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">Low</span>
            <div className="flex gap-1 flex-1">
              {[100,200,300,400,500,600,700,800,900].map((level) => (
                <div key={level} className={cn("w-6 h-6 rounded-sm", (condMeta?.legend ?? "bg-magenta-") + level)} />
              ))}
            </div>
            <span className="text-xs text-gray-500">High</span>
          </div>
        </div>
      </motion.div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h4 className="font-display font-bold text-gray-900">Municipality Breakdown</h4>
          <p className="text-xs text-gray-400 mt-0.5">Counts are derived live from patient AI scan results</p>
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
              {sortedRows.map((row, idx) => (
                <tr key={idx} className="border-t border-gray-50 hover:bg-gray-50/70 transition-colors"
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
    </div>
  );
}
