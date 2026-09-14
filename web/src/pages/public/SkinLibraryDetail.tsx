import { useParams, Link, Navigate } from "react-router-dom";
import { ArrowLeft, Users, Stethoscope, CheckCircle2, AlertTriangle, Camera, MapPin } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";
import { skinConditions } from "./SkinLibrary";

const categoryStyles: Record<string, string> = {
  Acne: "bg-rose-50 text-rose-700 border border-rose-200/80",
  Inflammatory: "bg-orange-50 text-orange-700 border border-orange-200/80",
  Pigmentation: "bg-amber-50 text-amber-700 border border-amber-200/80",
};

export default function SkinLibraryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const condition = skinConditions.find((c) => c.id === id);

  if (!condition) {
    return <Navigate to="/skin-library" replace />;
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 pt-8 pb-16">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Back Link */}
        <Link
          to="/skin-library"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-all mb-6 cursor-pointer active:scale-[0.96] shadow-xs"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Library
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden"
        >
          {/* Header Title Section */}
          <div className="p-6 sm:p-8 border-b border-slate-100">
            <span
              className={cn(
                "inline-block px-3 py-1 rounded-full text-xs font-bold mb-3 shadow-xs",
                categoryStyles[condition.category] || "bg-slate-100 text-slate-700 border border-slate-200"
              )}
            >
              {condition.category} Condition
            </span>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-display font-bold text-slate-900 mb-1">
              {condition.name}
            </h1>
            <p className="text-sm font-semibold text-magenta-600">
              Philippine Tagalog Name: {condition.filipinoName}
            </p>
          </div>

          {/* Clinical Reference Photo */}
          <div className="p-6 sm:p-8 border-b border-slate-100">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display font-bold text-slate-900 text-base">Example Clinical Presentation</h2>
              <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                Medical Reference
              </span>
            </div>
            <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-100">
              <img
                src={condition.image}
                alt={condition.name}
                className="w-full h-64 sm:h-80 object-cover"
              />
            </div>
          </div>

          {/* What is it */}
          <div className="p-6 sm:p-8 border-b border-slate-100">
            <h2 className="font-display font-bold text-slate-900 text-base mb-2">What is it?</h2>
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">{condition.description}</p>
          </div>

          {/* Common Symptoms */}
          <div className="p-6 sm:p-8 border-b border-slate-100">
            <h2 className="font-display font-bold text-slate-900 text-base mb-3">Common Symptoms</h2>
            <ul className="space-y-2.5">
              {condition.symptoms.map((symptom, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700">
                  <span className="w-2 h-2 rounded-full bg-magenta-500 mt-2 shrink-0" />
                  <span>{symptom}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Who does it affect */}
          <div className="p-6 sm:p-8 border-b border-slate-100">
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-5 sm:p-6">
              <h2 className="flex items-center gap-2 font-display font-bold text-slate-900 text-base mb-2">
                <Users className="w-5 h-5 text-magenta-500" />
                Who does it affect?
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">{condition.whoAffected}</p>
            </div>
          </div>

          {/* Basic Care Tips */}
          <div className="p-6 sm:p-8 border-b border-slate-100">
            <h2 className="font-display font-bold text-slate-900 text-base mb-3">Basic Care & Management Tips</h2>
            <ul className="space-y-2.5">
              {condition.careTips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* When to See a Doctor */}
          <div className="p-6 sm:p-8 border-b border-slate-100">
            <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-5 sm:p-6">
              <h2 className="flex items-center gap-2 font-display font-bold text-amber-900 text-base mb-2">
                <Stethoscope className="w-5 h-5 text-amber-600" />
                When to See a Doctor
              </h2>
              <p className="text-sm text-amber-900/80 leading-relaxed">{condition.whenToSeeDoctor}</p>
            </div>
          </div>

          {/* Medical Disclaimer & Actions */}
          <div className="p-6 sm:p-8">
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-5 flex gap-3 mb-8">
              <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <h3 className="font-display font-bold text-slate-900 text-xs uppercase tracking-wider mb-1">
                  Medical Disclaimer
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  This library information is curated for educational pre-screening awareness only and is NOT a definitive medical diagnosis. Always consult a certified dermatologist for professional assessment and prescription treatments.
                </p>
              </div>
            </div>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                to="/scan"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-magenta-500 hover:bg-magenta-600 text-white text-sm font-semibold px-8 py-3.5 rounded-full transition-all shadow-lg shadow-magenta-500/20 active:scale-[0.96] cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                Scan Your Skin Now
              </Link>
              <Link
                to="/find-clinics"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 border-2 border-slate-200 text-slate-700 text-sm font-semibold px-6 py-3.5 rounded-full hover:bg-slate-50 transition-all active:scale-[0.96] cursor-pointer"
              >
                <MapPin className="w-4 h-4 text-magenta-500" />
                Find Cebu Clinics
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
