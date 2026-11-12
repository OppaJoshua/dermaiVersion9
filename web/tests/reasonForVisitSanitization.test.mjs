import { test } from 'node:test';
import assert from 'node:assert/strict';

// Pure implementation mirroring web/src/lib/appointmentPaymentService.ts line 44
function sanitizePatientSymptoms(text) {
  if (!text) return null;
  const clean = text
    .replace(/\[Payment:.*?\]/gi, "")
    .replace(/(?:^|\n)?\s*Payment:\s*Paid online[^\n\r]*/gi, "")
    .trim();
  return clean || null;
}

test('1. Legacy appointment: patient reason followed by system payment suffix is cleaned and preserves original words/punctuation', () => {
  const input = "Helo sakit akong bugan\n[Payment: Paid online via MAYA (Ref: 12345, Amount: ₱600.00)]";
  const result = sanitizePatientSymptoms(input);
  assert.equal(result, "Helo sakit akong bugan");
});

test('2. Legacy appointment: ONLY system-generated payment suffix returns null/empty', () => {
  const input = "[Payment: Paid online via GCASH (Ref: pay_abc123, Amount: ₱500.00)]";
  const result = sanitizePatientSymptoms(input);
  assert.equal(result, null);
  // Display fallback check
  const display = result?.trim() || "Not provided";
  assert.equal(display, "Not provided");
});

test('3. Clean appointment: patient reason with no payment suffix remains 100% untouched', () => {
  const input = "Red itchy bumps on neck and face for 3 days";
  const result = sanitizePatientSymptoms(input);
  assert.equal(result, "Red itchy bumps on neck and face for 3 days");
});

test('4. Multiline patient reason: preserves patient line breaks and formatting', () => {
  const input = "Day 1: Itchiness\nDay 2: Redness\nDay 3: Swelling and blistering";
  const result = sanitizePatientSymptoms(input);
  assert.equal(result, "Day 1: Itchiness\nDay 2: Redness\nDay 3: Swelling and blistering");
});

test('5. Legitimate use of the word "payment": preserved without deletion', () => {
  const input = "Need to ask the doctor about payment options for the prescribed ointment";
  const result = sanitizePatientSymptoms(input);
  assert.equal(result, "Need to ask the doctor about payment options for the prescribed ointment");
});

test('6. Legitimate use of "GCash" and "Maya": preserved without deletion', () => {
  const input = "Bought topical steroid using GCash and moisturizers via Maya but rash still spread";
  const result = sanitizePatientSymptoms(input);
  assert.equal(result, "Bought topical steroid using GCash and moisturizers via Maya but rash still spread");
});

test('7. Special characters, brackets, and punctuation: preserved accurately', () => {
  const input = "Severe allergic flare-up [type: contact dermatitis] (cheeks & jawline) — burning sensation!";
  const result = sanitizePatientSymptoms(input);
  assert.equal(result, "Severe allergic flare-up [type: contact dermatitis] (cheeks & jawline) — burning sensation!");
});

test('8. Repeated / Idempotent sanitization: multiple calls never strip additional content', () => {
  const original = "Helo sakit akong bugan\n[Payment: Paid online via MAYA (Ref: 12345, Amount: ₱600.00)]";
  const pass1 = sanitizePatientSymptoms(original);
  const pass2 = sanitizePatientSymptoms(pass1);
  const pass3 = sanitizePatientSymptoms(pass2);
  assert.equal(pass1, "Helo sakit akong bugan");
  assert.equal(pass2, "Helo sakit akong bugan");
  assert.equal(pass3, "Helo sakit akong bugan");
});

test('9. Scheduled appointment card reason display logic simulation', () => {
  const legacyAppt = {
    notes: "Helo sakit akong bugan\n[Payment: Paid online via MAYA (Ref: ..., Amount: ₱600.00)]",
    conditionName: "Eczema",
  };
  const cardDisplay = sanitizePatientSymptoms(legacyAppt.notes) || legacyAppt.conditionName || "Not provided";
  assert.equal(cardDisplay, "Helo sakit akong bugan");

  const emptyNotesAppt = {
    notes: "[Payment: Paid online via GCASH (Ref: 999, Amount: ₱600.00)]",
    conditionName: "Acne Vulgaris",
  };
  const emptyCardDisplay = sanitizePatientSymptoms(emptyNotesAppt.notes) || emptyNotesAppt.conditionName || "Not provided";
  assert.equal(emptyCardDisplay, "Acne Vulgaris");
});

test('10. Consultation & Clinical Result modal reason display logic simulation', () => {
  const legacyModalAppt = {
    notes: "Helo sakit akong bugan\n[Payment: Paid online via MAYA (Ref: ..., Amount: ₱600.00)]",
  };
  const modalDisplay = sanitizePatientSymptoms(legacyModalAppt.notes)?.trim() || "Not provided";
  assert.equal(modalDisplay, "Helo sakit akong bugan");

  const missingModalAppt = {
    notes: "[Payment: Paid online via MAYA (Ref: ..., Amount: ₱600.00)]",
  };
  const missingModalDisplay = sanitizePatientSymptoms(missingModalAppt.notes)?.trim() || "Not provided";
  assert.equal(missingModalDisplay, "Not provided");
});

test('11. Doctor Dashboard consultation modal reason display logic simulation', () => {
  const consultingAppt = {
    notes: "Helo sakit akong bugan\n[Payment: Paid online via MAYA (Ref: ..., Amount: ₱600.00)]",
    conditionName: "Atopic Dermatitis",
  };
  const shouldRenderSection = Boolean(sanitizePatientSymptoms(consultingAppt.notes) || consultingAppt.conditionName);
  const sectionText = sanitizePatientSymptoms(consultingAppt.notes) || consultingAppt.conditionName;
  assert.equal(shouldRenderSection, true);
  assert.equal(sectionText, "Helo sakit akong bugan");
});

test('12. Null, undefined, and empty string handling', () => {
  assert.equal(sanitizePatientSymptoms(null), null);
  assert.equal(sanitizePatientSymptoms(undefined), null);
  assert.equal(sanitizePatientSymptoms(""), null);
  assert.equal(sanitizePatientSymptoms("   "), null);
});
