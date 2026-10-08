import { useEffect } from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { supabase } from '@/lib/supabase';
import { savePatientAccount } from '@/lib/store';
import { COLORS } from '@/lib/constants';

function parseParams(url: string): Record<string, string> {
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

  if (hashStart !== -1) parseString(url.substring(hashStart + 1));
  if (queryStart !== -1) {
    const end = hashStart !== -1 && hashStart > queryStart ? hashStart : url.length;
    parseString(url.substring(queryStart + 1, end));
  }
  return params;
}

export default function AuthCallback() {
  const router = useRouter();
  const searchParams = useLocalSearchParams();

  useEffect(() => {
    let handled = false;

    async function handleAuth() {
      if (handled) return;

      try {
        // 1. Check local search params from expo-router
        let code = searchParams.code as string | undefined;
        let accessToken = searchParams.access_token as string | undefined;
        let refreshToken = searchParams.refresh_token as string | undefined;

        // 2. Check full deep link URL from Linking for hash fragments
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl) {
          const parsed = parseParams(initialUrl);
          code = code || parsed.code;
          accessToken = accessToken || parsed.access_token;
          refreshToken = refreshToken || parsed.refresh_token;
        }

        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (!error && data?.user) {
            handled = true;
            await savePatientAccount({
              id: data.user.id,
              fullName: data.user.user_metadata?.full_name || data.user.user_metadata?.name || '',
              email: data.user.email || '',
              profileImage: data.user.user_metadata?.avatar_url || data.user.user_metadata?.picture || undefined,
              createdAt: new Date().toISOString(),
            });
            router.replace('/(app)');
            return;
          }
        }

        if (accessToken && refreshToken) {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (!error && data?.user) {
            handled = true;
            await savePatientAccount({
              id: data.user.id,
              fullName: data.user.user_metadata?.full_name || data.user.user_metadata?.name || '',
              email: data.user.email || '',
              profileImage: data.user.user_metadata?.avatar_url || data.user.user_metadata?.picture || undefined,
              createdAt: new Date().toISOString(),
            });
            router.replace('/(app)');
            return;
          }
        }

        // 3. Fallback: check if session already active
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.user) {
          handled = true;
          await savePatientAccount({
            id: sessionData.session.user.id,
            fullName: sessionData.session.user.user_metadata?.full_name || sessionData.session.user.user_metadata?.name || '',
            email: sessionData.session.user.email || '',
            profileImage: sessionData.session.user.user_metadata?.avatar_url || sessionData.session.user.user_metadata?.picture || undefined,
            createdAt: new Date().toISOString(),
          });
          router.replace('/(app)');
          return;
        }

        // If no auth tokens, return to login smoothly
        router.replace('/(auth)/login');
      } catch (err) {
        console.warn('[AuthCallback] Notice:', err);
        router.replace('/(app)');
      }
    }

    handleAuth();
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={COLORS.primary} />
      <Text style={styles.text}>Signing you in...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  text: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
  },
});
