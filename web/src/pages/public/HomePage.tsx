import { Link } from "react-router-dom";
import {
  Camera,
  Brain,
  MapPin,
  Search,
  ArrowRight,
  Upload,
  Stethoscope,
  CheckCircle2,
} from "lucide-react";
import { motion } from "framer-motion";
import heroLeftImage from "../../assets/homepage-partDesign.png";
import heroRightImage from "../../assets/Girl-homepage.png";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
};

const stagger = {
  animate: { transition: { staggerChildren: 0.08 } },
};

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
              className="hidden lg:flex items-end justify-end h-full"
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
      <section className="py-20 bg-magenta-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            variants={stagger}
            className="grid grid-cols-1 md:grid-cols-3 gap-6"
          >
            {[
              {
                icon: Camera,
                title: "Scan Your Skin",
                desc: "Take a photo of your skin concern and get instant analysis powered by AI technology.",
                link: "/scan",
                color: "bg-magenta-500",
              },
              {
                icon: Brain,
                title: "Get AI Analysis",
                desc: "Get an initial AI screening with a confidence guide and practical care tips. For proper diagnosis, we strongly encourage visiting a dermatology clinic in Cebu.",
                link: "/scan",
                color: "bg-magenta-400",
              },
              {
                icon: MapPin,
                title: "Find a Clinic",
                desc: "Discover verified dermatology clinics near you in Cebu City with directions and contact info.",
                link: "/clinics",
                color: "bg-magenta-300",
              },
            ].map((feature, i) => (
              <motion.div
                key={i}
                variants={fadeUp}
                transition={{ delay: i * 0.08 }}
              >
                <Link
                  to={feature.link}
                  className="group block bg-white rounded-[20px] p-8 shadow-[0_4px_24px_rgba(160,25,90,0.08)] hover:shadow-[0_8px_40px_rgba(160,25,90,0.15)] transition-all duration-300 hover:-translate-y-1"
                >
                  <div
                    className={`w-14 h-14 ${feature.color} rounded-2xl flex items-center justify-center mb-5 group-hover:scale-105 transition-transform`}
                  >
                    <feature.icon className="w-7 h-7 text-white" />
                  </div>
                  <h3 className="text-xl font-display font-bold text-magenta-900 mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-magenta-700/70 leading-relaxed">
                    {feature.desc}
                  </p>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>
      {/* How It Works */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            variants={stagger}
            className="text-center mb-16"
          >
            <motion.p
              variants={fadeUp}
              className="text-magenta-500 font-semibold text-sm tracking-wider uppercase mb-3"
            >
              Simple Process
            </motion.p>
            <motion.h2
              variants={fadeUp}
              className="text-3xl sm:text-4xl font-display font-bold text-magenta-900"
            >
              How It Works
            </motion.h2>
          </motion.div>

          <motion.div
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            variants={stagger}
            className="grid grid-cols-1 md:grid-cols-3 gap-8 relative"
          >
            {/* Connection line */}
            <div className="hidden md:block absolute top-16 left-[20%] right-[20%] h-0.5 bg-linear-to-r from-magenta-200 via-magenta-300 to-magenta-200" />

            {[
              {
                step: "01",
                icon: Upload,
                title: "Upload a Photo",
                desc: "Take a clear photo of your skin concern and answer a few quick questions about your symptoms.",
              },
              {
                step: "02",
                icon: Stethoscope,
                title: "Get AI Analysis",
                desc: "Our AI gives a preliminary assessment with a confidence estimate. It is not a final diagnosis, so we encourage you to consult a dermatology clinic in Cebu.",
              },
              {
                step: "03",
                icon: CheckCircle2,
                title: "Visit a Clinic",
                desc: "Get matched with verified dermatology clinics in Cebu for professional consultation and treatment.",
              },
            ].map((step, i) => (
              <motion.div
                key={i}
                variants={fadeUp}
                transition={{ delay: i * 0.08 }}
                className="text-center relative"
              >
                <div className="relative inline-flex items-center justify-center w-20 h-20 rounded-full bg-magenta-50 border-4 border-white shadow-lg mb-6">
                  <step.icon className="w-8 h-8 text-magenta-500" />
                  <span className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-magenta-500 text-white text-xs font-bold flex items-center justify-center font-mono-accent">
                    {step.step}
                  </span>
                </div>
                <h3 className="text-lg font-display font-bold text-magenta-900 mb-2">
                  {step.title}
                </h3>
                <p className="text-sm text-magenta-700/60 leading-relaxed max-w-xs mx-auto">
                  {step.desc}
                </p>
              </motion.div>
            ))}
          </motion.div>

          <div className="text-center mt-14">
            <Link
              to="/scan"
              className="inline-flex items-center gap-2 px-8 py-3.5 bg-magenta-500 text-white rounded-full font-semibold text-sm hover:bg-magenta-600 transition-colors shadow-lg shadow-magenta-500/20 active:scale-[0.96]"
            >
              Start Scanning Now
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
      {/* CTA Section */}
      <section className="py-20 bg-linear-to-br from-magenta-500 to-magenta-600 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.03] bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PC9maWx0ZXI+PHJlY3Qgd2lkdGg9IjMwMCIgaGVpZ2h0PSIzMDAiIGZpbHRlcj0idXJsKCNhKSIgb3BhY2l0eT0iMSIvPjwvc3ZnPg==')]" />
        <div className="max-w-4xl mx-auto px-4 text-center relative">
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-white mb-4">
            Are you a dermatology clinic in Cebu?
          </h2>
          <p className="text-magenta-100 text-lg mb-8 max-w-2xl mx-auto">
            Partner with DERMAI to reach more patients, get verified, and
            receive referrals from our AI-powered platform.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/partner-with-us"
              className="px-8 py-3.5 bg-white text-magenta-500 rounded-full font-semibold text-sm hover:bg-magenta-50 transition-colors shadow-lg active:scale-[0.96]"
            >
              Partner With Us
            </Link>
            <Link
              to="/register-clinic"
              className="px-8 py-3.5 border-2 border-white text-white rounded-full font-semibold text-sm hover:bg-white/10 transition-colors active:scale-[0.96]"
            >
              Register Your Clinic
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
