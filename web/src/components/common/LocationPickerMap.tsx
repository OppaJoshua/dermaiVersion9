import React, { useState, useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Search, MapPin, Navigation, Loader2, Check, AlertCircle } from "lucide-react";

// Custom Magenta Pin Icon for Location Picker
const createPickerPin = () => {
  const svgString = `
    <svg width="36" height="46" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="3" stdDeviation="2" flood-color="#000" flood-opacity="0.3"/>
      </filter>
      <path d="M16 0C9.37 0 4 5.37 4 12c0 7 11 26 12 28c1-2 12-21 12-28c0-6.63-5.37-12-12-12z" fill="#c0166a" stroke="#8a0f4c" stroke-width="1.2" filter="url(#shadow)"/>
      <circle cx="16" cy="12" r="4.5" fill="white"/>
      <circle cx="16" cy="12" r="2" fill="#c0166a"/>
    </svg>
  `;
  return L.icon({
    iconUrl: `data:image/svg+xml;base64,${btoa(svgString)}`,
    iconSize: [36, 46],
    iconAnchor: [18, 46],
    popupAnchor: [0, -46],
  });
};

const pickerPinIcon = createPickerPin();

// Default coordinates: Cebu City, Philippines
const DEFAULT_CENTER: [number, number] = [10.3157, 123.8854];

interface LocationPickerMapProps {
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number, lng: number, addressSuggestion?: string) => void;
  disabled?: boolean;
}

// Subcomponent to handle map clicks and move marker
function MapEventsHandler({ onSelect }: { onSelect: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => {
      onSelect(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Subcomponent to animate map movement when target changes
function ChangeView({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    if (center && !isNaN(center[0]) && !isNaN(center[1])) {
      map.flyTo(center, Math.max(map.getZoom(), 15), { duration: 1.2 });
    }
  }, [center, map]);
  return null;
}

export default function LocationPickerMap({
  latitude,
  longitude,
  onChange,
  disabled = false,
}: LocationPickerMapProps) {
  const [position, setPosition] = useState<[number, number] | null>(
    latitude && longitude && !isNaN(latitude) && !isNaN(longitude)
      ? [latitude, longitude]
      : null
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Array<{ display_name: string; lat: string; lon: string }>>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Sync state if props change externally
  useEffect(() => {
    if (latitude && longitude && !isNaN(latitude) && !isNaN(longitude)) {
      setPosition([latitude, longitude]);
    }
  }, [latitude, longitude]);

  // Close search dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handlePositionSelect = (lat: number, lng: number, addressSuggestion?: string) => {
    if (disabled) return;
    const roundedLat = parseFloat(lat.toFixed(7));
    const roundedLng = parseFloat(lng.toFixed(7));
    setPosition([roundedLat, roundedLng]);
    onChange(roundedLat, roundedLng, addressSuggestion);
    setGeoError(null);
  };

  // Search places using OpenStreetMap Nominatim Geocoding
  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    setIsSearching(true);
    setGeoError(null);
    try {
      // Prioritize Philippines search context
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          query
        )}&countrycodes=ph&limit=5`
      );
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setSearchResults(data);
        setShowDropdown(true);
      } else {
        // Fallback without country code constraint
        const fallbackRes = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`
        );
        const fallbackData = await fallbackRes.json();
        setSearchResults(Array.isArray(fallbackData) ? fallbackData : []);
        setShowDropdown(true);
      }
    } catch {
      setGeoError("Search service temporarily unavailable. You can click directly on the map to place the pin.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectSearchResult = (result: { display_name: string; lat: string; lon: string }) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    if (!isNaN(lat) && !isNaN(lng)) {
      handlePositionSelect(lat, lng, result.display_name);
      setSearchQuery(result.display_name.split(",")[0] || result.display_name);
      setShowDropdown(false);
    }
  };

  // Get current device GPS location
  const handleUseCurrentLocation = () => {
    if (disabled) return;
    if (!navigator.geolocation) {
      setGeoError("Geolocation is not supported by your browser.");
      return;
    }

    setIsLocating(true);
    setGeoError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        handlePositionSelect(lat, lng);
      },
      (err) => {
        setIsLocating(false);
        setGeoError(
          err.code === 1
            ? "Location permission was denied. Please allow location access or click on the map to set the pin."
            : "Unable to retrieve GPS location. Please click on the map."
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const currentCenter = position || DEFAULT_CENTER;

  return (
    <div className="space-y-2.5 w-full">
      {/* Search Bar & GPS Controls */}
      <div className="flex flex-col sm:flex-row gap-2 relative" ref={searchContainerRef}>
        <div className="relative flex-1">
          <input
            type="text"
            disabled={disabled}
            placeholder="Search street, barangay, or landmark (e.g. Ayala Center Cebu)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSearch();
              }
            }}
            className="w-full pl-9 pr-20 py-2.5 rounded-xl border border-gray-200 text-xs sm:text-sm text-gray-900 outline-none focus:border-[#c0166a] focus:ring-2 focus:ring-[#c0166a]/15 transition-all bg-white disabled:bg-gray-50 disabled:text-gray-500 shadow-sm"
          />
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <button
            type="button"
            disabled={disabled || isSearching || !searchQuery.trim()}
            onClick={() => handleSearch()}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-pink-50 text-[#c0166a] hover:bg-pink-100/80 text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
          >
            {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Search"}
          </button>
        </div>

        <button
          type="button"
          disabled={disabled || isLocating}
          onClick={handleUseCurrentLocation}
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white border border-gray-200 hover:border-pink-300 hover:bg-pink-50 text-[#c0166a] text-xs font-bold transition-all shrink-0 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          title="Detect Current GPS Location"
        >
          {isLocating ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Navigation className="w-3.5 h-3.5" />
          )}
          <span>Use My GPS</span>
        </button>

        {/* Search Results Dropdown */}
        {showDropdown && searchResults.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1.5 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden max-h-56 overflow-y-auto divide-y divide-gray-50">
            {searchResults.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSelectSearchResult(item)}
                className="w-full px-4 py-2.5 text-left text-xs hover:bg-pink-50/60 flex items-start gap-2.5 transition-colors group"
              >
                <MapPin className="w-3.5 h-3.5 text-[#c0166a] shrink-0 mt-0.5" />
                <span className="text-gray-700 group-hover:text-gray-900 line-clamp-2 leading-relaxed">
                  {item.display_name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {geoError && (
        <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>{geoError}</span>
        </div>
      )}

      {/* Leaflet Map Box */}
      <div className="relative w-full h-[260px] sm:h-[300px] rounded-2xl overflow-hidden border border-gray-200 shadow-inner z-0">
        <MapContainer
          center={currentCenter}
          zoom={position ? 15 : 12}
          scrollWheelZoom={true}
          style={{ height: "100%", width: "100%" }}
          className="z-0"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapEventsHandler onSelect={handlePositionSelect} />
          <ChangeView center={currentCenter} />
          {position && (
            <Marker
              position={position}
              icon={pickerPinIcon}
              draggable={!disabled}
              eventHandlers={{
                dragend: (e) => {
                  const marker = e.target;
                  const newPos = marker.getLatLng();
                  handlePositionSelect(newPos.lat, newPos.lng);
                },
              }}
            />
          )}
        </MapContainer>

        {/* Floating helper instruction pill */}
        <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-xl shadow-md border border-gray-100 text-[11px] font-medium text-gray-700 pointer-events-none z-[400] flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-[#c0166a]" />
          <span>Click map to place pin</span>
        </div>
      </div>

      {/* Selected Coordinates Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-gray-50 border border-gray-100 text-xs">
        <div className="flex items-center gap-2">
          {position ? (
            <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>Location Pinned</span>
            </span>
          ) : (
            <span className="text-gray-400 font-medium">No map pin selected yet</span>
          )}
        </div>
        {position && (
          <span className="text-gray-500 font-mono text-[11px]">
            Lat: <strong className="text-gray-800">{position[0]}</strong>, Lng:{" "}
            <strong className="text-gray-800">{position[1]}</strong>
          </span>
        )}
      </div>
    </div>
  );
}
