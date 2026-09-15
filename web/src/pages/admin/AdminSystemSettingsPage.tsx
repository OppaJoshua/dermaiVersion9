import React, { useState, useEffect } from "react";
import { AlertTriangle, Bell, Palette, CheckCircle2, User, Mail, Phone, Calendar, MapPin, UserCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";

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
  systemAlerts: boolean;
  lowConfidenceAlerts: boolean;
}

const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  siteName: "DERMAI",
  contactEmail: "support@dermai.ph",
  maintenanceMode: false,
  emailAlerts: true,
  systemAlerts: true,
  lowConfidenceAlerts: true,
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

      // 2. Fetch fresh user record from Supabase if logged in
      if (user?.id) {
        try {
          const { data, error } = await supabase
            .from("user")
            .select("full_name, email, phone")
            .eq("user_id", user.id)
            .maybeSingle();

          if (!error && data && !cancelled) {
            setAdminProfile((prev) => ({
              ...prev,
              fullName: data.full_name || prev.fullName,
              email: data.email || prev.email,
              phone: data.phone || prev.phone,
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
      // 1. Save to localStorage
      localStorage.setItem("dermai_admin_profile", JSON.stringify(adminProfile));

      // 2. Persist to Supabase if user is logged in
      if (user?.id) {
        await Promise.allSettled([
          supabase.from("user").update({
            full_name: adminProfile.fullName,
            phone: adminProfile.phone,
          }).eq("user_id", user.id),
          supabase.auth.updateUser({
            data: {
              full_name: adminProfile.fullName,
              gender: adminProfile.gender,
              birthday: adminProfile.birthday,
              district: adminProfile.district,
              address: adminProfile.address,
              avatar_url: adminProfile.profilePicture,
            },
          }),
        ]);
      }

      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    } catch (err) {
      console.error("Failed to save admin profile:", err);
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSave = () => {
    try {
      localStorage.setItem("dermai_admin_platform_settings", JSON.stringify(platformSettings));
      window.dispatchEvent(new CustomEvent("dermai_platform_settings_changed", { detail: platformSettings }));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("Failed to save platform settings:", err);
    }
  };

  const toggleItems = [
    {
      label: "Email Alerts for New Clinic Applications",
      sublabel: "Get notified when a new clinic applies for verification",
      value: platformSettings.emailAlerts,
      toggle: () => setPlatformSettings((prev) => ({ ...prev, emailAlerts: !prev.emailAlerts })),
    },
    {
      label: "System Health Alerts",
      sublabel: "Receive alerts for performance or error spikes",
      value: platformSettings.systemAlerts,
      toggle: () => setPlatformSettings((prev) => ({ ...prev, systemAlerts: !prev.systemAlerts })),
    },
    {
      label: "Low Confidence AI Scan Alerts",
      sublabel: "Alert when AI analysis confidence drops below 60%",
      value: platformSettings.lowConfidenceAlerts,
      toggle: () => setPlatformSettings((prev) => ({ ...prev, lowConfidenceAlerts: !prev.lowConfidenceAlerts })),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Admin Profile - Arranged like screenshot */}
      <div>
        <h2 className="text-2xl font-display font-bold text-gray-900 mb-1">Personal Information</h2>
        <p className="text-sm text-gray-400 mb-5">Manage your profile details and contact information.</p>
        <div className="bg-white rounded-2xl border border-gray-100 p-8">
          <form className="flex flex-col gap-0" onSubmit={e => { e.preventDefault(); handleProfileSave(); }}>
            <div className="flex flex-col md:flex-row gap-8">
              {/* Profile Picture + Upload */}
              <div className="flex flex-col items-center md:items-start w-full md:w-1/4">
                <div className="w-24 h-24 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden mb-2">
                  {adminProfile.profilePicture ? (<img src={adminProfile.profilePicture} alt="Profile" className="w-full h-full object-cover"/>) : (<UserCircle className="w-16 h-16 text-gray-300"/>)}
                </div>
                <div className="font-semibold text-gray-800 text-base mt-1">Profile Picture</div>
                <div className="flex gap-2 mt-1">
                  <label className="inline-block">
                    <input type="file" accept="image/*" onChange={handleProfilePicChange} className="hidden"/>
                    <button type="button" className="px-3 py-1.5 rounded-lg bg-white border border-magenta-100 text-magenta-700 text-xs font-semibold hover:bg-magenta-50 transition-colors">Upload New</button>
                  </label>
                  {adminProfile.profilePicture && (<button type="button" className="px-3 py-1.5 rounded-lg bg-white border border-none text-red-500 text-xs font-semibold hover:underline transition-colors" onClick={() => { setAdminProfile(p => ({ ...p, profilePicture: "" })); }}>Remove</button>)}
                </div>
              </div>
              {/* Fields - 2 columns */}
              <div className="flex-1">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                  <div>
                    <label className="flex items-center gap-1 text-xs font-semibold text-gray-400 mb-1.5"><User className="w-4 h-4 text-magenta-500"/> Full Name</label>
                    <input type="text" value={adminProfile.fullName} onChange={e => handleProfileChange("fullName", e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500"/>
                  </div>
                  <div>
                    <label className="flex items-center gap-1 text-xs font-semibold text-gray-400 mb-1.5"><Mail className="w-4 h-4 text-magenta-500"/> Email Address</label>
                    <input type="email" value={adminProfile.email} onChange={e => handleProfileChange("email", e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500"/>
                  </div>
                  <div>
                    <label className="flex items-center gap-1 text-xs font-semibold text-gray-400 mb-1.5"><Phone className="w-4 h-4 text-magenta-500"/> Contact Number</label>
                    <input type="text" value={adminProfile.phone} onChange={e => handleProfileChange("phone", e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500"/>
                  </div>
                  <div>
                    <label className="flex items-center gap-1 text-xs font-semibold text-gray-400 mb-1.5"><User className="w-4 h-4 text-magenta-500"/> Gender</label>
                    <input type="text" value={adminProfile.gender} onChange={e => handleProfileChange("gender", e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500" placeholder="Gender"/>
                  </div>
                  <div>
                    <label className="flex items-center gap-1 text-xs font-semibold text-gray-400 mb-1.5"><Calendar className="w-4 h-4 text-magenta-500"/> Birthdate</label>
                    <input type="date" value={adminProfile.birthday} onChange={e => handleProfileChange("birthday", e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500"/>
                  </div>
                  <div>
                    <label className="flex items-center gap-1 text-xs font-semibold text-gray-400 mb-1.5"><MapPin className="w-4 h-4 text-magenta-500"/> District</label>
                    <select value={adminProfile.district} onChange={e => handleProfileChange("district", e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 bg-white">
                      <option value="">Select District</option>
                      {districts.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                </div>
                <div className="mt-4">
                  <label className="flex items-center gap-1 text-xs font-semibold text-gray-400 mb-1.5"><MapPin className="w-4 h-4 text-magenta-500"/> Complete Address</label>
                  <textarea value={adminProfile.address} onChange={e => handleProfileChange("address", e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 resize-none min-h-12"/>
                </div>
              </div>
            </div>
            {/* Save Button bottom right */}
            <div className="flex justify-end mt-8 items-center gap-3">
              <button
                type="submit"
                disabled={profileSaving}
                className="px-6 py-3 rounded-xl bg-magenta-600 text-white text-base font-semibold hover:bg-magenta-700 transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50"
              >
                {profileSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5"/>}
                Save Changes
              </button>
              {profileSaved && (
                <span className="text-green-600 text-sm font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4"/> Saved to Profile!
                </span>
              )}
            </div>
          </form>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-display font-bold text-gray-900">System Settings</h1>
        <p className="text-sm text-gray-400 mt-0.5">Configure platform settings and behavior</p>
      </div>

      {platformSettings.maintenanceMode && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0"/>
          <div>
            <p className="text-sm font-semibold text-amber-800">Maintenance Mode is Active</p>
            <p className="text-xs text-amber-600">
              Users will see a maintenance page when visiting the platform.
            </p>
          </div>
        </div>
      )}

      {/* Maintenance Mode */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-500 flex items-center justify-center">
            <AlertTriangle className="w-4 h-4"/>
          </div>
          <div>
            <h3 className="font-display font-bold text-gray-900">Maintenance Mode</h3>
            <p className="text-xs text-gray-400">Temporarily disable platform access for users</p>
          </div>
        </div>
        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
          <div>
            <p className="text-sm font-semibold text-gray-700">Enable Maintenance Mode</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Users will be redirected to a maintenance page
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPlatformSettings((prev) => ({ ...prev, maintenanceMode: !prev.maintenanceMode }))}
            className={cn(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer",
              platformSettings.maintenanceMode ? "bg-amber-500" : "bg-gray-200"
            )}
          >
            <span
              className={cn(
                "absolute h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                platformSettings.maintenanceMode ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </div>
      </div>

      {/* Platform Branding */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-magenta-50 text-magenta-500 flex items-center justify-center">
            <Palette className="w-4 h-4"/>
          </div>
          <div>
            <h3 className="font-display font-bold text-gray-900">Platform Settings</h3>
            <p className="text-xs text-gray-400">Basic branding and contact configuration</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">
              Platform Name
            </label>
            <input
              type="text"
              value={platformSettings.siteName}
              onChange={(e) => setPlatformSettings((prev) => ({ ...prev, siteName: e.target.value }))}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">
              Support Email
            </label>
            <input
              type="email"
              value={platformSettings.contactEmail}
              onChange={(e) => setPlatformSettings((prev) => ({ ...prev, contactEmail: e.target.value }))}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 outline-none focus:border-magenta-500 bg-white"
            />
          </div>
        </div>
      </div>

      {/* Notification Settings */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center">
            <Bell className="w-4 h-4"/>
          </div>
          <div>
            <h3 className="font-display font-bold text-gray-900">Notification Settings</h3>
            <p className="text-xs text-gray-400">Configure admin alert preferences</p>
          </div>
        </div>
        <div className="space-y-3">
          {toggleItems.map((item) => (
            <div key={item.label} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
              <div>
                <p className="text-sm font-semibold text-gray-700">{item.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{item.sublabel}</p>
              </div>
              <button
                type="button"
                onClick={item.toggle}
                className={cn(
                  "relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 cursor-pointer",
                  item.value ? "bg-magenta-500" : "bg-gray-200"
                )}
              >
                <span
                  className={cn(
                    "absolute h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                    item.value ? "translate-x-6" : "translate-x-1"
                  )}
                />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Save Settings Button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          className="px-6 py-2.5 rounded-full bg-magenta-500 text-white font-semibold text-sm hover:bg-magenta-600 transition-colors shadow-md shadow-magenta-500/20 active:scale-[0.96] cursor-pointer"
        >
          Save Settings
        </button>
        {saved && (
          <div className="flex items-center gap-1.5 text-emerald-600 text-sm font-medium">
            <CheckCircle2 className="w-4 h-4"/>
            Settings saved successfully
          </div>
        )}
      </div>
    </div>
  );
}
