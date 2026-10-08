import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '@/lib/constants';
import { CONDITION_MAP, type ConditionData } from '@/lib/conditions';

const ALL_CONDITIONS = Object.values(CONDITION_MAP);
const CATEGORIES = ['All', ...Array.from(new Set(ALL_CONDITIONS.map((c) => c.category)))];

export default function LibraryScreen() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [selected, setSelected] = useState<ConditionData | null>(null);

  const filtered = ALL_CONDITIONS.filter((c) => {
    const matchCategory = category === 'All' || c.category === category;
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.localName.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q);
    return matchCategory && matchSearch;
  });

  if (selected) {
    return <ConditionDetail condition={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Skin Library</Text>
        <Text style={styles.headerSub}>Learn about common skin conditions</Text>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search conditions..."
          placeholderTextColor={COLORS.textLight}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} style={styles.clearBtn}>
            <Text style={styles.clearBtnTxt}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Category filter */}
      <View style={styles.categoryWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryContent}
        >
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[styles.categoryChip, category === cat && styles.categoryChipActive]}
              onPress={() => setCategory(cat)}
            >
              <Text style={[styles.categoryChipTxt, category === cat && styles.categoryChipTxtActive]}>
                {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={{ fontSize: 44, marginBottom: 12 }}>🔍</Text>
            <Text style={styles.emptyTitle}>No Conditions Found</Text>
            <Text style={styles.emptySub}>Try a different search term or category.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {filtered.map((c) => (
              <TouchableOpacity
                key={c.name}
                style={styles.card}
                onPress={() => setSelected(c)}
              >
                <Image source={{ uri: c.images[0] }} style={styles.cardImg} />
                <View style={styles.cardBody}>
                  <View style={styles.catBadge}>
                    <Text style={styles.catBadgeTxt}>{c.category}</Text>
                  </View>
                  <Text style={styles.cardName}>{c.name}</Text>
                  <Text style={styles.cardLocal}>{c.localName}</Text>
                  <Text style={styles.cardDesc} numberOfLines={2}>{c.description}</Text>
                  <Text style={styles.learnMore}>Learn More →</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function ConditionDetail({
  condition,
  onBack,
}: {
  condition: ConditionData;
  onBack: () => void;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.detailHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backTxt}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.detailHeaderTitle}>{condition.name}</Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
        {/* Image gallery */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
          {condition.images.map((img, idx) => (
            <Image key={idx} source={{ uri: img }} style={styles.galleryImg} />
          ))}
        </ScrollView>

        {/* Name & Category */}
        <View style={styles.detailCard}>
          <View style={styles.catBadge}>
            <Text style={styles.catBadgeTxt}>{condition.category}</Text>
          </View>
          <Text style={styles.detailName}>{condition.name}</Text>
          <Text style={styles.detailLocal}>{condition.localName}</Text>
          <View style={styles.sevRow}>
            <Text style={styles.sevLabel}>Severity:</Text>
            <Text style={[styles.sevValue, {
              color: condition.severity === 'severe' ? '#dc2626' : condition.severity === 'moderate' ? '#f59e0b' : '#16a34a',
            }]}>
              {condition.severity.charAt(0).toUpperCase() + condition.severity.slice(1)}
            </Text>
          </View>
        </View>

        {/* Description */}
        <Section title="About this Condition">
          <Text style={styles.bodyTxt}>{condition.description}</Text>
        </Section>

        {/* Symptoms */}
        <Section title="Common Symptoms">
          {condition.symptoms.map((s) => (
            <Text key={s} style={styles.bullet}>• {s}</Text>
          ))}
        </Section>

        {/* Who affected */}
        <Section title="Who is Affected">
          <Text style={styles.bodyTxt}>{condition.whoAffected}</Text>
        </Section>

        {/* Care tips */}
        <Section title="Recommended Care">
          {condition.careTips.map((t, i) => (
            <Text key={t} style={styles.bullet}>{i + 1}. {t}</Text>
          ))}
        </Section>

        {/* When to see doctor */}
        <Section title="When to See a Doctor">
          <View style={styles.doctorBox}>
            <Text style={styles.doctorBoxTxt}>🏥 {condition.whenToSeeDoctor}</Text>
          </View>
        </Section>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 },
  headerTitle: { fontSize: 24, fontWeight: '700', color: COLORS.text },
  headerSub: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 10,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: COLORS.text },
  clearBtn: { padding: 6 },
  clearBtnTxt: { color: COLORS.textSecondary, fontSize: 16, fontWeight: '600' },
  categoryWrapper: {
    height: 48,
    marginBottom: 8,
  },
  categoryContent: { paddingHorizontal: 16, gap: 8, alignItems: 'center', flexGrow: 1 },
  categoryChip: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    backgroundColor: COLORS.surface,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  categoryChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  categoryChipTxt: { fontSize: 13, fontWeight: '500', color: COLORS.text },
  categoryChipTxtActive: { color: '#fff', fontWeight: '700' },
  empty: { paddingTop: 60, alignItems: 'center', gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  emptySub: { fontSize: 14, color: COLORS.textSecondary },
  list: { paddingHorizontal: 16, gap: 14 },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  cardImg: { width: '100%', height: 140 },
  cardBody: { padding: 14 },
  catBadge: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primaryLight,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 6,
  },
  catBadgeTxt: { fontSize: 11, fontWeight: '700', color: COLORS.primary },
  cardName: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  cardLocal: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 6 },
  cardDesc: { fontSize: 13, color: COLORS.text, lineHeight: 19, marginBottom: 8 },
  learnMore: { fontSize: 13, color: COLORS.primary, fontWeight: '600' },
  // Detail
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  backBtn: { paddingVertical: 6 },
  backTxt: { color: COLORS.primary, fontWeight: '600', fontSize: 16 },
  detailHeaderTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text, flex: 1, textAlign: 'center' },
  detailContent: { paddingHorizontal: 20, paddingTop: 8 },
  galleryImg: { width: 220, height: 160, borderRadius: 14, marginRight: 10 },
  detailCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  detailName: { fontSize: 22, fontWeight: '700', color: COLORS.text, marginTop: 4 },
  detailLocal: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 8 },
  sevRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  sevLabel: { fontSize: 13, color: COLORS.textSecondary },
  sevValue: { fontSize: 13, fontWeight: '700' },
  section: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text, marginBottom: 10 },
  bodyTxt: { fontSize: 13, color: COLORS.text, lineHeight: 20 },
  bullet: { fontSize: 13, color: COLORS.text, marginBottom: 5, lineHeight: 19 },
  doctorBox: {
    backgroundColor: '#fff7ed',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  doctorBoxTxt: { fontSize: 13, color: '#7c2d12', lineHeight: 19 },
});
