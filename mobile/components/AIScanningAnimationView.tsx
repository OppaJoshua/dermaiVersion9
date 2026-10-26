import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Animated,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

export interface AIScanningAnimationViewProps {
  imageUri: string | null;
  referenceImageUri: string | null;
  onAnimationComplete?: () => void;
}

export default function AIScanningAnimationView({
  imageUri,
  referenceImageUri,
  onAnimationComplete,
}: AIScanningAnimationViewProps) {
  const [phaseIndex, setPhaseIndex] = useState(0);

  // Phase 1: Photo 1 springs and fades in from left
  const photo1Opacity = useRef(new Animated.Value(0)).current;
  const photo1Scale = useRef(new Animated.Value(0.8)).current;
  const photo1TranslateX = useRef(new Animated.Value(-50)).current;

  // Phase 2: Photo 2 scales & fades in + Neural Bridge node appears
  const photo2Opacity = useRef(new Animated.Value(0)).current;
  const photo2Scale = useRef(new Animated.Value(0.75)).current;
  const photo2TranslateX = useRef(new Animated.Value(0)).current;
  const bridgeOpacity = useRef(new Animated.Value(0)).current;
  const bridgeScale = useRef(new Animated.Value(0.5)).current;

  // Phase 3: Laser scan sweep, rhythmic scale pulse & ambient aura
  const laserY = useRef(new Animated.Value(-65)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;
  const auraOpacity = useRef(new Animated.Value(0.25)).current;

  // Phase 4: Convergence & Merge flash
  const mergeFlash = useRef(new Animated.Value(0)).current;

  // Phase 5: Neural progress bar (5% to 100%)
  const progressBar = useRef(new Animated.Value(0.05)).current;

  const PHASES = [
    {
      title: 'Detecting Close-Up Lesion...',
      sub: 'Extracting dermatological macro texture & lesion borders',
      tag: 'PHASE 1 / 5',
    },
    {
      title: 'Calibrating Wide-View Context...',
      sub: 'Evaluating anatomical skin region & surrounding tissue',
      tag: 'PHASE 2 / 5',
    },
    {
      title: 'Neural Feature Extraction...',
      sub: 'ResNet50 cross-referencing multi-layer skin patterns',
      tag: 'PHASE 3 / 5',
    },
    {
      title: 'Synthesizing Dual-View Evidence...',
      sub: 'Merging 70/30 visual weights with questionnaire answers',
      tag: 'PHASE 4 / 5',
    },
    {
      title: 'Finalizing AI Diagnosis...',
      sub: 'Generating clinical cross-reference & evidence report',
      tag: 'PHASE 5 / 5',
    },
  ];

  useEffect(() => {
    // -------------------------------------------------------------
    // Phase 1 - Photo 1 Entry (0.0s – 0.7s):
    // Springs and fades into view from the left
    // -------------------------------------------------------------
    Animated.parallel([
      Animated.timing(photo1Opacity, {
        toValue: 1,
        duration: 650,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.spring(photo1Scale, {
        toValue: 1,
        friction: 6,
        tension: 45,
        useNativeDriver: true,
      }),
      Animated.spring(photo1TranslateX, {
        toValue: 0,
        friction: 7,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();

    // -------------------------------------------------------------
    // Phase 2 - Photo 2 Entry & Neural Bridge (0.8s – 1.5s):
    // Photo 2 scales & fades into view next to Photo 1. Central bridge appears.
    // -------------------------------------------------------------
    const timerPhase2 = setTimeout(() => {
      setPhaseIndex(1);
      Animated.parallel([
        Animated.timing(photo2Opacity, {
          toValue: 1,
          duration: 600,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.spring(photo2Scale, {
          toValue: 1,
          friction: 6,
          tension: 45,
          useNativeDriver: true,
        }),
        Animated.timing(bridgeOpacity, {
          toValue: 1,
          duration: 450,
          useNativeDriver: true,
        }),
        Animated.spring(bridgeScale, {
          toValue: 1,
          friction: 7,
          tension: 50,
          useNativeDriver: true,
        }),
      ]).start();
    }, 800);

    // -------------------------------------------------------------
    // Phase 3 - Pulsating & Laser Scan Effect (1.6s – 2.5s):
    // Both photos pulse rhythmically in scale together (1.0 to 1.05) with glowing aura.
    // Laser beam sweeps up and down continuously.
    // -------------------------------------------------------------
    let laserAnimLoop: Animated.CompositeAnimation | null = null;
    let pulseAnimLoop: Animated.CompositeAnimation | null = null;
    let auraAnimLoop: Animated.CompositeAnimation | null = null;

    const timerPhase3 = setTimeout(() => {
      setPhaseIndex(2);

      laserAnimLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(laserY, {
            toValue: 65,
            duration: 900,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(laserY, {
            toValue: -65,
            duration: 900,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      );
      laserAnimLoop.start();

      pulseAnimLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseScale, {
            toValue: 1.05,
            duration: 650,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(pulseScale, {
            toValue: 1,
            duration: 650,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      );
      pulseAnimLoop.start();

      auraAnimLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(auraOpacity, {
            toValue: 0.85,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(auraOpacity, {
            toValue: 0.25,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      );
      auraAnimLoop.start();
    }, 1600);

    // -------------------------------------------------------------
    // Phase 4 - Dual-Photo Convergence & Merge Flash (2.6s – 3.5s):
    // Both photos slide horizontally toward each other into the center, visually merging.
    // Bright flash overlay bursts on impact.
    // -------------------------------------------------------------
    const timerPhase4 = setTimeout(() => {
      setPhaseIndex(3);
      Animated.parallel([
        Animated.timing(photo1TranslateX, {
          toValue: 36,
          duration: 750,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(photo2TranslateX, {
          toValue: -36,
          duration: 750,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(mergeFlash, {
            toValue: 0.92,
            duration: 350,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(mergeFlash, {
            toValue: 0,
            duration: 400,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    }, 2600);

    // -------------------------------------------------------------
    // Phase 5 - Progress & Completion (3.6s+):
    // Neural progress bar fills smoothly to 100% and triggers completion.
    // -------------------------------------------------------------
    const timerPhase5 = setTimeout(() => {
      setPhaseIndex(4);
    }, 3600);

    Animated.timing(progressBar, {
      toValue: 1,
      duration: 3600,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && onAnimationComplete) {
        onAnimationComplete();
      }
    });

    return () => {
      clearTimeout(timerPhase2);
      clearTimeout(timerPhase3);
      clearTimeout(timerPhase4);
      clearTimeout(timerPhase5);
      if (laserAnimLoop) laserAnimLoop.stop();
      if (pulseAnimLoop) pulseAnimLoop.stop();
      if (auraAnimLoop) auraAnimLoop.stop();
    };
  }, []);

  const progressInterpolate = progressBar.interpolate({
    inputRange: [0, 1],
    outputRange: ['5%', '100%'],
  });

  const currentPhase = PHASES[phaseIndex] || PHASES[0];

  return (
    <View style={styles.container}>
      {/* Ambient Aura Background */}
      <Animated.View style={[styles.auraGlow, { opacity: auraOpacity }]} />

      {/* Header Badge */}
      <View style={styles.headerBadge}>
        <Ionicons name="sparkles" size={13} color={COLORS.primary} />
        <Text style={styles.headerBadgeText}>DERMAI NEURAL ENGINE</Text>
        <View style={styles.phasePill}>
          <Text style={styles.phasePillText}>{currentPhase.tag}</Text>
        </View>
      </View>

      {/* Dynamic Status Header */}
      <Text style={styles.title}>{currentPhase.title}</Text>
      <Text style={styles.subtitle}>{currentPhase.sub}</Text>

      {/* Dual Photo Stage Container */}
      <View style={styles.stage}>
        {/* Photo 1: Close-up Lesion */}
        <Animated.View
          style={[
            styles.photoCard,
            {
              opacity: photo1Opacity,
              transform: [
                { scale: Animated.multiply(photo1Scale, pulseScale) },
                { translateX: photo1TranslateX },
              ],
            },
          ]}
        >
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.photoImage} resizeMode="cover" />
          ) : (
            <View style={styles.placeholderPhoto}>
              <Ionicons name="image" size={32} color={COLORS.primary} />
            </View>
          )}

          {/* Label Badge */}
          <View style={styles.photoLabelPill}>
            <Ionicons name="scan-outline" size={10} color="#ffffff" style={{ marginRight: 3 }} />
            <Text style={styles.photoLabelText}>1. Close-Up</Text>
          </View>

          {/* High-Tech HUD Corner Brackets */}
          <View style={[styles.bracket, styles.bracketTL]} />
          <View style={[styles.bracket, styles.bracketTR]} />
          <View style={[styles.bracket, styles.bracketBL]} />
          <View style={[styles.bracket, styles.bracketBR]} />
        </Animated.View>

        {/* Central Neural Bridge Node */}
        <Animated.View
          style={[
            styles.bridgeContainer,
            {
              opacity: bridgeOpacity,
              transform: [{ scale: bridgeScale }],
            },
          ]}
        >
          <View style={styles.bridgeLine} />
          <Animated.View
            style={[
              styles.bridgeIconWrap,
              { transform: [{ scale: pulseScale }] },
            ]}
          >
            <Ionicons name="git-merge" size={16} color={COLORS.primary} />
          </Animated.View>
          <View style={styles.bridgeLine} />
        </Animated.View>

        {/* Photo 2: Wide-View Context */}
        <Animated.View
          style={[
            styles.photoCard,
            {
              opacity: photo2Opacity,
              transform: [
                { scale: Animated.multiply(photo2Scale, pulseScale) },
                { translateX: photo2TranslateX },
              ],
            },
          ]}
        >
          {referenceImageUri ? (
            <Image
              source={{ uri: referenceImageUri }}
              style={styles.photoImage}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.placeholderPhoto}>
              <Ionicons name="body" size={32} color={COLORS.primary} />
            </View>
          )}

          {/* Label Badge */}
          <View style={styles.photoLabelPill}>
            <Ionicons name="compass-outline" size={10} color="#ffffff" style={{ marginRight: 3 }} />
            <Text style={styles.photoLabelText}>2. Wide-View</Text>
          </View>

          {/* High-Tech HUD Corner Brackets */}
          <View style={[styles.bracket, styles.bracketTL]} />
          <View style={[styles.bracket, styles.bracketTR]} />
          <View style={[styles.bracket, styles.bracketBL]} />
          <View style={[styles.bracket, styles.bracketBR]} />
        </Animated.View>

        {/* Laser Scanning Beam Sweeping Vertically */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.laserBeam,
            { transform: [{ translateY: laserY }] },
          ]}
        >
          <View style={styles.laserGlow} />
        </Animated.View>

        {/* Bright Flash Overlay On Merge Impact */}
        <Animated.View
          pointerEvents="none"
          style={[styles.mergeFlashOverlay, { opacity: mergeFlash }]}
        />
      </View>

      {/* Progress Bar & Status Section */}
      <View style={styles.progressSection}>
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { width: progressInterpolate }]} />
        </View>
        <View style={styles.progressFooter}>
          <View style={styles.progressFooterLeft}>
            <View style={styles.liveIndicatorDot} />
            <Text style={styles.progressStatusText}>Deep neural scan running...</Text>
          </View>
          <Text style={styles.progressWeightText}>70/30 Dual-View</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#f1f5f9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 4,
    overflow: 'hidden',
    position: 'relative',
  },
  auraGlow: {
    position: 'absolute',
    top: -50,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: '#fce7f3',
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fdf2f8',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#fbcfe8',
    marginBottom: 12,
  },
  headerBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: 0.6,
  },
  phasePill: {
    backgroundColor: '#fbcfe8',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    marginLeft: 4,
  },
  phasePillText: {
    fontSize: 9,
    fontWeight: '800',
    color: COLORS.primaryDark,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 18,
    paddingHorizontal: 10,
    lineHeight: 17,
    minHeight: 34,
  },
  stage: {
    width: '100%',
    height: 180,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
    position: 'relative',
  },
  photoCard: {
    width: 125,
    height: 155,
    borderRadius: 16,
    backgroundColor: '#f8fafc',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
    position: 'relative',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  placeholderPhoto: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fdf2f8',
  },
  photoLabelPill: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    right: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoLabelText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#ffffff',
  },
  bridgeContainer: {
    width: 38,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  bridgeLine: {
    width: 2,
    height: 24,
    backgroundColor: '#fbcfe8',
  },
  bridgeIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#fdf2f8',
    borderWidth: 1,
    borderColor: '#fbcfe8',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  bracket: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderColor: '#ffffff',
  },
  bracketTL: { top: 6, left: 6, borderTopWidth: 2, borderLeftWidth: 2 },
  bracketTR: { top: 6, right: 6, borderTopWidth: 2, borderRightWidth: 2 },
  bracketBL: { bottom: 26, left: 6, borderBottomWidth: 2, borderLeftWidth: 2 },
  bracketBR: { bottom: 26, right: 6, borderBottomWidth: 2, borderRightWidth: 2 },
  laserBeam: {
    position: 'absolute',
    left: 10,
    right: 10,
    height: 3,
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 10,
    elevation: 8,
    zIndex: 10,
  },
  laserGlow: {
    position: 'absolute',
    top: -5,
    left: 0,
    right: 0,
    height: 13,
    backgroundColor: 'rgba(190, 24, 93, 0.3)',
    borderRadius: 6,
  },
  mergeFlashOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    zIndex: 20,
  },
  progressSection: {
    width: '100%',
    marginTop: 18,
  },
  progressTrack: {
    height: 7,
    backgroundColor: '#f1f5f9',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 4,
  },
  progressFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  progressFooterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveIndicatorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
  },
  progressStatusText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  progressWeightText: {
    fontSize: 11,
    color: COLORS.primary,
    fontWeight: '700',
  },
});
