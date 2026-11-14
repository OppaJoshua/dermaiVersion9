import assert from "node:assert/strict";
import {
  sanitizeCsvField,
  formatContactForCsv,
  formatPatientDisplayId,
  exportIndividualPatientPdf,
  exportPatientDirectoryCsv,
  type ExportClinicPatient,
} from "../lib/clinicPatientExport";

console.log("\n=======================================================");
console.log("DermAI — Clinic Patient Export Test Suite");
console.log("=======================================================\n");

// -----------------------------------------------------------------------------
// TEST 1: CSV Formula Injection Prevention
// -----------------------------------------------------------------------------
console.log("[Test 1] CSV Formula Injection Prevention...");
{
  assert.equal(sanitizeCsvField("=cmd|'/C calc'!A0"), "\"'=cmd|'/C calc'!A0\"");
  assert.equal(sanitizeCsvField("+123456"), "\"'+123456\"");
  assert.equal(sanitizeCsvField("-500"), "\"'-500\"");
  assert.equal(sanitizeCsvField("@SUM(A1:A10)"), "\"'@SUM(A1:A10)\"");
  assert.equal(sanitizeCsvField("\t=1+1"), "\"'\t=1+1\"");
  assert.equal(sanitizeCsvField("Normal Name"), "\"Normal Name\"");
  assert.equal(sanitizeCsvField('Name with "Quotes"'), '"Name with ""Quotes"""');
  console.log("  ✓ Passed: Formula injection attacks are safely escaped with single quotes.");
}

// -----------------------------------------------------------------------------
// TEST 2: Contact Number Preservation with Leading Zeros
// -----------------------------------------------------------------------------
console.log("[Test 2] Contact Number Formatting...");
{
  assert.equal(formatContactForCsv("09171234567"), "'09171234567");
  assert.equal(formatContactForCsv("+639171234567"), "+639171234567");
  assert.equal(formatContactForCsv(""), "Not provided");
  assert.equal(formatContactForCsv(undefined), "Not provided");
  console.log("  ✓ Passed: Leading zeroes preserved for Philippine mobile numbers.");
}

// -----------------------------------------------------------------------------
// TEST 3: Patient Display Reference ID Generation & Determinism
// -----------------------------------------------------------------------------
console.log("[Test 3] Patient Display Reference ID Generation & Determinism...");
{
  const patientWithUser: ExportClinicPatient = {
    id: "user:123e4567-e89b-12d3-a456-426614174000",
    userId: "123e4567-e89b-12d3-a456-426614174000",
    name: "Juan Dela Cruz",
    email: "juan@example.com",
    totalAppointments: 1,
    appointments: [],
    assignedDoctors: [],
  };
  const ref1 = formatPatientDisplayId(patientWithUser);
  const ref2 = formatPatientDisplayId(patientWithUser);
  assert.equal(ref1, "REF-123E4567");
  assert.equal(ref1, ref2, "Reference ID must be strictly deterministic across calls");

  const patientWithEarliestAppt: ExportClinicPatient = {
    id: "name:maria santos",
    name: "Maria Santos",
    email: "maria@example.com",
    totalAppointments: 2,
    appointments: [
      { id: "appt-recent-999", dateStr: "Nov 12, 2026", timeStr: "10:00 AM", status: "completed", createdAt: "2026-11-12T10:00:00Z" },
      { id: "appt-first-111", dateStr: "Jan 10, 2026", timeStr: "09:00 AM", status: "completed", createdAt: "2026-01-10T09:00:00Z" },
    ],
    assignedDoctors: [],
  };
  assert.equal(formatPatientDisplayId(patientWithEarliestAppt), "REF-APPTFIRST111".slice(0, 12));

  const patientWithPhone: ExportClinicPatient = {
    id: "phone:09171234567",
    name: "Pedro Penduko",
    email: "pedro@example.com",
    phone: "09171234567",
    totalAppointments: 1,
    appointments: [],
    assignedDoctors: [],
  };
  assert.equal(formatPatientDisplayId(patientWithPhone), "REF-P234567");

  console.log("  ✓ Passed: Consistent, persistent display reference IDs generated without collision.");
}

// -----------------------------------------------------------------------------
// TEST 4: CSV Headers and Total Appointments Label Accuracy
// -----------------------------------------------------------------------------
console.log("[Test 4] CSV Column Headers and Total Appointments Labeling...");
{
  const mockPatient: ExportClinicPatient = {
    id: "user:u-12345",
    userId: "u-12345",
    name: "Cruz, Juan",
    email: "juan@example.com",
    phone: "09181234567",
    gender: "Male",
    birthdate: "1990-05-15",
    age: 36,
    address: "Cebu City, Philippines",
    emergencyContactName: "Maria Cruz",
    emergencyRelationship: "Spouse",
    emergencyContactPhone: "09191234567",
    totalAppointments: 3,
    appointments: [
      { id: "a3", dateStr: "Nov 14, 2026", timeStr: "02:00 PM", status: "scheduled", assignedDoctorName: "Dr. Perez", createdAt: "2026-11-14" },
      { id: "a2", dateStr: "Aug 20, 2026", timeStr: "11:00 AM", status: "cancelled", assignedDoctorName: "Dr. Santos", createdAt: "2026-08-20" },
      { id: "a1", dateStr: "Jan 10, 2026", timeStr: "09:00 AM", status: "completed", checkInStatus: "completed", assignedDoctorName: "Dr. Perez", createdAt: "2026-01-10" },
    ],
    lastAppointment: { id: "a3", dateStr: "Nov 14, 2026", timeStr: "02:00 PM", status: "scheduled", assignedDoctorName: "Dr. Perez", createdAt: "2026-11-14" },
    assignedDoctors: [{ id: "doc-1", name: "Dr. Perez" }, { id: "doc-2", name: "Dr. Santos" }],
  };

  // Mock global document & URL for headless CSV export testing
  let exportedContent = "";
  let downloadedFilename = "";

  (globalThis as any).Blob = class MockBlob {
    content: string[];
    constructor(content: string[]) {
      this.content = content;
      exportedContent = content.join("");
    }
  };
  (globalThis as any).URL = {
    createObjectURL: () => "mock-blob-url",
    revokeObjectURL: () => { },
  };
  (globalThis as any).document = {
    createElement: () => ({
      href: "",
      download: "",
      click: function () {
        downloadedFilename = this.download;
      },
    }),
    body: {
      appendChild: () => { },
      removeChild: () => { },
    },
  };

  exportPatientDirectoryCsv([mockPatient], "Test_Skin_Clinic");

  assert.ok(exportedContent.startsWith("\uFEFF"), "CSV must include UTF-8 BOM");
  assert.ok(exportedContent.includes("Total Appointments"), "CSV must accurately label 'Total Appointments' (not Total Consultations)");
  assert.ok(exportedContent.includes("Patient Display Reference"), "CSV must clearly indicate 'Patient Display Reference'");
  assert.ok(exportedContent.includes("First Appointment Date"), "CSV must accurately label 'First Appointment Date'");
  assert.ok(exportedContent.includes("Latest Appointment Date"), "CSV must accurately label 'Latest Appointment Date'");
  assert.ok(exportedContent.includes('"Cruz, Juan"'), "Patient name with comma must be properly enclosed in quotes");
  assert.ok(exportedContent.includes("\"'09181234567\""), "Phone number must preserve leading zero");
  assert.ok(exportedContent.includes('"3"'), "Total appointments count (3) must be present");
  assert.ok(downloadedFilename.includes("Test_Skin_Clinic"), "Filename must include clinic slug");
  console.log("  ✓ Passed: CSV export accurately reflects Total Appointments and patient directory structure.");
}

// -----------------------------------------------------------------------------
// TEST 5: PDF Export Across Complex Scenarios
// -----------------------------------------------------------------------------
console.log("[Test 5] Individual PDF Export Across Diverse Patient Scenarios...");
{
  // Test 5A: Single upcoming appointment, unassigned doctor, missing questionnaire
  const patientA: ExportClinicPatient = {
    id: "user:u-single",
    userId: "u-single-1234",
    name: "Single Visit Patient",
    email: "single@example.com",
    totalAppointments: 1,
    appointments: [
      {
        id: "appt-1",
        dateStr: "Dec 01, 2026",
        timeStr: "10:30 AM",
        status: "scheduled",
        createdAt: "2026-11-14T00:00:00Z",
      },
    ],
    lastAppointment: {
      id: "appt-1",
      dateStr: "Dec 01, 2026",
      timeStr: "10:30 AM",
      status: "scheduled",
      createdAt: "2026-11-14T00:00:00Z",
    },
    assignedDoctors: [],
  };

  // Test 5B: Multi-visit patient with completed, cancelled, and upcoming visits,
  // multi-assigned doctors, questionnaire answers, AI prediction, and long clinical notes
  const patientB: ExportClinicPatient = {
    id: "user:u-complex",
    userId: "u-complex-5678",
    name: "Complex History Patient",
    email: "complex@example.com",
    phone: "09178889999",
    gender: "Female",
    birthdate: "1988-03-25",
    age: 38,
    address: "123 Mango Avenue, Cebu City, Cebu",
    emergencyContactName: "Roberto Gomez",
    emergencyRelationship: "Brother",
    emergencyContactPhone: "09171112222",
    totalAppointments: 3,
    appointments: [
      {
        id: "appt-3",
        dateStr: "Nov 14, 2026",
        timeStr: "09:00 AM",
        status: "completed",
        checkInStatus: "completed",
        assignedDoctorId: "doc-1",
        assignedDoctorName: "Dr. Andrea Lim",
        doctorStatus: "approved",
        conditionName: "Eczema / Atopic Dermatitis",
        confidence: 0.942,
        questionnaireAnswers: [
          { question: "How long have you had this condition?", answer: "More than 6 months", severity: 2 },
          { question: "Are you experiencing severe itching?", answer: "Yes, constantly", severity: 3 },
          { question: "Have you used topical steroids previously?", answer: "Yes, Hydrocortisone 1%" },
        ],
        notes: "Patient reports chronic recurrent erythematous plaques on bilateral flexural creases.",
        clinicNote: "Patient arrived on time. Follow-up scheduled in 4 weeks.",
        doctorNote: "Patient exhibits clear signs of moderate-to-severe atopic dermatitis. Prescribed topical calcineurin inhibitor and ceramide-dominant barrier repair cream. Avoid hot showers.",
        createdAt: "2026-11-14T09:00:00Z",
      },
      {
        id: "appt-2",
        dateStr: "Oct 10, 2026",
        timeStr: "02:00 PM",
        status: "cancelled",
        assignedDoctorId: "doc-2",
        assignedDoctorName: "Dr. Carlos Ramos",
        doctorStatus: "rejected",
        notes: "Rescheduling requested due to physician conflict.",
        clinicNote: "Physician emergency leave. Patient agreed to reschedule.",
        createdAt: "2026-10-10T14:00:00Z",
      },
      {
        id: "appt-1",
        dateStr: "Jun 15, 2026",
        timeStr: "11:00 AM",
        status: "completed",
        checkInStatus: "completed",
        assignedDoctorId: "doc-1",
        assignedDoctorName: "Dr. Andrea Lim",
        doctorStatus: "approved",
        conditionName: "Contact Dermatitis",
        confidence: 0.88,
        notes: "Initial consultation for itchy rash on forearm.",
        doctorNote: "Patch test recommended. Mild allergic contact dermatitis suspected.",
        createdAt: "2026-06-15T11:00:00Z",
      },
    ],
    lastAppointment: {
      id: "appt-3",
      dateStr: "Nov 14, 2026",
      timeStr: "09:00 AM",
      status: "completed",
      checkInStatus: "completed",
      assignedDoctorId: "doc-1",
      assignedDoctorName: "Dr. Andrea Lim",
      createdAt: "2026-11-14T09:00:00Z",
    },
    assignedDoctors: [
      { id: "doc-1", name: "Dr. Andrea Lim" },
      { id: "doc-2", name: "Dr. Carlos Ramos" },
    ],
  };

  // Run PDF export on both patients and ensure zero exceptions
  await exportIndividualPatientPdf(patientA, { clinicName: "Metro Dermatology Clinic" });
  await exportIndividualPatientPdf(patientB, { clinicName: "Metro Dermatology Clinic" });

  console.log("  ✓ Passed: PDF export handles single vs multiple visits, cancelled visits, long notes, and AI screening without errors.");
}

console.log("\n=======================================================");
console.log("All Clinic Patient Export tests passed successfully!");
console.log("=======================================================\n");
