import { useMemo, useState, useEffect, useCallback } from "react";
import { Activity, CheckCircle2, XCircle, RefreshCw, Loader2 } from "lucide-react";
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
            const docName = (row.assigned_doctor_id && docNameMap.get(row.assigned_doctor_id)) || "Unassigned doctor";

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
                doctor: item.assignedDoctorName || "Unassigned doctor",
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
    { key: "all", label: "All records" },
    { key: "correct", label: "AI correct" },
    { key: "wrong", label: "AI wrong" },
    { key: "retrain", label: "Retrain candidates" },
    { key: "high-confidence-wrong", label: "High confidence, wrong" },
    { key: "direct", label: "Direct consultations" },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start sm:items-center justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-display font-bold text-black">Doctor AI Review</h1>
          <p className="text-sm text-gray-600 mt-1">
            Compares AI predictions with doctor-validated diagnoses to track model accuracy and flag retraining candidates.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchReviewedAppointments}
          disabled={loading}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-black hover:bg-gray-50 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={cn("w-4 h-4 text-magenta-600", loading && "animate-spin")} /> Refresh records
        </button>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-6">
        <MetricCard label="AI accuracy" value={`${metrics.accuracy}%`} detail={metrics.total > 0 ? "Matches doctor diagnosis" : "No AI scans evaluated yet"} icon={Activity} />
        <MetricCard label="Correct" value={String(metrics.correct)} detail={`Of ${metrics.total} AI-evaluated records`} icon={CheckCircle2} />
        <MetricCard label="Wrong" value={String(metrics.wrong)} detail="Did not match doctor diagnosis" icon={XCircle} />
        <MetricCard label="Retrain candidates" value={String(metrics.retrainCandidates)} detail="Wrong at 70%+ confidence" icon={RefreshCw} />
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 flex flex-col xl:flex-row gap-4 xl:items-center xl:justify-between">
        <div className="flex flex-wrap gap-2">
          {filterOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setFilter(option.key)}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-semibold transition-colors cursor-pointer",
                filter === option.key ? "bg-magenta-600 text-white" : "bg-gray-100 text-black hover:bg-gray-200"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search patient, doctor, diagnosis"
          className="w-full xl:w-80 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-black placeholder:text-gray-500 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/15"
        />
      </div>

      {/* Records table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-baseline justify-between gap-4 border-b border-gray-200 px-7 py-5">
          <h2 className="text-lg font-semibold text-black">AI vs doctor validation records</h2>
          <p className="text-sm text-gray-600">{visibleRecords.length} shown</p>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="py-16 text-center">
              <Loader2 className="w-6 h-6 text-magenta-600 animate-spin mx-auto mb-3" />
              <p className="text-sm text-gray-600">Loading review records…</p>
            </div>
          ) : (
            <table className="w-full min-w-[1000px] text-black">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  {['Record ID', 'Patient', 'AI prediction', 'Confidence', 'Doctor', 'Final diagnosis', 'Result', 'Tag', 'Date'].map((label) => (
                    <th key={label} className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-black">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibleRecords.map((record) => {
                  const correct = isCorrect(record);
                  const isDirect = Boolean(record.isDirectConsultation);
                  const retrain = correct === false && (record.confidence || 0) >= 70;
                  return (
                    <tr key={record.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-5 whitespace-nowrap">
                        <span className="inline-block rounded-md bg-gray-100 px-2.5 py-1 font-mono text-xs font-semibold text-black">{record.id}</span>
                      </td>
                      <td className="px-6 py-5 text-sm font-semibold text-black">{record.patient}</td>
                      <td className="px-6 py-5 text-sm text-black">
                        {isDirect ? (
                          <span className="text-gray-600">Direct (no AI scan)</span>
                        ) : (
                          record.aiPrediction
                        )}
                      </td>
                      <td className="px-6 py-5 min-w-40">
                        {isDirect || record.confidence === undefined ? (
                          <span className="text-sm text-gray-400">—</span>
                        ) : (
                          <div className="flex items-center gap-3">
                            <span className="w-10 text-sm font-semibold tabular-nums text-black">{record.confidence}%</span>
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-200">
                              <div className="h-full rounded-full bg-magenta-500" style={{ width: `${record.confidence}%` }} />
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-5 text-sm text-black">{record.doctor}</td>
                      <td className="px-6 py-5 text-sm font-semibold text-black">{record.finalDiagnosis}</td>
                      <td className="px-6 py-5 whitespace-nowrap">
                        {isDirect ? (
                          <span className="inline-flex rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-black">Clinical only</span>
                        ) : correct === true ? (
                          <span className="inline-flex rounded-full border border-gray-300 bg-gray-100 px-3 py-1 text-xs font-semibold text-black">Correct</span>
                        ) : (
                          <span className="inline-flex rounded-full border border-magenta-300 bg-magenta-50 px-3 py-1 text-xs font-semibold text-black">Wrong</span>
                        )}
                      </td>
                      <td className="px-6 py-5 whitespace-nowrap">
                        {isDirect ? (
                          <span className="text-sm text-gray-700">Direct booking</span>
                        ) : retrain ? (
                          <span className="inline-flex rounded-full border border-magenta-300 px-3 py-1 text-xs font-semibold text-magenta-700">Retrain candidate</span>
                        ) : (
                          <span className="text-sm text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-5 whitespace-nowrap text-sm text-black">{formatDate(record.reviewedAt)}</td>
                    </tr>
                  );
                })}
                {visibleRecords.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-6 py-16 text-center">
                      <p className="text-base font-semibold text-black">No review records found</p>
                      <p className="text-sm text-gray-600 mt-1">Completed doctor reviews with a final diagnosis will appear here automatically.</p>
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

function MetricCard({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof Activity }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-7 min-h-[156px] shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-black">{label}</p>
        <Icon className="h-5 w-5 text-magenta-600" />
      </div>
      <p className="mt-5 text-4xl font-bold text-black tabular-nums">{value}</p>
      <p className="mt-2 text-sm text-gray-600">{detail}</p>
    </div>
  );
}