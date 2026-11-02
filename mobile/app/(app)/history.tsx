import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  Image,
  Modal,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { COLORS, FONTS } from '@/lib/constants';
import { getCurrentUser, getSkinHistory, deleteScanResult } from '@/lib/store';
import type { ScanResult } from '@/lib/store';

// Web Patient Theme Colors (matching web/src/index.css & SkinHistoryPage.tsx)
const PATIENT_THEME = {
  bg: '#ffffff',
  magenta600: '#85134a',
  magenta500: '#A0195A',
  magenta100: '#fce7f0',
  magenta50: '#fdf2f7',
};

const CONDITION_IMAGES: Record<string, any> = {
  'Acne Rosacea': require('../../assets/images/acne-rosacea.png'),
};

function RadialProgressBar({
  progress,
  size = 56,
  strokeWidth = 5,
  color = PATIENT_THEME.magenta600,
  bgColor = PATIENT_THEME.magenta100,
}: {
  progress: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  bgColor?: string;
}) {
  const safeProgress = Math.min(Math.max(isNaN(progress) ? 0 : progress, 0), 100);
  const strokeColor = color || PATIENT_THEME.magenta600;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (circumference * safeProgress) / 100;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={bgColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text
          style={{
            fontSize: size * 0.23,
            fontWeight: '800',
            color: '#111827',
            fontFamily: FONTS.bold,
          }}
        >
          {Math.round(safeProgress)}%
        </Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────
// Skeleton Loading Card (Matches Reference Screenshot)
// ─────────────────────────────────────────────
function SkinHistorySkeleton({ pulseAnim }: { pulseAnim: Animated.Value }) {
  return (
    <View style={styles.scrollList}>
      <Animated.View style={[styles.skeletonCard, { opacity: pulseAnim }]}>
        {/* Top small label bar */}
        <View style={styles.skeletonBarTop} />

        {/* Title block + pill */}
        <View style={styles.skeletonHeaderRow}>
          <View style={styles.skeletonBarMain} />
          <View style={styles.skeletonPill} />
        </View>

        {/* 2-Column Summary Mini Cards */}
        <View style={styles.skeletonTwoColGrid}>
          <View style={styles.skeletonMiniBox}>
            <View style={styles.skeletonMiniLabel} />
            <View style={styles.skeletonMiniValue} />
          </View>
          <View style={styles.skeletonMiniBox}>
            <View style={styles.skeletonMiniLabel} />
            <View style={styles.skeletonMiniValue} />
          </View>
        </View>

        {/* Section Subtitle Bar */}
        <View style={styles.skeletonSectionTitle} />

        {/* Dashed Scan Record Rows */}
        {[0, 1, 2].map((idx) => (
          <View
            key={idx}
            style={[
              styles.skeletonDashedRow,
              idx > 0 && { marginTop: 12 },
            ]}
          >
            <View style={styles.skeletonThumbSquare} />
            <View style={{ flex: 1 }}>
              <View style={styles.skeletonLinePrimary} />
              <View style={styles.skeletonLineSecondary} />
            </View>
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

export default function HistoryScreen() {
  const router = useRouter();
  const [history, setHistory] = useState<ScanResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ScanResult | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const hasLoadedRef = useRef(false);

  const pulseAnim = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.45,
          duration: 750,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [])
  );

  async function loadHistory() {
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const user = await getCurrentUser();
      if (!user) return;
      const h = await getSkinHistory(user.id);
      setHistory(h);
      hasLoadedRef.current = true;
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(item: ScanResult) {
    Alert.alert(
      'Delete Scan Record',
      `Are you sure you want to delete the "${item.condition}" record? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const user = await getCurrentUser();
            if (!user) return;
            await deleteScanResult(user.id, item.id);
            setHistory((prev) => prev.filter((h) => h.id !== item.id));
            if (selected?.id === item.id) setSelected(null);
          },
        },
      ]
    );
  }

  const filteredHistory = useMemo(() => {
    if (!searchTerm.trim()) return history;
    const q = searchTerm.toLowerCase();
    return history.filter((item) => {
      return (
        item.condition.toLowerCase().includes(q) ||
        (item.localName && item.localName.toLowerCase().includes(q)) ||
        (item.answers?.bodyLocation && String(item.answers.bodyLocation).toLowerCase().includes(q))
      );
    });
  }, [history, searchTerm]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Skin Analysis History</Text>
          <Text style={styles.headerSub}>
            {loading
              ? 'Loading your skin analysis records...'
              : `${history.length} ${history.length === 1 ? 'record' : 'records'} logged`}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.newScanBtn}
          activeOpacity={0.85}
          onPress={() => router.push('/(app)/scan')}
        >
          <Ionicons name="camera-outline" size={16} color="#fff" style={{ marginRight: 6 }} />
          <Text style={styles.newScanBtnTxt}>New Scan</Text>
        </TouchableOpacity>
      </View>

      {/* ── Search Bar ── */}
      {!loading && history.length > 0 && (
        <View style={styles.controlSection}>
          <View style={styles.searchRow}>
            <Ionicons name="search-outline" size={17} color={PATIENT_THEME.magenta600} style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search condition or Tagalog name..."
              placeholderTextColor={COLORS.textLight}
              value={searchTerm}
              onChangeText={setSearchTerm}
            />
            {searchTerm.length > 0 && (
              <TouchableOpacity onPress={() => setSearchTerm('')} style={styles.clearBtn}>
                <Ionicons name="close-circle" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* ── Main Content / Skeleton / List / Empty State ── */}
      {loading ? (
        <ScrollView showsVerticalScrollIndicator={false}>
          <SkinHistorySkeleton pulseAnim={pulseAnim} />
        </ScrollView>
      ) : history.length === 0 ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="document-text-outline" size={38} color={PATIENT_THEME.magenta600} />
            </View>
            <Text style={styles.emptyTitle}>No History Found</Text>
            <Text style={styles.emptySub}>
              You haven&apos;t performed any skin analysis yet. Start your first scan today!
            </Text>
            <TouchableOpacity
              style={styles.ctaBtn}
              activeOpacity={0.88}
              onPress={() => router.push('/(app)/scan')}
            >
              <Ionicons name="camera-outline" size={17} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.ctaBtnTxt}>Perform Your First Scan</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollList}
        >
          {filteredHistory.length === 0 ? (
            <View style={styles.emptySearchWrap}>
              <View style={styles.emptyIconCircleSm}>
                <Ionicons name="search-outline" size={32} color={PATIENT_THEME.magenta600} />
              </View>
              <Text style={styles.emptyTitleSm}>No Matching Scans</Text>
              <Text style={styles.emptySubSm}>No results found for &quot;{searchTerm}&quot;</Text>
              <TouchableOpacity
                style={styles.resetSearchBtn}
                onPress={() => setSearchTerm('')}
              >
                <Text style={styles.resetSearchBtnTxt}>Reset Search</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.cardList}>
              {filteredHistory.map((item) => (
                <ScanCard
                  key={item.id}
                  item={item}
                  onPress={() => setSelected(item)}
                />
              ))}
            </View>
          )}
          <View style={{ height: 24 }} />
        </ScrollView>
      )}

      {/* ── Detail Modal (Web-Patient Matching Design) ── */}
      {selected && (
        <DetailView
          result={selected}
          onBack={() => setSelected(null)}
          onDelete={() => handleDelete(selected)}
        />
      )}
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────
// Scan Card (Matching Web Patient SkinHistoryPage.tsx)
// ─────────────────────────────────────────────
function ScanCard({
  item,
  onPress,
}: {
  item: ScanResult;
  onPress: () => void;
}) {
  const hasImage = Boolean(item.imageUri || CONDITION_IMAGES[item.condition]);
  const imgSource = item.imageUri ? { uri: item.imageUri } : CONDITION_IMAGES[item.condition];

  const formattedDate = new Date(item.date).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.82}
    >
      {/* Left: Clean Thumbnail Image or Radial Progress */}
      <View style={styles.cardLeftCol}>
        {hasImage ? (
          <View style={styles.thumbWrapper}>
            <Image source={imgSource} style={styles.thumb} resizeMode="cover" />
          </View>
        ) : (
          <RadialProgressBar
            progress={item.confidence}
            size={56}
            strokeWidth={5}
            color={PATIENT_THEME.magenta600}
            bgColor={PATIENT_THEME.magenta100}
          />
        )}
      </View>

      {/* Center: Condition Name, Tagalog Name, and Clean Metadata Badges */}
      <View style={styles.cardBody}>
        <Text style={styles.condName} numberOfLines={1}>
          {item.condition}
        </Text>

        {/* Tagalog Name */}
        {item.localName ? (
          <Text style={styles.cardLocalName} numberOfLines={1}>
            ({item.localName})
          </Text>
        ) : null}

        {/* Meta badges: Body Location, Date & Confidence */}
        <View style={styles.metaRow}>
          {item.answers?.bodyLocation ? (
            <View style={styles.metaBadge}>
              <Ionicons name="location-outline" size={11} color="#9ca3af" />
              <Text style={styles.metaBadgeTxt} numberOfLines={1}>
                {String(item.answers.bodyLocation)}
              </Text>
            </View>
          ) : null}

          <View style={styles.metaBadge}>
            <Ionicons name="calendar-outline" size={11} color="#9ca3af" />
            <Text style={styles.metaBadgeTxt}>{formattedDate}</Text>
          </View>

          <View style={[styles.metaBadge, styles.metaBadgePrimary]}>
            <Ionicons name="pulse-outline" size={11} color={PATIENT_THEME.magenta600} />
            <Text style={[styles.metaBadgeTxt, { color: PATIENT_THEME.magenta600, fontWeight: '700' }]}>
              {item.confidence}% confidence
            </Text>
          </View>
        </View>

        {/* Tags if applicable */}
        {item.referralSuggested && (
          <View style={styles.referralTag}>
            <Ionicons name="medkit-outline" size={11} color={PATIENT_THEME.magenta600} />
            <Text style={styles.referralTagTxt}>Dermatologist referral recommended</Text>
          </View>
        )}
        {item.status === 'flagged' && (
          <View style={styles.flagTag}>
            <Ionicons name="alert-circle-outline" size={11} color="#b45309" />
            <Text style={styles.flagTagTxt}>Flagged for clinical review</Text>
          </View>
        )}
      </View>

      {/* Right Column: Clean navigation chevron */}
      <View style={styles.cardRightCol}>
        <View style={styles.viewBtnBadge}>
          <Ionicons name="chevron-forward" size={16} color={PATIENT_THEME.magenta600} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────
// Detail View (Exact Web Patient Modal Design)
// ─────────────────────────────────────────────
function DetailView({
  result,
  onBack,
  onDelete,
}: {
  result: ScanResult;
  onBack: () => void;
  onDelete: () => void;
}) {
  const router = useRouter();
  const location = result.answers?.bodyLocation || 'Skin Assessment';
  const scanDate = new Date(result.date).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const isGovReportable = result.isGovernmentReportable ?? false;
  const hasImage = Boolean(result.imageUri || CONDITION_IMAGES[result.condition]);
  const imgSource = result.imageUri ? { uri: result.imageUri } : CONDITION_IMAGES[result.condition];

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onBack}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Header Row: Possible Condition + Tagalog Name (Left), Trash & Close (Right) */}
          <View style={styles.modalHeaderRow}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={styles.modalTitle}>
                {isGovReportable ? 'Requires Immediate Attention' : `Possible ${result.condition}`}
              </Text>
              {result.localName ? (
                <Text style={styles.modalSubtitle}>{result.localName}</Text>
              ) : null}
            </View>

            <View style={styles.modalHeaderActions}>
              <TouchableOpacity
                onPress={onDelete}
                style={styles.modalTrashBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Delete Scan"
              >
                <Ionicons name="trash-outline" size={17} color="#ef4444" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onBack}
                style={styles.modalCloseBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={20} color="#9ca3af" />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.modalScrollContent}
          >
            {/* Uploaded / Condition Photo */}
            {hasImage ? (
              <View style={styles.modalImgWrapper}>
                <Image source={imgSource} style={styles.modalImg} resizeMode="cover" />
              </View>
            ) : null}

            {/* Meta Chips: Location & Full Date */}
            <View style={styles.modalMetaRow}>
              <View style={styles.modalMetaChip}>
                <Ionicons name="location-outline" size={14} color="#6b7280" />
                <Text style={styles.modalMetaChipTxt}>{String(location)}</Text>
              </View>
              <View style={styles.modalMetaChip}>
                <Ionicons name="calendar-outline" size={14} color="#6b7280" />
                <Text style={styles.modalMetaChipTxt}>{scanDate}</Text>
              </View>
            </View>

            {/* Confidence Score Bar (Matching Web Patient) */}
            <View style={styles.confSection}>
              <View style={styles.confHeaderRow}>
                <Text style={styles.confLabel}>Confidence Score</Text>
                <Text style={styles.confValue}>{result.confidence}%</Text>
              </View>
              <View style={styles.confTrack}>
                <View style={[styles.confFill, { width: `${result.confidence}%` }]} />
              </View>
            </View>

            {/* What is Condition? */}
            {!isGovReportable && result.description ? (
              <View style={styles.infoSection}>
                <Text style={styles.infoSectionTitle}>What is {result.condition}?</Text>
                <Text style={styles.infoSectionBody}>{result.description}</Text>
              </View>
            ) : null}

            {/* Basic Care Tips */}
            {!isGovReportable && result.careTips && result.careTips.length > 0 ? (
              <View style={styles.infoSection}>
                <Text style={styles.infoSectionTitle}>Basic Care Tips</Text>
                {result.careTips.map((tip, idx) => (
                  <View key={idx} style={styles.tipRow}>
                    <Ionicons name="checkmark-circle" size={16} color="#16a34a" style={{ marginTop: 2 }} />
                    <Text style={styles.tipTxt}>{tip}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Disclaimer Box (Matching Web Patient Rose Box) */}
            <View style={styles.disclaimerBox}>
              <Ionicons name="warning-outline" size={16} color={PATIENT_THEME.magenta600} style={{ marginTop: 1, marginRight: 8 }} />
              <Text style={styles.disclaimerTxt}>
                This is <Text style={{ fontWeight: '800' }}>NOT</Text> a medical diagnosis. Please consult a licensed dermatologist for proper evaluation and treatment.
              </Text>
            </View>

            {/* CTA Button */}
            <TouchableOpacity
              style={styles.findDermBtn}
              activeOpacity={0.88}
              onPress={() => {
                onBack();
                router.push('/(app)/clinics');
              }}
            >
              <Text style={styles.findDermTxt}>Find a Dermatologist Near You</Text>
            </TouchableOpacity>

            {/* Delete button at bottom */}
            <TouchableOpacity style={styles.deleteBottomBtn} onPress={onDelete}>
              <Ionicons name="trash-outline" size={13} color="#ef4444" />
              <Text style={styles.deleteBottomTxt}>Delete Scan Record</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PATIENT_THEME.bg },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#111827', letterSpacing: -0.3 },
  headerSub: { fontSize: 12, color: '#6b7280', marginTop: 2, fontWeight: '500' },
  newScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PATIENT_THEME.magenta600,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 9,
    shadowColor: PATIENT_THEME.magenta600,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 2,
  },
  newScanBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // ── Search & Controls ──
  controlSection: {
    backgroundColor: '#fff',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 10,
    backgroundColor: PATIENT_THEME.bg,
    borderRadius: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#edf2f7',
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 13.5,
    color: '#111827',
  },
  clearBtn: { padding: 4 },

  // ── Scroll List ──
  scrollList: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 16,
  },
  cardList: {
    gap: 12,
  },

  // ── Skeleton Loading Styles (Matches Reference Screenshot) ──
  skeletonCard: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#f3f4f6',
    shadowColor: '#0f172a',
    shadowOpacity: 0.03,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  skeletonBarTop: {
    height: 12,
    width: 64,
    borderRadius: 6,
    backgroundColor: '#f3f4f6',
    marginBottom: 10,
  },
  skeletonHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  skeletonBarMain: {
    height: 32,
    width: 96,
    borderRadius: 8,
    backgroundColor: '#e5e7eb',
  },
  skeletonPill: {
    height: 20,
    width: 64,
    borderRadius: 999,
    backgroundColor: '#f3f4f6',
  },
  skeletonTwoColGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  skeletonMiniBox: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#f3f4f6',
    padding: 14,
  },
  skeletonMiniLabel: {
    height: 10,
    width: 64,
    borderRadius: 5,
    backgroundColor: '#f3f4f6',
    marginBottom: 8,
  },
  skeletonMiniValue: {
    height: 16,
    width: 96,
    borderRadius: 6,
    backgroundColor: '#e5e7eb',
  },
  skeletonSectionTitle: {
    height: 14,
    width: 112,
    borderRadius: 6,
    backgroundColor: '#f3f4f6',
    marginBottom: 12,
  },
  skeletonDashedRow: {
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#e5e7eb',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  skeletonThumbSquare: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
  },
  skeletonLinePrimary: {
    height: 12,
    width: '62%',
    borderRadius: 6,
    backgroundColor: '#f3f4f6',
    marginBottom: 7,
  },
  skeletonLineSecondary: {
    height: 10,
    width: '82%',
    borderRadius: 5,
    backgroundColor: '#f3f4f6',
  },

  // ── Scan Card (Web Patient Matching Design) ──
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#f3f4f6',
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardLeftCol: {
    marginRight: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbWrapper: {
    width: 58,
    height: 58,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: PATIENT_THEME.magenta100,
    backgroundColor: PATIENT_THEME.magenta50,
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  cardBody: {
    flex: 1,
    justifyContent: 'center',
  },
  condName: {
    fontSize: 15.5,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 2,
  },
  cardLocalName: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#f3f4f6',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 8,
  },
  metaBadgePrimary: {
    backgroundColor: PATIENT_THEME.magenta50,
    borderColor: PATIENT_THEME.magenta100,
  },
  metaBadgeTxt: {
    fontSize: 11,
    color: '#6b7280',
    fontWeight: '500',
  },
  referralTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
    backgroundColor: PATIENT_THEME.magenta50,
    borderWidth: 1,
    borderColor: PATIENT_THEME.magenta100,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  referralTagTxt: {
    fontSize: 10,
    color: PATIENT_THEME.magenta600,
    fontWeight: '700',
  },
  flagTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  flagTagTxt: {
    fontSize: 10,
    color: '#b45309',
    fontWeight: '600',
  },
  cardRightCol: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 8,
  },
  viewBtnBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#f9fafb',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Empty State (Web Dashed Card Style) ──
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  emptyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#e5e7eb',
    paddingVertical: 44,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: PATIENT_THEME.magenta50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: { fontSize: 19, fontWeight: '800', color: '#111827' },
  emptySub: {
    fontSize: 13.5,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 6,
    marginBottom: 20,
  },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PATIENT_THEME.magenta600,
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingVertical: 13,
    shadowColor: PATIENT_THEME.magenta600,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  ctaBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 14.5 },

  emptySearchWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyIconCircleSm: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: PATIENT_THEME.magenta50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitleSm: { fontSize: 16, fontWeight: '700', color: '#111827' },
  emptySubSm: { fontSize: 13, color: '#6b7280', marginTop: 4, marginBottom: 14 },
  resetSearchBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: PATIENT_THEME.magenta50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PATIENT_THEME.magenta100,
  },
  resetSearchBtnTxt: { color: PATIENT_THEME.magenta600, fontSize: 12.5, fontWeight: '700' },

  // ── Web Patient Matching Modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.52)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 30,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    width: '100%',
    maxHeight: '90%',
    paddingTop: 20,
    paddingBottom: 16,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.3,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 2,
    fontWeight: '500',
  },
  modalHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTrashBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#fee2e2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalScrollContent: {
    paddingBottom: 10,
  },
  modalImgWrapper: {
    width: '100%',
    height: 190,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    backgroundColor: '#f9fafb',
  },
  modalImg: {
    width: '100%',
    height: '100%',
  },
  modalMetaRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
    flexWrap: 'wrap',
  },
  modalMetaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#f3f4f6',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5.5,
  },
  modalMetaChipTxt: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
  confSection: {
    marginBottom: 16,
  },
  confHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  confLabel: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#374151',
  },
  confValue: {
    fontSize: 14,
    fontWeight: '800',
    color: PATIENT_THEME.magenta600,
  },
  confTrack: {
    width: '100%',
    height: 8,
    backgroundColor: '#f3f4f6',
    borderRadius: 4,
    overflow: 'hidden',
  },
  confFill: {
    height: '100%',
    backgroundColor: PATIENT_THEME.magenta600,
    borderRadius: 4,
  },
  infoSection: {
    marginBottom: 16,
  },
  infoSectionTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 6,
  },
  infoSectionBody: {
    fontSize: 13.5,
    color: '#4b5563',
    lineHeight: 20,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 7,
  },
  tipTxt: {
    fontSize: 13,
    color: '#4b5563',
    lineHeight: 19,
    flex: 1,
  },
  disclaimerBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff1f2',
    borderWidth: 1,
    borderColor: '#ffe4e6',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  disclaimerTxt: {
    flex: 1,
    fontSize: 12,
    color: '#9f1239',
    lineHeight: 18,
  },
  findDermBtn: {
    width: '100%',
    backgroundColor: PATIENT_THEME.magenta600,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: PATIENT_THEME.magenta600,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 3,
  },
  findDermTxt: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14.5,
  },
  deleteBottomBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 12,
    paddingVertical: 6,
  },
  deleteBottomTxt: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '600',
  },
});
