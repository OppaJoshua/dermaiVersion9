import React, { type FormEvent, useRef, useState, useEffect, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ShieldX,
  Upload,
  X,
  Loader2,
  Calendar,
  Clock,
  Stethoscope,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  HeartPulse,
  AlertCircle,
  Camera,
  User,
  Users,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";

export type ClinicDoctorItem = {
  id: string;
  name: string;
  specialization: string;
  photo?: string;
  dutyDays: string[];
  dutyStartTime: string;
  dutyEndTime: string;
  dutySchedule?: Record<string, { startTime: string; endTime: string }>;
  status?: string;
};

function formatTime12h(timeStr: string): string {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  const ampm = (h || 0) >= 12 ? "PM" : "AM";
  const hour = (h || 0) % 12 || 12;
  return `${hour}:${String(m || 0).padStart(2, "0")} ${ampm}`;
}

export function normalizeDayName(d: string): string {
  if (!d) return "";
  const s = String(d).trim().toLowerCase();
  if (s.startsWith("mon")) return "Monday";
  if (s.startsWith("tue")) return "Tuesday";
  if (s.startsWith("wed")) return "Wednesday";
  if (s.startsWith("thu")) return "Thursday";
  if (s.startsWith("fri")) return "Friday";
  if (s.startsWith("sat")) return "Saturday";
  if (s.startsWith("sun")) return "Sunday";
  return d;
}

export function isDoctorOnDutyOnDay(doc: ClinicDoctorItem, dayOfWeek: string): boolean {
  if (!doc) return false;
  if (doc.status === "Inactive") return false;
  const target = normalizeDayName(dayOfWeek);
  if (!doc.dutyDays || doc.dutyDays.length === 0) {
    return !["Saturday", "Sunday"].includes(target);
  }
  return doc.dutyDays.some((d) => normalizeDayName(d) === target);
}

type ClinicData = {
  id: string;
  name: string;
  logo?: string;
  address: string;
  phone: string;
  verified: boolean;
  description: string;
  hours: string;
  consultationFee: string;
  doctors: ClinicDoctorItem[];
  conditionsTreated: string[];
  photos?: string[];
};

type ConsultationType = "face-to-face";

export default function AppointmentPage({ defaultType: _defaultType }: {
  defaultType?: ConsultationType;
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  const [currentStep, setCurrentStep] = useState<1 | 2>(1);
  const [selectedClinic, setSelectedClinic] = useState<ClinicData | null>(null);
  const [loadingClinic, setLoadingClinic] = useState(true);
  const [showClinicDetailsModal, setShowClinicDetailsModal] = useState(false);
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Patient info fields
  const [patientName, setPatientName] = useState("");
  const [patientEmail, setPatientEmail] = useState(() => user?.email || "");
  const [patientAddress, setPatientAddress] = useState("");
  const [patientContact, setPatientContact] = useState("");
  const [patientGender, setPatientGender] = useState("");
  const [patientBirthdate, setPatientBirthdate] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [emergencyRelationship, setEmergencyRelationship] = useState("");
  const [notes, setNotes] = useState("");
  const [questionnaireData, setQuestionnaireData] = useState<any[]>([]);

  // Skin photo upload
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [skinPhotoFile, setSkinPhotoFile] = useState<File | null>(null);
  const [skinPhotoPreview, setSkinPhotoPreview] = useState<string>("");
  const [photoFileName, setPhotoFileName] = useState<string>("");

  // Schedule selection fields
  const [selectedDate, setSelectedDate] = useState(() => {
    const tmrw = new Date();
    tmrw.setDate(tmrw.getDate() + 1);
    return `${tmrw.getFullYear()}-${String(tmrw.getMonth() + 1).padStart(2, "0")}-${String(tmrw.getDate()).padStart(2, "0")}`;
  });
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>("");
  const [selectedDoctorFilter, setSelectedDoctorFilter] = useState<string>("all");
  const [selectedTime, setSelectedTime] = useState("10:00");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  // AI analysis result (patient-supplied)
  const [aiConditionName, setAiConditionName] = useState("");
  const [aiConfidence, setAiConfidence] = useState<string>("");
  const [submitted, setSubmitted] = useState(false);

  // Calculate patient age from birthdate
  const patientAge = useMemo(() => {
    if (!patientBirthdate) return null;
    const dob = new Date(patientBirthdate);
    if (isNaN(dob.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) {
      age--;
    }
    return age >= 0 ? age : null;
  }, [patientBirthdate]);

  // Generate calendar days for the current calendarMonth (42 cells to support full 6 weeks)
  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDayOffset = (firstDay.getDay() + 6) % 7;
    const gridStart = new Date(firstDay);
    gridStart.setDate(firstDay.getDate() - startDayOffset);

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + 60);

    const doctors = selectedClinic?.doctors || [];

    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const inCurrentMonth = d.getMonth() === month;
      const isPast = dateStr < todayStr;
      const isTooFar = d > maxDate;
      const isDisabled = isPast || isTooFar;
      const isToday = dateStr === todayStr;

      const dayOfWeek = d.toLocaleDateString("en-US", { weekday: "long" });
      const onDutyDocs = doctors.filter((doc) => isDoctorOnDutyOnDay(doc, dayOfWeek));
      const hasDoctorsOnDuty = onDutyDocs.length > 0;
      
      const isFilteredDoctorOnDuty = selectedDoctorFilter === "all"
        ? hasDoctorsOnDuty
        : onDutyDocs.some((doc) => doc.id === selectedDoctorFilter);

      return {
        dateStr,
        dayNum: d.getDate(),
        dayOfWeek,
        inCurrentMonth,
        isPast,
        isDisabled,
        isToday,
        onDutyDocs,
        hasDoctorsOnDuty,
        isFilteredDoctorOnDuty,
      };
    });
  }, [calendarMonth, selectedClinic?.doctors, selectedDoctorFilter]);

  // Determine day of week for selectedDate (e.g. "Monday", "Wednesday")
  const dayOfWeekForSelectedDate = useMemo(() => {
    if (!selectedDate) return "";
    try {
      const [y, m, d] = selectedDate.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      return dt.toLocaleDateString("en-US", { weekday: "long" });
    } catch {
      return "";
    }
  }, [selectedDate]);

  // Filter doctors who are on duty on this day of week
  const onDutyDoctorsForDate = useMemo(() => {
    if (!selectedClinic?.doctors || selectedClinic.doctors.length === 0) return [];
    if (!dayOfWeekForSelectedDate) return selectedClinic.doctors;

    const matched = selectedClinic.doctors.filter((doc) =>
      isDoctorOnDutyOnDay(doc, dayOfWeekForSelectedDate)
    );

    return matched;
  }, [selectedClinic?.doctors, dayOfWeekForSelectedDate]);

  // Active chosen doctor on duty
  const activeDutyDoctor = useMemo<ClinicDoctorItem | null>(() => {
    if (onDutyDoctorsForDate.length === 0) {
      return selectedClinic?.doctors?.[0] || null;
    }
    const found = onDutyDoctorsForDate.find((d) => d.id === selectedDoctorId);
    return found || onDutyDoctorsForDate[0];
  }, [onDutyDoctorsForDate, selectedDoctorId, selectedClinic?.doctors]);

  // Sync selectedDoctorId when onDutyDoctorsForDate updates
  useEffect(() => {
    if (onDutyDoctorsForDate.length > 0) {
      if (!onDutyDoctorsForDate.some((d) => d.id === selectedDoctorId)) {
        setSelectedDoctorId(onDutyDoctorsForDate[0].id);
      }
    }
  }, [onDutyDoctorsForDate, selectedDoctorId]);

  // Auto-jump to next available on-duty date when doctor filter is selected
  const handleSelectDoctorFilter = (docId: string) => {
    setSelectedDoctorFilter(docId);
    if (docId !== "all") {
      setSelectedDoctorId(docId);
      const targetDoc = selectedClinic?.doctors.find((d) => d.id === docId);
      if (targetDoc) {
        const [y, m, d] = selectedDate.split("-").map(Number);
        const curr = new Date(y, m - 1, d);
        const currDayName = curr.toLocaleDateString("en-US", { weekday: "long" });
        if (!isDoctorOnDutyOnDay(targetDoc, currDayName)) {
          // Find next day this doctor works starting from tomorrow
          const check = new Date();
          for (let i = 1; i <= 30; i++) {
            check.setDate(check.getDate() + 1);
            const cDayName = check.toLocaleDateString("en-US", { weekday: "long" });
            if (isDoctorOnDutyOnDay(targetDoc, cDayName)) {
              const nextDateStr = `${check.getFullYear()}-${String(check.getMonth() + 1).padStart(2, "0")}-${String(check.getDate()).padStart(2, "0")}`;
              setSelectedDate(nextDateStr);
              setCalendarMonth(new Date(check.getFullYear(), check.getMonth(), 1));
              break;
            }
          }
        }
      }
    }
  };

  // Dynamically generate time slots based on activeDutyDoctor's duty hours for the selected day of week
  const dynamicTimeSlots = useMemo(() => {
    let startStr = activeDutyDoctor?.dutyStartTime || "09:00";
    let endStr = activeDutyDoctor?.dutyEndTime || "17:00";

    if (
      activeDutyDoctor?.dutySchedule &&
      dayOfWeekForSelectedDate &&
      activeDutyDoctor.dutySchedule[dayOfWeekForSelectedDate]
    ) {
      const customShift = activeDutyDoctor.dutySchedule[dayOfWeekForSelectedDate];
      if (customShift.startTime && customShift.endTime) {
        startStr = customShift.startTime;
        endStr = customShift.endTime;
      }
    }

    const [startH, startM] = startStr.split(":").map(Number);
    const [endH, endM] = endStr.split(":").map(Number);

    const startTotal = (isNaN(startH) ? 9 : startH) * 60 + (isNaN(startM) ? 0 : startM);
    const endTotal = (isNaN(endH) ? 17 : endH) * 60 + (isNaN(endM) ? 0 : endM);

    const morning: Array<{ value: string; label: string }> = [];
    const afternoon: Array<{ value: string; label: string }> = [];

    for (let mins = startTotal; mins <= endTotal - 30; mins += 30) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const ampm = h >= 12 ? "PM" : "AM";
      const displayHour = h % 12 || 12;
      const label = `${String(displayHour).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ampm}`;

      if (h < 12) {
        morning.push({ value, label });
      } else {
        afternoon.push({ value, label });
      }
    }

    if (morning.length === 0 && afternoon.length === 0) {
      return {
        morning: [
          { value: "09:00", label: "09:00 AM" },
          { value: "09:30", label: "09:30 AM" },
          { value: "10:00", label: "10:00 AM" },
          { value: "10:30", label: "10:30 AM" },
          { value: "11:00", label: "11:00 AM" },
          { value: "11:30", label: "11:30 AM" },
        ],
        afternoon: [
          { value: "13:00", label: "01:00 PM" },
          { value: "13:30", label: "01:30 PM" },
          { value: "14:00", label: "02:00 PM" },
          { value: "14:30", label: "02:30 PM" },
          { value: "15:00", label: "03:00 PM" },
          { value: "15:30", label: "03:30 PM" },
          { value: "16:00", label: "04:00 PM" },
          { value: "16:30", label: "04:30 PM" },
          { value: "17:00", label: "05:00 PM" },
        ],
      };
    }

    return { morning, afternoon };
  }, [activeDutyDoctor, dayOfWeekForSelectedDate]);

  // Keep selectedTime synchronized to available dynamic slots
  useEffect(() => {
    const allSlots = [...dynamicTimeSlots.morning, ...dynamicTimeSlots.afternoon];
    if (allSlots.length > 0 && !allSlots.some((s) => s.value === selectedTime)) {
      setSelectedTime(allSlots[0].value);
    }
  }, [dynamicTimeSlots, selectedTime]);

  const formattedPreviewDate = useMemo(() => {
    if (!selectedDate) return "Select date";
    try {
      const [y, m, d] = selectedDate.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      return dt.toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    } catch {
      return selectedDate;
    }
  }, [selectedDate]);

  const formattedPreviewTime = useMemo(() => {
    if (!selectedTime) return "Select time";
    try {
      const [h, m] = selectedTime.split(":").map(Number);
      const ampm = h >= 12 ? "PM" : "AM";
      const hour = h % 12 || 12;
      return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
    } catch {
      return selectedTime;
    }
  }, [selectedTime]);

  // Prefill AI condition and questionnaire from URL params or local scan storage
  useEffect(() => {
    const condParam = searchParams.get("condition") || searchParams.get("ai_condition");
    const confParam = searchParams.get("confidence") || searchParams.get("score");
    if (condParam && condParam !== "Assessment Queued") setAiConditionName(condParam);
    if (confParam && Number(confParam) > 0) setAiConfidence(confParam);

    try {
      const savedScan = localStorage.getItem("dermai_last_scan");
      if (savedScan) {
        const parsed = JSON.parse(savedScan);
        if (!condParam && parsed.predictedClass && parsed.predictedClass !== "Assessment Queued") {
          setAiConditionName((prev) => prev || parsed.predictedClass);
        }
        if (!confParam && parsed.confidence && Number(parsed.confidence) > 0) {
          const num = Number(parsed.confidence);
          setAiConfidence((prev) => prev || String(Math.round(num <= 1 ? num * 100 : num)));
        }
        if (Array.isArray(parsed.questionnaire) && parsed.questionnaire.length > 0) {
          setQuestionnaireData(parsed.questionnaire);
        }
      }
    } catch { }
  }, [searchParams]);

  // Fetch approved clinic strictly from database with rich details
  useEffect(() => {
    let cancelled = false;
    async function loadClinic() {
      setLoadingClinic(true);
      const clinicIdFromUrl = searchParams.get("clinic");

      if (!clinicIdFromUrl) {
        setLoadingClinic(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("clinic")
          .select(`
            clinic_id,
            name,
            logo_url,
            district,
            address,
            phone,
            email,
            status,
            description,
            consultation_fee,
            clinic_photo ( photo_url, sort_order ),
            clinic_service_offered ( service_name ),
            clinic_operating_hours ( day_of_week, open_time, close_time )
          `)
          .eq("clinic_id", clinicIdFromUrl)
          .maybeSingle();

        // Fetch doctors with resilient query and local cache fallback
        let rawDoctorRows: any[] = [];
        try {
          const { data: docRows1, error: err1 } = await supabase
            .from("clinic_doctor")
            .select("*")
            .eq("clinic_id", clinicIdFromUrl);

          if (!err1 && Array.isArray(docRows1) && docRows1.length > 0) {
            rawDoctorRows = docRows1;
          } else if (data?.clinic_id && String(data.clinic_id) !== String(clinicIdFromUrl)) {
            const { data: docRows2 } = await supabase
              .from("clinic_doctor")
              .select("*")
              .eq("clinic_id", data.clinic_id);

            if (Array.isArray(docRows2) && docRows2.length > 0) {
              rawDoctorRows = docRows2;
            }
          }
        } catch (docErr) {
          console.warn("Direct clinic_doctor fetch error:", docErr);
        }

        // Fallback to local storage cache if database returned no doctors
        if (rawDoctorRows.length === 0) {
          try {
            const rawDocs = localStorage.getItem("dermai_clinic_doctors");
            if (rawDocs) {
              const parsedDocs = JSON.parse(rawDocs);
              if (Array.isArray(parsedDocs) && parsedDocs.length > 0) {
                const targetClinicName = (data?.name || "").toLowerCase().trim();
                const targetClinicId = String(data?.clinic_id || clinicIdFromUrl || "").toLowerCase().trim();

                const matched = parsedDocs.filter((d: any) => {
                  const statusLower = String(d.status || "active").toLowerCase();
                  if (statusLower === "inactive") return false;
                  if (!d.name && !d.doctor_name) return false;

                  const docClinicName = (d.clinicName || d.clinic_name || "").toLowerCase().trim();
                  if (targetClinicName && docClinicName && targetClinicName === docClinicName) return true;

                  const docClinicId = String(d.clinicId || d.clinic_id || "").toLowerCase().trim();
                  if (targetClinicId && docClinicId && targetClinicId === docClinicId) return true;

                  return true;
                });

                if (matched.length > 0) {
                  rawDoctorRows = matched;
                } else {
                  rawDoctorRows = parsedDocs.filter((d: any) => String(d.status || "active").toLowerCase() !== "inactive");
                }
              }
            }
          } catch {}
        }

        // Map raw doctor rows to ClinicDoctorItem objects
        let doctorsList: ClinicDoctorItem[] = rawDoctorRows
          .filter((d: any) => {
            const st = String(d.status || "active").toLowerCase();
            return st !== "inactive" && (d.doctor_name || d.name);
          })
          .map((d: any) => {
            const docName = d.doctor_name || d.name || "Attending Dermatologist";

            let pDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
            if (Array.isArray(d.dutyDays) && d.dutyDays.length > 0) pDays = d.dutyDays;
            else if (Array.isArray(d.duty_days) && d.duty_days.length > 0) pDays = d.duty_days;
            else if (typeof d.dutyDays === "string" && d.dutyDays.trim()) pDays = d.dutyDays.split(",").map((s: string) => s.trim());
            else if (typeof d.duty_days === "string" && d.duty_days.trim()) pDays = d.duty_days.split(",").map((s: string) => s.trim());

            let parsedSched: Record<string, { startTime: string; endTime: string }> | undefined = undefined;
            const rawSched = d.dutySchedule || d.duty_schedule;
            if (rawSched && typeof rawSched === "object" && !Array.isArray(rawSched)) {
              parsedSched = rawSched;
            } else if (Array.isArray(rawSched)) {
              parsedSched = {};
              rawSched.forEach((it: any) => {
                if (it?.day) {
                  parsedSched![it.day] = {
                    startTime: it.startTime || it.start_time || it.start || "09:00",
                    endTime: it.endTime || it.end_time || it.end || "17:00",
                  };
                }
              });
            }

            let specStr = "General Dermatology";
            if (d.specialization && typeof d.specialization === "string") {
              specStr = d.specialization;
            } else if (Array.isArray(d.specializations) && d.specializations.length > 0) {
              specStr = d.specializations.map((s: any) => s.name || s).filter(Boolean).join(", ");
            }

            return {
              id: String(d.doctor_id || d.id || `doc-${docName}`),
              name: docName,
              specialization: specStr,
              photo: d.photo_url || d.photo || d.photoUrl || undefined,
              dutyDays: pDays,
              dutyStartTime: d.duty_start_time || d.dutyStartTime || "09:00",
              dutyEndTime: d.duty_end_time || d.dutyEndTime || "17:00",
              dutySchedule: parsedSched,
              status: d.status || "Active",
            };
          });

        if (!cancelled && !error && data) {
          let hoursStr = "";
          if (Array.isArray(data.clinic_operating_hours) && data.clinic_operating_hours.length > 0) {
            const h = data.clinic_operating_hours[0];
            const op = h.open_time ? formatTime12h(h.open_time) : "8:00 AM";
            const cl = h.close_time ? formatTime12h(h.close_time) : "5:00 PM";
            hoursStr = `${h.day_of_week || "Monday - Saturday"}: ${op} – ${cl}`.trim();
          }

          let servicesList: string[] = [];
          if (Array.isArray(data.clinic_service_offered)) {
            servicesList = data.clinic_service_offered
              .map((s: any) => (typeof s === "string" ? s : s.service_name))
              .filter(Boolean);
          }

          let photosList: string[] = [];
          if (Array.isArray(data.clinic_photo) && data.clinic_photo.length > 0) {
            photosList = data.clinic_photo
              .map((p: any) => (typeof p === "string" ? p : p?.photo_url))
              .filter(Boolean);
          }

          let logoUrl = data.logo_url || "";
          let clinicFee = data.consultation_fee ? String(data.consultation_fee) : "500";
          let clinicAddress = data.address || data.district || "";
          let clinicPhone = data.phone || "";
          let clinicDesc = (data.description || "").trim();

          if (!logoUrl || photosList.length === 0) {
            try {
              const appsRaw = localStorage.getItem("dermai_clinic_applications");
              if (appsRaw) {
                const apps = JSON.parse(appsRaw);
                if (Array.isArray(apps)) {
                  const matched = apps.find((a: any) =>
                    String(a.id) === String(data.clinic_id) ||
                    (a.name && data.name && a.name.toLowerCase().trim() === data.name.toLowerCase().trim())
                  );
                  if (matched?.logo && !logoUrl) logoUrl = matched.logo;
                  if (photosList.length === 0 && Array.isArray(matched?.clinicPhotos)) {
                    photosList = matched.clinicPhotos.filter(Boolean);
                  }
                  if (matched?.hours && !hoursStr) hoursStr = matched.hours;
                }
              }
            } catch {}
          }

          // Overlay real-time clinic settings
          try {
            const settRaw = localStorage.getItem("dermai_clinic_settings");
            if (settRaw) {
              const sett = JSON.parse(settRaw);
              const isMatch = (sett.id && String(sett.id) === String(data.clinic_id)) ||
                (sett.name && data.name && sett.name.toLowerCase().trim() === data.name.toLowerCase().trim()) ||
                (sett.email && data.email && sett.email.toLowerCase().trim() === data.email.toLowerCase().trim());
              if (isMatch) {
                if (sett.operatingDays || sett.openTime || sett.closeTime) {
                  const oDays = sett.operatingDays || "Monday - Saturday";
                  const oOpen = sett.openTime ? formatTime12h(sett.openTime) : "8:00 AM";
                  const oClose = sett.closeTime ? formatTime12h(sett.closeTime) : "5:00 PM";
                  hoursStr = `${oDays}: ${oOpen} – ${oClose}`;
                }
                if (sett.consultationFee) clinicFee = String(sett.consultationFee);
                if (sett.address) clinicAddress = sett.address;
                if (sett.phone) clinicPhone = sett.phone;
                if (sett.description) clinicDesc = sett.description;
                if (sett.logo) logoUrl = sett.logo;
              }
            }
          } catch {}

          setSelectedClinic({
            id: String(data.clinic_id),
            name: data.name || "Clinic",
            logo: logoUrl,
            address: clinicAddress,
            phone: clinicPhone,
            verified: true,
            description: clinicDesc,
            hours: hoursStr,
            consultationFee: clinicFee,
            doctors: doctorsList,
            conditionsTreated: servicesList,
            photos: photosList,
          });
        } else if (!cancelled) {
          // Fallback query if nested relations were not available
          const { data: simpleData } = await supabase
            .from("clinic")
            .select("clinic_id, name, logo_url, district, address, phone, status, description, consultation_fee")
            .eq("clinic_id", clinicIdFromUrl)
            .maybeSingle();

          if (simpleData) {
            let logoUrl = simpleData.logo_url || "";
            let photosList: string[] = [];
            let hoursStr = "";
            let clinicFee = simpleData.consultation_fee ? String(simpleData.consultation_fee) : "500";
            let clinicAddress = simpleData.address || simpleData.district || "";
            let clinicPhone = simpleData.phone || "";
            let clinicDesc = (simpleData.description || "").trim();

            try {
              const { data: pRows } = await supabase
                .from("clinic_photo")
                .select("photo_url")
                .eq("clinic_id", clinicIdFromUrl)
                .order("sort_order");
              if (pRows && pRows.length > 0) {
                photosList = pRows.map((p: any) => p.photo_url).filter(Boolean);
              }
            } catch {}

            try {
              const settRaw = localStorage.getItem("dermai_clinic_settings");
              if (settRaw) {
                const sett = JSON.parse(settRaw);
                if (sett.operatingDays || sett.openTime || sett.closeTime) {
                  const oDays = sett.operatingDays || "Monday - Saturday";
                  const oOpen = sett.openTime ? formatTime12h(sett.openTime) : "8:00 AM";
                  const oClose = sett.closeTime ? formatTime12h(sett.closeTime) : "5:00 PM";
                  hoursStr = `${oDays}: ${oOpen} – ${oClose}`;
                }
                if (sett.consultationFee) clinicFee = String(sett.consultationFee);
                if (sett.address) clinicAddress = sett.address;
                if (sett.phone) clinicPhone = sett.phone;
                if (sett.description) clinicDesc = sett.description;
                if (sett.logo) logoUrl = sett.logo;
              }
            } catch {}

            setSelectedClinic({
              id: String(simpleData.clinic_id),
              name: simpleData.name || "Clinic",
              logo: logoUrl,
              address: clinicAddress,
              phone: clinicPhone,
              verified: true,
              description: clinicDesc,
              hours: hoursStr,
              consultationFee: clinicFee,
              doctors: doctorsList,
              conditionsTreated: [],
              photos: photosList,
            });
          }
        }
      } catch (err) {
        console.error("Error loading clinic for booking:", err);
      } finally {
        if (!cancelled) setLoadingClinic(false);
      }
    }

    loadClinic();

    const handleSync = () => loadClinic();
    window.addEventListener("storage", handleSync);
    window.addEventListener("clinicSettingsUpdated", handleSync);
    window.addEventListener("dermai_clinic_updated", handleSync);
    window.addEventListener("dermai_doctors_updated", handleSync);

    return () => {
      cancelled = true;
      window.removeEventListener("storage", handleSync);
      window.removeEventListener("clinicSettingsUpdated", handleSync);
      window.removeEventListener("dermai_clinic_updated", handleSync);
      window.removeEventListener("dermai_doctors_updated", handleSync);
    };
  }, [searchParams]);

  // Auto-fill patient information from authenticated session and profile
  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    const userEmail = user.email;
    let cancelled = false;

    async function loadUserProfile() {
      if (userEmail) {
        setPatientEmail((prev) => prev || userEmail || "");
      }
      try {
        const { data: prof } = await supabase
          .from("user")
          .select("full_name, phone, address, district, gender, birthdate")
          .eq("user_id", userId)
          .maybeSingle();

        if (cancelled) return;
        if (prof) {
          if (prof.full_name) setPatientName((prev) => prev || prof.full_name);
          if (prof.phone) setPatientContact((prev) => prev || prof.phone);
          if (prof.address || prof.district) setPatientAddress((prev) => prev || prof.address || prof.district);
          if (prof.gender) setPatientGender((prev) => prev || prof.gender);
          if (prof.birthdate) setPatientBirthdate((prev) => prev || prof.birthdate);
        }

        const localProfile = localStorage.getItem(`derm_profile_${userId}`);
        if (localProfile) {
          const parsed = JSON.parse(localProfile);
          if (parsed.fullName) setPatientName((prev) => prev || parsed.fullName);
          if (parsed.contactNumber) setPatientContact((prev) => prev || parsed.contactNumber);
          if (parsed.address || parsed.district) setPatientAddress((prev) => prev || parsed.address || parsed.district);
          if (parsed.gender) setPatientGender((prev) => prev || parsed.gender);
          if (parsed.birthdate) setPatientBirthdate((prev) => prev || parsed.birthdate);
          if (parsed.emergencyContactName) setEmergencyContactName((prev) => prev || parsed.emergencyContactName);
          if (parsed.emergencyContactPhone || parsed.emergencyPhone) setEmergencyContactPhone((prev) => prev || parsed.emergencyContactPhone || parsed.emergencyPhone);
          if (parsed.emergencyRelationship) setEmergencyRelationship((prev) => prev || parsed.emergencyRelationship);
        }

        const meta = user?.user_metadata || {};
        if (meta.full_name) setPatientName((prev) => prev || meta.full_name);
        if (meta.phone) setPatientContact((prev) => prev || meta.phone);
        if (meta.address) setPatientAddress((prev) => prev || meta.address);
        if (meta.emergency_contact_name) setEmergencyContactName((prev) => prev || meta.emergency_contact_name);
        if (meta.emergency_contact_phone) setEmergencyContactPhone((prev) => prev || meta.emergency_contact_phone);
        if (meta.emergency_relationship) setEmergencyRelationship((prev) => prev || meta.emergency_relationship);
      } catch {}
    }

    loadUserProfile();
    return () => { cancelled = true; };
  }, [user]);

  // Skin photo upload handler
  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 1024 * 1024 * 10) {
      setSubmitError("Photo size must be less than 10MB.");
      return;
    }

    setSkinPhotoFile(file);
    setPhotoFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setSkinPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  // Step Validation logic
  const validateStep = (stepNumber: number): boolean => {
    setSubmitError(null);
    if (stepNumber === 1) {
      if (!patientName.trim()) {
        setSubmitError("Please enter your full name.");
        return false;
      }
      if (!patientEmail.trim()) {
        setSubmitError("Please enter your email address.");
        return false;
      }
      if (!patientContact.trim()) {
        setSubmitError("Please enter your contact phone number.");
        return false;
      }
      if (patientContact.trim().length !== 11) {
        setSubmitError("Patient phone number must be exactly 11 digits (e.g. 09171234567).");
        return false;
      }
      if (!patientAddress.trim()) {
        setSubmitError("Please enter your city / address.");
        return false;
      }
      if (!patientGender) {
        setSubmitError("Please select your gender.");
        return false;
      }
      if (!patientBirthdate) {
        setSubmitError("Please provide your date of birth.");
        return false;
      }
      if (!emergencyContactName.trim()) {
        setSubmitError("Please enter your emergency contact's full name.");
        return false;
      }
      if (!emergencyContactPhone.trim()) {
        setSubmitError("Please enter your emergency contact's phone number.");
        return false;
      }
      if (emergencyContactPhone.trim().length !== 11) {
        setSubmitError("Emergency contact phone number must be exactly 11 digits (e.g. 09171234567).");
        return false;
      }
      if (!emergencyRelationship.trim()) {
        setSubmitError("Please select your relationship with the emergency contact.");
        return false;
      }
      if (!skinPhotoFile && !skinPhotoPreview) {
        setSubmitError("Please upload a clear photo of your skin concern for the doctor's review.");
        return false;
      }
      return true;
    }

    if (stepNumber === 2) {
      if (!selectedDate) {
        setSubmitError("Please select an appointment date on the calendar.");
        return false;
      }
      if (!selectedTime) {
        setSubmitError("Please choose a consultation time slot.");
        return false;
      }
      return true;
    }

    return true;
  };

  const handleNextStep = () => {
    if (validateStep(1)) {
      setCurrentStep(2);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handlePrevStep = () => {
    setSubmitError(null);
    setCurrentStep(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Appointment Submission to Supabase & local cache
  const handleSubmitAppointment = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    setSubmitError(null);

    if (!validateStep(1) || !validateStep(2) || !selectedClinic) {
      return;
    }

    let activeUserId = user?.id;
    if (!activeUserId) {
      try {
        const { data: sess } = await supabase.auth.getSession();
        activeUserId = sess.session?.user?.id;
      } catch { }
    }

    if (!activeUserId) {
      setSubmitError("You must be logged in to book an appointment. Redirecting to login...");
      setTimeout(() => {
        navigate("/login", { state: { from: window.location.pathname + window.location.search } });
      }, 1200);
      return;
    }

    setSubmitting(true);
    try {
      // 1. Upload skin photo to Supabase Storage with graceful fallback
      let photoPath: string | null = null;
      if (skinPhotoFile) {
        try {
          const cleanFileName = skinPhotoFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const filePath = `${activeUserId}/${Date.now()}_${cleanFileName}`;

          const { data: uploadData, error: uploadError } = await supabase.storage
            .from("scan-uploads")
            .upload(filePath, skinPhotoFile, { upsert: true });

          if (!uploadError && uploadData) {
            photoPath = filePath;
          } else {
            console.warn("Storage upload failed, using preview fallback:", uploadError?.message);
            photoPath = skinPhotoPreview || null;
          }
        } catch (upEx) {
          console.warn("Storage upload exception:", upEx);
          photoPath = skinPhotoPreview || null;
        }
      } else if (skinPhotoPreview) {
        photoPath = skinPhotoPreview;
      }

      // 2. Prepare appointment payload
      let targetClinicId: any = selectedClinic.id;
      if (/^\d+$/.test(String(selectedClinic.id))) {
        targetClinicId = Number(selectedClinic.id);
      }

      const confNum = aiConfidence !== "" && !isNaN(Number(aiConfidence)) ? Number(aiConfidence) : null;
      const conditionLabel = aiConditionName.trim() || "General Dermatology Consultation";
      const scheduledDateTimeIso = `${selectedDate}T${selectedTime}:00`;

      const assignedDocId = activeDutyDoctor?.id && !activeDutyDoctor.id.startsWith("doc-")
        ? activeDutyDoctor.id
        : undefined;

      const apptPayload: Record<string, any> = {
        user_id: activeUserId,
        clinic_id: targetClinicId,
        date: scheduledDateTimeIso,
        status: "pending",
        patient_name: patientName.trim() || user?.user_metadata?.full_name || "Patient",
        patient_email: patientEmail.trim() || user?.email || null,
        patient_contact: patientContact.trim() || null,
        patient_address: patientAddress.trim() || null,
        patient_gender: patientGender || null,
        patient_birthdate: patientBirthdate || null,
        emergency_contact_name: emergencyContactName.trim() || null,
        emergency_contact_phone: emergencyContactPhone.trim() || null,
        emergency_contact_relationship: emergencyRelationship.trim() || null,
        questionnaire_answers: questionnaireData.length > 0 ? questionnaireData : null,
        notes: notes.trim() || null,
        skin_photo_url: photoPath,
        ai_condition_name: conditionLabel,
        ai_confidence: confNum,
        assigned_doctor_id: assignedDocId || null,
      };

      // 3. Insert appointment request
      let { error: insertError } = await supabase.from("patient_appointment").insert(apptPayload);

      if (insertError) {
        console.warn("Retrying appointment insert without assigned_doctor_id...", insertError.message);
        delete apptPayload.assigned_doctor_id;
        const retry1 = await supabase.from("patient_appointment").insert(apptPayload);
        insertError = retry1.error;
      }

      if (insertError) {
        console.warn("Retrying appointment insert with core fields...", insertError.message);
        const corePayload: Record<string, any> = {
          user_id: activeUserId,
          clinic_id: targetClinicId,
          status: "pending",
          date: scheduledDateTimeIso,
          patient_name: patientName.trim() || "Patient",
          skin_photo_url: photoPath,
          notes: notes.trim() || null,
        };
        const retry2 = await supabase.from("patient_appointment").insert(corePayload);
        insertError = retry2.error;
      }

      if (insertError) {
        console.error("All appointment insert attempts failed:", insertError.message);
        setSubmitError(`Failed to submit appointment: ${insertError.message}`);
        setSubmitting(false);
        return;
      }

      // 4. Save to local cache & notify listeners
      try {
        const newLocalAppt = {
          id: `appt-${Date.now()}`,
          clinicId: targetClinicId,
          clinicName: selectedClinic.name || "Skin Clinic",
          patientName: patientName.trim() || user?.user_metadata?.full_name || "Patient",
          patientEmail: patientEmail.trim() || user?.email || "",
          patientContact: patientContact.trim() || "",
          patientAddress: patientAddress.trim() || "",
          patientGender: patientGender || "",
          patientBirthdate: patientBirthdate || "",
          emergencyContactName: emergencyContactName.trim() || "",
          emergencyContactPhone: emergencyContactPhone.trim() || "",
          emergencyRelationship: emergencyRelationship.trim() || "",
          date: selectedDate,
          time: selectedTime,
          status: "pending",
          notes: notes.trim() || "",
          skinPhotoUrl: photoPath,
          aiConditionName: conditionLabel,
          aiConfidence: confNum,
          assignedDoctorName: activeDutyDoctor?.name || undefined,
          assignedDoctorPhoto: activeDutyDoctor?.photo || undefined,
          assignedDoctorSpecialization: activeDutyDoctor?.specialization || undefined,
          createdAt: new Date().toISOString(),
        };
        const existing = localStorage.getItem("dermai_clinic_appointments");
        const list = existing ? JSON.parse(existing) : [];
        if (Array.isArray(list)) {
          list.unshift(newLocalAppt);
          localStorage.setItem("dermai_clinic_appointments", JSON.stringify(list));
        }
        window.dispatchEvent(new CustomEvent("dermai_appointments_updated"));
        window.dispatchEvent(new Event("appointmentCreated"));
      } catch { }

      setSubmitted(true);
    } catch (err: any) {
      console.error("Submission error:", err);
      setSubmitError(err?.message || "An unexpected error occurred during submission.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingClinic) {
    return (
      <div className="min-h-screen bg-slate-50/50 flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-7 h-7 animate-spin text-magenta-500" />
          <p className="text-xs font-semibold text-gray-500">Loading clinic &amp; doctor schedule...</p>
        </div>
      </div>
    );
  }

  if (!selectedClinic) {
    return (
      <div className="min-h-screen bg-slate-50/50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-3xl p-6 sm:p-8 border border-gray-200 text-center shadow-sm space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-500 mx-auto flex items-center justify-center">
            <ShieldX className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-gray-900">Clinic Not Found</h2>
          <p className="text-xs text-gray-500">
            The requested clinic could not be loaded or is not currently active.
          </p>
          <Link
            to={user ? "/dashboard/clinics" : "/find-clinics"}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-magenta-600 text-white text-xs font-semibold hover:bg-magenta-700 transition-colors shadow-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Browse Partner Clinics
          </Link>
        </div>
      </div>
    );
  }

  // ════════════════ SUCCESS SUBMISSION SCREEN ════════════════
  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50/60 py-10 px-4 sm:px-6 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-lg w-full bg-white rounded-3xl p-6 sm:p-8 border border-gray-200 shadow-lg text-center space-y-5"
        >
          <div className="w-16 h-16 rounded-3xl bg-emerald-50 border border-emerald-100 text-emerald-600 mx-auto flex items-center justify-center shadow-xs">
            <CheckCircle2 className="w-8 h-8" />
          </div>

          <div className="space-y-1.5">
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Appointment Request Sent!</h1>
            <p className="text-xs text-gray-500">
              Your consultation request has been submitted to <strong>{selectedClinic.name}</strong>.
            </p>
          </div>

          <div className="bg-slate-50 p-4 rounded-2xl border border-gray-100 text-left space-y-2.5 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-gray-200/60">
              <span className="text-gray-400 font-medium">Requested Schedule</span>
              <span className="font-bold text-magenta-700">{formattedPreviewDate} at {formattedPreviewTime}</span>
            </div>
            <div className="flex items-center justify-between pb-2 border-b border-gray-200/60">
              <span className="text-gray-400 font-medium">Attending Dermatologist</span>
              <span className="font-bold text-gray-900">
                {activeDutyDoctor?.name || "Assigned by Clinic upon Review"}
              </span>
            </div>
            <div className="flex items-center justify-between pb-2 border-b border-gray-200/60">
              <span className="text-gray-400 font-medium">Patient Name</span>
              <span className="font-bold text-gray-900">{patientName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400 font-medium">Status</span>
              <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-bold border border-amber-200 text-[10px]">
                Under Doctor Review
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="flex-1 py-3 bg-magenta-600 hover:bg-magenta-700 text-white rounded-full font-semibold text-xs transition-all shadow-sm cursor-pointer"
            >
              Go to Patient Dashboard
            </button>
            <Link
              to={user ? "/dashboard/clinics" : "/find-clinics"}
              className="px-4 py-3 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-full font-semibold text-xs transition-all text-center"
            >
              Explore Other Clinics
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  const handleBackToClinics = (e: React.MouseEvent) => {
    e.preventDefault();
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(user ? "/dashboard/clinics" : "/find-clinics");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Back navigation */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleBackToClinics}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-magenta-600 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Clinics
          </button>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400">
            <span className={currentStep === 1 ? "text-magenta-600 font-bold" : "text-gray-400"}>1. Patient Details</span>
            <span>→</span>
            <span className={currentStep === 2 ? "text-magenta-600 font-bold" : "text-gray-400"}>2. Schedule &amp; Doctor</span>
          </div>
        </div>

        {/* Global Error Banner */}
        {submitError && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-center gap-2.5"
          >
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
            <span className="flex-1">{submitError}</span>
            <button
              type="button"
              onClick={() => setSubmitError(null)}
              className="text-rose-400 hover:text-rose-600 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}

        {/* Unified Card Booking Container */}
        <AnimatePresence mode="wait">
          {/* ════════════════ STEP 1: PATIENT & SKIN DETAILS ════════════════ */}
          {currentStep === 1 && (
            <motion.div
              key="step-1"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.18 }}
              className="bg-white p-5 sm:p-7 rounded-3xl border border-gray-200/80 shadow-sm space-y-5"
            >
              {/* Card Header with Clinic info */}
              <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-4">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h2 className="text-lg sm:text-xl font-bold text-gray-900 tracking-tight">{selectedClinic.name}</h2>
                    {selectedClinic.verified && <VerifiedBadge size={16} className="w-4 h-4" />}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Step 1 of 2: Patient Profile &amp; Skin Concern Photo
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowClinicDetailsModal(true)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-50 border border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer shrink-0"
                >
                  Clinic Details
                </button>
              </div>

              {/* Form Content */}
              <div className="space-y-4 text-left">
                {/* 1. Patient Profile Info */}
                <div className="space-y-2.5">
                  <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-magenta-600" /> Patient Information
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        Full Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Juan Dela Cruz"
                        value={patientName}
                        onChange={(e) => setPatientName(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white text-gray-900 focus:outline-none focus:border-magenta-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        Email Address <span className="text-[10px] text-gray-400 font-normal">(Linked to account)</span>
                      </label>
                      <input
                        type="email"
                        disabled
                        readOnly
                        value={patientEmail}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-gray-50 text-gray-500 cursor-not-allowed select-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        Contact Number (11 digits) <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="tel"
                        required
                        maxLength={11}
                        placeholder="09171234567"
                        value={patientContact}
                        onChange={(e) => setPatientContact(e.target.value.replace(/\D/g, "").slice(0, 11))}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white text-gray-900 focus:outline-none focus:border-magenta-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        City / Complete Address <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Cebu City, Cebu"
                        value={patientAddress}
                        onChange={(e) => setPatientAddress(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white text-gray-900 focus:outline-none focus:border-magenta-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        Gender <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={patientGender}
                        onChange={(e) => setPatientGender(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white text-gray-900 focus:outline-none focus:border-magenta-500"
                      >
                        <option value="">Select gender</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Non-binary">Non-binary</option>
                        <option value="Prefer not to say">Prefer not to say</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        Date of Birth <span className="text-red-500">*</span>
                        {patientAge !== null && (
                          <span className="text-magenta-600 font-bold ml-1.5">({patientAge} yrs old)</span>
                        )}
                      </label>
                      <input
                        type="date"
                        required
                        value={patientBirthdate}
                        max={new Date().toISOString().split("T")[0]}
                        onChange={(e) => setPatientBirthdate(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white text-gray-900 focus:outline-none focus:border-magenta-500"
                      />
                    </div>
                  </div>
                </div>

                {/* 2. Emergency Contact Sub-Card */}
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-gray-100 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                      <HeartPulse className="w-3.5 h-3.5 text-rose-500" /> Emergency Contact
                    </h3>
                    <span className="text-[10px] text-gray-400 font-medium">Required for clinical records</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        Contact Person <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Maria Dela Cruz"
                        value={emergencyContactName}
                        onChange={(e) => setEmergencyContactName(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white text-gray-900 focus:outline-none focus:border-magenta-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        Emergency Phone (11 digits) <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="tel"
                        required
                        maxLength={11}
                        placeholder="09171234567"
                        value={emergencyContactPhone}
                        onChange={(e) => setEmergencyContactPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white text-gray-900 focus:outline-none focus:border-magenta-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        Relationship <span className="text-red-500">*</span>
                      </label>
                      <select
                        required
                        value={emergencyRelationship}
                        onChange={(e) => setEmergencyRelationship(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white text-gray-900 focus:outline-none focus:border-magenta-500"
                      >
                        <option value="">Select relationship</option>
                        <option value="Parent">Parent</option>
                        <option value="Spouse">Spouse</option>
                        <option value="Sibling">Sibling</option>
                        <option value="Child">Child</option>
                        <option value="Guardian">Guardian</option>
                        <option value="Friend">Friend</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* 3. Skin Photo Upload */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                      <Camera className="w-3.5 h-3.5 text-magenta-600" /> Skin Concern Photo <span className="text-red-500">*</span>
                    </label>
                    {skinPhotoPreview && (
                      <button
                        type="button"
                        onClick={() => photoInputRef.current?.click()}
                        className="text-[11px] text-magenta-600 font-semibold hover:underline cursor-pointer"
                      >
                        Change Photo
                      </button>
                    )}
                  </div>

                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handlePhotoChange}
                  />

                  {skinPhotoPreview ? (
                    <div className="relative rounded-2xl overflow-hidden border border-gray-200 bg-gray-50 flex items-center justify-center max-h-48 group">
                      <img src={skinPhotoPreview} alt="Skin concern" className="w-full h-44 object-cover" />
                      <button
                        type="button"
                        onClick={() => {
                          setSkinPhotoPreview("");
                          setSkinPhotoFile(null);
                          setPhotoFileName("");
                          if (photoInputRef.current) photoInputRef.current.value = "";
                        }}
                        className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition-colors cursor-pointer"
                        title="Remove image"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <div className="absolute bottom-2 left-2 right-2 px-3 py-1.5 rounded-xl bg-black/60 backdrop-blur-xs text-white text-[11px] truncate">
                        {photoFileName || "Uploaded photo ready"}
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => photoInputRef.current?.click()}
                      className="w-full flex flex-col items-center justify-center gap-1.5 py-6 rounded-2xl border-2 border-dashed border-gray-200 hover:border-magenta-400 bg-slate-50/50 hover:bg-magenta-50/20 transition-all text-center group cursor-pointer"
                    >
                      <div className="w-10 h-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-gray-400 group-hover:text-magenta-600 group-hover:border-magenta-200 transition-colors shadow-2xs">
                        <Upload className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-gray-800 group-hover:text-magenta-700">Click to Upload Skin Photo</span>
                        <p className="text-[10px] text-gray-400 mt-0.5">JPG or PNG (Clear image of affected skin)</p>
                      </div>
                    </button>
                  )}
                </div>

                {/* 4. Optional AI Scan Details & Notes */}
                <div className="space-y-2.5 pt-1">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        Noted Skin Condition <span className="text-gray-400 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        value={aiConditionName}
                        onChange={(e) => setAiConditionName(e.target.value)}
                        placeholder="e.g. Atopic Dermatitis or Acne"
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white text-gray-900 focus:outline-none focus:border-magenta-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        AI Confidence Score (%) <span className="text-gray-400 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={aiConfidence}
                        onChange={(e) => setAiConfidence(e.target.value)}
                        placeholder="e.g. 92"
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white text-gray-900 focus:outline-none focus:border-magenta-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                      Symptoms &amp; Medical Notes <span className="text-gray-400 font-normal">(Optional)</span>
                    </label>
                    <textarea
                      placeholder="Describe itchiness, duration, triggers, or any notes for the doctor..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white text-gray-900 focus:outline-none focus:border-magenta-500 resize-none"
                    />
                  </div>
                </div>
              </div>

              {/* Step 1 Action Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleNextStep}
                  className="w-full py-3 bg-magenta-600 hover:bg-magenta-700 text-white rounded-full font-semibold text-sm shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
                >
                  <span>Continue to Step 2: Choose Schedule &amp; Doctor</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* ════════════════ STEP 2: CHOOSE SCHEDULE & DOCTOR ════════════════ */}
          {currentStep === 2 && (
            <motion.div
              key="step-2"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.18 }}
              className="bg-white p-5 sm:p-7 rounded-3xl border border-gray-200/80 shadow-sm space-y-5"
            >
              <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-4">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h2 className="text-lg sm:text-xl font-bold text-gray-900 tracking-tight">{selectedClinic.name}</h2>
                    {selectedClinic.verified && <VerifiedBadge size={16} className="w-4 h-4" />}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Step 2 of 2: Choose Consultation Date, Doctor &amp; Time
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowClinicDetailsModal(true)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-50 border border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer shrink-0"
                >
                  Clinic Details
                </button>
              </div>

              <div className="space-y-4 text-left">
                {/* 1. Quick Doctor Roster Filter Bar */}
                {selectedClinic.doctors && selectedClinic.doctors.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                        <Stethoscope className="w-3.5 h-3.5 text-magenta-600" />
                        Attending Dermatologists ({selectedClinic.doctors.length})
                      </label>
                      <span className="text-[10px] text-gray-400 font-medium">
                        Click a doctor to see their duty days on the calendar
                      </span>
                    </div>

                    <div className="flex items-center gap-2 overflow-x-auto pb-1.5 no-scrollbar">
                      <button
                        type="button"
                        onClick={() => handleSelectDoctorFilter("all")}
                        className={`px-3 py-2 rounded-xl text-xs font-semibold shrink-0 transition-all cursor-pointer flex items-center gap-2 border ${
                          selectedDoctorFilter === "all"
                            ? "bg-magenta-600 text-white border-magenta-600 shadow-xs"
                            : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        <Users className="w-3.5 h-3.5" />
                        <span>All Clinic Doctors</span>
                        <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                          selectedDoctorFilter === "all" ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"
                        }`}>
                          {selectedClinic.doctors.length}
                        </span>
                      </button>

                      {selectedClinic.doctors.map((doc) => {
                        const isSelected = selectedDoctorFilter === doc.id;
                        const dutyDaysSummary = Array.isArray(doc.dutyDays) && doc.dutyDays.length > 0
                          ? doc.dutyDays.map((d) => d.slice(0, 3)).join(", ")
                          : "Mon - Fri";

                        return (
                          <button
                            key={doc.id}
                            type="button"
                            onClick={() => handleSelectDoctorFilter(doc.id)}
                            className={`px-3 py-2 rounded-xl text-xs font-semibold shrink-0 transition-all cursor-pointer flex items-center gap-2.5 border ${
                              isSelected
                                ? "bg-magenta-50 border-magenta-400 text-magenta-900 ring-2 ring-magenta-500/20 shadow-xs"
                                : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                            }`}
                          >
                            {doc.photo ? (
                              <img
                                src={doc.photo}
                                alt={doc.name}
                                className="w-5 h-5 rounded-full object-cover border border-magenta-200 shrink-0"
                              />
                            ) : (
                              <div className="w-5 h-5 rounded-full bg-magenta-100 text-magenta-700 font-bold flex items-center justify-center text-[10px] shrink-0">
                                {doc.name.replace("Dr.", "").trim().charAt(0) || "D"}
                              </div>
                            )}
                            <div className="text-left">
                              <p className="text-xs font-bold leading-none">{doc.name}</p>
                              <p className="text-[10px] text-magenta-600 font-medium mt-0.5 leading-none">
                                {dutyDaysSummary}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 2. Interactive Roster Calendar Grid */}
                <div className="bg-slate-50/70 rounded-2xl border border-gray-200 p-3.5 sm:p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs sm:text-sm font-bold text-gray-900 flex items-center gap-1.5">
                        <Calendar className="w-4 h-4 text-magenta-600" />
                        {calendarMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                      </h4>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        Selected: <strong className="text-magenta-700 font-bold">{formattedPreviewDate} ({dayOfWeekForSelectedDate})</strong>
                        {selectedDoctorFilter !== "all" && (
                          <span className="text-gray-400 ml-1">
                            • Showing roster for <strong className="text-gray-700">{selectedClinic.doctors.find((d) => d.id === selectedDoctorFilter)?.name}</strong>
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const prev = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
                          const now = new Date();
                          if (prev.getFullYear() > now.getFullYear() || (prev.getFullYear() === now.getFullYear() && prev.getMonth() >= now.getMonth())) {
                            setCalendarMonth(prev);
                          }
                        }}
                        className="p-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-100 text-gray-600 transition-colors cursor-pointer"
                        title="Previous month"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const next = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
                          setCalendarMonth(next);
                        }}
                        className="p-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-100 text-gray-600 transition-colors cursor-pointer"
                        title="Next month"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-7 text-center mb-1">
                    {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
                      <span key={d} className="text-[10px] font-bold text-gray-400 py-0.5">{d}</span>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-1">
                    {calendarDays.map((cell, idx) => {
                      const isSelected = selectedDate === cell.dateStr;
                      const isToday = cell.isToday;
                      const isDisabled = cell.isDisabled || !cell.inCurrentMonth;
                      const isOnDuty = cell.isFilteredDoctorOnDuty && !cell.isPast && cell.inCurrentMonth;

                      return (
                        <button
                          key={idx}
                          type="button"
                          disabled={isDisabled}
                          onClick={() => {
                            if (!isDisabled) setSelectedDate(cell.dateStr);
                          }}
                          title={
                            cell.inCurrentMonth && !cell.isPast
                              ? `${cell.dayOfWeek}, ${cell.dateStr}: ${
                                  cell.onDutyDocs.length > 0
                                    ? `${cell.onDutyDocs.length} doctor(s) on duty (${cell.onDutyDocs.map((d) => d.name).join(", ")})`
                                    : "No doctors rostered (General clinic queue)"
                                }`
                              : undefined
                          }
                          className={`h-11 w-full rounded-xl text-xs font-semibold flex flex-col items-center justify-center transition-all cursor-pointer relative ${
                            isSelected
                              ? "bg-magenta-600 text-white shadow-sm font-bold scale-102 ring-2 ring-magenta-400/40"
                              : isDisabled
                              ? "text-gray-300 cursor-not-allowed bg-transparent"
                              : isToday
                              ? "bg-pink-100/90 text-magenta-800 font-bold border border-magenta-200 hover:bg-pink-200"
                              : isOnDuty
                              ? "text-gray-800 bg-white hover:bg-magenta-50/50 border border-gray-200/90 hover:border-magenta-300"
                              : "text-gray-400 bg-slate-100/40 border border-dashed border-gray-200 hover:bg-gray-100"
                          }`}
                        >
                          <span className="leading-none">{cell.dayNum}</span>
                          
                          {/* On-Duty Indicator Dot / Badge */}
                          {cell.inCurrentMonth && !cell.isPast && (
                            <div className="mt-1 flex items-center justify-center">
                              {isSelected ? (
                                <span className="w-1.5 h-1.5 rounded-full bg-white block" />
                              ) : isOnDuty ? (
                                <span
                                  className="w-1.5 h-1.5 rounded-full bg-emerald-500 block shadow-xs"
                                  title="Doctor available on duty"
                                />
                              ) : (
                                <span className="text-[9px] text-gray-300 font-bold leading-none block">–</span>
                              )}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Calendar Legend */}
                  <div className="flex items-center justify-between pt-1 border-t border-gray-200/60 text-[10px] text-gray-500">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> On-Duty Doctors Available
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" /> Off-Duty / Queue Only
                      </span>
                    </div>
                    <span className="flex items-center gap-1 font-medium text-magenta-700">
                      <span className="w-2 h-2 rounded-full bg-magenta-600 inline-block" /> Selected Date
                    </span>
                  </div>
                </div>

                {/* 3. On-Duty Doctors Selection on Chosen Date */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                      <Stethoscope className="w-3.5 h-3.5 text-magenta-600" />
                      Doctors on Duty ({dayOfWeekForSelectedDate})
                    </label>
                    <span className="text-[11px] text-gray-400 font-medium">
                      Fee: ₱{Number(selectedClinic.consultationFee || 500).toLocaleString()}
                    </span>
                  </div>

                  {/* Warning if filtered doctor is off duty on selected date */}
                  {selectedDoctorFilter !== "all" &&
                    !onDutyDoctorsForDate.some((d) => d.id === selectedDoctorFilter) && (
                      <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2.5">
                        <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold">
                            {selectedClinic.doctors.find((d) => d.id === selectedDoctorFilter)?.name} is not on duty on {dayOfWeekForSelectedDate}s.
                          </p>
                          <p className="text-[11px] text-amber-700 mt-0.5">
                            You can choose another on-duty doctor below for this date, or select an on-duty day for Dr. {selectedClinic.doctors.find((d) => d.id === selectedDoctorFilter)?.name?.replace("Dr.", "").trim()} on the calendar.
                          </p>
                        </div>
                      </div>
                    )}

                  {onDutyDoctorsForDate.length === 0 ? (
                    <div className="p-4 rounded-2xl bg-gradient-to-r from-magenta-50/90 to-pink-50/60 border border-magenta-200/90 flex items-start gap-3.5 shadow-xs">
                      <div className="w-10 h-10 rounded-xl bg-magenta-100 flex items-center justify-center text-magenta-700 shrink-0 mt-0.5">
                        <Stethoscope className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-bold text-gray-900">General Dermatological Consultation</p>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-magenta-100 text-magenta-700 shrink-0">
                            Clinic Queue
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-600 mt-1 leading-relaxed">
                          Your consultation will be booked directly with <strong>{selectedClinic.name}</strong>. An on-duty dermatologist will be assigned by the clinic staff upon schedule review.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {onDutyDoctorsForDate.map((doc) => {
                        const isSelected = activeDutyDoctor?.id === doc.id;
                        return (
                          <button
                            key={doc.id}
                            type="button"
                            onClick={() => setSelectedDoctorId(doc.id)}
                            className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer flex items-center gap-3 ${
                              isSelected
                                ? "bg-magenta-50/70 border-magenta-300 ring-2 ring-magenta-500/20 shadow-xs"
                                : "bg-white border-gray-200 hover:border-gray-300 hover:bg-slate-50/60"
                            }`}
                          >
                            {doc.photo ? (
                              <img
                                src={doc.photo}
                                alt={doc.name}
                                className="w-12 h-12 rounded-xl object-cover border border-magenta-200 shrink-0"
                              />
                            ) : (
                              <div className="w-12 h-12 rounded-xl bg-magenta-100/70 text-magenta-700 font-bold flex items-center justify-center text-sm shrink-0">
                                {doc.name.replace("Dr.", "").trim().charAt(0) || "D"}
                              </div>
                            )}

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-1">
                                <h4 className="text-xs font-bold text-gray-900 truncate">
                                  {doc.name}
                                </h4>
                                {isSelected && (
                                  <span className="w-4 h-4 rounded-full bg-magenta-600 text-white flex items-center justify-center shrink-0">
                                    <Check className="w-2.5 h-2.5" />
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-magenta-700 font-semibold truncate mt-0.5">
                                {doc.specialization || "General Dermatology"}
                              </p>
                              {(() => {
                                const dayShift =
                                  doc.dutySchedule && doc.dutySchedule[dayOfWeekForSelectedDate]
                                    ? doc.dutySchedule[dayOfWeekForSelectedDate]
                                    : { startTime: doc.dutyStartTime || "09:00", endTime: doc.dutyEndTime || "17:00" };
                                return (
                                  <p className="text-[10px] text-gray-500 flex items-center gap-1 mt-1 font-medium">
                                    <Clock className="w-3 h-3 text-magenta-500 shrink-0" />
                                    <span>{dayOfWeekForSelectedDate}: {formatTime12h(dayShift.startTime)} – {formatTime12h(dayShift.endTime)}</span>
                                  </p>
                                );
                              })()}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 4. Time Slots */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-2">
                    Available Time Slots {activeDutyDoctor ? `for ${activeDutyDoctor.name}` : "for Consultation"} <span className="text-red-500">*</span>
                  </label>

                  <div className="space-y-2.5">
                    {dynamicTimeSlots.morning.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                          <Clock className="w-3 h-3 text-amber-500" /> Morning Consultation Slots
                        </p>
                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                          {dynamicTimeSlots.morning.map((slot) => {
                            const isSelected = selectedTime === slot.value;
                            return (
                              <button
                                key={slot.value}
                                type="button"
                                onClick={() => setSelectedTime(slot.value)}
                                className={`py-1.5 px-1 rounded-xl text-xs font-semibold text-center transition-all cursor-pointer ${
                                  isSelected
                                    ? "bg-magenta-600 text-white shadow-xs font-bold ring-2 ring-magenta-400/30 scale-102"
                                    : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
                                }`}
                              >
                                {slot.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {dynamicTimeSlots.afternoon.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                          <Clock className="w-3 h-3 text-blue-500" /> Afternoon Consultation Slots
                        </p>
                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                          {dynamicTimeSlots.afternoon.map((slot) => {
                            const isSelected = selectedTime === slot.value;
                            return (
                              <button
                                key={slot.value}
                                type="button"
                                onClick={() => setSelectedTime(slot.value)}
                                className={`py-1.5 px-1 rounded-xl text-xs font-semibold text-center transition-all cursor-pointer ${
                                  isSelected
                                    ? "bg-magenta-600 text-white shadow-xs font-bold ring-2 ring-magenta-400/30 scale-102"
                                    : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
                                }`}
                              >
                                {slot.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 5. Summary Overview Card */}
                <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200/80 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      Appointment Summary
                    </span>
                    <button
                      type="button"
                      onClick={() => setCurrentStep(1)}
                      className="text-[10px] font-bold text-magenta-600 hover:underline cursor-pointer"
                    >
                      Edit Patient Info
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    <div className="bg-white p-2.5 rounded-xl border border-gray-100">
                      <span className="text-[10px] text-gray-400 font-medium block">Schedule</span>
                      <p className="font-bold text-magenta-700 flex items-center gap-1 mt-0.5 truncate">
                        <Calendar className="w-3 h-3 text-magenta-500 shrink-0" />
                        {formattedPreviewDate} ({formattedPreviewTime})
                      </p>
                    </div>

                    <div className="bg-white p-2.5 rounded-xl border border-gray-100">
                      <span className="text-[10px] text-gray-400 font-medium block">Attending Doctor</span>
                      <p className="font-bold text-gray-900 truncate mt-0.5">
                        {activeDutyDoctor?.name || "On Duty Doctor"}
                      </p>
                    </div>

                    <div className="bg-white p-2.5 rounded-xl border border-gray-100">
                      <span className="text-[10px] text-gray-400 font-medium block">Patient Name</span>
                      <p className="font-bold text-gray-900 truncate mt-0.5">{patientName || "Patient"}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Step 2 Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={handlePrevStep}
                  disabled={submitting}
                  className="px-5 py-3 rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold text-xs transition-colors cursor-pointer"
                >
                  ← Back to Step 1
                </button>
                <button
                  type="button"
                  onClick={() => handleSubmitAppointment()}
                  disabled={submitting}
                  className="flex-1 py-3 bg-magenta-600 hover:bg-magenta-700 text-white rounded-full font-semibold text-sm shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 active:scale-[0.98]"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Submitting Appointment Request...</span>
                    </>
                  ) : (
                    <>
                      <span>Confirm &amp; Book Appointment</span>
                      <Check className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Clinic Details Modal */}
      <AnimatePresence>
        {showClinicDetailsModal && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-100 max-h-[90vh] flex flex-col text-left"
            >
              <div className="px-6 pt-5 pb-4 flex items-start justify-between border-b border-gray-100">
                <div className="flex items-center gap-3">
                  {selectedClinic.logo ? (
                    <img src={selectedClinic.logo} alt={selectedClinic.name} className="w-10 h-10 rounded-xl object-cover border border-gray-200" />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-magenta-50 border border-magenta-100 text-magenta-600 flex items-center justify-center font-bold">
                      {selectedClinic.name.charAt(0)}
                    </div>
                  )}
                  <div>
                    <h3 className="font-bold text-gray-900 text-base flex items-center gap-1.5">
                      {selectedClinic.name}
                      {selectedClinic.verified && <VerifiedBadge size={16} className="w-4 h-4" />}
                    </h3>
                    <p className="text-xs text-gray-500">{selectedClinic.address}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowClinicDetailsModal(false)}
                  className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto space-y-4 text-xs">
                {selectedClinic.photos && selectedClinic.photos.length > 0 && (
                  <div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">Clinic Photos</span>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {selectedClinic.photos.map((p, idx) => (
                        <img
                          key={idx}
                          src={p}
                          alt="Clinic facility"
                          onClick={() => setLightboxPhoto(p)}
                          className="w-24 h-16 rounded-xl object-cover border border-gray-200 shrink-0 cursor-pointer hover:opacity-90"
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">About</span>
                  <p className="text-gray-700 leading-relaxed">{selectedClinic.description || "Verified dermatology clinic in Cebu providing comprehensive skin care and medical consultations."}</p>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Attending Doctors</span>
                  <div className="space-y-1.5">
                    {selectedClinic.doctors.map((d) => (
                      <div key={d.id} className="p-2.5 rounded-xl bg-slate-50 border border-gray-100 flex items-center gap-2.5">
                        {d.photo ? (
                          <img src={d.photo} alt={d.name} className="w-8 h-8 rounded-full object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-magenta-100 text-magenta-700 font-bold flex items-center justify-center text-xs">
                            {d.name.replace("Dr.", "").trim().charAt(0) || "D"}
                          </div>
                        )}
                        <div>
                          <p className="font-bold text-gray-900">{d.name}</p>
                          <p className="text-[10px] text-magenta-700 font-semibold">{d.specialization}</p>
                          <p className="text-[10px] text-gray-400">
                            Duty: {d.dutyDays.map((x) => x.slice(0, 3)).join(", ")}{" "}
                            {d.dutySchedule && Object.keys(d.dutySchedule).length > 0
                              ? "• Flexible Shifts"
                              : `(${formatTime12h(d.dutyStartTime)} – ${formatTime12h(d.dutyEndTime)})`}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="px-6 py-3.5 bg-gray-50/80 border-t border-gray-100 text-right">
                <button
                  type="button"
                  onClick={() => setShowClinicDetailsModal(false)}
                  className="px-4 py-2 rounded-xl bg-magenta-600 text-white font-semibold text-xs hover:bg-magenta-700 transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Lightbox for Photos */}
      <AnimatePresence>
        {lightboxPhoto && (
          <div
            onClick={() => setLightboxPhoto(null)}
            className="fixed inset-0 z-60 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 cursor-pointer"
          >
            <div className="relative max-w-3xl max-h-[85vh]">
              <img src={lightboxPhoto} alt="Enlarged view" className="max-w-full max-h-[85vh] rounded-2xl object-contain shadow-2xl" />
              <button
                type="button"
                onClick={() => setLightboxPhoto(null)}
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
