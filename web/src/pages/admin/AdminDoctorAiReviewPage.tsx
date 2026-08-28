import { useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Filter,
  RefreshCw,
  Search,
  ShieldAlert,
  Stethoscope,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ReviewFilter = "all" | "correct" | "wrong" | "retrain" | "high-confidence-wrong";

type ReviewRecord = {
  id: string;
  patient: string;
  aiPrediction: string;
  confidence: number;
  doctor: string;
  finalDiagnosis: string;
  reviewedAt: string;
};

const demoRecords: ReviewRecord[] = [];

function normalizeDiagnosis(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isCorrect(record: ReviewRecord) {
  return normalizeDiagnosis(record.aiPrediction) === normalizeDiagnosis(record.finalDiagnosis);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getReviewedAppointments(): ReviewRecord[] {
  // TODO: Load reviewed appointments from Supabase
  return [];
}

export default function AdminDoctorAiReviewPage() {
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [query, setQuery] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const { records, usingDemoData } = useMemo(() => {
    void refreshKey;
    const reviewedRecords = getReviewedAppointments();
    return {
      records: reviewedRecords.length > 0 ? reviewedRecords : demoRecords,
      usingDemoData: reviewedRecords.length === 0,
    };
  }, [refreshKey]);

  const metrics = useMemo(() => {
    const correct = records.filter(isCorrect).length;
    const wrong = records.length - correct;
    const retrainCandidates = records.filter((record) => !isCorrect(record) && record.confidence >= 70).length;
    return {
      total: records.length,
      correct,
      wrong,
      retrainCandidates,
      accuracy: records.length ? Math.round((correct / records.length) * 100) : 0,
    };
  }, [records]);

  const visibleRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return records.filter((record) => {
      const correct = isCorrect(record);
      const matchesFilter =
        filter === "all" ||
        (filter === "correct" && correct) ||
        (filter === "wrong" && !correct) ||
        (filter === "retrain" && !correct && record.confidence >= 70) ||
        (filter === "high-confidence-wrong" && !correct && record.confidence >= 80);
      const matchesQuery = !normalizedQuery || [record.patient, record.doctor, record.aiPrediction, record.finalDiagnosis]
        .some((value) => value.toLowerCase().includes(normalizedQuery));
      return matchesFilter && matchesQuery;
    });
  }, [filter, query, records]);

  const filterOptions: { key: ReviewFilter; label: string }[] = [
    { key: "all", label: "All Records" },
    { key: "correct", label: "AI Correct" },
    { key: "wrong", label: "AI Wrong" },
    { key: "retrain", label: "Retrain Candidates" },
    { key: "high-confidence-wrong", label: "High Conf. + Wrong" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Doctor AI Review Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">Compare AI predictions with doctor-validated diagnoses to evaluate model accuracy and identify retraining candidates.</p>
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((key) => key + 1)}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" /> Refresh records
        </button>
      </div>

      {usingDemoData && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <p>Showing sample validation records. Completed doctor reviews with a final diagnosis will appear here automatically.</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard label="AI Accuracy" value={`${metrics.accuracy}%`} detail="Correct doctor-validated diagnoses" icon={Activity} color="magenta" />
        <MetricCard label="Total Correct" value={String(metrics.correct)} detail={`Out of ${metrics.total} reviewed records`} icon={CheckCircle2} color="green" />
        <MetricCard label="Total Wrong" value={String(metrics.wrong)} detail="Did not match doctor diagnosis" icon={XCircle} color="red" />
        <MetricCard label="Retrain Candidates" value={String(metrics.retrainCandidates)} detail="Wrong high-confidence predictions" icon={RefreshCw} color="violet" />
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-col xl:flex-row gap-3 xl:items-center xl:justify-between">
        <div className="flex flex-wrap gap-2">
          {filterOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setFilter(option.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors",
                filter === option.key ? "bg-magenta-500 text-white" : "bg-gray-50 text-gray-600 hover:bg-gray-100"
              )}
            >
              <Filter className="w-3.5 h-3.5" /> {option.label}
            </button>
          ))}
        </div>
        <label className="relative w-full xl:w-72">
          <Search className="absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search patient, doctor, diagnosis..."
            className="w-full rounded-xl border border-gray-200 py-2.5 pl-9 pr-3 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-magenta-500/20"
          />
        </label>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
        <div className="flex items-center justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="font-display font-bold text-gray-900">AI vs Doctor Validation Records</h2>
            <p className="mt-0.5 text-xs text-gray-400">{visibleRecords.length} records shown</p>
          </div>
          <Stethoscope className="w-5 h-5 text-magenta-500" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/70">
                {['Record ID', 'Patient', 'AI Prediction', 'Confidence', 'Doctor', 'Final Diagnosis', 'Result', 'Tag', 'Date'].map((label) => (
                  <th key={label} className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRecords.map((record) => {
                const correct = isCorrect(record);
                const retrain = !correct && record.confidence >= 70;
                return (
                  <tr key={record.id} className="border-b border-gray-50 last:border-b-0 hover:bg-gray-50/70">
                    <td className="px-5 py-4 text-xs font-semibold text-gray-600">{record.id}</td>
                    <td className="px-5 py-4 text-sm text-gray-700">{record.patient}</td>
                    <td className="px-5 py-4 text-sm font-medium text-gray-700">{record.aiPrediction}</td>
                    <td className="px-5 py-4 min-w-36">
                      <div className="flex items-center gap-2">
                        <span className={cn("text-xs font-bold", record.confidence >= 70 ? "text-emerald-600" : "text-amber-600")}>{record.confidence}%</span>
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
                          <div className={cn("h-full rounded-full", record.confidence >= 70 ? "bg-emerald-500" : "bg-amber-500")} style={{ width: `${record.confidence}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-600">{record.doctor}</td>
                    <td className="px-5 py-4 text-sm font-medium text-gray-700">{record.finalDiagnosis}</td>
                    <td className="px-5 py-4">
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", correct ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
                        {correct ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />} {correct ? "Correct" : "Wrong"}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {retrain ? <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700">Retrain candidate</span> : <span className="text-sm text-gray-300">-</span>}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap text-sm text-gray-500">{formatDate(record.reviewedAt)}</td>
                  </tr>
                );
              })}
              {visibleRecords.length === 0 && (
                <tr><td colSpan={9} className="px-5 py-14 text-center text-sm text-gray-400">No validation records match the selected filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, detail, icon: Icon, color }: { label: string; value: string; detail: string; icon: typeof Activity; color: "magenta" | "green" | "red" | "violet" }) {
  const colorClasses = {
    magenta: "bg-magenta-50 text-magenta-600",
    green: "bg-emerald-50 text-emerald-600",
    red: "bg-red-50 text-red-600",
    violet: "bg-violet-50 text-violet-600",
  };
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
          <p className="mt-1 text-3xl font-display font-bold text-gray-900">{value}</p>
        </div>
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl", colorClasses[color])}><Icon className="h-4.5 w-4.5" /></div>
      </div>
      <p className="mt-2 text-xs text-gray-400">{detail}</p>
    </div>
  );
}
