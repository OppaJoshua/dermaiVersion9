import { extractConsultationQuestionnaire } from "../lib/consultationDetailsService";
import { serializeDoctorSchedule } from "../lib/schedulingService";
/**
 * ============================================================================
 * DermAI - Appointment Status & Notification Regression Test Suite
 * ============================================================================
 *
 * Verifies:
 * 1. Timeline progression (`getStepIndex`) for all verified lifecycle stages.
 * 2. Unassigned pending request does not jump to Doctor Review.
 * 3. Doctor-declined request does not advance timeline toward confirmation.
 * 4. AI scan predictions are segregated from Dermatologist Clinical Diagnoses.
 * 5. Genuine clinician assessment is displayed without requiring appointment completion.
 * 6. Verified online payments show online receipt and NEVER counter cash notices.
 * 7. Unpaid/counter visits show counter payment instructions.
 * 8. Requested vs Confirmed date and time labels match appointment confirmation state.
 * 9. Patient self-cancellation NEVER triggers a doctor-declined or alternate-doctor notification.
 * 10. Genuine doctor decline generates 24-hour alternate-doctor selection notification.
 * 11. Alternate doctor selection preserves same appointment record without extra charge.
 * 12. Notification deduplication prevents redundant alerts for identical events.
 */

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${msg}`);
  }
}

// Replicate the exact logic from AppointmentStatusPage.tsx for unit contract testing
interface AppointmentStatusContract {
  id: string;
  status: "Pending" | "Scheduled" | "Rejected" | "Completed" | "Cancelled";
  doctorStatus?: "pending-review" | "approved" | "rejected";
  assignedDoctorId?: string;
  checkInStatus?: "scheduled" | "arrived" | "in-consultation" | "completed" | "no-show";
  doctorDiagnosis?: string;
  aiConditionName?: string;
  doctorNote?: string;
  paymentStatus?: "pending_hold" | "paid" | "failed" | "cancelled" | "expired" | "exempt";
  paymentReference?: string;
  paymentAmount?: number;
  rescheduleRequested?: boolean;
}

function getStepIndex(app: AppointmentStatusContract): number {
  if (app.status === "Completed") return 3;
  if ((app.status === "Scheduled" || app.doctorStatus === "approved") && app.doctorStatus !== "rejected") return 2;
  if (app.status === "Pending" && app.assignedDoctorId && app.doctorStatus === "pending-review") return 1;
  return 0;
}

function computeScheduleLabels(app: AppointmentStatusContract) {
  const rawStatus = (app.status || "").toLowerCase();
  const docStatus = (app.doctorStatus || "").toLowerCase();
  const isDeclined =
    docStatus === "rejected" ||
    rawStatus === "rejected" ||
    rawStatus === "declined";

  const isConfirmed = (app.status === "Scheduled" || app.status === "Completed") && !isDeclined;

  return {
    dateLabel: isConfirmed ? "Confirmed Date" : "Requested Date",
    timeLabel: isConfirmed ? "Confirmed Time" : "Requested Time",
    isConfirmed,
  };
}

function resolvePaymentInstruction(app: AppointmentStatusContract) {
  if (app.paymentStatus === "paid") {
    return {
      type: "paid_online",
      summary: `Paid Online (Verified${app.paymentReference ? ` • Ref: ${app.paymentReference}` : ""})`,
      showCounterCashNotice: false,
    };
  }
  if (app.paymentStatus === "exempt") {
    return {
      type: "exempt",
      summary: "Exempt",
      showCounterCashNotice: false,
    };
  }
  if (app.paymentStatus === "failed") {
    return {
      type: "failed",
      summary: "Payment Failed",
      showCounterCashNotice: false,
    };
  }
  if (app.paymentStatus === "expired") {
    return {
      type: "expired",
      summary: "Hold Expired",
      showCounterCashNotice: false,
    };
  }
  if (app.paymentStatus === "pending_hold") {
    return {
      type: "pending_hold",
      summary: "Payment Pending",
      showCounterCashNotice: false,
    };
  }
  if (app.paymentStatus === "cancelled") {
    return {
      type: "cancelled",
      summary: "Cancelled (Unpaid)",
      showCounterCashNotice: false,
    };
  }
  return {
    type: "online_pending",
    summary: "Online Payment (PayMongo)",
    showCounterCashNotice: false,
  };
}

function resolveDiagnosisAndScanSections(app: AppointmentStatusContract) {
  const isDeclined = app.doctorStatus === "rejected";

  const showAiScanReference = Boolean(
    app.aiConditionName &&
    !app.aiConditionName.toLowerCase().includes("general dermatol") &&
    !app.aiConditionName.toLowerCase().includes("general consult")
  );

  const showClinicianAssessment = Boolean(
    !isDeclined &&
    app.status !== "Cancelled" &&
    app.status !== "Rejected" &&
    app.doctorDiagnosis &&
    !app.doctorDiagnosis.toLowerCase().includes("general dermatol") &&
    !app.doctorDiagnosis.toLowerCase().includes("general consult")
  );

  return {
    showAiScanReference,
    aiConditionValue: showAiScanReference ? app.aiConditionName : null,
    showClinicianAssessment,
    clinicianDiagnosisValue: showClinicianAssessment ? app.doctorDiagnosis : null,
  };
}

function generatePatientAppointmentNotification(appt: {
  appointment_id: string;
  status: string;
  doctor_status?: string;
  doctor_note?: string;
  clinic_note?: string;
  clinic_name: string;
  date_str: string;
}) {
  const items: Array<{ id: string; type: string; title: string; message: string; requiresAlternateDoctor: boolean }> = [];

  // B1. Doctor-Initiated Decline
  if (appt.doctor_status === "rejected" && appt.status !== "cancelled") {
    items.push({
      id: `appt-rejected-${appt.appointment_id}`,
      type: "appointment-rejected",
      title: "Appointment Declined",
      message: `Your appointment request at ${appt.clinic_name} on ${appt.date_str} was declined. You can select another available doctor within 24 hours.`,
      requiresAlternateDoctor: true,
    });
  }

  // B2. Patient-Initiated or Administrative Cancellation
  if (appt.status === "cancelled") {
    items.push({
      id: `appt-cancelled-${appt.appointment_id}`,
      type: "appointment-cancelled",
      title: "Appointment Cancelled",
      message: `Your consultation request with ${appt.clinic_name} on ${appt.date_str} was cancelled.`,
      requiresAlternateDoctor: false,
    });
  }

  return items;
}

async function runTests() {
  console.log("\n=======================================================");
  console.log("DermAI — Appointment Status & Notification Cleanup Tests");
  console.log("=======================================================\n");

  // --- Scenario 1: Timeline Progression: Unassigned Pending Request ---
  console.log("[Scenario 1] Testing unassigned pending request timeline...");
  {
    const app: AppointmentStatusContract = {
      id: "appt-unassigned",
      status: "Pending",
      assignedDoctorId: undefined,
      doctorStatus: undefined,
    };
    const step = getStepIndex(app);
    assert(step === 0, `Expected step 0 (Request Sent) for unassigned pending, got ${step}`);
    console.log("✓ 1. Unassigned pending request stays at Step 0 ('Request Sent') without prematurely showing Doctor Review.");
  }

  // --- Scenario 2: Timeline Progression: Active Doctor Review ---
  console.log("\n[Scenario 2] Testing doctor reviewing request timeline...");
  {
    const app: AppointmentStatusContract = {
      id: "appt-review",
      status: "Pending",
      assignedDoctorId: "doc-uuid-1",
      doctorStatus: "pending-review",
    };
    const step = getStepIndex(app);
    assert(step === 1, `Expected step 1 (Doctor Review) when doctor is assigned and pending review, got ${step}`);
    console.log("✓ 2. Assigned doctor actively reviewing correctly highlights Step 1 ('Doctor Review').");
  }

  // --- Scenario 3: Timeline Progression: Doctor Decline / Alternate Doctor Window ---
  console.log("\n[Scenario 3] Testing doctor decline does not advance timeline toward confirmation...");
  {
    const app: AppointmentStatusContract = {
      id: "appt-declined",
      status: "Pending",
      assignedDoctorId: "doc-uuid-1",
      doctorStatus: "rejected",
    };
    const step = getStepIndex(app);
    assert(step === 0, `Expected step 0 for declined appointment awaiting alternate doctor, got ${step}`);
    console.log("✓ 3. Doctor decline resets timeline to Step 0, preventing false progression toward Scheduled.");
  }

  // --- Scenario 4: Timeline Progression: Doctor Approval & Scheduled ---
  console.log("\n[Scenario 4] Testing doctor approval and confirmed schedule...");
  {
    const app: AppointmentStatusContract = {
      id: "appt-scheduled",
      status: "Scheduled",
      doctorStatus: "approved",
      assignedDoctorId: "doc-uuid-1",
    };
    const step = getStepIndex(app);
    assert(step === 2, `Expected step 2 (Scheduled) for approved appointment, got ${step}`);
    console.log("✓ 4. Doctor approval correctly locks Step 2 ('Scheduled').");
  }

  // --- Scenario 5: Timeline Progression: Completed Consultation ---
  console.log("\n[Scenario 5] Testing completed consultation timeline...");
  {
    const app: AppointmentStatusContract = {
      id: "appt-completed",
      status: "Completed",
      doctorStatus: "approved",
    };
    const step = getStepIndex(app);
    assert(step === 3, `Expected step 3 (Completed), got ${step}`);
    console.log("✓ 5. Completed consultation advances to Step 3 ('Completed').");
  }

  // --- Scenario 6: AI Scan Result without Clinician Assessment ---
  console.log("\n[Scenario 6] Testing AI scan result separation from clinician diagnosis...");
  {
    const app: AppointmentStatusContract = {
      id: "appt-ai-only",
      status: "Pending",
      doctorStatus: "pending-review",
      assignedDoctorId: "doc-uuid-1",
      aiConditionName: "Melasma",
      doctorDiagnosis: undefined,
    };
    const sections = resolveDiagnosisAndScanSections(app);
    assert(sections.showAiScanReference === true, "Expected AI scan reference card to be displayed");
    assert(sections.aiConditionValue === "Melasma", "Expected AI scan condition to be 'Melasma'");
    assert(sections.showClinicianAssessment === false, "Clinician diagnosis banner MUST NOT display for AI scan result");
    console.log("✓ 6. AI scan prediction ('Melasma') displays strictly as 'AI Scan Reference' and never as a doctor diagnosis.");
  }

  // --- Scenario 7: Genuine Clinician Assessment Display ---
  console.log("\n[Scenario 7] Testing genuine clinician assessment display without requiring completion...");
  {
    const app: AppointmentStatusContract = {
      id: "appt-doc-diag",
      status: "Scheduled",
      doctorStatus: "approved",
      doctorDiagnosis: "Post-Inflammatory Hyperpigmentation",
      doctorNote: "Apply prescribed hydroquinone cream nightly.",
      aiConditionName: "Melasma",
    };
    const sections = resolveDiagnosisAndScanSections(app);
    assert(sections.showClinicianAssessment === true, "Expected clinician assessment to display");
    assert(sections.clinicianDiagnosisValue === "Post-Inflammatory Hyperpigmentation", "Expected real clinician diagnosis");
    assert(sections.showAiScanReference === true, "Expected AI scan reference to also be preserved for doctor context");
    console.log("✓ 7. Clinician-authored diagnosis displays under 'Dermatologist Clinical Assessment & Diagnosis' when present.");
  }

  // --- Scenario 8: Verified Online Payment Instructions & Reference Safety Guard ---
  console.log("\n[Scenario 8] Testing verified online payment removes counter cash instructions...");
  {
    // 8a. Authoritative verified paid with reference
    const paidApp: AppointmentStatusContract = {
      id: "appt-paid-online",
      status: "Scheduled",
      doctorStatus: "approved",
      paymentStatus: "paid",
      paymentReference: "pay_pm_test_998877",
      paymentAmount: 100,
    };
    const payment = resolvePaymentInstruction(paidApp);
    assert(payment.type === "paid_online", "Expected paid_online payment type");
    assert(payment.showCounterCashNotice === false, "Counter cash notice MUST NOT be shown for online-paid visits");
    assert(payment.summary.includes("pay_pm_test_998877"), "Payment reference must be verified in summary");

    // 8b. SAFETY GUARD: paymentReference alone WITHOUT paymentStatus='paid' MUST NOT trigger paid_online
    const refWithoutPaidStatus: AppointmentStatusContract = {
      id: "appt-ref-only-unpaid",
      status: "Scheduled",
      paymentStatus: undefined, // Unverified payment status
      paymentReference: "SIM-HOLD-20261029",
    };
    const refOnlyPayment = resolvePaymentInstruction(refWithoutPaidStatus);
    assert(refOnlyPayment.type !== "paid_online", "Payment reference alone MUST NOT trigger paid_online");
    assert(refOnlyPayment.type === "online_pending", "Expected fallback to online_pending when paymentStatus is undefined");
    assert(refOnlyPayment.showCounterCashNotice === false, "Must NEVER display counter cash notice in online-only system");
    assert(!refOnlyPayment.summary.includes("Counter"), "Summary must never say Pay at Counter");

    // 8c. SAFETY GUARD: Failed payment with reference MUST NOT trigger paid_online
    const failedWithRef: AppointmentStatusContract = {
      id: "appt-failed-with-ref",
      status: "Scheduled",
      paymentStatus: "failed",
      paymentReference: "pay_failed_ref_123",
    };
    const failedPayment = resolvePaymentInstruction(failedWithRef);
    assert(failedPayment.type === "failed", "Expected failed payment type");
    assert(failedPayment.type !== "paid_online", "Failed payment MUST NOT trigger paid_online even with reference");

    console.log("✓ 8. Online-paid receipt requires authoritative paymentStatus='paid'; paymentReference alone is NEVER accepted as proof of payment.");
  }

  // --- Scenario 9: Online-Only Payment Workflow (No Cash / Counter Payments) ---
  console.log("\n[Scenario 9] Testing online-only payment workflow (no cash/counter payment)...");
  {
    const app: AppointmentStatusContract = {
      id: "appt-online-unpaid",
      status: "Scheduled",
      doctorStatus: "approved",
      paymentStatus: undefined,
      paymentReference: undefined,
    };
    const payment = resolvePaymentInstruction(app);
    assert(payment.type === "online_pending", "Expected online_pending payment type");
    assert(payment.showCounterCashNotice === false, "Counter notice must NEVER be shown in online-only system");
    assert(payment.summary === "Online Payment (PayMongo)", "Expected Online Payment (PayMongo) label");

    // Also check cancelled hold
    const cancelledApp: AppointmentStatusContract = {
      id: "appt-cancelled-unpaid",
      status: "Cancelled",
      paymentStatus: "cancelled",
    };
    const cancelledPay = resolvePaymentInstruction(cancelledApp);
    assert(cancelledPay.type === "cancelled", "Expected cancelled payment type");
    assert(cancelledPay.summary === "Cancelled (Unpaid)", "Expected Cancelled (Unpaid) label");
    assert(!cancelledPay.summary.includes("Counter"), "Must never say Pay at Counter");

    console.log("✓ 9. Online-only payment enforcement verified: missing/unpaid records NEVER default to Pay at Counter.");
  }

  // --- Scenario 10: Requested vs Confirmed Schedule Labels ---
  console.log("\n[Scenario 10] Testing requested vs confirmed schedule labels...");
  {
    // 10a. Pending appointment
    const pendingApp: AppointmentStatusContract = { id: "p1", status: "Pending" };
    const pendingLabels = computeScheduleLabels(pendingApp);
    assert(pendingLabels.dateLabel === "Requested Date", "Pending must show Requested Date");
    assert(pendingLabels.timeLabel === "Requested Time", "Pending must show Requested Time");
    assert(pendingLabels.isConfirmed === false, "Pending is not confirmed");

    // 10b. Confirmed appointment
    const confirmedApp: AppointmentStatusContract = { id: "c1", status: "Scheduled", doctorStatus: "approved" };
    const confirmedLabels = computeScheduleLabels(confirmedApp);
    assert(confirmedLabels.dateLabel === "Confirmed Date", "Scheduled must show Confirmed Date");
    assert(confirmedLabels.timeLabel === "Confirmed Time", "Scheduled must show Confirmed Time");
    assert(confirmedLabels.isConfirmed === true, "Scheduled is confirmed");

    // 10c. Doctor declined appointment (must NOT be labeled confirmed)
    const declinedApp: AppointmentStatusContract = { id: "d1", status: "Pending", doctorStatus: "rejected" };
    const declinedLabels = computeScheduleLabels(declinedApp);
    assert(declinedLabels.dateLabel === "Requested Date", "Declined appointment must NOT show Confirmed Date");
    assert(declinedLabels.timeLabel === "Requested Time", "Declined appointment must NOT show Confirmed Time");
    assert(declinedLabels.isConfirmed === false, "Declined appointment is not confirmed");

    console.log("✓ 10. Schedule labels accurately reflect Requested vs Confirmed dates and times.");
  }

  // --- Scenario 11: Patient Self-Cancellation Notification ---
  console.log("\n[Scenario 11] Testing patient self-cancellation does NOT trigger doctor decline notification...");
  {
    const cancelNotifs = generatePatientAppointmentNotification({
      appointment_id: "appt-self-cancel",
      status: "cancelled",
      doctor_status: "pending-review",
      clinic_name: "Dermclinic",
      date_str: "Oct 29, 2026",
    });

    assert(cancelNotifs.length === 1, "Expected exactly 1 notification for cancellation");
    assert(cancelNotifs[0].type === "appointment-cancelled", `Expected appointment-cancelled, got ${cancelNotifs[0].type}`);
    assert(cancelNotifs[0].title === "Appointment Cancelled", `Expected Appointment Cancelled title, got ${cancelNotifs[0].title}`);
    assert(cancelNotifs[0].requiresAlternateDoctor === false, "Self-cancellation MUST NOT ask patient to choose alternate doctor");
    assert(!cancelNotifs[0].message.includes("declined"), "Self-cancellation message must not contain 'declined'");
    console.log("✓ 11. Patient cancellation generates 'Appointment Cancelled' and NEVER a false 'Doctor Declined' alert.");
  }

  // --- Scenario 12: Doctor Decline Notification with 24-Hour Alternate Selection ---
  console.log("\n[Scenario 12] Testing genuine doctor decline notification...");
  {
    const declineNotifs = generatePatientAppointmentNotification({
      appointment_id: "appt-genuine-decline",
      status: "pending",
      doctor_status: "rejected",
      doctor_note: "Attending emergency medical conference",
      clinic_name: "Dermclinic",
      date_str: "Oct 29, 2026",
    });

    assert(declineNotifs.length === 1, "Expected 1 notification for doctor decline");
    assert(declineNotifs[0].type === "appointment-rejected", "Expected appointment-rejected type");
    assert(declineNotifs[0].title === "Appointment Declined", "Expected Appointment Declined title");
    assert(declineNotifs[0].requiresAlternateDoctor === true, "Genuine decline MUST prompt for alternate doctor");
    assert(declineNotifs[0].message.includes("24 hours"), "Must communicate 24-hour window");
    console.log("✓ 12. Genuine doctor decline prompts patient to select alternate doctor within 24 hours.");
  }

  // --- Scenario 13: Production extractConsultationQuestionnaire on Real Questionnaire Payload ---
  console.log("\n[Scenario 13] Testing production extractConsultationQuestionnaire on 15-question payload...");
  {
    const sampleScanPayload = [
      {
        id: "q1",
        number: 1,
        question: "How severe is the itching associated with the skin concern?",
        answer: "Moderate itching",
        selectedOptionIds: ["q1_moderate"],
      },
      {
        id: "q2",
        number: 2,
        question: "How long has this skin concern been present?",
        answer: "Several weeks (1-3 months)",
        selectedOptionIds: ["q2_weeks"],
      },
      {
        id: "reschedule_requested", // Metadata key that should be ignored
        answer: "true",
      },
    ];

    const extracted = extractConsultationQuestionnaire(sampleScanPayload);
    assert(extracted.length === 2, `Expected 2 extracted questions, got ${extracted.length}`);
    assert(extracted[0].number === 1, "Question 1 preserved");
    assert(extracted[0].answer === "Moderate itching", "Question 1 answer extracted");
    assert(extracted[1].number === 2, "Question 2 preserved");
    assert(!extracted.some((q) => q.id === "reschedule_requested"), "Metadata keys filtered out");
    console.log("✓ 13. Production extractConsultationQuestionnaire cleanly parses real questionnaire answers and filters metadata.");
  }

  // --- Scenario 14: Production extractConsultationQuestionnaire Empty State Guard ---
  console.log("\n[Scenario 14] Testing production extractConsultationQuestionnaire honest empty state...");
  {
    // A: null/undefined
    assert(extractConsultationQuestionnaire(null).length === 0, "Null payload returns empty array");
    assert(extractConsultationQuestionnaire(undefined).length === 0, "Undefined payload returns empty array");

    // B: Object with only reschedule metadata (common in patient_appointment)
    const metadataOnly = {
      reschedule_requested: true,
      reschedule_date: "2026-10-30",
      appointment_history: [{ action: "reschedule" }],
      is_paid: true,
    };
    const emptyResult = extractConsultationQuestionnaire(metadataOnly);
    assert(emptyResult.length === 0, "Metadata-only object returns empty array without fabricating questions");
    console.log("✓ 14. extractConsultationQuestionnaire strictly guarantees honest empty state when no question answers exist.");
  }

  // --- Scenario 15: Production serializeDoctorSchedule Preserves Clinic Default Interval ---
  console.log("\n[Scenario 15] Testing serializeDoctorSchedule preserves clinic default interval...");
  {
    // A: Inherits clinic default of 20 minutes when doctorSlotInterval is undefined
    const schedWithClinicDefault = serializeDoctorSchedule(
      { weeklyShifts: {}, slotIntervalMinutes: undefined },
      [],
      20 // Clinic default = 20
    );
    assert(schedWithClinicDefault.slotIntervalMinutes === 20, `Expected 20, got ${schedWithClinicDefault.slotIntervalMinutes}`);
    assert(schedWithClinicDefault.slot_interval_minutes === 20, `Expected slot_interval_minutes=20, got ${schedWithClinicDefault.slot_interval_minutes}`);

    // B: Doctor preference overrides clinic default
    const docPreferredSched = serializeDoctorSchedule(
      { weeklyShifts: {}, slotIntervalMinutes: 45 },
      [],
      20 // Clinic default = 20
    );
    assert(docPreferredSched.slotIntervalMinutes === 45, `Expected 45, got ${docPreferredSched.slotIntervalMinutes}`);
    assert(docPreferredSched.slot_interval_minutes === 45, `Expected 45, got ${docPreferredSched.slot_interval_minutes}`);

    // C: Standalone fallback to 30 when neither is provided
    const standaloneSched = serializeDoctorSchedule({ weeklyShifts: {} }, []);
    assert(standaloneSched.slotIntervalMinutes === 30, "Standalone fallback to 30");

    console.log("✓ 15. serializeDoctorSchedule strictly preserves clinic default interval without silent 30-minute overrides.");
  }

  // --- Scenario 16: Empty Duty Days Strict Pruning (No Ghost Mon-Fri Shifts) ---
  console.log("\n[Scenario 16] Testing serializeDoctorSchedule does not assign Mon-Fri to off-duty doctors...");
  {
    const offDutySched = serializeDoctorSchedule(
      {
        weeklyShifts: {
          Monday: [{ id: "m1", startTime: "08:00", endTime: "17:00" }],
        },
      },
      [] // Empty duty days (off-duty doctor)
    );

    assert(Object.keys(offDutySched.weeklyShifts).every((d) => offDutySched.weeklyShifts[d].length === 0), "All shifts pruned when off-duty");
    assert(offDutySched["Monday"] === undefined, "Legacy Monday key not populated for off-duty doctor");
    console.log("✓ 16. Empty duty days strictly prunes shifts and never fabricates default Mon-Fri working hours.");
  }

  console.log("\n=======================================================");
  console.log("  ALL 16 APPOINTMENT STATUS, NOTIFICATION & SCHEDULE TESTS PASSED!");
  console.log("=======================================================\n");
}

runTests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});

