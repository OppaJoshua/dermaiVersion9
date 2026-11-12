import { useState } from "react";
import { Link } from "react-router-dom";
import { Search, ArrowRight } from "lucide-react";
import { cn } from "../../lib/utils";
import { motion } from "framer-motion";
import vitiligoImg from "@/assets/vitiligo.jpg";
import atopicDermatitisImg from "@/assets/atopicDermatitis.jpg";
import acneRosaceaImg from "@/assets/acneVulgaris.jpg";
import contactDermatitisImg from "@/assets/contactDermatitis.jpg";
import melasmaImg from "@/assets/Melasma.jpg";

export const skinConditions = [
  {
    id: "vitiligo",
    name: "Vitiligo",
    filipinoName: "Pagputi ng balat",
    category: "Pigmentation",
    description: "Vitiligo is an autoimmune skin condition in which the body's immune system attacks melanocytes (pigment-producing cells), resulting in well-defined chalky white or lighter patches. The patches are smooth and flat. Depigmented skin lacks melanin protection and sunburns very easily.",
    image: vitiligoImg,
    symptoms: [
       "Smooth, flat white or depigmented patches noticeably lighter than surrounding skin",
      "Loss of color inside mucous membranes (mouth, lips) or premature whitening of body hair",
      "Lesions that may slowly enlarge or appear in new body sites over time",
      "Heightened sensitivity and rapid sunburn on depigmented skin when exposed to sun",
      "Absence of scaling, bumps, or active bleeding",
    ],
    whoAffected: "Can affect people of all ages, sexes, and ethnicities, commonly beginning before age 30. Higher incidence in individuals with personal or family history of autoimmune diseases (thyroid disorders, type 1 diabetes, alopecia areata).",
    careTips: [
       "Protect depigmented skin with broad-spectrum SPF 30+ sunscreen, protective clothing, and sunglasses.",
      "Avoid deliberate sunbathing and tanning beds, as sunburn can cause severe burns and trigger new lesions (Koebner phenomenon).",
      "Minimize avoidable skin trauma, cuts, scrapes, and tight friction on vulnerable areas.",
      "Keep skin well hydrated with gentle, fragrance-free moisturizers.",
      "Seek psychological support or community groups if skin appearance affects self-esteem or mental well-being.",
    ],
    whenToSeeDoctor: "Consult a dermatologist promptly upon noticing new white or light patches for accurate differential diagnosis (e.g., ruling out tinea versicolor or pityriasis alba) and early treatment discussions such as topical prescription agents or phototherapy.",
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
  {
    id: "atopic-dermatitis",
    name: "Atopic Dermatitis",
    filipinoName: "Eksema",
    category: "Inflammatory",
    description: "Atopic dermatitis is a chronic, relapsing inflammatory skin condition that commonly causes intense itching, dry or scaly skin, and discolored, inflamed patches. Depending on skin tone, affected areas may appear red, brown, purple, or gray. Skin can become rough, cracked, swollen, or develop blisters that ooze and crust. It typically comes and goes in flares.",
    image: atopicDermatitisImg,
    symptoms: [
      "Intense, persistent itching that frequently disrupts sleep",
      "Dry, rough, scaly, or cracked skin barrier",
      "Discolored patches (red, pink, purple, brown, or gray)",
      "Small fluid-filled blisters or areas with oozing and crusting during flares",
      "Frequent involvement of skin creases (elbow folds, behind knees, wrists, neck)",
    ],
    whoAffected:  "Often begins in infancy or childhood but can present or persist at any age. Significantly more common in individuals with a personal or family history of atopic triad (asthma, allergic rhinitis, eczema).",
    careTips: [
     "Moisturize skin liberally at least twice daily and immediately after bathing with fragrance-free creams or ointments.",
      "Use lukewarm water and mild, soap-free cleansers; avoid prolonged hot baths or showers.",
      "Avoid scratching by keeping fingernails trimmed short and applying cool compresses to itchy areas.",
      "Wear soft, breathable cotton fabrics and avoid itchy wool or synthetic fibers.",
      "Identify and minimize exposure to personal flare triggers such as dry air, harsh detergents, sweat, or dust.",
    ],
    whenToSeeDoctor: "Seek medical care if itching disrupts sleep, if skin shows signs of secondary bacterial infection (yellow crusting, oozing pus, fever, increasing pain), or when symptoms fail to improve with gentle moisturizing.",
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
  {
    id: "melasma",
    name: "Melasma",
    filipinoName: "Pekas",
    category: "Pigmentation",
    description: "Melasma is an acquired hyperpigmentation disorder characterized by flat, symmetrical brown or gray-brown patches, most frequently appearing on sun-exposed facial areas (cheeks, forehead, bridge of nose, upper lip). Sunlight and visible light stimulate melanin overproduction, and hormonal factors (pregnancy, oral contraceptives) often play a significant role.",
    image: melasmaImg,
    symptoms: [
      "Flat light brown, dark brown, or blue-gray patches on the face",
      "Symmetrical distribution over cheeks, forehead, chin, or upper lip",
      "Darkening or increased visibility after sun or visible light exposure",
      "Absence of itching, pain, swelling, or texture roughness",
      "Smooth skin surface without raised bumps or scaling",
    ],
    whoAffected:  "Predominantly affects women (approximately 90% of cases), particularly those with darker skin phototypes (Fitzpatrick III–VI). Common during pregnancy ('mask of pregnancy') or with oral contraceptive use.",
    careTips: [
       "Apply broad-spectrum, water-resistant sunscreen with SPF 30–50+ daily every 2 hours when outdoors.",
      "Use tinted sunscreens containing iron oxides, which help protect against visible light that worsens melasma.",
      "Wear wide-brimmed hats and seek shade during peak UV hours (10:00 AM to 4:00 PM).",
      "Choose gentle, fragrance-free skincare products; discontinue items that sting or burn, as irritation exacerbates pigmentation.",
      "Discuss with your physician if hormonal therapies or contraceptives might be contributing factors.",
    ],
    whenToSeeDoctor: "Consult a board-certified dermatologist for persistent pigmentation or before trying prescription lightening regimens (e.g., hydroquinone, azelaic acid, retinoids) or chemical procedures.",
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
  {
    id: "acne",
    name: "Acne Vulgaris",
    filipinoName: "Taghiyawat",
    category: "Acne",
    description: "Acne vulgaris is a common inflammatory condition of the pilosebaceous unit. It produces non-inflammatory comedones (blackheads and whiteheads) and inflammatory lesions such as papules, pustules, and deeper painful nodules. It commonly affects the face, neck, chest, and back. Some lesions can leave dark marks or scars.",
    image: acneRosaceaImg,
    symptoms: [
     "Blackheads (open comedones) and whiteheads (closed comedones)",
      "Red, inflamed pimples and tender pustules filled with pus",
      "Deeper, painful cysts or nodules under the skin",
      "Oily or greasy skin with visible pore congestion",
      "Post-inflammatory marks or scarring after healing",
    ],
    whoAffected:  "Most common during adolescence and young adulthood due to hormonal changes, but frequently persists into or begins in adulthood, especially among individuals with oily skin or high stress.",
    careTips: [
      "Gently wash the face up to twice daily and after sweating with a mild, non-abrasive cleanser; avoid vigorous scrubbing.",
      "Choose gentle, oil-free or non-comedogenic skin-care products and sunscreen.",
      "Avoid picking, popping, or squeezing lesions to reduce inflammation, healing time, and scarring risk.",
      "Avoid frequently switching irritating products or using harsh physical exfoliants that disrupt the skin barrier.",
      "Maintain a clean pillowcase, phone surface, and hair off the forehead to minimize surface bacteria transfer.",
    ],
    whenToSeeDoctor: "Seek professional evaluation for deep or painful nodules/cysts, widespread or persistent breakouts unresponsive to 6–8 weeks of OTC care, scarring, or substantial emotional distress.",
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
  {
    id: "contact-dermatitis",
    name: "Contact Dermatitis",
    filipinoName: "Pantal/Alerhiya sa balat",
    category: "Inflammatory",
    description:   "Atopic dermatitis is a chronic, relapsing inflammatory skin condition that commonly causes intense itching, dry or scaly skin, and discolored, inflamed patches. Depending on skin tone, affected areas may appear red, brown, purple, or gray. Skin can become rough, cracked, swollen, or develop blisters that ooze and crust. It typically comes and goes in flares.",
    image: contactDermatitisImg,
    symptoms: [
     "Intense, persistent itching that frequently disrupts sleep",
      "Dry, rough, scaly, or cracked skin barrier",
      "Discolored patches (red, pink, purple, brown, or gray)",
      "Small fluid-filled blisters or areas with oozing and crusting during flares",
      "Frequent involvement of skin creases (elbow folds, behind knees, wrists, neck)",
    ],
    whoAffected: "Often begins in infancy or childhood but can present or persist at any age. Significantly more common in individuals with a personal or family history of atopic triad (asthma, allergic rhinitis, eczema).",
    careTips: [
       "Moisturize skin liberally at least twice daily and immediately after bathing with fragrance-free creams or ointments.",
      "Use lukewarm water and mild, soap-free cleansers; avoid prolonged hot baths or showers.",
      "Avoid scratching by keeping fingernails trimmed short and applying cool compresses to itchy areas.",
      "Wear soft, breathable cotton fabrics and avoid itchy wool or synthetic fibers.",
      "Identify and minimize exposure to personal flare triggers such as dry air, harsh detergents, sweat, or dust.",
    ],
    whenToSeeDoctor:  "Seek medical care if itching disrupts sleep, if skin shows signs of secondary bacterial infection (yellow crusting, oozing pus, fever, increasing pain), or when symptoms fail to improve with gentle moisturizing.",
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
];

const categories = ["All", "Acne", "Inflammatory", "Pigmentation"];

export default function SkinLibraryPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  const filtered = skinConditions.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.filipinoName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "All" || c.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="min-h-screen bg-white text-slate-900 pt-8 pb-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-magenta-50 border border-magenta-100 text-magenta-700 text-xs font-semibold uppercase tracking-wider mb-3">
            Dermatology Knowledge Base
          </div>
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-slate-900 mb-2">
            Skin Condition Library
          </h1>
          <p className="text-slate-500 text-sm max-w-lg mx-auto leading-relaxed">
            Medical information, common symptoms, self-care guidelines, and localized insights for common skin conditions in the Philippines.
          </p>
        </div>

        {/* Search & Filters */}
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm p-4 sm:p-5 mb-8">
          <div className="flex flex-col md:flex-row gap-3 sm:items-center justify-between">
            {/* Search input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Search by condition name, Tagalog name, or symptoms..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-sm text-slate-900 placeholder:text-slate-400 focus:border-magenta-500 focus:bg-white focus:ring-4 focus:ring-magenta-500/10 outline-none transition-all"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-3 text-xs text-slate-400 hover:text-slate-600 font-semibold"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Category Pills */}
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs font-semibold text-slate-500 mr-1 hidden sm:inline">Category:</span>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    "px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer active:scale-[0.96]",
                    selectedCategory === cat
                      ? "bg-magenta-500 text-white shadow-sm shadow-magenta-500/20"
                      : "bg-slate-50 border border-slate-200 text-slate-700 hover:bg-magenta-50/60 hover:text-magenta-700 hover:border-magenta-200"
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Card Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((condition, i) => (
            <motion.div
              key={condition.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <Link
                to={`/skin-library/${condition.id}`}
                className="group flex flex-col h-full bg-white rounded-3xl border border-slate-200/80 shadow-sm hover:shadow-md hover:border-magenta-300 transition-all duration-300 overflow-hidden"
              >
                {/* Photo Header */}
                <div className="h-48 overflow-hidden relative bg-slate-100">
                  <img
                    src={condition.image}
                    alt={condition.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute top-3 left-3">
                    <span
                      className={cn(
                        "px-2.5 py-0.5 rounded-full text-[11px] font-bold shadow-xs",
                        condition.category === "Acne"
                          ? "bg-rose-50 text-rose-700 border border-rose-200/80"
                          : condition.category === "Inflammatory"
                            ? "bg-orange-50 text-orange-700 border border-orange-200/80"
                            : "bg-amber-50 text-amber-700 border border-amber-200/80"
                      )}
                    >
                      {condition.category}
                    </span>
                  </div>
                </div>

                {/* Content Body */}
                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className="font-display font-bold text-slate-900 text-lg group-hover:text-magenta-600 transition-colors">
                        {condition.name}
                      </h3>
                    </div>
                    <p className="text-xs font-semibold text-magenta-600 mb-2.5">
                      Filipino: {condition.filipinoName}
                    </p>
                    <p className="text-xs text-slate-600 leading-relaxed mb-4 line-clamp-2">
                      {condition.description}
                    </p>
                  </div>

                  {/* Card Bottom Meta & CTA */}
                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-400">
                      {condition.symptoms.length} common symptoms
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-magenta-600 group-hover:text-magenta-700 group-hover:translate-x-0.5 transition-transform">
                      Learn More <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>

        {/* Empty State */}
        {filtered.length === 0 && (
          <div className="bg-white rounded-3xl border border-slate-200/80 p-12 text-center my-6">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-400">
              <Search className="w-6 h-6" />
            </div>
            <h3 className="font-display font-bold text-slate-900 text-base mb-1">
              No matching skin conditions found
            </h3>
            <p className="text-slate-500 text-xs mb-4">
              Try adjusting your keyword or clearing the category filter.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setSelectedCategory("All");
              }}
              className="px-4 py-2 rounded-full bg-magenta-500 text-white text-xs font-semibold hover:bg-magenta-600 transition-colors shadow-sm"
            >
              Reset Filters
            </button>
          </div>
        )}

        {/* Bottom Professional Assessment Banner */}
        <div className="mt-12 bg-slate-50 border border-slate-200/80 rounded-3xl p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div>
            <span className="inline-block px-2.5 py-0.5 rounded-md bg-magenta-100 text-magenta-700 text-[11px] font-bold uppercase tracking-wide mb-2">
              Preliminary Triage
            </span>
            <h3 className="text-xl font-display font-bold text-slate-900 mb-1">
              Not sure about your skin condition?
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 max-w-xl leading-relaxed">
              Use DermAI’s clinical photo analyzer and symptom questionnaire for an instant AI-powered pre-screening, or book an in-person consultation with accredited Cebu dermatologists.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <Link
              to="/scan"
              className="px-6 py-3 rounded-full bg-magenta-500 text-white text-sm font-semibold hover:bg-magenta-600 transition-all shadow-md shadow-magenta-500/20 active:scale-[0.96]"
            >
              Scan Skin Now
            </Link>
            <Link
              to="/find-clinics"
              className="px-5 py-3 rounded-full border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-all active:scale-[0.96]"
            >
              Find Cebu Clinics
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
