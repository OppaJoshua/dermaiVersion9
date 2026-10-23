import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  TextInput,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Image,
  StatusBar,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, APP_NAME, APP_VERSION } from '@/lib/constants';
import {
  getCurrentUser,
  clearCurrentUser,
  addHelpdeskTicket,
  getNotifPrefs,
  saveNotifPrefs,
  getUserSubscription,
} from '@/lib/store';
import type { PatientAccount, NotifPrefs, SubscriptionRecord } from '@/lib/store';

export default function SettingsScreen() {
  const router = useRouter();
  const [user, setUser] = useState<PatientAccount | null>(null);
  const [sub, setSub] = useState<SubscriptionRecord | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>({
    appointmentReminders: true,
    scanResultAlerts: true,
  });

  useFocusEffect(
    useCallback(() => {
      getCurrentUser().then((u) => {
        setUser(u);
        if (u) {
          getNotifPrefs(u.id).then(setNotifPrefs);
          getUserSubscription(u.id).then(setSub);
        }
      });
    }, [])
  );

  async function toggleNotif(key: keyof NotifPrefs, value: boolean) {
    if (!user) return;
    const updated = { ...notifPrefs, [key]: value };
    setNotifPrefs(updated);
    await saveNotifPrefs(user.id, updated);
  }

  async function handleLogout() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out of DermAI?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await clearCurrentUser();
          router.replace('/(auth)/login');
        },
      },
    ]);
  }

  const isPremium = sub?.plan === 'premium' || sub?.plan === 'pro' || sub?.scanLimit === -1;

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header with back */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={20} color={COLORS.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.headerTitle}>Settings</Text>
          <Text style={styles.headerSub}>Preferences &amp; System Controls</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>

        {/* User Mini Card */}
        {user && (
          <View style={styles.userCard}>
            <View style={styles.userAvatar}>
              {user.profileImage ? (
                <Image source={{ uri: user.profileImage }} style={styles.userAvatarImg} />
              ) : (
                <Text style={styles.userAvatarTxt}>
                  {user.fullName
                    .split(' ')
                    .slice(0, 2)
                    .map((n) => n[0])
                    .join('')
                    .toUpperCase()}
                </Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.userName} numberOfLines={1}>{user.fullName}</Text>
              <Text style={styles.userEmail} numberOfLines={1}>{user.email}</Text>
            </View>
            <View style={[styles.planTag, isPremium ? styles.planTagPremium : styles.planTagFree]}>
              <Text style={[styles.planTagTxt, isPremium ? styles.planTagTxtPremium : styles.planTagTxtFree]}>
                {isPremium ? 'Premium' : 'Free'}
              </Text>
            </View>
          </View>
        )}

        {/* Section 1: Subscription & Plan */}
        <SectionHeader title="Subscription &amp; Plans" />
        <View style={styles.group}>
          <SettingsRow
            icon="star-outline"
            label="Manage Subscription"
            value={isPremium ? 'Premium Active' : 'Free Plan'}
            onPress={() => router.push({ pathname: '/(app)/subscription', params: { from: 'settings' } })}
          />
          <SettingsRow
            icon="receipt-outline"
            label="Billing &amp; Allowance"
            onPress={() => router.push({ pathname: '/(app)/subscription', params: { from: 'settings' } })}
            last
          />
        </View>

        {/* Section 2: Notifications */}
        <SectionHeader title="Notifications &amp; Alerts" />
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={styles.iconCircle}>
              <Ionicons name="calendar-outline" size={18} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Appointment Reminders</Text>
              <Text style={styles.rowSubLabel}>Get notified before scheduled clinic consultations</Text>
            </View>
            <Switch
              value={notifPrefs.appointmentReminders}
              onValueChange={(v) => toggleNotif('appointmentReminders', v)}
              trackColor={{ false: '#e2e8f0', true: COLORS.primary + '80' }}
              thumbColor={notifPrefs.appointmentReminders ? COLORS.primary : '#f8fafc'}
            />
          </View>

          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <View style={styles.iconCircle}>
              <Ionicons name="scan-outline" size={18} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Scan Result Alerts</Text>
              <Text style={styles.rowSubLabel}>Real-time updates when AI finishes skin analysis</Text>
            </View>
            <Switch
              value={notifPrefs.scanResultAlerts}
              onValueChange={(v) => toggleNotif('scanResultAlerts', v)}
              trackColor={{ false: '#e2e8f0', true: COLORS.primary + '80' }}
              thumbColor={notifPrefs.scanResultAlerts ? COLORS.primary : '#f8fafc'}
            />
          </View>
        </View>

        {/* Section 3: Privacy & Compliance */}
        <SectionHeader title="Privacy &amp; Medical Compliance" />
        <View style={styles.group}>
          <SettingsRow
            icon="shield-checkmark-outline"
            label="Clinical Data Privacy"
            onPress={() =>
              Alert.alert(
                'Clinical Data Privacy',
                'DermAI processes skin assessment photos and questionnaire data strictly for clinical screening and licensed dermatologist consultation. Your medical records are encrypted and never disclosed to third parties without authorization.'
              )
            }
          />
          <SettingsRow
            icon="document-text-outline"
            label="Terms of Medical Service"
            onPress={() =>
              Alert.alert(
                'Terms of Medical Service',
                'DermAI is an AI-assisted clinical pre-screening tool intended for preliminary assessment and dermatologist referral. It is NOT a definitive diagnosis. Always consult a licensed physician or board-certified dermatologist for clinical confirmation and prescription treatments.'
              )
            }
            last
          />
        </View>

        {/* Section 4: Support */}
        <SectionHeader title="Help &amp; Support" />
        <View style={styles.group}>
          <SettingsRow
            icon="chatbubble-ellipses-outline"
            label="Contact Helpdesk Support"
            onPress={() => setShowHelp(true)}
          />
          <SettingsRow
            icon="help-circle-outline"
            label="Frequently Asked Questions (FAQ)"
            onPress={() =>
              Alert.alert(
                'DermAI FAQs',
                '• How does the 15-question pre-screening work?\nIt evaluates clinical symptoms (itching, location, onset) based on AAD and DermNet guidelines.\n\n• Is my data confidential?\nYes, all photo submissions and scan records are encrypted and protected.\n\n• How do I book an appointment?\nGo to Appointments → Book New, select your clinic, attending dermatologist, and arrival window.'
              )
            }
            last
          />
        </View>

        {/* Section 5: App Information */}
        <SectionHeader title="System &amp; Engine" />
        <View style={styles.group}>
          <SettingsRow
            icon="phone-portrait-outline"
            label="Application Version"
            value={`${APP_NAME} v${APP_VERSION}`}
          />
          <SettingsRow
            icon="hardware-chip-outline"
            label="AI Diagnostic Engine"
            value="ResNet-50 + Rule Mapping"
            last
          />
        </View>

        {/* Section 6: Danger Zone */}
        <SectionHeader title="Account Actions" />
        <View style={styles.group}>
          <TouchableOpacity style={[styles.dangerRow, { borderBottomWidth: 0 }]} onPress={handleLogout} activeOpacity={0.7}>
            <View style={[styles.iconCircle, { backgroundColor: '#fee2e2' }]}>
              <Ionicons name="log-out-outline" size={18} color="#dc2626" />
            </View>
            <Text style={[styles.rowLabel, { color: '#dc2626' }]}>Sign Out</Text>
            <Ionicons name="chevron-forward" size={16} color="#cbd5e1" />
          </TouchableOpacity>
          
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      <HelpModal
        visible={showHelp}
        user={user}
        onClose={() => setShowHelp(false)}
      />
    </SafeAreaView>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

function SettingsRow({
  icon,
  label,
  value,
  onPress,
  last,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value?: string;
  onPress?: () => void;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.row, last && { borderBottomWidth: 0 }]}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.7}
    >
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={18} color={COLORS.primary} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        {value && <Text style={styles.rowValue}>{value}</Text>}
        <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
      </View>
    </TouchableOpacity>
  );
}

const SUPPORT_TOPICS = [
  { id: 'scan', label: 'AI Scan Assessment', icon: 'scan-outline' as const, defaultSubject: 'Question regarding skin scan assessment' },
  { id: 'billing', label: 'Subscription & Billing', icon: 'card-outline' as const, defaultSubject: 'Subscription and billing inquiry' },
  { id: 'clinic', label: 'Clinic Consultation', icon: 'calendar-outline' as const, defaultSubject: 'Inquiry regarding clinic consultation booking' },
  { id: 'bug', label: 'Technical / App Bug', icon: 'bug-outline' as const, defaultSubject: 'Reporting a technical bug or crash in mobile app' },
  { id: 'general', label: 'General Inquiry', icon: 'help-circle-outline' as const, defaultSubject: 'General inquiry about DermaAI services' },
];

function HelpModal({
  visible,
  user,
  onClose,
}: {
  visible: boolean;
  user: PatientAccount | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [focusedField, setFocusedField] = useState<'subject' | 'message' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);

  // Dynamic top padding to strictly eliminate Android status bar / notch overlap
  const topPadding = Platform.OS === 'android'
    ? (StatusBar.currentHeight ?? 24) + 8
    : Math.max(insets.top, 14);

  function handleSelectTopic(topicId: string, defaultSub: string) {
    if (selectedTopic === topicId) {
      setSelectedTopic(null);
    } else {
      setSelectedTopic(topicId);
      if (!subject.trim() || SUPPORT_TOPICS.some((t) => t.defaultSubject === subject)) {
        setSubject(defaultSub);
      }
    }
  }

  async function handleSubmit() {
    if (!subject.trim() || !message.trim()) {
      Alert.alert('Missing Information', 'Please provide both a subject and a message description.');
      return;
    }
    if (!user) {
      Alert.alert('Not Signed In', 'Please sign in to submit a support inquiry.');
      return;
    }
    setSubmitting(true);
    try {
      const ticket = await addHelpdeskTicket({
        userId: user.id,
        userEmail: user.email,
        userName: user.fullName,
        subject: subject.trim(),
        message: message.trim(),
      });
      setSubmitted(ticket.id);
    } catch (err: any) {
      Alert.alert('Submission Error', err?.message ?? 'Failed to submit ticket.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    setSubject('');
    setMessage('');
    setSelectedTopic(null);
    setSubmitted(null);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: '#FFFFFF' }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <SafeAreaView edges={['left', 'right', 'bottom']} style={[styles.modalSafe, { paddingTop: topPadding }]}>
          {/* ── Modern Uncluttered Header ── */}
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.modalCloseBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={20} color={COLORS.text} />
            </TouchableOpacity>

            <View style={styles.modalHeaderCenter}>
              <Text style={styles.modalTitle}>Contact Support</Text>
              <View style={styles.onlineBadgeRow}>
                <View style={styles.onlineDot} />
                <Text style={styles.onlineTxt}>Active Support · Avg reply &lt; 2h</Text>
              </View>
            </View>

            <View style={{ width: 38 }} />
          </View>

          {submitted ? (
            <View style={styles.successBox}>
              <View style={styles.successIconOuterRing}>
                <View style={styles.successIconCircle}>
                  <Ionicons name="checkmark" size={36} color="#fff" />
                </View>
              </View>
              <Text style={styles.successTitle}>Ticket Submitted!</Text>
              <View style={styles.ticketIdBadge}>
                <Ionicons name="receipt-outline" size={14} color={COLORS.primary} style={{ marginRight: 6 }} />
                <Text style={styles.successId}>Ticket #{submitted}</Text>
              </View>
              <Text style={styles.successMsg}>
                Our clinical and technical specialists have received your inquiry. A confirmation has been logged, and we'll reply directly to{' '}
                <Text style={{ fontWeight: '700', color: COLORS.text }}>{user?.email || 'your email'}</Text> shortly.
              </Text>
              <TouchableOpacity style={styles.doneBtn} onPress={handleClose} activeOpacity={0.85}>
                <Text style={styles.doneBtnTxt}>Back to Settings</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.modalContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* User Account Context Banner */}
              <View style={styles.userContextCard}>
                <View style={styles.userContextAvatar}>
                  <Ionicons name="person" size={16} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.userContextLabel}>SUBMITTING INQUIRY AS</Text>
                  <Text style={styles.userContextValue} numberOfLines={1}>
                    {user?.fullName || 'DermaAI Patient'} · {user?.email || 'patient@dermai.ph'}
                  </Text>
                </View>
                <View style={styles.priorityPill}>
                  <Ionicons name="shield-checkmark" size={11} color="#059669" />
                  <Text style={styles.priorityPillTxt}>Verified</Text>
                </View>
              </View>

              {/* Topic Select Carousel */}
              <View style={styles.topicsSection}>
                <Text style={styles.topicsSectionTitle}>Select Topic / Category</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.topicChipsScroll}
                >
                  {SUPPORT_TOPICS.map((topic) => {
                    const isSelected = selectedTopic === topic.id;
                    return (
                      <TouchableOpacity
                        key={topic.id}
                        style={[styles.topicChip, isSelected && styles.topicChipActive]}
                        onPress={() => handleSelectTopic(topic.id, topic.defaultSubject)}
                        activeOpacity={0.75}
                      >
                        <Ionicons
                          name={topic.icon}
                          size={13}
                          color={isSelected ? COLORS.primary : '#64748B'}
                          style={{ marginRight: 5 }}
                        />
                        <Text style={[styles.topicChipTxt, isSelected && styles.topicChipTxtActive]}>
                          {topic.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Subject Input */}
              <View style={styles.formGroup}>
                <View style={styles.labelRow}>
                  <Ionicons name="pricetag-outline" size={13} color={COLORS.primary} />
                  <Text style={styles.formLabel}>Subject</Text>
                </View>
                <TextInput
                  style={[
                    styles.formInput,
                    focusedField === 'subject' && styles.formInputFocused,
                  ]}
                  placeholder="e.g. Issue uploading skin photos"
                  placeholderTextColor="#94A3B8"
                  value={subject}
                  onChangeText={setSubject}
                  onFocus={() => setFocusedField('subject')}
                  onBlur={() => setFocusedField(null)}
                />
              </View>

              {/* Message Details Input */}
              <View style={styles.formGroup}>
                <View style={styles.labelRow}>
                  <Ionicons name="chatbox-ellipses-outline" size={13} color={COLORS.primary} />
                  <Text style={styles.formLabel}>Message Details</Text>
                  <Text style={styles.charCountTxt}>{message.length} chars</Text>
                </View>
                <TextInput
                  style={[
                    styles.formInput,
                    styles.textArea,
                    focusedField === 'message' && styles.formInputFocused,
                  ]}
                  placeholder="Describe your issue, symptoms inquiry, or question in detail..."
                  placeholderTextColor="#94A3B8"
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  numberOfLines={5}
                  onFocus={() => setFocusedField('message')}
                  onBlur={() => setFocusedField(null)}
                />
              </View>

              {/* Primary Submit Button */}
              <TouchableOpacity
                style={[styles.submitBtn, submitting && { opacity: 0.65 }]}
                onPress={handleSubmit}
                disabled={submitting}
                activeOpacity={0.85}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <View style={styles.submitBtnContent}>
                    <Ionicons name="paper-plane" size={15} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={styles.submitBtnTxt}>Submit Support Ticket</Text>
                  </View>
                )}
              </TouchableOpacity>

              {/* Direct Channels & Medical Safety Notice */}
              <View style={styles.directContactWrap}>
                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerLabel}>DIRECT CHANNELS</Text>
                  <View style={styles.dividerLine} />
                </View>

                <View style={styles.directCardsGrid}>
                  <TouchableOpacity
                    style={styles.directMiniCard}
                    onPress={() => Linking.openURL('mailto:support@dermai.ph?subject=DermaAI%20Support%20Inquiry')}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.directMiniIcon, { backgroundColor: '#EEF2FF' }]}>
                      <Ionicons name="mail" size={16} color="#4F46E5" />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.directMiniTitle}>Email Directly</Text>
                      <Text style={styles.directMiniSub}>support@dermai.ph</Text>
                    </View>
                    <Ionicons name="open-outline" size={14} color="#94A3B8" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.directMiniCard}
                    onPress={() => Linking.openURL('tel:+63322343376')}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.directMiniIcon, { backgroundColor: '#ECFDF5' }]}>
                      <Ionicons name="call" size={16} color="#059669" />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.directMiniTitle}>Clinic Support Desk</Text>
                      <Text style={styles.directMiniSub}>Mon–Sat 8AM–6PM</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={14} color="#94A3B8" />
                  </TouchableOpacity>
                </View>

                {/* Medical Emergency Warning Callout */}
                <View style={styles.medicalNoticeCallout}>
                  <Ionicons name="alert-circle-outline" size={16} color="#B91C1C" style={{ marginTop: 1 }} />
                  <Text style={styles.medicalNoticeTxt}>
                    For acute clinical emergencies, intense pain, or severe allergic reactions, do not wait for a support ticket response. Visit an emergency medical facility immediately.
                  </Text>
                </View>
              </View>

              <View style={{ height: 28 }} />
            </ScrollView>
          )}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F8FAFC' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  headerSub: { fontSize: 11, color: COLORS.textSecondary, marginTop: 1 },

  // User Card Preview
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 14,
    padding: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  userAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  userAvatarImg: { width: '100%', height: '100%' },
  userAvatarTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
  userName: { fontSize: 15, fontWeight: '800', color: COLORS.text },
  userEmail: { fontSize: 12, color: COLORS.textSecondary, marginTop: 1 },
  planTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  planTagPremium: { backgroundColor: '#fdf2f8', borderColor: '#fbcfe8' },
  planTagFree: { backgroundColor: '#f8fafc', borderColor: '#e2e8f0' },
  planTagTxt: { fontSize: 11, fontWeight: '700' },
  planTagTxtPremium: { color: COLORS.primary },
  planTagTxtFree: { color: '#64748b' },

  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 8,
  },
  group: {
    backgroundColor: '#fff',
    borderRadius: 20,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    gap: 12,
  },
  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    gap: 12,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#fdf2f8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { flex: 1, fontSize: 14, color: '#1e293b', fontWeight: '600' },
  rowSubLabel: { fontSize: 11, color: '#94a3b8', marginTop: 1 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowValue: { fontSize: 12, color: '#64748b', fontWeight: '600' },

  // Help Modal
  modalSafe: { flex: 1, backgroundColor: '#FFFFFF' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  modalCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalHeaderCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  onlineBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  onlineTxt: {
    fontSize: 11,
    fontWeight: '600',
    color: '#059669',
  },
  modalContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
  },

  // User Context Card
  userContextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 18,
  },
  userContextAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FDF2F8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userContextLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  userContextValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 1,
  },
  priorityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    gap: 3,
  },
  priorityPillTxt: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#059669',
  },

  // Topics Section
  topicsSection: {
    marginBottom: 18,
  },
  topicsSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  topicChipsScroll: {
    gap: 8,
    paddingBottom: 2,
  },
  topicChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  topicChipActive: {
    backgroundColor: '#FDF2F8',
    borderColor: COLORS.primary,
  },
  topicChipTxt: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  topicChipTxtActive: {
    color: COLORS.primary,
    fontWeight: '700',
  },

  // Form Fields
  formGroup: {
    marginBottom: 16,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  formLabel: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '700',
    color: '#1E293B',
  },
  charCountTxt: {
    fontSize: 11,
    color: '#94A3B8',
  },
  formInput: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0F172A',
  },
  formInputFocused: {
    borderColor: COLORS.primary,
    backgroundColor: '#FFFFFF',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  textArea: {
    height: 110,
    textAlignVertical: 'top',
    paddingTop: 12,
    lineHeight: 20,
  },

  // Submit Button
  submitBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  submitBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnTxt: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14.5,
    letterSpacing: 0.2,
  },

  // Direct Contact Section
  directContactWrap: {
    marginTop: 24,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  dividerLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.8,
  },
  directCardsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  directMiniCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  directMiniIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  directMiniTitle: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#1E293B',
  },
  directMiniSub: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 1,
  },
  medicalNoticeCallout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  medicalNoticeTxt: {
    flex: 1,
    fontSize: 11,
    color: '#991B1B',
    lineHeight: 16,
  },

  // Success Box
  successBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  successIconOuterRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FDF2F8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  successIconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: {
    fontSize: 21,
    fontWeight: '800',
    color: COLORS.text,
  },
  ticketIdBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FDF2F8',
    borderColor: '#FBCFE8',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 10,
    marginBottom: 12,
  },
  successId: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '700',
  },
  successMsg: {
    fontSize: 13.5,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },
  doneBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingHorizontal: 36,
    paddingVertical: 14,
    marginTop: 26,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 3,
  },
  doneBtnTxt: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14.5,
  },
});
