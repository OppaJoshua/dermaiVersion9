import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import 'react-native-reanimated';
import { Platform, StatusBar as RNStatusBar, View, ActivityIndicator } from 'react-native';
import { supabase } from '@/lib/supabase';
import { savePatientAccount } from '@/lib/store';

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const segmentsRef = useRef(segments);
  const [ready, setReady] = useState(false);

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

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fdf2f8' }}>
        <ActivityIndicator size="large" color="#be185d" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight ?? 0 : 0 }}>
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
        <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style="dark" />
    </View>
  );
}
