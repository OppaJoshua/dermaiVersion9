import { useState } from "react";
import { Clock, AlertCircle, XCircle, Plus, X, LifeBuoy, Mail, Phone, ChevronDown, ChevronUp, Send } from "lucide-react";
import { useClinicVerification } from "@/hooks/useClinicVerification";

/* ── Study-scoped service catalog ─────────────────────────── */
const SERVICES_CATALOG = [
  {
    category: "Fungal Infections",
    services: [
      "Tinea Versicolor (Anapaw)",
      "Tinea Corporis (Buni)",
      "Tinea Pedis (Athlete's Foot)",
    ],
  },
  {
    category: "Acne",
    services: ["Acne Vulgaris (Taghiyawat)"],
  },
  {
    category: "Inflammatory Conditions",
    services: [
      "Prickly Heat (Bungang Araw)",
      "Contact Dermatitis (Skin Allergy)",
      "Atopic Dermatitis (Eczema)",
    ],
  },
  {
    category: "Pigmentation",
    services: ["Melasma (Dark Patches)"],
  },
  {
    category: "Bacterial & Mycobacterial",
    services: [
      "Impetigo (Nana sa Balat)",
      "Leprosy (Ketong)",
    ],
  },
];

/** Parse servicesOffered: handles JSON array string or legacy comma string */
function parseServices(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as string[];
  } catch {
    /* ignore invalid JSON */
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

type ClinicSettings = {
  logo: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  location: string;
  operatingDays: string;
  openTime: string;
  closeTime: string;
  slotsPerDay: number;
  doctor: string;
  specialization: string;
  servicesOffered: string;
  consultationFee: string;
  description: string;
  prcLicense: string;
  status: "pending" | "verified" | "rejected";
};

// TODO: Replace with real clinic data loaded from Supabase auth session
const DEFAULT_SETTINGS: ClinicSettings = {
  logo: "",
  name: "",
  email: "",
  phone: "",
  address: "",
  location: "",
  operatingDays: "",
  openTime: "",
  closeTime: "",
  slotsPerDay: 10,
  doctor: "",
  specialization: "",
  servicesOffered: "",
  consultationFee: "",
  description: "",
  prcLicense: "",
  status: "pending",
};

export default function ClinicSettingsPage() {
  const [settings, setSettings] = useState<ClinicSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [selectedServices, setSelectedServices] = useState<string[]>(() =>
    parseServices(DEFAULT_SETTINGS.servicesOffered)
  );
  const [customServiceInput, setCustomServiceInput] = useState("");

  // Helpdesk state
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketMessage, setTicketMessage] = useState("");
  const [ticketSent, setTicketSent] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const onSave = () => {
    // TODO: Update clinic settings in Supabase
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const toggleService = (svc: string) => {
    setSelectedServices((prev) =>
      prev.includes(svc) ? prev.filter((s) => s !== svc) : [...prev, svc]
    );
  };

  const addCustomService = () => {
    const trimmed = customServiceInput.trim();
    if (trimmed && !selectedServices.includes(trimmed)) {
      setSelectedServices((prev) => [...prev, trimmed]);
    }
    setCustomServiceInput("");
  };

  const { status: verificationStatus } = useClinicVerification();
  // Only lock form when status is "pending" (awaiting review)
  // Rejected clinics can edit their profile; verified clinics can always edit
  const isPending = verificationStatus === "pending";

  const faqs = [
    {
      q: "How do I update my clinic's verification documents?",
      a: "Go to Basic Information, update the relevant fields and submit. An admin will re-review your application within 1–3 business days.",
    },
    {
      q: "Why are my appointment slots not showing to patients?",
      a: "Ensure your clinic status is Verified and that your operating hours and slots per day are saved correctly in Schedule & Capacity.",
    },
    {
      q: "How can I change my consultation fee?",
      a: "Consultation fees are managed per appointment type. You can set fees when configuring services under the Services section.",
    },
    {
      q: "What should I do if my clinic registration was rejected?",
      a: "Review the rejection reason sent to your registered email, update the incorrect information in your profile below, and submit a support ticket requesting re-review.",
    },
  ];

  const submitTicket = () => {
    if (!ticketSubject.trim() || !ticketMessage.trim()) return;
    setTicketSent(true);
    setTicketSubject("");
    setTicketMessage("");
    setTimeout(() => setTicketSent(false), 3000);
  };

  return (
    <div className="space-y-4 pb-12">
      <div>
        <h1 className="text-2xl font-display font-bold text-gray-900">Clinic Profile & Settings</h1>
        <p className="text-sm text-gray-400 mt-0.5">Manage your clinic information, schedules, and booking capacity</p>
      </div>

      {verificationStatus === "rejected" && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3 text-red-700">
          <XCircle className="w-5 h-5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-semibold mb-1">Clinic Registration Rejected</p>
            <p>Your clinic registration was rejected by the admin. You can update your profile information below, but you cannot accept appointments until an admin approves your clinic.</p>
          </div>
        </div>
      )}
      {verificationStatus === "pending" && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3 text-amber-700">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-semibold mb-1">Account Pending Verification</p>
            <p>Your clinic application is currently being reviewed by an administrator. You cannot edit your profile or accept appointments until you are verified.</p>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-6 max-w-3xl mx-auto">
        {/* Basic Info */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-gray-900 border-b pb-2">Basic Information</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-500 mb-2">Clinic Profile Photo</label>
              <div className="flex items-center gap-4">
                {settings.logo ? (
                  <img
                    src={settings.logo}
                    alt="Clinic logo"
                    className="w-16 h-16 rounded-full object-cover border-2 border-magenta-200 flex-shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-magenta-100 flex items-center justify-center flex-shrink-0 border-2 border-magenta-200">
                    <span className="text-magenta-500 text-xl font-bold">
                      {settings.name?.charAt(0)?.toUpperCase() || "C"}
                    </span>
                  </div>
                )}
                <div className="flex-1">
                  <label
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl border border-dashed border-gray-300 text-sm text-gray-500 cursor-pointer hover:border-magenta-400 hover:text-magenta-500 transition-colors ${
                      isPending ? "opacity-50 pointer-events-none" : ""
                    }`}
                  >
                    <Plus className="w-4 h-4" />
                    {settings.logo ? "Change Photo" : "Upload Photo"}
                    <input
                      type="file"
                      accept="image/*"
                      disabled={isPending}
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          setSettings((prev) => ({ ...prev, logo: reader.result as string }));
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                  <p className="text-[11px] text-gray-400 mt-1">JPG, PNG or WebP · Max 2 MB</p>
                  {settings.logo && !isPending && (
                    <button
                      type="button"
                      onClick={() => setSettings((prev) => ({ ...prev, logo: "" }))}
                      className="text-[11px] text-red-400 hover:text-red-600 mt-1"
                    >
                      Remove photo
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Clinic Name</label>
              <input
                type="text"
                disabled={isPending}
                value={settings.name}
                onChange={(e) => setSettings((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 focus:ring-2 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Email</label>
              <input
                type="email"
                disabled={isPending}
                value={settings.email}
                onChange={(e) => setSettings((prev) => ({ ...prev, email: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 focus:ring-2 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Contact Number</label>
              <input
                type="text"
                disabled={isPending}
                value={settings.phone}
                onChange={(e) => setSettings((prev) => ({ ...prev, phone: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 focus:ring-2 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Location</label>
              <input
                type="text"
                disabled={isPending}
                value={settings.location}
                onChange={(e) => setSettings((prev) => ({ ...prev, location: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 focus:ring-2 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Full Address</label>
              <input
                type="text"
                disabled={isPending}
                value={settings.address}
                onChange={(e) => setSettings((prev) => ({ ...prev, address: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 focus:ring-2 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Description</label>
              <textarea
                rows={3}
                disabled={isPending}
                value={settings.description}
                onChange={(e) => setSettings((prev) => ({ ...prev, description: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 focus:ring-2 disabled:bg-gray-50 disabled:text-gray-500 resize-none"
              />
            </div>
          </div>
        </div>

        {/* Doctor & Services */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-gray-900 border-b pb-2">Professional Credentials</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Doctor in Charge</label>
              <input
                type="text"
                disabled={isPending}
                value={settings.doctor}
                onChange={(e) => setSettings((prev) => ({ ...prev, doctor: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 focus:ring-2 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">PRC License #</label>
              <input
                type="text"
                disabled={isPending}
                value={settings.prcLicense}
                onChange={(e) => setSettings((prev) => ({ ...prev, prcLicense: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 focus:ring-2 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Specialization</label>
              <input
                type="text"
                disabled={isPending}
                value={settings.specialization}
                onChange={(e) => setSettings((prev) => ({ ...prev, specialization: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 focus:ring-2 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-500 mb-3">
                Services Offered
                <span className="ml-1 text-gray-400 font-normal">— Select all conditions your clinic treats. The system uses this to recommend your clinic to patients.</span>
              </label>

              {/* Selected tags */}
              {selectedServices.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {selectedServices.map((svc) => (
                    <span
                      key={svc}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-magenta-500 text-white text-xs font-medium"
                    >
                      {svc}
                      {!isPending && (
                        <button
                          type="button"
                          onClick={() => toggleService(svc)}
                          className="hover:text-pink-200 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}

              {/* Catalog tag grid grouped by category */}
              {!isPending && (
                <div className="space-y-3 mb-4">
                  {SERVICES_CATALOG.map((cat) => (
                    <div key={cat.category}>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">{cat.category}</p>
                      <div className="flex flex-wrap gap-2">
                        {cat.services.map((svc) => {
                          const selected = selectedServices.includes(svc);
                          return (
                            <button
                              key={svc}
                              type="button"
                              onClick={() => toggleService(svc)}
                              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                                selected
                                  ? "bg-magenta-500 text-white border-magenta-500"
                                  : "bg-white text-gray-600 border-gray-200 hover:border-magenta-300 hover:text-magenta-600"
                              }`}
                            >
                              {svc}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Custom service input */}
              {!isPending && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={customServiceInput}
                    onChange={(e) => setCustomServiceInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomService())}
                    placeholder="Add a custom service (e.g. Laser Resurfacing)..."
                    className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 focus:ring-2"
                  />
                  <button
                    type="button"
                    onClick={addCustomService}
                    className="flex items-center gap-1 px-3 py-2 rounded-xl bg-magenta-50 text-magenta-600 text-sm font-semibold border border-magenta-100 hover:bg-magenta-100 transition-colors"
                  >
                    <Plus className="w-4 h-4" /> Add
                  </button>
                </div>
              )}

              {isPending && selectedServices.length === 0 && (
                <p className="text-xs text-gray-400 italic">No services selected yet.</p>
              )}
            </div>
          </div>
        </div>

        {/* Consultation Fee */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-gray-900 border-b pb-2">Service Fee</h2>
          <p className="text-xs text-gray-400">This will be displayed to patients as <span className="font-semibold text-gray-600">Service Fee: Starts at ₱___</span> on the Find Clinics page.</p>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2">Starts at</label>
            <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden w-56 focus-within:border-magenta-500 focus-within:ring-2 focus-within:ring-magenta-100">
              <span className="px-3 py-2 text-sm text-gray-400 bg-gray-50 border-r border-gray-200 select-none">₱</span>
              <input
                type="number"
                min={0}
                disabled={isPending}
                placeholder="e.g. 600"
                value={settings.consultationFee}
                onChange={(e) => setSettings((prev) => ({ ...prev, consultationFee: e.target.value }))}
                className="flex-1 px-3 py-2 text-sm text-gray-900 outline-none disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
          </div>
        </div>

        {/* Schedule */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-gray-900 border-b pb-2">Schedule & Capacity</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Operating Days</label>
              <input
                type="text"
                disabled={isPending}
                value={settings.operatingDays}
                onChange={(e) => setSettings((prev) => ({ ...prev, operatingDays: e.target.value }))}
                placeholder="e.g. Mon-Sat"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 focus:ring-2 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Open Time</label>
              <input
                type="time"
                disabled={isPending}
                value={settings.openTime}
                onChange={(e) => setSettings((prev) => ({ ...prev, openTime: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 focus:ring-2 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Close Time</label>
              <input
                type="time"
                disabled={isPending}
                value={settings.closeTime}
                onChange={(e) => setSettings((prev) => ({ ...prev, closeTime: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 focus:ring-2 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Slots Per Day</label>
              <input
                type="number"
                min={1}
                max={100}
                disabled={isPending}
                value={settings.slotsPerDay}
                onChange={(e) => setSettings((prev) => ({ ...prev, slotsPerDay: Number(e.target.value) || 1 }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 focus:ring-2 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-magenta-50 border border-magenta-100 p-3 text-xs text-magenta-700 inline-flex items-center gap-2">
          <Clock className="w-4 h-4 text-magenta-500" />
          Keep schedules realistic to avoid overbooking and delayed consultations.
        </div>

        <div className="flex items-center gap-3 pt-4">
          <button
            onClick={onSave}
            disabled={isPending}
            className="px-5 py-2.5 rounded-full bg-magenta-500 text-white text-sm font-semibold hover:bg-magenta-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save Settings
          </button>
          {saved && <span className="text-xs text-green-600 font-semibold">Saved successfully</span>}
        </div>
      </div>

      {/* ── Helpdesk ──────────────────────────────────────────── */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-2 border-b pb-3">
          <LifeBuoy className="w-5 h-5 text-magenta-500" />
          <h2 className="text-lg font-bold text-gray-900">Helpdesk & Support</h2>
        </div>

        {/* Contact cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-magenta-50 border border-magenta-100">
            <Mail className="w-5 h-5 text-magenta-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-0.5">Email Support</p>
              <p className="text-sm font-semibold text-gray-900">support@dermai.ph</p>
              <p className="text-xs text-gray-400 mt-0.5">Replies within 24 hours on business days</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-4 rounded-xl bg-magenta-50 border border-magenta-100">
            <Phone className="w-5 h-5 text-magenta-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-0.5">Phone Support</p>
              <p className="text-sm font-semibold text-gray-900">(032) 888-3472</p>
              <p className="text-xs text-gray-400 mt-0.5">Mon – Fri, 8:00 AM – 5:00 PM</p>
            </div>
          </div>
        </div>

        {/* FAQ */}
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-gray-700">Frequently Asked Questions</h3>
          {faqs.map((faq, i) => (
            <div key={i} className="border border-gray-100 rounded-xl overflow-hidden">
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-semibold text-gray-800 hover:bg-gray-50 transition-colors"
              >
                {faq.q}
                {openFaq === i ? (
                  <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0 ml-2" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0 ml-2" />
                )}
              </button>
              {openFaq === i && (
                <div className="px-4 pb-3 text-sm text-gray-500 bg-gray-50">{faq.a}</div>
              )}
            </div>
          ))}
        </div>

        {/* Submit a ticket */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-gray-700">Submit a Support Ticket</h3>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Subject</label>
            <input
              type="text"
              value={ticketSubject}
              onChange={(e) => setTicketSubject(e.target.value)}
              placeholder="e.g. Unable to update clinic profile"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 focus:ring-2"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Message</label>
            <textarea
              value={ticketMessage}
              onChange={(e) => setTicketMessage(e.target.value)}
              rows={4}
              placeholder="Describe your issue or concern in detail..."
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 focus:ring-2 resize-none"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={submitTicket}
              disabled={!ticketSubject.trim() || !ticketMessage.trim()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-magenta-500 text-white text-sm font-semibold hover:bg-magenta-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
              Send Ticket
            </button>
            {ticketSent && <span className="text-xs text-green-600 font-semibold">Ticket submitted! We&apos;ll be in touch soon.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
