/**
 * DermAI — Paginated Appointment Retrieval Helper
 *
 * Provides safe, multi-page retrieval of historical clinic appointments from Supabase
 * without hitting PostgREST's default 1,000-row limit.
 *
 * Guarantees:
 * 1. Continues fetching until a page with fewer than `pageSize` records is returned.
 * 2. Deduplicates records across pages based on appointment ID.
 * 3. Never silently returns partial data as complete when a page query fails.
 * 4. Tracks total pages fetched, total unique records, completion status, and errors.
 * 5. Supports cancellation checks between pages.
 */

export interface PaginatedFetchResult<T = any> {
  data: T[];
  isComplete: boolean;
  error: Error | null;
  totalFetched: number;
  pagesFetched: number;
}

export interface FetchAllPaginatedOptions<T = any> {
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: any | null }>;
  pageSize?: number;
  getId?: (item: T) => string | number | null | undefined;
  isCancelled?: () => boolean;
}

export const DEFAULT_PAGE_SIZE = 1000;

export const CLINIC_APPOINTMENTS_SELECT_PROJECTION = `
  appointment_id,
  clinic_id,
  date,
  status,
  notes,
  clinic_note,
  assigned_doctor_id,
  doctor_status,
  doctor_note,
  doctor_reviewed_at,
  patient_name,
  patient_email,
  patient_contact,
  patient_address,
  skin_photo_url,
  ai_condition_name,
  ai_confidence,
  created_at,
  payment_status,
  payment_amount,
  payment_reference,
  paid_at,
  user:user_id ( full_name, avatar_url )
`;

/**
 * Generic paginated fetcher using `.range(from, to)`.
 */
export async function fetchAllPaginatedRecords<T = any>({
  fetchPage,
  pageSize = DEFAULT_PAGE_SIZE,
  getId,
  isCancelled,
}: FetchAllPaginatedOptions<T>): Promise<PaginatedFetchResult<T>> {
  if (pageSize <= 0) {
    throw new Error(`Invalid pageSize: ${pageSize}. Must be greater than 0.`);
  }

  const accumulated: T[] = [];
  const seenIds = new Set<string>();
  let offset = 0;
  let pagesFetched = 0;
  let isComplete = false;
  let errorResult: Error | null = null;

  while (true) {
    if (isCancelled && isCancelled()) {
      return {
        data: accumulated,
        isComplete: false,
        error: new Error("Pagination cancelled"),
        totalFetched: accumulated.length,
        pagesFetched,
      };
    }

    const from = offset;
    const to = offset + pageSize - 1;

    let response: { data: T[] | null; error: any | null };
    try {
      response = await fetchPage(from, to);
    } catch (err: any) {
      errorResult = err instanceof Error ? err : new Error(String(err || "Unknown query failure"));
      isComplete = false;
      break;
    }

    if (response.error) {
      errorResult =
        response.error instanceof Error
          ? response.error
          : new Error(response.error.message || String(response.error));
      isComplete = false;
      break;
    }

    const rows = response.data || [];
    pagesFetched += 1;

    // Deduplicate and accumulate
    for (const item of rows) {
      const rawId = getId
        ? getId(item)
        : (item as any)?.appointment_id ?? (item as any)?.id;

      if (rawId !== undefined && rawId !== null && String(rawId).trim() !== "") {
        const idKey = String(rawId).trim();
        if (seenIds.has(idKey)) {
          // Skip duplicate record across pages
          continue;
        }
        seenIds.add(idKey);
      }
      accumulated.push(item);
    }

    // Stop condition:
    // If rows returned is less than the requested page size, we have reached the last page!
    if (rows.length < pageSize) {
      isComplete = true;
      break;
    }

    // Continue to next page
    offset += pageSize;
  }

  return {
    data: accumulated,
    isComplete,
    error: errorResult,
    totalFetched: accumulated.length,
    pagesFetched,
  };
}

/**
 * Fetches all clinic appointments from Supabase using paginated .range(from, to) calls.
 */
export async function fetchAllClinicAppointments(
  supabaseClient: any,
  clinicId: string | number,
  options?: {
    pageSize?: number;
    isCancelled?: () => boolean;
  }
): Promise<PaginatedFetchResult<any>> {
  return fetchAllPaginatedRecords({
    pageSize: options?.pageSize ?? DEFAULT_PAGE_SIZE,
    isCancelled: options?.isCancelled,
    fetchPage: async (from, to) => {
      const res = await supabaseClient
        .from("patient_appointment")
        .select(CLINIC_APPOINTMENTS_SELECT_PROJECTION)
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: false })
        .range(from, to);

      return {
        data: res.data,
        error: res.error,
      };
    },
  });
}

