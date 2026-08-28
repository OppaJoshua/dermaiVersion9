import { useParams, Link, Navigate } from "react-router-dom";
import { ArrowLeft, Users, Stethoscope, CheckCircle2, AlertTriangle, Camera } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";
import { skinConditions } from "./SkinLibrary";

const categoryColors: Record<string, string> = {
  Acne: "bg-rose-100 text-rose-700",
  Inflammatory: "bg-orange-100 text-orange-700",
  Pigmentation: "bg-amber-100 text-amber-700",
};

export default function SkinLibraryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const condition = skinConditions.find((c) => c.id === id);

  if (!condition) {
    return <Navigate to="/skin-library" replace />;
  }

  return (
    <div className="min-h-screen bg-magenta-50 pt-8 pb-16">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <Link
          to="/skin-library"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-magenta-500 hover:text-magenta-600 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Library
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-[20px] shadow-[0_4px_24px_rgba(160,25,90,0.08)] overflow-hidden"
        >
          {/* Title */}
          <div className="p-6 sm:p-8 border-b border-magenta-50">
            <span
              className={cn(
                "inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold mb-3",
                categoryColors[condition.category] || "bg-gray-100 text-gray-600"
              )}
            >
              {condition.category}
            </span>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-magenta-900 mb-1">
              {condition.name}
            </h1>
            <p className="text-sm text-magenta-500">{condition.filipinoName}</p>
          </div>

          {/* Example Photo */}
          <div className="p-6 sm:p-8 border-b border-magenta-50">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display font-bold text-magenta-900 text-sm">Example Skin Photo</h2>
              <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-magenta-50 text-magenta-500">
                Reference only
              </span>
            </div>
            <div className="rounded-2xl overflow-hidden">
              <img
                src={condition.image}
                alt={condition.name}
                className="w-full h-64 sm:h-80 object-cover"
              />
            </div>
          </div>

          {/* What is it */}
          <div className="p-6 sm:p-8 border-b border-magenta-50">
            <h2 className="font-display font-bold text-magenta-900 text-sm mb-2">What is it?</h2>
            <p className="text-sm text-magenta-700/70 leading-relaxed">{condition.description}</p>
          </div>

          {/* Common Symptoms */}
          <div className="p-6 sm:p-8 border-b border-magenta-50">
            <h2 className="font-display font-bold text-magenta-900 text-sm mb-3">Common Symptoms</h2>
            <ul className="space-y-2">
              {condition.symptoms.map((symptom, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-magenta-700/70">
                  <span className="w-1.5 h-1.5 rounded-full bg-magenta-500 mt-2 shrink-0" />
                  {symptom}
                </li>
              ))}
            </ul>
          </div>

          {/* Who does it affect */}
          <div className="p-6 sm:p-8 border-b border-magenta-50">
            <div className="bg-magenta-50 rounded-2xl p-4 sm:p-5">
              <h2 className="flex items-center gap-2 font-display font-bold text-magenta-900 text-sm mb-2">
                <Users className="w-4 h-4 text-magenta-500" />
                Who does it affect?
              </h2>
              <p className="text-sm text-magenta-700/70 leading-relaxed">{condition.whoAffected}</p>
            </div>
          </div>

          {/* Basic Care Tips */}
          <div className="p-6 sm:p-8 border-b border-magenta-50">
            <h2 className="font-display font-bold text-magenta-900 text-sm mb-3">Basic Care Tips</h2>
            <ul className="space-y-2">
              {condition.careTips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-magenta-700/70">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                  {tip}
                </li>
              ))}
            </ul>
          </div>

          {/* When to See a Doctor */}
          <div className="p-6 sm:p-8 border-b border-magenta-50">
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 sm:p-5">
              <h2 className="flex items-center gap-2 font-display font-bold text-amber-800 text-sm mb-2">
                <Stethoscope className="w-4 h-4 text-amber-600" />
                When to See a Doctor
              </h2>
              <p className="text-sm text-amber-800/80 leading-relaxed">{condition.whenToSeeDoctor}</p>
            </div>
          </div>

          {/* Medical Disclaimer */}
          <div className="p-6 sm:p-8">
            <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 sm:p-5 flex gap-3 mb-6">
              <AlertTriangle className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
              <div>
                <h2 className="font-display font-bold text-magenta-900 text-sm mb-1">Medical Disclaimer</h2>
                <p className="text-sm text-magenta-700/70 leading-relaxed">
                  This information is for educational purposes only and is NOT a medical diagnosis. Always
                  consult a licensed dermatologist for proper evaluation and treatment.
                </p>
              </div>
            </div>

            <div className="flex justify-center">
              <Link
                to="/scan"
                className="inline-flex items-center gap-2 bg-magenta-500 hover:bg-magenta-600 text-white text-sm font-semibold px-6 py-3 rounded-full transition-colors"
              >
                <Camera className="w-4 h-4" />
                Scan Your Skin Now
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
