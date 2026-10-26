import assert from "node:assert/strict";
import test from "node:test";
import { heatColor, heatIntensity, indexSkinDistribution, normalizeSkinCondition, summarizePlatformScanGroups, scanPoolPercentage } from "../lib/skinConditionDistribution.ts";

test("groups conditions by municipality while preserving unknown-condition totals", () => {
  const counts = indexSkinDistribution([
    { municipality: "Cebu City", condition: "Atopic_Dermatitis", scan_count: 4 },
    { municipality: "Cebu City", condition: "atopic", scan_count: 2 },
    { municipality: "Cebu City", condition: "Acne Vulgaris", scan_count: 3 },
    { municipality: "Argao", condition: "Vitiligo", scan_count: 12 },
    { municipality: "Argao", condition: "Unknown condition", scan_count: 1 },
  ]);
  assert.equal(counts.get("Cebu City")?.all, 9);
  assert.equal(counts.get("Cebu City")?.atopic, 6);
  assert.equal(counts.get("Cebu City")?.vitiligo, 0);
  assert.equal(counts.get("Argao")?.all, 13);
  assert.equal(counts.get("Argao")?.vitiligo, 12);
  // The highest area changes when switching from all conditions to atopic.
  const top = (condition: "all" | "atopic") => [...counts].sort((a, b) => b[1][condition] - a[1][condition])[0][0];
  assert.equal(top("all"), "Argao");
  assert.equal(top("atopic"), "Cebu City");
});

test("empty data and zero counts have no heat", () => {
  assert.equal(indexSkinDistribution([]).size, 0);
  assert.equal(heatIntensity(0, 0), 0);
  assert.equal(heatIntensity(0, 12), 0);
  assert.equal(heatColor(0), "#e5e7eb");
});

test("heat intensity is proportional to the active maximum", () => {
  assert.equal(heatIntensity(3, 12), 0.25);
  assert.equal(heatIntensity(12, 12), 1);
  assert.equal(heatColor(1), "rgb(134, 16, 78)");
  assert.notEqual(heatColor(0.25), heatColor(1));
});

test("condition aliases match exactly and unknown conditions remain distinct", () => {
  assert.equal(normalizeSkinCondition("  ACNE  "), "Acne Vulgaris");
  assert.equal(normalizeSkinCondition("contact_dermatitis"), "Contact Dermatitis");
  assert.equal(normalizeSkinCondition("non-atopic dermatitis"), "non atopic dermatitis");
  assert.equal(normalizeSkinCondition(null), "Unknown condition");
});

test("all patient groups contribute to totals, including unmapped locations and unknown conditions", () => {
  const summary = summarizePlatformScanGroups([
    { district: "Cebu City", address: null, condition: "Atopic Dermatitis", scan_count: "1200" },
    { district: "City of Cebu", address: null, condition: "atopic", scan_count: 3 },
    { district: "Argao", address: null, condition: "Acne Vulgaris", scan_count: 7 },
    { district: null, address: "Naga, Camarines Sur", condition: "Atopic Dermatitis", scan_count: 5 },
    { district: null, address: null, condition: null, scan_count: 5 },
  ]);
  assert.equal(summary.totals.all, 1220);
  assert.equal(summary.totals.atopic, 1208);
  assert.equal(summary.mappedTotal, 1210);
  assert.equal(summary.distribution.length, 2);
  assert.equal(summary.distribution.find(row => row.municipality === "Cebu City")?.scan_count, 1203);
  assert.equal(scanPoolPercentage(summary.totals.atopic, summary.totals.all), 1208 / 1220 * 100);
});

test("an empty platform has zero totals and finite percentages", () => {
  const summary = summarizePlatformScanGroups([]);
  assert.deepEqual(summary.distribution, []);
  assert.equal(summary.totals.all, 0);
  assert.equal(scanPoolPercentage(0, 0), 0);
});

test("invalid aggregate counts fail instead of showing misleading totals", () => {
  assert.throws(() => summarizePlatformScanGroups([
    { district: "Argao", address: null, condition: "Vitiligo", scan_count: "invalid" },
  ]), /Invalid scan count/);
});
