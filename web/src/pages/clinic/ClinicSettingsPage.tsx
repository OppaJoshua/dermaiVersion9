import { useState, useEffect } from "react";
import { Clock, AlertCircle, XCircle, Plus, X, LifeBuoy, Mail, Phone, ChevronDown, ChevronUp, Send, Trash2, Stethoscope } from "lucide-react";
import { useClinicVerification } from "@/hooks/useClinicVerification";
import { supabase } from "@/lib/supabaseClient";
import SpecializationMultiSelect, {
  type SpecializationOption,
} from "@/components/clinic/SpecializationMultiSelect";

/* ── Study-scoped service options ─────────────────────────── */
const SERVICES_OPTIONS = [
  "Vitiligo",
  "Acne Vulgaris",
  "Atopic Dermatitis",
  "Contact Dermatitis",
  "Melasma",
];

/** Map legacy or parenthesized service names to clean standardized names */
const LEGACY_SERVICE_MAP: Record<string, string> = {
  "Tinea Versicolor (Anapaw)": "",
  "Tinea Corporis (Buni)": "",
  "Tinea Pedis (Athlete's Foot)": "",
  "Prickly Heat (Bungang Araw)": "",
  "Impetigo (Nana sa Balat)": "",
  "Leprosy (Ketong)": "",
  "Acne Vulgaris (Taghiyawat)": "Acne Vulgaris",
  "Contact Dermatitis (Skin Allergy)": "Contact Dermatitis",
  "Atopic Dermatitis (Eczema)": "Atopic Dermatitis",
  "Melasma (Dark Patches)": "Melasma",
};

/** Parse servicesOffered: handles JSON array string or legacy comma string */
function parseServices(raw: string): string[] {
  if (!raw) return [];
  let list: string[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) list = parsed as string[];
  } catch {
    /* ignore invalid JSON */
  }
  if (!list.length) {
    list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return list
    .map((s) => (s in LEGACY_SERVICE_MAP ? LEGACY_SERVICE_MAP[s] : s))
    .filter(Boolean);
}

export type ClinicDoctor = {
  id: string;
  name: string;
  specializations: string[];
};

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
  doctors: ClinicDoctor[];
  servicesOffered: string;
  consultationFee: string;
  description: string;
  status: "pending" | "verified" | "rejected";
};

const DEFAULT_SPECIALIZATIONS: SpecializationOption[] = [
  { id: "spec-1", name: "General Dermatology" },
  { id: "spec-2", name: "Clinical Dermatology" },
  { id: "spec-3", name: "Cosmetic Dermatology" },
  { id: "spec-4", name: "Aesthetic Dermatology" },
  { id: "spec-5", name: "Pediatric Dermatology" },
  { id: "spec-6", name: "Dermatologic Surgery" },
  { id: "spec-7", name: "Dermatopathology" },
  { id: "spec-8", name: "Dermatology Oncology" },
  { id: "spec-9", name: "Hair & Scalp Dermatology" },
  { id: "spec-10", name: "Nail Dermatology" },
  { id: "spec-11", name: "Immunodermatology" },
  { id: "spec-12", name: "Contact Dermatitis & Allergy" },
  { id: "spec-13", name: "Photodermatology" },
  { id: "spec-14", name: "Dermatology & Venereology" },
];

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
  doctors: [{ id: "doc-1", name: "", specializations: [] }],
  servicesOffered: "",
  consultationFee: "",
  description: "",
  status: "verified",
};

export default function ClinicSettingsPage() {
  const [settings, setSettings] = useState<ClinicSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [selectedServices, setSelectedServices] = useState<string[]>(() =>
    parseServices(DEFAULT_SETTINGS.servicesOffered)
  );
  const [customServiceInput, setCustomServiceInput] = useState("");

  // Dynamic Specializations: loaded with defaults for UI, updated from database if available
  const [specializationOptions, setSpecializationOptions] = useState<SpecializationOption[]>(DEFAULT_SPECIALIZATIONS);
  const [loadingSpecializations] = useState(false);

  // Helpdesk state
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketMessage, setTicketMessage] = useState("");
  const [ticketSent, setTicketSent] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  // Load clinic settings from localStorage on mount (and optionally Supabase if available)
  useEffect(() => {
    async function loadData() {
      // 1. Fetch dynamic specializations from Supabase if connected
      try {
        const { data: specs, error: sErr } = await supabase
          .from("specializations")
          .select("id, name")
          .order("name", { ascending: true });

        if (!sErr && specs && specs.length > 0) {
          setSpecializationOptions(specs);
        }
      } catch (err) {
        // Backend not yet connected; using DEFAULT_SPECIALIZATIONS
      }

      // 2. Load saved clinic settings from localStorage or Supabase
      try {
        const savedRaw = localStorage.getItem("dermai_clinic_settings");
        if (savedRaw) {
          const parsed = JSON.parse(savedRaw);
          if (parsed && typeof parsed === "object") {
            setSettings((prev) => ({
              ...prev,
              ...parsed,
              doctors:
                Array.isArray(parsed.doctors) && parsed.doctors.length > 0
                  ? parsed.doctors
                  : prev.doctors,
            }));
            if (parsed.servicesOffered) {
              setSelectedServices(parseServices(parsed.servicesOffered));
            }
            return;
          }
        }
      } catch (err) {
        console.error("Error loading clinic settings:", err);
      }
    }

    loadData();
  }, []);

  const addDoctor = () => {
    setSettings((prev) => ({
      ...prev,
      doctors: [
        ...prev.doctors,
        { id: `doc-${Date.now()}`, name: "", specializations: [] },
      ],
    }));
  };

  const removeDoctor = (indexToRemove: number) => {
    setSettings((prev) => ({
      ...prev,
      doctors: prev.doctors.filter((_, i) => i !== indexToRemove),
    }));
  };

  const updateDoctorName = (index: number, name: string) => {
    setSettings((prev) => {
      const updated = [...prev.doctors];
      updated[index] = { ...updated[index], name };
      return { ...prev, doctors: updated };
    });
  };

  const updateDoctorSpecializations = (index: number, specNames: string[]) => {
    setSettings((prev) => {
      const updated = [...prev.doctors];
      updated[index] = { ...updated[index], specializations: specNames };
      return { ...prev, doctors: updated };
    });
  };

  const onSave = async () => {
    // 1. Save settings to localStorage for instant synchronization with FindClinicsPage
    const settingsToSave = {
      ...settings,
      servicesOffered: JSON.stringify(selectedServices),
    };
    localStorage.setItem("dermai_clinic_settings", JSON.stringify(settingsToSave));

    // 2. Synchronize doctors to Supabase
    try {
      for (const doc of settings.doctors) {
        if (doc.name.trim()) {
          const { data: existingDoc } = await supabase
            .from("doctors")
            .select("id")
            .eq("name", doc.name.trim())
            .limit(1);

          let doctorId = existingDoc?.[0]?.id;
          if (!doctorId) {
            const { data: newDoc } = await supabase
              .from("doctors")
              .insert({
                name: doc.name.trim(),
                email: `${doc.name.toLowerCase().replace(/[^a-z0-9]/g, "")}@example.com`,
                prc_license: "PRC-VERIFIED",
                clinic_name: settings.name || "Clinic",
                status: "Active",
              })
              .select("id")
              .single();
            doctorId = newDoc?.id;
          }

          if (doctorId && doc.specializations.length > 0) {
            const { data: matchedSpecs } = await supabase
              .from("specializations")
              .select("id, name")
              .in("name", doc.specializations);

            if (matchedSpecs && matchedSpecs.length > 0) {
              await supabase
                .from("doctor_specializations")
                .delete()
                .eq("doctor_id", doctorId);

              const rows = matchedSpecs.map((s) => ({
                doctor_id: doctorId,
                specialization_id: s.id,
              }));
              await supabase.from("doctor_specializations").insert(rows);
            }
          }
        }
      }
    } catch (err) {
      console.error("Error syncing doctors to Supabase:", err);
    }

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
  // UI Mode: Always allow editing so the clinic can test and customize their UI
  const isPending = false;

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

        {/* Professional Credentials & Doctors */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-2">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Professional Credentials</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Add all doctors working at your clinic. These doctors and their specializations will be displayed to patients on the Find Clinics page.
              </p>
            </div>
            {!isPending && (
              <button
                type="button"
                onClick={addDoctor}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-magenta-50 text-[#c0166a] border border-magenta-200 hover:bg-magenta-100/70 text-xs font-bold transition-all shrink-0"
              >
                <Plus className="w-3.5 h-3.5" /> Add Doctor
              </button>
            )}
          </div>

          <div className="space-y-3">
            {settings.doctors.map((doc, idx) => {
              const selectedIds = specializationOptions
                .filter((s) => doc.specializations.includes(s.name))
                .map((s) => s.id);

              return (
                <div
                  key={doc.id || idx}
                  className="p-4 sm:p-5 rounded-2xl border border-gray-200/80 bg-white shadow-sm space-y-3 relative transition-all hover:border-gray-300"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-xl bg-magenta-50 text-[#c0166a] border border-magenta-100 flex items-center justify-center">
                        <Stethoscope className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-xs font-bold text-gray-800">
                        Doctor {idx + 1}
                      </span>
                    </div>

                    {settings.doctors.length > 1 && !isPending && (
                      <button
                        type="button"
                        onClick={() => removeDoctor(idx)}
                        className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-600 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-colors font-medium"
                        title="Remove Doctor"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1.5">
                        Doctor Name *
                      </label>
                      <input
                        type="text"
                        disabled={isPending}
                        value={doc.name}
                        onChange={(e) => updateDoctorName(idx, e.target.value)}
                        placeholder="e.g. Dr. Maria Santos"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 disabled:bg-gray-50 disabled:text-gray-500 transition-all bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1.5">
                        Specialization(s) *
                      </label>
                      <SpecializationMultiSelect
                        options={specializationOptions}
                        selectedIds={selectedIds}
                        onChange={(ids) => {
                          const chosenNames = specializationOptions
                            .filter((s) => ids.includes(s.id))
                            .map((s) => s.name);
                          updateDoctorSpecializations(idx, chosenNames);
                        }}
                        placeholder="Select specializations..."
                        disabled={isPending || loadingSpecializations}
                        theme="magenta"
                      />
                    </div>
                  </div>
                </div>
              );
            })}

            {!isPending && (
              <button
                type="button"
                onClick={addDoctor}
                className="w-full py-3 rounded-2xl border-2 border-dashed border-magenta-200 hover:border-magenta-400 hover:bg-magenta-50/50 text-[#c0166a] text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" /> Add Another Doctor
              </button>
            )}
          </div>

          <div className="sm:col-span-2 pt-2">
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

              {/* Service option pills */}
              {!isPending && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {SERVICES_OPTIONS.map((svc) => {
                    const selected = selectedServices.includes(svc);
                    return (
                      <button
                        key={svc}
                        type="button"
                        onClick={() => toggleService(svc)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                          selected
                            ? "bg-magenta-500 text-white border-magenta-500 shadow-sm"
                            : "bg-white text-gray-600 border-gray-200 hover:border-magenta-300 hover:text-magenta-600"
                        }`}
                      >
                        {svc}
                      </button>
                    );
                  })}
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
