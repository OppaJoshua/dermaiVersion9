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
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { skinConditions } from "@/pages/public/SkinLibrary";
import { useClinicVerification } from "@/hooks/useClinicVerification";
import { supabase } from "@/lib/supabaseClient";
import { LazySkinPhoto } from "@/components/common/LazySkinPhoto";

type AppointmentRecord = {
  id: string;
  clinicId: number;
  clinicName: string;
  patientName?: string;
  patientAge?: number;
  patientGender?: string;
  patientBirthdate?: string;
  patientAvatar?: string;
  patientEmail?: string;
  patientAddress?: string;
  patientContact?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyRelationship?: string;
  consultationType: "face-to-face";
  conditionId?: string;
  conditionName?: string;
  conditionImage?: string;
  date: string;
  time: string;
  notes: string;
  status: "pending" | "accepted" | "scheduled" | "confirmed" | "rejected" | "completed" | "cancelled";
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
  queueNumber?: number;
  batchTime?: string;
  checkInStatus?: "scheduled" | "arrived" | "in-consultation" | "completed" | "no-show";
  isWalkIn?: boolean;
};

type DoctorAccount = {
  id: string;
  name: string;
  email: string;
  specialization: string;
  clinicName: string;
  photo?: string;
};

type ClinicSettings = {
  openTime: string;
  closeTime: string;
};

const DEFAULT_SETTINGS: ClinicSettings = {
  openTime: "09:00",
  closeTime: "18:00",
};

function formatDoctorDisplay(name?: string): string {
  if (!name) return "";
  const cleaned = name.replace(/^(?:dr\.?|doctor)\s*/i, "").trim();
  if (!cleaned || cleaned.toLowerCase() === "dr") return "";
  return `Dr. ${cleaned}`;
}

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
    let resolvedClinicId: string | null = clinicId ? String(clinicId) : null;

    // Step 1: Try localStorage profile cache
    if (!resolvedClinicId) {
      try {
        const cache = localStorage.getItem("dermai_clinic_profile_cache");
        if (cache) {
          const parsed = JSON.parse(cache);
          if (parsed.clinicId) resolvedClinicId = String(parsed.clinicId);
        }
      } catch { }
    }

    // Step 2: Try direct Supabase session query (same as Dashboard)
    if (!resolvedClinicId) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const userEmail = session.user.email?.toLowerCase().trim();
          const { data: clinicRow } = await supabase
            .from("clinic")
            .select("clinic_id, name")
            .or(`owner_user_id.eq.${session.user.id}${userEmail ? `,email.ilike.${userEmail}` : ""}`)
            .maybeSingle();
          if (clinicRow?.clinic_id) {
            resolvedClinicId = String(clinicRow.clinic_id);
          }
        }
      } catch { }
    }

    console.log("[ClinicAppointments] resolvedClinicId =", resolvedClinicId);

    // 1. Fetch clinic doctors from clinic_doctor table
    let docRows: any[] = [];
    if (resolvedClinicId) {
      const { data, error: docErr } = await supabase
        .from("clinic_doctor")
        .select("doctor_id, doctor_name, email, photo_url, status")
        .eq("clinic_id", resolvedClinicId);
      console.log("[ClinicAppointments] clinic_doctor rows:", data?.length ?? 0, docErr?.message);
      if (data && data.length > 0) {
        docRows = data.filter((d: any) => (d.status || "").toLowerCase() !== "inactive");
        setClinicDoctors(docRows.map((d: any) => ({
          id: d.doctor_id,
          name: d.doctor_name,
          email: d.email || "",
          photo: d.photo_url || undefined,
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
              photo: d.photo || d.photo_url || undefined,
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
      // Try exact match first
      const { data: apptRows, error: apptErr } = await supabase
        .from("patient_appointment")
        .select("*")
        .eq("clinic_id", resolvedClinicId)
        .order("created_at", { ascending: false });

      console.log("[ClinicAppointments] patient_appointment rows (filtered):", apptRows?.length ?? 0, apptErr?.message);

      if (apptErr) {
        console.warn("[ClinicAppointmentsPage] Failed to fetch patient_appointment from Supabase:", apptErr.message);
      } else if (apptRows && apptRows.length > 0) {
        dbAppts = apptRows;
      } else {
        // Fallback: fetch all and filter client-side (handles type mismatch e.g. int vs string)
        const { data: allAppts, error: allErr } = await supabase
          .from("patient_appointment")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200);

        console.log("[ClinicAppointments] all patient_appointment rows:", allAppts?.length ?? 0, allErr?.message);

        if (allAppts && allAppts.length > 0) {
          dbAppts = allAppts.filter((r: any) =>
            r.clinic_id !== null &&
            r.clinic_id !== undefined &&
            String(r.clinic_id) === String(resolvedClinicId)
          );
          console.log("[ClinicAppointments] client-side filtered rows:", dbAppts.length);
        }
      }
    }

    // Map database records (do not generate signed URLs during list load)
    const mapped: AppointmentRecord[] = dbAppts.map((a: any) => {
      const photoUrl = a.skin_photo_url || undefined;

        const apptDate = a.date ? new Date(a.date) : null;
        const isValidDate = apptDate && !isNaN(apptDate.getTime());
        let dateStr = "";
        let timeStr = "";
        if (isValidDate) {
          const dFormatter = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Manila",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          });
          dateStr = dFormatter.format(apptDate);
          const tFormatter = new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Manila",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
          timeStr = tFormatter.format(apptDate);
        }

        let displayStatus: AppointmentRecord["status"] = "pending";
        if (a.status === "confirmed" || a.status === "scheduled") displayStatus = "scheduled";
        else if (a.status === "completed") displayStatus = "completed";
        else if (a.status === "cancelled") displayStatus = "cancelled";
        else if (a.status === "rejected") displayStatus = "rejected";
        else if (a.status === "accepted") displayStatus = "accepted";

        // Robust doctor name resolution
        let docName: string | undefined = undefined;
        if (a.assigned_doctor_id) {
          const matchedDoc = docRows.find((d: any) => d.doctor_id === a.assigned_doctor_id);
          if (matchedDoc?.doctor_name) docName = matchedDoc.doctor_name;
        }
        if (!docName && a.assigned_doctor_id) {
          try {
            const rawDocs = localStorage.getItem("dermai_clinic_doctors");
            if (rawDocs) {
              const parsed = JSON.parse(rawDocs);
              if (Array.isArray(parsed)) {
                const found = parsed.find((d: any) => d.id === a.assigned_doctor_id);
                if (found?.name) docName = found.name;
              }
            }
          } catch { }
        }
        if (!docName && a.assigned_doctor_id && a.clinic_note) {
          const match = a.clinic_note.match(/(?:Assigned to|Re-assigned to)\s+(?:Dr\.\s*)?([A-Za-z\s]+?)(?:\s+for|\s+accepted|\s+declined|\.|$)/i);
          if (match && match[1] && match[1].trim().toLowerCase() !== "dr") {
            docName = match[1].trim();
          }
        }
        const resolvedDoctorDisplay = formatDoctorDisplay(docName);

        let calculatedAge: number | undefined = undefined;
        if (a.patient_birthdate) {
          try {
            const b = new Date(a.patient_birthdate);
            if (!isNaN(b.getTime())) {
              const today = new Date();
              let age = today.getFullYear() - b.getFullYear();
              const m = today.getMonth() - b.getMonth();
              if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
              if (age >= 0 && age < 130) calculatedAge = age;
            }
          } catch {}
        }

        return {
          id: a.appointment_id,
          clinicId: 0,
          clinicName: clinicName || "Clinic",
          patientName: a.patient_name || "Patient",
          patientAge: calculatedAge,
          patientGender: a.patient_gender || undefined,
          patientBirthdate: a.patient_birthdate || undefined,
          patientEmail: a.patient_email || undefined,
          patientAddress: a.patient_address || undefined,
          patientContact: a.patient_contact || undefined,
          emergencyContactName: a.emergency_contact_name || undefined,
          emergencyContactPhone: a.emergency_contact_phone || undefined,
          emergencyRelationship: a.emergency_contact_relationship || undefined,
          consultationType: "face-to-face" as const,
          conditionName: a.ai_condition_name || undefined,
          date: dateStr,
          time: timeStr,
          notes: a.notes || "",
          status: displayStatus,
          clinicNote: a.clinic_note || undefined,
          assignedDoctorId: a.assigned_doctor_id || undefined,
          assignedDoctorName: resolvedDoctorDisplay || undefined,
          doctorStatus: a.doctor_status || undefined,
          doctorNote: a.doctor_note || undefined,
          doctorReviewedAt: a.doctor_reviewed_at || undefined,
          scheduleSentToDoctor: a.schedule_sent_to_doctor || false,
          createdAt: a.created_at || new Date().toISOString(),
          skinPhotoUrl: photoUrl,
          aiConditionName: a.ai_condition_name || undefined,
          aiConfidence: a.ai_confidence ? Number(a.ai_confidence) : undefined,
          queueNumber: a.queue_number || 1,
          batchTime: a.batch_time || undefined,
          checkInStatus: a.check_in_status || "scheduled",
          isWalkIn: Boolean(a.is_walk_in),
        };
      });

    // Merge with local storage appointments
    try {
      const raw = localStorage.getItem("dermai_clinic_appointments");
      if (raw) {
        const localList = JSON.parse(raw);
        if (Array.isArray(localList)) {
          localList.forEach((localItem: any) => {
            const exists = mapped.some((m) => m.id === localItem.id);
            if (!exists) {
              const isClinicMatch =
                (resolvedClinicId && localItem.clinicId && String(localItem.clinicId) === String(resolvedClinicId)) ||
                (clinicName && localItem.clinicName && localItem.clinicName.toLowerCase().trim() === clinicName.toLowerCase().trim()) ||
                (!resolvedClinicId);
              if (isClinicMatch) {
                mapped.push({
                  id: localItem.id,
                  clinicId: 0,
                  clinicName: localItem.clinicName || clinicName || "Clinic",
                  patientName: localItem.patientName || "Patient",
                  patientEmail: localItem.patientEmail || undefined,
                  patientAddress: localItem.patientAddress || undefined,
                  patientContact: localItem.patientContact || undefined,
                  emergencyContactName: localItem.emergencyContactName || localItem.emergency_contact_name || undefined,
                  emergencyContactPhone: localItem.emergencyContactPhone || localItem.emergency_contact_phone || undefined,
                  emergencyRelationship: localItem.emergencyRelationship || localItem.emergency_relationship || undefined,
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

    console.log("[ClinicAppointments] final mapped appointments:", mapped.length);
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
  }, [clinicId, clinicName, loading]);

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

  // Queue tab filter: all | needs_doctor | in_review | approved | doctor_declined
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const validTabs = ["all", "needs_doctor", "in_review", "approved", "doctor_declined"] as const;
  const [queueFilter, setQueueFilter] = useState<"all" | "needs_doctor" | "in_review" | "approved" | "doctor_declined">(
    initialTab && (validTabs as readonly string[]).includes(initialTab) ? (initialTab as any) : "all"
  );

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab && (validTabs as readonly string[]).includes(tab)) {
      setQueueFilter(tab as any);
    }
  }, [searchParams]);

  // Modals
  const [viewingPatient, setViewingPatient] = useState<AppointmentRecord | null>(null);
  const [dayDetailDate, setDayDetailDate] = useState<string | null>(null);

  // Assign Doctor for Review Modal (also used for Re-assigning)
  const [assignDoctorModal, setAssignDoctorModal] = useState<{
    appointmentId: string;
    patientName?: string;
    isReassign?: boolean;
    currentDoctorName?: string;
    doctorNote?: string;
  } | null>(null);
  const [selectedDoctorId, setSelectedDoctorId] = useState("");

  // Finalize Schedule Modal (Used after Doctor Approval or Reschedule)
  const [finalizeScheduleModal, setFinalizeScheduleModal] = useState<{
    appointmentId: string;
    patientName: string;
    assignedDoctorId?: string;
    assignedDoctorName?: string;
    date: string;
    time: string;
    isReschedule?: boolean;
  } | null>(null);

  // Reject / Decline Modal
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
  const [scheduleError, setScheduleError] = useState("");

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
      if (!item.date || item.status === "rejected" || item.status === "cancelled") return acc;
      if (!acc[item.date]) acc[item.date] = [];
      acc[item.date].push(item);
      return acc;
    }, {});
  }, [appointments]);

  // Queues categorized by review lifecycle
  const incomingQueue = useMemo(() => {
    return appointments
      .filter((a) => a.status !== "cancelled" && a.status !== "rejected" && (a.status === "pending" || a.doctorStatus === "pending-review" || a.doctorStatus === "rejected"))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [appointments]);

  const needsDoctorQueue = useMemo(
    () => incomingQueue.filter((a) => !a.assignedDoctorId && a.doctorStatus !== "rejected"),
    [incomingQueue]
  );
  const inReviewQueue = useMemo(
    () => incomingQueue.filter((a) => a.assignedDoctorId && a.doctorStatus === "pending-review"),
    [incomingQueue]
  );
  const doctorDeclinedQueue = useMemo(
    () => incomingQueue.filter((a) => a.doctorStatus === "rejected"),
    [incomingQueue]
  );
  const approvedQueue = useMemo(
    () => appointments.filter((a) => a.status !== "cancelled" && a.status !== "rejected" && (a.status === "scheduled" || a.status === "confirmed" || a.status === "accepted" || a.doctorStatus === "approved")),
    [appointments]
  );

  const displayedQueue = useMemo(() => {
    if (queueFilter === "needs_doctor") return needsDoctorQueue;
    if (queueFilter === "in_review") return inReviewQueue;
    if (queueFilter === "approved") return approvedQueue;
    if (queueFilter === "doctor_declined") return doctorDeclinedQueue;
    return incomingQueue;
  }, [queueFilter, incomingQueue, needsDoctorQueue, inReviewQueue, approvedQueue, doctorDeclinedQueue]);

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

  const handleMarkArrived = async (id: string) => {
    try {
      await supabase
        .from("patient_appointment")
        .update({ check_in_status: "arrived" })
        .eq("appointment_id", id);
    } catch (err: any) {
      console.error("Failed to update check_in_status in Supabase:", err.message);
    }

    setAppointments((prev) => {
      const next = prev.map((appt) =>
        appt.id === id ? { ...appt, checkInStatus: "arrived" as const } : appt
      );
      try {
        localStorage.setItem("dermai_clinic_appointments", JSON.stringify(next));
        window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
        window.dispatchEvent(new Event("storage"));
      } catch {}
      return next;
    });
  };

  const handleMarkNoShow = async (id: string) => {
    try {
      await supabase
        .from("patient_appointment")
        .update({ check_in_status: "no-show", clinic_note: "Patient was absent / no-show during their consultation batch." })
        .eq("appointment_id", id);
    } catch (err: any) {
      console.error("Failed to update check_in_status in Supabase:", err.message);
    }

    setAppointments((prev) => {
      const next = prev.map((appt) =>
        appt.id === id ? { ...appt, checkInStatus: "no-show" as const, clinicNote: "Patient was absent / no-show." } : appt
      );
      try {
        localStorage.setItem("dermai_clinic_appointments", JSON.stringify(next));
        window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
        window.dispatchEvent(new Event("storage"));
      } catch {}
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

  // 1. Assign doctor for pre-consultation review (or re-assign)
  const handleConfirmDoctorAssignment = async () => {
    if (!assignDoctorModal || !selectedDoctorId) return;
    setAssignError("");

    const doc = clinicDoctors.find((d) => d.id === selectedDoctorId);
    if (!doc) {
      setAssignError("Please select a doctor from your clinic roster.");
      return;
    }

    const isUuid = (id?: string | null): boolean =>
      !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    let targetDoctorId: string | null = isUuid(doc.id) ? doc.id : null;

    if (!targetDoctorId && doc.email) {
      try {
        const { data: dbDoc } = await supabase
          .from("clinic_doctor")
          .select("doctor_id")
          .eq("email", doc.email.trim().toLowerCase())
          .maybeSingle();
        if (dbDoc?.doctor_id && isUuid(dbDoc.doctor_id)) {
          targetDoctorId = dbDoc.doctor_id;
        }
      } catch { }
    }

    if (!targetDoctorId && doc.name) {
      try {
        const { data: dbDoc } = await supabase
          .from("clinic_doctor")
          .select("doctor_id")
          .ilike("doctor_name", `%${doc.name.trim()}%`)
          .maybeSingle();
        if (dbDoc?.doctor_id && isUuid(dbDoc.doctor_id)) {
          targetDoctorId = dbDoc.doctor_id;
        }
      } catch { }
    }

    // Auto-create doctor record in clinic_doctor if not found in database
    let activeClinicId: string | null = clinicId ? String(clinicId) : null;
    if (!activeClinicId) {
      try {
        const cache = localStorage.getItem("dermai_clinic_profile_cache");
        if (cache) {
          const parsed = JSON.parse(cache);
          if (parsed.clinicId) activeClinicId = String(parsed.clinicId);
        }
      } catch { }
    }

    if (!targetDoctorId && activeClinicId && isUuid(activeClinicId)) {
      try {
        // Look up corresponding user record if available
        let linkedUserId: string | null = null;
        if (doc.email) {
          const { data: uRow } = await supabase
            .from("user")
            .select("user_id")
            .eq("email", doc.email.trim().toLowerCase())
            .maybeSingle();
          if (uRow?.user_id) linkedUserId = uRow.user_id;
        }

        const { data: createdDoc, error: createDocErr } = await supabase
          .from("clinic_doctor")
          .insert({
            clinic_id: activeClinicId,
            doctor_name: doc.name.trim(),
            email: doc.email?.trim().toLowerCase() || `${doc.name.toLowerCase().replace(/[^a-z0-9]/g, "")}@clinic.internal`,
            prc_license: (doc as any).prcLicense || "PRC-VERIFIED",
            user_id: linkedUserId,
            status: "Active",
          })
          .select("doctor_id")
          .maybeSingle();
        if (createdDoc?.doctor_id && isUuid(createdDoc.doctor_id)) {
          targetDoctorId = createdDoc.doctor_id;
        } else if (createDocErr) {
          console.error("Failed to auto-create clinic_doctor row:", createDocErr.message);
        }
      } catch (err: any) {
        console.error("Auto-create doctor exception:", err?.message);
      }
    }

    if (!targetDoctorId) {
      setAssignError("Could not link doctor to the clinic database. Please make sure the doctor is registered in the Doctors roster.");
      return;
    }

    const clinicNoteMsg = assignDoctorModal.isReassign
      ? `Re-assigned to Dr. ${doc.name.replace(/^dr\.\s*/i, "")} for review.`
      : `Assigned to Dr. ${doc.name.replace(/^dr\.\s*/i, "")} for pre-consultation review.`;

    const updatePayload: Record<string, any> = {
      assigned_doctor_id: targetDoctorId,
      doctor_status: "pending-review",
      doctor_note: null,
      doctor_reviewed_at: null,
      clinic_note: clinicNoteMsg,
    };

    try {
      const { error: updateErr } = await supabase
        .from("patient_appointment")
        .update(updatePayload)
        .eq("appointment_id", assignDoctorModal.appointmentId);

      if (updateErr) {
        console.error("Failed to assign doctor in Supabase:", updateErr.message);
        setAssignError(`Failed to save doctor assignment: ${updateErr.message}`);
        return;
      }
    } catch (err: any) {
      console.error("Failed to assign doctor in Supabase:", err.message);
      setAssignError(err.message || "An error occurred while saving doctor assignment.");
      return;
    }

    setAppointments((prev) => {
      const next = prev.map((a) => {
        if (a.id !== assignDoctorModal.appointmentId) return a;
        return {
          ...a,
          assignedDoctorId: targetDoctorId || doc.id,
          assignedDoctorName: doc.name,
          doctorStatus: "pending-review" as const,
          doctorNote: undefined,
          doctorReviewedAt: undefined,
          clinicNote: clinicNoteMsg,
        };
      });
      try {
        localStorage.setItem("dermai_clinic_appointments", JSON.stringify(next));
        window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
        window.dispatchEvent(new Event("storage"));
      } catch { }
      return next;
    });

    setAssignDoctorModal(null);
    setSelectedDoctorId("");
    setAssignError("");
    setQueueFilter("in_review");
  };

  // 2. Finalize schedule after doctor approval (or reschedule existing)
  const handleConfirmFinalizeSchedule = async () => {
    if (!finalizeScheduleModal) return;
    setScheduleError("");

    if (!finalizeScheduleModal.date) {
      setScheduleError("Please select a consultation date.");
      return;
    }
    if (!finalizeScheduleModal.time) {
      setScheduleError("Please select a consultation time.");
      return;
    }

    if (
      finalizeScheduleModal.time < clinicSettings.openTime ||
      finalizeScheduleModal.time > clinicSettings.closeTime
    ) {
      setScheduleError(
        `Time must be between ${clinicSettings.openTime} and ${clinicSettings.closeTime}.`
      );
      return;
    }

    const appt = appointments.find((a) => a.id === finalizeScheduleModal.appointmentId);
    const doctorDisplayName = finalizeScheduleModal.assignedDoctorName || appt?.assignedDoctorName || "Doctor";

    try {
      const { error: updateErr } = await supabase
        .from("patient_appointment")
        .update({
          status: "confirmed",
          date: `${finalizeScheduleModal.date}T${finalizeScheduleModal.time}:00+08:00`,
          schedule_sent_to_doctor: true,
          clinic_note: `Consultation schedule confirmed for ${finalizeScheduleModal.date} at ${finalizeScheduleModal.time} with Dr. ${doctorDisplayName.replace(/^dr\.\s*/i, "")}.`,
        })
        .eq("appointment_id", finalizeScheduleModal.appointmentId);

      if (updateErr) {
        console.error("Failed to finalize schedule in Supabase:", updateErr.message);
      }
    } catch (err: any) {
      console.error("Failed to finalize schedule in Supabase:", err.message);
    }

    setAppointments((prev) => {
      const next = prev.map((item) => {
        if (item.id !== finalizeScheduleModal.appointmentId) return item;
        return {
          ...item,
          date: finalizeScheduleModal.date,
          time: finalizeScheduleModal.time,
          status: "scheduled" as const,
          scheduleSentToDoctor: true,
          clinicNote: `Consultation schedule confirmed for ${finalizeScheduleModal.date} at ${finalizeScheduleModal.time} with Dr. ${doctorDisplayName.replace(/^dr\.\s*/i, "")}.`,
        };
      });
      try {
        localStorage.setItem("dermai_clinic_appointments", JSON.stringify(next));
        window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
        window.dispatchEvent(new Event("storage"));
      } catch { }
      return next;
    });

    setFinalizeScheduleModal(null);
    setScheduleError("");
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
        <div className="flex items-center gap-2 flex-wrap">
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
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          { label: "Total Requests", value: appointments.length, icon: Calendar },
          { label: "Queue", value: incomingQueue.length, icon: Clock },
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
                      src={
                        appointment.patientAvatar ||
                        (appointment.patientName
                          ? `https://ui-avatars.com/api/?name=${encodeURIComponent(appointment.patientName)}&background=fdf2f8&color=be185d`
                          : fallbackConditionImage)
                      }
                      alt={appointment.patientName || "Patient"}
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
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <h2 className="font-display font-bold text-gray-900 text-base">Incoming Consultation Queue</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Assign a doctor for review &rarr; Doctor accepts &rarr; Schedule finalized automatically.
              </p>
            </div>
            <span className="text-xs px-3 py-1 rounded-full bg-magenta-50 text-magenta-700 border border-magenta-200 font-bold shrink-0 whitespace-nowrap inline-flex items-center gap-1 self-start">
              {incomingQueue.length} pending
            </span>
          </div>

          {/* Queue Stage Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-3 pt-1 text-xs no-scrollbar">
            {[
              { key: "all", label: "All Incoming", count: incomingQueue.length },
              { key: "needs_doctor", label: "Needs Doctor", count: needsDoctorQueue.length, alert: needsDoctorQueue.length > 0 },
              { key: "in_review", label: "In Review", count: inReviewQueue.length },
              { key: "doctor_declined", label: "Doctor Declined", count: doctorDeclinedQueue.length, warn: doctorDeclinedQueue.length > 0 },
              { key: "approved", label: "Confirmed / Scheduled", count: approvedQueue.length, highlight: approvedQueue.length > 0 },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setQueueFilter(tab.key as any)}
                className={`px-3 py-1.5 rounded-xl font-semibold shrink-0 transition-all flex items-center gap-1.5 cursor-pointer ${
                  queueFilter === tab.key
                    ? "bg-magenta-600 text-white shadow-xs"
                    : tab.highlight
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                    : tab.warn
                    ? "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
                    : tab.alert
                    ? "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                <span>{tab.label}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                  queueFilter === tab.key ? "bg-white/20 text-white" : "bg-white/80 text-gray-700"
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          <div className="space-y-3 max-h-[660px] overflow-y-auto pr-1">
            {displayedQueue.length === 0 && (
              <div className="border border-dashed border-gray-200 rounded-2xl p-8 text-center bg-gray-50/50">
                <Clock className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-xs font-semibold text-gray-600">No requests in this queue category</p>
                <p className="text-[11px] text-gray-400 mt-1 max-w-xs mx-auto">
                  {queueFilter === "needs_doctor"
                    ? "All consultation requests have been assigned to doctors for review."
                    : queueFilter === "approved"
                    ? "No approved or confirmed appointments yet."
                    : queueFilter === "doctor_declined"
                    ? "No doctor rejections requiring re-assignment."
                    : "Incoming consultation requests will appear here."}
                </p>
              </div>
            )}

            {displayedQueue.map((appointment) => {
              const hasDoctor = Boolean(appointment.assignedDoctorId || appointment.assignedDoctorName);
              const isApproved = appointment.doctorStatus === "approved" || appointment.status === "scheduled" || appointment.status === "confirmed";
              const isDoctorDeclined = appointment.doctorStatus === "rejected";
              const isInReview = hasDoctor && !isApproved && !isDoctorDeclined;
              const isUnassigned = !hasDoctor && !isApproved && !isDoctorDeclined;

              return (
                <div
                  key={appointment.id}
                  className={`rounded-2xl border p-4 transition-all ${
                    isApproved
                      ? "border-emerald-200 bg-emerald-50/30"
                      : isDoctorDeclined
                      ? "border-red-200 bg-red-50/30"
                      : isInReview
                      ? "border-blue-100 bg-blue-50/20"
                      : "border-amber-100 bg-amber-50/20"
                  }`}
                >
                  <div className="flex items-start gap-3 mb-2.5">
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
                          <p className="text-sm font-bold text-gray-900">
                            {appointment.patientName || `Queue #${appointment.id.slice(-4)}`}
                          </p>
                          {appointment.patientAge && (
                            <p className="text-[10px] text-gray-400">{appointment.patientAge} years old</p>
                          )}
                          <p className="text-[11px] font-semibold text-magenta-600 mt-0.5">
                            {appointment.conditionName || "General Consultation"}
                          </p>
                          <p className="text-[10px] text-gray-400">
                            Requested: {new Date(appointment.createdAt).toLocaleString("en-US", {
                              month: "short",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>

                        {/* Status Badge */}
                        <div className="shrink-0">
                          {isUnassigned && (
                            <span className="text-[10px] px-2.5 py-1 rounded-full font-bold bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1">
                              <Clock className="w-3 h-3" /> Needs Doctor
                            </span>
                          )}
                          {isInReview && (
                            <span className="text-[10px] px-2.5 py-1 rounded-full font-bold bg-blue-100 text-blue-800 border border-blue-200 flex items-center gap-1">
                              <Stethoscope className="w-3 h-3" /> In Review
                            </span>
                          )}
                          {isApproved && (
                            <span className="text-[10px] px-2.5 py-1 rounded-full font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Confirmed &amp; Locked
                            </span>
                          )}
                          {isDoctorDeclined && (
                            <span className="text-[10px] px-2.5 py-1 rounded-full font-bold bg-red-100 text-red-800 border border-red-200 flex items-center gap-1">
                              <XCircle className="w-3 h-3 text-red-600" /> Doctor Declined
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Patient Requested Schedule Banner with Queue Badge */}
                  <div className="mb-2.5 p-2 rounded-xl bg-magenta-50/70 border border-magenta-100 flex items-center justify-between text-xs flex-wrap gap-1.5">
                    <div className="flex items-center gap-1.5 font-bold text-magenta-950">
                      <Calendar className="w-3.5 h-3.5 text-magenta-600" />
                      <span>{appointment.date || "Date pending"} {appointment.batchTime ? `· ${appointment.batchTime} Batch` : appointment.time ? `· ${appointment.time}` : ""}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="px-2 py-0.5 rounded-full bg-magenta-600 text-white font-bold text-[10px] shadow-2xs">
                        Queue #{appointment.queueNumber || 1}
                      </span>
                      {appointment.checkInStatus === "arrived" ? (
                        <span className="px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-800 font-bold text-[9px] flex items-center gap-0.5">
                          <span className="w-1 h-1 rounded-full bg-sky-500 inline-block" /> In Lobby
                        </span>
                      ) : appointment.checkInStatus === "in-consultation" ? (
                        <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[9px] flex items-center gap-0.5 animate-pulse">
                          <span className="w-1 h-1 rounded-full bg-emerald-500 inline-block" /> In Room
                        </span>
                      ) : appointment.checkInStatus === "no-show" ? (
                        <span className="px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold text-[9px]">
                          Absent / No-Show
                        </span>
                      ) : isApproved ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleMarkArrived(appointment.id)}
                            className="px-2 py-0.5 rounded-full bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-[10px] border border-emerald-200 transition-colors cursor-pointer"
                          >
                            ✓ Mark Arrived
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMarkNoShow(appointment.id)}
                            className="px-1.5 py-0.5 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-[10px] border border-rose-200 transition-colors cursor-pointer"
                            title="Mark patient as absent / no-show"
                          >
                            No-Show
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* Stage Workflow Banners */}
                  {isApproved && (
                    <div className="mb-2.5 p-2.5 rounded-xl bg-emerald-100/70 border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span className="font-medium truncate">
                          <strong>{formatDoctorDisplay(appointment.assignedDoctorName) || "Doctor"} accepted!</strong> Schedule confirmed &amp; finalized.
                        </span>
                      </div>
                    </div>
                  )}

                  {isDoctorDeclined && (
                    <div className="mb-2.5 p-2.5 rounded-xl bg-red-100/70 border border-red-200 text-xs text-red-900 flex items-start gap-2">
                      <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-bold">Declined by {formatDoctorDisplay(appointment.assignedDoctorName) || "Doctor"}:</p>
                        <p className="text-[11px] text-red-700 italic mt-0.5">
                          "{appointment.doctorNote || "Doctor unavailable for consultation"}"
                        </p>
                        <p className="text-[10px] text-red-600 mt-1 font-semibold">
                          &rarr; Please re-assign to another doctor or decline the request.
                        </p>
                      </div>
                    </div>
                  )}

                  {isInReview && (
                    <div className="mb-2.5 p-2 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-800 flex items-center gap-1.5">
                      <Stethoscope className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      <span className="font-medium">
                        Assigned to <strong>{formatDoctorDisplay(appointment.assignedDoctorName) || "Doctor"}</strong> for pre-consultation review.
                      </span>
                    </div>
                  )}

                  {appointment.notes && (
                    <p className="text-[11px] text-gray-600 bg-white/80 border border-gray-100 rounded-lg px-2.5 py-1.5 mb-2.5 line-clamp-2">
                      <strong className="text-gray-700">Patient Note:</strong> {appointment.notes}
                    </p>
                  )}

                  {/* Contextual Action Buttons */}
                  <div className="pt-1 flex items-center gap-2 flex-wrap">
                    {/* Scenario A: Unassigned -> Assign Doctor for Review */}
                    {isUnassigned && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDoctorId("");
                            setAssignDoctorModal({
                              appointmentId: appointment.id,
                              patientName: appointment.patientName,
                            });
                          }}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-magenta-600 hover:bg-magenta-700 text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
                        >
                          <Stethoscope className="w-3.5 h-3.5" /> Assign Doctor for Review
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewingPatient(appointment)}
                          className="py-2.5 px-4 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold transition-colors cursor-pointer"
                        >
                          Details
                        </button>
                      </>
                    )}

                    {/* Scenario B: Under Doctor Review -> View Details / Reassign */}
                    {isInReview && (
                      <>
                        <button
                          type="button"
                          onClick={() => setViewingPatient(appointment)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-semibold transition-colors cursor-pointer"
                        >
                          <User className="w-3.5 h-3.5" /> View Details
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDoctorId("");
                            setAssignDoctorModal({
                              appointmentId: appointment.id,
                              patientName: appointment.patientName,
                              isReassign: true,
                              currentDoctorName: appointment.assignedDoctorName,
                            });
                          }}
                          className="py-2.5 px-3.5 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold transition-colors cursor-pointer"
                        >
                          Change Doctor
                        </button>
                      </>
                    )}

                    {/* Scenario C: Doctor Approved -> Confirmed & Finalized */}
                    {isApproved && (
                      <>
                        <button
                          type="button"
                          onClick={() => setViewingPatient(appointment)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Confirmed Details
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFinalizeScheduleModal({
                              appointmentId: appointment.id,
                              patientName: appointment.patientName || "Patient",
                              assignedDoctorId: appointment.assignedDoctorId,
                              assignedDoctorName: appointment.assignedDoctorName,
                              date: appointment.date || selectedDate,
                              time: appointment.time || clinicSettings.openTime,
                              isReschedule: true,
                            });
                            setScheduleError("");
                          }}
                          className="py-2.5 px-3.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold transition-colors cursor-pointer"
                        >
                          Reschedule
                        </button>
                      </>
                    )}

                    {/* Scenario D: Doctor Declined -> RE-ASSIGN DOCTOR OR DECLINE REQUEST */}
                    {isDoctorDeclined && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDoctorId("");
                            setAssignDoctorModal({
                              appointmentId: appointment.id,
                              patientName: appointment.patientName,
                              isReassign: true,
                              currentDoctorName: appointment.assignedDoctorName,
                              doctorNote: appointment.doctorNote,
                            });
                          }}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
                        >
                          <Stethoscope className="w-3.5 h-3.5" /> Re-assign Doctor
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRejectModal({
                              appointmentId: appointment.id,
                              patientName: appointment.patientName || "Patient",
                              clinicName: appointment.clinicName || clinicName,
                              patientEmail: appointment.patientEmail,
                            });
                            setRejectReason(appointment.doctorNote ? `Declined by doctor: ${appointment.doctorNote}` : "Doctor unavailable.");
                            setSelectedPresetReason("");
                            setRejectError("");
                          }}
                          className="py-2.5 px-3 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors shadow-xs cursor-pointer"
                        >
                          Decline Request
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewingPatient(appointment)}
                          className="py-2.5 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold transition-colors cursor-pointer"
                        >
                          Details
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 rounded-xl bg-gray-50 border border-gray-100 p-3 text-[11px] text-gray-600">
            <p className="font-bold text-gray-900 mb-1">Appointment Approval Workflow</p>
            <p>1. Assign doctor for review &rarr; 2. Attending doctor decides (Approve/Decline) &rarr; 3. If approved, clinic finalizes schedule date &amp; time. If declined, clinic re-assigns or declines request.</p>
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
                            setFinalizeScheduleModal({
                              appointmentId: appt.id,
                              patientName: appt.patientName || "Patient",
                              assignedDoctorId: appt.assignedDoctorId,
                              assignedDoctorName: appt.assignedDoctorName,
                              date: appt.date || selectedDate,
                              time: appt.time || clinicSettings.openTime,
                              isReschedule: true,
                            });
                            setScheduleError("");
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
            {/* Header */}
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
              {/* Doctor Review Status Summary */}
              {viewingPatient.assignedDoctorName && (
                <div className={`p-3 rounded-2xl border ${
                  viewingPatient.doctorStatus === "approved"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                    : viewingPatient.doctorStatus === "rejected"
                    ? "bg-red-50 border-red-200 text-red-900"
                    : "bg-blue-50 border-blue-200 text-blue-900"
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider">Attending Doctor</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                      viewingPatient.doctorStatus === "approved"
                        ? "bg-emerald-200 text-emerald-800"
                        : viewingPatient.doctorStatus === "rejected"
                        ? "bg-red-200 text-red-800"
                        : "bg-blue-200 text-blue-800"
                    }`}>
                      {viewingPatient.doctorStatus === "approved"
                        ? "Approved"
                        : viewingPatient.doctorStatus === "rejected"
                        ? "Declined"
                        : "Reviewing"}
                    </span>
                  </div>
                  <p className="text-xs font-bold mt-1">Dr. {viewingPatient.assignedDoctorName.replace(/^dr\.\s*/i, "")}</p>
                  {viewingPatient.doctorNote && (
                    <p className="text-[11px] mt-1 italic">
                      Note: "{viewingPatient.doctorNote}"
                    </p>
                  )}
                </div>
              )}

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
                      {
                        label: "Emergency Contact",
                        value: viewingPatient.emergencyContactName
                          ? `${viewingPatient.emergencyContactName} ${viewingPatient.emergencyRelationship ? `(${viewingPatient.emergencyRelationship})` : ""} - ${viewingPatient.emergencyContactPhone || ""}`
                          : undefined,
                      },
                    ] as { label: string; value?: string }[]
                  ).map(({ label, value }) => (
                    <div key={label} className="grid grid-cols-[120px_1fr] items-center text-xs">
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
                    <LazySkinPhoto
                      pathOrUrl={viewingPatient.skinPhotoUrl}
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

            {/* Contextual Footer actions */}
            <div className="px-6 pb-5 pt-3 border-t border-gray-100 bg-white">
              {viewingPatient.status === "scheduled" ? (
                <button
                  type="button"
                  onClick={() => setViewingPatient(null)}
                  className="w-full py-3 rounded-full border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  Close
                </button>
              ) : viewingPatient.doctorStatus === "approved" ? (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setRejectModal({
                        appointmentId: viewingPatient.id,
                        patientName: viewingPatient.patientName || "Patient",
                        clinicName: viewingPatient.clinicName || clinicName,
                        patientEmail: viewingPatient.patientEmail,
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
                      const apptToFinalize = viewingPatient;
                      setViewingPatient(null);
                      setFinalizeScheduleModal({
                        appointmentId: apptToFinalize.id,
                        patientName: apptToFinalize.patientName || "Patient",
                        assignedDoctorId: apptToFinalize.assignedDoctorId,
                        assignedDoctorName: apptToFinalize.assignedDoctorName,
                        date: apptToFinalize.date || selectedDate,
                        time: apptToFinalize.time || clinicSettings.openTime,
                      });
                      setScheduleError("");
                    }}
                    className="py-3 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer"
                  >
                    Finalize Schedule
                  </button>
                </div>
              ) : viewingPatient.doctorStatus === "rejected" ? (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setRejectModal({
                        appointmentId: viewingPatient.id,
                        patientName: viewingPatient.patientName || "Patient",
                        clinicName: viewingPatient.clinicName || clinicName,
                        patientEmail: viewingPatient.patientEmail,
                      });
                      setRejectReason(viewingPatient.doctorNote ? `Doctor declined: ${viewingPatient.doctorNote}` : "Declined by clinic.");
                      setSelectedPresetReason("");
                      setRejectError("");
                      setViewingPatient(null);
                    }}
                    className="py-3 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer"
                  >
                    Confirm Decline
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const apptToReassign = viewingPatient;
                      setViewingPatient(null);
                      setSelectedDoctorId("");
                      setAssignDoctorModal({
                        appointmentId: apptToReassign.id,
                        patientName: apptToReassign.patientName,
                        isReassign: true,
                        currentDoctorName: apptToReassign.assignedDoctorName,
                        doctorNote: apptToReassign.doctorNote,
                      });
                    }}
                    className="py-3 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer"
                  >
                    Re-assign Doctor
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setRejectModal({
                        appointmentId: viewingPatient.id,
                        patientName: viewingPatient.patientName || "Patient",
                        clinicName: viewingPatient.clinicName || clinicName,
                        patientEmail: viewingPatient.patientEmail,
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
                      const apptToAssign = viewingPatient;
                      setViewingPatient(null);
                      setSelectedDoctorId("");
                      setAssignDoctorModal({
                        appointmentId: apptToAssign.id,
                        patientName: apptToAssign.patientName,
                        isReassign: !!apptToAssign.assignedDoctorId,
                        currentDoctorName: apptToAssign.assignedDoctorName,
                      });
                    }}
                    className="py-3 rounded-full bg-magenta-600 hover:bg-magenta-700 text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer"
                  >
                    {viewingPatient.assignedDoctorId ? "Change Doctor" : "Assign Doctor for Review"}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* ── Finalize Schedule Modal (After Doctor Approval) ─────────────────────── */}
      {finalizeScheduleModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-md bg-white rounded-3xl border border-gray-100 shadow-2xl p-6 text-left"
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-600" />
                {finalizeScheduleModal.isReschedule ? "Reschedule Consultation" : "Finalize Consultation Schedule"}
              </h3>
              <button
                type="button"
                onClick={() => setFinalizeScheduleModal(null)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Patient: <strong className="text-gray-800">{finalizeScheduleModal.patientName}</strong>
              {finalizeScheduleModal.assignedDoctorName && (
                <span> &bull; Attending: <strong className="text-gray-800">Dr. {finalizeScheduleModal.assignedDoctorName.replace(/^dr\.\s*/i, "")}</strong></span>
              )}
            </p>

            {scheduleError && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-600 font-medium">
                {scheduleError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Consultation Date</label>
                <input
                  type="date"
                  value={finalizeScheduleModal.date}
                  onChange={(e) =>
                    setFinalizeScheduleModal((prev) =>
                      prev ? { ...prev, date: e.target.value } : prev
                    )
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 transition-all bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Consultation Time</label>
                <input
                  type="time"
                  value={finalizeScheduleModal.time}
                  onChange={(e) =>
                    setFinalizeScheduleModal((prev) =>
                      prev ? { ...prev, time: e.target.value } : prev
                    )
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 transition-all bg-white"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  Operating hours: {clinicSettings.openTime} &ndash; {clinicSettings.closeTime}
                </p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setFinalizeScheduleModal(null)}
                className="py-3 rounded-full border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmFinalizeSchedule}
                className="py-3 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer"
              >
                Confirm &amp; Schedule
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* ── Assign Doctor for Review Modal (also used for Re-assigning) ─────────────────────── */}
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
                <Stethoscope className="w-4 h-4 text-magenta-600" />
                {assignDoctorModal.isReassign ? "Re-assign Doctor" : "Assign Doctor for Review"}
              </h3>
              <button
                type="button"
                onClick={() => { setAssignDoctorModal(null); setSelectedDoctorId(""); setAssignError(""); }}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              {assignDoctorModal.isReassign
                ? `Select a new doctor to review this patient consultation request.`
                : `Select a doctor to review this patient's case and approve the consultation.`}
            </p>

            {assignDoctorModal.doctorNote && (
              <div className="mb-3 p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
                <strong>Previous Doctor's Note:</strong> "{assignDoctorModal.doctorNote}"
              </div>
            )}

            {assignError && (
              <div className="mb-3 p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-600 font-medium">
                {assignError}
              </div>
            )}

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
                    className={`w-full text-left px-3.5 py-2.5 rounded-2xl border text-xs transition-colors cursor-pointer flex items-center gap-3 ${selectedDoctorId === doc.id
                      ? "border-magenta-500 bg-magenta-50/50 text-magenta-900 ring-2 ring-magenta-500/20 shadow-xs"
                      : "border-gray-200 hover:border-gray-300 bg-white"
                      }`}
                  >
                    {doc.photo ? (
                      <img
                        src={doc.photo}
                        alt={doc.name}
                        className="w-9 h-9 rounded-xl object-cover border border-magenta-200 shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-xl bg-magenta-100 text-magenta-700 font-bold flex items-center justify-center text-xs shrink-0">
                        {doc.name.replace(/^(?:dr\.?|doctor)\s*/i, "").trim().charAt(0) || "D"}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-gray-900 truncate">{doc.name}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5 truncate">{doc.specialization}</p>
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => { setAssignDoctorModal(null); setSelectedDoctorId(""); setAssignError(""); }}
                className="py-2.5 rounded-full border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDoctorAssignment}
                disabled={!selectedDoctorId}
                className="py-2.5 rounded-full bg-magenta-600 text-white text-xs font-semibold hover:bg-magenta-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-xs cursor-pointer"
              >
                {assignDoctorModal.isReassign ? "Re-assign" : "Assign for Review"}
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
                  "Doctor unavailable for the requested consultation",
                  "Clinic has reached full capacity for consultations",
                  "Condition requires specialized tertiary hospital facility",
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
