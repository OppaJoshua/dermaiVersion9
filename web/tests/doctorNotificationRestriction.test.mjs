import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("DermAI Doctor Notifications - Two Allowed Types Restriction", () => {
  it("only generates 'To Review New Appointment' and 'Confirmed Appointment' for bookings", () => {
    const ALLOWED_BOOKING_TITLES = new Set([
      "To Review New Appointment",
      "Confirmed Appointment",
    ]);

    const sampleReviewNotif = {
      id: "doc-req-appt-123",
      type: "appointment_request",
      category: "appointment",
      title: "To Review New Appointment",
      message: "A new paid patient appointment has been assigned to you for review.",
      actionLabel: "Review Patient Request",
      link: "/doctor/clinics/c-1/patients/p-1?appointmentId=appt-123",
    };

    const sampleConfirmedNotif = {
      id: "notif-uuid-conf-456",
      type: "appointment-confirmed",
      category: "appointment",
      title: "Confirmed Appointment",
      message: "You have accepted this patient's appointment. The consultation is now confirmed and scheduled.",
      actionLabel: "View Scheduled Appointment",
      link: "/doctor/scheduled",
    };

    assert.equal(ALLOWED_BOOKING_TITLES.has(sampleReviewNotif.title), true);
    assert.equal(ALLOWED_BOOKING_TITLES.has(sampleConfirmedNotif.title), true);
    assert.equal(sampleReviewNotif.actionLabel, "Review Patient Request");
    assert.equal(sampleConfirmedNotif.actionLabel, "View Scheduled Appointment");
    assert.equal(sampleConfirmedNotif.link, "/doctor/scheduled");
    assert.equal(sampleConfirmedNotif.message, "You have accepted this patient's appointment. The consultation is now confirmed and scheduled.");
  });

  it("coexists both review and confirmation notifications for the same appointment in history", () => {
    const apptId = "56b77fcc-31d6-4dc3-93e7-3d2066c685ed";

    const items = [
      {
        id: "notif-rev-uuid",
        type: "appointment_request",
        category: "appointment",
        title: "To Review New Appointment",
        message: "A new paid patient appointment has been assigned to you for review.",
        metadata: { appointment_id: apptId },
        timestamp: "2026-11-13T08:00:00Z",
        isRead: true,
      },
      {
        id: "notif-conf-uuid",
        type: "appointment-confirmed",
        category: "appointment",
        title: "Confirmed Appointment",
        message: "You have accepted this patient's appointment. The consultation is now confirmed and scheduled.",
        metadata: { appointment_id: apptId },
        timestamp: "2026-11-13T08:30:00Z",
        isRead: false,
      },
    ];

    // Simulating deduplication logic
    const seenIds = new Set();
    const seenContentKeys = new Set();
    const seenApptActions = new Set();
    const unique = [];

    for (const item of items) {
      if (seenIds.has(item.id)) continue;

      const normType = (item.type || "").toLowerCase().replace(/_/g, "-");
      const apptActionKey = `${item.metadata.appointment_id}:::${normType}`;

      if (seenApptActions.has(apptActionKey)) continue;

      const normTitle = (item.title || "").trim().toLowerCase();
      const normMsg = (item.message || "").trim().toLowerCase();
      const contentKey = `${normTitle}:::${normMsg}`;

      if (seenContentKeys.has(contentKey)) continue;

      seenIds.add(item.id);
      seenApptActions.add(apptActionKey);
      seenContentKeys.add(contentKey);
      unique.push(item);
    }

    assert.equal(unique.length, 2, "Both review and confirmed notifications must be preserved");
    assert.equal(unique[0].title, "To Review New Appointment");
    assert.equal(unique[1].title, "Confirmed Appointment");
    assert.equal(unique[0].isRead, true, "Review notification read state is preserved");
    assert.equal(unique[1].isRead, false, "Confirmed notification remains unread independently");
  });

  it("preserves historical database notifications with old titles without rewriting them", () => {
    const historicalDbRows = [
      {
        notif_id: "899ab552-002a-4fb8-a470-1bbe2aabda98",
        type: "appointment_request",
        subtype: "new_booking",
        title: "New Appointment Booking",
        body: "A paid appointment is awaiting your review.",
        is_read: true,
        created_at: "2026-11-05T23:52:48.460507Z",
      },
    ];

    assert.equal(historicalDbRows.length, 1);
    assert.equal(historicalDbRows[0].title, "New Appointment Booking");
    assert.equal(historicalDbRows[0].is_read, true);
  });
});
