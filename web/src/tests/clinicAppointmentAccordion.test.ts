import assert from "node:assert/strict";

console.log("\n=======================================================");
console.log("DermAI — Clinic Appointment Accordion Logic Test Suite");
console.log("=======================================================\n");

// Test helper simulating the accordion state reducer logic used in ClinicPatientsPage
class AccordionStateController {
  private expandedMap: Record<string, boolean> = {};

  constructor(initialAppointments: Array<{ id: string }>) {
    this.resetForPatient(initialAppointments);
  }

  resetForPatient(appointments: Array<{ id: string }>) {
    if (appointments && appointments.length > 0) {
      // Default the newest appointment (first in list) to expanded, older ones collapsed
      this.expandedMap = {
        [appointments[0].id]: true,
      };
    } else {
      this.expandedMap = {};
    }
  }

  isExpanded(apptId: string): boolean {
    return Boolean(this.expandedMap[apptId]);
  }

  toggle(apptId: string) {
    this.expandedMap[apptId] = !this.expandedMap[apptId];
  }

  expandAll(appointments: Array<{ id: string }>) {
    const next: Record<string, boolean> = {};
    appointments.forEach((a) => {
      next[a.id] = true;
    });
    this.expandedMap = next;
  }

  collapseAll() {
    this.expandedMap = {};
  }

  allExpanded(appointments: Array<{ id: string }>): boolean {
    return appointments.length > 0 && appointments.every((a) => this.expandedMap[a.id]);
  }
}

// ── Test 1: Single Appointment Patient ──
console.log("[Test 1] Testing single-appointment patient default state & toggling...");
{
  const patientAppts = [{ id: "appt-single-101" }];
  const accordion = new AccordionStateController(patientAppts);

  assert.equal(accordion.isExpanded("appt-single-101"), true, "Single appointment defaults to expanded");

  // Toggle to collapsed
  accordion.toggle("appt-single-101");
  assert.equal(accordion.isExpanded("appt-single-101"), false, "Single appointment collapses when clicked");

  // Toggle back to expanded
  accordion.toggle("appt-single-101");
  assert.equal(accordion.isExpanded("appt-single-101"), true, "Single appointment re-expands when clicked");
  console.log("  ✓ Test 1 Passed: Single appointment patient initializes expanded and toggles cleanly.");
}

// ── Test 2: Multi-Appointment Patient ──
console.log("[Test 2] Testing multi-appointment patient default state (newest expanded, older collapsed)...");
{
  const patientAppts = [
    { id: "appt-visit-3" }, // Most recent
    { id: "appt-visit-2" },
    { id: "appt-visit-1" },
  ];
  const accordion = new AccordionStateController(patientAppts);

  assert.equal(accordion.isExpanded("appt-visit-3"), true, "Newest appointment defaults to expanded");
  assert.equal(accordion.isExpanded("appt-visit-2"), false, "Older visit 2 defaults to collapsed");
  assert.equal(accordion.isExpanded("appt-visit-1"), false, "Older visit 1 defaults to collapsed");

  // Expand visit 2
  accordion.toggle("appt-visit-2");
  assert.equal(accordion.isExpanded("appt-visit-3"), true, "Visit 3 remains expanded");
  assert.equal(accordion.isExpanded("appt-visit-2"), true, "Visit 2 is now expanded");
  assert.equal(accordion.isExpanded("appt-visit-1"), false, "Visit 1 remains collapsed");

  // Collapse visit 3
  accordion.toggle("appt-visit-3");
  assert.equal(accordion.isExpanded("appt-visit-3"), false, "Visit 3 is now collapsed");
  assert.equal(accordion.isExpanded("appt-visit-2"), true, "Visit 2 remains expanded");
  console.log("  ✓ Test 2 Passed: Multi-appointment patient expands newest by default; individual toggles operate independently.");
}

// ── Test 3: Expand All & Collapse All ──
console.log("[Test 3] Testing Expand All and Collapse All batch actions...");
{
  const patientAppts = [
    { id: "appt-a" },
    { id: "appt-b" },
    { id: "appt-c" },
  ];
  const accordion = new AccordionStateController(patientAppts);

  assert.equal(accordion.allExpanded(patientAppts), false, "Not all appointments are expanded initially");

  // Trigger Expand All
  accordion.expandAll(patientAppts);
  assert.equal(accordion.allExpanded(patientAppts), true, "All appointments marked expanded");
  assert.equal(accordion.isExpanded("appt-a"), true);
  assert.equal(accordion.isExpanded("appt-b"), true);
  assert.equal(accordion.isExpanded("appt-c"), true);

  // Trigger Collapse All
  accordion.collapseAll();
  assert.equal(accordion.allExpanded(patientAppts), false, "All appointments marked collapsed");
  assert.equal(accordion.isExpanded("appt-a"), false);
  assert.equal(accordion.isExpanded("appt-b"), false);
  assert.equal(accordion.isExpanded("appt-c"), false);
  console.log("  ✓ Test 3 Passed: Expand All / Collapse All operate reliably on all appointments.");
}

// ── Test 4: Switching Patients Resets Accordion Deterministically ──
console.log("[Test 4] Testing that opening a new patient cleanly resets accordion state to their newest visit...");
{
  const patient1Appts = [{ id: "p1-appt-1" }, { id: "p1-appt-2" }];
  const accordion = new AccordionStateController(patient1Appts);

  // Manipulate patient 1
  accordion.expandAll(patient1Appts);
  assert.equal(accordion.isExpanded("p1-appt-2"), true);

  // Open patient 2
  const patient2Appts = [{ id: "p2-appt-new" }, { id: "p2-appt-old" }];
  accordion.resetForPatient(patient2Appts);

  assert.equal(accordion.isExpanded("p2-appt-new"), true, "Patient 2 newest appointment is expanded");
  assert.equal(accordion.isExpanded("p2-appt-old"), false, "Patient 2 older appointment is collapsed");
  assert.equal(accordion.isExpanded("p1-appt-2"), false, "Patient 1 state cleared");
  console.log("  ✓ Test 4 Passed: Switching patients resets accordion state without cross-patient state leaks.");
}

// ── Test 5: Unique Database Identifier Keying (No Index Assumptions) ──
console.log("[Test 5] Testing UUID & database identifier key safety...");
{
  const realUuids = [
    { id: "c18a2879-1f48-4cb3-a65c-61d054dbe4b7" },
    { id: "e903fbf8-5cc7-448a-bcba-bc4878a87b92" },
  ];
  const accordion = new AccordionStateController(realUuids);

  assert.equal(accordion.isExpanded("c18a2879-1f48-4cb3-a65c-61d054dbe4b7"), true);
  assert.equal(accordion.isExpanded("e903fbf8-5cc7-448a-bcba-bc4878a87b92"), false);

  accordion.toggle("e903fbf8-5cc7-448a-bcba-bc4878a87b92");
  assert.equal(accordion.isExpanded("e903fbf8-5cc7-448a-bcba-bc4878a87b92"), true);
  console.log("  ✓ Test 5 Passed: State relies strictly on appointment database UUIDs rather than array indices.");
}

console.log("\n=======================================================");
console.log("ALL 5 ACCORDION LOGIC TESTS PASSED SUCCESSFULLY!");
console.log("=======================================================\n");

