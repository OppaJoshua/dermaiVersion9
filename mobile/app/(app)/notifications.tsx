import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import {
  getCurrentUser,
  getAppNotifications,
  markAppNotificationRead,
  markAllAppNotificationsRead,
  subscribeToAppNotifications,
  resolveAvatarUrl,
} from '@/lib/store';
import type { AppNotification } from '@/lib/store';

type FilterTab = 'all' | 'appointment' | 'broadcast' | 'scan' | 'ticket';

interface BadgeConfig {
  color: string;
  badgeLabel: string;
}

function getNotifBadgeConfig(notif: AppNotification): BadgeConfig {
  // 1. Payment confirmation
  if (
    notif.subtype === 'payment_confirmed' ||
    notif.subtype === 'payment-confirmed' ||
    notif.type === 'payment-confirmed' ||
    notif.type === 'appointment-payment-confirmed'
  ) {
    return { color: '#16a34a', badgeLabel: 'PAID' };
  }

  // 2. Appointment subtypes
  if (notif.subtype === 'appointment-scheduled' || notif.type === 'appointment-accepted' || notif.subtype === 'confirmed') {
    return { color: '#16a34a', badgeLabel: 'CONFIRMED' };
  }
  if (notif.subtype === 'appointment-rejected' || notif.type === 'appointment-rejected') {
    return { color: COLORS.danger, badgeLabel: 'DECLINED' };
  }
  if (notif.subtype === 'appointment-cancelled' || notif.type === 'appointment-cancelled') {
    return { color: COLORS.danger, badgeLabel: 'CANCELLED' };
  }
  if (
    notif.type === 'appointment-no-show' ||
    notif.type === 'appointment-missed' ||
    notif.subtype === 'no-show' ||
    notif.subtype === 'appointment-no-show'
  ) {
    return { color: '#ea580c', badgeLabel: 'NO-SHOW' };
  }
  if (notif.subtype === 'appointment-completed' || notif.type === 'appointment-completed') {
    return { color: '#2563eb', badgeLabel: 'COMPLETED' };
  }

  // 3. Broadcasts & Maintenance
  if (notif.subtype === 'maintenance_alert' || notif.type === 'maintenance_alert') {
    return { color: '#ea580c', badgeLabel: 'MAINTENANCE' };
  }
  if (notif.category === 'broadcast' || notif.type === 'broadcast') {
    return { color: '#d97706', badgeLabel: 'ANNOUNCEMENT' };
  }

  // 4. Scans
  if (notif.category === 'scan' || notif.type === 'scan' || notif.type === 'scan_result') {
    return { color: COLORS.primary, badgeLabel: 'AI SCAN' };
  }

  // 5. Support Tickets
  if (notif.category === 'ticket' || notif.type === 'ticket' || notif.type?.includes('ticket')) {
    return { color: '#8b5cf6', badgeLabel: 'SUPPORT' };
  }

  // 6. Appointments general
  if (notif.category === 'appointment' || notif.type === 'appointment') {
    return { color: '#2563eb', badgeLabel: 'APPOINTMENT' };
  }

  return { color: COLORS.textSecondary, badgeLabel: 'UPDATE' };
}

function resolveNotificationAvatarUrl(notif: AppNotification): string | null {
  const rawUrl =
    notif.senderAvatar ||
    notif.metadata?.clinic_logo ||
    notif.metadata?.avatar_url ||
    notif.metadata?.logo_url ||
    notif.metadata?.profile_image ||
    notif.metadata?.sender_avatar ||
    null;

  if (!rawUrl || typeof rawUrl !== 'string') return null;
  return resolveAvatarUrl(rawUrl) || rawUrl || null;
}

function isScanNotification(notif: AppNotification, badgeLabel?: string): boolean {
  return (
    notif.type === 'scan' ||
    notif.type === 'scan_result' ||
    notif.type === 'scan-completed' ||
    notif.category === 'scan' ||
    (notif.category as string) === 'AI SCAN' ||
    notif.metadata?.category === 'skin_scan' ||
    badgeLabel === 'AI SCAN'
  );
}

function getSenderInitials(notif: AppNotification): string {
  const rawName = (
    notif.senderName ||
    notif.metadata?.clinic_name ||
    notif.metadata?.sender_name ||
    'Clinic'
  ).trim();

  if (!rawName || rawName === 'Clinic Update') return 'C';

  const words = rawName.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'C';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export default function NotificationsScreen() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [failedAvatarIds, setFailedAvatarIds] = useState<Record<string, boolean>>({});

  const loadNotifications = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const user = await getCurrentUser();
      if (!user) return;
      setUserId(user.id);
      const notifs = await getAppNotifications(user.id);
      // Suppress legacy subscription notifications
      const cleaned = (notifs || []).filter(
        (n) =>
          n.category !== 'subscription' &&
          (n.category as string) !== 'PLAN' &&
          n.type !== 'subscription' &&
          n.subtype !== 'subscription_upgraded' &&
          !n.subtype?.includes('subscription') &&
          !/pro subscription|subscription|plan activated|welcome to dermai pro/i.test(n.title || '')
      );
      setNotifications(cleaned);
    } catch (err) {
      console.warn('[Notifications] Error loading notifications:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadNotifications();
    }, [loadNotifications])
  );

  // Real-time listener for Supabase changes
  useEffect(() => {
    if (!userId) return;
    const unsubscribe = subscribeToAppNotifications(userId, () => {
      loadNotifications(true);
    });
    return () => unsubscribe();
  }, [userId, loadNotifications]);

  async function onRefresh() {
    setRefreshing(true);
    await loadNotifications(true);
    setRefreshing(false);
  }

  async function handleMarkRead(notif: AppNotification) {
    if (!userId || notif.read) return;
    setNotifications((prev) =>
      prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n))
    );
    await markAppNotificationRead(userId, notif.id);
  }

  async function handleCardPress(notif: AppNotification) {
    if (userId && !notif.read) {
      await handleMarkRead(notif);
    }

    if (notif.category === 'appointment' || notif.type?.includes('appointment')) {
      router.push('/(app)/appointments');
    } else if (notif.category === 'scan' || notif.type === 'scan' || notif.type === 'scan_result') {
      router.push('/(app)/history');
    } else if (notif.category === 'ticket' || notif.type === 'ticket' || notif.type?.includes('ticket')) {
      router.push('/(app)/settings');
    } else if (notif.category === 'broadcast' || notif.type === 'broadcast') {
      Alert.alert(notif.title, notif.message, [{ text: 'OK' }]);
    }
  }

  async function handleMarkAllRead() {
    if (!userId) return;
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await markAllAppNotificationsRead(userId, unreadIds);
  }

  const isSubscriptionNotification = (n: AppNotification) =>
    n.category === 'subscription' ||
    (n.category as string) === 'PLAN' ||
    n.type === 'subscription' ||
    n.type === 'subscription_expired' ||
    n.subtype === 'subscription_upgraded' ||
    Boolean(n.subtype?.includes('subscription')) ||
    /pro subscription|subscription|plan activated|welcome to dermai pro/i.test(n.title || '');

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read && !isSubscriptionNotification(n)).length,
    [notifications]
  );

  const allValidCount = useMemo(
    () => notifications.filter((n) => !isSubscriptionNotification(n)).length,
    [notifications]
  );

  const filteredNotifications = useMemo(() => {
    const baseList = notifications.filter((n) => !isSubscriptionNotification(n));
    if (activeTab === 'all') return baseList;
    if (activeTab === 'appointment') {
      return baseList.filter(
        (n) => n.category === 'appointment' || n.type?.includes('appointment')
      );
    }
    if (activeTab === 'broadcast') {
      return baseList.filter(
        (n) =>
          n.category === 'broadcast' ||
          n.type === 'broadcast' ||
          n.type === 'maintenance_alert' ||
          n.subtype === 'admin_announcement' ||
          n.subtype === 'maintenance_alert' ||
          n.metadata?.subtype === 'admin_announcement' ||
          n.metadata?.subtype === 'maintenance_alert'
      );
    }
    if (activeTab === 'scan') {
      return baseList.filter(
        (n) =>
          n.category === 'scan' ||
          n.type === 'scan' ||
          n.type === 'scan_result' ||
          n.type === 'scan-completed' ||
          n.metadata?.category === 'skin_scan'
      );
    }
    if (activeTab === 'ticket') {
      return baseList.filter(
        (n) =>
          n.category === 'ticket' ||
          n.type === 'support' ||
          n.type === 'support_ticket' ||
          n.type?.includes('ticket') ||
          n.type?.includes('support') ||
          n.metadata?.category === 'support' ||
          n.metadata?.category === 'ticket'
      );
    }
    return baseList;
  }, [notifications, activeTab]);

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Top Header ── */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          activeOpacity={0.7}
          onPress={() => (router.canGoBack() ? router.back() : router.push('/(app)'))}
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.avatarCircle}>
          <Ionicons name="notifications" size={20} color={COLORS.primary} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerName}>Notifications</Text>
            {unreadCount > 0}
          </View>
          <Text style={styles.headerWelcome}>
            {unreadCount > 0 ? `${unreadCount} unread update${unreadCount > 1 ? 's' : ''}` : 'All caught up with DERMAI'}
          </Text>
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity style={styles.markBtn} activeOpacity={0.7} onPress={handleMarkAllRead}>
            <Ionicons name="checkmark-done" size={14} color={COLORS.primary} style={{ marginRight: 4 }} />
            <Text style={styles.markBtnText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Filter Tabs ── */}
      <View style={styles.tabContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabScroll}>
          <TouchableOpacity
            style={[styles.tabChip, activeTab === 'all' && styles.tabChipActive]}
            onPress={() => setActiveTab('all')}
          >
            <Text style={[styles.tabChipText, activeTab === 'all' && styles.tabChipTextActive]}>
              All ({allValidCount})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabChip, activeTab === 'appointment' && styles.tabChipActive]}
            onPress={() => setActiveTab('appointment')}
          >
            <Text style={[styles.tabChipText, activeTab === 'appointment' && styles.tabChipTextActive]}>
              Appointments
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabChip, activeTab === 'broadcast' && styles.tabChipActive]}
            onPress={() => setActiveTab('broadcast')}
          >
            <Text style={[styles.tabChipText, activeTab === 'broadcast' && styles.tabChipTextActive]}>
              Announcements
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabChip, activeTab === 'scan' && styles.tabChipActive]}
            onPress={() => setActiveTab('scan')}
          >
            <Text style={[styles.tabChipText, activeTab === 'scan' && styles.tabChipTextActive]}>
              Scans
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabChip, activeTab === 'ticket' && styles.tabChipActive]}
            onPress={() => setActiveTab('ticket')}
          >
            <Text style={[styles.tabChipText, activeTab === 'ticket' && styles.tabChipTextActive]}>
              Support
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* ── Content ── */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Fetching real-time notifications...</Text>
        </View>
      ) : filteredNotifications.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyScroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
          }
        >
          <View style={styles.empty}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="notifications-outline" size={36} color={COLORS.primary} />
            </View>
            <Text style={styles.emptyTitle}>No Notifications</Text>
            <Text style={styles.emptySub}>
              {activeTab === 'all'
                ? 'Appointment updates, clinical findings, and administrative broadcasts from Supabase will appear here in real-time.'
                : `No ${activeTab} updates available at this moment.`}
            </Text>
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.container}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 28 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
          }
        >
          <View style={styles.list}>
            {filteredNotifications.map((notif) => {
              const badge = getNotifBadgeConfig(notif);
              const isScan = isScanNotification(notif, badge.badgeLabel);
              const avatarUrl = isScan ? null : resolveNotificationAvatarUrl(notif);
              const showAvatarImage = Boolean(avatarUrl && !failedAvatarIds[notif.id]);
              const initials = getSenderInitials(notif);

              return (
                <TouchableOpacity
                  key={notif.id}
                  activeOpacity={0.88}
                  style={[styles.card, !notif.read && styles.cardUnread]}
                  onPress={() => handleCardPress(notif)}
                >
                  {isScan ? (
                    <View style={styles.scanAvatarBadge}>
                      <Ionicons name="sparkles-outline" size={20} color="#831843" />
                    </View>
                  ) : (
                    <View style={styles.avatarWrap}>
                      {showAvatarImage ? (
                        <Image
                          source={{ uri: avatarUrl! }}
                          style={styles.clinicAvatarImage}
                          resizeMode="cover"
                          onError={() =>
                            setFailedAvatarIds((prev) => ({
                              ...prev,
                              [notif.id]: true,
                            }))
                          }
                        />
                      ) : (
                        <View style={styles.avatarFallback}>
                          <Text style={styles.avatarFallbackText}>{initials}</Text>
                        </View>
                      )}
                    </View>
                  )}

                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <View style={styles.cardHeaderRow}>
                      <View style={[styles.categoryBadge, { backgroundColor: badge.color + '18' }]}>
                        <Text style={[styles.categoryBadgeText, { color: badge.color }]}>
                          {badge.badgeLabel}
                        </Text>
                      </View>
                      {notif.senderName && (
                        <Text style={styles.senderNameText} numberOfLines={1}>
                          • {notif.senderName}
                        </Text>
                      )}
                      {!notif.read && <View style={styles.unreadDot} />}
                    </View>

                    <Text style={[styles.cardTitle, !notif.read && styles.cardTitleBold]} numberOfLines={2}>
                      {notif.title}
                    </Text>

                    <Text style={styles.cardMsg} numberOfLines={4}>
                      {notif.message}
                    </Text>

                    <View style={styles.cardFooter}>
                      <Ionicons name="time-outline" size={11} color={COLORS.textSecondary} style={{ marginRight: 4 }} />
                      <Text style={styles.cardTime}>{timeAgo(notif.timestamp)}</Text>
                      {!notif.read && (
                        <Text style={styles.tapToReadHint}>• Tap to mark read</Text>
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function timeAgo(isoString: string): string {
  if (!isoString) return 'Just now';
  const now = Date.now();
  const then = new Date(isoString).getTime();
  if (isNaN(then)) return 'Recently';
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(isoString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },
  container: { flex: 1, backgroundColor: '#ffffff' },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fdf2f7',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#fbcfe1',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerName: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  unreadCountPill: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  unreadCountPillText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  headerWelcome: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  markBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#fdf2f7',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#fbcfe1',
  },
  markBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 11 },

  // ── Filter Tabs ──
  tabContainer: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  tabScroll: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  tabChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
  },
  tabChipActive: {
    backgroundColor: COLORS.primary,
  },
  tabChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  tabChipTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },

  // ── Loading ──
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },

  // ── Empty state ──
  emptyScroll: {
    flexGrow: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    paddingTop: 80,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#fdf2f7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#fbcfe1',
  },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: COLORS.text, marginBottom: 6 },
  emptySub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },

  // ── List Cards ──
  list: { paddingHorizontal: 16, paddingTop: 14, gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardUnread: {
    borderColor: '#fbcfe1',
    backgroundColor: '#ffffff',
    shadowColor: COLORS.primary,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  scanAvatarBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FDF2F8',
    borderWidth: 1,
    borderColor: '#FCE7F3',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  avatarWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  clinicAvatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  categoryBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  categoryBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  senderNameText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginLeft: 6,
    flexShrink: 1,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
    marginLeft: 'auto',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    lineHeight: 19,
    marginBottom: 4,
  },
  cardTitleBold: {
    fontWeight: '800',
  },
  cardMsg: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 18,
    marginBottom: 6,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardTime: {
    fontSize: 11,
    color: COLORS.textLight ?? '#94a3b8',
    fontWeight: '500',
  },
  tapToReadHint: {
    fontSize: 10,
    color: COLORS.primary,
    fontWeight: '600',
    marginLeft: 6,
  },
});
