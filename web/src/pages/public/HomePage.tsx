import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Camera,
  Brain,
  MapPin,
  Search,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  BadgeCheck,
  Users,
  Send,
  Sparkles,
} from "lucide-react";
import { motion } from "framer-motion";
import heroLeftImage from "@/assets/homepage-partDesign.png";
import heroRightImage from "@/assets/Girl-homepage.png";
import featureScanImg from "@/assets/feature-scan.jpg";
import featureAiImg from "@/assets/feature-ai.jpg";
import featureClinicImg from "@/assets/feature-clinic.jpg";
import appDownloadImg from "@/assets/app-download-hands.jpg";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
};

const stagger = {
  animate: { transition: { staggerChildren: 0.08 } },
};

const FEATURES = [
  {
    icon: Camera,
    title: "Scan Your Skin",
    desc: "Take a photo of your skin concern and get instant analysis powered by AI technology.",
    link: "/scan",
    cta: "Start a scan",
    image: featureScanImg,
    color: "bg-magenta-500",
  },
  {
    icon: Brain,
    title: "Get AI Analysis",
    desc: "Get an initial AI screening with a confidence guide and practical care tips. For proper diagnosis, we strongly encourage visiting a dermatology clinic in Cebu.",
    link: "/scan",
    cta: "Try AI analysis",
    image: featureAiImg,
    color: "bg-magenta-400",
  },
  {
    icon: MapPin,
    title: "Find a Clinic",
    desc: "Discover verified dermatology clinics near you in Cebu City with directions and contact info.",
    link: "/find-clinics",
    cta: "Browse clinics",
    image: featureClinicImg,
    color: "bg-magenta-300",
  },
];

const AUTOPLAY_MS = 5000;

function FeatureCarousel() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = FEATURES.length;

  // Auto-advance; restarts whenever the active slide changes or hover ends.
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => setActive((a) => (a + 1) % count), AUTOPLAY_MS);
    return () => clearTimeout(t);
  }, [active, paused, count]);

  const go = (dir: 1 | -1) => setActive((a) => (a + dir + count) % count);

  return (
    <section className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex items-end justify-between gap-6 mb-10">
          <div>
            <p className="text-magenta-500 font-semibold text-sm tracking-wider uppercase mb-3">
              What DERMAI Offers
            </p>
            <h2 className="text-3xl sm:text-4xl font-display font-bold text-magenta-900">
              Your skin journey, simplified
            </h2>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <button
              id="feature-carousel-prev"
              type="button"
              aria-label="Previous feature"
              onClick={() => go(-1)}
              className="w-11 h-11 rounded-full border border-gray-200 bg-white flex items-center justify-center text-magenta-900 hover:bg-magenta-500 hover:text-white hover:border-magenta-500 transition-all active:scale-95 cursor-pointer"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              id="feature-carousel-next"
              type="button"
              aria-label="Next feature"
              onClick={() => go(1)}
              className="w-11 h-11 rounded-full border border-gray-200 bg-white flex items-center justify-center text-magenta-900 hover:bg-magenta-500 hover:text-white hover:border-magenta-500 transition-all active:scale-95 cursor-pointer"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Expanding image panels */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="flex flex-col md:flex-row gap-4 md:h-[460px]"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          {FEATURES.map((feature, i) => {
            const isActive = i === active;
            return (
              <div
                key={feature.title}
                id={`feature-card-${i}`}
                role="button"
                tabIndex={0}
                aria-pressed={isActive}
                onClick={() => setActive(i)}
                onMouseEnter={() => setActive(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setActive(i);
                }}
                className={`group relative overflow-hidden rounded-[28px] h-[380px] md:h-auto md:basis-0 cursor-pointer outline-none focus-visible:ring-4 focus-visible:ring-magenta-300 shadow-[0_10px_40px_rgba(61,8,36,0.12)] transition-[flex-grow] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${isActive ? "md:grow-[3]" : "md:grow"
                  }`}
              >
                {/* Background photo */}
                <img
                  src={feature.image}
                  alt={feature.title}
                  loading="lazy"
                  className={`absolute inset-0 w-full h-full object-cover transition-transform duration-[1400ms] ease-out ${isActive ? "scale-105" : "scale-100"
                    }`}
                />
                {/* Readability gradient */}
                <div className="absolute inset-0 bg-linear-to-t from-magenta-900/90 via-magenta-900/30 to-transparent" />
                <div
                  className={`absolute inset-0 bg-magenta-900/25 transition-opacity duration-500 ${isActive ? "opacity-0" : "opacity-100"
                    }`}
                />

                {/* Slide number */}
                <span className="absolute top-5 left-6 text-xs font-semibold tracking-[0.2em] text-white/80 font-mono-accent">
                  0{i + 1}
                </span>

                {/* Content */}
                <div className="absolute inset-x-0 bottom-0 p-6 lg:p-8">
                  <h3 className="text-xl lg:text-2xl font-display font-bold text-white mb-2 leading-tight">
                    {feature.title}
                  </h3>
                  <div
                    className={`grid transition-all duration-500 ease-out ${isActive
                      ? "grid-rows-[1fr] opacity-100"
                      : "grid-rows-[1fr] opacity-100 md:grid-rows-[0fr] md:opacity-0"
                      }`}
                  >
                    <div className="overflow-hidden">
                      <p className="text-sm text-white/85 leading-relaxed max-w-md mb-5">
                        {feature.desc}
                      </p>
                      <Link
                        to={feature.link}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-magenta-600 rounded-full text-sm font-semibold hover:bg-magenta-50 transition-colors shadow-md active:scale-[0.97]"
                      >
                        {feature.cta}
                        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </motion.div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 mt-8">
          {FEATURES.map((feature, i) => (
            <button
              key={feature.title}
              id={`feature-dot-${i}`}
              type="button"
              aria-label={`Show ${feature.title}`}
              onClick={() => setActive(i)}
              className={`relative h-1.5 rounded-full overflow-hidden transition-all duration-500 cursor-pointer ${i === active ? "w-12 bg-magenta-100" : "w-1.5 bg-gray-300 hover:bg-magenta-300"
                }`}
            >
              {i === active && (
                <motion.span
                  key={`${active}-${paused}`}
                  className="absolute inset-y-0 left-0 bg-magenta-500 rounded-full"
                  initial={{ width: paused ? "100%" : "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: paused ? 0 : AUTOPLAY_MS / 1000, ease: "linear" }}
                />
              )}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/* Simple store badge glyphs (inline so we don't rely on brand icons) */
const AppleGlyph = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden="true">
    <path d="M16.37 12.6c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.47.83-.72 0-1.82-.81-2.99-.79-1.54.02-2.96.9-3.75 2.27-1.6 2.78-.41 6.88 1.15 9.13.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.76-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.38-.91-2.4-3.65zM14.1 5.86c.63-.77 1.06-1.83.94-2.89-.91.04-2.02.61-2.67 1.37-.58.67-1.1 1.76-.96 2.8 1.02.08 2.06-.52 2.69-1.28z" />
  </svg>
);

const PlayGlyph = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" aria-hidden="true">
    <path fill="#34A853" d="M3.6 2.2 13.5 12l-9.9 9.8c-.36-.2-.6-.6-.6-1.07V3.27c0-.47.24-.87.6-1.07z" />
    <path fill="#FBBC04" d="m16.8 15.3-3.3-3.3 3.3-3.3 3.72 2.12c.86.49.86 1.87 0 2.36L16.8 15.3z" />
    <path fill="#EA4335" d="M16.8 15.3 13.5 12l-9.9 9.8c.33.18.75.18 1.15-.05l12.05-6.45z" />
    <path fill="#4285F4" d="M16.8 8.7 4.75 2.25c-.4-.23-.82-.23-1.15-.05L13.5 12l3.3-3.3z" />
  </svg>
);

function AppDownloadSection() {
  return (
    <section id="download-app" className="py-20 bg-white overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Text */}
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="order-2 lg:order-1"
          >
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-magenta-50 text-magenta-600 text-xs font-semibold tracking-wider uppercase mb-5">
              <Sparkles className="w-3.5 h-3.5" />
              Now on mobile
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold text-magenta-900 leading-tight mb-5">
              Your skin expert,{" "}
              <span className="text-magenta-500">right in your hands</span>
            </h2>
            <p className="text-gray-600 text-base lg:text-lg leading-relaxed max-w-lg mb-10">
              Download the DERMAI app to scan your skin anytime, track your
              results, and book with trusted dermatology clinics in Cebu — all
              from your phone.
            </p>

            <div className="flex flex-col sm:flex-row gap-4">
              <a
                id="download-app-store"
                href="#"
                className="group inline-flex items-center gap-3 px-6 py-3 rounded-2xl bg-magenta-900 text-white hover:bg-black transition-all shadow-lg hover:-translate-y-0.5 active:scale-[0.97]"
              >
                <AppleGlyph />
                <span className="flex flex-col leading-tight text-left">
                  <span className="text-[10px] uppercase tracking-wider text-white/70">
                    Download on the
                  </span>
                  <span className="text-base font-semibold">App Store</span>
                </span>
              </a>
              <a
                id="download-google-play"
                href="#"
                className="group inline-flex items-center gap-3 px-6 py-3 rounded-2xl bg-white border-2 border-magenta-900 text-magenta-900 hover:bg-magenta-50 transition-all shadow-lg hover:-translate-y-0.5 active:scale-[0.97]"
              >
                <PlayGlyph />
                <span className="flex flex-col leading-tight text-left">
                  <span className="text-[10px] uppercase tracking-wider text-magenta-900/60">
                    Get it on
                  </span>
                  <span className="text-base font-semibold">Google Play</span>
                </span>
              </a>
            </div>
          </motion.div>

          {/* Image */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="order-1 lg:order-2 relative flex justify-center"
          >
            {/* Soft glow behind the phone (shows through via multiply blend) */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[70%] aspect-square rounded-full bg-magenta-100 blur-3xl opacity-70" />
            <img
              src={appDownloadImg}
              alt="Hands holding a phone running the DERMAI skin scan app"
              loading="lazy"
              className="relative shrink-0 w-[130%] max-w-none sm:w-full sm:max-w-2xl lg:w-[125%] lg:max-w-none mix-blend-multiply"
            />
            {/* Floating stat chip */}
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="absolute left-2 sm:left-8 top-1/4 bg-white rounded-2xl shadow-[0_10px_30px_rgba(61,8,36,0.15)] px-4 py-3 flex items-center gap-3"
            >
              <span className="w-9 h-9 rounded-xl bg-magenta-500 text-white flex items-center justify-center">
                <Camera className="w-4 h-4" />
              </span>
              <span className="leading-tight">
                <span className="block text-xs text-gray-500">Scan results in</span>
                <span className="block text-sm font-bold text-magenta-900">seconds</span>
              </span>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero Section */}
      <section
        className="relative overflow-hidden bg-magenta-500 pb-0"
        style={{ minHeight: "560px" }}
      >
        {/* Noise overlay */}
        <div className="absolute inset-0 opacity-[0.03] bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PC9maWx0ZXI+PHJlY3Qgd2lkdGg9IjMwMCIgaGVpZ2h0PSIzMDAiIGZpbHRlcj0idXJsKCNhKSIgb3BhY2l0eT0iMSIvPjwvc3ZnPg==')] h-153.25">
          <img
            src={heroLeftImage}
            alt={"Pasted Image"}
            width={500}
            height={500}
            className={"w-full h-full flex"}
          />
        </div>
        {/* Decorative blobs */}

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div
            className="grid grid-cols-1 lg:grid-cols-2 gap-0 items-end"
            style={{ minHeight: "560px" }}
          >
            {/* Left Content */}
            <motion.div
              className="py-16 lg:py-20 flex flex-col justify-center"
              initial="initial"
              animate="animate"
              variants={stagger}
            >
              <motion.p
                variants={fadeUp}
                className="text-white/80 text-sm font-semibold tracking-wider mb-4"
              >
                AI-Analysis
              </motion.p>
              <motion.h1
                variants={fadeUp}
                className="text-4xl sm:text-5xl lg:text-[3.5rem] font-display font-extrabold text-white leading-[1.1] mb-5"
              >
                Looking for Derma Clinics for your skin in Cebu?
              </motion.h1>
              <motion.p
                variants={fadeUp}
                className="text-white/80 text-base max-w-sm mb-8 leading-relaxed"
              >
                Find trusted dermatology clinics and government-funded facilities
                offering free or low-cost skin care near you, compare your options,
                and connect with the right specialist for your needs.
              </motion.p>

              {/* Search Bar */}
              <motion.div
                variants={fadeUp}
                className="bg-white rounded-full flex items-center px-5 py-3.5 max-w-sm shadow-xl shadow-black/20"
              >
                <Search className="w-5 h-5 text-gray-400 mr-3 shrink-0" />

                <input
                  type="text"
                  placeholder="Search Derma Clinics in Cebu"
                  className="flex-1 bg-transparent outline-none text-gray-700 placeholder:text-gray-400 text-sm"
                />
              </motion.div>
            </motion.div>

            {/* Right - Hero Image */}
            <motion.div
              initial={{ opacity: 0, x: 60 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="hidden lg:flex items-end justify-end h-full translate-y-3"
            >
              <img
                src={heroRightImage}
                alt={"Pasted Image"}
                width={500}
                height={500}
                className={"w-full h-full"}
              />
            </motion.div>
          </div>
        </div>
        {/* Wave SVG */}
        <div className="absolute bottom-0 left-0 right-0"></div>
      </section>
      {/* Features Section */}
      <FeatureCarousel />
      {/* Download App Section */}
      <AppDownloadSection />
      {/* Clinic CTA Section (pink) */}
      <section className="py-28 bg-linear-to-br from-magenta-500 to-magenta-600 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.03] bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PC9maWx0ZXI+PHJlY3Qgd2lkdGg9IjMwMCIgaGVpZ2h0PSIzMDAiIGZpbHRlcj0idXJsKCNhKSIgb3BhY2l0eT0iMSIvPjwvc3ZnPg==')]" />
        {/* Decorative rings */}
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full border-[40px] border-white/5" />
        <div className="absolute -bottom-40 -right-20 w-[28rem] h-[28rem] rounded-full bg-white/5 blur-2xl" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="max-w-3xl mx-auto text-center"
          >
            <div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold text-white leading-tight mb-5">
                Are you a dermatology clinic in Cebu?
              </h2>
              <p className="text-magenta-100 text-base lg:text-lg leading-relaxed max-w-xl mx-auto mb-8">
                Partner with DERMAI to reach more patients, get verified, and
                receive referrals from our AI-powered platform.
              </p>

              <ul className="flex flex-wrap justify-center gap-x-8 gap-y-3 mb-10">
                {[
                  { icon: BadgeCheck, title: "Get verified" },
                  { icon: Users, title: "Reach patients" },
                  { icon: Send, title: "AI referrals" },
                ].map(({ icon: Icon, title }) => (
                  <li key={title} className="flex items-center gap-2 text-sm font-medium text-white">
                    <Icon className="w-4 h-4 text-white/80" strokeWidth={1.75} />
                    {title}
                  </li>
                ))}
              </ul>

              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  id="cta-partner-with-us"
                  to="/partner-with-us"
                  className="group inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-white text-magenta-600 rounded-full font-semibold text-sm hover:bg-magenta-50 transition-all shadow-lg hover:-translate-y-0.5 active:scale-[0.96]"
                >
                  Partner With Us
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <Link
                  id="cta-register-clinic"
                  to="/register-clinic"
                  className="inline-flex items-center justify-center px-8 py-3.5 border-2 border-white text-white rounded-full font-semibold text-sm hover:bg-white/10 transition-colors active:scale-[0.96]"
                >
                  Register Your Clinic
                </Link>
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
