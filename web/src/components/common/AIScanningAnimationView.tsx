import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, GitMerge, Scan, Compass, ShieldCheck } from "lucide-react";

export interface AIScanningAnimationViewProps {
  closeUpImage: string | null;
  wideImage: string | null;
  /** When true, indicates the async AI inference has successfully resolved */
  isInferenceComplete?: boolean;
}

const PHASES = [
  {
    title: "Detecting Close-Up Lesion...",
    sub: "Extracting dermatological macro texture & lesion borders",
    tag: "PHASE 1 / 5",
  },
  {
    title: "Calibrating Wide-View Context...",
    sub: "Evaluating anatomical skin region & surrounding tissue",
    tag: "PHASE 2 / 5",
  },
  {
    title: "Neural Feature Extraction...",
    sub: "ResNet50 cross-referencing multi-layer skin patterns",
    tag: "PHASE 3 / 5",
  },
  {
    title: "Synthesizing Dual-View Evidence...",
    sub: "Merging 70/30 visual weights with questionnaire answers",
    tag: "PHASE 4 / 5",
  },
  {
    title: "Finalizing AI Assessment...",
    sub: "Generating comprehensive clinical report & care guidance",
    tag: "PHASE 5 / 5",
  },
];

export default function AIScanningAnimationView({
  closeUpImage,
  wideImage,
  isInferenceComplete = false,
}: AIScanningAnimationViewProps) {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [progressPercent, setProgressPercent] = useState(5);

  useEffect(() => {
    // Phase 1 is active immediately (0.0s – 0.7s)
    setPhaseIndex(0);

    // Phase 2 triggers at 0.8s (0.8s – 1.5s)
    const t2 = setTimeout(() => {
      setPhaseIndex(1);
    }, 800);

    // Phase 3 triggers at 1.6s (1.6s – 2.5s)
    const t3 = setTimeout(() => {
      setPhaseIndex(2);
    }, 1600);

    // Phase 4 triggers at 2.6s (2.6s – 3.5s)
    const t4 = setTimeout(() => {
      setPhaseIndex(3);
    }, 2600);

    // Phase 5 triggers at 3.6s+
    const t5 = setTimeout(() => {
      setPhaseIndex(4);
    }, 3600);

    return () => {
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, []);

  // Smooth progressive bar fill: 5% -> 95% over 3.6s, fills to 100% when inference completes
  useEffect(() => {
    if (isInferenceComplete && phaseIndex >= 4) {
      setProgressPercent(100);
      return;
    }

    const interval = setInterval(() => {
      setProgressPercent((prev) => {
        if (prev >= 95 && !isInferenceComplete) return 95;
        if (prev >= 100) return 100;
        const increment = prev < 50 ? 3.5 : prev < 80 ? 2.5 : 1.2;
        return Math.min(prev + increment, 95);
      });
    }, 100);

    return () => clearInterval(interval);
  }, [isInferenceComplete, phaseIndex]);

  const currentPhase = PHASES[phaseIndex] || PHASES[0];

  return (
    <motion.div
      key="scanning-animation-stage"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="relative w-full max-w-2xl mx-auto bg-white rounded-3xl border border-slate-200/90 shadow-xl shadow-slate-200/50 p-6 md:p-8 overflow-hidden text-center"
    >
      {/* Ambient Pulsating Aura Background */}
      <motion.div
        className="absolute -top-24 left-1/2 -translate-x-1/2 w-80 h-80 rounded-full bg-gradient-to-b from-magenta-200/50 via-pink-100/30 to-transparent blur-3xl pointer-events-none"
        animate={{
          opacity: phaseIndex >= 2 ? [0.4, 0.85, 0.4] : 0.4,
          scale: phaseIndex >= 2 ? [1, 1.08, 1] : 1,
        }}
        transition={{
          repeat: Infinity,
          duration: 1.6,
          ease: "easeInOut",
        }}
      />

      {/* Top Header Badge */}
      <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-magenta-50/90 border border-magenta-200/80 mb-3 shadow-xs">
        <Sparkles className="w-3.5 h-3.5 text-magenta-600 animate-pulse" />
        <span className="text-[11px] font-extrabold tracking-wider text-magenta-700 uppercase">
          DermAI Neural Engine
        </span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-magenta-100 text-magenta-800 ml-1">
          {currentPhase.tag}
        </span>
      </div>

      {/* Dynamic Animated Status Header */}
      <div className="min-h-[64px] mb-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentPhase.title}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
          >
            <h2 className="text-xl md:text-2xl font-display font-extrabold text-slate-900 tracking-tight">
              {currentPhase.title}
            </h2>
            <p className="text-xs md:text-sm text-slate-500 mt-1 max-w-lg mx-auto">
              {currentPhase.sub}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Dual Photo Stage Container */}
      <div className="relative w-full h-56 md:h-64 my-3 flex items-center justify-center overflow-hidden rounded-2xl bg-slate-950/5 border border-slate-200/60 p-3">
        {/* Stage Grid Overlay for high-tech HUD aesthetic */}
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(to right, #000 1px, transparent 1px), linear-gradient(to bottom, #000 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />

        {/* PHOTO 1: Close-Up Lesion Macro Photo */}
        <motion.div
          className="relative z-10 w-36 h-48 md:w-44 md:h-56 rounded-2xl bg-white border-2 border-magenta-500 shadow-lg shadow-magenta-500/20 overflow-hidden flex items-center justify-center"
          initial={{ opacity: 0, x: -70, scale: 0.8 }}
          animate={{
            opacity: 1,
            x: phaseIndex >= 3 ? 38 : 0,
            scale:
              phaseIndex === 2
                ? [1, 1.05, 1]
                : phaseIndex >= 3
                ? 1.02
                : 1,
          }}
          transition={{
            opacity: { duration: 0.65, ease: "easeOut" },
            x:
              phaseIndex >= 3
                ? { duration: 0.75, ease: [0.16, 1, 0.3, 1] }
                : { type: "spring", stiffness: 90, damping: 13 },
            scale:
              phaseIndex === 2
                ? { repeat: Infinity, duration: 1.4, ease: "easeInOut" }
                : { duration: 0.4 },
          }}
        >
          {closeUpImage ? (
            <img
              src={closeUpImage}
              alt="Close-Up Lesion"
              className="w-full h-full object-cover select-none pointer-events-none"
            />
          ) : (
            <div className="w-full h-full bg-magenta-50 flex items-center justify-center text-magenta-600">
              <Scan className="w-8 h-8" />
            </div>
          )}

          {/* Badge Label */}
          <div className="absolute bottom-2 inset-x-2 bg-slate-900/80 backdrop-blur-xs rounded-lg py-1 px-2 flex items-center justify-center gap-1.5 shadow-xs">
            <Scan className="w-3 h-3 text-magenta-300" />
            <span className="text-[10px] font-bold text-white tracking-wide">
              1. Close-Up
            </span>
          </div>

          {/* HUD Corner Targeting Brackets */}
          <div className="absolute top-2 left-2 w-3.5 h-3.5 border-t-2 border-l-2 border-white pointer-events-none drop-shadow-sm" />
          <div className="absolute top-2 right-2 w-3.5 h-3.5 border-t-2 border-r-2 border-white pointer-events-none drop-shadow-sm" />
          <div className="absolute bottom-8 left-2 w-3.5 h-3.5 border-b-2 border-l-2 border-white pointer-events-none drop-shadow-sm" />
          <div className="absolute bottom-8 right-2 w-3.5 h-3.5 border-b-2 border-r-2 border-white pointer-events-none drop-shadow-sm" />
        </motion.div>

        {/* CENTRAL NEURAL BRIDGE NODE */}
        <AnimatePresence>
          {phaseIndex >= 1 && phaseIndex < 4 && (
            <motion.div
              key="neural-bridge"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{
                opacity: phaseIndex === 3 ? 0.3 : 1,
                scale:
                  phaseIndex === 2
                    ? [1, 1.15, 1]
                    : phaseIndex === 3
                    ? 0.7
                    : 1,
              }}
              exit={{ opacity: 0, scale: 0.4 }}
              transition={{
                opacity: { duration: 0.4 },
                scale:
                  phaseIndex === 2
                    ? { repeat: Infinity, duration: 1.4, ease: "easeInOut" }
                    : { duration: 0.4 },
              }}
              className="relative z-20 flex flex-col items-center justify-center mx-2 md:mx-4 shrink-0"
            >
              <div className="w-0.5 h-6 bg-gradient-to-b from-transparent via-magenta-300 to-magenta-400" />
              <div className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-white border border-magenta-300 shadow-md shadow-magenta-300/40 flex items-center justify-center my-1">
                <GitMerge className="w-4 h-4 text-magenta-600" />
              </div>
              <div className="w-0.5 h-6 bg-gradient-to-t from-transparent via-magenta-300 to-magenta-400" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* PHOTO 2: Wide-View Context Photo */}
        <motion.div
          className="relative z-10 w-36 h-48 md:w-44 md:h-56 rounded-2xl bg-white border-2 border-magenta-500 shadow-lg shadow-magenta-500/20 overflow-hidden flex items-center justify-center"
          initial={{ opacity: 0, scale: 0.75 }}
          animate={{
            opacity: phaseIndex >= 1 ? 1 : 0,
            x: phaseIndex >= 3 ? -38 : 0,
            scale:
              phaseIndex === 0
                ? 0.75
                : phaseIndex === 2
                ? [1, 1.05, 1]
                : phaseIndex >= 3
                ? 1.02
                : 1,
          }}
          transition={{
            opacity: { duration: 0.6, ease: "easeOut" },
            x: { duration: 0.75, ease: [0.16, 1, 0.3, 1] },
            scale:
              phaseIndex === 2
                ? { repeat: Infinity, duration: 1.4, ease: "easeInOut" }
                : { duration: 0.4 },
          }}
        >
          {wideImage ? (
            <img
              src={wideImage}
              alt="Wide-View Context"
              className="w-full h-full object-cover select-none pointer-events-none"
            />
          ) : (
            <div className="w-full h-full bg-magenta-50 flex items-center justify-center text-magenta-600">
              <Compass className="w-8 h-8" />
            </div>
          )}

          {/* Badge Label */}
          <div className="absolute bottom-2 inset-x-2 bg-slate-900/80 backdrop-blur-xs rounded-lg py-1 px-2 flex items-center justify-center gap-1.5 shadow-xs">
            <Compass className="w-3 h-3 text-magenta-300" />
            <span className="text-[10px] font-bold text-white tracking-wide">
              2. Wide-View
            </span>
          </div>

          {/* HUD Corner Targeting Brackets */}
          <div className="absolute top-2 left-2 w-3.5 h-3.5 border-t-2 border-l-2 border-white pointer-events-none drop-shadow-sm" />
          <div className="absolute top-2 right-2 w-3.5 h-3.5 border-t-2 border-r-2 border-white pointer-events-none drop-shadow-sm" />
          <div className="absolute bottom-8 left-2 w-3.5 h-3.5 border-b-2 border-l-2 border-white pointer-events-none drop-shadow-sm" />
          <div className="absolute bottom-8 right-2 w-3.5 h-3.5 border-b-2 border-r-2 border-white pointer-events-none drop-shadow-sm" />
        </motion.div>

        {/* LASER BEAM SWEEP (Phase 3+) */}
        {phaseIndex >= 2 && (
          <motion.div
            className="absolute left-6 right-6 h-[3px] bg-gradient-to-r from-transparent via-magenta-500 to-transparent pointer-events-none z-30 shadow-[0_0_14px_#be185d]"
            initial={{ top: "15%" }}
            animate={{ top: ["15%", "85%", "15%"] }}
            transition={{
              repeat: Infinity,
              duration: 1.8,
              ease: "easeInOut",
            }}
          >
            <div className="absolute -top-1.5 left-1/4 right-1/4 h-4 bg-magenta-400/35 blur-xs rounded-full" />
          </motion.div>
        )}

        {/* BRIGHT FLASH OVERLAY ON MERGE IMPACT (Phase 4) */}
        {phaseIndex >= 3 && (
          <motion.div
            key="merge-flash"
            className="absolute inset-0 bg-white/95 z-40 pointer-events-none rounded-2xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.95, 0] }}
            transition={{ duration: 0.75, ease: "easeOut" }}
          />
        )}
      </div>

      {/* Sleek Neural Progress Bar */}
      <div className="w-full mt-5 px-1">
        <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200/60 p-0.5">
          <motion.div
            className="h-full bg-gradient-to-r from-magenta-600 via-pink-500 to-rose-500 rounded-full shadow-sm"
            animate={{ width: `${progressPercent}%` }}
            transition={{ ease: "easeOut", duration: 0.2 }}
          />
        </div>

        {/* Progress Footer Status */}
        <div className="flex items-center justify-between text-xs mt-3 text-slate-500">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="font-medium text-slate-600">
              {phaseIndex >= 4
                ? "Finalizing assessment..."
                : "Deep neural scan running..."}
            </span>
          </div>
          <div className="flex items-center gap-1 font-bold text-magenta-700 bg-magenta-50 px-2 py-0.5 rounded-md border border-magenta-100">
            <ShieldCheck className="w-3 h-3 text-magenta-600" />
            <span>70/30 Dual-View</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
