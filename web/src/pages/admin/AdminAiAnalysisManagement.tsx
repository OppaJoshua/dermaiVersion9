import { useMemo, useState, useEffect } from "react";
import { AlertTriangle, CheckCircle2, Filter, ShieldX } from "lucide-react";
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
    valid: "bg-green-100 text-green-700",
    flagged: "bg-amber-100 text-amber-700",
    invalid: "bg-red-100 text-red-700",
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
            setRecords(data.map((s: {
                analysis_id: string;
                confidence_score: number;
                status: string;
                scanned_at: string;
                skin_condition: { name: string } | null;
                user: { full_name: string } | null;
            }, idx: number) => ({
                id: idx + 1,
                _analysisId: s.analysis_id,
                patient: (s.user as { full_name: string } | null)?.full_name ?? "Unknown",
                uploadedAt: new Date(s.scanned_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }),
                predictedCondition: (s.skin_condition as { name: string } | null)?.name ?? "Unknown",
                confidence: Math.round(s.confidence_score),
                status: (["valid", "flagged", "invalid"].includes(s.status) ? s.status : "valid") as AnalysisStatus,
            })));
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
    return (<div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-gray-900">AI Skin Analysis Management</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Review uploaded analyses, investigate flagged outputs, and handle invalid image uploads
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Low Confidence</p>
          <p className="text-2xl font-display font-bold text-amber-700 mt-1">{lowConfidenceCount}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Flagged</p>
          <p className="text-2xl font-display font-bold text-amber-700 mt-1">{flaggedCount}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Invalid / Out-of-scope</p>
          <p className="text-2xl font-display font-bold text-red-700 mt-1">{invalidCount}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <div className="flex flex-wrap gap-2">
          {([
            ["all", "All Analyses"],
            ["low-confidence", "Low Confidence"],
            ["flagged", "Flagged"],
            ["invalid", "Invalid"],
            ["valid", "Valid"],
        ] as const).map(([key, label]) => (<button key={key} onClick={() => setFilter(key)} className={cn("inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-colors", filter === key
                ? "bg-magenta-500 text-white"
                : "bg-gray-50 text-gray-600 hover:bg-gray-100")}>
              <Filter className="w-3.5 h-3.5"/> {label}
            </button>))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-display font-bold text-gray-900">Uploaded Skin Image Analyses</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Record</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Patient</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Prediction</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Confidence</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Status</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Notes</th>
                <th className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRecords.map((record) => (<tr key={record.id} className="border-t border-gray-50 hover:bg-gray-50/70 transition-colors">
                  <td className="px-6 py-4 text-sm font-semibold text-gray-900">#{record.id}</td>
                  <td className="px-6 py-4 text-sm text-gray-700">
                    <p>{record.patient}</p>
                    <p className="text-xs text-gray-400">{record.uploadedAt}</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">{record.predictedCondition}</td>
                  <td className="px-6 py-4 text-sm text-gray-700">{record.confidence}%</td>
                  <td className="px-6 py-4">
                    <span className={cn("px-3 py-1 rounded-full text-xs font-semibold capitalize", badgeClasses[record.status])}>
                      {record.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{record.reason || "-"}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-2">
                      {record.status !== "valid" && (<button onClick={() => setRecordStatus(record.id, "valid")} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100">
                          <CheckCircle2 className="w-3.5 h-3.5"/> Mark Valid
                        </button>)}
                      {record.status !== "flagged" && (<button onClick={() => setRecordStatus(record.id, "flagged", "Needs manual review due to uncertainty")} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-xs font-medium hover:bg-amber-100">
                          <AlertTriangle className="w-3.5 h-3.5"/> Flag
                        </button>)}
                      {record.status !== "invalid" && (<button onClick={() => setRecordStatus(record.id, "invalid", "Invalid or out-of-scope image upload")} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-50 text-red-700 text-xs font-medium hover:bg-red-100">
                          <ShieldX className="w-3.5 h-3.5"/> Mark Invalid
                        </button>)}
                    </div>
                  </td>
                </tr>))}
            </tbody>
          </table>
        </div>
      </div>
    </div>);
}
