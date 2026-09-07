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
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Map event handler to close modal on interactions
const MapEventHandler = ({ onMapInteraction }: {
    onMapInteraction: () => void;
}) => {
    useMapEvents({
        dragstart: () => onMapInteraction(),
        zoomstart: () => onMapInteraction(),
    });
    return null;
};

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
};

export default function FindClinicsPage() {
    const navigate = useNavigate();
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedDistrict, setSelectedDistrict] = useState("All Districts");
    const [detailModal, setDetailModal] = useState<string | null>(null);
    const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
    const [activeClinicId, setActiveClinicId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"all" | "saved">("all");
    const mapRef = useRef<HTMLDivElement>(null);

    const [loading, setLoading] = useState(true);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [savedClinicIds, setSavedClinicIds] = useState<string[]>([]);
    const [dbClinics, setDbClinics] = useState<ClinicItem[]>([]);

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

    // Load clinics strictly from Supabase with account verification
    useEffect(() => {
        let cancelled = false;
        async function fetchClinics() {
            setLoading(true);
            try {
                // 1. Fetch clinics that have approved/verified status
                const { data, error } = await supabase
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
                        owner_user_id,
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
                            active
                        )
                    `)
                    // Only query the single valid approved status — "verified" does not exist in the DB
                    .eq("status", "approved");

                if (cancelled) return;

                if (error || !data || data.length === 0) {
                    setDbClinics([]);
                    setLoading(false);
                    return;
                }

                // 2. Account-Based verification:
                // Verify against registered users table (role = 'clinic' and active)
                const ownerIds = data
                    .map((c: any) => c.owner_user_id)
                    .filter((id: any): id is string => Boolean(id));

                const activeClinicOwnerIds = new Set<string>();

                if (ownerIds.length > 0) {
                    try {
                        const { data: userData } = await supabase
                            .from("user")
                            .select("user_id, role, account_status")
                            .in("user_id", ownerIds);

                        if (userData && userData.length > 0) {
                            userData.forEach((u: any) => {
                                const isActive = u.account_status === "active" || (u as any).is_active !== false;
                                const isClinicRole = u.role === "clinic" || u.role === "admin";
                                if (isActive && isClinicRole) {
                                    activeClinicOwnerIds.add(u.user_id);
                                }
                            });
                        }
                    } catch {
                        /* fallback if user table query fails */
                    }
                }

                // 3. Filter:
                // Clinics must have a real name AND, if they have an owner_user_id,
                // that owner must be a verified active clinic account.
                // Clinics with no owner_user_id are also excluded (no registered account).
                const verifiedClinics = data.filter((c: any) => {
                    if (!c.name || !c.name.trim()) return false;
                    // Must have a registered owner
                    if (!c.owner_user_id) return false;
                    // Owner must be an active clinic/admin account
                    return activeClinicOwnerIds.has(c.owner_user_id);
                });

                const mapped: ClinicItem[] = verifiedClinics.map((c: any) => {
                    const hoursStr = (c.clinic_operating_hours && c.clinic_operating_hours.length > 0)
                        ? `${c.clinic_operating_hours[0].day_of_week || ""}: ${c.clinic_operating_hours[0].open_time || ""} - ${c.clinic_operating_hours[0].close_time || ""}`.trim()
                        : "";
                    const docList = (c.clinic_doctor || [])
                        .filter((d: any) => d.active !== false && d.doctor_name)
                        .map((d: any) => ({
                            name: d.doctor_name,
                            specialization: d.specialization || "General Dermatology",
                        }));
                    const services = (c.clinic_service_offered || [])
                        .map((s: any) => s.service_name)
                        .filter(Boolean);

                    const parsedLat = c.latitude != null && !isNaN(Number(c.latitude)) && Number(c.latitude) !== 0
                        ? Number(c.latitude)
                        : null;
                    const parsedLng = c.longitude != null && !isNaN(Number(c.longitude)) && Number(c.longitude) !== 0
                        ? Number(c.longitude)
                        : null;

                    return {
                        id: String(c.clinic_id),
                        name: c.name.trim(),
                        address: c.address || c.district || "",
                        phone: c.phone || "",
                        facebook: "",
                        hours: hoursStr,
                        verified: c.status === "approved",
                        district: c.district || "",
                        lat: parsedLat,
                        lng: parsedLng,
                        doctors: docList,
                        conditionsTreated: services,
                        consultationFee: c.consultation_fee != null && c.consultation_fee !== "" ? String(c.consultation_fee) : "",
                    };
                });

                if (!cancelled) {
                    setDbClinics(mapped);
                }
            } catch (err) {
                console.error("Failed to fetch registered clinics:", err);
                if (!cancelled) {
                    setDbClinics([]);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }
        fetchClinics();
        return () => { cancelled = true; };
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

    const selectedClinicData = dbClinics.find((c) => c.id === detailModal);

    const goToAppointment = (clinicId: string) => {
        navigate(`/appointment?clinic=${clinicId}`);
    };

    return (
        <div className="min-h-screen bg-magenta-50 pt-8 pb-0">
            {/* ── Full-screen Detail Modal ────────────────────────────────── */}
            <AnimatePresence>
                {detailModal && selectedClinicData && (
                    <motion.div
                        key="clinic-detail-modal"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
                        onClick={() => setDetailModal(null)}
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 24, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 16, scale: 0.97 }}
                            transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                            className="bg-white rounded-[28px] shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Header */}
                            <div className="sticky top-0 bg-white rounded-t-[28px] px-6 pt-6 pb-4 border-b border-gray-100 flex items-start justify-between z-10">
                                <div>
                                    <h2 className="text-xl font-display font-bold text-magenta-900 leading-tight">
                                        {selectedClinicData.name}
                                    </h2>
                                    {selectedClinicData.verified && (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-green-100 text-green-700 text-[11px] font-bold mt-1.5">
                                            <CheckCircle2 className="w-3 h-3" /> Verified Clinic
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                                    <button
                                        onClick={(e) => toggleSave(e, selectedClinicData.id)}
                                        className={cn(
                                            "p-2 rounded-full transition-colors",
                                            savedClinicIds.includes(selectedClinicData.id)
                                                ? "bg-magenta-100 text-magenta-600 hover:bg-magenta-200"
                                                : "hover:bg-magenta-50 text-magenta-300 hover:text-magenta-500"
                                        )}
                                        title={savedClinicIds.includes(selectedClinicData.id) ? "Unsave clinic" : "Save clinic"}
                                    >
                                        {savedClinicIds.includes(selectedClinicData.id) ? (
                                            <BookmarkCheck className="w-5 h-5" />
                                        ) : (
                                            <Bookmark className="w-5 h-5" />
                                        )}
                                    </button>
                                    <button
                                        onClick={() => setDetailModal(null)}
                                        className="p-2 rounded-full hover:bg-magenta-50 transition-colors"
                                    >
                                        <X className="w-5 h-5 text-magenta-400" />
                                    </button>
                                </div>
                            </div>

                            <div className="px-6 py-5 space-y-5">
                                {/* Contact Info */}
                                <div className="space-y-2">
                                    {selectedClinicData.address && (
                                        <p className="flex items-start gap-2.5 text-sm text-magenta-700">
                                            <MapPin className="w-4 h-4 text-magenta-400 flex-shrink-0 mt-0.5" />
                                            {selectedClinicData.address}
                                        </p>
                                    )}
                                    {selectedClinicData.phone && (
                                        <p className="flex items-center gap-2.5 text-sm text-magenta-700">
                                            <Phone className="w-4 h-4 text-magenta-400 flex-shrink-0" />
                                            {selectedClinicData.phone}
                                        </p>
                                    )}
                                    {selectedClinicData.hours && (
                                        <p className="flex items-center gap-2.5 text-sm text-magenta-700">
                                            <Clock className="w-4 h-4 text-magenta-400 flex-shrink-0" />
                                            {selectedClinicData.hours}
                                        </p>
                                    )}
                                </div>

                                {/* Doctors */}
                                <div>
                                    <p className="text-[11px] font-bold text-magenta-400 uppercase tracking-wider mb-2">Doctors</p>
                                    {selectedClinicData.doctors.length > 0 ? (
                                        <div className="space-y-2">
                                            {selectedClinicData.doctors.map((doc, i) => (
                                                <div key={i} className="flex items-start gap-2.5 p-3 rounded-xl bg-magenta-50">
                                                    <Stethoscope className="w-4 h-4 text-magenta-500 flex-shrink-0 mt-0.5" />
                                                    <div>
                                                        <p className="text-sm font-semibold text-magenta-900">{doc.name}</p>
                                                        <p className="text-xs text-magenta-500">{doc.specialization}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-magenta-400 italic">No doctors listed yet.</p>
                                    )}
                                </div>

                                {/* Conditions & Services Treated */}
                                <div>
                                    <p className="text-[11px] font-bold text-magenta-400 uppercase tracking-wider mb-2">Conditions &amp; Services Treated</p>
                                    {selectedClinicData.conditionsTreated && selectedClinicData.conditionsTreated.length > 0 ? (
                                        <div className="flex flex-wrap gap-1.5">
                                            {selectedClinicData.conditionsTreated.map((cond, i) => (
                                                <span key={i} className="px-3 py-1 rounded-full bg-magenta-100 text-magenta-700 text-xs font-medium">
                                                    {cond}
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-magenta-400 italic">No specific services listed yet by this clinic.</p>
                                    )}
                                </div>

                                {/* Service Fees */}
                                <div>
                                    <p className="text-[11px] font-bold text-magenta-400 uppercase tracking-wider mb-2">Service Fee</p>
                                    <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-magenta-50 border border-magenta-100">
                                        <span className="text-sm font-semibold text-magenta-700">Service Fee</span>
                                        <span className="text-sm text-magenta-400">:</span>
                                        <span className="font-bold text-magenta-600 text-sm">
                                            {selectedClinicData.consultationFee && !isNaN(Number(selectedClinicData.consultationFee)) && Number(selectedClinicData.consultationFee) > 0
                                                ? `Starts at ₱${Number(selectedClinicData.consultationFee).toLocaleString()}`
                                                : selectedClinicData.consultationFee
                                                ? `Starts at ₱${selectedClinicData.consultationFee}`
                                                : "Inquire at clinic"}
                                        </span>
                                    </div>
                                </div>

                                {/* Action buttons */}
                                <div className="pt-2">
                                    <button
                                        onClick={() => {
                                            setDetailModal(null);
                                            goToAppointment(selectedClinicData.id);
                                        }}
                                        className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-magenta-500 text-white text-sm font-bold hover:bg-magenta-600 transition-colors active:scale-[0.98]"
                                    >
                                        <Calendar className="w-4 h-4" /> Book Appointment
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                {/* Header */}
                <div className="text-center mb-8">
                    <h1 className="text-3xl sm:text-4xl font-display font-bold text-magenta-900 mb-2">
                        Find Derma Clinics in Cebu
                    </h1>
                    <p className="text-magenta-700/60 text-sm">
                        Discover verified dermatology clinics near you
                    </p>
                </div>

                {/* Search & Filters */}
                <div className="bg-white rounded-[20px] shadow-[0_4px_24px_rgba(160,25,90,0.08)] p-4 sm:p-6 mb-6">
                    <div className="flex flex-col sm:flex-row gap-3">
                        {/* Search */}
                        <div className="flex-1 flex items-center gap-2 bg-magenta-50 rounded-full px-4 py-2.5">
                            <Search className="w-4 h-4 text-magenta-400 flex-shrink-0" />
                            <input
                                type="text"
                                placeholder="Search clinic name, service, or doctor name..."
                                className="flex-1 bg-transparent outline-none text-sm text-magenta-900 placeholder:text-magenta-300"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>

                        {/* District */}
                        <div className="relative">
                            <select
                                value={selectedDistrict}
                                onChange={(e) => setSelectedDistrict(e.target.value)}
                                className="appearance-none bg-magenta-50 rounded-full px-4 py-2.5 pr-10 text-sm text-magenta-900 outline-none cursor-pointer w-full sm:w-auto"
                            >
                                {districts.map((d) => (
                                    <option key={d} value={d}>
                                        {d}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-magenta-400 pointer-events-none" />
                        </div>
                    </div>

                    <div className="flex gap-2 mt-3">
                        <button
                            onClick={() => setActiveTab("all")}
                            className={cn(
                                "px-4 py-1.5 rounded-full text-xs font-semibold transition-colors",
                                activeTab === "all"
                                    ? "bg-magenta-500 text-white"
                                    : "bg-magenta-50 text-magenta-600 hover:bg-magenta-100"
                            )}
                        >
                            All Clinics ({dbClinics.length})
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
                                "px-4 py-1.5 rounded-full text-xs font-semibold transition-colors flex items-center gap-1.5",
                                activeTab === "saved"
                                    ? "bg-magenta-500 text-white"
                                    : "bg-magenta-50 text-magenta-600 hover:bg-magenta-100"
                            )}
                        >
                            <Bookmark className="w-3 h-3" />
                            Saved ({savedClinicIds.length})
                        </button>
                    </div>
                </div>

                {/* Split Layout */}
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 pb-16">
                    {/* Clinic List */}
                    <div className="lg:col-span-2 space-y-3 max-h-[600px] overflow-y-auto pr-1">
                        {loading ? (
                            <div className="bg-white rounded-[20px] p-10 text-center shadow-[0_2px_12px_rgba(160,25,90,0.06)]">
                                <Loader2 className="w-8 h-8 text-magenta-500 animate-spin mx-auto mb-3" />
                                <p className="text-sm font-medium text-magenta-800">Loading registered clinics...</p>
                                <p className="text-xs text-magenta-400 mt-1">Connecting to live database</p>
                            </div>
                        ) : filteredClinics.length > 0 ? (
                            filteredClinics.map((clinic, i) => (
                                <motion.div
                                    key={clinic.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: i * 0.05 }}
                                    onClick={() => {
                                        setActiveClinicId(clinic.id);
                                        if (clinic.lat !== null && clinic.lng !== null) {
                                            setFlyTarget([clinic.lat, clinic.lng]);
                                        }
                                        mapRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                                    }}
                                    className={cn(
                                        "bg-white rounded-[20px] p-5 cursor-pointer transition-all",
                                        activeClinicId === clinic.id
                                            ? "shadow-[0_4px_24px_rgba(160,25,90,0.18)] border-2 border-magenta-400"
                                            : "shadow-[0_2px_12px_rgba(160,25,90,0.06)] border-2 border-transparent hover:shadow-[0_4px_24px_rgba(160,25,90,0.15)] hover:border-magenta-100"
                                    )}
                                >
                                    <div className="flex items-start justify-between mb-3">
                                        <h3 className="font-display font-bold text-magenta-900 text-sm">
                                            {clinic.name}
                                        </h3>
                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                            {clinic.verified ? (
                                                <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">
                                                    <CheckCircle2 className="w-3 h-3" /> Verified
                                                </span>
                                            ) : (
                                                <span className="px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-bold opacity-70">
                                                    Pending
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={(e) => toggleSave(e, clinic.id)}
                                                className={cn(
                                                    "p-1.5 rounded-full transition-colors",
                                                    savedClinicIds.includes(clinic.id)
                                                        ? "text-magenta-500 bg-magenta-50"
                                                        : "text-magenta-300 hover:text-magenta-500 hover:bg-magenta-50"
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

                                    <div className="space-y-1.5 mb-4">
                                        {clinic.address && (
                                            <p className="flex items-center gap-2 text-xs text-magenta-600">
                                                <MapPin className="w-3.5 h-3.5 text-magenta-400 flex-shrink-0" />
                                                {clinic.address}
                                            </p>
                                        )}
                                        {clinic.phone && (
                                            <p className="flex items-center gap-2 text-xs text-magenta-600">
                                                <Phone className="w-3.5 h-3.5 text-magenta-400 flex-shrink-0" />
                                                {clinic.phone}
                                            </p>
                                        )}
                                        {clinic.hours && (
                                            <p className="flex items-center gap-2 text-xs text-magenta-600">
                                                <Clock className="w-3.5 h-3.5 text-magenta-400 flex-shrink-0" />
                                                {clinic.hours}
                                            </p>
                                        )}
                                    </div>

                                    {/* Doctors */}
                                    {clinic.doctors.length > 0 && (
                                        <div className="mb-4">
                                            <p className="text-[10px] font-bold text-magenta-400 uppercase tracking-wider mb-1.5">Doctors</p>
                                            <div className="space-y-1">
                                                {clinic.doctors.map((doc, di) => (
                                                    <div key={di} className="flex items-center gap-2">
                                                        <Stethoscope className="w-3.5 h-3.5 text-magenta-400 flex-shrink-0" />
                                                        <span className="text-xs text-magenta-700 font-medium">{doc.name}</span>
                                                        <span className="text-[10px] text-magenta-400">· {doc.specialization}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Service Fees */}
                                    <div className="mb-4">
                                        <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-magenta-50 border border-magenta-100 text-xs">
                                            <span className="font-semibold text-magenta-700">Service Fee</span>
                                            <span className="text-magenta-400">:</span>
                                            <span className="font-bold text-magenta-600">
                                                {clinic.consultationFee && !isNaN(Number(clinic.consultationFee)) && Number(clinic.consultationFee) > 0
                                                    ? `Starts at ₱${Number(clinic.consultationFee).toLocaleString()}`
                                                    : clinic.consultationFee
                                                    ? `Starts at ₱${clinic.consultationFee}`
                                                    : "Inquire at clinic"}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setDetailModal(clinic.id);
                                                setActiveClinicId(clinic.id);
                                                if (clinic.lat !== null && clinic.lng !== null) {
                                                    setFlyTarget([clinic.lat, clinic.lng]);
                                                }
                                            }}
                                            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-full bg-white border border-magenta-200 text-magenta-600 text-xs font-semibold hover:bg-magenta-50 transition-colors"
                                        >
                                            View Details
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                goToAppointment(clinic.id);
                                            }}
                                            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-full bg-magenta-500 text-white text-xs font-semibold hover:bg-magenta-600 transition-colors active:scale-[0.96]"
                                        >
                                            <Calendar className="w-3.5 h-3.5" /> Appointment
                                        </button>
                                    </div>
                                </motion.div>
                            ))
                        ) : dbClinics.length === 0 ? (
                            /* Clean Empty State: No clinics registered yet */
                            <div className="bg-white rounded-[24px] p-8 sm:p-10 text-center shadow-[0_2px_12px_rgba(160,25,90,0.06)] border border-magenta-100">
                                <div className="w-16 h-16 rounded-full bg-magenta-50 flex items-center justify-center mx-auto mb-4">
                                    <Building2 className="w-8 h-8 text-magenta-400" />
                                </div>
                                <h3 className="text-base sm:text-lg font-display font-bold text-magenta-900 mb-2">
                                    No clinics registered yet
                                </h3>
                                <p className="text-xs text-magenta-600/80 max-w-sm mx-auto leading-relaxed">
                                    There are currently no verified clinic accounts registered in the database. As clinics register and are verified, they will automatically appear here and on the map.
                                </p>
                            </div>
                        ) : activeTab === "saved" ? (
                            /* Empty Saved Tab */
                            <div className="bg-white rounded-[24px] p-8 text-center shadow-[0_2px_12px_rgba(160,25,90,0.06)] border border-magenta-100">
                                <Bookmark className="w-10 h-10 text-magenta-200 mx-auto mb-3" />
                                <p className="text-magenta-600 text-sm font-semibold">No saved clinics yet</p>
                                <p className="text-magenta-400 text-xs mt-1">Tap the bookmark icon on any clinic card to save it here</p>
                                <button
                                    onClick={() => setActiveTab("all")}
                                    className="mt-4 px-4 py-2 rounded-full bg-magenta-500 text-white text-xs font-semibold hover:bg-magenta-600 transition-colors"
                                >
                                    Browse all clinics
                                </button>
                            </div>
                        ) : (
                            /* Empty Filter/Search Result */
                            <div className="bg-white rounded-[24px] p-8 text-center shadow-[0_2px_12px_rgba(160,25,90,0.06)] border border-magenta-100">
                                <Search className="w-10 h-10 text-magenta-200 mx-auto mb-3" />
                                <p className="text-magenta-800 text-sm font-semibold mb-1">No clinics match your search</p>
                                <p className="text-magenta-400 text-xs mb-4">
                                    Try adjusting your search terms or clearing the district filter
                                </p>
                                <button
                                    onClick={() => {
                                        setSearchQuery("");
                                        setSelectedDistrict("All Districts");
                                    }}
                                    className="px-4 py-2 rounded-full bg-magenta-500 text-white text-xs font-semibold hover:bg-magenta-600 transition-colors"
                                >
                                    Clear filters
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Map */}
                    <div ref={mapRef} className="lg:col-span-3 bg-white rounded-[20px] shadow-[0_4px_24px_rgba(160,25,90,0.08)] overflow-hidden min-h-[400px] lg:min-h-[600px] relative">
                        {React.createElement(
                            MapContainer as any,
                            {
                                center: [10.3157, 123.8854],
                                zoom: 12,
                                style: { height: "100%", width: "100%" },
                                className: "rounded-[20px]",
                                onClick: (e: any) => {
                                    if (e.originalEvent?.target?.classList?.contains("leaflet-marker-icon")) {
                                        return;
                                    }
                                },
                            },
                            <>
                                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                                <MapEventHandler onMapInteraction={() => setDetailModal(null)} />
                                <FlyToController target={flyTarget} />
                                {mapMarkers.map((clinic) => (
                                    <Marker
                                        key={clinic.id}
                                        position={[clinic.lat, clinic.lng] as L.LatLngExpression}
                                        eventHandlers={{
                                            click: (e: L.LeafletMouseEvent) => {
                                                e.originalEvent?.stopPropagation?.();
                                                setDetailModal(clinic.id);
                                            },
                                        } as any}
                                    >
                                        <Popup>
                                            <div className="w-max text-sm">
                                                <h4 className="font-bold text-magenta-900">{clinic.name}</h4>
                                                {clinic.verified && (
                                                    <p className="text-xs text-green-600 font-semibold">✓ Verified</p>
                                                )}
                                                {clinic.address && <p className="text-xs text-magenta-700 mt-1">{clinic.address}</p>}
                                                {clinic.phone && <p className="text-xs text-magenta-500">{clinic.phone}</p>}
                                                <p className="text-[10px] text-magenta-400 mt-1">Click pin to view details</p>
                                            </div>
                                        </Popup>
                                    </Marker>
                                ))}
                            </>
                        )}

                        {/* Map pin count */}
                        <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-md rounded-2xl px-4 py-2 shadow-lg z-30 pointer-events-none border border-magenta-100">
                            <p className="text-xs text-magenta-700 font-medium flex items-center gap-1.5">
                                <MapPin className="w-3.5 h-3.5 text-magenta-500" />
                                <span>
                                    {mapMarkers.length === 0
                                        ? "No clinic pins on map"
                                        : `${mapMarkers.length} clinic pin${mapMarkers.length !== 1 ? "s" : ""} on map`}
                                </span>
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
