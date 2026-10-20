import {
  ChevronRight,
  X,
  Scan,
  CalendarDays,
  CreditCard,
  ShieldCheck,
  Search,
  Loader2,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import {
  type HelpdeskTicket,
  type HelpdeskTicketStatus,
  createHelpdeskTicketAsync,
  getHelpdeskTicketsAsync,
} from "@/lib/store";
import { supabase } from "@/lib/supabaseClient";

const guideSteps = [
  {
    icon: ShieldCheck,
    title: "Create Your Account",
    steps: [
      "Go to the DermAI Register page and click Register.",
      "Fill in your full name, email address, and a secure password.",
      "Confirm your email and log in to access your dashboard.",
    ],
  },
  {
    icon: Scan,
    title: "Run a Skin Scan",
    steps: [
      "Tap Scan Skin from the sidebar or home screen.",
      "Answer the short symptom questionnaire honestly.",
      "Upload a clear, well-lit photo of the affected skin area.",
      "Review your AI-generated result, confidence score, and care tips.",
    ],
  },
  {
    icon: Search,
    title: "Find & Book a Clinic",
    steps: [
      "Go to Appointment Booking → Search Clinic in the sidebar.",
      "Browse verified dermatology clinics near you.",
      "Select a clinic and fill in your preferred date, time, and consultation type (online or face-to-face).",
      "Submit the request and wait for the clinic's confirmation.",
    ],
  },
  {
    icon: CalendarDays,
    title: "Track Your Appointments",
    steps: [
      "Go to Appointment Booking → Appointment Status.",
      "You will see all your pending, scheduled, or completed appointments.",
      "You will be notified once a clinic accepts or rejects your request.",
    ],
  },
  {
    icon: CreditCard,
    title: "Upgrade to Pro",
    steps: [
      "Free accounts are limited to 3 skin scans per account.",
      "Upgrade to Pro (₱199/month or ₱1,999/year) for unlimited scans.",
      "Go to Settings → Billing to manage your subscription and payment method.",
      "You can cancel at any time; Pro access stays active until the period ends.",
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

const statusBadge: Record<HelpdeskTicketStatus, { pill: string; label: string }> = {
  pending: { pill: "bg-amber-50 border-amber-200 text-amber-800", label: "Pending" },
  open: { pill: "bg-magenta-50 border-magenta-200 text-magenta-900", label: "Open" },
  "in-progress": { pill: "bg-blue-50 border-blue-200 text-blue-800", label: "In Progress" },
  in_progress: { pill: "bg-blue-50 border-blue-200 text-blue-800", label: "In Progress" },
  resolved: { pill: "bg-emerald-50 border-emerald-200 text-emerald-800", label: "Resolved" },
  closed: { pill: "bg-emerald-50 border-emerald-200 text-emerald-800", label: "Resolved" },
};

const CATEGORIES = [
  "General Inquiry",
  "Billing & Subscription",
  "AI Skin Scan Issue",
  "Clinic Booking",
  "Account Support",
  "Feedback / Suggestion",
];

const fieldClass =
  "w-full px-3.5 py-2.5 rounded-md border border-gray-300 text-sm text-black placeholder:text-gray-500 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/15 bg-white";
const labelClass = "block text-sm font-medium text-black mb-1.5";

export default function HelpPage() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
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
    const channel = supabase
      .channel("patient-help-tickets")
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
    <div className="max-w-3xl mx-auto py-10 px-4 sm:px-6 space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-display font-bold text-black">Help &amp; Support</h1>
        <p className="text-sm text-gray-600 mt-1">
          Find quick answers, browse user guides, or submit a support ticket.
        </p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          onClick={() => setShowGuide(true)}
          className="text-left bg-white border border-gray-200 rounded-lg p-6 hover:border-magenta-400 transition-colors cursor-pointer"
        >
          <p className="text-base font-semibold text-black">User guide</p>
          <p className="text-sm text-gray-600 mt-1">Step-by-step instructions on how to use DermAI.</p>
        </button>

        <button
          onClick={() => {
            setShowTicketForm(true);
            setSubmittedId(null);
            setSubmitError(null);
          }}
          className="text-left bg-white border border-gray-200 rounded-lg p-6 hover:border-magenta-400 transition-colors cursor-pointer"
        >
          <p className="text-base font-semibold text-black">Contact support</p>
          <p className="text-sm text-gray-600 mt-1">Submit an inquiry or report an issue.</p>
        </button>
      </div>

      {/* Ticket Submission Form */}
      {showTicketForm && (
        <div className="bg-white rounded-lg border border-gray-200 p-7">
          {submittedId ? (
            <div className="py-4 space-y-3">
              <h3 className="text-lg font-semibold text-black">Support ticket submitted</h3>
              <p className="text-sm text-gray-700 max-w-md leading-relaxed">
                Your ticket <span className="font-mono font-semibold text-black">{submittedId}</span> has been received. Our admin support team will review your inquiry shortly.
              </p>
              <button
                onClick={resetForm}
                className="mt-2 px-5 py-2.5 rounded-md bg-magenta-600 text-white text-sm font-medium hover:bg-magenta-700 transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between border-b border-gray-200 pb-4">
                <h2 className="text-lg font-semibold text-black">Submit a support ticket</h2>
                <button
                  onClick={resetForm}
                  className="text-sm font-medium text-gray-700 hover:underline underline-offset-2 cursor-pointer"
                >
                  Cancel
                </button>
              </div>

              <div className="space-y-5">
                <div>
                  <label className={labelClass}>Category</label>
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
                  <label className={labelClass}>Subject</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => {
                      setSubject(e.target.value);
                      setSubmitError(null);
                    }}
                    placeholder="e.g. Pro subscription not reflecting or scan issue"
                    className={fieldClass}
                  />
                </div>

                <div>
                  <label className={labelClass}>Describe your concern</label>
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
                  <p role="alert" className="text-sm font-medium text-black border-l-2 border-magenta-600 pl-3">
                    {submitError}
                  </p>
                )}

                <div>
                  <button
                    onClick={handleSubmitTicket}
                    disabled={submitting || !subject.trim() || !message.trim()}
                    className={cn(
                      "px-5 py-2.5 rounded-md text-sm font-medium transition-colors",
                      subject.trim() && message.trim() && !submitting
                        ? "bg-magenta-600 text-white hover:bg-magenta-700 cursor-pointer"
                        : "bg-gray-100 text-gray-500 cursor-not-allowed"
                    )}
                  >
                    {submitting ? "Submitting..." : "Send ticket"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* My Submitted Tickets Section */}
      {myTickets.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-base font-semibold text-black">
              My support tickets <span className="font-normal text-gray-600">({myTickets.length})</span>
            </h2>
          </div>

          <div className="divide-y divide-gray-200">
            {loadingTickets ? (
              <div className="p-8 text-center text-gray-600 text-sm">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-magenta-600 mb-2" />
                Loading your tickets...
              </div>
            ) : (
              myTickets.map((t) => {
                const status = statusBadge[t.status] || statusBadge.open;
                return (
                  <div key={t.id} className="px-6 py-5 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1 text-xs text-gray-600">
                          <span className="font-mono font-semibold text-black">
                            {t.id.length > 12 ? t.id.slice(0, 8).toUpperCase() : t.id}
                          </span>
                          <span>·</span>
                          <span>{t.category}</span>
                        </div>
                        <h3 className="text-sm font-semibold text-black">{t.subject}</h3>
                      </div>

                      <span
                        className={cn(
                          "inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border shrink-0",
                          status.pill
                        )}
                      >
                        {status.label}
                      </span>
                    </div>

                    <p className="text-sm text-gray-700 leading-relaxed bg-gray-50 rounded-md p-3.5 border border-gray-200">
                      {t.message}
                    </p>

                    {/* Admin Response Note if available */}
                    {t.response && (
                      <div className="border-l-[3px] border-l-magenta-600 bg-gray-50 px-4 py-3 text-sm">
                        <p className="font-semibold text-black mb-1">Admin support response</p>
                        <p className="text-gray-700 leading-relaxed">
                          {t.response}
                        </p>
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

      {/* Frequently Asked Questions */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-black">
            Frequently asked questions
          </h2>
        </div>
        <div className="divide-y divide-gray-200">
          {faqs.map((faq, i) => (
            <div key={i}>
              <button
                onClick={() => setOpenIdx(openIdx === i ? null : i)}
                className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <span className="text-sm font-medium text-black pr-4">{faq.q}</span>
                <ChevronRight
                  className={cn(
                    "w-4 h-4 text-magenta-600 shrink-0 transition-transform",
                    openIdx === i && "rotate-90"
                  )}
                />
              </button>
              {openIdx === i && (
                <div className="px-6 pb-5 text-sm text-gray-700 leading-relaxed">
                  {faq.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Contact Direct */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-base font-semibold text-black">Still need direct assistance?</p>
        <p className="text-sm text-gray-700 mt-1">
          You can reach our official team directly at{" "}
          <a href="mailto:dermaisupport@gmail.com" className="font-medium text-magenta-700 underline underline-offset-2">
            dermaisupport@gmail.com
          </a>
        </p>
      </div>

      {/* User Guide Modal */}
      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-7 py-5 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-semibold text-black">User guide</h2>
                <p className="text-sm text-gray-600">Getting started with DermAI features</p>
              </div>
              <button
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
                <div key={si} className="space-y-3">
                  <h3 className="text-sm font-semibold text-black">
                    Step {si + 1}: {section.title}
                  </h3>
                  <ol className="space-y-2">
                    {section.steps.map((step, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className="shrink-0 w-5 text-sm font-semibold text-magenta-700 tabular-nums">
                          {i + 1}.
                        </span>
                        <p className="text-sm text-gray-700 leading-relaxed">{step}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>

            {/* Guide Footer */}
            <div className="px-7 py-4 border-t border-gray-200 bg-gray-50">
              <button
                onClick={() => setShowGuide(false)}
                className="w-full py-2.5 rounded-md bg-magenta-600 text-white text-sm font-medium hover:bg-magenta-700 transition-colors cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
