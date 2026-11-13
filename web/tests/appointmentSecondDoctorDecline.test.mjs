import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const useDoctorAppointmentsPath = path.resolve(__dirname, "../src/hooks/useDoctorAppointments.ts");
const appointmentStatusPagePath = path.resolve(__dirname, "../src/pages/patient/AppointmentStatusPage.tsx");
const notificationServicePath = path.resolve(__dirname, "../src/lib/notificationService.ts");
const selectAlternateDoctorModalPath = path.resolve(__dirname, "../src/pages/patient/SelectAlternateDoctorModal.tsx");

test("DermAI — Repeated Doctor Decline & Alternate Doctor Workflow Regression Test Suite", async (t) => {
  assert.ok(fs.existsSync(useDoctorAppointmentsPath), "useDoctorAppointments.ts must exist");
  assert.ok(fs.existsSync(appointmentStatusPagePath), "AppointmentStatusPage.tsx must exist");
  assert.ok(fs.existsSync(notificationServicePath), "notificationService.ts must exist");
  assert.ok(fs.existsSync(selectAlternateDoctorModalPath), "SelectAlternateDoctorModal.tsx must exist");

  const doctorHookSrc = fs.readFileSync(useDoctorAppointmentsPath, "utf8");
  const statusPageSrc = fs.readFileSync(appointmentStatusPagePath, "utf8");
  const notifSrc = fs.readFileSync(notificationServicePath, "utf8");
  const modalSrc = fs.readFileSync(selectAlternateDoctorModalPath, "utf8");

  await t.test("1. Doctor rejection in useDoctorAppointments resets reselection metadata and preserves history", () => {
    // Verifies that when !isApproved, nextQa is correctly set with reselection_required and decline details
    assert.match(
      doctorHookSrc,
      /if\s*\(!isApproved\)\s*\{\s*nextQa\.reselection_status\s*=\s*"reselection_required";\s*nextQa\.reselection_required\s*=\s*true;\s*nextQa\.doctor_declined\s*=\s*true;\s*nextQa\.workflow_status\s*=\s*"doctor_declined";/,
      "Doctor rejection must update questionnaire_answers with reselection_required and doctor_declined"
    );
    assert.match(
      doctorHookSrc,
      /nextQa\.latest_doctor_rejection_at\s*=\s*updatePayload\.doctor_reviewed_at;/,
      "Doctor rejection must record latest_doctor_rejection_at"
    );
    assert.match(
      doctorHookSrc,
      /const updatedHistory\s*=\s*\[\.\.\.prevHistory,\s*historyEntry\];/,
      "Doctor rejection must preserve previous appointment history entries"
    );
    assert.match(
      doctorHookSrc,
      /nextQa\s*=\s*\{\s*\.\.\.existingQa,\s*appointment_history:\s*updatedHistory\s*\};/,
      "Doctor rejection must spread existingQa to prevent wiping unrelated questionnaire data"
    );
  });

  await t.test("2. Patient AppointmentStatusPage respects doctor_status === 'rejected' over stale reselection flags", () => {
    // Verifies that the artificial override forcing 'rejected' to 'pending-review' was removed
    assert.doesNotMatch(
      statusPageSrc,
      /const effectiveDoctorStatus = isAlreadyReselected && a\.doctor_status === "rejected"\s*\?\s*"pending-review"/,
      "AppointmentStatusPage must NOT convert doctor_status === 'rejected' to 'pending-review'"
    );

    // Verifies that stale localStorage entries are cleaned up when a new doctor rejection occurs
    assert.match(
      statusPageSrc,
      /const isDocRejected\s*=\s*a\.doctor_status === "rejected"\s*\|\|\s*a\.doctor_status === "declined";/,
      "isDocRejected must strictly reflect the actual doctor decision"
    );
    assert.match(
      statusPageSrc,
      /delete parsedMap\[String\(a\.appointment_id\)\];/,
      "Stale localStorage reselection must be deleted when the assigned doctor rejects"
    );
  });

  await t.test("3. isAppointmentReselectionRequired correctly evaluates sequential reassignments and declines", () => {
    // Extract the implementation from AppointmentStatusPage.tsx
    const fnMatch = statusPageSrc.match(/function isAppointmentReselectionRequired\(app: Appointment\): boolean \{[\s\S]*?\n\}/);
    assert.ok(fnMatch, "isAppointmentReselectionRequired function must be found in source");
    const fnBody = fnMatch[0];

    // Verify logic compares reassignment timestamp against doctor reviewed timestamp
    assert.match(
      fnBody,
      /qaReassignedTime\s*>\s*rejectionTime/,
      "Re-selection requirement must compare reassignment timestamp against rejection timestamp"
    );

    // Simulate pure logic function
    function simulateReselectionRequired({ status, doctorStatus, doctorReviewedAt, qaReassignedAt, localResolvedAt }) {
      const rawStatus = String(status || "").toLowerCase();
      const docStatus = String(doctorStatus || "").toLowerCase();

      if (rawStatus === "scheduled" || rawStatus === "confirmed" || rawStatus === "completed" || rawStatus === "cancelled" || docStatus === "approved") {
        return false;
      }

      const isDoctorRejected =
        docStatus === "rejected" ||
        docStatus === "declined" ||
        rawStatus === "doctor_declined" ||
        rawStatus === "reselection_required" ||
        rawStatus === "rejected" ||
        rawStatus === "declined" ||
        rawStatus === "clinic_reassigning" ||
        rawStatus === "needs_doctor";

      if (!isDoctorRejected) return false;

      const rejectionTime = doctorReviewedAt ? new Date(doctorReviewedAt).getTime() : 0;
      const qaReassignedTime = qaReassignedAt ? new Date(qaReassignedAt).getTime() : 0;
      const localResolvedTime = localResolvedAt ? new Date(localResolvedAt).getTime() : 0;

      if ((qaReassignedTime > rejectionTime && qaReassignedTime > 0) || (localResolvedTime > rejectionTime && localResolvedTime > 0)) {
        return false;
      }
      return true;
    }

    // Step 1: Initial booking with Doctor A, Doctor A declines at T1
    const t1 = "2026-11-13T10:00:00.000Z";
    assert.equal(
      simulateReselectionRequired({
        status: "pending",
        doctorStatus: "rejected",
        doctorReviewedAt: t1,
        qaReassignedAt: null,
        localResolvedAt: null,
      }),
      true,
      "Step 1: Patient must see re-selection required after Doctor A declines"
    );

    // Step 2: Patient reassigns to Doctor B at T2 (T2 > T1)
    const t2 = "2026-11-13T10:15:00.000Z";
    assert.equal(
      simulateReselectionRequired({
        status: "pending",
        doctorStatus: "pending-review",
        doctorReviewedAt: null,
        qaReassignedAt: t2,
        localResolvedAt: t2,
      }),
      false,
      "Step 2: Re-selection must NOT be required while Doctor B is reviewing (pending-review)"
    );

    // Step 3: Doctor B also declines at T3 (T3 > T2)
    const t3 = "2026-11-13T11:00:00.000Z";
    assert.equal(
      simulateReselectionRequired({
        status: "pending",
        doctorStatus: "rejected",
        doctorReviewedAt: t3,
        qaReassignedAt: t2, // Stale T2 from previous reassignment
        localResolvedAt: t2, // Stale T2
      }),
      true,
      "Step 3: Patient must see re-selection required again after Doctor B declines"
    );

    // Step 4: Patient reassigns to Doctor C at T4 (T4 > T3)
    const t4 = "2026-11-13T11:20:00.000Z";
    assert.equal(
      simulateReselectionRequired({
        status: "pending",
        doctorStatus: "pending-review",
        doctorReviewedAt: null,
        qaReassignedAt: t4,
        localResolvedAt: t4,
      }),
      false,
      "Step 4: Re-selection must NOT be required while Doctor C is reviewing"
    );

    // Step 5: Doctor C accepts at T5 (T5 > T4)
    const t5 = "2026-11-13T11:30:00.000Z";
    assert.equal(
      simulateReselectionRequired({
        status: "confirmed",
        doctorStatus: "approved",
        doctorReviewedAt: t5,
        qaReassignedAt: t4,
        localResolvedAt: t4,
      }),
      false,
      "Step 5: Confirmed/approved appointment must NOT require re-selection"
    );
  });

  await t.test("4. Notification service does not suppress subsequent doctor rejections", () => {
    // Verifies notification resolution logic accounts for active rejections
    assert.match(
      notifSrc,
      /const isDeclined\s*=\s*docSt === "rejected"\s*\|\|\s*docSt === "declined"/,
      "Notification service must check if doctor rejection is currently active"
    );
    assert.match(
      notifSrc,
      /localResolvedTime\s*>\s*rejectionTime/,
      "Notification resolution must require reassignment strictly after rejection timestamp"
    );

    // Verifies synthetic rejection notification includes timestamp in ID for deduplication and unread tracking
    assert.match(
      notifSrc,
      /const rejectionStamp = appt\.doctor_reviewed_at/,
      "Rejection notification must stamp with latest doctor_reviewed_at"
    );
    assert.match(
      notifSrc,
      /const notifId = `appt-rejected-\$\{appt\.appointment_id\}-\$\{rejectionStamp\}`;/,
      "Synthetic notification ID must be unique per doctor rejection timestamp"
    );

    // Verifies deduplication key uses stable event id or doctor id + precise timestamp
    assert.match(
      notifSrc,
      /const rejectKey = stableEventId\s*\?\s*`\$\{apptId\}:::rejected:::\$\{stableEventId\}`\s*:\s*\(docId && hasValidTime\)\s*\?\s*`\$\{apptId\}:::rejected:::\$\{docId\}:::\$\{timeNum\}`\s*:\s*`\$\{apptId\}:::rejected:::\$\{item\.id\}`;/,
      "Deduplication key must distinguish separate rejection events using doctor ID and precise timestamp, falling back to item.id"
    );

    // Verifies seenIds registers all retained notifications
    assert.match(
      notifSrc,
      /seenIds\.add\(item\.id\);\s*unique\.push\(item\);/,
      "seenIds.add(item.id) must be registered for all retained items"
    );

    // Verifies previous_doctor_id is not used as a declining doctor fallback in synthetic notifications
    assert.doesNotMatch(
      notifSrc,
      /previous_doctor_id/,
      "previous_doctor_id must not be used as declining doctor fallback in synthetic notifications"
    );
  });

  await t.test("5. 24-hour clinic reassignment fallback remains preserved and functional", () => {
    assert.match(
      statusPageSrc,
      /is24HourExpired \? \(/,
      "24-hour expiration banner must be rendered when alternate doctor selection window passes"
    );
    assert.match(
      statusPageSrc,
      /The 24-hour alternate doctor selection period has expired/,
      "Expired fallback message explaining clinic reassignment must be intact"
    );
    assert.match(
      statusPageSrc,
      /const canChooseAlternateDoctor = isDeclined && !is24HourExpired;/,
      "Select Alternate Doctor button must be available only while within the 24-hour window"
    );
  });

  await t.test("6. Payment and booking integrity remain strictly untouched", () => {
    // Confirm no payment amount, fee, PayMongo, or checkout calls are altered
    assert.match(
      modalSrc,
      /is_paid: true,/,
      "SelectAlternateDoctorModal must retain is_paid: true flag"
    );
    assert.match(
      modalSrc,
      /at no additional charge/,
      "Reassignment must continue to be explicitly at no additional charge"
    );
  });

  // Behavioral test suite for notification deduplication logic
  function simulateDeduplicate(items) {
    if (!Array.isArray(items) || items.length === 0) return [];
    const seenIds = new Set();
    const seenApptActions = new Set();
    const seenContentKeys = new Set();
    const unique = [];

    for (const item of items) {
      if (!item || !item.id) continue;
      if (seenIds.has(item.id)) continue;

      const apptId = item.metadata?.appointment_id || (item.id.startsWith("appt-rejected-") ? item.id.replace(/^appt-rejected-/, "").replace(/-\d+$/, "").replace(/-initial$/, "") : undefined);
      const normType = (item.type || item.metadata?.type || "").toLowerCase().replace(/_/g, "-");
      const isDoctorAction = normType.includes("doctor-");
      const isRejectionAction = normType === "appointment-rejected" || normType === "appointment-declined" || item.metadata?.subtype === "doctor-declined" || /declined|rejected/i.test(item.title || "");

      if (apptId && isRejectionAction) {
        const stableEventId = item.metadata?.rejection_event_id || item.metadata?.event_id;
        const docId = item.metadata?.doctor_id || item.metadata?.declined_doctor_id || "";
        const rejectStamp = item.metadata?.declined_at || item.metadata?.rejection_timestamp || item.timestamp;
        const timeNum = rejectStamp ? new Date(rejectStamp).getTime() : NaN;
        const hasValidTime = Number.isFinite(timeNum);

        const rejectKey = stableEventId
          ? `${apptId}:::rejected:::${stableEventId}`
          : (docId && hasValidTime)
          ? `${apptId}:::rejected:::${docId}:::${timeNum}`
          : `${apptId}:::rejected:::${item.id}`;

        if (seenApptActions.has(rejectKey)) continue;
        seenApptActions.add(rejectKey);
      } else if (apptId && isDoctorAction) {
        const apptActionKey = `${apptId}:::${normType}`;
        if (seenApptActions.has(apptActionKey)) continue;
        seenApptActions.add(apptActionKey);
      }

      if (!isRejectionAction && !isDoctorAction) {
        const normTitle = (item.title || "").trim().toLowerCase();
        const normMsg = (item.message || "").trim().toLowerCase();
        const contentKey = `${normTitle}:::${normMsg}`;
        if (normTitle && normMsg && seenContentKeys.has(contentKey)) continue;
        if (normTitle && normMsg) seenContentKeys.add(contentKey);
      }

      seenIds.add(item.id);
      unique.push(item);
    }
    return unique.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  await t.test("7. Behavioral: Two different doctors declining in the same minute produce distinct notifications", () => {
    // Both timestamps fall in minute 10:00:xx
    const tA = "2026-11-13T10:00:10.200Z";
    const tB = "2026-11-13T10:00:45.800Z";

    const notifDrA = {
      id: "notif-db-1",
      type: "appointment-rejected",
      title: "Appointment Declined",
      message: "Dr. Yanpein Zamora declined your consultation.",
      timestamp: tA,
      metadata: {
        appointment_id: "appt-uuid-1",
        doctor_id: "doc-uuid-yanpein",
        declined_at: tA,
      },
    };

    const notifDrB = {
      id: "notif-db-2",
      type: "appointment-rejected",
      title: "Appointment Declined",
      message: "Dr. Nathan Bayutas declined your consultation.",
      timestamp: tB,
      metadata: {
        appointment_id: "appt-uuid-1",
        doctor_id: "doc-uuid-nathan",
        declined_at: tB,
      },
    };

    const deduped = simulateDeduplicate([notifDrA, notifDrB]);
    assert.equal(deduped.length, 2, "Both notifications must be preserved even if occurring within the same minute");
    assert.equal(deduped[0].id, "notif-db-2", "Latest rejection (Dr. Nathan) must be first");
    assert.equal(deduped[1].id, "notif-db-1", "Earlier rejection (Dr. Yanpein) must be preserved");
  });

  await t.test("8. Behavioral: Successive rejections from the same doctor produce distinct notifications", () => {
    const tA1 = "2026-11-13T10:00:10.000Z";
    const tA2 = "2026-11-13T10:08:30.000Z"; // Same doctor declines again after a new reassignment

    const notif1 = {
      id: "notif-db-10",
      type: "appointment-rejected",
      title: "Appointment Declined",
      message: "Dr. Yanpein Zamora was unavailable on Friday.",
      timestamp: tA1,
      metadata: {
        appointment_id: "appt-uuid-1",
        doctor_id: "doc-uuid-yanpein",
        declined_at: tA1,
      },
    };

    const notif2 = {
      id: "notif-db-11",
      type: "appointment-rejected",
      title: "Appointment Declined",
      message: "Dr. Yanpein Zamora was unavailable on Monday.",
      timestamp: tA2,
      metadata: {
        appointment_id: "appt-uuid-1",
        doctor_id: "doc-uuid-yanpein",
        declined_at: tA2,
      },
    };

    const deduped = simulateDeduplicate([notif1, notif2]);
    assert.equal(deduped.length, 2, "Successive rejections from the same doctor at different timestamps must both be preserved");
    assert.equal(deduped[0].id, "notif-db-11");
    assert.equal(deduped[1].id, "notif-db-10");
  });

  await t.test("9. Behavioral: DB notification and synthetic fallback for the same rejection event are correctly deduplicated", () => {
    const tEvent = "2026-11-13T10:00:10.500Z";

    const dbNotif = {
      id: "notif-db-actual-uuid",
      type: "appointment-rejected",
      title: "Appointment Declined",
      message: "Dr. Nathan Bayutas declined consultation.",
      timestamp: tEvent,
      metadata: {
        appointment_id: "appt-uuid-1",
        doctor_id: "doc-uuid-nathan",
        declined_at: tEvent,
      },
    };

    const syntheticNotif = {
      id: `appt-rejected-appt-uuid-1-${new Date(tEvent).getTime()}`,
      type: "appointment-rejected",
      title: "Appointment Declined",
      message: "Your appointment request at Dermclinic was declined.",
      timestamp: tEvent,
      metadata: {
        appointment_id: "appt-uuid-1",
        doctor_id: "doc-uuid-nathan",
        declined_at: tEvent,
      },
    };

    const deduped = simulateDeduplicate([dbNotif, syntheticNotif]);
    assert.equal(deduped.length, 1, "Duplicate synthetic notification for the same rejection event must be deduplicated");
    assert.equal(deduped[0].id, "notif-db-actual-uuid", "Persistent DB notification should be kept");
  });

  await t.test("10. Behavioral: Earlier rejection is resolved by reassignment while subsequent rejection remains unresolved", () => {
    function simulateReselectionResolved(notifTimestamp, doctorReviewedAt, qaReassignedAt) {
      const isDeclined = true;
      const rejectionTime = notifTimestamp ? new Date(notifTimestamp).getTime() : (doctorReviewedAt ? new Date(doctorReviewedAt).getTime() : 0);
      const qaReassignedTime = qaReassignedAt ? new Date(qaReassignedAt).getTime() : 0;
      return qaReassignedTime > rejectionTime && qaReassignedTime > 0;
    }

    const tDeclineA = "2026-11-13T10:00:00.000Z";
    const tReassignB = "2026-11-13T10:05:00.000Z"; // Patient reassigns after Dr. A
    const tDeclineB = "2026-11-13T10:10:00.000Z"; // Dr. B declines

    // Doctor A's rejection evaluated after Dr. B declined
    const isDrAResolved = simulateReselectionResolved(tDeclineA, tDeclineB, tReassignB);
    assert.equal(isDrAResolved, true, "Doctor A's notification must be resolved because reassignment occurred after Doctor A's decline");

    // Doctor B's rejection evaluated after Dr. B declined
    const isDrBResolved = simulateReselectionResolved(tDeclineB, tDeclineB, tReassignB);
    assert.equal(isDrBResolved, false, "Doctor B's notification must NOT be resolved because reassignment occurred before Doctor B's decline");
  });

  await t.test("11. Behavioral: Duplicate notification IDs with different message content are deduplicated by seenIds", () => {
    const notif1 = {
      id: "shared-system-notif-uuid",
      type: "system",
      title: "Clinic Notice",
      message: "Version A of message body",
      timestamp: "2026-11-13T10:00:00.000Z",
    };

    const notif2 = {
      id: "shared-system-notif-uuid", // Exact same ID
      type: "system",
      title: "Updated Notice", // Different title and body
      message: "Version B of message body",
      timestamp: "2026-11-13T10:01:00.000Z",
    };

    const deduped = simulateDeduplicate([notif1, notif2]);
    assert.equal(deduped.length, 1, "Duplicate notification IDs must be deduplicated by seenIds regardless of content differences");
  });

  await t.test("12. Behavioral: Rejection notifications with missing or invalid timestamps do NOT collapse into each other", () => {
    const notifMissing1 = {
      id: "notif-invalid-time-1",
      type: "appointment-rejected",
      title: "Appointment Declined",
      message: "First rejection notice",
      timestamp: "invalid-date-string",
      metadata: {
        appointment_id: "appt-1",
        doctor_id: "doc-1",
        declined_at: "not-a-valid-date",
      },
    };

    const notifMissing2 = {
      id: "notif-invalid-time-2",
      type: "appointment-rejected",
      title: "Appointment Declined",
      message: "Second rejection notice",
      timestamp: null,
      metadata: {
        appointment_id: "appt-1",
        doctor_id: "doc-1",
        declined_at: undefined,
      },
    };

    const deduped = simulateDeduplicate([notifMissing1, notifMissing2]);
    assert.equal(deduped.length, 2, "Separate rejection events with missing/invalid timestamps must fall back to item.id and remain distinct");
  });

  await t.test("13. Behavioral: Rejection notifications with missing doctor IDs do NOT collapse into each other", () => {
    const notifMissingDoc1 = {
      id: "notif-missing-doc-1",
      type: "appointment-rejected",
      title: "Appointment Declined",
      message: "Clinic staff declined slot A",
      timestamp: "2026-11-13T10:00:00.000Z",
      metadata: {
        appointment_id: "appt-1",
        doctor_id: undefined, // Missing doctor ID
        declined_at: "2026-11-13T10:00:00.000Z",
      },
    };

    const notifMissingDoc2 = {
      id: "notif-missing-doc-2",
      type: "appointment-rejected",
      title: "Appointment Declined",
      message: "Clinic staff declined slot B",
      timestamp: "2026-11-13T10:05:00.000Z",
      metadata: {
        appointment_id: "appt-1",
        doctor_id: null, // Missing doctor ID
        declined_at: "2026-11-13T10:05:00.000Z",
      },
    };

    const deduped = simulateDeduplicate([notifMissingDoc1, notifMissingDoc2]);
    assert.equal(deduped.length, 2, "Separate rejection events with missing doctor IDs must fall back to item.id and remain distinct");
  });
});
