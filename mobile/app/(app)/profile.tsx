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
    } finally {
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
        phone: form.phone.trim() || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        gender: (form.gender as any) || undefined,
        address: form.address.trim() || undefined,
      };
      (updated as any).district = form.district || undefined;
      await savePatientAccount(updated);
      setUser(updated);
      setEditing(false);
      Alert.alert('Profile Saved', 'Your personal information has been updated.');
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
      quality: 0.8,
    };
    const result = useCamera
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);

    if (result.canceled || !result.assets[0]?.uri) return;

    try {
      const publicUrl = await uploadProfileImage(user.id, result.assets[0].uri);
      const updated: PatientAccount = { ...user, profileImage: publicUrl };
      await savePatientAccount(updated);
      setUser(updated);
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

  if (loadingData) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.guestContainer}>
          <View style={styles.guestIconCircle}>
            <Ionicons name="person-outline" size={48} color={COLORS.primary} />
          </View>
          <Text style={styles.guestTitle}>No Account Logged In</Text>
          <Text style={styles.guestSub}>Sign in to view your scan history, appointments, and personal profile.</Text>
          <TouchableOpacity style={styles.guestBtn} onPress={() => router.replace('/(auth)/login')}>
            <Text style={styles.guestBtnTxt}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const memberSinceYear = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : 'Active';

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Top Header ── */}
      <View style={styles.topHeader}>
        <View style={styles.topHeaderAvatarCircle}>
          <Ionicons name="person" size={20} color={COLORS.primary} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.headerWelcome}>Patient Account</Text>
          <Text style={styles.headerName}>Your Profile</Text>
        </View>
        <TouchableOpacity style={styles.settingsIconBtn} onPress={() => router.push('/(app)/settings')}>
          <Ionicons name="settings-outline" size={20} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.container} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>
        {/* ── Avatar Profile Card ── */}
        <View style={styles.profileCard}>
          <TouchableOpacity onPress={handlePickImage} activeOpacity={0.8} style={styles.avatarWrap}>
            {user.profileImage ? (
              <Image source={{ uri: user.profileImage }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatarFallback}>
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
            <View style={styles.avatarCameraBadge}>
              <Ionicons name="camera" size={13} color="#fff" />
            </View>
          </TouchableOpacity>

          {user.profileImage && (
            <TouchableOpacity onPress={handleRemoveImage} style={styles.removeImgBtn}>
              <Text style={styles.removeImgTxt}>Remove Photo</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.userName}>{user.fullName}</Text>
          <Text style={styles.userEmail}>{user.email}</Text>

          <View style={[styles.planBadge, isPremium ? styles.planBadgePremium : styles.planBadgeFree]}>
            <Ionicons
              name={isPremium ? 'star' : 'shield-outline'}
              size={13}
              color={isPremium ? COLORS.primary : '#64748b'}
              style={{ marginRight: 5 }}
            />
            <Text style={[styles.planBadgeTxt, isPremium ? styles.planBadgeTxtPremium : styles.planBadgeTxtFree]}>
              {isPremium ? 'Premium Plan Member' : 'Free Plan Tier'}
            </Text>
          </View>
        </View>

        {/* ── Activity Statistics (Matching DermAI Magenta Overview Palette) ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Your Health Activity</Text>
        </View>
        <View style={styles.statsRow}>
          {/* Card 1: Scans */}
          <View style={styles.statCard}>
            <View style={styles.cardCornerCircle} />
            <View style={styles.statIconWrap}>
              <Ionicons name="scan-outline" size={17} color="#fff" />
            </View>
            <Text style={styles.statValue}>{scanCount}</Text>
            <Text style={styles.statLabel}>Skin Scans</Text>
          </View>

          {/* Card 2: Consultations */}
          <View style={styles.statCard}>
            <View style={styles.cardCornerCircle} />
            <View style={styles.statIconWrap}>
              <Ionicons name="calendar-outline" size={17} color="#fff" />
            </View>
            <Text style={styles.statValue}>{apptCount}</Text>
            <Text style={styles.statLabel}>Appointments</Text>
          </View>

          {/* Card 3: Member Since */}
          <View style={styles.statCard}>
            <View style={styles.cardCornerCircle} />
            <View style={styles.statIconWrap}>
              <Ionicons name="time-outline" size={17} color="#fff" />
            </View>
            <Text style={[styles.statValue, { fontSize: 13 }]}>{memberSinceYear}</Text>
            <Text style={styles.statLabel}>Member Since</Text>
          </View>
        </View>

        {/* ── Personal Details Card ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Personal Details</Text>
          <TouchableOpacity style={styles.editBtn} onPress={() => setEditing(true)}>
            <Ionicons name="pencil" size={12} color={COLORS.primary} />
            <Text style={styles.editBtnTxt}>Edit</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.card}>
          <InfoRow label="Full Name" value={user.fullName} />
          <InfoRow label="Email Address" value={user.email} />
          <InfoRow label="Phone Number" value={user.phone || 'Not set'} />
          <InfoRow label="Date of Birth" value={user.dateOfBirth || 'Not set'} />
          <InfoRow label="Gender" value={user.gender || 'Not set'} />
          <InfoRow label="City / District" value={(user as any).district || 'Not set'} />
          <InfoRow label="Home Address" value={user.address || 'Not set'} last />
        </View>

        {/* ── Services & Account Menu ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Account &amp; Services</Text>
        </View>
        <View style={styles.card}>
          <MenuRow
            icon="star-outline"
            label="Subscription &amp; Plans"
            value={isPremium ? 'Active' : 'Free'}
            onPress={() => router.push({ pathname: '/(app)/subscription', params: { from: 'profile' } })}
          />
          <MenuRow
            icon="calendar-outline"
            label="Consultations &amp; Appointments"
            value={`${apptCount} visits`}
            onPress={() => router.push('/(app)/appointments')}
          />
          <MenuRow
            icon="scan-outline"
            label="Skin Scan History"
            value={`${scanCount} scans`}
            onPress={() => router.push('/(app)/history')}
          />
          <MenuRow
            icon="business-outline"
            label="Dermatology Clinics"
            onPress={() => router.push('/(app)/clinics')}
          />
          <MenuRow
            icon="settings-outline"
            label="Preferences &amp; Settings"
            onPress={() => router.push('/(app)/settings')}
            last
          />
        </View>

        {/* ── Sign Out Button ── */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={18} color="#dc2626" />
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
  label,
  value,
  onPress,
  last,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
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
      activeOpacity={0.7}
    >
      <View style={styles.menuIconWrap}>
        <Ionicons name={icon} size={18} color={COLORS.primary} />
      </View>
      <Text style={styles.menuLabel}>{label}</Text>
      <View style={styles.menuRight}>
        {value && <Text style={styles.menuValue}>{value}</Text>}
        <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
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
            <Text style={styles.modalTitle}>Edit Personal Details</Text>
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
  safe: { flex: 1, backgroundColor: '#F8FAFC' },
  container: { flex: 1 },

  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  topHeaderAvatarCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#fce7f3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerWelcome: { fontSize: 11, color: COLORS.textSecondary, letterSpacing: 0.2 },
  headerName: { fontSize: 19, fontWeight: '800', color: COLORS.text },
  settingsIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },

  // Profile Card
  profileCard: {
    backgroundColor: '#fff',
    borderRadius: 22,
    marginHorizontal: 16,
    marginTop: 14,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#f1f5f9',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  avatarWrap: { position: 'relative', marginBottom: 10 },
  avatarImg: { width: 84, height: 84, borderRadius: 42, borderWidth: 3, borderColor: '#fce7f3' },
  avatarFallback: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#be185d',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fce7f3',
  },
  avatarTxt: { fontSize: 28, fontWeight: '800', color: '#fff' },
  avatarCameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  removeImgBtn: { marginTop: -4, marginBottom: 8 },
  removeImgTxt: { fontSize: 11, color: '#dc2626', fontWeight: '600' },
  userName: { fontSize: 18, fontWeight: '800', color: COLORS.text, textAlign: 'center' },
  userEmail: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2, textAlign: 'center' },
  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    marginTop: 10,
    borderWidth: 1,
  },
  planBadgePremium: { backgroundColor: '#fdf2f8', borderColor: '#fbcfe8' },
  planBadgeFree: { backgroundColor: '#f8fafc', borderColor: '#e2e8f0' },
  planBadgeTxt: { fontSize: 11, fontWeight: '700' },
  planBadgeTxtPremium: { color: COLORS.primary },
  planBadgeTxtFree: { color: '#64748b' },

  // Stats Row (Consistent Magenta Overview Theme)
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#be185d',
    borderRadius: 16,
    padding: 12,
    alignItems: 'flex-start',
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#be185d',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 3,
  },
  cardCornerCircle: {
    position: 'absolute',
    top: -16,
    right: -16,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  statIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  statValue: { fontSize: 17, fontWeight: '800', color: '#fff' },
  statLabel: { fontSize: 10, fontWeight: '600', color: 'rgba(255, 255, 255, 0.85)', marginTop: 2 },

  // Sections
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#334155', textTransform: 'uppercase', letterSpacing: 0.5 },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#fdf2f8',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  editBtnTxt: { fontSize: 12, fontWeight: '700', color: COLORS.primary },

  // Detail Card
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    marginHorizontal: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  infoLabel: { fontSize: 13, color: '#64748b', fontWeight: '500' },
  infoValue: { fontSize: 13, fontWeight: '700', color: '#1e293b', maxWidth: '60%', textAlign: 'right' },

  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  menuIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#fdf2f8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  menuLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1e293b' },
  menuRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  menuValue: { fontSize: 12, color: '#64748b', fontWeight: '600' },

  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginTop: 22,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: '#fff1f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
  },
  logoutTxt: { fontSize: 14, fontWeight: '700', color: '#dc2626' },

  // Guest State
  guestContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  guestIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#fce7f3',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  guestTitle: { fontSize: 20, fontWeight: '800', color: COLORS.text },
  guestSub: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20, marginTop: 6 },
  guestBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 20,
  },
  guestBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Edit Modal
  modalSafe: { flex: 1, backgroundColor: '#fff' },
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
    backgroundColor: '#F8FAFC',
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
    backgroundColor: '#F8FAFC',
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
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  genderChipSelected: {
    backgroundColor: '#fdf2f8',
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
  districtItemActive: { backgroundColor: '#fdf2f8' },
  districtItemTxt: { fontSize: 13, color: '#1e293b', fontWeight: '500' },
  districtItemTxtActive: { color: COLORS.primary, fontWeight: '700' },
});
