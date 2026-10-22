import { Link } from "react-router-dom";
import { AlertCircle } from "lucide-react";
import type { NotificationItem as NotificationItemType } from "@/lib/notificationService";

export interface NotificationItemProps {
  item: NotificationItemType;
  onClose?: () => void;
}

/**
 * NotificationItem component for rendering patient notification entries.
 * When the appointment is declined/rejected and within the 24-hour window,
 * provides the 'Select alternate doctor' button linking directly to:
 * /patient/appointment-status?appointment_id=[appointment_id]&action=reassign
 */
export function NotificationItem({ item, onClose }: NotificationItemProps) {
  const isRejected = item.type === "appointment-rejected";
  const notifApptId = item.metadata?.appointment_id || (item.link?.match(/[0-9a-fA-F-]{36}/) ? item.link.match(/[0-9a-fA-F-]{36}/)?.[0] : null);

  const declinedTimestamp = item.metadata?.declined_at
    ? new Date(item.metadata.declined_at).getTime()
    : item.timestamp
    ? new Date(item.timestamp).getTime()
    : Date.now();
  const isWindowExpired = !isNaN(declinedTimestamp) && Date.now() - declinedTimestamp > 24 * 3600 * 1000;

  return (
    <div className={`p-4 rounded-xl border transition-all ${!item.isRead ? "bg-magenta-50/20 border-magenta-100" : "bg-white border-gray-100"}`}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-bold text-gray-900">{item.title}</h4>
        <span className="text-[10px] text-gray-400 shrink-0">
          {new Date(item.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </span>
      </div>
      <p className="text-xs text-gray-600 mt-1 leading-relaxed">{item.message}</p>

      {isRejected && (
        isWindowExpired ? (
          <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>The 24-hour re-selection window has expired. The clinic will automatically assign an available doctor.</span>
          </div>
        ) : (
          <div className="mt-3 p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-800 space-y-2.5">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-magenta-600 shrink-0 mt-0.5" />
              <span>
                <strong>24-hour window:</strong> You can select another available doctor within 24 hours at no extra charge.
              </span>
            </div>
            <Link
              to={notifApptId ? `/patient/appointment-status?appointment_id=${notifApptId}&action=reassign` : "/patient/appointment-status"}
              onClick={onClose}
              className="inline-flex items-center px-3 py-1.5 rounded-lg bg-[#A21D5C] hover:bg-[#88184d] text-white text-xs font-semibold transition-colors shadow-xs"
            >
              Select alternate doctor
            </Link>
          </div>
        )
      )}

      {item.link && !isRejected && (
        <Link
          to={item.link}
          onClick={onClose}
          className="mt-2 inline-flex items-center text-xs font-semibold text-[#A21D5C] hover:underline"
        >
          View details →
        </Link>
      )}
    </div>
  );
}

export default NotificationItem;
