import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Check, Clock, CalendarDays, MapPin, Stethoscope, Info, Building2, AlertCircle } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { logAuditEvent } from "@/utils/auditLogger";
import { DoctorAvatar } from "@/components/common/DoctorAvatar";
import {
  formatTime12h,
  normalizeDayName,
  timeToMinutes,
  parseDoctorSchedule,
  isDoctorOnDutyOnDay,
  generateDaySlotsForDoctor,
  getManilaNowParts,
  getManilaCalendarDate,
} from "@/lib/schedulingService";
import {
  useSlotAvailabilityRealtime,
  broadcastSlotChange,
  fetchAuthoritativeOccupiedSlots,
  type OccupiedSlotRecord,
  type BroadcastSlotChangePayload,
} from "@/lib/slotAvailabilityRealtime";
import type {
  ConsultationSlot,
  DayShiftSlotsGroup,
  DoctorWeeklySchedule,
} from "@/lib/schedulingService";

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

interface AvailableDateOption {
  dateStr: string;
  displayDay: string;
  displayDate: string;
  weekday: string;
  isAvailable: boolean;
  reason?: string;
  availableCount: number;
  slots: ConsultationSlot[];
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
  weekly_schedule?: DoctorWeeklySchedule;
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
  const [paymentAmount, setPaymentAmount] = useState<number | null>(null);
  const [aiCondition, setAiCondition] = useState<string>("");
  const [previousDoctor, setPreviousDoctor] = useState<{ id: string; name: string; note: string } | null>(null);
  const [availableDoctors, setAvailableDoctors] = useState<DoctorRow[]>([]);

  // Real clinic operating settings & schedule defaults
  const [clinicSettings, setClinicSettings] = useState<{
    openTime: string;
    closeTime: string;
    operatingDays?: string;
    slotIntervalMinutes: number;
  }>({
    openTime: "08:00",
    closeTime: "17:00",
    operatingDays: "Monday - Saturday",
    slotIntervalMinutes: 30,
  });

  // Real-time occupied bookings & holds for target clinic
  const [existingBookings, setExistingBookings] = useState<any[]>([]);
  const [bookingsRefreshKey, setBookingsRefreshKey] = useState(0);

  // Stale polling race condition guard & active session conflict cache
  const fetchBookingsSeqRef = useRef<number>(0);
  const sessionConflictSlotsRef = useRef<Map<string, OccupiedSlotRecord>>(new Map());

  // Selection states
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [slotConflictWarning, setSlotConflictWarning] = useState<string | null>(null);

  // Clear slot conflict warning when modal closes, date changes, or doctor changes
  useEffect(() => {
    setSlotConflictWarning(null);
  }, [isOpen, selectedDate, selectedDoctorId]);

  // Supabase Realtime multi-patient slot availability synchronization & active polling
  useSlotAvailabilityRealtime({
    clinicId: propClinicId ? String(propClinicId) : (appointment?.clinicId ? String(appointment.clinicId) : null),
    selectedDate,
    doctorId: selectedDoctorId,
    enabled: isOpen && !!(propClinicId || appointment?.clinicId),
    pollingIntervalMs: 5000,
    onRefresh: (payload?: BroadcastSlotChangePayload) => {
      if (payload && payload.slotTime && payload.date) {
        const payloadDate = getManilaCalendarDate(payload.date);
        const timeClean = payload.slotTime.slice(0, 5);
        const docKey = payload.doctorId || "any";
        const slotKey = `${payloadDate}_${docKey}_${timeClean}`;

        if (payload.changeType === "hold_acquired") {
          sessionConflictSlotsRef.current.set(slotKey, {
            date: payloadDate,
            time: timeClean,
            batch_time: timeClean,
            assigned_doctor_id: payload.doctorId || null,
            clinic_id: propClinicId ? String(propClinicId) : (appointment?.clinicId ? String(appointment.clinicId) : undefined),
            status: "pending",
            doctor_status: "approved",
            payment_status: "pending_hold",
            occupancy_type: "reserved",
            payment_hold_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          });

          if (
            selectedDate === payloadDate &&
            selectedTime === timeClean &&
            (!payload.doctorId || !selectedDoctorId || String(payload.doctorId) === String(selectedDoctorId))
          ) {
            setSelectedTime("");
            const timeLabel = formatTime12h(timeClean);
            setSlotConflictWarning(`The ${timeLabel} consultation slot was just reserved by another patient. Please select another available time.`);
          }
        } else if (payload.changeType === "payment_completed") {
          sessionConflictSlotsRef.current.set(slotKey, {
            date: payloadDate,
            time: timeClean,
            batch_time: timeClean,
            assigned_doctor_id: payload.doctorId || null,
            clinic_id: propClinicId ? String(propClinicId) : (appointment?.clinicId ? String(appointment.clinicId) : undefined),
            status: "scheduled",
            doctor_status: "approved",
            payment_status: "paid",
            occupancy_type: "booked",
          });

          if (
            selectedDate === payloadDate &&
            selectedTime === timeClean &&
            (!payload.doctorId || !selectedDoctorId || String(payload.doctorId) === String(selectedDoctorId))
          ) {
            setSelectedTime("");
            const timeLabel = formatTime12h(timeClean);
            setSlotConflictWarning(`The ${timeLabel} consultation slot was just booked by another patient. Please select another available time.`);
          }
        } else if (payload.changeType === "hold_released" || payload.changeType === "cancelled") {
          sessionConflictSlotsRef.current.delete(slotKey);
        }
      }

      setBookingsRefreshKey((k) => k + 1);
    },
  });

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
        let clinicOpen = "08:00";
        let clinicClose = "17:00";
        let clinicDays = "Monday - Saturday";
        let slotInterval = 30;
        

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

          // Resolve clinic operating settings
          clinicOpen = "08:00";
          clinicClose = "17:00";
          clinicDays = "Monday - Saturday";
          slotInterval = 30;

          try {
            const rawSett = localStorage.getItem("dermai_clinic_settings");
            if (rawSett) {
              const s = JSON.parse(rawSett);
              if (s.openTime) clinicOpen = s.openTime;
              if (s.closeTime) clinicClose = s.closeTime;
              if (s.operatingDays) clinicDays = s.operatingDays;
              if (s.slotIntervalMinutes) slotInterval = Number(s.slotIntervalMinutes);
            }
          } catch {}

          if (Array.isArray(opHours) && opHours.length > 0) {
            const h0 = opHours[0];
            if (h0.open_time) clinicOpen = String(h0.open_time).slice(0, 5);
            if (h0.close_time) clinicClose = String(h0.close_time).slice(0, 5);
            if (h0.day_of_week) clinicDays = h0.day_of_week;
          }

          if (isMounted) {
            setClinicSettings({
              openTime: clinicOpen,
              closeTime: clinicClose,
              operatingDays: clinicDays,
              slotIntervalMinutes: slotInterval,
            });
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

        // 5. Fallback to localStorage if no doctors found in database
        if (doctorList.length === 0) {
          try {
            const rawDocs = localStorage.getItem("dermai_clinic_doctors");
            if (rawDocs) {
              const parsedDocs = JSON.parse(rawDocs);
              if (Array.isArray(parsedDocs)) {
                doctorList = parsedDocs.filter((d: any) => {
                  const matchClinic = !d.clinic_id || String(d.clinic_id) === String(targetClinicId);
                  const isNotDeclined = !prevDocId || String(d.doctor_id || d.id) !== String(prevDocId);
                  return matchClinic && isNotDeclined;
                }).map((d: any) => ({
                  doctor_id: String(d.doctor_id || d.id),
                  clinic_id: String(d.clinic_id || targetClinicId),
                  user_id: d.user_id || null,
                  doctor_name: d.doctor_name || d.name || "Specialist",
                  prc_license: d.prc_license || d.prcLicense || null,
                  specialization: d.specialization || "Dermatology Specialist",
                  photo_url: d.photo_url || d.photo || null,
                  duty_days: d.duty_days || d.dutyDays || null,
                  duty_start_time: d.duty_start_time || d.dutyStartTime || null,
                  duty_end_time: d.duty_end_time || d.dutyEndTime || null,
                  duty_schedule: d.duty_schedule || d.dutySchedule || null,
                  status: d.status || "active",
                }));
              }
            }
          } catch {}
        }

        // 6. Active & Availability Constraints:
        // - Clinic Filtering: strictly clinic_id = targetClinicId
        // - Exclude originally assigned doctor who declined (doctor_id != prevDocId)
        // - Doctor is active & verified: status = 'active' and is_active !== false
        // - Doctor must have valid duty schedule / days

        let filtered: DoctorRow[] = doctorList
          .filter((d) => {
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
          })
          .map((d) => {
            const rawSchedObj = d.duty_schedule;
            const parsedSchedule = parseDoctorSchedule(
              rawSchedObj,
              d.duty_days,
              d.duty_start_time || clinicOpen,
              d.duty_end_time || clinicClose
            );
            return {
              ...d,
              weekly_schedule: parsedSchedule,
            };
          });

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

  // Fetch real-time active bookings for the clinic to enforce double-booking prevention & holds
  useEffect(() => {
    if (!isOpen) return;
    const targetClinicId = propClinicId ? String(propClinicId) : (appointment?.clinicId ? String(appointment.clinicId) : null);
    if (!targetClinicId) return;

    let cancelled = false;
    const currentSeq = ++fetchBookingsSeqRef.current;

    async function fetchBookings() {
      try {
        let bookingsList: any[] = [];

        // 1. Fetch appointments from Supabase for this clinic
        const { data: apptRows, error: apptErr } = await supabase
          .from("patient_appointment")
          .select("appointment_id, date, time, batch_time, queue_number, status, doctor_status, assigned_doctor_id, clinic_id, payment_status, payment_hold_expires_at")
          .eq("clinic_id", targetClinicId)
          .neq("status", "cancelled")
          .neq("status", "rejected");

        if (!apptErr && Array.isArray(apptRows)) {
          bookingsList = apptRows;
        }

        // Fetch authoritative occupied slots via RPC for selectedDate if chosen
        if (targetClinicId && selectedDate) {
          try {
            const rpcData = await fetchAuthoritativeOccupiedSlots({
              clinicId: targetClinicId,
              date: selectedDate,
              doctorId: selectedDoctorId,
            });
            for (const s of rpcData) {
              const exists = bookingsList.some((b) => {
                const bTime = (b.time || b.batch_time || "").slice(0, 5);
                const bDate = getManilaCalendarDate(b.date);
                return bTime === s.time && bDate === selectedDate && (!b.assigned_doctor_id || !s.assigned_doctor_id || String(b.assigned_doctor_id) === String(s.assigned_doctor_id));
              });
              if (!exists) {
                bookingsList.push(s);
              }
            }
          } catch {}
        }

        // 2. Also check localStorage dermai_clinic_appointments cache
        try {
          const rawLocal = localStorage.getItem("dermai_clinic_appointments");
          if (rawLocal) {
            const parsed = JSON.parse(rawLocal);
            if (Array.isArray(parsed)) {
              for (const loc of parsed) {
                const locClinicId = String(loc.clinic_id || loc.clinicId || "");
                if (locClinicId === String(targetClinicId)) {
                  const existingIdx = bookingsList.findIndex(
                    (b) => String(b.appointment_id || b.id) === String(loc.appointment_id || loc.id)
                  );
                  if (existingIdx === -1) {
                    bookingsList.push({
                      appointment_id: loc.appointment_id || loc.id,
                      date: loc.date,
                      time: loc.time,
                      batch_time: loc.batchTime || loc.time,
                      assigned_doctor_id: loc.assigned_doctor_id || loc.assignedDoctorId,
                      status: loc.status,
                      doctor_status: loc.doctor_status || loc.doctorStatus,
                      payment_status: loc.payment_status || loc.paymentStatus,
                      payment_hold_expires_at: loc.payment_hold_expires_at || loc.paymentHoldExpiresAt,
                    });
                  }
                }
              }
            }
          }
        } catch {}

        // Filter out current appointment being rescheduled so it does not block itself
        const currentApptId = propAppointmentId || appointment?.id;
        const filteredBookings = bookingsList.filter((b) => String(b.appointment_id || b.id) !== String(currentApptId));

        // Merge active non-expired session conflicts to guarantee polling never wipes out known reservations
        const nowMs = Date.now();
        sessionConflictSlotsRef.current.forEach((cachedRec: OccupiedSlotRecord, key: string) => {
          if (cachedRec.date === selectedDate) {
            if (cachedRec.payment_hold_expires_at) {
              const expTime = new Date(cachedRec.payment_hold_expires_at).getTime();
              if (!isNaN(expTime) && expTime <= nowMs) {
                sessionConflictSlotsRef.current.delete(key);
                return;
              }
            }
            const cTime = (cachedRec.time || cachedRec.batch_time || "").slice(0, 5);
            const cDocId = cachedRec.assigned_doctor_id;
            const alreadyInList = filteredBookings.some((b: any) => {
              const bTime = (b.time || b.batch_time || "").slice(0, 5);
              const bDocId = b.assigned_doctor_id;
              return bTime === cTime && (!cDocId || !bDocId || String(bDocId) === String(cDocId));
            });
            if (!alreadyInList) {
              filteredBookings.push(cachedRec);
            }
          }
        });

        if (!cancelled && currentSeq === fetchBookingsSeqRef.current) {
          setExistingBookings(filteredBookings);
        }
      } catch (err) {
        console.warn("[SelectAlternateDoctorModal] Failed to fetch active bookings:", err);
      }
    }

    fetchBookings();
    return () => {
      cancelled = true;
    };
  }, [isOpen, propClinicId, appointment?.clinicId, appointment?.id, propAppointmentId, bookingsRefreshKey, selectedDate, selectedDoctorId]);

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
      if (days.length === 7) return "Mon – Sun (All week)";
      const dayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
      const sorted = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
      return sorted.map((d) => d.slice(0, 3)).join(", ");
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

  // Dynamically compute upcoming consultation dates for the selected doctor with real slot availability
  const availableUpcomingDates = useMemo<AvailableDateOption[]>(() => {
    if (!selectedDoctor) return [];

    const manilaNow = getManilaNowParts();
    const baseYear = manilaNow.year;
    const baseMonth = manilaNow.month;
    const baseDay = manilaNow.day;
    const currentMinutesNow = manilaNow.totalMinutes;
    const todayDateStr = manilaNow.dateKey;

    const clinicSchedule = {
      openTime: clinicSettings.openTime,
      closeTime: clinicSettings.closeTime,
      operatingDays: clinicSettings.operatingDays,
    };

    const clinicDefaults = {
      defaultSlotIntervalMinutes: clinicSettings.slotIntervalMinutes || 30,
      openTime: clinicSettings.openTime,
      closeTime: clinicSettings.closeTime,
      operatingDays: clinicSettings.operatingDays,
    };

    const docSchedule =
      selectedDoctor.weekly_schedule ||
      parseDoctorSchedule(
        selectedDoctor.duty_schedule,
        selectedDoctor.duty_days,
        selectedDoctor.duty_start_time || clinicSettings.openTime,
        selectedDoctor.duty_end_time || clinicSettings.closeTime
      );

    const dates: AvailableDateOption[] = [];

    // Horizon: 14 upcoming days (day 0 through 14)
    for (let i = 0; i <= 14; i++) {
      const dt = new Date(Date.UTC(baseYear, baseMonth - 1, baseDay + i, 12, 0, 0));
      const y = dt.getUTCFullYear();
      const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
      const d = String(dt.getUTCDate()).padStart(2, "0");
      const dateStr = `${y}-${m}-${d}`;

      const weekday = dt.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
      const displayDay = dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
      const displayDate = dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

      const isToday = dateStr === todayDateStr;

      // 1. Verify doctor is on duty and clinic is open on this day of week
      const onDuty = isDoctorOnDutyOnDay(selectedDoctor, weekday, clinicSchedule);
      if (!onDuty) {
        dates.push({
          dateStr,
          displayDay,
          displayDate,
          weekday,
          isAvailable: false,
          reason: "Off Duty",
          availableCount: 0,
          slots: [],
        });
        continue;
      }

      // 2. Filter existing bookings for this doctor and date
      const bookingsForDate = existingBookings.filter((b) => {
        if (!b.date) return false;
        const bDateStr = getManilaCalendarDate(b.date);
        return bDateStr === dateStr;
      });

      // 3. Generate slots using unified generateDaySlotsForDoctor
      const dayGroups: DayShiftSlotsGroup[] = generateDaySlotsForDoctor({
        doctorSchedule: docSchedule,
        dayOfWeek: weekday,
        doctorId: selectedDoctor.doctor_id,
        clinicDefaults,
        existingAppointments: bookingsForDate,
        isToday,
        currentMinutesNow,
      });

      const daySlots = dayGroups.flatMap((g) => g.slots);
      const availableSlots = daySlots.filter((s) => s.isAvailable);

      if (availableSlots.length === 0) {
        dates.push({
          dateStr,
          displayDay,
          displayDate,
          weekday,
          isAvailable: false,
          reason: isToday ? "Passed" : "Fully Booked",
          availableCount: 0,
          slots: daySlots,
        });
      } else {
        dates.push({
          dateStr,
          displayDay,
          displayDate,
          weekday,
          isAvailable: true,
          availableCount: availableSlots.length,
          slots: daySlots,
        });
      }
    }

    return dates;
  }, [selectedDoctor, clinicSettings, existingBookings]);

  // Auto-select earliest available date
  useEffect(() => {
    if (availableUpcomingDates.length === 0) {
      if (selectedDate !== "") setSelectedDate("");
      return;
    }

    // Keep current selectedDate if it is still available
    const currentValid = availableUpcomingDates.some((d) => d.dateStr === selectedDate && d.isAvailable);
    if (!currentValid) {
      const firstAvail = availableUpcomingDates.find((d) => d.isAvailable);
      if (firstAvail) {
        setSelectedDate(firstAvail.dateStr);
      } else {
        setSelectedDate(availableUpcomingDates[0].dateStr);
      }
    }
  }, [availableUpcomingDates, selectedDate]);

  // Consultation time slots for the selected date
  const selectedDateRecord = useMemo(() => {
    return availableUpcomingDates.find((d) => d.dateStr === selectedDate) || null;
  }, [availableUpcomingDates, selectedDate]);

  const availableTimeSlots = useMemo<ConsultationSlot[]>(() => {
    return selectedDateRecord?.slots || [];
  }, [selectedDateRecord]);

  // Detect if currently selectedTime was just occupied by another patient
  useEffect(() => {
    if (!selectedTime || availableTimeSlots.length === 0) return;
    const currentSlot = availableTimeSlots.find((s) => s.slotTime === selectedTime);
    if (currentSlot && !currentSlot.isAvailable) {
      const timeLabel = currentSlot.label || formatTime12h(selectedTime);
      const conflictMsg = currentSlot.isReserved
        ? `The ${timeLabel} consultation slot was just reserved by another patient. Please select another available time.`
        : `The ${timeLabel} consultation slot was just booked by another patient. Please select another available time.`;
      // Immediately clear the selected time and remove selection styling
      setSelectedTime("");
      setSlotConflictWarning(conflictMsg);
    }
  }, [availableTimeSlots, selectedTime]);

  // Auto-select first available time slot if none selected and no active conflict warning
  useEffect(() => {
    if (slotConflictWarning) return;
    if (availableTimeSlots.length > 0) {
      const currentValid = availableTimeSlots.some((s) => s.slotTime === selectedTime && s.isAvailable);
      if (!currentValid && !selectedTime) {
        const firstAvail = availableTimeSlots.find((s) => s.isAvailable);
        if (firstAvail) {
          setSelectedTime(firstAvail.slotTime);
        }
      }
    } else {
      setSelectedTime("");
    }
  }, [availableTimeSlots, selectedTime, slotConflictWarning]);

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
      const targetClinicId = propClinicId ? String(propClinicId) : (appointment?.clinicId ? String(appointment.clinicId) : null);

      // Pre-confirmation double-booking guard: verify slot is still available authoritatively in real-time
      if (targetClinicId && selectedDoctor) {
        try {
          const authoritativeSlots = await fetchAuthoritativeOccupiedSlots({
            clinicId: targetClinicId,
            date: selectedDate,
            doctorId: selectedDoctor.doctor_id,
          });

          const currentApptId = propAppointmentId || appointment?.id;
          const isDoubleBooked = authoritativeSlots.some((s) => {
            if (s.appointment_id && String(s.appointment_id) === String(currentApptId)) return false;
            const sDate = getManilaCalendarDate(s.date);
            const sTime = (s.time || s.batch_time || "").slice(0, 5);
            return sDate === selectedDate && sTime === selectedTime;
          });

          if (isDoubleBooked) {
            const conflictRec: OccupiedSlotRecord = {
              date: selectedDate,
              time: selectedTime,
              batch_time: selectedTime,
              assigned_doctor_id: selectedDoctor.doctor_id,
              clinic_id: targetClinicId,
              status: "scheduled",
              doctor_status: "approved",
              payment_status: "paid",
              occupancy_type: "booked",
              payment_hold_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            };
            const docKey = selectedDoctor.doctor_id || "any";
            sessionConflictSlotsRef.current.set(`${selectedDate}_${docKey}_${selectedTime}`, conflictRec);
            broadcastSlotChange(targetClinicId, {
              date: selectedDate,
              doctorId: selectedDoctor.doctor_id,
              slotTime: selectedTime,
              type: "hold_acquired",
            });
            setErrorMsg("This time slot was just booked by another patient. Please select another available schedule.");
            setBookingsRefreshKey((prev) => prev + 1);
            setSubmitting(false);
            return;
          }
        } catch (chkErr) {
          console.warn("[SelectAlternateDoctorModal] Pre-confirmation slot check warning:", chkErr);
        }
      }

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

      if (targetClinicId) {
        broadcastSlotChange(targetClinicId, {
          date: selectedDate,
          doctorId: selectedDoctor.doctor_id,
          slotTime: selectedTime,
          type: "payment_completed",
        });
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
              <div className="space-y-3">
                {availableDoctors.map((doc) => {
                  const isSelected = selectedDoctorId === doc.doctor_id;
                  const dutyDaysStr = formatDutyDays(doc);
                  const dutyHoursStr = formatDutyHours(doc);

                  return (
                    <button
                      key={doc.doctor_id}
                      type="button"
                      onClick={() => {
                        setSelectedDoctorId(doc.doctor_id);
                        setSlotConflictWarning(null);
                      }}
                      className={`w-full p-4 sm:p-5 rounded-2xl border text-left transition-all cursor-pointer relative group flex flex-col sm:flex-row sm:items-center justify-between gap-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-magenta-500 ${
                        isSelected
                          ? "border-magenta-600 bg-magenta-50/50 shadow-xs ring-1 ring-magenta-600"
                          : "border-gray-200 bg-white hover:border-magenta-300 hover:bg-gray-50/60"
                      }`}
                    >
                      {/* Left Side: Avatar + Doctor Info */}
                      <div className="flex items-center gap-3.5 sm:gap-4 min-w-0 flex-1">
                        <DoctorAvatar
                          doctorId={doc.doctor_id}
                          userId={doc.user_id || undefined}
                          doctor={doc}
                          name={doc.doctor_name}
                          className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl border border-magenta-200/80 shrink-0 text-base font-bold shadow-2xs"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-sm sm:text-base font-bold text-gray-900 truncate group-hover:text-magenta-800 transition-colors">
                              Dr. {doc.doctor_name.replace(/^dr\.\s*/i, "")}
                            </h4>
                            <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-md border border-gray-200/70 shrink-0">
                              {doc.prc_license ? `PRC #${doc.prc_license}` : "PRC Licensed"}
                            </span>
                          </div>

                          <p className="text-xs text-magenta-700 font-medium truncate mt-0.5">
                            {doc.specialization || "Dermatology Specialist"}
                          </p>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-gray-600">
                            <span className="flex items-center gap-1.5 font-medium">
                              <CalendarDays className="w-3.5 h-3.5 text-magenta-500 shrink-0" />
                              <span className="text-gray-500">Duty days:</span>
                              <strong className="text-gray-800 font-semibold">{dutyDaysStr}</strong>
                            </span>
                            <span className="flex items-center gap-1.5 font-medium">
                              <Clock className="w-3.5 h-3.5 text-magenta-500 shrink-0" />
                              <span className="text-gray-500">Duty hours:</span>
                              <strong className="text-gray-800 font-semibold">{dutyHoursStr}</strong>
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right Side: Selection Checkmark + No Extra Charge Badge */}
                      <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0 pt-2.5 sm:pt-0 border-t sm:border-t-0 border-gray-100">
                        <span
                          className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                            isSelected
                              ? "bg-magenta-600 border-magenta-600 text-white shadow-2xs"
                              : "border-gray-300 bg-white text-transparent group-hover:border-magenta-400"
                          }`}
                          aria-hidden="true"
                        >
                          <Check className="w-3.5 h-3.5" strokeWidth={3} />
                        </span>
                        <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200 shrink-0">
                          No extra charge
                        </span>
                      </div>
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
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                      <CalendarDays className="w-3.5 h-3.5 text-magenta-600" />
                      Consultation date
                    </label>
                    {selectedDateRecord && (
                      <span className="text-[11px] font-medium text-gray-500">
                        {selectedDateRecord.isAvailable
                          ? `${selectedDateRecord.availableCount} slot${selectedDateRecord.availableCount === 1 ? "" : "s"} available`
                          : (selectedDateRecord.reason || "Unavailable")}
                      </span>
                    )}
                  </div>

                  {availableUpcomingDates.length === 0 ? (
                    <p className="text-sm text-gray-600 italic">No consultation dates available in the next 14 days.</p>
                  ) : (
                    <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
                      {availableUpcomingDates.map((d) => {
                        const isDateSelected = selectedDate === d.dateStr;
                        const isAvail = d.isAvailable;

                        return (
                          <button
                            key={d.dateStr}
                            type="button"
                            disabled={!isAvail}
                            onClick={() => {
                              if (isAvail) {
                                setSelectedDate(d.dateStr);
                                setSlotConflictWarning(null);
                              }
                            }}
                            className={`px-3 py-2 rounded-xl border text-center transition-all shrink-0 min-w-[78px] focus:outline-none focus-visible:ring-2 focus-visible:ring-magenta-500 focus-visible:ring-offset-1 ${
                              !isAvail
                                ? "bg-gray-50 border-gray-200 text-gray-400 opacity-50 cursor-not-allowed"
                                : isDateSelected
                                ? "bg-magenta-600 text-white border-magenta-600 shadow-sm font-semibold cursor-pointer"
                                : "bg-white text-gray-900 border-gray-200 hover:border-magenta-300 hover:bg-magenta-50/20 cursor-pointer shadow-2xs"
                            }`}
                            title={!isAvail ? (d.reason || "Unavailable") : `${d.availableCount} slots available`}
                          >
                            <p
                              className={`text-[10px] font-bold uppercase tracking-wider ${
                                !isAvail ? "text-gray-400" : isDateSelected ? "text-white/80" : "text-gray-500"
                              }`}
                            >
                              {d.displayDay}
                            </p>
                            <p className="text-sm font-bold mt-0.5">{d.displayDate}</p>
                            {!isAvail && (
                              <span className="block text-[9px] font-medium text-gray-400 mt-0.5 truncate">
                                {d.reason || "Off"}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="h-px bg-gray-100" />

                {/* Time slot selection */}
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                      <Clock className="w-3.5 h-3.5 text-magenta-600" />
                      Time slot
                    </label>
                    <span className="text-[11px] text-gray-500">
                      {clinicSettings.slotIntervalMinutes}m intervals
                    </span>
                  </div>

                  {slotConflictWarning && (
                    <div className="mb-3.5 p-3 sm:p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs sm:text-[13px] flex items-start gap-2.5 shadow-xs animate-in fade-in slide-in-from-top-1 duration-200">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <span className="flex-1 font-medium">{slotConflictWarning}</span>
                      <button
                        type="button"
                        onClick={() => setSlotConflictWarning(null)}
                        className="text-amber-700 hover:text-amber-900 font-bold text-xs cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  )}

                  {availableTimeSlots.length === 0 ? (
                    <div className="p-4 rounded-xl border border-dashed border-gray-200 bg-gray-50/60 text-center">
                      <p className="text-xs text-gray-600 font-medium">
                        No consultation slots available for this doctor on the selected date.
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        Please pick another highlighted date from the schedule above.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                      {availableTimeSlots.map((slot) => {
                        const isTimeSelected = selectedTime === slot.slotTime;
                        const isAvail = slot.isAvailable;

                        return (
                          <button
                            key={slot.slotTime}
                            type="button"
                            disabled={!isAvail}
                            onClick={() => {
                              if (isAvail) {
                                setSelectedTime(slot.slotTime);
                                setSlotConflictWarning(null);
                              }
                            }}
                            className={`py-2.5 px-3 rounded-xl border text-left transition-all relative flex items-center justify-between gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-magenta-500 focus-visible:ring-offset-1 ${
                              slot.isReserved
                                ? "bg-amber-50/70 border-amber-300 text-amber-900 cursor-not-allowed opacity-80"
                                : slot.isBooked
                                ? "bg-rose-50/50 border-rose-200 text-rose-900 cursor-not-allowed opacity-70"
                                : !isAvail
                                ? "bg-slate-50/70 border-gray-200 text-gray-400 cursor-not-allowed opacity-60"
                                : isTimeSelected
                                ? "bg-magenta-600 border-magenta-600 text-white font-bold shadow-xs cursor-pointer"
                                : "bg-white border-gray-200 text-gray-800 hover:border-magenta-300 hover:bg-magenta-50/30 cursor-pointer shadow-2xs"
                            }`}
                            title={
                              slot.isReserved
                                ? "Temporarily reserved by another patient for checkout"
                                : slot.isBooked
                                ? "Already booked by another patient"
                                : !isAvail
                                ? slot.isPast
                                  ? "Time slot has passed"
                                  : slot.isCapacityFull
                                  ? "Shift capacity full"
                                  : "Unavailable"
                                : `${slot.timeRange} (Available)`
                            }
                          >
                            <span
                              className={`text-xs font-bold leading-tight tabular-nums ${
                                isTimeSelected
                                  ? "text-white"
                                  : !isAvail
                                  ? "text-gray-400"
                                  : "text-gray-900"
                              }`}
                            >
                              {slot.label || formatTime12h(slot.slotTime)}
                            </span>

                            {slot.isReserved ? (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 uppercase tracking-wide shrink-0">
                                Reserved
                              </span>
                            ) : slot.isBooked ? (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 uppercase tracking-wide shrink-0">
                                Booked
                              </span>
                            ) : slot.isPast ? (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200 uppercase tracking-wide shrink-0">
                                Passed
                              </span>
                            ) : slot.isCapacityFull ? (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 uppercase tracking-wide shrink-0">
                                Full
                              </span>
                            ) : isTimeSelected ? (
                              <span className="w-4 h-4 rounded-full bg-white text-magenta-700 flex items-center justify-center text-[10px] shrink-0 font-black shadow-2xs">
                                ✓
                              </span>
                            ) : (
                              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" title="Available" />
                            )}
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