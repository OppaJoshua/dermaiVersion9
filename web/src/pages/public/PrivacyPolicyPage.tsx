import { Link } from "react-router-dom";
import {
  ShieldCheck,
  Lock,
  EyeOff,
  Database,
  Share2,
  Trash2,
  UserCheck,
  Building,
  Sparkles,
} from "lucide-react";

interface PrivacySection {
  id: string;
  icon: typeof ShieldCheck;
  title: string;
  summary: string;
  paragraphs: string[];
  bulletPoints?: string[];
  callout?: {
    type: "guarantee" | "warning" | "info";
    title: string;
    text: string;
  };
}

const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    id: "framework",
    icon: ShieldCheck,
    title: "1. Legal Framework & Privacy Commitment",
    summary: "DermAI's data protection principles under Philippine Republic Act No. 10173.",
    paragraphs: [
      "DermAI ('we', 'us', or 'our') is committed to protecting the privacy, confidentiality, and security of our users' personal and health-related data. This Privacy Policy & Data Protection Notice describes our practices regarding the collection, processing, storage, disclosure, and protection of information in compliance with the Philippine Data Privacy Act of 2012 (Republic Act No. 10173), its Implementing Rules and Regulations (IRR), and applicable circulars and advisories issued by the National Privacy Commission (NPC), including NPC Advisory No. 2020-03.",
      "We adhere to the core privacy principles of Transparency, Legitimate Purpose, and Proportionality in all data processing operations.",
    ],
  },
  {
    id: "categories",
    icon: Database,
    title: "2. Categories of Information We Process",
    summary: "Transparent classification of personal and sensitive personal information.",
    paragraphs: [
      "To provide our preliminary AI screening, symptom evaluation, and clinic booking services, DermAI collects and processes the following verified categories of information:",
    ],
    bulletPoints: [
      "Personal Information: Full legal name, email address, active mobile number (11 digits), birthdate, gender, residential district/address within Cebu City and nearby municipalities, and user account role (patient, clinic, doctor, or admin).",
      "Sensitive Personal Information (Health Data): Uploaded skin photographs (close-up and wide-angle images), responses to the 15-question symptom questionnaire (such as duration, itchiness, bleeding, scaling, burning sensations, and triggers), AI-generated preliminary condition predictions and confidence scores, selected body part, and consultation notes submitted by attending clinic dermatologists.",
      "Billing & Payment Metadata: PayMongo transaction reference UUID, payment method (GCash or Maya), payment timestamp, currency (PHP), and consultation amount paid. Note: Skin photographs, symptom questionnaires, and AI scan results are NEVER sent to or processed by PayMongo.",
      "Technical Session & Audit Data: Account creation date, authentication provider (Email Magic Link or Google OAuth), user ID UUID, and audit log timestamps.",
    ],
    callout: {
      type: "info",
      title: "Sensitive Personal Information Notice",
      text: "Under Section 3(l) of RA 10173, individual health data and cutaneous images constitute Sensitive Personal Information (SPI) and are subject to heightened statutory safeguards.",
    },
  },
  {
    id: "no-sale-policy",
    icon: EyeOff,
    title: "3. Policy on Skin Images: No Sale, No Advertising Use",
    summary: "Guaranteed protection against commercialization, with necessary service disclosures.",
    paragraphs: [
      "DermAI does not sell, rent, or monetize uploaded skin photographs and does not use them for advertising or unrelated commercial purposes. Limited processing or disclosure may occur when necessary to provide requested platform services, such as authorized infrastructure operations or consultation with a clinic selected by the patient, subject to applicable privacy safeguards.",
      "Specifically, patient cutaneous photographs are:",
      "- NEVER sold, leased, or traded to data brokers, commercial advertisers, or pharmaceutical marketing entities.",
      "- NEVER used for public promotional displays, social media campaigns, or commercial marketing materials.",
      "- Processed exclusively to compute your preliminary AI screening results, display your private history, and share consultation context with the specific clinic and doctor you choose to book.",
    ],
    callout: {
      type: "guarantee",
      title: "Core Privacy Guarantee",
      text: "Uploaded skin photographs remain confidential health information and are never commercialized for advertising.",
    },
  },
  {
    id: "future-ai-training",
    icon: Sparkles,
    title: "4. Future AI Model Training & Dataset Retraining Policy",
    summary: "General agreement is NOT consent for AI training. Future voluntary authorization required.",
    paragraphs: [
      "Future Research Objectives: DermAI was conceptualized with the prospective developmental goal of improving AI screening accuracy, reducing demographic bias, and developing clinical skin image datasets representative of Filipino skin phototypes.",
      "Current Implementation Verification: In the current DermAI implementation, patient-uploaded skin photographs are NOT automatically transferred into model training datasets, and NO automated retraining pipeline is currently active in the production environment.",
      "No Implied or Bundled Consent: Accepting the general User Agreement, Privacy Policy, or creating an account does NOT grant DermAI permission to use your photographs for future AI model retraining or academic research datasets.",
      "Future Separate Voluntary Authorization: Before any patient-uploaded skin photographs are utilized for future AI retraining or dataset expansion, DermAI must establish a separate, voluntary, informed opt-in authorization process subject to appropriate privacy and legal review.",
      "Non-Discrimination: Choosing not to participate in future AI retraining once introduced will NOT restrict, penalize, or prevent access to DermAI's standard AI screening, symptom questionnaire, or clinic appointment booking features.",
    ],
    callout: {
      type: "warning",
      title: "Current Retraining Status",
      text: "No separate retraining consent mechanism or automated training pipeline currently exists. General agreement acceptance does NOT authorize future AI training.",
    },
  },
  {
    id: "purposes-and-basis",
    icon: Lock,
    title: "5. Purposes of Processing & Lawful Bases",
    summary: "Purposes of processing and applicable lawful bases under RA 10173.",
    paragraphs: [
      "DermAI processes personal and sensitive personal information for specific, declared purposes:",
      "1. Account Management & Service Delivery: Processing your profile details, mobile number, and address to manage authentication sessions, verify account integrity, and facilitate requested clinic bookings.",
      "2. Preliminary AI Screening: Processing uploaded skin photographs and symptom questionnaire answers to generate preliminary educational condition likelihood scores at your direct request.",
      "3. Financial Recordkeeping: Retaining official PayMongo payment reference UUIDs and transaction timestamps to comply with lawful financial recordkeeping and transaction verification obligations.",
      "Lawful Basis Clarification: The platform's single mandatory login checkbox serves as general acknowledgment of service terms and privacy information. It should not be construed as blanket consent satisfying every statutory requirement under Sections 12 and 13 of RA 10173 for all processing operations. [Note for Legal Review: The formal determination and documentation of lawful bases for processing sensitive health information require review by a qualified Philippine privacy professional.]",
    ],
  },
  {
    id: "sub-processors",
    icon: Share2,
    title: "6. Service Providers & Data Sharing",
    summary: "Authorized technical providers and clinic consultation data flows.",
    paragraphs: [
      "We share personal information only with service providers necessary to operate the platform, and with clinics you deliberately select:",
    ],
    bulletPoints: [
      "Supabase Inc.: Cloud-hosted Backend-as-a-Service providing PostgreSQL database management, user authentication, and object storage for skin photos (stored in private buckets under user ID paths).",
      "PayMongo Payments, Inc.: Bangko Sentral ng Pilipinas (BSP)-regulated payment gateway handling online consultation fee payments via GCash and Maya. PayMongo receives only billing transaction metadata (payer name, email, phone, address, and consultation amount); skin photos, questionnaires, and AI scan results are NEVER sent to or processed by PayMongo.",
      "Google LLC: Optional federated Google OAuth authentication used to verify email identity upon user selection.",
      "Resend Inc.: Transactional email service utilized to deliver secure sign-in Magic Links and appointment notifications.",
      "Selected Partner Dermatology Clinics: When you submit an appointment booking, your selected clinic's attending doctor receives your name, contact information, uploaded scan photo, symptom responses, and preliminary prediction strictly to facilitate your consultation. Clinics do not receive unrelated patient records.",
      "[Note for Legal Review: Data-sharing agreements (DSAs), sub-processor confidentiality commitments, and cross-border transfer assessments require human verification by the project owner.]",
    ],
  },
  {
    id: "retention-and-deletion",
    icon: Trash2,
    title: "7. Data Retention & Deletion Practices",
    summary: "Accurate disclosure of current scan record deletion and account removal.",
    paragraphs: [
      "Scan Record Deletion: When you choose to delete a scan from your Skin History page, the system immediately deletes the corresponding AI assessment record from the active database. [Unresolved Owner Decision: In the current technical implementation, underlying image files in cloud storage are not automatically deleted upon scan history removal, and no automated batch purging routine is deployed. A comprehensive storage deletion routine and defined retention schedule must be established by the project owner.]",
      "Account Deletion: Self-service automated account deletion is not currently implemented in the application. If you wish to delete your account, personal profile, and associated records, you must submit a verified request to our support team at support@dermai.ph.",
      "Statutory & Operational Retention: Certain operational records, including PayMongo transaction references and clinic appointment logs, may be retained where required by applicable Philippine tax, banking, or medical recordkeeping regulations.",
    ],
  },
  {
    id: "data-subject-rights",
    icon: UserCheck,
    title: "8. Rights of Data Subjects under RA 10173",
    summary: "Statutory rights guaranteed to patients under Philippine law.",
    paragraphs: [
      "Under Chapter IV of the Philippine Data Privacy Act of 2012, patients are entitled to the following statutory rights, subject to lawful conditions, exceptions, and statutory retention obligations:",
    ],
    bulletPoints: [
      "Right to be Informed: The right to know whether your personal data is being processed, including the purposes and recipients of such processing.",
      "Right to Access: The right to reasonable access to your personal data, scan history, and appointment records upon request.",
      "Right to Rectification: The right to dispute and correct any inaccurate, outdated, or incomplete information in your profile.",
      "Right to Erasure or Blocking: The right to request the suspension, withdrawal, or removal of your personal data from active systems on lawful grounds, subject to statutory retention requirements.",
      "Right to Object: The right to object to processing where processing is based on consent or legitimate interest, within statutory limits.",
      "Right to Data Portability: The right to obtain a digital copy of your personal data in an accessible, structured format where technically feasible.",
      "Right to File a Complaint: The right to seek redress before the National Privacy Commission (NPC) at https://privacy.gov.ph if you believe your privacy rights have been violated.",
    ],
  },
  {
    id: "organization-and-dpo",
    icon: Building,
    title: "9. Organization, DPO Contact & Inquiries",
    summary: "Administrative contact and regulatory details.",
    paragraphs: [
      "Operating Organization: [PUBLICATION BLOCKER: Operating legal entity or sponsoring academic institution to be confirmed by Project Owner / Capstone Defense Panel, Cebu City, Philippines].",
      "Data Protection Officer: [PUBLICATION BLOCKER: Data Protection Officer (DPO) to be formally designated and registered by Project Owner; contact email: dpo@dermai.ph].",
      "General Support: [PUBLICATION BLOCKER: Official project support email to be confirmed by Project Owner; current placeholder: support@dermai.ph].",
    ],
  },
];

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-magenta-50">
      {/* Hero Banner */}
      <section className="relative bg-linear-to-br from-magenta-500 via-magenta-500 to-magenta-600 min-h-[30rem] flex items-center pt-20 pb-24">
        <div className="max-w-4xl mx-auto px-4 text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/15 backdrop-blur-md text-magenta-100 text-xs font-semibold uppercase tracking-wider mb-4 border border-white/20">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Legal &amp; Data Protection</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-display font-bold text-white mb-4 tracking-tight">
            Privacy Policy &amp; Data Protection Notice
          </h1>
          <p className="text-magenta-100 text-sm max-w-2xl mx-auto leading-relaxed mb-4">
            How DermAI protects your personal and sensitive health information in compliance with the Philippine Data Privacy Act of 2012 (RA 10173).
          </p>
          <p className="text-magenta-200/80 text-xs">
            Last updated: November 14, 2026 &bull; Valid for DermAI Platform
          </p>
        </div>

        {/* Decorative Wave */}
        <div className="absolute -bottom-2 left-0 right-0 pointer-events-none">
          <svg viewBox="0 0 1440 80" className="w-full block" preserveAspectRatio="none">
            <path
              fill="#fdf2f7"
              d="M0,40 C360,80 720,10 1080,40 C1260,55 1380,50 1440,40 L1440,80 L0,80 Z"
            />
          </svg>
        </div>
      </section>

      {/* Main Content */}
      <section className="max-w-3xl mx-auto px-4 py-16">
        <div className="bg-white rounded-3xl shadow-sm border border-magenta-100/60 p-6 sm:p-10 space-y-8">
          {/* Quick Nav / Tab Pill Bar */}
          <div className="flex flex-wrap items-center gap-2 pb-6 border-b border-gray-100 text-xs">
            <span className="text-gray-400 font-medium mr-1">Legal Documents:</span>
            <Link
              to="/terms-of-service"
              className="px-3.5 py-1.5 rounded-full bg-gray-100 text-gray-600 hover:bg-magenta-50 hover:text-magenta-700 transition-colors font-medium"
            >
              User Agreement &amp; Terms
            </Link>
            <span className="px-3.5 py-1.5 rounded-full bg-magenta-600 text-white font-semibold shadow-xs">
              Privacy Policy
            </span>
            <Link
              to="/legal/medical-disclaimer"
              className="px-3.5 py-1.5 rounded-full bg-gray-100 text-gray-600 hover:bg-magenta-50 hover:text-magenta-700 transition-colors font-medium"
            >
              Medical Disclaimer
            </Link>
          </div>

          {/* Intro Box */}
          <div className="p-4 rounded-2xl bg-magenta-50/60 border border-magenta-100 flex items-start gap-3.5">
            <ShieldCheck className="w-5 h-5 text-magenta-600 shrink-0 mt-0.5" />
            <div className="text-xs text-gray-700 leading-relaxed space-y-1">
              <p className="font-bold text-sm text-magenta-900">
                Data Privacy Commitment under RA 10173
              </p>
              <p>
                DermAI is committed to transparent and lawful processing of personal and health data. We do not sell your skin photographs, we do not monetize them for advertising, and general agreement acceptance does NOT authorize future AI model retraining.
              </p>
            </div>
          </div>

          {/* Structured Sections */}
          <div className="space-y-10">
            {PRIVACY_SECTIONS.map((sec) => {
              const Icon = sec.icon;
              return (
                <article key={sec.id} id={sec.id} className="scroll-mt-24 space-y-3">
                  <div className="flex items-center gap-3 pb-2 border-b border-gray-100">
                    <div className="w-8 h-8 rounded-xl bg-magenta-50 text-magenta-600 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="font-display font-bold text-base sm:text-lg text-gray-900 leading-snug">
                        {sec.title}
                      </h2>
                      <p className="text-xs text-gray-500">{sec.summary}</p>
                    </div>
                  </div>

                  <div className="space-y-2.5 text-xs sm:text-sm text-gray-600 leading-relaxed pl-1 sm:pl-11">
                    {sec.paragraphs.map((p, idx) => (
                      <p key={idx}>{p}</p>
                    ))}

                    {sec.bulletPoints && (
                      <ul className="space-y-2 pl-4 list-disc text-gray-600">
                        {sec.bulletPoints.map((bp, bidx) => (
                          <li key={bidx} className="leading-relaxed">
                            {bp}
                          </li>
                        ))}
                      </ul>
                    )}

                    {sec.callout && (
                      <div
                        className={`mt-3 p-3.5 rounded-xl border flex items-start gap-2.5 text-xs font-medium ${
                          sec.callout.type === "guarantee"
                            ? "bg-emerald-50 border-emerald-200 text-emerald-950"
                            : sec.callout.type === "warning"
                            ? "bg-amber-50 border-amber-200 text-amber-950"
                            : "bg-blue-50 border-blue-200 text-blue-950"
                        }`}
                      >
                        <ShieldCheck
                          className={`w-4 h-4 shrink-0 mt-0.5 ${
                            sec.callout.type === "guarantee"
                              ? "text-emerald-600"
                              : sec.callout.type === "warning"
                              ? "text-amber-600"
                              : "text-blue-600"
                          }`}
                        />
                        <div>
                          <p className="font-bold mb-0.5">{sec.callout.title}</p>
                          <p className="font-normal">{sec.callout.text}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {/* Footer Navigation within Document */}
          <div className="pt-8 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-500">
            <p>Questions about our clinical disclaimer or terms?</p>
            <div className="flex items-center gap-3 font-semibold text-magenta-600">
              <Link to="/terms-of-service" className="hover:text-magenta-700 underline">
                User Agreement &rarr;
              </Link>
              <span>&bull;</span>
              <Link to="/legal/medical-disclaimer" className="hover:text-magenta-700 underline">
                Medical Disclaimer &rarr;
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
