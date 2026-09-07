import { useMemo, useState, useEffect } from "react";
import { User, CreditCard, Building2, Settings, Search, Scan, CalendarDays, UserCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AuditEntry } from "@/lib/auditLog";
import { supabase } from "@/lib/supabaseClient";

type ActorFilter = "all" | "admin" | "patient" | "clinic" | "system";

const seedLogs: AuditEntry[] = [];

const typeIcon: Record<string, React.ElementType> = {
  user: User,
  subscription: CreditCard,
  clinic: Building2,
  system: Settings,
  scan: Scan,
  appointment: CalendarDays,
};

const typeBadge: Record<string, string> = {
  user: "bg-blue-50 text-blue-700",
  subscription: "bg-magenta-50 text-magenta-700",
  clinic: "bg-emerald-50 text-emerald-700",
  system: "bg-gray-100 text-gray-700",
  scan: "bg-purple-50 text-purple-700",
  appointment: "bg-orange-50 text-orange-700",
};

const actorBadge: Record<ActorFilter, string> = {
  all: "",
  admin: "bg-red-50 text-red-700",
  patient: "bg-sky-50 text-sky-700",
  clinic: "bg-teal-50 text-teal-700",
  system: "bg-gray-100 text-gray-700",
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
      const { data, error } = await supabase
        .from("system_audit_log")
        .select("log_id, action, user_type, log_type, timestamp, user:user_id ( full_name )")
        .order("timestamp", { ascending: false })
        .limit(500);
      if (cancelled || error || !data) return;
      setLiveLogs(data.map((l: {
        log_id: string;
        action: string;
        user_type: string;
        log_type: string;
        timestamp: string;
        user: { full_name: string } | null;
      }) => ({
        id: l.log_id,
        type: l.log_type as AuditEntry["type"],
        action: l.action,
        target: (l.user as { full_name: string } | null)?.full_name ?? l.user_type,
        details: "",
        performedBy: (l.user as { full_name: string } | null)?.full_name ?? "System",
        actorType: (l.user_type as AuditEntry["actorType"]) ?? "admin",
        timestamp: l.timestamp,
      })));
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-gray-900">Audit Logs</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Monitor all activities by admins, patients, and clinics
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {(["user", "subscription", "clinic", "system", "scan", "appointment"] as const).map((type) => {
          const Icon = typeIcon[type];
          const count = allLogs.filter((l) => l.type === type).length;
          return (
            <div key={type} className="bg-white rounded-2xl p-4 border border-gray-100">
              <div className={cn("w-7 h-7 rounded-xl flex items-center justify-center mb-2", typeBadge[type])}>
                <Icon className="w-3.5 h-3.5" />
              </div>
              <p className="text-xl font-display font-bold text-gray-900">{count}</p>
              <p className="text-xs text-gray-400 capitalize">{type}</p>
            </div>
          );
        })}
      </div>

      {/* Actor Filter + Type Filter + Search */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        {/* Performed by filter + search row */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider mr-1">Performed by:</span>
          {(["all", "admin", "patient", "clinic", "system"] as const).map((a) => (
            <button
              key={a}
              onClick={() => setActorFilter(a)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors capitalize",
                actorFilter === a
                  ? "bg-magenta-500 text-white"
                  : "bg-gray-50 text-gray-600 hover:bg-gray-100"
              )}
            >
              {a === "patient" && <UserCircle2 className="w-3 h-3" />}
              {a === "clinic" && <Building2 className="w-3 h-3" />}
              {a === "system" && <Settings className="w-3 h-3" />}
              {a}
            </button>
          ))}
          <div className="relative ml-auto">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search logs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-4 py-2 rounded-xl border border-gray-200 text-xs text-gray-700 placeholder:text-gray-400 outline-none focus:border-magenta-400 w-52"
            />
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-display font-bold text-gray-900">
            Activity Log{" "}
            <span className="text-sm font-normal text-gray-400 ml-1">
              ({filtered.length} entries)
            </span>
          </h3>
        </div>
        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-400">
            No log entries match your filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Timestamp</th>
                  <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Category</th>
                  <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Action</th>
                  <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Target</th>
                  <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Details</th>
                  <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Performed By</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => {
                  const Icon = typeIcon[log.type] ?? Settings;
                  return (
                    <tr key={log.id} className="border-t border-gray-50 hover:bg-gray-50/70 transition-colors">
                      <td className="px-6 py-4 text-xs text-gray-500 whitespace-nowrap">
                        {formatTimestamp(log.timestamp)}
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold capitalize", typeBadge[log.type] ?? "bg-gray-100 text-gray-600")}>
                          <Icon className="w-3 h-3" />
                          {log.type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold text-gray-800">{log.action}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{log.target}</td>
                      <td className="px-6 py-4 text-sm text-gray-500 max-w-xs">{log.details}</td>
                      <td className="px-6 py-4">
                        <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold capitalize", actorBadge[log.actorType ?? "admin"])}>
                          {log.actorType === "patient" && <UserCircle2 className="w-3 h-3" />}
                          {log.actorType === "clinic" && <Building2 className="w-3 h-3" />}
                          {log.performedBy}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
