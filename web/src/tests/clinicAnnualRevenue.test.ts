/**
 * DermAI — Annual Clinic Revenue Unit & Regression Tests
 *
 * Verifies the annual clinic revenue calculation against all 12 mandatory business rules
 * plus the 6 audit remediation regression requirements:
 *
 * Baseline Rules:
 * 1. December payment for a January consultation -> attributed to January's year
 * 2. January 1 annual reset -> ₱0.00 with zero eligible appointments
 * 3. Switching between current and previous years -> displays only that year's revenue
 * 4. Paid completed, scheduled, and accepted appointments -> included
 * 5. Completed but unpaid appointments -> strictly excluded
 * 6. Cancelled and rejected appointments -> strictly excluded
 * 7. Pending, failed, and expired payments -> strictly excluded
 * 8. Refunded appointments -> strictly excluded
 * 9. Overpayments -> excludes excess liability, counts only consultation fee
 * 10. Legacy appointments with missing payment amount -> uses clinic consultation fee fallback if verified paid
 * 11. Missing or invalid consultation dates -> excluded (never fall back to createdAt)
 * 12. Clinic data isolation -> appointments from other clinics are excluded
 *
 * Audit Remediation Regression Tests:
 * 13. Direct Supabase mapper payment_status and payment_amount support
 * 14. Patient-entered notes with "Paid counter cash" must NEVER establish payment
 * 15. Patient-entered notes with "paid online" must NEVER establish payment
 * 16. Clinic notes claiming payment NEVER establish payment without payment_status='paid' (Online only)
 * 17. Duplicate appointment IDs are counted only once (internal deduplication)
 * 18. Different appointments with missing IDs are evaluated independently without accidental merging
 */

import assert from "node:assert/strict";
import {
  calculateClinicAnnualRevenue,
  getAppointmentManilaYear,
  getAvailableRevenueYears,
  isExplicitlyPaidAppointment,
  isRefundedAppointment,
  REFUND_EXTERNAL_DISCLAIMER,
  type ClinicRevenueAppointmentInput,
} from "../lib/clinicRevenueService";

console.log("\n=======================================================");
console.log("DermAI — Annual Clinic Revenue Calculation Test Suite");
console.log("=======================================================\n");

const TARGET_CLINIC_ID = 101;
const OTHER_CLINIC_ID = 202;
const STANDARD_CLINIC_FEE = 600;

// -----------------------------------------------------------------------------
// SCENARIO 1: December Payment for a January Consultation
// -----------------------------------------------------------------------------
console.log("[Scenario 1] December payment for a January consultation...");
{
  // Consultation is on January 5, 2026. Payment was captured December 28, 2025.
  const appt: ClinicRevenueAppointmentInput = {
    id: "appt-cross-year-1",
    clinicId: TARGET_CLINIC_ID,
    date: "2026-01-05", // Consultation scheduled in Jan 2026
    rawDate: "2026-01-05",
    createdAt: "2025-12-28T14:30:00.000Z", // Paid in late Dec 2025
    created_at: "2025-12-28T14:30:00.000Z",
    status: "scheduled",
    paymentStatus: "paid",
    paymentAmount: 650,
  };

  const year2025Result = calculateClinicAnnualRevenue({
    appointments: [appt],
    clinicId: TARGET_CLINIC_ID,
    year: 2025,
    clinicFee: STANDARD_CLINIC_FEE,
  });

  const year2026Result = calculateClinicAnnualRevenue({
    appointments: [appt],
    clinicId: TARGET_CLINIC_ID,
    year: 2026,
    clinicFee: STANDARD_CLINIC_FEE,
  });

  assert.equal(year2025Result.totalRevenue, 0, "Must NOT be counted in 2025 revenue");
  assert.equal(year2025Result.paidAppointmentsCount, 0, "2025 count must be 0");
  assert.equal(year2026Result.totalRevenue, 650, "Must be attributed to 2026 consultation year");
  assert.equal(year2026Result.paidAppointmentsCount, 1, "2026 count must be 1");
  console.log("  ✓ Verified: Revenue attributed strictly to consultation date (2026), not payment date (2025).");
}

// -----------------------------------------------------------------------------
// SCENARIO 2: January 1 Annual Reset
// -----------------------------------------------------------------------------
console.log("[Scenario 2] January 1 annual reset -> ₱0.00 with zero eligible appointments...");
{
  // Clinic has multiple paid appointments in 2025, but none yet in 2026
  const appointments2025: ClinicRevenueAppointmentInput[] = [
    {
      id: "appt-2025-1",
      clinicId: TARGET_CLINIC_ID,
      date: "2025-06-15",
      status: "completed",
      paymentStatus: "paid",
      paymentAmount: 700,
    },
    {
      id: "appt-2025-2",
      clinicId: TARGET_CLINIC_ID,
      date: "2025-11-20",
      status: "completed",
      paymentStatus: "paid",
      paymentAmount: 800,
    },
  ];

  const result2026 = calculateClinicAnnualRevenue({
    appointments: appointments2025,
    clinicId: TARGET_CLINIC_ID,
    year: 2026,
    clinicFee: STANDARD_CLINIC_FEE,
  });

  assert.equal(result2026.totalRevenue, 0, "Revenue on Jan 1 must begin at 0");
  assert.equal(result2026.paidAppointmentsCount, 0, "Paid count on Jan 1 must begin at 0");
  assert.equal(result2026.formattedRevenue, "₱0.00", "Formatted revenue must be ₱0.00");
  assert.equal(result2026.eligibleAppointments.length, 0);
  console.log("  ✓ Verified: On January 1, annual revenue displays ₱0.00 without modifying historical records.");
}

// -----------------------------------------------------------------------------
// SCENARIO 3: Switching Between Current and Previous Years
// -----------------------------------------------------------------------------
console.log("[Scenario 3] Switching between current and previous years displays only that year's revenue...");
{
  const multiYearAppointments: ClinicRevenueAppointmentInput[] = [
    {
      id: "appt-2024",
      clinicId: TARGET_CLINIC_ID,
      date: "2024-08-10",
      status: "completed",
      paymentStatus: "paid",
      paymentAmount: 500,
    },
    {
      id: "appt-2025",
      clinicId: TARGET_CLINIC_ID,
      date: "2025-04-12",
      status: "completed",
      paymentStatus: "paid",
      paymentAmount: 600,
    },
    {
      id: "appt-2026",
      clinicId: TARGET_CLINIC_ID,
      date: "2026-03-15",
      status: "scheduled",
      paymentStatus: "paid",
      paymentAmount: 750,
    },
  ];

  const res2024 = calculateClinicAnnualRevenue({
    appointments: multiYearAppointments,
    clinicId: TARGET_CLINIC_ID,
    year: 2024,
  });
  const res2025 = calculateClinicAnnualRevenue({
    appointments: multiYearAppointments,
    clinicId: TARGET_CLINIC_ID,
    year: 2025,
  });
  const res2026 = calculateClinicAnnualRevenue({
    appointments: multiYearAppointments,
    clinicId: TARGET_CLINIC_ID,
    year: 2026,
  });

  assert.equal(res2024.totalRevenue, 500, "2024 revenue must be exactly ₱500");
  assert.equal(res2025.totalRevenue, 600, "2025 revenue must be exactly ₱600");
  assert.equal(res2026.totalRevenue, 750, "2026 revenue must be exactly ₱750");

  const availableYears = getAvailableRevenueYears(multiYearAppointments, 2026);
  assert.deepEqual(availableYears, [2026, 2025, 2024], "Available years must be sorted descending");
  console.log("  ✓ Verified: Multi-year filtering is mutually exclusive with zero cross-year leakage.");
}

// -----------------------------------------------------------------------------
// SCENARIO 4: Paid Completed, Scheduled, and Accepted Appointments Included
// -----------------------------------------------------------------------------
console.log("[Scenario 4] Paid completed, scheduled, and accepted appointments included...");
{
  const eligibleAppointments: ClinicRevenueAppointmentInput[] = [
    {
      id: "appt-completed",
      clinicId: TARGET_CLINIC_ID,
      date: "2026-02-10",
      status: "completed",
      paymentStatus: "paid",
      paymentAmount: 600,
    },
    {
      id: "appt-scheduled",
      clinicId: TARGET_CLINIC_ID,
      date: "2026-02-11",
      status: "scheduled",
      paymentStatus: "paid",
      paymentAmount: 650,
    },
    {
      id: "appt-accepted",
      clinicId: TARGET_CLINIC_ID,
      date: "2026-02-12",
      status: "accepted",
      paymentStatus: "paid",
      paymentAmount: 700,
    },
    {
      id: "appt-confirmed",
      clinicId: TARGET_CLINIC_ID,
      date: "2026-02-13",
      status: "confirmed",
      paymentStatus: "paid",
      paymentAmount: 550,
    },
  ];

  const result = calculateClinicAnnualRevenue({
    appointments: eligibleAppointments,
    clinicId: TARGET_CLINIC_ID,
    year: 2026,
  });

  assert.equal(result.paidAppointmentsCount, 4, "All 4 eligible statuses must be counted");
  assert.equal(result.totalRevenue, 600 + 650 + 700 + 550, "Total must sum all 4 eligible consultations");
  console.log("  ✓ Verified: Confirmed paid appointments across scheduled, accepted, completed are counted.");
}

// -----------------------------------------------------------------------------
// SCENARIO 5: Completed But Unpaid Appointments Excluded
// -----------------------------------------------------------------------------
console.log("[Scenario 5] Completed but unpaid appointments strictly excluded...");
{
  const completedUnpaidAppt: ClinicRevenueAppointmentInput = {
    id: "appt-unpaid-completed",
    clinicId: TARGET_CLINIC_ID,
    date: "2026-03-01",
    status: "completed",
    paymentStatus: "unpaid", // Or undefined
    paymentAmount: 650,
  };

  const result = calculateClinicAnnualRevenue({
    appointments: [completedUnpaidAppt],
    clinicId: TARGET_CLINIC_ID,
    year: 2026,
    clinicFee: STANDARD_CLINIC_FEE,
  });

  assert.equal(result.totalRevenue, 0, "Completed status alone must NOT grant revenue");
  assert.equal(result.paidAppointmentsCount, 0, "Unpaid completed consultation must not increment count");
  assert.equal(result.excludedRecords.length, 1);
  assert.equal(result.excludedRecords[0].reason, "unpaid");
  console.log("  ✓ Verified: Completed status alone without confirmed payment is strictly excluded.");
}

// -----------------------------------------------------------------------------
// SCENARIO 6: Cancelled and Rejected Appointments Excluded
// -----------------------------------------------------------------------------
console.log("[Scenario 6] Cancelled and rejected appointments strictly excluded...");
{
  const cancelledAndRejected: ClinicRevenueAppointmentInput[] = [
    {
      id: "appt-cancelled",
      clinicId: TARGET_CLINIC_ID,
      date: "2026-04-01",
      status: "cancelled",
      paymentStatus: "paid", // Even if payment was captured prior to cancellation
      paymentAmount: 600,
    },
    {
      id: "appt-rejected-clinic",
      clinicId: TARGET_CLINIC_ID,
      date: "2026-04-02",
      status: "rejected",
      paymentStatus: "paid",
      paymentAmount: 600,
    },
    {
      id: "appt-rejected-doctor",
      clinicId: TARGET_CLINIC_ID,
      date: "2026-04-03",
      status: "scheduled",
      doctorStatus: "rejected",
      paymentStatus: "paid",
      paymentAmount: 600,
    },
  ];

  const result = calculateClinicAnnualRevenue({
    appointments: cancelledAndRejected,
    clinicId: TARGET_CLINIC_ID,
    year: 2026,
  });

  assert.equal(result.totalRevenue, 0, "Cancelled/rejected consultations must not be counted in revenue");
  assert.equal(result.paidAppointmentsCount, 0);
  assert.equal(result.excludedRecords.length, 3);
  result.excludedRecords.forEach((item) => {
    assert.equal(item.reason, "cancelled_or_rejected");
  });
  console.log("  ✓ Verified: Cancelled appointments and clinic/doctor rejections are strictly excluded.");
}

// -----------------------------------------------------------------------------
// SCENARIO 7: Pending, Failed, and Expired Payments Excluded
// -----------------------------------------------------------------------------
console.log("[Scenario 7] Pending, failed, and expired payments strictly excluded...");
{
  const pendingFailedExpired: ClinicRevenueAppointmentInput[] = [
    {
      id: "appt-pending",
      clinicId: TARGET_CLINIC_ID,
      date: "2026-05-01",
      status: "scheduled",
      paymentStatus: "pending",
      paymentAmount: 600,
    },
    {
      id: "appt-failed",
      clinicId: TARGET_CLINIC_ID,
      date: "2026-05-02",
      status: "scheduled",
      paymentStatus: "failed",
      paymentAmount: 600,
    },
    {
      id: "appt-expired",
      clinicId: TARGET_CLINIC_ID,
      date: "2026-05-03",
      status: "scheduled",
      paymentStatus: "expired",
      paymentAmount: 600,
    },
  ];

  const result = calculateClinicAnnualRevenue({
    appointments: pendingFailedExpired,
    clinicId: TARGET_CLINIC_ID,
    year: 2026,
  });

  assert.equal(result.totalRevenue, 0, "Pending/failed/expired payments must produce 0 revenue");
  assert.equal(result.paidAppointmentsCount, 0);
  console.log("  ✓ Verified: Unpaid pending, failed, and expired payment states are strictly excluded.");
}

// -----------------------------------------------------------------------------
// SCENARIO 8: Refunded Appointments Excluded
// -----------------------------------------------------------------------------
console.log("[Scenario 8] Refunded appointments strictly excluded...");
{
  const refundedAppointments: ClinicRevenueAppointmentInput[] = [
    {
      id: "appt-refunded-status",
      clinicId: TARGET_CLINIC_ID,
      date: "2026-06-01",
      status: "completed",
      paymentStatus: "refunded",
      paymentAmount: 700,
    },
    {
      id: "appt-refunded-note",
      clinicId: TARGET_CLINIC_ID,
      date: "2026-06-02",
      status: "completed",
      paymentStatus: "paid",
      clinicNote: "Patient cancelled due to emergency. [REFUNDED] via PayMongo.",
      paymentAmount: 700,
    },
  ];

  assert.equal(isRefundedAppointment(refundedAppointments[0]), true, "Status refunded must return true");
  assert.equal(isRefundedAppointment(refundedAppointments[1]), true, "[REFUNDED] in notes must return true");
  assert.ok(REFUND_EXTERNAL_DISCLAIMER.includes("PayMongo"));

  const result = calculateClinicAnnualRevenue({
    appointments: refundedAppointments,
    clinicId: TARGET_CLINIC_ID,
    year: 2026,
  });

  assert.equal(result.totalRevenue, 0, "Refunded consultations must be excluded from earned revenue");
  assert.equal(result.paidAppointmentsCount, 0);
  assert.equal(result.excludedRecords.length, 2);
  assert.equal(result.excludedRecords[0].reason, "refunded");
  assert.equal(result.excludedRecords[1].reason, "refunded");
  console.log("  ✓ Verified: Refunded appointments (via status or [REFUNDED] fallback) are excluded.");
}

// -----------------------------------------------------------------------------
// SCENARIO 9: Overpayments Excluded From Earned Revenue
// -----------------------------------------------------------------------------
console.log("[Scenario 9] Overpayments excluded from earned revenue...");
{
  // User paid ₱800 total at checkout (₱650 consultation fee + ₱150 overpayment)
  // patient_appointment.payment_amount stores 650 (the consultation fee)
  const overpaidAppointment: ClinicRevenueAppointmentInput = {
    id: "appt-overpayment-test",
    clinicId: TARGET_CLINIC_ID,
    date: "2026-07-15",
    status: "completed",
    paymentStatus: "paid",
    paymentAmount: 650, // Consultation fee only
    clinicNote: "Captured payment: ₱800.00 (Overpayment: ₱150.00 recorded in user_payment)",
  };

  const result = calculateClinicAnnualRevenue({
    appointments: [overpaidAppointment],
    clinicId: TARGET_CLINIC_ID,
    year: 2026,
    clinicFee: STANDARD_CLINIC_FEE,
  });

  assert.equal(result.totalRevenue, 650, "Earned revenue must be exactly the consultation fee (₱650), NOT ₱800");
  assert.equal(result.paidAppointmentsCount, 1);
  console.log("  ✓ Verified: Overpayments are excluded from earned revenue; only consultation fee is counted.");
}

// -----------------------------------------------------------------------------
// SCENARIO 10: Legacy Appointments Missing Payment Amount Fallback to Clinic Fee
// -----------------------------------------------------------------------------
console.log("[Scenario 10] Legacy appointments with missing payment amount use clinic fee fallback...");
{
  const legacyPaidAppointment: ClinicRevenueAppointmentInput = {
    id: "appt-legacy-paid",
    clinicId: TARGET_CLINIC_ID,
    date: "2026-08-01",
    status: "completed",
    paymentStatus: "paid",
    paymentAmount: null, // Legacy record without stored payment amount
  };

  const legacyUnpaidAppointment: ClinicRevenueAppointmentInput = {
    id: "appt-legacy-unpaid",
    clinicId: TARGET_CLINIC_ID,
    date: "2026-08-02",
    status: "completed",
    paymentStatus: "unpaid",
    paymentAmount: null,
  };

  const resultPaid = calculateClinicAnnualRevenue({
    appointments: [legacyPaidAppointment],
    clinicId: TARGET_CLINIC_ID,
    year: 2026,
    clinicFee: STANDARD_CLINIC_FEE,
  });

  const resultUnpaid = calculateClinicAnnualRevenue({
    appointments: [legacyUnpaidAppointment],
    clinicId: TARGET_CLINIC_ID,
    year: 2026,
    clinicFee: STANDARD_CLINIC_FEE,
  });

  assert.equal(resultPaid.totalRevenue, STANDARD_CLINIC_FEE, "Verified paid legacy record must use clinic consultation fee");
  assert.equal(resultPaid.paidAppointmentsCount, 1);

  assert.equal(resultUnpaid.totalRevenue, 0, "Unpaid legacy record must NEVER receive the clinic consultation fee");
  assert.equal(resultUnpaid.paidAppointmentsCount, 0);
  console.log("  ✓ Verified: Fallback consultation fee applies only to verified paid legacy records.");
}

// -----------------------------------------------------------------------------
// SCENARIO 11: Missing or Invalid Consultation Dates Excluded
// -----------------------------------------------------------------------------
console.log("[Scenario 11] Missing or invalid consultation dates excluded...");
{
  const missingDateAppointments: ClinicRevenueAppointmentInput[] = [
    {
      id: "appt-missing-date-1",
      clinicId: TARGET_CLINIC_ID,
      date: undefined,
      rawDate: undefined,
      createdAt: "2026-09-01T10:00:00.000Z", // Must NOT fall back to createdAt
      status: "completed",
      paymentStatus: "paid",
      paymentAmount: 600,
    },
    {
      id: "appt-invalid-date-2",
      clinicId: TARGET_CLINIC_ID,
      date: "Schedule pending",
      rawDate: "Schedule pending",
      createdAt: "2026-09-02T10:00:00.000Z",
      status: "completed",
      paymentStatus: "paid",
      paymentAmount: 600,
    },
    {
      id: "appt-corrupt-date-3",
      clinicId: TARGET_CLINIC_ID,
      date: "not-a-valid-date-string",
      status: "completed",
      paymentStatus: "paid",
      paymentAmount: 600,
    },
  ];

  assert.equal(getAppointmentManilaYear(missingDateAppointments[0]), null, "Missing date must return null year");
  assert.equal(getAppointmentManilaYear(missingDateAppointments[1]), null, "Schedule pending must return null year");
  assert.equal(getAppointmentManilaYear({ date: "2026-10-31" }), 2026, "Valid date must return correct year");

  const result = calculateClinicAnnualRevenue({
    appointments: missingDateAppointments,
    clinicId: TARGET_CLINIC_ID,
    year: 2026,
  });

  assert.equal(result.totalRevenue, 0, "Appointments with missing or invalid consultation dates must be excluded");
  assert.equal(result.paidAppointmentsCount, 0);
  assert.equal(result.excludedRecords.length, 3);
  result.excludedRecords.forEach((item) => {
    assert.equal(item.reason, "missing_or_invalid_consultation_date");
  });
  console.log("  ✓ Verified: Records with missing/invalid consultation dates are excluded and never fall back to createdAt.");
}

// -----------------------------------------------------------------------------
// SCENARIO 12: Clinic Data Isolation
// -----------------------------------------------------------------------------
console.log("[Scenario 12] Clinic data isolation strictly enforced...");
{
  const clinicIsolationAppointments: ClinicRevenueAppointmentInput[] = [
    {
      id: "appt-clinic-101",
      clinicId: TARGET_CLINIC_ID,
      date: "2026-10-10",
      status: "completed",
      paymentStatus: "paid",
      paymentAmount: 600,
    },
    {
      id: "appt-clinic-202",
      clinicId: OTHER_CLINIC_ID, // Different clinic
      date: "2026-10-10",
      status: "completed",
      paymentStatus: "paid",
      paymentAmount: 1200,
    },
    {
      id: "appt-clinic-unassigned",
      clinicId: undefined, // Missing clinic
      date: "2026-10-10",
      status: "completed",
      paymentStatus: "paid",
      paymentAmount: 900,
    },
  ];

  const result101 = calculateClinicAnnualRevenue({
    appointments: clinicIsolationAppointments,
    clinicId: TARGET_CLINIC_ID,
    year: 2026,
  });

  const result202 = calculateClinicAnnualRevenue({
    appointments: clinicIsolationAppointments,
    clinicId: OTHER_CLINIC_ID,
    year: 2026,
  });

  assert.equal(result101.totalRevenue, 600, "Clinic 101 revenue must only count Clinic 101 appointments");
  assert.equal(result101.paidAppointmentsCount, 1);

  assert.equal(result202.totalRevenue, 1200, "Clinic 202 revenue must only count Clinic 202 appointments");
  assert.equal(result202.paidAppointmentsCount, 1);

  console.log("  ✓ Verified: Clinic data isolation is strictly enforced across all calculations.");
}

// =============================================================================
// AUDIT REMEDIATION REGRESSION TESTS (Scenarios 13 - 18)
// =============================================================================

// -----------------------------------------------------------------------------
// SCENARIO 13: Direct Supabase Mapper Payment Fields (payment_status, payment_amount, payment_reference, paid_at)
// -----------------------------------------------------------------------------
console.log("[Scenario 13] Actual payment_status and payment_amount values supplied by Supabase mapper...");
{
  // Simulated row returned from Supabase with direct columns
  const supabaseAppt: ClinicRevenueAppointmentInput = {
    id: "appt-supabase-direct-1",
    clinicId: TARGET_CLINIC_ID,
    date: "2026-03-20",
    status: "scheduled",
    payment_status: "paid", // Direct from Supabase column
    payment_amount: 850.00, // Direct from Supabase column
    payment_reference: "pay_sim_98765",
    paid_at: "2026-03-19T10:00:00.000Z",
    clinicNote: undefined,  // No note required
    notes: "Patient consultation note",
  };

  assert.ok(isExplicitlyPaidAppointment(supabaseAppt), "Direct payment_status='paid' must be recognized as paid");

  const result = calculateClinicAnnualRevenue({
    appointments: [supabaseAppt],
    clinicId: TARGET_CLINIC_ID,
    year: 2026,
    clinicFee: STANDARD_CLINIC_FEE,
  });

  assert.equal(result.totalRevenue, 850.00, "Direct payment_amount from Supabase must be credited");
  assert.equal(result.paidAppointmentsCount, 1);
  console.log("  ✓ Verified: Direct database columns payment_status and payment_amount are authoritative.");
}

// -----------------------------------------------------------------------------
// SCENARIO 14: Patient-Entered Notes with "Paid counter cash" NEVER Establishes Payment
// -----------------------------------------------------------------------------
console.log("[Scenario 14] Patient-entered notes with 'Paid counter cash' must NEVER establish payment...");
{
  // Patient enters "Paid counter cash" in Symptoms & Medical Notes textarea during booking
  const spoofedPatientAppt: ClinicRevenueAppointmentInput = {
    id: "appt-spoofed-counter-note",
    clinicId: TARGET_CLINIC_ID,
    date: "2026-04-10",
    status: "scheduled", // Even if clinic staff approved the schedule
    paymentStatus: undefined,
    payment_status: undefined,
    notes: "Symptoms: Rash on hands. Paid counter cash ₱600 at clinic reception.",
    clinicNote: undefined,
    clinic_note: undefined,
    paymentAmount: 600,
  };

  assert.equal(
    isExplicitlyPaidAppointment(spoofedPatientAppt),
    false,
    "Patient symptoms notes must NEVER establish payment proof"
  );

  const result = calculateClinicAnnualRevenue({
    appointments: [spoofedPatientAppt],
    clinicId: TARGET_CLINIC_ID,
    year: 2026,
    clinicFee: STANDARD_CLINIC_FEE,
  });

  assert.equal(result.totalRevenue, 0, "Spoofed patient note must generate 0 revenue");
  assert.equal(result.paidAppointmentsCount, 0);
  assert.equal(result.excludedRecords.length, 1);
  assert.equal(result.excludedRecords[0].reason, "unpaid");
  console.log("  ✓ Verified: Patient-entered notes containing 'Paid counter cash' are completely ignored.");
}

// -----------------------------------------------------------------------------
// SCENARIO 15: Patient-Entered Notes with "paid online" NEVER Establishes Payment
// -----------------------------------------------------------------------------
console.log("[Scenario 15] Patient-entered notes with 'paid online' must NEVER establish payment...");
{
  // Patient enters "paid online" in Symptoms & Medical Notes
  const spoofedOnlineNoteAppt: ClinicRevenueAppointmentInput = {
    id: "appt-spoofed-online-note",
    clinicId: TARGET_CLINIC_ID,
    date: "2026-04-15",
    status: "completed",
    paymentStatus: undefined,
    payment_status: undefined,
    notes: "I already paid online via GCash ref #9988776655",
    clinicNote: undefined,
    paymentAmount: 650,
  };

  assert.equal(
    isExplicitlyPaidAppointment(spoofedOnlineNoteAppt),
    false,
    "Patient notes claiming online payment must NEVER establish payment"
  );

  const result = calculateClinicAnnualRevenue({
    appointments: [spoofedOnlineNoteAppt],
    clinicId: TARGET_CLINIC_ID,
    year: 2026,
  });

  assert.equal(result.totalRevenue, 0);
  assert.equal(result.paidAppointmentsCount, 0);
  assert.equal(result.excludedRecords[0].reason, "unpaid");
  console.log("  ✓ Verified: Patient-entered notes containing 'paid online' are completely ignored.");
}

// -----------------------------------------------------------------------------
// SCENARIO 16: Clinic Notes with Payment Claims NEVER Establish Payment (Online Only)
// -----------------------------------------------------------------------------
console.log("[Scenario 16] Clinic notes with payment claims NEVER establish payment without payment_status='paid'...");
{
  const clinicNotePaymentAppt: ClinicRevenueAppointmentInput = {
    id: "appt-clinic-note-payment-claim",
    clinicId: TARGET_CLINIC_ID,
    date: "2026-05-15",
    status: "completed",
    paymentStatus: undefined,
    clinicNote: "Paid counter cash Official Receipt #44910. Verified by Clinic Reception.",
    notes: "Rash on back", // Normal patient symptoms
    paymentAmount: 500,
  };

  assert.equal(
    isExplicitlyPaidAppointment(clinicNotePaymentAppt),
    false,
    "Clinic staff notes claiming payment must NEVER establish payment without payment_status='paid'"
  );

  const result = calculateClinicAnnualRevenue({
    appointments: [clinicNotePaymentAppt],
    clinicId: TARGET_CLINIC_ID,
    year: 2026,
  });

  assert.equal(result.totalRevenue, 0, "Clinic notes claiming payment must not be credited to revenue");
  assert.equal(result.paidAppointmentsCount, 0);
  assert.equal(result.excludedRecords.length, 1);
  assert.equal(result.excludedRecords[0].reason, "unpaid");
  console.log("  ✓ Verified: Clinic notes claiming payment never establish payment without payment_status='paid'.");
}

// -----------------------------------------------------------------------------
// SCENARIO 17: Duplicate Appointment IDs Are Counted Only Once (Internal Deduplication)
// -----------------------------------------------------------------------------
console.log("[Scenario 17] Duplicate appointment IDs are counted only once...");
{
  // Two duplicate records for the exact same appointment ID (e.g. from joining tables or local cache merge)
  const appt1: ClinicRevenueAppointmentInput = {
    id: "appt-duplicate-unique-101",
    clinicId: TARGET_CLINIC_ID,
    date: "2026-06-20",
    status: "completed",
    paymentStatus: "paid",
    paymentAmount: 700,
  };

  const appt1Duplicate: ClinicRevenueAppointmentInput = {
    id: "appt-duplicate-unique-101", // Duplicate ID
    clinicId: TARGET_CLINIC_ID,
    date: "2026-06-20",
    status: "completed",
    paymentStatus: "paid",
    paymentAmount: 700,
  };

  const result = calculateClinicAnnualRevenue({
    appointments: [appt1, appt1Duplicate],
    clinicId: TARGET_CLINIC_ID,
    year: 2026,
  });

  assert.equal(result.totalRevenue, 700, "Duplicate appointment ID must NOT double-count revenue");
  assert.equal(result.paidAppointmentsCount, 1, "Duplicate appointment ID must NOT increment count twice");
  assert.equal(result.eligibleAppointments.length, 1);
  assert.equal(result.excludedRecords.length, 1);
  assert.equal(result.excludedRecords[0].reason, "duplicate_id");
  console.log("  ✓ Verified: Duplicate appointment IDs are strictly deduplicated and counted only once.");
}

// -----------------------------------------------------------------------------
// SCENARIO 18: Different Appointments with Missing IDs Evaluated Independently
// -----------------------------------------------------------------------------
console.log("[Scenario 18] Different appointments with missing IDs evaluated independently without accidental merging...");
{
  // Two distinct appointments, both missing IDs (legacy records or unpersisted walk-ins)
  const missingIdApptA: ClinicRevenueAppointmentInput = {
    id: undefined,
    appointment_id: undefined,
    clinicId: TARGET_CLINIC_ID,
    date: "2026-07-01",
    status: "completed",
    paymentStatus: "paid",
    paymentAmount: 500,
  };

  const missingIdApptB: ClinicRevenueAppointmentInput = {
    id: undefined,
    appointment_id: undefined,
    clinicId: TARGET_CLINIC_ID,
    date: "2026-07-02",
    status: "completed",
    paymentStatus: "paid",
    paymentAmount: 600,
  };

  const result = calculateClinicAnnualRevenue({
    appointments: [missingIdApptA, missingIdApptB],
    clinicId: TARGET_CLINIC_ID,
    year: 2026,
  });

  assert.equal(result.totalRevenue, 500 + 600, "Both appointments without IDs must be credited independently");
  assert.equal(result.paidAppointmentsCount, 2, "Both appointments without IDs must be counted");
  assert.equal(result.eligibleAppointments.length, 2);
  assert.equal(result.excludedRecords.length, 0, "Neither missing ID appointment should be excluded as a duplicate");
  console.log("  ✓ Verified: Missing ID appointments are not accidentally merged and are evaluated independently.");
}

console.log("\n=======================================================");
console.log("  ALL 18 ANNUAL REVENUE & REMEDIATION TESTS PASSED!   ");
console.log("=======================================================\n");
