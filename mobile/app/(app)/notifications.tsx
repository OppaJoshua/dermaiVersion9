import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import {
  getCurrentUser,
  getAppNotifications,
  markAppNotificationRead,
  markAllAppNotificationsRead,
  subscribeToAppNotifications,
} from '@/lib/store';
import type { AppNotification } from '@/lib/store';

type FilterTab = 'all' | 'appointment' | 'broadcast' | 'scan' | 'ticket';

interface VisualConfig {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  badgeLabel: string;
}

function getNotifVisualConfig(notif: AppNotification): VisualConfig {
  // 1. Appointment subtypes
  if (notif.subtype === 'appointment-scheduled' || notif.type === 'appointment-accepted') {
    return { icon: 'checkmark-circle', color: '#16a34a', badgeLabel: 'CONFIRMED' };
  }
  if (notif.subtype === 'appointment-rejected' || notif.type === 'appointment-rejected') {
    return { icon: 'close-circle', color: COLORS.danger, badgeLabel: 'DECLINED' };
  }
  if (notif.subtype === 'appointment-completed' || notif.type === 'appointment-completed') {
    return { icon: 'medkit', color: '#2563eb', badgeLabel: 'COMPLETED' };
  }

  // 2. Broadcasts & Maintenance
  if (notif.subtype === 'maintenance_alert' || notif.type === 'maintenance_alert') {
    return { icon: 'construct', color: '#ea580c', badgeLabel: 'MAINTENANCE' };
  }
  if (notif.category === 'broadcast' || notif.type === 'broadcast') {
    return { icon: 'megaphone', color: '#d97706', badgeLabel: 'ANNOUNCEMENT' };
  }

  // 3. Scans
  if (notif.category === 'scan' || notif.type === 'scan') {
    return { icon: 'flask', color: COLORS.primary, badgeLabel: 'AI SCAN' };
  }

  // 4. Support Tickets
  if (notif.category === 'ticket' || notif.type === 'ticket' || notif.type?.includes('ticket')) {
    return { icon: 'chatbox-ellipses', color: '#8b5cf6', badgeLabel: 'SUPPORT' };
  }

  // 5. Subscription
  if (notif.category === 'subscription' || notif.type === 'subscription') {
    return { icon: 'star', color: '#eab308', badgeLabel: 'PLAN' };
  }

  // 6. Appointments general
  if (notif.category === 'appointment' || notif.type === 'appointment') {
    return { icon: 'calendar', color: '#2563eb', badgeLabel: 'APPOINTMENT' };
  }

  return { icon: 'notifications', color: COLORS.textSecondary, badgeLabel: 'UPDATE' };
}

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  const loadNotifications = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const user = await getCurrentUser();
      if (!user) return;
      setUserId(user.id);
      const notifs = await getAppNotifications(user.id);
      setNotifications(notifs);
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

  async function handleMarkAllRead() {
    if (!userId) return;
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await markAllAppNotificationsRead(userId, unreadIds);
  }

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  const filteredNotifications = useMemo(() => {
    if (activeTab === 'all') return notifications;
    if (activeTab === 'appointment') {
      return notifications.filter((n) => n.category === 'appointment' || n.type?.includes('appointment'));
    }
    if (activeTab === 'broadcast') {
      return notifications.filter((n) => n.category === 'broadcast' || n.type === 'broadcast' || n.type === 'maintenance_alert');
    }
    if (activeTab === 'scan') {
      return notifications.filter((n) => n.category === 'scan' || n.type === 'scan');
    }
    if (activeTab === 'ticket') {
      return notifications.filter((n) => n.category === 'ticket' || n.type?.includes('ticket'));
    }
    return notifications;
  }, [notifications, activeTab]);

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Top Header ── */}
      <View style={styles.header}>
        <View style={styles.avatarCircle}>
          <Ionicons name="notifications" size={20} color={COLORS.primary} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerName}>Notifications</Text>
            {unreadCount > 0 && (
              <View style={styles.unreadCountPill}>
                <Text style={styles.unreadCountPillText}>{unreadCount} NEW</Text>
              </View>
            )}
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
              All ({notifications.length})
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
              const visual = getNotifVisualConfig(notif);
              return (
                <TouchableOpacity
                  key={notif.id}
                  activeOpacity={0.88}
                  style={[styles.card, !notif.read && styles.cardUnread]}
                  onPress={() => handleMarkRead(notif)}
                >
                  <View style={[styles.iconWrap, { backgroundColor: visual.color + '15' }]}>
                    <Ionicons name={visual.icon} size={22} color={visual.color} />
                  </View>

                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <View style={styles.cardHeaderRow}>
                      <View style={[styles.categoryBadge, { backgroundColor: visual.color + '18' }]}>
                        <Text style={[styles.categoryBadgeText, { color: visual.color }]}>
                          {visual.badgeLabel}
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
  container: { flex: 1, backgroundColor: '#f8fafc' },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fdf2f8',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#fbcfe8',
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
    backgroundColor: '#fdf2f8',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#fbcfe8',
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
    backgroundColor: '#fdf2f8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#fbcfe8',
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
    borderColor: '#fbcfe8',
    backgroundColor: '#ffffff',
    shadowColor: COLORS.primary,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
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
