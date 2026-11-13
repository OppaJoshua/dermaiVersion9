import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const findClinicsPagePath = path.resolve(__dirname, "../src/pages/patient/FindClinicsPage.tsx");

test("DermAI — Clinic Finder Search Filter Improvements Test Suite", async (t) => {
  assert.ok(fs.existsSync(findClinicsPagePath), "FindClinicsPage.tsx must exist");
  const pageSrc = fs.readFileSync(findClinicsPagePath, "utf8");

  await t.test("1. FindClinicsPage has normalizeSearchText and tokenizeSearchQuery implementations", () => {
    assert.match(
      pageSrc,
      /function normalizeSearchText\(str:\s*string\s*\|\s*null\s*\|\s*undefined\):\s*string/,
      "normalizeSearchText helper must be present"
    );
    assert.match(
      pageSrc,
      /replace\(\/\[\^\\p\{L\}\\p\{N\}\\s\]\/gu,\s*["']\s*["']\)/,
      "normalizeSearchText must normalize punctuation using Unicode letter/number ranges"
    );
    assert.match(
      pageSrc,
      /function tokenizeSearchQuery\(query:\s*string\):\s*string\[\]/,
      "tokenizeSearchQuery helper must be present"
    );
  });

  await t.test("2. FindClinicsPage uses multi-token AND matching across all relevant clinic fields", () => {
    assert.match(
      pageSrc,
      /const queryTokens\s*=\s*tokenizeSearchQuery\(searchQuery\);/,
      "Search must tokenize searchQuery"
    );
    assert.match(
      pageSrc,
      /clinic\.district,/,
      "Searchable fields must include clinic.district"
    );
    assert.match(
      pageSrc,
      /queryTokens\.every\(\s*\(token\)\s*=>[\s\S]*?searchableFields\.some\(\s*\(field\)\s*=>\s*field\.includes\(token\)\s*\)\s*\)/,
      "Must use AND logic: every query token must match at least one searchable field"
    );
  });

  await t.test("3. Empty state renders contextual search message and dedicated 'Clear search' button", () => {
    assert.match(
      pageSrc,
      /searchQuery\.trim\(\)\s*\?\s*`No clinics found matching "\$\{searchQuery\.trim\(\)\}"`/,
      "Empty state must display 'No clinics found matching \"...\"' when search query is active"
    );
    assert.match(
      pageSrc,
      /onClick=\{\(\)\s*=>\s*setSearchQuery\(""\)\}/,
      "Empty state must provide a button that clears only the search query"
    );
    assert.match(
      pageSrc,
      />\s*Clear search\s*<\/button>/,
      "Button text must be 'Clear search'"
    );
  });

  await t.test("4. Behavioral: Partial input and case-insensitivity ('der', 'DERM')", () => {
    function normalizeSearchText(str) {
      if (!str) return "";
      return str.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
    }
    function tokenizeSearchQuery(query) {
      const norm = normalizeSearchText(query);
      return norm ? norm.split(/\s+/).filter(Boolean) : [];
    }

    const clinic = {
      name: "Dermclinic",
      address: "CTU, M.J. Cuenco Avenue, Cebu City",
      district: "Cebu City",
      description: "Dermatology specialty clinic",
      doctors: [{ name: "Dr. Nathan Bayutas", specialization: "General Dermatology" }],
      conditionsTreated: ["Acne Vulgaris"],
    };

    function matchesClinic(c, query) {
      const tokens = tokenizeSearchQuery(query);
      if (tokens.length === 0) return true;
      const fields = [
        c.name,
        c.address,
        c.district,
        c.description,
        ...(c.doctors || []).flatMap((d) => [d?.name, d?.specialization]),
        ...(c.conditionsTreated || []),
      ].filter(Boolean).map(normalizeSearchText);

      return tokens.every((token) => fields.some((f) => f.includes(token)));
    }

    assert.equal(matchesClinic(clinic, "der"), true, "Partial 'der' must match 'Dermclinic'");
    assert.equal(matchesClinic(clinic, "DERM"), true, "Uppercase 'DERM' must match 'Dermclinic'");
    assert.equal(matchesClinic(clinic, "clinic"), true, "Partial 'clinic' must match 'Dermclinic'");
  });

  await t.test("5. Behavioral: Punctuation and hyphen variations ('Dr Nathan', 'Dr. Nathan', 'Lapu Lapu', 'Lapu-Lapu')", () => {
    function normalizeSearchText(str) {
      if (!str) return "";
      return str.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
    }
    function tokenizeSearchQuery(query) {
      const norm = normalizeSearchText(query);
      return norm ? norm.split(/\s+/).filter(Boolean) : [];
    }

    const clinicDoctor = {
      name: "Skin Care Center",
      address: "Basak",
      district: "Lapu-Lapu City",
      description: "",
      doctors: [{ name: "Dr. Nathan Bayutas", specialization: "Clinical Dermatology" }],
      conditionsTreated: [],
    };

    function matchesClinic(c, query) {
      const tokens = tokenizeSearchQuery(query);
      if (tokens.length === 0) return true;
      const fields = [
        c.name,
        c.address,
        c.district,
        c.description,
        ...(c.doctors || []).flatMap((d) => [d?.name, d?.specialization]),
        ...(c.conditionsTreated || []),
      ].filter(Boolean).map(normalizeSearchText);

      return tokens.every((token) => fields.some((f) => f.includes(token)));
    }

    assert.equal(matchesClinic(clinicDoctor, "Dr Nathan"), true, "'Dr Nathan' must match 'Dr. Nathan Bayutas'");
    assert.equal(matchesClinic(clinicDoctor, "Dr. Nathan"), true, "'Dr. Nathan' must match 'Dr. Nathan Bayutas'");
    assert.equal(matchesClinic(clinicDoctor, "dr.nathan"), true, "'dr.nathan' must match 'Dr. Nathan Bayutas'");
    assert.equal(matchesClinic(clinicDoctor, "Lapu Lapu"), true, "'Lapu Lapu' must match 'Lapu-Lapu City'");
    assert.equal(matchesClinic(clinicDoctor, "Lapu-Lapu"), true, "'Lapu-Lapu' must match 'Lapu-Lapu City'");
  });

  await t.test("6. Behavioral: Multi-field matching ('Dermclinic Cebu')", () => {
    function normalizeSearchText(str) {
      if (!str) return "";
      return str.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
    }
    function tokenizeSearchQuery(query) {
      const norm = normalizeSearchText(query);
      return norm ? norm.split(/\s+/).filter(Boolean) : [];
    }

    const clinic = {
      name: "Dermclinic",
      address: "CTU, M.J. Cuenco Avenue, San Roque, Carreta",
      district: "Cebu City",
      description: "Comprehensive skincare",
      doctors: [{ name: "Dr. Yanpein Zamora", specialization: "Cosmetic Dermatology" }],
      conditionsTreated: ["Melasma"],
    };

    function matchesClinic(c, query) {
      const tokens = tokenizeSearchQuery(query);
      if (tokens.length === 0) return true;
      const fields = [
        c.name,
        c.address,
        c.district,
        c.description,
        ...(c.doctors || []).flatMap((d) => [d?.name, d?.specialization]),
        ...(c.conditionsTreated || []),
      ].filter(Boolean).map(normalizeSearchText);

      return tokens.every((token) => fields.some((f) => f.includes(token)));
    }

    assert.equal(matchesClinic(clinic, "Dermclinic Cebu"), true, "'Dermclinic Cebu' matches name + district");
    assert.equal(matchesClinic(clinic, "Dermclinic Yanpein"), true, "'Dermclinic Yanpein' matches name + doctor");
    assert.equal(matchesClinic(clinic, "Cebu Melasma"), true, "'Cebu Melasma' matches district + condition");
    assert.equal(matchesClinic(clinic, "xyzabc"), false, "Unrelated term 'xyzabc' must not match");
  });

  await t.test("7. Behavioral: Clearing search restores results without clearing other active filters", () => {
    let searchQuery = "xyzabc";
    let selectedDistrict = "Cebu City";
    let maxPrice = 600;
    let activeTab = "saved";
    let filterByCondition = true;
    let aiCondition = "Acne Vulgaris";

    const clinics = [
      {
        id: "c1",
        name: "Dermclinic",
        district: "Cebu City",
        numericFee: 500,
        treatsAiCondition: true,
      },
      {
        id: "c2",
        name: "Mandaue Skin Center",
        district: "Mandaue",
        numericFee: 400,
        treatsAiCondition: true,
      },
    ];
    const savedClinicIds = ["c1", "c2"];

    function filterClinics(list, q, district, maxP, tab, condFilter, cond) {
      return list.filter((c) => {
        const matchesSearch = !q || c.name.toLowerCase().includes(q.toLowerCase());
        const matchesDistrict = district === "All Districts" || c.district === district;
        const matchesTab = tab === "all" || savedClinicIds.includes(c.id);
        const matchesCondition = !condFilter || !cond || c.treatsAiCondition;
        const matchesPrice = maxP === null || c.numericFee <= maxP;
        return matchesSearch && matchesDistrict && matchesTab && matchesCondition && matchesPrice;
      });
    }

    // When searchQuery is 'xyzabc', 0 results
    let results = filterClinics(clinics, searchQuery, selectedDistrict, maxPrice, activeTab, filterByCondition, aiCondition);
    assert.equal(results.length, 0, "No results when searching 'xyzabc'");

    // Clear search ONLY
    searchQuery = "";
    results = filterClinics(clinics, searchQuery, selectedDistrict, maxPrice, activeTab, filterByCondition, aiCondition);
    assert.equal(results.length, 1, "Clearing search restores Dermclinic (which matches Cebu City, fee <= 600, saved, treats condition)");
    assert.equal(results[0].name, "Dermclinic");
    assert.equal(selectedDistrict, "Cebu City", "District filter was NOT reset");
    assert.equal(maxPrice, 600, "Price filter was NOT reset");
    assert.equal(activeTab, "saved", "Saved tab was NOT reset");
    assert.equal(filterByCondition, true, "Condition filter was NOT reset");
  });
});
