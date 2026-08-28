import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, MapPin, Phone, Clock, CheckCircle2, ChevronDown, Calendar, X, Stethoscope, Bookmark, BookmarkCheck } from "lucide-react";
/* ── Condition → keywords mapping (for flexible matching) ──────── */
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
const districts = [
    "All Districts",
    "Alcantara",
    "Alcoy",
    "Alegria",
    "Aloguinsan",
    "Argao",
    "Asturias",
    "Badian",
    "Balamban",
    "Bantayan",
    "Barili",
    "Bogo City",
    "Boljoon",
    "Borbon",
    "Carmen",
    "Carcar City",
    "Catmon",
    "Compostela",
    "Consolacion",
    "Cordova",
    "Daanbantayan",
    "Dalaguete",
    "Danao City",
    "Dumanjug",
    "Ginatilan",
    "Lapu-Lapu City",
    "Liloan",
    "Madridejos",
    "Malabuyoc",
    "Medellin",
    "Minglanilla",
    "Moalboal",
    "Naga City",
    "Oslob",
    "Pinamungajan",
    "Ronda",
    "Samboan",
    "San Fernando",
    "San Remigio",
    "Santa Fe",
    "Santander",
    "Sibonga",
    "Sogod",
    "Tabogon",
    "Tabuelan",
    "Talisay City",
    "Toledo City",
    "Tuburan",
];
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
    target: [
        number,
        number
    ] | null;
}) => {
    const map = useMap();
    useEffect(() => {
        if (target) {
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
// Use custom icon as the default for all Leaflet markers.
L.Marker.prototype.options.icon = magentaPinIcon;
// TODO: Load verified clinic listings from Supabase
const clinicsData: Array<{
    id: number;
    name: string;
    address: string;
    phone: string;
    facebook: string;
    hours: string;
    verified: boolean;
    district: string;
    lat: number;
    lng: number;
    doctors: Array<{ name: string; specialization: string }>;
    conditionsTreated: string[];
    consultationFee: string;
}> = [];
type AdminClinicApplication = {
    id: number;
    name: string;
    status: "pending" | "verified" | "rejected";
};
const normalizeClinicName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const isClinicNameMatch = (left: string, right: string) => {
    const a = normalizeClinicName(left);
    const b = normalizeClinicName(right);
    return a === b || a.includes(b) || b.includes(a);
};
export default function FindClinicsPage() {
    const navigate = useNavigate();
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedDistrict, setSelectedDistrict] = useState("All Districts");
    const [detailModal, setDetailModal] = useState<number | null>(null);
    const [flyTarget, setFlyTarget] = useState<[
        number,
        number
    ] | null>(null);
    const [activeClinicId, setActiveClinicId] = useState<number | null>(null);
    const [activeTab, setActiveTab] = useState<"all" | "saved">("all");
    const mapRef = useRef<HTMLDivElement>(null);
    // TODO: Load current user email from Supabase auth session
    const currentEmail = "";
    // TODO: Load saved clinics from Supabase
    const savedClinicIds: number[] = [];
    const toggleSave = (e: React.MouseEvent, _clinicId: number) => {
        void _clinicId;
        e.stopPropagation();
        if (!currentEmail) {
            navigate("/login", { state: { from: "/find-clinics" } });
            return;
        }
        // TODO: Save/unsave clinic via Supabase
    };
    // TODO: Load verified clinic applications from Supabase
    const adminClinicApplications = useMemo<AdminClinicApplication[]>(() => [], []);
    // TODO: Load clinic settings from Supabase
    function loadClinicSettings(): {
        name?: string;
        servicesOffered?: string;
        location?: string;
        consultationFee?: string;
    } | null {
        return null;
    }
    const allClinicSettings = loadClinicSettings();
    // Read last scan result to drive recommendations
    const parseServices = (raw: string): string[] => {
        if (!raw)
            return [];
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed))
                return parsed as string[];
        }
        catch {
            /* ignore invalid JSON */
        }
        return raw.split(",").map((s) => s.trim()).filter(Boolean);
    };
    const clinicsWithVerification = useMemo(() => clinicsData.map((clinic) => {
        const matched = adminClinicApplications.find((app) => isClinicNameMatch(app.name, clinic.name));
        // Merge live settings services and fee if this clinic matches the registered clinic
        const mergedConditions = [...clinic.conditionsTreated];
        let mergedFee = clinic.consultationFee ?? "";
        if (allClinicSettings?.name &&
            isClinicNameMatch(allClinicSettings.name, clinic.name)) {
            if (allClinicSettings.servicesOffered) {
                const liveServices = parseServices(allClinicSettings.servicesOffered);
                liveServices.forEach((s) => {
                    if (!mergedConditions.includes(s))
                        mergedConditions.push(s);
                });
            }
            if (allClinicSettings.consultationFee) {
                mergedFee = allClinicSettings.consultationFee;
            }
        }
        return {
            ...clinic,
            conditionsTreated: mergedConditions,
            consultationFee: mergedFee,
            verified: matched ? matched.status === "verified" : clinic.verified,
        };
    }), [adminClinicApplications, allClinicSettings]);
    // Pending/rejected clinics are not searchable; only verified clinics are visible.
    const searchableClinics = clinicsWithVerification.filter((clinic) => clinic.verified);
    const filteredClinics = searchableClinics.filter((clinic) => {
        const matchesSearch = clinic.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            clinic.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
            clinic.doctors.some((doc) => doc.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
            clinic.conditionsTreated.some((cond) => cond.toLowerCase().includes(searchQuery.toLowerCase()));
        const matchesDistrict = selectedDistrict === "All Districts" || clinic.district === selectedDistrict;
        const matchesTab = activeTab === "all" || savedClinicIds.includes(clinic.id);
        return matchesSearch && matchesDistrict && matchesTab;
    });
    const selectedClinicData = clinicsWithVerification.find((c) => c.id === detailModal);
    const goToAppointment = (clinicId: number) => {
        // TODO: Check Supabase auth session before navigating
        navigate(`/appointment?clinic=${clinicId}`);
    };
    return (<div className="min-h-screen bg-magenta-50 pt-8 pb-0">
      {/* ── Full-screen Detail Modal ────────────────────────────────── */}
      <AnimatePresence>
        {detailModal && selectedClinicData && (<motion.div key="clinic-detail-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setDetailModal(null)}>
            <motion.div initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.97 }} transition={{ type: "spring", bounce: 0.2, duration: 0.4 }} className="bg-white rounded-[28px] shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="sticky top-0 bg-white rounded-t-[28px] px-6 pt-6 pb-4 border-b border-gray-100 flex items-start justify-between z-10">
                <div>
                  <h2 className="text-xl font-display font-bold text-magenta-900 leading-tight">
                    {selectedClinicData.name}
                  </h2>
                  {selectedClinicData.verified && (<span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-green-100 text-green-700 text-[11px] font-bold mt-1.5">
                      <CheckCircle2 className="w-3 h-3"/> Verified Clinic
                    </span>)}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                  <button onClick={(e) => toggleSave(e, selectedClinicData.id)} className={cn("p-2 rounded-full transition-colors", savedClinicIds.includes(selectedClinicData.id)
                ? "bg-magenta-100 text-magenta-600 hover:bg-magenta-200"
                : "hover:bg-magenta-50 text-magenta-300 hover:text-magenta-500")} title={savedClinicIds.includes(selectedClinicData.id) ? "Unsave clinic" : "Save clinic"}>
                    {savedClinicIds.includes(selectedClinicData.id)
                ? <BookmarkCheck className="w-5 h-5"/>
                : <Bookmark className="w-5 h-5"/>}
                  </button>
                  <button onClick={() => setDetailModal(null)} className="p-2 rounded-full hover:bg-magenta-50 transition-colors">
                    <X className="w-5 h-5 text-magenta-400"/>
                  </button>
                </div>
              </div>

              <div className="px-6 py-5 space-y-5">
                {/* Contact Info */}
                <div className="space-y-2">
                  <p className="flex items-start gap-2.5 text-sm text-magenta-700">
                    <MapPin className="w-4 h-4 text-magenta-400 flex-shrink-0 mt-0.5"/>
                    {selectedClinicData.address}
                  </p>
                  <p className="flex items-center gap-2.5 text-sm text-magenta-700">
                    <Phone className="w-4 h-4 text-magenta-400 flex-shrink-0"/>
                    {selectedClinicData.phone}
                  </p>
                  <p className="flex items-center gap-2.5 text-sm text-magenta-700">
                    <Clock className="w-4 h-4 text-magenta-400 flex-shrink-0"/>
                    {selectedClinicData.hours}
                  </p>
                </div>

                {/* Doctors */}
                <div>
                  <p className="text-[11px] font-bold text-magenta-400 uppercase tracking-wider mb-2">Doctors</p>
                  <div className="space-y-2">
                    {selectedClinicData.doctors.map((doc, i) => (<div key={i} className="flex items-start gap-2.5 p-3 rounded-xl bg-magenta-50">
                        <Stethoscope className="w-4 h-4 text-magenta-500 flex-shrink-0 mt-0.5"/>
                        <div>
                          <p className="text-sm font-semibold text-magenta-900">{doc.name}</p>
                          <p className="text-xs text-magenta-500">{doc.specialization}</p>
                        </div>
                      </div>))}
                  </div>
                </div>

                {/* Conditions / Services */}
                <div>
                  <p className="text-[11px] font-bold text-magenta-400 uppercase tracking-wider mb-2">Conditions &amp; Services Treated</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedClinicData.conditionsTreated.map((cond, i) => (<span key={i} className="px-3 py-1 rounded-full bg-magenta-100 text-magenta-700 text-xs font-medium">
                        {cond}
                      </span>))}
                  </div>
                </div>

                {/* Service Fees */}
                {selectedClinicData.consultationFee && (<div>
                    <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-magenta-50 border border-magenta-100">
                      <span className="text-sm font-semibold text-magenta-700">Service Fee</span>
                      <span className="text-sm text-magenta-400">:</span>
                      <span className="font-bold text-magenta-600 text-sm">Starts at ₱{Number(selectedClinicData.consultationFee).toLocaleString()}</span>
                    </div>
                  </div>)}

                {/* Action buttons */}
                <div className="pt-2">
                  <button onClick={() => {
                setDetailModal(null);
                goToAppointment(selectedClinicData.id);
            }} className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-magenta-500 text-white text-sm font-bold hover:bg-magenta-600 transition-colors active:scale-[0.98]">
                    <Calendar className="w-4 h-4"/> Book Appointment
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>)}
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
              <Search className="w-4 h-4 text-magenta-400 flex-shrink-0"/>
              <input type="text" placeholder="Search clinic name or doctor name..." className="flex-1 bg-transparent outline-none text-sm text-magenta-900 placeholder:text-magenta-300" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}/>
            </div>

            {/* District */}
            <div className="relative">
              <select value={selectedDistrict} onChange={(e) => setSelectedDistrict(e.target.value)} className="appearance-none bg-magenta-50 rounded-full px-4 py-2.5 pr-10 text-sm text-magenta-900 outline-none cursor-pointer w-full sm:w-auto">
                {districts.map((d) => (<option key={d} value={d}>
                    {d}
                  </option>))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-magenta-400 pointer-events-none"/>
            </div>
          </div>

          <div className="flex gap-2 mt-3">
            <span className="px-4 py-1.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3"/> Showing verified clinics only
            </span>
            <button onClick={() => setActiveTab("all")} className={cn("px-4 py-1.5 rounded-full text-xs font-semibold transition-colors", activeTab === "all"
            ? "bg-magenta-500 text-white"
            : "bg-magenta-50 text-magenta-600 hover:bg-magenta-100")}>
              All Clinics
            </button>
            <button onClick={() => {
            if (!currentEmail) {
                navigate("/login", { state: { from: "/find-clinics" } });
                return;
            }
            setActiveTab("saved");
        }} className={cn("px-4 py-1.5 rounded-full text-xs font-semibold transition-colors flex items-center gap-1.5", activeTab === "saved"
            ? "bg-magenta-500 text-white"
            : "bg-magenta-50 text-magenta-600 hover:bg-magenta-100")}>
              <Bookmark className="w-3 h-3"/>
              Saved ({savedClinicIds.length})
            </button>
          </div>
        </div>

        {/* Split Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 pb-16">
          {/* Clinic List */}
          <div className="lg:col-span-2 space-y-3 max-h-[600px] overflow-y-auto pr-1">
            {filteredClinics.map((clinic, i) => (<motion.div key={clinic.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} onClick={() => {
                setActiveClinicId(clinic.id);
                setFlyTarget([clinic.lat, clinic.lng]);
                // scroll map into view on small screens
                mapRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }} className={cn("bg-white rounded-[20px] p-5 cursor-pointer transition-all", activeClinicId === clinic.id
                ? "shadow-[0_4px_24px_rgba(160,25,90,0.18)] border-2 border-magenta-400"
                : "shadow-[0_2px_12px_rgba(160,25,90,0.06)] border-2 border-transparent hover:shadow-[0_4px_24px_rgba(160,25,90,0.15)] hover:border-magenta-100")}>
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-display font-bold text-magenta-900 text-sm">
                    {clinic.name}
                  </h3>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {clinic.verified ? (<span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">
                        <CheckCircle2 className="w-3 h-3"/> Verified
                      </span>) : (<span className="px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-bold opacity-70">
                        Pending
                      </span>)}
                    <button type="button" onClick={(e) => toggleSave(e, clinic.id)} className={cn("p-1.5 rounded-full transition-colors", savedClinicIds.includes(clinic.id)
                ? "text-magenta-500 bg-magenta-50"
                : "text-magenta-300 hover:text-magenta-500 hover:bg-magenta-50")} title={savedClinicIds.includes(clinic.id) ? "Unsave clinic" : "Save clinic"}>
                      {savedClinicIds.includes(clinic.id)
                ? <BookmarkCheck className="w-4 h-4"/>
                : <Bookmark className="w-4 h-4"/>}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5 mb-4">
                  <p className="flex items-center gap-2 text-xs text-magenta-600">
                    <MapPin className="w-3.5 h-3.5 text-magenta-400 flex-shrink-0"/>
                    {clinic.address}
                  </p>
                  <p className="flex items-center gap-2 text-xs text-magenta-600">
                    <Phone className="w-3.5 h-3.5 text-magenta-400 flex-shrink-0"/>
                    {clinic.phone}
                  </p>
                  <p className="flex items-center gap-2 text-xs text-magenta-600">
                    <Clock className="w-3.5 h-3.5 text-magenta-400 flex-shrink-0"/>
                    {clinic.hours}
                  </p>
                </div>

                {/* Doctors */}
                <div className="mb-4">
                  <p className="text-[10px] font-bold text-magenta-400 uppercase tracking-wider mb-1.5">Doctors</p>
                  <div className="space-y-1">
                    {clinic.doctors.map((doc, di) => (<div key={di} className="flex items-center gap-2">
                        <Stethoscope className="w-3.5 h-3.5 text-magenta-400 flex-shrink-0"/>
                        <span className="text-xs text-magenta-700 font-medium">{doc.name}</span>
                        <span className="text-[10px] text-magenta-400">· {doc.specialization}</span>
                      </div>))}
                  </div>
                </div>

                {/* Service Fees */}
                {clinic.consultationFee && (<div className="mb-4">
                    <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-magenta-50 border border-magenta-100 text-xs">
                      <span className="font-semibold text-magenta-700">Service Fee</span>
                      <span className="text-magenta-400">:</span>
                      <span className="font-bold text-magenta-600">Starts at ₱{Number(clinic.consultationFee).toLocaleString()}</span>
                    </div>
                  </div>)}

                <div className="flex gap-2">
                  <button type="button" onClick={(e) => {
                e.stopPropagation();
                setDetailModal(clinic.id);
                setActiveClinicId(clinic.id);
                setFlyTarget([clinic.lat, clinic.lng]);
            }} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-full bg-white border border-magenta-200 text-magenta-600 text-xs font-semibold hover:bg-magenta-50 transition-colors">
                    View Details
                  </button>
                  <button type="button" onClick={(e) => {
                e.stopPropagation();
                goToAppointment(clinic.id);
            }} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-full bg-magenta-500 text-white text-xs font-semibold hover:bg-magenta-600 transition-colors active:scale-[0.96]">
                    <Calendar className="w-3.5 h-3.5"/> Appointment
                  </button>
                </div>
              </motion.div>))}

            {filteredClinics.length === 0 && (<div className="bg-white rounded-[20px] p-8 text-center">
                {activeTab === "saved" ? (<>
                    <Bookmark className="w-10 h-10 text-magenta-200 mx-auto mb-3"/>
                    <p className="text-magenta-400 text-sm font-medium">No saved clinics yet</p>
                    <p className="text-magenta-300 text-xs mt-1">Tap the bookmark icon on any clinic to save it here</p>
                    <button onClick={() => setActiveTab("all")} className="mt-4 px-4 py-2 rounded-full bg-magenta-500 text-white text-xs font-semibold hover:bg-magenta-600 transition-colors">
                      Browse all clinics
                    </button>
                  </>) : (<>
                    <Search className="w-10 h-10 text-magenta-200 mx-auto mb-3"/>
                    <p className="text-magenta-400 text-sm">No clinics found matching your criteria</p>
                  </>)}
              </div>)}
          </div>

          {/* Map */}
          <div ref={mapRef} className="lg:col-span-3 bg-white rounded-[20px] shadow-[0_4px_24px_rgba(160,25,90,0.08)] overflow-hidden min-h-[400px] lg:min-h-[600px] relative">
            {React.createElement(MapContainer as any, {
            center: [10.3157, 123.8854],
            zoom: 12,
            style: { height: "100%", width: "100%" },
            className: "rounded-[20px]",
            onClick: (e: any) => {
                // Only close modal on direct map click, not on marker click
                if (e.originalEvent?.target?.classList?.contains("leaflet-marker-icon")) {
                    return;
                }
            },
        }, <>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
                <MapEventHandler onMapInteraction={() => setDetailModal(null)}/>
                <FlyToController target={flyTarget}/>
                {filteredClinics.map((clinic) => (<Marker key={clinic.id} position={[clinic.lat, clinic.lng] as L.LatLngExpression} eventHandlers={{
                    click: (e: L.LeafletMouseEvent) => {
                        e.originalEvent?.stopPropagation?.();
                        setDetailModal(clinic.id);
                    },
                } as any}>
                    <Popup>
                      <div className="w-max text-sm">
                        <h4 className="font-bold text-magenta-900">{clinic.name}</h4>
                        {clinic.verified && (<p className="text-xs text-green-600 font-semibold">✓ Verified</p>)}
                        <p className="text-xs text-magenta-700 mt-1">{clinic.address}</p>
                        <p className="text-xs text-magenta-500">{clinic.phone}</p>
                        <p className="text-[10px] text-magenta-400 mt-1">Click pin to view details</p>
                      </div>
                    </Popup>
                  </Marker>))}
              </>)}

            {/* Frosted overlay info */}
            <div className="absolute bottom-4 left-4 bg-white/80 backdrop-blur-md rounded-2xl px-4 py-2 shadow-lg z-30 pointer-events-none">
              <p className="text-xs text-magenta-700 font-medium">
                📍 {filteredClinics.length} clinic{filteredClinics.length !== 1 ? "s" : ""} found
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>);
}
