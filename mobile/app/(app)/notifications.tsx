import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import {
  getCurrentUser,
  getAppNotifications,
  markAppNotificationRead,
} from '@/lib/store';
import type { AppNotification } from '@/lib/store';

const TYPE_CONFIG: Record<
  AppNotification['type'],
  { icon: React.ComponentProps<typeof Ionicons>['name']; color: string }
> = {
  appointment: { icon: 'calendar', color: '#2563eb' },
  scan: { icon: 'flask', color: COLORS.primary },
  subscription: { icon: 'star', color: COLORS.warning },
  general: { icon: 'notifications', color: COLORS.textSecondary },
};

// Override config for appointment subtypes
function getNotifConfig(
  notif: AppNotification
): { icon: React.ComponentProps<typeof Ionicons>['name']; color: string } {
  if (notif.subtype === 'appointment-scheduled') {
    return { icon: 'checkmark-circle', color: '#16a34a' };
  }
  if (notif.subtype === 'appointment-rejected') {
    return { icon: 'close-circle', color: COLORS.danger };
  }
  return TYPE_CONFIG[notif.type];
}

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function loadNotifications() {
    const user = await getCurrentUser();
    if (!user) return;
    setUserId(user.id);
    const notifs = await getAppNotifications(user.id);
    setNotifications(notifs);
  }

  useFocusEffect(
    useCallback(() => {
      loadNotifications();
    }, [])
  );

  async function onRefresh() {
    setRefreshing(true);
    await loadNotifications();
    setRefreshing(false);
  }

  async function handleMarkAllRead() {
    if (!userId) return;
    const unread = notifications.filter((n) => !n.read);
    await Promise.all(unread.map((n) => markAppNotificationRead(userId, n.id)));
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.avatarCircle}>
          <Ionicons name="notifications" size={20} color={COLORS.primary} />
        </View>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.headerWelcome}>
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </Text>
          <Text style={styles.headerName}>Notifications</Text>
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity style={styles.markBtn} onPress={handleMarkAllRead}>
            <Text style={styles.markBtnText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {notifications.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="notifications-outline" size={36} color={COLORS.primary} />
          </View>
          <Text style={styles.emptyTitle}>No Notifications</Text>
          <Text style={styles.emptySub}>
            Appointment confirmations, scan results, and updates will appear here.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.container}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
          }
        >
          <View style={styles.list}>
            {notifications.map((notif) => {
              const config = getNotifConfig(notif);
              return (
                <TouchableOpacity
                  key={notif.id}
                  activeOpacity={0.85}
                  style={[styles.card, !notif.read && styles.cardUnread]}
                  onPress={() => userId && !notif.read && markAppNotificationRead(userId, notif.id).then(loadNotifications)}
                >
                  <View style={[styles.iconWrap, { backgroundColor: config.color + '18' }]}>
                    <Ionicons name={config.icon} size={22} color={config.color} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <View style={styles.cardTop}>
                      <Text style={styles.cardTitle} numberOfLines={1}>
                        {notif.title}
                      </Text>
                      {!notif.read && <View style={styles.unreadDot} />}
                    </View>
                    <Text style={styles.cardMsg} numberOfLines={3}>
                      {notif.message}
                    </Text>
                    <Text style={styles.cardTime}>{timeAgo(notif.timestamp)}</Text>
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
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(isoString).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
  });
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
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.primaryLight ?? '#e6f4ea',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerWelcome: { fontSize: 11, color: COLORS.primary, fontWeight: '600', letterSpacing: 0.2 },
  headerName: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  markBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#F5F6FA',
    borderRadius: 20,
  },
  markBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 12 },

  // ── Empty state ──
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: '#F7F8FA',
  },
  emptyIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: COLORS.primaryLight ?? '#e6f4ea',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 6 },
  emptySub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },

  // ── List cards (matches home screen listCard) ──
  list: { paddingHorizontal: 20, paddingTop: 16, gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardUnread: {
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  cardTitle: { fontSize: 13, fontWeight: '700', color: COLORS.text, flex: 1 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
    marginLeft: 6,
  },
  cardMsg: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 18, marginBottom: 4 },
  cardTime: { fontSize: 10, color: COLORS.textLight ?? COLORS.textSecondary },
});