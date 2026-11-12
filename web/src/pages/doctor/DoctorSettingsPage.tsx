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
import { DoctorDutyScheduleCard, ConsolidatedDutyScheduleCard } from "@/components/common/DoctorDutyScheduleCard";
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
  userId?: string;
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
  const { activeClinicId, activeAffiliation, affiliations, doctorName, googleAvatarUrl } = useDoctorClinicContext();
  const selectedClinicName = activeAffiliation?.clinic?.name || "No clinic assignments found";
  const [profile, setProfile] = useState<DoctorProfile>(() => {
    if (activeClinicId && activeClinicId !== "all") {
      try {
        const stored = localStorage.getItem(`dermai_doctor_profile_${activeClinicId}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          return {
            ...INITIAL_PROFILE,
            id: parsed.id || parsed.doctor_id || activeAffiliation?.doctor_id || "",
            fullName: parsed.fullName || parsed.name || activeAffiliation?.doctor_name || doctorName || "",
            photo: parsed.photo ?? parsed.photo_url ?? activeAffiliation?.photo_url ?? "",
            clinicName: parsed.clinic || parsed.clinicName || activeAffiliation?.clinic?.name || "",
          };
        }
      } catch {}
    }
    return {
      ...INITIAL_PROFILE,
      id: activeAffiliation?.doctor_id || "",
      fullName: activeAffiliation?.doctor_name || doctorName || "",
      photo: activeAffiliation?.photo_url || "",
      clinicName: activeAffiliation?.clinic?.name || "",
    };
  });
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string>("");
  const [sessionEmail, setSessionEmail] = useState<string>("");
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketMessage, setTicketMessage] = useState("");
  const [ticketSent, setTicketSent] = useState(false);
  const [ticketSubmitting, setTicketSubmitting] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [photoSaved, setPhotoSaved] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const profileRequestRef = useRef(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.id) {
        setSessionUserId(session.user.id);
      }
      if (session?.user?.email) {
        setSessionEmail(session.user.email.trim());
      }
    });
  }, []);

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

    setPhotoError(null);

    if (!activeClinicId || activeClinicId === "all") {
      setPhotoError("Please select a specific clinic branch to update your profile picture.");
      return;
    }

    if (!file.type.startsWith("image/")) {
      setPhotoError("Please select a valid image file.");
      return;
    }

    if (file.size > 3 * 1024 * 1024) {
      setPhotoError("Image size must be 3MB or less.");
      return;
    }

    const targetDoctorId = activeAffiliation?.doctor_id || profile.id;
    if (!targetDoctorId) {
      console.error("Cannot upload doctor photo: doctor ID is missing.");
      setPhotoError("Could not identify your clinic doctor profile.");
      return;
    }

    try {
      const rawPhotoUrl = await uploadDoctorPhoto(file);
      const { data: sessionData } = await supabase.auth.getSession();
      const currentSessionUserId = sessionData?.session?.user?.id;

      // Update clinic-specific doctor avatar with cache busting, scoped localStorage sync, and global event dispatch
      const updatedUrl = await updateDoctorAvatar(
        targetDoctorId,
        rawPhotoUrl,
        currentSessionUserId,
        activeClinicId
      );

      setProfile((prev) => ({ ...prev, id: targetDoctorId, photo: updatedUrl }));
      setPhotoSaved(true);
      setTimeout(() => setPhotoSaved(false), 3000);

      logAuditEvent({
        userId: currentSessionUserId || targetDoctorId,
        role: "doctor",
        category: "User",
        action: "Avatar Updated",
        target: "Doctor Avatar",
        details: `Dr. ${profile.fullName || "Doctor"} updated their profile avatar for ${selectedClinicName}.`,
        performerName: profile.fullName || "Doctor",
      }).catch(() => {});
    } catch (err) {
      console.error("Failed to upload doctor photo:", err);
      setPhotoError("Failed to upload photo. Your previous photo has been preserved.");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRemovePhoto = async () => {
    setPhotoError(null);

    if (!activeClinicId || activeClinicId === "all") {
      return;
    }

    const targetDoctorId = activeAffiliation?.doctor_id || profile.id;
    if (!targetDoctorId) {
      console.error("Cannot remove doctor photo: doctor ID is missing.");
      return;
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const currentSessionUserId = sessionData?.session?.user?.id;

      await removeDoctorAvatar(targetDoctorId, currentSessionUserId, activeClinicId);

      setProfile((prev) => ({ ...prev, id: targetDoctorId, photo: "" }));

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      logAuditEvent({
        userId: currentSessionUserId || targetDoctorId,
        role: "doctor",
        category: "User",
        action: "Avatar Removed",
        target: "Doctor Avatar",
        details: `Dr. ${profile.fullName || "Doctor"} removed their profile avatar for ${selectedClinicName}.`,
        performerName: profile.fullName || "Doctor",
      }).catch(() => {});
    } catch (err) {
      console.error("Failed to remove doctor photo:", err);
      setPhotoError("Failed to remove photo. Please try again.");
    }
  };

  const loadData = useCallback(async () => {
    const requestId = ++profileRequestRef.current;
    if (!activeClinicId || activeClinicId === "all") {
      setProfile({
        ...INITIAL_PROFILE,
        fullName: doctorName || affiliations[0]?.doctor_name || "",
        photo: "",
      });
      return;
    }

    // Immediately align id and photo with activeAffiliation while fetching full profile details
    if (activeAffiliation) {
      setProfile((prev) => ({
        ...prev,
        id: activeAffiliation.doctor_id,
        fullName: activeAffiliation.doctor_name || prev.fullName || doctorName || "",
        clinicName: activeAffiliation.clinic?.name || prev.clinicName || "",
        photo: activeAffiliation.photo_url || "",
      }));
    }
    try {
      let docFound: any = null;
      const storedDocId = activeAffiliation?.doctor_id || "";

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const sessionUserId = sessionData?.session?.user?.id;
        if (!sessionUserId) return;
        setSessionUserId(sessionUserId);

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
        userId: sessionUserId || docFound?.user_id || "",
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
          `dermai_doctor_profile_${activeClinicId}`,
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
  }, [activeClinicId, activeAffiliation, affiliations, doctorName]);

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
      const currentAuthId = session?.user?.id || sessionUserId || profile.userId || profile.id;
      await createHelpdeskTicketAsync({
        userId: currentAuthId,
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

      try {
        window.dispatchEvent(new CustomEvent("dermai_tickets_updated"));
      } catch {}

      logAuditEvent({
        userId: currentAuthId,
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

  if (activeClinicId === "all") {
    // 1. Consolidated Specialization Resolution
    const specEntries = affiliations.map((aff) => {
      const clinicName = aff.clinic?.name || "Clinic";
      const specs = (aff.specializations || []).map((s) => s.trim()).filter(Boolean);
      const normKey = specs
        .slice()
        .sort((a, b) => a.localeCompare(b))
        .map((s) => s.toLowerCase())
        .join("|");
      return {
        clinicId: aff.clinic_id,
        clinicName,
        specs,
        display: specs.length > 0 ? specs.join(", ") : "Not assigned",
        normKey,
      };
    });
    const nonEmptySpecEntries = specEntries.filter((e) => e.specs.length > 0);
    const missingSpecEntries = specEntries.filter((e) => e.specs.length === 0);
    const distinctSpecKeys = new Set(nonEmptySpecEntries.map((e) => e.normKey));
    const allSpecsIdentical =
      specEntries.length > 0 &&
      missingSpecEntries.length === 0 &&
      distinctSpecKeys.size === 1;

    // 2. Consolidated PRC License Resolution
    const prcEntries = affiliations.map((aff) => {
      const clinicName = aff.clinic?.name || "Clinic";
      const raw = (aff.prc_license || "").trim();
      const cleaned = raw.replace(/^#+/, "").trim();
      const norm = cleaned.toUpperCase();
      return {
        clinicId: aff.clinic_id,
        clinicName,
        raw,
        cleaned,
        norm,
      };
    });
    const recordedPrcEntries = prcEntries.filter((e) => e.norm.length > 0);
    const missingPrcClinics = prcEntries.filter((e) => e.norm.length === 0).map((e) => e.clinicName);
    const distinctPrcNorms = new Set(recordedPrcEntries.map((e) => e.norm));
    const hasPrcConflict = distinctPrcNorms.size > 1;
    const agreedPrc =
      distinctPrcNorms.size === 1 ? `#${recordedPrcEntries[0].cleaned}` : "";

    // 3. Consolidated Account Email & Distinct Clinic Roster Emails
    const resolvedAccountEmail =
      sessionEmail ||
      affiliations.find((a) => a.email && a.email.trim())?.email?.trim() ||
      "";
    const differingClinicEmails = affiliations
      .map((aff) => ({
        clinicId: aff.clinic_id,
        clinicName: aff.clinic?.name || "Clinic",
        email: (aff.email || "").trim(),
      }))
      .filter(
        (e) =>
          e.email.length > 0 &&
          (!resolvedAccountEmail || e.email.toLowerCase() !== resolvedAccountEmail.toLowerCase())
      );

    // 4. Consolidated Contact Number Resolution
    const phoneEntries = affiliations.map((aff) => {
      const clinicName = aff.clinic?.name || "Clinic";
      const raw = (aff.contact_number || "").trim();
      const norm = raw.replace(/\D/g, "") || raw;
      return {
        clinicId: aff.clinic_id,
        clinicName,
        raw,
        norm,
      };
    });
    const recordedPhoneEntries = phoneEntries.filter((e) => e.raw.length > 0);
    const missingPhoneClinics = phoneEntries.filter((e) => e.raw.length === 0).map((e) => e.clinicName);
    const distinctPhoneNorms = new Set(recordedPhoneEntries.map((e) => e.norm));
    const hasDifferingPhones = distinctPhoneNorms.size > 1;
    const sharedPhone =
      distinctPhoneNorms.size === 1 ? recordedPhoneEntries[0].raw : "";

    return (
    <div className="max-w-7xl space-y-6 pb-12">
      {/* Header */}
      <div className="pb-2 border-b border-slate-200/80">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Help &amp; Clinical Support</h1>
        <p className="text-base text-slate-500 mt-1">
          Consolidated view across all your affiliated clinic branches.
        </p>
      </div>

      {/* Doctor banner — read from localStorage / active profile */}
      <div className="bg-white rounded-2xl border border-sky-100/80 p-5 sm:p-6 md:p-7 shadow-xs relative overflow-hidden min-w-0">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-0 bottom-0 w-80 bg-gradient-to-l from-[#E8F3FD] via-[#F2F8FD]/80 to-transparent opacity-90 hidden sm:block"
          style={{ clipPath: "polygon(30% 0%, 100% 0%, 100% 100%, 0% 100%)" }}
        />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          {/* Left: Doctor Photo & Name (Consolidated view shows authenticated Google account avatar, no single-clinic photo override) */}
          <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-4 sm:gap-6 min-w-0 flex-1">
            <div className="relative shrink-0">
              <DoctorAvatar
                doctorId={undefined}
                doctor={{ photo_url: googleAvatarUrl || "", name: doctorName || profile.fullName || affiliations[0]?.doctor_name || "Doctor" }}
                name={doctorName || profile.fullName || affiliations[0]?.doctor_name || "Doctor"}
                className="w-24 h-24 sm:w-28 sm:h-28 !rounded-2xl border border-slate-200/80 shadow-xs text-3xl font-bold"
              />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl sm:text-2xl md:text-[26px] font-bold text-slate-900 tracking-tight">
                {doctorName || profile.fullName || affiliations[0]?.doctor_name || "Doctor"}
              </h2>
              <p className="text-sm font-medium text-[#64748B] flex items-center justify-center sm:justify-start gap-2 mt-2">
                <Stethoscope className="w-4 h-4 text-[#64748B] shrink-0" />
                <span>{affiliations.length} Affiliated Clinic{affiliations.length !== 1 ? "s" : ""}</span>
              </p>
              {/* Clinic branch pills */}
              {affiliations.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {affiliations.map((aff) => (
                    <span
                      key={aff.clinic_id}
                      className="inline-flex items-center gap-1 rounded-full bg-sky-50 border border-sky-200 px-2.5 py-0.5 text-xs font-medium text-sky-700"
                    >
                      {aff.clinic?.name || "Clinic"}
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-2 text-xs text-slate-400">
                Select a specific clinic branch from the top switcher to manage that clinic&apos;s profile photo.
              </p>
            </div>
          </div>

          {/* Right: Specialization */}
          <div className="flex items-start gap-3.5 sm:gap-4 md:pl-8 lg:pl-10 md:border-l md:border-slate-200/80 pt-4 md:pt-0 border-t border-slate-100 md:border-t-0 md:max-w-md lg:max-w-lg min-w-0 shrink-0">
            <CaduceusIcon className="w-7 h-7 text-[#5B6B82] shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] sm:text-[14px] font-bold uppercase tracking-wider text-[#64748B]/80 mb-0.5">
                SPECIALIZATION
              </p>
              {nonEmptySpecEntries.length === 0 ? (
                <>
                  <p className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight leading-snug break-words">
                    Not assigned
                  </p>
                  <p className="text-xs text-[#94A3B8] mt-0.5">Assigned by clinic admin</p>
                </>
              ) : allSpecsIdentical ? (
                <>
                  <p className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight leading-snug break-words">
                    {nonEmptySpecEntries[0].display}
                  </p>
                  <p className="text-xs text-[#94A3B8] mt-0.5">Assigned across all affiliated clinics</p>
                </>
              ) : (
                <>
                  <div className="space-y-1 mt-1">
                    {specEntries.map((entry) => (
                      <div key={entry.clinicId} className="text-xs sm:text-sm leading-snug break-words">
                        <span className="font-semibold text-slate-500">{entry.clinicName}: </span>
                        <span className={entry.specs.length > 0 ? "font-bold text-slate-900" : "italic text-slate-400"}>
                          {entry.display}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-[#94A3B8] mt-1">Assigned by clinic admin per branch</p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* PRC / Email / Phone */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5 min-w-0">
        <div className="bg-white rounded-2xl border border-sky-100/80 p-4 sm:p-5.5 shadow-xs flex items-start gap-3.5 sm:gap-4">
          <IdCardIcon className="w-6 h-6 text-[#1D4ED8] shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <span className="text-[14px] font-bold uppercase tracking-wider text-[#64748B]/80 block mb-0.5">PRC LICENSE ID</span>
            {hasPrcConflict ? (
              <>
                <p className="font-bold text-amber-700 text-base sm:text-lg tracking-tight">
                  Requires verification
                </p>
                <div className="mt-1 space-y-0.5">
                  {prcEntries.map((entry) => (
                    <p key={entry.clinicId} className="text-xs text-slate-600 break-words">
                      <span className="font-semibold">{entry.clinicName}:</span>{" "}
                      {entry.cleaned ? `#${entry.cleaned}` : "Not recorded"}
                    </p>
                  ))}
                </div>
              </>
            ) : agreedPrc ? (
              <>
                <p className="font-bold text-slate-900 text-lg sm:text-xl tracking-tight truncate">
                  {agreedPrc}
                </p>
                {missingPrcClinics.length > 0 ? (
                  <p className="text-xs text-amber-600 mt-0.5 break-words">
                    Not recorded in: {missingPrcClinics.join(", ")}
                  </p>
                ) : (
                  <p className="text-sm text-[#94A3B8] mt-0.5">PRC license number on file</p>
                )}
              </>
            ) : (
              <>
                <p className="font-bold text-slate-900 text-lg sm:text-xl tracking-tight truncate">
                  Not provided
                </p>
                <p className="text-sm text-[#94A3B8] mt-0.5">PRC license number on file</p>
              </>
            )}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-sky-100/80 p-4 sm:p-5.5 shadow-xs flex items-start gap-3.5 sm:gap-4">
          <Mail className="w-7 h-6 text-[#1D4ED8] shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <span className="text-[14px] font-bold uppercase tracking-wider text-[#64748B]/80 block mb-0.5">ACCOUNT EMAIL</span>
            <p className="font-bold text-slate-900 text-sm sm:text-[15px] tracking-tight break-all sm:break-normal leading-snug" title={resolvedAccountEmail}>
              {resolvedAccountEmail || "—"}
            </p>
            {differingClinicEmails.length > 0 ? (
              <div className="mt-1 space-y-0.5">
                {differingClinicEmails.map((item) => (
                  <p key={item.clinicId} className="text-xs text-slate-600 break-all">
                    <span className="font-semibold">{item.clinicName}:</span> {item.email}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[#94A3B8] mt-0.5">Registered account email</p>
            )}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-sky-100/80 p-4 sm:p-5.5 shadow-xs flex items-start gap-3.5 sm:gap-4 sm:col-span-2 xl:col-span-1">
          <Phone className="w-6 h-6 text-[#1D4ED8] shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <span className="text-[14px] font-bold uppercase tracking-wider text-[#64748B]/80 block mb-0.5">CONTACT NUMBER</span>
            {hasDifferingPhones ? (
              <div className="space-y-1 mt-0.5">
                {phoneEntries.map((entry) => (
                  <p key={entry.clinicId} className="text-xs sm:text-sm text-slate-700 break-words">
                    <span className="font-semibold text-slate-500">{entry.clinicName}:</span>{" "}
                    <span className={entry.raw ? "font-bold text-slate-900" : "italic text-slate-400"}>
                      {entry.raw || "Not provided"}
                    </span>
                  </p>
                ))}
              </div>
            ) : sharedPhone ? (
              <>
                <p className="font-bold text-slate-900 text-base sm:text-lg tracking-tight truncate">
                  {sharedPhone}
                </p>
                {missingPhoneClinics.length > 0 ? (
                  <p className="text-xs text-amber-600 mt-0.5 break-words">
                    Not recorded in: {missingPhoneClinics.join(", ")}
                  </p>
                ) : (
                  <p className="text-sm text-[#94A3B8] mt-0.5">Official clinic mobile</p>
                )}
              </>
            ) : (
              <>
                <p className="font-bold text-slate-900 text-base sm:text-lg tracking-tight truncate">
                  Not provided
                </p>
                <p className="text-sm text-[#94A3B8] mt-0.5">Official clinic mobile</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Consolidated Duty Schedules — all branches with clinic badges */}
      <ConsolidatedDutyScheduleCard affiliations={affiliations} />

      {/* Disclaimer */}
      <div className="pt-4 border-t border-slate-200/60">
        <p className="text-[12px] text-slate-400 italic">
          * If you have any concerns or need technical assistance, please contact our support teamation.
        </p>
      </div>

      {/* Support channels */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex items-start gap-3.5">
          <Mail className="w-5 h-5 text-slate-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-[14px] font-bold text-slate-400 uppercase tracking-wider">DermAI Support Email</p>
            <p className="font-bold text-slate-900 text-sm mt-0.5">dermaisupport@gmail.com</p>
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

      {/* FAQs */}
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

      {/* Support Ticket */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h2 className="text-base font-bold text-slate-900 uppercase tracking-wider">Submit Doctor Support Ticket</h2>
          <p className="text-sm text-slate-500 mt-0.5">Need technical help or have questions regarding patient triage data?</p>
        </div>
        <form onSubmit={handleSendTicket} className="space-y-3.5 text-xs">
          <div>
            <label className="block text-[14px] font-bold text-slate-400 uppercase tracking-wider mb-1">Subject</label>
            <input
              type="text"
              value={ticketSubject}
              onChange={(e) => { setTicketSubject(e.target.value); setTicketError(null); }}
              placeholder="e.g. Question regarding patient appointment diagnosis"
              className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
            />
          </div>
          <div>
            <label className="block text-[14px] font-bold text-slate-400 uppercase tracking-wider mb-1">Message Details</label>
            <textarea
              rows={3}
              value={ticketMessage}
              onChange={(e) => { setTicketMessage(e.target.value); setTicketError(null); }}
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
              <span role="alert" className="text-sm text-red-600">{ticketError}</span>
            )}
          </div>
        </form>
      </div>

      {/* Submitted Doctor Support Tickets */}
      <MySupportTickets
        userId={sessionUserId || profile.userId}
        doctorId={profile.id}
        portalTheme="doctor"
        title="My support tickets"
        hideWhenEmpty={false}
      />
    </div>
    );
  }

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
              {photoError && (
                <p className="mt-2 text-xs font-semibold text-rose-600">
                  {photoError}
                </p>
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
       If you have any concerns or need technical assistance, please contact our support teamation.
        </p>
      </div>

      {/* Support Contact Channels */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex items-start gap-3.5">
          <Mail className="w-5 h-5 text-slate-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-[14px] font-bold text-slate-400 uppercase tracking-wider">DermAI Support Email</p>
            <p className="font-bold text-slate-900 text-sm mt-0.5">dermaisupport@gmail.com</p>
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
        userId={sessionUserId || profile.userId}
        doctorId={profile.id}
        portalTheme="doctor"
        title="My support tickets"
        hideWhenEmpty={false}
      />
    </div>
  );
}
