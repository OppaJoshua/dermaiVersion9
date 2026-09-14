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
    filipinoName: "Puti sa Balat",
    category: "Pigmentation",
    description: "A skin condition in which the body’s immune system destroys melanocytes, the cells that produce skin pigment (melanin), causing areas of skin to lose their color.",
    image: vitiligoImg,
    symptoms: [
      "Flat patches or macules of skin that appear lighter than natural skin tone or turn white",
      "Hair on affected areas may turn silver, gray, or white",
      "Patches of discolored mucous membranes (inside mouth, lips, nose, or genitals) ",
      "Some people experience itchy skin before depigmentation begins",
      "Symptoms range from a few small patches to widespread skin color loss",
    ],
    whoAffected: "Can affect anyone regardless of age, though it often starts before age 20. People with a family history of vitiligo or other autoimmune conditions are at higher risk.",
    careTips: [
      "Apply broad-spectrum sunscreen with SPF 30 or higher daily on depigmented patches to prevent sunburn.",
      "Wear protective clothing (long sleeves, wide-brimmed hats) to minimize sun exposure on affected areas.",
      "Use fragrance-free moisturizers daily to keep skin healthy and hydrated.",
      "Manage stress through regular exercise, adequate sleep, and relaxation techniques.",
      "Avoid skin injuries, cuts, or trauma to reduce the risk of new patches forming at wound sites.",
      "Use cosmetics or self-tanning products to camouflage depigmented patches if desired.",
      "Stay up to date with management of any associated autoimmune conditions.",
      "Seek counseling or support groups if vitiligo is affecting self-esteem or mental health.",
      "Work with a dermatologist to explore treatment options such as topical medications, light therapy, or surgery.",
      "Practice safe sun habits; limit sun exposure during peak hours (10 AM to 4 PM).",
    ],
    whenToSeeDoctor: "Consult a dermatologist for proper diagnosis and to discuss treatment options such as topical steroids, phototherapy, or camouflage — early treatment can help manage spread.",
  },
  {
    id: "atopic-dermatitis",
    name: "Atopic Dermatitis",
    filipinoName: "Eksema",
    category: "Inflammatory",
    description: "A chronic (long-lasting) skin condition that causes dry, itchy, and discolored patches of skin.\n\nAlso known as eczema; atopic dermatitis is the most common type of eczema.\n\nAffects both children and adults, often beginning in childhood and flaring up throughout life.",
    image: atopicDermatitisImg,
    symptoms: [
      "Skin rash",
      "Dry or cracked skin",
      "Intensely itchy skin",
      "Red, purple, brown, or gray skin discoloration",
      "Small, fluid-filled bumps or crusting",
      "Swelling",
    ],
    whoAffected: "Often begins in childhood but can occur at any age. Common in people with a family history of allergies, asthma, or hay fever.",
    careTips: [
      "Moisturize skin at least twice daily with fragrance-free lotion or cream",
      "Use mild, unscented soap and lukewarm (not hot) water when bathing",
      "Avoid scratching — keep nails trimmed short",
      "Wear soft, breathable cotton clothing",
      "Identify and avoid personal triggers (sweat, stress, certain fabrics, allergens)",
    ],
    whenToSeeDoctor: "If itching disrupts sleep, skin appears infected (oozing, crusting, fever), or symptoms don't improve with regular moisturizing and OTC care.",
  },
  {
    id: "melasma",
    name: "Melasma",
    filipinoName: "Pekas",
    category: "Pigmentation",
    description: "A common skin condition characterized by light brown, dark brown, or blue-gray patches or freckle-like spots.\n\nAlso known as chloasma or the “mask of pregnancy” due to its frequent occurrence during pregnancy.\n\nCaused by overproduction of melanin in response to sun exposure or hormonal stimulation.\n\nHarmless and non-contagious, but may cause self-consciousness due to visible skin changes.",
    image: melasmaImg,
    symptoms: [
      "Light brown, dark brown, or blue-gray flat patches or freckle-like spots on sun-exposed skin",
      "Patches commonly on the cheeks, forehead, nose, chin, and upper lip",
      "Patches may also appear on the forearms, neck, or back",
      "Symmetrical appearance on both sides of the face",
      "Patches darken in summer and lighten in winter",
      "No pain, itching, or physical discomfort",
    ],
    whoAffected: "More common in women, especially during pregnancy or while taking birth control pills. People with darker skin tones and high sun exposure are at greater risk.",
    careTips: [
      "Apply a broad-spectrum sunscreen with SPF 30–50 and iron oxides every two hours when outdoors.",
      "Wear a wide-brimmed hat and protective clothing to minimize sun exposure on affected areas.",
      "Avoid tanning beds and prolonged exposure to UV light sources.",
      "Reduce screen time on LED devices (phone, laptop, tablet, TV) which may worsen melasma.",
      "Use gentle, non-irritating, fragrance-free skin care products and soaps.",
      "Discuss with a doctor whether current oral contraceptives or hormone therapy may be contributing.",
      "Apply prescribed topical agents (such as hydroquinone, azelaic acid, or tretinoin) as directed.",
      "Maintain a skin-healthy diet with adequate Vitamin D (found in eggs, oily fish, fortified milk).",
      "Be consistent with treatment and sun protection, as melasma is a chronic condition that can return.",
    ],
    whenToSeeDoctor: "If patches don't fade after stopping triggers (like pregnancy or birth control), or for guidance on prescription lightening treatments.",
  },
  {
    id: "acne",
    name: "Acne",
    filipinoName: "Tagihawat",
    category: "Acne",
    description: "A common skin condition that occurs when hair follicles become clogged with oil and dead skin cells, causing whiteheads, blackheads, pimples, or deeper cysts.",
    image: acneRosaceaImg,
    symptoms: [
      "Pimples or pustules", 
      "Blackheads",
      "Whiteheads",
      "Red or inflamed bumps",
      "Painful nodules",
      "Cysts with pus",
      "Swelling and tenderness",
      "Oily skin",
    ],
    whoAffected: "Most common among teenagers due to hormonal changes, but can affect adults as well, especially those with oily skin, hormonal imbalances, or high stress levels.",
    careTips: [
      "Wash your face twice daily with warm water and a gentle, non-comedogenic cleanser.",
      "Wash skin after exercising or sweating to remove excess oil and bacteria.",
      "Use an oil-free, non-comedogenic moisturizer after cleansing.",
      "Avoid picking, squeezing, or popping pimples to prevent scarring and further infection.",
      "Choose makeup and skincare products labeled “non-comedogenic” or “oil-free”.",
      "Remove all makeup before sleeping.",
      "Keep hands away from your face to reduce bacteria transfer.",
      "Manage stress through exercise, sleep, and relaxation techniques, as stress worsens breakouts.",
      "Eat a balanced diet; limit high-sugar foods, skim milk, and whey protein which may trigger acne.",
      "Apply over-the-counter treatments with benzoyl peroxide or salicylic acid as directed.",
    ],
    whenToSeeDoctor: "If acne is severe, cystic, leaves scars, or doesn't improve after consistent OTC treatment for 6-8 weeks — a dermatologist can prescribe stronger treatments.",
  },
  {
    id: "contact-dermatitis",
    name: "Contact Dermatitis",
    filipinoName: "Pantal",
    category: "Inflammatory",
    description: "A skin reaction that occurs when the skin comes into direct contact with an allergen or irritant.\n\nTwo main types: allergic contact dermatitis (immune-mediated) and irritant contact dermatitis (direct skin damage).\n\nCommon among people regularly exposed to chemicals, allergens, or irritants at work or at home.",
    image: contactDermatitisImg,
    symptoms: [
      "Red to purple or darker-than-normal skin discoloration",
      "Swollen, hive-like, or elevated rash",
      "Bumpy rash with small clusters of pimples or blisters",
      "Oozing fluid or pus",
      "Burning or stinging sensation",
      "Flaky or scaling skin",
      "Intense itching",
    ],
    whoAffected: "Can affect anyone exposed to irritants or allergens. Common among people who work with cleaning products, chemicals, or wear jewelry containing nickel. Occupational exposure is a leading cause.",
    careTips: [
      "Identify and avoid the allergen or irritant that caused the reaction as quickly as possible.",
      "Wash the affected skin immediately with soap and water after suspected exposure.",
      "Apply over-the-counter hydrocortisone cream or calamine lotion to relieve itching and redness.",
      "Take oral antihistamines as directed to help reduce itching and swelling.",
      "Keep the rash clean and dry; cover open sores with a loose, non-adhesive bandage if needed.",
      "Avoid scratching the rash to prevent infection and further skin damage.",
      "Choose fragrance-free, hypoallergenic moisturizers and skin care products.",
      "Use protective gloves when handling cleaning products, chemicals, or known irritants.",
      "Wash hands and skin promptly after contact with any potential allergens or irritants.",
      "If the rash is work-related, request a chemical safety data sheet from your employer to identify the cause.",
    ],
    whenToSeeDoctor: "If the rash spreads, doesn't improve within 2-3 weeks, covers a large area, or is accompanied by severe swelling or signs of infection.",
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
