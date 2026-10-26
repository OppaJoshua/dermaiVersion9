/** Geographic positions for each Cebu district (no hardcoded counts) */
export const cebuDistrictGeo: Array<{ name: string; x: number; y: number }> = [
  { name: "Alcantara", x: 36, y: 72 },
  { name: "Alcoy", x: 40, y: 78 },
  { name: "Alegria", x: 34, y: 80 },
  { name: "Aloguinsan", x: 33, y: 62 },
  { name: "Argao", x: 38, y: 74 },
  { name: "Asturias", x: 30, y: 45 },
  { name: "Badian", x: 32, y: 82 },
  { name: "Balamban", x: 32, y: 50 },
  { name: "Bantayan", x: 46, y: 4 },
  { name: "Barili", x: 35, y: 68 },
  { name: "Bogo City", x: 58, y: 10 },
  { name: "Boljoon", x: 40, y: 82 },
  { name: "Borbon", x: 60, y: 18 },
  { name: "Carmen", x: 56, y: 20 },
  { name: "Carcar City", x: 40, y: 70 },
  { name: "Catmon", x: 57, y: 22 },
  { name: "Compostela", x: 60, y: 32 },
  { name: "Consolacion", x: 50, y: 28 },
  { name: "Cordova", x: 64, y: 42 },
  { name: "Dalaguete", x: 42, y: 76 },
  { name: "Danao City", x: 56, y: 16 },
  { name: "Dumanjug", x: 34, y: 70 },
  { name: "Ginatilan", x: 36, y: 84 },
  { name: "Lapu-Lapu City", x: 62, y: 40 },
  { name: "Liloan", x: 55, y: 24 },
  { name: "Madridejos", x: 50, y: 3 },
  { name: "Malabuyoc", x: 35, y: 86 },
  { name: "Medellin", x: 54, y: 8 },
  { name: "Minglanilla", x: 44, y: 58 },
  { name: "Moalboal", x: 32, y: 76 },
  { name: "Naga City", x: 42, y: 64 },
  { name: "Oslob", x: 40, y: 86 },
  { name: "Pinamungajan", x: 31, y: 56 },
  { name: "Ronda", x: 34, y: 74 },
  { name: "Samboan", x: 38, y: 88 },
  { name: "San Fernando", x: 44, y: 62 },
  { name: "San Remigio", x: 52, y: 12 },
  { name: "Santa Fe", x: 48, y: 5 },
  { name: "Santander", x: 40, y: 90 },
  { name: "Sibonga", x: 41, y: 72 },
  { name: "Sogod", x: 60, y: 14 },
  { name: "Tabogon", x: 58, y: 12 },
  { name: "Tabuelan", x: 30, y: 40 },
  { name: "Talisay City", x: 46, y: 52 },
  { name: "Toledo City", x: 30, y: 52 },
  { name: "Tuburan", x: 28, y: 42 },
  { name: "Cebu City", x: 50, y: 48 },
  { name: "Mandaue City", x: 55, y: 42 },
  { name: "Daanbantayan", x: 55, y: 6 },
  { name: "Pilar", x: 85, y: 22 },
  { name: "Poro", x: 80, y: 28 },
  { name: "San Francisco", x: 74, y: 28 },
  { name: "Tudela", x: 84, y: 30 },
];


const normalize = (value: string) => value.toLowerCase()
  .replace(/\bcity of\s+/g, "").replace(/\bcity\b/g, "")
  .replace(/\bsta\.?\s+/g, "santa ").replace(/[^a-z0-9]+/g, " ").trim();

const aliases = new Map(cebuDistrictGeo.map(({ name }) => [normalize(name), name]));
const sortedAliases = Array.from(aliases.entries()).sort((a, b) => b[0].length - a[0].length);

/**
 * Resolves a Cebu municipality from structured district and free-text address.
 * 1. Checks specific municipalities mentioned in the address (e.g. Pinamungajan, Cordova, Talisay)
 *    to prevent falsely lumping patients who have generic/placeholder districts into Cebu City.
 * 2. Checks structured district / municipality field.
 * 3. Checks explicit Cebu City mentions in the address.
 * 4. Returns null if no valid Cebu municipality is found (scans are cleanly excluded, never defaulted).
 */
export function resolveCebuMunicipality(district: string | null, address: string | null): string | null {
  const normAddress = normalize(address || "");
  const isOtherProvince = /\b(camarines\s+sur|davao|bohol|leyte|negros|manila|pampanga|iloilo)\b/i.test(address || "") 
    && !/\bcebu\b/i.test(address || "");

  // 1. Check if the address explicitly mentions a specific Cebu municipality
  if (!isOtherProvince && normAddress) {
    for (const [alias, munName] of sortedAliases) {
      if (alias === "cebu") continue; // Check specific towns before generic 'cebu'
      const re = new RegExp("(^|\\s)" + alias.replace(/ /g, "\\s+") + "($|\\s)", "i");
      if (re.test(normAddress)) return munName;
    }
  }

  // 2. Check structured district (excluding generic placeholders like 'Other')
  const normDistrict = normalize(district || "");
  if (normDistrict && !["other", "unknown", "n a", "na", "none", "null"].includes(normDistrict)) {
    const directMatch = aliases.get(normDistrict);
    if (directMatch) return directMatch;
    for (const [alias, munName] of sortedAliases) {
      const re = new RegExp("(^|\\s)" + alias.replace(/ /g, "\\s+") + "($|\\s)", "i");
      if (re.test(normDistrict)) return munName;
    }
  }

  // 3. Check explicit Cebu City mentions in address
  if (!isOtherProvince && normAddress) {
    if (/\b(?:cebu city|city of cebu)\b/i.test(address || "") || (normAddress.includes("cebu") && !isOtherProvince && (district ?? "").toLowerCase().includes("cebu"))) {
      return "Cebu City";
    }
  }

  // 4. Clean exclusion if municipality cannot be verified
  return null;
}

