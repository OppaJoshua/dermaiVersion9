import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Calendar,
  Activity,
  ChevronRight,
  MapPin,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  X,
  Loader2,
  Sparkles,
  ShieldAlert,
  ExternalLink,
  ClipboardList,
  Info,
  BookOpen,
  Users,
  Stethoscope,
  ZoomIn,
  FileQuestion,
  Layers,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabaseClient";
import { getSignedSkinPhotoUrl } from "@/lib/storageUtils";
import { cn, formatConfidencePercent } from "@/lib/utils";
import { ModalPortal } from "@/components/common/ModalPortal";
import { getConditionGuide } from "@/data/conditionGuides";
import type { ConditionGuide, MedicalSourceReference } from "@/data/conditionGuides";
import { QUESTIONNAIRE_QUESTIONS } from "@/data/questionnaireData";
import {
  evaluateDiseaseMapping,
  compareAIAndQuestionnaire,
} from "@/lib/diseaseMappingService";
import type {
  DiseaseMappingResult,
  AIQuestionnaireComparison,
} from "@/lib/diseaseMappingService";

export interface NormalizedQuestionAnswer {
  id: string;
  number: number;
  question: string;
  tagalogQuestion?: string;
  answer: string;
  tagalogAnswer?: string;
  selectedOptionIds: string[];
  role?: string;
}

export interface SkinHistoryItem {
  id: string;
  condition: string;
  localName?: string;
  confidence: number;
  bodyPart: string;
  date: string;
  rawDate: string;
  severity: "Mild" | "Moderate" | "Severe";
  patientReportedImpact?: "Mild" | "Moderate" | "Severe";
  imageUrl?: string;
  wideImageUrl?: string;
  rawPhotoUrl?: string | null;
  rawPhotoUrlWide?: string | null;
  description?: string;
  symptoms?: string[];
  whoAffected?: string;
  careTips?: string[];
  whenToSeeDoctor?: string;
  medicalSources?: MedicalSourceReference[];
  category?: string;
  questionnaireAnswers?: NormalizedQuestionAnswer[];
  mappingResult?: DiseaseMappingResult | null;
  comparison?: AIQuestionnaireComparison | null;
  conditionGuide?: ConditionGuide | null;
  isCombined?: boolean;
}

/**
 * Normalizes raw questionnaire data from ai_scan_result.questionnaire_answers
 * into standard question-and-answer items with English and Tagalog text,
 * reconstructing the option IDs for rule-based disease mapping.
 */
function normalizeQuestionnaireAnswers(raw: any): {
  answersList: NormalizedQuestionAnswer[];
  answersMap: Record<string, string[]>;
} {
  const answersMap: Record<string, string[]> = {};
  const answersList: NormalizedQuestionAnswer[] = [];

  if (!raw) {
    return { answersList: [], answersMap: {} };
  }

  // Handle case where raw is an array of questions (standard ScanSkin format)
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;

      const qId = String(item.id || item.question_key || item.key || "").toLowerCase();
      const qDef = QUESTIONNAIRE_QUESTIONS.find(
        (q) => q.id.toLowerCase() === qId || q.number === item.number
      );

      let optionIds: string[] = [];
      if (Array.isArray(item.selectedOptionIds)) {
        optionIds = item.selectedOptionIds.map(String);
      } else if (Array.isArray(item.optionIds)) {
        optionIds = item.optionIds.map(String);
      } else if (qDef && item.answer) {
        const ansText = String(item.answer);
        const matched = qDef.options.filter(
          (opt) =>
            ansText.toLowerCase().includes(opt.labelEn.toLowerCase()) ||
            ansText.toLowerCase().includes(opt.labelTl.toLowerCase())
        );
        optionIds = matched.map((m) => m.id);
      }

      if (qDef) {
        answersMap[qDef.id] = optionIds;
      }

      let answerEn = item.answer || "";
      let answerTl = item.tagalogAnswer || "";

      if (qDef && optionIds.length > 0) {
        const matchingOptions = qDef.options.filter((o) => optionIds.includes(o.id));
        if (matchingOptions.length > 0) {
          if (!answerEn || answerEn === "Not answered") {
            answerEn = matchingOptions.map((o) => o.labelEn).join("; ");
          }
          if (!answerTl || answerTl === "Hindi sinagot") {
            answerTl = matchingOptions.map((o) => o.labelTl).join("; ");
          }
        }
      }

      answersList.push({
        id: qDef?.id || qId || `q-${answersList.length + 1}`,
        number: qDef?.number || item.number || answersList.length + 1,
        question: qDef?.titleEn || item.question || `Question ${answersList.length + 1}`,
        tagalogQuestion: qDef?.titleTl || item.tagalogQuestion || "",
        answer: answerEn || "Not answered",
        tagalogAnswer: answerTl || "Hindi sinagot",
        selectedOptionIds: optionIds,
        role: qDef?.role || item.role || "symptom_evidence",
      });
    }

    answersList.sort((a, b) => a.number - b.number);
    return { answersList, answersMap };
  }

  // Handle case where raw is a key-value object { q1: [...], q2: [...] }
  if (typeof raw === "object") {
    for (const q of QUESTIONNAIRE_QUESTIONS) {
      const val = raw[q.id] || raw[q.id.toUpperCase()];
      if (val !== undefined && val !== null) {
        let optionIds: string[] = [];
        if (Array.isArray(val)) {
          optionIds = val.map(String);
        } else if (typeof val === "string") {
          if (q.options.some((o) => o.id === val)) {
            optionIds = [val];
          } else {
            const matched = q.options.filter(
              (o) =>
                val.toLowerCase().includes(o.labelEn.toLowerCase()) ||
                val.toLowerCase().includes(o.labelTl.toLowerCase())
            );
            optionIds = matched.map((m) => m.id);
          }
        }

        answersMap[q.id] = optionIds;

        const chosenOptions = q.options.filter((o) => optionIds.includes(o.id));
        answersList.push({
          id: q.id,
          number: q.number,
          question: q.titleEn,
          tagalogQuestion: q.titleTl,
          answer: chosenOptions.map((o) => o.labelEn).join("; ") || "Not answered",
          tagalogAnswer: chosenOptions.map((o) => o.labelTl).join("; ") || "Hindi sinagot",
          selectedOptionIds: optionIds,
          role: q.role,
        });
      }
    }

    answersList.sort((a, b) => a.number - b.number);
    return { answersList, answersMap };
  }

  return { answersList: [], answersMap: {} };
}

function formatRoleName(role?: string): string {
  switch (role) {
    case "symptom_evidence":
      return "Symptom Evidence";
    case "contextual_impact":
      return "Quality of Life";
    case "safety_referral":
      return "Safety Screening";
    case "background_context":
      return "Medical History";
    default:
      return "Assessment";
  }
}

export default function PatientSkinHistory() {
  const [searchParams] = useSearchParams();
  const [history, setHistory] = useState<SkinHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<SkinHistoryItem | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "questionnaire" | "guide">("overview");
  const [lightboxImage, setLightboxImage] = useState<{ url: string; title: string } | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<SkinHistoryItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setIsLoading(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const userId = session?.user?.id;

      if (!userId || cancelled) {
        setIsLoading(false);
        return;
      }

      // Supplemental fallbacks from recent scan cache
      let lastScanCached: any = null;
      try {
        const raw = localStorage.getItem("dermai_last_scan");
        if (raw) lastScanCached = JSON.parse(raw);
      } catch { }

      let userStorageFiles: any[] = [];
      try {
        const { data: storageFiles } = await supabase.storage
          .from("scan-uploads")
          .list(userId, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
        if (Array.isArray(storageFiles)) {
          userStorageFiles = storageFiles;
        }
      } catch { }

      const { data, error } = await supabase
        .from("ai_scan_result")
        .select(`
          analysis_id,
          confidence_score,
          body_part,
          scanned_at,
          photo_url,
          photo_url_wide,
          questionnaire_answers,
          skin_condition:condition_id (
            name,
            local_name,
            description,
            skin_condition_care_tip (
              tip_text
            )
          )
        `)
        .eq("user_id", userId)
        .eq("status", "completed")
        .order("scanned_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        console.error("[SkinHistory] fetch error:", error.message);
        setIsLoading(false);
        return;
      }

      const mapped: SkinHistoryItem[] = await Promise.all(
        ((data ?? []) as any[]).map(async (s: any) => {
          const condObj = Array.isArray(s.skin_condition)
            ? s.skin_condition[0]
            : s.skin_condition;

          const conditionName = condObj?.name ?? "Skin Condition";
          const guide = getConditionGuide(conditionName);

          const scanTime = new Date(s.scanned_at).getTime();

          // 1. Resolve Close-up Photo path
          let closeUpRaw: string | null = s.photo_url || null;
          if (closeUpRaw && (closeUpRaw.startsWith("blob:") || closeUpRaw.startsWith("data:"))) {
            closeUpRaw = null;
          }
          if (!closeUpRaw && lastScanCached) {
            const matchesId = lastScanCached.analysisId === s.analysis_id;
            const diff = Math.abs(scanTime - (lastScanCached.timestamp || 0));
            if (matchesId || diff < 300_000) {
              const cached = lastScanCached.photoUrl;
              if (cached && !cached.startsWith("blob:") && !cached.startsWith("data:")) {
                closeUpRaw = cached;
              }
            }
          }
          if (!closeUpRaw && userStorageFiles.length > 0) {
            const closeCandidates = userStorageFiles
              .filter((f) => f.name.includes("close_up"))
              .map((f) => ({
                name: f.name,
                diff: Math.abs(parseInt(f.name.split("_")[0], 10) - scanTime),
              }))
              .filter((f) => !isNaN(f.diff) && f.diff < 600_000)
              .sort((a, b) => a.diff - b.diff);

            if (closeCandidates.length > 0) {
              closeUpRaw = `${userId}/${closeCandidates[0].name}`;
            }
          }

          // 2. Resolve Wide-area Photo path
          let wideRaw: string | null = s.photo_url_wide || null;
          if (wideRaw && (wideRaw.startsWith("blob:") || wideRaw.startsWith("data:"))) {
            wideRaw = null;
          }
          if (!wideRaw && lastScanCached) {
            const matchesId = lastScanCached.analysisId === s.analysis_id;
            const diff = Math.abs(scanTime - (lastScanCached.timestamp || 0));
            if (matchesId || diff < 300_000) {
              const cachedWide = lastScanCached.photoUrlWide;
              if (cachedWide && !cachedWide.startsWith("blob:") && !cachedWide.startsWith("data:")) {
                wideRaw = cachedWide;
              }
            }
          }

          // Robust fallback for wideRaw using userStorageFiles
          if (!wideRaw && userStorageFiles.length > 0) {
            // Strategy A: Match by exact timestamp from closeUpRaw
            let matchedByCloseUpTs: string | null = null;
            if (closeUpRaw) {
              const closeUpFilename = closeUpRaw.split("/").pop() || "";
              const closeUpTs = parseInt(closeUpFilename.split("_")[0], 10);
              if (!isNaN(closeUpTs) && closeUpTs > 0) {
                const directMatch = userStorageFiles.find((f) => {
                  const fTs = parseInt(f.name.split("_")[0], 10);
                  return f.name.includes("wide") && Math.abs(fTs - closeUpTs) < 30_000;
                });
                if (directMatch) {
                  matchedByCloseUpTs = `${userId}/${directMatch.name}`;
                }
              }
            }

            if (matchedByCloseUpTs) {
              wideRaw = matchedByCloseUpTs;
            } else {
              // Strategy B: Match closest wide candidate to scanTime
              const wideCandidates = userStorageFiles
                .filter((f) => f.name.includes("wide"))
                .map((f) => ({
                  name: f.name,
                  diff: Math.abs(parseInt(f.name.split("_")[0], 10) - scanTime),
                }))
                .filter((f) => !isNaN(f.diff) && f.diff < 1_200_000)
                .sort((a, b) => a.diff - b.diff);

              if (wideCandidates.length > 0) {
                wideRaw = `${userId}/${wideCandidates[0].name}`;
              }
            }
          }

          // 3. Obtain signed URLs for both images
          let imageUrl: string | undefined = undefined;
          let wideImageUrl: string | undefined = undefined;

          if (closeUpRaw) {
            if (closeUpRaw.startsWith("http://") || closeUpRaw.startsWith("https://")) {
              imageUrl = closeUpRaw;
            } else {
              const signed = await getSignedSkinPhotoUrl(closeUpRaw);
              if (signed) imageUrl = signed;
            }
          }

          if (wideRaw) {
            if (wideRaw.startsWith("http://") || wideRaw.startsWith("https://")) {
              wideImageUrl = wideRaw;
            } else {
              const signed = await getSignedSkinPhotoUrl(wideRaw);
              if (signed) wideImageUrl = signed;
            }
          }

          // Fallback thumbnail: if primary close-up is missing, use wide
          if (!imageUrl && wideImageUrl) {
            imageUrl = wideImageUrl;
          }

          // 4. Resolve Questionnaire Answers
          let rawQ = s.questionnaire_answers;
          if (typeof rawQ === "string") {
            try {
              rawQ = JSON.parse(rawQ);
            } catch { }
          }

          // Fallback to ai_skin_answer table if questionnaire_answers column is empty
          if (!rawQ || (Array.isArray(rawQ) && rawQ.length === 0)) {
            try {
              const { data: skinAnswers } = await supabase
                .from("ai_skin_answer")
                .select("question_key, answer_value, sort_order")
                .eq("analysis_id", s.analysis_id)
                .order("sort_order", { ascending: true });

              if (skinAnswers && skinAnswers.length > 0) {
                rawQ = skinAnswers.map((sa) => {
                  const qDef = QUESTIONNAIRE_QUESTIONS.find((q) => q.id === sa.question_key);
                  const matchedOpt = qDef?.options.find(
                    (o) => o.labelEn === sa.answer_value || sa.answer_value.includes(o.labelEn)
                  );
                  return {
                    id: sa.question_key,
                    question: qDef?.titleEn || sa.question_key,
                    tagalogQuestion: qDef?.titleTl || "",
                    answer: sa.answer_value,
                    tagalogAnswer: matchedOpt?.labelTl || "",
                    selectedOptionIds: matchedOpt ? [matchedOpt.id] : [],
                    role: qDef?.role || "symptom_evidence",
                  };
                });
              }
            } catch { }
          }

          // Fallback to lastScanCached questionnaire if matching
          if ((!rawQ || (Array.isArray(rawQ) && rawQ.length === 0)) && lastScanCached) {
            const matchesId = lastScanCached.analysisId === s.analysis_id;
            const diff = Math.abs(scanTime - (lastScanCached.timestamp || 0));
            if ((matchesId || diff < 300_000) && lastScanCached.questionnaire) {
              rawQ = lastScanCached.questionnaire;
            }
          }

          const { answersList, answersMap } = normalizeQuestionnaireAnswers(rawQ);

          // 5. Evaluate Rule-based Disease Mapping & Comparison
          let mappingResult: DiseaseMappingResult | null = null;
          let comparison: AIQuestionnaireComparison | null = null;

          if (Object.keys(answersMap).length > 0) {
            try {
              mappingResult = evaluateDiseaseMapping(answersMap);
              comparison = compareAIAndQuestionnaire(
                conditionName,
                Number(s.confidence_score ?? 0),
                mappingResult
              );
            } catch (err) {
              console.warn("[SkinHistory] Disease mapping evaluation skipped:", err);
            }
          }

          if (!mappingResult && lastScanCached?.mappingResult) {
            const matchesId = lastScanCached.analysisId === s.analysis_id;
            if (matchesId) mappingResult = lastScanCached.mappingResult;
          }
          if (!comparison && lastScanCached?.comparison) {
            const matchesId = lastScanCached.analysisId === s.analysis_id;
            if (matchesId) comparison = lastScanCached.comparison;
          }

          const patientReportedImpact: "Mild" | "Moderate" | "Severe" =
            mappingResult?.contextualImpact?.level === "severe"
              ? "Severe"
              : mappingResult?.contextualImpact?.level === "moderate"
                ? "Moderate"
                : "Mild";

          const isCombined = Boolean(imageUrl && wideImageUrl);

          return {
            id: s.analysis_id,
            condition: conditionName,
            localName: guide?.filipinoName || condObj?.local_name || undefined,
            confidence: Number(s.confidence_score ?? 0),
            bodyPart: s.body_part ?? "Skin Assessment",
            rawDate: s.scanned_at,
            date: new Date(s.scanned_at).toLocaleDateString("en-PH", {
              month: "long",
              day: "numeric",
              year: "numeric",
            }),
            severity: patientReportedImpact,
            patientReportedImpact,
            imageUrl,
            wideImageUrl,
            rawPhotoUrl: closeUpRaw,
            rawPhotoUrlWide: wideRaw,
            description: guide?.definition || condObj?.description || "Preliminary AI assessment.",
            symptoms: guide?.commonSymptoms || ["Visual lesion characteristics detected on skin"],
            whoAffected: guide?.whoIsAffected || "General skin assessment",
            careTips:
              guide?.basicCareTips ||
              condObj?.skin_condition_care_tip?.map((t: any) => t.tip_text) || [
                "Keep the skin clean with a gentle, fragrance-free cleanser.",
                "Do not scratch, peel, or apply unprescribed topical medications.",
                "Consult a licensed medical dermatologist for formal diagnosis.",
              ],
            whenToSeeDoctor:
              guide?.whenToSeeDoctor ||
              "Consult a healthcare professional if symptoms persist, cause discomfort, or worsen.",
            medicalSources: guide?.medicalSources || [],
            category: guide?.category || "Dermatology",
            questionnaireAnswers: answersList,
            mappingResult,
            comparison,
            conditionGuide: guide,
            isCombined,
          };
        })
      );

      if (cancelled) return;

      setHistory(mapped);
      setIsLoading(false);

      // Check if a specific scan ID was passed via query parameter
      const targetId = searchParams.get("id");
      if (targetId) {
        const found = mapped.find((item) => item.id === targetId);
        if (found) {
          setSelectedItem(found);
          setActiveTab("overview");
        }
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  const confirmDelete = async () => {
    if (!deleteTarget || isDeleting) return;

    setIsDeleting(true);
    setDeleteError(null);

    const targetId = deleteTarget.id;

    try {
      const { error } = await supabase
        .from("ai_scan_result")
        .delete()
        .eq("analysis_id", targetId);

      if (error) {
        console.error("[SkinHistory] delete error:", error.message);
        setDeleteError("Failed to delete the skin scan. Please try again.");
        setIsDeleting(false);
        return;
      }

      setHistory((prev) => prev.filter((item) => item.id !== targetId));

      if (selectedItem?.id === targetId) {
        setSelectedItem(null);
      }

      setDeleteTarget(null);
    } catch (err: any) {
      console.error("[SkinHistory] delete exception:", err);
      setDeleteError(err?.message || "An unexpected error occurred while deleting.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenItem = (item: SkinHistoryItem) => {
    setSelectedItem(item);
    setActiveTab("overview");
  };

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Skin Analysis History
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Review your past skin scan results, uploaded photos, and 15-question answers.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <div className="w-10 h-10 border-4 border-gray-100 border-t-magenta-600 rounded-full animate-spin" />
          <p className="text-gray-500 font-medium animate-pulse">
            Loading analysis history and skin scan records...
          </p>
        </div>
      ) : history.length > 0 ? (
        <div className="grid grid-cols-1 gap-4">
          <AnimatePresence initial={false}>
            {history.map((item, index) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.2, delay: Math.min(index * 0.04, 0.4) }}
                onClick={() => handleOpenItem(item)}
                className="group bg-white rounded-2xl border border-gray-100 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:shadow-lg hover:shadow-gray-200/40 hover:border-magenta-100 transition-colors transition-shadow cursor-pointer relative"
              >
                <div className="flex items-center gap-5">
                  <div className="w-14 h-14 rounded-xl overflow-hidden ring-4 ring-magenta-50/50 group-hover:ring-magenta-100/50 transition-all shrink-0 bg-magenta-50 relative">
                    {item.imageUrl && !failedImages[item.id] ? (
                      <img
                        src={item.imageUrl}
                        alt={item.condition}
                        className="w-full h-full object-cover"
                        onError={() =>
                          setFailedImages((prev) => ({ ...prev, [item.id]: true }))
                        }
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-magenta-600">
                        <Activity className="w-6 h-6" />
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-gray-900 text-lg group-hover:text-magenta-700 transition-colors">
                        {item.condition}
                      </h3>
                      {item.localName && (
                        <span className="text-xs text-gray-400 hidden md:inline">
                          ({item.localName})
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-1 text-sm text-gray-500">
                      <span className="flex items-center gap-1.5 bg-gray-50/80 px-2 py-0.5 rounded-lg border border-gray-100 text-xs">
                        <MapPin className="w-3.5 h-3.5 text-gray-400" />
                        {item.bodyPart}
                      </span>

                      <span className="flex items-center gap-1.5 bg-gray-50/80 px-2 py-0.5 rounded-lg border border-gray-100 text-xs">
                        <Calendar className="w-3.5 h-3.5 text-gray-400" />
                        {item.date}
                      </span>

                      <span className="flex items-center gap-1.5 font-semibold text-magenta-600 text-xs">
                        <Activity className="w-3.5 h-3.5" />
                        {formatConfidencePercent(item.confidence)} confidence
                      </span>

                      {item.wideImageUrl && (
                        <span className="inline-flex items-center gap-1 bg-magenta-50 text-magenta-700 px-2 py-0.5 rounded-lg border border-magenta-100 text-[11px] font-semibold">
                          <Layers className="w-3 h-3" /> 2 Photos
                        </span>
                      )}

                      {item.questionnaireAnswers && item.questionnaireAnswers.length > 0 && (
                        <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 px-2 py-0.5 rounded-lg border border-slate-200 text-[11px] font-medium">
                          <ClipboardList className="w-3 h-3" /> {item.questionnaireAnswers.length} Answers
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 pl-4 sm:border-l border-gray-100">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteError(null);
                      setDeleteTarget(item);
                    }}
                    className="p-2.5 rounded-xl hover:bg-rose-50 text-gray-300 hover:text-rose-500 transition-all cursor-pointer"
                    title="Delete record"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    className="flex items-center gap-2 bg-gray-50 text-gray-600 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-magenta-50 hover:text-magenta-600 transition-all cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenItem(item);
                    }}
                  >
                    View Full Results
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-dashed border-gray-200 p-16 flex flex-col items-center justify-center text-center">
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            No History Found
          </h2>
          <p className="text-gray-500 max-w-sm mb-8">
            You haven't performed any skin analysis yet. Start your first scan today!
          </p>
          <Link
            to="/dashboard/scan"
            className="bg-magenta-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-magenta-700 transition-all shadow-lg shadow-magenta-100"
          >
            Perform Your First Scan
          </Link>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ModalPortal isOpen={Boolean(deleteTarget)}>
        <AnimatePresence>
          {deleteTarget && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-hidden"
              onClick={() => {
                if (!isDeleting) {
                  setDeleteTarget(null);
                  setDeleteError(null);
                }
              }}
            >
              <motion.div
                initial={{ scale: 0.97, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.97, opacity: 0 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="relative z-[9999] bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-gray-100 text-center"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-500 mb-4 mx-auto">
                  <Trash2 className="w-6 h-6" />
                </div>

                <h3 className="text-lg font-bold text-gray-900 mb-2">
                  Delete Skin Scan?
                </h3>
                <p className="text-sm text-gray-500 leading-relaxed mb-6">
                  Are you sure you want to delete this skin scan result? This action cannot be undone.
                </p>

                {deleteError && (
                  <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-100 text-xs text-rose-600 flex items-center justify-center gap-2 text-center">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                    <span>{deleteError}</span>
                  </div>
                )}

                <div className="flex items-center gap-3 w-full">
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={() => {
                      setDeleteTarget(null);
                      setDeleteError(null);
                    }}
                    className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={confirmDelete}
                    className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold transition-colors shadow-sm disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                  >
                    {isDeleting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Deleting...</span>
                      </>
                    ) : (
                      <span>Delete</span>
                    )}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </ModalPortal>

      {/* Comprehensive View Full Results Modal */}
      <ModalPortal isOpen={Boolean(selectedItem)}>
        <AnimatePresence>
          {selectedItem && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-[9998] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-hidden"
              onClick={() => setSelectedItem(null)}
            >
              <motion.div
                initial={{ scale: 0.97, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.97, opacity: 0 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="relative z-[9999] bg-white rounded-3xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-gray-100 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Modal Header */}
                <div className="p-6 border-b border-gray-100 shrink-0 bg-white">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-magenta-50 text-magenta-700 text-xs font-semibold border border-magenta-100 mb-2">
                        <Sparkles className="w-3.5 h-3.5 text-magenta-600" />
                        <span>AI Preliminary Assessment Result</span>
                      </div>
                      <h2 className="text-2xl font-display font-bold text-gray-900">
                        Possible Condition: {selectedItem.condition}
                      </h2>
                      {selectedItem.localName && selectedItem.localName !== selectedItem.condition && (
                        <p className="text-sm font-medium text-gray-500 italic mt-0.5">
                          Lokal na tawag: {selectedItem.localName}
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedItem(null)}
                      className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors shrink-0 cursor-pointer"
                      title="Close modal"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Navigation Tabs */}
                  <div className="flex items-center gap-2 mt-5 pt-3 border-t border-gray-100 overflow-x-auto no-scrollbar">
                    <button
                      type="button"
                      onClick={() => setActiveTab("overview")}
                      className={cn(
                        "px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 shrink-0 cursor-pointer",
                        activeTab === "overview"
                          ? "bg-magenta-600 text-white shadow-sm shadow-magenta-200"
                          : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                      )}
                    >
                      <Layers className="w-4 h-4" />
                      <span>Overview &amp; Photos</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab("questionnaire")}
                      className={cn(
                        "px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 shrink-0 cursor-pointer",
                        activeTab === "questionnaire"
                          ? "bg-magenta-600 text-white shadow-sm shadow-magenta-200"
                          : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                      )}
                    >
                      <ClipboardList className="w-4 h-4" />
                      <span>Questionnaire Answers</span>
                      {selectedItem.questionnaireAnswers && (
                        <span
                          className={cn(
                            "px-1.5 py-0.2 rounded-full text-[10px] font-bold",
                            activeTab === "questionnaire"
                              ? "bg-white/20 text-white"
                              : "bg-gray-200 text-gray-700"
                          )}
                        >
                          {selectedItem.questionnaireAnswers.length}
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab("guide")}
                      className={cn(
                        "px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 shrink-0 cursor-pointer",
                        activeTab === "guide"
                          ? "bg-magenta-600 text-white shadow-sm shadow-magenta-200"
                          : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                      )}
                    >
                      <BookOpen className="w-4 h-4" />
                      <span>Clinical Guide &amp; Care</span>
                    </button>
                  </div>
                </div>

                {/* Modal Body (Scrollable) */}
                <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-slate-50/30">
                  {/* TAB 1: OVERVIEW & THE 2 REAL PHOTOS */}
                  {activeTab === "overview" && (
                    <div className="space-y-6">
                      {/* Confidence Score Bar */}
                      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs">
                        <div className="flex items-center justify-between mb-1.5">
                          <div>
                            <span className="text-sm font-semibold text-gray-900">
                              AI Confidence Score
                            </span>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Preliminary pattern similarity score — not a clinical diagnosis or calibrated probability.
                            </p>
                          </div>
                          <span className="text-2xl font-bold text-magenta-600 shrink-0 ml-4">
                            {formatConfidencePercent(selectedItem.confidence)}
                          </span>
                        </div>
                        <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden mt-3">
                          <div
                            className="h-full bg-linear-to-r from-magenta-500 to-magenta-600 rounded-full transition-all duration-700"
                            style={{
                              width: `${Math.min(Math.max(Number(selectedItem.confidence) || 0, 0), 100)}%`,
                            }}
                          />
                        </div>
                      </div>

                      {/* 2 REAL IMAGES ANALYZED */}
                      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="font-display font-bold text-gray-900 text-base">
                            Images Analyzed in this Scan
                          </h3>
                          <span className="text-xs text-gray-400">
                            Click photo to zoom
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {/* Photo 1: Close-Up View */}
                          <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-gray-700 uppercase tracking-wider block">
                                Photo 1 — Close-Up View
                              </span>
                              <span className="text-[10px] text-gray-400">Primary lesion</span>
                            </div>
                            <div
                              onClick={() => {
                                if (selectedItem.imageUrl) {
                                  setLightboxImage({
                                    url: selectedItem.imageUrl,
                                    title: "Close-Up View",
                                  });
                                }
                              }}
                              className="relative aspect-4/3 rounded-xl overflow-hidden bg-white border border-gray-200 group cursor-pointer"
                            >
                              {selectedItem.imageUrl ? (
                                <>
                                  <img
                                    src={selectedItem.imageUrl}
                                    alt="Close-up scan photo"
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                  />
                                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/60 text-xs font-semibold backdrop-blur-xs">
                                      <ZoomIn className="w-3.5 h-3.5" />
                                      <span>Enlarge</span>
                                    </div>
                                  </div>
                                </>
                              ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 p-4 text-center">
                                  <Activity className="w-8 h-8 text-gray-300 mb-1" />
                                  <span className="text-xs">No close-up image recorded</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Photo 2: Wider-Area View */}
                          <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-gray-700 uppercase tracking-wider block">
                                Photo 2 — Wider-Area View
                              </span>
                              <span className="text-[10px] text-gray-400">Context &amp; spread</span>
                            </div>
                            <div
                              onClick={() => {
                                if (selectedItem.wideImageUrl) {
                                  setLightboxImage({
                                    url: selectedItem.wideImageUrl,
                                    title: "Wider-Area View",
                                  });
                                }
                              }}
                              className={cn(
                                "relative aspect-4/3 rounded-xl overflow-hidden bg-white border border-gray-200 group",
                                selectedItem.wideImageUrl ? "cursor-pointer" : ""
                              )}
                            >
                              {selectedItem.wideImageUrl && !failedImages[`wide-${selectedItem.id}`] ? (
                                <>
                                  <img
                                    src={selectedItem.wideImageUrl}
                                    alt="Wider-area scan photo"
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                    onError={() =>
                                      setFailedImages((prev) => ({
                                        ...prev,
                                        [`wide-${selectedItem.id}`]: true,
                                      }))
                                    }
                                  />
                                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/60 text-xs font-semibold backdrop-blur-xs">
                                      <ZoomIn className="w-3.5 h-3.5" />
                                      <span>Enlarge</span>
                                    </div>
                                  </div>
                                </>
                              ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 p-4 text-center">
                                  <Info className="w-7 h-7 text-gray-300 mb-1" />
                                  <span className="text-xs font-medium">Single-view scan</span>
                                  <span className="text-[11px] text-gray-400 mt-0.5">
                                    No wide-angle photo was recorded for this analysis.
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Photo assessment feedback */}
                        {selectedItem.wideImageUrl && (
                          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 flex items-start gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                            <span>Both close-up and wider-area photos were verified from your scan records and evaluated by DermAI.</span>
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 pt-2 text-xs text-gray-500">
                          <span className="flex items-center gap-1 bg-gray-50 px-2.5 py-1 rounded-lg border border-gray-100">
                            <MapPin className="w-3.5 h-3.5 text-gray-400" />
                            {selectedItem.bodyPart}
                          </span>
                          <span className="flex items-center gap-1 bg-gray-50 px-2.5 py-1 rounded-lg border border-gray-100">
                            <Calendar className="w-3.5 h-3.5 text-gray-400" />
                            {selectedItem.date}
                          </span>
                        </div>
                      </div>

                      {/* AI vs Questionnaire Agreement / Mismatch Banner */}
                      {selectedItem.comparison && (
                        <div
                          className={cn(
                            "rounded-2xl p-4 border flex items-start gap-3",
                            selectedItem.comparison.agreementStatus === "aligned"
                              ? "bg-emerald-50/80 border-emerald-200 text-emerald-950"
                              : selectedItem.comparison.agreementStatus === "differing"
                                ? "bg-amber-50/80 border-amber-300 text-amber-950"
                                : "bg-slate-100 border-slate-200 text-slate-800"
                          )}
                        >
                          {selectedItem.comparison.agreementStatus === "aligned" ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                          ) : (
                            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                          )}
                          <div className="text-xs leading-relaxed">
                            <p className="font-bold text-sm mb-1">
                              {selectedItem.comparison.agreementStatus === "aligned"
                                ? "Your photos and questionnaire answers match."
                                : selectedItem.comparison.agreementStatus === "differing"
                                  ? "We noticed a mismatch in your results"
                                  : "Assessment Context"}
                            </p>
                            <p>
                              {selectedItem.comparison.summary?.includes("increases the accuracy")
                                ? "The AI noticed signs in your photo that match the symptoms you selected in the questionnaire. This supports the result."
                                : selectedItem.comparison.summary?.includes("provide limited specific support")
                                  ? `Your photo looks like it might be ${selectedItem.condition || "this condition"}, but this doesn't fully match the symptoms you selected in the questionnaire.`
                                  : selectedItem.comparison.summary}
                            </p>
                            <p className="font-semibold mt-1.5">
                              {selectedItem.comparison.recommendation?.includes("Image-based predictions may capture")
                                ? "Photos can sometimes be misleading on their own. Please consult a dermatologist to review your symptoms in person."
                                : selectedItem.comparison.recommendation}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Safety Alert (Q14) if emergency or urgent */}
                      {selectedItem.mappingResult?.safetyAlert &&
                        selectedItem.mappingResult.safetyAlert.level !== "none" && (
                          <div
                            className={cn(
                              "rounded-2xl p-5 border-2 flex items-start gap-3.5",
                              selectedItem.mappingResult.safetyAlert.level === "emergency"
                                ? "bg-rose-50 border-rose-300 text-rose-950"
                                : "bg-amber-50 border-amber-300 text-amber-950"
                            )}
                          >
                            <ShieldAlert
                              className={cn(
                                "w-6 h-6 shrink-0 mt-0.5",
                                selectedItem.mappingResult.safetyAlert.level === "emergency"
                                  ? "text-rose-600"
                                  : "text-amber-600"
                              )}
                            />
                            <div className="text-xs leading-relaxed space-y-1">
                              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-white/80 border">
                                Safety Alert (Question 14)
                              </span>
                              <h4 className="text-sm font-bold">
                                {selectedItem.mappingResult.safetyAlert.title}
                              </h4>
                              <p>{selectedItem.mappingResult.safetyAlert.message}</p>
                              <p className="font-semibold text-rose-800 mt-1">
                                Action Required: {selectedItem.mappingResult.safetyAlert.actionRequired}
                              </p>
                            </div>
                          </div>
                        )}

                      {/* Quick Summary Card */}
                      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs space-y-3">
                        <h3 className="font-display font-bold text-gray-900 text-base">
                          What is {selectedItem.condition}?
                        </h3>
                        <p className="text-sm text-gray-600 leading-relaxed">
                          {selectedItem.description}
                        </p>
                        <div className="pt-2">
                          <button
                            type="button"
                            onClick={() => setActiveTab("guide")}
                            className="text-xs text-magenta-600 font-semibold hover:text-magenta-700 flex items-center gap-1 cursor-pointer"
                          >
                            <span>Read full clinical symptoms, who is affected &amp; care tips</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB 2: REAL QUESTIONNAIRE RESPONSES (15 QUESTIONS) */}
                  {activeTab === "questionnaire" && (
                    <div className="space-y-6">
                      {/* Evidence Support Header */}
                      {selectedItem.mappingResult && (
                        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs space-y-4">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div>
                              <h3 className="font-display font-bold text-gray-900 text-base">
                                Questionnaire Evidence Support
                              </h3>
                              <p className="text-xs text-gray-500">
                                Evaluated against standard dermatology criteria (AAD &amp; DermNet NZ).
                              </p>
                            </div>
                            {(() => {
                              const condEval =
                                (selectedItem.mappingResult.conditions as any)[selectedItem.condition] ||
                                Object.values(selectedItem.mappingResult.conditions).find((c) =>
                                  selectedItem.condition.toLowerCase().includes(c.condition.toLowerCase())
                                );
                              const level = condEval?.supportLevel || "Assessment context available";

                              return (
                                <span
                                  className={cn(
                                    "px-3 py-1 rounded-full text-xs font-bold shrink-0 border self-start sm:self-auto",
                                    level === "Strong support"
                                      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                                      : level === "Moderate support"
                                        ? "bg-blue-100 text-blue-800 border-blue-200"
                                        : "bg-slate-100 text-slate-700 border-slate-200"
                                  )}
                                >
                                  {level}
                                </span>
                              );
                            })()}
                          </div>

                          {/* Supporting Findings */}
                          {(() => {
                            const condEval =
                              (selectedItem.mappingResult.conditions as any)[selectedItem.condition] ||
                              Object.values(selectedItem.mappingResult.conditions).find((c) =>
                                selectedItem.condition.toLowerCase().includes(c.condition.toLowerCase())
                              );
                            const findings = condEval?.supportingFindings || [];
                            const limitations = condEval?.limitations || [];

                            if (findings.length === 0 && limitations.length === 0) return null;

                            return (
                              <div className="space-y-3 bg-slate-50/70 rounded-xl p-4 border border-slate-200/80 text-xs">
                                {findings.length > 0 && (
                                  <div>
                                    <span className="font-bold text-slate-800 block mb-1.5">
                                      Key Supporting Findings from Your Answers:
                                    </span>
                                    <ul className="space-y-1">
                                      {findings.map((f: string, i: number) => (
                                        <li key={i} className="flex items-start gap-2 text-slate-700">
                                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                                          <span>{f}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                                {limitations.length > 0 && (
                                  <div className="pt-2 border-t border-slate-200">
                                    <span className="font-bold text-slate-700 block mb-1">
                                      Clinical Nuances:
                                    </span>
                                    <ul className="space-y-1">
                                      {limitations.map((lim: string, i: number) => (
                                        <li key={i} className="flex items-start gap-2 text-slate-600">
                                          <div className="w-1.5 h-1.5 rounded-full bg-slate-400 mt-1.5 shrink-0" />
                                          <span>{lim}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {/* Full List of Patient Answers */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between px-1">
                          <h3 className="font-display font-bold text-gray-900 text-sm">
                            Your 15-Question Assessment Responses
                          </h3>
                          <span className="text-xs text-gray-500">
                            {selectedItem.questionnaireAnswers?.length || 0} Questions Answered
                          </span>
                        </div>

                        {selectedItem.questionnaireAnswers && selectedItem.questionnaireAnswers.length > 0 ? (
                          <div className="space-y-3">
                            {selectedItem.questionnaireAnswers.map((item, idx) => (
                              <div
                                key={item.id}
                                className="p-4 rounded-2xl bg-white border border-gray-100 shadow-2xs hover:border-magenta-100 transition-colors"
                              >
                                <div className="flex items-center justify-between gap-2 mb-1.5">
                                  <span className="text-xs font-bold text-magenta-700 bg-magenta-50 px-2.5 py-0.5 rounded-lg border border-magenta-100">
                                    Question {item.number || idx + 1}
                                  </span>
                                  <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                                    {formatRoleName(item.role)}
                                  </span>
                                </div>

                                <h4 className="text-sm font-bold text-gray-900">
                                  {item.question}
                                </h4>
                                {item.tagalogQuestion && item.tagalogQuestion !== item.question && (
                                  <p className="text-xs text-gray-500 italic mt-0.5">
                                    {item.tagalogQuestion}
                                  </p>
                                )}

                                <div className="mt-3 pt-2.5 border-t border-gray-100 flex flex-wrap gap-2 items-center">
                                  <span className="text-xs font-semibold text-gray-600">
                                    Your Answer:
                                  </span>
                                  <div className="inline-flex items-center px-3 py-1 rounded-xl text-xs font-semibold bg-gray-50 text-gray-900 border border-gray-200">
                                    <span>{item.answer}</span>
                                    {item.tagalogAnswer && item.tagalogAnswer !== item.answer && item.tagalogAnswer !== "Hindi sinagot" && (
                                      <>
                                        <span className="text-gray-300 mx-1.5">/</span>
                                        <span className="text-gray-500 font-normal italic">
                                          {item.tagalogAnswer}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-8 text-center bg-white rounded-2xl border border-gray-100">
                            <FileQuestion className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                            <h4 className="text-sm font-bold text-gray-800">
                              No Questionnaire Record Found
                            </h4>
                            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                              This skin scan was completed without the questionnaire pre-screening or uses legacy data format.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* TAB 3: CONDITION GUIDE & CARE */}
                  {activeTab === "guide" && (
                    <div className="space-y-6">
                      {/* What is it */}
                      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs space-y-2">
                        <h3 className="font-display font-bold text-gray-900 text-base">
                          What is {selectedItem.condition}?
                        </h3>
                        <p className="text-sm text-gray-600 leading-relaxed">
                          {selectedItem.description}
                        </p>
                      </div>

                      {/* Common Symptoms */}
                      {selectedItem.symptoms && selectedItem.symptoms.length > 0 && (
                        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs space-y-3">
                          <h3 className="font-display font-bold text-gray-900 text-base">
                            Common Symptoms
                          </h3>
                          <ul className="space-y-2">
                            {selectedItem.symptoms.map((s, i) => (
                              <li key={i} className="flex items-start gap-2.5 text-sm text-gray-700">
                                <div className="w-1.5 h-1.5 rounded-full bg-magenta-500 mt-2 shrink-0" />
                                <span>{s}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Who does it affect */}
                      {selectedItem.whoAffected && (
                        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs space-y-2">
                          <div className="flex items-center gap-2">
                            <Users className="w-4 h-4 text-magenta-600" />
                            <h3 className="font-display font-bold text-gray-900 text-base">
                              Who Does It Affect?
                            </h3>
                          </div>
                          <p className="text-sm text-gray-600 leading-relaxed">
                            {selectedItem.whoAffected}
                          </p>
                        </div>
                      )}

                      {/* Basic Care Tips */}
                      {selectedItem.careTips && selectedItem.careTips.length > 0 && (
                        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs space-y-3">
                          <h3 className="font-display font-bold text-gray-900 text-base">
                            Basic Care Tips
                          </h3>
                          <ul className="space-y-2.5">
                            {selectedItem.careTips.map((tip, i) => (
                              <li key={i} className="flex items-start gap-2.5 text-sm text-gray-700">
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                                <span className="leading-relaxed">{tip}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* When to see a doctor */}
                      {selectedItem.whenToSeeDoctor && (
                        <div className="bg-amber-50/70 rounded-2xl p-5 border border-amber-200/80 space-y-2">
                          <div className="flex items-center gap-2">
                            <Stethoscope className="w-4 h-4 text-amber-700" />
                            <h3 className="font-display font-bold text-amber-950 text-base">
                              When to See a Doctor
                            </h3>
                          </div>
                          <p className="text-sm text-amber-900 leading-relaxed">
                            {selectedItem.whenToSeeDoctor}
                          </p>
                        </div>
                      )}

                      {/* Medical Sources */}
                      {selectedItem.medicalSources && selectedItem.medicalSources.length > 0 && (
                        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-xs space-y-3">
                          <span className="text-xs font-bold text-gray-800 uppercase tracking-wider block">
                            Verified Medical Sources &amp; Clinical Citations:
                          </span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {selectedItem.medicalSources.map((src, i) => (
                              <a
                                key={i}
                                href={src.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-200 text-xs text-gray-700 hover:text-magenta-700 hover:border-magenta-300 hover:bg-magenta-50/20 transition-all"
                              >
                                <span className="truncate pr-2 font-medium">
                                  {src.organization}: {src.title}
                                </span>
                                <ExternalLink className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Medical Disclaimer */}
                      <div className="bg-rose-50/60 rounded-2xl p-4 flex gap-3 border border-rose-100">
                        <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-bold text-rose-900 mb-0.5">
                            Medical Disclaimer
                          </p>
                          <p className="text-xs text-rose-800 leading-relaxed">
                            This AI assessment and rule-based questionnaire mapping are intended for educational and pre-screening purposes only. It is <strong>NOT</strong> a clinical diagnosis and cannot replace an in-person examination by a licensed medical dermatologist.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Modal Footer */}
                <div className="p-4 sm:p-5 border-t border-gray-100 bg-white flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
                  <div className="text-xs text-gray-400 text-center sm:text-left">
                    Scan recorded on {selectedItem.date}
                  </div>

                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => setSelectedItem(null)}
                      className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors w-full sm:w-auto cursor-pointer"
                    >
                      Close
                    </button>
                    <Link
                      to={`/dashboard/clinics?condition=${encodeURIComponent(selectedItem.condition)}`}
                      onClick={() => setSelectedItem(null)}
                      className="px-6 py-2.5 rounded-xl bg-magenta-600 hover:bg-magenta-700 text-white text-sm font-bold transition-all shadow-md shadow-magenta-600/20 text-center w-full sm:w-auto cursor-pointer active:scale-98"
                    >
                      Find a Dermatologist Near You
                    </Link>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </ModalPortal>

      {/* Lightbox Modal for Photo Zoom */}
      <ModalPortal isOpen={Boolean(lightboxImage)}>
        <AnimatePresence>
          {lightboxImage && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/85 backdrop-blur-xs overflow-hidden"
              onClick={() => setLightboxImage(null)}
            >
              <motion.div
                initial={{ scale: 0.96, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.96, opacity: 0 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="relative max-w-4xl max-h-[90vh] bg-transparent rounded-2xl overflow-hidden flex flex-col items-center"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="absolute top-3 right-3 z-10">
                  <button
                    type="button"
                    onClick={() => setLightboxImage(null)}
                    className="p-2 rounded-full bg-black/60 text-white hover:bg-black/90 transition-colors cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <img
                  src={lightboxImage.url}
                  alt={lightboxImage.title}
                  className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl"
                />
                <span className="text-white text-xs font-semibold mt-2 px-3 py-1 bg-black/50 rounded-full">
                  {lightboxImage.title}
                </span>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </ModalPortal>
    </div>
  );
}