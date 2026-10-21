import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  TextInput,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Image,
} from 'react-native';
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

function HelpModal({
  visible,
  user,
  onClose,
}: {
  visible: boolean;
  user: PatientAccount | null;
  onClose: () => void;
}) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);

  async function handleSubmit() {
    if (!subject.trim() || !message.trim()) {
      Alert.alert('Missing Information', 'Please provide both a subject and a message.');
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
    setSubmitted(null);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={handleClose} style={styles.modalBackBtn}>
              <Ionicons name="chevron-back" size={18} color={COLORS.text} />
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Contact Support</Text>
            <View style={{ width: 60 }} />
          </View>

          {submitted ? (
            <View style={styles.successBox}>
              <View style={styles.successIconCircle}>
                <Ionicons name="checkmark-circle" size={54} color={COLORS.primary} />
              </View>
              <Text style={styles.successTitle}>Ticket Submitted!</Text>
              <View style={styles.ticketIdBadge}>
                <Text style={styles.successId}>Ticket #{submitted}</Text>
              </View>
              <Text style={styles.successMsg}>
                Our technical and clinical support team has received your ticket and will respond to {user?.email || 'your email'} within 24 hours.
              </Text>
              <TouchableOpacity style={styles.doneBtn} onPress={handleClose}>
                <Text style={styles.doneBtnTxt}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.helpIntro}>
                Have a question about your scan or need technical assistance? Fill out the form below.
              </Text>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Subject</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="e.g. Issue uploading skin photos"
                  placeholderTextColor={COLORS.textLight}
                  value={subject}
                  onChangeText={setSubject}
                />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Message</Text>
                <TextInput
                  style={[styles.formInput, styles.textArea]}
                  placeholder="Describe your issue or inquiry in detail..."
                  placeholderTextColor={COLORS.textLight}
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  numberOfLines={5}
                />
              </View>
              <TouchableOpacity
                style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
                onPress={handleSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitBtnTxt}>Submit Support Ticket</Text>
                )}
              </TouchableOpacity>
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
  modalSafe: { flex: 1, backgroundColor: '#fff' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  modalBackBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  modalClose: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  modalTitle: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  modalContent: { padding: 20 },
  helpIntro: { fontSize: 13, color: '#64748b', lineHeight: 20, marginBottom: 18 },
  formGroup: { marginBottom: 16 },
  formLabel: { fontSize: 12, fontWeight: '700', color: '#334155', marginBottom: 6 },
  formInput: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0f172a',
  },
  textArea: { height: 110, textAlignVertical: 'top', paddingTop: 12 },
  submitBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 3,
  },
  submitBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },

  successBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  successIconCircle: { marginBottom: 14 },
  successTitle: { fontSize: 20, fontWeight: '800', color: COLORS.text },
  ticketIdBadge: {
    backgroundColor: '#fdf2f8',
    borderColor: '#fbcfe8',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginTop: 8,
    marginBottom: 8,
  },
  successId: { fontSize: 13, color: COLORS.primary, fontWeight: '700' },
  successMsg: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20, marginTop: 4 },
  doneBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingHorizontal: 36,
    paddingVertical: 13,
    marginTop: 24,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 2,
  },
  doneBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
