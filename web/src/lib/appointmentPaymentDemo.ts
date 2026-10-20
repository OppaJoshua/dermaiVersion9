/**
 * DermAI: Static Simulated Appointment Payment Demonstration Helper
 *
 * Isolated frontend-only demonstration mode for capstone presentations.
 * Strictly disabled in production builds. In development, can be enabled
 * via VITE_ENABLE_PAYMENT_DEMO_MODE="true", URL query (?demo=payment), or session toggle.
 *
 * In demo mode, zero Supabase database queries (insert, update, delete, RPC) are executed.
 */

export type DemoPaymentMethod = "gcash" | "maya" | "simulated_card" | "simulated_ewallet";
export type DemoOutcome = "idle" | "success" | "failed" | "cancelled";

export interface DemoCheckoutData {
  clinicName: string;
  doctorName: string;
  date: string;
  time: string;
  conditionName?: string;
  confidenceScore?: number | null;
  consultationFee: number;
  paymentMethod: DemoPaymentMethod;
  payerName?: string;
  payerEmail?: string;
  payerAddress?: string;
  mobileNumber?: string;
  outcome: DemoOutcome;
  mockReference: string;
  mockQueueNumber: number;
  simulatedAt?: string;
  errorMessage?: string;
}

const SESSION_STORAGE_KEY = "dermai_payment_demo_active";

// Fallback in-memory state for non-browser/test runtimes
let inMemorySessionActive: boolean | null = null;
let testEnvOverride: { PROD?: boolean; DEV?: boolean } | null = null;

/**
 * Internal test helper to simulate PROD/DEV compiler modes in unit test suites.
 */
export function _setTestEnvOverride(override: { PROD?: boolean; DEV?: boolean } | null): void {
  testEnvOverride = override;
}

/**
 * Resets in-memory test overrides and session storage for clean test suites.
 */
export function _resetDemoSessionForTesting(): void {
  inMemorySessionActive = null;
  testEnvOverride = null;
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {}
}

/**
 * Returns human-readable label for the simulated payment method.
 */
export function formatDemoPaymentMethod(method: DemoPaymentMethod): string {
  switch (method) {
    case "gcash":
      return "GCash";
    case "maya":
      return "Maya (formerly PayMaya)";
    case "simulated_card":
      return "Simulated Card";
    case "simulated_ewallet":
      return "Simulated E-Wallet";
    default:
      return "GCash";
  }
}

/**
 * Checks whether the static payment demo mode is active.
 * - Always FALSE in production builds (import.meta.env.PROD)
 * - In development, enabled if:
 *   1. SessionStorage explicitly set to "true" (or disabled if explicitly set to "false")
 *   2. In-memory override (test runtimes)
 *   3. VITE_ENABLE_PAYMENT_DEMO_MODE === "true"
 *   4. URL query string contains ?demo=payment or ?demo=true or ?payment_demo=true
 */
export function isPaymentDemoMode(): boolean {
  // Hard security gate: Never enable in production builds
  const isProd = testEnvOverride?.PROD ?? (typeof import.meta !== "undefined" && import.meta.env?.PROD);
  const isDev = testEnvOverride?.DEV ?? (typeof import.meta !== "undefined" && import.meta.env?.DEV);

  if (isProd && !isDev) {
    return false;
  }

  // 1. Check explicit session override (allows interactive toggle to take precedence)
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      const sessionVal = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (sessionVal === "true") return true;
      if (sessionVal === "false") return false;
    }
  } catch {}

  // 2. Check in-memory fallback if set explicitly
  if (inMemorySessionActive === true) return true;
  if (inMemorySessionActive === false) return false;

  // 3. Check environment variable (Vite import.meta.env or Node process.env)
  try {
    if (typeof import.meta !== "undefined" && import.meta.env) {
      if (import.meta.env.VITE_ENABLE_PAYMENT_DEMO_MODE === "true") {
        return true;
      }
    }
  } catch {}

  try {
    if (typeof process !== "undefined" && process.env) {
      if (process.env.VITE_ENABLE_PAYMENT_DEMO_MODE === "true") {
        return true;
      }
    }
  } catch {}

  // 4. Check window location query parameter (development/presentation only)
  try {
    if (typeof window !== "undefined" && window.location) {
      const params = new URLSearchParams(window.location.search);
      const demoParam = params.get("demo")?.toLowerCase();
      const paymentDemoParam = params.get("payment_demo")?.toLowerCase();
      if (demoParam === "payment" || demoParam === "true" || paymentDemoParam === "true") {
        return true;
      }
    }
  } catch {}

  return false;
}

/**
 * Allows toggling demo mode in development/presentation sessions.
 * Has no effect in production builds.
 */
export function setPaymentDemoMode(enabled: boolean): void {
  const isProd = testEnvOverride?.PROD ?? (typeof import.meta !== "undefined" && import.meta.env?.PROD);
  const isDev = testEnvOverride?.DEV ?? (typeof import.meta !== "undefined" && import.meta.env?.DEV);

  if (isProd && !isDev) {
    console.warn("[PaymentDemo] Cannot enable demo mode in production build.");
    return;
  }

  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      if (enabled) {
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, "true");
      } else {
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, "false");
      }
    }
  } catch {}

  inMemorySessionActive = enabled;
}

/**
 * Helper to identify the active configuration source for demo mode (for UI display).
 */
export function getDemoPaymentModeSource(): "env" | "query" | "session" | "disabled" {
  const isProd = testEnvOverride?.PROD ?? (typeof import.meta !== "undefined" && import.meta.env?.PROD);
  const isDev = testEnvOverride?.DEV ?? (typeof import.meta !== "undefined" && import.meta.env?.DEV);

  if (isProd && !isDev) {
    return "disabled";
  }

  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      const sessionVal = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (sessionVal === "true") return "session";
      if (sessionVal === "false") return "disabled";
    }
  } catch {}

  if (inMemorySessionActive === true) return "session";
  if (inMemorySessionActive === false) return "disabled";

  try {
    if (typeof import.meta !== "undefined" && import.meta.env) {
      if (import.meta.env.VITE_ENABLE_PAYMENT_DEMO_MODE === "true") {
        return "env";
      }
    }
  } catch {}

  try {
    if (typeof process !== "undefined" && process.env) {
      if (process.env.VITE_ENABLE_PAYMENT_DEMO_MODE === "true") {
        return "env";
      }
    }
  } catch {}

  try {
    if (typeof window !== "undefined" && window.location) {
      const params = new URLSearchParams(window.location.search);
      const demoParam = params.get("demo")?.toLowerCase();
      const paymentDemoParam = params.get("payment_demo")?.toLowerCase();
      if (demoParam === "payment" || demoParam === "true" || paymentDemoParam === "true") {
        return "query";
      }
    }
  } catch {}

  return "disabled";
}

/**
 * Generates an isolated mock reference clearly marked as a demo.
 */
export function generateMockPaymentReference(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomHex = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `DEMO-TX-MOCK-${dateStr}-${randomHex}`;
}

/**
 * Creates initial mock checkout data from appointment parameters.
 * Validates consultation fee strictly: does not invent a fallback fee or hardcode a clinic price.
 */
export function createMockCheckoutData(params: {
  clinicName: string;
  doctorName?: string;
  date: string;
  time: string;
  conditionName?: string;
  confidenceScore?: number | null;
  consultationFee: number;
  paymentMethod?: DemoPaymentMethod;
  payerName?: string;
  payerEmail?: string;
  payerAddress?: string;
  mobileNumber?: string;
}): DemoCheckoutData {
  const fee = Number(params.consultationFee);
  if (
    params.consultationFee === undefined ||
    params.consultationFee === null ||
    isNaN(fee) ||
    fee <= 0
  ) {
    throw new Error(
      "Missing or invalid clinic consultation fee. Cannot proceed with simulated payment demo."
    );
  }

  return {
    clinicName: params.clinicName,
    doctorName: params.doctorName || "Assigned by Clinic",
    date: params.date,
    time: params.time,
    conditionName: params.conditionName || "Skin Assessment",
    confidenceScore: params.confidenceScore ?? null,
    consultationFee: fee,
    paymentMethod: params.paymentMethod || "gcash",
    payerName: params.payerName || "Patient",
    payerEmail: params.payerEmail || "",
    payerAddress: params.payerAddress || "",
    mobileNumber: params.mobileNumber || "09999999999",
    outcome: "idle",
    mockReference: generateMockPaymentReference(),
    mockQueueNumber: Math.floor(Math.random() * 8) + 1,
  };
}

export interface SubmissionDecisionParams {
  isDemoMode: boolean;
  clinic: { id?: string; name?: string; consultationFee?: any } | null;
  selectedDate: string;
  selectedTime: string;
  doctorName?: string;
  scan?: { id?: string; conditionName?: string; confidence?: number | null } | null;
  patientName?: string;
  patientEmail?: string;
  patientAddress?: string;
  patientContact?: string;
}

export type SubmissionDecisionResult =
  | {
      action: "open_demo_checkout";
      checkoutData: DemoCheckoutData;
    }
  | {
      action: "error";
      errorMessage: string;
    }
  | {
      action: "proceed_real_booking";
    };

/**
 * Pure decision evaluator for the patient appointment submission flow.
 * Ensures demo mode intercepts before any real database writes or notifications.
 * Strictly verifies the clinic consultation fee without fallbacks.
 */
export function evaluateAppointmentSubmission(
  params: SubmissionDecisionParams
): SubmissionDecisionResult {
  if (params.isDemoMode) {
    if (!params.clinic) {
      return { action: "error", errorMessage: "No clinic selected." };
    }

    const rawFee = params.clinic.consultationFee;
    const feeNum =
      rawFee !== undefined && rawFee !== null && String(rawFee).trim() !== ""
        ? Number(rawFee)
        : NaN;

    if (isNaN(feeNum) || feeNum <= 0) {
      return {
        action: "error",
        errorMessage:
          "The selected clinic does not have a valid consultation fee configured. Cannot proceed with online payment checkout.",
      };
    }

    try {
      const checkoutData = createMockCheckoutData({
        clinicName: params.clinic.name || "Skin Clinic",
        doctorName: params.doctorName || "Assigned by Clinic",
        date: params.selectedDate,
        time: params.selectedTime,
        conditionName: params.scan?.conditionName,
        confidenceScore: params.scan?.confidence,
        consultationFee: feeNum,
        paymentMethod: "gcash",
        payerName: params.patientName,
        payerEmail: params.patientEmail,
        payerAddress: params.patientAddress,
        mobileNumber: params.patientContact || "09999999999",
      });

      return {
        action: "open_demo_checkout",
        checkoutData,
      };
    } catch (err: any) {
      return {
        action: "error",
        errorMessage: err?.message || "Failed to initialize payment checkout.",
      };
    }
  }

  return { action: "proceed_real_booking" };
}
