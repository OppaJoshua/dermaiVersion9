import React, { useLayoutEffect, useEffect, useState } from "react";
import { createPortal } from "react-dom";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export interface ModalPortalProps {
  children: React.ReactNode;
  isOpen?: boolean;
}

/**
 * Renders modal content directly into `document.body` via React createPortal.
 * Prevents modals from being trapped by parent stacking contexts (overflow, transform, z-index),
 * and automatically locks background body scrolling without layout shift.
 */
export function ModalPortal({ children, isOpen = true }: ModalPortalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (!isOpen || typeof document === "undefined") return;

    // Track active modal instances to safely manage body scroll lock with nested modals
    const prevCount = Number(document.body.getAttribute("data-modal-count") || "0");
    document.body.setAttribute("data-modal-count", String(prevCount + 1));

    if (prevCount === 0) {
      const originalOverflow = document.body.style.overflow;
      const originalPaddingRight = document.body.style.paddingRight;
      document.body.setAttribute("data-orig-overflow", originalOverflow);
      document.body.setAttribute("data-orig-padding-right", originalPaddingRight);

      // Prevent horizontal page layout shift: compensate for vertical scrollbar width
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }
      document.body.style.overflow = "hidden";
    }

    return () => {
      const remainingCount = Math.max(
        0,
        Number(document.body.getAttribute("data-modal-count") || "1") - 1
      );
      if (remainingCount === 0) {
        const storedOverflow = document.body.getAttribute("data-orig-overflow") ?? "";
        const storedPadding = document.body.getAttribute("data-orig-padding-right") ?? "";

        document.body.removeAttribute("data-modal-count");
        document.body.removeAttribute("data-orig-overflow");
        document.body.removeAttribute("data-orig-padding-right");

        document.body.style.overflow = storedOverflow;
        document.body.style.paddingRight = storedPadding;
      } else {
        document.body.setAttribute("data-modal-count", String(remainingCount));
      }
    };
  }, [isOpen]);

  if (!mounted || !isOpen) return null;

  return createPortal(children, document.body);
}

export default ModalPortal;

