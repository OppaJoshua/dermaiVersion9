import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, CEBU_DISTRICTS } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import { initializeNewUser } from '@/lib/store';

const GENDERS = ['Male', 'Female', 'Prefer not to say'] as const;
type Gender = typeof GENDERS[number];

export default function RegisterScreen() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [location, setLocation] = useState('');
  const [showDistricts, setShowDistricts] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!fullName.trim()) { Alert.alert('Missing field', 'Please enter your full name.'); return; }
    if (!phone.trim()) { Alert.alert('Missing field', 'Please enter your phone number.'); return; }
    if (!age.trim() || isNaN(Number(age)) || Number(age) < 1) {
      Alert.alert('Missing field', 'Please enter a valid age.'); return;
    }
    if (!gender) { Alert.alert('Missing field', 'Please select your gender.'); return; }
    if (!location) { Alert.alert('Missing field', 'Please select your location.'); return; }
    if (!termsAccepted) { Alert.alert('Terms required', 'Please accept the terms to continue.'); return; }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { Alert.alert('Session error', 'Please sign in again.'); return; }

    setLoading(true);
    try {
      console.log('[Register] Submitting profile for:', user.id);
      const profile = {
        id: user.id,
        fullName: fullName.trim(),
        email: user.email ?? '',
        phone: phone.trim(),
        age: Number(age),
        gender,
        location,
        createdAt: new Date().toISOString(),
      };
      await initializeNewUser(profile, {
        id: user.id,
        fullName: fullName.trim(),
        email: user.email ?? '',
        role: 'user',
        plan: 'free',
        status: 'active',
        createdAt: new Date().toISOString(),
      });
      console.log('[Register] initializeNewUser complete for:', user.id);
      router.replace('/(auth)/subscription-choice');
    } catch (err: any) {
      console.error('[Register] Failed to save/register profile:', err?.code, err?.message ?? err);
      Alert.alert('Error', err?.message ?? 'Could not save profile. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Header ── */}
          <View style={styles.headerBlock}>
            <View style={styles.iconCircle}>
              <Ionicons name="person-outline" size={28} color={COLORS.primary} />
            </View>
            <Text style={styles.title}>Complete Your Profile</Text>
            <Text style={styles.subtitle}>Tell us a bit about yourself to personalize your experience</Text>
          </View>

          {/* ── Personal Info Section ── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Personal Information</Text>

            <Text style={styles.fieldLabel}>Full Name</Text>
            <View style={styles.inputOuter}>
              <View style={styles.inputWrap}>
                <Ionicons name="person-outline" size={18} color={COLORS.textSecondary} />
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Maria Santos"
                  placeholderTextColor={COLORS.textLight}
                  value={fullName}
                  onChangeText={setFullName}
                />
              </View>
            </View>

            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Phone Number</Text>
            <View style={styles.inputOuter}>
              <View style={styles.inputWrap}>
                <Ionicons name="call-outline" size={18} color={COLORS.textSecondary} />
                <TextInput
                  style={styles.input}
                  placeholder="+63 9XX XXX XXXX"
                  placeholderTextColor={COLORS.textLight}
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Age</Text>
                <View style={styles.inputOuter}>
                  <View style={styles.inputWrap}>
                    <TextInput
                      style={styles.input}
                      placeholder="25"
                      placeholderTextColor={COLORS.textLight}
                      value={age}
                      onChangeText={setAge}
                      keyboardType="numeric"
                      maxLength={3}
                    />
                  </View>
                </View>
              </View>
            </View>

            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Gender</Text>
            <View style={styles.optionRow}>
              {GENDERS.map((g) => (
                <TouchableOpacity
                  key={g}
                  style={[styles.option, gender === g && styles.optionSelected]}
                  onPress={() => setGender(g)}
                >
                  <Text style={[styles.optionText, gender === g && styles.optionTextSelected]}>
                    {g}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* ── Location Section ── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Location</Text>
            <Text style={styles.fieldLabel}>District (Cebu)</Text>
            <View style={styles.inputOuter}>
              <TouchableOpacity
                style={styles.selectorWrap}
                onPress={() => setShowDistricts((v) => !v)}
                activeOpacity={0.8}
              >
                <Ionicons name="location-outline" size={18} color={COLORS.textSecondary} />
                <Text style={[styles.selectorText, !location && styles.placeholderText]}>
                  {location || 'Select your district'}
                </Text>
                <Ionicons
                  name={showDistricts ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={COLORS.textSecondary}
                />
              </TouchableOpacity>
            </View>
            {showDistricts && (
              <View style={styles.dropdown}>
                <ScrollView nestedScrollEnabled style={{ maxHeight: 220 }}>
                  {CEBU_DISTRICTS.map((d) => (
                    <TouchableOpacity
                      key={d}
                      style={[styles.dropdownItem, location === d && styles.dropdownItemSelected]}
                      onPress={() => { setLocation(d); setShowDistricts(false); }}
                    >
                      <Text style={[styles.dropdownText, location === d && styles.dropdownTextSelected]}>
                        {d}
                      </Text>
                      {location === d && <Ionicons name="checkmark" size={16} color={COLORS.primary} />}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>

          {/* ── Terms ── */}
          <TouchableOpacity
            style={styles.termsRow}
            onPress={() => setTermsAccepted((v) => !v)}
            activeOpacity={0.8}
          >
            <View style={[styles.checkbox, termsAccepted && styles.checkboxChecked]}>
              {termsAccepted && <Ionicons name="checkmark" size={14} color="#fff" />}
            </View>
            <Text style={styles.termsText}>
              I agree to the{' '}
              <Text style={styles.link}>Terms of Service</Text> and{' '}
              <Text style={styles.link}>Privacy Policy</Text>
            </Text>
          </TouchableOpacity>

          {/* ── Submit ── */}
          <TouchableOpacity
            style={[styles.submitBtn, loading && styles.btnDisabled]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitBtnText}>Continue</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F8FA' },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 48,
  },

  // ── Header ──
  headerBlock: { alignItems: 'center', marginBottom: 28 },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primaryLight ?? '#e6f4ea',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.text, textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 19, paddingHorizontal: 12 },

  // ── Section ──
  section: { marginBottom: 22 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: COLORS.text, marginBottom: 14 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8 },

  // ── Inputs (matches login pattern: outer shadow / inner clip) ──
  inputOuter: {
    borderRadius: 16,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 4,
    minHeight: 52,
    overflow: 'hidden',
  },
  input: { flex: 1, paddingVertical: 14, fontSize: 15, color: COLORS.text },

  selectorWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    justifyContent: 'space-between',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  selectorText: { flex: 1, fontSize: 15, color: COLORS.text },
  placeholderText: { color: COLORS.textLight },

  dropdown: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginTop: 8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  dropdownItem: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#F5F6FA',
  },
  dropdownItemSelected: { backgroundColor: COLORS.primaryLight ?? '#e6f4ea' },
  dropdownText: { fontSize: 14, color: COLORS.text },
  dropdownTextSelected: { fontWeight: '700', color: COLORS.primary },

  // ── Gender options ──
  optionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  option: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  optionSelected: { backgroundColor: COLORS.primary },
  optionText: { fontSize: 13, color: COLORS.text, fontWeight: '500' },
  optionTextSelected: { color: '#fff', fontWeight: '700' },

  // ── Terms ──
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 24 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  checkboxChecked: { backgroundColor: COLORS.primary },
  termsText: { flex: 1, fontSize: 13, color: COLORS.textSecondary, lineHeight: 20 },
  link: { color: COLORS.primary, fontWeight: '600', textDecorationLine: 'underline' },

  // ── Submit ──
  submitBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.55 },
});