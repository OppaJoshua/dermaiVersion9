import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
    Search,
    MapPin,
    Phone,
    Clock,
    CheckCircle2,
    ChevronDown,
    Calendar,
    X,
    Stethoscope,
    Bookmark,
    BookmarkCheck,
    Building2,
    Loader2,
    ChevronLeft,
    List,
    RotateCcw,
    Images,
    Maximize2,
    Sparkles,
    ArrowUpDown,
    Locate,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAuth } from "@/context/AuthContext";

// Calculate geographical distance in kilometers using Haversine formula
function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 10) / 10;
}

// Flies the map to the target coordinates whenever they change
const FlyToController = ({ target }: {
    target: [number, number] | null;
}) => {
    const map = useMap();
    useEffect(() => {
        if (target && !isNaN(target[0]) && !isNaN(target[1])) {
            map.flyTo(target, 14, { duration: 1 });
        }
    }, [map, target]);
    return null;
};

// Magenta pin icon for clinic markers
const createMagentaPin = () => {
    const svgString = `
    <svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 0C9.37 0 4 5.37 4 12c0 7 11 26 12 28c1-2 12-21 12-28c0-6.63-5.37-12-12-12z" fill="#A0195A" stroke="#600F35" stroke-width="1"/>
      <circle cx="16" cy="12" r="3.5" fill="white"/>
    </svg>
  `;
    return L.icon({
        iconUrl: `data:image/svg+xml;base64,${btoa(svgString)}`,
        iconSize: [32, 40],
        iconAnchor: [16, 40],
        popupAnchor: [0, -40],
    });
};
const magentaPinIcon = createMagentaPin();
L.Marker.prototype.options.icon = magentaPinIcon;

// User GPS Location Pin Icon
const createUserLocationPin = () => {
    const svgString = `
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="17" cy="17" r="16" fill="#3B82F6" fill-opacity="0.2" stroke="#2563EB" stroke-width="1.5" stroke-dasharray="2 2"/>
      <circle cx="17" cy="17" r="7" fill="#2563EB" stroke="white" stroke-width="2"/>
      <circle cx="17" cy="17" r="2.5" fill="white"/>
    </svg>
  `;
    return L.icon({
        iconUrl: `data:image/svg+xml;base64,${btoa(svgString)}`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
        popupAnchor: [0, -17],
    });
};
const userLocationPinIcon = createUserLocationPin();

export type ClinicItem = {
    id: string;
    name: string;
    logo: string;
    address: string;
    phone: string;
    facebook: string;
    hours: string;
    verified: boolean;
    district: string;
    lat: number | null;
    lng: number | null;
    doctors: Array<{ name: string; specialization: string }>;
    conditionsTreated: string[];
    consultationFee: string;
    description: string;
    photos: string[];
};

// Fallback coordinates for common Philippine districts if exact lat/lng are pending
const DISTRICT_COORDINATES: Record<string, [number, number]> = {
    "cebu": [10.3157, 123.8854],
    "cebu city": [10.3157, 123.8854],
    "mandaue": [10.3346, 123.9400],
    "mandaue city": [10.3346, 123.9400],
    "lapu-lapu": [10.3103, 123.9494],
    "lapu-lapu city": [10.3103, 123.9494],
    "talisay": [10.2447, 123.8494],
    "talisay city": [10.2447, 123.8494],
    "consolacion": [10.3758, 123.9575],
    "iloilo": [10.7202, 122.5621],
    "iloilo city": [10.7202, 122.5621],
    "manila": [14.5995, 120.9842],
    "metro manila": [14.5995, 120.9842],
    "quezon city": [14.6760, 121.0437],
    "makati": [14.5547, 121.0244],
    "taguig": [14.5176, 121.0509],
    "bgc": [14.5507, 121.0465],
    "pasig": [14.5764, 121.0851],
    "mandaluyong": [14.5794, 121.0359],
    "davao": [7.1907, 125.4553],
    "davao city": [7.1907, 125.4553],
    "baguio": [16.4023, 120.5960],
    "cagayan de oro": [8.4542, 124.6319],
};

function resolveDistrictCoords(districtOrAddress: string): [number, number] | null {
    if (!districtOrAddress) return null;
    const lower = districtOrAddress.toLowerCase();
    for (const [key, coords] of Object.entries(DISTRICT_COORDINATES)) {
        if (lower.includes(key)) return coords;
    }
    return null;
}

function formatTime12h(timeStr: string): string {
    if (!timeStr) return "";
    const [h, m] = timeStr.split(":").map(Number);
    const ampm = (h || 0) >= 12 ? "PM" : "AM";
    const hour = (h || 0) % 12 || 12;
    return `${hour}:${String(m || 0).padStart(2, "0")} ${ampm}`;
}

// Synonyms dictionary for smart AI condition matching
const CONDITION_SYNONYMS: Record<string, string[]> = {
    "melasma": ["melasma", "pigmentation", "hyperpigmentation", "dark spots", "skin lightening", "chemical peel", "laser", "bleaching", "cosmetic dermatology", "general dermatology"],
    "acne": ["acne", "pimples", "blackheads", "whiteheads", "breakouts", "acne scar", "extraction", "comedone", "general dermatology"],
    "acne vulgaris": ["acne", "pimples", "blackheads", "breakouts", "acne scar", "general dermatology"],
    "atopic dermatitis": ["atopic dermatitis", "eczema", "dermatitis", "skin allergy", "itch", "rash", "dry skin", "general dermatology"],
    "eczema": ["eczema", "atopic dermatitis", "dermatitis", "skin allergy", "itch", "rash", "dry skin", "general dermatology"],
    "psoriasis": ["psoriasis", "scalp psoriasis", "plaque", "scaling", "autoimmune skin", "general dermatology"],
    "rosacea": ["rosacea", "redness", "erythema", "facial flushing", "vascular", "general dermatology"],
    "tinea": ["fungal", "ringworm", "tinea", "infection", "anti-fungal", "general dermatology"],
    "vitiligo": ["vitiligo", "depigmentation", "white spots", "phototherapy", "general dermatology"],
    "alopecia": ["hair loss", "alopecia", "scalp", "trichology", "general dermatology"],
};

export function clinicTreatsCondition(clinic: ClinicItem, condition: string): boolean {
    if (!condition || condition === "Assessment Queued") return true;
    const condLower = condition.toLowerCase().trim();
    const synonyms = CONDITION_SYNONYMS[condLower] || [condLower, "general dermatology"];

    const allClinicText = [
        clinic.name,
        clinic.description,
        ...(clinic.conditionsTreated || []),
        ...(clinic.doctors || []).map((d) => `${d.name} ${d.specialization}`),
    ].join(" ").toLowerCase();

    return synonyms.some((syn) => allClinicText.includes(syn));
}

function parseNumericFee(feeStr: string | null | undefined): number {
    if (!feeStr) return 500;
    const num = parseFloat(String(feeStr).replace(/[^0-9.]/g, ""));
    return isNaN(num) ? 500 : num;
}

function isClinicOpenToday(hoursStr: string): boolean {
    if (!hoursStr) return true;
    const lower = hoursStr.toLowerCase();
    const now = new Date();
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const shortDays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const currentDay = days[now.getDay()];
    const currentShort = shortDays[now.getDay()];

    if (lower.includes("daily") || lower.includes("every day") || lower.includes("everyday")) return true;
    if (lower.includes(currentDay) || lower.includes(currentShort)) return true;
    if (lower.includes("mon - sat") || lower.includes("monday - saturday") || lower.includes("monday-saturday")) {
        return now.getDay() >= 1 && now.getDay() <= 6;
    }
    if (lower.includes("mon - fri") || lower.includes("monday - friday") || lower.includes("monday-friday")) {
        return now.getDay() >= 1 && now.getDay() <= 5;
    }
    return true;
}

function mapRawClinicToItem(
    c: any,
    doctorsMap?: Map<string, any[]>,
    servicesMap?: Map<string, string[]>,
    hoursMap?: Map<string, any[]>,
    photosMap?: Map<string, string[]>
): ClinicItem {
    const clinicId = String(c.clinic_id || c.id);

    // Operating hours
    let hoursStr = "";
    const hoursList = c.clinic_operating_hours || (hoursMap ? hoursMap.get(clinicId) : null);
    if (Array.isArray(hoursList) && hoursList.length > 0) {
        const h = hoursList[0];
        const open = h.open_time ? formatTime12h(h.open_time) : "8:00 AM";
        const close = h.close_time ? formatTime12h(h.close_time) : "5:00 PM";
        hoursStr = `${h.day_of_week || "Monday - Saturday"}: ${open} – ${close}`.trim();
    } else if (c.operating_days || c.operatingDays) {
        const open = c.open_time || c.openTime ? formatTime12h(c.open_time || c.openTime) : "8:00 AM";
        const close = c.close_time || c.closeTime ? formatTime12h(c.close_time || c.closeTime) : "5:00 PM";
        hoursStr = `${c.operating_days || c.operatingDays}: ${open} – ${close}`;
    }

    // Doctors
    let docList: Array<{ name: string; specialization: string }> = [];
    const rawDocs = c.clinic_doctor || (doctorsMap ? doctorsMap.get(clinicId) : null);
    if (Array.isArray(rawDocs) && rawDocs.length > 0) {
        docList = rawDocs
            .filter((d: any) => d.status !== "inactive" && (d.doctor_name || d.name))
            .map((d: any) => {
                const specFromJunction = Array.isArray(d.doctor_specializations)
                    ? d.doctor_specializations.map((ds: any) => ds.specializations?.name || ds.specialization?.name).filter(Boolean).join(", ")
                    : "";
                return {
                    name: d.doctor_name || d.name,
                    specialization: specFromJunction || d.specialization || c.specialization || "General Dermatology",
                };
            });
    } else if (c.doctor || c.doctor_name) {
        docList = [{
            name: c.doctor || c.doctor_name,
            specialization: c.specialization || "General Dermatology",
        }];
    }

    // Services
    let services: string[] = [];
    const rawServices = c.clinic_service_offered || (servicesMap ? servicesMap.get(clinicId) : null);
    if (Array.isArray(rawServices)) {
        services = rawServices
            .map((s: any) => (typeof s === "string" ? s : s.service_name))
            .filter(Boolean);
    } else if (Array.isArray(c.services)) {
        services = c.services;
    } else if (typeof c.servicesOffered === "string" && c.servicesOffered) {
        services = c.servicesOffered.split(",").map((s: string) => s.trim()).filter(Boolean);
    }

    // Gallery Photos
    let photosList: string[] = [];
    const rawPhotos = c.clinic_photo || (photosMap ? photosMap.get(clinicId) : null);
    if (Array.isArray(rawPhotos) && rawPhotos.length > 0) {
        photosList = rawPhotos
            .map((p: any) => (typeof p === "string" ? p : p?.photo_url))
            .filter(Boolean);
    } else if (Array.isArray(c.photos) && c.photos.length > 0) {
        photosList = c.photos.filter(Boolean);
    } else if (Array.isArray(c.clinicPhotos) && c.clinicPhotos.length > 0) {
        photosList = c.clinicPhotos.filter(Boolean);
    }

    if (photosList.length === 0) {
        try {
            const appsRaw = localStorage.getItem("dermai_clinic_applications");
            if (appsRaw) {
                const apps = JSON.parse(appsRaw);
                if (Array.isArray(apps)) {
                    const matchedApp = apps.find((a: any) =>
                        String(a.id) === clinicId ||
                        (a.email && c.email && a.email.toLowerCase().trim() === c.email.toLowerCase().trim()) ||
                        (a.name && c.name && a.name.toLowerCase().trim() === c.name.toLowerCase().trim())
                    );
                    if (Array.isArray(matchedApp?.clinicPhotos) && matchedApp.clinicPhotos.length > 0) {
                        photosList = matchedApp.clinicPhotos.filter(Boolean);
                    } else if (Array.isArray(matchedApp?.photos) && matchedApp.photos.length > 0) {
                        photosList = matchedApp.photos.filter(Boolean);
                    }
                }
            }
        } catch { }
    }

    // Coordinates with district fallback
    const rawLat = c.latitude != null ? Number(c.latitude) : c.lat != null ? Number(c.lat) : null;
    const rawLng = c.longitude != null ? Number(c.longitude) : c.lng != null ? Number(c.lng) : null;
    const fallbackCoords = resolveDistrictCoords((c.district || c.address || c.location || ""));

    const lat = rawLat && !isNaN(rawLat) && rawLat !== 0 ? rawLat : fallbackCoords ? fallbackCoords[0] : null;
    const lng = rawLng && !isNaN(rawLng) && rawLng !== 0 ? rawLng : fallbackCoords ? fallbackCoords[1] : null;

    const status = String(c.status || "").toLowerCase();
    const isVerified = status === "approved" || status === "verified";

    let desc = (c.description || c.about || c.bio || c.overview || "").trim();
    let feeStr = c.consultation_fee != null && c.consultation_fee !== ""
        ? String(c.consultation_fee)
        : c.consultationFee != null && c.consultationFee !== ""
            ? String(c.consultationFee)
            : "500";
    let clinicAddress = c.address || c.location || c.district || "";
    let clinicDistrict = c.district || c.location || "Cebu City";
    let clinicPhone = c.phone || "";

    let logoUrl = (c.logo_url || c.logo || (Array.isArray(c.clinic_photo) && c.clinic_photo[0]?.photo_url) || "").trim();
    if (!logoUrl) {
        try {
            const appsRaw = localStorage.getItem("dermai_clinic_applications");
            if (appsRaw) {
                const apps = JSON.parse(appsRaw);
                if (Array.isArray(apps)) {
                    const matchedApp = apps.find((a: any) =>
                        String(a.id) === clinicId ||
                        (a.email && c.email && a.email.toLowerCase().trim() === c.email.toLowerCase().trim()) ||
                        (a.name && c.name && a.name.toLowerCase().trim() === c.name.toLowerCase().trim())
                    );
                    if (matchedApp?.logo) {
                        logoUrl = matchedApp.logo;
                    }
                }
            }
        } catch { }
    }

    // Merge with real-time clinic settings if modified in settings panel
    try {
        const settRaw = localStorage.getItem("dermai_clinic_settings");
        if (settRaw) {
            const sett = JSON.parse(settRaw);
            const isMatch = (sett.id && String(sett.id) === clinicId) ||
                (sett.name && c.name && sett.name.toLowerCase().trim() === c.name.toLowerCase().trim()) ||
                (sett.email && c.email && sett.email.toLowerCase().trim() === c.email.toLowerCase().trim());
            if (isMatch) {
                if (sett.operatingDays || sett.openTime || sett.closeTime) {
                    const oDays = sett.operatingDays || "Monday - Saturday";
                    const oOpen = sett.openTime ? formatTime12h(sett.openTime) : "8:00 AM";
                    const oClose = sett.closeTime ? formatTime12h(sett.closeTime) : "5:00 PM";
                    hoursStr = `${oDays}: ${oOpen} – ${oClose}`;
                }
                if (sett.consultationFee) {
                    feeStr = String(sett.consultationFee);
                }
                if (sett.address) clinicAddress = sett.address;
                if (sett.location) clinicDistrict = sett.location;
                if (sett.phone) clinicPhone = sett.phone;
                if (sett.description) desc = sett.description;
                if (sett.logo) logoUrl = sett.logo;
            }
        }
    } catch { }

    return {
        id: clinicId,
        name: (c.name || "Clinic").trim(),
        logo: logoUrl,
        address: clinicAddress,
        phone: clinicPhone,
        facebook: c.facebook || "",
        hours: hoursStr,
        verified: isVerified,
        district: clinicDistrict,
        lat,
        lng,
        doctors: docList,
        conditionsTreated: services,
        consultationFee: feeStr,
        description: desc,
        photos: photosList,
    };
}

function getInitialFindClinics(): ClinicItem[] {
    try {
        const cachedFind = localStorage.getItem("dermai_cached_find_clinics");
        if (cachedFind) {
            const parsed = JSON.parse(cachedFind);
            if (Array.isArray(parsed)) return parsed;
        }
    } catch { }
    return [];
}

const COMMON_CONDITIONS = [
    "Melasma",
    "Acne",
    "Atopic Dermatitis",
    "Psoriasis",
    "Rosacea",
    "Eczema",
];

export default function FindClinicsPage() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { session: _session } = useAuth();

    // AI condition detection from URL params or local scan storage
    const [aiCondition, setAiCondition] = useState<string>(() => {
        const param = searchParams.get("condition") || searchParams.get("ai_condition");
        if (param && param !== "Assessment Queued") return param;
        try {
            const saved = localStorage.getItem("dermai_last_scan");
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.predictedClass && parsed.predictedClass !== "Assessment Queued") {
                    return parsed.predictedClass;
                }
            }
        } catch { }
        return "";
    });

    // Filters & Sorting state
    const [filterByCondition, setFilterByCondition] = useState<boolean>(() => {
        const param = searchParams.get("condition") || searchParams.get("ai_condition");
        return !!param;
    });
    const [sortBy, setSortBy] = useState<"recommended" | "distance" | "fee_asc" | "fee_desc" | "name">("recommended");
    const [maxPrice, setMaxPrice] = useState<number | null>(null);
    const [pricePopoverOpen, setPricePopoverOpen] = useState<boolean>(false);
    const pricePopoverRef = useRef<HTMLDivElement>(null);
    const [openTodayOnly, setOpenTodayOnly] = useState<boolean>(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedDistrict, setSelectedDistrict] = useState("All Districts");

    // Close price popover when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (pricePopoverRef.current && !pricePopoverRef.current.contains(e.target as Node)) {
                setPricePopoverOpen(false);
            }
        };
        if (pricePopoverOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [pricePopoverOpen]);

    // Geolocation state
    const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
    const [locatingUser, setLocatingUser] = useState<boolean>(false);
    const [locationNotice, setLocationNotice] = useState<string | null>(null);

    // Navigation & Map state
    const [selectedClinic, setSelectedClinic] = useState<ClinicItem | null>(null);
    const [activePhotoIdx, setActivePhotoIdx] = useState<number>(0);
    const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
    const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
    const [activeClinicId, setActiveClinicId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"all" | "saved">("all");
    const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
    const mapRef = useRef<HTMLDivElement>(null);

    const [dbClinics, setDbClinics] = useState<ClinicItem[]>(getInitialFindClinics);
    const [loading, setLoading] = useState(() => getInitialFindClinics().length === 0);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [savedClinicIds, setSavedClinicIds] = useState<string[]>([]);

    // Auto-select or restore clinic from URL query or sessionStorage (e.g. when navigating Back from appointment)
    useEffect(() => {
        const targetClinicId = searchParams.get("clinic") || sessionStorage.getItem("dermai_selected_clinic_id");
        if (!targetClinicId || dbClinics.length === 0) return;

        if (!selectedClinic || String(selectedClinic.id) !== String(targetClinicId)) {
            const match = dbClinics.find((c) => String(c.id) === String(targetClinicId));
            if (match) {
                setSelectedClinic(match);
                setActiveClinicId(match.id);
                setActivePhotoIdx(0);
                if (match.lat !== null && match.lng !== null) {
                    setFlyTarget([match.lat, match.lng]);
                }
            }
        }
    }, [searchParams, dbClinics]);

    // Check user auth and load saved clinics
    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
                setCurrentUserId(session.user.id);
                supabase
                    .from("user_saved_clinic")
                    .select("clinic_id")
                    .eq("user_id", session.user.id)
                    .then(({ data }) => {
                        if (data && data.length > 0) {
                            setSavedClinicIds(data.map((d: any) => String(d.clinic_id)));
                        }
                    });
            }
        });
    }, []);

    // Geolocation trigger
    const handleLocateUser = () => {
        if (!navigator.geolocation) {
            setLocationNotice("Geolocation is not supported by your browser");
            return;
        }
        setLocatingUser(true);
        setLocationNotice(null);

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                setUserLocation({ lat, lng });
                setFlyTarget([lat, lng]);
                setLocatingUser(false);
                setSortBy("distance");
                setLocationNotice("📍 Location active: Showing nearest clinics");
                setTimeout(() => setLocationNotice(null), 3500);
            },
            (err) => {
                console.warn("Geolocation permission error:", err);
                setLocatingUser(false);
                setUserLocation({ lat: 10.3157, lng: 123.8854 });
                setSortBy("distance");
                setLocationNotice("Using Cebu City center as reference");
                setTimeout(() => setLocationNotice(null), 3500);
            },
            { timeout: 10000, enableHighAccuracy: true }
        );
    };

    const toggleSave = async (e: React.MouseEvent, clinicId: string) => {
        e.stopPropagation();
        if (!currentUserId) {
            navigate("/login", { state: { from: "/find-clinics" } });
            return;
        }
        const isSaved = savedClinicIds.includes(clinicId);
        if (isSaved) {
            setSavedClinicIds((prev) => prev.filter((id) => id !== clinicId));
            try {
                await supabase
                    .from("user_saved_clinic")
                    .delete()
                    .match({ user_id: currentUserId, clinic_id: clinicId });
            } catch { }
        } else {
            setSavedClinicIds((prev) => [...prev, clinicId]);
            try {
                await supabase
                    .from("user_saved_clinic")
                    .insert({ user_id: currentUserId, clinic_id: clinicId });
            } catch { }
        }
    };

    // Load clinics from live Supabase
    const fetchClinics = async () => {
        try {
            let mappedClinics: ClinicItem[] = [];
            const { data: nestedData, error: nestedError } = await supabase
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
                    latitude,
                    longitude,
                    consultation_fee,
                    description,
                    clinic_photo (
                        photo_url,
                        sort_order
                    ),
                    clinic_service_offered (
                        service_name
                    ),
                    clinic_operating_hours (
                        day_of_week,
                        open_time,
                        close_time
                    ),
                    clinic_doctor (
                        doctor_name,
                        prc_license,
                        photo_url,
                        status,
                        doctor_specializations (
                            specializations ( name )
                        )
                    )
                `)
                .or("status.eq.approved,status.eq.verified");

            if (!nestedError && nestedData && nestedData.length > 0) {
                mappedClinics = nestedData.map((c: any) => mapRawClinicToItem(c));
            } else {
                const { data: clinicRows, error: clinicErr } = await supabase
                    .from("clinic")
                    .select("clinic_id, name, logo_url, district, address, phone, email, status, latitude, longitude, consultation_fee, description")
                    .or("status.eq.approved,status.eq.verified");

                if (!clinicErr && clinicRows && clinicRows.length > 0) {
                    const clinicIds = clinicRows.map((c: any) => c.clinic_id);
                    const doctorsMap = new Map<string, any[]>();
                    const servicesMap = new Map<string, string[]>();
                    const hoursMap = new Map<string, any[]>();
                    const photosMap = new Map<string, string[]>();

                    const [docRes, srvRes, hrsRes, photoRes] = await Promise.allSettled([
                        supabase.from("clinic_doctor").select("*").in("clinic_id", clinicIds),
                        supabase.from("clinic_service_offered").select("*").in("clinic_id", clinicIds),
                        supabase.from("clinic_operating_hours").select("*").in("clinic_id", clinicIds),
                        supabase.from("clinic_photo").select("*").in("clinic_id", clinicIds).order("sort_order"),
                    ]);

                    if (docRes.status === "fulfilled" && docRes.value.data) {
                        docRes.value.data.forEach((d: any) => {
                            const cid = String(d.clinic_id);
                            if (!doctorsMap.has(cid)) doctorsMap.set(cid, []);
                            doctorsMap.get(cid)!.push(d);
                        });
                    }
                    if (srvRes.status === "fulfilled" && srvRes.value.data) {
                        srvRes.value.data.forEach((s: any) => {
                            const cid = String(s.clinic_id);
                            if (!servicesMap.has(cid)) servicesMap.set(cid, []);
                            if (s.service_name) servicesMap.get(cid)!.push(s.service_name);
                        });
                    }
                    if (hrsRes.status === "fulfilled" && hrsRes.value.data) {
                        hrsRes.value.data.forEach((h: any) => {
                            const cid = String(h.clinic_id);
                            if (!hoursMap.has(cid)) hoursMap.set(cid, []);
                            hoursMap.get(cid)!.push(h);
                        });
                    }
                    if (photoRes.status === "fulfilled" && photoRes.value.data) {
                        photoRes.value.data.forEach((p: any) => {
                            const cid = String(p.clinic_id);
                            if (!photosMap.has(cid)) photosMap.set(cid, []);
                            if (p.photo_url) photosMap.get(cid)!.push(p.photo_url);
                        });
                    }

                    mappedClinics = clinicRows.map((c: any) =>
                        mapRawClinicToItem(c, doctorsMap, servicesMap, hoursMap, photosMap)
                    );
                }
            }

            setDbClinics(mappedClinics);
            try {
                localStorage.setItem("dermai_cached_find_clinics", JSON.stringify(mappedClinics));
            } catch { }
        } catch (err) {
            console.warn("Error loading clinics for FindClinicsPage:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchClinics();

        const channel = supabase
            .channel("public:find_clinics_realtime")
            .on("postgres_changes", { event: "*", schema: "public", table: "clinic" }, () => {
                fetchClinics();
            })
            .subscribe();

        const handleSync = () => fetchClinics();
        window.addEventListener("storage", handleSync);
        window.addEventListener("clinicRegistered", handleSync);
        window.addEventListener("clinicStatusUpdated", handleSync);
        window.addEventListener("clinicSettingsUpdated", handleSync);
        window.addEventListener("dermai_clinic_updated", handleSync);

        return () => {
            supabase.removeChannel(channel);
            window.removeEventListener("storage", handleSync);
            window.removeEventListener("clinicRegistered", handleSync);
            window.removeEventListener("clinicStatusUpdated", handleSync);
            window.removeEventListener("clinicSettingsUpdated", handleSync);
            window.removeEventListener("dermai_clinic_updated", handleSync);
        };
    }, []);

    // Derived districts list
    const districts = useMemo(() => {
        const set = new Set<string>();
        dbClinics.forEach((c) => {
            if (c.district && c.district.trim()) {
                set.add(c.district.trim());
            }
        });
        return ["All Districts", ...Array.from(set).sort()];
    }, [dbClinics]);

    // Enhanced processed clinics
    const processedClinics = useMemo(() => {
        const enriched = dbClinics.map((clinic) => {
            let distanceKm: number | null = null;
            const refLat = userLocation?.lat ?? null;
            const refLng = userLocation?.lng ?? null;

            if (refLat !== null && refLng !== null && clinic.lat !== null && clinic.lng !== null) {
                distanceKm = calculateDistanceKm(refLat, refLng, clinic.lat, clinic.lng);
            }

            const treatsAiCondition = aiCondition ? clinicTreatsCondition(clinic, aiCondition) : false;
            const numericFee = parseNumericFee(clinic.consultationFee);
            const isOpenToday = isClinicOpenToday(clinic.hours);

            return {
                ...clinic,
                distanceKm,
                treatsAiCondition,
                numericFee,
                isOpenToday,
            };
        });

        const filtered = enriched.filter((clinic) => {
            const q = searchQuery.toLowerCase().trim();
            const matchesSearch =
                !q ||
                clinic.name.toLowerCase().includes(q) ||
                clinic.address.toLowerCase().includes(q) ||
                clinic.doctors.some((doc) => doc.name.toLowerCase().includes(q) || doc.specialization.toLowerCase().includes(q)) ||
                clinic.conditionsTreated.some((cond) => cond.toLowerCase().includes(q)) ||
                clinic.description.toLowerCase().includes(q);

            const matchesDistrict = selectedDistrict === "All Districts" || clinic.district === selectedDistrict;
            const matchesTab = activeTab === "all" || savedClinicIds.includes(clinic.id);
            const matchesCondition = !filterByCondition || !aiCondition || clinic.treatsAiCondition;
            const matchesPrice = maxPrice === null || clinic.numericFee <= maxPrice;
            const matchesOpen = !openTodayOnly || clinic.isOpenToday;

            return matchesSearch && matchesDistrict && matchesTab && matchesCondition && matchesPrice && matchesOpen;
        });

        return filtered.sort((a, b) => {
            if (sortBy === "distance") {
                if (a.distanceKm === null && b.distanceKm === null) return 0;
                if (a.distanceKm === null) return 1;
                if (b.distanceKm === null) return -1;
                return a.distanceKm - b.distanceKm;
            }
            if (sortBy === "fee_asc") {
                return a.numericFee - b.numericFee;
            }
            if (sortBy === "fee_desc") {
                return b.numericFee - a.numericFee;
            }
            if (sortBy === "name") {
                return a.name.localeCompare(b.name);
            }
            // Default "recommended": Best overall match
            if (aiCondition) {
                if (a.treatsAiCondition && !b.treatsAiCondition) return -1;
                if (!a.treatsAiCondition && b.treatsAiCondition) return 1;
            }
            if (a.distanceKm !== null && b.distanceKm !== null) {
                return a.distanceKm - b.distanceKm;
            }
            return a.numericFee - b.numericFee;
        });
    }, [
        dbClinics,
        userLocation,
        aiCondition,
        filterByCondition,
        searchQuery,
        selectedDistrict,
        activeTab,
        savedClinicIds,
        maxPrice,
        openTodayOnly,
        sortBy,
    ]);

    const mapMarkers = useMemo(() => {
        return processedClinics.filter(
            (c): c is typeof processedClinics[number] & { lat: number; lng: number } =>
                c.lat !== null && c.lng !== null && !isNaN(c.lat) && !isNaN(c.lng)
        );
    }, [processedClinics]);

    const handleCloseClinicModal = () => {
        setSelectedClinic(null);
        setLightboxPhoto(null);
        sessionStorage.removeItem("dermai_selected_clinic_id");
        if (searchParams.get("clinic")) {
            setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete("clinic");
                return next;
            }, { replace: true });
        }
    };

    const openClinicDetails = (clinic: ClinicItem) => {
        setSelectedClinic(clinic);
        setActiveClinicId(clinic.id);
        setActivePhotoIdx(0);
        setLightboxPhoto(null);
        sessionStorage.setItem("dermai_selected_clinic_id", String(clinic.id));
        if (clinic.lat !== null && clinic.lng !== null) {
            setFlyTarget([clinic.lat, clinic.lng]);
        }
    };

    const goToAppointment = (clinicId: string) => {
        sessionStorage.setItem("dermai_selected_clinic_id", String(clinicId));
        const condParam = aiCondition ? `&condition=${encodeURIComponent(aiCondition)}` : "";
        if (!currentUserId) {
            navigate("/login", { state: { from: `/dashboard/appointment?clinic=${clinicId}${condParam}` } });
            return;
        }
        navigate(`/dashboard/appointment?clinic=${clinicId}${condParam}`);
    };

    const hasActiveFilters = !!aiCondition || maxPrice !== null || openTodayOnly || selectedDistrict !== "All Districts" || sortBy !== "recommended";

    const resetAllFilters = () => {
        setSearchQuery("");
        setSelectedDistrict("All Districts");
        setActiveTab("all");
        setMaxPrice(null);
        setOpenTodayOnly(false);
        setFilterByCondition(false);
        setAiCondition("");
        setSortBy("recommended");
    };

    return (
        <div className="relative w-full h-[calc(100vh-4rem)] min-h-[600px] overflow-hidden bg-slate-50 flex">
            {/* ── Ultra-Minimal Clinic Details Modal ────────────────────── */}
            <AnimatePresence>
                {selectedClinic && (
                    <motion.div
                        key="clinic-detail-modal"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-black/40 backdrop-blur-sm"
                        onClick={handleCloseClinicModal}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.96, y: 12 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96, y: 12 }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                            className="bg-white rounded-2xl border border-gray-200 w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden text-left"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Sticky Modal Header */}
                            <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between bg-white">
                                <div className="flex items-center gap-3.5 min-w-0">
                                    {selectedClinic.logo ? (
                                        <img
                                            src={selectedClinic.logo}
                                            alt={selectedClinic.name}
                                            className="w-12 h-12 rounded-xl object-cover border border-gray-100 shrink-0 bg-white"
                                        />
                                    ) : (
                                        <div className="w-12 h-12 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 text-gray-600">
                                            <Building2 className="w-6 h-6" />
                                        </div>
                                    )}
                                    <div className="space-y-0.5 min-w-0">
                                        <h2 className="text-lg font-bold text-gray-900 tracking-tight leading-snug truncate">
                                            {selectedClinic.name}
                                        </h2>
                                        <p className="text-[11px] font-medium text-gray-500 truncate">
                                            {selectedClinic.district || "Dermatology Clinic"}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-1 shrink-0 ml-3">
                                    <button
                                        type="button"
                                        onClick={(e) => toggleSave(e, selectedClinic.id)}
                                        className={cn(
                                            "p-2 rounded-xl transition-colors cursor-pointer",
                                            savedClinicIds.includes(selectedClinic.id)
                                                ? "bg-magenta-50 text-magenta-600"
                                                : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                                        )}
                                        title={savedClinicIds.includes(selectedClinic.id) ? "Unsave clinic" : "Save clinic"}
                                    >
                                        {savedClinicIds.includes(selectedClinic.id) ? (
                                            <BookmarkCheck className="w-4.5 h-4.5" />
                                        ) : (
                                            <Bookmark className="w-4.5 h-4.5" />
                                        )}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleCloseClinicModal}
                                        className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                                        title="Close"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>

                            {/* Scrollable Content */}
                            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                                <div>
                                    <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                                        About This Clinic
                                    </h4>
                                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 text-xs sm:text-sm text-gray-600 leading-relaxed font-normal">
                                        {selectedClinic.description ||
                                            "Specialized in advanced dermatological care, comprehensive skin assessments, acne, melasma management, and customized treatment plans."}
                                    </div>
                                </div>

                                {selectedClinic.photos && selectedClinic.photos.length > 0 && (
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                                                <Images className="w-3.5 h-3.5 text-gray-500" />
                                                Clinic Facilities &amp; Gallery
                                            </h4>
                                            <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                                                {selectedClinic.photos.length} {selectedClinic.photos.length === 1 ? "Photo" : "Photos"}
                                            </span>
                                        </div>

                                        <div className="relative group rounded-xl overflow-hidden border border-gray-200 bg-gray-900">
                                            <img
                                                src={selectedClinic.photos[Math.min(activePhotoIdx, selectedClinic.photos.length - 1)]}
                                                alt={`${selectedClinic.name} facility`}
                                                className="w-full h-44 sm:h-48 object-cover transition-transform duration-300 group-hover:scale-[1.02] cursor-pointer"
                                                onClick={() => setLightboxPhoto(selectedClinic.photos[Math.min(activePhotoIdx, selectedClinic.photos.length - 1)])}
                                            />
                                            <div
                                                onClick={() => setLightboxPhoto(selectedClinic.photos[Math.min(activePhotoIdx, selectedClinic.photos.length - 1)])}
                                                className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer pointer-events-auto"
                                            >
                                                <div className="px-3 py-1.5 rounded-full bg-white/95 backdrop-blur-md text-gray-900 text-xs font-semibold flex items-center gap-1.5 border border-gray-200">
                                                    <Maximize2 className="w-3.5 h-3.5 text-gray-700" />
                                                    <span>Click to Enlarge</span>
                                                </div>
                                            </div>

                                            <div className="absolute bottom-2.5 right-2.5 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-md text-white text-[11px] font-medium pointer-events-none">
                                                {Math.min(activePhotoIdx + 1, selectedClinic.photos.length)} / {selectedClinic.photos.length}
                                            </div>
                                        </div>

                                        {selectedClinic.photos.length > 1 && (
                                            <div className="flex items-center gap-2 mt-2.5 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                                                {selectedClinic.photos.map((imgUrl, idx) => (
                                                    <button
                                                        key={idx}
                                                        type="button"
                                                        onClick={() => setActivePhotoIdx(idx)}
                                                        className={cn(
                                                            "relative w-14 h-14 rounded-xl overflow-hidden shrink-0 border-2 transition-all cursor-pointer",
                                                            activePhotoIdx === idx
                                                                ? "border-magenta-500 scale-105"
                                                                : "border-gray-200 opacity-60 hover:opacity-100"
                                                        )}
                                                    >
                                                        <img
                                                            src={imgUrl}
                                                            alt={`Thumbnail ${idx + 1}`}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Contact & Hours Info Grid */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                    <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-100 flex items-start gap-2.5">
                                        <MapPin className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Address</p>
                                            <p className="text-xs font-medium text-gray-800 mt-0.5 truncate-2-lines">
                                                {selectedClinic.address || selectedClinic.district || "Cebu City, Philippines"}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-100 flex items-start gap-2.5">
                                        <Clock className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Hours</p>
                                            <p className="text-xs font-medium text-gray-800 mt-0.5">
                                                {selectedClinic.hours || "Mon - Sat: 8:00 AM - 5:00 PM"}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-100 flex items-start gap-2.5">
                                        <Phone className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Contact</p>
                                            <p className="text-xs font-medium text-gray-800 mt-0.5">
                                                {selectedClinic.phone || "Available upon booking"}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-100 flex items-start gap-2.5">
                                        <CheckCircle2 className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Consultation Fee</p>
                                            <p className="text-xs font-bold text-gray-900 mt-0.5">
                                                {selectedClinic.consultationFee && !isNaN(Number(selectedClinic.consultationFee)) && Number(selectedClinic.consultationFee) > 0
                                                    ? `Starts at ₱${Number(selectedClinic.consultationFee).toLocaleString()}`
                                                    : selectedClinic.consultationFee
                                                        ? `Starts at ₱${selectedClinic.consultationFee}`
                                                        : "Starts at ₱500"}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Attending Doctors */}
                                <div>
                                    <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                                        Attending Dermatologists
                                    </h4>
                                    {selectedClinic.doctors.length > 0 ? (
                                        <div className="space-y-2">
                                            {selectedClinic.doctors.map((doc, idx) => (
                                                <div key={idx} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                                                    <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 text-gray-700 flex items-center justify-center shrink-0">
                                                        <Stethoscope className="w-4 h-4 text-magenta-600" />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-xs font-bold text-gray-900 truncate">{doc.name}</p>
                                                        <p className="text-[11px] text-gray-500 truncate">{doc.specialization}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-gray-400 italic bg-gray-50 p-3 rounded-xl border border-gray-100">
                                            Board-certified specialists assigned per consultation schedule.
                                        </p>
                                    )}
                                </div>

                                {/* Services & Conditions Treated */}
                                <div>
                                    <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                                        Services &amp; Specializations
                                    </h4>
                                    {selectedClinic.conditionsTreated && selectedClinic.conditionsTreated.length > 0 ? (
                                        <div className="flex flex-wrap gap-1.5">
                                            {selectedClinic.conditionsTreated.map((srv, idx) => (
                                                <span
                                                    key={idx}
                                                    className="px-3 py-1 rounded-full bg-gray-50 text-gray-700 text-xs font-medium border border-gray-200/70"
                                                >
                                                    {srv}
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="flex flex-wrap gap-1.5">
                                            {["General Dermatology", "Acne Treatment", "Pigmentation & Melasma", "Skin Allergy Care"].map((srv, idx) => (
                                                <span
                                                    key={idx}
                                                    className="px-3 py-1 rounded-full bg-gray-50 text-gray-700 text-xs font-medium border border-gray-200/70"
                                                >
                                                    {srv}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Modal Footer CTA */}
                            <div className="p-4 sm:p-5 bg-white border-t border-gray-100 flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        const clinicId = selectedClinic.id;
                                        sessionStorage.setItem("dermai_selected_clinic_id", String(clinicId));
                                        setLightboxPhoto(null);
                                        goToAppointment(clinicId);
                                    }}
                                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-magenta-600 hover:bg-magenta-700 active:scale-[0.99] text-white text-xs sm:text-sm font-semibold transition-all cursor-pointer"
                                >
                                    <Calendar className="w-4 h-4" /> Book Appointment
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Fullscreen Photo Lightbox Modal ──────────────────────── */}
            <AnimatePresence>
                {lightboxPhoto && (
                    <motion.div
                        key="gallery-lightbox"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-md"
                        onClick={() => setLightboxPhoto(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.94, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.94, opacity: 0 }}
                            transition={{ duration: 0.18 }}
                            className="relative max-w-3xl max-h-[90vh] w-full flex flex-col items-center"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="relative w-full flex justify-center">
                                <img
                                    src={lightboxPhoto}
                                    alt="Clinic facility enlarged preview"
                                    className="max-w-full max-h-[82vh] rounded-2xl object-contain border border-white/20"
                                />
                                <button
                                    type="button"
                                    onClick={() => setLightboxPhoto(null)}
                                    className="absolute -top-3 -right-3 sm:top-3 sm:right-3 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white backdrop-blur-md border border-white/20 transition-all cursor-pointer"
                                    title="Close image preview"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── 1. Full Interactive Background Map ─────────────────── */}
            <div ref={mapRef} className="absolute inset-0 w-full h-full z-0">
                {React.createElement(
                    MapContainer as any,
                    {
                        center: [10.3157, 123.8854],
                        zoom: 12,
                        style: { height: "100%", width: "100%" },
                        zoomControl: false,
                        onClick: (e: any) => {
                            if (e.originalEvent?.target?.classList?.contains("leaflet-marker-icon")) {
                                return;
                            }
                        },
                    },
                    <>
                        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                        <FlyToController target={flyTarget} />

                        {/* User Location Marker */}
                        {userLocation && (
                            <Marker
                                position={[userLocation.lat, userLocation.lng] as L.LatLngExpression}
                                icon={userLocationPinIcon}
                            >
                                <Popup>
                                    <div className="p-1 text-center font-bold text-xs text-blue-600">
                                        📍 You Are Here
                                    </div>
                                </Popup>
                            </Marker>
                        )}

                        {/* Clinic Markers */}
                        {mapMarkers.map((clinic) => (
                            <Marker
                                key={clinic.id}
                                position={[clinic.lat, clinic.lng] as L.LatLngExpression}
                                eventHandlers={{
                                    click: (e: L.LeafletMouseEvent) => {
                                        e.originalEvent?.stopPropagation?.();
                                        openClinicDetails(clinic);
                                    },
                                } as any}
                            >
                                <Popup>
                                    <div className="min-w-[200px] p-1 text-left">
                                        <div className="flex items-center gap-2 mb-1.5">
                                            {clinic.logo ? (
                                                <img
                                                    src={clinic.logo}
                                                    alt={clinic.name}
                                                    className="w-8 h-8 rounded-lg object-cover border border-gray-100 shrink-0 bg-white"
                                                />
                                            ) : (
                                                <div className="w-8 h-8 rounded-lg bg-gray-50 text-gray-700 flex items-center justify-center shrink-0">
                                                    <Building2 className="w-4 h-4" />
                                                </div>
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <h4 className="font-bold text-gray-900 text-sm truncate">
                                                    {clinic.name}
                                                </h4>
                                                {clinic.distanceKm !== null && (
                                                    <p className="text-[10px] text-blue-600 font-semibold">
                                                        📍 {clinic.distanceKm} km away
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        {clinic.address && <p className="text-xs text-gray-600 mt-1 truncate">{clinic.address}</p>}

                                        <div className="mt-2.5 pt-2 border-t border-gray-100 flex gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => openClinicDetails(clinic)}
                                                className="flex-1 py-1 px-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-semibold text-center transition-colors cursor-pointer"
                                            >
                                                Details
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => goToAppointment(clinic.id)}
                                                className="flex-1 py-1 px-2 rounded-lg bg-magenta-600 hover:bg-magenta-700 text-white text-xs font-semibold text-center transition-colors cursor-pointer"
                                            >
                                                Book
                                            </button>
                                        </div>
                                    </div>
                                </Popup>
                            </Marker>
                        ))}
                    </>
                )}
            </div>

            {/* ── 2. Top Minimal Controls Bar (NO SHADOWS, FLAT & CLEAN) ── */}
            <div className="absolute top-3.5 left-3.5 right-3.5 sm:left-[395px] z-[450] flex flex-wrap items-center justify-between gap-1.5 pointer-events-none">
                {/* Left side of top bar: Condition, Filters & Sort */}
                <div className="flex items-center gap-1.5 flex-wrap max-w-full pointer-events-auto">
                    {/* Active AI Condition Pill */}
                    {aiCondition && (
                        <div className="bg-white border border-magenta-200 px-3 py-1.5 rounded-xl flex items-center gap-2 text-xs font-semibold text-magenta-900 shrink-0">
                            <Sparkles className="w-3.5 h-3.5 text-magenta-600" />
                            <span>Condition: <strong className="text-magenta-700">{aiCondition}</strong></span>
                            <button
                                type="button"
                                onClick={() => setFilterByCondition(!filterByCondition)}
                                className={cn(
                                    "px-2 py-0.5 rounded-lg text-[10px] font-bold cursor-pointer transition-colors",
                                    filterByCondition ? "bg-magenta-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                )}
                            >
                                {filterByCondition ? "Filtered" : "Filter"}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setAiCondition("");
                                    setFilterByCondition(false);
                                }}
                                className="text-gray-400 hover:text-gray-700 p-0.5 cursor-pointer"
                                title="Clear condition"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                    )}

                    {/* Condition Selector Dropdown (if no AI condition) */}
                    {!aiCondition && (
                        <div className="relative shrink-0">
                            <select
                                onChange={(e) => {
                                    if (e.target.value) {
                                        setAiCondition(e.target.value);
                                        setFilterByCondition(true);
                                    }
                                }}
                                defaultValue=""
                                className="appearance-none bg-white border border-gray-200 rounded-xl px-3 py-1.5 pr-7 text-xs font-medium text-gray-700 outline-none cursor-pointer hover:border-gray-300"
                            >
                                <option value="" disabled>Specialty Condition</option>
                                {COMMON_CONDITIONS.map((cond) => (
                                    <option key={cond} value={cond}>
                                        {cond}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                        </div>
                    )}

                    {/* District Dropdown (Compact, no stretch) */}
                    <div className="relative shrink-0">
                        <select
                            value={selectedDistrict}
                            onChange={(e) => setSelectedDistrict(e.target.value)}
                            className="appearance-none bg-white border border-gray-200 rounded-xl px-3 py-1.5 pr-7 text-xs font-medium text-gray-700 outline-none cursor-pointer hover:border-gray-300 max-w-[140px] truncate"
                        >
                            {districts.map((d) => (
                                <option key={d} value={d}>
                                    {d}
                                </option>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                    </div>

                    {/* Sort Dropdown */}
                    <div className="relative shrink-0">
                        <select
                            value={sortBy}
                            onChange={(e: any) => setSortBy(e.target.value)}
                            className="appearance-none bg-white border border-gray-200 rounded-xl px-3 py-1.5 pr-7 text-xs font-medium text-gray-700 outline-none cursor-pointer hover:border-gray-300"
                        >
                            <option value="recommended">Best Match</option>
                            <option value="distance">Nearest First</option>
                            <option value="fee_asc">Lowest Fee</option>
                            <option value="fee_desc">Highest Fee</option>
                            <option value="name">Name (A - Z)</option>
                        </select>
                        <ArrowUpDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                    </div>

                    {/* Price Filter (Interactive Popover with Custom Number Price & Presets) */}
                    <div className="relative shrink-0" ref={pricePopoverRef}>
                        <button
                            type="button"
                            onClick={() => setPricePopoverOpen(!pricePopoverOpen)}
                            className={cn(
                                "px-3 py-1.5 rounded-xl text-xs font-medium shrink-0 flex items-center gap-1.5 transition-all cursor-pointer border select-none",
                                maxPrice !== null
                                    ? "bg-magenta-50 text-magenta-900 border-magenta-300 font-semibold"
                                    : "bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                            )}
                        >
                            <span>{maxPrice !== null ? `≤ ₱${maxPrice.toLocaleString()}` : "Price"}</span>
                            {maxPrice !== null ? (
                                <span
                                    role="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setMaxPrice(null);
                                    }}
                                    className="p-0.5 hover:text-magenta-700 hover:bg-magenta-100 rounded-full cursor-pointer ml-0.5"
                                    title="Clear price filter"
                                >
                                    <X className="w-3 h-3" />
                                </span>
                            ) : (
                                <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                            )}
                        </button>

                        {pricePopoverOpen && (
                            <div className="absolute top-full mt-1.5 left-0 z-[600] w-64 bg-white rounded-xl border border-gray-200 p-3.5 space-y-3 pointer-events-auto">
                                <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                                    <span className="text-xs font-bold text-gray-900">Max Consultation Fee</span>
                                    {maxPrice !== null && (
                                        <button
                                            type="button"
                                            onClick={() => setMaxPrice(null)}
                                            className="text-[11px] font-semibold text-magenta-600 hover:text-magenta-800 cursor-pointer"
                                        >
                                            Reset
                                        </button>
                                    )}
                                </div>

                                {/* Quick Presets */}
                                <div>
                                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">
                                        Quick Presets
                                    </label>
                                    <div className="grid grid-cols-3 gap-1.5">
                                        {[300, 500, 800, 1000, 1500].map((price) => (
                                            <button
                                                key={price}
                                                type="button"
                                                onClick={() => {
                                                    setMaxPrice(price);
                                                }}
                                                className={cn(
                                                    "py-1 px-1.5 rounded-lg text-xs font-medium border text-center transition-all cursor-pointer",
                                                    maxPrice === price
                                                        ? "bg-magenta-600 text-white border-magenta-600 font-bold"
                                                        : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                                                )}
                                            >
                                                ≤ ₱{price}
                                            </button>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={() => setMaxPrice(null)}
                                            className={cn(
                                                "py-1 px-1.5 rounded-lg text-xs font-medium border text-center transition-all cursor-pointer",
                                                maxPrice === null
                                                    ? "bg-magenta-600 text-white border-magenta-600 font-bold"
                                                    : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                                            )}
                                        >
                                            Any
                                        </button>
                                    </div>
                                </div>

                                {/* Custom Number Input */}
                                <div>
                                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">
                                        Custom Max Price (₱)
                                    </label>
                                    <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 focus-within:bg-white focus-within:border-magenta-500">
                                        <span className="text-gray-400 text-xs font-semibold">₱</span>
                                        <input
                                            type="number"
                                            placeholder="Enter amount (e.g. 600)"
                                            value={maxPrice !== null ? maxPrice : ""}
                                            onChange={(e) => {
                                                const val = e.target.value.trim();
                                                if (val === "") {
                                                    setMaxPrice(null);
                                                } else {
                                                    const num = Number(val);
                                                    if (!isNaN(num) && num >= 0) setMaxPrice(num);
                                                }
                                            }}
                                            className="flex-1 bg-transparent text-xs font-medium text-gray-900 outline-none placeholder:text-gray-400"
                                        />
                                        {maxPrice !== null && (
                                            <button
                                                type="button"
                                                onClick={() => setMaxPrice(null)}
                                                className="p-0.5 text-gray-400 hover:text-gray-700 cursor-pointer"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => setPricePopoverOpen(false)}
                                    className="w-full py-1.5 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-800 transition-colors cursor-pointer"
                                >
                                    Done
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Open Today Toggle Chip */}
                    <button
                        type="button"
                        onClick={() => setOpenTodayOnly(!openTodayOnly)}
                        className={cn(
                            "px-3 py-1.5 rounded-xl text-xs font-medium shrink-0 flex items-center gap-1.5 transition-all cursor-pointer border",
                            openTodayOnly
                                ? "bg-amber-50 text-amber-800 border-amber-300"
                                : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                        )}
                    >
                        <Clock className="w-3.5 h-3.5 text-amber-600" />
                        <span>Open Today</span>
                    </button>

                    {/* Near Me Toggle */}
                    <button
                        type="button"
                        onClick={() => {
                            if (!userLocation) {
                                handleLocateUser();
                            } else {
                                setSortBy(sortBy === "distance" ? "recommended" : "distance");
                            }
                        }}
                        disabled={locatingUser}
                        className={cn(
                            "px-3 py-1.5 rounded-xl text-xs font-medium shrink-0 flex items-center gap-1.5 transition-all cursor-pointer border",
                            userLocation || sortBy === "distance"
                                ? "bg-blue-50 text-blue-700 border-blue-300"
                                : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                        )}
                    >
                        {locatingUser ? (
                            <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />
                        ) : (
                            <Locate className="w-3.5 h-3.5 text-blue-500" />
                        )}
                        <span>{locatingUser ? "Locating..." : userLocation ? "Near You Active" : "Near Me"}</span>
                    </button>

                    {/* Location Feedback Notice */}
                    {locationNotice && (
                        <div className="bg-blue-600 text-white px-2.5 py-1 rounded-xl text-[11px] font-medium shrink-0 flex items-center gap-1">
                            <span>{locationNotice}</span>
                        </div>
                    )}

                    {/* Recenter Map */}
                    <button
                        onClick={() => {
                            if (userLocation) {
                                setFlyTarget([userLocation.lat, userLocation.lng]);
                            } else {
                                setFlyTarget([10.3157, 123.8854]);
                            }
                        }}
                        className="bg-white hover:bg-gray-50 border border-gray-200 px-2.5 py-1.5 rounded-xl flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 transition-all cursor-pointer"
                        title="Recenter Map"
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Recenter</span>
                    </button>

                    {/* Reset Button */}
                    {hasActiveFilters && (
                        <button
                            type="button"
                            onClick={resetAllFilters}
                            className="bg-gray-100 hover:bg-gray-200 text-gray-600 border border-gray-200 px-2.5 py-1.5 rounded-xl text-xs font-medium shrink-0 cursor-pointer transition-all"
                            title="Reset all filters"
                        >
                            Reset
                        </button>
                    )}
                </div>
            </div>

            {/* ── 3. Floating Left Search Panel (Clean, Minimal, No Shadows) ── */}
            <div
                className={cn(
                    "absolute left-3.5 top-3.5 bottom-3.5 z-[500] w-[calc(100vw-1.75rem)] sm:w-[370px] flex flex-col bg-white rounded-2xl border border-gray-200 transition-all duration-300 pointer-events-auto overflow-hidden",
                    !sidebarOpen && "-translate-x-[calc(100%+2rem)] pointer-events-none"
                )}
                onWheel={(e) => e.stopPropagation()}
            >
                {/* Header & Search Input */}
                <div className="p-4 sm:p-5 border-b border-gray-100 bg-white">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-xl bg-magenta-600 flex items-center justify-center text-white">
                                <Building2 className="w-4 h-4" />
                            </div>
                            <div>
                                <h1 className="text-base font-bold text-gray-900 leading-tight">
                                    Find Clinics
                                </h1>
                                <p className="text-[11px] text-gray-500">
                                    Cebu Dermatology Network
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => setSidebarOpen(false)}
                            className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
                            title="Collapse panel"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Search bar */}
                    <div className="relative mb-3">
                        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 focus-within:border-magenta-500 focus-within:ring-1 focus-within:ring-magenta-500/20 focus-within:bg-white transition-all">
                            <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            <input
                                type="text"
                                placeholder="Search clinic, doctor, treatment..."
                                className="flex-1 bg-transparent outline-none text-xs text-gray-900 placeholder:text-gray-400"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                            {searchQuery && (
                                <button onClick={() => setSearchQuery("")} className="p-0.5 rounded-full hover:bg-gray-200 text-gray-400 cursor-pointer">
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Results Count and All/Saved Tabs */}
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-gray-500">
                            {processedClinics.length} {processedClinics.length === 1 ? "clinic" : "clinics"} found
                        </span>

                        <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-xl">
                            <button
                                onClick={() => setActiveTab("all")}
                                className={cn(
                                    "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer",
                                    activeTab === "all"
                                        ? "bg-white text-gray-900"
                                        : "text-gray-500 hover:text-gray-800"
                                )}
                            >
                                All ({dbClinics.length})
                            </button>
                            <button
                                onClick={() => {
                                    if (!currentUserId) {
                                        navigate("/login", { state: { from: "/find-clinics" } });
                                        return;
                                    }
                                    setActiveTab("saved");
                                }}
                                className={cn(
                                    "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 cursor-pointer",
                                    activeTab === "saved"
                                        ? "bg-white text-gray-900"
                                        : "text-gray-500 hover:text-gray-800"
                                )}
                            >
                                <Bookmark className="w-3 h-3" />
                                {savedClinicIds.length > 0 ? savedClinicIds.length : "Saved"}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Body / Clean Minimal Clinic Cards List (NO SHADOWS) */}
                <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
                    {loading ? (
                        <div className="py-16 text-center">
                            <Loader2 className="w-7 h-7 text-magenta-500 animate-spin mx-auto mb-2" />
                            <p className="text-xs font-semibold text-gray-800">Loading clinics...</p>
                            <p className="text-[10px] text-gray-400 mt-0.5">Fetching partner clinics</p>
                        </div>
                    ) : processedClinics.length > 0 ? (
                        processedClinics.map((clinic, i) => (
                            <motion.div
                                key={clinic.id}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.02 }}
                                onClick={() => {
                                    setActiveClinicId(clinic.id);
                                    if (clinic.lat !== null && clinic.lng !== null) {
                                        setFlyTarget([clinic.lat, clinic.lng]);
                                    }
                                }}
                                className={cn(
                                    "bg-white rounded-xl p-4 border transition-all cursor-pointer text-left",
                                    activeClinicId === clinic.id
                                        ? "border-magenta-500 ring-1 ring-magenta-500/30 bg-magenta-50/10"
                                        : "border-gray-200 hover:border-gray-300"
                                )}
                            >
                                <div className="flex items-start gap-3 mb-2.5">
                                    {/* Clinic Logo */}
                                    {clinic.logo ? (
                                        <img
                                            src={clinic.logo}
                                            alt={clinic.name}
                                            className="w-11 h-11 rounded-xl object-cover border border-gray-100 shrink-0 bg-white"
                                        />
                                    ) : (
                                        <div className="w-11 h-11 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 text-gray-600">
                                            <Building2 className="w-5 h-5" />
                                        </div>
                                    )}

                                    {/* Name & Address */}
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-bold text-gray-900 text-sm leading-snug truncate">
                                            {clinic.name}
                                        </h3>
                                        <p className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1">
                                            <MapPin className="w-3 h-3 text-gray-400 flex-shrink-0" />
                                            <span className="truncate">{clinic.address || clinic.district || "Cebu City"}</span>
                                            {clinic.distanceKm !== null && (
                                                <span className="text-blue-600 font-semibold shrink-0">
                                                    · {clinic.distanceKm} km
                                                </span>
                                            )}
                                        </p>
                                    </div>

                                    {/* Save Action */}
                                    <div className="flex items-center shrink-0">
                                        <button
                                            type="button"
                                            onClick={(e) => toggleSave(e, clinic.id)}
                                            className={cn(
                                                "p-1.5 rounded-xl transition-colors cursor-pointer",
                                                savedClinicIds.includes(clinic.id)
                                                    ? "text-magenta-600 bg-magenta-50"
                                                    : "text-gray-300 hover:text-gray-600 hover:bg-gray-50"
                                            )}
                                            title={savedClinicIds.includes(clinic.id) ? "Unsave clinic" : "Save clinic"}
                                        >
                                            {savedClinicIds.includes(clinic.id) ? (
                                                <BookmarkCheck className="w-4 h-4" />
                                            ) : (
                                                <Bookmark className="w-4 h-4" />
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {/* Attending Doctor */}
                                {clinic.doctors.length > 0 && (
                                    <div className="mb-2.5 flex items-center gap-1.5 text-[11px] text-gray-600 font-medium">
                                        <Stethoscope className="w-3 h-3 text-gray-400 flex-shrink-0" />
                                        <span className="truncate">{clinic.doctors[0].name}</span>
                                        <span className="text-[10px] text-gray-400 truncate">· {clinic.doctors[0].specialization}</span>
                                    </div>
                                )}

                                {/* Service Fee & Schedule */}
                                <div className="flex items-center justify-between text-[11px] bg-gray-50 rounded-lg px-2.5 py-1.5 mb-3 border border-gray-100">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-gray-500 font-medium">Fee:</span>
                                        <span className="font-bold text-gray-800">
                                            {clinic.consultationFee && !isNaN(Number(clinic.consultationFee)) && Number(clinic.consultationFee) > 0
                                                ? `₱${Number(clinic.consultationFee).toLocaleString()}`
                                                : clinic.consultationFee
                                                    ? `₱${clinic.consultationFee}`
                                                    : "₱500"}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className={cn(
                                            "w-1.5 h-1.5 rounded-full",
                                            clinic.isOpenToday ? "bg-emerald-500" : "bg-gray-400"
                                        )} />
                                        <span className="text-[10px] font-medium text-gray-500 truncate max-w-[140px]">
                                            {clinic.hours ? clinic.hours.split(":")[0] : "Mon - Sat"}
                                        </span>
                                    </div>
                                </div>

                                {/* Action buttons */}
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            openClinicDetails(clinic);
                                        }}
                                        className="flex-1 py-1.5 rounded-xl border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors text-center cursor-pointer"
                                    >
                                        Details
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            goToAppointment(clinic.id);
                                        }}
                                        className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl bg-magenta-600 hover:bg-magenta-700 text-white text-xs font-semibold transition-colors cursor-pointer"
                                    >
                                        <Calendar className="w-3 h-3" /> Book
                                    </button>
                                </div>
                            </motion.div>
                        ))
                    ) : (
                        <div className="py-12 px-4 text-center">
                            <div className="w-12 h-12 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center mx-auto mb-3">
                                <Search className="w-6 h-6 text-gray-300" />
                            </div>
                            <p className="text-xs font-bold text-gray-900 mb-1">
                                {dbClinics.length === 0 ? "No clinics registered yet" : "No clinics match your filters"}
                            </p>
                            <p className="text-[11px] text-gray-400 mb-3">
                                {dbClinics.length === 0
                                    ? "Registered partner clinics will appear here."
                                    : "Try resetting filters or adjusting search terms."}
                            </p>
                            {dbClinics.length === 0 ? (
                                <button
                                    onClick={() => navigate("/register-clinic")}
                                    className="px-3.5 py-1.5 rounded-xl bg-magenta-600 text-white text-xs font-semibold hover:bg-magenta-700 transition-colors cursor-pointer inline-flex items-center gap-1.5"
                                >
                                    <Building2 className="w-3.5 h-3.5" /> Partner With Us
                                </button>
                            ) : (
                                <button
                                    onClick={resetAllFilters}
                                    className="px-3 py-1.5 rounded-xl bg-magenta-600 text-white text-xs font-semibold hover:bg-magenta-700 transition-colors cursor-pointer"
                                >
                                    Reset all filters
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* ── 4. Floating Toggle Pill (when sidebar is closed) ───── */}
            {!sidebarOpen && (
                <button
                    onClick={() => setSidebarOpen(true)}
                    className="absolute left-3.5 top-3.5 z-[500] bg-white px-4 py-2.5 rounded-xl border border-gray-200 flex items-center gap-2 text-xs font-bold text-gray-900 hover:bg-gray-50 transition-all active:scale-95 cursor-pointer"
                >
                    <List className="w-4 h-4 text-magenta-600" />
                    <span>Show Clinics ({processedClinics.length})</span>
                </button>
            )}
        </div>
    );
}
