export type DatasetConditionKey =
  | 'acne_vulgaris'
  | 'atopic_dermatitis'
  | 'contact_dermatitis'
  | 'melasma'
  | 'tinea_pedis';

export interface DatasetConditionMeta {
  key: DatasetConditionKey;
  name: string;
  localName: string;
  category: string;
  description: string;
  symptoms: string[];
  careTips: string[];
  severity: 'mild' | 'moderate' | 'severe';
  referralThreshold: number;
  isGovernmentReportable?: boolean;
}

export const DATASET_CONDITIONS: Record<DatasetConditionKey, DatasetConditionMeta> = {
  acne_vulgaris: {
    key: 'acne_vulgaris',
    name: 'Acne Vulgaris',
    localName: 'Taghiyawat',
    category: 'Inflammatory Condition',
    description:
      'Acne Vulgaris is a common inflammatory skin condition that forms blackheads, whiteheads, papules, and pustules. It often affects the face, chest, and back.',
    symptoms: [
      'Blackheads or whiteheads',
      'Red bumps or pus-filled lesions',
      'Oily skin with clogged pores',
      'Breakouts on face, chest, or back',
    ],
    careTips: [
      'Use a gentle cleanser twice daily',
      'Avoid squeezing or picking lesions',
      'Use non-comedogenic skincare products',
      'Consider a dermatologist if breakouts are painful or persistent',
    ],
    severity: 'moderate',
    referralThreshold: 55,
  },
  atopic_dermatitis: {
    key: 'atopic_dermatitis',
    name: 'Atopic Dermatitis',
    localName: 'Eczema',
    category: 'Inflammatory Condition',
    description:
      'Atopic Dermatitis is a chronic itchy rash that causes dry, inflamed, and sensitive skin. It commonly flares with triggers such as heat, sweat, irritants, and stress.',
    symptoms: [
      'Dry, itchy, and inflamed patches',
      'Sensitive skin that flares repeatedly',
      'Thickened or scaly areas after scratching',
      'Rash on arms, legs, hands, or folds of skin',
    ],
    careTips: [
      'Moisturize often with fragrance-free cream',
      'Avoid harsh soaps and irritating products',
      'Keep nails short to reduce skin damage from scratching',
      'Seek medical advice if flares are frequent or severe',
    ],
    severity: 'moderate',
    referralThreshold: 55,
  },
  contact_dermatitis: {
    key: 'contact_dermatitis',
    name: 'Contact Dermatitis',
    localName: 'Skin Allergy',
    category: 'Allergic/Irritant Reaction',
    description:
      'Contact Dermatitis happens when skin reacts to an irritant or allergen and becomes red, itchy, swollen, or blistered after exposure.',
    symptoms: [
      'Red, itchy, or burning rash after exposure',
      'Dry, cracked, or blistered skin',
      'Localized rash where a product or material touched the skin',
      'Swelling or tenderness in the affected area',
    ],
    careTips: [
      'Stop using any suspected trigger product',
      'Wash the area gently with mild soap and water',
      'Use bland moisturizer to support the skin barrier',
      'See a clinician if symptoms spread or become severe',
    ],
    severity: 'moderate',
    referralThreshold: 60,
  },
  melasma: {
    key: 'melasma',
    name: 'Melasma',
    localName: 'Dark Patches',
    category: 'Pigmentation Disorder',
    description:
      'Melasma causes brown or gray-brown patches of pigmentation, often on the face, and is commonly linked to sun exposure and hormonal changes.',
    symptoms: [
      'Symmetrical brown or gray-brown patches',
      'Patchy darkening on cheeks, forehead, or upper lip',
      'Usually not painful or itchy',
      'Often worsens with sun exposure',
    ],
    careTips: [
      'Use broad-spectrum sunscreen every day',
      'Limit direct sun exposure when possible',
      'Avoid harsh bleaching products without guidance',
      'Consult a dermatologist for pigment-management options',
    ],
    severity: 'mild',
    referralThreshold: 65,
  },
  tinea_pedis: {
    key: 'tinea_pedis',
    name: 'Tinea Pedis',
    localName: 'Alipunga',
    category: 'Fungal Infection',
    description:
      'Tinea Pedis is a fungal infection of the feet, often found between the toes or on the soles, and is more likely in warm and moist environments.',
    symptoms: [
      'Itchy, scaly, or cracked skin on the feet',
      'Peeling skin between the toes',
      'Burning or stinging sensation',
      'Odor or moisture between the toes',
    ],
    careTips: [
      'Keep feet clean and dry',
      'Change socks when they become damp',
      'Use antifungal treatment as directed',
      'Avoid sharing footwear or towels',
    ],
    severity: 'mild',
    referralThreshold: 50,
  },
};

export function getDatasetCondition(key?: string | null): DatasetConditionMeta | null {
  if (!key) return null;
  return DATASET_CONDITIONS[key as DatasetConditionKey] ?? null;
}
