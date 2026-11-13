import test from "node:test";
import assert from "node:assert/strict";

/**
 * Unit & Regression Tests for Doctor Portal Appointment Review Notifications
 */

// Helper simulating doctor notification mapping for assigned appointments
function mapDoctorAppointmentNotification(appt, clinicMap = new Map(), readSet = new Set()) {
  const items = [];
  const patient = appt.patient_name || "A patient";
  const condition = appt.ai_condition_name ? ` for ${appt.ai_condition_name}` : "";
  const dateStr = appt.date
    ? new Date(appt.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "scheduled date";
  const cObj = Array.isArray(appt.clinic) ? appt.clinic[0] : appt.clinic;
  const clinic = cObj?.name || clinicMap.get(appt.clinic_id) || "Clinic";
  const clinicLogo = cObj?.logo_url || undefined;
  const patientId = appt.user_id || appt.appointment_id;
  const clinicId = appt.clinic_id;
  const appointmentId = appt.appointment_id;

  const targetNav = clinicId && patientId
    ? `/doctor/clinics/${clinicId}/patients/${patientId}?appointmentId=${appointmentId}`
    : "/doctor/appointments";

  // A. Pending review / decision (assigned)
  if (appt.doctor_status === "pending" || !appt.doctor_status) {
    const notifId = `doc-req-${appt.appointment_id}`;
    items.push({
      id: notifId,
      type: "appointment_request",
      category: "appointment",
      title: "New Patient Appointment for Review",
      message: "A new paid appointment has been assigned to you and is awaiting your review.",
      senderName: clinic,
      senderType: "clinic",
      senderAvatar: clinicLogo || undefined,
      link: targetNav,
      timestamp: appt.created_at || new Date().toISOString(),
      isRead: readSet.has(notifId),
      metadata: {
        appointment_id: appointmentId,
        appointmentId: appointmentId,
        clinic_id: clinicId,
        clinicId: clinicId,
        clinic_name: clinic,
        clinic_logo: clinicLogo,
        branch_name: clinic,
        branch_logo: clinicLogo,
        patient_id: patientId,
        patientId: patientId,
        category: "appointment",
        type: "appointment_request",
        link: targetNav,
      },
    });
  }

  // B. Genuine upcoming consultation reminder (within 24 hours of scheduled time)
  // Suppresses redundant approval self-confirmations ("... has been confirmed")
  if (appt.doctor_status === "approved" && appt.status !== "completed" && appt.date) {
    const apptTimestamp = new Date(appt.date).getTime();
    const now = Date.now();
    const isApproaching = !isNaN(apptTimestamp) && apptTimestamp >= now && apptTimestamp - now <= 24 * 60 * 60 * 1000;
    if (isApproaching) {
      const notifId = `doc-reminder-${appt.appointment_id}`;
      const timeStr = appt.time ? ` at ${appt.time}` : "";
      items.push({
        id: notifId,
        type: "appointment-reminder",
        category: "appointment",
        title: "Upcoming Consultation Reminder",
        message: `Reminder: Consultation with ${patient}${condition} is scheduled for ${dateStr}${timeStr} at ${clinic}.`,
        senderName: clinic,
        senderType: "clinic",
        senderAvatar: clinicLogo || undefined,
        link: "/doctor/scheduled",
        timestamp: appt.created_at || new Date().toISOString(),
        isRead: readSet.has(notifId),
        metadata: {
          appointment_id: appt.appointment_id,
          appointmentId: appointmentId,
          clinic_id: clinicId,
          clinicId: clinicId,
          clinic_name: clinic,
          branch_name: clinic,
          patient_id: patientId,
          patientId: patientId,
        },
      });
    }
  }

  return items;
}

// Action label resolver mirroring DoctorNotifications.tsx
function resolveDoctorNotificationAction(item) {
  const isMaintenance =
    item.metadata?.subtype === "maintenance_alert" ||
    item.type === "maintenance_alert" ||
    item.metadata?.priority === "high";

  const isAppointmentRequest =
    item.category === "appointment" ||
    item.type === "appointment_request" ||
    item.type === "appointment-request" ||
    item.type === "new-booking" ||
    item.type === "new_booking" ||
    item.type === "appointment-created" ||
    item.type === "appointment_created" ||
    item.type.includes("delegated") ||
    item.type.includes("appointment") ||
    item.type.includes("booking");

  let actionLabel = "View Consultation";
  if (isMaintenance) {
    actionLabel = "View System Status";
  } else if (item.type === "appointment-confirmed") {
    actionLabel = "View Scheduled Appointment";
  } else if (isAppointmentRequest) {
    actionLabel = "Review Patient Request";
  }
  return `${actionLabel} →`;
}

test("Doctor Review Notifications Test Suite", async (t) => {
  await t.test("Scenario 1: New paid appointment awaiting doctor review renders expected title and message", () => {
    const appt = {
      appointment_id: "appt-uuid-101",
      clinic_id: "clinic-derma-001",
      clinic: { name: "DerMA", logo_url: "https://dermai.app/logo-derma.png" },
      patient_name: "Maria Santos",
      ai_condition_name: "Atopic Dermatitis",
      date: "2026-11-20",
      time: "10:00 AM",
      doctor_status: "pending",
      status: "pending",
      user_id: "user-patient-201",
      created_at: new Date().toISOString(),
    };

    const notifs = mapDoctorAppointmentNotification(appt);
    assert.strictEqual(notifs.length, 1);
    assert.strictEqual(notifs[0].title, "New Patient Appointment for Review");
    assert.strictEqual(
      notifs[0].message,
      "A new paid appointment has been assigned to you and is awaiting your review."
    );
    assert.strictEqual(notifs[0].senderName, "DerMA");
    assert.strictEqual(notifs[0].senderType, "clinic");
    assert.strictEqual(notifs[0].isRead, false);
  });

  await t.test("Scenario 2: Action button correctly resolves to 'Review Patient Request →'", () => {
    const item = {
      id: "doc-req-appt-101",
      type: "appointment_request",
      category: "appointment",
      metadata: { branch_name: "DERMCARE" },
    };

    const action = resolveDoctorNotificationAction(item);
    assert.strictEqual(action, "Review Patient Request →");
  });

  await t.test("Scenario 3: Multi-clinic doctor isolation: DerMA vs DERMCARE", () => {
    const apptDerma = {
      appointment_id: "appt-derma-1",
      clinic_id: "clinic-derma-id",
      clinic: { name: "DerMA" },
      patient_name: "John Doe",
      date: "2026-11-22",
      doctor_status: "pending",
      user_id: "user-1",
    };

    const apptDermcare = {
      appointment_id: "appt-dermcare-2",
      clinic_id: "clinic-dermcare-id",
      clinic: { name: "DERMCARE" },
      patient_name: "Jane Smith",
      date: "2026-11-23",
      doctor_status: "pending",
      user_id: "user-2",
    };

    const notifsDerma = mapDoctorAppointmentNotification(apptDerma);
    const notifsDermcare = mapDoctorAppointmentNotification(apptDermcare);

    assert.strictEqual(notifsDerma[0].senderName, "DerMA");
    assert.strictEqual(notifsDerma[0].link, "/doctor/clinics/clinic-derma-id/patients/user-1?appointmentId=appt-derma-1");

    assert.strictEqual(notifsDermcare[0].senderName, "DERMCARE");
    assert.strictEqual(notifsDermcare[0].link, "/doctor/clinics/clinic-dermcare-id/patients/user-2?appointmentId=appt-dermcare-2");
  });

  await t.test("Scenario 4: Doctor self-approval DOES NOT generate redundant confirmation notification", () => {
    const approvedAppt = {
      appointment_id: "appt-uuid-approved",
      clinic_id: "clinic-derma-id",
      clinic: { name: "DerMA" },
      patient_name: "Patient Maria",
      date: "2026-12-01", // Far in the future
      doctor_status: "approved",
      status: "scheduled",
      user_id: "user-patient-201",
    };

    const notifs = mapDoctorAppointmentNotification(approvedAppt);
    // Should NOT create doc-confirmed with "[Patient Name]'s consultation has been confirmed."
    assert.strictEqual(notifs.length, 0, "No redundant self-confirmation notification should be created");
  });

  await t.test("Scenario 5: Legitimate upcoming consultation reminder within 24 hours IS generated", () => {
    // Appointment scheduled 4 hours from now
    const upcomingDate = new Date(Date.now() + 4 * 3600 * 1000).toISOString();
    const upcomingAppt = {
      appointment_id: "appt-uuid-upcoming",
      clinic_id: "clinic-derma-id",
      clinic: { name: "DerMA" },
      patient_name: "Maria Santos",
      ai_condition_name: "Acne",
      date: upcomingDate,
      time: "2:00 PM",
      doctor_status: "approved",
      status: "scheduled",
      user_id: "user-patient-201",
    };

    const notifs = mapDoctorAppointmentNotification(upcomingAppt);
    assert.strictEqual(notifs.length, 1, "Upcoming consultation reminder should be generated");
    assert.strictEqual(notifs[0].title, "Upcoming Consultation Reminder");
    assert.match(notifs[0].message, /Reminder: Consultation with Maria Santos/);
    assert.strictEqual(notifs[0].senderName, "DerMA");
  });

  await t.test("Scenario 6: Read status is preserved when notification ID is in readSet", () => {
    const appt = {
      appointment_id: "appt-uuid-read",
      clinic_id: "clinic-derma-id",
      clinic: { name: "DerMA" },
      patient_name: "Maria Santos",
      date: "2026-11-20",
      doctor_status: "pending",
      user_id: "user-patient-201",
    };

    const readSet = new Set(["doc-req-appt-uuid-read"]);
    const notifs = mapDoctorAppointmentNotification(appt, new Map(), readSet);
    assert.strictEqual(notifs[0].isRead, true, "Already read notification should remain read");
  });
});

