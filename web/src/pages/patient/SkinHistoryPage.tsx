import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Calendar, Activity, ChevronRight, MapPin, Trash2, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabaseClient";


interface SkinHistoryItem {
  id: string;
  condition: string;
  localName?: string;
  confidence: number;
  bodyPart: string;
  date: string;
  severity: "Mild" | "Moderate" | "Severe";
  imageUrl?: string;
  description?: string;
  careTips?: string[];
}

export default function PatientSkinHistory() {
  const [history, setHistory] = useState<SkinHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<SkinHistoryItem | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setIsLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId || cancelled) { setIsLoading(false); return; }

      const { data, error } = await supabase
        .from("ai_scan_result")
        .select(`
          analysis_id,
          confidence_score,
          body_part,
          scanned_at,
          photo_url,
          skin_condition:condition_id (
            name,
            local_name,
            description,
            skin_condition_care_tip ( tip_text )
          )
        `)
        .eq("user_id", userId)
        .order("scanned_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        console.error("[SkinHistory] fetch error:", error.message);
        setIsLoading(false);
        return;
      }

      const mapped: SkinHistoryItem[] = ((data ?? []) as any[]).map((s: any) => {
        const condObj = Array.isArray(s.skin_condition) ? s.skin_condition[0] : s.skin_condition;
        return {
          id: s.analysis_id,
          condition: condObj?.name ?? "Unknown",
          localName: condObj?.local_name ?? undefined,
          confidence: Math.round(s.confidence_score),
          bodyPart: s.body_part ?? "Unknown",
          date: new Date(s.scanned_at).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }),
          severity: s.confidence_score >= 80 ? "Severe" : s.confidence_score >= 50 ? "Moderate" : "Mild",
          imageUrl: s.photo_url ?? undefined,
          description: condObj?.description ?? undefined,
          careTips: condObj?.skin_condition_care_tip?.map((t: any) => t.tip_text),
        };
      });

      setHistory(mapped);
      setIsLoading(false);
    }

    loadHistory();
    return () => { cancelled = true; };
  }, []);

  const deleteItem = async (id: string) => {
    setHistory((prev) => prev.filter((item) => item.id !== id));
    const { error } = await supabase.from("ai_scan_result").delete().eq("analysis_id", id);
    if (error) console.error("[SkinHistory] delete error:", error.message);
  };

  const filteredHistory = history;

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Skin Analysis History</h1>
          <p className="text-gray-500 text-sm mt-1">Review your past skin scan results and progress.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <div className="w-10 h-10 border-4 border-gray-100 border-t-magenta-600 rounded-full animate-spin" />
          <p className="text-gray-500 font-medium animate-pulse">Loading analysis history...</p>
        </div>
      ) : filteredHistory.length > 0 ? (
        <div className="grid grid-cols-1 gap-4">
          <AnimatePresence mode="popLayout">
            {filteredHistory.map((item, index) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: index * 0.05 }}
                className="group bg-white rounded-2xl border border-gray-100 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:shadow-lg hover:shadow-gray-200/40 hover:border-magenta-100 transition-all cursor-pointer relative"
              >
                <div className="flex items-center gap-5">
                  <div className="w-14 h-14 rounded-xl overflow-hidden ring-4 ring-magenta-50/50 group-hover:ring-magenta-100/50 transition-all shrink-0 bg-magenta-50">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.condition} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-magenta-600">
                        <Activity className="w-6 h-6" />
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="font-bold text-gray-900 text-lg">{item.condition}</h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-gray-500">
                      <span className="flex items-center gap-1.5 bg-gray-50/80 px-2 py-0.5 rounded-lg border border-gray-100">
                        <MapPin className="w-3.5 h-3.5" /> {item.bodyPart}
                      </span>
                      <span className="flex items-center gap-1.5 bg-gray-50/80 px-2 py-0.5 rounded-lg border border-gray-100">
                        <Calendar className="w-3.5 h-3.5" /> {item.date}
                      </span>
                      <span className="flex items-center gap-1.5 font-semibold text-magenta-600">
                        <Activity className="w-3.5 h-3.5" /> {item.confidence}% confidence
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 pl-4 sm:border-l border-gray-100">
                  <button 
                    onClick={(e) => { e.stopPropagation(); deleteItem(item.id); }}
                    className="p-2.5 rounded-xl hover:bg-rose-50 text-gray-300 hover:text-rose-500 transition-all"
                    title="Delete record"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button className="flex items-center gap-2 bg-gray-50 text-gray-600 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-magenta-50 hover:text-magenta-600 transition-all"
                    onClick={() => setSelectedItem(item)}
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
          <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center text-gray-300 mb-6 group-hover:scale-110 transition-transform">
            <Activity className="w-10 h-10" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">No History Found</h2>
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

      {/* View Full Results Modal */}
      <AnimatePresence>
        {selectedItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={() => setSelectedItem(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Possible {selectedItem.condition}</h2>
                  {selectedItem.localName && (
                    <p className="text-sm text-gray-400 mt-0.5">
                      {selectedItem.localName} (Filipino name)
                    </p>
                  )}
                </div>
                <button onClick={() => setSelectedItem(null)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Uploaded Photo or Condition Reference */}
              {selectedItem.imageUrl && (
                <div className="mb-4 rounded-xl overflow-hidden border border-gray-100">
                  <img
                    src={selectedItem.imageUrl}
                    alt={`${selectedItem.condition} scan photo`}
                    className="w-full max-h-56 object-cover"
                  />
                </div>
              )}

              {/* Meta */}
              <div className="flex flex-wrap gap-2 mb-4 text-sm">
                <span className="flex items-center gap-1.5 bg-gray-50 px-2.5 py-1 rounded-lg border border-gray-100 text-gray-500">
                  <MapPin className="w-3.5 h-3.5" /> {selectedItem.bodyPart}
                </span>
                <span className="flex items-center gap-1.5 bg-gray-50 px-2.5 py-1 rounded-lg border border-gray-100 text-gray-500">
                  <Calendar className="w-3.5 h-3.5" /> {selectedItem.date}
                </span>
              </div>

              {/* Confidence */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-gray-700">Confidence Score</span>
                  <span className="text-sm font-bold text-magenta-600">{selectedItem.confidence}%</span>
                </div>
                <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-linear-to-r from-magenta-400 to-magenta-600 rounded-full"
                    style={{ width: `${selectedItem.confidence}%` }}
                  />
                </div>
              </div>

              {/* Description */}
              <div className="mb-5">
                <h3 className="text-sm font-bold text-gray-900 mb-2">What is {selectedItem.condition}?</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  {selectedItem.description || "No description available."}
                </p>
              </div>

              {/* Care Tips */}
              {selectedItem.careTips && selectedItem.careTips.length > 0 && (
                <div className="mb-5">
                  <h3 className="text-sm font-bold text-gray-900 mb-2">Basic Care Tips</h3>
                  <ul className="space-y-2">
                    {selectedItem.careTips.map((tip, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                        <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Disclaimer */}
              <div className="bg-rose-50 rounded-xl p-3 flex gap-2 mb-4 border border-rose-100">
                <AlertTriangle className="w-4 h-4 text-magenta-500 shrink-0 mt-0.5" />
                <p className="text-xs text-magenta-700 leading-relaxed">
                  This is <strong>NOT</strong> a medical diagnosis. Please consult a licensed dermatologist for proper evaluation and treatment.
                </p>
              </div>

              <Link
                to="/dashboard/clinics"
                onClick={() => setSelectedItem(null)}
                className="block w-full text-center py-3 bg-magenta-500 text-white rounded-xl font-bold text-sm hover:bg-magenta-600 transition-colors"
              >
                Find a Dermatologist Near You
              </Link>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}