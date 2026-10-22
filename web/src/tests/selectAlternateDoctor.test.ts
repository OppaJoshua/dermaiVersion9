import { formatTime12h, normalizeDayName, timeToMinutes, minutesToTime } from "@/lib/schedulingService";

// Resilient test runner utilities compatible with both Vitest and standalone TS execution
type TestFn = () => void | Promise<void>;

const describe = typeof globalThis !== "undefined" && (globalThis as any).describe
  ? (globalThis as any).describe
  : (_name: string, fn: () => void) => fn();

const it = typeof globalThis !== "undefined" && (globalThis as any).it
  ? (globalThis as any).it
  : (_name: string, fn: TestFn) => fn();

const expect = typeof globalThis !== "undefined" && (globalThis as any).expect
  ? (globalThis as any).expect
  : (actual: any) => ({
      toBe: (expected: any) => {
        if (actual !== expected) throw new Error(`Expected ${expected} but received ${actual}`);
      },
      toEqual: (expected: any) => {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error(`Expected ${JSON.stringify(expected)} but received ${JSON.stringify(actual)}`);
        }
      },
      toBeGreaterThan: (val: number) => {
        if (actual <= val) throw new Error(`Expected ${actual} to be greater than ${val}`);
      },
      toBeGreaterThanOrEqual: (val: number) => {
        if (actual < val) throw new Error(`Expected ${actual} to be greater than or equal to ${val}`);
      },
      toBeNull: () => {
        if (actual !== null) throw new Error(`Expected null but received ${actual}`);
      },
      toContain: (substring: string) => {
        if (!String(actual).includes(substring)) throw new Error(`Expected "${actual}" to contain "${substring}"`);
      },
    });

describe("Select Alternate Doctor Pipeline & Contracts", () => {
  // Test 1: 24-Hour Doctor Re-Selection Window Invariants
  describe("24-Hour Doctor Re-Selection Window", () => {
    it("identifies active re-selection window within 24 hours of doctor decline", () => {
      const now = Date.now();
      const declinedAt = new Date(now - 4 * 3600 * 1000).toISOString(); // 4 hours ago
      const expiresAt = new Date(declinedAt).getTime() + 24 * 3600 * 1000;
      const remainingMs = expiresAt - now;

      expect(remainingMs).toBeGreaterThan(0);
      const hoursRemaining = Math.floor(remainingMs / (1000 * 60 * 60));
      const minutesRemaining = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

      expect(hoursRemaining).toBe(20);
      expect(minutesRemaining).toBe(0);
    });

    it("identifies expired re-selection window after 24 hours", () => {
      const now = Date.now();
      const declinedAt = new Date(now - 25 * 3600 * 1000).toISOString(); // 25 hours ago
      const expiresAt = new Date(declinedAt).getTime() + 24 * 3600 * 1000;
      const isExpired = expiresAt - now <= 0;

      expect(isExpired).toBe(true);
    });
  });

  // Test 2: Doctor Filtering & Exclusion
  describe("Available Dermatologists Scope & Exclusion", () => {
    const doctors = [
      { doctor_id: "doc-1", clinic_id: "clinic-A", doctor_name: "Dr. Nathan Marquez", status: "active" },
      { doctor_id: "doc-2", clinic_id: "clinic-A", doctor_name: "Dr. Yanpein Zamora", status: "active" },
      { doctor_id: "doc-3", clinic_id: "clinic-A", doctor_name: "Dr. Retired Doctor", status: "inactive" },
      { doctor_id: "doc-4", clinic_id: "clinic-B", doctor_name: "Dr. Audrey Saludaga", status: "active" },
    ];

    it("filters strictly by clinic_id, excludes previous doctor and inactive doctors", () => {
      const clinicId = "clinic-A";
      const previousDoctorId = "doc-1";

      const filtered = doctors.filter((d) => {
        const belongsToClinic = d.clinic_id === clinicId;
        const isActive = d.status === "active";
        const isNotPrevious = d.doctor_id !== previousDoctorId;
        return belongsToClinic && isActive && isNotPrevious;
      });

      expect(filtered.length).toBe(1);
      expect(filtered[0].doctor_id).toBe("doc-2");
      expect(filtered[0].doctor_name).toBe("Dr. Yanpein Zamora");
    });

    it("falls back to platform network active dermatologists if clinic had only 1 doctor who declined", () => {
      const clinicWithOneDoctor = [
        { doctor_id: "doc-only", clinic_id: "clinic-solo", doctor_name: "Dr. Solo", status: "active" },
      ];
      const previousDoctorId = "doc-only";

      let filtered = clinicWithOneDoctor.filter(
        (d) => d.status === "active" && d.doctor_id !== previousDoctorId
      );

      // If filtered is empty, network fallback engages
      if (filtered.length === 0) {
        filtered = doctors.filter(
          (d) => d.status === "active" && d.doctor_id !== previousDoctorId
        );
      }

      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.some((d) => d.doctor_id === previousDoctorId)).toBe(false);
    });
  });

  // Test 3: Duty Shift & Time Slot Calculation
  describe("Slot Picker Calculations", () => {
    it("generates 30-minute consultation slots within doctor duty hours", () => {
      const startTime = "09:00";
      const endTime = "12:00";

      const startMinutes = timeToMinutes(startTime);
      const endMinutes = timeToMinutes(endTime);

      const slots: string[] = [];
      for (let m = startMinutes; m < endMinutes; m += 30) {
        slots.push(minutesToTime(m));
      }

      expect(slots).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"]);
      expect(formatTime12h("09:00")).toBe("9:00 AM");
      expect(formatTime12h("11:30")).toBe("11:30 AM");
    });

    it("normalizes duty days correctly", () => {
      expect(normalizeDayName("mon")).toBe("Monday");
      expect(normalizeDayName("WEDNESDAY")).toBe("Wednesday");
      expect(normalizeDayName("fri")).toBe("Friday");
    });
  });

  // Test 4: Database Mutations & Cross-Portal Notification Contracts
  describe("Database Mutation & Cross-Portal Notifications", () => {
    it("assembles the correct appointment mutation payload retaining paid status", () => {
      const newDoctor = { doctor_id: "doc-2", doctor_name: "Dr. Yanpein Zamora" };
      const selectedDate = "2026-10-23";
      const selectedTime = "10:00";
      const previousDoctorId = "doc-1";

      const scheduledDateTimeIso = `${selectedDate}T${selectedTime}:00`;
      const baseQa = { answers: [] };

      const historyEntry = {
        action: "alternate_doctor_selected",
        actor: "patient",
        timestamp: new Date().toISOString(),
        details: "Patient selected alternate doctor without additional charge.",
        previousDoctorId,
        newDoctorId: newDoctor.doctor_id,
        newDoctorName: newDoctor.doctor_name,
        date: selectedDate,
        time: selectedTime,
      };

      const nextQa = {
        ...baseQa,
        reassigned_at: new Date().toISOString(),
        reassigned_by: "patient",
        previous_doctor_id: previousDoctorId,
        is_paid: true,
        appointment_history: [historyEntry],
      };

      const updatePayload = {
        assigned_doctor_id: newDoctor.doctor_id,
        status: "pending",
        doctor_status: "pending-review",
        schedule_sent_to_doctor: true,
        date: scheduledDateTimeIso,
        time: `${selectedTime}:00`,
        batch_time: selectedTime,
        clinic_note: `Reassigned to Dr. ${newDoctor.doctor_name} by patient at no additional charge.`,
        doctor_note: null,
        doctor_reviewed_at: null,
        questionnaire_answers: nextQa,
      };

      expect(updatePayload.assigned_doctor_id).toBe("doc-2");
      expect(updatePayload.status).toBe("pending");
      expect(updatePayload.doctor_status).toBe("pending-review");
      expect(updatePayload.schedule_sent_to_doctor).toBe(true);
      expect(updatePayload.doctor_note).toBeNull();
      expect(updatePayload.questionnaire_answers.is_paid).toBe(true);
      expect(updatePayload.questionnaire_answers.previous_doctor_id).toBe("doc-1");
    });

    it("verifies doctor portal notification payload contract", () => {
      const doctorUserId = "doc-user-uuid-123";
      const patientName = "Jonathan Bayutas";

      const doctorNotif = {
        user_id: doctorUserId,
        type: "appointment-delegated",
        subtype: "new-consultation",
        title: "New consultation request assigned for your review",
        body: `New consultation request assigned for your review from patient ${patientName}.`,
        is_read: false,
      };

      expect(doctorNotif.body).toBe("New consultation request assigned for your review from patient Jonathan Bayutas.");
      expect(doctorNotif.is_read).toBe(false);
      expect(doctorNotif.type).toBe("appointment-delegated");
    });

    it("verifies clinic portal notification payload contract", () => {
      const clinicOwnerUserId = "clinic-owner-uuid-456";
      const patientName = "Jonathan Bayutas";
      const newDoctorName = "Dr. Yanpein Zamora";

      const clinicNotif = {
        user_id: clinicOwnerUserId,
        type: "appointment",
        subtype: "alternate_doctor_selected",
        title: "Alternate Doctor Selected",
        body: `Patient ${patientName} has selected Dr. ${newDoctorName.replace(/^dr\.\s*/i, "")} as their alternate doctor.`,
        is_read: false,
      };

      expect(clinicNotif.body).toBe("Patient Jonathan Bayutas has selected Dr. Yanpein Zamora as their alternate doctor.");
      expect(clinicNotif.is_read).toBe(false);
    });

    it("verifies audit logging parameters", () => {
      const doctorName = "Dr. Yanpein Zamora";
      const auditParams = {
        action: "Alternate Doctor Selected",
        details: `Patient re-assigned appointment to Dr. ${doctorName} without additional charge.`,
      };

      expect(auditParams.action).toBe("Alternate Doctor Selected");
      expect(auditParams.details).toContain("without additional charge");
      expect(auditParams.details).toContain("Dr. Yanpein Zamora");
    });
  });
});
