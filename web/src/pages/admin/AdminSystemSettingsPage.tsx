import React, { useState, useEffect, useRef } from "react";
import { UserCircle, Loader2 } from "lucide-react";
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

export interface PlatformSettings {
  siteName: string;
  contactEmail: string;
}

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  siteName: "DERMAI",
  contactEmail: "support@dermai.ph",
};

const inputClass =
  "w-full px-3.5 py-2.5 rounded-md border border-gray-300 text-sm text-black placeholder:text-gray-500 outline-none focus:border-magenta-500 focus:ring-2 focus:ring-magenta-500/15 bg-white";
const labelClass = "block text-sm font-medium text-black mb-1.5";

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

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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



  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-display font-bold text-black">System Settings</h1>
        <p className="text-sm text-gray-600 mt-1">Manage your profile details and contact information.</p>
      </div>

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


    </div>
  );
}
