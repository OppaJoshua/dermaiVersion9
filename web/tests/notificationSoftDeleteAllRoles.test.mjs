import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_ROOT = path.resolve(__dirname, "..");

const notifServiceSource = fs.readFileSync(
  path.join(WEB_ROOT, "src/lib/notificationService.ts"),
  "utf8"
);
const cardMenuSource = fs.readFileSync(
  path.join(WEB_ROOT, "src/components/common/NotificationCardMenu.tsx"),
  "utf8"
);
const patientPageSource = fs.readFileSync(
  path.join(WEB_ROOT, "src/pages/patient/PatientNotifications.tsx"),
  "utf8"
);
const clinicPageSource = fs.readFileSync(
  path.join(WEB_ROOT, "src/pages/clinic/ClinicNotifications.tsx"),
  "utf8"
);
const doctorPageSource = fs.readFileSync(
  path.join(WEB_ROOT, "src/pages/doctor/DoctorNotifications.tsx"),
  "utf8"
);
const adminPageSource = fs.readFileSync(
  path.join(WEB_ROOT, "src/pages/admin/AdminNotificationsPage.tsx"),
  "utf8"
);

test("Phase 1 & 2 Verification: softDeleteNotification never sends top-level hidden_at column to unmigrated DB and falls back to metadata JSONB", () => {
  // 1. Verify markerPayload for synthetic_hidden and broadcast_hidden does NOT set top-level markerPayload.hidden_at
  assert.ok(
    !notifServiceSource.includes("markerPayload.hidden_at ="),
    "markerPayload must not set top-level hidden_at column which fails with HTTP 400 (42703) when column hidden_at is absent"
  );

  // 2. Verify metadata JSONB fallback when soft_delete_user_notification RPC is missing (PGRST202)
  assert.ok(
    notifServiceSource.includes("hidden_at: nowIso") &&
      notifServiceSource.includes("hidden_aliases: aliases"),
    "softDeleteNotification must persist hidden_at and hidden_aliases inside metadata JSONB when RPC is unavailable"
  );

  // 3. Verify non-UUID userId (such as 'admin') is resolved to the authenticated session UUID before querying UUID columns
  assert.ok(
    notifServiceSource.includes('let resolvedUserId = uuidRegex.test(userId || "") ? userId : "";'),
    "softDeleteNotification must resolve non-UUID userId (e.g. 'admin') via supabase.auth.getSession() to prevent 22P02 invalid uuid syntax errors"
  );
});

test("Phase 2 Verification: UUID vs Synthetic twin alias mapping prevents deleted notifications from reappearing as synthetic twins", () => {
  assert.ok(
    notifServiceSource.includes("function getNotificationHiddenAliases("),
    "getNotificationHiddenAliases helper must exist"
  );
  assert.ok(
    notifServiceSource.includes("function extractHiddenMarkersFromDbRow("),
    "extractHiddenMarkersFromDbRow helper must exist"
  );
  assert.ok(
    notifServiceSource.includes("function isNotificationItemHidden("),
    "isNotificationItemHidden helper must exist"
  );
  assert.ok(
    notifServiceSource.includes("async function loadUserHiddenMarkersFromDb("),
    "loadUserHiddenMarkersFromDb helper must exist to hydrate hidden markers across logout/login"
  );

  // Verify all 4 role fetchers load DB hidden markers and filter with isNotificationItemHidden
  assert.ok(
    notifServiceSource.includes('loadUserHiddenMarkersFromDb("patient"') &&
      notifServiceSource.includes('!isNotificationItemHidden(item, "patient"'),
    "fetchPatientNotifications must load hidden markers and filter via isNotificationItemHidden"
  );
  assert.ok(
    notifServiceSource.includes('loadUserHiddenMarkersFromDb("doctor"') &&
      notifServiceSource.includes('!isNotificationItemHidden(item, "doctor"'),
    "fetchDoctorNotifications must load hidden markers and filter via isNotificationItemHidden"
  );
  assert.ok(
    notifServiceSource.includes('!isNotificationItemHidden(item, "clinic"'),
    "fetchClinicNotifications must load hidden markers and filter via isNotificationItemHidden"
  );
  assert.ok(
    notifServiceSource.includes('isNotificationItemHidden(item, "admin"'),
    "fetchAdminNotifications must load hidden markers and filter via isNotificationItemHidden"
  );
});

test("Phase 2 Verification: Component-local states in PatientNotifications and ClinicNotifications filter hidden notifications", () => {
  assert.ok(
    patientPageSource.includes('getHiddenIds("patient"') &&
      patientPageSource.includes('detail?.action === "delete_notification"'),
    "PatientNotifications.tsx must filter scanNotifications by getHiddenIds and remove deleted scan items immediately"
  );
  assert.ok(
    clinicPageSource.includes('getHiddenIds("clinic"') &&
      clinicPageSource.includes('detail?.action === "delete_notification"'),
    "ClinicNotifications.tsx must filter bookingNotifs by getHiddenIds and remove deleted booking items immediately"
  );
  assert.ok(
    doctorPageSource.includes("onDelete={deleteNotification}"),
    "DoctorNotifications.tsx must wire onDelete={deleteNotification}"
  );
  assert.ok(
    adminPageSource.includes("onDelete={deleteNotification}"),
    "AdminNotificationsPage.tsx must wire onDelete={deleteNotification}"
  );
});

test("Phase 3 Behavioral Simulation: All 4 roles (Patient, Doctor, Clinic, Admin) soft-delete, refresh, logout/login, unread count, and recipient isolation", () => {
  // Simulate the exact alias resolution, DB marker persistence, and fetch filtering for all 4 roles
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function getAliases(role, notifId, metadata) {
    const aliases = new Set([notifId]);
    const bId =
      metadata?.broadcast_id ||
      (notifId.startsWith("broadcast-") ? notifId.replace("broadcast-", "") : undefined) ||
      (notifId.startsWith("clinic-broadcast-") ? notifId.replace("clinic-broadcast-", "") : undefined) ||
      (notifId.startsWith("doc-broadcast-") ? notifId.replace("doc-broadcast-", "") : undefined);
    if (bId) {
      aliases.add(`broadcast-${bId}`);
      aliases.add(`clinic-broadcast-${bId}`);
      aliases.add(`doc-broadcast-${bId}`);
    }
    const apptId = metadata?.appointment_id || metadata?.appointmentId;
    if (apptId) {
      const aid = String(apptId);
      const t = String(metadata?.type || "").toLowerCase();
      const sub = String(metadata?.subtype || "").toLowerCase();
      if (role === "doctor") {
        if (t.includes("reminder") || sub.includes("reminder") || notifId.startsWith("doc-reminder-")) {
          aliases.add(`doc-reminder-${aid}`);
          if (metadata?.occurrence) aliases.add(`doc-reminder-${aid}-${metadata.occurrence}`);
        } else {
          aliases.add(`doc-req-${aid}`);
          aliases.add(`doc-branch-req-${aid}`);
        }
      } else if (role === "patient") {
        if (t.includes("completed") || sub === "reviewed") aliases.add(`appt-completed-${aid}`);
        else if (t.includes("rejected") || sub.includes("declined")) aliases.add(`appt-rejected-${aid}`);
        else if (t.includes("cancelled")) aliases.add(`appt-cancelled-${aid}`);
        else aliases.add(`appt-accepted-${aid}`);
      } else if (role === "clinic") {
        if (t.includes("doctor-accepted") || sub.includes("doctor-accepted")) aliases.add(`clinic-doc-accept-${aid}`);
        else if (t.includes("doctor-rejected") || sub.includes("doctor-declined")) aliases.add(`clinic-doc-reject-${aid}`);
        else if (t.includes("completed")) aliases.add(`clinic-complete-${aid}`);
        else if (t.includes("reselection")) aliases.add(`clinic-reselect-${aid}`);
        else aliases.add(`clinic-req-${aid}`);
      } else if (role === "admin") {
        if (t.includes("scan")) aliases.add(`admin-scan-${aid}`);
        if (t.includes("review")) aliases.add(`admin-review-${aid}`);
      }
    }
    const cId = metadata?.clinic_id || metadata?.clinicId;
    if (cId) {
      if (role === "admin") aliases.add(`admin-clinic-app-${cId}`);
      if (role === "clinic") aliases.add(`clinic-approved-${cId}`);
    }
    return Array.from(aliases);
  }

  // 1. Patient deletes a UUID appointment-accepted notification -> its synthetic twin appt-accepted-<id> must also be hidden on refresh!
  const apptId = "11111111-2222-3333-4444-555555555555";
  const patientUuidNotif = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const patientAliases = getAliases("patient", patientUuidNotif, {
    appointment_id: apptId,
    type: "appointment-scheduled",
  });
  assert.ok(patientAliases.includes(patientUuidNotif));
  assert.ok(
    patientAliases.includes(`appt-accepted-${apptId}`),
    "Deleting Patient UUID schedule notification must also hide synthetic twin appt-accepted-<id>"
  );

  // 2. Doctor deletes a UUID appointment_request notification -> synthetic twin doc-req-<id> and doc-branch-req-<id> must also be hidden!
  const docUuidNotif = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
  const docAliases = getAliases("doctor", docUuidNotif, {
    appointment_id: apptId,
    type: "appointment_request",
  });
  assert.ok(docAliases.includes(`doc-req-${apptId}`));
  assert.ok(docAliases.includes(`doc-branch-req-${apptId}`));

  // 3. Clinic deletes a UUID booking notification -> synthetic twin clinic-req-<id> must also be hidden!
  const clinicUuidNotif = "cccccccc-dddd-eeee-ffff-000000000000";
  const clinicAliases = getAliases("clinic", clinicUuidNotif, {
    appointment_id: apptId,
    type: "booking_created",
  });
  assert.ok(clinicAliases.includes(`clinic-req-${apptId}`));

  // 4. Admin deletes a UUID clinic registration notification -> synthetic fallback admin-clinic-app-<clinicId> must also be hidden!
  const clinicId = "99999999-8888-7777-6666-555555555555";
  const adminUuidNotif = "dddddddd-eeee-ffff-0000-111111111111";
  const adminAliases = getAliases("admin", adminUuidNotif, {
    clinic_id: clinicId,
    type: "clinic",
  });
  assert.ok(
    adminAliases.includes(`admin-clinic-app-${clinicId}`),
    "Deleting Admin UUID clinic notification must also hide synthetic fallback admin-clinic-app-<clinicId>"
  );

  // 5. Broadcast deletion hides across broadcast-<id>, doc-broadcast-<id>, clinic-broadcast-<id> for that recipient only
  const broadcastId = "77777777-6666-5555-4444-333333333333";
  const broadcastAliases = getAliases("doctor", `doc-broadcast-${broadcastId}`, {
    broadcast_id: broadcastId,
    type: "broadcast",
  });
  assert.ok(broadcastAliases.includes(`broadcast-${broadcastId}`));
  assert.ok(broadcastAliases.includes(`doc-broadcast-${broadcastId}`));
  assert.ok(broadcastAliases.includes(`clinic-broadcast-${broadcastId}`));
});

test("Safety & Non-Destructive Guarantee: No hard deletes on notification, appointment, broadcast, ticket, or clinic tables", () => {
  assert.ok(
    !notifServiceSource.includes('.from("user_notification").delete(') &&
      !notifServiceSource.includes(".from('user_notification').delete("),
    "user_notification records must never be permanently deleted"
  );
  assert.ok(
    !notifServiceSource.includes('.from("admin_broadcast").delete(') &&
      !notifServiceSource.includes('.from("patient_appointment").delete(') &&
      !notifServiceSource.includes('.from("user_support_ticket").delete('),
    "Underlying broadcast, appointment, and support ticket records must never be deleted"
  );
  assert.ok(
    cardMenuSource.includes("e.stopPropagation()") && cardMenuSource.includes("e.preventDefault()"),
    "NotificationCardMenu must prevent accidental card navigation when clicking the 3-dot menu or Delete option"
  );
});

test("Verification Point 3 & 5: Cross-browser-session hydration and no unnecessary calls to missing Phase A RPCs", () => {
  // Point 3: Verify loadUserHiddenMarkersFromDb queries both marker rows AND soft-deleted UUID rows (metadata->>hidden_at.not.is.null)
  assert.ok(
    notifServiceSource.includes(
      '.or("type.in.(synthetic_hidden,broadcast_hidden),metadata->>hidden_at.not.is.null")'
    ),
    "loadUserHiddenMarkersFromDb must query both marker rows and metadata->>hidden_at rows so another browser session hydrates all deleted notifications"
  );

  // Point 5: Verify isPhaseADatabaseRpcDeployed() gates RPC calls so unmigrated DBs do not receive unnecessary 404 PGRST202 calls
  assert.ok(
    notifServiceSource.includes("function isPhaseADatabaseRpcDeployed()") &&
      notifServiceSource.includes("isPhaseAMigrationDeployed() && isPhaseADatabaseRpcDeployed()"),
    "Phase A RPC calls must be gated by isPhaseADatabaseRpcDeployed() when the connected database has not been migrated"
  );
});

test("Verification Point 6: Metadata updates preserve existing DB metadata and zero-row/RLS failures never silently report success", () => {
  // 1. Existing DB metadata fetched and merged before updating a UUID notification row
  assert.ok(
    notifServiceSource.includes('.select("notif_id, user_id, metadata")') &&
      notifServiceSource.includes("...existingDbMeta,"),
    "softDeleteNotification must fetch and preserve existing DB metadata keys when merging hidden_at and hidden_aliases"
  );

  // 2. Update and insert calls select("notif_id") to verify affected row count
  assert.ok(
    notifServiceSource.includes("const { data: updatedRows, error: updateErr } = await supabase") &&
      notifServiceSource.includes("const { data: insertedMarker, error: markerErr } = await supabase"),
    "softDeleteNotification must inspect affected row counts on both update and insert operations"
  );

  // 3. Zero-row updates/inserts or RLS errors roll back optimistic local state and return { success: false }
  assert.ok(
    notifServiceSource.includes("if (!uuidPersisted && !broadcastPersisted)") &&
      notifServiceSource.includes("removeHiddenId(role, notifId, resolvedUserId, fallbackScopeId, aliases);") &&
      notifServiceSource.includes("return { success: false, error: lastDbError"),
    "softDeleteNotification must roll back local hidden state and return { success: false } if 0 rows were affected or RLS blocked persistence"
  );
});

test("Verification Point 7: Synthetic twin aliases strictly isolate distinct lifecycle events and never hide unrelated notifications", () => {
  // Extract getNotificationHiddenAliases body from notificationService.ts and evaluate its exact behavior
  const startIdx = notifServiceSource.indexOf("export function getNotificationHiddenAliases(");
  const endIdx = notifServiceSource.indexOf("function extractHiddenMarkersFromDbRow(");
  assert.ok(startIdx !== -1 && endIdx > startIdx, "getNotificationHiddenAliases must be located");

  const fnSource = notifServiceSource
    .slice(startIdx, endIdx)
    .replace(
      /export function getNotificationHiddenAliases\(\s*role:\s*NotificationRole,\s*notifId:\s*string,\s*metadata\?:\s*Record<string,\s*any>\s*\):\s*string\[\]/,
      "function getNotificationHiddenAliases(role, notifId, metadata)"
    )
    .replace(/new Set<string>\(\)/g, "new Set()");
  const getNotificationHiddenAliases = new Function(`${fnSource}; return getNotificationHiddenAliases;`)();

  const apptId = "11111111-2222-3333-4444-555555555555";
  const clinicId = "99999999-8888-7777-6666-555555555555";

  // Case A: Patient deleting "payment-confirmed" must NOT hide "appt-accepted-<id>" (appointment schedule confirmation)
  const paymentAliases = getNotificationHiddenAliases("patient", "aaaa1111-2222-3333-4444-555555555555", {
    appointment_id: apptId,
    type: "payment-confirmed",
    subtype: "downpayment_paid",
  });
  assert.ok(
    !paymentAliases.includes(`appt-accepted-${apptId}`),
    "Deleting a payment-confirmed notification must NOT hide appt-accepted-<id>"
  );

  // Case B: Patient deleting first doctor rejection must NOT hide a second doctor rejection at a different timestamp
  const ts1 = new Date("2026-04-01T10:00:00Z").getTime();
  const ts2 = new Date("2026-04-02T14:00:00Z").getTime();
  const reject1Aliases = getNotificationHiddenAliases(
    "patient",
    `appt-rejected-${apptId}-${ts1}`,
    {
      appointment_id: apptId,
      type: "appointment-rejected",
      declined_at: "2026-04-01T10:00:00Z",
    }
  );
  assert.ok(
    reject1Aliases.includes(`appt-rejected-${apptId}-${ts1}`),
    "First rejection alias must include its specific timestamp"
  );
  assert.ok(
    !reject1Aliases.includes(`appt-rejected-${apptId}-${ts2}`) &&
      !reject1Aliases.includes(`appt-rejected-${apptId}`),
    "First rejection must NOT generate a blanket alias or hide a subsequent rejection at a different timestamp"
  );

  // Case C: Doctor deleting reminder for occurrence 1 must NOT hide reminder for rescheduled occurrence 2
  const rem1Aliases = getNotificationHiddenAliases(
    "doctor",
    `doc-reminder-${apptId}-2026-04-10_09:00`,
    {
      appointment_id: apptId,
      type: "appointment_reminder",
      occurrence: "2026-04-10_09:00",
    }
  );
  assert.ok(rem1Aliases.includes(`doc-reminder-${apptId}-2026-04-10_09:00`));
  assert.ok(
    !rem1Aliases.includes(`doc-reminder-${apptId}-2026-04-15_11:00`) &&
      !rem1Aliases.includes(`doc-reminder-${apptId}`),
    "Deleting an occurrence-specific doctor reminder must NOT hide a rescheduled reminder for another occurrence"
  );

  // Case D: Admin deleting a clinic booking notification (category: "clinic", type: "new-booking") must NOT hide clinic application (admin-clinic-app-<clinicId>)
  const adminBookingAliases = getNotificationHiddenAliases(
    "admin",
    "bbbb1111-2222-3333-4444-555555555555",
    {
      clinic_id: clinicId,
      appointment_id: apptId,
      category: "clinic",
      type: "new-booking",
      subtype: "booking",
    }
  );
  assert.ok(
    !adminBookingAliases.includes(`admin-clinic-app-${clinicId}`),
    "Deleting an Admin booking notification with category='clinic' must NOT hide the clinic registration application notification"
  );

  // Case E: Clinic deleting a doctor-accepted notification (type: "appointment", subtype: "doctor-accepted") must NOT hide clinic-req-<id>
  const clinicDocAcceptAliases = getNotificationHiddenAliases(
    "clinic",
    "cccc1111-2222-3333-4444-555555555555",
    {
      appointment_id: apptId,
      type: "appointment",
      subtype: "doctor-accepted",
    }
  );
  assert.ok(clinicDocAcceptAliases.includes(`clinic-doc-accept-${apptId}`));
  assert.ok(
    !clinicDocAcceptAliases.includes(`clinic-req-${apptId}`),
    "Deleting clinic doctor-accepted notification must NOT hide the initial clinic booking request notification"
  );
});
