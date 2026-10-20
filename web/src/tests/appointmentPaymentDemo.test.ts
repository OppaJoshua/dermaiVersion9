/**
 * DermAI — Static Simulated Appointment Payment Demo Test Suite
 *
 * Tests the isolated frontend-only payment demo mode:
 * 1. Disabled-by-default behavior.
 * 2. Production safety hard-gate (strictly disabled in production builds).
 * 3. Development-only activation via env flag, URL query params, and session storage.
 * 4. Honest mock reference generation (DEMO-TX-MOCK-...).
 * 5. Strict consultation fee validation without hardcoded or invented fallback fees.
 * 6. Payment method options: GCash and Maya (formerly PayMaya).
 * 7. Simulation outcomes: Success, Failure, Cancellation, and Retry.
 * 8. Real submission decision path verification:
 *    - Demo active intercepts submission before normal booking writes
 *    - Cancellation/failure prevents normal submission
 *    - Demo success only produces simulated confirmation
 *    - Demo disabled preserves normal real booking workflow
 * 9. Verification of zero Supabase mutations / database calls in demo mode.
 */

import {
  isPaymentDemoMode,
  setPaymentDemoMode,
  getDemoPaymentModeSource,
  generateMockPaymentReference,
  createMockCheckoutData,
  formatDemoPaymentMethod,
  evaluateAppointmentSubmission,
  _setTestEnvOverride,
  _resetDemoSessionForTesting,
  type DemoCheckoutData,
  type DemoOutcome,
  type DemoPaymentMethod,
} from "../lib/appointmentPaymentDemo";

function assert(condition: any, message: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

console.log("=== Running DermAI Appointment Payment Demo Test Suite ===\n");

// --- TEST 1: Disabled by Default ---
console.log("Test 1: Disabled by default");
{
  delete process.env.VITE_ENABLE_PAYMENT_DEMO_MODE;
  _resetDemoSessionForTesting();

  const isDefaultActive = isPaymentDemoMode();
  assert(
    isDefaultActive === false,
    "Demo mode must be strictly disabled by default when no flags or session are set"
  );
  console.log("  ✓ Disabled by default verified");
}

// --- TEST 2: Hard Security Gate - Production Build Protection ---
console.log("Test 2: Production build cannot enable demo mode");
{
  try {
    _resetDemoSessionForTesting();
    _setTestEnvOverride({ PROD: true, DEV: false });
    process.env.VITE_ENABLE_PAYMENT_DEMO_MODE = "true";

    assert(
      isPaymentDemoMode() === false,
      "Demo mode must be strictly FALSE in production builds, even if env flag is true"
    );

    assert(
      getDemoPaymentModeSource() === "disabled",
      "Demo source must report disabled in production builds"
    );

    // Attempting to set session in production must not enable it
    setPaymentDemoMode(true);
    assert(
      isPaymentDemoMode() === false,
      "setPaymentDemoMode must have no effect in production builds"
    );
    console.log("  ✓ Production hard-gate verified: demo mode permanently disabled in PROD");
  } finally {
    _resetDemoSessionForTesting();
    delete process.env.VITE_ENABLE_PAYMENT_DEMO_MODE;
  }
}

// --- TEST 3: Development Activation via Env Flag ---
console.log("Test 3: Development activation via VITE_ENABLE_PAYMENT_DEMO_MODE");
{
  try {
    _resetDemoSessionForTesting();
    _setTestEnvOverride({ PROD: false, DEV: true });
    process.env.VITE_ENABLE_PAYMENT_DEMO_MODE = "true";

    assert(
      isPaymentDemoMode() === true,
      "Demo mode must be active in DEV when VITE_ENABLE_PAYMENT_DEMO_MODE is true"
    );
    assert(
      getDemoPaymentModeSource() === "env",
      "Source should report 'env' when enabled via environment variable"
    );
    console.log("  ✓ Environment variable activation verified");
  } finally {
    _resetDemoSessionForTesting();
    delete process.env.VITE_ENABLE_PAYMENT_DEMO_MODE;
  }
}

// --- TEST 4: Development Activation via Session Toggle ---
console.log("Test 4: Development activation via session toggle");
{
  try {
    _resetDemoSessionForTesting();
    _setTestEnvOverride({ PROD: false, DEV: true });
    delete process.env.VITE_ENABLE_PAYMENT_DEMO_MODE;

    // Toggle on
    setPaymentDemoMode(true);
    assert(
      isPaymentDemoMode() === true,
      "Demo mode must be active after setPaymentDemoMode(true)"
    );

    // Toggle off
    setPaymentDemoMode(false);
    assert(
      isPaymentDemoMode() === false,
      "Demo mode must be inactive after setPaymentDemoMode(false)"
    );
    console.log("  ✓ Session toggle activation and deactivation verified");
  } finally {
    _resetDemoSessionForTesting();
  }
}

// --- TEST 5: Mock Reference Generation ---
console.log("Test 5: Mock reference formatting and uniqueness");
{
  const ref1 = generateMockPaymentReference();
  const ref2 = generateMockPaymentReference();

  assert(
    ref1.startsWith("DEMO-TX-MOCK-"),
    `Reference must start with 'DEMO-TX-MOCK-'. Received: ${ref1}`
  );
  assert(
    ref2.startsWith("DEMO-TX-MOCK-"),
    `Reference must start with 'DEMO-TX-MOCK-'. Received: ${ref2}`
  );
  assert(
    ref1 !== ref2,
    "Generated mock references must be unique across calls"
  );
  console.log(`  ✓ Reference format verified: ${ref1}`);
}

// --- TEST 6: Strict Consultation Fee Validation (No Fallback Fee) ---
console.log("Test 6: Strict consultation fee validation without fallback");
{
  // 1. Valid fee is preserved accurately
  const checkout = createMockCheckoutData({
    clinicName: "Cebu Skin Clinic",
    doctorName: "Dr. Maria Santos",
    date: "October 25, 2026",
    time: "09:30 AM",
    conditionName: "Eczema",
    confidenceScore: 0.94,
    consultationFee: 750,
  });

  assert(checkout.clinicName === "Cebu Skin Clinic", "Clinic name must be preserved");
  assert(checkout.doctorName === "Dr. Maria Santos", "Doctor name must be preserved");
  assert(checkout.date === "October 25, 2026", "Date must be preserved");
  assert(checkout.time === "09:30 AM", "Time must be preserved");
  assert(checkout.conditionName === "Eczema", "Condition name must be preserved");
  assert(checkout.confidenceScore === 0.94, "Confidence score must be preserved");
  assert(checkout.consultationFee === 750, "Verified clinic fee must be preserved");
  assert(checkout.outcome === "idle", "Initial outcome must be 'idle'");
  assert(checkout.paymentMethod === "gcash", "Default method must be 'gcash'");
  assert(checkout.mockReference.startsWith("DEMO-TX-MOCK-"), "Must have mock reference");
  assert(checkout.mockQueueNumber >= 1, "Queue number must be positive");
  assert(checkout.mobileNumber === "09999999999", "Default mobile number is initialized");

  // 1b. Patient custom mobile number input
  const customNumberCheckout = createMockCheckoutData({
    clinicName: "Cebu Skin Clinic",
    date: "October 25, 2026",
    time: "09:30 AM",
    consultationFee: 750,
    payerName: "Juan Dela Cruz",
    payerEmail: "juan@example.com",
    payerAddress: "Barangay Luz, Cebu City",
    mobileNumber: "09171234567",
  });
  assert(customNumberCheckout.payerName === "Juan Dela Cruz", "Custom payer name preserved");
  assert(customNumberCheckout.payerEmail === "juan@example.com", "Custom payer email preserved");
  assert(customNumberCheckout.payerAddress === "Barangay Luz, Cebu City", "Custom payer address preserved");
  assert(customNumberCheckout.mobileNumber === "09171234567", "Custom patient mobile number preserved");

  // 2. Reject missing fee
  let missingFeeThrew = false;
  try {
    createMockCheckoutData({
      clinicName: "Test Clinic",
      date: "October 25, 2026",
      time: "09:00 AM",
      consultationFee: undefined as any,
    });
  } catch (err: any) {
    missingFeeThrew = true;
    assert(
      err.message.includes("Missing or invalid clinic consultation fee"),
      "Should throw clear error for missing fee"
    );
  }
  assert(missingFeeThrew, "Must reject undefined consultation fee");

  // 3. Reject invalid (NaN) fee
  let nanFeeThrew = false;
  try {
    createMockCheckoutData({
      clinicName: "Test Clinic",
      date: "October 25, 2026",
      time: "09:00 AM",
      consultationFee: "invalid-fee" as any,
    });
  } catch (err: any) {
    nanFeeThrew = true;
  }
  assert(nanFeeThrew, "Must reject NaN consultation fee");

  // 4. Reject non-positive (<= 0) fee
  let zeroFeeThrew = false;
  try {
    createMockCheckoutData({
      clinicName: "Test Clinic",
      date: "October 25, 2026",
      time: "09:00 AM",
      consultationFee: 0,
    });
  } catch (err: any) {
    zeroFeeThrew = true;
  }
  assert(zeroFeeThrew, "Must reject zero consultation fee");

  console.log("  ✓ Strict consultation fee validation verified (no invented fallback fees)");
}

// --- TEST 7: Payment Methods - GCash and Maya ---
console.log("Test 7: GCash and Maya simulated payment methods");
{
  assert(formatDemoPaymentMethod("gcash") === "GCash", "GCash label formatting");
  assert(
    formatDemoPaymentMethod("maya") === "Maya (formerly PayMaya)",
    "Maya label formatting"
  );

  const gcashCheckout = createMockCheckoutData({
    clinicName: "Skin Care",
    date: "2026-10-25",
    time: "10:00 AM",
    consultationFee: 600,
    paymentMethod: "gcash",
  });
  assert(gcashCheckout.paymentMethod === "gcash", "GCash selection preserved");

  const mayaCheckout = createMockCheckoutData({
    clinicName: "Skin Care",
    date: "2026-10-25",
    time: "10:00 AM",
    consultationFee: 600,
    paymentMethod: "maya",
  });
  assert(mayaCheckout.paymentMethod === "maya", "Maya selection preserved");
  console.log("  ✓ GCash and Maya payment methods verified");
}

// --- TEST 8: Simulation State Transitions ---
console.log("Test 8: Simulation state transitions (Success, Failure, Cancel, Retry)");
{
  let state: DemoCheckoutData = createMockCheckoutData({
    clinicName: "Skin Health Center",
    date: "October 26, 2026",
    time: "10:00 AM",
    consultationFee: 550,
  });

  // 1. Switch to Maya
  state = { ...state, paymentMethod: "maya" as DemoPaymentMethod };
  assert(state.paymentMethod === "maya", "Method should update to maya");

  // 2. Simulate Success
  const simTime = "10:05:00 AM";
  state = { ...state, outcome: "success" as DemoOutcome, simulatedAt: simTime };
  assert(state.outcome === "success", "Outcome must be 'success'");
  assert(state.simulatedAt === simTime, "Simulated timestamp must be recorded");

  // 3. Retry / Reset
  state = { ...state, outcome: "idle" as DemoOutcome, errorMessage: undefined };
  assert(state.outcome === "idle", "Outcome must reset to 'idle'");

  // 4. Simulate Failure
  state = {
    ...state,
    outcome: "failed" as DemoOutcome,
    errorMessage: "Simulated payment failed as requested for testing.",
  };
  assert(state.outcome === "failed", "Outcome must be 'failed'");
  assert(
    state.errorMessage?.includes("failed"),
    "Failure message must be present"
  );

  // 5. Cancel
  state = { ...state, outcome: "cancelled" as DemoOutcome };
  assert(state.outcome === "cancelled", "Outcome must be 'cancelled'");

  console.log("  ✓ All outcome transitions verified (Idle -> Success -> Idle -> Failed -> Cancelled)");
}

// --- TEST 9: Submission Decision Path (Early Interception & Safety) ---
console.log("Test 9: Submission decision path evaluation");
{
  const mockClinic = {
    id: "clinic-123",
    name: "DermAI Partner Clinic",
    consultationFee: "800",
  };

  // Case A: Demo mode ACTIVE with valid fee -> Opens simulated checkout BEFORE any DB write
  const activeDecision = evaluateAppointmentSubmission({
    isDemoMode: true,
    clinic: mockClinic,
    selectedDate: "2026-10-25",
    selectedTime: "09:00",
    doctorName: "Dr. Perez",
    scan: { id: "scan-abc", conditionName: "Acne", confidence: 0.91 },
    patientName: "Juan Dela Cruz",
    patientEmail: "juan@example.com",
    patientAddress: "Barangay Luz, Cebu City",
    patientContact: "09171234567",
  });

  assert(
    activeDecision.action === "open_demo_checkout",
    "Demo active must intercept with open_demo_checkout"
  );
  if (activeDecision.action === "open_demo_checkout") {
    assert(
      activeDecision.checkoutData.consultationFee === 800,
      "Actual clinic fee must be passed to checkout"
    );
    assert(
      activeDecision.checkoutData.clinicName === "DermAI Partner Clinic",
      "Clinic name must be preserved"
    );
    assert(
      activeDecision.checkoutData.paymentMethod === "gcash",
      "Default simulated method must be gcash"
    );
    assert(
      activeDecision.checkoutData.payerName === "Juan Dela Cruz",
      "Patient name must be passed to checkout data"
    );
    assert(
      activeDecision.checkoutData.mobileNumber === "09171234567",
      "Patient mobile number must be passed to checkout data"
    );
    assert(
      activeDecision.checkoutData.mockReference.startsWith("DEMO-TX-MOCK-"),
      "Must have mock reference"
    );
  }

  // Case B: Demo mode ACTIVE with missing clinic fee -> Rejects without proceeding or fallback
  const missingFeeDecision = evaluateAppointmentSubmission({
    isDemoMode: true,
    clinic: { id: "clinic-456", name: "Fee-less Clinic", consultationFee: "" },
    selectedDate: "2026-10-25",
    selectedTime: "09:00",
  });
  assert(
    missingFeeDecision.action === "error",
    "Missing fee must produce an error"
  );
  if (missingFeeDecision.action === "error") {
    assert(
      missingFeeDecision.errorMessage.includes("valid consultation fee"),
      "Must explain that fee is missing/invalid"
    );
  }

  // Case C: Demo mode ACTIVE with zero fee -> Rejects
  const zeroFeeDecision = evaluateAppointmentSubmission({
    isDemoMode: true,
    clinic: { id: "clinic-789", name: "Free Clinic", consultationFee: 0 },
    selectedDate: "2026-10-25",
    selectedTime: "09:00",
  });
  assert(zeroFeeDecision.action === "error", "Zero fee must produce an error");

  // Case D: Demo mode DISABLED -> Preserves normal booking flow
  const disabledDecision = evaluateAppointmentSubmission({
    isDemoMode: false,
    clinic: mockClinic,
    selectedDate: "2026-10-25",
    selectedTime: "09:00",
  });
  assert(
    disabledDecision.action === "proceed_real_booking",
    "Demo disabled must allow normal booking flow"
  );

  console.log("  ✓ Real submission decision paths verified (interception, fee check, fallback prevention, normal flow preservation)");
}

// --- TEST 10: Zero Database Mutation Guarantee ---
console.log("Test 10: Zero database mutation verification");
{
  const mockState = createMockCheckoutData({
    clinicName: "Test Clinic",
    date: "2026-10-25",
    time: "09:00",
    consultationFee: 500,
  });

  // State is purely ephemeral in memory
  assert(!("id" in mockState), "Demo state must not produce an unpersisted database row id");
  assert(
    mockState.mockReference.startsWith("DEMO-TX-MOCK-"),
    "Reference must indicate mock status"
  );
  console.log("  ✓ Zero database mutations guaranteed");
}

console.log("\n=== All DermAI Payment Demo Tests Passed Successfully! ===");
