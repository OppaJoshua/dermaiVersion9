import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  XCircle,
  X,
  LifeBuoy,
  Mail,
  Phone,
  ChevronDown,
  ChevronUp,
  Send,
} from "lucide-react";
import { useClinicVerification } from "@/hooks/useClinicVerification";
import { supabase } from "@/lib/supabaseClient";
import { createHelpdeskTicketAsync } from "@/lib/store";
import LocationPickerMap from "@/components/common/LocationPickerMap";

/* ── Study-scoped service options ─────────────────────────── */
const SERVICES_OPTIONS = [
  "Vitiligo",
  "Acne Vulgaris",
  "Atopic Dermatitis",
  "Contact Dermatitis",
  "Melasma",
];

/** Map legacy or parenthesized service names to clean standardized names */
const LEGACY_SERVICE_MAP: Record<string, string> = {
  "Tinea Versicolor (Anapaw)": "",
  "Tinea Corporis (Buni)": "",
  "Tinea Pedis (Athlete's Foot)": "",
  "Prickly Heat (Bungang Araw)": "",
  "Impetigo (Nana sa Balat)": "",
  "Leprosy (Ketong)": "",
  "Acne Vulgaris (Taghiyawat)": "Acne Vulgaris",
  "Contact Dermatitis (Skin Allergy)": "Contact Dermatitis",
  "Atopic Dermatitis (Eczema)": "Atopic Dermatitis",
  "Melasma (Dark Patches)": "Melasma",
};

/** Parse servicesOffered: handles JSON array string or legacy comma string */
function parseServices(raw: string): string[] {
  if (!raw) return [];
  let list: string[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) list = parsed as string[];
  } catch {
    /* ignore invalid JSON */
  }
  if (!list.length) {
    list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return list
    .map((s) => (s in LEGACY_SERVICE_MAP ? LEGACY_SERVICE_MAP[s] : s))
    .filter(Boolean);
}

export type ClinicDoctorSummary = {
  id: string;
  name: string;
  specialization?: string;
};

type ClinicSettings = {
  logo: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  location: string;
  operatingDays: string;
  openTime: string;
  closeTime: string;
  doctors: ClinicDoctorSummary[];
  servicesOffered: string;
  consultationFee: string;
  description: string;
  latitude: number | null;
  longitude: number | null;
  status: "pending" | "verified" | "rejected";
  slotIntervalMinutes?: number;
  maxPatientsPerDay?: number;
};

const DEFAULT_SETTINGS: ClinicSettings = {
  logo: "",
  name: "",
  email: "",
  phone: "",
  address: "",
  location: "",
  operatingDays: "Monday - Saturday",
  openTime: "08:00",
  closeTime: "17:00",
  doctors: [],
  servicesOffered: "",
  consultationFee: "",
  description: "",
  latitude: null,
  longitude: null,
  status: "pending",
  slotIntervalMinutes: 20,
  maxPatientsPerDay: 20,
};

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
  { value: "22:30", label: "10:30 PM" },
  { value: "23:00", label: "11:00 PM" },
];

function formatTime12h(timeStr?: string): string {
  if (!timeStr) return "";
  const parts = timeStr.split(":");
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h)) return timeStr;
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  const minute = isNaN(m) ? "00" : String(m).padStart(2, "0");
  return `${hour}:${minute} ${ampm}`;
}

function getInitialSettings(): ClinicSettings {
  let result: Partial<ClinicSettings> = {};

  // 1. Try dermai_clinic_settings from localStorage
  try {
    const savedRaw = localStorage.getItem("dermai_clinic_settings");
    if (savedRaw) {
      const parsed = JSON.parse(savedRaw);
      if (parsed && typeof parsed === "object") {
        result = { ...parsed };
      }
    }
  } catch {}

  // 2. Try dermai_clinic_applications if name or essential details are missing
  if (!result.name?.trim() || !result.email?.trim() || !result.phone?.trim()) {
    try {
      const appsRaw = localStorage.getItem("dermai_clinic_applications");
      if (appsRaw) {
        const apps = JSON.parse(appsRaw);
        if (Array.isArray(apps) && apps.length > 0) {
          const app = apps[0];
          result = {
            ...result,
            name: result.name?.trim() || app.name || "",
            address: result.address?.trim() || app.address || "",
            location: result.location?.trim() || app.location || app.district || app.address || "",
            email: result.email?.trim() || app.email || "",
            phone: result.phone?.trim() || app.phone || "",
            logo: result.logo || app.logo || "",
            consultationFee: result.consultationFee || (app.consultationFee != null ? String(app.consultationFee) : ""),
            description: result.description || app.description || "",
            latitude: result.latitude != null ? result.latitude : (app.latitude != null ? Number(app.latitude) : null),
            longitude: result.longitude != null ? result.longitude : (app.longitude != null ? Number(app.longitude) : null),
            operatingDays: result.operatingDays || app.operatingDays || "Monday - Saturday",
            openTime: result.openTime || app.openTime || "08:00",
            closeTime: result.closeTime || app.closeTime || "17:00",
            servicesOffered: result.servicesOffered || app.servicesOffered || "",
          };
        }
      }
    } catch {}
  }

  // 3. Fallback to dermai_clinic_profile_cache for clinic name / logo
  try {
    const cacheRaw = localStorage.getItem("dermai_clinic_profile_cache");
    if (cacheRaw) {
      const profile = JSON.parse(cacheRaw);
      if (profile) {
        if (!result.name?.trim() && profile.clinicName && profile.clinicName !== "Clinic Portal") {
          result.name = profile.clinicName;
        }
        if (!result.logo && profile.clinicLogo) {
          result.logo = profile.clinicLogo;
        }
        if (profile.status === "verified") {
          result.status = "verified";
        }
      }
    }
  } catch {}

  return {
    ...DEFAULT_SETTINGS,
    ...result,
    consultationFee: result.consultationFee != null ? String(result.consultationFee) : "",
    doctors: Array.isArray(result.doctors) ? result.doctors : [],
    latitude: result.latitude != null ? Number(result.latitude) : null,
    longitude: result.longitude != null ? Number(result.longitude) : null,
  };
}

export default function ClinicSettingsPage() {
  const [settings, setSettings] = useState<ClinicSettings>(getInitialSettings);
  const [saved, setSaved] = useState(false);
  const [selectedServices, setSelectedServices] = useState<string[]>(() => {
    const initial = getInitialSettings();
    if (initial.servicesOffered) {
      const svcs = parseServices(initial.servicesOffered);
      if (svcs.length > 0) return svcs;
    }
    try {
      const appsRaw = localStorage.getItem("dermai_clinic_applications");
      if (appsRaw) {
        const apps = JSON.parse(appsRaw);
        if (Array.isArray(apps) && apps[0]?.servicesOffered) {
          const svcs = parseServices(apps[0].servicesOffered);
          if (svcs.length > 0) return svcs;
        }
      }
    } catch {}
    return parseServices(DEFAULT_SETTINGS.servicesOffered);
  });
  const [customServiceInput, setCustomServiceInput] = useState("");

  // Helpdesk state
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketMessage, setTicketMessage] = useState("");
  const [ticketSent, setTicketSent] = useState(false);
  const [ticketSubmitting, setTicketSubmitting] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const { status: verificationStatus, clinicId, clinicName, clinicLogo, loading } = useClinicVerification();
  const [dbClinicId, setDbClinicId] = useState<string | null>(null);
  // UI Mode: Always allow editing so the clinic can test and customize their UI
  const isPending = false;

  // Live-sync with clinic verification profile hook
  useEffect(() => {
    if (clinicName && clinicName !== "Clinic Portal") {
      setSettings((prev) => (!prev.name ? { ...prev, name: clinicName } : prev));
    }
    if (clinicLogo) {
      setSettings((prev) => (!prev.logo ? { ...prev, logo: clinicLogo } : prev));
    }
  }, [clinicName, clinicLogo]);

  // Load latest clinic settings from Supabase in background
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        // 1. Resolve session with auto-refresh fallback
        let session = (await supabase.auth.getSession()).data.session;
        if (!session) {
          try {
            const { data: userData } = await supabase.auth.getUser();
            if (userData?.user) {
              session = (await supabase.auth.getSession()).data.session;
            }
          } catch {}
        }

        const userId = session?.user?.id;
        const userEmail = session?.user?.email?.toLowerCase().trim();

        // 2. Resolve clinic ID from hook, cache, settings, or application snapshot
        let resolvedClinicId = clinicId;
        if (!resolvedClinicId) {
          try {
            const cache = localStorage.getItem("dermai_clinic_profile_cache");
            if (cache) {
              const parsed = JSON.parse(cache);
              if (parsed.clinicId) resolvedClinicId = parsed.clinicId;
            }
          } catch {}
        }
        if (!resolvedClinicId) {
          try {
            const sett = localStorage.getItem("dermai_clinic_settings");
            if (sett) {
              const parsed = JSON.parse(sett);
              if (parsed.id) resolvedClinicId = parsed.id;
            }
          } catch {}
        }
        if (!resolvedClinicId) {
          try {
            const apps = localStorage.getItem("dermai_clinic_applications");
            if (apps) {
              const parsed = JSON.parse(apps);
              if (Array.isArray(parsed) && parsed[0]?.id && !parsed[0].id.startsWith("temp_")) {
                resolvedClinicId = parsed[0].id;
              }
            }
          } catch {}
        }

        let dbClinic: any = null;

        // Query Strategy 1: Look up by resolvedClinicId directly
        if (resolvedClinicId && !resolvedClinicId.startsWith("temp_")) {
          try {
            const { data, error } = await supabase
              .from("clinic")
              .select(`
                clinic_id, name, district, address, phone, email, consultation_fee, description, status, verified, logo_url,
                latitude, longitude,
                clinic_service_offered ( service_name ),
                clinic_operating_hours ( day_of_week, open_time, close_time )
              `)
              .eq("clinic_id", resolvedClinicId)
              .maybeSingle();

            if (data && !error) {
              dbClinic = data;
            }
          } catch (err) {
            console.warn("Could not query clinic by clinic_id:", err);
          }
        }

        // Query Strategy 2: If not found, look up by owner_user_id
        if (!dbClinic && userId) {
          try {
            const { data, error } = await supabase
              .from("clinic")
              .select(`
                clinic_id, name, district, address, phone, email, consultation_fee, description, status, verified, logo_url,
                latitude, longitude,
                clinic_service_offered ( service_name ),
                clinic_operating_hours ( day_of_week, open_time, close_time )
              `)
              .eq("owner_user_id", userId)
              .maybeSingle();

            if (data && !error) {
              dbClinic = data;
            }
          } catch (err) {
            console.warn("Could not query clinic by owner_user_id:", err);
          }
        }

        // Query Strategy 3: If not found, look up by user email
        if (!dbClinic && userEmail) {
          try {
            const { data, error } = await supabase
              .from("clinic")
              .select(`
                clinic_id, name, district, address, phone, email, consultation_fee, description, status, verified, logo_url,
                latitude, longitude,
                clinic_service_offered ( service_name ),
                clinic_operating_hours ( day_of_week, open_time, close_time )
              `)
              .ilike("email", userEmail)
              .maybeSingle();

            if (data && !error) {
              dbClinic = data;
            }
          } catch (err) {
            console.warn("Could not query clinic by email:", err);
          }
        }

        // Query Strategy 4: If not found, look up by cached clinic name
        if (!dbClinic) {
          let nameHint = "";
          try {
            const cache = localStorage.getItem("dermai_clinic_profile_cache");
            if (cache) nameHint = JSON.parse(cache)?.clinicName || "";
            if (!nameHint) {
              const apps = localStorage.getItem("dermai_clinic_applications");
              if (apps) nameHint = JSON.parse(apps)?.[0]?.name || "";
            }
          } catch {}

          if (nameHint && nameHint !== "Clinic Portal") {
            try {
              const { data, error } = await supabase
                .from("clinic")
                .select(`
                  clinic_id, name, district, address, phone, email, consultation_fee, description, status, verified, logo_url,
                  latitude, longitude,
                  clinic_service_offered ( service_name ),
                  clinic_operating_hours ( day_of_week, open_time, close_time )
                `)
                .ilike("name", nameHint)
                .maybeSingle();

              if (data && !error) {
                dbClinic = data;
              }
            } catch (err) {
              console.warn("Could not query clinic by name:", err);
            }
          }
        }

        if (cancelled) return;

        if (dbClinic) {
          if (dbClinic.clinic_id) {
            setDbClinicId(dbClinic.clinic_id);
          }

          let loadedDoctors: ClinicDoctorSummary[] = [];
          if (dbClinic.clinic_id) {
            const { data: docList } = await supabase
              .from("clinic_doctor")
              .select("doctor_id, doctor_name, email, status, specialization")
              .eq("clinic_id", dbClinic.clinic_id)
              .neq("status", "Inactive");

            if (docList && docList.length > 0) {
              loadedDoctors = docList.map((d: any) => ({
                id: d.doctor_id,
                name: d.doctor_name,
                specialization: d.specialization || "General Dermatology",
              }));
            }
          }

          if (cancelled) return;

          setSettings((prev) => {
            let loadedOperatingDays = prev.operatingDays;
            let loadedOpenTime = prev.openTime;
            let loadedCloseTime = prev.closeTime;

            if (Array.isArray(dbClinic.clinic_operating_hours) && dbClinic.clinic_operating_hours.length > 0) {
              const h = dbClinic.clinic_operating_hours[0];
              if (h.day_of_week) loadedOperatingDays = h.day_of_week;
              if (h.open_time) loadedOpenTime = h.open_time.slice(0, 5);
              if (h.close_time) loadedCloseTime = h.close_time.slice(0, 5);
            }

            const isClinicVerified =
              dbClinic.verified === true ||
              dbClinic.status === "approved" ||
              dbClinic.status === "verified";

            const mappedStatus = isClinicVerified ? "verified" : (dbClinic.status || prev.status);

            let loadedSlotInterval = prev.slotIntervalMinutes || 20;
            let loadedMaxPatients = prev.maxPatientsPerDay || 20;
            try {
              const cachedSett = localStorage.getItem("dermai_clinic_settings");
              if (cachedSett) {
                const parsed = JSON.parse(cachedSett);
                if (parsed.slotIntervalMinutes) loadedSlotInterval = Number(parsed.slotIntervalMinutes);
                if (parsed.maxPatientsPerDay) loadedMaxPatients = Number(parsed.maxPatientsPerDay);
              }
            } catch {}

            const next: ClinicSettings = {
              ...prev,
              name: dbClinic.name || prev.name || "",
              address: dbClinic.address || prev.address || "",
              location: dbClinic.district || dbClinic.address || prev.location || "",
              phone: dbClinic.phone || prev.phone || "",
              email: dbClinic.email || prev.email || "",
              logo: dbClinic.logo_url || prev.logo || "",
              consultationFee: dbClinic.consultation_fee != null ? String(dbClinic.consultation_fee) : (prev.consultationFee || ""),
              description: dbClinic.description || prev.description || "",
              latitude: dbClinic.latitude != null ? Number(dbClinic.latitude) : prev.latitude,
              longitude: dbClinic.longitude != null ? Number(dbClinic.longitude) : prev.longitude,
              status: mappedStatus as any,
              operatingDays: loadedOperatingDays,
              openTime: loadedOpenTime,
              closeTime: loadedCloseTime,
              doctors: loadedDoctors.length > 0 ? loadedDoctors : prev.doctors,
              slotIntervalMinutes: loadedSlotInterval,
              maxPatientsPerDay: loadedMaxPatients,
            };

            try {
              localStorage.setItem("dermai_clinic_settings", JSON.stringify(next));
            } catch {}

            return next;
          });

          if (dbClinic.clinic_service_offered && dbClinic.clinic_service_offered.length > 0) {
            const dbSvcs = dbClinic.clinic_service_offered.map((s: any) => s.service_name).filter(Boolean);
            if (dbSvcs.length > 0) {
              setSelectedServices(dbSvcs);
            }
          }
        } else {
          // If Supabase clinic row could not be found, fall back to local applications cache
          try {
            const appsRaw = localStorage.getItem("dermai_clinic_applications");
            if (appsRaw) {
              const apps = JSON.parse(appsRaw);
              if (Array.isArray(apps) && apps.length > 0) {
                const app = apps[0];
                setSettings((prev) => ({
                  ...prev,
                  name: prev.name || app.name || "",
                  address: prev.address || app.address || "",
                  location: prev.location || app.location || app.district || app.address || "",
                  phone: prev.phone || app.phone || "",
                  email: prev.email || app.email || "",
                  logo: prev.logo || app.logo || "",
                  consultationFee: prev.consultationFee || (app.consultationFee != null ? String(app.consultationFee) : ""),
                  description: prev.description || app.description || "",
                  latitude: prev.latitude != null ? prev.latitude : (app.latitude != null ? Number(app.latitude) : null),
                  longitude: prev.longitude != null ? prev.longitude : (app.longitude != null ? Number(app.longitude) : null),
                  operatingDays: prev.operatingDays || app.operatingDays || "Monday - Saturday",
                  openTime: prev.openTime || app.openTime || "08:00",
                  closeTime: prev.closeTime || app.closeTime || "17:00",
                }));
                if (app.servicesOffered) {
                  const svcs = parseServices(app.servicesOffered);
                  if (svcs.length > 0) setSelectedServices(svcs);
                }
              }
            }
          } catch {}
        }
      } catch (err) {
        console.error("Error loading clinic settings:", err);
      }
    }

    loadData();

    // Listen to profile / settings update events
    const handleSync = () => {
      loadData();
    };
    window.addEventListener("dermai_clinic_profile_updated", handleSync);
    window.addEventListener("dermai_clinic_updated", handleSync);

    return () => {
      cancelled = true;
      window.removeEventListener("dermai_clinic_profile_updated", handleSync);
      window.removeEventListener("dermai_clinic_updated", handleSync);
    };
  }, [clinicId, loading]);

  const onSave = async () => {
    const targetClinicId = clinicId || dbClinicId;
    const isCurrentlyVerified =
      verificationStatus === "verified" ||
      settings.status === "verified";

    // 1. Save settings to localStorage for instant 0ms synchronization
    const settingsToSave = {
      ...settings,
      status: isCurrentlyVerified ? "verified" : settings.status,
      id: targetClinicId || undefined,
      consultationFee: settings.consultationFee || "",
      servicesOffered: JSON.stringify(selectedServices),
      hours: `${settings.operatingDays || "Monday - Saturday"}: ${formatTime12h(settings.openTime || "08:00")} – ${formatTime12h(settings.closeTime || "17:00")}`,
      slotIntervalMinutes: settings.slotIntervalMinutes || 30,
    };
    localStorage.setItem("dermai_clinic_settings", JSON.stringify(settingsToSave));
    window.dispatchEvent(new Event("storage"));

    // Also update matching clinic application cache for search and booking
    try {
      const appsRaw = localStorage.getItem("dermai_clinic_applications");
      if (appsRaw) {
        const apps = JSON.parse(appsRaw);
        if (Array.isArray(apps)) {
          const updatedApps = apps.map((app: any) => {
            if (
              (targetClinicId && String(app.id) === String(targetClinicId)) ||
              (settings.name && app.name && app.name.toLowerCase().trim() === settings.name.toLowerCase().trim()) ||
              (settings.email && app.email && app.email.toLowerCase().trim() === settings.email.toLowerCase().trim())
            ) {
              return {
                ...app,
                status: isCurrentlyVerified ? "verified" : app.status,
                name: settings.name || app.name,
                address: settings.address || app.address,
                district: settings.location || app.district,
                phone: settings.phone || app.phone,
                email: settings.email || app.email,
                consultationFee: settings.consultationFee || app.consultationFee,
                description: settings.description || app.description,
                operatingDays: settings.operatingDays,
                openTime: settings.openTime,
                closeTime: settings.closeTime,
                hours: `${settings.operatingDays || "Monday - Saturday"}: ${formatTime12h(settings.openTime || "08:00")} – ${formatTime12h(settings.closeTime || "17:00")}`,
                slotIntervalMinutes: settings.slotIntervalMinutes || 30,
                services: selectedServices,
                servicesOffered: JSON.stringify(selectedServices),
                latitude: settings.latitude,
                longitude: settings.longitude,
              };
            }
            return app;
          });
          localStorage.setItem("dermai_clinic_applications", JSON.stringify(updatedApps));
        }
      }
    } catch {}

    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new CustomEvent("clinicSettingsUpdated", { detail: settingsToSave }));
    window.dispatchEvent(new CustomEvent("dermai_clinic_updated"));

    setSaved(true);
    setTimeout(() => setSaved(false), 2500);

    // 2. Synchronize clinic details, operating hours, consultation fee and services to Supabase
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      const feeNumber = settings.consultationFee.trim() !== "" ? parseFloat(settings.consultationFee) : null;

      if (targetClinicId || userId || settings.email) {
        const payload: Record<string, any> = {
          name: settings.name,
          address: settings.address,
          district: settings.location || settings.address,
          phone: settings.phone,
          email: settings.email,
          consultation_fee: feeNumber,
          description: settings.description,
          latitude: settings.latitude,
          longitude: settings.longitude,
        };
        if (settings.logo) {
          payload.logo_url = settings.logo;
        }
        if (userId) {
          payload.owner_user_id = userId;
        }
        if (isCurrentlyVerified) {
          payload.verified = true;
          payload.status = "approved";
        }

        let query = supabase.from("clinic").update(payload);

        if (targetClinicId) {
          query = query.eq("clinic_id", targetClinicId);
        } else if (userId) {
          query = query.eq("owner_user_id", userId);
        } else if (settings.email) {
          query = query.ilike("email", settings.email);
        }
        const { data: updatedClinic } = await query.select("clinic_id").maybeSingle();
        const effectiveClinicId = targetClinicId || updatedClinic?.clinic_id;

        if (effectiveClinicId) {
          // Update operating hours
          try {
            await supabase.from("clinic_operating_hours").delete().eq("clinic_id", effectiveClinicId);
            if (settings.operatingDays) {
              await supabase.from("clinic_operating_hours").insert({
                clinic_id: effectiveClinicId,
                day_of_week: settings.operatingDays,
                open_time: settings.openTime || "08:00",
                close_time: settings.closeTime || "17:00",
              });
            }
          } catch (ohEx) {
            console.warn("Could not write clinic_operating_hours:", ohEx);
          }

          // Update services
          try {
            await supabase.from("clinic_service_offered").delete().eq("clinic_id", effectiveClinicId);
            if (selectedServices.length > 0) {
              await supabase.from("clinic_service_offered").insert(
                selectedServices.map((s) => ({
                  clinic_id: effectiveClinicId,
                  service_name: s,
                }))
              );
            }
          } catch (svEx) {
            console.warn("Could not write clinic_service_offered:", svEx);
          }
        }
      }
    } catch (cErr) {
      console.error("Error syncing clinic to Supabase:", cErr);
    }
  };

  const toggleService = (svc: string) => {
    setSelectedServices((prev) =>
      prev.includes(svc) ? prev.filter((s) => s !== svc) : [...prev, svc]
    );
  };

  const addCustomService = () => {
    const trimmed = customServiceInput.trim();
    if (trimmed && !selectedServices.includes(trimmed)) {
      setSelectedServices((prev) => [...prev, trimmed]);
    }
    setCustomServiceInput("");
  };

  const faqs = [
    {
      q: "How do I update my clinic's verification documents?",
      a: "Go to Basic Information, update the relevant fields and submit. An admin will re-review your application within 1–3 business days.",
    },
    {
      q: "Why are my appointment slots not showing to patients?",
      a: "Ensure your clinic status is Verified and that your operating hours and slots per day are saved correctly in Schedule & Capacity.",
    },
    {
      q: "How can I change my consultation fee?",
      a: "Consultation fees are managed per appointment type. You can set fees when configuring services under the Services section.",
    },
    {
      q: "What should I do if my clinic registration was rejected?",
      a: "Review the rejection reason sent to your registered email, update the incorrect information in your profile below, and submit a support ticket requesting re-review.",
    },
  ];

  const submitTicket = async () => {
    if (!ticketSubject.trim() || !ticketMessage.trim() || ticketSubmitting) return;

    setTicketSubmitting(true);
    setTicketError(null);
    setTicketSent(false);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        throw new Error("Your session has expired. Please sign in again.");
      }

      await createHelpdeskTicketAsync({
        userId: session.user.id,
        user: settings.name?.trim() || session.user.email?.split("@")[0] || "Clinic Administrator",
        email: settings.email?.trim() || session.user.email || "",
        subject: ticketSubject.trim(),
        message: ticketMessage.trim(),
        category: "Clinic Support",
        priority: "medium",
      });

      setTicketSent(true);
      setTicketSubject("");
      setTicketMessage("");
      window.setTimeout(() => setTicketSent(false), 4000);
    } catch (err) {
      console.error("Failed to submit clinic ticket:", err);
      setTicketError(
        err instanceof Error
          ? err.message
          : "Your ticket could not be submitted. Please try again."
      );
    } finally {
      setTicketSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 pb-12">
      <div>
        <h1 className="text-2xl font-display font-bold text-gray-900">Clinic Profile & Settings</h1>
        <p className="text-sm text-gray-400 mt-0.5">Manage your clinic information, schedules, and booking capacity</p>
      </div>

      {!loading && verificationStatus === "rejected" && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3 text-red-700">
          <XCircle className="w-5 h-5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-semibold mb-1">Clinic Registration Rejected</p>
            <p>Your clinic registration was rejected by the admin. You can update your profile information below, but you cannot accept appointments until an admin approves your clinic.</p>
          </div>
        </div>
      )}
      {!loading && verificationStatus === "pending" && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3 text-amber-700">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-semibold mb-1">Account Pending Verification</p>
            <p>Your clinic application is currently being reviewed by an administrator. You cannot edit your profile or accept appointments until you are verified.</p>
          </div>
        </div>
      )}

      {/* ── Card 1: Basic Information & Map ── */}
      <div className="bg-white border border-gray-200/80 rounded-2xl p-6 shadow-xs space-y-5">
        <div>
          <h2 className="text-[17px] font-bold text-gray-900">Basic information</h2>
          <p className="text-[13px] text-gray-400 mt-0.5">This is what patients see on your clinic page.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Profile Photo, Name, Email, Phone, Location, Full Address, Description */}
          <div className="lg:col-span-6 space-y-4">
            {/* Clinic Profile Photo */}
            <div>
              <label className="block text-[13px] font-semibold text-gray-700 mb-2">Clinic profile photo</label>
              <div className="flex items-center gap-3.5">
                {settings.logo ? (
                  <img
                    src={settings.logo}
                    alt="Clinic logo"
                    className="w-14 h-14 rounded-full object-cover border-2 border-magenta-200 shrink-0"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-pink-50 border border-pink-200 text-[#c0166a] flex items-center justify-center shrink-0 text-xl font-bold">
                    {settings.name?.charAt(0)?.toUpperCase() || "D"}
                  </div>
                )}
                <div className="flex items-center gap-3 flex-wrap">
                  <label
                    className={`px-3.5 py-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-[13px] font-bold text-gray-700 shadow-2xs cursor-pointer transition-colors ${
                      isPending ? "opacity-50 pointer-events-none" : ""
                    }`}
                  >
                    <span>Change photo</span>
                    <input
                      type="file"
                      accept="image/*"
                      disabled={isPending}
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          setSettings((prev) => ({ ...prev, logo: reader.result as string }));
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                  {settings.logo && !isPending && (
                    <button
                      type="button"
                      onClick={() => setSettings((prev) => ({ ...prev, logo: "" }))}
                      className="text-[13px] text-red-600 hover:text-red-700 font-semibold cursor-pointer"
                    >
                      Remove photo
                    </button>
                  )}
                  <span className="text-xs text-gray-400">JPG, PNG or WebP - Max 2 MB</span>
                </div>
              </div>
            </div>

            {/* 2x2 Inputs: Clinic Name, Email, Contact Number, Location */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-[13px] font-semibold text-gray-700 mb-1">Clinic name</label>
                <input
                  type="text"
                  disabled={isPending}
                  value={settings.name}
                  onChange={(e) => setSettings((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3.5 py-2 rounded-xl border border-gray-200 text-[13px] font-medium text-gray-900 outline-none focus:border-magenta-500 focus:ring-1 focus:ring-magenta-500 disabled:bg-gray-50"
                />
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  disabled={isPending}
                  value={settings.email}
                  onChange={(e) => setSettings((prev) => ({ ...prev, email: e.target.value }))}
                  className="w-full px-3.5 py-2 rounded-xl border border-gray-200 text-[13px] font-medium text-gray-900 outline-none focus:border-magenta-500 focus:ring-1 focus:ring-magenta-500 disabled:bg-gray-50"
                />
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-gray-700 mb-1">Contact number</label>
                <input
                  type="text"
                  disabled={isPending}
                  value={settings.phone}
                  onChange={(e) => setSettings((prev) => ({ ...prev, phone: e.target.value }))}
                  className="w-full px-3.5 py-2 rounded-xl border border-gray-200 text-[13px] font-medium text-gray-900 outline-none focus:border-magenta-500 focus:ring-1 focus:ring-magenta-500 disabled:bg-gray-50"
                />
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-gray-700 mb-1">Location</label>
                <input
                  type="text"
                  disabled={isPending}
                  value={settings.location}
                  onChange={(e) => setSettings((prev) => ({ ...prev, location: e.target.value }))}
                  className="w-full px-3.5 py-2 rounded-xl border border-gray-200 text-[13px] font-medium text-gray-900 outline-none focus:border-magenta-500 focus:ring-1 focus:ring-magenta-500 disabled:bg-gray-50"
                />
              </div>
            </div>

            {/* Full address */}
            <div>
              <label className="block text-[13px] font-semibold text-gray-700 mb-1">Full address</label>
              <input
                type="text"
                disabled={isPending}
                value={settings.address}
                onChange={(e) => setSettings((prev) => ({ ...prev, address: e.target.value }))}
                className="w-full px-3.5 py-2 rounded-xl border border-gray-200 text-[13px] font-medium text-gray-900 outline-none focus:border-magenta-500 focus:ring-1 focus:ring-magenta-500 disabled:bg-gray-50"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-[13px] font-semibold text-gray-700 mb-1">Description</label>
              <textarea
                rows={4}
                disabled={isPending}
                value={settings.description}
                onChange={(e) => setSettings((prev) => ({ ...prev, description: e.target.value }))}
                className="w-full px-3.5 py-2 rounded-xl border border-gray-200 text-[13px] font-medium text-gray-900 outline-none focus:border-magenta-500 focus:ring-1 focus:ring-magenta-500 disabled:bg-gray-50 resize-y"
              />
            </div>
          </div>

          {/* Right Column: Pin Location on Map */}
          <div className="lg:col-span-6 space-y-2">
            <div>
              <label className="block text-[13px] font-semibold text-gray-700">Pin location on map</label>
              <p className="text-xs text-gray-400 mt-0.5">
                Pin your clinic so patients can find you on the map in Find Clinics.
              </p>
            </div>
            <LocationPickerMap
              latitude={settings.latitude}
              longitude={settings.longitude}
              disabled={isPending}
              onChange={(lat, lng, addressSuggestion) => {
                setSettings((prev) => ({
                  ...prev,
                  latitude: lat,
                  longitude: lng,
                  address: addressSuggestion || prev.address,
                }));
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Row 2: Services & Conditions (Left) and Service Fee (Right) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left: Services & Conditions */}
        <div className="lg:col-span-7 bg-white border border-gray-200/80 rounded-2xl p-6 shadow-xs flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            <div>
              <h2 className="text-[17px] font-bold text-gray-900">Services &amp; conditions</h2>
              <p className="text-[13px] text-gray-400 mt-0.5">
                Select all conditions your clinic treats. Patients searching for them will find your clinic.
              </p>
            </div>

            {/* Condition Pills */}
            <div className="flex flex-wrap gap-2 pt-1">
              {SERVICES_OPTIONS.map((svc) => {
                const selected = selectedServices.includes(svc);
                return (
                  <button
                    key={svc}
                    type="button"
                    disabled={isPending}
                    onClick={() => toggleService(svc)}
                    className={`px-3.5 py-1.5 rounded-full text-[13px] font-semibold border transition-all cursor-pointer ${
                      selected
                        ? "bg-[#fbeaf0] text-[#901353] border-[#f3c2d4] shadow-2xs"
                        : "bg-white text-gray-600 border-gray-200 hover:border-pink-300 hover:bg-pink-50/40"
                    }`}
                  >
                    {svc}
                  </button>
                );
              })}

              {/* Any custom selected services not in predefined list */}
              {selectedServices
                .filter((s) => !SERVICES_OPTIONS.includes(s))
                .map((svc) => (
                  <span
                    key={svc}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#fbeaf0] text-[#901353] border border-[#f3c2d4] text-[13px] font-semibold shadow-2xs"
                  >
                    {svc}
                    {!isPending && (
                      <button
                        type="button"
                        onClick={() => toggleService(svc)}
                        className="hover:text-red-700 transition-colors cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                ))}
            </div>
          </div>

          {/* Add custom service input */}
          <div className="pt-2">
            <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Add a custom service</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                disabled={isPending}
                value={customServiceInput}
                onChange={(e) => setCustomServiceInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomService())}
                placeholder="e.g. Laser Resurfacing"
                className="flex-1 px-3.5 py-2 rounded-xl border border-gray-200 text-[13px] font-medium text-gray-900 outline-none focus:border-magenta-500 focus:ring-1 focus:ring-magenta-500 disabled:bg-gray-50"
              />
              <button
                type="button"
                disabled={isPending || !customServiceInput.trim()}
                onClick={addCustomService}
                className="px-4 py-2 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 text-[13px] font-bold text-gray-700 shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {/* Right: Service Fee */}
        <div className="lg:col-span-5 bg-white border border-gray-200/80 rounded-2xl p-6 shadow-xs flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            <div>
              <h2 className="text-[17px] font-bold text-gray-900">Service fee</h2>
              <p className="text-[13px] text-gray-400 mt-0.5">
                Shown to patients on the Find Clinics page.
              </p>
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Starts at</label>
              <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden w-full max-w-xs focus-within:border-magenta-500 focus-within:ring-1 focus-within:ring-magenta-500 bg-white">
                <span className="px-3 py-2 text-[13px] font-bold text-gray-500 bg-gray-50 border-r border-gray-200 select-none">
                  ₱
                </span>
                <input
                  type="number"
                  min={0}
                  disabled={isPending}
                  placeholder="600"
                  value={settings.consultationFee}
                  onChange={(e) => setSettings((prev) => ({ ...prev, consultationFee: e.target.value }))}
                  className="flex-1 px-3.5 py-2 text-[13px] font-semibold text-gray-900 outline-none disabled:bg-gray-50"
                />
              </div>
            </div>
          </div>

          <p className="text-[13px] text-gray-500 pt-2">
            Patients will see: <span className="font-bold text-gray-800">Service Fee: Starts at ₱{settings.consultationFee || "600"}</span>
          </p>
        </div>
      </div>

      {/* ── Card 3: Schedule & Patient Capacity ── */}
      <div className="bg-white border border-gray-200/80 rounded-2xl p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-3">
          <div>
            <h2 className="text-[17px] font-bold text-gray-900">Schedule &amp; patient capacity</h2>
            <p className="text-[13px] text-gray-400 mt-0.5">
              Clinic-wide operating hours, slot length and booking limits. Availability is worked out from these, plus each doctor's active duty shifts.
            </p>
          </div>
          <Link
            to="/clinic/doctors"
            className="text-[13px] font-bold text-[#c0166a] hover:text-[#901353] hover:underline flex items-center gap-1 shrink-0"
          >
            <span>Doctor shifts</span>
            <span className="font-bold">→</span>
          </Link>
        </div>

        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
            <div>
              <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Operating days</label>
              <input
                type="text"
                disabled={isPending}
                value={settings.operatingDays}
                onChange={(e) => setSettings((prev) => ({ ...prev, operatingDays: e.target.value }))}
                placeholder="e.g. Monday - Friday"
                className="w-full px-3.5 py-2 rounded-xl border border-gray-200 text-[13px] font-medium text-gray-900 outline-none focus:border-magenta-500 focus:ring-1 focus:ring-magenta-500 disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Open time</label>
              <select
                disabled={isPending}
                value={settings.openTime}
                onChange={(e) => setSettings((prev) => ({ ...prev, openTime: e.target.value }))}
                className="w-full px-3.5 py-2 rounded-xl border border-gray-200 text-[13px] font-medium text-gray-900 outline-none focus:border-magenta-500 focus:ring-1 focus:ring-magenta-500 disabled:bg-gray-50 bg-white cursor-pointer"
              >
                {TIME_SLOT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Close time</label>
              <select
                disabled={isPending}
                value={settings.closeTime}
                onChange={(e) => setSettings((prev) => ({ ...prev, closeTime: e.target.value }))}
                className="w-full px-3.5 py-2 rounded-xl border border-gray-200 text-[13px] font-medium text-gray-900 outline-none focus:border-magenta-500 focus:ring-1 focus:ring-magenta-500 disabled:bg-gray-50 bg-white cursor-pointer"
              >
                {TIME_SLOT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Default slot interval</label>
              <select
                disabled={isPending}
                value={settings.slotIntervalMinutes || 20}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    slotIntervalMinutes: Number(e.target.value),
                  }))
                }
                className="w-full px-3.5 py-2 rounded-xl border border-gray-200 text-[13px] font-medium text-gray-900 outline-none focus:border-magenta-500 focus:ring-1 focus:ring-magenta-500 disabled:bg-gray-50 bg-white cursor-pointer"
              >
                <option value={10}>10 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={20}>20 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={45}>45 minutes</option>
                <option value={60}>60 minutes</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end mt-2">
            <p className="text-xs text-gray-400">
              About {Math.round(60 / (settings.slotIntervalMinutes || 20))} slots per hour. Doctors use this unless they set their own in the duty roster.
            </p>
          </div>
        </div>
      </div>

      {/* ── Card 4: Save Settings Action Bar ── */}
      <div className="bg-white border border-gray-200/80 rounded-2xl p-4 shadow-xs flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <p className="text-[13px] text-gray-500">Saves your profile, services, fee and schedule.</p>
          {saved && <span className="text-[13px] text-emerald-600 font-semibold ml-2">✓ Settings saved successfully</span>}
        </div>

        <button
          onClick={onSave}
          disabled={isPending}
          className="px-6 py-2.5 rounded-xl bg-[#881337] hover:bg-[#70102d] text-white text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer"
        >
          Save settings
        </button>
      </div>

      {/* ── Helpdesk & Support (Two-Column Layout) ───────────── */}
      <div className="bg-white border border-gray-200/80 rounded-2xl p-6 shadow-xs space-y-5">
        <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
          <LifeBuoy className="w-5 h-5 text-[#c0166a]" />
          <h2 className="text-[17px] font-bold text-gray-900">Helpdesk &amp; Support</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Contact Cards & FAQs */}
          <div className="lg:col-span-6 space-y-4">
            {/* Contact cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-pink-50/50 border border-pink-100">
                <Mail className="w-4 h-4 text-[#c0166a] mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-500 mb-0.5">Email Support</p>
                  <p className="text-[13px] font-bold text-gray-900 truncate">support@dermai.ph</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Replies within 24 hours on business days</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-pink-50/50 border border-pink-100">
                <Phone className="w-4 h-4 text-[#c0166a] mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-500 mb-0.5">Phone Support</p>
                  <p className="text-[13px] font-bold text-gray-900">(032) 888-3472</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Mon – Fri, 8:00 AM – 5:00 PM</p>
                </div>
              </div>
            </div>

            {/* FAQ */}
            <div className="space-y-2 pt-1">
              <h3 className="text-[13px] font-bold text-gray-900">Frequently Asked Questions</h3>
              <div className="space-y-1.5">
                {faqs.map((faq, i) => (
                  <div key={i} className="border border-gray-200/80 rounded-xl overflow-hidden bg-white">
                    <button
                      type="button"
                      onClick={() => setOpenFaq(openFaq === i ? null : i)}
                      className="w-full flex items-center justify-between px-3.5 py-2.5 text-left text-[13px] font-bold text-gray-800 hover:bg-gray-50/70 transition-colors cursor-pointer"
                    >
                      <span>{faq.q}</span>
                      {openFaq === i ? (
                        <ChevronUp className="w-3.5 h-3.5 text-gray-400 shrink-0 ml-2" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0 ml-2" />
                      )}
                    </button>
                    {openFaq === i && (
                      <div className="px-3.5 pb-3 text-[13px] text-gray-600 bg-gray-50/50 leading-relaxed border-t border-gray-100 pt-2">
                        {faq.a}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Submit a Support Ticket */}
          <div className="lg:col-span-6 space-y-3.5 p-5 rounded-2xl bg-gray-50/60 border border-gray-200/80">
            <div>
              <h3 className="text-[13px] font-bold text-gray-900">Submit a Support Ticket</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Need assistance? Send our support team a direct message.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[13px] font-semibold text-gray-700 mb-1">Subject</label>
                <input
                  type="text"
                  value={ticketSubject}
                  onChange={(e) => {
                    setTicketSubject(e.target.value);
                    setTicketError(null);
                  }}
                  placeholder="e.g. Unable to update clinic profile"
                  className="w-full px-3.5 py-2 rounded-xl border border-gray-200 bg-white text-[13px] font-medium text-gray-900 outline-none focus:border-magenta-500 focus:ring-1 focus:ring-magenta-500"
                />
              </div>

              <div>
                <label className="block text-[13px] font-semibold text-gray-700 mb-1">Message</label>
                <textarea
                  value={ticketMessage}
                  onChange={(e) => {
                    setTicketMessage(e.target.value);
                    setTicketError(null);
                  }}
                  rows={4}
                  placeholder="Describe your issue or concern in detail..."
                  className="w-full px-3.5 py-2 rounded-xl border border-gray-200 bg-white text-[13px] font-medium text-gray-900 outline-none focus:border-magenta-500 focus:ring-1 focus:ring-magenta-500 resize-none"
                />
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={submitTicket}
                  disabled={ticketSubmitting || !ticketSubject.trim() || !ticketMessage.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#c0166a] hover:bg-[#a01258] text-white text-xs font-bold transition-all shadow-xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  {ticketSubmitting ? "Submitting..." : "Send Ticket"}
                </button>
                {ticketSent && (
                  <span className="text-[13px] text-emerald-600 font-semibold">
                    Ticket submitted! We&apos;ll be in touch soon.
                  </span>
                )}
                {ticketError && (
                  <span role="alert" className="text-[13px] text-red-600 font-medium">
                    {ticketError}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
