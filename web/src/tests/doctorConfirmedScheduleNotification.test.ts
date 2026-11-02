/**
 * ============================================================================
 * DermAI - Doctor Confirmed Schedule Notification Enrichment Test Suite
 * ============================================================================
 */

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${msg}`);
  }
}

interface MockAppointment {
  appointment_id: string;
  status: string;
  doctor_status: string;
  created_at: string;
  doctor_reviewed_at?: string;
  clinic: { name: string; logo_url: string | null } | { name: string; logo_url: string | null }[];
}

interface MockDbNotification {
  notif_id: string;
  type: string;
  subtype?: string;
  title: string;
  body: string;
  is_read: boolean;
  metadata?: Record<string, any>;
  created_at: string;
}

function enrichScheduleApprovalNotification(
  n: MockDbNotification,
  appointments: MockAppointment[]
) {
  const clinicByApptId = new Map<string, { name: string; logo: string | null }>();
  appointments.forEach((appt) => {
    const cObj = Array.isArray(appt.clinic) ? appt.clinic[0] : appt.clinic;
    clinicByApptId.set(appt.appointment_id, {
      name: cObj?.name || "Clinic",
      logo: cObj?.logo_url || null,
    });
  });

  const isScheduleApproved =
    n.type === "appointment-scheduled" ||
    n.type === "appointment_scheduled" ||
    n.type === "appointment-accepted" ||
    n.type === "appointment_accepted" ||
    n.type === "appointment-approved" ||
    n.type === "appointment_approved" ||
    n.type === "doctor-confirmed-schedule" ||
    n.type === "doctor_confirmed_schedule" ||
    n.type === "schedule-confirmed" ||
    n.type === "schedule_confirmed" ||
    n.subtype === "doctor-confirmed-schedule" ||
    n.subtype === "doctor_confirmed_schedule" ||
    n.subtype === "appointment-approved" ||
    n.subtype === "appointment_approved" ||
    n.subtype === "schedule-confirmed" ||
    n.subtype === "schedule_confirmed" ||
    n.subtype === "confirmed" ||
    n.subtype === "doctor-approved" ||
    n.subtype === "doctor_approved" ||
    n.subtype === "reassigned" ||
    /doctor confirmed schedule|appointment confirmed|schedule confirmed|reschedule request approved/i.test(n.title || "") ||
    /approved your consultation schedule|schedule.*confirmed|has been confirmed|has been reassigned/i.test(n.body || "");

  const apptId = (n.metadata?.appointment_id || n.metadata?.appointmentId) as string | undefined;

  let clinicEnrichment: { name: string; logo: string | null; appointmentId?: string } | undefined;

  if (isScheduleApproved) {
    // Path 1: Exact match by appointment_id in metadata
    if (apptId) {
      const matched = clinicByApptId.get(apptId);
      if (matched) {
        clinicEnrichment = {
          name: matched.name,
          logo: matched.logo,
          appointmentId: apptId,
        };
      }
    }

    // Path 2: Closest approved/confirmed appointment by timestamp
    if (!clinicEnrichment) {
      const notifTime = new Date(n.created_at).getTime();
      const approvedFilter = (a: MockAppointment) =>
        a.doctor_status === "approved" ||
        a.status === "confirmed" ||
        a.status === "scheduled" ||
        a.status === "approved";

      const candidateAppts =
        appointments.filter(approvedFilter).length > 0
          ? appointments.filter(approvedFilter)
          : appointments;

      if (candidateAppts.length > 0) {
        const closest = candidateAppts.reduce((best, appt) => {
          const apptTime = new Date(appt.doctor_reviewed_at || appt.created_at || 0).getTime();
          const bestTime = new Date(best.doctor_reviewed_at || best.created_at || 0).getTime();
          return Math.abs(apptTime - notifTime) < Math.abs(bestTime - notifTime) ? appt : best;
        });

        const cObj = Array.isArray(closest.clinic) ? closest.clinic[0] : closest.clinic;
        if (cObj?.name) {
          clinicEnrichment = {
            name: cObj.name,
            logo: cObj.logo_url || null,
            appointmentId: closest.appointment_id,
          };
        }
      }
    }
  }

  const senderName = (isScheduleApproved && clinicEnrichment?.name) || n.metadata?.sender_name || undefined;
  const senderAvatar = isScheduleApproved ? (clinicEnrichment?.logo ?? null) : undefined;
  const resolvedClinicName = senderName && senderName !== "Clinic Update" ? senderName : "Clinic";
  const clinicInitials = resolvedClinicName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

  return {
    isScheduleApproved,
    senderName,
    senderAvatar,
    resolvedClinicName,
    clinicInitials,
  };
}

const sampleAppointments: MockAppointment[] = [
  {
    appointment_id: "appt-101",
    status: "pending",
    doctor_status: "approved",
    created_at: "2026-11-02T09:00:00Z",
    doctor_reviewed_at: "2026-11-02T12:00:00Z",
    clinic: {
      name: "Cebu Skin & Laser Clinic",
      logo_url: "https://example.com/logos/cebu-skin.png",
    },
  },
  {
    appointment_id: "appt-102",
    status: "confirmed",
    doctor_status: "approved",
    created_at: "2026-11-02T14:00:00Z",
    doctor_reviewed_at: "2026-11-02T15:00:00Z",
    clinic: {
      name: "DerMA Aesthetics",
      logo_url: null,
    },
  },
];

// Test 1: Path 1 (metadata.appointment_id) with clinic logo
{
  const notif: MockDbNotification = {
    notif_id: "n-1",
    type: "appointment-scheduled",
    subtype: "doctor-approved",
    title: "Doctor Confirmed Schedule",
    body: "Dr. Clark has approved your consultation schedule.",
    is_read: false,
    metadata: { appointment_id: "appt-101" },
    created_at: "2026-11-02T12:00:05Z",
  };
  const res = enrichScheduleApprovalNotification(notif, sampleAppointments);
  assert(res.isScheduleApproved === true, "Must detect doctor-approved subtype");
  assert(res.senderName === "Cebu Skin & Laser Clinic", "Path 1 must resolve clinic name");
  assert(res.senderAvatar === "https://example.com/logos/cebu-skin.png", "Path 1 must resolve clinic logo");
  assert(res.resolvedClinicName === "Cebu Skin & Laser Clinic", "Must not show 'Clinic Update'");
  assert(res.clinicInitials === "CS", "Initials for 'Cebu Skin & Laser Clinic' must be 'CS'");
  console.log("✓ Test 1 (Path 1 - exact appointment_id lookup with logo) passed.");
}

// Test 2: Path 2 (closest timestamp match without metadata.appointment_id) and initials fallback
{
  const notif: MockDbNotification = {
    notif_id: "n-2",
    type: "appointment-scheduled",
    subtype: "doctor-confirmed-schedule",
    title: "Doctor Confirmed Schedule",
    body: "Dr. Clark has approved your consultation schedule.",
    is_read: false,
    created_at: "2026-11-02T15:01:00Z",
  };
  const res = enrichScheduleApprovalNotification(notif, sampleAppointments);
  assert(res.isScheduleApproved === true, "Must detect doctor-confirmed-schedule subtype");
  assert(res.senderName === "DerMA Aesthetics", "Path 2 must match closest approved appointment clinic");
  assert(res.senderAvatar === null, "Path 2 clinic has null logo_url");
  assert(res.resolvedClinicName === "DerMA Aesthetics", "Resolved clinic name must be 'DerMA Aesthetics'");
  assert(res.clinicInitials === "DA", "Fallback clinic initials must be 'DA'");
  console.log("✓ Test 2 (Path 2 - timestamp lookup + initials fallback) passed.");
}

// Test 3: All approval subtype variants are recognized
for (const subtype of ["doctor-confirmed-schedule", "appointment-approved", "schedule-confirmed", "confirmed", "doctor-approved"]) {
  const notif: MockDbNotification = {
    notif_id: `n-${subtype}`,
    type: "system",
    subtype,
    title: "Schedule Update",
    body: "Your schedule was updated.",
    is_read: false,
    metadata: { appointment_id: "appt-101" },
    created_at: "2026-11-02T12:00:00Z",
  };
  const res = enrichScheduleApprovalNotification(notif, sampleAppointments);
  assert(res.isScheduleApproved === true, `Subtype '${subtype}' must be enriched`);
  assert(res.senderName === "Cebu Skin & Laser Clinic", `Subtype '${subtype}' must resolve clinic name`);
}
console.log("✓ Test 3 (All schedule approval subtype variants) passed.");

