import { supabase } from './supabase';

export type AuditActorType = 'patient' | 'doctor' | 'clinic' | 'admin' | 'system';
export type AuditCategory =
  | 'User'
  | 'Appointment'
  | 'Subscription'
  | 'Clinic'
  | 'Scan'
  | 'System'
  | 'user'
  | 'appointment'
  | 'subscription'
  | 'clinic'
  | 'scan'
  | 'system';

export interface AuditEventParams {
  userId?: string | null;
  user_id?: string | null;
  role?: AuditActorType | string;
  user_type?: AuditActorType | string;
  category?: AuditCategory | string;
  log_type?: AuditCategory | string;
  action: string;
  target?: string;
  details?: string;
  performerName?: string;
  performer_name?: string;
  metadata?: Record<string, any>;
}

export function normalizeActorType(role?: string | null): AuditActorType {
  if (!role) return 'patient';
  const r = role.toLowerCase().trim();
  if (r === 'admin') return 'admin';
  if (r === 'doctor') return 'doctor';
  if (r === 'clinic') return 'clinic';
  if (r === 'patient') return 'patient';
  return 'system';
}

export function normalizeCategory(category?: string | null): string {
  if (!category) return 'user';
  const c = category.toLowerCase().trim();
  if (c === 'user') return 'user';
  if (c === 'appointment') return 'appointment';
  if (c === 'subscription') return 'subscription';
  if (c === 'clinic') return 'clinic';
  if (c === 'scan') return 'scan';
  return 'system';
}

/**
 * Mobile audit logging utility.
 * Captures and persists patient actions from the mobile app into the Supabase `system_audit_log` table.
 * Standardized to match web patient audit logging conventions exactly.
 */
export async function logAuditEvent(params: AuditEventParams): Promise<void> {
  const {
    userId,
    user_id,
    role = 'patient',
    user_type,
    category = 'user',
    log_type,
    action,
    target = 'Mobile App',
    details,
    performerName,
    performer_name,
    metadata = {},
  } = params;
  try {
    let resolvedUserId = user_id || userId || null;
    const effectiveRole = user_type || role || 'patient';
    let resolvedRole = effectiveRole ? normalizeActorType(effectiveRole) : 'patient';
    let resolvedPerformer = performer_name || performerName || null;

    if (!resolvedUserId || !resolvedPerformer) {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const authUser = sessionData?.session?.user;
        if (authUser) {
          if (!resolvedUserId) resolvedUserId = authUser.id;
          if (!resolvedPerformer) {
            resolvedPerformer =
              authUser.user_metadata?.full_name ||
              authUser.user_metadata?.name ||
              authUser.email?.split('@')[0] ||
              'Patient';
          }
        }
      } catch {
        // Fallback gracefully
      }
    }

    const finalActor: AuditActorType = resolvedRole || 'patient';
    const finalCategory: string = normalizeCategory(log_type || category);
    const finalPerformer: string = resolvedPerformer || 'Patient';
    const finalTarget: string = target.trim() || 'Mobile App';

    let finalDetails = (details || `${action} performed on Mobile App.`).trim();
    const metaWithPlatform = { platform: 'Mobile App', ...metadata };
    try {
      const metaStr = JSON.stringify(metaWithPlatform);
      if (!finalDetails.includes(metaStr)) {
        finalDetails += ` | Context: ${metaStr}`;
      }
    } catch {
      // Ignore serialization issues
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

    const { error } = await supabase.from('system_audit_log').insert(payload);
    if (error) {
      console.warn('[MobileAuditLogger] Failed to insert audit log:', error.message);
    }
  } catch (err) {
    console.error('[MobileAuditLogger] Unexpected audit logging exception:', err);
  }
}

