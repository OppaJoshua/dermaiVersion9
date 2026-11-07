import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Image,
  Platform,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { COLORS, FONTS } from '@/lib/constants';
import {
  getCurrentUser,
  getSkinHistory,
  getAppointments,
  getAppNotifications,
  getSavedClinics,
  syncAppointmentNotifications,
  subscribeToAppNotifications,
} from '@/lib/store';
import type { PatientAccount, Appointment, ScanResult } from '@/lib/store';

const WEB_MAGENTA = '#85134a';
const WEB_MAGENTA_MID = '#A0195A';
const WEB_MAGENTA_LIGHT = '#fce7f0';
const WEB_PATIENT_BG = '#f8f5f6';

function RadialProgressBar({
  progress,
  size = 56,
  strokeWidth = 5,
  color = WEB_MAGENTA_MID,
  bgColor = WEB_MAGENTA_LIGHT,
}: {
  progress: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  bgColor?: string;
}) {
  const safeProgress = Math.min(Math.max(isNaN(progress) ? 0 : progress, 0), 100);
  const strokeColor = color || WEB_MAGENTA_MID;
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

function DashboardSectionSkeleton({ pulseAnim }: { pulseAnim: Animated.Value }) {
  return (
    <Animated.View style={[styles.skeletonCard, { opacity: pulseAnim }]}>
      <View style={styles.skelPillSm} />
      <View style={styles.skelHeaderRow}>
        <View style={styles.skelTitleBlock} />
        <View style={styles.skelBadgePill} />
      </View>

      <View style={styles.skelTwoColRow}>
        <View style={styles.skelMiniBox}>
          <View style={[styles.skelPillSm, { width: 52, marginBottom: 8 }]} />
          <View style={[styles.skelValueBar, { width: 72 }]} />
        </View>
        <View style={styles.skelMiniBox}>
          <View style={[styles.skelPillSm, { width: 64, marginBottom: 8 }]} />
          <View style={[styles.skelValueBar, { width: 84 }]} />
        </View>
      </View>

      <View style={[styles.skelPillSm, { width: 105, height: 13, marginBottom: 10 }]} />
      <View style={styles.skelDashedRow}>
        <View style={styles.skelAvatarBox} />
        <View style={{ flex: 1, gap: 7 }}>
          <View style={[styles.skelLineBar, { width: '62%' }]} />
          <View style={[styles.skelLineBar, { width: '84%', height: 10 }]} />
        </View>
      </View>
    </Animated.View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const [user, setUser] = useState<PatientAccount | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [conditionsFound, setConditionsFound] = useState(0);
  const [lastScanLabel, setLastScanLabel] = useState('Never');
  const [recentScans, setRecentScans] = useState<ScanResult[]>([]);
  const [nextAppt, setNextAppt] = useState<Appointment | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [clinicsSavedCount, setClinicsSavedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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
          toValue: 0.48,
          duration: 750,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  async function loadData(isPullRefresh = false) {
    if (!isPullRefresh && !hasLoadedRef.current) setLoading(true);
    try {
      const u = await getCurrentUser();
      setUser(u);
      if (!u) return;

      // Fetch all dashboard sections in parallel instead of sequentially
      const [history, appts, notifs, saved] = await Promise.all([
        getSkinHistory(u.id),
        getAppointments(u.id),
        getAppNotifications(u.id),
        getSavedClinics(u.id),
      ]);

      setScanCount(history.length);
      setRecentScans(history.slice(0, 3));

      const uniqueConditions = new Set(history.map((h) => h.condition));
      setConditionsFound(uniqueConditions.size);

      if (history.length > 0) {
        const diff = Date.now() - new Date(history[0].date).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 60) setLastScanLabel(`${Math.max(1, mins)}m ago`);
        else if (mins < 1440) setLastScanLabel(`${Math.floor(mins / 60)}h ago`);
        else setLastScanLabel(`${Math.floor(mins / 1440)}d ago`);
      } else {
        setLastScanLabel('Never');
      }

      const activeAppts = appts.filter(
        (a) => a.status === 'pending' || a.status === 'scheduled' || a.status === 'confirmed'
      );
      activeAppts.sort((a, b) => {
        const aTime = a.date ? new Date(a.date).getTime() : Infinity;
        const bTime = b.date ? new Date(b.date).getTime() : Infinity;
        return aTime - bTime;
      });
      setNextAppt(activeAppts[0] ?? null);

      setUnreadCount(notifs.filter((n) => !n.read).length);
      setClinicsSavedCount(saved.length);
      hasLoadedRef.current = true;
    } finally {
      setLoading(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      loadData(false);
    }, [])
  );

  // Real-time listener for Supabase notification changes across all tables
  useEffect(() => {
    if (!user?.id) return;
    const unsubscribe = subscribeToAppNotifications(user.id, () => {
      loadData(true);
    });
    return () => unsubscribe();
  }, [user?.id]);

  async function onRefresh() {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  }

  const firstName = user?.fullName?.split(' ')[0] ?? 'there';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={WEB_MAGENTA} />}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.avatarCircle}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Open profile"
            onPress={() => router.push('/profile')}
          >
            {user?.profileImage ? (
              <Image source={{ uri: user.profileImage }} style={styles.avatarImg} />
            ) : (
              <Ionicons name="person" size={20} color={WEB_MAGENTA} />
            )}
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.headerWelcome}>Hello,</Text>
            <Text style={styles.headerName}>{firstName}!</Text>
          </View>
          <TouchableOpacity
            style={styles.iconBtn}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Open notifications"
            onPress={() => router.push('/notifications')}
          >
            <View pointerEvents="none">
              <Ionicons name="notifications-outline" size={20} color={COLORS.text} />
            </View>
            {unreadCount > 0 && (
              <View pointerEvents="none" style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : String(unreadCount)}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* ── Hero Banner (text left, doctor icon right) ── */}
        <TouchableOpacity style={styles.heroBanner} activeOpacity={0.92} onPress={() => router.push('/(app)/clinics')}>
          <View pointerEvents="none" style={styles.heroDecorCircle} />
          <View style={styles.heroLeft}>
            <Text style={styles.heroTitle}>Looking for a{'\n'}Derma Clinic?</Text>
            <View style={styles.heroBtn}>
              <Ionicons name="search-outline" size={13} color={WEB_MAGENTA} style={{ marginRight: 5 }} />
              <Text style={styles.heroBtnText} numberOfLines={1}>Search for Clinic</Text>
            </View>
          </View>

          <View style={styles.heroRight}>
            <Image
              source={require('../../assets/images/heroDoctor.png')}
              style={styles.heroDoctorImage}
              resizeMode="cover"
            />
          </View>
        </TouchableOpacity>

        {/* ── 1. Your Overview ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Your Overview</Text>
        </View>

        <View style={styles.overviewGrid}>
          {/* Card 1 — Total Scans */}
          <View style={[styles.overviewCard, styles.overviewCardFeatured]}>
            <View pointerEvents="none" style={styles.overviewDecorCircle} />
            <View style={styles.overviewTopRow}>
              <Text style={styles.overviewLabelFeatured} numberOfLines={1}>
                Total Scans
              </Text>
              <View style={styles.overviewArrowBtnFeatured}>
                <Feather name="arrow-up-right" size={13} color="#fff" />
              </View>
            </View>
            {loading ? (
              <Animated.View style={[styles.statSkelFeatured, { opacity: pulseAnim }]} />
            ) : (
              <Text style={styles.overviewValueFeatured}>{scanCount}</Text>
            )}
          </View>

          {/* Card 2 — Conditions Found */}
          <View style={[styles.overviewCard, styles.overviewCardFeatured]}>
            <View pointerEvents="none" style={styles.overviewDecorCircle} />
            <View style={styles.overviewTopRow}>
              <Text style={styles.overviewLabelFeatured} numberOfLines={1}>
                Conditions Found
              </Text>
              <View style={styles.overviewArrowBtnFeatured}>
                <Feather name="arrow-up-right" size={13} color="#fff" />
              </View>
            </View>
            {loading ? (
              <Animated.View style={[styles.statSkelFeatured, { opacity: pulseAnim }]} />
            ) : (
              <Text style={styles.overviewValueFeatured}>{conditionsFound}</Text>
            )}
          </View>

          {/* Card 3 — Clinics Saved */}
          <View style={[styles.overviewCard, styles.overviewCardFeatured]}>
            <View pointerEvents="none" style={styles.overviewDecorCircle} />
            <View style={styles.overviewTopRow}>
              <Text style={styles.overviewLabelFeatured} numberOfLines={1}>
                Clinics Saved
              </Text>
              <View style={styles.overviewArrowBtnFeatured}>
                <Feather name="arrow-up-right" size={13} color="#fff" />
              </View>
            </View>
            {loading ? (
              <Animated.View style={[styles.statSkelFeatured, { opacity: pulseAnim }]} />
            ) : (
              <Text style={styles.overviewValueFeatured}>{clinicsSavedCount}</Text>
            )}
          </View>

          {/* Card 4 — Last Scan */}
          <View style={[styles.overviewCard, styles.overviewCardFeatured]}>
            <View pointerEvents="none" style={styles.overviewDecorCircle} />
            <View style={styles.overviewTopRow}>
              <Text style={styles.overviewLabelFeatured} numberOfLines={1}>
                Last Scan
              </Text>
              <View style={styles.overviewArrowBtnFeatured}>
                <Feather name="arrow-up-right" size={13} color="#fff" />
              </View>
            </View>
            {loading ? (
              <Animated.View style={[styles.statSkelFeatured, { opacity: pulseAnim }]} />
            ) : (
              <Text
                style={[
                  styles.overviewValueFeatured,
                  { fontSize: lastScanLabel.length > 5 ? 17 : 22 },
                ]}
              >
                {lastScanLabel}
              </Text>
            )}
          </View>
        </View>

        {/* ── 2. Recent Analyses ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Analyses</Text>
          <TouchableOpacity onPress={() => router.push('/(app)/history')}>
            <Text style={styles.seeAll}>View All &rsaquo;</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <DashboardSectionSkeleton pulseAnim={pulseAnim} />
        ) : recentScans.length > 0 ? (
          <View style={styles.listContainer}>
            {recentScans.map((scan) => (
              <TouchableOpacity
                key={scan.id}
                style={styles.recentAnalysisCard}
                activeOpacity={0.82}
                onPress={() => router.push('/(app)/history')}
              >
                <RadialProgressBar
                  progress={scan.confidence}
                  size={56}
                  strokeWidth={5}
                  color={WEB_MAGENTA_MID}
                  bgColor={WEB_MAGENTA_LIGHT}
                />
                <View style={styles.analysisBody}>
                  <Text style={styles.analysisTitle} numberOfLines={1}>
                    {scan.condition}
                  </Text>
                  <View style={styles.analysisMetaRow}>
                    <View style={styles.metaBadge}>
                      <Ionicons name="calendar-outline" size={11} color={COLORS.textSecondary} />
                      <Text style={styles.metaBadgeText}>
                        {new Date(scan.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </Text>
                    </View>
                    <View style={[styles.metaBadge, { backgroundColor: '#fdf2f7' }]}>
                      <Ionicons name="sparkles" size={11} color={WEB_MAGENTA} />
                      <Text style={[styles.metaBadgeText, { color: WEB_MAGENTA, fontWeight: '700' }]}>
                        AI Analysis
                      </Text>
                    </View>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <TouchableOpacity
            style={styles.emptyAnalysisCard}
            activeOpacity={0.85}
            onPress={() => router.push('/(app)/scan')}
          >
            <RadialProgressBar
              progress={0}
              size={52}
              strokeWidth={4.5}
              color={WEB_MAGENTA_MID}
              bgColor={WEB_MAGENTA_LIGHT}
            />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.emptyAnalysisTitle}>No Skin Analysis Yet</Text>
              <Text style={styles.emptyAnalysisSub}>Take an AI skin scan in seconds</Text>
            </View>
            <View style={styles.startScanBtn}>
              <Text style={styles.startScanBtnText}>Start</Text>
              <Ionicons name="arrow-forward" size={12} color="#fff" />
            </View>
          </TouchableOpacity>
        )}

        {/* ── 3. Upcoming Appointment ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Upcoming Appointment</Text>
          {nextAppt && (
            <TouchableOpacity onPress={() => router.push('/(app)/appointments')}>
              <Text style={styles.seeAll}>Manage &rsaquo;</Text>
            </TouchableOpacity>
          )}
        </View>

        {loading ? (
          <Animated.View style={[styles.skeletonCard, { opacity: pulseAnim, marginBottom: 20 }]}>
            <View style={styles.skelDashedRow}>
              <View style={styles.skelAvatarBox} />
              <View style={{ flex: 1, gap: 7 }}>
                <View style={[styles.skelLineBar, { width: '55%' }]} />
                <View style={[styles.skelLineBar, { width: '78%', height: 10 }]} />
              </View>
            </View>
          </Animated.View>
        ) : nextAppt ? (
          <TouchableOpacity
            style={styles.redesignedApptCard}
            activeOpacity={0.88}
            onPress={() => router.push('/(app)/appointments')}
          >
            <View style={styles.apptDoctorRow}>
              <View style={styles.apptDoctorAvatarWrap}>
                {nextAppt.doctorPhotoUrl ? (
                  <Image
                    source={{ uri: nextAppt.doctorPhotoUrl }}
                    style={styles.apptDoctorAvatar}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.apptDoctorAvatarFallback}>
                    <Ionicons name="medical" size={22} color="#ffffff" />
                  </View>
                )}
                <View style={styles.apptDoctorOnlineDot} />
              </View>

              <View style={styles.apptDoctorInfo}>
                <View style={styles.apptDoctorHeaderRow}>
                  <Text style={styles.apptDoctorName} numberOfLines={1}>
                    {nextAppt.doctorName
                      ? (nextAppt.doctorName.toLowerCase().startsWith('dr')
                          ? nextAppt.doctorName
                          : `Dr. ${nextAppt.doctorName}`)
                      : 'Assigned Specialist'}
                  </Text>
                  <View style={styles.apptStatusBadge}>
                    <Text style={styles.apptStatusText}>
                      {nextAppt.status === 'confirmed' || nextAppt.status === 'scheduled'
                        ? 'Confirmed'
                        : nextAppt.status === 'completed'
                        ? 'Completed'
                        : 'Pending'}
                    </Text>
                  </View>
                </View>

                <Text style={styles.apptClinicSubtitle} numberOfLines={1}>
                  {nextAppt.clinicName}
                </Text>
              </View>
            </View>

            <View style={styles.apptScheduleBox}>
              <View style={styles.apptScheduleItem}>
                <Ionicons name="calendar-outline" size={14} color="#ffffff" />
                <Text style={styles.apptScheduleText}>
                  {nextAppt.date
                    ? new Date(nextAppt.date).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })
                    : 'Schedule pending'}
                </Text>
              </View>
              <View style={styles.apptScheduleItem}>
                <Ionicons name="time-outline" size={14} color="#ffffff" />
                <Text style={styles.apptScheduleText}>
                  {nextAppt.batchTime || nextAppt.time || 'Time pending'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#ffffff" />
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.emptyApptCard}
            activeOpacity={0.85}
            onPress={() => router.push('/(app)/clinics')}
          >
            <View style={styles.emptyApptIconWrap}>
              <Ionicons name="calendar-outline" size={22} color={WEB_MAGENTA} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.emptyApptTitle}>No Upcoming Consultations</Text>
              <Text style={styles.emptyApptSub}>Find a clinic and book your dermatologist visit</Text>
            </View>
            <View style={styles.bookConsultBtn}>
              <Text style={styles.bookConsultBtnText}>Book</Text>
              <Ionicons name="arrow-forward" size={12} color="#fff" />
            </View>
          </TouchableOpacity>
        )}

        {/* ── Skin Tips ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Skin Care Tips</Text>
        </View>
        <View style={styles.listContainer}>
          {[
            { icon: 'shield-checkmark-outline' as const, color: WEB_MAGENTA, title: 'Daily Sunscreen', text: 'Apply SPF 30+ daily, even on cloudy days in Cebu. Reapply every 2 hours when outdoors.' },
            { icon: 'water-outline' as const, color: WEB_MAGENTA, title: 'Stay Hydrated', text: 'Drink 8+ glasses of water daily for healthy skin elasticity and barrier repair.' },
            { icon: 'moon-outline' as const, color: WEB_MAGENTA, title: 'Night Routine', text: 'Cleanse gently and moisturize before bed. Let your skin repair itself overnight.' },
          ].map((tip) => (
            <View key={tip.title} style={styles.listCard}>
              <View style={[styles.listIconWrap, { backgroundColor: '#fdf2f7', borderWidth: 1, borderColor: '#fce7f0' }]}>
                <Ionicons name={tip.icon} size={20} color={tip.color} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.listCardTitle}>{tip.title}</Text>
                <Text style={styles.listCardSub}>{tip.text}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* ── Reminder (Matches Web PatientDashboard Reminder Box) ── */}
        <View style={styles.infoCard}>
          <View style={styles.infoIconRow}>
            <View style={styles.reminderIconCircle}>
              <Ionicons name="notifications-outline" size={17} color={WEB_MAGENTA} />
            </View>
            <Text style={styles.infoTitle}>Reminder</Text>
          </View>
          <Text style={styles.infoText}>
            DERMAI provides AI-assisted analysis only. Always consult a licensed dermatologist for proper diagnosis and treatment.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, backgroundColor: '#fff' },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f3e8ee',
    zIndex: 10,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fce7f0',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  avatarImg: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  headerWelcome: { fontSize: 11, color: COLORS.textSecondary, letterSpacing: 0.2 },
  headerName: { fontSize: 18, fontWeight: '800', color: '#111827' },
  iconBtn: {
    width: 40,
    height: 40,
    backgroundColor: '#f8f5f6',
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    borderWidth: 1,
    borderColor: '#f3e8ee',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: COLORS.danger,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },

  // ── Hero Banner ──
  heroBanner: {
    flexDirection: 'row',
    backgroundColor: WEB_MAGENTA,
    ...(Platform.OS === 'web'
      ? ({
          backgroundImage: 'linear-gradient(135deg, #6b0f3c 0%, #85134a 50%, #A0195A 100%)',
        } as any)
      : {}),
    marginHorizontal: 20,
    marginTop: 14,
    marginBottom: 20,
    borderRadius: 24,
    minHeight: 150,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#520b2e',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  heroDecorCircle: {
    position: 'absolute',
    top: -36,
    right: -28,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  heroLeft: {
    flex: 1,
    paddingHorizontal: 18,
    paddingVertical: 18,
    justifyContent: 'center',
  },
  heroTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 28,
    marginBottom: 16,
  },
  heroBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignSelf: 'flex-start',
    flexShrink: 0,
  },
  heroBtnText: {
    color: WEB_MAGENTA,
    fontWeight: '700',
    fontSize: 12,
    flexShrink: 0,
  },
  heroRight: {
    width: 130,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  heroDoctorImage: {
    width: 130,
    height: 150,
    borderBottomRightRadius: 24,
  },

  // ── Section header ──
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  seeAll: { fontSize: 12.5, color: WEB_MAGENTA, fontWeight: '700' },

  // ── 1. Your Overview (Web Bento Grid Style: 1 Featured Magenta + 3 Clean White Cards) ──
  overviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    justifyContent: 'space-between',
    rowGap: 10,
    marginBottom: 20,
  },
  overviewCard: {
    width: '48.5%',
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 14,
    overflow: 'hidden',
    position: 'relative',
    minHeight: 92,
    justifyContent: 'space-between',
  },
  overviewCardFeatured: {
    backgroundColor: WEB_MAGENTA,
    ...(Platform.OS === 'web'
      ? ({
          backgroundImage: 'linear-gradient(135deg, #6b0f3c 0%, #85134a 50%, #A0195A 100%)',
        } as any)
      : {}),
    shadowColor: '#520b2e',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 3,
  },
  overviewCardLight: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#f1f5f9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  overviewDecorCircle: {
    position: 'absolute',
    right: -24,
    bottom: -32,
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  overviewTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  overviewArrowBtnFeatured: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overviewArrowBtnLight: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overviewLabelFeatured: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
    marginRight: 6,
  },
  overviewLabelLight: {
    color: '#4b5563',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
    marginRight: 6,
  },
  overviewValueFeatured: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 30,
  },
  overviewValueLight: {
    color: '#111827',
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 30,
  },
  statSkelFeatured: {
    width: 42,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  statSkelLight: {
    width: 42,
    height: 26,
    borderRadius: 8,
    backgroundColor: '#e5e7eb',
  },

  // ── Skeleton Card (Matches Uploaded Screenshot Design) ──
  skeletonCard: {
    backgroundColor: '#ffffff',
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#f3f4f6',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  skelPillSm: {
    height: 11,
    width: 68,
    backgroundColor: '#f1f5f9',
    borderRadius: 6,
    marginBottom: 8,
  },
  skelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
  },
  skelTitleBlock: {
    height: 30,
    width: 100,
    backgroundColor: '#e2e8f0',
    borderRadius: 10,
  },
  skelBadgePill: {
    height: 22,
    width: 66,
    backgroundColor: '#f1f5f9',
    borderRadius: 999,
  },
  skelTwoColRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 18,
  },
  skelMiniBox: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  skelValueBar: {
    height: 18,
    backgroundColor: '#e2e8f0',
    borderRadius: 6,
  },
  skelDashedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#e2e8f0',
  },
  skelAvatarBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
  },
  skelLineBar: {
    height: 12,
    backgroundColor: '#f1f5f9',
    borderRadius: 6,
  },

  // ── 2. Recent Analysis (Radial Progress & Clean Metadata) ──
  recentAnalysisCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 18,
    paddingVertical: 13,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  analysisBody: {
    flex: 1,
    marginLeft: 12,
  },
  analysisTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  analysisMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  metaBadgeText: {
    fontSize: 10.5,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  emptyAnalysisCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 20,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderStyle: 'dashed',
    marginBottom: 20,
  },
  emptyAnalysisTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
  },
  emptyAnalysisSub: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  startScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: WEB_MAGENTA,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  startScanBtnText: {
    color: '#fff',
    fontSize: 11.5,
    fontWeight: '700',
  },

  // ── 3. Upcoming Appointment ──
  redesignedApptCard: {
    backgroundColor: WEB_MAGENTA,
    marginHorizontal: 20,
    borderRadius: 20,
    padding: 16,
    shadowColor: '#520b2e',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    marginBottom: 20,
  },
  apptDoctorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.18)',
    marginBottom: 10,
  },
  apptDoctorAvatarWrap: {
    position: 'relative',
    marginRight: 12,
  },
  apptDoctorAvatar: {
    width: 48,
    height: 48,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#ffffff',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  apptDoctorAvatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  apptDoctorOnlineDot: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    backgroundColor: '#10b981',
    borderWidth: 2,
    borderColor: WEB_MAGENTA,
  },
  apptDoctorInfo: {
    flex: 1,
  },
  apptDoctorHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  apptDoctorName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
    flex: 1,
  },
  apptClinicSubtitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.88)',
    fontWeight: '500',
    marginTop: 2,
  },
  apptStatusBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  apptStatusText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  apptScheduleBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  apptScheduleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  apptScheduleText: {
    fontSize: 12,
    color: '#ffffff',
    fontWeight: '600',
  },
  emptyApptCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 20,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderStyle: 'dashed',
    marginBottom: 20,
  },
  emptyApptIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#fdf2f7',
    borderWidth: 1,
    borderColor: '#fce7f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyApptTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
  },
  emptyApptSub: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  bookConsultBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: WEB_MAGENTA,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  bookConsultBtnText: {
    color: '#fff',
    fontSize: 11.5,
    fontWeight: '700',
  },

  // ── List cards / Skin Tips ──
  listContainer: {
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 20,
  },
  listCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  listIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listCardTitle: { fontSize: 13.5, fontWeight: '700', color: '#111827', marginBottom: 3 },
  listCardSub: { fontSize: 11.5, color: '#6b7280', lineHeight: 16 },

  // ── Reminder card (Matches Web PatientDashboard Reminder) ──
  infoCard: {
    backgroundColor: '#fdf2f7',
    marginHorizontal: 20,
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: '#fbcfe1',
    marginBottom: 14,
  },
  infoIconRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  reminderIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fce7f0',
    borderWidth: 1,
    borderColor: '#fbcfe1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
  infoText: { fontSize: 12, color: '#4b5563', lineHeight: 18 },
});
