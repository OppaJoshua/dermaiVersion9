import { useMemo, useState } from "react";
import {
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lock,
  MapPin,
  ScanSearch,
  Stethoscope,
  User,
  XCircle,
} from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { skinConditions } from "@/pages/public/SkinLibrary";
import { useClinicVerification } from "@/hooks/useClinicVerification";

type AppointmentRecord = {
  id: string;
  clinicId: number;
  clinicName: string;
  patientName?: string;
  patientAge?: number;
  patientAvatar?: string;
  patientEmail?: string;
  patientAddress?: string;
  patientContact?: string;
  consultationType: "face-to-face";
  conditionId?: string;
  conditionName?: string;
  conditionImage?: string;
  date: string;
  time: string;
  notes: string;
  status: "pending" | "accepted" | "scheduled" | "rejected";
  meetingLink?: string;
  clinicNote?: string;
  assignedDoctorId?: string;
  assignedDoctorName?: string;
  doctorStatus?: "pending-review" | "approved" | "rejected";
  doctorNote?: string;
  doctorReviewedAt?: string;
  scheduleSentToDoctor?: boolean;
  createdAt: string;
  skinPhotoUrl?: string;
  aiConditionName?: string;
  aiConfidence?: number;
};

type DoctorAccount = {
  id: string;
  name: string;
  email: string;
  specialization: string;
  clinicName: string;
};

type ClinicSettings = {
  openTime: string;
  closeTime: string;
  slotsPerDay: number;
};

const DEFAULT_SETTINGS: ClinicSettings = {
  openTime: "09:00",
  closeTime: "18:00",
  slotsPerDay: 10,
};

export default function ClinicAppointmentsPage() {
  const { status: verificationStatus } = useClinicVerification();
  const fallbackConditionImage = skinConditions[0]?.image;
  let clinicName = "";
  try {
    const raw = localStorage.getItem("dermai_clinic_settings");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.name) clinicName = parsed.name;
    }
  } catch {
    /* ignore */
  }

  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}`;
  });

  const [daySlotLimits, setDaySlotLimits] = useState<Record<string, number>>({});
  const clinicSettings: ClinicSettings = useMemo(() => {
    try {
      const raw = localStorage.getItem("dermai_clinic_settings");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed) {
          return {
            openTime: parsed.openTime || DEFAULT_SETTINGS.openTime,
            closeTime: parsed.closeTime || DEFAULT_SETTINGS.closeTime,
            slotsPerDay: parsed.slotsPerDay || DEFAULT_SETTINGS.slotsPerDay,
          };
        }
      }
    } catch {
      /* ignore */
    }
    return DEFAULT_SETTINGS;
  }, []);
  const getSlotsForDate = (date: string) => daySlotLimits[date] ?? clinicSettings.slotsPerDay;
  const [slotInput, setSlotInput] = useState(() => String(clinicSettings.slotsPerDay));

  const [pendingAssign, setPendingAssign] = useState<{
    appointmentId: string;
    date: string;
    time: string;
    doctorId: string;
  } | null>(null);

  const [viewingPatient, setViewingPatient] = useState<AppointmentRecord | null>(null);
  const [dayDetailDate, setDayDetailDate] = useState<string | null>(null);

  const [assignDoctorModal, setAssignDoctorModal] = useState<{ appointmentId: string } | null>(null);
  const [selectedDoctorId, setSelectedDoctorId] = useState("");

  const [rejectModal, setRejectModal] = useState<{
    appointmentId: string;
    patientName: string;
    clinicName: string;
    patientEmail?: string;
    date?: string;
    time?: string;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [selectedPresetReason, setSelectedPresetReason] = useState("");
  const [rejectError, setRejectError] = useState("");

  const clinicDoctors: DoctorAccount[] = useMemo(() => {
    try {
      const rawDocs = localStorage.getItem("dermai_clinic_doctors");
      if (rawDocs) {
        const parsed = JSON.parse(rawDocs);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      /* ignore */
    }
    return [];
  }, []);

  const [assignError, setAssignError] = useState("");

  const addDoctorForAssignment = () => {
    // TODO: Load/create doctor via Supabase
    setAssignError("Please connect the backend to manage doctors.");
  };

  const saveSlotForSelectedDate = () => {
    const value = Number(slotInput);
    if (!Number.isFinite(value) || value < 1) {
      setAssignError("Slots per day must be at least 1.");
      return;
    }
    setAssignError("");
    const next = { ...daySlotLimits, [selectedDate]: value };
    setDaySlotLimits(next);
    // TODO: Save slot limits to Supabase
  };

  const calendarCells = useMemo(() => {
    const start = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const offset = (start.getDay() + 6) % 7;
    const gridStart = new Date(start);
    gridStart.setDate(start.getDate() - offset);

    return Array.from({ length: 42 }, (_, i) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + i);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
        date.getDate()
      ).padStart(2, "0")}`;

      return {
        key,
        date,
        inCurrentMonth: date.getMonth() === currentMonth.getMonth(),
      };
    });
  }, [currentMonth]);

  const appointmentsByDate = useMemo(() => {
    return appointments.reduce<Record<string, AppointmentRecord[]>>((acc, item) => {
      if (!item.date) return acc;
      if (!acc[item.date]) acc[item.date] = [];
      acc[item.date].push(item);
      return acc;
    }, {});
  }, [appointments]);

  const unscheduledQueue = appointments
    .filter((a) => !a.date && a.status === "pending")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const selectedDayAppointments = (appointmentsByDate[selectedDate] || []).sort((a, b) =>
    a.time.localeCompare(b.time)
  );

  const monthLabel = currentMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const scheduledCount = appointments.filter(
    (a) => !!a.date && (a.status === "scheduled" || a.status === "accepted")
  ).length;
  const rejectedCount = appointments.filter((a) => a.status === "rejected").length;

  const rejectRequest = (id: string, reason?: string) => {
    // TODO: Update appointment status to 'rejected' in Supabase
    // TODO: Trigger patient notification via Supabase real-time
    const rejectionReason = reason?.trim() || "Request declined by clinic scheduling.";
    setAppointments((prev) =>
      prev.map((appt) =>
        appt.id === id
          ? { ...appt, status: "rejected" as const, clinicNote: rejectionReason, rejectionReason }
          : appt
      )
    );
  };

  const handleConfirmRejection = () => {
    if (!rejectModal) return;
    const reasonToUse = rejectReason.trim() || selectedPresetReason.trim();
    if (!reasonToUse) {
      setRejectError("Please select a reason or enter a note for the patient.");
      return;
    }
    rejectRequest(rejectModal.appointmentId, reasonToUse);
    setRejectModal(null);
    setRejectReason("");
    setSelectedPresetReason("");
    setRejectError("");
  };

  const startScheduleAssignment = (appointmentId: string) => {
    setAssignError("");
    const appointment = appointments.find((item) => item.id === appointmentId);
    setPendingAssign({
      appointmentId,
      date: appointment?.date || selectedDate,
      time: appointment?.time || clinicSettings.openTime,
      doctorId: clinicDoctors.find((doctor) => doctor.email === appointment?.assignedDoctorId)?.id || "",
    });
  };

  const confirmAssign = () => {
    if (!pendingAssign) return;
    setAssignError("");

    const doctor = clinicDoctors.find((item) => item.id === pendingAssign.doctorId);
    if (!doctor) {
      setAssignError("Select a doctor to review this appointment before confirming the schedule.");
      return;
    }

    if (
      pendingAssign.time < clinicSettings.openTime ||
      pendingAssign.time > clinicSettings.closeTime
    ) {
      setAssignError(
        `Time must be between ${clinicSettings.openTime} and ${clinicSettings.closeTime}.`
      );
      return;
    }

    // TODO: Save assigned schedule to Supabase
    // TODO: Notify doctor & patient via Supabase real-time
    setAppointments((prev) =>
      prev.map((appt) => {
        if (appt.id !== pendingAssign.appointmentId) return appt;
        return {
          ...appt,
          date: pendingAssign.date,
          time: pendingAssign.time,
          status: "scheduled" as const,
          assignedDoctorId: doctor.email,
          assignedDoctorName: doctor.name,
          doctorStatus: undefined,
          scheduleSentToDoctor: true,
          clinicNote: "Your schedule has been assigned by the clinic.",
        };
      })
    );
    setPendingAssign(null);
  };

  const assignDoctor = () => {
    if (!assignDoctorModal || !selectedDoctorId) return;
    const doc = clinicDoctors.find((d) => d.id === selectedDoctorId);
    if (!doc) return;
    // TODO: Assign doctor in Supabase
    setAppointments((prev) =>
      prev.map((a) => {
        if (a.id !== assignDoctorModal.appointmentId) return a;
        return {
          ...a,
          assignedDoctorId: doc.email,
          assignedDoctorName: doc.name,
          doctorStatus: "pending-review" as const,
        };
      })
    );
    setAssignDoctorModal(null);
    setSelectedDoctorId("");
    setAssignError("");
  };

  const sendScheduleToDoctor = (appointmentId: string) => {
    // TODO: Finalize and send schedule to doctor in Supabase
    setAppointments((prev) =>
      prev.map((a) =>
        a.id === appointmentId ? { ...a, scheduleSentToDoctor: true } : a
      )
    );
  };

  if (verificationStatus !== "verified") {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-5">
          <Lock className="w-8 h-8 text-gray-400" />
        </div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">Verification Required</h2>
        <p className="text-sm text-gray-500 max-w-sm mb-6">
          {verificationStatus === "rejected"
            ? "Your clinic registration was rejected. Please update your profile and contact admin."
            : "Your clinic is pending admin verification. Appointment management will be available once approved."}
        </p>
        <Link
          to="/clinic/settings"
          className="px-5 py-2 rounded-xl bg-[#c0166a] text-white text-sm font-semibold hover:bg-[#a01259] transition-colors"
        >
          {verificationStatus === "rejected" ? "Update Profile" : "View Profile"}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-gray-900">Appointments</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Select a patient, set date and time in a modal, then confirm.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          { label: "Total Requests", value: appointments.length, icon: Calendar },
          { label: "Queue", value: unscheduledQueue.length, icon: Clock },
          { label: "Scheduled", value: scheduledCount, icon: CheckCircle2 },
          { label: "Rejected", value: rejectedCount, icon: XCircle },
        ].map((item, index) => {
          const Icon = item.icon;
          return (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
              className="bg-white p-4 rounded-2xl border border-magenta-100 shadow-sm"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-pink-100">
                  <Icon className="w-4 h-4 text-magenta-500" />
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{item.value}</p>
                <p className="text-xs text-gray-500">{item.label}</p>
              </div>
            </motion.div>
          );
        })}
      </div>

      {assignError && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {assignError}
        </p>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-5">
        <div className="bg-white border border-gray-100 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-bold text-gray-900 inline-flex items-center gap-2">
              <Calendar className="w-4 h-4 text-magenta-500" /> {monthLabel}
            </h2>
            <div className="inline-flex items-center gap-1">
              <button
                onClick={() =>
                  setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
                }
                className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() =>
                  setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
                }
                className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="mb-4 rounded-xl border border-magenta-100 bg-magenta-50 p-3">
            <p className="text-xs font-semibold text-magenta-700 mb-2">Dynamic Slots for {selectedDate}</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={slotInput}
                onChange={(e) => setSlotInput(e.target.value)}
                className="w-24 px-3 py-2 rounded-lg border border-magenta-200 text-xs text-magenta-900 outline-none"
              />
              <button
                onClick={saveSlotForSelectedDate}
                className="px-3 py-2 rounded-lg bg-magenta-500 text-white text-xs font-semibold hover:bg-magenta-600"
              >
                Save Day Slots
              </button>
              <span className="text-[11px] text-magenta-600">
                Default: {clinicSettings.slotsPerDay}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-2 text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <p key={day}>{day}</p>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-2">
            {calendarCells.map((cell) => {
              const dayAppointments = appointmentsByDate[cell.key] || [];
              const used = dayAppointments.filter((a) => a.status !== "rejected").length;
              const capacity = getSlotsForDate(cell.key);
              const isSelected = selectedDate === cell.key;

              return (
                <div
                  key={cell.key}
                  onClick={() => {
                    setSelectedDate(cell.key);
                    setDayDetailDate(cell.key);
                    setSlotInput(String(getSlotsForDate(cell.key)));
                  }}
                  className={`min-h-[106px] rounded-xl border p-2 text-left transition-colors cursor-pointer ${
                    isSelected
                      ? "border-magenta-300 bg-magenta-50"
                      : cell.inCurrentMonth
                      ? "border-gray-100 bg-white hover:bg-gray-50"
                      : "border-gray-100 bg-gray-50 text-gray-300"
                  }`}
                >
                  <p
                    className={`text-sm font-semibold ${
                      cell.inCurrentMonth ? "text-gray-900" : "text-gray-300"
                    }`}
                  >
                    {cell.date.getDate()}
                  </p>
                  <p className="mt-1 text-[10px] text-gray-500">{used}/{capacity} slots</p>

                  <div className="mt-2 space-y-1">
                    {dayAppointments.some((a) => a.status === "scheduled" || a.status === "accepted") && (
                      <div className="h-1.5 rounded-full bg-green-400" />
                    )}
                    {dayAppointments.some((a) => a.status === "pending") && (
                      <div className="h-1.5 rounded-full bg-amber-400" />
                    )}
                    {dayAppointments.some((a) => a.status === "rejected") && (
                      <div className="h-1.5 rounded-full bg-red-400" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Scheduled on {selectedDate}</h3>
            {selectedDayAppointments.length === 0 && (
              <div className="border border-dashed border-gray-200 rounded-xl p-3 text-xs text-gray-500">
                No scheduled patients yet.
              </div>
            )}
            <div className="space-y-2">
              {selectedDayAppointments.map((appointment, i) => (
                <motion.div
                  key={appointment.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="rounded-xl border border-gray-100 p-3"
                >
                  <div className="flex items-start gap-3">
                    <img
                      src={appointment.conditionImage || fallbackConditionImage}
                      alt={appointment.conditionName || "Condition"}
                      className="w-12 h-12 rounded-lg object-cover border border-gray-200"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-gray-900 truncate">
                          {appointment.patientName || appointment.id}
                        </p>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-semibold">
                          {appointment.time || "time pending"}
                        </span>
                      </div>
                      {appointment.patientAge && (
                        <p className="text-[10px] text-gray-400 mt-0.5">{appointment.patientAge} years old</p>
                      )}
                      <p className="text-[11px] text-magenta-600 mt-0.5">
                        {appointment.conditionName || "Skin concern"}
                      </p>
                      <p className="text-[11px] text-gray-500 mt-1">{appointment.notes || "No patient notes"}</p>
                      {appointment.assignedDoctorName && (
                        <p className="text-[10px] text-blue-600 mt-0.5 flex items-center gap-1">
                          <Stethoscope className="w-3 h-3" /> {appointment.assignedDoctorName}
                        </p>
                      )}
                    </div>
                  </div>
                  {appointment.scheduleSentToDoctor ? (
                    <div className="mt-2 pt-2 border-t border-gray-100">
                      <span className="text-[10px] text-blue-600 flex items-center gap-1 font-semibold">
                        <CheckCircle2 className="w-3 h-3" /> Schedule sent to doctor
                      </span>
                    </div>
                  ) : appointment.assignedDoctorId && appointment.date ? (
                    <div className="mt-2 pt-2 border-t border-gray-100">
                      <button
                        onClick={() => sendScheduleToDoctor(appointment.id)}
                        className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-[10px] font-semibold hover:bg-blue-100 transition-colors"
                      >
                        <Stethoscope className="w-3 h-3" /> Send Schedule to Doctor
                      </button>
                    </div>
                  ) : null}
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-100 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-bold text-gray-900">List of Queue</h2>
            <span className="text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
              {unscheduledQueue.length} pending
            </span>
          </div>

          <p className="text-xs text-gray-500 mb-3">
            Click "Schedule Date & Time" on a patient card to open the scheduler modal.
          </p>

          <div className="space-y-2.5 max-h-[650px] overflow-y-auto pr-1">
            {unscheduledQueue.length === 0 && (
              <div className="border border-dashed border-gray-200 rounded-xl p-4 text-center">
                <p className="text-xs text-gray-500">No unscheduled requests.</p>
              </div>
            )}

            {unscheduledQueue.map((appointment) => (
              <div
                key={appointment.id}
                className="rounded-xl border border-gray-100 p-3 bg-gray-50/70"
              >
                <div className="flex items-start gap-3 mb-2">
                  <img
                    src={
                      appointment.patientAvatar ||
                      `https://ui-avatars.com/api/?name=${encodeURIComponent(
                        appointment.patientName || "Patient"
                      )}&background=fce7f3&color=c0166a`
                    }
                    alt={appointment.patientName || "Patient"}
                    className="w-12 h-12 rounded-lg object-cover border border-gray-200"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">
                          {appointment.patientName || `Queue #${appointment.id.slice(-4)}`}
                        </p>
                        {appointment.patientAge && (
                          <p className="text-[10px] text-gray-400">{appointment.patientAge} years old</p>
                        )}
                        <p className="text-[11px] text-magenta-600 mt-0.5">
                          {appointment.conditionName || "Skin concern"}
                        </p>
                        <p className="text-[11px] text-gray-500">
                          {new Date(appointment.createdAt).toLocaleString("en-US", {
                            month: "short",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold border bg-amber-50 text-amber-700 border-amber-200">
                        pending
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-1 text-xs text-gray-700 mb-2">
                  <p className="inline-flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    Face-to-Face
                  </p>
                  <p className="text-[11px] text-gray-500">{appointment.notes || "No patient notes"}</p>
                </div>

                <div className="space-y-2">
                  {/* Doctor assignment status */}
                  {appointment.assignedDoctorName && (
                    <div className={`flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1.5 rounded-lg border ${
                      appointment.doctorStatus === "approved"
                        ? "bg-green-50 text-green-700 border-green-200"
                        : appointment.doctorStatus === "rejected"
                        ? "bg-red-50 text-red-700 border-red-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}>
                      <Stethoscope className="w-3 h-3 shrink-0" />
                      {appointment.assignedDoctorName} —&nbsp;
                      {appointment.doctorStatus === "approved"
                        ? "Approved"
                        : appointment.doctorStatus === "rejected"
                        ? "Rejected"
                        : "Pending Review"}
                    </div>
                  )}
                  {appointment.doctorNote && (
                    <p className={`text-[10px] px-2 py-1 rounded-lg ${
                      appointment.doctorStatus === "rejected"
                        ? "bg-red-50 text-red-600 border border-red-200"
                        : "bg-green-50 text-green-600 border border-green-200"
                    }`}>
                      <strong>Dr. Note:</strong> {appointment.doctorNote}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setViewingPatient(appointment)}
                      className="inline-flex items-center justify-center gap-1 py-2 rounded-lg bg-[#c0166a] text-white text-[11px] font-semibold hover:bg-[#a01258] transition-colors"
                    >
                      <User className="w-3.5 h-3.5" /> View Details
                    </button>
                    <button
                      onClick={() => {
                        setAssignDoctorModal({ appointmentId: appointment.id });
                        setSelectedDoctorId(
                          clinicDoctors.find((d) => d.email === appointment.assignedDoctorId)?.id || ""
                        );
                      }}
                      title="Assign to doctor for review"
                      className="inline-flex items-center justify-center gap-1 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-[11px] font-semibold hover:bg-blue-100 transition-colors"
                    >
                      <Stethoscope className="w-3.5 h-3.5" />
                      {appointment.assignedDoctorId ? "Reassign" : "Assign Doc"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-xl bg-gray-50 border border-gray-100 p-3 text-[11px] text-gray-600">
            <p className="font-semibold mb-1">Queue Rule</p>
            <p>First submitted requests stay on top. Open scheduler modal, set date/time, then confirm.</p>
          </div>
        </div>
      </div>

      {/* ── Day Detail Modal ─────────────────────────────────── */}
      {dayDetailDate && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4" onClick={() => setDayDetailDate(null)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-[#c0166a] to-[#9b1257] px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-white font-bold text-base leading-tight">
                  {new Date(dayDetailDate + "T00:00:00").toLocaleDateString("en-US", {
                    weekday: "long", month: "long", day: "numeric", year: "numeric",
                  })}
                </p>
                <p className="text-pink-200 text-xs mt-0.5">
                  {(appointmentsByDate[dayDetailDate] || []).filter((a) => a.status !== "rejected").length} patient(s) scheduled
                </p>
              </div>
              <button
                onClick={() => setDayDetailDate(null)}
                className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
              >
                <XCircle className="w-4 h-4 text-white" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 max-h-[60vh] overflow-y-auto">
              {(appointmentsByDate[dayDetailDate] || []).filter((a) => a.status !== "rejected").length === 0 ? (
                <div className="border border-dashed border-gray-200 rounded-xl p-6 text-center">
                  <Calendar className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No patients scheduled for this date.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {(appointmentsByDate[dayDetailDate] || [])
                    .filter((a) => a.status !== "rejected")
                    .sort((a, b) => a.time.localeCompare(b.time))
                    .map((appt) => (
                      <div key={appt.id} className="rounded-xl border border-gray-100 bg-gray-50/70 p-3">
                        <div className="flex items-center gap-3">
                          <img
                            src={
                              appt.patientAvatar ||
                              `https://ui-avatars.com/api/?name=${encodeURIComponent(appt.patientName || "P")}&background=fce7f3&color=c0166a`
                            }
                            alt={appt.patientName}
                            className="w-10 h-10 rounded-full object-cover border border-gray-200 flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900 truncate">
                              {appt.patientName || "Unknown Patient"}
                            </p>
                            {appt.patientAge && (
                              <p className="text-[11px] text-gray-400">{appt.patientAge} years old</p>
                            )}
                          </div>
                          <span className="flex-shrink-0 flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-magenta-50 text-magenta-700 border border-magenta-200">
                            <Clock className="w-3 h-3" />
                            {appt.time
                              ? new Date(`1970-01-01T${appt.time}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
                              : "TBD"}
                          </span>
                        </div>
                        <div className="mt-2 pt-2 border-t border-gray-100 flex items-center gap-1.5">
                          <Stethoscope className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                          <span className="text-[11px] text-blue-700 font-medium">
                            {appt.assignedDoctorName || <span className="text-gray-400 italic">No doctor assigned yet</span>}
                          </span>
                          <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                            appt.status === "scheduled" || appt.status === "accepted"
                              ? "bg-green-50 text-green-700 border-green-200"
                              : "bg-amber-50 text-amber-700 border-amber-200"
                          }`}>
                            {appt.status}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            onClick={() => {
                              setDayDetailDate(null);
                              setViewingPatient(appt);
                            }}
                            className="col-span-2 rounded-lg bg-[#c0166a] py-2 text-xs font-semibold text-white hover:bg-[#a01258]"
                          >
                            View Appointment Details
                          </button>
                          <button
                            onClick={() => {
                              setDayDetailDate(null);
                              startScheduleAssignment(appt.id);
                            }}
                            className="rounded-lg border border-blue-200 bg-blue-50 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                          >
                            Reschedule
                          </button>
                          <button
                            onClick={() => {
                              setRejectModal({
                                appointmentId: appt.id,
                                patientName: appt.patientName || "Patient",
                                clinicName: appt.clinicName || clinicName,
                                patientEmail: appt.patientEmail,
                                date: appt.date,
                                time: appt.time,
                              });
                              setRejectReason("");
                              setSelectedPresetReason("");
                              setRejectError("");
                              setDayDetailDate(null);
                            }}
                            className="rounded-lg border border-red-200 bg-red-50 py-2 text-xs font-semibold text-red-600 hover:bg-red-100"
                          >
                            Cancel Appointment
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 pb-5">
              <button
                onClick={() => setDayDetailDate(null)}
                className="w-full py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* ── Patient Details Review Modal ─────────────────────── */}
      {viewingPatient && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-[#c0166a] to-[#9b1257] px-6 py-5 flex items-center gap-4">
              <img
                src={
                  viewingPatient.patientAvatar ||
                  `https://ui-avatars.com/api/?name=${encodeURIComponent(viewingPatient.patientName || "P")}&background=fce7f3&color=c0166a`
                }
                alt={viewingPatient.patientName}
                className="w-14 h-14 rounded-full object-cover border-2 border-white/60"
              />
              <div>
                <p className="text-white font-bold text-lg leading-tight">
                  {viewingPatient.patientName || "Unknown Patient"}
                </p>
                {viewingPatient.patientAge && (
                  <p className="text-pink-200 text-sm">{viewingPatient.patientAge} years old</p>
                )}
                <span className={`mt-1 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/20 text-white border border-white/30`}>
                  <MapPin className="w-3 h-3" /> Face-to-Face
                </span>
              </div>
              <button
                onClick={() => setViewingPatient(null)}
                className="ml-auto w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
              >
                <XCircle className="w-4 h-4 text-white" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">

              {/* ── Personal Information ── */}
              <div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Personal Information</p>
                <div className="space-y-2">
                  {(
                    [
                      { label: "Full Name",      value: viewingPatient.patientName },
                      { label: "Email",          value: viewingPatient.patientEmail },
                      { label: "Address",        value: viewingPatient.patientAddress },
                      { label: "Contact Number", value: viewingPatient.patientContact },
                    ] as { label: string; value?: string }[]
                  ).map(({ label, value }) => (
                    <div key={label} className="grid grid-cols-[140px_1fr] items-start gap-2">
                      <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide pt-0.5">{label}</span>
                      <span className="text-sm text-gray-800 bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5 min-h-[34px]">
                        {value || <span className="text-gray-300 italic">—</span>}
                      </span>
                    </div>
                  ))}
                  <div className="grid grid-cols-[140px_1fr] items-start gap-2">
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide pt-0.5">Consultation</span>
                    <span className="inline-flex items-center gap-1.5 self-start px-3 py-1.5 rounded-lg text-sm font-semibold border bg-magenta-50 text-magenta-700 border-magenta-200">
                      <MapPin className="w-3.5 h-3.5" /> Face to Face
                    </span>
                  </div>
                  {viewingPatient.status === "scheduled" && (
                    <div className="grid grid-cols-[140px_1fr] items-start gap-2">
                      <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide pt-0.5">Appointment Schedule</span>
                      <span className="text-sm text-gray-800 bg-green-50 border border-green-100 rounded-lg px-3 py-1.5">
                        {new Date(`${viewingPatient.date}T${viewingPatient.time || "00:00"}`).toLocaleString("en-US", {
                          weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
                        })}
                        {viewingPatient.assignedDoctorName && <span className="block mt-1 text-xs font-semibold text-blue-700">Dr. {viewingPatient.assignedDoctorName.replace(/^Dr\.\s*/i, "")}</span>}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Uploaded Skin Photo ── */}
              <div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Uploaded Skin Photo</p>
                {viewingPatient.skinPhotoUrl ? (
                  <img
                    src={viewingPatient.skinPhotoUrl}
                    alt="Patient skin photo"
                    className="w-full max-h-52 object-contain rounded-xl border border-gray-200 bg-gray-50"
                  />
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-center text-xs text-gray-400 italic">
                    No skin photo uploaded.
                  </div>
                )}
              </div>

              {/* ── AI Analysis Result ── */}
              <div className="rounded-xl border border-blue-100 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 border-b border-blue-100">
                  <ScanSearch className="w-4 h-4 text-blue-500" />
                  <span className="text-xs font-bold text-blue-700 uppercase tracking-wide">AI Analysis Result</span>
                </div>
                <div className="px-4 py-3 space-y-2">
                <div className="grid grid-cols-[140px_1fr] items-start gap-2">
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide pt-0.5">Detected Condition</span>
                    <span className="text-sm font-semibold text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-3 py-1.5">
                      {viewingPatient.aiConditionName || viewingPatient.conditionName || <span className="text-gray-300 italic">—</span>}
                    </span>
                  </div>
                  <div className="grid grid-cols-[140px_1fr] items-center gap-2">
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Confidence</span>
                    {viewingPatient.aiConfidence !== undefined ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 rounded-full h-2">
                          <div
                            className="h-2 rounded-full bg-blue-500"
                            style={{ width: `${Math.min(viewingPatient.aiConfidence, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-blue-700 w-14 text-right">
                          {viewingPatient.aiConfidence}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm text-gray-300 italic">—</span>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Additional Notes ── */}
              <div className="grid grid-cols-[140px_1fr] items-start gap-2">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide pt-0.5">Additional Notes</span>
                <span className="text-sm text-gray-700 bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5 leading-relaxed min-h-[60px]">
                  {viewingPatient.notes || <span className="text-gray-300 italic">No additional notes.</span>}
                </span>
              </div>

              {/* Submission time */}
              <p className="text-[11px] text-gray-400 pt-1">
                Submitted: {new Date(viewingPatient.createdAt).toLocaleString("en-US", {
                  month: "long", day: "numeric", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })}
              </p>
            </div>

            {/* Footer actions */}
            {viewingPatient.status === "scheduled" ? (
              <div className="px-6 pb-6 pt-2">
                <button
                  onClick={() => setViewingPatient(null)}
                  className="w-full py-3 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 transition-colors"
                >
                  Close
                </button>
              </div>
            ) : (
            <div className="px-6 pb-6 pt-2 grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  setRejectModal({
                    appointmentId: viewingPatient.id,
                    patientName: viewingPatient.patientName || "Patient",
                    clinicName: viewingPatient.clinicName || clinicName,
                    patientEmail: viewingPatient.patientEmail,
                    date: viewingPatient.date,
                    time: viewingPatient.time,
                  });
                  setRejectReason("");
                  setSelectedPresetReason("");
                  setRejectError("");
                  setViewingPatient(null);
                }}
                className="py-3 rounded-xl border border-red-200 bg-red-50 text-red-600 text-sm font-semibold hover:bg-red-100 transition-colors"
              >
                Reject Request
              </button>
              <button
                onClick={() => {
                  setViewingPatient(null);
                  startScheduleAssignment(viewingPatient.id);
                }}
                disabled={
                  !!(viewingPatient.assignedDoctorId && viewingPatient.doctorStatus !== "approved")
                }
                title={
                  viewingPatient.assignedDoctorId && viewingPatient.doctorStatus !== "approved"
                    ? "Waiting for doctor's review approval"
                    : "Schedule this appointment"
                }
                className="py-3 rounded-xl bg-[#c0166a] text-white text-sm font-semibold hover:bg-[#a01258] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {viewingPatient.assignedDoctorId && viewingPatient.doctorStatus !== "approved"
                  ? "Awaiting Doctor Review"
                  : "Schedule Appointment"}
              </button>
            </div>
            )}
          </motion.div>
        </div>
      )}

      {pendingAssign && (
        <div className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl border border-magenta-100 shadow-xl p-5">
            <h3 className="text-base font-display font-bold text-gray-900 mb-1">Schedule Date & Time</h3>
            <p className="text-xs text-gray-500 mb-4">Choose appointment date and time, then confirm.</p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Date</label>
                <input
                  type="date"
                  value={pendingAssign.date}
                  onChange={(e) =>
                    setPendingAssign((prev) =>
                      prev
                        ? {
                            ...prev,
                            date: e.target.value,
                          }
                        : prev
                    )
                  }
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Time</label>
                <input
                  type="time"
                  value={pendingAssign.time}
                  onChange={(e) =>
                    setPendingAssign((prev) =>
                      prev
                        ? {
                            ...prev,
                            time: e.target.value,
                          }
                        : prev
                    )
                  }
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Assign Doctor for Review</label>
                <select
                  value={pendingAssign.doctorId}
                  onChange={(e) =>
                    setPendingAssign((prev) => prev ? { ...prev, doctorId: e.target.value } : prev)
                  }
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 outline-none focus:border-magenta-400"
                >
                  <option value="">Select a doctor</option>
                  {clinicDoctors.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {doctor.name} - {doctor.specialization}
                    </option>
                  ))}
                </select>
                {clinicDoctors.length === 0 && (
                  <p className="mt-1.5 text-xs text-red-600">Add a doctor in Doctor Management before scheduling this appointment.</p>
                )}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                onClick={() => setPendingAssign(null)}
                className="py-2.5 rounded-lg border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmAssign}
                className="py-2.5 rounded-lg bg-magenta-500 text-white text-sm font-semibold hover:bg-magenta-600"
              >
                Confirm Schedule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Assign Doctor Modal ─────────────────────── */}
      {assignDoctorModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6"
          >
            <h3 className="font-bold text-gray-900 mb-1 flex items-center gap-2">
              <Stethoscope className="w-4 h-4 text-blue-500" /> Assign to Doctor
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Select a doctor to review this appointment's AI analysis.
            </p>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {clinicDoctors.length === 0 ? (
                <div className="rounded-xl border border-dashed border-blue-200 bg-blue-50/50 p-4 text-center">
                  <p className="text-xs text-gray-600">No doctors are available for this clinic yet.</p>
                  <button
                    onClick={addDoctorForAssignment}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-600"
                  >
                    <Stethoscope className="w-3.5 h-3.5" /> Add Doctor for Assignment
                  </button>
                </div>
              ) : (
                clinicDoctors.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => setSelectedDoctorId(doc.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl border text-sm transition-colors ${
                      selectedDoctorId === doc.id
                        ? "border-blue-400 bg-blue-50"
                        : "border-gray-200 hover:border-blue-300"
                    }`}
                  >
                    <p className="font-semibold text-gray-900">{doc.name}</p>
                    <p className="text-[11px] text-gray-500">{doc.specialization}</p>
                  </button>
                ))
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => { setAssignDoctorModal(null); setSelectedDoctorId(""); }}
                className="py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={assignDoctor}
                disabled={!selectedDoctorId}
                className="py-2.5 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Assign
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* ── Reject Request with Reason Modal ─────────────────────── */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 border border-red-100"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-red-600 shrink-0">
                <XCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 text-base">Decline Appointment Request</h3>
                <p className="text-xs text-gray-500">
                  Patient: <span className="font-semibold text-gray-700">{rejectModal.patientName}</span>
                </p>
              </div>
            </div>

            <p className="text-xs text-gray-600 mb-3 leading-relaxed">
              Please provide a reason or note for declining this appointment. The patient will receive a notification along with this note.
            </p>

            {rejectError && (
              <div className="mb-3 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-600 font-medium">
                {rejectError}
              </div>
            )}

            {/* Quick Reason Presets */}
            <div className="space-y-1.5 mb-3">
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                Select Common Reason:
              </label>
              <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                {[
                  "Doctor unavailable on the requested schedule",
                  "Clinic has reached full capacity for the selected date",
                  "Condition requires specialized hospital/emergency facility",
                  "Incomplete or unclear patient skin condition details",
                  "Schedule conflict with clinic operating hours",
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setSelectedPresetReason(preset);
                      setRejectReason(preset);
                      setRejectError("");
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors border ${
                      selectedPresetReason === preset || rejectReason === preset
                        ? "bg-red-50 border-red-300 text-red-700 font-medium"
                        : "bg-gray-50 border-gray-100 text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    • {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Reason Note */}
            <div className="mb-4">
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                Reason / Note for Patient:
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => {
                  setRejectReason(e.target.value);
                  setRejectError("");
                }}
                rows={3}
                placeholder="Type the rejection reason or note for the patient here..."
                className="w-full px-3 py-2 text-xs rounded-xl border border-gray-200 text-gray-900 outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setRejectModal(null);
                  setRejectReason("");
                  setSelectedPresetReason("");
                  setRejectError("");
                }}
                className="py-2.5 rounded-xl border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRejection}
                className="py-2.5 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-colors shadow-sm"
              >
                Confirm Decline
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
