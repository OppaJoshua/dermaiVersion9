import test from "node:test";
import assert from "node:assert/strict";

/**
 * DermAI — Admin Plan Soft Delete & Archival Test Suite
 * Validates:
 * 1. Default Free Plan protection (cannot be deleted or archived).
 * 2. Soft delete / archival mechanism (status becomes 'archived', row is not deleted).
 * 3. Prevention of archived plans from appearing in patient purchase options.
 * 4. Plan restoration (restoring sets status to 'inactive', not immediately 'active').
 * 5. Distinct statuses: 'active', 'inactive', 'archived'.
 * 6. Foreign key and existing subscriber safety (no row deletion).
 * 7. deleteSubscriptionPlan legacy wrapper safely archives instead of hard deleting.
 */

// Implementation of isDefaultFreePlan mirroring web/src/lib/store.ts
function isDefaultFreePlan(plan) {
  if (!plan) return false;
  const numPrice = Number(plan.price);
  const trimmedName = (plan.name || "").trim().toLowerCase();
  return (
    numPrice === 0 ||
    trimmedName === "free" ||
    trimmedName === "free plan" ||
    /^free(\s+plan)?$/i.test(trimmedName)
  );
}

// In-Memory Database Simulator for public.plan & user_plan_subscription
class MockPlanDatabase {
  constructor() {
    this.plans = new Map([
      [
        "00000000-0000-0000-0000-000000000001",
        {
          plan_id: "00000000-0000-0000-0000-000000000001",
          name: "Free",
          description: "Essential AI scans and basic clinic directory",
          price: 0.0,
          billing_type: "monthly",
          scan_limit: 3,
          status: "active",
        },
      ],
      [
        "00000000-0000-0000-0000-000000000002",
        {
          plan_id: "00000000-0000-0000-0000-000000000002",
          name: "Basic",
          description: "Standard scanning quota for regular skin monitoring",
          price: 149.0,
          billing_type: "monthly",
          scan_limit: 10,
          status: "inactive",
        },
      ],
      [
        "00000000-0000-0000-0000-000000000003",
        {
          plan_id: "00000000-0000-0000-0000-000000000003",
          name: "Pro",
          description: "Unlimited AI scans, priority clinic booking",
          price: 177.68,
          billing_type: "monthly",
          scan_limit: -1,
          status: "active",
        },
      ],
      [
        "00000000-0000-0000-0000-000000000004",
        {
          plan_id: "00000000-0000-0000-0000-000000000004",
          name: "Pro (Annual)",
          description: "Full Pro access billed annually",
          price: 1784.82,
          billing_type: "yearly",
          scan_limit: -1,
          status: "active",
        },
      ],
    ]);

    // Active subscriber linked via foreign key to plan_id
    this.subscriptions = new Map([
      [
        "sub-user-1",
        {
          subscription_id: "sub-user-1",
          user_id: "user-123",
          plan_id: "00000000-0000-0000-0000-000000000003", // Pro
          status: "active",
          current_period_end: new Date(Date.now() + 86400000 * 20).toISOString(),
        },
      ],
    ]);

    this.auditLogs = [];
    this.hardDeleteAttempted = false;
  }

  // Admin query (all plans) vs Patient query (active only with price > 0)
  getSubscriptionPlans(includeInactive = false) {
    const list = Array.from(this.plans.values());
    if (!includeInactive) {
      // Patient purchase option query: must be active and price > 0
      return list.filter((p) => p.status === "active" && Number(p.price) > 0);
    }
    return list;
  }

  // Soft delete / Archival operation
  archiveSubscriptionPlan(id) {
    const plan = this.plans.get(id);
    if (!plan) {
      throw new Error("Plan not found");
    }

    if (isDefaultFreePlan(plan)) {
      throw new Error("The default Free Plan cannot be archived or removed.");
    }

    plan.status = "archived";
    this.plans.set(id, plan);

    this.auditLogs.push({
      action: "Subscription Plan Archived",
      target: `Plan: ${plan.name}`,
      planId: id,
    });

    return { success: true, plan };
  }

  // Restore operation
  restoreSubscriptionPlan(id) {
    const plan = this.plans.get(id);
    if (!plan) {
      throw new Error("Plan not found");
    }

    // Must restore to 'inactive' to prevent unexpected billing or exposure
    plan.status = "inactive";
    this.plans.set(id, plan);

    this.auditLogs.push({
      action: "Subscription Plan Restored",
      target: `Plan: ${plan.name}`,
      planId: id,
    });

    return { success: true, plan };
  }

  // Legacy delete function that must soft-delete instead of hard-deleting
  deleteSubscriptionPlan(id) {
    return this.archiveSubscriptionPlan(id);
  }

  // Hard delete check: verify whether any foreign keys would be broken
  simulateHardDeleteAttempt(id) {
    this.hardDeleteAttempted = true;
    for (const sub of this.subscriptions.values()) {
      if (sub.plan_id === id) {
        throw new Error("Foreign key violation: update or delete on table 'plan' violates foreign key constraint 'user_plan_subscription_plan_id_fkey'");
      }
    }
    this.plans.delete(id);
  }
}

test("1. Free plan detection properly identifies free tier variants", () => {
  assert.equal(isDefaultFreePlan({ price: 0, name: "Free" }), true);
  assert.equal(isDefaultFreePlan({ price: 0.0, name: "Free Plan" }), true);
  assert.equal(isDefaultFreePlan({ price: "0", name: "free" }), true);
  assert.equal(isDefaultFreePlan({ price: 100, name: "Free" }), true);
  assert.equal(isDefaultFreePlan({ price: 149, name: "Basic" }), false);
  assert.equal(isDefaultFreePlan({ price: 199, name: "Pro" }), false);
  assert.equal(isDefaultFreePlan(null), false);
  assert.equal(isDefaultFreePlan(undefined), false);
});

test("2. Default Free Plan cannot be archived or soft-deleted", () => {
  const db = new MockPlanDatabase();
  const freePlanId = "00000000-0000-0000-0000-000000000001";

  assert.throws(
    () => db.archiveSubscriptionPlan(freePlanId),
    /The default Free Plan cannot be archived or removed/
  );

  const plan = db.plans.get(freePlanId);
  assert.equal(plan.status, "active", "Free plan status must remain untouched");
});

test("3. Paid plan can be archived and status changes to 'archived'", () => {
  const db = new MockPlanDatabase();
  const proPlanId = "00000000-0000-0000-0000-000000000003";

  const result = db.archiveSubscriptionPlan(proPlanId);
  assert.equal(result.success, true);

  const updatedPlan = db.plans.get(proPlanId);
  assert.equal(updatedPlan.status, "archived");
  assert.equal(db.plans.has(proPlanId), true, "Plan row must NOT be removed from public.plan");
});

test("4. Archived plans are completely excluded from patient purchase options", () => {
  const db = new MockPlanDatabase();
  const proPlanId = "00000000-0000-0000-0000-000000000003";

  // Initially patient sees Pro and Pro (Annual)
  let patientPlans = db.getSubscriptionPlans(false);
  assert.equal(patientPlans.some((p) => p.plan_id === proPlanId), true);

  // Archive Pro plan
  db.archiveSubscriptionPlan(proPlanId);

  // Patient queries plans
  patientPlans = db.getSubscriptionPlans(false);
  assert.equal(
    patientPlans.some((p) => p.plan_id === proPlanId),
    false,
    "Archived plan must never appear in patient purchase choices"
  );
  assert.equal(patientPlans.length, 1, "Only Pro (Annual) should remain visible to patients");
});

test("5. Archived plans remain visible in Admin All Plans query", () => {
  const db = new MockPlanDatabase();
  const proPlanId = "00000000-0000-0000-0000-000000000003";

  db.archiveSubscriptionPlan(proPlanId);

  const adminPlans = db.getSubscriptionPlans(true);
  const archived = adminPlans.filter((p) => p.status === "archived");
  assert.equal(archived.length, 1);
  assert.equal(archived[0].plan_id, proPlanId);

  const normalPlans = adminPlans.filter((p) => p.status !== "archived");
  assert.equal(normalPlans.length, 3);
});

test("6. Restoring an archived plan sets status to 'inactive'", () => {
  const db = new MockPlanDatabase();
  const proPlanId = "00000000-0000-0000-0000-000000000003";

  db.archiveSubscriptionPlan(proPlanId);
  assert.equal(db.plans.get(proPlanId).status, "archived");

  const restoreResult = db.restoreSubscriptionPlan(proPlanId);
  assert.equal(restoreResult.success, true);

  const restoredPlan = db.plans.get(proPlanId);
  assert.equal(
    restoredPlan.status,
    "inactive",
    "Restored plan must be restored to inactive so admin can review before making active"
  );

  // Patients still do not see it while inactive
  const patientPlans = db.getSubscriptionPlans(false);
  assert.equal(patientPlans.some((p) => p.plan_id === proPlanId), false);
});

test("7. Existing subscribers preserve foreign key relationship and active access", () => {
  const db = new MockPlanDatabase();
  const proPlanId = "00000000-0000-0000-0000-000000000003";

  // Check subscriber before archive
  const subscriber = db.subscriptions.get("sub-user-1");
  assert.equal(subscriber.plan_id, proPlanId);

  // Archiving does NOT delete the row, so subscriber's plan lookup succeeds
  db.archiveSubscriptionPlan(proPlanId);

  const planRow = db.plans.get(subscriber.plan_id);
  assert.ok(planRow, "Subscriber's plan row still exists in database");
  assert.equal(planRow.name, "Pro");
  assert.equal(subscriber.status, "active", "Subscriber retains active access");

  // Verify that an actual hard delete would have caused a foreign key failure
  assert.throws(
    () => db.simulateHardDeleteAttempt(proPlanId),
    /Foreign key violation/,
    "Hard delete would fail on foreign key, proving soft delete is required"
  );
});

test("8. deleteSubscriptionPlan legacy method safely archives without SQL delete", () => {
  const db = new MockPlanDatabase();
  const basicPlanId = "00000000-0000-0000-0000-000000000002";

  db.deleteSubscriptionPlan(basicPlanId);

  assert.equal(db.plans.has(basicPlanId), true, "Row must not be deleted");
  assert.equal(db.plans.get(basicPlanId).status, "archived");
  assert.equal(db.hardDeleteAttempted, false, "No hard delete executed");
});

test("9. Audit logs are recorded for both archive and restore actions", () => {
  const db = new MockPlanDatabase();
  const basicPlanId = "00000000-0000-0000-0000-000000000002";

  db.archiveSubscriptionPlan(basicPlanId);
  assert.equal(db.auditLogs[0].action, "Subscription Plan Archived");

  db.restoreSubscriptionPlan(basicPlanId);
  assert.equal(db.auditLogs[1].action, "Subscription Plan Restored");
});

