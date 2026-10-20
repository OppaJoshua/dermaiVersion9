// Data layer — all functions now call Supabase directly.
// Stub bodies have been replaced with real queries.

import { supabase } from "./supabaseClient";
import { withCacheBuster } from "./doctorAvatarService";
import { logAuditEvent } from "@/utils/auditLogger";

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
  billingType: "monthly" | "yearly";
  description: string;
  features: string[];
  scanLimit: number | null;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

// GET /plan (public read — no auth required)
export async function getSubscriptionPlansAsync(
  includeInactive = false
): Promise<SubscriptionPlan[]> {
  let query = supabase
    .from("plan")
    .select(`
      plan_id,
      name,
      description,
      price,
      billing_type,
      scan_limit,
      status,
      description,
      plan_feature (
        feature_id,
        feature_text,
        plan_id
      )
    `)
    .order("price");

  if (!includeInactive) {
    query = query
      .eq("status", "active")
      .gt("price", 0);
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
    description: p.description ?? (p.scan_limit === -1 ? "Unlimited skin scans" : `${p.scan_limit} free skin scan${p.scan_limit !== 1 ? "s" : ""}`),
    features: (p.plan_feature ?? [])
      .map((f: any) => f.feature_text)
      .filter(Boolean),
    scanLimit: p.scan_limit === -1 ? null : p.scan_limit,
    status: p.status as "active" | "inactive",
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
  else {
    logAuditEvent({
      role: "admin",
      category: "Scan",
      action: "AI Scan Status Updated",
      target: `Scan #${id.slice(0, 8)}`,
      details: `Scan status updated to "${status}".`,
      metadata: { scanId: id, status },
    }).catch(() => {});
  }
}

export type HelpdeskTicketStatus =
  | "pending"
  | "open"
  | "in_progress"
  | "resolved"
  | "in-progress"
  | "closed";

export type HelpdeskTicket = {
  id: string;
  userId?: string;
  user: string;
  email: string;
  avatarUrl?: string;
  subject: string;
  message: string;
  status: HelpdeskTicketStatus;
  category: string;
  priority: "low" | "medium" | "high" | "urgent";
  response?: string;
  resolvedAt?: string;
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
    return parsed.map((t: any) => {
      const rawStatus = (t.status || "pending").toLowerCase();
      let status: HelpdeskTicketStatus = "pending";
      if (rawStatus === "open") status = "open";
      else if (rawStatus === "in_progress" || rawStatus === "in-progress") status = "in_progress";
      else if (rawStatus === "resolved" || rawStatus === "closed") status = "resolved";
      else status = "pending";

      return {
        id: t.id || t.ticket_id || `TKT-${Date.now().toString().slice(-6)}`,
        userId: t.userId || t.user_id,
        user: t.user || t.full_name || t.userName || "Platform User",
        email: t.email || "",
        avatarUrl: t.avatarUrl || t.avatar_url || undefined,
        subject: t.subject || "Support Inquiry",
        message: t.message || "",
        status,
        category: t.category || "General Support",
        priority: t.priority || "medium",
        response: t.response || undefined,
        resolvedAt: t.resolvedAt || t.resolved_at || undefined,
        createdAt: t.createdAt || t.created_at || new Date().toISOString(),
        updatedAt: t.updatedAt || t.updated_at || undefined,
      };
    });
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
export async function getHelpdeskTicketsAsync(userId?: string, options?: { requireDatabase?: boolean }): Promise<HelpdeskTicket[]> {
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
      const userIds = Array.from(new Set(data.map((t: any) => t.user_id).filter(Boolean))) as string[];
      const userMap = new Map<string, { full_name: string; email: string; role?: string; avatar_url?: string }>();
      const doctorPhotoMap = new Map<string, string>(); // user_id or lower(email) -> photo_url
      const clinicLogoMap = new Map<string, string>(); // owner_user_id or lower(email) -> logo_url

      if (userIds.length > 0) {
        try {
          const { data: usersData } = await supabase
            .from("user")
            .select("user_id, full_name, email, role, avatar_url")
            .in("user_id", userIds);

          if (usersData) {
            usersData.forEach((u: any) => {
              userMap.set(u.user_id, {
                full_name: u.full_name || "Platform User",
                email: u.email || "",
                role: u.role || undefined,
                avatar_url: u.avatar_url || undefined,
              });
            });
          }
        } catch {
          /* ignore */
        }
      }

      // Query clinic_doctor to fetch doctor photo_url
      try {
        const { data: docsData } = await supabase
          .from("clinic_doctor")
          .select("doctor_id, user_id, email, photo_url");

        if (docsData) {
          docsData.forEach((d: any) => {
            if (d.photo_url) {
              if (d.user_id) doctorPhotoMap.set(d.user_id, d.photo_url);
              if (d.email) doctorPhotoMap.set(d.email.toLowerCase().trim(), d.photo_url);
            }
          });
        }
      } catch {
        /* ignore */
      }

      // Query clinic to fetch clinic logo_url
      try {
        const { data: clinicsData } = await supabase
          .from("clinic")
          .select("clinic_id, owner_user_id, email, logo_url");

        if (clinicsData) {
          clinicsData.forEach((c: any) => {
            if (c.logo_url) {
              if (c.owner_user_id) clinicLogoMap.set(c.owner_user_id, c.logo_url);
              if (c.email) clinicLogoMap.set(c.email.toLowerCase().trim(), c.logo_url);
            }
          });
        }
      } catch {
        /* ignore */
      }

      dbTickets = data.map((t: any) => {
        const userInfo = userMap.get(t.user_id);
        const rawStatus = (t.status || "pending").toLowerCase();
        const localMatch = localTickets.find(
          (lt) => lt.id === (t.ticket_id || t.id)
        );

        let mappedStatus: HelpdeskTicketStatus = "pending";
        if (rawStatus === "open") {
          // If legacy DB stored 'open' but ticket was updated to 'in_progress'
          if (localMatch?.status === "in_progress") {
            mappedStatus = "in_progress";
          } else {
            mappedStatus = "open";
          }
        } else if (rawStatus === "in_progress" || rawStatus === "in-progress") {
          mappedStatus = "in_progress";
        } else if (rawStatus === "resolved" || rawStatus === "closed") {
          mappedStatus = "resolved";
        } else {
          mappedStatus = "pending";
        }

        const userEmail = (userInfo?.email || t.email || "").toLowerCase().trim();
        const userRole = userInfo?.role;
        const category = t.category || "General Support";

        // Resolve avatar URL with priority hierarchy
        const docPhoto = (t.user_id && doctorPhotoMap.get(t.user_id)) || (userEmail ? doctorPhotoMap.get(userEmail) : undefined);
        const clLogo = (t.user_id && clinicLogoMap.get(t.user_id)) || (userEmail ? clinicLogoMap.get(userEmail) : undefined);
        const uAvatar = userInfo?.avatar_url || t.avatarUrl || t.avatar_url;

        let resolvedAvatar: string | undefined = undefined;
        if (category.toLowerCase().includes("doctor") || userRole === "doctor") {
          resolvedAvatar = docPhoto || uAvatar;
        } else if (category.toLowerCase().includes("clinic") || userRole === "clinic") {
          resolvedAvatar = clLogo || uAvatar;
        } else {
          resolvedAvatar = uAvatar || docPhoto || clLogo;
        }

        if (resolvedAvatar) {
          resolvedAvatar = withCacheBuster(resolvedAvatar);
        }

        const effectiveResponse = t.response || localMatch?.response || undefined;

        return {
          id: t.ticket_id || t.id,
          userId: t.user_id,
          user: userInfo?.full_name || t.user_name || t.user || "Platform User",
          email: userInfo?.email || t.email || "",
          avatarUrl: resolvedAvatar || undefined,
          subject: t.subject || "Support Inquiry",
          message: t.message || "",
          status: mappedStatus,
          category,
          priority: (t.priority as any) || "medium",
          response: effectiveResponse,
          resolvedAt: t.resolved_at || t.resolvedAt || localMatch?.resolvedAt || undefined,
          createdAt: t.created_at || t.createdAt || new Date().toISOString(),
          updatedAt: t.updated_at || t.updatedAt || undefined,
        };
      });
    } else if (error) {
      if (options?.requireDatabase) throw error;
      console.warn("[store] getHelpdeskTicketsAsync query warning:", error.message);
    }
  } catch (err) {
    if (options?.requireDatabase) throw err;
    console.warn("[store] getHelpdeskTicketsAsync network error:", err);
  }

  if (options?.requireDatabase) return dbTickets;

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
  avatarUrl?: string;
  subject: string;
  message: string;
  category?: string;
  priority?: "low" | "medium" | "high" | "urgent";
}): Promise<HelpdeskTicket> {
  const subject = input.subject.trim();
  const message = input.message.trim();

  if (!subject || !message) {
    throw new Error("Please enter both a subject and a message.");
  }

  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError) {
    throw new Error("Unable to verify your sign-in. Please try again.");
  }

  const sessionUserId = sessionData.session?.user?.id;
  const effectiveUserId = sessionUserId || input.userId;

  if (!effectiveUserId) {
    throw new Error("Please sign in again before submitting a support ticket.");
  }

  if (sessionUserId && input.userId && sessionUserId !== input.userId) {
    throw new Error("The signed-in account does not match the ticket account.");
  }

  const ticketCategory = input.category || "General Support";
  const ticketPriority = input.priority || "medium";

  const { data, error } = await supabase
    .from("user_support_ticket")
    .insert({
      user_id: effectiveUserId,
      subject,
      message,
      status: "pending",
      category: ticketCategory,
      priority: ticketPriority,
    })
    .select("ticket_id, created_at, updated_at")
    .single();

  if (error) {
    console.error("[store] Failed to create helpdesk ticket:", error.message);
    throw new Error("Your ticket could not be submitted. Please try again.");
  }

  if (!data?.ticket_id) {
    throw new Error("The database did not confirm the ticket. Please check your tickets before retrying.");
  }

  const newTicket: HelpdeskTicket = {
    id: data.ticket_id,
    userId: effectiveUserId,
    user: input.user || "Current User",
    email: input.email || "",
    avatarUrl: input.avatarUrl,
    subject,
    message,
    status: "pending",
    category: ticketCategory,
    priority: ticketPriority,
    createdAt: data.created_at || new Date().toISOString(),
    updatedAt: data.updated_at || undefined,
  };

  const currentLocal = getLocalHelpdeskTickets();
  saveLocalHelpdeskTickets([
    newTicket,
    ...currentLocal.filter((ticket) => ticket.id !== newTicket.id),
  ]);

  try {
    window.dispatchEvent(
      new CustomEvent("dermai_tickets_updated", { detail: newTicket })
    );
    window.dispatchEvent(new Event("storage"));
  } catch {
    /* Ignore local event-dispatch errors. */
  }

  logAuditEvent({
    userId: effectiveUserId,
    category: "System",
    action: "Support Ticket Created",
    target: `Ticket #${data.ticket_id.slice(0, 8)}: ${subject}`,
    details: `${input.user || "User"} (${input.email || "N/A"}) submitted ticket: "${subject}" [${ticketCategory}].`,
    performerName: input.user || "User",
    metadata: {
      ticketId: data.ticket_id,
      category: ticketCategory,
      priority: ticketPriority,
    },
  }).catch(() => {});

  return newTicket;
}
// PATCH helpdesk ticket status & optional admin response
export async function updateHelpdeskTicketStatus(
  id: string,
  status: HelpdeskTicketStatus,
  response?: string,
  options?: {
    ticketSubject?: string;
    ticketUserId?: string;
    previousStatus?: HelpdeskTicketStatus;
  }
): Promise<void> {
  const normalizedStatus =
    status === "in_progress" || status === "in-progress"
      ? "in_progress"
      : status === "resolved" || status === "closed"
      ? "resolved"
      : status === "pending"
      ? "pending"
      : "open";

  const updatePayload: Record<string, any> = {
    status: normalizedStatus,
    updated_at: new Date().toISOString(),
  };

  if (response !== undefined) {
    updatePayload.response = response;
  }

  if (normalizedStatus === "resolved") {
    updatePayload.resolved_at = new Date().toISOString();
  }

  // Attempt update with resolved_at (if resolved)
  let { data, error } = await supabase
    .from("user_support_ticket")
    .update(updatePayload)
    .eq("ticket_id", id)
    .select("ticket_id, user_id, subject, status, response")
    .maybeSingle();

  // If resolved_at column does not exist in remote DB, gracefully retry without resolved_at
  if (error && (error.message?.includes("resolved_at") || (error as any).code === "42703")) {
    delete updatePayload.resolved_at;
    const retryRes = await supabase
      .from("user_support_ticket")
      .update(updatePayload)
      .eq("ticket_id", id)
      .select("ticket_id, user_id, subject, status, response")
      .maybeSingle();
    data = retryRes.data;
    error = retryRes.error;
  }

  // If check constraint rejected 'in_progress' or 'resolved' (legacy schema: check (status in ('open','pending','closed')))
  if (
    error &&
    (error.message?.includes("user_support_ticket_status_check") ||
      (error as any).code === "23514")
  ) {
    const fallbackDbStatus = normalizedStatus === "resolved" ? "closed" : "open";
    const fallbackPayload: Record<string, any> = {
      status: fallbackDbStatus,
      updated_at: new Date().toISOString(),
    };
    if (response !== undefined) {
      fallbackPayload.response = response;
    }

    const fallbackRes = await supabase
      .from("user_support_ticket")
      .update(fallbackPayload)
      .eq("ticket_id", id)
      .select("ticket_id, user_id, subject, status, response")
      .maybeSingle();

    if (!fallbackRes.error) {
      data = fallbackRes.data ? { ...fallbackRes.data, status: normalizedStatus } : null;
      error = null;
    }
  }

  if (error) {
    throw new Error(`Unable to update support ticket: ${error.message}`);
  }

  if (!data) {
    const probeRes = await supabase
      .from("user_support_ticket")
      .select("ticket_id, user_id, subject, status, response")
      .eq("ticket_id", id)
      .maybeSingle();

    if (probeRes.data) {
      data = { ...probeRes.data, status: normalizedStatus };
    } else {
      data = {
        ticket_id: id,
        user_id: options?.ticketUserId,
        subject: options?.ticketSubject || "Support Ticket",
        status: normalizedStatus,
        response,
      };
    }
  }

  const recipientUserId = data.user_id || options?.ticketUserId;
  const ticketSubject = data.subject || options?.ticketSubject || "Support Ticket";

  // Central audit log: action: 'Ticket Status Updated', category: 'System', target: 'Ticket #' + ticket_id, details: 'Status changed to ' + newStatus
  logAuditEvent({
    role: "admin",
    category: "System",
    action: "Ticket Status Updated",
    target: `Ticket #${id}`,
    details: `Status changed to ${normalizedStatus}`,
    metadata: {
      ticketId: id,
      newStatus: normalizedStatus,
      hasResponse: Boolean(response),
    },
  }).catch(() => {});

  // Real-Time Patient Notification Trigger (Requirement 3)
  if (recipientUserId) {
    try {
      const prev = options?.previousStatus;
      const isStatusTransition = !prev || prev !== normalizedStatus;

      if (normalizedStatus === "in_progress" && isStatusTransition) {
        const notifPayload = {
          user_id: recipientUserId,
          type: "support_ticket",
          subtype: "ticket_in_progress",
          title: "Support Ticket In Progress",
          body: `Your support ticket regarding "${ticketSubject}" is now being reviewed by our support team.`,
          is_read: false,
        };
        const { error: notifErr } = await supabase.from("user_notification").insert({
          ...notifPayload,
          metadata: { ticket_id: id, status: "in_progress" },
        });
        if (
          notifErr &&
          (notifErr.message?.includes("metadata") || (notifErr as any).code === "42703")
        ) {
          await supabase.from("user_notification").insert(notifPayload);
        }
      } else if (normalizedStatus === "resolved" && (isStatusTransition || response)) {
        const respPreview = response ? ` Response: ${response}` : "";
        const notifPayload = {
          user_id: recipientUserId,
          type: "support_ticket",
          subtype: "ticket_resolved",
          title: "Support Ticket Resolved",
          body: `Your support ticket regarding "${ticketSubject}" has been resolved.${respPreview}`,
          is_read: false,
        };
        const { error: notifErr } = await supabase.from("user_notification").insert({
          ...notifPayload,
          metadata: { ticket_id: id, status: "resolved" },
        });
        if (
          notifErr &&
          (notifErr.message?.includes("metadata") || (notifErr as any).code === "42703")
        ) {
          await supabase.from("user_notification").insert(notifPayload);
        }
      }
    } catch (notifErr) {
      console.warn("[store] Notification dispatch warning:", notifErr);
    }
  }

  // Update local storage so that status and responses are immediately reflected
  const local = getLocalHelpdeskTickets();
  const existingInLocal = local.find((ticket) => ticket.id === id);

  if (existingInLocal) {
    saveLocalHelpdeskTickets(
      local.map((ticket) =>
        ticket.id === id
          ? {
              ...ticket,
              status: normalizedStatus as HelpdeskTicketStatus,
              response: response !== undefined ? response : ticket.response,
              updatedAt: new Date().toISOString(),
            }
          : ticket
      )
    );
  } else {
    saveLocalHelpdeskTickets([
      {
        id,
        userId: recipientUserId || "",
        user: options?.ticketUserId || "Platform User",
        email: "",
        subject: ticketSubject,
        message: "",
        status: normalizedStatus as HelpdeskTicketStatus,
        category: "General Support",
        priority: "medium",
        response,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      ...local,
    ]);
  }

  try {
    window.dispatchEvent(new CustomEvent("dermai_notifications_updated"));
    window.dispatchEvent(
      new CustomEvent("dermai_tickets_updated", {
        detail: { id, status: normalizedStatus, response },
      })
    );
    window.dispatchEvent(new Event("storage"));
  } catch {
    /* Ignore local event-dispatch errors. */
  }
}

// DELETE helpdesk ticket
export async function deleteHelpdeskTicketAsync(id: string): Promise<void> {
  const { data, error } = await supabase
    .from("user_support_ticket")
    .delete()
    .eq("ticket_id", id)
    .select("ticket_id")
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to delete support ticket: ${error.message}`);
  }

  if (!data) {
    throw new Error(
      "No support ticket was deleted. It may already be deleted, or you may not have permission."
    );
  }

  // Remove local data only after the database confirms deletion.
  const local = getLocalHelpdeskTickets();
  saveLocalHelpdeskTickets(local.filter((ticket) => ticket.id !== id));

  try {
    window.dispatchEvent(
      new CustomEvent("dermai_tickets_updated", {
        detail: { id, deleted: true },
      })
    );
    window.dispatchEvent(new Event("storage"));
  } catch {
    /* Ignore local event-dispatch errors. */
  }
}

// Upsert subscription plan (admin only)
export async function upsertSubscriptionPlan(plan: SubscriptionPlan): Promise<void> {
  const isNew = !plan.id || plan.id.startsWith("plan-");

  const planData: Record<string, any> = {
    name: plan.name,
    price: plan.price,
    billing_type: plan.billingType,
    scan_limit: plan.scanLimit === null ? -1 : plan.scanLimit,
    status: plan.status,
    description: plan.description,
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
    console.error("[store] upsertSubscriptionPlan - plan:", error);
    throw new Error(`Failed to save subscription plan: ${error.message}`);
  }

  const savedPlanId = data?.plan_id || (isNew ? null : plan.id);

  if (savedPlanId && plan.features) {
    const { error: deleteError } = await supabase
      .from("plan_feature")
      .delete()
      .eq("plan_id", savedPlanId);

    if (deleteError) {
      console.error(
        "[store] upsertSubscriptionPlan - delete features:",
        deleteError
      );
      throw new Error(
        `Plan was saved, but existing features could not be updated: ${deleteError.message}`
      );
    }

    if (plan.features.length > 0) {
      const { error: insertError } = await supabase
        .from("plan_feature")
        .insert(
          plan.features.map((f) => ({
            plan_id: savedPlanId,
            feature_text: f,
          }))
        );

      if (insertError) {
        console.error(
          "[store] upsertSubscriptionPlan - insert features:",
          insertError
        );
        throw new Error(
          `Plan was saved, but features could not be updated: ${insertError.message}`
        );
      }
    }
  }

  logAuditEvent({
    role: "admin",
    category: "Subscription",
    action: isNew ? "Subscription Plan Created" : "Subscription Plan Modified",
    target: `Plan: ${plan.name}`,
    details: `Subscription tier "${plan.name}" (₱${plan.price}/${plan.billingType}) ${isNew ? "created" : "modified"}.`,
    metadata: {
      planId: savedPlanId,
      name: plan.name,
      price: plan.price,
      billingType: plan.billingType,
    },
  }).catch(() => {});
}

// Delete subscription plan (admin only)
export async function deleteSubscriptionPlan(id: string): Promise<void> {
  const { error } = await supabase.from("plan").delete().eq("plan_id", id);
  if (error) console.error("[store] deleteSubscriptionPlan:", error.message);
  else {
    logAuditEvent({
      role: "admin",
      category: "Subscription",
      action: "Subscription Plan Deleted",
      target: `Plan ID: ${id}`,
      details: `Subscription plan ${id} was deleted by admin.`,
      metadata: { planId: id },
    }).catch(() => {});
  }
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