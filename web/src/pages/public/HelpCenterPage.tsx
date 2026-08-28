import { Link } from "react-router-dom";
import { Camera, MapPin, CreditCard, ShieldQuestion, Mail } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../../components/common/Accordion";

const faqs = [
  {
    icon: Camera,
    question: "How does the AI skin analysis work?",
    answer:
      "Upload a clear photo of the affected skin area and our AI model analyzes visual patterns to give you a preliminary assessment of possible skin conditions. This is not a medical diagnosis and should always be followed up with a licensed dermatologist.",
  },
  {
    icon: MapPin,
    question: "How do I find a dermatology clinic near me?",
    answer:
      "Use the Find Clinics page to search verified dermatology clinics in Cebu City by location, specialty, and availability, then book an appointment directly through the app.",
  },
  {
    icon: CreditCard,
    question: "How do I upgrade or manage my subscription?",
    answer:
      "Go to Dashboard > Settings > Billing to view your current plan, upgrade to premium, or manage your payment method and subscription status.",
  },
  {
    icon: ShieldQuestion,
    question: "Is my data and skin scan history private?",
    answer:
      "Yes. Your scans and personal information are encrypted and only used to provide you with analysis results and connect you with clinics you choose to book with. See our Privacy Policy for details.",
  },
];

export default function HelpCenterPage() {
  return (
    <div className="min-h-screen bg-magenta-50">
      <section className="relative bg-linear-to-br from-magenta-500 via-magenta-500 to-magenta-600 pt-32 pb-24">
        <div className="max-w-4xl mx-auto px-4 text-center relative">
          <p className="text-magenta-100 font-semibold text-sm tracking-wider uppercase mb-4">
            Support
          </p>
          <h1 className="text-4xl sm:text-5xl font-display font-bold text-white mb-6">
            Help Center
          </h1>
          <p className="text-magenta-100 text-lg max-w-2xl mx-auto mb-10 leading-relaxed">
            Answers to common questions about DERMAI. Can&apos;t find what you&apos;re looking for? Reach out to our team.
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
        <Accordion type="single" collapsible className="bg-white rounded-2xl shadow-sm px-6">
          {faqs.map((faq) => (
            <AccordionItem key={faq.question} value={faq.question}>
              <AccordionTrigger className="gap-3">
                <span className="flex items-center gap-3 text-left">
                  <faq.icon className="w-5 h-5 text-magenta-500 shrink-0" />
                  {faq.question}
                </span>
              </AccordionTrigger>
              <AccordionContent className="pl-8 text-gray-600 leading-relaxed">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        <div className="mt-10 bg-white rounded-2xl shadow-sm p-8 text-center">
          <Mail className="w-8 h-8 text-magenta-500 mx-auto mb-3" />
          <h2 className="font-display font-semibold text-lg text-gray-900 mb-2">
            Still need help?
          </h2>
          <p className="text-gray-600 mb-6">
            Our support team is happy to answer any other questions you might have.
          </p>
          <Link
            to="/contact"
            className="inline-block px-6 py-3 bg-magenta-500 text-white rounded-full font-semibold text-sm hover:bg-magenta-600 transition-colors"
          >
            Contact Us
          </Link>
        </div>
      </section>
    </div>
  );
}
