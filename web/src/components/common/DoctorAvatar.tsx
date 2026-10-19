import React, { useState, useEffect } from "react";
import { Stethoscope } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDoctorAvatar } from "@/lib/doctorAvatarService";

export interface DoctorAvatarProps {
  doctorId?: string;
  userId?: string;
  doctor?: {
    id?: string;
    doctor_id?: string;
    user_id?: string;
    name?: string;
    doctor_name?: string;
    fullName?: string;
    photo?: string;
    photo_url?: string;
    avatar_url?: string;
  } | null;
  name?: string;
  className?: string;
  imgClassName?: string;
  fallbackClassName?: string;
  badge?: React.ReactNode;
  showBadge?: boolean;
  alt?: string;
}

const AVATAR_PALETTES = [
  "bg-blue-100 text-blue-700 border-blue-200",
  "bg-emerald-100 text-emerald-700 border-emerald-200",
  "bg-violet-100 text-violet-700 border-violet-200",
  "bg-magenta-100 text-magenta-700 border-magenta-200",
  "bg-amber-100 text-amber-700 border-amber-200",
  "bg-cyan-100 text-cyan-700 border-cyan-200",
  "bg-rose-100 text-rose-700 border-rose-200",
];

function getDoctorInitials(name?: string): string {
  if (!name || name === "Not provided") return "D";
  const cleaned = name.replace(/^(?:dr\.?|doctor)\s+/i, "").replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "D";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function getAvatarColor(nameOrId?: string): string {
  const str = nameOrId || "doctor";
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length];
}

/**
 * Reusable DoctorAvatar component that resolves the doctor's profile picture
 * from the central single source of truth, supports instant cache-busting,
 * and falls back gracefully to deterministic initials if no photo is available.
 */
export function DoctorAvatar({
  doctorId,
  userId,
  doctor,
  name,
  className = "w-10 h-10 rounded-full",
  imgClassName,
  fallbackClassName,
  badge,
  showBadge = false,
  alt,
}: DoctorAvatarProps) {
  const { avatarUrl } = useDoctorAvatar({ doctorId, userId, doctor });
  const [hasError, setHasError] = useState(false);

  // Reset error state if avatarUrl changes
  useEffect(() => {
    setHasError(false);
  }, [avatarUrl]);

  const hasExplicitName = Boolean(
    name ||
    doctor?.doctor_name ||
    doctor?.name ||
    doctor?.fullName
  );

  const resolvedName =
    name ||
    doctor?.doctor_name ||
    doctor?.name ||
    doctor?.fullName ||
    "Doctor";

  const initials = hasExplicitName ? getDoctorInitials(resolvedName) : "";
  const colorPalette = hasExplicitName
    ? getAvatarColor(resolvedName || doctorId || userId)
    : "bg-slate-100 text-slate-400 border-slate-200";

  return (
    <div className={cn("relative shrink-0 select-none overflow-hidden inline-flex items-center justify-center", className)}>
      {avatarUrl && !hasError ? (
        <img
          src={avatarUrl}
          alt={alt || resolvedName}
          onError={() => setHasError(true)}
          className={cn("w-full h-full object-cover", imgClassName)}
        />
      ) : (
        <div
          className={cn(
            "w-full h-full flex items-center justify-center font-bold text-xs uppercase border tracking-tight",
            colorPalette,
            fallbackClassName
          )}
          title={resolvedName}
        >
          {initials || <Stethoscope className="w-1/2 h-1/2 text-slate-400" />}
        </div>
      )}

      {badge ? (
        badge
      ) : showBadge ? (
        <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-blue-600 border-2 border-white flex items-center justify-center shadow-2xs">
          <Stethoscope className="w-2 h-2 text-white" />
        </span>
      ) : null}
    </div>
  );
}

export default DoctorAvatar;
