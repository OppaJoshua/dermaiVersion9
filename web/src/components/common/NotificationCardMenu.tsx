import React, { useState, useRef, useEffect } from "react";
import { MoreVertical, Trash2 } from "lucide-react";
import { isPhaseAMigrationDeployed } from "@/lib/notificationService";

interface NotificationCardMenuProps {
  notificationId: string;
  metadata?: Record<string, any>;
  onDelete: (id: string, metadata?: Record<string, any>) => Promise<any> | void;
  className?: string;
}

export function NotificationCardMenu({
  notificationId,
  metadata,
  onDelete,
  className = "",
}: NotificationCardMenuProps) {
  // Explicit Backend Compatibility Feature Gate:
  // Phase A has not been deployed to production Supabase yet.
  // Gated to prevent exposing non-functional UI or unmigrated DB calls in production.
  if (!isPhaseAMigrationDeployed()) {
    return null;
  }

  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent | TouchEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isOpen]);

  const handleDeleteClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isDeleting) return;

    try {
      setIsDeleting(true);
      setIsOpen(false);
      await onDelete(notificationId, metadata);
    } catch (err) {
      console.error("[NotificationCardMenu] Delete failed:", err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      ref={menuRef}
      className={`relative inline-block text-left shrink-0 ${className}`}
      onClick={(e) => {
        // Prevent clicking inside menu wrapper from triggering card navigation
        e.stopPropagation();
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setIsOpen((prev) => !prev);
        }}
        className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-magenta-500/20"
        aria-label="Notification actions"
        title="More options"
        disabled={isDeleting}
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>

      {isOpen && (
        <div
          className="absolute right-0 top-full mt-1 z-50 min-w-[110px] bg-white rounded-lg shadow-md border border-gray-200 py-1 animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={handleDeleteClick}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer font-medium text-left"
          >
            <Trash2 className="w-3.5 h-3.5 shrink-0" />
            <span>Delete</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default NotificationCardMenu;

