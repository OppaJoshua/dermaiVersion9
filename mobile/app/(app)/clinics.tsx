import { useMemo, useRef, useState, useEffect } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, CEBU_DISTRICTS, SAMPLE_CLINICS } from '@/lib/constants';
import { getClinics, type ClinicRecord } from '@/lib/store';

const SCREEN_WIDTH = Dimensions.get('window').width;
const HERO_WIDTH = SCREEN_WIDTH - 40; // accounts for 20px horizontal margins

const HERO_IMAGES = [
  require('../../assets/images/clinicsHero1.jpg'),
  require('../../assets/images/clinicsHero2.jpg'),
  require('../../assets/images/clinicsHero3.jpg'),
];

export default function ClinicsScreen() {
  const router = useRouter();
  const [allClinics, setAllClinics] = useState<ClinicRecord[]>([]);
  const [query, setQuery] = useState('');
  const [district, setDistrict] = useState('All');
  const [heroIndex, setHeroIndex] = useState(0);
  const heroScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    getClinics().then(setAllClinics);
  }, []);

  function onHeroScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const idx = Math.round(e.nativeEvent.contentOffset.x / HERO_WIDTH);
    if (idx !== heroIndex) setHeroIndex(idx);
  }

  const clinics = useMemo(() => {
    const term = query.trim().toLowerCase();
    return allClinics.filter((clinic) => {
      const matchesTerm =
        term.length === 0 ||
        clinic.name.toLowerCase().includes(term) ||
        clinic.address.toLowerCase().includes(term) ||
        clinic.doctors.some((doctor) => doctor.name.toLowerCase().includes(term));
      const matchesDistrict = district === 'All' || clinic.district === district;
      return matchesTerm && matchesDistrict;
    });
  }, [allClinics, query, district]);

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Header (matches Home header style) ── */}
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
                  <Text style={styles.heroStatNum}>{SAMPLE_CLINICS.length}</Text>
                  <Text style={styles.heroStatLabel}>Clinics</Text>
                </View>
                <View style={styles.heroStatDivider} />
                <View style={styles.heroStatItem}>
                  <Text style={styles.heroStatNum}>{CEBU_DISTRICTS.length - 1}</Text>
                  <Text style={styles.heroStatLabel}>Districts</Text>
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
            placeholder="Search clinics, doctors, or addresses"
            placeholderTextColor={COLORS.textSecondary}
            style={styles.searchInput}
          />
        </View>

        {/* ── District chips ── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          <Chip label="All" active={district === 'All'} onPress={() => setDistrict('All')} />
          {CEBU_DISTRICTS.filter((item) => item !== 'Other').map((item) => (
            <Chip key={item} label={item} active={district === item} onPress={() => setDistrict(item)} />
          ))}
        </ScrollView>

        {/* ── Section header (matches Home's sectionHeader pattern) ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{clinics.length} Clinics Found</Text>
          <Text style={styles.seeAll}>Tap to view</Text>
        </View>

        {/* ── Clinic cards (matches Home's listCard / apptCard style) ── */}
        <View style={styles.listContainer}>
          {clinics.map((clinic) => (
            <View key={clinic.id} style={styles.card}>
              <View style={styles.cardTopRow}>
                <View style={[styles.listIconWrap, { backgroundColor: COLORS.primary + '15' }]}>
                  <Ionicons name="medkit-outline" size={20} color={COLORS.primary} />
                </View>
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
                  <Text style={styles.listCardSub}>{clinic.address}</Text>
                </View>
              </View>

              {/* Meta row — matches Home's apptMeta pattern */}
              <View style={styles.apptMeta}>
                <View style={styles.apptMetaItem}>
                  <Ionicons name="time-outline" size={11} color={COLORS.textSecondary} />
                  <Text style={styles.apptMetaText}>{clinic.hours}</Text>
                </View>
                <View style={styles.apptMetaItem}>
                  <Ionicons name="cash-outline" size={11} color={COLORS.textSecondary} />
                  <Text style={styles.apptMetaText}>₱{clinic.consultationFee}</Text>
                </View>
              </View>

              <View style={styles.doctorRow}>
                <Ionicons name="person-circle-outline" size={18} color={COLORS.primary} />
                <Text style={styles.doctorText}>{clinic.doctors.map((doctor) => doctor.name).join(' · ')}</Text>
              </View>

              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() =>
                    router.push({
                      pathname: '/(app)/appointments',
                      params: { openBooking: '1', clinicId: String(clinic.id) },
                    } as any)
                  }
                >
                  <Text style={styles.secondaryBtnText}>Book</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() =>
                    router.push({
                      pathname: '/(app)/appointments',
                      params: { clinicId: String(clinic.id) },
                    } as any)
                  }
                >
                  <Text style={styles.primaryBtnText}>View Appointments</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, backgroundColor: '#F7F8FA' },

  // ── Header (mirrors Home header) ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: '#fff',
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
    marginTop: 16,
    height: 180,
    borderRadius: 22,
    overflow: 'hidden',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroContent: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 18,
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
    marginBottom: 10,
  },
  heroBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  heroTitle: {
    color: '#fff',
    fontSize: 21,
    fontWeight: '800',
    lineHeight: 26,
    marginBottom: 14,
  },
  heroBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroStatsRow: { flexDirection: 'row', alignItems: 'center' },
  heroStatItem: { marginRight: 16 },
  heroStatNum: { color: '#fff', fontSize: 17, fontWeight: '800' },
  heroStatLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: '500', marginTop: 1 },
  heroStatDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.35)',
    marginRight: 16,
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
    marginHorizontal: 28,
    marginTop: 18,
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  
  searchInput: { flex: 1, color: COLORS.text, fontSize: 14 },

  // ── Chips ──
  chipsRow: { paddingHorizontal: 20, gap: 8, paddingTop: 14, paddingBottom: 20 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  chipActive: { backgroundColor: COLORS.primary },
  chipText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },

  // ── Section header (matches Home) ──
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  seeAll: { fontSize: 12, color: COLORS.textSecondary, fontWeight: '500' },

  // ── Clinic cards ──
  listContainer: { paddingHorizontal: 20, gap: 12 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start' },
  listIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  clinicName: { fontSize: 14, fontWeight: '700', color: COLORS.text, flexShrink: 1 },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  verifiedBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  listCardSub: { fontSize: 11, color: COLORS.textSecondary, marginTop: 3, lineHeight: 16 },

  apptMeta: { flexDirection: 'row', gap: 14, marginTop: 12, flexWrap: 'wrap' },
  apptMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  apptMetaText: { fontSize: 10, color: COLORS.textSecondary },

  doctorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  doctorText: { fontSize: 12, color: COLORS.textSecondary, flex: 1 },

  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  secondaryBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    backgroundColor: COLORS.primaryLight ?? '#e6f4ea',
  },
  secondaryBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 12 },
  primaryBtn: {
    flex: 1.2,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    backgroundColor: COLORS.primary,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});