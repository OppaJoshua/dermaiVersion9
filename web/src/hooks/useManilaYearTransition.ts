import { useState, useEffect, useRef, useCallback } from "react";
import { getManilaNowParts } from "@/lib/schedulingService";

/**
 * Hook to manage the active and selected calendar year strictly in Asia/Manila (UTC+8).
 * Ensures:
 * 1. Automatically initializes to the current calendar year in Philippine Time.
 * 2. An already-open dashboard detects when the year rolls over on Jan 1 midnight and
 *    automatically transitions to the new year (starting at ₱0.00).
 * 3. Manual historical year selection (e.g. user selected 2025) is NEVER accidentally overwritten.
 * 4. Periodic check (every 60s) + window focus check to handle long-running background tabs.
 */
export function useManilaYearTransition(initialYear?: number) {
  const [currentManilaYear, setCurrentManilaYear] = useState<number>(
    () => initialYear ?? getManilaNowParts().year
  );
  const [selectedRevenueYear, setSelectedRevenueYearState] = useState<number>(
    () => initialYear ?? getManilaNowParts().year
  );

  // Tracks whether the user explicitly selected a historical year
  const isHistoricalSelectionRef = useRef<boolean>(false);

  useEffect(() => {
    function checkYearRollover() {
      const latestManilaYear = getManilaNowParts().year;
      setCurrentManilaYear((prev) => {
        if (latestManilaYear !== prev) {
          // If the user was viewing the active year, automatically roll over to the new year
          if (!isHistoricalSelectionRef.current) {
            setSelectedRevenueYearState(latestManilaYear);
          }
          return latestManilaYear;
        }
        return prev;
      });
    }

    const timer = setInterval(checkYearRollover, 60000);
    window.addEventListener("focus", checkYearRollover);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", checkYearRollover);
    };
  }, []);

  const setSelectedRevenueYear = useCallback((year: number) => {
    setSelectedRevenueYearState(year);
    const nowYear = getManilaNowParts().year;
    // If the user explicitly selects a past/future year different from current, flag as historical
    isHistoricalSelectionRef.current = year !== nowYear;
  }, []);

  return {
    currentManilaYear,
    selectedRevenueYear,
    setSelectedRevenueYear,
  };
}

