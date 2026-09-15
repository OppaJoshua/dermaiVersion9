import { useState, useMemo, useEffect } from "react";
import {
  Users,
  Search,
  UserCheck,
  Clock,
  X,
  User,
  Phone,
  Mail,
  MapPin,
  Sparkles,
  Maximize2,
  ClipboardList,
  FileText,
  Stethoscope,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { useClinicVerification } from "@/hooks/useClinicVerification";

export type ClinicPatient = {
  id: string;
  name: string;
  age?: number;
  gender?: string;
  birthdate?: string;
  email: string;
  phone?: string;
  address?: string;
  condition?: string;
  confidence?: number;
  skinPhotoUrl?: string;
  questionnaireAnswers?: Array<{
    question: string;
    answer: string;
    severity?: number;
    points?: number;
  }>;
  assignedDoctor?: string;
  lastVisit?: string;
  totalVisits: number;
  status: "active" | "completed" | "pending" | "cancelled";
  notes?: string;
  clinicNote?: string;
  doctorNote?: string;
  createdAt?: string;
};

const statusBadges: Record<string, string> = {
  active: "bg-blue-50 text-blue-700 border-blue-200",
  completed: "bg-green-50 text-green-700 border-green-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
};

function calculateAge(birthdateStr?: string): number | undefined {
  if (!birthdateStr) return undefined;
  const bdate = new Date(birthdateStr);
  if (isNaN(bdate.getTime())) return undefined;
  const today = new Date();
  let age = today.getFullYear() - bdate.getFullYear();
  const m = today.getMonth() - bdate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < bdate.getDate())) {
    age--;
  }
  return age >= 0 ? age : undefined;
}

function parseQuestionnaireAnswers(raw: any): Array<{ question: string; answer: string; severity?: number; points?: number }> {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return [];
    }
  }
  return [];
}

export default function ClinicPatientsPage() {
  const { clinicId } = useClinicVerification();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedPatient, setSelectedPatient] = useState<ClinicPatient | null>(null);
  const [patients, setPatients] = useState<ClinicPatient[]>([]);
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);

  useEffect(() => {
    async function loadPatients() {
      try {
        let resolvedClinicId = clinicId;
        if (!resolvedClinicId) {
          try {
            const cache = localStorage.getItem("dermai_clinic_profile_cache");
            if (cache) {
              const parsed = JSON.parse(cache);
              if (parsed.clinicId) resolvedClinicId = parsed.clinicId;
            }
          } catch { }
        }

        // 1. Fetch clinic doctors to map assigned_doctor_id to real doctor name
        const docMap = new Map<string, string>();
        if (resolvedClinicId) {
          const { data: docRows } = await supabase
            .from("clinic_doctor")
            .select("doctor_id, doctor_name")
            .eq("clinic_id", resolvedClinicId);
          if (docRows) {
            docRows.forEach((d: any) => {
              if (d.doctor_id && d.doctor_name) {
                docMap.set(String(d.doctor_id), d.doctor_name);
              }
            });
          }
        }
        try {
          const rawDocs = localStorage.getItem("dermai_clinic_doctors");
          if (rawDocs) {
            const parsedDocs = JSON.parse(rawDocs);
            if (Array.isArray(parsedDocs)) {
              parsedDocs.forEach((d: any) => {
                if (d.id && d.name) {
                  docMap.set(String(d.id), d.name);
                }
              });
            }
          }
        } catch { }

        // 2. Fetch patient appointments
        let query = supabase
          .from("patient_appointment")
          .select("*")
          .order("created_at", { ascending: false });

        if (resolvedClinicId) {
          query = query.eq("clinic_id", resolvedClinicId);
        }

        const { data } = await query;
        const patientMap = new Map<string, ClinicPatient>();

        if (data && data.length > 0) {
          data.forEach((row) => {
            const email = row.patient_email || `patient_${(row.appointment_id || "").slice(0, 6)}@dermai.local`;
            const name = row.patient_name || email.split("@")[0];
            const phone = row.patient_contact || "";
            const address = row.patient_address || "";
            const gender = row.patient_gender || "";
            const birthdate = row.patient_birthdate || "";
            const age = calculateAge(birthdate);
            const isCompleted = row.status === "completed";
            const isPending = row.status === "pending";
            const isCancelled = row.status === "cancelled" || row.status === "rejected";
            const isScheduled = row.status === "scheduled" || row.status === "confirmed";
            const confidence = row.ai_confidence ? Number(row.ai_confidence) : undefined;
            const questionnaireAnswers = parseQuestionnaireAnswers(row.questionnaire_answers);

            // Resolve real doctor name
            const rawDocName =
              row.assigned_doctor_name ||
              (row.assigned_doctor_id ? docMap.get(String(row.assigned_doctor_id)) : "") ||
              "";
            const formattedDoc = rawDocName
              ? rawDocName.toLowerCase().startsWith("dr.")
                ? rawDocName
                : `Dr. ${rawDocName}`
              : "Unassigned";

            let patientStatus: ClinicPatient["status"] = "active";
            if (isCompleted) patientStatus = "completed";
            else if (isPending) patientStatus = "pending";
            else if (isCancelled) patientStatus = "cancelled";
            else if (isScheduled) patientStatus = "active";
            else patientStatus = "active";

            if (!patientMap.has(email)) {
              patientMap.set(email, {
                id: row.user_id || row.appointment_id,
                name,
                email,
                phone,
                address,
                gender,
                birthdate,
                age,
                condition: row.ai_condition_name || "General Dermatology",
                confidence,
                skinPhotoUrl: row.skin_photo_url || undefined,
                questionnaireAnswers: questionnaireAnswers.length > 0 ? questionnaireAnswers : undefined,
                assignedDoctor: formattedDoc,
                lastVisit: row.date ? new Date(row.date).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" }) : "—",
                totalVisits: 1,
                status: patientStatus,
                notes: row.notes || (row.ai_condition_name ? `Noted Condition: ${row.ai_condition_name}` : ""),
                clinicNote: row.clinic_note || undefined,
                doctorNote: row.doctor_note || undefined,
                createdAt: row.created_at,
              });
            } else {
              const existing = patientMap.get(email)!;
              existing.totalVisits += 1;
              if (phone && !existing.phone) existing.phone = phone;
              if (address && !existing.address) existing.address = address;
              if (gender && !existing.gender) existing.gender = gender;
              if (birthdate && !existing.birthdate) {
                existing.birthdate = birthdate;
                existing.age = age;
              }
              if (formattedDoc !== "Unassigned") existing.assignedDoctor = formattedDoc;
              if (!existing.skinPhotoUrl && row.skin_photo_url) existing.skinPhotoUrl = row.skin_photo_url;
              if (!existing.questionnaireAnswers && questionnaireAnswers.length > 0) existing.questionnaireAnswers = questionnaireAnswers;
              if (isCompleted) existing.status = "completed";
              else if (isScheduled && existing.status !== "completed") existing.status = "active";
            }
          });
        }

        // Merge local storage appointments strictly matching this specific clinic_id
        try {
          const raw = localStorage.getItem("dermai_clinic_appointments");
          if (raw && resolvedClinicId) {
            const localList = JSON.parse(raw);
            if (Array.isArray(localList)) {
              localList.forEach((localItem: any) => {
                const isMatch = Boolean(localItem.clinicId && String(localItem.clinicId) === String(resolvedClinicId));
                if (isMatch) {
                  const email = localItem.patientEmail || `patient_${String(localItem.id).slice(-4)}@dermai.local`;
                  const name = localItem.patientName || "Patient";
                  const phone = localItem.patientContact || "";
                  const address = localItem.patientAddress || "";
                  const gender = localItem.patientGender || localItem.patient_gender || "";
                  const birthdate = localItem.patientBirthdate || localItem.patient_birthdate || "";
                  const age = localItem.patientAge || calculateAge(birthdate);
                  const isCompleted = localItem.status === "completed";
                  const isPending = localItem.status === "pending";
                  const isCancelled = localItem.status === "cancelled" || localItem.status === "rejected";
                  const isScheduled = localItem.status === "scheduled";
                  const confidence = localItem.aiConfidence ? Number(localItem.aiConfidence) : undefined;
                  const questionnaireAnswers = parseQuestionnaireAnswers(localItem.questionnaireAnswers || localItem.questionnaire_answers);

                  const rawDocName =
                    localItem.assignedDoctorName ||
                    (localItem.assignedDoctorId ? docMap.get(String(localItem.assignedDoctorId)) : "") ||
                    "";
                  const formattedDoc = rawDocName
                    ? rawDocName.toLowerCase().startsWith("dr.")
                      ? rawDocName
                      : `Dr. ${rawDocName}`
                    : "Unassigned";

                  let patientStatus: ClinicPatient["status"] = "active";
                  if (isCompleted) patientStatus = "completed";
                  else if (isPending) patientStatus = "pending";
                  else if (isCancelled) patientStatus = "cancelled";
                  else if (isScheduled) patientStatus = "active";
                  else patientStatus = "active";

                  if (!patientMap.has(email)) {
                    patientMap.set(email, {
                      id: localItem.id,
                      name,
                      email,
                      phone,
                      address,
                      gender,
                      birthdate,
                      age,
                      condition: localItem.aiConditionName || localItem.conditionName || "General Dermatology",
                      confidence,
                      skinPhotoUrl: localItem.skinPhotoUrl || undefined,
                      questionnaireAnswers: questionnaireAnswers.length > 0 ? questionnaireAnswers : undefined,
                      assignedDoctor: formattedDoc,
                      lastVisit: localItem.date ? new Date(localItem.date).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" }) : "—",
                      totalVisits: 1,
                      status: patientStatus,
                      notes: localItem.notes || (localItem.aiConditionName ? `Noted Condition: ${localItem.aiConditionName}` : ""),
                      clinicNote: localItem.clinicNote || undefined,
                      doctorNote: localItem.doctorNote || undefined,
                      createdAt: localItem.createdAt,
                    });
                  } else {
                    const existing = patientMap.get(email)!;
                    existing.totalVisits += 1;
                    if (phone && !existing.phone) existing.phone = phone;
                    if (address && !existing.address) existing.address = address;
                    if (gender && !existing.gender) existing.gender = gender;
                    if (birthdate && !existing.birthdate) {
                      existing.birthdate = birthdate;
                      existing.age = age;
                    }
                    if (formattedDoc !== "Unassigned") existing.assignedDoctor = formattedDoc;
                    if (isCompleted) existing.status = "completed";
                    else if (isCancelled && existing.status !== "completed") existing.status = "cancelled";
                    else if (isScheduled && existing.status !== "completed" && existing.status !== "cancelled") existing.status = "active";
                  }
                }
              });
            }
          }
        } catch { }

        setPatients(Array.from(patientMap.values()));
      } catch (err) {
        console.error("Error loading clinic patients:", err);
      }
    }
    loadPatients();

    const handleSync = () => loadPatients();
    window.addEventListener("dermai_appointments_updated", handleSync);
    window.addEventListener("appointmentCreated", handleSync);
    window.addEventListener("storage", handleSync);
    window.addEventListener("focus", handleSync);

    return () => {
      window.removeEventListener("dermai_appointments_updated", handleSync);
      window.removeEventListener("appointmentCreated", handleSync);
      window.removeEventListener("storage", handleSync);
      window.removeEventListener("focus", handleSync);
    };
  }, [clinicId]);

  const filteredPatients = useMemo(() => {
    return patients.filter((p) => {
      const matchesSearch =
        !search ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.email.toLowerCase().includes(search.toLowerCase()) ||
        (p.condition && p.condition.toLowerCase().includes(search.toLowerCase())) ||
        (p.assignedDoctor && p.assignedDoctor.toLowerCase().includes(search.toLowerCase()));

      const matchesStatus = statusFilter === "all" || p.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [patients, search, statusFilter]);

  const activeCount = patients.filter((p) => p.status === "active").length;
  const completedCount = patients.filter((p) => p.status === "completed").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-display font-bold text-gray-900">Patient Records</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          View and manage patient history, consultation status, and clinic visits.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Total Patients</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{patients.length}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-magenta-50 flex items-center justify-center text-magenta-600">
              <Users className="w-5 h-5" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Active Treatments</p>
              <p className="text-2xl font-bold text-blue-600 mt-1">{activeCount}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
              <Clock className="w-5 h-5" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Completed Cases</p>
              <p className="text-2xl font-bold text-green-600 mt-1">{completedCount}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center text-green-600">
              <UserCheck className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-xs flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search patients by name, email, condition, or doctor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-xl bg-gray-50 border border-gray-100 outline-none focus:border-magenta-500 focus:bg-white transition-all"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {["all", "active", "completed", "pending", "cancelled"].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={cn(
                "px-3.5 py-2 rounded-xl text-xs font-semibold capitalize transition-all",
                statusFilter === status
                  ? "bg-magenta-500 text-white shadow-xs"
                  : "bg-gray-50 text-gray-600 hover:bg-gray-100"
              )}
            >
              {status === "cancelled" ? "Declined" : status}
            </button>
          ))}
        </div>
      </div>

      {/* Patients Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-6 py-3.5">Patient</th>
                <th className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-6 py-3.5">Condition</th>
                <th className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-6 py-3.5">Assigned Doctor</th>
                <th className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-6 py-3.5">Last Visit</th>
                <th className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-6 py-3.5">Visits</th>
                <th className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-6 py-3.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredPatients.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center">
                    <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-3 text-gray-300">
                      <Users className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-semibold text-gray-900">No patients found</p>
                    <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
                      Patients who schedule appointments or consultations with your clinic will appear here.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredPatients.map((patient) => (
                  <tr
                    key={patient.id}
                    onClick={() => setSelectedPatient(patient)}
                    className="hover:bg-gray-50/60 transition-colors cursor-pointer"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-pink-100 text-[#c0166a] flex items-center justify-center font-bold text-sm">
                          {patient.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{patient.name}</p>
                          <p className="text-xs text-gray-400">{patient.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700 font-medium">{patient.condition || "—"}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {patient.assignedDoctor && patient.assignedDoctor !== "Unassigned" ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-magenta-900 bg-pink-50 px-2.5 py-1 rounded-lg border border-pink-100 text-xs">
                          <Stethoscope className="w-3 h-3 text-[#c0166a]" />
                          {patient.assignedDoctor}
                        </span>
                      ) : (
                        <span className="text-gray-400 italic text-xs">Unassigned</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-500">{patient.lastVisit || "—"}</td>
                    <td className="px-6 py-4 text-sm font-semibold text-gray-700">{patient.totalVisits}</td>
                    <td className="px-6 py-4">
                      <span
                        className={cn(
                          "text-xs px-2.5 py-1 rounded-full font-semibold capitalize border",
                          statusBadges[patient.status] || "bg-gray-100 text-gray-600"
                        )}
                      >
                        {patient.status === "cancelled" ? "Declined" : patient.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Patient Detail Modal */}
      <AnimatePresence>
        {selectedPatient && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setSelectedPatient(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-gray-100 flex flex-col max-h-[90vh] overflow-hidden text-left"
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-gray-100 bg-white flex items-center justify-between">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-full bg-pink-100 text-[#c0166a] flex items-center justify-center text-lg font-bold border-2 border-pink-200 shrink-0">
                    {selectedPatient.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-bold text-gray-900">{selectedPatient.name}</h3>
                      <span className={cn("text-[10px] px-2.5 py-0.5 rounded-full font-bold border capitalize", statusBadges[selectedPatient.status])}>
                        {selectedPatient.status === "cancelled" ? "Declined" : selectedPatient.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                      {selectedPatient.gender && (
                        <span className="font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded-md text-[11px]">
                          {selectedPatient.gender}
                        </span>
                      )}
                      {selectedPatient.age ? (
                        <span>{selectedPatient.age} years old</span>
                      ) : null}
                      {selectedPatient.birthdate && (
                        <span className="text-gray-400">
                          • Born {new Date(selectedPatient.birthdate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedPatient(null)}
                  className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                  title="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Body */}
              <div className="p-6 space-y-5 overflow-y-auto flex-1">
                {/* Personal & Contact Details */}
                <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-gray-200/60 pb-2">
                    <span className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-magenta-600" /> Personal &amp; Contact Details
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="font-semibold text-gray-400 block text-[10px] uppercase">Full Name</span>
                      <span className="text-gray-900 font-medium">{selectedPatient.name}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-gray-400 block text-[10px] uppercase">Gender &amp; Age</span>
                      <span className="text-gray-900 font-medium">
                        {selectedPatient.gender || "Not specified"}
                        {selectedPatient.age ? ` • ${selectedPatient.age} yrs old` : ""}
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-gray-400 block text-[10px] uppercase">Date of Birth</span>
                      <span className="text-gray-900 font-medium">
                        {selectedPatient.birthdate
                          ? new Date(selectedPatient.birthdate).toLocaleDateString("en-US", {
                              month: "long",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "—"}
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-gray-400 block text-[10px] uppercase">Contact Number</span>
                      {selectedPatient.phone ? (
                        <a
                          href={`tel:${selectedPatient.phone}`}
                          className="text-magenta-700 font-medium hover:underline inline-flex items-center gap-1"
                        >
                          <Phone className="w-3 h-3 text-magenta-500" />
                          {selectedPatient.phone}
                        </a>
                      ) : (
                        <span className="text-gray-400 italic">—</span>
                      )}
                    </div>
                    <div>
                      <span className="font-semibold text-gray-400 block text-[10px] uppercase">Email Address</span>
                      {selectedPatient.email ? (
                        <a
                          href={`mailto:${selectedPatient.email}`}
                          className="text-magenta-700 font-medium hover:underline inline-flex items-center gap-1 truncate max-w-full"
                        >
                          <Mail className="w-3 h-3 text-magenta-500 shrink-0" />
                          <span className="truncate">{selectedPatient.email}</span>
                        </a>
                      ) : (
                        <span className="text-gray-400 italic">—</span>
                      )}
                    </div>
                    <div>
                      <span className="font-semibold text-gray-400 block text-[10px] uppercase">Home Address</span>
                      <span className="text-gray-900 font-medium flex items-start gap-1">
                        <MapPin className="w-3 h-3 text-gray-400 mt-0.5 shrink-0" />
                        <span>{selectedPatient.address || "—"}</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* AI Scan & Clinical Diagnosis */}
                <div className="rounded-2xl border border-magenta-100 bg-white p-4 space-y-3 shadow-xs">
                  <div className="flex items-center justify-between border-b border-pink-100 pb-2">
                    <span className="text-xs font-bold text-magenta-900 uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-magenta-600" /> AI Scan &amp; Clinical Diagnosis
                    </span>
                    {selectedPatient.confidence !== undefined && (
                      <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-magenta-100 text-magenta-800">
                        {selectedPatient.confidence}% AI Confidence
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                    <div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Noted Condition</p>
                      <p className="text-sm font-bold text-gray-900">
                        {selectedPatient.condition || "General Dermatology Consultation"}
                      </p>
                      {selectedPatient.confidence !== undefined && (
                        <div className="mt-2 space-y-1">
                          <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                selectedPatient.confidence >= 85
                                  ? "bg-green-500"
                                  : selectedPatient.confidence >= 60
                                  ? "bg-amber-500"
                                  : "bg-magenta-500"
                              }`}
                              style={{ width: `${Math.min(100, selectedPatient.confidence)}%` }}
                            />
                          </div>
                          <p className="text-[10px] text-gray-400">Pre-screened with DermAI neural diagnostic engine.</p>
                        </div>
                      )}
                    </div>

                    {/* Skin Photo */}
                    <div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 flex items-center justify-between">
                        <span>Uploaded Skin Photo</span>
                        {selectedPatient.skinPhotoUrl && (
                          <span className="text-[10px] text-magenta-600 font-semibold cursor-pointer hover:underline" onClick={() => setLightboxPhoto(selectedPatient.skinPhotoUrl!)}>
                            Click to enlarge
                          </span>
                        )}
                      </p>
                      {selectedPatient.skinPhotoUrl ? (
                        <div
                          onClick={() => setLightboxPhoto(selectedPatient.skinPhotoUrl!)}
                          className="relative group rounded-2xl border border-gray-200 overflow-hidden bg-gray-50 cursor-pointer aspect-video flex items-center justify-center hover:border-magenta-400 transition-all"
                        >
                          <img
                            src={selectedPatient.skinPhotoUrl}
                            alt="Patient skin condition"
                            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-200"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-semibold">
                            <Maximize2 className="w-4 h-4" /> Expand Photo
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-6 text-center text-xs text-gray-400 italic">
                          No skin photo on file.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Questionnaire Responses */}
                {selectedPatient.questionnaireAnswers && selectedPatient.questionnaireAnswers.length > 0 && (
                  <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-xs">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ClipboardList className="w-4 h-4 text-magenta-600" />
                        <span className="text-xs font-bold text-gray-900 uppercase tracking-wide">
                          Patient Pre-Screening Questionnaire
                        </span>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-pink-100 text-[#c0166a]">
                        {selectedPatient.questionnaireAnswers.length} responses
                      </span>
                    </div>
                    <div className="p-4 space-y-2.5 max-h-56 overflow-y-auto">
                      {selectedPatient.questionnaireAnswers.map((qa, idx) => (
                        <div key={idx} className="p-2.5 rounded-xl bg-gray-50/80 border border-gray-100 text-xs space-y-1">
                          <p className="font-semibold text-gray-800">
                            {idx + 1}. {qa.question}
                          </p>
                          <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
                            <span className="text-magenta-700 font-semibold bg-pink-50 px-2.5 py-0.5 rounded-md border border-pink-100">
                              {qa.answer}
                            </span>
                            {qa.severity !== undefined && qa.severity !== null && (
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                  qa.severity >= 3
                                    ? "bg-red-100 text-red-700"
                                    : qa.severity >= 2
                                    ? "bg-amber-100 text-amber-700"
                                    : qa.severity >= 1
                                    ? "bg-blue-100 text-blue-700"
                                    : "bg-gray-100 text-gray-600"
                                }`}
                              >
                                Severity Level {qa.severity}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Patient Notes */}
                {selectedPatient.notes && (
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <FileText className="w-3 h-3" /> Patient Symptoms &amp; Notes
                    </p>
                    <div className="text-xs text-gray-800 bg-gray-50 border border-gray-100 rounded-2xl p-3.5 leading-relaxed">
                      {selectedPatient.notes}
                    </div>
                  </div>
                )}

                {/* Clinic Decline Note if present */}
                {selectedPatient.clinicNote && (
                  <div className="rounded-2xl border border-red-200 bg-red-50/70 p-4 space-y-1 text-xs">
                    <span className="font-bold text-red-700 uppercase tracking-wider block text-[10px]">
                      Clinic Scheduling / Decline Note:
                    </span>
                    <p className="text-red-900 font-medium">{selectedPatient.clinicNote}</p>
                  </div>
                )}

                {/* Consultation & Visit Overview */}
                <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 space-y-2 text-xs">
                  <span className="font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5 border-b border-gray-200/60 pb-2">
                    <Stethoscope className="w-3.5 h-3.5 text-blue-600" /> Clinic Consultation Overview
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    <div>
                      <span className="text-gray-400 font-semibold block text-[10px] uppercase">Assigned Doctor</span>
                      <span className="text-gray-900 font-medium">
                        {selectedPatient.assignedDoctor && selectedPatient.assignedDoctor !== "Unassigned"
                          ? selectedPatient.assignedDoctor
                          : "Not yet assigned"}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400 font-semibold block text-[10px] uppercase">Last Visit Date</span>
                      <span className="text-gray-900 font-medium">{selectedPatient.lastVisit || "—"}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 font-semibold block text-[10px] uppercase">Total Clinic Visits</span>
                      <span className="text-gray-900 font-bold">{selectedPatient.totalVisits} visit(s)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 border-t border-gray-100 bg-white">
                <button
                  onClick={() => setSelectedPatient(null)}
                  className="w-full py-3 rounded-full font-semibold text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Fullscreen Skin Photo Lightbox Modal ─────────────────── */}
      <AnimatePresence>
        {lightboxPhoto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-60 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
            onClick={() => setLightboxPhoto(null)}
          >
            <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setLightboxPhoto(null)}
                className="absolute -top-12 right-0 p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors cursor-pointer"
                title="Close fullscreen preview"
              >
                <X className="w-6 h-6" />
              </button>
              <img
                src={lightboxPhoto}
                alt="Enlarged skin lesion inspection"
                className="max-h-[82vh] max-w-[90vw] object-contain rounded-2xl shadow-2xl border border-white/20 bg-black/40"
              />
              <p className="text-xs text-white/70 mt-3 font-medium">Click outside or press X to close</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
