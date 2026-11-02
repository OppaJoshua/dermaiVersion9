import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Image,
  StatusBar,
  Animated,
  Easing,
} from 'react-native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Stop, Rect } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useRouter, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, CEBU_DISTRICTS } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import {
  getCurrentUser,
  getSkinHistory,
  getAppointments,
  getUserSubscription,
  savePatientAccount,
  clearCurrentUser,
  uploadProfileImage,
} from '@/lib/store';
import type { PatientAccount, SubscriptionRecord } from '@/lib/store';

export default function ProfileScreen() {
  const router = useRouter();
  const [user, setUser] = useState<PatientAccount | null>(null);
  const [scanCount, setScanCount] = useState<number>(0);
  const [apptCount, setApptCount] = useState<number>(0);
  const [sub, setSub] = useState<SubscriptionRecord | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    dateOfBirth: '',
    gender: '',
    district: '',
    address: '',
  });
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const hasLoadedRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      loadData(true);
    }, [])
  );

  // Realtime sync with Supabase `user` table so Web <-> Mobile profile changes reflect immediately
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`profile-sync-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          loadData(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  async function loadData(forceRefresh = false) {
    if (!hasLoadedRef.current) setLoadingData(true);
    try {
      const u = await getCurrentUser(forceRefresh);
      setUser(u);
      if (!u) {
        setLoadingData(false);
        return;
      }
      setForm({
        fullName: u.fullName ?? '',
        phone: u.phone ?? '',
        dateOfBirth: u.dateOfBirth ?? '',
        gender: u.gender ?? '',
        district: u.district ?? '',
        address: u.address ?? '',
      });
      hasLoadedRef.current = true;
      setLoadingData(false);

      // Load counts and subscription in the background so the screen renders immediately
      Promise.all([
        getSkinHistory(u.id),
        getAppointments(u.id),
        getUserSubscription(u.id),
      ])
        .then(([history, appts, s]) => {
          setScanCount(history.length);
          setApptCount(appts.length);
          setSub(s);
        })
        .catch(() => {});
    } catch (err: any) {
      console.warn('[Profile] Failed to load data:', err?.message);
      setLoadingData(false);
    }
  }

  async function handleSave() {
    if (!user) return;
    if (!form.fullName.trim()) {
      Alert.alert('Required Field', 'Please enter your full name.');
      return;
    }
    setSaving(true);
    try {
      const updated: PatientAccount = {
        ...user,
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        dateOfBirth: form.dateOfBirth,
        gender: form.gender,
        district: form.district,
        address: form.address.trim(),
      };
      await savePatientAccount(updated);
      const freshUser = await getCurrentUser(true);
      setUser(freshUser ?? updated);
      setEditing(false);
      Alert.alert('Profile Saved', 'Your personal information has been synced with your account.');
    } catch (err: any) {
      console.error('[Profile] Save error:', err?.message);
      Alert.alert('Error', err?.message ?? 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  }

  async function handlePickImage() {
    Alert.alert('Update Profile Photo', 'Choose an option', [
      { text: 'Take Photo with Camera', onPress: () => pickImageAction(true) },
      { text: 'Choose from Gallery', onPress: () => pickImageAction(false) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function pickImageAction(useCamera: boolean) {
    if (!user) return;
    const { status } = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Please enable camera/photo permissions in settings.');
      return;
    }

    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
      base64: true,
    };
    const result = useCamera
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);

    if (result.canceled || !result.assets[0]?.uri) return;

    try {
      const asset = result.assets[0];
      const dataUri = asset.base64
        ? `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`
        : asset.uri;
      const publicUrl = await uploadProfileImage(user.id, dataUri);
      const updated: PatientAccount = { ...user, profileImage: publicUrl };
      await savePatientAccount(updated);
      const freshUser = await getCurrentUser(true);
      setUser(freshUser ?? updated);
    } catch (err: any) {
      console.error('[Profile] Image upload error:', err?.message);
      Alert.alert('Upload Failed', err?.message ?? 'Could not upload image. Try again.');
    }
  }

  async function handleRemoveImage() {
    if (!user) return;
    const updated: PatientAccount = { ...user, profileImage: '' };
    await savePatientAccount(updated);
    setUser({ ...user, profileImage: undefined });
  }

  async function handleLogout() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out of DermAI?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try {
            await clearCurrentUser();
            router.replace('/(auth)/login');
          } catch (err: any) {
            console.error('[Profile] Logout error:', err?.message);
            Alert.alert('Logout Failed', err?.message ?? 'Could not sign out. Try again.');
          }
        },
      },
    ]);
  }

  const isPremium = sub?.plan === 'premium' || sub?.plan === 'pro' || sub?.scanLimit === -1;

  if (!loadingData && !user) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.guestContainer}>
          <View style={styles.guestIconCircle}>
            <Ionicons name="person-outline" size={44} color={COLORS.primary} />
          </View>
          <Text style={styles.guestTitle}>No Account Logged In</Text>
          <Text style={styles.guestSub}>
            Sign in to view your scan history, appointments, and personal profile.
          </Text>
          <TouchableOpacity style={styles.guestBtn} onPress={() => router.replace('/(auth)/login')}>
            <Text style={styles.guestBtnTxt}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const initials = (user?.fullName || 'P')
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />

      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* ══════════════════════════════════════════════════════════
            TOP CURVED HERO HEADER (Matches Reference Structure)
           ══════════════════════════════════════════════════════════ */}
        <View style={styles.heroBanner}>
          {/* Animated Moving Gradient & Curved Wave Background */}
          <MovingHeroGradient />

          {/* Top Navigation Row: Back Arrow (Left) · Profile (Center) · Settings Gear (Right) */}
          <View style={styles.heroNavRow}>
            <TouchableOpacity
              onPress={() => (router.canGoBack() ? router.back() : router.push('/(app)'))}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.heroNavBtn}
            >
              <Ionicons name="arrow-back" size={22} color="#ffffff" />
            </TouchableOpacity>

            <Text style={styles.heroNavTitle}>Profile</Text>

            <TouchableOpacity
              onPress={() => router.push('/(app)/settings')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.heroNavBtn}
            >
              <Ionicons name="settings-sharp" size={21} color="#ffffff" />
            </TouchableOpacity>
          </View>

          {/* Centered Circular Avatar with White Ring Border */}
          <TouchableOpacity
            onPress={handlePickImage}
            activeOpacity={0.85}
            style={styles.heroAvatarWrap}
          >
            {user?.profileImage ? (
              <Image source={{ uri: user.profileImage }} style={styles.heroAvatarImg} />
            ) : (
              <View style={styles.heroAvatarFallback}>
                <Text style={styles.heroAvatarInitials}>{initials}</Text>
              </View>
            )}
            <View style={styles.heroCameraBadge}>
              <Ionicons name="camera" size={12} color={COLORS.primary} />
            </View>
          </TouchableOpacity>

          {user?.profileImage ? (
            <TouchableOpacity onPress={handleRemoveImage} style={styles.removePhotoLink}>
              <Text style={styles.removePhotoLinkTxt}>Remove photo</Text>
            </TouchableOpacity>
          ) : null}

          {/* Centered User Name & Role/Plan Subtitle */}
          <Text style={styles.heroUserName} numberOfLines={1}>
            {user?.fullName || 'Patient'}
          </Text>
          <Text style={styles.heroUserRole}>
            {isPremium ? 'Premium Plan Member' : 'Free Plan Patient'}
          </Text>

          {/* 2-Column Inline Stats Row with Center Divider (Like "1000 Followers | 1200 Following") */}
          <View style={styles.heroStatsBar}>
            <TouchableOpacity
              style={styles.heroStatCol}
              activeOpacity={0.8}
              onPress={() => router.push('/(app)/history')}
            >
              <Text style={styles.heroStatNumber}>{scanCount}</Text>
              <Text style={styles.heroStatLabel}>Skin Scans</Text>
            </TouchableOpacity>

            <View style={styles.heroStatDivider} />

            <TouchableOpacity
              style={styles.heroStatCol}
              activeOpacity={0.8}
              onPress={() => router.push('/(app)/appointments')}
            >
              <Text style={styles.heroStatNumber}>{apptCount}</Text>
              <Text style={styles.heroStatLabel}>Appointments</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ══════════════════════════════════════════════════════════
            CLEAN WHITE BODY LIST (Icon + Stacked Label & Value + Divider)
           ══════════════════════════════════════════════════════════ */}
        <View style={styles.listBody}>
          {/* Edit Profile Action Row */}
          <View style={styles.listTopActionsRow}>
            <Text style={styles.listSectionHint}>Personal Information</Text>
            <TouchableOpacity
              style={styles.editPillBtn}
              onPress={() => setEditing(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="pencil" size={12} color={COLORS.primary} />
              <Text style={styles.editPillBtnTxt}>Edit Details</Text>
            </TouchableOpacity>
          </View>

          <ProfileDetailItem
            icon="mail-outline"
            label="Email"
            value={user?.email || 'Not set'}
          />

          <ProfileDetailItem
            icon="phone-portrait-outline"
            label="Mobile"
            value={user?.phone || 'Not set'}
          />

          <ProfileDetailItem
            icon="calendar-outline"
            label="Date of Birth"
            value={user?.dateOfBirth || 'Not set'}
          />

          <ProfileDetailItem
            icon="person-outline"
            label="Gender"
            value={user?.gender || 'Not set'}
          />

          <ProfileDetailItem
            icon="location-outline"
            label="City / District"
            value={(user as any)?.district || 'Not set'}
          />

          <ProfileDetailItem
            icon="home-outline"
            label="Home Address"
            value={user?.address || 'Not set'}
          />

          <ProfileDetailItem
            icon="star-outline"
            label="Subscription Plan"
            value={isPremium ? 'DermAI Premium Plan (Active)' : 'Free Tier Plan'}
            onPress={() =>
              router.push({ pathname: '/(app)/subscription', params: { from: 'profile' } })
            }
          />

          <ProfileDetailItem
            icon="settings-outline"
            label="Settings & Preferences"
            value="Notifications, support & account controls"
            onPress={() => router.push('/(app)/settings')}
          />

          {/* Sign Out Row */}
          <TouchableOpacity
            style={styles.signOutRow}
            onPress={handleLogout}
            activeOpacity={0.75}
          >
            <View style={styles.detailIconCol}>
              <Ionicons name="log-out-outline" size={21} color="#dc2626" />
            </View>
            <View style={styles.detailTextCol}>
              <Text style={[styles.detailLabel, { color: '#ef4444' }]}>Account Session</Text>
              <Text style={[styles.detailValue, { color: '#dc2626', fontWeight: '700' }]}>
                Sign Out of DermAI
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Edit modal */}
      <EditModal
        visible={editing}
        form={form}
        saving={saving}
        onChange={(field, val) => setForm((p) => ({ ...p, [field]: val }))}
        onSave={handleSave}
        onClose={() => setEditing(false)}
      />
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────
// Animated Seamless Moving Gradient Hero Background
// ─────────────────────────────────────────────────────────
function MovingHeroGradient() {
  const shiftAnim = useRef(new Animated.Value(0)).current;
  const crossfadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const useNative = Platform.OS !== 'web';

    const shiftLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(shiftAnim, {
          toValue: 1,
          duration: 3800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: useNative,
        }),
        Animated.timing(shiftAnim, {
          toValue: 0,
          duration: 3800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: useNative,
        }),
      ])
    );

    const crossfadeLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(crossfadeAnim, {
          toValue: 1,
          duration: 3000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: useNative,
        }),
        Animated.timing(crossfadeAnim, {
          toValue: 0,
          duration: 3000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: useNative,
        }),
      ])
    );

    shiftLoop.start();
    crossfadeLoop.start();

    return () => {
      shiftLoop.stop();
      crossfadeLoop.stop();
    };
  }, [shiftAnim, crossfadeAnim]);

  const bgTranslateX = shiftAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-220, 0],
  });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* Sliding Multi-Stop Linear Gradient Layer */}
      <Animated.View
        style={[
          styles.movingGradientStrip,
          { transform: [{ translateX: bgTranslateX }] },
        ]}
      >
        <Svg width="100%" height="100%" viewBox="0 0 800 400" preserveAspectRatio="none">
          <Defs>
            <SvgLinearGradient id="heroMovingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor="#5c0b33" />
              <Stop offset="22%" stopColor="#85134a" />
              <Stop offset="48%" stopColor="#d12679" />
              <Stop offset="74%" stopColor="#85134a" />
              <Stop offset="100%" stopColor="#5c0b33" />
            </SvgLinearGradient>
          </Defs>
          <Rect x="0" y="0" width="800" height="400" fill="url(#heroMovingGrad)" />
        </Svg>
      </Animated.View>

      {/* Smooth Crossfading Opposite-Angle Gradient Layer (No Circles) */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { opacity: crossfadeAnim },
        ]}
      >
        <Svg width="100%" height="100%" viewBox="0 0 400 400" preserveAspectRatio="none">
          <Defs>
            <SvgLinearGradient id="heroCrossGrad" x1="100%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor="#d92b7f" stopOpacity="0.65" />
              <Stop offset="50%" stopColor="#A0195A" stopOpacity="0.35" />
              <Stop offset="100%" stopColor="#5c0b33" stopOpacity="0.7" />
            </SvgLinearGradient>
          </Defs>
          <Rect x="0" y="0" width="400" height="400" fill="url(#heroCrossGrad)" />
        </Svg>
      </Animated.View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// Clean Stacked Detail Item (Matches Reference Image Rows)
// ─────────────────────────────────────────────────────────
function ProfileDetailItem({
  icon,
  label,
  value,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  onPress?: () => void;
}) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      style={styles.detailRow}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.detailIconCol}>
        <Ionicons name={icon} size={21} color="#6b7280" />
      </View>
      <View style={styles.detailTextCol}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value}</Text>
      </View>
      {onPress ? (
        <Ionicons name="chevron-forward" size={16} color="#cbd5e1" style={{ marginTop: 4 }} />
      ) : null}
    </Wrapper>
  );
}

function EditModal({
  visible,
  form,
  saving,
  onChange,
  onSave,
  onClose,
}: {
  visible: boolean;
  form: Record<string, string>;
  saving: boolean;
  onChange: (field: string, val: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const [districtOpen, setDistrictOpen] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say'];

  const dobDate = form.dateOfBirth ? new Date(form.dateOfBirth) : new Date(2000, 0, 1);

  function handleDateChange(event: DateTimePickerEvent, selected?: Date) {
    setShowDatePicker(Platform.OS === 'ios');
    if (event.type === 'set' && selected) {
      const iso = selected.toISOString().split('T')[0];
      onChange('dateOfBirth', iso);
    }
  }

  function formatDOB(iso: string) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    if (!y || !m || !d) return iso;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Edit Profile</Text>
            <TouchableOpacity onPress={onSave} disabled={saving}>
              <Text style={[styles.modalSave, saving && { opacity: 0.5 }]}>
                {saving ? 'Saving…' : 'Save'}
              </Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            {/* Full Name */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Full Name *</Text>
              <TextInput
                style={styles.formInput}
                placeholder="Juan Dela Cruz"
                placeholderTextColor={COLORS.textLight}
                value={form.fullName}
                onChangeText={(val) => onChange('fullName', val)}
              />
            </View>

            {/* Phone */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Phone Number</Text>
              <TextInput
                style={styles.formInput}
                placeholder="+63 9XX XXX XXXX"
                placeholderTextColor={COLORS.textLight}
                value={form.phone}
                onChangeText={(val) => onChange('phone', val)}
                keyboardType="phone-pad"
              />
            </View>

            {/* Date of Birth */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Date of Birth</Text>
              <TouchableOpacity
                style={styles.dropdownBtn}
                onPress={() => setShowDatePicker(true)}
              >
                <Text style={form.dateOfBirth ? styles.dropdownTxt : styles.dropdownTxtPlaceholder}>
                  {form.dateOfBirth ? formatDOB(form.dateOfBirth) : 'Select birthdate'}
                </Text>
                <Ionicons name="calendar-outline" size={17} color={COLORS.primary} />
              </TouchableOpacity>
              {showDatePicker && (
                <DateTimePicker
                  value={dobDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  maximumDate={new Date()}
                  onChange={handleDateChange}
                />
              )}
            </View>

            {/* Gender Selection */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Gender</Text>
              <View style={styles.genderRow}>
                {GENDERS.map((g) => {
                  const isSelected = form.gender === g;
                  return (
                    <TouchableOpacity
                      key={g}
                      style={[styles.genderChip, isSelected && styles.genderChipSelected]}
                      onPress={() => onChange('gender', g)}
                    >
                      <Text style={[styles.genderChipTxt, isSelected && styles.genderChipTxtSelected]}>
                        {g}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* District Selection */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>City / District (Cebu)</Text>
              <TouchableOpacity
                style={styles.dropdownBtn}
                onPress={() => setDistrictOpen(true)}
              >
                <Text style={form.district ? styles.dropdownTxt : styles.dropdownTxtPlaceholder}>
                  {form.district || 'Select district'}
                </Text>
                <Ionicons name="chevron-down" size={16} color="#64748b" />
              </TouchableOpacity>
            </View>

            {/* Address */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Home Address</Text>
              <TextInput
                style={[styles.formInput, styles.textArea]}
                placeholder="Street address, barangay, city"
                placeholderTextColor={COLORS.textLight}
                value={form.address}
                onChangeText={(val) => onChange('address', val)}
                multiline
                numberOfLines={3}
              />
            </View>
          </ScrollView>

          {/* District Picker Modal */}
          <Modal visible={districtOpen} transparent animationType="fade">
            <TouchableOpacity
              style={styles.modalBackdrop}
              activeOpacity={1}
              onPress={() => setDistrictOpen(false)}
            >
              <View style={styles.districtCard}>
                <Text style={styles.districtTitle}>Select City / District</Text>
                <ScrollView style={{ maxHeight: 300 }}>
                  {CEBU_DISTRICTS.map((d) => (
                    <TouchableOpacity
                      key={d}
                      style={[styles.districtItem, form.district === d && styles.districtItemActive]}
                      onPress={() => {
                        onChange('district', d);
                        setDistrictOpen(false);
                      }}
                    >
                      <Text style={[styles.districtItemTxt, form.district === d && styles.districtItemTxtActive]}>
                        {d}
                      </Text>
                      {form.district === d && (
                        <Ionicons name="checkmark" size={16} color={COLORS.primary} />
                      )}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </TouchableOpacity>
          </Modal>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },
  container: { flex: 1, backgroundColor: '#ffffff' },
  scrollContent: { paddingBottom: 36 },

  // ── Top Curved Hero Header (Reference Image Structure) ──
  heroBanner: {
    backgroundColor: COLORS.primary, // #85134a
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    paddingTop: 14,
    paddingBottom: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 5,
  },
  movingGradientStrip: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '220%',
    height: '100%',
  },
  heroNavRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  heroNavBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroNavTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.2,
  },

  // Centered Circular Avatar
  heroAvatarWrap: {
    position: 'relative',
    marginBottom: 12,
  },
  heroAvatarImg: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3.5,
    borderColor: '#ffffff',
  },
  heroAvatarFallback: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 3.5,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroAvatarInitials: {
    fontSize: 32,
    fontWeight: '800',
    color: '#ffffff',
  },
  heroCameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  removePhotoLink: {
    marginTop: -4,
    marginBottom: 6,
  },
  removePhotoLinkTxt: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.85)',
    textDecorationLine: 'underline',
  },

  // Centered Name & Subtitle
  heroUserName: {
    fontSize: 19,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
  },
  heroUserRole: {
    fontSize: 12.5,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.82)',
    marginTop: 3,
    textAlign: 'center',
  },

  // 2-Column Inline Stats Bar inside Hero Banner
  heroStatsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    width: '100%',
  },
  heroStatCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 6,
  },
  heroStatNumber: {
    fontSize: 16,
    fontWeight: '800',
    color: '#ffffff',
  },
  heroStatLabel: {
    fontSize: 12.5,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.82)',
  },
  heroStatDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
  },

  // ── Clean White List Body (Reference Image List Structure) ──
  listBody: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 22,
    paddingTop: 18,
  },
  listTopActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  listSectionHint: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  editPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: COLORS.primaryXLight,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
  },
  editPillBtnTxt: {
    fontSize: 11.5,
    fontWeight: '700',
    color: COLORS.primary,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  detailIconCol: {
    width: 34,
    paddingTop: 2,
    alignItems: 'flex-start',
  },
  detailTextCol: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 12,
    color: '#9ca3af',
    fontWeight: '500',
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 14.5,
    color: '#1f2937',
    fontWeight: '600',
  },
  signOutRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 16,
    marginTop: 4,
  },

  // Guest State
  guestContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  guestIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  guestTitle: { fontSize: 19, fontWeight: '800', color: COLORS.text },
  guestSub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 6,
  },
  guestBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 18,
  },
  guestBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Edit Modal
  modalSafe: { flex: 1, backgroundColor: '#ffffff' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  modalCancel: { fontSize: 14, color: '#64748b', fontWeight: '600' },
  modalTitle: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  modalSave: { fontSize: 14, color: COLORS.primary, fontWeight: '700' },
  modalContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },
  formGroup: { marginBottom: 14 },
  formLabel: { fontSize: 12, fontWeight: '700', color: '#334155', marginBottom: 6 },
  formInput: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0f172a',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  textArea: { height: 80, textAlignVertical: 'top', paddingTop: 10 },
  dropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  dropdownTxt: { fontSize: 14, color: '#0f172a' },
  dropdownTxtPlaceholder: { fontSize: 14, color: '#94a3b8' },
  genderRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  genderChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  genderChipSelected: {
    backgroundColor: COLORS.primaryXLight,
    borderColor: COLORS.primary,
  },
  genderChipTxt: { fontSize: 12, color: '#475569', fontWeight: '600' },
  genderChipTxtSelected: { color: COLORS.primary, fontWeight: '700' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  districtCard: { backgroundColor: '#fff', borderRadius: 20, padding: 18, maxHeight: '80%' },
  districtTitle: { fontSize: 15, fontWeight: '800', color: COLORS.text, marginBottom: 12 },
  districtItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  districtItemActive: { backgroundColor: COLORS.primaryXLight },
  districtItemTxt: { fontSize: 13, color: '#1e293b', fontWeight: '500' },
  districtItemTxtActive: { color: COLORS.primary, fontWeight: '700' },
});
