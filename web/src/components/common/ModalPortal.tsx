import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export interface ModalPortalProps {
  children: React.ReactNode;
  isOpen?: boolean;
}

/**
 * Renders modal content directly into `document.body` via React createPortal.
 * Prevents modals from being trapped by parent stacking contexts (overflow, transform, z-index),
 * and automatically locks background body scrolling while open.
 */
export function ModalPortal({ children, isOpen = true }: ModalPortalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    // Track active modal instances to safely manage body scroll lock with nested modals
    const prevCount = Number(document.body.getAttribute("data-modal-count") || "0");
    document.body.setAttribute("data-modal-count", String(prevCount + 1));
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      const remainingCount = Math.max(0, Number(document.body.getAttribute("data-modal-count") || "1") - 1);
      if (remainingCount === 0) {
        document.body.removeAttribute("data-modal-count");
        document.body.style.overflow = originalOverflow && originalOverflow !== "hidden" ? originalOverflow : "";
      } else {
        document.body.setAttribute("data-modal-count", String(remainingCount));
      }
    };
  }, [isOpen]);

  if (!mounted || !isOpen) return null;

  return createPortal(children, document.body);
}

export default ModalPortal;
