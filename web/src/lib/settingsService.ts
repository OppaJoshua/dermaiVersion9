import { supabase } from "./supabaseClient";

export const PREF_EMAIL_ALERTS_NEW_CLINIC = "email_alerts_new_clinic_applications";

/**
 * Fetch the admin notification preference from Supabase system_setting table,
 * with fallbacks to user_metadata and localStorage.
 */
export async function getAdminNotificationPreference(
  key: string = PREF_EMAIL_ALERTS_NEW_CLINIC,
  defaultValue: boolean = true
): Promise<boolean> {
  // 1. Try querying the database system_setting table
  try {
    const { data, error } = await supabase
      .from("system_setting")
      .select("value")
      .eq("key", key)
      .maybeSingle();

    if (!error && data !== null && data !== undefined) {
      if (typeof data.value === "boolean") return data.value;
      if (typeof data.value === "string") return data.value === "true";
      if (typeof data.value === "object" && data.value !== null) {
        return Boolean(data.value);
      }
    }
  } catch (err) {
    console.warn(`[settingsService] DB lookup for ${key} failed, falling back:`, err);
  }

  // 2. Fallback to auth user metadata if authenticated
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const metaVal = session?.user?.user_metadata?.[key];
    if (typeof metaVal === "boolean") return metaVal;
  } catch {}

  // 3. Fallback to localStorage
  try {
    const raw = localStorage.getItem("dermai_admin_platform_settings");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.emailAlerts === "boolean" && key === PREF_EMAIL_ALERTS_NEW_CLINIC) {
        return parsed.emailAlerts;
      }
      if (typeof parsed?.[key] === "boolean") {
        return parsed[key];
      }
    }
  } catch {}

  return defaultValue;
}

/**
 * Update the admin notification preference in Supabase system_setting table,
 * syncs to user_metadata and localStorage, and broadcasts an event.
 */
export async function updateAdminNotificationPreference(
  key: string = PREF_EMAIL_ALERTS_NEW_CLINIC,
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  // 1. Upsert into system_setting table
  try {
    const { error } = await supabase
      .from("system_setting")
      .upsert(
        {
          key,
          value: enabled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" }
      );

    if (error) {
      console.warn(`[settingsService] Note on system_setting upsert (${key}):`, error.message);
    }
  } catch (err: any) {
    console.warn(`[settingsService] Notice saving to system_setting table:`, err?.message || err);
  }

  // 2. Sync to auth user metadata
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) {
      await supabase.auth.updateUser({
        data: {
          [key]: enabled,
        },
      });
    }
  } catch (metaErr) {
    console.warn("[settingsService] Error syncing to user_metadata:", metaErr);
  }

  // 3. Update localStorage cache
  try {
    const raw = localStorage.getItem("dermai_admin_platform_settings");
    const settings = raw ? JSON.parse(raw) : {};
    if (key === PREF_EMAIL_ALERTS_NEW_CLINIC) {
      settings.emailAlerts = enabled;
    }
    settings[key] = enabled;
    localStorage.setItem("dermai_admin_platform_settings", JSON.stringify(settings));

    window.dispatchEvent(
      new CustomEvent("dermai_platform_settings_changed", { detail: settings })
    );
    window.dispatchEvent(new Event("storage"));
  } catch (lsErr) {
    console.warn("[settingsService] Error caching to localStorage:", lsErr);
  }

  return { success: true };
}

export interface ClinicApplicationAlertPayload {
  clinicId: string;
  clinicName: string;
  clinicEmail: string;
  clinicPhone?: string;
  specialization?: string;
  address?: string;
  submittedAt?: string;
}

/**
 * Trigger the backend alert for a new clinic application.
 * The backend Edge Function checks the admin preference guard before sending an email.
 */
export async function triggerNewClinicApplicationAlert(
  payload: ClinicApplicationAlertPayload
): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke(
      "notify-admin-clinic-application",
      {
        body: payload,
      }
    );

    if (error) {
      console.warn("[settingsService] Edge function invoke error:", error.message);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      skipped: data?.skipped === true,
    };
  } catch (err: any) {
    console.warn("[settingsService] Exception invoking clinic alert function:", err);
    return { success: false, error: err?.message || "Unknown error" };
  }
}
