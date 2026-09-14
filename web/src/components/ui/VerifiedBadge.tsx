import React from "react";
import { cn } from "@/lib/utils";

interface VerifiedBadgeProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  className?: string;
  title?: string;
}

export function VerifiedBadge({
  size = 16,
  className,
  title = "Verified Clinic",
  ...props
}: VerifiedBadgeProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-label={title}
      title={title}
      className={cn("inline-block shrink-0 align-middle select-none", className)}
      {...props}
    >
      {/* 12-point smooth scalloped rosette */}
      <path
        fill="#1D9BF0"
        d="M22.5 12.5c0-1.58-.8-3.05-2.1-3.95.3-1.6-.1-3.25-1.2-4.35s-2.75-1.5-4.35-1.2c-.9-1.3-2.37-2.1-3.95-2.1s-3.05.8-3.95 2.1c-1.6-.3-3.25.1-4.35 1.2s-1.5 2.75-1.2 4.35c-1.3.9-2.1 2.37-2.1 3.95s.8 3.05 2.1 3.95c-.3 1.6.1 3.25 1.2 4.35s2.75 1.5 4.35 1.2c.9 1.3 2.37 2.1 3.95 2.1s3.05-.8 3.95-2.1c1.6.3 3.25-.1 4.35-1.2s1.5-2.75 1.2-4.35c1.3-.9 2.1-2.37 2.1-3.95z"
      />
      {/* Crisp White Checkmark */}
      <path
        fill="#FFFFFF"
        d="M10.2 16.2l-3.5-3.5 1.4-1.4 2.1 2.1 5.7-5.7 1.4 1.4-7.1 7.1z"
      />
    </svg>
  );
}

export default VerifiedBadge;
