import { useState, useMemo, useEffect } from "react";
import {
  Users,
  Search,
  CheckCircle2,
  Calendar,
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
  Eye,
  RotateCcw,
  Clock,
  AlertCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { useClinicVerification } from "@/hooks/useClinicVerification";
import { LazySkinPhoto } from "@/components/common/LazySkinPhoto";
import { getSignedSkinPhotoUrl } from "@/lib/storageUtils";
import { isAppointmentPastScheduled } from "@/lib/schedulingService";

/* ── Types ────────────────────────────────────────────────────────── */

export type PatientAppointment = {
  id: string;
  dateStr: string;
  rawDate?: string;
  timeStr: string;
  status: "pending" | "scheduled" | "confirmed" | "accepted" | "completed" | "cancelled" | "rejected" | string;
  checkInStatus?: "scheduled" | "arrived" | "in-consultation" | "completed" | "no-show";
  doctorStatus?: "pending-review" | "approved" | "rejected";
  assignedDoctorId?: string;
  assignedDoctorName?: string;
  conditionName?: string;
  confidence?: number;
  skinPhotoUrl?: string;
  questionnaireAnswers?: Array<{
    question: string;
    answer: string;
    severity?: number;
    points?: number;
  }>;
  notes?: string;
  clinicNote?: string;
  doctorNote?: string;
  doctorReviewedAt?: string;
  createdAt: string;
  queueNumber?: number;
};

export type ClinicPatient = {
  id: string; // Unique deduplicated key (user_id or normalized email)
  userId?: string;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  gender?: string;
  birthdate?: string;
  age?: number;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyRelationship?: string;
  totalAppointments: number;
  lastAppointment?: PatientAppointment;
  appointments: PatientAppointment[];
  assignedDoctors: Array<{ id?: string; name: string }>;
};

export type RegisteredDoctor = {
  id: string;
  name: string;
  email?: string;
  photoUrl?: string;
};

/* ── Helper Functions ─────────────────────────────────────────────── */

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

function parseQuestionnaireAnswers(
  raw: any
): Array<{ question: string; answer: string; severity?: number; points?: number }> {
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

function formatApptDate(dateInput?: string | null): string {
  if (!dateInput) return "—";
  try {
    const clean = dateInput.split("T")[0];
    const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      const d = new Date(year, month, day);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }
    const d = new Date(dateInput);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }
    return dateInput;
  } catch {
    return dateInput || "—";
  }
}

function formatApptTime(timeInput?: string | null, batchTime?: string | null): string {
  if (batchTime && batchTime !== "—") {
    return batchTime.toLowerCase().includes("batch") ? batchTime : `${batchTime} Batch`;
  }
  if (timeInput && timeInput !== "—") return timeInput;
  return "Schedule pending";
}

function formatDoctorName(name?: string): string {
  if (!name) return "Unassigned";
  const clean = name.trim();
  if (clean.toLowerCase().startsWith("dr.")) return clean;
  return `Dr. ${clean}`;
}

/* ── Main Component ───────────────────────────────────────────────── */

export default function ClinicPatientsPage() {
  const { clinicId, clinicName } = useClinicVerification();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "upcoming" | "completed" | "cancelled">("all");
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>("all");
  const [selectedPatient, setSelectedPatient] = useState<ClinicPatient | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);

  const [patients, setPatients] = useState<ClinicPatient[]>([]);
  const [registeredDoctors, setRegisteredDoctors] = useState<RegisteredDoctor[]>([]);
  const [loading, setLoading] = useState(true);

  // 1. Fetch real Supabase clinic data & deduplicate unique patients
  useEffect(() => {
    let isCancelled = false;

    async function loadPatientDirectory() {
      setLoading(true);
      try {
        // Resolve clinic identity
        let resolvedClinicId = clinicId;
        let resolvedClinicName = clinicName;
        if (!resolvedClinicId || !resolvedClinicName) {
          try {
            const cache = localStorage.getItem("dermai_clinic_profile_cache");
            if (cache) {
              const parsed = JSON.parse(cache);
              if (parsed.clinicId && !resolvedClinicId) resolvedClinicId = parsed.clinicId;
              if (parsed.clinicName && !resolvedClinicName) resolvedClinicName = parsed.clinicName;
            }
          } catch { }
        }

        // 1. Fetch registered clinic doctors
        const docMap = new Map<string, string>();
        const doctorsList: RegisteredDoctor[] = [];

        if (resolvedClinicId) {
          try {
            const { data: docRows } = await supabase
              .from("clinic_doctor")
              .select("doctor_id, doctor_name, email, photo_url, status")
              .eq("clinic_id", resolvedClinicId);

            if (docRows && docRows.length > 0) {
              docRows.forEach((d: any) => {
                if (d.doctor_id && d.doctor_name) {
                  const formatted = formatDoctorName(d.doctor_name);
                  docMap.set(String(d.doctor_id), formatted);
                  if (String(d.status || "").toLowerCase() !== "inactive") {
                    doctorsList.push({
                      id: String(d.doctor_id),
                      name: formatted,
                      email: d.email || undefined,
                      photoUrl: d.photo_url || undefined,
                    });
                  }
                }
              });
            }
          } catch (docErr) {
            console.warn("[ClinicPatientsPage] Failed to fetch clinic_doctor:", docErr);
          }
        }

        // Merge doctors from local storage cache if available
        try {
          const rawDocs = localStorage.getItem("dermai_clinic_doctors");
          if (rawDocs) {
            const parsedDocs = JSON.parse(rawDocs);
            if (Array.isArray(parsedDocs)) {
              parsedDocs.forEach((d: any) => {
                if (d.id && d.name) {
                  const formatted = formatDoctorName(d.name);
                  docMap.set(String(d.id), formatted);
                  if (!doctorsList.some((doc) => doc.id === String(d.id))) {
                    doctorsList.push({
                      id: String(d.id),
                      name: formatted,
                      email: d.email || undefined,
                      photoUrl: d.photo || d.photo_url || undefined,
                    });
                  }
                }
              });
            }
          }
        } catch { }

        if (!isCancelled) {
          setRegisteredDoctors(doctorsList);
        }

        // 2. Fetch appointments from patient_appointment table in Supabase
        let dbAppts: any[] = [];
        if (resolvedClinicId) {
          const { data: apptRows, error: apptErr } = await supabase
            .from("patient_appointment")
            .select("*")
            .eq("clinic_id", resolvedClinicId)
            .order("created_at", { ascending: false });

          if (!apptErr && apptRows && apptRows.length > 0) {
            dbAppts = apptRows;
          } else {
            // Fallback: in case of string-vs-uuid mismatch, fetch and filter client-side
            const { data: allRows } = await supabase
              .from("patient_appointment")
              .select("*")
              .order("created_at", { ascending: false })
              .limit(300);

            if (allRows && allRows.length > 0) {
              dbAppts = allRows.filter(
                (r: any) => r.clinic_id && String(r.clinic_id) === String(resolvedClinicId)
              );
            }
          }
        }

        // Merge with local appointments cache for this clinic
        try {
          const raw = localStorage.getItem("dermai_clinic_appointments");
          if (raw) {
            const localList = JSON.parse(raw);
            if (Array.isArray(localList)) {
              localList.forEach((localItem: any) => {
                const isMatch = Boolean(
                  (resolvedClinicId && localItem.clinicId && String(localItem.clinicId) === String(resolvedClinicId)) ||
                  (resolvedClinicName && localItem.clinicName && localItem.clinicName.toLowerCase().trim() === resolvedClinicName.toLowerCase().trim()) ||
                  (!resolvedClinicId && !resolvedClinicName)
                );
                if (isMatch) {
                  const alreadyInDb = dbAppts.some((d) => String(d.appointment_id) === String(localItem.id));
                  if (!alreadyInDb) {
                    dbAppts.push({
                      appointment_id: localItem.id,
                      clinic_id: resolvedClinicId || localItem.clinicId,
                      date: localItem.rawDate || localItem.date,
                      time: localItem.time,
                      batch_time: localItem.batchTime || localItem.batch_time,
                      status: localItem.status,
                      patient_name: localItem.patientName,
                      patient_email: localItem.patientEmail,
                      patient_contact: localItem.patientContact,
                      patient_address: localItem.patientAddress,
                      patient_gender: localItem.patientGender,
                      patient_birthdate: localItem.patientBirthdate,
                      emergency_contact_name: localItem.emergencyContactName,
                      emergency_contact_phone: localItem.emergencyContactPhone,
                      emergency_contact_relationship: localItem.emergencyRelationship,
                      notes: localItem.notes,
                      clinic_note: localItem.clinicNote,
                      skin_photo_url: localItem.skinPhotoUrl,
                      ai_condition_name: localItem.aiConditionName || localItem.conditionName,
                      ai_confidence: localItem.aiConfidence,
                      questionnaire_answers: localItem.questionnaireAnswers,
                      created_at: localItem.createdAt || new Date().toISOString(),
                      assigned_doctor_id: localItem.assignedDoctorId,
                      assigned_doctor_name: localItem.assignedDoctorName,
                      doctor_status: localItem.doctorStatus,
                      doctor_note: localItem.doctorNote,
                      doctor_reviewed_at: localItem.doctorReviewedAt,
                      user_id: localItem.userId,
                      queue_number: localItem.queueNumber,
                      check_in_status: localItem.checkInStatus || localItem.check_in_status,
                    });
                  }
                }
              });
            }
          }
        } catch { }

        // 3. Deduplicate unique patients and organize appointment history
        const patientMap = new Map<string, ClinicPatient>();
        const apptList: PatientAppointment[] = [];

        dbAppts.forEach((row: any) => {
          // Normalize patient identifier
          const rawUserId = row.user_id ? String(row.user_id).trim() : "";
          const rawEmail = row.patient_email ? String(row.patient_email).toLowerCase().trim() : "";
          const rawPhone = row.patient_contact ? String(row.patient_contact).replace(/\D/g, "") : "";
          const rawName = row.patient_name ? String(row.patient_name).trim() : "Patient";

          let dedupeKey = "";
          if (rawUserId) {
            dedupeKey = `user:${rawUserId}`;
          } else if (rawEmail) {
            dedupeKey = `email:${rawEmail}`;
          } else if (rawPhone) {
            dedupeKey = `phone:${rawPhone}`;
          } else {
            dedupeKey = `name:${rawName.toLowerCase()}`;
          }

          // Resolve doctor display name
          const assignedDocId = row.assigned_doctor_id ? String(row.assigned_doctor_id) : undefined;
          let assignedDocName = "";
          if (row.assigned_doctor_name) {
            assignedDocName = formatDoctorName(row.assigned_doctor_name);
          } else if (assignedDocId && docMap.has(assignedDocId)) {
            assignedDocName = docMap.get(assignedDocId)!;
          } else if (row.clinic_note) {
            const match = row.clinic_note.match(/(?:Assigned to|Re-assigned to)\s+(?:Dr\.\s*)?([A-Za-z\s]+?)(?:\s+for|\s+accepted|\s+declined|\.|$)/i);
            if (match && match[1] && match[1].trim().toLowerCase() !== "dr") {
              assignedDocName = formatDoctorName(match[1]);
            }
          }
          if (!assignedDocName && assignedDocId) {
            assignedDocName = "Assigned Doctor";
          }

          const dateStr = formatApptDate(row.date);
          const timeStr = formatApptTime(row.time, row.batch_time);

          const appointmentObj: PatientAppointment = {
            id: String(row.appointment_id || dedupeKey),
            dateStr,
            rawDate: row.date,
            timeStr,
            status: row.status || "pending",
            checkInStatus: row.check_in_status || undefined,
            doctorStatus: row.doctor_status || undefined,
            assignedDoctorId: assignedDocId,
            assignedDoctorName: assignedDocName || "Unassigned",
            conditionName: row.ai_condition_name || undefined,
            confidence: row.ai_confidence ? Number(row.ai_confidence) : undefined,
            skinPhotoUrl: row.skin_photo_url || undefined,
            questionnaireAnswers: parseQuestionnaireAnswers(row.questionnaire_answers),
            notes: row.notes || undefined,
            clinicNote: row.clinic_note || undefined,
            doctorNote: row.doctor_note || undefined,
            doctorReviewedAt: row.doctor_reviewed_at || undefined,
            createdAt: row.created_at || new Date().toISOString(),
            queueNumber: row.queue_number,
          };

          apptList.push(appointmentObj);

          // Build or update unique patient record
          if (!patientMap.has(dedupeKey)) {
            const birthdate = row.patient_birthdate || undefined;
            const age = calculateAge(birthdate);

            const initialPatient: ClinicPatient = {
              id: dedupeKey,
              userId: rawUserId || undefined,
              name: rawName,
              email: rawEmail || "No email on record",
              phone: row.patient_contact || undefined,
              address: row.patient_address || undefined,
              gender: row.patient_gender || undefined,
              birthdate,
              age,
              emergencyContactName: row.emergency_contact_name || undefined,
              emergencyContactPhone: row.emergency_contact_phone || undefined,
              emergencyRelationship: row.emergency_contact_relationship || undefined,
              totalAppointments: 1,
              appointments: [appointmentObj],
              assignedDoctors: assignedDocName && assignedDocName !== "Unassigned"
                ? [{ id: assignedDocId, name: assignedDocName }]
                : [],
            };

            patientMap.set(dedupeKey, initialPatient);
          } else {
            const existing = patientMap.get(dedupeKey)!;
            existing.totalAppointments += 1;
            existing.appointments.push(appointmentObj);

            // Update contact details if newly available
            if (!existing.phone && row.patient_contact) existing.phone = row.patient_contact;
            if (!existing.address && row.patient_address) existing.address = row.patient_address;
            if (!existing.gender && row.patient_gender) existing.gender = row.patient_gender;
            if (!existing.birthdate && row.patient_birthdate) {
              existing.birthdate = row.patient_birthdate;
              existing.age = calculateAge(row.patient_birthdate);
            }
            if (!existing.emergencyContactName && row.emergency_contact_name) {
              existing.emergencyContactName = row.emergency_contact_name;
              existing.emergencyContactPhone = row.emergency_contact_phone;
              existing.emergencyRelationship = row.emergency_contact_relationship;
            }

            // Track assigned doctor
            if (
              assignedDocName &&
              assignedDocName !== "Unassigned" &&
              !existing.assignedDoctors.some((d) => d.name.toLowerCase() === assignedDocName.toLowerCase())
            ) {
              existing.assignedDoctors.push({ id: assignedDocId, name: assignedDocName });
            }
          }
        });

        // Finalize patient appointment sorting (chronological descending: most recent first)
        const finalizedPatients = Array.from(patientMap.values()).map((p) => {
          p.appointments.sort((a, b) => {
            const timeA = new Date(a.rawDate || a.createdAt || 0).getTime();
            const timeB = new Date(b.rawDate || b.createdAt || 0).getTime();
            return timeB - timeA;
          });
          p.lastAppointment = p.appointments[0];
          return p;
        });

        // Sort patients by most recent appointment date descending
        finalizedPatients.sort((a, b) => {
          const timeA = a.lastAppointment ? new Date(a.lastAppointment.rawDate || a.lastAppointment.createdAt || 0).getTime() : 0;
          const timeB = b.lastAppointment ? new Date(b.lastAppointment.rawDate || b.lastAppointment.createdAt || 0).getTime() : 0;
          return timeB - timeA;
        });

        if (!isCancelled) {
          setPatients(finalizedPatients);
          setLoading(false);
        }
      } catch (err) {
        console.error("[ClinicPatientsPage] Error loading patient directory:", err);
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    loadPatientDirectory();

    // Event & storage listeners for live updates
    const handleSync = () => loadPatientDirectory();
    window.addEventListener("dermai_appointments_updated", handleSync);
    window.addEventListener("appointmentCreated", handleSync);
    window.addEventListener("storage", handleSync);
    window.addEventListener("focus", handleSync);

    // Supabase Realtime for live updates
    let channel: any = null;
    if (clinicId) {
      channel = supabase
        .channel(`clinic-patients-realtime-${clinicId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "patient_appointment" },
          () => {
            loadPatientDirectory();
          }
        )
        .subscribe();
    }

    return () => {
      isCancelled = true;
      if (channel) supabase.removeChannel(channel);
      window.removeEventListener("dermai_appointments_updated", handleSync);
      window.removeEventListener("appointmentCreated", handleSync);
      window.removeEventListener("storage", handleSync);
      window.removeEventListener("focus", handleSync);
    };
  }, [clinicId, clinicName]);

  // 2. Multi-dimensional search and filters
  const filteredPatients = useMemo(() => {
    return patients.filter((patient) => {
      // 1. Search Query: Patient name, Email, Phone number, or Assigned doctor name
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchesName = patient.name.toLowerCase().includes(q);
        const matchesEmail = patient.email.toLowerCase().includes(q);
        const matchesPhone = Boolean(patient.phone && patient.phone.toLowerCase().includes(q));
        const matchesDoctor = patient.assignedDoctors.some((d) => d.name.toLowerCase().includes(q));

        if (!matchesName && !matchesEmail && !matchesPhone && !matchesDoctor) {
          return false;
        }
      }

      // 2. Doctor Filter: list of clinic registered doctors
      if (selectedDoctorId !== "all") {
        const matchesDoctor = patient.appointments.some((appt) => {
          if (appt.assignedDoctorId && String(appt.assignedDoctorId) === String(selectedDoctorId)) {
            return true;
          }
          const matchedDocObj = registeredDoctors.find((d) => String(d.id) === String(selectedDoctorId));
          if (matchedDocObj && appt.assignedDoctorName) {
            return appt.assignedDoctorName.toLowerCase().trim() === matchedDocObj.name.toLowerCase().trim();
          }
          return false;
        });

        if (!matchesDoctor) {
          return false;
        }
      }

      // 3. Status Filter: All, Upcoming, Completed, Cancelled
      if (statusFilter === "upcoming") {
        // Patient has at least one active, upcoming appointment that has not elapsed
        const hasUpcoming = patient.appointments.some((appt) => {
          const isNotPast = !isAppointmentPastScheduled({
            date: appt.rawDate || appt.dateStr,
            time: appt.timeStr,
          });
          const isActiveStatus =
            appt.status === "scheduled" ||
            appt.status === "confirmed" ||
            appt.status === "accepted" ||
            appt.status === "pending";
          const isNotCancelledOrDone =
            appt.status !== "cancelled" &&
            appt.status !== "rejected" &&
            appt.status !== "completed" &&
            appt.checkInStatus !== "completed" &&
            appt.checkInStatus !== "no-show";

          return isNotPast && isActiveStatus && isNotCancelledOrDone;
        });
        if (!hasUpcoming) return false;
      } else if (statusFilter === "completed") {
        // Patient has at least one completed appointment
        const hasCompleted = patient.appointments.some(
          (appt) => appt.status === "completed" || appt.checkInStatus === "completed"
        );
        if (!hasCompleted) return false;
      } else if (statusFilter === "cancelled") {
        // Patient has at least one cancelled, rejected, or no-show appointment
        const hasCancelled = patient.appointments.some(
          (appt) =>
            appt.status === "cancelled" ||
            appt.status === "rejected" ||
            appt.checkInStatus === "no-show" ||
            appt.doctorStatus === "rejected"
        );
        if (!hasCancelled) return false;
      }

      return true;
    });
  }, [patients, search, statusFilter, selectedDoctorId, registeredDoctors]);

  const hasActiveFilters = search.trim() !== "" || statusFilter !== "all" || selectedDoctorId !== "all";

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setSelectedDoctorId("all");
  };

  return (
    <div className="space-y-6">
      {/* ── 1. Page Header ─────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-display font-bold text-gray-900">Patient Records</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          View patient details and appointment history from your clinic.
        </p>
      </div>

      {/* ── 2. Search and Multi-Dimensional Filters ──────────────────── */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
          {/* Search by Name, Email, Phone, or Assigned Doctor */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by patient name, email, phone, or assigned doctor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-xl bg-gray-50 border border-gray-100 outline-none focus:border-magenta-500 focus:bg-white transition-all text-gray-900 placeholder:text-gray-400"
            />
          </div>

          {/* Doctor Filter Dropdown */}
          <div className="flex items-center gap-2">
            <div className="relative min-w-[210px]">
              <Stethoscope className="w-4 h-4 text-magenta-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                value={selectedDoctorId}
                onChange={(e) => setSelectedDoctorId(e.target.value)}
                className="w-full pl-9 pr-8 py-2 text-xs font-semibold rounded-xl bg-gray-50 border border-gray-100 outline-none focus:border-magenta-500 focus:bg-white transition-all text-gray-800 appearance-none cursor-pointer"
                title="Filter by assigned doctor"
              >
                <option value="all">All Doctors ({registeredDoctors.length})</option>
                {registeredDoctors.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Reset Filters button */}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="px-3 py-2 rounded-xl text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
                title="Reset all filters"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        {/* Status Filter Pills: All Patients, Upcoming, Completed, Cancelled */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs no-scrollbar">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider shrink-0 mr-1">
            Status:
          </span>
          {[
            { key: "all", label: "All Patients" },
            { key: "upcoming", label: "Upcoming" },
            { key: "completed", label: "Completed" },
            { key: "cancelled", label: "Cancelled" },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatusFilter(tab.key as any)}
              className={cn(
                "px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer shrink-0",
                statusFilter === tab.key
                  ? "bg-magenta-600 text-white shadow-xs"
                  : "bg-gray-50 text-gray-600 hover:bg-gray-100"
              )}
            >
              {tab.label}
            </button>
          ))}

          {/* Active Filter Indicators */}
          {hasActiveFilters && (
            <span className="text-[11px] text-gray-400 ml-auto shrink-0">
              Showing {filteredPatients.length} of {patients.length} patients
            </span>
          )}
        </div>
      </div>

      {/* ── 4. Patient Records Table ─────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-6 py-3.5">Patient</th>
                <th className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-6 py-3.5">Assigned Doctor</th>
                <th className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-6 py-3.5">Last Appointment</th>
                <th className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-6 py-3.5">Total Appointments</th>
                <th className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-6 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center">
                    <div className="w-8 h-8 border-2 border-magenta-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-xs text-gray-500 font-medium">Loading patient directory...</p>
                  </td>
                </tr>
              ) : filteredPatients.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center">
                    <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-3 text-gray-300">
                      <Users className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-semibold text-gray-900">
                      No patients found
                    </p>
                    <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
                      Patients who schedule appointments or consultations with your clinic will appear here.
                    </p>
                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="mt-3 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-pink-50 text-[#c0166a] border border-pink-200 hover:bg-pink-100 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> Reset Filters
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredPatients.map((patient) => {
                  const mostRecentDoctor = patient.lastAppointment?.assignedDoctorName || "Unassigned";
                  const otherDoctors = patient.assignedDoctors.filter(
                    (d) => d.name.toLowerCase() !== mostRecentDoctor.toLowerCase() && d.name !== "Unassigned"
                  );
                  const otherDoctorsCount = otherDoctors.length;

                  return (
                    <tr
                      key={patient.id}
                      className="hover:bg-gray-50/60 transition-colors"
                    >
                      {/* Column 1: Patient Details */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-pink-100 text-[#c0166a] flex items-center justify-center font-bold text-sm shrink-0">
                            {patient.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900 truncate">{patient.name}</p>
                            <div className="flex items-center gap-2 text-xs text-gray-400 truncate mt-0.5">
                              {patient.email && <span className="truncate">{patient.email}</span>}
                              {patient.phone && (
                                <>
                                  <span>•</span>
                                  <span className="shrink-0">{patient.phone}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Column 2: Assigned Doctor (with indicator if multiple doctors involved) */}
                      <td className="px-6 py-4 text-sm text-gray-700">
                        {mostRecentDoctor !== "Unassigned" ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="inline-flex items-center gap-1 font-semibold text-magenta-900 bg-pink-50 px-2.5 py-1 rounded-lg border border-pink-100 text-xs">
                              <Stethoscope className="w-3 h-3 text-[#c0166a]" />
                              {mostRecentDoctor}
                            </span>
                            {otherDoctorsCount > 0 && (
                              <span
                                className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-600 border border-gray-200 cursor-help"
                                title={`Also consulted with: ${otherDoctors.map((d) => d.name).join(", ")}`}
                              >
                                +{otherDoctorsCount} other{otherDoctorsCount > 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400 italic text-xs">Unassigned</span>
                        )}
                      </td>

                      {/* Column 3: Last Appointment (date & status; does not imply attendance unless completed) */}
                      <td className="px-6 py-4 text-xs">
                        {patient.lastAppointment ? (
                          <div className="space-y-1">
                            <p className="font-semibold text-gray-900">
                              {patient.lastAppointment.dateStr}
                            </p>
                            <div className="flex items-center gap-1">
                              {patient.lastAppointment.checkInStatus === "no-show" ? (
                                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                  No-Show
                                </span>
                              ) : patient.lastAppointment.status === "completed" || patient.lastAppointment.checkInStatus === "completed" ? (
                                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  Completed
                                </span>
                              ) : patient.lastAppointment.status === "cancelled" || patient.lastAppointment.status === "rejected" || patient.lastAppointment.doctorStatus === "rejected" ? (
                                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-gray-100 text-gray-600 border border-gray-200">
                                  Cancelled
                                </span>
                              ) : patient.lastAppointment.status === "scheduled" || patient.lastAppointment.status === "confirmed" ? (
                                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                  Scheduled
                                </span>
                              ) : (
                                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                  Pending Review
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-gray-400 italic">—</span>
                        )}
                      </td>

                      {/* Column 4: Total Appointments */}
                      <td className="px-6 py-4 text-sm">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-gray-50 text-gray-700 border border-gray-200">
                          {patient.totalAppointments} {patient.totalAppointments === 1 ? "appointment" : "appointments"}
                        </span>
                      </td>

                      {/* Column 5: Action (View Details) */}
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedPatient(patient)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-pink-200 text-[#c0166a] hover:bg-pink-50 text-xs font-semibold transition-colors cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View Details</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 5. Patient Details & Complete Appointment History Modal ─────── */}
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
              className="bg-white rounded-3xl max-w-3xl w-full shadow-2xl border border-gray-100 flex flex-col max-h-[92vh] overflow-hidden text-left"
            >
              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-gray-100 bg-white flex items-center justify-between">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-full bg-pink-100 text-[#c0166a] flex items-center justify-center text-lg font-bold border-2 border-pink-200 shrink-0">
                    {selectedPatient.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-bold text-gray-900">{selectedPatient.name}</h3>
                      <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-pink-50 text-[#c0166a] border border-pink-200">
                        {selectedPatient.totalAppointments} Consultation{selectedPatient.totalAppointments > 1 ? "s" : ""} on Record
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
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

              {/* Scrollable Modal Content */}
              <div className="p-6 space-y-6 overflow-y-auto flex-1">
                {/* 1. Patient Profile and Available Contact Details */}
                <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-gray-200/60 pb-2">
                    <span className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-magenta-600" /> Patient Profile &amp; Contact Details
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
                    {selectedPatient.emergencyContactName && (
                      <div className="sm:col-span-2 pt-2 border-t border-gray-200/50">
                        <span className="font-semibold text-rose-500 block text-[10px] uppercase">Emergency Contact</span>
                        <span className="text-gray-900 font-medium">
                          {selectedPatient.emergencyContactName}{" "}
                          {selectedPatient.emergencyRelationship ? `(${selectedPatient.emergencyRelationship})` : ""}{" "}
                          • {selectedPatient.emergencyContactPhone || "No phone"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. Chronological Appointment History at This Clinic */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                    <span className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-[#c0166a]" />
                      Appointment History at Current Clinic ({selectedPatient.appointments.length})
                    </span>
                    <span className="text-[11px] text-gray-400">Ordered by date (most recent first)</span>
                  </div>

                  <div className="space-y-4">
                    {selectedPatient.appointments.map((appt, idx) => {
                      const isNoShow = appt.checkInStatus === "no-show";
                      const isCompleted = appt.status === "completed" || appt.checkInStatus === "completed";
                      const isCancelled = appt.status === "cancelled" || appt.status === "rejected" || appt.doctorStatus === "rejected";
                      const isScheduled = appt.status === "scheduled" || appt.status === "confirmed";

                      return (
                        <div
                          key={appt.id}
                          className="rounded-2xl border border-gray-100 bg-white p-4 shadow-xs space-y-3 hover:border-pink-200 transition-all"
                        >
                          {/* Card Top: Appointment Date, Batch Time, Status Badge */}
                          <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-pink-100 text-[#c0166a]">
                                  Visit #{selectedPatient.appointments.length - idx}
                                </span>
                                <h4 className="text-sm font-bold text-gray-900">{appt.dateStr}</h4>
                              </div>
                              <p className="text-xs text-gray-500 flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5 text-gray-400" />
                                <span>Scheduled: {appt.timeStr}</span>
                              </p>
                            </div>

                            {/* Status Pill */}
                            <div>
                              {isNoShow ? (
                                <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-rose-50 text-rose-700 border border-rose-200 inline-flex items-center gap-1">
                                  <AlertCircle className="w-3.5 h-3.5" /> No-Show
                                </span>
                              ) : isCompleted ? (
                                <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5" /> Completed Consultation
                                </span>
                              ) : isCancelled ? (
                                <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-gray-100 text-gray-600 border border-gray-200 inline-flex items-center gap-1">
                                  <X className="w-3.5 h-3.5" /> Cancelled / Declined
                                </span>
                              ) : isScheduled ? (
                                <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-blue-50 text-blue-700 border border-blue-200 inline-flex items-center gap-1">
                                  <Calendar className="w-3.5 h-3.5" /> Scheduled Visit
                                </span>
                              ) : (
                                <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-amber-50 text-amber-700 border border-amber-200 inline-flex items-center gap-1">
                                  <Clock className="w-3.5 h-3.5" /> Pending Review
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Assigned Doctor */}
                          <div className="flex items-center gap-1.5 text-xs text-gray-700 bg-gray-50/70 px-3 py-2 rounded-xl border border-gray-100">
                            <Stethoscope className="w-3.5 h-3.5 text-[#c0166a] shrink-0" />
                            <span className="font-semibold text-gray-500">Attending Doctor:</span>
                            <span className="font-bold text-gray-900">
                              {appt.assignedDoctorName && appt.assignedDoctorName !== "Unassigned"
                                ? appt.assignedDoctorName
                                : "Pending Doctor Assignment"}
                            </span>
                            {appt.doctorStatus && (
                              <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-white border border-gray-200 capitalize">
                                Doctor Review: {appt.doctorStatus === "approved" ? "Approved" : appt.doctorStatus === "rejected" ? "Declined" : "Pending"}
                              </span>
                            )}
                          </div>

                          {/* AI Condition Scan & Uploaded Photo if present */}
                          {(appt.conditionName || appt.skinPhotoUrl) && (
                            <div className="rounded-xl border border-magenta-100 bg-pink-50/20 p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-bold text-magenta-900 flex items-center gap-1.5 uppercase tracking-wide">
                                  <Sparkles className="w-3.5 h-3.5 text-magenta-600" />
                                  DermAI Scan &amp; Pre-Consultation Assessment
                                </span>
                                {appt.confidence !== undefined && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-magenta-100 text-magenta-800">
                                    {appt.confidence}% Confidence
                                  </span>
                                )}
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center pt-1">
                                <div>
                                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Condition Assessed</p>
                                  <p className="text-xs font-bold text-gray-900 mt-0.5">
                                    {appt.conditionName || "General Dermatology Consultation"}
                                  </p>
                                </div>

                                {appt.skinPhotoUrl && (
                                  <div>
                                    <div className="flex items-center justify-between text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                                      <span>Skin Photo</span>
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          const url = await getSignedSkinPhotoUrl(appt.skinPhotoUrl!);
                                          if (url) setLightboxPhoto(url);
                                        }}
                                        className="text-magenta-600 hover:underline cursor-pointer lowercase"
                                      >
                                        enlarge
                                      </button>
                                    </div>
                                    <div
                                      onClick={async () => {
                                        const url = await getSignedSkinPhotoUrl(appt.skinPhotoUrl!);
                                        if (url) setLightboxPhoto(url);
                                      }}
                                      className="relative group rounded-xl border border-gray-200 overflow-hidden bg-gray-50 cursor-pointer h-20 w-32 flex items-center justify-center hover:border-magenta-400 transition-all"
                                    >
                                      <LazySkinPhoto
                                        pathOrUrl={appt.skinPhotoUrl}
                                        alt="Patient skin condition"
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                      />
                                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 text-white text-[10px] font-semibold">
                                        <Maximize2 className="w-3 h-3" /> Expand
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Pre-Screening Questionnaire Responses if present */}
                          {appt.questionnaireAnswers && appt.questionnaireAnswers.length > 0 && (
                            <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3 space-y-2">
                              <span className="text-[11px] font-bold text-gray-800 uppercase tracking-wide flex items-center gap-1.5">
                                <ClipboardList className="w-3.5 h-3.5 text-magenta-600" />
                                Pre-Screening Questionnaire ({appt.questionnaireAnswers.length} responses)
                              </span>
                              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                                {appt.questionnaireAnswers.map((qa, qIdx) => (
                                  <div key={qIdx} className="text-xs bg-white p-2 rounded-lg border border-gray-100 space-y-0.5">
                                    <p className="font-semibold text-gray-800 text-[11px]">{qa.question}</p>
                                    <div className="flex items-center gap-2 pt-0.5">
                                      <span className="text-magenta-700 font-medium bg-pink-50 px-2 py-0.5 rounded text-[11px]">
                                        {qa.answer}
                                      </span>
                                      {qa.severity !== undefined && qa.severity !== null && (
                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                                          Severity {qa.severity}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Patient Symptoms / Notes */}
                          {appt.notes && (
                            <div className="text-xs bg-gray-50 p-2.5 rounded-xl border border-gray-100 space-y-1">
                              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                                <FileText className="w-3 h-3" /> Patient Symptoms &amp; Notes
                              </span>
                              <p className="text-gray-800 leading-relaxed">{appt.notes}</p>
                            </div>
                          )}

                          {/* Clinic Scheduling or Decline Note */}
                          {appt.clinicNote && (
                            <div className="text-xs bg-pink-50/60 p-2.5 rounded-xl border border-pink-100 space-y-1">
                              <span className="text-[10px] font-bold text-magenta-700 uppercase tracking-wider block">
                                Clinic Scheduling Note:
                              </span>
                              <p className="text-gray-900 font-medium leading-relaxed">{appt.clinicNote}</p>
                            </div>
                          )}

                          {/* Doctor Attending Diagnosis / Notes */}
                          {appt.doctorNote && (
                            <div className="text-xs bg-blue-50/60 p-2.5 rounded-xl border border-blue-100 space-y-1">
                              <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider block">
                                Attending Doctor Clinical Notes:
                              </span>
                              <p className="text-gray-900 font-medium leading-relaxed">{appt.doctorNote}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 border-t border-gray-100 bg-white">
                <button
                  type="button"
                  onClick={() => setSelectedPatient(null)}
                  className="w-full py-2.5 rounded-full font-semibold text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── 6. Fullscreen Skin Photo Lightbox Modal ──────────────────── */}
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
