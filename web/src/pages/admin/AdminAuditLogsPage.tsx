import { useMemo, useState, useEffect, type ElementType } from "react";
import { User, CreditCard, Building2, Settings, Scan, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AuditEntry } from "@/lib/auditLog";
import { supabase } from "@/lib/supabaseClient";

type ActorFilter = "all" | "admin" | "patient" | "clinic" | "system";

const seedLogs: AuditEntry[] = [
  {
    id: "log-1",
    action: "System Initialization",
    target: "System Core",
    performedBy: "Admin",
    actorType: "admin",
    details: "Database schema migration and user auth tables established.",
    type: "system",
    timestamp: new Date().toISOString(),
  },
  {
    id: "log-2",
    action: "User Authentication",
    target: "Admin Portal",
    performedBy: "Admin",
    actorType: "admin",
    details: "Admin account logged in to portal.",
    type: "user",
    timestamp: new Date(Date.now() - 3600000).toISOString(),
  },
];

const typeIcon: Record<string, ElementType> = {
  user: User,
  subscription: CreditCard,
  clinic: Building2,
  system: Settings,
  scan: Scan,
  appointment: CalendarDays,
};

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminAuditLogsPage() {
  const [actorFilter, setActorFilter] = useState<ActorFilter>("all");
  const [search, setSearch] = useState("");
  const [liveLogs, setLiveLogs] = useState<AuditEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadLogs() {
      try {
        const { data, error } = await supabase
          .from("system_audit_log")
          .select("log_id, action, user_type, log_type, timestamp, details, user:user_id ( full_name )")
          .order("timestamp", { ascending: false })
          .limit(500);
        if (cancelled || error || !data) return;
        setLiveLogs(data.map((l: any) => ({
          id: l.log_id,
          type: (l.log_type || "system") as AuditEntry["type"],
          action: l.action || "Action",
          target: l.user?.full_name ?? l.user_type ?? "System",
          details: l.details || "",
          performedBy: l.user?.full_name ?? "System",
          actorType: (l.user_type as AuditEntry["actorType"]) ?? "admin",
          timestamp: l.timestamp || new Date().toISOString(),
        })));
      } catch (err) {
        console.error("Error loading audit logs:", err);
      }
    }
    loadLogs();
    return () => { cancelled = true; };
  }, []);

  const allLogs = useMemo(() => {
    const merged = [...liveLogs, ...seedLogs.filter((l) => !liveLogs.some((ll) => ll.id === l.id))];
    return merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [liveLogs]);

  const filtered = allLogs.filter((log) => {
    const matchActor =
      actorFilter === "all" ||
      (actorFilter === "system" ? log.type === "system" : log.actorType === actorFilter);
    const matchSearch =
      search === "" ||
      log.action.toLowerCase().includes(search.toLowerCase()) ||
      log.target.toLowerCase().includes(search.toLowerCase()) ||
      log.details.toLowerCase().includes(search.toLowerCase()) ||
      log.performedBy.toLowerCase().includes(search.toLowerCase());
    return matchActor && matchSearch;
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-display font-bold text-black">Audit Logs</h1>
        <p className="text-sm text-gray-600 mt-1">
          Activity recorded across admins, patients, and clinics.
        </p>
      </div>

      {/* Category cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-6">
        {(["user", "subscription", "clinic", "system", "scan", "appointment"] as const).map((type) => {
          const Icon = typeIcon[type];
          const count = allLogs.filter((l) => l.type === type).length;
          return (
            <div
              key={type}
              className="bg-white rounded-xl border border-gray-200 shadow-sm p-7 min-h-[156px]"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-black capitalize">{type}</p>
                <Icon className="w-5 h-5 text-magenta-600" />
              </div>
              <p className="mt-5 text-4xl font-bold text-black tabular-nums">{count}</p>
              <p className="mt-2 text-sm text-gray-600">log entries</p>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-black mr-1">Performed by</span>
          {(["all", "admin", "patient", "clinic", "system"] as const).map((a) => (
            <button
              key={a}
              onClick={() => setActorFilter(a)}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-semibold capitalize transition-colors cursor-pointer",
                actorFilter === a
                  ? "bg-magenta-600 text-white"
                  : "bg-gray-100 text-black hover:bg-gray-200"
              )}
            >
              {a}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search logs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-4 py-3 rounded-lg border border-gray-300 bg-white text-sm text-black placeholder:text-gray-500 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/15 w-full lg:w-80"
        />
      </div>

      {/* Logs table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-7 py-5 border-b border-gray-200 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-black">Activity log</h2>
          <span className="text-sm text-gray-600">{filtered.length} entries</span>
        </div>
        {filtered.length === 0 ? (
          <div className="px-7 py-16 text-center text-sm text-gray-600">
            No log entries match your filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-black">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs font-semibold text-black uppercase tracking-wider">
                  <th className="px-7 py-4">Timestamp</th>
                  <th className="px-7 py-4">Category</th>
                  <th className="px-7 py-4">Action</th>
                  <th className="px-7 py-4">Target</th>
                  <th className="px-7 py-4">Details</th>
                  <th className="px-7 py-4">Performed by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-7 py-5 text-xs text-gray-700 whitespace-nowrap">
                      {formatTimestamp(log.timestamp)}
                    </td>
                    <td className="px-7 py-5 whitespace-nowrap">
                      <span className="inline-flex px-3 py-1 rounded-full border border-gray-300 text-xs font-semibold text-black capitalize">
                        {log.type}
                      </span>
                    </td>
                    <td className="px-7 py-5 text-sm font-semibold text-black">{log.action}</td>
                    <td className="px-7 py-5 text-sm text-black">{log.target}</td>
                    <td className="px-7 py-5 text-sm text-gray-700 max-w-xs">{log.details}</td>
                    <td className="px-7 py-5 whitespace-nowrap">
                      <p className="text-sm font-medium text-black">{log.performedBy}</p>
                      <p className="text-xs text-gray-600 capitalize">{log.actorType ?? "admin"}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}