import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";
import { getLocalHelpdeskTickets } from "./store";
import { logAuditEvent } from "./auditLog";

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
      .select("notif_id, type, subtype, title, body, is_read, created_at, metadata")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(40);

    if (dbNotifs) {
      dbNotifs.forEach((n) => {
        const isBroadcast = n.type === "broadcast" || n.subtype === "admin_announcement";
        const isMaintenance = n.subtype === "maintenance_alert" || n.type === "maintenance_alert";
        const isTicket = n.type === "support_ticket" || n.type?.includes("ticket");
        const isAdminSystem = isBroadcast || isMaintenance;

        items.push({
          id: n.notif_id,
          type: n.type || "system",
          category: n.type?.includes("appointment")
            ? "appointment"
            : isTicket
            ? "ticket"
            : isBroadcast
            ? "broadcast"
            : "system",
          title: n.title,
          message: n.body || "",
          senderName:
            (n.metadata as any)?.sender_name ||
            (isTicket ? "DERMAI Support" : isAdminSystem ? "Platform Administrator" : (n.subtype as any) || "DERMAI Support"),
          senderType: isTicket || isAdminSystem ? "admin" : (n.subtype as any) || "system",
          link: isTicket ? "/dashboard/settings/help" : undefined,
          timestamp: n.created_at,
          isRead: Boolean(n.is_read || readSet.has(n.notif_id)),
          metadata: {
            ...n.metadata,
            subtype: n.subtype,
          },
        });
      });
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
        const alreadyNotified = items.some(
          (i) => i.metadata?.ticket_id === ticket.ticket_id
        );
        if (
          !alreadyNotified &&
          (ticket.response ||
            (ticket.status !== "open" &&
              ticket.status !== "pending" &&
              ticket.status !== "submitted"))
        ) {
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
      .in("audience", ["all", "patients", "patient"])
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
          senderName: "Platform Administrator",
          senderType: "admin",
          timestamp: b.sent_at,
          isRead: readSet.has(notifId),
          metadata: {
            broadcast_id: b.broadcast_id,
            subtype: "admin_announcement",
          },
        });
      });
    }
  } catch (err) {
    console.warn("[notificationService] Error fetching patient notifications:", err);
  }

  // De-duplicate by ID and broadcast_id, and sort newest first
  const seen = new Set<string>();
  const seenBroadcastIds = new Set<string>();
  const unique = items.filter((item) => {
    if (seen.has(item.id)) return false;
    const bId = item.metadata?.broadcast_id;
    if (bId) {
      if (seenBroadcastIds.has(bId)) return false;
      seenBroadcastIds.add(bId);
    }
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

    // Fetch platform admin avatar for admin-sent notifications (support tickets, broadcasts)
    let adminAvatar: string | undefined = undefined;
    try {
      const { data: adminUser } = await supabase
        .from("user")
        .select("avatar_url")
        .eq("role", "admin")
        .not("avatar_url", "is", null)
        .limit(1)
        .maybeSingle();
      if (adminUser?.avatar_url) {
        adminAvatar = adminUser.avatar_url;
      }
    } catch {}

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
          patient_email,
          ai_condition_name,
          schedule_sent_to_doctor,
          created_at,
          user_id,
          user:user_id(avatar_url, full_name),
          clinic:clinic_id(name, logo_url)
        `)
        .in("assigned_doctor_id", validDoctorIds)
        .order("created_at", { ascending: false })
        .limit(20);

      if (appointments) {
        // Collect missing user_ids for patients without avatar from relational join
        const missingUserIds = Array.from(
          new Set(
            appointments
              .filter((a: any) => !(Array.isArray(a.user) ? a.user[0] : a.user)?.avatar_url)
              .map((a: any) => a.user_id)
              .filter(Boolean)
          )
        );

        const fallbackAvatarMap = new Map<string, string>();
        if (missingUserIds.length > 0) {
          try {
            const { data: userRows } = await supabase
              .from("user")
              .select("user_id, email, full_name, avatar_url")
              .in("user_id", missingUserIds);
            (userRows || []).forEach((u: any) => {
              if (u.avatar_url) {
                fallbackAvatarMap.set(u.user_id, u.avatar_url);
              }
            });
          } catch {}
        }

        appointments.forEach((appt: any) => {
          const patient = appt.patient_name || "A patient";
          const condition = appt.ai_condition_name ? ` for ${appt.ai_condition_name}` : "";
          const dateStr = appt.date
            ? new Date(appt.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "scheduled date";
          const cObj = Array.isArray(appt.clinic) ? appt.clinic[0] : appt.clinic;
          const clinic = cObj?.name || currentClinicName;
          const clinicLogo = cObj?.logo_url || undefined;

          const uObj = Array.isArray(appt.user) ? appt.user[0] : appt.user;
          const patientAvatar =
            uObj?.avatar_url ||
            (appt.user_id ? fallbackAvatarMap.get(appt.user_id) : undefined) ||
            undefined;

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
              senderAvatar: isDelegated ? (clinicLogo || undefined) : (patientAvatar || undefined),
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
              senderAvatar: patientAvatar || undefined,
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
            senderAvatar: adminAvatar || undefined,
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
      .in("audience", ["all", "doctors", "doctor"])
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
          senderName: "Platform Administrator",
          senderType: "admin",
          senderAvatar: adminAvatar || undefined,
          timestamp: b.sent_at,
          isRead: readSet.has(notifId),
          metadata: {
            broadcast_id: b.broadcast_id,
            subtype: "admin_announcement",
          },
        });
      });
    }

    // 5. Direct User Notifications for Doctor
    const { data: directNotifs } = await supabase
      .from("user_notification")
      .select("notif_id, type, subtype, title, body, is_read, created_at, metadata")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(25);

    if (directNotifs) {
      directNotifs.forEach((n) => {
        const isBroadcast = n.type === "broadcast" || n.subtype === "admin_announcement";
        const isMaintenance = n.subtype === "maintenance_alert" || n.type === "maintenance_alert";
        const isAdminSystem = isBroadcast || isMaintenance;

        items.push({
          id: n.notif_id,
          type: n.type || "system",
          category: isBroadcast ? "broadcast" : "system",
          title: n.title,
          message: n.body || "",
          senderName:
            (n.metadata as any)?.sender_name ||
            (isAdminSystem ? "Platform Administrator" : "DERMAI Admin"),
          senderType: isAdminSystem ? "admin" : (n.subtype as any) || "system",
          senderAvatar: (n as any).metadata?.avatar_url || (isAdminSystem ? adminAvatar : undefined),
          timestamp: n.created_at,
          isRead: Boolean(n.is_read || readSet.has(n.notif_id)),
          metadata: {
            ...n.metadata,
            subtype: n.subtype,
          },
        });
      });
    }
  } catch (err) {
    console.warn("[notificationService] Error fetching doctor notifications:", err);
  }

  const seen = new Set<string>();
  const seenBroadcastIds = new Set<string>();
  const unique = items.filter((item) => {
    if (seen.has(item.id)) return false;
    const bId = item.metadata?.broadcast_id;
    if (bId) {
      if (seenBroadcastIds.has(bId)) return false;
      seenBroadcastIds.add(bId);
    }
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
    let resolvedUserId = userId;

    // Check localStorage cache if clinicId is still empty
    if (!resolvedClinicId && typeof window !== "undefined") {
      try {
        const cached = localStorage.getItem("dermai_clinic_profile_cache");
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed?.clinicId) resolvedClinicId = parsed.clinicId;
        }
        if (!resolvedClinicId) {
          const s = localStorage.getItem("dermai_clinic_settings");
          if (s) {
            const parsed = JSON.parse(s);
            if (parsed?.id) resolvedClinicId = parsed.id;
          }
        }
        if (!resolvedClinicId) {
          const apps = localStorage.getItem("dermai_clinic_applications");
          if (apps) {
            const parsed = JSON.parse(apps);
            if (Array.isArray(parsed) && parsed[0]?.id) resolvedClinicId = parsed[0].id;
          }
        }
      } catch {}
    }

    // If clinicId is not provided, look up by owner user_id or email
    if (!resolvedClinicId && (userId || clinicEmail)) {
      let query = supabase.from("clinic").select("clinic_id, name, owner_user_id, status, logo_url, created_at");
      if (userId) {
        query = query.eq("owner_user_id", userId);
      } else if (clinicEmail) {
        query = query.ilike("email", clinicEmail);
      }
      const { data: clinicRow } = await query.maybeSingle();
      if (clinicRow?.clinic_id) {
        resolvedClinicId = clinicRow.clinic_id;
        if (!resolvedUserId && clinicRow.owner_user_id) {
          resolvedUserId = clinicRow.owner_user_id;
        }
      }
    }

    // Fetch clinic metadata to verify owner and approval status
    let clinicRow: any = null;
    if (resolvedClinicId) {
      const { data: cRow } = await supabase
        .from("clinic")
        .select("clinic_id, name, owner_user_id, status, verified, logo_url, created_at")
        .eq("clinic_id", resolvedClinicId)
        .maybeSingle();
      if (cRow) {
        clinicRow = cRow;
        if (!resolvedUserId && cRow.owner_user_id) {
          resolvedUserId = cRow.owner_user_id;
        }
      }
    }

    // Pre-fetch live admin profile picture from public.user in Supabase
    let adminAvatar: string | null = null;
    try {
      const { data: adminUser } = await supabase
        .from("user")
        .select("avatar_url")
        .eq("role", "admin")
        .not("avatar_url", "is", null)
        .limit(1)
        .maybeSingle();
      if (adminUser?.avatar_url) {
        adminAvatar = adminUser.avatar_url;
      }
    } catch {}

    // 1. Live Appointments for this clinic directly from public.patient_appointment
    if (resolvedClinicId) {
      const { data: appointments, error: apptError } = await supabase
        .from("patient_appointment")
        .select(`
          appointment_id,
          date,
          time,
          status,
          doctor_status,
          patient_name,
          ai_condition_name,
          questionnaire_answers,
          created_at,
          user_id,
          user:user_id (avatar_url, full_name),
          assigned_doctor_id,
          doctor:assigned_doctor_id (doctor_name, photo_url)
        `)
        .eq("clinic_id", resolvedClinicId)
        .order("created_at", { ascending: false })
        .limit(30);

      if (apptError) {
        console.warn("[notificationService] Error querying patient_appointment:", apptError);
      } else if (appointments) {
        appointments.forEach((appt: any) => {
          const patient = appt.patient_name || "A patient";
          const uObj = Array.isArray(appt.user) ? appt.user[0] : appt.user;
          const patientAvatar = uObj?.avatar_url || undefined;

          const docObj = Array.isArray(appt.doctor) ? appt.doctor[0] : appt.doctor;
          const doctorName = docObj?.doctor_name || "Assigned doctor";
          const doctorAvatar = docObj?.photo_url || undefined;

          const condition = appt.ai_condition_name ? ` for ${appt.ai_condition_name}` : "";
          const dateStr = appt.date
            ? new Date(appt.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "scheduled date";

          const qAnswers = typeof appt.questionnaire_answers === "object" && appt.questionnaire_answers ? appt.questionnaire_answers : {};
          const needsReschedule = Boolean(qAnswers.needs_patient_reschedule || qAnswers.reschedule_requested);

          // A. New Appointment Request / Pending Doctor Review
          if (
            appt.status === "pending" ||
            appt.doctor_status === "pending-review" ||
            appt.doctor_status === "pending"
          ) {
            const notifId = `clinic-req-${appt.appointment_id}`;
            items.push({
              id: notifId,
              type: "appointment-request",
              category: "appointment",
              title: "New Appointment Request",
              message: `${patient} requested a consultation${condition} on ${dateStr}.`,
              senderName: patient,
              senderType: "patient",
              senderAvatar: patientAvatar,
              link: "/clinic/appointments",
              timestamp: appt.created_at || new Date().toISOString(),
              isRead: readSet.has(notifId),
              metadata: { appointment_id: appt.appointment_id },
            });
          }

          // B. Doctor Action: Accepted Booking
          if (appt.doctor_status === "approved" && appt.status !== "completed") {
            const notifId = `clinic-doc-accept-${appt.appointment_id}`;
            items.push({
              id: notifId,
              type: "doctor-accepted",
              category: "appointment",
              title: "Doctor Accepted Appointment",
              message: `${doctorName} accepted the booking for ${patient} on ${dateStr}.`,
              senderName: doctorName,
              senderType: "doctor",
              senderAvatar: doctorAvatar,
              link: "/clinic/appointments",
              timestamp: appt.created_at || new Date().toISOString(),
              isRead: readSet.has(notifId),
              metadata: { appointment_id: appt.appointment_id },
            });
          }

          // C. Doctor Action: Declined or Appointment Cancelled
          if (appt.doctor_status === "rejected" || appt.status === "cancelled") {
            const notifId = `clinic-doc-reject-${appt.appointment_id}`;
            items.push({
              id: notifId,
              type: "doctor-rejected",
              category: "appointment",
              title: appt.doctor_status === "rejected" ? "Doctor Declined Appointment" : "Appointment Cancelled",
              message: appt.doctor_status === "rejected"
                ? `${doctorName} declined the booking for ${patient}. The patient or clinic may reassign.`
                : `The appointment for ${patient} on ${dateStr} was cancelled.`,
              senderName: doctorName,
              senderType: "doctor",
              senderAvatar: doctorAvatar,
              link: "/clinic/appointments",
              timestamp: appt.created_at || new Date().toISOString(),
              isRead: readSet.has(notifId),
              metadata: { appointment_id: appt.appointment_id },
            });
          }

          // D. Patient Re-selection / Reschedule Alert
          if (needsReschedule) {
            const notifId = `clinic-reselect-${appt.appointment_id}`;
            items.push({
              id: notifId,
              type: "patient-reselection",
              category: "appointment",
              title: "Patient Doctor Re-selection",
              message: `${patient} selected an alternate doctor or updated their requested schedule.`,
              senderName: patient,
              senderType: "patient",
              senderAvatar: patientAvatar,
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
              senderAvatar: doctorAvatar,
              link: "/clinic/appointments",
              timestamp: appt.created_at || new Date().toISOString(),
              isRead: readSet.has(notifId),
              metadata: { appointment_id: appt.appointment_id },
            });
          }
        });
      }
    }

    // 2. User Notifications for Clinic Owner (including Clinic Application Approval, broadcasts, maintenance)
    if (resolvedUserId) {
      const { data: userNotifs } = await supabase
        .from("user_notification")
        .select("notif_id, type, subtype, title, body, is_read, created_at, metadata")
        .eq("user_id", resolvedUserId)
        .order("created_at", { ascending: false })
        .limit(30);

      if (userNotifs) {
        userNotifs.forEach((n: any) => {
          const isApproval =
            n.type === "clinic_application" ||
            n.subtype === "application_approved" ||
            n.subtype === "clinic_approval";
          const isBroadcast = n.type === "broadcast" || n.subtype === "admin_announcement";
          const isMaintenance = n.subtype === "maintenance_alert" || n.type === "maintenance_alert";
          const isAdminSystem = isBroadcast || isMaintenance;

          items.push({
            id: n.notif_id,
            type: isApproval ? "application_approved" : n.subtype || n.type || "system",
            category: isBroadcast ? "broadcast" : isApproval ? "clinic" : "system",
            title: n.title,
            message: n.body || "",
            senderName:
              (n.metadata as any)?.sender_name ||
              (isAdminSystem ? "Platform Administrator" : isApproval ? "Platform Admin" : "DERMAI Admin"),
            senderType: "admin",
            senderAvatar: adminAvatar || undefined,
            link: isApproval ? "/clinic" : undefined,
            timestamp: n.created_at,
            isRead: Boolean(n.is_read || readSet.has(n.notif_id)),
            metadata: {
              ...n.metadata,
              subtype: n.subtype,
              ...(isApproval ? { clinic_id: resolvedClinicId, status: "approved" } : {}),
            },
          });
        });
      }
    }

    // 3. Ensure clinic application approval notification is displayed if clinic is verified/approved in database
    const isApprovedClinic =
      clinicRow?.status === "approved" ||
      clinicRow?.status === "active" ||
      clinicRow?.verified === true;

    if (isApprovedClinic && resolvedClinicId) {
      const hasExistingApproval = items.some(
        (i) => i.type === "application_approved" || i.category === "clinic"
      );
      if (!hasExistingApproval) {
        const approvalNotifId = `clinic-approved-${resolvedClinicId}`;
        const clinicName = clinicRow?.name || "Clinic";
        items.push({
          id: approvalNotifId,
          type: "application_approved",
          category: "clinic",
          title: "Clinic Application Approved",
          message: `Congratulations! Your clinic application for ${clinicName} has been approved by the platform administrator. You can now access your full clinic dashboard, manage doctors, and accept patient appointments.`,
          senderName: "Platform Admin",
          senderType: "admin",
          senderAvatar: adminAvatar || undefined,
          link: "/clinic",
          timestamp: clinicRow?.created_at || new Date().toISOString(),
          isRead: readSet.has(approvalNotifId),
          metadata: { clinic_id: resolvedClinicId, status: "approved" },
        });
      }
    }

    // 4. Support Tickets submitted by Clinic Owner
    if (resolvedUserId) {
      const { data: tickets } = await supabase
        .from("user_support_ticket")
        .select("ticket_id, subject, response, status, updated_at, created_at")
        .eq("user_id", resolvedUserId)
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
              senderAvatar: adminAvatar || undefined,
              timestamp: ticket.updated_at || ticket.created_at,
              isRead: readSet.has(notifId),
              metadata: { ticket_id: ticket.ticket_id },
            });
          }
        });
      }
    }

    // 5. Clinic Broadcast Announcements
    const { data: broadcasts } = await supabase
      .from("admin_broadcast")
      .select("broadcast_id, title, message, audience, sent_at")
      .in("audience", ["all", "clinics", "clinic"])
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
          senderName: "Platform Administrator",
          senderType: "admin",
          senderAvatar: adminAvatar || undefined,
          timestamp: b.sent_at,
          isRead: readSet.has(notifId),
          metadata: {
            broadcast_id: b.broadcast_id,
            subtype: "admin_announcement",
          },
        });
      });
    }
  } catch (err) {
    console.warn("[notificationService] Error fetching clinic notifications:", err);
  }

  const seen = new Set<string>();
  const seenBroadcastIds = new Set<string>();
  const unique = items.filter((item) => {
    if (seen.has(item.id)) return false;
    const bId = item.metadata?.broadcast_id;
    if (bId) {
      if (seenBroadcastIds.has(bId)) return false;
      seenBroadcastIds.add(bId);
    }
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
      .in("status", ["pending", "open"])
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
        renews_at,
        started_at,
        plan:plan_id (name, price),
        user:user_id (user_id, full_name, email, avatar_url)
      `)
      .order("started_at", { ascending: false })
      .limit(10);

    if (subs) {
      subs.forEach((sub: any) => {
        const uObj = Array.isArray(sub.user) ? sub.user[0] : sub.user;
        const pObj = Array.isArray(sub.plan) ? sub.plan[0] : sub.plan;
        const userName = uObj?.full_name || uObj?.email || "Subscriber";
        const planName = pObj?.name || "Premium Plan";
        const notifId = `admin-sub-${sub.subscription_id}`;
        const avatar = resolveUserAvatar(uObj, userName);

        const periodEndRaw = sub.current_period_end || sub.renews_at;
        const isLapsed = periodEndRaw && new Date(periodEndRaw).getTime() <= Date.now();
        const effectiveStatus = (sub.status === "active" && isLapsed) ? "expired" : sub.status;

        let subTitle = "Subscription Event";
        let subMsg = `${userName} subscription update (${planName}).`;
        if (effectiveStatus === "active") {
          subTitle = "New Subscription Payment";
          subMsg = `${userName} upgraded to ${planName} successfully.`;
        } else if (effectiveStatus === "cancelled") {
          subTitle = "Subscription Cancelled";
          subMsg = `${userName} cancelled renewal for ${planName}.`;
        } else if (effectiveStatus === "expired") {
          subTitle = "Subscription Expired";
          subMsg = `${userName}'s ${planName} subscription has expired.`;
        }

        items.push({
          id: notifId,
          type: `subscription-${effectiveStatus}`,
          category: "subscription",
          title: subTitle,
          message: subMsg,
          senderName: userName,
          senderType: "user",
          senderAvatar: avatar,
          link: "/admin/subscriptions",
          timestamp: sub.started_at || new Date().toISOString(),
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
  let currentUserId = userId;
  if (!currentUserId) {
    try {
      const { data } = await supabase.auth.getSession();
      currentUserId = data?.session?.user?.id;
    } catch {}
    if (!currentUserId) {
      try {
        const { data } = await supabase.auth.getUser();
        currentUserId = data?.user?.id;
      } catch {}
    }
  }

  saveAllReadIds(role, ids, currentUserId);

  // Exact required mutation:
  // Persist change to public.user_notification scoped strictly to currentUserId
  if (currentUserId) {
    try {
      const { error } = await supabase
        .from("user_notification")
        .update({ is_read: true })
        .eq("user_id", currentUserId)
        .eq("is_read", false);
      if (error) {
        console.warn("[markAllNotificationsAsRead] user_notification update warning:", error.message);
      }
    } catch (err) {
      console.error("[markAllNotificationsAsRead] user_notification update error:", err);
    }
  }

  const uuidIds = ids.filter((id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  );

  if (uuidIds.length > 0) {
    try {
      const query = supabase.from("user_notification").update({ is_read: true }).in("notif_id", uuidIds);
      if (currentUserId) {
        query.eq("user_id", currentUserId);
      }
      await query;
    } catch {}
    try {
      await supabase.from("admin_alert").update({ is_read: true }).in("notif_id", uuidIds);
    } catch {}
  }
}

/**
 * ----------------------------------------------------------------------------
 * Shared Global Reactive State for Role Notifications
 * Ensures top header bell badges and notification pages remain in 100% sync
 * ----------------------------------------------------------------------------
 */
interface RoleStoreState {
  notifications: NotificationItem[];
  loading: boolean;
  unreadCount: number;
}

interface RoleStore {
  state: RoleStoreState;
  listeners: Set<() => void>;
  channel?: any;
  refCount?: number;
}

const roleStores = new Map<string, RoleStore>();

function getRoleStoreKey(role: NotificationRole, config: { userId?: string; clinicId?: string }): string {
  if (role === "admin") {
    return `admin:${config.userId || "global"}`;
  }
  if (role === "clinic") {
    return `clinic:${config.clinicId || config.userId || "global"}`;
  }
  return `${role}:${config.userId || "global"}`;
}

function getOrCreateRoleStore(key: string): RoleStore {
  let store = roleStores.get(key);
  if (!store) {
    store = {
      state: {
        notifications: [],
        loading: true,
        unreadCount: 0,
      },
      listeners: new Set(),
      refCount: 0,
    };
    roleStores.set(key, store);
  }
  return store;
}

/**
 * Optimistically clears unread count to 0 across all stores matching role/user
 */
export function broadcastMarkAllRead(role: NotificationRole, userId?: string, clinicId?: string) {
  roleStores.forEach((store, key) => {
    if (
      key.startsWith(`${role}:`) ||
      (userId && key.includes(userId)) ||
      (clinicId && key.includes(clinicId))
    ) {
      store.state = {
        ...store.state,
        unreadCount: 0,
        notifications: store.state.notifications.map((n) => ({ ...n, isRead: true })),
      };
      store.listeners.forEach((listener) => {
        try {
          listener();
        } catch {}
      });
    }
  });

  window.dispatchEvent(
    new CustomEvent("dermai_notifications_cleared", {
      detail: { role, userId, clinicId },
    })
  );
}

/**
 * Optimistically marks a single notification as read across matching stores
 */
export function broadcastMarkRead(id: string, role: NotificationRole, userId?: string, clinicId?: string) {
  roleStores.forEach((store, key) => {
    if (
      key.startsWith(`${role}:`) ||
      (userId && key.includes(userId)) ||
      (clinicId && key.includes(clinicId))
    ) {
      let changed = false;
      const updated = store.state.notifications.map((n) => {
        if (n.id === id) {
          if (!n.isRead) changed = true;
          return { ...n, isRead: true };
        }
        return n;
      });
      if (changed) {
        store.state = {
          ...store.state,
          unreadCount: Math.max(0, store.state.unreadCount - 1),
          notifications: updated,
        };
        store.listeners.forEach((listener) => {
          try {
            listener();
          } catch {}
        });
      }
    }
  });

  window.dispatchEvent(
    new CustomEvent("dermai_notifications_updated", {
      detail: { role, userId, clinicId, id, action: "mark_read" },
    })
  );
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
  const storeKey = getRoleStoreKey(role, { userId, clinicId });
  const store = getOrCreateRoleStore(storeKey);

  const [, setTick] = useState(0);

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
      const unread = data.filter((n) => !n.isRead).length;
      store.state = {
        notifications: data,
        unreadCount: unread,
        loading: false,
      };
      store.listeners.forEach((l) => {
        try {
          l();
        } catch {}
      });
    } catch (err) {
      console.warn("[useRoleNotifications] fetch error:", err);
      store.state = {
        ...store.state,
        loading: false,
      };
      store.listeners.forEach((l) => {
        try {
          l();
        } catch {}
      });
    }
  }, [role, userId, clinicId, userEmail, store]);

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    store.listeners.add(listener);

    fetchFn();

    // Setup Shared Realtime Channel with reference counting per store
    store.refCount = (store.refCount || 0) + 1;
    if (!store.channel) {
      const channelId = `role-notifs-${role}-${userId || clinicId || "admin"}-${Math.random().toString(36).slice(2, 9)}`;
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
      } else if (role === "clinic") {
        if (clinicId) {
          channel.on(
            "postgres_changes",
            { event: "*", schema: "public", table: "patient_appointment", filter: `clinic_id=eq.${clinicId}` },
            () => fetchFn()
          );
        } else {
          channel.on(
            "postgres_changes",
            { event: "*", schema: "public", table: "patient_appointment" },
            () => fetchFn()
          );
        }
        if (userId) {
          channel.on(
            "postgres_changes",
            { event: "*", schema: "public", table: "user_notification", filter: `user_id=eq.${userId}` },
            () => fetchFn()
          );
        } else {
          channel.on(
            "postgres_changes",
            { event: "*", schema: "public", table: "user_notification" },
            () => fetchFn()
          );
        }
        channel
          .on("postgres_changes", { event: "*", schema: "public", table: "clinic" }, () => fetchFn())
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
      store.channel = channel;
    }

    const handleCleared = (e: Event) => {
      const custom = e as CustomEvent;
      const d = custom?.detail;
      if (!d || d.role === role || (userId && d.userId === userId) || (clinicId && d.clinicId === clinicId)) {
        store.state = {
          ...store.state,
          unreadCount: 0,
          notifications: store.state.notifications.map((n) => ({ ...n, isRead: true })),
        };
        setTick((t) => t + 1);
      }
    };

    const handleCustomUpdate = (e: Event) => {
      const custom = e as CustomEvent;
      if (custom?.detail?.action === "mark_all_read" || custom?.detail?.action === "mark_read") {
        return;
      }
      fetchFn();
    };
    window.addEventListener("dermai_notifications_cleared", handleCleared);
    window.addEventListener("dermai_notifications_updated", handleCustomUpdate);
    window.addEventListener("storage", handleCustomUpdate);

    return () => {
      store.listeners.delete(listener);
      store.refCount = Math.max(0, (store.refCount || 1) - 1);
      if (store.refCount === 0 && store.channel) {
        try {
          supabase.removeChannel(store.channel);
        } catch {}
        store.channel = undefined;
      }
      window.removeEventListener("dermai_notifications_cleared", handleCleared);
      window.removeEventListener("dermai_notifications_updated", handleCustomUpdate);
      window.removeEventListener("storage", handleCustomUpdate);
    };
  }, [fetchFn, role, userId, clinicId, store]);

  const markRead = useCallback(
    async (id: string) => {
      broadcastMarkRead(id, role, userId, clinicId);
      await markNotificationAsRead(id, role, userId);
    },
    [role, userId, clinicId]
  );

  const markAllRead = useCallback(async () => {
    // 1. Immediate Frontend Badge Reset & List State Update (Optimistic UI)
    const currentItems = store.state.notifications;
    const ids = currentItems.map((n) => n.id);

    broadcastMarkAllRead(role, userId, clinicId);

    // 2. Database Mutation in Live Supabase:
    // await supabase.from('user_notification').update({ is_read: true }).eq('user_id', currentUserId).eq('is_read', false);
    await markAllNotificationsAsRead(ids, role, userId);
  }, [role, userId, clinicId, store]);

  return {
    notifications: store.state.notifications,
    loading: store.state.loading,
    unreadCount: store.state.unreadCount,
    refresh: fetchFn,
    markRead,
    markAllRead,
  };
}

/**
 * Common alias for useRoleNotifications ensuring shared reactive context
 */
export function useNotifications(
  role: NotificationRole = "patient",
  config: { userId?: string; clinicId?: string; userEmail?: string } = {}
) {
  return useRoleNotifications(role, config);
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

/**
 * ----------------------------------------------------------------------------
 * DIAGNOSTIC HEALTH CHECK UTILITY
 * Run in browser console: window.__dermai_notification_check()
 * ----------------------------------------------------------------------------
 */
export async function runNotificationHealthCheck() {
  console.group("🔍 [DERMAI] Notification System Health & Live Query Audit");
  const report: Record<string, any> = {
    session: null,
    tables: {},
    roles: {},
  };

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    report.session = {
      authenticated: Boolean(user),
      userId: user?.id || null,
      email: user?.email || null,
      role: user?.user_metadata?.role || "unauthenticated",
    };
    console.log("👤 Active Session:", report.session);

    // 1. Direct Table Queries
    console.groupCollapsed("📊 Direct Supabase Table Probes");
    const [notifsProbe, apptsProbe, clinicsProbe, ticketsProbe] = await Promise.all([
      supabase.from("user_notification").select("notif_id, type, title, created_at").limit(3),
      supabase.from("patient_appointment").select("appointment_id, status, clinic_id, clinic:clinic_id(name, logo_url)").limit(3),
      supabase.from("clinic").select("clinic_id, name, logo_url").limit(3),
      supabase.from("user_support_ticket").select("ticket_id, subject, status").limit(3),
    ]);

    report.tables = {
      user_notification: { count: notifsProbe.data?.length ?? 0, error: notifsProbe.error?.message || null, sample: notifsProbe.data?.[0] || null },
      patient_appointment: { count: apptsProbe.data?.length ?? 0, error: apptsProbe.error?.message || null, sample: apptsProbe.data?.[0] || null },
      clinic: { count: clinicsProbe.data?.length ?? 0, error: clinicsProbe.error?.message || null, sample: clinicsProbe.data?.[0] || null },
      user_support_ticket: { count: ticketsProbe.data?.length ?? 0, error: ticketsProbe.error?.message || null, sample: ticketsProbe.data?.[0] || null },
    };
    console.table(report.tables);
    console.groupEnd();

    // 2. Role Feed Queries
    console.group("🔔 Role Notification Feed Verification");
    const uid = user?.id || "";
    const email = user?.email || undefined;

    const [patientNotifs, doctorNotifs, clinicNotifs, adminNotifs] = await Promise.all([
      uid ? fetchPatientNotifications(uid) : Promise.resolve([]),
      uid ? fetchDoctorNotifications(uid, email) : Promise.resolve([]),
      fetchClinicNotifications("", uid, email),
      fetchAdminNotifications(),
    ]);

    report.roles = {
      patient: {
        total: patientNotifs.length,
        unread: patientNotifs.filter((n) => !n.isRead).length,
        sample: patientNotifs[0] || null,
      },
      doctor: {
        total: doctorNotifs.length,
        unread: doctorNotifs.filter((n) => !n.isRead).length,
        sample: doctorNotifs[0] || null,
      },
      clinic: {
        total: clinicNotifs.length,
        unread: clinicNotifs.filter((n) => !n.isRead).length,
        sample: clinicNotifs[0] || null,
      },
      admin: {
        total: adminNotifs.length,
        unread: adminNotifs.filter((n) => !n.isRead).length,
        sample: adminNotifs[0] || null,
      },
    };

    console.table({
      Patient: { count: report.roles.patient.total, unread: report.roles.patient.unread, sampleTitle: report.roles.patient.sample?.title || "None" },
      Doctor: { count: report.roles.doctor.total, unread: report.roles.doctor.unread, sampleTitle: report.roles.doctor.sample?.title || "None" },
      Clinic: { count: report.roles.clinic.total, unread: report.roles.clinic.unread, sampleTitle: report.roles.clinic.sample?.title || "None" },
      Admin: { count: report.roles.admin.total, unread: report.roles.admin.unread, sampleTitle: report.roles.admin.sample?.title || "None" },
    });
    console.groupEnd();

    // 3. Foreign Key / Avatar Resolution Check
    console.groupCollapsed("🖼️ Foreign Key & Masking Check");
    const patientWithClinic = patientNotifs.find((n) => n.senderName && n.senderName !== "Clinic");
    const adminWithAvatar = adminNotifs.find((n) => Boolean(n.senderAvatar));
    console.log("Patient Clinic Masking Sample:", patientWithClinic ? { senderName: patientWithClinic.senderName, avatar: patientWithClinic.senderAvatar } : "No masked items yet");
    console.log("Admin Avatar Resolution Sample:", adminWithAvatar ? { senderName: adminWithAvatar.senderName, avatar: adminWithAvatar.senderAvatar } : "No admin items with avatar yet");
    console.groupEnd();

    console.log("✅ Verification finished. Full payload:", report);
  } catch (diagErr) {
    console.error("❌ Diagnostic error:", diagErr);
  } finally {
    console.groupEnd();
  }

  return report;
}

if (typeof window !== "undefined") {
  (window as any).__dermai_notification_check = runNotificationHealthCheck;
}

/**
 * ----------------------------------------------------------------------------
 * ADMIN BROADCAST & MAINTENANCE DISPATCH SYSTEM
 * ----------------------------------------------------------------------------
 */

/**
 * Resolves active recipient user IDs dynamically based on live accounts in:
 * - public.user (role = 'patient', 'clinic', 'doctor', account_status != 'suspended' / 'inactive')
 * - public.clinic (owner_user_id)
 * - public.clinic_doctor (user_id where status is active)
 */
export async function resolveActiveAudienceUserIds(
  audience: "all" | "patient" | "patients" | "clinic" | "clinics" | "doctor" | "doctors" | string
): Promise<string[]> {
  const norm = (audience || "all").toLowerCase().trim();
  const recipientIds = new Set<string>();

  const isAll = norm === "all" || norm === "all users";
  const wantPatients = isAll || norm === "patient" || norm === "patients";
  const wantClinics = isAll || norm === "clinic" || norm === "clinics";
  const wantDoctors = isAll || norm === "doctor" || norm === "doctors";

  try {
    // 1. Resolve Patients
    if (wantPatients) {
      const { data: patients, error: pErr } = await supabase
        .from("user")
        .select("user_id, account_status")
        .eq("role", "patient")
        .neq("account_status", "suspended")
        .neq("account_status", "inactive");
      if (pErr) console.warn("[resolveActiveAudienceUserIds] Error querying patients:", pErr);
      (patients || []).forEach((p) => p.user_id && recipientIds.add(p.user_id));
    }

    // 2. Resolve Clinics
    if (wantClinics) {
      // A. Users with role 'clinic'
      const { data: clinicUsers, error: cuErr } = await supabase
        .from("user")
        .select("user_id, account_status")
        .eq("role", "clinic")
        .neq("account_status", "suspended")
        .neq("account_status", "inactive");
      if (cuErr) console.warn("[resolveActiveAudienceUserIds] Error querying clinic users:", cuErr);
      (clinicUsers || []).forEach((c) => c.user_id && recipientIds.add(c.user_id));

      // B. Owners in clinic table
      const { data: clinicOwners, error: coErr } = await supabase
        .from("clinic")
        .select("owner_user_id, status")
        .not("owner_user_id", "is", null)
        .neq("status", "rejected");
      if (coErr) console.warn("[resolveActiveAudienceUserIds] Error querying clinic owners:", coErr);
      (clinicOwners || []).forEach((c) => c.owner_user_id && recipientIds.add(c.owner_user_id));
    }

    // 3. Resolve Doctors
    if (wantDoctors) {
      // A. Users with role 'doctor'
      const { data: doctorUsers, error: duErr } = await supabase
        .from("user")
        .select("user_id, account_status")
        .eq("role", "doctor")
        .neq("account_status", "suspended")
        .neq("account_status", "inactive");
      if (duErr) console.warn("[resolveActiveAudienceUserIds] Error querying doctor users:", duErr);
      (doctorUsers || []).forEach((d) => d.user_id && recipientIds.add(d.user_id));

      // B. Active Doctors in clinic_doctor table
      const { data: docRecords, error: cdErr } = await supabase
        .from("clinic_doctor")
        .select("user_id, status")
        .not("user_id", "is", null);
      if (cdErr) console.warn("[resolveActiveAudienceUserIds] Error querying clinic_doctor:", cdErr);
      (docRecords || []).forEach((d) => {
        const s = (d.status || "").toLowerCase();
        if (d.user_id && s !== "inactive" && s !== "suspended" && s !== "archived") {
          recipientIds.add(d.user_id);
        }
      });
    }
  } catch (err) {
    console.error("[resolveActiveAudienceUserIds] Failed to dynamically resolve recipients:", err);
  }

  return Array.from(recipientIds);
}

/**
 * Publishes an Admin Broadcast Announcement into public.admin_broadcast,
 * generates matching individual records in public.user_notification for active users,
 * and records an entry in the system audit log.
 */
export async function dispatchAdminBroadcastNotification(params: {
  title: string;
  message: string;
  audience: "all" | "patients" | "clinics" | "doctors" | string;
}): Promise<{ broadcastId: string; recipientCount: number }> {
  const normAudience = (params.audience || "all").toLowerCase().trim();
  const dbAudience =
    normAudience === "patient" ? "patients"
    : normAudience === "clinic" ? "clinics"
    : normAudience === "doctor" ? "doctors"
    : (["all", "patients", "clinics", "doctors"].includes(normAudience) ? normAudience : "all");

  // 1. Insert into public.admin_broadcast
  const { data: bcastRow, error: bcastError } = await supabase
    .from("admin_broadcast")
    .insert({
      title: params.title.trim(),
      message: params.message.trim(),
      audience: dbAudience,
      sent_at: new Date().toISOString(),
    })
    .select("broadcast_id")
    .single();

  if (bcastError) {
    console.error("[dispatchAdminBroadcastNotification] Failed to insert admin_broadcast:", bcastError);
    throw bcastError;
  }

  const broadcastId = bcastRow.broadcast_id;

  // 2. Dynamically resolve recipient user IDs
  const recipientIds = await resolveActiveAudienceUserIds(dbAudience);

  // 3. Batch insert into public.user_notification
  if (recipientIds.length > 0) {
    const BATCH_SIZE = 100;
    for (let i = 0; i < recipientIds.length; i += BATCH_SIZE) {
      const chunk = recipientIds.slice(i, i + BATCH_SIZE);
      const rows = chunk.map((uid) => ({
        user_id: uid,
        type: "broadcast",
        subtype: "admin_announcement",
        title: params.title.trim(),
        body: params.message.trim(),
        is_read: false,
        metadata: {
          broadcast_id: broadcastId,
          sender_name: "Platform Administrator",
          audience: dbAudience,
          priority: "normal",
        },
      }));
      const { error: insErr } = await supabase.from("user_notification").insert(rows);
      if (insErr) {
        console.warn("[dispatchAdminBroadcastNotification] Batch insert error:", insErr);
      }
    }
  }

  // 4. Central Audit Logging
  try {
    await logAuditEvent({
      role: "admin",
      category: "System",
      action: "Broadcast Announcement Created",
      target: `Audience: ${dbAudience}`,
      details: `Admin published broadcast announcement "${params.title.trim()}" to ${dbAudience} (${recipientIds.length} active users notified).`,
      metadata: {
        broadcast_id: broadcastId,
        title: params.title.trim(),
        audience: dbAudience,
        recipient_count: recipientIds.length,
      },
    });
  } catch (auditErr) {
    console.warn("[dispatchAdminBroadcastNotification] Audit logging failed:", auditErr);
  }

  // 5. Emit Realtime Events locally
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("dermai_notifications_updated"));
    window.dispatchEvent(new Event("storage"));
  }

  return { broadcastId, recipientCount: recipientIds.length };
}

/**
 * Dispatches a high-priority System Maintenance notification to all active user roles (Patient, Clinic, Doctor)
 * and records the event in public.system_audit_log.
 */
export async function dispatchSystemMaintenanceAlert(params: {
  scheduledWindow: string;
  estimatedDowntime: string;
  instructions?: string;
  enabled: boolean;
}): Promise<{ recipientCount: number }> {
  if (!params.enabled) {
    // Maintenance Mode Deactivated / Disabled
    try {
      await logAuditEvent({
        role: "admin",
        category: "System",
        action: "Maintenance Mode Disabled",
        target: "Platform Maintenance",
        details: "Platform maintenance mode was deactivated by the administrator. Normal access restored.",
      });
    } catch (auditErr) {
      console.warn("[dispatchSystemMaintenanceAlert] Audit log error:", auditErr);
    }
    return { recipientCount: 0 };
  }

  // Maintenance Mode Enabled
  const instructions =
    params.instructions?.trim() ||
    "Some features such as booking and online consultations may be temporarily unavailable. Please complete any active sessions.";
  const dynamicBody = `The system will undergo scheduled maintenance on ${params.scheduledWindow}. Estimated downtime: ${params.estimatedDowntime}. ${instructions}`;

  // 1. Record in admin_broadcast for permanent record
  try {
    await supabase.from("admin_broadcast").insert({
      title: "System Maintenance Notice",
      message: dynamicBody,
      audience: "all",
      sent_at: new Date().toISOString(),
    });
  } catch (bcastErr) {
    console.warn("[dispatchSystemMaintenanceAlert] Broadcast record insert warning:", bcastErr);
  }

  // 2. Dynamically resolve all active users (Patients, Clinics, Doctors)
  const recipientIds = await resolveActiveAudienceUserIds("all");

  // 3. Batch insert high-priority user_notification records
  if (recipientIds.length > 0) {
    const BATCH_SIZE = 100;
    for (let i = 0; i < recipientIds.length; i += BATCH_SIZE) {
      const chunk = recipientIds.slice(i, i + BATCH_SIZE);
      const rows = chunk.map((uid) => ({
        user_id: uid,
        type: "system",
        subtype: "maintenance_alert",
        title: "System Maintenance Notice",
        body: dynamicBody,
        is_read: false,
        metadata: {
          priority: "high",
          level: "warning",
          sender_name: "Platform Administrator",
          scheduled_window: params.scheduledWindow,
          estimated_downtime: params.estimatedDowntime,
        },
      }));
      const { error: insErr } = await supabase.from("user_notification").insert(rows);
      if (insErr) {
        console.warn("[dispatchSystemMaintenanceAlert] Batch insert error:", insErr);
      }
    }
  }

  // 4. Central Audit Logging
  try {
    await logAuditEvent({
      role: "admin",
      category: "System",
      action: "Maintenance Mode Enabled",
      target: "Platform Maintenance",
      details: `System maintenance mode enabled. Scheduled window: ${params.scheduledWindow}. Estimated downtime: ${params.estimatedDowntime}. High-priority alert sent to ${recipientIds.length} active users.`,
      metadata: {
        scheduled_window: params.scheduledWindow,
        estimated_downtime: params.estimatedDowntime,
        recipient_count: recipientIds.length,
      },
    });
  } catch (auditErr) {
    console.warn("[dispatchSystemMaintenanceAlert] Audit log error:", auditErr);
  }

  // 5. Emit Realtime Events
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("dermai_notifications_updated"));
    window.dispatchEvent(new Event("storage"));
  }

  return { recipientCount: recipientIds.length };
}
