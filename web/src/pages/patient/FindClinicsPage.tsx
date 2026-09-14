import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAuth } from "@/context/AuthContext";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";

// Flies the map to the target coordinates whenever they change
const FlyToController = ({ target }: {
    target: [number, number] | null;
}) => {
    const map = useMap();
    useEffect(() => {
        if (target && !isNaN(target[0]) && !isNaN(target[1])) {
            map.flyTo(target, 15, { duration: 1 });
        }
    }, [map, target]);
    return null;
};

// Magenta pin icon for consistent design
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

export type ClinicItem = {
    id: string;
    name: string;
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
};

// Fallback coordinates for common Philippine districts if exact lat/lng are pending
const DISTRICT_COORDINATES: Record<string, [number, number]> = {
    "cebu": [10.3157, 123.8854],
    "cebu city": [10.3157, 123.8854],
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

function mapRawClinicToItem(
    c: any,
    doctorsMap?: Map<string, any[]>,
    servicesMap?: Map<string, string[]>,
    hoursMap?: Map<string, any[]>
): ClinicItem {
    const clinicId = String(c.clinic_id || c.id);

    // Operating hours
    let hoursStr = "";
    const hoursList = c.clinic_operating_hours || (hoursMap ? hoursMap.get(clinicId) : null);
    if (Array.isArray(hoursList) && hoursList.length > 0) {
        hoursStr = `${hoursList[0].day_of_week || ""}: ${hoursList[0].open_time || ""} - ${hoursList[0].close_time || ""}`.trim();
    } else if (c.operating_days || c.operatingDays) {
        hoursStr = `${c.operating_days || c.operatingDays}: ${c.open_time || c.openTime || "08:00"} - ${c.close_time || c.closeTime || "17:00"}`;
    }

    // Doctors
    let docList: Array<{ name: string; specialization: string }> = [];
    const rawDocs = c.clinic_doctor || (doctorsMap ? doctorsMap.get(clinicId) : null);
    if (Array.isArray(rawDocs) && rawDocs.length > 0) {
        docList = rawDocs
            .filter((d: any) => d.status !== "inactive" && (d.doctor_name || d.name))
            .map((d: any) => ({
                name: d.doctor_name || d.name,
                specialization: d.specialization || c.specialization || "General Dermatology",
            }));
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

    // Coordinates with district fallback
    const rawLat = c.latitude != null ? Number(c.latitude) : c.lat != null ? Number(c.lat) : null;
    const rawLng = c.longitude != null ? Number(c.longitude) : c.lng != null ? Number(c.lng) : null;
    const fallbackCoords = resolveDistrictCoords((c.district || c.address || c.location || ""));

    const lat = rawLat && !isNaN(rawLat) && rawLat !== 0 ? rawLat : fallbackCoords ? fallbackCoords[0] : null;
    const lng = rawLng && !isNaN(rawLng) && rawLng !== 0 ? rawLng : fallbackCoords ? fallbackCoords[1] : null;

    const status = String(c.status || "").toLowerCase();
    const isVerified = status === "approved" || status === "verified";

    const desc = (c.description || c.about || c.bio || c.overview || "").trim();

    return {
        id: clinicId,
        name: (c.name || "Clinic").trim(),
        address: c.address || c.location || c.district || "",
        phone: c.phone || "",
        facebook: c.facebook || "",
        hours: hoursStr,
        verified: isVerified,
        district: c.district || c.location || "Metro Manila",
        lat,
        lng,
        doctors: docList,
        conditionsTreated: services,
        consultationFee: c.consultation_fee != null && c.consultation_fee !== ""
            ? String(c.consultation_fee)
            : c.consultationFee != null && c.consultationFee !== ""
            ? String(c.consultationFee)
            : "500",
        description: desc,
    };
}

function getInitialFindClinics(): ClinicItem[] {
    try {
        const cachedFind = localStorage.getItem("dermai_cached_find_clinics");
        if (cachedFind) {
            const parsed = JSON.parse(cachedFind);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }

        const cachedAdmin =
            localStorage.getItem("dermai_cached_admin_clinics") ||
            localStorage.getItem("dermai_clinic_applications");
        if (cachedAdmin) {
            const parsed = JSON.parse(cachedAdmin);
            if (Array.isArray(parsed)) {
                const approved = parsed
                    .filter((c: any) => c.status === "approved" || c.status === "verified")
                    .map((c: any) => mapRawClinicToItem(c));
                if (approved.length > 0) return approved;
            }
        }
    } catch {}
    return [];
}

export default function FindClinicsPage() {
    const navigate = useNavigate();
    const { session: _session } = useAuth();
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedDistrict, setSelectedDistrict] = useState("All Districts");
    const [selectedClinic, setSelectedClinic] = useState<ClinicItem | null>(null);
    const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
    const [activeClinicId, setActiveClinicId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"all" | "saved">("all");
    const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
    const mapRef = useRef<HTMLDivElement>(null);

    const [dbClinics, setDbClinics] = useState<ClinicItem[]>(getInitialFindClinics);
    const [loading, setLoading] = useState(() => getInitialFindClinics().length === 0);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [savedClinicIds, setSavedClinicIds] = useState<string[]>([]);

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
            } catch {
                /* ignore if table not created */
            }
        } else {
            setSavedClinicIds((prev) => [...prev, clinicId]);
            try {
                await supabase
                    .from("user_saved_clinic")
                    .insert({ user_id: currentUserId, clinic_id: clinicId });
            } catch {
                /* ignore if table not created */
            }
        }
    };

    // Load clinics from live Supabase + cache synchronization
    const fetchClinics = async () => {
        try {
            // 1. Try nested join query for approved clinics
            let mappedClinics: ClinicItem[] = [];
            const { data: nestedData, error: nestedError } = await supabase
                .from("clinic")
                .select(`
                    clinic_id,
                    name,
                    district,
                    address,
                    phone,
                    email,
                    status,
                    latitude,
                    longitude,
                    consultation_fee,
                    description,
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
                        specialization,
                        prc_license,
                        photo_url,
                        status
                    )
                `)
                .or("status.eq.approved,status.eq.verified");

            if (!nestedError && nestedData && nestedData.length > 0) {
                mappedClinics = nestedData.map((c: any) => mapRawClinicToItem(c));
            } else {
                // 2. Fallback to independent queries if nested relationship fails
                const { data: clinicRows, error: clinicErr } = await supabase
                    .from("clinic")
                    .select("clinic_id, name, district, address, phone, email, status, latitude, longitude, consultation_fee, description")
                    .or("status.eq.approved,status.eq.verified");

                if (!clinicErr && clinicRows && clinicRows.length > 0) {
                    const clinicIds = clinicRows.map((c: any) => c.clinic_id);
                    const doctorsMap = new Map<string, any[]>();
                    const servicesMap = new Map<string, string[]>();
                    const hoursMap = new Map<string, any[]>();

                    const [docRes, srvRes, hrsRes] = await Promise.allSettled([
                        supabase.from("clinic_doctor").select("*").in("clinic_id", clinicIds),
                        supabase.from("clinic_service_offered").select("*").in("clinic_id", clinicIds),
                        supabase.from("clinic_operating_hours").select("*").in("clinic_id", clinicIds),
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

                    mappedClinics = clinicRows.map((c: any) =>
                        mapRawClinicToItem(c, doctorsMap, servicesMap, hoursMap)
                    );
                }
            }

            // 3. Merge with local admin cache if newly approved locally
            try {
                const cachedAdmin =
                    localStorage.getItem("dermai_cached_admin_clinics") ||
                    localStorage.getItem("dermai_clinic_applications");
                if (cachedAdmin) {
                    const parsed = JSON.parse(cachedAdmin);
                    if (Array.isArray(parsed)) {
                        const localApproved = parsed
                            .filter((c: any) => c.status === "approved" || c.status === "verified")
                            .map((c: any) => mapRawClinicToItem(c));

                        // Merge without duplicates
                        const existingIds = new Set(mappedClinics.map((c) => String(c.id)));
                        localApproved.forEach((item: ClinicItem) => {
                            if (!existingIds.has(String(item.id))) {
                                mappedClinics.push(item);
                                existingIds.add(String(item.id));
                            }
                        });
                    }
                }
            } catch {}

            setDbClinics(mappedClinics);
            try {
                localStorage.setItem("dermai_cached_find_clinics", JSON.stringify(mappedClinics));
            } catch {}
        } catch (err) {
            console.warn("Error loading clinics for FindClinicsPage:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchClinics();

        // Realtime subscription to clinic changes in Supabase
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

        return () => {
            supabase.removeChannel(channel);
            window.removeEventListener("storage", handleSync);
            window.removeEventListener("clinicRegistered", handleSync);
            window.removeEventListener("clinicStatusUpdated", handleSync);
        };
    }, []);

    // Dynamic districts derived from real clinic database accounts
    const districts = useMemo(() => {
        const set = new Set<string>();
        dbClinics.forEach((c) => {
            if (c.district && c.district.trim()) {
                set.add(c.district.trim());
            }
        });
        return ["All Districts", ...Array.from(set).sort()];
    }, [dbClinics]);

    // Filter clinics by search query, district, and saved tab
    const filteredClinics = useMemo(() => {
        return dbClinics.filter((clinic) => {
            const matchesSearch =
                !searchQuery ||
                clinic.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                clinic.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
                clinic.doctors.some((doc) => doc.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
                clinic.conditionsTreated.some((cond) => cond.toLowerCase().includes(searchQuery.toLowerCase()));
            const matchesDistrict = selectedDistrict === "All Districts" || clinic.district === selectedDistrict;
            const matchesTab = activeTab === "all" || savedClinicIds.includes(clinic.id);
            return matchesSearch && matchesDistrict && matchesTab;
        });
    }, [dbClinics, searchQuery, selectedDistrict, activeTab, savedClinicIds]);

    // Map markers: only clinics from filtered list that have real coordinates
    const mapMarkers = useMemo(() => {
        return filteredClinics.filter(
            (c): c is ClinicItem & { lat: number; lng: number } =>
                c.lat !== null && c.lng !== null && !isNaN(c.lat) && !isNaN(c.lng)
        );
    }, [filteredClinics]);

    const openClinicDetails = (clinic: ClinicItem) => {
        setSelectedClinic(clinic);
        setActiveClinicId(clinic.id);
        if (clinic.lat !== null && clinic.lng !== null) {
            setFlyTarget([clinic.lat, clinic.lng]);
        }
    };

    const goToAppointment = (clinicId: string) => {
        navigate(`/appointment?clinic=${clinicId}`);
    };

    return (
        <div className="relative w-full h-[calc(100vh-4rem)] min-h-[600px] overflow-hidden bg-white flex">
            {/* ── Ultra-Minimal Clinic Details Modal ────────────────────── */}
            <AnimatePresence>
                {selectedClinic && (
                    <motion.div
                        key="clinic-detail-modal"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-black/40 backdrop-blur-sm"
                        onClick={() => setSelectedClinic(null)}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.96, y: 12 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96, y: 12 }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                            className="bg-white rounded-3xl shadow-2xl border border-gray-100 w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden text-left"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Sticky Modal Header */}
                            <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between bg-white">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <h2 className="text-lg sm:text-xl font-bold text-gray-900 tracking-tight leading-snug">
                                            {selectedClinic.name}
                                        </h2>
                                        {selectedClinic.verified && (
                                            <VerifiedBadge size={18} className="w-4.5 h-4.5 shrink-0" title="Verified Clinic" />
                                        )}
                                    </div>
                                    {selectedClinic.verified ? (
                                        <div className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 bg-blue-50/80 border border-blue-100/80 px-2 py-0.5 rounded-full w-fit">
                                            <VerifiedBadge size={11} className="w-2.5 h-2.5" />
                                            <span>Verified Partner Clinic</span>
                                        </div>
                                    ) : (
                                        <span className="text-[11px] font-medium text-gray-400">Dermatology Clinic</span>
                                    )}
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
                                        onClick={() => setSelectedClinic(null)}
                                        className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                                        title="Close"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>

                            {/* Scrollable Content */}
                            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                                {/* About / Clinic Description */}
                                <div>
                                    <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                                        About This Clinic
                                    </h4>
                                    <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100 text-xs sm:text-sm text-gray-600 leading-relaxed font-normal">
                                        {selectedClinic.description ||
                                            "Specialized in advanced dermatological care, comprehensive skin assessments, acne & eczema management, and customized treatment plans tailored to each patient."}
                                    </div>
                                </div>

                                {/* Contact & Hours Info Grid */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                    {/* Address */}
                                    <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-100 flex items-start gap-2.5">
                                        <MapPin className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Address</p>
                                            <p className="text-xs font-medium text-gray-800 mt-0.5 truncate-2-lines">
                                                {selectedClinic.address || selectedClinic.district || "Cebu City, Philippines"}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Hours */}
                                    <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-100 flex items-start gap-2.5">
                                        <Clock className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Hours</p>
                                            <p className="text-xs font-medium text-gray-800 mt-0.5">
                                                {selectedClinic.hours || "Mon - Sat: 8:00 AM - 5:00 PM"}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Phone */}
                                    <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-100 flex items-start gap-2.5">
                                        <Phone className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Contact</p>
                                            <p className="text-xs font-medium text-gray-800 mt-0.5">
                                                {selectedClinic.phone || "Available upon booking"}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Consultation Fee */}
                                    <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-100 flex items-start gap-2.5">
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
                                                <div key={idx} className="flex items-center gap-3 p-3 rounded-2xl bg-gray-50 border border-gray-100">
                                                    <div className="w-8 h-8 rounded-xl bg-white border border-gray-200 text-gray-700 flex items-center justify-center shrink-0">
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
                                        <p className="text-xs text-gray-400 italic bg-gray-50 p-3 rounded-2xl border border-gray-100">
                                            Board-certified specialists assigned per consultation schedule.
                                        </p>
                                    )}
                                </div>

                                {/* Services / Conditions Treated */}
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
                                            {["General Dermatology", "Acne & Scar Treatment", "Skin Allergy Screening", "Mole & Lesion Evaluation"].map((srv, idx) => (
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
                                        setSelectedClinic(null);
                                        goToAppointment(clinicId);
                                    }}
                                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full bg-magenta-600 hover:bg-magenta-700 active:scale-[0.99] text-white text-xs sm:text-sm font-semibold transition-all shadow-sm cursor-pointer"
                                >
                                    <Calendar className="w-4 h-4" /> Book Appointment
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
                                    <div className="min-w-[190px] p-1 text-left">
                                        <div className="flex items-center gap-1 flex-wrap">
                                            <h4 className="font-bold text-gray-900 text-sm">
                                                {clinic.name}
                                            </h4>
                                            {clinic.verified && <VerifiedBadge size={14} className="w-3.5 h-3.5" title="Verified Clinic" />}
                                        </div>
                                        {clinic.verified && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded mt-1">
                                                Verified Clinic
                                            </span>
                                        )}
                                        {clinic.address && <p className="text-xs text-gray-600 mt-1">{clinic.address}</p>}
                                        {clinic.phone && <p className="text-xs text-gray-500 mt-0.5">{clinic.phone}</p>}
                                        
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
                                                className="flex-1 py-1 px-2 rounded-lg bg-magenta-600 hover:bg-magenta-700 text-white text-xs font-semibold text-center transition-colors shadow-xs cursor-pointer"
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

            {/* ── 2. Floating Top-Right Controls ─────────────────────── */}
            <div className="absolute top-4 right-4 z-[450] flex flex-wrap items-center gap-2 pointer-events-auto">
                <div className="bg-white/90 backdrop-blur-md px-3.5 py-2 rounded-full shadow-lg border border-magenta-100 flex items-center gap-2 text-xs font-semibold text-magenta-900">
                    <MapPin className="w-3.5 h-3.5 text-magenta-500" />
                    <span>{mapMarkers.length} {mapMarkers.length === 1 ? "Clinic" : "Clinics"} on Map</span>
                </div>
                <button
                    onClick={() => setFlyTarget([10.3157, 123.8854])}
                    className="bg-white/90 hover:bg-white backdrop-blur-md px-3.5 py-2 rounded-full shadow-lg border border-magenta-100 flex items-center gap-1.5 text-xs font-semibold text-magenta-700 hover:text-magenta-900 transition-all active:scale-95 cursor-pointer"
                    title="Recenter Map on Cebu"
                >
                    <RotateCcw className="w-3.5 h-3.5 text-magenta-500" />
                    <span className="hidden sm:inline">Recenter</span>
                </button>
            </div>

            {/* ── 3. Floating Collapsible Left Drawer / Panel ───────── */}
            <div
                className={cn(
                    "absolute left-4 top-4 bottom-4 z-[500] w-[calc(100vw-2rem)] sm:w-[410px] flex flex-col bg-white/95 backdrop-blur-xl rounded-3xl shadow-[0_16px_48px_rgba(160,25,90,0.14)] border border-magenta-100 transition-all duration-300 pointer-events-auto overflow-hidden",
                    !sidebarOpen && "-translate-x-[calc(100%+2rem)] pointer-events-none"
                )}
                onWheel={(e) => e.stopPropagation()}
            >
                {/* Header inside floating sidebar */}
                <div className="p-4 sm:p-5 border-b border-magenta-100/70 bg-gradient-to-b from-white via-white to-pink-50/20">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-xl bg-magenta-500 flex items-center justify-center text-white shadow-sm">
                                <Building2 className="w-4 h-4" />
                            </div>
                            <div>
                                <h1 className="text-base font-display font-bold text-magenta-900 leading-tight">
                                    Find Clinics
                                </h1>
                                <p className="text-[11px] text-magenta-600/70">
                                    Cebu Dermatology Network
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => setSidebarOpen(false)}
                            className="p-1.5 rounded-xl hover:bg-magenta-50 text-magenta-400 hover:text-magenta-600 transition-colors cursor-pointer"
                            title="Collapse panel"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Search bar */}
                    <div className="relative mb-2.5">
                        <div className="flex items-center gap-2 bg-magenta-50/80 border border-magenta-100/80 rounded-2xl px-3.5 py-2 focus-within:border-magenta-400 focus-within:ring-2 focus-within:ring-magenta-500/10 transition-all">
                            <Search className="w-4 h-4 text-magenta-400 flex-shrink-0" />
                            <input
                                type="text"
                                placeholder="Search clinic, service, doctor..."
                                className="flex-1 bg-transparent outline-none text-xs text-magenta-900 placeholder:text-magenta-300"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                            {searchQuery && (
                                <button onClick={() => setSearchQuery("")} className="p-0.5 rounded-full hover:bg-magenta-100 text-magenta-400">
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* District & Tabs Row */}
                    <div className="flex items-center gap-2">
                        {/* District select */}
                        <div className="relative flex-1">
                            <select
                                value={selectedDistrict}
                                onChange={(e) => setSelectedDistrict(e.target.value)}
                                className="w-full appearance-none bg-magenta-50/80 border border-magenta-100/80 rounded-xl px-3 py-1.5 pr-7 text-xs font-semibold text-magenta-800 outline-none cursor-pointer"
                            >
                                {districts.map((d) => (
                                    <option key={d} value={d}>
                                        {d}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-magenta-400 pointer-events-none" />
                        </div>

                        {/* All / Saved pills */}
                        <div className="flex items-center gap-1 bg-magenta-50/80 p-0.5 rounded-xl border border-magenta-100/80">
                            <button
                                onClick={() => setActiveTab("all")}
                                className={cn(
                                    "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer",
                                    activeTab === "all"
                                        ? "bg-magenta-500 text-white shadow-xs"
                                        : "text-magenta-600 hover:text-magenta-800"
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
                                        ? "bg-magenta-500 text-white shadow-xs"
                                        : "text-magenta-600 hover:text-magenta-800"
                                )}
                            >
                                <Bookmark className="w-3 h-3" />
                                {savedClinicIds.length > 0 ? savedClinicIds.length : "Saved"}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Body / Scrollable Clinic Cards */}
                <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
                    {loading ? (
                        <div className="py-16 text-center">
                            <Loader2 className="w-7 h-7 text-magenta-500 animate-spin mx-auto mb-2" />
                            <p className="text-xs font-semibold text-magenta-800">Loading Cebu clinics...</p>
                            <p className="text-[10px] text-magenta-400 mt-0.5">Fetching verified locations</p>
                        </div>
                    ) : filteredClinics.length > 0 ? (
                        filteredClinics.map((clinic, i) => (
                            <motion.div
                                key={clinic.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.03 }}
                                onClick={() => {
                                    setActiveClinicId(clinic.id);
                                    if (clinic.lat !== null && clinic.lng !== null) {
                                        setFlyTarget([clinic.lat, clinic.lng]);
                                    }
                                }}
                                className={cn(
                                    "bg-white rounded-2xl p-4 border transition-all cursor-pointer",
                                    activeClinicId === clinic.id
                                        ? "border-magenta-500 ring-2 ring-magenta-500/20 shadow-md bg-magenta-50/20"
                                        : "border-magenta-100 hover:border-magenta-200 hover:shadow-sm"
                                )}
                            >
                                <div className="flex items-start justify-between gap-2 mb-2">
                                    <div>
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <h3 className="font-display font-bold text-magenta-900 text-sm leading-snug">
                                                {clinic.name}
                                            </h3>
                                            {clinic.verified && (
                                                <VerifiedBadge size={16} className="w-4 h-4" title="Verified Clinic" />
                                            )}
                                        </div>
                                        <p className="text-[11px] text-magenta-600/70 mt-0.5 flex items-center gap-1">
                                            <MapPin className="w-3 h-3 text-magenta-400 flex-shrink-0" />
                                            <span className="truncate max-w-[220px]">{clinic.address || clinic.district || "Cebu"}</span>
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                        {clinic.verified ? (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-200">
                                                <VerifiedBadge size={11} className="w-2.5 h-2.5" /> Verified
                                            </span>
                                        ) : (
                                            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-medium">
                                                Pending
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            onClick={(e) => toggleSave(e, clinic.id)}
                                            className={cn(
                                                "p-1 rounded-lg transition-colors cursor-pointer",
                                                savedClinicIds.includes(clinic.id)
                                                    ? "text-magenta-600 bg-magenta-50"
                                                    : "text-magenta-300 hover:text-magenta-600 hover:bg-magenta-50"
                                            )}
                                            title={savedClinicIds.includes(clinic.id) ? "Unsave clinic" : "Save clinic"}
                                        >
                                            {savedClinicIds.includes(clinic.id) ? (
                                                <BookmarkCheck className="w-3.5 h-3.5" />
                                            ) : (
                                                <Bookmark className="w-3.5 h-3.5" />
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {/* Doctors / Service info */}
                                {clinic.doctors.length > 0 && (
                                    <div className="mb-2.5 flex items-center gap-1.5 text-[11px] text-magenta-700 font-medium">
                                        <Stethoscope className="w-3 h-3 text-magenta-400 flex-shrink-0" />
                                        <span className="truncate">{clinic.doctors[0].name}</span>
                                        <span className="text-[10px] text-magenta-400 truncate">· {clinic.doctors[0].specialization}</span>
                                    </div>
                                )}

                                {/* Service Fee & Hours */}
                                <div className="flex items-center justify-between text-[11px] bg-magenta-50/60 rounded-xl px-2.5 py-1.5 mb-3 border border-magenta-100/60">
                                    <span className="text-magenta-600 font-medium">Fee:</span>
                                    <span className="font-bold text-magenta-700">
                                        {clinic.consultationFee && !isNaN(Number(clinic.consultationFee)) && Number(clinic.consultationFee) > 0
                                            ? `₱${Number(clinic.consultationFee).toLocaleString()}`
                                            : clinic.consultationFee
                                            ? `₱${clinic.consultationFee}`
                                            : "Inquire"}
                                    </span>
                                </div>

                                {/* Action buttons */}
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            openClinicDetails(clinic);
                                        }}
                                        className="flex-1 py-1.5 rounded-xl border border-magenta-200 text-magenta-700 text-xs font-semibold hover:bg-magenta-50 transition-colors text-center cursor-pointer"
                                    >
                                        Details
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            goToAppointment(clinic.id);
                                        }}
                                        className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl bg-magenta-500 hover:bg-magenta-600 text-white text-xs font-semibold transition-colors shadow-xs cursor-pointer"
                                    >
                                        <Calendar className="w-3 h-3" /> Book
                                    </button>
                                </div>
                            </motion.div>
                        ))
                    ) : (
                        <div className="py-12 px-4 text-center">
                            <div className="w-12 h-12 rounded-2xl bg-magenta-50 flex items-center justify-center mx-auto mb-3">
                                <Search className="w-6 h-6 text-magenta-300" />
                            </div>
                            <p className="text-xs font-bold text-magenta-900 mb-1">No clinics found</p>
                            <p className="text-[11px] text-magenta-400 mb-3">Try adjusting your search terms or district filter</p>
                            <button
                                onClick={() => {
                                    setSearchQuery("");
                                    setSelectedDistrict("All Districts");
                                    setActiveTab("all");
                                }}
                                className="px-3 py-1.5 rounded-full bg-magenta-500 text-white text-xs font-semibold hover:bg-magenta-600 transition-colors cursor-pointer"
                            >
                                Reset filters
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* ── 4. Floating Toggle Pill (when sidebar is closed) ───── */}
            {!sidebarOpen && (
                <button
                    onClick={() => setSidebarOpen(true)}
                    className="absolute left-4 top-4 z-[500] bg-white/95 backdrop-blur-md px-4 py-2.5 rounded-2xl shadow-xl border border-magenta-100 flex items-center gap-2 text-xs font-bold text-magenta-900 hover:bg-white transition-all active:scale-95 cursor-pointer"
                >
                    <List className="w-4 h-4 text-magenta-500" />
                    <span>Show Clinics ({filteredClinics.length})</span>
                </button>
            )}
        </div>
    );
}
