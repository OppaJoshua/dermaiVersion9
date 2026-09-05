import { useState, useEffect, useRef } from "react";
import {
  User,
  Mail,
  Phone,
  Award,
  Save,
  LifeBuoy,
  ChevronDown,
  ChevronUp,
  Send,
  Loader2,
  AlertCircle,
  Camera,
  Trash2,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import SpecializationMultiSelect, {
  type SpecializationOption,
} from "@/components/clinic/SpecializationMultiSelect";

interface DoctorProfile {
  id?: string;
  fullName: string;
  email: string;
  prcLicense: string;
  selectedSpecializationIds: string[];
  phone: string;
  photo?: string;
}

const INITIAL_PROFILE: DoctorProfile = {
  fullName: "",
  email: "",
  prcLicense: "",
  selectedSpecializationIds: [],
  phone: "",
  photo: "",
};

const FAQS = [
  {
    question: "How do I view my assigned appointments?",
    answer:
      "Navigate to the 'Assigned Appointment' tab from the sidebar. You will find all scheduled consultations along with patient records, dates, and consultation times.",
  },
  {
    question: "How do I approve or reject a patient review?",
    answer:
      "Go to 'Review Patient' in the doctor menu. Select the consultation record to inspect AI triage analysis, patient symptoms, and submit your medical approval or rejection.",
  },
  {
    question: "Why can't I see any appointments?",
    answer:
      "Appointments appear once patients book through your associated clinic and the clinic administrators assign them to your schedule. Ensure your clinic status is verified.",
  },
];

export default function DoctorSettingsPage() {
  const [profile, setProfile] = useState<DoctorProfile>(INITIAL_PROFILE);
  const [specializations, setSpecializations] = useState<SpecializationOption[]>([]);
  const [loadingSpecializations, setLoadingSpecializations] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helpdesk State
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketMessage, setTicketMessage] = useState("");
  const [ticketSent, setTicketSent] = useState(false);

  // Sync photo changes to clinic manage doctors
  const syncPhotoToClinic = (photoUrl: string, email?: string, id?: string) => {
    try {
      const raw = localStorage.getItem("dermai_clinic_doctors");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) return;

      let matched = false;
      const updated = parsed.map((doc: any) => {
        const matchByEmail =
          email && doc.email && doc.email.trim().toLowerCase() === email.trim().toLowerCase();
        const matchById = id && doc.id === id;

        if (matchByEmail || matchById || (!matched && parsed.length === 1)) {
          matched = true;
          return { ...doc, photo: photoUrl };
        }
        return doc;
      });

      localStorage.setItem("dermai_clinic_doctors", JSON.stringify(updated));
      window.dispatchEvent(new Event("storage"));
    } catch (err) {
      console.warn("Could not sync photo to clinic doctors:", err);
    }
  };

  // Handle Photo Upload
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setSaveError("Please upload a valid image file (PNG, JPG, JPEG, WEBP).");
      return;
    }

    if (file.size > 3 * 1024 * 1024) {
      setSaveError("Image file size should be less than 3MB.");
      return;
    }

    setSaveError("");
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      if (base64) {
        setProfile((prev) => {
          const updated = { ...prev, photo: base64 };
          localStorage.setItem("dermai_doctor_profile", JSON.stringify(updated));
          syncPhotoToClinic(base64, updated.email, updated.id);
          return updated;
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    };
    reader.readAsDataURL(file);
  };

  // Handle Remove Photo
  const handleRemovePhoto = () => {
    setProfile((prev) => {
      const updated = { ...prev, photo: "" };
      localStorage.setItem("dermai_doctor_profile", JSON.stringify(updated));
      syncPhotoToClinic("", updated.email, updated.id);
      return updated;
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Load specializations and doctor profile from database / local storage
  useEffect(() => {
    async function loadData() {
      try {
        setLoadingSpecializations(true);

        // 1. Fetch dynamic specializations from database
        try {
          const { data: specs, error: sErr } = await supabase
            .from("specializations")
            .select("id, name")
            .order("name", { ascending: true });

          if (!sErr && specs && specs.length > 0) {
            setSpecializations(specs);
          }
        } catch (err) {
          console.warn("Using local specializations:", err);
        }

        // 2. Fetch doctor profile from database
        let docFound: any = null;
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const sessionEmail = sessionData?.session?.user?.email;

          let query = supabase.from("doctors").select(`
            id,
            name,
            email,
            prc_license,
            contact_number,
            doctor_specializations (
              specialization_id
            )
          `);

          if (sessionEmail) {
            query = query.eq("email", sessionEmail);
          }

          const { data: docs } = await query.limit(1);
          if (docs && docs.length > 0) {
            docFound = docs[0];
          }
        } catch (authErr) {
          console.warn("Supabase doctor query:", authErr);
        }

        // 3. Fallback or merge with localStorage
        let storedProfile: DoctorProfile | null = null;
        try {
          const storedProfileStr = localStorage.getItem("dermai_doctor_profile");
          if (storedProfileStr) storedProfile = JSON.parse(storedProfileStr);
        } catch {
          /* ignore */
        }

        let clinicDoctorMatch: any = null;
        try {
          const storedClinicDoctorsStr = localStorage.getItem("dermai_clinic_doctors");
          if (storedClinicDoctorsStr) {
            const clinicDocs = JSON.parse(storedClinicDoctorsStr);
            if (Array.isArray(clinicDocs) && clinicDocs.length > 0) {
              if (docFound?.email) {
                clinicDoctorMatch = clinicDocs.find(
                  (d: any) => d.email?.toLowerCase() === docFound.email.toLowerCase()
                );
              } else if (storedProfile?.email) {
                clinicDoctorMatch = clinicDocs.find(
                  (d: any) => d.email?.toLowerCase() === storedProfile?.email?.toLowerCase()
                );
              }
              if (!clinicDoctorMatch) {
                clinicDoctorMatch = clinicDocs[0];
              }
            }
          }
        } catch {
          /* ignore */
        }

        if (docFound) {
          const specIds = (docFound.doctor_specializations || [])
            .map((ds: any) => ds.specialization_id)
            .filter(Boolean);

          setProfile({
            id: docFound.id,
            fullName: docFound.name || "",
            email: docFound.email || "",
            prcLicense: docFound.prc_license || "",
            phone: docFound.contact_number || "",
            selectedSpecializationIds:
              specIds.length > 0 ? specIds : storedProfile?.selectedSpecializationIds || [],
            photo: storedProfile?.photo || clinicDoctorMatch?.photo || "",
          });
        } else if (storedProfile && (storedProfile.fullName || storedProfile.email)) {
          setProfile({
            ...storedProfile,
            prcLicense: clinicDoctorMatch?.prcLicense || storedProfile.prcLicense,
            email: clinicDoctorMatch?.email || storedProfile.email,
            photo: storedProfile.photo || clinicDoctorMatch?.photo || "",
          });
        } else if (clinicDoctorMatch) {
          const specIds = (clinicDoctorMatch.specializations || [])
            .map((s: any) => s.id)
            .filter(Boolean);

          setProfile({
            id: clinicDoctorMatch.id,
            fullName: clinicDoctorMatch.name || "",
            email: clinicDoctorMatch.email || "",
            prcLicense: clinicDoctorMatch.prcLicense || "",
            phone: clinicDoctorMatch.contactNumber || "",
            selectedSpecializationIds: specIds,
            photo: clinicDoctorMatch.photo || "",
          });
        }
      } catch (err) {
        console.error("Error loading doctor settings data:", err);
      } finally {
        setLoadingSpecializations(false);
      }
    }

    loadData();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError("");

    try {
      setSaving(true);

      // 1. Save profile & photo to localStorage
      localStorage.setItem("dermai_doctor_profile", JSON.stringify(profile));

      // 2. Sync photo to clinic doctors in localStorage so clinic manage doctors immediately reflects it
      syncPhotoToClinic(profile.photo || "", profile.email, profile.id);

      setSaved(true);
      setTimeout(() => setSaved(false), 3500);
    } catch (err: any) {
      console.error("Failed to save profile photo:", err);
      setSaveError(err.message || "Failed to save profile photo. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleSendTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketSubject.trim() || !ticketMessage.trim()) return;
    setTicketSent(true);
    setTicketSubject("");
    setTicketMessage("");
    setTimeout(() => setTicketSent(false), 4000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      {/* Page Title & Subtitle */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your profile and get support.</p>
      </div>

      {/* Card 1: Profile Management */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex items-center gap-2 border-b border-gray-100 pb-4">
          <User className="w-4 h-4 text-blue-500" />
          <h2 className="text-sm font-bold text-gray-900">Profile Management</h2>
        </div>

        {/* Doctor Avatar Header */}
        <div className="flex items-center gap-4">
          <div className="relative group shrink-0">
            {profile.photo ? (
              <img
                src={profile.photo}
                alt={profile.fullName || "Doctor Profile"}
                onClick={() => fileInputRef.current?.click()}
                className="w-14 h-14 rounded-2xl object-cover border-2 border-blue-200 shadow-sm cursor-pointer hover:opacity-90 transition-opacity"
              />
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="w-14 h-14 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center border-2 border-blue-200/60 shadow-sm cursor-pointer hover:bg-blue-200/70 transition-colors"
              >
                <User className="w-7 h-7 text-blue-500" />
              </div>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 p-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md transition-all active:scale-95 hover:scale-105"
              title="Upload photo"
            >
              <Camera className="w-3.5 h-3.5" />
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handlePhotoUpload}
              accept="image/*"
              className="hidden"
            />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <p className="font-bold text-gray-900 text-base">
                {profile.fullName || "Doctor Profile"}
              </p>
              {profile.prcLicense && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100 shrink-0">
                  PRC #{profile.prcLicense}
                </span>
              )}
            </div>
            {profile.photo && (
              <button
                type="button"
                onClick={handleRemovePhoto}
                className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                Remove photo
              </button>
            )}
          </div>
        </div>

        {/* Form Fields */}
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
              FULL NAME
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={profile.fullName}
                disabled
                readOnly
                placeholder="Enter your full name"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 bg-gray-50 cursor-not-allowed select-none placeholder:text-gray-400"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">This field cannot be changed.</p>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
              EMAIL ADDRESS
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="email"
                value={profile.email}
                disabled
                readOnly
                placeholder="doctor@example.com"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 bg-gray-50 cursor-not-allowed select-none placeholder:text-gray-400"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">This field cannot be changed.</p>
          </div>

          {/* PRC License Number - Disabled for Doctor, Only Clinic Can Edit */}
          <div>
            <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
              PRC LICENSE #
            </label>
            <div className="relative">
              <Award className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={profile.prcLicense}
                disabled
                readOnly
                placeholder="e.g. 0123456"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 bg-gray-50 cursor-not-allowed select-none placeholder:text-gray-400"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">This field cannot be changed.</p>
          </div>

          {/* Specialization Multi-Select Dropdown - Disabled for Doctor, Only Clinic Can Edit */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                SPECIALIZATION
              </label>
              {loadingSpecializations && (
                <span className="text-[11px] text-gray-400 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading specializations...
                </span>
              )}
            </div>
            <SpecializationMultiSelect
              options={specializations}
              selectedIds={profile.selectedSpecializationIds}
              onChange={() => {}}
              placeholder="No specializations assigned"
              disabled={true}
              theme="blue"
            />
            <p className="text-xs text-gray-400 mt-1">This field cannot be changed.</p>
          </div>

          {/* Phone Number - Disabled for Doctor, Only Clinic Can Edit */}
          <div>
            <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
              PHONE NUMBER
            </label>
            <div className="relative">
              <Phone className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="tel"
                value={profile.phone}
                disabled
                readOnly
                placeholder="09XXXXXXXXX"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 bg-gray-50 cursor-not-allowed select-none placeholder:text-gray-400"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">This field cannot be changed.</p>
          </div>

          {saveError && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" /> {saveError}
            </div>
          )}

          <div className="pt-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-all shadow-sm shadow-blue-500/10 active:scale-95 disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Profile Photo
            </button>
            {saved && (
              <span className="text-xs text-emerald-600 font-semibold animate-in fade-in duration-200">
                Profile photo saved successfully!
              </span>
            )}
          </div>
        </form>
      </div>

      {/* Card 2: Helpdesk & Support */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex items-center gap-2 border-b border-gray-100 pb-4">
          <LifeBuoy className="w-4 h-4 text-blue-500" />
          <h2 className="text-sm font-bold text-gray-900">Helpdesk & Support</h2>
        </div>

        {/* Contact Info Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex items-start gap-3.5 p-4 rounded-xl bg-blue-50/60 border border-blue-100/70">
            <Mail className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-0.5">Email Support</p>
              <p className="text-sm font-bold text-gray-900">support@dermai.ph</p>
              <p className="text-xs text-gray-400 mt-0.5">Replies within 24 hours on business days</p>
            </div>
          </div>

          <div className="flex items-start gap-3.5 p-4 rounded-xl bg-blue-50/60 border border-blue-100/70">
            <Phone className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-0.5">Phone Support</p>
              <p className="text-sm font-bold text-gray-900">(032) 888-3472</p>
              <p className="text-xs text-gray-400 mt-0.5">Mon – Fri, 8:00 AM – 5:00 PM</p>
            </div>
          </div>
        </div>

        {/* Frequently Asked Questions */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-gray-800">Frequently Asked Questions</h3>
          <div className="space-y-2">
            {FAQS.map((faq, i) => (
              <div key={i} className="border border-gray-100 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-semibold text-gray-800 hover:bg-gray-50/70 transition-colors"
                >
                  <span>{faq.question}</span>
                  {openFaq === i ? (
                    <ChevronUp className="w-4 h-4 text-gray-400 shrink-0 ml-2" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400 shrink-0 ml-2" />
                  )}
                </button>
                {openFaq === i && (
                  <div className="px-4 pb-3.5 text-xs sm:text-sm text-gray-500 leading-relaxed bg-gray-50/50">
                    {faq.answer}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Submit a Support Ticket */}
        <form onSubmit={handleSendTicket} className="space-y-3 pt-2">
          <h3 className="text-sm font-bold text-gray-800">Submit a Support Ticket</h3>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Subject</label>
            <input
              type="text"
              value={ticketSubject}
              onChange={(e) => setTicketSubject(e.target.value)}
              placeholder="e.g. Unable to update doctor profile"
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all placeholder:text-gray-400"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Message</label>
            <textarea
              rows={4}
              value={ticketMessage}
              onChange={(e) => setTicketMessage(e.target.value)}
              placeholder="Describe your issue or concern in detail..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all placeholder:text-gray-400 resize-none"
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={!ticketSubject.trim() || !ticketMessage.trim()}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm active:scale-95"
            >
              <Send className="w-4 h-4" />
              Send Ticket
            </button>
            {ticketSent && (
              <span className="text-xs text-emerald-600 font-semibold animate-in fade-in duration-200">
                Ticket submitted successfully! We'll be in touch soon.
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
