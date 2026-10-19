import { supabase } from "@/lib/supabaseClient";

export type AuditActorType = "patient" | "doctor" | "clinic" | "admin" | "system";
export type AuditCategory =
  | "User"
  | "Appointment"
  | "Subscription"
  | "Clinic"
  | "Scan"
  | "System"
  | "user"
  | "appointment"
  | "subscription"
  | "clinic"
  | "scan"
  | "system";

export interface AuditEventParams {
  userId?: string | null;
  role?: AuditActorType | string;
  category?: AuditCategory | string;
  action: string;
  target?: string;
  details?: string;
  performerName?: string;
  metadata?: Record<string, any>;
}

/**
 * Standardizes actor role into known AuditActorType
 */
export function normalizeActorType(role?: string | null): AuditActorType {
  if (!role) return "system";
  const r = role.toLowerCase().trim();
  if (r === "admin") return "admin";
  if (r === "doctor") return "doctor";
  if (r === "clinic") return "clinic";
  if (r === "patient") return "patient";
  return "system";
}

/**
 * Standardizes log category into known lowercase category key ('user', 'appointment', etc.)
 */
export function normalizeCategory(category?: string | null): string {
  if (!category) return "system";
  const c = category.toLowerCase().trim();
  if (c === "user") return "user";
  if (c === "appointment") return "appointment";
  if (c === "subscription") return "subscription";
  if (c === "clinic") return "clinic";
  if (c === "scan") return "scan";
  return "system";
}

/**
 * Centralized audit logging utility.
 * Captures and persists actions across all user roles (Patient, Clinic, Doctor, Admin, System)
 * into the Supabase `system_audit_log` table.
 *
 * Execution is non-blocking and handles errors gracefully without interrupting primary workflows.
 */
export async function logAuditEvent({
  userId,
  role,
  category = "System",
  action,
  target = "Platform",
  details,
  performerName,
  metadata = {},
}: AuditEventParams): Promise<void> {
  try {
    let resolvedUserId = userId || null;
    let resolvedRole = role ? normalizeActorType(role) : null;
    let resolvedPerformer = performerName || null;

    // Fallback: resolve missing user/role/name from active Supabase auth session
    if (!resolvedUserId || !resolvedRole || !resolvedPerformer) {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const authUser = sessionData?.session?.user;
        if (authUser) {
          if (!resolvedUserId) resolvedUserId = authUser.id;
          if (!resolvedPerformer) {
            resolvedPerformer =
              authUser.user_metadata?.full_name ||
              authUser.user_metadata?.name ||
              authUser.email?.split("@")[0] ||
              "User";
          }
          if (!resolvedRole) {
            const cachedRole = localStorage.getItem(`derm_role_${authUser.id}`);
            if (cachedRole) {
              resolvedRole = normalizeActorType(cachedRole);
            }
          }
        }
      } catch {
        // Silent recovery
      }
    }

    const finalActor: AuditActorType = resolvedRole || "system";
    const finalCategory: string = normalizeCategory(category);
    const finalPerformer: string =
      resolvedPerformer || (finalActor === "system" ? "System Core" : "User");
    const finalTarget: string = target.trim() || "Platform";

    let finalDetails = (details || `${action} performed.`).trim();
    if (metadata && Object.keys(metadata).length > 0) {
      try {
        const metaStr = JSON.stringify(metadata);
        if (!finalDetails.includes(metaStr)) {
          finalDetails += ` | Context: ${metaStr}`;
        }
      } catch {
        // Ignore serialization issues
      }
    }

    const payload = {
      user_type: finalActor,
      action: action.trim(),
      log_type: finalCategory,
      target: finalTarget,
      details: finalDetails,
      performer_name: finalPerformer,
      user_id: resolvedUserId,
      timestamp: new Date().toISOString(),
    };

    const { error } = await supabase.from("system_audit_log").insert(payload);
    if (error) {
      console.warn("[CentralAuditLogger] Failed to insert audit log:", error.message);
    }
  } catch (err) {
    console.error("[CentralAuditLogger] Unexpected audit logging exception:", err);
  }
}
