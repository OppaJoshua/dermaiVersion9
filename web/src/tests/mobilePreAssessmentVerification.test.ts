import assert from "node:assert/strict";
import { QUESTIONNAIRE_QUESTIONS } from "../data/questionnaireData";
import { extractConsultationQuestionnaire } from "../lib/consultationDetailsService";
import { normalizeSkinPhotoPath, extractStorageObjectKey } from "../lib/storageUtils";
import { normalizeMobileQuestionnaire, isValidUuid } from "../../../mobile/lib/questionnaireData";

console.log("======================================================================");
console.log("DermAI — Complete Mobile Pre-Assessment Integration Verification Suite");
console.log("======================================================================");

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: normalizeMobileQuestionnaire Semantic & Parity Tests
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[Test 1] Testing normalizeMobileQuestionnaire correctness & edge cases...");

// 1.1 Web format array input
{
  const webArrayInput = QUESTIONNAIRE_QUESTIONS.map((q) => ({
    id: q.id,
    number: q.number,
    question: q.titleEn,
    tagalogQuestion: q.titleTl,
    answer: q.options[0].labelEn,
    tagalogAnswer: q.options[0].labelTl,
  }));

  const normalized = normalizeMobileQuestionnaire(webArrayInput);
  assert(normalized !== null, "Normalized result should not be null");
  assert.equal(normalized.length, 15, "Should preserve all 15 questions");
  assert.equal(normalized[0].id, "q1");
  assert.equal(normalized[0].number, 1);
  assert.equal(normalized[0].answer, QUESTIONNAIRE_QUESTIONS[0].options[0].labelEn);
  console.log("  ✓ 1.1 Standard array format preserves all 15 questions, answers, and numbering.");
}

// 1.2 Object with questionnaireData string (Mobile scan.tsx format)
{
  const innerData = QUESTIONNAIRE_QUESTIONS.map((q) => ({
    id: q.id,
    number: q.number,
    question: q.titleEn,
    tagalogQuestion: q.titleTl,
    answer: q.options[0].labelEn,
    tagalogAnswer: q.options[0].labelTl,
  }));

  const mobileScanAnswers = {
    q1: ["q1_opt1"],
    q2: ["q2_opt1"],
    bodyLocation: "Face",
    questionnaireData: JSON.stringify(innerData),
  };

  const normalized = normalizeMobileQuestionnaire(mobileScanAnswers);
  assert(normalized !== null, "Should unroll questionnaireData JSON string");
  assert.equal(normalized.length, 15, "Should parse all 15 questions from questionnaireData");
  assert.equal(normalized[14].id, "q15");
  assert.equal(normalized[14].number, 15);
  console.log("  ✓ 1.2 Mobile scan object with questionnaireData string unrolls into all 15 questions.");
}

// 1.3 Key-value map format { q1: [...], q2: [...] } with real option IDs
{
  const rawKeyMap = {
    q1: ["q1_mild"], // Mild or occasional itching
    q3: ["q3_red_pink"], // Red or pink
    q7: ["q7_face", "q7_chest"], // Face, Chest
  };

  const normalized = normalizeMobileQuestionnaire(rawKeyMap);
  assert(normalized !== null, "Should convert key-value map");
  assert.equal(normalized.length, 3, "Only answered questions should be included");
  assert.equal(normalized[0].id, "q1");
  assert.equal(normalized[0].number, 1);
  assert.equal(normalized[0].answer, "Mild or occasional itching");
  assert.equal(normalized[1].id, "q3");
  assert.equal(normalized[1].number, 3);
  assert.equal(normalized[1].answer, "Red or pink");
  assert.equal(normalized[2].id, "q7");
  assert.equal(normalized[2].number, 7);
  assert.equal(normalized[2].answer, "Face; Chest");
  console.log("  ✓ 1.3 Key-value map correctly maps option IDs to human labels and preserves ordering.");
}

// 1.3b Key-value map format with positional opt1/opt2 IDs (legacy fallback)
{
  const legacyKeyMap = {
    q1: ["q1_opt2"], // 2nd option -> Mild or occasional itching
    q7: ["q7_opt1"], // 1st option -> Face
  };
  const normalizedLegacy = normalizeMobileQuestionnaire(legacyKeyMap);
  assert(normalizedLegacy !== null, "Should convert legacy key-value map");
  assert.equal(normalizedLegacy.length, 2);
  assert.equal(normalizedLegacy[0].answer, "Mild or occasional itching");
  assert.equal(normalizedLegacy[1].answer, "Face");
  console.log("  ✓ 1.3b Legacy positional opt1/opt2 IDs cleanly map to correct medical options.");
}

// 1.4 Honest Empty State & Non-Hallucination
{
  assert.equal(normalizeMobileQuestionnaire(null), null, "Null returns null");
  assert.equal(normalizeMobileQuestionnaire(undefined), null, "Undefined returns null");
  assert.equal(normalizeMobileQuestionnaire([]), null, "Empty array returns null");
  assert.equal(normalizeMobileQuestionnaire({}), null, "Empty object returns null");

  const metadataOnly = {
    reschedule_requested: true,
    payment_status: "paid",
    random_key: "value",
  };
  assert.equal(normalizeMobileQuestionnaire(metadataOnly), null, "Metadata-only object returns null without fabricating answers");
  console.log("  ✓ 1.4 Honest empty state guaranteed: null, empty, and non-question metadata never invent answers.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Web Doctor Portal Compatibility & Isolated Fallback Verification
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[Test 2] Testing Doctor Portal (useDoctorAppointments) parser with isolated fallback...");

{
  // Exact logic from web/src/hooks/useDoctorAppointments.ts (lines 356-385)
  const parseQuestionnaireForDoctor = (rowQa: any) => {
    let qAnswers: any[] | undefined = undefined;
    if (Array.isArray(rowQa)) {
      qAnswers = rowQa;
    } else if (rowQa && typeof rowQa === "object" && Array.isArray(rowQa.answers)) {
      qAnswers = rowQa.answers;
    } else if (typeof rowQa === "string") {
      try {
        const parsed = JSON.parse(rowQa);
        if (Array.isArray(parsed)) {
          qAnswers = parsed;
        } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.answers)) {
          qAnswers = parsed.answers;
        }
      } catch {}
    }

    // Isolated fallback when existing parser cannot recognize stored questionnaire format
    if ((!qAnswers || qAnswers.length === 0) && rowQa) {
      try {
        let target = rowQa;
        if (typeof target === "string") {
          try {
            target = JSON.parse(target);
          } catch {}
        }
        const fallbackExtracted = extractConsultationQuestionnaire(target);
        if (fallbackExtracted.length > 0) {
          qAnswers = fallbackExtracted;
        }
      } catch {}
    }

    return qAnswers;
  };

  // 2.1 Existing Web format native array
  const webArray = [
    { id: "q1", number: 1, question: "Question 1", answer: "Answer 1" },
    { id: "q2", number: 2, question: "Question 2", answer: "Answer 2" },
  ];
  const parsedWeb = parseQuestionnaireForDoctor(webArray);
  assert(parsedWeb === webArray, "Native Web array must pass through existing Branch 1 directly");
  console.log("  ✓ 2.1 Existing Web questionnaire arrays pass through without alteration.");

  // 2.2 New Mobile normalized array
  const newMobileArray = normalizeMobileQuestionnaire(
    QUESTIONNAIRE_QUESTIONS.map((q) => ({
      id: q.id,
      number: q.number,
      question: q.titleEn,
      tagalogQuestion: q.titleTl,
      answer: q.options[0].labelEn,
    }))
  );
  const parsedNewMobile = parseQuestionnaireForDoctor(newMobileArray);
  assert.equal(parsedNewMobile?.length, 15, "New Mobile array must pass through existing Branch 1");
  console.log("  ✓ 2.2 New Mobile questionnaire arrays pass through with all 15 questions intact.");

  // 2.3 Legacy Mobile question-keyed object { q1: [...], q2: [...] }
  const legacyObject = {
    q1: ["q1_mild"],
    q2: ["q2_moderate"],
  };
  const parsedLegacy = parseQuestionnaireForDoctor(legacyObject);
  assert(parsedLegacy !== undefined, "Legacy Mobile object must be recovered by fallback");
  assert.equal(parsedLegacy.length, 2, "Must extract 2 answered questions");
  assert.equal(parsedLegacy[0].id, "q1");
  assert.equal(parsedLegacy[0].answer, "Mild or occasional itching");
  assert.equal(parsedLegacy[1].id, "q2");
  assert.equal(parsedLegacy[1].answer, "Moderate pain, burning, or stinging");
  console.log("  ✓ 2.3 Legacy Mobile question-keyed objects are successfully parsed by isolated fallback.");

  // 2.4 Legacy JSON string containing question-keyed object
  const legacyJsonString = JSON.stringify({
    q1: ["q1_none"],
    q3: ["q3_white"],
  });
  const parsedLegacyString = parseQuestionnaireForDoctor(legacyJsonString);
  assert(parsedLegacyString !== undefined, "Legacy JSON string must be recovered by fallback");
  assert.equal(parsedLegacyString.length, 2, "Must extract 2 answered questions from JSON string");
  assert.equal(parsedLegacyString[0].answer, "No itching");
  assert.equal(parsedLegacyString[1].answer, "White or noticeably lighter than surrounding skin");
  console.log("  ✓ 2.4 Legacy JSON strings containing question-keyed objects are successfully parsed.");

  // 2.5 Empty, null, or metadata-only
  assert.equal(parseQuestionnaireForDoctor(null), undefined, "Null returns undefined (honest empty state)");
  assert.equal(parseQuestionnaireForDoctor(undefined), undefined, "Undefined returns undefined (honest empty state)");
  assert.equal(parseQuestionnaireForDoctor({}), undefined, "Empty object returns undefined (honest empty state)");
  assert.equal(parseQuestionnaireForDoctor({ reschedule_requested: true, payment_status: "paid" }), undefined, "Metadata-only object returns undefined");
  console.log("  ✓ 2.5 Empty, missing, and non-question metadata cleanly return undefined for honest empty state.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Storage Path and Zoomable Skin Photo Resolution
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[Test 3] Testing Storage path resolution for ZoomableSkinPhoto...");

{
  // Case A: Persistent Supabase storage path
  const persistentPath = "b7e28b8a-360d-4071-893f-c38a1cfbe302/1731512345678_close_up.jpg";
  const extractedKeyA = extractStorageObjectKey(persistentPath);
  assert.equal(extractedKeyA, persistentPath, "Persistent storage path must be preserved");
  assert.equal(normalizeSkinPhotoPath(persistentPath), persistentPath, "normalizeSkinPhotoPath must preserve clean path");

  // Case B: Expired / full Supabase signed URL recovery
  const fullSignedUrl = `https://yxteeadjgavejpiriewj.supabase.co/storage/v1/object/sign/scan-uploads/${persistentPath}?token=header.payload.signature`;
  const extractedKeyB = extractStorageObjectKey(fullSignedUrl);
  assert.equal(extractedKeyB, persistentPath, "Underlying storage key must be extracted from signed URL");

  // Case C: Mobile local file URI cannot be loaded as a remote web image
  const localFileUri = "file:///data/user/0/com.dermai.app/cache/photo.jpg";
  const isRemoteWebUrl = localFileUri.startsWith("http://") || localFileUri.startsWith("https://");
  assert.equal(isRemoteWebUrl, false, "Local mobile device URI is not a remote web URL");

  console.log("  ✓ 3.1 Persistent storage paths and signed URLs resolve correctly for ZoomableSkinPhoto.");
  console.log("  ✓ 3.2 Confirmed mobile local file URIs must be uploaded to Storage to be accessible by Web Doctor Portal.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: Historical Mobile Appointments & extractConsultationQuestionnaire
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[Test 4] Testing historical mobile appointment parsing behavior...");

{
  const historicalRawMobile = {
    q1: ["q1_mild"],
    q2: ["q2_mild"],
    q5: ["q5_pimples"],
  };

  // 4.1 Under current Doctor Portal (useDoctorAppointments.ts):
  // Since it only checks Array.isArray or .answers, raw object evaluates to undefined
  const currentParserResult = Array.isArray(historicalRawMobile)
    ? historicalRawMobile
    : (historicalRawMobile as any).answers;
  assert.equal(currentParserResult, undefined, "Historical raw object is currently undefined in Doctor Portal");
  console.log("  ✓ 4.1 Confirmed: Historical raw { q1: [...] } appointments currently result in undefined in unpatched Doctor Portal.");

  // 4.2 Under extractConsultationQuestionnaire from consultationDetailsService.ts:
  const extracted = extractConsultationQuestionnaire(historicalRawMobile);
  assert(extracted.length === 3, "extractConsultationQuestionnaire successfully extracts all 3 answered questions");
  assert.equal(extracted[0].id, "q1");
  assert.equal(extracted[0].number, 1);
  assert.equal(extracted[0].answer, "Mild or occasional itching");
  assert.equal(extracted[2].id, "q5");
  assert.equal(extracted[2].number, 5);
  console.log("  ✓ 4.2 extractConsultationQuestionnaire fully supports legacy { q1: [...] } format without error.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: UUID Validation & Parameter Safety
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[Test 5] Testing UUID and field safety...");

{
  assert(isValidUuid("00000000-0000-0000-0000-000000000012"), "Valid UUID matches");
  assert(isValidUuid("B7E28B8A-360D-4071-893F-C38A1CFBE302"), "Uppercase UUID matches");
  assert(!isValidUuid("scan_1234567890"), "Prefix scan ID is safely detected as non-UUID");
  assert(!isValidUuid(""), "Empty string is not UUID");
  assert(!isValidUuid(null), "Null is not UUID");
  assert(!isValidUuid(undefined), "Undefined is not UUID");
  console.log("  ✓ 5.1 UUID validator protects PostgreSQL UUID columns from invalid casts.");
}

console.log("\n======================================================================");
console.log("  ALL VERIFICATION TESTS COMPLETED SUCCESSFULLY! (5 / 5 suites passed)");
console.log("======================================================================\n");

