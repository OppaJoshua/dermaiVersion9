import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  UserPlus,
  Trash2,
  Stethoscope,
  AlertCircle,
  CheckCircle2,
  Eye,
  X,
  Loader2,
  Upload,
  Clock,
  Calendar,
  Camera,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Plus,
  Copy,
  Users,
  Search,
  Edit3,
  ArrowLeft,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useClinicVerification } from "@/hooks/useClinicVerification";
import { supabase } from "@/lib/supabaseClient";
import { resolveAvatarUrl } from "@/lib/avatarUrlResolver";
import { logAuditEvent } from "@/utils/auditLogger";
import SpecializationMultiSelect, {
  type SpecializationOption,
} from "@/components/clinic/SpecializationMultiSelect";
import { ModalPortal } from "@/components/common/ModalPortal";
import {
  type DoctorShift,
  type EffectiveShiftSettings,
  ALL_DAYS_OF_WEEK,
  timeToMinutes,
  minutesToTime,
  formatTime12h,
  generateTimeOptionsForClinicHours,
  getEffectiveShiftSettings,
  parseDoctorSchedule,
  serializeDoctorSchedule,
  validateDoctorShifts,
  getManilaNowParts,
  parseAppointmentTimeMinutes,
  isDoctorCurrentlyOnDuty,
} from "@/lib/schedulingService";

/* ── Types ────────────────────────────────────────────────────────── */
export type DayShift = {
  startTime: string;
  endTime: string;
};

export type DoctorAccount = {
  id: string;
  name: string;
  email: string;
  contactNumber?: string;
  prcLicense?: string;
  photo?: string;
  userId?: string;
  user_id?: string;
  specialization?: string;
  specializations: SpecializationOption[];
  clinicName: string;
  status: "Active" | "Inactive";
  dutyDays: string[];
  dutyStartTime: string;
  dutyEndTime: string;
  dutySchedule?: Record<string, any>;
  maxPatientsPerDay?: number;
  slotIntervalMinutes?: number;
  createdAt?: string;
};

/* ── Constants ────────────────────────────────────────────────────── */



const TIME_SLOT_OPTIONS = [
  { value: "06:00", label: "6:00 AM" },
  { value: "06:30", label: "6:30 AM" },
  { value: "07:00", label: "7:00 AM" },
  { value: "07:30", label: "7:30 AM" },
  { value: "08:00", label: "8:00 AM" },
  { value: "08:30", label: "8:30 AM" },
  { value: "09:00", label: "9:00 AM" },
  { value: "09:30", label: "9:30 AM" },
  { value: "10:00", label: "10:00 AM" },
  { value: "10:30", label: "10:30 AM" },
  { value: "11:00", label: "11:00 AM" },
  { value: "11:30", label: "11:30 AM" },
  { value: "12:00", label: "12:00 PM (Noon)" },
  { value: "12:30", label: "12:30 PM" },
  { value: "13:00", label: "1:00 PM" },
  { value: "13:30", label: "1:30 PM" },
  { value: "14:00", label: "2:00 PM" },
  { value: "14:30", label: "2:30 PM" },
  { value: "15:00", label: "3:00 PM" },
  { value: "15:30", label: "3:30 PM" },
  { value: "16:00", label: "4:00 PM" },
  { value: "16:30", label: "4:30 PM" },
  { value: "17:00", label: "5:00 PM" },
  { value: "17:30", label: "5:30 PM" },
  { value: "18:00", label: "6:00 PM" },
  { value: "18:30", label: "6:30 PM" },
  { value: "19:00", label: "7:00 PM" },
  { value: "19:30", label: "7:30 PM" },
  { value: "20:00", label: "8:00 PM" },
  { value: "20:30", label: "8:30 PM" },
  { value: "21:00", label: "9:00 PM" },
  { value: "21:30", label: "9:30 PM" },
  { value: "22:00", label: "10:00 PM" },
];

export const APPOINTMENT_INTERVAL_OPTIONS = [
  { value: 10, label: "10 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 20, label: "20 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 45, label: "45 minutes" },
  { value: 60, label: "60 minutes" },
] as const;

interface CoWorkingDoctor {
  day: string;
  doctorName: string;
  dutyStart: string;
  dutyEnd: string;
}

/* ── Helper Functions ─────────────────────────────────────────────── */

function getShiftDurationHours(startStr: string, endStr: string): number {
  if (!startStr || !endStr) return 0;
  const startMin = timeToMinutes(startStr);
  const endMin = timeToMinutes(endStr);
  if (endMin <= startMin) return 0;
  return Math.round(((endMin - startMin) / 60) * 10) / 10;
}

function getDoctorShiftForDay(
  doc: { dutyStartTime?: string; dutyEndTime?: string; dutySchedule?: Record<string, any> },
  day: string
): { startTime: string; endTime: string } {
  if (doc.dutySchedule) {
    if (doc.dutySchedule.weeklyShifts && doc.dutySchedule.weeklyShifts[day] && doc.dutySchedule.weeklyShifts[day].length > 0) {
      const shifts = doc.dutySchedule.weeklyShifts[day];
      return {
        startTime: shifts[0].startTime,
        endTime: shifts[shifts.length - 1].endTime,
      };
    }
    if (doc.dutySchedule[day] && doc.dutySchedule[day].startTime && doc.dutySchedule[day].endTime) {
      return doc.dutySchedule[day];
    }
  }
  return {
    startTime: doc.dutyStartTime || "08:00",
    endTime: doc.dutyEndTime || "17:00",
  };
}

/* ── Shift Progress Calculation Helper ────────────────────────────── */
const calculateShiftProgress = (
  startTimeStr?: string,
  endTimeStr?: string,
  currentMinutes?: number
): number => {
  if (!startTimeStr || !endTimeStr) return 35;
  try {
    const startM = parseAppointmentTimeMinutes(startTimeStr);
    const endM = parseAppointmentTimeMinutes(endTimeStr);
    if (startM === -1 || endM === -1 || endM === startM) return 35;

    const currM =
      typeof currentMinutes === "number"
        ? currentMinutes
        : getManilaNowParts().totalMinutes;

    // Standard shift (start < end)
    if (endM > startM) {
      if (currM <= startM) return 5;
      if (currM >= endM) return 100;
      const pct = Math.round(((currM - startM) / (endM - startM)) * 100);
      return Math.min(100, Math.max(5, pct));
    }

    // Overnight shift (e.g., 22:00 to 02:00)
    const totalDuration = 1440 - startM + endM;
    let elapsed = 0;
    if (currM >= startM) {
      elapsed = currM - startM;
    } else if (currM < endM) {
      elapsed = 1440 - startM + currM;
    } else {
      return 5;
    }
    const pct = Math.round((elapsed / totalDuration) * 100);
    return Math.min(100, Math.max(5, pct));
  } catch {
    return 35;
  }
};

/* ── Doctor Avatar Component with Fallback ────────────────────────── */
function OnDutyDoctorAvatar({ name, photo }: { name: string; photo?: string }) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [photo]);

  const cleanName = name.replace(/^(?:dr\.?|doctor)\s*/i, "").trim();
  const parts = cleanName.split(/\s+/).filter(Boolean);
  let initials = "DR";
  if (parts.length >= 2) {
    const first = parts[0].replace(/[^A-Za-z]/g, "").charAt(0).toUpperCase();
    const last = parts[parts.length - 1].replace(/[^A-Za-z]/g, "").charAt(0).toUpperCase();
    initials = `${first || "D"}${last || "R"}`;
  } else if (parts.length === 1 && parts[0]) {
    const letters = parts[0].replace(/[^A-Za-z]/g, "");
    initials = letters.slice(0, 2).toUpperCase() || "DR";
  }

  const resolvedPhoto = resolveAvatarUrl(photo);

  if (resolvedPhoto && !imgError) {
    return (
      <img
        src={resolvedPhoto}
        alt={name}
        onError={() => setImgError(true)}
        className="w-10.5 h-10.5 rounded-full object-cover border border-pink-100 shadow-2xs shrink-0"
      />
    );
  }

  return (
    <div className="w-10.5 h-10.5 rounded-full bg-pink-100 text-[#801336] font-bold text-xs flex items-center justify-center border border-pink-200 shrink-0">
      {initials}
    </div>
  );
}

/* ── Registered Doctor Avatar Component (Matching Reference Image 2) ── */
function RegisteredDoctorAvatar({ name, photo }: { name: string; photo?: string }) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [photo]);

  const cleanName = name.replace(/^(?:dr\.?|doctor)\s*/i, "").trim();
  const parts = cleanName.split(/\s+/).filter(Boolean);
  let initials = "DR";
  if (parts.length >= 2) {
    const first = parts[0].replace(/[^A-Za-z]/g, "").charAt(0).toUpperCase();
    const last = parts[parts.length - 1].replace(/[^A-Za-z]/g, "").charAt(0).toUpperCase();
    initials = `${first || "D"}${last || "R"}`;
  } else if (parts.length === 1 && parts[0]) {
    const letters = parts[0].replace(/[^A-Za-z]/g, "");
    initials = letters.slice(0, 2).toUpperCase() || "DR";
  }

  const resolvedPhoto = resolveAvatarUrl(photo);

  if (resolvedPhoto && !imgError) {
    return (
      <img
        src={resolvedPhoto}
        alt={name}
        onError={() => setImgError(true)}
        className="w-12 h-12 rounded-full object-cover border border-pink-100 shadow-2xs shrink-0"
      />
    );
  }

  return (
    <div className="w-12 h-12 rounded-full bg-pink-100 text-[#801336] font-bold text-sm flex items-center justify-center border border-pink-200 shrink-0">
      {initials}
    </div>
  );
}

/* ── Modern Time Select Component ─────────────────────────────────── */
function ModernTimeSelect({
  value,
  onChange,
  label,
  placeholder = "Select time",
  disabled = false,
  options,
  compact = false,
}: {
  value: string;
  onChange: (val: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  options?: { value: string; label: string }[];
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const effectiveOptions = options && options.length > 0 ? options : TIME_SLOT_OPTIONS;
  const selectedOpt = effectiveOptions.find((o) => o.value === value);
  const isInvalid = Boolean(value && options && options.length > 0 && !selectedOpt);

  return (
    <div ref={containerRef} className="relative w-full">
      {label && (
        <label className="block text-[11px] font-bold text-gray-700 mb-1">
          {label}
        </label>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={`w-full flex items-center justify-between ${compact ? "h-8 px-2 rounded-lg" : "px-3.5 py-2 rounded-xl"
          } border bg-white text-xs font-semibold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${isInvalid
            ? "border-rose-300 bg-rose-50/30 text-rose-800"
            : open
              ? "border-[#c0166a] ring-2 ring-magenta-500/10 shadow-xs"
              : "border-gray-200 hover:border-gray-300 hover:bg-gray-50/60"
          }`}
      >
        <div className="flex items-center gap-1.5 text-gray-900 truncate">
          <Clock className={`${compact ? "w-3 h-3" : "w-3.5 h-3.5"} ${isInvalid ? "text-rose-500" : "text-[#c0166a]"} shrink-0`} />
          <span className={`font-bold text-xs truncate ${isInvalid ? "text-rose-700" : ""}`}>
            {selectedOpt ? selectedOpt.label : value ? `${formatTime12h(value)} (Invalid)` : placeholder}
          </span>
        </div>
        <ChevronDown
          className={`${compact ? "w-3 h-3" : "w-3.5 h-3.5"} text-gray-400 shrink-0 transition-transform ${open ? "rotate-180 text-[#c0166a]" : ""
            }`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 min-w-[130px] w-full top-full mt-1 max-h-52 overflow-y-auto rounded-xl border border-gray-100 bg-white shadow-xl z-50 p-1 divide-y divide-gray-50/80"
          >
            {effectiveOptions.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${isSelected
                    ? "bg-[#c0166a] text-white font-bold"
                    : "text-gray-700 hover:bg-magenta-50 hover:text-magenta-900"
                    }`}
                >
                  <span>{opt.label}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-white shrink-0" />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Doctor Select Dropdown Component ─────────────────────────────── */
function DoctorSelectDropdown({
  doctors,
  selectedDoctorId,
  onSelect,
  disabled = false,
}: {
  doctors: DoctorAccount[];
  selectedDoctorId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedDoc = doctors.find((d) => d.id === selectedDoctorId) || doctors[0];

  return (
    <div ref={dropdownRef} className="relative w-full">
      <button
        type="button"
        disabled={disabled || doctors.length === 0}
        onClick={() => setOpen((prev) => !prev)}
        className={`w-full flex items-center justify-between p-4 rounded-2xl border bg-white transition-all cursor-pointer text-left ${open
          ? "border-[#801336] ring-2 ring-[#801336]/10 shadow-xs"
          : "border-pink-200/80 hover:border-pink-300 hover:bg-pink-50/20"
          } ${disabled || doctors.length === 0 ? "opacity-60 cursor-not-allowed" : ""}`}
      >
        {selectedDoc ? (
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-14 h-14 rounded-full border-2 border-pink-300 p-0.5 shrink-0 flex items-center justify-center bg-white shadow-2xs">
              {selectedDoc.photo ? (
                <img
                  src={selectedDoc.photo}
                  alt={selectedDoc.name}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <div className="w-full h-full rounded-full bg-pink-100 text-[#801336] font-bold flex items-center justify-center text-sm">
                  {selectedDoc.name.replace(/^(?:dr\.?|doctor)\s*/i, "").trim().charAt(0) || "D"}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <span className="font-bold text-gray-900 text-sm block truncate">
                {selectedDoc.name}
              </span>
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                {selectedDoc.specializations && selectedDoc.specializations.length > 0 ? (
                  selectedDoc.specializations.map((spec) => (
                    <span
                      key={spec.id}
                      className="inline-block text-[11px] px-3 py-0.5 rounded-full bg-pink-50/50 text-[#801336] font-medium border border-pink-200"
                    >
                      {spec.name}
                    </span>
                  ))
                ) : (
                  <span className="inline-block text-[11px] px-3 py-0.5 rounded-full bg-pink-50/50 text-[#801336] font-medium border border-pink-200">
                    {selectedDoc.specialization || "General Dermatology"}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <span className="text-xs text-gray-400 font-medium">
            {doctors.length === 0 ? "No registered doctors yet" : "Select a doctor..."}
          </span>
        )}

        <ChevronDown
          className={`w-4 h-4 text-gray-400 shrink-0 ml-3 transition-transform duration-150 ${open ? "rotate-180 text-[#801336]" : ""
            }`}
        />
      </button>

      <AnimatePresence>
        {open && doctors.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 right-0 top-full mt-1.5 max-h-64 overflow-y-auto rounded-2xl border border-gray-100 bg-white shadow-2xl z-50 p-1.5 divide-y divide-gray-50"
          >
            {doctors.map((doc) => {
              const isSelected = doc.id === selectedDoc?.id;
              return (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => {
                    onSelect(doc.id);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl transition-all text-left cursor-pointer ${isSelected
                    ? "bg-magenta-50/80 text-magenta-900 font-semibold"
                    : "hover:bg-gray-50 text-gray-800"
                    }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {doc.photo ? (
                      <img
                        src={doc.photo}
                        alt={doc.name}
                        className="w-9 h-9 rounded-lg object-cover border border-magenta-100 shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-lg bg-magenta-50 text-[#c0166a] font-bold text-xs flex items-center justify-center shrink-0">
                        {doc.name.replace("Dr.", "").trim().charAt(0) || "D"}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-gray-900 truncate">{doc.name}</p>
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-500 flex-wrap">
                        <span className="font-medium text-gray-700">
                          {doc.specializations && doc.specializations.length > 0
                            ? doc.specializations.map((s) => s.name).join(", ")
                            : doc.specialization || "General Dermatology"}
                        </span>
                        {doc.dutyDays && doc.dutyDays.length > 0 ? (
                          <span className="text-emerald-700 font-semibold">• {doc.dutyDays.length} days ({doc.slotIntervalMinutes || 20}m, Max {doc.maxPatientsPerDay || 20}/shift)</span>
                        ) : (
                          <span className="text-amber-600">• No schedule</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-[#c0166a] shrink-0" />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Main Page Component ──────────────────────────────────────────── */
export default function ClinicDoctorsPage() {
  const { clinicName: verifiedClinicName, clinicId } = useClinicVerification();
  const clinicDisplayName = verifiedClinicName || "Clinic Portal";

  // Tab State: "register" | "schedule"
  const [activeTab, setActiveTab] = useState<"register" | "schedule">("register");

  // Dynamic specializations
  const [specializations, setSpecializations] = useState<SpecializationOption[]>([]);
  const [loadingSpecializations, setLoadingSpecializations] = useState(false);

  // Doctors list (Clinic isolated)
  const [allDoctors, setAllDoctors] = useState<DoctorAccount[]>([]);
  const [loadingDoctors, setLoadingDoctors] = useState(true);

  // Notifications
  const [successMsg, setSuccessMsg] = useState("");

  /* ── Tab A: Register New Doctor Form State ──────────────────────── */
  const [registerForm, setRegisterForm] = useState({
    name: "",
    email: "",
    contactNumber: "",
    prcLicense: "",
    selectedSpecializationIds: [] as string[],
    photoFile: null as File | null,
    photoPreview: "",
  });
  const [registerError, setRegisterError] = useState("");
  const [savingDoctor, setSavingDoctor] = useState(false);
  const saveDoctorLockRef = useRef(false);
  const photoFileInputRef = useRef<HTMLInputElement>(null);
  const [showRegisterConfirmModal, setShowRegisterConfirmModal] = useState(false);
  const [showRegisterDoctorModal, setShowRegisterDoctorModal] = useState(false);

  /* ── Tab B: Schedule Duty Hours Form State ──────────────────────── */
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(() => {
    try {
      return localStorage.getItem("dermai_selected_doctor_id") || "";
    } catch {
      return "";
    }
  });
  const [clinicOpenTime, setClinicOpenTime] = useState("08:00");
  const [clinicCloseTime, setClinicCloseTime] = useState("21:00");
  const [clinicOperatingDays, setClinicOperatingDays] = useState("Monday - Saturday");
  const [clinicDefaultInterval, setClinicDefaultInterval] = useState(30);

  const [scheduleForm, setScheduleForm] = useState<{
    dutyDays: string[];
    weeklyShifts: Record<string, DoctorShift[]>;
    doctorSlotInterval: number | null; // null = inherit clinic default
  }>({
    dutyDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    weeklyShifts: {},
    doctorSlotInterval: null,
  });
  const [scheduleError, setScheduleError] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleSavedFeedback, setScheduleSavedFeedback] = useState<{
    doctorName: string;
    daysCount: number;
    shiftsCount: number;
  } | null>(null);

  /* ── Modals State ───────────────────────────────────────────────── */
  const [expandedDays, setExpandedDays] = useState<string[]>(["Wednesday"]);

  const toggleExpandDay = (day: string) => {
    setExpandedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const formatBreakDuration = (breakMinutes: number): string => {
    if (breakMinutes <= 0) return "";
    const hours = Math.floor(breakMinutes / 60);
    const mins = breakMinutes % 60;
    if (hours > 0 && mins === 0) {
      return `${hours} hr${hours > 1 ? "s" : ""} break`;
    }
    if (hours === 0) {
      return `${mins} min${mins > 1 ? "s" : ""} break`;
    }
    return `${hours} hr ${mins} min${mins > 1 ? "s" : ""} break`;
  };

  const [showInstructionsModal, setShowInstructionsModal] = useState(false);
  const [selectedDoctorForDetails, setSelectedDoctorForDetails] = useState<DoctorAccount | null>(null);
  const [statusConfirmDoctor, setStatusConfirmDoctor] = useState<DoctorAccount | null>(null);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deletingDoctor, setDeletingDoctor] = useState(false);

  /* ── Edit Doctor Profile Modal State ────────────────────────────── */
  const [editingDoctor, setEditingDoctor] = useState<DoctorAccount | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    contactNumber: "",
    prcLicense: "",
    selectedSpecializationIds: [] as string[],
    photoFile: null as File | null,
    photoPreview: "",
    removePhoto: false,
  });
  const [editError, setEditError] = useState("");
  const [savingEditDoctor, setSavingEditDoctor] = useState(false);
  const editPhotoFileInputRef = useRef<HTMLInputElement>(null);

  /* ── All Registered Doctors Controls State ───────────────────────── */
  const [doctorSearchQuery, setDoctorSearchQuery] = useState("");
  const [selectedSpecialtyFilter, setSelectedSpecialtyFilter] = useState("All Specialties");
  const formSectionRef = useRef<HTMLDivElement>(null);

  // Keep scroll position stable at top when switching tabs
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [activeTab]);

  // Fetch clinic-wide operating settings to bound doctor shift times
  const fetchClinicOperatingSettings = useCallback(async () => {
    try {
      const settRaw = localStorage.getItem("dermai_clinic_settings");
      if (settRaw) {
        const s = JSON.parse(settRaw);
        if (s.openTime) setClinicOpenTime(s.openTime);
        if (s.closeTime) setClinicCloseTime(s.closeTime);
        if (s.operatingDays) setClinicOperatingDays(s.operatingDays);
        if (s.slotIntervalMinutes) setClinicDefaultInterval(Number(s.slotIntervalMinutes));
      }
    } catch { }

    let targetClinicId = clinicId;
    if (!targetClinicId) {
      try {
        const cache = localStorage.getItem("dermai_clinic_profile_cache");
        if (cache) {
          const parsed = JSON.parse(cache);
          if (parsed.clinicId) targetClinicId = parsed.clinicId;
        }
      } catch { }
    }
    try {
      const sett = localStorage.getItem("dermai_clinic_settings");
      if (sett) {
        const parsed = JSON.parse(sett);
        if (!targetClinicId && parsed.id) targetClinicId = parsed.id;
        if (parsed.openTime) setClinicOpenTime(parsed.openTime);
        if (parsed.closeTime) setClinicCloseTime(parsed.closeTime);
        if (parsed.operatingDays) setClinicOperatingDays(parsed.operatingDays);
      }
    } catch { }

    if (targetClinicId && !targetClinicId.startsWith("temp_")) {
      try {
        const { data: opData } = await supabase
          .from("clinic_operating_hours")
          .select("open_time, close_time, day_of_week")
          .eq("clinic_id", targetClinicId)
          .maybeSingle();

        if (opData) {
          if (opData.open_time) setClinicOpenTime(opData.open_time.slice(0, 5));
          if (opData.close_time) setClinicCloseTime(opData.close_time.slice(0, 5));
          if (opData.day_of_week) setClinicOperatingDays(opData.day_of_week);
        }
      } catch { }
    }
  }, [clinicId]);

  useEffect(() => {
    fetchClinicOperatingSettings();
    const handleSync = () => fetchClinicOperatingSettings();
    window.addEventListener("clinicSettingsUpdated", handleSync);
    window.addEventListener("dermai_clinic_updated", handleSync);
    window.addEventListener("storage", handleSync);
    return () => {
      window.removeEventListener("clinicSettingsUpdated", handleSync);
      window.removeEventListener("dermai_clinic_updated", handleSync);
      window.removeEventListener("storage", handleSync);
    };
  }, [fetchClinicOperatingSettings]);

  // Dynamically bounded time options matching clinic operating hours
  const clinicTimeOptions = useMemo(() => {
    return generateTimeOptionsForClinicHours(clinicOpenTime, clinicCloseTime, 30);
  }, [clinicOpenTime, clinicCloseTime]);

  // Currently selected doctor for scheduling
  const selectedDoctor = useMemo(() => {
    return allDoctors.find((d) => d.id === selectedDoctorId) || (allDoctors.length > 0 ? allDoctors[0] : null);
  }, [allDoctors, selectedDoctorId]);

  const handleSelectDoctor = (id: string) => {
    setSelectedDoctorId(id);
    setScheduleSavedFeedback(null);
    setScheduleError("");
    try {
      localStorage.setItem("dermai_selected_doctor_id", id);
    } catch { }
  };

  // Keep selectedDoctorId in sync when doctors load
  useEffect(() => {
    if (allDoctors.length > 0) {
      const exists = allDoctors.some((d) => d.id === selectedDoctorId);
      if (!selectedDoctorId || !exists) {
        const fallbackId = allDoctors[0].id;
        setSelectedDoctorId(fallbackId);
        try {
          localStorage.setItem("dermai_selected_doctor_id", fallbackId);
        } catch { }
      }
    }
  }, [allDoctors, selectedDoctorId]);

  // Populate schedule form whenever selected doctor changes
  useEffect(() => {
    if (selectedDoctor) {
      const parsed = parseDoctorSchedule(
        selectedDoctor.dutySchedule,
        selectedDoctor.dutyDays,
        clinicOpenTime,
        clinicCloseTime
      );

      // Prioritize selectedDoctor.dutyDays if explicitly defined
      const activeDays = Array.isArray(selectedDoctor.dutyDays) && selectedDoctor.dutyDays.length > 0
        ? selectedDoctor.dutyDays
        : ALL_DAYS_OF_WEEK.filter(
          (day) => parsed.weeklyShifts[day] && parsed.weeklyShifts[day].length > 0
        );

      const finalDays = activeDays.length > 0
        ? activeDays
        : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

      setScheduleForm({
        dutyDays: finalDays,
        weeklyShifts: parsed.weeklyShifts,
        doctorSlotInterval: parsed.slotIntervalMinutes ?? null,
      });
      setScheduleError("");
      setScheduleSavedFeedback(null);
    }
  }, [selectedDoctor?.id, clinicOpenTime, clinicCloseTime]);

  // Shift summaries and capacity calculation across all doctor shifts
  const shiftSummaries = useMemo(() => {
    const list: {
      day: string;
      shift: DoctorShift;
      effective: EffectiveShiftSettings;
    }[] = [];

    scheduleForm.dutyDays.forEach((day) => {
      const shifts = scheduleForm.weeklyShifts[day] || [];
      shifts.forEach((shift) => {
        const effective = getEffectiveShiftSettings(
          shift,
          {
            weeklyShifts: scheduleForm.weeklyShifts,
            slotIntervalMinutes: scheduleForm.doctorSlotInterval ?? undefined,
          },
          {
            defaultSlotIntervalMinutes: clinicDefaultInterval,
            openTime: clinicOpenTime,
            closeTime: clinicCloseTime,
          }
        );
        list.push({ day, shift, effective });
      });
    });

    return list;
  }, [
    scheduleForm.dutyDays,
    scheduleForm.weeklyShifts,
    scheduleForm.doctorSlotInterval,
    clinicDefaultInterval,
    clinicOpenTime,
    clinicCloseTime,
  ]);

  const estimatedCapacityBreakdown = useMemo(() => {
    if (shiftSummaries.length === 0) {
      return {
        summaryText: "0 slots",
        detailText: "No working hours have been set yet.",
      };
    }

    const minSlots = Math.min(...shiftSummaries.map((s) => s.effective.possibleSlots));
    const maxSlots = Math.max(...shiftSummaries.map((s) => s.effective.possibleSlots));

    const summaryText =
      minSlots === maxSlots
        ? `${minSlots} slots / shift`
        : `${minSlots}–${maxSlots} slots / shift`;

    const distinctIntervals = Array.from(new Set(shiftSummaries.map((s) => s.effective.interval)));
    const intervalStr =
      distinctIntervals.length === 1
        ? `${distinctIntervals[0]}m`
        : `${Math.min(...distinctIntervals)}m–${Math.max(...distinctIntervals)}m`;

    const slotText =
      minSlots === maxSlots
        ? `${minSlots} possible slots (${intervalStr})`
        : `${minSlots}–${maxSlots} possible slots (${intervalStr})`;

    return {
      summaryText,
      detailText: slotText,
    };
  }, [shiftSummaries]);

  // Compute live co-working doctors active on the same days
  const DAY_INITIALS: { day: string; initial: string }[] = [
    { day: "Monday", initial: "M" },
    { day: "Tuesday", initial: "T" },
    { day: "Wednesday", initial: "W" },
    { day: "Thursday", initial: "T" },
    { day: "Friday", initial: "F" },
    { day: "Saturday", initial: "S" },
    { day: "Sunday", initial: "S" },
  ];

  const weeklyMetrics = useMemo(() => {
    const activeDaysCount = scheduleForm.dutyDays.length;
    let totalHours = 0;
    let totalSlots = 0;

    scheduleForm.dutyDays.forEach((day) => {
      const shifts = scheduleForm.weeklyShifts[day] || [];
      shifts.forEach((s) => {
        totalHours += getShiftDurationHours(s.startTime, s.endTime);
        const eff = getEffectiveShiftSettings(
          s,
          {
            weeklyShifts: scheduleForm.weeklyShifts,
            slotIntervalMinutes: scheduleForm.doctorSlotInterval ?? undefined,
          },
          {
            defaultSlotIntervalMinutes: clinicDefaultInterval,
            openTime: clinicOpenTime,
            closeTime: clinicCloseTime,
          }
        );
        totalSlots += eff.possibleSlots;
      });
    });

    return {
      activeDaysCount,
      totalHours: Math.round(totalHours * 10) / 10,
      totalSlots,
    };
  }, [
    scheduleForm.dutyDays,
    scheduleForm.weeklyShifts,
    scheduleForm.doctorSlotInterval,
    clinicDefaultInterval,
    clinicOpenTime,
    clinicCloseTime,
  ]);

  const coWorkingDoctors = useMemo(() => {
    const list: CoWorkingDoctor[] = [];
    if (!selectedDoctor || !scheduleForm.dutyDays.length) return list;

    allDoctors.forEach((doc) => {
      if (doc.id === selectedDoctor.id || doc.status !== "Active") return;
      const otherSched = parseDoctorSchedule(doc.dutySchedule, doc.dutyDays);

      scheduleForm.dutyDays.forEach((day) => {
        const otherShifts = otherSched.weeklyShifts[day] || [];
        const myShifts = scheduleForm.weeklyShifts[day] || [];

        otherShifts.forEach((os) => {
          const osStart = timeToMinutes(os.startTime);
          const osEnd = timeToMinutes(os.endTime);

          const hasOverlap = myShifts.some((ms) => {
            const msStart = timeToMinutes(ms.startTime);
            const msEnd = timeToMinutes(ms.endTime);
            return Math.max(msStart, osStart) < Math.min(msEnd, osEnd);
          });

          if (hasOverlap) {
            list.push({
              day,
              doctorName: doc.name,
              dutyStart: os.startTime,
              dutyEnd: os.endTime,
            });
          }
        });
      });
    });

    return list;
  }, [allDoctors, selectedDoctor, scheduleForm.dutyDays, scheduleForm.weeklyShifts]);

  // Live clock tick (updates every 30s so completed shifts pass dynamically without manual page refresh)
  const [currentTick, setCurrentTick] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTick(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  // Current Day, Date & Time formatted for On Duty Today section (Asia/Manila)
  const nowParts = useMemo(() => {
    return getManilaNowParts();
  }, [currentTick]);

  const todayDayName = useMemo(() => {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: "Asia/Manila",
    }).format(new Date());
  }, [currentTick]);

  const formattedTodayDate = useMemo(() => {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "Asia/Manila",
    }).format(new Date());
  }, [currentTick]);

  // Compute doctors who are on duty today based on their active duty schedule
  // Strictly respects: clinic open hours, clinic open days, shift validity, and current local time
  const onDutyDoctors = useMemo(() => {
    const currentMinutes = nowParts.totalMinutes;

    return allDoctors
      .filter((doc) => doc.status !== "Inactive")
      .map((doc) => {
        const dutyResult = isDoctorCurrentlyOnDuty({
          doctor: doc,
          clinicSchedule: {
            openTime: clinicOpenTime,
            closeTime: clinicCloseTime,
            operatingDays: clinicOperatingDays,
          },
          timezone: "Asia/Manila",
          currentTimeMs: currentTick,
        });

        if (!dutyResult.isOnDuty || !dutyResult.activeShift) {
          return null;
        }

        const activeShift = dutyResult.activeShift;
        const hoursDisplay = `${formatTime12h(activeShift.startTime)} – ${formatTime12h(activeShift.endTime)}`;

        const primarySpec =
          doc.specializations && doc.specializations.length > 0
            ? doc.specializations[0].name
            : doc.specialization
              ? doc.specialization.split(",")[0].trim()
              : "Dermatologist";

        const cleanDocName = doc.name.trim();
        const displayName = cleanDocName.startsWith("Dr.") ? cleanDocName : `Dr. ${cleanDocName}`;

        const shiftProgress = calculateShiftProgress(
          activeShift?.startTime,
          activeShift?.endTime,
          currentMinutes
        );

        return {
          doctor: doc,
          displayName,
          primarySpec,
          hoursDisplay,
          shifts: [activeShift],
          allTodayShifts: [activeShift],
          shiftProgress,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [allDoctors, clinicOpenTime, clinicCloseTime, clinicOperatingDays, nowParts, currentTick]);

  const availableSpecialtyOptions = useMemo(() => {
    const specsSet = new Set<string>();
    specializations.forEach((s) => {
      if (s.name) specsSet.add(s.name);
    });
    allDoctors.forEach((d) => {
      if (d.specializations) {
        d.specializations.forEach((s) => {
          if (s.name) specsSet.add(s.name);
        });
      }
      if (d.specialization) {
        d.specialization.split(",").forEach((s) => {
          const trimmed = s.trim();
          if (trimmed) specsSet.add(trimmed);
        });
      }
    });
    return Array.from(specsSet);
  }, [specializations, allDoctors]);

  const filteredRegisteredDoctors = useMemo(() => {
    return allDoctors.filter((doc) => {
      if (doctorSearchQuery.trim()) {
        const q = doctorSearchQuery.trim().toLowerCase();
        const nameMatch = doc.name.toLowerCase().includes(q);
        const emailMatch = doc.email.toLowerCase().includes(q);
        const specMatch =
          (doc.specialization && doc.specialization.toLowerCase().includes(q)) ||
          doc.specializations.some((s) => s.name.toLowerCase().includes(q));
        if (!nameMatch && !emailMatch && !specMatch) return false;
      }

      if (selectedSpecialtyFilter && selectedSpecialtyFilter !== "All Specialties") {
        const hasSpec =
          doc.specializations.some(
            (s) => s.name.toLowerCase() === selectedSpecialtyFilter.toLowerCase()
          ) ||
          (doc.specialization &&
            doc.specialization.toLowerCase().includes(selectedSpecialtyFilter.toLowerCase()));
        if (!hasSpec) return false;
      }

      return true;
    });
  }, [allDoctors, doctorSearchQuery, selectedSpecialtyFilter]);

  // Photo compression helper
  const compressImageToDataUrl = (file: File, maxDim = 512, quality = 0.85): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > height) {
            if (width > maxDim) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            }
          } else {
            if (height > maxDim) {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL("image/jpeg", quality));
          } else {
            resolve((e.target?.result as string) || "");
          }
        };
        img.onerror = () => resolve((e.target?.result as string) || "");
        img.src = e.target?.result as string;
      };
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    });
  };

  // Upload photo to Supabase storage with DataURL fallback
  const uploadDoctorPhoto = async (file: File): Promise<string> => {
    try {
      const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `doctors/${Date.now()}_${cleanName}`;
      const { data: upData, error: upErr } = await supabase.storage
        .from("clinic-photos")
        .upload(path, file, { upsert: true });

      if (!upErr && upData) {
        const { data: pubUrl } = supabase.storage
          .from("clinic-photos")
          .getPublicUrl(upData.path);
        if (pubUrl?.publicUrl) return pubUrl.publicUrl;
      }
    } catch (err) {
      console.warn("Storage upload fallback to DataURL:", err);
    }
    return compressImageToDataUrl(file);
  };

  // 1. Fetch specializations
  const fetchSpecializations = useCallback(async () => {
    setLoadingSpecializations(true);
    try {
      const { data, error } = await supabase
        .from("specializations")
        .select("id, name")
        .order("name", { ascending: true });

      if (error) {
        console.error("Error fetching specializations:", error);
      } else if (data) {
        setSpecializations(data);
      }
    } catch (err) {
      console.error("Failed to fetch specializations:", err);
    } finally {
      setLoadingSpecializations(false);
    }
  }, []);

  // 2. Fetch doctors for the current clinic
  const fetchDoctors = useCallback(async () => {
    setLoadingDoctors(true);
    try {
      let query = supabase
        .from("clinic_doctor")
        .select(`
          doctor_id,
          doctor_name,
          email,
          contact_number,
          prc_license,
          photo_url,
          user_id,
          user:user_id ( avatar_url ),
          duty_days,
          duty_start_time,
          duty_end_time,
          duty_schedule,
          status,
          created_at,
          doctor_specializations (
            specialization_id,
            specializations (
              id,
              name
            )
          )
        `)
        .order("created_at", { ascending: false });

      if (clinicId) {
        query = query.eq("clinic_id", clinicId);
      }

      const { data, error } = await query;

      if (!error && data) {
        const localPhotoMap = new Map<string, string>();
        try {
          const cached = localStorage.getItem("dermai_clinic_doctors");
          if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed)) {
              parsed.forEach((d: any) => {
                const p = d.photo || d.photo_url;
                if (p) {
                  if (d.id) localPhotoMap.set(String(d.id), p);
                  if (d.email) localPhotoMap.set(String(d.email).toLowerCase().trim(), p);
                }
              });
            }
          }
        } catch { }

        const mapped: DoctorAccount[] = data.map((doc: any) => {
          const docSpecs: SpecializationOption[] = (doc.doctor_specializations || [])
            .map((ds: any) => ds.specializations)
            .filter(Boolean);

          let parsedDutyDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
          if (Array.isArray(doc.duty_days) && doc.duty_days.length > 0) {
            parsedDutyDays = doc.duty_days;
          } else if (typeof doc.duty_days === "string" && doc.duty_days.trim()) {
            parsedDutyDays = doc.duty_days.split(",").map((d: string) => d.trim());
          }

          let parsedDutySchedule: Record<string, any> | undefined = undefined;
          let parsedMaxPatients = 20;
          let parsedSlotInterval = 20;

          if (doc.duty_schedule && typeof doc.duty_schedule === "object" && !Array.isArray(doc.duty_schedule)) {
            parsedDutySchedule = doc.duty_schedule;
            if (doc.duty_schedule.maxPatientsPerDay !== undefined) {
              parsedMaxPatients = Number(doc.duty_schedule.maxPatientsPerDay);
            } else if (doc.duty_schedule.max_patients_per_day !== undefined) {
              parsedMaxPatients = Number(doc.duty_schedule.max_patients_per_day);
            }
            if (doc.duty_schedule.slotIntervalMinutes !== undefined) {
              parsedSlotInterval = Number(doc.duty_schedule.slotIntervalMinutes);
            } else if (doc.duty_schedule.slot_interval_minutes !== undefined) {
              parsedSlotInterval = Number(doc.duty_schedule.slot_interval_minutes);
            }
          } else if (Array.isArray(doc.duty_schedule)) {
            parsedDutySchedule = {};
            doc.duty_schedule.forEach((item: any) => {
              if (item && item.day) {
                parsedDutySchedule![item.day] = {
                  startTime: item.startTime || item.start_time || item.start || "08:00",
                  endTime: item.endTime || item.end_time || item.end || "17:00",
                };
              }
            });
          }

          const userObj = Array.isArray(doc.user) ? doc.user[0] : doc.user;
          const rawPhoto =
            doc.photo_url ||
            userObj?.avatar_url ||
            localPhotoMap.get(String(doc.doctor_id)) ||
            (doc.email ? localPhotoMap.get(String(doc.email).toLowerCase().trim()) : undefined) ||
            undefined;
          const preservedPhoto = resolveAvatarUrl(rawPhoto);

          return {
            id: doc.doctor_id,
            name: doc.doctor_name,
            email: doc.email,
            contactNumber: doc.contact_number || "",
            prcLicense: doc.prc_license || "",
            photo: preservedPhoto,
            userId: doc.user_id,
            user_id: doc.user_id,
            dutyDays: parsedDutyDays,
            dutyStartTime: doc.duty_start_time || "08:00",
            dutyEndTime: doc.duty_end_time || "17:00",
            dutySchedule: parsedDutySchedule,
            maxPatientsPerDay: parsedMaxPatients,
            slotIntervalMinutes: parsedSlotInterval,
            specialization: docSpecs.map((s) => s.name).join(", "),
            specializations: docSpecs,
            clinicName: clinicDisplayName,
            status: doc.status === "Inactive" ? "Inactive" : "Active",
            createdAt: doc.created_at || undefined,
          };
        });

        setAllDoctors(mapped);
        try {
          localStorage.setItem("dermai_clinic_doctors", JSON.stringify(mapped));
        } catch { }
      } else {
        // Fallback to local storage
        try {
          const saved = localStorage.getItem("dermai_clinic_doctors");
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
              setAllDoctors(parsed);
            }
          }
        } catch { }
      }
    } catch {
      // Offline fallback
    } finally {
      setLoadingDoctors(false);
    }
  }, [clinicId, clinicDisplayName]);

  useEffect(() => {
    fetchSpecializations();
    fetchDoctors();

    const handleStorageUpdate = () => {
      try {
        const saved = localStorage.getItem("dermai_clinic_doctors");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            setAllDoctors(parsed);
          }
        }
      } catch { }
    };

    window.addEventListener("storage", handleStorageUpdate);
    window.addEventListener("dermai_doctors_updated", handleStorageUpdate);
    return () => {
      window.removeEventListener("storage", handleStorageUpdate);
      window.removeEventListener("dermai_doctors_updated", handleStorageUpdate);
    };
  }, [fetchSpecializations, fetchDoctors]);

  /* ── Tab A Actions: Register Doctor ─────────────────────────────── */
  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 1024 * 1024 * 8) {
      setRegisterError("Doctor photo should be less than 8MB.");
      return;
    }

    try {
      const compressedDataUrl = await compressImageToDataUrl(file);
      setRegisterForm((p) => ({ ...p, photoFile: file, photoPreview: compressedDataUrl }));
    } catch {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = (reader.result as string) || "";
        setRegisterForm((p) => ({ ...p, photoFile: file, photoPreview: dataUrl }));
      };
      reader.readAsDataURL(file);
    }
  };

  const resetRegisterForm = () => {
    setRegisterForm({
      name: "",
      email: "",
      contactNumber: "",
      prcLicense: "",
      selectedSpecializationIds: [],
      photoFile: null,
      photoPreview: "",
    });
    if (photoFileInputRef.current) photoFileInputRef.current.value = "";
    setRegisterError("");
  };

  const handleInitiateAddDoctor = () => {
    setRegisterError("");
    const { name, email, contactNumber, prcLicense, selectedSpecializationIds } = registerForm;

    if (!name.trim()) {
      setRegisterError("Doctor name is required.");
      return;
    }
    if (!email.trim() || !/\S+@\S+\.\S+/.test(email)) {
      setRegisterError("Valid email is required (e.g. doctor@gmail.com).");
      return;
    }
    if (!contactNumber.trim()) {
      setRegisterError("Contact number is required.");
      return;
    }
    if (contactNumber.trim().length !== 11) {
      setRegisterError("Contact number must be exactly 11 digits (e.g. 09171234567).");
      return;
    }
    if (!prcLicense.trim()) {
      setRegisterError("PRC license is required.");
      return;
    }
    if (prcLicense.trim().length > 7) {
      setRegisterError("PRC license must be up to 7 characters.");
      return;
    }
    if (selectedSpecializationIds.length === 0) {
      setRegisterError("Please select at least one specialization.");
      return;
    }

    setShowRegisterConfirmModal(true);
  };

  const handleConfirmSaveDoctor = async () => {
    setShowRegisterConfirmModal(false);
    await saveDoctor();
  };

  const saveDoctor = async () => {
    if (saveDoctorLockRef.current) return;
    saveDoctorLockRef.current = true;
    setSavingDoctor(true);
    setRegisterError("");

    let createdDoctorId: string | null = null;

    try {
      if (!clinicId) {
        throw new Error("Your clinic could not be verified. Refresh the page and try again.");
      }

      const doctorName = registerForm.name.trim();
      const doctorEmail = registerForm.email.trim().toLowerCase();
      const doctorContact = registerForm.contactNumber.trim();
      const doctorLicense = registerForm.prcLicense.trim();

      const assignedSpecs = specializations.filter((s) =>
        registerForm.selectedSpecializationIds.includes(s.id)
      );

      if (assignedSpecs.length === 0) {
        throw new Error("Select at least one specialization.");
      }

      let uploadedPhotoUrl = registerForm.photoPreview;
      if (registerForm.photoFile) {
        uploadedPhotoUrl = await uploadDoctorPhoto(registerForm.photoFile);
      }

      // Supabase RPC invitation with direct table insertion fallback
      let inviteSuccess = false;
      let rpcFailureReason = "";

      try {
        const { data: inviteData, error: inviteError } = await supabase.rpc(
          "invite_doctor",
          {
            target_clinic_id: clinicId,
            doctor_email: doctorEmail,
            doctor_full_name: doctorName,
            doctor_prc_license: doctorLicense,
            doctor_specialization: assignedSpecs[0]?.name || "",
          }
        );

        if (!inviteError && inviteData) {
          createdDoctorId = inviteData;
          inviteSuccess = true;
        } else if (inviteError) {
          rpcFailureReason = inviteError.message;
          console.warn(
            "[ClinicDoctorsPage] invite_doctor RPC call failed, falling back to direct clinic_doctor insert:",
            inviteError.message
          );
        }
      } catch (rpcErr: unknown) {
        rpcFailureReason = rpcErr instanceof Error ? rpcErr.message : "RPC invocation exception";
        console.warn("[ClinicDoctorsPage] invite_doctor RPC threw exception, falling back:", rpcErr);
      }

      if (!inviteSuccess) {
        // Direct table fallback: query existing user_id if any
        let existingUserId: string | null = null;
        try {
          const { data: userRow } = await supabase
            .from("user")
            .select("user_id")
            .eq("email", doctorEmail)
            .maybeSingle();

          if (userRow?.user_id) {
            existingUserId = userRow.user_id;
            try {
              await supabase
                .from("user")
                .update({ role: "doctor" })
                .eq("user_id", existingUserId)
                .eq("role", "patient");
            } catch {
              // Non-fatal if user role update is restricted
            }
          }
        } catch (lookupErr) {
          console.warn("[ClinicDoctorsPage] user lookup error during fallback:", lookupErr);
        }

        const { data: newDoc, error: insertDocError } = await supabase
          .from("clinic_doctor")
          .insert({
            clinic_id: clinicId,
            doctor_name: doctorName,
            email: doctorEmail,
            prc_license: doctorLicense,
            contact_number: doctorContact,
            photo_url: uploadedPhotoUrl || null,
            status: "Active",
            user_id: existingUserId,
            duty_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
            duty_start_time: "08:00",
            duty_end_time: "17:00",
          })
          .select("doctor_id")
          .single();

        if (insertDocError || !newDoc?.doctor_id) {
          throw new Error(
            `Doctor account creation failed: ${insertDocError?.message || rpcFailureReason || "Could not insert doctor record"}`
          );
        }

        createdDoctorId = newDoc.doctor_id;
      } else {
        // If RPC succeeded, update phone and photo
        const updatePayload: Record<string, unknown> = {
          contact_number: doctorContact,
          photo_url: uploadedPhotoUrl || null,
          duty_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
          duty_start_time: "08:00",
          duty_end_time: "17:00",
        };

        const updateRes = await supabase
          .from("clinic_doctor")
          .update(updatePayload)
          .eq("doctor_id", createdDoctorId)
          .eq("clinic_id", clinicId);

        if (updateRes.error) {
          console.warn("[ClinicDoctorsPage] Doctor profile update warning:", updateRes.error.message);
        }
      }

      // Associate specializations in junction table
      try {
        await supabase
          .from("doctor_specializations")
          .delete()
          .eq("doctor_id", createdDoctorId);

        const junctionRows = assignedSpecs.map((spec) => ({
          doctor_id: createdDoctorId as string,
          specialization_id: spec.id,
        }));

        const insertSpecsRes = await supabase
          .from("doctor_specializations")
          .insert(junctionRows);

        if (insertSpecsRes.error) {
          console.warn("[ClinicDoctorsPage] Specializations junction warning:", insertSpecsRes.error.message);
        }
      } catch (specErr) {
        console.warn("[ClinicDoctorsPage] Exception associating specializations:", specErr);
      }

      const finalizedDoctor: DoctorAccount = {
        id: createdDoctorId as string,
        name: doctorName,
        email: doctorEmail,
        contactNumber: doctorContact,
        prcLicense: doctorLicense,
        photo: uploadedPhotoUrl || undefined,
        specialization: assignedSpecs.map((s) => s.name).join(", "),
        specializations: assignedSpecs,
        clinicName: clinicDisplayName,
        status: "Active",
        dutyDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        dutyStartTime: "08:00",
        dutyEndTime: "17:00",
      };

      const updatedList = [finalizedDoctor, ...allDoctors];
      setAllDoctors(updatedList);
      setSelectedDoctorId(finalizedDoctor.id);
      localStorage.setItem("dermai_clinic_doctors", JSON.stringify(updatedList));
      window.dispatchEvent(new Event("storage"));
      window.dispatchEvent(new CustomEvent("dermai_doctors_updated"));

      resetRegisterForm();
      setShowRegisterDoctorModal(false);
      setSuccessMsg(`Dr. ${finalizedDoctor.name} was successfully registered and added to roster.`);
      setTimeout(() => setSuccessMsg(""), 4500);

      logAuditEvent({
        role: "clinic",
        category: "Clinic",
        action: "Doctor Added",
        target: `Dr. ${finalizedDoctor.name}`,
        details: `Clinic added doctor "${finalizedDoctor.name}" (PRC: ${finalizedDoctor.prcLicense || "N/A"}) with specialization: ${finalizedDoctor.specialization || "General Dermatology"}.`,
        metadata: {
          doctorName: finalizedDoctor.name,
          doctorId: finalizedDoctor.id,
          clinicName: clinicDisplayName,
        },
      }).catch(() => { });

      fetchDoctors();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred.";
      if (createdDoctorId) {
        setRegisterError(
          `${message} A doctor record was created (ID: ${createdDoctorId}). Please verify the record before retrying.`
        );
      } else {
        setRegisterError(message);
      }
    } finally {
      saveDoctorLockRef.current = false;
      setSavingDoctor(false);
    }
  };

  /* ── Tab B Actions: Multi-Shift Duty Management ──────────────────── */
  const applyDutyDays = (days: string[]) => {
    setScheduleForm((prev) => {
      const nextWeeklyShifts = { ...prev.weeklyShifts };
      days.forEach((day) => {
        if (!nextWeeklyShifts[day] || nextWeeklyShifts[day].length === 0) {
          const defaultStart = clinicOpenTime || "08:00";
          const defaultEnd =
            timeToMinutes(clinicCloseTime) <= 12 * 60 ? clinicCloseTime : "12:00";
          nextWeeklyShifts[day] = [
            {
              id: `shift-${day.toLowerCase()}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              label: "Morning Shift",
              startTime: defaultStart,
              endTime: defaultEnd,
            },
          ];
        }
      });
      return {
        ...prev,
        dutyDays: days,
        weeklyShifts: nextWeeklyShifts,
      };
    });
  };

  const toggleDutyDay = (day: string) => {
    setScheduleForm((prev) => {
      const exists = prev.dutyDays.includes(day);
      const updatedDays = exists
        ? prev.dutyDays.filter((d) => d !== day)
        : [...prev.dutyDays, day];

      const nextWeeklyShifts = { ...prev.weeklyShifts };
      if (!exists) {
        if (!nextWeeklyShifts[day] || nextWeeklyShifts[day].length === 0) {
          const defaultStart = clinicOpenTime || "08:00";
          const defaultEnd =
            timeToMinutes(clinicCloseTime) <= 12 * 60 ? clinicCloseTime : "12:00";
          nextWeeklyShifts[day] = [
            {
              id: `shift-${day.toLowerCase()}-${Date.now()}`,
              label: "Morning Shift",
              startTime: defaultStart,
              endTime: defaultEnd,
            },
          ];
        }
      }
      return { ...prev, dutyDays: updatedDays, weeklyShifts: nextWeeklyShifts };
    });
  };

  const addShiftToDay = (day: string) => {
    setScheduleForm((prev) => {
      const currentShifts = prev.weeklyShifts[day] || [];
      const shiftIndex = currentShifts.length + 1;

      let nextStart = "13:00";
      let nextEnd = clinicCloseTime || "17:00";

      if (currentShifts.length > 0) {
        const lastShift = currentShifts[currentShifts.length - 1];
        const lastEndM = timeToMinutes(lastShift.endTime);
        const clinicCloseM = timeToMinutes(clinicCloseTime);
        const candidateStartM = Math.min(clinicCloseM - 60, lastEndM + 60);
        const candidateEndM = Math.min(clinicCloseM, candidateStartM + 4 * 60);
        if (candidateStartM < clinicCloseM) {
          nextStart = minutesToTime(candidateStartM);
          nextEnd = minutesToTime(candidateEndM);
        }
      }

      const defaultLabel =
        shiftIndex === 1
          ? "Morning Shift"
          : shiftIndex === 2
            ? "Afternoon Shift"
            : `Shift ${shiftIndex}`;

      const newShift: DoctorShift = {
        id: `shift-${day.toLowerCase()}-${Date.now()}`,
        label: defaultLabel,
        startTime: nextStart,
        endTime: nextEnd,
      };

      const updatedShifts = [...currentShifts, newShift];
      const updatedDays = prev.dutyDays.includes(day) ? prev.dutyDays : [...prev.dutyDays, day];

      return {
        ...prev,
        dutyDays: updatedDays,
        weeklyShifts: {
          ...prev.weeklyShifts,
          [day]: updatedShifts,
        },
      };
    });
  };

  const removeShiftFromDay = (day: string, shiftId?: string) => {
    setScheduleForm((prev) => {
      const currentShifts = prev.weeklyShifts[day] || [];
      const updatedShifts = currentShifts.filter((s) => (s.id || s.shiftId) !== shiftId);
      const updatedDays =
        updatedShifts.length === 0
          ? prev.dutyDays.filter((d) => d !== day)
          : prev.dutyDays;

      return {
        ...prev,
        dutyDays: updatedDays,
        weeklyShifts: {
          ...prev.weeklyShifts,
          [day]: updatedShifts,
        },
      };
    });
  };

  const updateShiftInDay = (
    day: string,
    shiftId: string | undefined,
    field: keyof DoctorShift,
    value: any
  ) => {
    setScheduleForm((prev) => {
      const currentShifts = prev.weeklyShifts[day] || [];
      const updatedShifts = currentShifts.map((s) => {
        if ((s.id || s.shiftId) !== shiftId) return s;
        return { ...s, [field]: value };
      });

      return {
        ...prev,
        weeklyShifts: {
          ...prev.weeklyShifts,
          [day]: updatedShifts,
        },
      };
    });
  };

  const copyShiftsToAllSelectedDays = (sourceDay: string) => {
    const sourceShifts = scheduleForm.weeklyShifts[sourceDay] || [];
    if (sourceShifts.length === 0) return;

    setScheduleForm((prev) => {
      const nextWeekly = { ...prev.weeklyShifts };
      prev.dutyDays.forEach((targetDay) => {
        if (targetDay !== sourceDay) {
          nextWeekly[targetDay] = sourceShifts.map((s, idx) => ({
            ...s,
            id: `shift-${targetDay.toLowerCase()}-${idx + 1}-${Date.now()}`,
          }));
        }
      });
      return { ...prev, weeklyShifts: nextWeekly };
    });

    setSuccessMsg(`Copied ${sourceDay}'s shift schedule to all active duty days.`);
    setTimeout(() => setSuccessMsg(""), 3500);
  };

  const resetScheduleForm = () => {
    if (selectedDoctor) {
      const parsed = parseDoctorSchedule(
        selectedDoctor.dutySchedule,
        selectedDoctor.dutyDays,
        clinicOpenTime,
        clinicCloseTime
      );

      const activeDays = Array.isArray(selectedDoctor.dutyDays) && selectedDoctor.dutyDays.length > 0
        ? selectedDoctor.dutyDays
        : ALL_DAYS_OF_WEEK.filter(
          (day) => parsed.weeklyShifts[day] && parsed.weeklyShifts[day].length > 0
        );

      const finalDays = activeDays.length > 0
        ? activeDays
        : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

      setScheduleForm({
        dutyDays: finalDays,
        weeklyShifts: parsed.weeklyShifts,
        doctorSlotInterval: parsed.slotIntervalMinutes ?? null,
      });
    }
    setScheduleError("");
    setScheduleSavedFeedback(null);
  };

  const handleSaveSchedule = async () => {
    if (!selectedDoctor) {
      setScheduleError("Please select a registered doctor first.");
      return;
    }
    if (scheduleForm.dutyDays.length === 0) {
      setScheduleError("Please select at least one weekly duty day.");
      return;
    }

    // Strictly normalize weekly shifts: only active duty days have shifts, others are empty arrays
    const normalizedWeeklyShifts: Record<string, DoctorShift[]> = {};
    ALL_DAYS_OF_WEEK.forEach((d) => {
      normalizedWeeklyShifts[d] = [];
    });

    for (const day of scheduleForm.dutyDays) {
      let shifts = scheduleForm.weeklyShifts[day] || [];
      if (shifts.length === 0) {
        const defaultStart = clinicOpenTime || "08:00";
        const defaultEnd =
          timeToMinutes(clinicCloseTime) <= 12 * 60 ? clinicCloseTime : "12:00";
        shifts = [
          {
            id: `shift-${day.toLowerCase()}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            label: "Morning Shift",
            startTime: defaultStart,
            endTime: defaultEnd,
          },
        ];
      }

      const errors = validateDoctorShifts(shifts, day, clinicOpenTime, clinicCloseTime, clinicOperatingDays);
      if (errors.length > 0) {
        setScheduleError(errors[0].message);
        return;
      }
      normalizedWeeklyShifts[day] = shifts;
    }

    // Sync form state with normalized shifts
    setScheduleForm((prev) => ({
      ...prev,
      weeklyShifts: normalizedWeeklyShifts,
    }));

    setSavingSchedule(true);
    setScheduleError("");
    setScheduleSavedFeedback(null);

    try {
      const serializedSchedule = serializeDoctorSchedule(
        {
          weeklyShifts: normalizedWeeklyShifts,
          slotIntervalMinutes: scheduleForm.doctorSlotInterval ?? undefined,
          isCustomSchedule: true,
        },
        scheduleForm.dutyDays
      );

      // Compute primary start/end time fallback from the first active day
      const firstActiveDay = scheduleForm.dutyDays[0];
      const firstShifts = normalizedWeeklyShifts[firstActiveDay] || [];
      const primaryStart = firstShifts[0]?.startTime || clinicOpenTime || "08:00";
      const primaryEnd =
        firstShifts[firstShifts.length - 1]?.endTime || clinicCloseTime || "17:00";

      const effectiveInterval =
        scheduleForm.doctorSlotInterval || clinicDefaultInterval;

      const updatedDoctor: DoctorAccount = {
        ...selectedDoctor,
        dutyDays: [...scheduleForm.dutyDays],
        dutyStartTime: primaryStart,
        dutyEndTime: primaryEnd,
        dutySchedule: serializedSchedule,
        slotIntervalMinutes: effectiveInterval,
      };

      const nextList = allDoctors.map((d) => (d.id === selectedDoctor.id ? updatedDoctor : d));
      setAllDoctors(nextList);
      try {
        localStorage.setItem("dermai_clinic_doctors", JSON.stringify(nextList));
        localStorage.setItem("dermai_selected_doctor_id", selectedDoctor.id);
      } catch { }

      // Persist to Supabase clinic_doctor table
      const updatePayload: Record<string, unknown> = {
        duty_days: updatedDoctor.dutyDays,
        duty_start_time: updatedDoctor.dutyStartTime,
        duty_end_time: updatedDoctor.dutyEndTime,
        duty_schedule: serializedSchedule,
      };

      // Scope directly by doctor_id (UUID primary key)
      let updateRes = await supabase
        .from("clinic_doctor")
        .update(updatePayload)
        .eq("doctor_id", selectedDoctor.id)
        .select("doctor_id");

      // Retry without duty_schedule if schema issue
      if (updateRes.error && updateRes.error.message?.includes("duty_schedule")) {
        delete updatePayload.duty_schedule;
        updateRes = await supabase
          .from("clinic_doctor")
          .update(updatePayload)
          .eq("doctor_id", selectedDoctor.id)
          .select("doctor_id");
      }

      window.dispatchEvent(new Event("storage"));
      window.dispatchEvent(new CustomEvent("dermai_doctors_updated"));

      const totalConfiguredShifts = Object.values(normalizedWeeklyShifts).flat().length;

      setScheduleSavedFeedback({
        doctorName: updatedDoctor.name,
        daysCount: updatedDoctor.dutyDays.length,
        shiftsCount: totalConfiguredShifts,
      });
      setTimeout(() => setScheduleSavedFeedback(null), 5000);

      if (updateRes.error) {
        console.warn("Notice: could not save schedule to Supabase directly:", updateRes.error);
        setSuccessMsg(`Duty schedule for ${updatedDoctor.name} updated successfully.`);
      } else {
        setSuccessMsg(`Duty schedule and shifts for ${updatedDoctor.name} updated successfully.`);
      }
      setTimeout(() => setSuccessMsg(""), 4500);

      logAuditEvent({
        role: "clinic",
        category: "Clinic",
        action: "Doctor Schedule Updated",
        target: `Dr. ${updatedDoctor.name}`,
        details: `Updated duty schedule for Dr. ${updatedDoctor.name}: ${updatedDoctor.dutyDays.join(", ")} (${totalConfiguredShifts} shifts).`,
        metadata: {
          doctorName: updatedDoctor.name,
          doctorId: updatedDoctor.id,
          dutyDays: updatedDoctor.dutyDays,
          shiftsCount: totalConfiguredShifts,
        },
      }).catch(() => { });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update schedule.";
      setScheduleError(msg);
    } finally {
      setSavingSchedule(false);
    }
  };

  /* ── Edit Doctor Profile Handlers ─────────────────────────────── */
  const handleOpenEditDoctor = (doc: DoctorAccount) => {
    setEditingDoctor(doc);
    setEditError("");

    const resolvedPhoto = resolveAvatarUrl(doc.photo) || "";

    setEditForm({
      name: doc.name || "",
      email: doc.email || "",
      contactNumber: doc.contactNumber || "",
      prcLicense: (doc.prcLicense || "").replace(/^#/, ""),
      selectedSpecializationIds:
        doc.specializations && doc.specializations.length > 0
          ? doc.specializations.map((s) => s.id)
          : [],
      photoFile: null,
      photoPreview: resolvedPhoto,
      removePhoto: false,
    });
  };

  const handleEditPhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setEditError("Please select a valid image file (JPG or PNG).");
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setEditError("Image file size must be less than 8MB.");
      return;
    }

    setEditError("");
    try {
      const compressedDataUrl = await compressImageToDataUrl(file);
      setEditForm((p) => ({ ...p, photoFile: file, photoPreview: compressedDataUrl, removePhoto: false }));
    } catch {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = (reader.result as string) || "";
        setEditForm((p) => ({ ...p, photoFile: file, photoPreview: dataUrl, removePhoto: false }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveEditDoctor = async () => {
    if (!editingDoctor || !clinicId) return;

    const doctorName = editForm.name.trim();
    const doctorEmail = editForm.email.trim().toLowerCase();
    const doctorContact = editForm.contactNumber.trim();
    const doctorLicense = editForm.prcLicense.trim();

    if (!doctorName) {
      setEditError("Full name is required.");
      return;
    }
    if (!doctorEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(doctorEmail)) {
      setEditError("A valid email address is required.");
      return;
    }
    if (!doctorContact || !/^09\d{9}$/.test(doctorContact)) {
      setEditError("Contact number must be an 11-digit Philippine mobile number starting with 09.");
      return;
    }
    if (!doctorLicense) {
      setEditError("PRC License number is required.");
      return;
    }
    if (editForm.selectedSpecializationIds.length === 0) {
      setEditError("Select at least one specialization.");
      return;
    }

    setSavingEditDoctor(true);
    setEditError("");

    try {
      let finalPhotoUrl: string | undefined = editingDoctor.photo;

      if (editForm.removePhoto) {
        finalPhotoUrl = undefined;
      } else if (editForm.photoFile) {
        finalPhotoUrl = await uploadDoctorPhoto(editForm.photoFile);
      }

      // 1. Update clinic_doctor table
      const { error: updateDocError } = await supabase
        .from("clinic_doctor")
        .update({
          doctor_name: doctorName,
          email: doctorEmail,
          contact_number: doctorContact,
          prc_license: doctorLicense,
          photo_url: finalPhotoUrl || null,
        })
        .eq("doctor_id", editingDoctor.id)
        .eq("clinic_id", clinicId);

      if (updateDocError) {
        throw new Error(`Failed to update doctor profile: ${updateDocError.message}`);
      }

      // 2. Update user table if registered
      try {
        await supabase
          .from("user")
          .update({
            full_name: doctorName,
            contact_number: doctorContact,
            ...(finalPhotoUrl ? { avatar_url: finalPhotoUrl } : {}),
          })
          .eq("email", editingDoctor.email);
      } catch {
        // Non-fatal if user update is restricted
      }

      // 3. Update doctor_specializations junction table
      const assignedSpecs = specializations.filter((s) =>
        editForm.selectedSpecializationIds.includes(s.id)
      );

      try {
        await supabase
          .from("doctor_specializations")
          .delete()
          .eq("doctor_id", editingDoctor.id);

        if (assignedSpecs.length > 0) {
          const junctionRows = assignedSpecs.map((spec) => ({
            doctor_id: editingDoctor.id,
            specialization_id: spec.id,
          }));

          const { error: insertSpecsError } = await supabase
            .from("doctor_specializations")
            .insert(junctionRows);

          if (insertSpecsError) {
            console.warn("[ClinicDoctorsPage] Specializations update warning:", insertSpecsError.message);
          }
        }
      } catch (specErr) {
        console.warn("[ClinicDoctorsPage] Exception updating specializations:", specErr);
      }

      // 4. Update local state
      const updatedDoctor: DoctorAccount = {
        ...editingDoctor,
        name: doctorName,
        email: doctorEmail,
        contactNumber: doctorContact,
        prcLicense: doctorLicense,
        photo: finalPhotoUrl,
        specialization: assignedSpecs.map((s) => s.name).join(", "),
        specializations: assignedSpecs,
      };

      setAllDoctors((prev) =>
        prev.map((d) => (d.id === editingDoctor.id ? updatedDoctor : d))
      );

      try {
        const currentCached = localStorage.getItem("dermai_clinic_doctors");
        if (currentCached) {
          const parsed = JSON.parse(currentCached);
          if (Array.isArray(parsed)) {
            const updatedCache = parsed.map((d: any) =>
              d.id === editingDoctor.id ? updatedDoctor : d
            );
            localStorage.setItem("dermai_clinic_doctors", JSON.stringify(updatedCache));
            window.dispatchEvent(new Event("storage"));
            window.dispatchEvent(new CustomEvent("dermai_doctors_updated"));
          }
        }
      } catch {
        // Non-fatal cache persistence
      }

      if (selectedDoctorForDetails && selectedDoctorForDetails.id === editingDoctor.id) {
        setSelectedDoctorForDetails(updatedDoctor);
      }

      setSuccessMsg(`Doctor profile for ${doctorName} updated successfully.`);
      setTimeout(() => setSuccessMsg(""), 4500);

      logAuditEvent({
        role: "clinic",
        category: "Clinic",
        action: "Doctor Profile Updated",
        target: `Dr. ${doctorName}`,
        details: `Updated profile details for Dr. ${doctorName} (PRC: ${doctorLicense || "N/A"}).`,
        metadata: {
          doctorName,
          doctorId: editingDoctor.id,
          doctorEmail,
          prcLicense: doctorLicense,
        },
      }).catch(() => { });

      setEditingDoctor(null);
      await fetchDoctors();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update doctor profile.";
      setEditError(msg);
    } finally {
      setSavingEditDoctor(false);
    }
  };

  // Status toggle
  const handleConfirmStatusToggle = async () => {
    if (!statusConfirmDoctor) return;
    const doctor = statusConfirmDoctor;
    const nextStatus: "Active" | "Inactive" = doctor.status === "Active" ? "Inactive" : "Active";

    setTogglingStatus(true);
    try {
      const updated = allDoctors.map((d) => (d.id === doctor.id ? { ...d, status: nextStatus } : d));
      setAllDoctors(updated);
      localStorage.setItem("dermai_clinic_doctors", JSON.stringify(updated));
      window.dispatchEvent(new Event("storage"));
      window.dispatchEvent(new CustomEvent("dermai_doctors_updated"));

      if (selectedDoctorForDetails && selectedDoctorForDetails.id === doctor.id) {
        setSelectedDoctorForDetails({
          ...selectedDoctorForDetails,
          status: nextStatus,
        });
      }

      setSuccessMsg(`Dr. ${doctor.name} is now ${nextStatus}.`);
      setTimeout(() => setSuccessMsg(""), 3000);

      logAuditEvent({
        role: "clinic",
        category: "Clinic",
        action: "Doctor Status Changed",
        target: `Dr. ${doctor.name}`,
        details: `Dr. ${doctor.name} status updated to ${nextStatus}.`,
        metadata: {
          doctorName: doctor.name,
          doctorId: doctor.id,
          newStatus: nextStatus,
        },
      }).catch(() => { });

      await supabase
        .from("clinic_doctor")
        .update({ status: nextStatus })
        .eq("doctor_id", doctor.id);
    } catch {
      // Local state is preserved
    } finally {
      setTogglingStatus(false);
      setStatusConfirmDoctor(null);
    }
  };

  // Delete doctor
  const executeDelete = async () => {
    if (!deleteTarget) return;
    const filtered = allDoctors.filter((d) => d.id !== deleteTarget);
    setAllDoctors(filtered);
    localStorage.setItem("dermai_clinic_doctors", JSON.stringify(filtered));
    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new CustomEvent("dermai_doctors_updated"));

    if (selectedDoctorForDetails?.id === deleteTarget) {
      setSelectedDoctorForDetails(null);
    }
    const targetId = deleteTarget;
    setDeleteTarget(null);
    setSuccessMsg("Doctor removed successfully.");
    setTimeout(() => setSuccessMsg(""), 4000);

    logAuditEvent({
      role: "clinic",
      category: "Clinic",
      action: "Doctor Archived",
      target: `Doctor ID: ${targetId}`,
      details: `Doctor account was archived/removed from clinic roster.`,
      metadata: {
        doctorId: targetId,
      },
    }).catch(() => { });

    setDeletingDoctor(true);
    try {
      await supabase.from("clinic_doctor").delete().eq("doctor_id", targetId);
    } catch {
      // Local state is preserved
    } finally {
      setDeletingDoctor(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* ── Page Header (Matching UI Reference Photo 2) ─────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900 tracking-tight">
            {activeTab === "schedule" ? "Schedule Duty Hours & Shifts" : "Clinic Doctors & Duty Roster"}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {activeTab === "schedule"
              ? "Configure weekly consultation shifts, time windows, and slot capacities."
              : "Manage attending dermatologists, credentials, working days, and consultation hours."}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap self-start sm:self-auto">
          {activeTab === "schedule" ? (
            <button
              type="button"
              onClick={() => {
                setActiveTab("register");
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold transition-all shadow-2xs cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-gray-600" />
              <span>Back to Doctor Roster</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setActiveTab("schedule");
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 text-xs font-semibold transition-all shadow-2xs cursor-pointer"
            >
              <Calendar className="w-3.5 h-3.5 text-gray-700" />
              <span>Schedule Duty Hours</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              resetRegisterForm();
              setRegisterError("");
              setShowRegisterDoctorModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#801336] hover:bg-[#6c0f2d] text-white text-xs font-semibold transition-all shadow-xs cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Register New Doctor</span>
          </button>
        </div>
      </div>

      {/* ── Global Success Notification ──────────────────────────── */}
      <AnimatePresence>
        {successMsg && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Active Tab Form Card ─────────────────────────────────── */}
      <div ref={formSectionRef}>
        {activeTab === "register" ? (
          /* ══════════════════════════════════════════════════════════
             DOCTOR DASHBOARD & ROSTER
             ══════════════════════════════════════════════════════════ */
          <div className="space-y-6">
            {/* 1. On Duty Today Card (UPDATED UI) */}
            <div className="bg-white rounded-2xl border border-gray-200/70 p-5 sm:p-6 shadow-xs text-left">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-gray-900 tracking-tight">On Duty Today</h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Scheduled to work today, {formattedTodayDate}.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setActiveTab("schedule");
                  }}
                  className="text-xs font-semibold text-[#801336] hover:text-[#5a0c24] cursor-pointer inline-flex items-center gap-1 transition-colors"
                >
                  <span>View all schedules</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {loadingDoctors ? (
                <div className="py-8 text-center">
                  <Loader2 className="w-5 h-5 text-[#801336] animate-spin mx-auto mb-2" />
                  <p className="text-xs text-gray-400">Checking scheduled doctors...</p>
                </div>
              ) : onDutyDoctors.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center bg-gray-50/50 mt-4">
                  <div className="w-9 h-9 rounded-full bg-pink-50 border border-pink-100 flex items-center justify-center mx-auto mb-2">
                    <Stethoscope className="w-4 h-4 text-[#801336]" />
                  </div>
                  <p className="text-sm font-bold text-gray-800">No Doctors on Duty Today ({todayDayName})</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    No attending dermatologists are currently on duty or scheduled for further consultation today.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(270px,330px))] gap-4 mt-4">
                  {onDutyDoctors.map((item) => (
                    <div
                      key={item.doctor.id}
                      className="relative overflow-hidden rounded-2xl border border-pink-100 bg-gradient-to-bl from-pink-100/60 via-pink-50/30 to-white p-4 flex flex-col justify-between text-left shadow-[0_8px_22px_-12px_rgba(128,19,54,0.22)] hover:border-pink-200 hover:shadow-[0_10px_26px_-12px_rgba(128,19,54,0.30)] transition-all w-full max-w-[330px]"
                    >
                      {/* Left accent bar */}
                      <span className="absolute left-0 top-3.5 bottom-3.5 w-1 rounded-r-full bg-gradient-to-b from-[#b0245f] to-[#801336]" />

                      <div>
                        {/* Top row: avatar + name/specialty + On Duty pill */}
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className="relative shrink-0 cursor-pointer"
                              onClick={() => setSelectedDoctorForDetails(item.doctor)}
                              title="Click to view doctor details"
                            >
                              <div className="p-0.5 rounded-full bg-white ring-2 ring-[#b0245f]">
                                <OnDutyDoctorAvatar
                                  name={item.displayName}
                                  photo={item.doctor.photo}
                                />
                              </div>
                            </div>

                            <div className="min-w-0 flex-1">
                              <h3
                                className="font-bold text-sm text-gray-900 truncate hover:text-[#801336] transition-colors cursor-pointer"
                                title={item.displayName}
                                onClick={() => setSelectedDoctorForDetails(item.doctor)}
                              >
                                {item.displayName}
                              </h3>
                              <div className="flex items-center gap-1 text-[11px] text-gray-500 truncate mt-0.5">
                                <Stethoscope className="w-3 h-3 text-gray-400 shrink-0" />
                                <span className="truncate">{item.primarySpec}</span>
                              </div>
                            </div>
                          </div>

                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80 shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            On Duty
                          </span>
                        </div>

                        {/* Duty hours box with clock tile, Today pill and shift progress */}
                        <div className="bg-white/90 rounded-xl border border-pink-100/80 px-3 py-2.5 mt-3 flex items-center gap-2.5 shadow-2xs">
                          <div className="w-8 h-8 rounded-lg bg-pink-100/70 flex items-center justify-center shrink-0">
                            <Clock className="w-4 h-4 text-[#801336]" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-1.5">
                              <span
                                className="font-semibold text-xs sm:text-[13px] text-gray-900 truncate"
                                title={item.hoursDisplay}
                              >
                                {item.hoursDisplay}
                              </span>
                              <span className="text-[10px] font-semibold text-[#801336] bg-pink-100/80 px-2 py-0.5 rounded-full shrink-0">
                                Today
                              </span>
                            </div>
                            <div
                              className="w-full bg-pink-100/70 rounded-full h-1 mt-1.5 overflow-hidden"
                              role="progressbar"
                              aria-label={`${item.displayName} shift progress`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={item.shiftProgress || 35}
                            >
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-[#b0245f] to-[#801336] transition-all"
                                style={{ width: `${item.shiftProgress || 35}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="grid grid-cols-2 gap-2 mt-3 pt-0.5">
                        <button
                          type="button"
                          onClick={() => setSelectedDoctorForDetails(item.doctor)}
                          className="h-9 w-full px-2 rounded-xl text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 transition-colors cursor-pointer shadow-2xs inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                        >
                          <Eye className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                          <span>View details</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDoctorId(item.doctor.id);
                            setActiveTab("schedule");
                          }}
                          className="h-9 w-full px-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-[#801336] to-[#a3246b] hover:from-[#6c0f2d] hover:to-[#8f1d5c] transition-all cursor-pointer shadow-[0_6px_14px_-6px_rgba(128,19,54,0.5)] inline-flex items-center justify-center gap-1 whitespace-nowrap"
                        >
                          <span>Set duty hours</span>
                          <span className="text-white/90 font-bold ml-0.5">›</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 2. All Registered Doctors Card */}
            <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-xs text-left">
              <div className="flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-gray-900">All Registered Doctors</h2>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-pink-100 text-[#801336]">
                      {filteredRegisteredDoctors.length}
                    </span>
                  </div>
                </div>
              </div>

              {/* Search & Filter Controls */}
              <div className="flex items-center gap-3 mt-4">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={doctorSearchQuery}
                    onChange={(e) => setDoctorSearchQuery(e.target.value)}
                    placeholder="Search name or specialty..."
                    className="w-full pl-9 pr-7 py-2 rounded-lg border border-gray-200 text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#801336] transition-all bg-white"
                  />
                  {doctorSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setDoctorSearchQuery("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="relative shrink-0">
                  <select
                    value={selectedSpecialtyFilter}
                    onChange={(e) => setSelectedSpecialtyFilter(e.target.value)}
                    className="appearance-none bg-white border border-gray-200 rounded-lg pl-3 pr-8 py-2 text-xs font-medium text-gray-700 focus:outline-none focus:border-[#801336] cursor-pointer shadow-2xs"
                  >
                    <option value="All Specialties">All Specialties</option>
                    {availableSpecialtyOptions.map((spec) => (
                      <option key={spec} value={spec}>
                        {spec}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {/* Doctors List */}
              {loadingDoctors ? (
                <div className="py-12 text-center">
                  <Loader2 className="w-6 h-6 text-[#801336] animate-spin mx-auto mb-2" />
                  <p className="text-xs text-gray-400">Loading registered doctors...</p>
                </div>
              ) : filteredRegisteredDoctors.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center bg-gray-50/50 mt-4">
                  <Users className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm font-bold text-gray-800">
                    {allDoctors.length === 0 ? "No Doctors Registered" : "No Matching Doctors Found"}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {allDoctors.length === 0
                      ? "Use the form on the right to register your clinic's attending dermatologists."
                      : "Try adjusting your search query or specialty filter."}
                  </p>
                  {(doctorSearchQuery || selectedSpecialtyFilter !== "All Specialties") && (
                    <button
                      type="button"
                      onClick={() => {
                        setDoctorSearchQuery("");
                        setSelectedSpecialtyFilter("All Specialties");
                      }}
                      className="mt-3 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#801336] bg-pink-50 hover:bg-pink-100 border border-pink-200 transition-colors cursor-pointer inline-flex items-center gap-1"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Clear Filters</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-gray-100 mt-4">
                  {filteredRegisteredDoctors.map((doc) => {
                    const cleanDocName = doc.name.trim();
                    const displayName = cleanDocName.startsWith("Dr.") ? cleanDocName : `Dr. ${cleanDocName}`;

                    return (
                      <div
                        key={doc.id}
                        className="py-4.5 first:pt-2 last:pb-0 flex flex-col sm:flex-row sm:items-start justify-between gap-4 text-left"
                      >
                        <div className="flex items-start gap-3.5 min-w-0 flex-1">
                          <RegisteredDoctorAvatar name={doc.name} photo={doc.photo} />

                          <div className="min-w-0 flex-1 space-y-1">
                            {/* Name & PRC */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3
                                className="font-bold text-gray-900 text-sm hover:text-[#801336] transition-colors cursor-pointer"
                                onClick={() => setSelectedDoctorForDetails(doc)}
                              >
                                {displayName}
                              </h3>
                              <span className="text-xs text-gray-400 font-normal">
                                PRC: {doc.prcLicense ? (doc.prcLicense.startsWith("#") ? doc.prcLicense : `#${doc.prcLicense}`) : "#Pending"}
                              </span>
                            </div>

                            {/* Email & Phone */}
                            <p className="text-xs text-gray-500">
                              {doc.email}
                              {doc.contactNumber ? (
                                <>
                                  <span className="mx-1.5 text-gray-300">•</span>
                                  <span>{doc.contactNumber}</span>
                                </>
                              ) : null}
                            </p>

                            {/* Specialization pills */}
                            <div className="flex flex-wrap gap-1.5 pt-0.5">
                              {doc.specializations && doc.specializations.length > 0 ? (
                                doc.specializations.map((spec) => (
                                  <span
                                    key={spec.id}
                                    className="inline-block text-[11px] px-2.5 py-0.5 rounded-full bg-pink-50 text-[#801336] border border-pink-100 font-medium"
                                  >
                                    {spec.name}
                                  </span>
                                ))
                              ) : doc.specialization ? (
                                doc.specialization.split(",").map((s, idx) => (
                                  <span
                                    key={idx}
                                    className="inline-block text-[11px] px-2.5 py-0.5 rounded-full bg-pink-50 text-[#801336] border border-pink-100 font-medium"
                                  >
                                    {s.trim()}
                                  </span>
                                ))
                              ) : (
                                <span className="inline-block text-[11px] px-2.5 py-0.5 rounded-full bg-pink-50 text-[#801336] border border-pink-100 font-medium">
                                  General Dermatology
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-2 shrink-0 self-start pt-1">
                          <button
                            type="button"
                            onClick={() => handleOpenEditDoctor(doc)}
                            className="px-3.5 py-1.5 rounded-lg bg-[#801336] hover:bg-[#6c0f2d] text-white text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
                          >
                            Edit profile
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedDoctorForDetails(doc)}
                            className="px-3.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-medium transition-colors cursor-pointer shadow-2xs"
                          >
                            Details
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(doc.id)}
                            className="px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium transition-colors cursor-pointer shadow-2xs inline-flex items-center gap-1"
                            title="Remove doctor"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Remove</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ══════════════════════════════════════════════════════════
             TAB B: SCHEDULE DUTY HOURS (Reference Image 1)
             ══════════════════════════════════════════════════════════ */
          <div className="space-y-4">
            {/* ── Top Scheduling Workflow Guide Bar (Steps 1–6) ── */}
            <div className="bg-white rounded-2xl border border-gray-200/80 px-4 sm:px-6 py-3.5 shadow-xs">
              <div className="flex items-center justify-between gap-1 sm:gap-2 overflow-x-auto scrollbar-none py-0.5">
                {[
                  { step: 1, label: "Select doctor" },
                  { step: 2, label: "Weekly duty days" },
                  { step: 3, label: "Appointment intervals" },
                  { step: 4, label: "Duty hours" },
                  { step: 5, label: "Review slots" },
                  { step: 6, label: "Save schedule" },
                ].map((item, idx, arr) => (
                  <React.Fragment key={item.step}>
                    <button
                      type="button"
                      onClick={() => setShowInstructionsModal(true)}
                      className="flex items-center gap-2 shrink-0 group text-left cursor-pointer transition-opacity hover:opacity-85"
                      title={`Step ${item.step}: ${item.label} · Click to view detailed guide`}
                    >
                      <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-700 text-xs font-bold leading-none flex items-center justify-center shrink-0 group-hover:bg-gray-200 transition-colors">
                        {item.step}
                      </span>
                      <span className="text-xs sm:text-[13px] font-semibold text-gray-700 group-hover:text-gray-900 whitespace-nowrap transition-colors">
                        {item.label}
                      </span>
                    </button>
                    {idx < arr.length - 1 && (
                      <div className="h-[1.5px] bg-gray-200 flex-1 min-w-[10px] mx-1.5 sm:mx-2.5" />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* ── Two-Column Layout Matching Mockup ── */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* ── Left Column: Select Doctor & Daily Schedule ── */}
              <div className="lg:col-span-8 space-y-5">
                {/* 1. Select Doctor Card */}
                <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-xs space-y-3.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full bg-[#801336] text-white text-[9px] leading-none flex items-center justify-center font-bold shrink-0">
                        1
                      </span>
                      <h3 className="text-sm font-bold text-gray-900">Select doctor</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedDoctor && (
                        <span className="text-[11px] text-gray-600 bg-gray-50 border border-gray-200 px-3 py-1 rounded-full font-medium">
                          Currently editing: <strong className="text-gray-900 font-bold">{selectedDoctor.name}</strong>
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowInstructionsModal(true)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white hover:bg-pink-50 text-[#801336] border border-pink-200 text-[11px] font-semibold transition-colors cursor-pointer"
                        title="View scheduling guide & instructions"
                      >
                        <HelpCircle className="w-3 h-3" />
                        <span>Instructions</span>
                      </button>
                    </div>
                  </div>

                  <DoctorSelectDropdown
                    doctors={allDoctors}
                    selectedDoctorId={selectedDoctor?.id || ""}
                    onSelect={(id) => handleSelectDoctor(id)}
                    disabled={loadingDoctors || savingSchedule}
                  />
                </div>

                {/* 2. Daily Schedule Card */}
                <div className="bg-white rounded-2xl border border-gray-200/80 p-5 sm:p-6 shadow-xs space-y-4">
                  {/* Header */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full bg-[#801336] text-white text-[9px] leading-none flex items-center justify-center font-bold shrink-0">
                        2
                      </span>
                      <h3 className="text-sm font-bold text-gray-900">Daily schedule</h3>
                    </div>
                    <p className="text-[11px] text-gray-500">
                      Clinic hours {clinicOperatingDays}:{" "}
                      <strong className="text-gray-800">
                        {formatTime12h(clinicOpenTime)} – {formatTime12h(clinicCloseTime)}
                      </strong>
                      {" · "}switch a day on or off, open it to edit its shifts
                    </p>
                  </div>

                  {/* Filter / Preset & Expand/Collapse row */}
                  <div className="flex items-center gap-2 flex-wrap text-xs pt-0.5">
                    <button
                      type="button"
                      onClick={() => applyDutyDays(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"])}
                      className="px-3 py-1 rounded-full text-xs font-semibold text-[#801336] bg-pink-50 hover:bg-pink-100/80 border border-pink-200 transition-colors cursor-pointer"
                    >
                      Mon–Fri
                    </button>
                    <button
                      type="button"
                      onClick={() => applyDutyDays([...ALL_DAYS_OF_WEEK])}
                      className="px-3 py-1 rounded-full text-xs font-semibold text-[#801336] bg-pink-50 hover:bg-pink-100/80 border border-pink-200 transition-colors cursor-pointer"
                    >
                      All week
                    </button>
                    {scheduleForm.dutyDays.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setScheduleForm((p) => ({ ...p, dutyDays: [] }))}
                        className="px-3 py-1 rounded-full text-xs font-semibold text-rose-600 bg-white hover:bg-rose-50 border border-gray-200 transition-colors cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                    <span className="text-gray-300 ml-1 mr-1">|</span>
                    <button
                      type="button"
                      onClick={() => setExpandedDays([...ALL_DAYS_OF_WEEK])}
                      className="text-xs font-semibold text-[#801336] hover:underline cursor-pointer"
                    >
                      Expand all
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedDays([])}
                      className="text-xs font-semibold text-gray-500 hover:text-gray-700 hover:underline cursor-pointer ml-2"
                    >
                      Collapse all
                    </button>
                  </div>

                  {/* Days Accordion List */}
                  <div className="space-y-2.5 pt-1">
                    {ALL_DAYS_OF_WEEK.map((day) => {
                      const isDuty = scheduleForm.dutyDays.includes(day);
                      const shifts = scheduleForm.weeklyShifts[day] || [];
                      const isExpanded = expandedDays.includes(day);

                      // Calculate day totals
                      let dayTotalHours = 0;
                      let dayTotalSlots = 0;
                      shifts.forEach((s) => {
                        dayTotalHours += getShiftDurationHours(s.startTime, s.endTime);
                        const eff = getEffectiveShiftSettings(
                          s,
                          {
                            weeklyShifts: scheduleForm.weeklyShifts,
                            slotIntervalMinutes: scheduleForm.doctorSlotInterval ?? undefined,
                          },
                          {
                            defaultSlotIntervalMinutes: clinicDefaultInterval,
                            openTime: clinicOpenTime,
                            closeTime: clinicCloseTime,
                          }
                        );
                        dayTotalSlots += eff.possibleSlots;
                      });

                      const dayErrors = validateDoctorShifts(
                        shifts,
                        day,
                        clinicOpenTime,
                        clinicCloseTime,
                        clinicOperatingDays
                      );

                      const coWorkingForDay = coWorkingDoctors.filter((c) => c.day === day);

                      return (
                        <div
                          key={day}
                          className={`rounded-2xl border transition-all overflow-hidden ${
                            isExpanded && isDuty
                              ? "bg-white border-pink-200 ring-2 ring-pink-500/10 shadow-xs"
                              : "bg-white border-gray-200/80 shadow-2xs hover:border-gray-300"
                          }`}
                        >
                          {/* Day Card Header */}
                          <div
                            onClick={() => toggleExpandDay(day)}
                            className="p-3.5 sm:p-4 flex items-center justify-between cursor-pointer select-none gap-3 flex-wrap sm:flex-nowrap"
                          >
                            {/* Left: Switch, Day name, shifts count, shift badges */}
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              {/* Toggle switch */}
                              {/* Circular check toggle button matching design */}
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={isDuty}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleDutyDay(day);
                                  if (!isDuty && !expandedDays.includes(day)) {
                                    setExpandedDays((prev) => [...prev, day]);
                                  }
                                }}
                                className={`relative flex items-center justify-center shrink-0 cursor-pointer rounded-full transition-all duration-200 focus:outline-none ${
                                  isDuty
                                    ? "w-[22px] h-[22px] bg-[#801336] text-white ring-2 ring-pink-100 shadow-2xs"
                                    : "w-[22px] h-[22px] bg-white border-[1.5px] border-gray-300 hover:border-gray-400"
                                }`}
                                title={isDuty ? `Disable ${day}` : `Enable ${day}`}
                              >
                                {isDuty && (
                                  <Check className="w-3 h-3 text-white stroke-[2.5]" />
                                )}
                              </button>

                              {/* Day name & shifts count */}
                              <div className="min-w-[85px]">
                                <span className={`text-xs font-bold block ${isDuty ? "text-gray-900" : "text-gray-400"}`}>
                                  {day}
                                </span>
                                <span className="text-[11px] text-gray-400 font-medium block">
                                  {isDuty ? `${shifts.length} shift${shifts.length === 1 ? "" : "s"}` : "Off"}
                                </span>
                              </div>

                              {/* Shift time badges in header */}
                              {isDuty && shifts.length > 0 && (
                                <div className="flex items-center gap-2 flex-wrap ml-2">
                                  {shifts.map((s, sIdx) => (
                                    <span
                                      key={s.id || sIdx}
                                      className="inline-flex items-center px-3 py-0.5 rounded-full bg-pink-50 border border-pink-200/80 text-[#801336] text-[11px] font-bold"
                                    >
                                      {formatTime12h(s.startTime)} – {formatTime12h(s.endTime)}
                                    </span>
                                  ))}
                                  {dayErrors.length > 0 && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-semibold border border-amber-200 flex items-center gap-1">
                                      <AlertTriangle className="w-3 h-3" />
                                      Conflict
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Right: Hours & Slots summary + Chevron */}
                            <div className="flex items-center gap-3 shrink-0">
                              {isDuty && shifts.length > 0 && (
                                <div className="text-right">
                                  <span className="text-xs font-bold text-gray-800 block">
                                    {dayTotalHours > 0 ? `${dayTotalHours} hrs` : "0 hrs"}
                                  </span>
                                  <span className="text-[11px] text-gray-500 font-semibold block">
                                    {dayTotalSlots} slots
                                  </span>
                                </div>
                              )}
                              <ChevronDown
                                className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
                                  isExpanded ? "rotate-180 text-[#801336]" : ""
                                }`}
                              />
                            </div>
                          </div>

                          {/* Expanded Body */}
                          {isExpanded && (
                            <div className="border-t border-gray-100 p-4 sm:p-5 space-y-4 bg-white">
                              {/* Action Row */}
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <span className="text-xs text-gray-500 font-medium">
                                  Edit the shifts for {day}
                                </span>

                                <div className="flex items-center gap-2">
                                  {shifts.length > 0 && scheduleForm.dutyDays.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => copyShiftsToAllSelectedDays(day)}
                                      title={`Copy ${day}'s shifts to other selected days`}
                                      className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold text-white bg-[#801336] hover:bg-[#6c0f2d] shadow-2xs transition-colors cursor-pointer"
                                    >
                                      <Copy className="w-3.5 h-3.5 text-white" />
                                      <span>Copy to all days</span>
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => addShiftToDay(day)}
                                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold text-[#801336] bg-white hover:bg-pink-50 border border-pink-200 transition-colors cursor-pointer"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                    <span>+ Add shift</span>
                                  </button>
                                </div>
                              </div>

                              {/* Shifts List */}
                              {shifts.length === 0 ? (
                                <div className="p-4 rounded-xl bg-gray-50 border border-dashed border-gray-200 text-center text-xs text-gray-400">
                                  No shifts configured for {day}. Click "+ Add shift" above to add duty hours.
                                </div>
                              ) : (
                                <div className="space-y-3">
                                  {shifts.map((shift, idx) => {
                                    const duration = getShiftDurationHours(shift.startTime, shift.endTime);
                                    const effectiveSettings = getEffectiveShiftSettings(
                                      shift,
                                      {
                                        weeklyShifts: scheduleForm.weeklyShifts,
                                        slotIntervalMinutes: scheduleForm.doctorSlotInterval ?? undefined,
                                      },
                                      {
                                        defaultSlotIntervalMinutes: clinicDefaultInterval,
                                        openTime: clinicOpenTime,
                                        closeTime: clinicCloseTime,
                                      }
                                    );
                                    const { interval: effectiveInterval, intervalSource, possibleSlots } = effectiveSettings;

                                    // Break duration between shifts
                                    let breakText = "";
                                    if (idx > 0) {
                                      const prevShift = shifts[idx - 1];
                                      const breakMinutes = timeToMinutes(shift.startTime) - timeToMinutes(prevShift.endTime);
                                      if (breakMinutes > 0) {
                                        breakText = formatBreakDuration(breakMinutes);
                                      }
                                    }

                                    return (
                                      <React.Fragment key={shift.id || idx}>
                                        {/* Break indicator */}
                                        {breakText && (
                                          <div className="relative flex items-center justify-center my-3">
                                            <div className="absolute inset-0 flex items-center">
                                              <div className="w-full border-t border-dashed border-gray-200" />
                                            </div>
                                            <span className="relative px-3 bg-white text-[11px] font-semibold text-gray-400">
                                              {breakText}
                                            </span>
                                          </div>
                                        )}

                                        {/* Shift Card */}
                                        <div className="p-4 rounded-2xl bg-white border border-pink-100 shadow-2xs space-y-3">
                                          {/* Row 1: Inputs */}
                                          <div className="flex items-center gap-2.5 flex-wrap">
                                            {/* Badge index */}
                                            <div className="flex flex-col">
                                              <span className="text-[11px] font-semibold text-transparent select-none mb-1">#</span>
                                              <span className="w-7 h-8 rounded-lg bg-gray-50 border border-gray-200 text-gray-700 font-bold text-xs flex items-center justify-center shrink-0 shadow-2xs">
                                                {idx + 1}
                                              </span>
                                            </div>

                                            {/* Shift name */}
                                            <div className="flex-1 min-w-[130px] sm:min-w-[170px]">
                                              <label className="text-[11px] font-semibold text-gray-500 block mb-1">
                                                Shift name
                                              </label>
                                              <input
                                                type="text"
                                                value={shift.label}
                                                onChange={(e) =>
                                                  updateShiftInDay(day, shift.id, "label", e.target.value)
                                                }
                                                placeholder={idx === 0 ? "Morning Shift" : "Afternoon Shift"}
                                                className="h-8 w-full px-2.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-800 focus:outline-none focus:border-[#801336] shadow-2xs"
                                              />
                                            </div>

                                            {/* Start time */}
                                            <div className="w-[115px]">
                                              <label className="text-[11px] font-semibold text-gray-500 block mb-1">
                                                Start
                                              </label>
                                              <ModernTimeSelect
                                                value={shift.startTime}
                                                options={clinicTimeOptions}
                                                compact={true}
                                                onChange={(val) =>
                                                  updateShiftInDay(day, shift.id, "startTime", val)
                                                }
                                              />
                                            </div>

                                            <div className="flex flex-col justify-end h-full pt-4">
                                              <span className="text-gray-400 font-medium text-xs px-1">to</span>
                                            </div>

                                            {/* End time */}
                                            <div className="w-[115px]">
                                              <label className="text-[11px] font-semibold text-gray-500 block mb-1">
                                                End
                                              </label>
                                              <ModernTimeSelect
                                                value={shift.endTime}
                                                options={clinicTimeOptions.filter(
                                                  (opt) => timeToMinutes(opt.value) > timeToMinutes(shift.startTime || "00:00")
                                                )}
                                                compact={true}
                                                onChange={(val) =>
                                                  updateShiftInDay(day, shift.id, "endTime", val)
                                                }
                                              />
                                            </div>

                                            {/* Slot Interval */}
                                            <div className="w-[135px]">
                                              <label className="text-[11px] font-semibold text-gray-500 block mb-1">
                                                Slot interval
                                              </label>
                                              <div className="relative">
                                                <select
                                                  disabled={savingSchedule}
                                                  value={
                                                    shift.slotIntervalMinutes !== undefined && shift.slotIntervalMinutes !== null
                                                      ? shift.slotIntervalMinutes
                                                      : "default"
                                                  }
                                                  onChange={(e) => {
                                                    const val = e.target.value;
                                                    updateShiftInDay(
                                                      day,
                                                      shift.id,
                                                      "slotIntervalMinutes",
                                                      val === "default" ? undefined : Number(val)
                                                    );
                                                  }}
                                                  className="h-8 w-full pl-2.5 pr-7 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-800 appearance-none focus:outline-none focus:border-[#801336] transition-colors cursor-pointer shadow-2xs"
                                                >
                                                  <option value="default">
                                                    Default ({effectiveInterval}m)
                                                  </option>
                                                  {APPOINTMENT_INTERVAL_OPTIONS.map((opt) => (
                                                    <option key={opt.value} value={opt.value}>
                                                      {opt.label}
                                                    </option>
                                                  ))}
                                                </select>
                                                <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                                              </div>
                                            </div>

                                            {/* Delete Shift Button */}
                                            <div className="flex flex-col justify-end pt-4">
                                              <button
                                                type="button"
                                                onClick={() => removeShiftFromDay(day, shift.id)}
                                                title="Remove this shift"
                                                className="h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer shrink-0"
                                              >
                                                <X className="w-4 h-4" />
                                              </button>
                                            </div>
                                          </div>

                                          {/* Row 2: Capacity Badges */}
                                          <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-gray-200/60">
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <span className="text-[11px] font-semibold text-gray-500">Capacity</span>
                                              <span className="h-6 px-2.5 rounded-lg bg-white border border-gray-200 text-gray-700 font-medium text-[11px] flex items-center shadow-2xs">
                                                {duration > 0 ? `${duration} hrs` : "0 hrs"}
                                              </span>
                                              <span className="h-6 px-2.5 rounded-lg bg-pink-50 border border-pink-200/80 text-[#801336] font-bold text-[11px] flex items-center">
                                                {possibleSlots} slots ({effectiveInterval}m)
                                              </span>
                                              <span className="h-6 px-2 rounded-lg bg-gray-100 text-gray-600 border border-gray-200 text-[10px] font-medium flex items-center">
                                                • {intervalSource === "shift" ? "Shift override" : intervalSource === "doctor" ? "Doctor default" : "Clinic default"}
                                              </span>
                                            </div>

                                            <div>
                                              <span className="h-6 px-2.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[11px] flex items-center">
                                                {possibleSlots} bookable
                                              </span>
                                            </div>
                                          </div>
                                        </div>
                                      </React.Fragment>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Shift Errors if any */}
                              {dayErrors.length > 0 && (
                                <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] space-y-1">
                                  {dayErrors.map((err, errIdx) => (
                                    <p key={errIdx} className="flex items-center gap-1.5">
                                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                      <span>{err.message}</span>
                                    </p>
                                  ))}
                                </div>
                              )}

                              {/* Co-Working Doctors Notice for this specific day */}
                              {coWorkingForDay.length > 0 && (
                                <div className="space-y-1.5">
                                  {coWorkingForDay.map((c, cIdx) => (
                                    <div
                                      key={cIdx}
                                      className="p-2.5 rounded-xl bg-blue-50/70 border border-blue-200/80 text-blue-900 text-xs flex items-center gap-2 font-medium"
                                    >
                                      <span className="w-1.5 h-1.5 rounded-full bg-blue-600 shrink-0"></span>
                                      <span>
                                        <strong>{c.doctorName}</strong> also on duty {formatTime12h(c.dutyStart)} – {formatTime12h(c.dutyEnd)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* ── Right Column: Weekly Summary, Appointment Interval, Slot Preview, Co-Working ── */}
              <div className="lg:col-span-4 space-y-4">
                {/* 1. Weekly Summary Card (Gradient Card Matching Mockup) */}
                <div className="rounded-3xl p-5 sm:p-6 bg-gradient-to-br from-[#7a1233] via-[#8d1840] to-[#9c1e4d] text-white shadow-xs space-y-4">
                  <div>
                    <span className="text-[11px] font-medium text-white/80 block">
                      Weekly summary
                    </span>
                    <h4 className="text-base font-bold text-white mt-0.5 truncate">
                      {selectedDoctor?.name || "Select Doctor"}
                    </h4>
                  </div>

                  {/* 3 Metrics */}
                  <div className="grid grid-cols-3 gap-2 text-left">
                    <div>
                      <span className="text-3xl font-extrabold text-white block">
                        {weeklyMetrics.activeDaysCount}
                      </span>
                      <span className="text-[11px] text-white/75 font-medium block">
                        days on duty
                      </span>
                    </div>

                    <div>
                      <span className="text-3xl font-extrabold text-white block">
                        {weeklyMetrics.totalHours}h
                      </span>
                      <span className="text-[11px] text-white/75 font-medium block">
                        per week
                      </span>
                    </div>

                    <div>
                      <span className="text-3xl font-extrabold text-white block">
                        {weeklyMetrics.totalSlots}
                      </span>
                      <span className="text-[11px] text-white/75 font-medium block">
                        slots / week
                      </span>
                    </div>
                  </div>

                  {/* 7 Weekday Badges */}
                  <div className="flex items-center justify-between gap-1.5 pt-3 border-t border-white/20">
                    {DAY_INITIALS.map(({ day, initial }, idx) => {
                      const isActive = scheduleForm.dutyDays.includes(day);
                      return (
                        <span
                          key={idx}
                          className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs transition-all ${
                            isActive
                              ? "bg-white text-[#801336] shadow-2xs font-extrabold"
                              : "bg-white/20 text-white/70 font-semibold"
                          }`}
                          title={`${day}: ${isActive ? "Active on duty" : "Off"}`}
                        >
                          {initial}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Appointment Interval Settings Card */}
                <div className="p-4 sm:p-5 rounded-2xl bg-white border border-gray-200/90 shadow-2xs space-y-4">
                  <div>
                    <h4 className="text-xs sm:text-sm font-bold text-gray-900">
                      Appointment interval
                    </h4>
                  </div>

                  <div className="space-y-3">
                    {/* Doctor's Default Interval */}
                    <div className="p-3.5 rounded-xl bg-gray-50/70 border border-gray-200/80 space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-gray-800">
                          Doctor's default
                        </label>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            scheduleForm.doctorSlotInterval === null
                              ? "bg-gray-100 text-gray-600 border-gray-200"
                              : "bg-sky-50 text-sky-700 border-sky-200"
                          }`}
                        >
                          {scheduleForm.doctorSlotInterval === null
                            ? `Using clinic default`
                            : `Preference: ${scheduleForm.doctorSlotInterval} mins`}
                        </span>
                      </div>

                      <div className="relative">
                        <select
                          disabled={savingSchedule}
                          value={scheduleForm.doctorSlotInterval === null ? "default" : scheduleForm.doctorSlotInterval}
                          onChange={(e) => {
                            const val = e.target.value;
                            setScheduleForm((prev) => ({
                              ...prev,
                              doctorSlotInterval: val === "default" ? null : Number(val),
                            }));
                          }}
                          className="w-full h-9 px-3 pr-8 bg-white border border-gray-200 rounded-xl text-xs font-semibold text-gray-900 appearance-none focus:outline-none focus:border-[#801336] hover:border-gray-300 transition-colors cursor-pointer"
                        >
                          <option value="default">Inherit Clinic Default ({clinicDefaultInterval} minutes)</option>
                          {APPOINTMENT_INTERVAL_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>

                    {/* Clinic Default Interval */}
                    <div className="p-3.5 rounded-xl bg-gray-50/70 border border-gray-200/80 space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-gray-800">
                          Clinic default
                        </label>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Clinic default
                        </span>
                      </div>

                      <div className="flex items-center justify-between h-9 px-3 bg-white border border-gray-200/80 rounded-xl text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-gray-900">{clinicDefaultInterval} minutes</span>
                          <span className="text-[11px] text-gray-400">· operating</span>
                        </div>
                        <span className="text-[11px] font-semibold text-gray-600 bg-gray-50 px-2 py-0.5 rounded-md border border-gray-200/60 shadow-2xs">
                          ~{Math.round(60 / clinicDefaultInterval)} slots / hr
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Slot Preview Card */}
                <div className="p-4 sm:p-5 rounded-2xl bg-white border border-gray-200/90 shadow-2xs space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs sm:text-sm font-bold text-gray-900">
                      Slot preview
                    </h4>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {estimatedCapacityBreakdown.summaryText}
                    </span>
                  </div>

                  {shiftSummaries.length === 0 ? (
                    <div className="p-4 rounded-xl bg-gray-50/70 border border-dashed border-gray-200 text-center text-xs text-gray-400">
                      Set the doctor's duty hours to preview appointment slots.
                    </div>
                  ) : (
                    <div className="max-h-[380px] overflow-y-auto pr-1 space-y-2.5">
                      {shiftSummaries.map(({ day, shift, effective }, sIdx) => {
                        const duration = getShiftDurationHours(shift.startTime, shift.endTime);

                        return (
                          <div
                            key={sIdx}
                            className="p-3 rounded-xl bg-gray-50/80 border border-gray-200/70 space-y-1.5 text-xs"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-gray-900">
                                {day.slice(0, 3)} · {shift.label}
                              </span>
                              <span className="text-[10px] text-gray-500 font-mono">
                                {duration}h active
                              </span>
                            </div>

                            <div className="text-[11px] text-gray-600 flex items-center justify-between">
                              <span>Hours</span>
                              <strong className="text-gray-800">
                                {formatTime12h(shift.startTime)} – {formatTime12h(shift.endTime)}
                              </strong>
                            </div>

                            <div className="text-[11px] text-gray-600 flex items-center justify-between">
                              <span>Available ({effective.interval}m)</span>
                              <strong className="text-gray-900">
                                {effective.possibleSlots} slots
                              </strong>
                            </div>

                            <div className="text-[11px] text-gray-600 flex items-center justify-between">
                              <span>Interval source</span>
                              <span className="font-semibold capitalize text-gray-700">
                                {effective.intervalSource === "shift"
                                  ? "Shift override"
                                  : effective.intervalSource === "doctor"
                                    ? "Doctor default"
                                    : "Clinic default"}
                              </span>
                            </div>

                            <div className="pt-1 border-t border-gray-200/60 flex items-center justify-between text-[11px]">
                              <span className="text-gray-600 font-medium">Bookable slots</span>
                              <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 font-bold text-[10px]">
                                {effective.possibleSlots} slots max
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 4. Co-Working on Duty Card */}
                {coWorkingDoctors.length > 0 && (
                  <div className="p-4 rounded-2xl bg-blue-50/70 border border-blue-200/80 space-y-2">
                    <h4 className="text-xs font-bold text-blue-900">
                      Co-working on duty · {new Set(coWorkingDoctors.map((c) => c.doctorName)).size} other doctor{new Set(coWorkingDoctors.map((c) => c.doctorName)).size > 1 ? "s" : ""}
                    </h4>
                    <div className="space-y-1 text-[11px] text-blue-700 font-medium">
                      {coWorkingDoctors.map((c, idx) => (
                        <p key={idx}>
                          <strong>{c.day}:</strong> {c.doctorName} ({formatTime12h(c.dutyStart)} – {formatTime12h(c.dutyEnd)})
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Actions: Save & Reset */}
            <div className="bg-white rounded-2xl border border-gray-200/80 p-4 shadow-xs">
              {/* Inline Schedule Save Success Notification */}
              {scheduleSavedFeedback && (
                <div className="mb-3 flex items-center gap-2.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-xl px-4 py-3 shadow-xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    Duty schedule successfully saved for <strong>{scheduleSavedFeedback.doctorName}</strong> ({scheduleSavedFeedback.daysCount} active days, {scheduleSavedFeedback.shiftsCount} shift{scheduleSavedFeedback.shiftsCount > 1 ? "s" : ""} configured).
                  </span>
                </div>
              )}

              {scheduleError && (
                <div className="mb-3 flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {scheduleError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={resetScheduleForm}
                  disabled={savingSchedule}
                  className="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-xs font-bold hover:bg-gray-50 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  Reset Form
                </button>
                <button
                  type="button"
                  onClick={handleSaveSchedule}
                  disabled={savingSchedule || !selectedDoctor}
                  className={`inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-60 shadow-xs cursor-pointer ${
                    scheduleSavedFeedback
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                      : "bg-[#801336] hover:bg-[#6c0f2d] text-white"
                  }`}
                >
                  {savingSchedule ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving Schedule...</span>
                    </>
                  ) : scheduleSavedFeedback ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                      <span>Schedule Saved!</span>
                    </>
                  ) : (
                    <span>Save Schedule</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>



      {/* ── Edit Doctor Profile Modal ────────────────────────────── */}
      <ModalPortal isOpen={Boolean(editingDoctor)}>
        <AnimatePresence>
          {editingDoctor && (
            <div className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 8 }}
                className="relative z-[9999] w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-100 max-h-[92vh] flex flex-col text-left"
              >
                {/* Modal Header */}
                <div className="px-6 pt-5 pb-3.5 flex items-center justify-between border-b border-gray-100 bg-gray-50/50 shrink-0">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-pink-50 text-[#c0166a] border border-pink-100 flex items-center justify-center shrink-0">
                      <Edit3 className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">Edit Doctor Profile</h3>
                      <p className="text-[11px] text-gray-500">
                        Update credentials and details for {editingDoctor.name}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingDoctor(null)}
                    disabled={savingEditDoctor}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Modal Body */}
                <div className="p-6 overflow-y-auto space-y-4 text-xs">
                  {/* Doctor Photo Section */}
                  <div className="p-3.5 rounded-xl bg-gray-50/60 border border-gray-100 flex items-center gap-4">
                    <div className="relative shrink-0">
                      {editForm.photoPreview && !editForm.removePhoto ? (
                        <img
                          src={editForm.photoPreview}
                          alt="Doctor Preview"
                          className="w-14 h-14 rounded-xl object-cover border border-pink-200 shadow-2xs"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-xl bg-white border border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400">
                          <Camera className="w-5 h-5 text-gray-400" />
                          <span className="text-[8px] font-bold text-gray-400 mt-0.5">Photo</span>
                        </div>
                      )}
                      <input
                        ref={editPhotoFileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleEditPhotoSelect}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-bold text-gray-800">Doctor Profile Picture</h4>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        Headshot displayed for patient appointment booking (JPG/PNG, max 8MB).
                      </p>
                      <div className="mt-2.5 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => editPhotoFileInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
                        >
                          <Upload className="w-3.5 h-3.5 text-[#c0166a]" />
                          <span>{editForm.photoPreview && !editForm.removePhoto ? "Change Photo" : "Upload Headshot"}</span>
                        </button>
                        {editForm.photoPreview && !editForm.removePhoto && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditForm((p) => ({ ...p, photoFile: null, photoPreview: "", removePhoto: true }));
                              if (editPhotoFileInputRef.current) editPhotoFileInputRef.current.value = "";
                            }}
                            className="inline-flex items-center px-3 py-1.5 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-600 text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Form Fields Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <div className="flex items-center justify-between mb-1.5 h-4">
                        <label className="text-xs font-bold text-gray-700">
                          Full Name <span className="text-[#c0166a]">*</span>
                        </label>
                      </div>
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                        placeholder="e.g. Dr. Nathan Bayutas"
                        className="w-full h-10 px-3.5 rounded-xl border border-gray-200 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-magenta-500 focus:border-[#c0166a] transition-all bg-white shadow-2xs"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5 h-4">
                        <label className="text-xs font-bold text-gray-700">
                          Email (used for login) <span className="text-[#c0166a]">*</span>
                        </label>
                      </div>
                      <input
                        type="email"
                        value={editForm.email}
                        onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))}
                        placeholder="doctor@example.com"
                        className="w-full h-10 px-3.5 rounded-xl border border-gray-200 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-magenta-500 focus:border-[#c0166a] transition-all bg-white shadow-2xs"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5 h-4">
                        <label className="text-xs font-bold text-gray-700">
                          Contact Number <span className="text-[#c0166a]">*</span>
                        </label>
                        <span className="text-[10px] text-gray-400 font-normal">11 digits</span>
                      </div>
                      <input
                        type="tel"
                        maxLength={11}
                        value={editForm.contactNumber}
                        onChange={(e) =>
                          setEditForm((p) => ({
                            ...p,
                            contactNumber: e.target.value.replace(/\D/g, "").slice(0, 11),
                          }))
                        }
                        placeholder="09171234567"
                        className="w-full h-10 px-3.5 rounded-xl border border-gray-200 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-magenta-500 focus:border-[#c0166a] transition-all bg-white shadow-2xs"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5 h-4">
                        <label className="text-xs font-bold text-gray-700">
                          PRC License # <span className="text-[#c0166a]">*</span>
                        </label>
                        <span className="text-[10px] text-gray-400 font-normal">Max 7 chars</span>
                      </div>
                      <input
                        type="text"
                        maxLength={7}
                        value={editForm.prcLicense}
                        onChange={(e) =>
                          setEditForm((p) => ({
                            ...p,
                            prcLicense: e.target.value.slice(0, 7),
                          }))
                        }
                        placeholder="e.g. PR11111"
                        className="w-full h-10 px-3.5 rounded-xl border border-gray-200 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-magenta-500 focus:border-[#c0166a] transition-all bg-white shadow-2xs"
                      />
                    </div>

                    {/* Specialization Selection */}
                    <div className="sm:col-span-2">
                      <div className="flex items-center justify-between mb-1.5 h-4">
                        <label className="text-xs font-bold text-gray-700">
                          Specialization <span className="text-[#c0166a]">*</span>
                        </label>
                        <span className="text-[10px] text-gray-400 font-normal">Select clinical areas</span>
                      </div>
                      <SpecializationMultiSelect
                        options={specializations}
                        selectedIds={editForm.selectedSpecializationIds}
                        onChange={(ids) =>
                          setEditForm((p) => ({ ...p, selectedSpecializationIds: ids }))
                        }
                        placeholder="Select clinical specializations..."
                        disabled={savingEditDoctor}
                      />
                    </div>
                  </div>

                  {/* Error Banner */}
                  {editError && (
                    <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{editError}</span>
                    </div>
                  )}
                </div>

                {/* Modal Footer */}
                <div className="px-6 py-4 bg-gray-50/70 border-t border-gray-100 flex items-center justify-end gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditingDoctor(null)}
                    disabled={savingEditDoctor}
                    className="h-10 px-5 rounded-xl border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-100 transition-colors disabled:opacity-50 cursor-pointer inline-flex items-center justify-center"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveEditDoctor}
                    disabled={savingEditDoctor}
                    className="h-10 inline-flex items-center justify-center gap-2 px-5 rounded-xl bg-[#c0166a] hover:bg-[#a01258] text-white text-xs font-bold transition-all disabled:opacity-60 shadow-xs cursor-pointer"
                  >
                    {savingEditDoctor ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Saving Changes...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Save Changes</span>
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </ModalPortal>

      {/* ── Register New Doctor Modal ──────────────────────────────── */}
      <ModalPortal isOpen={Boolean(showRegisterDoctorModal)}>
        <AnimatePresence>
          {showRegisterDoctorModal && (
            <div className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 8 }}
                className="relative z-[9999] w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-100 max-h-[90vh] flex flex-col text-left"
              >
                {/* Modal Header */}
                <div className="px-6 pt-5 pb-4 flex items-start justify-between border-b border-gray-100 bg-gray-50/50 shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-pink-50 border border-pink-100 text-[#801336] flex items-center justify-center shrink-0">
                      <UserPlus className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-gray-900">Register New Doctor</h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Add a new attending dermatologist to your clinic roster.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowRegisterDoctorModal(false)}
                    disabled={savingDoctor}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Scrollable Form Body */}
                <div className="p-6 overflow-y-auto space-y-4">
                  {/* Profile picture upload box */}
                  <div className="border border-dashed border-gray-200 rounded-xl p-3.5 flex items-center gap-3.5 bg-gray-50/50">
                    <div className="w-12 h-12 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0 overflow-hidden">
                      {registerForm.photoPreview ? (
                        <img
                          src={registerForm.photoPreview}
                          alt="Doctor Preview"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Camera className="w-5 h-5 text-gray-400" />
                      )}
                      <input
                        ref={photoFileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handlePhotoSelect}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-semibold text-gray-800">Profile picture</h4>
                      <p className="text-[11px] text-gray-400 mt-0.5">JPG/PNG, max 8MB</p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => photoFileInputRef.current?.click()}
                          className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-medium transition-colors cursor-pointer shadow-2xs"
                        >
                          <span>{registerForm.photoPreview ? "Change photo" : "Upload headshot"}</span>
                        </button>
                        {registerForm.photoPreview && (
                          <button
                            type="button"
                            onClick={() => {
                              setRegisterForm((p) => ({ ...p, photoFile: null, photoPreview: "" }));
                              if (photoFileInputRef.current) photoFileInputRef.current.value = "";
                            }}
                            className="text-xs text-rose-500 hover:text-rose-600 font-medium cursor-pointer"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Inputs: Vertical stack */}
                  <div className="space-y-3.5">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Full name <span className="text-[#801336]">*</span>
                      </label>
                      <input
                        type="text"
                        value={registerForm.name}
                        onChange={(e) => setRegisterForm((p) => ({ ...p, name: e.target.value }))}
                        placeholder="e.g. Dr. Maria Santos"
                        className="w-full h-9 px-3 rounded-lg border border-gray-200 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#801336] transition-all bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Email (used for login) <span className="text-[#801336]">*</span>
                      </label>
                      <input
                        type="email"
                        value={registerForm.email}
                        onChange={(e) => setRegisterForm((p) => ({ ...p, email: e.target.value }))}
                        placeholder="doctor@example.com"
                        className="w-full h-9 px-3 rounded-lg border border-gray-200 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#801336] transition-all bg-white"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-gray-700">
                          Contact number <span className="text-[#801336]">*</span>
                        </label>
                        <span className="text-[10px] text-gray-400 font-normal">11 digits</span>
                      </div>
                      <input
                        type="tel"
                        maxLength={11}
                        value={registerForm.contactNumber}
                        onChange={(e) =>
                          setRegisterForm((p) => ({
                            ...p,
                            contactNumber: e.target.value.replace(/\D/g, "").slice(0, 11),
                          }))
                        }
                        placeholder="09171234567"
                        className="w-full h-9 px-3 rounded-lg border border-gray-200 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#801336] transition-all bg-white"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-gray-700">
                          PRC license # <span className="text-[#801336]">*</span>
                        </label>
                        <span className="text-[10px] text-gray-400 font-normal">Max 7 chars</span>
                      </div>
                      <input
                        type="text"
                        maxLength={7}
                        value={registerForm.prcLicense}
                        onChange={(e) =>
                          setRegisterForm((p) => ({
                            ...p,
                            prcLicense: e.target.value.slice(0, 7),
                          }))
                        }
                        placeholder="e.g. 0123456 or PR12345"
                        className="w-full h-9 px-3 rounded-lg border border-gray-200 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#801336] transition-all bg-white"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-gray-700">
                          Specialization <span className="text-[#801336]">*</span>
                        </label>
                        {loadingSpecializations && (
                          <span className="text-[10px] text-gray-400 flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" /> Loading...
                          </span>
                        )}
                      </div>
                      <SpecializationMultiSelect
                        options={specializations}
                        selectedIds={registerForm.selectedSpecializationIds}
                        onChange={(ids) =>
                          setRegisterForm((p) => ({ ...p, selectedSpecializationIds: ids }))
                        }
                        placeholder="Select one or more specializations..."
                        disabled={loadingSpecializations || savingDoctor}
                      />
                    </div>
                  </div>

                  {registerError && (
                    <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      <AlertCircle className="w-4 h-4 shrink-0" /> {registerError}
                    </div>
                  )}
                </div>

                {/* Modal Footer */}
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={resetRegisterForm}
                    disabled={savingDoctor}
                    className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 text-xs font-semibold hover:bg-gray-100 transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowRegisterDoctorModal(false)}
                    disabled={savingDoctor}
                    className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 text-xs font-semibold hover:bg-gray-100 transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleInitiateAddDoctor}
                    disabled={savingDoctor}
                    className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#801336] hover:bg-[#6c0f2d] text-white text-xs font-semibold transition-colors disabled:opacity-60 shadow-2xs cursor-pointer"
                  >
                    {savingDoctor && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Add doctor to roster</span>
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </ModalPortal>

      {/* ── Add Doctor Confirmation Modal ────────────────────────── */}
      <ModalPortal isOpen={Boolean(showRegisterConfirmModal)}>
        <AnimatePresence>
          {showRegisterConfirmModal && (
            <div className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 8 }}
                className="relative z-[9999] w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-100 max-h-[90vh] flex flex-col text-left"
              >
                <div className="px-6 pt-5 pb-3 flex items-start justify-between border-b border-gray-100 bg-gray-50/50 shrink-0">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-magenta-100 text-[#c0166a] flex items-center justify-center shrink-0">
                      <UserPlus className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">Confirm Doctor Profile</h3>
                      <p className="text-[11px] text-gray-500">Please review doctor information</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowRegisterConfirmModal(false)}
                    disabled={savingDoctor}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-6 overflow-y-auto space-y-3.5 text-xs">
                  <div className="p-3.5 rounded-xl bg-gray-50/70 border border-gray-100 flex items-center gap-3">
                    {registerForm.photoPreview ? (
                      <img
                        src={registerForm.photoPreview}
                        alt="Doctor"
                        className="w-12 h-12 rounded-xl object-cover border border-magenta-200 shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-white border border-gray-200 text-[#c0166a] flex items-center justify-center shrink-0">
                        <Stethoscope className="w-5 h-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <h4 className="font-bold text-gray-900 text-sm truncate">
                        {registerForm.name.trim()}
                      </h4>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        PRC: #{registerForm.prcLicense.trim()} • {registerForm.contactNumber.trim()}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-100">
                      <span className="text-[9px] font-bold text-gray-400 uppercase block">EMAIL</span>
                      <p className="font-semibold text-gray-900 mt-0.5 truncate">
                        {registerForm.email.trim()}
                      </p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-100">
                      <span className="text-[9px] font-bold text-gray-400 uppercase block">CLINIC</span>
                      <p className="font-semibold text-gray-900 mt-0.5 truncate">{clinicDisplayName}</p>
                    </div>
                  </div>
                </div>

                <div className="px-6 py-3 bg-gray-50/80 border-t border-gray-100 flex items-center justify-end gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowRegisterConfirmModal(false)}
                    disabled={savingDoctor}
                    className="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-xs font-bold hover:bg-gray-100 transition-colors cursor-pointer"
                  >
                    Back to Edit
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmSaveDoctor}
                    disabled={savingDoctor}
                    className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-[#c0166a] hover:bg-[#a01258] text-white text-xs font-bold transition-colors disabled:opacity-60 shadow-xs cursor-pointer"
                  >
                    {savingDoctor && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Confirm &amp; Add Doctor</span>
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </ModalPortal>

      {/* ── Doctor Details Modal ─────────────────────────────────── */}
      <ModalPortal isOpen={Boolean(selectedDoctorForDetails)}>
        <AnimatePresence>
          {selectedDoctorForDetails && (
            <div className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 8 }}
                className="relative z-[9999] w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-100 text-left flex flex-col"
              >
                <div className="px-6 pt-5 pb-3 flex items-start justify-between border-b border-gray-100">
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">Doctor Details</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{selectedDoctorForDetails.clinicName}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedDoctorForDetails(null)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-6 space-y-3.5 max-h-[75vh] overflow-y-auto">
                  <div className="flex items-center gap-3">
                    {selectedDoctorForDetails.photo ? (
                      <img
                        src={selectedDoctorForDetails.photo}
                        alt={selectedDoctorForDetails.name}
                        className="w-14 h-14 rounded-xl object-cover border border-magenta-200 shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-magenta-50 border border-magenta-100 flex items-center justify-center shrink-0">
                        <Stethoscope className="w-6 h-6 text-[#c0166a]" />
                      </div>
                    )}
                    <div>
                      <h4 className="font-bold text-gray-900 text-sm">
                        {selectedDoctorForDetails.name}
                      </h4>
                      <div className="mt-1">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${selectedDoctorForDetails.status === "Active"
                            ? "bg-emerald-50 text-emerald-600 border border-emerald-100"
                            : "bg-gray-100 text-gray-500 border border-gray-200"
                            }`}
                        >
                          {selectedDoctorForDetails.status}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-gray-50 border border-gray-100 text-xs space-y-1.5">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                      Duty Hours &amp; Days
                    </span>
                    {!selectedDoctorForDetails.dutySchedule ||
                      Object.keys(selectedDoctorForDetails.dutySchedule).length === 0 ? (
                      <>
                        <p className="font-bold text-magenta-700">
                          {formatTime12h(selectedDoctorForDetails.dutyStartTime || "08:00")} –{" "}
                          {formatTime12h(selectedDoctorForDetails.dutyEndTime || "17:00")}
                        </p>
                        <p className="text-[11px] text-gray-600">
                          {selectedDoctorForDetails.dutyDays &&
                            selectedDoctorForDetails.dutyDays.length > 0
                            ? selectedDoctorForDetails.dutyDays.join(", ")
                            : "Monday – Friday"}
                        </p>
                      </>
                    ) : (
                      <div className="space-y-1 mt-1">
                        {selectedDoctorForDetails.dutyDays.map((d) => {
                          const shift = getDoctorShiftForDay(selectedDoctorForDetails, d);
                          return (
                            <div
                              key={d}
                              className="flex items-center justify-between text-xs py-0.5 border-b border-gray-200/50 last:border-b-0"
                            >
                              <span className="font-semibold text-gray-800">{d}</span>
                              <span className="font-bold text-magenta-700">
                                {formatTime12h(shift.startTime)} – {formatTime12h(shift.endTime)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="p-3 rounded-xl bg-pink-50/50 border border-pink-100 text-xs space-y-1">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                      Consultation Slots
                    </span>
                    <div className="flex items-center justify-between text-xs py-0.5">
                      <span className="text-gray-600">Slot Duration:</span>
                      <span className="font-bold text-magenta-700">
                        {selectedDoctorForDetails.slotIntervalMinutes || clinicDefaultInterval} mins
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs py-0.5">
                      <span className="text-gray-600">Capacity Rule:</span>
                      <span className="font-bold text-emerald-700">
                        Dynamic (Based on available time slots)
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div>
                      <p className="text-[10px] font-bold tracking-wider text-gray-400 uppercase">
                        EMAIL
                      </p>
                      <p className="font-medium text-gray-800 mt-0.5">
                        {selectedDoctorForDetails.email}
                      </p>
                    </div>

                    <div>
                      <p className="text-[10px] font-bold tracking-wider text-gray-400 uppercase">
                        CONTACT NUMBER
                      </p>
                      <p className="font-medium text-gray-800 mt-0.5">
                        {selectedDoctorForDetails.contactNumber || "—"}
                      </p>
                    </div>

                    <div>
                      <p className="text-[10px] font-bold tracking-wider text-gray-400 uppercase">
                        PRC LICENSE #
                      </p>
                      <p className="font-medium text-gray-800 mt-0.5">
                        {selectedDoctorForDetails.prcLicense || "—"}
                      </p>
                    </div>

                    <div>
                      <p className="text-[10px] font-bold tracking-wider text-gray-400 uppercase mb-1">
                        SPECIALIZATION
                      </p>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {selectedDoctorForDetails.specializations.length > 0 ? (
                          selectedDoctorForDetails.specializations.map((spec) => (
                            <span
                              key={spec.id}
                              className="inline-block text-[10px] px-2 py-0.5 rounded-md bg-magenta-50 text-magenta-700 border border-magenta-100 font-semibold"
                            >
                              {spec.name}
                            </span>
                          ))
                        ) : (
                          <p className="text-gray-400 italic">General Dermatology</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="px-6 py-3.5 bg-gray-50/70 border-t border-gray-100">
                  <div className="flex items-center justify-between gap-2.5">
                    <button
                      type="button"
                      onClick={() => setStatusConfirmDoctor(selectedDoctorForDetails)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${selectedDoctorForDetails.status === "Active"
                        ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                        : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                        }`}
                    >
                      {selectedDoctorForDetails.status === "Active"
                        ? "Deactivate Doctor"
                        : "Re-activate Doctor"}
                    </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const doc = selectedDoctorForDetails;
                        setSelectedDoctorForDetails(null);
                        setDeleteTarget(doc.id);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remove</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const doc = selectedDoctorForDetails;
                        setSelectedDoctorForDetails(null);
                        handleOpenEditDoctor(doc);
                      }}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-[#c0166a] hover:bg-[#a01258] text-white text-xs font-bold transition-colors shadow-xs cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit Profile</span>
                    </button>
                  </div>
                </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </ModalPortal>

      {/* ── Status Toggle Confirmation Modal ─────────────────────── */}
      <ModalPortal isOpen={Boolean(statusConfirmDoctor)}>
        <AnimatePresence>
          {statusConfirmDoctor && (
            <div className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 8 }}
                className="relative z-[9999] w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 border border-gray-100 text-center"
              >
                <div
                  className={`w-11 h-11 rounded-xl mx-auto flex items-center justify-center mb-3 ${statusConfirmDoctor.status === "Active"
                    ? "bg-amber-50 text-amber-600 border border-amber-100"
                    : "bg-emerald-50 text-emerald-600 border border-emerald-100"
                    }`}
                >
                  <AlertCircle className="w-5 h-5" />
                </div>

                <h3 className="text-sm font-bold text-gray-900 mb-1">
                  {statusConfirmDoctor.status === "Active"
                    ? "Deactivate Doctor Account?"
                    : "Re-activate Doctor Account?"}
                </h3>
                <p className="text-xs text-gray-500 mb-5 leading-relaxed">
                  {statusConfirmDoctor.status === "Active"
                    ? `Deactivating Dr. ${statusConfirmDoctor.name} will pause new appointment assignments.`
                    : `Re-activating Dr. ${statusConfirmDoctor.name} will enable them to receive appointment bookings.`}
                </p>

                <div className="flex gap-2.5">
                  <button
                    type="button"
                    onClick={() => setStatusConfirmDoctor(null)}
                    disabled={togglingStatus}
                    className="flex-1 py-2 rounded-xl border border-gray-200 text-gray-600 text-xs font-bold hover:bg-gray-50 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmStatusToggle}
                    disabled={togglingStatus}
                    className={`flex-1 py-2 rounded-xl text-white text-xs font-bold shadow-xs transition-colors flex items-center justify-center gap-1 cursor-pointer ${statusConfirmDoctor.status === "Active"
                      ? "bg-amber-600 hover:bg-amber-700"
                      : "bg-emerald-600 hover:bg-emerald-700"
                      }`}
                  >
                    {togglingStatus && <Loader2 className="w-3 h-3 animate-spin" />}
                    {statusConfirmDoctor.status === "Active" ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </ModalPortal>

      {/* ── Delete Confirmation Modal ─────────────────────────────── */}
      <ModalPortal isOpen={Boolean(deleteTarget)}>
        <AnimatePresence>
          {deleteTarget && (
            <div className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 8 }}
                className="relative z-[9999] w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 border border-gray-100 text-center"
              >
                <div className="w-11 h-11 rounded-xl bg-red-50 text-red-600 border border-red-100 mx-auto flex items-center justify-center mb-3">
                  <Trash2 className="w-5 h-5" />
                </div>

                <h3 className="text-sm font-bold text-gray-900 mb-1">Remove Doctor?</h3>
                <p className="text-xs text-gray-500 mb-5 leading-relaxed">
                  Are you sure you want to remove this doctor from your clinic roster?
                </p>

                <div className="flex gap-2.5">
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(null)}
                    disabled={deletingDoctor}
                    className="flex-1 py-2 rounded-xl border border-gray-200 text-gray-600 text-xs font-bold hover:bg-gray-50 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={executeDelete}
                    disabled={deletingDoctor}
                    className="flex-1 py-2 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-700 shadow-xs transition-colors flex items-center justify-center gap-1 cursor-pointer"
                  >
                    {deletingDoctor && <Loader2 className="w-3 h-3 animate-spin" />}
                    Yes, Remove
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </ModalPortal>

      {/* ── How to Set Doctor Duty Hours Instructions Modal ─────── */}
      <ModalPortal isOpen={Boolean(showInstructionsModal)}>
        <AnimatePresence>
          {showInstructionsModal && (
            <div className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 8 }}
                className="relative z-[9999] w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-100 max-h-[90vh] flex flex-col text-left"
              >
                {/* Header */}
                <div className="px-6 pt-5 pb-3 flex items-start justify-between border-b border-gray-100 bg-pink-50/40 shrink-0">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-magenta-100 text-[#c0166a] flex items-center justify-center shrink-0">
                      <HelpCircle className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">How to Set Doctor Duty Hours</h3>
                      <p className="text-[11px] text-gray-500">Step-by-step instructions for scheduling doctors</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowInstructionsModal(false)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto space-y-3.5 text-xs">
                  {/* Step 1 */}
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-gray-50/70 border border-gray-100">
                    <div className="w-6 h-6 rounded-lg bg-[#c0166a] text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                      1
                    </div>
                    <div className="space-y-0.5">
                      <h4 className="font-bold text-gray-900">Select Doctor for Scheduling</h4>
                      <p className="text-gray-600 leading-relaxed text-[11px]">
                        Choose the doctor from the dropdown roster whose duty schedule you want to configure. You can see their registered photo, all clinical specializations, and current scheduling status.
                      </p>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-gray-50/70 border border-gray-100">
                    <div className="w-6 h-6 rounded-lg bg-gray-200 text-gray-800 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                      2
                    </div>
                    <div className="space-y-0.5">
                      <h4 className="font-bold text-gray-900">Select Weekly Duty Days</h4>
                      <p className="text-gray-600 leading-relaxed text-[11px]">
                        Click on the individual day cards (Monday–Sunday) to designate which days the doctor will be available on duty. You can also use quick presets like <strong>Mon–Fri</strong> or <strong>All Week</strong>, or clear duty days anytime.
                      </p>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-gray-50/70 border border-gray-100">
                    <div className="w-6 h-6 rounded-lg bg-gray-200 text-gray-800 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                      3
                    </div>
                    <div className="space-y-0.5">
                      <h4 className="font-bold text-gray-900">Set Appointment Intervals</h4>
                      <p className="text-gray-600 leading-relaxed text-[11px]">
                        Under <strong>Appointment Scheduling Settings</strong>, select the doctor's default consultation interval (e.g., 20 mins, 30 mins, 45 mins), or keep it set to inherit the clinic operating default.
                      </p>
                    </div>
                  </div>

                  {/* Step 4 */}
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-gray-50/70 border border-gray-100">
                    <div className="w-6 h-6 rounded-lg bg-gray-200 text-gray-800 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                      4
                    </div>
                    <div className="space-y-0.5">
                      <h4 className="font-bold text-gray-900">Configure Duty Hours &amp; Shifts</h4>
                      <p className="text-gray-600 leading-relaxed text-[11px]">
                        In the <strong>Doctor's Daily Schedule</strong> panel:
                      </p>
                      <ul className="list-disc pl-4 space-y-1 text-gray-600 text-[11px] mt-1">
                        <li>
                          <strong>Duty Start &amp; End:</strong> Set consultation hours within clinic operating boundaries.
                        </li>
                        <li>
                          <strong>Multiple Shifts (+ Add Shift):</strong> Click <strong>+ Add Shift</strong> to split duty hours (e.g., Morning Shift 7:30 AM – 12:00 PM and Afternoon Shift 1:00 PM – 5:00 PM) for lunch breaks or multi-session days.
                        </li>
                        <li>
                          <strong>Shift Override:</strong> Customize slot duration per individual shift if needed, or leave as Default.
                        </li>
                        <li>
                          <strong>Copy to All Days:</strong> Click <strong>Copy to all days</strong> on any day to replicate configured shifts across the doctor's entire duty week in one click.
                        </li>
                      </ul>
                    </div>
                  </div>

                  {/* Step 5 */}
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-gray-50/70 border border-gray-100">
                    <div className="w-6 h-6 rounded-lg bg-gray-200 text-gray-800 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                      5
                    </div>
                    <div className="space-y-0.5">
                      <h4 className="font-bold text-gray-900">Review Slots &amp; Capacity</h4>
                      <p className="text-gray-600 leading-relaxed text-[11px]">
                        Inspect the <strong>Shift Capacity &amp; Slot Count Preview</strong> card on the left. Verify total bookable appointment slots per shift and review any concurrent doctor shifts in the <strong>Co-Working on Duty</strong> section to prevent clinic room overcrowding.
                      </p>
                    </div>
                  </div>

                  {/* Step 6 */}
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-gray-50/70 border border-gray-100">
                    <div className="w-6 h-6 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                      6
                    </div>
                    <div className="space-y-0.5">
                      <h4 className="font-bold text-gray-900">Save Schedule</h4>
                      <p className="text-gray-600 leading-relaxed text-[11px]">
                        Click <strong>Save Duty Schedule</strong> at the bottom right. Once saved, appointment slots are published and immediately available for patient online bookings.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-3 bg-gray-50/80 border-t border-gray-100 flex items-center justify-end shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowInstructionsModal(false)}
                    className="px-5 py-2 rounded-xl bg-[#c0166a] hover:bg-[#a01258] text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
                  >
                    Got It
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </ModalPortal>
    </div>
  );
}