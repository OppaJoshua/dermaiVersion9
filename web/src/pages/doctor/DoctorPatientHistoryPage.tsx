import { useState } from "react";
import { CheckCircle2, Calendar, User, ScanSearch, X, FileText } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { skinConditions } from "@/pages/public/SkinLibrary";
type AppointmentRecord = {
    id: string;
    clinicName: string;
    patientName?: string;
    patientAge?: number;
    patientAvatar?: string;
    conditionId?: string;
    conditionName?: string;
    conditionImage?: string;
    date: string;
    time: string;
    notes: string;
    status: string;
    assignedDoctorId?: string;
    assignedDoctorName?: string;
    doctorStatus?: string;
    doctorNote?: string;
    scheduleSentToDoctor?: boolean;
    doctorDone?: boolean;
    createdAt: string;
};
function formatDate(dateStr: string): string {
    if (!dateStr)
        return "—";
    try {
        return new Date(dateStr + "T00:00:00").toLocaleDateString("en-PH", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
        });
    }
    catch {
        return dateStr;
    }
}
function formatTime(timeStr: string): string {
    if (!timeStr)
        return "—";
    try {
        const [h, m] = timeStr.split(":").map(Number);
        const ampm = h >= 12 ? "PM" : "AM";
        const hour = h % 12 || 12;
        return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
    }
    catch {
        return timeStr;
    }
}
export default function DoctorPatientHistoryPage() {
    // TODO: Load doctor info and appointment history from Supabase auth session
    const [viewingAppt, setViewingAppt] = useState<AppointmentRecord | null>(null);
    const [search, setSearch] = useState("");
    // TODO: Load completed appointments from Supabase
    const history: AppointmentRecord[] = [];
    const filtered = history.filter((a) => {
        const q = search.toLowerCase();
        return (!q ||
            (a.patientName || "").toLowerCase().includes(q) ||
            (a.conditionName || "").toLowerCase().includes(q) ||
            (a.clinicName || "").toLowerCase().includes(q));
    });
    const viewCond = viewingAppt?.conditionId
        ? skinConditions.find((c) => c.id === viewingAppt.conditionId)
        : null;
    return (<div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Patient History</h1>
          <p className="text-sm text-gray-500 mt-1">
            Consultations you have completed and marked as done.
          </p>
        </div>
        <div className="relative">
          <input type="text" placeholder="Search patients..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-4 pr-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 w-56"/>
        </div>
      </div>

      {/* Count badge */}
      {history.length > 0 && (<div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-50 border border-green-200 text-green-700 text-xs font-semibold">
          <CheckCircle2 className="w-3.5 h-3.5"/>
          {history.length} completed consultation{history.length !== 1 ? "s" : ""}
        </div>)}

      {filtered.length === 0 ? (<div className="bg-white rounded-2xl border border-gray-100 flex flex-col items-center justify-center py-20 text-center px-6">
          <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center mb-4">
            <CheckCircle2 className="w-7 h-7 text-green-400"/>
          </div>
          <p className="text-base font-semibold text-gray-700 mb-1">
            {search ? "No results found" : "No completed consultations yet"}
          </p>
          <p className="text-sm text-gray-400 max-w-xs">
            {search
                ? "Try a different search term."
                : "Patients will appear here after you mark their appointment as done."}
          </p>
        </div>) : (<div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Patient</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Condition</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Clinic</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Date</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Time</th>
                <th className="text-right px-5 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((appt, i) => (<motion.tr key={appt.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <img src={appt.patientAvatar ||
                    `https://ui-avatars.com/api/?name=${encodeURIComponent(appt.patientName || "P")}&background=dcfce7&color=16a34a`} alt={appt.patientName} className="w-8 h-8 rounded-full object-cover border border-gray-200 shrink-0"/>
                      <div>
                        <p className="font-semibold text-gray-900 leading-tight">{appt.patientName || "Patient"}</p>
                        {appt.patientAge && (<p className="text-xs text-gray-400">{appt.patientAge} yrs old</p>)}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-blue-600 font-medium">{appt.conditionName || "—"}</td>
                  <td className="px-4 py-3 text-gray-500">{appt.clinicName || "—"}</td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{appt.date || "—"}</td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatTime(appt.time)}</td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => setViewingAppt(appt)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-100 text-xs font-semibold hover:bg-blue-100 transition-colors">
                      <FileText className="w-3.5 h-3.5"/> View
                    </button>
                  </td>
                </motion.tr>))}
            </tbody>
          </table>
        </div>)}

      {/* Detail Modal */}
      <AnimatePresence>
        {viewingAppt && (<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setViewingAppt(null)}>
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }} transition={{ duration: 0.2 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <div>
                  <h2 className="text-base font-bold text-gray-900">Consultation Record</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Completed appointment details</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-50 border border-green-200 text-green-700 text-xs font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5"/> Done
                  </span>
                  <button onClick={() => setViewingAppt(null)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors">
                    <X className="w-4 h-4 text-gray-500"/>
                  </button>
                </div>
              </div>

              <div className="px-6 py-5 space-y-5 max-h-[72vh] overflow-y-auto">
                {/* Patient */}
                <div className="flex items-center gap-4">
                  <img src={viewingAppt.patientAvatar ||
                `https://ui-avatars.com/api/?name=${encodeURIComponent(viewingAppt.patientName || "P")}&background=dcfce7&color=16a34a`} alt={viewingAppt.patientName} className="w-16 h-16 rounded-2xl object-cover border border-gray-200 shrink-0"/>
                  <div>
                    <p className="text-lg font-bold text-gray-900">{viewingAppt.patientName || "Patient"}</p>
                    {viewingAppt.patientAge && (<p className="text-sm text-gray-400">{viewingAppt.patientAge} years old</p>)}
                    <p className="text-sm text-blue-600 font-medium">{viewingAppt.conditionName || "Skin concern"}</p>
                  </div>
                </div>

                {/* Schedule */}
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5"/> Appointment Schedule
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 text-center">
                      <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">Date</p>
                      <p className="text-sm font-bold text-gray-800">{formatDate(viewingAppt.date)}</p>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 text-center">
                      <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">Time</p>
                      <p className="text-xl font-bold text-gray-800">{formatTime(viewingAppt.time)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <User className="w-3.5 h-3.5 shrink-0"/>
                    <span className="font-medium">{viewingAppt.clinicName}</span>
                  </div>
                </div>

                {/* Notes */}
                {viewingAppt.notes && (<div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                    <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">Patient Notes</p>
                    <p className="text-sm text-gray-700 italic">"{viewingAppt.notes}"</p>
                  </div>)}

                {/* AI Analysis */}
                {viewCond && (<div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5 mb-3">
                      <ScanSearch className="w-3.5 h-3.5"/> AI Analysis Result
                    </p>
                    <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-4 flex gap-4">
                      <img src={viewingAppt.conditionImage || viewCond.image} alt={viewCond.name} className="w-24 h-24 rounded-xl object-cover border border-blue-100 shrink-0"/>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-blue-800 mb-1">{viewCond.name}</p>
                        <p className="text-xs text-blue-600 leading-relaxed">{viewCond.description}</p>
                      </div>
                    </div>
                  </div>)}

                {/* Doctor note if any */}
                {viewingAppt.doctorNote && (<div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
                    <p className="text-[10px] text-amber-600 font-semibold uppercase tracking-wide mb-1">Doctor's Review Note</p>
                    <p className="text-sm text-amber-800 italic">"{viewingAppt.doctorNote}"</p>
                  </div>)}
              </div>

              <div className="px-6 py-4 border-t border-gray-100">
                <button onClick={() => setViewingAppt(null)} className="w-full py-2.5 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 transition-colors">
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>)}
      </AnimatePresence>
    </div>);
}
