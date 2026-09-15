import React, { type FormEvent, useRef, useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Check,
  ShieldX,
  Upload,
  X,
  ScanSearch,
  Loader2,
  Calendar,
  MapPin,
  Phone,
  Clock,
  Stethoscope,
  CheckCircle2,
  Building2,
  Images,
  Maximize2,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";

type ClinicData = {
  id: string;
  name: string;
  logo?: string;
  address: string;
  phone: string;
  verified: boolean;
  description: string;
  hours: string;
  consultationFee: string;
  doctors: Array<{ name: string; specialization: string }>;
  conditionsTreated: string[];
  photos?: string[];
};

type ConsultationType = "face-to-face";

export default function AppointmentPage({ defaultType: _defaultType }: {
  defaultType?: ConsultationType;
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  const [selectedClinic, setSelectedClinic] = useState<ClinicData | null>(null);
  const [loadingClinic, setLoadingClinic] = useState(true);
  const [showClinicDetailsModal, setShowClinicDetailsModal] = useState(false);
  const [activePhotoIdx, setActivePhotoIdx] = useState<number>(0);
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Patient info fields
  const [patientName, setPatientName] = useState("");
  const [patientEmail, setPatientEmail] = useState(() => user?.email || "");
  const [patientAddress, setPatientAddress] = useState("");
  const [patientContact, setPatientContact] = useState("");
  const [patientGender, setPatientGender] = useState("");
  const [patientBirthdate, setPatientBirthdate] = useState("");
  const [notes, setNotes] = useState("");
  const [questionnaireData, setQuestionnaireData] = useState<any[]>([]);

  // Skin photo upload
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [skinPhotoFile, setSkinPhotoFile] = useState<File | null>(null);
  const [skinPhotoPreview, setSkinPhotoPreview] = useState<string>("");
  const [photoFileName, setPhotoFileName] = useState<string>("");

  // AI analysis result (patient-supplied)
  const [aiConditionName, setAiConditionName] = useState("");
  const [aiConfidence, setAiConfidence] = useState<string>("");
  const [submitted, setSubmitted] = useState(false);

  // Prefill AI condition and questionnaire from URL params or local scan storage
  useEffect(() => {
    const condParam = searchParams.get("condition") || searchParams.get("ai_condition");
    const confParam = searchParams.get("confidence") || searchParams.get("score");
    if (condParam) setAiConditionName(condParam);
    if (confParam) setAiConfidence(confParam);

    try {
      const savedScan = localStorage.getItem("dermai_last_scan");
      if (savedScan) {
        const parsed = JSON.parse(savedScan);
        if (!condParam && parsed.predictedClass) {
          setAiConditionName((prev) => prev || parsed.predictedClass);
        }
        if (!confParam && parsed.confidence) {
          const num = Number(parsed.confidence);
          setAiConfidence((prev) => prev || String(Math.round(num <= 1 ? num * 100 : num)));
        }
        if (Array.isArray(parsed.questionnaire) && parsed.questionnaire.length > 0) {
          setQuestionnaireData(parsed.questionnaire);
        }
      }
    } catch { }
  }, [searchParams]);

  // Fetch approved clinic strictly from database with rich details
  useEffect(() => {
    let cancelled = false;
    async function loadClinic() {
      setLoadingClinic(true);
      const clinicIdFromUrl = searchParams.get("clinic");

      if (!clinicIdFromUrl) {
        setLoadingClinic(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("clinic")
          .select(`
            clinic_id,
            name,
            logo_url,
            district,
            address,
            phone,
            email,
            status,
            description,
            consultation_fee,
            clinic_photo ( photo_url, sort_order ),
            clinic_service_offered ( service_name ),
            clinic_operating_hours ( day_of_week, open_time, close_time ),
            clinic_doctor ( doctor_name, specialization, status )
          `)
          .eq("clinic_id", clinicIdFromUrl)
          .or("status.eq.approved,status.eq.verified")
          .maybeSingle();

        if (!cancelled && !error && data) {
          let hoursStr = "";
          if (Array.isArray(data.clinic_operating_hours) && data.clinic_operating_hours.length > 0) {
            const h = data.clinic_operating_hours[0];
            hoursStr = `${h.day_of_week || ""}: ${h.open_time || ""} - ${h.close_time || ""}`.trim();
          }

          let doctorsList: Array<{ name: string; specialization: string }> = [];
          if (Array.isArray(data.clinic_doctor)) {
            doctorsList = data.clinic_doctor
              .filter((d: any) => d.status !== "inactive" && d.doctor_name)
              .map((d: any) => ({
                name: d.doctor_name,
                specialization: d.specialization || "General Dermatology",
              }));
          }

          let servicesList: string[] = [];
          if (Array.isArray(data.clinic_service_offered)) {
            servicesList = data.clinic_service_offered
              .map((s: any) => (typeof s === "string" ? s : s.service_name))
              .filter(Boolean);
          }

          let photosList: string[] = [];
          if (Array.isArray(data.clinic_photo) && data.clinic_photo.length > 0) {
            photosList = data.clinic_photo
              .map((p: any) => (typeof p === "string" ? p : p?.photo_url))
              .filter(Boolean);
          }

          let logoUrl = data.logo_url || "";
          if (!logoUrl || photosList.length === 0) {
            try {
              const appsRaw = localStorage.getItem("dermai_clinic_applications");
              if (appsRaw) {
                const apps = JSON.parse(appsRaw);
                if (Array.isArray(apps)) {
                  const matched = apps.find((a: any) =>
                    String(a.id) === String(data.clinic_id) ||
                    (a.name && data.name && a.name.toLowerCase().trim() === data.name.toLowerCase().trim())
                  );
                  if (matched?.logo && !logoUrl) logoUrl = matched.logo;
                  if (photosList.length === 0 && Array.isArray(matched?.clinicPhotos)) {
                    photosList = matched.clinicPhotos.filter(Boolean);
                  }
                }
              }
            } catch {}
          }

          setSelectedClinic({
            id: String(data.clinic_id),
            name: data.name || "Clinic",
            logo: logoUrl,
            address: data.address || data.district || "",
            phone: data.phone || "",
            verified: true,
            description: (data.description || "").trim(),
            hours: hoursStr,
            consultationFee: data.consultation_fee ? String(data.consultation_fee) : "500",
            doctors: doctorsList,
            conditionsTreated: servicesList,
            photos: photosList,
          });
        } else if (!cancelled) {
          // Fallback query if nested relation was not available
          const { data: simpleData } = await supabase
            .from("clinic")
            .select("clinic_id, name, logo_url, district, address, phone, status, description, consultation_fee")
            .eq("clinic_id", clinicIdFromUrl)
            .or("status.eq.approved,status.eq.verified")
            .maybeSingle();

          if (simpleData) {
            let logoUrl = simpleData.logo_url || "";
            let photosList: string[] = [];
            try {
              const { data: pRows } = await supabase
                .from("clinic_photo")
                .select("photo_url")
                .eq("clinic_id", clinicIdFromUrl)
                .order("sort_order");
              if (pRows && pRows.length > 0) {
                photosList = pRows.map((p: any) => p.photo_url).filter(Boolean);
              }
            } catch {}

            setSelectedClinic({
              id: String(simpleData.clinic_id),
              name: simpleData.name || "Clinic",
              logo: logoUrl,
              address: simpleData.address || simpleData.district || "",
              phone: simpleData.phone || "",
              verified: true,
              description: (simpleData.description || "").trim(),
              hours: "",
              consultationFee: simpleData.consultation_fee ? String(simpleData.consultation_fee) : "500",
              doctors: [],
              conditionsTreated: [],
              photos: photosList,
            });
          }
        }
      } catch (err) {
        console.error("Error loading clinic for booking:", err);
      } finally {
        if (!cancelled) setLoadingClinic(false);
      }
    }

    loadClinic();
    return () => { cancelled = true; };
  }, [searchParams]);

  // Auto-fill patient information from authenticated session and profile
  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    const userEmail = user.email;
    let cancelled = false;

    async function loadUserProfile() {
      if (userEmail) {
        setPatientEmail((prev) => prev || userEmail || "");
      }
      try {
        const localSaved = localStorage.getItem(`derm_profile_${userId}`);
        if (localSaved) {
          try {
            const parsed = JSON.parse(localSaved);
            if (parsed.fullName) setPatientName((prev) => prev || parsed.fullName);
            if (parsed.contactNumber) setPatientContact((prev) => prev || parsed.contactNumber);
            if (parsed.gender) setPatientGender((prev) => prev || parsed.gender);
            if (parsed.birthdate) setPatientBirthdate((prev) => prev || parsed.birthdate);
            if (parsed.address) setPatientAddress((prev) => prev || parsed.address);
          } catch { }
        }

        const meta = user?.user_metadata || {};
        if (meta.gender) setPatientGender((prev) => prev || meta.gender);
        if (meta.birthdate || meta.birthday) setPatientBirthdate((prev) => prev || meta.birthdate || meta.birthday);

        const { data } = await supabase
          .from("user")
          .select("full_name, phone, gender, birthdate, address")
          .eq("user_id", userId)
          .maybeSingle();

        if (!cancelled && data) {
          if (data.full_name) setPatientName((prev) => prev || data.full_name);
          if (data.phone) setPatientContact((prev) => prev || data.phone);
          if (data.gender) setPatientGender((prev) => prev || data.gender);
          if (data.birthdate) setPatientBirthdate((prev) => prev || data.birthdate);
          if (data.address) setPatientAddress((prev) => prev || data.address);
        }
      } catch (err) {
        console.error("Failed to load user profile:", err);
      }
    }

    loadUserProfile();
    return () => { cancelled = true; };
  }, [user]);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSkinPhotoFile(file);
    setPhotoFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setSkinPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!selectedClinic?.id) {
      setSubmitError("Please select a verified clinic before booking.");
      return;
    }

    // Resolve user ID from auth context or active session
    let activeUserId = user?.id;
    if (!activeUserId) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        activeUserId = session?.user?.id;
      } catch { }
    }

    if (!activeUserId) {
      setSubmitError("You must be logged in to book an appointment. Redirecting to login...");
      setTimeout(() => {
        navigate("/login", { state: { from: window.location.pathname + window.location.search } });
      }, 1200);
      return;
    }

    if (!skinPhotoFile && !skinPhotoPreview) {
      setSubmitError("Please upload a clear photo of your skin condition before submitting.");
      photoInputRef.current?.click();
      return;
    }

    setSubmitting(true);
    try {
      // 1. Upload skin photo to Supabase Storage with graceful fallback
      let photoPath: string | null = null;
      if (skinPhotoFile) {
        try {
          const cleanFileName = skinPhotoFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const filePath = `${activeUserId}/${Date.now()}_${cleanFileName}`;

          const { data: uploadData, error: uploadError } = await supabase.storage
            .from("scan-uploads")
            .upload(filePath, skinPhotoFile, { upsert: true });

          if (!uploadError && uploadData) {
            photoPath = filePath;
          } else {
            console.warn("Storage upload failed, using preview fallback:", uploadError?.message);
            photoPath = skinPhotoPreview || null;
          }
        } catch (upEx) {
          console.warn("Storage upload exception:", upEx);
          photoPath = skinPhotoPreview || null;
        }
      } else if (skinPhotoPreview) {
        photoPath = skinPhotoPreview;
      }

      // 2. Prepare appointment payload
      let targetClinicId: any = selectedClinic.id;
      if (/^\d+$/.test(String(selectedClinic.id))) {
        targetClinicId = Number(selectedClinic.id);
      }

      const confNum = aiConfidence !== "" && !isNaN(Number(aiConfidence)) ? Number(aiConfidence) : null;
      const conditionLabel = aiConditionName.trim() || "General Dermatology Consultation";

      const apptPayload: Record<string, any> = {
        user_id: activeUserId,
        clinic_id: targetClinicId,
        date: null,
        status: "pending",
        patient_name: patientName.trim() || user?.user_metadata?.full_name || "Patient",
        patient_email: patientEmail.trim() || user?.email || null,
        patient_contact: patientContact.trim() || null,
        patient_address: patientAddress.trim() || null,
        patient_gender: patientGender || null,
        patient_birthdate: patientBirthdate || null,
        questionnaire_answers: questionnaireData.length > 0 ? questionnaireData : null,
        notes: notes.trim() || null,
        skin_photo_url: photoPath,
        ai_condition_name: conditionLabel,
        ai_confidence: confNum,
      };

      // 3. Insert appointment request with schema resilience
      let { error: insertError } = await supabase.from("patient_appointment").insert(apptPayload);

      if (insertError) {
        console.warn("Retrying appointment insert with current timestamp date...", insertError.message);
        apptPayload.date = new Date().toISOString();
        const retry1 = await supabase.from("patient_appointment").insert(apptPayload);
        insertError = retry1.error;
      }

      if (insertError) {
        console.warn("Retrying appointment insert with minimal core fields...", insertError.message);
        const corePayload: Record<string, any> = {
          user_id: activeUserId,
          clinic_id: targetClinicId,
          status: "pending",
          patient_name: patientName.trim() || "Patient",
          skin_photo_url: photoPath,
          notes: notes.trim() || null,
        };
        const retry2 = await supabase.from("patient_appointment").insert(corePayload);
        insertError = retry2.error;
      }

      if (insertError) {
        console.error("All appointment insert attempts failed:", insertError.message);
        setSubmitError(`Failed to submit appointment: ${insertError.message}`);
        setSubmitting(false);
        return;
      }

      // 4. Optionally log to ai_scan_result — ONLY if patient actually performed an AI scan
      //    (has a real confidence score > 0 and a specific condition, not a generic consultation)
      const hasRealAiScan =
        confNum !== null &&
        confNum > 0 &&
        aiConditionName.trim() !== "" &&
        !aiConditionName.toLowerCase().includes("consultation") &&
        !aiConditionName.toLowerCase().includes("general");

      if (hasRealAiScan) {
        try {
          await supabase.from("ai_scan_result").insert({
            user_id: activeUserId,
            confidence_score: confNum,
            status: "pending",
            photo_url: photoPath,
            body_part: "Skin",
          });
        } catch (scanErr) {
          console.warn("AI scan result logging skipped:", scanErr);
        }
      }

      // 5. Save to local cache and notify listeners
      try {
        const newLocalAppt = {
          id: `appt-${Date.now()}`,
          clinicId: targetClinicId,
          clinicName: selectedClinic.name || "Skin Clinic",
          patientName: patientName.trim() || user?.user_metadata?.full_name || "Patient",
          patientEmail: patientEmail.trim() || user?.email || "",
          patientContact: patientContact.trim() || "",
          patientAddress: patientAddress.trim() || "",
          date: "",
          time: "",
          status: "pending",
          notes: notes.trim() || "",
          skinPhotoUrl: photoPath,
          aiConditionName: conditionLabel,
          aiConfidence: confNum,
          createdAt: new Date().toISOString(),
        };
        const existing = localStorage.getItem("dermai_clinic_appointments");
        const list = existing ? JSON.parse(existing) : [];
        if (Array.isArray(list)) {
          list.unshift(newLocalAppt);
          localStorage.setItem("dermai_clinic_appointments", JSON.stringify(list));
        }
        window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
        window.dispatchEvent(new Event("appointmentCreated"));
      } catch { }

      setSubmitted(true);
    } catch (err: any) {
      console.error("Submission error:", err);
      setSubmitError(err?.message || "An unexpected error occurred during submission.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingClinic) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-7 h-7 animate-spin text-magenta-500" />
          <p className="text-sm font-medium text-gray-500">Loading clinic details...</p>
        </div>
      </div>
    );
  }

  if (!selectedClinic) {
    const isMissingClinicParam = !searchParams.get("clinic");

    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-white p-8 rounded-3xl shadow-sm text-center border border-gray-100"
        >
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 ${
            isMissingClinicParam ? "bg-magenta-50 text-magenta-600" : "bg-red-50 text-red-500"
          }`}>
            {isMissingClinicParam ? <Building2 className="w-8 h-8" /> : <ShieldX className="w-8 h-8" />}
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            {isMissingClinicParam ? "Select a Clinic First" : "Clinic Not Available"}
          </h1>
          <p className="text-gray-500 mb-6 text-sm leading-relaxed">
            {isMissingClinicParam
              ? "Please choose a verified dermatology clinic to schedule your consultation."
              : "The requested clinic is either not registered or has not been approved yet."}
          </p>
          <div className="space-y-2.5">
            <Link
              to="/dashboard/clinics"
              className="block w-full py-3 bg-magenta-600 text-white rounded-full font-semibold text-sm hover:bg-magenta-700 transition-colors shadow-sm"
            >
              Browse Verified Clinics
            </Link>
            <button
              onClick={() => navigate(-1)}
              className="block w-full py-2.5 text-gray-500 font-medium text-sm hover:text-gray-900 transition-colors"
            >
              Go Back
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-white p-8 rounded-3xl shadow-sm text-center border border-gray-100"
        >
          <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Check className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Request Sent!</h1>
          <p className="text-gray-500 mb-7 text-sm leading-relaxed">
            <strong className="inline-flex items-center gap-1 text-gray-900">{selectedClinic.name} <VerifiedBadge size={15} className="w-3.5 h-3.5" /></strong> will review your request and confirm your appointment schedule soon. You can track its live progress on your dashboard.
          </p>
          <div className="space-y-2.5">
            <Link
              to="/dashboard/appointment-status"
              className="block w-full py-3 bg-magenta-600 text-white rounded-full font-semibold text-sm hover:bg-magenta-700 transition-colors shadow-sm"
            >
              View My Appointments
            </Link>
            <Link
              to="/dashboard"
              className="block w-full py-2.5 text-gray-500 font-medium text-sm hover:text-gray-900 transition-colors"
            >
              Back to Dashboard
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-gray-900 pt-8 pb-20 px-4 font-sans antialiased">
      {/* ── Minimal Clinic Details Modal in Booking Flow ────────── */}
      <AnimatePresence>
        {showClinicDetailsModal && selectedClinic && (
          <motion.div
            key="clinic-booking-detail-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-black/40 backdrop-blur-sm"
            onClick={() => {
              setShowClinicDetailsModal(false);
              setLightboxPhoto(null);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="bg-white rounded-3xl shadow-2xl border border-gray-100 w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden text-left"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between bg-white">
                <div className="flex items-center gap-3.5 min-w-0">
                  {selectedClinic.logo ? (
                    <img
                      src={selectedClinic.logo}
                      alt={selectedClinic.name}
                      className="w-12 h-12 rounded-2xl object-cover border border-magenta-100/80 shadow-xs shrink-0 bg-white"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-magenta-50 to-pink-100/60 border border-magenta-100 flex items-center justify-center shrink-0 text-magenta-600 shadow-xs">
                      <Building2 className="w-6 h-6" />
                    </div>
                  )}
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h2 className="text-lg sm:text-xl font-bold text-gray-900 tracking-tight leading-snug truncate">
                        {selectedClinic.name}
                      </h2>
                      {selectedClinic.verified && (
                        <VerifiedBadge size={18} className="w-4.5 h-4.5 shrink-0" title="Verified Clinic" />
                      )}
                    </div>
                    <span className="text-[11px] font-medium text-gray-400">
                      {selectedClinic.verified ? "Verified Partner Clinic" : "Dermatology Clinic"}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowClinicDetailsModal(false);
                    setLightboxPhoto(null);
                  }}
                  className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer ml-3 shrink-0"
                  title="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                {/* About / Clinic Description */}
                <div>
                  <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                    About This Clinic
                  </h4>
                  <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100 text-xs sm:text-sm text-gray-600 leading-relaxed font-normal">
                    {selectedClinic.description ||
                      "Specialized in advanced dermatological care, comprehensive skin assessments, acne & eczema management, and customized treatment plans tailored to each patient."}
                  </div>
                </div>

                {/* Clinic Photos / Facilities Gallery (Up to 5 Photos) */}
                {selectedClinic.photos && selectedClinic.photos.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Images className="w-3.5 h-3.5 text-magenta-500" />
                        Clinic Facilities &amp; Gallery
                      </h4>
                      <span className="text-[10px] font-bold text-magenta-600 bg-magenta-50 px-2 py-0.5 rounded-full border border-magenta-100">
                        {selectedClinic.photos.length} {selectedClinic.photos.length === 1 ? "Photo" : "Photos"}
                      </span>
                    </div>

                    {/* Featured Main Photo Preview */}
                    <div className="relative group rounded-2xl overflow-hidden border border-magenta-100/80 bg-gray-900 shadow-sm">
                      <img
                        src={selectedClinic.photos[Math.min(activePhotoIdx, selectedClinic.photos.length - 1)]}
                        alt={`${selectedClinic.name} facility`}
                        className="w-full h-44 sm:h-48 object-cover transition-transform duration-300 group-hover:scale-[1.02] cursor-pointer"
                        onClick={() => setLightboxPhoto(selectedClinic.photos![Math.min(activePhotoIdx, selectedClinic.photos!.length - 1)])}
                      />
                      {/* Click to Enlarge Hover Tag */}
                      <div
                        onClick={() => setLightboxPhoto(selectedClinic.photos![Math.min(activePhotoIdx, selectedClinic.photos!.length - 1)])}
                        className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer pointer-events-auto"
                      >
                        <div className="px-3 py-1.5 rounded-full bg-white/95 backdrop-blur-md text-gray-900 text-xs font-bold flex items-center gap-1.5 shadow-lg">
                          <Maximize2 className="w-3.5 h-3.5 text-magenta-600" />
                          <span>Click to Enlarge</span>
                        </div>
                      </div>

                      {/* Photo Index Counter */}
                      <div className="absolute bottom-2.5 right-2.5 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-md text-white text-[11px] font-medium pointer-events-none">
                        {Math.min(activePhotoIdx + 1, selectedClinic.photos.length)} / {selectedClinic.photos.length}
                      </div>
                    </div>

                    {/* Thumbnail Strip (if more than 1 photo) */}
                    {selectedClinic.photos.length > 1 && (
                      <div className="flex items-center gap-2 mt-2.5 overflow-x-auto pb-1">
                        {selectedClinic.photos.map((imgUrl, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setActivePhotoIdx(idx)}
                            className={`relative w-14 h-14 rounded-xl overflow-hidden shrink-0 border-2 transition-all cursor-pointer ${
                              activePhotoIdx === idx
                                ? "border-magenta-500 ring-2 ring-magenta-500/30 scale-105 shadow-sm"
                                : "border-gray-200 opacity-60 hover:opacity-100 hover:border-magenta-300"
                            }`}
                          >
                            <img
                              src={imgUrl}
                              alt={`Thumbnail ${idx + 1}`}
                              className="w-full h-full object-cover"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Contact & Hours Info Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-100 flex items-start gap-2.5">
                    <MapPin className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Address</p>
                      <p className="text-xs font-medium text-gray-800 mt-0.5 truncate-2-lines">
                        {selectedClinic.address || "Cebu City, Philippines"}
                      </p>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-100 flex items-start gap-2.5">
                    <Clock className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Hours</p>
                      <p className="text-xs font-medium text-gray-800 mt-0.5">
                        {selectedClinic.hours || "Mon - Sat: 8:00 AM - 5:00 PM"}
                      </p>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-100 flex items-start gap-2.5">
                    <Phone className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Contact</p>
                      <p className="text-xs font-medium text-gray-800 mt-0.5">
                        {selectedClinic.phone || "Available upon booking"}
                      </p>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-100 flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Consultation Fee</p>
                      <p className="text-xs font-bold text-gray-900 mt-0.5">
                        {selectedClinic.consultationFee && !isNaN(Number(selectedClinic.consultationFee)) && Number(selectedClinic.consultationFee) > 0
                          ? `Starts at ₱${Number(selectedClinic.consultationFee).toLocaleString()}`
                          : selectedClinic.consultationFee
                            ? `Starts at ₱${selectedClinic.consultationFee}`
                            : "Starts at ₱500"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Attending Doctors */}
                {selectedClinic.doctors && selectedClinic.doctors.length > 0 && (
                  <div>
                    <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                      Attending Dermatologists
                    </h4>
                    <div className="space-y-2">
                      {selectedClinic.doctors.map((doc, idx) => (
                        <div key={idx} className="flex items-center gap-3 p-3 rounded-2xl bg-gray-50 border border-gray-100">
                          <div className="w-8 h-8 rounded-xl bg-white border border-gray-200 text-gray-700 flex items-center justify-center shrink-0">
                            <Stethoscope className="w-4 h-4 text-magenta-600" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-gray-900 truncate">{doc.name}</p>
                            <p className="text-[11px] text-gray-500 truncate">{doc.specialization}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Services / Conditions */}
                {selectedClinic.conditionsTreated && selectedClinic.conditionsTreated.length > 0 && (
                  <div>
                    <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                      Services &amp; Specializations
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedClinic.conditionsTreated.map((srv, idx) => (
                        <span
                          key={idx}
                          className="px-3 py-1 rounded-full bg-gray-50 text-gray-700 text-xs font-medium border border-gray-200/70"
                        >
                          {srv}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Close Button */}
              <div className="p-4 sm:p-5 bg-white border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowClinicDetailsModal(false);
                    setLightboxPhoto(null);
                  }}
                  className="w-full py-2.5 rounded-full bg-gray-900 hover:bg-black text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Fullscreen Photo Lightbox Modal in Appointment Booking ── */}
      <AnimatePresence>
        {lightboxPhoto && (
          <motion.div
            key="booking-lightbox"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-md"
            onClick={() => setLightboxPhoto(null)}
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="relative max-w-3xl max-h-[90vh] w-full flex flex-col items-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative w-full flex justify-center">
                <img
                  src={lightboxPhoto}
                  alt="Clinic facility enlarged preview"
                  className="max-w-full max-h-[82vh] rounded-3xl object-contain shadow-2xl border border-white/20"
                />
                <button
                  type="button"
                  onClick={() => setLightboxPhoto(null)}
                  className="absolute -top-3 -right-3 sm:top-3 sm:right-3 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white backdrop-blur-md border border-white/20 transition-all cursor-pointer shadow-lg"
                  title="Close image preview"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-2xl mx-auto">
        {/* Top Back Navigation */}
        <div className="mb-6 flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 text-xs font-semibold text-gray-500 hover:text-gray-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-50"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Clinics
          </button>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key="appointment-form"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="space-y-6"
          >
            <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-100 shadow-sm">
              <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Book Consultation</h1>
                <p className="text-sm text-gray-500 mt-1 flex items-center gap-1 flex-wrap">
                  <span>Submit your details to request an appointment with</span>
                  <span className="font-semibold text-gray-800 inline-flex items-center gap-1">
                    {selectedClinic.name}
                    {selectedClinic.verified && <VerifiedBadge size={16} className="w-4 h-4" />}
                  </span>
                </p>
              </div>

              {submitError && (
                <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2.5">
                  <ShieldX className="w-4 h-4 shrink-0 text-red-500" />
                  <span>{submitError}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-6 text-left">
                {/* Clinic Summary Card */}
                <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-0.5">
                      Selected Clinic
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-bold text-gray-900">{selectedClinic.name}</p>
                      {selectedClinic.verified && (
                        <VerifiedBadge size={16} className="w-4 h-4" title="Verified Clinic" />
                      )}
                    </div>
                    {selectedClinic.address && (
                      <p className="text-xs text-gray-500 mt-0.5">{selectedClinic.address}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 sm:justify-end shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowClinicDetailsModal(true)}
                      className="px-3 py-1.5 rounded-full text-xs font-semibold bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors shadow-xs cursor-pointer"
                    >
                      View Details
                    </button>
                    <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-white border border-gray-200 text-gray-800 shadow-xs">
                      Face-to-Face
                    </span>
                  </div>
                </div>

                {/* Patient Contact Info */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      Full Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={patientName}
                      onChange={(e) => setPatientName(e.target.value)}
                      placeholder="e.g. Maria Santos"
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      Email Address <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      value={patientEmail}
                      onChange={(e) => setPatientEmail(e.target.value)}
                      placeholder="e.g. maria@example.com"
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all bg-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      Contact Number <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="tel"
                      required
                      value={patientContact}
                      onChange={(e) => setPatientContact(e.target.value)}
                      placeholder="09xx xxx xxxx"
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      City / Address <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={patientAddress}
                      onChange={(e) => setPatientAddress(e.target.value)}
                      placeholder="e.g. Cebu City"
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all bg-white"
                    />
                  </div>
                </div>

                {/* Patient Demographics: Gender & Birthdate */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      Gender <span className="text-red-500">*</span>
                    </label>
                    <select
                      required
                      value={patientGender}
                      onChange={(e) => setPatientGender(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all bg-white"
                    >
                      <option value="">Select Gender</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                      <option value="Prefer not to say">Prefer not to say</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      Birthdate <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={patientBirthdate}
                      onChange={(e) => setPatientBirthdate(e.target.value)}
                      max={new Date().toISOString().split("T")[0]}
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all bg-white"
                    />
                  </div>
                </div>

                {/* Clinic-Managed Notice */}
                <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100 flex items-start gap-3 text-xs text-gray-600">
                  <Calendar className="w-4 h-4 text-magenta-500 mt-0.5 shrink-0" />
                  <p className="leading-relaxed">
                    Your appointment date, time, and assigned dermatologist will be confirmed by <strong className="inline-flex items-center gap-1 text-gray-900">{selectedClinic.name} <VerifiedBadge size={13} className="w-3.5 h-3.5" /></strong> based on doctor availability.
                  </p>
                </div>

                {/* Skin Photo Upload */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                    Skin Photo <span className="text-red-500">*</span>
                  </label>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handlePhotoChange}
                  />
                  {skinPhotoPreview ? (
                    <div className="relative rounded-2xl overflow-hidden border border-gray-200 bg-gray-50">
                      <img src={skinPhotoPreview} alt="Skin condition" className="w-full max-h-48 object-cover" />
                      <button
                        type="button"
                        onClick={() => {
                          setSkinPhotoPreview("");
                          setSkinPhotoFile(null);
                          setPhotoFileName("");
                          if (photoInputRef.current) photoInputRef.current.value = "";
                        }}
                        className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <p className="text-xs text-gray-500 font-medium px-4 py-2 border-t border-gray-100 bg-white truncate">
                        {photoFileName}
                      </p>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => photoInputRef.current?.click()}
                      className="w-full flex flex-col items-center justify-center gap-1.5 py-6 rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 hover:bg-gray-50 hover:border-gray-300 transition-all text-center group"
                    >
                      <Upload className="w-5 h-5 text-gray-400 group-hover:text-magenta-500 transition-colors" />
                      <span className="text-xs font-semibold text-gray-700">Click to upload skin photo</span>
                      <span className="text-[11px] text-gray-400">JPG or PNG (Clear photo of affected area)</span>
                    </button>
                  )}
                </div>

                {/* AI Analysis Result */}
                <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-4 sm:p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <ScanSearch className="w-4 h-4 text-magenta-500" />
                    <p className="text-xs font-bold text-gray-900 uppercase tracking-wider">AI Scan Result Details <span className="text-gray-400 font-normal lowercase">(optional)</span></p>
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed -mt-1">
                    Provide your DermAI skin prediction so the clinic's doctor can pre-evaluate your condition.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1">Detected Condition</label>
                      <input
                        type="text"
                        value={aiConditionName}
                        onChange={(e) => setAiConditionName(e.target.value)}
                        placeholder="e.g. Atopic Dermatitis or General Skin Concern"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 text-gray-900 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1">Confidence Score (%)</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={aiConfidence}
                        onChange={(e) => setAiConfidence(e.target.value)}
                        placeholder="e.g. 92"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 text-gray-900 text-xs"
                      />
                    </div>
                  </div>
                </div>

                {/* Additional Notes */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                    Additional Medical Notes <span className="text-gray-400 font-normal">(Optional)</span>
                  </label>
                  <textarea
                    placeholder="Briefly describe your symptoms, duration, or any specific concerns..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 text-gray-900 placeholder:text-gray-400 text-sm resize-none bg-white"
                  />
                </div>

                {/* Submit Error Banner (Above Button) */}
                {submitError && (
                  <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2.5 animate-in fade-in">
                    <ShieldX className="w-4 h-4 shrink-0 text-red-500" />
                    <span>{submitError}</span>
                  </div>
                )}

                {/* Submit Button */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-3.5 bg-magenta-600 text-white rounded-full font-semibold text-sm shadow-sm hover:bg-magenta-700 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Submitting Appointment Request...
                      </>
                    ) : (
                      "Submit Appointment Request"
                    )}
                  </button>
                  <p className="text-center text-[11px] text-gray-400 mt-2.5">
                    No upfront payment required. The clinic will confirm your schedule.
                  </p>
                </div>
              </form>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
