import React, { useState, useEffect, useRef } from "react";
import { AlertTriangle, UserCircle, Loader2, ShieldAlert, CheckCircle2, AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import { dispatchSystemMaintenanceAlert } from "@/lib/notificationService";
import {
  getAdminNotificationPreference,
  updateAdminNotificationPreference,
  PREF_EMAIL_ALERTS_NEW_CLINIC,
} from "@/lib/settingsService";

const districts = [
  "Cebu City",
  "Mandaue City",
  "Lapu-Lapu City",
  "Talisay City",
  "Minglanilla",
  "Consolacion",
  "Naga City",
  "Danao City",
  "Carcar City",
  "Other",
];

interface PlatformSettings {
  siteName: string;
  contactEmail: string;
  maintenanceMode: boolean;
  emailAlerts: boolean;
}

const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  siteName: "DERMAI",
  contactEmail: "support@dermai.ph",
  maintenanceMode: false,
  emailAlerts: true,
};

function getSavedPlatformSettings(): PlatformSettings {
  try {
    const raw = localStorage.getItem("dermai_admin_platform_settings");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return { ...DEFAULT_PLATFORM_SETTINGS, ...parsed };
      }
    }
  } catch { }
  return DEFAULT_PLATFORM_SETTINGS;
}

const inputClass =
  "w-full px-3.5 py-2.5 rounded-md border border-gray-300 text-sm text-black placeholder:text-gray-500 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/15 bg-white";
const labelClass = "block text-sm font-medium text-black mb-1.5";

function Toggle({
  on,
  onClick,
  disabled,
  loading,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-pressed={on}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        on ? "bg-magenta-600" : "bg-gray-300"
      )}
    >
      <span
        className={cn(
          "absolute h-4 w-4 rounded-full bg-white shadow-sm transition-transform flex items-center justify-center",
          on ? "translate-x-6" : "translate-x-1"
        )}
      >
        {loading && <Loader2 className="w-2.5 h-2.5 text-magenta-600 animate-spin" />}
      </span>
    </button>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-10 py-8 border-t border-gray-200 first:border-t-0 first:pt-0">
      <div>
        <h2 className="text-lg font-semibold text-black">{title}</h2>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed">{description}</p>
      </div>
      <div className="lg:col-span-2">{children}</div>
    </section>
  );
}

export default function AdminSystemSettingsPage() {
  const { user } = useAuth();

  // Admin Profile State
  const [adminProfile, setAdminProfile] = useState({
    fullName: "",
    email: "",
    phone: "",
    gender: "",
    birthday: "",
    address: "",
    district: "",
    profilePicture: "",
  });
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);

  // Platform & Notification Settings State
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings>(getSavedPlatformSettings);
  const [saved, setSaved] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Notification Preference Async Sync State
  const [isPrefLoading, setIsPrefLoading] = useState(true);
  const [isPrefUpdating, setIsPrefUpdating] = useState(false);
  const [prefToast, setPrefToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Auto-dismiss feedback toast
  useEffect(() => {
    if (!prefToast) return;
    const timer = setTimeout(() => setPrefToast(null), 3500);
    return () => clearTimeout(timer);
  }, [prefToast]);

  // Initial fetch of email alert preference from database & auth metadata
  useEffect(() => {
    let isMounted = true;
    async function syncInitialPreference() {
      setIsPrefLoading(true);
      try {
        const enabled = await getAdminNotificationPreference(PREF_EMAIL_ALERTS_NEW_CLINIC, true);
        if (isMounted) {
          setPlatformSettings((prev) => ({ ...prev, emailAlerts: enabled }));
        }
      } catch (err) {
        console.warn("[AdminSystemSettings] Failed to fetch initial notification preference:", err);
      } finally {
        if (isMounted) setIsPrefLoading(false);
      }
    }
    syncInitialPreference();
    return () => {
      isMounted = false;
    };
  }, [user]);

  const handleToggleClinicEmailAlerts = async () => {
    if (isPrefUpdating || isPrefLoading) return;

    const nextValue = !platformSettings.emailAlerts;
    // Optimistic UI update
    setPlatformSettings((prev) => ({ ...prev, emailAlerts: nextValue }));
    setIsPrefUpdating(true);

    try {
      const res = await updateAdminNotificationPreference(PREF_EMAIL_ALERTS_NEW_CLINIC, nextValue);
      if (res.success) {
        setPrefToast({
          type: "success",
          message: nextValue
            ? "Notification preferences updated: Email alerts for new clinic applications are now ENABLED."
            : "Notification preferences updated: Email alerts for new clinic applications are now DISABLED.",
        });
      } else {
        // Revert on failure
        setPlatformSettings((prev) => ({ ...prev, emailAlerts: !nextValue }));
        setPrefToast({
          type: "error",
          message: "Failed to update notification preference. Please try again.",
        });
      }
    } catch {
      setPlatformSettings((prev) => ({ ...prev, emailAlerts: !nextValue }));
      setPrefToast({
        type: "error",
        message: "An unexpected error occurred while saving your preference.",
      });
    } finally {
      setIsPrefUpdating(false);
    }
  };

  // System Maintenance Notification State
  const [maintenanceWindow, setMaintenanceWindow] = useState("Tonight from 11:00 PM to 1:00 AM PHT");
  const [estimatedDowntime, setEstimatedDowntime] = useState("1-2 hours");
  const [maintenanceInstructions, setMaintenanceInstructions] = useState(
    "Some features such as booking and online consultations may be temporarily unavailable. Please complete any active sessions."
  );
  const [dispatchingNotice, setDispatchingNotice] = useState(false);
  const [dispatchFeedback, setDispatchFeedback] = useState<string | null>(null);
  const prevMaintenanceRef = useRef(platformSettings.maintenanceMode);

  // Load Admin Profile from Supabase & localStorage on mount
  useEffect(() => {
    let cancelled = false;

    async function loadAdminData() {
      // 1. Initial pre-fill from auth and localStorage
      let localCachedProfile: any = null;
      try {
        const raw = localStorage.getItem("dermai_admin_profile");
        if (raw) localCachedProfile = JSON.parse(raw);
      } catch { }

      const meta = user?.user_metadata || {};
      const fallbackEmail = user?.email || "";
      const fallbackName = meta.full_name || meta.name || fallbackEmail.split("@")[0] || "Admin";

      if (!cancelled) {
        setAdminProfile({
          fullName: localCachedProfile?.fullName || fallbackName,
          email: fallbackEmail || localCachedProfile?.email || "",
          phone: localCachedProfile?.phone || user?.phone || "",
          gender: localCachedProfile?.gender || meta.gender || "",
          birthday: localCachedProfile?.birthday || meta.birthday || "",
          address: localCachedProfile?.address || meta.address || "",
          district: localCachedProfile?.district || meta.district || "Cebu City",
          profilePicture: localCachedProfile?.profilePicture || meta.avatar_url || "",
        });
      }

      // 2. Fetch fresh user record from Supabase (by ID or admin email)
      const targetUserId = user?.id;
      const targetEmail = user?.email || "dermaisupport@gmail.com";
      if (targetUserId || targetEmail) {
        try {
          let query = supabase
            .from("user")
            .select("full_name, email, phone, avatar_url");
          if (targetUserId) {
            query = query.or(`user_id.eq.${targetUserId},email.eq.${targetEmail}`);
          } else {
            query = query.eq("email", targetEmail);
          }
          const { data, error } = await query.maybeSingle();

          if (!error && data && !cancelled) {
            setAdminProfile((prev) => ({
              ...prev,
              fullName: data.full_name || prev.fullName,
              email: data.email || prev.email,
              phone: data.phone || prev.phone,
              profilePicture: data.avatar_url || prev.profilePicture,
            }));
          }
        } catch { }
      }
    }

    loadAdminData();
    return () => { cancelled = true; };
  }, [user]);

  const handleProfileChange = (field: string, value: string) => {
    setAdminProfile((prev) => ({ ...prev, [field]: value }));
  };

  const handleProfilePicChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onload = (ev) => {
        setAdminProfile((prev) => ({ ...prev, profilePicture: ev.target?.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleProfileSave = async () => {
    setProfileSaving(true);
    try {
      let finalAvatarUrl: string = adminProfile.profilePicture || "";

      // If user uploaded a new image file, upload to Supabase Storage "avatars" bucket
      if (selectedFile && user?.id) {
        try {
          const ext = selectedFile.name.split(".").pop() || "png";
          const filePath = `${user.id}/${Date.now()}.${ext}`;
          const { error: uploadError } = await supabase.storage
            .from("avatars")
            .upload(filePath, selectedFile, { upsert: true });

          if (!uploadError) {
            const { data: publicData } = supabase.storage
              .from("avatars")
              .getPublicUrl(filePath);
            if (publicData?.publicUrl) {
              finalAvatarUrl = publicData.publicUrl;
              setAdminProfile((prev) => ({ ...prev, profilePicture: finalAvatarUrl }));
            }
          } else {
            console.warn("Admin avatar storage upload failed:", uploadError.message);
          }
        } catch (uploadErr) {
          console.warn("Admin avatar upload error:", uploadErr);
        }
      }

      // 1. Save to localStorage
      const updatedProfile = { ...adminProfile, profilePicture: finalAvatarUrl };
      localStorage.setItem("dermai_admin_profile", JSON.stringify(updatedProfile));

      // 2. Persist to Supabase
      const targetUserId = user?.id;
      const targetEmail = user?.email || "dermaisupport@gmail.com";
      const dbUpdate = {
        full_name: adminProfile.fullName,
        phone: adminProfile.phone,
        avatar_url: finalAvatarUrl || null,
      };

      try {
        if (targetUserId) {
          await supabase.from("user").update(dbUpdate).or(`user_id.eq.${targetUserId},email.eq.${targetEmail}`);
        } else {
          await supabase.from("user").update(dbUpdate).eq("email", targetEmail);
        }
      } catch (dbErr) {
        console.warn("Error updating user record in DB:", dbErr);
      }

      if (user?.id) {
        try {
          await supabase.auth.updateUser({
            data: {
              full_name: adminProfile.fullName,
              gender: adminProfile.gender,
              birthday: adminProfile.birthday,
              district: adminProfile.district,
              address: adminProfile.address,
              avatar_url: finalAvatarUrl || null,
            },
          });
        } catch (authErr) {
          console.warn("Error updating auth metadata:", authErr);
        }
      }

      window.dispatchEvent(new CustomEvent("dermai_admin_profile_updated"));
      window.dispatchEvent(new Event("storage"));

      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    } catch (err) {
      console.error("Failed to save admin profile:", err);
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSave = async () => {
    try {
      localStorage.setItem("dermai_admin_platform_settings", JSON.stringify(platformSettings));
      window.dispatchEvent(new CustomEvent("dermai_platform_settings_changed", { detail: platformSettings }));

      // Synchronize preference to DB system_setting & user_metadata
      await updateAdminNotificationPreference(
        PREF_EMAIL_ALERTS_NEW_CLINIC,
        platformSettings.emailAlerts
      );

      const wasActive = prevMaintenanceRef.current;
      const isActive = platformSettings.maintenanceMode;
      prevMaintenanceRef.current = isActive;

      if (!wasActive && isActive) {
        setDispatchingNotice(true);
        const { recipientCount } = await dispatchSystemMaintenanceAlert({
          scheduledWindow: maintenanceWindow,
          estimatedDowntime,
          instructions: maintenanceInstructions,
          enabled: true,
        });
        setDispatchFeedback(`Maintenance alert dispatched to ${recipientCount} active accounts across Patients, Clinics, and Doctors.`);
        setDispatchingNotice(false);
      } else if (wasActive && !isActive) {
        await dispatchSystemMaintenanceAlert({
          scheduledWindow: "",
          estimatedDowntime: "",
          enabled: false,
        });
        setDispatchFeedback("Maintenance mode deactivated. Normal access restored.");
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("Failed to save platform settings:", err);
    } finally {
      setDispatchingNotice(false);
    }
  };

  const handleManualDispatchMaintenance = async () => {
    setDispatchingNotice(true);
    setDispatchFeedback(null);
    try {
      const { recipientCount } = await dispatchSystemMaintenanceAlert({
        scheduledWindow: maintenanceWindow,
        estimatedDowntime,
        instructions: maintenanceInstructions,
        enabled: true,
      });
      setDispatchFeedback(`High-priority maintenance notice dispatched to ${recipientCount} active users.`);
      setTimeout(() => setDispatchFeedback(null), 6000);
    } catch (err) {
      console.error("Manual maintenance dispatch failed:", err);
      setDispatchFeedback("Failed to dispatch maintenance alert.");
    } finally {
      setDispatchingNotice(false);
    }
  };


  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-display font-bold text-black">System Settings</h1>
        <p className="text-sm text-gray-600 mt-1">Manage your profile and configure platform settings and behavior.</p>
      </div>

      {platformSettings.maintenanceMode && (
        <div className="mb-8 border border-gray-200 border-l-4 border-l-magenta-600 rounded-md bg-white px-5 py-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-magenta-600 shrink-0 mt-0.5"/>
          <div>
            <p className="text-sm font-semibold text-black">Maintenance mode is active</p>
            <p className="text-sm text-gray-700 mt-0.5">
              Users will see a maintenance page when visiting the platform.
            </p>
          </div>
        </div>
      )}

      {/* Personal information */}
      <Section
        title="Personal information"
        description="Manage your profile details and contact information."
      >
        <div className="bg-white rounded-lg border border-gray-200">
          <form onSubmit={e => { e.preventDefault(); handleProfileSave(); }}>
            <div className="p-7 space-y-7">
              {/* Profile Picture + Upload */}
              <div className="flex items-center gap-5">
                <div className="w-24 h-24 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden shrink-0">
                  {adminProfile.profilePicture ? (
                    <img
                      src={adminProfile.profilePicture}
                      alt="Profile"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <UserCircle className="w-12 h-12 text-magenta-600" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold text-black">Profile picture</p>
                  <p className="text-sm text-gray-600 mt-0.5">JPG, PNG or GIF.</p>
                  <div className="flex items-center gap-4 mt-2.5">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleProfilePicChange}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3.5 py-2 rounded-md border border-gray-300 bg-white text-black text-sm font-medium hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      Upload new
                    </button>
                    {adminProfile.profilePicture && (
                      <button
                        type="button"
                        className="text-sm font-medium text-gray-700 hover:underline underline-offset-2 cursor-pointer"
                        onClick={() => {
                          setSelectedFile(null);
                          setAdminProfile((p) => ({ ...p, profilePicture: "" }));
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Fields - 2 columns */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                <div>
                  <label className={labelClass}>Full name</label>
                  <input type="text" value={adminProfile.fullName} onChange={e => handleProfileChange("fullName", e.target.value)} className={inputClass}/>
                </div>
                <div>
                  <label className={labelClass}>Email address</label>
                  <input type="email" value={adminProfile.email} onChange={e => handleProfileChange("email", e.target.value)} className={inputClass}/>
                </div>
                <div>
                  <label className={labelClass}>Contact number</label>
                  <input type="text" value={adminProfile.phone} onChange={e => handleProfileChange("phone", e.target.value)} className={inputClass}/>
                </div>
                <div>
                  <label className={labelClass}>Gender</label>
                  <input type="text" value={adminProfile.gender} onChange={e => handleProfileChange("gender", e.target.value)} className={inputClass} placeholder="Gender"/>
                </div>
                <div>
                  <label className={labelClass}>Birthdate</label>
                  <input type="date" value={adminProfile.birthday} onChange={e => handleProfileChange("birthday", e.target.value)} className={inputClass}/>
                </div>
                <div>
                  <label className={labelClass}>District</label>
                  <select value={adminProfile.district} onChange={e => handleProfileChange("district", e.target.value)} className={inputClass}>
                    <option value="">Select District</option>
                    {districts.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className={labelClass}>Complete address</label>
                  <textarea value={adminProfile.address} onChange={e => handleProfileChange("address", e.target.value)} className={cn(inputClass, "resize-none min-h-12")}/>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className="flex items-center justify-end gap-4 px-7 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
              {profileSaved && (
                <span className="text-sm font-medium text-magenta-700">Saved to profile</span>
              )}
              <button
                type="submit"
                disabled={profileSaving}
                className="px-5 py-2.5 rounded-md bg-magenta-600 text-white text-sm font-medium hover:bg-magenta-700 transition-colors flex items-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                {profileSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                Save changes
              </button>
            </div>
          </form>
        </div>
      </Section>

      {/* Maintenance Mode */}
      <Section
        title="Maintenance mode"
        description="Temporarily disable platform access or schedule a maintenance window with automated high-priority alerts."
      >
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
          <div className="px-7 py-6 flex items-center justify-between gap-6">
            <div>
              <p className="text-sm font-semibold text-black">Enable maintenance mode</p>
              <p className="text-sm text-gray-600 mt-0.5">
                When active, platform users will be notified and redirected to a maintenance notice.
              </p>
            </div>
            <Toggle
              on={platformSettings.maintenanceMode}
              onClick={() => setPlatformSettings((prev) => ({ ...prev, maintenanceMode: !prev.maintenanceMode }))}
            />
          </div>

          {/* Maintenance Notice Details Configuration */}
          <div className="p-7 space-y-5 bg-gray-50/50">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-600" />
              <h3 className="text-sm font-semibold text-black">High-Priority Alert Notice to All Roles</h3>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              When maintenance is scheduled or enabled, an automated high-priority system notice will be dispatched in real time to all active Patients, Clinics, and Doctors.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Scheduled Window</label>
                <input
                  type="text"
                  value={maintenanceWindow}
                  onChange={(e) => setMaintenanceWindow(e.target.value)}
                  placeholder="e.g. Tonight from 11:00 PM to 1:00 AM PHT"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Estimated Downtime</label>
                <input
                  type="text"
                  value={estimatedDowntime}
                  onChange={(e) => setEstimatedDowntime(e.target.value)}
                  placeholder="e.g. 1-2 hours"
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>Instructions &amp; Affected Features</label>
              <textarea
                value={maintenanceInstructions}
                onChange={(e) => setMaintenanceInstructions(e.target.value)}
                placeholder="Describe any instructions or temporarily unavailable features..."
                rows={2}
                className={cn(inputClass, "resize-none")}
              />
            </div>

            {dispatchFeedback && (
              <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-md text-xs font-medium text-emerald-800">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>{dispatchFeedback}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-gray-500">
                Audience: All active Patients, Clinics, and Doctors
              </span>
              <button
                type="button"
                onClick={handleManualDispatchMaintenance}
                disabled={dispatchingNotice}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                {dispatchingNotice && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{dispatchingNotice ? "Dispatching alert..." : "Dispatch Alert Now"}</span>
              </button>
            </div>
          </div>
        </div>
      </Section>

      {/* Platform Branding */}
      <Section
        title="Platform settings"
        description="Basic branding and contact configuration."
      >
        <div className="bg-white rounded-lg border border-gray-200 p-7">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className={labelClass}>Platform name</label>
              <input
                type="text"
                value={platformSettings.siteName}
                onChange={(e) => setPlatformSettings((prev) => ({ ...prev, siteName: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Support email</label>
              <input
                type="email"
                value={platformSettings.contactEmail}
                onChange={(e) => setPlatformSettings((prev) => ({ ...prev, contactEmail: e.target.value }))}
                className={inputClass}
              />
            </div>
          </div>
        </div>
      </Section>

      {/* Notification Settings */}
      <Section
        title="Notification settings"
        description="Configure admin alert preferences."
      >
        <div className="space-y-3">
          {/* Toast Notification Banner */}
          {prefToast && (
            <div
              className={cn(
                "px-4 py-3 rounded-lg border text-sm flex items-center justify-between gap-3 transition-all",
                prefToast.type === "success"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-rose-50 border-rose-200 text-rose-800"
              )}
            >
              <div className="flex items-center gap-2">
                {prefToast.type === "success" ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                )}
                <span className="font-medium text-xs sm:text-sm">{prefToast.message}</span>
              </div>
              <button
                type="button"
                onClick={() => setPrefToast(null)}
                className="text-gray-400 hover:text-gray-600 cursor-pointer p-0.5"
                aria-label="Dismiss feedback"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
            <div className="flex items-center justify-between gap-6 px-7 py-5">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-black">
                    Email Alerts for New Clinic Applications
                  </p>
                  {isPrefLoading && (
                    <span className="text-[11px] font-medium text-gray-400 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> Fetching...
                    </span>
                  )}
                  {isPrefUpdating && (
                    <span className="text-[11px] font-medium text-magenta-600 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> Updating...
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-600 mt-0.5">
                  Get notified when a new clinic applies for verification
                </p>
              </div>
              <Toggle
                on={platformSettings.emailAlerts}
                onClick={handleToggleClinicEmailAlerts}
                disabled={isPrefLoading || isPrefUpdating}
                loading={isPrefUpdating}
              />
            </div>
          </div>
        </div>
      </Section>

      {/* Save Settings Button */}
      <div className="flex items-center gap-4 pt-6 border-t border-gray-200">
        <button
          type="button"
          onClick={handleSave}
          className="px-6 py-2.5 rounded-md bg-magenta-600 text-white font-medium text-sm hover:bg-magenta-700 transition-colors cursor-pointer"
        >
          Save settings
        </button>
        {saved && (
          <span className="text-sm font-medium text-magenta-700">
            Settings saved successfully
          </span>
        )}
      </div>
    </div>
  );
}
