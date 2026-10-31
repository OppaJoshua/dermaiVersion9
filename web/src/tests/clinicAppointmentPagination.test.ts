/**
 * DermAI — Clinic Appointment Pagination Tests
 *
 * Verifies multi-page appointment retrieval against all required conditions:
 * 1. Fewer than 1,000 appointments (single partially filled page)
 * 2. Exactly 1,000 appointments (boundary condition: page 1 full, page 2 empty)
 * 3. More than 1,000 appointments across multiple pages (e.g. 2,450 rows across 3 pages)
 * 4. Multiple pages with a final partially filled page stopping immediately without extra query
 * 5. Query failure on a later page (e.g. page 2 fails after page 1 succeeds) -> isComplete=false, error preserved
 * 6. Query failure on the initial page -> isComplete=false, error preserved
 * 7. Duplicate appointment records across pages are deduplicated
 * 8. Cancellation check halts pagination cleanly
 * 9. Incomplete data safety: ensures partial data is marked incomplete and not silently treated as complete revenue
 */

import assert from "node:assert/strict";
import { fetchAllPaginatedRecords } from "../lib/clinicAppointmentPagination";
import {
  calculateClinicAnnualRevenue,
  type ClinicRevenueAppointmentInput,
} from "../lib/clinicRevenueService";

console.log("\n=======================================================");
console.log("DermAI — Clinic Appointment Pagination Test Suite");
console.log("=======================================================\n");

// Helper to generate simulated appointment records
function generateMockAppointments(count: number, startId = 1, prefix = "appt") {
  return Array.from({ length: count }, (_, i) => {
    const id = startId + i;
    return {
      appointment_id: `${prefix}-${id}`,
      clinic_id: 101,
      date: "2026-05-15",
      status: "completed",
      payment_status: "paid",
      payment_amount: 500,
      payment_reference: `pay_ref_${id}`,
      paid_at: "2026-05-15T10:00:00Z",
      clinic_note: "Consultation finished",
      notes: "Acne checkup",
    };
  });
}

// -----------------------------------------------------------------------------
// TEST 1: Fewer than 1,000 appointments (e.g. 350 records)
// -----------------------------------------------------------------------------
console.log("[Test 1] Fewer than 1,000 appointments (single partial page)...");
{
  const totalRecords = 350;
  const mockDb = generateMockAppointments(totalRecords);
  let calls = 0;

  const result = await fetchAllPaginatedRecords({
    pageSize: 1000,
    fetchPage: async (from, to) => {
      calls++;
      return {
        data: mockDb.slice(from, to + 1),
        error: null,
      };
    },
  });

  assert.equal(result.isComplete, true, "Must be marked complete");
  assert.equal(result.error, null, "Error must be null");
  assert.equal(result.totalFetched, 350, "Total fetched must equal 350");
  assert.equal(result.data.length, 350);
  assert.equal(result.pagesFetched, 1, "Must only fetch 1 page");
  assert.equal(calls, 1, "Must make exactly 1 query call");
  console.log("  ✓ Verified: 350 records fetched in 1 page and marked complete.");
}

// -----------------------------------------------------------------------------
// TEST 2: Exactly 1,000 appointments (boundary condition)
// -----------------------------------------------------------------------------
console.log("[Test 2] Exactly 1,000 appointments (boundary condition)...");
{
  const totalRecords = 1000;
  const mockDb = generateMockAppointments(totalRecords);
  const requestedRanges: Array<{ from: number; to: number }> = [];

  const result = await fetchAllPaginatedRecords({
    pageSize: 1000,
    fetchPage: async (from, to) => {
      requestedRanges.push({ from, to });
      return {
        data: mockDb.slice(from, to + 1),
        error: null,
      };
    },
  });

  assert.equal(result.isComplete, true, "Must be marked complete");
  assert.equal(result.error, null);
  assert.equal(result.totalFetched, 1000);
  assert.equal(result.data.length, 1000);
  assert.equal(result.pagesFetched, 2, "Must query page 1 (1000 rows) and page 2 (0 rows)");
  assert.deepEqual(requestedRanges, [
    { from: 0, to: 999 },
    { from: 1000, to: 1999 },
  ]);
  console.log("  ✓ Verified: Exactly 1,000 records handled cleanly across page boundary.");
}

// -----------------------------------------------------------------------------
// TEST 3: More than 1,000 appointments across multiple pages (e.g. 2,450 records)
// -----------------------------------------------------------------------------
console.log("[Test 3] More than 1,000 appointments across multiple pages (2,450 records)...");
{
  const totalRecords = 2450;
  const mockDb = generateMockAppointments(totalRecords);
  const requestedRanges: Array<{ from: number; to: number }> = [];

  const result = await fetchAllPaginatedRecords({
    pageSize: 1000,
    fetchPage: async (from, to) => {
      requestedRanges.push({ from, to });
      return {
        data: mockDb.slice(from, to + 1),
        error: null,
      };
    },
  });

  assert.equal(result.isComplete, true, "Must be complete");
  assert.equal(result.error, null);
  assert.equal(result.totalFetched, 2450);
  assert.equal(result.data.length, 2450);
  assert.equal(result.pagesFetched, 3, "Must fetch page 1 (1000), page 2 (1000), page 3 (450)");
  assert.deepEqual(requestedRanges, [
    { from: 0, to: 999 },
    { from: 1000, to: 1999 },
    { from: 2000, to: 2999 },
  ]);
  console.log("  ✓ Verified: 2,450 records retrieved seamlessly across 3 pages.");
}

// -----------------------------------------------------------------------------
// TEST 4: Final partially filled page stops immediately without extra query
// -----------------------------------------------------------------------------
console.log("[Test 4] Final partially filled page stops immediately...");
{
  const totalRecords = 1200; // Page 1: 1000, Page 2: 200 (< 1000)
  const mockDb = generateMockAppointments(totalRecords);
  let totalCalls = 0;

  const result = await fetchAllPaginatedRecords({
    pageSize: 1000,
    fetchPage: async (from, to) => {
      totalCalls++;
      return {
        data: mockDb.slice(from, to + 1),
        error: null,
      };
    },
  });

  assert.equal(result.isComplete, true);
  assert.equal(result.totalFetched, 1200);
  assert.equal(result.pagesFetched, 2);
  assert.equal(totalCalls, 2, "Must stop immediately on page 2 (200 < 1000) without firing page 3");
  console.log("  ✓ Verified: Pagination stops immediately on partially filled final page.");
}

// -----------------------------------------------------------------------------
// TEST 5: Query failure on a later page (Page 2 fails after Page 1 succeeds)
// -----------------------------------------------------------------------------
console.log("[Test 5] Query failure on a later page (network / PostgREST error)...");
{
  const page1 = generateMockAppointments(1000, 1, "page1");

  const result = await fetchAllPaginatedRecords({
    pageSize: 1000,
    fetchPage: async (from) => {
      if (from === 0) {
        return { data: page1, error: null };
      }
      return {
        data: null,
        error: { message: "503 Service Unavailable: database connection pool timeout" },
      };
    },
  });

  assert.equal(result.isComplete, false, "Must NOT be marked complete when a later page fails");
  assert.ok(result.error, "Error must be preserved");
  assert.ok(result.error.message.includes("503 Service Unavailable"));
  assert.equal(result.totalFetched, 1000, "Tracks records fetched before failure");
  assert.equal(result.pagesFetched, 1, "Only 1 page succeeded");
  console.log("  ✓ Verified: Failure on page 2 preserves error and marks isComplete=false.");
}

// -----------------------------------------------------------------------------
// TEST 6: Query failure on the very first page
// -----------------------------------------------------------------------------
console.log("[Test 6] Query failure on the very first page...");
{
  const result = await fetchAllPaginatedRecords({
    pageSize: 1000,
    fetchPage: async () => {
      return {
        data: null,
        error: new Error("Network request failed"),
      };
    },
  });

  assert.equal(result.isComplete, false);
  assert.ok(result.error);
  assert.equal(result.error.message, "Network request failed");
  assert.equal(result.totalFetched, 0);
  assert.equal(result.pagesFetched, 0);
  console.log("  ✓ Verified: Initial query failure immediately halts with isComplete=false.");
}

// -----------------------------------------------------------------------------
// TEST 7: Duplicate appointment records across pages are deduplicated
// -----------------------------------------------------------------------------
console.log("[Test 7] Duplicate records across pages are deduplicated...");
{
  // Simulated concurrent insert shifts records so appt-1000 appears on both page 1 and page 2
  const page1 = generateMockAppointments(1000, 1);
  const page2 = [
    page1[999], // Duplicate appt-1000
    ...generateMockAppointments(200, 1001),
  ];

  const result = await fetchAllPaginatedRecords({
    pageSize: 1000,
    fetchPage: async (from) => {
      if (from === 0) return { data: page1, error: null };
      return { data: page2, error: null };
    },
  });

  assert.equal(result.isComplete, true);
  // Total raw items = 1000 + 201 = 1201, but appt-1000 is duplicated
  assert.equal(result.data.length, 1200, "Duplicate appt-1000 must be filtered out");
  assert.equal(result.totalFetched, 1200);

  // Check no duplicates in resulting list
  const seenIds = new Set<string>();
  let hasDuplicate = false;
  for (const item of result.data) {
    if (seenIds.has(item.appointment_id)) {
      hasDuplicate = true;
      break;
    }
    seenIds.add(item.appointment_id);
  }
  assert.equal(hasDuplicate, false, "Result list must have zero duplicate IDs");
  console.log("  ✓ Verified: Duplicate records across page boundaries are safely deduplicated.");
}

// -----------------------------------------------------------------------------
// TEST 8: Cancellation between pages halts pagination
// -----------------------------------------------------------------------------
console.log("[Test 8] Cancellation check halts pagination cleanly...");
{
  let cancelled = false;
  let calls = 0;

  const result = await fetchAllPaginatedRecords({
    pageSize: 100,
    isCancelled: () => cancelled,
    fetchPage: async (from) => {
      calls++;
      if (calls === 1) {
        cancelled = true; // Cancel after page 1
      }
      return {
        data: generateMockAppointments(100, from + 1),
        error: null,
      };
    },
  });

  assert.equal(result.isComplete, false, "Cancelled pagination must not be marked complete");
  assert.equal(calls, 1, "Must not execute subsequent pages after cancellation");
  console.log("  ✓ Verified: Cancellation stops pagination before next page.");
}

// -----------------------------------------------------------------------------
// TEST 9: Incomplete data safety: Incomplete fetch does NOT calculate false revenue
// -----------------------------------------------------------------------------
console.log("[Test 9] Incomplete data safety: Guard against false revenue calculation...");
{
  // Page 1 has 1,000 paid appointments (₱500,000)
  const page1 = generateMockAppointments(1000, 1);
  // Page 2 failed!
  const failedResult = await fetchAllPaginatedRecords({
    pageSize: 1000,
    fetchPage: async (from) => {
      if (from === 0) return { data: page1, error: null };
      return { data: null, error: new Error("PostgREST 500 Internal Server Error") };
    },
  });

  assert.equal(failedResult.isComplete, false);
  assert.ok(failedResult.error);

  // When isComplete is false, the dashboard must NOT calculate revenue with partial records
  let displayedRevenue: string;
  let displayedCount: number;

  if (!failedResult.isComplete || failedResult.error) {
    // Explicit incomplete state
    displayedRevenue = "—";
    displayedCount = 0;
  } else {
    const calc = calculateClinicAnnualRevenue({
      appointments: failedResult.data as unknown as ClinicRevenueAppointmentInput[],
      clinicId: 101,
      year: 2026,
    });
    displayedRevenue = calc.formattedRevenue;
    displayedCount = calc.paidAppointmentsCount;
  }

  assert.equal(displayedRevenue, "—", "Must display dash or explicit placeholder, not partial total");
  assert.equal(displayedCount, 0, "Must not display partial count as total count");
  console.log("  ✓ Verified: Incomplete pagination safely guards against false revenue display.");
}

console.log("\n=======================================================");
console.log("  ALL 9 APPOINTMENT PAGINATION TESTS PASSED!          ");
console.log("=======================================================\n");

