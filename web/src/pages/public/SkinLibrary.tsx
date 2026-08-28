import { useState } from "react";
import { Link } from "react-router-dom";
import { Search, ArrowRight } from "lucide-react";
import { cn } from "../../lib/utils";
import { motion } from "framer-motion";
import vitiligoImg from "../../assets/vitiligo.jpg";
import atopicDermatitisImg from "../../assets/atopicDermatitis.jpg";
import acneRosaceaImg from "../../assets/acneVulgaris.jpg";
import contactDermatitisImg from "../../assets/contactDermatitis.jpg";
import melasmaImg from "../../assets/Melasma.jpg";

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

const categoryColors: Record<string, string> = {
  Acne: "bg-rose-100 text-rose-700",
  Inflammatory: "bg-orange-100 text-orange-700",
  Pigmentation: "bg-amber-100 text-amber-700",
};

export default function SkinLibraryPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  const filtered = skinConditions.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.filipinoName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "All" || c.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="min-h-screen bg-magenta-50 pt-8 pb-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-magenta-900 mb-2">
            Skin Condition Library
          </h1>
          <p className="text-magenta-700/60 text-sm max-w-md mx-auto">
            Learn about common skin conditions in the Philippines
          </p>
        </div>

        {/* Search & Filters */}
        <div className="bg-white rounded-[20px] shadow-[0_4px_24px_rgba(160,25,90,0.08)] p-4 sm:p-6 mb-8">
          <div className="flex items-center gap-2 bg-magenta-50 rounded-full px-4 py-2.5 mb-4">
            <Search className="w-4 h-4 text-magenta-400 shrink-0" />
            <input
              type="text"
              placeholder="Search conditions..."
              className="flex-1 bg-transparent outline-none text-sm text-magenta-900 placeholder:text-magenta-300"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={cn(
                  "px-4 py-1.5 rounded-full text-xs font-semibold transition-all active:scale-[0.96]",
                  selectedCategory === cat
                    ? "bg-magenta-500 text-white"
                    : "bg-magenta-50 text-magenta-600 hover:bg-magenta-100"
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Card Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((condition, i) => (
            <motion.div
              key={condition.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Link
                to={`/skin-library/${condition.id}`}
                className="group block bg-white rounded-[20px] shadow-[0_4px_24px_rgba(160,25,90,0.06)] hover:shadow-[0_8px_40px_rgba(160,25,90,0.12)] transition-all duration-300 overflow-hidden"
              >
                <div className="h-44 overflow-hidden">
                  <img
                    src={condition.image}
                    alt={condition.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                </div>
                <div className="p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={cn(
                        "px-2.5 py-0.5 rounded-full text-[10px] font-bold",
                        categoryColors[condition.category] || "bg-gray-100 text-gray-600"
                      )}
                    >
                      {condition.category}
                    </span>
                  </div>
                  <h3 className="font-display font-bold text-magenta-900 text-base mb-0.5">
                    {condition.name}
                  </h3>
                  <p className="text-xs text-magenta-400 mb-2">{condition.filipinoName}</p>
                  <p className="text-sm text-magenta-700/60 leading-relaxed mb-3 line-clamp-2">
                    {condition.description}
                  </p>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-magenta-500 group-hover:text-magenta-600">
                    Learn More <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <Search className="w-10 h-10 text-magenta-200 mx-auto mb-3" />
            <p className="text-magenta-400 text-sm">No conditions found matching your search</p>
          </div>
        )}
      </div>
    </div>
  );
}
