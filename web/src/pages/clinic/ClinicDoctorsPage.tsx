import { useState, useEffect, useRef } from "react";
import {
  UserPlus,
  Trash2,
  Stethoscope,
  AlertCircle,
  CheckCircle2,
  Eye,
  X,
  Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useClinicVerification } from "@/hooks/useClinicVerification";
import { supabase } from "@/lib/supabaseClient";
import SpecializationMultiSelect, {
  type SpecializationOption,
} from "@/components/clinic/SpecializationMultiSelect";

export type DoctorAccount = {
  id: string;
  name: string;
  email: string;
  contactNumber?: string;
  prcLicense?: string;
  photo?: string;
  specialization?: string;
  specializations: SpecializationOption[];
  clinicName: string;
  status: "Active" | "Inactive";
};

const DEFAULT_SPECIALIZATIONS: SpecializationOption[] = [
  { id: "spec-1", name: "General Dermatology" },
  { id: "spec-2", name: "Clinical Dermatology" },
  { id: "spec-3", name: "Cosmetic Dermatology" },
  { id: "spec-4", name: "Aesthetic Dermatology" },
  { id: "spec-5", name: "Pediatric Dermatology" },
  { id: "spec-6", name: "Dermatologic Surgery" },
  { id: "spec-7", name: "Dermatopathology" },
  { id: "spec-8", name: "Dermatology Oncology" },
  { id: "spec-9", name: "Hair & Scalp Dermatology" },
  { id: "spec-10", name: "Nail Dermatology" },
  { id: "spec-11", name: "Immunodermatology" },
  { id: "spec-12", name: "Contact Dermatitis & Allergy" },
  { id: "spec-13", name: "Photodermatology" },
  { id: "spec-14", name: "Dermatology & Venereology" },
];

export default function ClinicDoctorsPage() {
  const { clinicName: verifiedClinicName } = useClinicVerification();
  const clinicDisplayName = verifiedClinicName || "Clinic Portal";

  // Dynamic specializations: defaults provided for UI, synced from database if available
  const [specializations, setSpecializations] = useState<SpecializationOption[]>(DEFAULT_SPECIALIZATIONS);
  const [loadingSpecializations] = useState(false);

  // Doctors: starts clean (empty), loaded from localStorage or database
  const [allDoctors, setAllDoctors] = useState<DoctorAccount[]>(() => {
    try {
      const saved = localStorage.getItem("dermai_clinic_doctors");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const filtered = parsed.filter(
            (d) =>
              d.email !== "maria.reyes@skincarecebu.ph" &&
              d.email !== "antonio.cruz@skincarecebu.ph" &&
              d.name !== "Dr. Maria Reyes" &&
              d.name !== "Dr. Antonio Cruz"
          );
          if (filtered.length !== parsed.length) {
            localStorage.setItem("dermai_clinic_doctors", JSON.stringify(filtered));
          }
          return filtered;
        }
      }
    } catch {
      /* ignore */
    }
    return [];
  });
  const [loadingDoctors] = useState(false);

  // Add Form state
  const [form, setForm] = useState({
    name: "",
    email: "",
    contactNumber: "",
    prcLicense: "",
    selectedSpecializationIds: [] as string[],
  });
  const [formError, setFormError] = useState("");
  const [savingDoctor] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  // Modals state
  const [selectedDoctorForDetails, setSelectedDoctorForDetails] = useState<DoctorAccount | null>(null);
  const [editingDoctor, setEditingDoctor] = useState<DoctorAccount | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    contactNumber: "",
    prcLicense: "",
    selectedSpecializationIds: [] as string[],
  });
  const [editError, setEditError] = useState("");
  const [savingEdit] = useState(false);

  // Delete modal
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deletingDoctor] = useState(false);

  const formSectionRef = useRef<HTMLDivElement>(null);

  // 1. Fetch specializations dynamically from database if available
  const fetchSpecializations = async () => {
    try {
      const { data, error } = await supabase
        .from("specializations")
        .select("id, name")
        .order("name", { ascending: true });

      if (!error && data && data.length > 0) {
        setSpecializations(data);
      }
    } catch {
      // Using DEFAULT_SPECIALIZATIONS
    }
  };

  // 2. Fetch doctors from database if available
  const fetchDoctors = async () => {
    try {
      const { data, error } = await supabase
        .from("doctors")
        .select(`
          id,
          name,
          email,
          contact_number,
          prc_license,
          clinic_name,
          status,
          created_at,
          doctor_specializations (
            specialization_id,
            specializations (
              id,
              name
            )
          )
        `)
        .order("created_at", { ascending: false });

      if (!error && data && data.length > 0) {
        const mapped: DoctorAccount[] = data
          .filter(
            (doc: any) =>
              doc.email !== "maria.reyes@skincarecebu.ph" &&
              doc.email !== "antonio.cruz@skincarecebu.ph" &&
              doc.name !== "Dr. Maria Reyes" &&
              doc.name !== "Dr. Antonio Cruz"
          )
          .map((doc: any) => {
            const docSpecs: SpecializationOption[] = (doc.doctor_specializations || [])
              .map((ds: any) => ds.specializations)
              .filter(Boolean);

            // Preserve photo from local storage / doctor profile
            let docPhoto: string | undefined = undefined;
            try {
              const localClinicDocs = localStorage.getItem("dermai_clinic_doctors");
              if (localClinicDocs) {
                const parsed = JSON.parse(localClinicDocs);
                const localDoc = parsed.find(
                  (ld: any) => ld.id === doc.id || ld.email?.toLowerCase() === doc.email?.toLowerCase()
                );
                if (localDoc?.photo) docPhoto = localDoc.photo;
              }
              if (!docPhoto) {
                const doctorProfileStr = localStorage.getItem("dermai_doctor_profile");
                if (doctorProfileStr) {
                  const dp = JSON.parse(doctorProfileStr);
                  if (dp.email?.toLowerCase() === doc.email?.toLowerCase() && dp.photo) {
                    docPhoto = dp.photo;
                  }
                }
              }
            } catch {
              /* ignore */
            }

            return {
              id: doc.id,
              name: doc.name,
              email: doc.email,
              contactNumber: doc.contact_number || "",
              prcLicense: doc.prc_license || "",
              photo: docPhoto,
              specialization: docSpecs.map((s) => s.name).join(", "),
              specializations: docSpecs,
              clinicName: doc.clinic_name || clinicDisplayName,
              status: doc.status === "Inactive" ? "Inactive" : "Active",
            };
          });

        setAllDoctors(mapped);
        localStorage.setItem("dermai_clinic_doctors", JSON.stringify(mapped));
      }
    } catch {
      // Local state is used
    }
  };

  useEffect(() => {
    fetchSpecializations();
    fetchDoctors();

    // Listen for storage events (e.g. photo uploaded from doctor portal)
    const handleStorageUpdate = () => {
      try {
        const saved = localStorage.getItem("dermai_clinic_doctors");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            setAllDoctors(parsed);
          }
        }
      } catch {
        /* ignore */
      }
    };

    window.addEventListener("storage", handleStorageUpdate);
    return () => window.removeEventListener("storage", handleStorageUpdate);
  }, []);

  const resetForm = () => {
    setForm({
      name: "",
      email: "",
      contactNumber: "",
      prcLicense: "",
      selectedSpecializationIds: [],
    });
    setFormError("");
  };

  // Save new doctor & associate multiple specializations
  const saveDoctor = async () => {
    setFormError("");
    const { name, email, contactNumber, prcLicense, selectedSpecializationIds } = form;

    if (!name.trim()) {
      setFormError("Doctor name is required.");
      return;
    }
    if (!email.trim() || !/\S+@\S+\.\S+/.test(email)) {
      setFormError("Valid email is required.");
      return;
    }
    if (!contactNumber.trim()) {
      setFormError("Contact number is required.");
      return;
    }
    if (!prcLicense.trim()) {
      setFormError("PRC license number is required.");
      return;
    }
    if (selectedSpecializationIds.length === 0) {
      setFormError("Please select at least one specialization.");
      return;
    }

    const selectedSpecs = specializations.filter((s) =>
      selectedSpecializationIds.includes(s.id)
    );

    const newDoctorItem: DoctorAccount = {
      id: `doc-${Date.now()}`,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      contactNumber: contactNumber.trim(),
      prcLicense: prcLicense.trim(),
      specialization: selectedSpecs.map((s) => s.name).join(", "),
      specializations: selectedSpecs,
      clinicName: clinicDisplayName,
      status: "Active",
    };

    const nextDoctors = [newDoctorItem, ...allDoctors];
    setAllDoctors(nextDoctors);
    localStorage.setItem("dermai_clinic_doctors", JSON.stringify(nextDoctors));
    resetForm();
    setSuccessMsg(`Dr. ${name.trim()} added successfully.`);
    setTimeout(() => setSuccessMsg(""), 4000);

    // Optional background sync to Supabase if connected
    try {
      const { data: newDoc } = await supabase
        .from("doctors")
        .insert({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          contact_number: contactNumber.trim(),
          prc_license: prcLicense.trim(),
          clinic_name: clinicDisplayName,
          status: "Active",
        })
        .select()
        .single();

      if (newDoc) {
        const junctionRows = selectedSpecializationIds.map((specId) => ({
          doctor_id: newDoc.id,
          specialization_id: specId,
        }));
        await supabase.from("doctor_specializations").insert(junctionRows);
      }
    } catch {
      // Local state is preserved
    }
  };

  // Open Edit modal
  const handleOpenEdit = (doctor: DoctorAccount) => {
    setEditingDoctor(doctor);
    setEditForm({
      name: doctor.name,
      email: doctor.email,
      contactNumber: doctor.contactNumber || "",
      prcLicense: doctor.prcLicense || "",
      selectedSpecializationIds: doctor.specializations.map((s) => s.id),
    });
    setEditError("");
    setSelectedDoctorForDetails(null);
  };

  // Save Edit doctor changes
  const saveDoctorEdit = async () => {
    if (!editingDoctor) return;
    setEditError("");

    const { name, email, contactNumber, prcLicense, selectedSpecializationIds } = editForm;

    if (!name.trim()) {
      setEditError("Doctor name is required.");
      return;
    }
    if (!email.trim() || !/\S+@\S+\.\S+/.test(email)) {
      setEditError("Valid email is required.");
      return;
    }
    if (!contactNumber.trim()) {
      setEditError("Contact number is required.");
      return;
    }
    if (!prcLicense.trim()) {
      setEditError("PRC license number is required.");
      return;
    }
    if (selectedSpecializationIds.length === 0) {
      setEditError("Please select at least one specialization.");
      return;
    }

    const selectedSpecs = specializations.filter((s) =>
      selectedSpecializationIds.includes(s.id)
    );

    const updatedDoctors = allDoctors.map((doc) => {
      if (doc.id === editingDoctor.id) {
        return {
          ...doc,
          name: name.trim(),
          email: email.trim().toLowerCase(),
          contactNumber: contactNumber.trim(),
          prcLicense: prcLicense.trim(),
          specialization: selectedSpecs.map((s) => s.name).join(", "),
          specializations: selectedSpecs,
        };
      }
      return doc;
    });

    setAllDoctors(updatedDoctors);
    localStorage.setItem("dermai_clinic_doctors", JSON.stringify(updatedDoctors));

    // Sync updated info (PRC License, Email, Name, Phone) to doctor profile
    try {
      const storedDoctorProfile = localStorage.getItem("dermai_doctor_profile");
      if (storedDoctorProfile) {
        const dp = JSON.parse(storedDoctorProfile);
        if (dp.id === editingDoctor.id || dp.email?.toLowerCase() === editingDoctor.email?.toLowerCase()) {
          const updatedDp = {
            ...dp,
            fullName: name.trim(),
            email: email.trim().toLowerCase(),
            prcLicense: prcLicense.trim(),
            phone: contactNumber.trim(),
          };
          localStorage.setItem("dermai_doctor_profile", JSON.stringify(updatedDp));
        }
      }
    } catch {
      /* ignore */
    }

    setEditingDoctor(null);
    setSuccessMsg(`Dr. ${name.trim()} updated successfully.`);
    setTimeout(() => setSuccessMsg(""), 4000);

    // Optional background sync to Supabase if connected
    try {
      await supabase
        .from("doctors")
        .update({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          contact_number: contactNumber.trim(),
          prc_license: prcLicense.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingDoctor.id);

      await supabase
        .from("doctor_specializations")
        .delete()
        .eq("doctor_id", editingDoctor.id);

      const junctionRows = selectedSpecializationIds.map((specId) => ({
        doctor_id: editingDoctor.id,
        specialization_id: specId,
      }));
      await supabase.from("doctor_specializations").insert(junctionRows);
    } catch {
      // Local state is preserved
    }
  };

  // Toggle Doctor Active / Inactive status
  const toggleDoctorStatus = async (doctor: DoctorAccount) => {
    const nextStatus: "Active" | "Inactive" = doctor.status === "Active" ? "Inactive" : "Active";
    const updated = allDoctors.map((d) => (d.id === doctor.id ? { ...d, status: nextStatus } : d));
    setAllDoctors(updated);
    localStorage.setItem("dermai_clinic_doctors", JSON.stringify(updated));

    if (selectedDoctorForDetails && selectedDoctorForDetails.id === doctor.id) {
      setSelectedDoctorForDetails({
        ...selectedDoctorForDetails,
        status: nextStatus,
      });
    }

    setSuccessMsg(`Dr. ${doctor.name} set to ${nextStatus}.`);
    setTimeout(() => setSuccessMsg(""), 3000);

    try {
      await supabase
        .from("doctors")
        .update({
          status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", doctor.id);
    } catch {
      // Local state is preserved
    }
  };

  // Delete doctor
  const executeDelete = async () => {
    if (!deleteTarget) return;
    const filtered = allDoctors.filter((d) => d.id !== deleteTarget);
    setAllDoctors(filtered);
    localStorage.setItem("dermai_clinic_doctors", JSON.stringify(filtered));

    if (selectedDoctorForDetails?.id === deleteTarget) {
      setSelectedDoctorForDetails(null);
    }
    setDeleteTarget(null);
    setSuccessMsg("Doctor removed successfully.");
    setTimeout(() => setSuccessMsg(""), 4000);

    try {
      await supabase
        .from("doctors")
        .delete()
        .eq("id", deleteTarget);
    } catch {
      // Local state is preserved
    }
  };

  const scrollToForm = () => {
    formSectionRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400 font-medium mb-1">
            <span>Clinic</span>
            <span>&gt;</span>
            <span className="text-gray-700 font-semibold">Doctors</span>
          </div>
          <p className="text-sm text-gray-500">
            Add doctors to your clinic and assign them to patient appointments.
          </p>
        </div>
        <button
          onClick={scrollToForm}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#c0166a] text-white text-sm font-semibold hover:bg-[#a01258] shadow-sm hover:shadow transition-all"
        >
          <UserPlus className="w-4 h-4" /> Add Doctor
        </button>
      </div>

      {/* Success Notification */}
      {successMsg && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 px-4 py-3 rounded-xl bg-green-50 border border-green-200 text-green-700 text-sm font-medium"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 text-green-600" /> {successMsg}
        </motion.div>
      )}

      {/* New Doctor Account Form Card */}
      <div
        ref={formSectionRef}
        className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sm:p-7"
      >
        <h2 className="font-bold text-gray-900 mb-5 flex items-center gap-2 text-base">
          <Stethoscope className="w-4 h-4 text-magenta-500" /> New Doctor Account
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1.5">
              Full Name *
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Dr. Maria Santos"
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-[#c0166a] transition-all bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1.5">
              Email (used for login) *
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              placeholder="doctor@example.com"
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-[#c0166a] transition-all bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1.5">
              Contact Number *
            </label>
            <input
              type="text"
              value={form.contactNumber}
              onChange={(e) => setForm((p) => ({ ...p, contactNumber: e.target.value }))}
              placeholder="e.g. +63 917 123 4567"
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-[#c0166a] transition-all bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1.5">
              PRC License # *
            </label>
            <input
              type="text"
              value={form.prcLicense}
              onChange={(e) => setForm((p) => ({ ...p, prcLicense: e.target.value }))}
              placeholder="e.g. 0123456"
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-[#c0166a] transition-all bg-white"
            />
          </div>

          {/* Dynamic Multi-Select Specialization */}
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-gray-600">
                Specialization *
              </label>
              {loadingSpecializations && (
                <span className="text-[11px] text-gray-400 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading specializations...
                </span>
              )}
            </div>
            <SpecializationMultiSelect
              options={specializations}
              selectedIds={form.selectedSpecializationIds}
              onChange={(ids) => setForm((p) => ({ ...p, selectedSpecializationIds: ids }))}
              placeholder="Select one or more specializations..."
              disabled={loadingSpecializations || savingDoctor}
            />
          </div>
        </div>

        {formError && (
          <div className="mt-4 flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" /> {formError}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={resetForm}
            disabled={savingDoctor}
            className="px-5 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={saveDoctor}
            disabled={savingDoctor}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#c0166a] text-white text-sm font-semibold hover:bg-[#a01258] transition-colors disabled:opacity-60 shadow-sm"
          >
            {savingDoctor && <Loader2 className="w-4 h-4 animate-spin" />}
            Add Doctor
          </button>
        </div>
      </div>

      {/* Doctor List */}
      <div className="space-y-3">
        {loadingDoctors ? (
          <div className="bg-white rounded-2xl border border-gray-100 py-16 text-center">
            <Loader2 className="w-8 h-8 text-[#c0166a] animate-spin mx-auto mb-2" />
            <p className="text-xs text-gray-400">Loading doctors from database...</p>
          </div>
        ) : allDoctors.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-gray-200 py-16 text-center">
            <Stethoscope className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-600 font-medium">No doctors added yet.</p>
            <p className="text-xs text-gray-400 mt-1">
              Fill in the form above to add doctors to your clinic.
            </p>
          </div>
        ) : (
          allDoctors.map((doc, i) => (
            <motion.div
              key={doc.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5 flex items-center gap-4 hover:border-gray-200 transition-all"
            >
              {/* Doctor Avatar / Photo */}
              {doc.photo ? (
                <img
                  src={doc.photo}
                  alt={doc.name}
                  className="w-12 h-12 rounded-full object-cover border-2 border-pink-200 shadow-sm shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-50 to-pink-100/70 border border-pink-100 flex items-center justify-center shrink-0">
                  <Stethoscope className="w-5 h-5 text-[#c0166a]" />
                </div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-900 text-sm sm:text-base leading-tight">
                  {doc.name}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">{doc.email}</p>
                {doc.contactNumber && (
                  <p className="text-xs text-gray-400 mt-0.5">{doc.contactNumber}</p>
                )}

                {/* Specialization Tags */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {doc.specializations.length > 0 ? (
                    doc.specializations.map((spec) => (
                      <span
                        key={spec.id}
                        className="inline-block text-[11px] px-2.5 py-0.5 rounded-full bg-magenta-50 text-magenta-700 border border-magenta-100 font-semibold"
                      >
                        {spec.name}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-gray-400 italic">
                      No specialization assigned
                    </span>
                  )}
                </div>
              </div>

              {/* Status Badge */}
              <div className="shrink-0">
                <span
                  className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                    doc.status === "Active"
                      ? "bg-emerald-50 text-emerald-600 border border-emerald-100"
                      : "bg-gray-100 text-gray-500 border border-gray-200"
                  }`}
                >
                  {doc.status}
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 shrink-0">
                {/* View Details Eye Icon */}
                <button
                  type="button"
                  onClick={() => setSelectedDoctorForDetails(doc)}
                  className="p-2 rounded-xl text-gray-400 hover:text-[#c0166a] hover:bg-magenta-50 border border-transparent hover:border-magenta-100 transition-all"
                  title="View Doctor Details"
                >
                  <Eye className="w-4 h-4" />
                </button>

                {/* Remove Doctor */}
                <button
                  type="button"
                  onClick={() => setDeleteTarget(doc.id)}
                  className="p-2 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-100 transition-all"
                  title="Remove Doctor"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* Doctor Details Modal (Screenshot 2) */}
      <AnimatePresence>
        {selectedDoctorForDetails && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-100"
            >
              {/* Header */}
              <div className="px-6 pt-5 pb-3 flex items-start justify-between border-b border-gray-100">
                <div>
                  <h3 className="text-base font-bold text-gray-900">Doctor Details</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {selectedDoctorForDetails.clinicName}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedDoctorForDetails(null)}
                  className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 space-y-5">
                {/* Doctor Avatar + Name + Status */}
                <div className="flex items-center gap-3.5">
                  {selectedDoctorForDetails.photo ? (
                    <img
                      src={selectedDoctorForDetails.photo}
                      alt={selectedDoctorForDetails.name}
                      className="w-14 h-14 rounded-full object-cover border-2 border-pink-200 shadow-md shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-pink-50 border border-pink-100 flex items-center justify-center shrink-0">
                      <Stethoscope className="w-5 h-5 text-[#c0166a]" />
                    </div>
                  )}
                  <div>
                    <h4 className="font-bold text-gray-900 text-base leading-tight">
                      {selectedDoctorForDetails.name}
                    </h4>
                    <div className="mt-1">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                          selectedDoctorForDetails.status === "Active"
                            ? "bg-emerald-50 text-emerald-600 border border-emerald-100"
                            : "bg-gray-100 text-gray-500 border border-gray-200"
                        }`}
                      >
                        {selectedDoctorForDetails.status}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Information List */}
                <div className="space-y-3.5 pt-1 text-xs">
                  <div>
                    <p className="text-[10px] font-bold tracking-wider text-gray-400 uppercase">
                      EMAIL
                    </p>
                    <p className="font-medium text-gray-800 mt-0.5">
                      {selectedDoctorForDetails.email}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] font-bold tracking-wider text-gray-400 uppercase">
                      CONTACT NUMBER
                    </p>
                    <p className="font-medium text-gray-800 mt-0.5">
                      {selectedDoctorForDetails.contactNumber || "—"}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] font-bold tracking-wider text-gray-400 uppercase">
                      PRC LICENSE #
                    </p>
                    <p className="font-medium text-gray-800 mt-0.5">
                      {selectedDoctorForDetails.prcLicense || "—"}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] font-bold tracking-wider text-gray-400 uppercase mb-1">
                      SPECIALIZATION
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {selectedDoctorForDetails.specializations.length > 0 ? (
                        selectedDoctorForDetails.specializations.map((spec) => (
                          <span
                            key={spec.id}
                            className="inline-block text-[11px] px-2.5 py-0.5 rounded-full bg-magenta-50 text-magenta-700 border border-magenta-100 font-semibold"
                          >
                            {spec.name}
                          </span>
                        ))
                      ) : (
                        <p className="text-gray-400 italic">None</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 bg-gray-50/50 border-t border-gray-100 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => toggleDoctorStatus(selectedDoctorForDetails)}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-colors ${
                    selectedDoctorForDetails.status === "Active"
                      ? "text-red-600 hover:bg-red-50"
                      : "text-emerald-600 hover:bg-emerald-50"
                  }`}
                >
                  {selectedDoctorForDetails.status === "Active" ? "Set Inactive" : "Set Active"}
                </button>

                <button
                  type="button"
                  onClick={() => handleOpenEdit(selectedDoctorForDetails)}
                  className="px-5 py-2.5 rounded-xl bg-[#c0166a] text-white text-xs font-semibold hover:bg-[#a01258] transition-colors shadow-sm"
                >
                  Edit Info
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Doctor Modal (Screenshot 3) */}
      <AnimatePresence>
        {editingDoctor && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-100 max-h-[90vh] flex flex-col"
            >
              {/* Header */}
              <div className="px-6 pt-5 pb-3 flex items-start justify-between border-b border-gray-100 shrink-0">
                <div>
                  <h3 className="text-base font-bold text-gray-900">Edit Doctor</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{editingDoctor.clinicName}</p>
                </div>
                <button
                  onClick={() => setEditingDoctor(null)}
                  className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Form Body */}
              <div className="p-6 overflow-y-auto space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1.5">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-[#c0166a] transition-all bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1.5">
                    Email *
                  </label>
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-[#c0166a] transition-all bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1.5">
                    Contact Number *
                  </label>
                  <input
                    type="text"
                    value={editForm.contactNumber}
                    onChange={(e) => setEditForm((p) => ({ ...p, contactNumber: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-[#c0166a] transition-all bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1.5">
                    PRC License # *
                  </label>
                  <input
                    type="text"
                    value={editForm.prcLicense}
                    onChange={(e) => setEditForm((p) => ({ ...p, prcLicense: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-[#c0166a] transition-all bg-white"
                  />
                </div>

                {/* Dynamic Multi-Select for Edit */}
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1.5">
                    Specialization *
                  </label>
                  <SpecializationMultiSelect
                    options={specializations}
                    selectedIds={editForm.selectedSpecializationIds}
                    onChange={(ids) =>
                      setEditForm((p) => ({ ...p, selectedSpecializationIds: ids }))
                    }
                    placeholder="Select specializations..."
                    disabled={savingEdit}
                  />
                </div>

                {editError && (
                  <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0" /> {editError}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 bg-gray-50/50 border-t border-gray-100 flex items-center justify-end gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditingDoctor(null)}
                  disabled={savingEdit}
                  className="px-5 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveDoctorEdit}
                  disabled={savingEdit}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#c0166a] text-white text-sm font-semibold hover:bg-[#a01258] transition-colors disabled:opacity-60 shadow-sm"
                >
                  {savingEdit && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deleteTarget && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6"
            >
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-6 h-6 text-red-500" />
              </div>
              <h3 className="text-center font-bold text-gray-900 mb-2">Remove Doctor?</h3>
              <p className="text-center text-sm text-gray-500 mb-5">
                This will remove the doctor account and all their specialization associations from
                the database.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deletingDoctor}
                  className="py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={executeDelete}
                  disabled={deletingDoctor}
                  className="inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors disabled:opacity-60"
                >
                  {deletingDoctor && <Loader2 className="w-4 h-4 animate-spin" />}
                  Remove
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
