import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  User,
  Mail,
  Phone,
  CalendarDays,
  Clock,
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
import { createHelpdeskTicketAsync } from "@/lib/store";

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

function CalendarCardIcon({ className = "w-5 h-5 text-blue-600" }: { className?: string }) {
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
      <rect x="3" y="4" width="18" height="18" rx="2.5" />
      <line x1="16" y1="2" x2="16" y2="6" strokeWidth="2" />
      <line x1="8" y1="2" x2="8" y2="6" strokeWidth="2" />
      <line x1="3" y1="10" x2="21" y2="10" strokeWidth="1.8" />
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
  dutyDays: string[];
  dutySchedule: Record<string, { startTime: string; endTime: string }>;
  clinicName: string;
  photo?: string;
}

const INITIAL_PROFILE: DoctorProfile = {
  fullName: "",
  email: "",
  prcLicense: "",
  specializations: [],
  phone: "",
  dutyDays: [],
  dutySchedule: {},
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
  const [profile, setProfile] = useState<DoctorProfile>(INITIAL_PROFILE);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketMessage, setTicketMessage] = useState("");
  const [ticketSent, setTicketSent] = useState(false);
  const [ticketSubmitting, setTicketSubmitting] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [photoSaved, setPhotoSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const photoUrl = await uploadDoctorPhoto(file);

      const { error } = await supabase
        .from("clinic_doctor")
        .update({ photo_url: photoUrl })
        .eq("doctor_id", profile.id);

      if (error) {
        throw error;
      }

      setProfile((prev) => ({ ...prev, photo: photoUrl }));
      setPhotoSaved(true);
      setTimeout(() => setPhotoSaved(false), 3000);
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
      const { error } = await supabase
        .from("clinic_doctor")
        .update({ photo_url: null })
        .eq("doctor_id", profile.id);

      if (error) {
        throw error;
      }

      setProfile((prev) => ({ ...prev, photo: "" }));

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (err) {
      console.error("Failed to remove doctor photo:", err);
    }
  };

  const loadData = useCallback(async () => {
    try {
      let docFound: any = null;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const sessionUserId = sessionData?.session?.user?.id;

        if (sessionUserId) {
          const { data: docs } = await supabase
            .from("clinic_doctor")
            .select(`
              doctor_id,
              doctor_name,
              email,
              prc_license,
              contact_number,
              duty_days,
              duty_schedule,
              duty_start_time,
              duty_end_time,
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
            .limit(1);

          if (docs && docs.length > 0) {
            docFound = docs[0];
          }
        }
      } catch {
        /* ignore */
      }


      const clinicObj: any = Array.isArray(docFound?.clinic) ? docFound.clinic[0] : docFound?.clinic;

      let parsedDutyDays: string[] = [];

      if (Array.isArray(docFound?.duty_days)) {
        parsedDutyDays = docFound.duty_days
          .map((d: any) => String(d).replace(/["'{}]/g, "").trim())
          .filter(Boolean);
      } else if (typeof docFound?.duty_days === "string" && docFound.duty_days.trim()) {
        const rawDays = docFound.duty_days.trim();

        if (rawDays.startsWith("[") && rawDays.endsWith("]")) {
          try {
            const parsed = JSON.parse(rawDays);
            if (Array.isArray(parsed)) {
              parsedDutyDays = parsed
                .map((d: any) => String(d).replace(/["'{}]/g, "").trim())
                .filter(Boolean);
            }
          } catch {}
        } else {
          parsedDutyDays = rawDays
            .replace(/^\{|\}$/g, "")
            .split(",")
            .map((d: string) => d.replace(/["'\\]/g, "").trim())
            .filter(Boolean);
        }
      }

      const parsedDutySchedule: Record<string, { startTime: string; endTime: string }> = {};

      if (docFound?.duty_schedule) {
        let rawSchedule: any = docFound.duty_schedule;

        if (typeof rawSchedule === "string") {
          try {
            rawSchedule = JSON.parse(rawSchedule);
          } catch {
            rawSchedule = null;
          }
        }

        if (rawSchedule && typeof rawSchedule === "object" && !Array.isArray(rawSchedule)) {
          Object.entries(rawSchedule).forEach(([day, shift]: [string, any]) => {
            if (!shift || typeof shift !== "object") return;

            const startTime = shift.startTime || shift.start_time || shift.start;
            const endTime = shift.endTime || shift.end_time || shift.end;

            if (startTime && endTime) {
              parsedDutySchedule[day] = {
                startTime: String(startTime),
                endTime: String(endTime),
              };
            }
          });
        } else if (Array.isArray(rawSchedule)) {
          rawSchedule.forEach((item: any) => {
            if (!item?.day) return;

            const startTime = item.startTime || item.start_time || item.start;
            const endTime = item.endTime || item.end_time || item.end;

            if (startTime && endTime) {
              parsedDutySchedule[String(item.day)] = {
                startTime: String(startTime),
                endTime: String(endTime),
              };
            }
          });
        }
      }

      if (Object.keys(parsedDutySchedule).length === 0 && docFound?.duty_start_time && docFound?.duty_end_time) {
        parsedDutyDays.forEach((day) => {
          parsedDutySchedule[day] = {
            startTime: String(docFound.duty_start_time),
            endTime: String(docFound.duty_end_time),
          };
        });
      }

      const parsedSpecializations = (docFound?.doctor_specializations || [])
        .map((item: any) => item?.specializations)
        .filter(Boolean)
        .map((spec: any) => String(spec.name || "").trim())
        .filter(Boolean);

      setProfile({
        id: docFound?.doctor_id || "",
        fullName: docFound?.doctor_name || "",
        email: docFound?.email || "",
        prcLicense: docFound?.prc_license || "",
        specializations: parsedSpecializations,
        phone: docFound?.contact_number || "",
        dutyDays: parsedDutyDays,
        dutySchedule: parsedDutySchedule,
        clinicName: clinicObj?.name || "",
        photo: docFound?.photo_url || "",
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


    window.addEventListener("focus", loadData);

    return () => {
      supabase.removeChannel(channel);

      window.removeEventListener("focus", loadData);
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

  return (
    <div className="max-w-6xl space-y-6 pb-12">
      {/* Header */}
      <div className="pb-2 border-b border-slate-200/80">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Help &amp; Clinical Support</h1>
        <p className="text-xs text-slate-500 mt-1">
          Review your doctor profile, browse clinical FAQs, and contact platform support.
        </p>
      </div>

      {/* Doctor Information - Top Banner Card */}
      <div className="bg-white rounded-2xl border border-sky-100/80 p-6 sm:p-7 shadow-xs relative overflow-hidden">
        {/* Subtle decorative faceted gradient accent on the right */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-0 bottom-0 w-80 bg-gradient-to-l from-[#E8F3FD] via-[#F2F8FD]/80 to-transparent opacity-90"
          style={{ clipPath: "polygon(30% 0%, 100% 0%, 100% 100%, 0% 100%)" }}
        />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          {/* Left: Doctor Photo & Primary Info */}
          <div className="flex items-center gap-5 sm:gap-6 min-w-0">
            <div className="relative group shrink-0">
              {profile.photo ? (
                <img
                  src={profile.photo}
                  alt={profile.fullName}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl object-cover border border-slate-100 shadow-xs cursor-pointer hover:opacity-95 transition-opacity"
                />
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center border border-slate-200/80 shadow-xs cursor-pointer hover:bg-slate-200/70 transition-colors"
                >
                  <User className="w-12 h-12 text-slate-400" />
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

            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-2xl sm:text-[26px] font-bold text-slate-900 tracking-tight">
                  {profile.fullName || "Doctor"}
                </h2>

              </div>

              <p className="text-sm font-medium text-[#64748B] flex items-center gap-2 mt-2">
                <Stethoscope className="w-4 h-4 text-[#64748B] shrink-0" />
                <span>{profile.clinicName || "Clinic not assigned"}</span>
              </p>

              {profile.photo && (
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-rose-500 hover:text-rose-600 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                  <span>Remove custom photo</span>
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
          <div className="flex items-center gap-4 lg:pl-10 lg:border-l lg:border-slate-200/80 shrink-0">
            <CaduceusIcon className="w-7 h-7 text-[#5B6B82] shrink-0" />
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]/80 mb-0.5">
                SPECIALIZATION
              </p>
              <p className="text-xl font-bold text-slate-900 tracking-tight">
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card 1: PRC License ID */}
        <div className="bg-white rounded-2xl border border-sky-100/80 p-5 sm:p-5.5 shadow-xs flex items-center gap-3.5 sm:gap-4">
          <IdCardIcon className="w-6 h-6 text-[#1D4ED8] shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]/80 block mb-0.5">
              PRC LICENSE ID
            </span>
            <p className="font-bold text-slate-900 text-lg sm:text-xl tracking-tight truncate">
              {profile.prcLicense
                ? profile.prcLicense.startsWith("#")
                  ? profile.prcLicense
                  : `#${profile.prcLicense}`
                : "Not provided"}
            </p>
            <p className="text-xs text-[#94A3B8] mt-0.5">PRC license number on file</p>
          </div>
        </div>

        {/* Card 2: Clinical Email */}
        <div className="bg-white rounded-2xl border border-sky-100/80 p-5 sm:p-5.5 shadow-xs flex items-center gap-3.5 sm:gap-4">
          <Mail className="w-6 h-6 text-[#1D4ED8] shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]/80 block mb-0.5">
              CLINICAL EMAIL
            </span>
            <p
              className="font-bold text-slate-900 text-sm sm:text-[15px] tracking-tight break-all sm:break-normal leading-snug"
              title={profile.email}
            >
              {profile.email || "—"}
            </p>
            <p className="text-xs text-[#94A3B8] mt-0.5">Roster login address</p>
          </div>
        </div>

        {/* Card 3: Contact Number */}
        <div className="bg-white rounded-2xl border border-sky-100/80 p-5 sm:p-5.5 shadow-xs flex items-center gap-3.5 sm:gap-4">
          <Phone className="w-6 h-6 text-[#1D4ED8] shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]/80 block mb-0.5">
              CONTACT NUMBER
            </span>
            <p className="font-bold text-slate-900 text-base sm:text-lg tracking-tight truncate">
              {profile.phone || "Not provided"}
            </p>
            <p className="text-xs text-[#94A3B8] mt-0.5">Official clinic mobile</p>
          </div>
        </div>
      </div>

      {/* Row 3: Duty Schedule Card (Wide, zero side scroll) */}
      <div className="w-full max-w-4xl">
        <div className="bg-white rounded-2xl border border-sky-100/80 p-6 shadow-xs flex flex-col justify-between">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-50">
            <div className="flex items-center gap-2.5">
              <CalendarCardIcon className="w-5 h-5 text-[#1D4ED8] shrink-0" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#475569]">
                DUTY SCHEDULE
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-[#475569] sm:text-[#5B6B82]">
              <Clock className="w-4 h-4 text-[#1D4ED8]" />
              <span>Clinic Hours</span>
            </div>
          </div>

          {/* Duty Days & Shifts - Wide layout with equal column distribution, no scrollbar */}
          <div className="py-4 w-full">
            {profile.dutyDays && profile.dutyDays.length > 0 ? (
              <div className="flex items-stretch divide-x divide-slate-100 w-full">
                {profile.dutyDays.map((day) => {
                  const sched = profile.dutySchedule[day];
                  const timeRange = sched
                    ? `${sched.startTime} – ${sched.endTime}`
                    : "Time not set";
                  return (
                    <div
                      key={day}
                      className="flex-1 min-w-0 flex flex-col px-3 sm:px-6 first:pl-0 last:pr-0"
                    >
                      <span className="text-xs font-medium text-slate-500 mb-1">{day}</span>
                      <span className="text-sm font-bold text-slate-900 tracking-tight whitespace-nowrap">
                        {timeRange}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-slate-400 italic py-2">
                No scheduled duty days assigned by clinic roster.
              </div>
            )}
          </div>

          {/* Bottom Note inside Duty Card */}
          <div className="flex items-center gap-2 pt-3 border-t border-slate-50 text-xs text-[#94A3B8]">
            <CalendarDays className="w-3.5 h-3.5 text-[#94A3B8]" />
            <span>Assigned clinic roster</span>
          </div>
        </div>
      </div>

      {/* Row 4: Disclaimer Footer */}
      <div className="pt-4 border-t border-slate-200/60">
        <p className="text-[11px] text-slate-400 italic">
          * Medical provider credentials, roster assignments, and clinic affiliations are managed by your clinic administration.
        </p>
      </div>

      {/* Support Contact Channels */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex items-start gap-3.5">
          <Mail className="w-5 h-5 text-slate-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Clinical Support Email</p>
            <p className="font-bold text-slate-900 text-sm mt-0.5">support@dermai.ph</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Direct response within 24 hours on business days</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex items-start gap-3.5">
          <Phone className="w-5 h-5 text-slate-600 shrink-0 mt-0.5" />
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
              onChange={(e) => {
                setTicketSubject(e.target.value);
                setTicketError(null);
              }}
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
              onChange={(e) => {
                setTicketMessage(e.target.value);
                setTicketError(null);
              }}
              placeholder="Describe your inquiry, ticket details, or issue..."
              className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 resize-none"
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={ticketSubmitting || !ticketSubject.trim() || !ticketMessage.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{ticketSubmitting ? "Submitting..." : "Send Inquiry"}</span>
            </button>
            {ticketSent && (
              <span className="text-xs text-emerald-700 font-semibold inline-flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Inquiry submitted successfully!
              </span>
            )}
            {ticketError && (
              <span role="alert" className="text-xs text-red-600">
                {ticketError}
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
