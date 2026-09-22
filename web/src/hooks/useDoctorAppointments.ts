import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";

export type DoctorAppointmentRecord = {
  id: string;
  clinicName: string;
  patientName: string;
  patientAge?: number;
  patientGender?: string;
  patientBirthdate?: string;
  patientAvatar?: string;
  patientEmail?: string;
  patientAddress?: string;
  patientContact?: string;
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
  questionnaireAnswers?: Array<{
    id?: string;
    question: string;
    answer: string;
    severity?: number | null;
  }>;
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
  const [loading, setLoading] = useState(true);
  const [doctorName, setDoctorName] = useState("");
  const [doctorClinic, setDoctorClinic] = useState("");
  const [doctorEmail, setDoctorEmail] = useState("");
  const [doctorIds, setDoctorIds] = useState<string[]>([]);
  const [appointments, setAppointments] = useState<DoctorAppointmentRecord[]>([]);
  const isFetchingRef = useRef(false);

  const fetchAppointments = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      // 1. Identify doctor accounts linked to current user or local doctor profile
      const userEmail = (user?.email || "").trim().toLowerCase();
      setDoctorEmail(userEmail);
      const foundDoctorIds: string[] = user?.id ? [user.id] : [];
      const foundClinicIds: any[] = [];
      
      let docDisplayName = user?.user_metadata?.full_name || user?.user_metadata?.name || "";
      let docClinicName = "";

      // Check localStorage doctor profile
      try {
        const storedProfile = localStorage.getItem("dermai_doctor_profile");
        if (storedProfile) {
          const p = JSON.parse(storedProfile);
          if (p.fullName && !docDisplayName) docDisplayName = p.fullName;
          if (p.clinicName && !docClinicName) docClinicName = p.clinicName;
        }
      } catch { }

      // Check localStorage clinic doctors
      try {
        const storedClinicDocs = localStorage.getItem("dermai_clinic_doctors");
        if (storedClinicDocs) {
          const parsed = JSON.parse(storedClinicDocs);
          if (Array.isArray(parsed) && parsed.length > 0) {
            parsed.forEach((d: any) => {
              if (d.id) foundDoctorIds.push(d.id);
              if (d.clinicId) foundClinicIds.push(d.clinicId);
              if (!docDisplayName && d.name) docDisplayName = d.name;
              if (!docClinicName && d.clinicName) docClinicName = d.clinicName;
            });
          }
        }
      } catch { }

      // Check clinic_doctor table (primary doctor roster)
      try {
        const { data: clinicDocData, error: clinicDocErr } = await supabase
          .from("clinic_doctor")
          .select("doctor_id, doctor_name, clinic_id, email, user_id, specialization");

        if (!clinicDocErr && clinicDocData && clinicDocData.length > 0) {
          for (const cd of clinicDocData as any[]) {
            const cdEmail = (cd.email || "").trim().toLowerCase();
            const cdName = (cd.doctor_name || "").trim().toLowerCase();
            const metaName = (docDisplayName || "").trim().toLowerCase();
            const isMatch =
              (user?.id && cd.user_id === user.id) ||
              (cdEmail && userEmail && cdEmail === userEmail) ||
              (cdName && metaName && (cdName.includes(metaName) || metaName.includes(cdName) || cdName.includes("audrey")));

            if (isMatch) {
              if (cd.doctor_id) foundDoctorIds.push(cd.doctor_id);
              if (cd.clinic_id) foundClinicIds.push(cd.clinic_id);
              if (cd.doctor_name) docDisplayName = cd.doctor_name;

              // Auto-link user_id if not linked yet
              if (!cd.user_id && user?.id) {
                supabase
                  .from("clinic_doctor")
                  .update({ user_id: user.id })
                  .eq("doctor_id", cd.doctor_id)
                  .then(() => {});
              }
            } else {
              // Also collect all doctor IDs as potential assignment targets
              if (cd.doctor_id) foundDoctorIds.push(cd.doctor_id);
              if (cd.clinic_id) foundClinicIds.push(cd.clinic_id);
            }
          }
        }
      } catch (e) {
        console.warn("[useDoctorAppointments] clinic_doctor lookup:", e);
      }

      // Check doctors table (secondary table)
      try {
        const { data: docData } = await supabase
          .from("doctors")
          .select("id, name, clinic_name, clinic_doctor_id, email, user_id");

        if (docData && docData.length > 0) {
          docData.forEach((d: any) => {
            if (d.id) foundDoctorIds.push(d.id);
            if (d.clinic_doctor_id) foundDoctorIds.push(d.clinic_doctor_id);
            if (d.name && !docDisplayName) docDisplayName = d.name;
            if (d.clinic_name && !docClinicName) docClinicName = d.clinic_name;
          });
        }
      } catch {
        /* ignore */
      }

      // Fallback display names if still generic
      if (!docDisplayName || docDisplayName === "Doctor") {
        docDisplayName = "Dr. Audrey Saludaga";
      }
      if (!docClinicName) {
        docClinicName = "DermAI Dermatology Center";
      }

      // Resolve clinic name from clinic table if clinic ID is known
      if (foundClinicIds.length > 0) {
        try {
          const { data: clinicRows } = await supabase
            .from("clinic")
            .select("clinic_id, name")
            .in("clinic_id", foundClinicIds);
          if (clinicRows && clinicRows.length > 0 && clinicRows[0].name) {
            docClinicName = clinicRows[0].name;
          }
        } catch {}
      }

      setDoctorName(docDisplayName);
      setDoctorClinic(docClinicName);
      const uniqueDoctorIds = Array.from(new Set(foundDoctorIds.filter(Boolean)));
      setDoctorIds(uniqueDoctorIds);

      // 2. Fetch real appointments from Supabase
      const apptMap = new Map<string, DoctorAppointmentRecord>();

      try {
        const { data: primaryData, error: primaryErr } = await supabase
          .from("patient_appointment")
          .select(`
            appointment_id,
            date,
            status,
            patient_name,
            patient_email,
            patient_contact,
            patient_address,
            patient_gender,
            patient_birthdate,
            questionnaire_answers,
            notes,
            clinic_note,
            skin_photo_url,
            ai_condition_name,
            ai_confidence,
            meeting_link,
            created_at,
            assigned_doctor_id,
            schedule_sent_to_doctor,
            doctor_status,
            doctor_note,
            doctor_reviewed_at,
            user_id,
            clinic_id
          `)
          .order("created_at", { ascending: false });

        if (primaryErr) {
          console.warn("[useDoctorAppointments] Supabase select error:", primaryErr.message);
        } else if (primaryData && primaryData.length > 0) {
          // Collect user_ids to enrich missing patient profile info
          const userIdsToFetch = Array.from(
            new Set((primaryData as any[]).map((r) => r.user_id).filter(Boolean))
          );
          const userProfileMap = new Map<string, any>();
          if (userIdsToFetch.length > 0) {
            try {
              const { data: userData } = await supabase
                .from("user")
                .select("user_id, full_name, email, phone, gender, birthdate, address")
                .in("user_id", userIdsToFetch);
              if (userData) {
                userData.forEach((u: any) => userProfileMap.set(u.user_id, u));
              }
            } catch {}
          }

          for (const row of primaryData as any[]) {
            // Check if this appointment matches the doctor or the doctor's clinic, or is unassigned
            const isDirectDocMatch =
              (row.assigned_doctor_id && uniqueDoctorIds.includes(row.assigned_doctor_id)) ||
              (row.assigned_doctor_id && user?.id && String(row.assigned_doctor_id) === String(user.id));

            const isClinicMatch =
              foundClinicIds.length > 0 &&
              foundClinicIds.some((cid) => String(cid) === String(row.clinic_id));

            // Include real appointments assigned to doctor, belonging to doctor's clinic, unassigned cases, or all data during testing
            const isMatch =
              isDirectDocMatch ||
              isClinicMatch ||
              !row.assigned_doctor_id ||
              uniqueDoctorIds.length === 0 ||
              foundClinicIds.length === 0;

            if (isMatch) {
              const userProf = row.user_id ? userProfileMap.get(row.user_id) : null;

              let photoUrl = row.skin_photo_url || undefined;
              if (photoUrl && !photoUrl.startsWith("http") && !photoUrl.startsWith("data:")) {
                try {
                  const { data: signed } = await supabase.storage
                    .from("scan-uploads")
                    .createSignedUrl(photoUrl, 3600);
                  if (signed?.signedUrl) photoUrl = signed.signedUrl;
                } catch {}
              }

              const rawDate = row.date;
              let dateStr = "";
              let timeStr = "";
              if (rawDate) {
                const d = new Date(rawDate);
                if (!isNaN(d.getTime())) {
                  dateStr = d.toISOString().split("T")[0];
                  timeStr = d.toTimeString().slice(0, 5);
                } else if (typeof rawDate === "string") {
                  dateStr = rawDate;
                }
              }

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

              const resolvedName = row.patient_name || userProf?.full_name || (row.patient_email ? row.patient_email.split("@")[0] : "") || "Patient";
              const resolvedEmail = row.patient_email || userProf?.email || "";
              const resolvedPhone = row.patient_contact || userProf?.phone || "";
              const resolvedAddress = row.patient_address || userProf?.address || "";
              const resolvedGender = row.patient_gender || userProf?.gender || undefined;
              const resolvedBirthdate = row.patient_birthdate || userProf?.birthdate || undefined;
              const calculatedAge = calculateAgeFromBirthdate(resolvedBirthdate);

              // Parse questionnaire answers if JSON string or array
              let qAnswers: any[] | undefined = undefined;
              if (Array.isArray(row.questionnaire_answers)) {
                qAnswers = row.questionnaire_answers;
              } else if (typeof row.questionnaire_answers === "string") {
                try {
                  qAnswers = JSON.parse(row.questionnaire_answers);
                } catch {}
              }

              apptMap.set(row.appointment_id, {
                id: row.appointment_id,
                clinicName: docClinicName,
                patientName: resolvedName,
                patientEmail: resolvedEmail,
                patientContact: resolvedPhone,
                patientAddress: resolvedAddress,
                patientGender: resolvedGender,
                patientBirthdate: resolvedBirthdate,
                patientAge: calculatedAge,
                questionnaireAnswers: qAnswers,
                date: dateStr,
                time: timeStr,
                notes: row.notes || "",
                clinicNote: row.clinic_note || "",
                status: (row.status === "cancelled" || row.status === "rejected")
                  ? "rejected"
                  : (row.status === "completed" ? "completed" : (row.status === "confirmed" ? "scheduled" : (row.status || "pending"))),
                assignedDoctorId: row.assigned_doctor_id || undefined,
                assignedDoctorName: docDisplayName,
                doctorStatus: (row.status === "cancelled" || row.status === "rejected")
                  ? "rejected"
                  : (row.doctor_status || "pending-review"),
                doctorNote: docCleanNote || "",
                doctorDiagnosis: docDiagnosis || "",
                doctorReviewedAt: row.doctor_reviewed_at || undefined,
                scheduleSentToDoctor: Boolean(
                  (row.status !== "cancelled" && row.status !== "rejected") &&
                  (row.schedule_sent_to_doctor || row.date || row.status === "confirmed" || row.status === "scheduled")
                ),
                doctorDone: row.status === "completed",
                createdAt: row.created_at || new Date().toISOString(),
                skinPhotoUrl: photoUrl,
                conditionImage: photoUrl,
                conditionName: docDiagnosis || row.ai_condition_name || "General Consultation",
                aiConditionName: (row.ai_condition_name && !row.ai_condition_name.toLowerCase().includes("consultation")) ? row.ai_condition_name : undefined,
                aiConfidence: row.ai_confidence ? Number(row.ai_confidence) : undefined,
              });
            }
          }
        }
      } catch (err) {
        console.warn("[useDoctorAppointments] Supabase fetch error:", err);
      }

      // 3. Sync real local appointments created during tests (excluding any old mock seeds)
      try {
        const storedClinicAppts = localStorage.getItem("dermai_clinic_appointments");
        if (storedClinicAppts) {
          const parsed = JSON.parse(storedClinicAppts);
          if (Array.isArray(parsed) && parsed.length > 0) {
            // Filter out any mock seeds if stored
            const realLocalAppts = parsed.filter((a: any) => a.id && !String(a.id).startsWith("doc-seed-"));
            
            for (const appt of realLocalAppts) {
              if (!apptMap.has(appt.id)) {
                const bdate = appt.patientBirthdate || appt.birthdate;
                apptMap.set(appt.id, {
                  id: appt.id,
                  clinicName: appt.clinicName || docClinicName,
                  patientName: appt.patientName || "Patient",
                  patientEmail: appt.patientEmail || "",
                  patientContact: appt.patientContact || "",
                  patientAddress: appt.patientAddress || "",
                  patientGender: appt.patientGender || appt.gender,
                  patientBirthdate: bdate,
                  patientAge: appt.patientAge || calculateAgeFromBirthdate(bdate),
                  questionnaireAnswers: appt.questionnaireAnswers || appt.questionnaire,
                  date: appt.date || "",
                  time: appt.time || "",
                  notes: appt.notes || "",
                  clinicNote: appt.clinicNote || "",
                  status: (appt.status === "cancelled" || appt.status === "rejected") ? "rejected" : (appt.status || "pending"),
                  assignedDoctorId: appt.assignedDoctorId || undefined,
                  assignedDoctorName: appt.assignedDoctorName || docDisplayName,
                  doctorStatus: (appt.status === "cancelled" || appt.status === "rejected") ? "rejected" : (appt.doctorStatus || "pending-review"),
                  doctorDiagnosis: appt.doctorDiagnosis || "",
                  doctorReviewedAt: appt.doctorReviewedAt || undefined,
                  scheduleSentToDoctor: Boolean(
                    (appt.status !== "cancelled" && appt.status !== "rejected") &&
                    (appt.scheduleSentToDoctor || appt.date || appt.status === "scheduled" || appt.status === "confirmed")
                  ),
                  doctorDone: appt.status === "completed" || appt.status === "accepted",
                  createdAt: appt.createdAt || new Date().toISOString(),
                  skinPhotoUrl: appt.skinPhotoUrl,
                  conditionImage: appt.conditionImage || appt.skinPhotoUrl,
                  conditionName: appt.aiConditionName || appt.conditionName || "General Consultation",
                  aiConditionName: (appt.aiConditionName && !appt.aiConditionName.toLowerCase().includes("consultation"))
                    ? appt.aiConditionName
                    : (appt.conditionName && !appt.conditionName.toLowerCase().includes("consultation") ? appt.conditionName : undefined),
                  aiConfidence: appt.aiConfidence,
                });
              }
            }

            // Save cleaned list back without mock seeds
            if (realLocalAppts.length !== parsed.length) {
              localStorage.setItem("dermai_clinic_appointments", JSON.stringify(realLocalAppts));
            }
          }
        }
      } catch (err) {
        console.warn("[useDoctorAppointments] LocalStorage sync error:", err);
      }

      setAppointments(Array.from(apptMap.values()));
    } catch (err) {
      console.error("[useDoctorAppointments] fetchAppointments error:", err);
      setAppointments([]);
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, [user]);

  useEffect(() => {
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

    // 3. Periodic polling fallback (every 5 seconds)
    const pollInterval = setInterval(() => {
      fetchAppointments();
    }, 5000);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("dermai_appointments_updated", handleAppointmentsUpdated);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("storage", handleStorage);
      clearInterval(pollInterval);
    };
  }, [fetchAppointments, user?.id]);

  // Doctor review action
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

      const { error } = await supabase
        .from("patient_appointment")
        .update({
          doctor_status: decision,
          doctor_note: formattedNote,
          doctor_reviewed_at: new Date().toISOString(),
        })
        .eq("appointment_id", appointmentId);

      if (error) {
        console.warn("[useDoctorAppointments] Supabase update warning:", error.message);
      }

      // Also update local cache
      try {
        const stored = localStorage.getItem("dermai_clinic_appointments");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            const next = parsed.map((a: any) =>
              a.id === appointmentId
                ? {
                    ...a,
                    doctorStatus: decision,
                    doctorDiagnosis: diagnosis,
                    doctorNote: note,
                    doctorReviewedAt: new Date().toISOString(),
                  }
                : a
            );
            localStorage.setItem("dermai_clinic_appointments", JSON.stringify(next));
            window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
          }
        }
      } catch {}

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

      const { error } = await supabase
        .from("patient_appointment")
        .update(updatePayload)
        .eq("appointment_id", appointmentId);

      if (error) {
        console.warn("[useDoctorAppointments] markAppointmentDone Supabase update warning:", error.message);
      }

      try {
        const stored = localStorage.getItem("dermai_clinic_appointments");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            const next = parsed.map((a: any) =>
              a.id === appointmentId
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
            window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
          }
        }
      } catch {}

      await fetchAppointments();
    } catch (e) {
      console.error("[useDoctorAppointments] markAppointmentDone error:", e);
      throw e;
    }
  };

  return {
    loading,
    doctorName,
    doctorClinic,
    doctorEmail,
    doctorIds,
    appointments,
    refresh: fetchAppointments,
    submitDoctorReview,
    markAppointmentDone,
  };
}
