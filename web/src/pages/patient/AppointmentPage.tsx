import { type FormEvent, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Check, ShieldX, Upload, X, ScanSearch } from "lucide-react";
const normalizeClinicName = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
const isClinicNameMatch = (a: string, b: string) => {
    const na = normalizeClinicName(a);
    const nb = normalizeClinicName(b);
    return na === nb || na.includes(nb) || nb.includes(na);
};
// TODO: Load clinic listings from Supabase (shared with FindClinicsPage)
const clinicsData: Array<{
    id: number;
    name: string;
    address: string;
    phone: string;
    verified: boolean;
    doctors: Array<{ name: string; specialization: string }>;
}> = [];
type ConsultationType = "face-to-face";
type AppointmentRecord = {
    id: string;
    clinicId: number;
    clinicName: string;
    consultationType: ConsultationType;
    conditionId?: string;
    conditionName?: string;
    notes: string;
    patientName: string;
    patientEmail: string;
    patientAddress: string;
    patientContact: string;
    status: "pending" | "scheduled" | "rejected";
    createdAt: string;
    skinPhotoUrl?: string;
    aiConditionName?: string;
    aiConfidence?: number;
};
export default function AppointmentPage({ defaultType: _defaultType }: {
    defaultType?: ConsultationType;
}) {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const consultationType: ConsultationType = "face-to-face";
    const [selectedClinicId] = useState<number>(() =>
        searchParams.get("clinic") ? Number(searchParams.get("clinic")) : 1
    );
    // TODO: Load clinic verification status from Supabase
    const adminApplications = useMemo<{
        id: number;
        name: string;
        status: string;
    }[]>(() => [], []);
    const clinicsWithVerification = useMemo(() => clinicsData.map((clinic) => {
        const match = adminApplications.find((app) => isClinicNameMatch(app.name, clinic.name));
        if (!match)
            return clinic;
        return { ...clinic, verified: match.status === "verified" };
    }), [adminApplications]);
    const [notes, setNotes] = useState("");
    // Patient info fields
    const [patientName, setPatientName] = useState("");
    const [patientEmail, setPatientEmail] = useState("");
    const [patientAddress, setPatientAddress] = useState("");
    const [patientContact, setPatientContact] = useState("");
    // Skin photo upload
    const photoInputRef = useRef<HTMLInputElement>(null);
    const [skinPhotoUrl, setSkinPhotoUrl] = useState<string>("");
    const [photoFileName, setPhotoFileName] = useState<string>("");
    // AI analysis result (patient-supplied)
    const [aiConditionName, setAiConditionName] = useState("");
    const [aiConfidence, setAiConfidence] = useState<string>("");
    const [submitted, setSubmitted] = useState(false);
    // Fallback: if clinic not found in local data (e.g. data not yet loaded from Supabase),
    // create a placeholder so the form always renders.
    const foundClinic = useMemo(() => clinicsWithVerification.find((c) => c.id === (selectedClinicId || 1)), [selectedClinicId, clinicsWithVerification]);
    const selectedClinic = foundClinic ?? {
        id: selectedClinicId || 1,
        name: searchParams.get("clinicName") || "Selected Clinic",
        address: "",
        phone: "",
        verified: true,
        doctors: [],
    };
    // TODO: Auto-fill patient info from Supabase auth session
    const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file)
            return;
        setPhotoFileName(file.name);
        const reader = new FileReader();
        reader.onload = (ev) => setSkinPhotoUrl(ev.target?.result as string);
        reader.readAsDataURL(file);
    };
    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        const currentClinicId = selectedClinicId || 1;
        if (!currentClinicId || !consultationType)
            return;
        if (!skinPhotoUrl) {
            alert("Please upload a photo of your skin condition before submitting.");
            photoInputRef.current?.click();
            return;
        }
        const newRecord: AppointmentRecord = {
            id: "appt-" + Date.now(),
            clinicId: currentClinicId,
            clinicName: selectedClinic?.name || "Clinic",
            consultationType: consultationType,
            notes,
            patientName,
            patientEmail,
            patientAddress,
            patientContact,
            status: "pending",
            createdAt: new Date().toISOString(),
            ...(skinPhotoUrl ? { skinPhotoUrl } : {}),
            ...(aiConditionName.trim() ? { aiConditionName: aiConditionName.trim() } : {}),
            ...(aiConfidence !== "" ? { aiConfidence: Number(aiConfidence) } : {}),
        };
        // TODO: Submit appointment to Supabase
        void newRecord;
        setSubmitted(true);
    };
    // Guard: if selectedClinic is not verified, show blocked state
    // Only block if the clinic was actually found in the list AND is not verified.
    // When clinicsData is empty (not yet loaded from Supabase), always allow the form.
    if (foundClinic && !foundClinic.verified) {
        return (<div className="min-h-screen bg-magenta-50 flex items-center justify-center px-4">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md w-full bg-white p-8 rounded-[32px] shadow-xl text-center border border-magenta-100">
          <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <ShieldX className="w-10 h-10 text-red-400"/>
          </div>
          <h1 className="text-xl font-bold text-magenta-900 mb-2">Clinic Not Available</h1>
          <p className="text-magenta-500 mb-2">
            <span className="font-semibold text-magenta-700">{selectedClinic.name}</span> is not yet
            verified and cannot accept appointments at this time.
          </p>
          <p className="text-sm text-gray-400 mb-8">
            Please choose a verified dermatology clinic from our directory.
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
      </div>);
    }
    if (submitted) {
        return (<div className="min-h-screen bg-magenta-50 flex items-center justify-center px-4">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md w-full bg-white p-8 rounded-[32px] shadow-xl text-center border border-magenta-100">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Check className="w-10 h-10 text-green-600"/>
          </div>
          <h1 className="text-2xl font-bold text-magenta-900 mb-2">Request Sent!</h1>
          <p className="text-magenta-600 mb-8">The clinic will review your request and assign a schedule soon. You'll be notified via the dashboard.</p>
          <div className="space-y-3">
             <Link to="/dashboard" className="block w-full py-3 bg-magenta-500 text-white rounded-full font-semibold">Go to Dashboard</Link>
             <Link to="/" className="block w-full py-3 text-magenta-500 font-medium text-sm">Return Home</Link>
          </div>
        </motion.div>
      </div>);
    }
    return (<div className="min-h-screen bg-magenta-50 pt-10 pb-20 px-4 font-sans">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8 flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-magenta-500 font-medium font-sans">
            <ArrowLeft className="w-4 h-4"/> Back
          </button>
        </div>

        <AnimatePresence mode="wait">
          <motion.div key="appointment-form" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-6">
              <div className="bg-white p-8 rounded-[32px] border border-magenta-100 shadow-[0_12px_48_rgba(160,25,90,0.05)]">
                <h2 className="text-2xl font-bold text-magenta-900 mb-1">Enter Appointment Information</h2>
                <p className="text-magenta-500 mb-8 font-medium">Please fill in your details to book with {selectedClinic.name}</p>
                
                <form onSubmit={handleSubmit} className="space-y-6 text-left">
                  <div className="p-5 rounded-2xl bg-magenta-50 border border-magenta-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] font-bold text-magenta-400 uppercase tracking-widest mb-1">Dermatology Clinic</p>
                      <p className="font-bold text-magenta-900">{selectedClinic.name}</p>
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
                      <label className="block text-sm font-bold text-magenta-900 mb-2">Name</label>
                      <input type="text" required value={patientName} onChange={(e) => setPatientName(e.target.value)} placeholder="Your full name" className="w-full px-5 py-3 rounded-xl border border-magenta-100 focus:outline-none focus:ring-2 focus:ring-magenta-500/20"/>
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-magenta-900 mb-2">Email</label>
                      <input type="email" required value={patientEmail} onChange={(e) => setPatientEmail(e.target.value)} placeholder="your@email.com" className="w-full px-5 py-3 rounded-xl border border-magenta-100 focus:outline-none focus:ring-2 focus:ring-magenta-500/20"/>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-magenta-900 mb-2">Address</label>
                      <input type="text" required value={patientAddress} onChange={(e) => setPatientAddress(e.target.value)} placeholder="Current address" className="w-full px-5 py-3 rounded-xl border border-magenta-100 focus:outline-none focus:ring-2 focus:ring-magenta-500/20"/>
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-magenta-900 mb-2">Contact Number</label>
                      <input type="tel" required value={patientContact} onChange={(e) => setPatientContact(e.target.value)} placeholder="09xx xxx xxxx" className="w-full px-5 py-3 rounded-xl border border-magenta-100 focus:outline-none focus:ring-2 focus:ring-magenta-500/20"/>
                    </div>
                  </div>

                  {/* Skin Photo Upload */}
                  <div>
                    <label className="block text-sm font-bold text-magenta-900 mb-2">
                      Upload Photo of Skin Condition <span className="text-red-500 font-semibold">*</span>
                    </label>
                    <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange}/>
                    {skinPhotoUrl ? (<div className="relative rounded-2xl overflow-hidden border border-magenta-100">
                        <img src={skinPhotoUrl} alt="Skin condition" className="w-full max-h-52 object-cover"/>
                        <button type="button" onClick={() => { setSkinPhotoUrl(""); setPhotoFileName(""); if (photoInputRef.current)
                photoInputRef.current.value = ""; }} className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 flex items-center justify-center shadow hover:bg-white">
                          <X className="w-4 h-4 text-gray-600"/>
                        </button>
                        <p className="text-xs text-magenta-500 font-medium px-4 py-2 bg-magenta-50/80">{photoFileName}</p>
                      </div>) : (<button type="button" onClick={() => photoInputRef.current?.click()} className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-2xl border-2 border-dashed border-magenta-200 bg-magenta-50/40 hover:bg-magenta-50 hover:border-magenta-400 transition-all">
                        <Upload className="w-7 h-7 text-magenta-400"/>
                        <span className="text-sm font-semibold text-magenta-600">Click to upload photo</span>
                        <span className="text-xs text-magenta-400">JPG, PNG, or HEIC</span>
                      </button>)}
                  </div>

                  {/* AI Analysis Result */}
                  <div className="rounded-2xl border border-magenta-100 bg-magenta-50/40 p-5 space-y-4">
                    <div className="flex items-center gap-2 mb-1">
                      <ScanSearch className="w-5 h-5 text-magenta-500"/>
                      <p className="text-sm font-bold text-magenta-900">AI Skin Analysis Result <span className="text-red-500">*</span></p>
                    </div>
                    <p className="text-xs text-magenta-500 -mt-2">Enter your DermAI scan result. This is required so the clinic can review your condition before the appointment.</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-magenta-400 uppercase tracking-widest mb-2">Detected Condition</label>
                        <input type="text" required value={aiConditionName} onChange={(e) => setAiConditionName(e.target.value)} placeholder="e.g. Acne Vulgaris" className="w-full px-4 py-3 rounded-xl border border-magenta-100 bg-white focus:outline-none focus:ring-2 focus:ring-magenta-500/20 text-magenta-900 text-sm"/>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-magenta-400 uppercase tracking-widest mb-2">Confidence %</label>
                        <input type="number" required min={0} max={100} value={aiConfidence} onChange={(e) => setAiConfidence(e.target.value)} placeholder="e.g. 87" className="w-full px-4 py-3 rounded-xl border border-magenta-100 bg-white focus:outline-none focus:ring-2 focus:ring-magenta-500/20 text-magenta-900 text-sm"/>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-magenta-900 mb-2">Additional Notes</label>
                    <textarea placeholder="e.g. Symptoms duration, specific doctor request, etc." value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-5 py-4 rounded-2xl border border-magenta-100 focus:outline-none focus:ring-4 focus:ring-magenta-500/5 min-h-[140px] text-magenta-900 placeholder:text-magenta-300"/>
                  </div>

                  <button type="submit" className="w-full py-5 bg-magenta-500 text-white rounded-full font-bold shadow-xl shadow-magenta-500/20 hover:bg-magenta-600 transition-all transform hover:scale-[1.01] active:scale-95 text-lg">
                    Send Appointment Request
                  </button>
                  <p className="text-center text-xs text-magenta-400 font-medium">The clinic will reply with a confirmed date and time.</p>
                </form>
              </div>
            </motion.div>
        </AnimatePresence>
      </div>
    </div>);
}
