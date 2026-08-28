const sections = [
  {
    title: "Information We Collect",
    body: "We collect information you provide directly, such as your name, email address, phone number, and skin scan photos, as well as usage data like appointment history and subscription details.",
  },
  {
    title: "How We Use Your Information",
    body: "Your information is used to provide AI skin analysis results, connect you with dermatology clinics, process appointments and payments, and improve our services. Skin scan photos are used solely for generating your analysis and are never sold to third parties.",
  },
  {
    title: "Data Sharing",
    body: "We only share your information with clinics you choose to book an appointment with, and with payment processors necessary to complete transactions. We do not sell your personal data to advertisers or other third parties.",
  },
  {
    title: "Data Security",
    body: "We use industry-standard encryption and access controls to protect your personal information and skin scan history from unauthorized access, alteration, or disclosure.",
  },
  {
    title: "Your Rights",
    body: "You may access, update, or request deletion of your personal data at any time from your account settings, or by contacting our support team at support@dermai.ph.",
  },
  {
    title: "Medical Disclaimer",
    body: "DERMAI provides AI-assisted preliminary skin condition assessments for educational purposes only. Results are not a medical diagnosis. Always consult a licensed dermatologist for proper evaluation and treatment.",
  },
];

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-magenta-50">
      <section className="relative bg-linear-to-br from-magenta-500 via-magenta-500 to-magenta-600 min-h-[30rem] flex items-center pt-20 pb-24">
        <div className="max-w-4xl mx-auto px-4 text-center relative">
          <p className="text-magenta-100 font-semibold text-sm tracking-wider uppercase mb-4">
            Legal
          </p>
          <h1 className="text-4xl sm:text-5xl font-display font-bold text-white mb-6">
            Privacy Policy
          </h1>
          <p className="text-magenta-100 text-sm">
            Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
        {/* Wave */}
        <div className="absolute -bottom-2 left-0 right-0">
          <svg viewBox="0 0 1440 80" className="w-full block" preserveAspectRatio="none">
            <path
              fill="#fdf2f7"
              d="M0,40 C360,80 720,10 1080,40 C1260,55 1380,50 1440,40 L1440,80 L0,80 Z"
            />
          </svg>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 py-16">
        <div className="bg-white rounded-2xl shadow-sm p-8 space-y-8">
          <p className="text-gray-600 leading-relaxed">
            This Privacy Policy explains how DERMAI collects, uses, and protects your information when you use our AI skin analysis and dermatology clinic finder platform.
          </p>
          {sections.map((section) => (
            <div key={section.title}>
              <h2 className="font-display font-semibold text-lg text-gray-900 mb-2">
                {section.title}
              </h2>
              <p className="text-gray-600 leading-relaxed">{section.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
