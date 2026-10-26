import { supabase } from "./supabaseClient";
import { resolveCebuMunicipality } from "./cebuMunicipalities";
import { summarizePlatformScanGroups, type PlatformScanGroup, type PlatformScanSummary } from "./skinConditionDistribution";

/** Admin aggregation over all patient scan history.
 * Option A: Calls Postgres function (RPC) get_cebu_skin_condition_distribution() with SECURITY DEFINER.
 * Option B: Safely joins scan data with patient profile locations with error catching & fallback logic.
 */
export async function fetchCebuSkinConditionDistribution(): Promise<PlatformScanSummary> {
  // Option A: Try RPC get_cebu_skin_condition_distribution
  try {
    const { data, error } = await supabase.rpc("get_cebu_skin_condition_distribution");
    if (!error && Array.isArray(data)) {
      return summarizePlatformScanGroups(data as PlatformScanGroup[]);
    }
  } catch (rpcErr) {
    console.warn("RPC get_cebu_skin_condition_distribution error, trying fallback:", rpcErr);
  }

  // Fallback to legacy RPC get_admin_skin_scan_distribution if present
  try {
    const { data, error } = await supabase.rpc("get_admin_skin_scan_distribution");
    if (!error && Array.isArray(data)) {
      return summarizePlatformScanGroups(data as PlatformScanGroup[]);
    }
  } catch (legacyErr) {
    console.warn("RPC get_admin_skin_scan_distribution error:", legacyErr);
  }

  // Option B: Safely join ai_scan_result / ai_skin_analysis with patient/user profile locations
  try {
    let rawScans: any[] | null = null;

    // 1. Attempt query on ai_scan_result
    const { data: scanData, error: scanErr } = await supabase
      .from("ai_scan_result")
      .select(`
        analysis_id,
        condition_id,
        user_id,
        skin_condition:condition_id ( name ),
        patient:user_id ( district, address, role )
      `);

    if (!scanErr && scanData) {
      rawScans = scanData;
    } else {
      // 2. Fallback attempt on ai_skin_analysis
      const { data: altData, error: altErr } = await supabase
        .from("ai_skin_analysis")
        .select(`
          analysis_id,
          condition_id,
          user_id,
          skin_condition:condition_id ( name ),
          patient:user_id ( district, address, role )
        `);
      if (!altErr && altData) {
        rawScans = altData;
      }
    }

    if (rawScans) {
      const groupedMap = new Map<string, { district: string | null; address: string | null; condition: string | null; scan_count: number }>();

      for (const row of rawScans) {
        const patient = Array.isArray(row.patient) ? row.patient[0] : row.patient;
        const cond = Array.isArray(row.skin_condition) ? row.skin_condition[0] : row.skin_condition;

        const district = patient?.district ?? null;
        const address = patient?.address ?? null;
        const condition = cond?.name ?? null;

        const key = `${district ?? ""}:::${address ?? ""}:::${condition ?? ""}`;
        const existing = groupedMap.get(key) ?? {
          district,
          address,
          condition,
          scan_count: 0,
        };
        existing.scan_count += 1;
        groupedMap.set(key, existing);
      }

      return summarizePlatformScanGroups(Array.from(groupedMap.values()));
    }
  } catch (directQueryErr) {
    console.warn("Direct scan join fallback query failed:", directQueryErr);
  }

  throw new Error("Unable to retrieve scan data from Supabase");
}

export const fetchSkinConditionData = fetchCebuSkinConditionDistribution;


export type CebuScanCountSummary = {
  counts: Record<string, number>;
  totalInCebu: number;
  unmappedCount: number;
  totalScans: number;
};

/**
 * Fetches dynamic Cebu scan counts per municipality.
 * 1. Queries all scan records across all patients (Option A RPC with fallback to Option B direct join).
 * 2. Resolves each patient's exact Cebu municipality from profiles / addresses.
 * 3. Scans without a verified municipality are cleanly excluded from municipality mapping rather than defaulted to Cebu City.
 */
export async function fetchCebuAnalysisMapData(): Promise<CebuScanCountSummary> {
  const counts: Record<string, number> = {};
  let totalInCebu = 0;
  let unmappedCount = 0;
  let totalScans = 0;

  // Option A: Try RPC get_cebu_skin_condition_distribution first
  try {
    const { data: rpcData, error: rpcErr } = await supabase.rpc("get_cebu_skin_condition_distribution");
    if (!rpcErr && Array.isArray(rpcData) && rpcData.length > 0) {
      for (const group of rpcData) {
        const count = Number(group.scan_count) || 0;
        totalScans += count;
        const municipality = resolveCebuMunicipality(group.district ?? null, group.address ?? null);
        if (municipality) {
          counts[municipality] = (counts[municipality] ?? 0) + count;
          totalInCebu += count;
        } else {
          unmappedCount += count;
        }
      }
      return { counts, totalInCebu, unmappedCount, totalScans };
    }
  } catch (err) {
    console.warn("RPC in fetchCebuAnalysisMapData failed, trying direct join:", err);
  }

  // Option B: Direct query across all patient scans joining user profile / addresses
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    let rows: any[] | null = null;

    // 1. Try ai_scan_result
    const { data: scanData, error: scanErr } = await supabase
      .from("ai_scan_result")
      .select("analysis_id, user_id, patient:user_id(district, address, role)")
      .order("analysis_id")
      .range(offset, offset + pageSize - 1);

    if (!scanErr && scanData) {
      rows = scanData;
    } else {
      // 2. Try ai_skin_analysis
      const { data: altData, error: altErr } = await supabase
        .from("ai_skin_analysis")
        .select("analysis_id, user_id, patient:user_id(district, address, role)")
        .order("analysis_id")
        .range(offset, offset + pageSize - 1);
      if (!altErr && altData) {
        rows = altData;
      }
    }

    if (!rows) break;

    for (const scan of rows) {
      totalScans += 1;
      const patient = Array.isArray(scan.patient) ? scan.patient[0] : scan.patient;
      const district = patient?.district ?? (patient as any)?.municipality ?? null;
      const address = patient?.address ?? (patient as any)?.city ?? null;

      const municipality = resolveCebuMunicipality(district, address);
      if (municipality) {
        counts[municipality] = (counts[municipality] ?? 0) + 1;
        totalInCebu += 1;
      } else {
        unmappedCount += 1;
      }
    }

    if (rows.length < pageSize) break;
  }

  return { counts, totalInCebu, unmappedCount, totalScans };
}

export async function fetchCebuScanCounts(): Promise<Record<string, number>> {
  const summary = await fetchCebuAnalysisMapData();
  return summary.counts;
}


export type ScanActivity = {
  id: string;
  action: string;
  user: string;
  timestamp: string;
  time: string;
  type: "Scan";
};

export async function fetchRecentScanActivity(): Promise<ScanActivity[]> {
  const { data, error } = await supabase
    .from("system_audit_log")
    .select("log_id, action, timestamp, performer_name, patient:user_id(full_name)")
    .eq("user_type", "patient")
    .in("action", ["AI Skin Scan Submitted", "AI Skin Scan Completed"])
    .order("timestamp", { ascending: false })
    .order("log_id", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []).map(log => {
    const patient = Array.isArray(log.patient) ? log.patient[0] : log.patient;
    return {
      id: log.log_id,
      action: log.action,
      user: patient?.full_name || log.performer_name || "Unknown patient",
      timestamp: log.timestamp,
      time: new Date(log.timestamp).toLocaleTimeString("en-PH", {
        hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila",
      }),
      type: "Scan",
    };
  });
}
