// Skin condition diagnostic engine — mirrors web ScanSkinPage.tsx exactly

export interface ConditionData {
  name: string;
  localName: string;
  category: string;
  description: string;
  symptoms: string[];
  whoAffected: string;
  careTips: string[];
  whenToSeeDoctor: string;
  baseConfidence: number;
  severity: 'mild' | 'moderate' | 'severe';
  referralThreshold: number;
  images: [string, string, string];
  couldAlsoBe?: string; // symptomPattern key of visually similar condition
  isGovernmentReportable?: boolean; // leprosy — name must NOT be displayed on-screen
}

// ─── 8 in-scope conditions — keyed by symptomPattern string (mirrors web) ───
export const CONDITION_MAP: Record<string, ConditionData> = {
  'Ring-shaped or circular scaly patch': {
    name: 'Tinea Corporis',
    localName: 'Buni',
    category: 'Fungal Infection',
    baseConfidence: 84,
    couldAlsoBe: 'Sores with yellow crust or pus',
    description:
      'Tinea Corporis (Buni) is a fungal skin infection causing ring-shaped, scaly patches on the body. Also called Ringworm, it is caused by dermatophyte fungi and spreads through contact with infected persons or animals. Common among children and workers in humid environments.',
    symptoms: [
      'Red, ring-shaped rash with a clear center',
      'Slightly raised, scaly border',
      'Itching or stinging sensation',
      'Rash that slowly expands outward',
    ],
    whoAffected:
      'Common in children and adults who have close contact with infected people or animals. Prevalent among coastal workers and those in humid environments in Cebu.',
    careTips: [
      'Apply over-the-counter antifungal cream (e.g., clotrimazole)',
      'Keep the area clean and dry',
      'Avoid sharing towels, clothing, or bedding',
      'Wash hands after touching the infected area',
      'Continue treatment for 2 weeks even if rash clears',
    ],
    whenToSeeDoctor:
      'If the rash does not improve after 2 weeks of OTC treatment, spreads rapidly, or appears on the scalp or nails.',
    severity: 'mild',
    referralThreshold: 50,
    images: [
      'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=600&q=80',
      'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=300&q=70',
      'https://images.unsplash.com/photo-1559757175-0eb30cd8c063?w=300&q=70',
    ],
  },
  "Itchy, scaly, or cracked feet/toes": {
    name: "Tinea Pedis",
    localName: "Alipunga",
    category: "Fungal Infection",
    baseConfidence: 85,
    description:
      "Tinea Pedis (Alipunga / Athlete's Foot) is a common fungal infection affecting the skin of the feet, particularly between the toes. It thrives in warm, moist environments and is common among wet market workers, fishermen, and people who wear closed shoes for extended periods.",
    symptoms: [
      "Itching, burning, or stinging between the toes",
      "Scaly, peeling, or cracked skin on the feet",
      "Blisters on the sole or sides of feet",
      "Dry, flaky skin on the bottom of the foot",
    ],
    whoAffected:
      "Prevalent among wet market workers and fishermen in Cebu. Anyone who walks barefoot in public areas or wears tight footwear is at risk.",
    careTips: [
      "Keep feet clean and dry, especially between the toes",
      "Apply OTC antifungal powder or cream daily",
      "Wear moisture-wicking socks and breathable footwear",
      "Avoid walking barefoot in public showers or pools",
      "Change socks daily or when wet",
    ],
    whenToSeeDoctor:
      "If infection spreads to nails, does not improve after 4 weeks, or develops open sores.",
    severity: "mild",
    referralThreshold: 50,
    images: [
      'https://images.unsplash.com/photo-1559757175-0eb30cd8c063?w=600&q=80',
      'https://images.unsplash.com/photo-1559757175-0eb30cd8c063?w=300&q=70',
      'https://images.unsplash.com/photo-1594824476967-48c8b964ac31?w=300&q=70',
    ],
  },
  'Facial redness with bumps or flushing': {
    name: 'Acne Rosacea',
    localName: 'Taghiyawat',
    category: 'Acne',
    baseConfidence: 82,
    description:
      'Acne Rosacea (Taghiyawat) is a chronic inflammatory skin condition that primarily affects the face, causing persistent redness, visible blood vessels, and acne-like bumps. It is often mistaken for regular acne or sunburn. Common triggers include sun exposure, hot drinks, spicy food, and stress.',
    symptoms: [
      'Persistent facial redness, especially on nose and cheeks',
      'Small red bumps or pimples (without blackheads or whiteheads)',
      'Visible small blood vessels on the skin',
      'Burning or stinging sensation on the face',
      'Skin that feels hot and sensitive',
    ],
    whoAffected:
      'More common in adults aged 30–50, especially those with fair skin. Women are more frequently diagnosed, but men tend to have more severe symptoms.',
    careTips: [
      'Avoid sun exposure and use SPF 30+ sunscreen daily',
      'Identify and avoid personal triggers (spicy food, alcohol, hot drinks)',
      'Use gentle, non-irritating and fragrance-free skincare products',
      'Avoid rubbing, scrubbing, or touching the face',
      'Consult a dermatologist for prescription topical therapy (e.g., metronidazole)',
    ],
    whenToSeeDoctor:
      'Rosacea usually requires prescription treatment. Consult a dermatologist for proper diagnosis and management to prevent worsening.',
    severity: 'moderate',
    referralThreshold: 55,
    images: [
      require('../assets/images/acne-rosacea.png'),
      require('../assets/images/acne-rosacea.png'),
      require('../assets/images/acne-rosacea.png'),
    ],
  },
  'Chronic dry itchy patches or eczema': {
    name: 'Atopic Dermatitis',
    localName: 'Eczema',
    category: 'Inflammatory Condition',
    baseConfidence: 80,
    description:
      'Atopic Dermatitis (Eczema) is a chronic inflammatory skin condition that causes dry, itchy, and inflamed skin. It tends to flare periodically and is associated with asthma and hay fever. Common across all age groups in the Philippines.',
    symptoms: [
      'Dry, sensitive skin',
      'Intense itching, especially at night',
      'Red to brownish-gray patches',
      'Small, raised bumps that may weep fluid when scratched',
      'Thickened, cracked, or scaly skin',
    ],
    whoAffected:
      'Affects all age groups. Often begins in childhood. Those with a family history of allergies, asthma, or hay fever are at higher risk.',
    careTips: [
      'Moisturize skin at least twice daily with fragrance-free lotion',
      'Use mild, unscented soap and detergent',
      'Avoid scratching — trim nails short',
      'Wear soft, breathable cotton garments',
      'Identify and avoid triggers (sweat, stress, certain fabrics)',
    ],
    whenToSeeDoctor:
      'If itching is severe and disrupts sleep, if skin becomes infected, or if OTC treatments are not controlling flare-ups.',
    severity: 'moderate',
    referralThreshold: 55,
    images: [
      'https://images.unsplash.com/photo-1559757175-0eb30cd8c063?w=600&q=80',
      'https://images.unsplash.com/photo-1559757175-0eb30cd8c063?w=300&q=70',
      'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=300&q=70',
    ],
  },
  'Rough raised bumps on skin': {
    name: 'Warts',
    localName: 'Kulubot',
    category: 'Viral Infection',
    baseConfidence: 78,
    description:
      'Warts (Verruca vulgaris / Kulubot) are small rough growths caused by the human papillomavirus (HPV). They commonly appear on fingers, hands, and feet. Contagious through direct contact or shared surfaces but are not dangerous.',
    symptoms: [
      'Rough, fleshy, grainy bumps on skin',
      'Flesh-colored, white, pink, or tan lesions',
      'Tiny black dots within the bump (clotted blood vessels)',
      'Flat or raised surface depending on location',
    ],
    whoAffected:
      'Common in children and young adults. Can affect anyone who comes in contact with HPV. Common in schools and public swimming areas.',
    careTips: [
      'Apply OTC salicylic acid treatment consistently',
      'Keep the area clean and dry',
      'Avoid picking, cutting, or touching the wart',
      'Cover with a bandage to prevent spreading',
      'Consult a dermatologist if warts are persistent or spreading',
    ],
    whenToSeeDoctor:
      'If warts spread, appear on face or genitals, are painful, or do not respond to OTC treatment.',
    severity: 'mild',
    referralThreshold: 50,
    images: [
      'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=600&q=80',
      'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=300&q=70',
      'https://images.unsplash.com/photo-1559757175-0eb30cd8c063?w=300&q=70',
    ],
  },
  'Widespread blisters with fever': {
    name: 'Chickenpox',
    localName: 'Bulutong-tubig',
    category: 'Viral Infection',
    baseConfidence: 83,
    description:
      'Chickenpox (Bulutong-tubig / Varicella) is a highly contagious viral disease caused by the Varicella-zoster virus. It causes an itchy blister-like rash, fever, and fatigue. Progresses from red spots to fluid-filled blisters that crust over.',
    symptoms: [
      'Itchy, blister-like rash that appears in waves',
      'Fever and fatigue before rash appears',
      'Fluid-filled blisters that break open and crust',
      'Rash starts on chest, back, and face then spreads',
    ],
    whoAffected:
      'More common in children under 12. Adults, pregnant women, and immunocompromised individuals are at higher risk of severe complications.',
    careTips: [
      'Rest at home and stay isolated to prevent spreading',
      'Take OTC fever reducers (avoid aspirin for children)',
      'Apply calamine lotion or cool baths to relieve itching',
      'Trim nails short and avoid scratching to prevent scarring',
      'Seek antiviral medication if caught within 24 hours of rash onset',
    ],
    whenToSeeDoctor:
      'If rash appears near the eyes, fever is very high, severe headache occurs, or patient is an adult, pregnant, or immunocompromised.',
    severity: 'moderate',
    referralThreshold: 55,
    images: [
      'https://images.unsplash.com/photo-1594824476967-48c8b964ac31?w=600&q=80',
      'https://images.unsplash.com/photo-1594824476967-48c8b964ac31?w=300&q=70',
      'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=300&q=70',
    ],
  },
  'Sores with yellow crust or pus': {
    name: 'Impetigo',
    localName: 'Nana sa Balat',
    category: 'Bacterial Skin Infection',
    baseConfidence: 76,
    couldAlsoBe: 'Ring-shaped or circular scaly patch',
    description:
      'Impetigo (Nana sa Balat) is a highly contagious bacterial skin infection caused by Staphylococcus or Streptococcus bacteria. It causes red sores that ooze fluid and form a yellowish-brown crust. Most common in children in barangay health settings.',
    symptoms: [
      'Red sores that quickly rupture and ooze',
      'Honey-colored crusty patches',
      'Itchy blisters around nose and mouth',
      'Painless fluid-filled blisters',
    ],
    whoAffected:
      'Most common in children ages 2–6. Can spread through direct contact or shared items like towels and clothing.',
    careTips: [
      'Keep the affected area clean with mild soap and water',
      'Apply prescribed antibiotic ointment consistently',
      'Cover sores with a clean bandage to prevent spreading',
      'Wash hands frequently and avoid touching the sores',
      'Avoid sharing towels, clothing, or bedding',
    ],
    whenToSeeDoctor:
      'Immediately — impetigo usually requires prescription antibiotic treatment to prevent spreading.',
    severity: 'moderate',
    referralThreshold: 60,
    images: [
      'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=600&q=80',
      'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=300&q=70',
      'https://images.unsplash.com/photo-1559757175-0eb30cd8c063?w=300&q=70',
    ],
  },
  'Numb patch/wound not healing': {
    name: 'Leprosy',
    localName: 'Ketong',
    category: 'Bacterial/Mycobacterial Infection',
    baseConfidence: 68,
    isGovernmentReportable: true,
    description:
      'A chronic bacterial infection affecting skin, peripheral nerves, and mucous membranes. Early signs include numb skin patches, discoloration, or non-healing wounds. Fully treatable with Multi-Drug Therapy (MDT) — free at all government health centers under the DOH National Leprosy Control Program.',
    symptoms: [
      'Pale or reddish patches on the skin with loss of sensation',
      'Numb skin areas (no feeling of pain, heat, or touch)',
      'Wounds or sores that do not heal normally',
      'Weakness in hands, feet, or eyelids',
    ],
    whoAffected:
      'Can affect anyone. Early detection is critical to prevent permanent disability. Free treatment is available at government health centers.',
    careTips: [
      'Seek medical attention immediately — this is urgent',
      'Do not delay — early treatment prevents permanent disability',
      'Avoid self-medication; consult a doctor as soon as possible',
      'Complete the full Multi-Drug Therapy (MDT) course as prescribed',
      'Visit your nearest government health center (treatment is free)',
    ],
    whenToSeeDoctor:
      'Immediately. Do not wait — early MDT is free and prevents permanent nerve damage.',
    severity: 'severe',
    referralThreshold: 0,
    images: [
      'https://images.unsplash.com/photo-1559757175-0eb30cd8c063?w=600&q=80',
      'https://images.unsplash.com/photo-1559757175-0eb30cd8c063?w=300&q=70',
      'https://images.unsplash.com/photo-1594824476967-48c8b964ac31?w=300&q=70',
    ],
  },
};

// ─── Question sets (mirrors web ScanSkinPage exactly) ────────────────────────
export const BODY_LOCATIONS = [
  'Face',
  'Neck/Chest',
  'Back',
  'Arms/Legs',
  'Feet',
  'Scalp',
  'Groin/Armpits',
];

export const SYMPTOM_PATTERNS = Object.keys(CONDITION_MAP);

export const IMPACT_LEVELS = [
  'Not painful and not spreading',
  'Painful or spreading',
  'With fever, open wound, or numbness',
];

export const DURATIONS = [
  'Less than 1 week',
  '1-4 weeks',
  '1+ month',
];

export const HOUSEHOLD_OPTIONS = ['Yes', 'No', 'Not Sure'];

export interface Question {
  id: string;
  question: string;
  options: string[];
}

export const QUESTIONS: Question[] = [
  {
    id: 'bodyLocation',
    question: 'Where on your body is the affected area?',
    options: BODY_LOCATIONS,
  },
  {
    id: 'symptomPattern',
    question: 'Which best describes what you see on your skin?',
    options: SYMPTOM_PATTERNS,
  },
  {
    id: 'impactLevel',
    question: 'How does the condition feel / how is it affecting you?',
    options: IMPACT_LEVELS,
  },
  {
    id: 'duration',
    question: 'How long have you had this condition?',
    options: DURATIONS,
  },
  {
    id: 'household',
    question: 'Does anyone in your household have the same condition?',
    options: HOUSEHOLD_OPTIONS,
  },
];

// ─── Diagnostic engine ────────────────────────────────────────────────────────
export interface DiagnosisResult {
  conditionKey: string;
  condition: ConditionData;
  confidence: number;
  /** Set when a second condition scores within 30% of the primary (paper §3.3 clause) */
  secondaryResult?: {
    conditionKey: string;
    condition: ConditionData;
    confidence: number;
  };
}

export function diagnoseCondition(answers: Record<string, string>): DiagnosisResult {
  const symptomPattern = answers['symptomPattern'] ?? SYMPTOM_PATTERNS[0];
  const condition = CONDITION_MAP[symptomPattern] ?? CONDITION_MAP[SYMPTOM_PATTERNS[0]];

  // confidence varies by impact + duration (mirrors web logic)
  let confidence = condition.baseConfidence;

  if (answers['impactLevel'] === 'Painful or spreading') confidence -= 5;
  if (answers['impactLevel'] === 'With fever, open wound, or numbness') confidence -= 10;

  if (answers['duration'] === 'Less than 1 week') confidence += 3;
  if (answers['duration'] === '1+ month') confidence -= 5;

  if (answers['household'] === 'Yes') confidence -= 3;

  confidence = Math.max(40, Math.min(97, confidence));

  // ── Paper §: when two conditions score within 30% of each other, present both ──
  const altKey = condition.couldAlsoBe;
  if (altKey && CONDITION_MAP[altKey]) {
    const altCondition = CONDITION_MAP[altKey];
    let altConf = altCondition.baseConfidence - 8; // secondary is naturally lower

    if (answers['impactLevel'] === 'Painful or spreading') altConf -= 3;
    if (answers['duration'] === '1+ month') altConf -= 3;
    altConf = Math.max(35, Math.min(90, altConf));

    // Show secondary if within 30 percentage points of primary
    if (Math.abs(confidence - altConf) <= 30) {
      return {
        conditionKey: symptomPattern,
        condition,
        confidence,
        secondaryResult: { conditionKey: altKey, condition: altCondition, confidence: altConf },
      };
    }
  }

  return { conditionKey: symptomPattern, condition, confidence };
}
