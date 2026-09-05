import { CreditCard, Crown, Calendar, CheckCircle2, XCircle, X } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";

interface SubData {
  isPro: boolean;
  billingCycle?: "monthly" | "yearly";
  scansUsed?: number;
}

interface CardData {
  last4: string;
  expiry: string;
}

interface BillingHistoryItem {
  date: string;
  amount: string;
  status: string;
}

function formatCardNumber(value: string) {
  // Keep only digits, max 16
  const digits = value.replace(/\D/g, "").slice(0, 16);
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

function formatExpiry(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length >= 3) return digits.slice(0, 2) + "/" + digits.slice(2);
  return digits;
}

export default function BillingSettingsPage() {
  const [sub, setSub] = useState<SubData>({ isPro: false, scansUsed: 0 });
  const [card, setCard] = useState<CardData | null>(null);
  const [billingHistory] = useState<BillingHistoryItem[]>([]);
  const [showCardModal, setShowCardModal] = useState(false);
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardSaved, setCardSaved] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // TODO: Load subscription and payment card from Supabase using authenticated user session

  // Close modal on outside click
  useEffect(() => {
    if (!showCardModal) return;
    const handler = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setShowCardModal(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showCardModal]);

  const openCardModal = () => {
    setCardNumber("");
    setCardExpiry(card?.expiry ?? "");
    setCardCvv("");
    setCardName("");
    setCardSaved(false);
    setShowCardModal(true);
  };

  const handleCardSave = (e: React.FormEvent) => {
    e.preventDefault();
    const digits = cardNumber.replace(/\D/g, "");
    if (digits.length < 16) return;
    const last4 = digits.slice(-4);
    const newCard: CardData = { last4, expiry: cardExpiry };
    setCard(newCard);
    // TODO: Save payment card via Supabase
    setCardSaved(true);
    setTimeout(() => setShowCardModal(false), 1000);
  };

  const handleCancel = () => {
    const updated = { ...sub, isPro: false, billingCycle: undefined };
    setSub(updated);
    // TODO: Cancel subscription via Supabase
  };

  const price = sub.billingCycle === "yearly" ? "₱1,999 / year" : "₱199 / month";
  const nextBilling = sub.billingCycle === "yearly" ? "April 4, 2027" : "May 4, 2026";

  return (
    <>
    <div className="max-w-2xl mx-auto py-10 px-4 sm:px-6">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2.5 bg-magenta-100 rounded-2xl text-magenta-600">
          <CreditCard className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your subscription and payment details</p>
        </div>
      </div>

      {/* Current Plan */}
      <div className={`rounded-2xl p-6 mb-6 border ${sub.isPro ? "bg-magenta-50 border-magenta-200" : "bg-white border-gray-100"} shadow-sm`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${sub.isPro ? "bg-magenta-100 text-magenta-600" : "bg-gray-100 text-gray-400"}`}>
              <Crown className="w-5 h-5" />
            </div>
            <div>
              <p className="text-base font-bold text-gray-900">{sub.isPro ? "Pro Plan" : "Free Plan"}</p>
              <p className="text-xs text-gray-500 mt-0.5">{sub.isPro ? price : "3 scan per account"}</p>
            </div>
          </div>
          <span className={`text-xs px-3 py-1 rounded-full font-bold ${sub.isPro ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
            {sub.isPro ? "Active" : "Free"}
          </span>
        </div>

        {sub.isPro ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <Calendar className="w-4 h-4 text-magenta-400" />
              <span>Next billing date: <strong>{nextBilling}</strong></span>
            </div>
            <div className="space-y-1.5">
              {["Unlimited AI skin scans", "Priority clinic recommendations", "Full skin analysis history", "Cancel anytime"].map((feat) => (
                <div key={feat} className="flex items-center gap-2 text-sm text-gray-700">
                  <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                  {feat}
                </div>
              ))}
            </div>
            <button
              onClick={handleCancel}
              className="mt-4 flex items-center gap-2 text-sm text-red-500 font-semibold hover:text-red-600 transition-colors"
            >
              <XCircle className="w-4 h-4" /> Cancel Subscription
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              {["3 free AI skin scan", "Basic clinic search", "Limited scan history"].map((feat) => (
                <div key={feat} className="flex items-center gap-2 text-sm text-gray-500">
                  <CheckCircle2 className="w-4 h-4 text-gray-300 shrink-0" />
                  {feat}
                </div>
              ))}
            </div>
            <Link
              to="/dashboard/upgrade"
              className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-magenta-500 text-white rounded-xl text-sm font-bold hover:bg-magenta-600 transition-colors shadow-sm"
            >
              <Crown className="w-4 h-4" /> Upgrade to Pro
            </Link>
          </div>
        )}
      </div>

      {/* Payment Method */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm mb-6">
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">Payment Method</h2>
        {card ? (
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
              <CreditCard className="w-6 h-6 text-gray-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">•••• •••• •••• {card.last4}</p>
              <p className="text-xs text-gray-400 mt-0.5">Expires {card.expiry}</p>
            </div>
            <button
              onClick={openCardModal}
              className="ml-auto text-xs text-magenta-500 font-semibold hover:text-magenta-700 transition-colors"
            >
              Update
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">No payment method on file.</p>
            <button
              onClick={openCardModal}
              className="text-xs text-magenta-500 font-semibold hover:text-magenta-700 transition-colors"
            >
              Add Card
            </button>
          </div>
        )}
      </div>

      {/* Billing History */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">Billing History</h2>
        {billingHistory.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {billingHistory.map((row, i) => (
              <div key={i} className="flex items-center justify-between py-3 text-sm">
                <span className="text-gray-600">{row.date}</span>
                <span className="font-semibold text-gray-900">{row.amount}</span>
                <span className="px-2.5 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold">{row.status}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No billing history available.</p>
        )}
      </div>
    </div>

    {/* ── Update Card Modal ──────────────────────────────── */}
    {showCardModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
        <div
          ref={modalRef}
          className="w-full max-w-md bg-white rounded-[28px] shadow-2xl p-7 space-y-5"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">Update Payment Method</h2>
            <button
              onClick={() => setShowCardModal(false)}
              className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
            >
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>

          <form onSubmit={handleCardSave} className="space-y-4">
            {/* Card Number */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Card Number</label>
              <div className="relative">
                <CreditCard className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  value={cardNumber}
                  onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                  placeholder="1234 5678 9012 3456"
                  maxLength={19}
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none focus:border-magenta-400 focus:ring-2 focus:ring-magenta-500/10"
                />
              </div>
            </div>

            {/* Cardholder name */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Cardholder Name</label>
              <input
                type="text"
                required
                value={cardName}
                onChange={(e) => setCardName(e.target.value)}
                placeholder="Juan Dela Cruz"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none focus:border-magenta-400 focus:ring-2 focus:ring-magenta-500/10"
              />
            </div>

            {/* Expiry + CVV */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Expiry Date</label>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  value={cardExpiry}
                  onChange={(e) => setCardExpiry(formatExpiry(e.target.value))}
                  placeholder="MM/YY"
                  maxLength={5}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none focus:border-magenta-400 focus:ring-2 focus:ring-magenta-500/10"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">CVV</label>
                <input
                  type="password"
                  inputMode="numeric"
                  required
                  value={cardCvv}
                  onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="•••"
                  maxLength={4}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder:text-gray-300 focus:outline-none focus:border-magenta-400 focus:ring-2 focus:ring-magenta-500/10"
                />
              </div>
            </div>

            <button
              type="submit"
              className={`w-full py-3.5 rounded-2xl text-sm font-bold transition-all ${
                cardSaved
                  ? "bg-green-500 text-white"
                  : "bg-magenta-500 text-white hover:bg-magenta-600 active:scale-[0.98]"
              }`}
            >
              {cardSaved ? "✓ Card Updated!" : "Save Card"}
            </button>
          </form>

          <p className="text-center text-[11px] text-gray-400">
            Payment information is encrypted and securely processed.
          </p>
        </div>
      </div>
    )}
    </>
  );
}
