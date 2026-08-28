// Placeholder data layer. TODO: replace every function body with real Supabase calls.

export type PlatformUser = {
  id: number;
  name: string;
  email: string;
  status: "active" | "suspended" | "inactive";
  plan: "Free" | "Premium";
  subscriptionRenewsAt?: string;
};

export type PlatformScanStatus = "valid" | "flagged" | "invalid";

export type PlatformScan = {
  id: string;
  status: PlatformScanStatus;
  /** District/municipality in Cebu where the scan was taken (from patient profile) */
  district?: string;
  /** AI-detected skin condition name (e.g. "Acne Vulgaris") */
  condition?: string;
};

export type SubscriptionPlan = {
  id: string;
  name: string;
  price: number;
  billingType: "monthly" | "yearly" | "one-time";
  description: string;
  features: string[];
  scanLimit: number | null;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

const defaultSubscriptionPlans: SubscriptionPlan[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    billingType: "one-time",
    description: "3 free skin scans, then upgrade required",
    features: ["3 free skin scans", "Basic skin condition library access"],
    scanLimit: 3,
    status: "active",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "premium-monthly",
    name: "Premium Monthly",
    price: 199,
    billingType: "monthly",
    description: "Unlimited skin scans",
    features: ["Unlimited skin scans", "Priority clinic booking", "Full skin history"],
    scanLimit: null,
    status: "active",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "premium-annual",
    name: "Premium Annual",
    price: 1999,
    billingType: "yearly",
    description: "Unlimited skin scans · best value",
    features: ["Unlimited skin scans", "Priority clinic booking", "Full skin history", "Save 16% vs monthly"],
    scanLimit: null,
    status: "active",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
];

// TODO: GET /api/admin/users
export function getPlatformUsers(): PlatformUser[] {
  return [];
}

// TODO: PATCH /api/admin/users/:email/status
export function updatePlatformUserStatus(_email: string, _status: PlatformUser["status"]): void {}

// TODO: GET /api/admin/scans
export function getPlatformScans(): PlatformScan[] {
  return [];
}

// TODO: PATCH /api/admin/scans/:id/status
export function updatePlatformScanStatus(_id: string, _status: PlatformScanStatus, _reason?: string): void {}

// TODO: PATCH /api/admin/helpdesk/:id/status
export function updateHelpdeskTicketStatus(_id: string, _status: "open" | "in-progress" | "resolved"): void {}


// TODO: GET /api/subscription-plans
export function getSubscriptionPlans(): SubscriptionPlan[] {
  return defaultSubscriptionPlans;
}

// TODO: PUT /api/admin/subscription-plans/:id
export function upsertSubscriptionPlan(_plan: SubscriptionPlan): void {}

// TODO: DELETE /api/admin/subscription-plans/:id
export function deleteSubscriptionPlan(_id: string): void {}