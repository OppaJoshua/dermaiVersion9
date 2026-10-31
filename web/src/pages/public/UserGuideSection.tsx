import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useScroll, useSpring, useTransform } from "framer-motion";
import {
  UserPlus,
  ScanLine,
  CalendarCheck,
  BellRing,
  Crown,
  Check,
  MousePointer2,
  Sparkles,
  MapPin,
  Search,
  Star,
  Clock,
  ShieldCheck,
  Camera,
  CircleCheck,
  CreditCard,
  Infinity as InfinityIcon,
} from "lucide-react";
import guideAvatar from "@/assets/guide-avatar.jpg";
import guideSkin from "@/assets/guide-skin.jpg";
import guideSkinWide from "@/assets/guide-skin-wide.jpg";

type Step = {
  icon: typeof UserPlus;
  title: string;
  subtitle: string;
  items: string[];
  note?: { label: string; text: string };
};

const STEPS: Step[] = [
  {
    icon: UserPlus,
    title: "Create Your Account",
    subtitle: "Step 1",
    items: [
      "Open the DermAI Login Page and select Continue with Google.",
      "Sign in with your Google account.",
      "Complete your personal information.",
      "Select Save Changes to update your profile.",
    ],
  },
  {
    icon: ScanLine,
    title: "Run a Skin Scan",
    subtitle: "Step 2",
    items: [
      "Select Scan Skin from the sidebar.",
      "Answer the short symptom questionnaire honestly and accurately.",
      "Review your answers before continuing.",
      "Upload clear, well-lit photos: a close-up photo and a wide-view photo showing the surrounding skin.",
      "Submit your photos for analysis.",
      "Review your AI-generated result, confidence score, and care tips.",
    ],
    note: {
      label: "Reminder",
      text: "DermAI provides informational analysis, not a medical diagnosis. Consult a dermatologist for professional assessment and treatment.",
    },
  },
  {
    icon: CalendarCheck,
    title: "Find and Book a Clinic",
    subtitle: "Step 3",
    items: [
      "Go to Appointment Booking → Search Clinic in the sidebar.",
      "Browse verified dermatology clinics near you.",
      "Select a clinic and complete the required personal information.",
      "Choose your preferred doctor, appointment date, and time.",
      "Review and submit your appointment request.",
      "Complete the required payment and wait for the clinic's confirmation.",
    ],
    note: {
      label: "Note",
      text: "Your preferred schedule is subject to the clinic's approval. Submitting a request and payment does not automatically confirm your appointment.",
    },
  },
  {
    icon: BellRing,
    title: "Track Your Appointments",
    subtitle: "Step 4",
    items: [
      "Go to Monitor → Appointment Status.",
      "View your pending, scheduled, or completed appointments.",
      "Check your notifications to see whether the clinic has accepted or rejected your request.",
      "Once accepted, review your confirmed appointment details.",
    ],
  },
  {
    icon: Crown,
    title: "Upgrade to Pro",
    subtitle: "Step 5",
    items: [
      "Free accounts include three skin scans per account. Upgrade to Pro for unlimited scans.",
      "Go to Subscription → Upgrade Plan.",
      "Choose Monthly (₱199 per month) or Yearly (₱1,999 per year).",
      "Follow the payment instructions to complete your upgrade.",
      "Go to Settings → Billing to manage your subscription and payment method.",
    ],
    note: {
      label: "Good to know",
      text: "You can cancel anytime. Your Pro access stays active until the end of your current paid subscription period.",
    },
  },
];


/* ---------- Visual mock-ups (one per step) ---------- */

const pop = (i: number) => ({
  initial: { opacity: 0, y: 16, scale: 0.95 },
  animate: { opacity: 1, y: 0, scale: 1 },
  transition: { delay: 0.12 * i, duration: 0.45, ease: "easeOut" as const },
});

const GoogleG = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

/** Runs `fn` timers only while the mock is on screen. */
function useLive() {
  const ref = useRef<HTMLDivElement>(null);
  const live = useInView(ref, { amount: 0.4 });
  return { ref, live };
}

/** Cycles through phases while live; resets when scrolled away. */
function usePhases(durations: number[], live: boolean) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!live) {
      setPhase(0);
      return;
    }
    const t = setTimeout(() => setPhase((p) => (p + 1) % durations.length), durations[phase]);
    return () => clearTimeout(t);
  }, [phase, live, durations]);
  return phase;
}

function Typed({ text, delay }: { text: string; delay: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let iv: ReturnType<typeof setInterval>;
    const t = setTimeout(() => {
      iv = setInterval(() => setN((c) => (c >= text.length ? c : c + 1)), 55);
    }, delay);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
    };
  }, [text, delay]);
  return (
    <>
      {text.slice(0, n)}
      {n < text.length && <span className="inline-block w-px h-3 bg-magenta-500 ml-0.5 align-middle animate-pulse" />}
    </>
  );
}

const ACCOUNT_MS = [3200, 4400, 3800];
function MockAccount() {
  const { ref, live } = useLive();
  const phase = usePhases(ACCOUNT_MS, live);

  const fields = [
    { label: "Full name", value: "Maria Santos", delay: 300 },
    { label: "Phone", value: "0917 123 4567", delay: 1100 },
    { label: "Address", value: "Lahug, Cebu City", delay: 1900 },
  ];
  const labels = ["Google", "Sign in", "Info", "Save"];

  return (
    <div ref={ref} className="w-full max-w-xs">
      {/* Progress tracker: steps 1-4 */}
      <div className="flex items-center mb-4 px-1">
        {labels.map((l, i) => {
          const reached = phase === 0 ? i <= 1 : phase === 1 ? i <= 2 : true;
          return (
            <div key={l} className="flex items-center flex-1 last:flex-none">
              <motion.span
                animate={{ scale: reached ? 1 : 0.85 }}
                className={`w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center transition-colors duration-500 ${
                  reached ? "bg-magenta-500 text-white" : "bg-white text-gray-400"
                }`}
              >
                {phase === 2 && i === 3 ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </motion.span>
              {i < 3 && (
                <span className="flex-1 h-0.5 mx-1 bg-white rounded overflow-hidden">
                  <motion.span
                    className="block h-full bg-magenta-400"
                    animate={{ width: (phase === 0 ? i < 1 : phase === 1 ? i < 2 : true) ? "100%" : "0%" }}
                    transition={{ duration: 0.6 }}
                  />
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="relative h-[310px]">
        <AnimatePresence mode="wait">
          {phase === 0 ? (
            <motion.div
              key="google"
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute inset-0 bg-white rounded-3xl p-5 shadow-[0_12px_40px_rgba(61,8,36,0.12)]"
            >
              <div className="flex items-center justify-center gap-2 mb-4">
                <GoogleG />
                <span className="text-xs font-semibold text-gray-600">Sign in with Google</span>
              </div>
              <p className="text-[11px] text-gray-400 text-center mb-3">Choose an account to continue to DermAI</p>
              <div className="flex items-center gap-3 rounded-2xl border border-gray-100 p-3">
                <img src={guideAvatar} alt="Google account profile" className="w-11 h-11 rounded-full object-cover" />
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="text-sm font-bold text-gray-800">Maria Santos</p>
                  <p className="text-[11px] text-gray-500 truncate">maria.santos@gmail.com</p>
                </div>
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 1.6, type: "spring" }}
                  className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center"
                >
                  <Check className="w-3.5 h-3.5" />
                </motion.span>
              </div>
              <div className="relative mt-5">
                <motion.div
                  animate={{ scale: [1, 1, 0.95, 1] }}
                  transition={{ duration: 1.8, times: [0, 0.75, 0.83, 1] }}
                  className="flex items-center justify-center gap-2.5 rounded-full border border-gray-200 bg-white py-2.5 shadow-sm"
                >
                  <GoogleG className="w-4 h-4" />
                  <span className="text-xs font-semibold text-gray-700">Continue as Maria</span>
                </motion.div>
                <motion.span
                  className="absolute text-magenta-600"
                  initial={{ left: "90%", top: "170%", opacity: 0 }}
                  animate={{ left: "62%", top: "55%", opacity: 1 }}
                  transition={{ duration: 1.3, ease: "easeOut" }}
                >
                  <MousePointer2 className="w-5 h-5 fill-white" />
                </motion.span>
              </div>
              <p className="mt-6 text-[11px] text-gray-400 text-center">
                1 · Continue with Google &nbsp; 2 · Sign in
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="profile"
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute inset-0 bg-white rounded-3xl p-5 shadow-[0_12px_40px_rgba(61,8,36,0.12)]"
            >
              <div className="flex items-center gap-3 mb-4">
                <img src={guideAvatar} alt="Your profile" className="w-10 h-10 rounded-full object-cover" />
                <div className="leading-tight">
                  <p className="text-sm font-bold text-magenta-900">Your Profile</p>
                  <p className="text-[11px] text-gray-400">3 · Complete your information</p>
                </div>
              </div>
              <div className="space-y-2.5">
                {fields.map((f) => (
                  <div key={f.label}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{f.label}</p>
                    <div className="h-8 rounded-lg bg-magenta-50/70 border border-magenta-100 px-3 flex items-center text-xs text-gray-700">
                      <Typed text={f.value} delay={f.delay} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="relative mt-4">
                <motion.div
                  animate={phase === 2 ? { scale: [1, 1, 0.94, 1], backgroundColor: ["#be185d", "#be185d", "#9d174d", "#be185d"] } : {}}
                  transition={{ duration: 1.6, times: [0, 0.65, 0.75, 1] }}
                  className="rounded-full bg-magenta-600 text-white text-xs font-semibold text-center py-2.5 shadow-lg"
                  style={{ opacity: phase === 2 ? 1 : 0.55 }}
                >
                  Save Changes
                </motion.div>
                {phase === 2 && (
                  <motion.span
                    className="absolute text-magenta-900"
                    initial={{ left: "92%", top: "170%", opacity: 0 }}
                    animate={{ left: "60%", top: "50%", opacity: 1 }}
                    transition={{ duration: 1.1, ease: "easeOut" }}
                  >
                    <MousePointer2 className="w-5 h-5 fill-white" />
                  </motion.span>
                )}
              </div>
              {/* Saved toast */}
              <motion.div
                initial={{ opacity: 0, y: 14, scale: 0.9 }}
                animate={phase === 2 ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 14, scale: 0.9 }}
                transition={{ delay: phase === 2 ? 1.5 : 0, type: "spring", stiffness: 300, damping: 18 }}
                className="absolute left-5 right-5 bottom-3 flex items-center justify-center gap-2 rounded-full bg-green-500 text-white text-xs font-semibold py-2 shadow-lg"
              >
                <Check className="w-3.5 h-3.5" /> 4 · Profile saved!
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

const SCAN_MS = [2800, 2800, 5000];
function PhotoTile({
  src,
  label,
  state,
  spot,
}: {
  src: string;
  label: string;
  state: "wait" | "scan" | "done";
  spot: { left: string; top: string };
}) {
  return (
    <motion.div
      animate={{ scale: state === "scan" ? 1.04 : 1, opacity: state === "wait" ? 0.55 : 1 }}
      transition={{ type: "spring", stiffness: 200, damping: 18 }}
      className="relative aspect-square rounded-2xl overflow-hidden bg-white shadow-[0_10px_30px_rgba(61,8,36,0.18)]"
    >
      <img src={src} alt={`${label} photo of the skin concern`} className="w-full h-full object-cover" />
      {["top-2 left-2 border-t-2 border-l-2", "top-2 right-2 border-t-2 border-r-2", "bottom-2 left-2 border-b-2 border-l-2", "bottom-2 right-2 border-b-2 border-r-2"].map((c) => (
        <span key={c} className={`absolute w-4 h-4 border-white ${c}`} />
      ))}
      {state === "scan" && (
        <>
          <motion.div
            className="absolute inset-x-0 h-12 bg-linear-to-b from-transparent to-magenta-500/40"
            initial={{ top: "-20%" }}
            animate={{ top: ["-20%", "100%"] }}
            transition={{ duration: 1.3, repeat: Infinity, ease: "linear" }}
          />
          <motion.span
            className="absolute inset-x-0 h-0.5 bg-white shadow-[0_0_12px_3px_rgba(236,72,153,0.9)]"
            initial={{ top: "0%" }}
            animate={{ top: ["0%", "100%"] }}
            transition={{ duration: 1.3, repeat: Infinity, ease: "linear" }}
          />
        </>
      )}
      {state === "done" && (
        <>
          <motion.span
            initial={{ scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            style={spot}
            className="absolute w-[22%] aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_3px_rgba(219,39,119,0.65)]"
          />
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 12 }}
            className="absolute top-2 right-2 w-5 h-5 rounded-full bg-green-500 text-white flex items-center justify-center"
          >
            <Check className="w-3 h-3" />
          </motion.span>
        </>
      )}
      <span className="absolute bottom-0 inset-x-0 bg-linear-to-t from-black/60 to-transparent text-white text-[10px] font-semibold text-center pt-4 pb-1.5">
        {label}
      </span>
    </motion.div>
  );
}

function MockScan() {
  const { ref, live } = useLive();
  const phase = usePhases(SCAN_MS, live);

  return (
    <div ref={ref} className="relative w-full max-w-xs">
      {/* camera flash on each capture */}
      <motion.div
        key={`flash-${phase}-${live}`}
        initial={{ opacity: phase < 2 && live ? 0.85 : 0 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.45 }}
        className="pointer-events-none absolute -inset-4 rounded-[28px] bg-white z-20"
      />
      <div className="grid grid-cols-2 gap-3">
        <PhotoTile
          src={guideSkin}
          label="Close-up"
          state={phase === 0 ? "scan" : "done"}
          spot={{ left: "57%", top: "47%" }}
        />
        <PhotoTile
          src={guideSkinWide}
          label="Wide view"
          state={phase === 0 ? "wait" : phase === 1 ? "scan" : "done"}
          spot={{ left: "46%", top: "46%" }}
        />
      </div>

      <div className="h-[120px] mt-4">
        <AnimatePresence mode="wait">
          {phase === 2 ? (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 24, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10 }}
              className="bg-white rounded-2xl p-4 shadow-lg"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-1.5 text-xs font-bold text-magenta-900">
                  <Sparkles className="w-3.5 h-3.5 text-magenta-500" /> Possible: Acne
                </span>
                <span className="text-xs font-bold text-magenta-600">92%</span>
              </div>
              <div className="h-2 rounded-full bg-magenta-50 overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-linear-to-r from-magenta-300 to-magenta-500"
                  initial={{ width: "0%" }}
                  animate={{ width: "92%" }}
                  transition={{ duration: 1, ease: "easeOut" }}
                />
              </div>
              <p className="mt-2.5 text-[11px] text-gray-500 leading-snug">
                Care tip: avoid picking, wash gently twice daily. Consult a dermatologist.
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="status"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="bg-white/80 rounded-2xl p-4 shadow flex items-center gap-3"
            >
              <motion.span
                animate={{ rotate: 360 }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                className="w-8 h-8 rounded-full border-2 border-magenta-200 border-t-magenta-500"
              />
              <div className="leading-tight">
                <p className="text-xs font-bold text-magenta-900">
                  {phase === 0 ? "Scanning close-up photo…" : "Scanning wide-view photo…"}
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">Photo {phase + 1} of 2</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function MockBooking() {
  const clinics = [
    { name: "Cebu Derma Clinic", info: "1.2 km · Cebu City", pin: "left-[30%] top-[35%]" },
    { name: "SkinCare Center", info: "2.8 km · Mandaue", pin: "left-[62%] top-[55%]" },
  ];
  return (
    <div className="w-full max-w-xs space-y-3">
      <motion.div {...pop(0)} className="bg-white rounded-full px-4 py-2.5 shadow-lg flex items-center gap-2 text-xs text-gray-500">
        <Search className="w-4 h-4 text-magenta-500" />
        <motion.span
          initial={{ width: 0 }}
          animate={{ width: "auto" }}
          className="overflow-hidden whitespace-nowrap"
        >
          Dermatology clinics near me
        </motion.span>
      </motion.div>

      {/* mini map */}
      <motion.div
        {...pop(1)}
        className="relative h-32 rounded-2xl overflow-hidden shadow-lg bg-white"
        style={{
          backgroundImage:
            "linear-gradient(rgba(219,39,119,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(219,39,119,0.08) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      >
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 128" fill="none">
          <motion.path
            d="M0 100 C50 90 70 40 110 55 S170 70 200 20"
            stroke="#f9a8d4"
            strokeWidth="6"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.6, delay: 0.3 }}
          />
        </svg>
        {clinics.map((c, i) => (
          <motion.span
            key={c.name}
            initial={{ y: -30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.6 + i * 0.3, type: "spring", stiffness: 300, damping: 12 }}
            className={`absolute ${c.pin} -translate-x-1/2 -translate-y-1/2`}
          >
            <MapPin className="w-7 h-7 text-magenta-500 fill-magenta-100 drop-shadow" />
          </motion.span>
        ))}
      </motion.div>

      {clinics.map((c, i) => (
        <motion.div
          key={c.name}
          {...pop(i + 2)}
          className={`bg-white rounded-2xl p-3 shadow-lg flex items-center gap-3 ${i === 0 ? "ring-2 ring-magenta-400" : ""}`}
        >
          <span className="w-10 h-10 rounded-xl bg-magenta-50 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-magenta-500" />
          </span>
          <div className="flex-1 min-w-0 leading-tight">
            <p className="text-xs font-bold text-magenta-900 truncate">{c.name}</p>
            <p className="text-[11px] text-gray-500 flex items-center gap-1 mt-0.5">
              <Star className="w-3 h-3 text-amber-400 fill-amber-400" /> 4.{9 - i} · {c.info}
            </p>
          </div>
          {i === 0 && (
            <motion.span
              animate={{ scale: [1, 1.08, 1] }}
              transition={{ duration: 1.6, repeat: Infinity }}
              className="text-[10px] font-bold bg-magenta-500 text-white rounded-full px-2.5 py-1"
            >
              Book
            </motion.span>
          )}
        </motion.div>
      ))}
    </div>
  );
}

function MockTrack() {
  const rows = [
    { label: "Pending", color: "bg-amber-400", icon: Clock },
    { label: "Scheduled", color: "bg-magenta-500", icon: CalendarCheck },
    { label: "Completed", color: "bg-green-500", icon: CircleCheck },
  ];
  return (
    <div className="w-full max-w-xs space-y-3">
      <motion.div
        {...pop(0)}
        className="relative bg-white rounded-2xl p-4 shadow-lg flex items-center gap-3"
      >
        <motion.span
          animate={{ rotate: [0, -14, 14, -8, 8, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, repeatDelay: 1.6 }}
          className="w-10 h-10 rounded-xl bg-magenta-500 text-white flex items-center justify-center"
        >
          <BellRing className="w-5 h-5" />
        </motion.span>
        <div>
          <p className="text-xs font-bold text-magenta-900">Request accepted!</p>
          <p className="text-[11px] text-gray-500">Your clinic confirmed</p>
        </div>
        <span className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
      </motion.div>
      {rows.map(({ label, color, icon: Icon }, i) => (
        <motion.div key={label} {...pop(i + 1)} className="bg-white/95 rounded-xl px-4 py-3 shadow flex items-center gap-3">
          <span className={`w-8 h-8 rounded-lg ${color} text-white flex items-center justify-center`}>
            <Icon className="w-4 h-4" />
          </span>
          <span className="text-xs font-semibold text-magenta-900 flex-1">{label}</span>
          <motion.span
            className={`h-1.5 rounded-full ${color}`}
            initial={{ width: 0 }}
            animate={{ width: 56 - i * 14 }}
            transition={{ delay: 0.5 + i * 0.2, duration: 0.8 }}
          />
        </motion.div>
      ))}
    </div>
  );
}

function MockPro() {
  return (
    <div className="w-full max-w-xs space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {[
          { name: "Monthly", price: "₱199", per: "/month", hot: false },
          { name: "Yearly", price: "₱1,999", per: "/year", hot: true },
        ].map((p, i) => (
          <motion.div
            key={p.name}
            {...pop(i)}
            className={`relative rounded-2xl p-4 shadow-lg text-center ${p.hot ? "bg-magenta-900 text-white" : "bg-white text-magenta-900"}`}
          >
            {p.hot && (
              <motion.span
                animate={{ y: [0, -3, 0] }}
                transition={{ duration: 1.8, repeat: Infinity }}
                className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] font-bold bg-amber-400 text-magenta-900 rounded-full px-2 py-0.5"
              >
                BEST VALUE
              </motion.span>
            )}
            <p className="text-[11px] uppercase tracking-wider opacity-70">{p.name}</p>
            <p className="text-xl font-display font-bold mt-1">{p.price}</p>
            <p className="text-[11px] opacity-70">{p.per}</p>
          </motion.div>
        ))}
      </div>
      <motion.div {...pop(2)} className="bg-white rounded-2xl p-4 shadow-lg flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl bg-magenta-50 flex items-center justify-center">
          <motion.span animate={{ rotate: 360 }} transition={{ duration: 6, repeat: Infinity, ease: "linear" }}>
            <InfinityIcon className="w-5 h-5 text-magenta-500" />
          </motion.span>
        </span>
        <div>
          <p className="text-xs font-bold text-magenta-900">Unlimited scans</p>
          <p className="text-[11px] text-gray-500">Free plan: 3 scans</p>
        </div>
      </motion.div>
      <motion.div {...pop(3)} className="bg-white/90 rounded-xl px-4 py-3 shadow flex items-center gap-2 text-xs font-semibold text-magenta-900">
        <CreditCard className="w-4 h-4 text-magenta-500" /> Manage in Settings → Billing
        <Camera className="w-0 h-0" />
      </motion.div>
    </div>
  );
}

const MOCKS = [MockAccount, MockScan, MockBooking, MockTrack, MockPro];




function GuideRow({ step, index }: { step: Step; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20% 0px -20% 0px" });
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const floatY = useTransform(scrollYProgress, [0, 1], [40, -40]);
  const Mock = MOCKS[index];
  const Icon = step.icon;
  const flip = index % 2 === 1;

  return (
    <div
      ref={ref}
      id={`guide-step-${index + 1}`}
      className="relative grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-24 items-center py-14 lg:py-20"
    >
      {/* Timeline node */}
      <motion.span
        initial={{ scale: 0 }}
        animate={inView ? { scale: 1 } : {}}
        transition={{ type: "spring", stiffness: 260, damping: 14 }}
        className="hidden lg:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-magenta-500 text-white items-center justify-center shadow-[0_0_0_8px_white,0_0_0_9px_rgba(219,39,119,0.2)] z-10"
      >
        <Icon className="w-5 h-5" />
      </motion.span>

      {/* Text */}
      <motion.div
        initial={{ opacity: 0, x: flip ? 60 : -60 }}
        animate={inView ? { opacity: 1, x: 0 } : {}}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className={flip ? "lg:order-2" : ""}
      >
        <div className="relative">
          <span className="absolute -top-10 -left-2 text-[7rem] leading-none font-display font-extrabold text-magenta-500/10 select-none">
            0{index + 1}
          </span>
          <h3 className="relative text-2xl lg:text-3xl font-display font-bold text-magenta-900 mb-6">
            {step.title}
          </h3>
        </div>
        <ol className="space-y-3">
          {step.items.map((item, i) => (
            <motion.li
              key={item}
              initial={{ opacity: 0, y: 12 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.25 + i * 0.08, duration: 0.4 }}
              className="flex gap-3 text-sm text-gray-600 leading-relaxed"
            >
              <span className="mt-0.5 w-5 h-5 rounded-full border border-magenta-300 text-magenta-600 text-[10px] font-bold flex items-center justify-center shrink-0">
                {i + 1}
              </span>
              <span>{item}</span>
            </motion.li>
          ))}
        </ol>
        {step.note && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={inView ? { opacity: 1 } : {}}
            transition={{ delay: 0.3 + step.items.length * 0.08 }}
            className="mt-6 border-l-2 border-magenta-400 pl-4 text-xs text-gray-500 leading-relaxed"
          >
            <strong className="text-magenta-600">{step.note.label}:</strong> {step.note.text}
          </motion.p>
        )}
      </motion.div>

      {/* Visual */}
      <motion.div
        style={{ y: floatY }}
        className={`flex justify-center ${flip ? "lg:order-1" : ""}`}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.8, rotate: flip ? 4 : -4 }}
          animate={inView ? { opacity: 1, scale: 1, rotate: 0 } : {}}
          transition={{ type: "spring", stiffness: 140, damping: 16 }}
          className="relative w-full max-w-sm rounded-[36px] bg-magenta-50 p-8 flex justify-center"
        >
          <motion.span
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            className="absolute -top-4 -right-4 w-12 h-12 rounded-2xl bg-magenta-500 text-white flex items-center justify-center shadow-lg lg:hidden"
          >
            <Icon className="w-5 h-5" />
          </motion.span>
          {inView && <Mock />}
        </motion.div>
      </motion.div>
    </div>
  );
}

export default function UserGuideSection() {
  const listRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: listRef, offset: ["start 70%", "end 60%"] });
  const lineScale = useSpring(scrollYProgress, { stiffness: 100, damping: 24 });

  return (
    <section id="user-guide" className="py-24 bg-white overflow-hidden">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-2xl mx-auto"
        >
          <p className="text-magenta-500 font-semibold text-sm tracking-wider uppercase mb-3">User Guide</p>
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-magenta-900 mb-4">
            Get started in 5 easy steps
          </h2>
          <p className="text-gray-500 leading-relaxed">
            Set up your account, scan your skin, and book an appointment with a dermatology clinic.
          </p>
        </motion.div>

        <div ref={listRef} className="relative mt-10">
          {/* Timeline track + scroll-drawn progress */}
          <div className="hidden lg:block absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-gray-100" />
          <motion.div
            style={{ scaleY: lineScale, originY: 0 }}
            className="hidden lg:block absolute left-1/2 top-0 bottom-0 w-0.5 -translate-x-1/2 bg-linear-to-b from-magenta-300 to-magenta-500"
          />
          {STEPS.map((s, i) => (
            <GuideRow key={s.title} step={s} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}