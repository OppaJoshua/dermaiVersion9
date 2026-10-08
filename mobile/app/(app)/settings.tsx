import { useState, useCallback, ComponentProps } from 'react';
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
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import {
  getCurrentUser,
  clearCurrentUser,
  addHelpdeskTicket,
  getNotifPrefs,
  saveNotifPrefs,
} from '@/lib/store';
import type { PatientAccount, NotifPrefs } from '@/lib/store';

export default function SettingsScreen() {
  const router = useRouter();
  const [user, setUser] = useState<PatientAccount | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>({
    appointmentReminders: true,
    scanResultAlerts: true,
  });

  useFocusEffect(
    useCallback(() => {
      getCurrentUser().then((u) => {
        setUser(u);
        if (u) getNotifPrefs(u.id).then(setNotifPrefs);
      });
    }, [])
  );

  async function toggleNotif(key: keyof NotifPrefs, value: boolean) {
    if (!user) return;
    const updated = { ...notifPrefs, [key]: value };
    setNotifPrefs(updated);
    await saveNotifPrefs(user.id, updated);
  }

  async function handleDeleteAccount() {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and all associated data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!user) return;
            const { getPatientAccounts, KEYS } = await import('@/lib/store');
            const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
            const accounts = await getPatientAccounts();
            const updated = accounts.filter((a) => a.email !== user.email);
            await AsyncStorage.setItem(KEYS.PATIENT_ACCOUNTS, JSON.stringify(updated));
            await clearCurrentUser();
            Alert.alert('Account Deleted', 'Your account has been removed.');
            router.replace('/(auth)/login');
          },
        },
      ]
    );
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

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header with back */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Account */}
        <SectionHeader title="Account" />
        <View style={styles.group}>
          <SettingsRow
            icon="star-outline"
            iconColor={COLORS.warning}
            label="Manage Subscription"
            onPress={() => router.push('/(app)/subscription')}
          />
          <SettingsRow
            icon="receipt-outline"
            iconColor={COLORS.primary}
            label="Billing"
            onPress={() => router.push('/(app)/billing')}
            last
          />
        </View>

        {/* Notifications */}
        <SectionHeader title="Notifications" />
        <View style={styles.group}>
          <View style={[styles.row]}>
            <View style={[styles.iconCircle, { backgroundColor: '#2563eb18' }]}>
              <Ionicons name="calendar-outline" size={18} color="#2563eb" />
            </View>
            <Text style={styles.rowLabel}>Appointment Reminders</Text>
            <Switch
              value={notifPrefs.appointmentReminders}
              onValueChange={(v) => toggleNotif('appointmentReminders', v)}
              trackColor={{ false: COLORS.border, true: COLORS.primary + '80' }}
              thumbColor={notifPrefs.appointmentReminders ? COLORS.primary : '#f4f4f5'}
            />
          </View>
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <View style={[styles.iconCircle, { backgroundColor: COLORS.success + '18' }]}>
              <Ionicons name="scan-outline" size={18} color={COLORS.success} />
            </View>
            <Text style={styles.rowLabel}>Scan Result Alerts</Text>
            <Switch
              value={notifPrefs.scanResultAlerts}
              onValueChange={(v) => toggleNotif('scanResultAlerts', v)}
              trackColor={{ false: COLORS.border, true: COLORS.primary + '80' }}
              thumbColor={notifPrefs.scanResultAlerts ? COLORS.primary : '#f4f4f5'}
            />
          </View>
        </View>

        {/* Privacy */}
        <SectionHeader title="Privacy" />
        <View style={styles.group}>
          <SettingsRow
            icon="shield-checkmark-outline"
            iconColor={COLORS.success}
            label="Privacy Policy"
            onPress={() =>
              Alert.alert(
                'Privacy Policy',
                'DermAI collects and processes your skin scan data solely to provide diagnostic assistance. Your data is stored locally on your device and is never shared without your consent. For full details, visit our website.'
              )
            }
          />
          <SettingsRow
            icon="document-text-outline"
            iconColor={COLORS.info}
            label="Terms of Service"
            onPress={() =>
              Alert.alert(
                'Terms of Service',
                'DermAI is an AI-assisted diagnostic tool intended for informational purposes only. It does not replace professional medical advice. By using DermAI, you acknowledge that results are preliminary and should be confirmed by a licensed dermatologist.'
              )
            }
            last
          />
        </View>

        {/* Support */}
        <SectionHeader title="Support" />
        <View style={styles.group}>
          <SettingsRow
            icon="chatbubble-outline"
            iconColor="#7c3aed"
            label="Contact Support"
            onPress={() => setShowHelp(true)}
          />
          <SettingsRow
            icon="help-circle-outline"
            iconColor={COLORS.textSecondary}
            label="FAQ"
            onPress={() =>
              Alert.alert(
                'Frequently Asked Questions',
                '• How accurate is the AI? — DermAI achieves 75-85% preliminary accuracy.\n\n• Is it a replacement for a doctor? — No, always consult a dermatologist.\n\n• How do I upgrade? — Go to Profile → Subscription.\n\n• Can I delete my data? — Yes, via Settings → Delete Account.'
              )
            }
            last
          />
        </View>

        {/* About */}
        <SectionHeader title="About" />
        <View style={styles.group}>
          <SettingsRow icon="phone-portrait-outline" iconColor={COLORS.textSecondary} label="App Version" value="1.0.0" />
          <SettingsRow icon="people-outline" iconColor={COLORS.primary} label="Development Team" value="Capstone Group" last />
        </View>

        {/* Danger zone */}
        <SectionHeader title="Danger Zone" />
        <View style={styles.group}>
          <TouchableOpacity style={styles.dangerRow} onPress={handleLogout}>
            <View style={[styles.iconCircle, { backgroundColor: COLORS.danger + '18' }]}>
              <Ionicons name="log-out-outline" size={18} color={COLORS.danger} />
            </View>
            <Text style={[styles.rowLabel, { color: COLORS.danger }]}>Sign Out</Text>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textLight} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.dangerRow, { borderBottomWidth: 0 }]}
            onPress={handleDeleteAccount}
          >
            <View style={[styles.iconCircle, { backgroundColor: COLORS.danger + '18' }]}>
              <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
            </View>
            <Text style={[styles.rowLabel, { color: COLORS.danger }]}>Delete Account</Text>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textLight} />
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
  iconColor,
  label,
  value,
  onPress,
  last,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  iconColor?: string;
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
      activeOpacity={onPress ? 0.7 : 1}
    >
      <View style={[styles.iconCircle, { backgroundColor: (iconColor ?? COLORS.primary) + '18' }]}>
        <Ionicons name={icon} size={18} color={iconColor ?? COLORS.primary} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        {value && <Text style={styles.rowValue}>{value}</Text>}
        {onPress && <Ionicons name="chevron-forward" size={16} color={COLORS.textLight} />}
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
      Alert.alert('Missing Fields', 'Please fill in both subject and message.');
      return;
    }
    if (!user) {
      Alert.alert('Not Logged In', 'Please log in to submit a support ticket.');
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
            <TouchableOpacity onPress={handleClose}>
              <Text style={styles.modalClose}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Contact Support</Text>
            <View style={{ width: 50 }} />
          </View>

          {submitted ? (
            <View style={styles.successBox}>
              <View style={styles.successIconCircle}>
                <Ionicons name="checkmark-circle" size={52} color={COLORS.success} />
              </View>
              <Text style={styles.successTitle}>Ticket Submitted!</Text>
              <Text style={styles.successId}>Ticket ID: {submitted}</Text>
              <Text style={styles.successMsg}>
                Our support team will respond within 24 hours. You may also follow up via email.
              </Text>
              <TouchableOpacity style={styles.doneBtn} onPress={handleClose}>
                <Text style={styles.doneBtnTxt}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.helpIntro}>
                Describe your issue below and our team will get back to you within 24 hours.
              </Text>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Subject</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="e.g. Can't upload photo"
                  placeholderTextColor={COLORS.textLight}
                  value={subject}
                  onChangeText={setSubject}
                />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Message</Text>
                <TextInput
                  style={[styles.formInput, styles.textArea]}
                  placeholder="Describe your issue in detail..."
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
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitBtnTxt}>Submit Ticket</Text>
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
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.background,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 8,
  },
  group: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 12,
  },
  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 12,
    paddingHorizontal: 0,
  },
  iconCircle: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { flex: 1, fontSize: 14, color: COLORS.text, fontWeight: '500' },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowValue: { fontSize: 13, color: COLORS.textSecondary },
  // Modal
  modalSafe: { flex: 1, backgroundColor: COLORS.background },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  modalClose: { color: COLORS.textSecondary, fontSize: 15 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  modalSave: { color: COLORS.primary, fontWeight: '700', fontSize: 15 },
  modalContent: { padding: 20, gap: 4 },
  helpIntro: { fontSize: 14, color: COLORS.textSecondary, lineHeight: 21, marginBottom: 16 },
  formGroup: { marginBottom: 14 },
  formLabel: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 6 },
  formInput: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.text,
  },
  textArea: { height: 120, textAlignVertical: 'top', paddingTop: 12 },
  submitBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  submitBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  successBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  successIconCircle: { marginBottom: 8 },
  successTitle: { fontSize: 22, fontWeight: '700', color: COLORS.text },
  successId: { fontSize: 14, color: COLORS.primary, fontWeight: '600' },
  successMsg: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 21, marginTop: 4 },
  doneBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 13,
    marginTop: 16,
  },
  doneBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  textLight: { color: COLORS.textLight },
});
