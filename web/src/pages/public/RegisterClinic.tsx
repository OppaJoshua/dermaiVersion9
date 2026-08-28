import { useState, useRef } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link } from "react-router-dom";
import Logo from "../../assets/LogoDerm.png";
import {
  ArrowLeft,
  Upload,
  Clock,
  CheckCircle2,
  Building2,
  ImagePlus,
  X,
} from "lucide-react";
import { motion } from "framer-motion";

const specializations = [
  "General Dermatology",
  "Cosmetic Dermatology",
  "Pediatric Dermatology",
  "Surgical Dermatology",
  "Dermatopathology",
  "Other",
];

export default function RegisterClinic() {
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    logo: "",
    address: "",
    email: "",
    phone: "",
    doctorName: "",
    specialization: specializations[0],
    servicesOffered: "",
    description: "",
    operatingDays: "Monday - Saturday",
    openTime: "08:00",
    closeTime: "17:00",
    prcLicense: "",
  });
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const handleLogoChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setLogoPreview(dataUrl);
      setFormData((prev) => ({ ...prev, logo: dataUrl }));
    };
    reader.readAsDataURL(file);
  };

  const clearLogo = () => {
    setLogoPreview(null);
    setFormData((prev) => ({ ...prev, logo: "" }));
    if (logoInputRef.current) logoInputRef.current.value = "";
  };

  // TODO: connect this to the FastAPI backend / Supabase.
  // For now this just switches the UI to the "submitted" state.
  const handleRegister = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-magenta-50 pt-8 pb-16 flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-white rounded-3xl shadow-[0_12px_48px_rgba(160,25,90,0.12)] p-8 text-center border border-magenta-100"
        >
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 className="w-8 h-8 text-green-500" />
          </div>
          <h2 className="text-2xl font-display font-bold text-magenta-900 mb-2">
            Application Submitted!
          </h2>
          <p className="text-sm text-magenta-700/60 mb-6 leading-relaxed">
            Thank you for registering your clinic with DERMAI. Our admin team will review your application
            within 3-5 business days.
          </p>
          <div className="bg-magenta-50 rounded-xl p-4 mb-6 flex items-center gap-3">
            <Clock className="w-5 h-5 text-magenta-500 shrink-0" />
            <p className="text-xs text-magenta-700 text-left">
              You'll receive an email notification once your application is reviewed.
            </p>
          </div>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-magenta-500 text-white rounded-full font-semibold text-sm hover:bg-magenta-600 transition-colors"
          >
            Back to Home
          </Link>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-magenta-50 flex items-center justify-center px-4 py-12 sm:py-16">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-magenta-100/60 blur-3xl" />
        <div className="absolute -bottom-24 -right-24 w-72 h-72 rounded-full bg-magenta-200/50 blur-3xl" />
      </div>

      <div className="max-w-2xl w-full mx-auto">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-magenta-500 font-medium mb-4 hover:text-magenta-600"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl shadow-[0_12px_48px_rgba(160,25,90,0.12)] border border-magenta-100 p-6 sm:p-8"
        >
          <div className="flex items-center justify-center mb-5">
            <img
              src={Logo}
              alt="LogDerm"
              className="h-15 w-auto object-contain"
            />
          </div>

          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-magenta-100 flex items-center justify-center">
              <Building2 className="w-6 h-6 text-magenta-500" />
            </div>
            <div>
              <h1 className="text-xl font-display font-bold text-magenta-900">
                Clinic Verification Form
              </h1>
              <p className="text-xs text-magenta-500">
                This is the same and only application form needed for clinic verification.
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-magenta-50 border border-magenta-100 p-4 mb-6">
            <p className="text-sm font-semibold text-magenta-900 mb-3">How to get verified</p>
            <div className="space-y-2 text-xs text-magenta-700">
              <p><span className="font-bold text-magenta-900">Step 1:</span> Complete this clinic form with accurate details.</p>
              <p><span className="font-bold text-magenta-900">Step 2:</span> Upload required documents (Business Permit and PRC License).</p>
              <p><span className="font-bold text-magenta-900">Step 3:</span> Submit for admin review (3-5 business days).</p>
              <p><span className="font-bold text-magenta-900">Step 4:</span> Receive approval email and appear as verified clinic.</p>
            </div>
          </div>

          <form
            onSubmit={handleRegister}
            className="space-y-5"
          >
            {/* Clinic Logo */}
            <div>
              <label className="block text-sm font-semibold text-magenta-900 mb-1.5">
                Clinic Logo
              </label>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleLogoChange}
              />
              {logoPreview ? (
                <div className="relative w-28 h-28">
                  <img
                    src={logoPreview}
                    alt="Clinic logo preview"
                    className="w-28 h-28 rounded-2xl object-cover border-2 border-magenta-200"
                  />
                  <button
                    type="button"
                    onClick={clearLogo}
                    className="absolute -top-2 -right-2 w-6 h-6 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:bg-red-50 transition-colors"
                  >
                    <X className="w-3.5 h-3.5 text-gray-500" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="flex flex-col items-center justify-center w-full h-28 rounded-2xl border-2 border-dashed border-magenta-200 bg-magenta-50/40 hover:bg-magenta-50 hover:border-magenta-400 transition-all gap-2 text-magenta-400 group"
                >
                  <ImagePlus className="w-7 h-7 group-hover:text-magenta-600 transition-colors" />
                  <span className="text-xs font-medium group-hover:text-magenta-600 transition-colors">Click to upload logo</span>
                  <span className="text-[10px] text-magenta-300">PNG, JPG, WEBP up to 5 MB</span>
                </button>
              )}
            </div>

            {/* Clinic Name */}
            <div>
              <label className="block text-sm font-semibold text-magenta-900 mb-1.5">
                Clinic Name *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                placeholder="e.g., Cebu Skin Care Center"
                className="w-full px-4 py-2.5 rounded-xl border border-magenta-200 text-sm text-magenta-900 placeholder:text-magenta-300 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 transition-all"
              />
            </div>

            {/* Address */}
            <div>
              <label className="block text-sm font-semibold text-magenta-900 mb-1.5">
                Complete Address in Cebu *
              </label>
              <input
                type="text"
                required
                value={formData.address}
                onChange={(e) => setFormData({...formData, address: e.target.value})}
                placeholder="e.g., 123 Mango Ave, Cebu City"
                className="w-full px-4 py-2.5 rounded-xl border border-magenta-200 text-sm text-magenta-900 placeholder:text-magenta-300 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 transition-all"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-semibold text-magenta-900 mb-1.5">
                Email Address *
              </label>
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                placeholder="clinic@example.com"
                className="w-full px-4 py-2.5 rounded-xl border border-magenta-200 text-sm text-magenta-900 placeholder:text-magenta-300 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 transition-all"
              />
            </div>

            {/* Contact */}
            <div>
              <label className="block text-sm font-semibold text-magenta-900 mb-1.5">
                Contact Number *
              </label>
              <input
                type="tel"
                required
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
                placeholder="(032) 234-5678"
                className="w-full px-4 py-2.5 rounded-xl border border-magenta-200 text-sm text-magenta-900 placeholder:text-magenta-300 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 transition-all"
              />
            </div>

            {/* Operating Days */}
            <div>
              <label className="block text-sm font-semibold text-magenta-900 mb-1.5">
                Operating Days *
              </label>
              <input
                type="text"
                required
                value={formData.operatingDays}
                onChange={(e) => setFormData({...formData, operatingDays: e.target.value})}
                placeholder="e.g., Monday - Saturday"
                className="w-full px-4 py-2.5 rounded-xl border border-magenta-200 text-sm text-magenta-900 placeholder:text-magenta-300 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 transition-all"
              />
            </div>

            {/* Hours */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-magenta-900 mb-1.5">
                  Opening Time *
                </label>
                <input
                  type="time"
                  required
                  value={formData.openTime}
                  onChange={(e) => setFormData({...formData, openTime: e.target.value})}
                  className="w-full px-4 py-2.5 rounded-xl border border-magenta-200 text-sm text-magenta-900 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-magenta-900 mb-1.5">
                  Closing Time *
                </label>
                <input
                  type="time"
                  required
                  value={formData.closeTime}
                  onChange={(e) => setFormData({...formData, closeTime: e.target.value})}
                  className="w-full px-4 py-2.5 rounded-xl border border-magenta-200 text-sm text-magenta-900 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 transition-all"
                />
              </div>
            </div>

            {/* Specialization */}
            <div>
              <label className="block text-sm font-semibold text-magenta-900 mb-1.5">
                Specialization *
              </label>
              <select
                required
                value={formData.specialization}
                onChange={(e) => setFormData({...formData, specialization: e.target.value})}
                className="w-full px-4 py-2.5 rounded-xl border border-magenta-200 text-sm text-magenta-900 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 transition-all appearance-none bg-white"
              >
                <option value="">Select specialization</option>
                {specializations.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {/* Services Offered */}
            <div>
              <label className="block text-sm font-semibold text-magenta-900 mb-1.5">
                Services Offered *
              </label>
              <textarea
                required
                value={formData.servicesOffered}
                onChange={(e) => setFormData({...formData, servicesOffered: e.target.value})}
                placeholder="e.g., Acne Treatment, Laser Therapy, Mole Removal"
                className="w-full px-4 py-2.5 rounded-xl border border-magenta-200 text-sm text-magenta-900 placeholder:text-magenta-300 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 transition-all"
                rows={2}
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-semibold text-magenta-900 mb-1.5">
                Clinic Description *
              </label>
              <textarea
                required
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
                placeholder="Briefly describe your clinic and mission"
                className="w-full px-4 py-2.5 rounded-xl border border-magenta-200 text-sm text-magenta-900 placeholder:text-magenta-300 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 transition-all"
                rows={3}
              />
            </div>

            {/* Doctor */}
            <div>
              <label className="block text-sm font-semibold text-magenta-900 mb-1.5">
                Doctor in Charge (Full Name) *
              </label>
              <input
                type="text"
                required
                value={formData.doctorName}
                onChange={(e) => setFormData({...formData, doctorName: e.target.value})}
                placeholder="Dr. Maria Santos"
                className="w-full px-4 py-2.5 rounded-xl border border-magenta-200 text-sm text-magenta-900 placeholder:text-magenta-300 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 transition-all"
              />
            </div>

            {/* PRC License */}
            <div>
              <label className="block text-sm font-semibold text-magenta-900 mb-1.5">
                PRC License Number *
              </label>
              <input
                type="text"
                required
                value={formData.prcLicense}
                onChange={(e) => setFormData({...formData, prcLicense: e.target.value})}
                placeholder="Enter PRC license number"
                className="w-full px-4 py-2.5 rounded-xl border border-magenta-200 text-sm text-magenta-900 placeholder:text-magenta-300 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 transition-all"
              />
            </div>

            {/* File Uploads */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-magenta-900 mb-1.5">
                  Business Permit *
                </label>
                <div className="border-2 border-dashed border-magenta-200 rounded-xl p-4 text-center cursor-pointer hover:border-magenta-400 hover:bg-magenta-50/50 transition-colors">
                  <Upload className="w-5 h-5 text-magenta-300 mx-auto mb-1" />
                  <p className="text-xs text-magenta-400">Click to upload PDF or image</p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-magenta-900 mb-1.5">
                  PRC License (Scanned Copy) *
                </label>
                <div className="border-2 border-dashed border-magenta-200 rounded-xl p-4 text-center cursor-pointer hover:border-magenta-400 hover:bg-magenta-50/50 transition-colors">
                  <Upload className="w-5 h-5 text-magenta-300 mx-auto mb-1" />
                  <p className="text-xs text-magenta-400">Click to upload PDF or image</p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-magenta-900 mb-1.5">
                  Clinic Photos (up to 5)
                </label>
                <div className="border-2 border-dashed border-magenta-200 rounded-xl p-4 text-center cursor-pointer hover:border-magenta-400 hover:bg-magenta-50/50 transition-colors">
                  <Upload className="w-5 h-5 text-magenta-300 mx-auto mb-1" />
                  <p className="text-xs text-magenta-400">Click to upload multiple images</p>
                </div>
              </div>
            </div>

            {/* Note */}
            <div className="bg-magenta-50 rounded-xl p-4 flex items-start gap-3">
              <Clock className="w-5 h-5 text-magenta-500 shrink-0 mt-0.5" />
              <p className="text-xs text-magenta-700 leading-relaxed">
                Our admin team will review your application within <strong>3-5 business days</strong>.
                You'll receive an email notification once your clinic is verified.
              </p>
            </div>

            <button
              type="submit"
              className="w-full py-3.5 rounded-full bg-magenta-500 text-white font-semibold text-sm hover:bg-magenta-600 transition-colors shadow-lg shadow-magenta-500/20 active:scale-[0.96]"
            >
              Submit for Verification
            </button>
          </form>
        </motion.div>
      </div>
    </div>
  );
}