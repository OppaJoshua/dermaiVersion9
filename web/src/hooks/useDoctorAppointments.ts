import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { createPatientNotification } from "@/lib/notificationService";

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
  const [doctorClinic, setDoctorClinic] = useState<string>(() => {
    try {
      const p = localStorage.getItem("dermai_doctor_profile");
      if (p) return JSON.parse(p).clinicName || "";
    } catch {}
    return "";
  });
  const [doctorEmail, setDoctorEmail] = useState<string>(user?.email || "");
  const [doctorIds, setDoctorIds] = useState<string[]>([]);
  const clinicDoctorIdRef = useRef<string | null>(null);
  const clinicDoctorsMapRef = useRef<Map<string, string>>(new Map());

  const isFetchingRef = useRef(false);
  const queuedRefetchRef = useRef(false);

  const fetchAppointments = useCallback(async () => {
    if (isFetchingRef.current) {
      queuedRefetchRef.current = true;
      return;
    }
    isFetchingRef.current = true;

    try {
      // 1. Identify doctor accounts linked to current user or local doctor profile
      const userEmail = (user?.email || "").trim().toLowerCase();
      setDoctorEmail(userEmail);

      const foundDoctorIds: string[] = user?.id ? [String(user.id)] : [];
      let foundClinicId: string | null = null;

      let docDisplayName = user?.user_metadata?.full_name || user?.user_metadata?.name || "";
      let docClinicName = "";

      // Check localStorage doctor profile
      try {
        const storedProfile = localStorage.getItem("dermai_doctor_profile");
        if (storedProfile) {
          const p = JSON.parse(storedProfile);
          if (p.id) foundDoctorIds.push(String(p.id));
          if (p.doctor_id) foundDoctorIds.push(String(p.doctor_id));
          if (p.clinicId) foundClinicId = String(p.clinicId);
          if (p.fullName && !docDisplayName) docDisplayName = p.fullName;
          if (p.clinicName && !docClinicName) docClinicName = p.clinicName;
        }
      } catch { }

      // Check clinic_doctor table (primary doctor roster)
      const clinicDoctorsMap = new Map<string, string>();
      try {
        const { data: clinicDocData, error: clinicDocErr } = await supabase
          .from("clinic_doctor")
          .select("doctor_id, clinic_id, user_id, doctor_name, email, photo_url, status, duty_schedule");

        if (!clinicDocErr && clinicDocData && clinicDocData.length > 0) {
          for (const cd of clinicDocData as any[]) {
            if (cd.doctor_id && cd.doctor_name) {
              clinicDoctorsMap.set(String(cd.doctor_id), cd.doctor_name);
            }
            const cdEmail = (cd.email || "").trim().toLowerCase();
            // Match only by authoritative account identifiers.
            const isSelfMatch = Boolean(
              (user?.id && cd.user_id === user.id) ||
              (cdEmail && userEmail && cdEmail === userEmail)
            );

            if (isSelfMatch) {
              if (cd.doctor_id) {
                foundDoctorIds.push(String(cd.doctor_id));
                clinicDoctorIdRef.current = String(cd.doctor_id);
              }
              if (cd.clinic_id) foundClinicId = String(cd.clinic_id);
              if (cd.doctor_name && !docDisplayName) {
                docDisplayName = cd.doctor_name;
              }
            }
          }
          clinicDoctorsMapRef.current = clinicDoctorsMap;

        }
      } catch (e) {
        console.warn("[useDoctorAppointments] clinic_doctor lookup:", e);
      }

      // Check localStorage clinic doctors as well
      try {
        const storedClinicDocs = localStorage.getItem("dermai_clinic_doctors");
        if (storedClinicDocs) {
          const parsed = JSON.parse(storedClinicDocs);
          if (Array.isArray(parsed)) {
            for (const cd of parsed) {
              const cdId = cd.id || cd.doctor_id;
              const cdName = cd.name || cd.doctor_name;
              if (cdId && cdName) clinicDoctorsMap.set(String(cdId), cdName);
              const cdEmail = (cd.email || "").trim().toLowerCase();
              const isSelfMatch =
                (user?.id && cd.user_id === user.id) ||
                (cdEmail && userEmail && cdEmail === userEmail) ||
                (cdId && foundDoctorIds.includes(String(cdId)));

              if (isSelfMatch) {
                if (cdId) foundDoctorIds.push(String(cdId));
                if (cd.clinicId || cd.clinic_id) foundClinicId = String(cd.clinicId || cd.clinic_id);
                if (cdName && !docDisplayName) docDisplayName = cdName;
              }
            }
          }
        }
      } catch { }

      // Check doctors table (secondary table) for THIS doctor only
      try {
        const { data: docData } = await supabase
          .from("doctors")
          .select("id, name, clinic_name, clinic_doctor_id, email, user_id");

        if (docData && docData.length > 0) {
          docData.forEach((d: any) => {
            const dEmail = (d.email || "").trim().toLowerCase();
            const isSelf =
              (user?.id && d.user_id === user.id) ||
              (dEmail && userEmail && dEmail === userEmail);
            if (isSelf) {
              if (d.id) foundDoctorIds.push(String(d.id));
              if (d.clinic_doctor_id) foundDoctorIds.push(String(d.clinic_doctor_id));
              if (d.name && !docDisplayName) docDisplayName = d.name;
              if (d.clinic_name && !docClinicName) docClinicName = d.clinic_name;
            }
          });
        }
      } catch {
        /* ignore */
      }

      // Resolve clinic name if clinic ID is known
      if (foundClinicId) {
        try {
          const { data: clinicRows } = await supabase
            .from("clinic")
            .select("clinic_id, name")
            .eq("clinic_id", foundClinicId)
            .maybeSingle();
          if (clinicRows?.name) {
            docClinicName = clinicRows.name;
          }
        } catch {}
      }

      setDoctorName(docDisplayName);
      setDoctorClinic(docClinicName);
      const uniqueDoctorIds = Array.from(new Set(foundDoctorIds.filter(Boolean)));
      setDoctorIds(uniqueDoctorIds);


      // 2. Fetch appointments from Supabase
      const apptMap = new Map<string, DoctorAppointmentRecord>();

      try {
        const { data: primaryData, error: primaryErr } = await supabase
          .from("patient_appointment")
          .select("*")
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

            const isDirectDocMatch =
              Boolean(rawAssignedDoc && uniqueDoctorIds.includes(rawAssignedDoc));

            const isClinicMatch = Boolean(
              foundClinicId && rowClinicId && rowClinicId === String(foundClinicId)
            );

            // Doctors only see appointments explicitly assigned to THEM (or unassigned clinic queue requests)
            if (rawAssignedDoc && !isDirectDocMatch) {
              continue;
            }
            if (!rawAssignedDoc && !isClinicMatch) {
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

              // Parse questionnaire answers if JSON string or array
              let qAnswers: any[] | undefined = undefined;
              if (Array.isArray(row.questionnaire_answers)) {
                qAnswers = row.questionnaire_answers;
              } else if (typeof row.questionnaire_answers === "string") {
                try {
                  qAnswers = JSON.parse(row.questionnaire_answers);
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
              if (resolvedAvatar && !resolvedAvatar.startsWith("http") && !resolvedAvatar.startsWith("data:")) {
                const { data: pubData } = supabase.storage.from("avatars").getPublicUrl(resolvedAvatar);
                if (pubData?.publicUrl) {
                  resolvedAvatar = pubData.publicUrl;
                }
              }

              const apptId = String(row.appointment_id);
              apptMap.set(apptId, {
                id: apptId,
                clinicName: docClinicName,
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
              });
            }
          }
        }
      } catch (err) {
        console.warn("[useDoctorAppointments] Supabase fetch error:", err);
      }

      // 3. Sync real local appointments created during tests or offline
      try {
        const storedClinicAppts = localStorage.getItem("dermai_clinic_appointments");
        if (storedClinicAppts) {
          const parsed = JSON.parse(storedClinicAppts);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const realLocalAppts = parsed.filter((a: any) => a && a.id && !String(a.id).startsWith("doc-seed-"));

            for (const appt of realLocalAppts) {
              const rawLocalAssigned = appt.assignedDoctorId ? String(appt.assignedDoctorId) : "";
              const rawLocalClinic = appt.clinicId ? String(appt.clinicId) : "";
              const isAssignedToThisDoctor =
                Boolean(rawLocalAssigned && uniqueDoctorIds.includes(rawLocalAssigned));

              const isLocalClinicMatch = Boolean(
                foundClinicId && rawLocalClinic && rawLocalClinic === String(foundClinicId)
              );

              // Skip if assigned to another doctor
              if (rawLocalAssigned && !isAssignedToThisDoctor) {
                continue;
              }
              if (!rawLocalAssigned && !isLocalClinicMatch) {
                continue;
              }

              const apptId = String(appt.id);
              
              // Match local and Supabase records only by the authoritative appointment ID.
              const matchingKey: string | null = apptMap.has(apptId) ? apptId : null;

              if (matchingKey) {
                // Enrich existing item if local review data is newer
                const existing = apptMap.get(matchingKey)!;
                if (!existing.doctorDiagnosis && appt.doctorDiagnosis) existing.doctorDiagnosis = appt.doctorDiagnosis;
                if (!existing.doctorNote && appt.doctorNote) existing.doctorNote = appt.doctorNote;
                if (appt.doctorStatus && existing.doctorStatus === "pending-review") existing.doctorStatus = appt.doctorStatus;
                if (appt.status === "completed") {
                  existing.status = "completed";
                  existing.doctorDone = true;
                }
                if (appt.status === "confirmed" || appt.status === "scheduled") {
                  existing.status = "scheduled";
                  existing.scheduleSentToDoctor = true;
                }
              } else {
                // Add local appointment to map
                const bdate = appt.patientBirthdate || appt.birthdate;
                const assignedLocalDocName = appt.assignedDoctorName || (isAssignedToThisDoctor ? docDisplayName : (rawLocalAssigned ? clinicDoctorsMap.get(rawLocalAssigned) : undefined));

                apptMap.set(apptId, {
                  id: apptId,
                  clinicName: appt.clinicName || docClinicName,
                  patientName: appt.patientName || "",
                  patientEmail: appt.patientEmail || "",
                  patientContact: appt.patientContact || "",
                  patientAddress: appt.patientAddress || "",
                  patientGender: appt.patientGender || appt.gender,
                  patientBirthdate: bdate,
                  patientAge: appt.patientAge || calculateAgeFromBirthdate(bdate),
                  emergencyContactName: appt.emergencyContactName || appt.emergency_contact_name || undefined,
                  emergencyContactPhone: appt.emergencyContactPhone || appt.emergency_contact_phone || undefined,
                  emergencyRelationship: appt.emergencyRelationship || appt.emergency_relationship || undefined,
                  questionnaireAnswers: appt.questionnaireAnswers || appt.questionnaire,
                  date: appt.date || "",
                  time: appt.time || "",
                  notes: appt.notes || "",
                  clinicNote: appt.clinicNote || "",
                  status: appt.status === "completed"
                    ? "completed"
                    : appt.status === "confirmed" || appt.status === "accepted"
                      ? "scheduled"
                      : appt.status || "pending",
                  assignedDoctorId: appt.assignedDoctorId || undefined,
                  assignedDoctorName: assignedLocalDocName,
                  isAssignedToMe: Boolean(isAssignedToThisDoctor),
                  doctorStatus: appt.doctorStatus || (
                    appt.status === "confirmed" || appt.status === "accepted" || appt.status === "scheduled" || appt.status === "completed"
                      ? "approved"
                      : appt.status === "rejected"
                        ? "rejected"
                        : "pending-review"
                  ),
                  doctorDiagnosis: appt.doctorDiagnosis || "",
                  doctorNote: appt.doctorNote || "",
                  doctorReviewedAt: appt.doctorReviewedAt || undefined,
                  scheduleSentToDoctor: Boolean(
                    (appt.status !== "cancelled" && appt.status !== "rejected") &&
                    (appt.scheduleSentToDoctor || appt.date || appt.status === "scheduled" || appt.status === "confirmed" || appt.status === "accepted")
                  ),
                  doctorDone: appt.status === "completed" || Boolean(appt.doctorDone),
                  createdAt: appt.createdAt || "",
                  skinPhotoUrl: appt.skinPhotoUrl,
                  conditionImage: appt.conditionImage || appt.skinPhotoUrl,
                  conditionName: appt.aiConditionName || appt.conditionName || undefined,
                  aiConditionName: (appt.aiConditionName && !appt.aiConditionName.toLowerCase().includes("consultation"))
                    ? appt.aiConditionName
                    : (appt.conditionName && !appt.conditionName.toLowerCase().includes("consultation") ? appt.conditionName : undefined),
                  aiConfidence: appt.aiConfidence != null ? Number(appt.aiConfidence) : undefined,
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

      const finalAppointments = Array.from(apptMap.values());
      // Sort by created date descending
      finalAppointments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setAppointments(finalAppointments);
    } catch (err) {
      console.error("[useDoctorAppointments] fetchAppointments error:", err);
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
      if (queuedRefetchRef.current) {
        queuedRefetchRef.current = false;
        fetchAppointments();
      }
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

    // 3. Periodic polling fallback (relaxed to 60s; Supabase Realtime + focus + storage handle live updates)
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
  }, [fetchAppointments, user?.id]);

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

      if (isApproved) {
        updatePayload.status = "confirmed";
        updatePayload.schedule_sent_to_doctor = true;
        updatePayload.clinic_note = `Appointment schedule finalized and confirmed by ${docLabel}.`;
        
        // Only assign if currently unassigned, and ensure it is a valid clinic_doctor doctor_id
        const existingAppt = appointments.find((a) => a.id === appointmentId);
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

      const { error } = await supabase
        .from("patient_appointment")
        .update(updatePayload)
        .eq("appointment_id", appointmentId);

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
              a.id === appointmentId
                ? {
                    ...a,
                    status: isApproved ? "confirmed" : "pending",
                    doctorStatus: decision,
                    doctorDiagnosis: diagnosis,
                    doctorNote: note,
                    doctorReviewedAt: new Date().toISOString(),
                    clinicNote: updatePayload.clinic_note,
                    scheduleSentToDoctor: isApproved,
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
  }, []);

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
    callPatientToConsultation,
  };
}
