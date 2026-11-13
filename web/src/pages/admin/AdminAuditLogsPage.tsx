import { useState, useEffect, useCallback, type ElementType } from "react";
import {
  User,
  CreditCard,
  Building2,
  Settings,
  Scan,
  CalendarDays,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Shield,
  Stethoscope,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AuditEntry, AuditActorType, AuditEntryType } from "@/lib/auditLog";
import { supabase } from "@/lib/supabaseClient";

type ActorFilter = "all" | AuditActorType;

const typeIcon: Record<AuditEntryType, ElementType> = {
  user: User,
  subscription: CreditCard,
  clinic: Building2,
  system: Settings,
  scan: Scan,
  appointment: CalendarDays,
};

const categoryBadgeStyle: Record<AuditEntryType, string> = {
  user: "bg-blue-50 text-blue-700 border-blue-200/80",
  subscription: "bg-emerald-50 text-emerald-700 border-emerald-200/80",
  clinic: "bg-purple-50 text-purple-700 border-purple-200/80",
  system: "bg-slate-100 text-slate-700 border-slate-200/80",
  scan: "bg-amber-50 text-amber-700 border-amber-200/80",
  appointment: "bg-rose-50 text-rose-700 border-rose-200/80",
};

const roleBadgeStyle: Record<AuditActorType, { bg: string; text: string; icon: ElementType }> = {
  admin: { bg: "bg-magenta-50 text-magenta-700 border-magenta-200", text: "Admin", icon: Shield },
  doctor: { bg: "bg-blue-50 text-blue-700 border-blue-200", text: "Doctor", icon: Stethoscope },
  clinic: { bg: "bg-emerald-50 text-emerald-700 border-emerald-200", text: "Clinic", icon: Building2 },
  patient: { bg: "bg-sky-50 text-sky-700 border-sky-200", text: "Patient", icon: User },
  system: { bg: "bg-gray-100 text-gray-700 border-gray-200", text: "System", icon: Settings },
};

function formatTimestamp(iso: string) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * Formatter for doctor management audit entries in the Admin Audit Logs UI.
 * Scoped strictly to:
 * - "Doctor Added"
 * - "Doctor Deactivated"
 * - "Doctor Reactivated"
 *
 * For "Doctor Added", if the stored details say "Clinic added doctor..." and embedded context contains
 * a valid clinicName, formats cleanly as "[Clinic Name] added Dr. [Doctor Name] to its doctor roster."
 * For "Doctor Deactivated" and "Doctor Reactivated", formats cleanly as:
 * "[Clinic Name] deactivated Dr. [Doctor Name] from its doctor roster."
 * "[Clinic Name] reactivated Dr. [Doctor Name] in its doctor roster."
 *
 * For all other audit events or records without sufficient metadata, returns the original details unchanged.
 */
export function formatDoctorAuditDetails(action: string, rawDetails?: string | null, target?: string | null): string {
  if (!rawDetails) return "—";

  const act = (action || "").trim();
  if (act !== "Doctor Added" && act !== "Doctor Deactivated" && act !== "Doctor Reactivated") {
    return rawDetails;
  }

  // Parse embedded Context JSON if present: "... | Context: {...}"
  const contextIdx = rawDetails.indexOf(" | Context: ");
  let contextObj: Record<string, any> | null = null;
  if (contextIdx !== -1) {
    try {
      contextObj = JSON.parse(rawDetails.slice(contextIdx + 12));
    } catch {
      contextObj = null;
    }
  }

  // Doctor Added
  if (act === "Doctor Added") {
    const baseText = contextIdx !== -1 ? rawDetails.slice(0, contextIdx).trim() : rawDetails.trim();
    if (/^[^\s].+ added Dr\..+ to its doctor roster\.?$/i.test(baseText) && !baseText.startsWith("Clinic added")) {
      return baseText;
    }

    const clinicName = contextObj?.clinicName || contextObj?.clinic_name;
    const docRaw = contextObj?.doctorName || contextObj?.doctor_name || (target ? target.replace(/^Dr\.\s*/i, "") : "");
    if (clinicName && docRaw) {
      const cleanDoc = String(docRaw).replace(/^Dr\.\s*/i, "").trim();
      return `${clinicName} added Dr. ${cleanDoc} to its doctor roster.`;
    }

    return baseText || rawDetails;
  }

  // Doctor Deactivated
  if (act === "Doctor Deactivated") {
    const baseText = contextIdx !== -1 ? rawDetails.slice(0, contextIdx).trim() : rawDetails.trim();
    if (/^[^\s].+ deactivated Dr\..+ from its doctor roster\.?$/i.test(baseText) && !baseText.startsWith("Clinic deactivated")) {
      return baseText;
    }
    const clinicName = contextObj?.clinicName || contextObj?.clinic_name;
    const docRaw = contextObj?.doctorName || contextObj?.doctor_name || (target ? target.replace(/^Dr\.\s*/i, "") : "");
    if (clinicName && docRaw) {
      const cleanDoc = String(docRaw).replace(/^Dr\.\s*/i, "").trim();
      return `${clinicName} deactivated Dr. ${cleanDoc} from its doctor roster.`;
    }
    return baseText || rawDetails;
  }

  // Doctor Reactivated
  if (act === "Doctor Reactivated") {
    const baseText = contextIdx !== -1 ? rawDetails.slice(0, contextIdx).trim() : rawDetails.trim();
    if (/^[^\s].+ reactivated Dr\..+ in its doctor roster\.?$/i.test(baseText) && !baseText.startsWith("Clinic reactivated")) {
      return baseText;
    }
    const clinicName = contextObj?.clinicName || contextObj?.clinic_name;
    const docRaw = contextObj?.doctorName || contextObj?.doctor_name || (target ? target.replace(/^Dr\.\s*/i, "") : "");
    if (clinicName && docRaw) {
      const cleanDoc = String(docRaw).replace(/^Dr\.\s*/i, "").trim();
      return `${clinicName} reactivated Dr. ${cleanDoc} in its doctor roster.`;
    }
    return baseText || rawDetails;
  }

  return rawDetails;
}

/**
 * Resolves the display performer for an audit log.
 * In Admin Audit Logs -> Activity Log -> PERFORMED BY, displays ONLY the registered clinic name
 * for clinic-related audit records (e.g. "DERMCARE").
 *
 * Requirements:
 * 1. Dynamically resolve the actual registered clinic name associated with each audit event.
 * 2. Display the clinic name as the primary and only name in the PERFORMED BY column.
 * 3. Keep the existing green CLINIC badge intact.
 * 4. Apply this only to audit events reliably associated with a specific clinic.
 * 5. For historical records or clinic login events where the clinic cannot be reliably identified,
 *    preserve the existing performer display rather than guessing.
 * 6. Do not change the PERFORMED BY display for Patient, Doctor, or Admin records.
 */
export function resolvePerformedBy(
  log: {
    actorType?: AuditActorType | string | null;
    performedBy: string;
    details?: string | null;
    userId?: string | null;
  },
  clinicNameMap?: Map<string, string> | Record<string, string> | null
): string {
  const actor = String(log.actorType || "").toLowerCase().trim();
  if (actor !== "clinic") {
    return log.performedBy;
  }

  const rawDetails = log.details || "";

  // 1. Check embedded Context JSON for clinic name or clinic ID
  if (rawDetails.includes(" | Context: ")) {
    const ctxIdx = rawDetails.indexOf(" | Context: ");
    try {
      const parsed = JSON.parse(rawDetails.slice(ctxIdx + 12));
      if (parsed && typeof parsed === "object") {
        const candidate = parsed.clinicName || parsed.clinic_name || parsed.clinic;
        if (typeof candidate === "string" && candidate.trim()) {
          return candidate.trim();
        }

        const cid = parsed.clinicId || parsed.clinic_id;
        if (cid && clinicNameMap) {
          const mappedName =
            clinicNameMap instanceof Map ? clinicNameMap.get(cid) : (clinicNameMap as Record<string, string>)[cid];
          if (mappedName && mappedName.trim()) {
            return mappedName.trim();
          }
        }
      }
    } catch {
      // Ignore JSON parse error and proceed to fallbacks
    }
  }

  // 2. Check clinic name lookup map by owner/user ID
  if (log.userId && clinicNameMap) {
    const mappedByUid =
      clinicNameMap instanceof Map
        ? clinicNameMap.get(log.userId)
        : (clinicNameMap as Record<string, string>)[log.userId];
    if (mappedByUid && mappedByUid.trim()) {
      return mappedByUid.trim();
    }
  }

  // 3. Check for validated action description prefix, e.g. "DERMCARE added Dr. Alpha..."
  const baseText = rawDetails.includes(" | Context: ")
    ? rawDetails.slice(0, rawDetails.indexOf(" | Context: ")).trim()
    : rawDetails.trim();
  const prefixMatch = baseText.match(/^(.+?)\s+(?:added|deactivated|reactivated)\s+Dr\./i);
  if (prefixMatch && prefixMatch[1]) {
    const candidateClinic = prefixMatch[1].trim();
    if (candidateClinic.toLowerCase() !== "clinic") {
      return candidateClinic;
    }
  }

  // 4. Historical fallback: preserve existing performer display rather than guessing
  return log.performedBy;
}

function getStartOfDayIso(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? `${dateStr}T00:00:00.000Z` : d.toISOString();
}

function getEndOfDayIso(dateStr: string): string {
  const d = new Date(`${dateStr}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? `${dateStr}T23:59:59.999Z` : d.toISOString();
}

const CATEGORIES: AuditEntryType[] = [
  "user",
  "subscription",
  "clinic",
  "scan",
  "appointment",
];

const ACTORS: { key: ActorFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "patient", label: "Patient" },
  { key: "doctor", label: "Doctor" },
  { key: "clinic", label: "Clinic" },
  { key: "admin", label: "Admin" },
];

const PAGE_SIZE = 15;

export default function AdminAuditLogsPage() {
  const [actorFilter, setActorFilter] = useState<ActorFilter>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);

  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [clinicMap, setClinicMap] = useState<Map<string, string>>(new Map());

  // Live count per category for top metric cards
  const [categoryCounts, setCategoryCounts] = useState<Record<AuditEntryType, number>>({
    user: 0,
    subscription: 0,
    clinic: 0,
    system: 0,
    scan: 0,
    appointment: 0,
  });

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Handle actor filter change
  const handleActorChange = (a: ActorFilter) => {
    setActorFilter(a);
    setPage(1);
  };

  // Fetch live category counts by querying Supabase exact counts with date range bounds
  const fetchCategoryCounts = useCallback(async () => {
    try {
      const countsPromises = CATEGORIES.map(async (cat) => {
        let q = supabase
          .from("system_audit_log")
          .select("*", { count: "exact", head: true })
          .eq("log_type", cat)
          .neq("user_type", "system");

        if (fromDate) {
          q = q.gte("timestamp", getStartOfDayIso(fromDate));
        }
        if (toDate) {
          q = q.lte("timestamp", getEndOfDayIso(toDate));
        }

        const { count, error } = await q;
        if (error) return [cat, 0] as const;
        return [cat, count ?? 0] as const;
      });

      const results = await Promise.all(countsPromises);
      const newCounts = Object.fromEntries(results) as Record<AuditEntryType, number>;
      setCategoryCounts(newCounts);
    } catch (err) {
      console.warn("[AdminAuditLogs] Failed to fetch category counts:", err);
    }
  }, [fromDate, toDate]);

  // Fetch filtered & paginated audit logs from live Supabase database
  const fetchLogs = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      let query = supabase
        .from("system_audit_log")
        .select(
          "log_id, action, user_type, log_type, target, details, performer_name, timestamp, user_id, user:user_id ( full_name, email, role )",
          { count: "exact" }
        )
        .order("timestamp", { ascending: false });

      // Exclude system logs
      query = query.neq("user_type", "system").neq("log_type", "system");

      // Apply actor filter across Patient, Doctor, Clinic, Admin
      if (actorFilter !== "all") {
        query = query.eq("user_type", actorFilter);
      }

      // Apply date range bounds on timestamp column
      if (fromDate) {
        query = query.gte("timestamp", getStartOfDayIso(fromDate));
      }
      if (toDate) {
        query = query.lte("timestamp", getEndOfDayIso(toDate));
      }

      // Apply search query across action, target, details, and performer_name
      if (debouncedSearch) {
        query = query.or(
          `action.ilike.%${debouncedSearch}%,target.ilike.%${debouncedSearch}%,details.ilike.%${debouncedSearch}%,performer_name.ilike.%${debouncedSearch}%`
        );
      }

      // Server-side paginated fetching
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      query = query.range(from, to);

      const { data, count, error } = await query;

      if (error) {
        console.error("[AdminAuditLogs] Query error:", error.message);
        setLogs([]);
        setTotalCount(0);
        return;
      }

      // Dynamically resolve registered clinic names for clinic audit records
      const clinicUserIds = new Set<string>();
      const contextClinicIds = new Set<string>();

      (data || []).forEach((l: any) => {
        if (l.user_type === "clinic" && l.user_id) {
          clinicUserIds.add(String(l.user_id));
        }
        if (l.details && typeof l.details === "string" && l.details.includes("Context:")) {
          try {
            const ctxIdx = l.details.indexOf(" | Context: ");
            if (ctxIdx !== -1) {
              const ctx = JSON.parse(l.details.slice(ctxIdx + 12));
              if (ctx?.clinicId) contextClinicIds.add(String(ctx.clinicId));
              if (ctx?.clinic_id) contextClinicIds.add(String(ctx.clinic_id));
            }
          } catch {}
        }
      });

      const pageClinicMap = new Map<string, string>();
      if (clinicUserIds.size > 0 || contextClinicIds.size > 0) {
        try {
          const orFilters: string[] = [];
          if (clinicUserIds.size > 0) {
            orFilters.push(`owner_user_id.in.(${Array.from(clinicUserIds).join(",")})`);
          }
          if (contextClinicIds.size > 0) {
            orFilters.push(`clinic_id.in.(${Array.from(contextClinicIds).join(",")})`);
          }
          let clinicQuery = supabase.from("clinic").select("clinic_id, name, owner_user_id");
          if (orFilters.length > 0) {
            clinicQuery = clinicQuery.or(orFilters.join(","));
          }
          const { data: clinicData, error: clinicErr } = await clinicQuery;
          if (!clinicErr && clinicData) {
            clinicData.forEach((c: any) => {
              if (c?.name) {
                const trimmed = String(c.name).trim();
                if (c.clinic_id) pageClinicMap.set(String(c.clinic_id), trimmed);
                if (c.owner_user_id) pageClinicMap.set(String(c.owner_user_id), trimmed);
              }
            });
            setClinicMap((prev) => new Map([...prev, ...pageClinicMap]));
          }
        } catch (lookupErr) {
          console.warn("[AdminAuditLogs] Clinic name resolution warning:", lookupErr);
        }
      }

      const mapped: AuditEntry[] = (data || [])
        .filter(
          (l: any) =>
            l.user_type !== "system" &&
            l.log_type !== "system" &&
            !String(l.action || "").toLowerCase().includes("system initialization")
        )
        .map((l: any) => {
          const userObj = Array.isArray(l.user) ? l.user[0] : l.user;
          const fallbackPerformer =
            l.performer_name || userObj?.full_name || userObj?.email || (l.user_type === "system" ? "System Core" : "User");

          const resolvedPerformer = resolvePerformedBy(
            {
              actorType: (l.user_type as AuditActorType) || (userObj?.role as AuditActorType),
              performedBy: fallbackPerformer,
              details: l.details,
              userId: l.user_id,
            },
            pageClinicMap
          );

          return {
            id: l.log_id,
            type: (l.log_type || "system") as AuditEntryType,
            action: l.action || "Action",
            target: l.target || userObj?.full_name || l.user_type || "System Core",
            details: l.details || "",
            performedBy: resolvedPerformer,
            actorType: (l.user_type as AuditActorType) || (userObj?.role as AuditActorType) || "system",
            timestamp: l.timestamp || new Date().toISOString(),
            userId: l.user_id || null,
          };
        });

      setLogs(mapped);
      setTotalCount(count ?? 0);
    } catch (err) {
      console.error("[AdminAuditLogs] Unexpected error loading logs:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [actorFilter, debouncedSearch, page, fromDate, toDate]);

  // Initial and reactive data load
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    fetchCategoryCounts();
  }, [fetchCategoryCounts]);

  // Real-time listener for live INSERT events on system_audit_log
  useEffect(() => {
    const channel = supabase
      .channel("admin_audit_logs_realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "system_audit_log",
        },
        async (payload) => {
          const newRecord = payload.new as any;
          if (!newRecord) return;
          if (newRecord.user_type === "system" || newRecord.log_type === "system") return;

          // Check if new record matches current actor filter
          const matchesActor =
            actorFilter === "all" || newRecord.user_type === actorFilter;

          // Check if new record matches active date range bounds
          const logTime = new Date(newRecord.timestamp).getTime();
          const matchesFrom = !fromDate || logTime >= new Date(`${fromDate}T00:00:00`).getTime();
          const matchesTo = !toDate || logTime <= new Date(`${toDate}T23:59:59.999`).getTime();
          const matchesDate = matchesFrom && matchesTo;

          // Extract performer display name
          let performerName = newRecord.performer_name;
          if (!performerName && newRecord.user_id) {
            try {
              const { data: u } = await supabase
                .from("users")
                .select("full_name, email, role")
                .eq("user_id", newRecord.user_id)
                .maybeSingle();
              if (u) {
                performerName = u.full_name || u.email;
              }
            } catch (err) {
              console.warn("Failed to fetch performer details:", err);
            }
          }
          if (!performerName) {
            performerName = newRecord.user_type === "system" ? "System Core" : "User";
          }

          const resolvedPerformer = resolvePerformedBy(
            {
              actorType: newRecord.user_type,
              performedBy: performerName,
              details: newRecord.details,
              userId: newRecord.user_id,
            },
            clinicMap
          );

          const newEntry: AuditEntry = {
            id: newRecord.log_id || `log-${Date.now()}`,
            type: (newRecord.log_type || "system") as AuditEntryType,
            action: newRecord.action || "Action",
            target: newRecord.target || "System Core",
            details: newRecord.details || "",
            performedBy: resolvedPerformer,
            actorType: (newRecord.user_type as AuditActorType) || "system",
            timestamp: newRecord.timestamp || new Date().toISOString(),
            userId: newRecord.user_id || null,
          };

          // Immediately prepend to audit log table if matching actor and date filters
          if (matchesActor && matchesDate) {
            setLogs((prev) => [newEntry, ...prev.filter((item) => item.id !== newEntry.id)]);
            setTotalCount((c) => c + 1);
          }

          // Immediately update category count if matching date filters
          const cat = newRecord.log_type as AuditEntryType;
          if (cat && CATEGORIES.includes(cat) && matchesDate) {
            setCategoryCounts((prev) => ({
              ...prev,
              [cat]: (prev[cat] || 0) + 1,
            }));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [actorFilter, fromDate, toDate]);

  const handleManualRefresh = () => {
    fetchLogs(true);
    fetchCategoryCounts();
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="space-y-8 w-full max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-display font-bold text-black">Audit Logs</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live Supabase Real-time
            </span>
          </div>
          <p className="text-sm text-gray-600 mt-1">
            Activity recorded across admins, patients, clinics, and doctors.
          </p>
        </div>

        <button
          type="button"
          onClick={handleManualRefresh}
          disabled={loading || refreshing}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:text-black transition-all cursor-pointer shadow-xs disabled:opacity-50"
          title="Refresh audit logs"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin text-magenta-600")} />
          <span>{refreshing ? "Refreshing..." : "Refresh Logs"}</span>
        </button>
      </div>

      {/* Category Metric Cards (Live dynamic count from Supabase filtered by date range) */}
      <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-5 gap-4 sm:gap-6 w-full max-w-full">
        {CATEGORIES.map((type) => {
          const Icon = typeIcon[type];
          const count = categoryCounts[type] ?? 0;
          return (
            <div
              key={type}
              className="bg-white rounded-xl border border-gray-200 shadow-xs p-5 sm:p-6 min-h-[140px] flex flex-col justify-between hover:border-gray-300 transition-colors"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-black capitalize">{type}</p>
                <div className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center">
                  <Icon className="w-4 h-4 text-magenta-600" />
                </div>
              </div>
              <div className="mt-3">
                <p className="text-3xl sm:text-4xl font-bold text-black tabular-nums tracking-tight">
                  {count.toLocaleString()}
                </p>
                <p className="mt-1 text-xs text-gray-500 font-medium">
                  {fromDate || toDate ? "filtered entries" : "live log entries"}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filter and Search Bar with Date Pickers */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs p-5 sm:p-6 space-y-5 w-full max-w-full">
        {/* Date Pickers Row (Matched to Reports page design) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-xs sm:text-sm font-medium text-black mb-1.5">
              From date <span className="text-xs font-normal text-gray-500">(Optional)</span>
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPage(1);
              }}
              className="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 text-xs sm:text-sm text-black outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/15 bg-white transition-all shadow-2xs"
            />
          </div>

          <div>
            <label className="block text-xs sm:text-sm font-medium text-black mb-1.5">
              To date <span className="text-xs font-normal text-gray-500">(Optional)</span>
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPage(1);
              }}
              className="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 text-xs sm:text-sm text-black outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/15 bg-white transition-all shadow-2xs"
            />
          </div>

          {(fromDate || toDate) && (
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => {
                  setFromDate("");
                  setToDate("");
                  setPage(1);
                }}
                className="px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-xs sm:text-sm font-semibold text-black hover:bg-gray-50 transition-colors cursor-pointer shadow-2xs"
              >
                Clear dates
              </button>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-gray-100" />

        {/* 'Performed by' and Search Row */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* 'Performed by' Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs sm:text-sm font-semibold text-black mr-1 uppercase tracking-wider">
              Performed by:
            </span>
            {ACTORS.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => handleActorChange(a.key)}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold capitalize transition-all cursor-pointer shadow-2xs",
                  actorFilter === a.key
                    ? "bg-magenta-600 text-white shadow-xs"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200 hover:text-black"
                )}
              >
                {a.label}
              </button>
            ))}
          </div>

          {/* Search Input with Icon */}
          <div className="relative w-full lg:w-80">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search action, target, performer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 bg-white text-xs sm:text-sm text-black placeholder:text-gray-400 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/15 transition-all shadow-2xs"
            />
          </div>
        </div>
      </div>

      {/* Logs Table with Live Data */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden w-full max-w-full">
        <div className="px-6 py-4.5 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-base font-bold text-black tracking-tight">Activity Log</h2>
          <span className="text-xs sm:text-sm text-gray-500 font-medium">
            {totalCount.toLocaleString()} total recorded {totalCount === 1 ? "event" : "events"}
            {(fromDate || toDate) && (
              <span className="ml-1 text-magenta-600 font-semibold">
                (in selected date range)
              </span>
            )}
          </span>
        </div>

        {loading ? (
          <div className="px-7 py-20 text-center">
            <RefreshCw className="w-6 h-6 text-magenta-600 animate-spin mx-auto mb-3" />
            <p className="text-xs text-gray-400 font-medium">Querying live audit trail from Supabase...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="px-7 py-16 text-center text-sm text-gray-500">
            <p className="font-semibold text-gray-700">No log entries found.</p>
            <p className="text-xs text-gray-400 mt-1">
              {debouncedSearch || actorFilter !== "all" || fromDate || toDate
                ? "Try adjusting your search query, actor filter, or date range."
                : "Real user lifecycle events (logins, bookings, consults) will appear here in real time."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto w-full max-w-full">
            <table className="w-full text-black min-w-[850px]">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-200 text-left text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                  <th className="px-6 py-3.5 whitespace-nowrap">Timestamp</th>
                  <th className="px-6 py-3.5 whitespace-nowrap">Category</th>
                  <th className="px-6 py-3.5 whitespace-nowrap">Action</th>
                  <th className="px-6 py-3.5 whitespace-nowrap">Target</th>
                  <th className="px-6 py-3.5 whitespace-nowrap">Details</th>
                  <th className="px-6 py-3.5 whitespace-nowrap">Performed by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map((log) => {
                  const roleMeta = roleBadgeStyle[log.actorType] || roleBadgeStyle.system;
                  const RoleIcon = roleMeta.icon;
                  const badgeColor = categoryBadgeStyle[log.type] || categoryBadgeStyle.system;

                  return (
                    <tr key={log.id} className="hover:bg-gray-50/70 transition-colors">
                      {/* Timestamp */}
                      <td className="px-6 py-4 text-xs text-gray-600 whitespace-nowrap font-medium">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <span>{formatTimestamp(log.timestamp)}</span>
                        </div>
                      </td>

                      {/* Category Badge */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={cn(
                            "inline-flex items-center px-2.5 py-1 rounded-full border text-[11px] font-bold capitalize shadow-2xs",
                            badgeColor
                          )}
                        >
                          {log.type}
                        </span>
                      </td>

                      {/* Action */}
                      <td className="px-6 py-4 text-sm font-bold text-slate-900 tracking-tight whitespace-nowrap">
                        {log.action}
                      </td>

                      {/* Target */}
                      <td className="px-6 py-4 text-xs sm:text-sm text-slate-800 font-medium">
                        <span className="inline-block max-w-[200px] truncate" title={log.target}>
                          {log.target}
                        </span>
                      </td>

                      {/* Details */}
                      <td className="px-6 py-4 text-xs sm:text-sm text-gray-600 max-w-sm break-words leading-relaxed">
                        {formatDoctorAuditDetails(log.action, log.details, log.target)}
                      </td>

                      {/* Performed by & Role */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <p className="text-xs sm:text-sm font-bold text-slate-900 tracking-tight">
                          {resolvePerformedBy(log, clinicMap)}
                        </p>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider",
                            roleMeta.bg
                          )}
                        >
                          <RoleIcon className="w-3 h-3" />
                          <span>{roleMeta.text}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Server-side Pagination Footer - Shown whenever total records exceed PAGE_SIZE */}
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50/50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs sm:text-sm text-gray-600">
            <div>
              Showing <span className="font-bold text-black">{(page - 1) * PAGE_SIZE + 1}</span> to{" "}
              <span className="font-bold text-black">{Math.min(page * PAGE_SIZE, totalCount)}</span> of{" "}
              <span className="font-bold text-black">{totalCount.toLocaleString()}</span> entries
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 bg-white font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-2xs cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Previous</span>
              </button>

              <span className="px-3 py-1 font-bold text-slate-900">
                {page} / {totalPages}
              </span>

              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 bg-white font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-2xs cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
