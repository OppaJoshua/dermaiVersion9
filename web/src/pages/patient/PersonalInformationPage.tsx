import React, { useState, useEffect } from "react";
import { User, Mail, Phone, Calendar, MapPin, Save, UserCircle } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabaseClient";

interface UserProfile {
  fullName: string;
  email: string;
  contactNumber: string;
  gender: string;
  birthdate: string;
  district: string;
  address: string;
  profilePicture?: string;
}

const cebuDistricts = [
  "Cebu City",
  "Mandaue City",
  "Lapu-Lapu City",
  "Talisay City",
  "Consolacion",
  "Liloan",
  "Minglanilla",
  "Naga City",
  "Carcar City",
  "Danao City",
  "Toledo City",
  "Other",
];

const EMPTY_PROFILE: UserProfile = {
  fullName: "",
  email: "",
  contactNumber: "",
  gender: "",
  birthdate: "",
  district: "",
  address: "",
  profilePicture: undefined,
};

export default function PatientPersonalInformation() {
  const { session, user: _authUser } = useAuth();
  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadUserProfile() {
      if (!session?.user) {
        setIsLoading(false);
        return;
      }

      const email = session.user.email || "";
      const meta = session.user.user_metadata || {};
      const fallbackName = meta.full_name || meta.name || email.split("@")[0] || "";
      const fallbackPicture = meta.avatar_url || meta.picture || undefined;

      try {
        const { data: dbUser, error: _error } = await supabase
          .from("user")
          .select("full_name, email")
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (cancelled) return;

        // Try to read local stored extended profile info (contact, gender, birthdate, district, address)
        const localSaved = localStorage.getItem(`derm_profile_${session.user.id}`);
        const parsed = localSaved ? JSON.parse(localSaved) : {};

        setProfile({
          fullName: dbUser?.full_name || fallbackName,
          email: dbUser?.email || email,
          contactNumber: parsed.contactNumber || "",
          gender: parsed.gender || "",
          birthdate: parsed.birthdate || "",
          district: parsed.district || "",
          address: parsed.address || "",
          profilePicture: parsed.profilePicture || fallbackPicture,
        });
      } catch (err) {
        console.error("Error loading profile:", err);
        if (!cancelled) {
          setProfile((prev) => ({
            ...prev,
            email,
            fullName: fallbackName,
            profilePicture: fallbackPicture,
          }));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadUserProfile();

    return () => {
      cancelled = true;
    };
  }, [session]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setProfile((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 1024 * 1024 * 2) {
      setMessage({ type: "error", text: "Image size should be less than 2MB" });
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setProfile((prev) => ({ ...prev, profilePicture: reader.result as string }));
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage(null);

    try {
      if (session?.user) {
        // 1. Update user full_name in Supabase public.user
        const { error: dbError } = await supabase
          .from("user")
          .update({ full_name: profile.fullName })
          .eq("user_id", session.user.id);

        if (dbError) {
          console.warn("Could not update public.user:", dbError);
        }

        // 2. Persist extended profile details locally for this user
        localStorage.setItem(
          `derm_profile_${session.user.id}`,
          JSON.stringify({
            fullName: profile.fullName,
            contactNumber: profile.contactNumber,
            gender: profile.gender,
            birthdate: profile.birthdate,
            district: profile.district,
            address: profile.address,
            profilePicture: profile.profilePicture,
          })
        );

        // 3. Try to sync metadata to Supabase auth user
        try {
          await supabase.auth.updateUser({
            data: {
              full_name: profile.fullName,
            },
          });
        } catch {
          // ignore
        }

        // 4. Notify layout and any listeners immediately
        window.dispatchEvent(new Event("derm_profile_updated"));
        window.dispatchEvent(new Event("storage"));
      }

      setMessage({ type: "success", text: "Profile updated successfully!" });
    } catch {
      setMessage({ type: "error", text: "Something went wrong while saving. Please try again." });
    } finally {
      setIsSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8 flex items-center justify-center min-h-75">
        <div className="w-8 h-8 border-2 border-magenta-200 border-t-magenta-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Personal Information</h1>
        <p className="text-gray-500 text-sm mt-1">Manage your profile details and contact information.</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
      >
        <div className="p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Profile Picture Upload Section */}
            <div className="flex flex-col sm:flex-row items-center gap-6 pb-6 border-b border-gray-100">
              <div className="relative group">
                <div className="w-24 h-24 rounded-full ring-4 ring-magenta-50 overflow-hidden bg-gray-100 flex items-center justify-center">
                  {profile.profilePicture ? (
                    <img
                      src={profile.profilePicture}
                      alt="Profile"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <UserCircle className="w-12 h-12 text-gray-300" />
                  )}
                </div>
                <label className="absolute inset-0 flex items-center justify-center bg-black/40 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                  <span className="text-xs font-medium">Change</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Profile Picture</h3>
                <p className="text-sm text-gray-500 mb-2">PNG, JPG or GIF. Max 2MB.</p>
                <div className="flex gap-2">
                  <label className="cursor-pointer bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors inline-block">
                    Upload New
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </label>
                  {profile.profilePicture && (
                    <button
                      type="button"
                      onClick={() => setProfile((prev) => ({ ...prev, profilePicture: undefined }))}
                      className="text-red-500 hover:text-red-600 px-4 py-2 text-sm font-medium transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Full Name */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <User className="w-4 h-4 text-magenta-500" />
                  Full Name
                </label>
                <input
                  type="text"
                  name="fullName"
                  value={profile.fullName}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all"
                  placeholder="Enter your full name"
                />
              </div>

              {/* Email (Reflected from Google Login / Supabase Auth) */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <Mail className="w-4 h-4 text-magenta-500" />
                  Email Address
                  <span className="text-[11px] text-gray-400 font-normal">(Linked to your account)</span>
                </label>
                <input
                  type="email"
                  name="email"
                  value={profile.email}
                  disabled
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 bg-gray-50 cursor-not-allowed"
                  placeholder="name@example.com"
                />
              </div>

              {/* Contact Number */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <Phone className="w-4 h-4 text-magenta-500" />
                  Contact Number
                </label>
                <input
                  type="tel"
                  name="contactNumber"
                  value={profile.contactNumber}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all"
                  placeholder="e.g. 09123456789"
                />
              </div>

              {/* Gender */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <UserCircle className="w-4 h-4 text-magenta-500" />
                  Gender
                </label>
                <select
                  name="gender"
                  value={profile.gender}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all appearance-none bg-white"
                >
                  <option value="">Select Gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Non-binary">Non-binary</option>
                  <option value="Prefer not to say">Prefer not to say</option>
                </select>
              </div>

              {/* Birthdate */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-magenta-500" />
                  Birthdate
                </label>
                <input
                  type="date"
                  name="birthdate"
                  value={profile.birthdate}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all"
                />
              </div>

              {/* District */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-magenta-500" />
                  District
                </label>
                <select
                  name="district"
                  value={profile.district}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all appearance-none bg-white"
                >
                  <option value="">Select District</option>
                  {cebuDistricts.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              {/* Address */}
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-magenta-500" />
                  Complete Address
                </label>
                <textarea
                  name="address"
                  value={profile.address}
                  onChange={handleChange}
                  rows={3}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-magenta-500/20 focus:border-magenta-500 transition-all resize-none"
                  placeholder="Street, City, Province, ZIP"
                />
              </div>
            </div>

            {message && (
              <div className={`p-4 rounded-xl text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
                {message.text}
              </div>
            )}

            <div className="flex justify-end pt-4 border-t border-gray-100">
              <button
                type="submit"
                disabled={isSaving}
                className="flex items-center gap-2 bg-magenta-600 hover:bg-magenta-700 disabled:bg-magenta-300 text-white font-semibold px-8 py-3 rounded-xl transition-all shadow-md shadow-magenta-500/20 cursor-pointer"
              >
                {isSaving ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </div>
  );
}