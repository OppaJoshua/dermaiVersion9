import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, FileText, AlertTriangle, X, Check } from "lucide-react";


export interface SubscriptionAgreementModalProps {
  open: boolean;
  accepted: boolean;
  onAcceptedChange: (accepted: boolean) => void;
  onCancel: () => void;
  onAgree: () => void;
}

export default function SubscriptionAgreementModal({
  open,
  accepted,
  onAcceptedChange,
  onCancel,
  onAgree,
}: SubscriptionAgreementModalProps) {
  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[99999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="bg-white rounded-2xl shadow-2xl border border-gray-100 max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="p-5 sm:p-6 border-b border-gray-100 flex items-start justify-between bg-linear-to-r from-magenta-50/60 to-white">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-magenta-100 text-magenta-600 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-gray-900">
                  Subscription Agreement
                </h2>
                <p className="text-xs text-gray-500">
                  Please review terms and medical disclaimer before payment
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Scrollable Terms Content */}
          <div className="p-5 sm:p-6 overflow-y-auto text-xs text-gray-600 space-y-4 leading-relaxed">
            <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl flex items-start gap-2.5 text-amber-900">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block mb-0.5">Medical Disclaimer</span>
                DermAI provides AI-powered dermatological analysis and triage support for educational and informational purposes only. It does not provide medical diagnoses or replace an in-person clinical consultation with a licensed physician.
              </div>
            </div>

            <div className="space-y-3">
              <div className="border border-gray-100 rounded-xl p-3.5 bg-gray-50/50">
                <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-magenta-500" />
                  1. Plan Scope & Services
                </h3>
                <p>
                  Your DermAI Pro subscription unlocks enhanced skin scan analyses, full historical condition tracking, and priority appointment booking at participating partner dermatological clinics.
                </p>
              </div>

              <div className="border border-gray-100 rounded-xl p-3.5 bg-gray-50/50">
                <h3 className="font-semibold text-gray-900 mb-1">
                  2. Pricing & 12% Value Added Tax (VAT)
                </h3>
                <p>
                  In compliance with Philippine Bureau of Internal Revenue (BIR) regulations, all billed charges include a 12% Value Added Tax (VAT). Your billing breakdown will explicitly reflect the net subscription fee and applicable VAT.
                </p>
              </div>

              <div className="border border-gray-100 rounded-xl p-3.5 bg-gray-50/50">
                <h3 className="font-semibold text-gray-900 mb-1">
                  3. Billing Cycles & Renewal
                </h3>
                <p>
                  Subscriptions are billed in advance according to your chosen cycle (Monthly or Yearly). You may cancel renewal at any time through your Billing Settings; your active Pro access will remain in effect until the end of the paid billing period.
                </p>
              </div>

              <div className="border border-gray-100 rounded-xl p-3.5 bg-gray-50/50">
                <h3 className="font-semibold text-gray-900 mb-1">
                  4. Data Privacy & Confidentiality
                </h3>
                <p>
                  Your skin scans, consultation notes, and health records are encrypted and protected pursuant to the Philippine Data Privacy Act of 2012 (RA 10173). Your records are never sold or shared without your explicit authorization.
                </p>
              </div>
            </div>
          </div>

          {/* Footer with Checkbox and Actions */}
          <div className="p-5 sm:p-6 border-t border-gray-100 bg-gray-50/60 space-y-4">
            <label
              htmlFor="agree-subscription-checkbox"
              className="flex items-start gap-3 cursor-pointer select-none group"
            >
              <div className="relative flex items-center mt-0.5">
                <input
                  id="agree-subscription-checkbox"
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => onAcceptedChange(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                    accepted
                      ? "bg-magenta-600 border-magenta-600 text-white"
                      : "border-gray-300 bg-white group-hover:border-magenta-400"
                  }`}
                >
                  {accepted && <Check className="w-3 h-3 stroke-[3]" />}
                </div>
              </div>
              <span className="text-xs text-gray-700 leading-snug">
                I have read, understood, and accept the{" "}
                <span className="font-semibold text-gray-900">
                  DermAI Subscription Agreement
                </span>{" "}
                and acknowledge the medical disclaimer.
              </span>
            </label>

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!accepted}
                onClick={onAgree}
                className={`px-5 py-2.5 text-xs font-semibold rounded-xl shadow-sm transition-all ${
                  accepted
                    ? "bg-magenta-600 hover:bg-magenta-700 text-white shadow-magenta-200"
                    : "bg-gray-200 text-gray-400 cursor-not-allowed"
                }`}
              >
                Agree & Proceed to Payment
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
