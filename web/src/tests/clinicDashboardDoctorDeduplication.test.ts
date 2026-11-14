import assert from 'node:assert/strict';

interface MockDoctorInfo {
  id: string;
  userId?: string;
  user_id?: string;
  name: string;
  photo?: string;
  photo_url?: string;
  specialization?: string;
  specializations?: { id?: string; name: string }[];
  dutyDays?: string[];
  dutyStartTime?: string;
  dutyEndTime?: string;
  dutySchedule?: any;
  status?: string;
}

// Mirror the exact deduplication and mapping algorithm in ClinicDashboardPage.tsx
function computeOnDutyDoctors(doctors: MockDoctorInfo[], todayDayName: string = "Friday") {
  const rawOnDuty = doctors
    .filter((doc) => doc.status !== "Inactive")
    .map((doc) => {
      let shifts: any[] = doc.dutySchedule?.weeklyShifts?.[todayDayName] || [];

      if (
        shifts.length === 0 &&
        doc.dutyDays &&
        doc.dutyDays.map((d) => d.toLowerCase()).includes(todayDayName.toLowerCase())
      ) {
        shifts = [
          {
            id: `shift-${todayDayName.toLowerCase()}-default`,
            label: "Duty Shift",
            startTime: doc.dutyStartTime || "08:00",
            endTime: doc.dutyEndTime || "17:00",
          },
        ];
      }

      const validShifts = shifts.filter((s: any) => s.startTime && s.endTime);
      if (validShifts.length === 0) return null;

      const hoursDisplay = validShifts.length === 1
        ? `${validShifts[0].startTime} – ${validShifts[0].endTime}`
        : validShifts.map((s: any) => `${s.startTime} – ${s.endTime}`).join(", ");

      const primarySpec =
        doc.specializations && doc.specializations.length > 0 && doc.specializations[0]?.name
          ? doc.specializations[0].name
          : doc.specialization
            ? doc.specialization.split(",")[0].trim()
            : "Clinical Dermatology";

      const cleanDocName = doc.name.trim();
      const displayName = cleanDocName.startsWith("Dr.") ? cleanDocName : `Dr. ${cleanDocName}`;

      return {
        id: doc.id,
        userId: doc.userId || doc.user_id,
        name: doc.name,
        displayName,
        primarySpec,
        hoursDisplay,
        photo: doc.photo || doc.photo_url,
        dutyState: "finished",
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  // Display each unique doctor only once per selected clinic
  const seenDoctorKeys = new Set<string>();
  const uniqueOnDuty: typeof rawOnDuty = [];
  for (const docItem of rawOnDuty) {
    const doctorKey = docItem.userId ? `user:${docItem.userId}` : `doc:${docItem.id}`;
    if (!seenDoctorKeys.has(doctorKey)) {
      seenDoctorKeys.add(doctorKey);
      uniqueOnDuty.push(docItem);
    }
  }
  return uniqueOnDuty;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

console.log("Starting Clinic Dashboard Doctor Deduplication tests...");

// Test 1: Duplicated Dr. Nathan Marquez records with same userId are collapsed into 1 doctor card
const scenarioDoctors: MockDoctorInfo[] = [
  {
    id: "doc-audrey",
    userId: "user-audrey",
    name: "Audrey Lee Saludaga",
    specialization: "Aesthetic Dermatology",
    dutyDays: ["Friday"],
    dutyStartTime: "13:30",
    dutyEndTime: "17:00",
    dutySchedule: {
      weeklyShifts: {
        Friday: [{ startTime: "13:30", endTime: "17:00" }],
      },
    },
    status: "Active",
  },
  {
    id: "doc-nathan-affil-1",
    userId: "user-nathan-marquez",
    name: "Nathan Marquez",
    specialization: "Clinical Dermatology",
    dutyDays: ["Friday"],
    dutyStartTime: "09:00",
    dutyEndTime: "12:00",
    dutySchedule: {
      weeklyShifts: {
        Friday: [{ startTime: "09:00", endTime: "12:00" }],
      },
    },
    status: "Active",
  },
  {
    id: "doc-nathan-affil-2",
    userId: "user-nathan-marquez",
    name: "Nathan Marquez",
    specialization: "Aesthetic Dermatology",
    dutyDays: ["Friday"],
    dutyStartTime: "09:00",
    dutyEndTime: "14:00",
    dutySchedule: {
      weeklyShifts: {
        Friday: [{ startTime: "09:00", endTime: "14:00" }],
      },
    },
    status: "Active",
  },
];

const result1 = computeOnDutyDoctors(scenarioDoctors, "Friday");
assert.equal(result1.length, 2, "On Duty Today must display exactly 2 unique doctors (Audrey + Nathan), not 3");
assert.equal(result1[0].displayName, "Dr. Audrey Lee Saludaga");
assert.equal(result1[1].displayName, "Dr. Nathan Marquez");
assert.equal(result1[1].primarySpec, "Clinical Dermatology");
console.log("✓ Test 1 Passed: Duplicate Nathan Marquez records with same userId are collapsed from 3 to 2 cards.");

// Test 2: Two different doctors who happen to have the same display name are NOT merged
const sameNameDoctors: MockDoctorInfo[] = [
  {
    id: "doc-1",
    userId: "user-alex-1",
    name: "Dr. Alex Tan",
    specialization: "Clinical Dermatology",
    dutyDays: ["Friday"],
    dutyStartTime: "09:00",
    dutyEndTime: "12:00",
    status: "Active",
  },
  {
    id: "doc-2",
    userId: "user-alex-2",
    name: "Dr. Alex Tan",
    specialization: "Pediatric Dermatology",
    dutyDays: ["Friday"],
    dutyStartTime: "13:00",
    dutyEndTime: "17:00",
    status: "Active",
  },
];

const result2 = computeOnDutyDoctors(sameNameDoctors, "Friday");
assert.equal(result2.length, 2, "Two distinct doctors with different user_ids must NOT be merged even if names match");
console.log("✓ Test 2 Passed: Different doctors with identical names are preserved as separate cards.");

// Test 3: Off-duty doctors are excluded and do not affect the count
const mixedDoctors: MockDoctorInfo[] = [
  ...scenarioDoctors,
  {
    id: "doc-clark",
    userId: "user-clark",
    name: "Clark Saludaga",
    specialization: "General Dermatology",
    dutyDays: [], // Off duty
    status: "Active",
  },
];

const result3 = computeOnDutyDoctors(mixedDoctors, "Friday");
assert.equal(result3.length, 2, "Off-duty doctor (Clark) must not be rendered on duty today");
console.log("✓ Test 3 Passed: Off duty doctors remain excluded from On Duty Today.");

console.log("\nAll 3 Clinic Dashboard Doctor Deduplication tests passed successfully!");

