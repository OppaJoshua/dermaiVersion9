import { useMemo, useState, useEffect } from "react";
import {
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lock,
  MapPin,
  Stethoscope,
  User,
  XCircle,
  X,
  RefreshCw,
} from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { skinConditions } from "@/pages/public/SkinLibrary";
import { useClinicVerification } from "@/hooks/useClinicVerification";
import { supabase } from "@/lib/supabaseClient";

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
  status: "pending" | "accepted" | "scheduled" | "rejected" | "completed";
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
};

const DEFAULT_SETTINGS: ClinicSettings = {
  openTime: "09:00",
  closeTime: "18:00",
};

export default function ClinicAppointmentsPage() {
  const { status: verificationStatus, clinicName: verifiedClinicName, clinicId, loading } = useClinicVerification();
  const fallbackConditionImage = skinConditions[0]?.image;
  let clinicName = verifiedClinicName || "";
  if (!clinicName) {
    try {
      const raw = localStorage.getItem("dermai_clinic_settings");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.name) clinicName = parsed.name;
      }
    } catch {
      /* ignore */
    }
  }

  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [clinicDoctors, setClinicDoctors] = useState<DoctorAccount[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const loadData = async () => {
    setLoadingData(true);
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

    // 1. Fetch clinic doctors from clinic_doctor table
    let docRows: any[] = [];
    if (resolvedClinicId) {
      const { data } = await supabase
        .from("clinic_doctor")
        .select("doctor_id, doctor_name, email, photo_url, status")
        .eq("clinic_id", resolvedClinicId)
        .neq("status", "Inactive");
      if (data && data.length > 0) {
        docRows = data;
        setClinicDoctors(docRows.map((d: any) => ({
          id: d.doctor_id,
          name: d.doctor_name,
          email: d.email || "",
          specialization: "Dermatology",
          clinicName: clinicName || "Clinic",
        })));
      }
    }

    if (docRows.length === 0) {
      try {
        const raw = localStorage.getItem("dermai_clinic_doctors");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setClinicDoctors(parsed.map((d: any) => ({
              id: d.id,
              name: d.name,
              email: d.email || "",
              specialization: d.specialization || "Dermatology",
              clinicName: clinicName || d.clinicName || "Clinic",
            })));
          }
        }
      } catch { }
    }

    // 2. Fetch appointments from patient_appointment table
    let dbAppts: any[] = [];
    if (resolvedClinicId) {
      const { data: apptRows, error: apptErr } = await supabase
        .from("patient_appointment")
        .select(`
          appointment_id,
          date,
          status,
          notes,
          clinic_note,
          skin_photo_url,
          patient_name,
          patient_email,
          patient_contact,
          patient_address,
          ai_condition_name,
          ai_confidence,
          assigned_doctor_id,
          doctor_status,
          doctor_note,
          doctor_reviewed_at,
          schedule_sent_to_doctor,
          created_at
        `)
        .eq("clinic_id", resolvedClinicId)
        .order("created_at", { ascending: false });

      if (apptErr) {
        console.warn("[ClinicAppointmentsPage] Failed to fetch patient_appointment from Supabase:", apptErr.message);
      } else if (apptRows) {
        dbAppts = apptRows;
      }
    }

    // Map database records
    const mapped: AppointmentRecord[] = await Promise.all(
      dbAppts.map(async (a: any) => {
        let photoUrl = a.skin_photo_url || undefined;
        if (photoUrl && !photoUrl.startsWith("http") && !photoUrl.startsWith("data:")) {
          try {
            const { data: signed } = await supabase.storage
              .from("scan-uploads")
              .createSignedUrl(photoUrl, 3600);
            if (signed?.signedUrl) {
              photoUrl = signed.signedUrl;
            }
          } catch {
            /* ignore */
          }
        }

        const apptDate = a.date ? new Date(a.date) : null;
        const isValidDate = apptDate && !isNaN(apptDate.getTime());
        const dateStr = isValidDate ? `${apptDate.getFullYear()}-${String(apptDate.getMonth() + 1).padStart(2, "0")}-${String(apptDate.getDate()).padStart(2, "0")}` : "";
        const timeStr = isValidDate ? `${String(apptDate.getHours()).padStart(2, "0")}:${String(apptDate.getMinutes()).padStart(2, "0")}` : "";

        let displayStatus: AppointmentRecord["status"] = "pending";
        if (a.status === "confirmed" || a.status === "scheduled") displayStatus = "scheduled";
        else if (a.status === "completed") displayStatus = "completed";
        else if (a.status === "cancelled" || a.status === "rejected") displayStatus = "rejected";
        else if (a.status === "accepted") displayStatus = "accepted";

        const assignedDoc = docRows.find((d: any) => d.doctor_id === a.assigned_doctor_id);

        return {
          id: a.appointment_id,
          clinicId: 0,
          clinicName: clinicName || "Clinic",
          patientName: a.patient_name || "Patient",
          patientEmail: a.patient_email || undefined,
          patientAddress: a.patient_address || undefined,
          patientContact: a.patient_contact || undefined,
          consultationType: "face-to-face" as const,
          conditionName: a.ai_condition_name || undefined,
          date: dateStr,
          time: timeStr,
          notes: a.notes || "",
          status: displayStatus,
          clinicNote: a.clinic_note || undefined,
          assignedDoctorId: a.assigned_doctor_id || undefined,
          assignedDoctorName: assignedDoc?.doctor_name || undefined,
          doctorStatus: a.doctor_status || undefined,
          doctorNote: a.doctor_note || undefined,
          doctorReviewedAt: a.doctor_reviewed_at || undefined,
          scheduleSentToDoctor: a.schedule_sent_to_doctor || false,
          createdAt: a.created_at || new Date().toISOString(),
          skinPhotoUrl: photoUrl,
          aiConditionName: a.ai_condition_name || undefined,
          aiConfidence: a.ai_confidence ? Number(a.ai_confidence) : undefined,
        };
      })
    );

    // Merge with local storage appointments strictly matching this specific clinic_id
    try {
      const raw = localStorage.getItem("dermai_clinic_appointments");
      if (raw && resolvedClinicId) {
        const localList = JSON.parse(raw);
        if (Array.isArray(localList)) {
          localList.forEach((localItem: any) => {
            const exists = mapped.some((m) => m.id === localItem.id);
            if (!exists) {
              const isMatch = Boolean(localItem.clinicId && String(localItem.clinicId) === String(resolvedClinicId));
              if (isMatch) {
                mapped.push({
                  id: localItem.id,
                  clinicId: 0,
                  clinicName: localItem.clinicName || clinicName || "Clinic",
                  patientName: localItem.patientName || "Patient",
                  patientEmail: localItem.patientEmail || undefined,
                  patientAddress: localItem.patientAddress || undefined,
                  patientContact: localItem.patientContact || undefined,
                  consultationType: "face-to-face" as const,
                  conditionName: localItem.aiConditionName || localItem.conditionName || undefined,
                  date: localItem.date || "",
                  time: localItem.time || "",
                  notes: localItem.notes || "",
                  status: localItem.status || "pending",
                  clinicNote: localItem.clinicNote || undefined,
                  assignedDoctorId: localItem.assignedDoctorId || undefined,
                  assignedDoctorName: localItem.assignedDoctorName || undefined,
                  doctorStatus: localItem.doctorStatus || undefined,
                  doctorNote: localItem.doctorNote || undefined,
                  doctorReviewedAt: localItem.doctorReviewedAt || undefined,
                  scheduleSentToDoctor: localItem.scheduleSentToDoctor || false,
                  createdAt: localItem.createdAt || new Date().toISOString(),
                  skinPhotoUrl: localItem.skinPhotoUrl || undefined,
                  aiConditionName: localItem.aiConditionName || undefined,
                  aiConfidence: localItem.aiConfidence ? Number(localItem.aiConfidence) : undefined,
                });
              }
            }
          });
        }
      }
    } catch { }

    setAppointments(mapped);
    try {
      localStorage.setItem("dermai_clinic_appointments", JSON.stringify(mapped));
    } catch { }
    setLoadingData(false);
  };

  useEffect(() => {
    loadData();

    // Realtime channel for live incoming appointments and status updates
    let channel: any = null;
    if (clinicId) {
      channel = supabase
        .channel(`clinic-appointments-realtime-${clinicId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "patient_appointment", filter: `clinic_id=eq.${clinicId}` },
          () => {
            loadData();
          }
        )
        .subscribe();
    }

    const handleSync = () => loadData();
    window.addEventListener("dermai_appointments_updated", handleSync);
    window.addEventListener("appointmentCreated", handleSync);
    window.addEventListener("storage", handleSync);
    window.addEventListener("focus", handleSync);

    return () => {
      if (channel) supabase.removeChannel(channel);
      window.removeEventListener("dermai_appointments_updated", handleSync);
      window.removeEventListener("appointmentCreated", handleSync);
      window.removeEventListener("storage", handleSync);
      window.removeEventListener("focus", handleSync);
    };
  }, [clinicId, clinicName]);

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

  const [clinicSettings] = useState<ClinicSettings>(() => {
    try {
      const raw = localStorage.getItem("dermai_clinic_settings");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed) {
          return {
            openTime: parsed.openTime || DEFAULT_SETTINGS.openTime,
            closeTime: parsed.closeTime || DEFAULT_SETTINGS.closeTime,
          };
        }
      }
    } catch {
      /* ignore */
    }
    return DEFAULT_SETTINGS;
  });

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
  const [assignError, setAssignError] = useState("");

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
      if (!item.date || item.status === "rejected") return acc;
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

  const rejectRequest = async (id: string, reason?: string) => {
    const rejectionReason = reason?.trim() || "Request declined by clinic scheduling.";
    try {
      await supabase
        .from("patient_appointment")
        .update({
          status: "cancelled",
          doctor_status: "rejected",
          clinic_note: rejectionReason,
        })
        .eq("appointment_id", id);
    } catch (err: any) {
      console.error("Failed to reject appointment in Supabase:", err.message);
    }

    setAppointments((prev) => {
      const next = prev.map((appt) =>
        appt.id === id
          ? {
              ...appt,
              status: "rejected" as const,
              doctorStatus: "rejected" as const,
              clinicNote: rejectionReason,
              rejectionReason,
            }
          : appt
      );
      try {
        localStorage.setItem("dermai_clinic_appointments", JSON.stringify(next));
        window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
        window.dispatchEvent(new Event("storage"));
      } catch { }
      return next;
    });
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
      doctorId: clinicDoctors.find((doctor) => doctor.id === appointment?.assignedDoctorId)?.id || "",
    });
  };

  const confirmAssign = async () => {
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

    let targetDoctorId: string | null = doctor.id;
    const isUuid = (id?: string | null): boolean =>
      !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    if (!targetDoctorId || !isUuid(targetDoctorId)) {
      try {
        const { data: dbDoc } = await supabase
          .from("clinic_doctor")
          .select("doctor_id")
          .or(`email.ilike.%${doctor.email || "nomatch"}%,doctor_name.ilike.%${doctor.name || "nomatch"}%`)
          .limit(1)
          .maybeSingle();
        if (dbDoc?.doctor_id && isUuid(dbDoc.doctor_id)) {
          targetDoctorId = dbDoc.doctor_id;
        } else {
          targetDoctorId = null;
        }
      } catch {
        targetDoctorId = null;
      }
    }

    try {
      const { error: updateErr } = await supabase
        .from("patient_appointment")
        .update({
          status: "confirmed",
          date: `${pendingAssign.date}T${pendingAssign.time}:00`,
          ...(targetDoctorId ? { assigned_doctor_id: targetDoctorId } : {}),
          schedule_sent_to_doctor: true,
          doctor_status: "pending-review",
          clinic_note: "Your schedule has been assigned by the clinic.",
        })
        .eq("appointment_id", pendingAssign.appointmentId);

      if (updateErr) {
        console.error("Failed to save schedule in Supabase:", updateErr.message);
      }
    } catch (err: any) {
      console.error("Failed to save schedule in Supabase:", err.message);
    }

    setAppointments((prev) => {
      const next = prev.map((appt) => {
        if (appt.id !== pendingAssign.appointmentId) return appt;
        return {
          ...appt,
          date: pendingAssign.date,
          time: pendingAssign.time,
          status: "scheduled" as const,
          assignedDoctorId: targetDoctorId || doctor.id,
          assignedDoctorName: doctor.name,
          doctorStatus: "pending-review" as const,
          scheduleSentToDoctor: true,
          clinicNote: "Your schedule has been assigned by the clinic.",
        };
      });
      try {
        localStorage.setItem("dermai_clinic_appointments", JSON.stringify(next));
        window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
        window.dispatchEvent(new Event("storage"));
      } catch { }
      return next;
    });
    setPendingAssign(null);
  };

  const assignDoctor = async () => {
    if (!assignDoctorModal || !selectedDoctorId) return;
    const doc = clinicDoctors.find((d) => d.id === selectedDoctorId);
    if (!doc) return;

    let targetDoctorId: string | null = doc.id;
    const isUuid = (id?: string | null): boolean =>
      !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    if (!targetDoctorId || !isUuid(targetDoctorId)) {
      try {
        const { data: dbDoc } = await supabase
          .from("clinic_doctor")
          .select("doctor_id")
          .or(`email.ilike.%${doc.email || "nomatch"}%,doctor_name.ilike.%${doc.name || "nomatch"}%`)
          .limit(1)
          .maybeSingle();
        if (dbDoc?.doctor_id && isUuid(dbDoc.doctor_id)) {
          targetDoctorId = dbDoc.doctor_id;
        } else {
          targetDoctorId = null;
        }
      } catch {
        targetDoctorId = null;
      }
    }

    try {
      const { error: updateErr } = await supabase
        .from("patient_appointment")
        .update({
          ...(targetDoctorId ? { assigned_doctor_id: targetDoctorId } : {}),
          doctor_status: "pending-review",
        })
        .eq("appointment_id", assignDoctorModal.appointmentId);

      if (updateErr) {
        console.error("Failed to assign doctor in Supabase:", updateErr.message);
      }
    } catch (err: any) {
      console.error("Failed to assign doctor in Supabase:", err.message);
    }

    setAppointments((prev) => {
      const next = prev.map((a) => {
        if (a.id !== assignDoctorModal.appointmentId) return a;
        return {
          ...a,
          assignedDoctorId: targetDoctorId || undefined,
          assignedDoctorName: doc.name,
          doctorStatus: "pending-review" as const,
        };
      });
      try {
        localStorage.setItem("dermai_clinic_appointments", JSON.stringify(next));
        window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
      } catch { }
      return next;
    });
    setAssignDoctorModal(null);
    setSelectedDoctorId("");
    setAssignError("");
  };

  const sendScheduleToDoctor = async (appointmentId: string) => {
    try {
      await supabase
        .from("patient_appointment")
        .update({ schedule_sent_to_doctor: true })
        .eq("appointment_id", appointmentId);
    } catch (err: any) {
      console.error("Failed to update scheduleSentToDoctor in Supabase:", err.message);
    }

    setAppointments((prev) =>
      prev.map((a) =>
        a.id === appointmentId ? { ...a, scheduleSentToDoctor: true } : a
      )
    );
  };

  if (loading && verificationStatus !== "verified") {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-gray-200 rounded-lg"></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-white rounded-2xl border border-gray-100 p-4"></div>
          ))}
        </div>
        <div className="h-96 bg-white rounded-2xl border border-gray-100"></div>
      </div>
    );
  }

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
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Appointments</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Select a patient, set date and time in a modal, then confirm.
          </p>
        </div>
        <button
          type="button"
          onClick={loadData}
          disabled={loadingData}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors shadow-xs cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingData ? "animate-spin text-magenta-600" : "text-gray-500"}`} />
          <span>{loadingData ? "Syncing..." : "Refresh Queue"}</span>
        </button>
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


          <div className="grid grid-cols-7 gap-2 text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <p key={day}>{day}</p>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-2">
            {calendarCells.map((cell) => {
              const isSelected = selectedDate === cell.key;
              const dayAppointments = appointmentsByDate[cell.key] || [];

              return (
                <div
                  key={cell.key}
                  onClick={() => {
                    setSelectedDate(cell.key);
                    setDayDetailDate(cell.key);
                  }}
                  className={`min-h-[106px] rounded-xl border p-2 text-left transition-colors cursor-pointer ${isSelected
                    ? "border-magenta-300 bg-magenta-50"
                    : cell.inCurrentMonth
                      ? "border-gray-100 bg-white hover:bg-gray-50"
                      : "border-gray-100 bg-gray-50 text-gray-300"
                    }`}
                >
                  <p
                    className={`text-sm font-semibold ${cell.inCurrentMonth ? "text-gray-900" : "text-gray-300"
                      }`}
                  >
                    {cell.date.getDate()}
                  </p>

                  <div className="mt-2 space-y-1">
                    {dayAppointments.some((a) => a.status === "scheduled" || a.status === "accepted") && (
                      <div className="h-1.5 rounded-full bg-green-400" />
                    )}
                    {dayAppointments.some((a) => a.status === "pending") && (
                      <div className="h-1.5 rounded-full bg-amber-400" />
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
                      src={appointment.patientAvatar || appointment.skinPhotoUrl || appointment.conditionImage || fallbackConditionImage}
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
            Click "Schedule &amp; Assign" on a patient card to assign a date, time, and dermatologist.
          </p>

          <div className="space-y-2.5 max-h-[650px] overflow-y-auto pr-1">
            {unscheduledQueue.length === 0 && (
              <div className="border border-dashed border-gray-200 rounded-2xl p-6 text-center bg-gray-50/50">
                <Clock className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-xs font-semibold text-gray-600">No pending requests</p>
                <p className="text-[11px] text-gray-400 mt-1 max-w-xs mx-auto">
                  When patients request a consultation, they will appear here in the queue for you to assign dates, times, and dermatologists.
                </p>
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
                    className="w-12 h-12 rounded-full object-cover border border-gray-200 shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(
                        appointment.patientName || "Patient"
                      )}&background=fce7f3&color=c0166a`;
                    }}
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
                    <div className={`flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1.5 rounded-lg border ${appointment.doctorStatus === "approved"
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
                    <p className={`text-[10px] px-2 py-1 rounded-lg ${appointment.doctorStatus === "rejected"
                      ? "bg-red-50 text-red-600 border border-red-200"
                      : "bg-green-50 text-green-600 border border-green-200"
                      }`}>
                      <strong>Dr. Note:</strong> {appointment.doctorNote}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      onClick={() => setViewingPatient(appointment)}
                      className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <User className="w-3.5 h-3.5" /> Details
                    </button>
                    <button
                      onClick={() => startScheduleAssignment(appointment.id)}
                      className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-[#c0166a] hover:bg-[#a01258] text-white text-xs font-semibold transition-colors shadow-xs cursor-pointer"
                    >
                      <Calendar className="w-3.5 h-3.5" /> Schedule &amp; Assign
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-xl bg-gray-50 border border-gray-100 p-3 text-[11px] text-gray-600">
            <p className="font-semibold mb-1">Queue Rule</p>
            <p>First submitted requests stay on top. Click "Schedule &amp; Assign" to set date, time, and doctor, then confirm.</p>
          </div>
        </div>
      </div>

      {/* ── Day Detail Modal ─────────────────────────────────── */}
      {dayDetailDate && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setDayDetailDate(null)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden text-left"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 bg-white flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-gray-900 leading-tight">
                  {new Date(dayDetailDate + "T00:00:00").toLocaleDateString("en-US", {
                    weekday: "long", month: "long", day: "numeric", year: "numeric",
                  })}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5 font-medium">
                  {(appointmentsByDate[dayDetailDate] || []).length} patient(s) scheduled
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDayDetailDate(null)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 max-h-[60vh] overflow-y-auto space-y-3">
              {(appointmentsByDate[dayDetailDate] || []).length === 0 ? (
                <div className="border border-dashed border-gray-200 rounded-2xl p-8 text-center bg-gray-50/50">
                  <Calendar className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-gray-500">No patients scheduled for this date.</p>
                </div>
              ) : (
                (appointmentsByDate[dayDetailDate] || [])
                  .sort((a, b) => a.time.localeCompare(b.time))
                  .map((appt) => (
                    <div key={appt.id} className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 space-y-3">
                      <div className="flex items-center gap-3">
                        <img
                          src={
                            appt.patientAvatar ||
                            `https://ui-avatars.com/api/?name=${encodeURIComponent(appt.patientName || "P")}&background=fce7f3&color=c0166a`
                          }
                          alt={appt.patientName}
                          className="w-10 h-10 rounded-full object-cover border border-gray-200 shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-gray-900 truncate">
                            {appt.patientName || "Unknown Patient"}
                          </p>
                          {appt.patientAge && (
                            <p className="text-[11px] text-gray-500">{appt.patientAge} years old</p>
                          )}
                        </div>
                        <span className="shrink-0 flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-white text-gray-700 border border-gray-200 shadow-xs">
                          <Clock className="w-3 h-3 text-gray-400" />
                          {appt.time
                            ? new Date(`1970-01-01T${appt.time}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
                            : "TBD"}
                        </span>
                      </div>
                      <div className="pt-2 border-t border-gray-200/60 flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Stethoscope className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <span className="text-gray-700 font-medium truncate">
                            {appt.assignedDoctorName || <span className="text-gray-400 italic">No doctor assigned</span>}
                          </span>
                        </div>
                        <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold border ${appt.status === "scheduled" || appt.status === "accepted"
                          ? "bg-green-50 text-green-700 border-green-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                          }`}>
                          {appt.status}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setDayDetailDate(null);
                            setViewingPatient(appt);
                          }}
                          className="col-span-2 py-2 rounded-xl bg-magenta-600 hover:bg-magenta-700 text-white text-xs font-semibold transition-colors shadow-xs cursor-pointer text-center"
                        >
                          View Appointment Details
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDayDetailDate(null);
                            startScheduleAssignment(appt.id);
                          }}
                          className="py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold transition-colors cursor-pointer text-center"
                        >
                          Reschedule
                        </button>
                        <button
                          type="button"
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
                          className="py-2 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold transition-colors cursor-pointer text-center"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>

            {/* Footer */}
            <div className="px-6 pb-5 pt-2 border-t border-gray-100 bg-white">
              <button
                type="button"
                onClick={() => setDayDetailDate(null)}
                className="w-full py-2.5 rounded-full border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* ── Patient Details Review Modal ─────────────────────── */}
      {viewingPatient && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[88vh] text-left"
          >
            {/* Minimal Header (No Gradient) */}
            <div className="px-6 py-4 border-b border-gray-100 bg-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img
                  src={
                    viewingPatient.patientAvatar ||
                    `https://ui-avatars.com/api/?name=${encodeURIComponent(viewingPatient.patientName || "P")}&background=fce7f3&color=c0166a`
                  }
                  alt={viewingPatient.patientName}
                  className="w-11 h-11 rounded-full object-cover border border-gray-200 shrink-0"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-base font-bold text-gray-900 leading-tight">
                      {viewingPatient.patientName || "Unknown Patient"}
                    </p>
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                      <MapPin className="w-2.5 h-2.5 text-gray-400" /> Face-to-Face
                    </span>
                  </div>
                  {viewingPatient.patientAge ? (
                    <p className="text-xs text-gray-500 mt-0.5">{viewingPatient.patientAge} years old</p>
                  ) : (
                    <p className="text-xs text-gray-400 mt-0.5">Appointment Request</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingPatient(null)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4 overflow-y-auto">
              {/* Personal Information */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Personal Information</p>
                <div className="space-y-1.5 bg-gray-50 border border-gray-100 rounded-2xl p-3.5">
                  {(
                    [
                      { label: "Full Name", value: viewingPatient.patientName },
                      { label: "Email", value: viewingPatient.patientEmail },
                      { label: "Address", value: viewingPatient.patientAddress },
                      { label: "Contact", value: viewingPatient.patientContact },
                    ] as { label: string; value?: string }[]
                  ).map(({ label, value }) => (
                    <div key={label} className="grid grid-cols-[110px_1fr] items-center text-xs">
                      <span className="font-semibold text-gray-400">{label}:</span>
                      <span className="text-gray-900 font-medium truncate">{value || <span className="text-gray-300 italic">—</span>}</span>
                    </div>
                  ))}
                  {viewingPatient.status === "scheduled" && (
                    <div className="grid grid-cols-[110px_1fr] items-start text-xs pt-1 border-t border-gray-200/60 mt-1">
                      <span className="font-semibold text-green-700">Schedule:</span>
                      <div className="text-gray-900 font-semibold">
                        {new Date(`${viewingPatient.date}T${viewingPatient.time || "00:00"}`).toLocaleString("en-US", {
                          weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
                        })}
                        {viewingPatient.assignedDoctorName && (
                          <span className="block text-xs font-normal text-gray-600 mt-0.5">
                            Assigned: Dr. {viewingPatient.assignedDoctorName.replace(/^Dr\.\s*/i, "")}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Uploaded Skin Photo */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Uploaded Skin Photo</p>
                {viewingPatient.skinPhotoUrl ? (
                  <div className="rounded-2xl border border-gray-100 bg-gray-50 overflow-hidden">
                    <img
                      src={viewingPatient.skinPhotoUrl}
                      alt="Patient skin photo"
                      className="w-full max-h-48 object-contain"
                    />
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 px-4 py-5 text-center text-xs text-gray-400 italic">
                    No skin photo uploaded.
                  </div>
                )}
              </div>

              {/* AI Analysis Result */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">AI Scan Result</p>
                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-500">Condition:</span>
                    <span className="font-bold text-gray-900">
                      {viewingPatient.aiConditionName || viewingPatient.conditionName || "General Consultation"}
                    </span>
                  </div>
                  {viewingPatient.aiConfidence !== undefined && (
                    <div className="flex items-center justify-between pt-1 border-t border-gray-200/60">
                      <span className="font-semibold text-gray-500">Confidence:</span>
                      <span className="font-bold text-magenta-700">{viewingPatient.aiConfidence}%</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Additional Notes */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Patient Notes</p>
                <div className="text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded-2xl p-3.5 leading-relaxed">
                  {viewingPatient.notes || <span className="text-gray-400 italic">No additional notes provided.</span>}
                </div>
              </div>

              {/* Submission timestamp */}
              <p className="text-[11px] text-gray-400 pt-1">
                Requested: {new Date(viewingPatient.createdAt).toLocaleString("en-US", {
                  month: "short", day: "numeric", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })}
              </p>
            </div>

            {/* Footer actions */}
            {viewingPatient.status === "scheduled" ? (
              <div className="px-6 pb-5 pt-3 border-t border-gray-100 bg-white">
                <button
                  type="button"
                  onClick={() => setViewingPatient(null)}
                  className="w-full py-3 rounded-full border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            ) : (
              <div className="px-6 pb-5 pt-3 border-t border-gray-100 bg-white grid grid-cols-2 gap-3">
                <button
                  type="button"
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
                  className="py-3 rounded-full border border-red-200 bg-red-50 text-red-600 text-xs font-semibold hover:bg-red-100 transition-colors cursor-pointer"
                >
                  Decline Request
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewingPatient(null);
                    startScheduleAssignment(viewingPatient.id);
                  }}
                  className="py-3 rounded-full bg-magenta-600 hover:bg-magenta-700 text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer"
                >
                  Schedule &amp; Assign Doctor
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}

      {/* ── Schedule & Assign Modal ─────────────────────── */}
      {pendingAssign && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-md bg-white rounded-3xl border border-gray-100 shadow-2xl p-6 text-left"
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-bold text-gray-900">Schedule &amp; Assign Consultation</h3>
              <button
                type="button"
                onClick={() => setPendingAssign(null)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-5">Choose consultation schedule and assign an attending dermatologist.</p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Consultation Date</label>
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
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-xs text-gray-900 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 transition-all bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Consultation Time</label>
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
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-xs text-gray-900 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 transition-all bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Attending Dermatologist</label>
                <select
                  value={pendingAssign.doctorId}
                  onChange={(e) =>
                    setPendingAssign((prev) => prev ? { ...prev, doctorId: e.target.value } : prev)
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white text-xs text-gray-900 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/10 transition-all cursor-pointer"
                >
                  <option value="">Select an attending doctor</option>
                  {clinicDoctors.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {doctor.name} ({doctor.specialization})
                    </option>
                  ))}
                </select>
                {clinicDoctors.length === 0 && (
                  <p className="mt-1.5 text-xs text-amber-600 font-medium">Add a doctor in Doctor Management before scheduling.</p>
                )}
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setPendingAssign(null)}
                className="py-3 rounded-full border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmAssign}
                className="py-3 rounded-full bg-magenta-600 hover:bg-magenta-700 text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer"
              >
                Confirm &amp; Assign
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* ── Assign Doctor Modal ─────────────────────── */}
      {assignDoctorModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-sm bg-white rounded-3xl border border-gray-100 shadow-2xl p-6 text-left"
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-gray-900 text-base flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-magenta-600" /> Assign Doctor
              </h3>
              <button
                type="button"
                onClick={() => { setAssignDoctorModal(null); setSelectedDoctorId(""); }}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Select a doctor to review this patient's case.
            </p>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {clinicDoctors.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-center">
                  <p className="text-xs text-gray-500">No doctors registered yet.</p>
                  <Link
                    to="/clinic/doctors"
                    className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-magenta-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-magenta-700 transition-colors shadow-xs"
                  >
                    <Stethoscope className="w-3.5 h-3.5" /> Add Doctor
                  </Link>
                </div>
              ) : (
                clinicDoctors.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => setSelectedDoctorId(doc.id)}
                    className={`w-full text-left px-3.5 py-3 rounded-2xl border text-xs transition-colors cursor-pointer ${selectedDoctorId === doc.id
                      ? "border-magenta-500 bg-magenta-50/40 text-magenta-900 ring-1 ring-magenta-500"
                      : "border-gray-200 hover:border-gray-300 bg-white"
                      }`}
                  >
                    <p className="font-bold text-gray-900">{doc.name}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">{doc.specialization}</p>
                  </button>
                ))
              )}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => { setAssignDoctorModal(null); setSelectedDoctorId(""); }}
                className="py-2.5 rounded-full border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={assignDoctor}
                disabled={!selectedDoctorId}
                className="py-2.5 rounded-full bg-magenta-600 text-white text-xs font-semibold hover:bg-magenta-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-xs cursor-pointer"
              >
                Assign
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* ── Reject Request with Reason Modal ─────────────────────── */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 border border-gray-100 text-left"
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-gray-900 text-base">Decline Appointment</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Patient: <span className="font-semibold text-gray-800">{rejectModal.patientName}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRejectModal(null);
                  setRejectReason("");
                  setSelectedPresetReason("");
                  setRejectError("");
                }}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-gray-600 mb-3.5 leading-relaxed">
              Please provide a reason. The patient will receive a notification with this note.
            </p>

            {rejectError && (
              <div className="mb-3 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-600 font-medium">
                {rejectError}
              </div>
            )}

            {/* Quick Reason Presets */}
            <div className="space-y-1.5 mb-3.5">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                Common Reasons
              </label>
              <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                {[
                  "Doctor unavailable on the requested schedule",
                  "Clinic has reached full capacity for the selected date",
                  "Condition requires specialized hospital facility",
                  "Incomplete or unclear patient skin condition details",
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setSelectedPresetReason(preset);
                      setRejectReason(preset);
                      setRejectError("");
                    }}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-colors border cursor-pointer ${selectedPresetReason === preset || rejectReason === preset
                      ? "bg-red-50 border-red-200 text-red-700 font-semibold"
                      : "bg-gray-50 border-gray-100 text-gray-600 hover:bg-gray-100"
                      }`}
                  >
                    • {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Reason Note */}
            <div className="mb-5">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                Note for Patient
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => {
                  setRejectReason(e.target.value);
                  setRejectError("");
                }}
                rows={3}
                placeholder="Type the decline note for the patient..."
                className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-gray-200 text-gray-900 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-400/10 bg-white"
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
                className="py-3 rounded-full border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRejection}
                className="py-3 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer"
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
