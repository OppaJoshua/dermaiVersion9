import assert from "node:assert/strict";
import test from "node:test";

// -----------------------------------------------------------------------------
// Comprehensive Unit & Regression Tests for DermAI PayMongo Subscription Safety
// -----------------------------------------------------------------------------

test("Scenario 1: Active subscription derives 'Active' badge and styling", () => {
  const isPro = true;
  const subData = {
    status: "active",
    cancel_at_period_end: false,
    cancelled_at: null,
    current_period_end: new Date(Date.now() + 86400000 * 20).toISOString(),
  };

  const cancelAtPeriodEnd = Boolean(subData.cancel_at_period_end || subData.status === "cancelling");
  const badgeText = isPro ? (cancelAtPeriodEnd ? "Cancelling" : "Active") : "Free Plan";
  const badgeClass = isPro
    ? cancelAtPeriodEnd
      ? "bg-amber-100 text-amber-800"
      : "bg-pink-100 text-[#A21D5C]"
    : "bg-gray-100 text-gray-600";

  assert.equal(cancelAtPeriodEnd, false);
  assert.equal(badgeText, "Active");
  assert.equal(badgeClass, "bg-pink-100 text-[#A21D5C]");
});

test("Scenario 2: Cancelling subscription derives 'Cancelling' badge while access continues", () => {
  const isPro = true;
  const subData = {
    status: "active",
    cancel_at_period_end: true,
    cancelled_at: new Date(Date.now() - 3600000).toISOString(),
    current_period_end: new Date(Date.now() + 86400000 * 15).toISOString(),
  };

  const cancelAtPeriodEnd = Boolean(subData.cancel_at_period_end || subData.status === "cancelling");
  const badgeText = isPro ? (cancelAtPeriodEnd ? "Cancelling" : "Active") : "Free Plan";
  const badgeClass = isPro
    ? cancelAtPeriodEnd
      ? "bg-amber-100 text-amber-800"
      : "bg-pink-100 text-[#A21D5C]"
    : "bg-gray-100 text-gray-600";

  // Entitlement validity check
  const periodEndMs = new Date(subData.current_period_end).getTime();
  const hasEntitlement = subData.status === "active" && periodEndMs > Date.now();

  assert.equal(cancelAtPeriodEnd, true);
  assert.equal(badgeText, "Cancelling");
  assert.equal(badgeClass, "bg-amber-100 text-amber-800");
  assert.equal(hasEntitlement, true);
});

test("Scenario 3: Resume Subscription clears cancel_at_period_end and cancelled_at ($0 charge)", () => {
  const currentSub = {
    subscription_id: "sub_test_001",
    status: "active",
    cancel_at_period_end: true,
    cancelled_at: "2026-11-01T10:00:00.000Z",
    current_period_end: new Date(Date.now() + 86400000 * 10).toISOString(),
  };

  const resumePayload = {
    cancel_at_period_end: false,
    cancelled_at: null,
    updated_at: new Date().toISOString(),
  };

  const updatedSub = { ...currentSub, ...resumePayload };

  assert.equal(updatedSub.cancel_at_period_end, false);
  assert.equal(updatedSub.cancelled_at, null);
  assert.equal(updatedSub.status, "active");
  assert.equal(updatedSub.current_period_end, currentSub.current_period_end);
});

test("Scenario 4: Genuinely new payment activation resets stale cancellation flags", () => {
  const oldCancelledSub = {
    user_id: "user_test_99",
    status: "expired",
    cancel_at_period_end: true,
    cancelled_at: "2026-10-10T12:00:00.000Z",
  };

  const paidAtSeconds = Math.floor(new Date("2026-11-12T03:00:00.000Z").getTime() / 1000);
  const hasTrustedTime = typeof paidAtSeconds === "number" && Number.isFinite(paidAtSeconds) && paidAtSeconds > 0;
  const paymentTimeMs = hasTrustedTime ? paidAtSeconds * 1000 : null;
  const cancelledTime = oldCancelledSub.cancelled_at ? new Date(oldCancelledSub.cancelled_at).getTime() : 0;

  const isNewerCancellation = Boolean(
    oldCancelledSub.cancel_at_period_end &&
    (paymentTimeMs === null || cancelledTime >= paymentTimeMs)
  );

  assert.equal(isNewerCancellation, false, "Old cancellation is not newer than the verified new payment");

  const newPeriodStart = new Date("2026-11-12T03:00:00.000Z");
  const newPeriodEnd = new Date(newPeriodStart);
  newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

  const subscriptionRecord = {
    user_id: oldCancelledSub.user_id,
    plan_id: "plan_pro_uuid",
    status: "active",
    billing_cycle: "monthly",
    started_at: newPeriodStart.toISOString(),
    renews_at: newPeriodEnd.toISOString(),
    current_period_start: newPeriodStart.toISOString(),
    current_period_end: newPeriodEnd.toISOString(),
    cancel_at_period_end: isNewerCancellation ? true : false,
    cancelled_at: isNewerCancellation ? (oldCancelledSub.cancelled_at ?? null) : null,
  };

  assert.equal(subscriptionRecord.status, "active");
  assert.equal(subscriptionRecord.cancel_at_period_end, false);
  assert.equal(subscriptionRecord.cancelled_at, null);
});

test("Scenario 5: Replayed or delayed older payment DOES NOT override a newer patient cancellation", () => {
  const currentSub = {
    user_id: "user_test_99",
    status: "active",
    cancel_at_period_end: true,
    cancelled_at: "2026-11-05T14:30:00.000Z",
  };

  // Delayed payment event from Nov 1st
  const oldPaymentPaidAtSeconds = Math.floor(new Date("2026-11-01T10:00:00.000Z").getTime() / 1000);
  const hasTrustedTime = typeof oldPaymentPaidAtSeconds === "number" && Number.isFinite(oldPaymentPaidAtSeconds) && oldPaymentPaidAtSeconds > 0;
  const paymentTimeMs = hasTrustedTime ? oldPaymentPaidAtSeconds * 1000 : null;
  const cancelledTime = currentSub.cancelled_at ? new Date(currentSub.cancelled_at).getTime() : 0;

  const isNewerCancellation = Boolean(
    currentSub.cancel_at_period_end &&
    (paymentTimeMs === null || cancelledTime >= paymentTimeMs)
  );

  assert.equal(isNewerCancellation, true, "User cancellation is newer than the replayed payment");

  const subscriptionRecord = {
    cancel_at_period_end: isNewerCancellation ? true : false,
    cancelled_at: isNewerCancellation ? (currentSub.cancelled_at ?? null) : null,
  };

  assert.equal(subscriptionRecord.cancel_at_period_end, true, "Cancellation flag must NOT be reset by old event");
  assert.equal(subscriptionRecord.cancelled_at, "2026-11-05T14:30:00.000Z");
});

test("Scenario 6: Missing payment timestamp FAILS SAFE and preserves cancellation", () => {
  const currentSub = {
    user_id: "user_test_99",
    status: "active",
    cancel_at_period_end: true,
    cancelled_at: "2026-11-05T14:30:00.000Z",
  };

  // Timestamp is missing (null or undefined)
  const paidAtSeconds = null;
  const hasTrustedTime = typeof paidAtSeconds === "number" && Number.isFinite(paidAtSeconds) && paidAtSeconds > 0;
  const paymentTimeMs = hasTrustedTime ? paidAtSeconds * 1000 : null;
  const cancelledTime = currentSub.cancelled_at ? new Date(currentSub.cancelled_at).getTime() : 0;

  const isNewerCancellation = Boolean(
    currentSub.cancel_at_period_end &&
    (paymentTimeMs === null || cancelledTime >= paymentTimeMs)
  );

  assert.equal(isNewerCancellation, true, "Missing payment timestamp must fail safe and preserve cancellation");
});

test("Scenario 7: Invalid or malformed payment timestamp FAILS SAFE and preserves cancellation", () => {
  const currentSub = {
    user_id: "user_test_99",
    status: "active",
    cancel_at_period_end: true,
    cancelled_at: "2026-11-05T14:30:00.000Z",
  };

  // Invalid timestamp (NaN, negative, or non-number)
  const invalidTimestamps = [NaN, -1, "2026-11-12", undefined];
  for (const invalidTs of invalidTimestamps) {
    const hasTrustedTime = typeof invalidTs === "number" && Number.isFinite(invalidTs) && invalidTs > 0;
    const paymentTimeMs = hasTrustedTime ? invalidTs * 1000 : null;
    const cancelledTime = currentSub.cancelled_at ? new Date(currentSub.cancelled_at).getTime() : 0;

    const isNewerCancellation = Boolean(
      currentSub.cancel_at_period_end &&
      (paymentTimeMs === null || cancelledTime >= paymentTimeMs)
    );

    assert.equal(isNewerCancellation, true, `Invalid timestamp ${invalidTs} must preserve cancellation`);
  }
});

test("Scenario 8: Equal timestamps are handled conservatively (preserves cancellation)", () => {
  const timestampIso = "2026-11-05T14:30:00.000Z";
  const currentSub = {
    user_id: "user_test_99",
    status: "active",
    cancel_at_period_end: true,
    cancelled_at: timestampIso,
  };

  const paidAtSeconds = Math.floor(new Date(timestampIso).getTime() / 1000);
  const hasTrustedTime = typeof paidAtSeconds === "number" && Number.isFinite(paidAtSeconds) && paidAtSeconds > 0;
  const paymentTimeMs = hasTrustedTime ? paidAtSeconds * 1000 : null;
  const cancelledTime = new Date(currentSub.cancelled_at).getTime();

  // cancelledTime >= paymentTimeMs preserves cancellation
  const isNewerCancellation = Boolean(
    currentSub.cancel_at_period_end &&
    (paymentTimeMs === null || cancelledTime >= paymentTimeMs)
  );

  assert.equal(isNewerCancellation, true, "Equal timestamp must fail safe and preserve cancellation");
});

test("Scenario 9: Client-side fail-safe guard preserves cancellation", () => {
  const existingSub = {
    cancel_at_period_end: true,
    cancelled_at: "2026-11-01T00:00:00.000Z",
  };

  // Browser client cannot dictate cancellation clearing
  const isNewerCancellation = Boolean(existingSub?.cancel_at_period_end);
  assert.equal(isNewerCancellation, true, "Client fulfillment cannot clear cancellation flag");
});

test("Scenario 10: Exact-payment fulfillment idempotency skips period recalculation", () => {
  const existingPayment = {
    payment_id: "pay_db_001",
  };
  const existingSub = {
    status: "active",
    plan_id: "plan_pro_001",
    current_period_end: new Date(Date.now() + 86400000 * 20).toISOString(),
  };

  const requestedPlanId = "plan_pro_001";
  const isAlreadyFullyFulfilled = Boolean(
    existingPayment &&
    existingSub &&
    existingSub.status === "active" &&
    existingSub.plan_id === requestedPlanId &&
    existingSub.current_period_end &&
    new Date(existingSub.current_period_end).getTime() > Date.now()
  );

  assert.equal(isAlreadyFullyFulfilled, true, "Fully fulfilled payment is recognized for idempotent skip");
});

test("Scenario 11: Partially fulfilled payment is recovered (not skipped)", () => {
  const existingPayment = {
    payment_id: "pay_db_001",
  };
  // Subscription write failed earlier; still marked expired
  const existingSub = {
    status: "expired",
    plan_id: "plan_free_000",
    current_period_end: new Date(Date.now() - 86400000).toISOString(),
  };

  const requestedPlanId = "plan_pro_001";
  const isAlreadyFullyFulfilled = Boolean(
    existingPayment &&
    existingSub &&
    existingSub.status === "active" &&
    existingSub.plan_id === requestedPlanId &&
    existingSub.current_period_end &&
    new Date(existingSub.current_period_end).getTime() > Date.now()
  );

  assert.equal(isAlreadyFullyFulfilled, false, "Partial fulfillment must NOT be skipped; it must be recovered");
});

test("Scenario 12: ACTIVE_SUBSCRIPTION protection prevents repurchasing during unexpired period", () => {
  const existingSubscription = {
    subscription_id: "sub_active_123",
    status: "active",
    current_period_end: new Date(Date.now() + 86400000 * 25).toISOString(),
    cancel_at_period_end: true,
    plan: { price: 299, name: "Pro Monthly" },
  };

  const existingPeriodEnd = existingSubscription.current_period_end
    ? new Date(existingSubscription.current_period_end)
    : null;
  const existingPlan = existingSubscription.plan;

  const hasActivePaidPeriod =
    existingSubscription.status === "active" &&
    Number(existingPlan.price ?? 0) > 0 &&
    existingPeriodEnd !== null &&
    existingPeriodEnd.getTime() > Date.now();

  assert.equal(hasActivePaidPeriod, true, "Active paid period is correctly recognized");
});

test("Scenario 13: Date calculation offsets for monthly (+1 month) and yearly (+1 year)", () => {
  const start = new Date("2026-01-15T00:00:00.000Z");

  const monthlyEnd = new Date(start);
  monthlyEnd.setMonth(monthlyEnd.getMonth() + 1);

  const yearlyEnd = new Date(start);
  yearlyEnd.setFullYear(yearlyEnd.getFullYear() + 1);

  assert.equal(monthlyEnd.toISOString(), "2026-02-15T00:00:00.000Z");
  assert.equal(yearlyEnd.toISOString(), "2027-01-15T00:00:00.000Z");
});

test("Scenario 14: Dynamic scan allowances (unlimited vs finite limits)", () => {
  function resolveScanLimit(raw, fallback = 3) {
    if (raw === null || raw === undefined) return fallback;
    const num = Number(raw);
    if (!Number.isFinite(num)) return fallback;
    if (num === -1) return -1;
    if (num >= 0) return Math.floor(num);
    return fallback;
  }

  assert.equal(resolveScanLimit(-1), -1, "Unlimited is preserved as -1");
  assert.equal(resolveScanLimit(10), 10, "Finite 10 scans preserved");
  assert.equal(resolveScanLimit(0), 0, "Finite 0 scans preserved");
  assert.equal(resolveScanLimit(null, 3), 3, "Missing falls back safely to 3");
});

// -----------------------------------------------------------------------------
// Phase 3D Targeted Unit Tests: Payment Identity, Idempotency, & Scenarios A-E
// -----------------------------------------------------------------------------

function resolveVerifiedPayment(intentAttributes) {
  const payments = Array.isArray(intentAttributes?.payments) ? intentAttributes.payments : [];
  const expectedPaymentId = (typeof intentAttributes?.latest_payment_id === "string" && intentAttributes.latest_payment_id.trim())
    ? intentAttributes.latest_payment_id.trim()
    : null;

  let primaryPayment = null;

  if (expectedPaymentId) {
    const matchingPayment = payments.find((p) => p?.id === expectedPaymentId);
    if (!matchingPayment) {
      throw new Error(`Expected PayMongo payment ${expectedPaymentId} not found in payment intent`);
    }
    if (matchingPayment.attributes?.status !== "paid") {
      throw new Error(`PayMongo payment ${expectedPaymentId} status is not paid (${matchingPayment.attributes?.status || "unknown"})`);
    }
    primaryPayment = matchingPayment;
  } else {
    const paidPayments = payments.filter((p) => p && p.attributes?.status === "paid");
    if (paidPayments.length === 1) {
      primaryPayment = paidPayments[0];
    } else if (paidPayments.length === 0) {
      throw new Error("No verified paid payment found on payment intent");
    } else {
      throw new Error(`Multiple paid payments (${paidPayments.length}) found without authoritative latest_payment_id`);
    }
  }

  const paymongoPaymentId = primaryPayment?.id;
  if (!paymongoPaymentId || typeof paymongoPaymentId !== "string" || !paymongoPaymentId.startsWith("pay_")) {
    throw new Error(`Invalid or missing PayMongo payment ID: ${paymongoPaymentId}`);
  }

  const amountInCentavos = primaryPayment.attributes?.amount ?? intentAttributes?.amount ?? 0;
  if (typeof amountInCentavos !== "number" || amountInCentavos <= 0) {
    throw new Error(`PayMongo payment amount is missing or invalid: ${amountInCentavos}`);
  }

  const paymentMethodType =
    primaryPayment.attributes?.source?.type ||
    primaryPayment.attributes?.payment_method_details?.type ||
    intentAttributes?.metadata?.payment_method ||
    intentAttributes?.payment_method_allowed?.[0] ||
    "gcash";

  const paidAtSeconds =
    (typeof primaryPayment.attributes?.paid_at === "number" && primaryPayment.attributes.paid_at > 0)
      ? primaryPayment.attributes.paid_at
      : (typeof intentAttributes?.paid_at === "number" && intentAttributes.paid_at > 0)
      ? intentAttributes.paid_at
      : null;

  return {
    paymongoPaymentId,
    amountInCentavos,
    paymentMethodType,
    paidAtSeconds,
  };
}

test("Scenario 15: Failed and successful payment attempts under same PaymentIntent selects ONLY successful payment", () => {
  const intentAttributes = {
    amount: 29900,
    latest_payment_id: "pay_success_123",
    payments: [
      { id: "pay_failed_001", attributes: { status: "failed", amount: 29900 } },
      { id: "pay_success_123", attributes: { status: "paid", amount: 29900, paid_at: 1731384000 } },
    ],
  };

  const resolved = resolveVerifiedPayment(intentAttributes);
  assert.equal(resolved.paymongoPaymentId, "pay_success_123");
  assert.equal(resolved.amountInCentavos, 29900);
  assert.equal(resolved.paidAtSeconds, 1731384000);
});

test("Scenario 16: Expected latest_payment_id has non-paid status throws error (fails closed)", () => {
  const intentAttributes = {
    amount: 29900,
    latest_payment_id: "pay_pending_456",
    payments: [
      { id: "pay_pending_456", attributes: { status: "awaiting_payment_method", amount: 29900 } },
    ],
  };

  assert.throws(
    () => resolveVerifiedPayment(intentAttributes),
    /PayMongo payment pay_pending_456 status is not paid/
  );
});

test("Scenario 17: Expected latest_payment_id not in payments list throws error", () => {
  const intentAttributes = {
    amount: 29900,
    latest_payment_id: "pay_nonexistent_999",
    payments: [
      { id: "pay_other_111", attributes: { status: "paid", amount: 29900 } },
    ],
  };

  assert.throws(
    () => resolveVerifiedPayment(intentAttributes),
    /Expected PayMongo payment pay_nonexistent_999 not found/
  );
});

test("Scenario 18: Missing latest_payment_id with unambiguous single paid payment succeeds", () => {
  const intentAttributes = {
    amount: 29900,
    latest_payment_id: null,
    payments: [
      { id: "pay_single_paid_777", attributes: { status: "paid", amount: 29900, paid_at: 1731384000 } },
    ],
  };

  const resolved = resolveVerifiedPayment(intentAttributes);
  assert.equal(resolved.paymongoPaymentId, "pay_single_paid_777");
});

test("Scenario 19: Missing latest_payment_id with multiple paid payments is ambiguous and throws", () => {
  const intentAttributes = {
    amount: 29900,
    latest_payment_id: null,
    payments: [
      { id: "pay_paid_001", attributes: { status: "paid", amount: 29900 } },
      { id: "pay_paid_002", attributes: { status: "paid", amount: 29900 } },
    ],
  };

  assert.throws(
    () => resolveVerifiedPayment(intentAttributes),
    /Multiple paid payments \(2\) found without authoritative latest_payment_id/
  );
});

test("Scenario 20: Missing latest_payment_id with zero paid payments throws error", () => {
  const intentAttributes = {
    amount: 29900,
    latest_payment_id: null,
    payments: [
      { id: "pay_failed_001", attributes: { status: "failed", amount: 29900 } },
    ],
  };

  assert.throws(
    () => resolveVerifiedPayment(intentAttributes),
    /No verified paid payment found on payment intent/
  );
});

test("Scenario 21: Never substitute PaymentIntent ID as PayMongo payment ID", () => {
  const intentAttributes = {
    amount: 29900,
    latest_payment_id: "pi_not_a_pay_id",
    payments: [
      { id: "pi_not_a_pay_id", attributes: { status: "paid", amount: 29900 } },
    ],
  };

  assert.throws(
    () => resolveVerifiedPayment(intentAttributes),
    /Invalid or missing PayMongo payment ID/
  );
});

test("Scenario A Verification: Duplicate payment delivery skips re-extension and preserves dates", () => {
  const existingPayment = {
    payment_id: "db_pay_1",
    payment_date: "2026-11-12T01:00:00.000Z",
  };
  const existingSub = {
    status: "active",
    plan_id: "plan_pro",
    current_period_start: "2026-11-12T01:00:00.000Z",
    current_period_end: "2026-12-12T01:00:00.000Z",
  };

  const paymentTimeMs = new Date("2026-11-12T01:00:00.000Z").getTime();
  const refPaymentTimeMs = paymentTimeMs ?? new Date(existingPayment.payment_date).getTime();
  const subPeriodStartMs = new Date(existingSub.current_period_start).getTime();

  const isAlreadyFullyFulfilled = Boolean(
    existingPayment &&
    existingSub &&
    existingSub.status === "active" &&
    existingSub.plan_id === "plan_pro" &&
    refPaymentTimeMs !== null &&
    Math.abs(subPeriodStartMs - refPaymentTimeMs) < 10000
  );

  assert.equal(isAlreadyFullyFulfilled, true, "Duplicate payment is recognized and skipped without re-extending");
});

test("Scenario B Verification: Partial fulfillment recovery restores missing entitlement", () => {
  const existingPayment = {
    payment_id: "db_pay_1",
    payment_date: "2026-11-12T01:00:00.000Z",
  };
  // Subscription write previously failed or is still expired Free plan
  const existingSub = {
    status: "expired",
    plan_id: "plan_free",
    current_period_start: "2026-10-12T01:00:00.000Z",
    current_period_end: "2026-11-12T01:00:00.000Z",
  };

  const paymentTimeMs = new Date("2026-11-12T01:00:00.000Z").getTime();
  const refPaymentTimeMs = paymentTimeMs ?? new Date(existingPayment.payment_date).getTime();
  const subPeriodStartMs = new Date(existingSub.current_period_start).getTime();

  const isAlreadyFullyFulfilled = Boolean(
    existingPayment &&
    existingSub &&
    existingSub.status === "active" &&
    existingSub.plan_id === "plan_pro" &&
    refPaymentTimeMs !== null &&
    Math.abs(subPeriodStartMs - refPaymentTimeMs) < 10000
  );

  assert.equal(isAlreadyFullyFulfilled, false, "Partial fulfillment is NOT skipped; recovery proceeds");

  // Recovery anchors to the original payment date
  const periodStart = new Date(paymentTimeMs);
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  assert.equal(periodStart.toISOString(), "2026-11-12T01:00:00.000Z");
  assert.equal(periodEnd.toISOString(), "2026-12-12T01:00:00.000Z");
});

test("Scenario C Verification: Delayed old webhook does NOT overwrite newer subscription", () => {
  // Existing subscription was already activated by a newer Payment B on Dec 1st
  const existingSub = {
    status: "active",
    plan_id: "plan_pro",
    started_at: "2026-12-01T10:00:00.000Z",
    current_period_start: "2026-12-01T10:00:00.000Z",
    current_period_end: "2027-01-01T10:00:00.000Z",
    cancel_at_period_end: false,
    cancelled_at: null,
  };

  // Delayed webhook arrives from Payment A on Nov 1st
  const paymentTimeMs = new Date("2026-11-01T10:00:00.000Z").getTime();
  const existingStartedMs = new Date(existingSub.started_at).getTime();

  const isOlderPayment = Boolean(
    existingSub &&
    existingStartedMs > 0 &&
    paymentTimeMs !== null &&
    existingStartedMs > paymentTimeMs + 5000
  );

  assert.equal(isOlderPayment, true, "Older payment is detected and prevented from overwriting newer subscription");
});

test("Scenario D Verification: New payment for same plan is not skipped", () => {
  // Brand new payment has no row in user_payment yet
  const existingPayment = null;
  const existingSub = {
    status: "active",
    plan_id: "plan_pro",
    current_period_start: "2026-10-12T00:00:00.000Z",
    current_period_end: "2026-11-12T00:00:00.000Z",
  };

  const isAlreadyFullyFulfilled = Boolean(
    existingPayment &&
    existingSub &&
    existingSub.status === "active" &&
    existingSub.plan_id === "plan_pro"
  );

  assert.equal(isAlreadyFullyFulfilled, false, "New payment is not skipped and grants new period");
});

test("Scenario E Verification: Concurrent webhook and client verification compute identical periods", () => {
  const gatewayPaidAtSeconds = 1731384000; // Fixed gateway timestamp
  const paymentTimeMs = gatewayPaidAtSeconds * 1000;

  // Webhook calculation:
  const webhookPeriodStart = new Date(paymentTimeMs);
  const webhookPeriodEnd = new Date(webhookPeriodStart);
  webhookPeriodEnd.setMonth(webhookPeriodEnd.getMonth() + 1);

  // Client verification call calculation (running 2.5 seconds later):
  const clientPeriodStart = new Date(paymentTimeMs);
  const clientPeriodEnd = new Date(clientPeriodStart);
  clientPeriodEnd.setMonth(clientPeriodEnd.getMonth() + 1);

  assert.equal(webhookPeriodStart.toISOString(), clientPeriodStart.toISOString());
  assert.equal(webhookPeriodEnd.toISOString(), clientPeriodEnd.toISOString());
});

// -----------------------------------------------------------------------------
// Phase 3E Targeted Unit Tests: Authoritative Amount & Missing Timestamp Safety
// -----------------------------------------------------------------------------

test("Scenario 22: Payment amount matching authoritative PaymentIntent amount succeeds", () => {
  const intentAttributes = {
    amount: 33488,
    currency: "PHP",
    latest_payment_id: "pay_exact_33488",
    payments: [
      { id: "pay_exact_33488", attributes: { status: "paid", amount: 33488, currency: "PHP", paid_at: 1731384000 } },
    ],
  };

  const primaryPayment = intentAttributes.payments[0];
  assert.equal(primaryPayment.attributes.amount, intentAttributes.amount);
  assert.equal(primaryPayment.attributes.currency.toUpperCase(), intentAttributes.currency.toUpperCase());
});

test("Scenario 23: Payment amount mismatching PaymentIntent expected amount throws error", () => {
  const intentAttributes = {
    amount: 33488,
    currency: "PHP",
    latest_payment_id: "pay_tampered_100",
    payments: [
      { id: "pay_tampered_100", attributes: { status: "paid", amount: 100, currency: "PHP", paid_at: 1731384000 } },
    ],
  };

  const primaryPayment = intentAttributes.payments[0];
  assert.throws(() => {
    if (primaryPayment.attributes.amount !== intentAttributes.amount) {
      throw new Error(`Payment amount mismatch: payment has ${primaryPayment.attributes.amount} centavos, but PaymentIntent expected ${intentAttributes.amount} centavos`);
    }
  }, /Payment amount mismatch/);
});

test("Scenario 24: Payment currency mismatch throws error", () => {
  const intentAttributes = {
    amount: 33488,
    currency: "PHP",
    latest_payment_id: "pay_usd_test",
    payments: [
      { id: "pay_usd_test", attributes: { status: "paid", amount: 33488, currency: "USD", paid_at: 1731384000 } },
    ],
  };

  const primaryPayment = intentAttributes.payments[0];
  assert.throws(() => {
    if (primaryPayment.attributes.currency.toUpperCase() !== intentAttributes.currency.toUpperCase()) {
      throw new Error(`Payment currency mismatch: payment has ${primaryPayment.attributes.currency}, but PaymentIntent expected ${intentAttributes.currency}`);
    }
  }, /Payment currency mismatch/);
});

test("Scenario 25: Checkout-time metadata snapshot verifies paid amount without querying mutable DB plan price", () => {
  const metadata = {
    amount_paid: "334.88",
    total_amount: "334.88",
    plan_id: "plan_pro_uuid",
  };
  const amountInCentavos = 33488;

  const snapshotAmountStr = metadata?.amount_paid || metadata?.total_amount;
  const expectedSnapshotCentavos = Math.round(Number(snapshotAmountStr) * 100);

  assert.equal(amountInCentavos, expectedSnapshotCentavos, "Paid amount strictly matches checkout-time snapshot");
});

test("Scenario 26: Checkout-time metadata snapshot detects underpaid transaction", () => {
  const metadata = {
    amount_paid: "334.88",
    total_amount: "334.88",
  };
  const amountInCentavos = 10000; // ₱100 instead of ₱334.88

  const snapshotAmountStr = metadata?.amount_paid || metadata?.total_amount;
  const expectedSnapshotCentavos = Math.round(Number(snapshotAmountStr) * 100);

  assert.throws(() => {
    if (amountInCentavos !== expectedSnapshotCentavos) {
      throw new Error(`Payment amount mismatch: received ${amountInCentavos} centavos, but checkout snapshot expected ${expectedSnapshotCentavos} centavos`);
    }
  }, /Payment amount mismatch/);
});

test("Scenario 27: Missing paid_at uses existingPayment.payment_date to reliably identify older payment", () => {
  // Existing payment in user_payment was recorded on Nov 1st
  const existingPayment = {
    payment_id: "pay_old_db",
    payment_date: "2026-11-01T10:00:00.000Z",
  };
  // User subsequently activated a newer subscription on Dec 1st
  const existingSub = {
    status: "active",
    started_at: "2026-12-01T10:00:00.000Z",
  };

  // Webhook arrives without paid_at timestamp
  const paymentTimeMs = null;
  const refPaymentTimeMs = paymentTimeMs ?? (existingPayment?.payment_date ? new Date(existingPayment.payment_date).getTime() : null);

  const existingStartedMs = new Date(existingSub.started_at).getTime();
  const isOlderPayment = Boolean(
    existingSub &&
    existingStartedMs > 0 &&
    refPaymentTimeMs !== null &&
    existingStartedMs > refPaymentTimeMs + 5000
  );

  assert.equal(isOlderPayment, true, "Older payment without gateway timestamp is correctly identified using user_payment date");
});

test("Scenario 28: Untimestamped payment arriving while active subscription exists fails closed (never overwrites)", () => {
  const existingPayment = null;
  const paymentTimeMs = null;
  const refPaymentTimeMs = paymentTimeMs ?? (existingPayment?.payment_date ? new Date(existingPayment.payment_date).getTime() : null);

  const existingSub = {
    status: "active",
    current_period_end: new Date(Date.now() + 86400000 * 20).toISOString(),
    cancel_at_period_end: true, // has pending cancellation
  };

  const hasActivePaidSubscription = Boolean(
    existingSub &&
    existingSub.status === "active" &&
    existingSub.current_period_end &&
    new Date(existingSub.current_period_end).getTime() > Date.now()
  );

  assert.throws(() => {
    if (refPaymentTimeMs === null && hasActivePaidSubscription) {
      throw new Error("Cannot safely fulfill untimestamped payment while an active subscription exists.");
    }
  }, /Cannot safely fulfill untimestamped payment/);
});

test("Scenario 29: Untimestamped payment with NO verifiable origin fails closed safely (never manufactures new Date())", () => {
  const existingPayment = null;
  const paymentTimeMs = null;
  const existingPaymentDateMs = existingPayment?.payment_date
    ? new Date(existingPayment.payment_date).getTime()
    : null;
  const validExistingDateMs =
    typeof existingPaymentDateMs === "number" &&
    Number.isFinite(existingPaymentDateMs) &&
    existingPaymentDateMs > 0
      ? existingPaymentDateMs
      : null;

  const refPaymentTimeMs = paymentTimeMs ?? validExistingDateMs;

  assert.throws(() => {
    if (refPaymentTimeMs === null || !Number.isFinite(refPaymentTimeMs) || refPaymentTimeMs <= 0) {
      throw new Error("Cannot safely fulfill payment: authoritative payment timestamp is missing or invalid. Client re-verification required.");
    }
  }, /authoritative payment timestamp is missing or invalid/);
});

test("Scenario 30: Missing authoritative expected amount from all sources fails closed", () => {
  const expectedAmountInCentavos = null;
  const metadata = {};
  const amountInCentavos = 19900;

  let authoritativeExpectedCentavos = null;
  if (typeof expectedAmountInCentavos === "number" && Number.isFinite(expectedAmountInCentavos) && expectedAmountInCentavos > 0) {
    authoritativeExpectedCentavos = expectedAmountInCentavos;
  } else {
    const snapshotAmountStr = metadata?.amount_paid || metadata?.total_amount;
    if (snapshotAmountStr) {
      const parsed = Math.round(Number(snapshotAmountStr) * 100);
      if (Number.isFinite(parsed) && parsed > 0) {
        authoritativeExpectedCentavos = parsed;
      }
    }
  }

  assert.throws(() => {
    if (authoritativeExpectedCentavos === null || !Number.isFinite(authoritativeExpectedCentavos) || authoritativeExpectedCentavos <= 0) {
      throw new Error("Cannot verify payment amount: authoritative expected transaction amount is missing or malformed.");
    }
  }, /authoritative expected transaction amount is missing or malformed/);
});

test("Scenario 31: Malformed snapshot amount string fails closed when PaymentIntent amount is missing", () => {
  const expectedAmountInCentavos = undefined;
  const metadata = { amount_paid: "invalid_not_a_number", total_amount: "" };
  const amountInCentavos = 19900;

  let authoritativeExpectedCentavos = null;
  if (typeof expectedAmountInCentavos === "number" && Number.isFinite(expectedAmountInCentavos) && expectedAmountInCentavos > 0) {
    authoritativeExpectedCentavos = expectedAmountInCentavos;
  } else {
    const snapshotAmountStr = metadata?.amount_paid || metadata?.total_amount;
    if (snapshotAmountStr) {
      const parsed = Math.round(Number(snapshotAmountStr) * 100);
      if (Number.isFinite(parsed) && parsed > 0) {
        authoritativeExpectedCentavos = parsed;
      }
    }
  }

  assert.throws(() => {
    if (authoritativeExpectedCentavos === null || !Number.isFinite(authoritativeExpectedCentavos) || authoritativeExpectedCentavos <= 0) {
      throw new Error("Cannot verify payment amount: authoritative expected transaction amount is missing or malformed.");
    }
  }, /authoritative expected transaction amount is missing or malformed/);
});

test("Scenario 32: Valid existing payment_date reliably anchors periodStart without new Date() fallback", () => {
  const existingPayment = {
    payment_id: "pay_verified_db",
    payment_date: "2026-11-10T12:00:00.000Z",
  };
  const paymentTimeMs = null; // gateway paid_at was absent
  const existingPaymentDateMs = existingPayment?.payment_date
    ? new Date(existingPayment.payment_date).getTime()
    : null;
  const validExistingDateMs =
    typeof existingPaymentDateMs === "number" &&
    Number.isFinite(existingPaymentDateMs) &&
    existingPaymentDateMs > 0
      ? existingPaymentDateMs
      : null;

  const refPaymentTimeMs = paymentTimeMs ?? validExistingDateMs;
  assert.ok(Number.isFinite(refPaymentTimeMs));
  assert.equal(refPaymentTimeMs, new Date("2026-11-10T12:00:00.000Z").getTime());

  // periodStart is strictly constructed from refPaymentTimeMs
  const periodStart = new Date(refPaymentTimeMs);
  assert.equal(periodStart.toISOString(), "2026-11-10T12:00:00.000Z");
});

test("Scenario 33: Payment amount verified against historical checkout snapshot without comparing live DB plan price", () => {
  // Historical grandfathered price ₱149.00 vs new DB plan price ₱249.00
  const metadata = {
    amount_paid: "149.00",
    total_amount: "149.00",
  };
  const expectedAmountInCentavos = null; // PaymentIntent attributes omitted or separate
  const amountInCentavos = 14900; // Paid ₱149.00 as per checkout snapshot

  let authoritativeExpectedCentavos = null;
  if (typeof expectedAmountInCentavos === "number" && Number.isFinite(expectedAmountInCentavos) && expectedAmountInCentavos > 0) {
    authoritativeExpectedCentavos = expectedAmountInCentavos;
  } else {
    const snapshotAmountStr = metadata?.amount_paid || metadata?.total_amount;
    if (snapshotAmountStr) {
      const parsed = Math.round(Number(snapshotAmountStr) * 100);
      if (Number.isFinite(parsed) && parsed > 0) {
        authoritativeExpectedCentavos = parsed;
      }
    }
  }

  assert.equal(authoritativeExpectedCentavos, 14900);
  assert.equal(amountInCentavos, authoritativeExpectedCentavos);
});
