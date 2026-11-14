import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";
import { getLocalHelpdeskTickets } from "./store";
import { logAuditEvent } from "./auditLog";
import { resolveAvatarUrl } from "./avatarUrlResolver";

export type NotificationRole = "patient" | "doctor" | "clinic" | "admin";

export type NotificationCategory =
  | "appointment"
  | "bookings_and_reselections"
  | "doctor_actions"
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
  subtype?: string;
  category: NotificationCategory;
  title: string;
  message: string;
  senderName?: string;
  senderType?: "clinic" | "admin" | "doctor" | "system" | "patient" | "user";
  senderAvatar?: string | null;
  appointment_id?: string;
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
  | "appointment-cancelled"
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
  metadata?: Record<string, any>;
}

const LOCAL_NOTIF_PREFIX = "dermai_patient_notifications_";

function getReadIds(role: NotificationRole, userId?: string, fallbackId?: string): Set<string> {
  const combined = new Set<string>();
  // Strict user isolation: if an authenticated userId is provided, read ONLY for that user to prevent account bleed
  const keys = userId || fallbackId
    ? ([userId, fallbackId].filter(Boolean) as string[])
    : ["default"];

  for (const k of keys) {
    try {
      const raw = localStorage.getItem(`dermai_${role}_read_ids_${k}`);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) arr.forEach((id) => combined.add(id));
      }
    } catch { }
  }
  return combined;
}

function saveReadId(role: NotificationRole, id: string, userId?: string, fallbackId?: string, extraIds?: string[]) {
  // Strict user isolation: if an authenticated userId is provided, save ONLY for that user
  const keys = userId || fallbackId
    ? ([userId, fallbackId].filter(Boolean) as string[])
    : ["default"];

  for (const k of keys) {
    try {
      const key = `dermai_${role}_read_ids_${k}`;
      const set = getReadIds(role, k);
      set.add(id);
      if (extraIds && Array.isArray(extraIds)) {
        extraIds.forEach((eid) => set.add(eid));
      }
      localStorage.setItem(key, JSON.stringify(Array.from(set)));
    } catch { }
  }
}

function saveAllReadIds(role: NotificationRole, ids: string[], userId?: string, fallbackId?: string) {
  // Strict user isolation: if an authenticated userId is provided, save ONLY for that user
  const keys = userId || fallbackId
    ? ([userId, fallbackId].filter(Boolean) as string[])
    : ["default"];

  for (const k of keys) {
    try {
      const key = `dermai_${role}_read_ids_${k}`;
      const set = getReadIds(role, k);
      ids.forEach((id) => set.add(id));
      localStorage.setItem(key, JSON.stringify(Array.from(set)));
    } catch { }
  }
}

export function isNotificationRead(
  id: string,
  dbIsRead: boolean,
  readSet: Set<string>,
  meta?: {
    appointmentId?: string;
    ticketId?: string;
    broadcastId?: string;
    analysisId?: string;
    title?: string;
    message?: string;
  }
): boolean {
  if (dbIsRead) return true;
  if (readSet.has(id)) return true;

  if (meta?.appointmentId) {
    const aid = String(meta.appointmentId);
    if (
      readSet.has(aid) ||
      readSet.has(`appt:${aid}`) ||
      readSet.has(`appt-accepted-${aid}`) ||
      readSet.has(`appt-completed-${aid}`) ||
      readSet.has(`appt-rejected-${aid}`) ||
      readSet.has(`appt-cancelled-${aid}`) ||
      readSet.has(`appt-scheduled-${aid}`)
    ) {
      return true;
    }
  }

  if (meta?.ticketId) {
    const tid = String(meta.ticketId);
    if (readSet.has(tid) || readSet.has(`ticket:${tid}`) || readSet.has(`ticket-update-${tid}`)) {
      return true;
    }
  }

  if (meta?.broadcastId) {
    const bid = String(meta.broadcastId);
    if (readSet.has(bid) || readSet.has(`broadcast:${bid}`)) {
      return true;
    }
  }

  if (meta?.analysisId) {
    const sid = String(meta.analysisId);
    if (readSet.has(sid) || readSet.has(`scan:${sid}`) || readSet.has(`scan-${sid}`)) {
      return true;
    }
  }

  if (meta?.title && meta?.message) {
    const key = `content:${meta.title.trim().toLowerCase()}:::${meta.message.trim().toLowerCase()}`;
    if (readSet.has(key)) return true;
  }

  return false;
}

export function resolveAppointmentTimestamp(appt: any, preferredTimestamp?: string): string {
  if (preferredTimestamp) {
    const parsed = new Date(preferredTimestamp).getTime();
    if (!isNaN(parsed) && parsed > 0) return new Date(parsed).toISOString();
  }
  const candidates = [
    appt.doctor_reviewed_at,
    appt.doctorReviewedAt,
    appt.cancelled_at,
    appt.cancelledAt,
    appt.updated_at,
    appt.updatedAt,
    appt.created_at,
    appt.createdAt,
  ];
  for (const c of candidates) {
    if (c) {
      const parsed = new Date(c).getTime();
      if (!isNaN(parsed) && parsed > 0) return new Date(parsed).toISOString();
    }
  }
  if (appt.date) {
    const timeStr = appt.time ? `T${appt.time.length === 5 ? appt.time + ":00" : appt.time}` : "T09:00:00";
    const dateParsed = new Date(`${appt.date}${timeStr}`).getTime();
    if (!isNaN(dateParsed) && dateParsed > 0) return new Date(dateParsed).toISOString();
    const dateOnly = new Date(appt.date).getTime();
    if (!isNaN(dateOnly) && dateOnly > 0) return new Date(dateOnly).toISOString();
  }
  return new Date().toISOString();
}

/**
 * Deduplicate notification items defensively:
 * 1. Checks item.id (deduping by exact ID)
 * 2. Checks broadcast_id (deduping identical announcements across user_notification and admin_broadcast)
 * 3. Checks content fingerprint: normalized title + message (prevents duplicate entries with identical content)
 * 4. Prioritizes persistent DB records (UUID) over synthetic prefixes (broadcast-, ticket-update-, appt-)
 */
const isUuid = (str: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

export function deduplicateNotificationItems(items: NotificationItem[]): NotificationItem[] {
  if (!Array.isArray(items) || items.length === 0) return [];

  const seenIds = new Set<string>();
  const seenBroadcastIds = new Set<string>();
  const seenContentKeys = new Set<string>();
  const seenApptActions = new Set<string>();
  const itemByKey = new Map<string, NotificationItem>();

  // Sort so persistent database records with UUID IDs take precedence over synthetic fallback IDs
  const sorted = [...items].sort((a, b) => {
    const aIsUuid = isUuid(a.id);
    const bIsUuid = isUuid(b.id);
    if (aIsUuid && !bIsUuid) return -1;
    if (!aIsUuid && bIsUuid) return 1;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  const unique: NotificationItem[] = [];

  for (const item of sorted) {
    if (!item || !item.id) continue;

    // A. Direct ID check
    if (seenIds.has(item.id)) {
      const existing = itemByKey.get(`id:${item.id}`);
      if (existing && item.isRead) existing.isRead = true;
      continue;
    }

    // B. Broadcast ID check
    const bId =
      item.metadata?.broadcast_id ||
      (item.id.startsWith("broadcast-") ||
        item.id.startsWith("clinic-broadcast-") ||
        item.id.startsWith("doc-broadcast-")
        ? item.id.replace(/^(clinic-|doc-)?broadcast-/, "")
        : undefined);

    if (bId && seenBroadcastIds.has(bId)) {
      const existing = itemByKey.get(`broadcast:${bId}`);
      if (existing && item.isRead) existing.isRead = true;
      continue;
    }

    // B2. Appointment + Action deduplication (dedupes persistent DB user_notification with synthetic fallback)
    const apptId =
      item.metadata?.appointment_id ||
      item.metadata?.appointmentId ||
      (item.id.startsWith("clinic-")
        ? item.id.replace(/^clinic-[a-z]+-/, "")
        : item.id.startsWith("doc-req-")
        ? item.id.replace("doc-req-", "")
        : item.id.startsWith("doc-branch-req-")
        ? item.id.replace("doc-branch-req-", "")
        : item.id.startsWith("appt-rejected-")
        ? item.id.replace("appt-rejected-", "")
        : item.id.startsWith("appt-completed-")
        ? item.id.replace("appt-completed-", "")
        : item.id.startsWith("appt-cancelled-")
        ? item.id.replace("appt-cancelled-", "")
        : item.id.startsWith("appt-accepted-")
        ? item.id.replace("appt-accepted-", "")
        : item.id.startsWith("appt-confirmed-")
        ? item.id.replace("appt-confirmed-", "")
        : undefined);

    const normType = (item.type || item.metadata?.type || "").toLowerCase().replace(/_/g, "-");
    const isDoctorAction = normType.includes("doctor-");

    // Conflict / rejection deduplication: suppress duplicate notification cards for the same appointment conflict
    const isRejectionAction =
      normType === "appointment-rejected" ||
      normType === "appointment-declined" ||
      item.metadata?.subtype === "doctor-declined" ||
      item.metadata?.subtype === "schedule-conflict" ||
      /review update|schedule conflict|declined|rejected/i.test(item.title || "");

    if (apptId && isRejectionAction) {
      const stableEventId =
        item.metadata?.rejection_event_id ||
        item.metadata?.event_id;

      const docId =
        item.metadata?.doctor_id ||
        item.metadata?.declined_doctor_id ||
        "";

      const rejectStamp =
        item.metadata?.declined_at ||
        item.metadata?.rejection_timestamp ||
        item.timestamp;

      const timeNum = rejectStamp ? new Date(rejectStamp).getTime() : NaN;
      const hasValidTime = Number.isFinite(timeNum);

      const rejectKey = stableEventId
        ? `${apptId}:::rejected:::${stableEventId}`
        : (docId && hasValidTime)
        ? `${apptId}:::rejected:::${docId}:::${timeNum}`
        : `${apptId}:::rejected:::${item.id}`;

      if (seenApptActions.has(rejectKey)) {
        const existing = itemByKey.get(`appt:${rejectKey}`);
        if (existing && item.isRead) existing.isRead = true;
        continue;
      }
      seenApptActions.add(rejectKey);
      itemByKey.set(`appt:${rejectKey}`, item);
    } else if (
      apptId &&
      (isDoctorAction ||
        normType === "appointment-cancelled" ||
        normType === "appointment-request" ||
        normType === "appointment-delegated" ||
        normType === "appointment-confirmed" ||
        normType === "appointment-completed" ||
        normType === "appointment-accepted" ||
        normType === "appointment-scheduled")
    ) {
      const apptActionKey = `${apptId}:::${normType}`;
      if (seenApptActions.has(apptActionKey)) {
        const existing = itemByKey.get(`appt:${apptActionKey}`);
        if (existing && item.isRead) existing.isRead = true;
        continue;
      }
      seenApptActions.add(apptActionKey);
      itemByKey.set(`appt:${apptActionKey}`, item);
    }

    // C. Content Fingerprint: normalized title + body (for general/broadcast notices; appointment actions are deduplicated by seenApptActions)
    const isAppointmentNotification =
      Boolean(apptId) ||
      item.category === "appointment" ||
      normType.includes("appointment") ||
      normType.includes("booking");

    if (!isRejectionAction && !isDoctorAction && !isAppointmentNotification) {
      const normTitle = (item.title || "").trim().toLowerCase();
      const normMsg = (item.message || "").trim().toLowerCase();
      const contentKey = `${normTitle}:::${normMsg}`;

      if (normTitle && normMsg && seenContentKeys.has(contentKey)) {
        const existing = itemByKey.get(`content:${contentKey}`);
        if (existing && item.isRead) existing.isRead = true;
        continue;
      }

      if (normTitle && normMsg) {
        seenContentKeys.add(contentKey);
        itemByKey.set(`content:${contentKey}`, item);
      }
    }

    itemByKey.set(`id:${item.id}`, item);
    if (bId) {
      seenBroadcastIds.add(bId);
      itemByKey.set(`broadcast:${bId}`, item);
    }
    seenIds.add(item.id);
    unique.push(item);
  }

  return unique.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
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
    // ── Pre-fetch DB notifications, appointments, and admin/support profiles in parallel
    //    so we can enrich clinic appointments and support ticket notifications with real avatars.
    const [{ data: dbNotifs }, { data: appointments }, { data: adminUsers }] = await Promise.all([
      supabase
        .from("user_notification")
        .select("notif_id, type, subtype, title, body, is_read, metadata, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(40),
      supabase
        .from("patient_appointment")
        .select(`
          appointment_id,
          date,
          time,
          status,
          check_in_status,
          doctor_status,
          doctor_note,
          clinic_note,
          created_at,
          assigned_doctor_id,
          doctor_reviewed_at,
          questionnaire_answers,
          clinic:clinic_id (name, logo_url)
        `)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("user")
        .select("user_id, full_name, avatar_url, email, role")
        .or("role.eq.admin,email.eq.dermaisupport@gmail.com,user_id.eq.03c4dbd4-5d15-4c78-872e-93811b3afa23")
        .limit(10),
    ]);

    const adminProfileById = new Map<string, { fullName?: string; avatarUrl?: string }>();
    let defaultAdminAvatar: string | undefined = undefined;
    (adminUsers || []).forEach((au: any) => {
      const resolvedUrl = au.avatar_url ? (resolveAvatarUrl(au.avatar_url) || au.avatar_url) : undefined;
      if (au.user_id) {
        adminProfileById.set(String(au.user_id), {
          fullName: au.full_name || undefined,
          avatarUrl: resolvedUrl,
        });
      }
      if (!defaultAdminAvatar && resolvedUrl) {
        defaultAdminAvatar = resolvedUrl;
      }
    });

    // Also check profiles table for admin avatar or specific admin_id / resolved_by in ticket metadata
    const ticketAdminIds = Array.from(
      new Set(
        (dbNotifs || [])
          .map((n: any) => n.metadata?.admin_id || n.metadata?.resolved_by || n.metadata?.responder_id)
          .filter((id: any) => id && !adminProfileById.has(String(id)))
      )
    );
    if (!defaultAdminAvatar || ticketAdminIds.length > 0) {
      try {
        let profQuery = supabase.from("profiles").select("user_id, full_name, avatar_url, profile_picture, role");
        if (ticketAdminIds.length > 0) {
          profQuery = profQuery.or(`role.eq.admin,user_id.in.(${ticketAdminIds.join(",")})`);
        } else {
          profQuery = profQuery.eq("role", "admin");
        }
        const { data: adminProfs } = await profQuery.limit(10);
        (adminProfs || []).forEach((ap: any) => {
          const rawAv = ap.avatar_url || ap.profile_picture;
          const resolvedUrl = rawAv ? (resolveAvatarUrl(rawAv) || rawAv) : undefined;
          if (ap.user_id) {
            const existing = adminProfileById.get(String(ap.user_id));
            adminProfileById.set(String(ap.user_id), {
              fullName: existing?.fullName || ap.full_name || undefined,
              avatarUrl: existing?.avatarUrl || resolvedUrl,
            });
          }
          if (!defaultAdminAvatar && resolvedUrl) {
            defaultAdminAvatar = resolvedUrl;
          }
        });
      } catch { }
    }

    // Build a lookup map: appointment_id → { name, logo }
    // This lets us enrich appointment-completed DB notification records with the
    // correct clinic name and logo_url, even when the user_notification row only
    // stores a bare subtype like "reviewed" and no sender_name in metadata.
    const clinicByApptId = new Map<string, { name: string; logo: string | null }>();
    const apptById = new Map<string, any>();
    (appointments || []).forEach((appt: any) => {
      if (!appt.appointment_id) return;
      apptById.set(String(appt.appointment_id), appt);
      const cObj = Array.isArray(appt.clinic) ? appt.clinic[0] : appt.clinic;
      clinicByApptId.set(appt.appointment_id, {
        name: cObj?.name || "Clinic",
        logo: cObj?.logo_url || null,
      });
    });

    let reselectedMapLocal: Record<string, any> = {};
    try {
      reselectedMapLocal = JSON.parse(localStorage.getItem("dermai_reselected_appointments") || "{}");
    } catch { }

    const isApptReselectionResolved = (targetApptId?: string, notifTimestamp?: string): boolean => {
      if (!targetApptId) return false;
      const appt = apptById.get(String(targetApptId));
      if (!appt) return false;

      const docSt = String(appt.doctor_status || "").toLowerCase();
      const rawStatus = String(appt.status || "").toLowerCase();
      const isDeclined =
        docSt === "rejected" ||
        docSt === "declined" ||
        rawStatus === "doctor_declined" ||
        rawStatus === "reselection_required" ||
        rawStatus === "rejected";

      if (isDeclined) {
        // If doctor rejection is currently active, re-selection is only resolved if a new reassignment
        // happened strictly AFTER the rejection timestamp of the event being evaluated
        const rejectionTime = notifTimestamp
          ? new Date(notifTimestamp).getTime()
          : (appt.doctor_reviewed_at ? new Date(appt.doctor_reviewed_at).getTime() : 0);

        const localEntry = reselectedMapLocal[targetApptId];
        const localResolvedTime = localEntry?.resolvedAt ? new Date(localEntry.resolvedAt).getTime() : 0;
        const qa = (appt.questionnaire_answers && typeof appt.questionnaire_answers === "object") ? appt.questionnaire_answers : {};
        const qaReassignedTime = qa.reassigned_at ? new Date(qa.reassigned_at).getTime() : 0;

        if (
          (localResolvedTime > rejectionTime && localResolvedTime > 0) ||
          (qaReassignedTime > rejectionTime && qaReassignedTime > 0)
        ) {
          return true;
        }
        return false;
      }

      // If doctor is not currently rejected, check standard reselected / scheduled state
      if (reselectedMapLocal[targetApptId]) return true;
      const qa = (appt.questionnaire_answers && typeof appt.questionnaire_answers === "object") ? appt.questionnaire_answers : {};
      if (
        qa.reselection_status === "reselected" ||
        qa.reselection_required === false ||
        qa.workflow_status === "pending_doctor_review"
      ) {
        return true;
      }
      if (docSt && docSt !== "rejected" && docSt !== "declined" && docSt !== "reselection_required") {
        return true;
      }
      return false;
    };

    // 1. Direct user_notification records for this patient
    if (dbNotifs) {
      dbNotifs.forEach((n) => {
        // Suppress all subscription/plan notifications (receipts & confirmations are handled strictly via email)
        if (
          n.type === "subscription_expired" ||
          n.type === "subscription-expired" ||
          n.subtype === "subscription_expired" ||
          n.subtype === "subscription-expired" ||
          n.type === "subscription" ||
          n.subtype === "subscription" ||
          n.subtype === "subscription_upgraded" ||
          (n as any).category === "subscription" ||
          (n as any).category === "PLAN" ||
          (n as any).metadata?.category === "subscription" ||
          (n as any).metadata?.category === "PLAN" ||
          Boolean(n.subtype?.includes("subscription")) ||
          Boolean(n.type?.includes("subscription")) ||
          /pro subscription|subscription|plan activated|welcome to dermai pro/i.test(n.title || "")
        ) {
          return;
        }
        const isBroadcast = n.type === "broadcast" || n.subtype === "admin_announcement";
        const isMaintenance = n.subtype === "maintenance_alert" || n.type === "maintenance_alert";
        const isTicket =
          n.type === "support_ticket" ||
          n.type === "support" ||
          n.type === "support-ticket-received" ||
          n.type === "support_ticket_received" ||
          n.type === "support-ticket-resolved" ||
          n.type === "support_ticket_resolved" ||
          n.subtype === "support" ||
          n.subtype === "support_ticket" ||
          n.subtype === "support-ticket-received" ||
          n.subtype === "support_ticket_received" ||
          n.subtype === "support-ticket-resolved" ||
          n.subtype === "support_ticket_resolved" ||
          n.type?.includes("ticket") ||
          n.type?.includes("support") ||
          n.subtype?.includes("ticket") ||
          n.subtype?.includes("support") ||
          (n as any).metadata?.category === "support" ||
          (n as any).metadata?.category === "ticket" ||
          /support ticket|ticket received|ticket resolved|ticket updated/i.test(n.title || "");
        const isAdminSystem = isBroadcast || isMaintenance;
        // Detect appointment-completed regardless of which field carries the signal
        const isApptCompleted =
          n.type === "appointment-completed" ||
          n.type === "appointment_completed" ||
          n.subtype === "reviewed" ||
          n.subtype === "appointment-completed";

        // Detect payment confirmation / verification notifications
        const isPaymentConfirmed =
          n.type === "payment-confirmed" ||
          n.type === "payment_confirmed" ||
          n.type === "appointment-payment-confirmed" ||
          n.subtype === "payment_confirmed" ||
          n.subtype === "payment-confirmed" ||
          n.subtype === "payment" ||
          /payment.*(confirm|verifi|receiv)/i.test(n.title || "") ||
          /payment.*(confirm|verifi)/i.test(n.subtype || "") ||
          /payment.*(confirm|verifi)/i.test(n.body || "");

        // Detect appointment rejection / schedule conflict notifications
        const isApptRejected =
          n.type === "appointment-rejected" ||
          n.type === "appointment_rejected" ||
          n.subtype === "doctor-declined" ||
          n.subtype === "doctor_declined" ||
          n.subtype === "rejected" ||
          n.subtype === "declined" ||
          n.subtype === "schedule-conflict" ||
          n.subtype === "schedule_conflict" ||
          /review update|schedule conflict|declined|rejected/i.test(n.title || "") ||
          /schedule conflict|consultation will be reassigned|was declined/i.test(n.body || "");

        // Detect schedule confirmation / approval notifications
        const isScheduleApproved =
          !isApptCompleted &&
          !isApptRejected &&
          (
            n.type === "appointment-scheduled" ||
            n.type === "appointment_scheduled" ||
            n.type === "appointment-accepted" ||
            n.type === "appointment_accepted" ||
            n.type === "appointment-approved" ||
            n.type === "appointment_approved" ||
            n.type === "doctor-confirmed-schedule" ||
            n.type === "doctor_confirmed_schedule" ||
            n.type === "schedule-confirmed" ||
            n.type === "schedule_confirmed" ||
            n.subtype === "doctor-confirmed-schedule" ||
            n.subtype === "doctor_confirmed_schedule" ||
            n.subtype === "appointment-approved" ||
            n.subtype === "appointment_approved" ||
            n.subtype === "schedule-confirmed" ||
            n.subtype === "schedule_confirmed" ||
            n.subtype === "confirmed" ||
            n.subtype === "doctor-approved" ||
            n.subtype === "doctor_approved" ||
            n.subtype === "reassigned" ||
            /doctor confirmed schedule|appointment confirmed|schedule confirmed|reschedule request approved/i.test(n.title || "") ||
            /approved your consultation schedule|schedule.*confirmed|has been confirmed|has been reassigned/i.test(n.body || "")
          );

        // Detect missed / no-show appointment notifications
        const isApptMissed =
          n.type === "appointment-missed" ||
          n.type === "appointment_missed" ||
          n.type === "appointment-no-show" ||
          n.type === "appointment_no_show" ||
          n.type === "no-show" ||
          n.type === "no_show" ||
          n.subtype === "appointment-missed" ||
          n.subtype === "appointment_missed" ||
          n.subtype === "appointment-no-show" ||
          n.subtype === "appointment_no_show" ||
          n.subtype === "no-show" ||
          n.subtype === "no_show" ||
          /missed\s*\/\s*no-show|appointment marked as missed|no-show/i.test(n.title || "") ||
          /recorded as no-show|marked as missed/i.test(n.body || "");

        const needsClinicEnrichment = !isTicket && !isAdminSystem && (isApptCompleted || isPaymentConfirmed || isApptRejected || isScheduleApproved || isApptMissed);
        const ticketIdMatch = n.body?.match(/ticket #([^ ')]+)/i)?.[1];

        // For completed consultations, payment confirmations, schedule approvals, and conflict/rejection DB records,
        // resolve the real clinic name + logo using the 2-path lookup strategy:
        //   Path 1: metadata.appointment_id → exact lookup in clinicByApptId map
        //   Path 2: No appointment_id in metadata → find appointment whose timestamp
        //          is closest to this notification's timestamp.
        const apptId = ((n as any).metadata?.appointment_id || (n as any).metadata?.appointmentId) as string | undefined;

        let clinicEnrichment: {
          name: string;
          logo: string | null;
          appointmentId?: string;
          declinedAt?: string;
        } | undefined;

        if (needsClinicEnrichment) {
          if (apptId) {
            // Path 1: exact match by appointment_id
            const matchedClinic = clinicByApptId.get(apptId);
            if (matchedClinic) {
              clinicEnrichment = {
                name: matchedClinic.name,
                logo: matchedClinic.logo,
                appointmentId: apptId,
              };
            }
          }

          if (!clinicEnrichment) {
            // Path 2: no appointment_id in metadata — find the appointment
            // whose timestamp is closest to this notification's created_at.
            const notifTime = new Date(n.created_at).getTime();
            const approvedFilter = (a: any) =>
              a.doctor_status === "approved" ||
              a.status === "confirmed" ||
              a.status === "scheduled" ||
              a.status === "approved";

            const missedFilter = (a: any) =>
              a.check_in_status === "no-show" ||
              a.status === "no-show" ||
              /no-show/i.test(a.clinic_note || "");

            const candidateAppts = isApptCompleted
              ? ((appointments || []).filter((a: any) => a.status === "completed").length > 0
                  ? (appointments || []).filter((a: any) => a.status === "completed")
                  : (appointments || []))
              : isApptRejected
              ? (appointments || []).filter((a: any) => a.doctor_status === "rejected" || a.status === "cancelled")
              : isScheduleApproved
              ? ((appointments || []).filter(approvedFilter).length > 0
                  ? (appointments || []).filter(approvedFilter)
                  : (appointments || []))
              : isApptMissed
              ? ((appointments || []).filter(missedFilter).length > 0
                  ? (appointments || []).filter(missedFilter)
                  : (appointments || []))
              : (appointments || []);

            if (candidateAppts.length > 0) {
              const closest = candidateAppts.reduce((best: any, appt: any) => {
                const apptTime = new Date(
                  appt.doctor_reviewed_at || appt.created_at || 0
                ).getTime();
                const bestTime = new Date(
                  best.doctor_reviewed_at || best.created_at || 0
                ).getTime();
                return Math.abs(apptTime - notifTime) < Math.abs(bestTime - notifTime)
                  ? appt
                  : best;
              });

              const cObj = Array.isArray(closest.clinic)
                ? closest.clinic[0]
                : closest.clinic;

              if (cObj?.name) {
                clinicEnrichment = {
                  name: cObj.name,
                  logo: cObj.logo_url || null,
                  appointmentId: closest.appointment_id,
                  declinedAt: closest.doctor_reviewed_at || closest.created_at,
                };
              }
            }
          }
        }

        const resolvedApptId = apptId || clinicEnrichment?.appointmentId || (n as any).metadata?.appointment_id;
        const notifDeclinedAt = (n as any).metadata?.declined_at || (n as any).metadata?.rejection_timestamp || n.created_at;
        const isRejectedResolved =
          isApptRejected &&
          (Boolean((n as any).metadata?.reselection_resolved) || isApptReselectionResolved(resolvedApptId, notifDeclinedAt));
        const metaAdminId =
          (n as any).metadata?.admin_id ||
          (n as any).metadata?.resolved_by ||
          (n as any).metadata?.responder_id;
        const matchedAdmin = metaAdminId ? adminProfileById.get(String(metaAdminId)) : undefined;
        const resolvedAdminAvatar =
          resolveAvatarUrl((n as any).metadata?.sender_avatar || (n as any).metadata?.avatar_url) ||
          matchedAdmin?.avatarUrl ||
          defaultAdminAvatar ||
          undefined;

        items.push({
          id: n.notif_id,
          type: isApptCompleted
            ? "appointment-completed"
            : isPaymentConfirmed
            ? (n.type || "appointment-payment-confirmed")
            : isApptRejected
            ? "appointment-rejected"
            : isScheduleApproved
            ? (n.type || "appointment-scheduled")
            : isApptMissed
            ? (n.type && n.type !== "system" ? n.type : "appointment-no-show")
            : (n.type || "system"),
          category: (!isTicket && (n.type?.includes("appointment") || needsClinicEnrichment))
            ? "appointment"
            : isTicket
              ? "ticket"
              : isBroadcast
                ? "broadcast"
                : "system",
          title: n.title,
          message: n.body || "",
          // Completed consultations, payment confirmations, schedule approvals & rejections: use real clinic name from appointment join.
          // Support tickets: use "DERMAI Support" or responding admin's full name.
          senderName:
            (needsClinicEnrichment && clinicEnrichment?.name) ||
            (!isTicket && (n as any).metadata?.clinic_name) ||
            (n as any).metadata?.sender_name ||
            (n as any).metadata?.admin_name ||
            (isTicket
              ? (matchedAdmin?.fullName || "DERMAI Support")
              : isAdminSystem
              ? "Platform Administrator"
              : undefined),
          // Completed consultations, payment confirmations, schedule approvals & rejections: attach clinic logo for avatar rendering.
          // Support tickets & admin notifications: attach resolved admin profile avatar.
          senderAvatar: needsClinicEnrichment
            ? (clinicEnrichment?.logo ?? (n as any).metadata?.clinic_logo ?? (n as any).metadata?.sender_avatar ?? null)
            : (isTicket || isAdminSystem)
            ? resolvedAdminAvatar
            : ((n as any).metadata?.sender_avatar || (n as any).metadata?.avatar_url || undefined),
          senderType: needsClinicEnrichment
            ? "clinic"
            : isTicket || isAdminSystem
            ? "admin"
            : (n.subtype as any) || "system",
          link: isRejectedResolved
            ? "/patient/appointment-status"
            : ((n as any).metadata?.link || (isApptRejected && resolvedApptId
                ? `/patient/appointment-status?appointment_id=${resolvedApptId}&action=reassign`
                : isTicket ? "/patient/support" : undefined)),
          timestamp: n.created_at,
          isRead: Boolean(
            isNotificationRead(n.notif_id, Boolean(n.is_read), readSet, {
              appointmentId: resolvedApptId,
              ticketId: ticketIdMatch || (n as any).metadata?.ticket_id,
              broadcastId: (n as any).metadata?.broadcast_id,
              title: n.title,
              message: n.body,
            }) || isRejectedResolved
          ),
          metadata: {
            ...(n as any).metadata,
            appointment_id: resolvedApptId,
            declined_at: (n as any).metadata?.declined_at || clinicEnrichment?.declinedAt || n.created_at,
            reselection_resolved: isRejectedResolved,
            ticket_id: ticketIdMatch || (n as any).metadata?.ticket_id,
            subtype: n.subtype,
          },
        });
      });
    }

    // 2. Live Patient Appointments (with Clinic Name joined)
    // appointments already fetched above in the parallel Promise.all — reuse it.

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
            isRead: isNotificationRead(notifId, false, readSet, {
              appointmentId: appt.appointment_id,
              title: "Appointment Confirmed",
              message: `Your appointment at ${clinicName} on ${dateStr}${timeStr} has been confirmed.`,
            }),
            metadata: { appointment_id: appt.appointment_id },
          });
        }

        // B1. Doctor-Initiated Decline (Only when doctor declined and not patient cancelled and reselection not already resolved)
        if (appt.doctor_status === "rejected" && appt.status !== "cancelled" && !isApptReselectionResolved(appt.appointment_id)) {
          const rejectionStamp = appt.doctor_reviewed_at
            ? new Date(appt.doctor_reviewed_at).getTime()
            : (appt.updated_at ? new Date(appt.updated_at).getTime() : "initial");
          const notifId = `appt-rejected-${appt.appointment_id}-${rejectionStamp}`;
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
            link: `/patient/appointment-status?appointment_id=${appt.appointment_id}&action=reassign`,
            timestamp: appt.doctor_reviewed_at || appt.created_at || new Date().toISOString(),
            isRead:
              readSet.has(notifId) ||
              (rejectionStamp === "initial" && readSet.has(`appt-rejected-${appt.appointment_id}`)) ||
              isNotificationRead(notifId, false, readSet, {
                appointmentId: appt.appointment_id,
                title: "Appointment Declined",
                message: rejectMsg,
              }),
            metadata: {
              appointment_id: appt.appointment_id,
              doctor_id: appt.assigned_doctor_id || (appt.questionnaire_answers as any)?.latest_declined_doctor_id,
              declined_at: appt.doctor_reviewed_at || appt.created_at || new Date().toISOString(),
              rejection_timestamp: appt.doctor_reviewed_at || appt.created_at || new Date().toISOString(),
              expires_at: new Date(new Date(appt.doctor_reviewed_at || appt.created_at || Date.now()).getTime() + 24 * 3600 * 1000).toISOString(),
            },
          });
        }

        // B2. Patient-Initiated or Administrative Cancellation
        if (appt.status === "cancelled") {
          const notifId = `appt-cancelled-${appt.appointment_id}`;
          const noteText = appt.clinic_note ? ` Note: "${appt.clinic_note}".` : "";
          const cancelMsg = `Your consultation request with ${clinicName} on ${dateStr} was cancelled.${noteText}`;

          items.push({
            id: notifId,
            type: "appointment-cancelled",
            category: "appointment",
            title: `Appointment Cancelled`,
            message: cancelMsg,
            senderName: clinicName,
            senderType: "clinic",
            senderAvatar: clinicLogo,
            link: "/dashboard/appointment-status",
            timestamp: appt.created_at || new Date().toISOString(),
            isRead: isNotificationRead(notifId, false, readSet, {
              appointmentId: appt.appointment_id,
              title: "Appointment Cancelled",
              message: cancelMsg,
            }),
            metadata: { appointment_id: appt.appointment_id },
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
            isRead: isNotificationRead(notifId, false, readSet, {
              appointmentId: appt.appointment_id,
              title: "Consultation Completed",
            }),
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
        const fullTicketId = String(ticket.ticket_id || "").toLowerCase();
        const shortTicketId = fullTicketId.slice(0, 8);
        const alreadyNotified = items.some((i) => {
          const metaTicketId = String(i.metadata?.ticket_id || "").toLowerCase();
          if (metaTicketId && (metaTicketId === fullTicketId || metaTicketId.includes(shortTicketId))) {
            return true;
          }
          if (i.category === "ticket" || i.type?.includes("ticket")) {
            const bodyLower = (i.message || "").toLowerCase();
            if (shortTicketId && bodyLower.includes(shortTicketId)) return true;
          }
          return false;
        });
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
            senderAvatar: defaultAdminAvatar || undefined,
            link: "/dashboard/settings/help",
            timestamp: ticket.updated_at || ticket.created_at,
            isRead: isNotificationRead(notifId, false, readSet, {
              ticketId: ticket.ticket_id,
              title: "Support Ticket Updated",
            }),
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
        const normBTitle = (b.title || "").trim().toLowerCase();
        const normBMsg = (b.message || "").trim().toLowerCase();
        const alreadyDelivered = items.some((i) => {
          if (i.metadata?.broadcast_id === b.broadcast_id) return true;
          const iTitle = (i.title || "").trim().toLowerCase();
          const iMsg = (i.message || "").trim().toLowerCase();
          return iTitle === normBTitle && iMsg === normBMsg;
        });
        if (alreadyDelivered) return;

        const notifId = `broadcast-${b.broadcast_id}`;
        items.push({
          id: notifId,
          type: "broadcast",
          category: "broadcast",
          title: b.title,
          message: b.message,
          senderName: "Platform Administrator",
          senderType: "admin",
          senderAvatar: defaultAdminAvatar || undefined,
          timestamp: b.sent_at,
          isRead: isNotificationRead(notifId, false, readSet, {
            broadcastId: b.broadcast_id,
            title: b.title,
            message: b.message,
          }),
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

  return deduplicateNotificationItems(items);
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
export async function fetchDoctorNotifications(userId: string, userEmail?: string, limit: number = 100): Promise<NotificationItem[]> {
  if (!userId) return [];
  const readSet = getReadIds("doctor", userId);
  const items: NotificationItem[] = [];

  try {
    // 1. Resolve Doctor ID & ALL branch clinic_ids from clinic_doctor table
    const docIds: string[] = [userId];
    const branchClinicIds: string[] = [];
    const clinicNameMap = new Map<string, string>(); // clinic_id -> name
    const clinicLogoMap = new Map<string, string>(); // clinic_id -> logo_url

    const { data: docRecords } = await supabase
      .from("clinic_doctor")
      .select("doctor_id, doctor_name, clinic_id, email, user_id, clinic:clinic_id(name, logo_url)");

    let currentClinicName = "Clinic";
    (docRecords || []).forEach((d: any) => {
      const matchUserId = d.user_id && d.user_id === userId;
      const matchEmail = userEmail && d.email && d.email.toLowerCase() === userEmail.toLowerCase();
      if (matchUserId || matchEmail) {
        if (d.doctor_id) docIds.push(d.doctor_id);
        if (d.clinic_id) branchClinicIds.push(d.clinic_id);
        const cObj = Array.isArray(d.clinic) ? d.clinic[0] : d.clinic;
        if (cObj?.name) {
          currentClinicName = cObj.name;
          if (d.clinic_id) clinicNameMap.set(d.clinic_id, cObj.name);
        }
        if (cObj?.logo_url && d.clinic_id) clinicLogoMap.set(d.clinic_id, cObj.logo_url);
      }
    });

    const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
    const validDoctorIds = Array.from(new Set(docIds.filter(isUuid)));
    const validBranchIds = Array.from(new Set(branchClinicIds.filter(isUuid)));

    // Fetch platform admin avatar for admin-sent notifications (support tickets, broadcasts)
    let adminAvatar: string | undefined = undefined;
    try {
      const { data: adminUser } = await supabase
        .from("user")
        .select("avatar_url")
        .or("role.eq.admin,email.eq.dermaisupport@gmail.com,user_id.eq.03c4dbd4-5d15-4c78-872e-93811b3afa23")
        .not("avatar_url", "is", null)
        .limit(1)
        .maybeSingle();
      if (adminUser?.avatar_url) {
        adminAvatar = resolveAvatarUrl(adminUser.avatar_url) || adminUser.avatar_url;
      }
      if (!adminAvatar) {
        const { data: adminProf } = await supabase
          .from("profiles")
          .select("avatar_url, profile_picture")
          .eq("role", "admin")
          .limit(1)
          .maybeSingle();
        const rawAv = (adminProf as any)?.avatar_url || (adminProf as any)?.profile_picture;
        if (rawAv) {
          adminAvatar = resolveAvatarUrl(rawAv) || rawAv;
        }
      }
    } catch { }

    // Helper: resolve patient avatar
    const buildNotifItems = async (appointments: any[]) => {
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
            .select("user_id, avatar_url")
            .in("user_id", missingUserIds);
          (userRows || []).forEach((u: any) => {
            if (u.avatar_url) fallbackAvatarMap.set(u.user_id, u.avatar_url);
          });
        } catch { }
      }
      return { fallbackAvatarMap };
    };

    // 2A. Fetch Doctor's Assigned Appointments (existing behavior)
    let fetchedAssignedAppts: any[] = [];
    if (validDoctorIds.length > 0) {
      const { data: appointments } = await supabase
        .from("patient_appointment")
        .select(`
          appointment_id,
          clinic_id,
          date,
          time,
          status,
          check_in_status,
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
        .limit(limit);

      if (appointments) {
        fetchedAssignedAppts = appointments;
        const { fallbackAvatarMap } = await buildNotifItems(appointments);

        appointments.forEach((appt: any) => {
          // Avoid generating fake review notifications for abandoned unpaid checkout holds cancelled before review
          const isCancelledHold = appt.status === "cancelled" && !appt.doctor_reviewed_at && !appt.schedule_sent_to_doctor;
          if (isCancelledHold) return;

          const patient = appt.patient_name || "A patient";
          const condition = appt.ai_condition_name ? ` for ${appt.ai_condition_name}` : "";
          const dateStr = appt.date
            ? new Date(appt.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "scheduled date";
          const cObj = Array.isArray(appt.clinic) ? appt.clinic[0] : appt.clinic;
          const clinic = cObj?.name || clinicNameMap.get(appt.clinic_id) || currentClinicName;
          const clinicLogo = cObj?.logo_url || clinicLogoMap.get(appt.clinic_id) || undefined;

          const uObj = Array.isArray(appt.user) ? appt.user[0] : appt.user;
          const patientAvatar =
            uObj?.avatar_url ||
            (appt.user_id ? fallbackAvatarMap.get(appt.user_id) : undefined) ||
            undefined;

          const patientId = appt.user_id || appt.appointment_id;
          const clinicId = appt.clinic_id;
          const appointmentId = appt.appointment_id;
          const targetNav = clinicId && patientId
            ? `/doctor/clinics/${clinicId}/patients/${patientId}?appointmentId=${appointmentId}`
            : "/doctor/appointments";

          // A. Assigned appointments (pending review, approved, or historical)
          // Preserves historical review notifications across appointment status transitions
          const notifId = `doc-req-${appt.appointment_id}`;
          const isDelegated = Boolean(appt.schedule_sent_to_doctor);
          items.push({
            id: notifId,
            type: isDelegated ? "appointment-delegated" : "appointment_request",
            category: "appointment",
            title: "To Review New Appointment",
            message: "A new paid appointment has been assigned to you and is awaiting your review.",
            senderName: clinic,
            senderType: "clinic",
            senderAvatar: clinicLogo || undefined,
            link: targetNav,
            timestamp: appt.created_at || new Date().toISOString(),
            isRead: readSet.has(notifId),
            metadata: {
              appointment_id: appointmentId,
              appointmentId: appointmentId,
              appointment_status: appt.status,
              doctor_status: appt.doctor_status,
              clinic_id: clinicId,
              clinicId: clinicId,
              clinic_name: clinic,
              clinic_logo: clinicLogo,
              branch_name: clinic,
              branch_logo: clinicLogo,
              patient_id: patientId,
              patientId: patientId,
              patient_avatar: patientAvatar,
              category: "appointment",
              type: "appointment_request",
              link: targetNav,
            },
          });

          // B. Genuine upcoming consultation reminder (approaching scheduled time within 24 hours)
          // Suppresses redundant self-confirmation ("... has been confirmed") when doctor approves the appointment
          if (appt.doctor_status === "approved" && appt.status !== "completed" && appt.date) {
            const parsedApptTime = resolveAppointmentTimestamp(appt, appt.date);
            const apptTimestamp = new Date(parsedApptTime).getTime();
            const now = Date.now();
            const isApproaching = !isNaN(apptTimestamp) && apptTimestamp >= now && apptTimestamp - now <= 24 * 60 * 60 * 1000;
            if (isApproaching) {
              const notifId = `doc-reminder-${appt.appointment_id}`;
              const timeStr = appt.time ? ` at ${appt.time}` : "";
              items.push({
                id: notifId,
                type: "appointment-reminder",
                category: "appointment",
                title: "Upcoming Consultation Reminder",
                message: `Reminder: Consultation with ${patient}${condition} is scheduled for ${dateStr}${timeStr} at ${clinic}.`,
                senderName: clinic,
                senderType: "clinic",
                senderAvatar: clinicLogo || undefined,
                link: "/doctor/scheduled",
                timestamp: appt.created_at || new Date().toISOString(),
                isRead: readSet.has(notifId),
                metadata: {
                  appointment_id: appt.appointment_id,
                  appointmentId: appointmentId,
                  clinic_id: clinicId,
                  clinicId: clinicId,
                  clinic_name: clinic,
                  branch_name: clinic,
                  patient_id: patientId,
                  patientId: patientId,
                },
              });
            }
          }
        });
      }
    }

    // 2B. Cross-Branch: Fetch NEW unassigned pending appointment requests
    //     from ALL clinic branches this doctor belongs to.
    //     This fires for any branch — even one not currently active in the UI.
    let fetchedBranchRequests: any[] = [];
    if (validBranchIds.length > 0) {
      const alreadyTrackedIds = new Set(items.map((i) => {
        // extract appointment_id suffix from notifId like "doc-req-<uuid>"
        return i.metadata?.appointment_id;
      }).filter(Boolean));

      const { data: branchRequests } = await supabase
        .from("patient_appointment")
        .select(`
          appointment_id,
          clinic_id,
          date,
          status,
          check_in_status,
          doctor_status,
          patient_name,
          ai_condition_name,
          assigned_doctor_id,
          created_at,
          user_id,
          user:user_id(avatar_url, full_name),
          clinic:clinic_id(name, logo_url)
        `)
        .in("clinic_id", validBranchIds)
        .is("assigned_doctor_id", null)       // unassigned requests only
        .in("status", ["pending", "requested"]) // only new incoming requests
        .order("created_at", { ascending: false })
        .limit(30);

      if (branchRequests) {
        fetchedBranchRequests = branchRequests;
        const { fallbackAvatarMap } = await buildNotifItems(branchRequests);

        branchRequests.forEach((appt: any) => {
          // Skip if we already added a notification for this appointment
          if (alreadyTrackedIds.has(appt.appointment_id)) return;

          const notifId = `doc-branch-req-${appt.appointment_id}`;
          const patient = appt.patient_name || "A patient";
          const condition = appt.ai_condition_name ? ` for ${appt.ai_condition_name}` : "";
          const dateStr = appt.date
            ? new Date(appt.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "a scheduled date";

          const cObj = Array.isArray(appt.clinic) ? appt.clinic[0] : appt.clinic;
          const clinic = cObj?.name || clinicNameMap.get(appt.clinic_id) || "Your Branch";
          const clinicLogo = cObj?.logo_url || clinicLogoMap.get(appt.clinic_id) || undefined;

          const uObj = Array.isArray(appt.user) ? appt.user[0] : appt.user;
          const patientAvatar =
            uObj?.avatar_url ||
            (appt.user_id ? fallbackAvatarMap.get(appt.user_id) : undefined) ||
            undefined;

          const patientId = appt.user_id || appt.appointment_id;
          const clinicId = appt.clinic_id;
          const appointmentId = appt.appointment_id;
          const targetNav = clinicId && patientId
            ? `/doctor/clinics/${clinicId}/patients/${patientId}?appointmentId=${appointmentId}`
            : "/doctor/appointments";

          items.push({
            id: notifId,
            type: "appointment_request",
            category: "appointment",
            title: "New Appointment Request",
            message: `${patient} has requested a consultation${condition} at ${clinic} on ${dateStr}. Tap to review.`,
            senderName: patient,
            senderType: "patient",
            senderAvatar: patientAvatar || undefined,
            link: targetNav,
            timestamp: appt.created_at || new Date().toISOString(),
            isRead: readSet.has(notifId),
            metadata: {
              appointment_id: appointmentId,
              appointmentId: appointmentId,
              clinic_id: clinicId,
              clinicId: clinicId,
              patient_id: patientId,
              patientId: patientId,
              branch_name: clinic,
              branch_logo: clinicLogo,
              category: "appointment",
              type: "appointment_request",
              link: targetNav,
            },
          });
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
        const normBTitle = (b.title || "").trim().toLowerCase();
        const normBMsg = (b.message || "").trim().toLowerCase();
        const alreadyDelivered = items.some((i) => {
          if (i.metadata?.broadcast_id === b.broadcast_id) return true;
          const iTitle = (i.title || "").trim().toLowerCase();
          const iMsg = (i.message || "").trim().toLowerCase();
          return iTitle === normBTitle && iMsg === normBMsg;
        });
        if (alreadyDelivered) return;

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

    // 5. Direct User Notifications for Doctor (with clinic enrichment for booking notifications)
    const allDoctorAppointments = [...fetchedAssignedAppts, ...fetchedBranchRequests];
    const clinicByApptId = new Map<string, { clinic_id?: string; name: string; logo: string | null }>();

    allDoctorAppointments.forEach((appt: any) => {
      if (!appt.appointment_id) return;
      const cObj = Array.isArray(appt.clinic) ? appt.clinic[0] : appt.clinic;
      const cName = cObj?.name || clinicNameMap.get(appt.clinic_id) || currentClinicName;
      const cLogo = cObj?.logo_url || clinicLogoMap.get(appt.clinic_id) || null;
      clinicByApptId.set(appt.appointment_id, {
        clinic_id: appt.clinic_id,
        name: cName,
        logo: cLogo,
      });
    });

    const { data: directNotifs } = await supabase
      .from("user_notification")
      .select("notif_id, type, subtype, title, body, is_read, metadata, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (directNotifs && directNotifs.length > 0) {
      // Pre-resolve missing appointment IDs or clinic IDs referenced in direct notifications
      const missingApptIds = Array.from(new Set(
        directNotifs
          .map((n: any) => n.metadata?.appointment_id || n.metadata?.appointmentId)
          .filter((id: any): id is string => Boolean(id && isUuid(id) && !clinicByApptId.has(id)))
      ));

      if (missingApptIds.length > 0) {
        try {
          const { data: extraAppts } = await supabase
            .from("patient_appointment")
            .select("appointment_id, clinic_id, created_at, date, clinic:clinic_id(name, logo_url)")
            .in("appointment_id", missingApptIds);

          (extraAppts || []).forEach((ea: any) => {
            const cObj = Array.isArray(ea.clinic) ? ea.clinic[0] : ea.clinic;
            const cName = cObj?.name || clinicNameMap.get(ea.clinic_id) || currentClinicName;
            const cLogo = cObj?.logo_url || clinicLogoMap.get(ea.clinic_id) || null;
            if (ea.appointment_id) {
              clinicByApptId.set(ea.appointment_id, {
                clinic_id: ea.clinic_id,
                name: cName,
                logo: cLogo,
              });
            }
            if (ea.clinic_id && cName) {
              clinicNameMap.set(ea.clinic_id, cName);
              if (cLogo) clinicLogoMap.set(ea.clinic_id, cLogo);
            }
            allDoctorAppointments.push(ea);
          });
        } catch { }
      }

      const missingClinicIds = Array.from(new Set(
        directNotifs
          .map((n: any) => n.metadata?.clinic_id || n.metadata?.clinicId)
          .filter((id: any): id is string => Boolean(id && isUuid(id) && !clinicNameMap.has(id)))
      ));

      if (missingClinicIds.length > 0) {
        try {
          const { data: extraClinics } = await supabase
            .from("clinic")
            .select("clinic_id, name, logo_url")
            .in("clinic_id", missingClinicIds);

          (extraClinics || []).forEach((c: any) => {
            if (c.clinic_id && c.name) {
              clinicNameMap.set(c.clinic_id, c.name);
              if (c.logo_url) clinicLogoMap.set(c.clinic_id, c.logo_url);
            }
          });
        } catch { }
      }

      directNotifs.forEach((n) => {
        const isBroadcast = n.type === "broadcast" || n.subtype === "admin_announcement";
        const isMaintenance = n.subtype === "maintenance_alert" || n.type === "maintenance_alert";
        const isTicket =
          n.type === "support_ticket" ||
          n.type === "support" ||
          n.type === "support-ticket-received" ||
          n.type === "support_ticket_received" ||
          n.type === "support-ticket-resolved" ||
          n.type === "support_ticket_resolved" ||
          n.subtype === "support" ||
          n.subtype === "support_ticket" ||
          n.type?.includes("ticket") ||
          n.type?.includes("support") ||
          n.subtype?.includes("ticket") ||
          n.subtype?.includes("support") ||
          (n as any).metadata?.category === "support" ||
          (n as any).metadata?.category === "ticket" ||
          /support ticket|ticket received|ticket resolved|ticket updated/i.test(n.title || "");
        const isAdminSystem = isBroadcast || isMaintenance;
        const ticketIdMatch = n.body?.match(/ticket #([^ ')]+)/i)?.[1];

        const meta = (n as any).metadata || {};
        const metaClinicId = meta.clinicId || meta.clinic_id;
        const metaPatientId = meta.patientId || meta.patient_id || meta.user_id;
        const metaApptId = meta.appointmentId || meta.appointment_id;

        const isBookingNotif =
          !isTicket &&
          !isAdminSystem &&
          (
            meta.category === "appointment" ||
            n.type === "new-booking" ||
            n.type === "new_booking" ||
            n.type === "appointment-created" ||
            n.type === "appointment_created" ||
            n.type === "appointment_request" ||
            n.type === "appointment-request" ||
            n.type === "appointment" ||
            n.type === "appointment-confirmed" ||
            n.subtype === "new-booking" ||
            n.subtype === "new_booking" ||
            n.subtype === "appointment-created" ||
            n.subtype === "appointment_created" ||
            n.subtype === "appointment_request" ||
            Boolean(metaApptId) ||
            /booking|appointment/i.test(n.title || "") ||
            /booking|appointment/i.test(n.type || "")
          );

        // Path 1 & Path 2 Clinic Lookup for Booking Notifications
        let enrichedClinic: { name: string; logo_url: string | null; clinic_id?: string; appointment_id?: string } | null = null;

        if (isBookingNotif) {
          // Path 1: Check metadata.appointment_id or metadata.clinic_id
          if (metaApptId && clinicByApptId.has(metaApptId)) {
            const match = clinicByApptId.get(metaApptId)!;
            enrichedClinic = {
              name: match.name,
              logo_url: match.logo,
              clinic_id: match.clinic_id || metaClinicId,
              appointment_id: metaApptId,
            };
          } else if (metaClinicId && clinicNameMap.has(metaClinicId)) {
            enrichedClinic = {
              name: clinicNameMap.get(metaClinicId)!,
              logo_url: clinicLogoMap.get(metaClinicId) || null,
              clinic_id: metaClinicId,
              appointment_id: metaApptId,
            };
          }

          // Path 2: Match the closest appointment record in appointments joined with clinics (name, logo_url)
          if (!enrichedClinic && allDoctorAppointments.length > 0) {
            const notifTime = new Date(n.created_at || Date.now()).getTime();
            const closest = allDoctorAppointments.reduce((best: any, appt: any) => {
              const apptTime = new Date(appt.created_at || appt.date || 0).getTime();
              const bestTime = new Date(best.created_at || best.date || 0).getTime();
              return Math.abs(apptTime - notifTime) < Math.abs(bestTime - notifTime) ? appt : best;
            });

            if (closest) {
              const cObj = Array.isArray(closest.clinic) ? closest.clinic[0] : closest.clinic;
              const cName = cObj?.name || clinicNameMap.get(closest.clinic_id) || currentClinicName;
              const cLogo = cObj?.logo_url || clinicLogoMap.get(closest.clinic_id) || null;
              if (cName) {
                enrichedClinic = {
                  name: cName,
                  logo_url: cLogo,
                  clinic_id: closest.clinic_id,
                  appointment_id: closest.appointment_id,
                };
              }
            }
          }

          // Fallback to doctor's primary clinic
          if (!enrichedClinic && currentClinicName && currentClinicName !== "Clinic") {
            enrichedClinic = {
              name: currentClinicName,
              logo_url: (branchClinicIds[0] && clinicLogoMap.get(branchClinicIds[0])) || null,
              clinic_id: branchClinicIds[0],
              appointment_id: metaApptId,
            };
          }
        }

        const category: NotificationCategory =
          isTicket ? "ticket" :
          isAdminSystem ? "broadcast" :
          isBookingNotif || meta.category === "appointment" || n.type === "appointment_request" || n.type === "appointment" ? "appointment" :
          meta.category || "system";

        const resolvedClinicId = enrichedClinic?.clinic_id || metaClinicId;
        const resolvedApptId = enrichedClinic?.appointment_id || metaApptId;

        const resolvedLink =
          meta.link ||
          (isTicket
            ? "/doctor/settings"
            : resolvedClinicId && metaPatientId
              ? `/doctor/clinics/${resolvedClinicId}/patients/${metaPatientId}${resolvedApptId ? `?appointmentId=${resolvedApptId}` : ""}`
              : isBookingNotif
              ? (resolvedApptId ? `/doctor/appointments?appointmentId=${resolvedApptId}` : "/doctor/appointments")
              : undefined);

        // Explicitly override sender values for booking notifications:
        // item.senderName = clinic.name (e.g., "DerMA", "DERMCARE", etc.)
        // item.senderAvatar = clinic.logo_url
        const finalSenderName = enrichedClinic?.name ||
          meta.sender_name ||
          (isTicket ? "DERMAI Support" : isAdminSystem ? "Platform Administrator" : (isBookingNotif ? (currentClinicName || "Clinic") : "DERMAI Admin"));

        const finalSenderAvatar = enrichedClinic?.logo_url ||
          resolveAvatarUrl(meta.avatar_url || meta.sender_avatar) ||
          ((isAdminSystem || isTicket) ? adminAvatar : undefined);

        const finalSenderType = enrichedClinic ? "clinic" : (isAdminSystem || isTicket ? "admin" : (n.subtype as any) || (isBookingNotif ? "clinic" : "system"));

        const matchingAppt = resolvedApptId ? allDoctorAppointments.find((a: any) => a.appointment_id === resolvedApptId) : undefined;

        items.push({
          id: n.notif_id,
          type: n.type || (isBookingNotif ? "appointment_request" : "system"),
          category,
          title: n.title,
          message: n.body || "",
          link: resolvedLink,
          senderName: finalSenderName,
          senderType: finalSenderType,
          senderAvatar: finalSenderAvatar || undefined,
          timestamp: n.created_at,
          isRead: Boolean(n.is_read || readSet.has(n.notif_id)),
          metadata: {
            ...meta,
            ticket_id: ticketIdMatch || meta.ticket_id,
            subtype: n.subtype,
            clinic_id: resolvedClinicId,
            clinicId: resolvedClinicId,
            clinic_name: enrichedClinic?.name,
            clinic_logo: enrichedClinic?.logo_url,
            branch_name: enrichedClinic?.name || meta.branch_name,
            branch_logo: enrichedClinic?.logo_url || meta.branch_logo,
            appointment_id: resolvedApptId,
            appointmentId: resolvedApptId,
            appointment_status: matchingAppt?.status || meta.appointment_status || meta.status,
            doctor_status: matchingAppt?.doctor_status || meta.doctor_status,
          },
        });
      });
    }
  } catch (err) {
    console.warn("[notificationService] Error fetching doctor notifications:", err);
  }

  return deduplicateNotificationItems(items);
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
      } catch { }
    }

    // If clinicId is not provided, look up by owner user_id or email
    if (!resolvedClinicId && (userId || clinicEmail)) {
      let query = supabase.from("clinic").select("clinic_id, name, owner_user_id, status, logo_url, created_at");
      if (userId && clinicEmail) {
        query = query.or(`owner_user_id.eq.${userId},email.ilike.${clinicEmail}`);
      } else if (userId) {
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

    // Pre-fetch live admin profile picture from public.user / public.profiles in Supabase
    let adminAvatar: string | null = null;
    try {
      const { data: adminUser } = await supabase
        .from("user")
        .select("avatar_url")
        .or("role.eq.admin,email.eq.dermaisupport@gmail.com,user_id.eq.03c4dbd4-5d15-4c78-872e-93811b3afa23")
        .not("avatar_url", "is", null)
        .limit(1)
        .maybeSingle();
      if (adminUser?.avatar_url) {
        adminAvatar = resolveAvatarUrl(adminUser.avatar_url) || adminUser.avatar_url;
      }
      if (!adminAvatar) {
        const { data: adminProf } = await supabase
          .from("profiles")
          .select("avatar_url, profile_picture")
          .eq("role", "admin")
          .limit(1)
          .maybeSingle();
        const rawAv = (adminProf as any)?.avatar_url || (adminProf as any)?.profile_picture;
        if (rawAv) {
          adminAvatar = resolveAvatarUrl(rawAv) || rawAv;
        }
      }
    } catch { }

    // Helper to strip generic "Patient" / "Patient Patient" placeholders and return only a real patient name
    const cleanClinicPatientName = (raw?: string | null): string => {
      if (!raw || typeof raw !== "string") return "";
      const cleaned = raw
        .replace(/^(?:patient\s+)+/i, "")
        .replace(/^patient$/i, "")
        .replace(/^a\s+patient$/i, "")
        .trim();
      if (!cleaned || /^(?:patient|a patient|unknown|doctor|clinic system|dermai admin)$/i.test(cleaned)) {
        return "";
      }
      return cleaned;
    };

    // Helper to normalize and format doctor full names with "Dr. " prefix
    const formatDoctorSenderName = (raw?: string | null): string => {
      if (!raw || typeof raw !== "string") return "";
      const cleaned = raw.replace(/^(?:dr\.?|doctor)\s+/i, "").trim();
      if (!cleaned || /^(?:doctor|assigned doctor|attending doctor|unknown|dr)$/i.test(cleaned)) {
        return "";
      }
      return `Dr. ${cleaned}`;
    };

    const normalizeDoctorKey = (raw?: string | null): string => {
      if (!raw || typeof raw !== "string") return "";
      return raw.replace(/^(?:dr\.?|doctor)\s+/i, "").trim().toLowerCase();
    };

    const patientProfileByUserId = new Map<string, { fullName: string; avatarUrl?: string }>();
    const patientProfileByApptId = new Map<
      string,
      {
        fullName: string;
        avatarUrl?: string;
        userId?: string;
        doctorName?: string;
        doctorAvatar?: string;
        assignedDoctorId?: string;
        doctorStatus?: string;
        doctorReviewedAt?: string;
        status?: string;
        createdAt?: string;
        qAnswers?: any;
      }
    >();

    const docNameMap = new Map<string, string>();
    const docPhotoMap = new Map<string, string>();
    const doctorProfileById = new Map<string, { fullName: string; avatarUrl?: string; doctorId?: string; userId?: string }>();
    const doctorProfileByName = new Map<string, { fullName: string; avatarUrl?: string; doctorId?: string; userId?: string }>();

    const registerDoctorProfile = (entry: {
      doctorId?: string | null;
      userId?: string | null;
      rawName?: string | null;
      rawAvatar?: string | null;
    }) => {
      const fullName = formatDoctorSenderName(entry.rawName);
      const avatarUrl = entry.rawAvatar ? (resolveAvatarUrl(entry.rawAvatar) || entry.rawAvatar) : undefined;
      const docId = entry.doctorId ? String(entry.doctorId).trim() : undefined;
      const uId = entry.userId ? String(entry.userId).trim() : undefined;

      if (!fullName && !avatarUrl && !docId && !uId) return;

      if (docId) {
        const prev = doctorProfileById.get(docId);
        const merged = {
          fullName: fullName || prev?.fullName || "",
          avatarUrl: avatarUrl || prev?.avatarUrl,
          doctorId: docId,
          userId: uId || prev?.userId,
        };
        doctorProfileById.set(docId, merged);
        if (merged.fullName) docNameMap.set(docId, merged.fullName);
        if (merged.avatarUrl) docPhotoMap.set(docId, merged.avatarUrl);
      }

      if (uId) {
        const prev = doctorProfileById.get(uId);
        const merged = {
          fullName: fullName || prev?.fullName || "",
          avatarUrl: avatarUrl || prev?.avatarUrl,
          doctorId: docId || prev?.doctorId,
          userId: uId,
        };
        doctorProfileById.set(uId, merged);
        if (merged.fullName && !docNameMap.has(uId)) docNameMap.set(uId, merged.fullName);
        if (merged.avatarUrl && !docPhotoMap.has(uId)) docPhotoMap.set(uId, merged.avatarUrl);
      }

      const normName = normalizeDoctorKey(entry.rawName);
      if (normName) {
        const prevByName = doctorProfileByName.get(normName);
        const mergedByName = {
          fullName: fullName || prevByName?.fullName || "",
          avatarUrl: avatarUrl || prevByName?.avatarUrl,
          doctorId: docId || prevByName?.doctorId,
          userId: uId || prevByName?.userId,
        };
        doctorProfileByName.set(normName, mergedByName);
        const compactKey = normName.replace(/\s+/g, "");
        if (compactKey && compactKey !== normName) {
          const prevCompact = doctorProfileByName.get(compactKey);
          doctorProfileByName.set(compactKey, {
            fullName: mergedByName.fullName || prevCompact?.fullName || "",
            avatarUrl: mergedByName.avatarUrl || prevCompact?.avatarUrl,
            doctorId: mergedByName.doctorId || prevCompact?.doctorId,
            userId: mergedByName.userId || prevCompact?.userId,
          });
        }
        const firstToken = normName.split(/\s+/)[0];
        if (firstToken && firstToken.length >= 2) {
          const prevFirst = doctorProfileByName.get(firstToken);
          if (!prevFirst || (!prevFirst.avatarUrl && mergedByName.avatarUrl)) {
            doctorProfileByName.set(firstToken, {
              fullName: prevFirst?.fullName || mergedByName.fullName,
              avatarUrl: mergedByName.avatarUrl || prevFirst?.avatarUrl,
              doctorId: mergedByName.doctorId || prevFirst?.doctorId,
              userId: mergedByName.userId || prevFirst?.userId,
            });
          }
        }
      }
    };

    // Preload doctor directory & user profiles (clinic_doctor -> user / profiles) so all
    // doctor-action notifications resolve real doctor full names and avatar_url images
    try {
      const [{ data: allDoctors }, { data: allUsers }] = await Promise.all([
        supabase.from("clinic_doctor").select("doctor_id, user_id, email, doctor_name, photo_url, clinic_id"),
        supabase.from("user").select("user_id, full_name, email, role, avatar_url"),
      ]);

      const userByIdMap = new Map<string, any>();
      const userByEmailMap = new Map<string, any>();
      const userByNameMap = new Map<string, any>();

      (allUsers || []).forEach((u: any) => {
        if (u.user_id) {
          const uid = String(u.user_id);
          userByIdMap.set(uid, u);
          const pName = cleanClinicPatientName(u.full_name);
          if (pName || u.avatar_url) {
            patientProfileByUserId.set(uid, {
              fullName: pName,
              avatarUrl: u.avatar_url || undefined,
            });
          }
        }
        if (u.email) userByEmailMap.set(String(u.email).trim().toLowerCase(), u);
        if (u.full_name) {
          const norm = normalizeDoctorKey(u.full_name);
          if (norm) {
            userByNameMap.set(norm, u);
            userByNameMap.set(norm.replace(/\s+/g, ""), u);
          }
        }
        if (u.role === "doctor" || u.full_name) {
          registerDoctorProfile({
            userId: u.user_id,
            rawName: u.full_name,
            rawAvatar: u.avatar_url,
          });
        }
      });

      (allDoctors || []).forEach((cd: any) => {
        const linkedUser =
          (cd.user_id ? userByIdMap.get(String(cd.user_id)) : undefined) ||
          (cd.email ? userByEmailMap.get(String(cd.email).trim().toLowerCase()) : undefined) ||
          (cd.doctor_name ? userByNameMap.get(normalizeDoctorKey(cd.doctor_name)) : undefined);

        registerDoctorProfile({
          doctorId: cd.doctor_id,
          userId: cd.user_id || linkedUser?.user_id,
          rawName: cd.doctor_name || linkedUser?.full_name,
          rawAvatar: cd.photo_url || linkedUser?.avatar_url,
        });
      });
    } catch { }

    const resolveClinicActivityDoctor = (notifRow: any): {
      fullName: string;
      avatarUrl?: string;
      doctorId?: string;
      userId?: string;
      appointmentId?: string;
    } => {
      const meta = notifRow?.metadata || {};
      const apptId = notifRow?.appointment_id || meta.appointment_id || meta.appointmentId;
      const apptMatch = apptId ? patientProfileByApptId.get(String(apptId)) : undefined;

      const rawDocId =
        notifRow?.doctor_id ||
        meta.doctor_id ||
        meta.doctorId ||
        notifRow?.assigned_doctor_id ||
        meta.assigned_doctor_id;
      const rawDocUserId = meta.doctor_user_id || (meta.user_id && String(meta.user_id) !== String(resolvedUserId) ? meta.user_id : undefined);

      const bodyText = notifRow?.body || notifRow?.message || "";
      const bodyDocName = bodyText
        .match(/^(?:Dr\.?|Doctor)\s+(.+?)\s+(?:accepted|declined|rejected|completed|approved|confirmed|had a schedule conflict)/i)?.[1]
        ?.trim();
      const rawMetaDocName =
        meta.doctor_name ||
        meta.doctorName ||
        (notifRow?.sender_name && !/^(?:patient|dermai|platform)/i.test(notifRow.sender_name) ? notifRow.sender_name : "") ||
        (meta.sender_name && !/^(?:patient|dermai|platform)/i.test(meta.sender_name) ? meta.sender_name : "") ||
        bodyDocName ||
        "";

      const isDecline =
        notifRow?.subtype === "doctor-declined" ||
        notifRow?.subtype === "doctor-rejected" ||
        notifRow?.type === "doctor-rejected" ||
        notifRow?.type === "doctor-declined" ||
        /declined/i.test(notifRow?.title || "") ||
        /declined/i.test(bodyText);

      // Check appointment history for the specific doctor who accepted/declined if appointment was later reassigned
      let historyDocId: string | undefined;
      let historyDocName: string | undefined;
      if (apptMatch?.qAnswers && Array.isArray(apptMatch.qAnswers.appointment_history)) {
        const targetAction = isDecline ? "doctor_rejected" : "doctor_approved";
        const matchingHist = apptMatch.qAnswers.appointment_history.find(
          (h: any) => h?.action === targetAction && (h?.doctorId || h?.doctorName)
        );
        if (matchingHist) {
          historyDocId = matchingHist.doctorId ? String(matchingHist.doctorId) : undefined;
          historyDocName = matchingHist.doctorName;
        }
      }

      const byDocId = rawDocId ? doctorProfileById.get(String(rawDocId)) : undefined;
      const byUserId = rawDocUserId ? doctorProfileById.get(String(rawDocUserId)) : undefined;
      const byHistId = historyDocId ? doctorProfileById.get(String(historyDocId)) : undefined;

      const normCandidateName = normalizeDoctorKey(rawMetaDocName || bodyDocName || historyDocName || apptMatch?.doctorName);
      let byName = normCandidateName
        ? doctorProfileByName.get(normCandidateName) ||
          doctorProfileByName.get(normCandidateName.replace(/\s+/g, "")) ||
          doctorProfileByName.get(normCandidateName.split(/\s+/)[0])
        : undefined;

      if (!byName && normCandidateName) {
        for (const [k, val] of doctorProfileByName.entries()) {
          if (k.startsWith(normCandidateName) || normCandidateName.startsWith(k)) {
            if (val.avatarUrl || !byName) {
              byName = val;
              if (val.avatarUrl) break;
            }
          }
        }
      }

      // Prefer explicit notification doctor name (formatted as "Dr. ...") so a declined notification
      // for Dr. Audrey isn't overwritten by a newly reassigned doctor on the appointment
      const explicitName = formatDoctorSenderName(rawMetaDocName || bodyDocName || historyDocName);
      const profileName =
        byDocId?.fullName ||
        byUserId?.fullName ||
        byName?.fullName ||
        byHistId?.fullName ||
        formatDoctorSenderName(apptMatch?.doctorName);

      const fullName = explicitName || profileName || "Dr. Attending Doctor";
      const rawAvatar =
        byDocId?.avatarUrl ||
        byUserId?.avatarUrl ||
        byName?.avatarUrl ||
        byHistId?.avatarUrl ||
        meta.doctor_avatar ||
        meta.sender_avatar ||
        (!explicitName || (apptMatch?.doctorName && normalizeDoctorKey(apptMatch.doctorName) === normalizeDoctorKey(explicitName))
          ? apptMatch?.doctorAvatar
          : undefined);
      const avatarUrl = rawAvatar ? (resolveAvatarUrl(rawAvatar) || rawAvatar) : undefined;
      let resolvedApptId = apptId ? String(apptId) : undefined;

      // Path 2: If notification lacks appointment_id in metadata, match against clinic appointments
      // using patient name in notification body, doctor name/ID, or closest review timestamp
      if (!resolvedApptId && patientProfileByApptId.size > 0) {
        const patientInBody = bodyText
          .match(/(?:request\s+for|booking\s+for|notes.*?for|for)\s+([A-Za-z][A-Za-z\s.'-]+?)(?:[:.]|\s+on\s+|$)/i)?.[1]
          ?.trim()
          ?.toLowerCase();

        const allAppts = Array.from(patientProfileByApptId.entries()).map(([id, val]) => ({ id, ...val }));
        const patMatched = patientInBody
          ? allAppts.filter((e) => {
              const pName = (e.fullName || "").trim().toLowerCase();
              return pName && (pName.includes(patientInBody) || patientInBody.includes(pName));
            })
          : [];

        const docMatched = normCandidateName
          ? (patMatched.length > 0 ? patMatched : allAppts).filter((e) => {
              const dName = normalizeDoctorKey(e.doctorName);
              const histHasDoc =
                Array.isArray(e.qAnswers?.appointment_history) &&
                e.qAnswers.appointment_history.some(
                  (h: any) =>
                    normalizeDoctorKey(h?.doctorName || h?.previousDoctorName) === normCandidateName ||
                    (rawDocId && String(h?.doctorId || h?.previousDoctorId) === String(rawDocId))
                );
              return (dName && (dName.includes(normCandidateName) || normCandidateName.includes(dName))) || histHasDoc;
            })
          : [];

        const candidates = docMatched.length > 0 ? docMatched : patMatched.length > 0 ? patMatched : allAppts;
        if (candidates.length > 0) {
          const notifTime = new Date(notifRow?.created_at || 0).getTime();
          let best = candidates[0];
          if (!isNaN(notifTime) && notifTime > 0) {
            let bestDiff = Infinity;
            candidates.forEach((c) => {
              const cTime = new Date(c.doctorReviewedAt || c.createdAt || 0).getTime();
              const diff = !isNaN(cTime) && cTime > 0 ? Math.abs(notifTime - cTime) : Infinity;
              if (diff < bestDiff) {
                bestDiff = diff;
                best = c;
              }
            });
          }
          if (best?.id) {
            resolvedApptId = best.id;
          }
        }
      }

      return {
        fullName,
        avatarUrl,
        doctorId: String(rawDocId || byDocId?.doctorId || byName?.doctorId || historyDocId || apptMatch?.assignedDoctorId || "") || undefined,
        userId: String(rawDocUserId || byDocId?.userId || byName?.userId || "") || undefined,
        appointmentId: resolvedApptId,
      };
    };

    const fetchAndCachePatientProfiles = async (userIds: string[]) => {
      const missingIds = Array.from(new Set(userIds.map((id) => String(id || "").trim()).filter((id) => id && !patientProfileByUserId.has(id))));
      if (missingIds.length === 0) return;

      try {
        const { data: userRows } = await supabase
          .from("user")
          .select("user_id, full_name, avatar_url")
          .in("user_id", missingIds);
        if (Array.isArray(userRows)) {
          userRows.forEach((u: any) => {
            const uid = String(u.user_id || "");
            if (!uid) return;
            const fullName = cleanClinicPatientName(u.full_name);
            const avatarUrl = u.avatar_url || undefined;
            if (fullName || avatarUrl) {
              patientProfileByUserId.set(uid, { fullName, avatarUrl });
            }
          });
        }
      } catch { }

      try {
        const { data: profRows } = await supabase
          .from("profiles")
          .select("user_id, patient_id, first_name, last_name, full_name, avatar_url, profile_picture")
          .in("user_id", missingIds);
        if (Array.isArray(profRows)) {
          profRows.forEach((p: any) => {
            const uid = String(p.patient_id || p.user_id || "");
            if (!uid) return;
            const existing = patientProfileByUserId.get(uid);
            const fullName =
              existing?.fullName ||
              cleanClinicPatientName(p.full_name) ||
              cleanClinicPatientName([p.first_name, p.last_name].filter(Boolean).join(" "));
            const avatarUrl = existing?.avatarUrl || p.avatar_url || p.profile_picture || undefined;
            if (fullName || avatarUrl) {
              patientProfileByUserId.set(uid, { fullName, avatarUrl });
            }
          });
        }
      } catch { }

      try {
        const { data: patRows } = await supabase
          .from("patients")
          .select("user_id, patient_id, first_name, last_name, full_name, avatar_url, profile_picture")
          .in("user_id", missingIds);
        if (Array.isArray(patRows)) {
          patRows.forEach((p: any) => {
            const uid = String(p.patient_id || p.user_id || "");
            if (!uid) return;
            const existing = patientProfileByUserId.get(uid);
            const fullName =
              existing?.fullName ||
              cleanClinicPatientName(p.full_name) ||
              cleanClinicPatientName([p.first_name, p.last_name].filter(Boolean).join(" "));
            const avatarUrl = existing?.avatarUrl || p.avatar_url || p.profile_picture || undefined;
            if (fullName || avatarUrl) {
              patientProfileByUserId.set(uid, { fullName, avatarUrl });
            }
          });
        }
      } catch { }
    };

    const resolveClinicActivityPatient = (notifRow: any): { fullName: string; avatarUrl?: string; appointmentId?: string; patientId?: string } => {
      const meta = notifRow?.metadata || {};
      const apptId = notifRow?.appointment_id || meta.appointment_id || meta.appointmentId;
      const apptMatch = apptId ? patientProfileByApptId.get(String(apptId)) : undefined;
      const rawPid =
        notifRow?.patient_id ||
        meta.patient_id ||
        meta.patientId ||
        meta.user_id ||
        apptMatch?.userId ||
        (notifRow?.user_id && String(notifRow.user_id) !== String(resolvedUserId) ? notifRow.user_id : undefined);

      const joinedPat = Array.isArray(notifRow?.patient) ? notifRow.patient[0] : notifRow?.patient;
      const profMatch = rawPid ? patientProfileByUserId.get(String(rawPid)) : undefined;

      const metaFullName =
        cleanClinicPatientName([joinedPat?.first_name || meta.patient_first_name, joinedPat?.last_name || meta.patient_last_name].filter(Boolean).join(" ")) ||
        cleanClinicPatientName(joinedPat?.full_name) ||
        cleanClinicPatientName(meta.patient_name) ||
        cleanClinicPatientName(meta.sender_name) ||
        cleanClinicPatientName(notifRow?.sender_name);

      let fullName = profMatch?.fullName || apptMatch?.fullName || metaFullName || "";
      let avatarUrl =
        joinedPat?.avatar_url ||
        joinedPat?.profile_picture ||
        profMatch?.avatarUrl ||
        apptMatch?.avatarUrl ||
        meta.patient_avatar ||
        meta.sender_avatar ||
        undefined;
      let resolvedApptId = apptId ? String(apptId) : undefined;
      let resolvedPid = rawPid ? String(rawPid) : undefined;

      // Path 2: If notification lacks metadata/patient_id or appointment_id, match against the clinic's appointments
      if ((!fullName || !avatarUrl || !resolvedApptId) && patientProfileByApptId.size > 0) {
        const bodyText = notifRow?.body || notifRow?.message || "";
        const docInBody = bodyText
          .match(/selected\s+(?:Dr\.?\s+)?(.+?)\s+as their alternate doctor/i)?.[1]
          ?.replace(/^dr\.?\s+/i, "")
          .trim()
          .toLowerCase();

        const allEntries = Array.from(patientProfileByApptId.entries())
          .map(([id, val]) => ({ id, ...val }))
          .filter((e) => e.fullName || e.avatarUrl || e.id);

        const pidOrNameMatched = allEntries.filter((e) => {
          if (resolvedPid && e.userId && String(e.userId) === String(resolvedPid)) return true;
          if (fullName && e.fullName && e.fullName.trim().toLowerCase() === fullName.trim().toLowerCase()) return true;
          return false;
        });

        const docMatched = docInBody
          ? (pidOrNameMatched.length > 0 ? pidOrNameMatched : allEntries).filter((e) => {
              const dName = (e.doctorName || "").replace(/^dr\.?\s+/i, "").trim().toLowerCase();
              return dName && (dName.includes(docInBody) || docInBody.includes(dName));
            })
          : [];

        const reassignedMatched = (pidOrNameMatched.length > 0 ? pidOrNameMatched : allEntries).filter(
          (e) =>
            e.qAnswers?.reassigned_by === "patient" ||
            (Array.isArray(e.qAnswers?.appointment_history) &&
              e.qAnswers.appointment_history.some((h: any) => h?.action === "alternate_doctor_selected"))
        );

        const candidates =
          docMatched.length > 0
            ? docMatched
            : reassignedMatched.length > 0
            ? reassignedMatched
            : pidOrNameMatched.length > 0
            ? pidOrNameMatched
            : allEntries;
        if (candidates.length > 0) {
          const notifTime = new Date(notifRow?.created_at || 0).getTime();
          let best = candidates[0];
          if (!isNaN(notifTime) && notifTime > 0) {
            let bestDiff = Infinity;
            candidates.forEach((c) => {
              const cTime = new Date(c.qAnswers?.reassigned_at || c.createdAt || 0).getTime();
              const diff = !isNaN(cTime) && cTime > 0 ? Math.abs(notifTime - cTime) : Infinity;
              if (diff < bestDiff) {
                bestDiff = diff;
                best = c;
              }
            });
          }
          if (!fullName && best.fullName) fullName = best.fullName;
          if (!avatarUrl && best.avatarUrl) avatarUrl = best.avatarUrl;
          if (!resolvedApptId && best.id) resolvedApptId = best.id;
          if (!resolvedPid && best.userId) resolvedPid = String(best.userId);
        }
      }

      return { fullName, avatarUrl, appointmentId: resolvedApptId, patientId: resolvedPid };
    };

    // 1. Live Appointments for this clinic directly from public.patient_appointment
    if (resolvedClinicId) {
      let liveAppts: any[] = [];
      const { data: appointments, error: apptError } = await supabase
        .from("patient_appointment")
        .select(`
          appointment_id,
          date,
          time,
          status,
          check_in_status,
          doctor_status,
          doctor_note,
          doctor_reviewed_at,
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
        .limit(40);

      if (apptError) {
        console.warn("[notificationService] Error querying patient_appointment, attempting resilient fallback:", apptError.message);
        try {
          const { data: fallbackAppts } = await supabase
            .from("patient_appointment")
            .select("appointment_id, date, time, status, doctor_status, doctor_note, doctor_reviewed_at, patient_name, ai_condition_name, questionnaire_answers, created_at, user_id, assigned_doctor_id")
            .eq("clinic_id", resolvedClinicId)
            .order("created_at", { ascending: false })
            .limit(40);
          if (fallbackAppts) liveAppts = fallbackAppts;
        } catch { }
      } else if (appointments) {
        liveAppts = appointments;
      }

      // Also merge with local storage cache (matches ClinicAppointmentsPage)
      try {
        const rawLocal = localStorage.getItem("dermai_clinic_appointments");
        if (rawLocal) {
          const parsed = JSON.parse(rawLocal);
          if (Array.isArray(parsed)) {
            parsed.forEach((localAppt: any) => {
              const matchesClinic =
                !localAppt.clinicId ||
                String(localAppt.clinicId) === String(resolvedClinicId) ||
                (clinicRow?.name && localAppt.clinicName && localAppt.clinicName.toLowerCase().trim() === clinicRow.name.toLowerCase().trim());
              const apptId = localAppt.appointment_id || localAppt.id;
              if (matchesClinic && apptId && !liveAppts.some((a) => (a.appointment_id || a.id) === apptId)) {
                liveAppts.push(localAppt);
              }
            });
          }
        }
      } catch { }

      if (liveAppts.length > 0) {
        await fetchAndCachePatientProfiles(
          liveAppts.map((a: any) => a.user_id || a.userId).filter(Boolean)
        );

        liveAppts.forEach((appt: any) => {
          const apptId = appt.appointment_id || appt.id;
          const uObj = Array.isArray(appt.user) ? appt.user[0] : appt.user;
          const uid = appt.user_id || appt.userId;
          const prof = uid ? patientProfileByUserId.get(String(uid)) : undefined;
          const resolvedPatFullName =
            cleanClinicPatientName(uObj?.full_name) ||
            prof?.fullName ||
            cleanClinicPatientName(appt.patient_name || appt.patientName);
          const patient = resolvedPatFullName || "A patient";
          const patientAvatar = uObj?.avatar_url || prof?.avatarUrl || appt.patientAvatar || undefined;

          const docObj = Array.isArray(appt.doctor) ? appt.doctor[0] : appt.doctor;
          const assignedId = appt.assigned_doctor_id || appt.assignedDoctorId;
          const rawDocName =
            docObj?.doctor_name ||
            appt.assignedDoctorName ||
            (assignedId ? docNameMap.get(String(assignedId)) : undefined);
          const normDocKey = normalizeDoctorKey(rawDocName);
          const docByName = normDocKey
            ? doctorProfileByName.get(normDocKey) ||
              doctorProfileByName.get(normDocKey.replace(/\s+/g, "")) ||
              doctorProfileByName.get(normDocKey.split(/\s+/)[0])
            : undefined;
          const doctorName =
            formatDoctorSenderName(rawDocName) ||
            (assignedId ? doctorProfileById.get(String(assignedId))?.fullName : undefined) ||
            docByName?.fullName ||
            "Dr. Assigned Doctor";
          const rawDocAvatar =
            docObj?.photo_url ||
            (assignedId ? docPhotoMap.get(String(assignedId)) || doctorProfileById.get(String(assignedId))?.avatarUrl : undefined) ||
            docByName?.avatarUrl ||
            undefined;
          const doctorAvatar = rawDocAvatar ? (resolveAvatarUrl(rawDocAvatar) || rawDocAvatar) : undefined;

          const qAnswers = typeof appt.questionnaire_answers === "object" && appt.questionnaire_answers
            ? appt.questionnaire_answers
            : (appt.questionnaireAnswers || {});

          if (apptId) {
            patientProfileByApptId.set(String(apptId), {
              fullName: resolvedPatFullName,
              avatarUrl: patientAvatar,
              userId: uid ? String(uid) : undefined,
              doctorName,
              doctorAvatar,
              assignedDoctorId: assignedId ? String(assignedId) : undefined,
              doctorStatus: appt.doctor_status || appt.doctorStatus,
              doctorReviewedAt: appt.doctor_reviewed_at || appt.doctorReviewedAt,
              status: appt.status,
              createdAt: appt.created_at || appt.createdAt,
              qAnswers,
            });
          }

          const condition = appt.ai_condition_name || appt.aiConditionName ? ` for ${appt.ai_condition_name || appt.aiConditionName}` : "";
          const dateStr = appt.date
            ? new Date(appt.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "scheduled date";

          const needsReschedule = Boolean(qAnswers.needs_patient_reschedule || qAnswers.reschedule_requested || appt.needsPatientReschedule || appt.rescheduleRequested);

          const docStatus = (appt.doctor_status || appt.doctorStatus || "").toLowerCase();
          const apptStatus = (appt.status || "").toLowerCase();

          // A. New Appointment Request / Pending Doctor Review
          // ONLY if not already approved, rejected, or cancelled
          if (
            (apptStatus === "pending" || docStatus === "pending-review" || docStatus === "pending") &&
            docStatus !== "rejected" &&
            docStatus !== "approved" &&
            apptStatus !== "cancelled" &&
            apptStatus !== "rejected"
          ) {
            const notifId = `clinic-req-${apptId}`;
            const reqTime = resolveAppointmentTimestamp(appt, appt.created_at || appt.createdAt);
            const targetLink = apptId ? `/clinic/appointments?appointment=${apptId}` : "/clinic/appointments";
            items.push({
              id: notifId,
              type: "appointment-request",
              category: "appointment",
              title: "New Appointment Request",
              message: `${patient} requested a consultation${condition} on ${dateStr}.`,
              senderName: patient,
              senderType: "patient",
              senderAvatar: patientAvatar,
              appointment_id: apptId ? String(apptId) : undefined,
              link: targetLink,
              timestamp: reqTime,
              isRead: readSet.has(notifId),
              metadata: { appointment_id: apptId, type: "appointment-request" },
            });
          }

          // B. Doctor Action: Accepted Booking
          if (docStatus === "approved" && apptStatus !== "completed" && apptStatus !== "cancelled") {
            const notifId = `clinic-doc-accept-${apptId}`;
            const acceptTime = resolveAppointmentTimestamp(appt, appt.doctor_reviewed_at || appt.doctorReviewedAt);
            const targetLink = apptId ? `/clinic/appointments?appointment=${apptId}` : "/clinic/appointments";
            items.push({
              id: notifId,
              type: "doctor-accepted",
              category: "appointment",
              title: "Doctor Accepted Appointment",
              message: `${doctorName} accepted the booking for ${patient} on ${dateStr}.`,
              senderName: doctorName,
              senderType: "doctor",
              senderAvatar: doctorAvatar,
              appointment_id: apptId ? String(apptId) : undefined,
              link: targetLink,
              timestamp: acceptTime,
              isRead: readSet.has(notifId),
              metadata: { appointment_id: apptId, type: "doctor-accepted" },
            });
          }

          // C. Doctor Action: Declined Appointment
          if (docStatus === "rejected") {
            const notifId = `clinic-doc-reject-${apptId}`;
            const docNote = appt.doctor_note || appt.doctorNote ? `: "${appt.doctor_note || appt.doctorNote}"` : "";
            const declineTime = resolveAppointmentTimestamp(appt, appt.doctor_reviewed_at || appt.doctorReviewedAt);
            const targetLink = apptId ? `/clinic/appointments?appointment=${apptId}` : "/clinic/appointments";
            items.push({
              id: notifId,
              type: "doctor-rejected",
              category: "appointment",
              title: "Doctor Declined Appointment",
              message: `${doctorName} declined the consultation request for ${patient}${docNote}. Reassignment required.`,
              senderName: doctorName,
              senderType: "doctor",
              senderAvatar: doctorAvatar,
              appointment_id: apptId ? String(apptId) : undefined,
              link: targetLink,
              timestamp: declineTime,
              isRead: readSet.has(notifId),
              metadata: { appointment_id: apptId, type: "doctor-rejected" },
            });
          }

          // D. Patient Cancelled Appointment (ONLY if not a doctor decline)
          if ((apptStatus === "cancelled" || apptStatus === "rejected") && docStatus !== "rejected") {
            const notifId = `clinic-cancel-${apptId}`;
            const cancelTime = resolveAppointmentTimestamp(appt, appt.cancelled_at || appt.cancelledAt || appt.updated_at || appt.updatedAt);
            const cancelNote = appt.clinic_note || appt.clinicNote;
            const cancelMsg = cancelNote && !/cancelled by patient/i.test(cancelNote)
              ? `The appointment for ${patient} on ${dateStr} was cancelled (${cancelNote}).`
              : `The appointment for ${patient} on ${dateStr} was cancelled.`;
            const targetLink = apptId ? `/clinic/appointments?appointment=${apptId}` : "/clinic/appointments";

            items.push({
              id: notifId,
              type: "appointment-cancelled",
              category: "appointment",
              title: "Appointment Cancelled",
              message: cancelMsg,
              senderName: patient,
              senderType: "patient",
              senderAvatar: patientAvatar,
              appointment_id: apptId ? String(apptId) : undefined,
              link: targetLink,
              timestamp: cancelTime,
              isRead: readSet.has(notifId),
              metadata: { appointment_id: apptId, type: "appointment-cancelled" },
            });
          }

          // E. Patient Re-selection / Reschedule Alert
          if (needsReschedule) {
            const notifId = `clinic-reselect-${apptId}`;
            const reselTime = resolveAppointmentTimestamp(appt, appt.doctor_reviewed_at || appt.doctorReviewedAt);
            const targetLink = apptId ? `/clinic/appointments?appointment=${apptId}` : "/clinic/appointments";
            items.push({
              id: notifId,
              type: "patient-reselection",
              category: "appointment",
              title: "Patient Doctor Re-selection",
              message: `${patient} selected an alternate doctor or updated their requested schedule.`,
              senderName: patient,
              senderType: "patient",
              senderAvatar: patientAvatar,
              appointment_id: apptId ? String(apptId) : undefined,
              link: targetLink,
              timestamp: reselTime,
              isRead: readSet.has(notifId),
              metadata: { appointment_id: apptId, type: "patient-reselection" },
            });
          }

          // F. Consultation Completed
          if (apptStatus === "completed") {
            const notifId = `clinic-complete-${apptId}`;
            const compTime = resolveAppointmentTimestamp(appt, appt.created_at || appt.createdAt);
            const targetLink = apptId ? `/clinic/appointments?appointment=${apptId}` : "/clinic/appointments";
            items.push({
              id: notifId,
              type: "consultation-completed",
              category: "appointment",
              title: "Consultation Completed",
              message: `${doctorName} completed consultation notes and final diagnosis for ${patient}.`,
              senderName: doctorName,
              senderType: "doctor",
              senderAvatar: doctorAvatar,
              appointment_id: apptId ? String(apptId) : undefined,
              link: targetLink,
              timestamp: compTime,
              isRead: readSet.has(notifId),
              metadata: { appointment_id: apptId, type: "consultation-completed" },
            });
          }
        });
      }
    }

    // 1b. Direct notifications for this clinic (e.g. booking_created, doctor_reselection, reselection_required)
    if (resolvedClinicId) {
      try {
        let dbRows: any[] = [];
        const { data: nData, error: nErr } = await supabase
          .from("notifications")
          .select("*")
          .in("type", ["booking_created", "doctor_reselection", "reselection_required"])
          .eq("clinic_id", resolvedClinicId)
          .order("created_at", { ascending: false })
          .limit(30);

        if (!nErr && Array.isArray(nData)) {
          dbRows = nData;
        } else {
          const { data: unData } = await supabase
            .from("user_notification")
            .select("*")
            .in("type", ["booking_created", "doctor_reselection", "reselection_required"])
            .eq("clinic_id", resolvedClinicId)
            .order("created_at", { ascending: false })
            .limit(30);
          if (Array.isArray(unData)) dbRows = unData;
        }

        if (dbRows.length > 0) {
          await fetchAndCachePatientProfiles(
            dbRows
              .map((r: any) => r.patient_id || r.metadata?.patient_id || r.metadata?.patientId || r.metadata?.user_id)
              .filter(Boolean)
          );
        }

        dbRows.forEach((r: any) => {
          const notifId = String(r.id || r.notif_id);
          const type = r.type || "booking_created";
          const resolvedPat = resolveClinicActivityPatient(r);
          const patDisplayName = resolvedPat.fullName;

          let defaultTitle = "Booking & Reselection Alert";
          let defaultMsg = "Appointment update for this clinic.";
          if (type === "booking_created") {
            defaultTitle = "New Booking Created";
            defaultMsg = patDisplayName
              ? `${patDisplayName} scheduled a new consultation booking.`
              : "A new appointment booking has been created.";
          } else if (type === "doctor_reselection") {
            defaultTitle = "Doctor Reselection";
            defaultMsg = patDisplayName
              ? `${patDisplayName} has reselected an alternate doctor.`
              : "Patient selected an alternate doctor for their appointment.";
          } else if (type === "reselection_required") {
            defaultTitle = "Doctor Reselection Required";
            defaultMsg = "Appointment requires selecting an alternate doctor.";
          }

          let rawMessage = r.message || r.body || defaultMsg;
          const patInBody = patDisplayName ? `Patient ${patDisplayName}` : "Patient";
          if (rawMessage.includes("Patient Patient")) {
            rawMessage = rawMessage.replace(/Patient\s+Patient/gi, patInBody);
          } else if (patDisplayName && /^Patient\s+has\s+selected\b/i.test(rawMessage)) {
            rawMessage = rawMessage.replace(/^Patient\s+has\s+selected\b/i, `${patInBody} has selected`);
          }

          const finalApptId = resolvedPat.appointmentId || r.appointment_id || r.metadata?.appointment_id || r.metadata?.appointmentId;
          const targetLink = finalApptId
            ? `/clinic/appointments?appointment=${finalApptId}`
            : (r.link || r.metadata?.link || "/clinic/appointments");

          items.push({
            id: notifId,
            type,
            subtype: r.subtype || r.metadata?.subtype,
            category: "appointment",
            title: r.title || defaultTitle,
            message: rawMessage,
            senderName:
              type === "reselection_required"
                ? "Clinic System"
                : patDisplayName || "Patient",
            senderType: (type === "reselection_required" ? "system" : "patient") as any,
            senderAvatar: resolvedPat.avatarUrl || null,
            appointment_id: finalApptId ? String(finalApptId) : undefined,
            link: targetLink,
            timestamp: r.created_at || new Date().toISOString(),
            isRead: Boolean(r.is_read || readSet.has(notifId)),
            metadata: {
              ...r.metadata,
              appointment_id: finalApptId,
              patient_id: resolvedPat.patientId || r.patient_id || r.metadata?.patient_id,
              patient_name: patDisplayName || r.metadata?.patient_name,
              patient_avatar: resolvedPat.avatarUrl || r.metadata?.patient_avatar,
              clinic_id: resolvedClinicId,
            },
          });
        });
      } catch { }
    }

    // 2. User Notifications for Clinic Owner (including Clinic Application Approval, broadcasts, maintenance)
    if (resolvedUserId) {
      const { data: userNotifs } = await supabase
        .from("user_notification")
        .select("notif_id, type, subtype, title, body, is_read, metadata, created_at")
        .eq("user_id", resolvedUserId)
        .order("created_at", { ascending: false })
        .limit(30);

      if (userNotifs) {
        await fetchAndCachePatientProfiles(
          userNotifs
            .map((n: any) => n.metadata?.patient_id || n.metadata?.patientId || n.metadata?.user_id)
            .filter(Boolean)
        );

        userNotifs.forEach((n: any) => {
          const isApproval =
            n.type === "clinic_application" ||
            n.subtype === "application_approved" ||
            n.subtype === "clinic_approval";
          const isBroadcast = n.type === "broadcast" || n.subtype === "admin_announcement";
          const isMaintenance = n.subtype === "maintenance_alert" || n.type === "maintenance_alert";
          const isTicket =
            n.type === "support_ticket" ||
            n.type === "support" ||
            n.type === "support-ticket-received" ||
            n.type === "support_ticket_received" ||
            n.type === "support-ticket-resolved" ||
            n.type === "support_ticket_resolved" ||
            n.subtype === "support" ||
            n.subtype === "support_ticket" ||
            n.type?.includes("ticket") ||
            n.type?.includes("support") ||
            n.subtype?.includes("ticket") ||
            n.subtype?.includes("support") ||
            (n as any).metadata?.category === "support" ||
            (n as any).metadata?.category === "ticket" ||
            /support ticket|ticket received|ticket resolved|ticket updated/i.test(n.title || "");
          const isAppointment = !isTicket && (n.type === "appointment" || n.metadata?.category === "appointment");
          // alternate_doctor_selected is a patient booking action — belongs to Bookings & Reselections,
          // not Doctor Actions. Exclude it from isDoctorAction so it doesn't route to the wrong tab.
          const isAlternateDoctorSelected =
            n.subtype === "alternate_doctor_selected" ||
            n.subtype === "alternate-doctor-selected" ||
            n.type === "alternate_doctor_selected" ||
            n.title === "Alternate Doctor Selected";
          const isReselectionOrPatientActivity =
            isAlternateDoctorSelected ||
            n.subtype === "reselection" ||
            n.type === "doctor_reselection" ||
            n.type === "bookings_and_reselections";
          const isDoctorAction =
            !isReselectionOrPatientActivity &&
            (n.subtype?.includes("doctor") ||
            n.type?.includes("doctor") ||
            n.metadata?.type?.includes("doctor") ||
            n.title?.toLowerCase().includes("doctor"));
          const isAdminSystem = isBroadcast || isMaintenance;
          const ticketIdMatch = n.body?.match(/ticket #([^ ')]+)/i)?.[1];

          const category: NotificationCategory = isBroadcast
            ? "broadcast"
            : isApproval
              ? "clinic"
              : isTicket
                ? "ticket"
                : isReselectionOrPatientActivity
                  ? "bookings_and_reselections"
                  : isAppointment
                    ? "appointment"
                    : "system";

          const senderType = isDoctorAction
            ? "doctor"
            : (isAppointment || isReselectionOrPatientActivity)
              ? "patient"
              : "admin";

          // For alternate_doctor_selected / reselection / patient appointment notifications,
          // dynamically resolve the patient's full name and avatar via metadata, user/profiles join, or clinic appointment lookup
          const resolvedPat = (isReselectionOrPatientActivity || (isAppointment && !isDoctorAction))
            ? resolveClinicActivityPatient(n)
            : { fullName: "", avatarUrl: undefined, appointmentId: undefined, patientId: undefined };
          const cleanPatName = resolvedPat.fullName;

          // For doctor-accepted / doctor-declined / doctor-action notifications,
          // dynamically resolve the doctor's full name (e.g. "Dr. Clark", "Dr. AUDREY LEE SALUDAGA") and avatar_url
          const resolvedDoc = isDoctorAction
            ? resolveClinicActivityDoctor(n)
            : { fullName: "", avatarUrl: undefined, doctorId: undefined, userId: undefined, appointmentId: undefined };

          const senderName = isReselectionOrPatientActivity
            ? (cleanPatName || "Patient")
            : isDoctorAction
              ? (resolvedDoc.fullName || formatDoctorSenderName((n as any).metadata?.doctor_name) || "Dr. Attending Doctor")
              : (cleanPatName ||
                cleanClinicPatientName((n as any).metadata?.sender_name) ||
                (isTicket
                  ? "DERMAI Support"
                  : isAdminSystem
                    ? "Platform Administrator"
                    : isApproval
                      ? "Platform Admin"
                      : isAppointment
                        ? "Patient"
                        : "DERMAI Admin"));

          const senderAvatar = isReselectionOrPatientActivity || (isAppointment && !isDoctorAction)
            ? (resolvedPat.avatarUrl || undefined)
            : isDoctorAction
              ? (resolvedDoc.avatarUrl || undefined)
              : (adminAvatar || undefined);

          const finalApptId =
            resolvedPat.appointmentId ||
            resolvedDoc.appointmentId ||
            n.appointment_id ||
            (n as any).metadata?.appointment_id ||
            (n as any).metadata?.appointmentId;

          const notifLink =
            isApproval
              ? "/clinic"
              : isTicket
                ? "/clinic/settings"
                : (isAppointment || isReselectionOrPatientActivity || isDoctorAction)
                  ? (finalApptId ? `/clinic/appointments?appointment=${finalApptId}` : "/clinic/appointments")
                  : undefined;

          // Route alternate_doctor_selected to "bookings_and_reselections" so it displays under
          // the Bookings & Reselections tab rather than Doctor Actions.
          const resolvedType = isReselectionOrPatientActivity
            ? "bookings_and_reselections"
            : (isApproval ? "application_approved" : n.subtype || n.type || "system");

          let notifMessage = n.body || n.message || "";
          const displayTitle = cleanPatName ? `Patient ${cleanPatName}` : "Patient";
          if (isReselectionOrPatientActivity) {
            if (notifMessage.includes("Patient Patient")) {
              notifMessage = notifMessage.replace(/Patient\s+Patient/gi, displayTitle);
            } else if (cleanPatName && /^Patient\s+has\s+selected\b/i.test(notifMessage)) {
              notifMessage = notifMessage.replace(/^Patient\s+has\s+selected\b/i, `${displayTitle} has selected`);
            }
          }

          items.push({
            id: n.notif_id,
            type: resolvedType,
            subtype: n.subtype,
            category,
            title: n.title,
            message: notifMessage,
            senderName,
            senderType,
            senderAvatar,
            appointment_id: finalApptId ? String(finalApptId) : undefined,
            link: notifLink,
            timestamp: n.created_at,
            isRead: Boolean(n.is_read || readSet.has(n.notif_id)),
            metadata: {
              ...(n as any).metadata,
              category,
              type: resolvedType,
              ticket_id: ticketIdMatch || (n as any).metadata?.ticket_id,
              subtype: n.subtype,
              ...(finalApptId ? { appointment_id: finalApptId } : {}),
              ...(resolvedPat.patientId ? { patient_id: resolvedPat.patientId } : {}),
              ...(cleanPatName ? { patient_name: cleanPatName } : {}),
              ...(resolvedPat.avatarUrl ? { patient_avatar: resolvedPat.avatarUrl } : {}),
              ...(resolvedDoc.doctorId ? { doctor_id: resolvedDoc.doctorId } : {}),
              ...(resolvedDoc.fullName ? { doctor_name: resolvedDoc.fullName } : {}),
              ...(resolvedDoc.avatarUrl ? { doctor_avatar: resolvedDoc.avatarUrl } : {}),
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
          const fullTicketId = String(ticket.ticket_id || "").toLowerCase();
          const shortTicketId = fullTicketId.slice(0, 8);
          const alreadyNotified = items.some((i) => {
            const metaTicketId = String(i.metadata?.ticket_id || "").toLowerCase();
            if (metaTicketId && (metaTicketId === fullTicketId || metaTicketId.includes(shortTicketId))) {
              return true;
            }
            if (i.category === "ticket" || i.type?.includes("ticket")) {
              const bodyLower = (i.message || "").toLowerCase();
              if (shortTicketId && bodyLower.includes(shortTicketId)) return true;
            }
            return false;
          });
          if (alreadyNotified) return;

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
        const normBTitle = (b.title || "").trim().toLowerCase();
        const normBMsg = (b.message || "").trim().toLowerCase();
        const alreadyDelivered = items.some((i) => {
          if (i.metadata?.broadcast_id === b.broadcast_id) return true;
          const iTitle = (i.title || "").trim().toLowerCase();
          const iMsg = (i.message || "").trim().toLowerCase();
          return iTitle === normBTitle && iMsg === normBMsg;
        });
        if (alreadyDelivered) return;

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

  return deduplicateNotificationItems(items);
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
export async function fetchAdminNotifications(userId?: string): Promise<NotificationItem[]> {
  const readSet = new Set<string>([
    ...Array.from(getReadIds("admin", "admin")),
    ...(userId ? Array.from(getReadIds("admin", userId)) : []),
  ]);
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

    // 1. Pending Clinic Applications & Explicit Clinic Notifications (Union Merge)
    const seenClinicIds = new Set<string>();
    const seenClinicNotifIds = new Set<string>();

    const formatClinicMessage = (name?: string) => {
      const rawName = (name || "New Clinic").trim();
      const clinicDisplay = rawName.toLowerCase().startsWith("clinic ") ? rawName : `Clinic ${rawName}`;
      return `${clinicDisplay} has submitted a new application for platform approval.`;
    };

    // 1a. Query pending/submitted clinic registration applications directly from Supabase public.clinic
    let pendingClinics: any[] = [];
    try {
      const { data: clinicsData } = await supabase
        .from("clinic")
        .select("clinic_id, name, created_at, email, status, logo_url, address, district")
        .in("status", ["pending", "submitted"])
        .order("created_at", { ascending: false })
        .limit(30);
      if (clinicsData) {
        pendingClinics = clinicsData;
      }
    } catch (clinicErr) {
      console.warn("[fetchAdminNotifications] clinic table lookup warning:", clinicErr);
    }

    // Fallback: Query public.clinic_registration if present
    try {
      const { data: regData } = await supabase
        .from("clinic_registration")
        .select("id, clinic_id, name, created_at, email, status, logo_url")
        .in("status", ["pending", "submitted"])
        .order("created_at", { ascending: false })
        .limit(30);
      if (regData && regData.length > 0) {
        regData.forEach((r: any) => {
          const rId = String(r.clinic_id || r.id);
          if (!pendingClinics.some((c) => String(c.clinic_id || c.id) === rId)) {
            pendingClinics.push({
              clinic_id: rId,
              name: r.name,
              created_at: r.created_at,
              email: r.email,
              status: r.status,
              logo_url: r.logo_url,
            });
          }
        });
      }
    } catch {}

    // Fallback: Local storage mirrors for newly registered clinics
    if (typeof window !== "undefined") {
      try {
        const localAppsRaw = localStorage.getItem("dermai_clinic_applications");
        if (localAppsRaw) {
          const localApps = JSON.parse(localAppsRaw);
          if (Array.isArray(localApps)) {
            localApps.forEach((la: any) => {
              const laId = String(la.id || la.clinic_id || "");
              const laStatus = (la.status || "pending").toLowerCase();
              if (
                laId &&
                (laStatus === "pending" || laStatus === "submitted") &&
                !pendingClinics.some((c) => String(c.clinic_id || c.id) === laId)
              ) {
                pendingClinics.push({
                  clinic_id: laId,
                  name: la.name,
                  created_at: la.createdAt || la.dateApplied || new Date().toISOString(),
                  email: la.email,
                  status: laStatus,
                  logo_url: la.logo || la.logo_url,
                });
              }
            });
          }
        }
      } catch {}
    }

    // 1b. Query explicit clinic user_notification records from Supabase
    let explicitClinicDbNotifs: any[] = [];
    try {
      const { data: cNotifs } = await supabase
        .from("user_notification")
        .select("notif_id, type, subtype, title, body, message, metadata, is_read, read_at, created_at, user_id")
        .or("type.eq.clinic,type.eq.clinic-pending,type.eq.new_clinic_application,subtype.eq.clinic_registration,subtype.eq.new_clinic_application")
        .order("created_at", { ascending: false })
        .limit(50);
      if (cNotifs) {
        explicitClinicDbNotifs = cNotifs;
      }
    } catch {}

    const uniqueClinicNotifsMap = new Map<string, any>();
    (explicitClinicDbNotifs || []).forEach((n: any) => {
      const id = String(n.notif_id || n.id || "");
      if (id && !uniqueClinicNotifsMap.has(id)) {
        uniqueClinicNotifsMap.set(id, n);
      }
    });

    // 1c. Primary: Render all explicit user_notification records tagged with category/type = 'clinic'
    uniqueClinicNotifsMap.forEach((rn: any, nid: string) => {
      seenClinicNotifIds.add(nid);
      const clinicId = String(
        rn.metadata?.clinic_id || rn.metadata?.clinicId || rn.metadata?.id || ""
      );
      if (clinicId) {
        seenClinicIds.add(clinicId);
      }

      const clinicName =
        rn.metadata?.clinic_name ||
        rn.metadata?.clinicName ||
        (clinicId ? allClinics?.find((c: any) => String(c.clinic_id) === clinicId)?.name : null) ||
        rn.title?.replace(/^New Clinic Application Submitted:?\s*/i, "").trim() ||
        "New Clinic";

      const avatar =
        rn.metadata?.logo_url ||
        (clinicId && clinicByName.get(clinicName.toLowerCase())) ||
        resolveUserAvatar(undefined, clinicName);

      items.push({
        id: nid,
        type: "clinic",
        category: "clinic",
        title: "New Clinic Application Submitted",
        message: formatClinicMessage(clinicName),
        senderName: clinicName,
        senderType: "clinic",
        senderAvatar: avatar,
        link: "/admin/clinic-management",
        timestamp: rn.created_at || new Date().toISOString(),
        isRead: Boolean(
          rn.is_read ||
            readSet.has(nid) ||
            (clinicId && readSet.has(`admin-clinic-app-${clinicId}`))
        ),
        metadata: {
          clinic_id: clinicId || undefined,
          status: rn.metadata?.status || "pending",
          ...rn.metadata,
        },
      });
    });

    // 1d. Fallback Union: Merge pending clinic applications not yet represented in user_notification
    pendingClinics.forEach((c: any) => {
      const cId = String(c.clinic_id || c.id || "");
      if (!cId || seenClinicIds.has(cId)) return;
      seenClinicIds.add(cId);

      const notifId = `admin-clinic-app-${cId}`;
      seenClinicNotifIds.add(notifId);

      const avatar = c.logo_url || clinicByName.get(c.name?.trim().toLowerCase()) || null;
      const clinicName = c.name?.trim() || "New Clinic";

      items.push({
        id: notifId,
        type: "clinic",
        category: "clinic",
        title: "New Clinic Application Submitted",
        message: formatClinicMessage(clinicName),
        senderName: clinicName,
        senderType: "clinic",
        senderAvatar: avatar,
        link: "/admin/clinic-management",
        timestamp: c.created_at || new Date().toISOString(),
        isRead: Boolean(readSet.has(notifId) || readSet.has(`admin-clinic-app-${cId}`)),
        metadata: {
          clinic_id: cId,
          status: c.status || "pending",
        },
      });
    });

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
      } catch { }
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

    // 8. Direct User Notifications for Admin (including booking events)
    if (userId) {
      const { data: adminDirectNotifs } = await supabase
        .from("user_notification")
        .select("notif_id, type, subtype, title, body, message, is_read, metadata, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(30);

      if (adminDirectNotifs && adminDirectNotifs.length > 0) {
        const clinicIdMap = new Map<string, { name: string; logo_url: string | null }>();
        (allClinics || []).forEach((c: any) => {
          if (c.clinic_id) {
            clinicIdMap.set(c.clinic_id, { name: c.name, logo_url: c.logo_url || null });
          }
        });

        const missingApptIds = Array.from(new Set(
          adminDirectNotifs
            .map((n: any) => n.metadata?.appointment_id || n.metadata?.appointmentId)
            .filter((id: any): id is string => Boolean(id && isUuid(id)))
        ));

        const apptLookupMap = new Map<string, { clinic_id?: string; name: string; logo: string | null }>();
        if (missingApptIds.length > 0) {
          try {
            const { data: appts } = await supabase
              .from("patient_appointment")
              .select("appointment_id, clinic_id, clinic:clinic_id(name, logo_url)")
              .in("appointment_id", missingApptIds);
            (appts || []).forEach((a: any) => {
              const cObj = Array.isArray(a.clinic) ? a.clinic[0] : a.clinic;
              const cName = cObj?.name || clinicIdMap.get(a.clinic_id)?.name || "Clinic";
              const cLogo = cObj?.logo_url || clinicIdMap.get(a.clinic_id)?.logo_url || null;
              apptLookupMap.set(a.appointment_id, {
                clinic_id: a.clinic_id,
                name: cName,
                logo: cLogo,
              });
            });
          } catch { }
        }

        adminDirectNotifs.forEach((n: any) => {
          const notifId = String(n.notif_id || n.id || "");
          if (!notifId || items.some((i) => i.id === notifId)) return;

          const meta = n.metadata || {};
          const metaApptId = meta.appointmentId || meta.appointment_id;
          const metaClinicId = meta.clinicId || meta.clinic_id;

          const isBookingNotif =
            n.type === "new-booking" ||
            n.type === "new_booking" ||
            n.type === "appointment-created" ||
            n.type === "appointment_created" ||
            n.type === "appointment_request" ||
            n.type === "appointment-request" ||
            n.subtype === "new-booking" ||
            n.subtype === "appointment-created" ||
            Boolean(metaApptId) ||
            /booking|appointment/i.test(n.title || "");

          if (isBookingNotif) {
            let enrichedClinic: { name: string; logo_url: string | null; clinic_id?: string } | null = null;
            // Path 1: Check metadata.appointment_id or metadata.clinic_id
            if (metaApptId && apptLookupMap.has(metaApptId)) {
              const match = apptLookupMap.get(metaApptId)!;
              enrichedClinic = { name: match.name, logo_url: match.logo, clinic_id: match.clinic_id || metaClinicId };
            } else if (metaClinicId && clinicIdMap.has(metaClinicId)) {
              const match = clinicIdMap.get(metaClinicId)!;
              enrichedClinic = { name: match.name, logo_url: match.logo_url, clinic_id: metaClinicId };
            }

            const finalSenderName = enrichedClinic?.name || meta.sender_name || "Clinic";
            const finalSenderAvatar = enrichedClinic?.logo_url || meta.avatar_url || null;

            items.push({
              id: notifId,
              type: n.type || "appointment_request",
              category: "clinic",
              title: n.title,
              message: n.body || n.message || "",
              link: "/admin/clinic-management",
              senderName: finalSenderName,
              senderType: "clinic",
              senderAvatar: finalSenderAvatar || undefined,
              timestamp: n.created_at,
              isRead: Boolean(n.is_read || readSet.has(notifId)),
              metadata: {
                ...meta,
                clinic_id: enrichedClinic?.clinic_id || metaClinicId,
                clinic_name: finalSenderName,
                clinic_logo: finalSenderAvatar,
              },
            });
          }
        });
      }
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
  userId?: string,
  metadata?: Record<string, any>
): Promise<void> {
  const extraAliases: string[] = [];
  if (metadata?.appointment_id) {
    const aid = String(metadata.appointment_id);
    extraAliases.push(aid, `appt:${aid}`, `appt-accepted-${aid}`, `appt-completed-${aid}`, `appt-rejected-${aid}`, `appt-cancelled-${aid}`);
  }
  if (id.startsWith("appt-")) {
    const raw = id.replace(/^appt-[a-z]+-/, "");
    if (raw) {
      extraAliases.push(raw, `appt:${raw}`, `appt-accepted-${raw}`, `appt-completed-${raw}`, `appt-rejected-${raw}`, `appt-cancelled-${raw}`);
    }
  }
  if (metadata?.ticket_id) {
    extraAliases.push(String(metadata.ticket_id), `ticket:${metadata.ticket_id}`, `ticket-update-${metadata.ticket_id}`);
  }
  if (id.startsWith("ticket-update-")) {
    const raw = id.replace("ticket-update-", "");
    extraAliases.push(raw, `ticket:${raw}`);
  }
  if (metadata?.broadcast_id) {
    extraAliases.push(String(metadata.broadcast_id), `broadcast:${metadata.broadcast_id}`);
  }
  if (id.startsWith("broadcast-")) {
    const raw = id.replace("broadcast-", "");
    extraAliases.push(raw, `broadcast:${raw}`);
  }
  if (metadata?.analysis_id) {
    extraAliases.push(String(metadata.analysis_id), `scan:${metadata.analysis_id}`, `scan-${metadata.analysis_id}`);
  }
  if (id.startsWith("scan-")) {
    const raw = id.replace("scan-", "");
    extraAliases.push(raw, `scan:${raw}`);
  }

  saveReadId(role, id, userId, undefined, extraAliases);

  // If it's a UUID, also attempt to update user_notification table directly
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (isUuid) {
    try {
      let query = supabase.from("user_notification").update({ is_read: true }).eq("notif_id", id);
      if (userId) {
        query = query.eq("user_id", userId);
      }
      await query;
    } catch { }
    try {
      await supabase.from("admin_alert").update({ is_read: true }).eq("notif_id", id);
    } catch { }
  } else if (id.startsWith("appt-") && userId) {
    const rawApptId = id.replace(/^appt-[a-z]+-/, "");
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawApptId)) {
      try {
        await supabase
          .from("user_notification")
          .update({ is_read: true })
          .eq("user_id", userId)
          .contains("metadata", { appointment_id: rawApptId });
      } catch { }
    }
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
    } catch { }
    if (!currentUserId) {
      try {
        const { data } = await supabase.auth.getUser();
        currentUserId = data?.user?.id;
      } catch { }
    }
  }

  const allIdsToSave = new Set<string>(ids);
  ids.forEach((id) => {
    if (id.startsWith("appt-")) {
      const raw = id.replace(/^appt-[a-z]+-/, "");
      if (raw) {
        allIdsToSave.add(raw);
        allIdsToSave.add(`appt:${raw}`);
        allIdsToSave.add(`appt-accepted-${raw}`);
        allIdsToSave.add(`appt-completed-${raw}`);
        allIdsToSave.add(`appt-rejected-${raw}`);
        allIdsToSave.add(`appt-cancelled-${raw}`);
      }
    } else if (id.startsWith("ticket-update-")) {
      const raw = id.replace("ticket-update-", "");
      allIdsToSave.add(raw);
      allIdsToSave.add(`ticket:${raw}`);
    } else if (id.startsWith("broadcast-")) {
      const raw = id.replace("broadcast-", "");
      allIdsToSave.add(raw);
      allIdsToSave.add(`broadcast:${raw}`);
    } else if (id.startsWith("scan-")) {
      const raw = id.replace("scan-", "");
      allIdsToSave.add(raw);
      allIdsToSave.add(`scan:${raw}`);
    }
  });

  saveAllReadIds(role, Array.from(allIdsToSave), currentUserId);

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
      let query = supabase.from("user_notification").update({ is_read: true }).in("notif_id", uuidIds);
      if (currentUserId) {
        query = query.eq("user_id", currentUserId);
      }
      await query;
    } catch { }
    try {
      await supabase.from("admin_alert").update({ is_read: true }).in("notif_id", uuidIds);
    } catch { }
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
const ROLE_STORE_CACHE_PREFIX = "dermai_role_notifs_cache_v2_";

function normalizeCachedNotificationItem(item: NotificationItem): NotificationItem {
  if (!item || typeof item !== "object") return item;
  const isDocAction =
    item.senderType === "doctor" ||
    item.type?.includes("doctor-") ||
    item.type?.includes("doctor_") ||
    item.subtype?.includes("doctor") ||
    item.type === "consultation-completed";
  let senderName = item.senderName;
  if (isDocAction) {
    const rawDoc =
      item.senderName ||
      item.metadata?.doctor_name ||
      (item.message || "").match(/^(?:Dr\.?|Doctor)\s+(.+?)\s+(?:accepted|declined|rejected|completed|approved)/i)?.[1] ||
      "";
    const cleaned = String(rawDoc).replace(/^(?:dr\.?|doctor)\s+/i, "").trim();
    if (cleaned && !/^(?:doctor|assigned doctor|attending doctor|unknown)$/i.test(cleaned)) {
      senderName = `Dr. ${cleaned}`;
    }
  }
  const rawAvatar = item.senderAvatar || item.metadata?.doctor_avatar || item.metadata?.patient_avatar || item.metadata?.sender_avatar;
  const resolvedAvatar = rawAvatar ? (resolveAvatarUrl(rawAvatar) || rawAvatar) : item.senderAvatar;
  const resolvedApptId =
    item.appointment_id ||
    item.metadata?.appointment_id ||
    item.metadata?.appointmentId ||
    (item.id?.startsWith("clinic-doc-accept-")
      ? item.id.replace("clinic-doc-accept-", "")
      : item.id?.startsWith("clinic-doc-reject-")
      ? item.id.replace("clinic-doc-reject-", "")
      : item.id?.startsWith("clinic-req-")
      ? item.id.replace("clinic-req-", "")
      : item.id?.startsWith("clinic-cancel-")
      ? item.id.replace("clinic-cancel-", "")
      : item.id?.startsWith("clinic-reselect-")
      ? item.id.replace("clinic-reselect-", "")
      : item.id?.startsWith("clinic-complete-")
      ? item.id.replace("clinic-complete-", "")
      : undefined);
  return {
    ...item,
    senderName,
    senderAvatar: resolvedAvatar,
    ...(resolvedApptId ? { appointment_id: String(resolvedApptId) } : {}),
  };
}

function readHydratedRoleStoreCache(key: string, fallbackKey?: string): NotificationItem[] | null {
  if (typeof window === "undefined") return null;
  const keysToTry = [
    `${ROLE_STORE_CACHE_PREFIX}${key}`,
    ...(fallbackKey ? [`${ROLE_STORE_CACHE_PREFIX}${fallbackKey}`] : []),
    ...(key.startsWith("clinic:") ? [`${ROLE_STORE_CACHE_PREFIX}clinic:latest`] : []),
  ];
  for (const storageKey of keysToTry) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(normalizeCachedNotificationItem);
        }
      }
    } catch { }
  }
  return null;
}

function writeHydratedRoleStoreCache(key: string, items: NotificationItem[], userId?: string) {
  if (typeof window === "undefined") return;
  try {
    const serialized = JSON.stringify(items);
    localStorage.setItem(`${ROLE_STORE_CACHE_PREFIX}${key}`, serialized);
    if (key.startsWith("clinic:")) {
      localStorage.setItem(`${ROLE_STORE_CACHE_PREFIX}clinic:latest`, serialized);
      if (userId) {
        localStorage.setItem(`${ROLE_STORE_CACHE_PREFIX}clinic:${userId}`, serialized);
      }
    }
  } catch { }
}

function getRoleStoreKey(role: NotificationRole, config: { userId?: string; clinicId?: string }): string {
  if (role === "admin") {
    return `admin:${config.userId || "global"}`;
  }
  if (role === "clinic") {
    return `clinic:${config.clinicId || config.userId || "global"}`;
  }
  return `${role}:${config.userId || "global"}`;
}

function getOrCreateRoleStore(key: string, fallbackKey?: string): RoleStore {
  let store = roleStores.get(key);
  if (!store) {
    const fallbackStore = fallbackKey ? roleStores.get(fallbackKey) : undefined;
    const cachedItems =
      (fallbackStore && fallbackStore.state.notifications.length > 0
        ? fallbackStore.state.notifications
        : null) || readHydratedRoleStoreCache(key, fallbackKey);

    store = {
      state: {
        notifications: cachedItems || [],
        loading: cachedItems ? false : true,
        unreadCount: cachedItems ? cachedItems.filter((n) => !n.isRead).length : 0,
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
      const updated = store.state.notifications.map((n) => ({ ...n, isRead: true }));
      store.state = {
        ...store.state,
        unreadCount: 0,
        notifications: updated,
      };
      writeHydratedRoleStoreCache(key, updated, userId);
      store.listeners.forEach((listener) => {
        try {
          listener();
        } catch { }
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
        writeHydratedRoleStoreCache(key, updated, userId);
        store.listeners.forEach((listener) => {
          try {
            listener();
          } catch { }
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
  config: { userId?: string; clinicId?: string; userEmail?: string; limit?: number }
) {
  const { userId, clinicId, userEmail, limit } = config;
  const storeKey = getRoleStoreKey(role, { userId, clinicId });
  const fallbackKey = role === "clinic" && userId ? `clinic:${userId}` : undefined;
  const store = getOrCreateRoleStore(storeKey, fallbackKey);

  const [, setTick] = useState(0);

  const fetchFn = useCallback(async () => {
    try {
      let data: NotificationItem[] = [];
      if (role === "patient" && userId) {
        data = await fetchPatientNotifications(userId);
      } else if (role === "doctor" && userId) {
        data = await fetchDoctorNotifications(userId, userEmail, limit);
      } else if (role === "clinic") {
        data = await fetchClinicNotifications(clinicId || "", userId, userEmail);
      } else if (role === "admin") {
        data = await fetchAdminNotifications(userId);
      }
      const prevById = new Map<string, NotificationItem>();
      store.state.notifications.forEach((prevItem) => {
        if (prevItem?.id) prevById.set(prevItem.id, prevItem);
      });
      const deduplicated = deduplicateNotificationItems(data).map((item) => {
        const normalized = normalizeCachedNotificationItem(item);
        const prev = prevById.get(normalized.id);
        return {
          ...normalized,
          senderAvatar: normalized.senderAvatar || prev?.senderAvatar,
          senderName:
            normalized.senderName && !/^(?:Doctor|Dr\.\s*Attending Doctor|Patient|Clinic Update)$/i.test(normalized.senderName)
              ? normalized.senderName
              : prev?.senderName || normalized.senderName,
        };
      });
      const unread = deduplicated.filter((n) => !n.isRead).length;
      store.state = {
        notifications: deduplicated,
        unreadCount: unread,
        loading: false,
      };
      writeHydratedRoleStoreCache(storeKey, deduplicated, userId);
      store.listeners.forEach((l) => {
        try {
          l();
        } catch { }
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
        } catch { }
      });
    }
  }, [role, userId, clinicId, userEmail, limit, storeKey, store]);

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
          channel.on(
            "postgres_changes",
            { event: "*", schema: "public", table: "notifications", filter: `clinic_id=eq.${clinicId}` },
            () => fetchFn()
          );
        } else {
          channel.on(
            "postgres_changes",
            { event: "*", schema: "public", table: "patient_appointment" },
            () => fetchFn()
          );
          channel.on(
            "postgres_changes",
            { event: "*", schema: "public", table: "notifications" },
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
        } catch { }
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
  const { userId, type, subtype, title, body, metadata } = payload;
  if (!userId) return false;

  try {
    const { error } = await supabase.from("user_notification").insert({
      user_id: userId,
      type,
      subtype: subtype || null,
      title,
      body,
      is_read: false,
      metadata: metadata || null,
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

export interface DoctorAppointmentNotificationInput {
  doctorId?: string;
  clinicId: string;
  clinicName?: string;
  patientId: string;
  patientName: string;
  appointmentId: string;
  scheduledDate?: string;
  scheduledTime?: string;
  consultationType?: string;
}

/**
 * Generate a clinic-scoped appointment request notification for the target doctor
 */
export async function createDoctorAppointmentNotification(input: DoctorAppointmentNotificationInput): Promise<boolean> {
  const {
    doctorId,
    clinicId,
    clinicName,
    patientId,
    patientName,
    appointmentId,
    scheduledDate,
    scheduledTime,
    consultationType,
  } = input;

  if (!clinicId || !patientId || !appointmentId) return false;

  try {
    const targetUserIds = new Set<string>();

    // 1. Resolve specific doctor's user_id if doctorId provided
    if (doctorId) {
      const { data: docRecords } = await supabase
        .from("clinic_doctor")
        .select("user_id, doctor_id")
        .or(`doctor_id.eq.${doctorId},user_id.eq.${doctorId}`);

      (docRecords || []).forEach((d: any) => {
        if (d.user_id) targetUserIds.add(d.user_id);
      });

      // Fallback: if doctorId looks like a UUID (auth.users id), add it directly
      if (targetUserIds.size === 0 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(doctorId)) {
        targetUserIds.add(doctorId);
      }
    }

    // 2. If no specific doctor found, notify active doctors associated with this clinic
    if (targetUserIds.size === 0) {
      const { data: clinicDocs } = await supabase
        .from("clinic_doctor")
        .select("user_id")
        .eq("clinic_id", clinicId)
        .ilike("status", "active");

      (clinicDocs || []).forEach((d: any) => {
        if (d.user_id) targetUserIds.add(d.user_id);
      });
    }

    if (targetUserIds.size === 0) return false;

    const navLink = `/doctor/clinics/${clinicId}/patients/${patientId}?appointmentId=${appointmentId}`;
    const scheduleStr = scheduledDate ? ` on ${scheduledDate}${scheduledTime ? ` at ${scheduledTime}` : ""}` : "";
    const typeLabel = consultationType || "consultation";

    const targetArray = Array.from(targetUserIds);

    // Idempotency check: avoid inserting duplicate review notifications for the same appointment and doctor
    let alreadyNotified = new Set<string>();
    try {
      const { data: existingNotifs } = await supabase
        .from("user_notification")
        .select("user_id, metadata, title, type")
        .in("user_id", targetArray)
        .or("type.eq.appointment_request,type.eq.appointment-request,title.ilike.%Review%");

      (existingNotifs || []).forEach((en: any) => {
        const metaApptId = en.metadata?.appointment_id || en.metadata?.appointmentId;
        if (metaApptId === appointmentId) {
          alreadyNotified.add(en.user_id);
        }
      });
    } catch {}

    const rows = targetArray
      .filter((uid) => !alreadyNotified.has(uid))
      .map((uid) => ({
        user_id: uid,
        type: "appointment_request",
        subtype: "appointment_request",
        title: "To Review New Appointment",
        body: "A new paid patient appointment has been assigned to you for review.",
        is_read: false,
        metadata: {
          clinic_id: clinicId,
          clinicId: clinicId,
          clinic_name: clinicName || "Clinic",
          branch_name: clinicName || "Clinic",
          patient_id: patientId,
          patientId: patientId,
          patient_name: patientName,
          consultation_type: typeLabel,
          schedule_info: scheduleStr,
          appointment_id: appointmentId,
          appointmentId: appointmentId,
          category: "appointment",
          type: "appointment_request",
          link: navLink,
        },
      }));

    if (rows.length > 0) {
      const { error } = await supabase.from("user_notification").insert(rows);
      if (error) {
        console.warn("[notificationService] Error generating doctor appointment notification:", error.message);
        return false;
      }
    }

    window.dispatchEvent(new CustomEvent("dermai_notifications_updated"));
    return true;
  } catch (err: any) {
    console.warn("[notificationService] Notification dispatch error:", err?.message || err);
    return false;
  }
}

export interface DoctorConfirmedNotificationInput {
  doctorUserId: string;
  clinicId?: string;
  clinicName?: string;
  appointmentId: string;
  patientId?: string;
  patientName?: string;
}

/**
 * Generate a Confirmed Appointment notification for the doctor who accepted the appointment.
 * Triggered ONLY when the doctor successfully accepts/approves the patient appointment.
 */
export async function createDoctorAppointmentConfirmedNotification(
  input: DoctorConfirmedNotificationInput
): Promise<boolean> {
  const { doctorUserId, clinicId, clinicName, appointmentId, patientId, patientName } = input;
  if (!doctorUserId || !appointmentId) return false;

  try {
    // Idempotency check: don't create duplicate confirmation notifications for the same appointment
    try {
      const { data: existingNotifs } = await supabase
        .from("user_notification")
        .select("notif_id, metadata, title, type")
        .eq("user_id", doctorUserId)
        .or("type.eq.appointment-confirmed,title.eq.Confirmed Appointment");

      const alreadyExists = (existingNotifs || []).some((en: any) => {
        const metaApptId = en.metadata?.appointment_id || en.metadata?.appointmentId;
        return metaApptId === appointmentId;
      });

      if (alreadyExists) return true;
    } catch {}

    const { error } = await supabase.from("user_notification").insert({
      user_id: doctorUserId,
      type: "appointment-confirmed",
      subtype: "confirmed",
      title: "Confirmed Appointment",
      body: "You have accepted this patient's appointment. The consultation is now confirmed and scheduled.",
      is_read: false,
      metadata: {
        clinic_id: clinicId,
        clinicId: clinicId,
        clinic_name: clinicName || "Clinic",
        branch_name: clinicName || "Clinic",
        patient_id: patientId,
        patientId: patientId,
        patient_name: patientName,
        appointment_id: appointmentId,
        appointmentId: appointmentId,
        category: "appointment",
        type: "appointment-confirmed",
        link: "/doctor/scheduled",
      },
    });

    if (error) {
      console.warn("[notificationService] Error generating doctor confirmed notification:", error.message);
      return false;
    }

    window.dispatchEvent(new CustomEvent("dermai_notifications_updated"));
    return true;
  } catch (err: any) {
    console.warn("[notificationService] Doctor confirmed notification error:", err?.message || err);
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
/**
 * Dispatch real-time admin notification when a new clinic registers / applies
 * for platform verification and approval.
 */
export async function notifyAdminNewClinicApplication(
  clinicId: string | number,
  fallbackClinicData?: { name?: string; email?: string; logo_url?: string }
): Promise<void> {
  const cId = String(clinicId);
  let clinicName = fallbackClinicData?.name;
  let logoUrl = fallbackClinicData?.logo_url;

  if (!clinicName && cId && !cId.startsWith("temp_")) {
    try {
      const { data: clinic } = await supabase
        .from("clinic")
        .select("clinic_id, name, logo_url")
        .eq("clinic_id", cId)
        .maybeSingle();
      if (clinic) {
        clinicName = clinic.name;
        logoUrl = clinic.logo_url || logoUrl;
      }
    } catch (err) {
      console.warn("[notifyAdminNewClinicApplication] Clinic query warning:", err);
    }
  }

  const rawName = (clinicName || "New Clinic").trim();
  const clinicDisplay = rawName.toLowerCase().startsWith("clinic ") ? rawName : `Clinic ${rawName}`;
  const title = "New Clinic Application Submitted";
  const bodyText = `${clinicDisplay} has submitted a new application for platform approval.`;
  const link = "/admin/clinic-management";

  // 1. Resolve all admin accounts in Supabase
  try {
    const { data: adminUsers } = await supabase
      .from("user")
      .select("user_id, email, role")
      .or("role.eq.admin,email.eq.dermaisupport@gmail.com");

    const targetUserIds = new Set<string>();
    if (adminUsers && adminUsers.length > 0) {
      adminUsers.forEach((a: any) => {
        if (a.user_id) targetUserIds.add(String(a.user_id));
      });
    }
    // Always include the primary admin account
    targetUserIds.add("03c4dbd4-5d15-4c78-872e-93811b3afa23");

    const rows = Array.from(targetUserIds).map((uid) => ({
      user_id: uid,
      type: "clinic",
      subtype: "new_clinic_application",
      title,
      body: bodyText,
      message: bodyText,
      is_read: false,
      metadata: {
        clinic_id: cId,
        clinic_name: rawName,
        category: "clinic",
        link,
        logo_url: logoUrl || null,
        priority: "high",
      },
    }));

    await supabase.from("user_notification").insert(rows);
  } catch (err) {
    console.warn("[notifyAdminNewClinicApplication] Database notice insert warning:", err);
  }

  // 2. Broadcast local realtime events so all open admin tabs refresh immediately
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("dermai_notifications_updated", {
        detail: { role: "admin", clinicId: cId, action: "new_clinic_application" },
      })
    );
    window.dispatchEvent(new CustomEvent("dermai_notifications_updated"));
    window.dispatchEvent(new Event("storage"));
  }
}

/**
 * Dispatch real-time admin notification when a doctor completes a patient consultation
 * and submits the final diagnosis.
 */
export async function notifyAdminDoctorCompletedReview(payload: {
  appointmentId: string;
  doctorName?: string | null;
  patientName?: string | null;
  finalDiagnosis: string;
  aiPrediction?: string | null;
  confidence?: number | string | null;
  doctorId?: string | null;
}): Promise<void> {
  if (!payload.finalDiagnosis || !payload.finalDiagnosis.trim()) return;

  const rawDocName = (payload.doctorName || "Doctor").trim();
  const cleanDoc = rawDocName.replace(/^(dr\.?|doctor)\s+/i, "").trim();
  const formattedDoctor = cleanDoc.toLowerCase() === "doctor" ? "Doctor" : `Dr. ${cleanDoc}`;
  const patient = (payload.patientName || "Patient").trim();

  const title = "Doctor Completed Review";
  const bodyText = `${formattedDoctor} completed the review for ${patient}. Final Diagnosis: ${payload.finalDiagnosis.trim()}`;

  // 1. Resolve all admin accounts in Supabase
  try {
    const { data: adminUsers } = await supabase
      .from("user")
      .select("user_id, email, role")
      .or("role.eq.admin,email.eq.dermaisupport@gmail.com");

    const targetUserIds = new Set<string>();
    if (adminUsers && adminUsers.length > 0) {
      adminUsers.forEach((a: any) => {
        if (a.user_id) targetUserIds.add(String(a.user_id));
      });
    }
    // Always include the verified primary admin account
    targetUserIds.add("03c4dbd4-5d15-4c78-872e-93811b3afa23");

    const rows = Array.from(targetUserIds).map((uid) => ({
      user_id: uid,
      type: "scan",
      subtype: "doctor_completed_review",
      title,
      body: bodyText,
      message: bodyText,
      is_read: false,
      metadata: {
        appointment_id: payload.appointmentId,
        category: "scan",
        link: "/admin/doctor-ai-review",
        doctor_name: formattedDoctor,
        patient_name: patient,
        final_diagnosis: payload.finalDiagnosis.trim(),
        ai_prediction: payload.aiPrediction || null,
        confidence: payload.confidence || null,
      },
    }));
    await supabase.from("user_notification").insert(rows);
  } catch (err) {
    console.warn("[notifyAdminDoctorCompletedReview] Database notice insert warning:", err);
  }

  // 2. Broadcast local realtime events so all open admin tabs refresh immediately
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("dermai_notifications_updated"));
    window.dispatchEvent(new Event("storage"));
  }
}

/**
 * Triggers and persists a notification for a patient when they submit a support ticket.
 * Tagged with category: 'support' (or type: 'support') to show under the Support tab.
 */
export async function notifyPatientPendingSupportTicket(params: {
  userId: string;
  ticketId: string;
  ticketCode?: string;
  subject: string;
}): Promise<boolean> {
  const { userId, ticketId, ticketCode, subject } = params;
  if (!userId) return false;

  const displayCode = ticketCode || (ticketId.length > 12 ? ticketId.slice(0, 8).toUpperCase() : ticketId);
  const cleanSubject = (subject || "General Support").trim();
  const title = "Support Ticket Received";
  const body = `Your support ticket #${displayCode} ('${cleanSubject}') has been received and is currently pending review.`;

  try {
    const { error } = await supabase.from("user_notification").insert({
      user_id: userId,
      type: "support",
      subtype: "support_ticket",
      title,
      body,
      is_read: false,
      metadata: {
        category: "support",
        ticket_id: ticketId,
        ticket_code: displayCode,
        subject: cleanSubject,
        link: "/patient/support",
        sender_name: "DERMAI Support",
      },
    });

    if (error) {
      console.warn("[notificationService] Failed to insert patient support ticket notification:", error.message);
      return false;
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("dermai_notifications_updated"));
      window.dispatchEvent(new Event("storage"));
    }

    return true;
  } catch (err: any) {
    console.warn("[notificationService] notifyPatientPendingSupportTicket error:", err?.message || err);
    return false;
  }
}
