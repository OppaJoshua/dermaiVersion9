import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appointmentPagePath = path.resolve(__dirname, "../src/pages/patient/AppointmentPage.tsx");

test("AppointmentPage agreement acknowledgment and terms modal verification", async (t) => {
  assert.ok(fs.existsSync(appointmentPagePath), "AppointmentPage.tsx must exist");
  const src = fs.readFileSync(appointmentPagePath, "utf8");

  await t.test("1. Checkbox state starts unchecked", () => {
    assert.match(
      src,
      /const\s*\[termsAccepted,\s*setTermsAccepted\]\s*=\s*useState\(false\);/,
      "termsAccepted must initialize to false"
    );
    assert.match(
      src,
      /const\s*\[showTermsModal,\s*setShowTermsModal\]\s*=\s*useState\(false\);/,
      "showTermsModal must initialize to false"
    );
  });

  await t.test("2. Navigating back to Step 1 resets the agreement checkbox", () => {
    const prevStepFn = src.match(/const handlePrevStep = \(\) => \{[\s\S]*?\};/)?.[0];
    assert.ok(prevStepFn, "handlePrevStep function must be present");
    assert.match(prevStepFn, /setTermsAccepted\(false\);/, "handlePrevStep must reset termsAccepted to false");
  });

  await t.test("3. Agreement checkbox is positioned below Fee and above Proceed to Payment", () => {
    const feeIndex = src.indexOf("Payable Online");
    const checkboxIndex = src.indexOf("appointment terms and payment conditions");
    const proceedPaymentIndex = src.indexOf("Proceed to Payment");

    assert.ok(feeIndex > 0, "Fee summary section must exist");
    assert.ok(checkboxIndex > 0, "Agreement checkbox must exist");
    assert.ok(proceedPaymentIndex > 0, "Proceed to Payment button must exist");

    assert.ok(
      feeIndex < checkboxIndex,
      "Agreement checkbox must appear BELOW the Consultation Summary fee"
    );
    assert.ok(
      checkboxIndex < proceedPaymentIndex,
      "Agreement checkbox must appear ABOVE the Proceed to Payment button"
    );
  });

  await t.test("4. Proceed to Payment button is disabled while termsAccepted is false", () => {
    const buttonBlock = src.match(/onClick=\{\(\) => handleSubmitAppointment\(\)\}[\s\S]*?<\/button>/)?.[0];
    assert.ok(buttonBlock, "Proceed to Payment button block must be found");
    assert.match(
      buttonBlock,
      /!termsAccepted/,
      "Button disabled prop must require termsAccepted to be true"
    );
    assert.match(
      buttonBlock,
      /disabled:opacity-50 disabled:cursor-not-allowed/,
      "Button must have standard disabled styling when unchecked"
    );
    assert.match(
      buttonBlock,
      /bg-magenta-600 hover:bg-magenta-700 text-white/,
      "Button must preserve vibrant DermAI magenta styling when enabled"
    );
  });

  await t.test("5. handleSubmitAppointment has defensive guard against unaccepted terms", () => {
    const submitFn = src.match(/const handleSubmitAppointment = async \([\s\S]*?evaluateAppointmentSubmission/)?.[0];
    assert.ok(submitFn, "handleSubmitAppointment function header must be found");
    assert.match(
      submitFn,
      /if\s*\(!termsAccepted\)\s*\{\s*return;\s*\}/,
      "handleSubmitAppointment must return early if termsAccepted is false"
    );
  });

  await t.test("6. Clicking underlined terms opens modal without toggling checkbox or initiating payment", () => {
    assert.match(
      src,
      /e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*setShowTermsModal\(true\);/,
      "Clicking terms text must call stopPropagation and open modal without toggling checkbox"
    );
    assert.match(
      src,
      /text-magenta-600 hover:text-magenta-700 underline underline-offset-2 font-semibold/,
      "Terms text must be styled in DermAI magenta with underline"
    );
  });

  await t.test("7. Terms modal contains required title, disclosures, and clean close button", () => {
    assert.match(
      src,
      /<ModalPortal isOpen=\{Boolean\(showTermsModal\)\}>/,
      "showTermsModal must be rendered via ModalPortal"
    );
    assert.match(
      src,
      /Appointment Terms &amp; Payment Conditions/,
      "Modal must be titled 'Appointment Terms & Payment Conditions'"
    );
    assert.match(
      src,
      /Payment and Appointment Confirmation/,
      "Modal must include Payment and Appointment Confirmation section"
    );
    assert.match(
      src,
      /Rescheduling/,
      "Modal must include Rescheduling section"
    );
    assert.match(
      src,
      /Cancellation and Refunds/,
      "Modal must include Cancellation and Refunds section"
    );
    assert.match(
      src,
      /Important/,
      "Modal must include Important section"
    );
    assert.match(
      src,
      /Payment does not automatically mean that the dermatologist has accepted or approved the consultation/,
      "Modal must disclose that payment does not auto-approve consultation"
    );
    assert.match(
      src,
      /Notice: This document provides product terms and payment disclosures and does not waive statutory consumer rights under Philippine law/,
      "Modal must include statutory consumer rights notice and legal review disclaimer"
    );
  });

  await t.test("8. Closing modal does not check termsAccepted or trigger payment", () => {
    const modalSection = src.match(/<ModalPortal isOpen=\{Boolean\(showTermsModal\)\}>[\s\S]*?<\/ModalPortal>/)?.[0];
    assert.ok(modalSection, "showTermsModal portal block must be found");
    assert.ok(!modalSection.includes("setTermsAccepted(true)"), "Modal close must never set termsAccepted to true");
    assert.ok(!modalSection.includes("handleSubmitAppointment"), "Modal must never invoke handleSubmitAppointment");
  });
});

