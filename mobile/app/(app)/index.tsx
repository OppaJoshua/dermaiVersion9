import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
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

interface QuickAction {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  description: string;
  route: string;
  color: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    icon: 'camera-outline',
    label: 'Start Skin Scan',
    description: 'AI-powered analysis',
    route: '/(app)/scan',
    color: COLORS.primary,
  },
  {
    icon: 'clipboard-outline',
    label: 'Scan History',
    description: 'View past results',
    route: '/(app)/history',
    color: '#7c3aed',
  },
  {
    icon: 'calendar-outline',
    label: 'Appointments',
    description: 'Book & manage',
    route: '/(app)/appointments',
    color: '#2563eb',
  },
  {
    icon: 'medkit-outline',
    label: 'Find Clinics',
    description: 'Nearby dermatologists',
    route: '/(app)/clinics',
    color: '#16a34a',
  },
  {
    icon: 'star-outline',
    label: 'Upgrade Plan',
    description: 'Unlock premium features',
    route: '/(app)/subscription',
    color: COLORS.warning,
  },
];

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

    let appts = await getAppointments(u.id);

    if (appts.length === 0) {
      const today = new Date();
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const d1 = new Date(today); d1.setDate(d1.getDate() + 5);
      const d2 = new Date(today); d2.setDate(d2.getDate() + 10);
      const d3 = new Date(today); d3.setDate(d3.getDate() - 3);
      const seeds: Appointment[] = [
        {
          id: 'appt-demo-001',
          userId: u.id,
          clinicId: 1,
          clinicName: 'Cebu Skin Institute',
          clinicAddress: 'Mango Ave, Cebu City',
          doctorName: 'Dr. Maria Santos',
          specialty: 'Fungal & Parasitic Infections',
          consultationType: 'face-to-face',
          patientName: u.fullName,
          patientEmail: u.email,
          date: fmt(d1),
          time: '10:00 AM',
          status: 'pending',
          notes: 'Skin discoloration concern.',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'appt-demo-002',
          userId: u.id,
          clinicId: 2,
          clinicName: 'SkinMD Dermatology Center',
          clinicAddress: 'AS Fortuna St, Mandaue City',
          doctorName: 'Dr. Anna Cruz',
          specialty: 'Pigmentation & Dermatitis',
          consultationType: 'face-to-face',
          patientName: u.fullName,
          patientEmail: u.email,
          date: fmt(d2),
          time: '2:00 PM',
          status: 'scheduled',
          notes: 'Follow-up for melasma treatment.',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'appt-demo-003',
          userId: u.id,
          clinicId: 3,
          clinicName: 'DermaPlus Clinic',
          clinicAddress: 'Osmeña Blvd, Cebu City',
          doctorName: 'Dr. Ramon Lopez',
          specialty: 'Bacterial & Fungal Infections',
          consultationType: 'face-to-face',
          patientName: u.fullName,
          patientEmail: u.email,
          date: fmt(d3),
          time: '9:00 AM',
          status: 'rejected',
          clinicNote: 'Slot unavailable on that date.',
          createdAt: new Date().toISOString(),
        },
      ]; 
      for (const seed of seeds) await saveAppointment(seed);
      appts = seeds;

      await addAppNotification(u.id, {
        type: 'general',
        title: 'Welcome to DermAI! 👋',
        message: 'Your account is set up. Book an appointment or start a skin scan to get started.',
        userId: u.id,
      });
    }

    await syncAppointmentNotifications(u.id, appts);

    const upcoming = appts.find(
      (a) => (a.status === 'pending' || a.status === 'scheduled' || a.status === 'confirmed')
    );
    setNextAppt(upcoming ?? null);

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
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.push('/(app)/clinics')}>
            <Ionicons name="search-outline" size={20} color={COLORS.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, { marginLeft: 8 }]}
            onPress={() => router.push('/(app)/notifications')}
          >
            <Ionicons name="notifications-outline" size={20} color={COLORS.text} />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : String(unreadCount)}</Text>
              </View>
            )}
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

        {/* ── Your Overview (2×2 grid with big stat cards) ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Your Overview</Text>
        </View>

        <View style={styles.overviewGrid}>
          {/* Card 1 — Total Scans */}
          <View style={[styles.overviewCard, { backgroundColor: COLORS.primary }]}>
            <View style={styles.overviewIconWrap}>
              <Ionicons name="scan-outline" size={20} color={COLORS.primary} />
            </View>
            <Text style={styles.overviewValue}>{scanCount}</Text>
            <Text style={styles.overviewLabel}>Total Scans</Text>
            <View style={styles.overviewDecorDot} />
          </View>

          {/* Card 2 — Conditions Found */}
          <View style={[styles.overviewCard, { backgroundColor: '#7c3aed' }]}>
            <View style={[styles.overviewIconWrap, { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
              <Ionicons name="alert-circle-outline" size={20} color="#fff" />
            </View>
            <Text style={styles.overviewValue}>{conditionsFound}</Text>
            <Text style={styles.overviewLabel}>Conditions Found</Text>
            <View style={[styles.overviewDecorDot, { backgroundColor: 'rgba(255,255,255,0.15)' }]} />
          </View>

          {/* Card 3 — Clinics Saved */}
          <View style={[styles.overviewCard, { backgroundColor: '#0ea5e9' }]}>
            <View style={[styles.overviewIconWrap, { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
              <Ionicons name="bookmark-outline" size={20} color="#fff" />
            </View>
            <Text style={styles.overviewValue}>{clinicsSavedCount}</Text>
            <Text style={styles.overviewLabel}>Clinics Saved</Text>
            <View style={[styles.overviewDecorDot, { backgroundColor: 'rgba(255,255,255,0.15)' }]} />
          </View>

          {/* Card 4 — Last Scan */}
          <View style={[styles.overviewCard, { backgroundColor: '#16a34a' }]}>
            <View style={[styles.overviewIconWrap, { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
              <Ionicons name="time-outline" size={20} color="#fff" />
            </View>
            <Text style={[styles.overviewValue, { fontSize: lastScanLabel.length > 5 ? 18 : 26 }]}>{lastScanLabel}</Text>
            <Text style={styles.overviewLabel}>Last Scan</Text>
            <View style={[styles.overviewDecorDot, { backgroundColor: 'rgba(255,255,255,0.15)' }]} />
          </View>
        </View>

        {/* ── Quick Actions ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <TouchableOpacity>
            <Text style={styles.seeAll}>See All &rsaquo;</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.actionsScroll}
        >
          {QUICK_ACTIONS.map((action) => (
            <TouchableOpacity
              key={action.label}
              style={styles.actionCard}
              onPress={() => {
                if (action.label === 'Appointments') {
                  router.push({ pathname: '/(app)/appointments', params: { openBooking: '1' } } as any);
                } else {
                  router.push(action.route as any);
                }
              }}
            >
              <View style={[styles.actionIconWrap, { backgroundColor: action.color + '18' }]}>
                <Ionicons name={action.icon} size={24} color={action.color} />
              </View>
              <Text style={styles.actionLabel}>{action.label}</Text>
              <Text style={styles.actionDesc}>{action.description}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {recentScans.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent Analyses</Text>
              <TouchableOpacity onPress={() => router.push('/(app)/history')}>
                <Text style={styles.seeAll}>See All &rsaquo;</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.listContainer}>
              {recentScans.map((scan) => (
                <TouchableOpacity
                  key={scan.id}
                  style={styles.listCard}
                  onPress={() => router.push('/(app)/history')}
                >
                  <View style={[styles.listIconWrap, { backgroundColor: COLORS.primary + '15' }]}>
                    <Ionicons name="flask-outline" size={20} color={COLORS.primary} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.listCardTitle}>{scan.condition}</Text>
                    <Text style={styles.listCardSub}>
                      {new Date(scan.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </Text>
                  </View>
                  <View style={styles.confidencePill}>
                    <Text style={styles.confidenceText}>{scan.confidence}%</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* ── Upcoming Appointment ── */}
        {nextAppt && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Upcoming Appointment</Text>
              <TouchableOpacity onPress={() => router.push('/(app)/appointments')}>
                <Text style={styles.seeAll}>See All &rsaquo;</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.apptCard}
              onPress={() => router.push('/(app)/appointments')}
            >
              <View style={[styles.listIconWrap, { backgroundColor: '#2563eb15' }]}>
                <Ionicons name="calendar" size={22} color="#2563eb" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.listCardTitle}>{nextAppt.clinicName}</Text>
                {nextAppt.doctorName && (
                  <Text style={styles.listCardSub}>{nextAppt.doctorName}</Text>
                )}
                <View style={styles.apptMeta}>
                  <View style={styles.apptMetaItem}>
                    <Ionicons name="calendar-outline" size={11} color={COLORS.textSecondary} />
                    <Text style={styles.apptMetaText}>{nextAppt.date}</Text>
                  </View>
                  <View style={styles.apptMetaItem}>
                    <Ionicons name="time-outline" size={11} color={COLORS.textSecondary} />
                    <Text style={styles.apptMetaText}>{nextAppt.time}</Text>
                  </View>
                  <View style={styles.apptMetaItem}>
                    <Ionicons name="location-outline" size={11} color={COLORS.textSecondary} />
                    <Text style={styles.apptMetaText}>In-Person</Text>
                  </View>
                </View>
              </View>
              <TouchableOpacity
                style={styles.bookBtn}
                onPress={() => router.push('/(app)/appointments')}
              >
                <Text style={styles.bookBtnText}>View</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </>
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
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  seeAll: { fontSize: 13, color: COLORS.primary, fontWeight: '600' },

  // ── Your Overview (2×2 colourful grid) ──
  overviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 20,
  },
  overviewCard: {
    width: '47%',
    borderRadius: 20,
    padding: 12,
    overflow: 'hidden',
    position: 'relative',
    minHeight: 110,
    justifyContent: 'flex-end',
  },
  overviewIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  overviewValue: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 30,
  },
  overviewLabel: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  overviewDecorDot: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.1)',
    top: -20,
    right: -20,
  },

  // ── Quick Actions ──
  actionsScroll: {
    paddingHorizontal: 20,
    gap: 12,
    paddingBottom: 4,
    marginBottom: 20,
  },
  actionCard: {
    width: 100,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  actionIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  actionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 2,
  },
  actionDesc: { fontSize: 9, color: COLORS.textSecondary, textAlign: 'center' },

  // ── List cards ──
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
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  listIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listCardTitle: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginBottom: 3 },
  listCardSub: { fontSize: 11, color: COLORS.textSecondary, lineHeight: 16 },

  // ── Confidence pill ──
  confidencePill: {
    backgroundColor: COLORS.primary + '15',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  confidenceText: { fontSize: 13, fontWeight: '800', color: COLORS.primary },

  // ── Appointment ──
  apptCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 20,
    borderRadius: 18,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
    marginBottom: 20,
  },
  apptMeta: { flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  apptMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  apptMetaText: { fontSize: 10, color: COLORS.textSecondary },
  bookBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginLeft: 8,
  },
  bookBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // ── Info card ──
  infoCard: {
    backgroundColor: COLORS.primaryLight ?? '#e6f4ea',
    marginHorizontal: 20,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.primary + '25',
  },
  infoIconRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  infoTitle: { fontSize: 14, fontWeight: '700', color: COLORS.primary },
  infoText: { fontSize: 12, color: COLORS.text, lineHeight: 19 },
});