import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, KeyboardAvoidingView,
  Platform, Image, ScrollView, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { makeRedirectUri } from 'expo-auth-session';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { COLORS } from '@/lib/constants';
import { supabase, processMobileOAuthCallbackUrl } from '@/lib/supabase';
import {
  savePatientAccount,
  verifyMobilePatientAccess,
  consumeBlockedRoleNotice,
  BlockedRoleNotice,
} from '@/lib/store';
import { logAuditEvent } from '@/lib/auditLogger';

WebBrowser.maybeCompleteAuthSession();

const USER_AGREEMENT_SECTIONS = [
  {
    title: '1. Acceptance of User Agreement',
    body: 'By creating an account or signing in to DERMAI, you acknowledge that you have read, understood, and agree to be bound by this User Agreement, our Terms of Service, and our Data Privacy Policy.',
  },
  {
    title: '2. Preliminary AI Skin Assessment Disclaimer',
    body: "DERMAI's AI skin analysis provides preliminary, educational assessments only. It is NOT a substitute for professional medical diagnosis, advice, or treatment. Always consult a licensed dermatologist regarding any skin condition.",
  },
  {
    title: '3. Data Privacy & Consent (RA 10173)',
    body: 'In compliance with the Philippine Data Privacy Act of 2012 (Republic Act No. 10173), you consent to the secure collection and processing of your personal profile information, skin scan photos, and symptom responses solely for AI skin analysis and dermatology clinic consultations.',
  },
  {
    title: '4. Account Responsibilities',
    body: 'You are responsible for providing accurate personal information and maintaining the security of your account credentials. You must be at least 18 years old or have parental/guardian consent to use the platform.',
  },
  {
    title: '5. Clinic Consultations & Payments',
    body: "Appointments booked through DERMAI are subject to the participating dermatology clinic's policies and schedules. Online payments processed via PayMongo (GCash / Maya)non-refundable and strictly non-convertible to cash. All transactions are recorded with officialction references.",
  },
  {
    title: '6. Emergency Medical Situations',
    body: 'DERMAI is not an emergency medical service. If you experience severe symptoms such as difficulty breathing, rapidly spreading rashes, or high fever, seek immediate emergency medical care or call the DOH Hotline 1555.',
  },
];

function GoogleIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47c-.28 1.5-1.13 2.78-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82Z"
      />
      <Path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.72-2.46 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.11C3.24 21.3 7.29 24 12 24Z"
      />
      <Path
        fill="#FBBC05"
        d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.28V6.61H1.26A11.96 11.96 0 0 0 0 12c0 1.93.46 3.76 1.26 5.39l4.01-3.11Z"
      />
      <Path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.29 0 3.24 2.7 1.26 6.61l4.01 3.11C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </Svg>
  );
}

export default function LoginScreen() {
  const router = useRouter();
  const [googleLoading, setGoogleLoading] = useState(false);

  // User Agreement & Privacy Consent state
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [showAgreementModal, setShowAgreementModal] = useState(false);
  const [blockedAccountNotice, setBlockedAccountNotice] = useState<BlockedRoleNotice | null>(null);

  // Guard against rapid navigation cycles
  const isNavigatingRef = useRef<boolean>(false);

  async function onAuthSuccess(user: any) {
    if (!user || isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    console.log('[Google Auth] Stage: authenticated user id:', user.id);

    const accessCheck = await verifyMobilePatientAccess(user);
    if (!accessCheck.allowed) {
      console.warn('[Google Auth] Stage: blocked non-patient role on mobile:', accessCheck.role);
      await supabase.auth.signOut().catch(() => {});
      isNavigatingRef.current = false;
      const notice = consumeBlockedRoleNotice() || {
        role: accessCheck.role,
        email: user.email || '',
        message:
          accessCheck.reason ||
          'The DermAI Mobile App is exclusively for Patient accounts. Please sign in with a Patient Google account.',
      };
      setBlockedAccountNotice(notice);
      return;
    }

    const displayName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email?.split('@')[0] ||
      'Patient';
    try {
      await savePatientAccount({
        id: user.id,
        fullName: displayName,
        email: user.email || '',
        profileImage: user.user_metadata?.avatar_url || user.user_metadata?.picture || undefined,
        createdAt: new Date().toISOString(),
      });
    } catch (saveErr: any) {
      console.warn('[Google Auth] Stage: profile sync notice:', saveErr?.message);
    }
    logAuditEvent({
      userId: user.id,
      role: 'patient',
      category: 'user',
      action: 'User Login',
      target: 'Mobile App',
      details: `${displayName} (${user.email || 'patient'}) logged in via Google on Mobile App.`,
      performerName: displayName,
      metadata: { provider: 'google', platform: 'Mobile App' },
    }).catch(() => {});
    router.replace('/(app)');
  }

  async function processAuthUrl(url: string) {
    if (!url) return;
    const result = await processMobileOAuthCallbackUrl(url);
    if (result.errorMessage) {
      Alert.alert('Google Sign-In Error', result.errorMessage);
      return;
    }
    if (result.user) {
      await onAuthSuccess(result.user);
    }
  }

  useEffect(() => {
    const pendingNotice = consumeBlockedRoleNotice();
    if (pendingNotice) {
      setBlockedAccountNotice(pendingNotice);
    }

    const isOAuthCallbackUrl = (url?: string | null): url is string =>
      Boolean(
        url &&
          (url.includes('code=') ||
            url.includes('access_token=') ||
            url.includes('error=') ||
            url.includes('error_description='))
      );

    const sub = Linking.addEventListener('url', async (event) => {
      if (isOAuthCallbackUrl(event.url)) {
        console.log('[Google Auth] Stage: deep link callback received');
        await processAuthUrl(event.url);
      }
    });

    Linking.getInitialURL().then(async (url) => {
      if (isOAuthCallbackUrl(url)) {
        console.log('[Google Auth] Stage: initial deep link callback found');
        await processAuthUrl(url);
      }
    });

    if (typeof window !== 'undefined' && window.location) {
      const href = window.location.href;
      if (isOAuthCallbackUrl(href)) {
        console.log('[Google Auth] Stage: web OAuth callback detected');
        void processAuthUrl(href);
      }
    }

    return () => {
      sub.remove();
    };
  }, []);

  async function executeGoogleAuth() {
    setGoogleLoading(true);
    try {
      if (Platform.OS === 'web') {
        const redirectUrl = typeof window !== 'undefined'
          ? `${window.location.origin}/auth/callback`
          : 'http://localhost:8081/auth/callback';
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: redirectUrl,
            queryParams: {
              prompt: 'select_account',
            },
          },
        });
        if (error) throw error;
        return;
      }

      // Detect whether app is executing inside Expo Go (StoreClient) vs Development Build (Bare/Standalone)
      const isExpoGo =
        Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
        (Constants as any).appOwnership === 'expo';

      // Expo Go uses exp://<host>/--/auth/callback; Development/Standalone builds use dermaimobile://auth/callback
      const redirectTo = isExpoGo
        ? makeRedirectUri({ path: 'auth/callback' })
        : makeRedirectUri({
            scheme: 'dermaimobile',
            path: 'auth/callback',
          });

      console.log(
        '[Google Auth] Stage: initiating OAuth',
        JSON.stringify({ environment: isExpoGo ? 'ExpoGo' : 'DevBuild', redirectTo })
      );

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          queryParams: {
            prompt: 'select_account',
          },
        },
      });

      if (error) throw error;

      if (data?.url) {
        console.log('[Google Auth] Stage: opening browser auth session');
        const authResult = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        console.log('[Google Auth] Stage: browser auth session closed with type:', authResult.type);

        if (authResult.type === 'success' && authResult.url) {
          await processAuthUrl(authResult.url);
        } else if (authResult.type === 'cancel' || authResult.type === 'dismiss') {
          const { data: currentSession } = await supabase.auth.getSession();
          if (currentSession?.session?.user) {
            await onAuthSuccess(currentSession.session.user);
          } else if (isExpoGo) {
            console.log(
              '[Google Auth] Stage: session not completed in Expo Go. Ensure Supabase Auth Redirect URLs includes:',
              redirectTo
            );
          }
        } else if (authResult.type === 'locked') {
          Alert.alert(
            'Sign-In In Progress',
            'An authentication session is already active in another browser tab. Please close it and try again.'
          );
        }
      }
    } catch (err: any) {
      console.error('[Login] Google auth error:', err?.message || err);
      const msg = err?.message || '';
      if (msg && !msg.toLowerCase().includes('cancel') && !msg.toLowerCase().includes('dismiss') && !msg.toLowerCase().includes('user cancelled')) {
        Alert.alert('Google Sign-In', msg);
      }
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleGoogleAuth() {
    if (!agreedToTerms) {
      setShowAgreementModal(true);
      return;
    }
    await executeGoogleAuth();
  }

  async function handleAcceptAgreementModal() {
    setAgreedToTerms(true);
    setShowAgreementModal(false);
    await executeGoogleAuth();
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Background Logo Watermark ── */}
      <View style={styles.bgWatermarkWrap} pointerEvents="none">
        <Image
          source={require('@/assets/images/logo.png')}
          style={styles.bgWatermarkLogo}
          resizeMode="contain"
        />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Hero Graphic & Brand Header ── */}
          <View style={styles.heroSection}>
            <View style={styles.heroIconBadge}>
              <Image
                source={require('@/assets/images/logo.png')}
                style={styles.heroBadgeLogo}
                resizeMode="contain"
              />
            </View>

            <Text style={styles.title}>Welcome to DermAI</Text>
            <Text style={styles.subtitle}>
              Sign in with your Google account to access your skin health assessments and appointments
            </Text>
          </View>

          {/* ── Single Authentication Card ── */}
          <View style={styles.authCard}>
            {/* Google Auth Button */}
            <TouchableOpacity
              style={styles.googleBtn}
              onPress={handleGoogleAuth}
              disabled={googleLoading}
              activeOpacity={0.85}
            >
              {googleLoading ? (
                <ActivityIndicator color={COLORS.primary} size="small" />
              ) : (
                <View style={styles.googleBtnContent}>
                  <GoogleIcon size={20} />
                  <Text style={styles.googleBtnText}>Continue with Google</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Agreement Checkbox Box */}
            <View style={styles.agreementBox}>
              <TouchableOpacity
                onPress={() => setAgreedToTerms((prev) => !prev)}
                activeOpacity={0.75}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={[styles.checkboxBox, agreedToTerms && styles.checkboxBoxChecked]}
              >
                {agreedToTerms && <Ionicons name="checkmark" size={13} color="#ffffff" />}
              </TouchableOpacity>

              <Text style={styles.agreementText}>
                I have read and agree to the{' '}
                <Text
                  style={styles.agreementLink}
                  onPress={() => setShowAgreementModal(true)}
                >
                  User Agreement &amp; Medical Disclaimer
                </Text>{' '}
                and{' '}
                <Text
                  style={styles.agreementLink}
                  onPress={() => setShowAgreementModal(true)}
                >
                  Data Privacy Policy (RA 10173)
                </Text>
                .
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── User Agreement & Medical Disclaimer Modal ── */}
      <Modal
        visible={showAgreementModal}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setShowAgreementModal(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderLeft}>
                <View style={styles.modalShieldBadge}>
                  <Ionicons name="shield-checkmark" size={18} color="#ffffff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>DermAI User Agreement</Text>
                  <Text style={styles.modalSubtitle}>
                    Terms of Use, Medical Disclaimer &amp; Privacy
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setShowAgreementModal(false);
                }}
                style={styles.modalCloseBtn}
              >
                <Ionicons name="close" size={18} color="#ffffff" />
              </TouchableOpacity>
            </View>

            {/* Modal Scrollable Terms */}
            <ScrollView
              style={styles.modalBody}
              contentContainerStyle={{ paddingBottom: 16 }}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.modalIntroBanner}>
                <Ionicons name="document-text-outline" size={18} color={COLORS.primary} />
                <Text style={styles.modalIntroTxt}>
                  Please review and accept our User Agreement before creating or accessing your DermAI account.
                </Text>
              </View>

              {USER_AGREEMENT_SECTIONS.map((sec) => (
                <View key={sec.title} style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>{sec.title}</Text>
                  <Text style={styles.modalSectionBody}>{sec.body}</Text>
                </View>
              ))}
            </ScrollView>

            {/* Modal Footer */}
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.declineBtn}
                onPress={() => {
                  setShowAgreementModal(false);
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.declineBtnTxt}>Decline</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.acceptBtn}
                onPress={handleAcceptAgreementModal}
                activeOpacity={0.85}
              >
                <Ionicons name="checkmark-circle" size={17} color="#ffffff" />
                <Text style={styles.acceptBtnTxt}>I Agree &amp; Continue</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Blocked Non-Patient Account Modal ── */}
      <Modal
        visible={Boolean(blockedAccountNotice)}
        animationType="fade"
        transparent
        onRequestClose={() => setBlockedAccountNotice(null)}
      >
        <View style={[styles.modalOverlay, { justifyContent: 'center', paddingHorizontal: 20 }]}>
          <View
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 24,
              padding: 22,
              width: '100%',
              maxWidth: 400,
              alignSelf: 'center',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  backgroundColor: '#FEF2F2',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="lock-closed" size={22} color="#DC2626" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '800', color: '#111827' }}>
                  Web Portal Account Detected
                </Text>
                <Text style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                  Patient Mobile App Access Restricted
                </Text>
              </View>
            </View>

            <Text style={{ fontSize: 13, lineHeight: 20, color: '#374151', marginBottom: 18 }}>
              {blockedAccountNotice?.message}
            </Text>

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
              <TouchableOpacity
                style={styles.declineBtn}
                onPress={() => setBlockedAccountNotice(null)}
              >
                <Text style={styles.declineBtnTxt}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.acceptBtn}
                onPress={async () => {
                  setBlockedAccountNotice(null);
                  await executeGoogleAuth();
                }}
              >
                <Ionicons name="swap-horizontal" size={16} color="#ffffff" />
                <Text style={styles.acceptBtnTxt}>Switch Google Account</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F8F9FA',
    position: 'relative',
    overflow: 'hidden',
  },
  bgWatermarkWrap: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 0,
  },
  bgWatermarkLogo: {
    width: 280,
    height: 280,
    opacity: 0.08,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 44 : 50,
    paddingBottom: 40,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },

  // ── Hero Section ──
  heroSection: {
    alignItems: 'center',
    marginBottom: 24,
    width: '100%',
  },
  heroIconBadge: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    marginBottom: 16,
  },
  heroBadgeLogo: {
    width: 46,
    height: 46,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#6B7280',
    textAlign: 'center',
    maxWidth: 300,
    paddingHorizontal: 8,
  },

  // ── Authentication Card ──
  authCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    borderWidth: 1,
    borderColor: '#F1F3F5',
  },

  // ── Google Button ──
  googleBtn: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  googleBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  googleBtnText: {
    color: '#1F2937',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },

  // ── Agreement Checkbox Box ──
  agreementBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 16,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#FFF5F8',
    borderWidth: 1,
    borderColor: '#FCE7F0',
  },
  checkboxBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.8,
    borderColor: COLORS.primary,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxBoxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  agreementText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: '#4B5563',
  },
  agreementLink: {
    color: COLORS.primary,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },

  // ── Security Badge Row ──
  securityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
    paddingHorizontal: 8,
  },
  securityText: {
    fontSize: 11.5,
    color: '#6B7280',
    flexShrink: 1,
    textAlign: 'center',
    lineHeight: 16,
  },

  // ── User Agreement Modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '84%',
    overflow: 'hidden',
  },
  modalHeader: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalHeaderLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalShieldBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#ffffff',
  },
  modalSubtitle: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.82)',
    marginTop: 1,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  modalIntroBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#fdf2f7',
    borderWidth: 1,
    borderColor: '#fce7f0',
    marginBottom: 14,
  },
  modalIntroTxt: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#374151',
    fontWeight: '500',
  },
  modalSection: {
    marginBottom: 14,
  },
  modalSectionTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  modalSectionBody: {
    fontSize: 12,
    lineHeight: 18,
    color: '#4b5563',
  },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    backgroundColor: '#f8fafc',
  },
  declineBtn: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
  },
  declineBtnTxt: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  acceptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
  },
  acceptBtnTxt: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },
});
