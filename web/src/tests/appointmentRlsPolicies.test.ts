/**
 * ============================================================================
 * DERMAI APPOINTMENT RLS POLICY CONTRACT TEST SUITE
 * TYPE: TypeScript In-Memory Contract Simulation
 *
 * NOTE: This suite simulates and validates the exact policy predicates,
 * trigger checks, and authorization invariants defined in
 * `supabase/migrations/20261026_harden_appointment_rls.sql`.
 *
 * Scenarios Tested:
 * 1. Patient A can read their own appointment.
 * 2. Patient A cannot read Patient B's appointment or unassigned appointments.
 * 3. Patient A cannot insert an appointment attributed to Patient B.
 * 4. Patient A cannot update or delete Patient B's appointment.
 * 5. Doctor can access only appointments assigned to them (or unassigned) in active clinic.
 * 6. Clinic staff can access only appointments belonging to authorized clinics.
 * 7. Unauthorized clinic cannot access or modify another clinic's appointments.
 * 8. Legitimate administrators retain intended global access.
 * 9. Legitimate appointment booking, doctor review, and patient cancellation workflows work.
 * 10. Patient field tampering protections:
 *     - Cannot alter appointment clinic_id (immutable).
 *     - Cannot alter appointment user_id (immutable).
 *     - Cannot self-approve doctor_status.
 *     - Cannot self-reject doctor_status.
 *     - CAN perform legitimate alternate-doctor selection (rejected -> pending-review).
 *     - Untrusted client cannot directly transition payment_status to 'paid'.
 *     - Untrusted client cannot directly alter paid_at or payment_reference.
 *     - Caller-set internal_payment_context CANNOT bypass clinic_id/user_id or payment_status.
 * 11. Legacy simulated-payment RPC is revoked and rejected for authenticated patients.
 * 12. Booked-slot visibility RPC simulation:
 *     - Returns occupied slots without patient private data.
 *     - Rejects non-existent clinic (ERR_NOT_FOUND).
 *     - Rejects dates outside 90-day booking horizon (ERR_INVALID_DATE_RANGE).
 * 13. Clinic authorization rejects whitespace-only or empty clinic email fallback.
 * 14. Trusted service-role caller can fulfill verified PayMongo payments.
 * 15. Queue-number insert compatibility, authoritative generation, and tampering protections:
 *     - Default or client-provided queue number is authoritatively computed and assigned.
 *     - Unpaid temporary slot holds receive null queue_number.
 *     - Client cannot directly tamper with queue_number on existing appointments.
 *     - Authoritative payment fulfillment assigns sequential queue number to hold.
 * 16. PayMongo webhook verification, payment synchronization, and idempotent replay handling:
 *     - Webhook updates payment_status to 'paid', payment_reference, paid_at, and payment_amount.
 *     - Webhook prevents user mismatch and tampered payment association.
 *     - Duplicate / replayed webhook events are idempotent without re-incrementing queue number.
 * 17. Slot hold reservation, retry behavior without duplicate slot error, concurrent lock, and hold expiration:
 *     - 10-minute hold reservation works atomically.
 *     - Concurrent user cannot acquire an actively held slot (ERR_SLOT_UNAVAILABLE).
 *     - Same user retrying checkout receives existing hold idempotently without ERR_DUPLICATE_SLOT.
 *     - Expired hold is automatically released and can be acquired by another patient.
 *     - Explicit hold cancellation frees the slot immediately.
 * ============================================================================
 */

interface UserContext {
  userId: string;
  role: "patient" | "doctor" | "clinic" | "admin" | "service_role";
  email: string;
  accountStatus: "active" | "suspended" | "inactive";
}

interface ClinicDoctorAffiliation {
  doctorId: string;
  clinicId: string;
  userId: string;
  status: "Active" | "Inactive";
}

interface ClinicEntity {
  clinicId: string;
  name: string;
  email: string;
  ownerUserId: string | null;
}

interface PatientAppointment {
  appointmentId: string;
  userId: string;
  clinicId: string;
  assignedDoctorId: string | null;
  date: string;
  time: string;
  status: "pending" | "scheduled" | "confirmed" | "completed" | "cancelled" | "rejected";
  doctorStatus: "pending-review" | "approved" | "rejected" | null;
  checkInStatus: "scheduled" | "arrived" | "in-consultation" | "completed";
  paymentStatus?: "pending_hold" | "paid" | "failed" | "expired" | "cancelled" | null;
  paymentReference?: string | null;
  paymentAmount?: number | null;
  paymentHoldExpiresAt?: string | null;
  queueNumber?: number | null;
  paidAt?: string | null;
  clinicNote?: string | null;
}

// ----------------------------------------------------------------------------
// Policy & Trigger Implementations (Matching SQL Migration Logic)
// ----------------------------------------------------------------------------

function isClinicOwner(clinic: ClinicEntity, user: UserContext): boolean {
  // Explicit ownership relationship
  if (clinic.ownerUserId && clinic.ownerUserId === user.userId) return true;

  // Fallback: only if ownerUserId is null, match active clinic user with verified non-empty email
  if (
    !clinic.ownerUserId &&
    clinic.email &&
    clinic.email.trim().length > 0 &&
    user.role === "clinic" &&
    user.accountStatus === "active" &&
    user.email &&
    user.email.trim().length > 0 &&
    clinic.email.trim().toLowerCase() === user.email.trim().toLowerCase()
  ) {
    return true;
  }
  return false;
}

function isActiveDoctorForAppointment(
  clinicId: string,
  assignedDoctorId: string | null,
  user: UserContext,
  affiliations: ClinicDoctorAffiliation[]
): boolean {
  return affiliations.some(
    (cd) =>
      cd.userId === user.userId &&
      cd.status.toLowerCase() === "active" &&
      cd.clinicId === clinicId &&
      (assignedDoctorId === null || assignedDoctorId === cd.doctorId || assignedDoctorId === user.userId)
  );
}

function canSelectAppointment(
  appt: PatientAppointment,
  user: UserContext,
  clinics: ClinicEntity[],
  affiliations: ClinicDoctorAffiliation[]
): boolean {
  // Service role / Admin
  if (user.role === "service_role") return true;
  if (user.role === "admin" && user.accountStatus === "active") return true;

  // Patient
  if (appt.userId === user.userId) return true;

  // Clinic Staff
  const clinic = clinics.find((c) => c.clinicId === appt.clinicId);
  if (clinic && isClinicOwner(clinic, user)) return true;

  // Doctor
  if (isActiveDoctorForAppointment(appt.clinicId, appt.assignedDoctorId, user, affiliations)) {
    return true;
  }

  return false;
}

function canInsertAppointment(
  newAppt: PatientAppointment,
  user: UserContext,
  clinics: ClinicEntity[],
  _affiliations: ClinicDoctorAffiliation[]
): { allowed: boolean; reason?: string } {
  if (user.role === "service_role") return { allowed: true };
  if (user.role === "admin" && user.accountStatus === "active") return { allowed: true };

  // Payment field protection on INSERT
  if (newAppt.paymentStatus === "paid") {
    return { allowed: false, reason: "ERR_FORBIDDEN: Direct insertion of paid payment_status is prohibited." };
  }

  const isClinic = clinics.some((c) => c.clinicId === newAppt.clinicId && isClinicOwner(c, user));

  // Patient rules
  if (newAppt.userId === user.userId) {
    if (newAppt.doctorStatus && newAppt.doctorStatus !== "pending-review") {
      return { allowed: false, reason: "ERR_FORBIDDEN: Patients cannot initialize doctor_status to " + newAppt.doctorStatus };
    }
    if (!["pending", "scheduled"].includes(newAppt.status)) {
      return { allowed: false, reason: "ERR_FORBIDDEN: Patients cannot initialize appointment status to " + newAppt.status };
    }
    return { allowed: true };
  }

  // Clinic staff walk-in rule
  if (isClinic) {
    return { allowed: true };
  }

  return { allowed: false, reason: "Unauthorized: user_id mismatch or not clinic owner" };
}

function canUpdateAppointment(
  currentAppt: PatientAppointment,
  updatedAppt: PatientAppointment,
  user: UserContext,
  clinics: ClinicEntity[],
  affiliations: ClinicDoctorAffiliation[],
  callerInternalPaymentContext = false
): { allowed: boolean; reason?: string } {
  const isAdmin = user.role === "admin" && user.accountStatus === "active";
  const isServiceRole = user.role === "service_role";

  // Invariant 1: Modifying clinic_id is strictly prohibited for all non-admins
  // Even if caller sets internal payment context, clinic_id CANNOT be altered!
  if (updatedAppt.clinicId !== currentAppt.clinicId && !isAdmin) {
    return { allowed: false, reason: "ERR_FORBIDDEN: Modifying appointment clinic_id is prohibited." };
  }

  // Invariant 2: Modifying user_id is strictly prohibited for all non-admins
  if (updatedAppt.userId !== currentAppt.userId && !isAdmin) {
    return { allowed: false, reason: "ERR_FORBIDDEN: Modifying appointment user_id is prohibited." };
  }

  // Service role bypass (e.g. verified PayMongo webhook)
  if (isServiceRole) return { allowed: true };

  // Administrator bypass
  if (isAdmin) return { allowed: true };

  // Invariant 3: Direct transition of payment_status to 'paid' is strictly prohibited
  // for untrusted clients, EVEN IF app.internal_payment_context is true!
  if (currentAppt.paymentStatus !== "paid" && updatedAppt.paymentStatus === "paid") {
    return { allowed: false, reason: "ERR_FORBIDDEN: Direct transition of payment_status to paid is prohibited." };
  }

  // Invariant 4: Direct modification of paid_at or payment_reference is prohibited
  if (updatedAppt.paidAt !== currentAppt.paidAt && !callerInternalPaymentContext) {
    return { allowed: false, reason: "ERR_FORBIDDEN: Direct modification of paid_at is prohibited." };
  }
  if (updatedAppt.paymentReference !== currentAppt.paymentReference && !callerInternalPaymentContext) {
    return { allowed: false, reason: "ERR_FORBIDDEN: Direct modification of payment_reference is prohibited." };
  }

  // Invariant 5: Direct modification of queue_number is prohibited for untrusted clients
  if (
    updatedAppt.queueNumber !== undefined &&
    currentAppt.queueNumber !== undefined &&
    updatedAppt.queueNumber !== currentAppt.queueNumber
  ) {
    return { allowed: false, reason: "ERR_FORBIDDEN: Direct modification of queue_number is prohibited." };
  }

  const isClinic = clinics.some((c) => c.clinicId === currentAppt.clinicId && isClinicOwner(c, user));
  const isDoctor = isActiveDoctorForAppointment(currentAppt.clinicId, currentAppt.assignedDoctorId, user, affiliations);

  // Patient update rule
  if (currentAppt.userId === user.userId) {
    // Check doctor_status changes
    if (updatedAppt.doctorStatus !== currentAppt.doctorStatus) {
      // Legitimate alternate doctor selection: transition from 'rejected' to 'pending-review'
      if (currentAppt.doctorStatus === "rejected" && updatedAppt.doctorStatus === "pending-review") {
        // Allowed!
      } else {
        return {
          allowed: false,
          reason: `ERR_FORBIDDEN: Patients are not permitted to change doctor_status to ${updatedAppt.doctorStatus}`,
        };
      }
    }

    // Check status changes
    if (updatedAppt.status !== currentAppt.status) {
      if (!["pending", "cancelled"].includes(updatedAppt.status)) {
        return {
          allowed: false,
          reason: `ERR_FORBIDDEN: Patients cannot transition appointment status to ${updatedAppt.status}`,
        };
      }
    }

    return { allowed: true };
  }

  // Clinic staff update rule
  if (isClinic) {
    return { allowed: true };
  }

  // Doctor update rule
  if (isDoctor) {
    return { allowed: true };
  }

  return { allowed: false, reason: "Unauthorized: not patient owner, clinic staff, doctor, or admin" };
}

function canDeleteAppointment(
  appt: PatientAppointment,
  user: UserContext,
  clinics: ClinicEntity[]
): boolean {
  if (user.role === "admin" && user.accountStatus === "active") return true;
  if (appt.userId === user.userId) return true; // Patient rollback
  const clinic = clinics.find((c) => c.clinicId === appt.clinicId);
  if (clinic && isClinicOwner(clinic, user)) return true;
  return false;
}

// Occupied slot visibility RPC simulation with date horizon and clinic existence checks
function getOccupiedAppointmentSlots(
  clinicId: string,
  date: string,
  doctorId: string | null,
  clinics: ClinicEntity[],
  appointments: PatientAppointment[]
): { slots?: Array<{ slotTime: string; slotDate: string; assignedDoctorId: string | null; clinicId: string }>; error?: string } {
  // Validate clinic existence
  if (!clinics.some((c) => c.clinicId === clinicId)) {
    return { error: `ERR_NOT_FOUND: Clinic ${clinicId} does not exist.` };
  }

  // Validate 90-day booking horizon
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minDate = new Date(today);
  minDate.setDate(minDate.getDate() - 1); // 1-day buffer
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 90);

  const queryDate = new Date(date);
  if (isNaN(queryDate.getTime()) || queryDate < minDate || queryDate > maxDate) {
    return { error: "ERR_INVALID_DATE_RANGE: Date must be within the 90-day booking horizon." };
  }

  const matched = appointments
    .filter(
      (pa) =>
        pa.clinicId === clinicId &&
        pa.date.startsWith(date) &&
        (doctorId === null || pa.assignedDoctorId === doctorId) &&
        !["cancelled", "rejected"].includes(pa.status) &&
        pa.doctorStatus !== "rejected" &&
        !["expired", "cancelled", "failed"].includes(pa.paymentStatus || "")
    )
    .map((pa) => ({
      slotTime: pa.time.slice(0, 5),
      slotDate: date,
      assignedDoctorId: pa.assignedDoctorId,
      clinicId: pa.clinicId,
    }));

  return { slots: matched };
}

// Legacy simulated payment execution simulation
function processSimulatedAppointmentPayment(
  user: UserContext
): { success: boolean; code: string; message: string } {
  // Defense in depth: blocked for all ordinary users
  if (user.role !== "service_role" && user.role !== "admin") {
    return {
      success: false,
      code: "ERR_SIMULATION_DISABLED",
      message: "Simulated appointment payment is permanently disabled. Payments must be processed through PayMongo.",
    };
  }
  return {
    success: false,
    code: "ERR_SIMULATION_DISABLED",
    message: "Simulation endpoint is deprecated.",
  };
}

// Trigger simulation for authoritative queue number assignment & hold rules
function applyAppointmentInsertTrigger(
  newAppt: PatientAppointment,
  user: UserContext,
  existingAppointments: PatientAppointment[]
): { appointment: PatientAppointment; error?: string } {
  const isAdmin = user.role === "admin" && user.accountStatus === "active";
  const isServiceRole = user.role === "service_role";

  if (newAppt.paymentStatus === "paid" && !isServiceRole && !isAdmin) {
    return { appointment: newAppt, error: "ERR_FORBIDDEN: Direct insertion of paid payment_status is prohibited." };
  }

  // Queue number assignment matching trg_protect_appointment_fields:
  let finalQueueNumber: number | null = null;
  if (newAppt.paymentStatus === "pending_hold" || newAppt.paymentStatus === "failed") {
    finalQueueNumber = null;
  } else {
    // Authoritatively calculate max(queue_number) + 1 for clinic, doctor, and date
    const apptDateOnly = newAppt.date.split("T")[0];
    const sameDayAppointments = existingAppointments.filter(
      (a) =>
        a.clinicId === newAppt.clinicId &&
        a.assignedDoctorId === newAppt.assignedDoctorId &&
        a.date.startsWith(apptDateOnly) &&
        a.queueNumber !== null &&
        a.queueNumber !== undefined
    );
    const maxQ = sameDayAppointments.reduce((max, a) => Math.max(max, a.queueNumber || 0), 0);
    finalQueueNumber = maxQ + 1;
  }

  return {
    appointment: {
      ...newAppt,
      queueNumber: finalQueueNumber,
    },
  };
}

// Temporary slot hold acquisition simulation
function simulateSlotHold(
  clinicId: string,
  doctorId: string | null,
  date: string,
  time: string,
  user: UserContext,
  existingAppointments: PatientAppointment[],
  holdDurationMinutes = 10
): { success: boolean; appointment?: PatientAppointment; code?: string; message?: string; isExistingHold?: boolean } {
  const now = new Date();
  const timeClean = time.slice(0, 5);
  const dateOnly = date.split("T")[0];

  // Find existing appointment on this slot
  const existing = existingAppointments.find(
    (a) =>
      a.clinicId === clinicId &&
      a.assignedDoctorId === doctorId &&
      a.date.startsWith(dateOnly) &&
      a.time.slice(0, 5) === timeClean &&
      !["cancelled", "rejected"].includes(a.status)
  );

  if (existing) {
    const isHold = existing.paymentStatus === "pending_hold" || existing.paymentStatus === "failed";
    const expiresAt = existing.paymentHoldExpiresAt ? new Date(existing.paymentHoldExpiresAt) : null;
    const isExpired = expiresAt ? expiresAt.getTime() <= now.getTime() : false;

    // Idempotent retry: same user retrying while hold is active
    if (existing.userId === user.userId && isHold && !isExpired) {
      return {
        success: true,
        appointment: existing,
        isExistingHold: true,
      };
    }

    // Expired hold: release and reassign
    if (isHold && isExpired) {
      existing.status = "cancelled";
      existing.paymentStatus = "expired";
    } else if (["expired", "cancelled"].includes(existing.paymentStatus || "")) {
      // Slot is available
    } else {
      // Occupied by active booking or another patient's active hold
      return {
        success: false,
        code: "ERR_SLOT_UNAVAILABLE",
        message: "This consultation slot has just been reserved by another patient. Please select another available time.",
      };
    }
  }

  // Create new hold with null queue number and 10-minute expiry
  const expiresAt = new Date(now.getTime() + holdDurationMinutes * 60 * 1000).toISOString();
  const newHold: PatientAppointment = {
    appointmentId: `hold-${Math.random().toString(36).substring(2, 9)}`,
    userId: user.userId,
    clinicId,
    assignedDoctorId: doctorId,
    date,
    time: timeClean,
    status: "pending",
    doctorStatus: "pending-review",
    checkInStatus: "scheduled",
    paymentStatus: "pending_hold",
    paymentHoldExpiresAt: expiresAt,
    paymentAmount: 500,
    queueNumber: null,
  };

  return {
    success: true,
    appointment: newHold,
    isExistingHold: false,
  };
}

// Authoritative PayMongo webhook fulfillment simulation
function simulatePayMongoFulfillment(
  appointment: PatientAppointment,
  payload: {
    paymongoPaymentId: string;
    amount: number;
    currency: string;
    paymentStatus: "paid";
    userId: string;
  },
  existingAppointments: PatientAppointment[]
): { success: boolean; updatedAppointment?: PatientAppointment; error?: string } {
  // 1. Verify user association
  if (appointment.userId !== payload.userId) {
    return { success: false, error: "ERR_UNAUTHORIZED: Payment user mismatch." };
  }

  // 2. Webhook idempotency: if already paid with same reference, no duplicate processing
  if (appointment.paymentStatus === "paid" && appointment.paymentReference === payload.paymongoPaymentId) {
    return { success: true, updatedAppointment: appointment };
  }

  // 3. Assign sequential queue number if previously null (hold transition)
  let queueNumber = appointment.queueNumber;
  if (!queueNumber || queueNumber <= 0) {
    const apptDateOnly = appointment.date.split("T")[0];
    const sameDay = existingAppointments.filter(
      (a) =>
        a.clinicId === appointment.clinicId &&
        a.assignedDoctorId === appointment.assignedDoctorId &&
        a.date.startsWith(apptDateOnly) &&
        a.queueNumber !== null &&
        a.queueNumber !== undefined
    );
    const maxQ = sameDay.reduce((max, a) => Math.max(max, a.queueNumber || 0), 0);
    queueNumber = maxQ + 1;
  }

  const updated: PatientAppointment = {
    ...appointment,
    paymentStatus: "paid",
    paymentReference: payload.paymongoPaymentId,
    paymentAmount: payload.amount,
    paidAt: new Date().toISOString(),
    queueNumber,
    checkInStatus: "scheduled",
  };

  return { success: true, updatedAppointment: updated };
}

// ----------------------------------------------------------------------------
// Test Assertions & Fixtures
// ----------------------------------------------------------------------------

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    throw new Error(msg);
  }
}

const patientA: UserContext = {
  userId: "a1111111-1111-1111-1111-111111111111",
  role: "patient",
  email: "patient.a@test.dermai.internal",
  accountStatus: "active",
};

const patientB: UserContext = {
  userId: "b2222222-2222-2222-2222-222222222222",
  role: "patient",
  email: "patient.b@test.dermai.internal",
  accountStatus: "active",
};

const clinicAOwner: UserContext = {
  userId: "c3333333-3333-3333-3333-333333333333",
  role: "clinic",
  email: "clinic.a@test.dermai.internal",
  accountStatus: "active",
};

const clinicBOwner: UserContext = {
  userId: "c4444444-4444-4444-4444-444444444444",
  role: "clinic",
  email: "clinic.b@test.dermai.internal",
  accountStatus: "active",
};

const doctorA: UserContext = {
  userId: "d5555555-5555-5555-5555-555555555555",
  role: "doctor",
  email: "doctor.a@test.dermai.internal",
  accountStatus: "active",
};

const adminUser: UserContext = {
  userId: "e6666666-6666-6666-6666-666666666666",
  role: "admin",
  email: "admin@test.dermai.internal",
  accountStatus: "active",
};

const serviceRoleUser: UserContext = {
  userId: "00000000-0000-0000-0000-000000000000",
  role: "service_role",
  email: "service_role@supabase.internal",
  accountStatus: "active",
};

const clinics: ClinicEntity[] = [
  {
    clinicId: "ca000000-0000-0000-0000-000000000001",
    name: "Derma Alpha Clinic",
    email: "clinic.a@test.dermai.internal",
    ownerUserId: clinicAOwner.userId,
  },
  {
    clinicId: "cb000000-0000-0000-0000-000000000002",
    name: "Derma Beta Clinic",
    email: "clinic.b@test.dermai.internal",
    ownerUserId: clinicBOwner.userId,
  },
  {
    clinicId: "cc000000-0000-0000-0000-000000000003",
    name: "Whitespace Clinic",
    email: "   ",
    ownerUserId: null,
  },
];

const affiliations: ClinicDoctorAffiliation[] = [
  {
    doctorId: "da000000-0000-0000-0000-000000000001",
    clinicId: clinics[0].clinicId,
    userId: doctorA.userId,
    status: "Active",
  },
];

const validFutureDate = new Date();
validFutureDate.setDate(validFutureDate.getDate() + 5);
const validFutureDateStr = validFutureDate.toISOString().split("T")[0];

const apptPatientA: PatientAppointment = {
  appointmentId: "aa000000-0000-0000-0000-000000000001",
  userId: patientA.userId,
  clinicId: clinics[0].clinicId,
  assignedDoctorId: affiliations[0].doctorId,
  date: `${validFutureDateStr}T09:00:00`,
  time: "09:00:00",
  status: "pending",
  doctorStatus: "pending-review",
  checkInStatus: "scheduled",
  paymentStatus: "pending_hold",
};

const apptPatientB: PatientAppointment = {
  appointmentId: "bb000000-0000-0000-0000-000000000002",
  userId: patientB.userId,
  clinicId: clinics[1].clinicId,
  assignedDoctorId: null,
  date: `${validFutureDateStr}T10:00:00`,
  time: "10:00:00",
  status: "pending",
  doctorStatus: "pending-review",
  checkInStatus: "scheduled",
  paymentStatus: "pending_hold",
};

const apptUnassignedClinicA: PatientAppointment = {
  appointmentId: "ua000000-0000-0000-0000-000000000003",
  userId: patientB.userId,
  clinicId: clinics[0].clinicId,
  assignedDoctorId: null,
  date: `${validFutureDateStr}T11:00:00`,
  time: "11:00:00",
  status: "pending",
  doctorStatus: "pending-review",
  checkInStatus: "scheduled",
  paymentStatus: "pending_hold",
};

const apptRejectedPatientA: PatientAppointment = {
  appointmentId: "ra000000-0000-0000-0000-000000000004",
  userId: patientA.userId,
  clinicId: clinics[0].clinicId,
  assignedDoctorId: affiliations[0].doctorId,
  date: `${validFutureDateStr}T14:00:00`,
  time: "14:00:00",
  status: "rejected",
  doctorStatus: "rejected",
  checkInStatus: "scheduled",
  paymentStatus: "pending_hold",
};

// ----------------------------------------------------------------------------
// Test Runner
// ----------------------------------------------------------------------------

console.log("\n=======================================================");
console.log("DermAI — Appointment RLS Contract Simulation Suite");
console.log("=======================================================\n");

// Scenario 1: Patient A can read their own appointment
assert(
  canSelectAppointment(apptPatientA, patientA, clinics, affiliations),
  "Scenario 1: Patient A must be able to read own appointment"
);
console.log("✓ Scenario 1 Passed: Patient A can read their own appointment.");

// Scenario 2: Patient A cannot read Patient B's appointment
assert(
  !canSelectAppointment(apptPatientB, patientA, clinics, affiliations),
  "Scenario 2: Patient A must NOT be able to read Patient B's appointment"
);
assert(
  !canSelectAppointment(apptUnassignedClinicA, patientA, clinics, affiliations),
  "Scenario 2b: Patient A must NOT be able to read Patient B's unassigned appointment"
);
console.log("✓ Scenario 2 Passed: Patient A cannot read Patient B's appointments (Tenant & Patient Privacy Isolated).");

// Scenario 3: Patient A cannot insert an appointment attributed to Patient B
const spoofedInsert: PatientAppointment = {
  ...apptPatientA,
  appointmentId: "new-spoofed-appt",
  userId: patientB.userId,
};
const insertResult = canInsertAppointment(spoofedInsert, patientA, clinics, affiliations);
assert(!insertResult.allowed, "Scenario 3: Inserting appointment with Patient B's userId must be blocked");
console.log("✓ Scenario 3 Passed: Patient A cannot insert an appointment attributed to Patient B.");

// Scenario 4: Patient A cannot update or delete Patient B's appointment
const updateResult = canUpdateAppointment(
  apptPatientB,
  { ...apptPatientB, clinicNote: "Hacked" },
  patientA,
  clinics,
  affiliations
);
assert(!updateResult.allowed, "Scenario 4a: Patient A must NOT be able to update Patient B's appointment");
assert(
  !canDeleteAppointment(apptPatientB, patientA, clinics),
  "Scenario 4b: Patient A must NOT be able to delete Patient B's appointment"
);
console.log("✓ Scenario 4 Passed: Patient A cannot update or delete Patient B's appointment.");

// Scenario 5: Doctor can access only appointments assigned to them (or unassigned) in active clinic
assert(
  canSelectAppointment(apptPatientA, doctorA, clinics, affiliations),
  "Scenario 5a: Doctor A must be able to read assigned appointment in Clinic A"
);
assert(
  canSelectAppointment(apptUnassignedClinicA, doctorA, clinics, affiliations),
  "Scenario 5b: Doctor A must be able to read unassigned appointment in Clinic A"
);
assert(
  !canSelectAppointment(apptPatientB, doctorA, clinics, affiliations),
  "Scenario 5c: Doctor A must NOT be able to read appointment in unaffiliated Clinic B"
);
console.log("✓ Scenario 5 Passed: Doctor A accesses only assigned or unassigned appointments within affiliated Clinic A.");

// Scenario 6: Clinic staff can access only appointments belonging to authorized clinics
assert(
  canSelectAppointment(apptPatientA, clinicAOwner, clinics, affiliations),
  "Scenario 6a: Clinic A owner must be able to read Clinic A appointment"
);
assert(
  canSelectAppointment(apptUnassignedClinicA, clinicAOwner, clinics, affiliations),
  "Scenario 6b: Clinic A owner must be able to read Clinic A unassigned appointment"
);
console.log("✓ Scenario 6 Passed: Clinic A staff can access all appointments in Clinic A.");

// Scenario 7: Unauthorized clinic cannot access or modify another clinic's appointments
assert(
  !canSelectAppointment(apptPatientA, clinicBOwner, clinics, affiliations),
  "Scenario 7a: Clinic B owner must NOT read Clinic A's appointments"
);
const clinicTamper = canUpdateAppointment(
  apptPatientA,
  { ...apptPatientA, clinicNote: "Cross-clinic tamper" },
  clinicBOwner,
  clinics,
  affiliations
);
assert(!clinicTamper.allowed, "Scenario 7b: Clinic B owner must NOT update Clinic A's appointments");
assert(
  !canDeleteAppointment(apptPatientA, clinicBOwner, clinics),
  "Scenario 7c: Clinic B owner must NOT delete Clinic A's appointments"
);
console.log("✓ Scenario 7 Passed: Unauthorized clinic cannot read, update, or delete another clinic's appointments.");

// Scenario 8: Legitimate administrators retain intended global access
assert(canSelectAppointment(apptPatientA, adminUser, clinics, affiliations), "Admin reads Clinic A");
assert(canSelectAppointment(apptPatientB, adminUser, clinics, affiliations), "Admin reads Clinic B");
console.log("✓ Scenario 8 Passed: Administrators retain intended global access.");

// Scenario 9: Legitimate appointment workflows work
const validInsert = canInsertAppointment(apptPatientA, patientA, clinics, affiliations);
assert(validInsert.allowed, "Scenario 9a: Patient A legitimate insert must succeed");

const docApprove = canUpdateAppointment(
  apptPatientA,
  { ...apptPatientA, doctorStatus: "approved", status: "confirmed" },
  doctorA,
  clinics,
  affiliations
);
assert(docApprove.allowed, "Scenario 9b: Doctor A review approval must succeed");

const patientCancel = canUpdateAppointment(
  apptPatientA,
  { ...apptPatientA, status: "cancelled", clinicNote: "Cancelled by patient" },
  patientA,
  clinics,
  affiliations
);
assert(patientCancel.allowed, "Scenario 9c: Patient A cancellation must succeed");
console.log("✓ Scenario 9 Passed: Booking, doctor review approval, and patient cancellation workflows verified.");

// Scenario 10: Patient Field Tampering Protections
// 10a. Cannot alter clinic_id (immutable)
const tamperClinic = canUpdateAppointment(
  apptPatientA,
  { ...apptPatientA, clinicId: clinics[1].clinicId },
  patientA,
  clinics,
  affiliations
);
assert(!tamperClinic.allowed, "Scenario 10a: Patient modifying appointment clinic_id must be blocked");

// 10b. Cannot alter user_id (immutable)
const tamperUser = canUpdateAppointment(
  apptPatientA,
  { ...apptPatientA, userId: patientB.userId },
  patientA,
  clinics,
  affiliations
);
assert(!tamperUser.allowed, "Scenario 10b: Patient modifying appointment user_id must be blocked");

// 10c. Cannot self-approve doctor_status
const patientSelfApprove = canUpdateAppointment(
  apptPatientA,
  { ...apptPatientA, doctorStatus: "approved" },
  patientA,
  clinics,
  affiliations
);
assert(!patientSelfApprove.allowed, "Scenario 10c: Patient self-approval must be blocked");

// 10d. Cannot self-reject doctor_status
const patientSelfReject = canUpdateAppointment(
  apptPatientA,
  { ...apptPatientA, doctorStatus: "rejected" },
  patientA,
  clinics,
  affiliations
);
assert(!patientSelfReject.allowed, "Scenario 10d: Patient self-rejection must be blocked");

// 10e. Legitimate alternate-doctor workflow: transition from 'rejected' to 'pending-review'
const alternateDoctorSelect = canUpdateAppointment(
  apptRejectedPatientA,
  {
    ...apptRejectedPatientA,
    doctorStatus: "pending-review",
    status: "pending",
    assignedDoctorId: "new-doc-id",
    date: `${validFutureDateStr}T15:00:00`,
    time: "15:00:00",
  },
  patientA,
  clinics,
  affiliations
);
assert(alternateDoctorSelect.allowed, "Scenario 10e: Alternate doctor selection must be allowed");

// 10f. Untrusted client cannot directly transition payment_status to 'paid'
const untrustedPayTransition = canUpdateAppointment(
  apptPatientA,
  { ...apptPatientA, paymentStatus: "paid" },
  patientA,
  clinics,
  affiliations
);
assert(!untrustedPayTransition.allowed, "Scenario 10f: Direct client payment_status to 'paid' must be blocked");

// 10g. Client cannot tamper with paid_at or payment_reference
const untrustedRefTamper = canUpdateAppointment(
  apptPatientA,
  { ...apptPatientA, paymentReference: "FAKE-REF-123", paidAt: new Date().toISOString() },
  patientA,
  clinics,
  affiliations
);
assert(!untrustedRefTamper.allowed, "Scenario 10g: Direct client modification of paid_at/paymentReference must be blocked");

// 10h. Caller-set internal payment context CANNOT bypass immutable fields or declare paid
const internalContextTamper = canUpdateAppointment(
  apptPatientA,
  { ...apptPatientA, clinicId: clinics[1].clinicId },
  patientA,
  clinics,
  affiliations,
  true // caller attempts setting internal payment context
);
assert(!internalContextTamper.allowed, "Scenario 10h-1: Caller-set internal context must not bypass clinic_id immutability");

const internalContextPayTamper = canUpdateAppointment(
  apptPatientA,
  { ...apptPatientA, paymentStatus: "paid" },
  patientA,
  clinics,
  affiliations,
  true // caller attempts setting internal payment context
);
assert(!internalContextPayTamper.allowed, "Scenario 10h-2: Caller-set internal context must not bypass payment_status protection");
console.log("✓ Scenario 10 Passed: Protected fields (clinic_id, user_id, doctor_status, payment_status) tamper-proof even with internal context; alternate-doctor preserved.");

// Scenario 11: Legacy Simulated Payment RPC is revoked for patients
const simResult = processSimulatedAppointmentPayment(patientA);
assert(!simResult.success && simResult.code === "ERR_SIMULATION_DISABLED", "Scenario 11: Patient calling simulation must be blocked");
console.log("✓ Scenario 11 Passed: Legacy simulated-payment RPC is permanently disabled and rejected for patients.");

// Scenario 12: Booked-Slot Visibility RPC
// 12a. Valid query returns occupied slot without exposing patient private data
const validSlotQuery = getOccupiedAppointmentSlots(
  clinics[0].clinicId,
  validFutureDateStr,
  affiliations[0].doctorId,
  clinics,
  [apptPatientA, apptPatientB, apptUnassignedClinicA, apptRejectedPatientA]
);
assert(validSlotQuery.slots !== undefined && validSlotQuery.slots.length === 1, "Scenario 12a: Exactly 1 occupied slot returned");
assert(validSlotQuery.slots![0].slotTime === "09:00", "Scenario 12a: Correct slot time returned");
assert(!("userId" in validSlotQuery.slots![0]), "Scenario 12a: No userId exposed in slot RPC");
assert(!("appointmentId" in validSlotQuery.slots![0]), "Scenario 12a: No appointmentId exposed in slot RPC");

// 12b. Querying non-existent clinic raises error
const fakeClinicQuery = getOccupiedAppointmentSlots(
  "cf000000-0000-0000-0000-000000000099",
  validFutureDateStr,
  null,
  clinics,
  []
);
assert(Boolean(fakeClinicQuery.error?.includes("ERR_NOT_FOUND")), "Scenario 12b: Non-existent clinic rejected");

// 12c. Querying date outside 90-day booking horizon raises error
const pastDateQuery = getOccupiedAppointmentSlots(
  clinics[0].clinicId,
  "2020-01-01",
  null,
  clinics,
  []
);
assert(Boolean(pastDateQuery.error?.includes("ERR_INVALID_DATE_RANGE")), "Scenario 12c: Past date rejected by horizon validation");

const distantFutureQuery = getOccupiedAppointmentSlots(
  clinics[0].clinicId,
  "2030-01-01",
  null,
  clinics,
  []
);
assert(Boolean(distantFutureQuery.error?.includes("ERR_INVALID_DATE_RANGE")), "Scenario 12d: Distant future date rejected by horizon validation");
console.log("✓ Scenario 12 Passed: Slot visibility RPC returns occupied slots without patient data and enforces clinic & 90-day date horizon validation.");

// Scenario 13: Clinic Authorization Rejects Whitespace / Empty Email Fallback
assert(!isClinicOwner(clinics[2], clinicAOwner), "Scenario 13: Whitespace clinic email must not match");
console.log("✓ Scenario 13 Passed: Clinic owner authorization rejects whitespace-only or empty clinic email.");

// Scenario 14: Trusted Service-Role Payment Fulfillment
const serviceRolePayment = canUpdateAppointment(
  apptPatientA,
  {
    ...apptPatientA,
    paymentStatus: "paid",
    paymentReference: "pay_pm_test_ref_456",
    paidAt: new Date().toISOString(),
    checkInStatus: "scheduled",
  },
  serviceRoleUser,
  clinics,
  affiliations
);
assert(serviceRolePayment.allowed, "Scenario 14: Service role must be allowed to fulfill payment");
console.log("✓ Scenario 14 Passed: Trusted service-role payment webhook update succeeds.");

// Scenario 15: Queue-Number Insert Compatibility, Authoritative Assignment & Tampering Protection
// 15a. Normal insert without client queue number authoritatively computes queue number 1
const normalInsert1 = applyAppointmentInsertTrigger(
  {
    appointmentId: "appt-normal-1",
    userId: patientA.userId,
    clinicId: clinics[0].clinicId,
    assignedDoctorId: affiliations[0].doctorId,
    date: `${validFutureDateStr}T10:00:00`,
    time: "10:00:00",
    status: "pending",
    doctorStatus: "pending-review",
    checkInStatus: "scheduled",
  },
  patientA,
  []
);
assert(normalInsert1.appointment.queueNumber === 1, "Scenario 15a: First normal booking must receive queue_number = 1");

// 15b. Client attempting to spoof or pass queue_number (e.g. 999 or column default 1) is authoritatively overwritten
const spoofedQueueInsert = applyAppointmentInsertTrigger(
  {
    appointmentId: "appt-spoofed-queue",
    userId: patientA.userId,
    clinicId: clinics[0].clinicId,
    assignedDoctorId: affiliations[0].doctorId,
    date: `${validFutureDateStr}T11:00:00`,
    time: "11:00:00",
    status: "pending",
    doctorStatus: "pending-review",
    checkInStatus: "scheduled",
    queueNumber: 999, // client attempt to choose queue number 999
  },
  patientA,
  [normalInsert1.appointment]
);
assert(spoofedQueueInsert.appointment.queueNumber === 2, "Scenario 15b: Client-supplied queue_number must be authoritatively overwritten to 2");

// 15c. Unpaid temporary hold insert receives null queue_number
const holdInsert = applyAppointmentInsertTrigger(
  {
    appointmentId: "appt-hold-1",
    userId: patientA.userId,
    clinicId: clinics[0].clinicId,
    assignedDoctorId: affiliations[0].doctorId,
    date: `${validFutureDateStr}T14:00:00`,
    time: "14:00:00",
    status: "pending",
    doctorStatus: "pending-review",
    checkInStatus: "scheduled",
    paymentStatus: "pending_hold",
    queueNumber: 1, // column default or client value
  },
  patientA,
  [normalInsert1.appointment, spoofedQueueInsert.appointment]
);
assert(holdInsert.appointment.queueNumber === null, "Scenario 15c: Temporary hold must have queue_number = null");

// 15d. Direct modification of queue_number on existing appointment by client is blocked
const tamperQueueNumber = canUpdateAppointment(
  normalInsert1.appointment,
  { ...normalInsert1.appointment, queueNumber: 42 },
  patientA,
  clinics,
  affiliations
);
assert(!tamperQueueNumber.allowed, "Scenario 15d: Direct client tampering with queue_number must be blocked");

// 15e. Authoritative payment transition assigns sequential queue number when transitioning from hold (null queue)
const paidFromHold = simulatePayMongoFulfillment(
  holdInsert.appointment,
  {
    paymongoPaymentId: "pay_pm_seq_queue_123",
    amount: 500,
    currency: "PHP",
    paymentStatus: "paid",
    userId: patientA.userId,
  },
  [normalInsert1.appointment, spoofedQueueInsert.appointment]
);
assert(paidFromHold.success, "Scenario 15e: Fulfillment from hold must succeed");
assert(paidFromHold.updatedAppointment?.queueNumber === 3, "Scenario 15e: Transitioned hold must receive sequential queue_number = 3");
console.log("✓ Scenario 15 Passed: Queue-number spoofing prevented, column default handled, temporary holds get null, and sequential numbers assigned authoritatively.");

// Scenario 16: PayMongo Webhook Verification, Payment Synchronization & Idempotency
// 16a. Authoritative verification updates payment_status, payment_reference, paid_at, and payment_amount
const verifiedPayment = simulatePayMongoFulfillment(
  holdInsert.appointment,
  {
    paymongoPaymentId: "pay_pm_authoritative_999",
    amount: 500,
    currency: "PHP",
    paymentStatus: "paid",
    userId: patientA.userId,
  },
  []
);
assert(verifiedPayment.success, "Scenario 16a: Authoritative payment must succeed");
assert(verifiedPayment.updatedAppointment?.paymentStatus === "paid", "Scenario 16a: Status must be 'paid'");
assert(verifiedPayment.updatedAppointment?.paymentReference === "pay_pm_authoritative_999", "Scenario 16a: Payment reference must match");
assert(verifiedPayment.updatedAppointment?.paymentAmount === 500, "Scenario 16a: Payment amount must match");
assert(verifiedPayment.updatedAppointment?.paidAt !== undefined, "Scenario 16a: paidAt must be set");

// 16b. User mismatch between payment payload and appointment is rejected
const mismatchedPayment = simulatePayMongoFulfillment(
  holdInsert.appointment,
  {
    paymongoPaymentId: "pay_pm_mismatch",
    amount: 500,
    currency: "PHP",
    paymentStatus: "paid",
    userId: patientB.userId, // Wrong user
  },
  []
);
assert(!mismatchedPayment.success && Boolean(mismatchedPayment.error?.includes("ERR_UNAUTHORIZED")), "Scenario 16b: User mismatch must be rejected");

// 16c. Replayed/duplicate webhook event is idempotent and does not re-increment queue number
const firstFulfillment = simulatePayMongoFulfillment(
  holdInsert.appointment,
  {
    paymongoPaymentId: "pay_pm_replay_test",
    amount: 500,
    currency: "PHP",
    paymentStatus: "paid",
    userId: patientA.userId,
  },
  [normalInsert1.appointment]
);
const replayedFulfillment = simulatePayMongoFulfillment(
  firstFulfillment.updatedAppointment!,
  {
    paymongoPaymentId: "pay_pm_replay_test",
    amount: 500,
    currency: "PHP",
    paymentStatus: "paid",
    userId: patientA.userId,
  },
  [normalInsert1.appointment]
);
assert(replayedFulfillment.success, "Scenario 16c: Replayed webhook must be accepted idempotently");
assert(
  replayedFulfillment.updatedAppointment?.queueNumber === firstFulfillment.updatedAppointment?.queueNumber,
  "Scenario 16c: Queue number must not re-increment on duplicate webhook"
);
console.log("✓ Scenario 16 Passed: PayMongo authoritative payment sync verified, user mismatch rejected, and duplicate webhook replay is idempotent.");

// Scenario 17: Slot Hold Reservation, Retry Behavior, Concurrent Lock & Expiry
// 17a. Patient A acquires 10-minute temporary hold
const activeHold = simulateSlotHold(
  clinics[0].clinicId,
  affiliations[0].doctorId,
  `${validFutureDateStr}T16:00:00`,
  "16:00",
  patientA,
  []
);
assert(activeHold.success && !activeHold.isExistingHold, "Scenario 17a: New hold acquisition must succeed");
assert(activeHold.appointment?.paymentStatus === "pending_hold", "Scenario 17a: Payment status must be pending_hold");

// 17b. Concurrent Patient B attempts to hold the same slot -> blocked
const concurrentHoldAttempt = simulateSlotHold(
  clinics[0].clinicId,
  affiliations[0].doctorId,
  `${validFutureDateStr}T16:00:00`,
  "16:00",
  patientB,
  [activeHold.appointment!]
);
assert(!concurrentHoldAttempt.success && concurrentHoldAttempt.code === "ERR_SLOT_UNAVAILABLE", "Scenario 17b: Concurrent user must be blocked with ERR_SLOT_UNAVAILABLE");

// 17c. Patient A retries checkout before expiry -> returns existing hold without ERR_DUPLICATE_SLOT
const retryHold = simulateSlotHold(
  clinics[0].clinicId,
  affiliations[0].doctorId,
  `${validFutureDateStr}T16:00:00`,
  "16:00",
  patientA,
  [activeHold.appointment!]
);
assert(retryHold.success && retryHold.isExistingHold === true, "Scenario 17c: Patient A retry must return existing hold idempotently");
assert(retryHold.appointment?.appointmentId === activeHold.appointment?.appointmentId, "Scenario 17c: Same appointment must be returned on retry");

// 17d. Expired hold is automatically released and can be acquired by Patient B
const expiredHoldAppt: PatientAppointment = {
  ...activeHold.appointment!,
  paymentHoldExpiresAt: new Date(Date.now() - 1000 * 60).toISOString(), // expired 1 minute ago
};
const takeoverAfterExpiry = simulateSlotHold(
  clinics[0].clinicId,
  affiliations[0].doctorId,
  `${validFutureDateStr}T16:00:00`,
  "16:00",
  patientB,
  [expiredHoldAppt]
);
assert(takeoverAfterExpiry.success && takeoverAfterExpiry.appointment?.userId === patientB.userId, "Scenario 17d: Expired hold can be acquired by Patient B");

// 17e. Explicit hold cancellation immediately frees the slot
const cancelledHoldAppt: PatientAppointment = {
  ...activeHold.appointment!,
  status: "cancelled",
  paymentStatus: "cancelled",
};
const bookAfterCancel = simulateSlotHold(
  clinics[0].clinicId,
  affiliations[0].doctorId,
  `${validFutureDateStr}T16:00:00`,
  "16:00",
  patientB,
  [cancelledHoldAppt]
);
assert(bookAfterCancel.success && bookAfterCancel.appointment?.userId === patientB.userId, "Scenario 17e: Cancelled hold slot is immediately bookable");
console.log("✓ Scenario 17 Passed: 10-minute hold reservation, concurrent lock, idempotent retry without ERR_DUPLICATE_SLOT, and expired/cancelled release verified.");

console.log("\n=======================================================");
console.log("All 17 Appointment RLS, Payment & Booking Scenarios PASSED (17/17)");
console.log("=======================================================\n");
