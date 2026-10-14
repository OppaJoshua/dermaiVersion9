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
  Sparkles,
  AlertTriangle,
  Check,
  ChevronDown,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useClinicVerification } from "@/hooks/useClinicVerification";
import { supabase } from "@/lib/supabaseClient";
import SpecializationMultiSelect, {
  type SpecializationOption,
} from "@/components/clinic/SpecializationMultiSelect";

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
  dutySchedule?: Record<string, DayShift>;
};

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

const ALL_DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const TIME_SLOT_OPTIONS = [
  { value: "07:00", label: "7:00 AM (Early Open)" },
  { value: "07:30", label: "7:30 AM" },
  { value: "08:00", label: "8:00 AM (Clinic Opens)" },
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
  { value: "20:00", label: "8:00 PM (Clinic Closes)" },
  { value: "20:30", label: "8:30 PM" },
  { value: "21:00", label: "9:00 PM (Late Close)" },
];

interface ScheduleConflict {
  day: string;
  doctorName: string;
  dutyStart: string;
  dutyEnd: string;
  isExactOverlap: boolean;
}

function timeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatTime12h(timeStr: string): string {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  const ampm = (h || 0) >= 12 ? "PM" : "AM";
  const hour = (h || 0) % 12 || 12;
  return `${hour}:${String(m || 0).padStart(2, "0")} ${ampm}`;
}

function getShiftDurationHours(startStr: string, endStr: string): number {
  if (!startStr || !endStr) return 0;
  const startMin = timeToMinutes(startStr);
  const endMin = timeToMinutes(endStr);
  if (endMin <= startMin) return 0;
  return Math.round(((endMin - startMin) / 60) * 10) / 10;
}

function getDoctorShiftForDay(
  doc: { dutyStartTime?: string; dutyEndTime?: string; dutySchedule?: Record<string, DayShift> },
  day: string
): { startTime: string; endTime: string } {
  if (doc.dutySchedule && doc.dutySchedule[day] && doc.dutySchedule[day].startTime && doc.dutySchedule[day].endTime) {
    return doc.dutySchedule[day];
  }
  return {
    startTime: doc.dutyStartTime || "09:00",
    endTime: doc.dutyEndTime || "17:00",
  };
}

function ModernTimeSelect({
  value,
  onChange,
  label,
  placeholder = "Select time",
  disabled = false,
}: {
  value: string;
  onChange: (val: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
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

  const selectedOpt = TIME_SLOT_OPTIONS.find((o) => o.value === value);

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
        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border bg-white text-xs font-semibold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
          open
            ? "border-[#c0166a] ring-2 ring-magenta-500/10 shadow-xs"
            : "border-gray-200 hover:border-gray-300 hover:bg-gray-50/60"
        }`}
      >
        <div className="flex items-center gap-2 text-gray-900 truncate">
          <Clock className="w-3.5 h-3.5 text-[#c0166a] shrink-0" />
          <span className="font-bold">{selectedOpt ? selectedOpt.label : (value ? formatTime12h(value) : placeholder)}</span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform ${open ? "rotate-180 text-[#c0166a]" : ""}`}
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
            {TIME_SLOT_OPTIONS.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    isSelected
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

export default function ClinicDoctorsPage() {
  const { clinicName: verifiedClinicName, clinicId } = useClinicVerification();
  const clinicDisplayName = verifiedClinicName || "Clinic Portal";

  // Dynamic specializations
  const [specializations, setSpecializations] = useState<SpecializationOption[]>(DEFAULT_SPECIALIZATIONS);
  const [loadingSpecializations, setLoadingSpecializations] = useState(false);

  // Doctors list
  const [allDoctors, setAllDoctors] = useState<DoctorAccount[]>([]);
  const [loadingDoctors, setLoadingDoctors] = useState(true);

  // Add Doctor Form state
  const [form, setForm] = useState({
    name: "",
    email: "",
    contactNumber: "",
    prcLicense: "",
    selectedSpecializationIds: [] as string[],
    photoFile: null as File | null,
    photoPreview: "",
    dutyDays: [] as string[],
    dutyStartTime: "08:00",
    dutyEndTime: "17:00",
    isCustomSchedule: false,
    dutySchedule: {} as Record<string, DayShift>,
  });
  const [formError, setFormError] = useState("");
  const [savingDoctor, setSavingDoctor] = useState(false);
  const saveDoctorLockRef = useRef(false);
  const [successMsg, setSuccessMsg] = useState("");

  const photoFileInputRef = useRef<HTMLInputElement>(null);
  const editPhotoFileInputRef = useRef<HTMLInputElement>(null);

  // Modals state
  const [showAddConfirmModal, setShowAddConfirmModal] = useState(false);
  const [selectedDoctorForDetails, setSelectedDoctorForDetails] = useState<DoctorAccount | null>(null);
  const [editingDoctor, setEditingDoctor] = useState<DoctorAccount | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    contactNumber: "",
    prcLicense: "",
    selectedSpecializationIds: [] as string[],
    photoFile: null as File | null,
    photoPreview: "",
    dutyDays: [] as string[],
    dutyStartTime: "08:00",
    dutyEndTime: "17:00",
    isCustomSchedule: false,
    dutySchedule: {} as Record<string, DayShift>,
  });
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete modal
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deletingDoctor, setDeletingDoctor] = useState(false);

  // Status toggle confirmation modal
  const [statusConfirmDoctor, setStatusConfirmDoctor] = useState<DoctorAccount | null>(null);
  const [togglingStatus, setTogglingStatus] = useState(false);

  const formSectionRef = useRef<HTMLDivElement>(null);

  // Compute weekly duty matrix (which doctors work on which days)
  const weeklyRosterMatrix = useMemo(() => {
    const matrix: Record<
      string,
      { name: string; start: string; end: string; id: string; photo?: string; prc?: string }[]
    > = {
      Monday: [],
      Tuesday: [],
      Wednesday: [],
      Thursday: [],
      Friday: [],
      Saturday: [],
      Sunday: [],
    };

    allDoctors.forEach((doc) => {
      if (doc.status !== "Active") return;
      const days = doc.dutyDays && doc.dutyDays.length > 0
        ? doc.dutyDays
        : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
      days.forEach((day) => {
        if (matrix[day]) {
          const shift = getDoctorShiftForDay(doc, day);
          matrix[day].push({
            id: doc.id,
            name: doc.name,
            start: shift.startTime,
            end: shift.endTime,
            photo: doc.photo,
            prc: doc.prcLicense,
          });
        }
      });
    });

    return matrix;
  }, [allDoctors]);

  // Compute live conflicts for the Add Doctor form
  const addFormConflicts = useMemo(() => {
    const conflicts: ScheduleConflict[] = [];
    if (!form.dutyDays.length) return conflicts;

    allDoctors.forEach((doc) => {
      if (doc.status !== "Active") return;
      const docDays = doc.dutyDays && doc.dutyDays.length > 0
        ? doc.dutyDays
        : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

      form.dutyDays.forEach((day) => {
        if (docDays.includes(day)) {
          const formShift = form.isCustomSchedule && form.dutySchedule[day]
            ? form.dutySchedule[day]
            : { startTime: form.dutyStartTime || "09:00", endTime: form.dutyEndTime || "17:00" };
          const docShift = getDoctorShiftForDay(doc, day);

          const startMin = timeToMinutes(formShift.startTime);
          const endMin = timeToMinutes(formShift.endTime);
          const docStartMin = timeToMinutes(docShift.startTime);
          const docEndMin = timeToMinutes(docShift.endTime);

          const overlapStart = Math.max(startMin, docStartMin);
          const overlapEnd = Math.min(endMin, docEndMin);
          if (overlapStart < overlapEnd) {
            conflicts.push({
              day,
              doctorName: doc.name,
              dutyStart: docShift.startTime,
              dutyEnd: docShift.endTime,
              isExactOverlap: startMin === docStartMin && endMin === docEndMin,
            });
          }
        }
      });
    });

    return conflicts;
  }, [allDoctors, form.dutyDays, form.dutyStartTime, form.dutyEndTime, form.isCustomSchedule, form.dutySchedule]);

  // Compute live conflicts for the Edit Doctor modal
  const editFormConflicts = useMemo(() => {
    const conflicts: ScheduleConflict[] = [];
    if (!editingDoctor || !editForm.dutyDays.length) return conflicts;

    allDoctors.forEach((doc) => {
      if (doc.id === editingDoctor.id || doc.status !== "Active") return;
      const docDays = doc.dutyDays && doc.dutyDays.length > 0
        ? doc.dutyDays
        : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

      editForm.dutyDays.forEach((day) => {
        if (docDays.includes(day)) {
          const editShift = editForm.isCustomSchedule && editForm.dutySchedule[day]
            ? editForm.dutySchedule[day]
            : { startTime: editForm.dutyStartTime || "09:00", endTime: editForm.dutyEndTime || "17:00" };
          const docShift = getDoctorShiftForDay(doc, day);

          const startMin = timeToMinutes(editShift.startTime);
          const endMin = timeToMinutes(editShift.endTime);
          const docStartMin = timeToMinutes(docShift.startTime);
          const docEndMin = timeToMinutes(docShift.endTime);

          const overlapStart = Math.max(startMin, docStartMin);
          const overlapEnd = Math.min(endMin, docEndMin);
          if (overlapStart < overlapEnd) {
            conflicts.push({
              day,
              doctorName: doc.name,
              dutyStart: docShift.startTime,
              dutyEnd: docShift.endTime,
              isExactOverlap: startMin === docStartMin && endMin === docEndMin,
            });
          }
        }
      });
    });

    return conflicts;
  }, [allDoctors, editingDoctor, editForm.dutyDays, editForm.dutyStartTime, editForm.dutyEndTime, editForm.isCustomSchedule, editForm.dutySchedule]);

  // Helper to compress an uploaded photo into a compact, high-quality DataURL (max 512px, ~30-50KB)
  // This guarantees it fits safely in localStorage and database text columns without quota errors
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

  // Helper to upload photo to Supabase storage or compressed DataURL fallback
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
    // Return compressed DataURL fallback so it fits safely anywhere
    return compressImageToDataUrl(file);
  };

  // 1. Fetch specializations dynamically from database if available
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

  // 2. Fetch doctors from database
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
        // Build map of existing cached photos to never lose them if DB returns null
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
                  if (d.name) {
                    const clean = String(d.name).toLowerCase().replace(/^(dr|doctor)\.?\s+/i, "").trim();
                    localPhotoMap.set(clean, p);
                  }
                  if (d.doctor_name) {
                    const clean = String(d.doctor_name).toLowerCase().replace(/^(dr|doctor)\.?\s+/i, "").trim();
                    localPhotoMap.set(clean, p);
                  }
                }
              });
            }
          }
        } catch {}

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

          let parsedDutySchedule: Record<string, DayShift> | undefined = undefined;
          if (doc.duty_schedule && typeof doc.duty_schedule === "object" && !Array.isArray(doc.duty_schedule)) {
            parsedDutySchedule = doc.duty_schedule;
          } else if (Array.isArray(doc.duty_schedule)) {
            parsedDutySchedule = {};
            doc.duty_schedule.forEach((item: any) => {
              if (item && item.day) {
                parsedDutySchedule![item.day] = {
                  startTime: item.startTime || item.start_time || item.start || "09:00",
                  endTime: item.endTime || item.end_time || item.end || "17:00",
                };
              }
            });
          }

          const cleanDocName = String(doc.doctor_name || "").toLowerCase().replace(/^(dr|doctor)\.?\s+/i, "").trim();
          const preservedPhoto =
            doc.photo_url ||
            localPhotoMap.get(String(doc.doctor_id)) ||
            (doc.email ? localPhotoMap.get(String(doc.email).toLowerCase().trim()) : undefined) ||
            localPhotoMap.get(cleanDocName) ||
            undefined;

          return {
            id: doc.doctor_id,
            name: doc.doctor_name,
            email: doc.email,
            contactNumber: doc.contact_number || "",
            prcLicense: doc.prc_license || "",
            photo: preservedPhoto,
            dutyDays: parsedDutyDays,
            dutyStartTime: doc.duty_start_time || "09:00",
            dutyEndTime: doc.duty_end_time || "17:00",
            dutySchedule: parsedDutySchedule,
            specialization: docSpecs.map((s) => s.name).join(", "),
            specializations: docSpecs,
            clinicName: clinicDisplayName,
            status: doc.status === "Inactive" ? "Inactive" : "Active",
          };
        });

        setAllDoctors(mapped);
        try {
          localStorage.setItem("dermai_clinic_doctors", JSON.stringify(mapped));
        } catch {
          /* ignore */
        }
      } else {
        // Fallback to local storage cache if offline
        try {
          const saved = localStorage.getItem("dermai_clinic_doctors");
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
              setAllDoctors(parsed);
            }
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      // Local state fallback
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
      } catch {
        /* ignore */
      }
    };

    window.addEventListener("storage", handleStorageUpdate);
    return () => window.removeEventListener("storage", handleStorageUpdate);
  }, [fetchSpecializations, fetchDoctors]);

  const resetForm = () => {
    setForm({
      name: "",
      email: "",
      contactNumber: "",
      prcLicense: "",
      selectedSpecializationIds: [],
      photoFile: null,
      photoPreview: "",
      dutyDays: [],
      dutyStartTime: "08:00",
      dutyEndTime: "17:00",
      isCustomSchedule: false,
      dutySchedule: {},
    });
    if (photoFileInputRef.current) photoFileInputRef.current.value = "";
    setFormError("");
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>, isEdit = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 1024 * 1024 * 10) {
      if (isEdit) setEditError("Doctor photo should be less than 10MB.");
      else setFormError("Doctor photo should be less than 10MB.");
      return;
    }

    try {
      const compressedDataUrl = await compressImageToDataUrl(file);
      if (isEdit) {
        setEditForm((p) => ({ ...p, photoFile: file, photoPreview: compressedDataUrl }));
      } else {
        setForm((p) => ({ ...p, photoFile: file, photoPreview: compressedDataUrl }));
      }
    } catch {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = (reader.result as string) || "";
        if (isEdit) {
          setEditForm((p) => ({ ...p, photoFile: file, photoPreview: dataUrl }));
        } else {
          setForm((p) => ({ ...p, photoFile: file, photoPreview: dataUrl }));
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const toggleDaySelection = (day: string, isEdit = false) => {
    if (isEdit) {
      setEditForm((p) => {
        const exists = p.dutyDays.includes(day);
        const updated = exists ? p.dutyDays.filter((d) => d !== day) : [...p.dutyDays, day];
        const nextSched = { ...p.dutySchedule };
        if (!exists && !nextSched[day]) {
          nextSched[day] = { startTime: p.dutyStartTime || "09:00", endTime: p.dutyEndTime || "17:00" };
        }
        return { ...p, dutyDays: updated, dutySchedule: nextSched };
      });
    } else {
      setForm((p) => {
        const exists = p.dutyDays.includes(day);
        const updated = exists ? p.dutyDays.filter((d) => d !== day) : [...p.dutyDays, day];
        const nextSched = { ...p.dutySchedule };
        if (!exists && !nextSched[day]) {
          nextSched[day] = { startTime: p.dutyStartTime || "09:00", endTime: p.dutyEndTime || "17:00" };
        }
        return { ...p, dutyDays: updated, dutySchedule: nextSched };
      });
    }
  };

  // Validate form fields and open confirmation modal
  const handleInitiateAddDoctor = () => {
    setFormError("");
    const { name, email, contactNumber, prcLicense, selectedSpecializationIds, dutyDays } = form;

    if (!name.trim()) {
      setFormError("Doctor name is required.");
      return;
    }
    if (!email.trim() || !/\S+@\S+\.\S+/.test(email)) {
      setFormError("Valid email is required (e.g. doctor@gmail.com).");
      return;
    }
    if (!contactNumber.trim()) {
      setFormError("Contact number is required.");
      return;
    }
    if (contactNumber.trim().length !== 11) {
      setFormError("Contact number must be exactly 11 digits (e.g. 09171234567).");
      return;
    }
    if (!prcLicense.trim()) {
      setFormError("PRC license is required.");
      return;
    }
    if (prcLicense.trim().length > 7) {
      setFormError("PRC license must be up to 7 characters.");
      return;
    }
    if (selectedSpecializationIds.length === 0) {
      setFormError("Please select at least one specialization.");
      return;
    }
    if (dutyDays.length === 0) {
      setFormError("Please select at least one duty day for the doctor.");
      return;
    }

    setShowAddConfirmModal(true);
  };

  // Confirmed save new doctor & associate multiple specializations
  const handleConfirmSaveDoctor = async () => {
    setShowAddConfirmModal(false);
    await saveDoctor();
  };

  // Save new doctor & associate multiple specializations
  const saveDoctor = async () => {
    if (saveDoctorLockRef.current) return;
    saveDoctorLockRef.current = true;
    setSavingDoctor(true);
    setFormError("");

    let createdDoctorId: string | null = null;

    try {
      if (!clinicId) {
        throw new Error("Your clinic could not be verified. Refresh the page and try again.");
      }

      const doctorName = form.name.trim();
      const doctorEmail = form.email.trim().toLowerCase();
      const doctorContact = form.contactNumber.trim();
      const doctorLicense = form.prcLicense.trim();

      const assignedSpecs = specializations.filter((s) =>
        form.selectedSpecializationIds.includes(s.id)
      );

      if (assignedSpecs.length === 0) {
        throw new Error("Select at least one specialization.");
      }

      let uploadedPhotoUrl = form.photoPreview;
      if (form.photoFile) {
        uploadedPhotoUrl = await uploadDoctorPhoto(form.photoFile);
      }

      const customSchedulePayload: Record<string, DayShift> = {};
      form.dutyDays.forEach((d) => {
        customSchedulePayload[d] = form.dutySchedule[d] || {
          startTime: form.dutyStartTime || "09:00",
          endTime: form.dutyEndTime || "17:00",
        };
      });

      const { data: inviteData, error: inviteError } = await supabase.rpc(
        "invite_doctor",
        {
          target_clinic_id: clinicId,
          doctor_email: doctorEmail,
          doctor_full_name: doctorName,
          doctor_prc_license: doctorLicense,
          doctor_specialization: assignedSpecs[0].name,
        }
      );

      if (inviteError) {
        throw new Error(`Doctor account linking failed: ${inviteError.message}`);
      }
      if (!inviteData) {
        throw new Error("The server did not return a doctor record ID.");
      }

      createdDoctorId = inviteData;

      const updatePayload: Record<string, unknown> = {
        contact_number: doctorContact,
        photo_url: uploadedPhotoUrl || null,
        duty_days: form.dutyDays,
        duty_start_time: form.dutyStartTime,
        duty_end_time: form.dutyEndTime,
        duty_schedule: form.isCustomSchedule ? customSchedulePayload : null,
      };

      let updateRes = await supabase
        .from("clinic_doctor")
        .update(updatePayload)
        .eq("doctor_id", createdDoctorId)
        .eq("clinic_id", clinicId);

      if (updateRes.error?.message?.includes("duty_schedule")) {
        delete updatePayload.duty_schedule;
        updateRes = await supabase
          .from("clinic_doctor")
          .update(updatePayload)
          .eq("doctor_id", createdDoctorId)
          .eq("clinic_id", clinicId);
      }

      if (updateRes.error) {
        throw new Error(`Doctor details could not be saved: ${updateRes.error.message}`);
      }

      const deleteSpecsRes = await supabase
        .from("doctor_specializations")
        .delete()
        .eq("doctor_id", createdDoctorId);

      if (deleteSpecsRes.error) {
        throw new Error(
          `Specializations could not be updated: ${deleteSpecsRes.error.message}`
        );
      }

      const junctionRows = assignedSpecs.map((spec) => ({
        doctor_id: createdDoctorId as string,
        specialization_id: spec.id,
      }));

      const insertSpecsRes = await supabase
        .from("doctor_specializations")
        .insert(junctionRows);

      if (insertSpecsRes.error) {
        throw new Error(
          `Selected specializations could not be saved: ${insertSpecsRes.error.message}`
        );
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
        dutyDays: form.dutyDays,
        dutyStartTime: form.dutyStartTime,
        dutyEndTime: form.dutyEndTime,
        dutySchedule: form.isCustomSchedule ? customSchedulePayload : undefined,
      };

      const updatedList = [finalizedDoctor, ...allDoctors];
      setAllDoctors(updatedList);
      localStorage.setItem("dermai_clinic_doctors", JSON.stringify(updatedList));
      window.dispatchEvent(new Event("storage"));
      window.dispatchEvent(new CustomEvent("dermai_doctors_updated"));

      resetForm();
      setSuccessMsg(`Dr. ${finalizedDoctor.name} was successfully added.`);
      setTimeout(() => setSuccessMsg(""), 4000);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred.";

      if (createdDoctorId) {
        setFormError(
          `${message} A doctor record may already exist (ID: ${createdDoctorId}). No automatic deletion was attempted. Please verify the record before retrying.`
        );
      } else {
        setFormError(message);
      }
    } finally {
      saveDoctorLockRef.current = false;
      setSavingDoctor(false);
    }
  };
  // Open Edit Doctor Modal
  const handleOpenEdit = (doctor: DoctorAccount) => {
    setSelectedDoctorForDetails(null);
    setEditError("");

    const hasCustomSchedule = Boolean(
      doctor.dutySchedule && Object.keys(doctor.dutySchedule).length > 0
    );

    const initialSched: Record<string, DayShift> = {};
    (doctor.dutyDays || []).forEach((d) => {
      if (doctor.dutySchedule && doctor.dutySchedule[d]) {
        initialSched[d] = { ...doctor.dutySchedule[d] };
      } else {
        initialSched[d] = {
          startTime: doctor.dutyStartTime || "09:00",
          endTime: doctor.dutyEndTime || "17:00",
        };
      }
    });

    setEditingDoctor(doctor);
    setEditForm({
      name: doctor.name,
      email: doctor.email,
      contactNumber: doctor.contactNumber || "",
      prcLicense: doctor.prcLicense || "",
      selectedSpecializationIds: (doctor.specializations || []).map((s) => s.id),
      photoFile: null,
      photoPreview: doctor.photo || "",
      dutyDays: doctor.dutyDays || ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      dutyStartTime: doctor.dutyStartTime || "09:00",
      dutyEndTime: doctor.dutyEndTime || "17:00",
      isCustomSchedule: hasCustomSchedule,
      dutySchedule: initialSched,
    });
  };

  // Save Doctor Edit
  const saveDoctorEdit = async () => {
    if (!editingDoctor) return;
    setEditError("");

    const {
      name,
      email,
      contactNumber,
      prcLicense,
      selectedSpecializationIds,
      dutyDays,
      dutyStartTime,
      dutyEndTime,
      isCustomSchedule,
      dutySchedule,
    } = editForm;

    if (!name.trim()) {
      setEditError("Doctor name is required.");
      return;
    }
    if (!email.trim() || !/\S+@\S+\.\S+/.test(email)) {
      setEditError("Valid email is required.");
      return;
    }
    if (!contactNumber.trim() || contactNumber.trim().length !== 11) {
      setEditError("Contact number must be exactly 11 digits.");
      return;
    }
    if (!prcLicense.trim()) {
      setEditError("PRC license is required.");
      return;
    }
    if (prcLicense.trim().length > 7) {
      setEditError("PRC license must be up to 7 characters.");
      return;
    }
    if (selectedSpecializationIds.length === 0) {
      setEditError("Please select at least one specialization.");
      return;
    }
    if (dutyDays.length === 0) {
      setEditError("Please select at least one duty day.");
      return;
    }

    setSavingEdit(true);

    try {
      let uploadedPhotoUrl = editForm.photoPreview;
      if (editForm.photoFile) {
        uploadedPhotoUrl = await uploadDoctorPhoto(editForm.photoFile);
      }

      const assignedSpecs = specializations.filter((s) =>
        selectedSpecializationIds.includes(s.id)
      );
      const specString = assignedSpecs.map((s) => s.name).join(", ");

      const customSchedulePayload: Record<string, DayShift> = {};
      dutyDays.forEach((d) => {
        customSchedulePayload[d] = dutySchedule[d] || {
          startTime: dutyStartTime || "09:00",
          endTime: dutyEndTime || "17:00",
        };
      });

      const updatedDoctor: DoctorAccount = {
        ...editingDoctor,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        contactNumber: contactNumber.trim(),
        prcLicense: prcLicense.trim(),
        photo: uploadedPhotoUrl || undefined,
        specialization: specString || "General Dermatology",
        specializations: assignedSpecs,
        dutyDays,
        dutyStartTime,
        dutyEndTime,
        dutySchedule: isCustomSchedule ? customSchedulePayload : undefined,
      };

      const nextList = allDoctors.map((d) =>
        d.id === editingDoctor.id ? updatedDoctor : d
      );
      setAllDoctors(nextList);
      localStorage.setItem("dermai_clinic_doctors", JSON.stringify(nextList));
      window.dispatchEvent(new Event("storage"));
      window.dispatchEvent(new CustomEvent("dermai_doctors_updated"));

      setEditingDoctor(null);
      setSuccessMsg(`Dr. ${updatedDoctor.name} updated successfully.`);
      setTimeout(() => setSuccessMsg(""), 3500);

      // Supabase Update
      const updatePayload: any = {
        doctor_name: updatedDoctor.name,
        email: updatedDoctor.email,
        contact_number: updatedDoctor.contactNumber,
        prc_license: updatedDoctor.prcLicense,
        photo_url: uploadedPhotoUrl || null,
        duty_days: updatedDoctor.dutyDays,
        duty_start_time: updatedDoctor.dutyStartTime,
        duty_end_time: updatedDoctor.dutyEndTime,
        duty_schedule: isCustomSchedule ? customSchedulePayload : null,
      };

      const updateRes = await supabase
        .from("clinic_doctor")
        .update(updatePayload)
        .eq("doctor_id", editingDoctor.id);

      if (updateRes.error && updateRes.error.message?.includes("duty_schedule")) {
        delete updatePayload.duty_schedule;
        await supabase
          .from("clinic_doctor")
          .update(updatePayload)
          .eq("doctor_id", editingDoctor.id);
      }

      // Update specializations junction table
      await supabase
        .from("doctor_specializations")
        .delete()
        .eq("doctor_id", editingDoctor.id);

      const junctionRows = selectedSpecializationIds.map((specId) => ({
        doctor_id: editingDoctor.id,
        specialization_id: specId,
      }));
      await supabase.from("doctor_specializations").insert(junctionRows);
    } catch {
      // Local state is preserved
    } finally {
      setSavingEdit(false);
    }
  };

  // Toggle Doctor Active / Inactive status
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
        .update({
          status: nextStatus,
        })
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
    <div className="space-y-6 pb-12 max-w-6xl mx-auto">
      {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Top Header ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">
            Clinic Doctors &amp; Duty Roster
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Manage attending dermatologists, credentials, and weekly consultation shifts.
          </p>
        </div>
        <span className="text-[11px] font-semibold text-gray-500 bg-gray-50 px-3 py-1 rounded-full border border-gray-200 self-start sm:self-auto">
          {clinicDisplayName}
        </span>
      </div>

      {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Success Notification ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
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

      {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Add Doctor Form Card (Original Clean Minimal Structure) ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
      <div
        ref={formSectionRef}
        className="bg-white rounded-2xl border border-gray-200/80 p-5 sm:p-6 shadow-xs"
      >
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-[#c0166a]" />
            New Doctor Profile &amp; Schedule
          </h2>
          <span className="text-[10px] text-gray-400 font-medium">
            Fill required details (*)
          </span>
        </div>

        {/* Doctor Photo Section */}
        <div className="mb-5 p-3.5 rounded-xl bg-gray-50/60 border border-gray-100 flex items-center gap-4">
          <div className="relative shrink-0">
            {form.photoPreview ? (
              <img
                src={form.photoPreview}
                alt="Doctor Preview"
                className="w-14 h-14 rounded-xl object-cover border border-magenta-200"
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
              onChange={(e) => handlePhotoSelect(e, false)}
            />
          </div>

          <div className="flex-1 min-w-0">
            <h4 className="text-xs font-bold text-gray-800">Doctor Profile Picture</h4>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Clear medical headshot for patient appointment selection (JPG/PNG, max 5MB).
            </p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => photoFileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-semibold transition-colors cursor-pointer"
              >
                <Upload className="w-3 h-3 text-[#c0166a]" />
                {form.photoPreview ? "Change Photo" : "Upload Headshot"}
              </button>
              {form.photoPreview && (
                <button
                  type="button"
                  onClick={() => {
                    setForm((p) => ({ ...p, photoFile: null, photoPreview: "" }));
                    if (photoFileInputRef.current) photoFileInputRef.current.value = "";
                  }}
                  className="text-xs text-rose-500 hover:text-rose-600 font-medium px-1.5 py-0.5"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Inputs Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              Full Name *
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
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
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
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
              value={form.contactNumber}
              onChange={(e) =>
                setForm((p) => ({
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
              value={form.prcLicense}
              onChange={(e) =>
                setForm((p) => ({
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
              selectedIds={form.selectedSpecializationIds}
              onChange={(ids) => setForm((p) => ({ ...p, selectedSpecializationIds: ids }))}
              placeholder="Select one or more clinical specializations..."
              disabled={loadingSpecializations || savingDoctor}
            />
          </div>

          {/* Duty Schedule Setup Section */}
          <div className="sm:col-span-2 pt-4 border-t border-gray-100 space-y-4">
            {/* 1. Unified Duty Days Selector */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-[#c0166a]" />
                  Select Weekly Duty Days *
                </label>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, dutyDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] }))}
                    className="text-magenta-700 hover:text-magenta-800 font-semibold hover:underline cursor-pointer"
                  >
                    MonÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“Fri
                  </button>
                  <span className="text-gray-300">ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢</span>
                  <button
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, dutyDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] }))}
                    className="text-magenta-700 hover:text-magenta-800 font-semibold hover:underline cursor-pointer"
                  >
                    MonÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“Sat
                  </button>
                  <span className="text-gray-300">ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢</span>
                  <button
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, dutyDays: [...ALL_DAYS_OF_WEEK] }))}
                    className="text-magenta-700 hover:text-magenta-800 font-semibold hover:underline cursor-pointer"
                  >
                    All Week
                  </button>
                  {form.dutyDays.length > 0 && (
                    <>
                      <span className="text-gray-300">•</span>
                      <button
                        type="button"
                        onClick={() => setForm((p) => ({ ...p, dutyDays: [] }))}
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
                  const isSelected = form.dutyDays.includes(day);
                  const doctorsOnDay = weeklyRosterMatrix[day] || [];

                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDaySelection(day, false)}
                      className={`p-2.5 rounded-xl border transition-all text-center flex flex-col items-center justify-center cursor-pointer ${
                        isSelected
                          ? "bg-magenta-50/80 border-magenta-300 ring-2 ring-magenta-500/20 shadow-xs"
                          : "bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50/50"
                      }`}
                    >
                      <span className={`text-xs font-bold ${isSelected ? "text-magenta-900" : "text-gray-700"}`}>
                        {day.slice(0, 3)}
                      </span>
                      <span className={`text-[9px] mt-1 font-semibold truncate ${
                        isSelected
                          ? "text-magenta-700"
                          : doctorsOnDay.length > 0 ? "text-gray-400" : "text-emerald-600"
                      }`}>
                        {doctorsOnDay.length > 0 ? `${doctorsOnDay.length} Dr` : "Open"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Consultation Shift Hours (Direct Time Selection, No Presets) */}
            <div className="p-4 rounded-2xl bg-gray-50/70 border border-gray-200/80 space-y-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#c0166a]" />
                    Duty Consultation Hours
                  </label>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {form.isCustomSchedule
                      ? "Custom hours configured per duty day"
                      : "Clinic Operating Hours: 8:00 AM ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ 8:00 PM"}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (!form.isCustomSchedule) {
                      const nextSched = { ...form.dutySchedule };
                      form.dutyDays.forEach((d) => {
                        if (!nextSched[d]) {
                          nextSched[d] = {
                            startTime: form.dutyStartTime || "08:00",
                            endTime: form.dutyEndTime || "17:00",
                          };
                        }
                      });
                      setForm((p) => ({ ...p, isCustomSchedule: true, dutySchedule: nextSched }));
                    } else {
                      setForm((p) => ({ ...p, isCustomSchedule: false }));
                    }
                  }}
                  className="text-xs font-semibold text-magenta-700 hover:text-magenta-800 px-3 py-1 rounded-lg border border-magenta-200 bg-white hover:bg-magenta-50 transition-colors cursor-pointer"
                >
                  {form.isCustomSchedule ? "ÃƒÂ¢Ã¢â‚¬Â Ã‚Â Uniform Shift (Same for all days)" : "+ Customize hours per day"}
                </button>
              </div>

              {!form.isCustomSchedule ? (
                /* Direct Time Pickers (Preset-Free) */
                <div className="p-4 rounded-2xl bg-white border border-gray-200/90 shadow-2xs space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <ModernTimeSelect
                      label="Shift Start Time"
                      value={form.dutyStartTime}
                      onChange={(val) => setForm((p) => ({ ...p, dutyStartTime: val }))}
                    />
                    <ModernTimeSelect
                      label="Shift End Time"
                      value={form.dutyEndTime}
                      onChange={(val) => setForm((p) => ({ ...p, dutyEndTime: val }))}
                    />
                  </div>

                  {/* Real-time Duration & Status Calculation */}
                  {(() => {
                    const duration = getShiftDurationHours(form.dutyStartTime, form.dutyEndTime);
                    const isInvalid = timeToMinutes(form.dutyEndTime) <= timeToMinutes(form.dutyStartTime);

                    if (isInvalid) {
                      return (
                        <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-1.5 font-medium">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span>Shift End Time must be later than Start Time.</span>
                        </div>
                      );
                    }

                    return (
                      <div className="pt-2 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-900">
                            {formatTime12h(form.dutyStartTime)} ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ {formatTime12h(form.dutyEndTime)}
                          </span>
                          <span className="text-gray-300">ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢</span>
                          <span className="font-bold text-magenta-700 bg-magenta-50 px-2.5 py-0.5 rounded-full border border-magenta-200">
                            {duration} Hours Active Duty
                          </span>
                        </div>
                        <span className="text-[11px] text-gray-400">
                          {form.dutyDays.length > 0
                            ? `Active across ${form.dutyDays.length} duty day${form.dutyDays.length === 1 ? "" : "s"}`
                            : "No duty days selected yet"}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                /* Custom Per-Day Shift Mode */
                <div className="space-y-2 pt-1">
                  {form.dutyDays.length === 0 ? (
                    <div className="p-4 rounded-xl bg-white border border-dashed border-gray-200 text-center text-xs text-gray-400">
                      Please select one or more weekly duty days above to customize hours.
                    </div>
                  ) : (
                    form.dutyDays.map((day) => {
                    const shift = form.dutySchedule[day] || {
                      startTime: form.dutyStartTime || "08:00",
                      endTime: form.dutyEndTime || "17:00",
                    };
                    const duration = getShiftDurationHours(shift.startTime, shift.endTime);

                    return (
                      <div
                        key={day}
                        className="p-3 rounded-xl bg-white border border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-2xs"
                      >
                        <div className="w-28 shrink-0">
                          <span className="text-xs font-bold text-gray-900 block">{day}</span>
                          <span className="text-[10px] text-magenta-700 font-semibold">
                            {duration > 0 ? `${duration} hrs duty` : "Invalid hours"}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 flex-1 max-w-sm">
                          <ModernTimeSelect
                            value={shift.startTime}
                            onChange={(val) => {
                              setForm((prev) => ({
                                ...prev,
                                dutySchedule: {
                                  ...prev.dutySchedule,
                                  [day]: { ...shift, startTime: val },
                                },
                              }));
                            }}
                          />
                          <span className="text-xs text-gray-400 font-medium">to</span>
                          <ModernTimeSelect
                            value={shift.endTime}
                            onChange={(val) => {
                              setForm((prev) => ({
                                ...prev,
                                dutySchedule: {
                                  ...prev.dutySchedule,
                                  [day]: { ...shift, endTime: val },
                                },
                              }));
                            }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
            </div>

            {/* Compact Conflict / Clean Indicator */}
            {addFormConflicts.length > 0 ? (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Notice: {addFormConflicts.length} Concurrent Doctor Shift{addFormConflicts.length > 1 ? "s" : ""}</span>
                </div>
                <div className="space-y-0.5 pl-4 text-[11px] text-amber-800">
                  {addFormConflicts.map((c, idx) => (
                    <p key={idx}>
                      ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ <strong>{c.day}:</strong> {c.doctorName} ({formatTime12h(c.dutyStart)} ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ {formatTime12h(c.dutyEnd)})
                    </p>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200 text-emerald-800 text-[11px] flex items-center gap-1.5 font-medium">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>No schedule overlaps with other active doctors.</span>
              </div>
            )}
          </div>
        </div>

        {formError && (
          <div className="mt-4 flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" /> {formError}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2.5 pt-3 border-t border-gray-100">
          <button
            type="button"
            onClick={resetForm}
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

      {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Doctor List Section (Original Clean Structure) ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
      <div className="space-y-3">
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
              Add your attending dermatologists with their duty shifts using the form above.
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
                    <p className="text-xs text-gray-500 mt-0.5">{doc.email} ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ {doc.contactNumber || "No phone"}</p>

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
                  </div>
                </div>

                {/* Card Actions */}
                <div className="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-gray-100">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      doc.status === "Active" ? "bg-emerald-500" : "bg-gray-300"
                    }`}
                    title={doc.status}
                  />
                  <button
                    type="button"
                    onClick={() => setSelectedDoctorForDetails(doc)}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-magenta-700 bg-magenta-50 hover:bg-magenta-100 border border-magenta-200/60 transition-all cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Details</span>
                  </button>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Add Doctor Confirmation Modal ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
      <AnimatePresence>
        {showAddConfirmModal && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-100 max-h-[90vh] flex flex-col text-left"
            >
              {/* Header */}
              <div className="px-6 pt-5 pb-3 flex items-start justify-between border-b border-gray-100 bg-gray-50/50 shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-magenta-100 text-[#c0166a] flex items-center justify-center shrink-0">
                    <UserPlus className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">Confirm Doctor &amp; Schedule</h3>
                    <p className="text-[11px] text-gray-500">Please review doctor information and shifts</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddConfirmModal(false)}
                  disabled={savingDoctor}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 overflow-y-auto space-y-3.5 text-xs">
                {/* Doctor Info */}
                <div className="p-3.5 rounded-xl bg-gray-50/70 border border-gray-100 flex items-center gap-3">
                  {form.photoPreview ? (
                    <img
                      src={form.photoPreview}
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
                      {form.name.trim()}
                    </h4>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      PRC: #{form.prcLicense.trim()} ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ {form.contactNumber.trim()}
                    </p>
                  </div>
                </div>

                {/* Duty Hours Box */}
                <div className="p-3 rounded-xl bg-magenta-50/50 border border-magenta-100 text-xs space-y-1.5">
                  <span className="text-[10px] font-bold text-magenta-900 uppercase tracking-wider block">
                    Weekly Consultation Duty Shift
                  </span>
                  {!form.isCustomSchedule ? (
                    <div className="flex items-center justify-between text-magenta-950 font-semibold text-xs">
                      <span>Hours: {formatTime12h(form.dutyStartTime)} ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ {formatTime12h(form.dutyEndTime)}</span>
                      <span>Days: {form.dutyDays.map((d) => d.slice(0, 3)).join(", ")}</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 pt-1">
                      {form.dutyDays.map((day) => {
                        const shift = form.dutySchedule[day] || {
                          startTime: form.dutyStartTime || "09:00",
                          endTime: form.dutyEndTime || "17:00",
                        };
                        return (
                          <div
                            key={day}
                            className="px-2 py-1 rounded-lg bg-white border border-magenta-100 text-[10px] flex items-center justify-between font-medium text-magenta-950"
                          >
                            <span className="font-bold">{day}:</span>
                            <span>{formatTime12h(shift.startTime)} ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ {formatTime12h(shift.endTime)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Email & Clinic */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-100">
                    <span className="text-[9px] font-bold text-gray-400 uppercase block">EMAIL</span>
                    <p className="font-semibold text-gray-900 mt-0.5 truncate">{form.email.trim()}</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-100">
                    <span className="text-[9px] font-bold text-gray-400 uppercase block">CLINIC</span>
                    <p className="font-semibold text-gray-900 mt-0.5 truncate">{clinicDisplayName}</p>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-3 bg-gray-50/80 border-t border-gray-100 flex items-center justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowAddConfirmModal(false)}
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

      {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Doctor Details Modal ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
      <AnimatePresence>
        {selectedDoctorForDetails && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-100 text-left flex flex-col"
            >
              {/* Header */}
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

              {/* Body */}
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
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          selectedDoctorForDetails.status === "Active"
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
                  {!selectedDoctorForDetails.dutySchedule || Object.keys(selectedDoctorForDetails.dutySchedule).length === 0 ? (
                    <>
                      <p className="font-bold text-magenta-700">
                        {formatTime12h(selectedDoctorForDetails.dutyStartTime || "09:00")} ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ {formatTime12h(selectedDoctorForDetails.dutyEndTime || "17:00")}
                      </p>
                      <p className="text-[11px] text-gray-600">
                        {selectedDoctorForDetails.dutyDays && selectedDoctorForDetails.dutyDays.length > 0
                          ? selectedDoctorForDetails.dutyDays.join(", ")
                          : "Monday - Friday"}
                      </p>
                    </>
                  ) : (
                    <div className="space-y-1 mt-1">
                      {selectedDoctorForDetails.dutyDays.map((d) => {
                        const shift = getDoctorShiftForDay(selectedDoctorForDetails, d);
                        return (
                          <div key={d} className="flex items-center justify-between text-xs py-0.5 border-b border-gray-200/50 last:border-b-0">
                            <span className="font-semibold text-gray-800">{d}</span>
                            <span className="font-bold text-magenta-700">{formatTime12h(shift.startTime)} ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ {formatTime12h(shift.endTime)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="space-y-2 text-xs">
                  <div>
                    <p className="text-[10px] font-bold tracking-wider text-gray-400 uppercase">EMAIL</p>
                    <p className="font-medium text-gray-800 mt-0.5">{selectedDoctorForDetails.email}</p>
                  </div>

                  <div>
                    <p className="text-[10px] font-bold tracking-wider text-gray-400 uppercase">CONTACT NUMBER</p>
                    <p className="font-medium text-gray-800 mt-0.5">{selectedDoctorForDetails.contactNumber || "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â"}</p>
                  </div>

                  <div>
                    <p className="text-[10px] font-bold tracking-wider text-gray-400 uppercase">PRC LICENSE #</p>
                    <p className="font-medium text-gray-800 mt-0.5">{selectedDoctorForDetails.prcLicense || "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â"}</p>
                  </div>

                  <div>
                    <p className="text-[10px] font-bold tracking-wider text-gray-400 uppercase mb-1">SPECIALIZATION</p>
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
                        <p className="text-gray-400 italic">None</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-3.5 bg-gray-50/70 border-t border-gray-100">
                <div className="flex items-center justify-between gap-2.5">
                  <button
                    type="button"
                    onClick={() => setStatusConfirmDoctor(selectedDoctorForDetails)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      selectedDoctorForDetails.status === "Active"
                        ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                        : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                    }`}
                  >
                    {selectedDoctorForDetails.status === "Active" ? "Deactivate Doctor" : "Re-activate Doctor"}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenEdit(selectedDoctorForDetails)}
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

      {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Edit Doctor Modal ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
      <AnimatePresence>
        {editingDoctor && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-100 max-h-[90vh] flex flex-col text-left"
            >
              {/* Header */}
              <div className="px-6 pt-5 pb-3 flex items-start justify-between border-b border-gray-100 shrink-0">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Edit Doctor &amp; Schedule</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{editingDoctor.clinicName}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingDoctor(null)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Form Body */}
              <div className="p-6 overflow-y-auto space-y-3.5 text-xs">
                {editError && (
                  <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-medium text-red-700 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                    <span>{editError}</span>
                  </div>
                )}

                {/* Photo Upload in Edit */}
                <div className="p-3 rounded-xl bg-gray-50 border border-gray-100 flex items-center gap-3">
                  {editForm.photoPreview ? (
                    <img
                      src={editForm.photoPreview}
                      alt="Doctor Preview"
                      className="w-14 h-14 rounded-xl object-cover border border-magenta-200 shrink-0"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-gray-400">
                      <Camera className="w-5 h-5" />
                    </div>
                  )}
                  <div>
                    <button
                      type="button"
                      onClick={() => editPhotoFileInputRef.current?.click()}
                      className="text-xs font-bold px-3 py-1 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-gray-800 shadow-2xs cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <Upload className="w-3 h-3 text-[#c0166a]" /> Change Photo
                    </button>
                    <input
                      ref={editPhotoFileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handlePhotoSelect(e, true)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Full Name *</label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs focus:outline-none focus:border-[#c0166a] bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Email *</label>
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs focus:outline-none focus:border-[#c0166a] bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Contact Number (11 digits) *</label>
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
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs focus:outline-none focus:border-[#c0166a] bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">PRC License # (Letters &amp; Numbers, max 7) *</label>
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
                    placeholder="e.g. 0123456 or PR12345"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs focus:outline-none focus:border-[#c0166a] bg-white"
                  />
                </div>

                {/* Specialization */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Specialization *</label>
                  <SpecializationMultiSelect
                    options={specializations}
                    selectedIds={editForm.selectedSpecializationIds}
                    onChange={(ids) => setEditForm((p) => ({ ...p, selectedSpecializationIds: ids }))}
                    placeholder="Select specializations..."
                    disabled={savingEdit}
                  />
                </div>

                {/* Duty Schedule Editing */}
                <div className="pt-3 border-t border-gray-100 space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-[#c0166a]" />
                        Duty Consultation Days *
                      </label>
                      <div className="flex items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setEditForm((p) => ({ ...p, dutyDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] }))}
                          className="text-magenta-700 hover:text-magenta-800 font-semibold hover:underline cursor-pointer"
                        >
                          MonÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“Fri
                        </button>
                        <span className="text-gray-300">ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢</span>
                        <button
                          type="button"
                          onClick={() => setEditForm((p) => ({ ...p, dutyDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] }))}
                          className="text-magenta-700 hover:text-magenta-800 font-semibold hover:underline cursor-pointer"
                        >
                          MonÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“Sat
                        </button>
                        <span className="text-gray-300">ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢</span>
                        <button
                          type="button"
                          onClick={() => setEditForm((p) => ({ ...p, dutyDays: [...ALL_DAYS_OF_WEEK] }))}
                          className="text-magenta-700 hover:text-magenta-800 font-semibold hover:underline cursor-pointer"
                        >
                          All Week
                        </button>
                        {editForm.dutyDays.length > 0 && (
                          <>
                            <span className="text-gray-300">•</span>
                            <button
                              type="button"
                              onClick={() => setEditForm((p) => ({ ...p, dutyDays: [] }))}
                              className="text-rose-600 hover:text-rose-700 font-semibold hover:underline cursor-pointer"
                            >
                              Clear
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Day selection grid */}
                    <div className="grid grid-cols-7 gap-1">
                      {ALL_DAYS_OF_WEEK.map((day) => {
                        const isSelected = editForm.dutyDays.includes(day);
                        return (
                          <button
                            key={day}
                            type="button"
                            onClick={() => toggleDaySelection(day, true)}
                            className={`py-2 px-1 rounded-xl text-xs font-bold text-center transition-all cursor-pointer ${
                              isSelected
                                ? "bg-[#c0166a] text-white shadow-2xs"
                                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                            }`}
                          >
                            {day.slice(0, 3)}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Consultation Shift Hours Card (Direct Time Selection, No Presets) */}
                  <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-[#c0166a]" />
                          Duty Consultation Hours
                        </label>
                        <p className="text-[11px] text-gray-500">
                          {editForm.isCustomSchedule
                            ? "Custom hours configured per duty day"
                            : "Clinic Operating Hours: 8:00 AM ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ 8:00 PM"}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (!editForm.isCustomSchedule) {
                            const nextSched = { ...editForm.dutySchedule };
                            editForm.dutyDays.forEach((d) => {
                              if (!nextSched[d]) {
                                nextSched[d] = {
                                  startTime: editForm.dutyStartTime || "08:00",
                                  endTime: editForm.dutyEndTime || "17:00",
                                };
                              }
                            });
                            setEditForm((p) => ({ ...p, isCustomSchedule: true, dutySchedule: nextSched }));
                          } else {
                            setEditForm((p) => ({ ...p, isCustomSchedule: false }));
                          }
                        }}
                        className="text-xs font-semibold text-magenta-700 hover:text-magenta-800 px-2.5 py-1 rounded-lg border border-magenta-200 bg-white hover:bg-magenta-50 transition-colors cursor-pointer"
                      >
                        {editForm.isCustomSchedule ? "ÃƒÂ¢Ã¢â‚¬Â Ã‚Â Uniform Shift (Same for all days)" : "+ Customize hours per day"}
                      </button>
                    </div>

                    {!editForm.isCustomSchedule ? (
                      /* Direct Time Pickers (Preset-Free) */
                      <div className="p-3.5 rounded-xl bg-white border border-gray-200/90 shadow-2xs space-y-2.5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <ModernTimeSelect
                            label="Shift Start Time"
                            value={editForm.dutyStartTime}
                            onChange={(val) => setEditForm((p) => ({ ...p, dutyStartTime: val }))}
                          />
                          <ModernTimeSelect
                            label="Shift End Time"
                            value={editForm.dutyEndTime}
                            onChange={(val) => setEditForm((p) => ({ ...p, dutyEndTime: val }))}
                          />
                        </div>

                        {/* Real-time Duration & Status Calculation */}
                        {(() => {
                          const duration = getShiftDurationHours(editForm.dutyStartTime, editForm.dutyEndTime);
                          const isInvalid = timeToMinutes(editForm.dutyEndTime) <= timeToMinutes(editForm.dutyStartTime);

                          if (isInvalid) {
                            return (
                              <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-1.5 font-medium">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                <span>Shift End Time must be later than Start Time.</span>
                              </div>
                            );
                          }

                          return (
                            <div className="pt-2 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-gray-900">
                                  {formatTime12h(editForm.dutyStartTime)} ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ {formatTime12h(editForm.dutyEndTime)}
                                </span>
                                <span className="text-gray-300">ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢</span>
                                <span className="font-bold text-magenta-700 bg-magenta-50 px-2 py-0.5 rounded-full border border-magenta-200 text-[11px]">
                                  {duration} Hours Active Duty
                                </span>
                              </div>
                              <span className="text-[10px] text-gray-400">
                                Active across {editForm.dutyDays.length} duty day{editForm.dutyDays.length === 1 ? "" : "s"}
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    ) : (
                      /* Custom Per-Day Shift Mode */
                      <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                        {editForm.dutyDays.map((day) => {
                          const shift = editForm.dutySchedule[day] || {
                            startTime: editForm.dutyStartTime || "08:00",
                            endTime: editForm.dutyEndTime || "17:00",
                          };
                          const duration = getShiftDurationHours(shift.startTime, shift.endTime);

                          return (
                            <div
                              key={day}
                              className="p-2.5 rounded-lg bg-white border border-gray-200 flex items-center justify-between gap-2 shadow-2xs"
                            >
                              <div className="w-24 shrink-0">
                                <span className="text-xs font-bold text-gray-900 block">{day}</span>
                                <span className="text-[10px] text-magenta-700 font-semibold">
                                  {duration > 0 ? `${duration} hrs` : "Invalid"}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 flex-1 max-w-xs">
                                <ModernTimeSelect
                                  value={shift.startTime}
                                  onChange={(val) => {
                                    setEditForm((prev) => ({
                                      ...prev,
                                      dutySchedule: {
                                        ...prev.dutySchedule,
                                        [day]: { ...shift, startTime: val },
                                      },
                                    }));
                                  }}
                                />
                                <span className="text-xs text-gray-400 font-medium">to</span>
                                <ModernTimeSelect
                                  value={shift.endTime}
                                  onChange={(val) => {
                                    setEditForm((prev) => ({
                                      ...prev,
                                      dutySchedule: {
                                        ...prev.dutySchedule,
                                        [day]: { ...shift, endTime: val },
                                      },
                                    }));
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Overlap notice */}
                  <div>
                    {editFormConflicts.length > 0 ? (
                      <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1">
                        <div className="flex items-center gap-1 font-bold text-amber-800">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span>Notice: Overlaps with {editFormConflicts.length} concurrent shift(s)</span>
                        </div>
                        <div className="space-y-0.5 pl-4 text-[11px] text-amber-800">
                          {editFormConflicts.map((c, idx) => (
                            <p key={idx}>
                              ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ <strong>{c.day}:</strong> {c.doctorName} ({formatTime12h(c.dutyStart)} ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ {formatTime12h(c.dutyEnd)})
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] flex items-center gap-1.5 font-medium">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>No conflicts with other active doctors.</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-3 bg-gray-50/70 border-t border-gray-100 flex items-center justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditingDoctor(null)}
                  disabled={savingEdit}
                  className="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-xs font-bold hover:bg-gray-50 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveDoctorEdit}
                  disabled={savingEdit}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-[#c0166a] hover:bg-[#a01258] text-white text-xs font-bold transition-colors disabled:opacity-60 shadow-xs cursor-pointer"
                >
                  {savingEdit && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Status Toggle Confirmation Modal ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
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
                className={`w-11 h-11 rounded-xl mx-auto flex items-center justify-center mb-3 ${
                  statusConfirmDoctor.status === "Active"
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
                  className={`flex-1 py-2 rounded-xl text-white text-xs font-bold shadow-xs transition-colors flex items-center justify-center gap-1 cursor-pointer ${
                    statusConfirmDoctor.status === "Active"
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

      {/* ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Delete Confirmation Modal ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ */}
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
