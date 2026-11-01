import { supabase } from "./supabaseClient";

/**
 * Fetch an admin preference or configuration from the Supabase system_setting table,
 * with fallbacks to user_metadata and localStorage.
 */
export async function getAdminSetting<T = any>(
  key: string,
  defaultValue: T
): Promise<T> {
  // 1. Try querying the database system_setting table
  try {
    const { data, error } = await supabase
      .from("system_setting")
      .select("value")
      .eq("key", key)
      .maybeSingle();

    if (!error && data !== null && data !== undefined) {
      return data.value as T;
    }
  } catch (err) {
    console.warn(`[settingsService] DB lookup for ${key} failed, falling back:`, err);
  }

  // 2. Fallback to auth user metadata if authenticated
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const metaVal = session?.user?.user_metadata?.[key];
    if (metaVal !== undefined) return metaVal as T;
  } catch {}

  // 3. Fallback to localStorage
  try {
    const raw = localStorage.getItem("dermai_admin_platform_settings");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.[key] !== undefined) {
        return parsed[key] as T;
      }
    }
  } catch {}

  return defaultValue;
}

/**
 * Update an admin setting in the Supabase system_setting table,
 * syncs to user_metadata and localStorage, and broadcasts an event.
 */
export async function updateAdminSetting<T = any>(
  key: string,
  value: T
): Promise<{ success: boolean; error?: string }> {
  // 1. Upsert into system_setting table
  try {
    const { error } = await supabase
      .from("system_setting")
      .upsert(
        {
          key,
          value,
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
          [key]: value,
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
    settings[key] = value;
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
