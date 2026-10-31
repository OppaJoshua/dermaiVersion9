import { getManilaCalendarDate, getManilaNowParts } from "./schedulingService";

export interface ClinicRevenueAppointmentInput {
  id?: string | number;
  appointment_id?: string | number;
  clinicId?: string | number;
  clinic_id?: string | number;
  clinicName?: string;
  rawDate?: string;
  date?: string;
  created_at?: string;
  createdAt?: string;
  status?: string;
  doctorStatus?: string;
  doctor_status?: string;
  checkInStatus?: string;
  check_in_status?: string;
  paymentStatus?: string;
  payment_status?: string;
  paymentAmount?: number | string | null;
  payment_amount?: number | string | null;
  paymentReference?: string;
  payment_reference?: string;
  paidAt?: string;
  paid_at?: string;
  clinicNote?: string;
  clinic_note?: string;
  notes?: string;
}

export interface ExcludedRevenueRecord {
  record: ClinicRevenueAppointmentInput;
  reason:
    | "clinic_mismatch"
    | "missing_or_invalid_consultation_date"
    | "year_mismatch"
    | "cancelled_or_rejected"
    | "ineligible_status"
    | "refunded"
    | "unpaid"
    | "duplicate_id";
}

export interface ClinicRevenueCalculationResult {
  year: number;
  totalRevenue: number;
  formattedRevenue: string;
  paidAppointmentsCount: number;
  eligibleAppointments: ClinicRevenueAppointmentInput[];
  excludedRecords: ExcludedRevenueRecord[];
}

export const REFUND_EXTERNAL_DISCLAIMER =
  "Note: External refunds processed directly through PayMongo may not automatically update DermAI unless the consultation is cancelled or marked refunded in the clinic portal.";

const REFUND_REGEX = /\[REFUNDED\]|\brefunded\b/i;

/**
 * Checks whether an appointment has confirmed online payment.
 * Strict rules:
 * - DermAI supports ONLINE PAYMENTS ONLY. There is no cash, counter, or onsite payment feature.
 * - Revenue is counted exclusively from appointments with verified online payment (payment_status = 'paid').
 * - Completed status alone does NOT mean paid.
 * - Patient notes and clinic notes are NEVER used to infer or establish payment.
 * - Explicitly refunded appointments (payment_status = 'refunded' or [REFUNDED] in clinic_note) are not paid.
 */
export function isExplicitlyPaidAppointment(appt: ClinicRevenueAppointmentInput): boolean {
  const pStatus = String(appt.paymentStatus || appt.payment_status || "")
    .toLowerCase()
    .trim();

  // Explicitly refunded appointments are not paid
  if (isRefundedAppointment(appt)) {
    return false;
  }

  // Authoritative verified online payment
  return pStatus === "paid";
}

/**
 * Checks whether an appointment is explicitly marked as refunded.
 * Matches payment_status = 'refunded' or staff [REFUNDED] notation in clinic_note.
 * Preserves limitation: External PayMongo refunds are not automatically synchronized with DermAI.
 */
export function isRefundedAppointment(appt: ClinicRevenueAppointmentInput): boolean {
  const pStatus = String(appt.paymentStatus || appt.payment_status || "")
    .toLowerCase()
    .trim();
  const clinicNotesText = [appt.clinicNote, appt.clinic_note].filter(Boolean).join(" ");

  return pStatus === "refunded" || REFUND_REGEX.test(clinicNotesText);
}

/**
 * Resolves the scheduled consultation calendar year strictly in Asia/Manila (UTC+8).
 * Strict rule: Never silently falls back to createdAt or created_at when date is missing or invalid.
 */
export function getAppointmentManilaYear(appt: ClinicRevenueAppointmentInput): number | null {
  // Use rawDate if available, otherwise check date
  const candidate = appt.rawDate || appt.date;
  if (!candidate || typeof candidate !== "string") {
    return null;
  }

  const clean = candidate.trim();
  if (
    !clean ||
    clean.toLowerCase() === "schedule pending" ||
    clean.toLowerCase() === "schedule_pending"
  ) {
    return null;
  }

  const manilaDateKey = getManilaCalendarDate(clean);
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
 * Calculates clinic annual consultation revenue for a specific calendar year in Asia/Manila.
 * Strict rules:
 * 1. Attributed strictly to scheduled consultation date (patient_appointment.date), not payment/created date.
 * 2. Missing or invalid consultation dates are excluded (never fall back to createdAt).
 * 3. Count revenue EXCLUSIVELY from verified successful online payments (payment_status = 'paid').
 * 4. Completed status alone is NOT paid.
 * 5. Only includes scheduled, accepted, or completed appointments. Cancelled/rejected/pending/expired are excluded.
 * 6. Uses earned consultation fee (payment_amount), never captured amount or overpayments.
 * 7. Configured clinic consultation fee is only used for verified paid legacy records where fee is missing.
 * 8. Refunded appointments are strictly excluded.
 * 9. Clinic data isolation is strictly enforced.
 * 10. Deduplicates appointment IDs to prevent double-counting.
 */
export function calculateClinicAnnualRevenue({
  appointments,
  clinicId,
  year,
  clinicFee = 0,
}: {
  appointments: ClinicRevenueAppointmentInput[];
  clinicId: string | number;
  year: number;
  clinicFee?: number;
}): ClinicRevenueCalculationResult {
  let totalRevenue = 0;
  let paidAppointmentsCount = 0;
  const eligibleAppointments: ClinicRevenueAppointmentInput[] = [];
  const excludedRecords: ExcludedRevenueRecord[] = [];
  const seenAppointmentIds = new Set<string>();

  const targetClinicIdStr = String(clinicId || "").trim();

  for (const appt of appointments) {
    // 0. Internal Deduplication: Ignore duplicate appointment IDs
    // Safe handling: Missing or invalid IDs are evaluated independently and not merged.
    const rawId = appt.id ?? appt.appointment_id;
    const hasValidId = rawId !== undefined && rawId !== null && String(rawId).trim() !== "";
    const cleanId = hasValidId ? String(rawId).trim() : null;

    if (cleanId !== null) {
      if (seenAppointmentIds.has(cleanId)) {
        excludedRecords.push({ record: appt, reason: "duplicate_id" });
        continue;
      }
      seenAppointmentIds.add(cleanId);
    }

    // 1. Clinic Isolation
    const apptClinicId = appt.clinicId ?? appt.clinic_id;
    if (!targetClinicIdStr || String(apptClinicId || "").trim() !== targetClinicIdStr) {
      excludedRecords.push({ record: appt, reason: "clinic_mismatch" });
      continue;
    }

    // 2. Revenue Date Attribution (strictly scheduled consultation date in Asia/Manila)
    const apptYear = getAppointmentManilaYear(appt);
    if (apptYear === null) {
      excludedRecords.push({
        record: appt,
        reason: "missing_or_invalid_consultation_date",
      });
      continue;
    }

    if (apptYear !== year) {
      excludedRecords.push({ record: appt, reason: "year_mismatch" });
      continue;
    }

    // 3. Appointment Status Check (scheduled, accepted, completed)
    const status = String(appt.status || "").toLowerCase().trim();
    const docStatus = String(appt.doctorStatus || appt.doctor_status || "").toLowerCase().trim();

    if (status === "cancelled" || status === "rejected" || docStatus === "rejected") {
      excludedRecords.push({ record: appt, reason: "cancelled_or_rejected" });
      continue;
    }

    if (!["scheduled", "accepted", "completed", "confirmed"].includes(status)) {
      excludedRecords.push({ record: appt, reason: "ineligible_status" });
      continue;
    }

    // 4. Refund Exclusion
    if (isRefundedAppointment(appt)) {
      excludedRecords.push({ record: appt, reason: "refunded" });
      continue;
    }

    // 5. Confirmed Online Payment Check (payment_status === 'paid' ONLY)
    if (!isExplicitlyPaidAppointment(appt)) {
      excludedRecords.push({ record: appt, reason: "unpaid" });
      continue;
    }

    // 6. Revenue Amount (earned consultation fee only, excluding overpayments)
    const rawAmount = appt.paymentAmount ?? appt.payment_amount;
    let fee = 0;

    if (rawAmount !== undefined && rawAmount !== null && rawAmount !== "") {
      const num = typeof rawAmount === "number" ? rawAmount : parseFloat(String(rawAmount).replace(/,/g, ""));
      if (!isNaN(num) && num > 0) {
        fee = num;
      }
    }

    // Fallback to clinic's configured fee ONLY for legacy records where online payment is reliably established
    // and original fee is unavailable.
    if (fee <= 0 && clinicFee > 0) {
      fee = clinicFee;
    }

    totalRevenue += fee;
    paidAppointmentsCount += 1;
    eligibleAppointments.push(appt);
  }

  const formattedRevenue = `₱${totalRevenue.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  return {
    year,
    totalRevenue,
    formattedRevenue,
    paidAppointmentsCount,
    eligibleAppointments,
    excludedRecords,
  };
}

/**
 * Returns a sorted descending list of available calendar years present in the clinic's appointments,
 * always including the current calendar year.
 */
export function getAvailableRevenueYears(
  appointments: ClinicRevenueAppointmentInput[],
  currentYear?: number
): number[] {
  const activeYear = currentYear ?? getManilaNowParts().year;
  const yearsSet = new Set<number>([activeYear]);

  for (const appt of appointments) {
    const y = getAppointmentManilaYear(appt);
    if (y !== null) {
      yearsSet.add(y);
    }
  }

  return Array.from(yearsSet).sort((a, b) => b - a);
}
