import { useState, useMemo, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  ArrowRight,
  CheckCheck,
  Loader2,
  AlertTriangle,
  Megaphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { resolveAvatarUrl } from "@/lib/avatarUrlResolver";
import { useAuth } from "@/context/AuthContext";
import { useClinicVerification } from "@/hooks/useClinicVerification";
import { useRoleNotifications, type NotificationItem, type NotificationCategory } from "@/lib/notificationService";

interface ClinicNotificationsProps {
  onClose?: () => void;
  isDropdown?: boolean;
}


function cleanResolvedPatientName(raw?: string | null): string {
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
}

function formatResolvedDoctorName(raw?: string | null, messageFallback?: string | null): string {
  const candidate =
    raw ||
    (messageFallback || "").match(/^(?:Dr\.?|Doctor)\s+(.+?)\s+(?:accepted|declined|rejected|completed|approved|confirmed)/i)?.[1] ||
    "";
  if (!candidate || typeof candidate !== "string") return "";
  const cleaned = candidate.replace(/^(?:dr\.?|doctor)\s+/i, "").trim();
  if (!cleaned || /^(?:doctor|assigned doctor|attending doctor|unknown|dr)$/i.test(cleaned)) {
    return "";
  }
  return `Dr. ${cleaned}`;
}

function getNotificationInitials(name?: string, fallback = "PT"): string {
  if (!name) return fallback;
  const cleaned = name
    .replace(/^(?:patient\s+)+/i, "")
    .replace(/^patient$/i, "")
    .replace(/^a\s+patient$/i, "")
    .replace(/^(?:dr\.?|doctor)\s+/i, "")
    .trim();
  if (!cleaned || /^(?:doctor|assigned doctor|attending doctor|unknown)$/i.test(cleaned)) return fallback;
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

function ClinicNotificationAvatar({
  avatarUrl,
  altName,
  initials,
  isMaintenance,
  isApproval,
  isBroadcast,
  isLoading,
}: {
  avatarUrl?: string;
  altName: string;
  initials: string;
  isMaintenance: boolean;
  isApproval: boolean;
  isBroadcast: boolean;
  isLoading: boolean;
}) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgLoaded(false);
    setImgError(false);
  }, [avatarUrl]);

  const hasValidUrl = Boolean(avatarUrl && avatarUrl.trim().length > 0 && !imgError);

  if (hasValidUrl) {
    return (
      <div className="relative shrink-0 w-10 h-10">
        {!imgLoaded && (
          <div className="absolute inset-0 w-10 h-10 rounded-full bg-gray-100 animate-pulse border border-gray-200" />
        )}
        <img
          src={avatarUrl}
          alt={altName}
          referrerPolicy="no-referrer"
          className={cn(
            "w-10 h-10 rounded-full object-cover border border-gray-200 bg-white transition-opacity duration-150",
            imgLoaded ? "opacity-100" : "opacity-0"
          )}
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgError(true)}
        />
      </div>
    );
  }

  if (isLoading && !isMaintenance && !isApproval && !isBroadcast) {
    return (
      <div className="relative shrink-0 w-10 h-10">
        <div className="w-10 h-10 rounded-full bg-gray-100 animate-pulse border border-gray-200" />
      </div>
    );
  }

  return (
    <div className="relative shrink-0 w-10 h-10">
      <div
        className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center font-semibold text-xs border",
          isMaintenance
            ? "bg-amber-100 text-amber-800 border-amber-300"
            : isApproval
            ? "bg-emerald-600 text-white border-emerald-600"
            : isBroadcast
            ? "bg-magenta-50 text-magenta-700 border-magenta-200"
            : "bg-magenta-50 text-magenta-700 border-magenta-100"
        )}
      >
        {isMaintenance ? (
          <AlertTriangle className="w-5 h-5 text-amber-600" />
        ) : isBroadcast ? (
          <Megaphone className="w-5 h-5 text-magenta-600" />
        ) : (
          initials
        )}
      </div>
    </div>
  );
}

export default function ClinicNotifications({ onClose, isDropdown = false }: ClinicNotificationsProps) {

  const { user } = useAuth();
  const { clinicId } = useClinicVerification();
  const { notifications, loading, unreadCount, markRead, markAllRead } = useRoleNotifications("clinic", {
    clinicId: clinicId || undefined,
    userId: user?.id,
    userEmail: user?.email,
  });

  const [activeTab, setActiveTab] = useState<"all" | "clinic" | "requests" | "doctor-action" | "ticket" | "broadcast">("all");
  const [bookingNotifs, setBookingNotifs] = useState<NotificationItem[]>([]);
  const [bookingLoading, setBookingLoading] = useState(false);

  // Fetch notification data for the Bookings & Reselections tab directly from Supabase
  const fetchBookingsAndReselections = useCallback(async () => {
    if (!clinicId) return;
    setBookingLoading(true);
    try {
      let rows: any[] = [];

      // 1. Primary: Query user_notification with relational join on profiles / patients table using patient_id
      // to fetch first_name, last_name, and avatar_url (or profile_picture)
      let joinSuccess = false;
      try {
        const { data: profileJoinData, error: profileJoinErr } = await supabase
          .from("user_notification")
          .select(`
            *,
            patient:patient_id (
              first_name,
              last_name,
              full_name,
              avatar_url,
              profile_picture
            )
          `)
          .in("type", ["booking_created", "doctor_reselection", "reselection_required", "bookings_and_reselections", "appointment"])
          .or(`subtype.eq.alternate_doctor_selected,type.in.(booking_created,doctor_reselection,reselection_required,bookings_and_reselections)`)
          .eq("clinic_id", clinicId)
          .order("created_at", { ascending: false });

        if (!profileJoinErr && Array.isArray(profileJoinData) && profileJoinData.length > 0) {
          rows = profileJoinData;
          joinSuccess = true;
        }
      } catch { }

      // 1b. Fallback to notifications view or user_notification direct select
      if (!joinSuccess) {
        const { data: directData, error: directErr } = await supabase
          .from("user_notification")
          .select("*")
          .in("type", ["booking_created", "doctor_reselection", "reselection_required", "bookings_and_reselections", "appointment"])
          .or(`subtype.eq.alternate_doctor_selected,type.in.(booking_created,doctor_reselection,reselection_required,bookings_and_reselections)`)
          .eq("clinic_id", clinicId)
          .order("created_at", { ascending: false });

        if (!directErr && Array.isArray(directData) && directData.length > 0) {
          rows = directData;
        } else {
          const { data: viewData } = await supabase
            .from("notifications")
            .select("*")
            .in("type", ["booking_created", "doctor_reselection", "reselection_required", "bookings_and_reselections"])
            .eq("clinic_id", clinicId)
            .order("created_at", { ascending: false });
          if (Array.isArray(viewData)) rows = viewData;
        }
      }

      // 1c. Also load clinic's appointments joined with user profiles so we can resolve
      //     patient full_name, avatar_url, and appointment_id via appointment_id or closest matching appointment
      const apptPatientById = new Map<
        string,
        { id: string; fullName: string; avatarUrl?: string; userId?: string; doctorName?: string; createdAt?: string; qAnswers?: any }
      >();
      let clinicAppts: any[] = [];
      try {
        const { data: apptsData } = await supabase
          .from("patient_appointment")
          .select(`
            appointment_id,
            user_id,
            patient_name,
            assigned_doctor_id,
            created_at,
            questionnaire_answers,
            user:user_id ( full_name, avatar_url ),
            doctor:assigned_doctor_id ( doctor_name )
          `)
          .eq("clinic_id", clinicId)
          .order("created_at", { ascending: false })
          .limit(40);
        if (Array.isArray(apptsData)) {
          clinicAppts = apptsData;
        }
      } catch { }

      // 1d. Batch relational join on user / profiles / patients table using patient_id / user_id
      const patientIds = Array.from(new Set([
        ...rows
          .filter((r: any) => !r.patient?.first_name && !r.patient?.full_name)
          .map((r: any) => r.patient_id || r.metadata?.patient_id || r.metadata?.patientId || r.metadata?.user_id || (r.subtype === "alternate_doctor_selected" ? null : r.user_id)),
        ...clinicAppts.map((a: any) => a.user_id),
      ].filter(Boolean)));

      const patientMap = new Map<string, { first_name?: string; last_name?: string; full_name?: string; avatar_url?: string; profile_picture?: string }>();
      if (patientIds.length > 0) {
        try {
          const { data: userData } = await supabase
            .from("user")
            .select("user_id, full_name, avatar_url")
            .in("user_id", patientIds);
          if (Array.isArray(userData)) {
            userData.forEach((u: any) => {
              if (u.user_id) patientMap.set(String(u.user_id), u);
            });
          }
        } catch { }

        try {
          const { data: profData } = await supabase
            .from("profiles")
            .select("user_id, patient_id, first_name, last_name, full_name, avatar_url, profile_picture")
            .in("user_id", patientIds);
          if (Array.isArray(profData)) {
            profData.forEach((p: any) => {
              const pid = String(p.patient_id || p.user_id || "");
              if (pid && !patientMap.has(pid)) patientMap.set(pid, p);
            });
          }
        } catch { }

        // Also query patients table if profiles view is missing
        try {
          const { data: patData } = await supabase
            .from("patients")
            .select("user_id, patient_id, first_name, last_name, full_name, avatar_url, profile_picture")
            .in("user_id", patientIds);
          if (Array.isArray(patData)) {
            patData.forEach((p: any) => {
              const pid = String(p.patient_id || p.user_id || "");
              if (pid && !patientMap.has(pid)) patientMap.set(pid, p);
            });
          }
        } catch { }
      }

      clinicAppts.forEach((a: any) => {
        const apptId = String(a.appointment_id || "");
        if (!apptId) return;
        const uObj = Array.isArray(a.user) ? a.user[0] : a.user;
        const dObj = Array.isArray(a.doctor) ? a.doctor[0] : a.doctor;
        const prof = a.user_id ? patientMap.get(String(a.user_id)) : undefined;
        const fullName =
          cleanResolvedPatientName(uObj?.full_name) ||
          cleanResolvedPatientName(prof?.full_name) ||
          cleanResolvedPatientName([prof?.first_name, prof?.last_name].filter(Boolean).join(" ")) ||
          cleanResolvedPatientName(a.patient_name);
        const avatarUrl =
          uObj?.avatar_url ||
          prof?.avatar_url ||
          prof?.profile_picture ||
          undefined;
        apptPatientById.set(apptId, {
          id: apptId,
          fullName,
          avatarUrl,
          userId: a.user_id,
          doctorName: dObj?.doctor_name || "",
          createdAt: a.created_at,
          qAnswers: typeof a.questionnaire_answers === "object" && a.questionnaire_answers ? a.questionnaire_answers : {},
        });
      });

      const mapped: NotificationItem[] = rows.map((r: any) => {
        const type = r.type || "booking_created";
        const subtype = r.subtype || r.metadata?.subtype || "";
        const isAlternateDoctor =
          subtype === "alternate_doctor_selected" ||
          subtype === "alternate-doctor-selected" ||
          type === "alternate_doctor_selected" ||
          type === "bookings_and_reselections" ||
          r.title === "Alternate Doctor Selected";

        // Path 1: Extract patient fields from relational join, patient_id/user_id in metadata, or appointment_id
        const joined = Array.isArray(r.patient) ? r.patient[0] : r.patient;
        const apptId = r.appointment_id || r.metadata?.appointment_id || r.metadata?.appointmentId;
        let resolvedApptId = apptId ? String(apptId) : undefined;
        const apptMatch = resolvedApptId ? apptPatientById.get(resolvedApptId) : undefined;
        const pId =
          r.patient_id ||
          r.metadata?.patient_id ||
          r.metadata?.patientId ||
          r.metadata?.user_id ||
          apptMatch?.userId ||
          (r.user_id && String(r.user_id) !== String(user?.id) ? r.user_id : undefined);
        const profile = joined || (pId ? patientMap.get(String(pId)) : null);

        const firstName = profile?.first_name || r.metadata?.patient_first_name || "";
        const lastName = profile?.last_name || r.metadata?.patient_last_name || "";
        let patientAvatar =
          profile?.avatar_url ||
          profile?.profile_picture ||
          apptMatch?.avatarUrl ||
          r.metadata?.patient_avatar ||
          r.metadata?.sender_avatar ||
          null;

        let dynamicPatientName = "";
        if (firstName && lastName) {
          dynamicPatientName = `${firstName} ${lastName}`;
        } else if (firstName) {
          dynamicPatientName = firstName;
        } else if (cleanResolvedPatientName(profile?.full_name)) {
          dynamicPatientName = cleanResolvedPatientName(profile?.full_name);
        } else if (apptMatch?.fullName) {
          dynamicPatientName = apptMatch.fullName;
        } else if (cleanResolvedPatientName(r.metadata?.patient_name)) {
          dynamicPatientName = cleanResolvedPatientName(r.metadata.patient_name);
        } else if (cleanResolvedPatientName(r.sender_name)) {
          dynamicPatientName = cleanResolvedPatientName(r.sender_name);
        }

        // Path 2: Fallback match against clinic appointments when legacy notification row lacks metadata or appointment_id
        if ((!dynamicPatientName || !patientAvatar || !resolvedApptId) && apptPatientById.size > 0) {
          const bodyText = r.message || r.body || "";
          const docInBody = bodyText
            .match(/selected\s+(?:Dr\.?\s+)?(.+?)\s+as their alternate doctor/i)?.[1]
            ?.replace(/^dr\.?\s+/i, "")
            .trim()
            .toLowerCase();
          const allEntries = Array.from(apptPatientById.values()).filter((e) => e.fullName || e.avatarUrl || e.id);
          const pidOrNameMatched = allEntries.filter((e) => {
            if (pId && e.userId && String(e.userId) === String(pId)) return true;
            if (dynamicPatientName && e.fullName && e.fullName.trim().toLowerCase() === dynamicPatientName.trim().toLowerCase()) return true;
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
            const notifTime = new Date(r.created_at || 0).getTime();
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
            if (!dynamicPatientName && best.fullName) dynamicPatientName = best.fullName;
            if (!patientAvatar && best.avatarUrl) patientAvatar = best.avatarUrl;
            if (!resolvedApptId && best.id) resolvedApptId = best.id;
          }
        }

        const patientFullTitle = dynamicPatientName ? `Patient ${dynamicPatientName}` : "Patient";
        const senderTag = dynamicPatientName || (type === "reselection_required" ? "Clinic System" : "Patient");

        // Clean any "Patient Patient" or generic "Patient has selected" fallback in message
        let cleanedMessage = r.message || r.body || "";
        if (cleanedMessage.includes("Patient Patient")) {
          cleanedMessage = cleanedMessage.replace(/Patient\s+Patient/gi, patientFullTitle);
        } else if (dynamicPatientName && /^Patient\s+has\s+selected\b/i.test(cleanedMessage)) {
          cleanedMessage = cleanedMessage.replace(/^Patient\s+has\s+selected\b/i, `${patientFullTitle} has selected`);
        }

        let defaultTitle = "Booking & Reselection Alert";
        let defaultMsg = "Appointment update for this clinic.";
        if (isAlternateDoctor) {
          defaultTitle = "Alternate Doctor Selected";
          defaultMsg = dynamicPatientName
            ? `${patientFullTitle} has selected an alternate doctor.`
            : "A patient has selected an alternate doctor for their appointment.";
        } else if (type === "booking_created") {
          defaultTitle = "New Booking Created";
          defaultMsg = dynamicPatientName
            ? `${patientFullTitle} scheduled a new consultation booking.`
            : "A new appointment booking has been created.";
        } else if (type === "doctor_reselection") {
          defaultTitle = "Doctor Reselection";
          defaultMsg = dynamicPatientName
            ? `${patientFullTitle} has reselected an alternate doctor.`
            : "Patient selected an alternate doctor for their appointment.";
        } else if (type === "reselection_required") {
          defaultTitle = "Doctor Reselection Required";
          defaultMsg = "Appointment requires selecting an alternate doctor.";
        }

        // Change category/type mapping from doctor_actions to bookings_and_reselections
        const resolvedCategory: NotificationCategory = isAlternateDoctor ? "bookings_and_reselections" : "appointment";
        const resolvedType = isAlternateDoctor ? "bookings_and_reselections" : type;
        const resolvedLink = resolvedApptId
          ? `/clinic/appointments?appointment=${resolvedApptId}`
          : (r.link || r.metadata?.link || "/clinic/appointments");

        return {
          id: String(r.id || r.notif_id),
          type: resolvedType,
          subtype,
          category: resolvedCategory,
          title: r.title || defaultTitle,
          message: cleanedMessage || defaultMsg,
          senderName: senderTag,
          senderType: "patient" as const,
          senderAvatar: patientAvatar,
          appointment_id: resolvedApptId,
          link: resolvedLink,
          timestamp: r.created_at || new Date().toISOString(),
          isRead: Boolean(r.is_read || r.read_at),
          metadata: {
            ...r.metadata,
            category: resolvedCategory,
            type: resolvedType,
            subtype,
            appointment_id: resolvedApptId,
            clinic_id: r.clinic_id,
            patient_id: pId,
            patient_name: senderTag,
            patient_first_name: firstName,
            patient_last_name: lastName,
            patient_avatar: patientAvatar,
          },
        };
      });

      setBookingNotifs(mapped);
    } catch (err) {
      console.warn("[ClinicNotifications] Failed to query booking & reselection notifications:", err);
    } finally {
      setBookingLoading(false);
    }
  }, [clinicId, user?.id]);

  // Real-time updates using Supabase Realtime (supabase.channel().on('postgres_changes', ...))
  useEffect(() => {
    fetchBookingsAndReselections();
    if (!clinicId) return;

    const channelId = `clinic-bookings-reselections-${clinicId}-${Math.random().toString(36).slice(2, 7)}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `clinic_id=eq.${clinicId}`,
        },
        () => {
          fetchBookingsAndReselections();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_notification",
          filter: `clinic_id=eq.${clinicId}`,
        },
        () => {
          fetchBookingsAndReselections();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "patient_appointment",
          filter: `clinic_id=eq.${clinicId}`,
        },
        () => {
          fetchBookingsAndReselections();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clinicId, fetchBookingsAndReselections]);

  const handleMarkItemRead = (itemId: string) => {
    markRead(itemId);
    setBookingNotifs((prev) =>
      prev.map((n) => (n.id === itemId ? { ...n, isRead: true } : n))
    );
    // Persist read status directly to Supabase
    supabase
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("id", itemId)
      .then(({ error }) => {
        if (error) {
          supabase
            .from("user_notification")
            .update({ is_read: true, read_at: new Date().toISOString() })
            .eq("notif_id", itemId)
            .then(() => {});
        }
      });
  };

  const filtered = useMemo(() => {
    let list = notifications;
    if (activeTab === "clinic") {
      list = notifications.filter((n) => n.category === "clinic" || n.type === "application_approved" || n.type === "clinic_application");
    } else if (activeTab === "requests" || (activeTab as string) === "bookings_and_reselections") {
      // Bookings & Reselections: includes direct DB rows, role notifications,
      // and alternate_doctor_selected (emitted as type "bookings_and_reselections" or "doctor_reselection")
      const directMatches = bookingNotifs;
      const roleMatches = notifications.filter(
        (n) =>
          n.category === "bookings_and_reselections" ||
          n.type === "bookings_and_reselections" ||
          n.type === "booking_created" ||
          n.type === "doctor_reselection" ||
          n.type === "reselection_required" ||
          n.type === "appointment-request" ||
          n.type === "patient-reselection" ||
          n.type === "appointment-cancelled" ||
          n.subtype === "alternate_doctor_selected"
      );
      list = [...directMatches, ...roleMatches];
    } else if (activeTab === "doctor-action" || (activeTab as string) === "doctor_actions") {
      // Doctor Actions: exclude alternate_doctor_selected (patient action, not doctor action)
      list = notifications.filter(
        (n) =>
          n.category !== "bookings_and_reselections" &&
          n.type !== "bookings_and_reselections" &&
          n.subtype !== "alternate_doctor_selected" &&
          n.type !== "alternate_doctor_selected" &&
          n.type !== "doctor_reselection" &&
          (n.type.includes("doctor-") || n.type.includes("doctor_") || n.type === "consultation-completed" || (n.category === "appointment" && n.senderType === "doctor")) &&
          n.type !== "appointment-cancelled"
      );
    } else if (activeTab === "ticket") {
      list = notifications.filter((n) => n.category === "ticket");
    } else if (activeTab === "broadcast") {
      list = notifications.filter(
        (n) =>
          n.category === "broadcast" ||
          n.type === "broadcast" ||
          n.metadata?.subtype === "admin_announcement" ||
          n.metadata?.subtype === "maintenance_alert" ||
          n.type === "maintenance_alert"
      );
    }

    const seenIds = new Set<string>();
    const seenContent = new Set<string>();
    return list.filter((n) => {
      if (!n || !n.id) return false;
      if (seenIds.has(n.id)) return false;
      seenIds.add(n.id);

      const normTitle = (n.title || "").trim().toLowerCase();
      const normMsg = (n.message || "").trim().toLowerCase();
      const contentKey = `${normTitle}:::${normMsg}`;
      if (normTitle && normMsg) {
        if (seenContent.has(contentKey)) return false;
        seenContent.add(contentKey);
      }
      return true;
    });
  }, [notifications, bookingNotifs, activeTab]);

  const timeAgo = (iso: string) => {
    const time = new Date(iso).getTime();
    if (isNaN(time) || time <= 0) return "";
    const diff = Date.now() - time;
    if (diff < 0) return "Just now";
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div
      className={cn(
        "flex flex-col bg-white overflow-hidden rounded-xl border border-gray-200",
        isDropdown ? "w-full max-h-[560px] shadow-lg" : "w-full shadow-sm"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-gray-200">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900">Clinic Activity</h3>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-magenta-600 text-white text-xs font-semibold leading-none">
                {unreadCount}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {unreadCount > 0 ? `${unreadCount} unread alert${unreadCount > 1 ? "s" : ""}` : "All clinic alerts resolved"}
          </p>
        </div>

        {unreadCount > 0 && (
          <button
            onClick={() => markAllRead()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer shrink-0"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            <span>Mark all as read</span>
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="border-b border-gray-200 px-3">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {[
            { key: "all", label: "All" },
            { key: "clinic", label: "Clinic Approvals" },
            { key: "requests", label: "Bookings & Reselections" },
            { key: "doctor-action", label: "Doctor Actions" },
            { key: "ticket", label: "Support" },
            { key: "broadcast", label: "Announcements" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={cn(
                "border-b-2 transition-colors whitespace-nowrap cursor-pointer",
                isDropdown ? "px-2.5 py-2 text-xs font-semibold" : "px-3 py-2.5 text-sm font-medium",
                activeTab === tab.key
                  ? "border-magenta-600 text-magenta-700"
                  : "border-transparent text-gray-500 hover:text-gray-900"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden divide-y divide-gray-100">
        {loading || (activeTab === "requests" && bookingLoading && filtered.length === 0) ? (
          <div className="py-16 text-center text-gray-500">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-magenta-600" />
            <p className="text-sm">Loading clinic notifications…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <Bell className="w-5 h-5 text-gray-400" />
            </div>
            <p className="text-sm font-semibold text-gray-900">No new alerts</p>
            <p className="text-sm text-gray-500 mt-1">
              {activeTab === "all"
                ? "Incoming bookings, doctor approvals, and completed consultations will appear here."
                : activeTab === "requests"
                ? "No new booking or doctor reselection alerts."
                : `No notifications under ${activeTab}.`}
            </p>
          </div>
        ) : (
          filtered.map((item) => {
            const isApproval = item.type === "application_approved" || item.type === "clinic_application";
            const isMaintenance =
              item.metadata?.subtype === "maintenance_alert" ||
              item.type === "maintenance_alert" ||
              item.metadata?.priority === "high";
            const isBroadcast =
              item.category === "broadcast" ||
              item.type === "broadcast" ||
              item.metadata?.subtype === "admin_announcement";
            const isAlternateDoctor =
              item.subtype === "alternate_doctor_selected" ||
              item.subtype === "alternate-doctor-selected" ||
              item.type === "alternate_doctor_selected" ||
              item.title === "Alternate Doctor Selected";

            const isDoctorActionItem =
              !isAlternateDoctor &&
              (item.senderType === "doctor" ||
                item.type.includes("doctor-") ||
                item.type.includes("doctor_") ||
                item.subtype?.includes("doctor") ||
                item.type === "consultation-completed");

            const cleanPatientName =
              cleanResolvedPatientName(item.senderName) ||
              cleanResolvedPatientName(item.metadata?.patient_name);
            const displayPatientName = cleanPatientName || "Patient";
            const displayPatientInBody = cleanPatientName ? `Patient ${cleanPatientName}` : "Patient";

            const displayDoctorName = isDoctorActionItem
              ? formatResolvedDoctorName(item.senderName || item.metadata?.doctor_name, item.message) || "Dr. Attending Doctor"
              : "";

            // Clean message: replace fallback "Patient Patient" or generic "Patient has selected" with actual dynamic patient name
            let displayMessage = item.message || "";
            if (displayMessage.includes("Patient Patient")) {
              displayMessage = displayMessage.replace(/Patient\s+Patient/gi, displayPatientInBody);
            } else if (cleanPatientName && /^Patient\s+has\s+selected\b/i.test(displayMessage)) {
              displayMessage = displayMessage.replace(/^Patient\s+has\s+selected\b/i, `${displayPatientInBody} has selected`);
            }

            const headerTag = isAlternateDoctor
              ? displayPatientName
              : isDoctorActionItem
              ? displayDoctorName
              : (item.senderName || (isBroadcast || isMaintenance ? "Platform Administrator" : item.category));

            const rawAvatarCandidate =
              item.senderAvatar ||
              (isDoctorActionItem ? item.metadata?.doctor_avatar : item.metadata?.patient_avatar) ||
              item.metadata?.sender_avatar;
            const resolvedSenderAvatar = resolveAvatarUrl(rawAvatarCandidate) || (typeof rawAvatarCandidate === "string" && rawAvatarCandidate.trim() ? rawAvatarCandidate.trim() : undefined);

            const fallbackInitials = isAlternateDoctor
              ? getNotificationInitials(displayPatientName, "PT")
              : isDoctorActionItem
              ? getNotificationInitials(displayDoctorName, "DR")
              : getNotificationInitials(item.senderName, "PT");

            const resolvedAppointmentId =
              item.appointment_id ||
              item.metadata?.appointment_id ||
              item.metadata?.appointmentId ||
              item.link?.match(/[?&](?:appointment|appointment_id|id)=([^&]+)/i)?.[1] ||
              (item.id.startsWith("clinic-doc-accept-")
                ? item.id.replace("clinic-doc-accept-", "")
                : item.id.startsWith("clinic-doc-reject-")
                ? item.id.replace("clinic-doc-reject-", "")
                : item.id.startsWith("clinic-req-")
                ? item.id.replace("clinic-req-", "")
                : item.id.startsWith("clinic-cancel-")
                ? item.id.replace("clinic-cancel-", "")
                : item.id.startsWith("clinic-reselect-")
                ? item.id.replace("clinic-reselect-", "")
                : item.id.startsWith("clinic-complete-")
                ? item.id.replace("clinic-complete-", "")
                : undefined);

            const isClinicAppointmentsLink =
              Boolean(item.link && item.link.includes("/clinic/appointments")) ||
              isAlternateDoctor ||
              isDoctorActionItem ||
              item.category === "appointment" ||
              item.category === "bookings_and_reselections";

            const targetLink = isClinicAppointmentsLink
              ? (resolvedAppointmentId
                  ? `/clinic/appointments?appointment=${encodeURIComponent(String(resolvedAppointmentId))}`
                  : "/clinic/appointments")
              : item.link;

            return (
              <div
                key={item.id}
                onClick={() => !item.isRead && handleMarkItemRead(item.id)}
                className={cn(
                  "relative flex items-start gap-3 px-5 py-4 transition-colors cursor-pointer",
                  !item.isRead
                    ? isMaintenance
                      ? "bg-amber-50/50 hover:bg-amber-50/80"
                      : isApproval
                      ? "bg-emerald-50/50 hover:bg-emerald-50"
                      : "bg-magenta-50/40 hover:bg-magenta-50/70"
                    : "hover:bg-gray-50"
                )}
              >
                {!item.isRead && (
                  <span
                    className={cn(
                      "absolute left-0 top-0 bottom-0 w-0.5",
                      isMaintenance
                        ? "bg-amber-500"
                        : isApproval
                        ? "bg-emerald-600"
                        : "bg-magenta-600"
                    )}
                  />
                )}

                {/* Avatar with real profile picture, loading skeleton, & graceful dynamic initials fallback */}
                <ClinicNotificationAvatar
                  avatarUrl={resolvedSenderAvatar}
                  altName={headerTag || "Sender"}
                  initials={fallbackInitials}
                  isMaintenance={Boolean(isMaintenance)}
                  isApproval={Boolean(isApproval)}
                  isBroadcast={Boolean(isBroadcast)}
                  isLoading={Boolean(loading || bookingLoading)}
                />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={cn(
                          "text-xs font-semibold truncate",
                          isMaintenance
                            ? "text-amber-800"
                            : isApproval
                            ? "text-emerald-700"
                            : "text-magenta-700"
                        )}
                      >
                        {headerTag}
                      </span>
                      {isMaintenance && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 shrink-0">
                          <AlertTriangle className="w-3 h-3 text-amber-600" />
                          High Priority
                        </span>
                      )}
                      {isBroadcast && !isMaintenance && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-magenta-100 text-magenta-800 border border-magenta-200 shrink-0">
                          Announcement
                        </span>
                      )}
                    </div>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-gray-500 whitespace-nowrap">{timeAgo(item.timestamp)}</span>
                      {!item.isRead && (
                        <span
                          className={cn(
                            "w-2 h-2 rounded-full",
                            isMaintenance ? "bg-amber-500" : isApproval ? "bg-emerald-600" : "bg-magenta-600"
                          )}
                        />
                      )}
                    </span>
                  </div>

                  <p className="text-sm font-semibold text-gray-900 mt-0.5">{item.title}</p>
                  <p className="text-sm text-gray-600 leading-relaxed mt-0.5 break-words">{displayMessage}</p>

                  {/* Dynamic Action Buttons / Links */}
                  {isApproval ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Link
                        to="/clinic"
                        onClick={onClose}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                      >
                        <span>Open Clinic Dashboard</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                      <Link
                        to="/clinic/settings"
                        onClick={onClose}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <span>Clinic Profile Setup</span>
                      </Link>
                    </div>
                  ) : targetLink ? (
                    <Link
                      to={targetLink}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!item.isRead) {
                          handleMarkItemRead(item.id);
                        }
                        onClose?.();
                      }}
                      className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-magenta-700 hover:text-magenta-800 transition-colors"
                    >
                      <span>{targetLink.includes("appointments") ? "Manage in Clinic Appointments" : "View Details"}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Link */}
      {isDropdown && (
        <div className="border-t border-gray-200 px-5 py-3 bg-gray-50 text-center">
          <Link
            to="/clinic/appointments"
            onClick={onClose}
            className="text-sm font-medium text-magenta-700 hover:text-magenta-800 transition-colors"
          >
            Open Clinic Appointments Table →
          </Link>
        </div>
      )}
    </div>
  );
}
