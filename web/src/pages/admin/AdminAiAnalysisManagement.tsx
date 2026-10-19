import { useMemo, useState, useEffect } from "react";
import { AlertTriangle, Flag, ShieldX } from "lucide-react";
import { cn } from "../../lib/utils";
import { supabase } from "../../lib/supabaseClient";
type AnalysisStatus = "valid" | "flagged" | "invalid";
type AnalysisRecord = {
    id: number;
    patient: string;
    uploadedAt: string;
    predictedCondition: string;
    confidence: number;
    status: AnalysisStatus;
    reason?: string;
};
const badgeClasses: Record<AnalysisStatus, string> = {
    valid: "bg-gray-100 border-gray-300 text-black",
    flagged: "bg-magenta-50 border-magenta-200 text-black",
    invalid: "bg-magenta-100 border-magenta-300 text-black",
};
export default function AdminAiAnalysisManagement() {
    const [records, setRecords] = useState<AnalysisRecord[]>([]);
    const [filter, setFilter] = useState<"all" | "low-confidence" | AnalysisStatus>("all");

    useEffect(() => {
        let cancelled = false;
        async function loadRecords() {
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
            if (cancelled || error || !data) return;
            setRecords((data as any[]).map((s: any, idx: number) => {
                const userObj = Array.isArray(s.user) ? s.user[0] : s.user;
                const condObj = Array.isArray(s.skin_condition) ? s.skin_condition[0] : s.skin_condition;
                return {
                    id: idx + 1,
                    _analysisId: s.analysis_id,
                    patient: userObj?.full_name ?? "Unknown",
                    uploadedAt: new Date(s.scanned_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }),
                    predictedCondition: condObj?.name ?? "Unknown",
                    confidence: Math.round(s.confidence_score),
                    status: (["valid", "flagged", "invalid"].includes(s.status) ? s.status : "valid") as AnalysisStatus,
                };
            }));
        }
        loadRecords();
        return () => { cancelled = true; };
    }, []);
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
            <p className="text-sm font-semibold text-black">Low confidence</p>
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
            <p className="text-sm font-semibold text-black">Invalid / out-of-scope</p>
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
        <div className="px-7 py-5 border-b border-gray-200 flex items-baseline justify-between">
          <h3 className="text-lg font-semibold text-black">Uploaded skin image analyses</h3>
          <span className="text-sm text-gray-600">{visibleRecords.length} shown</span>
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
              {visibleRecords.map((record) => (<tr key={record.id} className="hover:bg-gray-50 transition-colors">
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
                </tr>))}
              {visibleRecords.length === 0 && (<tr>
                  <td colSpan={7} className="px-7 py-16 text-center">
                    <p className="text-base font-semibold text-black">No analyses found</p>
                    <p className="text-sm text-gray-600 mt-1">No records match the selected filter.</p>
                  </td>
                </tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </div>);
}