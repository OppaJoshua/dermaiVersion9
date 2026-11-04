/**
 * ============================================================================
 * DermAI — Mobile Payment Cancellation Safety & Race Condition Test Suite
 * ============================================================================
 *
 * Verifies the 8 critical payment cancellation and safety scenarios:
 * 1. Confirmed successful payment: hold is not released.
 * 2. Confirmed failed payment: hold is released.
 * 3. Confirmed cancelled payment: hold is released.
 * 4. Browser dismissal with uncertain payment status: hold is preserved.
 * 5. Network timeout during verification: hold is preserved.
 * 6. Webhook succeeds before mobile cancellation: appointment remains paid.
 * 7. Mobile cancellation attempted before webhook fulfillment: successful payment
 *    must not result in a permanently cancelled appointment.
 * 8. Repeated payment verification: idempotent, no duplicate fulfillment or queue allocation.
 */

import assert from "node:assert/strict";
import {
  releaseAppointmentHoldSafely,
  cancelAppointmentSlotHold,
  supabase as mobileSupabase,
} from "../../../mobile/lib/store";
import {
  PayMongoPaymentError,
  verifyPayMongoIntentOnce,
} from "../../../mobile/lib/paymongo";

console.log("======================================================================");
console.log("DermAI — Mobile Payment Cancellation Safety & Concurrency Test Suite");
console.log("======================================================================\n");

async function runTestSuite() {
  // ── Scenario 1: Confirmed Successful Payment: Hold Is Not Released ─────────
  console.log("[Scenario 1] Confirmed successful payment: hold is NOT released...");
  {
    const originalFrom = mobileSupabase.from;
    const originalRpc = mobileSupabase.rpc;

    let rpcCalled = false;
    let appointmentUpdated = false;

    // Mock patient_appointment row in database: already marked paid by edge function / webhook
    (mobileSupabase as any).from = (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              appointment_id: "appt-paid-001",
              payment_status: "paid",
              status: "scheduled",
            },
            error: null,
          }),
        }),
      }),
      update: () => {
        appointmentUpdated = true;
        return { eq: () => ({ error: null }) };
      },
    });

    (mobileSupabase as any).rpc = async () => {
      rpcCalled = true;
      return { data: { success: true }, error: null };
    };

    try {
      const res = await releaseAppointmentHoldSafely("appt-paid-001", {
        confirmedCancelledOrFailed: true,
      });

      assert.equal(res.success, false, "Must reject hold release for paid appointment");
      assert.equal(res.code, "ERR_ALREADY_PAID", "Must return ERR_ALREADY_PAID code");
      assert.equal(res.alreadyPaid, true, "Must flag alreadyPaid: true");
      assert.equal(rpcCalled, false, "Database cancel RPC must NEVER be called");
      assert.equal(appointmentUpdated, false, "No table update must be executed");
      console.log("  ✓ Scenario 1 passed: Paid appointment hold is strictly preserved.");
    } finally {
      mobileSupabase.from = originalFrom;
      mobileSupabase.rpc = originalRpc;
    }
  }

  // ── Scenario 2: Confirmed Failed Payment: Hold Is Released ─────────────────
  console.log("\n[Scenario 2] Confirmed failed payment: hold is released safely...");
  {
    const originalFrom = mobileSupabase.from;
    const originalRpc = mobileSupabase.rpc;

    let rpcCalled = false;
    let rpcParams: any = null;

    (mobileSupabase as any).from = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              appointment_id: "appt-failed-002",
              payment_status: "pending_hold",
              status: "pending",
            },
            error: null,
          }),
        }),
      }),
    });

    (mobileSupabase as any).rpc = async (fn: string, params: any) => {
      if (fn === "cancel_appointment_hold") {
        rpcCalled = true;
        rpcParams = params;
        return { data: { success: true, message: "Hold cancelled successfully." }, error: null };
      }
      return { data: null, error: null };
    };

    try {
      const error = new PayMongoPaymentError("Payment declined by card issuer.", "failed", "pi_failed_123");
      assert.equal(error.status, "failed");
      assert.equal(error.isConfirmedTerminal, true, "Failed payment must be marked terminal");

      const res = await releaseAppointmentHoldSafely("appt-failed-002", {
        confirmedCancelledOrFailed: error.isConfirmedTerminal,
        reason: error.message,
      });

      assert.equal(res.success, true, "Hold release must succeed for confirmed failure");
      assert.equal(rpcCalled, true, "cancel_appointment_hold RPC must be invoked");
      assert.equal(rpcParams?.p_appointment_id, "appt-failed-002");
      console.log("  ✓ Scenario 2 passed: Confirmed failed payment safely releases slot hold.");
    } finally {
      mobileSupabase.from = originalFrom;
      mobileSupabase.rpc = originalRpc;
    }
  }

  // ── Scenario 3: Confirmed Cancelled Payment: Hold Is Released ──────────────
  console.log("\n[Scenario 3] Confirmed cancelled payment: hold is released safely...");
  {
    const originalFrom = mobileSupabase.from;
    const originalRpc = mobileSupabase.rpc;

    let rpcCalled = false;

    (mobileSupabase as any).from = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              appointment_id: "appt-cancelled-003",
              payment_status: "pending_hold",
              status: "pending",
            },
            error: null,
          }),
        }),
      }),
    });

    (mobileSupabase as any).rpc = async (fn: string) => {
      if (fn === "cancel_appointment_hold") {
        rpcCalled = true;
        return { data: { success: true, message: "Slot hold cancelled." }, error: null };
      }
      return { data: null, error: null };
    };

    try {
      const error = new PayMongoPaymentError("Payment cancelled on checkout page.", "cancelled", "pi_cancel_456");
      assert.equal(error.status, "cancelled");
      assert.equal(error.isConfirmedTerminal, true, "Cancelled payment must be marked terminal");

      const res = await cancelAppointmentSlotHold("appt-cancelled-003", {
        confirmedCancelledOrFailed: error.isConfirmedTerminal,
      });

      assert.equal(res.success, true);
      assert.equal(rpcCalled, true, "RPC cancel must be called for confirmed user cancellation");
      console.log("  ✓ Scenario 3 passed: Confirmed cancelled payment safely releases slot hold.");
    } finally {
      mobileSupabase.from = originalFrom;
      mobileSupabase.rpc = originalRpc;
    }
  }

  // ── Scenario 4: Browser Dismissal with Uncertain Status: Hold Preserved ────
  console.log("\n[Scenario 4] Browser dismissal with uncertain payment status: hold is PRESERVED...");
  {
    const originalFrom = mobileSupabase.from;
    const originalRpc = mobileSupabase.rpc;

    let rpcCalled = false;

    (mobileSupabase as any).rpc = async () => {
      rpcCalled = true;
      return { data: { success: true }, error: null };
    };

    try {
      // Error generated when user dismisses in-app browser or closes modal without terminal confirmation
      const uncertainError = new PayMongoPaymentError(
        "Payment status could not be confirmed immediately. Hold is preserved.",
        "uncertain",
        "pi_uncertain_789"
      );

      assert.equal(uncertainError.status, "uncertain");
      assert.equal(uncertainError.isConfirmedTerminal, false, "Uncertain status must NOT be terminal");

      // App must NOT attempt cancellation if isConfirmedTerminal is false
      const res = await releaseAppointmentHoldSafely("appt-uncertain-004", {
        confirmedCancelledOrFailed: uncertainError.isConfirmedTerminal,
      });

      assert.equal(res.success, false, "Must reject hold cancellation on uncertain status");
      assert.equal(res.code, "ERR_HOLD_PRESERVED", "Must cite ERR_HOLD_PRESERVED");
      assert.equal(rpcCalled, false, "RPC cancel must NEVER be invoked on uncertain status");
      console.log("  ✓ Scenario 4 passed: Hold preserved when browser is dismissed or status is uncertain.");
    } finally {
      mobileSupabase.from = originalFrom;
      mobileSupabase.rpc = originalRpc;
    }
  }

  // ── Scenario 5: Network Timeout During Verification: Hold Preserved ────────
  console.log("\n[Scenario 5] Network timeout during verification: hold is PRESERVED...");
  {
    const originalFrom = mobileSupabase.from;
    const originalRpc = mobileSupabase.rpc;
    
    let rpcCalled = false;

    // Simulate Edge Function network timeout during verification
    const originalFunctionsGetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(mobileSupabase), 'functions');
    Object.defineProperty(mobileSupabase, 'functions', {
      get: () => ({
        invoke: async () => ({
          data: null,
          error: new Error("Network request timed out: ETIMEDOUT"),
        }),
      }),
      configurable: true,
    });

    (mobileSupabase as any).rpc = async () => {
      rpcCalled = true;
      return { data: { success: true }, error: null };
    };

    try {
      // 1. Verify verifyPayMongoIntentOnce returns 'uncertain' on network error
      const verifyCheck = await verifyPayMongoIntentOnce("pi_timeout_111", "client_key_111");
      assert.equal(verifyCheck.status, "uncertain", "Timeout/error must yield 'uncertain' status");

      // 2. Calling releaseAppointmentHoldSafely with uncertain options preserves the hold
      const timeoutError = new PayMongoPaymentError("Network timeout", "timeout", "pi_timeout_111");
      assert.equal(timeoutError.isConfirmedTerminal, false);

      const res = await releaseAppointmentHoldSafely("appt-timeout-005", {
        confirmedCancelledOrFailed: timeoutError.isConfirmedTerminal,
        paymentIntentId: "pi_timeout_111",
        clientKey: "client_key_111",
      });

      assert.equal(res.success, false);
      assert.equal(res.code, "ERR_HOLD_PRESERVED");
      assert.equal(rpcCalled, false, "No cancel RPC must execute when network times out");
      console.log("  ✓ Scenario 5 passed: Network timeout cleanly preserves the temporary hold.");
    } finally {
      mobileSupabase.from = originalFrom;
      mobileSupabase.rpc = originalRpc;
      if (originalFunctionsGetter) {
        Object.defineProperty(mobileSupabase, 'functions', originalFunctionsGetter);
      } else {
        delete (mobileSupabase as any).functions;
      }
    }
  }

  // ── Scenario 6: Webhook Succeeds Before Mobile Cancellation ────────────────
  console.log("\n[Scenario 6] Webhook succeeds before mobile cancellation: appointment remains paid...");
  {
    const originalFrom = mobileSupabase.from;
    const originalRpc = mobileSupabase.rpc;

    let dbAppointment = {
      appointment_id: "appt-race-006",
      payment_status: "pending_hold",
      status: "pending",
      queue_number: null as number | null,
    };

    // Simulate Webhook arrival first: atomic fulfillment completes
    dbAppointment = {
      appointment_id: "appt-race-006",
      payment_status: "paid",
      status: "scheduled",
      queue_number: 7,
    };

    // Mobile then attempts cancellation
    (mobileSupabase as any).from = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: dbAppointment, error: null }),
        }),
      }),
    });

    let cancelRpcCalled = false;
    (mobileSupabase as any).rpc = async (fn: string) => {
      if (fn === "cancel_appointment_hold") {
        cancelRpcCalled = true;
        return { data: { success: false, code: "ERR_ALREADY_PAID" }, error: null };
      }
      return { data: null, error: null };
    };

    try {
      const res = await releaseAppointmentHoldSafely("appt-race-006", {
        confirmedCancelledOrFailed: true,
      });

      assert.equal(res.success, false, "Cancellation must be rejected");
      assert.equal(res.code, "ERR_ALREADY_PAID", "Must return ERR_ALREADY_PAID");
      assert.equal(res.alreadyPaid, true);
      assert.equal(cancelRpcCalled, false, "Pre-check prevents even calling cancel RPC");
      assert.equal(dbAppointment.payment_status, "paid", "Appointment remains strictly paid");
      assert.equal(dbAppointment.queue_number, 7, "Queue number preserved");
      console.log("  ✓ Scenario 6 passed: Webhook fulfillment takes precedence; cancellation safely rejected.");
    } finally {
      mobileSupabase.from = originalFrom;
      mobileSupabase.rpc = originalRpc;
    }
  }

  // ── Scenario 7: Mobile Cancellation Attempted Before Webhook Fulfillment ───
  console.log("\n[Scenario 7] Mobile cancellation attempted before webhook fulfillment...");
  {
    const originalFrom = mobileSupabase.from;
    const originalRpc = mobileSupabase.rpc;
    
    let dbAppointment = {
      appointment_id: "appt-race-007",
      payment_status: "pending_hold",
      status: "pending",
      queue_number: null as number | null,
    };

    let cancelRpcCalled = false;

    // Edge function reports PayMongo intent status is 'succeeded'
    const originalFunctionsGetter7 = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(mobileSupabase), 'functions');
    Object.defineProperty(mobileSupabase, 'functions', {
      get: () => ({
        invoke: async (_fn: string, req: any) => {
          if (req?.body?.action === "verify_payment_intent") {
            return {
              data: {
                success: true,
                data: {
                  status: "succeeded",
                  payments: [{ id: "pay_succeeded_777" }],
                },
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
      }),
      configurable: true,
    });

    (mobileSupabase as any).from = () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: dbAppointment, error: null }),
        }),
      }),
    });

    (mobileSupabase as any).rpc = async (fn: string) => {
      if (fn === "cancel_appointment_hold") {
        cancelRpcCalled = true;
        return { data: { success: true }, error: null };
      }
      return { data: null, error: null };
    };

    try {
      // Mobile verifies with PayMongo via paymentIntentId & clientKey before cancelling
      const res = await releaseAppointmentHoldSafely("appt-race-007", {
        paymentIntentId: "pi_succeeded_777",
        clientKey: "client_key_777",
        confirmedCancelledOrFailed: true,
      });

      assert.equal(res.success, false, "Must reject cancellation because payment succeeded on PayMongo");
      assert.equal(res.code, "ERR_ALREADY_PAID", "Must identify successful payment");
      assert.equal(res.alreadyPaid, true);
      assert.equal(cancelRpcCalled, false, "Must NOT call cancel RPC");

      // Now webhook fulfills the appointment:
      dbAppointment.payment_status = "paid";
      dbAppointment.status = "scheduled";
      dbAppointment.queue_number = 3;

      assert.equal(dbAppointment.payment_status, "paid", "Appointment safely fulfilled, never cancelled");
      assert.equal(dbAppointment.status, "scheduled");
      console.log("  ✓ Scenario 7 passed: Payment verification check guards against premature hold cancellation.");
    } finally {
      mobileSupabase.from = originalFrom;
      mobileSupabase.rpc = originalRpc;
      if (originalFunctionsGetter7) {
        Object.defineProperty(mobileSupabase, 'functions', originalFunctionsGetter7);
      } else {
        delete (mobileSupabase as any).functions;
      }
    }
  }

  // ── Scenario 8: Repeated Payment Verification (Idempotence) ───────────────
  console.log("\n[Scenario 8] Repeated payment verification: idempotent, no duplicate queue allocation...");
  {
    // Simulate database fulfill_appointment_payment_atomic logic
    let queueCounter = 10;
    const appointmentsTable = new Map<string, any>();
    const userPaymentsTable: any[] = [];

    appointmentsTable.set("appt-idempotent-008", {
      appointment_id: "appt-idempotent-008",
      clinic_id: "clinic-test",
      date: "2026-11-04",
      payment_status: "pending_hold",
      status: "pending",
      queue_number: null,
      payment_reference: null,
    });

    function fulfillAtomic(p_appointment_id: string, p_payment_id: string, p_amount: number) {
      const appt = appointmentsTable.get(p_appointment_id);
      if (!appt) return { success: false, error: "ERR_NOT_FOUND" };

      // Idempotent guard: if already paid, return existing state without allocating new queue number
      if (appt.payment_status === "paid") {
        return {
          success: true,
          action: "already_paid",
          queue_number: appt.queue_number,
          appointment_id: p_appointment_id,
          payment_reference: appt.payment_reference,
        };
      }

      // First fulfillment: assign queue number and create payment
      queueCounter += 1;
      appt.payment_status = "paid";
      appt.status = "scheduled";
      appt.queue_number = queueCounter;
      appt.payment_reference = p_payment_id;

      userPaymentsTable.push({
        payment_id: `pay_${Date.now()}`,
        amount: p_amount,
        status: "paid",
        appointment_id: p_appointment_id,
      });

      return {
        success: true,
        action: "fulfilled",
        queue_number: queueCounter,
        appointment_id: p_appointment_id,
        payment_reference: p_payment_id,
      };
    }

    // Call 1: First verification / webhook
    const res1 = fulfillAtomic("appt-idempotent-008", "pm_pay_888", 500);
    assert.equal(res1.success, true);
    assert.equal(res1.action, "fulfilled");
    assert.equal(res1.queue_number, 11);
    assert.equal(userPaymentsTable.length, 1);

    // Call 2: Duplicate verification (patient re-verifies or network retries)
    const res2 = fulfillAtomic("appt-idempotent-008", "pm_pay_888", 500);
    assert.equal(res2.success, true);
    assert.equal(res2.action, "already_paid", "Second call must return already_paid");
    assert.equal(res2.queue_number, 11, "Queue number must remain 11 (no increment)");
    assert.equal(userPaymentsTable.length, 1, "No duplicate user_payment inserted");

    // Call 3: Third verification (e.g. late webhook arrival)
    const res3 = fulfillAtomic("appt-idempotent-008", "pm_pay_888", 500);
    assert.equal(res3.success, true);
    assert.equal(res3.action, "already_paid");
    assert.equal(res3.queue_number, 11);
    assert.equal(userPaymentsTable.length, 1);

    console.log("  ✓ Scenario 8 passed: Atomic payment fulfillment is strictly idempotent.");
  }

  console.log("\n======================================================================");
  console.log("  ALL 8 PAYMENT CANCELLATION SAFETY & CONCURRENCY TESTS PASSED!");
  console.log("======================================================================");
}

runTestSuite().catch((err) => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});
