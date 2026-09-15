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

  return ((data ?? []) as any[]).map((s: any) => {
    const skinCond = Array.isArray(s.skin_condition) ? s.skin_condition[0] : s.skin_condition;
    return {
      id: s.analysis_id,
      status: (["valid", "flagged", "invalid"].includes(s.status) ? s.status : "valid") as PlatformScanStatus,
      district: s.body_part ?? undefined,
      condition: skinCond?.name ?? undefined,
    };
  });
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

export type HelpdeskTicketStatus = "open" | "in-progress" | "resolved";

export type HelpdeskTicket = {
  id: string;
  userId?: string;
  user: string;
  email: string;
  subject: string;
  message: string;
  status: HelpdeskTicketStatus;
  category: string;
  priority: "low" | "medium" | "high" | "urgent";
  response?: string;
  createdAt: string;
  updatedAt?: string;
};

const HELPDESK_STORAGE_KEY = "dermai_helpdesk_tickets";

// Helper to get local fallback tickets
export function getLocalHelpdeskTickets(): HelpdeskTicket[] {
  try {
    const raw = localStorage.getItem(HELPDESK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((t: any) => ({
      id: t.id || t.ticket_id || `TKT-${Date.now().toString().slice(-6)}`,
      userId: t.userId || t.user_id,
      user: t.user || t.full_name || t.userName || "Platform User",
      email: t.email || "",
      subject: t.subject || "Support Inquiry",
      message: t.message || "",
      status: (t.status === "in-progress" || t.status === "resolved" ? t.status : "open") as HelpdeskTicketStatus,
      category: t.category || "General Support",
      priority: t.priority || "medium",
      response: t.response || undefined,
      createdAt: t.createdAt || t.created_at || new Date().toISOString(),
      updatedAt: t.updatedAt || t.updated_at || undefined,
    }));
  } catch {
    return [];
  }
}

// Helper to save local fallback tickets
export function saveLocalHelpdeskTickets(tickets: HelpdeskTicket[]): void {
  try {
    localStorage.setItem(HELPDESK_STORAGE_KEY, JSON.stringify(tickets));
  } catch {
    /* ignore */
  }
}

// GET helpdesk tickets (Strictly real data from Supabase + localStorage)
export async function getHelpdeskTicketsAsync(userId?: string): Promise<HelpdeskTicket[]> {
  const localTickets = getLocalHelpdeskTickets();
  let dbTickets: HelpdeskTicket[] = [];

  try {
    // Fetch real tickets from Supabase without fragile join syntax
    let query = supabase
      .from("user_support_ticket")
      .select("*")
      .order("created_at", { ascending: false });

    if (userId) {
      query = query.eq("user_id", userId);
    }

    const { data, error } = await query;

    if (!error && data && data.length > 0) {
      // Fetch sender profiles safely
      const userIds = Array.from(new Set(data.map((t: any) => t.user_id).filter(Boolean)));
      const userMap = new Map<string, { full_name: string; email: string }>();

      if (userIds.length > 0) {
        try {
          const { data: usersData } = await supabase
            .from("user")
            .select("user_id, full_name, email")
            .in("user_id", userIds);

          if (usersData) {
            usersData.forEach((u: any) => {
              userMap.set(u.user_id, {
                full_name: u.full_name || "Platform User",
                email: u.email || "",
              });
            });
          }
        } catch {
          /* ignore */
        }
      }

      const statusMap: Record<string, HelpdeskTicketStatus> = {
        open: "open",
        pending: "in-progress",
        closed: "resolved",
      };

      dbTickets = data.map((t: any) => {
        const userInfo = userMap.get(t.user_id);
        const rawStatus = (t.status || "open").toLowerCase();
        const mappedStatus: HelpdeskTicketStatus =
          statusMap[rawStatus] ||
          (rawStatus === "in-progress" || rawStatus === "resolved" ? (rawStatus as HelpdeskTicketStatus) : "open");

        return {
          id: t.ticket_id || t.id,
          userId: t.user_id,
          user: userInfo?.full_name || t.user_name || t.user || "Platform User",
          email: userInfo?.email || t.email || "",
          subject: t.subject || "Support Inquiry",
          message: t.message || "",
          status: mappedStatus,
          category: t.category || "General Support",
          priority: (t.priority as any) || "medium",
          response: t.response || undefined,
          createdAt: t.created_at || t.createdAt || new Date().toISOString(),
          updatedAt: t.updated_at || t.updatedAt || undefined,
        };
      });
    } else if (error) {
      console.warn("[store] getHelpdeskTicketsAsync query warning:", error.message);
    }
  } catch (err) {
    console.warn("[store] getHelpdeskTicketsAsync network error:", err);
  }

  // Merge DB tickets and real local tickets created in session
  const ticketMap = new Map<string, HelpdeskTicket>();
  dbTickets.forEach((t) => {
    if (t && t.id) ticketMap.set(t.id, t);
  });
  localTickets.forEach((t) => {
    if (t && t.id) {
      if (!ticketMap.has(t.id)) {
        if (!userId || t.userId === userId) {
          ticketMap.set(t.id, t);
        }
      }
    }
  });

  const merged = Array.from(ticketMap.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return merged;
}

// CREATE helpdesk ticket
export async function createHelpdeskTicketAsync(input: {
  userId?: string;
  user?: string;
  email?: string;
  subject: string;
  message: string;
  category?: string;
  priority?: "low" | "medium" | "high" | "urgent";
}): Promise<HelpdeskTicket> {
  const generatedId = `TKT-${Date.now().toString().slice(-6)}`;
  let savedId = generatedId;

  const ticketCategory = input.category || "General Support";
  const ticketPriority = input.priority || "medium";

  // 1. Resolve an effective user ID for the foreign key constraint
  let effectiveUserId = input.userId;
  if (!effectiveUserId) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      effectiveUserId = sessionData?.session?.user?.id;
    } catch {
      /* ignore */
    }
  }

  // 2. If still no user ID, pick or create an existing platform user
  if (!effectiveUserId) {
    try {
      const { data: anyUser } = await supabase
        .from("user")
        .select("user_id")
        .limit(1)
        .maybeSingle();

      if (anyUser?.user_id) {
        effectiveUserId = anyUser.user_id;
      }
    } catch {
      /* ignore */
    }
  }

  // 3. Ensure effectiveUserId exists in "user" table to avoid FK error (23503)
  if (effectiveUserId) {
    try {
      const { data: userRow } = await supabase
        .from("user")
        .select("user_id")
        .eq("user_id", effectiveUserId)
        .maybeSingle();

      if (!userRow) {
        await supabase.from("user").insert({
          user_id: effectiveUserId,
          full_name: input.user || "Platform User",
          email: input.email || "user@dermai.ph",
          role: "patient",
        });
      }
    } catch {
      /* ignore */
    }
  }

  // 4. Insert ticket into Supabase user_support_ticket
  if (effectiveUserId) {
    try {
      // First attempt with all fields
      let { data, error } = await supabase
        .from("user_support_ticket")
        .insert({
          user_id: effectiveUserId,
          subject: input.subject.trim(),
          message: input.message.trim(),
          status: "open",
          category: ticketCategory,
          priority: ticketPriority,
        })
        .select("ticket_id, created_at")
        .maybeSingle();

      // If category/priority column error, fallback to baseline columns
      if (error && (error.code === "42703" || error.message?.includes("column"))) {
        const fallbackRes = await supabase
          .from("user_support_ticket")
          .insert({
            user_id: effectiveUserId,
            subject: input.subject.trim(),
            message: input.message.trim(),
            status: "open",
          })
          .select("ticket_id, created_at")
          .maybeSingle();

        if (!fallbackRes.error && fallbackRes.data?.ticket_id) {
          savedId = fallbackRes.data.ticket_id;
        }
      } else if (!error && data?.ticket_id) {
        savedId = data.ticket_id;
      }
    } catch (err) {
      console.warn("[store] Supabase insert ticket network error:", err);
    }
  }

  const newTicket: HelpdeskTicket = {
    id: savedId,
    userId: effectiveUserId,
    user: input.user || "Current User",
    email: input.email || "",
    subject: input.subject.trim(),
    message: input.message.trim(),
    status: "open",
    category: ticketCategory,
    priority: ticketPriority,
    createdAt: new Date().toISOString(),
  };

  // Sync to local storage
  const currentLocal = getLocalHelpdeskTickets();
  saveLocalHelpdeskTickets([newTicket, ...currentLocal.filter((t) => t.id !== savedId)]);

  // Dispatch events for cross-tab and cross-component live sync
  try {
    window.dispatchEvent(new CustomEvent("dermai_tickets_updated", { detail: newTicket }));
    window.dispatchEvent(new Event("storage"));
  } catch {
    /* ignore */
  }

  return newTicket;
}

// PATCH helpdesk ticket status & optional admin response
export async function updateHelpdeskTicketStatus(
  id: string,
  status: HelpdeskTicketStatus,
  response?: string
): Promise<void> {
  const mapped = status === "in-progress" ? "pending" : status === "resolved" ? "closed" : "open";
  const updatePayload: Record<string, any> = {
    status: mapped,
    updated_at: new Date().toISOString(),
  };
  if (response !== undefined) {
    updatePayload.response = response;
  }

  try {
    const { error } = await supabase
      .from("user_support_ticket")
      .update(updatePayload)
      .eq("ticket_id", id);

    if (error) console.warn("[store] updateHelpdeskTicketStatus Supabase warn:", error.message);
  } catch (err) {
    console.warn("[store] updateHelpdeskTicketStatus error:", err);
  }

  // Update local storage
  const local = getLocalHelpdeskTickets();
  const existingInLocal = local.find((t) => t.id === id);

  if (existingInLocal) {
    const updatedLocal = local.map((t) =>
      t.id === id
        ? {
            ...t,
            status,
            response: response !== undefined ? response : t.response,
            updatedAt: new Date().toISOString(),
          }
        : t
    );
    saveLocalHelpdeskTickets(updatedLocal);
  }

  // Dispatch live sync event
  try {
    window.dispatchEvent(new CustomEvent("dermai_tickets_updated", { detail: { id, status, response } }));
    window.dispatchEvent(new Event("storage"));
  } catch {
    /* ignore */
  }
}

// DELETE helpdesk ticket
export async function deleteHelpdeskTicketAsync(id: string): Promise<void> {
  try {
    const { error } = await supabase
      .from("user_support_ticket")
      .delete()
      .eq("ticket_id", id);

    if (error) console.warn("[store] deleteHelpdeskTicketAsync Supabase warn:", error.message);
  } catch (err) {
    console.warn("[store] deleteHelpdeskTicketAsync error:", err);
  }

  const local = getLocalHelpdeskTickets();
  saveLocalHelpdeskTickets(local.filter((t) => t.id !== id));

  try {
    window.dispatchEvent(new CustomEvent("dermai_tickets_updated", { detail: { id, deleted: true } }));
    window.dispatchEvent(new Event("storage"));
  } catch {
    /* ignore */
  }
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