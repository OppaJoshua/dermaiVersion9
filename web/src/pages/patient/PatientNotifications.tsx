import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Building2,
  Calendar,
  Sparkles,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Megaphone,
  CheckCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveAvatarUrl } from "@/lib/avatarUrlResolver";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { useRoleNotifications, type NotificationItem } from "@/lib/notificationService";

interface PatientNotificationsProps {
  onClose?: () => void;
  isDropdown?: boolean;
}

export default function PatientNotifications({ onClose, isDropdown = false }: PatientNotificationsProps) {
  const { user } = useAuth();
  const { notifications, loading, unreadCount, markRead, markAllRead } = useRoleNotifications("patient", {
    userId: user?.id,
  });

  const [activeTab, setActiveTab] = useState<"all" | "appointment" | "ticket" | "broadcast" | "scan">("all");
  const [scanNotifications, setScanNotifications] = useState<NotificationItem[]>([]);
  const [loadingScans, setLoadingScans] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    async function fetchScanLogs() {
      setLoadingScans(true);
      try {
        const { data: scanRows } = await supabase
          .from("ai_scan_result")
          .select(`
            analysis_id,
            confidence_score,
            body_part,
            scanned_at,
            status,
            skin_condition:condition_id (
              name,
              local_name
            )
          `)
          .eq("user_id", user!.id)
          .eq("status", "completed")
          .order("scanned_at", { ascending: false })
          .limit(20);

        if (cancelled || !scanRows) return;

        const mappedScans: NotificationItem[] = scanRows.map((s: any) => {
          const condObj = Array.isArray(s.skin_condition) ? s.skin_condition[0] : s.skin_condition;
          const conditionName = condObj?.name || "Skin Condition";
          const rawConf = Number(s.confidence_score ?? 0);
          const confPercent = rawConf <= 1 && rawConf > 0 ? Math.round(rawConf * 100) : Math.round(rawConf);
          const bodyPartText = s.body_part ? ` on ${s.body_part}` : "";
          const notifId = `scan-${s.analysis_id}`;

          return {
            id: notifId,
            type: "scan_result",
            category: "scan",
            title: `AI Skin Assessment: ${conditionName}`,
            message: `Detected ${conditionName}${bodyPartText} with ${confPercent}% confidence score.`,
            senderName: "DERMAI AI Scanner",
            senderType: "system",
            link: s.analysis_id ? `/dashboard/history?id=${s.analysis_id}` : "/dashboard/history",
            timestamp: s.scanned_at || new Date().toISOString(),
            isRead: true,
            metadata: {
              analysis_id: s.analysis_id,
              condition_name: conditionName,
              confidence_score: confPercent,
              body_part: s.body_part,
              category: "skin_scan",
            },
          };
        });

        setScanNotifications(mappedScans);
      } catch (err) {
        console.warn("[PatientNotifications] Failed to fetch scan logs:", err);
      } finally {
        if (!cancelled) setLoadingScans(false);
      }
    }
    fetchScanLogs();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const filtered = useMemo(() => {
    let list = notifications;
    if (activeTab === "scan") {
      list = [...notifications, ...scanNotifications].filter(
        (n) =>
          n.type === "scan_result" ||
          n.type === "scan-completed" ||
          (n.category as string) === "skin_scan" ||
          n.category === "scan" ||
          n.metadata?.category === "skin_scan"
      );
    } else if (activeTab === "broadcast") {
      list = notifications.filter(
        (n) =>
          n.category === "broadcast" ||
          n.type === "broadcast" ||
          n.metadata?.subtype === "admin_announcement" ||
          n.metadata?.subtype === "maintenance_alert" ||
          n.type === "maintenance_alert"
      );
    } else if (activeTab === "ticket") {
      list = notifications.filter(
        (n) =>
          n.category === "ticket" ||
          n.type === "support" ||
          n.type === "support_ticket" ||
          n.type?.includes("ticket") ||
          n.type?.includes("support") ||
          n.metadata?.category === "support" ||
          n.metadata?.category === "ticket"
      );
    } else if (activeTab !== "all") {
      list = notifications.filter((n) => n.category === activeTab);
    }

    const seenIds = new Set<string>();
    const seenContent = new Set<string>();
    const seenRejectionAppts = new Set<string>();

    return list.filter((n) => {
      if (!n || !n.id) return false;
      if (
        n.type === "subscription_expired" ||
        n.type === "subscription-expired" ||
        n.metadata?.subtype === "subscription_expired" ||
        n.metadata?.subtype === "subscription-expired" ||
        /pro subscription has expired|subscription expired/i.test(n.title || "")
      ) {
        return false;
      }
      if (seenIds.has(n.id)) return false;
      seenIds.add(n.id);

      // Rejection / Conflict deduplication: suppress duplicates for the same appointment conflict
      const isRej =
        n.type === "appointment-rejected" ||
        n.metadata?.subtype === "doctor-declined" ||
        n.metadata?.subtype === "schedule-conflict" ||
        /review update|schedule conflict|appointment declined|declined/i.test(n.title || "");
      const rApptId =
        n.metadata?.appointment_id ||
        (n.id.startsWith("appt-rejected-") ? n.id.replace("appt-rejected-", "") : undefined);

      if (isRej && rApptId) {
        if (seenRejectionAppts.has(rApptId)) return false;
        seenRejectionAppts.add(rApptId);
      }

      const normTitle = (n.title || "").trim().toLowerCase();
      const normMsg = (n.message || "").trim().toLowerCase();
      const contentKey = `${normTitle}:::${normMsg}`;
      if (normTitle && normMsg) {
        if (seenContent.has(contentKey)) return false;
        seenContent.add(contentKey);
      }
      return true;
    });
  }, [notifications, scanNotifications, activeTab]);

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const getItemIcon = (n: NotificationItem) => {
    const isMaintenance =
      n.metadata?.subtype === "maintenance_alert" ||
      n.type === "maintenance_alert" ||
      n.metadata?.priority === "high";

    if (isMaintenance) return <AlertTriangle className="w-5 h-5 text-amber-600" />;
    const cls = "w-5 h-5 text-magenta-600";
    if (n.type === "appointment-accepted") return <CheckCircle2 className={cls} />;
    if (n.type === "appointment-rejected") return <XCircle className={cls} />;
    if (n.type === "appointment-completed") return <Sparkles className={cls} />;
    if (n.type === "appointment-payment-confirmed" || n.type === "payment-confirmed") return <CheckCircle2 className={cls} />;
    if (n.category === "ticket" || n.type === "support" || n.type === "support_ticket" || n.type?.includes("ticket") || n.type?.includes("support")) {
      return <HelpCircle className={cls} />;
    }
    if (
      n.category === "broadcast" ||
      n.type === "broadcast" ||
      n.metadata?.subtype === "admin_announcement"
    ) {
      return <Megaphone className={cls} />;
    }
    return <Calendar className={cls} />;
  };

  return (
    <div
      className={cn(
        "flex flex-col bg-white overflow-hidden rounded-xl border border-gray-200",
        isDropdown ? "relative z-[9999] w-full max-h-[560px] shadow-lg" : "w-full shadow-sm"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-gray-200">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900">Notifications</h3>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-magenta-600 text-white text-xs font-semibold leading-none">
                {unreadCount}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {unreadCount > 0 ? `${unreadCount} unread update${unreadCount > 1 ? "s" : ""}` : "All updates read"}
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
            { key: "appointment", label: "Appointments" },
            { key: "ticket", label: "Support" },
            { key: "broadcast", label: "Announcements" },
            { key: "scan", label: "Scan" },
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
        {(loading || (activeTab === "scan" && loadingScans)) ? (
          <div className="py-16 text-center text-gray-500">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-magenta-600" />
            <p className="text-sm">Loading notifications…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <Bell className="w-5 h-5 text-gray-400" />
            </div>
            <p className="text-sm font-semibold text-gray-900">No notifications found</p>
            <p className="text-sm text-gray-500 mt-1">
              {activeTab === "all"
                ? "You're all caught up! New updates from your clinic will appear here."
                : `No notifications under the ${activeTab} category.`}
            </p>
          </div>
        ) : (
          filtered.map((item) => {
            const isRescheduleDeclined =
              item.type === "reschedule_declined" ||
              item.type === "appointment-reschedule-declined" ||
              item.type === "appointment_reschedule_declined" ||
              item.metadata?.subtype === "reschedule_declined" ||
              item.metadata?.subtype === "reschedule-declined" ||
              /reschedule.*declined/i.test(item.title || "") ||
              /request to reschedule.*could not be accepted|original appointment.*remains reserved/i.test(item.message || "");
            const isRejected =
              !isRescheduleDeclined &&
              (item.type === "doctor_cancelled" ||
                item.type === "doctor_declined" ||
                item.type === "doctor-declined" ||
                item.type === "appointment-rejected" ||
                item.metadata?.subtype === "doctor_cancelled" ||
                item.metadata?.subtype === "doctor_declined" ||
                item.metadata?.subtype === "doctor-declined" ||
                item.metadata?.subtype === "schedule-conflict" ||
                /review update|schedule conflict|appointment declined/i.test(item.title || ""));
            const isCompleted = item.type === "appointment-completed";
            const isPaymentConfirmed =
              item.type === "payment-confirmed" ||
              item.type === "payment_confirmed" ||
              item.type === "appointment-payment-confirmed" ||
              item.metadata?.subtype === "payment_confirmed" ||
              item.metadata?.subtype === "payment-confirmed" ||
              item.metadata?.subtype === "payment" ||
              /payment.*(confirm|verifi|receiv)/i.test(item.title || "") ||
              /payment.*(confirm|verifi)/i.test(item.message || "");
            const isScheduleApproved =
              !isCompleted &&
              !isRejected &&
              (
                item.type === "appointment-scheduled" ||
                item.type === "appointment_scheduled" ||
                item.type === "appointment-accepted" ||
                item.type === "appointment_accepted" ||
                item.type === "appointment-approved" ||
                item.type === "appointment_approved" ||
                item.type === "doctor-confirmed-schedule" ||
                item.type === "doctor_confirmed_schedule" ||
                item.type === "schedule-confirmed" ||
                item.type === "schedule_confirmed" ||
                item.metadata?.subtype === "doctor-confirmed-schedule" ||
                item.metadata?.subtype === "doctor_confirmed_schedule" ||
                item.metadata?.subtype === "appointment-approved" ||
                item.metadata?.subtype === "appointment_approved" ||
                item.metadata?.subtype === "schedule-confirmed" ||
                item.metadata?.subtype === "schedule_confirmed" ||
                item.metadata?.subtype === "confirmed" ||
                item.metadata?.subtype === "doctor-approved" ||
                item.metadata?.subtype === "doctor_approved" ||
                item.metadata?.subtype === "reassigned" ||
                /doctor confirmed schedule|appointment confirmed|schedule confirmed|reschedule request approved/i.test(item.title || "") ||
                /approved your consultation schedule|schedule.*confirmed|has been confirmed|has been reassigned/i.test(item.message || "")
              );
            const isMissed =
              item.type === "appointment-missed" ||
              item.type === "appointment_missed" ||
              item.type === "appointment-no-show" ||
              item.type === "appointment_no_show" ||
              item.type === "no-show" ||
              item.type === "no_show" ||
              item.metadata?.subtype === "appointment-missed" ||
              item.metadata?.subtype === "appointment_missed" ||
              item.metadata?.subtype === "appointment-no-show" ||
              item.metadata?.subtype === "appointment_no_show" ||
              item.metadata?.subtype === "no-show" ||
              item.metadata?.subtype === "no_show" ||
              /missed\s*\/\s*no-show|appointment marked as missed|no-show/i.test(item.title || "") ||
              /recorded as no-show|marked as missed/i.test(item.message || "");
            const isMaintenance =
              item.metadata?.subtype === "maintenance_alert" ||
              item.type === "maintenance_alert" ||
              item.metadata?.priority === "high";
            const isBroadcast =
              item.category === "broadcast" ||
              item.type === "broadcast" ||
              item.metadata?.subtype === "admin_announcement";
            const isTicket =
              item.category === "ticket" ||
              item.type === "support" ||
              item.type === "support_ticket" ||
              item.type?.includes("ticket") ||
              item.type?.includes("support") ||
              item.metadata?.category === "support" ||
              item.metadata?.category === "ticket" ||
              /support ticket|ticket received|ticket resolved|ticket updated/i.test(item.title || "");
            const isScanResult =
              item.type === "scan_result" ||
              item.type === "scan-completed" ||
              (item.category as string) === "skin_scan" ||
              item.category === "scan" ||
              item.metadata?.category === "skin_scan";

            // Resolve appointment_id for "Consultation Completed" deep-link
            const completedApptId = isCompleted
              ? item.metadata?.appointment_id ||
                (item.id.startsWith("appt-completed-")
                  ? item.id.replace("appt-completed-", "")
                  : null)
              : null;

            // Resolve the display name for clinic notifications (completed consultation, payment confirmed, schedule approved, etc.)
            // item.senderName is the clinic name set by the service (e.g. "DerMA").
            // Fallback to "Clinic" only if the service couldn't resolve it — this keeps
            // initials meaningful ("D" / "SC") and avoids leaking "Clinic Update" into
            // the avatar circle or header label.
            const isClinicNotif =
              !isTicket &&
              (isCompleted ||
                isPaymentConfirmed ||
                isRejected ||
                isScheduleApproved ||
                isMissed ||
                item.senderType === "clinic" ||
                item.category === "appointment");
            const resolvedClinicName: string = isClinicNotif
              ? (item.senderName && item.senderName !== "Clinic Update" ? item.senderName : "Clinic")
              : (item.senderName || "");

            // Derive initials from the real clinic name, never from display fallback strings.
            // "DerMA" → "D" | "Skin Care Clinic" → "SC"
            const clinicInitials = resolvedClinicName
              ? resolvedClinicName
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((w: string) => w[0].toUpperCase())
                  .join("")
              : "C";

            const rawAvatarUrl = item.senderAvatar || item.metadata?.sender_avatar || item.metadata?.avatar_url;
            const resolvedLogoUrl = resolveAvatarUrl(rawAvatarUrl) || rawAvatarUrl || null;

            return (
              <div
                key={item.id}
                onClick={() => !item.isRead && markRead(item.id)}
                className={cn(
                  "relative flex items-start gap-3 px-5 py-4 transition-colors cursor-pointer",
                  !item.isRead
                    ? isMaintenance
                      ? "bg-amber-50/50 hover:bg-amber-50/80"
                      : "bg-magenta-50/40 hover:bg-magenta-50/70"
                    : "hover:bg-gray-50"
                )}
              >
                {!item.isRead && (
                  <span
                    className={cn(
                      "absolute left-0 top-0 bottom-0 w-0.5",
                      isMaintenance ? "bg-amber-500" : "bg-magenta-600"
                    )}
                  />
                )}

                {/* Sender Avatar / Icon */}
                <div className="shrink-0">
                  {resolvedLogoUrl ? (
                    /* Has an explicit avatar/logo URL — prioritize rendering clinic logo or admin support avatar image */
                    <>
                      <img
                        src={resolvedLogoUrl}
                        alt={isTicket ? (item.senderName || "DERMAI Support") : (resolvedClinicName || item.senderName || "Clinic")}
                        referrerPolicy="no-referrer"
                        className="w-10 h-10 rounded-full object-cover border border-gray-200 bg-white"
                        onError={(e) => {
                          (e.currentTarget as HTMLElement).style.display = "none";
                          const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                          if (fallback) fallback.style.display = "flex";
                        }}
                      />
                      {isTicket ? (
                        <div
                          style={{ display: "none" }}
                          className="w-10 h-10 rounded-full bg-magenta-50 border border-magenta-100 items-center justify-center shrink-0"
                        >
                          <HelpCircle className="w-5 h-5 text-magenta-600" />
                        </div>
                      ) : (
                        <div
                          style={{ display: "none" }}
                          className="w-10 h-10 rounded-full bg-magenta-600 items-center justify-center shrink-0"
                        >
                          <span className="text-white text-xs font-bold leading-none">{clinicInitials}</span>
                        </div>
                      )}
                    </>
                  ) : loading ? (
                    <div className="w-10 h-10 rounded-full bg-gray-100 animate-pulse border border-gray-200 shrink-0" />
                  ) : (isCompleted || isPaymentConfirmed || isScheduleApproved || isMissed || (item.senderType === "clinic" && !isRejected && !isTicket)) ? (
                    /* Consultation Completed / Payment Confirmed / Schedule Approved: show clinic initials (graceful fallback) */
                    <div className="w-10 h-10 rounded-full bg-magenta-600 flex items-center justify-center shrink-0">
                      <span className="text-white text-xs font-bold leading-none">{clinicInitials}</span>
                    </div>
                  ) : isRejected ? (
                    /* Rejection fallback when no logo URL: show red X icon */
                    <div className="w-10 h-10 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center">
                      <XCircle className="w-5 h-5 text-rose-600" />
                    </div>
                  ) : item.senderType === "clinic" && !isTicket ? (
                    <div className="w-10 h-10 rounded-full bg-magenta-50 border border-magenta-100 flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-magenta-600" />
                    </div>
                  ) : isMaintenance ? (
                    <div className="w-10 h-10 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center">
                      <AlertTriangle className="w-5 h-5 text-amber-600" />
                    </div>
                  ) : isBroadcast ? (
                    <div className="w-10 h-10 rounded-full bg-magenta-50 border border-magenta-100 flex items-center justify-center">
                      <Megaphone className="w-5 h-5 text-magenta-600" />
                    </div>
                  ) : isScanResult ? (
                    <div className="w-10 h-10 rounded-full bg-magenta-50 border border-magenta-100 flex items-center justify-center">
                      <Sparkles className="w-5 h-5 text-magenta-600" />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-magenta-50 border border-magenta-100 flex items-center justify-center">
                      {getItemIcon(item)}
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={cn(
                          "text-xs font-semibold truncate",
                          isMaintenance ? "text-amber-800" : "text-magenta-700"
                        )}
                      >
                        {isTicket
                          ? (item.senderName || "DERMAI Support")
                          : isClinicNotif
                          ? resolvedClinicName
                          : (item.senderName || (isBroadcast || isMaintenance ? "Platform Administrator" : resolvedClinicName || "Clinic"))}
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
                      {isScanResult && item.metadata?.confidence_score != null && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-magenta-50 text-magenta-700 border border-magenta-200 shrink-0">
                          {item.metadata.confidence_score}% Confidence
                        </span>
                      )}
                    </div>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-gray-500 whitespace-nowrap">{timeAgo(item.timestamp)}</span>
                      {!item.isRead && (
                        <span
                          className={cn(
                            "w-2 h-2 rounded-full",
                            isMaintenance ? "bg-amber-500" : "bg-magenta-600"
                          )}
                        />
                      )}
                    </span>
                  </div>

                  <p className="text-sm font-semibold text-gray-900 mt-0.5">{item.title}</p>
                  <p className="text-sm text-gray-600 leading-relaxed mt-0.5 break-words">{item.message}</p>

                  {/* "View Details" button — Consultation Completed only */}
                  {isCompleted && (
                    <div className="mt-3">
                      <Link
                        to={
                          completedApptId
                            ? `/dashboard/appointment-status?appointment=${completedApptId}`
                            : "/dashboard/appointment-status"
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          onClose?.();
                        }}
                        className="inline-flex items-center px-4 py-1.5 rounded-lg bg-[#A21D5C] hover:bg-[#88184d] text-white text-xs font-semibold transition-colors shadow-sm"
                      >
                        View Details
                      </Link>
                    </div>
                  )}

                  {/* Dynamic 24-Hour Re-selection Banner for Rejections */}
                  {isRejected && (() => {
                    const notifApptId =
                      item.metadata?.appointment_id ||
                      (item.id.startsWith("appt-rejected-") ? item.id.replace("appt-rejected-", "") : "");
                    let isReselectionResolved = Boolean(item.metadata?.reselection_resolved);
                    if (!isReselectionResolved && notifApptId) {
                      try {
                        const reselectedMap = JSON.parse(localStorage.getItem("dermai_reselected_appointments") || "{}");
                        if (reselectedMap[notifApptId]) {
                          isReselectionResolved = true;
                        } else {
                          const localAppts: any[] = JSON.parse(localStorage.getItem("dermai_clinic_appointments") || "[]");
                          const matchedAppt = localAppts.find(
                            (a: any) => String(a.id || a.appointment_id) === String(notifApptId)
                          );
                          if (matchedAppt) {
                            const qa = matchedAppt.questionnaireAnswers || matchedAppt.questionnaire_answers || {};
                            const docSt = String(matchedAppt.doctorStatus || matchedAppt.doctor_status || "").toLowerCase();
                            if (
                              qa.reselection_status === "reselected" ||
                              qa.reselection_required === false ||
                              qa.workflow_status === "pending_doctor_review" ||
                              (docSt && docSt !== "rejected" && docSt !== "declined" && docSt !== "reselection_required")
                            ) {
                              isReselectionResolved = true;
                            }
                          }
                        }
                      } catch { }
                    }

                    if (isReselectionResolved) return null;

                    const declinedTimestamp = item.metadata?.declined_at
                      ? new Date(item.metadata.declined_at).getTime()
                      : item.timestamp
                      ? new Date(item.timestamp).getTime()
                      : Date.now();
                    const isWindowExpired =
                      !isNaN(declinedTimestamp) && Date.now() - declinedTimestamp > 24 * 3600 * 1000;

                    return isWindowExpired ? (
                      <div className="mt-3 p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900 space-y-2">
                        <div className="flex items-start gap-2.5 leading-relaxed">
                          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          <span>
                            The 24-hour re-selection window has expired. The clinic will automatically assign an available doctor.
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 p-3.5 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-800 space-y-3">
                        <div className="flex items-start gap-2.5 leading-relaxed">
                          <AlertCircle className="w-4 h-4 text-magenta-600 shrink-0 mt-0.5" />
                          <span>
                            <strong>24-hour window:</strong> You can select another available doctor within 24 hours. If no selection is made within 24 hours, the clinic will automatically assign an available doctor to your booking.
                          </span>
                        </div>
                        <Link
                          to={notifApptId ? `/patient/appointment-status?appointment_id=${notifApptId}&action=reassign` : "/patient/appointment-status"}
                          onClick={onClose}
                          className="inline-flex items-center px-3.5 py-1.5 rounded-lg bg-magenta-600 text-white text-sm font-medium hover:bg-magenta-700 transition-colors shadow-xs"
                        >
                          Select alternate doctor
                        </Link>
                      </div>
                    );
                  })()}

                  {/* Action Link for schedule approvals ("Doctor Confirmed Schedule", "Reschedule Request Approved", etc.), scan logs, and general notifications */}
                  {isScanResult ? (
                    <Link
                      to={item.link || (item.metadata?.analysis_id ? `/dashboard/history?id=${item.metadata.analysis_id}` : "/dashboard/history")}
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose?.();
                      }}
                      className="mt-2 inline-flex items-center text-sm font-medium text-magenta-700 hover:text-magenta-800 transition-colors"
                    >
                      View scan details →
                    </Link>
                  ) : (() => {
                    const validApptId =
                      item.metadata?.appointment_id ||
                      item.metadata?.appointmentId ||
                      item.metadata?.booking_id ||
                      item.metadata?.bookingId ||
                      (item as any).appointment_id ||
                      (item as any).booking_id ||
                      (item.id.startsWith("appt-accepted-")
                        ? item.id.replace("appt-accepted-", "")
                        : item.id.startsWith("appt-scheduled-")
                        ? item.id.replace("appt-scheduled-", "")
                        : null);
                    const targetLink = isScheduleApproved
                      ? (validApptId
                          ? `/patient/appointment-status?appointment_id=${validApptId}`
                          : null)
                      : (item.link || (validApptId ? `/patient/appointment-status?appointment_id=${validApptId}` : null));
                    if (!targetLink || isRejected || isCompleted || isRescheduleDeclined) return null;
                    return (
                      <Link
                        to={targetLink}
                        onClick={(e) => {
                          e.stopPropagation();
                          onClose?.();
                        }}
                        className="mt-2 inline-flex items-center text-sm font-medium text-magenta-700 hover:text-magenta-800 transition-colors"
                      >
                        View details →
                      </Link>
                    );
                  })()}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer view all link */}
      {isDropdown && (
        <div className="border-t border-gray-200 px-5 py-3 bg-gray-50 text-center">
          <Link
            to="/dashboard/appointment-status"
            onClick={onClose}
            className="text-sm font-medium text-magenta-700 hover:text-magenta-800 transition-colors"
          >
            Check appointment status →
          </Link>
        </div>
      )}
    </div>
  );
}
