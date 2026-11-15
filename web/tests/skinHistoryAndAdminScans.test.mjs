import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const patientSkinHistoryPath = path.resolve(__dirname, "../src/pages/patient/SkinHistoryPage.tsx");
const adminAiManagementPath = path.resolve(__dirname, "../src/pages/admin/AdminAiAnalysisManagement.tsx");
const subscriptionServicePath = path.resolve(__dirname, "../src/lib/subscriptionService.ts");

const patientSkinHistoryCode = fs.readFileSync(patientSkinHistoryPath, "utf-8");
const adminAiManagementCode = fs.readFileSync(adminAiManagementPath, "utf-8");
const subscriptionServiceCode = fs.readFileSync(subscriptionServicePath, "utf-8");

test("Skin History and Admin AI Analysis Regression Suite", async (t) => {
  await t.test("Patient Skin History query includes all valid completed/flagged scan statuses", () => {
    // 1. Must use .in("status", ["completed", "valid", "flagged", "invalid"])
    assert.match(
      patientSkinHistoryCode,
      /\.in\(\s*["']status["']\s*,\s*\[\s*["']completed["']\s*,\s*["']valid["']\s*,\s*["']flagged["']\s*,\s*["']invalid["']\s*\]\s*\)/,
      "Patient SkinHistoryPage must query status in completed, valid, flagged, invalid"
    );

    // 2. Must not use restrictive .eq("status", "completed") which hides flagged/reviewed scans
    assert.doesNotMatch(
      patientSkinHistoryCode,
      /\.eq\(\s*["']status["']\s*,\s*["']completed["']\s*\)/,
      "Patient SkinHistoryPage must NOT restrict query to status=completed"
    );
  });

  await t.test("Patient Skin History distinguishes error state from genuine empty history", () => {
    // Error state and retry handling
    assert.ok(patientSkinHistoryCode.includes("fetchError"), "SkinHistoryPage must track fetchError state");
    assert.ok(patientSkinHistoryCode.includes("retry") || patientSkinHistoryCode.includes("Retry"), "SkinHistoryPage must provide a retry mechanism");
    assert.ok(patientSkinHistoryCode.includes("Unable to load skin history") || patientSkinHistoryCode.includes("Failed to load"), "SkinHistoryPage must provide clear error messaging");
    assert.ok(patientSkinHistoryCode.includes("No History Found"), "SkinHistoryPage must preserve empty state messaging when records are genuinely empty");
  });

  await t.test("Patient Skin History safety badges and medical disclaimers for unreviewed/flagged scans", () => {
    // Medical safety: flagged scans must show 'Under Review' and not claim verified medical status
    assert.ok(patientSkinHistoryCode.includes("Under Review"), "Flagged scans must indicate 'Under Review'");
    assert.ok(patientSkinHistoryCode.includes("Reviewed"), "Valid reviewed scans must indicate 'Reviewed'");
    assert.ok(
      patientSkinHistoryCode.includes("Pending Clinical Review") ||
      patientSkinHistoryCode.includes("clinical review") ||
      patientSkinHistoryCode.includes("Pending Medical Review"),
      "Must include safety advisory for flagged/unreviewed analyses"
    );
  });

  await t.test("Admin AI Analysis Management queries actual database column scanned_at instead of created_at", () => {
    // Must order by scanned_at
    assert.match(
      adminAiManagementCode,
      /\.order\(\s*["']scanned_at["']\s*,\s*\{\s*ascending:\s*false\s*\}\s*\)/,
      "AdminAiAnalysisManagement must order by scanned_at descending"
    );

    // Must NOT order by non-existent created_at column
    assert.doesNotMatch(
      adminAiManagementCode,
      /\.order\(\s*["']created_at["']/,
      "AdminAiAnalysisManagement must NOT attempt to order by non-existent created_at column"
    );
  });

  await t.test("Admin AI Analysis Management waits for auth session before querying RLS-protected records", () => {
    // Must use useAuth and check authLoading
    assert.ok(adminAiManagementCode.includes("useAuth"), "AdminAiAnalysisManagement must import and use useAuth");
    assert.ok(
      adminAiManagementCode.includes("if (authLoading) return;") || adminAiManagementCode.includes("authLoading"),
      "AdminAiAnalysisManagement must guard against premature unauthenticated query execution"
    );
  });

  await t.test("Admin AI Analysis Management distinguishes loading, error, empty, and record states", () => {
    assert.ok(adminAiManagementCode.includes("isLoading"), "AdminAiAnalysisManagement must track isLoading state");
    assert.ok(adminAiManagementCode.includes("loadError"), "AdminAiAnalysisManagement must track loadError state");
    assert.ok(adminAiManagementCode.includes("Failed to load analyses"), "AdminAiAnalysisManagement must have clear error feedback");
    assert.ok(adminAiManagementCode.includes("No analyses found"), "AdminAiAnalysisManagement must display empty state when 0 records match");
    assert.ok(adminAiManagementCode.includes("RefreshCw") || adminAiManagementCode.includes("Retry"), "AdminAiAnalysisManagement must provide refresh/retry functionality");
  });

  await t.test("Admin AI Analysis Management stat cards reflect correct filtering thresholds", () => {
    // Low confidence threshold is strictly 60%
    assert.ok(
      adminAiManagementCode.includes("confidence < 60"),
      "Stat card and filter for low confidence must check confidence < 60"
    );
    // Flagged and invalid counts
    assert.ok(
      adminAiManagementCode.includes('status === "flagged"'),
      "Stat card for flagged must check status === 'flagged'"
    );
    assert.ok(
      adminAiManagementCode.includes('status === "invalid"'),
      "Stat card for invalid must check status === 'invalid'"
    );
  });

  await t.test("Alignment with canonical subscription service consumed scan statuses", () => {
    // Check CONSUMED_SCAN_STATUSES in subscriptionService.ts
    assert.match(
      subscriptionServiceCode,
      /export const CONSUMED_SCAN_STATUSES\s*=\s*\[\s*"completed",\s*"valid",\s*"flagged",\s*"invalid",?\s*\]/,
      "subscriptionService CONSUMED_SCAN_STATUSES must define canonical scan statuses"
    );
  });
});
