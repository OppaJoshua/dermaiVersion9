import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, KeyboardAvoidingView,
  Platform, Image, ScrollView,
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
import { supabase } from '@/lib/supabase';
import { savePatientAccount } from '@/lib/store';

WebBrowser.maybeCompleteAuthSession();

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

function parseAuthUrlParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const queryStart = url.indexOf('?');
  const hashStart = url.indexOf('#');

  const parseString = (str: string) => {
    str.split('&').forEach((pair) => {
      const eqIdx = pair.indexOf('=');
      if (eqIdx !== -1) {
        const key = decodeURIComponent(pair.slice(0, eqIdx));
        const val = decodeURIComponent(pair.slice(eqIdx + 1));
        if (key) params[key] = val;
      }
    });
  };

  if (hashStart !== -1) {
    parseString(url.substring(hashStart + 1));
  }
  if (queryStart !== -1) {
    const end = hashStart !== -1 && hashStart > queryStart ? hashStart : url.length;
    parseString(url.substring(queryStart + 1, end));
  }
  return params;
}

type Mode = 'signin' | 'signup';

export default function LoginScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function onAuthSuccess(user: any) {
    console.log('[Google Auth] Successfully authenticated user:', user.email);
    try {
      await savePatientAccount({
        id: user.id,
        fullName: user.user_metadata?.full_name || user.user_metadata?.name || '',
        email: user.email || '',
        profileImage: user.user_metadata?.avatar_url || user.user_metadata?.picture || undefined,
        createdAt: new Date().toISOString(),
      });
    } catch (saveErr: any) {
      console.warn('[Google Auth] Profile sync notice:', saveErr?.message);
    }
    router.replace('/(app)');
  }

  async function processAuthUrl(url: string) {
    if (!url) return;
    console.log('[Google Auth] Processing auth URL:', url);
    const params = parseAuthUrlParams(url);

    if (params.code) {
      console.log('[Google Auth] Exchanging PKCE code for session...');
      const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(params.code);
      if (exchangeError) {
        console.error('[Google Auth] exchangeCode error:', exchangeError.message);
        return;
      }
      if (exchangeData?.user) {
        await onAuthSuccess(exchangeData.user);
      }
    } else if (params.access_token && params.refresh_token) {
      console.log('[Google Auth] Setting session from tokens...');
      const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
        access_token: params.access_token,
        refresh_token: params.refresh_token,
      });
      if (sessionError) {
        console.error('[Google Auth] setSession error:', sessionError.message);
        return;
      }
      if (sessionData?.user) {
        await onAuthSuccess(sessionData.user);
      }
    }
  }

  useEffect(() => {
    // 1. Listen for deep link events while the app is in the background or foreground
    const sub = Linking.addEventListener('url', async (event) => {
      console.log('[Google Auth] Deep link event received:', event.url);
      if (event.url && (event.url.includes('code=') || event.url.includes('access_token='))) {
        await processAuthUrl(event.url);
      }
    });

    // 2. Also check if the app was launched or resumed via deep link URL
    Linking.getInitialURL().then(async (url) => {
      if (url && (url.includes('code=') || url.includes('access_token='))) {
        console.log('[Google Auth] Initial deep link found:', url);
        await processAuthUrl(url);
      }
    });

    return () => {
      sub.remove();
    };
  }, []);

  function validateFields(): boolean {
    let valid = true;
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError('Enter a valid email address.');
      valid = false;
    } else {
      setEmailError('');
    }
    if (password.length < 6) {
      setPasswordError('Password must be at least 6 characters.');
      valid = false;
    } else {
      setPasswordError('');
    }
    return valid;
  }

  async function handleGoogleAuth() {
    setGoogleLoading(true);
    try {
      if (Platform.OS === 'web') {
        const redirectUrl = typeof window !== 'undefined' ? `${window.location.origin}` : 'http://localhost:8081';
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: redirectUrl,
          },
        });
        if (error) throw error;
        return;
      }

      const isExpoGo =
        Constants.appOwnership === 'expo' ||
        Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
        !Constants.executionEnvironment;

      let redirectUrl: string;
      if (isExpoGo) {
        // Use the live Metro host (e.g. "192.168.x.x:8081" or a tunnel domain) so the
        // redirect works on any developer's machine — never "localhost", which the
        // phone cannot reach and which Supabase would reject (falling back to Site URL).
        const hostUri = Constants.expoConfig?.hostUri;
        if (hostUri && !hostUri.startsWith('localhost') && !hostUri.startsWith('127.0.0.1')) {
          redirectUrl = `exp://${hostUri}/--/auth/callback`;
        } else {
          redirectUrl = makeRedirectUri({ path: 'auth/callback' });
        }
      } else {
        redirectUrl = makeRedirectUri({ scheme: 'dermaimobile', path: 'auth/callback' });
      }
      console.log('[Google Auth] Initiating OAuth with direct mobile redirectUrl:', redirectUrl, 'isExpoGo:', isExpoGo);

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
        },
      });

      if (error) throw error;

      if (data?.url) {
        console.log('[Google Auth] Opening auth browser session...');
        const authResult = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
        console.log('[Google Auth] WebBrowser authResult:', authResult);

        if (authResult.type === 'success' && authResult.url) {
          await processAuthUrl(authResult.url);
        } else {
          // On Android, Custom Tabs often closes with type 'dismiss' when handling an intent:
          // Check if session was already set or check initial deep link
          setTimeout(async () => {
            const initial = await Linking.getInitialURL();
            if (initial && (initial.includes('code=') || initial.includes('access_token='))) {
              await processAuthUrl(initial);
            } else {
              const { data: currentSession } = await supabase.auth.getSession();
              if (currentSession?.session?.user) {
                await onAuthSuccess(currentSession.session.user);
              }
            }
          }, 800);
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

  async function handleEmailAuth() {
    if (!validateFields()) return;
    setLoading(true);
    try {
      const trimmedEmail = email.trim();
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: {
            data: {
              role: 'patient',
              full_name: '',
            },
          },
        });
        if (error) throw error;

        if (data.user) {
          try {
            await savePatientAccount({
              id: data.user.id,
              fullName: '',
              email: trimmedEmail,
              createdAt: new Date().toISOString(),
            });
          } catch (saveErr: any) {
            console.warn('[Login] Profile init warning:', saveErr?.message);
          }
        }
      }
    } catch (err: any) {
      console.error('[Login] Supabase auth error:', err?.message);
      const msg = err?.message || 'Authentication error';
      if (msg.toLowerCase().includes('invalid login credentials') || msg.toLowerCase().includes('invalid credential')) {
        Alert.alert('Sign-in Failed', 'Incorrect email or password. Try again or use Forgot password.');
      } else if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('user already exists')) {
        Alert.alert('Email Already Registered', 'An account with this email exists. Sign in instead.');
        setMode('signin');
      } else {
        Alert.alert('Authentication Error', msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      Alert.alert('Enter your email first', 'Type your email address above then tap Forgot password.');
      return;
    }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed);
      if (error) throw error;
      Alert.alert('Reset Email Sent', `A password reset link was sent to ${trimmed}. Check your inbox.`);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not send reset email.');
    }
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
          {/* ── Brand block ── */}
          <View style={styles.brandBlock}>
            <Text style={styles.title}>Welcome to DermAI</Text>
            <Text style={styles.subtitle}>
              {mode === 'signin' ? 'Sign in to your account' : 'Create your account to get started'}
            </Text>
          </View>

          {/* ── Google Auth Button ── */}
          <TouchableOpacity
            style={styles.googleBtn}
            onPress={handleGoogleAuth}
            disabled={googleLoading || loading}
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

          {/* ── Divider ── */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* ── Form fields ── */}
          <View style={styles.form}>
            <Text style={styles.fieldLabel}>Email</Text>
            <View style={styles.inputOuter}>
              <View style={[styles.inputWrap, emailError ? styles.inputErrorWrap : null]}>
                <Ionicons name="mail-outline" size={18} color={COLORS.textSecondary} />
                <TextInput
                  style={styles.input}
                  placeholder="you@example.com"
                  placeholderTextColor={COLORS.textLight}
                  value={email}
                  onChangeText={(v) => { setEmail(v); setEmailError(''); }}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  returnKeyType="next"
                />
              </View>
            </View>
            {emailError ? (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle-outline" size={14} color={COLORS.danger} />
                <Text style={styles.fieldError}>{emailError}</Text>
              </View>
            ) : null}

            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Password</Text>
            <View style={styles.inputOuter}>
              <View style={[styles.inputWrap, passwordError ? styles.inputErrorWrap : null]}>
                <Ionicons name="lock-closed-outline" size={18} color={COLORS.textSecondary} />
                <TextInput
                  style={styles.input}
                  placeholder="Enter your password"
                  placeholderTextColor={COLORS.textLight}
                  value={password}
                  onChangeText={(v) => { setPassword(v); setPasswordError(''); }}
                  secureTextEntry={!showPassword}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  returnKeyType="go"
                  onSubmitEditing={handleEmailAuth}
                />
                <TouchableOpacity onPress={() => setShowPassword((p) => !p)} hitSlop={8}>
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color={COLORS.textSecondary}
                  />
                </TouchableOpacity>
              </View>
            </View>
            {passwordError ? (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle-outline" size={14} color={COLORS.danger} />
                <Text style={styles.fieldError}>{passwordError}</Text>
              </View>
            ) : null}

            {mode === 'signin' && (
              <TouchableOpacity
                onPress={handleForgotPassword}
                hitSlop={8}
                style={{ alignSelf: 'flex-end', marginTop: 10 }}
              >
                <Text style={styles.forgotTxt}>Forgot password?</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.submitBtn, loading && styles.btnDisabled]}
              onPress={handleEmailAuth}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.submitBtnText}>
                    {mode === 'signin' ? 'Sign In' : 'Create Account'}
                  </Text>
              }
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
                setEmailError('');
                setPasswordError('');
              }}
              hitSlop={8}
              style={{ marginTop: 20 }}
            >
              <Text style={styles.toggleText}>
                {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
                <Text style={styles.toggleLink}>
                  {mode === 'signin' ? 'Create one' : 'Sign in'}
                </Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
    paddingHorizontal: 24,
    paddingTop: 50,
    paddingBottom: 40,
    zIndex: 1,
  },

  // ── Brand block ──
  brandBlock: { alignItems: 'center', marginTop: 10, marginBottom: 32 },
  title: { fontSize: 28, fontWeight: '800', color: COLORS.text, marginBottom: 6, textAlign: 'center', letterSpacing: -0.3 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center' },

  // ── Google Button ──
  googleBtn: {
    width: '100%',
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
    marginBottom: 18,
  },
  googleBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  googleBtnText: {
    color: '#374151',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },

  // ── Divider ──
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '500',
    textTransform: 'lowercase',
  },

  // ── Form ──
  form: { width: '100%' },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 8 },

  inputOuter: {
    borderRadius: 16,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 4,
    minHeight: 52,
    overflow: 'hidden',
  },
  inputErrorWrap: { borderWidth: 1.5, borderColor: COLORS.danger },
  input: { flex: 1, paddingVertical: 14, fontSize: 15, color: COLORS.text },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, marginLeft: 2 },
  fieldError: { fontSize: 12, color: COLORS.danger },

  forgotTxt: { fontSize: 13, color: COLORS.primary, fontWeight: '600' },

  submitBtn: {
    width: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 24,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  btnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  toggleText: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center' },
  toggleLink: { color: COLORS.primary, fontWeight: '700' },
});