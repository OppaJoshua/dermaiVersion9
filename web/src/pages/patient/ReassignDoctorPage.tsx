import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Clock,
  Calendar as CalendarIcon,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ShieldCheck,
  ArrowLeft,
  UserCheck,
  Loader2,
  Sparkles,
  User,
  Building2,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { logAuditEvent } from "@/lib/auditLog";
import { createPatientNotification } from "@/lib/notificationService";
import { getDoctorAvatarUrl } from "@/lib/doctorAvatarService";
import { formatTime12h, normalizeDayName, timeToMinutes, minutesToTime } from "@/lib/schedulingService";

interface ClinicInfo {
  clinic_id: string;
  name: string;
  logo_url?: string | null;
  address?: string | null;
  phone?: string | null;
  consultation_fee?: number | string | null;
}

interface DoctorItem {
  doctor_id: string;
  clinic_id: string;
  user_id?: string | null;
  doctor_name: string;
  email?: string | null;
  contact_number?: string | null;
  prc_license?: string | null;
  photo_url?: string | null;
  duty_days?: string[] | string | null;
  duty_start_time?: string | null;
  duty_end_time?: string | null;
  duty_schedule?: any;
  status?: string | null;
}

interface AppointmentDetails {
  appointment_id: string;
  date: string;
  time: string;
  status: string;
  doctor_status?: string | null;
  doctor_note?: string | null;
  clinic_note?: string | null;
  ai_condition_name?: string | null;
  assigned_doctor_id?: string | null;
  created_at: string;
  doctor_reviewed_at?: string | null;
  clinic_id: string;
  user_id?: string | null;
  patient_name?: string | null;
  patient_email?: string | null;
  questionnaire_answers?: Record<string, any> | null;
  clinic?: ClinicInfo | null;
}

export default function ReassignDoctorPage() {
  const { appointmentId } = useParams<{ appointmentId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [appointment, setAppointment] = useState<AppointmentDetails | null>(null);
  const [previousDoctor, setPreviousDoctor] = useState<{ doctor_id: string; doctor_name: string } | null>(null);
  const [availableDoctors, setAvailableDoctors] = useState<DoctorItem[]>([]);

  // Selection states
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");

  // 24-Hour window calculations
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Fetch appointment, clinic, and doctors with resilient fallbacks
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      setLoading(true);
      setErrorMsg(null);

      try {
        let targetId = appointmentId;
        const isValidUuid = (val?: string) =>
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val || "");

        // Auto-resolve patient's latest declined appointment if ID was missing or placeholder
        if (!isValidUuid(targetId) && user?.id) {
          try {
            const { data: latestDeclined } = await supabase
              .from("patient_appointment")
              .select("appointment_id")
              .eq("user_id", user.id)
              .or("doctor_status.eq.rejected,status.eq.rejected")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (latestDeclined?.appointment_id) {
              targetId = latestDeclined.appointment_id;
            }
          } catch {}
        }

        let apptData: any = null;

        // 1. Primary fetch: patient_appointment joined with valid clinic columns
        if (isValidUuid(targetId)) {
          const { data: primaryData, error: primaryError } = await supabase
            .from("patient_appointment")
            .select(`
              appointment_id,
              date,
              time,
              status,
              doctor_status,
              doctor_note,
              clinic_note,
              ai_condition_name,
              assigned_doctor_id,
              created_at,
              doctor_reviewed_at,
              clinic_id,
              user_id,
              patient_name,
              patient_email,
              questionnaire_answers,
              clinic:clinic_id (
                clinic_id,
                name,
                logo_url,
                address,
                phone,
                consultation_fee
              )
            `)
            .eq("appointment_id", targetId)
            .maybeSingle();

          if (!primaryError && primaryData) {
            apptData = primaryData;
          } else {
            // Direct query fallback
            const { data: directData } = await supabase
              .from("patient_appointment")
              .select("*")
              .eq("appointment_id", targetId)
              .maybeSingle();

            if (directData) {
              apptData = directData;
              if (directData.clinic_id) {
                const { data: cData } = await supabase
                  .from("clinic")
                  .select("clinic_id, name, logo_url, address, phone, consultation_fee")
                  .eq("clinic_id", directData.clinic_id)
                  .maybeSingle();
                apptData.clinic = cData;
              }
            }
          }
        }

        // Fallback to local storage cache if still null
        if (!apptData) {
          const rawLocal = localStorage.getItem("dermai_clinic_appointments");
          if (rawLocal) {
            try {
              const parsed = JSON.parse(rawLocal);
              if (Array.isArray(parsed)) {
                const found = parsed.find(
                  (a: any) =>
                    a.id === targetId ||
                    a.appointment_id === targetId ||
                    a.doctorStatus === "rejected" ||
                    a.status === "rejected"
                );
                if (found) {
                  apptData = {
                    appointment_id: found.id || found.appointment_id,
                    date: found.date || new Date().toISOString(),
                    time: found.time || "09:00",
                    status: found.status || "pending",
                    doctor_status: found.doctorStatus || "rejected",
                    doctor_note: found.doctorNote || "",
                    clinic_note: found.clinicNote || "",
                    ai_condition_name: found.aiConditionName || found.conditionName || "Skin Consultation",
                    assigned_doctor_id: found.assignedDoctorId || null,
                    created_at: found.createdAt || new Date().toISOString(),
                    doctor_reviewed_at: found.doctorReviewedAt || found.declinedAt || null,
                    clinic_id: found.clinicId || "",
                    user_id: found.userId || user?.id || null,
                    patient_name: found.patientName || null,
                    patient_email: found.patientEmail || null,
                    questionnaire_answers: found.questionnaireAnswers || null,
                    clinic: {
                      clinic_id: found.clinicId || "",
                      name: found.clinicName || "Skin Clinic",
                      address: found.clinicAddress || null,
                    },
                  };
                }
              }
            } catch {}
          }
        }

        if (!apptData) {
          // If no appointment exists at all, navigate back cleanly without rendering an error screen
          if (isMounted) {
            navigate("/dashboard/appointment-status", { replace: true });
          }
          return;
        }

        const clinicObj = Array.isArray(apptData.clinic) ? apptData.clinic[0] : apptData.clinic;
        if (isMounted) {
          setAppointment({
            ...apptData,
            clinic: clinicObj || null,
          });
        }

        const effectiveClinicId = apptData?.clinic_id || (apptData?.clinic as any)?.clinic_id;
        const previousDocId = apptData?.assigned_doctor_id;

        // 2. Resolve previous doctor's name
        if (previousDocId) {
          try {
            const { data: prevDoc } = await supabase
              .from("clinic_doctor")
              .select("doctor_id, doctor_name")
              .eq("doctor_id", previousDocId)
              .maybeSingle();
            if (prevDoc && isMounted) {
              setPreviousDoctor(prevDoc);
            }
          } catch {}
        }

        // 3. Fetch alternate doctors, excluding the declining doctor
        let doctorRows: DoctorItem[] = [];

        if (effectiveClinicId) {
          try {
            const { data: docData } = await supabase
              .from("clinic_doctor")
              .select("*")
              .eq("clinic_id", effectiveClinicId);

            if (Array.isArray(docData) && docData.length > 0) {
              doctorRows = docData;
            }
          } catch (e) {
            console.warn("[ReassignDoctorPage] clinic_doctor fetch error:", e);
          }
        }

        // Exclude the previous doctor and inactive doctors
        let filtered = doctorRows.filter((d) => {
          const isActive = String(d.status || "active").toLowerCase() !== "inactive";
          const isNotPrevious = String(d.doctor_id) !== String(previousDocId);
          return isActive && isNotPrevious;
        });

        // If the clinic has only 1 doctor (who was the one that declined), include other active dermatologists in the network
        if (filtered.length === 0) {
          try {
            const { data: allActiveDocs } = await supabase
              .from("clinic_doctor")
              .select("*")
              .neq("status", "inactive")
              .neq("doctor_id", previousDocId || "");

            if (Array.isArray(allActiveDocs) && allActiveDocs.length > 0) {
              filtered = allActiveDocs;
            }
          } catch {}
        }

        // Local storage doctor fallback
        if (filtered.length === 0) {
          try {
            const rawDocs = localStorage.getItem("dermai_clinic_doctors");
            if (rawDocs) {
              const parsed = JSON.parse(rawDocs);
              if (Array.isArray(parsed)) {
                filtered = parsed.filter(
                  (d: any) =>
                    String(d.status || "active").toLowerCase() !== "inactive" &&
                    String(d.id || d.doctor_id) !== String(previousDocId)
                );
              }
            }
          } catch {}
        }

        if (isMounted) {
          setAvailableDoctors(filtered);
          if (filtered.length > 0) {
            setSelectedDoctorId(filtered[0].doctor_id);
          }
        }
      } catch (err: any) {
        console.error("[ReassignDoctorPage] Initialization error:", err);
        if (isMounted) {
          navigate("/dashboard/appointment-status", { replace: true });
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, [appointmentId, user?.id, navigate]);

  // Expiration calculation
  const { isExpired, hoursRemaining, minutesRemaining } = useMemo(() => {
    if (!appointment) return { isExpired: false, hoursRemaining: 24, minutesRemaining: 0 };
    const qa = appointment.questionnaire_answers;
    const declinedAtStr =
      appointment.doctor_reviewed_at ||
      qa?.declined_at ||
      qa?.appointment_history?.findLast?.((h: any) => h.action?.includes("decline") || h.action?.includes("reject"))?.timestamp ||
      appointment.created_at;

    const declinedTime = new Date(declinedAtStr).getTime();
    if (isNaN(declinedTime)) return { isExpired: false, hoursRemaining: 24, minutesRemaining: 0 };

    const expiresAt = declinedTime + 24 * 3600 * 1000;
    const remainingMs = expiresAt - now;

    if (remainingMs <= 0) {
      return { isExpired: true, hoursRemaining: 0, minutesRemaining: 0 };
    }

    const hrs = Math.floor(remainingMs / (1000 * 60 * 60));
    const mins = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
    return { isExpired: false, hoursRemaining: hrs, minutesRemaining: mins };
  }, [appointment, now]);

  // Selected doctor object
  const selectedDoctor = useMemo(() => {
    return availableDoctors.find((d) => d.doctor_id === selectedDoctorId) || null;
  }, [availableDoctors, selectedDoctorId]);

  // Generate available calendar dates for the selected doctor
  const availableUpcomingDates = useMemo(() => {
    if (!selectedDoctor) return [];

    let dutyDaysList: string[] = [];
    if (Array.isArray(selectedDoctor.duty_days)) {
      dutyDaysList = selectedDoctor.duty_days.map(normalizeDayName);
    } else if (typeof selectedDoctor.duty_days === "string") {
      dutyDaysList = selectedDoctor.duty_days.split(",").map(normalizeDayName);
    }

    if (dutyDaysList.length === 0 && selectedDoctor.duty_schedule) {
      try {
        const sched = typeof selectedDoctor.duty_schedule === "string"
          ? JSON.parse(selectedDoctor.duty_schedule)
          : selectedDoctor.duty_schedule;
        if (sched && typeof sched === "object") {
          dutyDaysList = Object.keys(sched.weeklyShifts || sched).map(normalizeDayName);
        }
      } catch {}
    }

    if (dutyDaysList.length === 0) {
      dutyDaysList = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    }

    const dates: { dateStr: string; displayLabel: string; dayName: string }[] = [];
    const base = new Date();
    base.setHours(0, 0, 0, 0);

    for (let i = 1; i <= 14; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      const dayName = d.toLocaleDateString("en-US", { weekday: "long" });

      if (dutyDaysList.includes(dayName)) {
        const dateStr = d.toISOString().split("T")[0];
        const displayLabel = d.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        });
        dates.push({ dateStr, displayLabel, dayName });
      }
    }

    return dates;
  }, [selectedDoctor]);

  // Auto-select first available date when doctor changes
  useEffect(() => {
    if (availableUpcomingDates.length > 0 && (!selectedDate || !availableUpcomingDates.some(d => d.dateStr === selectedDate))) {
      setSelectedDate(availableUpcomingDates[0].dateStr);
    }
  }, [availableUpcomingDates, selectedDate]);

  // Generate consultation time slots for the selected doctor
  const availableTimeSlots = useMemo(() => {
    if (!selectedDoctor) return [];
    const start = selectedDoctor.duty_start_time || "08:00";
    const end = selectedDoctor.duty_end_time || "17:00";

    const startMinutes = timeToMinutes(start);
    let endMinutes = timeToMinutes(end);
    if (endMinutes <= startMinutes) endMinutes = startMinutes + 8 * 60;

    const slots: string[] = [];
    for (let m = startMinutes; m < endMinutes; m += 30) {
      slots.push(minutesToTime(m));
    }
    return slots;
  }, [selectedDoctor]);

  // Auto-select first time slot when slots change
  useEffect(() => {
    if (availableTimeSlots.length > 0 && (!selectedTime || !availableTimeSlots.includes(selectedTime))) {
      setSelectedTime(availableTimeSlots[0]);
    }
  }, [availableTimeSlots, selectedTime]);

  // Confirm and submit alternate doctor selection
  const handleConfirmReassign = async () => {
    if (!appointment || !selectedDoctor) return;
    if (isExpired) {
      setErrorMsg("The 24-hour re-selection window has expired. The clinic will automatically assign an available doctor.");
      return;
    }
    if (!selectedDate || !selectedTime) {
      setErrorMsg("Please select an appointment date and consultation time slot.");
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const scheduledDateTimeIso = `${selectedDate}T${selectedTime}:00`;
      const currentQa = appointment.questionnaire_answers;
      const baseQa: Record<string, any> = (currentQa && typeof currentQa === "object" && !Array.isArray(currentQa))
        ? { ...currentQa }
        : {};

      const historyEntry = {
        action: "alternate_doctor_selected",
        actor: "patient",
        timestamp: new Date().toISOString(),
        details: "Patient selected alternate doctor without additional charge.",
        previousDoctorId: appointment.assigned_doctor_id,
        newDoctorId: selectedDoctor.doctor_id,
        newDoctorName: selectedDoctor.doctor_name,
        date: selectedDate,
        time: selectedTime,
      };

      const nextQa = {
        ...baseQa,
        reassigned_at: new Date().toISOString(),
        reassigned_by: "patient",
        previous_doctor_id: appointment.assigned_doctor_id,
        is_paid: true,
        appointment_history: [
          ...(Array.isArray(baseQa.appointment_history) ? baseQa.appointment_history : []),
          historyEntry,
        ],
      };

      const updatePayload: Record<string, any> = {
        assigned_doctor_id: selectedDoctor.doctor_id,
        status: "pending",
        doctor_status: "pending-review",
        schedule_sent_to_doctor: true,
        date: scheduledDateTimeIso,
        time: `${selectedTime}:00`,
        batch_time: selectedTime,
        clinic_note: `Reassigned to Dr. ${selectedDoctor.doctor_name} by patient at no additional charge.`,
        doctor_note: null,
        doctor_reviewed_at: null,
        questionnaire_answers: nextQa,
      };

      // Update Supabase patient_appointment
      let updateError: any = null;
      try {
        const { error } = await supabase
          .from("patient_appointment")
          .update({
            ...updatePayload,
            reassigned_at: new Date().toISOString(),
          })
          .eq("appointment_id", appointment.appointment_id);

        if (error) {
          if (error.code === "PGRST204" || error.message.includes("schema cache") || error.message.includes("reassigned_at")) {
            const retry = await supabase
              .from("patient_appointment")
              .update(updatePayload)
              .eq("appointment_id", appointment.appointment_id);
            updateError = retry.error;
          } else {
            updateError = error;
          }
        }
      } catch (err) {
        updateError = err;
      }

      if (updateError) {
        console.error("[ReassignDoctorPage] Supabase update error:", updateError);
        throw new Error(updateError.message || "Failed to update appointment record.");
      }

      // 1. Notify the newly assigned doctor
      if (selectedDoctor.user_id) {
        try {
          await supabase.from("user_notification").insert({
            user_id: selectedDoctor.user_id,
            type: "appointment-delegated",
            subtype: "new-consultation",
            title: "New consultation request assigned for review",
            body: `New consultation request assigned for your review from patient ${appointment.patient_name || "Patient"}.`,
            is_read: false,
          });
        } catch (notifErr) {
          console.warn("[ReassignDoctorPage] Doctor notification insert warning:", notifErr);
        }
      }

      // 2. Deliver to Clinic Portal: Send notification to clinic owner
      const clinicOwnerUserId = (appointment.clinic as any)?.owner_user_id;
      if (clinicOwnerUserId) {
        try {
          await supabase.from("user_notification").insert({
            user_id: clinicOwnerUserId,
            type: "appointment",
            subtype: "alternate_doctor_selected",
            title: "Alternate Doctor Selected",
            body: `Patient ${appointment.patient_name || "Patient"} has selected Dr. ${selectedDoctor.doctor_name} as their alternate doctor.`,
            is_read: false,
          });
        } catch (clinicNotifErr) {
          console.warn("[ReassignDoctorPage] Clinic notification insert warning:", clinicNotifErr);
        }
      }

      // 3. Notify the patient
      const patientUserId = appointment.user_id || user?.id;
      if (patientUserId) {
        try {
          await createPatientNotification({
            userId: patientUserId,
            type: "appointment-scheduled",
            subtype: "reassigned",
            title: "Alternate Doctor Selected",
            body: `Your consultation at ${appointment.clinic?.name || "the clinic"} has been reassigned to Dr. ${selectedDoctor.doctor_name} for review at no additional charge.`,
          });
        } catch (patientNotifErr) {
          console.warn("[ReassignDoctorPage] Patient notification warning:", patientNotifErr);
        }
      }

      // 4. Log audit event
      try {
        await logAuditEvent({
          userId: user?.id,
          role: "patient",
          category: "appointment",
          action: "Alternate Doctor Selected",
          target: `Appointment #${appointment.appointment_id.slice(0, 8)}`,
          details: `Patient re-assigned appointment to Dr. ${selectedDoctor.doctor_name} without additional charge.`,
          performerName: appointment.patient_name || user?.user_metadata?.full_name || "Patient",
          metadata: {
            appointmentId: appointment.appointment_id,
            clinicId: appointment.clinic_id,
            clinicName: appointment.clinic?.name,
            previousDoctorId: appointment.assigned_doctor_id,
            newDoctorId: selectedDoctor.doctor_id,
            newDoctorName: selectedDoctor.doctor_name,
            newDate: selectedDate,
            newTime: selectedTime,
          },
        });
      } catch (auditErr) {
        console.warn("[ReassignDoctorPage] Audit log warning:", auditErr);
      }

      // 4. Synchronize local storage cache
      try {
        const rawLocal = localStorage.getItem("dermai_clinic_appointments");
        if (rawLocal) {
          const parsed = JSON.parse(rawLocal);
          if (Array.isArray(parsed)) {
            const nextLocal = parsed.map((a: any) =>
              a.id === appointment.appointment_id || a.appointment_id === appointment.appointment_id
                ? {
                    ...a,
                    status: "pending",
                    doctorStatus: "pending-review",
                    assignedDoctorId: selectedDoctor.doctor_id,
                    doctor: `Dr. ${selectedDoctor.doctor_name.replace(/^dr\.\s*/i, "")}`,
                    doctorNote: null,
                    doctorReviewedAt: null,
                    clinicNote: `Reassigned to Dr. ${selectedDoctor.doctor_name} by patient at no additional charge.`,
                    date: selectedDate,
                    time: formatTime12h(selectedTime),
                    batchTime: selectedTime,
                    appointmentHistory: nextQa.appointment_history,
                  }
                : a
            );
            localStorage.setItem("dermai_clinic_appointments", JSON.stringify(nextLocal));
          }
        }
      } catch {}

      // Dispatch cross-tab events
      window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
      window.dispatchEvent(new Event("storage"));

      setSuccess(true);
    } catch (err: any) {
      console.error("[ReassignDoctorPage] Error confirming reassignment:", err);
      setErrorMsg(err?.message || "Failed to confirm alternate doctor. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
        <Loader2 className="w-8 h-8 text-magenta-600 animate-spin mb-3" />
        <h3 className="text-base font-semibold text-gray-800">Loading Doctor Selection</h3>
        <p className="text-xs text-gray-500 mt-1">Retrieving clinic roster and schedule availability...</p>
      </div>
    );
  }

  const clinicName = appointment?.clinic?.name || "Skin Clinic";

  return (
    <div className="container mx-auto p-4 md:p-6 lg:p-8 max-w-4xl font-sans">
      {/* Top Breadcrumb & Header */}
      <div className="mb-6">
        <Link
          to="/dashboard/appointment-status"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-magenta-700 transition-colors mb-3 group"
        >
          <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
          <span>Back to Appointment Status</span>
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Select Alternate Doctor</h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">
              Choose another dermatologist from <strong className="text-gray-800">{clinicName}</strong> for your pre-paid consultation.
            </p>
          </div>

          {/* Prominent Pre-Paid Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold shrink-0 shadow-2xs">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Paid Consultation • Zero Additional Charge</span>
          </div>
        </div>
      </div>

      {/* Success View */}
      {success ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-3xl border border-emerald-200 p-8 text-center shadow-sm space-y-6 max-w-xl mx-auto"
        >
          <div className="w-16 h-16 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center mx-auto text-emerald-600 shadow-xs">
            <CheckCircle2 className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 text-xs font-bold border border-emerald-200">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              <span>Reassignment Confirmed</span>
            </span>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Specialist Selected Successfully!</h2>
            <p className="text-xs sm:text-sm text-gray-600 max-w-md mx-auto leading-relaxed">
              Your consultation at <strong className="text-gray-900">{clinicName}</strong> has been transferred to{" "}
              <strong className="text-magenta-700">Dr. {selectedDoctor?.doctor_name}</strong> for pre-consultation review.
            </p>
          </div>

          {/* Summary Box */}
          <div className="rounded-2xl bg-slate-50 border border-gray-100 p-4 text-left space-y-2.5 text-xs">
            <div className="flex justify-between items-center py-1 border-b border-gray-200/60">
              <span className="text-gray-500">Attending Specialist:</span>
              <strong className="text-gray-900 font-semibold">Dr. {selectedDoctor?.doctor_name}</strong>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-200/60">
              <span className="text-gray-500">Scheduled Date:</span>
              <strong className="text-gray-900 font-semibold">
                {new Date(selectedDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </strong>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-200/60">
              <span className="text-gray-500">Consultation Time:</span>
              <strong className="text-gray-900 font-semibold">{formatTime12h(selectedTime)}</strong>
            </div>
            <div className="flex justify-between items-center py-1">
              <span className="text-gray-500">Billing Status:</span>
              <strong className="text-emerald-700 font-bold">₱0.00 • Retained Pre-Paid Status</strong>
            </div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/dashboard/appointment-status"
              className="px-6 py-2.5 rounded-full bg-magenta-600 hover:bg-magenta-700 text-white font-semibold text-xs transition-colors shadow-xs"
            >
              View Appointment Status
            </Link>
          </div>
        </motion.div>
      ) : (
        <div className="space-y-6">
          {/* Error Banner */}
          {errorMsg && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-start gap-2.5 shadow-2xs">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* 24-Hour Expiration Banner */}
          {isExpired ? (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 sm:p-5 flex items-start gap-3 text-amber-900 shadow-2xs">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-amber-950">24-Hour Window Expired</h4>
                <p className="text-xs text-amber-800 leading-relaxed">
                  The 24-hour re-selection window has expired. The clinic will automatically assign an available doctor.
                </p>
                <div className="pt-2">
                  <Link
                    to="/dashboard/appointment-status"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-900 underline hover:text-amber-950"
                  >
                    <span>Check clinic assignment status →</span>
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-magenta-200 bg-gradient-to-r from-magenta-50/70 via-pink-50/40 to-white p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-magenta-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-bold text-gray-900">24-Hour Doctor Re-Selection Window Active</h4>
                  <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                    Select your preferred alternate dermatologist before the timer ends. If no selection is confirmed, the clinic will automatically assign an available doctor to your booking.
                  </p>
                </div>
              </div>

              <div className="px-3.5 py-1.5 rounded-xl bg-white border border-magenta-200 text-right shrink-0 shadow-2xs">
                <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400 block">Time Remaining</span>
                <span className="text-sm font-extrabold text-magenta-700">
                  {hoursRemaining}h {minutesRemaining}m
                </span>
              </div>
            </div>
          )}

          {/* Consultation Summary Context Card */}
          <div className="bg-white rounded-3xl border border-gray-100 p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                Original Consultation Summary
              </span>
              <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                Upfront Paid (₱500.00)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <p className="text-gray-400 font-medium">Clinic</p>
                <p className="text-sm font-bold text-gray-900 mt-0.5">{clinicName}</p>
                {appointment?.clinic?.address && (
                  <p className="text-[11px] text-gray-500 mt-0.5">{appointment.clinic.address}</p>
                )}
              </div>

              <div>
                <p className="text-gray-400 font-medium">Clinical Concern</p>
                <p className="text-sm font-bold text-gray-900 mt-0.5">
                  {appointment?.ai_condition_name || "General Dermatology Consultation"}
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">Physical Clinic Consultation</p>
              </div>

              <div>
                <p className="text-gray-400 font-medium">Previous Doctor Status</p>
                <p className="text-sm font-bold text-rose-700 mt-0.5">
                  Declined by {previousDoctor?.doctor_name ? `Dr. ${previousDoctor.doctor_name}` : "Assigned Specialist"}
                </p>
                {appointment?.doctor_note && (
                  <p className="text-[11px] text-gray-600 italic mt-0.5">"{appointment.doctor_note}"</p>
                )}
              </div>
            </div>
          </div>

          {/* Section: Select Alternate Doctor */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Available Dermatologists</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Verified specialists with active duty schedules available for your consultation.
                </p>
              </div>
              <span className="text-xs font-bold text-gray-500">
                {availableDoctors.length} {availableDoctors.length === 1 ? "specialist" : "specialists"} available
              </span>
            </div>

            {availableDoctors.length === 0 ? (
              <div className="rounded-2xl border border-gray-200 bg-slate-50 p-6 text-center space-y-2">
                <Building2 className="w-8 h-8 text-gray-400 mx-auto" />
                <h4 className="text-sm font-bold text-gray-800">No Alternate Doctors Available</h4>
                <p className="text-xs text-gray-500 max-w-md mx-auto">
                  There are currently no other doctors with active duty schedules at this clinic. The clinic administrators have been notified to automatically assign an available doctor to your booking.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {availableDoctors.map((doc) => {
                  const isSelected = selectedDoctorId === doc.doctor_id;
                  const photoUrl = getDoctorAvatarUrl(doc.doctor_id, doc);
                  const dutyDaysDisplay = Array.isArray(doc.duty_days)
                    ? doc.duty_days.join(", ")
                    : typeof doc.duty_days === "string"
                    ? doc.duty_days
                    : "Mon – Fri";

                  const dutyHoursDisplay = `${formatTime12h(doc.duty_start_time || "08:00")} – ${formatTime12h(doc.duty_end_time || "17:00")}`;

                  return (
                    <div
                      key={doc.doctor_id}
                      onClick={() => !isExpired && setSelectedDoctorId(doc.doctor_id)}
                      className={`rounded-2xl border p-4 transition-all relative flex flex-col justify-between ${
                        isExpired
                          ? "opacity-60 cursor-not-allowed border-gray-200 bg-gray-50"
                          : isSelected
                          ? "border-magenta-600 bg-magenta-50/40 ring-2 ring-magenta-500/20 shadow-xs cursor-pointer"
                          : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-2xs cursor-pointer"
                      }`}
                    >
                      <div className="flex items-start gap-3.5">
                        {photoUrl ? (
                          <img
                            src={photoUrl}
                            alt={doc.doctor_name}
                            className="w-12 h-12 rounded-full object-cover border border-gray-200 bg-white shrink-0"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-magenta-50 border border-magenta-100 flex items-center justify-center text-magenta-700 font-bold shrink-0">
                            <User className="w-6 h-6" />
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-sm font-bold text-gray-900 truncate">
                              Dr. {doc.doctor_name.replace(/^dr\.\s*/i, "")}
                            </h3>
                            {isSelected && (
                              <span className="w-5 h-5 rounded-full bg-magenta-600 text-white flex items-center justify-center shrink-0">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </span>
                            )}
                          </div>

                          <p className="text-[11px] text-gray-500 font-medium mt-0.5">
                            {doc.prc_license ? `PRC Lic. #${doc.prc_license}` : "Board-Certified Dermatologist"}
                          </p>

                          <div className="mt-2.5 pt-2 border-t border-gray-100 space-y-1 text-[11px] text-gray-600">
                            <div className="flex items-center gap-1.5">
                              <CalendarIcon className="w-3.5 h-3.5 text-magenta-600 shrink-0" />
                              <span className="truncate">Duty Days: {dutyDaysDisplay}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-magenta-600 shrink-0" />
                              <span>Hours: {dutyHoursDisplay}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 pt-2 flex items-center justify-between text-xs">
                        <span className="text-[11px] text-emerald-700 font-bold flex items-center gap-1">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>No extra charge</span>
                        </span>
                        <span
                          className={`text-xs font-semibold ${
                            isSelected ? "text-magenta-700" : "text-gray-400 group-hover:text-gray-600"
                          }`}
                        >
                          {isSelected ? "Selected" : "Click to select"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section: Select Schedule Slot for the chosen doctor */}
          {selectedDoctor && !isExpired && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-3xl border border-gray-100 p-5 sm:p-6 shadow-xs space-y-5"
            >
              <div>
                <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4 text-magenta-600" />
                  <span>Choose Available Consultation Slot</span>
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Select an upcoming date and time slot for Dr. {selectedDoctor.doctor_name}.
                </p>
              </div>

              {/* Date selection pill carousel */}
              <div>
                <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block mb-2">
                  1. Select Consultation Date
                </label>
                {availableUpcomingDates.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No upcoming duty shifts found for this doctor.</p>
                ) : (
                  <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                    {availableUpcomingDates.map((item) => {
                      const isDateSelected = selectedDate === item.dateStr;
                      return (
                        <button
                          key={item.dateStr}
                          type="button"
                          onClick={() => setSelectedDate(item.dateStr)}
                          className={`px-3.5 py-2.5 rounded-2xl border text-left shrink-0 transition-all cursor-pointer ${
                            isDateSelected
                              ? "border-magenta-600 bg-magenta-50/70 text-magenta-900 ring-2 ring-magenta-500/20 font-bold"
                              : "border-gray-200 bg-white hover:border-gray-300 text-gray-700 font-medium"
                          }`}
                        >
                          <span className="text-[10px] text-gray-400 uppercase tracking-wider block font-semibold">
                            {item.dayName}
                          </span>
                          <span className="text-xs sm:text-sm font-bold block">{item.displayLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Time slot selection */}
              <div>
                <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block mb-2">
                  2. Select Consultation Time Slot
                </label>
                {availableTimeSlots.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No slots available on this date.</p>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {availableTimeSlots.map((slot) => {
                      const isSlotSelected = selectedTime === slot;
                      return (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => setSelectedTime(slot)}
                          className={`py-2 px-2.5 rounded-xl border text-center transition-all cursor-pointer text-xs ${
                            isSlotSelected
                              ? "border-magenta-600 bg-magenta-600 text-white font-bold shadow-xs"
                              : "border-gray-200 bg-white hover:border-magenta-300 text-gray-700 font-semibold"
                          }`}
                        >
                          {formatTime12h(slot)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Selected Slot Confirmation Summary */}
              {selectedDate && selectedTime && (
                <div className="p-4 rounded-2xl bg-slate-50 border border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div>
                    <span className="text-gray-500 font-medium block">Selected Schedule:</span>
                    <strong className="text-gray-900 font-bold text-sm">
                      {new Date(selectedDate).toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })}{" "}
                      at {formatTime12h(selectedTime)}
                    </strong>
                  </div>
                  <div className="text-right">
                    <span className="text-gray-400 text-[11px] block">Consultation Fee</span>
                    <strong className="text-emerald-700 font-bold text-sm">₱0.00 (Pre-paid)</strong>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* Action CTA Confirmation Bar */}
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4">
            <Link
              to="/dashboard/appointment-status"
              className="text-xs font-semibold text-gray-500 hover:text-gray-700 transition-colors"
            >
              Cancel and Return
            </Link>

            <button
              type="button"
              disabled={isExpired || submitting || !selectedDoctor || !selectedDate || !selectedTime}
              onClick={handleConfirmReassign}
              className={`w-full sm:w-auto px-8 py-3 rounded-full font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all shadow-sm ${
                isExpired || submitting || !selectedDoctor || !selectedDate || !selectedTime
                  ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                  : "bg-magenta-600 hover:bg-magenta-700 text-white cursor-pointer active:scale-98"
              }`}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Confirming Reassignment...</span>
                </>
              ) : (
                <>
                  <UserCheck className="w-4 h-4" />
                  <span>
                    Confirm &amp; Assign to Dr. {selectedDoctor?.doctor_name ? selectedDoctor.doctor_name.replace(/^dr\.\s*/i, "") : "Doctor"}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
