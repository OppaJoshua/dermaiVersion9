import { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Platform, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '@/lib/constants';

function SkeletonBlock({
  width,
  height,
  borderRadius = 10,
  style,
}: {
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  style?: any;
}) {
  const pulseAnim = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.85,
          duration: 750,
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.35,
          duration: 750,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulseAnim]);

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height: height as any,
          borderRadius,
          backgroundColor: '#E2E8F0',
          opacity: pulseAnim,
        },
        style,
      ]}
    />
  );
}

export default function DashboardSkeleton({
  statusMessage = 'Signing you in...',
}: {
  statusMessage?: string;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* ── Header Skeleton ── */}
        <View style={styles.header}>
          <SkeletonBlock width={44} height={44} borderRadius={22} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <SkeletonBlock width={80} height={11} borderRadius={6} style={{ marginBottom: 6 }} />
            <SkeletonBlock width={120} height={18} borderRadius={8} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <SkeletonBlock width={40} height={40} borderRadius={20} />
            <SkeletonBlock width={40} height={40} borderRadius={20} />
          </View>
        </View>

        {/* ── Hero Banner Skeleton ── */}
        <View style={styles.heroSkeletonWrap}>
          <SkeletonBlock
            width="100%"
            height={150}
            borderRadius={22}
            style={{ backgroundColor: '#fce7f3' }}
          />
          <View style={styles.heroInnerContent}>
            <View style={{ flex: 1, padding: 18 }}>
              <SkeletonBlock width={140} height={20} borderRadius={8} style={{ marginBottom: 8, backgroundColor: '#f472b6' }} />
              <SkeletonBlock width={100} height={20} borderRadius={8} style={{ marginBottom: 18, backgroundColor: '#f472b6' }} />
              <SkeletonBlock width={115} height={32} borderRadius={12} style={{ backgroundColor: '#ffffff' }} />
            </View>
            <View style={{ width: 120, height: 140, justifyContent: 'flex-end', alignItems: 'center' }}>
              <SkeletonBlock width={90} height={120} borderRadius={18} style={{ backgroundColor: '#fbcfe8' }} />
            </View>
          </View>
        </View>

        {/* ── Section 1: Your Overview ── */}
        <View style={styles.sectionHeader}>
          <SkeletonBlock width={110} height={18} borderRadius={8} />
        </View>

        {/* ── 2×2 Overview Grid Skeleton ── */}
        <View style={styles.overviewGrid}>
          {[1, 2, 3, 4].map((i) => (
            <View key={i} style={styles.overviewCardSkeleton}>
              <SkeletonBlock
                width="100%"
                height="100%"
                borderRadius={16}
                style={{ backgroundColor: '#fce7f3' }}
              />
              <View style={styles.overviewInner}>
                <View style={styles.overviewTopRow}>
                  <SkeletonBlock width={75} height={12} borderRadius={6} style={{ backgroundColor: '#f472b6' }} />
                  <SkeletonBlock width={26} height={26} borderRadius={13} style={{ backgroundColor: '#ffffff' }} />
                </View>
                <SkeletonBlock width={38} height={24} borderRadius={8} style={{ backgroundColor: '#be185d' }} />
              </View>
            </View>
          ))}
        </View>

        {/* ── Section 2: Recent Analyses ── */}
        <View style={styles.sectionHeader}>
          <SkeletonBlock width={130} height={18} borderRadius={8} />
          <SkeletonBlock width={55} height={14} borderRadius={6} />
        </View>

        {/* ── Recent Analysis Card Skeleton ── */}
        <View style={styles.recentAnalysisCard}>
          <SkeletonBlock width={56} height={56} borderRadius={28} style={{ backgroundColor: '#fce7f3' }} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <SkeletonBlock width={110} height={16} borderRadius={8} style={{ marginBottom: 8 }} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <SkeletonBlock width={75} height={18} borderRadius={6} />
              <SkeletonBlock width={75} height={18} borderRadius={6} style={{ backgroundColor: '#fce7f3' }} />
            </View>
          </View>
          <SkeletonBlock width={16} height={16} borderRadius={8} />
        </View>

        {/* ── Status Toast Pill ── */}
        {statusMessage ? (
          <View style={styles.statusToast}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>{statusMessage}</Text>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, backgroundColor: '#F7F8FA' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: '#fff',
  },
  heroSkeletonWrap: {
    marginHorizontal: 20,
    marginTop: 6,
    marginBottom: 20,
    borderRadius: 22,
    height: 150,
    overflow: 'hidden',
    position: 'relative',
  },
  heroInnerContent: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  overviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    justifyContent: 'space-between',
    rowGap: 10,
    marginBottom: 20,
  },
  overviewCardSkeleton: {
    width: '48.5%',
    height: 82,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  overviewInner: {
    ...StyleSheet.absoluteFill,
    paddingVertical: 12,
    paddingHorizontal: 13,
    justifyContent: 'space-between',
  },
  overviewTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recentAnalysisCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginHorizontal: 20,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  statusToast: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(31, 41, 55, 0.88)',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 24,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34d399',
  },
  statusText: {
    color: '#fff',
    fontSize: 12.5,
    fontWeight: '600',
  },
});
