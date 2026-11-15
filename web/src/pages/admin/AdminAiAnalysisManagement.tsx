import { useMemo, useState, useEffect, useCallback } from "react";
import { AlertTriangle, Flag, ShieldX, RefreshCw, Loader2, AlertCircle } from "lucide-react";
import { cn } from "../../lib/utils";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../context/AuthContext";

type AnalysisStatus = "valid" | "flagged" | "invalid";

type AnalysisRecord = {
    id: number;
    patient: string;
    uploadedAt: string;
    rawTimestamp?: string;
    predictedCondition: string;
    confidence: number;
    status: AnalysisStatus;
    reason?: string;
};

const badgeClasses: Record<AnalysisStatus, string> = {
    valid: "bg-green-50 border-green-200 text-green-700",
    flagged: "bg-red-50 border-red-200 text-red-700",
    invalid: "bg-magenta-100 border-magenta-300 text-black",
};

function formatScanTimestamp(iso?: string | null): string {
    if (!iso) return "—";
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return iso;
        return d.toLocaleDateString("en-PH", {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
    } catch {
        return iso;
    }
}

export default function AdminAiAnalysisManagement() {
    const { session, loading: authLoading } = useAuth();
    const [records, setRecords] = useState<AnalysisRecord[]>([]);
    const [filter, setFilter] = useState<"all" | "low-confidence" | AnalysisStatus>("all");
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const loadRecords = useCallback(async () => {
        if (authLoading) return;
        setIsLoading(true);
        setLoadError(null);

        const { data, error } = await supabase
            .from("ai_scan_result")
            .select(`
                analysis_id,
                confidence_score,
                status,
                scanned_at,
                skin_condition:condition_id ( name ),
                user:user_id ( full_name )
            `)
            .order("scanned_at", { ascending: false })
            .limit(100);

        if (error) {
            console.error("[AiAnalysis] load records error:", error.message);
            setLoadError(error.message);
            setIsLoading(false);
            return;
        }

        const rawList = Array.isArray(data) ? data : [];
        const mapped = rawList.map((s: any, idx: number) => {
            const userObj = Array.isArray(s.user) ? s.user[0] : s.user;
            const condObj = Array.isArray(s.skin_condition) ? s.skin_condition[0] : s.skin_condition;
            const rawTimestamp = s.scanned_at;
            return {
                id: idx + 1,
                _analysisId: s.analysis_id,
                patient: userObj?.full_name ?? "Unknown",
                uploadedAt: formatScanTimestamp(rawTimestamp),
                rawTimestamp,
                predictedCondition: condObj?.name ?? "Unknown",
                confidence: Math.round(s.confidence_score),
                status: (["valid", "flagged", "invalid"].includes(s.status) ? s.status : "valid") as AnalysisStatus,
            };
        });

        // Ensure strictly newest-first ordering
        mapped.sort(
            (a, b) =>
                new Date(b.rawTimestamp || 0).getTime() - new Date(a.rawTimestamp || 0).getTime()
        );
        mapped.forEach((item, i) => {
            item.id = i + 1;
        });

        setRecords(mapped);
        setIsLoading(false);
    }, [authLoading]);

    useEffect(() => {
        loadRecords();
    }, [loadRecords, session]);

    const visibleRecords = useMemo(() => {
        if (filter === "all")
            return records;
        if (filter === "low-confidence")
            return records.filter((r) => r.confidence < 60);
        return records.filter((r) => r.status === filter);
    }, [records, filter]);

    const lowConfidenceCount = records.filter((r) => r.confidence < 60).length;
    const flaggedCount = records.filter((r) => r.status === "flagged").length;
    const invalidCount = records.filter((r) => r.status === "invalid").length;

    const setRecordStatus = async (id: number, status: AnalysisStatus, reason?: string) => {
        const record = records.find((r) => r.id === id) as (AnalysisRecord & { _analysisId?: string }) | undefined;
        setRecords((prev) => prev.map((r) => r.id === id ? { ...r, status, reason } : r));
        if (record?._analysisId) {
            const { error } = await supabase
                .from("ai_scan_result")
                .update({ status })
                .eq("analysis_id", record._analysisId);
            if (error) console.error("[AiAnalysis] update status error:", error.message);
        }
    };

    return (<div className="space-y-8">
      <div>
        <h1 className="text-2xl font-display font-bold text-black">AI Skin Analysis Management</h1>
        <p className="text-sm text-gray-600 mt-1">
          Review uploaded analyses, investigate flagged outputs, and handle invalid image uploads.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-7 min-h-[156px]">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-black">Low Confidence</p>
            <AlertTriangle className="w-5 h-5 text-magenta-600"/>
          </div>
          <p className="mt-5 text-4xl font-bold text-black tabular-nums">{lowConfidenceCount}</p>
          <p className="mt-2 text-sm text-gray-600">Below 60% confidence</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-7 min-h-[156px]">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-black">Flagged</p>
            <Flag className="w-5 h-5 text-magenta-600"/>
          </div>
          <p className="mt-5 text-4xl font-bold text-black tabular-nums">{flaggedCount}</p>
          <p className="mt-2 text-sm text-gray-600">Waiting for manual review</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-7 min-h-[156px]">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-black">Invalid / Out-of-Scope</p>
            <ShieldX className="w-5 h-5 text-magenta-600"/>
          </div>
          <p className="mt-5 text-4xl font-bold text-black tabular-nums">{invalidCount}</p>
          <p className="mt-2 text-sm text-gray-600">Rejected image uploads</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-black mr-2">Filter</span>
          {([
            ["all", "All analyses"],
            ["low-confidence", "Low confidence"],
            ["flagged", "Flagged"],
            ["invalid", "Invalid"],
            ["valid", "Valid"],
        ] as const).map(([key, label]) => (<button key={key} onClick={() => setFilter(key)} className={cn("px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer", filter === key
                ? "bg-magenta-600 text-white"
                : "bg-gray-100 text-black hover:bg-gray-200")}>
              {label}
            </button>))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-7 py-5 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-black">Uploaded skin image analyses</h3>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">{visibleRecords.length} shown</span>
            <button
              onClick={() => loadRecords()}
              disabled={isLoading}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:text-black hover:bg-gray-50 transition cursor-pointer disabled:opacity-50"
              title="Refresh analyses"
              aria-label="Refresh analyses"
            >
              <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-black">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Record</th>
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Patient</th>
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Prediction</th>
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Confidence</th>
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Status</th>
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Notes</th>
                <th className="text-left text-xs font-semibold text-black uppercase tracking-wider px-7 py-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-7 py-16 text-center">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-magenta-600 mb-2" />
                    <p className="text-sm font-medium text-gray-600">Loading analysis records...</p>
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={7} className="px-7 py-16 text-center">
                    <AlertCircle className="w-8 h-8 mx-auto text-red-500 mb-2" />
                    <p className="text-base font-semibold text-black">Failed to load analyses</p>
                    <p className="text-sm text-gray-600 mt-1 max-w-md mx-auto">{loadError}</p>
                    <button
                      onClick={() => loadRecords()}
                      className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-magenta-600 text-white text-xs font-semibold hover:bg-magenta-700 transition cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Retry
                    </button>
                  </td>
                </tr>
              ) : visibleRecords.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-7 py-16 text-center">
                    <p className="text-base font-semibold text-black">No analyses found</p>
                    <p className="text-sm text-gray-600 mt-1">No records match the selected filter.</p>
                  </td>
                </tr>
              ) : (
                visibleRecords.map((record) => (
                  <tr key={record.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-7 py-5 text-sm font-semibold text-black">#{record.id}</td>
                    <td className="px-7 py-5 text-sm text-black">
                      <p className="font-medium">{record.patient}</p>
                      <p className="text-xs text-gray-600">{record.uploadedAt}</p>
                    </td>
                    <td className="px-7 py-5 text-sm text-black">{record.predictedCondition}</td>
                    <td className="px-7 py-5">
                      <div className="flex items-center gap-3">
                        <span className="w-10 text-sm font-semibold tabular-nums text-black">{record.confidence}%</span>
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200">
                          <div className="h-full rounded-full bg-magenta-500" style={{ width: `${Math.max(0, Math.min(100, record.confidence))}%` }}/>
                        </div>
                      </div>
                    </td>
                    <td className="px-7 py-5">
                      <span className={cn("inline-flex px-3 py-1 rounded-full border text-xs font-semibold capitalize", badgeClasses[record.status])}>
                        {record.status}
                      </span>
                    </td>
                    <td className="px-7 py-5 text-sm text-gray-700 max-w-[220px]">{record.reason || "-"}</td>
                    <td className="px-7 py-5">
                      <div className="flex flex-wrap gap-2">
                        {record.status !== "valid" && (<button onClick={() => setRecordStatus(record.id, "valid")} className="px-3.5 py-2 rounded-lg border border-gray-300 bg-white text-black text-xs font-semibold hover:bg-gray-50 cursor-pointer">
                            Mark valid
                          </button>)}
                        {record.status !== "flagged" && (<button onClick={() => setRecordStatus(record.id, "flagged", "Needs manual review due to uncertainty")} className="px-3.5 py-2 rounded-lg border border-gray-300 bg-white text-black text-xs font-semibold hover:bg-gray-50 cursor-pointer">
                            Flag
                          </button>)}
                        {record.status !== "invalid" && (<button onClick={() => setRecordStatus(record.id, "invalid", "Invalid or out-of-scope image upload")} className="px-3.5 py-2 rounded-lg border border-magenta-300 bg-white text-magenta-700 text-xs font-semibold hover:bg-magenta-50 cursor-pointer">
                            Mark invalid
                          </button>)}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>);
}
