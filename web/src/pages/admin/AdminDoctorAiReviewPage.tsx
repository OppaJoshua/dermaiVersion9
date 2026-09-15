import { useMemo, useState, useEffect, useCallback } from "react";
import {
  Activity,
  CheckCircle2,
  Filter,
  RefreshCw,
  Search,
  Stethoscope,
  XCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";

type ReviewFilter = "all" | "correct" | "wrong" | "retrain" | "high-confidence-wrong" | "direct";

export type ReviewRecord = {
  id: string;
  patient: string;
  aiPrediction: string;
  confidence?: number;
  doctor: string;
  finalDiagnosis: string;
  reviewedAt: string;
  status?: string;
  note?: string;
  isDirectConsultation?: boolean;
};

function normalizeDiagnosis(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isDirectConsult(aiName?: string, confidence?: number | null): boolean {
  if (!aiName) return true;
  const lower = aiName.toLowerCase();
  const isGeneric = lower.includes("consultation") || lower.includes("general") || lower.includes("skin condition");
  const hasValidScore = confidence !== undefined && confidence !== null && Number(confidence) > 0;
  return isGeneric && !hasValidScore;
}

function isCorrect(record: ReviewRecord): boolean | null {
  if (record.isDirectConsultation || !record.aiPrediction || record.aiPrediction.includes("Direct Consultation") || record.aiPrediction.includes("No AI")) {
    return null;
  }
  const ai = normalizeDiagnosis(record.aiPrediction);
  const doc = normalizeDiagnosis(record.finalDiagnosis);
  return ai === doc || doc.includes(ai) || ai.includes(doc);
}

function formatDate(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function parseDoctorNote(rawNote?: string): { diagnosis: string; note: string } {
  if (!rawNote) return { diagnosis: "", note: "" };
  const match = rawNote.match(/^Diagnosis:\s*([^|\n]+)(?:[|\n]\s*(?:Note:\s*)?(.*))?$/is);
  if (match) {
    return {
      diagnosis: match[1]?.trim() || "",
      note: match[2]?.trim() || "",
    };
  }
  return { diagnosis: "", note: rawNote };
}

export default function AdminDoctorAiReviewPage() {
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<ReviewRecord[]>([]);

  const fetchReviewedAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const recordMap = new Map<string, ReviewRecord>();

      // 1. Fetch from Supabase patient_appointment table
      try {
        const { data, error } = await supabase
          .from("patient_appointment")
          .select(`
            appointment_id,
            patient_name,
            ai_condition_name,
            ai_confidence,
            doctor_status,
            doctor_note,
            doctor_reviewed_at,
            created_at,
            status,
            assigned_doctor_id,
            clinic:clinic_id ( name )
          `)
          .order("doctor_reviewed_at", { ascending: false });

        if (!error && data) {
          const docIds = (data as any[]).map((r) => r.assigned_doctor_id).filter(Boolean);
          const docNameMap = new Map<string, string>();
          if (docIds.length > 0) {
            try {
              const { data: docData } = await supabase
                .from("clinic_doctor")
                .select("doctor_id, doctor_name")
                .in("doctor_id", docIds);
              if (docData) {
                docData.forEach((d: any) => docNameMap.set(d.doctor_id, d.doctor_name));
              }
            } catch { }
          }

          for (const row of data as any[]) {
            // Only include reviewed appointments (or ones with doctor notes/decisions)
            const isReviewed = Boolean(
              row.doctor_reviewed_at ||
              (row.doctor_status && row.doctor_status !== "pending-review") ||
              row.doctor_note ||
              row.status === "completed"
            );

            if (!isReviewed) continue;

            const parsed = parseDoctorNote(row.doctor_note);
            const docName = (row.assigned_doctor_id && docNameMap.get(row.assigned_doctor_id)) || "Dr. Audrey Saludaga";

            const direct = isDirectConsult(row.ai_condition_name, row.ai_confidence);
            const aiPred = direct ? "Direct Consultation (No AI)" : (row.ai_condition_name || "Skin condition");
            const finalDiag = parsed.diagnosis || (direct ? "General Consultation" : aiPred);
            const conf = direct ? undefined : (row.ai_confidence ? Math.round(Number(row.ai_confidence)) : undefined);

            const recId = row.appointment_id
              ? `REV-${row.appointment_id.slice(0, 8).toUpperCase()}`
              : `REV-${Math.floor(Math.random() * 100000)}`;

            recordMap.set(row.appointment_id, {
              id: recId,
              patient: row.patient_name || "Patient",
              aiPrediction: aiPred,
              confidence: conf,
              doctor: docName,
              finalDiagnosis: finalDiag,
              reviewedAt: row.doctor_reviewed_at || row.created_at || new Date().toISOString(),
              status: row.doctor_status || "approved",
              note: parsed.note || row.doctor_note || "",
              isDirectConsultation: direct,
            });
          }
        }
      } catch (err) {
        console.warn("[AdminDoctorAiReviewPage] Supabase fetch error:", err);
      }

      // 2. Fetch and merge from localStorage
      try {
        const localData = localStorage.getItem("dermai_clinic_appointments");
        if (localData) {
          const parsed = JSON.parse(localData);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              const isReviewed = Boolean(
                item.doctorReviewedAt ||
                (item.doctorStatus && item.doctorStatus !== "pending-review") ||
                item.doctorDiagnosis ||
                item.doctorNote ||
                item.status === "completed" ||
                item.status === "accepted"
              );

              if (!isReviewed) continue;
              if (item.id && recordMap.has(item.id)) continue;

              const direct = isDirectConsult(item.aiConditionName || item.conditionName, item.aiConfidence);
              const aiPred = direct ? "Direct Consultation (No AI)" : (item.aiConditionName || item.conditionName || "Skin condition");
              const finalDiag = item.doctorDiagnosis || (direct ? "General Consultation" : aiPred);
              const conf = direct ? undefined : (item.aiConfidence ? Math.round(Number(item.aiConfidence)) : undefined);

              const recId = item.id
                ? `REV-${String(item.id).slice(0, 8).toUpperCase()}`
                : `REV-${Math.floor(Math.random() * 100000)}`;

              recordMap.set(item.id || recId, {
                id: recId,
                patient: item.patientName || "Patient",
                aiPrediction: aiPred,
                confidence: conf,
                doctor: item.assignedDoctorName || "Dr. Audrey Saludaga",
                finalDiagnosis: finalDiag,
                reviewedAt: item.doctorReviewedAt || item.createdAt || new Date().toISOString(),
                status: item.doctorStatus || "approved",
                note: item.doctorNote || "",
                isDirectConsultation: direct,
              });
            }
          }
        }
      } catch (err) {
        console.warn("[AdminDoctorAiReviewPage] LocalStorage fetch error:", err);
      }

      setRecords(Array.from(recordMap.values()));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReviewedAppointments();

    // Supabase Realtime channel for live sync
    const channel = supabase
      .channel("admin-doctor-review-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "patient_appointment" },
        () => {
          fetchReviewedAppointments();
        }
      )
      .subscribe();

    const handleCustomUpdate = () => fetchReviewedAppointments();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "dermai_clinic_appointments") {
        fetchReviewedAppointments();
      }
    };

    window.addEventListener("dermai_appointments_updated", handleCustomUpdate);
    window.addEventListener("storage", handleStorage);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("dermai_appointments_updated", handleCustomUpdate);
      window.removeEventListener("storage", handleStorage);
    };
  }, [fetchReviewedAppointments]);

  const metrics = useMemo(() => {
    const aiRecords = records.filter((r) => !r.isDirectConsultation && isCorrect(r) !== null);
    const correct = aiRecords.filter((record) => isCorrect(record) === true).length;
    const wrong = aiRecords.filter((record) => isCorrect(record) === false).length;
    const retrainCandidates = aiRecords.filter((record) => isCorrect(record) === false && (record.confidence || 0) >= 70).length;
    const totalAi = aiRecords.length;

    return {
      total: totalAi,
      totalAll: records.length,
      correct,
      wrong,
      retrainCandidates,
      accuracy: totalAi ? Math.round((correct / totalAi) * 100) : 100,
    };
  }, [records]);

  const visibleRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return records.filter((record) => {
      const correct = isCorrect(record);
      const isDirect = Boolean(record.isDirectConsultation);

      const matchesFilter =
        filter === "all" ||
        (filter === "correct" && correct === true) ||
        (filter === "wrong" && correct === false) ||
        (filter === "retrain" && correct === false && (record.confidence || 0) >= 70) ||
        (filter === "high-confidence-wrong" && correct === false && (record.confidence || 0) >= 80) ||
        (filter === "direct" && isDirect);

      const matchesQuery = !normalizedQuery || [record.patient, record.doctor, record.aiPrediction, record.finalDiagnosis]
        .some((value) => (value || "").toLowerCase().includes(normalizedQuery));

      return matchesFilter && matchesQuery;
    });
  }, [filter, query, records]);

  const filterOptions: { key: ReviewFilter; label: string }[] = [
    { key: "all", label: "All Records" },
    { key: "correct", label: "AI Correct" },
    { key: "wrong", label: "AI Wrong" },
    { key: "retrain", label: "Retrain Candidates" },
    { key: "high-confidence-wrong", label: "High Conf. + Wrong" },
    { key: "direct", label: "Direct Consultations" },
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
          onClick={fetchReviewedAppointments}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer"
        >
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Refresh records
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard label="AI Accuracy" value={`${metrics.accuracy}%`} detail={metrics.total > 0 ? "Correct doctor-validated diagnoses" : "No AI scans evaluated yet"} icon={Activity} color="magenta" />
        <MetricCard label="Total Correct" value={String(metrics.correct)} detail={`Out of ${metrics.total} AI-evaluated records`} icon={CheckCircle2} color="green" />
        <MetricCard label="Total Wrong" value={String(metrics.wrong)} detail="Did not match doctor diagnosis" icon={XCircle} color="red" />
        <MetricCard label="Retrain Candidates" value={String(metrics.retrainCandidates)} detail="Wrong high-confidence AI predictions" icon={RefreshCw} color="violet" />
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-col xl:flex-row gap-3 xl:items-center xl:justify-between shadow-xs">
        <div className="flex flex-wrap gap-2">
          {filterOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setFilter(option.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer",
                filter === option.key ? "bg-magenta-600 text-white" : "bg-gray-50 text-gray-600 hover:bg-gray-100"
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

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xs">
        <div className="flex items-center justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="font-display font-bold text-gray-900">AI vs Doctor Validation Records</h2>
            <p className="mt-0.5 text-xs text-gray-400">{visibleRecords.length} records shown</p>
          </div>
          <Stethoscope className="w-5 h-5 text-magenta-500" />
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="py-16 text-center">
              <Loader2 className="w-8 h-8 text-magenta-600 animate-spin mx-auto mb-3" />
              <p className="text-sm text-gray-400">Loading doctor review records...</p>
            </div>
          ) : (
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
                  const isDirect = Boolean(record.isDirectConsultation);
                  const retrain = correct === false && (record.confidence || 0) >= 70;
                  return (
                    <tr key={record.id} className="border-b border-gray-50 last:border-b-0 hover:bg-gray-50/70 transition-colors">
                      <td className="px-5 py-4 text-xs font-semibold text-gray-600">{record.id}</td>
                      <td className="px-5 py-4 text-sm text-gray-700 font-medium">{record.patient}</td>
                      <td className="px-5 py-4 text-sm font-medium text-gray-700">
                        {isDirect ? (
                          <span className="text-xs font-medium text-slate-500 italic flex items-center gap-1.5">
                            <Stethoscope className="w-3.5 h-3.5 text-slate-400 shrink-0" /> Direct (No AI Scan)
                          </span>
                        ) : (
                          record.aiPrediction
                        )}
                      </td>
                      <td className="px-5 py-4 min-w-36">
                        {isDirect || record.confidence === undefined ? (
                          <span className="text-xs text-gray-300 italic font-mono">—</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className={cn("text-xs font-bold", record.confidence >= 70 ? "text-emerald-600" : "text-amber-600")}>{record.confidence}%</span>
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
                              <div className={cn("h-full rounded-full", record.confidence >= 70 ? "bg-emerald-500" : "bg-amber-500")} style={{ width: `${record.confidence}%` }} />
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-600">{record.doctor}</td>
                      <td className="px-5 py-4 text-sm font-medium text-gray-900">{record.finalDiagnosis}</td>
                      <td className="px-5 py-4">
                        {isDirect ? (
                          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold bg-slate-100 text-slate-700">
                            <CheckCircle2 className="w-3.5 h-3.5 text-slate-400" /> Clinical Only
                          </span>
                        ) : correct === true ? (
                          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold bg-emerald-100 text-emerald-700">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Correct
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold bg-red-100 text-red-700">
                            <XCircle className="w-3.5 h-3.5" /> Wrong
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {isDirect ? (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">Direct Booking</span>
                        ) : retrain ? (
                          <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700">Retrain candidate</span>
                        ) : (
                          <span className="text-sm text-gray-300">-</span>
                        )}
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap text-sm text-gray-500">{formatDate(record.reviewedAt)}</td>
                    </tr>
                  );
                })}
                {visibleRecords.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-5 py-14 text-center text-sm text-gray-400">
                      <Stethoscope className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                      <p className="font-semibold text-gray-600">No review records found</p>
                      <p className="text-xs text-gray-400 mt-0.5">Completed doctor reviews with a final diagnosis will appear here automatically.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
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
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-xs">
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
