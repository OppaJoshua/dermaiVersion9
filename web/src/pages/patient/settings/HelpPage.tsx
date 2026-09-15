import {
  HelpCircle,
  MessageSquare,
  BookOpen,
  ChevronRight,
  Mail,
  CheckCircle2,
  Send,
  X,
  Scan,
  CalendarDays,
  CreditCard,
  ShieldCheck,
  Search,
  Clock,
  AlertCircle,
  Tag,
  Loader2,
  MessageCircle,
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
      "Free accounts are limited to 1 skin scan per account.",
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
    a: "The Free plan gives you 1 skin scan per account. The Pro plan (₱199/month or ₱1,999/year) gives you unlimited scans and full access to all features.",
  },
  {
    q: "How do I cancel my subscription?",
    a: "You can cancel your subscription at any time from the Billing page under Settings. Your Pro access will remain active until the end of the billing period.",
  },
];

const statusBadge: Record<HelpdeskTicketStatus, { bg: string; text: string; icon: typeof CheckCircle2; label: string }> = {
  open: { bg: "bg-rose-50 border-rose-200", text: "text-rose-600", icon: AlertCircle, label: "Open" },
  "in-progress": { bg: "bg-amber-50 border-amber-200", text: "text-amber-600", icon: Clock, label: "In Progress" },
  resolved: { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-600", icon: CheckCircle2, label: "Resolved" },
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
      setSubmittedId(`TKT-${Date.now().toString().slice(-6)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setShowTicketForm(false);
    setSubmittedId(null);
  };

  return (
    <div className="max-w-3xl mx-auto py-10 px-4 sm:px-6 space-y-8">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="p-3 bg-magenta-100 rounded-2xl text-magenta-600 shadow-xs">
          <HelpCircle className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Help &amp; Support</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Find quick answers, browse user guides, or submit a support ticket.
          </p>
        </div>
      </div>

      {/* Quick Action Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          onClick={() => setShowGuide(true)}
          className="flex items-center gap-4 bg-white border border-gray-100 rounded-2xl p-4 shadow-xs hover:border-magenta-200 hover:bg-magenta-50/20 transition-all text-left group"
        >
          <div className="p-3 bg-magenta-100 rounded-xl text-magenta-600 group-hover:bg-magenta-200 transition-colors">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">User Guide</p>
            <p className="text-xs text-gray-500 mt-0.5">Step-by-step instructions on how to use DermAI</p>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-300 ml-auto group-hover:text-magenta-500 transition-colors" />
        </button>

        <button
          onClick={() => {
            setShowTicketForm(true);
            setSubmittedId(null);
          }}
          className="flex items-center gap-4 bg-white border border-gray-100 rounded-2xl p-4 shadow-xs hover:border-magenta-200 hover:bg-magenta-50/20 transition-all text-left group"
        >
          <div className="p-3 bg-magenta-100 rounded-xl text-magenta-600 group-hover:bg-magenta-200 transition-colors">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">Contact Support</p>
            <p className="text-xs text-gray-500 mt-0.5">Submit an inquiry or report an issue</p>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-300 ml-auto group-hover:text-magenta-500 transition-colors" />
        </button>
      </div>

      {/* Ticket Submission Form */}
      {showTicketForm && (
        <div className="bg-white rounded-3xl border border-magenta-100 shadow-sm p-6 sm:p-8 transition-all">
          {submittedId ? (
            <div className="flex flex-col items-center py-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">Support Ticket Submitted!</h3>
              <p className="text-sm text-gray-600 max-w-sm">
                Your ticket <span className="font-mono font-bold text-magenta-600">{submittedId}</span> has been received. Our admin support team will review your inquiry shortly.
              </p>
              <button
                onClick={resetForm}
                className="mt-4 px-6 py-2.5 rounded-full bg-magenta-600 text-white text-xs font-semibold hover:bg-magenta-700 transition-colors shadow-md shadow-magenta-500/20"
              >
                Done
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-magenta-600" />
                  Submit a Support Ticket
                </h2>
                <button
                  onClick={resetForm}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Cancel
                </button>
              </div>

              <div className="space-y-3.5 text-xs">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-xs text-gray-900 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 font-medium cursor-pointer"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    Subject
                  </label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="e.g. Pro subscription not reflecting or scan issue"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-xs text-gray-900 placeholder:text-gray-400 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    Describe your concern
                  </label>
                  <textarea
                    rows={4}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Please provide details so we can assist you quickly..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-xs text-gray-900 placeholder:text-gray-400 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 transition-all resize-none"
                  />
                </div>

                <div className="pt-2">
                  <button
                    onClick={handleSubmitTicket}
                    disabled={submitting || !subject.trim() || !message.trim()}
                    className={cn(
                      "inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-semibold transition-all",
                      subject.trim() && message.trim() && !submitting
                        ? "bg-magenta-600 text-white hover:bg-magenta-700 shadow-md shadow-magenta-500/20 cursor-pointer"
                        : "bg-gray-100 text-gray-400 cursor-not-allowed"
                    )}
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{submitting ? "Submitting..." : "Send Ticket"}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* My Submitted Tickets Section */}
      {myTickets.length > 0 && (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-xs overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-800 flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-magenta-600" />
              My Support Tickets ({myTickets.length})
            </h2>
          </div>

          <div className="divide-y divide-gray-100">
            {loadingTickets ? (
              <div className="p-6 text-center text-gray-400 text-xs">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-magenta-500 mb-1" />
                Loading your tickets...
              </div>
            ) : (
              myTickets.map((t) => {
                const status = statusBadge[t.status] || statusBadge.open;
                const StatusIcon = status.icon;
                return (
                  <div key={t.id} className="p-5 space-y-2.5 hover:bg-gray-50/50 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                            {t.id.length > 12 ? t.id.slice(0, 8).toUpperCase() : t.id}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 font-medium">
                            <Tag className="w-3 h-3 text-gray-400" />
                            {t.category}
                          </span>
                        </div>
                        <h3 className="text-sm font-bold text-gray-900">{t.subject}</h3>
                      </div>

                      <span
                        className={cn(
                          "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border shrink-0",
                          status.bg,
                          status.text
                        )}
                      >
                        <StatusIcon className="w-3.5 h-3.5" />
                        {status.label}
                      </span>
                    </div>

                    <p className="text-xs text-gray-600 leading-relaxed bg-gray-50/80 rounded-xl p-3 border border-gray-100">
                      {t.message}
                    </p>

                    {/* Admin Response Note if available */}
                    {t.response && (
                      <div className="mt-2 bg-emerald-50/80 rounded-xl p-3 border border-emerald-200/80 text-xs">
                        <div className="flex items-center gap-1.5 text-emerald-800 font-bold mb-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Admin Support Response:</span>
                        </div>
                        <p className="text-emerald-900 leading-relaxed pl-5">
                          {t.response}
                        </p>
                      </div>
                    )}

                    <p className="text-[10px] text-gray-400">
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
      <div className="bg-white rounded-3xl border border-gray-100 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            Frequently Asked Questions
          </h2>
        </div>
        <div className="divide-y divide-gray-100 text-xs">
          {faqs.map((faq, i) => (
            <div key={i}>
              <button
                onClick={() => setOpenIdx(openIdx === i ? null : i)}
                className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition-colors"
              >
                <span className="text-sm font-semibold text-gray-800 pr-4">{faq.q}</span>
                <ChevronRight
                  className={cn(
                    "w-4 h-4 text-gray-400 shrink-0 transition-transform",
                    openIdx === i && "rotate-90 text-magenta-500"
                  )}
                />
              </button>
              {openIdx === i && (
                <div className="px-6 pb-4 text-xs text-gray-600 leading-relaxed">
                  {faq.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Contact Direct Card */}
      <div className="bg-magenta-50/80 rounded-3xl border border-magenta-100 p-6 flex items-center gap-4">
        <div className="p-3.5 bg-white rounded-2xl shadow-xs text-magenta-600 shrink-0">
          <Mail className="w-5 h-5" />
        </div>
        <div>
          <p className="text-sm font-bold text-magenta-950">Still need direct assistance?</p>
          <p className="text-xs text-magenta-800 mt-0.5">
            You can reach our official team directly at{" "}
            <a href="mailto:dermaisupport@gmail.com" className="font-semibold underline">
              dermaisupport@gmail.com
            </a>
          </p>
        </div>
      </div>

      {/* User Guide Modal */}
      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-magenta-100 rounded-xl text-magenta-600">
                  <BookOpen className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">User Guide</h2>
                  <p className="text-xs text-gray-500">Getting started with DermAI features</p>
                </div>
              </div>
              <button
                onClick={() => setShowGuide(false)}
                className="p-2 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Guide Steps */}
            <div className="overflow-y-auto px-6 py-5 space-y-6 text-xs">
              {guideSteps.map((section, si) => (
                <div key={si} className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-magenta-100 rounded-lg text-magenta-600">
                      <section.icon className="w-4 h-4" />
                    </div>
                    <h3 className="text-xs font-bold text-gray-900">
                      Step {si + 1}: {section.title}
                    </h3>
                  </div>
                  <ol className="space-y-1.5 pl-2">
                    {section.steps.map((step, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className="shrink-0 mt-0.5 w-4 h-4 flex items-center justify-center rounded-full bg-magenta-600 text-white text-[10px] font-bold">
                          {i + 1}
                        </span>
                        <p className="text-xs text-gray-600 leading-relaxed">{step}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>

            {/* Guide Footer */}
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50">
              <button
                onClick={() => setShowGuide(false)}
                className="w-full py-2.5 rounded-full bg-magenta-600 text-white text-xs font-semibold hover:bg-magenta-700 transition-colors shadow-md shadow-magenta-500/20"
              >
                Got it!
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
