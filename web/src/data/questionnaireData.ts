/**
 * DermAI — 15-Question Skin Condition Pre-Screening Questionnaire
 *
 * Source: Approved DermAI Research Questionnaire & Care Guide
 * Grounded in: American Academy of Dermatology (AAD), DermNet NZ, and Cleveland Clinic
 *
 * Exactly 15 questions. English and Tagalog displayed together.
 * Multi-select questions: Q5, Q7, Q8, Q14, Q15.
 * Single-select questions: Q1, Q2, Q3, Q4, Q6, Q9, Q10, Q11, Q12, Q13.
 */

export type SupportedCondition =
  | "Acne Vulgaris"
  | "Atopic Dermatitis"
  | "Contact Dermatitis"
  | "Melasma"
  | "Vitiligo";

export type QuestionRole =
  | "symptom_evidence"
  | "contextual_impact"
  | "safety_referral"
  | "background_context";

export interface QuestionOption {
  id: string;
  labelEn: string;
  labelTl: string;
  isExclusiveNone?: boolean; // When selected in multi-select, deselects all others
  safetyWarning?: "emergency" | "urgent";
}

export interface QuestionnaireQuestion {
  id: string; // e.g. "q1", "q2", ..., "q15"
  number: number;
  role: QuestionRole;
  isMultiSelect: boolean;
  required: boolean;
  titleEn: string;
  titleTl: string;
  helperEn?: string;
  helperTl?: string;
  options: QuestionOption[];
}

export const QUESTIONNAIRE_QUESTIONS: QuestionnaireQuestion[] = [
  // ── Q1: Itching ──────────────────────────────────────────────────────────
  {
    id: "q1",
    number: 1,
    role: "symptom_evidence",
    isMultiSelect: false,
    required: true,
    titleEn: "How much itching do you feel on the affected skin?",
    titleTl: "Gaano katindi ang pangangati sa apektadong balat?",
    helperEn: "Select the option that best describes your itching.",
    helperTl: "Piliin ang pinakaangkop na paglalarawan sa iyong pangangati.",
    options: [
      {
        id: "q1_none",
        labelEn: "No itching",
        labelTl: "Walang pangangati",
      },
      {
        id: "q1_mild",
        labelEn: "Mild or occasional itching",
        labelTl: "Bahagya o paminsan-minsang pangangati",
      },
      {
        id: "q1_moderate",
        labelEn: "Moderate and bothersome itching",
        labelTl: "Katamtaman at nakakainis na pangangati",
      },
      {
        id: "q1_intense",
        labelEn: "Intense or constant itching",
        labelTl: "Matindi o tuloy-tuloy na pangangati",
      },
    ],
  },

  // ── Q2: Pain, Burning, Stinging ──────────────────────────────────────────
  {
    id: "q2",
    number: 2,
    role: "symptom_evidence",
    isMultiSelect: false,
    required: true,
    titleEn: "What sensation do you feel on the affected skin?",
    titleTl: "Ano ang nararamdaman mo sa apektadong balat?",
    helperEn: "Select the sensation that best matches the area.",
    helperTl: "Piliin ang pakiramdam na pinakaangkop sa apektadong bahagi.",
    options: [
      {
        id: "q2_none",
        labelEn: "No pain, burning, or stinging",
        labelTl: "Walang pananakit, paghapdi, o pagsusunog",
      },
      {
        id: "q2_mild",
        labelEn: "Mild pain, burning, or stinging",
        labelTl: "Bahagyang pananakit, paghapdi, o pagsusunog",
      },
      {
        id: "q2_moderate",
        labelEn: "Moderate pain, burning, or stinging",
        labelTl: "Katamtamang pananakit, paghapdi, o pagsusunog",
      },
      {
        id: "q2_severe",
        labelEn: "Severe pain, burning, or stinging",
        labelTl: "Matinding pananakit, paghapdi, o pagsusunog",
      },
    ],
  },

  // ── Q3: Color of Skin ───────────────────────────────────────────────────
  {
    id: "q3",
    number: 3,
    role: "symptom_evidence",
    isMultiSelect: false,
    required: true,
    titleEn: "What best describes the color or appearance of the affected skin?",
    titleTl: "Alin ang pinakaangkop na paglalarawan sa kulay o itsura ng apektadong balat?",
    helperEn: "Pick the color closest to what you see.",
    helperTl: "Piliin ang kulay na pinakamalapit sa iyong nakikita.",
    options: [
      {
        id: "q3_white",
        labelEn: "White or noticeably lighter than surrounding skin",
        labelTl: "Puti o mas maputi kaysa sa nakapaligid na balat",
      },
      {
        id: "q3_red_pink",
        labelEn: "Red or pink",
        labelTl: "Pula o rosas",
      },
      {
        id: "q3_brown_dark",
        labelEn: "Brown, gray, purple, or darker than surrounding skin",
        labelTl: "Kayumanggi, kulay abo, lila, o mas maitim kaysa sa nakapaligid na balat",
      },
      {
        id: "q3_same_color",
        labelEn: "Mostly the same color as surrounding skin",
        labelTl: "Halos kapareho ng kulay ng nakapaligid na balat",
      },
      {
        id: "q3_other_not_sure",
        labelEn: "Other / Not sure",
        labelTl: "Iba pa / Hindi sigurado",
      },
    ],
  },

  // ── Q4: Texture and Surface ─────────────────────────────────────────────
  {
    id: "q4",
    number: 4,
    role: "symptom_evidence",
    isMultiSelect: false,
    required: true,
    titleEn: "What best describes the texture of the affected skin?",
    titleTl: "Alin ang pinakaangkop na paglalarawan sa texture ng apektadong balat?",
    helperEn: "Choose how the skin feels when touched or looked at closely.",
    helperTl: "Piliin kung ano ang pakiramdam ng balat kapag hinawakan o tiningnan nang mabuti.",
    options: [
      {
        id: "q4_smooth_flat",
        labelEn: "Smooth or flat",
        labelTl: "Makinis o patag",
      },
      {
        id: "q4_oily_greasy",
        labelEn: "Oily or greasy",
        labelTl: "Mamantika",
      },
      {
        id: "q4_dry_rough",
        labelEn: "Dry or rough",
        labelTl: "Tuyo o magaspang",
      },
      {
        id: "q4_cracked",
        labelEn: "Cracked",
        labelTl: "May mga bitak",
      },
      {
        id: "q4_flaky_peeling",
        labelEn: "Flaky or peeling",
        labelTl: "Nagbabalat o natutuklap",
      },
      {
        id: "q4_scaly",
        labelEn: "Scaly",
        labelTl: "Parang may kaliskis",
      },
      {
        id: "q4_other_not_sure",
        labelEn: "Other / Not sure",
        labelTl: "Iba pa / Hindi sigurado",
      },
    ],
  },

  // ── Q5: Bumps, Lesions, Blisters (MULTI-SELECT) ──────────────────────────
  {
    id: "q5",
    number: 5,
    role: "symptom_evidence",
    isMultiSelect: true,
    required: true,
    titleEn: "What do you see on the affected skin? (Select all that apply)",
    titleTl: "Ano ang nakikita mo sa apektadong balat? (Piliin lahat ng naaangkop)",
    helperEn: "You can select more than one option if present.",
    helperTl: "Maaaring pumili ng higit sa isa kung mayroon sa balat.",
    options: [
      {
        id: "q5_blackheads",
        labelEn: "Blackheads",
        labelTl: "Blackheads",
      },
      {
        id: "q5_whiteheads",
        labelEn: "Whiteheads",
        labelTl: "Whiteheads",
      },
      {
        id: "q5_pimples",
        labelEn: "Pimples",
        labelTl: "Mga pimples",
      },
      {
        id: "q5_pus_bumps",
        labelEn: "Pus-filled bumps",
        labelTl: "Mga bukol na may nana",
      },
      {
        id: "q5_deep_lumps",
        labelEn: "Deep, painful bumps or lumps",
        labelTl: "Malalaki, malalalim, at masakit na bukol",
      },
      {
        id: "q5_fluid_blisters",
        labelEn: "Small fluid-filled blisters",
        labelTl: "Maliliit na paltos na may laman na likido",
      },
      {
        id: "q5_swollen_raised",
        labelEn: "Swollen or raised areas",
        labelTl: "Namamaga o nakaumbok na bahagi",
      },
      {
        id: "q5_none",
        labelEn: "No bumps or blisters",
        labelTl: "Walang bukol o paltos",
        isExclusiveNone: true,
      },
      {
        id: "q5_other_not_sure",
        labelEn: "Other / Not sure",
        labelTl: "Iba pa / Hindi sigurado",
      },
    ],
  },

  // ── Q6: Fluid, Pus, or Crusting ─────────────────────────────────────────
  {
    id: "q6",
    number: 6,
    role: "symptom_evidence",
    isMultiSelect: false,
    required: true,
    titleEn: "Is there any fluid, pus, or crusting from the affected area?",
    titleTl: "Mayroon bang likido, nana, o crusting sa apektadong bahagi?",
    helperEn: "This helps assess possible infection or active inflammation.",
    helperTl: "Tumutulong ito upang malaman ang posibleng impeksiyon o pamamaga.",
    options: [
      {
        id: "q6_none",
        labelEn: "None",
        labelTl: "Wala",
      },
      {
        id: "q6_clear_fluid",
        labelEn: "Clear fluid or oozing",
        labelTl: "Malinaw na likido o pag-agos ng likido",
      },
      {
        id: "q6_pus",
        labelEn: "Pus",
        labelTl: "Nana",
      },
      {
        id: "q6_yellow_crust",
        labelEn: "Yellow crusting or discharge",
        labelTl: "Dilaw na crust o discharge",
      },
      {
        id: "q6_not_sure",
        labelEn: "Not sure",
        labelTl: "Hindi sigurado",
      },
    ],
  },

  // ── Q7: Affected Locations (MULTI-SELECT) ────────────────────────────────
  {
    id: "q7",
    number: 7,
    role: "symptom_evidence",
    isMultiSelect: true,
    required: true,
    titleEn: "Where is the affected skin located? (Select all that apply)",
    titleTl: "Saan matatagpuan ang apektadong balat? (Piliin lahat ng naaangkop)",
    helperEn: "Select all areas where this skin condition is currently present.",
    helperTl: "Piliin lahat ng bahagi kung saan naroroon ang problema sa balat.",
    options: [
      { id: "q7_face", labelEn: "Face", labelTl: "Mukha" },
      { id: "q7_chest", labelEn: "Chest", labelTl: "Dibdib" },
      { id: "q7_back", labelEn: "Back", labelTl: "Likod" },
      { id: "q7_shoulders", labelEn: "Shoulders", labelTl: "Balikat" },
      { id: "q7_arms", labelEn: "Arms / forearms", labelTl: "Braso / bisig" },
      { id: "q7_hands", labelEn: "Hands", labelTl: "Kamay" },
      { id: "q7_elbows", labelEn: "Elbows", labelTl: "Siko" },
      { id: "q7_behind_knees", labelEn: "Behind the knees", labelTl: "Likod ng tuhod" },
      { id: "q7_wrists", labelEn: "Wrists", labelTl: "Pulsuhan" },
      { id: "q7_legs", labelEn: "Legs", labelTl: "Binti" },
      { id: "q7_feet", labelEn: "Feet", labelTl: "Paa" },
      { id: "q7_other", labelEn: "Other", labelTl: "Iba pa" },
    ],
  },

  // ── Q8: Exposure History (MULTI-SELECT) ──────────────────────────────────
  {
    id: "q8",
    number: 8,
    role: "symptom_evidence",
    isMultiSelect: true,
    required: true,
    titleEn:
      "Before the skin problem appeared or worsened, did the affected area come into contact with any of these? (Select all that apply)",
    titleTl:
      "Bago lumitaw o lumala ang problema sa balat, nadikit ba ang apektadong bahagi sa alinman sa mga ito? (Piliin lahat ng naaangkop)",
    helperEn: "Consider new products, cleaning agents, metals, or plants you may have touched.",
    helperTl: "Isipin ang mga bagong produkto, panlinis, metal, o halaman na maaaring nadikit sa balat.",
    options: [
      {
        id: "q8_no_exposure",
        labelEn: "No known exposure",
        labelTl: "Walang alam na exposure",
        isExclusiveNone: true,
      },
      { id: "q8_skincare", labelEn: "New skincare product", labelTl: "Bagong skincare product" },
      { id: "q8_cosmetics", labelEn: "Cosmetic or makeup", labelTl: "Cosmetics o makeup" },
      { id: "q8_oily_product", labelEn: "Oily/greasy product", labelTl: "Mamantika o greasy na produkto" },
      { id: "q8_soap", labelEn: "Soap or cleanser", labelTl: "Sabon o cleanser" },
      { id: "q8_detergent", labelEn: "Detergent or cleaning product", labelTl: "Detergent o panlinis" },
      { id: "q8_jewelry", labelEn: "Jewelry or metal", labelTl: "Alahas o metal" },
      { id: "q8_fragrance", labelEn: "Fragrance or perfume", labelTl: "Pabango o fragrance" },
      { id: "q8_plant", labelEn: "Plant", labelTl: "Halaman" },
      { id: "q8_chemical", labelEn: "Chemical", labelTl: "Kemikal" },
      { id: "q8_topical_med", labelEn: "Medication applied to the skin", labelTl: "Gamot na inilagay sa balat" },
      { id: "q8_other", labelEn: "Other", labelTl: "Iba pa" },
      { id: "q8_not_sure", labelEn: "Not sure", labelTl: "Hindi sigurado" },
    ],
  },

  // ── Q9: Sunlight Response ────────────────────────────────────────────────
  {
    id: "q9",
    number: 9,
    role: "symptom_evidence",
    isMultiSelect: false,
    required: true,
    titleEn: "How does the affected skin respond to sunlight?",
    titleTl: "Paano tumutugon ang apektadong balat sa sikat ng araw?",
    helperEn: "Notice how the area changes after sun exposure.",
    helperTl: "Pansinin kung paano nagbabago ang balat pagkatapos maarawan.",
    options: [
      {
        id: "q9_darker",
        labelEn: "Becomes darker or more noticeable",
        labelTl: "Mas umiitim o mas nagiging kapansin-pansin",
      },
      {
        id: "q9_red_irritated",
        labelEn: "Becomes red or irritated",
        labelTl: "Namumula o naiirita",
      },
      {
        id: "q9_burns_easily",
        labelEn: "Becomes more sensitive or burns easily",
        labelTl: "Mas sensitibo o madaling masunog",
      },
      {
        id: "q9_no_change",
        labelEn: "No noticeable change",
        labelTl: "Walang kapansin-pansing pagbabago",
      },
      {
        id: "q9_not_sure",
        labelEn: "Not sure",
        labelTl: "Hindi sigurado",
      },
    ],
  },

  // ── Q10: Progression / Spread ───────────────────────────────────────────
  {
    id: "q10",
    number: 10,
    role: "symptom_evidence",
    isMultiSelect: false,
    required: true,
    titleEn: "How has the affected area changed over time?",
    titleTl: "Paano nagbago ang apektadong bahagi sa paglipas ng panahon?",
    helperEn: "Has it stayed in one spot or spread to other areas?",
    helperTl: "Nanatili ba ito sa isang lugar o kumalat sa ibang bahagi?",
    options: [
      {
        id: "q10_no_change",
        labelEn: "No noticeable change",
        labelTl: "Walang kapansin-pansing pagbabago",
      },
      {
        id: "q10_slight_spread",
        labelEn: "Slightly spread within the same area",
        labelTl: "Bahagyang kumalat sa parehong bahagi",
      },
      {
        id: "q10_spread_nearby",
        labelEn: "Spread to nearby areas",
        labelTl: "Kumalat sa mga kalapit na bahagi",
      },
      {
        id: "q10_spread_distant",
        labelEn: "Appeared in multiple or distant areas",
        labelTl: "Lumabas sa maraming o magkakalayong bahagi",
      },
      {
        id: "q10_not_sure",
        labelEn: "Not sure",
        labelTl: "Hindi sigurado",
      },
    ],
  },

  // ── Q11: Duration ───────────────────────────────────────────────────────
  {
    id: "q11",
    number: 11,
    role: "symptom_evidence",
    isMultiSelect: false,
    required: true,
    titleEn: "How long has the current skin problem been present?",
    titleTl: "Gaano na katagal ang kasalukuyang problema sa balat?",
    helperEn: "Estimate the time since this current flare or patch started.",
    helperTl: "Tantyahin ang tagal simula nang magsimula ang kasalukuyang pamamaga o patch.",
    options: [
      {
        id: "q11_less_than_1wk",
        labelEn: "Less than 1 week",
        labelTl: "Mas mababa sa 1 linggo",
      },
      {
        id: "q11_1_to_4wks",
        labelEn: "1–4 weeks",
        labelTl: "1–4 na linggo",
      },
      {
        id: "q11_1_to_3mos",
        labelEn: "1–3 months",
        labelTl: "1–3 buwan",
      },
      {
        id: "q11_more_than_3mos",
        labelEn: "More than 3 months",
        labelTl: "Mahigit 3 buwan",
      },
      {
        id: "q11_not_sure",
        labelEn: "Not sure",
        labelTl: "Hindi sigurado",
      },
    ],
  },

  // ── Q12: Recurrence ─────────────────────────────────────────────────────
  {
    id: "q12",
    number: 12,
    role: "symptom_evidence",
    isMultiSelect: false,
    required: true,
    titleEn: "Has the same or a similar skin problem happened repeatedly?",
    titleTl: "Paulit-ulit bang nangyayari ang parehong o katulad na problema sa balat?",
    helperEn: "Does this condition come and go in flares?",
    helperTl: "Pabalik-balik ba ito o dumarating nang paulit-ulit?",
    options: [
      {
        id: "q12_yes",
        labelEn: "Yes",
        labelTl: "Oo",
      },
      {
        id: "q12_no",
        labelEn: "No",
        labelTl: "Hindi",
      },
      {
        id: "q12_not_sure",
        labelEn: "Not sure",
        labelTl: "Hindi sigurado",
      },
    ],
  },

  // ── Q13: Daily-Life Impact (CONTEXTUAL ONLY) ─────────────────────────────
  {
    id: "q13",
    number: 13,
    role: "contextual_impact",
    isMultiSelect: false,
    required: true,
    titleEn: "How much does the skin problem affect your daily activities or well-being?",
    titleTl: "Gaano naaapektuhan ng problema sa balat ang iyong pang-araw-araw na gawain o iyong pakiramdam?",
    helperEn: "Contextual info: helps gauge quality-of-life burden (not used to classify condition).",
    helperTl: "Karagdagang impormasyon upang malaman ang epekto sa pamumuhay (hindi ginagamit sa pag-classify).",
    options: [
      {
        id: "q13_no_effect",
        labelEn: "No effect",
        labelTl: "Walang epekto",
      },
      {
        id: "q13_slight",
        labelEn: "Slight discomfort",
        labelTl: "Bahagyang hindi komportable",
      },
      {
        id: "q13_moderate",
        labelEn: "Sometimes interrupts activities or causes emotional discomfort",
        labelTl: "Minsan naaabala ang gawain o nagdudulot ng emosyonal na discomfort",
      },
      {
        id: "q13_severe",
        labelEn: "Makes daily activities difficult or causes significant distress",
        labelTl: "Nahihirapan sa pang-araw-araw na gawain o nagdudulot ng matinding distress",
      },
    ],
  },

  // ── Q14: Warning Signs / Red Flags (SAFETY REFERRAL ONLY - MULTI-SELECT) ──
  {
    id: "q14",
    number: 14,
    role: "safety_referral",
    isMultiSelect: true,
    required: true,
    titleEn:
      "Are you experiencing any warning signs that may require professional medical attention? (Select all that apply)",
    titleTl:
      "Nakakaranas ka ba ng alinman sa mga warning signs na maaaring mangailangan ng propesyonal na medikal na atensyon? (Piliin lahat ng naaangkop)",
    helperEn:
      "Safety rule only: does not determine disease type. Swelling with breathing trouble requires immediate emergency care.",
    helperTl:
      "Para sa kaligtasan lamang: hindi ginagamit sa pagtukoy ng sakit. Ang pamamaga na may hirap sa paghinga ay nangangailangan ng agarang emergency care.",
    options: [
      {
        id: "q14_rapid_worsening",
        labelEn: "Rapidly worsening redness, swelling, warmth, or pain",
        labelTl: "Mabilis na lumalalang pamumula, pamamaga, init, o pananakit",
        safetyWarning: "urgent",
      },
      {
        id: "q14_pus_infection",
        labelEn: "Pus or signs of possible infection",
        labelTl: "Nana o posibleng senyales ng impeksiyon",
        safetyWarning: "urgent",
      },
      {
        id: "q14_rapid_change",
        labelEn: "Rapidly changing skin patch or lesion",
        labelTl: "Mabilis na pagbabago sa patch o lesion",
        safetyWarning: "urgent",
      },
      {
        id: "q14_emergency_breathing",
        labelEn: "Facial or lip swelling / difficulty breathing",
        labelTl: "Pamamaga ng mukha o labi / hirap sa paghinga",
        safetyWarning: "emergency",
      },
      {
        id: "q14_eye_vision",
        labelEn: "Eye or vision changes",
        labelTl: "Pagbabago sa mata o paningin",
        safetyWarning: "urgent",
      },
      {
        id: "q14_none",
        labelEn: "None",
        labelTl: "Wala",
        isExclusiveNone: true,
      },
      {
        id: "q14_not_sure",
        labelEn: "Not sure",
        labelTl: "Hindi sigurado",
      },
    ],
  },

  // ── Q15: Family, Autoimmune & Hormone Context (BACKGROUND - MULTI-SELECT) ─
  {
    id: "q15",
    number: 15,
    role: "background_context",
    isMultiSelect: true,
    required: true,
    titleEn: "Do any of the following apply to you? (Select all that apply)",
    titleTl: "May alinman ba sa mga sumusunod na naaangkop sa iyo? (Piliin lahat ng naaangkop)",
    helperEn:
      "Background context: helps provide supporting clinical context, but cannot classify a condition on its own.",
    helperTl:
      "Pangsuportang impormasyon: nagbibigay ng background context ngunit hindi sapat mag-isa upang mag-classify ng kondisyon.",
    options: [
      {
        id: "q15_family_atopic",
        labelEn: "Family history of Atopic Dermatitis, asthma, hay fever, or other allergies",
        labelTl: "Family history ng Atopic Dermatitis, asthma, hay fever, o iba pang allergy",
      },
      {
        id: "q15_family_vitiligo",
        labelEn: "Family history of Vitiligo or autoimmune conditions",
        labelTl: "Family history ng Vitiligo o autoimmune conditions",
      },
      {
        id: "q15_family_melasma",
        labelEn: "Family history of Melasma",
        labelTl: "Family history ng Melasma",
      },
      {
        id: "q15_pregnant",
        labelEn: "Currently pregnant or recently gave birth",
        labelTl: "Buntis o kamakailan lamang nanganak",
      },
      {
        id: "q15_hormone_therapy",
        labelEn: "Use hormonal birth control or hormone therapy",
        labelTl: "Gumagamit ng hormonal birth control o hormone therapy",
      },
      {
        id: "q15_none",
        labelEn: "None of these",
        labelTl: "Wala sa mga ito",
        isExclusiveNone: true,
      },
      {
        id: "q15_prefer_not_say",
        labelEn: "Prefer not to answer",
        labelTl: "Mas pinipiling hindi sumagot",
        isExclusiveNone: true,
      },
    ],
  },
];

/**
 * Normalizes multi-select choices by enforcing mutual exclusivity:
 * - If an exclusive option (e.g. "None", "Prefer not to answer") is clicked, all other choices are deselected.
 * - If any regular option is selected, exclusive options are cleared.
 */
export function toggleOptionSelection(
  currentSelected: string[],
  optionId: string,
  question: QuestionnaireQuestion
): string[] {
  if (!question.isMultiSelect) {
    return [optionId];
  }

  const option = question.options.find((o) => o.id === optionId);
  const isExclusive = Boolean(option?.isExclusiveNone);

  if (isExclusive) {
    // If already selected, deselect; otherwise, select ONLY this exclusive option
    return currentSelected.includes(optionId) ? [] : [optionId];
  }

  // Regular option: remove all exclusive options first
  const exclusiveIds = question.options
    .filter((o) => o.isExclusiveNone)
    .map((o) => o.id);

  const cleaned = currentSelected.filter((id) => !exclusiveIds.includes(id));

  if (cleaned.includes(optionId)) {
    return cleaned.filter((id) => id !== optionId);
  } else {
    return [...cleaned, optionId];
  }
}
