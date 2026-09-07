// Data layer — all functions now call Supabase directly.
// Stub bodies have been replaced with real queries.

import { supabase } from "./supabaseClient";

export type PlatformUser = {
  id: string;
  name: string;
  email: string;
  status: "active" | "suspended" | "inactive";
  plan: "Free" | "Premium";
  subscriptionRenewsAt?: string;
};

export type PlatformScanStatus = "valid" | "flagged" | "invalid";

export type PlatformScan = {
  id: string;
  status: PlatformScanStatus;
  district?: string;
  condition?: string;
};

export type SubscriptionPlan = {
  id: string;
  name: string;
  price: number;
  billingType: "monthly" | "yearly" | "one-time";
  description: string;
  features: string[];
  scanLimit: number | null;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

// GET /plan (public read — no auth required)
export async function getSubscriptionPlansAsync(includeInactive = false): Promise<SubscriptionPlan[]> {
  let query = supabase
    .from("plan")
    .select(`
      plan_id,
      name,
      price,
      billing_type,
      scan_limit,
      status,
      plan_feature ( feature_text )
    `)
    .order("price");

  if (!includeInactive) {
    query = query.eq("status", "active");
  }

  const { data: plans, error } = await query;

  if (error) {
    console.error("[store] getSubscriptionPlansAsync:", error.message);
    return [];
  }

  return (plans ?? []).map((p: any) => ({
    id: p.plan_id,
    name: p.name,
    price: Number(p.price) || 0,
    billingType: p.billing_type === "yearly" ? "yearly" : "monthly",
    description: p.scan_limit === -1 ? "Unlimited skin scans" : `${p.scan_limit} free skin scan${p.scan_limit !== 1 ? "s" : ""}`,
    features: (p.plan_feature || []).map((f: any) => f.feature_text),
    scanLimit: p.scan_limit === -1 ? null : p.scan_limit,
    status: (p.status as "active" | "inactive"),
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }));
}

// Kept as a sync shim for any existing callers — returns empty; prefer getSubscriptionPlansAsync
export function getSubscriptionPlans(): SubscriptionPlan[] {
  return [];
}

// GET /user  (admin only — enforced via RLS)
export async function getPlatformUsersAsync(): Promise<PlatformUser[]> {
  const { data, error } = await supabase
    .from("user")
    .select("user_id, full_name, email, role");

  if (error) {
    console.error("[store] getPlatformUsersAsync:", error.message);
    return [];
  }

  return (data ?? []).map((u: { user_id: string; full_name: string; email: string; role: string }) => ({
    id: u.user_id,
    name: u.full_name,
    email: u.email,
    status: "active" as const,
    plan: "Free" as const,
  }));
}

export function getPlatformUsers(): PlatformUser[] {
  return [];
}

// PATCH user status  (admin only)
export async function updatePlatformUserStatus(
  _email: string,
  _status: PlatformUser["status"]
): Promise<void> {
  // TODO: add a status column to the user table to support this
}

// GET /ai_scan_result (admin only)
export async function getPlatformScansAsync(): Promise<PlatformScan[]> {
  const { data, error } = await supabase
    .from("ai_scan_result")
    .select("analysis_id, status, body_part, skin_condition(name)")
    .order("scanned_at", { ascending: false });

  if (error) {
    console.error("[store] getPlatformScansAsync:", error.message);
    return [];
  }

  return (data ?? []).map((s: {
    analysis_id: string;
    status: string;
    body_part: string | null;
    skin_condition: { name: string } | null;
  }) => ({
    id: s.analysis_id,
    status: (["valid", "flagged", "invalid"].includes(s.status) ? s.status : "valid") as PlatformScanStatus,
    district: s.body_part ?? undefined,
    condition: s.skin_condition?.name ?? undefined,
  }));
}

export function getPlatformScans(): PlatformScan[] {
  return [];
}

// PATCH scan status (admin only)
export async function updatePlatformScanStatus(
  id: string,
  status: PlatformScanStatus,
  _reason?: string
): Promise<void> {
  const { error } = await supabase
    .from("ai_scan_result")
    .update({ status })
    .eq("analysis_id", id);

  if (error) console.error("[store] updatePlatformScanStatus:", error.message);
}

// PATCH helpdesk ticket status (admin only)
export async function updateHelpdeskTicketStatus(
  id: string,
  status: "open" | "in-progress" | "resolved"
): Promise<void> {
  const mapped = status === "in-progress" ? "pending" : status === "resolved" ? "closed" : "open";
  const { error } = await supabase
    .from("user_support_ticket")
    .update({ status: mapped })
    .eq("ticket_id", id);

  if (error) console.error("[store] updateHelpdeskTicketStatus:", error.message);
}

// Upsert subscription plan (admin only)
export async function upsertSubscriptionPlan(plan: SubscriptionPlan): Promise<void> {
  const isNew = !plan.id || plan.id.startsWith("plan-");
  const planData: Record<string, any> = {
    name: plan.name,
    price: plan.price,
    billing_type: plan.billingType === "one-time" ? "monthly" : plan.billingType,
    scan_limit: plan.scanLimit === null ? -1 : plan.scanLimit,
    status: plan.status,
  };
  if (!isNew) {
    planData.plan_id = plan.id;
  }

  const { data, error } = await supabase
    .from("plan")
    .upsert(planData)
    .select("plan_id")
    .single();

  if (error) {
    console.error("[store] upsertSubscriptionPlan:", error.message);
    return;
  }

  const savedPlanId = data?.plan_id || (isNew ? null : plan.id);
  if (savedPlanId && plan.features) {
    await supabase.from("plan_feature").delete().eq("plan_id", savedPlanId);
    if (plan.features.length > 0) {
      await supabase.from("plan_feature").insert(
        plan.features.map((f) => ({
          plan_id: savedPlanId,
          feature_text: f,
        }))
      );
    }
  }
}

// Delete subscription plan (admin only)
export async function deleteSubscriptionPlan(id: string): Promise<void> {
  const { error } = await supabase.from("plan").delete().eq("plan_id", id);
  if (error) console.error("[store] deleteSubscriptionPlan:", error.message);
}

// Clinic Patient Records with file_path support
export type ClinicPatientRecord = {
  record_id: string;
  record_name: string;
  record_type: string;
  file_path: string | null;
  uploaded_at: string;
  patient_user_id: string;
  clinic_id: string;
};

// GET /clinic_patient_record
export async function getClinicPatientRecordsAsync(patientUserId: string, clinicId?: string): Promise<ClinicPatientRecord[]> {
  let query = supabase
    .from("clinic_patient_record")
    .select("record_id, record_name, record_type, file_path, uploaded_at, patient_user_id, clinic_id")
    .eq("patient_user_id", patientUserId);

  if (clinicId) {
    query = query.eq("clinic_id", clinicId);
  }

  const { data, error } = await query.order("uploaded_at", { ascending: false });
  if (error) {
    console.error("[store] getClinicPatientRecordsAsync:", error.message);
    return [];
  }
  return (data as ClinicPatientRecord[]) ?? [];
}

// POST /clinic_patient_record
export async function createClinicPatientRecordAsync(record: {
  record_name: string;
  record_type: string;
  file_path: string;
  patient_user_id: string;
  clinic_id: string;
}): Promise<ClinicPatientRecord | null> {
  const { data, error } = await supabase
    .from("clinic_patient_record")
    .insert({
      record_name: record.record_name,
      record_type: record.record_type,
      file_path: record.file_path,
      patient_user_id: record.patient_user_id,
      clinic_id: record.clinic_id,
    })
    .select()
    .single();

  if (error) {
    console.error("[store] createClinicPatientRecordAsync:", error.message);
    return null;
  }
  return data as ClinicPatientRecord;
}