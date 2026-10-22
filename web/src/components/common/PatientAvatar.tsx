import { useState, useEffect } from "react";
import { User } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { resolveAvatarUrl, getPatientAvatarUrl } from "@/lib/avatarUrlResolver";

export { getPatientAvatarUrl };

export interface PatientAvatarProps {
  name?: string;
  fullName?: string;
  photoUrl?: string | null;
  avatarUrl?: string | null;
  userId?: string;
  className?: string;
  sizeClass?: string;
  borderClass?: string;
  imgClassName?: string;
  fallbackClassName?: string;
  alt?: string;
}

const PATIENT_PALETTES = [
  "bg-pink-100 text-[#c0166a] border-pink-200",
  "bg-purple-100 text-purple-700 border-purple-200",
  "bg-rose-100 text-rose-700 border-rose-200",
  "bg-indigo-100 text-indigo-700 border-indigo-200",
  "bg-emerald-100 text-emerald-700 border-emerald-200",
  "bg-sky-100 text-sky-700 border-sky-200",
  "bg-amber-100 text-amber-700 border-amber-200",
];

function getPalette(seed?: string): string {
  const str = seed || "patient";
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PATIENT_PALETTES[Math.abs(hash) % PATIENT_PALETTES.length];
}

/**
 * Universal PatientAvatar component that resolves storage paths,
 * handles authentic profile pictures from Google/Supabase, and provides
 * a smooth initials fallback on load errors or missing pictures.
 *
 * Supports both:
 * - <PatientAvatar fullName={name} avatarUrl={url} />
 * - <PatientAvatar name={name} photoUrl={url} userId={userId} />
 */
export function PatientAvatar({
  name,
  fullName,
  photoUrl,
  avatarUrl,
  userId,
  className = "w-10 h-10 rounded-full",
  sizeClass,
  borderClass,
  imgClassName,
  fallbackClassName,
  alt,
}: PatientAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const [asyncAvatar, setAsyncAvatar] = useState<string | null>(null);

  const rawInput = avatarUrl || photoUrl;
  const directResolved = getPatientAvatarUrl(rawInput) || resolveAvatarUrl(rawInput) || null;
  const resolvedSrc = directResolved || asyncAvatar;

  // Reset error state when the resolved URL changes
  useEffect(() => {
    setImgError(false);
  }, [resolvedSrc]);

  // Dynamic fallback: If no avatar URL was passed in props but userId is present,
  // fetch the avatar from user profile so future bookings auto-adapt dynamically.
  useEffect(() => {
    if (directResolved || !userId) return;

    let isMounted = true;
    const fetchAvatar = async () => {
      try {
        const { data } = await supabase
          .from("user")
          .select("avatar_url")
          .eq("user_id", userId)
          .maybeSingle();

        if (isMounted && data?.avatar_url) {
          const resolved = getPatientAvatarUrl(data.avatar_url);
          if (resolved) setAsyncAvatar(resolved);
        }
      } catch (err: unknown) {
        console.warn("[PatientAvatar] Failed to fetch patient avatar for userId:", userId, err);
      }
    };

    fetchAvatar();

    return () => {
      isMounted = false;
    };
  }, [directResolved, userId]);

  const displayName = fullName || name || "Patient";

  // Calculate 1-2 letter initials (handles "Oledan, Juliana" -> "OJ", "Jonathan Bayutas" -> "JB")
  const initials = displayName
    ? displayName
        .replace(/^(?:dr\.?|doctor)\s+/i, "")
        .replace(/[,\s]+/g, " ")
        .trim()
        .split(" ")
        .filter(Boolean)
        .map((n) => n[0])
        .join("")
        .substring(0, 2)
        .toUpperCase()
    : "PT";

  const palette = getPalette(displayName || userId);

  return (
    <div
      className={cn(
        "relative shrink-0 select-none overflow-hidden inline-flex items-center justify-center rounded-full",
        sizeClass || className,
        borderClass
      )}
    >
      {resolvedSrc && !imgError ? (
        <img
          src={resolvedSrc}
          alt={alt || displayName}
          onError={() => setImgError(true)}
          className={cn("w-full h-full object-cover rounded-full", imgClassName)}
        />
      ) : (
        <div
          className={cn(
            "w-full h-full rounded-full flex items-center justify-center font-bold text-xs uppercase border tracking-tight",
            palette,
            fallbackClassName
          )}
          title={displayName}
        >
          {initials || <User className="w-1/2 h-1/2 text-gray-400" />}
        </div>
      )}
    </div>
  );
}

export default PatientAvatar;
