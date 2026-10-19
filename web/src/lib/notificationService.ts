import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";
import { getLocalHelpdeskTickets } from "./store";

export type NotificationRole = "patient" | "doctor" | "clinic" | "admin";

export type NotificationCategory =
  | "appointment"
  | "ticket"
  | "broadcast"
  | "subscription"
  | "clinic"
  | "user"
  | "scan"
  | "system";

export interface NotificationItem {
  id: string;
  type: string;
  category: NotificationCategory;
  title: string;
  message: string;
  senderName?: string;
  senderType?: "clinic" | "admin" | "doctor" | "system" | "patient" | "user";
  senderAvatar?: string | null;
  link?: string;
  timestamp: string;
  isRead: boolean;
  metadata?: Record<string, any>;
}

export interface PatientNotificationPayload {
  userId: string;
  type:
    | "appointment-scheduled"
    | "appointment-rejected"
    | "appointment-completed"
    | "appointment-reschedule-needed"
    | "appointment-reschedule-declined"
    | "doctor-assigned"
    | "scan-completed"
    | "broadcast"
    | "system";
  subtype?: string;
  title: string;
  body: string;
}

const LOCAL_NOTIF_PREFIX = "dermai_patient_notifications_";

function getReadIds(role: NotificationRole, userId?: string): Set<string> {
  try {
    const key = `dermai_${role}_read_ids_${userId || "default"}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr);
    }
  } catch {}
  return new Set();
}

function saveReadId(role: NotificationRole, id: string, userId?: string) {
  try {
    const key = `dermai_${role}_read_ids_${userId || "default"}`;
    const set = getReadIds(role, userId);
    set.add(id);
    localStorage.setItem(key, JSON.stringify(Array.from(set)));
  } catch {}
}

function saveAllReadIds(role: NotificationRole, ids: string[], userId?: string) {
  try {
    const key = `dermai_${role}_read_ids_${userId || "default"}`;
    const set = getReadIds(role, userId);
    ids.forEach((id) => set.add(id));
    localStorage.setItem(key, JSON.stringify(Array.from(set)));
  } catch {}
}

/**
 * ----------------------------------------------------------------------------
 * PATIENT NOTIFICATIONS
 * Strict Privacy: user_id = auth.uid()
 * Sender Masking: When notifying about appointments, ALWAYS show Clinic Name!
 * ----------------------------------------------------------------------------
 */
export async function fetchPatientNotifications(userId: string): Promise<NotificationItem[]> {
  if (!userId) return [];
  const readSet = getReadIds("patient", userId);
  const items: NotificationItem[] = [];

  try {
    // 1. Direct user_notification records for this patient
    const { data: dbNotifs } = await supabase
      .from("user_notification")
      .select("notif_id, type, subtype, title, body, is_read, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30);

    if (dbNotifs) {
      dbNotifs.forEach((n) => {
        items.push({
          id: n.notif_id,
          type: n.type || "system",
          category: n.type?.includes("appointment")
            ? "appointment"
            : n.type?.includes("ticket")
            ? "ticket"
            : "system",
          title: n.title,
          message: n.body || "",
          senderType: (n.subtype as any) || "system",
          timestamp: n.created_at,
          isRead: Boolean(n.is_read || readSet.has(n.notif_id)),
        });
      }      );
    }

    // 2. Live Patient Appointments (with Clinic Name joined)
    const { data: appointments } = await supabase
      .from("patient_appointment")
      .select(`
        appointment_id,
        date,
        time,
        status,
        doctor_status,
        doctor_note,
        clinic_note,
        created_at,
        assigned_doctor_id,
        clinic:clinic_id (name, logo_url)
      `)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (appointments) {
      appointments.forEach((appt: any) => {
        const clinicObj = Array.isArray(appt.clinic) ? appt.clinic[0] : appt.clinic;
        const clinicName = clinicObj?.name || "Clinic";
        const clinicLogo = clinicObj?.logo_url || null;
        const dateStr = appt.date
          ? new Date(appt.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
          : "your scheduled date";
        const timeStr = appt.time ? ` at ${appt.time}` : "";

        // A. Confirmed / Accepted Appointment
        if (appt.status === "confirmed" || appt.doctor_status === "approved") {
          const notifId = `appt-accepted-${appt.appointment_id}`;
          items.push({
            id: notifId,
            type: "appointment-accepted",
            category: "appointment",
            title: `Appointment Confirmed`,
            message: `Your appointment at ${clinicName} on ${dateStr}${timeStr} has been confirmed.`,
            senderName: clinicName,
            senderType: "clinic",
            senderAvatar: clinicLogo,
            link: "/dashboard/appointment-status",
            timestamp: appt.created_at || new Date().toISOString(),
            isRead: readSet.has(notifId),
            metadata: { appointment_id: appt.appointment_id },
          });
        }

        // B. Rejected / Cancelled Appointment
        if (appt.status === "cancelled" || appt.doctor_status === "rejected") {
          const notifId = `appt-rejected-${appt.appointment_id}`;
          const noteText = appt.doctor_note ? ` Note: "${appt.doctor_note}".` : "";
          const rejectMsg = `Your appointment request at ${clinicName} on ${dateStr} was declined.${noteText} You can select another available doctor within 24 hours. If no selection is made within 24 hours, the clinic will automatically assign an available doctor to your booking.`;

          items.push({
            id: notifId,
            type: "appointment-rejected",
            category: "appointment",
            title: `Appointment Declined`,
            message: rejectMsg,
            senderName: clinicName,
            senderType: "clinic",
            senderAvatar: clinicLogo,
            link: "/dashboard/appointment-status",
            timestamp: appt.created_at || new Date().toISOString(),
            isRead: readSet.has(notifId),
            metadata: {
              appointment_id: appt.appointment_id,
              expires_at: new Date(new Date(appt.created_at || Date.now()).getTime() + 24 * 3600 * 1000).toISOString(),
            },
          });
        }

        // C. Completed Consultation
        if (appt.status === "completed") {
          const notifId = `appt-completed-${appt.appointment_id}`;
          items.push({
            id: notifId,
            type: "appointment-completed",
            category: "appointment",
            title: `Consultation Completed`,
            message: `Your consultation at ${clinicName} has been concluded. Your doctor notes and final diagnosis are ready for review.`,
            senderName: clinicName,
            senderType: "clinic",
            senderAvatar: clinicLogo,
            link: "/dashboard/history",
            timestamp: appt.created_at || new Date().toISOString(),
            isRead: readSet.has(notifId),
            metadata: { appointment_id: appt.appointment_id },
          });
        }
      });
    }

    // 3. Support Ticket Updates for this patient
    const { data: tickets } = await supabase
      .from("user_support_ticket")
      .select("ticket_id, subject, response, status, updated_at, created_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(10);

    if (tickets) {
      tickets.forEach((ticket: any) => {
        if (ticket.response || ticket.status !== "open") {
          const notifId = `ticket-update-${ticket.ticket_id}`;
          const replySummary = ticket.response ? ` Response: "${ticket.response}"` : "";
          items.push({
            id: notifId,
            type: "ticket-updated",
            category: "ticket",
            title: `Support Ticket Updated`,
            message: `Your ticket "${ticket.subject}" is now ${ticket.status}.${replySummary}`,
            senderName: "DERMAI Support",
            senderType: "admin",
            link: "/dashboard/settings/help",
            timestamp: ticket.updated_at || ticket.created_at,
            isRead: readSet.has(notifId),
            metadata: { ticket_id: ticket.ticket_id },
          });
        }
      });
    }

    // 4. Platform Broadcasts for patients
    const { data: broadcasts } = await supabase
      .from("admin_broadcast")
      .select("broadcast_id, title, message, audience, sent_at")
      .in("audience", ["all", "patients"])
      .order("sent_at", { ascending: false })
      .limit(10);

    if (broadcasts) {
      broadcasts.forEach((b: any) => {
        const notifId = `broadcast-${b.broadcast_id}`;
        items.push({
          id: notifId,
          type: "broadcast",
          category: "broadcast",
          title: b.title,
          message: b.message,
          senderName: "DERMAI Team",
          senderType: "admin",
          timestamp: b.sent_at,
          isRead: readSet.has(notifId),
        });
      });
    }
  } catch (err) {
    console.warn("[notificationService] Error fetching patient notifications:", err);
  }

  // De-duplicate by ID and sort newest first
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  return unique.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/**
 * ----------------------------------------------------------------------------
 * DOCTOR NOTIFICATIONS
 * Strict Privacy: Doctor ID or User ID isolation
 * Direct DB Queries:
 * - Direct appointment requests
 * - Clinic-assigned appointments for acceptance/rejection
 * - Support ticket updates
 * - Broadcasts for medical staff
 * ----------------------------------------------------------------------------
 */
export async function fetchDoctorNotifications(userId: string, userEmail?: string): Promise<NotificationItem[]> {
  if (!userId) return [];
  const readSet = getReadIds("doctor", userId);
  const items: NotificationItem[] = [];

  try {
    // 1. Resolve Doctor ID from clinic_doctor table
    const docIds: string[] = [userId];
    const { data: docRecords } = await supabase
      .from("clinic_doctor")
      .select("doctor_id, doctor_name, clinic_id, email, user_id, clinic:clinic_id(name)");

    let currentClinicName = "Clinic";
    (docRecords || []).forEach((d: any) => {
      const matchUserId = d.user_id && d.user_id === userId;
      const matchEmail = userEmail && d.email && d.email.toLowerCase() === userEmail.toLowerCase();
      if (matchUserId || matchEmail) {
        if (d.doctor_id) docIds.push(d.doctor_id);
        const cObj = Array.isArray(d.clinic) ? d.clinic[0] : d.clinic;
        if (cObj?.name) currentClinicName = cObj.name;
      }
    });

    const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
    const validDoctorIds = Array.from(new Set(docIds.filter(isUuid)));

    // 2. Fetch Doctor's Assigned Appointments
    if (validDoctorIds.length > 0) {
      const { data: appointments } = await supabase
        .from("patient_appointment")
        .select(`
          appointment_id,
          date,
          time,
          status,
          doctor_status,
          patient_name,
          ai_condition_name,
          schedule_sent_to_doctor,
          created_at,
          clinic:clinic_id(name)
        `)
        .in("assigned_doctor_id", validDoctorIds)
        .order("created_at", { ascending: false })
        .limit(20);

      if (appointments) {
        appointments.forEach((appt: any) => {
          const patient = appt.patient_name || "A patient";
          const condition = appt.ai_condition_name ? ` for ${appt.ai_condition_name}` : "";
          const dateStr = appt.date
            ? new Date(appt.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "scheduled date";
          const cObj = Array.isArray(appt.clinic) ? appt.clinic[0] : appt.clinic;
          const clinic = cObj?.name || currentClinicName;

          // A. Pending review / decision
          if (appt.doctor_status === "pending" || !appt.doctor_status) {
            const notifId = `doc-req-${appt.appointment_id}`;
            const isDelegated = Boolean(appt.schedule_sent_to_doctor);
            items.push({
              id: notifId,
              type: isDelegated ? "appointment-delegated" : "appointment-request",
              category: "appointment",
              title: isDelegated ? "Assigned by Clinic" : "New Booking Request",
              message: isDelegated
                ? `${clinic} assigned ${patient}'s booking${condition} on ${dateStr} to your review list.`
                : `${patient} requested a consultation${condition} on ${dateStr}. Please accept or decline.`,
              senderName: isDelegated ? clinic : patient,
              senderType: isDelegated ? "clinic" : "patient",
              link: "/doctor/appointments",
              timestamp: appt.created_at || new Date().toISOString(),
              isRead: readSet.has(notifId),
              metadata: { appointment_id: appt.appointment_id },
            });
          }

          // B. Confirmed / upcoming consultation
          if (appt.doctor_status === "approved" && appt.status !== "completed") {
            const notifId = `doc-confirmed-${appt.appointment_id}`;
            items.push({
              id: notifId,
              type: "appointment-confirmed",
              category: "appointment",
              title: "Scheduled Consultation",
              message: `${patient} is confirmed for consultation${condition} on ${dateStr}.`,
              senderName: patient,
              senderType: "patient",
              link: "/doctor/scheduled",
              timestamp: appt.created_at || new Date().toISOString(),
              isRead: readSet.has(notifId),
              metadata: { appointment_id: appt.appointment_id },
            });
          }
        });
      }
    }

    // 3. Support Tickets submitted by Doctor
    const { data: tickets } = await supabase
      .from("user_support_ticket")
      .select("ticket_id, subject, response, status, updated_at, created_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(10);

    if (tickets) {
      tickets.forEach((ticket: any) => {
        if (ticket.response || ticket.status !== "open") {
          const notifId = `doc-ticket-${ticket.ticket_id}`;
          items.push({
            id: notifId,
            type: "ticket-updated",
            category: "ticket",
            title: `Support Ticket Updated`,
            message: `Ticket "${ticket.subject}" status is now ${ticket.status}.${ticket.response ? ` Note: "${ticket.response}"` : ""}`,
            senderName: "DERMAI Admin",
            senderType: "admin",
            timestamp: ticket.updated_at || ticket.created_at,
            isRead: readSet.has(notifId),
            metadata: { ticket_id: ticket.ticket_id },
          });
        }
      });
    }

    // 4. Staff Broadcasts
    const { data: broadcasts } = await supabase
      .from("admin_broadcast")
      .select("broadcast_id, title, message, audience, sent_at")
      .in("audience", ["all", "doctors"])
      .order("sent_at", { ascending: false })
      .limit(10);

    if (broadcasts) {
      broadcasts.forEach((b: any) => {
        const notifId = `doc-broadcast-${b.broadcast_id}`;
        items.push({
          id: notifId,
          type: "broadcast",
          category: "broadcast",
          title: b.title,
          message: b.message,
          senderName: "DERMAI Admin",
          senderType: "admin",
          timestamp: b.sent_at,
          isRead: readSet.has(notifId),
        });
      });
    }

    // 5. Direct User Notifications for Doctor
    const { data: directNotifs } = await supabase
      .from("user_notification")
      .select("notif_id, type, subtype, title, body, is_read, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(15);

    if (directNotifs) {
      directNotifs.forEach((n) => {
        items.push({
          id: n.notif_id,
          type: n.type || "system",
          category: "system",
          title: n.title,
          message: n.body || "",
          senderType: (n.subtype as any) || "system",
          timestamp: n.created_at,
          isRead: Boolean(n.is_read || readSet.has(n.notif_id)),
        });
      });
    }
  } catch (err) {
    console.warn("[notificationService] Error fetching doctor notifications:", err);
  }

  const seen = new Set<string>();
  const unique = items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  return unique.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/**
 * ----------------------------------------------------------------------------
 * CLINIC NOTIFICATIONS
 * Strict Privacy: Clinic ID isolation
 * Direct DB Queries:
 * - New appointment requests
 * - Doctor actions (accepted, rejected)
 * - Re-selection alerts
 * - Consultation completed
 * - Support ticket updates
 * - Broadcasts for clinics
 * ----------------------------------------------------------------------------
 */
export async function fetchClinicNotifications(
  clinicId: string,
  userId?: string,
  clinicEmail?: string
): Promise<NotificationItem[]> {
  const readSet = getReadIds("clinic", userId || clinicId);
  const items: NotificationItem[] = [];

  try {
    let resolvedClinicId = clinicId;

    // If clinicId is not provided, look up by owner user_id or email
    if (!resolvedClinicId && (userId || clinicEmail)) {
      let query = supabase.from("clinic").select("clinic_id");
      if (userId) {
        query = query.eq("owner_user_id", userId);
      } else if (clinicEmail) {
        query = query.ilike("email", clinicEmail);
      }
      const { data: clinicRow } = await query.maybeSingle();
      if (clinicRow?.clinic_id) resolvedClinicId = clinicRow.clinic_id;
    }

    if (resolvedClinicId) {
      // 1. Live Appointments for this clinic
      const { data: appointments } = await supabase
        .from("patient_appointment")
        .select(`
          appointment_id,
          date,
          time,
          status,
          doctor_status,
          patient_name,
          ai_condition_name,
          needs_patient_reschedule,
          reschedule_requested,
          created_at,
          assigned_doctor_id,
          doctor:assigned_doctor_id (doctor_name)
        `)
        .eq("clinic_id", resolvedClinicId)
        .order("created_at", { ascending: false })
        .limit(30);

      if (appointments) {
        appointments.forEach((appt: any) => {
          const patient = appt.patient_name || "A patient";
          const docObj = Array.isArray(appt.doctor) ? appt.doctor[0] : appt.doctor;
          const doctorName = docObj?.doctor_name || "Assigned doctor";
          const condition = appt.ai_condition_name ? ` for ${appt.ai_condition_name}` : "";
          const dateStr = appt.date
            ? new Date(appt.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "scheduled date";

          // A. New Appointment Request
          if (appt.status === "pending" && !appt.doctor_status) {
            const notifId = `clinic-req-${appt.appointment_id}`;
            items.push({
              id: notifId,
              type: "appointment-request",
              category: "appointment",
              title: "New Appointment Request",
              message: `${patient} requested a new consultation${condition} on ${dateStr}.`,
              senderName: patient,
              senderType: "patient",
              link: "/clinic/appointments",
              timestamp: appt.created_at || new Date().toISOString(),
              isRead: readSet.has(notifId),
              metadata: { appointment_id: appt.appointment_id },
            });
          }

          // B. Doctor Action: Accepted
          if (appt.doctor_status === "approved") {
            const notifId = `clinic-doc-accept-${appt.appointment_id}`;
            items.push({
              id: notifId,
              type: "doctor-accepted",
              category: "appointment",
              title: "Doctor Accepted Appointment",
              message: `${doctorName} accepted the booking for ${patient} on ${dateStr}.`,
              senderName: doctorName,
              senderType: "doctor",
              link: "/clinic/appointments",
              timestamp: appt.created_at || new Date().toISOString(),
              isRead: readSet.has(notifId),
              metadata: { appointment_id: appt.appointment_id },
            });
          }

          // C. Doctor Action: Rejected
          if (appt.doctor_status === "rejected" || appt.status === "cancelled") {
            const notifId = `clinic-doc-reject-${appt.appointment_id}`;
            items.push({
              id: notifId,
              type: "doctor-rejected",
              category: "appointment",
              title: "Doctor Declined Appointment",
              message: `${doctorName} declined the booking for ${patient}. The patient has 24 hours to re-select or the clinic may re-assign.`,
              senderName: doctorName,
              senderType: "doctor",
              link: "/clinic/appointments",
              timestamp: appt.created_at || new Date().toISOString(),
              isRead: readSet.has(notifId),
              metadata: { appointment_id: appt.appointment_id },
            });
          }

          // D. Patient Re-selection / Reschedule Alert
          if (appt.needs_patient_reschedule || appt.reschedule_requested) {
            const notifId = `clinic-reselect-${appt.appointment_id}`;
            items.push({
              id: notifId,
              type: "patient-reselection",
              category: "appointment",
              title: "Patient Doctor Re-selection",
              message: `${patient} selected an alternate doctor or updated their requested schedule.`,
              senderName: patient,
              senderType: "patient",
              link: "/clinic/appointments",
              timestamp: appt.created_at || new Date().toISOString(),
              isRead: readSet.has(notifId),
              metadata: { appointment_id: appt.appointment_id },
            });
          }

          // E. Consultation Completed
          if (appt.status === "completed") {
            const notifId = `clinic-complete-${appt.appointment_id}`;
            items.push({
              id: notifId,
              type: "consultation-completed",
              category: "appointment",
              title: "Consultation Completed",
              message: `${doctorName} completed consultation notes and final diagnosis for ${patient}.`,
              senderName: doctorName,
              senderType: "doctor",
              link: "/clinic/appointments",
              timestamp: appt.created_at || new Date().toISOString(),
              isRead: readSet.has(notifId),
              metadata: { appointment_id: appt.appointment_id },
            });
          }
        });
      }
    }

    // 2. Support Tickets submitted by Clinic Owner
    if (userId) {
      const { data: tickets } = await supabase
        .from("user_support_ticket")
        .select("ticket_id, subject, response, status, updated_at, created_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(10);

      if (tickets) {
        tickets.forEach((ticket: any) => {
          if (ticket.response || ticket.status !== "open") {
            const notifId = `clinic-ticket-${ticket.ticket_id}`;
            items.push({
              id: notifId,
              type: "ticket-updated",
              category: "ticket",
              title: `Support Ticket Updated`,
              message: `Your ticket "${ticket.subject}" is now ${ticket.status}.${ticket.response ? ` Note: "${ticket.response}"` : ""}`,
              senderName: "DERMAI Admin",
              senderType: "admin",
              timestamp: ticket.updated_at || ticket.created_at,
              isRead: readSet.has(notifId),
              metadata: { ticket_id: ticket.ticket_id },
            });
          }
        });
      }

      // 3. User Notifications for Clinic Owner
      const { data: userNotifs } = await supabase
        .from("user_notification")
        .select("notif_id, type, subtype, title, body, is_read, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(15);

      if (userNotifs) {
        userNotifs.forEach((n) => {
          items.push({
            id: n.notif_id,
            type: n.type || "system",
            category: "system",
            title: n.title,
            message: n.body || "",
            senderType: (n.subtype as any) || "system",
            timestamp: n.created_at,
            isRead: Boolean(n.is_read || readSet.has(n.notif_id)),
          });
        });
      }
    }

    // 4. Clinic Broadcast Announcements
    const { data: broadcasts } = await supabase
      .from("admin_broadcast")
      .select("broadcast_id, title, message, audience, sent_at")
      .in("audience", ["all", "clinics"])
      .order("sent_at", { ascending: false })
      .limit(10);

    if (broadcasts) {
      broadcasts.forEach((b: any) => {
        const notifId = `clinic-broadcast-${b.broadcast_id}`;
        items.push({
          id: notifId,
          type: "broadcast",
          category: "broadcast",
          title: b.title,
          message: b.message,
          senderName: "DERMAI Admin",
          senderType: "admin",
          timestamp: b.sent_at,
          isRead: readSet.has(notifId),
        });
      });
    }
  } catch (err) {
    console.warn("[notificationService] Error fetching clinic notifications:", err);
  }

  const seen = new Set<string>();
  const unique = items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  return unique.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/**
 * ----------------------------------------------------------------------------
 * ADMIN NOTIFICATIONS
 * Full Administrative System Events:
 * - Clinic application requests & verifications
 * - AI skin analysis scans completed by patients
 * - Doctor AI review validations
 * - Open support tickets across all roles
 * - Subscriptions & Billing events (successful, expired, cancelled)
 * - New user registrations (Patients & Doctors)
 * ----------------------------------------------------------------------------
 */
export async function fetchAdminNotifications(): Promise<NotificationItem[]> {
  const readSet = getReadIds("admin", "admin");
  const items: NotificationItem[] = [];

  try {
    // 0. Pre-load clinics, doctors, and users to resolve real avatars (logos, photos, user avatars)
    const [{ data: allClinics }, { data: allDoctors }, { data: allUsers }] = await Promise.all([
      supabase.from("clinic").select("clinic_id, name, logo_url, owner_user_id, email"),
      supabase.from("clinic_doctor").select("doctor_id, doctor_name, photo_url, user_id, email"),
      supabase.from("user").select("user_id, full_name, email, role, avatar_url"),
    ]);

    const clinicByOwner = new Map<string, string>();
    const clinicByEmail = new Map<string, string>();
    const clinicByName = new Map<string, string>();
    (allClinics || []).forEach((c: any) => {
      if (c.logo_url) {
        if (c.owner_user_id) clinicByOwner.set(c.owner_user_id, c.logo_url);
        if (c.email) clinicByEmail.set(c.email.trim().toLowerCase(), c.logo_url);
        if (c.name) {
          const norm = c.name.trim().toLowerCase();
          clinicByName.set(norm, c.logo_url);
          clinicByName.set(norm.replace(/\s+/g, ""), c.logo_url);
        }
      }
    });

    const docByUser = new Map<string, string>();
    const docByEmail = new Map<string, string>();
    const docByName = new Map<string, string>();
    (allDoctors || []).forEach((d: any) => {
      if (d.photo_url) {
        if (d.user_id) docByUser.set(d.user_id, d.photo_url);
        if (d.email) docByEmail.set(d.email.trim().toLowerCase(), d.photo_url);
        if (d.doctor_name) {
          const norm = d.doctor_name.trim().toLowerCase();
          docByName.set(norm, d.photo_url);
          docByName.set(norm.replace(/^(dr\.?|doctor)\s+/i, "").trim(), d.photo_url);
          docByName.set(norm.replace(/\s+/g, ""), d.photo_url);
        }
      }
    });

    const userById = new Map<string, any>();
    const userByEmail = new Map<string, any>();
    const userByName = new Map<string, any>();
    (allUsers || []).forEach((u: any) => {
      if (u.user_id) userById.set(u.user_id, u);
      if (u.email) userByEmail.set(u.email.trim().toLowerCase(), u);
      if (u.full_name) {
        const norm = u.full_name.trim().toLowerCase();
        userByName.set(norm, u);
        userByName.set(norm.replace(/\s+/g, ""), u);
      }
    });

    const resolveUserAvatar = (
      userObj?: { user_id?: string; avatar_url?: string | null; email?: string | null; role?: string | null; full_name?: string | null },
      fallbackName?: string
    ): string | null => {
      const uId = userObj?.user_id;
      const email = (userObj?.email || "").trim().toLowerCase();
      const rawName = (fallbackName || userObj?.full_name || "").trim().toLowerCase();
      const nameKey = rawName.replace(/\s+/g, "");

      // 1. Direct user avatar from object
      if (userObj?.avatar_url) return userObj.avatar_url;

      // 2. Direct user avatar from preloaded user record
      if (uId && userById.get(uId)?.avatar_url) return userById.get(uId).avatar_url;
      if (email && userByEmail.get(email)?.avatar_url) return userByEmail.get(email).avatar_url;
      if (rawName && userByName.get(rawName)?.avatar_url) return userByName.get(rawName).avatar_url;
      if (nameKey && userByName.get(nameKey)?.avatar_url) return userByName.get(nameKey).avatar_url;

      // 3. Clinic role or clinic name match -> clinic logo
      if (uId && clinicByOwner.has(uId)) return clinicByOwner.get(uId)!;
      if (email && clinicByEmail.has(email)) return clinicByEmail.get(email)!;
      if (rawName && clinicByName.has(rawName)) return clinicByName.get(rawName)!;
      if (nameKey && clinicByName.has(nameKey)) return clinicByName.get(nameKey)!;

      // 4. Doctor role or doctor name match -> doctor photo
      if (uId && docByUser.has(uId)) return docByUser.get(uId)!;
      if (email && docByEmail.has(email)) return docByEmail.get(email)!;
      if (rawName && docByName.has(rawName)) return docByName.get(rawName)!;
      if (nameKey && docByName.has(nameKey)) return docByName.get(nameKey)!;

      return null;
    };

    // 1. Pending Clinic Applications
    const { data: pendingClinics } = await supabase
      .from("clinic")
      .select("clinic_id, name, created_at, email, status, logo_url")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(10);

    if (pendingClinics) {
      pendingClinics.forEach((c: any) => {
        const notifId = `admin-clinic-app-${c.clinic_id}`;
        const avatar = c.logo_url || clinicByName.get(c.name?.trim().toLowerCase()) || null;
        items.push({
          id: notifId,
          type: "clinic-pending",
          category: "clinic",
          title: "New Clinic Application",
          message: `"${c.name}" submitted verification credentials awaiting administrative approval.`,
          senderName: c.name,
          senderType: "clinic",
          senderAvatar: avatar,
          link: "/admin/clinics",
          timestamp: c.created_at || new Date().toISOString(),
          isRead: readSet.has(notifId),
          metadata: { clinic_id: c.clinic_id },
        });
      });
    }

    // 2. Open Support Tickets Across All Roles
    const { data: tickets } = await supabase
      .from("user_support_ticket")
      .select(`
        ticket_id,
        subject,
        message,
        category,
        priority,
        created_at,
        status,
        user_id,
        user:user_id (user_id, full_name, email, role, avatar_url)
      `)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(15);

    if (tickets) {
      tickets.forEach((t: any) => {
        const userObj = Array.isArray(t.user) ? t.user[0] : t.user;
        const sender = userObj?.full_name || userObj?.email || "Platform User";
        const roleStr = userObj?.role ? ` (${userObj.role})` : "";
        const notifId = `admin-ticket-${t.ticket_id}`;
        const avatar = resolveUserAvatar(userObj, sender) || (t.user_id && clinicByOwner.get(t.user_id)) || null;

        items.push({
          id: notifId,
          type: "new-ticket",
          category: "ticket",
          title: `Support Ticket: ${t.subject || "User Inquiry"}`,
          message: `${sender}${roleStr} submitted an inquiry: "${(t.message || "").slice(0, 80)}..."`,
          senderName: sender,
          senderType: (userObj?.role as any) || "user",
          senderAvatar: avatar,
          link: "/admin/helpdesk",
          timestamp: t.created_at || new Date().toISOString(),
          isRead: readSet.has(notifId),
          metadata: { ticket_id: t.ticket_id },
        });
      });
    }

    // Merge session/localStorage tickets if any exist in the browser
    if (typeof window !== "undefined") {
      try {
        const localTkts = getLocalHelpdeskTickets();
        localTkts.forEach((lt) => {
          const notifId = `admin-ticket-${lt.id}`;
          if (!items.some((i) => i.id === notifId)) {
            const avatar = lt.avatarUrl || resolveUserAvatar({ user_id: lt.userId, email: lt.email }, lt.user);
            items.push({
              id: notifId,
              type: "new-ticket",
              category: "ticket",
              title: `Support Ticket: ${lt.subject || "User Inquiry"}`,
              message: `${lt.user} submitted an inquiry: "${(lt.message || "").slice(0, 80)}..."`,
              senderName: lt.user,
              senderType: "user",
              senderAvatar: avatar,
              link: "/admin/helpdesk",
              timestamp: lt.createdAt || new Date().toISOString(),
              isRead: readSet.has(notifId),
              metadata: { ticket_id: lt.id },
            });
          }
        });
      } catch {}
    }

    // 3. AI Skin Analysis Scans (Patients)
    const { data: scans } = await supabase
      .from("patient_appointment")
      .select(`
        appointment_id,
        patient_name,
        ai_condition_name,
        ai_confidence,
        created_at,
        user_id,
        user:user_id (user_id, full_name, avatar_url)
      `)
      .not("ai_condition_name", "is", null)
      .order("created_at", { ascending: false })
      .limit(10);

    if (scans) {
      scans.forEach((s: any) => {
        const userObj = Array.isArray(s.user) ? s.user[0] : s.user;
        const patient = s.patient_name || userObj?.full_name || "Patient";
        const notifId = `admin-scan-${s.appointment_id}`;
        const confPart = s.ai_confidence ? ` (${s.ai_confidence}% confidence)` : "";
        const avatar = resolveUserAvatar(userObj, patient) || (s.user_id ? userById.get(s.user_id)?.avatar_url : null);

        items.push({
          id: notifId,
          type: "scan-completed",
          category: "scan",
          title: "AI Skin Scan Completed",
          message: `${patient} performed an AI skin analysis identifying ${s.ai_condition_name}${confPart}.`,
          senderName: patient,
          senderType: "patient",
          senderAvatar: avatar,
          link: "/admin/ai-analyses",
          timestamp: s.created_at || new Date().toISOString(),
          isRead: readSet.has(notifId),
          metadata: { appointment_id: s.appointment_id },
        });
      });
    }

    // 4. Doctor AI Reviews
    const { data: reviews } = await supabase
      .from("patient_appointment")
      .select(`
        appointment_id,
        patient_name,
        ai_condition_name,
        doctor_status,
        doctor_note,
        created_at,
        assigned_doctor_id,
        doctor:assigned_doctor_id (doctor_id, doctor_name, photo_url)
      `)
      .not("doctor_status", "is", null)
      .order("created_at", { ascending: false })
      .limit(10);

    if (reviews) {
      reviews.forEach((r: any) => {
        const docObj = Array.isArray(r.doctor) ? r.doctor[0] : r.doctor;
        const doctorName = docObj?.doctor_name || "Doctor";
        const patient = r.patient_name || "Patient";
        const notifId = `admin-review-${r.appointment_id}`;
        const avatar = docObj?.photo_url || (r.assigned_doctor_id ? docByUser.get(r.assigned_doctor_id) : null) || resolveUserAvatar(undefined, doctorName);

        items.push({
          id: notifId,
          type: "doctor-review",
          category: "scan",
          title: "Doctor AI Review Logged",
          message: `${doctorName} validated clinical diagnosis for ${patient} (Outcome: ${r.doctor_status}).`,
          senderName: doctorName,
          senderType: "doctor",
          senderAvatar: avatar,
          link: "/admin/doctor-ai-review",
          timestamp: r.created_at || new Date().toISOString(),
          isRead: readSet.has(notifId),
          metadata: { appointment_id: r.appointment_id },
        });
      });
    }

    // 5. Subscription & Billing Events
    const { data: subs } = await supabase
      .from("user_plan_subscription")
      .select(`
        subscription_id,
        status,
        current_period_end,
        created_at,
        plan:plan_id (name, price),
        user:user_id (user_id, full_name, email, avatar_url)
      `)
      .order("created_at", { ascending: false })
      .limit(10);

    if (subs) {
      subs.forEach((sub: any) => {
        const uObj = Array.isArray(sub.user) ? sub.user[0] : sub.user;
        const pObj = Array.isArray(sub.plan) ? sub.plan[0] : sub.plan;
        const userName = uObj?.full_name || uObj?.email || "Subscriber";
        const planName = pObj?.name || "Premium Plan";
        const notifId = `admin-sub-${sub.subscription_id}`;
        const avatar = resolveUserAvatar(uObj, userName);

        let subTitle = "Subscription Event";
        let subMsg = `${userName} subscription update (${planName}).`;
        if (sub.status === "active") {
          subTitle = "New Subscription Payment";
          subMsg = `${userName} upgraded to ${planName} successfully.`;
        } else if (sub.status === "cancelled") {
          subTitle = "Subscription Cancelled";
          subMsg = `${userName} cancelled renewal for ${planName}.`;
        } else if (sub.status === "expired") {
          subTitle = "Subscription Expired";
          subMsg = `${userName}'s ${planName} subscription has expired.`;
        }

        items.push({
          id: notifId,
          type: `subscription-${sub.status}`,
          category: "subscription",
          title: subTitle,
          message: subMsg,
          senderName: userName,
          senderType: "user",
          senderAvatar: avatar,
          link: "/admin/subscriptions",
          timestamp: sub.created_at || new Date().toISOString(),
          isRead: readSet.has(notifId),
          metadata: { subscription_id: sub.subscription_id },
        });
      });
    }

    // 6. New User Registrations (Patients, Doctors, Clinics)
    const { data: newUsers } = await supabase
      .from("user")
      .select("user_id, full_name, email, role, avatar_url, created_at")
      .order("created_at", { ascending: false })
      .limit(12);

    if (newUsers) {
      newUsers.forEach((u: any) => {
        const notifId = `admin-user-${u.user_id}`;
        const name = u.full_name || u.email;
        const role = u.role || "patient";
        const avatar = resolveUserAvatar(u, name);

        let title = "New Patient Registered";
        if (role === "doctor") title = "New Doctor Onboarded";
        else if (role === "clinic") title = "New Clinic Registered";

        items.push({
          id: notifId,
          type: `new-${role}`,
          category: "user",
          title,
          message: `${name} registered on DERMAI as a ${role}.`,
          senderName: name,
          senderType: (role as any) || "user",
          senderAvatar: avatar,
          link: role === "clinic" ? "/admin/clinics" : "/admin/users",
          timestamp: u.created_at || new Date().toISOString(),
          isRead: readSet.has(notifId),
          metadata: { user_id: u.user_id },
        });
      });
    }

    // 7. General Admin Alerts / Notifications
    const { data: adminAlerts } = await supabase
      .from("admin_alert")
      .select("notif_id, type, title, message, is_read, created_at")
      .order("created_at", { ascending: false })
      .limit(10);

    if (adminAlerts) {
      adminAlerts.forEach((a: any) => {
        items.push({
          id: a.notif_id,
          type: a.type || "system",
          category: "system",
          title: a.title,
          message: a.message,
          senderType: "system",
          timestamp: a.created_at,
          isRead: Boolean(a.is_read || readSet.has(a.notif_id)),
        });
      });
    }
  } catch (err) {
    console.warn("[notificationService] Error fetching admin notifications:", err);
  }

  const seen = new Set<string>();
  const unique = items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  return unique.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/**
 * ----------------------------------------------------------------------------
 * Mark notification as read
 * ----------------------------------------------------------------------------
 */
export async function markNotificationAsRead(
  id: string,
  role: NotificationRole,
  userId?: string
): Promise<void> {
  saveReadId(role, id, userId);

  // If it's a UUID, also attempt to update user_notification table directly
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (isUuid) {
    try {
      await supabase.from("user_notification").update({ is_read: true }).eq("notif_id", id);
    } catch {}
    try {
      await supabase.from("admin_alert").update({ is_read: true }).eq("notif_id", id);
    } catch {}
  }
}

/**
 * ----------------------------------------------------------------------------
 * Mark all notifications as read
 * ----------------------------------------------------------------------------
 */
export async function markAllNotificationsAsRead(
  ids: string[],
  role: NotificationRole,
  userId?: string
): Promise<void> {
  saveAllReadIds(role, ids, userId);

  const uuidIds = ids.filter((id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  );

  if (uuidIds.length > 0) {
    try {
      await supabase.from("user_notification").update({ is_read: true }).in("notif_id", uuidIds);
    } catch {}
    try {
      await supabase.from("admin_alert").update({ is_read: true }).in("notif_id", uuidIds);
    } catch {}
  }
}

/**
 * ----------------------------------------------------------------------------
 * Reactive Hook for Real-time Role Notifications
 * ----------------------------------------------------------------------------
 */
export function useRoleNotifications(
  role: NotificationRole,
  config: { userId?: string; clinicId?: string; userEmail?: string }
) {
  const { userId, clinicId, userEmail } = config;
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [unreadCount, setUnreadCount] = useState<number>(0);

  const fetchFn = useCallback(async () => {
    try {
      let data: NotificationItem[] = [];
      if (role === "patient" && userId) {
        data = await fetchPatientNotifications(userId);
      } else if (role === "doctor" && userId) {
        data = await fetchDoctorNotifications(userId, userEmail);
      } else if (role === "clinic") {
        data = await fetchClinicNotifications(clinicId || "", userId, userEmail);
      } else if (role === "admin") {
        data = await fetchAdminNotifications();
      }
      setNotifications(data);
      setUnreadCount(data.filter((n) => !n.isRead).length);
    } finally {
      setLoading(false);
    }
  }, [role, userId, clinicId, userEmail]);

  useEffect(() => {
    fetchFn();

    // Setup Realtime Channel
    const channelId = `role-notifs-${role}-${userId || clinicId || "admin"}-${Date.now()}`;
    const channel = supabase.channel(channelId);

    // Subscribe to all relevant tables based on role
    if (role === "patient" && userId) {
      channel
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "patient_appointment", filter: `user_id=eq.${userId}` },
          () => fetchFn()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "user_notification", filter: `user_id=eq.${userId}` },
          () => fetchFn()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "user_support_ticket", filter: `user_id=eq.${userId}` },
          () => fetchFn()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "admin_broadcast" },
          () => fetchFn()
        );
    } else if (role === "doctor") {
      channel
        .on("postgres_changes", { event: "*", schema: "public", table: "patient_appointment" }, () => fetchFn())
        .on("postgres_changes", { event: "*", schema: "public", table: "user_notification" }, () => fetchFn())
        .on("postgres_changes", { event: "*", schema: "public", table: "admin_broadcast" }, () => fetchFn());
    } else if (role === "clinic" && clinicId) {
      channel
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "patient_appointment", filter: `clinic_id=eq.${clinicId}` },
          () => fetchFn()
        )
        .on("postgres_changes", { event: "*", schema: "public", table: "user_notification" }, () => fetchFn())
        .on("postgres_changes", { event: "*", schema: "public", table: "admin_broadcast" }, () => fetchFn());
    } else if (role === "admin") {
      channel
        .on("postgres_changes", { event: "*", schema: "public", table: "clinic" }, () => fetchFn())
        .on("postgres_changes", { event: "*", schema: "public", table: "user_support_ticket" }, () => fetchFn())
        .on("postgres_changes", { event: "*", schema: "public", table: "patient_appointment" }, () => fetchFn())
        .on("postgres_changes", { event: "*", schema: "public", table: "user_plan_subscription" }, () => fetchFn())
        .on("postgres_changes", { event: "*", schema: "public", table: "user" }, () => fetchFn());
    }

    channel.subscribe();

    const handleCustomUpdate = () => fetchFn();
    window.addEventListener("dermai_notifications_updated", handleCustomUpdate);
    window.addEventListener("storage", handleCustomUpdate);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("dermai_notifications_updated", handleCustomUpdate);
      window.removeEventListener("storage", handleCustomUpdate);
    };
  }, [fetchFn, role, userId, clinicId]);

  const markRead = useCallback(
    async (id: string) => {
      await markNotificationAsRead(id, role, userId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    },
    [role, userId]
  );

  const markAllRead = useCallback(async () => {
    const ids = notifications.map((n) => n.id);
    await markAllNotificationsAsRead(ids, role, userId);
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
  }, [notifications, role, userId]);

  return {
    notifications,
    loading,
    unreadCount,
    refresh: fetchFn,
    markRead,
    markAllRead,
  };
}

/**
 * Legacy support for createPatientNotification
 */
export async function createPatientNotification(payload: PatientNotificationPayload): Promise<boolean> {
  const { userId, type, subtype, title, body } = payload;
  if (!userId) return false;

  try {
    const { error } = await supabase.from("user_notification").insert({
      user_id: userId,
      type,
      subtype: subtype || null,
      title,
      body,
      is_read: false,
    });
    if (error) {
      console.warn("[notificationService] Supabase insert warning:", error.message);
      return false;
    }
    window.dispatchEvent(new CustomEvent("dermai_notifications_updated"));
    return true;
  } catch (err: any) {
    console.warn("[notificationService] Notification dispatch error:", err?.message || err);
    return false;
  }
}

export function getCachedPatientNotifications(userId: string) {
  try {
    const key = `${LOCAL_NOTIF_PREFIX}${userId}`;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
