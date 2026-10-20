export {
  logAuditEvent,
  normalizeActorType,
  normalizeCategory,
  type AuditActorType,
  type AuditCategory,
  type AuditEventParams,
} from "@/utils/auditLogger";

export type AuditEntryType = "user" | "subscription" | "clinic" | "system" | "scan" | "appointment";

export type AuditEntry = {
  id: string;
  timestamp: string;
  action: string;
  target: string;
  details: string;
  performedBy: string;
  actorType: import("@/utils/auditLogger").AuditActorType;
  type: AuditEntryType;
};

export type LogAuditParams = import("@/utils/auditLogger").AuditEventParams;

/**
 * Standardizes log category into known AuditEntryType
 */
export function normalizeEntryType(category?: string | null): AuditEntryType {
  if (!category) return "system";
  const c = category.toLowerCase().trim();
  if (c === "user") return "user";
  if (c === "subscription") return "subscription";
  if (c === "clinic") return "clinic";
  if (c === "scan") return "scan";
  if (c === "appointment") return "appointment";
  return "system";
}

/**
 * Backwards-compatible helper for existing admin actions.
 */
export function logAdminAction(
  action: string,
  target: string,
  details: string,
  type: AuditEntryType = "system"
): void {
  import("@/utils/auditLogger").then(({ logAuditEvent }) => {
    logAuditEvent({
      role: "admin",
      category: type,
      action,
      target,
      details,
    }).catch(() => {});
  });
}
