// Safe Platform detection for Expo, React Native, Web, and Node test environments
const isWeb = typeof window !== 'undefined' && !Boolean((globalThis as any).nativeCallSyncHook);
export const Platform = {
  OS: (isWeb ? 'web' : 'android') as 'web' | 'android' | 'ios',
  select: <T>(specifics: { [platform: string]: T | undefined; default?: T }): T => {
    const key = isWeb ? 'web' : 'default';
    return (key in specifics ? specifics[key] : specifics.default) as T;
  },
};
