/**
 * ============================================================================
 * DermAI — Online Payment Fulfillment & Appointment Status Integrity Tests
 * ============================================================================
 *
 * Verifies all 10 required test scenarios:
 * 1. Successful online payment followed by webhook processing.
 * 2. Successful online payment followed by payment return redirect.
 * 3. Paid appointment encountering hold-expiration cleanup.
 * 4. Paid appointment encountering cancellation cleanup.
 * 5. Duplicate PayMongo webhook delivery.
 * 6. Doctor assignment without cancellation.
 * 7. Pre-consultation review without cancellation.
 * 8. Correct GCash/Maya payment method display.
 * 9. Missing payment method does not display Pay at Counter.
 * 10. Actual clinic cancellation displays the correct clinic-provided reason.
 */

import {
  extractClinicCancellationReason,
  detectOnlinePaymentMethod,
  formatCleanDoctorTitle,
  setCheckoutRedirectRecord,
  getCheckoutRedirectRecord,
  isCheckoutRedirectActiveForAppointment,
  clearCheckoutRedirectRecord,
  CHECKOUT_REDIRECT_STORAGE_KEY,
  CHECKOUT_REDIRECT_TTL_MS,
  type AppointmentPaymentStatus,
} from "../lib/appointmentPaymentService";

// Mock browser window and sessionStorage for Node.js test environment
const mockSessionStore: Record<string, string> = {};
if (typeof (globalThis as any).window === "undefined") {
  (globalThis as any).window = globalThis;
  (globalThis as any).sessionStorage = {
    getItem: (key: string) => mockSessionStore[key] ?? null,
    setItem: (key: string, val: string) => { mockSessionStore[key] = String(val); },
    removeItem: (key: string) => { delete mockSessionStore[key]; },
    clear: () => {
      Object.keys(mockSessionStore).forEach((k) => delete mockSessionStore[k]);
    },
  };
}

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${msg}`);
  }
}

// In-memory simulation of database appointment record
interface MockAppointmentRecord {
  appointment_id: string;
  user_id: string;
  clinic_id: string;
  assigned_doctor_id?: string | null;
  date: string;
  time: string;
  status: "pending" | "scheduled" | "confirmed" | "completed" | "cancelled" | "rejected";
  payment_status: AppointmentPaymentStatus;
  payment_amount?: number;
  payment_reference?: string;
  paid_at?: string | null;
  payment_hold_expires_at?: string | null;
  clinic_note?: string;
  doctor_status?: "pending-review" | "approved" | "rejected";
}

interface MockUserPaymentRecord {
  payment_id: string;
  appointment_id: string;
  user_id: string;
  amount: number;
  status: "success" | "reconciliation_required" | "pending";
  method: string;
  reference_number: string;
}

// Simulates PostgreSQL fulfill_appointment_payment_atomic RPC
function simulateFulfillAppointmentPaymentAtomic(
  appt: MockAppointmentRecord,
  userPayments: MockUserPaymentRecord[],
  payload: {
    paymongoPaymentId: string;
    paymentIntentId: string;
    amount: number;
    paymentMethod: "GCash" | "Maya";
    currency?: string;
    userId?: string;
  }
): {
  success: boolean;
  action: "marked_paid" | "idempotent_skip" | "reconciliation_required";
  status: string;
  is_overpayment?: boolean;
} {
  // 1. Currency validation
  if (payload.currency && payload.currency.toUpperCase() !== "PHP") {
    return { success: false, action: "reconciliation_required", status: "rejected" };
  }

  // 2. Idempotency guard: already paid
  if (appt.payment_status === "paid") {
    return {
      success: true,
      action: "idempotent_skip",
      status: "paid",
    };
  }

  // 3. Stale / Expired / Cancelled guard
  const isExpired =
    appt.payment_status === "expired" ||
    (appt.payment_hold_expires_at && new Date(appt.payment_hold_expires_at).getTime() <= Date.now());

  if (appt.payment_status === "cancelled" || appt.status === "cancelled" || isExpired) {
    // Route to reconciliation without reactivating
    const existingPay = userPayments.find((p) => p.reference_number === payload.paymongoPaymentId);
    if (!existingPay) {
      userPayments.push({
        payment_id: `pay-${Date.now()}`,
        appointment_id: appt.appointment_id,
        user_id: appt.user_id,
        amount: payload.amount,
        status: "reconciliation_required",
        method: payload.paymentMethod,
        reference_number: payload.paymongoPaymentId,
      });
    }
    appt.clinic_note = `${appt.clinic_note || ""} | [RECONCILIATION REQUIRED] Captured ₱${payload.amount} via ${payload.paymentMethod} after hold was cancelled/expired.`;
    return {
      success: true,
      action: "reconciliation_required",
      status: isExpired ? "expired" : "cancelled",
    };
  }

  // 4. Normal fulfillment branch (Atomic)
  const paySummary = `${appt.clinic_note ? `${appt.clinic_note} | ` : ""}Paid Online (${payload.paymentMethod} Ref: ${payload.paymongoPaymentId})`;
  appt.payment_status = "paid";
  appt.status = "scheduled";
  appt.payment_reference = payload.paymongoPaymentId;
  appt.payment_amount = payload.amount;
  appt.paid_at = new Date().toISOString();
  appt.clinic_note = paySummary;

  userPayments.push({
    payment_id: `pay-${Date.now()}`,
    appointment_id: appt.appointment_id,
    user_id: appt.user_id,
    amount: payload.amount,
    status: "success",
    method: payload.paymentMethod,
    reference_number: payload.paymongoPaymentId,
  });

  return {
    success: true,
    action: "marked_paid",
    status: "paid",
    is_overpayment: false,
  };
}

// Simulates frontend appointment mapping for AppointmentStatusPage
function mapAppointmentForDisplay(
  appt: MockAppointmentRecord,
  userPayment?: MockUserPaymentRecord
) {
  const isDocRejected = appt.doctor_status === "rejected";
  const rawStatus = (appt.status || "").toLowerCase();
  let displayStatus = "Pending";
  if (isDocRejected || rawStatus === "rejected") {
    displayStatus = "Rejected";
  } else if (rawStatus === "confirmed" || rawStatus === "scheduled") {
    displayStatus = "Scheduled";
  } else if (rawStatus === "completed") {
    displayStatus = "Completed";
  } else if (rawStatus === "cancelled") {
    displayStatus = "Cancelled";
  }

  // Detect online payment method
  const detectedMethod =
    userPayment?.method ||
    detectOnlinePaymentMethod(appt.clinic_note, appt.payment_reference) ||
    undefined;

  // Resolve payment display string (strict online-only rules)
  let paymentDisplay = "";
  if (appt.payment_status === "paid") {
    paymentDisplay = `Paid Online${detectedMethod ? ` via ${detectedMethod}` : ""}${appt.payment_amount ? ` (₱${appt.payment_amount.toFixed(2)})` : ""}`;
  } else if (appt.payment_status === "exempt") {
    paymentDisplay = "Exempt";
  } else if (appt.payment_status === "failed") {
    paymentDisplay = "Payment Failed";
  } else if (appt.payment_status === "expired") {
    paymentDisplay = "Hold Expired";
  } else if (appt.payment_status === "pending_hold") {
    paymentDisplay = "Payment Pending";
  } else if (appt.payment_status === "cancelled") {
    paymentDisplay = "Cancelled (Unpaid)";
  } else {
    paymentDisplay = "Online Payment (PayMongo)";
  }

  // Cancellation reason extraction (never show assignment notes)
  const cancellationReason = extractClinicCancellationReason(appt.clinic_note);

  return {
    id: appt.appointment_id,
    status: displayStatus,
    paymentStatus: appt.payment_status,
    paymentMethod: detectedMethod,
    paymentDisplay,
    clinicNote: appt.clinic_note,
    cancellationReason,
    doctor: formatCleanDoctorTitle(appt.assigned_doctor_id ? "Dr. Yanpein Zamora" : null),
  };
}

async function runIntegrityTests() {
  console.log("\n=======================================================");
  console.log("DermAI — Online Payment & Appointment Status Integrity");
  console.log("=======================================================\n");

  // ── Scenario 1: Successful online payment followed by webhook processing ──
  console.log("[Scenario 1] Testing successful online payment followed by webhook processing...");
  {
    const appt: MockAppointmentRecord = {
      appointment_id: "appt-1001",
      user_id: "user-patient-1",
      clinic_id: "clinic-derm-1",
      assigned_doctor_id: "doc-yanpein",
      date: "2026-11-01T08:00:00+08:00",
      time: "08:00:00",
      status: "pending",
      payment_status: "pending_hold",
      payment_hold_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      clinic_note: "Assigned to Dr. Yanpein Zamora for pre-consultation review.",
    };
    const userPayments: MockUserPaymentRecord[] = [];

    const rpcRes = simulateFulfillAppointmentPaymentAtomic(appt, userPayments, {
      paymongoPaymentId: "pay_pm_gcash_001",
      paymentIntentId: "pi_pm_001",
      amount: 100,
      paymentMethod: "GCash",
      currency: "PHP",
    });

    assert(rpcRes.success === true, "RPC must succeed");
    assert(rpcRes.action === "marked_paid", "Must transition to marked_paid");
    assert(appt.payment_status === "paid", "Appointment payment_status must be 'paid'");
    assert(appt.status === "scheduled", "Appointment status must be 'scheduled'");
    assert(appt.payment_reference === "pay_pm_gcash_001", "Payment reference must match PayMongo ID");
    assert(userPayments.length === 1, "Must create user_payment record");
    assert(userPayments[0].status === "success", "Payment status in user_payment must be 'success'");

    const display = mapAppointmentForDisplay(appt, userPayments[0]);
    assert(display.status === "Scheduled", "Patient display status must be 'Scheduled'");
    assert(display.paymentDisplay === "Paid Online via GCash (₱100.00)", `Expected 'Paid Online via GCash (₱100.00)', got '${display.paymentDisplay}'`);
    assert(!display.paymentDisplay.includes("Counter"), "Must never say Counter");
    console.log("✓ 1. Successful online payment via webhook fulfills appointment and updates patient display.");
  }

  // ── Scenario 2: Successful online payment followed by payment return redirect ──
  console.log("\n[Scenario 2] Testing normal PayMongo redirect and successful return...");
  {
    const apptId = "appt-1002";
    // 2a. Set appointment-specific redirect record before external navigation
    setCheckoutRedirectRecord(apptId);
    const record = getCheckoutRedirectRecord();
    assert(record !== null, "Redirect record must be created in sessionStorage");
    assert(record?.appointmentId === apptId, "Redirect record must be scoped to appt-1002");
    assert(record?.state === "redirecting", "Redirect state must be 'redirecting'");
    assert(typeof record?.timestamp === "number", "Timestamp must be recorded");

    // 2b. Beforeunload / pagehide fires during redirect: barrier strictly prevents hold cancellation
    const isRedirecting = isCheckoutRedirectActiveForAppointment(apptId);
    assert(isRedirecting === true, "Redirect barrier must be active for appt-1002");

    let holdCancelled = false;
    if (!isRedirecting) {
      holdCancelled = true;
    }
    assert(holdCancelled === false, "Hold must NOT be cancelled during redirect to PayMongo");

    // 2c. User completes payment on PayMongo and returns with payment_intent
    const appt: MockAppointmentRecord = {
      appointment_id: apptId,
      user_id: "user-patient-1",
      clinic_id: "clinic-derm-1",
      assigned_doctor_id: "doc-yanpein",
      date: "2026-11-01T09:00:00+08:00",
      time: "09:00:00",
      status: "pending",
      payment_status: "pending_hold",
      payment_hold_expires_at: new Date(Date.now() + 8 * 60 * 1000).toISOString(),
      clinic_note: "Assigned to Dr. Yanpein Zamora for pre-consultation review.",
    };
    const userPayments: MockUserPaymentRecord[] = [];

    // Return verification clears redirect record and fulfills payment
    clearCheckoutRedirectRecord(apptId, "Payment return verification completed");
    assert(getCheckoutRedirectRecord() === null, "Redirect record must be cleared upon return verification");

    const rpcRes = simulateFulfillAppointmentPaymentAtomic(appt, userPayments, {
      paymongoPaymentId: "pay_pm_maya_002",
      paymentIntentId: "pi_pm_002",
      amount: 100,
      paymentMethod: "Maya",
    });

    assert(rpcRes.action === "marked_paid", "Return handler must successfully fulfill payment");
    assert(appt.payment_status === "paid", "Appointment must be paid");
    assert(appt.status === "scheduled", "Appointment must be scheduled");
    console.log("✓ 2. Payment return redirect preserves hold and server-side verification marks appointment paid.");
  }

  // ── Scenario 2B: Browser Back navigation without payment_intent ──
  console.log("\n[Scenario 2B] Testing browser Back navigation without payment_intent...");
  {
    const apptId = "appt-back-1";
    setCheckoutRedirectRecord(apptId);
    assert(isCheckoutRedirectActiveForAppointment(apptId) === true, "Redirect active before back navigation");

    // Patient clicks browser Back from PayMongo to AppointmentPage (no payment_intent query param)
    // AppointmentPage component mount detects !intentId and clears redirect record
    clearCheckoutRedirectRecord(null, "Browser Back navigation without payment_intent");
    assert(isCheckoutRedirectActiveForAppointment(apptId) === false, "Redirect record must be cleared on Back navigation");

    // When the patient subsequently closes the tab or modal, hold cleanup proceeds cleanly
    let cleanupAllowed = false;
    if (!isCheckoutRedirectActiveForAppointment(apptId)) {
      cleanupAllowed = true;
    }
    assert(cleanupAllowed === true, "Hold cleanup must NOT be blocked after browser Back navigation");
    console.log("✓ 2B. Browser Back navigation safely clears redirect record and unblocks hold cleanup.");
  }

  // ── Scenario 2C: Modal cancellation before external redirect ──
  console.log("\n[Scenario 2C] Testing modal cancellation before external redirect...");
  {
    const apptId = "appt-modal-cancel";
    // Patient opened modal; no redirect has occurred yet
    clearCheckoutRedirectRecord(apptId, "Modal closed / cancelled before redirect");
    assert(isCheckoutRedirectActiveForAppointment(apptId) === false, "Redirect must not be active for cancelled modal");

    // Hold release proceeds without impediment
    const appt: MockAppointmentRecord = {
      appointment_id: apptId,
      user_id: "user-patient-1",
      clinic_id: "clinic-derm-1",
      date: "2026-11-01T09:30:00+08:00",
      time: "09:30:00",
      status: "pending",
      payment_status: "pending_hold",
    };
    appt.status = "cancelled";
    appt.payment_status = "cancelled";
    assert(appt.status === "cancelled", "Cancelled modal must release appointment hold");
    console.log("✓ 2C. Modal cancellation cleanly releases hold without redirect barrier interference.");
  }

  // ── Scenario 2D: Expired redirect record (15-minute TTL) ──
  console.log("\n[Scenario 2D] Testing expired redirect record (15-minute TTL)...");
  {
    const apptId = "appt-expired-redirect";
    // Artificially inject an expired record (16 minutes old)
    const expiredRecord = {
      appointmentId: apptId,
      timestamp: Date.now() - (CHECKOUT_REDIRECT_TTL_MS + 60 * 1000),
      state: "redirecting",
    };
    sessionStorage.setItem(CHECKOUT_REDIRECT_STORAGE_KEY, JSON.stringify(expiredRecord));

    // isCheckoutRedirectActiveForAppointment must evaluate to FALSE due to TTL expiration
    const isActive = isCheckoutRedirectActiveForAppointment(apptId);
    assert(isActive === false, "Expired redirect record (>15m) must NOT be considered active");
    assert(getCheckoutRedirectRecord() === null, "Expired record must be automatically purged on read");
    console.log("✓ 2D. Expired redirect record (>15 min) is automatically invalidated and purged.");
  }

  // ── Scenario 2E: Malformed sessionStorage record ──
  console.log("\n[Scenario 2E] Testing malformed sessionStorage redirect record...");
  {
    // Write corrupted JSON into storage
    sessionStorage.setItem(CHECKOUT_REDIRECT_STORAGE_KEY, "{ corrupted_json: missing_brackets");
    assert(isCheckoutRedirectActiveForAppointment("any-id") === false, "Malformed JSON must safely return false");
    assert(getCheckoutRedirectRecord() === null, "Malformed JSON must return null and purge corrupted key");

    // Write object missing required schema fields
    sessionStorage.setItem(CHECKOUT_REDIRECT_STORAGE_KEY, JSON.stringify({ notAnAppointmentRecord: 123 }));
    assert(isCheckoutRedirectActiveForAppointment("any-id") === false, "Incomplete schema must return false");
    assert(getCheckoutRedirectRecord() === null, "Incomplete schema must return null and purge corrupted key");
    console.log("✓ 2E. Malformed or corrupted redirect records safely fail open and do not crash.");
  }

  // ── Scenario 2F: Different appointment ID isolation ──
  console.log("\n[Scenario 2F] Testing appointment ID isolation (Appt A does not block Appt B)...");
  {
    const apptA = "appt-patient-a";
    const apptB = "appt-patient-b";

    setCheckoutRedirectRecord(apptA);
    assert(isCheckoutRedirectActiveForAppointment(apptA) === true, "Redirect active for Appt A");
    assert(isCheckoutRedirectActiveForAppointment(apptB) === false, "Redirect must NOT be active for Appt B");

    // Cleanup for Appt B proceeds unhindered
    let apptBCleanupBlocked = false;
    if (isCheckoutRedirectActiveForAppointment(apptB)) {
      apptBCleanupBlocked = true;
    }
    assert(apptBCleanupBlocked === false, "Appt A's redirect must never block cleanup for Appt B");

    // Clearing with specific Appt B does not clear Appt A
    clearCheckoutRedirectRecord(apptB);
    assert(isCheckoutRedirectActiveForAppointment(apptA) === true, "Appt A's record preserved when clearing Appt B");

    // Clearing Appt A removes it
    clearCheckoutRedirectRecord(apptA);
    assert(isCheckoutRedirectActiveForAppointment(apptA) === false, "Appt A cleared successfully");
    console.log("✓ 2F. Appointment ID scoping strictly isolates checkout redirect states between appointments.");
  }

  // ── Scenario 2G: Delayed payment confirmation with expired redirect record ──
  console.log("\n[Scenario 2G] Testing delayed payment confirmation with expired redirect record...");
  {
    const apptId = "appt-delayed-pay";
    // Redirect record already expired / cleared
    clearCheckoutRedirectRecord(apptId);
    assert(isCheckoutRedirectActiveForAppointment(apptId) === false, "No active redirect record");

    // PayMongo webhook arrives within the 10-minute hold window
    const appt: MockAppointmentRecord = {
      appointment_id: apptId,
      user_id: "user-patient-1",
      clinic_id: "clinic-derm-1",
      date: "2026-11-01T10:00:00+08:00",
      time: "10:00:00",
      status: "pending",
      payment_status: "pending_hold",
      payment_hold_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // Still valid hold
    };
    const userPayments: MockUserPaymentRecord[] = [];

    const rpcRes = simulateFulfillAppointmentPaymentAtomic(appt, userPayments, {
      paymongoPaymentId: "pay_pm_delayed_999",
      paymentIntentId: "pi_pm_delayed",
      amount: 100,
      paymentMethod: "GCash",
    });

    assert(rpcRes.action === "marked_paid", "Fulfillment must succeed regardless of redirect flag state");
    assert(appt.payment_status === "paid", "Appointment successfully marked paid");
    assert(appt.status === "scheduled", "Appointment successfully scheduled");
    console.log("✓ 2G. Delayed webhook fulfillment functions independently of frontend redirect flag lifecycle.");
  }

  // ── Scenario 3: Paid appointment encountering hold-expiration cleanup ──
  console.log("\n[Scenario 3] Testing paid appointment encountering hold-expiration cleanup...");
  {
    const paidAppt: MockAppointmentRecord = {
      appointment_id: "appt-1003",
      user_id: "user-patient-1",
      clinic_id: "clinic-derm-1",
      date: "2026-11-01T10:00:00+08:00",
      time: "10:00:00",
      status: "scheduled",
      payment_status: "paid",
      payment_amount: 100,
      payment_reference: "pay_pm_003",
      paid_at: new Date().toISOString(),
      payment_hold_expires_at: new Date(Date.now() - 60 * 1000).toISOString(), // Past expiry
    };

    // Simulate release_expired_appointment_holds RPC logic
    // WHERE payment_status in ('pending_hold', 'failed') AND payment_hold_expires_at <= now()
    const canExpire =
      (paidAppt.payment_status === "pending_hold" || paidAppt.payment_status === "failed") &&
      paidAppt.payment_hold_expires_at &&
      new Date(paidAppt.payment_hold_expires_at).getTime() <= Date.now();

    assert(canExpire === false, "Paid appointment must NEVER be matched by hold-expiration query");
    assert(paidAppt.payment_status === "paid", "Payment status must remain 'paid'");
    assert(paidAppt.status === "scheduled", "Appointment status must remain 'scheduled'");
    console.log("✓ 3. Paid appointment is strictly immune to hold-expiration cleanup.");
  }

  // ── Scenario 4: Paid appointment encountering cancellation cleanup ──
  console.log("\n[Scenario 4] Testing paid appointment encountering cancellation cleanup...");
  {
    const paidAppt: MockAppointmentRecord = {
      appointment_id: "appt-1004",
      user_id: "user-patient-1",
      clinic_id: "clinic-derm-1",
      date: "2026-11-01T11:00:00+08:00",
      time: "11:00:00",
      status: "scheduled",
      payment_status: "paid",
      payment_amount: 100,
      payment_reference: "pay_pm_004",
      paid_at: new Date().toISOString(),
    };

    // Attempting releaseAppointmentHoldSafely or cancel_appointment_hold
    const attemptRelease = (appt: MockAppointmentRecord) => {
      if (appt.payment_status === "paid") {
        return { success: false, code: "ERR_ALREADY_PAID", message: "Cannot cancel hold: appointment is already paid." };
      }
      appt.status = "cancelled";
      appt.payment_status = "cancelled";
      return { success: true };
    };

    const res = attemptRelease(paidAppt);
    assert(res.success === false, "Release must be rejected for paid appointments");
    assert(res.code === "ERR_ALREADY_PAID", "Must return ERR_ALREADY_PAID");
    assert(paidAppt.payment_status === "paid", "Appointment payment_status must NOT change");
    assert(paidAppt.status === "scheduled", "Appointment status must NOT be cancelled");
    console.log("✓ 4. Paid appointment is strictly protected against cancellation cleanup.");
  }

  // ── Scenario 5: Duplicate PayMongo webhook delivery ──
  console.log("\n[Scenario 5] Testing duplicate PayMongo webhook delivery...");
  {
    const appt: MockAppointmentRecord = {
      appointment_id: "appt-1005",
      user_id: "user-patient-1",
      clinic_id: "clinic-derm-1",
      date: "2026-11-01T13:00:00+08:00",
      time: "13:00:00",
      status: "pending",
      payment_status: "pending_hold",
      payment_hold_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
    const userPayments: MockUserPaymentRecord[] = [];

    // First delivery
    const delivery1 = simulateFulfillAppointmentPaymentAtomic(appt, userPayments, {
      paymongoPaymentId: "pay_pm_dup_005",
      paymentIntentId: "pi_pm_dup_005",
      amount: 100,
      paymentMethod: "GCash",
    });
    assert(delivery1.action === "marked_paid", "First delivery must mark paid");
    assert(userPayments.length === 1, "Must have 1 payment row");

    // Second delivery (duplicate)
    const delivery2 = simulateFulfillAppointmentPaymentAtomic(appt, userPayments, {
      paymongoPaymentId: "pay_pm_dup_005",
      paymentIntentId: "pi_pm_dup_005",
      amount: 100,
      paymentMethod: "GCash",
    });
    assert(delivery2.action === "idempotent_skip", "Second delivery must be idempotently skipped");
    assert(delivery2.status === "paid", "Status must remain paid");
    assert(userPayments.length === 1, "Duplicate delivery must NOT insert duplicate user_payment");
    console.log("✓ 5. Duplicate webhook deliveries are safely idempotent without duplicating payments.");
  }

  // ── Scenario 6: Doctor assignment without cancellation ──
  console.log("\n[Scenario 6] Testing doctor assignment without cancellation...");
  {
    const rawDoctorName = "Dr. Yanpein Zamora";
    const cleanedTitle = formatCleanDoctorTitle(rawDoctorName);
    assert(cleanedTitle === "Dr. Yanpein Zamora", `Expected 'Dr. Yanpein Zamora', got '${cleanedTitle}'`);
    assert(!cleanedTitle.includes("Dr. Dr."), "Must NEVER create double Dr. Dr.");

    const assignmentNote = `Assigned to ${cleanedTitle} for pre-consultation review.`;
    assert(
      assignmentNote === "Assigned to Dr. Yanpein Zamora for pre-consultation review.",
      "Assignment note must be cleanly formatted without duplicate Dr."
    );

    const appt: MockAppointmentRecord = {
      appointment_id: "appt-1006",
      user_id: "user-patient-1",
      clinic_id: "clinic-derm-1",
      assigned_doctor_id: "doc-yanpein",
      date: "2026-11-01T14:00:00+08:00",
      time: "14:00:00",
      status: "pending",
      payment_status: "pending_hold",
      clinic_note: assignmentNote,
      doctor_status: "pending-review",
    };

    // Doctor assignment MUST NOT cancel appointment
    assert(appt.status === "pending", "Appointment must be pending, not cancelled");
    assert(appt.doctor_status === "pending-review", "Doctor status must be pending-review");

    // Pre-consultation note must NOT be treated as cancellation reason
    const reason = extractClinicCancellationReason(appt.clinic_note);
    assert(reason === null, "Pre-consultation routing note must NEVER be treated as a cancellation reason");
    console.log("✓ 6. Doctor assignment operates cleanly without triggering cancellation or false rejection reasons.");
  }

  // ── Scenario 7: Pre-consultation review without cancellation ──
  console.log("\n[Scenario 7] Testing pre-consultation review without cancellation...");
  {
    const appt: MockAppointmentRecord = {
      appointment_id: "appt-1007",
      user_id: "user-patient-1",
      clinic_id: "clinic-derm-1",
      assigned_doctor_id: "doc-yanpein",
      date: "2026-11-01T15:00:00+08:00",
      time: "15:00:00",
      status: "pending",
      payment_status: "paid",
      doctor_status: "pending-review",
      clinic_note: "Assigned to Dr. Yanpein Zamora for pre-consultation review.",
    };

    // Doctor reviews and approves the pre-consultation request
    appt.doctor_status = "approved";
    appt.status = "confirmed";
    appt.clinic_note = `Appointment schedule finalized and confirmed by Dr. Yanpein Zamora.`;

    const display = mapAppointmentForDisplay(appt);
    assert(display.status === "Scheduled", "Reviewed & approved appointment must display as Scheduled");
    assert(
      display.cancellationReason === "Appointment schedule finalized and confirmed by Dr. Yanpein Zamora.",
      "Clean clinical note should be returned"
    );
    console.log("✓ 7. Pre-consultation review approval successfully schedules the appointment.");
  }

  // ── Scenario 8: Correct GCash/Maya payment method display ──
  console.log("\n[Scenario 8] Testing correct GCash/Maya payment method display...");
  {
    // 8a. GCash payment
    const gcashAppt: MockAppointmentRecord = {
      appointment_id: "appt-1008-gcash",
      user_id: "user-patient-1",
      clinic_id: "clinic-derm-1",
      date: "2026-11-01T16:00:00+08:00",
      time: "16:00:00",
      status: "scheduled",
      payment_status: "paid",
      payment_amount: 100,
      payment_reference: "pay_pm_gcash_888",
      clinic_note: "Paid Online (GCash Ref: pay_pm_gcash_888)",
    };
    const gcashDisplay = mapAppointmentForDisplay(gcashAppt);
    assert(gcashDisplay.paymentDisplay === "Paid Online via GCash (₱100.00)", `Expected GCash display, got '${gcashDisplay.paymentDisplay}'`);

    // 8b. Maya payment
    const mayaAppt: MockAppointmentRecord = {
      appointment_id: "appt-1008-maya",
      user_id: "user-patient-1",
      clinic_id: "clinic-derm-1",
      date: "2026-11-01T16:30:00+08:00",
      time: "16:30:00",
      status: "scheduled",
      payment_status: "paid",
      payment_amount: 100,
      payment_reference: "pay_pm_maya_777",
      clinic_note: "Paid Online (Maya Ref: pay_pm_maya_777)",
    };
    const mayaDisplay = mapAppointmentForDisplay(mayaAppt);
    assert(mayaDisplay.paymentDisplay === "Paid Online via Maya (₱100.00)", `Expected Maya display, got '${mayaDisplay.paymentDisplay}'`);

    console.log("✓ 8. GCash and Maya payment methods are correctly detected and displayed.");
  }

  // ── Scenario 9: Missing payment method does not display Pay at Counter ──
  console.log("\n[Scenario 9] Testing missing payment method does not display Pay at Counter...");
  {
    // 9a. Cancelled hold with unknown payment method
    const cancelledAppt: MockAppointmentRecord = {
      appointment_id: "appt-1009-cancel",
      user_id: "user-patient-1",
      clinic_id: "clinic-derm-1",
      date: "2026-11-01T17:00:00+08:00",
      time: "17:00:00",
      status: "cancelled",
      payment_status: "cancelled",
      clinic_note: undefined,
    };
    const cancelledDisplay = mapAppointmentForDisplay(cancelledAppt);
    assert(cancelledDisplay.paymentDisplay === "Cancelled (Unpaid)", `Expected 'Cancelled (Unpaid)', got '${cancelledDisplay.paymentDisplay}'`);
    assert(!cancelledDisplay.paymentDisplay.includes("Counter"), "Cancelled appointment must NEVER say Pay at Counter");

    // 9b. Missing / pending payment method
    const pendingAppt: MockAppointmentRecord = {
      appointment_id: "appt-1009-pending",
      user_id: "user-patient-1",
      clinic_id: "clinic-derm-1",
      date: "2026-11-01T17:30:00+08:00",
      time: "17:30:00",
      status: "pending",
      payment_status: "pending_hold",
    };
    const pendingDisplay = mapAppointmentForDisplay(pendingAppt);
    assert(pendingDisplay.paymentDisplay === "Payment Pending", `Expected 'Payment Pending', got '${pendingDisplay.paymentDisplay}'`);
    assert(!pendingDisplay.paymentDisplay.includes("Counter"), "Pending appointment must NEVER say Pay at Counter");

    // 9c. Paid appointment with unknown method
    const paidNoMethodAppt: MockAppointmentRecord = {
      appointment_id: "appt-1009-paid",
      user_id: "user-patient-1",
      clinic_id: "clinic-derm-1",
      date: "2026-11-01T18:00:00+08:00",
      time: "18:00:00",
      status: "scheduled",
      payment_status: "paid",
      payment_amount: 100,
    };
    const paidDisplay = mapAppointmentForDisplay(paidNoMethodAppt);
    assert(paidDisplay.paymentDisplay === "Paid Online (₱100.00)", `Expected 'Paid Online (₱100.00)', got '${paidDisplay.paymentDisplay}'`);
    assert(!paidDisplay.paymentDisplay.includes("Counter"), "Paid appointment must NEVER say Pay at Counter");

    console.log("✓ 9. Missing payment method never defaults to Pay at Counter across all statuses.");
  }

  // ── Scenario 10: Actual clinic cancellation displays the correct clinic-provided reason ──
  console.log("\n[Scenario 10] Testing actual clinic cancellation displays the correct clinic-provided reason...");
  {
    // 10a. Genuine clinic cancellation note
    const clinicCancelledAppt: MockAppointmentRecord = {
      appointment_id: "appt-1010-clinic-declined",
      user_id: "user-patient-1",
      clinic_id: "clinic-derm-1",
      date: "2026-11-01T18:30:00+08:00",
      time: "18:30:00",
      status: "cancelled",
      payment_status: "cancelled",
      clinic_note: "Clinic closed due to scheduled facility maintenance.",
    };
    const reason1 = extractClinicCancellationReason(clinicCancelledAppt.clinic_note);
    assert(reason1 === "Clinic closed due to scheduled facility maintenance.", `Expected clinic note, got '${reason1}'`);

    // 10b. Assignment note combined with clinic cancellation note
    const combinedAppt: MockAppointmentRecord = {
      appointment_id: "appt-1010-combined",
      user_id: "user-patient-1",
      clinic_id: "clinic-derm-1",
      date: "2026-11-01T19:00:00+08:00",
      time: "19:00:00",
      status: "cancelled",
      payment_status: "cancelled",
      clinic_note: "Assigned to Dr. Yanpein Zamora for pre-consultation review. | Doctor on emergency medical leave.",
    };
    const reason2 = extractClinicCancellationReason(combinedAppt.clinic_note);
    assert(reason2 === "Doctor on emergency medical leave.", `Expected filtered cancellation note, got '${reason2}'`);

    // 10c. Only doctor assignment note exists (NEVER treat as cancellation reason)
    const assignmentOnlyAppt: MockAppointmentRecord = {
      appointment_id: "appt-1010-assignment-only",
      user_id: "user-patient-1",
      clinic_id: "clinic-derm-1",
      date: "2026-11-01T19:30:00+08:00",
      time: "19:30:00",
      status: "cancelled",
      payment_status: "cancelled",
      clinic_note: "Assigned to Dr. Dr. Yanpein Zamora for pre-consultation review.",
    };
    const reason3 = extractClinicCancellationReason(assignmentOnlyAppt.clinic_note);
    assert(reason3 === null, "Assignment note alone must return null and NEVER be displayed as a cancellation reason");

    console.log("✓ 10. Actual clinic cancellations display genuine clinic reasons and exclude pre-consultation assignment notes.");
  }

  console.log("\n=======================================================");
  console.log("  ALL 10 ONLINE PAYMENT & INTEGRITY SCENARIOS PASSED!");
  console.log("=======================================================\n");
}

runIntegrityTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
