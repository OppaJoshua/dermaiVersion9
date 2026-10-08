import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { COLORS, PREMIUM_FEATURES } from '@/lib/constants';

export default function SubscriptionChoiceScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState<'free' | 'premium'>('free');

  function handleContinue() {
    console.log('[SubscriptionChoice] Continue pressed, selected=', selected);
    if (selected === 'premium') {
      router.replace('/(app)/subscription');
    } else {
      router.replace('/(app)');
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.brandContainer}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>DA</Text>
          </View>
          <Text style={styles.appName}>Welcome to DermAI!</Text>
          <Text style={styles.subtitle}>Choose a plan to get started</Text>
        </View>

        {/* Free Plan */}
        <TouchableOpacity
          style={[styles.planCard, selected === 'free' && styles.planCardSelected]}
          onPress={() => setSelected('free')}
        >
          <View style={styles.planHeader}>
            <View style={styles.radioOuter}>
              {selected === 'free' && <View style={styles.radioInner} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.planName}>Free Plan</Text>
              <Text style={styles.planPrice}>₱0</Text>
            </View>
          </View>
          <View style={styles.planFeatures}>
            <FeatureItem text="1 AI skin scan per account" />
            <FeatureItem text="Basic scan history" />
            <FeatureItem text="Clinic directory access" />
            <FeatureItem text="Standard appointment booking" />
          </View>
        </TouchableOpacity>

        {/* Premium Plan */}
        <TouchableOpacity
          style={[styles.planCard, styles.premiumCard, selected === 'premium' && styles.planCardSelected]}
          onPress={() => setSelected('premium')}
        >
          <View style={styles.recommendedBadge}>
            <Text style={styles.recommendedTxt}>⭐ Recommended</Text>
          </View>
          <View style={styles.planHeader}>
            <View style={styles.radioOuter}>
              {selected === 'premium' && <View style={styles.radioInner} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.planName}>Premium Monthly</Text>
              <Text style={styles.planPrice}>₱199<Text style={styles.planPer}>/month</Text></Text>
            </View>
          </View>
          <View style={styles.planFeatures}>
            {PREMIUM_FEATURES.map((f) => (
              <FeatureItem key={f} text={f} premium />
            ))}
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.continueBtn} onPress={handleContinue}>
          <Text style={styles.continueBtnTxt}>
            {selected === 'premium' ? 'Continue to Payment' : 'Start with Free Plan'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.note}>You can upgrade or change your plan anytime.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function FeatureItem({ text, premium }: { text: string; premium?: boolean }) {
  return (
    <View style={styles.featureRow}>
      <Text style={[styles.featureCheck, premium && { color: COLORS.primary }]}>✓</Text>
      <Text style={styles.featureTxt}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 48,
  },
  brandContainer: { alignItems: 'center', marginBottom: 28 },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  logoText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  appName: { fontSize: 22, fontWeight: '700', color: COLORS.text },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },
  planCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  premiumCard: {
    borderColor: COLORS.primaryLight,
  },
  planCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryLight + '30',
  },
  recommendedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 10,
  },
  recommendedTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
  planHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.primary,
  },
  planName: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  planPrice: { fontSize: 24, fontWeight: '800', color: COLORS.primary, marginTop: 2 },
  planPer: { fontSize: 14, fontWeight: '400', color: COLORS.textSecondary },
  planFeatures: { gap: 6 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  featureCheck: { color: '#16a34a', fontWeight: '700', fontSize: 14, marginTop: 1 },
  featureTxt: { fontSize: 13, color: COLORS.text, flex: 1, lineHeight: 19 },
  continueBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  continueBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
  note: { textAlign: 'center', color: COLORS.textSecondary, fontSize: 12, marginTop: 12 },
});
