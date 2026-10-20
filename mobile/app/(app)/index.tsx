import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Image,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';
import Svg, { Circle, Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { COLORS, FONTS } from '@/lib/constants';
import {
  getCurrentUser,
  getSkinHistory,
  getAppointments,
  saveAppointment,
  getAppNotifications,
  getSavedClinics,
  syncAppointmentNotifications,
  addAppNotification,
} from '@/lib/store';
import type { PatientAccount, Appointment, ScanResult } from '@/lib/store';

function RadialProgressBar({
  progress,
  size = 56,
  strokeWidth = 5,
  color = COLORS.primary,
  bgColor = COLORS.primaryLight,
}: {
  progress: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  bgColor?: string;
}) {
  const safeProgress = Math.min(Math.max(isNaN(progress) ? 0 : progress, 0), 100);
  const strokeColor = color || COLORS.primary;
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
            fontSize: size * 0.24,
            fontWeight: '800',
            color: COLORS.primary,
            fontFamily: FONTS.bold,
          }}
        >
          {Math.round(safeProgress)}%
        </Text>
      </View>
    </View>
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
  const [refreshing, setRefreshing] = useState(false);

  async function loadData() {
    const u = await getCurrentUser();
    setUser(u);
    if (!u) return;

    const history = await getSkinHistory(u.id);
    setScanCount(history.length);
    setRecentScans(history.slice(0, 3));

    const uniqueConditions = new Set(history.map((h) => h.condition));
    setConditionsFound(uniqueConditions.size);

    if (history.length > 0) {
      const diff = Date.now() - new Date(history[0].date).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 60) setLastScanLabel(`${mins}m ago`);
      else if (mins < 1440) setLastScanLabel(`${Math.floor(mins / 60)}h ago`);
      else setLastScanLabel(`${Math.floor(mins / 1440)}d ago`);
    } else {
      setLastScanLabel('Never');
    }

    const appts = await getAppointments(u.id);
    await syncAppointmentNotifications(u.id, appts);

    const activeAppts = appts.filter(
      (a) => a.status === 'pending' || a.status === 'scheduled' || a.status === 'confirmed'
    );
    activeAppts.sort((a, b) => {
      const aTime = a.date ? new Date(a.date).getTime() : Infinity;
      const bTime = b.date ? new Date(b.date).getTime() : Infinity;
      return aTime - bTime;
    });
    setNextAppt(activeAppts[0] ?? null);

    const notifs = await getAppNotifications(u.id);
    setUnreadCount(notifs.filter((n) => !n.read).length);

    const saved = await getSavedClinics(u.id);
    setClinicsSavedCount(saved.length);
  }

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  async function onRefresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  const firstName = user?.fullName?.split(' ')[0] ?? 'there';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >

        {/* ── Header ── */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.avatarCircle}
            activeOpacity={0.8}
            onPress={() => router.push('/(app)/profile')}
          >
            {user?.profileImage ? (
              <Image source={{ uri: user.profileImage }} style={styles.avatarImg} />
            ) : (
              <Ionicons name="person" size={20} color={COLORS.primary} />
            )}
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.headerWelcome}>Welcome Back</Text>
            <Text style={styles.headerName}>{firstName}</Text>
          </View>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => router.push('/(app)/notifications')}
          >
            <Ionicons name="notifications-outline" size={20} color={COLORS.text} />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : String(unreadCount)}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, { marginLeft: 8 }]}
            onPress={() => router.push('/(app)/settings')}
          >
            <Ionicons name="settings-outline" size={20} color={COLORS.text} />
          </TouchableOpacity>
        </View>

        {/* ── Hero Banner (text left, doctor icon right) ── */}
        <TouchableOpacity style={styles.heroBanner} activeOpacity={0.92} onPress={() => router.push('/(app)/clinics')}>
          {/* Left: text + CTA */}
          <View style={styles.heroLeft}>
            <Text style={styles.heroTitle}>Looking for a{'\n'}Derma Clinic?</Text>
            <View style={styles.heroBtn}>
              <Ionicons name="search-outline" size={13} color={COLORS.primary} style={{ marginRight: 5 }} />
              <Text style={styles.heroBtnText} numberOfLines={1}>Search for Clinic</Text>
            </View>
          </View>

          {/* Right: doctor photo */}
          <View style={styles.heroRight}>
            <Image
              source={require('../../assets/images/heroDoctor.png')}
              style={styles.heroDoctorImage}
              resizeMode="cover"
            />
          </View>
        </TouchableOpacity>

        {/* ── 1. Your Overview (Smaller Compact 2×2 Colorful Cards) ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Your Overview</Text>
        </View>

        <View style={styles.overviewGrid}>
          {/* Card 1 — Total Scans */}
          <View style={styles.overviewCard}>
            <View pointerEvents="none" style={styles.overviewDecorCircle} />
            <View style={styles.overviewTopRow}>
              <Text style={styles.overviewLabel} numberOfLines={1}>
                Total Scans
              </Text>
              <View style={styles.overviewArrowBtn}>
                <Feather name="arrow-up-right" size={13} color="#fff" />
              </View>
            </View>
            <Text style={styles.overviewValue}>{scanCount}</Text>
          </View>

          {/* Card 2 — Conditions Found */}
          <View style={styles.overviewCard}>
            <View pointerEvents="none" style={styles.overviewDecorCircle} />
            <View style={styles.overviewTopRow}>
              <Text style={styles.overviewLabel} numberOfLines={1}>
                Conditions Found
              </Text>
              <View style={styles.overviewArrowBtn}>
                <Feather name="arrow-up-right" size={13} color="#fff" />
              </View>
            </View>
            <Text style={styles.overviewValue}>{conditionsFound}</Text>
          </View>

          {/* Card 3 — Clinics Saved */}
          <View style={styles.overviewCard}>
            <View pointerEvents="none" style={styles.overviewDecorCircle} />
            <View style={styles.overviewTopRow}>
              <Text style={styles.overviewLabel} numberOfLines={1}>
                Clinics Saved
              </Text>
              <View style={styles.overviewArrowBtn}>
                <Feather name="arrow-up-right" size={13} color="#fff" />
              </View>
            </View>
            <Text style={styles.overviewValue}>{clinicsSavedCount}</Text>
          </View>

          {/* Card 4 — Last Scan */}
          <View style={styles.overviewCard}>
            <View pointerEvents="none" style={styles.overviewDecorCircle} />
            <View style={styles.overviewTopRow}>
              <Text style={styles.overviewLabel} numberOfLines={1}>
                Last Scan
              </Text>
              <View style={styles.overviewArrowBtn}>
                <Feather name="arrow-up-right" size={13} color="#fff" />
              </View>
            </View>
            <Text
              style={[
                styles.overviewValue,
                { fontSize: lastScanLabel.length > 5 ? 16 : 22 },
              ]}
            >
              {lastScanLabel}
            </Text>
          </View>
        </View>

        {/* ── 2. Recent Analyses (Placed directly after Overview with Radial Progress Bar, NO moderate/severe) ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Analyses</Text>
          <TouchableOpacity onPress={() => router.push('/(app)/history')}>
            <Text style={styles.seeAll}>View All &rsaquo;</Text>
          </TouchableOpacity>
        </View>

        {recentScans.length > 0 ? (
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
                  color={COLORS.primary}
                  bgColor={COLORS.primaryLight}
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
                    <View style={styles.metaBadge}>
                      <Ionicons name="sparkles" size={11} color={COLORS.primary} />
                      <Text style={[styles.metaBadgeText, { color: COLORS.primary, fontWeight: '600' }]}>
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
              color={COLORS.primary}
              bgColor={COLORS.primaryLight}
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


        {/* ── 3. Upcoming Appointment (Redesigned) ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Upcoming Appointment</Text>
          {nextAppt && (
            <TouchableOpacity onPress={() => router.push('/(app)/appointments')}>
              <Text style={styles.seeAll}>Manage &rsaquo;</Text>
            </TouchableOpacity>
          )}
        </View>

        {nextAppt ? (
          <TouchableOpacity
            style={styles.redesignedApptCard}
            activeOpacity={0.88}
            onPress={() => router.push('/(app)/appointments')}
          >
            {/* Top Doctor Profile Row */}
            <View style={styles.apptDoctorRow}>
              {/* Doctor Avatar with synced Supabase photo */}
              <View style={styles.apptDoctorAvatarWrap}>
                {nextAppt.doctorPhotoUrl ? (
                  <Image
                    source={{ uri: nextAppt.doctorPhotoUrl }}
                    style={styles.apptDoctorAvatar}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.apptDoctorAvatarFallback}>
                    <Ionicons name="medical" size={22} color={COLORS.primary} />
                  </View>
                )}
                {/* Active indicator dot */}
                <View style={styles.apptDoctorOnlineDot} />
              </View>

              {/* Doctor Info & Status */}
              <View style={styles.apptDoctorInfo}>
                <View style={styles.apptDoctorHeaderRow}>
                  <Text style={styles.apptDoctorName} numberOfLines={1}>
                    {nextAppt.doctorName
                      ? (nextAppt.doctorName.toLowerCase().startsWith('dr')
                          ? nextAppt.doctorName
                          : `Dr. ${nextAppt.doctorName}`)
                      : 'Assigned Specialist'}
                  </Text>
                  <View
                    style={[
                      styles.apptStatusBadge,
                      {
                        backgroundColor:
                          nextAppt.status === 'confirmed' || nextAppt.status === 'scheduled'
                            ? '#dcfce7'
                            : nextAppt.status === 'completed'
                            ? '#dbeafe'
                            : '#fef3c7',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.apptStatusText,
                        {
                          color:
                            nextAppt.status === 'confirmed' || nextAppt.status === 'scheduled'
                              ? '#15803d'
                              : nextAppt.status === 'completed'
                              ? '#1d4ed8'
                              : '#b45309',
                        },
                      ]}
                    >
                      {nextAppt.status === 'confirmed' || nextAppt.status === 'scheduled'
                        ? 'Confirmed'
                        : nextAppt.status === 'completed'
                        ? 'Completed'
                        : 'Pending'}
                    </Text>
                  </View>
                </View>

                {/* Clinic Name */}
                <Text style={styles.apptClinicSubtitle} numberOfLines={1}>
                  {nextAppt.clinicName}
                </Text>
              </View>
            </View>

            {/* Clean Schedule Row */}
            <View style={styles.apptScheduleBox}>
              <View style={styles.apptScheduleItem}>
                <Ionicons name="calendar-outline" size={13} color={COLORS.primary} />
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
                <Ionicons name="time-outline" size={13} color={COLORS.primary} />
                <Text style={styles.apptScheduleText}>
                  {nextAppt.batchTime || nextAppt.time || 'Time pending'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#cbd5e1" />
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.emptyApptCard}
            activeOpacity={0.85}
            onPress={() => router.push('/(app)/clinics')}
          >
            <View style={styles.emptyApptIconWrap}>
              <Ionicons name="calendar-outline" size={22} color="#2563eb" />
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
          <Text style={styles.sectionTitle}>Skin Tips</Text>
        </View>
        <View style={styles.listContainer}>
          {[
            { icon: 'sunny-outline' as const, color: '#f59e0b', title: 'Daily Sunscreen', text: 'Apply SPF 30+ daily, even on cloudy days. Reapply every 2 hours when outdoors.' },
            { icon: 'water-outline' as const, color: '#0ea5e9', title: 'Stay Hydrated', text: 'Drink 8+ glasses of water daily. Hydration helps maintain skin elasticity and health.' },
            { icon: 'moon-outline' as const, color: '#7c3aed', title: 'Night Routine', text: 'Cleanse and moisturize before bed. Let your skin repair itself overnight.' },
          ].map((tip) => (
            <View key={tip.title} style={styles.listCard}>
              <View style={[styles.listIconWrap, { backgroundColor: tip.color + '18' }]}>
                <Ionicons name={tip.icon} size={20} color={tip.color} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.listCardTitle}>{tip.title}</Text>
                <Text style={styles.listCardSub}>{tip.text}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* ── About DermAI ── */}
        <View style={styles.infoCard}>
          <View style={styles.infoIconRow}>
            <Ionicons name="information-circle" size={18} color={COLORS.primary} />
            <Text style={styles.infoTitle}>About DermAI</Text>
          </View>
          <Text style={styles.infoText}>
            DermAI uses artificial intelligence to analyze skin conditions, provide preliminary
            assessments, and help you connect with licensed dermatologists near you.
            Always consult a medical professional for diagnosis and treatment.
          </Text>
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, backgroundColor: '#F7F8FA' },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: '#fff',
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fce7f3',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  headerWelcome: { fontSize: 11, color: COLORS.textSecondary, letterSpacing: 0.2 },
  headerName: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  iconBtn: {
    width: 40,
    height: 40,
    backgroundColor: '#F5F6FA',
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
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
    backgroundColor: COLORS.primary,
    marginHorizontal: 20,
    marginTop: 6,
    marginBottom: 20,
    borderRadius: 22,
    minHeight: 150,
    overflow: 'hidden',
  },
  heroLeft: {
    flex: 1,
    paddingHorizontal: 16,
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
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
    flexShrink: 0,
  },
  heroBtnText: {
    color: COLORS.primary,
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
    borderBottomRightRadius: 22,
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
    fontWeight: '700',
    color: COLORS.text,
  },
  seeAll: { fontSize: 13, color: COLORS.primary, fontWeight: '600' },

  // ── 1. Your Overview (Berry Cards) ──
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
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 13,
    overflow: 'hidden',
    position: 'relative',
    minHeight: 82,
    justifyContent: 'space-between',
    backgroundColor: '#be185d',
    ...(Platform.OS === 'web'
      ? ({
          backgroundImage: 'linear-gradient(135deg, #c21a62 0%, #be185d 40%, #9d174d 100%)',
          cursor: 'default', userSelect: 'none',
        } as any)
      : {}),
    shadowColor: '#be185d',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 3,
  },
  overviewDecorCircle: {
    position: 'absolute',
    right: -24,
    bottom: -32,
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    pointerEvents: 'none',
  },
  overviewTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    pointerEvents: 'none',
  },
  overviewArrowBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overviewLabel: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 11.5,
    fontWeight: '600',
    flex: 1,
    marginRight: 6,
  },
  overviewValue: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 26,
    pointerEvents: 'none',
  },
  // ── 2. Recent Analysis (Radial Progress & Clean Metadata) ──
  recentAnalysisCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  analysisBody: {
    flex: 1,
    marginLeft: 12,
  },
  analysisTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
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
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderStyle: 'dashed',
    marginBottom: 20,
  },
  emptyAnalysisTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
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
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  startScanBtnText: {
    color: '#fff',
    fontSize: 11.5,
    fontWeight: '700',
  },


  // ── 3. Upcoming Appointment (Redesigned with Synced Doctor Profile) ──
  redesignedApptCard: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    borderRadius: 18,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    marginBottom: 20,
  },
  apptDoctorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  apptDoctorAvatarWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    position: 'relative',
    marginRight: 12,
  },
  apptDoctorAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#f1f5f9',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
  },
  apptDoctorAvatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fce7f3',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#fbcfe8',
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
    borderColor: '#fff',
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
    fontSize: 14.5,
    fontWeight: '700',
    color: COLORS.text,
    flex: 1,
  },
  apptClinicSubtitle: {
    fontSize: 11.5,
    color: COLORS.textSecondary,
    fontWeight: '500',
    marginTop: 2,
  },
  apptStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  apptStatusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  apptScheduleBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#edf2f7',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  apptScheduleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  apptScheduleText: {
    fontSize: 12,
    color: COLORS.text,
    fontWeight: '600',
  },
  emptyApptCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 20,
    borderRadius: 16,
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
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyApptTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
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
    backgroundColor: '#2563eb',
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
    borderRadius: 16,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  listIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listCardTitle: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginBottom: 3 },
  listCardSub: { fontSize: 11, color: COLORS.textSecondary, lineHeight: 16 },

  // ── Info card ──
  infoCard: {
    backgroundColor: COLORS.primaryLight ?? '#e6f4ea',
    marginHorizontal: 20,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.primary + '25',
  },
  infoIconRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  infoTitle: { fontSize: 14, fontWeight: '700', color: COLORS.primary },
  infoText: { fontSize: 12, color: COLORS.text, lineHeight: 19 },
});