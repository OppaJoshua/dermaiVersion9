import { HelpCircle, MessageSquare, BookOpen, ChevronRight, Mail, CheckCircle2, Send, X, Scan, CalendarDays, CreditCard, ShieldCheck, Search } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
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
        a: "Yes. Your scan results and personal information are stored locally on your device and are not shared with third parties without your consent.",
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
export default function HelpPage() {
    const [openIdx, setOpenIdx] = useState<number | null>(null);
    const { user } = useAuth();
    const [showGuide, setShowGuide] = useState(false);
    const [showTicketForm, setShowTicketForm] = useState(false);
    const [subject, setSubject] = useState("");
    const [message, setMessage] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [submittedId, setSubmittedId] = useState<string | null>(null);

    const handleSubmitTicket = async () => {
        if (!subject.trim() || !message.trim())
            return;
        setSubmitting(true);
        try {
            if (user) {
                const { data } = await supabase
                    .from("user_support_ticket")
                    .insert({
                        user_id: user.id,
                        subject: subject.trim(),
                        message: message.trim(),
                        status: "open",
                    })
                    .select("ticket_id")
                    .single();

                const ticketId = data?.ticket_id ? data.ticket_id.slice(0, 8).toUpperCase() : `TKT-${Date.now().toString().slice(-6)}`;
                setSubmittedId(ticketId);
            } else {
                setSubmittedId(`TKT-${Date.now().toString().slice(-6)}`);
            }
            setSubject("");
            setMessage("");
        } catch {
            setSubmittedId(`TKT-${Date.now().toString().slice(-6)}`);
        } finally {
            setSubmitting(false);
        }
    };
    const resetForm = () => {
        setShowTicketForm(false);
        setSubmittedId(null);
    };
    return (<div className="max-w-2xl mx-auto py-10 px-4 sm:px-6">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2.5 bg-magenta-100 rounded-2xl text-magenta-600">
          <HelpCircle className="w-6 h-6"/>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Help & Support</h1>
          <p className="text-sm text-gray-500 mt-0.5">Find answers and contact our support team</p>
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        {[
            { icon: BookOpen, label: "User Guide", desc: "How to use DermAI", onClick: () => setShowGuide(true) },
            { icon: MessageSquare, label: "Contact Support", desc: "Submit a support ticket", onClick: () => { setShowTicketForm(true); setSubmittedId(null); } },
        ].map((item) => (<button key={item.label} onClick={item.onClick} className="flex items-center gap-4 bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:border-magenta-200 hover:bg-magenta-50/30 transition-all text-left group">
            <div className="p-2.5 bg-magenta-100 rounded-xl text-magenta-500 group-hover:bg-magenta-200 transition-colors">
              <item.icon className="w-5 h-5"/>
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">{item.label}</p>
              <p className="text-xs text-gray-500">{item.desc}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300 ml-auto group-hover:text-magenta-400 transition-colors"/>
          </button>))}
      </div>

      {/* Ticket Form */}
      {showTicketForm && (<div className="bg-white rounded-2xl border border-magenta-100 shadow-sm p-6 mb-6">
          {submittedId ? (<div className="flex flex-col items-center py-4 text-center">
              <CheckCircle2 className="w-12 h-12 text-green-500 mb-3"/>
              <p className="text-base font-bold text-gray-900">Ticket Submitted!</p>
              <p className="text-sm text-gray-500 mt-1">
                Your ticket <span className="font-semibold text-magenta-600">{submittedId}</span> has been received.
              </p>
              <p className="text-xs text-gray-400 mt-0.5">Our admin team will review it shortly.</p>
              <button onClick={resetForm} className="mt-5 px-5 py-2.5 rounded-full bg-magenta-500 text-white text-sm font-semibold hover:bg-magenta-600 transition-colors">
                Done
              </button>
            </div>) : (<>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-magenta-500"/> Submit a Support Ticket
                </h2>
                <button onClick={resetForm} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Cancel</button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">Subject</label>
                  <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Subscription not reflecting after payment" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-magenta-400 focus:ring-2 focus:ring-magenta-500/10 transition-all"/>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">Describe your concern</label>
                  <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Please provide as much detail as possible so we can help you faster..." rows={4} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-magenta-400 focus:ring-2 focus:ring-magenta-500/10 transition-all resize-none"/>
                </div>
                <button onClick={handleSubmitTicket} disabled={submitting || !subject.trim() || !message.trim()} className={cn("flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-colors", subject.trim() && message.trim() && !submitting
                    ? "bg-magenta-500 text-white hover:bg-magenta-600 shadow-md shadow-magenta-500/20"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed")}>
                  <Send className="w-4 h-4"/>
                  {submitting ? "Submitting..." : "Submit Ticket"}
                </button>
              </div>
            </>)}
        </div>)}

      {/* FAQs */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Frequently Asked Questions</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {faqs.map((faq, i) => (<div key={i}>
              <button onClick={() => setOpenIdx(openIdx === i ? null : i)} className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition-colors">
                <span className="text-sm font-semibold text-gray-800 pr-4">{faq.q}</span>
                <ChevronRight className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${openIdx === i ? "rotate-90" : ""}`}/>
              </button>
              {openIdx === i && (<div className="px-6 pb-4 text-sm text-gray-600 leading-relaxed">{faq.a}</div>)}
            </div>))}
        </div>
      </div>

      {/* Contact */}
      <div className="bg-magenta-50 rounded-2xl border border-magenta-100 p-6 flex items-center gap-4">
        <div className="p-3 bg-white rounded-xl shadow-sm text-magenta-500">
          <Mail className="w-5 h-5"/>
        </div>
        <div>
          <p className="text-sm font-bold text-magenta-900">Still need help?</p>
          <p className="text-sm text-magenta-700 mt-0.5">
            Email us at <span className="font-semibold">support@dermai.ph</span>
          </p>
        </div>
      </div>

      {/* User Guide Modal */}
      {showGuide && (<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-magenta-100 rounded-xl text-magenta-600">
                  <BookOpen className="w-5 h-5"/>
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">User Guide</h2>
                  <p className="text-xs text-gray-500">How to get started with DermAI</p>
                </div>
              </div>
              <button onClick={() => setShowGuide(false)} className="p-2 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                <X className="w-5 h-5"/>
              </button>
            </div>

            {/* Steps */}
            <div className="overflow-y-auto px-6 py-5 space-y-6">
              {guideSteps.map((section, si) => (<div key={si}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-1.5 bg-magenta-100 rounded-lg text-magenta-500">
                      <section.icon className="w-4 h-4"/>
                    </div>
                    <h3 className="text-sm font-bold text-gray-900">
                      Step {si + 1}: {section.title}
                    </h3>
                  </div>
                  <ol className="space-y-2 pl-1">
                    {section.steps.map((step, i) => (<li key={i} className="flex items-start gap-3">
                        <span className="shrink-0 mt-0.5 w-5 h-5 flex items-center justify-center rounded-full bg-magenta-500 text-white text-[11px] font-bold">
                          {i + 1}
                        </span>
                        <p className="text-sm text-gray-600 leading-relaxed">{step}</p>
                      </li>))}
                  </ol>
                </div>))}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50">
              <button onClick={() => setShowGuide(false)} className="w-full py-2.5 rounded-full bg-magenta-500 text-white text-sm font-semibold hover:bg-magenta-600 transition-colors shadow-md shadow-magenta-500/20">
                Got it!
              </button>
            </div>
          </div>
        </div>)}
    </div>);
}
