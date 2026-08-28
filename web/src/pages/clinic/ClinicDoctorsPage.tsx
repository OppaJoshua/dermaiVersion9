import { useState } from "react";
import { UserPlus, Trash2, Stethoscope, AlertCircle, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useClinicVerification } from "@/hooks/useClinicVerification";
export type DoctorAccount = {
    id: string;
    name: string;
    email: string;
    password: string;
    prcLicense?: string;
    specialization: string;
    clinicName: string;
};
const SPECIALIZATIONS = [
    "General Dermatology",
    "Cosmetic Dermatology",
    "Pediatric Dermatology",
    "Surgical Dermatology",
    "Dermatopathology",
    "Immunodermatology",
    "Fungal & Parasitic Infections",
    "Pigmentation Disorders",
    "Acne & Rosacea",
    "Eczema & Dermatitis",
];
export default function ClinicDoctorsPage() {
    const { clinicName } = useClinicVerification();
    const [form, setForm] = useState({
        name: "",
        email: "",
        password: "doctor1234",
        prcLicense: "",
        specialization: SPECIALIZATIONS[0],
    });
    const [formError, setFormError] = useState("");
    const [successMsg, setSuccessMsg] = useState("");
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
    // TODO: Load doctors for this clinic from Supabase
    const [allDoctors, setAllDoctors] = useState<DoctorAccount[]>([]);
    const saveDoctor = () => {
        setFormError("");
        const { name, email, password, prcLicense, specialization } = form;
        if (!name.trim()) {
            setFormError("Doctor name is required.");
            return;
        }
        if (!email.trim() || !/\S+@\S+\.\S+/.test(email)) {
            setFormError("Valid email is required.");
            return;
        }
        if (!password.trim() || password.length < 6) {
            setFormError("Password must be at least 6 characters.");
            return;
        }
        if (!prcLicense.trim()) {
            setFormError("PRC license number is required.");
            return;
        }
        // TODO: Create doctor account in Supabase
        const newDoc: DoctorAccount = {
            id: `doctor-${Date.now()}`,
            name: name.trim(),
            email: email.trim().toLowerCase(),
            password,
            prcLicense: prcLicense.trim(),
            specialization,
            clinicName,
        };
        setAllDoctors((prev) => [newDoc, ...prev]);
        setForm({ name: "", email: "", password: "doctor1234", prcLicense: "", specialization: SPECIALIZATIONS[0] });
        setSuccessMsg(`Dr. ${name.trim()} added successfully.`);
        setTimeout(() => setSuccessMsg(""), 4000);
    };
    const confirmDelete = (id: string) => setDeleteTarget(id);
    const executeDelete = () => {
        if (!deleteTarget)
            return;
        // TODO: Delete doctor in Supabase
        setAllDoctors((prev) => prev.filter((d) => d.id !== deleteTarget));
        setDeleteTarget(null);
    };
    return (<div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Manage Doctors</h1>
          <p className="text-sm text-gray-400 mt-0.5">Add doctors to your clinic and assign them to patient appointments.</p>
        </div>
        <button onClick={() => { setForm({ name: "", email: "", password: "doctor1234", prcLicense: "", specialization: SPECIALIZATIONS[0] }); setFormError(""); }} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#c0166a] text-white text-sm font-semibold hover:bg-[#a01258] transition-colors">
          <UserPlus className="w-4 h-4"/> Clear Form
        </button>
      </div>

      {successMsg && (<div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-green-50 border border-green-200 text-green-700 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0"/> {successMsg}
        </div>)}

      {/* Add Form */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <h2 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-magenta-500"/> New Doctor Account
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1.5">Full Name *</label>
                  <input type="text" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Dr. Maria Santos" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-magenta-500/20"/>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1.5">Email (used for login) *</label>
                  <input type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} placeholder="doctor@example.com" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-magenta-500/20"/>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1.5">PRC License # *</label>
                  <input type="text" value={form.prcLicense} onChange={(e) => setForm((p) => ({ ...p, prcLicense: e.target.value }))} placeholder="e.g. 0123456" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-magenta-500/20"/>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1.5">Specialization *</label>
                  <select value={form.specialization} onChange={(e) => setForm((p) => ({ ...p, specialization: e.target.value }))} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-magenta-500/20 bg-white">
                    {SPECIALIZATIONS.map((s) => (<option key={s} value={s}>{s}</option>))}
                  </select>
                </div>
              </div>

              {formError && (<div className="mt-3 flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0"/> {formError}
                </div>)}

              <div className="mt-4 flex justify-end gap-3">
                <button onClick={() => { setForm({ name: "", email: "", password: "doctor1234", prcLicense: "", specialization: SPECIALIZATIONS[0] }); setFormError(""); }} className="px-5 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={saveDoctor} className="px-5 py-2.5 rounded-xl bg-[#c0166a] text-white text-sm font-semibold hover:bg-[#a01258] transition-colors">
                  Add Doctor
                </button>
              </div>
      </div>

      {/* Doctor list */}
      {allDoctors.length === 0 ? (<div className="bg-white rounded-2xl border border-dashed border-gray-200 py-16 text-center">
          <Stethoscope className="w-10 h-10 text-gray-200 mx-auto mb-3"/>
          <p className="text-sm text-gray-500 font-medium">No doctors added yet.</p>
          <p className="text-xs text-gray-400 mt-1">Click "Add Doctor" to create doctor accounts for your clinic.</p>
        </div>) : (<div className="grid gap-3">
          {allDoctors.map((doc, i) => (<motion.div key={doc.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-magenta-100 to-pink-100 flex items-center justify-center shrink-0">
                <Stethoscope className="w-5 h-5 text-[#c0166a]"/>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900">{doc.name}</p>
                <p className="text-xs text-gray-500">{doc.email}</p>
                <span className="mt-1 inline-block text-[10px] px-2 py-0.5 rounded-full bg-magenta-50 text-magenta-700 border border-magenta-100 font-semibold">
                  {doc.specialization}
                </span>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600">Active</span>
              <button onClick={() => confirmDelete(doc.id)} className="p-2 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Remove doctor">
                <Trash2 className="w-4 h-4"/>
              </button>
            </motion.div>))}
        </div>)}

      {/* Delete confirm modal */}
      <AnimatePresence>
        {deleteTarget && (<div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-6 h-6 text-red-500"/>
              </div>
              <h3 className="text-center font-bold text-gray-900 mb-2">Remove Doctor?</h3>
              <p className="text-center text-sm text-gray-500 mb-5">
                This will remove the doctor account. They will no longer be able to log in.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setDeleteTarget(null)} className="py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={executeDelete} className="py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors">
                  Remove
                </button>
              </div>
            </motion.div>
          </div>)}
      </AnimatePresence>
    </div>);
}
