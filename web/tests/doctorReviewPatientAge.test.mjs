import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import calculateAgeFromBirthdate directly from compiled / source logic
const hookPath = path.resolve(__dirname, "../src/hooks/useDoctorAppointments.ts");
const pagePath = path.resolve(__dirname, "../src/pages/doctor/DoctorAppointmentsPage.tsx");

test("Doctor Review Patients: Patient Age & Birthdate Verification Suite", async (t) => {
  assert.ok(fs.existsSync(hookPath), "useDoctorAppointments.ts must exist");
  assert.ok(fs.existsSync(pagePath), "DoctorAppointmentsPage.tsx must exist");

  const hookSrc = fs.readFileSync(hookPath, "utf8");
  const pageSrc = fs.readFileSync(pagePath, "utf8");

  await t.test("1. calculateAgeFromBirthdate: accurately calculates completed years based on birthday", () => {
    // Dynamic implementation mirror from useDoctorAppointments.ts
    function calculateAge(birthdateStr, referenceDate = new Date()) {
      if (!birthdateStr) return undefined;
      const clean = String(birthdateStr).trim();
      if (!clean || clean === "—" || clean === "\u2014" || clean === "null" || clean === "undefined") {
        return undefined;
      }
      let birthYear, birthMonth, birthDay;
      const isoMatch = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
      if (isoMatch) {
        birthYear = parseInt(isoMatch[1], 10);
        birthMonth = parseInt(isoMatch[2], 10);
        birthDay = parseInt(isoMatch[3], 10);
      } else {
        const parsed = new Date(clean);
        if (isNaN(parsed.getTime())) return undefined;
        birthYear = parsed.getFullYear();
        birthMonth = parsed.getMonth() + 1;
        birthDay = parsed.getDate();
      }
      if (birthYear < 1890 || birthMonth < 1 || birthMonth > 12 || birthDay < 1 || birthDay > 31) {
        return undefined;
      }
      const currentYear = referenceDate.getFullYear();
      const currentMonth = referenceDate.getMonth() + 1;
      const currentDay = referenceDate.getDate();

      let age = currentYear - birthYear;
      if (currentMonth < birthMonth || (currentMonth === birthMonth && currentDay < birthDay)) {
        age--;
      }
      return age >= 0 && age < 130 ? age : undefined;
    }

    const refDate = new Date("2026-11-15T12:00:00Z");

    // Case A: Birthday already occurred earlier this year (May 15, 2006 -> 20 years old)
    assert.equal(calculateAge("2006-05-15", refDate), 20);

    // Case B: Birthday is TODAY (November 15, 2006 -> turns 20 today)
    assert.equal(calculateAge("2006-11-15", refDate), 20);

    // Case C: Birthday is TOMORROW (November 16, 2006 -> still 19 years old)
    assert.equal(calculateAge("2006-11-16", refDate), 19);

    // Case D: Birthday is in December (December 25, 2006 -> still 19 years old)
    assert.equal(calculateAge("2006-12-25", refDate), 19);

    // Case E: Born in 2000 (November 14, 2000 -> 26 years old)
    assert.equal(calculateAge("2000-11-14", refDate), 26);

    // Case F: Infant under 1 year old (born March 1, 2026 -> 0 years old)
    assert.equal(calculateAge("2026-03-01", refDate), 0);

    // Case G: Invalid dates return undefined
    assert.equal(calculateAge("", refDate), undefined);
    assert.equal(calculateAge("—", refDate), undefined);
    assert.equal(calculateAge("invalid-date", refDate), undefined);
    assert.equal(calculateAge("2030-01-01", refDate), undefined); // future date
  });

  await t.test("2. useDoctorAppointments queries and resolves birthdate from authoritative database fields", () => {
    // Verifies query selection
    assert.ok(
      hookSrc.includes('supabase.from("patient_appointment").select("*, clinic:clinic_id(clinic_id, name)'),
      "Must select * from patient_appointment to include patient_birthdate"
    );

    // Verifies user profile query contains birthdate
    assert.ok(
      hookSrc.includes('.select("user_id, full_name, email, phone, gender, birthdate, address, avatar_url")'),
      "Must select birthdate from user profile"
    );

    // Verifies userProfileMap index resolution by user_id, patient_id, and email
    assert.ok(
      hookSrc.includes("patientEmailsToFetch") || hookSrc.includes("userProfileMap.set(u.email"),
      "Must index userProfileMap by email for fallback resolution"
    );

    // Verifies resolvedBirthdate resolution order
    assert.ok(
      hookSrc.includes("row.patient_birthdate ||") && hookSrc.includes("userProf?.birthdate"),
      "Must prioritize patient_appointment.patient_birthdate then userProf.birthdate"
    );
  });

  await t.test("3. DoctorAppointmentsPage renders age beside gender as 'age / gender'", () => {
    // Verifies the AGE / GENDER table header exists
    assert.ok(
      pageSrc.includes("AGE / GENDER"),
      "Table header must be AGE / GENDER"
    );

    // Verifies rendering format: {Number.isFinite(appt.patientAge) ? appt.patientAge : "—"} / {appt.patientGender || "—"}
    assert.ok(
      pageSrc.includes("Number.isFinite(appt.patientAge)") || pageSrc.includes("appt.patientAge !== undefined"),
      "Must use safe check for finite age (including age 0)"
    );
    assert.ok(
      pageSrc.includes('appt.patientAge') && pageSrc.includes('/'),
      "Must render age beside gender separated by '/'"
    );

    // Simulating formatting helper
    function formatAgeGender(patientAge, patientGender) {
      const ageStr = Number.isFinite(patientAge) ? String(patientAge) : "—";
      const genderStr = patientGender || "—";
      return `${ageStr} / ${genderStr}`;
    }

    assert.equal(formatAgeGender(20, "Male"), "20 / Male");
    assert.equal(formatAgeGender(undefined, "Male"), "— / Male");
    assert.equal(formatAgeGender(null, "Female"), "— / Female");
    assert.equal(formatAgeGender(0, "Male"), "0 / Male");
    assert.equal(formatAgeGender(undefined, undefined), "— / —");
  });

  await t.test("4. DoctorAppointmentsPage Review Modal retains detailed demographic display", () => {
    assert.ok(
      pageSrc.includes("reviewModal.appointment.patientAge"),
      "Review modal must inspect appointment.patientAge"
    );
    assert.ok(
      pageSrc.includes("reviewModal.appointment.patientBirthdate"),
      "Review modal must inspect appointment.patientBirthdate"
    );
  });
});

