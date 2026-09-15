import { useState, useRef, useEffect } from "react";
import type { ChangeEvent, FormEvent, DragEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import {
  ArrowLeft,
  ArrowRight,
  Upload,
  Clock,
  CheckCircle2,
  Building2,
  ImagePlus,
  X,
  FileText,
  Loader2,
  AlertCircle,
  Plus,
  ShieldCheck,
  FileCheck,
  Stethoscope,
  MapPin,
  Phone,
  Mail,
  User,
  Check,
  FileBadge,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import LocationPickerMap from "@/components/common/LocationPickerMap";
import logo from "@/assets/logo2.png";

const specializations = [
  "General Dermatology",
  "Cosmetic Dermatology",
  "Pediatric Dermatology",
  "Surgical Dermatology",
  "Dermatopathology",
  "Other",
];

const popularServices = [
  "Acne Treatment",
  "Laser Therapy",
  "Chemical Peel",
  "Mole Removal",
  "Skin Biopsy",
  "Eczema Care",
  "Psoriasis Treatment",
  "Anti-Aging / Botox",
  "Scar Treatment",
];

interface UploadedDoc {
  file: File;
  name: string;
  size: number;
  dataUrl: string;
  isPdf: boolean;
}

interface PhotoItem {
  id: string;
  file: File;
  name: string;
  size: number;
  dataUrl: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

const STEPS = [
  { id: 1, title: "Clinic Info", subtitle: "Identity & Contact", icon: Building2 },
  { id: 2, title: "Location & Hours", subtitle: "Address & Map Pin", icon: MapPin },
  { id: 3, title: "Medical Staff", subtitle: "Doctor & Practice", icon: Stethoscope },
  { id: 4, title: "Documents & Review", subtitle: "Permits & Photos", icon: FileBadge },
];

export default function RegisterClinic() {
  const [currentStep, setCurrentStep] = useState(1);
  const [direction, setDirection] = useState(1); // 1 = forward, -1 = backward
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    address: "",
    email: "",
    phone: "",
    doctorName: "",
    specialization: specializations[0],
    servicesOffered: "",
    consultationFee: "500",
    description: "",
    operatingDays: "Monday - Saturday",
    openTime: "08:00",
    closeTime: "17:00",
    prcLicense: "",
    latitude: null as number | null,
    longitude: null as number | null,
  });

  // Logo state
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Business Permit state
  const [businessPermit, setBusinessPermit] = useState<UploadedDoc | null>(null);
  const permitInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to top when application is submitted successfully
  useEffect(() => {
    if (submitted) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
  }, [submitted]);

  // PRC License state
  const [prcLicenseDoc, setPrcLicenseDoc] = useState<UploadedDoc | null>(null);
  const prcInputRef = useRef<HTMLInputElement>(null);

  // Clinic Photos state (up to 5)
  const [clinicPhotos, setClinicPhotos] = useState<PhotoItem[]>([]);
  const photosInputRef = useRef<HTMLInputElement>(null);

  // Logo handlers
  const handleLogoChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      setLogoPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const clearLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
    if (logoInputRef.current) logoInputRef.current.value = "";
  };

  // Business Permit handlers
  const processPermitFile = (file: File) => {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const reader = new FileReader();
    reader.onload = () => {
      setBusinessPermit({
        file,
        name: file.name,
        size: file.size,
        dataUrl: reader.result as string,
        isPdf,
      });
      setErrorMessage(null);
    };
    reader.readAsDataURL(file);
  };

  const handlePermitChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processPermitFile(file);
  };

  const clearPermit = () => {
    setBusinessPermit(null);
    if (permitInputRef.current) permitInputRef.current.value = "";
  };

  // PRC License handlers
  const processPrcFile = (file: File) => {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const reader = new FileReader();
    reader.onload = () => {
      setPrcLicenseDoc({
        file,
        name: file.name,
        size: file.size,
        dataUrl: reader.result as string,
        isPdf,
      });
      setErrorMessage(null);
    };
    reader.readAsDataURL(file);
  };

  const handlePrcChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processPrcFile(file);
  };

  const clearPrc = () => {
    setPrcLicenseDoc(null);
    if (prcInputRef.current) prcInputRef.current.value = "";
  };

  // Clinic Photos handlers (up to 5)
  const handlePhotosChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const availableSlots = 5 - clinicPhotos.length;
    if (availableSlots <= 0) {
      setErrorMessage("You can upload a maximum of 5 clinic photos.");
      return;
    }

    const filesToAdd = files.slice(0, availableSlots);
    if (files.length > availableSlots) {
      setErrorMessage(`Only ${availableSlots} more photo(s) could be added (max 5).`);
    } else {
      setErrorMessage(null);
    }

    filesToAdd.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const item: PhotoItem = {
          id: Math.random().toString(36).substring(2, 9),
          file,
          name: file.name,
          size: file.size,
          dataUrl: reader.result as string,
        };
        setClinicPhotos((prev) => (prev.length < 5 ? [...prev, item] : prev));
      };
      reader.readAsDataURL(file);
    });

    if (photosInputRef.current) photosInputRef.current.value = "";
  };

  const removePhoto = (id: string) => {
    setClinicPhotos((prev) => prev.filter((p) => p.id !== id));
  };

  // Service tag toggle helper
  const togglePopularService = (service: string) => {
    const currentList = formData.servicesOffered
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let nextList: string[];
    if (currentList.includes(service)) {
      nextList = currentList.filter((s) => s !== service);
    } else {
      nextList = [...currentList, service];
    }
    setFormData({ ...formData, servicesOffered: nextList.join(", ") });
  };

  // Step Validation logic
  const validateStep = (stepNumber: number): boolean => {
    setErrorMessage(null);

    if (stepNumber === 1) {
      if (!formData.name.trim()) {
        setErrorMessage("Please enter your clinic name.");
        return false;
      }
      if (!formData.email.trim() || !formData.email.includes("@")) {
        setErrorMessage("Please provide a valid clinic email address.");
        return false;
      }
      if (!formData.phone.trim()) {
        setErrorMessage("Please provide a contact phone number.");
        return false;
      }
      return true;
    }

    if (stepNumber === 2) {
      if (!formData.address.trim()) {
        setErrorMessage("Please enter the complete clinic address in Cebu.");
        return false;
      }
      if (!formData.operatingDays.trim()) {
        setErrorMessage("Please specify the operating days.");
        return false;
      }
      if (!formData.openTime || !formData.closeTime) {
        setErrorMessage("Please specify both opening and closing hours.");
        return false;
      }
      return true;
    }

    if (stepNumber === 3) {
      if (!formData.doctorName.trim()) {
        setErrorMessage("Please enter the name of the Doctor in Charge.");
        return false;
      }
      if (!formData.prcLicense.trim()) {
        setErrorMessage("Please enter the PRC license number of the doctor.");
        return false;
      }
      if (!formData.servicesOffered.trim()) {
        setErrorMessage("Please add at least one clinical service offered.");
        return false;
      }
      return true;
    }

    if (stepNumber === 4) {
      if (!businessPermit) {
        setErrorMessage("Please upload a scanned copy of your Business Permit, DTI, or SEC registration.");
        return false;
      }
      if (!prcLicenseDoc) {
        setErrorMessage("Please upload a scanned copy or photo of the Doctor's PRC License.");
        return false;
      }
      return true;
    }

    return true;
  };

  const handleNextStep = () => {
    if (validateStep(currentStep)) {
      setDirection(1);
      setCurrentStep((prev) => Math.min(prev + 1, 4));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handlePrevStep = () => {
    setErrorMessage(null);
    setDirection(-1);
    setCurrentStep((prev) => Math.max(prev - 1, 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleGoToStep = (targetStep: number) => {
    if (targetStep < currentStep) {
      setErrorMessage(null);
      setDirection(-1);
      setCurrentStep(targetStep);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (targetStep > currentStep) {
      // Validate all intermediate steps before jumping forward
      for (let s = currentStep; s < targetStep; s++) {
        if (!validateStep(s)) return;
      }
      setDirection(1);
      setCurrentStep(targetStep);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // Upload helper: uploads to Supabase storage or falls back to dataUrl
  const uploadFileToStorage = async (file: File, folder: string): Promise<string> => {
    try {
      const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${folder}/${Date.now()}_${cleanName}`;

      const uploadPromise = supabase.storage
        .from("clinic-photos")
        .upload(path, file, { upsert: true });

      const timeoutPromise = new Promise<{ data: null; error: Error }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: new Error("Storage timeout") }), 2500)
      );

      const { data: uploadData, error } = await Promise.race([uploadPromise, timeoutPromise]);

      if (!error && uploadData) {
        const { data: pubUrl } = supabase.storage
          .from("clinic-photos")
          .getPublicUrl(uploadData.path);
        if (pubUrl?.publicUrl) return pubUrl.publicUrl;
      }
    } catch (err) {
      console.warn(`Storage upload for ${folder} fallback to DataURL:`, err);
    }

    // Fallback to base64 DataURL
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
  };

  const handleRegister = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!validateStep(4)) return;

    setErrorMessage(null);
    setIsSubmitting(true);
    setSubmitStatus("Preparing verification package...");

    const servicesList = formData.servicesOffered
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const feeNum = parseFloat(formData.consultationFee);

      // Parallelize file uploads for ultra-fast instant submission
      setSubmitStatus("Uploading verification documents & gallery...");

      const [uploadedLogoUrl, uploadedPermitUrl, uploadedPrcUrl, ...uploadedPhotos] = await Promise.all([
        logoFile ? uploadFileToStorage(logoFile, "logos") : Promise.resolve(null),
        businessPermit ? uploadFileToStorage(businessPermit.file, "permits") : Promise.resolve(null),
        prcLicenseDoc ? uploadFileToStorage(prcLicenseDoc.file, "prc_licenses") : Promise.resolve(null),
        ...clinicPhotos.map((p) => uploadFileToStorage(p.file, "gallery")),
      ]);

      const uploadedPhotoUrls: string[] = (uploadedPhotos as (string | null)[]).filter(Boolean) as string[];

      // Determine effective owner user ID
      let effectiveOwnerId: string | null = null;
      if (session?.user?.id) {
        try {
          const { data: userRow } = await supabase
            .from("user")
            .select("user_id")
            .eq("user_id", session.user.id)
            .maybeSingle();
          if (userRow?.user_id) {
            effectiveOwnerId = userRow.user_id;
          }
        } catch {
          effectiveOwnerId = null;
        }
      }

      // Try calling register_new_clinic RPC first
      setSubmitStatus("Registering clinic in database...");
      let createdClinicId: string | null = null;

      let { data: rpcClinicId, error: rpcErr } = await supabase.rpc("register_new_clinic", {
        p_name: formData.name.trim(),
        p_address: formData.address.trim(),
        p_email: formData.email.trim(),
        p_phone: formData.phone.trim(),
        p_doctor_name: formData.doctorName.trim(),
        p_specialization: formData.specialization || "General Dermatology",
        p_services: servicesList,
        p_consultation_fee: isNaN(feeNum) ? 500 : feeNum,
        p_description: formData.description.trim() || null,
        p_operating_days: formData.operatingDays || "Monday - Saturday",
        p_open_time: formData.openTime || "08:00",
        p_close_time: formData.closeTime || "17:00",
        p_prc_license: formData.prcLicense.trim() || "PRC-PENDING",
        p_logo_url: uploadedLogoUrl || logoPreview || null,
        p_business_permit_url: uploadedPermitUrl || businessPermit?.dataUrl || null,
        p_business_permit_name: businessPermit?.name || null,
        p_prc_license_file_url: uploadedPrcUrl || prcLicenseDoc?.dataUrl || null,
        p_prc_license_file_name: prcLicenseDoc?.name || null,
        p_photos: uploadedPhotoUrls,
        p_owner_user_id: effectiveOwnerId,
        p_latitude: formData.latitude ?? null,
        p_longitude: formData.longitude ?? null,
      });

      // Legacy fallback retry
      if (rpcErr) {
        try {
          const legacyRpc = await supabase.rpc("register_new_clinic", {
            p_name: formData.name.trim(),
            p_address: formData.address.trim(),
            p_email: formData.email.trim(),
            p_phone: formData.phone.trim(),
            p_doctor_name: formData.doctorName.trim(),
            p_specialization: formData.specialization || "General Dermatology",
            p_services: servicesList,
            p_consultation_fee: isNaN(feeNum) ? 500 : feeNum,
            p_description: formData.description.trim() || null,
            p_operating_days: formData.operatingDays || "Monday - Saturday",
            p_open_time: formData.openTime || "08:00",
            p_close_time: formData.closeTime || "17:00",
            p_prc_license: formData.prcLicense.trim() || "PRC-PENDING",
            p_logo_url: uploadedLogoUrl || logoPreview || null,
            p_business_permit_url: uploadedPermitUrl || businessPermit?.dataUrl || null,
            p_business_permit_name: businessPermit?.name || null,
            p_prc_license_file_url: uploadedPrcUrl || prcLicenseDoc?.dataUrl || null,
            p_prc_license_file_name: prcLicenseDoc?.name || null,
            p_photos: uploadedPhotoUrls,
            p_owner_user_id: effectiveOwnerId,
          });
          if (!legacyRpc.error && legacyRpc.data) {
            rpcClinicId = legacyRpc.data;
            rpcErr = null;
            if (formData.latitude != null || formData.longitude != null) {
              await supabase
                .from("clinic")
                .update({
                  latitude: formData.latitude ?? null,
                  longitude: formData.longitude ?? null,
                })
                .eq("clinic_id", legacyRpc.data);
            }
          }
        } catch {}
      }

      if (!rpcErr && rpcClinicId) {
        createdClinicId = rpcClinicId;
      } else {
        console.warn("RPC fallback to direct table insert:", rpcErr?.message);
        const insertPayload: Record<string, any> = {
          name: formData.name.trim(),
          address: formData.address.trim(),
          district: formData.address.trim(),
          specialization: formData.specialization || "General Dermatology",
          email: formData.email.trim(),
          phone: formData.phone.trim(),
          consultation_fee: isNaN(feeNum) ? 500 : feeNum,
          description: formData.description.trim() || null,
          logo_url: uploadedLogoUrl || logoPreview || null,
          business_permit_url: uploadedPermitUrl || businessPermit?.dataUrl || null,
          business_permit_name: businessPermit?.name || null,
          prc_license_file_url: uploadedPrcUrl || prcLicenseDoc?.dataUrl || null,
          prc_license_file_name: prcLicenseDoc?.name || null,
          latitude: formData.latitude ?? null,
          longitude: formData.longitude ?? null,
          status: "pending",
        };
        if (effectiveOwnerId) {
          insertPayload.owner_user_id = effectiveOwnerId;
        }

        let { data: newClinic, error: clinicErr } = await supabase
          .from("clinic")
          .insert(insertPayload)
          .select("clinic_id")
          .maybeSingle();

        if (clinicErr && insertPayload.owner_user_id) {
          delete insertPayload.owner_user_id;
          const retryRes = await supabase
            .from("clinic")
            .insert(insertPayload)
            .select("clinic_id")
            .maybeSingle();
          newClinic = retryRes.data;
          clinicErr = retryRes.error;
        }

        if (clinicErr) {
          const corePayload: Record<string, any> = {
            name: formData.name.trim(),
            address: formData.address.trim(),
            district: formData.address.trim(),
            specialization: formData.specialization || "General Dermatology",
            email: formData.email.trim(),
            phone: formData.phone.trim(),
            consultation_fee: isNaN(feeNum) ? 500 : feeNum,
            description: formData.description.trim() || null,
            logo_url: uploadedLogoUrl || logoPreview || null,
            latitude: formData.latitude ?? null,
            longitude: formData.longitude ?? null,
            status: "pending",
          };
          const coreRes = await supabase
            .from("clinic")
            .insert(corePayload)
            .select("clinic_id")
            .maybeSingle();
          if (coreRes.data?.clinic_id) {
            newClinic = coreRes.data;
            clinicErr = null;
          }
        }

        if (newClinic?.clinic_id) {
          createdClinicId = newClinic.clinic_id;

          if (servicesList.length > 0) {
            await supabase.from("clinic_service_offered").insert(
              servicesList.map((s) => ({
                clinic_id: newClinic.clinic_id,
                service_name: s,
              }))
            );
          }

          if (formData.doctorName.trim()) {
            await supabase.from("clinic_doctor").insert({
              clinic_id: newClinic.clinic_id,
              doctor_name: formData.doctorName.trim(),
              email: formData.email.trim(),
              contact_number: formData.phone.trim(),
              prc_license: formData.prcLicense.trim() || "PRC-PENDING",
              photo_url: uploadedPrcUrl || null,
              status: "Active",
            });
          }

          if (formData.openTime && formData.closeTime) {
            await supabase.from("clinic_operating_hours").insert({
              clinic_id: newClinic.clinic_id,
              day_of_week: formData.operatingDays || "Monday - Saturday",
              open_time: formData.openTime,
              close_time: formData.closeTime,
            });
          }

          if (uploadedPhotoUrls.length > 0) {
            await supabase.from("clinic_photo").insert(
              uploadedPhotoUrls.map((url, idx) => ({
                clinic_id: newClinic.clinic_id,
                photo_url: url,
                sort_order: idx + 1,
              }))
            );
          }
        }
      }

      const clinicId = createdClinicId || `temp_${Date.now()}`;

      // Local storage snapshot
      try {
        const existingAppsStr = localStorage.getItem("dermai_clinic_applications");
        const existingApps = existingAppsStr ? JSON.parse(existingAppsStr) : [];
        const appSnapshot = {
          id: clinicId,
          name: formData.name.trim(),
          location: formData.address.trim(),
          address: formData.address.trim(),
          email: formData.email.trim(),
          phone: formData.phone.trim(),
          operatingDays: formData.operatingDays,
          openTime: formData.openTime,
          closeTime: formData.closeTime,
          doctor: formData.doctorName.trim(),
          specialization: formData.specialization,
          servicesOffered: formData.servicesOffered.trim(),
          description: formData.description.trim(),
          prcLicense: formData.prcLicense.trim(),
          logo: uploadedLogoUrl || logoPreview || "",
          businessPermitUrl: uploadedPermitUrl || businessPermit?.dataUrl || "",
          businessPermitName: businessPermit?.name || "",
          prcLicenseFileUrl: uploadedPrcUrl || prcLicenseDoc?.dataUrl || "",
          prcLicenseFileName: prcLicenseDoc?.name || "",
          clinicPhotos: uploadedPhotoUrls.length > 0 ? uploadedPhotoUrls : clinicPhotos.map((p) => p.dataUrl),
          latitude: formData.latitude,
          longitude: formData.longitude,
          dateApplied: new Date().toLocaleDateString("en-PH", {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
          status: "pending",
        };
        localStorage.setItem(
          "dermai_clinic_applications",
          JSON.stringify([appSnapshot, ...existingApps.filter((a: any) => a.id !== clinicId)])
        );
        window.dispatchEvent(new Event("storage"));
        window.dispatchEvent(new CustomEvent("clinicRegistered", { detail: appSnapshot }));
      } catch (storeErr) {
        console.warn("Could not cache application locally:", storeErr);
      }

      // Update role if signed in
      if (session?.user?.id) {
        try {
          await supabase
            .from("user")
            .update({ role: "clinic" })
            .eq("user_id", session.user.id);
        } catch {}
      }

      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      setSubmitted(true);
    } catch (err: any) {
      console.error("Error submitting clinic registration:", err.message);
      setErrorMessage("Something went wrong during submission. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // SUCCESS SCREEN
  if (submitted) {
    return (
      <div className="min-h-screen bg-white text-slate-900 flex flex-col items-center justify-center px-4 py-8 sm:py-12 selection:bg-magenta-500 selection:text-white">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="w-full max-w-lg bg-white rounded-3xl border border-slate-200/80 shadow-2xl shadow-slate-100 p-8 sm:p-10 text-center my-auto"
        >
          <div className="w-20 h-20 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
          </div>

          <span className="inline-block px-3 py-1 bg-magenta-50 text-magenta-600 rounded-full text-xs font-semibold tracking-wide uppercase mb-3">
            Verification Pending Review
          </span>

          <h1 className="text-2xl sm:text-3xl font-display font-bold text-slate-900 mb-3">
            Application Received!
          </h1>
          <p className="text-sm text-slate-600 mb-8 leading-relaxed">
            Thank you for submitting <strong>{formData.name}</strong> for verification on DermAI. Our medical accreditation team will inspect your submitted credentials and regulatory documents.
          </p>

          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 mb-8 text-left space-y-3">
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-magenta-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-slate-800">Processing Timeframe</p>
                <p className="text-xs text-slate-500">Official review takes approximately <strong>2 to 3 business days</strong>.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Mail className="w-5 h-5 text-magenta-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-slate-800">Status Updates</p>
                <p className="text-xs text-slate-500">
                  Confirmation and verification badge updates will be emailed to <strong>{formData.email}</strong>.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              to="/clinic"
              className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-magenta-500 text-white rounded-full font-semibold text-sm hover:bg-magenta-600 transition-all shadow-md shadow-magenta-500/20 active:scale-[0.98]"
            >
              Go to Clinic Portal
            </Link>
            <Link
              to="/"
              className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-slate-100 text-slate-700 rounded-full font-semibold text-sm hover:bg-slate-200 transition-all active:scale-[0.98]"
            >
              Back to Home
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  // Slide animation variants
  const slideVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 30 : -30,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: dir > 0 ? -30 : 30,
      opacity: 0,
    }),
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col justify-between selection:bg-magenta-500 selection:text-white relative">
      {/* ========================================================================= */}
      {/* MINIMAL PROCESSING MODAL OVERLAY */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {isSubmitting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-white/90 backdrop-blur-md flex flex-col items-center justify-center p-6 select-none"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.25 }}
              className="flex flex-col items-center text-center max-w-sm w-full"
            >
              {/* Subtle Breathing Logo with Ambient Ring */}
              <div className="relative mb-6 flex items-center justify-center">
                <motion.div
                  animate={{
                    scale: [1, 1.25, 1],
                    opacity: [0.25, 0.5, 0.25],
                  }}
                  transition={{
                    duration: 2.2,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                  className="absolute -inset-4 rounded-full bg-magenta-500/15 blur-lg pointer-events-none"
                />
                <motion.img
                  src={logo}
                  alt="DermAI Logo"
                  className="w-16 h-16 object-contain relative z-10"
                  animate={{
                    scale: [0.96, 1.04, 0.96],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              </div>

              {/* Minimal Status Text */}
              <h3 className="text-base font-display font-bold text-slate-900 mb-1">
                Processing Verification
              </h3>
              <p className="text-xs text-slate-500 font-medium mb-6 min-h-[1.25rem] transition-all">
                {submitStatus || "Securing and uploading documents..."}
              </p>

              {/* Minimal Hairline Progress Indicator */}
              <div className="w-48 h-1 bg-slate-100 rounded-full overflow-hidden relative">
                <motion.div
                  className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-magenta-400 via-magenta-600 to-pink-500 rounded-full"
                  animate={{
                    width: ["20%", "75%", "92%"],
                    x: ["0%", "20%", "0%"],
                  }}
                  transition={{
                    duration: 2.5,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              </div>

              <span className="text-[11px] text-slate-400 mt-4">
                Please keep this tab open
              </span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Form Container */}
      <main className="max-w-3xl w-full mx-auto px-4 py-8 sm:py-12">
        {/* Page Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-slate-900 mb-2">
            Clinic Verification Form
          </h1>
          <p className="text-slate-500 text-sm">
            Complete the steps below to register your clinic, submit credentials, and get verified
          </p>
        </div>

        {/* ========================================================================= */}
        {/* MINIMAL HORIZONTAL STEPPER */}
        {/* ========================================================================= */}
        <div className="w-full mb-12 px-2 sm:px-6">
          <div className="grid grid-cols-4 relative">
            {STEPS.map((step, idx) => {
              const isCompleted = currentStep > step.id;
              const isCurrent = currentStep === step.id;

              return (
                <div key={step.id} className="relative flex flex-col items-center text-center">
                  {/* Connector Line to next step */}
                  {idx < STEPS.length - 1 && (
                    <div className="absolute top-4 left-[50%] right-[-50%] h-[2px] -z-0">
                      {isCompleted ? (
                        <div className="h-full bg-magenta-500 w-full rounded-full transition-all duration-300" />
                      ) : isCurrent ? (
                        <div className="h-full bg-slate-100 w-full rounded-full overflow-hidden">
                          <div className="h-full bg-magenta-500 w-1/2 rounded-full" />
                        </div>
                      ) : (
                        <div className="h-full bg-slate-200 w-full rounded-full" />
                      )}
                    </div>
                  )}

                  {/* Step Circle */}
                  <button
                    type="button"
                    onClick={() => handleGoToStep(step.id)}
                    className="relative z-10 flex items-center justify-center cursor-pointer transition-all mb-3.5 focus:outline-none"
                    aria-label={`Go to step ${step.id}`}
                  >
                    {isCompleted ? (
                      <div className="w-8 h-8 rounded-full bg-magenta-500 flex items-center justify-center text-white shadow-sm transition-transform hover:scale-105">
                        <Check className="w-4 h-4 stroke-[3]" />
                      </div>
                    ) : isCurrent ? (
                      <div className="w-8 h-8 rounded-full border-2 border-magenta-500 bg-white flex items-center justify-center shadow-sm transition-transform hover:scale-105">
                        <div className="w-3.5 h-3.5 rounded-full bg-magenta-500" />
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-slate-100 transition-transform hover:scale-105" />
                    )}
                  </button>

                  {/* Step Text Labels */}
                  <div className="w-full px-1">
                    <p
                      className={`text-[10px] sm:text-[11px] font-semibold uppercase tracking-widest ${
                        isCurrent || isCompleted ? "text-magenta-500" : "text-slate-400"
                      }`}
                    >
                      STEP {step.id}
                    </p>
                    <p
                      className={`text-xs sm:text-sm font-display font-bold mt-0.5 leading-snug ${
                        isCurrent || isCompleted ? "text-slate-900" : "text-slate-500"
                      }`}
                    >
                      {step.title}
                    </p>
                    <p
                      className={`text-[11px] sm:text-xs mt-1 font-semibold ${
                        isCompleted
                          ? "text-magenta-600"
                          : isCurrent
                          ? "text-magenta-500"
                          : "text-slate-400 font-normal"
                      }`}
                    >
                      {isCompleted ? "Completed" : isCurrent ? "In Progress" : "Pending"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Global Error Alert */}
        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-3 text-rose-700 text-xs font-medium shadow-sm"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
            <div className="flex-1">
              <p className="font-semibold mb-0.5">Please check the required information:</p>
              <p>{errorMessage}</p>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-rose-400 hover:text-rose-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        {/* ========================================================================= */}
        {/* MULTI-STEP CARD CONTAINER */}
        {/* ========================================================================= */}
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden">
          <form onSubmit={handleRegister} className="p-6 sm:p-8">
            <AnimatePresence mode="wait" custom={direction}>
              {/* =================================================================== */}
              {/* STEP 1: CLINIC PROFILE */}
              {/* =================================================================== */}
              {currentStep === 1 && (
                <motion.div
                  key="step-1"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25 }}
                  className="space-y-6"
                >
                  <div className="border-b border-slate-100 pb-4">
                    <div className="flex items-center gap-2.5 text-magenta-600 mb-1">
                      <Building2 className="w-5 h-5 text-magenta-500" />
                      <h2 className="text-lg sm:text-xl font-display font-bold text-slate-900">
                        Clinic Profile & Information
                      </h2>
                    </div>
                    <p className="text-xs text-slate-500">
                      Provide your official clinic brand name, public contact information, and logo.
                    </p>
                  </div>

                  {/* Clinic Logo */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Clinic Logo (Optional)
                    </label>
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/jpg"
                      className="hidden"
                      onChange={handleLogoChange}
                    />
                    {logoPreview ? (
                      <div className="flex items-center gap-4 p-3.5 bg-slate-50 border border-slate-200 rounded-2xl">
                        <img
                          src={logoPreview}
                          alt="Clinic logo preview"
                          className="w-16 h-16 rounded-xl object-cover border border-slate-200 bg-white"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">
                            {logoFile?.name || "Clinic Logo"}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {logoFile ? formatFileSize(logoFile.size) : "Ready"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => logoInputRef.current?.click()}
                            className="text-xs font-semibold text-magenta-600 hover:text-magenta-700 px-3 py-1.5 rounded-lg hover:bg-magenta-50 transition-colors cursor-pointer"
                          >
                            Replace
                          </button>
                          <button
                            type="button"
                            onClick={clearLogo}
                            className="p-1.5 rounded-lg border border-slate-200 hover:bg-rose-50 hover:text-rose-600 text-slate-400 transition-colors cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => logoInputRef.current?.click()}
                        className="w-full flex items-center justify-center gap-3 p-5 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 hover:bg-magenta-50/30 hover:border-magenta-400 transition-all text-slate-500 group cursor-pointer"
                      >
                        <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center group-hover:border-magenta-300 transition-colors">
                          <ImagePlus className="w-5 h-5 text-slate-400 group-hover:text-magenta-600 transition-colors" />
                        </div>
                        <div className="text-left">
                          <span className="block text-xs font-semibold text-slate-900 group-hover:text-magenta-600">
                            Click to upload clinic logo
                          </span>
                          <span className="block text-[11px] text-slate-400">
                            PNG, JPG, WEBP up to 5 MB
                          </span>
                        </div>
                      </button>
                    )}
                  </div>

                  {/* Clinic Name */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Clinic Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g., Cebu Skin & Laser Center"
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:border-magenta-500 focus:ring-4 focus:ring-magenta-500/10 outline-none transition-all"
                    />
                  </div>

                  {/* Contact Info (2-col) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Clinic Email <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                        <input
                          type="email"
                          required
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          placeholder="clinic@example.com"
                          className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:border-magenta-500 focus:ring-4 focus:ring-magenta-500/10 outline-none transition-all"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Phone / Contact Number <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                        <input
                          type="tel"
                          required
                          value={formData.phone}
                          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                          placeholder="(032) 234-5678 or 0917-123-4567"
                          className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:border-magenta-500 focus:ring-4 focus:ring-magenta-500/10 outline-none transition-all"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Clinic Description */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      About the Clinic / Mission
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Briefly describe your clinical philosophy, equipment, or specialties offered to patients."
                      rows={3}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:border-magenta-500 focus:ring-4 focus:ring-magenta-500/10 outline-none transition-all resize-none"
                    />
                  </div>
                </motion.div>
              )}

              {/* =================================================================== */}
              {/* STEP 2: LOCATION & OPERATING HOURS */}
              {/* =================================================================== */}
              {currentStep === 2 && (
                <motion.div
                  key="step-2"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25 }}
                  className="space-y-6"
                >
                  <div className="border-b border-slate-100 pb-4">
                    <div className="flex items-center gap-2.5 text-magenta-600 mb-1">
                      <MapPin className="w-5 h-5 text-magenta-500" />
                      <h2 className="text-lg sm:text-xl font-display font-bold text-slate-900">
                        Location & Operating Schedule
                      </h2>
                    </div>
                    <p className="text-xs text-slate-500">
                      Set your clinic address and schedule so patients in Cebu can find and book appointments easily.
                    </p>
                  </div>

                  {/* Address */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Complete Address in Cebu <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.address}
                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                      placeholder="e.g., Unit 302 Medical Arts Bldg, Gov. M. Cuenco Ave, Cebu City"
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:border-magenta-500 focus:ring-4 focus:ring-magenta-500/10 outline-none transition-all"
                    />
                  </div>

                  {/* Interactive Map Location Picker */}
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                        <MapPin className="w-4 h-4 text-magenta-600" />
                        Exact Map Coordinates Pin
                      </span>
                      {formData.latitude && formData.longitude && (
                        <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                          Pin Set ({formData.latitude.toFixed(4)}, {formData.longitude.toFixed(4)})
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mb-3">
                      Search for your landmark or click on the map below to pinpoint your clinic location:
                    </p>
                    <LocationPickerMap
                      latitude={formData.latitude}
                      longitude={formData.longitude}
                      onChange={(lat, lng, addressSuggestion) => {
                        setFormData((prev) => ({
                          ...prev,
                          latitude: lat,
                          longitude: lng,
                          address: addressSuggestion || prev.address,
                        }));
                      }}
                    />
                  </div>

                  {/* Operating Days */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Operating Days <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.operatingDays}
                      onChange={(e) => setFormData({ ...formData, operatingDays: e.target.value })}
                      placeholder="e.g., Monday - Saturday"
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:border-magenta-500 focus:ring-4 focus:ring-magenta-500/10 outline-none transition-all"
                    />
                  </div>

                  {/* Operating Hours (Open/Close) + Consultation Fee */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Opening Time <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="time"
                        required
                        value={formData.openTime}
                        onChange={(e) => setFormData({ ...formData, openTime: e.target.value })}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:border-magenta-500 focus:ring-4 focus:ring-magenta-500/10 outline-none transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Closing Time <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="time"
                        required
                        value={formData.closeTime}
                        onChange={(e) => setFormData({ ...formData, closeTime: e.target.value })}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:border-magenta-500 focus:ring-4 focus:ring-magenta-500/10 outline-none transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Consultation Fee (₱)
                      </label>
                      <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden bg-white focus-within:border-magenta-500 focus-within:ring-4 focus-within:ring-magenta-500/10 transition-all">
                        <span className="px-3.5 py-3 text-sm text-slate-700 bg-slate-50 border-r border-slate-200 font-bold select-none">
                          ₱
                        </span>
                        <input
                          type="number"
                          min={0}
                          value={formData.consultationFee}
                          onChange={(e) => setFormData({ ...formData, consultationFee: e.target.value })}
                          placeholder="500"
                          className="w-full px-3 py-3 text-sm text-slate-900 placeholder:text-slate-400 bg-transparent outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* =================================================================== */}
              {/* STEP 3: MEDICAL STAFF & SERVICES */}
              {/* =================================================================== */}
              {currentStep === 3 && (
                <motion.div
                  key="step-3"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25 }}
                  className="space-y-6"
                >
                  <div className="border-b border-slate-100 pb-4">
                    <div className="flex items-center gap-2.5 text-magenta-600 mb-1">
                      <Stethoscope className="w-5 h-5 text-magenta-500" />
                      <h2 className="text-lg sm:text-xl font-display font-bold text-slate-900">
                        Medical Staff & Practice Services
                      </h2>
                    </div>
                    <p className="text-xs text-slate-500">
                      Specify the primary physician credentials, specialization field, and treatments offered.
                    </p>
                  </div>

                  {/* Doctor Full Name */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Doctor in Charge (Full Name & Titles) <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                      <input
                        type="text"
                        required
                        value={formData.doctorName}
                        onChange={(e) => setFormData({ ...formData, doctorName: e.target.value })}
                        placeholder="e.g., Dr. Maria Santos, MD, FPDS"
                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:border-magenta-500 focus:ring-4 focus:ring-magenta-500/10 outline-none transition-all"
                      />
                    </div>
                  </div>

                  {/* Specialization & PRC License (2-col) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Specialization <span className="text-rose-500">*</span>
                      </label>
                      <select
                        required
                        value={formData.specialization}
                        onChange={(e) => setFormData({ ...formData, specialization: e.target.value })}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 outline-none focus:border-magenta-500 focus:ring-4 focus:ring-magenta-500/10 transition-all cursor-pointer"
                      >
                        {specializations.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        PRC License Number <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <ShieldCheck className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                        <input
                          type="text"
                          required
                          value={formData.prcLicense}
                          onChange={(e) => setFormData({ ...formData, prcLicense: e.target.value })}
                          placeholder="e.g., 0123456"
                          className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:border-magenta-500 focus:ring-4 focus:ring-magenta-500/10 outline-none transition-all"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Services Offered */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Services & Treatments Offered <span className="text-rose-500">*</span>
                    </label>
                    <p className="text-[11px] text-slate-400 mb-2">
                      Click tags to quickly add or type your custom services separated by commas:
                    </p>

                    {/* Quick Suggestion Pills */}
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {popularServices.map((srv) => {
                        const isSelected = formData.servicesOffered
                          .split(",")
                          .map((s) => s.trim().toLowerCase())
                          .includes(srv.toLowerCase());
                        return (
                          <button
                            type="button"
                            key={srv}
                            onClick={() => togglePopularService(srv)}
                            className={`text-xs px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                              isSelected
                                ? "bg-magenta-50 border-magenta-300 text-magenta-700 font-semibold shadow-xs"
                                : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-magenta-50/50 hover:border-magenta-200 hover:text-magenta-700"
                            }`}
                          >
                            {isSelected ? "✓ " : "+ "}
                            {srv}
                          </button>
                        );
                      })}
                    </div>

                    <textarea
                      required
                      value={formData.servicesOffered}
                      onChange={(e) => setFormData({ ...formData, servicesOffered: e.target.value })}
                      placeholder="e.g., Acne Treatment, Laser Therapy, Chemical Peel, Mole Removal"
                      rows={2}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:border-magenta-500 focus:ring-4 focus:ring-magenta-500/10 outline-none transition-all resize-none"
                    />
                  </div>
                </motion.div>
              )}

              {/* =================================================================== */}
              {/* STEP 4: VERIFICATION DOCUMENTS & SUMMARY */}
              {/* =================================================================== */}
              {currentStep === 4 && (
                <motion.div
                  key="step-4"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25 }}
                  className="space-y-6"
                >
                  <div className="border-b border-slate-100 pb-4">
                    <div className="flex items-center gap-2.5 text-magenta-600 mb-1">
                      <FileBadge className="w-5 h-5 text-magenta-500" />
                      <h2 className="text-lg sm:text-xl font-display font-bold text-slate-900">
                        Verification Documents & Gallery
                      </h2>
                    </div>
                    <p className="text-xs text-slate-500">
                      Upload your official business permit and medical license scans to complete identity verification.
                    </p>
                  </div>

                  {/* 1. Business Permit Upload */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs font-semibold text-slate-700">
                        1. Business Permit / DTI / SEC Registration <span className="text-rose-500">*</span>
                      </label>
                      {businessPermit && (
                        <span className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> File attached
                        </span>
                      )}
                    </div>

                    <input
                      ref={permitInputRef}
                      type="file"
                      accept=".pdf,image/png,image/jpeg,image/webp,image/jpg"
                      className="hidden"
                      onChange={handlePermitChange}
                    />

                    {businessPermit ? (
                      <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center border border-slate-200 shrink-0">
                            {businessPermit.isPdf ? (
                              <FileText className="w-5 h-5 text-rose-500" />
                            ) : (
                              <FileCheck className="w-5 h-5 text-magenta-600" />
                            )}
                          </div>
                          <div className="truncate">
                            <p className="text-xs font-semibold text-slate-900 truncate">
                              {businessPermit.name}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              {formatFileSize(businessPermit.size)} • {businessPermit.isPdf ? "PDF Document" : "Image File"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <button
                            type="button"
                            onClick={() => permitInputRef.current?.click()}
                            className="text-xs font-semibold text-magenta-600 hover:text-magenta-700 px-2.5 py-1 rounded-lg hover:bg-magenta-50 transition-colors cursor-pointer"
                          >
                            Replace
                          </button>
                          <button
                            type="button"
                            onClick={clearPermit}
                            className="p-1.5 rounded-lg border border-slate-200 hover:bg-rose-50 hover:text-rose-600 text-slate-400 transition-colors cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        onClick={() => permitInputRef.current?.click()}
                        onDragOver={(e: DragEvent) => e.preventDefault()}
                        onDrop={(e: DragEvent) => {
                          e.preventDefault();
                          const f = e.dataTransfer.files?.[0];
                          if (f) processPermitFile(f);
                        }}
                        className="border-2 border-dashed border-slate-200 bg-slate-50/50 hover:border-magenta-400 hover:bg-magenta-50/30 rounded-2xl p-5 text-center cursor-pointer transition-all group"
                      >
                        <Upload className="w-6 h-6 text-slate-400 mx-auto mb-1.5 group-hover:text-magenta-600 transition-colors" />
                        <p className="text-xs font-semibold text-slate-900 group-hover:text-magenta-600">
                          Click or drag & drop Business Permit
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          PDF, PNG, JPG, WEBP up to 10 MB
                        </p>
                      </div>
                    )}
                  </div>

                  {/* 2. PRC License Document Upload */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs font-semibold text-slate-700">
                        2. PRC License Card / Scanned Document <span className="text-rose-500">*</span>
                      </label>
                      {prcLicenseDoc && (
                        <span className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> File attached
                        </span>
                      )}
                    </div>

                    <input
                      ref={prcInputRef}
                      type="file"
                      accept=".pdf,image/png,image/jpeg,image/webp,image/jpg"
                      className="hidden"
                      onChange={handlePrcChange}
                    />

                    {prcLicenseDoc ? (
                      <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center border border-slate-200 shrink-0">
                            {prcLicenseDoc.isPdf ? (
                              <FileText className="w-5 h-5 text-rose-500" />
                            ) : (
                              <ShieldCheck className="w-5 h-5 text-magenta-600" />
                            )}
                          </div>
                          <div className="truncate">
                            <p className="text-xs font-semibold text-slate-900 truncate">
                              {prcLicenseDoc.name}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              {formatFileSize(prcLicenseDoc.size)} • {prcLicenseDoc.isPdf ? "PDF Document" : "Image File"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <button
                            type="button"
                            onClick={() => prcInputRef.current?.click()}
                            className="text-xs font-semibold text-magenta-600 hover:text-magenta-700 px-2.5 py-1 rounded-lg hover:bg-magenta-50 transition-colors cursor-pointer"
                          >
                            Replace
                          </button>
                          <button
                            type="button"
                            onClick={clearPrc}
                            className="p-1.5 rounded-lg border border-slate-200 hover:bg-rose-50 hover:text-rose-600 text-slate-400 transition-colors cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        onClick={() => prcInputRef.current?.click()}
                        onDragOver={(e: DragEvent) => e.preventDefault()}
                        onDrop={(e: DragEvent) => {
                          e.preventDefault();
                          const f = e.dataTransfer.files?.[0];
                          if (f) processPrcFile(f);
                        }}
                        className="border-2 border-dashed border-slate-200 bg-slate-50/50 hover:border-magenta-400 hover:bg-magenta-50/30 rounded-2xl p-5 text-center cursor-pointer transition-all group"
                      >
                        <Upload className="w-6 h-6 text-slate-400 mx-auto mb-1.5 group-hover:text-magenta-600 transition-colors" />
                        <p className="text-xs font-semibold text-slate-900 group-hover:text-magenta-600">
                          Click or drag & drop PRC License Copy
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          PDF, PNG, JPG, WEBP up to 10 MB
                        </p>
                      </div>
                    )}
                  </div>

                  {/* 3. Clinic Photos Gallery */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs font-semibold text-slate-700">
                        3. Clinic Photos Gallery ({clinicPhotos.length}/5)
                      </label>
                      <span className="text-[11px] text-slate-400">
                        Optional (PNG, JPG up to 5)
                      </span>
                    </div>

                    <input
                      ref={photosInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/jpg"
                      multiple
                      className="hidden"
                      onChange={handlePhotosChange}
                    />

                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
                      {clinicPhotos.map((photo, index) => (
                        <div
                          key={photo.id}
                          className="relative aspect-square rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 group shadow-xs"
                        >
                          <img
                            src={photo.dataUrl}
                            alt={`Clinic photo ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <button
                              type="button"
                              onClick={() => removePhoto(photo.id)}
                              className="p-1.5 bg-rose-500 text-white rounded-full hover:bg-rose-600 transition-colors shadow-sm cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <span className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/60 text-white text-[9px] font-bold rounded">
                            #{index + 1}
                          </span>
                        </div>
                      ))}

                      {clinicPhotos.length < 5 && (
                        <button
                          type="button"
                          onClick={() => photosInputRef.current?.click()}
                          className="aspect-square rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 hover:bg-magenta-50/30 hover:border-magenta-400 flex flex-col items-center justify-center text-slate-400 hover:text-magenta-600 transition-all gap-1 cursor-pointer group"
                        >
                          <Plus className="w-5 h-5 group-hover:scale-110 transition-transform" />
                          <span className="text-[10px] font-bold">Add Photo</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Summary Recap Card */}
                  <div className="rounded-2xl bg-slate-50 border border-slate-200/80 p-5 space-y-3">
                    <p className="text-xs font-display font-bold text-slate-900 uppercase tracking-wider">
                      Application Summary Review
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                      <div>
                        <span className="text-slate-400 block text-[11px]">Clinic:</span>
                        <span className="font-semibold text-slate-900">{formData.name || "—"}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">Doctor in Charge:</span>
                        <span className="font-semibold text-slate-900">{formData.doctorName || "—"}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">Specialization:</span>
                        <span className="font-semibold text-slate-900">{formData.specialization}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">Contact & Email:</span>
                        <span className="font-semibold text-slate-900">{formData.phone} • {formData.email}</span>
                      </div>
                      <div className="sm:col-span-2">
                        <span className="text-slate-400 block text-[11px]">Address:</span>
                        <span className="font-semibold text-slate-900">{formData.address || "—"}</span>
                      </div>
                    </div>
                  </div>

                  {/* Review Notice */}
                  <div className="rounded-xl bg-magenta-50/70 border border-magenta-100 p-3.5 flex items-start gap-2.5 text-xs text-slate-700">
                    <Clock className="w-4 h-4 text-magenta-500 shrink-0 mt-0.5" />
                    <p>
                      By submitting this form, you confirm that all entered details and documents are authentic. Verification is completed by DermAI administrators within <strong>2-3 business days</strong>.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* =================================================================== */}
            {/* ACTION FOOTER CONTROLS */}
            {/* =================================================================== */}
            <div className="pt-8 mt-8 border-t border-slate-100 flex items-center justify-between gap-3">
              {currentStep > 1 ? (
                <button
                  type="button"
                  onClick={handlePrevStep}
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 px-5 py-3.5 rounded-full border-2 border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-all cursor-pointer active:scale-[0.96]"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
              ) : (
                <div />
              )}

              {currentStep < 4 ? (
                <button
                  type="button"
                  onClick={handleNextStep}
                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-magenta-500 text-white font-semibold text-sm hover:bg-magenta-600 transition-all shadow-lg shadow-magenta-500/20 cursor-pointer active:scale-[0.96] ml-auto"
                >
                  Next Step
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-full bg-magenta-500 text-white font-semibold text-sm hover:bg-magenta-600 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-lg shadow-magenta-500/20 active:scale-[0.96] ml-auto cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{submitStatus || "Submitting application..."}</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      <span>Submit for Verification</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </form>
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="w-full text-center py-6 text-xs text-slate-400 border-t border-slate-100 bg-white">
        © {new Date().getFullYear()} DermAI Philippines. Professional Clinic Verification Network.
      </footer>
    </div>
  );
}