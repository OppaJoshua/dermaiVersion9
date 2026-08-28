import { useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  X,
  CheckCircle2,
  Crown,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  PackageOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getSubscriptionPlans,
  upsertSubscriptionPlan,
  deleteSubscriptionPlan,
  type SubscriptionPlan,
} from "@/lib/store";
import { logAdminAction } from "@/lib/auditLog";

const BILLING_LABELS: Record<SubscriptionPlan["billingType"], string> = {
  monthly: "Monthly",
  yearly: "Yearly",
  "one-time": "One-time",
};

const BILLING_COLORS: Record<SubscriptionPlan["billingType"], string> = {
  monthly: "bg-sky-100 text-sky-700",
  yearly: "bg-violet-100 text-violet-700",
  "one-time": "bg-gray-100 text-gray-600",
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

export default function AdminPlanManagement() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>(() => getSubscriptionPlans());
  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteConfirm, setDeleteConfirm] = useState<SubscriptionPlan | null>(null);
  const [featuresText, setFeaturesText] = useState("");

  const refresh = () => setPlans(getSubscriptionPlans());

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

  const handleSave = () => {
    const features = featuresText
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);

    if (!form.name.trim()) return;

    const plan: SubscriptionPlan = {
      id: editingPlan?.id ?? `plan-${Date.now()}`,
      ...form,
      features,
      createdAt: editingPlan?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    upsertSubscriptionPlan(plan);
    logAdminAction(
      editingPlan ? "Plan Updated" : "Plan Created",
      plan.name,
      `${editingPlan ? "Updated" : "Created"} subscription plan: ${plan.name} (₱${plan.price} / ${plan.billingType})`,
      "subscription"
    );
    refresh();
    setShowModal(false);
  };

  const handleDelete = (plan: SubscriptionPlan) => {
    deleteSubscriptionPlan(plan.id);
    logAdminAction(
      "Plan Deleted",
      plan.name,
      `Deleted subscription plan: ${plan.name}`,
      "subscription"
    );
    refresh();
    setDeleteConfirm(null);
  };

  const toggleStatus = (plan: SubscriptionPlan) => {
    upsertSubscriptionPlan({ ...plan, status: plan.status === "active" ? "inactive" : "active" });
    refresh();
  };

  const activePlans = plans.filter((p) => p.status === "active").length;
  const inactivePlans = plans.length - activePlans;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Plan Management</h1>
          <p className="text-sm text-gray-400 mt-0.5">Create and manage subscription plans available to users.</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 bg-magenta-500 text-white px-5 py-2.5 rounded-xl font-semibold text-sm hover:bg-magenta-600 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Plan
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "Total Plans", value: plans.length, icon: PackageOpen, color: "bg-magenta-50 text-magenta-500" },
          { label: "Active Plans", value: activePlans, icon: CheckCircle2, color: "bg-green-50 text-green-500" },
          { label: "Inactive Plans", value: inactivePlans, icon: ToggleLeft, color: "bg-amber-50 text-amber-500" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-2xl p-4 border border-gray-100 flex items-center gap-3">
            <div className={cn("p-2.5 rounded-xl", color)}>
              <Icon className="w-4 h-4" />
            </div>
            <div>
              <p className="text-2xl font-display font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Plans Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Plan</th>
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Price</th>
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Billing</th>
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Scan Limit</th>
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Features</th>
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-right px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {plans.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-16 text-gray-400">
                    <PackageOpen className="w-10 h-10 mx-auto mb-3 text-gray-200" />
                    No plans yet. Click <strong>Add Plan</strong> to create one.
                  </td>
                </tr>
              )}
              {plans.map((plan) => (
                <tr key={plan.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2.5">
                      <div className="p-1.5 bg-magenta-50 rounded-lg text-magenta-500">
                        {plan.price === 0 ? <Sparkles className="w-4 h-4" /> : <Crown className="w-4 h-4" />}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">{plan.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5 max-w-[260px] truncate">{plan.description}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className="font-bold text-gray-900">
                      {plan.price === 0 ? "Free" : `₱${plan.price.toLocaleString()}`}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-semibold", BILLING_COLORS[plan.billingType])}>
                      {BILLING_LABELS[plan.billingType]}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-gray-700">
                    {plan.scanLimit === null ? (
                      <span className="font-semibold text-green-700">Unlimited</span>
                    ) : (
                      plan.scanLimit
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <ul className="space-y-0.5">
                      {plan.features.slice(0, 3).map((f, i) => (
                        <li key={i} className="flex items-center gap-1.5 text-xs text-gray-600">
                          <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" /> {f}
                        </li>
                      ))}
                      {plan.features.length > 3 && (
                        <li className="text-xs text-gray-400 pl-4.5">+{plan.features.length - 3} more</li>
                      )}
                    </ul>
                  </td>
                  <td className="px-4 py-4">
                    <button
                      onClick={() => toggleStatus(plan)}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors",
                        plan.status === "active"
                          ? "bg-green-100 text-green-700 hover:bg-green-200"
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      )}
                    >
                      {plan.status === "active"
                        ? <><ToggleRight className="w-3.5 h-3.5" /> Active</>
                        : <><ToggleLeft className="w-3.5 h-3.5" /> Inactive</>}
                    </button>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEdit(plan)}
                        className="p-2 rounded-lg hover:bg-magenta-50 text-gray-400 hover:text-magenta-500 transition-colors"
                        title="Edit plan"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(plan)}
                        className="p-2 rounded-lg hover:bg-rose-50 text-gray-400 hover:text-rose-500 transition-colors"
                        title="Delete plan"
                      >
                        <Trash2 className="w-4 h-4" />
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
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-white rounded-3xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
              <h2 className="text-lg font-display font-bold text-gray-900">
                {editingPlan ? "Edit Plan" : "New Subscription Plan"}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Plan Name */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Plan Name <span className="text-rose-500">*</span></label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Premium Monthly"
                  className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all"
                />
              </div>

              {/* Price + Billing Type */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Price (PHP)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value) }))}
                    className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Billing Type</label>
                  <select
                    value={form.billingType}
                    onChange={(e) => setForm((f) => ({ ...f, billingType: e.target.value as SubscriptionPlan["billingType"] }))}
                    className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all bg-white"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                    <option value="one-time">One-time</option>
                  </select>
                </div>
              </div>

              {/* Scan Limit */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Scan Limit</label>
                <div className="flex gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={form.scanLimit === null}
                      onChange={() => setForm((f) => ({ ...f, scanLimit: null }))}
                      className="accent-magenta-500"
                    />
                    <span className="text-sm text-gray-700">Unlimited</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={form.scanLimit !== null}
                      onChange={() => setForm((f) => ({ ...f, scanLimit: 1 }))}
                      className="accent-magenta-500"
                    />
                    <span className="text-sm text-gray-700">Limited:</span>
                  </label>
                  {form.scanLimit !== null && (
                    <input
                      type="number"
                      min={1}
                      value={form.scanLimit}
                      onChange={(e) => setForm((f) => ({ ...f, scanLimit: Number(e.target.value) }))}
                      className="w-20 border border-gray-200 rounded-lg px-2.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500"
                    />
                  )}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Description</label>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Short description shown to users"
                  className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all resize-none"
                />
              </div>

              {/* Features */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Features <span className="text-gray-400 font-normal">(one per line)</span>
                </label>
                <textarea
                  rows={5}
                  value={featuresText}
                  onChange={(e) => setFeaturesText(e.target.value)}
                  placeholder={"Unlimited AI skin scans\nPriority analysis queue\nFull scan history"}
                  className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all resize-none font-mono"
                />
              </div>

              {/* Status */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Status</label>
                <div className="flex gap-4">
                  {(["active", "inactive"] as const).map((s) => (
                    <label key={s} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={form.status === s}
                        onChange={() => setForm((f) => ({ ...f, status: s }))}
                        className="accent-magenta-500"
                      />
                      <span className="text-sm text-gray-700 capitalize">{s}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 pb-6 flex gap-3 justify-end border-t border-gray-100 pt-4">
              <button
                onClick={() => setShowModal(false)}
                className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!form.name.trim()}
                className="px-5 py-2.5 rounded-xl bg-magenta-500 text-white text-sm font-semibold hover:bg-magenta-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {editingPlan ? "Save Changes" : "Create Plan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 bg-rose-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-6 h-6 text-rose-500" />
            </div>
            <h3 className="text-lg font-display font-bold text-gray-900 text-center mb-1">Delete Plan?</h3>
            <p className="text-sm text-gray-500 text-center mb-6">
              <strong>{deleteConfirm.name}</strong> will be permanently removed. Existing user subscriptions are not affected.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 py-2.5 rounded-xl bg-rose-500 text-white text-sm font-semibold hover:bg-rose-600 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
