// Placeholder audit log. TODO: replace with real Supabase-backed audit trail.

export type AuditActorType = "admin" | "patient" | "clinic" | "system";
export type AuditEntryType = "user" | "subscription" | "clinic" | "system" | "scan" | "appointment";

export type AuditEntry = {
  id: string;
  timestamp: string;
  action: string;
  target: string;
  details: string;
  performedBy: string;
  actorType: AuditActorType;
  type: AuditEntryType;
};

// TODO: POST /api/admin/audit-log
export function logAdminAction(
  _action: string,
  _target: string,
  _details: string,
  _type: AuditEntryType
): void {}
