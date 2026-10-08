import { useState, useCallback } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { getCurrentUser, getSkinHistory, deleteScanResult } from '@/lib/store';
import type { ScanResult } from '@/lib/store';

const CONDITION_IMAGES: Record<string, any> = {
  'Acne Rosacea': require('../../assets/images/acne-rosacea.png'),
};

export default function HistoryScreen() {
  const router = useRouter();
  const [history, setHistory] = useState<ScanResult[]>([]);
  const [selected, setSelected] = useState<ScanResult | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [])
  );

  async function loadHistory() {
    const user = await getCurrentUser();
    if (!user) return;
    const h = await getSkinHistory(user.id);
    setHistory(h);
  }

  async function handleDelete(item: ScanResult) {
    Alert.alert(
      'Delete Scan',
      `Are you sure you want to delete the "${item.condition}" scan result? This cannot be undone.`,
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

  const filteredHistory = history.filter((item) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return (
      item.condition.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    );
  });

  return (
    <SafeAreaView style={styles.safe}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Scan History</Text>
          <Text style={styles.headerSub}>
            {history.length} total scan{history.length !== 1 ? 's' : ''}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.scanBtn}
          onPress={() => router.push('/(app)/scan')}
        >
          <Ionicons name="camera-outline" size={18} color="#fff" />
          <Text style={styles.scanBtnTxt}>New Scan</Text>
        </TouchableOpacity>
      </View>

      {/* ── Search bar ── */}
      {history.length > 0 && (
        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={16} color={COLORS.textSecondary} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by condition or category..."
            placeholderTextColor={COLORS.textSecondary}
            value={searchTerm}
            onChangeText={setSearchTerm}
          />
          {searchTerm.length > 0 && (
            <TouchableOpacity onPress={() => setSearchTerm('')} style={styles.clearBtn}>
              <Ionicons name="close-circle" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ── Empty state ── */}
      {history.length === 0 ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIconCircle}>
            <Ionicons name="document-text-outline" size={42} color={COLORS.primary} />
          </View>
          <Text style={styles.emptyTitle}>No Scans Yet</Text>
          <Text style={styles.emptySub}>
            Start your first AI skin analysis to see results here.
          </Text>
          <TouchableOpacity
            style={styles.ctaBtn}
            onPress={() => router.push('/(app)/scan')}
          >
            <Ionicons name="camera-outline" size={16} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.ctaBtnTxt}>Start Scan</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 80, paddingTop: 4 }}
        >
          {filteredHistory.length === 0 ? (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="search-outline" size={36} color={COLORS.primary} />
              </View>
              <Text style={styles.emptyTitle}>No Results</Text>
              <Text style={styles.emptySub}>No scans match "{searchTerm}"</Text>
            </View>
          ) : (
            <View style={styles.list}>
              {filteredHistory.map((item) => (
                <ScanCard
                  key={item.id}
                  item={item}
                  onPress={() => setSelected(item)}
                  onDelete={() => handleDelete(item)}
                />
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {/* ── Detail modal ── */}
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
// Scan Card
// ─────────────────────────────────────────────
function ScanCard({
  item,
  onPress,
  onDelete,
}: {
  item: ScanResult;
  onPress: () => void;
  onDelete: () => void;
}) {
  const confColor =
    item.confidence >= 80 ? COLORS.success :
    item.confidence >= 60 ? '#f59e0b' :
    COLORS.danger;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      {/* Thumbnail */}
      {(item.imageUri || CONDITION_IMAGES[item.condition]) ? (
        <Image
          source={item.imageUri ? { uri: item.imageUri } : CONDITION_IMAGES[item.condition]}
          style={styles.thumb}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.thumbPlaceholder}>
          <Ionicons name="image-outline" size={28} color={COLORS.textSecondary} />
        </View>
      )}

      {/* Body */}
      <View style={styles.cardBody}>
        {/* Condition name + delete */}
        <View style={styles.cardTopRow}>
          <Text style={styles.condName} numberOfLines={1}>{item.condition}</Text>
          <TouchableOpacity onPress={onDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
          </TouchableOpacity>
        </View>

        {/* Category pill */}
        <View style={styles.categoryPill}>
          <Text style={styles.categoryPillTxt}>{item.category}</Text>
        </View>

        {/* Confidence bar */}
        <View style={styles.confBarBg}>
          <View style={[styles.confBarFill, { width: `${item.confidence}%` as any, backgroundColor: confColor }]} />
        </View>

        {/* Bottom meta */}
        <View style={styles.cardBottomRow}>
          <View style={styles.cardMetaItem}>
            <Ionicons name="analytics-outline" size={11} color={confColor} />
            <Text style={[styles.cardMetaTxt, { color: confColor, fontWeight: '700' }]}>
              {item.confidence}%
            </Text>
          </View>
          <View style={styles.cardMetaItem}>
            <Ionicons name="calendar-outline" size={11} color={COLORS.textSecondary} />
            <Text style={styles.cardMetaTxt}>
              {new Date(item.date).toLocaleDateString('en-PH', {
                month: 'short', day: 'numeric', year: 'numeric',
              })}
            </Text>
          </View>
        </View>

        {/* Tags */}
        {item.referralSuggested && (
          <View style={styles.referralTag}>
            <Ionicons name="business-outline" size={10} color="#c2410c" />
            <Text style={styles.referralTagTxt}>Referral suggested</Text>
          </View>
        )}
        {item.status === 'flagged' && (
          <View style={styles.flagTag}>
            <Ionicons name="warning-outline" size={10} color="#b45309" />
            <Text style={styles.flagTagTxt}>Flagged for review</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────
// Detail View (bottom sheet modal)
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
  const location = result.answers?.bodyLocation;
  const scanDate = new Date(result.date).toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
  const confColor =
    result.confidence >= 80 ? COLORS.success :
    result.confidence >= 60 ? '#f59e0b' :
    COLORS.danger;
  const isGovReportable = result.isGovernmentReportable ?? false;

  return (
    <Modal visible animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>

          {/* Drag handle */}
          <View style={styles.dragHandle} />

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.detailContainer}
          >
            {/* Hero image */}
            {(result.imageUri || CONDITION_IMAGES[result.condition]) ? (
              <Image
                source={result.imageUri ? { uri: result.imageUri } : CONDITION_IMAGES[result.condition]}
                style={styles.detailHeroImg}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.detailHeroPlaceholder}>
                <Ionicons name="scan-outline" size={48} color={COLORS.primary} />
              </View>
            )}

            {/* Pills row + close btn */}
            <View style={styles.detailTopRow}>
              <View style={styles.detailPills}>
                <View style={styles.categoryPillLg}>
                  <Text style={styles.categoryPillLgTxt}>{result.category}</Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={onBack}
                style={styles.closeBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Condition name */}
            {isGovReportable ? (
              <>
                <Text style={styles.detailCondName}>Skin Concern Requires Immediate Attention</Text>
                <View style={[styles.alertBox, { backgroundColor: COLORS.dangerLight, borderColor: COLORS.danger + '33' }]}>
                  <Ionicons name="medical-outline" size={16} color={COLORS.danger} style={{ marginTop: 1 }} />
                  <Text style={[styles.alertTxt, { color: '#7f1d1d' }]}>
                    Confidential DOH Referral — specific condition name is not displayed to protect your privacy.{'\n\n'}
                    <Text style={{ fontWeight: '800' }}>DOH Hotline: 1555</Text>{'\n'}
                    Visit your nearest City Health Office{'\n'}
                    Free treatment available under NLCP.
                  </Text>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.detailCondName}>Possible {result.condition}</Text>
                {result.localName ? (
                  <Text style={styles.detailLocalName}>{result.localName} (Filipino name)</Text>
                ) : null}
              </>
            )}

            {/* Secondary possibility */}
            {result.secondaryCondition && (
              <View style={[styles.alertBox, { backgroundColor: '#fef3c7', borderColor: '#d97706' + '44' }]}>
                <Ionicons name="alert-circle-outline" size={16} color={COLORS.warning} style={{ marginTop: 1 }} />
                <Text style={[styles.alertTxt, { color: '#78350f' }]}>
                  <Text style={{ fontWeight: '700' }}>Could also be: {result.secondaryCondition}</Text> ({result.secondaryConfidence}% confidence){'\n'}
                  Two conditions scored within 30% of each other — consult a dermatologist for a definitive diagnosis.
                </Text>
              </View>
            )}

            {/* Meta chips */}
            <View style={styles.detailMetaRow}>
              {location ? (
                <View style={styles.metaChip}>
                  <Ionicons name="location-outline" size={13} color={COLORS.textSecondary} />
                  <Text style={styles.metaChipTxt}>{location}</Text>
                </View>
              ) : null}
              <View style={styles.metaChip}>
                <Ionicons name="calendar-outline" size={13} color={COLORS.textSecondary} />
                <Text style={styles.metaChipTxt}>{scanDate}</Text>
              </View>
            </View>

            {/* Confidence score */}
            <View style={styles.confSection}>
              <View style={styles.confRow}>
                <Text style={styles.confLabel}>Confidence Score</Text>
                <Text style={[styles.confValue, { color: confColor }]}>{result.confidence}%</Text>
              </View>
              <View style={styles.confBarBgLg}>
                <View style={[styles.confBarFillLg, { width: `${result.confidence}%` as any, backgroundColor: confColor }]} />
              </View>
            </View>

            {/* About */}
            {!isGovReportable && (
              <>
                <Text style={styles.detailSectionTitle}>What is {result.condition}?</Text>
                <Text style={styles.detailBodyTxt}>{result.description}</Text>
              </>
            )}

            {/* Care tips */}
            {!isGovReportable && (
              <>
                <Text style={styles.detailSectionTitle}>Basic Care Tips</Text>
                {result.careTips.map((tip) => (
                  <View key={tip} style={styles.tipRow}>
                    <View style={styles.tipCheck}>
                      <Ionicons name="checkmark" size={12} color="#fff" />
                    </View>
                    <Text style={styles.tipTxt}>{tip}</Text>
                  </View>
                ))}
              </>
            )}

            {/* Disclaimer */}
            <View style={styles.alertBox}>
              <Ionicons name="warning-outline" size={16} color={COLORS.danger} style={{ marginTop: 1 }} />
              <Text style={styles.alertTxt}>
                This is <Text style={{ fontWeight: '800' }}>NOT</Text> a medical diagnosis. Please consult a licensed dermatologist for proper evaluation and treatment.
              </Text>
            </View>

            {/* Find dermatologist CTA */}
            <TouchableOpacity
              style={styles.findDermBtn}
              onPress={() => { onBack(); router.push('/(app)/clinics'); }}
            >
              <Ionicons name="medkit-outline" size={16} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.findDermTxt}>Find a Dermatologist Near You</Text>
            </TouchableOpacity>

            {/* Delete */}
            <TouchableOpacity style={styles.deleteBtn} onPress={onDelete}>
              <Ionicons name="trash-outline" size={14} color={COLORS.danger} />
              <Text style={styles.deleteBtnTxt}>Delete this scan</Text>
            </TouchableOpacity>

            <View style={{ height: 32 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F8FA' },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    backgroundColor: '#fff',
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: COLORS.text },
  headerSub: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
    gap: 6,
  },
  scanBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // ── Search ──
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 2,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 11,
    fontSize: 14,
    color: COLORS.text,
  },
  clearBtn: { padding: 4 },

  // ── Empty ──
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 10,
    paddingBottom: 60,
  },
  emptyIconCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: COLORS.primaryLight ?? '#e6f4ea',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text },
  emptySub: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 21 },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 13,
    marginTop: 6,
  },
  ctaBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // ── List ──
  list: { paddingHorizontal: 20, paddingTop: 12, gap: 12 },

  // ── Scan Card ──
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    overflow: 'hidden',
    flexDirection: 'row',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  thumb: { width: 95, height: '100%' as any, minHeight: 105 },
  thumbPlaceholder: {
    width: 95,
    backgroundColor: '#F0F0F5',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 105,
  },
  cardBody: { flex: 1, padding: 13 },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  condName: { fontSize: 14, fontWeight: '700', color: COLORS.text, flex: 1, marginRight: 8 },
  categoryPill: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primaryLight ?? '#e6f4ea',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginBottom: 8,
  },
  categoryPillTxt: { color: COLORS.primary, fontWeight: '600', fontSize: 11 },
  confBarBg: {
    height: 5,
    backgroundColor: '#F0F0F5',
    borderRadius: 3,
    marginBottom: 8,
    overflow: 'hidden',
  },
  confBarFill: { height: 5, borderRadius: 3 },
  cardBottomRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  cardMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardMetaTxt: { fontSize: 11, color: COLORS.textSecondary },
  referralTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
    backgroundColor: '#fff7ed',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  referralTagTxt: { fontSize: 10, color: '#c2410c', fontWeight: '600' },
  flagTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  flagTagTxt: { fontSize: 10, color: '#b45309', fontWeight: '600' },

  // ── Modal / Detail ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '92%',
    minHeight: '60%',
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  detailContainer: { paddingHorizontal: 20, paddingTop: 12 },
  detailHeroImg: {
    width: '100%',
    height: 220,
    borderRadius: 18,
    marginBottom: 16,
  },
  detailHeroPlaceholder: {
    width: '100%',
    height: 160,
    borderRadius: 18,
    backgroundColor: COLORS.primaryLight ?? '#e6f4ea',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  detailTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  detailPills: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', flex: 1 },
  categoryPillLg: {
    backgroundColor: COLORS.primaryLight ?? '#e6f4ea',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  categoryPillLgTxt: { color: COLORS.primary, fontWeight: '700', fontSize: 12 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F5F6FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailCondName: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 4,
  },
  detailLocalName: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 14,
    marginTop: 2,
  },
  detailMetaRow: { flexDirection: 'row', gap: 10, marginBottom: 16, flexWrap: 'wrap' },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F5F6FA',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  metaChipTxt: { fontSize: 12, color: COLORS.textSecondary },
  confSection: {
    backgroundColor: '#F7F8FA',
    borderRadius: 14,
    padding: 14,
    marginBottom: 4,
  },
  confRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  confLabel: { fontSize: 13, color: COLORS.textSecondary, fontWeight: '500' },
  confValue: { fontSize: 15, fontWeight: '800' },
  confBarBgLg: {
    height: 8,
    backgroundColor: '#E8E8EE',
    borderRadius: 4,
    overflow: 'hidden',
  },
  confBarFillLg: { height: 8, borderRadius: 4 },
  detailSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 20,
    marginBottom: 8,
  },
  detailBodyTxt: { fontSize: 14, color: COLORS.textSecondary, lineHeight: 22 },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  tipCheck: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.success ?? '#16a34a',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  tipTxt: { fontSize: 14, color: COLORS.text, lineHeight: 21, flex: 1 },
  alertBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#fff0f3',
    borderRadius: 14,
    padding: 14,
    marginTop: 20,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#fecdd3',
  },
  alertTxt: { flex: 1, fontSize: 13, color: COLORS.text, lineHeight: 20 },
  findDermBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 16,
    marginTop: 16,
  },
  findDermTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
    alignSelf: 'center',
  },
  deleteBtnTxt: { color: COLORS.danger, fontSize: 13, fontWeight: '600' },
});