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
  NativeSyntheticEvent,
  NativeScrollEvent,
  Modal,
  Linking,
  Alert,
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

const SCREEN_WIDTH = Dimensions.get('window').width;
const HERO_WIDTH = SCREEN_WIDTH - 40; // accounts for 20px horizontal margins

const HERO_IMAGES = [
  require('../../assets/images/clinicsHero1.jpg'),
  require('../../assets/images/clinicsHero2.jpg'),
  require('../../assets/images/clinicsHero3.jpg'),
];

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
  const [activeTab, setActiveTab] = useState<'all' | 'saved'>('all');
  const [query, setQuery] = useState('');
  const [district, setDistrict] = useState('All');
  const [conditionFilter, setConditionFilter] = useState('All Conditions');
  const [sortBy, setSortBy] = useState<'recommended' | 'fee_asc' | 'fee_desc' | 'name'>('recommended');
  const [selectedClinic, setSelectedClinic] = useState<ClinicRecord | null>(null);
  const [heroIndex, setHeroIndex] = useState(0);
  const heroScrollRef = useRef<ScrollView>(null);

  useFocusEffect(
    useCallback(() => {
      loadInitialData();
    }, [])
  );

  async function loadInitialData() {
    const clinicsData = await getClinics();
    setAllClinics(clinicsData);

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

  function onHeroScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const idx = Math.round(e.nativeEvent.contentOffset.x / HERO_WIDTH);
    if (idx !== heroIndex) setHeroIndex(idx);
  }

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
      const matchesTab = activeTab === 'all' || savedClinicIds.includes(clinic.id);
      const matchesCondition = clinicTreatsCondition(clinic, conditionFilter);

      return matchesTerm && matchesDistrict && matchesTab && matchesCondition;
    });

    return filtered.sort((a, b) => {
      const feeA = parseNumericFee(a.consultationFee);
      const feeB = parseNumericFee(b.consultationFee);
      if (sortBy === 'fee_asc') return feeA - feeB;
      if (sortBy === 'fee_desc') return feeB - feeA;
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return 0; // 'recommended' default order
    });
  }, [allClinics, query, district, activeTab, savedClinicIds, conditionFilter, sortBy]);

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color={COLORS.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.headerWelcome}>Find Clinics</Text>
          <Text style={styles.headerName}>Dermatology near you</Text>
        </View>
      </View>

      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 80 }}
      >
        {/* ── Hero photo carousel ── */}
        <View style={styles.heroBanner}>
          <ScrollView
            ref={heroScrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onHeroScroll}
            scrollEventThrottle={16}
          >
            {HERO_IMAGES.map((img, i) => (
              <View key={i} style={{ width: HERO_WIDTH, height: 180 }}>
                <Image source={img} style={styles.heroImage} resizeMode="cover" />
              </View>
            ))}
          </ScrollView>

          <View style={styles.heroContent} pointerEvents="box-none">
            <View style={styles.heroBadge}>
              <Ionicons name="shield-checkmark" size={12} color="#fff" />
              <Text style={styles.heroBadgeText}>Verified Network</Text>
            </View>
            <Text style={styles.heroTitle}>Trusted dermatologists,{'\n'}near you</Text>
            <View style={styles.heroBottomRow}>
              <View style={styles.heroStatsRow}>
                <View style={styles.heroStatItem}>
                  <Text style={styles.heroStatNum}>{allClinics.length || SAMPLE_CLINICS.length}</Text>
                  <Text style={styles.heroStatLabel}>Clinics</Text>
                </View>
                <View style={styles.heroStatDivider} />
                <View style={styles.heroStatItem}>
                  <Text style={styles.heroStatNum}>{CEBU_DISTRICTS.length - 1}</Text>
                  <Text style={styles.heroStatLabel}>Districts</Text>
                </View>
                <View style={styles.heroStatDivider} />
                <View style={styles.heroStatItem}>
                  <Text style={styles.heroStatNum}>{savedClinicIds.length}</Text>
                  <Text style={styles.heroStatLabel}>Saved</Text>
                </View>
              </View>
              <View style={styles.heroDotsRow}>
                {HERO_IMAGES.map((_, i) => (
                  <View key={i} style={[styles.heroDot, i === heroIndex && styles.heroDotActive]} />
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* ── Search box ── */}
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color={COLORS.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search clinics, doctors, conditions, or districts"
            placeholderTextColor={COLORS.textSecondary}
            style={styles.searchInput}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {/* ── All vs Saved Tabs (matches web parity) ── */}
        <View style={styles.tabsContainer}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'all' && styles.tabBtnActive]}
            onPress={() => setActiveTab('all')}
          >
            <Ionicons
              name="business-outline"
              size={15}
              color={activeTab === 'all' ? '#fff' : COLORS.textSecondary}
            />
            <Text style={[styles.tabBtnText, activeTab === 'all' && styles.tabBtnTextActive]}>
              All Clinics ({allClinics.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'saved' && styles.tabBtnActive]}
            onPress={() => setActiveTab('saved')}
          >
            <Ionicons
              name={activeTab === 'saved' ? 'bookmark' : 'bookmark-outline'}
              size={15}
              color={activeTab === 'saved' ? '#fff' : COLORS.textSecondary}
            />
            <Text style={[styles.tabBtnText, activeTab === 'saved' && styles.tabBtnTextActive]}>
              Saved ({savedClinicIds.length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Specialty Conditions Filter Chips ── */}
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

        {/* ── District Filter Chips ── */}
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

        {/* ── Sort Controls ── */}
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

        {/* ── Section header ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{clinics.length} Clinics Found</Text>
          {(conditionFilter !== 'All Conditions' || district !== 'All' || activeTab !== 'all') && (
            <TouchableOpacity
              onPress={() => {
                setConditionFilter('All Conditions');
                setDistrict('All');
                setActiveTab('all');
                setQuery('');
              }}
            >
              <Text style={styles.resetFilterText}>Reset Filters</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Clinic cards ── */}
        <View style={styles.listContainer}>
          {clinics.length === 0 ? (
            <View style={styles.emptyStateContainer}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="search-outline" size={32} color={COLORS.primary} />
              </View>
              <Text style={styles.emptyStateTitle}>
                {activeTab === 'saved' ? 'No Saved Clinics' : 'No Clinics Found'}
              </Text>
              <Text style={styles.emptyStateSub}>
                {activeTab === 'saved'
                  ? 'Tap the bookmark icon on any clinic to save it for quick access.'
                  : 'Try adjusting your search keywords, district, or condition filter.'}
              </Text>
              <TouchableOpacity
                style={styles.emptyActionBtn}
                onPress={() => {
                  setConditionFilter('All Conditions');
                  setDistrict('All');
                  setActiveTab('all');
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
                      <Ionicons name="stethoscope-outline" size={15} color={COLORS.primary} />
                      <Text style={styles.doctorText} numberOfLines={1}>
                        {clinic.doctors[0].name}
                        {clinic.doctors[0].specialization ? ` · ${clinic.doctors[0].specialization}` : ''}
                      </Text>
                    </View>
                  )}

                  {/* Meta row — Hours & Fee with Open Today Indicator */}
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

                  {/* Conditions Treated Tags Preview */}
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
                  Specialized in modern dermatological clinical consultations, acne and melasma
                  management, skin barrier evaluation, and verified dermatological treatments.
                </Text>
              </View>
            </View>

            {/* Quick Details Grid */}
            <View style={styles.modalGrid}>
              <View style={styles.modalGridItem}>
                <Ionicons name="location-outline" size={16} color={COLORS.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.gridItemLabel}>Address</Text>
                  <Text style={styles.gridItemValue}>{clinic.address || clinic.district}</Text>
                </View>
              </View>

              <View style={styles.modalGridItem}>
                <Ionicons name="time-outline" size={16} color={COLORS.primary} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Text style={styles.gridItemLabel}>Operating Hours</Text>
                    <View style={[styles.statusDot, { backgroundColor: isOpen ? '#10b981' : '#9ca3af' }]} />
                  </View>
                  <Text style={styles.gridItemValue}>{clinic.hours || 'Mon - Sat: 8:00 AM - 5:00 PM'}</Text>
                </View>
              </View>

              <View style={styles.modalGridItem}>
                <Ionicons name="cash-outline" size={16} color={COLORS.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.gridItemLabel}>Consultation Fee</Text>
                  <Text style={[styles.gridItemValue, { fontWeight: '700', color: COLORS.text }]}>
                    Starts at ₱{clinic.consultationFee || '500'}
                  </Text>
                </View>
              </View>

              {clinic.phone ? (
                <TouchableOpacity
                  style={styles.modalGridItem}
                  onPress={() => Linking.openURL(`tel:${clinic.phone}`)}
                >
                  <Ionicons name="call-outline" size={16} color={COLORS.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.gridItemLabel}>Contact Number</Text>
                    <Text style={[styles.gridItemValue, { color: COLORS.primary }]}>{clinic.phone}</Text>
                  </View>
                  <Ionicons name="open-outline" size={14} color={COLORS.primary} />
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Attending Dermatologists */}
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionHeading}>Attending Dermatologists</Text>
              {clinic.doctors && clinic.doctors.length > 0 ? (
                clinic.doctors.map((doc, idx) => (
                  <View key={idx} style={styles.doctorCard}>
                    <View style={styles.doctorAvatar}>
                      <Ionicons name="person" size={18} color={COLORS.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.doctorCardName}>{doc.name}</Text>
                      <Text style={styles.doctorCardSpec}>{doc.specialization || 'Dermatologist'}</Text>
                      {doc.dutyDays && (
                        <Text style={styles.doctorCardSchedule}>
                          Available: {doc.dutyDays.slice(0, 3).join(', ')}
                          {doc.dutyDays.length > 3 ? '...' : ''}
                        </Text>
                      )}
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.emptyDoctorText}>
                  Board-certified dermatologists available per scheduled consultation.
                </Text>
              )}
            </View>

            {/* Services & Conditions Treated */}
            <View style={styles.modalSection}>
              <Text style={styles.modalSectionHeading}>Services & Conditions Treated</Text>
              <View style={styles.modalChipsContainer}>
                {(clinic.conditionsTreated && clinic.conditionsTreated.length > 0
                  ? clinic.conditionsTreated
                  : ['General Dermatology', 'Acne Vulgaris', 'Atopic Dermatitis', 'Melasma', 'Skin Allergy']
                ).map((condition, idx) => (
                  <View key={idx} style={styles.modalConditionPill}>
                    <Ionicons name="checkmark-circle" size={12} color={COLORS.primary} />
                    <Text style={styles.modalConditionPillText}>{condition}</Text>
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>

          {/* Modal Footer CTA */}
          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.bookCtaBtn} onPress={onBook}>
              <Ionicons name="calendar" size={18} color="#fff" />
              <Text style={styles.bookCtaBtnText}>Book Consultation Now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, backgroundColor: '#F8F9FA' },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  iconBtn: {
    width: 40,
    height: 40,
    backgroundColor: '#F5F6FA',
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerWelcome: { fontSize: 11, color: COLORS.textSecondary, letterSpacing: 0.2 },
  headerName: { fontSize: 17, fontWeight: '700', color: COLORS.text },

  // ── Hero photo carousel ──
  heroBanner: {
    marginHorizontal: 20,
    marginTop: 14,
    height: 180,
    borderRadius: 22,
    overflow: 'hidden',
  },
  heroImage: { width: '100%', height: '100%' },
  heroContent: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 18,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 8,
  },
  heroBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  heroTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 25,
    marginBottom: 12,
  },
  heroBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroStatsRow: { flexDirection: 'row', alignItems: 'center' },
  heroStatItem: { marginRight: 14 },
  heroStatNum: { color: '#fff', fontSize: 16, fontWeight: '800' },
  heroStatLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: '500', marginTop: 1 },
  heroStatDivider: {
    width: 1,
    height: 22,
    backgroundColor: 'rgba(255,255,255,0.35)',
    marginRight: 14,
  },
  heroDotsRow: { flexDirection: 'row', gap: 5 },
  heroDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  heroDotActive: {
    backgroundColor: '#fff',
    width: 16,
  },

  // ── Search box ──
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginTop: 14,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  searchInput: { flex: 1, color: COLORS.text, fontSize: 13 },

  // ── Tabs ──
  tabsContainer: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 12,
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    padding: 3,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
  },
  tabBtnActive: {
    backgroundColor: COLORS.primary,
  },
  tabBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  tabBtnTextActive: {
    color: '#fff',
  },

  // ── Filters ──
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
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  filterChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  filterChipTextActive: {
    color: '#fff',
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

  // ── Sort Row ──
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

  // ── Section Header ──
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

  // ── Clinic Cards ──
  listContainer: { paddingHorizontal: 20, gap: 12 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start' },
  clinicLogo: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  listIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  clinicName: { fontSize: 14, fontWeight: '700', color: COLORS.text, flexShrink: 1 },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
  },
  verifiedBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  listCardSub: { fontSize: 11, color: COLORS.textSecondary, flex: 1 },
  bookmarkBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
  },
  bookmarkBtnActive: {
    backgroundColor: COLORS.primary + '15',
  },

  doctorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  doctorText: { fontSize: 12, color: COLORS.textSecondary, flex: 1, fontWeight: '500' },

  apptMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  apptMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  apptMetaText: { fontSize: 11, color: COLORS.textSecondary, flexShrink: 1 },
  feeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  feeBadgeLabel: { fontSize: 11, color: COLORS.textSecondary },
  feeBadgeText: { fontSize: 11, fontWeight: '700', color: COLORS.text },

  conditionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 10,
  },
  conditionTag: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  conditionTagText: {
    fontSize: 10,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },

  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 10,
    paddingVertical: 10,
    backgroundColor: '#f1f5f9',
  },
  secondaryBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 12 },
  primaryBtn: {
    flex: 1.4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    paddingVertical: 10,
    backgroundColor: COLORS.primary,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },

  // ── Empty State ──
  emptyStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  emptyIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyStateTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  emptyStateSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  emptyActionBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  emptyActionBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },

  // ── Details Modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    flexDirection: 'column',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  modalLogo: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  modalLogoPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
  },
  modalSubtitle: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  modalIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalIconBtnSaved: {
    backgroundColor: COLORS.primary + '15',
  },
  modalScrollContent: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 16,
  },
  modalSection: {
    gap: 8,
  },
  modalSectionHeading: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  aboutBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  aboutText: {
    fontSize: 12,
    color: COLORS.text,
    lineHeight: 18,
  },
  modalGrid: {
    gap: 8,
  },
  modalGridItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  gridItemLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
  },
  gridItemValue: {
    fontSize: 12,
    color: COLORS.text,
    marginTop: 2,
  },
  doctorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  doctorAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doctorCardName: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
  },
  doctorCardSpec: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  doctorCardSchedule: {
    fontSize: 10,
    color: COLORS.primary,
    fontWeight: '600',
    marginTop: 2,
  },
  emptyDoctorText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: COLORS.textSecondary,
  },
  modalChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  modalConditionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  modalConditionPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.text,
  },
  modalFooter: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    backgroundColor: '#fff',
  },
  bookCtaBtn: {
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
  },
  bookCtaBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
});