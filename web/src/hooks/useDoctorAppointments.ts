import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { logAuditEvent } from "@/utils/auditLogger";
import { resolveAvatarUrl } from "@/utils/storage";
import { createPatientNotification } from "@/lib/notificationService";
import type { AppointmentHistoryEntry } from "@/lib/schedulingService";
import { compareDoctorAppointments, scopeDoctorAppointments } from "@/lib/doctorAppointmentScope";
import { useDoctorClinicContext } from "@/components/layout/doctorLayout";

export type DoctorAppointmentRecord = {
  id: string;
  clinicId?: string;
  clinicName: string;
  patientName: string;
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
  conditionId?: string;
  conditionName?: string;
  conditionImage?: string;
  date: string;
  time: string;
  notes: string;
  clinicNote?: string;
  status: "pending" | "confirmed" | "scheduled" | "rejected" | "completed" | "cancelled";
  assignedDoctorId?: string;
  assignedDoctorName?: string;
  isAssignedToMe?: boolean;
  doctorStatus?: "pending-review" | "approved" | "rejected";
  doctorNote?: string;
  doctorDiagnosis?: string;
  doctorReviewedAt?: string;
  scheduleSentToDoctor?: boolean;
  doctorDone?: boolean;
  createdAt: string;
  skinPhotoUrl?: string;
  aiConditionName?: string;
  aiConfidence?: number;
  queueNumber?: number;
  batchTime?: string;
  checkInStatus?: "scheduled" | "arrived" | "in-consultation" | "completed" | "no-show";
  isWalkIn?: boolean;
  questionnaireAnswers?: Array<{
    id?: string;
    question: string;
    answer: string;
    severity?: number | null;
  }>;
  userId?: string;
  appointmentHistory?: AppointmentHistoryEntry[];
};

function calculateAgeFromBirthdate(birthdateStr?: string | null): number | undefined {
  if (!birthdateStr) return undefined;
  try {
    const bday = new Date(birthdateStr);
    if (isNaN(bday.getTime())) return undefined;
    const today = new Date();
    let age = today.getFullYear() - bday.getFullYear();
    const m = today.getMonth() - bday.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < bday.getDate())) {
      age--;
    }
    return age >= 0 && age < 130 ? age : undefined;
  } catch {
    return undefined;
  }
}


export function useDoctorAppointments() {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState<DoctorAppointmentRecord[]>([]);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [doctorName, setDoctorName] = useState<string>(() => {
    try {
      const p = localStorage.getItem("dermai_doctor_profile");
      if (p) {
        const parsed = JSON.parse(p);
        if (parsed?.fullName) return parsed.fullName;
      }
    } catch {}
    return user?.user_metadata?.full_name || user?.email?.split("@")[0] || "";
  });
  const [doctorEmail, setDoctorEmail] = useState<string>(user?.email || "");
  const [doctorIds, setDoctorIds] = useState<string[]>([]);
  const clinicDoctorIdRef = useRef<string | null>(null);
  const clinicDoctorsMapRef = useRef<Map<string, string>>(new Map());

  // Keep a ref to the active clinic so fetchAppointments (a useCallback) can
  // read the latest value without being re-created on every context change.
  const { activeClinicId: activeClinicContextId } = useDoctorClinicContext();
  const activeClinicIdRef = useRef<string>(activeClinicContextId);
  activeClinicIdRef.current = activeClinicContextId;
  const currentUserIdRef = useRef(user?.id);
  currentUserIdRef.current = user?.id;

  const isFetchingRef = useRef(false);
  const queuedRefetchRef = useRef(false);
  const latestFetchRef = useRef<() => Promise<void>>(async () => {});

  const fetchAppointments = useCallback(async () => {
    if (isFetchingRef.current) {
      queuedRefetchRef.current = true;
      return;
    }
    isFetchingRef.current = true;
    setLoading(true);
    const requestUserId = user?.id;
    const currentActiveClinicId = activeClinicIdRef.current;

    try {
      if (!user?.id || !currentActiveClinicId) {
        setAppointments([]);
        setDoctorIds([]);
        return;
      }
      // 1. Identify doctor accounts linked to current user
      const userEmail = (user?.email || "").trim().toLowerCase();
      setDoctorEmail(userEmail);

      const foundDoctorIds: string[] = user?.id ? [String(user.id)] : [];
      let docDisplayName = user?.user_metadata?.full_name || user?.user_metadata?.name || "";
      const clinicNameMap = new Map<string, string>();
      const authorizedClinicIds = new Set<string>();
      const clinicDoctorsMap = new Map<string, string>();

      // Retrieve all affiliations associated with the logged-in doctor
      try {
        const { data: cdRows, error: cdErr } = await supabase
          .from("clinic_doctor")
          .select("doctor_id, clinic_id, doctor_name, clinic:clinic_id(clinic_id, name)")
          .eq("user_id", user.id)
          .eq("clinic_id", currentActiveClinicId)
          .ilike("status", "active");
        if (cdErr) throw cdErr;
        if (cdRows && cdRows.length > 0) {
          for (const cd of cdRows as any[]) {
            if (cd.clinic_id) authorizedClinicIds.add(String(cd.clinic_id));
            if (cd.doctor_id) {
              foundDoctorIds.push(String(cd.doctor_id));
              clinicDoctorIdRef.current = String(cd.doctor_id);
              if (cd.doctor_name) {
                clinicDoctorsMap.set(String(cd.doctor_id), cd.doctor_name);
              }
            }
            if (cd.doctor_name && !docDisplayName) {
              docDisplayName = cd.doctor_name;
            }
            const cObj = Array.isArray(cd.clinic) ? cd.clinic[0] : cd.clinic;
            if (cd.clinic_id && cObj?.name) {
              clinicNameMap.set(String(cd.clinic_id), cObj.name);
            }
          }
        }
      } catch (e) {
        throw e;
      }

      clinicDoctorsMapRef.current = clinicDoctorsMap;

      const uniqueDoctorIds = Array.from(new Set(foundDoctorIds.filter(Boolean)));
      setDoctorIds(uniqueDoctorIds);
      setDoctorName(docDisplayName);

      const affiliatedClinicIds = Array.from(authorizedClinicIds);

      // 2. Fetch appointments only for the selected, verified clinic
      const apptMap = new Map<string, DoctorAppointmentRecord>();

      try {
        const primaryData: any[] = [];
        const pageSize = 500;
        for (let offset = 0; ; offset += pageSize) {
          const apptQuery = supabase.from("patient_appointment").select("*, clinic:clinic_id(clinic_id, name)");
          const hasScope = scopeDoctorAppointments(
            apptQuery,
            currentActiveClinicId, affiliatedClinicIds, uniqueDoctorIds,
          );
          if (!hasScope) break;
          const { data, error } = await apptQuery
            .order("date", { ascending: true, nullsFirst: false })
            .order("appointment_id", { ascending: true })
            .range(offset, offset + pageSize - 1);
          if (error) throw error;
          primaryData.push(...(data || []));
          if (!data || data.length < pageSize) break;
        }

        if (primaryData.length > 0) {
          // Collect user_ids to enrich missing patient profile info
          const userIdsToFetch = Array.from(
            new Set((primaryData as any[]).map((r) => r.user_id).filter(Boolean))
          );
          const userProfileMap = new Map<string, any>();
          if (userIdsToFetch.length > 0) {
            try {
              const { data: userData } = await supabase
                .from("user")
                .select("user_id, full_name, email, phone, gender, birthdate, address, avatar_url")
                .in("user_id", userIdsToFetch);
              if (userData) {
                userData.forEach((u: any) => userProfileMap.set(u.user_id, u));
              }
            } catch {}
          }

          for (const row of primaryData as any[]) {
            const rawAssignedDoc = row.assigned_doctor_id ? String(row.assigned_doctor_id) : "";
            const rowClinicId = row.clinic_id ? String(row.clinic_id) : "";

            const isDirectDocMatch = Boolean(
              rawAssignedDoc &&
              uniqueDoctorIds.some((id) => String(id).toLowerCase().trim() === rawAssignedDoc.toLowerCase().trim())
            );

            const isClinicMatch = Boolean(
              rowClinicId && affiliatedClinicIds.includes(rowClinicId)
            );

            // Exclude temporary unpaid holds or expired/failed payment holds from doctor views
            const paySt = String(row.payment_status || "").toLowerCase().trim();
            if (paySt === "pending_hold" || paySt === "expired" || paySt === "failed" || paySt === "cancelled") {
              continue;
            }

            // Doctors only see appointments explicitly assigned to THEM (or unassigned clinic queue requests)
            if (rawAssignedDoc && !isDirectDocMatch) {
              continue;
            }
            if (!isClinicMatch) {
              continue;
            }

            const assignedDocName = rawAssignedDoc
              ? (clinicDoctorsMap.get(rawAssignedDoc) || (isDirectDocMatch ? docDisplayName : undefined))
              : undefined;

            {
              const userProf = row.user_id ? userProfileMap.get(row.user_id) : null;

              // Keep original storage path; signed URLs are generated on-demand when viewed
              const photoUrl = row.skin_photo_url || undefined;

              const rawDate = row.date;
              let dateStr = "";
              let timeStr = "";
              if (rawDate) {
                const d = new Date(rawDate);
                if (!isNaN(d.getTime())) {
                  const dFormatter = new Intl.DateTimeFormat("en-CA", {
                    timeZone: "Asia/Manila",
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                  });
                  dateStr = dFormatter.format(d);
                  const tFormatter = new Intl.DateTimeFormat("en-GB", {
                    timeZone: "Asia/Manila",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  });
                  timeStr = tFormatter.format(d);
                } else if (typeof rawDate === "string") {
                  if (rawDate.includes("T")) {
                    const parts = rawDate.split("T");
                    dateStr = parts[0];
                    timeStr = parts[1].slice(0, 5);
                  } else {
                    dateStr = rawDate;
                  }
                }
              }

              if (row.time) timeStr = String(row.time);

              // Extract doctor diagnosis and note if formatted
              let docDiagnosis = "";
              let docCleanNote = "";
              if (row.doctor_note) {
                const match = row.doctor_note.match(/^Diagnosis:\s*([^|\n]+)(?:[|\n]\s*(?:Note:\s*)?(.*))?$/is);
                if (match) {
                  docDiagnosis = match[1]?.trim() || "";
                  docCleanNote = match[2]?.trim() || "";
                } else {
                  docDiagnosis = row.doctor_note.trim();
                  docCleanNote = "";
                }
              }

              const resolvedName = row.patient_name || userProf?.full_name || "";
              const resolvedEmail = row.patient_email || userProf?.email || "";
              const resolvedPhone = row.patient_contact || userProf?.phone || "";
              const resolvedAddress = row.patient_address || userProf?.address || "";
              const resolvedGender = row.patient_gender || userProf?.gender || undefined;
              const resolvedBirthdate = row.patient_birthdate || userProf?.birthdate || undefined;
              const calculatedAge = calculateAgeFromBirthdate(resolvedBirthdate);

              // Parse questionnaire answers if JSON string or array or object
              let qAnswers: any[] | undefined = undefined;
              if (Array.isArray(row.questionnaire_answers)) {
                qAnswers = row.questionnaire_answers;
              } else if (row.questionnaire_answers && typeof row.questionnaire_answers === "object" && Array.isArray(row.questionnaire_answers.answers)) {
                qAnswers = row.questionnaire_answers.answers;
              } else if (typeof row.questionnaire_answers === "string") {
                try {
                  const parsed = JSON.parse(row.questionnaire_answers);
                  if (Array.isArray(parsed)) {
                    qAnswers = parsed;
                  } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.answers)) {
                    qAnswers = parsed.answers;
                  }
                } catch {}
              }

              let resolvedAvatar: string | undefined = undefined;
              if (userProf?.avatar_url && !userProf.avatar_url.includes("scan-uploads")) {
                resolvedAvatar = userProf.avatar_url;
              } else if (row.patient_avatar) {
                resolvedAvatar = row.patient_avatar;
              }
              if (!resolvedAvatar && row.user_id) {
                try {
                  const local = localStorage.getItem(`derm_profile_${row.user_id}`);
                  if (local) {
                    const parsed = JSON.parse(local);
                    resolvedAvatar = parsed.profilePicture || parsed.avatar_url || undefined;
                  }
                } catch {}
              }
              if (resolvedAvatar) {
                resolvedAvatar = resolveAvatarUrl(resolvedAvatar) || resolvedAvatar;
              }

              const clinicObj = Array.isArray(row.clinic) ? row.clinic[0] : row.clinic;
              const dynamicClinicName =
                clinicObj?.name ||
                (rowClinicId ? clinicNameMap.get(rowClinicId) : undefined) ||
                "Clinic Branch";

              const apptId = String(row.appointment_id);
              apptMap.set(apptId, {
                id: apptId,
                clinicId: rowClinicId || undefined,
                clinicName: dynamicClinicName,
                patientName: resolvedName,
                patientAvatar: resolvedAvatar,
                patientEmail: resolvedEmail,
                patientContact: resolvedPhone,
                patientAddress: resolvedAddress,
                patientGender: resolvedGender,
                patientBirthdate: resolvedBirthdate,
                patientAge: calculatedAge,
                emergencyContactName: row.emergency_contact_name || userProf?.emergency_contact_name || undefined,
                emergencyContactPhone: row.emergency_contact_phone || userProf?.emergency_contact_phone || undefined,
                emergencyRelationship: row.emergency_contact_relationship || userProf?.emergency_relationship || undefined,
                questionnaireAnswers: qAnswers,
                date: dateStr,
                time: timeStr,
                notes: row.notes || "",
                clinicNote: row.clinic_note || "",
                status: row.status === "completed"
                  ? "completed"
                  : row.status === "confirmed" || row.status === "accepted"
                    ? "scheduled"
                    : row.status || "pending",
                assignedDoctorId: row.assigned_doctor_id || undefined,
                assignedDoctorName: assignedDocName,
                isAssignedToMe: Boolean(isDirectDocMatch),
                doctorStatus: row.doctor_status || (
                  row.status === "confirmed" || row.status === "accepted" || row.status === "scheduled" || row.status === "completed"
                    ? "approved"
                    : row.status === "rejected"
                      ? "rejected"
                      : "pending-review"
                ),
                doctorNote: docCleanNote || "",
                doctorDiagnosis: docDiagnosis || "",
                doctorReviewedAt: row.doctor_reviewed_at || undefined,
                scheduleSentToDoctor: Boolean(
                  (row.status !== "cancelled" && row.status !== "rejected") &&
                  (row.schedule_sent_to_doctor || row.date || row.status === "confirmed" || row.status === "accepted" || row.status === "scheduled")
                ),
                doctorDone: row.status === "completed",
                createdAt: row.created_at || "",
                skinPhotoUrl: photoUrl,
                conditionImage: undefined,
                conditionName: docDiagnosis || row.ai_condition_name || undefined,
                aiConditionName: (row.ai_condition_name && !row.ai_condition_name.toLowerCase().includes("consultation")) ? row.ai_condition_name : undefined,
                userId: row.user_id || undefined,
                aiConfidence: row.ai_confidence ? Number(row.ai_confidence) : undefined,
                queueNumber: row.queue_number ?? undefined,
                batchTime: row.batch_time || undefined,
                checkInStatus: row.check_in_status || undefined,
                isWalkIn: Boolean(row.is_walk_in),
                appointmentHistory: Array.isArray(row.appointment_history)
                  ? row.appointment_history
                  : (Array.isArray(row.questionnaire_answers?.appointment_history)
                    ? row.questionnaire_answers.appointment_history
                    : (typeof row.questionnaire_answers === "string" && (() => {
                        try {
                          const p = JSON.parse(row.questionnaire_answers);
                          return Array.isArray(p?.appointment_history) ? p.appointment_history : [];
                        } catch {
                          return [];
                        }
                      })()) || []),
              });
            }
          }
        }
      } catch (err) {
        throw err;
      }

      // Only render rows returned by Supabase under the authenticated session's RLS.
      // Browser caches must not introduce records omitted by database access rules.
      if (currentUserIdRef.current !== requestUserId || activeClinicIdRef.current !== currentActiveClinicId) return;
      const finalAppointments = Array.from(apptMap.values());
      finalAppointments.sort(compareDoctorAppointments);
      setAppointments(finalAppointments);
      setLoadedScope(`${requestUserId}:${currentActiveClinicId}`);
    } catch (err) {
      if (currentUserIdRef.current === requestUserId && activeClinicIdRef.current === currentActiveClinicId) setAppointments([]);
      console.error("[useDoctorAppointments] fetchAppointments error:", err);
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
      if (queuedRefetchRef.current) {
        queuedRefetchRef.current = false;
        void latestFetchRef.current();
      }
    }
  }, [user]);

  useEffect(() => {
    latestFetchRef.current = fetchAppointments;
    fetchAppointments();

    // 1. Supabase Realtime channel for instant live updates when clinic assigns or patient books
    const channel = supabase
      .channel(`doctor-appointments-realtime-${user?.id || "anon"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "patient_appointment" },
        () => {
          fetchAppointments();
        }
      )
      .subscribe();

    // 2. Custom event & storage listeners for smooth cross-tab updates
    const handleAppointmentsUpdated = () => fetchAppointments();
    const handleFocus = () => fetchAppointments();
    const handleStorage = (e: StorageEvent) => {
      if (
        e.key === "dermai_clinic_appointments" ||
        e.key === "dermai_clinic_doctors" ||
        e.key === "dermai_doctor_last_read_notifs"
      ) {
        fetchAppointments();
      }
    };

    window.addEventListener("dermai_appointments_updated", handleAppointmentsUpdated);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("storage", handleStorage);

    // 4. Periodic polling fallback (relaxed to 60s; Supabase Realtime + focus + storage handle live updates)
    const pollInterval = setInterval(() => {
      fetchAppointments();
    }, 60000);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("dermai_appointments_updated", handleAppointmentsUpdated);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("storage", handleStorage);
      clearInterval(pollInterval);
    };
  }, [fetchAppointments, user?.id, activeClinicContextId]);

  // Doctor review action: accept (finalizes schedule) or reject (returns to clinic for reassignment)
  const submitDoctorReview = async (
    appointmentId: string,
    decision: "approved" | "rejected",
    diagnosis: string,
    note: string
  ) => {
    try {
      const formattedNote = diagnosis
        ? `Diagnosis: ${diagnosis}${note ? ` | Note: ${note}` : ""}`
        : note;

      const isApproved = decision === "approved";
      const docLabel = doctorName ? `Dr. ${doctorName.replace(/^dr\.\s*/i, "")}` : "";

      const updatePayload: Record<string, any> = {
        doctor_status: decision,
        doctor_note: formattedNote,
        doctor_reviewed_at: new Date().toISOString(),
      };

      const existingAppt = appointments.find((a) => a.id === appointmentId);
      const historyEntry: AppointmentHistoryEntry = {
        action: isApproved ? "doctor_approved" : "doctor_rejected",
        actor: "doctor",
        timestamp: new Date().toISOString(),
        doctorId: clinicDoctorIdRef.current || user?.id,
        doctorName: doctorName || undefined,
        reason: note || undefined,
      };
      const prevHistory = Array.isArray(existingAppt?.appointmentHistory)
        ? existingAppt.appointmentHistory
        : [];
      const updatedHistory = [...prevHistory, historyEntry];

      // Retrieve existing questionnaire_answers to preserve all data
      let existingQa: any = null;
      try {
        const { data: qData } = await supabase
          .from("patient_appointment")
          .select("questionnaire_answers")
          .eq("appointment_id", appointmentId)
          .maybeSingle();
        existingQa = qData?.questionnaire_answers;
      } catch {}

      let nextQa: Record<string, any> = {};
      if (existingQa && typeof existingQa === "object" && !Array.isArray(existingQa)) {
        nextQa = { ...existingQa, appointment_history: updatedHistory };
      } else if (Array.isArray(existingQa)) {
        nextQa = { answers: existingQa, appointment_history: updatedHistory };
      } else if (existingAppt?.questionnaireAnswers) {
        nextQa = { answers: existingAppt.questionnaireAnswers, appointment_history: updatedHistory };
      } else {
        nextQa = { appointment_history: updatedHistory };
      }

      updatePayload.questionnaire_answers = nextQa;

      if (isApproved) {
        updatePayload.status = "confirmed";
        updatePayload.schedule_sent_to_doctor = true;
        updatePayload.clinic_note = `Appointment schedule finalized and confirmed by ${docLabel}.`;
        
        // Only assign if currently unassigned, and ensure it is a valid clinic_doctor doctor_id
        if (!existingAppt?.assignedDoctorId) {
          const validClinicDocId =
            clinicDoctorIdRef.current ||
            doctorIds.find((id) => clinicDoctorsMapRef.current.has(id));
          if (validClinicDocId) {
            updatePayload.assigned_doctor_id = validClinicDocId;
          }
        }
      } else {
        updatePayload.status = "pending";
        updatePayload.clinic_note = `Doctor declined schedule: ${note || "Case declined"}. Clinic reassignment required.`;
      }

      let { error } = await supabase
        .from("patient_appointment")
        .update(updatePayload)
        .eq("appointment_id", appointmentId);

      // Resilient fallback if any optional column triggers a schema cache error
      if (error && (error.message.includes("schema cache") || error.code === "PGRST204")) {
        console.warn("[useDoctorAppointments] Supabase column missing error, retrying without optional fields:", error.message);
        const stripped: Record<string, any> = {
          doctor_status: decision,
          doctor_note: formattedNote,
          doctor_reviewed_at: updatePayload.doctor_reviewed_at,
          status: updatePayload.status,
          questionnaire_answers: nextQa,
        };
        const retry = await supabase
          .from("patient_appointment")
          .update(stripped)
          .eq("appointment_id", appointmentId);
        error = retry.error;
      }

      if (error) {
        console.error("[useDoctorAppointments] Supabase update error:", error.message);
        throw new Error(error.message);
      }
      window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));

      // Also update local cache
      try {
        const stored = localStorage.getItem("dermai_clinic_appointments");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            const next = parsed.map((a: any) =>
              a.id === appointmentId || a.appointment_id === appointmentId
                ? {
                    ...a,
                    status: isApproved ? "confirmed" : "pending",
                    doctorStatus: decision,
                    doctorDiagnosis: diagnosis,
                    doctorNote: note,
                    doctorReviewedAt: new Date().toISOString(),
                    clinicNote: updatePayload.clinic_note,
                    scheduleSentToDoctor: isApproved,
                    appointmentHistory: updatedHistory,
                  }
                : a
            );
            localStorage.setItem("dermai_clinic_appointments", JSON.stringify(next));
            window.dispatchEvent(new Event("storage"));
          }
        }
      } catch {}

      const targetAppt = appointments.find((a) => a.id === appointmentId);
      if (targetAppt?.userId) {
        createPatientNotification({
          userId: targetAppt.userId,
          type: isApproved ? "appointment-scheduled" : "appointment-rejected",
          subtype: isApproved ? "doctor-approved" : "doctor-declined",
          title: isApproved ? "Doctor Confirmed Schedule" : "Doctor Review Update",
          body: isApproved
            ? `Dr. ${doctorName || "your doctor"} has approved your consultation schedule.`
            : `Dr. ${doctorName || "your doctor"} had a schedule conflict: ${note || "Consultation will be reassigned."}`,
        });
      }

      logAuditEvent({
        userId: user?.id,
        role: "doctor",
        category: "Appointment",
        action: isApproved ? "Appointment Accepted" : "Appointment Rejected",
        target: `Appointment #${appointmentId.slice(0, 8)}`,
        details: isApproved
          ? `Dr. ${doctorName || "Doctor"} accepted and confirmed consultation schedule.`
          : `Dr. ${doctorName || "Doctor"} declined consultation schedule: "${note || "Schedule conflict"}".`,
        performerName: doctorName || "Doctor",
        metadata: {
          appointmentId,
          decision,
          diagnosis,
          note,
        },
      }).catch(() => {});

      await fetchAppointments();
    } catch (e) {
      console.error("[useDoctorAppointments] submitDoctorReview error:", e);
      throw e;
    }
  };

  // Mark appointment completed with clinical diagnosis and consultation notes
  const markAppointmentDone = async (
    appointmentId: string,
    finalDiagnosis?: string,
    consultationNote?: string
  ) => {
    try {
      const formattedNote = finalDiagnosis
        ? `Diagnosis: ${finalDiagnosis}${consultationNote ? ` | Note: ${consultationNote}` : ""}`
        : consultationNote;

      const updatePayload: any = {
        status: "completed",
        doctor_reviewed_at: new Date().toISOString(),
      };
      if (formattedNote) {
        updatePayload.doctor_note = formattedNote;
      }

      // 1. Always update local storage first so UI updates immediately and offline/mock records succeed
      try {
        const stored = localStorage.getItem("dermai_clinic_appointments");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            const next = parsed.map((a: any) =>
              String(a.id) === String(appointmentId) || String(a.appointment_id) === String(appointmentId)
                ? {
                    ...a,
                    status: "completed",
                    doctorDone: true,
                    doctorDiagnosis: finalDiagnosis || a.doctorDiagnosis,
                    doctorNote: consultationNote || a.doctorNote,
                    doctorReviewedAt: new Date().toISOString(),
                  }
                : a
            );
            localStorage.setItem("dermai_clinic_appointments", JSON.stringify(next));
            window.dispatchEvent(new Event("storage"));
          }
        }
      } catch (storageErr) {
        console.warn("[useDoctorAppointments] LocalStorage sync warning:", storageErr);
      }

      // 2. If appointmentId is a valid UUID, persist to Supabase
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(appointmentId);
      if (isUuid) {
        try {
          const { error } = await supabase
            .from("patient_appointment")
            .update(updatePayload)
            .eq("appointment_id", appointmentId);

          if (error) {
            console.warn("[useDoctorAppointments] Supabase update warning:", error.message);
          }
        } catch (supaErr: any) {
          console.warn("[useDoctorAppointments] Supabase network exception:", supaErr?.message);
        }
      }

      const targetAppt = appointments.find((a) => a.id === appointmentId);
      if (targetAppt?.userId) {
        createPatientNotification({
          userId: targetAppt.userId,
          type: "appointment-completed",
          subtype: "reviewed",
          title: "Consultation Completed",
          body: `Dr. ${doctorName || "your doctor"} has completed your consultation review.${finalDiagnosis ? ` Assessment: ${finalDiagnosis}.` : ""}`,
        });
      }

      logAuditEvent({
        userId: user?.id,
        role: "doctor",
        category: "Appointment",
        action: "Consultation Completed",
        target: `Appointment #${appointmentId.slice(0, 8)}`,
        details: `Dr. ${doctorName || "Doctor"} completed consultation.${finalDiagnosis ? ` Diagnosis: ${finalDiagnosis}.` : ""}${consultationNote ? ` Notes: ${consultationNote}` : ""}`,
        performerName: doctorName || "Doctor",
        metadata: {
          appointmentId,
          finalDiagnosis,
          consultationNote,
        },
      }).catch(() => {});

      if (targetAppt?.aiConditionName) {
        logAuditEvent({
          userId: user?.id,
          role: "doctor",
          category: "Scan",
          action: "AI Skin Scan Reviewed",
          target: `Scan for ${targetAppt.patientName || "Patient"}`,
          details: `Dr. ${doctorName || "Doctor"} reviewed and signed off on AI scan prediction (${targetAppt.aiConditionName}). Final clinical diagnosis: ${finalDiagnosis || "Confirmed"}.`,
          performerName: doctorName || "Doctor",
          metadata: {
            appointmentId,
            aiConditionName: targetAppt.aiConditionName,
            aiConfidence: targetAppt.aiConfidence,
            finalDiagnosis,
          },
        }).catch(() => {});
      }

      await fetchAppointments();
    } catch (e) {
      console.error("[useDoctorAppointments] markAppointmentDone error:", e);
      throw e;
    }
  };

  const callPatientToConsultation = useCallback(async (appointmentId: string) => {
    try {
      await supabase
        .from("patient_appointment")
        .update({ check_in_status: "in-consultation" })
        .eq("appointment_id", appointmentId);

      setAppointments((prev) =>
        prev.map((a) => (a.id === appointmentId ? { ...a, checkInStatus: "in-consultation" } : a))
      );

      logAuditEvent({
        userId: user?.id,
        role: "doctor",
        category: "Appointment",
        action: "Consultation Started",
        target: `Appointment #${appointmentId.slice(0, 8)}`,
        details: `Dr. ${doctorName || "Doctor"} started consultation session for appointment #${appointmentId.slice(0, 8)}.`,
        performerName: doctorName || "Doctor",
        metadata: {
          appointmentId,
        },
      }).catch(() => {});

      try {
        const raw = localStorage.getItem("dermai_clinic_appointments");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const next = parsed.map((a: any) =>
              a.id === appointmentId ? { ...a, checkInStatus: "in-consultation" } : a
            );
            localStorage.setItem("dermai_clinic_appointments", JSON.stringify(next));
            window.dispatchEvent(new Event("storage"));
          }
        }
      } catch {}
    } catch (err: any) {
      console.error("[useDoctorAppointments] callPatientToConsultation error:", err?.message);
    }
  }, [user?.id, doctorName]);

  // Hide old results immediately when the active clinic changes.
  const filteredAppointments = useMemo(() => {
    if (loadedScope !== `${user?.id}:${activeClinicContextId}`) return [];
    if (!activeClinicContextId) return [];
    return appointments.filter((a) => a.clinicId === activeClinicContextId);
  }, [appointments, activeClinicContextId, loadedScope, user?.id]);

  return {
    loading,
    doctorName,
    doctorEmail,
    doctorIds,
    appointments: filteredAppointments,
    refresh: fetchAppointments,
    submitDoctorReview,
    markAppointmentDone,
    callPatientToConsultation,
  };
}
