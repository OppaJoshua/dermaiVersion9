import { useState, useMemo, useEffect } from "react";
import {
  Users,
  Search,
  UserCheck,
  Clock,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";

export type ClinicPatient = {
  id: string;
  name: string;
  age?: number;
  gender?: string;
  email: string;
  phone?: string;
  condition?: string;
  assignedDoctor?: string;
  lastVisit?: string;
  totalVisits: number;
  status: "active" | "completed" | "pending";
  notes?: string;
};

const statusBadges: Record<string, string> = {
  active: "bg-blue-50 text-blue-700 border-blue-200",
  completed: "bg-green-50 text-green-700 border-green-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
};

import { useClinicVerification } from "@/hooks/useClinicVerification";

export default function ClinicPatientsPage() {
  const { clinicId } = useClinicVerification();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedPatient, setSelectedPatient] = useState<ClinicPatient | null>(null);
  const [patients, setPatients] = useState<ClinicPatient[]>([]);

  useEffect(() => {
    async function loadPatients() {
      try {
        let query = supabase
          .from("patient_appointment")
          .select("*, user(full_name, email, phone), clinic_doctor:assigned_doctor_id(doctor_name)");

        if (clinicId) {
          query = query.eq("clinic_id", clinicId);
        }

        const { data } = await query;

        if (data && data.length > 0) {
          const patientMap = new Map<string, ClinicPatient>();

          data.forEach((row) => {
            const email = row.patient_email || row.user?.email || `patient_${row.appointment_id.slice(0, 6)}@dermai.local`;
            const name = row.patient_name || row.user?.full_name || email.split("@")[0];
            const phone = row.patient_contact || row.user?.phone || "";
            const isCompleted = row.status === "completed";
            const isPending = row.status === "pending";

            if (!patientMap.has(email)) {
              patientMap.set(email, {
                id: row.user_id || row.appointment_id,
                name,
                email,
                phone,
                condition: row.ai_condition_name || "General Dermatology",
                assignedDoctor: row.clinic_doctor?.doctor_name || "Resident Doctor",
                lastVisit: row.date ? new Date(row.date).toLocaleDateString() : "—",
                totalVisits: 1,
                status: isCompleted ? "completed" : isPending ? "pending" : "active",
                notes: row.ai_condition_name ? `Noted Condition: ${row.ai_condition_name}` : "",
              });
            } else {
              const existing = patientMap.get(email)!;
              existing.totalVisits += 1;
              if (phone && !existing.phone) existing.phone = phone;
              if (isCompleted && existing.status !== "active") existing.status = "completed";
            }
          });

          setPatients(Array.from(patientMap.values()));
        }
      } catch (err) {
        console.error("Error loading clinic patients:", err);
      }
    }
    loadPatients();
  }, [clinicId]);

  const filteredPatients = useMemo(() => {
    return patients.filter((p) => {
      const matchesSearch =
        !search ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.email.toLowerCase().includes(search.toLowerCase()) ||
        (p.condition && p.condition.toLowerCase().includes(search.toLowerCase()));

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
            placeholder="Search patients by name, email, or condition..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-xl bg-gray-50 border border-gray-100 outline-none focus:border-magenta-500 focus:bg-white transition-all"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {["all", "active", "completed", "pending"].map((status) => (
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
              {status}
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
                        <div className="w-9 h-9 rounded-full bg-magenta-100 text-magenta-600 flex items-center justify-center font-bold text-sm">
                          {patient.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{patient.name}</p>
                          <p className="text-xs text-gray-400">{patient.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700 font-medium">{patient.condition || "—"}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{patient.assignedDoctor || "Unassigned"}</td>
                    <td className="px-6 py-4 text-xs text-gray-500">{patient.lastVisit || "—"}</td>
                    <td className="px-6 py-4 text-sm font-semibold text-gray-700">{patient.totalVisits}</td>
                    <td className="px-6 py-4">
                      <span
                        className={cn(
                          "text-xs px-2.5 py-1 rounded-full font-semibold capitalize border",
                          statusBadges[patient.status] || "bg-gray-100 text-gray-600"
                        )}
                      >
                        {patient.status}
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
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setSelectedPatient(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl p-6 max-w-md w-full shadow-xl border border-gray-100 space-y-5"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900">Patient Details</h3>
                <button
                  onClick={() => setSelectedPatient(null)}
                  className="p-2 rounded-xl text-gray-400 hover:bg-gray-50"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex items-center gap-3 p-4 rounded-2xl bg-gray-50 border border-gray-100">
                <div className="w-12 h-12 rounded-full bg-magenta-500 text-white flex items-center justify-center text-lg font-bold">
                  {selectedPatient.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{selectedPatient.name}</p>
                  <p className="text-xs text-gray-500">{selectedPatient.email}</p>
                  {selectedPatient.phone && (
                    <p className="text-xs text-gray-400 mt-0.5">{selectedPatient.phone}</p>
                  )}
                </div>
              </div>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between py-1.5 border-b border-gray-50">
                  <span className="text-gray-400">Condition</span>
                  <span className="font-medium text-gray-800">{selectedPatient.condition || "N/A"}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-gray-50">
                  <span className="text-gray-400">Assigned Doctor</span>
                  <span className="font-medium text-gray-800">{selectedPatient.assignedDoctor || "Unassigned"}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-gray-50">
                  <span className="text-gray-400">Total Visits</span>
                  <span className="font-medium text-gray-800">{selectedPatient.totalVisits}</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-gray-400">Status</span>
                  <span className={cn("text-xs px-2.5 py-0.5 rounded-full font-semibold border", statusBadges[selectedPatient.status])}>
                    {selectedPatient.status}
                  </span>
                </div>
              </div>

              <button
                onClick={() => setSelectedPatient(null)}
                className="w-full py-2.5 rounded-xl font-semibold text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
