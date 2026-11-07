import { Tabs } from 'expo-router';
import { View, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

function ScanIcon({ focused }: { focused: boolean }) {
  return (
    <View
      style={{
        width: 54,
        height: 54,
        borderRadius: 27,
        backgroundColor: focused ? COLORS.primaryDark : COLORS.primary,
        alignItems: 'center',
        justifyContent: 'center',
        top: Platform.OS === 'web' ? -12 : -14,
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
        elevation: 6,
        borderWidth: 3,
        borderColor: '#ffffff',
      }}
    >
      <Ionicons name="camera" size={24} color="#ffffff" />
    </View>
  );
}

const HIDDEN_TAB_OPTIONS = {
  tabBarButton: () => null,
  tabBarItemStyle: { display: 'none' as const, width: 0 },
};

export default function AppLayout() {
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const isIOS = Platform.OS === 'ios';

  const bottomPadding = isWeb ? 8 : (isIOS ? Math.max(insets.bottom, 16) : Math.max(insets.bottom, 10));
  const tabHeight = isWeb ? 60 : 54 + bottomPadding;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: '#64748b',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#f1f5f9',
          borderTopWidth: 1,
          height: tabHeight,
          paddingBottom: bottomPadding,
          paddingTop: 6,
          overflow: 'visible',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.04,
          shadowRadius: 8,
          elevation: 4,
        },
        tabBarItemStyle: {
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 4,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={24} color={color as any} />
          ),
        }}
      />
      <Tabs.Screen
        name="clinics"
        options={{
          title: 'Find Clinic',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'location' : 'location-outline'} size={24} color={color as any} />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarIcon: ({ focused }) => <ScanIcon focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="appointments"
        options={{
          title: 'Appointments',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={24} color={color as any} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'clipboard' : 'clipboard-outline'} size={24} color={color as any} />
          ),
        }}
      />
      {/* Hidden from tab bar but accessible via navigation */}
      <Tabs.Screen name="profile" options={HIDDEN_TAB_OPTIONS} />
      <Tabs.Screen name="subscription" options={HIDDEN_TAB_OPTIONS} />
      <Tabs.Screen name="notifications" options={HIDDEN_TAB_OPTIONS} />
      <Tabs.Screen name="library" options={HIDDEN_TAB_OPTIONS} />
      <Tabs.Screen name="settings" options={HIDDEN_TAB_OPTIONS} />
      <Tabs.Screen name="billing" options={HIDDEN_TAB_OPTIONS} />
    </Tabs>
  );
}
