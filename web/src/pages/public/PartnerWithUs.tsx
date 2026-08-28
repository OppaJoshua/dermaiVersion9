import { Link } from "react-router-dom";
import {
  Users,
  CheckCircle2,
  BarChart3,
  FileText,
  Shield,
  ArrowRight,
} from "lucide-react";
import { motion } from "framer-motion";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
};

const stagger = {
  animate: { transition: { staggerChildren: 0.08 } },
};

export default function PartnerWithUs() {
  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative bg-linear-to-br from-magenta-500 via-magenta-500 to-magenta-600 pt-32 pb-24">
        <div className="absolute inset-0 opacity-[0.03] bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PC9maWx0ZXI+PHJlY3Qgd2lkdGg9IjMwMCIgaGVpZ2h0PSIzMDAiIGZpbHRlcj0idXJsKCNhKSIgb3BhY2l0eT0iMSIvPjwvc3ZnPg==')]" />
        <div className="max-w-4xl mx-auto px-4 text-center relative">
          <motion.div initial="initial" animate="animate" variants={stagger}>
            <motion.p
              variants={fadeUp}
              className="text-magenta-100 font-semibold text-sm tracking-wider uppercase mb-4"
            >
              For Healthcare Providers
            </motion.p>
            <motion.h1
              variants={fadeUp}
              className="text-4xl sm:text-5xl font-display font-bold text-white mb-6"
            >
              Partner With DERMAI
            </motion.h1>
            <motion.p
              variants={fadeUp}
              className="text-magenta-100 text-lg max-w-2xl mx-auto mb-10 leading-relaxed"
            >
              Get your clinic verified and reach more patients in Cebu City. Join our growing network of
              trusted dermatology providers.
            </motion.p>
            <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/register-clinic"
                className="px-8 py-3.5 bg-white text-magenta-500 rounded-full font-semibold text-sm hover:bg-magenta-50 transition-colors shadow-lg active:scale-[0.96]"
              >
                Register Your Clinic
              </Link>
              <Link
                to="/login"
                className="px-8 py-3.5 border-2 border-white text-white rounded-full font-semibold text-sm hover:bg-white/10 transition-colors active:scale-[0.96]"
              >
                Clinic Login
              </Link>
            </motion.div>
          </motion.div>
        </div>
        {/* Wave */}
        <div className="absolute -bottom-2 left-0 right-0">
          <svg viewBox="0 0 1440 80" className="w-full block" preserveAspectRatio="none">
            <path
              fill="#fdf2f7"
              d="M0,40 C360,80 720,10 1080,40 C1260,55 1380,50 1440,40 L1440,80 L0,80 Z"
            />
          </svg>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 bg-magenta-50">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center mb-14">
            <p className="text-magenta-500 font-semibold text-sm tracking-wider uppercase mb-2">
              Simple Process
            </p>
            <h2 className="text-3xl font-display font-bold text-magenta-900">
              How It Works
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            <div className="hidden md:block absolute top-12 left-[20%] right-[20%] h-0.5 bg-linear-to-r from-magenta-200 via-magenta-300 to-magenta-200" />

            {[
              {
                step: "01",
                icon: FileText,
                title: "Submit Your Details",
                desc: "Fill out the clinic registration form with your credentials, documents, and clinic information.",
              },
              {
                step: "02",
                icon: Shield,
                title: "Admin Verifies",
                desc: "Our admin team reviews your application and verifies your credentials within 3-5 business days.",
              },
              {
                step: "03",
                icon: CheckCircle2,
                title: "Get Listed & Receive Referrals",
                desc: "Once verified, your clinic appears with a verified badge and starts receiving AI-driven patient referrals.",
              },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="text-center relative"
              >
                <div className="relative inline-flex items-center justify-center w-16 h-16 rounded-full bg-white shadow-lg mb-5">
                  <item.icon className="w-7 h-7 text-magenta-500" />
                  <span className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-magenta-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {item.step}
                  </span>
                </div>
                <h3 className="font-display font-bold text-magenta-900 mb-2">
                  {item.title}
                </h3>
                <p className="text-sm text-magenta-700/60 leading-relaxed max-w-xs mx-auto">
                  {item.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-20 bg-white">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center mb-14">
            <p className="text-magenta-500 font-semibold text-sm tracking-wider uppercase mb-2">
              Why Join
            </p>
            <h2 className="text-3xl font-display font-bold text-magenta-900">
              Benefits of Partnering
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: Users,
                title: "Reach More Patients",
                desc: "Get discovered by thousands of Cebuanos looking for skin care professionals through our AI-powered platform.",
              },
              {
                icon: CheckCircle2,
                title: "Verified Clinic Badge",
                desc: "Stand out with a verified badge that builds trust and credibility with potential patients.",
              },
              {
                icon: BarChart3,
                title: "Track Referral Statistics",
                desc: "Monitor how many patients find and contact your clinic through DERMAI's referral system.",
              },
            ].map((benefit, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="bg-magenta-50 rounded-[20px] p-8 text-center hover:shadow-[0_8px_40px_rgba(160,25,90,0.1)] transition-shadow"
              >
                <div className="w-14 h-14 rounded-2xl bg-magenta-500 flex items-center justify-center mx-auto mb-5">
                  <benefit.icon className="w-7 h-7 text-white" />
                </div>
                <h3 className="font-display font-bold text-magenta-900 mb-2">
                  {benefit.title}
                </h3>
                <p className="text-sm text-magenta-700/60 leading-relaxed">
                  {benefit.desc}
                </p>
              </motion.div>
            ))}
          </div>

          <div className="text-center mt-12">
            <Link
              to="/register-clinic"
              className="inline-flex items-center gap-2 px-8 py-3.5 bg-magenta-500 text-white rounded-full font-semibold text-sm hover:bg-magenta-600 transition-colors shadow-lg shadow-magenta-500/20 active:scale-[0.96]"
            >
              Register Your Clinic Now
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}



