import { useState, useEffect } from "react";
import {
  X,
  CheckCircle2,
  ToggleLeft,
  PackageOpen,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getSubscriptionPlansAsync,
  upsertSubscriptionPlan,
  deleteSubscriptionPlan,
  type SubscriptionPlan,
} from "@/lib/store";
import { logAdminAction } from "@/lib/auditLog";
import { withVat } from "@/lib/vat";
import { ModalPortal } from "@/components/common/ModalPortal";

const BILLING_LABELS = {
  monthly: "Monthly",
  yearly: "Yearly",
};

const BILLING_COLORS: Record<SubscriptionPlan["billingType"], string> = {
  monthly: "bg-white border-gray-300 text-black",
  yearly: "bg-magenta-50 border-magenta-200 text-black",
};

const EMPTY_FORM: Omit<SubscriptionPlan, "id" | "createdAt" | "updatedAt"> = {
  name: "",
  price: 0,
  billingType: "monthly",
  description: "",
  features: [""],
  scanLimit: null,
  status: "active",
};

const formatPhp = (value: number) =>
  `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AdminPlanManagement() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteConfirm, setDeleteConfirm] = useState<SubscriptionPlan | null>(null);
  const [featuresText, setFeaturesText] = useState("");

  const loadPlans = async () => {
    setLoading(true);
    try {
      const data = await getSubscriptionPlansAsync(true);
      setPlans(data);
    } catch {
      setPlans([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlans();
  }, []);

  const openCreate = () => {
    setEditingPlan(null);
    setForm({ ...EMPTY_FORM, features: [""] });
    setFeaturesText("");
    setShowModal(true);
  };

  const openEdit = (plan: SubscriptionPlan) => {
    setEditingPlan(plan);
    setForm({
      name: plan.name,
      price: plan.price,
      billingType: plan.billingType,
      description: plan.description,
      features: plan.features,
      scanLimit: plan.scanLimit,
      status: plan.status,
    });
    setFeaturesText(plan.features.join("\n"));
    setShowModal(true);
  };

  const handleSave = async () => {
  const features = featuresText
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);

  if (!form.name.trim()) return;

  const normalizedBillingType: SubscriptionPlan["billingType"] =
  form.billingType;

  const plan: SubscriptionPlan = {
    id: editingPlan?.id ?? `plan-${Date.now()}`,
    ...form,
    billingType: normalizedBillingType,
    features,
    createdAt: editingPlan?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    await upsertSubscriptionPlan(plan);

    logAdminAction(
      editingPlan ? "Plan Updated" : "Plan Created",
      plan.name,
      `${editingPlan ? "Updated" : "Created"} subscription plan: ${plan.name} (base ₱${plan.price} excl. VAT, patient price ${formatPhp(withVat(plan.price))} / ${plan.billingType})`,
      "subscription"
    );

    await loadPlans();
    setShowModal(false);
  } catch (error) {
    console.error("[AdminPlanManagement] Failed to save plan:", error);

    const message =
      error instanceof Error
        ? error.message
        : "An unexpected error occurred while saving the plan.";

    window.alert(`Failed to save plan.\n\n${message}`);
  }
};

  const handleDelete = async (plan: SubscriptionPlan) => {
    await deleteSubscriptionPlan(plan.id);
    logAdminAction(
      "Plan Deleted",
      plan.name,
      `Deleted subscription plan: ${plan.name}`,
      "subscription"
    );
    await loadPlans();
    setDeleteConfirm(null);
  };

  const toggleStatus = async (plan: SubscriptionPlan) => {
    await upsertSubscriptionPlan({ ...plan, status: plan.status === "active" ? "inactive" : "active" });
    await loadPlans();
  };

  const activePlans = plans.filter((p) => p.status === "active").length;
  const inactivePlans = plans.length - activePlans;

  const inputClass =
    "w-full border border-gray-300 rounded-lg px-4 py-3 text-sm text-black placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-magenta-500/15 focus:border-magenta-500 transition-all";

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-black">Plan Management</h1>
          <p className="text-sm text-gray-600 mt-1">Create and manage subscription plans available to users.</p>
        </div>
        <button
          onClick={openCreate}
          className="self-start sm:self-auto bg-magenta-600 text-white px-6 py-3 rounded-lg font-semibold text-sm hover:bg-magenta-700 transition-colors cursor-pointer"
        >
          Add plan
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {[
          { label: "Total plans", value: plans.length, hint: "All subscription plans", icon: PackageOpen },
          { label: "Active plans", value: activePlans, hint: "Visible to users", icon: CheckCircle2 },
          { label: "Inactive plans", value: inactivePlans, hint: "Hidden from users", icon: ToggleLeft },
        ].map(({ label, value, hint, icon: Icon }) => (
          <div key={label} className="bg-white rounded-xl p-7 min-h-[156px] border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-black">{label}</p>
              <Icon className="w-5 h-5 text-magenta-600" />
            </div>
            <p className="mt-5 text-4xl font-bold text-black tabular-nums">{value}</p>
            <p className="mt-2 text-sm text-gray-600">{hint}</p>
          </div>
        ))}
      </div>

      {/* Plans table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-7 py-5 border-b border-gray-200 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-black">Subscription plans</h2>
          <span className="text-sm text-gray-600">{plans.length} total</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-black">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-7 py-4 text-xs font-semibold text-black uppercase tracking-wider">Plan</th>
                <th className="text-left px-5 py-4 text-xs font-semibold text-black uppercase tracking-wider">Price</th>
                <th className="text-left px-5 py-4 text-xs font-semibold text-black uppercase tracking-wider">Billing</th>
                <th className="text-left px-5 py-4 text-xs font-semibold text-black uppercase tracking-wider">Scan limit</th>
                <th className="text-left px-5 py-4 text-xs font-semibold text-black uppercase tracking-wider">Features</th>
                <th className="text-left px-5 py-4 text-xs font-semibold text-black uppercase tracking-wider">Status</th>
                <th className="text-right px-7 py-4 text-xs font-semibold text-black uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-16 text-gray-600">
                    <Loader2 className="w-6 h-6 text-magenta-600 animate-spin mx-auto mb-3" />
                    Loading subscription plans…
                  </td>
                </tr>
              ) : plans.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-16 text-gray-600">
                    <PackageOpen className="w-8 h-8 mx-auto mb-3 text-magenta-600" />
                    No plans yet. Click <strong className="text-black">Add plan</strong> to create one.
                  </td>
                </tr>
              ) : null}
              {plans.map((plan) => (
                <tr key={plan.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-7 py-5">
                    <p className="font-semibold text-black">{plan.name}</p>
                    <p className="text-xs text-gray-600 mt-0.5 max-w-[260px] truncate">{plan.description}</p>
                  </td>
                  <td className="px-5 py-5">
                    {plan.price === 0 ? (
                      <span className="font-bold text-black">Free</span>
                    ) : (
                      <>
                        {/* Patient price (incl. 12% VAT) */}
                        <span className="font-bold text-black">
                          {formatPhp(withVat(plan.price))}
                        </span>
                        {/* Base price entered by the admin (stored in plan.price) */}
                        <p className="text-xs text-gray-600 mt-0.5">
                          Base {formatPhp(plan.price)}
                        </p>
                      </>
                    )}
                  </td>
                  <td className="px-5 py-5">
                    <span className={cn("inline-flex px-3 py-1 rounded-full border text-xs font-semibold", BILLING_COLORS[plan.billingType])}>
                      {BILLING_LABELS[plan.billingType]}
                    </span>
                  </td>
                  <td className="px-5 py-5 text-black">
                    {plan.scanLimit === null ? (
                      <span className="font-semibold text-black">Unlimited</span>
                    ) : (
                      plan.scanLimit
                    )}
                  </td>
                  <td className="px-5 py-5">
                    <ul className="space-y-1">
                      {plan.features.slice(0, 3).map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-black">
                          <span className="text-magenta-600 leading-4">•</span> {f}
                        </li>
                      ))}
                      {plan.features.length > 3 && (
                        <li className="text-xs text-gray-600 pl-4">+{plan.features.length - 3} more</li>
                      )}
                    </ul>
                  </td>
                  <td className="px-5 py-5">
                    <button
                      onClick={() => toggleStatus(plan)}
                      className={cn(
                        "inline-flex items-center px-3.5 py-1.5 rounded-full border text-xs font-semibold text-black transition-colors cursor-pointer",
                        plan.status === "active"
                          ? "bg-magenta-50 border-magenta-200 hover:bg-magenta-100"
                          : "bg-gray-100 border-gray-300 hover:bg-gray-200"
                      )}
                      title="Click to toggle status"
                    >
                      {plan.status === "active" ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-7 py-5">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEdit(plan)}
                        className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-black text-sm font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
                        title="Edit plan"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(plan)}
                        className="px-4 py-2 rounded-lg border border-magenta-300 bg-white text-magenta-700 text-sm font-semibold hover:bg-magenta-50 transition-colors cursor-pointer"
                        title="Delete plan"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      <ModalPortal isOpen={Boolean(showModal)}>
        {showModal && (
          <div
            className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
            onClick={() => setShowModal(false)}
          >
            <div
              className="bg-white rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden relative z-[9999]"
              onClick={(e) => e.stopPropagation()}
            >
            <div className="flex items-center justify-between px-8 py-6 border-b border-gray-200 shrink-0">
              <h2 className="text-xl font-display font-bold text-black">
                {editingPlan ? "Edit plan" : "New subscription plan"}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-black transition-colors" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-8 py-6 space-y-6 overflow-y-auto no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden flex-1">
              {/* Plan Name */}
              <div>
                <label className="block text-sm font-semibold text-black mb-2">Plan name <span className="text-magenta-600">*</span></label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Premium Monthly"
                  className={inputClass}
                />
              </div>

              {/* Price + Billing Type */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-semibold text-black mb-2">Base price (PHP, excl. VAT)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.price}
                    onChange={(e) => {
                      const price = e.target.value === "" ? 0 : Number(e.target.value);
                      setForm((f) => ({ ...f, price }));
                    }}
                    className={inputClass}
                  />
                  <p className="text-xs mt-2 text-gray-600">
                    {form.price > 0
                      ? `Patients will pay ${formatPhp(withVat(form.price))} (includes 12% VAT).`
                      : "Enter the price before VAT. Use 0 for a free plan."}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-black mb-2">Billing type</label>
                  <select
                     value={form.billingType}
                     onChange={(e) =>
                       setForm((f) => ({
                         ...f,
                         billingType:
                           e.target.value as SubscriptionPlan["billingType"],
                      }))
                    }
                    className={cn(
                      "w-full border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-magenta-500/15 transition-all",
                      form.price <= 0
                        ? "bg-gray-100 text-gray-500 border-gray-200 cursor-not-allowed"
                        : "bg-white text-black border-gray-300 focus:border-magenta-500"
                    )}
                    >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                    </select>

                    <p className="text-xs mt-2 text-gray-600">
                      {form.price <= 0
                        ? "Free plans do not require a billing cycle."
                        : "Choose how often this plan is billed."}
                    </p>
                </div>
              </div>

              {/* Scan Limit */}
              <div>
                <label className="block text-sm font-semibold text-black mb-2">Scan limit</label>
                <div className="flex flex-wrap items-center gap-5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={form.scanLimit === null}
                      onChange={() => setForm((f) => ({ ...f, scanLimit: null }))}
                      className="accent-magenta-600"
                    />
                    <span className="text-sm text-black">Unlimited</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={form.scanLimit !== null}
                      onChange={() => setForm((f) => ({ ...f, scanLimit: 1 }))}
                      className="accent-magenta-600"
                    />
                    <span className="text-sm text-black">Limited:</span>
                  </label>
                  {form.scanLimit !== null && (
                    <input
                      type="number"
                      min={1}
                      value={form.scanLimit}
                      onChange={(e) => setForm((f) => ({ ...f, scanLimit: Number(e.target.value) }))}
                      className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-magenta-500/15 focus:border-magenta-500"
                    />
                  )}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-semibold text-black mb-2">Description</label>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Short description shown to users"
                  className={cn(inputClass, "resize-none")}
                />
              </div>

              {/* Features */}
              <div>
                <label className="block text-sm font-semibold text-black mb-2">
                  Features <span className="text-gray-600 font-normal">(one per line)</span>
                </label>
                <textarea
                  rows={5}
                  value={featuresText}
                  onChange={(e) => setFeaturesText(e.target.value)}
                  placeholder={"Unlimited AI skin scans\nPriority analysis queue\nFull scan history"}
                  className={cn(inputClass, "resize-none font-mono")}
                />
              </div>

              {/* Status */}
              <div>
                <label className="block text-sm font-semibold text-black mb-2">Status</label>
                <div className="flex gap-6">
                  {(["active", "inactive"] as const).map((s) => (
                    <label key={s} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={form.status === s}
                        onChange={() => setForm((f) => ({ ...f, status: s }))}
                        className="accent-magenta-600"
                      />
                      <span className="text-sm text-black capitalize">{s}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-8 py-5 flex gap-3 justify-end border-t border-gray-200 bg-gray-50 rounded-b-2xl shrink-0">
              <button
                onClick={() => setShowModal(false)}
                className="px-5 py-2.5 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-black hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!form.name.trim()}
                className="px-5 py-2.5 rounded-lg bg-magenta-600 text-white text-sm font-semibold hover:bg-magenta-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {editingPlan ? "Save changes" : "Create plan"}
              </button>
            </div>
          </div>
        </div>
      )}
      </ModalPortal>

      {/* Delete Confirm Modal */}
      <ModalPortal isOpen={Boolean(deleteConfirm)}>
        {deleteConfirm && (
          <div
            className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
            onClick={() => setDeleteConfirm(null)}
          >
            <div
              className="bg-white rounded-2xl w-full max-w-sm p-8 shadow-2xl relative z-[9999]"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-display font-bold text-black mb-2">Delete plan?</h3>
              <p className="text-sm text-gray-700 mb-7 leading-relaxed">
                <strong className="text-black">{deleteConfirm.name}</strong> will be permanently removed. Existing user subscriptions are not affected.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 py-2.5 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-black hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirm)}
                  className="flex-1 py-2.5 rounded-lg bg-magenta-600 text-white text-sm font-semibold hover:bg-magenta-700 transition-colors cursor-pointer"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </ModalPortal>
    </div>
  );
}