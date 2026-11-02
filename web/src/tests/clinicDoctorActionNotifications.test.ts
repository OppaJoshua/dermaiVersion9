/**
 * ============================================================================
 * DermAI - Clinic Doctor Actions Notification Enrichment & Pre-Hydration Test
 * ============================================================================
 */

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${msg}`);
  }
}

function formatDoctorSenderName(raw?: string | null): string {
  if (!raw || typeof raw !== "string") return "";
  const cleaned = raw.replace(/^(?:dr\.?|doctor)\s+/i, "").trim();
  if (!cleaned || /^(?:doctor|assigned doctor|attending doctor|unknown|dr)$/i.test(cleaned)) {
    return "";
  }
  return `Dr. ${cleaned}`;
}

function getNotificationInitials(name?: string, fallback = "DR"): string {
  if (!name) return fallback;
  const cleaned = name
    .replace(/^(?:patient\s+)+/i, "")
    .replace(/^patient$/i, "")
    .replace(/^a\s+patient$/i, "")
    .replace(/^(?:dr\.?|doctor)\s+/i, "")
    .trim();
  if (!cleaned || /^(?:doctor|assigned doctor|attending doctor|unknown)$/i.test(cleaned)) return fallback;
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

async function runTests() {
  console.log("Starting Clinic Doctor Actions Notification Test Suite...\n");

  const mockDoctors = [
    {
      doctor_id: "doc-clark-1",
      user_id: "user-clark-1",
      doctor_name: "Clark Saludaga",
      photo_url: "https://example.com/avatars/dr-clark.png",
    },
    {
      doctor_id: "doc-audrey-2",
      user_id: "user-audrey-2",
      doctor_name: "AUDREY LEE SALUDAGA",
      photo_url: null,
    },
  ];

  const mockUserProfiles = [
    {
      user_id: "user-clark-1",
      full_name: "Clark Saludaga",
      avatar_url: "https://example.com/avatars/dr-clark.png",
    },
    {
      user_id: "user-audrey-2",
      full_name: "AUDREY LEE SALUDAGA",
      avatar_url: "https://example.com/avatars/dr-audrey.png",
    },
  ];

  // Build lookup maps matching fetchClinicNotifications
  const doctorProfileById = new Map<string, { fullName: string; avatarUrl?: string }>();
  const doctorProfileByName = new Map<string, { fullName: string; avatarUrl?: string }>();

  mockDoctors.forEach((cd) => {
    const linkedUser = mockUserProfiles.find((u) => u.user_id === cd.user_id);
    const fullName = formatDoctorSenderName(cd.doctor_name || linkedUser?.full_name);
    const avatarUrl = cd.photo_url || linkedUser?.avatar_url || undefined;
    doctorProfileById.set(cd.doctor_id, { fullName, avatarUrl });
    doctorProfileById.set(cd.user_id, { fullName, avatarUrl });
    const norm = (cd.doctor_name || "").toLowerCase();
    doctorProfileByName.set(norm, { fullName, avatarUrl });
    doctorProfileByName.set(norm.split(/\s+/)[0], { fullName, avatarUrl });
  });

  // 1. Test Doctor Accepted Appointment notification enrichment
  console.log("[Test 1] Doctor Accepted Appointment Enrichment...");
  {
    const rawAcceptedNotif = {
      notif_id: "notif-accept-1",
      type: "appointment",
      subtype: "doctor-accepted",
      title: "Doctor Accepted Appointment",
      body: "Dr. Clark accepted the consultation request for Jonathan Bayutas.",
      metadata: {
        appointment_id: "appt-1",
        doctor_id: "doc-clark-1",
        doctor_name: "Clark",
        link: "/clinic/appointments",
      },
    };

    const byId = doctorProfileById.get(rawAcceptedNotif.metadata.doctor_id);
    const senderName = formatDoctorSenderName(rawAcceptedNotif.metadata.doctor_name) || byId?.fullName || "Dr. Attending Doctor";
    const senderAvatar = byId?.avatarUrl;

    assert(senderName === "Dr. Clark", `Expected 'Dr. Clark', got '${senderName}'`);
    assert(senderAvatar === "https://example.com/avatars/dr-clark.png", `Expected Dr. Clark avatar URL, got '${senderAvatar}'`);
    assert(rawAcceptedNotif.metadata.link === "/clinic/appointments", "Navigation link preserved");
    console.log("✓ 'Doctor Accepted Appointment' resolves senderName='Dr. Clark' and senderAvatar URL.");
  }

  // 2. Test Doctor Declined Appointment notification enrichment (joining user.avatar_url when clinic_doctor.photo_url is null)
  console.log("\n[Test 2] Doctor Declined Appointment Profile Join Enrichment...");
  {
    const rawDeclinedNotif = {
      notif_id: "notif-decline-2",
      type: "appointment",
      subtype: "doctor-declined",
      title: "Doctor Declined Appointment",
      body: 'Dr. AUDREY LEE SALUDAGA declined the consultation request for Jonathan Bayutas: "Sudden emergency". Reassignment required.',
      metadata: {
        appointment_id: "appt-1",
        doctor_id: "doc-audrey-2",
        doctor_name: "AUDREY LEE SALUDAGA",
        link: "/clinic/appointments",
      },
    };

    const byId = doctorProfileById.get(rawDeclinedNotif.metadata.doctor_id);
    const senderName = formatDoctorSenderName(rawDeclinedNotif.metadata.doctor_name) || byId?.fullName || "Dr. Attending Doctor";
    const senderAvatar = byId?.avatarUrl;

    assert(senderName === "Dr. AUDREY LEE SALUDAGA", `Expected 'Dr. AUDREY LEE SALUDAGA', got '${senderName}'`);
    assert(senderAvatar === "https://example.com/avatars/dr-audrey.png", `Expected Dr. Audrey avatar URL from user profile join, got '${senderAvatar}'`);
    assert(getNotificationInitials(senderName, "DR") === "AS", "Fallback initials derive 'AS' from Dr. AUDREY LEE SALUDAGA");
    console.log("✓ 'Doctor Declined Appointment' resolves senderName='Dr. AUDREY LEE SALUDAGA' and user profile avatar_url.");
  }

  console.log("\n=================================================================");
  console.log("  ALL CLINIC DOCTOR ACTION NOTIFICATION TESTS PASSED!");
  console.log("=================================================================\n");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

