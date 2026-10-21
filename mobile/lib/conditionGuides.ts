/**
 * DermAI — Condition Definitions, Basic Care Tips, and Medical Source Citations
 *
 * Source: DermAI Approved Research, Questionnaire, Disease Mapping & Basic Care Guide
 * Grounded in: American Academy of Dermatology (AAD), DermNet NZ, and Cleveland Clinic
 */

export interface MedicalSourceReference {
  organization: "American Academy of Dermatology (AAD)" | "DermNet NZ" | "Cleveland Clinic";
  title: string;
  url: string;
}

export interface ConditionGuide {
  id: string;
  name: string;
  filipinoName: string;
  category: "Acne" | "Inflammatory" | "Pigmentation";
  definition: string;
  commonSymptoms: string[];
  whoIsAffected: string;
  basicCareTips: string[];
  whenToSeeDoctor: string;
  medicalSources: MedicalSourceReference[];
}

export const CONDITION_GUIDES: Record<string, ConditionGuide> = {
  "acne vulgaris": {
    id: "acne_vulgaris",
    name: "Acne Vulgaris",
    filipinoName: "Taghiyawat",
    category: "Acne",
    definition:
      "Acne vulgaris is a common inflammatory condition of the pilosebaceous unit. It produces non-inflammatory comedones (blackheads and whiteheads) and inflammatory lesions such as papules, pustules, and deeper painful nodules. It commonly affects the face, neck, chest, and back. Some lesions can leave dark marks or scars.",
    commonSymptoms: [
      "Blackheads (open comedones) and whiteheads (closed comedones)",
      "Red, inflamed pimples and tender pustules filled with pus",
      "Deeper, painful cysts or nodules under the skin",
      "Oily or greasy skin with visible pore congestion",
      "Post-inflammatory marks or scarring after healing",
    ],
    whoIsAffected:
      "Most common during adolescence and young adulthood due to hormonal changes, but frequently persists into or begins in adulthood, especially among individuals with oily skin or high stress.",
    basicCareTips: [
      "Gently wash the face up to twice daily and after sweating with a mild, non-abrasive cleanser; avoid vigorous scrubbing.",
      "Choose gentle, oil-free or non-comedogenic skin-care products and sunscreen.",
      "Avoid picking, popping, or squeezing lesions to reduce inflammation, healing time, and scarring risk.",
      "Avoid frequently switching irritating products or using harsh physical exfoliants that disrupt the skin barrier.",
      "Maintain a clean pillowcase, phone surface, and hair off the forehead to minimize surface bacteria transfer.",
    ],
    whenToSeeDoctor:
      "Seek professional evaluation for deep or painful nodules/cysts, widespread or persistent breakouts unresponsive to 6–8 weeks of OTC care, scarring, or substantial emotional distress.",
    medicalSources: [
      {
        organization: "American Academy of Dermatology (AAD)",
        title: "Acne: Tips for managing",
        url: "https://www.aad.org/public/diseases/acne/skin-care/tips",
      },
      {
        organization: "American Academy of Dermatology (AAD)",
        title: "Acne overview",
        url: "https://www.aad.org/public/diseases/acne/really-acne/overview",
      },
      {
        organization: "DermNet NZ",
        title: "Acne vulgaris",
        url: "https://dermnetnz.org/topics/acne-vulgaris",
      },
      {
        organization: "Cleveland Clinic",
        title: "Acne",
        url: "https://my.clevelandclinic.org/health/diseases/12233-acne",
      },
    ],
  },

  "atopic dermatitis": {
    id: "atopic_dermatitis",
    name: "Atopic Dermatitis (Eczema)",
    filipinoName: "Eksema",
    category: "Inflammatory",
    definition:
      "Atopic dermatitis is a chronic, relapsing inflammatory skin condition that commonly causes intense itching, dry or scaly skin, and discolored, inflamed patches. Depending on skin tone, affected areas may appear red, brown, purple, or gray. Skin can become rough, cracked, swollen, or develop blisters that ooze and crust. It typically comes and goes in flares.",
    commonSymptoms: [
      "Intense, persistent itching that frequently disrupts sleep",
      "Dry, rough, scaly, or cracked skin barrier",
      "Discolored patches (red, pink, purple, brown, or gray)",
      "Small fluid-filled blisters or areas with oozing and crusting during flares",
      "Frequent involvement of skin creases (elbow folds, behind knees, wrists, neck)",
    ],
    whoIsAffected:
      "Often begins in infancy or childhood but can present or persist at any age. Significantly more common in individuals with a personal or family history of atopic triad (asthma, allergic rhinitis, eczema).",
    basicCareTips: [
      "Moisturize skin liberally at least twice daily and immediately after bathing with fragrance-free creams or ointments.",
      "Use lukewarm water and mild, soap-free cleansers; avoid prolonged hot baths or showers.",
      "Avoid scratching by keeping fingernails trimmed short and applying cool compresses to itchy areas.",
      "Wear soft, breathable cotton fabrics and avoid itchy wool or synthetic fibers.",
      "Identify and minimize exposure to personal flare triggers such as dry air, harsh detergents, sweat, or dust.",
    ],
    whenToSeeDoctor:
      "Seek medical care if itching disrupts sleep, if skin shows signs of secondary bacterial infection (yellow crusting, oozing pus, fever, increasing pain), or when symptoms fail to improve with gentle moisturizing.",
    medicalSources: [
      {
        organization: "American Academy of Dermatology (AAD)",
        title: "Atopic dermatitis symptoms",
        url: "https://www.aad.org/public/diseases/eczema/types/atopic-dermatitis/symptoms",
      },
      {
        organization: "American Academy of Dermatology (AAD)",
        title: "Atopic dermatitis skin care",
        url: "https://www.aad.org/public/diseases/eczema/types/atopic-dermatitis/atopic-dermatitis-coping",
      },
      {
        organization: "DermNet NZ",
        title: "Atopic dermatitis",
        url: "https://dermnetnz.org/topics/atopic-dermatitis",
      },
      {
        organization: "Cleveland Clinic",
        title: "Atopic dermatitis",
        url: "https://my.clevelandclinic.org/health/diseases/24299-atopic-dermatitis",
      },
    ],
  },

  "contact dermatitis": {
    id: "contact_dermatitis",
    name: "Contact Dermatitis",
    filipinoName: "Pantal / Alerhiya sa Balat",
    category: "Inflammatory",
    definition:
      "Contact dermatitis is an inflammatory skin reaction that develops when a substance touching the skin directly damages it (irritant contact dermatitis) or triggers an immune-mediated allergic response (allergic contact dermatitis). It presents with itching, burning or stinging, localized redness, swelling, dryness, blisters, or oozing.",
    commonSymptoms: [
      "Noticeable itching, burning, or stinging sensation in the exposed area",
      "Red, pink, purple, or darker skin discoloration outlining contact boundary",
      "Dry, cracked, peeling, or flaky skin surface",
      "Clusters of small fluid-filled blisters that may ooze or form crusts",
      "Swelling or raised hive-like plaques appearing after product/substance contact",
    ],
    whoIsAffected:
      "Can affect anyone exposed to skin irritants (solvents, harsh soaps, detergents) or contact allergens (nickel in jewelry, fragrances, poison ivy, cosmetic preservatives). Occupational exposure is a leading cause.",
    basicCareTips: [
      "Identify and immediately discontinue contact with suspected trigger products, chemicals, or jewelry.",
      "Gently wash the affected skin with lukewarm water and mild soap soon after any suspected contact.",
      "Apply cool, wet compresses or fragrance-free barrier moisturizers to calm itching and restore hydration.",
      "Use protective nitrile or vinyl gloves when handling cleaning chemicals, detergents, or occupational irritants.",
      "Do not deliberately re-apply or re-test suspected allergens on actively inflamed skin.",
    ],
    whenToSeeDoctor:
      "Seek prompt medical attention if the rash is near the eyes, mouth, or genitals, covers large body areas, causes severe pain/blistering, shows signs of bacterial infection, or fails to resolve within 2 to 3 weeks.",
    medicalSources: [
      {
        organization: "American Academy of Dermatology (AAD)",
        title: "Contact dermatitis symptoms",
        url: "https://www.aad.org/public/diseases/eczema/types/contact-dermatitis/symptoms",
      },
      {
        organization: "American Academy of Dermatology (AAD)",
        title: "Contact dermatitis causes & overview",
        url: "https://www.aad.org/public/diseases/eczema/types/contact-dermatitis",
      },
      {
        organization: "DermNet NZ",
        title: "Contact dermatitis",
        url: "https://dermnetnz.org/topics/contact-dermatitis",
      },
      {
        organization: "Cleveland Clinic",
        title: "Contact dermatitis",
        url: "https://my.clevelandclinic.org/health/diseases/6173-contact-dermatitis",
      },
    ],
  },

  melasma: {
    id: "melasma",
    name: "Melasma",
    filipinoName: "Pekas",
    category: "Pigmentation",
    definition:
      "Melasma is an acquired hyperpigmentation disorder characterized by flat, symmetrical brown or gray-brown patches, most frequently appearing on sun-exposed facial areas (cheeks, forehead, bridge of nose, upper lip). Sunlight and visible light stimulate melanin overproduction, and hormonal factors (pregnancy, oral contraceptives) often play a significant role.",
    commonSymptoms: [
      "Flat light brown, dark brown, or blue-gray patches on the face",
      "Symmetrical distribution over cheeks, forehead, chin, or upper lip",
      "Darkening or increased visibility after sun or visible light exposure",
      "Absence of itching, pain, swelling, or texture roughness",
      "Smooth skin surface without raised bumps or scaling",
    ],
    whoIsAffected:
      "Predominantly affects women (approximately 90% of cases), particularly those with darker skin phototypes (Fitzpatrick III–VI). Common during pregnancy ('mask of pregnancy') or with oral contraceptive use.",
    basicCareTips: [
      "Apply broad-spectrum, water-resistant sunscreen with SPF 30–50+ daily every 2 hours when outdoors.",
      "Use tinted sunscreens containing iron oxides, which help protect against visible light that worsens melasma.",
      "Wear wide-brimmed hats and seek shade during peak UV hours (10:00 AM to 4:00 PM).",
      "Choose gentle, fragrance-free skincare products; discontinue items that sting or burn, as irritation exacerbates pigmentation.",
      "Discuss with your physician if hormonal therapies or contraceptives might be contributing factors.",
    ],
    whenToSeeDoctor:
      "Consult a board-certified dermatologist for persistent pigmentation or before trying prescription lightening regimens (e.g., hydroquinone, azelaic acid, retinoids) or chemical procedures.",
    medicalSources: [
      {
        organization: "American Academy of Dermatology (AAD)",
        title: "Melasma symptoms & overview",
        url: "https://www.aad.org/public/diseases/a-z/melasma-symptoms",
      },
      {
        organization: "American Academy of Dermatology (AAD)",
        title: "Melasma self-care",
        url: "https://www.aad.org/public/diseases/a-z/melasma-self-care",
      },
      {
        organization: "DermNet NZ",
        title: "Melasma",
        url: "https://dermnetnz.org/topics/melasma",
      },
      {
        organization: "Cleveland Clinic",
        title: "Melasma",
        url: "https://my.clevelandclinic.org/health/diseases/21454-melasma",
      },
    ],
  },

  vitiligo: {
    id: "vitiligo",
    name: "Vitiligo",
    filipinoName: "Pagputi ng Balat",
    category: "Pigmentation",
    definition:
      "Vitiligo is an autoimmune skin condition in which the body's immune system attacks melanocytes (pigment-producing cells), resulting in well-defined chalky white or lighter patches. The patches are smooth and flat. Depigmented skin lacks melanin protection and sunburns very easily.",
    commonSymptoms: [
      "Smooth, flat white or depigmented patches noticeably lighter than surrounding skin",
      "Loss of color inside mucous membranes (mouth, lips) or premature whitening of body hair",
      "Lesions that may slowly enlarge or appear in new body sites over time",
      "Heightened sensitivity and rapid sunburn on depigmented skin when exposed to sun",
      "Absence of scaling, bumps, or active bleeding",
    ],
    whoIsAffected:
      "Can affect people of all ages, sexes, and ethnicities, commonly beginning before age 30. Higher incidence in individuals with personal or family history of autoimmune diseases (thyroid disorders, type 1 diabetes, alopecia areata).",
    basicCareTips: [
      "Protect depigmented skin with broad-spectrum SPF 30+ sunscreen, protective clothing, and sunglasses.",
      "Avoid deliberate sunbathing and tanning beds, as sunburn can cause severe burns and trigger new lesions (Koebner phenomenon).",
      "Minimize avoidable skin trauma, cuts, scrapes, and tight friction on vulnerable areas.",
      "Keep skin well hydrated with gentle, fragrance-free moisturizers.",
      "Seek psychological support or community groups if skin appearance affects self-esteem or mental well-being.",
    ],
    whenToSeeDoctor:
      "Consult a dermatologist promptly upon noticing new white or light patches for accurate differential diagnosis (e.g., ruling out tinea versicolor or pityriasis alba) and early treatment discussions such as topical prescription agents or phototherapy.",
    medicalSources: [
      {
        organization: "American Academy of Dermatology (AAD)",
        title: "Vitiligo diagnosis and treatment",
        url: "https://www.aad.org/public/diseases/a-z/vitiligo-treatment",
      },
      {
        organization: "American Academy of Dermatology (AAD)",
        title: "Vitiligo self-care",
        url: "https://www.aad.org/public/diseases/a-z/vitiligo-self-care",
      },
      {
        organization: "DermNet NZ",
        title: "Vitiligo",
        url: "https://dermnetnz.org/topics/vitiligo",
      },
      {
        organization: "Cleveland Clinic",
        title: "Vitiligo",
        url: "https://my.clevelandclinic.org/health/diseases/12419-vitiligo",
      },
    ],
  },
};

/**
 * Helper to retrieve a condition guide by condition name or alias
 */
export function getConditionGuide(name?: string | null): ConditionGuide | null {
  if (!name) return null;
  const clean = name.trim().toLowerCase();

  if (clean.includes("acne")) return CONDITION_GUIDES["acne vulgaris"];
  if (clean.includes("atopic") || clean.includes("eczema")) return CONDITION_GUIDES["atopic dermatitis"];
  if (clean.includes("contact")) return CONDITION_GUIDES["contact dermatitis"];
  if (clean.includes("melasma")) return CONDITION_GUIDES["melasma"];
  if (clean.includes("vitiligo")) return CONDITION_GUIDES["vitiligo"];

  return null;
}
