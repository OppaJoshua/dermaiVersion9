import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";

export type DoctorAppointmentRecord = {
  id: string;
  clinicName: string;
  patientName: string;
  patientAge?: number;
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
};

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
    if (!user) {
      setLoading(false);
      return;
    }

    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      // 1. Identify doctor accounts linked to current user
      const userEmail = (user.email || "").trim().toLowerCase();
      setDoctorEmail(userEmail);
      const foundDoctorIds: string[] = [user.id];
      const foundClinicIds: any[] = [];
      let docDisplayName = user.user_metadata?.full_name || user.user_metadata?.name || "Doctor";
      let docClinicName = "DermAI Clinic";

      // Check clinic_doctor table (primary doctor roster)
      try {
        const { data: clinicDocData, error: clinicDocErr } = await supabase
          .from("clinic_doctor")
          .select("doctor_id, doctor_name, clinic_id, email, user_id, clinic:clinic_id(name)")
          .or(`user_id.eq.${user.id},email.ilike.${userEmail}`);

        if (!clinicDocErr && clinicDocData && clinicDocData.length > 0) {
          for (const cd of clinicDocData as any[]) {
            if (cd.doctor_id) foundDoctorIds.push(cd.doctor_id);
            if (cd.clinic_id) foundClinicIds.push(cd.clinic_id);
            if (cd.doctor_name) docDisplayName = cd.doctor_name;
            const clinicObj: any = Array.isArray(cd.clinic) ? cd.clinic[0] : cd.clinic;
            if (clinicObj?.name) docClinicName = clinicObj.name;

            // Auto-link user_id if not linked yet
            if (!cd.user_id && user.id) {
              supabase
                .from("clinic_doctor")
                .update({ user_id: user.id })
                .eq("doctor_id", cd.doctor_id)
                .then(() => {});
            }
          }
        }
      } catch (e) {
        console.warn("[useDoctorAppointments] clinic_doctor lookup:", e);
      }

      // Check doctors table (legacy/secondary table)
      try {
        const { data: docData } = await supabase
          .from("doctors")
          .select("id, name, clinic_name, clinic_doctor_id, email, user_id")
          .or(`user_id.eq.${user.id},email.ilike.${userEmail}`);

        if (docData && docData.length > 0) {
          docData.forEach((d: any) => {
            if (d.id) foundDoctorIds.push(d.id);
            if (d.clinic_doctor_id) foundDoctorIds.push(d.clinic_doctor_id);
            if (d.name && docDisplayName === "Doctor") docDisplayName = d.name;
            if (d.clinic_name) docClinicName = d.clinic_name;
          });
        }
      } catch {
        /* ignore legacy table error */
      }

      // Check localStorage cache fallback
      try {
        const storedClinicDocs = localStorage.getItem("dermai_clinic_doctors");
        if (storedClinicDocs) {
          const parsed = JSON.parse(storedClinicDocs);
          if (Array.isArray(parsed)) {
            const matched = parsed.find(
              (d: any) =>
                (d.email && d.email.toLowerCase() === userEmail) ||
                (d.id && foundDoctorIds.includes(d.id)) ||
                (d.name && docDisplayName.toLowerCase().includes(d.name.toLowerCase()))
            );
            if (matched) {
              if (matched.id) foundDoctorIds.push(matched.id);
              if (matched.name && docDisplayName === "Doctor") docDisplayName = matched.name;
              if (matched.clinicName) docClinicName = matched.clinicName;
            }
          }
        }
      } catch {
        /* ignore */
      }

      setDoctorName(docDisplayName);
      setDoctorClinic(docClinicName);
      const uniqueDoctorIds = Array.from(new Set(foundDoctorIds.filter(Boolean)));
      setDoctorIds(uniqueDoctorIds);

      // 2. Fetch appointments from Supabase
      const apptMap = new Map<string, DoctorAppointmentRecord>();

      if (uniqueDoctorIds.length > 0) {
        try {
          const { data: primaryData } = await supabase
            .from("patient_appointment")
            .select(`
              appointment_id,
              date,
              status,
              patient_name,
              patient_email,
              patient_contact,
              patient_address,
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
              clinic_id,
              clinic:clinic_id (
                name
              )
            `)
            .in("assigned_doctor_id", uniqueDoctorIds)
            .order("created_at", { ascending: false });

          if (primaryData && primaryData.length > 0) {
            for (const row of primaryData) {
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
                dateStr = d.toISOString().split("T")[0];
                timeStr = d.toTimeString().slice(0, 5);
              }

              const clinicObj: any = Array.isArray(row.clinic) ? row.clinic[0] : row.clinic;
              
              // Extract doctor diagnosis and note if formatted
              let docDiagnosis = "";
              let docCleanNote = row.doctor_note || "";
              if (row.doctor_note) {
                const match = row.doctor_note.match(/^Diagnosis:\s*([^|\n]+)(?:[|\n]\s*(?:Note:\s*)?(.*))?$/is);
                if (match) {
                  docDiagnosis = match[1]?.trim() || "";
                  docCleanNote = match[2]?.trim() || "";
                }
              }

              apptMap.set(row.appointment_id, {
                id: row.appointment_id,
                clinicName: clinicObj?.name || docClinicName,
                patientName: row.patient_name || "Patient",
                patientEmail: row.patient_email || "",
                patientContact: row.patient_contact || "",
                patientAddress: row.patient_address || "",
                date: dateStr,
                time: timeStr,
                notes: row.notes || "",
                clinicNote: row.clinic_note || "",
                status: (row.status === "scheduled" ? "scheduled" : row.status) as any,
                assignedDoctorId: row.assigned_doctor_id || undefined,
                assignedDoctorName: docDisplayName,
                doctorStatus: row.doctor_status || "pending-review",
                doctorNote: docCleanNote || row.doctor_note || "",
                doctorDiagnosis: docDiagnosis || row.ai_condition_name || "",
                doctorReviewedAt: row.doctor_reviewed_at || undefined,
                scheduleSentToDoctor: Boolean(
                  row.schedule_sent_to_doctor || row.date || row.status === "confirmed" || row.status === "scheduled"
                ),
                doctorDone: row.status === "completed",
                createdAt: row.created_at || new Date().toISOString(),
                skinPhotoUrl: photoUrl,
                aiConditionName: row.ai_condition_name || undefined,
                aiConfidence: row.ai_confidence ? Number(row.ai_confidence) : undefined,
              });
            }
          }
        } catch (err) {
          console.warn("[useDoctorAppointments] Supabase select error:", err);
        }
      }

      // 3. Fallback & Cross-tab sync: Read from localStorage clinic appointments
      try {
        const storedClinicAppts = localStorage.getItem("dermai_clinic_appointments");
        if (storedClinicAppts) {
          const parsed = JSON.parse(storedClinicAppts);
          if (Array.isArray(parsed)) {
            const cleanDocName = docDisplayName.toLowerCase().replace(/^dr\.\s*/i, "").trim();
            for (const appt of parsed) {
              const apptDocName = (appt.assignedDoctorName || "").toLowerCase().replace(/^dr\.\s*/i, "").trim();
              const isMatch =
                (appt.assignedDoctorId && uniqueDoctorIds.includes(appt.assignedDoctorId)) ||
                (apptDocName && (apptDocName.includes(cleanDocName) || cleanDocName.includes(apptDocName)));

              if (isMatch && !apptMap.has(appt.id)) {
                apptMap.set(appt.id, {
                  id: appt.id,
                  clinicName: appt.clinicName || docClinicName,
                  patientName: appt.patientName || "Patient",
                  patientEmail: appt.patientEmail || "",
                  patientContact: appt.patientContact || "",
                  patientAddress: appt.patientAddress || "",
                  date: appt.date || "",
                  time: appt.time || "",
                  notes: appt.notes || "",
                  clinicNote: appt.clinicNote || "",
                  status: appt.status || "pending",
                  assignedDoctorId: appt.assignedDoctorId || undefined,
                  assignedDoctorName: appt.assignedDoctorName || docDisplayName,
                  doctorStatus: appt.doctorStatus || "pending-review",
                  doctorNote: appt.doctorNote || "",
                  doctorDiagnosis: appt.doctorDiagnosis || appt.aiConditionName || "",
                  doctorReviewedAt: appt.doctorReviewedAt || undefined,
                  scheduleSentToDoctor: Boolean(
                    appt.scheduleSentToDoctor || appt.date || appt.status === "scheduled" || appt.status === "confirmed"
                  ),
                  doctorDone: appt.status === "completed" || appt.status === "accepted",
                  createdAt: appt.createdAt || new Date().toISOString(),
                  skinPhotoUrl: appt.skinPhotoUrl,
                  aiConditionName: appt.aiConditionName || appt.conditionName,
                  aiConfidence: appt.aiConfidence,
                });
              }
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

    // 1. Supabase Realtime channel for instant live updates when clinic assigns
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

  // Mark appointment completed
  const markAppointmentDone = async (appointmentId: string) => {
    try {
      await supabase
        .from("patient_appointment")
        .update({
          status: "completed",
        })
        .eq("appointment_id", appointmentId);

      try {
        const stored = localStorage.getItem("dermai_clinic_appointments");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            const next = parsed.map((a: any) =>
              a.id === appointmentId ? { ...a, status: "completed" } : a
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
