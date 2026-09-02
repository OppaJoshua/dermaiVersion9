import { useState, useRef, useMemo, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Camera,
  Image,
  CheckCircle2,
  AlertTriangle,
  Sun,
  ZoomIn,
  Sparkles,
  MapPin,
  ArrowRight,
  ArrowLeft,
  Lock,
  Users,
  Stethoscope,
  ShieldAlert,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "../../lib/utils";

const steps = [
  { label: "Answer Questions", number: 1 },
  { label: "Upload Photo", number: 2 },
  { label: "View Result", number: 3 },
];

const MAX_FREE_SCANS = 3;

/* ---------------------------------------------------------------
   Questionnaire data — sourced directly from
   "Skin Condition Pre-Screening Questionnaire (with Severity)"
   This is the exact set of 15 questions/options. The severity +
   disease-mapping values on each option are ONLY used for the
   lightweight client-side preview below — the real classification
   comes from the backend Random Forest (see API contract further
   down), which does its own feature encoding from raw answers.
--------------------------------------------------------------- */

type Condition =
  | "Vitiligo"
  | "Acne Vulgaris"
  | "Atopic Dermatitis (Eczema)"
  | "Contact Dermatitis"
  | "Melasma";

interface QuestionOption {
  label: string;
  severity: number | null;
  conditions: Condition[];
  warning?: "urgent" | "emergency";
}

interface Question {
  id: string;
  text: string;
  helper: string;
  usedForSeverity: boolean;
  options: QuestionOption[];
}

const QUESTIONS: Question[] = [
  {
    id: "q1",
    text: "How intense is the itching on the affected skin?",
    helper: "Choose the option that best describes your itching right now.",
    usedForSeverity: true,
    options: [
      { label: "No itching at all", severity: 0, conditions: ["Vitiligo", "Melasma"] },
      { label: "Mild, occasional itching", severity: 1, conditions: ["Vitiligo", "Acne Vulgaris"] },
      { label: "Moderate itching that bothers me sometimes", severity: 2, conditions: ["Acne Vulgaris", "Contact Dermatitis"] },
      { label: "Intense, constant itching", severity: 3, conditions: ["Atopic Dermatitis (Eczema)", "Contact Dermatitis"] },
    ],
  },
  {
    id: "q2",
    text: "Do you feel pain, burning, or stinging in the affected area?",
    helper: "Choose the option that best matches how it feels.",
    usedForSeverity: true,
    options: [
      { label: "No pain, burning, or stinging", severity: 0, conditions: ["Vitiligo", "Melasma"] },
      { label: "Mild burning, stinging, or tenderness", severity: 1, conditions: ["Atopic Dermatitis (Eczema)", "Contact Dermatitis"] },
      { label: "Moderate pain or burning", severity: 2, conditions: ["Acne Vulgaris", "Contact Dermatitis"] },
      { label: "Severe pain, burning, warmth, or swelling", severity: 3, conditions: ["Acne Vulgaris", "Contact Dermatitis", "Atopic Dermatitis (Eczema)"] },
    ],
  },
  {
    id: "q3",
    text: "What color is the affected skin?",
    helper: "Pick the color that most closely matches what you see.",
    usedForSeverity: false,
    options: [
      { label: "White or noticeably lighter than my natural skin tone", severity: null, conditions: ["Vitiligo"] },
      { label: "Red or pink, with visible bumps or pimples", severity: null, conditions: ["Acne Vulgaris"] },
      { label: "Red, purple, brown, or gray discoloration", severity: null, conditions: ["Atopic Dermatitis (Eczema)"] },
      { label: "Red, purple, or darker than my normal skin tone (like a rash)", severity: null, conditions: ["Contact Dermatitis"] },
      { label: "Light brown, dark brown, or blue-gray patches", severity: null, conditions: ["Melasma"] },
    ],
  },
  {
    id: "q4",
    text: "How does the surface of the affected skin feel or look?",
    helper: "Select the description that fits best.",
    usedForSeverity: false,
    options: [
      { label: "Smooth and flat — no change in texture", severity: null, conditions: ["Vitiligo", "Melasma"] },
      { label: "Oily or greasy, with clogged pores", severity: null, conditions: ["Acne Vulgaris"] },
      { label: "Dry, rough, cracked, or scaly", severity: null, conditions: ["Atopic Dermatitis (Eczema)"] },
      { label: "Flaky, peeling, or scaling skin", severity: null, conditions: ["Contact Dermatitis", "Atopic Dermatitis (Eczema)"] },
    ],
  },
  {
    id: "q5",
    text: "Do you notice any bumps or blisters?",
    helper: "Choose the option closest to your main symptom.",
    usedForSeverity: false,
    options: [
      { label: "Blackheads, whiteheads, or pus-filled pimples", severity: null, conditions: ["Acne Vulgaris"] },
      { label: "Small fluid-filled blisters", severity: null, conditions: ["Atopic Dermatitis (Eczema)", "Contact Dermatitis"] },
      { label: "Swollen, raised, hive-like bumps", severity: null, conditions: ["Contact Dermatitis"] },
      { label: "No bumps or blisters — just flat discoloration", severity: null, conditions: ["Vitiligo", "Melasma"] },
    ],
  },
  {
    id: "q6",
    text: "Is there any discharge, oozing, or crusting from the affected skin?",
    helper: "This helps us check for signs that the skin may be infected.",
    usedForSeverity: true,
    options: [
      { label: "No discharge or oozing", severity: 0, conditions: ["Vitiligo", "Acne Vulgaris", "Melasma"] },
      { label: "Occasional clear fluid, especially after scratching", severity: 1, conditions: ["Atopic Dermatitis (Eczema)"] },
      { label: "Pus-filled bumps or cysts", severity: 2, conditions: ["Acne Vulgaris"] },
      { label: "Yellow pus, odor, warmth, or crusting", severity: 3, conditions: ["Atopic Dermatitis (Eczema)", "Contact Dermatitis"] },
    ],
  },
  {
    id: "q7",
    text: "Where on your body is the affected skin located?",
    helper: "Choose the area that best matches your main concern.",
    usedForSeverity: false,
    options: [
      { label: "Face only, appearing evenly on both cheeks, forehead, or upper lip", severity: null, conditions: ["Melasma"] },
      { label: "Face, chest, shoulders, or back", severity: null, conditions: ["Acne Vulgaris"] },
      { label: "Skin folds — elbows, behind the knees, or wrists", severity: null, conditions: ["Atopic Dermatitis (Eczema)"] },
      { label: "Hands, forearms, feet, or scattered patches on the face", severity: null, conditions: ["Vitiligo"] },
      { label: "A specific spot that touched a product, plant, or metal", severity: null, conditions: ["Contact Dermatitis"] },
    ],
  },
  {
    id: "q8",
    text: "Did the affected skin appear after touching a new product, plant, or metal?",
    helper: "Think about new soaps, jewelry, cosmetics, detergents, or plants.",
    usedForSeverity: false,
    options: [
      { label: "Yes, it appeared soon after contact with something new", severity: null, conditions: ["Contact Dermatitis"] },
      { label: "No, it appeared gradually with no clear cause", severity: null, conditions: ["Vitiligo", "Melasma", "Atopic Dermatitis (Eczema)", "Acne Vulgaris"] },
    ],
  },
  {
    id: "q9",
    text: "Does sun exposure change how the affected skin looks?",
    helper: "Consider how the area reacts after being in the sun.",
    usedForSeverity: false,
    options: [
      { label: "It gets darker or more noticeable in the sun", severity: null, conditions: ["Melasma"] },
      { label: "It burns or turns red very easily in the sun", severity: null, conditions: ["Vitiligo"] },
      { label: "No noticeable change with sun exposure", severity: null, conditions: ["Acne Vulgaris", "Atopic Dermatitis (Eczema)", "Contact Dermatitis"] },
    ],
  },
  {
    id: "q10",
    text: "Has the affected area spread or grown since it first appeared?",
    helper: "This helps us understand how much the area has changed.",
    usedForSeverity: true,
    options: [
      { label: "No, it has stayed about the same, in one small area", severity: 0, conditions: [] },
      { label: "Slightly spread within the same general area", severity: 1, conditions: ["Acne Vulgaris", "Contact Dermatitis"] },
      { label: "Spread to nearby skin or a few new areas", severity: 2, conditions: ["Vitiligo", "Acne Vulgaris", "Contact Dermatitis"] },
      { label: "Spread to multiple or distant parts of the body", severity: 3, conditions: ["Vitiligo", "Atopic Dermatitis (Eczema)", "Contact Dermatitis", "Melasma"] },
    ],
  },
  {
    id: "q11",
    text: "How long have you had these symptoms?",
    helper: "Choose the option that best matches your timeline.",
    usedForSeverity: true,
    options: [
      { label: "Less than 1 week", severity: 1, conditions: ["Contact Dermatitis", "Acne Vulgaris"] },
      { label: "1–4 weeks", severity: 2, conditions: ["Acne Vulgaris", "Contact Dermatitis", "Atopic Dermatitis (Eczema)"] },
      { label: "More than 1 month, or it keeps coming back", severity: 3, conditions: ["Vitiligo", "Atopic Dermatitis (Eczema)", "Melasma"] },
    ],
  },
  {
    id: "q12",
    text: "How much do these symptoms affect your daily activities or emotional wellbeing?",
    helper: "Be honest — this helps us gauge how much the condition is affecting you.",
    usedForSeverity: true,
    options: [
      { label: "No effect on my daily life", severity: 0, conditions: [] },
      { label: "Slight discomfort, but it doesn't interrupt my activities", severity: 1, conditions: [] },
      { label: "Sometimes interrupts my activities or bothers me emotionally", severity: 2, conditions: ["Vitiligo", "Acne Vulgaris", "Atopic Dermatitis (Eczema)", "Contact Dermatitis", "Melasma"] },
      { label: "Makes daily activities difficult, or causes significant distress", severity: 3, conditions: ["Vitiligo", "Acne Vulgaris", "Atopic Dermatitis (Eczema)", "Contact Dermatitis", "Melasma"] },
    ],
  },
  {
    id: "q13",
    text: "Are you currently experiencing any of the following?",
    helper: "Select the one that applies to you right now. These are important warning signs.",
    usedForSeverity: true,
    options: [
      { label: "None of these", severity: 0, conditions: [] },
      { label: "Skin is warm, red, swollen, or oozing yellow pus (possible infection)", severity: 3, conditions: ["Acne Vulgaris", "Atopic Dermatitis (Eczema)", "Contact Dermatitis"], warning: "urgent" },
      { label: "The patch is raised, bleeding, or changing rapidly in size or color", severity: 3, conditions: ["Melasma"], warning: "urgent" },
      { label: "Trouble breathing, or swelling of the lips or mouth", severity: 3, conditions: ["Contact Dermatitis"], warning: "emergency" },
      { label: "New eye redness, irritation, or vision changes", severity: 3, conditions: ["Vitiligo"], warning: "urgent" },
    ],
  },
  {
    id: "q14",
    text: "Are you currently pregnant, recently gave birth, or using hormonal birth control or hormone therapy?",
    helper: "Hormonal changes can affect certain skin conditions.",
    usedForSeverity: false,
    options: [
      { label: "Yes", severity: null, conditions: ["Melasma"] },
      { label: "No or not applicable", severity: null, conditions: ["Vitiligo", "Acne Vulgaris", "Atopic Dermatitis (Eczema)", "Contact Dermatitis"] },
    ],
  },
  {
    id: "q15",
    text: "Do you (or your close family) have a history of allergies, asthma, or hay fever?",
    helper: "This can point to skin conditions linked to allergic tendencies.",
    usedForSeverity: false,
    options: [
      { label: "Yes", severity: null, conditions: ["Atopic Dermatitis (Eczema)"] },
      { label: "No or not sure", severity: null, conditions: ["Vitiligo", "Acne Vulgaris", "Contact Dermatitis", "Melasma"] },
    ],
  },
];

const SEVERITY_QUESTION_IDS = ["q1", "q2", "q6", "q10", "q11", "q12"];

/** Lightweight, client-side ONLY. Gives the user a quick sense of severity
 *  while answering. Never sent as the diagnosis — the RF does that. */
interface QuickPreview {
  severityScore: number;
  severityLevel: "Mild" | "Moderate" | "Severe";
  urgent: boolean;
  urgentMessage?: string;
  urgentType?: "urgent" | "emergency";
}

function computeQuickPreview(answers: Record<string, number>): QuickPreview {
  let score = 0;
  for (const qId of SEVERITY_QUESTION_IDS) {
    const q = QUESTIONS.find((x) => x.id === qId)!;
    const opt = answers[qId] !== undefined ? q.options[answers[qId]] : undefined;
    if (opt?.severity != null) score += opt.severity;
  }
  const level: QuickPreview["severityLevel"] = score >= 11 ? "Severe" : score >= 5 ? "Moderate" : "Mild";

  const q13 = QUESTIONS.find((q) => q.id === "q13")!;
  const q13Idx = answers["q13"];
  const q13Opt = q13Idx !== undefined ? q13.options[q13Idx] : undefined;
  const urgent = !!q13Opt && q13Idx !== 0;

  return {
    severityScore: score,
    severityLevel: urgent ? "Severe" : level,
    urgent,
    urgentMessage: urgent ? q13Opt?.label : undefined,
    urgentType: urgent ? q13Opt?.warning : undefined,
  };
}

/* ---------------------------------------------------------------
   API CONTRACT — this is what the frontend sends/expects.
   Implement server-side once the Random Forest + CNN are ready.

   POST /api/scans/analyze   (multipart/form-data)
     - image: File
     - answers: JSON string, shape AnswerPayload (below) — RAW answers,
       the backend does its own feature encoding for the RF.

   AnswerPayload = { [questionId: string]: number }  // option index per question
   e.g. { "q1": 2, "q2": 0, "q3": 4, ... }

   Response: ScanResultData (below) — whatever the backend decides after
   combining the RF's questionnaire-based prediction with the CNN's
   image-based prediction (ensemble weighting, RF-as-triage + CNN-confirms,
   etc. is a backend decision, not a frontend one).
--------------------------------------------------------------- */

interface ScanResultData {
  id: string;
  condition: string;
  localName: string;
  confidence: number;
  bodyPart: string;
  date: string;
  severity: "Mild" | "Moderate" | "Severe";
  description: string;
  symptoms: string[];
  whoAffected: string;
  careTips: string[];
  whenToSeeDoctor: string;
  imageUrl?: string;
}

interface RecommendedClinic {
  name: string;
  addr: string;
  verified?: boolean;
}

export default function ScanSkinPage() {
  const navigate = useNavigate();
  const isAuthenticated = true;

  const [currentStep, setCurrentStep] = useState(1);
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});

  const currentQuestion = QUESTIONS[qIndex];
  const hasAnswered = answers[currentQuestion.id] !== undefined;
  const quickPreview = useMemo(() => computeQuickPreview(answers), [answers]);

  const closeUpInputRef = useRef<HTMLInputElement>(null);
  const closeUpCameraRef = useRef<HTMLInputElement>(null);
  const wideInputRef = useRef<HTMLInputElement>(null);
  const wideCameraRef = useRef<HTMLInputElement>(null);
  const [closeUpFile, setCloseUpFile] = useState<File | null>(null);
  const [closeUpImage, setCloseUpImage] = useState<string | null>(null);
  const [wideFile, setWideFile] = useState<File | null>(null);
  const [wideImage, setWideImage] = useState<string | null>(null);
  const uploadedCount = (closeUpImage ? 1 : 0) + (wideImage ? 1 : 0);
  const allPhotosUploaded = !!closeUpImage && !!wideImage;

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResultData | null>(null);
  const [recommendedClinics, setRecommendedClinics] = useState<RecommendedClinic[]>([]);

  const [subData, setSubData] = useState({ scansUsed: 0, isPro: false, isDemoAccount: false });
  const [subLoading, setSubLoading] = useState(true);

  useEffect(() => {
    const loadSubscription = async () => {
      setSubLoading(true);
      try {
        // TODO: GET /api/patients/me/subscription from Supabase
        setSubData({ scansUsed: 0, isPro: false, isDemoAccount: false });
      } catch (err) {
        console.error("Failed to load subscription data:", err);
      } finally {
        setSubLoading(false);
      }
    };
    loadSubscription();
  }, []);

  useEffect(() => {
    if (!showResult || !scanResult) return;
    const loadRecommendedClinics = async () => {
      try {
        // TODO: GET /api/clinics/recommended?condition=<scanResult.condition> from Supabase
        setRecommendedClinics([]);
      } catch (err) {
        console.error("Failed to load recommended clinics:", err);
      }
    };
    loadRecommendedClinics();
  }, [showResult, scanResult]);

  const scansLeft = subData.isPro ? "Unlimited" : Math.max(0, MAX_FREE_SCANS - subData.scansUsed);
  const canScan = subData.isPro || subData.isDemoAccount || subData.scansUsed < MAX_FREE_SCANS;

  const guardAction = (action: () => void) => action();

  const selectAnswer = (optIdx: number) => {
    setAnswers((a) => ({ ...a, [currentQuestion.id]: optIdx }));
  };

  const goNextQuestion = () => {
    if (qIndex < QUESTIONS.length - 1) setQIndex((i) => i + 1);
    else setCurrentStep(2);
  };

  const goPrevQuestion = () => {
    if (qIndex > 0) setQIndex((i) => i - 1);
    else setCurrentStep(1);
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
    if (!subData.isDemoAccount && !subData.isPro && !canScan) {
      navigate("/user/upgrade");
      return;
    }
    if (!closeUpFile || !wideFile) return;

    setIsAnalyzing(true);
    setAnalyzeError(null);

    try {
      const formData = new FormData();
      formData.append("image_close_up", closeUpFile);
      formData.append("image_wide", wideFile);
      formData.append("answers", JSON.stringify(answers)); // raw { q1: 2, q2: 0, ... } — RF does the encoding

      // TODO: point this at your FastAPI endpoint once the RF + CNN are wired up
      // const res = await fetch("/api/scans/analyze", { method: "POST", body: formData });
      // if (!res.ok) throw new Error(`Analyze failed: ${res.status}`);
      // const result: ScanResultData = await res.json();
      // setScanResult(result);

      setShowResult(true);
      setCurrentStep(3);
    } catch (err) {
      console.error("Analysis failed:", err);
      setAnalyzeError("Something went wrong while analyzing your photo. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-magenta-50 pt-8 pb-16">
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

        <div className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-magenta-900 mb-2">
            Scan Your Skin
          </h1>
          <p className="text-magenta-700/60 text-sm">
            Get an AI-powered preliminary assessment of your skin condition
          </p>
          {!isAuthenticated && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-4 py-2 mt-3 inline-block">
              Login required before answering questions, uploading photos, or analyzing.
            </p>
          )}
        </div>

        <div className="flex items-center justify-center gap-0 mb-10">
          {steps.map((step, i) => (
            <div key={step.number} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300",
                    currentStep >= step.number
                      ? "bg-magenta-500 text-white shadow-lg shadow-magenta-500/30"
                      : "bg-magenta-100 text-magenta-400"
                  )}
                >
                  {currentStep > step.number ? <CheckCircle2 className="w-5 h-5" /> : step.number}
                </div>
                <span
                  className={cn(
                    "text-xs mt-2 font-medium",
                    currentStep >= step.number ? "text-magenta-500" : "text-magenta-300"
                  )}
                >
                  {step.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div
                  className={cn(
                    "w-16 sm:w-24 h-0.5 mx-2 transition-colors",
                    currentStep > step.number ? "bg-magenta-500" : "bg-magenta-200"
                  )}
                />
              )}
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* Step 1: Questionnaire — one question at a time */}
          {currentStep === 1 && (
            <motion.div
              key={`q-${currentQuestion.id}`}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="bg-white rounded-[20px] shadow-[0_4px_24px_rgba(160,25,90,0.08)] p-6 sm:p-8"
            >
              <div className="flex items-center justify-between mb-5">
                <span className="text-xs font-semibold text-magenta-400">
                  Question {qIndex + 1} of {QUESTIONS.length}
                </span>
                <div className="w-32 h-1.5 bg-magenta-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-magenta-500 rounded-full transition-all"
                    style={{ width: `${((qIndex + 1) / QUESTIONS.length) * 100}%` }}
                  />
                </div>
              </div>

              <h2 className="text-lg sm:text-xl font-display font-bold text-magenta-900 mb-1">
                {currentQuestion.text}
              </h2>
              <p className="text-xs text-magenta-400 mb-6">{currentQuestion.helper}</p>

              <div className="space-y-2.5 mb-8">
                {currentQuestion.options.map((opt, i) => {
                  const selected = answers[currentQuestion.id] === i;
                  return (
                    <button
                      key={opt.label}
                      onClick={() => selectAnswer(i)}
                      className={cn(
                        "w-full text-left px-4 py-3.5 rounded-2xl border-2 text-sm font-medium transition-all active:scale-[0.98] flex items-start gap-3",
                        selected
                          ? "border-magenta-500 bg-magenta-50 text-magenta-900"
                          : "border-magenta-100 text-magenta-700 hover:border-magenta-200 hover:bg-magenta-50/50"
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0",
                          selected ? "border-magenta-500" : "border-magenta-200"
                        )}
                      >
                        {selected && <span className="w-2 h-2 rounded-full bg-magenta-500" />}
                      </span>
                      <span className="flex-1">
                        {opt.label}
                        {opt.warning && (
                          <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold text-red-600">
                            <ShieldAlert className="w-3 h-3" />
                            {opt.warning === "emergency" ? "EMERGENCY" : "URGENT"}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={goPrevQuestion}
                  className="px-5 py-3.5 rounded-full font-semibold text-sm border-2 border-magenta-200 text-magenta-600 hover:bg-magenta-50 transition-colors active:scale-[0.96] flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  disabled={isAuthenticated ? !hasAnswered : false}
                  onClick={() => guardAction(goNextQuestion)}
                  className={cn(
                    "flex-1 py-3.5 rounded-full font-semibold text-sm transition-all active:scale-[0.96]",
                    isAuthenticated && hasAnswered
                      ? "bg-magenta-500 text-white hover:bg-magenta-600 shadow-lg shadow-magenta-500/20"
                      : "bg-magenta-100 text-magenta-300 cursor-not-allowed"
                  )}
                >
                  {!isAuthenticated
                    ? "Login to Continue"
                    : qIndex < QUESTIONS.length - 1
                    ? "Next Question"
                    : "Next: Upload Photo"}
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 2: Upload */}
          {currentStep === 2 && !isAnalyzing && !showResult && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-white rounded-[20px] shadow-[0_4px_24px_rgba(160,25,90,0.08)] p-6 sm:p-8"
            >
              <button
                onClick={() => setCurrentStep(1)}
                className="flex items-center gap-1 text-sm text-magenta-500 mb-4 hover:text-magenta-600"
              >
                <ArrowLeft className="w-4 h-4" /> Back to questions
              </button>

              <h2 className="text-xl font-display font-bold text-magenta-900 mb-1">Upload Photos</h2>
              <p className="text-sm text-magenta-400 mb-6">
                2 photos required — one close-up and one showing the surrounding area.
              </p>

              {quickPreview.urgent && (
                <div className="mb-6 rounded-xl border-2 border-red-200 bg-red-50 p-4 flex gap-3">
                  <ShieldAlert className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-red-800">
                      {quickPreview.urgentType === "emergency" ? "Emergency warning sign" : "Urgent warning sign"}
                    </p>
                    <p className="text-xs text-red-700 mt-1 leading-relaxed">{quickPreview.urgentMessage}</p>
                    <p className="text-xs text-red-700 mt-1">
                      Please seek medical attention promptly — this analysis is not a substitute for care.
                    </p>
                  </div>
                </div>
              )}

              {analyzeError && (
                <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {analyzeError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                {(
                  [
                    { slot: "closeup" as const, title: "Photo 1 — Close-up", image: closeUpImage, inputRef: closeUpInputRef, cameraRef: closeUpCameraRef },
                    { slot: "wide" as const, title: "Photo 2 — Wider view", image: wideImage, inputRef: wideInputRef, cameraRef: wideCameraRef },
                  ]
                ).map((p) => (
                  <div key={p.slot}>
                    <p className="text-xs font-semibold text-magenta-700 mb-2">{p.title}</p>

                    {!p.image ? (
                      <div
                        onClick={() => guardAction(() => p.inputRef.current?.click())}
                        className="border-2 border-dashed border-magenta-200 rounded-2xl p-8 text-center cursor-pointer hover:border-magenta-400 hover:bg-magenta-50/50 transition-colors"
                      >
                        <Camera className="w-8 h-8 text-magenta-300 mx-auto mb-3" />
                        <p className="text-magenta-900 font-semibold text-sm mb-1">Tap to add</p>
                        <p className="text-magenta-400 text-xs">JPG, PNG, or HEIC</p>
                      </div>
                    ) : (
                      <div className="relative rounded-2xl overflow-hidden">
                        <img src={p.image} alt={p.title} className="w-full h-40 object-cover" />
                        <button
                          onClick={() => clearPhoto(p.slot)}
                          className="absolute top-2 right-2 bg-white/90 backdrop-blur-sm rounded-full p-1.5 text-magenta-500 hover:bg-white"
                        >
                          ✕
                        </button>
                      </div>
                    )}

                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => guardAction(() => p.inputRef.current?.click())}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border-2 border-magenta-200 text-magenta-700 text-xs font-medium hover:bg-magenta-50 transition-colors"
                      >
                        <Image className="w-3.5 h-3.5" />
                        Gallery
                      </button>
                      <button
                        onClick={() => guardAction(() => p.cameraRef.current?.click())}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border-2 border-magenta-200 text-magenta-700 text-xs font-medium hover:bg-magenta-50 transition-colors"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        Camera
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  {(["closeup", "wide"] as const).map((slot, i) => {
                    const uploaded = slot === "closeup" ? !!closeUpImage : !!wideImage;
                    return (
                      <span
                        key={slot}
                        className={cn(
                          "px-3 py-1.5 rounded-full text-xs font-semibold border-2 flex items-center gap-1.5",
                          uploaded
                            ? "border-magenta-500 bg-magenta-50 text-magenta-700"
                            : "border-magenta-200 text-magenta-400"
                        )}
                      >
                        <span
                          className={cn(
                            "w-2.5 h-2.5 rounded-full border-2 shrink-0",
                            uploaded ? "border-magenta-500 bg-magenta-500" : "border-magenta-300"
                          )}
                        />
                        Photo {i + 1}
                      </span>
                    );
                  })}
                </div>
                <span className="text-xs font-semibold text-magenta-400">{uploadedCount}/2 uploaded</span>
              </div>

              <div className="bg-magenta-50 rounded-xl p-4 mb-6">
                <p className="text-sm font-semibold text-magenta-900 mb-2">📸 Photo Guidelines</p>
                <ul className="space-y-1.5 mb-3">
                  {[
                    { icon: Sun, text: "Good lighting — use natural light" },
                    { icon: ZoomIn, text: "Close-up of the affected area" },
                    { icon: Sparkles, text: "No filters or editing" },
                  ].map((item, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-magenta-700">
                      <item.icon className="w-3.5 h-3.5 text-magenta-400 shrink-0" />
                      {item.text}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-magenta-500 leading-relaxed">
                  Before AI analysis, the system automatically checks photo quality and confirms if human skin
                  is detected. If validation fails, you will be asked to retake the photo.
                </p>
              </div>

              <div className="mb-6 rounded-xl border border-magenta-200 bg-magenta-50 p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="shrink-0 w-9 h-9 rounded-full bg-white flex items-center justify-center shadow-sm">
                    <Lock className="w-4 h-4 text-magenta-500" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-magenta-900">Free Plan: {MAX_FREE_SCANS} Scans</p>
                    <p className="text-xs text-magenta-600 mt-0.5">
                      You have{" "}
                      <span className="font-semibold">
                        {subLoading
                          ? "…"
                          : `${scansLeft} free skin scan${typeof scansLeft === "number" && scansLeft !== 1 ? "s" : ""}`}
                      </span>
                      . Upgrade for unlimited access.
                    </p>
                  </div>
                </div>
                <Link
                  to="/user/upgrade"
                  className="shrink-0 px-4 py-2 rounded-full bg-magenta-500 text-white text-xs font-bold hover:bg-magenta-600 transition-colors shadow-sm"
                >
                  Upgrade
                </Link>
              </div>

              <button
                disabled={isAuthenticated ? !allPhotosUploaded || !canScan : false}
                onClick={() => guardAction(handleAnalyze)}
                className={cn(
                  "w-full py-3.5 rounded-full font-semibold text-sm transition-all active:scale-[0.96]",
                  isAuthenticated && allPhotosUploaded && canScan
                    ? "bg-magenta-500 text-white hover:bg-magenta-600 shadow-lg shadow-magenta-500/20"
                    : "bg-magenta-100 text-magenta-300 cursor-not-allowed"
                )}
              >
                {!isAuthenticated
                  ? "Login to Analyze"
                  : !canScan
                  ? "Out of Free Scans"
                  : !allPhotosUploaded
                  ? `Add ${2 - uploadedCount} more photo${2 - uploadedCount !== 1 ? "s" : ""} to continue`
                  : "Analyze Skin Condition"}
              </button>
            </motion.div>
          )}

          {/* Analyzing State */}
          {isAnalyzing && (
            <motion.div
              key="analyzing"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="bg-white rounded-[20px] shadow-[0_4px_24px_rgba(160,25,90,0.08)] p-12 text-center"
            >
              <div className="w-16 h-16 rounded-full bg-magenta-100 flex items-center justify-center mx-auto mb-6 animate-pulse">
                <Sparkles className="w-8 h-8 text-magenta-500" />
              </div>
              <h2 className="text-xl font-display font-bold text-magenta-900 mb-2">Analyzing your photo...</h2>
              <p className="text-magenta-400 text-sm">Our AI is examining your skin condition</p>
              <div className="w-48 h-2 bg-magenta-100 rounded-full mx-auto mt-6 overflow-hidden">
                <motion.div
                  className="h-full bg-magenta-500 rounded-full"
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 2.5, ease: "easeInOut" }}
                />
              </div>
            </motion.div>
          )}

          {/* Step 3: Result */}
          {currentStep === 3 && showResult && scanResult && (
            <motion.div key="step3" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              <div className="bg-white rounded-[20px] shadow-[0_4px_24px_rgba(160,25,90,0.08)] overflow-hidden">
                <div className="p-6 sm:p-8 border-b border-magenta-100">
                  <h2 className="text-3xl font-display font-bold text-magenta-900 mb-1">
                    Possible {scanResult.condition}
                  </h2>
                  <p className="text-magenta-400 text-sm">{scanResult.localName} (Filipino name)</p>
                </div>

                <div className="px-6 sm:px-8 py-5 border-b border-magenta-100 space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-magenta-700">AI Confidence Score</span>
                      <span className="text-lg font-bold text-magenta-500">{scanResult.confidence}%</span>
                    </div>
                    <div className="w-full h-3 bg-magenta-100 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-linear-to-r from-magenta-400 to-magenta-500 rounded-full"
                        initial={{ width: "0%" }}
                        animate={{ width: `${scanResult.confidence}%` }}
                        transition={{ duration: 1, delay: 0.3 }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-magenta-50 rounded-xl px-4 py-3 border border-magenta-100">
                    <MapPin className="w-4 h-4 text-magenta-400" />
                    <span className="text-sm text-magenta-700 font-medium">{scanResult.bodyPart}</span>
                    <span className="ml-auto text-xs text-magenta-400">{scanResult.date}</span>
                  </div>
                </div>

                <div className="p-6 sm:p-8 border-b border-magenta-100">
                  <h3 className="font-display font-bold text-magenta-900 text-lg mb-4">Your Uploaded Photo</h3>
                  <div className="relative overflow-hidden rounded-2xl border border-magenta-100 bg-magenta-50">
                    <img
                      src={scanResult.imageUrl || closeUpImage || undefined}
                      alt={`${scanResult.condition} scan`}
                      className="w-full h-64 sm:h-80 object-cover"
                    />
                  </div>
                </div>

                <div className="p-6 sm:p-8 space-y-8">
                  <div>
                    <h3 className="font-display font-bold text-magenta-900 text-lg mb-3">What is it?</h3>
                    <p className="text-sm text-magenta-700 leading-relaxed">{scanResult.description}</p>
                  </div>

                  <div>
                    <h3 className="font-display font-bold text-magenta-900 text-lg mb-3">Common Symptoms</h3>
                    <ul className="space-y-2">
                      {scanResult.symptoms.map((s, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-magenta-700">
                          <div className="w-1.5 h-1.5 rounded-full bg-magenta-400 mt-1.5 shrink-0" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="bg-magenta-50 rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="w-5 h-5 text-magenta-500" />
                      <h3 className="font-display font-bold text-magenta-900 text-lg">Who does it affect?</h3>
                    </div>
                    <p className="text-sm text-magenta-700 leading-relaxed">{scanResult.whoAffected}</p>
                  </div>

                  <div>
                    <h3 className="font-display font-bold text-magenta-900 text-lg mb-3">Basic Care Tips</h3>
                    <ul className="space-y-2">
                      {scanResult.careTips.map((tip, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-magenta-700">
                          <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="bg-amber-50 rounded-xl p-5 border border-amber-200">
                    <div className="flex items-center gap-2 mb-2">
                      <Stethoscope className="w-5 h-5 text-amber-600" />
                      <h3 className="font-display font-bold text-amber-900 text-lg">When to See a Doctor</h3>
                    </div>
                    <p className="text-sm text-amber-800 leading-relaxed">{scanResult.whenToSeeDoctor}</p>
                  </div>

                  <div className="bg-rose-soft/50 rounded-xl p-5 flex gap-3">
                    <AlertTriangle className="w-5 h-5 text-magenta-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-magenta-900 mb-1">Medical Disclaimer</p>
                      <p className="text-xs text-magenta-700 leading-relaxed">
                        This information is for educational purposes only and is NOT a medical diagnosis. Always
                        consult a licensed dermatologist for proper evaluation and treatment.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-[20px] shadow-[0_4px_24px_rgba(160,25,90,0.08)] p-6 sm:p-8">
                <h3 className="text-lg font-display font-bold text-magenta-900 mb-4">Recommended Clinics Near You</h3>
                <div className="space-y-3">
                  {recommendedClinics.map((clinic, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-4 rounded-xl border border-magenta-100 hover:border-magenta-200 transition-colors"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-magenta-900 text-sm">{clinic.name}</span>
                          {clinic.verified && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold">
                              ✓ Verified
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-magenta-400 mt-1 flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> {clinic.addr}
                        </p>
                      </div>
                      <Link
                        to="/clinics"
                        className="px-4 py-2 rounded-full bg-magenta-500 text-white text-xs font-semibold hover:bg-magenta-600 transition-colors"
                      >
                        View
                      </Link>
                    </div>
                  ))}
                  {recommendedClinics.length === 0 && (
                    <p className="text-xs text-magenta-400">Loading nearby clinics…</p>
                  )}
                </div>
                <Link
                  to="/clinics"
                  className="flex items-center justify-center gap-1 mt-4 text-sm text-magenta-500 font-semibold hover:text-magenta-600"
                >
                  View all clinics <ArrowRight className="w-4 h-4" />
                </Link>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setCurrentStep(1);
                    setQIndex(0);
                    setShowResult(false);
                    clearPhoto("closeup");
                    clearPhoto("wide");
                    setScanResult(null);
                    setAnswers({});
                  }}
                  className="flex-1 py-3.5 rounded-full font-semibold text-sm border-2 border-magenta-500 text-magenta-500 hover:bg-magenta-50 transition-colors active:scale-[0.96]"
                >
                  Scan Again
                </button>
                <Link
                  to="/clinics"
                  className="flex-1 py-3.5 rounded-full font-semibold text-sm bg-magenta-500 text-white text-center hover:bg-magenta-600 transition-colors shadow-lg shadow-magenta-500/20 active:scale-[0.96]"
                >
                  Find a Clinic
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}