import { useState, useEffect, useCallback } from "react";
import {
  ChevronRight,
  ChevronDown,
  X,
  Mail,
  BookText,
  MessageSquare,
  ArrowRight,
  Loader2,
  CheckCircle2,
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
  type HelpdeskTicketStatus,
  createHelpdeskTicketAsync,
  getHelpdeskTicketsAsync,
} from "@/lib/store";
import { supabase } from "@/lib/supabaseClient";
import { ModalPortal } from "@/components/common/ModalPortal";

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
      "Select a clinic and fill in your preferred date, time, and consultation type.",
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
  open: { pill: "bg-[#fae8ee] border-[#f2c6d4] text-[#801336]", label: "Open" },
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
    <div className="max-w-6xl mx-auto py-10 px-4 sm:px-6 lg:px-8 space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold font-display text-gray-900 tracking-tight">
          Help &amp; Support
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Find quick answers, browse user guides, or submit a support ticket.
        </p>
      </div>

      {/* Quick Action Cards (Top Row) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* User Guide Card */}
        <div
          onClick={() => setShowGuide(true)}
          className="bg-white rounded-2xl p-6 sm:p-7 border border-gray-100 shadow-2xs hover:shadow-xs hover:border-gray-200/80 transition-all flex items-center justify-between cursor-pointer group"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#fae8ee] flex items-center justify-center shrink-0">
              <BookText className="w-5 h-5 text-[#801336] stroke-[1.8]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900 group-hover:text-[#801336] transition-colors">
                User guide
              </h3>
              <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
                Step-by-step instructions on how to use DermAI.
              </p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-[#801336] group-hover:translate-x-0.5 transition-transform shrink-0 ml-3" />
        </div>

        {/* Contact Support Card */}
        <div
          onClick={() => {
            setShowTicketForm(true);
            setSubmittedId(null);
            setSubmitError(null);
          }}
          className="bg-white rounded-2xl p-6 sm:p-7 border border-gray-100 shadow-2xs hover:shadow-xs hover:border-gray-200/80 transition-all flex items-center justify-between cursor-pointer group"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#fae8ee] flex items-center justify-center shrink-0">
              <MessageSquare className="w-5 h-5 text-[#801336] stroke-[1.8]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900 group-hover:text-[#801336] transition-colors">
                Contact support
              </h3>
              <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
                Submit an inquiry or report an issue.
              </p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-[#801336] group-hover:translate-x-0.5 transition-transform shrink-0 ml-3" />
        </div>
      </div>

      {/* Main Content Grid: Frequently Asked Questions + Direct Assistance */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Frequently Asked Questions (2/3 width) */}
        <div className="lg:col-span-8 bg-white rounded-2xl border border-gray-100 shadow-2xs overflow-hidden">
          <div className="flex items-center justify-between px-6 py-5">
            <h2 className="text-base font-bold text-gray-900">
              Frequently asked questions
            </h2>
            <span className="text-xs font-medium text-gray-400">
              {faqs.length} questions
            </span>
          </div>

          <div className="divide-y divide-gray-100/90 border-t border-gray-100/90">
            {faqs.map((faq, i) => {
              const isOpen = openIdx === i;
              return (
                <div key={i}>
                  <button
                    type="button"
                    onClick={() => setOpenIdx(isOpen ? null : i)}
                    className="w-full flex items-center justify-between px-6 py-4.5 text-left hover:bg-gray-50/50 transition-colors cursor-pointer group"
                  >
                    <span
                      className={cn(
                        "text-sm pr-4 transition-colors leading-snug",
                        isOpen
                          ? "font-bold text-[#801336]"
                          : "font-semibold text-gray-800 group-hover:text-[#801336]"
                      )}
                    >
                      {faq.q}
                    </span>
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4 text-[#801336] shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600 shrink-0" />
                    )}
                  </button>
                  {isOpen && (
                    <div className="px-6 pb-5 pt-0 text-xs sm:text-sm text-gray-500 leading-relaxed animate-in fade-in-50 duration-150">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Still need direct assistance? (1/3 width) */}
        <div className="lg:col-span-4 bg-white rounded-2xl border border-gray-100 shadow-2xs p-6">
          <h2 className="text-base font-bold text-gray-900">
            Still need direct assistance?
          </h2>
          <p className="text-xs sm:text-sm text-gray-500 mt-2 mb-5 leading-relaxed">
            You can reach our official team directly at
          </p>

          <a
            href="mailto:dermaisupport@gmail.com"
            className="w-full rounded-xl bg-[#fae8ee] hover:bg-[#f6dbe3] transition-colors py-3 px-4 flex items-center justify-center gap-2 group cursor-pointer text-decoration-none"
          >
            <Mail className="w-4 h-4 text-[#801336] shrink-0" />
            <span className="text-xs sm:text-sm font-bold text-[#801336] tracking-tight group-hover:underline">
              dermaisupport@gmail.com
            </span>
          </a>
        </div>
      </div>

      {/* Submitted Support Tickets (rendered if the patient has submitted tickets) */}
      {myTickets.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-2xs overflow-hidden">
          <div className="px-6 py-4.5 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900">
              My support tickets{" "}
              <span className="text-xs font-normal text-gray-400">
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
              className="text-xs font-bold text-[#801336] hover:underline cursor-pointer"
            >
              + Submit new ticket
            </button>
          </div>

          <div className="divide-y divide-gray-100">
            {loadingTickets ? (
              <div className="p-8 text-center text-gray-500 text-xs">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-[#801336] mb-2" />
                Loading your tickets...
              </div>
            ) : (
              myTickets.map((t) => {
                const status = statusBadge[t.status] || statusBadge.open;
                return (
                  <div key={t.id} className="px-6 py-5 space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1 text-xs text-gray-500">
                          <span className="font-mono font-bold text-gray-900">
                            #{t.id.length > 12 ? t.id.slice(0, 8).toUpperCase() : t.id}
                          </span>
                          <span>•</span>
                          <span className="text-gray-600">{t.category}</span>
                        </div>
                        <h3 className="text-sm font-bold text-gray-900">{t.subject}</h3>
                      </div>

                      <span
                        className={cn(
                          "inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border shrink-0",
                          status.pill
                        )}
                      >
                        {status.label}
                      </span>
                    </div>

                    <p className="text-xs sm:text-sm text-gray-600 leading-relaxed bg-gray-50/70 rounded-xl p-3 border border-gray-100">
                      {t.message}
                    </p>

                    {/* Admin Response Note if available */}
                    {t.response && (
                      <div className="border-l-[3px] border-l-[#801336] bg-[#fae8ee]/50 px-4 py-2.5 rounded-r-xl text-xs sm:text-sm">
                        <p className="font-bold text-[#801336] mb-0.5">Admin support response</p>
                        <p className="text-gray-700 leading-relaxed">{t.response}</p>
                      </div>
                    )}

                    <p className="text-[11px] text-gray-400">
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
          <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
            <div className="relative z-[9999] bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
                <div>
                  <h2 className="text-lg font-bold font-display text-gray-900">User guide</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Getting started with DermAI features</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Guide Steps */}
              <div className="overflow-y-auto px-6 py-6 space-y-6">
                {guideSteps.map((section, si) => (
                  <div key={si} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-[#fae8ee] text-[#801336] text-xs font-bold flex items-center justify-center shrink-0">
                        {si + 1}
                      </span>
                      <h3 className="text-sm font-bold text-gray-900">{section.title}</h3>
                    </div>
                    <ul className="space-y-1.5 pl-8">
                      {section.steps.map((step, i) => (
                        <li key={i} className="text-xs text-gray-600 leading-relaxed list-disc">
                          {step}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {/* Guide Footer */}
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/60">
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  className="w-full py-2.5 rounded-xl bg-[#801336] hover:bg-[#680f2b] text-white text-sm font-semibold transition-colors cursor-pointer shadow-xs active:scale-[0.99]"
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
          <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
            <div className="relative z-[9999] bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
                <div>
                  <h2 className="text-lg font-bold font-display text-gray-900">
                    {submittedId ? "Ticket Submitted" : "Submit a support ticket"}
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {submittedId
                      ? "Your inquiry has been received"
                      : "Fill out the form below and our team will get back to you"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetForm}
                  className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="overflow-y-auto px-6 py-6">
                {submittedId ? (
                  <div className="py-4 text-center space-y-3">
                    <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                    <h3 className="text-base font-bold text-gray-900">Support ticket submitted</h3>
                    <p className="text-xs sm:text-sm text-gray-600 max-w-sm mx-auto leading-relaxed">
                      Your ticket <span className="font-mono font-bold text-[#801336]">#{submittedId}</span> has been received. Our admin support team will review your inquiry shortly.
                    </p>
                    <button
                      type="button"
                      onClick={resetForm}
                      className="mt-4 px-6 py-2.5 rounded-xl bg-[#801336] hover:bg-[#680f2b] text-white text-sm font-semibold transition-colors cursor-pointer shadow-xs active:scale-[0.99]"
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                        Category
                      </label>
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#801336]/20 focus:border-[#801336] cursor-pointer"
                      >
                        {CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1.5">
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
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#801336]/20 focus:border-[#801336]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1.5">
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
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-[#801336]/20 focus:border-[#801336]"
                      />
                    </div>

                    {submitError && (
                      <p className="text-xs font-medium text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-2.5">
                        {submitError}
                      </p>
                    )}

                    <div className="pt-2 flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={resetForm}
                        className="px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSubmitTicket}
                        disabled={submitting || !subject.trim() || !message.trim()}
                        className={cn(
                          "px-5 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 shadow-2xs",
                          subject.trim() && message.trim() && !submitting
                            ? "bg-[#801336] hover:bg-[#680f2b] text-white cursor-pointer active:scale-[0.98]"
                            : "bg-gray-100 text-gray-400 cursor-not-allowed"
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
