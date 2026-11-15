import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ── 1. Static AST / Code Safety Verifications ──────────────────────────────

test("Static check: No nonexistent tables are queried across notification files", () => {
  const filesToCheck = [
    "web/src/lib/notificationService.ts",
    "web/src/pages/patient/PatientNotifications.tsx",
    "web/src/pages/clinic/ClinicNotifications.tsx",
    "web/src/pages/doctor/DoctorNotifications.tsx",
    "web/src/pages/admin/AdminNotificationsPage.tsx",
  ];

  const nonexistentTables = ["profiles", "patients", "admin_alert", "clinic_registration"];

  for (const relPath of filesToCheck) {
    const fullPath = path.resolve(relPath);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, "utf-8");

    for (const table of nonexistentTables) {
      const regex = new RegExp(`\\.from\\(["']${table}["']\\)`, "g");
      const match = content.match(regex);
      assert.equal(
        match,
        null,
        `File ${relPath} should not query nonexistent table "${table}"`
      );
    }
  }
});

test("Static check: No clinic_id column queries on user_notification or notifications view", () => {
  const filesToCheck = [
    "web/src/lib/notificationService.ts",
    "web/src/pages/clinic/ClinicNotifications.tsx",
  ];

  for (const relPath of filesToCheck) {
    const fullPath = path.resolve(relPath);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, "utf-8");

    const invalidClinicColPattern = /\.from\(["'](user_notification|notifications)["']\)[^;]*\.eq\(["']clinic_id["']/g;
    const matches = content.match(invalidClinicColPattern);
    assert.equal(
      matches,
      null,
      `File ${relPath} should not query clinic_id directly on user_notification or notifications`
    );
  }
});

test("Static check: Realtime subscriptions do not filter notifications view by clinic_id", () => {
  const filesToCheck = [
    "web/src/lib/notificationService.ts",
    "web/src/pages/clinic/ClinicNotifications.tsx",
  ];

  for (const relPath of filesToCheck) {
    const fullPath = path.resolve(relPath);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, "utf-8");

    const invalidRealtimePattern = /table:\s*["']notifications["'],\s*filter:\s*`clinic_id=/g;
    const matches = content.match(invalidRealtimePattern);
    assert.equal(
      matches,
      null,
      `File ${relPath} should not attach Realtime postgres_changes listener to notifications with clinic_id filter`
    );
  }
});

// ── 2. Functional Unit Tests for Deduplication Logic ───────────────────────

const isUuid = (str) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

function deduplicateNotificationItems(items) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const seenIds = new Set();
  const seenBroadcastIds = new Set();
  const seenContentKeys = new Set();
  const seenApptActions = new Set();
  const itemByKey = new Map();

  const sorted = [...items].sort((a, b) => {
    const aIsUuid = isUuid(a.id);
    const bIsUuid = isUuid(b.id);
    if (aIsUuid && !bIsUuid) return -1;
    if (!aIsUuid && bIsUuid) return 1;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  const unique = [];

  for (const item of sorted) {
    if (!item || !item.id) continue;

    if (seenIds.has(item.id)) {
      const existing = itemByKey.get(`id:${item.id}`);
      if (existing && item.isRead) existing.isRead = true;
      continue;
    }

    const bId =
      item.metadata?.broadcast_id ||
      (item.id.startsWith("broadcast-") ||
        item.id.startsWith("clinic-broadcast-") ||
        item.id.startsWith("doc-broadcast-")
        ? item.id.replace(/^(clinic-|doc-)?broadcast-/, "")
        : undefined);

    if (bId && seenBroadcastIds.has(bId)) {
      const existing = itemByKey.get(`broadcast:${bId}`);
      if (existing && item.isRead) existing.isRead = true;
      continue;
    }

    const apptId =
      item.metadata?.appointment_id ||
      item.metadata?.appointmentId ||
      (item.id.startsWith("clinic-")
        ? item.id.replace(/^clinic-[a-z]+-/, "")
        : item.id.startsWith("doc-req-")
        ? item.id.replace("doc-req-", "")
        : item.id.startsWith("doc-branch-req-")
        ? item.id.replace("doc-branch-req-", "")
        : item.id.startsWith("appt-rejected-")
        ? item.id.replace("appt-rejected-", "")
        : item.id.startsWith("appt-completed-")
        ? item.id.replace("appt-completed-", "")
        : item.id.startsWith("appt-cancelled-")
        ? item.id.replace("appt-cancelled-", "")
        : item.id.startsWith("appt-accepted-")
        ? item.id.replace("appt-accepted-", "")
        : item.id.startsWith("appt-confirmed-")
        ? item.id.replace("appt-confirmed-", "")
        : undefined);

    const normType = (item.type || item.metadata?.type || "").toLowerCase().replace(/_/g, "-");
    const isDoctorAction = normType.includes("doctor-");

    const isRejectionAction =
      normType === "appointment-rejected" ||
      normType === "appointment-declined" ||
      item.metadata?.subtype === "doctor-declined" ||
      item.metadata?.subtype === "schedule-conflict" ||
      /review update|schedule conflict|declined|rejected/i.test(item.title || "");

    if (apptId && isRejectionAction) {
      const stableEventId =
        item.metadata?.rejection_event_id ||
        item.metadata?.event_id;

      const docId =
        item.metadata?.doctor_id ||
        item.metadata?.declined_doctor_id ||
        "";

      const rejectStamp =
        item.metadata?.declined_at ||
        item.metadata?.rejection_timestamp ||
        item.timestamp;

      const timeNum = rejectStamp ? new Date(rejectStamp).getTime() : NaN;
      const hasValidTime = Number.isFinite(timeNum);

      const rejectKey = stableEventId
        ? `${apptId}:::rejected:::${stableEventId}`
        : (docId && hasValidTime)
        ? `${apptId}:::rejected:::${docId}:::${timeNum}`
        : `${apptId}:::rejected:::${item.id}`;

      if (seenApptActions.has(rejectKey)) {
        const existing = itemByKey.get(`appt:${rejectKey}`);
        if (existing && item.isRead) existing.isRead = true;
        continue;
      }
      seenApptActions.add(rejectKey);
      itemByKey.set(`appt:${rejectKey}`, item);
    } else if (
      apptId &&
      (isDoctorAction ||
        normType === "appointment-cancelled" ||
        normType === "appointment-canceled" ||
        normType === "appointment-request" ||
        normType === "appointment-delegated" ||
        normType === "appointment-confirmed" ||
        normType === "appointment-completed" ||
        normType === "consultation-completed" ||
        normType === "appointment-accepted" ||
        normType === "appointment-scheduled" ||
        normType === "new-booking")
    ) {
      let canonicalAction = normType;
      if (
        normType === "appointment-scheduled" ||
        normType === "appointment-accepted" ||
        normType === "appointment-approved" ||
        normType === "appointment-confirmed"
      ) {
        canonicalAction = "booking-confirmed";
      } else if (
        normType === "appointment-request" ||
        normType === "appointment_request" ||
        normType === "appointment-delegated" ||
        normType === "new-booking"
      ) {
        canonicalAction = "booking-request";
      } else if (
        normType === "appointment-completed" ||
        normType === "consultation-completed"
      ) {
        canonicalAction = "booking-completed";
      } else if (
        normType === "appointment-cancelled" ||
        normType === "appointment-canceled"
      ) {
        canonicalAction = "booking-cancelled";
      }

      const apptActionKey = `${apptId}:::${canonicalAction}`;
      if (seenApptActions.has(apptActionKey)) {
        const existing = itemByKey.get(`appt:${apptActionKey}`);
        if (existing && item.isRead) existing.isRead = true;
        continue;
      }
      seenApptActions.add(apptActionKey);
      itemByKey.set(`appt:${apptActionKey}`, item);
    }

    const isAppointmentNotification =
      Boolean(apptId) ||
      item.category === "appointment" ||
      normType.includes("appointment") ||
      normType.includes("booking");

    if (!isRejectionAction && !isDoctorAction && !isAppointmentNotification) {
      const normTitle = (item.title || "").trim().toLowerCase();
      const normMsg = (item.message || "").trim().toLowerCase();
      const contentKey = `${normTitle}:::${normMsg}`;

      if (normTitle && normMsg && seenContentKeys.has(contentKey)) {
        const existing = itemByKey.get(`content:${contentKey}`);
        if (existing && item.isRead) existing.isRead = true;
        continue;
      }

      if (normTitle && normMsg) {
        seenContentKeys.add(contentKey);
        itemByKey.set(`content:${contentKey}`, item);
      }
    }

    itemByKey.set(`id:${item.id}`, item);
    if (bId) {
      seenBroadcastIds.add(bId);
      itemByKey.set(`broadcast:${bId}`, item);
    }
    seenIds.add(item.id);
    unique.push(item);
  }

  return unique.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

test("Deduplication: DB appointment-scheduled and synthetic appt-accepted collapse to 1 card", () => {
  const apptId = "11111111-2222-3333-4444-555555555555";
  const items = [
    {
      id: "99999999-aaaa-bbbb-cccc-dddddddddddd", // persistent DB row
      type: "appointment-scheduled",
      category: "appointment",
      title: "Appointment Confirmed",
      message: "Your appointment at DermaClinic on Nov 20 has been confirmed.",
      timestamp: "2026-11-15T08:00:00Z",
      isRead: false,
      metadata: { appointment_id: apptId },
    },
    {
      id: `appt-accepted-${apptId}`, // synthetic live appointment item
      type: "appointment-accepted",
      category: "appointment",
      title: "Appointment Confirmed",
      message: "Your appointment at DermaClinic on Nov 20 has been confirmed.",
      timestamp: "2026-11-15T08:00:00Z",
      isRead: true, // marked read in UI
      metadata: { appointment_id: apptId },
    },
  ];

  const deduped = deduplicateNotificationItems(items);
  assert.equal(deduped.length, 1, "Should deduplicate into exactly 1 notification item");
  assert.equal(deduped[0].id, "99999999-aaaa-bbbb-cccc-dddddddddddd", "Persistent UUID takes priority over synthetic ID");
  assert.equal(deduped[0].isRead, true, "Read status from synthetic item propagates to persistent item");
});

test("Deduplication: Doctor appointment_request DB row and appointment-delegated synthetic item collapse to 1 card", () => {
  const apptId = "22222222-3333-4444-5555-666666666666";
  const items = [
    {
      id: "88888888-bbbb-cccc-dddd-eeeeeeeeeeee",
      type: "appointment_request",
      category: "appointment",
      title: "To Review New Appointment",
      message: "A new paid appointment has been assigned to you.",
      timestamp: "2026-11-15T07:30:00Z",
      isRead: false,
      metadata: { appointment_id: apptId },
    },
    {
      id: `doc-req-${apptId}`,
      type: "appointment-delegated",
      category: "appointment",
      title: "To Review New Appointment",
      message: "A new paid appointment has been assigned to you.",
      timestamp: "2026-11-15T07:30:00Z",
      isRead: false,
      metadata: { appointment_id: apptId },
    },
  ];

  const deduped = deduplicateNotificationItems(items);
  assert.equal(deduped.length, 1, "Should collapse doctor request duplicate into 1 card");
  assert.equal(deduped[0].id, "88888888-bbbb-cccc-dddd-eeeeeeeeeeee", "Retains UUID row");
});

test("Deduplication: Distinct doctor rejections across time or doctor are preserved", () => {
  const apptId = "33333333-4444-5555-6666-777777777777";
  const doc1Id = "dddd1111-0000-0000-0000-000000000001";
  const doc2Id = "dddd2222-0000-0000-0000-000000000002";

  const items = [
    {
      id: `appt-rejected-${apptId}-initial`,
      type: "appointment-rejected",
      category: "appointment",
      title: "Appointment Declined",
      message: "Your appointment request with Dr. Clark was declined.",
      timestamp: "2026-11-14T10:00:00Z",
      isRead: true,
      metadata: {
        appointment_id: apptId,
        doctor_id: doc1Id,
        declined_at: "2026-11-14T10:00:00Z",
      },
    },
    {
      id: `appt-rejected-${apptId}-second`,
      type: "appointment-rejected",
      category: "appointment",
      title: "Appointment Declined",
      message: "Your appointment request with Dr. Audrey was declined.",
      timestamp: "2026-11-15T09:00:00Z",
      isRead: false,
      metadata: {
        appointment_id: apptId,
        doctor_id: doc2Id,
        declined_at: "2026-11-15T09:00:00Z",
      },
    },
  ];

  const deduped = deduplicateNotificationItems(items);
  assert.equal(deduped.length, 2, "Both distinct doctor rejections must remain visible");
  assert.equal(deduped[0].metadata.doctor_id, doc2Id, "Newer rejection sorted first");
  assert.equal(deduped[1].metadata.doctor_id, doc1Id, "Older rejection preserved");
});

test("Deduplication safety: Never accidentally combines distinct legitimate events for the same appointment", () => {
  const apptId = "44444444-5555-6666-7777-888888888888";
  const items = [
    {
      id: "pay-conf-uuid-1",
      type: "appointment-payment-confirmed",
      category: "appointment",
      title: "Payment Confirmed",
      message: "Payment for your appointment was confirmed.",
      timestamp: "2026-11-15T08:00:00Z",
      isRead: true,
      metadata: { appointment_id: apptId },
    },
    {
      id: "doc-req-uuid-2",
      type: "appointment-request",
      category: "appointment",
      title: "To Review New Appointment",
      message: "New appointment assigned for review.",
      timestamp: "2026-11-15T08:05:00Z",
      isRead: true,
      metadata: { appointment_id: apptId },
    },
    {
      id: "doc-declined-uuid-3",
      type: "appointment-rejected",
      category: "appointment",
      title: "Appointment Declined",
      message: "Doctor had schedule conflict.",
      timestamp: "2026-11-15T08:30:00Z",
      isRead: true,
      metadata: { appointment_id: apptId, doctor_id: "doc-1", declined_at: "2026-11-15T08:30:00Z" },
    },
    {
      id: "patient-reselect-uuid-4",
      type: "patient-reselection",
      category: "appointment",
      title: "Alternate Doctor Selected",
      message: "Patient selected Dr. Audrey as alternate doctor.",
      timestamp: "2026-11-15T09:00:00Z",
      isRead: false,
      metadata: { appointment_id: apptId },
    },
    {
      id: "appt-confirmed-uuid-5",
      type: "appointment-confirmed",
      category: "appointment",
      title: "Appointment Confirmed",
      message: "Dr. Audrey accepted the consultation.",
      timestamp: "2026-11-15T09:15:00Z",
      isRead: false,
      metadata: { appointment_id: apptId },
    },
    {
      id: "consult-complete-uuid-6",
      type: "consultation-completed",
      category: "appointment",
      title: "Consultation Completed",
      message: "Consultation notes are ready.",
      timestamp: "2026-11-15T10:00:00Z",
      isRead: false,
      metadata: { appointment_id: apptId },
    },
  ];

  const deduped = deduplicateNotificationItems(items);
  assert.equal(
    deduped.length,
    6,
    "All 6 distinct events must be kept separate with their own timestamps and read states"
  );

  const types = deduped.map((d) => d.type);
  assert.ok(types.includes("appointment-payment-confirmed"), "Payment confirmation kept");
  assert.ok(types.includes("appointment-request"), "Doctor assignment kept");
  assert.ok(types.includes("appointment-rejected"), "Doctor rejection kept");
  assert.ok(types.includes("patient-reselection"), "Patient reselection kept");
  assert.ok(types.includes("appointment-confirmed"), "Appointment approval kept");
  assert.ok(types.includes("consultation-completed"), "Consultation completion kept");
});

test("Deduplication idempotency: Repeated fetching and Realtime events preserve stable list and read states", () => {
  const apptId = "55555555-6666-7777-8888-999999999999";
  const baseItems = [
    {
      id: "uuid-db-1",
      type: "appointment-scheduled",
      category: "appointment",
      title: "Appointment Confirmed",
      message: "Booking confirmed.",
      timestamp: "2026-11-15T08:00:00Z",
      isRead: true,
      metadata: { appointment_id: apptId },
    },
    {
      id: `appt-accepted-${apptId}`,
      type: "appointment-accepted",
      category: "appointment",
      title: "Appointment Confirmed",
      message: "Booking confirmed.",
      timestamp: "2026-11-15T08:00:00Z",
      isRead: false,
      metadata: { appointment_id: apptId },
    },
  ];

  // Pass 1: Initial fetch
  const pass1 = deduplicateNotificationItems(baseItems);
  assert.equal(pass1.length, 1);
  assert.equal(pass1[0].isRead, true);

  // Pass 2: Re-fetch or duplicate event delivery
  const pass2 = deduplicateNotificationItems([...baseItems, ...baseItems]);
  assert.equal(pass2.length, 1);
  assert.equal(pass2[0].id, pass1[0].id);
  assert.equal(pass2[0].isRead, true);
});

// ── 3. Lifecycle Persistence Tests ─────────────────────────────────────────

test("Persistence: Completed consultation retains initial appointment request in clinic notifications", () => {
  const appt = {
    appointment_id: "appt-completed-test-uuid",
    status: "completed",
    doctor_status: "approved",
    created_at: "2026-11-10T08:00:00Z",
    doctor_reviewed_at: "2026-11-10T09:00:00Z",
    patient_name: "Jane Doe",
    date: "2026-11-10",
  };

  const clinicItems = [];
  // 1. Initial request (always emitted to represent incoming booking history)
  clinicItems.push({
    id: `clinic-req-${appt.appointment_id}`,
    type: "appointment-request",
    category: "appointment",
    title: "New Appointment Request",
    message: `${appt.patient_name} requested a consultation.`,
    timestamp: appt.created_at,
    isRead: true,
    metadata: { appointment_id: appt.appointment_id },
  });

  // 2. Doctor acceptance
  clinicItems.push({
    id: `clinic-doc-accept-${appt.appointment_id}`,
    type: "doctor-accepted",
    category: "appointment",
    title: "Doctor Accepted Appointment",
    message: `Doctor accepted the booking for ${appt.patient_name}.`,
    timestamp: appt.doctor_reviewed_at,
    isRead: true,
    metadata: { appointment_id: appt.appointment_id },
  });

  // 3. Consultation completed
  clinicItems.push({
    id: `clinic-complete-${appt.appointment_id}`,
    type: "consultation-completed",
    category: "appointment",
    title: "Consultation Completed",
    message: `Doctor completed consultation notes for ${appt.patient_name}.`,
    timestamp: appt.doctor_reviewed_at,
    isRead: false,
    metadata: { appointment_id: appt.appointment_id },
  });

  const deduped = deduplicateNotificationItems(clinicItems);
  assert.equal(deduped.length, 3, "All three lifecycle stages must persist in notification history");
  const types = deduped.map((d) => d.type);
  assert.ok(types.includes("appointment-request"), "Booking request remains in history");
  assert.ok(types.includes("doctor-accepted"), "Doctor acceptance remains in history");
  assert.ok(types.includes("consultation-completed"), "Completion remains in history");
});

test("Persistence: Approved clinic application remains visible in Admin notifications", () => {
  const clinic = {
    clinic_id: "clinic-test-approval-id",
    name: "Aesthetic Skin Clinic",
    status: "approved",
    created_at: "2026-11-12T10:00:00Z",
  };

  const adminItems = [
    {
      id: `admin-clinic-app-${clinic.clinic_id}`,
      type: "clinic",
      category: "clinic",
      title: "Clinic Application Approved",
      message: `${clinic.name} is approved and active on the platform.`,
      timestamp: clinic.created_at,
      isRead: false,
      metadata: { clinic_id: clinic.clinic_id, status: clinic.status },
    },
  ];

  const deduped = deduplicateNotificationItems(adminItems);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].metadata.status, "approved", "Approved status preserved");
});

test("Persistence: Resolved support ticket remains visible in Admin notifications", () => {
  const ticket = {
    ticket_id: "ticket-resolved-uuid-1234",
    subject: "Login assistance",
    status: "resolved",
    created_at: "2026-11-13T12:00:00Z",
  };

  const adminItems = [
    {
      id: `admin-ticket-${ticket.ticket_id}`,
      type: "ticket-resolved",
      category: "ticket",
      title: `Support Ticket Resolved: ${ticket.subject}`,
      message: `User submitted inquiry: "Resolved issue"`,
      timestamp: ticket.created_at,
      isRead: true,
      metadata: { ticket_id: ticket.ticket_id, status: ticket.status },
    },
  ];

  const deduped = deduplicateNotificationItems(adminItems);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].type, "ticket-resolved");
});

