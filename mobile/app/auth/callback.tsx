import DashboardSkeleton from '@/components/DashboardSkeleton';
import { useEffect } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { supabase, processMobileOAuthCallbackUrl } from '@/lib/supabase';
import { savePatientAccount, verifyMobilePatientAccess } from '@/lib/store';

function syncGooglePatientProfileInBackground(user: any) {
  if (!user?.id) return;
  const displayName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split('@')[0] ||
    'Patient';

  setTimeout(() => {
    void savePatientAccount({
      id: user.id,
      fullName: displayName,
      email: user.email || '',
      profileImage: user.user_metadata?.avatar_url || user.user_metadata?.picture || undefined,
      createdAt: new Date().toISOString(),
    }).catch((err: any) => {
      console.warn('[AuthCallback] Stage: profile sync notice:', err?.message);
    });
  }, 0);
}

export default function AuthCallback() {
  const router = useRouter();
  const searchParams = useLocalSearchParams();

  useEffect(() => {
    let handled = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const completeSignIn = async (user: any) => {
      if (handled || !user) return;
      handled = true;
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }

      const accessCheck = await verifyMobilePatientAccess(user);
      if (!accessCheck.allowed) {
        console.warn('[AuthCallback] Stage: blocked non-patient role on mobile:', accessCheck.role);
        await supabase.auth.signOut().catch(() => {});
        router.replace('/(auth)/login');
        return;
      }

      console.log('[AuthCallback] Stage: session active for user:', user.id);
      syncGooglePatientProfileInBackground(user);
      router.replace('/(app)');
    };

    // Non-blocking listener so @supabase/auth-js _notifyAllSubscribers never stalls
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user && !handled) {
        completeSignIn(session.user);
      }
    });

    const urlSubscription = Linking.addEventListener('url', async (event) => {
      if (handled || !event?.url) return;
      console.log('[AuthCallback] Stage: callback deep link event received');
      const result = await processMobileOAuthCallbackUrl(event.url);
      if (result.user) {
        completeSignIn(result.user);
      }
    });

    async function handleAuth() {
      if (handled) return;

      try {
        // 1. Check web location first when running on web
        if (typeof window !== 'undefined' && window.location?.href) {
          const webResult = await processMobileOAuthCallbackUrl(window.location.href);
          if (webResult.errorMessage) {
            handled = true;
            Alert.alert('Google Sign-In Error', webResult.errorMessage);
            router.replace('/(auth)/login');
            return;
          }
          if (webResult.user) {
            completeSignIn(webResult.user);
            return;
          }
        }

        // 2. Check full deep link URL from Linking (contains hash or query parameters)
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl) {
          const linkResult = await processMobileOAuthCallbackUrl(initialUrl);
          if (linkResult.errorMessage) {
            handled = true;
            Alert.alert('Google Sign-In Error', linkResult.errorMessage);
            router.replace('/(auth)/login');
            return;
          }
          if (linkResult.user) {
            completeSignIn(linkResult.user);
            return;
          }
        }

        // 3. Check local search params parsed by expo-router (if deep link path stripped full URL)
        const code = typeof searchParams.code === 'string' ? searchParams.code : undefined;
        const accessToken =
          typeof searchParams.access_token === 'string' ? searchParams.access_token : undefined;
        const refreshToken =
          typeof searchParams.refresh_token === 'string' ? searchParams.refresh_token : undefined;
        const errorParam =
          typeof searchParams.error_description === 'string'
            ? searchParams.error_description
            : typeof searchParams.error === 'string'
            ? searchParams.error
            : undefined;

        if (code || (accessToken && refreshToken) || errorParam) {
          const syntheticQuery = new URLSearchParams();
          if (code) syntheticQuery.set('code', code);
          if (accessToken) syntheticQuery.set('access_token', accessToken);
          if (refreshToken) syntheticQuery.set('refresh_token', refreshToken);
          if (errorParam) syntheticQuery.set('error_description', errorParam);
          const paramResult = await processMobileOAuthCallbackUrl(
            `dermaimobile://auth/callback?${syntheticQuery.toString()}`
          );
          if (paramResult.errorMessage) {
            handled = true;
            Alert.alert('Google Sign-In Error', paramResult.errorMessage);
            router.replace('/(auth)/login');
            return;
          }
          if (paramResult.user) {
            completeSignIn(paramResult.user);
            return;
          }
        }

        // 4. Fallback: check if LoginScreen already established the session in AsyncStorage
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.user) {
          completeSignIn(sessionData.session.user);
          return;
        }

        // 5. Bounded timeout so callback screen never hangs indefinitely on "Signing you in..."
        fallbackTimer = setTimeout(async () => {
          if (handled) return;
          const { data: retryData } = await supabase.auth.getSession();
          if (retryData?.session?.user) {
            completeSignIn(retryData.session.user);
          } else {
            handled = true;
            console.warn('[AuthCallback] Stage: no session established within timeout; returning to login');
            router.replace('/(auth)/login');
          }
        }, 2500);
      } catch (err: any) {
        console.warn('[AuthCallback] Stage: callback exception:', err?.message || 'Unknown error');
        if (!handled) {
          handled = true;
          router.replace('/(auth)/login');
        }
      }
    }

    void handleAuth();

    return () => {
      if (fallbackTimer) clearTimeout(fallbackTimer);
      subscription.unsubscribe();
      urlSubscription.remove();
    };
  }, []);

  return <DashboardSkeleton statusMessage="Signing you in..." />;
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
