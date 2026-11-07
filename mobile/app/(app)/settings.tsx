import { useState, useCallback, useEffect } from 'react';
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
  Image,
  StatusBar,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import {
  getCurrentUser,
  clearCurrentUser,
  addHelpdeskTicket,
  getUserSubscription,
} from '@/lib/store';
import type { PatientAccount, SubscriptionRecord } from '@/lib/store';
import { getFaqsAsync, PATIENT_FAQS, type FAQItem } from '@/lib/faqData';

export default function SettingsScreen() {
  const router = useRouter();
  const [user, setUser] = useState<PatientAccount | null>(null);
  const [sub, setSub] = useState<SubscriptionRecord | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showFaq, setShowFaq] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getCurrentUser().then((u) => {
        setUser(u);
        if (u) {
          getUserSubscription(u.id).then(setSub);
        }
      });
    }, [])
  );

  async function handleLogout() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      // 1. Trigger Supabase auth sign-out first
      await supabase.auth.signOut();

      // 2. Clear cached store state / session
      await clearCurrentUser();

      // 3. Clear navigation stack and replace with login
      try {
        if (router.canDismiss?.()) {
          router.dismissAll();
        }
      } catch {}
      router.replace('/(auth)/login');
    } catch (err: any) {
      console.warn('[Settings] Error during sign-out:', err?.message || err);
      router.replace('/(auth)/login');
    }
  }

  const isPremium = sub?.plan === 'premium' || sub?.plan === 'pro' || sub?.scanLimit === -1;
  const isBasic = sub?.plan === 'basic';
  const statusBadge: 'Premium Active' | 'Basic Active' | 'No Active Subscription' =
    sub?.statusLabel ||
    (isPremium ? 'Premium Active' : isBasic ? 'Basic Active' : 'No Active Subscription');
  const hasActiveSubscription = statusBadge === 'Premium Active' || statusBadge === 'Basic Active';

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
            <View style={[styles.planTag, hasActiveSubscription ? styles.planTagPremium : styles.planTagFree]}>
              <Text style={[styles.planTagTxt, hasActiveSubscription ? styles.planTagTxtPremium : styles.planTagTxtFree]}>
                {statusBadge}
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
            value={statusBadge}
            onPress={() => router.push({ pathname: '/(app)/subscription', params: { from: 'settings' } })}
          />
          <SettingsRow
            icon="receipt-outline"
            label="Billing &amp; Allowance"
            onPress={() => router.push('/(app)/billing')}
            last
          />
        </View>

        {/* Section 2: Support */}
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
            onPress={() => setShowFaq(true)}
            last
          />
        </View>

        {/* Section 4: Danger Zone */}
        <SectionHeader title="Account Actions" />
        <View style={styles.group}>
          <TouchableOpacity
            style={[
              styles.dangerRow,
              { borderBottomWidth: 0 },
              Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
              isSigningOut && { opacity: 0.6 },
            ]}
            onPress={handleLogout}
            disabled={isSigningOut}
            activeOpacity={0.7}
          >
            <View style={[styles.iconCircle, { backgroundColor: '#fee2e2' }]}>
              {isSigningOut ? (
                <ActivityIndicator size="small" color="#dc2626" />
              ) : (
                <Ionicons name="log-out-outline" size={18} color="#dc2626" />
              )}
            </View>
            <Text style={[styles.rowLabel, { color: '#dc2626' }]}>
              {isSigningOut ? 'Signing Out...' : 'Sign Out'}
            </Text>
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

      <FaqModal
        visible={showFaq}
        onClose={() => setShowFaq(false)}
        onOpenContact={() => {
          setShowFaq(false);
          setShowHelp(true);
        }}
      />

      {/* Smooth Sign-Out Loading Overlay to eliminate blank flashes */}
      {isSigningOut && (
        <View style={styles.signingOutOverlay}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.signingOutTxt}>Signing out...</Text>
        </View>
      )}
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
  const insets = useSafeAreaInsets();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [focusedField, setFocusedField] = useState<'subject' | 'message' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);

  // Dynamic top padding to strictly eliminate Android status bar / notch overlap
  const topPadding = Platform.OS === 'android'
    ? (StatusBar.currentHeight ?? 24) + 8
    : Math.max(insets.top, 14);

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
        category: 'General Support',
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
      <StatusBar barStyle="dark-content" />
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
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.directMiniTitle}>Email Directly</Text>
                      <Text style={styles.directMiniSub}>dermaisupport@gmail.com</Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.directMiniCard}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.directMiniTitle}>Support Number</Text>
                      <Text style={styles.directMiniSub}>(032) 888-3472</Text>
                    </View>
                  </TouchableOpacity>
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

function FaqModal({
  visible,
  onClose,
  onOpenContact,
}: {
  visible: boolean;
  onClose: () => void;
  onOpenContact: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [faqs, setFaqs] = useState<FAQItem[]>(PATIENT_FAQS);
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  const topPadding =
    Platform.OS === 'android'
      ? (StatusBar.currentHeight ?? 24) + 8
      : Math.max(insets.top, 14);

  useEffect(() => {
    if (visible) {
      let isMounted = true;
      getFaqsAsync().then((data) => {
        if (isMounted && data && data.length > 0) {
          setFaqs(data);
        }
      });
      return () => {
        isMounted = false;
      };
    }
  }, [visible]);

  const toggleAccordion = (index: number) => {
    setOpenIdx((prev) => (prev === index ? null : index));
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView edges={['left', 'right', 'bottom']} style={[styles.modalSafe, { paddingTop: topPadding }]}>
        <View style={styles.modalHeader}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.modalCloseBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={20} color={COLORS.text} />
          </TouchableOpacity>

          <View style={styles.modalHeaderCenter}>
            <Text style={styles.modalTitle}>Frequently Asked Questions</Text>
            <Text style={styles.onlineTxt}>{faqs.length} questions · General Help</Text>
          </View>

          <View style={{ width: 38 }} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.modalContent, { paddingBottom: 40 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.faqAccordionWrap}>
            {faqs.map((faq, i) => {
              const isOpen = openIdx === i;
              return (
                <View key={faq.id || i} style={[styles.faqAccordionCard, isOpen && styles.faqAccordionCardOpen]}>
                  <TouchableOpacity
                    style={styles.faqAccordionHeader}
                    onPress={() => toggleAccordion(i)}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[
                        styles.faqAccordionQuestion,
                        isOpen && styles.faqAccordionQuestionOpen,
                      ]}
                    >
                      {faq.q}
                    </Text>
                    <Ionicons
                      name={isOpen ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={isOpen ? COLORS.primary : '#94A3B8'}
                      style={{ marginLeft: 8 }}
                    />
                  </TouchableOpacity>

                  {isOpen && (
                    <View style={styles.faqAccordionBody}>
                      <Text style={styles.faqAccordionAnswer}>{faq.a}</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {/* Still need direct assistance card matching Web HelpPage */}
          <View style={styles.faqAssistanceCard}>
            <Text style={styles.faqAssistanceTitle}>Still need direct assistance?</Text>
            <Text style={styles.faqAssistanceSub}>
              You can reach our official team directly at
            </Text>

            <TouchableOpacity
              style={styles.faqEmailBtn}
              onPress={() => Linking.openURL('mailto:dermaisupport@gmail.com')}
              activeOpacity={0.7}
            >
              <Ionicons name="mail" size={15} color={COLORS.primary} />
              <Text style={styles.faqEmailBtnTxt}>dermaisupport@gmail.com</Text>
            </TouchableOpacity>

            <View style={styles.faqPhoneRow}>
              <Ionicons name="call-outline" size={14} color="#64748B" />
              <Text style={styles.faqPhoneTxt}>(032) 888-3472</Text>
            </View>

            <TouchableOpacity
              style={styles.faqContactSubmitBtn}
              onPress={onOpenContact}
              activeOpacity={0.85}
            >
              <Ionicons name="chatbubbles-outline" size={16} color="#FFFFFF" />
              <Text style={styles.faqContactSubmitBtnTxt}>Open Support Desk Ticket</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },

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
  planTagPremium: { backgroundColor: '#fdf2f7', borderColor: '#fbcfe1' },
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
    backgroundColor: '#fdf2f7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { flex: 1, fontSize: 14, color: '#1e293b', fontWeight: '600' },
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
    backgroundColor: '#fdf2f7',
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
    backgroundColor: '#fdf2f7',
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
    backgroundColor: '#fdf2f7',
    borderColor: '#fbcfe1',
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

  // ── FAQ Accordion & Modal Styles ──
  faqAccordionWrap: {
    gap: 10,
    marginBottom: 20,
  },
  faqAccordionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  faqAccordionCardOpen: {
    borderColor: '#F4C9DC',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  faqAccordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  faqAccordionQuestion: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
    lineHeight: 20,
  },
  faqAccordionQuestionOpen: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  faqAccordionBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 4,
    backgroundColor: '#FAFAFA',
    borderTopWidth: 1,
    borderTopColor: '#F8FAFC',
  },
  faqAccordionAnswer: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 20,
  },
  faqAssistanceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    marginTop: 6,
  },
  faqAssistanceTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  faqAssistanceSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  faqEmailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FDF2F7',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginTop: 12,
  },
  faqEmailBtnTxt: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
    textDecorationLine: 'underline',
  },
  faqPhoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingLeft: 4,
  },
  faqPhoneTxt: {
    fontSize: 12,
    color: '#64748B',
  },
  faqContactSubmitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 14,
  },
  faqContactSubmitBtnTxt: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },

  // Sign-Out Loading Overlay
  signingOutOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  signingOutTxt: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
});
