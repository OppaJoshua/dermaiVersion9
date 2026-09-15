import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  User,
  Mail,
  Phone,
  Award,
  LifeBuoy,
  ChevronDown,
  ChevronUp,
  Send,
  Camera,
  Trash2,
  CheckCircle2,
  ShieldCheck,
  Building2,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { createHelpdeskTicketAsync } from "@/lib/store";

interface DoctorProfile {
  id?: string;
  fullName: string;
  email: string;
  prcLicense: string;
  specializations: string[];
  phone: string;
  clinicName: string;
  photo?: string;
}

const INITIAL_PROFILE: DoctorProfile = {
  fullName: "",
  email: "",
  prcLicense: "",
  specializations: ["Dermatology"],
  phone: "",
  clinicName: "DermAI Clinic",
  photo: "",
};

const FAQS = [
  {
    question: "How do I review patient appointments?",
    answer:
      "Navigate to the 'Review Patient' tab in the left sidebar. Select any pending case to review patient notes, uploaded skin photos, and AI triage recommendations before approving or rejecting.",
  },
  {
    question: "How do I view my assigned consultation schedule?",
    answer:
      "Go to 'Assigned Appointment'. All finalized schedules confirmed by your affiliated clinic are displayed chronologically with complete patient details.",
  },
  {
    question: "How can I update my doctor license or clinical specialization?",
    answer:
      "Your PRC License, legal name, and specializations are verified and managed by your clinic administrator to maintain regulatory compliance. Please contact your clinic manager to request updates.",
  },
  {
    question: "What should I do if an AI skin analysis appears inaccurate?",
    answer:
      "When reviewing the patient case in 'Review Patient', you can reject the case and state your clinical reasoning in the review note. You can also enter the accurate final diagnosis.",
  },
];

export default function DoctorSettingsPage() {
  const [profile, setProfile] = useState<DoctorProfile>(INITIAL_PROFILE);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketMessage, setTicketMessage] = useState("");
  const [ticketSent, setTicketSent] = useState(false);
  const [photoSaved, setPhotoSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) return;
    if (file.size > 3 * 1024 * 1024) return;

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
        setPhotoSaved(true);
        setTimeout(() => setPhotoSaved(false), 3000);
      }
    };
    reader.readAsDataURL(file);
  };

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

  const loadData = useCallback(async () => {
    try {
      let docFound: any = null;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const sessionEmail = sessionData?.session?.user?.email;

        let query = supabase.from("clinic_doctor").select(`
          doctor_id,
          doctor_name,
          email,
          prc_license,
          contact_number,
          photo_url,
          clinic:clinic_id ( name )
        `);

        if (sessionEmail) {
          query = query.ilike("email", sessionEmail);
        }

        const { data: docs } = await query.limit(1);
        if (docs && docs.length > 0) {
          docFound = docs[0];
        }
      } catch {
        /* ignore */
      }

      let storedProfile: any = null;
      try {
        const storedStr = localStorage.getItem("dermai_doctor_profile");
        if (storedStr) storedProfile = JSON.parse(storedStr);
      } catch {}

      let clinicDoctorMatch: any = null;
      try {
        const storedClinicDocs = localStorage.getItem("dermai_clinic_doctors");
        if (storedClinicDocs) {
          const parsed = JSON.parse(storedClinicDocs);
          if (Array.isArray(parsed) && parsed.length > 0) {
            clinicDoctorMatch = parsed[0];
          }
        }
      } catch {}

      const clinicObj: any = Array.isArray(docFound?.clinic) ? docFound.clinic[0] : docFound?.clinic;

      setProfile({
        id: docFound?.doctor_id || clinicDoctorMatch?.id || "doc-1",
        fullName: docFound?.doctor_name || storedProfile?.fullName || clinicDoctorMatch?.name || "Dr. Audrey Saludaga",
        email: docFound?.email || storedProfile?.email || clinicDoctorMatch?.email || "audreyleesaludaga3@gmail.com",
        prcLicense: docFound?.prc_license || storedProfile?.prcLicense || clinicDoctorMatch?.prcLicense || "0148291",
        specializations: ["Dermatology", "Medical Aesthetics"],
        phone: docFound?.contact_number || storedProfile?.phone || clinicDoctorMatch?.contactNumber || "+63 917 839 2011",
        clinicName: clinicObj?.name || clinicDoctorMatch?.clinicName || "DermAI Clinic",
        photo: storedProfile?.photo || docFound?.photo_url || clinicDoctorMatch?.photo || "",
      });
    } catch (err) {
      console.error("Error loading doctor profile:", err);
    }
  }, []);

  useEffect(() => {
    loadData();

    const channel = supabase
      .channel("doctor-settings-profile-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "clinic_doctor" },
        () => {
          loadData();
        }
      )
      .subscribe();

    window.addEventListener("storage", loadData);
    window.addEventListener("dermai_doctor_profile_updated", loadData);
    window.addEventListener("focus", loadData);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("storage", loadData);
      window.removeEventListener("dermai_doctor_profile_updated", loadData);
      window.removeEventListener("focus", loadData);
    };
  }, [loadData]);

  const handleSendTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketSubject.trim() || !ticketMessage.trim()) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await createHelpdeskTicketAsync({
        userId: session?.user?.id || profile.id,
        user: profile.fullName?.trim() || session?.user?.email?.split("@")[0] || "Dr. Practitioner",
        email: profile.email?.trim() || session?.user?.email || "",
        subject: ticketSubject.trim(),
        message: ticketMessage.trim(),
        category: "Doctor Clinical Support",
        priority: "medium",
      });
    } catch (err) {
      console.error("Failed to submit doctor ticket:", err);
    }
    setTicketSent(true);
    setTicketSubject("");
    setTicketMessage("");
    setTimeout(() => setTicketSent(false), 4000);
  };

  return (
    <div className="max-w-4xl space-y-6 pb-12">
      {/* Header */}
      <div className="pb-2 border-b border-slate-200/80">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Help &amp; Clinical Support</h1>
        <p className="text-xs text-slate-500 mt-1">
          Review your verified practitioner credentials, browse clinical FAQs, and contact platform support.
        </p>
      </div>

      {/* Verified Practitioner Card */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-4">
            <div className="relative group shrink-0">
              {profile.photo ? (
                <img
                  src={profile.photo}
                  alt={profile.fullName}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-16 h-16 rounded-2xl object-cover border border-slate-200 shadow-xs cursor-pointer hover:opacity-90 transition-opacity"
                />
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="w-16 h-16 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center border border-slate-200 shadow-xs cursor-pointer hover:bg-slate-200/70 transition-colors"
                >
                  <User className="w-8 h-8 text-slate-400" />
                </div>
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute -bottom-1 -right-1 p-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl shadow-xs transition-all cursor-pointer"
                title="Update photo"
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
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-slate-900">{profile.fullName}</h2>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <ShieldCheck className="w-3 h-3 text-emerald-600" /> Verified Doctor
                </span>
              </div>
              <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                <span>{profile.clinicName}</span>
              </p>
              {profile.photo && (
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:text-rose-700 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" /> Remove custom photo
                </button>
              )}
            </div>
          </div>

          {photoSaved && (
            <span className="text-xs text-emerald-700 font-semibold inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl self-start sm:self-center">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Avatar updated!
            </span>
          )}
        </div>

        {/* Verified Credential Badges Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 text-xs">
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1 flex items-center gap-1">
              <Award className="w-3 h-3" /> PRC License ID
            </span>
            <p className="font-bold text-slate-900 text-sm">#{profile.prcLicense}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Active Medical License</p>
          </div>

          <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1 flex items-center gap-1">
              <Mail className="w-3 h-3" /> Clinical Email
            </span>
            <p className="font-bold text-slate-900 truncate">{profile.email}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Roster login address</p>
          </div>

          <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1 flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Specialization
            </span>
            <p className="font-bold text-slate-900 truncate">Dermatology</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Assigned by clinic admin</p>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 italic">
          * Medical provider credentials, roster assignments, and clinic affiliations are managed by your clinic administration.
        </p>
      </div>

      {/* Support Contact Channels */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex items-start gap-3.5">
          <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 shrink-0">
            <Mail className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Clinical Support Email</p>
            <p className="font-bold text-slate-900 text-sm mt-0.5">support@dermai.ph</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Direct response within 24 hours on business days</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex items-start gap-3.5">
          <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 shrink-0">
            <Phone className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Direct Hotline</p>
            <p className="font-bold text-slate-900 text-sm mt-0.5">(032) 888-3472</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Monday – Friday, 8:00 AM – 5:00 PM PHT</p>
          </div>
        </div>
      </div>

      {/* FAQs Section */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <LifeBuoy className="w-4 h-4 text-slate-700" />
          <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Doctor Help &amp; FAQs</h2>
        </div>

        <div className="space-y-2">
          {FAQS.map((faq, i) => (
            <div key={i} className="border border-slate-200/80 rounded-xl overflow-hidden bg-white">
              <button
                type="button"
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full flex items-center justify-between px-4 py-3 text-left text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <span>{faq.question}</span>
                {openFaq === i ? (
                  <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-2" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-2" />
                )}
              </button>
              {openFaq === i && (
                <div className="px-4 pb-3.5 text-xs text-slate-600 leading-relaxed bg-slate-50/50 border-t border-slate-100">
                  {faq.answer}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Support Ticket Submission */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Submit Doctor Support Ticket</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Need technical help or have questions regarding patient triage data?
          </p>
        </div>

        <form onSubmit={handleSendTicket} className="space-y-3.5 text-xs">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Subject
            </label>
            <input
              type="text"
              value={ticketSubject}
              onChange={(e) => setTicketSubject(e.target.value)}
              placeholder="e.g. Question regarding patient appointment diagnosis"
              className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Message Details
            </label>
            <textarea
              rows={3}
              value={ticketMessage}
              onChange={(e) => setTicketMessage(e.target.value)}
              placeholder="Describe your inquiry, ticket details, or issue..."
              className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 resize-none"
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={!ticketSubject.trim() || !ticketMessage.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send Inquiry</span>
            </button>
            {ticketSent && (
              <span className="text-xs text-emerald-700 font-semibold inline-flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Inquiry submitted successfully!
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
