import React, { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { getSignedSkinPhotoUrl } from "@/lib/storageUtils";

interface LazySkinPhotoProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  pathOrUrl?: string | null;
  fallback?: React.ReactNode;
  onUrlResolved?: (url: string) => void;
}

/**
 * LazySkinPhoto
 * 
 * Renders a skin photo from Supabase Storage on-demand.
 * Does not generate signed URLs or download the full-resolution image
 * until this component is actually rendered in the DOM (e.g. inside an open modal).
 * Caches the signed URL so repeated renders do not trigger new Storage requests.
 */
export function LazySkinPhoto({
  pathOrUrl,
  fallback,
  onUrlResolved,
  className = "",
  alt = "Patient skin photo",
  ...props
}: LazySkinPhotoProps) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(pathOrUrl));

  useEffect(() => {
    let isMounted = true;

    if (!pathOrUrl) {
      setResolvedUrl(null);
      setLoading(false);
      return;
    }

    // Direct URL check
    if (
      pathOrUrl.startsWith("http://") ||
      pathOrUrl.startsWith("https://") ||
      pathOrUrl.startsWith("data:") ||
      pathOrUrl.startsWith("blob:")
    ) {
      setResolvedUrl(pathOrUrl);
      setLoading(false);
      onUrlResolved?.(pathOrUrl);
      return;
    }

    setLoading(true);
    getSignedSkinPhotoUrl(pathOrUrl)
      .then((url) => {
        if (isMounted) {
          setResolvedUrl(url);
          setLoading(false);
          if (url && onUrlResolved) onUrlResolved(url);
        }
      })
      .catch(() => {
        if (isMounted) {
          setResolvedUrl(null);
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [pathOrUrl, onUrlResolved]);

  if (loading) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gray-50 border border-gray-200 text-gray-400 py-8 rounded-xl ${className}`}
      >
        <Loader2 className="w-5 h-5 animate-spin text-blue-500 mb-1.5" />
        <span className="text-[11px] font-medium text-gray-500">Loading photo...</span>
      </div>
    );
  }

  if (!resolvedUrl) {
    if (fallback) return <>{fallback}</>;
    return (
      <div
        className={`flex items-center justify-center bg-gray-50 border border-dashed border-gray-200 text-gray-400 py-6 text-xs italic rounded-xl ${className}`}
      >
        No photo available
      </div>
    );
  }

  return (
    <img
      src={resolvedUrl}
      alt={alt}
      className={className}
      loading="lazy"
      {...props}
    />
  );
}
