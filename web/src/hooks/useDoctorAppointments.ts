import { useState, useEffect, useCallback } from "react";
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

  const fetchAppointments = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // 1. Identify doctor accounts linked to current user
      const userEmail = user.email || "";
      setDoctorEmail(userEmail);
      const foundDoctorIds: string[] = [];
      let docDisplayName = user.user_metadata?.full_name || "Doctor";
      let docClinicName = "DermAI Clinic";

      // Check doctors table
      const { data: docData } = await supabase
        .from("doctors")
        .select("id, name, clinic_name, clinic_doctor_id")
        .or(`user_id.eq.${user.id},email.eq.${userEmail}`);

      if (docData && docData.length > 0) {
        docData.forEach((d) => {
          if (d.id) foundDoctorIds.push(d.id);
          if (d.clinic_doctor_id) foundDoctorIds.push(d.clinic_doctor_id);
          if (d.name) docDisplayName = d.name;
          if (d.clinic_name) docClinicName = d.clinic_name;
        });
      }

      // Check clinic_doctor table
      const { data: clinicDocData } = await supabase
        .from("clinic_doctor")
        .select("doctor_id, doctor_name, clinic_id, clinic:clinic_id(name)")
        .or(`user_id.eq.${user.id},invite_email.eq.${userEmail}`);

      if (clinicDocData && clinicDocData.length > 0) {
        clinicDocData.forEach((cd) => {
          if (cd.doctor_id) foundDoctorIds.push(cd.doctor_id);
          if (cd.doctor_name) docDisplayName = cd.doctor_name;
          const clinicObj: any = Array.isArray(cd.clinic) ? cd.clinic[0] : cd.clinic;
          if (clinicObj?.name) docClinicName = clinicObj.name;
        });
      }

      setDoctorName(docDisplayName);
      setDoctorClinic(docClinicName);
      const uniqueDoctorIds = Array.from(new Set(foundDoctorIds));
      setDoctorIds(uniqueDoctorIds);

      // 2. Fetch appointments assigned to this doctor
      let query = supabase
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
          doctor_id,
          schedule_sent_to_doctor,
          doctor_status,
          doctor_note,
          doctor_reviewed_at,
          clinic:clinic_id (
            name
          )
        `)
        .order("created_at", { ascending: false });

      if (uniqueDoctorIds.length > 0) {
        const idList = uniqueDoctorIds.join(",");
        query = query.or(`assigned_doctor_id.in.(${idList}),doctor_id.in.(${idList})`);
      }

      const { data: apptRows, error } = await query;

      if (!error && apptRows) {
        // Resolve private bucket signed URLs for skin_photo_url
        const resolved: DoctorAppointmentRecord[] = await Promise.all(
          apptRows.map(async (row: any) => {
            let photoUrl = row.skin_photo_url || undefined;
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

            const rawDate = row.date;
            let dateStr = "";
            let timeStr = "";
            if (rawDate) {
              const d = new Date(rawDate);
              dateStr = d.toISOString().split("T")[0];
              timeStr = d.toTimeString().slice(0, 5);
            }

            const clinicObj: any = Array.isArray(row.clinic) ? row.clinic[0] : row.clinic;

            return {
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
              status: row.status as any,
              assignedDoctorId: row.assigned_doctor_id || row.doctor_id,
              assignedDoctorName: docDisplayName,
              doctorStatus: row.doctor_status || "pending-review",
              doctorNote: row.doctor_note || "",
              doctorDiagnosis: row.ai_condition_name || "",
              doctorReviewedAt: row.doctor_reviewed_at || undefined,
              scheduleSentToDoctor: Boolean(row.schedule_sent_to_doctor),
              doctorDone: row.status === "completed",
              createdAt: row.created_at,
              skinPhotoUrl: photoUrl,
              aiConditionName: row.ai_condition_name || undefined,
              aiConfidence: row.ai_confidence ? Number(row.ai_confidence) : undefined,
            };
          })
        );
        setAppointments(resolved);
      } else {
        setAppointments([]);
      }
    } catch {
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  // Doctor review action
  const submitDoctorReview = async (
    appointmentId: string,
    decision: "approved" | "rejected",
    diagnosis: string,
    note: string
  ) => {
    try {
      await supabase
        .from("patient_appointment")
        .update({
          doctor_status: decision,
          doctor_note: note,
          ai_condition_name: diagnosis,
          doctor_reviewed_at: new Date().toISOString(),
        })
        .eq("appointment_id", appointmentId);

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
