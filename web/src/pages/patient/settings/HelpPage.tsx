import { useState, useEffect, useCallback } from "react";
import {
  ChevronRight,
  ChevronDown,
  X,
  Loader2,
  ShieldCheck,
  Scan,
  CalendarDays,
  CreditCard,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import {
  type HelpdeskTicket,
  createHelpdeskTicketAsync,
  getHelpdeskTicketsAsync,
} from "@/lib/store";
import { TicketStatusBadge } from "@/components/support/TicketStatusBadge";
import { supabase } from "@/lib/supabaseClient";
import { ModalPortal } from "@/components/common/ModalPortal";

const guideSteps = [
  {
    icon: ShieldCheck,
    title: "Create Your Account",
    steps: [
      "Open the DermAI Login Page and select Continue with Google.",
      "Sign in with your Google account.",
      "Complete your personal information.",
      "Select Save Changes to update your profile.",
    ],
  },
  {
    icon: Scan,
    title: "Run a Skin Scan",
    steps: [
      "Select Scan Skin from the sidebar.",
      "Answer the short symptom questionnaire honestly and accurately.",
      "Review your answers before continuing.",
      "Upload clear, well-lit photos of the affected skin area, including a close-up photo and a wide-view photo showing the surrounding skin.",
      "Submit your photos for analysis.",
      "Review your AI-generated result, confidence score, and care tips.",
      "Reminder: DermAI provides informational analysis, not a medical diagnosis. Consult a dermatologist for professional assessment and treatment.",
    ],
  },
  {
    icon: Search,
    title: "Find and Book a Clinic",
    steps: [
      "Go to Appointment Booking → Search Clinic in the sidebar.",
      "Browse verified dermatology clinics near you.",
      "Select a clinic and complete the required personal information.",
      "Choose your preferred doctor, appointment date, and time.",
      "Review and submit your appointment request.",
      "Complete the required payment and wait for the doctor’s confirmation.",
      "Note: Your preferred schedule is subject to the doctor’s approval. Submitting a request and payment does not automatically confirm your appointment.",
    ],
  },
  {
    icon: CalendarDays,
    title: "Track Your Appointments",
    steps: [
      "Go to Monitor → Appointment Status.",
      "View your pending, scheduled, or completed appointments.",
      "Check your notifications to see whether the clinic has accepted or rejected your request.",
      "Once accepted, review your confirmed appointment details.",
    ],
  },
  {
    icon: CreditCard,
    title: "Upgrade to Pro",
    steps: [
      "Free accounts include three skin scans per account. Upgrade to Pro for unlimited scans.",
      "Go to Subscription → Upgrade Plan.",
      "Choose your preferred Pro subscription: Monthly (₱199 per month) or Yearly (₱1,999 per year).",
      "Follow the payment instructions to complete your upgrade.",
      "Go to Settings → Billing to manage your subscription and payment method.",
      "You can cancel your subscription at any time. Your Pro access will remain active until the end of your current paid subscription period.",
    ],
  },
];

const faqs = [
  {
    q: "How does the AI skin scan work?",
    a: "You answer a short questionnaire and upload a photo of the affected skin area. Our AI analyzes the image and gives you a preliminary assessment with a confidence score. It is not a medical diagnosis.",
  },
  {
    q: "Is my health data private?",
    a: "Yes. Your scan results and personal information are stored securely and are not shared with third parties without your consent.",
  },
  {
    q: "How do I book an appointment?",
    a: "Go to Search Clinic under Appointment Booking in the sidebar, choose a verified clinic, and fill out the appointment form. You will receive a confirmation once the clinic reviews your request.",
  },
  {
    q: "What is the difference between the Free and Pro plan?",
    a: "The Free plan gives you 3 skin scans per account. The Pro plan (₱199/month or ₱1,999/year) gives you unlimited scans and full access to all features.",
  },
  {
    q: "How do I cancel my subscription?",
    a: "You can cancel your subscription at any time from the Billing page under Settings. Your Pro access will remain active until the end of the billing period.",
  },
];



const CATEGORIES = [
  "General Inquiry",
  "Billing & Subscription",
  "AI Skin Scan Issue",
  "Clinic Booking",
  "Account Support",
  "Feedback / Suggestion",
];

const fieldClass =
  "w-full px-3.5 py-2.5 rounded-lg border border-gray-300 text-sm text-black placeholder:text-gray-500 bg-white focus:outline-none focus:border-[#801336] focus:ring-2 focus:ring-[#801336]/15";
const labelClass = "block text-sm font-medium text-black mb-1.5";

export default function HelpPage() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  const { user } = useAuth();
  const [showGuide, setShowGuide] = useState(false);
  const [showTicketForm, setShowTicketForm] = useState(false);

  // Form State
  const [category, setCategory] = useState("General Inquiry");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // User tickets list
  const [myTickets, setMyTickets] = useState<HelpdeskTicket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(true);

  const fetchMyTickets = useCallback(async () => {
    try {
      const tickets = await getHelpdeskTicketsAsync(user?.id);
      setMyTickets(tickets);
    } catch (err) {
      console.error("Failed to load patient tickets:", err);
    } finally {
      setLoadingTickets(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchMyTickets();

    // Supabase Realtime
    const channelName = `patient-help-tickets-${user?.id || "anon"}-${Math.random().toString(36).slice(2, 7)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_support_ticket" },
        () => fetchMyTickets()
      )
      .subscribe();

    const handleUpdate = () => fetchMyTickets();
    window.addEventListener("dermai_tickets_updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("dermai_tickets_updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, [fetchMyTickets]);

  const handleSubmitTicket = async () => {
    if (!subject.trim() || !message.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createHelpdeskTicketAsync({
        userId: user?.id,
        user:
          user?.user_metadata?.full_name ||
          user?.user_metadata?.name ||
          user?.email?.split("@")[0] ||
          "Patient",
        email: user?.email || "",
        subject: subject.trim(),
        message: message.trim(),
        category: category || "Patient Support",
        priority: "medium",
      });

      const displayId =
        created.id.length > 12
          ? created.id.slice(0, 8).toUpperCase()
          : created.id;
      setSubmittedId(displayId);
      setSubject("");
      setMessage("");
      fetchMyTickets();
    } catch (err) {
      console.error("Failed to submit ticket:", err);
      setSubmittedId(null);
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Your ticket could not be submitted. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setShowTicketForm(false);
    setSubmittedId(null);
    setSubmitError(null);
  };

  return (
    <div className="max-w-6xl mx-auto py-10 px-4 sm:px-6 lg:px-8 space-y-5">
      {/* Page Header */}
      <div className="pb-2">
        <h1 className="text-3xl font-bold font-display text-black tracking-tight">
          Help &amp; Support
        </h1>
        <p className="text-base text-gray-600 mt-2 max-w-2xl">
          Find quick answers, browse user guides, or submit a support ticket.
        </p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* User Guide */}
        <div
          onClick={() => setShowGuide(true)}
          className="bg-white rounded-xl p-7 border border-gray-200 hover:border-[#801336] hover:shadow-sm transition-all cursor-pointer group"
        >
          <h3 className="text-lg font-semibold text-black">User guide</h3>
          <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">
            Step-by-step instructions on how to use DermAI, from your first scan to booking a clinic.
          </p>
          <p className="mt-5 text-sm font-semibold text-[#801336] group-hover:underline underline-offset-4">
            Open the guide →
          </p>
        </div>

        {/* Contact Support */}
        <div
          onClick={() => {
            setShowTicketForm(true);
            setSubmittedId(null);
            setSubmitError(null);
          }}
          className="bg-white rounded-xl p-7 border border-gray-200 hover:border-[#801336] hover:shadow-sm transition-all cursor-pointer group"
        >
          <h3 className="text-lg font-semibold text-black">Contact support</h3>
          <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">
            Submit an inquiry or report an issue and our support team will get back to you.
          </p>
          <p className="mt-5 text-sm font-semibold text-[#801336] group-hover:underline underline-offset-4">
            Submit a ticket →
          </p>
        </div>
      </div>

      {/* Main Content Grid: FAQ + Direct Assistance */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Frequently Asked Questions */}
        <div className="lg:col-span-8 bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-baseline justify-between px-7 py-5 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-black">
              Frequently asked questions
            </h2>
            <span className="text-sm text-gray-600">
              {faqs.length} questions
            </span>
          </div>

          <div className="divide-y divide-gray-200">
            {faqs.map((faq, i) => {
              const isOpen = openIdx === i;
              return (
                <div key={i}>
                  <button
                    type="button"
                    onClick={() => setOpenIdx(isOpen ? null : i)}
                    className="w-full flex items-center justify-between px-7 py-5 text-left hover:bg-gray-50 transition-colors cursor-pointer"
                  >
                    <span
                      className={cn(
                        "text-base pr-4 leading-snug",
                        isOpen
                          ? "font-semibold text-[#801336]"
                          : "font-medium text-black"
                      )}
                    >
                      {faq.q}
                    </span>
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4 text-gray-600 shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />
                    )}
                  </button>
                  {isOpen && (
                    <div className="px-7 pb-6 text-sm text-gray-700 leading-relaxed max-w-2xl">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Still need direct assistance? */}
        <div className="lg:col-span-4 bg-white rounded-xl border border-gray-200 p-7">
          <h2 className="text-lg font-semibold text-black">
            Still need direct assistance?
          </h2>
          <p className="text-sm text-gray-600 mt-2 leading-relaxed">
            You can reach our official team directly at
          </p>

          <a
            href="mailto:dermaisupport@gmail.com"
            className="mt-4 inline-block text-sm font-semibold text-[#801336] underline underline-offset-4 break-all hover:text-[#680f2b]"
          >
            dermaisupport@gmail.com
          </a>
        </div>
      </div>

      {/* Submitted Support Tickets */}
      {myTickets.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-7 py-5 border-b border-gray-200 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-black">
              My support tickets{" "}
              <span className="text-sm font-normal text-gray-600">
                ({myTickets.length})
              </span>
            </h2>
            <button
              type="button"
              onClick={() => {
                setShowTicketForm(true);
                setSubmittedId(null);
                setSubmitError(null);
              }}
              className="text-sm font-semibold text-[#801336] hover:underline underline-offset-4 cursor-pointer"
            >
              + Submit new ticket
            </button>
          </div>

          <div className="divide-y divide-gray-200">
            {loadingTickets ? (
              <div className="p-10 text-center text-gray-600 text-sm">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-[#801336] mb-2" />
                Loading your tickets...
              </div>
            ) : (
              myTickets.map((t) => {
                return (
                  <div key={t.id} className="px-7 py-6 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1 text-sm text-gray-600">
                          <span className="font-mono font-semibold text-black">
                            #{t.id.length > 12 ? t.id.slice(0, 8).toUpperCase() : t.id}
                          </span>
                          <span>·</span>
                          <span>{t.category}</span>
                        </div>
                        <h3 className="text-base font-semibold text-black">{t.subject}</h3>
                      </div>

                      <TicketStatusBadge status={t.status} portalTheme="patient" />
                    </div>

                    <p className="text-sm text-gray-700 leading-relaxed">
                      {t.message}
                    </p>

                    {/* Admin Response Note if available */}
                    {t.response && (
                      <div className="border-l-2 border-l-[#801336] pl-4 py-0.5 text-sm">
                        <p className="font-semibold text-black mb-0.5">Admin support response</p>
                        <p className="text-gray-700 leading-relaxed">{t.response}</p>
                      </div>
                    )}

                    <p className="text-xs text-gray-600">
                      Submitted on {new Date(t.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* User Guide Modal */}
      <ModalPortal isOpen={Boolean(showGuide)}>
        {showGuide && (
          <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/50">
            <div className="relative z-[9999] bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
              {/* Modal Header */}
              <div className="flex items-center justify-between px-7 py-5 border-b border-gray-200">
                <div>
                  <h2 className="text-xl font-bold font-display text-black">User guide</h2>
                  <p className="text-sm text-gray-600 mt-0.5">Getting started with DermAI features</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  className="p-2 rounded-md hover:bg-gray-100 text-gray-500 hover:text-black transition-colors cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Guide Steps */}
              <div className="overflow-y-auto px-7 py-6 space-y-7">
                {guideSteps.map((section, si) => (
                  <div key={si} className="space-y-2.5">
                    <h3 className="text-base font-semibold text-black">
                      <span className="text-[#801336] tabular-nums mr-2">{si + 1}.</span>
                      {section.title}
                    </h3>
                    <ul className="space-y-1.5 pl-9">
                      {section.steps.map((step, i) => (
                        <li key={i} className="text-sm text-gray-700 leading-relaxed list-disc marker:text-gray-400">
                          {step}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {/* Guide Footer */}
              <div className="px-7 py-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  className="w-full py-2.5 rounded-lg bg-[#801336] hover:bg-[#680f2b] text-white text-sm font-semibold transition-colors cursor-pointer"
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        )}
      </ModalPortal>

      {/* Contact Support Ticket Modal */}
      <ModalPortal isOpen={Boolean(showTicketForm)}>
        {showTicketForm && (
          <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/50">
            <div className="relative z-[9999] bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
              {/* Modal Header */}
              <div className="flex items-center justify-between px-7 py-5 border-b border-gray-200">
                <div>
                  <h2 className="text-xl font-bold font-display text-black">
                    {submittedId ? "Ticket submitted" : "Submit a support ticket"}
                  </h2>
                  <p className="text-sm text-gray-600 mt-0.5">
                    {submittedId
                      ? "Your inquiry has been received"
                      : "Fill out the form below and our team will get back to you"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetForm}
                  className="p-2 rounded-md hover:bg-gray-100 text-gray-500 hover:text-black transition-colors cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="overflow-y-auto px-7 py-6">
                {submittedId ? (
                  <div className="py-2 space-y-3">
                    <h3 className="text-lg font-semibold text-black">Support ticket submitted</h3>
                    <p className="text-sm text-gray-700 max-w-sm leading-relaxed">
                      Your ticket <span className="font-mono font-semibold text-[#801336]">#{submittedId}</span> has been received. Our admin support team will review your inquiry shortly.
                    </p>
                    <button
                      type="button"
                      onClick={resetForm}
                      className="mt-3 px-6 py-2.5 rounded-lg bg-[#801336] hover:bg-[#680f2b] text-white text-sm font-semibold transition-colors cursor-pointer"
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div>
                      <label className={labelClass}>
                        Category
                      </label>
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className={cn(fieldClass, "cursor-pointer")}
                      >
                        {CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className={labelClass}>
                        Subject
                      </label>
                      <input
                        type="text"
                        value={subject}
                        onChange={(e) => {
                          setSubject(e.target.value);
                          setSubmitError(null);
                        }}
                        placeholder="e.g., Question about appointment or subscription"
                        className={fieldClass}
                      />
                    </div>

                    <div>
                      <label className={labelClass}>
                        Describe your concern
                      </label>
                      <textarea
                        rows={4}
                        value={message}
                        onChange={(e) => {
                          setMessage(e.target.value);
                          setSubmitError(null);
                        }}
                        placeholder="Please provide details so we can assist you quickly..."
                        className={cn(fieldClass, "resize-none")}
                      />
                    </div>

                    {submitError && (
                      <p className="text-sm font-medium text-black border-l-2 border-l-[#801336] pl-3 py-0.5">
                        {submitError}
                      </p>
                    )}

                    <div className="pt-1 flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={resetForm}
                        className="px-5 py-2.5 rounded-lg border border-gray-300 text-sm font-semibold text-black hover:bg-gray-50 transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSubmitTicket}
                        disabled={submitting || !subject.trim() || !message.trim()}
                        className={cn(
                          "px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2",
                          subject.trim() && message.trim() && !submitting
                            ? "bg-[#801336] hover:bg-[#680f2b] text-white cursor-pointer"
                            : "bg-gray-100 text-gray-500 cursor-not-allowed"
                        )}
                      >
                        {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <span>{submitting ? "Sending..." : "Send ticket"}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </ModalPortal>
    </div>
  );
}
