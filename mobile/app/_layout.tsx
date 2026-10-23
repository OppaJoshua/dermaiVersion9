import DashboardSkeleton from '@/components/DashboardSkeleton';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import 'react-native-reanimated';
import { Platform, View, ActivityIndicator } from 'react-native';
import {
  useFonts,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import {
  Poppins_400Regular,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import { supabase } from '@/lib/supabase';
import { savePatientAccount } from '@/lib/store';

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const segmentsRef = useRef(segments);
  const [ready, setReady] = useState(false);

  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    Poppins_400Regular,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  // Inject web Google Fonts link & style so web view matches web app typography exactly
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const styleId = 'dermai-brand-fonts';
      if (!document.getElementById(styleId)) {
        const link = document.createElement('link');
        link.id = styleId;
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Poppins:wght@400;600;700;800&display=swap';
        document.head.appendChild(link);

        const customStyle = document.createElement('style');
        customStyle.id = 'dermai-typography-global';
        customStyle.textContent = `
          body, html, #root, input, button, select, textarea {
            font-family: "Plus Jakarta Sans", "Poppins", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }
          [dir="auto"], div, span, p {
            font-family: "Plus Jakarta Sans", "Poppins", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          }
        `;
        document.head.appendChild(customStyle);
      }
    }
  }, []);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  // Auth state listener -> routing
  useEffect(() => {
    let mounted = true;

    // Initial check
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      await handleRoute(session?.user ?? null);
      setReady(true);
    });

    // Realtime auth change listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;
      await handleRoute(session?.user ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleRoute(user: any) {
    const seg = segmentsRef.current as string[];
    const inAuth = seg[0] === '(auth)';
    const inLogin = seg[1] === 'login';
    const onRegister = seg[1] === 'register';
    const onSubscription = seg[1] === 'subscription-choice';
    const inCallback = seg[0] === 'auth' && seg[1] === 'callback';
    const inAuthArea = inAuth || inCallback;

    // On Web: if OAuth tokens or code are present in the URL, don't kick user to login!
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
      const hasAuthTokens =
        window.location.hash.includes('access_token=') ||
        window.location.search.includes('code=') ||
        window.location.hash.includes('error=');
      if (hasAuthTokens && !inCallback) {
        // Forward to auth callback route to let AuthCallback handle session exchange
        router.replace(`/auth/callback${window.location.search}${window.location.hash}` as any);
        return;
      }
    }

    if (!user) {
      if (!inLogin && !onRegister && !inCallback) {
        router.replace('/(auth)/login');
      }
      return;
    }

    try {
      const { data: profile } = await supabase
        .from('user')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      const googleName = user.user_metadata?.full_name || user.user_metadata?.name;

      if (!profile || !profile.full_name || profile.full_name.trim() === '') {
        if (googleName && googleName.trim() !== '') {
          // Auto-sync Google user profile to DB
          try {
            await savePatientAccount({
              id: user.id,
              fullName: googleName.trim(),
              email: user.email || '',
              profileImage: user.user_metadata?.avatar_url || user.user_metadata?.picture,
              createdAt: new Date().toISOString(),
            });
            if (inAuthArea && !onSubscription) {
              router.replace('/(app)');
              return;
            }
          } catch (e) {
            console.warn('[RootLayout] Auto-sync profile notice:', e);
          }
        }
        if (!onRegister) router.replace('/(auth)/register');
      } else {
        if (inAuthArea && !onSubscription) router.replace('/(app)');
      }
    } catch {
      if (inAuthArea && !onSubscription && !onRegister) router.replace('/(app)');
    }
  }

  if (!ready || (!fontsLoaded && Platform.OS !== 'web')) {
    return <DashboardSkeleton statusMessage="Signing you in..." />;
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
        <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style="dark" />
    </View>
  );
}
