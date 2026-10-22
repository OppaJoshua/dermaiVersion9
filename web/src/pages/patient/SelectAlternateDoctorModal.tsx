import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Check, Clock, CalendarDays, MapPin, Stethoscope, Info, Building2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { logAuditEvent } from "@/utils/auditLogger";
import { DoctorAvatar } from "@/components/common/DoctorAvatar";
import { formatTime12h, normalizeDayName, timeToMinutes, minutesToTime } from "@/lib/schedulingService";

export interface ModalAppointmentDetails {
  id: string;
  clinicId?: string | number;
  clinicName: string;
  doctor?: string;
  assignedDoctorName?: string;
  assignedDoctorId?: string;
  previousDoctorId?: string;
  previousDoctorName?: string;
  doctorStatus?: "pending-review" | "approved" | "rejected" | string;
  status?: string;
  doctorNote?: string;
  doctorDiagnosis?: string;
  aiConditionName?: string;
  date?: string;
  time?: string;
  paymentAmount?: number;
  paymentReference?: string;
  paymentStatus?: string;
  doctorReviewedAt?: string;
  createdAt?: string;
  patientName?: string;
  patientEmail?: string;
  userId?: string;
  questionnaireAnswers?: any;
  appointmentHistory?: any[];
}

export interface SelectAlternateDoctorModalProps {
  isOpen: boolean;
  onClose: () => void;
  appointment: ModalAppointmentDetails | null;
  clinicId?: string | number;
  appointmentId?: string;
  onSuccess?: (newDoctorName: string) => void;
}

interface DoctorRow {
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
  specialization?: string | null;
  user?: { avatar_url?: string | null } | null;
  avatar_url?: string | null;
}

interface ClinicRow {
  clinic_id: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  owner_user_id?: string | null;
  logo_url?: string | null;
  consultation_fee?: number | string | null;
}

// Helper: Extract normalized duty days for a doctor
function getDoctorDutyDays(doc: DoctorRow): string[] {
  if (Array.isArray(doc.duty_days) && doc.duty_days.length > 0) {
    return doc.duty_days.map(normalizeDayName).filter(Boolean);
  }
  if (typeof doc.duty_days === "string" && doc.duty_days.trim()) {
    return doc.duty_days.split(",").map((s) => normalizeDayName(s.trim())).filter(Boolean);
  }
  if (doc.duty_schedule) {
    try {
      const sched = typeof doc.duty_schedule === "string" ? JSON.parse(doc.duty_schedule) : doc.duty_schedule;
      if (sched && typeof sched === "object") {
        const shifts = sched.weeklyShifts || sched;
        return Object.keys(shifts).map(normalizeDayName).filter(Boolean);
      }
    } catch {}
  }
  return [];
}

// Helper: Validate doctor has working duty hours
function isDoctorDutyValid(doc: DoctorRow): boolean {
  const dutyDays = getDoctorDutyDays(doc);
  if (dutyDays.length === 0) return false;

  if (doc.duty_start_time && doc.duty_end_time) {
    const startMin = timeToMinutes(doc.duty_start_time);
    let endMin = timeToMinutes(doc.duty_end_time);
    if (endMin <= startMin) endMin = startMin + 8 * 60;
    return endMin > startMin;
  }
  return true;
}

// Helper: Verify if doctor's active duty days and hours cover the consultation date and time slot
function doctorCoversAppointmentSlot(doc: DoctorRow, apptDate?: string, apptTime?: string): boolean {
  if (!isDoctorDutyValid(doc)) return false;

  const dutyDays = getDoctorDutyDays(doc);
  if (dutyDays.length === 0) return false;

  if (!apptDate || apptDate === "Date pending") return true;

  const parsed = new Date(apptDate);
  if (isNaN(parsed.getTime())) return true;

  const weekday = parsed.toLocaleDateString("en-US", { weekday: "long" });
  const coversDay = dutyDays.includes(weekday);
  if (!coversDay) return false;

  if (apptTime && apptTime !== "Time pending" && doc.duty_start_time && doc.duty_end_time) {
    const startMin = timeToMinutes(doc.duty_start_time);
    let endMin = timeToMinutes(doc.duty_end_time);
    if (endMin <= startMin) endMin = startMin + 8 * 60;

    const timeClean = apptTime.replace(/:\d{2}$/, "");
    const apptMin = timeToMinutes(timeClean);
    if (apptMin < startMin || apptMin >= endMin) {
      return false;
    }
  }

  return true;
}

export function SelectAlternateDoctorModal({
  isOpen,
  onClose,
  appointment,
  clinicId: propClinicId,
  appointmentId: propAppointmentId,
  onSuccess,
}: SelectAlternateDoctorModalProps) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Dynamic authentic data fetched from Supabase
  const [clinicData, setClinicData] = useState<ClinicRow | null>(null);
  const [clinicOperatingHours, setClinicOperatingHours] = useState<{ day_of_week: string; open_time: string; close_time: string }[]>([]);
  const [paymentAmount, setPaymentAmount] = useState<number | null>(null);
  const [aiCondition, setAiCondition] = useState<string>("");
  const [previousDoctor, setPreviousDoctor] = useState<{ id: string; name: string; note: string } | null>(null);
  const [availableDoctors, setAvailableDoctors] = useState<DoctorRow[]>([]);

  // Selection states
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");

  // Live timer tick every 10 seconds for countdown
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // Lock body scroll while open
  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  // Load authentic clinic and doctor roster from Supabase strictly for the current appointment's clinic
  useEffect(() => {
    if (!isOpen || (!appointment && !propAppointmentId)) return;

    let isMounted = true;
    async function loadAuthenticData() {
      setLoading(true);
      setErrorMsg(null);

      try {
        const apptId = propAppointmentId || appointment?.id;
        let targetClinicId = propClinicId ? String(propClinicId) : (appointment?.clinicId ? String(appointment.clinicId) : null);
        let prevDocId = appointment?.previousDoctorId || appointment?.assignedDoctorId;
        let authenticDoctorNote = appointment?.doctorNote || "";
        let apptDate = appointment?.date;
        let apptTime = appointment?.time;

        // 1. Fetch fresh appointment record directly from Supabase to ensure authentic clinic_id, decline note & timestamp
        if (apptId) {
          const { data: freshAppt } = await supabase
            .from("patient_appointment")
            .select(`
              appointment_id,
              clinic_id,
              assigned_doctor_id,
              doctor_status,
              doctor_note,
              doctor_reviewed_at,
              created_at,
              date,
              time,
              payment_amount,
              ai_condition_name,
              questionnaire_answers
            `)
            .eq("appointment_id", apptId)
            .maybeSingle();

          if (freshAppt) {
            if (freshAppt.clinic_id) {
              targetClinicId = String(freshAppt.clinic_id);
            }
            if (freshAppt.assigned_doctor_id) {
              prevDocId = freshAppt.assigned_doctor_id;
            }
            if (freshAppt.doctor_note) {
              authenticDoctorNote = freshAppt.doctor_note;
            }
            if (freshAppt.date) {
              apptDate = freshAppt.date;
            }
            if (freshAppt.time) {
              apptTime = freshAppt.time;
            }
            if (freshAppt.payment_amount !== null && freshAppt.payment_amount !== undefined) {
              setPaymentAmount(Number(freshAppt.payment_amount));
            }
            if (freshAppt.ai_condition_name) {
              setAiCondition(freshAppt.ai_condition_name);
            }
          }
        }

        // 2. Fetch authentic Clinic Info and Operating Hours strictly for targetClinicId
        if (targetClinicId) {
          const [{ data: cRow }, { data: opHours }] = await Promise.all([
            supabase
              .from("clinic")
              .select("clinic_id, name, address, phone, owner_user_id, logo_url, consultation_fee")
              .eq("clinic_id", targetClinicId)
              .maybeSingle(),
            supabase
              .from("clinic_operating_hours")
              .select("day_of_week, open_time, close_time")
              .eq("clinic_id", targetClinicId),
          ]);

          if (cRow && isMounted) {
            setClinicData(cRow);
          }
          if (Array.isArray(opHours) && isMounted) {
            setClinicOperatingHours(opHours);
          }
        }

        // 3. Resolve Previous Doctor Name and Note dynamically from Supabase
        let resolvedPrevDocName = appointment?.previousDoctorName || appointment?.assignedDoctorName || appointment?.doctor || "";
        if (prevDocId) {
          try {
            const { data: prevDocRow } = await supabase
              .from("clinic_doctor")
              .select("doctor_id, doctor_name")
              .eq("doctor_id", prevDocId)
              .maybeSingle();

            if (prevDocRow?.doctor_name) {
              resolvedPrevDocName = prevDocRow.doctor_name;
            }
          } catch {}
        }

        if (isMounted) {
          setPreviousDoctor({
            id: prevDocId || "",
            name: resolvedPrevDocName || "",
            note: authenticDoctorNote || "",
          });
        }

        // 4. Query live clinic_doctor belonging strictly to this clinic_id
        // Filter: WHERE clinic_id = target_clinic_id AND doctor_id != declined_doctor_id AND is_active = true
        let doctorList: DoctorRow[] = [];
        if (targetClinicId) {
          // Attempt RPC function first if available, else standard query
          try {
            const { data: rpcDocs, error: rpcErr } = await supabase.rpc("get_available_alternate_doctors", {
              target_clinic_id: targetClinicId,
              declined_doctor_id: prevDocId || null,
            });
            if (!rpcErr && Array.isArray(rpcDocs) && rpcDocs.length > 0) {
              doctorList = rpcDocs;
            }
          } catch {}

          if (doctorList.length === 0) {
            let query = supabase
              .from("clinic_doctor")
              .select("*, user:user_id(avatar_url)")
              .eq("clinic_id", targetClinicId);

            if (prevDocId) {
              query = query.neq("doctor_id", prevDocId);
            }

            const { data: docRows } = await query;
            if (Array.isArray(docRows) && docRows.length > 0) {
              doctorList = docRows;
            }
          }
        }

        // 5. Active & Availability Constraints:
        // - Clinic Filtering: strictly clinic_id = targetClinicId (DO NOT show doctors from other clinics!)
        // - Exclude originally assigned doctor who declined (doctor_id != prevDocId)
        // - Doctor is active & verified: status = 'active' and is_active !== false
        // - Verify that the doctor's active duty days and hours cover consultation availability
        let filtered = doctorList.filter((d) => {
          // Strict clinic check
          if (String(d.clinic_id) !== String(targetClinicId)) return false;

          // Exclude declined doctor
          if (prevDocId && String(d.doctor_id) === String(prevDocId)) return false;

          // Must be active & verified
          const isActive = String(d.status || "active").toLowerCase() === "active" && (d as any).is_active !== false;
          if (!isActive) return false;

          // Active duty days and hours validation
          const dutyDays = getDoctorDutyDays(d);
          const hasDutyDays = dutyDays.length > 0;
          const hasValidHours = isDoctorDutyValid(d);
          return hasDutyDays && hasValidHours;
        });

        // If the appointment already has a scheduled/requested consultation date and time slot,
        // verify which doctors cover that date and time slot.
        if (apptDate && apptTime && apptDate !== "Date pending" && apptTime !== "Time pending") {
          const matchingSlotDocs = filtered.filter((d) =>
            doctorCoversAppointmentSlot(d, apptDate, apptTime)
          );
          if (matchingSlotDocs.length > 0) {
            filtered = matchingSlotDocs;
          }
        }

        if (isMounted) {
          setAvailableDoctors(filtered);
          if (filtered.length > 0) {
            setSelectedDoctorId(filtered[0].doctor_id);
          } else {
            setSelectedDoctorId(null);
          }
        }
      } catch (err: any) {
        console.error("[SelectAlternateDoctorModal] Data load error:", err);
        if (isMounted) setErrorMsg("Unable to load alternate doctors. Please try again.");
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadAuthenticData();
    return () => {
      isMounted = false;
    };
  }, [isOpen, appointment, propClinicId, propAppointmentId]);

  // Dynamic 24-Hour Countdown calculation from declined_at
  const { isExpired, hoursRemaining, minutesRemaining } = useMemo(() => {
    if (!appointment) return { isExpired: false, hoursRemaining: 24, minutesRemaining: 0 };

    const qa = appointment.questionnaireAnswers;
    const declinedAtStr =
      appointment.doctorReviewedAt ||
      qa?.declined_at ||
      qa?.appointment_history?.findLast?.((h: any) =>
        String(h.action || "").includes("decline") || String(h.action || "").includes("reject")
      )?.timestamp ||
      appointment.createdAt ||
      new Date().toISOString();

    const declinedTime = new Date(declinedAtStr).getTime();
    const validDeclinedTime = isNaN(declinedTime) ? Date.now() : declinedTime;
    const expiresAt = validDeclinedTime + 24 * 3600 * 1000;
    const remainingMs = expiresAt - now;

    if (remainingMs <= 0) {
      return { isExpired: true, hoursRemaining: 0, minutesRemaining: 0 };
    }

    const hrs = Math.floor(remainingMs / (1000 * 60 * 60));
    const mins = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
    return { isExpired: false, hoursRemaining: hrs, minutesRemaining: mins };
  }, [appointment, now]);

  // Selected doctor details
  const selectedDoctor = useMemo(() => {
    return availableDoctors.find((d) => d.doctor_id === selectedDoctorId) || null;
  }, [availableDoctors, selectedDoctorId]);

  // Calculate duty days display string for a doctor
  const formatDutyDays = (doc: DoctorRow): string => {
    const days = getDoctorDutyDays(doc);
    if (days.length > 0) {
      return days.map((d) => d.slice(0, 3)).join(", ");
    }
    return "Schedule upon request";
  };

  // Calculate duty hours display string for a doctor
  const formatDutyHours = (doc: DoctorRow): string => {
    if (doc.duty_start_time && doc.duty_end_time) {
      return `${formatTime12h(doc.duty_start_time)} - ${formatTime12h(doc.duty_end_time)}`;
    }
    if (doc.duty_start_time) {
      return `From ${formatTime12h(doc.duty_start_time)}`;
    }
    return "Clinic Operating Hours";
  };

  // Available consultation dates for the selected doctor (next 14 days)
  const availableUpcomingDates = useMemo(() => {
    if (!selectedDoctor) return [];

    const dutyDaysList = getDoctorDutyDays(selectedDoctor);

    const dates: { dateStr: string; displayDay: string; displayDate: string; weekday: string }[] = [];
    const base = new Date();
    base.setHours(0, 0, 0, 0);

    for (let i = 1; i <= 14; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      const dayName = d.toLocaleDateString("en-US", { weekday: "long" });

      if (dutyDaysList.includes(dayName)) {
        const dateStr = d.toISOString().split("T")[0];
        const displayDay = d.toLocaleDateString("en-US", { weekday: "short" });
        const displayDate = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        dates.push({ dateStr, displayDay, displayDate, weekday: dayName });
      }
    }

    return dates;
  }, [selectedDoctor]);

  // Auto-select first available date
  useEffect(() => {
    if (availableUpcomingDates.length > 0 && (!selectedDate || !availableUpcomingDates.some((d) => d.dateStr === selectedDate))) {
      setSelectedDate(availableUpcomingDates[0].dateStr);
    }
  }, [availableUpcomingDates, selectedDate]);

  // Consultation time slots for the selected doctor
  const availableTimeSlots = useMemo(() => {
    if (!selectedDoctor) return [];
    let start = selectedDoctor.duty_start_time;
    let end = selectedDoctor.duty_end_time;

    if (!start || !end) {
      const selectedDayName = selectedDate ? new Date(selectedDate).toLocaleDateString("en-US", { weekday: "long" }) : "";
      const matchOp = clinicOperatingHours.find(
        (o) => normalizeDayName(o.day_of_week) === normalizeDayName(selectedDayName)
      );
      if (matchOp) {
        start = matchOp.open_time.slice(0, 5);
        end = matchOp.close_time.slice(0, 5);
      } else {
        start = start || "09:00";
        end = end || "17:00";
      }
    }

    const startMinutes = timeToMinutes(start);
    let endMinutes = timeToMinutes(end);
    if (endMinutes <= startMinutes) endMinutes = startMinutes + 8 * 60;

    const slots: string[] = [];
    for (let m = startMinutes; m < endMinutes; m += 30) {
      slots.push(minutesToTime(m));
    }
    return slots;
  }, [selectedDoctor, selectedDate, clinicOperatingHours]);

  // Auto-select first time slot
  useEffect(() => {
    if (availableTimeSlots.length > 0 && (!selectedTime || !availableTimeSlots.includes(selectedTime))) {
      setSelectedTime(availableTimeSlots[0]);
    }
  }, [availableTimeSlots, selectedTime]);

  // Submission handler
  const handleConfirmAssign = async () => {
    if (!appointment || !selectedDoctor) return;
    if (isExpired) {
      setErrorMsg("The 24-hour doctor re-selection window has expired. The clinic will automatically assign an available doctor.");
      return;
    }
    if (!selectedDate || !selectedTime) {
      setErrorMsg("Please select an available consultation date and time slot.");
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const scheduledDateTimeIso = `${selectedDate}T${selectedTime}:00`;
      const currentQa = appointment.questionnaireAnswers;
      const baseQa: Record<string, any> =
        currentQa && typeof currentQa === "object" && !Array.isArray(currentQa)
          ? { ...currentQa }
          : {};

      const historyEntry = {
        action: "alternate_doctor_selected",
        actor: "patient",
        timestamp: new Date().toISOString(),
        details: "Patient selected alternate doctor without additional charge.",
        previousDoctorId: previousDoctor?.id || appointment.assignedDoctorId,
        newDoctorId: selectedDoctor.doctor_id,
        newDoctorName: selectedDoctor.doctor_name,
        date: selectedDate,
        time: selectedTime,
      };

      const nextQa = {
        ...baseQa,
        reassigned_at: new Date().toISOString(),
        reassigned_by: "patient",
        previous_doctor_id: previousDoctor?.id || appointment.assignedDoctorId,
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

      // 1. Update public.patient_appointment
      const { error: updateError } = await supabase
        .from("patient_appointment")
        .update(updatePayload)
        .eq("appointment_id", appointment.id);

      if (updateError) {
        throw new Error(updateError.message || "Failed to update appointment record.");
      }

      // 2. Deliver to Doctor Portal: Send notification to public.user_notification for the newly selected doctor
      let doctorUserId = selectedDoctor.user_id;
      if (!doctorUserId && selectedDoctor.email) {
        try {
          const { data: userRow } = await supabase
            .from("user")
            .select("user_id")
            .ilike("email", selectedDoctor.email)
            .maybeSingle();
          if (userRow?.user_id) doctorUserId = userRow.user_id;
        } catch {}
      }

      if (doctorUserId) {
        try {
          await supabase.from("user_notification").insert({
            user_id: doctorUserId,
            type: "appointment-delegated",
            subtype: "new-consultation",
            title: "New consultation request assigned for your review",
            body: `New consultation request assigned for your review from patient ${appointment.patientName || "Patient"}.`,
            is_read: false,
          });
        } catch (notifErr) {
          console.warn("[SelectAlternateDoctorModal] Doctor notification insert warning:", notifErr);
        }
      }

      // 3. Deliver to Clinic Portal: Send notification to clinic owner
      const clinicOwnerUserId = clinicData?.owner_user_id;
      if (clinicOwnerUserId) {
        try {
          await supabase.from("user_notification").insert({
            user_id: clinicOwnerUserId,
            type: "appointment",
            subtype: "alternate_doctor_selected",
            title: "Alternate Doctor Selected",
            body: `Patient ${appointment.patientName || "Patient"} has selected Dr. ${selectedDoctor.doctor_name.replace(/^dr\.\s*/i, "")} as their alternate doctor.`,
            is_read: false,
          });
        } catch (clinicNotifErr) {
          console.warn("[SelectAlternateDoctorModal] Clinic notification insert warning:", clinicNotifErr);
        }
      }

      // 4. Record Audit Log via logAuditEvent
      try {
        await logAuditEvent({
          userId: appointment.userId,
          role: "patient",
          category: "appointment",
          action: "Alternate Doctor Selected",
          target: `Appointment #${appointment.id.slice(0, 8)}`,
          details: `Patient re-assigned appointment to Dr. ${selectedDoctor.doctor_name} without additional charge.`,
          performerName: appointment.patientName || "Patient",
          metadata: {
            appointmentId: appointment.id,
            clinicId: appointment.clinicId,
            clinicName: appointment.clinicName,
            previousDoctorId: previousDoctor?.id,
            newDoctorId: selectedDoctor.doctor_id,
            newDoctorName: selectedDoctor.doctor_name,
            newDate: selectedDate,
            newTime: selectedTime,
          },
        });
      } catch (auditErr) {
        console.warn("[SelectAlternateDoctorModal] Audit log warning:", auditErr);
      }

      // 5. Synchronize localStorage cache for instant cross-portal reactivity
      try {
        const rawLocal = localStorage.getItem("dermai_clinic_appointments");
        if (rawLocal) {
          const parsed = JSON.parse(rawLocal);
          if (Array.isArray(parsed)) {
            const nextLocal = parsed.map((a: any) =>
              a.id === appointment.id || a.appointment_id === appointment.id
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

      // Dispatch cross-portal update events
      window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
      window.dispatchEvent(new CustomEvent("dermai_notifications_updated"));
      window.dispatchEvent(new Event("storage"));

      if (onSuccess) {
        onSuccess(selectedDoctor.doctor_name);
      }
      onClose();
    } catch (err: any) {
      console.error("[SelectAlternateDoctorModal] Confirmation error:", err);
      setErrorMsg(err?.message || "Failed to confirm alternate doctor. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleHandOverToClinic = async () => {
    if (!appointment) return;
    setSubmitting(true);
    setErrorMsg(null);

    try {
      const currentQa = appointment.questionnaireAnswers;
      const baseQa: Record<string, any> =
        currentQa && typeof currentQa === "object" && !Array.isArray(currentQa)
          ? { ...currentQa }
          : {};

      const historyEntry = {
        action: "patient_requested_clinic_reassign",
        actor: "patient",
        timestamp: new Date().toISOString(),
        details: "Patient requested clinic to manually assign an available doctor, waiving the remaining 24-hour self-selection window.",
        previousDoctorId: previousDoctor?.id || appointment.assignedDoctorId,
      };

      const nextQa = {
        ...baseQa,
        patient_requested_clinic_reassign: true,
        patient_privilege_waived: true,
        privilege_waived_at: new Date().toISOString(),
        appointment_history: [
          ...(Array.isArray(baseQa.appointment_history) ? baseQa.appointment_history : []),
          historyEntry,
        ],
      };

      const updatePayload: Record<string, any> = {
        status: "pending",
        doctor_status: "pending-review",
        clinic_note: "Patient requested clinic to assign an available specialist (waived 24-hour self-selection window).",
        questionnaire_answers: nextQa,
      };

      // 1. Update public.patient_appointment
      const { error: updateError } = await supabase
        .from("patient_appointment")
        .update(updatePayload)
        .eq("appointment_id", appointment.id);

      if (updateError) {
        throw new Error(updateError.message || "Failed to submit request to clinic.");
      }

      // 2. Notify clinic owner
      const clinicOwnerUserId = clinicData?.owner_user_id;
      if (clinicOwnerUserId) {
        try {
          await supabase.from("user_notification").insert({
            user_id: clinicOwnerUserId,
            type: "appointment",
            subtype: "clinic_assignment_requested",
            title: "Doctor Assignment Requested by Patient",
            body: `Patient ${appointment.patientName || "Patient"} requested the clinic to assign an alternate doctor for appointment #${appointment.id.slice(0, 8)}.`,
            is_read: false,
          });
        } catch (clinicNotifErr) {
          console.warn("[SelectAlternateDoctorModal] Clinic notification insert warning:", clinicNotifErr);
        }
      }

      // 3. Log Audit
      try {
        await logAuditEvent({
          userId: appointment.userId,
          role: "patient",
          category: "appointment",
          action: "Patient Handed Over Assignment to Clinic",
          target: `Appointment #${appointment.id.slice(0, 8)}`,
          details: "Patient requested clinic to assign a doctor and waived the remaining 24-hour privilege window.",
          performerName: appointment.patientName || "Patient",
          metadata: {
            appointmentId: appointment.id,
            clinicId: appointment.clinicId,
            clinicName: appointment.clinicName,
          },
        });
      } catch (auditErr) {
        console.warn("[SelectAlternateDoctorModal] Audit log warning:", auditErr);
      }

      // 4. Update localStorage
      try {
        const rawLocal = localStorage.getItem("dermai_clinic_appointments");
        if (rawLocal) {
          const parsed = JSON.parse(rawLocal);
          if (Array.isArray(parsed)) {
            const nextLocal = parsed.map((a: any) =>
              a.id === appointment.id || a.appointment_id === appointment.id
                ? {
                    ...a,
                    status: "pending",
                    doctorStatus: "pending-review",
                    clinicNote: updatePayload.clinic_note,
                    questionnaireAnswers: nextQa,
                    appointmentHistory: nextQa.appointment_history,
                  }
                : a
            );
            localStorage.setItem("dermai_clinic_appointments", JSON.stringify(nextLocal));
          }
        }
      } catch {}

      window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
      window.dispatchEvent(new CustomEvent("dermai_notifications_updated"));
      window.dispatchEvent(new Event("storage"));

      if (onSuccess) {
        onSuccess("Clinic Assignment Requested");
      }
      onClose();
    } catch (err: any) {
      console.error("[SelectAlternateDoctorModal] Handover error:", err);
      setErrorMsg(err?.message || "Failed to submit request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || !appointment) return null;

  const paidAmountFormatted = (() => {
    const rawAmt = paymentAmount ?? appointment.paymentAmount ?? clinicData?.consultation_fee;
    if (rawAmt !== undefined && rawAmt !== null && !isNaN(Number(rawAmt)) && Number(rawAmt) > 0) {
      return `₱${Number(rawAmt).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return "Paid upfront";
  })();

  const previousDoctorDisplayName = previousDoctor?.name
    ? previousDoctor.name.toLowerCase().startsWith("dr.")
      ? previousDoctor.name
      : `Dr. ${previousDoctor.name}`
    : appointment.doctor
    ? appointment.doctor.toLowerCase().startsWith("dr.")
      ? appointment.doctor
      : `Dr. ${appointment.doctor}`
    : "Your assigned doctor";

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-6 bg-gray-950/50 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="relative z-[10000] bg-white rounded-t-2xl sm:rounded-2xl max-w-2xl w-full shadow-xl border border-gray-200 overflow-hidden sm:my-auto max-h-[94vh] sm:max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-5 bg-white border-b border-gray-200 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-widest text-magenta-700 uppercase">Doctor re-selection</p>
            <h2 className="mt-1 text-xl font-display font-semibold tracking-tight text-gray-900">
              Select alternate doctor
            </h2>
            <p className="text-sm text-gray-600 mt-1 leading-relaxed">
              Choose an available dermatologist from this clinic for your pre-paid consultation review.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Countdown */}
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5">
              <Clock className="w-4 h-4 text-red-600 shrink-0" />
              {isExpired ? (
                <p className="text-sm font-medium text-red-700">Window expired</p>
              ) : (
                <div className="leading-tight">
                  <p className="text-[10px] uppercase tracking-wide text-red-600 font-medium">Time left</p>
                  <p className="text-sm font-semibold text-red-900 tabular-nums">
                    {hoursRemaining}h {minutesRemaining}m
                  </p>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition cursor-pointer disabled:opacity-50"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body (Scrollable) */}
        <div className="px-6 py-6 space-y-8 overflow-y-auto grow bg-white">
          {errorMsg && (
            <p role="alert" className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm font-medium text-red-800">
              {errorMsg}
            </p>
          )}

          {/* Original booking */}
          <section className="rounded-xl border border-gray-200 bg-gray-50/50">
            <div className="flex items-center justify-between flex-wrap gap-2 px-5 py-3 border-b border-gray-200">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Your booking</h3>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium bg-white border border-gray-200 text-gray-800">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {paidAmountFormatted.startsWith("₱") ? `Paid upfront · ${paidAmountFormatted}` : paidAmountFormatted}
              </span>
            </div>

            <div className="px-5 py-4 space-y-4">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
                <div className="flex items-start gap-2.5">
                  <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <dt className="text-xs text-gray-500">Clinic &amp; location</dt>
                    <dd className="font-medium text-gray-900 mt-0.5">{appointment.clinicName}</dd>
                    {clinicData?.address && (
                      <dd className="text-gray-600 mt-0.5 text-xs leading-relaxed">{clinicData.address}</dd>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <Stethoscope className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <dt className="text-xs text-gray-500">Clinical concern / condition</dt>
                    <dd className="font-medium text-gray-900 mt-0.5">
                      {aiCondition || appointment.aiConditionName || appointment.doctorDiagnosis || "General Skin Consultation"}
                    </dd>
                  </div>
                </div>
              </dl>

              {/* Previous Doctor Status Box with Authentic Decline Note */}
              <div className="flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm">
                <Info className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium text-red-900">
                    {previousDoctorDisplayName} couldn't take this booking
                  </p>
                  <p className="text-red-700 leading-relaxed mt-0.5">
                    {previousDoctor?.note ? `"${previousDoctor.note}"` : "Doctor was unable to accommodate this consultation schedule."}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Step 1: Available Dermatologists */}
          <section>
            <div className="flex items-center justify-between gap-4 mb-3">
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-gray-900 text-white text-xs font-semibold flex items-center justify-center shrink-0">1</span>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Choose a doctor</h3>
                  <p className="text-xs text-gray-500">
                    Select a certified specialist from this clinic to handle your consultation.
                  </p>
                </div>
              </div>
              <span className="text-xs font-medium text-gray-700 bg-gray-100 px-2.5 py-1 rounded-md shrink-0">
                {availableDoctors.length} available
              </span>
            </div>

            {loading ? (
              <div className="p-10 text-center border border-gray-200 rounded-xl">
                <Loader2 className="w-5 h-5 text-magenta-600 animate-spin mx-auto mb-2" />
                <p className="text-sm text-gray-600">Loading clinic specialists...</p>
              </div>
            ) : availableDoctors.length === 0 ? (
              <div className="p-6 text-center border border-dashed border-gray-300 rounded-xl bg-gray-50/50 space-y-4">
                <div>
                  <p className="text-sm font-semibold text-gray-900">No alternate doctors currently available</p>
                  <p className="text-xs text-gray-600 mt-1 max-w-md mx-auto leading-relaxed">
                    This clinic currently has no other available specialists for this schedule. You can transfer the assignment privilege to the clinic now so their staff can arrange a doctor or contact you without waiting for the 24-hour timer to expire.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleHandOverToClinic}
                  disabled={submitting}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-magenta-600 hover:bg-magenta-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Requesting clinic...</span>
                    </>
                  ) : (
                    <>
                      <Building2 className="w-4 h-4" />
                      <span>Let Clinic Reassign / Contact Me</span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {availableDoctors.map((doc) => {
                  const isSelected = selectedDoctorId === doc.doctor_id;
                  const dutyDaysStr = formatDutyDays(doc);
                  const dutyHoursStr = formatDutyHours(doc);

                  return (
                    <button
                      key={doc.doctor_id}
                      type="button"
                      onClick={() => setSelectedDoctorId(doc.doctor_id)}
                      className={`relative text-left p-4 rounded-xl border transition-colors cursor-pointer flex flex-col justify-between focus:outline-none focus-visible:ring-2 focus-visible:ring-magenta-500 focus-visible:ring-offset-2 ${
                        isSelected
                          ? "border-magenta-600 bg-magenta-50/40 ring-1 ring-magenta-600"
                          : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-3">
                          <DoctorAvatar
                            doctorId={doc.doctor_id}
                            userId={doc.user_id || undefined}
                            doctor={doc}
                            name={doc.doctor_name}
                            className="w-11 h-11 rounded-full border border-gray-200 shrink-0 text-sm font-semibold"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-gray-900 truncate">
                              Dr. {doc.doctor_name.replace(/^dr\.\s*/i, "")}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {doc.prc_license ? `PRC #${doc.prc_license}` : "PRC licensed specialist"}
                            </p>
                          </div>
                          <span
                            className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                              isSelected
                                ? "bg-magenta-600 border-magenta-600 text-white"
                                : "border-gray-300 bg-white text-transparent"
                            }`}
                            aria-hidden="true"
                          >
                            <Check className="w-3 h-3" strokeWidth={3} />
                          </span>
                        </div>

                        <dl className="mt-4 pt-3 border-t border-gray-100 text-xs space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <dt className="text-gray-500">Duty days</dt>
                            <dd className="font-medium text-gray-900 text-right">{dutyDaysStr}</dd>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <dt className="text-gray-500">Duty hours</dt>
                            <dd className="font-medium text-gray-900 text-right">{dutyHoursStr}</dd>
                          </div>
                        </dl>
                      </div>

                      <p className="mt-3 text-xs font-medium text-emerald-700">No extra charge</p>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Step 2: Slot Picker (Dates & Time Slots) */}
          {selectedDoctor && (
            <section>
              <div className="flex items-center gap-3 mb-3">
                <span className="w-6 h-6 rounded-full bg-gray-900 text-white text-xs font-semibold flex items-center justify-center shrink-0">2</span>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    Pick a schedule with Dr. {selectedDoctor.doctor_name.replace(/^dr\.\s*/i, "")}
                  </h3>
                  <p className="text-xs text-gray-500">
                    Available days and hours follow this doctor's weekly duty schedule.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 p-5 space-y-5">
                {/* Date selection */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2.5">
                    <CalendarDays className="w-3.5 h-3.5" />
                    Consultation date
                  </label>
                  {availableUpcomingDates.length === 0 ? (
                    <p className="text-sm text-gray-600 italic">No available dates in the next 14 days.</p>
                  ) : (
                    <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
                      {availableUpcomingDates.map((d) => {
                        const isDateSelected = selectedDate === d.dateStr;
                        return (
                          <button
                            key={d.dateStr}
                            type="button"
                            onClick={() => setSelectedDate(d.dateStr)}
                            className={`px-3 py-2 rounded-lg border text-center transition-colors cursor-pointer shrink-0 min-w-[76px] focus:outline-none focus-visible:ring-2 focus-visible:ring-magenta-500 focus-visible:ring-offset-1 ${
                              isDateSelected
                                ? "bg-magenta-600 text-white border-magenta-600"
                                : "bg-white text-gray-900 border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                            }`}
                          >
                            <p className={`text-[10px] font-semibold uppercase tracking-wider ${isDateSelected ? "text-white/80" : "text-gray-500"}`}>
                              {d.displayDay}
                            </p>
                            <p className="text-sm font-semibold mt-0.5">{d.displayDate}</p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="h-px bg-gray-100" />

                {/* Time slot selection */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2.5">
                    <Clock className="w-3.5 h-3.5" />
                    Time slot
                  </label>
                  {availableTimeSlots.length === 0 ? (
                    <p className="text-sm text-gray-600 italic">No available consultation slots for this doctor.</p>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-40 overflow-y-auto pr-1">
                      {availableTimeSlots.map((slot) => {
                        const isTimeSelected = selectedTime === slot;
                        return (
                          <button
                            key={slot}
                            type="button"
                            onClick={() => setSelectedTime(slot)}
                            className={`py-2 rounded-lg text-xs font-medium tabular-nums transition-colors cursor-pointer border focus:outline-none focus-visible:ring-2 focus-visible:ring-magenta-500 focus-visible:ring-offset-1 ${
                              isTimeSelected
                                ? "bg-magenta-600 text-white border-magenta-600"
                                : "bg-white text-gray-900 border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                            }`}
                          >
                            {formatTime12h(slot)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

        </div>

        {/* Modal Footer / Action Bar */}
        <div className="px-6 py-4 border-t border-gray-200 bg-white flex flex-col-reverse sm:flex-row items-center justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="w-full sm:w-auto px-5 py-2.5 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-800 hover:bg-gray-50 transition cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleConfirmAssign}
            disabled={submitting || isExpired || !selectedDoctor || !selectedDate || !selectedTime}
            className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-magenta-600 hover:bg-magenta-700 text-white text-sm font-semibold shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Confirming & assigning...</span>
              </>
            ) : (
              <span>
                Confirm & assign to Dr. {selectedDoctor ? selectedDoctor.doctor_name.replace(/^dr\.\s*/i, "") : "selected doctor"}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default SelectAlternateDoctorModal;