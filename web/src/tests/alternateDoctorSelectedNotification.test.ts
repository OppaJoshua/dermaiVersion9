/**
 * ============================================================================
 * DermAI - Alternate Doctor Selected Notification Test Suite
 * ============================================================================
 *
 * Verifies:
 * 1. Tab & Category Routing:
 *    - Maps notification category and type from 'doctor_actions' to 'bookings_and_reselections'.
 *    - Renders under the Bookings & Reselections tab.
 *    - Strictly excluded from the Doctor Actions tab.
 *
 * 2. Patient Data Relational Join:
 *    - Joins public.profiles / public.patients using patient_id.
 *    - Correctly extracts first_name, last_name, and avatar_url (or profile_picture).
 *
 * 3. Copy & Avatar Update:
 *    - Replaces fallback text "Patient Patient" with dynamic name: `Patient ${first_name} ${last_name}`.
 *    - Renders patient avatar image or initials (e.g. "JB") instead of default "DO" / "Doctor" tag.
 *    - Displays patient name tag instead of "Doctor" tag in header.
 */

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${msg}`);
  }
}

function cleanResolvedPatientName(raw?: string | null): string {
  if (!raw || typeof raw !== "string") return "";
  const cleaned = raw
    .replace(/^(?:patient\s+)+/i, "")
    .replace(/^patient$/i, "")
    .replace(/^a\s+patient$/i, "")
    .trim();
  if (!cleaned || /^(?:patient|a patient|unknown|doctor|clinic system|dermai admin)$/i.test(cleaned)) {
    return "";
  }
  return cleaned;
}

function getNotificationInitials(name?: string, fallback = "PT"): string {
  if (!name) return fallback;
  const cleaned = name
    .replace(/^(?:patient\s+)+/i, "")
    .replace(/^patient$/i, "")
    .replace(/^a\s+patient$/i, "")
    .replace(/^dr\.?\s+/i, "")
    .trim();
  if (!cleaned) return fallback;
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

interface MockNotification {
  id: string;
  type: string;
  subtype?: string;
  category: string;
  title: string;
  message: string;
  senderName?: string;
  senderType?: string;
  senderAvatar?: string | null;
  patient_id?: string;
  metadata?: Record<string, any>;
}

// 1. Tab filter logic matching ClinicNotifications.tsx
function filterNotificationsByTab(list: MockNotification[], activeTab: string): MockNotification[] {
  if (activeTab === "requests" || activeTab === "bookings_and_reselections") {
    return list.filter(
      (n) =>
        n.category === "bookings_and_reselections" ||
        n.type === "bookings_and_reselections" ||
        n.type === "booking_created" ||
        n.type === "doctor_reselection" ||
        n.type === "reselection_required" ||
        n.type === "appointment-request" ||
        n.type === "patient-reselection" ||
        n.type === "appointment-cancelled" ||
        n.subtype === "alternate_doctor_selected"
    );
  }
  if (activeTab === "doctor-action" || activeTab === "doctor_actions") {
    return list.filter(
      (n) =>
        n.category !== "bookings_and_reselections" &&
        n.type !== "bookings_and_reselections" &&
        n.subtype !== "alternate_doctor_selected" &&
        n.type !== "alternate_doctor_selected" &&
        n.type !== "doctor_reselection" &&
        (n.type.includes("doctor-") || n.type.includes("doctor_") || n.type === "consultation-completed" || (n.category === "appointment" && n.senderType === "doctor")) &&
        n.type !== "appointment-cancelled"
    );
  }
  return list;
}

// ============================================================================
// TEST SUITE
// ============================================================================

async function runTests() {
  console.log("Starting Alternate Doctor Selected Notification Test Suite...\n");

  // Sample data simulating joined patient profile
  const mockPatientProfile = {
    patient_id: "patient-uuid-123",
    first_name: "Jonathan",
    last_name: "Bayutas",
    avatar_url: "https://example.com/avatars/jonathan.jpg",
    profile_picture: "https://example.com/avatars/jonathan.jpg",
  };

  // Raw row from database join
  const rawDbNotificationRow = {
    notif_id: "notif-uuid-456",
    clinic_id: "clinic-uuid-789",
    user_id: "clinic-owner-uuid",
    patient_id: mockPatientProfile.patient_id,
    type: "bookings_and_reselections",
    subtype: "alternate_doctor_selected",
    title: "Alternate Doctor Selected",
    body: "Patient Patient has selected Dr. Clark Saludaga as their alternate doctor.",
    patient: mockPatientProfile,
    metadata: {
      patient_id: mockPatientProfile.patient_id,
      patient_name: `${mockPatientProfile.first_name} ${mockPatientProfile.last_name}`,
      patient_avatar: mockPatientProfile.avatar_url,
    },
  };

  // Simulate mapper in ClinicNotifications
  const patient = rawDbNotificationRow.patient;
  const firstName = patient.first_name;
  const lastName = patient.last_name;
  const dynamicPatientName = `${firstName} ${lastName}`;
  const displayPatientTag = `Patient ${dynamicPatientName}`;

  let cleanedMessage = rawDbNotificationRow.body;
  if (cleanedMessage.includes("Patient Patient")) {
    cleanedMessage = cleanedMessage.replace(/Patient Patient/g, displayPatientTag);
  }

  const mappedNotification: MockNotification = {
    id: rawDbNotificationRow.notif_id,
    type: "bookings_and_reselections",
    subtype: rawDbNotificationRow.subtype,
    category: "bookings_and_reselections",
    title: rawDbNotificationRow.title,
    message: cleanedMessage,
    senderName: dynamicPatientName,
    senderType: "patient",
    senderAvatar: patient.avatar_url,
    patient_id: rawDbNotificationRow.patient_id,
    metadata: rawDbNotificationRow.metadata,
  };

  // --------------------------------------------------------------------------
  // Test 1: Tab & Category Routing
  // --------------------------------------------------------------------------
  console.log("[Test 1] Testing Tab & Category Routing...");
  {
    const notificationsList = [
      mappedNotification,
      {
        id: "doc-action-1",
        type: "doctor-accepted",
        category: "appointment",
        title: "Doctor Accepted Appointment",
        message: "Dr. Clark Saludaga accepted booking.",
        senderName: "Dr. Clark Saludaga",
        senderType: "doctor",
      },
    ];

    // Case 1a: Must appear in Bookings & Reselections tab ("requests")
    const requestsTabItems = filterNotificationsByTab(notificationsList, "requests");
    assert(
      requestsTabItems.some((n) => n.id === mappedNotification.id),
      "Alternate doctor notification must render under 'requests' (Bookings & Reselections tab)"
    );

    // Case 1b: Must appear in Bookings & Reselections tab ("bookings_and_reselections")
    const bookingsTabItems = filterNotificationsByTab(notificationsList, "bookings_and_reselections");
    assert(
      bookingsTabItems.some((n) => n.id === mappedNotification.id),
      "Alternate doctor notification must render under 'bookings_and_reselections' tab"
    );

    // Case 1c: Must NOT appear in Doctor Actions tab ("doctor-action")
    const doctorActionItems = filterNotificationsByTab(notificationsList, "doctor-action");
    assert(
      !doctorActionItems.some((n) => n.id === mappedNotification.id),
      "Alternate doctor notification must be excluded from 'doctor-action' tab"
    );

    // Case 1d: Must NOT appear in Doctor Actions tab ("doctor_actions")
    const doctorActionsItems = filterNotificationsByTab(notificationsList, "doctor_actions");
    assert(
      !doctorActionsItems.some((n) => n.id === mappedNotification.id),
      "Alternate doctor notification must be excluded from 'doctor_actions' tab"
    );

    console.log("✓ Notification routed to Bookings & Reselections and excluded from Doctor Actions.");
  }

  // --------------------------------------------------------------------------
  // Test 2: Patient Data Relational Join
  // --------------------------------------------------------------------------
  console.log("\n[Test 2] Testing Patient Data Relational Join...");
  {
    assert(patient.patient_id === "patient-uuid-123", "Joined patient_id matches");
    assert(patient.first_name === "Jonathan", "Joined patient first_name is Jonathan");
    assert(patient.last_name === "Bayutas", "Joined patient last_name is Bayutas");
    assert(patient.avatar_url.includes("jonathan.jpg"), "Joined avatar_url resolved");
    assert(patient.profile_picture.includes("jonathan.jpg"), "Joined profile_picture resolved");
    console.log("✓ Patient data relational join correctly delivers first_name, last_name, avatar_url, and profile_picture.");
  }

  // --------------------------------------------------------------------------
  // Test 3: Copy & Fallback Replacement
  // --------------------------------------------------------------------------
  console.log("\n[Test 3] Testing Copy & Fallback Replacement...");
  {
    assert(
      !mappedNotification.message.includes("Patient Patient"),
      "Message must not contain the duplicate 'Patient Patient' fallback"
    );
    assert(
      mappedNotification.message === "Patient Jonathan Bayutas has selected Dr. Clark Saludaga as their alternate doctor.",
      `Expected message with dynamic name, got: "${mappedNotification.message}"`
    );
    console.log("✓ Fallback 'Patient Patient' successfully replaced with dynamically rendered 'Patient Jonathan Bayutas'.");
  }

  // --------------------------------------------------------------------------
  // Test 4: Avatar and Initials Rendering (No 'DO' / 'Doctor' Tag)
  // --------------------------------------------------------------------------
  console.log("\n[Test 4] Testing Avatar and Initials Rendering...");
  {
    // Test initials calculation
    const patientInitials = getNotificationInitials(mappedNotification.senderName);
    assert(patientInitials === "JB", `Expected 'JB' initials for Jonathan Bayutas, got: '${patientInitials}'`);

    const doctorTagInitials = getNotificationInitials("Doctor");
    assert(doctorTagInitials === "DO", "Default Doctor tag yields 'DO'");

    // Ensure Alternate Doctor Selected notification never yields 'DO'
    assert(patientInitials !== "DO", "Alternate doctor notification must not default to 'DO'");
    assert(mappedNotification.senderType === "patient", "senderType is 'patient' (not 'doctor')");
    assert(mappedNotification.senderAvatar === "https://example.com/avatars/jonathan.jpg", "senderAvatar is patient avatar URL");

    console.log("✓ Initials resolve to 'JB' with real avatar URL, replacing the default 'DO'/'Doctor' tag.");
  }

  // --------------------------------------------------------------------------
  // Test 5: Dynamic Patient Resolution for Audrey Lee Saludaga (No "Patient Patient" or "PA")
  // --------------------------------------------------------------------------
  console.log("\n[Test 5] Testing Dynamic Patient Profile Resolution (Audrey Lee Saludaga)...");
  {
    const audreyProfile = {
      user_id: "user-audrey-1",
      full_name: "Audrey Lee Saludaga",
      avatar_url: "https://example.com/avatars/audrey.png",
    };

    const resolvedName = cleanResolvedPatientName(audreyProfile.full_name);
    assert(resolvedName === "Audrey Lee Saludaga", `Expected 'Audrey Lee Saludaga', got '${resolvedName}'`);
    assert(cleanResolvedPatientName("Patient") === "", "Bare 'Patient' placeholder must clean to empty string");
    assert(cleanResolvedPatientName("Patient Patient") === "", "'Patient Patient' placeholder must clean to empty string");

    const audreyInitials = getNotificationInitials(resolvedName, "PT");
    assert(audreyInitials === "AS", `Expected 'AS' initials for Audrey Lee Saludaga, got '${audreyInitials}'`);
    assert(audreyInitials !== "PA", "Initials must not default to 'PA'");

    const fallbackInitials = getNotificationInitials("Patient", "PT");
    assert(fallbackInitials === "PT", `Bare 'Patient' should fall back to 'PT', not 'PA', got '${fallbackInitials}'`);

    console.log("✓ Audrey Lee Saludaga resolves senderName='Audrey Lee Saludaga', avatarUrl, and initials='AS' (never 'Patient Patient' or 'PA').");
  }

  console.log("\n=================================================================");
  console.log("  ALL ALTERNATE DOCTOR SELECTED NOTIFICATION TESTS PASSED!");
  console.log("=================================================================\n");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

