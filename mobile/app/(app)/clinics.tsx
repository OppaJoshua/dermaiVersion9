import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Image,
  Dimensions,
  Modal,
  Linking,
  Alert,
  PanResponder,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, CEBU_DISTRICTS, SAMPLE_CLINICS } from '@/lib/constants';
import {
  getClinics,
  getCurrentUser,
  getSavedClinics,
  saveClinic,
  unsaveClinic,
  type ClinicRecord,
  type PatientAccount,
} from '@/lib/store';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Carto Voyager Basemap API Key
const CARTO_API_KEY = 'cb1_4rf0_1_52a456f79acb06df41f3abb6';

// Default map center: Cebu City Capitol / Fuente area
const DEFAULT_CENTER = { lat: 10.3157, lng: 123.8854 };

// Common Conditions matching Web FindClinicsPage
const COMMON_CONDITIONS = [
  'All Conditions',
  'Melasma',
  'Acne Vulgaris',
  'Atopic Dermatitis',
  'Contact Dermatitis',
  'Vitiligo',
];

const CONDITION_SYNONYMS: Record<string, string[]> = {
  'acne vulgaris': ['acne vulgaris', 'acne', 'pimples', 'blackheads', 'whiteheads', 'breakouts', 'comedones'],
  'atopic dermatitis': ['atopic dermatitis', 'eczema', 'itchy rash', 'itch', 'dry skin', 'dermatitis'],
  'contact dermatitis': ['contact dermatitis', 'dermatitis', 'skin irritation', 'skin allergy', 'allergic rash'],
  'melasma': ['melasma', 'hyperpigmentation', 'pigmentation', 'dark patches', 'dark spots'],
  'vitiligo': ['vitiligo', 'depigmentation', 'white patches', 'white spots', 'hypopigmentation'],
};

function clinicTreatsCondition(clinic: ClinicRecord, condition: string): boolean {
  if (!condition || condition === 'All Conditions') return true;
  const condLower = condition.toLowerCase().trim();
  const synonyms = CONDITION_SYNONYMS[condLower] || [condLower];

  const allClinicText = [
    clinic.name,
    ...(clinic.conditionsTreated || []),
    ...(clinic.doctors || []).map((d) => `${d.name} ${d.specialization}`),
  ]
    .join(' ')
    .toLowerCase();

  return synonyms.some((syn) => allClinicText.includes(syn));
}

function parseNumericFee(feeStr: string | null | undefined): number {
  if (!feeStr) return 500;
  const num = parseFloat(String(feeStr).replace(/[^0-9.]/g, ''));
  return isNaN(num) ? 500 : num;
}

function isClinicOpenToday(hoursStr: string): boolean {
  if (!hoursStr) return true;
  const lower = hoursStr.toLowerCase();
  const now = new Date();
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const shortDays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const currentDay = days[now.getDay()];
  const currentShort = shortDays[now.getDay()];

  if (lower.includes('daily') || lower.includes('every day') || lower.includes('everyday')) return true;
  if (lower.includes(currentDay) || lower.includes(currentShort)) return true;
  if (lower.includes('mon - sat') || lower.includes('monday - saturday') || lower.includes('monday-saturday') || lower.includes('mon-sat')) {
    return now.getDay() >= 1 && now.getDay() <= 6;
  }
  if (lower.includes('mon - fri') || lower.includes('monday - friday') || lower.includes('monday-friday') || lower.includes('mon-fri')) {
    return now.getDay() >= 1 && now.getDay() <= 5;
  }
  return true;
}

export default function ClinicsScreen() {
  const router = useRouter();
  const [user, setUser] = useState<PatientAccount | null>(null);
  const [allClinics, setAllClinics] = useState<ClinicRecord[]>([]);
  const [savedClinicIds, setSavedClinicIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
  const [query, setQuery] = useState('');
  const [district, setDistrict] = useState('All');
  const [conditionFilter, setConditionFilter] = useState('All Conditions');
  const [sortBy, setSortBy] = useState<'recommended' | 'fee_asc' | 'fee_desc' | 'name'>('recommended');
  const [selectedClinic, setSelectedClinic] = useState<ClinicRecord | null>(null);

  // Map state
  const [zoom, setZoom] = useState(13);
  const [mapCenter, setMapCenter] = useState(DEFAULT_CENTER);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const currentPanRef = useRef({ x: 0, y: 0 });
  const [selectedMapClinicId, setSelectedMapClinicId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadInitialData();
    }, [])
  );

  async function loadInitialData() {
    const clinicsData = await getClinics();
    setAllClinics(clinicsData);
    if (clinicsData.length > 0 && !selectedMapClinicId) {
      setSelectedMapClinicId(clinicsData[0].id);
    }

    const currentUser = await getCurrentUser();
    setUser(currentUser);
    if (currentUser) {
      const saved = await getSavedClinics(currentUser.id);
      setSavedClinicIds(saved);
    }
  }

  async function toggleSaveClinic(clinicId: string) {
    if (!user) {
      Alert.alert('Sign In Required', 'Please sign in to save your favorite clinics.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign In', onPress: () => router.push('/(auth)/login') },
      ]);
      return;
    }

    const isCurrentlySaved = savedClinicIds.includes(clinicId);
    if (isCurrentlySaved) {
      setSavedClinicIds((prev) => prev.filter((id) => id !== clinicId));
      await unsaveClinic(user.id, clinicId);
    } else {
      setSavedClinicIds((prev) => [...prev, clinicId]);
      await saveClinic(user.id, clinicId);
    }
  }

  // Filtered & sorted clinics matching Web FindClinicsPage
  const clinics = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = allClinics.filter((clinic) => {
      const matchesTerm =
        term.length === 0 ||
        clinic.name.toLowerCase().includes(term) ||
        clinic.address.toLowerCase().includes(term) ||
        clinic.doctors.some(
          (d) => d.name.toLowerCase().includes(term) || d.specialization.toLowerCase().includes(term)
        ) ||
        clinic.conditionsTreated.some((c) => c.toLowerCase().includes(term));

      const matchesDistrict = district === 'All' || clinic.district === district;
      const matchesCondition = clinicTreatsCondition(clinic, conditionFilter);

      return matchesTerm && matchesDistrict && matchesCondition;
    });

    return filtered.sort((a, b) => {
      const feeA = parseNumericFee(a.consultationFee);
      const feeB = parseNumericFee(b.consultationFee);
      if (sortBy === 'fee_asc') return feeA - feeB;
      if (sortBy === 'fee_desc') return feeB - feeA;
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return 0; // 'recommended' default order
    });
  }, [allClinics, query, district, conditionFilter, sortBy]);

  // Active clinic for the floating bottom card on Map view
  const activeMapClinic = useMemo(() => {
    if (clinics.length === 0) return null;
    if (!selectedMapClinicId) return clinics[0];
    return clinics.find((c) => c.id === selectedMapClinicId) || clinics[0];
  }, [clinics, selectedMapClinicId]);

  // PanResponder for smooth interactive map dragging
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3,
        onPanResponderGrant: () => {
          panStartRef.current = { ...currentPanRef.current };
        },
        onPanResponderMove: (_, gesture) => {
          const nextPan = {
            x: panStartRef.current.x + gesture.dx,
            y: panStartRef.current.y + gesture.dy,
          };
          currentPanRef.current = nextPan;
          setPanOffset(nextPan);
        },
        onPanResponderRelease: () => {},
      }),
    []
  );

  function recenterMap() {
    setMapCenter(DEFAULT_CENTER);
    currentPanRef.current = { x: 0, y: 0 };
    setPanOffset({ x: 0, y: 0 });
    setZoom(13);
  }

  function handleZoomIn() {
    if (zoom < 16) setZoom((z) => z + 1);
  }

  function handleZoomOut() {
    if (zoom > 11) setZoom((z) => z - 1);
  }

  function selectClinicOnMap(clinic: ClinicRecord) {
    setSelectedMapClinicId(clinic.id);
  }

  function nextMapClinic() {
    if (clinics.length <= 1) return;
    const currentIndex = clinics.findIndex((c) => c.id === activeMapClinic?.id);
    const nextIndex = (currentIndex + 1) % clinics.length;
    setSelectedMapClinicId(clinics[nextIndex].id);
  }

  function prevMapClinic() {
    if (clinics.length <= 1) return;
    const currentIndex = clinics.findIndex((c) => c.id === activeMapClinic?.id);
    const prevIndex = (currentIndex - 1 + clinics.length) % clinics.length;
    setSelectedMapClinicId(clinics[prevIndex].id);
  }

  // Calculate Map Tiles
  const mapTiles = useMemo(() => {
    const sinLat = Math.sin((mapCenter.lat * Math.PI) / 180);
    const clampedSin = Math.min(Math.max(sinLat, -0.9999), 0.9999);
    const totalPixels = 256 * Math.pow(2, zoom);

    const centerX = totalPixels * ((mapCenter.lng + 180) / 360);
    const centerY = totalPixels * (0.5 - Math.log((1 + clampedSin) / (1 - clampedSin)) / (4 * Math.PI));

    const centerTileX = Math.floor(centerX / 256);
    const centerTileY = Math.floor(centerY / 256);

    const offsetXInTile = centerX % 256;
    const offsetYInTile = centerY % 256;

    const tiles = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 3; dy++) {
        const tx = centerTileX + dx;
        const ty = centerTileY + dy;
        tiles.push({
          key: `${zoom}_${tx}_${ty}`,
          left: dx * 256 - offsetXInTile + SCREEN_WIDTH / 2 + panOffset.x,
          top: dy * 256 - offsetYInTile + SCREEN_HEIGHT / 2 + panOffset.y,
          url: `https://basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${tx}/${ty}.png?key=${CARTO_API_KEY}`,
        });
      }
    }
    return tiles;
  }, [mapCenter, zoom, panOffset]);

  // Project clinic coordinates to screen pixels
  function getClinicPinCoords(clinic: ClinicRecord) {
    const clinicLat = clinic.lat || DEFAULT_CENTER.lat;
    const clinicLng = clinic.lng || DEFAULT_CENTER.lng;

    const sinCenter = Math.sin((mapCenter.lat * Math.PI) / 180);
    const clampedSinCenter = Math.min(Math.max(sinCenter, -0.9999), 0.9999);
    const totalPixels = 256 * Math.pow(2, zoom);

    const centerX = totalPixels * ((mapCenter.lng + 180) / 360);
    const centerY = totalPixels * (0.5 - Math.log((1 + clampedSinCenter) / (1 - clampedSinCenter)) / (4 * Math.PI));

    const sinClinic = Math.sin((clinicLat * Math.PI) / 180);
    const clampedSinClinic = Math.min(Math.max(sinClinic, -0.9999), 0.9999);
    const clinicX = totalPixels * ((clinicLng + 180) / 360);
    const clinicY = totalPixels * (0.5 - Math.log((1 + clampedSinClinic) / (1 - clampedSinClinic)) / (4 * Math.PI));

    return {
      x: SCREEN_WIDTH / 2 + (clinicX - centerX) + panOffset.x,
      y: SCREEN_HEIGHT / 2 + (clinicY - centerY) + panOffset.y,
    };
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {viewMode === 'map' ? (
        /* ══════════════════════════════════════════════════════════
           MAP VIEW (Full background map with floating card)
           ══════════════════════════════════════════════════════════ */
        <View style={styles.mapRootContainer}>
          {/* ── Interactive Map Background Canvas ── */}
          <View style={styles.mapCanvas} {...panResponder.panHandlers}>
            {mapTiles.map((tile) => (
              <Image
                key={tile.key}
                source={{ uri: tile.url }}
                style={[styles.mapTile, { left: tile.left, top: tile.top }]}
                resizeMode="cover"
              />
            ))}

            {/* Radar / Scanning area circle accent (from user mockup) */}
            <View
              pointerEvents="none"
              style={[
                styles.radarCircle,
                {
                  left: SCREEN_WIDTH / 2 + panOffset.x - 140,
                  top: SCREEN_HEIGHT / 2 + panOffset.y - 140,
                },
              ]}
            />

            {/* Clinic Pins on Map */}
            {clinics.map((clinic, index) => {
              const coords = getClinicPinCoords(clinic);
              const isSelected = activeMapClinic?.id === clinic.id;

              return (
                <TouchableOpacity
                  key={clinic.id}
                  activeOpacity={0.85}
                  style={[
                    styles.pinContainer,
                    { left: coords.x - 22, top: coords.y - 44 },
                    isSelected && styles.pinContainerSelected,
                  ]}
                  onPress={() => selectClinicOnMap(clinic)}
                >
                  <View style={[styles.pinBadge, isSelected && styles.pinBadgeSelected]}>
                    <Ionicons
                      name={isSelected ? 'shield-checkmark' : 'business'}
                      size={15}
                      color="#fff"
                    />
                    <Text style={styles.pinNumber}>{index + 1}</Text>
                  </View>
                  <View style={[styles.pinPoint, isSelected && styles.pinPointSelected]} />
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Top Floating Header & Controls ── */}
          <View style={styles.topFloatingSection}>
            <View style={styles.topTitleRow}>
              <Text style={styles.topTitle}>Clinics</Text>
            </View>

            {/* Search Pill + Map/List Mode Switcher Toggle */}
            <View style={styles.searchRow}>
              <View style={styles.searchPill}>
                <Ionicons name="search" size={17} color={COLORS.primary} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search clinic, doctor, or condition..."
                  placeholderTextColor="#94a3b8"
                  style={styles.searchPillInput}
                  returnKeyType="search"
                />
                {query.length > 0 && (
                  <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle" size={16} color="#94a3b8" />
                  </TouchableOpacity>
                )}
              </View>

              {/* View Mode Toggle: [ Map | List ] */}
              <View style={styles.modeToggleGroup}>
                <TouchableOpacity
                  style={[styles.modeToggleBtn, styles.modeToggleBtnActive]}
                  onPress={() => setViewMode('map')}
                  activeOpacity={0.8}
                >
                  <Ionicons name="map" size={16} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modeToggleBtn}
                  onPress={() => setViewMode('list')}
                  activeOpacity={0.8}
                >
                  <Ionicons name="list" size={16} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Horizontal Filter Chips Carousel */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterChipsRow}
            >
              {COMMON_CONDITIONS.map((cond) => {
                const isActive = conditionFilter === cond;
                return (
                  <TouchableOpacity
                    key={cond}
                    style={[styles.filterChip, isActive && styles.filterChipActive]}
                    onPress={() => setConditionFilter(cond)}
                    activeOpacity={0.8}
                  >
                    {isActive && <Ionicons name="checkmark" size={12} color="#fff" style={{ marginRight: 4 }} />}
                    <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
                      {cond === 'All Conditions' ? 'All' : cond}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* ── Right Floating Map Action Controls ── */}
          <View style={styles.floatingMapControls}>
            <TouchableOpacity style={styles.mapControlBtn} onPress={recenterMap} activeOpacity={0.7}>
              <Ionicons name="locate" size={18} color={COLORS.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.mapControlBtn} onPress={handleZoomIn} activeOpacity={0.7}>
              <Ionicons name="add" size={18} color={COLORS.text} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.mapControlBtn} onPress={handleZoomOut} activeOpacity={0.7}>
              <Ionicons name="remove" size={18} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          {/* ── Bottom Floating Selected Clinic Card (Over the Map) ── */}
          {activeMapClinic && (
            <View style={styles.bottomFloatingCardContainer}>
              <TouchableOpacity
                style={styles.floatingCard}
                activeOpacity={0.9}
                onPress={() => setSelectedClinic(activeMapClinic)}
              >
                {/* Logo / Avatar */}
                <View style={styles.floatingCardLogoWrap}>
                  {activeMapClinic.logoUrl ? (
                    <Image source={{ uri: activeMapClinic.logoUrl }} style={styles.floatingCardLogo} />
                  ) : (
                    <View style={styles.floatingCardLogoPlaceholder}>
                      <Ionicons name="medical" size={20} color={COLORS.primary} />
                    </View>
                  )}
                  {activeMapClinic.verified && (
                    <View style={styles.floatingCardVerifiedBadge}>
                      <Ionicons name="shield-checkmark" size={10} color="#fff" />
                    </View>
                  )}
                </View>

                {/* Info Text */}
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.floatingCardTitle} numberOfLines={1}>
                    {activeMapClinic.name}
                  </Text>
                  <Text style={styles.floatingCardSubtitle} numberOfLines={1}>
                    {activeMapClinic.district || activeMapClinic.address || 'Cebu City'}
                  </Text>

                  <View style={styles.floatingCardMetaRow}>
                    <View style={styles.openDot} />
                    <Text style={styles.floatingCardHours} numberOfLines={1}>
                      Open Today · ₱{activeMapClinic.consultationFee || '500'}
                    </Text>
                  </View>
                </View>

                {/* Right Arrow / Action button */}
                <TouchableOpacity
                  style={styles.floatingCardActionBtn}
                  onPress={() => setSelectedClinic(activeMapClinic)}
                >
                  <Ionicons name="chevron-forward" size={18} color="#fff" />
                </TouchableOpacity>
              </TouchableOpacity>

              {/* Clinic Cycle Stepper (‹ 1 of 3 ›) */}
              {clinics.length > 1 && (
                <View style={styles.cardStepperRow}>
                  <TouchableOpacity style={styles.cardStepperBtn} onPress={prevMapClinic}>
                    <Ionicons name="chevron-back" size={14} color={COLORS.text} />
                  </TouchableOpacity>
                  <Text style={styles.cardStepperText}>
                    {(clinics.findIndex((c) => c.id === activeMapClinic.id) + 1)} of {clinics.length}
                  </Text>
                  <TouchableOpacity style={styles.cardStepperBtn} onPress={nextMapClinic}>
                    <Ionicons name="chevron-forward" size={14} color={COLORS.text} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </View>
      ) : (
        /* ══════════════════════════════════════════════════════════
           LIST VIEW (Full search and filtering features)
           ══════════════════════════════════════════════════════════ */
        <View style={styles.listRootContainer}>
          {/* Header */}
          <View style={styles.listHeader}>
            <TouchableOpacity style={styles.backBtn} onPress={() => setViewMode('map')} activeOpacity={0.7}>
              <Ionicons name="arrow-back" size={20} color={COLORS.text} />
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.listHeaderTitle}>Find Clinics</Text>
              <Text style={styles.listHeaderSubtitle}>Verified dermatologists in Cebu</Text>
            </View>

            {/* Toggle back to Map */}
            <TouchableOpacity
              style={styles.mapToggleSwitch}
              onPress={() => setViewMode('map')}
              activeOpacity={0.8}
            >
              <Ionicons name="map" size={15} color={COLORS.primary} />
              <Text style={styles.mapToggleSwitchText}>Map</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.listScrollView}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 20 }}
          >
            {/* Search Input */}
            <View style={styles.listSearchSection}>
              <View style={styles.listSearchBox}>
                <Ionicons name="search" size={18} color={COLORS.primary} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search clinics, doctors, or conditions..."
                  placeholderTextColor="#94a3b8"
                  style={styles.listSearchInput}
                  returnKeyType="search"
                />
                {query.length > 0 && (
                  <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle" size={18} color="#94a3b8" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Condition Filters */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionLabel}>Filter by Specialty Condition</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipsScrollRow}
              >
                {COMMON_CONDITIONS.map((cond) => (
                  <TouchableOpacity
                    key={cond}
                    style={[styles.filterChip, conditionFilter === cond && styles.filterChipActive]}
                    onPress={() => setConditionFilter(cond)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        conditionFilter === cond && styles.filterChipTextActive,
                      ]}
                    >
                      {cond}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* District Filter Chips */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionLabel}>Filter by District</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipsScrollRow}
              >
                <Chip label="All Districts" active={district === 'All'} onPress={() => setDistrict('All')} />
                {CEBU_DISTRICTS.filter((item) => item !== 'Other').map((item) => (
                  <Chip key={item} label={item} active={district === item} onPress={() => setDistrict(item)} />
                ))}
              </ScrollView>
            </View>

            {/* Sort Controls */}
            <View style={styles.sortRow}>
              <View style={styles.sortLabelGroup}>
                <Ionicons name="swap-vertical" size={14} color={COLORS.textSecondary} />
                <Text style={styles.sortLabel}>Sort by:</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sortPills}>
                <TouchableOpacity
                  style={[styles.sortPill, sortBy === 'recommended' && styles.sortPillActive]}
                  onPress={() => setSortBy('recommended')}
                >
                  <Text style={[styles.sortPillTxt, sortBy === 'recommended' && styles.sortPillTxtActive]}>
                    Best Match
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sortPill, sortBy === 'fee_asc' && styles.sortPillActive]}
                  onPress={() => setSortBy('fee_asc')}
                >
                  <Text style={[styles.sortPillTxt, sortBy === 'fee_asc' && styles.sortPillTxtActive]}>
                    Lowest Fee
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sortPill, sortBy === 'fee_desc' && styles.sortPillActive]}
                  onPress={() => setSortBy('fee_desc')}
                >
                  <Text style={[styles.sortPillTxt, sortBy === 'fee_desc' && styles.sortPillTxtActive]}>
                    Highest Fee
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sortPill, sortBy === 'name' && styles.sortPillActive]}
                  onPress={() => setSortBy('name')}
                >
                  <Text style={[styles.sortPillTxt, sortBy === 'name' && styles.sortPillTxtActive]}>
                    Name (A-Z)
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            </View>

            {/* Section Header */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{clinics.length} Clinics Available</Text>
              {(conditionFilter !== 'All Conditions' || district !== 'All' || query.length > 0) && (
                <TouchableOpacity
                  onPress={() => {
                    setConditionFilter('All Conditions');
                    setDistrict('All');
                    setQuery('');
                  }}
                >
                  <Text style={styles.resetFilterText}>Reset Filters</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Clinic cards */}
            <View style={styles.listContainer}>
              {clinics.length === 0 ? (
                <View style={styles.emptyStateContainer}>
                  <View style={styles.emptyIconCircle}>
                    <Ionicons name="search-outline" size={32} color={COLORS.primary} />
                  </View>
                  <Text style={styles.emptyStateTitle}>No Clinics Found</Text>
                  <Text style={styles.emptyStateSub}>
                    Try adjusting your search keywords, district, or condition filter.
                  </Text>
                  <TouchableOpacity
                    style={styles.emptyActionBtn}
                    onPress={() => {
                      setConditionFilter('All Conditions');
                      setDistrict('All');
                      setQuery('');
                    }}
                  >
                    <Text style={styles.emptyActionBtnText}>Clear All Filters</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                clinics.map((clinic) => {
                  const isSaved = savedClinicIds.includes(clinic.id);
                  const isOpen = isClinicOpenToday(clinic.hours);

                  return (
                    <View key={clinic.id} style={styles.card}>
                      <View style={styles.cardTopRow}>
                        {clinic.logoUrl ? (
                          <Image source={{ uri: clinic.logoUrl }} style={styles.clinicLogo} />
                        ) : (
                          <View style={[styles.listIconWrap, { backgroundColor: COLORS.primary + '15' }]}>
                            <Ionicons name="medkit-outline" size={20} color={COLORS.primary} />
                          </View>
                        )}

                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <View style={styles.nameRow}>
                            <Text style={styles.clinicName}>{clinic.name}</Text>
                            {clinic.verified && (
                              <View style={styles.verifiedBadge}>
                                <Ionicons name="shield-checkmark" size={11} color="#fff" />
                                <Text style={styles.verifiedBadgeText}>Verified</Text>
                              </View>
                            )}
                          </View>
                          <View style={styles.addressRow}>
                            <Ionicons name="location-outline" size={12} color={COLORS.textSecondary} />
                            <Text style={styles.listCardSub} numberOfLines={1}>
                              {clinic.address || clinic.district || 'Cebu City'}
                            </Text>
                          </View>
                        </View>

                        {/* Bookmark Toggle */}
                        <TouchableOpacity
                          style={[styles.bookmarkBtn, isSaved && styles.bookmarkBtnActive]}
                          onPress={() => toggleSaveClinic(clinic.id)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons
                            name={isSaved ? 'bookmark' : 'bookmark-outline'}
                            size={18}
                            color={isSaved ? COLORS.primary : COLORS.textSecondary}
                          />
                        </TouchableOpacity>
                      </View>

                      {/* Doctor Info */}
                      {clinic.doctors.length > 0 && (
                        <View style={styles.doctorRow}>
                          <Ionicons name="medical-outline" size={15} color={COLORS.primary} />
                          <Text style={styles.doctorText} numberOfLines={1}>
                            {clinic.doctors[0].name}
                            {clinic.doctors[0].specialization ? ` · ${clinic.doctors[0].specialization}` : ''}
                          </Text>
                        </View>
                      )}

                      {/* Meta row — Hours & Fee */}
                      <View style={styles.apptMeta}>
                        <View style={styles.apptMetaItem}>
                          <View style={[styles.statusDot, { backgroundColor: isOpen ? '#10b981' : '#9ca3af' }]} />
                          <Text style={styles.apptMetaText} numberOfLines={1}>
                            {clinic.hours || 'Mon - Sat: 8:00 AM - 5:00 PM'}
                          </Text>
                        </View>
                        <View style={styles.feeBadge}>
                          <Text style={styles.feeBadgeLabel}>Fee:</Text>
                          <Text style={styles.feeBadgeText}>₱{clinic.consultationFee || '500'}</Text>
                        </View>
                      </View>

                      {/* Conditions Treated Preview */}
                      {clinic.conditionsTreated && clinic.conditionsTreated.length > 0 && (
                        <View style={styles.conditionsRow}>
                          {clinic.conditionsTreated.slice(0, 3).map((tag, idx) => (
                            <View key={idx} style={styles.conditionTag}>
                              <Text style={styles.conditionTagText} numberOfLines={1}>
                                {tag}
                              </Text>
                            </View>
                          ))}
                          {clinic.conditionsTreated.length > 3 && (
                            <View style={[styles.conditionTag, { backgroundColor: '#f1f5f9' }]}>
                              <Text style={[styles.conditionTagText, { color: COLORS.textSecondary }]}>
                                +{clinic.conditionsTreated.length - 3} more
                              </Text>
                            </View>
                          )}
                        </View>
                      )}

                      {/* Actions Row */}
                      <View style={styles.actionsRow}>
                        <TouchableOpacity
                          style={styles.secondaryBtn}
                          onPress={() => setSelectedClinic(clinic)}
                        >
                          <Ionicons name="information-circle-outline" size={15} color={COLORS.primary} />
                          <Text style={styles.secondaryBtnText}>Details</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.primaryBtn}
                          onPress={() =>
                            router.push({
                              pathname: '/(app)/appointments',
                              params: { openBooking: '1', clinicId: String(clinic.id) },
                            } as any)
                          }
                        >
                          <Ionicons name="calendar-outline" size={15} color="#fff" />
                          <Text style={styles.primaryBtnText}>Book Consultation</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </ScrollView>
        </View>
      )}

      {/* ── Clinic Details Modal (Full parity with web FindClinicsPage) ── */}
      {selectedClinic && (
        <ClinicDetailsModal
          clinic={selectedClinic}
          isSaved={savedClinicIds.includes(selectedClinic.id)}
          onToggleSave={() => toggleSaveClinic(selectedClinic.id)}
          onClose={() => setSelectedClinic(null)}
          onBook={() => {
            const id = selectedClinic.id;
            setSelectedClinic(null);
            router.push({
              pathname: '/(app)/appointments',
              params: { openBooking: '1', clinicId: String(id) },
            } as any);
          }}
        />
      )}


    </SafeAreaView>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────
// Clinic Details Modal Component
// ─────────────────────────────────────────────────────────
function ClinicDetailsModal({
  clinic,
  isSaved,
  onToggleSave,
  onClose,
  onBook,
}: {
  clinic: ClinicRecord;
  isSaved: boolean;
  onToggleSave: () => void;
  onClose: () => void;
  onBook: () => void;
}) {
  const isOpen = isClinicOpenToday(clinic.hours);

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Modal Header */}
          <View style={styles.modalHeader}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {clinic.logoUrl ? (
                <Image source={{ uri: clinic.logoUrl }} style={styles.modalLogo} />
              ) : (
                <View style={[styles.modalLogoPlaceholder, { backgroundColor: COLORS.primary + '15' }]}>
                  <Ionicons name="medkit" size={24} color={COLORS.primary} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text style={styles.modalTitle}>{clinic.name}</Text>
                  {clinic.verified && (
                    <View style={styles.verifiedBadge}>
                      <Ionicons name="shield-checkmark" size={10} color="#fff" />
                      <Text style={styles.verifiedBadgeText}>Verified</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.modalSubtitle}>{clinic.district || 'Cebu City, Philippines'}</Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <TouchableOpacity
                style={[styles.modalIconBtn, isSaved && styles.modalIconBtnSaved]}
                onPress={onToggleSave}
              >
                <Ionicons
                  name={isSaved ? 'bookmark' : 'bookmark-outline'}
                  size={18}
                  color={isSaved ? COLORS.primary : COLORS.textSecondary}
                />
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalIconBtn} onPress={onClose}>
                <Ionicons name="close" size={20} color={COLORS.text} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Modal Scrollable Body */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.modalScrollContent}
          >
            {/* About / Overview */}
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionHeading}>About This Clinic</Text>
              <View style={styles.aboutBox}>
                <Text style={styles.aboutText}>
                  {clinic.description ||
                    `${clinic.name} is a verified dermatological healthcare facility located in ${clinic.district || 'Cebu City'}. They offer comprehensive clinical dermatology care for acne, eczema, melasma, psoriasis, vitiligo, and various skin conditions.`}
                </Text>
              </View>
            </View>

            {/* Quick Specs (Fee & Hours) */}
            <View style={styles.specsRow}>
              <View style={styles.specCard}>
                <Ionicons name="cash-outline" size={18} color={COLORS.primary} />
                <Text style={styles.specLabel}>Consultation Fee</Text>
                <Text style={styles.specValue}>₱{clinic.consultationFee || '500'}</Text>
              </View>
              <View style={styles.specCard}>
                <Ionicons name="time-outline" size={18} color="#059669" />
                <Text style={styles.specLabel}>Status</Text>
                <Text style={[styles.specValue, { color: isOpen ? '#059669' : '#d97706' }]}>
                  {isOpen ? 'Open Today' : 'Closed Today'}
                </Text>
              </View>
            </View>

            {/* Hours breakdown */}
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionHeading}>Operating Schedule</Text>
              <View style={styles.scheduleRow}>
                <Ionicons name="calendar-outline" size={16} color={COLORS.textSecondary} />
                <Text style={styles.scheduleText}>{clinic.hours || 'Mon - Sat: 8:00 AM - 5:00 PM'}</Text>
              </View>
            </View>

            {/* Doctors List */}
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionHeading}>
                Dermatologists & Medical Specialists ({clinic.doctors.length})
              </Text>
              <View style={styles.doctorsList}>
                {clinic.doctors.map((doc, idx) => (
                  <View key={idx} style={styles.doctorItem}>
                    <View style={styles.doctorAvatar}>
                      <Ionicons name="person" size={18} color={COLORS.primary} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.doctorItemName}>{doc.name}</Text>
                      <Text style={styles.doctorItemSpec}>{doc.specialization || 'Clinical Dermatology'}</Text>
                      {doc.dutyDays && doc.dutyDays.length > 0 && (
                        <Text style={styles.doctorSchedule}>
                          Available: {doc.dutyDays.slice(0, 3).join(', ')}
                          {doc.dutyDays.length > 3 ? '...' : ''}
                        </Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            </View>

            {/* Services & Conditions Treated */}
            {clinic.conditionsTreated && clinic.conditionsTreated.length > 0 && (
              <View style={styles.modalSection}>
                <Text style={styles.modalSectionHeading}>Services & Conditions Treated</Text>
                <View style={styles.modalTagsWrap}>
                  {clinic.conditionsTreated.map((tag, idx) => (
                    <View key={idx} style={styles.modalTag}>
                      <Ionicons name="checkmark-circle" size={12} color={COLORS.primary} />
                      <Text style={styles.modalTagText}>{tag}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Contact & Location Details */}
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionHeading}>Contact & Location</Text>
              <View style={styles.contactDetailsCard}>
                <View style={styles.contactDetailRow}>
                  <Ionicons name="location" size={16} color={COLORS.primary} />
                  <Text style={styles.contactDetailText}>{clinic.address || clinic.district || 'Cebu City'}</Text>
                </View>

                {clinic.phone ? (
                  <TouchableOpacity
                    style={styles.contactDetailRow}
                    onPress={() => Linking.openURL(`tel:${clinic.phone}`)}
                  >
                    <Ionicons name="call" size={16} color={COLORS.primary} />
                    <Text style={[styles.contactDetailText, { color: COLORS.primary, fontWeight: '600' }]}>
                      {clinic.phone} (Tap to Call)
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {clinic.email ? (
                  <TouchableOpacity
                    style={styles.contactDetailRow}
                    onPress={() => Linking.openURL(`mailto:${clinic.email}`)}
                  >
                    <Ionicons name="mail" size={16} color={COLORS.primary} />
                    <Text style={[styles.contactDetailText, { color: COLORS.primary }]}>
                      {clinic.email}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </ScrollView>

          {/* Modal Action Buttons Footer */}
          <View style={styles.modalFooter}>
            {clinic.address && (
              <TouchableOpacity
                style={styles.directionsBtn}
                onPress={() =>
                  Linking.openURL(
                    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      `${clinic.name} ${clinic.address} Cebu`
                    )}`
                  )
                }
              >
                <Ionicons name="navigate-outline" size={18} color={COLORS.primary} />
                <Text style={styles.directionsBtnText}>Directions</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.bookConsultBtn} onPress={onBook}>
              <Ionicons name="calendar" size={18} color="#fff" />
              <Text style={styles.bookConsultBtnText}>Book Appointment</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },

  // ── MAP VIEW STYLES ──
  mapRootContainer: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#bfe3ea', // Soft water color matching modern map tiles
  },
  mapCanvas: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
  },
  mapTile: {
    position: 'absolute',
    width: 256,
    height: 256,
  },
  radarCircle: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.75)',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },

  // Map Pins
  pinContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  pinContainerSelected: {
    zIndex: 20,
    transform: [{ scale: 1.15 }],
  },
  pinBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 5,
  },
  pinBadgeSelected: {
    backgroundColor: COLORS.primaryDark,
    borderColor: '#ffffff',
    paddingHorizontal: 11,
    paddingVertical: 7,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 8,
  },
  pinNumber: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  pinPoint: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: COLORS.primary,
    alignSelf: 'center',
    marginTop: -1,
  },
  pinPointSelected: {
    borderTopColor: COLORS.primaryDark,
  },

  // Top Floating Header
  topFloatingSection: {
    position: 'absolute',
    top: 10,
    left: 0,
    right: 0,
    zIndex: 30,
    paddingHorizontal: 16,
  },
  topTitleRow: {
    marginBottom: 8,
  },
  topTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.8)',
  },
  searchPillInput: {
    flex: 1,
    fontSize: 13,
    color: COLORS.text,
    padding: 0,
  },
  modeToggleGroup: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 3,
    gap: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 4,
  },
  modeToggleBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeToggleBtnActive: {
    backgroundColor: COLORS.primary,
  },

  // Filter Chips
  filterChipsRow: {
    paddingTop: 10,
    paddingBottom: 4,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 3,
  },
  filterChipActive: {
    backgroundColor: COLORS.primary,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text,
  },
  filterChipTextActive: {
    color: '#ffffff',
  },

  // Floating Map Controls (Right side: Recenter, +, -)
  floatingMapControls: {
    position: 'absolute',
    right: 16,
    top: 155,
    zIndex: 25,
    gap: 8,
  },
  mapControlBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 5,
    elevation: 4,
  },

  // Bottom Floating Clinic Card
  bottomFloatingCardContainer: {
    position: 'absolute',
    bottom: 12,
    left: 16,
    right: 16,
    zIndex: 35,
    alignItems: 'center',
  },
  floatingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 14,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  floatingCardLogoWrap: {
    position: 'relative',
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: COLORS.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingCardLogo: {
    width: 48,
    height: 48,
    borderRadius: 14,
  },
  floatingCardLogoPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingCardVerifiedBadge: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    backgroundColor: '#059669',
    borderRadius: 8,
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  floatingCardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
  },
  floatingCardSubtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  floatingCardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  openDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10b981',
  },
  floatingCardHours: {
    fontSize: 11,
    color: '#059669',
    fontWeight: '600',
  },
  floatingCardActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  cardStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14,
    marginTop: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  cardStepperBtn: {
    padding: 3,
  },
  cardStepperText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.text,
  },

  // ── LIST VIEW STYLES ──
  listRootContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  listHeaderTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
  },
  listHeaderSubtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  mapToggleSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primary + '15',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  mapToggleSwitchText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  listScrollView: {
    flex: 1,
  },
  listSearchSection: {
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  listSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 5,
    elevation: 2,
  },
  listSearchInput: {
    flex: 1,
    fontSize: 13,
    color: COLORS.text,
    padding: 0,
  },

  filterSection: {
    marginTop: 12,
  },
  filterSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textSecondary,
    paddingHorizontal: 20,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipsScrollRow: {
    paddingHorizontal: 20,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  chipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  chipTextActive: {
    color: '#fff',
  },

  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 14,
    gap: 8,
  },
  sortLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sortLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  sortPills: {
    gap: 6,
  },
  sortPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  sortPillActive: {
    backgroundColor: COLORS.primary + '15',
    borderColor: COLORS.primary,
  },
  sortPillTxt: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  sortPillTxtActive: {
    color: COLORS.primary,
    fontWeight: '700',
  },

  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 16,
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  resetFilterText: { fontSize: 11, fontWeight: '600', color: COLORS.primary },

  listContainer: { paddingHorizontal: 20, gap: 12 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start' },
  clinicLogo: { width: 44, height: 44, borderRadius: 12 },
  listIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  clinicName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#059669',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  verifiedBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 },
  listCardSub: { fontSize: 11, color: COLORS.textSecondary },
  bookmarkBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  bookmarkBtnActive: {
    backgroundColor: COLORS.primary + '15',
    borderColor: COLORS.primary + '30',
  },
  doctorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  doctorText: { fontSize: 12, color: COLORS.primary, fontWeight: '600' },
  apptMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  apptMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  apptMetaText: { fontSize: 11, color: COLORS.textSecondary },
  feeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ecfdf5',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  feeBadgeLabel: { fontSize: 10, color: '#059669', fontWeight: '500' },
  feeBadgeText: { fontSize: 11, color: '#059669', fontWeight: '800' },
  conditionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  conditionTag: { backgroundColor: COLORS.primary + '10', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  conditionTagText: { fontSize: 10, color: COLORS.primary, fontWeight: '600' },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.primary,
    backgroundColor: '#fff',
  },
  secondaryBtnText: { color: COLORS.primary, fontSize: 12, fontWeight: '700' },
  primaryBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
  },
  primaryBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // Empty State
  emptyStateContainer: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20 },
  emptyIconCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: COLORS.primary + '15', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyStateTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  emptyStateSub: { fontSize: 12, color: COLORS.textSecondary, textAlign: 'center', marginTop: 4, lineHeight: 18 },
  emptyActionBtn: { marginTop: 14, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: COLORS.primary },
  emptyActionBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // ── CLINIC DETAILS MODAL STYLES ──
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  modalLogo: { width: 48, height: 48, borderRadius: 12 },
  modalLogoPlaceholder: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  modalSubtitle: { fontSize: 12, color: COLORS.textSecondary, marginTop: 1 },
  modalIconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  modalIconBtnSaved: { backgroundColor: COLORS.primary + '15' },
  modalScrollContent: { paddingHorizontal: 20, paddingVertical: 16, gap: 16 },
  modalSection: { gap: 8 },
  modalSectionHeading: { fontSize: 13, fontWeight: '700', color: COLORS.text },
  aboutBox: { backgroundColor: '#f8fafc', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  aboutText: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 18 },
  specsRow: { flexDirection: 'row', gap: 12 },
  specCard: { flex: 1, backgroundColor: '#f8fafc', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', gap: 4 },
  specLabel: { fontSize: 10, color: COLORS.textSecondary, fontWeight: '500' },
  specValue: { fontSize: 14, fontWeight: '800', color: COLORS.text },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f8fafc', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  scheduleText: { fontSize: 12, color: COLORS.text, fontWeight: '600' },
  doctorsList: { gap: 10 },
  doctorItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  doctorAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.primary + '15', alignItems: 'center', justifyContent: 'center' },
  doctorItemName: { fontSize: 13, fontWeight: '700', color: COLORS.text },
  doctorItemSpec: { fontSize: 11, color: COLORS.primary, fontWeight: '600', marginTop: 1 },
  doctorSchedule: { fontSize: 10, color: COLORS.textSecondary, marginTop: 2 },
  modalTagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modalTag: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.primary + '10', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  modalTagText: { fontSize: 11, color: COLORS.primary, fontWeight: '600' },
  contactDetailsCard: { backgroundColor: '#f8fafc', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', gap: 10 },
  contactDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  contactDetailText: { fontSize: 12, color: COLORS.text, flex: 1 },
  modalFooter: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 12 },
  directionsBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.primary, backgroundColor: '#fff' },
  directionsBtnText: { color: COLORS.primary, fontSize: 13, fontWeight: '700' },
  bookConsultBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, backgroundColor: COLORS.primary },
  bookConsultBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
