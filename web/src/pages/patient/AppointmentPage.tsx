import { type FormEvent, useRef, useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Check, ShieldX, Upload, X, ScanSearch, Loader2, Calendar } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";

type ClinicData = {
  id: string;
  name: string;
  address: string;
  phone: string;
  verified: boolean;
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
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Patient info fields
  const [patientName, setPatientName] = useState("");
  const [patientEmail, setPatientEmail] = useState(() => user?.email || "");
  const [patientAddress, setPatientAddress] = useState("");
  const [patientContact, setPatientContact] = useState("");
  const [notes, setNotes] = useState("");

  // Skin photo upload
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [skinPhotoFile, setSkinPhotoFile] = useState<File | null>(null);
  const [skinPhotoPreview, setSkinPhotoPreview] = useState<string>("");
  const [photoFileName, setPhotoFileName] = useState<string>("");

  // AI analysis result (patient-supplied)
  const [aiConditionName, setAiConditionName] = useState("");
  const [aiConfidence, setAiConfidence] = useState<string>("");
  const [submitted, setSubmitted] = useState(false);

  // Fetch approved clinic strictly from database
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
          .select("clinic_id, name, district, address, phone, status")
          .eq("clinic_id", clinicIdFromUrl)
          .eq("status", "approved")
          .maybeSingle();

        if (!cancelled && !error && data) {
          setSelectedClinic({
            id: data.clinic_id,
            name: data.name,
            address: data.address || data.district || "",
            phone: data.phone || "",
            verified: true,
          });
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
        const { data } = await supabase
          .from("user")
          .select("full_name, phone")
          .eq("user_id", userId)
          .maybeSingle();

        if (!cancelled && data) {
          if (data.full_name) setPatientName((prev) => prev || data.full_name);
          if (data.phone) setPatientContact((prev) => prev || data.phone);
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

    if (!user?.id) {
      setSubmitError("You must be logged in to book an appointment.");
      return;
    }

    if (!skinPhotoFile) {
      alert("Please upload a photo of your skin condition before submitting.");
      photoInputRef.current?.click();
      return;
    }

    setSubmitting(true);
    try {
      // 1. Upload skin photo to Supabase Storage (private bucket `scan-uploads`)
      const cleanFileName = skinPhotoFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = `${user.id}/${Date.now()}_${cleanFileName}`;

      const { error: uploadError } = await supabase.storage
        .from("scan-uploads")
        .upload(filePath, skinPhotoFile, { upsert: false });

      if (uploadError) {
        console.error("Photo upload failed:", uploadError.message);
        setSubmitError("Failed to upload skin photo. Please try again.");
        setSubmitting(false);
        return;
      }

      // 2. Insert appointment request into patient_appointment table with pending status
      // Note: Only the clinic assigns the consultation date & time from their scheduling calendar.
      const { error: insertError } = await supabase.from("patient_appointment").insert({
        user_id: user.id,
        clinic_id: selectedClinic.id,
        date: null,
        status: "pending",
        patient_name: patientName.trim() || null,
        patient_email: patientEmail.trim() || null,
        patient_contact: patientContact.trim() || null,
        patient_address: patientAddress.trim() || null,
        notes: notes.trim() || null,
        skin_photo_url: filePath,
        ai_condition_name: aiConditionName.trim() || null,
        ai_confidence: aiConfidence !== "" ? Number(aiConfidence) : null,
      });

      if (insertError) {
        console.error("Appointment insert failed:", insertError.message);
        setSubmitError("Failed to submit appointment. Please try again.");
        setSubmitting(false);
        return;
      }

      // 3. Log scan record to ai_scan_result
      await supabase.from("ai_scan_result").insert({
        user_id: user.id,
        confidence_score: aiConfidence !== "" ? Number(aiConfidence) : 0,
        status: "pending",
        photo_url: filePath,
      });

      setSubmitted(true);
    } catch (err: any) {
      console.error("Submission error:", err);
      setSubmitError(err?.message || "An unexpected error occurred.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingClinic) {
    return (
      <div className="min-h-screen bg-magenta-50 flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-magenta-500" />
          <p className="text-sm font-semibold text-magenta-700">Loading clinic details...</p>
        </div>
      </div>
    );
  }

  if (!selectedClinic) {
    return (
      <div className="min-h-screen bg-magenta-50 flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-white p-8 rounded-[32px] shadow-xl text-center border border-magenta-100"
        >
          <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <ShieldX className="w-10 h-10 text-red-400" />
          </div>
          <h1 className="text-xl font-bold text-magenta-900 mb-2">Clinic Not Available</h1>
          <p className="text-magenta-600 mb-6 text-sm">
            The requested clinic is either not registered or has not been approved yet.
          </p>
          <div className="space-y-3">
            <Link to="/clinics" className="block w-full py-3 bg-magenta-500 text-white rounded-full font-semibold">
              Browse Verified Clinics
            </Link>
            <button onClick={() => navigate(-1)} className="block w-full py-3 text-magenta-500 font-medium text-sm">
              Go Back
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-magenta-50 flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-white p-8 rounded-[32px] shadow-xl text-center border border-magenta-100"
        >
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Check className="w-10 h-10 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-magenta-900 mb-2">Request Sent!</h1>
          <p className="text-magenta-600 mb-8">
            The clinic will review your request and confirm your appointment schedule soon. You can track its progress on your dashboard.
          </p>
          <div className="space-y-3">
            <Link to="/patient/appointments" className="block w-full py-3 bg-magenta-500 text-white rounded-full font-semibold">
              View Appointments
            </Link>
            <Link to="/patient/dashboard" className="block w-full py-3 text-magenta-500 font-medium text-sm">
              Go to Dashboard
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-magenta-50 pt-10 pb-20 px-4 font-sans">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8 flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-magenta-500 font-medium font-sans"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key="appointment-form"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            <div className="bg-white p-8 rounded-[32px] border border-magenta-100 shadow-[0_12px_48px_rgba(160,25,90,0.05)]">
              <h2 className="text-2xl font-bold text-magenta-900 mb-1">Book Consultation</h2>
              <p className="text-magenta-500 mb-8 font-medium">
                Please fill in your details to request an appointment with {selectedClinic.name}
              </p>

              {submitError && (
                <div className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-3">
                  <ShieldX className="w-5 h-5 flex-shrink-0 text-red-500" />
                  <span>{submitError}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-6 text-left">
                <div className="p-5 rounded-2xl bg-magenta-50 border border-magenta-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] font-bold text-magenta-400 uppercase tracking-widest mb-1">Dermatology Clinic</p>
                    <p className="font-bold text-magenta-900">{selectedClinic.name}</p>
                    {selectedClinic.address && (
                      <p className="text-xs text-magenta-600 mt-0.5">{selectedClinic.address}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-magenta-400 uppercase tracking-widest mb-2">Consultation Mode</p>
                    <span className="px-4 py-2 rounded-full text-xs font-bold border bg-magenta-500 text-white border-magenta-500">
                      Face to Face
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-magenta-900 mb-2">Name *</label>
                    <input
                      type="text"
                      required
                      value={patientName}
                      onChange={(e) => setPatientName(e.target.value)}
                      placeholder="Your full name"
                      className="w-full px-5 py-3 rounded-xl border border-magenta-100 focus:outline-none focus:ring-2 focus:ring-magenta-500/20"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-magenta-900 mb-2">Email *</label>
                    <input
                      type="email"
                      required
                      value={patientEmail}
                      onChange={(e) => setPatientEmail(e.target.value)}
                      placeholder="your@email.com"
                      className="w-full px-5 py-3 rounded-xl border border-magenta-100 focus:outline-none focus:ring-2 focus:ring-magenta-500/20"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-magenta-900 mb-2">Address *</label>
                    <input
                      type="text"
                      required
                      value={patientAddress}
                      onChange={(e) => setPatientAddress(e.target.value)}
                      placeholder="Current address"
                      className="w-full px-5 py-3 rounded-xl border border-magenta-100 focus:outline-none focus:ring-2 focus:ring-magenta-500/20"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-magenta-900 mb-2">Contact Number *</label>
                    <input
                      type="tel"
                      required
                      value={patientContact}
                      onChange={(e) => setPatientContact(e.target.value)}
                      placeholder="09xx xxx xxxx"
                      className="w-full px-5 py-3 rounded-xl border border-magenta-100 focus:outline-none focus:ring-2 focus:ring-magenta-500/20"
                    />
                  </div>
                </div>

                {/* Clinic-Managed Scheduling Notice */}
                <div className="p-4 rounded-2xl bg-magenta-50/60 border border-magenta-100 flex items-start gap-3 text-xs text-magenta-800">
                  <Calendar className="w-5 h-5 text-magenta-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-bold text-magenta-900 mb-0.5">Clinic-Managed Scheduling</p>
                    <p className="text-magenta-600 leading-relaxed">
                      Your consultation date, time, and assigned dermatologist will be scheduled by <strong>{selectedClinic.name}</strong> based on doctor availability. You will receive an update once confirmed.
                    </p>
                  </div>
                </div>

                {/* Skin Photo Upload */}
                <div>
                  <label className="block text-sm font-bold text-magenta-900 mb-2">
                    Upload Photo of Skin Condition <span className="text-red-500 font-semibold">*</span>
                  </label>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handlePhotoChange}
                  />
                  {skinPhotoPreview ? (
                    <div className="relative rounded-2xl overflow-hidden border border-magenta-100">
                      <img src={skinPhotoPreview} alt="Skin condition" className="w-full max-h-52 object-cover" />
                      <button
                        type="button"
                        onClick={() => {
                          setSkinPhotoPreview("");
                          setSkinPhotoFile(null);
                          setPhotoFileName("");
                          if (photoInputRef.current) photoInputRef.current.value = "";
                        }}
                        className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 flex items-center justify-center shadow hover:bg-white"
                      >
                        <X className="w-4 h-4 text-gray-600" />
                      </button>
                      <p className="text-xs text-magenta-500 font-medium px-4 py-2 bg-magenta-50/80">{photoFileName}</p>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => photoInputRef.current?.click()}
                      className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-2xl border-2 border-dashed border-magenta-200 bg-magenta-50/40 hover:bg-magenta-50 hover:border-magenta-400 transition-all"
                    >
                      <Upload className="w-7 h-7 text-magenta-400" />
                      <span className="text-sm font-semibold text-magenta-600">Click to upload photo</span>
                      <span className="text-xs text-magenta-400">JPG, PNG, or HEIC</span>
                    </button>
                  )}
                </div>

                {/* AI Analysis Result */}
                <div className="rounded-2xl border border-magenta-100 bg-magenta-50/40 p-5 space-y-4">
                  <div className="flex items-center gap-2 mb-1">
                    <ScanSearch className="w-5 h-5 text-magenta-500" />
                    <p className="text-sm font-bold text-magenta-900">AI Skin Analysis Result <span className="text-red-500">*</span></p>
                  </div>
                  <p className="text-xs text-magenta-500 -mt-2">
                    Enter your DermAI scan result. This is required so the clinic can review your condition before the appointment.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-magenta-400 uppercase tracking-widest mb-2">Detected Condition</label>
                      <input
                        type="text"
                        required
                        value={aiConditionName}
                        onChange={(e) => setAiConditionName(e.target.value)}
                        placeholder="e.g. Acne Vulgaris"
                        className="w-full px-4 py-3 rounded-xl border border-magenta-100 bg-white focus:outline-none focus:ring-2 focus:ring-magenta-500/20 text-magenta-900 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-magenta-400 uppercase tracking-widest mb-2">Confidence %</label>
                      <input
                        type="number"
                        required
                        min={0}
                        max={100}
                        value={aiConfidence}
                        onChange={(e) => setAiConfidence(e.target.value)}
                        placeholder="e.g. 87"
                        className="w-full px-4 py-3 rounded-xl border border-magenta-100 bg-white focus:outline-none focus:ring-2 focus:ring-magenta-500/20 text-magenta-900 text-sm"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-magenta-900 mb-2">Additional Notes</label>
                  <textarea
                    placeholder="e.g. Symptoms duration, specific doctor request, etc."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-5 py-4 rounded-2xl border border-magenta-100 focus:outline-none focus:ring-4 focus:ring-magenta-500/5 min-h-[140px] text-magenta-900 placeholder:text-magenta-300"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-5 bg-magenta-500 text-white rounded-full font-bold shadow-xl shadow-magenta-500/20 hover:bg-magenta-600 transition-all transform hover:scale-[1.01] active:scale-95 text-lg disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Submitting Request...
                    </>
                  ) : (
                    "Send Appointment Request"
                  )}
                </button>
                <p className="text-center text-xs text-magenta-400 font-medium">
                  The clinic will reply with a confirmed date and time.
                </p>
              </form>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
