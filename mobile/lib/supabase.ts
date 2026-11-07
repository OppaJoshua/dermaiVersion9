import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://yxteeadjgavejpiriewj.supabase.co';
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4dGVlYWRqZ2F2ZWpwaXJpZXdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3NDk3ODMsImV4cCI6MjEwNjMyNTc4M30.TPUZmI5UWAreJ_LveivQY-PFbxjX638HPE9Nfut-w90';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

export function parseAuthUrlParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!url) return params;
  const queryStart = url.indexOf('?');
  const hashStart = url.indexOf('#');

  const parseSegment = (str: string) => {
    str.split('&').forEach((pair) => {
      const eqIdx = pair.indexOf('=');
      if (eqIdx !== -1) {
        try {
          const key = decodeURIComponent(pair.slice(0, eqIdx));
          const val = decodeURIComponent(pair.slice(eqIdx + 1).replace(/\+/g, ' '));
          if (key) params[key] = val;
        } catch {
          const key = pair.slice(0, eqIdx);
          const val = pair.slice(eqIdx + 1);
          if (key) params[key] = val;
        }
      }
    });
  };

  if (hashStart !== -1) {
    parseSegment(url.substring(hashStart + 1));
  }
  if (queryStart !== -1) {
    const end = hashStart !== -1 && hashStart > queryStart ? hashStart : url.length;
    parseSegment(url.substring(queryStart + 1, end));
  }
  return params;
}

/**
 * Returns a redacted summary of a callback URL safe for console logging.
 * Never exposes access_token, refresh_token, authorization code, or PKCE verifiers.
 */
export function summarizeAuthCallbackUrl(url: string): string {
  if (!url) return '(empty)';
  const base = url.split('?')[0].split('#')[0];
  const params = parseAuthUrlParams(url);
  const flags = [
    params.code ? 'hasCode=true' : null,
    params.access_token ? 'hasAccessToken=true' : null,
    params.refresh_token ? 'hasRefreshToken=true' : null,
    params.error ? `error=${params.error}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return `${base}${flags ? ` (${flags})` : ''}`;
}

export interface OAuthCallbackResult {
  user: any | null;
  errorMessage?: string;
}

const processedTokensOrCodes = new Set<string>();
let inFlightCallbackPromise: Promise<OAuthCallbackResult> | null = null;

/**
 * Shared single-flight OAuth callback processor used by both LoginScreen and AuthCallback
 * so deep-link listeners, WebBrowser.openAuthSessionAsync, and Expo Router's /auth/callback
 * route never double-exchange the same authorization code or token pair.
 */
export async function processMobileOAuthCallbackUrl(url: string): Promise<OAuthCallbackResult> {
  if (!url) return { user: null };

  const params = parseAuthUrlParams(url);
  console.log('[Google Auth] Stage: received callback', summarizeAuthCallbackUrl(url));

  if (params.error || params.error_description) {
    const errorMessage = params.error_description || params.error || 'Google authentication failed.';
    console.warn('[Google Auth] Stage: OAuth provider returned error:', errorMessage);
    return { user: null, errorMessage };
  }

  // If another caller (e.g., LoginScreen vs AuthCallback) is already exchanging, await the same promise
  if (inFlightCallbackPromise) {
    console.log('[Google Auth] Stage: awaiting in-flight callback exchange');
    return await inFlightCallbackPromise;
  }

  const dedupeKey = params.code
    ? `code:${params.code}`
    : params.access_token
    ? `token:${params.access_token.slice(-16)}`
    : null;

  if (dedupeKey && processedTokensOrCodes.has(dedupeKey)) {
    console.log('[Google Auth] Stage: callback already processed, reading existing session');
    const { data: sessionData } = await supabase.auth.getSession();
    return { user: sessionData?.session?.user ?? null };
  }

  inFlightCallbackPromise = (async (): Promise<OAuthCallbackResult> => {
    try {
      if (params.access_token && params.refresh_token) {
        if (dedupeKey) processedTokensOrCodes.add(dedupeKey);
        console.log('[Google Auth] Stage: establishing session from OAuth tokens');
        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token,
        });
        if (sessionError) {
          console.warn('[Google Auth] Stage: setSession failed:', sessionError.message);
          return { user: null, errorMessage: sessionError.message || 'Could not establish session.' };
        }
        if (sessionData?.user) {
          console.log('[Google Auth] Stage: session established for userId:', sessionData.user.id);
          return { user: sessionData.user };
        }
      }

      if (params.code) {
        if (dedupeKey) processedTokensOrCodes.add(dedupeKey);
        console.log('[Google Auth] Stage: exchanging authorization code for session');
        const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(params.code);
        if (exchangeError) {
          // Check if session was already established before reporting error
          const { data: fallbackSession } = await supabase.auth.getSession();
          if (fallbackSession?.session?.user) {
            console.log('[Google Auth] Stage: session already active for userId:', fallbackSession.session.user.id);
            return { user: fallbackSession.session.user };
          }
          console.warn('[Google Auth] Stage: exchangeCodeForSession failed:', exchangeError.message);
          return { user: null, errorMessage: exchangeError.message || 'Could not exchange authorization code.' };
        }
        if (exchangeData?.user) {
          console.log('[Google Auth] Stage: code exchange succeeded for userId:', exchangeData.user.id);
          return { user: exchangeData.user };
        }
      }

      const { data: currentSession } = await supabase.auth.getSession();
      if (currentSession?.session?.user) {
        console.log('[Google Auth] Stage: active session confirmed for userId:', currentSession.session.user.id);
        return { user: currentSession.session.user };
      }

      return { user: null };
    } catch (err: any) {
      const msg = err?.message || 'Unexpected error during Google authentication.';
      console.warn('[Google Auth] Stage: callback exception:', msg);
      return { user: null, errorMessage: msg };
    } finally {
      inFlightCallbackPromise = null;
    }
  })();

  return await inFlightCallbackPromise;
}
