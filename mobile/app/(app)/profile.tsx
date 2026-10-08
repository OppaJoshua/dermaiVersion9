import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useRouter, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, CEBU_DISTRICTS } from '@/lib/constants';
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
  const [scanCount, setScanCount] = useState(0);
  const [apptCount, setApptCount] = useState(0);
  const [sub, setSub] = useState<SubscriptionRecord | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ fullName: '', phone: '', dateOfBirth: '', gender: '', district: '', address: '' });
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(true);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  async function loadData() {
    setLoadingData(true);
    try {
      const u = await getCurrentUser();
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
        district: (u as any).district ?? '',
        address: u.address ?? '',
      });
      const history = await getSkinHistory(u.id);
      setScanCount(history.length);
      const appts = await getAppointments(u.id);
      setApptCount(appts.length);
      const s = await getUserSubscription(u.id);
      setSub(s);
    } catch (err: any) {
      console.warn('[Profile] Failed to load data:', err?.message);
      Alert.alert('Connection Issue', 'Some data may be outdated. Check your internet connection.');
    } finally {
      setLoadingData(false);
    }
  }

  async function handleSave() {
    if (!user) return;
    if (!form.fullName.trim()) {
      Alert.alert('Name Required', 'Full name cannot be empty.');
      return;
    }
    setSaving(true);
    try {
      const updated: PatientAccount = {
        ...user,
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        dateOfBirth: form.dateOfBirth.trim(),
        gender: form.gender.trim(),
        district: form.district.trim(),
        address: form.address.trim(),
      } as any;
      await savePatientAccount(updated);
      setUser(updated);
      setEditing(false);
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (err: any) {
      console.error('[Profile] Save error:', err?.message);
      Alert.alert('Save Failed', err?.message ?? 'Could not save profile. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handlePickImage() {
    Alert.alert('Profile Picture', 'Choose a source', [
      {
        text: 'Camera',
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) {
            Alert.alert('Permission Denied', 'Camera access is required.');
            return;
          }
          const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.7,
          });
          if (!result.canceled && result.assets[0]) {
            saveProfileImage(result.assets[0]);
          }
        },
      },
      {
        text: 'Gallery',
        onPress: async () => {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) {
            Alert.alert('Permission Denied', 'Photo library access is required.');
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.7,
          });
          if (!result.canceled && result.assets[0]) {
            saveProfileImage(result.assets[0]);
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function saveProfileImage(asset: ImagePicker.ImagePickerAsset) {
    if (!user) return;
    try {
      Alert.alert('Uploading', 'Uploading your profile picture...');
      const downloadURL = await uploadProfileImage(user.id, asset.uri);
      const updated: PatientAccount = { ...user, profileImage: downloadURL };
      await savePatientAccount(updated);
      setUser(updated);
      Alert.alert('Success', 'Profile picture uploaded!');
    } catch (err: any) {
      console.error('[Profile] Image upload error:', err?.message);
      Alert.alert('Upload Failed', err?.message ?? 'Could not upload image. Try again.');
    }
  }

  async function handleRemoveImage() {
    if (!user) return;
    const updated: PatientAccount = { ...user, profileImage: undefined };
    await savePatientAccount(updated);
    setUser(updated);
  }

  async function handleLogout() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try {
            console.log('[Profile] Starting logout...');
            await clearCurrentUser();
            console.log('[Profile] Cleared user, waiting for auth state update...');
            await new Promise(resolve => setTimeout(resolve, 500));
            console.log('[Profile] Navigating to login');
            router.replace('/(auth)/login');
          } catch (err: any) {
            console.error('[Profile] Logout error:', err?.message);
            Alert.alert('Logout Failed', err?.message ?? 'Could not sign out. Try again.');
          }
        },
      },
    ]);
  }

  const isPremium = sub?.plan === 'premium';

  if (loadingData) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // Guest / not logged in
  if (!user) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.guestContainer}>
          <View style={styles.guestIconCircle}>
            <Ionicons name="person-outline" size={48} color={COLORS.primary} />
          </View>
          <Text style={styles.guestTitle}>No Account Yet</Text>
          <Text style={styles.guestSub}>Sign in or create an account to view and manage your profile.</Text>
          <TouchableOpacity style={styles.guestBtn} onPress={() => router.replace('/(auth)/login')}>
            <Text style={styles.guestBtnTxt}>Sign In</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.guestBtnOutline} onPress={() => router.replace('/(auth)/register')}>
            <Text style={styles.guestBtnOutlineTxt}>Create Account</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>

        {/* ── Header (matches Home header pattern) ── */}
        <View style={styles.topHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerWelcome}>Your Profile</Text>
            <Text style={styles.headerName}>Account</Text>
          </View>
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.push('/(app)/settings')}>
            <Ionicons name="settings-outline" size={20} color={COLORS.text} />
          </TouchableOpacity>
        </View>

        {/* ── Avatar block ── */}
        <View style={styles.profileHeader}>
          <TouchableOpacity onPress={handlePickImage} activeOpacity={0.7}>
            {user.profileImage ? (
              <Image source={{ uri: user.profileImage }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarTxt}>
                  {user.fullName
                    .split(' ')
                    .slice(0, 2)
                    .map((n) => n[0])
                    .join('')
                    .toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.avatarOverlay}>
              <Ionicons name="camera" size={14} color={COLORS.primary} />
            </View>
          </TouchableOpacity>
          {user.profileImage && (
            <TouchableOpacity onPress={handleRemoveImage} style={styles.removeImgBtn}>
              <Text style={styles.removeImgTxt}>Remove Photo</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.userName}>{user.fullName}</Text>
          <Text style={styles.userEmail}>{user.email}</Text>
          <View style={[styles.planBadge, isPremium && styles.planBadgePremium]}>
            <Ionicons
              name={isPremium ? 'star' : 'person'}
              size={14}
              color={isPremium ? '#fff' : COLORS.textSecondary}
              style={{ marginRight: 5 }}
            />
            <Text style={[styles.planBadgeTxt, isPremium && styles.planBadgeTxtPremium]}>
              {isPremium ? 'Premium' : 'Free Plan'}
            </Text>
          </View>
        </View>

        {/* ── Stats (colorful grid like Home's Overview) ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Your Activity</Text>
        </View>
        <View style={styles.statsGrid}>
          <View style={[styles.statCard, { backgroundColor: COLORS.primary }]}>
            <View style={styles.statIconWrap}>
              <Ionicons name="scan-outline" size={18} color={COLORS.primary} />
            </View>
            <Text style={styles.statValue}>{scanCount}</Text>
            <Text style={styles.statLabel}>Scans</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#2563eb' }]}>
            <View style={[styles.statIconWrap, { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
              <Ionicons name="calendar-outline" size={18} color="#fff" />
            </View>
            <Text style={styles.statValue}>{apptCount}</Text>
            <Text style={styles.statLabel}>Appointments</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#7c3aed' }]}>
            <View style={[styles.statIconWrap, { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
              <Ionicons name="time-outline" size={18} color="#fff" />
            </View>
            <Text style={[styles.statValue, { fontSize: 14 }]}>
              {new Date(user.createdAt).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })}
            </Text>
            <Text style={styles.statLabel}>Member Since</Text>
          </View>
        </View>

        {/* ── Personal info (shadowed card, matches listCard pattern) ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Personal Information</Text>
          <TouchableOpacity onPress={() => setEditing(true)}>
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.card}>
          <InfoRow label="Full Name" value={user.fullName} />
          <InfoRow label="Email" value={user.email} />
          <InfoRow label="Phone" value={user.phone || 'Not set'} />
          <InfoRow label="Date of Birth" value={user.dateOfBirth || 'Not set'} />
          <InfoRow label="Gender" value={user.gender || 'Not set'} />
          <InfoRow label="District" value={(user as any).district || 'Not set'} />
          <InfoRow label="Address" value={user.address || 'Not set'} last />
        </View>

        {/* ── Account menu (matches Home's listCard icon-wrap pattern) ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Account</Text>
        </View>
        <View style={styles.menuCard}>
          <MenuRow
            icon="star"
            iconColor={COLORS.warning}
            label="Subscription Plan"
            value={isPremium ? 'Premium' : 'Free'}
            onPress={() => router.push('/(app)/subscription')}
          />
          <MenuRow
            icon="medkit-outline"
            iconColor="#16a34a"
            label="Find Clinics"
            onPress={() => router.push('/(app)/clinics')}
          />
          <MenuRow
            icon="notifications-outline"
            iconColor="#2563eb"
            label="Notifications"
            onPress={() => router.push('/(app)/notifications')}
          />
          <MenuRow
            icon="settings-outline"
            iconColor={COLORS.textSecondary}
            label="Settings"
            onPress={() => router.push('/(app)/settings')}
            last
          />
        </View>

        {/* ── Logout ── */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={18} color={COLORS.danger} style={{ marginRight: 8 }} />
          <Text style={styles.logoutTxt}>Sign Out</Text>
        </TouchableOpacity>

        <View style={{ height: 32 }} />
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

function InfoRow({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.infoRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function MenuRow({
  icon,
  iconColor,
  label,
  value,
  onPress,
  last,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconColor?: string;
  label: string;
  value?: string;
  onPress?: () => void;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.menuRow, last && { borderBottomWidth: 0 }]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={[styles.menuIconWrap, { backgroundColor: (iconColor ?? COLORS.primary) + '15' }]}>
        <Ionicons name={icon} size={18} color={iconColor ?? COLORS.primary} />
      </View>
      <Text style={styles.menuLabel}>{label}</Text>
      <View style={styles.menuRight}>
        {value && <Text style={styles.menuValue}>{value}</Text>}
        <Ionicons name="chevron-forward" size={16} color={COLORS.textLight} />
      </View>
    </TouchableOpacity>
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
  const [genderOpen, setGenderOpen] = useState(false);
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
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
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
            {[
              { field: 'fullName', label: 'Full Name *', placeholder: 'Juan Dela Cruz' },
              { field: 'phone', label: 'Phone Number', placeholder: '+63 9XX XXX XXXX', keyboard: 'phone-pad' },
            ].map((f) => (
              <View key={f.field} style={styles.formGroup}>
                <Text style={styles.formLabel}>{f.label}</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder={f.placeholder}
                  placeholderTextColor={COLORS.textLight}
                  value={form[f.field]}
                  onChangeText={(v) => onChange(f.field, v)}
                  keyboardType={(f as any).keyboard ?? 'default'}
                  autoCapitalize={f.field === 'fullName' ? 'words' : 'none'}
                />
              </View>
            ))}

            {/* Date of Birth picker */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Date of Birth</Text>
              <TouchableOpacity
                style={styles.formInput}
                onPress={() => setShowDatePicker(true)}
                activeOpacity={0.7}
              >
                <Text style={form.dateOfBirth ? { color: COLORS.text, fontSize: 15 } : { color: COLORS.textLight, fontSize: 15 }}>
                  {form.dateOfBirth ? formatDOB(form.dateOfBirth) : 'Select date of birth'}
                </Text>
                <Ionicons name="calendar-outline" size={18} color={COLORS.textSecondary} style={{ marginLeft: 'auto' }} />
              </TouchableOpacity>
              {showDatePicker && (
                <DateTimePicker
                  value={dobDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'calendar'}
                  maximumDate={new Date()}
                  onChange={handleDateChange}
                />
              )}
            </View>

            {/* Gender picker */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Gender</Text>
              <TouchableOpacity
                style={styles.formInput}
                onPress={() => setGenderOpen(true)}
                activeOpacity={0.7}
              >
                <Text style={form.gender ? { color: COLORS.text, fontSize: 15, flex: 1 } : { color: COLORS.textLight, fontSize: 15, flex: 1 }}>
                  {form.gender || 'Select gender…'}
                </Text>
                <Ionicons name="chevron-down" size={16} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* District picker */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>District</Text>
              <TouchableOpacity
                style={styles.formInput}
                onPress={() => setDistrictOpen(true)}
                activeOpacity={0.7}
              >
                <Text style={[
                  { flex: 1 },
                  form.district ? { color: COLORS.text } : { color: COLORS.textLight },
                ]}>
                  {form.district || 'Select district…'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Address</Text>
              <TextInput
                style={styles.formInput}
                placeholder="123 Street, City, Province"
                placeholderTextColor={COLORS.textLight}
                value={form.address}
                onChangeText={(v) => onChange('address', v)}
                autoCapitalize="words"
              />
            </View>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>

      {/* Gender selection modal */}
      <Modal visible={genderOpen} animationType="slide" transparent>
        <View style={styles.districtOverlay}>
          <View style={styles.districtSheet}>
            <View style={styles.districtHeader}>
              <Text style={styles.districtTitle}>Select Gender</Text>
              <TouchableOpacity onPress={() => setGenderOpen(false)}>
                <Text style={styles.districtClose}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {GENDERS.map((g) => (
                <TouchableOpacity
                  key={g}
                  style={[styles.districtItem, form.gender === g && styles.districtItemActive]}
                  onPress={() => { onChange('gender', g); setGenderOpen(false); }}
                >
                  <Text style={[styles.districtItemTxt, form.gender === g && styles.districtItemTxtActive]}>{g}</Text>
                  {form.gender === g && <Ionicons name="checkmark" size={18} color={COLORS.primary} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* District selection modal */}
      <Modal visible={districtOpen} animationType="slide" transparent>
        <View style={styles.districtOverlay}>
          <View style={styles.districtSheet}>
            <View style={styles.districtHeader}>
              <Text style={styles.districtTitle}>Select District</Text>
              <TouchableOpacity onPress={() => setDistrictOpen(false)}>
                <Text style={styles.districtClose}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {CEBU_DISTRICTS.map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[
                    styles.districtItem,
                    form.district === d && styles.districtItemActive,
                  ]}
                  onPress={() => {
                    onChange('district', d);
                    setDistrictOpen(false);
                  }}
                >
                  <Text style={[
                    styles.districtItemTxt,
                    form.district === d && styles.districtItemTxtActive,
                  ]}>{d}</Text>
                  {form.district === d && (
                    <Ionicons name="checkmark" size={18} color={COLORS.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, backgroundColor: '#F7F8FA' },

  // ── Top header (matches Home) ──
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    backgroundColor: '#fff',
  },
  headerWelcome: { fontSize: 11, color: COLORS.textSecondary, letterSpacing: 0.2 },
  headerName: { fontSize: 20, fontWeight: '800', color: COLORS.text, marginTop: 2 },
  iconBtn: {
    width: 40,
    height: 40,
    backgroundColor: '#F5F6FA',
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Avatar block ──
  profileHeader: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 20,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  avatarImg: {
    width: 84,
    height: 84,
    borderRadius: 42,
    marginBottom: 12,
  },
  avatarOverlay: {
    position: 'absolute',
    bottom: 8,
    right: -4,
    backgroundColor: '#fff',
    borderRadius: 14,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  removeImgBtn: { marginBottom: 6 },
  removeImgTxt: { color: COLORS.danger, fontSize: 12, fontWeight: '600' },
  avatarTxt: { color: '#fff', fontSize: 28, fontWeight: '700' },
  userName: { fontSize: 20, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  userEmail: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 12 },
  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 7,
    backgroundColor: '#F5F6FA',
    borderRadius: 999,
  },
  planBadgePremium: { backgroundColor: COLORS.primary },
  planBadgeTxt: { fontSize: 12, color: COLORS.textSecondary, fontWeight: '700' },
  planBadgeTxtPremium: { color: '#fff' },

  // ── Section header (matches Home) ──
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 20,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  editLink: { color: COLORS.primary, fontWeight: '700', fontSize: 13 },

  // ── Stats grid (matches Home's overviewGrid) ──
  statsGrid: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
  },
  statCard: {
    flex: 1,
    borderRadius: 18,
    padding: 14,
    minHeight: 96,
    justifyContent: 'flex-end',
  },
  statIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  statValue: { color: '#fff', fontSize: 20, fontWeight: '800' },
  statLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: '600', marginTop: 2 },

  // ── Cards (matches Home's listCard pattern) ──
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    marginHorizontal: 20,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F6FA',
  },
  infoLabel: { fontSize: 13, color: COLORS.textSecondary, flex: 1 },
  infoValue: { fontSize: 13, color: COLORS.text, fontWeight: '600', flex: 2, textAlign: 'right' },

  menuCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    marginHorizontal: 20,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F6FA',
    gap: 12,
  },
  menuIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLabel: { flex: 1, fontSize: 14, color: COLORS.text, fontWeight: '600' },
  menuRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  menuValue: { fontSize: 13, color: COLORS.textSecondary },

  // ── Logout ──
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 15,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  logoutTxt: { color: COLORS.danger, fontWeight: '700', fontSize: 15 },

  // ── Guest state ──
  guestContainer: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32, gap: 12,
  },
  guestIconCircle: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: COLORS.primaryLight ?? '#e6f4ea',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  guestTitle: { fontSize: 22, fontWeight: '700', color: COLORS.text, textAlign: 'center' },
  guestSub: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 21, marginBottom: 8 },
  guestBtn: {
    backgroundColor: COLORS.primary, borderRadius: 16,
    paddingVertical: 15, paddingHorizontal: 48, alignSelf: 'stretch', alignItems: 'center',
  },
  guestBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  guestBtnOutline: {
    backgroundColor: COLORS.primaryLight ?? '#e6f4ea', borderRadius: 16,
    paddingVertical: 15, paddingHorizontal: 48, alignSelf: 'stretch', alignItems: 'center',
  },
  guestBtnOutlineTxt: { color: COLORS.primary, fontWeight: '700', fontSize: 15 },

  // ── Modal (unchanged structurally, restyled for consistency) ──
  modalSafe: { flex: 1, backgroundColor: '#F7F8FA' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#fff',
  },
  modalCancel: { color: COLORS.textSecondary, fontSize: 15 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  modalSave: { color: COLORS.primary, fontWeight: '700', fontSize: 15 },
  modalContent: { padding: 20, gap: 4 },
  formGroup: { marginBottom: 14 },
  formLabel: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 6 },
  formInput: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.text,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  districtOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  districtSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '60%',
    paddingBottom: 24,
  },
  districtHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F6FA',
  },
  districtTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  districtClose: { fontSize: 15, fontWeight: '700', color: COLORS.primary },
  districtItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F6FA',
  },
  districtItemActive: { backgroundColor: COLORS.primaryLight ?? '#e6f4ea' },
  districtItemTxt: { fontSize: 15, color: COLORS.text },
  districtItemTxtActive: { color: COLORS.primary, fontWeight: '600' },
});