import { getManilaCalendarDate, getManilaNowParts } from "./schedulingService";

export interface AdminPaymentRecord {
  payment_id: string;
  amount: number;
  payment_date: string;
  status?: string;
  method?: string;
  user?: string;
  plan?: string;
}

export interface AdminRevenueCalculationResult {
  year: number;
  totalRevenue: number;
  formattedRevenue: string;
  paidTransactionsCount: number;
  eligiblePayments: AdminPaymentRecord[];
  excludedPayments: Array<{ payment: AdminPaymentRecord; reason: string }>;
}

/**
 * Checks whether an admin subscription payment record is successful.
 * In Supabase user_payment table:
 * check (status in ('success','failed','pending','reconciliation_required','refunded'))
 * Only 'success' (or legacy 'paid') represents collected, non-refunded revenue.
 */
export function isSuccessfulAdminPayment(status?: string | null): boolean {
  if (!status) return false;
  const clean = String(status).toLowerCase().trim();
  return clean === "success" || clean === "paid";
}

/**
 * Resolves the calendar year for an admin payment strictly in Asia/Manila (UTC+8).
 */
export function getAdminPaymentManilaYear(paymentDate?: string | Date | null): number | null {
  if (!paymentDate) return null;
  const manilaDateKey = getManilaCalendarDate(paymentDate);
  if (!manilaDateKey || !/^\d{4}-\d{2}-\d{2}$/.test(manilaDateKey)) {
    return null;
  }
  const year = parseInt(manilaDateKey.slice(0, 4), 10);
  if (isNaN(year) || year < 1900 || year > 2200) {
    return null;
  }
  return year;
}

/**
 * Formats a Philippine Peso currency amount for Admin dashboards.
 */
export function formatPhpAdmin(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Calculates Admin annual subscription revenue for a specific calendar year in Asia/Manila.
 * Strict rules:
 * 1. Attributed strictly to payment_date in Asia/Manila (UTC+8) from Jan 1 00:00:00 to Dec 31 23:59:59.
 * 2. Only successful payments (status = 'success' or 'paid') are counted.
 * 3. Pending, failed, refunded, and reconciliation_required payments are strictly excluded.
 * 4. Deduplicates by payment_id to prevent double-counting.
 * 5. Returns total revenue, formatted currency string, count, and eligible records.
 */
export function calculateAdminAnnualRevenue({
  payments,
  year,
}: {
  payments: AdminPaymentRecord[];
  year: number;
}): AdminRevenueCalculationResult {
  let totalRevenue = 0;
  let paidTransactionsCount = 0;
  const eligiblePayments: AdminPaymentRecord[] = [];
  const excludedPayments: Array<{ payment: AdminPaymentRecord; reason: string }> = [];
  const seenPaymentIds = new Set<string>();

  for (const payment of payments) {
    // 0. Deduplication by payment_id
    const rawId = payment.payment_id;
    if (rawId) {
      const cleanId = String(rawId).trim().toUpperCase();
      if (seenPaymentIds.has(cleanId)) {
        excludedPayments.push({ payment, reason: "duplicate_id" });
        continue;
      }
      seenPaymentIds.add(cleanId);
    }

    // 1. Status check: only successful payments are credited to revenue
    if (!isSuccessfulAdminPayment(payment.status)) {
      excludedPayments.push({ payment, reason: "unsuccessful_or_refunded_status" });
      continue;
    }

    // 2. Year attribution strictly in Asia/Manila
    const pYear = getAdminPaymentManilaYear(payment.payment_date);
    if (pYear === null) {
      excludedPayments.push({ payment, reason: "invalid_payment_date" });
      continue;
    }

    if (pYear !== year) {
      excludedPayments.push({ payment, reason: "year_mismatch" });
      continue;
    }

    // 3. Amount accumulation
    const rawAmount = payment.amount;
    let fee = 0;
    if (rawAmount !== undefined && rawAmount !== null) {
      const num = typeof rawAmount === "number" ? rawAmount : parseFloat(String(rawAmount).replace(/,/g, ""));
      if (!isNaN(num) && num > 0) {
        fee = num;
      }
    }

    totalRevenue += fee;
    paidTransactionsCount += 1;
    eligiblePayments.push(payment);
  }

  const formattedRevenue = formatPhpAdmin(totalRevenue);

  return {
    year,
    totalRevenue,
    formattedRevenue,
    paidTransactionsCount,
    eligiblePayments,
    excludedPayments,
  };
}

/**
 * Returns a sorted descending list of available calendar years from the payments list,
 * always including the current calendar year in Asia/Manila.
 */
export function getAvailableAdminRevenueYears(
  payments: AdminPaymentRecord[],
  currentYear?: number
): number[] {
  const activeYear = currentYear ?? getManilaNowParts().year;
  const yearsSet = new Set<number>([activeYear]);

  for (const p of payments) {
    if (isSuccessfulAdminPayment(p.status)) {
      const y = getAdminPaymentManilaYear(p.payment_date);
      if (y !== null) {
        yearsSet.add(y);
      }
    }
  }

  return Array.from(yearsSet).sort((a, b) => b - a);
}

