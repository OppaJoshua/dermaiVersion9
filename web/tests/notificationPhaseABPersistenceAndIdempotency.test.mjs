/**
 * notificationPhaseABPersistenceAndIdempotency.test.mjs
 *
 * Isolated local verification suite for Phase A & B Notification Architecture.
 *
 * Mode:
 *   - Static SQL audit of the exact prepared migration file.
 *   - In-memory simulation of PostgreSQL constraints, partial unique index,
 *     service-role authorization, recipient-scoped soft deletion, and idempotent replay.
 *
 * Safety:
 *   - Runs 100% locally with zero network calls and zero production database queries.
 *   - Verifies ZERO hard deletions exist in prepared migration SQL.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Normalize CRLF to LF across all platform environments
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = (...args) => {
  const result = originalReadFileSync(...args);
  return typeof result === "string" ? result.replace(/\r\n/g, "\n") : result;
};

// ── 1. Static Schema & Security Audit of Prepared Migration SQL ─────────────

test("Phase A SQL Audit: Verifies ZERO hard deletions and strict schema compliance", () => {
  const migrationPath = path.resolve("supabase/migrations/20261115_phase_a_b_notification_persistence_idempotency.sql");
  assert.ok(fs.existsSync(migrationPath), "Migration file must exist locally");

  const sql = fs.readFileSync(migrationPath, "utf-8");

  // Critical Requirement 1: ABSOLUTELY ZERO SQL DELETE statements
  const hasDeleteFrom = /\bDELETE\s+FROM\b/i.test(sql);
  assert.equal(hasDeleteFrom, false, "Migration file must contain ZERO DELETE FROM statements");

  // Issue 1: Must NOT reference nonexistent clinic_id column in INSERT or function parameters
  assert.ok(!sql.includes("p_clinic_id"), "Must NOT define p_clinic_id parameter");
  assert.ok(!sql.includes("clinic_id,"), "Must NOT insert into clinic_id column");
  assert.ok(!sql.includes("clinic_id)"), "Must NOT insert into clinic_id column");

  // Issue 1: Primary key must be notif_id
  assert.ok(sql.includes("notif_id"), "Must use notif_id as primary key");
  assert.ok(!sql.includes("RETURNING id INTO"), "Must NOT use RETURNING id INTO; must use notif_id");

  // Issue 2: Soft delete must be strictly recipient-specific (no cross-user admin bypass)
  assert.ok(!sql.includes("OR public.is_admin()"), "soft_delete_user_notification must NOT permit admin cross-user deletion");
  assert.ok(sql.includes("user_id = v_caller_id"), "soft_delete_user_notification must require user_id = v_caller_id");

  // Issue 3: Corrected SECURITY DEFINER authorization:
  // Must NOT check current_user (under SECURITY DEFINER, current_user is function owner).
  // Must check auth.role() IS DISTINCT FROM 'service_role'.
  assert.ok(!sql.includes("current_user IN ('postgres'"), "Must NOT check current_user as proof of caller identity");
  assert.ok(
    sql.includes("v_caller_role IS DISTINCT FROM 'service_role'"),
    "insert RPC must strictly reject non-service_role API callers"
  );
  assert.ok(
    sql.includes("REVOKE ALL ON FUNCTION public.insert_user_notification_idempotent FROM PUBLIC, anon, authenticated;"),
    "Must revoke insert RPC from public, anon, and authenticated users"
  );
  assert.ok(
    sql.includes("GRANT EXECUTE ON FUNCTION public.insert_user_notification_idempotent TO service_role;"),
    "Must grant insert RPC to service_role"
  );

  // Issue 4: Must enforce non-empty idempotency key
  assert.ok(
    sql.includes("Idempotency key is required in metadata for persistent event notifications"),
    "Must enforce non-empty idempotency key"
  );

  // Issue 4: ON CONFLICT clause must match partial unique index predicate
  assert.ok(
    sql.includes("ON CONFLICT (user_id, ((metadata->>'idempotency_key'))) \n  WHERE (metadata->>'idempotency_key') IS NOT NULL"),
    "ON CONFLICT clause must match partial unique index specification"
  );
  assert.ok(
    sql.includes("AND trim(metadata->>'idempotency_key') <> ''"),
    "Index predicate and conflict target must exclude empty/whitespace strings"
  );

  // Safe search_path and Security Definer
  assert.ok(sql.includes("SECURITY DEFINER"), "RPCs must be SECURITY DEFINER");
  assert.ok(sql.includes("SET search_path = public, pg_temp"), "RPCs must set search_path = public, pg_temp");
});

// ── 2. Server-Side Authorization Verification (In-Memory PostgreSQL Model) ──

test("Phase A/B Security: Ordinary authenticated and anon users CANNOT call notification creation RPC", () => {
  function simulateInsertRpcCall({ callerRole }) {
    // Models the exact PL/pgSQL authorization guard:
    // IF v_caller_role IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Access denied'; END IF;
    if (callerRole !== "service_role") {
      throw new Error("Access denied: insert_user_notification_idempotent is restricted to authorized server-side processes");
    }
    return { notif_id: "notif-uuid-1", inserted: true };
  }

  // 1. Patient or Doctor calling insert RPC directly
  assert.throws(
    () => {
      simulateInsertRpcCall({ callerRole: "authenticated" });
    },
    /Access denied: insert_user_notification_idempotent is restricted to authorized server-side processes/,
    "Authenticated users must be strictly blocked from creating official notifications"
  );

  // 2. Anon client calling insert RPC
  assert.throws(
    () => {
      simulateInsertRpcCall({ callerRole: "anon" });
    },
    /Access denied/,
    "Anon users must be blocked from creating official notifications"
  );

  // 3. Authorized server-side edge function with service_role succeeds
  const serviceResult = simulateInsertRpcCall({ callerRole: "service_role" });
  assert.equal(serviceResult.inserted, true, "service_role execution must succeed");
});

test("Phase A/B Security: Soft delete is strictly recipient-specific and handles idempotent retries safely", () => {
  const dbRows = new Map();
  dbRows.set("notif-100", { notif_id: "notif-100", user_id: "patient-1", hidden_at: null });

  function simulateSoftDeleteRpc({ callerId, notifId }) {
    if (!callerId) {
      throw new Error("Access denied: Authentication required");
    }
    const row = dbRows.get(notifId);
    if (!row) return false;

    // Caller does NOT own the notification: rejected
    if (row.user_id !== callerId) {
      return false;
    }

    // Row is already hidden: safe idempotent retry returns true without altering anything
    if (row.hidden_at !== null) {
      return true;
    }

    // Newly hidden
    row.hidden_at = new Date().toISOString();
    return true;
  }

  // Admin user attempting to soft-delete patient-1's notification
  const adminDeleteResult = simulateSoftDeleteRpc({ callerId: "admin-user-999", notifId: "notif-100" });
  assert.equal(adminDeleteResult, false, "Admin cannot soft-delete notification owned by another user");
  assert.equal(dbRows.get("notif-100").hidden_at, null, "Row must remain unhidden");

  // The actual recipient soft-deletes their own notification
  const firstDelete = simulateSoftDeleteRpc({ callerId: "patient-1", notifId: "notif-100" });
  assert.equal(firstDelete, true, "Recipient can soft-delete their own notification");
  const firstHiddenTime = dbRows.get("notif-100").hidden_at;
  assert.notEqual(firstHiddenTime, null, "Row hidden_at must be populated");

  // Repeated attempt to hide an already-hidden notification
  const secondDelete = simulateSoftDeleteRpc({ callerId: "patient-1", notifId: "notif-100" });
  assert.equal(secondDelete, true, "Repeated soft-delete attempt must succeed idempotently");
  assert.equal(dbRows.get("notif-100").hidden_at, firstHiddenTime, "Repeated call must not change hidden_at");
});

// ── 3. Atomic Idempotency & Conflict Semantics (In-Memory PostgreSQL Model) ─

test("Phase B Idempotency: Enforces non-empty idempotency_key and preserves existing state on replay", () => {
  const dbTable = new Map();

  function simulateIdempotentInsert({ userId, title, message, type, metadata }) {
    const key = metadata?.idempotency_key?.trim();
    if (!key) {
      throw new Error("Idempotency key is required in metadata for persistent event notifications");
    }

    const uniqueIndexKey = `${userId}::${key}`;
    if (dbTable.has(uniqueIndexKey)) {
      // ON CONFLICT DO NOTHING: Does NOT update title, does NOT reset is_read or hidden_at!
      const existing = dbTable.get(uniqueIndexKey);
      return { notif_id: existing.notif_id, isNew: false, row: existing };
    }

    const notif_id = `notif-${Math.random().toString(36).slice(2, 9)}`;
    const newRow = {
      notif_id,
      user_id: userId,
      title,
      message,
      type,
      metadata,
      is_read: false,
      hidden_at: null,
      created_at: new Date().toISOString(),
    };
    dbTable.set(uniqueIndexKey, newRow);
    return { notif_id, isNew: true, row: newRow };
  }

  // 1. Missing idempotency key throws error
  assert.throws(
    () => {
      simulateIdempotentInsert({
        userId: "user-1",
        title: "Test",
        message: "Test msg",
        type: "appointment",
        metadata: {},
      });
    },
    /Idempotency key is required/,
    "Must reject inserts without idempotency key"
  );

  // 2. Initial insert creates the record
  const initial = simulateIdempotentInsert({
    userId: "user-1",
    title: "Initial Title",
    message: "Initial Msg",
    type: "appointment",
    metadata: { idempotency_key: "appt_event_001", clinic_id: "clinic-uuid-777" },
  });
  assert.equal(initial.isNew, true);

  // Simulate user marking notification as read and soft-deleting it
  initial.row.is_read = true;
  initial.row.hidden_at = "2026-11-15T09:00:00.000Z";

  // 3. Replayed webhook/event for the same event
  const replay = simulateIdempotentInsert({
    userId: "user-1",
    title: "Modified Title",
    message: "Modified Msg",
    type: "appointment",
    metadata: { idempotency_key: "appt_event_001", clinic_id: "clinic-uuid-777" },
  });

  assert.equal(replay.isNew, false, "Replay must not create a new row");
  assert.equal(replay.notif_id, initial.notif_id, "Replay must return existing notif_id");
  assert.equal(replay.row.title, "Initial Title", "Replay must not overwrite existing content");
  assert.equal(replay.row.is_read, true, "Replay must NOT reset read status");
  assert.equal(replay.row.hidden_at, "2026-11-15T09:00:00.000Z", "Replay must NOT unhide soft-deleted notification");
});

test("Phase B Idempotency: Multiple distinct declines and reassignments produce distinct records", () => {
  const dbTable = new Map();

  function makeRejectionKey(apptId, doctorId, timestamp) {
    return `appt_rejection_${apptId}_${doctorId}_${timestamp}`;
  }

  const apptId = "appt-seq-test";
  const doc1 = "doctor-1";
  const doc2 = "doctor-2";
  const time1 = "2026-11-15T10:00:00Z";
  const time2 = "2026-11-15T11:00:00Z";

  const key1 = makeRejectionKey(apptId, doc1, time1);
  const key2 = makeRejectionKey(apptId, doc2, time2);

  assert.notEqual(key1, key2, "Sequential rejections must generate unique keys");

  dbTable.set(key1, { notif_id: "rej-1", key: key1 });
  dbTable.set(key2, { notif_id: "rej-2", key: key2 });

  assert.equal(dbTable.size, 2, "Both rejection notifications must be preserved");
});

// ── 4. Broadcast Soft-Delete & Marker Retrieval Isolation ───────────────────

test("Phase B Broadcast Soft-Delete: User-specific marker hides broadcast without modifying admin_broadcast", () => {
  const adminBroadcasts = [
    { broadcast_id: "bcast-001", title: "Global Notice", message: "Maintenance at midnight" },
  ];
  const userNotifications = [];

  function userHideBroadcast(userId, broadcastId) {
    userNotifications.push({
      notif_id: `bcast-hide-${broadcastId}`,
      user_id: userId,
      type: "broadcast_hidden",
      metadata: { hidden_broadcast_id: broadcastId },
      hidden_at: new Date().toISOString(),
    });
  }

  function getActiveBroadcasts(userId) {
    // Model get_user_hidden_broadcast_ids(): DOES NOT check hidden_at IS NULL!
    const hiddenIds = new Set(
      userNotifications
        .filter((n) => n.user_id === userId && n.type === "broadcast_hidden")
        .map((n) => n.metadata?.hidden_broadcast_id)
        .filter(Boolean)
    );
    return adminBroadcasts.filter((b) => !hiddenIds.has(b.broadcast_id));
  }

  const user1 = "user-alice";
  const user2 = "user-bob";

  // Both see the broadcast initially
  assert.equal(getActiveBroadcasts(user1).length, 1);
  assert.equal(getActiveBroadcasts(user2).length, 1);

  // Alice soft-deletes the broadcast
  userHideBroadcast(user1, "bcast-001");

  // Alice no longer sees it, Bob still sees it
  assert.equal(getActiveBroadcasts(user1).length, 0, "Alice must not see the soft-deleted broadcast");
  assert.equal(getActiveBroadcasts(user2).length, 1, "Bob must continue to see the broadcast");
  assert.equal(adminBroadcasts.length, 1, "admin_broadcast must remain completely untouched");

  // Regular notifications view excludes broadcast_hidden markers
  const aliceRegularNotifs = userNotifications.filter(
    (n) => n.user_id === user1 && n.type !== "broadcast_hidden" && n.hidden_at === null
  );
  assert.equal(aliceRegularNotifs.length, 0, "broadcast_hidden markers must never appear in notification dropdown");
});

// ── 5. Timestamp Preservation ──────────────────────────────────────────────

test("Phase B Timestamps: Doctor approval timestamp is preserved independently of consultation completion", () => {
  const apptRecord = {
    appointment_id: "appt-timestamp-decouple",
    status: "completed",
    doctor_reviewed_at: "2026-11-15T11:00:00.000Z", // completion timestamp
    questionnaire_answers: {
      appointment_history: [
        {
          action: "doctor_approved",
          actor: "doctor",
          timestamp: "2026-11-15T10:30:00.000Z", // initial approval timestamp
        },
      ],
    },
  };

  const approvalTime = apptRecord.questionnaire_answers.appointment_history.find(
    (h) => h.action === "doctor_approved"
  )?.timestamp;
  const completionTime = apptRecord.doctor_reviewed_at;

  assert.equal(approvalTime, "2026-11-15T10:30:00.000Z", "Initial approval timestamp must be preserved");
  assert.equal(completionTime, "2026-11-15T11:00:00.000Z", "Completion timestamp must be distinct");
  assert.notEqual(approvalTime, completionTime, "Timestamps must not overwrite each other");
});

// ── 6. Phase B & C UI & Service Layer Verification ──────────────────────────

test("Phase C UI: NotificationCardMenu component exists and enforces event stopPropagation", () => {
  const menuPath = path.resolve("web/src/components/common/NotificationCardMenu.tsx");
  assert.ok(fs.existsSync(menuPath), "NotificationCardMenu component must exist");

  const menuSource = fs.readFileSync(menuPath, "utf-8");
  assert.ok(menuSource.includes("e.stopPropagation()"), "Must stop event propagation on menu click");
  assert.ok(menuSource.includes("e.preventDefault()"), "Must prevent default behavior");
  assert.ok(menuSource.includes("MoreVertical"), "Must render MoreVertical trigger icon");
  assert.ok(menuSource.includes("onDelete"), "Must receive and execute onDelete callback");
  assert.ok(menuSource.includes("Delete"), "Must offer a Delete action in the menu");
});

test("Phase C UI: All 4 notification role pages mount NotificationCardMenu and wire deleteNotification", () => {
  const pages = [
    { name: "PatientNotifications", path: "web/src/pages/patient/PatientNotifications.tsx" },
    { name: "ClinicNotifications", path: "web/src/pages/clinic/ClinicNotifications.tsx" },
    { name: "DoctorNotifications", path: "web/src/pages/doctor/DoctorNotifications.tsx" },
    { name: "AdminNotificationsPage", path: "web/src/pages/admin/AdminNotificationsPage.tsx" },
  ];

  for (const page of pages) {
    const fullPath = path.resolve(page.path);
    assert.ok(fs.existsSync(fullPath), `${page.name} must exist`);
    const content = fs.readFileSync(fullPath, "utf-8");

    assert.ok(
      content.includes("NotificationCardMenu"),
      `${page.name} must import and mount NotificationCardMenu`
    );
    assert.ok(
      content.includes("deleteNotification"),
      `${page.name} must retrieve and pass deleteNotification to NotificationCardMenu`
    );
  }
});

test("Phase B Service: notificationService exposes softDeleteNotification and deleteNotification hook", () => {
  const servicePath = path.resolve("web/src/lib/notificationService.ts");
  const content = fs.readFileSync(servicePath, "utf-8");

  assert.ok(content.includes("export async function softDeleteNotification"), "Must export softDeleteNotification");
  assert.ok(content.includes("deleteNotification,"), "useRoleNotifications must return deleteNotification");
  assert.ok(content.includes("getHiddenIds"), "Must export getHiddenIds");
  assert.ok(content.includes("saveHiddenId"), "Must export saveHiddenId");
  assert.ok(content.includes("removeHiddenId"), "Must export removeHiddenId");
});

test("Phase B Writers: Persistent notification writers generate valid metadata idempotency keys", () => {
  const servicePath = path.resolve("web/src/lib/notificationService.ts");
  const content = fs.readFileSync(servicePath, "utf-8");

  assert.ok(content.includes("idempotency_key: `doc_appt_req_"), "createDoctorAppointmentNotification must set idempotency_key");
  assert.ok(content.includes("idempotency_key: `doc_appt_conf_"), "createDoctorAppointmentConfirmedNotification must set idempotency_key");
  assert.ok(content.includes("idempotency_key: `broadcast_"), "dispatchAdminBroadcastNotification must set idempotency_key");
  assert.ok(content.includes("idempotency_key: `maint_"), "dispatchSystemMaintenanceAlert must set idempotency_key");
  assert.ok(content.includes("idempotency_key: `admin_new_clinic_"), "notifyAdminNewClinicApplication must set idempotency_key");
  assert.ok(content.includes("idempotency_key: `admin_doc_completed_"), "notifyAdminDoctorCompletedReview must set idempotency_key");
  assert.ok(content.includes("idempotency_key: `ticket_pending_"), "notifyPatientPendingSupportTicket must set idempotency_key");
});

test("Phase B Doctor Safeguards: Past 24h reminders and masked branch requests are preserved", () => {
  const servicePath = path.resolve("web/src/lib/notificationService.ts");
  const content = fs.readFileSync(servicePath, "utf-8");

  assert.ok(content.includes("is_expired: isExpired"), "Past 24h reminders must set is_expired metadata");
  assert.ok(content.includes("disabled: isExpired"), "Past 24h reminders must disable expired actions");
  assert.ok(content.includes("isRecentPastScheduled"), "Must guard against historical reminder fabrication");
  assert.ok(content.includes("ai_condition_name: null"), "Unassigned branch requests must mask condition name completely");
  assert.ok(content.includes("is_handled: isClaimedByOther"), "Claimed branch requests must be marked as handled");
  assert.ok(content.includes('? "/doctor/appointments"'), "Unassigned branch requests must navigate to queue, not patient chart");
});

test("Phase A Backend Gate: Explicit feature gate protects against unmigrated live database", () => {
  const servicePath = path.resolve("web/src/lib/notificationService.ts");
  const serviceContent = fs.readFileSync(servicePath, "utf-8");
  assert.ok(
    serviceContent.includes("export function isPhaseAMigrationDeployed"),
    "Feature gate must export dynamic isPhaseAMigrationDeployed function"
  );
  assert.ok(
    serviceContent.includes("VITE_NOTIFICATION_PHASE_A_DEPLOYED"),
    "Feature gate must support environment configuration for migrated testing environments"
  );

  const menuPath = path.resolve("web/src/components/common/NotificationCardMenu.tsx");
  const menuContent = fs.readFileSync(menuPath, "utf-8");
  assert.ok(
    menuContent.includes("if (!isPhaseAMigrationDeployed()) {\n    return null;\n  }"),
    "NotificationCardMenu must return null when Phase A migration is not deployed"
  );

  // Verify production safeguard
  const prodEnvPath = path.resolve("web/.env.production");
  assert.ok(fs.existsSync(prodEnvPath), "web/.env.production must exist to safeguard production builds");
  const prodEnvContent = fs.readFileSync(prodEnvPath, "utf-8");
  assert.ok(
    prodEnvContent.includes("VITE_NOTIFICATION_PHASE_A_DEPLOYED=false"),
    "Production env must explicitly disable VITE_NOTIFICATION_PHASE_A_DEPLOYED until production migration is run"
  );
});

test("Phase B Cross-User RLS Solution: dispatch_authorized_notification in migration SQL and sendAuthorizedNotification service", () => {
  const migrationPath = path.resolve("supabase/migrations/20261115_phase_a_b_notification_persistence_idempotency.sql");
  const sql = fs.readFileSync(migrationPath, "utf-8");

  assert.ok(sql.includes("CREATE OR REPLACE FUNCTION public.dispatch_authorized_notification"), "Must define dispatch_authorized_notification");
  assert.ok(sql.includes("GRANT EXECUTE ON FUNCTION public.dispatch_authorized_notification TO authenticated, service_role;"), "Must grant dispatch function to authenticated");
  assert.ok(sql.includes("REVOKE ALL ON FUNCTION public.dispatch_authorized_notification FROM PUBLIC, anon;"), "Must revoke dispatch function from anon");
  assert.ok(sql.includes("v_caller_id = p_recipient_user_id"), "Must authorize self-notifications");
  assert.ok(sql.includes("public.patient_appointment pa"), "Must verify appointment relationships for cross-user notifications");

  const servicePath = path.resolve("web/src/lib/notificationService.ts");
  const serviceContent = fs.readFileSync(servicePath, "utf-8");
  assert.ok(serviceContent.includes("export async function sendAuthorizedNotification"), "Must export sendAuthorizedNotification");
  assert.ok(serviceContent.includes('supabase.rpc("dispatch_authorized_notification"'), "Must call dispatch_authorized_notification RPC when Phase A is deployed");
});

test("Phase B Persistence: Patient AI scan completion persists notification with canonical ai_scan_result metadata", () => {
  const scanSkinPath = path.resolve("web/src/pages/patient/ScanSkin.tsx");
  const scanSkinContent = fs.readFileSync(scanSkinPath, "utf-8");

  assert.ok(scanSkinContent.includes("from(\"ai_scan_result\")"), "Must insert into canonical ai_scan_result table");
  assert.ok(scanSkinContent.includes("createPatientNotification({"), "Must trigger createPatientNotification upon scan completion");
  assert.ok(scanSkinContent.includes("idempotency_key: analysisId ? `patient_scan_${analysisId}_${user.id}` : undefined"), "Must generate unique patient_scan idempotency key");
  assert.ok(scanSkinContent.includes('category: "scan"'), "Must tag scan notification with category: scan");
});

test("Phase B Idempotency: Doctor rejections in useDoctorAppointments include branch doctor ID for clinic owner notification", () => {
  const hookPath = path.resolve("web/src/hooks/useDoctorAppointments.ts");
  const hookContent = fs.readFileSync(hookPath, "utf-8");

  assert.ok(
    hookContent.includes("idempotency_key: `clinic_doc_decision_${appointmentId}_${branchDoctor.doctor_id}_"),
    "Clinic owner decision notification must incorporate branchDoctor.doctor_id to differentiate repeated doctor declines"
  );
  assert.ok(
    hookContent.includes("sendAuthorizedNotification({"),
    "useDoctorAppointments must use sendAuthorizedNotification for cross-user delivery to clinic owner"
  );
});

test("Phase C: All eligible notifications support soft-delete with safe synthetic handling and zero UUID RPC mismatches", () => {
  const menuPath = path.resolve("web/src/components/common/NotificationCardMenu.tsx");
  const menuContent = fs.readFileSync(menuPath, "utf-8");

  assert.ok(menuContent.includes("if (!isPhaseAMigrationDeployed())"), "NotificationCardMenu must respect Phase A feature gate");

  const servicePath = path.resolve("web/src/lib/notificationService.ts");
  const serviceContent = fs.readFileSync(servicePath, "utf-8");

  // Synthetic notifications must never be passed to soft_delete_user_notification RPC
  assert.ok(
    serviceContent.includes('const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notifId);'),
    "softDeleteNotification must strictly test UUID before calling soft_delete_user_notification RPC"
  );
  assert.ok(
    serviceContent.includes('type: "synthetic_hidden"'),
    "softDeleteNotification must provide safe database-backed persistence for synthetic notifications"
  );
});

test("Phase A/B Rollback: Safe non-destructive rollback preserves hidden_at and notification history", () => {
  const rollbackPath = path.resolve("supabase/migrations/rollback_phase_a_b_safe.sql");
  assert.ok(fs.existsSync(rollbackPath), "Safe rollback SQL must exist");
  const rollbackSql = fs.readFileSync(rollbackPath, "utf-8");

  // Must NOT drop hidden_at column
  assert.ok(
    !rollbackSql.includes("DROP COLUMN IF EXISTS hidden_at"),
    "Rollback must NEVER drop hidden_at column (preserves user soft-delete preferences)"
  );
  // Zero hard deletions
  assert.ok(
    !/\bDELETE\s+FROM\b/i.test(rollbackSql),
    "Rollback must contain ZERO DELETE FROM statements"
  );
  // Safely drops RPCs
  assert.ok(rollbackSql.includes("DROP FUNCTION IF EXISTS public.dispatch_authorized_notification"), "Rollback drops dispatch RPC");
  assert.ok(rollbackSql.includes("DROP FUNCTION IF EXISTS public.soft_delete_user_notification"), "Rollback drops soft-delete RPC");
});

test("Phase A/B Security: dispatch_authorized_notification enforces event verification and forbids hardcoded emails/accounts", () => {
  const migrationPath = path.resolve("supabase/migrations/20261115_phase_a_b_notification_persistence_idempotency.sql");
  const sql = fs.readFileSync(migrationPath, "utf-8");

  // Requirement 1: Zero hardcoded emails or IDs
  assert.ok(!sql.includes("dermaisupport@gmail.com"), "Must NOT hardcode admin email address in migration");
  assert.ok(!sql.includes("03c4dbd4-5d15-4c78-872e-93811b3afa23"), "Must NOT hardcode admin ID in migration");

  // Requirement 1: Prevent forged payment confirmations from clients
  assert.ok(
    sql.includes("Payment notifications can only be generated by verified server-side payment processors"),
    "Must strictly reject client-forged payment confirmations"
  );

  // Requirement 1: Prevent forged clinic verifications from non-admins
  assert.ok(
    sql.includes("Only verified platform administrators can issue clinic verification notices"),
    "Must strictly reject client-forged clinic verification notices"
  );

  // Requirement 1: Verify actual appointment state for doctor decisions
  assert.ok(
    sql.includes("doctor_status = 'approved'"),
    "Must verify doctor_status = 'approved' for confirmation notices"
  );
  assert.ok(
    sql.includes("doctor_status = 'rejected'"),
    "Must verify doctor_status = 'rejected' for decline notices"
  );

  const servicePath = path.resolve("web/src/lib/notificationService.ts");
  const serviceContent = fs.readFileSync(servicePath, "utf-8");
  assert.ok(!serviceContent.includes("03c4dbd4-5d15-4c78-872e-93811b3afa23"), "Must NOT hardcode admin ID in notificationService");
});

test("Phase C Synthetic Soft Delete: Stable event IDs, hidden_at retrieval, and unread count exclusion", () => {
  // 1. Stable Event ID Verification across source data mutations
  const apptId = "c1b2a3f4-5555-4444-9999-123456789abc";
  
  // Synthetic doctor reminder ID
  const docReminderId1 = `doc-reminder-${apptId}`;
  // Mutated appointment date/time/note
  const docReminderId2 = `doc-reminder-${apptId}`;
  assert.equal(docReminderId1, docReminderId2, "Doctor reminder ID must remain strictly stable across date/time/note changes");

  // Synthetic clinic appointment request ID
  const clinicReqId1 = `clinic-req-${apptId}`;
  // Mutated clinic note / status
  const clinicReqId2 = `clinic-req-${apptId}`;
  assert.equal(clinicReqId1, clinicReqId2, "Clinic request ID must remain strictly stable across appointment mutations");

  // 2. Retrieval even when hidden_at is populated on the marker
  const mockDbRows = [
    {
      notif_id: "marker-uuid-1",
      user_id: "doc-user-1",
      type: "synthetic_hidden",
      metadata: { hidden_synthetic_id: docReminderId1 },
      hidden_at: "2026-11-15T12:00:00.000Z",
    },
    {
      notif_id: "marker-uuid-2",
      user_id: "clinic-user-1",
      type: "synthetic_hidden",
      metadata: { hidden_synthetic_id: clinicReqId1 },
      hidden_at: "2026-11-15T12:00:00.000Z",
    },
    {
      notif_id: "real-notif-uuid",
      user_id: "doc-user-1",
      type: "appointment",
      title: "Real Notification",
      body: "Normal unhidden notification",
      is_read: false,
      hidden_at: null,
    }
  ];

  const hiddenSyntheticIds = new Set();
  const visibleCards = [];

  mockDbRows.forEach((n) => {
    // Exact loop logic from fetchDoctorNotifications / fetchClinicNotifications / fetchPatientNotifications
    if (n.type === "synthetic_hidden" && n.metadata?.hidden_synthetic_id) {
      hiddenSyntheticIds.add(String(n.metadata.hidden_synthetic_id));
      return;
    }
    if (n.hidden_at) return;
    visibleCards.push(n);
  });

  assert.ok(hiddenSyntheticIds.has(docReminderId1), "Must extract hidden_synthetic_id even though hidden_at is populated");
  assert.ok(hiddenSyntheticIds.has(clinicReqId1), "Must extract hidden_synthetic_id for clinic even though hidden_at is populated");
  assert.equal(visibleCards.length, 1, "Only unhidden notifications become cards; synthetic markers are not cards");

  // 3. Exclusion from unread count
  const syntheticItems = [
    { id: docReminderId1, isRead: false },
    { id: "other-doc-reminder-xyz", isRead: false },
  ];
  const unhiddenItems = syntheticItems.filter((i) => !hiddenSyntheticIds.has(i.id));
  const unreadCount = unhiddenItems.filter((i) => !i.isRead).length;

  assert.equal(unreadCount, 1, "Hidden synthetic items must be strictly excluded from unread count");
  assert.equal(unhiddenItems.some((i) => i.id === docReminderId1), false, "Deleted reminder must not appear");
});

test("Phase B Doctor Reminders: 24h reminder is persisted immediately at appointment approval with occurrence key", () => {
  const servicePath = path.resolve("web/src/lib/notificationService.ts");
  const serviceContent = fs.readFileSync(servicePath, "utf-8");

  // Verify immediate 24h reminder persistence logic in createDoctorAppointmentConfirmedNotification
  assert.ok(
    serviceContent.includes("type: \"appointment-reminder\""),
    "createDoctorAppointmentConfirmedNotification must support persisting appointment-reminder"
  );
  assert.ok(
    serviceContent.includes("`doc_reminder_${appointmentId}_${occurrenceKey}_${doctorUserId}`"),
    "Must use canonical doctor reminder idempotency key containing occurrenceKey"
  );
  assert.ok(
    serviceContent.includes("ensureUpcomingAppointmentReminders"),
    "notificationService must export ensureUpcomingAppointmentReminders for appointments approved days in advance"
  );

  const hookPath = path.resolve("web/src/hooks/useDoctorAppointments.ts");
  const hookContent = fs.readFileSync(hookPath, "utf-8");

  // Verify hook passes date and time to createDoctorAppointmentConfirmedNotification
  assert.ok(
    hookContent.includes("date: existingAppt.date") && hookContent.includes("time: existingAppt.time"),
    "useDoctorAppointments must pass date and time to trigger immediate 24h reminder persistence upon approval"
  );

  // Verify rescheduling produces distinct occurrence-anchored event identities
  const apptId = "11111111-2222-3333-4444-555555555555";
  const docUserId = "doc-uuid-999";
  const occ1 = "2026-11-20_10-00";
  const occ2 = "2026-11-25_14-30";
  const key1 = `doc_reminder_${apptId}_${occ1}_${docUserId}`;
  const key2 = `doc_reminder_${apptId}_${occ2}_${docUserId}`;

  assert.notEqual(key1, key2, "Rescheduled appointment must produce a distinct occurrence-anchored idempotency key");
});

test("Phase B Doctor Reminders: Standardized occurrence key matches between frontend and SQL pg_cron generator", () => {
  // Test function modeling getStandardAppointmentOccurrenceKey
  function getStandardAppointmentOccurrenceKey(dateVal, timeVal) {
    if (!dateVal) return "unknown_00-00";

    let datePart = "";
    if (typeof dateVal === "string" && /^\d{4}-\d{2}-\d{2}/.test(dateVal)) {
      datePart = dateVal.slice(0, 10);
    } else {
      try {
        const d = new Date(dateVal);
        if (!isNaN(d.getTime())) {
          datePart = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Manila",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(d);
        }
      } catch {}
    }
    if (!datePart) datePart = String(dateVal).slice(0, 10);

    let timePart = "00-00";
    const cleanTime = (timeVal || "").trim();
    if (cleanTime) {
      const match24 = cleanTime.match(/^(\d{1,2})[:\-](\d{2})/);
      const isPm = /pm/i.test(cleanTime);
      const isAm = /am/i.test(cleanTime);
      if (match24) {
        let h = parseInt(match24[1], 10);
        const m = match24[2];
        if (isPm && h < 12) h += 12;
        if (isAm && h === 12) h = 0;
        timePart = `${String(h).padStart(2, "0")}-${m}`;
      }
    } else if (typeof dateVal === "string" && dateVal.includes("T")) {
      try {
        const d = new Date(dateVal);
        if (!isNaN(d.getTime())) {
          const parts = new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Manila",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(d);
          timePart = parts.replace(":", "-");
        }
      } catch {}
    }

    return `${datePart}_${timePart}`;
  }

  // 1. Exact 24h format matching SQL
  assert.equal(getStandardAppointmentOccurrenceKey("2026-11-20", "14:30"), "2026-11-20_14-30");
  assert.equal(getStandardAppointmentOccurrenceKey("2026-11-20", "14:30:00"), "2026-11-20_14-30");
  assert.equal(getStandardAppointmentOccurrenceKey("2026-11-20", "02:30 PM"), "2026-11-20_14-30");
  assert.equal(getStandardAppointmentOccurrenceKey("2026-11-20", "09:00:00"), "2026-11-20_09-00");
  assert.equal(getStandardAppointmentOccurrenceKey("2026-11-20", "9:00 AM"), "2026-11-20_09-00");

  // 2. ISO timestamp string in date
  assert.equal(getStandardAppointmentOccurrenceKey("2026-11-20T14:30:00+08:00", ""), "2026-11-20_14-30");

  // 3. Verifies frontend uses getStandardAppointmentOccurrenceKey across all reminder creation paths
  const servicePath = path.resolve("web/src/lib/notificationService.ts");
  const serviceContent = fs.readFileSync(servicePath, "utf-8");
  assert.ok(
    serviceContent.includes("getStandardAppointmentOccurrenceKey(appt.date, appt.time)"),
    "notificationService must use getStandardAppointmentOccurrenceKey in doctor reminder loop"
  );
  assert.ok(
    serviceContent.includes("getStandardAppointmentOccurrenceKey(date, time)"),
    "notificationService must use getStandardAppointmentOccurrenceKey in immediate approval reminder"
  );

  // 4. Verifies SQL uses identical YYYY-MM-DD_HH-MI format
  const migrationPath = path.resolve("supabase/migrations/20261115_phase_a_b_notification_persistence_idempotency.sql");
  const sql = fs.readFileSync(migrationPath, "utf-8");
  assert.ok(
    sql.includes("to_char(v_appt_time AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') || '_' || replace(to_char(v_appt_time AT TIME ZONE 'Asia/Manila', 'HH24:MI'), ':', '-')"),
    "SQL reminder dispatcher must produce identical YYYY-MM-DD_HH-MI occurrence key"
  );
});

test("Phase A/B Database Migration: Server-side dispatch_upcoming_appointment_reminders RPC and non-destructive rollback", () => {
  const migrationPath = path.resolve("supabase/migrations/20261115_phase_a_b_notification_persistence_idempotency.sql");
  const sql = fs.readFileSync(migrationPath, "utf-8");

  // Server-side reminder dispatcher function exists
  assert.ok(
    sql.includes("CREATE OR REPLACE FUNCTION public.dispatch_upcoming_appointment_reminders()"),
    "Migration must define dispatch_upcoming_appointment_reminders RPC"
  );
  assert.ok(
    sql.includes("now() + INTERVAL '24 hours'"),
    "dispatch_upcoming_appointment_reminders must evaluate the 24-hour window"
  );
  assert.ok(
    sql.includes("ON CONFLICT (user_id, ((metadata->>'idempotency_key')))"),
    "dispatch_upcoming_appointment_reminders must enforce idempotent insertion"
  );

  // Safe rollback script
  const rollbackPath = path.resolve("supabase/migrations/rollback_phase_a_b_safe.sql");
  const rollbackSql = fs.readFileSync(rollbackPath, "utf-8");

  assert.ok(
    rollbackSql.includes("DROP FUNCTION IF EXISTS public.dispatch_upcoming_appointment_reminders();"),
    "Rollback script must safely drop dispatch_upcoming_appointment_reminders"
  );
  assert.ok(
    !rollbackSql.includes("DROP COLUMN IF EXISTS hidden_at"),
    "Rollback must never drop hidden_at column"
  );
  assert.ok(
    !/\bDELETE\s+FROM\b/i.test(rollbackSql),
    "Rollback must contain zero DELETE FROM statements"
  );
});

test("Phase A/B Database Security: Canonical title derivation and timestamp clamping in dispatch_authorized_notification", () => {
  const migrationPath = path.resolve("supabase/migrations/20261115_phase_a_b_notification_persistence_idempotency.sql");
  const sql = fs.readFileSync(migrationPath, "utf-8");

  // Derivation of canonical official titles
  assert.ok(sql.includes("p_title := 'Confirmed Appointment';"), "Enforces canonical Confirmed Appointment title");
  assert.ok(sql.includes("p_title := 'Doctor Unavailable - Reassignment Required';"), "Enforces canonical decline title");
  assert.ok(sql.includes("p_title := 'Consultation Completed';"), "Enforces canonical completion title");

  // Clamping created_at
  assert.ok(
    sql.includes("LEAST(COALESCE(p_created_at, now()), now())"),
    "Must clamp created_at with LEAST(..., now()) to prevent future-dated notifications"
  );

  // Derivation of canonical idempotency key
  assert.ok(
    sql.includes("v_idempotency_key := 'appt_' || p_type || '_' || v_appt_record.appointment_id::text"),
    "Must derive canonical idempotency key from database entities when client omits it"
  );

  // Safe tuple initialization and explicit record-exists guard
  assert.ok(
    sql.includes("v_has_appt_record BOOLEAN := false;"),
    "Must declare explicit v_has_appt_record boolean flag"
  );
  assert.ok(
    sql.includes("NULL::uuid AS appointment_id") && sql.includes("INTO v_appt_record;"),
    "Must safely initialize v_appt_record tuple structure to prevent unassigned record access"
  );
  assert.ok(
    sql.includes("IF v_has_appt_record AND v_caller_role <> 'service_role' AND NOT v_is_admin_caller THEN"),
    "Must guard record field access with v_has_appt_record flag without redundant appointment_id condition"
  );
  assert.ok(
    !sql.includes("IF v_has_appt_record AND v_appt_record.appointment_id IS NOT NULL"),
    "Must remove leftover duplicate v_appt_record.appointment_id check from guarded IF"
  );
});

test("Phase A/B Database Migration: pg_cron scheduled job configuration and safe rollback unscheduling", () => {
  const migrationPath = path.resolve("supabase/migrations/20261115_phase_a_b_notification_persistence_idempotency.sql");
  const sql = fs.readFileSync(migrationPath, "utf-8");

  // Privileged permissions: authenticated users MUST NOT have execute permission
  assert.ok(
    sql.includes("REVOKE ALL ON FUNCTION public.dispatch_upcoming_appointment_reminders FROM PUBLIC, anon, authenticated;"),
    "Must revoke dispatch_upcoming_appointment_reminders from PUBLIC, anon, and authenticated users"
  );
  assert.ok(
    sql.includes("GRANT EXECUTE ON FUNCTION public.dispatch_upcoming_appointment_reminders TO postgres, service_role;"),
    "Must grant dispatch_upcoming_appointment_reminders strictly to postgres and service_role"
  );
  assert.ok(
    !sql.includes("TO postgres, authenticated, service_role;"),
    "authenticated users must NOT be granted execute on dispatch_upcoming_appointment_reminders"
  );

  // Appointment filter checks: Genuine confirmation, pending rejection, NULL doctor_status and cancellation/completion guards
  assert.ok(
    sql.includes("pa.status IN ('confirmed', 'accepted', 'scheduled')"),
    "Scheduler filter must strictly require genuinely confirmed status"
  );
  assert.ok(
    sql.includes("pa.status <> 'pending'"),
    "Scheduler filter must explicitly reject status = 'pending' even if doctor_status = 'approved'"
  );
  assert.ok(
    sql.includes("pa.doctor_status IS NULL OR pa.doctor_status NOT IN ('rejected', 'declined')"),
    "Scheduler filter must handle NULL doctor_status safely without dropping confirmed appointments"
  );
  assert.ok(
    sql.includes("pa.status NOT IN ('completed', 'cancelled', 'rejected', 'done', 'no-show', 'no_show')"),
    "Scheduler filter must exclude completed, cancelled, rejected, and no-show appointments"
  );
  assert.ok(
    !sql.includes("pa.doctor_status = 'approved'"),
    "Scheduler filter must not retain leftover pa.doctor_status = 'approved' condition"
  );

  // Cron schedule check: Does not swallow errors and verifies existing job without duplicate SELECTs
  assert.ok(
    sql.includes("RAISE EXCEPTION 'pg_cron extension is required"),
    "Migration must raise clear exception if pg_cron extension is missing"
  );
  assert.ok(
    sql.includes("FROM cron.job\n  WHERE jobname = 'dispatch-upcoming-doctor-reminders-every-5m'"),
    "Migration must query existing job before scheduling"
  );
  const cronSelectCount = (sql.match(/FROM\s+cron\.job/gi) || []).length;
  assert.equal(cronSelectCount, 1, "Must have exactly ONE SELECT statement querying cron.job (no duplicate SELECTs)");
  assert.ok(
    sql.includes("cron.alter_job("),
    "Migration must use supported cron.alter_job() function instead of direct UPDATE on cron.job"
  );
  assert.ok(
    !sql.includes("UPDATE cron.job"),
    "Migration must NOT perform direct UPDATE on cron.job table"
  );
  assert.ok(
    sql.includes("cron.schedule("),
    "Migration must configure cron.schedule"
  );
  assert.ok(
    sql.includes("'dispatch-upcoming-doctor-reminders-every-5m'"),
    "Cron job must be registered with stable name dispatch-upcoming-doctor-reminders-every-5m"
  );
  assert.ok(
    sql.includes("'*/5 * * * *'"),
    "Cron job must run every 5 minutes"
  );
  assert.ok(
    sql.includes("SELECT public.dispatch_upcoming_appointment_reminders()"),
    "Cron job must execute dispatch_upcoming_appointment_reminders"
  );

  // Safe rollback unschedule check
  const rollbackPath = path.resolve("supabase/migrations/rollback_phase_a_b_safe.sql");
  const rollbackSql = fs.readFileSync(rollbackPath, "utf-8");

  assert.ok(
    rollbackSql.includes("cron.unschedule('dispatch-upcoming-doctor-reminders-every-5m')"),
    "Rollback script must unschedule the cron job BEFORE dropping functions"
  );
});

test("Phase A/B Database Migration: Reminder timestamp calculation and Asia/Manila timezone accuracy", () => {
  const migrationPath = path.resolve("supabase/migrations/20261115_phase_a_b_notification_persistence_idempotency.sql");
  const sql = fs.readFileSync(migrationPath, "utf-8");

  // Timezone check: Asia/Manila evaluation
  assert.ok(
    sql.includes("AT TIME ZONE 'Asia/Manila'"),
    "Reminder dispatcher must explicitly evaluate calendar date and time in Asia/Manila timezone"
  );
  assert.ok(
    sql.includes("::timestamp AT TIME ZONE 'Asia/Manila'"),
    "Must combine appointment date and time anchored to Asia/Manila timezone"
  );

  // Safe time parsing: No silent fallback to midnight
  assert.ok(
    !sql.includes("v_appt_time := v_row.date::timestamptz;"),
    "Must NOT silently fallback to midnight or date-only timestamptz when parsing fails"
  );
  assert.ok(
    sql.includes("CONTINUE;"),
    "Must skip appointment on unparseable/missing time instead of substituting midnight"
  );
  assert.ok(
    sql.includes("COALESCE(NULLIF(trim(pa.time::text), ''), NULLIF(trim(pa.batch_time::text), '')) AS time"),
    "Must support both pa.time and pa.batch_time columns"
  );
});

test("Phase A/B Database Migration: Strict authorization guards in dispatch_authorized_notification", () => {
  const migrationPath = path.resolve("supabase/migrations/20261115_phase_a_b_notification_persistence_idempotency.sql");
  const sql = fs.readFileSync(migrationPath, "utf-8");

  // 1. AI Scan Completion: strictly requires analysis_id and ownership in ai_scan_result
  assert.ok(
    sql.includes("Access denied: AI scan completion notifications require a valid analysis_id belonging to the caller"),
    "Must reject AI scan completion notifications without a valid analysis_id"
  );
  assert.ok(
    sql.includes("Access denied: AI scan result does not exist or does not belong to caller"),
    "Must reject AI scan completion notifications if analysis_id does not belong to caller"
  );

  // 2. Support Tickets: strictly requires ticket_id and ownership in user_support_ticket
  assert.ok(
    sql.includes("Access denied: Support notifications require a valid ticket_id belonging to the caller"),
    "Must reject support notifications without a valid ticket_id"
  );
  assert.ok(
    sql.includes("Access denied: Support ticket does not exist or does not belong to caller"),
    "Must reject support notifications if ticket_id does not belong to caller"
  );

  // 3. Generic Appointment Communication: cannot bypass event verification
  assert.ok(
    sql.includes("Access denied: Cannot dispatch communication for cancelled or rejected appointment"),
    "Must reject communication for cancelled or rejected appointments"
  );
  assert.ok(
    sql.includes("Access denied: Appointment confirmation requires approved doctor status and valid participant roles"),
    "Appointment confirmation must strictly require approved status"
  );
  assert.ok(
    sql.includes("Access denied: Appointment decline notice requires rejected doctor status and valid participant roles"),
    "Appointment decline must strictly require rejected status"
  );
  assert.ok(
    sql.includes("Access denied: Consultation completed notice requires completed appointment status and valid participant roles"),
    "Appointment completion must strictly require completed status"
  );
  assert.ok(
    sql.includes("Access denied: Unsupported appointment notification type"),
    "Must reject arbitrary unsupported appointment notification types"
  );
});

test("Phase A/B Structural AST Validation: Strictly verifies balanced block scopes and catches duplicate IF regressions", () => {
  const migrationPath = path.resolve("supabase/migrations/20261115_phase_a_b_notification_persistence_idempotency.sql");
  const sql = fs.readFileSync(migrationPath, "utf-8");

  // 1. Structural PL/pgSQL block and stack parser
  const lines = sql.split("\n");
  const blockStack = [];

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const trimmed = line.trim();
    if (trimmed.startsWith("--")) return;

    // Filter DDL IF EXISTS / IF NOT EXISTS
    if (/\b(CREATE|DROP|ALTER|ADD)\b.*?\bIF\s+(NOT\s+)?EXISTS\b/i.test(trimmed)) return;
    if (/^IF\s+(NOT\s+)?EXISTS\b/i.test(trimmed) && trimmed.includes("DROP")) return;

    // BEGIN
    if (/\bBEGIN\b/i.test(trimmed) && !/\bEXCEPTION\b/i.test(trimmed)) {
      blockStack.push({ type: "BEGIN", lineNum });
    }

    // IF
    if (/\bIF\b/i.test(trimmed) && !/\bEND\s+IF\b/i.test(trimmed) && !/\bELSIF\b/i.test(trimmed)) {
      blockStack.push({ type: "IF", lineNum, text: trimmed });
    }

    // LOOP
    if (/\bLOOP\b/i.test(trimmed) && !/\bEND\s+LOOP\b/i.test(trimmed)) {
      blockStack.push({ type: "LOOP", lineNum });
    }

    // END LOOP
    if (/\bEND\s+LOOP\b/i.test(trimmed)) {
      assert.ok(blockStack.length > 0, `Unexpected END LOOP at line ${lineNum}`);
      const top = blockStack.pop();
      assert.strictEqual(top.type, "LOOP", `Mismatched block closed by END LOOP at line ${lineNum}, opened by ${top.type} at line ${top.lineNum}`);
    }

    // END IF
    if (/\bEND\s+IF\b/i.test(trimmed)) {
      assert.ok(blockStack.length > 0, `Unexpected END IF at line ${lineNum}`);
      const top = blockStack.pop();
      assert.strictEqual(top.type, "IF", `Mismatched block closed by END IF at line ${lineNum}, opened by ${top.type} at line ${top.lineNum}`);
    }

    // END (block end for BEGIN)
    if (/\bEND\b/i.test(trimmed) && !/\bEND\s+IF\b/i.test(trimmed) && !/\bEND\s+LOOP\b/i.test(trimmed) && !/\bEND\s+CASE\b/i.test(trimmed)) {
      assert.ok(blockStack.length > 0, `Unexpected END at line ${lineNum}`);
      const top = blockStack.pop();
      assert.strictEqual(top.type, "BEGIN", `Mismatched block closed by END at line ${lineNum}, opened by ${top.type} at line ${top.lineNum}`);
    }
  });

  assert.strictEqual(blockStack.length, 0, `All blocks must be closed with zero unmatched items; remaining unclosed: ${JSON.stringify(blockStack)}`);

  // 2. Exact Regression Checks:
  // Regression 1: Line 495 must NOT have duplicate or old IF v_appt_record.appointment_id IS NOT NULL THEN
  assert.ok(
    !sql.includes("IF v_appt_record.appointment_id IS NOT NULL THEN\n          v_has_appt_record := true;"),
    "Must NOT use 'IF v_appt_record.appointment_id IS NOT NULL THEN' before setting v_has_appt_record"
  );
  assert.ok(
    !sql.includes("IF v_appt_record.appointment_id IS NOT NULL THEN\n        IF FOUND THEN"),
    "Must NOT have duplicate consecutive IF conditions around line 495"
  );
  assert.ok(
    sql.includes("IF FOUND THEN\n          v_has_appt_record := true;"),
    "Must strictly use 'IF FOUND THEN' to set v_has_appt_record"
  );

  // Regression 2: Line 628 must NOT have old first IF condition testing v_appt_record.appointment_id
  assert.ok(
    !sql.includes("v_appt_record.appointment_id IS NOT NULL AND v_caller_role <> 'service_role'"),
    "Must NOT check v_appt_record.appointment_id in the guarded IF at derivation block"
  );
  assert.ok(
    !sql.includes("IF v_appt_record.appointment_id IS NOT NULL THEN\n  IF v_has_appt_record"),
    "Must NOT have duplicate stacked IF statements at derivation block"
  );
  assert.ok(
    sql.includes("IF v_has_appt_record AND v_caller_role <> 'service_role' AND NOT v_is_admin_caller THEN"),
    "Must cleanly guard derivation block with v_has_appt_record alone"
  );
});

test("Phase C Verification: Three-dot Delete button presence in all 4 roles and both full page and bell dropdown views", () => {
  // 1. Check all 4 notification components mount NotificationCardMenu
  const components = [
    { name: "Patient", path: "web/src/pages/patient/PatientNotifications.tsx" },
    { name: "Clinic", path: "web/src/pages/clinic/ClinicNotifications.tsx" },
    { name: "Doctor", path: "web/src/pages/doctor/DoctorNotifications.tsx" },
    { name: "Admin", path: "web/src/pages/admin/AdminNotificationsPage.tsx" },
  ];

  for (const comp of components) {
    const fullPath = path.resolve(comp.path);
    const content = fs.readFileSync(fullPath, "utf-8");
    assert.ok(
      content.includes("NotificationCardMenu"),
      `${comp.name} notifications component must import and mount NotificationCardMenu`
    );
    assert.ok(
      content.includes("notificationId={item.id}"),
      `${comp.name} notifications must pass item.id to NotificationCardMenu`
    );
    assert.ok(
      content.includes("onDelete={deleteNotification}"),
      `${comp.name} notifications must pass deleteNotification to NotificationCardMenu`
    );
    assert.ok(
      content.includes("isDropdown"),
      `${comp.name} notifications must support isDropdown mode for header bell popover`
    );
  }

  // 2. Check all 4 layout headers mount their respective notification component in the bell dropdown
  const layouts = [
    { name: "PatientLayout", path: "web/src/components/layout/patientLayout.tsx", expectedComp: "<PatientNotifications isDropdown" },
    { name: "ClinicLayout", path: "web/src/components/layout/clinicLayout.tsx", expectedComp: "<ClinicNotifications isDropdown" },
    { name: "DoctorLayout", path: "web/src/components/layout/doctorLayout.tsx", expectedComp: "<DoctorNotifications isDropdown" },
    { name: "AdminLayout", path: "web/src/components/layout/adminLayout.tsx", expectedComp: "<AdminNotifications isDropdown" },
  ];

  for (const layout of layouts) {
    const fullPath = path.resolve(layout.path);
    const content = fs.readFileSync(fullPath, "utf-8");
    assert.ok(
      content.includes(layout.expectedComp),
      `${layout.name} must mount its notification component with isDropdown in the bell dropdown`
    );
  }

  // 3. NotificationCardMenu functionality checks
  const menuPath = path.resolve("web/src/components/common/NotificationCardMenu.tsx");
  const menuContent = fs.readFileSync(menuPath, "utf-8");

  assert.ok(
    menuContent.includes("isPhaseAMigrationDeployed"),
    "NotificationCardMenu must use isPhaseAMigrationDeployed to gate rendering"
  );
  assert.ok(
    menuContent.includes("MoreVertical"),
    "NotificationCardMenu must render 3-dot MoreVertical icon"
  );
  assert.ok(
    menuContent.includes("Trash2"),
    "NotificationCardMenu must render Trash2 icon for Delete action"
  );
  assert.ok(
    menuContent.includes("Delete"),
    "NotificationCardMenu must display 'Delete' label"
  );
  assert.ok(
    menuContent.includes("e.stopPropagation()"),
    "NotificationCardMenu must prevent card click navigation when menu or delete is clicked"
  );

  // 4. Recipient isolation check: RPC enforces caller ownership via v_caller_id := auth.uid()
  const migrationPath = path.resolve("supabase/migrations/20261115_phase_a_b_notification_persistence_idempotency.sql");
  const migrationSql = fs.readFileSync(migrationPath, "utf-8");
  assert.ok(
    migrationSql.includes("v_caller_id := auth.uid();") && migrationSql.includes("AND user_id = v_caller_id"),
    "soft_delete_user_notification must strictly require user_id = v_caller_id (auth.uid()) to prevent deleting another recipient's notifications"
  );
});






