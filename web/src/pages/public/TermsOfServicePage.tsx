const sections = [
  {
    title: "Acceptance of Terms",
    body: "By creating an account or using DERMAI, you agree to be bound by these Terms of Service and our Privacy Policy. If you do not agree, please do not use the platform.",
  },
  {
    title: "Use of AI Skin Analysis",
    body: "DERMAI's AI skin analysis provides preliminary, educational assessments only. It is not a substitute for professional medical advice, diagnosis, or treatment. Always seek the advice of a licensed dermatologist regarding any skin condition.",
  },
  {
    title: "Account Responsibilities",
    body: "You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account. Notify us immediately of any unauthorized use.",
  },
  {
    title: "Clinic Bookings and Payments",
    body: "Appointments booked through DERMAI are subject to the participating clinic's own policies. Subscription fees and payments are billed according to the plan you select and are non-refundable except as required by law.",
  },
  {
    title: "Prohibited Conduct",
    body: "You agree not to misuse the platform, including uploading unlawful content, attempting to access other users' data, or interfering with the normal operation of the service.",
  },
  {
    title: "Limitation of Liability",
    body: "DERMAI is not liable for any decisions made based on AI analysis results. In case of a medical emergency, contact your local emergency services or the DOH Hotline 1555 immediately.",
  },
  {
    title: "Changes to These Terms",
    body: "We may update these Terms of Service from time to time. Continued use of DERMAI after changes take effect constitutes acceptance of the revised terms.",
  },
];

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-magenta-50">
      <section className="relative bg-linear-to-br from-magenta-500 via-magenta-500 to-magenta-600 min-h-[30rem] flex items-center pt-20 pb-24">
        <div className="max-w-4xl mx-auto px-4 text-center relative">
          <p className="text-magenta-100 font-semibold text-sm tracking-wider uppercase mb-4">
            Legal
          </p>
          <h1 className="text-4xl sm:text-5xl font-display font-bold text-white mb-6">
            Terms of Service
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
            These Terms of Service govern your access to and use of DERMAI's AI skin analysis and dermatology clinic finder platform.
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
