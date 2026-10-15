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
  User,
  Info,
  Plus,
  Copy,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useClinicVerification } from "@/hooks/useClinicVerification";
import { supabase } from "@/lib/supabaseClient";
import SpecializationMultiSelect, {
  type SpecializationOption,
} from "@/components/clinic/SpecializationMultiSelect";
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
};

/* ── Constants ────────────────────────────────────────────────────── */
const DEFAULT_SPECIALIZATIONS: SpecializationOption[] = [
  { id: "spec-1", name: "General Dermatology" },
  { id: "spec-2", name: "Clinical Dermatology" },
  { id: "spec-3", name: "Cosmetic Dermatology" },
  { id: "spec-4", name: "Aesthetic Dermatology" },
  { id: "spec-5", name: "Pediatric Dermatology" },
  { id: "spec-6", name: "Dermatologic Surgery" },
  { id: "spec-7", name: "Dermatopathology" },
  { id: "spec-8", name: "Dermatology Oncology" },
  { id: "spec-9", name: "Hair & Scalp Dermatology" },
  { id: "spec-10", name: "Nail Dermatology" },
  { id: "spec-11", name: "Immunodermatology" },
  { id: "spec-12", name: "Contact Dermatitis & Allergy" },
  { id: "spec-13", name: "Photodermatology" },
  { id: "spec-14", name: "Dermatology & Venereology" },
];



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

/* ── Modern Time Select Component ─────────────────────────────────── */
function ModernTimeSelect({
  value,
  onChange,
  label,
  placeholder = "Select time",
  disabled = false,
  options,
}: {
  value: string;
  onChange: (val: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  options?: { value: string; label: string }[];
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
        className={`w-full flex items-center justify-between px-3.5 py-2 rounded-xl border bg-white text-xs font-semibold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${open
          ? "border-[#c0166a] ring-2 ring-magenta-500/10 shadow-xs"
          : "border-gray-200 hover:border-gray-300 hover:bg-gray-50/60"
          }`}
      >
        <div className="flex items-center gap-2 text-gray-900 truncate">
          <Clock className="w-3.5 h-3.5 text-[#c0166a] shrink-0" />
          <span className="font-bold">
            {selectedOpt ? selectedOpt.label : value ? formatTime12h(value) : placeholder}
          </span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform ${open ? "rotate-180 text-[#c0166a]" : ""
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
            className="absolute left-0 right-0 top-full mt-1.5 max-h-52 overflow-y-auto rounded-xl border border-gray-100 bg-white shadow-xl z-50 p-1 divide-y divide-gray-50/80"
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
        className={`w-full flex items-center justify-between p-3 rounded-2xl border bg-white transition-all cursor-pointer text-left ${open
          ? "border-[#c0166a] ring-2 ring-magenta-500/10 shadow-xs"
          : "border-gray-200 hover:border-gray-300 hover:bg-gray-50/50"
          } ${disabled || doctors.length === 0 ? "opacity-60 cursor-not-allowed" : ""}`}
      >
        {selectedDoc ? (
          <div className="flex items-center gap-3 min-w-0">
            {selectedDoc.photo ? (
              <img
                src={selectedDoc.photo}
                alt={selectedDoc.name}
                className="w-10 h-10 rounded-xl object-cover border border-magenta-200 shrink-0 shadow-2xs"
              />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-magenta-50 border border-magenta-100 text-[#c0166a] font-bold flex items-center justify-center shrink-0 text-sm">
                {selectedDoc.name.replace("Dr.", "").trim().charAt(0) || "D"}
              </div>
            )}
            <div className="min-w-0">
              <span className="font-bold text-gray-900 text-xs sm:text-sm block truncate">
                {selectedDoc.name}
              </span>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {selectedDoc.specializations.length > 0 ? (
                  <span className="inline-block text-[10px] px-2 py-0.5 rounded-md bg-magenta-50 text-magenta-700 font-semibold border border-magenta-100">
                    {selectedDoc.specializations[0].name}
                  </span>
                ) : (
                  <span className="inline-block text-[10px] px-2 py-0.5 rounded-md bg-magenta-50 text-magenta-700 font-semibold border border-magenta-100">
                    General Dermatology
                  </span>
                )}
                {selectedDoc.dutyDays && selectedDoc.dutyDays.length > 0 ? (
                  <span className="inline-block text-[10px] px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-semibold border border-emerald-100">
                    {selectedDoc.dutyDays.length} days • {formatTime12h(selectedDoc.dutyStartTime || "08:00")}–{formatTime12h(selectedDoc.dutyEndTime || "17:00")} • {selectedDoc.slotIntervalMinutes || 20}m • Max {selectedDoc.maxPatientsPerDay || 20}/shift
                  </span>
                ) : (
                  <span className="inline-block text-[10px] px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 font-medium border border-amber-100">
                    No Duty Schedule Yet
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
          className={`w-4 h-4 text-gray-400 shrink-0 ml-2 transition-transform duration-150 ${open ? "rotate-180 text-[#c0166a]" : ""
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
                        <span>{doc.specializations[0]?.name || "Dermatology"}</span>
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
  const [activeTab, setActiveTab] = useState<"register" | "schedule">("schedule");

  // Dynamic specializations
  const [specializations, setSpecializations] = useState<SpecializationOption[]>(DEFAULT_SPECIALIZATIONS);
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
  const [selectedDoctorForDetails, setSelectedDoctorForDetails] = useState<DoctorAccount | null>(null);
  const [statusConfirmDoctor, setStatusConfirmDoctor] = useState<DoctorAccount | null>(null);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deletingDoctor, setDeletingDoctor] = useState(false);

  const formSectionRef = useRef<HTMLDivElement>(null);

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
    if (!targetClinicId) {
      try {
        const sett = localStorage.getItem("dermai_clinic_settings");
        if (sett) {
          const parsed = JSON.parse(sett);
          if (parsed.id) targetClinicId = parsed.id;
        }
      } catch { }
    }

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
    window.addEventListener("storage", handleSync);
    return () => {
      window.removeEventListener("clinicSettingsUpdated", handleSync);
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

      if (!error && data && data.length > 0) {
        setSpecializations(data);
      }
    } catch {
      // Using DEFAULT_SPECIALIZATIONS
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

          const preservedPhoto =
            doc.photo_url ||
            localPhotoMap.get(String(doc.doctor_id)) ||
            (doc.email ? localPhotoMap.get(String(doc.email).toLowerCase().trim()) : undefined) ||
            undefined;

          return {
            id: doc.doctor_id,
            name: doc.doctor_name,
            email: doc.email,
            contactNumber: doc.contact_number || "",
            prcLicense: doc.prc_license || "",
            photo: preservedPhoto,
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
      setSuccessMsg(`Dr. ${finalizedDoctor.name} was successfully registered and added to roster.`);
      setTimeout(() => setSuccessMsg(""), 4500);
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

  const removeShiftFromDay = (day: string, shiftId: string) => {
    setScheduleForm((prev) => {
      const currentShifts = prev.weeklyShifts[day] || [];
      const updatedShifts = currentShifts.filter((s) => s.id !== shiftId);
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
    shiftId: string,
    field: keyof DoctorShift,
    value: any
  ) => {
    setScheduleForm((prev) => {
      const currentShifts = prev.weeklyShifts[day] || [];
      const updatedShifts = currentShifts.map((s) => {
        if (s.id !== shiftId) return s;
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

      const errors = validateDoctorShifts(shifts, day, clinicOpenTime, clinicCloseTime);
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
        window.dispatchEvent(new Event("storage"));
        window.dispatchEvent(new CustomEvent("dermai_doctors_updated"));
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

      const totalConfiguredShifts = Object.values(normalizedWeeklyShifts).flat().length;

      setScheduleSavedFeedback({
        doctorName: updatedDoctor.name,
        daysCount: updatedDoctor.dutyDays.length,
        shiftsCount: totalConfiguredShifts,
      });
      setTimeout(() => setScheduleSavedFeedback(null), 5000);

      if (updateRes.error) {
        console.warn("Notice: could not save schedule to Supabase directly:", updateRes.error);
        setSuccessMsg(`Duty schedule for Dr. ${updatedDoctor.name} updated successfully.`);
      } else {
        setSuccessMsg(`Duty schedule and shifts for Dr. ${updatedDoctor.name} updated successfully.`);
      }
      setTimeout(() => setSuccessMsg(""), 4500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update schedule.";
      setScheduleError(msg);
    } finally {
      setSavingSchedule(false);
    }
  };

  // Schedule Shift button in Roster: switches tab, preselects doctor & scrolls up
  const handleScheduleDoctor = (doc: DoctorAccount) => {
    setActiveTab("schedule");
    handleSelectDoctor(doc.id);
    formSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
      {/* ── Page Header ─────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-display font-bold text-gray-900">
          Clinic Doctors &amp; Duty Roster
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Manage attending dermatologists, credentials, working days, and consultation hours.
        </p>
      </div>

      {/* ── Top Tabs Navigation ──────────────────────────────────── */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => setActiveTab("register")}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-bold transition-all cursor-pointer ${activeTab === "register"
            ? "border border-magenta-500 bg-magenta-500 text-white shadow-xs hover:bg-magenta-600"
            : "border border-gray-200/80 bg-white text-gray-600 hover:text-gray-900 hover:bg-gray-50"
            }`}
        >
          <UserPlus className="w-4 h-4" />
          <span>Register New Doctor</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("schedule")}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-bold transition-all cursor-pointer ${activeTab === "schedule"
            ? "border border-magenta-500 bg-magenta-500 text-white shadow-xs hover:bg-magenta-600"
            : "border border-gray-200/80 bg-white text-gray-600 hover:text-gray-900 hover:bg-gray-50"
            }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Schedule Duty Hours</span>
        </button>
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
             TAB A: REGISTER NEW DOCTOR (Reference Image 2)
             ══════════════════════════════════════════════════════════ */
          <div className="bg-white rounded-2xl border border-gray-200/80 p-5 sm:p-6 shadow-xs">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
              <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-[#c0166a]" />
                Add New Doctor Profile
              </h2>
              <span className="text-[10px] text-gray-400 font-medium">
                Fill required details (*)
              </span>
            </div>

            {/* Doctor Photo Section */}
            <div className="mb-5 p-3.5 rounded-xl bg-gray-50/60 border border-gray-100 flex items-center gap-4">
              <div className="relative shrink-0">
                {registerForm.photoPreview ? (
                  <img
                    src={registerForm.photoPreview}
                    alt="Doctor Preview"
                    className="w-14 h-14 rounded-xl object-cover border border-magenta-200 shadow-2xs"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-xl bg-white border border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400">
                    <Camera className="w-5 h-5 text-gray-400" />
                    <span className="text-[8px] font-bold text-gray-400 mt-0.5">Photo</span>
                  </div>
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
                <h4 className="text-xs font-bold text-gray-800">Doctor Profile Picture</h4>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Clear medical headshot for patient appointment selection (JPG/PNG, max 8MB).
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => photoFileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <Upload className="w-3 h-3 text-[#c0166a]" />
                    {registerForm.photoPreview ? "Change Photo" : "Upload Headshot"}
                  </button>
                  {registerForm.photoPreview && (
                    <button
                      type="button"
                      onClick={() => {
                        setRegisterForm((p) => ({ ...p, photoFile: null, photoPreview: "" }));
                        if (photoFileInputRef.current) photoFileInputRef.current.value = "";
                      }}
                      className="text-xs text-rose-500 hover:text-rose-600 font-medium px-1.5 py-0.5 cursor-pointer"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Inputs Grid (Two Columns) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={registerForm.name}
                  onChange={(e) => setRegisterForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Dr. Maria Santos"
                  className="w-full px-3.5 py-2 rounded-xl border border-gray-200 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-magenta-500 focus:border-[#c0166a] transition-all bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Email (used for login) *
                </label>
                <input
                  type="email"
                  value={registerForm.email}
                  onChange={(e) => setRegisterForm((p) => ({ ...p, email: e.target.value }))}
                  placeholder="doctor@example.com"
                  className="w-full px-3.5 py-2 rounded-xl border border-gray-200 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-magenta-500 focus:border-[#c0166a] transition-all bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Contact Number (11 digits) *
                </label>
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
                  className="w-full px-3.5 py-2 rounded-xl border border-gray-200 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-magenta-500 focus:border-[#c0166a] transition-all bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  PRC License # (Letters &amp; Numbers, max 7) *
                </label>
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
                  className="w-full px-3.5 py-2 rounded-xl border border-gray-200 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-magenta-500 focus:border-[#c0166a] transition-all bg-white"
                />
              </div>

              {/* Specialization Selection */}
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-gray-700">
                    Specialization *
                  </label>
                  {loadingSpecializations && (
                    <span className="text-[10px] text-gray-400 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> Loading specializations...
                    </span>
                  )}
                </div>
                <SpecializationMultiSelect
                  options={specializations}
                  selectedIds={registerForm.selectedSpecializationIds}
                  onChange={(ids) =>
                    setRegisterForm((p) => ({ ...p, selectedSpecializationIds: ids }))
                  }
                  placeholder="Select one or more clinical specializations..."
                  disabled={loadingSpecializations || savingDoctor}
                />
              </div>
            </div>

            {registerError && (
              <div className="mt-4 flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
                <AlertCircle className="w-4 h-4 shrink-0" /> {registerError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2.5 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={resetRegisterForm}
                disabled={savingDoctor}
                className="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-xs font-bold hover:bg-gray-50 transition-colors disabled:opacity-50 cursor-pointer"
              >
                Reset Form
              </button>
              <button
                type="button"
                onClick={handleInitiateAddDoctor}
                disabled={savingDoctor}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-[#c0166a] hover:bg-[#a01258] text-white text-xs font-bold transition-colors disabled:opacity-60 shadow-xs cursor-pointer"
              >
                {savingDoctor && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Add Doctor to Roster</span>
              </button>
            </div>
          </div>
        ) : (
          /* ══════════════════════════════════════════════════════════
             TAB B: SCHEDULE DUTY HOURS (Reference Image 1)
             ══════════════════════════════════════════════════════════ */
          <div className="bg-white rounded-2xl border border-gray-200/80 p-5 sm:p-6 shadow-xs space-y-5">
            <div className="border-b border-gray-100 pb-3">
              <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#c0166a]" />
                <span>Schedule Doctor Duty Hours</span>
              </h2>
            </div>

            {/* Doctor Selection Field */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-gray-900">
                  Select Doctor for Scheduling *
                </label>
                {selectedDoctor && (
                  <span className="text-[11px] text-gray-500">
                    Currently Editing: <strong className="text-gray-900">{selectedDoctor.name}</strong>
                  </span>
                )}
              </div>
              <DoctorSelectDropdown
                doctors={allDoctors}
                selectedDoctorId={selectedDoctor?.id || ""}
                onSelect={(id) => handleSelectDoctor(id)}
                disabled={loadingDoctors || savingSchedule}
              />
            </div>

            {/* Weekly Duty Days Selector */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-[#c0166a]" />
                  Select Weekly Duty Days *
                </label>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() =>
                      applyDutyDays(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"])
                    }
                    className="text-magenta-700 hover:text-magenta-800 font-semibold hover:underline cursor-pointer"
                  >
                    Mon–Fri
                  </button>
                  <span className="text-gray-300">•</span>
                  <button
                    type="button"
                    onClick={() =>
                      applyDutyDays([
                        "Monday",
                        "Tuesday",
                        "Wednesday",
                        "Thursday",
                        "Friday",
                        "Saturday",
                      ])
                    }
                    className="text-magenta-700 hover:text-magenta-800 font-semibold hover:underline cursor-pointer"
                  >
                    Mon–Sat
                  </button>
                  <span className="text-gray-300">•</span>
                  <button
                    type="button"
                    onClick={() => applyDutyDays([...ALL_DAYS_OF_WEEK])}
                    className="text-magenta-700 hover:text-magenta-800 font-semibold hover:underline cursor-pointer"
                  >
                    All Week
                  </button>
                  {scheduleForm.dutyDays.length > 0 && (
                    <>
                      <span className="text-gray-300">•</span>
                      <button
                        type="button"
                        onClick={() => setScheduleForm((p) => ({ ...p, dutyDays: [] }))}
                        className="text-rose-600 hover:text-rose-700 font-semibold hover:underline cursor-pointer"
                      >
                        Clear
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* 7 Clean Day Cards */}
              <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                {ALL_DAYS_OF_WEEK.map((day) => {
                  const isSelected = scheduleForm.dutyDays.includes(day);
                  const shifts = scheduleForm.weeklyShifts[day] || [];
                  const shiftCount = shifts.length;

                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDutyDay(day)}
                      className={`p-2.5 rounded-xl border transition-all text-center flex flex-col items-center justify-center cursor-pointer ${isSelected
                        ? "bg-magenta-50/80 border-magenta-300 ring-2 ring-magenta-500/20 shadow-xs"
                        : "bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50/50"
                        }`}
                    >
                      <span
                        className={`text-xs font-bold ${isSelected ? "text-magenta-900" : "text-gray-700"
                          }`}
                      >
                        {day.slice(0, 3)}
                      </span>
                      <span
                        className={`text-[9px] mt-1 font-semibold truncate ${isSelected
                          ? "text-magenta-700"
                          : "text-gray-400"
                          }`}
                      >
                        {isSelected
                          ? `${shiftCount} shift${shiftCount > 1 ? "s" : ""}`
                          : "Off"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Section B: Weekly Duty Schedule & Multi-Shift Manager ─ */}
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#c0166a]" />
                    <span>Doctor's Daily Schedule</span>
                  </label>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Clinic Operating Hours ({clinicOperatingDays}):{" "}
                    <strong className="text-gray-800">
                      {formatTime12h(clinicOpenTime)} – {formatTime12h(clinicCloseTime)}
                    </strong>
                  </p>
                </div>

                <span className="text-[11px] text-gray-400">
                  Multiple independent shifts supported (e.g. Morning &amp; Afternoon)
                </span>
              </div>

              {scheduleForm.dutyDays.length === 0 ? (
                <div className="p-8 rounded-2xl bg-white border border-dashed border-gray-200 text-center space-y-1">
                  <p className="text-xs font-bold text-gray-700">No duty days selected</p>
                  <p className="text-[11px] text-gray-400">
                    Select the working days for {selectedDoctor?.name || "this doctor"} above, then set their duty hours for each day.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {scheduleForm.dutyDays.map((day) => {
                    const shifts = scheduleForm.weeklyShifts[day] || [];
                    const dayErrors = validateDoctorShifts(
                      shifts,
                      day,
                      clinicOpenTime,
                      clinicCloseTime
                    );

                    return (
                      <div
                        key={day}
                        className="p-3.5 sm:p-4 rounded-2xl bg-white border border-gray-200/90 shadow-2xs space-y-3"
                      >
                        {/* Day Card Header */}
                        <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-gray-900">{day}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-magenta-50 text-magenta-700 font-semibold border border-magenta-100">
                              {shifts.length} {shifts.length === 1 ? "Shift" : "Shifts"}
                            </span>
                            {dayErrors.length > 0 && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-semibold border border-amber-200 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                Conflict
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            {shifts.length > 0 && scheduleForm.dutyDays.length > 1 && (
                              <button
                                type="button"
                                onClick={() => copyShiftsToAllSelectedDays(day)}
                                title={`Copy ${day}'s shifts to other selected days`}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 transition-colors cursor-pointer"
                              >
                                <Copy className="w-3 h-3 text-gray-500" />
                                <span>Copy to all days</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => addShiftToDay(day)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-magenta-700 bg-magenta-50 hover:bg-magenta-100/80 border border-magenta-200 transition-colors cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Add Shift</span>
                            </button>
                          </div>
                        </div>

                        {/* Shifts List for this day */}
                        <div className="space-y-2.5">
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

                            const fallbackSourceLabel = scheduleForm.doctorSlotInterval
                              ? `Doctor: ${scheduleForm.doctorSlotInterval}m`
                              : `Clinic: ${clinicDefaultInterval}m`;

                            return (
                              <div
                                key={shift.id || idx}
                                className="p-3 rounded-xl bg-gray-50/70 border border-gray-200/80 flex flex-wrap items-center justify-between gap-2.5 text-xs"
                              >
                                {/* Shift Identity & Label */}
                                <div className="flex items-center gap-2 min-w-[130px]">
                                  <span className="w-5 h-5 rounded-md bg-white border border-gray-200 text-gray-500 font-bold text-[10px] flex items-center justify-center shrink-0">
                                    {idx + 1}
                                  </span>
                                  <input
                                    type="text"
                                    value={shift.label}
                                    onChange={(e) =>
                                      updateShiftInDay(day, shift.id, "label", e.target.value)
                                    }
                                    placeholder={idx === 0 ? "Morning Shift" : "Afternoon Shift"}
                                    className="w-28 sm:w-32 px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-800 focus:outline-none focus:border-magenta-500"
                                  />
                                </div>

                                {/* Shift Time Selectors (Bounded to clinicTimeOptions) */}
                                <div className="flex items-center gap-1.5 min-w-[200px] flex-1 max-w-xs">
                                  <div className="flex-1">
                                    <ModernTimeSelect
                                      value={shift.startTime}
                                      options={clinicTimeOptions}
                                      onChange={(val) =>
                                        updateShiftInDay(day, shift.id, "startTime", val)
                                      }
                                    />
                                  </div>
                                  <span className="text-gray-400 font-medium shrink-0 text-[11px]">to</span>
                                  <div className="flex-1">
                                    <ModernTimeSelect
                                      value={shift.endTime}
                                      options={clinicTimeOptions}
                                      onChange={(val) =>
                                        updateShiftInDay(day, shift.id, "endTime", val)
                                      }
                                    />
                                  </div>
                                </div>

                                {/* Per-Shift Appointment Slot Interval Dropdown */}
                                <div className="flex items-center gap-1.5 shrink-0">
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
                                      className="h-8.5 pl-2.5 pr-7 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-800 appearance-none focus:outline-none focus:border-magenta-500 hover:border-gray-300 transition-colors cursor-pointer"
                                      title="Appointment Slot Interval for this shift"
                                    >
                                      <option value="default">
                                        Default ({fallbackSourceLabel})
                                      </option>
                                      {APPOINTMENT_INTERVAL_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                          {opt.label}
                                        </option>
                                      ))}
                                    </select>
                                    <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                                  </div>
                                </div>

                                {/* Duration, Slots Count & Interval Source Indicator */}
                                <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                                  <span className="px-2 py-1 rounded-lg bg-white border border-gray-200 text-gray-700 font-medium text-[11px]" title="Calculated shift duration">
                                    {duration > 0 ? `${duration} hrs` : "0 hrs"}
                                  </span>
                                  <span className="px-2.5 py-1 rounded-lg bg-pink-50 border border-pink-200/70 text-magenta-700 font-semibold text-[11px]" title="Available appointment slots based on shift window & interval">
                                    {possibleSlots} {possibleSlots === 1 ? "slot" : "slots"} ({effectiveInterval}m)
                                  </span>

                                  {/* Interval Source Indicator Badge */}
                                  {intervalSource === "shift" ? (
                                    <span
                                      className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-magenta-50 text-magenta-700 border border-magenta-200 shrink-0"
                                      title="Configured specifically for this shift"
                                    >
                                      <span className="w-1.5 h-1.5 rounded-full bg-magenta-600"></span>
                                      Shift Override
                                    </span>
                                  ) : intervalSource === "doctor" ? (
                                    <span
                                      className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 shrink-0"
                                      title="Inheriting doctor's default interval preference"
                                    >
                                      <span className="w-1.5 h-1.5 rounded-full bg-purple-600"></span>
                                      Doctor's Default
                                    </span>
                                  ) : (
                                    <span
                                      className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200 shrink-0"
                                      title="Inheriting clinic default interval"
                                    >
                                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
                                      Clinic Default
                                    </span>
                                  )}

                                  {/* Delete Shift Button */}
                                  <button
                                    type="button"
                                    onClick={() => removeShiftFromDay(day, shift.id)}
                                    title="Remove this shift"
                                    className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Shift Errors display if any */}
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
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Section C: Scheduling Defaults & Doctor Preferences ─────── */}
            <div className="p-4 sm:p-5 rounded-2xl bg-pink-50/40 border border-pink-200/90 space-y-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-[#c0166a]" />
                    <span>Appointment Scheduling Settings</span>
                  </label>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Configuration Priority: Shift-specific interval → Doctor preference default → Clinic-wide default ({clinicDefaultInterval}m baseline)
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {/* 1. Doctor-Level Interval Preference */}
                <div className="p-3.5 rounded-xl bg-white border border-gray-200/80 shadow-2xs space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-gray-900">
                      Doctor's Default Appointment Interval
                    </label>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${scheduleForm.doctorSlotInterval === null
                        ? "bg-gray-100 text-gray-600 border-gray-200"
                        : "bg-purple-50 text-purple-700 border-purple-200"
                        }`}
                    >
                      {scheduleForm.doctorSlotInterval === null
                        ? `Using clinic default: ${clinicDefaultInterval} mins`
                        : `Doctor preference: ${scheduleForm.doctorSlotInterval} mins`}
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
                      className="w-full h-9 px-3.5 pr-8 bg-white border border-gray-200 rounded-xl text-xs font-semibold text-gray-900 appearance-none focus:outline-none focus:border-magenta-500 hover:border-gray-300 transition-colors cursor-pointer"
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

                {/* 2. Clinic-Wide Baseline Default */}
                <div className="p-3.5 rounded-xl bg-white border border-gray-200/80 shadow-2xs space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-gray-900">
                      Clinic Default Interval
                    </label>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Clinic Default
                    </span>
                  </div>

                  <div className="flex items-center justify-between h-9 px-3.5 bg-gray-50/70 border border-gray-200/80 rounded-xl text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-gray-900">{clinicDefaultInterval} minutes</span>
                      <span className="text-[11px] text-gray-400">· Clinic operating default</span>
                    </div>
                    <span className="text-[11px] font-semibold text-gray-600 bg-white px-2 py-0.5 rounded-md border border-gray-200/60 shadow-2xs">
                      ~{Math.round(60 / clinicDefaultInterval)} slots / hr
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Section D: Shift Capacity Preview ───────────────────── */}
            <div className="p-4 sm:p-5 rounded-2xl bg-white border border-gray-200/90 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 text-[#c0166a]" />
                    <span>Shift Capacity &amp; Slot Count Preview</span>
                  </h4>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Appointment Slot Summary — {selectedDoctor?.name || "doctor"}'s shifts
                  </p>
                </div>

                <div className="text-right">
                  <span className="text-xs font-bold text-magenta-700">
                    {estimatedCapacityBreakdown.summaryText}
                  </span>
                </div>
              </div>

              {shiftSummaries.length === 0 ? (
                <div className="p-4 rounded-xl bg-gray-50/70 border border-dashed border-gray-200 text-center text-xs text-gray-400">
                  Set the doctor's working days and hours above to see the available appointment slots.
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {shiftSummaries.map(({ day, shift, effective }, sIdx) => {
                      const duration = getShiftDurationHours(shift.startTime, shift.endTime);

                      return (
                        <div
                          key={sIdx}
                          className="p-3 rounded-xl bg-gray-50/80 border border-gray-200/80 space-y-1.5 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-gray-900">
                              {day}: {shift.label}
                            </span>
                            <span className="text-[10px] text-gray-500 font-mono">
                              {duration}h active
                            </span>
                          </div>

                          <div className="text-[11px] text-gray-600 flex items-center justify-between">
                            <span>Hours:</span>
                            <strong className="text-gray-800">
                              {formatTime12h(shift.startTime)} – {formatTime12h(shift.endTime)}
                            </strong>
                          </div>

                          <div className="text-[11px] text-gray-600 flex items-center justify-between">
                            <span>Available slots ({effective.interval}m):</span>
                            <strong className="text-magenta-700">
                              {effective.possibleSlots} slots
                            </strong>
                          </div>

                          <div className="pt-1 border-t border-gray-200/60 flex items-center justify-between text-[11px]">
                            <span className="text-gray-500">Interval source:</span>
                            <span className="font-semibold text-gray-700 capitalize">
                              {effective.intervalSource === "shift"
                                ? "Shift Override"
                                : effective.intervalSource === "doctor"
                                  ? "Doctor Default"
                                  : "Clinic Default"}
                            </span>
                          </div>

                          <div className="pt-1 border-t border-gray-200/60 flex items-center justify-between font-bold text-[11px]">
                            <span className="text-gray-700">Bookable Slots:</span>
                            <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                              {effective.possibleSlots} slots max
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Multi-Doctor Roster Co-Working Notice */}
            {coWorkingDoctors.length > 0 ? (
              <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-200/80 text-blue-900 text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-blue-800">
                  <Stethoscope className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  <span>
                    Co-Working on Duty: {new Set(coWorkingDoctors.map((c) => c.doctorName)).size} other doctor{new Set(coWorkingDoctors.map((c) => c.doctorName)).size > 1 ? "s" : ""} scheduled on these days ({coWorkingDoctors.length} concurrent shift{coWorkingDoctors.length > 1 ? "s" : ""} active)
                  </span>
                </div>
                <div className="space-y-0.5 pl-4 text-[11px] text-blue-700">
                  {coWorkingDoctors.map((c, idx) => (
                    <p key={idx}>
                      • <strong>{c.day}:</strong> {c.doctorName} ({formatTime12h(c.dutyStart)} – {formatTime12h(c.dutyEnd)})
                    </p>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-slate-50 border border-gray-200 text-gray-600 text-xs flex items-center gap-2 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Only doctor scheduled on the selected days.</span>
              </div>
            )}

            {/* Inline Schedule Save Success Notification */}
            {scheduleSavedFeedback && (
              <div className="flex items-center gap-2.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-xl px-4 py-3 shadow-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  Duty schedule successfully saved for <strong>{scheduleSavedFeedback.doctorName}</strong> ({scheduleSavedFeedback.daysCount} active days, {scheduleSavedFeedback.shiftsCount} shift{scheduleSavedFeedback.shiftsCount > 1 ? "s" : ""} configured).
                </span>
              </div>
            )}

            {scheduleError && (
              <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
                <AlertCircle className="w-4 h-4 shrink-0" /> {scheduleError}
              </div>
            )}

            <div className="flex justify-end gap-2.5 pt-3 border-t border-gray-100">
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
                className={`inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-60 shadow-xs cursor-pointer ${scheduleSavedFeedback
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : "bg-[#c0166a] hover:bg-[#a01258] text-white"
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
        )}
      </div>

      {/* ── Attending Doctors Roster (Clean Single Section) ─────── */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900">
            Attending Doctors Roster ({allDoctors.length})
          </h3>
          <span className="text-xs text-gray-400">Synced with patient booking schedule</span>
        </div>

        {loadingDoctors ? (
          <div className="bg-white rounded-2xl border border-gray-100 py-16 text-center shadow-xs">
            <Loader2 className="w-7 h-7 text-[#c0166a] animate-spin mx-auto mb-2" />
            <p className="text-xs text-gray-400">Loading doctors and duty schedules...</p>
          </div>
        ) : allDoctors.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-gray-200 py-16 text-center shadow-xs">
            <Stethoscope className="w-10 h-10 text-gray-200 mx-auto mb-2.5" />
            <p className="text-sm text-gray-700 font-medium">No doctors registered yet.</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Add your attending dermatologists using the Register New Doctor tab above.
            </p>
          </div>
        ) : (
          allDoctors.map((doc, i) => {
            return (
              <motion.div
                key={doc.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="bg-white rounded-2xl border border-gray-200/80 shadow-2xs p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-gray-300 transition-all text-left"
              >
                <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                  {/* Avatar */}
                  {doc.photo ? (
                    <img
                      src={doc.photo}
                      alt={doc.name}
                      className="w-12 h-12 rounded-xl object-cover border border-magenta-200 shadow-2xs shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-magenta-50 border border-magenta-100 flex items-center justify-center shrink-0 text-[#c0166a] font-bold text-base">
                      {doc.name.replace("Dr.", "").trim().charAt(0) || "D"}
                    </div>
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-gray-900 text-sm">
                        {doc.name}
                      </h3>
                      <span className="text-[10px] text-gray-400 font-mono">
                        PRC: #{doc.prcLicense || "Pending"}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {doc.email}
                      <span className="mx-1.5 text-gray-300">•</span>
                      {doc.contactNumber || "No phone"}
                    </p>

                    {/* Specializations */}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {doc.specializations.length > 0 ? (
                        doc.specializations.map((spec) => (
                          <span
                            key={spec.id}
                            className="inline-block text-[10px] px-2 py-0.5 rounded-md bg-magenta-50 text-magenta-700 border border-magenta-100 font-semibold"
                          >
                            {spec.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-gray-400 italic">
                          General Dermatology
                        </span>
                      )}
                    </div>

                    {/* Shift & Capacity Summary */}
                    {(() => {
                      const docSched = parseDoctorSchedule(doc.dutySchedule, doc.dutyDays);
                      const activeDays = ALL_DAYS_OF_WEEK.filter(
                        (d) => docSched.weeklyShifts[d] && docSched.weeklyShifts[d].length > 0
                      );
                      const totalShiftsCount = activeDays.reduce(
                        (acc, d) => acc + (docSched.weeklyShifts[d]?.length || 0),
                        0
                      );
                      const avgShiftsPerDay = activeDays.length > 0
                        ? Math.round(totalShiftsCount / activeDays.length)
                        : 0;
                      const firstDay = activeDays[0];
                      const firstDayShifts = firstDay ? docSched.weeklyShifts[firstDay] || [] : [];
                      const shiftsSummaryStr = firstDayShifts
                        .map((s) => `${formatTime12h(s.startTime)}–${formatTime12h(s.endTime)}`)
                        .join(", ");

                      const distinctIntervals = Array.from(
                        new Set(
                          activeDays.flatMap((d) =>
                            (docSched.weeklyShifts[d] || []).map((s) => {
                              const eff = getEffectiveShiftSettings(
                                s,
                                docSched,
                                { defaultSlotIntervalMinutes: clinicDefaultInterval }
                              );
                              return eff.interval;
                            })
                          )
                        )
                      );
                      const intervalDisplayStr =
                        distinctIntervals.length > 1
                          ? `${distinctIntervals.join("m, ")}m`
                          : `${distinctIntervals[0] || doc.slotIntervalMinutes || docSched.slotIntervalMinutes || clinicDefaultInterval}m`;

                      return (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                          {activeDays.length > 0 ? (
                            <>
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-gray-50 border border-gray-200/80 text-gray-700 font-medium">
                                <Calendar className="w-3 h-3 text-[#c0166a]" />
                                {activeDays.map((d) => d.slice(0, 3)).join(", ")}
                              </span>
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-gray-50 border border-gray-200/80 text-gray-700 font-medium">
                                <Clock className="w-3 h-3 text-[#c0166a]" />
                                {shiftsSummaryStr || `${formatTime12h(doc.dutyStartTime || "08:00")} – ${formatTime12h(doc.dutyEndTime || "17:00")}`}
                                {avgShiftsPerDay > 1 && (
                                  <span className="text-[10px] text-magenta-700 font-bold ml-0.5">
                                    ({avgShiftsPerDay} shifts/day)
                                  </span>
                                )}
                              </span>
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-pink-50 border border-pink-200/70 text-[#c0166a] font-semibold">
                                <Clock className="w-3 h-3" />
                                {intervalDisplayStr} consultation slots
                              </span>
                            </>
                          ) : (
                            <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200/60 font-medium">
                              No duty schedule assigned
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Card Actions (Matching Reference Exactly) */}
                <div className="flex items-center gap-2.5 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-gray-100">
                  <button
                    type="button"
                    onClick={() => handleScheduleDoctor(doc)}
                    className="px-4 py-2 rounded-xl bg-[#c0166a] hover:bg-[#a01258] text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
                  >
                    Schedule Shift
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedDoctorForDetails(doc)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 transition-all cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5 text-gray-500" />
                    <span>Details</span>
                  </button>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* ── Add Doctor Confirmation Modal ────────────────────────── */}
      <AnimatePresence>
        {showRegisterConfirmModal && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-100 max-h-[90vh] flex flex-col text-left"
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

      {/* ── Doctor Details Modal ─────────────────────────────────── */}
      <AnimatePresence>
        {selectedDoctorForDetails && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-100 text-left flex flex-col"
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

                  <button
                    type="button"
                    onClick={() => {
                      const doc = selectedDoctorForDetails;
                      setSelectedDoctorForDetails(null);
                      handleScheduleDoctor(doc);
                    }}
                    className="px-4 py-1.5 rounded-xl bg-[#c0166a] hover:bg-[#a01258] text-white text-xs font-bold transition-colors shadow-xs cursor-pointer"
                  >
                    Edit Schedule
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Status Toggle Confirmation Modal ─────────────────────── */}
      <AnimatePresence>
        {statusConfirmDoctor && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 border border-gray-100 text-center"
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

      {/* ── Delete Confirmation Modal ─────────────────────────────── */}
      <AnimatePresence>
        {deleteTarget && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 border border-gray-100 text-center"
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
    </div>
  );
}
