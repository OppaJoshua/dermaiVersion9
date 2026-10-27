import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Mail,
  Phone,
  LifeBuoy,
  ChevronDown,
  ChevronUp,
  Send,
  Camera,
  Trash2,
  CheckCircle2,
  Stethoscope,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { logAuditEvent } from "@/utils/auditLogger";
import { createHelpdeskTicketAsync } from "@/lib/store";
import { DoctorAvatar } from "@/components/common/DoctorAvatar";
import { updateDoctorAvatar, removeDoctorAvatar } from "@/lib/doctorAvatarService";
import { useDoctorClinicContext } from "@/components/layout/doctorLayout";
import { DoctorDutyScheduleCard } from "@/components/common/DoctorDutyScheduleCard";
import { MySupportTickets } from "@/components/support/MySupportTickets";

function CaduceusIcon({ className = "w-7 h-7 text-[#5B6B82]" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="2.5" r="1.5" fill="currentColor" />
      <line x1="12" y1="4" x2="12" y2="22" strokeWidth="2" />
      <path d="M12 6c-3-3-8.5-2.5-9.5 1 2.5 1.5 6 1.5 9.5 2" />
      <path d="M12 6c3-3 8.5-2.5 9.5 1-2.5 1.5-6 1.5-9.5 2" />
      <path d="M7 11.5c0-1.8 2.2-2.8 5-2.8s5 1 5 2.8c0 2-2.8 2.8-5 3.5-2.2-.7-5-1.5-5-3.5z" />
      <path d="M7.5 17c0-1.5 2-2.2 4.5-2.5 2.5.3 4.5 1 4.5 2.5 0 1.6-2 2.2-4.5 2.5-2.5-.3-4.5-.9-4.5-2.5z" />
    </svg>
  );
}

function IdCardIcon({ className = "w-6 h-6 text-blue-600" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.5" y="4.5" width="19" height="15" rx="3" />
      <circle cx="8" cy="10.5" r="2" />
      <path d="M5.5 15.5a2.5 2.5 0 0 1 5 0" />
      <line x1="14" y1="9.5" x2="18.5" y2="9.5" strokeWidth="2" />
      <line x1="14" y1="13.5" x2="17.5" y2="13.5" strokeWidth="2" />
    </svg>
  );
}

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
  specializations: [],
  phone: "",
  clinicName: "",
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
  const { activeClinicId, activeAffiliation } = useDoctorClinicContext();
  const selectedClinicName = activeAffiliation?.clinic?.name || "No clinic assignments found";
  const [profile, setProfile] = useState<DoctorProfile>(() => {
    try {
      const stored = localStorage.getItem("dermai_doctor_profile");
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          ...INITIAL_PROFILE,
          id: parsed.id || parsed.doctor_id || "",
          fullName: parsed.fullName || parsed.name || "",
          photo: parsed.photo || parsed.photo_url || "",
          clinicName: parsed.clinic || parsed.clinicName || "",
        };
      }
    } catch {}
    return INITIAL_PROFILE;
  });
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketMessage, setTicketMessage] = useState("");
  const [ticketSent, setTicketSent] = useState(false);
  const [ticketSubmitting, setTicketSubmitting] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [photoSaved, setPhotoSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const profileRequestRef = useRef(0);

  const uploadDoctorPhoto = async (file: File): Promise<string> => {
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `doctors/${Date.now()}_${cleanName}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("clinic-photos")
      .upload(storagePath, file, { upsert: true });

    if (uploadError || !uploadData?.path) {
      throw uploadError || new Error("Photo upload failed.");
    }

    const { data: publicUrlData } = supabase.storage
      .from("clinic-photos")
      .getPublicUrl(uploadData.path);

    const publicUrl = publicUrlData?.publicUrl;
    if (!publicUrl) {
      throw new Error("Could not create a public photo URL.");
    }

    return publicUrl;
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      return;
    }

    if (file.size > 3 * 1024 * 1024) {
      return;
    }

    if (!profile.id) {
      console.error("Cannot upload doctor photo: doctor ID is missing.");
      return;
    }

    try {
      const rawPhotoUrl = await uploadDoctorPhoto(file);
      const { data: sessionData } = await supabase.auth.getSession();
      const sessionUserId = sessionData?.session?.user?.id;

      // Update central doctor avatar with cache busting, localStorage sync, and global event dispatch
      const updatedUrl = await updateDoctorAvatar(profile.id, rawPhotoUrl, sessionUserId);

      setProfile((prev) => ({ ...prev, photo: updatedUrl }));
      setPhotoSaved(true);
      setTimeout(() => setPhotoSaved(false), 3000);

      logAuditEvent({
        userId: sessionUserId || profile.id,
        role: "doctor",
        category: "User",
        action: "Avatar Updated",
        target: "Doctor Avatar",
        details: `Dr. ${profile.fullName || "Doctor"} updated their profile avatar.`,
        performerName: profile.fullName || "Doctor",
      }).catch(() => {});
    } catch (err) {
      console.error("Failed to upload doctor photo:", err);
    }
  };

  const handleRemovePhoto = async () => {
    if (!profile.id) {
      console.error("Cannot remove doctor photo: doctor ID is missing.");
      return;
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const sessionUserId = sessionData?.session?.user?.id;

      await removeDoctorAvatar(profile.id, sessionUserId);

      setProfile((prev) => ({ ...prev, photo: "" }));

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      logAuditEvent({
        userId: sessionUserId || profile.id,
        role: "doctor",
        category: "User",
        action: "Avatar Removed",
        target: "Doctor Avatar",
        details: `Dr. ${profile.fullName || "Doctor"} removed their profile avatar.`,
        performerName: profile.fullName || "Doctor",
      }).catch(() => {});
    } catch (err) {
      console.error("Failed to remove doctor photo:", err);
    }
  };

  const loadData = useCallback(async () => {
    const requestId = ++profileRequestRef.current;
    if (!activeClinicId || activeClinicId === "all") return;
    try {
      let docFound: any = null;
      const storedDocId = activeAffiliation?.doctor_id || "";

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const sessionUserId = sessionData?.session?.user?.id;
        if (!sessionUserId) return;

        // Resolve only the authenticated user's active branch affiliation.
        if (storedDocId) {
          const { data: docById } = await supabase
            .from("clinic_doctor")
            .select(`
              doctor_id,
              doctor_name,
              email,
              prc_license,
              contact_number,
              photo_url,
              clinic:clinic_id ( name ),
              doctor_specializations (
                specialization_id,
                specializations (
                  id,
                  name
                )
              )
            `)
            .eq("doctor_id", storedDocId)
            .eq("user_id", sessionUserId)
            .eq("clinic_id", activeClinicId)
            .maybeSingle();

          if (docById) {
            docFound = docById;
          }
        }

        // 2. Fallback to session user id, prioritizing most recent
        if (!docFound && sessionUserId) {
          const { data: docs } = await supabase
            .from("clinic_doctor")
            .select(`
              doctor_id,
              doctor_name,
              email,
              prc_license,
              contact_number,
              photo_url,
              clinic:clinic_id ( name ),
              doctor_specializations (
                specialization_id,
                specializations (
                  id,
                  name
                )
              )
            `)
            .eq("user_id", sessionUserId)
            .eq("clinic_id", activeClinicId)
            .order("created_at", { ascending: false });

          if (docs && docs.length > 0) {
            docFound = docs[0];
          }
        }
      } catch (err) {
        console.warn("Could not query doctor profile from Supabase:", err);
      }

      const clinicObj: any = Array.isArray(docFound?.clinic) ? docFound.clinic[0] : docFound?.clinic;

      const parsedSpecializations = (docFound?.doctor_specializations || [])
        .map((item: any) => item?.specializations)
        .filter(Boolean)
        .map((spec: any) => String(spec.name || "").trim())
        .filter(Boolean);

      const updatedProfile: DoctorProfile = {
        id: docFound?.doctor_id || storedDocId || "",
        fullName: docFound?.doctor_name || "",
        email: docFound?.email || "",
        prcLicense: docFound?.prc_license || "",
        specializations: parsedSpecializations,
        phone: docFound?.contact_number || "",
        clinicName: clinicObj?.name || "",
        photo: docFound?.photo_url || "",
      };
      if (requestId !== profileRequestRef.current) return;
      setProfile(updatedProfile);
      try {
        localStorage.setItem(
          "dermai_doctor_profile",
          JSON.stringify({
            id: updatedProfile.id,
            fullName: updatedProfile.fullName,
            clinic: updatedProfile.clinicName,
            photo: updatedProfile.photo,
          })
        );
      } catch {}
    } catch (err) {
      console.error("Error loading doctor profile:", err);
    }
  }, [activeClinicId, activeAffiliation?.doctor_id]);

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


    window.addEventListener("focus", loadData);
    window.addEventListener("dermai_doctor_avatar_updated", loadData);
    window.addEventListener("dermai_doctor_profile_updated", loadData);

    return () => {
      ++profileRequestRef.current;
      supabase.removeChannel(channel);
      window.removeEventListener("focus", loadData);
      window.removeEventListener("dermai_doctor_avatar_updated", loadData);
      window.removeEventListener("dermai_doctor_profile_updated", loadData);
    };
  }, [loadData]);

  const handleSendTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketSubject.trim() || !ticketMessage.trim() || ticketSubmitting) return;
    setTicketSubmitting(true);
    setTicketError(null);
    setTicketSent(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await createHelpdeskTicketAsync({
        userId: session?.user?.id || profile.id,
        user: profile.fullName?.trim() || session?.user?.email?.split("@")[0] || "",
        email: profile.email?.trim() || session?.user?.email || "",
        subject: ticketSubject.trim(),
        message: ticketMessage.trim(),
        category: "Doctor Clinical Support",
        priority: "medium",
      });
      setTicketSent(true);
      setTicketSubject("");
      setTicketMessage("");
      window.setTimeout(() => setTicketSent(false), 4000);

      logAuditEvent({
        userId: session?.user?.id || profile.id,
        role: "doctor",
        category: "System",
        action: "Support Ticket Submitted",
        target: `Ticket: ${ticketSubject.trim()}`,
        details: `Dr. ${profile.fullName || "Doctor"} submitted a clinical support inquiry: "${ticketSubject.trim()}".`,
        performerName: profile.fullName || "Doctor",
        metadata: {
          category: "Doctor Clinical Support",
          priority: "medium",
        },
      }).catch(() => {});
    } catch (err) {
      console.error("Failed to submit doctor ticket:", err);
      setTicketError(
        err instanceof Error
          ? err.message
          : "Your inquiry could not be submitted. Please try again."
      );
    } finally {
      setTicketSubmitting(false);
    }
  };

  if (activeClinicId === "all") return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <h1 className="text-xl font-bold text-slate-900">Clinic Profile &amp; Settings</h1>
      <p className="mt-2 text-sm text-slate-600">Select a clinic in the branch switcher to view its doctor profile, duty schedule, and support settings.</p>
    </div>
  );

  return (
    <div className="max-w-7xl space-y-6 pb-12">
      {/* Header */}
      <div className="pb-2 border-b border-slate-200/80">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Help &amp; Clinical Support</h1>
        <p className="text-base text-slate-500 mt-1">
          Review your doctor profile, browse clinical FAQs, and contact platform support.
        </p>
      </div>

      {/* Doctor Information - Top Banner Card */}
      <div className="bg-white rounded-2xl border border-sky-100/80 p-5 sm:p-6 md:p-7 shadow-xs relative overflow-hidden min-w-0">
        {/* Subtle decorative faceted gradient accent on the right */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-0 bottom-0 w-80 bg-gradient-to-l from-[#E8F3FD] via-[#F2F8FD]/80 to-transparent opacity-90 hidden sm:block"
          style={{ clipPath: "polygon(30% 0%, 100% 0%, 100% 100%, 0% 100%)" }}
        />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          {/* Left: Doctor Photo & Primary Info */}
          <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-4 sm:gap-6 min-w-0 flex-1">
            <div className="relative group shrink-0">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="cursor-pointer hover:opacity-95 transition-opacity"
                title="Click to change photo"
              >
                <DoctorAvatar
                  doctorId={profile.id}
                  doctor={{ photo_url: profile.photo, name: profile.fullName }}
                  name={profile.fullName}
                  className="w-24 h-24 sm:w-28 sm:h-28 !rounded-2xl border border-slate-200/80 shadow-xs text-3xl font-bold"
                />
              </div>
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

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-center sm:justify-start gap-3 flex-wrap">
                <h2 className="text-xl sm:text-2xl md:text-[26px] font-bold text-slate-900 tracking-tight">
                  {profile.fullName || "Doctor"}
                </h2>
              </div>

              <p className="text-sm font-medium text-[#64748B] flex items-center justify-center sm:justify-start gap-2 mt-2">
                <Stethoscope className="w-4 h-4 text-[#64748B] shrink-0" />
                <span>{selectedClinicName}</span>
              </p>

              {profile.photo && (
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-rose-500 hover:text-rose-600 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                  <span>Remove Profile Photo</span>
                </button>
              )}

              {photoSaved && (
                <span className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Avatar updated!
                </span>
              )}
            </div>
          </div>

          {/* Right: Specialization */}
          <div className="flex items-start gap-3.5 sm:gap-4 md:pl-8 lg:pl-10 md:border-l md:border-slate-200/80 pt-4 md:pt-0 border-t border-slate-100 md:border-t-0 md:max-w-md lg:max-w-lg min-w-0 shrink-0">
            <CaduceusIcon className="w-7 h-7 text-[#5B6B82] shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] sm:text-[14px] font-bold uppercase tracking-wider text-[#64748B]/80 mb-0.5">
                SPECIALIZATION
              </p>
              <p className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight leading-snug break-words">
                {profile.specializations && profile.specializations.length > 0
                  ? profile.specializations.join(", ")
                  : "Not assigned"}
              </p>
              <p className="text-xs text-[#94A3B8] mt-0.5">
                Assigned by clinic admin
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: PRC License, Email, Contact Number */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5 min-w-0">
        {/* Card 1: PRC License ID */}
        <div className="bg-white rounded-2xl border border-sky-100/80 p-4 sm:p-5.5 shadow-xs flex items-center gap-3.5 sm:gap-4">
          <IdCardIcon className="w-6 h-6 text-[#1D4ED8] shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="text-[14px] font-bold uppercase tracking-wider text-[#64748B]/80 block mb-0.5">
              PRC LICENSE ID
            </span>
            <p className="font-bold text-slate-900 text-lg sm:text-xl tracking-tight truncate">
              {profile.prcLicense
                ? profile.prcLicense.startsWith("#")
                  ? profile.prcLicense
                  : `#${profile.prcLicense}`
                : "Not provided"}
            </p>
            <p className="text-sm text-[#94A3B8] mt-0.5">PRC license number on file</p>
          </div>
        </div>

        {/* Card 2: Clinical Email */}
        <div className="bg-white rounded-2xl border border-sky-100/80 p-4 sm:p-5.5 shadow-xs flex items-center gap-3.5 sm:gap-4">
          <Mail className="w-7 h-6 text-[#1D4ED8] shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="text-[14px] font-bold uppercase tracking-wider text-[#64748B]/80 block mb-0.5">
              CLINICAL EMAIL
            </span>
            <p
              className="font-bold text-slate-900 text-sm sm:text-[15px] tracking-tight break-all sm:break-normal leading-snug"
              title={profile.email}
            >
              {profile.email || "—"}
            </p>
            <p className="text-sm text-[#94A3B8] mt-0.5">Roster login address</p>
          </div>
        </div>

        {/* Card 3: Contact Number */}
        <div className="bg-white rounded-2xl border border-sky-100/80 p-4 sm:p-5.5 shadow-xs flex items-center gap-3.5 sm:gap-4 sm:col-span-2 xl:col-span-1">
          <Phone className="w-6 h-6 text-[#1D4ED8] shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="text-[14px] font-bold uppercase tracking-wider text-[#64748B]/80 block mb-0.5">
              CONTACT NUMBER
            </span>
            <p className="font-bold text-slate-900 text-base sm:text-lg tracking-tight truncate">
              {profile.phone || "Not provided"}
            </p>
            <p className="text-sm text-[#94A3B8] mt-0.5">Official clinic mobile</p>
          </div>
        </div>
      </div>

      <DoctorDutyScheduleCard
        doctorId={activeAffiliation?.doctor_id ?? null}
        clinicId={activeClinicId || null}
        clinicName={activeAffiliation?.clinic?.name || "No clinic selected"}
      />

      {/* Row 4: Disclaimer Footer */}
      <div className="pt-4 border-t border-slate-200/60">
        <p className="text-[12px] text-slate-400 italic">
          * Medical provider credentials, roster assignments, and clinic affiliations are managed by your clinic administration.
        </p>
      </div>

      {/* Support Contact Channels */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex items-start gap-3.5">
          <Mail className="w-5 h-5 text-slate-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-[14px] font-bold text-slate-400 uppercase tracking-wider">Clinical Support Email</p>
            <p className="font-bold text-slate-900 text-sm mt-0.5">support@dermai.ph</p>
            <p className="text-[12px] text-slate-500 mt-0.5">Direct response within 24 hours on business days</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex items-start gap-3.5">
          <Phone className="w-5 h-5 text-slate-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-[14px] font-bold text-slate-400 uppercase tracking-wider">Direct Hotline</p>
            <p className="font-bold text-slate-900 text-sm mt-0.5">(032) 888-3472</p>
            <p className="text-[12px] text-slate-500 mt-0.5">Monday – Friday, 8:00 AM – 5:00 PM PHT</p>
          </div>
        </div>
      </div>

      {/* FAQs Section */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <LifeBuoy className="w-4 h-4 text-slate-700" />
          <h2 className="text-base font-bold text-slate-900 uppercase tracking-wider">Doctor Help &amp; FAQs</h2>
        </div>

        <div className="space-y-2">
          {FAQS.map((faq, i) => (
            <div key={i} className="border border-slate-200/80 rounded-xl overflow-hidden bg-white">
              <button
                type="button"
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <span>{faq.question}</span>
                {openFaq === i ? (
                  <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-2" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-2" />
                )}
              </button>
              {openFaq === i && (
                <div className="px-4 pb-3.5 text-sm text-slate-600 leading-relaxed bg-slate-50/50 border-t border-slate-100">
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
          <h2 className="text-base font-bold text-slate-900 uppercase tracking-wider">Submit Doctor Support Ticket</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Need technical help or have questions regarding patient triage data?
          </p>
        </div>

        <form onSubmit={handleSendTicket} className="space-y-3.5 text-xs">
          <div>
            <label className="block text-[14px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Subject
            </label>
            <input
              type="text"
              value={ticketSubject}
              onChange={(e) => {
                setTicketSubject(e.target.value);
                setTicketError(null);
              }}
              placeholder="e.g. Question regarding patient appointment diagnosis"
              className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
            />
          </div>

          <div>
            <label className="block text-[14px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Message Details
            </label>
            <textarea
              rows={3}
              value={ticketMessage}
              onChange={(e) => {
                setTicketMessage(e.target.value);
                setTicketError(null);
              }}
              placeholder="Describe your inquiry, ticket details, or issue..."
              className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 resize-none"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={ticketSubmitting || !ticketSubject.trim() || !ticketMessage.trim()}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer shadow-xs w-full sm:w-auto"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{ticketSubmitting ? "Submitting..." : "Send Inquiry"}</span>
            </button>
            {ticketSent && (
              <span className="text-sm text-emerald-700 font-semibold inline-flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Inquiry submitted successfully!
              </span>
            )}
            {ticketError && (
              <span role="alert" className="text-sm text-red-600">
                {ticketError}
              </span>
            )}
          </div>
        </form>
      </div>

      {/* Submitted Doctor Support Tickets */}
      <MySupportTickets
        userId={profile.id}
        portalTheme="doctor"
        title="My support tickets"
        hideWhenEmpty={false}
      />
    </div>
  );
}
