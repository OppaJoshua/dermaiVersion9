import React, { useState, useRef, useMemo, useEffect } from "react";
import { Link, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import {
  Camera,
  Image,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  MapPin,
  ArrowRight,
  ArrowLeft,
  Users,
  Stethoscope,
  ShieldAlert,
  ExternalLink,
  Edit3,
  HelpCircle,
  Info,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "../../lib/utils";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import { predictSkinCondition, getConditionUUID, AIPredictionError } from "../../lib/aiApi";
import { createPatientNotification } from "../../lib/notificationService";
import {
  QUESTIONNAIRE_QUESTIONS,
  toggleOptionSelection,
} from "../../data/questionnaireData";
import type { QuestionnaireQuestion } from "../../data/questionnaireData";
import {
  evaluateDiseaseMapping,
  compareAIAndQuestionnaire,
  evaluateSafetyWarnings,
  normalizeAnswers,
} from "../../lib/diseaseMappingService";
import type {
  DiseaseMappingResult,
  AIQuestionnaireComparison,
} from "../../lib/diseaseMappingService";
import { getConditionGuide } from "../../data/conditionGuides";
import type { ConditionGuide } from "../../data/conditionGuides";

const steps = [
  { label: "Answer Questions", number: 1 },
  { label: "Upload Photo", number: 2 },
  { label: "View Result", number: 3 },
];

interface ScanResultData {
  id: string;
  condition: string;
  localName: string;
  confidence: number;
  bodyPart: string;
  date: string;
  severity: "Mild" | "Moderate" | "Severe"; // Legacy field preserved for consumers: stores patient-reported impact
  patientReportedImpact?: "Mild" | "Moderate" | "Severe";
  description: string;
  symptoms: string[];
  whoAffected: string;
  careTips: string[];
  whenToSeeDoctor: string;
  imageUrl?: string;
  wideImageUrl?: string;
  mappingResult: DiseaseMappingResult;
  comparison: AIQuestionnaireComparison;
  conditionGuide: ConditionGuide | null;
  primaryPrediction?: {
    predicted_class?: string;
    display_name?: string;
    confidence?: number;
    status?: string;
  } | null;
  supportingPrediction?: {
    predicted_class?: string;
    display_name?: string;
    confidence?: number;
    status?: string;
    error?: string;
  } | null;
  isCombined?: boolean;
  agreement?: boolean | null;
  combinedEvidenceScore?: number | null;
}

interface RecommendedClinic {
  name: string;
  addr: string;
  verified?: boolean;
}

export default function ScanSkinPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  // Booking-origin context: ONLY active if explicitly launched from Appointment booking flow
  const location = useLocation();
  const isBookingOrigin = useMemo(() => {
    const hasQueryParam =
      searchParams.get("fromAppointment") === "1" ||
      searchParams.get("returnTo") === "appointment";
    const hasLocationState = Boolean((location.state as any)?.fromAppointment);
    return hasQueryParam || hasLocationState;
  }, [searchParams, location.state]);

  const returnClinicId = useMemo(() => {
    if (!isBookingOrigin) return "";
    const fromParam = searchParams.get("clinic");
    if (fromParam) return fromParam;
    const fromState = (location.state as any)?.clinicId;
    if (fromState) return String(fromState);
    try {
      return sessionStorage.getItem("dermai_booking_return_clinic") || "";
    } catch {
      return "";
    }
  }, [isBookingOrigin, searchParams, location.state]);

  useEffect(() => {
    if (!isBookingOrigin) {
      try {
        sessionStorage.removeItem("dermai_booking_return_clinic");
        sessionStorage.removeItem("dermai_scan_booking_context");
      } catch { }
    } else if (returnClinicId) {
      try {
        sessionStorage.setItem("dermai_booking_return_clinic", returnClinicId);
      } catch { }
    }
  }, [isBookingOrigin, returnClinicId]);

  const [currentStep, setCurrentStep] = useState(1);
  const [qIndex, setQIndex] = useState(0);
  const [isReviewing, setIsReviewing] = useState(false);

  // Store answers as map of question ID to array of option IDs
  const [answers, setAnswers] = useState<Record<string, string[]>>(() => {
    try {
      const saved = sessionStorage.getItem("dermai_scan_answers_v2");
      if (saved) return JSON.parse(saved);

      // Handle migration from legacy single-index format
      const legacy = sessionStorage.getItem("dermai_scan_answers");
      if (legacy) {
        const parsed = JSON.parse(legacy);
        const migrated: Record<string, string[]> = {};
        for (const [k, val] of Object.entries(parsed)) {
          const q = QUESTIONNAIRE_QUESTIONS.find((item) => item.id === k);
          if (q && typeof val === "number" && q.options[val]) {
            migrated[k] = [q.options[val].id];
          }
        }
        return migrated;
      }
      return {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem("dermai_scan_answers_v2", JSON.stringify(answers));
    } catch { }
  }, [answers]);

  const currentQuestion: QuestionnaireQuestion = QUESTIONNAIRE_QUESTIONS[qIndex] || QUESTIONNAIRE_QUESTIONS[0];
  const currentSelections = answers[currentQuestion.id] || [];
  const hasAnsweredCurrent = currentSelections.length > 0;

  // Real-time safety alert computed from Q14
  const activeSafetyAlert = useMemo(() => {
    return evaluateSafetyWarnings(normalizeAnswers(answers));
  }, [answers]);

  const closeUpInputRef = useRef<HTMLInputElement>(null);
  const closeUpCameraRef = useRef<HTMLInputElement>(null);
  const wideInputRef = useRef<HTMLInputElement>(null);
  const wideCameraRef = useRef<HTMLInputElement>(null);
  const [closeUpFile, setCloseUpFile] = useState<File | null>(null);
  const [closeUpImage, setCloseUpImage] = useState<string | null>(null);
  const [wideFile, setWideFile] = useState<File | null>(null);
  const [wideImage, setWideImage] = useState<string | null>(null);
  const allPhotosUploaded = !!closeUpImage && !!wideImage;

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResultData | null>(null);
  const [recommendedClinics, setRecommendedClinics] = useState<RecommendedClinic[]>([]);

  const [subData, setSubData] = useState({ scansUsed: 0, scanLimit: 3, isPro: false });

  useEffect(() => {
    const loadSubscription = async () => {
      try {
        if (!user?.id) {
          setSubData({ scansUsed: 0, scanLimit: 3, isPro: false });
          return;
        }

        const { data: sub } = await supabase
          .from("user_plan_subscription")
          .select("status, started_at, current_period_start, current_period_end, plan:plan_id(scan_limit)")
          .eq("user_id", user.id)
          .eq("status", "active")
          .maybeSingle();

        const hasValidPaidPeriod = Boolean(
          sub?.current_period_end &&
          new Date(sub.current_period_end).getTime() > Date.now()
        );
        const planScanLimit: number = hasValidPaidPeriod
          ? (sub?.plan as any)?.scan_limit ?? 3
          : 3;
        const isPro = hasValidPaidPeriod && planScanLimit === -1;

        // Expired subscriptions use the current calendar month's Free scan cycle.
        const cycleStart: string = hasValidPaidPeriod
          ? (sub as any)?.current_period_start ||
          (sub as any)?.started_at ||
          new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
          : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

        const { count: used } = await supabase
          .from("ai_scan_result")
          .select("*", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("status", "completed")
          .gte("scanned_at", cycleStart);

        setSubData({
          scansUsed: used ?? 0,
          scanLimit: planScanLimit,
          isPro,
        });
      } catch (err) {
        console.error("Failed to load subscription data:", err);
      }
    };
    loadSubscription();
  }, [user]);

  const isPro = subData.isPro;
  const remainingScans = isPro ? Infinity : Math.max(0, subData.scanLimit - subData.scansUsed);
  const canScan = isPro || remainingScans > 0;

  useEffect(() => {
    if (!showResult || !scanResult) return;
    const loadRecommendedClinics = async () => {
      try {
        setRecommendedClinics([]);
      } catch (err) {
        console.error("Failed to load recommended clinics:", err);
      }
    };
    loadRecommendedClinics();
  }, [showResult, scanResult]);

  const selectOption = (optId: string) => {
    setAnswers((prev) => {
      const cur = prev[currentQuestion.id] || [];
      const updated = toggleOptionSelection(cur, optId, currentQuestion);
      return { ...prev, [currentQuestion.id]: updated };
    });
  };

  const goNextQuestion = () => {
    if (qIndex < QUESTIONNAIRE_QUESTIONS.length - 1) {
      setQIndex((i) => i + 1);
    } else {
      setIsReviewing(true);
    }
  };

  const goPrevQuestion = () => {
    if (isReviewing) {
      setIsReviewing(false);
      setQIndex(QUESTIONNAIRE_QUESTIONS.length - 1);
    } else if (qIndex > 0) {
      setQIndex((i) => i - 1);
    }
  };

  const jumpToQuestion = (index: number) => {
    setQIndex(index);
    setIsReviewing(false);
  };

  const handleFileChange = (slot: "closeup" | "wide") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (slot === "closeup") {
      setCloseUpFile(file);
      setCloseUpImage(URL.createObjectURL(file));
    } else {
      setWideFile(file);
      setWideImage(URL.createObjectURL(file));
    }
    e.target.value = "";
  };

  const clearPhoto = (slot: "closeup" | "wide") => {
    if (slot === "closeup") {
      if (closeUpImage) URL.revokeObjectURL(closeUpImage);
      setCloseUpFile(null);
      setCloseUpImage(null);
    } else {
      if (wideImage) URL.revokeObjectURL(wideImage);
      setWideFile(null);
      setWideImage(null);
    }
  };

  const handleAnalyze = async () => {
    if (!user?.id) {
      setAnalyzeError("You must be signed in to analyze and save your skin scan.");
      return;
    }
    if (!isPro && !canScan) {
      navigate("/dashboard/upgrade");
      return;
    }
    if (!closeUpFile || !wideFile) return;

    setIsAnalyzing(true);
    setAnalyzeError(null);

    let analysisId: string | null = null;
    let uploadedCloseUpPath: string | undefined;
    let uploadedWidePath: string | undefined;

    try {
      // 1. Build standardized questionnaire payload
      const questionnaireData = QUESTIONNAIRE_QUESTIONS.map((q) => {
        const chosenIds = answers[q.id] || [];
        const chosenOptions = q.options.filter((o) => chosenIds.includes(o.id));
        const answerEn = chosenOptions.map((o) => o.labelEn).join("; ") || "Not answered";
        const answerTl = chosenOptions.map((o) => o.labelTl).join("; ") || "Hindi sinagot";
        return {
          id: q.id,
          question: q.titleEn,
          tagalogQuestion: q.titleTl,
          answer: answerEn,
          tagalogAnswer: answerTl,
          selectedOptionIds: chosenIds,
          role: q.role,
        };
      });

      // 2. Evaluate Disease Mapping rule-based support
      const mappingResult = evaluateDiseaseMapping(answers);

      // 3. ResNet50 inference via FastAPI backend
      let aiResult;
      try {
        aiResult = await predictSkinCondition(closeUpFile, wideFile);
      } catch (err) {
        const errMsg =
          err instanceof AIPredictionError
            ? err.message
            : "We couldn't complete your skin analysis. Please try again.";
        throw new Error(errMsg, { cause: err });
      }

      // 4. Compare AI prediction and Questionnaire support independently
      const comparison = compareAIAndQuestionnaire(
        aiResult.display_name,
        aiResult.confidence,
        mappingResult
      );

      // 5. Retrieve condition definition and evidence care tips
      const conditionGuide = getConditionGuide(aiResult.display_name);

      // 6. Persistence to Supabase
      const conditionUUID = getConditionUUID(aiResult.predicted_class);

      if (user?.id) {
        const ts = Date.now();
        const sanitizeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_");

        // Upload close-up
        const safeCloseUpName = sanitizeFileName(closeUpFile.name);
        const closeUpPath = `${user.id}/${ts}_close_up_${safeCloseUpName}`;
        const { error: upErr1 } = await supabase.storage
          .from("scan-uploads")
          .upload(closeUpPath, closeUpFile, { upsert: true });
        if (!upErr1) {
          uploadedCloseUpPath = closeUpPath;
        } else {
          console.error("[ScanSkin] Close-up upload error:", upErr1.message);
        }

        // Upload wide view
        const safeWideName = sanitizeFileName(wideFile.name);
        const widePath = `${user.id}/${ts}_wide_${safeWideName}`;
        const { error: upErr2 } = await supabase.storage
          .from("scan-uploads")
          .upload(widePath, wideFile, { upsert: true });
        if (!upErr2) {
          uploadedWidePath = widePath;
        } else {
          console.error("[ScanSkin] Wide-view upload error:", upErr2.message);
        }

        // Insert into ai_scan_result with questionnaire_answers
        const { data: scanInsertData, error: insertErr } = await supabase
          .from("ai_scan_result")
          .insert({
            user_id: user.id,
            confidence_score: aiResult.confidence,
            status: "completed",
            condition_id: conditionUUID,
            photo_url: uploadedCloseUpPath || null,
            photo_url_wide: uploadedWidePath || null,
            body_part: "Skin Assessment",
            questionnaire_answers: questionnaireData,
          })
          .select("analysis_id")
          .maybeSingle();

        if (insertErr) {
          console.error("[ScanSkin] Failed to insert ai_scan_result:", insertErr);
          // Clean up newly uploaded files from this failed attempt to avoid orphaned files
          const filesToClean = [uploadedCloseUpPath, uploadedWidePath].filter(
            (p): p is string => Boolean(p)
          );
          if (filesToClean.length > 0) {
            try {
              await supabase.storage.from("scan-uploads").remove(filesToClean);
            } catch (cleanupErr) {
              console.warn("[ScanSkin] Orphan storage cleanup skipped:", cleanupErr);
            }
          }
          throw new Error("We couldn't save your scan result. Please try again. Your scan has not been confirmed as saved.");
        } else if (scanInsertData?.analysis_id) {
          analysisId = scanInsertData.analysis_id;

          // Also save to ai_skin_answer table if present and authorized
          try {
            const skinAnswerRows = questionnaireData.map((item, idx) => ({
              analysis_id: analysisId,
              question_key: item.id,
              answer_value: item.answer,
              sort_order: idx + 1,
            }));
            const { error: ansErr } = await supabase.from("ai_skin_answer").insert(skinAnswerRows);
            if (ansErr) {
              console.warn("ai_skin_answer secondary table write skipped:", ansErr.message);
            }
          } catch (secErr) {
            console.warn("ai_skin_answer secondary write skipped:", secErr);
          }

          // Deduct 1 scan from local allowance state only upon confirmed insert
          setSubData((prev) => ({
            ...prev,
            scansUsed: prev.scansUsed + 1,
          }));
        }
      }

      // 7. Cache last scan in localStorage for appointment booking
      // Patient-reported daily-life impact (Q13) only — NOT clinical disease severity,
      // and kept strictly separate from Q14 acute safety referral / emergency warnings.
      const patientReportedImpact: "Mild" | "Moderate" | "Severe" =
        mappingResult.contextualImpact.level === "severe"
          ? "Severe"
          : mappingResult.contextualImpact.level === "moderate"
            ? "Moderate"
            : "Mild";

      try {
        localStorage.setItem(
          "dermai_last_scan",
          JSON.stringify({
            predictedClass: aiResult.predicted_class,
            displayName: aiResult.display_name,
            confidence: aiResult.confidence,
            severity: patientReportedImpact, // Preserves backward compatibility: explicitly patient-reported impact
            patientReportedImpact,
            questionnaire: questionnaireData,
            photoUrl: uploadedCloseUpPath || closeUpImage,
            photoUrlWide: uploadedWidePath || wideImage,
            analysisId,
            timestamp: Date.now(),
            mappingResult,
            comparison,
          })
        );
      } catch {
        /* ignore storage quota errors */
      }

      // 8. Set complete UI result
      setScanResult({
        id: analysisId || `scan-${Date.now()}`,
        condition: aiResult.display_name,
        localName: conditionGuide?.filipinoName || aiResult.display_name,
        confidence: aiResult.confidence,
        bodyPart: "Uploaded Photos & 15-Question Assessment",
        date: new Date().toLocaleDateString("en-PH", {
          month: "long",
          day: "numeric",
          year: "numeric",
        }),
        severity: patientReportedImpact,
        patientReportedImpact,
        description: conditionGuide?.definition || "Preliminary AI assessment.",
        symptoms: conditionGuide?.commonSymptoms || ["Detected from uploaded skin photo"],
        whoAffected: conditionGuide?.whoIsAffected || "General assessment",
        careTips: conditionGuide?.basicCareTips || [
          "Do not scratch, peel, or apply unprescribed topical steroids.",
          "Keep the skin clean with a gentle, fragrance-free cleanser.",
          "Consult a licensed dermatologist for formal evaluation.",
        ],
        whenToSeeDoctor:
          conditionGuide?.whenToSeeDoctor ||
          "Consult a healthcare professional if symptoms persist or cause discomfort.",
        imageUrl: closeUpImage || undefined,
        wideImageUrl: wideImage || undefined,
        mappingResult,
        comparison,
        conditionGuide,
        primaryPrediction: aiResult.primary_prediction || {
          predicted_class: aiResult.predicted_class,
          display_name: aiResult.display_name,
          confidence: aiResult.confidence,
          status: "valid",
        },
        supportingPrediction: aiResult.supporting_prediction || null,
        isCombined: aiResult.is_combined,
        agreement: aiResult.agreement,
        combinedEvidenceScore: aiResult.combined_evidence_score ?? null,
      });

      setShowResult(true);
      setCurrentStep(3);

      if (user?.id) {
        createPatientNotification({
          userId: user.id,
          type: "scan-completed",
          title: "AI Skin Scan Complete",
          body: `Preliminary assessment: ${aiResult.display_name} (${Math.round(aiResult.confidence || 0)}% confidence). View details in your skin history.`,
        });
      }
    } catch (err) {
      console.error("[ScanSkin] Analysis failed:", err);
      setAnalyzeError(
        err instanceof Error
          ? err.message
          : "We couldn't complete your skin analysis. Please try again."
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleScanBookingContext = () => {
    if (scanResult) {
      try {
        const questionnairePayload = QUESTIONNAIRE_QUESTIONS.map((q) => {
          const chosenIds = answers[q.id] || [];
          const chosenOpts = q.options.filter((o) => chosenIds.includes(o.id));
          return {
            id: q.id,
            question: q.titleEn,
            tagalogQuestion: q.titleTl,
            answer: chosenOpts.map((o) => o.labelEn).join("; ") || "Not answered",
            tagalogAnswer: chosenOpts.map((o) => o.labelTl).join("; ") || "Hindi sinagot",
            selectedOptionIds: chosenIds,
          };
        });

        sessionStorage.setItem(
          "dermai_scan_booking_context",
          JSON.stringify({
            scanId: scanResult.id,
            condition: scanResult.condition,
            confidence: Math.round(scanResult.confidence || 0),
            photoUrl: scanResult.imageUrl || "",
            questionnaire: questionnairePayload,
            timestamp: Date.now(),
          })
        );
      } catch {
        /* ignore storage errors */
      }
    }
  };

  const scanClinicsUrl = scanResult
    ? `/dashboard/clinics?fromScan=1&scanId=${encodeURIComponent(scanResult.id)}&condition=${encodeURIComponent(scanResult.condition)}&confidence=${encodeURIComponent(String(Math.round(scanResult.confidence || 0)))}`
    : "/dashboard/clinics";

  const returnAppointmentUrl = useMemo(() => {
    if (!scanResult) {
      return returnClinicId
        ? `/dashboard/appointment?clinic=${encodeURIComponent(returnClinicId)}`
        : "/dashboard/appointment";
    }
    const base = `/dashboard/appointment?fromScan=1&scanId=${encodeURIComponent(scanResult.id)}&condition=${encodeURIComponent(scanResult.condition)}&confidence=${encodeURIComponent(String(Math.round(scanResult.confidence || 0)))}`;
    return returnClinicId ? `${base}&clinic=${encodeURIComponent(returnClinicId)}` : base;
  }, [scanResult, returnClinicId]);

  return (
    <div className="min-h-screen bg-slate-50/50 text-slate-900 pt-8 pb-16">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <input
          ref={closeUpInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange("closeup")}
        />
        <input
          ref={closeUpCameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileChange("closeup")}
        />
        <input
          ref={wideInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange("wide")}
        />
        <input
          ref={wideCameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileChange("wide")}
        />

        {isBookingOrigin && (
          <div className="mb-6 flex items-center justify-between bg-magenta-50 border border-magenta-200 rounded-xl px-4 py-2.5 text-xs text-magenta-900">
            <span className="font-semibold flex items-center gap-1.5">
              <span>Appointment booking in progress</span>
            </span>
            <Link
              to={returnClinicId ? `/dashboard/appointment?clinic=${encodeURIComponent(returnClinicId)}` : "/dashboard/appointment"}
              className="text-magenta-700 font-bold hover:underline"
            >
              Cancel &amp; return to appointment
            </Link>
          </div>
        )}

        <div className="text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-slate-900 mb-2">
            Scan Your Skin
          </h1>
          <p className="text-slate-500 text-sm">
            Complete the 15-question pre-screening and upload skin photos for an evidence-informed AI assessment
          </p>
        </div>

        {/* Multi-step progress bar */}
        <div className="flex items-center justify-center gap-0 mb-8">
          {steps.map((step, i) => (
            <div key={step.number} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300",
                    currentStep >= step.number
                      ? "bg-magenta-600 text-white shadow-md shadow-magenta-600/30"
                      : "bg-slate-200 text-slate-500"
                  )}
                >
                  {currentStep > step.number ? <CheckCircle2 className="w-5 h-5" /> : step.number}
                </div>
                <span
                  className={cn(
                    "text-xs mt-2 font-medium",
                    currentStep >= step.number ? "text-magenta-700 font-semibold" : "text-slate-400"
                  )}
                >
                  {step.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div
                  className={cn(
                    "w-16 sm:w-24 h-0.5 mx-2 transition-colors",
                    currentStep > step.number ? "bg-magenta-600" : "bg-slate-200"
                  )}
                />
              )}
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* =========================================================================
              STEP 1: Questionnaire — One question at a time or Review Step
             ========================================================================= */}
          {currentStep === 1 && !isReviewing && (
            <motion.div
              key={`q-${currentQuestion.id}`}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="bg-white rounded-3xl border border-slate-200/90 shadow-sm p-6 sm:p-8"
            >
              {/* Question header and progress */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-magenta-50 text-magenta-700 border border-magenta-100">
                    Question {qIndex + 1} of {QUESTIONNAIRE_QUESTIONS.length}
                  </span>
                  {currentQuestion.isMultiSelect && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                      Multi-select / Piliin lahat ng naaangkop
                    </span>
                  )}
                </div>
                <div className="w-28 sm:w-36 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-magenta-600 rounded-full transition-all duration-300"
                    style={{ width: `${((qIndex + 1) / QUESTIONNAIRE_QUESTIONS.length) * 100}%` }}
                  />
                </div>
              </div>

              {/* Bilingual Question Title */}
              <div className="mb-4">
                <h2 className="text-lg sm:text-xl font-display font-bold text-slate-900 leading-snug">
                  {currentQuestion.titleEn}
                </h2>
                <p className="text-sm font-medium text-slate-500 italic mt-0.5">
                  {currentQuestion.titleTl}
                </p>
                {currentQuestion.helperEn && (
                  <p className="text-xs text-slate-400 mt-2 flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{currentQuestion.helperEn}</span>
                  </p>
                )}
              </div>

              {/* Options */}
              <div className="space-y-2.5 mb-8">
                {currentQuestion.options.map((opt) => {
                  const isSelected = currentSelections.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => selectOption(opt.id)}
                      className={cn(
                        "w-full text-left px-4 py-3.5 rounded-2xl border-2 transition-all active:scale-[0.99] flex items-start gap-3 cursor-pointer",
                        isSelected
                          ? "border-magenta-600 bg-magenta-50/60 text-magenta-950 shadow-xs"
                          : "border-slate-200 text-slate-700 hover:border-magenta-200 hover:bg-magenta-50/20"
                      )}
                    >
                      {/* Checkbox or Radio indicator */}
                      <span
                        className={cn(
                          "mt-0.5 w-4 h-4 flex items-center justify-center shrink-0 border-2 transition-colors",
                          currentQuestion.isMultiSelect ? "rounded-md" : "rounded-full",
                          isSelected ? "border-magenta-600 bg-magenta-600 text-white" : "border-slate-300 bg-white"
                        )}
                      >
                        {isSelected && (
                          currentQuestion.isMultiSelect ? (
                            <CheckCircle2 className="w-3 h-3 text-white" />
                          ) : (
                            <span className="w-1.5 h-1.5 rounded-full bg-white" />
                          )
                        )}
                      </span>

                      {/* Bilingual Option Text */}
                      <span className="flex-1">
                        <span className="block text-sm font-semibold text-slate-800">
                          {opt.labelEn}
                        </span>
                        <span className="block text-xs text-slate-500 mt-0.5">
                          {opt.labelTl}
                        </span>
                      </span>

                      {/* Warning tags for Q14 */}
                      {opt.safetyWarning && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md",
                            opt.safetyWarning === "emergency"
                              ? "bg-rose-100 text-rose-700"
                              : "bg-amber-100 text-amber-800"
                          )}
                        >
                          <ShieldAlert className="w-3 h-3" />
                          {opt.safetyWarning === "emergency" ? "EMERGENCY" : "URGENT"}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Navigation buttons */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={goPrevQuestion}
                  disabled={qIndex === 0}
                  className="px-5 py-3.5 rounded-full font-semibold text-sm border-2 border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="button"
                  disabled={!hasAnsweredCurrent}
                  onClick={goNextQuestion}
                  className={cn(
                    "flex-1 py-3.5 rounded-full font-semibold text-sm transition-all flex items-center justify-center gap-2",
                    hasAnsweredCurrent
                      ? "bg-magenta-600 text-white hover:bg-magenta-700 shadow-lg shadow-magenta-600/20 cursor-pointer active:scale-[0.98]"
                      : "bg-slate-200 text-slate-400 cursor-not-allowed"
                  )}
                >
                  <span>
                    {qIndex < QUESTIONNAIRE_QUESTIONS.length - 1 ? "Next Question" : "Review All 15 Answers"}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* =========================================================================
              REVIEW STEP: Review all 15 answers with edit buttons before photo upload
             ========================================================================= */}
          {currentStep === 1 && isReviewing && (
            <motion.div
              key="review-step"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="bg-white rounded-3xl border border-slate-200/90 shadow-sm p-6 sm:p-8"
            >
              <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-xl font-display font-bold text-slate-900">
                    Review Your Answers
                  </h2>
                  <p className="text-xs text-slate-500 italic">
                    Suriin ang iyong mga sagot bago magpatuloy sa pag-upload ng larawan.
                  </p>
                </div>
                <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                  15 of 15 Completed
                </span>
              </div>

              {/* Safety notice if Q14 had warning signs */}
              {activeSafetyAlert.level !== "none" && (
                <div
                  className={cn(
                    "mb-6 p-4 rounded-2xl border-2 flex items-start gap-3",
                    activeSafetyAlert.level === "emergency"
                      ? "bg-rose-50 border-rose-300 text-rose-900"
                      : "bg-amber-50 border-amber-300 text-amber-900"
                  )}
                >
                  <ShieldAlert
                    className={cn(
                      "w-5 h-5 shrink-0 mt-0.5",
                      activeSafetyAlert.level === "emergency" ? "text-rose-600" : "text-amber-600"
                    )}
                  />
                  <div className="text-xs leading-relaxed">
                    <p className="font-bold text-sm mb-1">{activeSafetyAlert.title}</p>
                    <p>{activeSafetyAlert.message}</p>
                    <p className="font-semibold mt-1">{activeSafetyAlert.actionRequired}</p>
                  </div>
                </div>
              )}

              {/* List of all 15 Questions and Selected Answers */}
              <div className="space-y-3.5 mb-8 max-h-[60vh] overflow-y-auto pr-1">
                {QUESTIONNAIRE_QUESTIONS.map((q, idx) => {
                  const chosenIds = answers[q.id] || [];
                  const chosenOptions = q.options.filter((o) => chosenIds.includes(o.id));

                  return (
                    <div
                      key={q.id}
                      className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors flex items-start justify-between gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <span className="text-[11px] font-bold text-magenta-700 uppercase tracking-wider block mb-0.5">
                          Question {q.number}
                        </span>
                        <p className="text-xs font-bold text-slate-800 truncate">
                          {q.titleEn}
                        </p>
                        <p className="text-[11px] text-slate-500 italic truncate mb-2">
                          {q.titleTl}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {chosenOptions.length > 0 ? (
                            chosenOptions.map((opt) => (
                              <span
                                key={opt.id}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-800 shadow-2xs"
                              >
                                <span>{opt.labelEn}</span>
                                <span className="text-[10px] text-slate-400">({opt.labelTl})</span>
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-rose-500 italic">Not answered</span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => jumpToQuestion(idx)}
                        className="p-2 rounded-xl text-magenta-600 hover:bg-magenta-50 hover:text-magenta-700 transition-colors shrink-0 flex items-center gap-1 text-xs font-semibold"
                        title="Edit this answer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Edit</span>
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Review Step Action Buttons */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={goPrevQuestion}
                  className="px-5 py-3.5 rounded-full font-semibold text-sm border-2 border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" /> Back to Q15
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsReviewing(false);
                    setCurrentStep(2);
                  }}
                  className="flex-1 py-3.5 rounded-full font-semibold text-sm bg-magenta-600 text-white hover:bg-magenta-700 transition-all shadow-lg shadow-magenta-600/20 flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
                >
                  <span>Confirm &amp; Proceed to Upload Photos</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* =========================================================================
              STEP 2: Photo Upload (Close-up & Wide-view with quality & skin validation)
             ========================================================================= */}
          {currentStep === 2 && !isAnalyzing && !showResult && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-white rounded-3xl border border-slate-200/90 shadow-sm p-6 sm:p-8"
            >
              <button
                type="button"
                onClick={() => {
                  setCurrentStep(1);
                  setIsReviewing(true);
                }}
                className="flex items-center gap-1 text-sm text-magenta-600 mb-4 hover:text-magenta-700 font-medium cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" /> Back to Questionnaire Review
              </button>

              <h2 className="text-xl font-display font-bold text-slate-900 mb-1">
                Upload Skin Photos
              </h2>
              <p className="text-sm text-slate-500 mb-6">
                2 photos required — one clear close-up of the lesion, and one wider-area photo for context.
              </p>

              {/* Safety notice banner if warning signs were selected in Q14 */}
              {activeSafetyAlert.level !== "none" && (
                <div
                  className={cn(
                    "mb-6 p-4 rounded-2xl border-2 flex items-start gap-3",
                    activeSafetyAlert.level === "emergency"
                      ? "bg-rose-50 border-rose-300 text-rose-900"
                      : "bg-amber-50 border-amber-300 text-amber-900"
                  )}
                >
                  <ShieldAlert
                    className={cn(
                      "w-5 h-5 shrink-0 mt-0.5",
                      activeSafetyAlert.level === "emergency" ? "text-rose-600" : "text-amber-600"
                    )}
                  />
                  <div className="text-xs leading-relaxed">
                    <p className="font-bold text-sm mb-0.5">{activeSafetyAlert.title}</p>
                    <p>{activeSafetyAlert.message}</p>
                    <p className="font-semibold mt-1">{activeSafetyAlert.actionRequired}</p>
                  </div>
                </div>
              )}

              {analyzeError && (
                <div className="mb-4 rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700">
                  {analyzeError}
                </div>
              )}

              {/* Photo Upload Slots */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                {(
                  [
                    {
                      slot: "closeup" as const,
                      title: "Photo 1 — Close-Up View",
                      description: "Primary close-up of the affected area",
                      image: closeUpImage,
                      inputRef: closeUpInputRef,
                      cameraRef: closeUpCameraRef,
                    },
                    {
                      slot: "wide" as const,
                      title: "Photo 2 — Wider Area",
                      description: "Surrounding skin for spatial distribution",
                      image: wideImage,
                      inputRef: wideInputRef,
                      cameraRef: wideCameraRef,
                    },
                  ]
                ).map((p) => (
                  <div
                    key={p.slot}
                    className="border-2 border-dashed border-slate-200 rounded-2xl p-4 flex flex-col items-center justify-center min-h-[220px] bg-slate-50/50 hover:bg-slate-50 transition-colors"
                  >
                    {p.image ? (
                      <div className="relative w-full aspect-4/3 rounded-xl overflow-hidden border border-slate-200">
                        <img
                          src={p.image}
                          alt={p.title}
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => clearPhoto(p.slot)}
                          className="absolute top-2 right-2 px-2.5 py-1 rounded-full bg-slate-900/80 text-white text-xs font-semibold hover:bg-slate-900 transition-colors cursor-pointer"
                        >
                          Change
                        </button>
                      </div>
                    ) : (
                      <div className="text-center p-3">
                        <div className="w-12 h-12 rounded-full bg-magenta-50 text-magenta-600 flex items-center justify-center mx-auto mb-3">
                          <Camera className="w-6 h-6" />
                        </div>
                        <h3 className="text-sm font-bold text-slate-800 mb-0.5">{p.title}</h3>
                        <p className="text-xs text-slate-400 mb-4">{p.description}</p>
                        <div className="flex gap-2 justify-center">
                          <button
                            type="button"
                            onClick={() => p.cameraRef.current?.click()}
                            className="px-3 py-1.5 rounded-full bg-magenta-600 text-white text-xs font-semibold hover:bg-magenta-700 transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <Camera className="w-3.5 h-3.5" /> Camera
                          </button>
                          <button
                            type="button"
                            onClick={() => p.inputRef.current?.click()}
                            className="px-3 py-1.5 rounded-full border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-white transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <Image className="w-3.5 h-3.5" /> Upload
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Upload instructions / tips */}
              <div className="rounded-2xl bg-slate-100/70 p-4 mb-6 text-xs text-slate-600 space-y-1.5">
                <p className="font-semibold text-slate-800">Tips for an accurate skin scan:</p>
                <p>• Ensure good natural lighting; avoid harsh shadows or flash glare.</p>
                <p>• Keep camera steady so the close-up photo is sharp and in focus.</p>
                <p>• Capture only the skin area of concern without clothing obstruction.</p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setCurrentStep(1);
                    setIsReviewing(true);
                  }}
                  className="px-5 py-3.5 rounded-full font-semibold text-sm border-2 border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" /> Back to Questions
                </button>
                <button
                  type="button"
                  disabled={!allPhotosUploaded || isAnalyzing}
                  onClick={handleAnalyze}
                  className={cn(
                    "flex-1 py-3.5 rounded-full font-semibold text-sm transition-all flex items-center justify-center gap-2",
                    allPhotosUploaded && !isAnalyzing
                      ? "bg-magenta-600 text-white hover:bg-magenta-700 shadow-lg shadow-magenta-600/20 cursor-pointer active:scale-[0.98]"
                      : "bg-slate-200 text-slate-400 cursor-not-allowed"
                  )}
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Analyze Photos &amp; Questionnaire</span>
                </button>
              </div>
            </motion.div>
          )}

          {/* Analyzing progress state */}
          {isAnalyzing && (
            <motion.div
              key="analyzing"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl border border-slate-200/90 shadow-sm p-8 text-center"
            >
              <div className="w-16 h-16 rounded-full bg-magenta-50 text-magenta-600 flex items-center justify-center mx-auto mb-4 animate-spin">
                <Sparkles className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-display font-bold text-slate-900 mb-2">
                Analyzing Skin Assessment…
              </h2>
              <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
                Evaluating photo quality, running ResNet50 skin condition inference, and computing evidence-based rule mapping from your 15 questions.
              </p>
              <div className="w-48 h-2 bg-slate-100 rounded-full mx-auto overflow-hidden">
                <motion.div
                  className="h-full bg-magenta-600 rounded-full"
                  initial={{ width: "10%" }}
                  animate={{ width: "95%" }}
                  transition={{ duration: 2.5, ease: "easeInOut" }}
                />
              </div>
            </motion.div>
          )}

          {/* =========================================================================
              STEP 3: Result Presentation — AI Prediction, Questionnaire Support, & Care
             ========================================================================= */}
          {currentStep === 3 && showResult && scanResult && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              {/* Primary Assessment Card */}
              <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden">
                <div className="p-6 sm:p-8 border-b border-slate-100">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-magenta-50 text-magenta-700 text-xs font-semibold border border-magenta-100">
                      <Sparkles className="w-3.5 h-3.5 text-magenta-600" />
                      <span>AI-generated preliminary result</span>
                    </div>
                    {scanResult.patientReportedImpact && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-medium border border-slate-200">
                        <span>Reported Daily-Life Impact:</span>
                        <strong className="text-slate-900 font-semibold">{scanResult.patientReportedImpact}</strong>
                      </span>
                    )}
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-display font-bold text-slate-900 mb-1">
                    Possible Condition: {scanResult.condition}
                  </h2>
                  {scanResult.localName && scanResult.localName !== scanResult.condition && (
                    <p className="text-sm font-medium text-slate-500 italic">
                      Lokal na tawag: {scanResult.localName}
                    </p>
                  )}
                </div>

                {/* 1. ResNet50 Independent Confidence Score */}
                <div className="px-6 sm:px-8 py-5 border-b border-slate-100 bg-slate-50/40">
                  <div className="flex items-center justify-between mb-1.5">
                    <div>
                      <span className="text-sm font-semibold text-slate-900">
                        Image Model Confidence (ResNet50)
                      </span>
                      <p className="text-[11px] text-slate-500">
                        Solely from skin-image inference; untouched by questionnaire answers
                      </p>
                    </div>
                    <span className="text-xl font-bold text-magenta-600">
                      {Math.round(scanResult.confidence)}%
                    </span>
                  </div>
                  <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-linear-to-r from-magenta-500 to-magenta-600 rounded-full"
                      initial={{ width: "0%" }}
                      animate={{ width: `${Math.round(scanResult.confidence)}%` }}
                      transition={{ duration: 1, delay: 0.2 }}
                    />
                  </div>
                </div>

                {/* 2. AI vs Questionnaire Agreement / Discrepancy Banner */}
                {scanResult.comparison && (
                  <div className="px-6 sm:px-8 py-4 border-b border-slate-100">
                    <div
                      className={cn(
                        "rounded-2xl p-4 border flex items-start gap-3",
                        scanResult.comparison.agreementStatus === "aligned"
                          ? "bg-emerald-50/80 border-emerald-200 text-emerald-950"
                          : scanResult.comparison.agreementStatus === "differing"
                            ? "bg-amber-50/80 border-amber-300 text-amber-950"
                            : "bg-slate-100 border-slate-200 text-slate-800"
                      )}
                    >
                      {scanResult.comparison.agreementStatus === "aligned" ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                      )}
                      <div className="text-xs leading-relaxed">
                        <p className="font-bold text-sm mb-1">
                          {scanResult.comparison.agreementStatus === "aligned"
                            ? "Supportive Alignment Between Photo & Questionnaire"
                            : scanResult.comparison.agreementStatus === "differing"
                              ? "Assessment Discrepancy Noted"
                              : "Assessment Context"}
                        </p>
                        <p>{scanResult.comparison.summary}</p>
                        <p className="font-semibold mt-1.5">{scanResult.comparison.recommendation}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. Questionnaire Evidence-Based Support Details */}
                <div className="p-6 sm:p-8 border-b border-slate-100 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-display font-bold text-slate-900 text-lg">
                        Questionnaire Evidence Support
                      </h3>
                      <p className="text-xs text-slate-500">
                        Rule-based screening mapping grounded in AAD and DermNet guidelines (Version {scanResult.mappingResult.version})
                      </p>
                    </div>
                    {/* Support label badge for predicted condition */}
                    {(() => {
                      const condEval = (scanResult.mappingResult.conditions as any)[scanResult.condition] ||
                        Object.values(scanResult.mappingResult.conditions).find((c) =>
                          scanResult.condition.toLowerCase().includes(c.condition.toLowerCase())
                        );
                      const level = condEval?.supportLevel || "Limited / no specific support";

                      return (
                        <span
                          className={cn(
                            "px-3 py-1 rounded-full text-xs font-bold shrink-0 border",
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

                  {/* Supporting findings from questionnaire */}
                  {(() => {
                    const condEval = (scanResult.mappingResult.conditions as any)[scanResult.condition] ||
                      Object.values(scanResult.mappingResult.conditions).find((c) =>
                        scanResult.condition.toLowerCase().includes(c.condition.toLowerCase())
                      );
                    const findings = condEval?.supportingFindings || [];
                    const limitations = condEval?.limitations || [];

                    return (
                      <div className="space-y-3 bg-slate-50 rounded-2xl p-4 border border-slate-200/80">
                        <div>
                          <span className="text-xs font-bold text-slate-800 block mb-1.5">
                            Key Supporting Questionnaire Findings:
                          </span>
                          {findings.length > 0 ? (
                            <ul className="space-y-1">
                              {findings.map((f: string, i: number) => (
                                <li key={i} className="flex items-start gap-2 text-xs text-slate-700">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                                  <span>{f}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-slate-500 italic">
                              No specific primary symptom criteria for this condition were reported in the questionnaire.
                            </p>
                          )}
                        </div>

                        {limitations.length > 0 && (
                          <div className="pt-2 border-t border-slate-200">
                            <span className="text-xs font-bold text-slate-700 block mb-1">
                              Clinical Limitations &amp; Nuances:
                            </span>
                            <ul className="space-y-1">
                              {limitations.map((lim: string, i: number) => (
                                <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
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

                  <p className="text-[11px] text-slate-400 italic">
                    {scanResult.mappingResult.disclaimer}
                  </p>
                </div>

                {/* 4. Independent Q14 Safety Alert Card (if triggered) */}
                {scanResult.mappingResult.safetyAlert.level !== "none" && (
                  <div className="p-6 sm:p-8 border-b border-slate-100">
                    <div
                      className={cn(
                        "rounded-2xl p-5 border-2 flex items-start gap-3.5",
                        scanResult.mappingResult.safetyAlert.level === "emergency"
                          ? "bg-rose-50 border-rose-300 text-rose-950"
                          : "bg-amber-50 border-amber-300 text-amber-950"
                      )}
                    >
                      <ShieldAlert
                        className={cn(
                          "w-6 h-6 shrink-0 mt-0.5",
                          scanResult.mappingResult.safetyAlert.level === "emergency"
                            ? "text-rose-600"
                            : "text-amber-600"
                        )}
                      />
                      <div className="text-xs leading-relaxed space-y-1">
                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-white/80 border">
                          Safety Alert (Q14)
                        </span>
                        <h4 className="text-sm font-bold">{scanResult.mappingResult.safetyAlert.title}</h4>
                        <p>{scanResult.mappingResult.safetyAlert.message}</p>
                        <p className="font-semibold text-rose-800 mt-1">
                          Action Required: {scanResult.mappingResult.safetyAlert.actionRequired}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 5. Uploaded Photos Card */}
                <div className="p-6 sm:p-8 border-b border-slate-100">
                  <h3 className="font-display font-bold text-slate-900 text-lg mb-4">
                    Uploaded Photos &amp; AI Evidence
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                      <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                        Close-Up Photo (Primary Image)
                      </span>
                      <div className="relative aspect-4/3 rounded-xl overflow-hidden bg-white border border-slate-200">
                        <img
                          src={scanResult.imageUrl || closeUpImage || undefined}
                          alt="Close-up photo"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                      <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                        Wider-Area Photo (Context Image)
                      </span>
                      <div className="relative aspect-4/3 rounded-xl overflow-hidden bg-white border border-slate-200">
                        {scanResult.wideImageUrl || wideImage ? (
                          <img
                            src={scanResult.wideImageUrl || wideImage || undefined}
                            alt="Wider photo"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
                            No wide photo
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Supporting Image Feedback (Fix C) */}
                  {scanResult.supportingPrediction?.status === "invalid" && (
                    <div className="mt-3 p-3 rounded-xl bg-slate-100 border border-slate-200 text-xs text-slate-700 flex items-start gap-2">
                      <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                      <span>The supporting photo could not be analyzed. This result is based on the close-up photo.</span>
                    </div>
                  )}

                  {scanResult.isCombined && scanResult.agreement === false && (
                    <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <span>The close-up and supporting photos produced different predictions. Please discuss the result with a dermatologist.</span>
                    </div>
                  )}

                  {scanResult.isCombined && scanResult.agreement === true && (
                    <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span>The close-up and supporting photos produced consistent predictions.</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-4 px-1 text-xs text-slate-500">
                    <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                    <span>{scanResult.bodyPart}</span>
                    <span className="ml-auto">{scanResult.date}</span>
                  </div>
                </div>

                {/* 6. Condition Guide Details (Grounded in AAD, DermNet, Cleveland Clinic) */}
                <div className="p-6 sm:p-8 space-y-6">
                  <div>
                    <h3 className="font-display font-bold text-slate-900 text-lg mb-2">
                      What is it? / Ano ito?
                    </h3>
                    <p className="text-sm text-slate-700 leading-relaxed">
                      {scanResult.description}
                    </p>
                  </div>

                  <div>
                    <h3 className="font-display font-bold text-slate-900 text-lg mb-2">
                      Common Symptoms / Karaniwang Sintomas
                    </h3>
                    <ul className="space-y-1.5">
                      {scanResult.symptoms.map((s, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                          <div className="w-1.5 h-1.5 rounded-full bg-magenta-500 mt-2 shrink-0" />
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200/80">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Users className="w-4 h-4 text-magenta-600" />
                      <h3 className="font-display font-bold text-slate-900 text-base">
                        Who does it affect? / Sino ang naaapektuhan?
                      </h3>
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed">{scanResult.whoAffected}</p>
                  </div>

                  <div>
                    <h3 className="font-display font-bold text-slate-900 text-lg mb-2">
                      Evidence-Based Basic Care Tips
                    </h3>
                    <ul className="space-y-2">
                      {scanResult.careTips.map((tip, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          <span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="bg-amber-50/70 rounded-2xl p-5 border border-amber-200/80">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Stethoscope className="w-4 h-4 text-amber-700" />
                      <h3 className="font-display font-bold text-amber-950 text-base">
                        When to See a Doctor / Kailan Dapat Magpatingin sa Doktor
                      </h3>
                    </div>
                    <p className="text-sm text-amber-900 leading-relaxed">{scanResult.whenToSeeDoctor}</p>
                  </div>

                  {/* Medical Sources and Research Citations */}
                  {scanResult.conditionGuide?.medicalSources && (
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
                      <span className="text-xs font-bold text-slate-800 uppercase tracking-wider block mb-2">
                        Verified Medical Sources &amp; Clinical Citations:
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {scanResult.conditionGuide.medicalSources.map((src, i) => (
                          <a
                            key={i}
                            href={src.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-200 text-xs text-slate-700 hover:text-magenta-700 hover:border-magenta-300 transition-colors"
                          >
                            <span className="truncate pr-2 font-medium">{src.organization}: {src.title}</span>
                            <ExternalLink className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Medical Disclaimer */}
                  <div className="bg-rose-50/60 rounded-2xl p-4 flex gap-3 border border-rose-100">
                    <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-rose-900 mb-0.5">Medical Disclaimer</p>
                      <p className="text-xs text-rose-800 leading-relaxed">
                        This AI assessment and rule-based questionnaire mapping are intended for educational and pre-screening purposes only. It is NOT a clinical diagnosis and cannot replace an in-person examination by a licensed medical dermatologist.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recommended Clinics */}
              <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm p-6 sm:p-8">
                <h3 className="text-lg font-display font-bold text-slate-900 mb-4">
                  Recommended Clinics Near You
                </h3>
                <div className="space-y-3">
                  {recommendedClinics.map((clinic, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-4 rounded-xl border border-slate-200 hover:border-magenta-300 transition-colors"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 text-sm">{clinic.name}</span>
                          {clinic.verified && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
                              ✓ Verified
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> {clinic.addr}
                        </p>
                      </div>
                      <Link
                        to={scanClinicsUrl}
                        onClick={handleScanBookingContext}
                        className="px-4 py-2 rounded-full bg-magenta-600 text-white text-xs font-semibold hover:bg-magenta-700 transition-colors"
                      >
                        View
                      </Link>
                    </div>
                  ))}
                  {recommendedClinics.length === 0 && (
                    <p className="text-xs text-slate-500">
                      Explore our clinic directory to connect with a verified dermatologist near you.
                    </p>
                  )}
                </div>
                <Link
                  to={scanClinicsUrl}
                  onClick={handleScanBookingContext}
                  className="flex items-center justify-center gap-1 mt-4 text-sm text-magenta-600 font-semibold hover:text-magenta-700"
                >
                  View all clinics <ArrowRight className="w-4 h-4" />
                </Link>
              </div>

              {/* Navigation Actions */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setCurrentStep(1);
                    setQIndex(0);
                    setIsReviewing(false);
                    setShowResult(false);
                    clearPhoto("closeup");
                    clearPhoto("wide");
                    setScanResult(null);
                    setAnswers({});
                  }}
                  className="flex-1 py-3.5 rounded-full font-semibold text-sm border-2 border-magenta-600 text-magenta-600 hover:bg-magenta-50 transition-colors cursor-pointer"
                >
                  Scan Again
                </button>
                <Link
                  to={isBookingOrigin ? returnAppointmentUrl : scanClinicsUrl}
                  onClick={handleScanBookingContext}
                  className="flex-1 py-3.5 rounded-full font-semibold text-sm bg-magenta-600 text-white text-center hover:bg-magenta-700 transition-all shadow-lg shadow-magenta-600/20 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>{isBookingOrigin ? "Continue to Appointment Booking" : "Find a Clinic"}</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}