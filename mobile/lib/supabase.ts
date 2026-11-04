import { createClient } from '@supabase/supabase-js';
import { Platform } from './platform';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://yxteeadjgavejpiriewj.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_6RCNdjeWob47-D3UMGR8xw_YHvWVPf7';

function getStorage() {
  if (typeof window !== 'undefined' || Boolean((globalThis as any).nativeCallSyncHook)) {
    try {
      const asyncStorageModule = '@react-native-async-storage/async-storage';
      const mod = require(asyncStorageModule);
      return mod.default || mod;
    } catch {}
  }
  return {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  };
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: getStorage(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
    flowType: 'pkce',
  },
});
