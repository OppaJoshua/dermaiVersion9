import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import { evaluateDiseaseMapping, normalizeAnswers } from './diseaseMappingService';
import { getConditionGuide } from './conditionGuides';
import { getConditionUUID } from './aiApi';
import { supabase } from './supabase';
import { verifyPayMongoIntentOnce } from './paymongo';
export { supabase };
import { SAMPLE_CLINICS } from './constants';
import { logAuditEvent } from './auditLogger';

// ─── AsyncStorage key for session helpers ─────────────────────────────────────

export const KEYS = {

  EMAIL_FOR_SIGN_IN: 'dermai_email_for_signin',

  PENDING_EMAIL_LINK: 'dermai_pending_email_link',

  PATIENT_ACCOUNTS: 'dermai_patient_accounts',

};



// ─── Types ────────────────────────────────────────────────────────────────────

export interface PatientAccount {

  id: string;

  fullName: string;

  email: string;

  phone?: string;

  age?: number;

  gender?: string;

  location?: string;

  dateOfBirth?: string;

  district?: string;

  address?: string;

  profileImage?: string;

  createdAt: string;

  freeScansUsed?: number;

}



export interface ScanResult {

  id: string;

  userId: string;

  date: string;

  imageUri?: string;

  imageUris?: [string, string];

  answers: Record<string, any>;

  condition: string;

  confidence: number;

  severity: 'mild' | 'moderate' | 'severe';

  category: string;

  description: string;

  symptoms: string[];

  careTips: string[];

  referralSuggested: boolean;

  referralReason?: string;

  localName?: string;

  status: 'pending' | 'validated' | 'flagged' | 'completed';

  secondaryCondition?: string;

  secondaryConfidence?: number;

  isGovernmentReportable?: boolean;

  isCombined?: boolean;

  combinedEvidenceScore?: number;

  patientReportedImpact?: string;

  agreementStatus?: 'aligned' | 'differing' | 'inconclusive' | 'contextual';

  agreementSummary?: string;

  supportingFindings?: string[];

}



export interface Appointment {

  id: string;

  userId: string;

  clinicId?: string | number;

  clinicName: string;

  clinicAddress?: string;

  clinicPhone?: string;

  assignedDoctorId?: string;

  doctorName?: string;

  doctorPhotoUrl?: string;

  doctorPrcLicense?: string;

  specialty?: string;

  consultationType: 'face-to-face';

  conditionId?: string;

  conditionName?: string;

  notes?: string;

  clinicNote?: string;

  patientName?: string;

  patientEmail?: string;

  patientAddress?: string;

  patientContact?: string;

  patientGender?: string;

  patientBirthdate?: string;

  emergencyContactName?: string;

  emergencyContactPhone?: string;

  emergencyContactRelationship?: string;

  primaryScanId?: string;

  paymentStatus?: 'paid' | 'unpaid' | 'refunded';

  paymentReference?: string;

  paymentAmount?: number;

  paidAt?: string;

  paymentMethod?: 'gcash' | 'maya' | string;

  date?: string;

  time?: string;

  batchTime?: string;

  queueNumber?: number;

  checkInStatus?: 'scheduled' | 'arrived' | 'in-consultation' | 'completed';

  doctorStatus?: 'pending-review' | 'approved' | 'rejected';

  status: 'pending' | 'scheduled' | 'rejected' | 'confirmed' | 'completed' | 'cancelled';

  skinPhotoUri?: string;

  createdAt: string;

}



export interface SubscriptionRecord {

  userId: string;

  email: string;

  plan: 'free' | 'basic' | 'pro' | 'premium';

  billingCycle?: 'monthly' | 'yearly';

  startDate?: string;

  endDate?: string;

  transactionId?: string;

  scansUsed?: number;

  scansCountVerified?: boolean;

  scanLimit?: number;

  isDemoAccount?: boolean;

  status?: string;

  cardLast4?: string;

  cardExpiry?: string;

  paymentMethod?: 'gcash' | 'maya' | string;

  mobileNumber?: string;

  statusLabel?: 'Premium Active' | 'Basic Active' | 'No Active Subscription';
  subscriptionId?: string;
  planId?: string;
  planName?: string;
  planDescription?: string;
  planFeatures?: string[];
  cancelAtPeriodEnd?: boolean;
  isExpired?: boolean;
  remainingDays?: number | null;
  basePrice?: number;
  vatAmount?: number;
  totalPrice?: number;
  billingAddress?: string;
  freePlanActive?: boolean;
  freePlanVerified?: boolean;
  freePlanAmbiguous?: boolean;
  freePlanConfiguredLimit?: number;
  freePlanError?: string | null;
}

export interface SubscriptionPlanOption {
  id: string;
  name: string;
  description: string;
  price: number;
  vatAmount: number;
  totalPrice: number;
  billingType: 'monthly' | 'yearly';
  scanLimit: number;
  features: string[];
  status: string;
}

export interface BillingHistoryItem {
  paymentId: string;
  paymentDate: string;
  date: string;
  amount: string;
  rawAmount: number;
  baseAmount: number;
  vatAmount: number;
  totalAmount: number;
  method: string;
  status: string;
  description: string;
  isAppointment: boolean;
  appointmentId?: string | null;
  paymentReference?: string | null;
  paymongoPaymentId?: string | null;
  billingCycle?: 'monthly' | 'yearly';
}

export const VAT_RATE = 0.12;

export function calculatePricing(basePrice: number) {
  const base = Math.round((Number(basePrice) || 0) * 100) / 100;
  const finalAmount = Math.round(base * (1 + VAT_RATE) * 100) / 100;
  const vat = Math.round((finalAmount - base) * 100) / 100;
  return {
    basePrice: base,
    vatAmount: vat,
    totalPrice: finalAmount,
    amountInCentavos: Math.round(finalAmount * 100),
  };
}

export function withVat(net: number): number {
  return calculatePricing(net).totalPrice;
}

export function splitVat(gross: number, knownBase?: number) {
  if (knownBase != null && Number(knownBase) > 0) {
    const calc = calculatePricing(knownBase);
    return { net: calc.basePrice, vat: calc.vatAmount };
  }
  const total = Number(gross) || 0;
  const net = Math.round((total / (1 + VAT_RATE)) * 100) / 100;
  const vat = Math.round((total - net) * 100) / 100;
  return { net, vat };
}



export interface PlatformUser {

  id: string;

  fullName: string;

  email: string;

  role: 'patient' | 'doctor' | 'clinic' | 'admin' | 'user';

  plan: 'free' | 'premium';

  status: 'active' | 'suspended';

  createdAt: string;

}



export interface PlatformScan {

  id: string;

  userId: string;

  userEmail: string;

  date: string;

  condition: string;

  confidence: number;

  severity: string;

  referralSuggested: boolean;

  status: 'pending' | 'validated' | 'flagged';

}



export interface PlatformTransaction {

  id: string;

  userId?: string;

  userEmail: string;

  userName: string;

  plan: string;

  amount: number;

  date: string;

  method?: string;

  billingCycle?: string;

  status: 'paid' | 'completed' | 'refunded';

}



export interface AdminNotificationEntry {

  id: string;

  type: 'clinic-approved' | 'clinic-rejected' | 'new-subscription' | 'new-ticket';

  title: string;

  message: string;

  timestamp: string;

  read: boolean;

  meta?: Record<string, string>;

}



export interface HelpdeskTicket {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  subject: string;
  message: string;
  category?: string;
  status: 'open' | 'in-progress' | 'resolved';
  createdAt: string;
}



export type NotificationCategory =

  | 'appointment'

  | 'broadcast'

  | 'ticket'

  | 'scan'

  | 'subscription'

  | 'system'

  | 'general';



export interface AppNotification {

  id: string;

  userId: string;

  type: string;

  subtype?: string;

  category?: NotificationCategory;

  title: string;

  message: string;

  senderName?: string;

  senderType?: 'clinic' | 'admin' | 'doctor' | 'system' | 'patient';

  senderAvatar?: string | null;

  link?: string;

  timestamp: string;

  read: boolean;

  relatedId?: string;

  metadata?: Record<string, any>;

}



export interface NotifPrefs {

  appointmentReminders: boolean;

  scanResultAlerts: boolean;

}



export interface ClinicDoctor {

  id?: string;

  name: string;

  specialization: string;

  dutyDays?: string[];

  dutyStartTime?: string;

  dutyEndTime?: string;

  dutySchedule?: any;

  avatar_url?: string;

  avatarUrl?: string;

  photo_url?: string;

  userId?: string;

}



export interface ClinicRecord {

  id: string;

  name: string;

  address: string;

  phone: string;

  email?: string;

  facebook?: string;

  hours: string;

  verified: boolean;

  district: string;

  city?: string;

  lat: number;

  lng: number;

  consultationFee: string;

  logoUrl?: string;

  doctors: ClinicDoctor[];

  conditionsTreated: string[];

  description?: string;

  photos?: string[];

  operatingHours?: {

    day_of_week: string;

    open_time: string;

    close_time: string;

  }[];

  defaultSlotIntervalMinutes?: number;

  openTime?: string;

  closeTime?: string;

}



// ─── Auth Functions ───────────────────────────────────────────────────────────

export async function getCurrentUserEmail(): Promise<string | null> {

  const { data: { user } } = await supabase.auth.getUser();

  return user?.email ?? null;

}



export async function clearCurrentUser(): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      logAuditEvent({
        user_id: user.id,
        user_type: 'patient',
        performer_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Patient',
        action: 'User Logout',
        log_type: 'user',
        target: 'Mobile App',
        details: `Patient logged out via mobile app (${user.email || user.id})`,
        metadata: { platform: 'Mobile App' },
      }).catch(() => {});
    }
  } catch (_) {}

  _cachedUser = null;

  try {

    await supabase.auth.signOut();

  } catch (err: any) {

    console.error('[Store] Sign out error:', err?.message);

    throw err;

  }

}



let _cachedUser: { user: PatientAccount; ts: number } | null = null;



export async function getCurrentUser(forceRefresh = false): Promise<PatientAccount | null> {

  try {

    const { data: { session } } = await supabase.auth.getSession();

    let user = session?.user ?? null;

    if (!user) {

      const { data: authData, error: authErr } = await supabase.auth.getUser();

      if (authErr || !authData?.user) {

        _cachedUser = null;

        return null;

      }

      user = authData.user;

    }



    if (!forceRefresh && _cachedUser && _cachedUser.user.id === user.id && Date.now() - _cachedUser.ts < 15000) {

      return _cachedUser.user;

    }



    const meta = user.user_metadata || {};

    const avatarFallback = (meta.avatar_url as string) || (meta.picture as string) || undefined;

    const nameFallback = (meta.full_name as string) || (meta.name as string) || '';



    const { data, error } = await supabase

      .from('user')

      .select('*')

      .eq('user_id', user.id)

      .maybeSingle();



    if (error || !data) {

      return {

        id: user.id,

        fullName: nameFallback,

        email: user.email || '',

        phone: meta.phone || undefined,

        gender: meta.gender || undefined,

        dateOfBirth: meta.birthdate || meta.birthday || undefined,

        district: meta.district || undefined,

        address: meta.address || undefined,

        profileImage: avatarFallback,

        createdAt: user.created_at,

        freeScansUsed: 0,

      };

    }



    const resultUser: PatientAccount = {

      id: data.user_id,

      fullName: data.full_name || nameFallback || '',

      email: data.email || user.email || '',

      phone: data.phone || meta.phone || undefined,

      gender: data.gender || meta.gender || undefined,

      dateOfBirth: data.birthdate || meta.birthdate || meta.birthday || undefined,

      district: data.district || meta.district || undefined,

      address: data.address || meta.address || undefined,

      profileImage: data.avatar_url || avatarFallback,

      createdAt: data.created_at,

      freeScansUsed: data.free_scans_used ?? 0,

    };

    _cachedUser = { user: resultUser, ts: Date.now() };

    return resultUser;

  } catch (err) {

    console.warn('[Store] getCurrentUser exception:', err);

    return null;

  }

}

export interface BlockedRoleNotice {
  role: string;
  email: string;
  message: string;
}

let _pendingBlockedRoleNotice: BlockedRoleNotice | null = null;

export function setBlockedRoleNotice(notice: BlockedRoleNotice | null): void {
  _pendingBlockedRoleNotice = notice;
}

export function consumeBlockedRoleNotice(): BlockedRoleNotice | null {
  const notice = _pendingBlockedRoleNotice;
  _pendingBlockedRoleNotice = null;
  return notice;
}

/**
 * Verifies that an authenticated user is allowed to use the DermAI Patient Mobile App.
 * Blocks `admin`, `clinic`, `doctor`, and `suspended` accounts from signing into Mobile.
 */
export async function verifyMobilePatientAccess(authUser: any): Promise<{
  allowed: boolean;
  role: string;
  reason?: string;
}> {
  if (!authUser?.id) {
    return { allowed: false, role: 'unknown', reason: 'Invalid session.' };
  }

  try {
    const metaRole = String(
      authUser.user_metadata?.role || authUser.app_metadata?.role || ''
    )
      .toLowerCase()
      .trim();

    const { data: existing } = await supabase
      .from('user')
      .select('role, account_status, email')
      .eq('user_id', authUser.id)
      .maybeSingle();

    const dbRole = String(existing?.role || '').toLowerCase().trim();
    const effectiveRole = dbRole || metaRole || 'patient';
    const status = String(existing?.account_status || 'active').toLowerCase().trim();

    if (status === 'suspended' || status === 'banned') {
      const reason =
        'Your DermAI account has been suspended. Please contact DermAI Support for assistance.';
      setBlockedRoleNotice({
        role: effectiveRole,
        email: authUser.email || existing?.email || '',
        message: reason,
      });
      return { allowed: false, role: effectiveRole, reason };
    }

    if (effectiveRole !== 'patient') {
      const roleLabels: Record<string, string> = {
        admin: 'System Administrator',
        clinic: 'Clinic Administrator',
        doctor: 'Dermatologist / Doctor',
      };
      const roleTitle = roleLabels[effectiveRole] || effectiveRole.toUpperCase();
      const reason = `This account (${authUser.email || 'your email'}) is registered as a ${roleTitle}. The DermAI Mobile App is exclusively for Patient accounts. Please sign in to the DermAI Web Portal for ${roleTitle} access, or choose a different Google account.`;
      setBlockedRoleNotice({
        role: effectiveRole,
        email: authUser.email || existing?.email || '',
        message: reason,
      });
      return { allowed: false, role: effectiveRole, reason };
    }

    return { allowed: true, role: 'patient' };
  } catch (err) {
    console.warn('[Store] verifyMobilePatientAccess check warning:', err);
    return { allowed: true, role: 'patient' };
  }
}

export async function savePatientAccount(account: PatientAccount): Promise<void> {

  _cachedUser = null;

  try {

    // 1. Fetch existing user row and auth metadata so we never wipe out fields when logging in

    const { data: existing } = await supabase

      .from('user')

      .select('*')

      .eq('user_id', account.id)

      .maybeSingle();

    const { data: authData } = await supabase.auth.getUser();

    const meta = authData?.user?.user_metadata || {};

    // Never overwrite or downgrade a non-patient account (admin, clinic, doctor) into a patient row
    const existingRole = String(existing?.role || meta.role || '').toLowerCase().trim();
    if (existingRole && existingRole !== 'patient') {
      console.warn(
        `[Store] Blocked savePatientAccount from modifying non-patient role (${existingRole}) for user:`,
        account.id
      );
      return;
    }



    const resolvedFullName = account.fullName !== undefined && account.fullName !== ''

      ? account.fullName

      : (existing?.full_name || meta.full_name || meta.name || 'Patient');



    const resolvedPhone = account.phone !== undefined

      ? (account.phone || null)

      : (existing?.phone ?? meta.phone ?? null);



    const resolvedGender = account.gender !== undefined

      ? (account.gender || null)

      : (existing?.gender ?? meta.gender ?? null);



    const resolvedBirthdate = account.dateOfBirth !== undefined

      ? (account.dateOfBirth || null)

      : (existing?.birthdate ?? meta.birthdate ?? meta.birthday ?? null);



    const resolvedDistrict = account.district !== undefined

      ? (account.district || null)

      : (existing?.district ?? meta.district ?? null);



    const resolvedAddress = account.address !== undefined

      ? (account.address || null)

      : (existing?.address ?? meta.address ?? null);



    const resolvedAvatar = account.profileImage !== undefined

      ? (account.profileImage || null)

      : (existing?.avatar_url ?? meta.avatar_url ?? meta.picture ?? null);



    const payload: any = {

      user_id: account.id,

      full_name: resolvedFullName,

      email: account.email || existing?.email || authData?.user?.email,

      phone: resolvedPhone,

      gender: resolvedGender,

      birthdate: resolvedBirthdate,

      district: resolvedDistrict,

      address: resolvedAddress,

      avatar_url: resolvedAvatar,

      role: existing?.role || 'patient',

      account_status: existing?.account_status || 'active',

      updated_at: new Date().toISOString(),

    };



    const { error } = await supabase.from('user').upsert(payload);

    if (error) {

      console.error('[Store] savePatientAccount upsert error:', error.message);

      throw error;

    }



    try {

      const updateData: Record<string, any> = {};

      if (payload.full_name) updateData.full_name = payload.full_name;

      if (payload.phone) updateData.phone = payload.phone;

      if (payload.avatar_url) updateData.avatar_url = payload.avatar_url;

      if (payload.gender) updateData.gender = payload.gender;

      if (payload.birthdate) {

        updateData.birthdate = payload.birthdate;

        updateData.birthday = payload.birthdate;

      }

      if (payload.district) updateData.district = payload.district;

      if (payload.address) updateData.address = payload.address;



      await supabase.auth.updateUser({

        data: updateData,

      });

    } catch {}

  } catch (err: any) {

    console.error('[Store] Failed to save patient account:', account.id, err?.message ?? err);

    throw err;

  }

}



export async function upsertPlatformUser(user: PlatformUser): Promise<void> {

  try {

    await supabase.from('user').upsert({

      user_id: user.id,

      full_name: user.fullName,

      email: user.email,

      role: 'patient',

      account_status: user.status === 'suspended' ? 'suspended' : 'active',

    });

  } catch (err) {

    console.warn('[Store] upsertPlatformUser error:', err);

  }

}



export async function initializeNewUser(

  account: PatientAccount,

  user: PlatformUser,

): Promise<void> {

  try {

    await savePatientAccount(account);



    // Create default notification settings

    try {

      await supabase.from('user_notification_settings').upsert({

        user_id: user.id,

        appointment_reminders: true,

        scan_alert: true,

      });

    } catch {}



    // Welcome notification

    try {

      await addAppNotification(user.id, {

        userId: user.id,

        type: 'general',

        title: 'Welcome to DermAI',

        message: 'Thanks for joining DermAI — your account has been created.',

      });

    } catch {}

  } catch (err: any) {

    console.error('[Store] initializeNewUser failed:', user.id, err?.message ?? err);

    throw err;

  }

}



export async function getPatientAccounts(): Promise<PatientAccount[]> {

  try {

    const { data } = await supabase.from('user').select('*').eq('role', 'patient');

    return (data || []).map((d: any) => ({

      id: d.user_id,

      fullName: d.full_name || '',

      email: d.email || '',

      phone: d.phone || undefined,

      gender: d.gender || undefined,

      dateOfBirth: d.birthdate || undefined,

      district: d.district || undefined,

      address: d.address || undefined,

      profileImage: d.avatar_url || undefined,

      createdAt: d.created_at,

      freeScansUsed: d.free_scans_used ?? 0,

    }));

  } catch {

    return [];

  }

}



export async function addPlatformTransaction(txn: PlatformTransaction): Promise<void> {

  try {

    await supabase.from('user_payment').insert({

      user_id: txn.userId,

      amount: txn.amount,

      method: txn.method || 'card',

      status: txn.status === 'paid' ? 'success' : 'pending',

      billing_cycle: txn.billingCycle || 'monthly',

    });

  } catch (err) {

    console.warn('[Store] addPlatformTransaction error:', err);

  }

}



export async function updatePlatformUserPlan(userId: string, _plan: 'free' | 'premium'): Promise<void> {

  try {

    await supabase.from('user').update({ role: 'patient' }).eq('user_id', userId);

  } catch (err) {

    console.warn('[Store] updatePlatformUserPlan error:', err);

  }

}



// ─── Skin History ─────────────────────────────────────────────────────────────

const _signedUrlCache = new Map<string, { url: string; exp: number }>();

export async function getSkinHistory(userId: string): Promise<ScanResult[]> {

  try {

    const { data, error } = await supabase

      .from('ai_scan_result')

      .select(`

        analysis_id,

        user_id,

        scanned_at,

        photo_url,

        photo_url_wide,

        confidence_score,

        body_part,

        condition_id,

        status,

        referral_suggested,

        questionnaire_answers,

        skin_condition:condition_id (

          name,

          local_name,

          description,

          skin_condition_care_tip (

            tip_text

          )

        )

      `)

      .eq('user_id', userId)

      .order('scanned_at', { ascending: false });



    if (error || !data) return [];



    // Batch sign storage paths with in-memory cache so we don't fire N*2 HTTP requests

    const nowTs = Date.now();

    const pathsToSign = new Set<string>();

    const needsSigning = (u?: string) =>

      Boolean(u && !u.startsWith('http') && !u.startsWith('file:') && !u.startsWith('data:'));



    for (const s of data) {

      if (needsSigning(s.photo_url)) {

        const cached = _signedUrlCache.get(s.photo_url);

        if (!cached || nowTs >= cached.exp) pathsToSign.add(s.photo_url);

      }

      if (needsSigning(s.photo_url_wide)) {

        const cached = _signedUrlCache.get(s.photo_url_wide);

        if (!cached || nowTs >= cached.exp) pathsToSign.add(s.photo_url_wide);

      }

    }



    if (pathsToSign.size > 0) {

      try {

        const { data: signedBatch } = await supabase.storage

          .from('scan-uploads')

          .createSignedUrls([...pathsToSign], 3600);

        if (Array.isArray(signedBatch)) {

          for (const item of signedBatch) {

            if (item.path && item.signedUrl) {

              _signedUrlCache.set(item.path, { url: item.signedUrl, exp: nowTs + 45 * 60 * 1000 });

            }

          }

        }

      } catch {}

    }



    const results: ScanResult[] = data.map((s: any) => {

        const condObj = Array.isArray(s.skin_condition) ? s.skin_condition[0] : s.skin_condition;

        let imageUrl = s.photo_url || undefined;

        let wideImageUrl = s.photo_url_wide || undefined;



        if (imageUrl && needsSigning(imageUrl)) {

          imageUrl = _signedUrlCache.get(imageUrl)?.url || imageUrl;

        }

        if (wideImageUrl && needsSigning(wideImageUrl)) {

          wideImageUrl = _signedUrlCache.get(wideImageUrl)?.url || wideImageUrl;

        }



        const careTipsList: string[] = (condObj?.skin_condition_care_tip || [])

          .map((t: any) => t.tip_text)

          .filter(Boolean);



        // Resolve condition name if condObj.name was not linked in database

        let conditionName = condObj?.name;

        if (!conditionName && s.condition_id) {

          const UUID_TO_NAME: Record<string, string> = {

            '00000000-0000-0000-0000-000000000012': 'Acne Vulgaris',

            '00000000-0000-0000-0000-000000000013': 'Atopic Dermatitis',

            '00000000-0000-0000-0000-000000000014': 'Contact Dermatitis',

            '00000000-0000-0000-0000-000000000015': 'Melasma',

            '00000000-0000-0000-0000-000000000011': 'Vitiligo',

          };

          conditionName = UUID_TO_NAME[s.condition_id];

        }

        if (!conditionName && s.questionnaire_answers && Object.keys(s.questionnaire_answers).length > 0) {

          try {

            const mapped = evaluateDiseaseMapping(normalizeAnswers(s.questionnaire_answers));

            if (mapped.primarySupportedCondition) {

              conditionName = mapped.primarySupportedCondition;

            }

          } catch {}

        }

        if (!conditionName) {

          if (typeof s.body_part === 'string' && s.body_part.length > 0 && s.body_part !== 'Skin Assessment') {

            conditionName = s.body_part;

          } else {

            conditionName = 'Acne Vulgaris';

          }

        }



        const guide = getConditionGuide(conditionName);

        const resolvedLocalName = condObj?.local_name || guide?.filipinoName || 'Taghiyawat';

        const resolvedDescription = condObj?.description || guide?.definition || '';

        const resolvedCareTips = careTipsList.length > 0 ? careTipsList : (guide?.basicCareTips || []);



        return {

          id: s.analysis_id,

          userId: s.user_id,

          date: s.scanned_at,

          imageUri: imageUrl,

          imageUris: imageUrl && wideImageUrl ? [imageUrl, wideImageUrl] : undefined,

          answers: s.questionnaire_answers || (s.body_part ? { bodyLocation: s.body_part } : {}),

          condition: conditionName,

          confidence: Number(s.confidence_score) || 0,

          severity: (Number(s.confidence_score) >= 75 ? 'severe' : Number(s.confidence_score) >= 50 ? 'moderate' : 'mild') as any,

          category: guide?.category || 'Dermatology',

          description: resolvedDescription,

          symptoms: guide?.commonSymptoms || [],

          careTips: resolvedCareTips,

          referralSuggested: s.referral_suggested || false,

          localName: resolvedLocalName,

          status: (s.status || 'completed') as any,

        };

      });

    return results;

  } catch (err) {

    console.warn('[Store] getSkinHistory error:', err);

    return [];

  }

}





/**

 * Upload an image from local mobile URI to Supabase Storage 'scan-uploads' bucket

 */

export async function uploadScanImageToStorage(

  userId: string,

  uri: string,

  slotPrefix: 'close_up' | 'wide' = 'close_up'

): Promise<string | null> {

  if (!uri || uri.startsWith('http://') || uri.startsWith('https://')) {

    return uri || null;

  }

  try {

    const ts = Date.now();

    const cleanUri = uri.split('?')[0];

    const rawExt = cleanUri.split('.').pop()?.toLowerCase();

    const ext = rawExt === 'png' ? 'png' : 'jpg';

    const filePath = `${userId}/${ts}_${slotPrefix}.${ext}`;



    // Direct Blob upload for compatibility across modern Expo on Web and Android/iOS

    const response = await fetch(uri);

    const blob = await response.blob();

    const { data, error } = await supabase.storage

      .from('scan-uploads')

      .upload(filePath, blob, {

        contentType: ext === 'png' ? 'image/png' : 'image/jpeg',

        upsert: true,

      });



    if (!error && data?.path) {

      return data.path;

    }



    if (error) {

      console.warn('[Store] Supabase storage upload error:', error.message);

    }

    return null;

  } catch (err) {

    console.warn('[Store] Supabase storage upload exception:', err);

    return null;

  }

}





export async function saveScanResult(userId: string, result: ScanResult): Promise<void> {

  try {

    let condId = getConditionUUID(result.condition);

    if (!condId) {

      try {

        const { data: dbConds } = await supabase.from('skin_condition').select('condition_id, name');

        const match = dbConds?.find((c: any) =>

          c.name.toLowerCase().includes(result.condition.toLowerCase()) ||

          result.condition.toLowerCase().includes(c.name.toLowerCase())

        );

        if (match) condId = match.condition_id;

      } catch {}

    }



    // Upload images to Supabase Storage bucket ('scan-uploads') so Web and Mobile can both access them

    let closeUpPath: string | null = null;

    let widePath: string | null = null;



    if (result.imageUri) {

      if (!result.imageUri.startsWith('http') && !result.imageUri.startsWith('data:')) {

        closeUpPath = await uploadScanImageToStorage(userId, result.imageUri, 'close_up');

      } else {

        closeUpPath = result.imageUri;

      }

    }



    const wideUri = result.imageUris?.[1];

    if (wideUri) {

      if (!wideUri.startsWith('http') && !wideUri.startsWith('data:')) {

        widePath = await uploadScanImageToStorage(userId, wideUri, 'wide');

      } else {

        widePath = wideUri;

      }

    }



    const bodyLocation = result.answers?.bodyLocation || 'Skin Assessment';



    const { data: scanData, error } = await supabase

      .from('ai_scan_result')

      .insert({

        user_id: userId,

        confidence_score: result.confidence,

        condition_id: condId,

        status: 'completed',

        scanned_at: result.date || new Date().toISOString(),

        referral_suggested: result.referralSuggested,

        photo_url: closeUpPath || result.imageUri || null,

        photo_url_wide: widePath || null,

        body_part: bodyLocation,

        questionnaire_answers: result.answers || {},

      })

      .select('analysis_id')

      .maybeSingle();

    if (error) {
      console.warn('[Store] saveScanResult insert error:', error.message);
    } else {
      try {
        const { data: userData } = await supabase.from('user').select('full_name, email').eq('user_id', userId).maybeSingle();
        const performerName = userData?.full_name || userData?.email?.split('@')[0] || 'Patient';
        logAuditEvent({
          user_id: userId,
          user_type: 'patient',
          performer_name: performerName,
          action: 'AI Skin Scan Completed',
          log_type: 'scan',
          target: result.condition || 'Skin Assessment',
          details: `Completed AI skin scan for ${result.condition || 'skin condition'} with ${Math.round((result.confidence || 0) * 100)}% confidence`,
          metadata: {
            analysis_id: scanData?.analysis_id,
            condition: result.condition,
            confidence: result.confidence,
            severity: result.severity,
            platform: 'Mobile App',
          },
        }).catch(() => {});
      } catch (_) {}
    }



    // Sync individual questionnaire answers into ai_skin_answer table

    if (scanData?.analysis_id && (result.answers as any)?.questionnaireData) {

      try {

        const qItems = JSON.parse((result.answers as any).questionnaireData);

        if (Array.isArray(qItems)) {

          const skinAnswerRows = qItems.map((item: any, idx: number) => ({

            analysis_id: scanData.analysis_id,

            question_key: item.id || `q${idx + 1}`,

            answer_value: item.answer || '',

            sort_order: idx + 1,

          }));

          await supabase.from('ai_skin_answer').insert(skinAnswerRows);

        }

      } catch (secErr) {

        console.warn('[Store] ai_skin_answer insert skipped:', secErr);

      }

    }



    // Increment free_scans_used for free tier users only

    const sub = await getUserSubscription(userId);

    const isPaid = Boolean(
      sub &&
        !sub.isExpired &&
        (sub.plan === 'premium' ||
          sub.plan === 'pro' ||
          sub.plan === 'basic' ||
          sub.statusLabel === 'Premium Active' ||
          sub.statusLabel === 'Basic Active')
    );

    if (!isPaid) {

      const { data: u } = await supabase.from('user').select('free_scans_used').eq('user_id', userId).maybeSingle();

      if (u) {

        await supabase.from('user').update({ free_scans_used: (u.free_scans_used || 0) + 1 }).eq('user_id', userId);

      }

    }

  } catch (err) {

    console.warn('[Store] saveScanResult exception:', err);

  }

}



export async function deleteScanResult(_userId: string, scanId: string): Promise<void> {

  try {

    await supabase.from('ai_scan_result').delete().eq('analysis_id', scanId);

  } catch (err) {

    console.warn('[Store] deleteScanResult error:', err);

  }

}



// ─── Subscriptions ────────────────────────────────────────────────────────────

const triggeredSubscriptionEmailChecks = new Set<string>();

export async function getActiveSubscriptionPlans(): Promise<SubscriptionPlanOption[]> {
  try {
    const { data, error } = await supabase
      .from('plan')
      .select(`
        plan_id,
        name,
        description,
        price,
        billing_type,
        scan_limit,
        status,
        plan_feature (
          feature_id,
          feature_text
        )
      `)
      .eq('status', 'active')
      .order('price', { ascending: true });

    if (error || !data) return [];

    return data.map((p: any) => {
      const basePrice = Number(p.price ?? 0);
      const calc = calculatePricing(basePrice);
      const features = Array.isArray(p.plan_feature)
        ? p.plan_feature.map((f: any) => f.feature_text).filter(Boolean)
        : [];
      return {
        id: String(p.plan_id),
        name: String(p.name || 'Plan'),
        description: String(p.description || ''),
        price: calc.basePrice,
        vatAmount: calc.vatAmount,
        totalPrice: calc.totalPrice,
        billingType: p.billing_type === 'yearly' ? 'yearly' : 'monthly',
        scanLimit: resolveMobilePlanScanLimit(p.scan_limit, 3),
        features,
        status: String(p.status || 'active'),
      };
    });
  } catch (err) {
    console.warn('[Store] getActiveSubscriptionPlans error:', err);
    return [];
  }
}

/**
 * Resolves a plan's scan_limit value conservatively:
 * - -1 explicitly represents Unlimited (-1)
 * - >= 0 represents a finite scan allowance (0, 3, 5, 10, etc.)
 * - missing, null, undefined, or invalid values fall back conservatively (default 3) and never assume Unlimited.
 */
export function resolveMobilePlanScanLimit(rawLimit: unknown, fallback = 3): number {
  if (rawLimit === null || rawLimit === undefined || rawLimit === '') {
    return fallback;
  }
  const num = Number(rawLimit);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  if (num === -1) {
    return -1;
  }
  if (num >= 0) {
    return Math.floor(num);
  }
  return fallback;
}

export interface MobileFreePlanConfigResult {
  verified: boolean;
  ambiguous: boolean;
  isActive: boolean;
  scanLimit: number;
  configuredScanLimit: number;
  plan: any | null;
  features: string[];
  error: string | null;
}

export interface MobileFreeScanUsageResult {
  verified: boolean;
  ambiguous: boolean;
  freeScansUsed: number;
  error: string | null;
}

export const MOBILE_CONSUMED_SCAN_STATUSES = [
  'completed',
  'valid',
  'flagged',
  'invalid',
] as const;

/**
 * Fetches the administrator-managed Free Plan (price = 0) from `public.plan`.
 * - Does not use hardcoded plan IDs, plan names, or fallback scan limits.
 * - Fails closed if the query fails, if zero rows exist, or if multiple zero-priced plans exist (ambiguity).
 */
export async function fetchMobileAdminFreePlanConfig(): Promise<MobileFreePlanConfigResult> {
  try {
    const { data, error } = await supabase
      .from('plan')
      .select(`
        plan_id,
        name,
        description,
        price,
        scan_limit,
        status,
        billing_type,
        plan_feature (
          feature_id,
          feature_text
        )
      `)
      .eq('price', 0);

    if (error || !Array.isArray(data)) {
      return {
        verified: false,
        ambiguous: false,
        isActive: false,
        scanLimit: 0,
        configuredScanLimit: 0,
        plan: null,
        features: [],
        error: 'Unable to verify your scan allowance. Please check your internet connection and try again.',
      };
    }

    if (data.length === 0) {
      return {
        verified: false,
        ambiguous: false,
        isActive: false,
        scanLimit: 0,
        configuredScanLimit: 0,
        plan: null,
        features: [],
        error: 'Free AI skin scanning is not currently configured.',
      };
    }

    if (data.length > 1) {
      return {
        verified: false,
        ambiguous: true,
        isActive: false,
        scanLimit: 0,
        configuredScanLimit: 0,
        plan: null,
        features: [],
        error:
          'Multiple zero-priced plans were found in Plan Management. Free scanning is disabled until a single Free Plan is configured.',
      };
    }

    const row: any = data[0];
    const status = String(row.status || '').toLowerCase();
    const isActive = status === 'active';
    const configuredLimit = resolveMobilePlanScanLimit(row.scan_limit, -2);

    const features: string[] = Array.isArray(row.plan_feature)
      ? row.plan_feature.map((f: any) => f.feature_text).filter(Boolean)
      : [];

    if (configuredLimit === -2) {
      return {
        verified: false,
        ambiguous: false,
        isActive: false,
        scanLimit: 0,
        configuredScanLimit: 0,
        plan: row,
        features,
        error: 'The Free Plan scan allowance is not properly configured.',
      };
    }

    return {
      verified: true,
      ambiguous: false,
      isActive,
      scanLimit: isActive ? configuredLimit : 0,
      configuredScanLimit: configuredLimit,
      plan: row,
      features,
      error: isActive
        ? null
        : 'Free AI skin scanning is currently unavailable. Please view the available subscription plans to continue scanning.',
    };
  } catch (err) {
    console.warn('[Store] fetchMobileAdminFreePlanConfig error:', err);
    return {
      verified: false,
      ambiguous: false,
      isActive: false,
      scanLimit: 0,
      configuredScanLimit: 0,
      plan: null,
      features: [],
      error: 'Unable to verify your scan allowance. Please check your internet connection and try again.',
    };
  }
}

/**
 * Authoritative one-time Free scan usage calculation using completed `ai_scan_result` records.
 * - Does not use `user.free_scans_used` or `Math.max(user.free_scans_used, ...)`.
 * - Retrieves all completed scans, subscription records, and successful payment records with pagination.
 * - Excludes only scans that fall within verified paid subscription entitlement periods.
 * - Never assumes `payment_date + billing_cycle` equals an entitlement period; if any completed scan
 *   overlaps an overwritten or unverified historical paid subscription period, returns `verified: false, ambiguous: true`.
 */
export async function calculateMobileOneTimeFreeScanUsage(
  userId: string
): Promise<MobileFreeScanUsageResult> {
  if (!userId) {
    return {
      verified: false,
      ambiguous: false,
      freeScansUsed: 0,
      error: 'User authentication is required to verify free scan usage.',
    };
  }

  const PAGE_SIZE = 500;

  try {
    // 1. Paginated retrieval of all completed scan records (including admin-reviewed valid/flagged/invalid scans)
    const completedScans: Array<{ analysis_id: string; scanned_at: string | null }> = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('ai_scan_result')
        .select('analysis_id, scanned_at')
        .eq('user_id', userId)
        .in('status', [...MOBILE_CONSUMED_SCAN_STATUSES])
        .order('scanned_at', { ascending: true })
        .order('analysis_id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error || !Array.isArray(data)) {
        return {
          verified: false,
          ambiguous: false,
          freeScansUsed: 0,
          error: 'Unable to verify your scan allowance. Please check your internet connection and try again.',
        };
      }
      completedScans.push(...(data as any[]));
      if (data.length < PAGE_SIZE) break;
    }

    if (completedScans.length === 0) {
      return {
        verified: true,
        ambiguous: false,
        freeScansUsed: 0,
        error: null,
      };
    }

    // 2. Paginated retrieval of all subscription rows for the user
    const subRows: any[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('user_plan_subscription')
        .select(`
          subscription_id,
          started_at,
          current_period_start,
          current_period_end,
          renews_at,
          status,
          billing_cycle,
          cancel_at_period_end,
          cancelled_at,
          plan_id,
          plan:plan_id (
            plan_id,
            name,
            price,
            scan_limit,
            billing_type
          )
        `)
        .eq('user_id', userId)
        .order('started_at', { ascending: true })
        .order('subscription_id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error || !Array.isArray(data)) {
        return {
          verified: false,
          ambiguous: false,
          freeScansUsed: 0,
          error: 'Unable to verify your scan allowance. Please check your internet connection and try again.',
        };
      }
      subRows.push(...data);
      if (data.length < PAGE_SIZE) break;
    }

    // 3. Paginated retrieval of all successful payment records for the user
    const paymentRows: any[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('user_payment')
        .select(`
          *,
          plan:plan_id (
            plan_id,
            name,
            price,
            billing_type
          )
        `)
        .eq('user_id', userId)
        .eq('status', 'success')
        .order('payment_date', { ascending: true })
        .order('payment_id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error || !Array.isArray(data)) {
        return {
          verified: false,
          ambiguous: false,
          freeScansUsed: 0,
          error: 'Unable to verify your scan allowance. Please check your internet connection and try again.',
        };
      }
      paymentRows.push(...data);
      if (data.length < PAGE_SIZE) break;
    }

    // Filter to actual paid subscription payments (excluding consultation appointments)
    const subscriptionPayments = paymentRows.filter((p: any) => {
      if (p.appointment_id) return false;
      const pType = String(p.payment_type || '').toLowerCase();
      if (
        pType === 'appointment_consultation' ||
        pType === 'appointment_consultation_simulated'
      ) {
        return false;
      }
      const planObj = Array.isArray(p.plan) ? p.plan[0] : p.plan;
      const planPrice = Number(planObj?.price ?? 0);
      const paidAmt = Number(p.amount ?? p.total_amount ?? p.amount_paid ?? 0);
      return (p.plan_id != null || planPrice > 0) && paidAmt > 0;
    });

    // Filter to paid subscription rows
    const paidSubRows = subRows.filter((s: any) => {
      const planObj = Array.isArray(s.plan) ? s.plan[0] : s.plan;
      const price = Number(planObj?.price ?? 0);
      const limit = Number(planObj?.scan_limit);
      return price > 0 || limit === -1 || s.plan_id != null;
    });

    // Fast-path: user has never had any paid subscription or subscription payment
    if (paidSubRows.length === 0 && subscriptionPayments.length === 0) {
      for (const s of completedScans) {
        if (!s.scanned_at || !Number.isFinite(Date.parse(s.scanned_at))) {
          return {
            verified: false,
            ambiguous: true,
            freeScansUsed: 0,
            error: 'A historical scan record is missing a valid timestamp.',
          };
        }
      }
      return {
        verified: true,
        ambiguous: false,
        freeScansUsed: completedScans.length,
        error: null,
      };
    }

    // Build verified paid subscription periods and detect overwritten historical gaps
    const SKEW_MS = 15 * 60 * 1000;
    const verifiedWindows: Array<{ startMs: number; endMs: number }> = [];
    const authoritativeSubWindows: Array<{
      startMs: number;
      endMs: number;
      startedAtMs: number;
      planId: string;
    }> = [];
    const rawOverwrittenGaps: Array<{ startMs: number; endMs: number }> = [];

    for (const s of paidSubRows) {
      const startRaw = s.current_period_start || s.started_at;
      const endRaw = s.current_period_end || s.renews_at;
      const startMs = startRaw ? Date.parse(startRaw) : NaN;
      const endMs = endRaw ? Date.parse(endRaw) : NaN;
      const startedAtMs = s.started_at ? Date.parse(s.started_at) : startMs;

      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
        return {
          verified: false,
          ambiguous: true,
          freeScansUsed: 0,
          error:
            'Subscription period dates are incomplete; historical free scan usage cannot be verified unambiguously.',
        };
      }

      let effectiveEndMs = endMs;
      const statusLower = String(s.status || '').toLowerCase();
      if (statusLower === 'cancelled' && !s.cancel_at_period_end && s.cancelled_at) {
        const cancelledMs = Date.parse(s.cancelled_at);
        if (Number.isFinite(cancelledMs) && cancelledMs >= startMs && cancelledMs < endMs) {
          effectiveEndMs = cancelledMs;
        }
      }

      const subPlanId = String(s.plan_id || '').trim();
      authoritativeSubWindows.push({
        startMs,
        endMs: effectiveEndMs,
        startedAtMs,
        planId: subPlanId,
      });
      verifiedWindows.push({ startMs, endMs: effectiveEndMs });

      if (Number.isFinite(startedAtMs) && startedAtMs < startMs - 10 * 60 * 1000) {
        rawOverwrittenGaps.push({ startMs: startedAtMs, endMs: startMs });
      }
    }

    // Reconstruct earlier overwritten paid subscription periods from verified system_audit_log records
    // when earlier subscription payments or overwritten period gaps exist.
    const needsHistoricalAuditVerification =
      rawOverwrittenGaps.length > 0 ||
      subscriptionPayments.some((pay: any) => {
        const payMs = pay.payment_date ? Date.parse(pay.payment_date) : NaN;
        if (!Number.isFinite(payMs)) return true;
        return !verifiedWindows.some(
          (w) => payMs >= w.startMs - SKEW_MS && payMs <= w.endMs
        );
      });

    const historicalAuditWindows: Array<{ startMs: number; endMs: number }> = [];

    if (needsHistoricalAuditVerification) {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const sessionUserId = sessionData?.session?.user?.id;
        if (sessionUserId && sessionUserId !== userId) {
          return {
            verified: false,
            ambiguous: false,
            freeScansUsed: 0,
            error: 'Unable to verify scan allowance for another user.',
          };
        }
      } catch {
        // Proceed if auth session helper is unavailable in the current runtime context
      }

      const auditRows: any[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await supabase
          .from('system_audit_log')
          .select('log_id, timestamp, user_id, log_type, action, details')
          .eq('user_id', userId)
          .eq('log_type', 'subscription')
          .eq('action', 'Subscription Upgraded')
          .order('timestamp', { ascending: true })
          .order('log_id', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);

        if (error || !Array.isArray(data)) {
          return {
            verified: false,
            ambiguous: false,
            freeScansUsed: 0,
            error:
              'Unable to verify your scan allowance. Please check your internet connection and try again.',
          };
        }
        auditRows.push(...data);
        if (data.length < PAGE_SIZE) break;
      }

      const dedupAuditMap = new Map<
        string,
        { startMs: number; endMs: number; planId: string }
      >();

      for (const row of auditRows) {
        // 1. Verify event belongs strictly to the authenticated patient and represents subscription activation
        if (String(row?.user_id || '') !== userId) continue;
        if (String(row?.log_type || '').toLowerCase() !== 'subscription') continue;
        if (String(row?.action || '') !== 'Subscription Upgraded') continue;

        const detailsStr = typeof row?.details === 'string' ? row.details : '';
        const ctxIdx = detailsStr.lastIndexOf('Context:');
        if (ctxIdx === -1) continue;

        let ctx: any = null;
        try {
          ctx = JSON.parse(detailsStr.slice(ctxIdx + 'Context:'.length).trim());
        } catch {
          continue;
        }
        if (!ctx || typeof ctx !== 'object') continue;

        // 2. Verify recorded period start and end are valid
        const periodStartRaw =
          typeof ctx.currentPeriodStart === 'string' ? ctx.currentPeriodStart : '';
        const periodEndRaw =
          typeof ctx.currentPeriodEnd === 'string' ? ctx.currentPeriodEnd : '';
        const startMs = periodStartRaw ? Date.parse(periodStartRaw) : NaN;
        const endMs = periodEndRaw ? Date.parse(periodEndRaw) : NaN;
        const logMs = row?.timestamp ? Date.parse(row.timestamp) : startMs;

        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
          continue;
        }
        if (!Number.isFinite(logMs) || Math.abs(logMs - startMs) > 24 * 60 * 60 * 1000) {
          continue;
        }

        const auditPlanId = String(ctx.planId || ctx.plan_id || '').trim();
        const auditTxId = String(
          ctx.transactionId || ctx.paymentId || ctx.referenceNumber || ''
        ).trim();

        // 3. Verify referenced plan and transaction correspond to a fulfilled subscription payment
        const matchedPay = subscriptionPayments.find((pay: any) => {
          const payMs = pay.payment_date ? Date.parse(pay.payment_date) : NaN;
          if (!Number.isFinite(payMs)) return false;

          const payPlanId = String(pay.plan_id || '').trim();
          if (auditPlanId && payPlanId && auditPlanId !== payPlanId) {
            return false;
          }

          const payTxIds = [
            pay.paymongo_payment_id,
            pay.reference_number,
            pay.paymongo_payment_intent_id,
            pay.payment_id,
          ]
            .map((v) => String(v || '').trim())
            .filter(Boolean);

          if (auditTxId && payTxIds.length > 0) {
            return (
              payTxIds.includes(auditTxId) &&
              Math.abs(payMs - startMs) <= 24 * 60 * 60 * 1000
            );
          }

          return Math.abs(payMs - startMs) <= SKEW_MS;
        });

        if (!matchedPay) continue;

        // 4. Do not allow audit records to override or conflict with authoritative user_plan_subscription records
        const overlapsOrFollowsAuthoritativeSub = authoritativeSubWindows.some(
          (subWin) => startMs >= subWin.startMs - SKEW_MS
        );
        if (overlapsOrFollowsAuthoritativeSub) continue;

        // 5. Deduplicate multiple audit events for the same subscription activation
        const dedupKey = matchedPay.payment_id
          ? `pay:${String(matchedPay.payment_id)}`
          : auditTxId
            ? `tx:${auditTxId}`
            : `win:${auditPlanId}:${Math.round(startMs / SKEW_MS)}`;

        const existing = dedupAuditMap.get(dedupKey);
        if (existing) {
          existing.startMs = Math.min(existing.startMs, startMs);
          existing.endMs = Math.max(existing.endMs, endMs);
        } else {
          dedupAuditMap.set(dedupKey, {
            startMs,
            endMs,
            planId: auditPlanId,
          });
        }
      }

      // 6. Sort deduplicated historical windows chronologically and cap each window at the next upgrade/subscription start
      const sortedAuditWindows = Array.from(dedupAuditMap.values()).sort(
        (a, b) => a.startMs - b.startMs
      );

      for (let i = 0; i < sortedAuditWindows.length; i += 1) {
        const current = sortedAuditWindows[i];
        let boundedEndMs = current.endMs;

        for (let j = i + 1; j < sortedAuditWindows.length; j += 1) {
          if (sortedAuditWindows[j].startMs > current.startMs) {
            boundedEndMs = Math.min(boundedEndMs, sortedAuditWindows[j].startMs);
            break;
          }
        }

        for (const subWin of authoritativeSubWindows) {
          if (subWin.startMs > current.startMs) {
            boundedEndMs = Math.min(boundedEndMs, subWin.startMs);
          }
        }

        if (boundedEndMs > current.startMs) {
          historicalAuditWindows.push({
            startMs: current.startMs,
            endMs: boundedEndMs,
          });
          verifiedWindows.push({
            startMs: current.startMs,
            endMs: boundedEndMs,
          });
        }
      }
    }

    // Only retain overwrittenGaps whose original `started_at` is not accounted for by a verified historical audit window
    const overwrittenGaps = rawOverwrittenGaps.filter(
      (gap) =>
        !historicalAuditWindows.some(
          (hw) => Math.abs(hw.startMs - gap.startMs) <= SKEW_MS
        )
    );

    // Sort verified paid windows chronologically
    verifiedWindows.sort((a, b) => a.startMs - b.startMs);

    // Check whether any successful subscription payment is not covered by a verified subscription window.
    // Bound each unmatched payment's uncertainty to [payMs - SKEW_MS, nextVerifiedWindow.startMs)
    // so an older unmatched payment does not block scans taken after a later verified subscription expires.
    const unmatchedPaymentWindows: Array<{ startMs: number; endMs: number }> = [];

    for (const pay of subscriptionPayments) {
      const payMs = pay.payment_date ? Date.parse(pay.payment_date) : NaN;
      if (!Number.isFinite(payMs)) {
        return {
          verified: false,
          ambiguous: true,
          freeScansUsed: 0,
          error: 'A subscription payment record is missing a valid timestamp.',
        };
      }

      const isCoveredByVerifiedWindow = verifiedWindows.some(
        (w) => payMs >= w.startMs - SKEW_MS && payMs <= w.endMs
      );
      if (!isCoveredByVerifiedWindow) {
        const nextVerifiedWindow = verifiedWindows.find(
          (w) => w.startMs > payMs - SKEW_MS
        );
        unmatchedPaymentWindows.push({
          startMs: payMs - SKEW_MS,
          endMs: nextVerifiedWindow ? nextVerifiedWindow.startMs : Number.POSITIVE_INFINITY,
        });
      }
    }

    let freeScansUsed = 0;

    for (const scan of completedScans) {
      const scanMs = scan.scanned_at ? Date.parse(scan.scanned_at) : NaN;
      if (!Number.isFinite(scanMs)) {
        return {
          verified: false,
          ambiguous: true,
          freeScansUsed: 0,
          error: 'A historical scan record is missing a valid timestamp.',
        };
      }

      const inVerifiedPaidWindow = verifiedWindows.some(
        (w) => scanMs >= w.startMs - SKEW_MS && scanMs <= w.endMs
      );
      if (inVerifiedPaidWindow) {
        continue;
      }

      const inOverwrittenGap = overwrittenGaps.some(
        (g) => scanMs >= g.startMs - SKEW_MS && scanMs < g.endMs
      );
      if (inOverwrittenGap) {
        return {
          verified: false,
          ambiguous: true,
          freeScansUsed: 0,
          error:
            'Historical scan usage overlaps an earlier subscription period that was updated on renewal and cannot be classified unambiguously.',
        };
      }

      const inUnmatchedPaymentPeriod = unmatchedPaymentWindows.some(
        (uw) => scanMs >= uw.startMs && scanMs < uw.endMs
      );
      if (inUnmatchedPaymentPeriod) {
        return {
          verified: false,
          ambiguous: true,
          freeScansUsed: 0,
          error:
            'Historical scan records overlap a prior subscription payment whose exact entitlement period is no longer stored. Free scan allowance cannot be verified automatically.',
        };
      }

      freeScansUsed += 1;
    }

    return {
      verified: true,
      ambiguous: false,
      freeScansUsed,
      error: null,
    };
  } catch (err) {
    console.warn('[Store] calculateMobileOneTimeFreeScanUsage error:', err);
    return {
      verified: false,
      ambiguous: false,
      freeScansUsed: 0,
      error: 'Unable to verify your historical free scan usage. Please check your connection and try again.',
    };
  }
}

export async function getUserSubscription(userId?: string): Promise<SubscriptionRecord | null> {
  try {
    let effectiveUserId = userId || '';
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user?.id) {
        effectiveUserId = sessionData.session.user.id;
      }
    } catch {}

    if (!effectiveUserId) return null;

    // 1. Query active subscription first (prioritize status = 'active' | 'cancelling' | 'pending_downgrade')
    let { data, error } = await supabase
      .from('user_plan_subscription')
      .select(`
        *,
        plan:plan_id (
          plan_id,
          name,
          price,
          scan_limit,
          billing_type,
          description,
          plan_feature (
            feature_id,
            feature_text
          )
        )
      `)
      .eq('user_id', effectiveUserId)
      .in('status', ['active', 'cancelling', 'pending_downgrade'])
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // 2. If no active row found, fetch latest subscription row
    if (!data) {
      const fallback = await supabase
        .from('user_plan_subscription')
        .select(`
          *,
          plan:plan_id (
            plan_id,
            name,
            price,
            scan_limit,
            billing_type,
            description,
            plan_feature (
              feature_id,
              feature_text
            )
          )
        `)
        .eq('user_id', effectiveUserId)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      data = fallback.data;
      error = fallback.error;
    }

    const [userRes, freePlanConfig] = await Promise.all([
      supabase
        .from('user')
        .select('email, full_name, free_scans_used')
        .eq('user_id', effectiveUserId)
        .maybeSingle(),
      fetchMobileAdminFreePlanConfig(),
    ]);

    const u = userRes.data;
    const freePlanData = freePlanConfig.plan;
    const freePlanVerified = freePlanConfig.verified;
    const freePlanActive = freePlanVerified && freePlanConfig.isActive;
    const freeScanLimit = freePlanActive ? freePlanConfig.scanLimit : 0;
    const freeFeatures =
      freePlanConfig.features.length > 0
        ? freePlanConfig.features
        : freePlanActive
        ? [
            freeScanLimit === -1
              ? 'Unlimited AI Skin Scans'
              : `${freeScanLimit} One-Time Free AI Skin ${freeScanLimit === 1 ? 'Scan' : 'Scans'}`,
            'Limited Nearby Clinic Suggestions',
            'Limited AI Skin Analysis Results',
            'Access to Clinic Directory',
          ]
        : [];

    if (!data || error) {
      const freeUsage = !error
        ? await calculateMobileOneTimeFreeScanUsage(effectiveUserId)
        : {
            verified: false,
            ambiguous: false,
            freeScansUsed: 0,
            error: 'Unable to verify subscription status.',
          };

      return {
        userId: effectiveUserId,
        email: u?.email || '',
        plan: 'free',
        planName: freePlanData?.name || 'Free Plan',
        planDescription: freePlanData?.description || '',
        planFeatures: freeFeatures,
        billingCycle: 'monthly',
        scansUsed: freeUsage.freeScansUsed,
        scansCountVerified: !error && freePlanVerified && freeUsage.verified,
        scanLimit: freeScanLimit,
        status: 'none',
        statusLabel: 'No Active Subscription',
        isExpired: false,
        cancelAtPeriodEnd: false,
        remainingDays: null,
        basePrice: 0,
        vatAmount: 0,
        totalPrice: 0,
        freePlanActive,
        freePlanVerified,
        freePlanAmbiguous: freePlanConfig.ambiguous || freeUsage.ambiguous,
        freePlanConfiguredLimit: freePlanConfig.configuredScanLimit,
        freePlanError: freePlanConfig.error || freeUsage.error,
      };
    }

    let planObj: any = Array.isArray(data.plan) ? data.plan[0] : data.plan;

    // Fallback: If join didn't populate planObj, query plan table by plan_id
    if (!planObj && data.plan_id) {
      try {
        const { data: p } = await supabase
          .from('plan')
          .select('*, plan_feature(feature_id, feature_text)')
          .eq('plan_id', data.plan_id)
          .maybeSingle();
        if (p) planObj = p;
      } catch {}
    }

    let status = String(data.status || '').toLowerCase();
    const periodEndRaw = data.current_period_end || data.renews_at;
    const periodEndMs = periodEndRaw ? new Date(periodEndRaw).getTime() : null;
    const isLapsed = periodEndMs !== null ? periodEndMs <= Date.now() : true;
    const wasActive =
      status === 'active' ||
      status === 'cancelling' ||
      status === 'pending_downgrade';

    // -------------------------------------------------------------------------
    // LAZY DOWNGRADE & AUTOMATED SUBSCRIPTION EXPIRED EMAIL:
    // Mirrors Web validateAndSyncSubscription in web/src/lib/subscriptionService.ts
    // -------------------------------------------------------------------------
    if (wasActive && isLapsed) {
      const expCheckKey = `exp_${data.subscription_id}_${periodEndRaw}`;
      if (!triggeredSubscriptionEmailChecks.has(expCheckKey)) {
        triggeredSubscriptionEmailChecks.add(expCheckKey);
        // Trigger background Subscription Expired Email Edge Function
        supabase.functions
          .invoke('subscription-expiry', { body: { mode: 'process' } })
          .catch((e) => console.warn('[Store] subscription-expiry invoke notice:', e));
      }

      try {
        await (supabase.rpc as any)('downgrade_expired_subscriptions');
      } catch {}

      try {
        const { error: updateErr } = await supabase
          .from('user_plan_subscription')
          .update({
            status: 'expired',
            updated_at: new Date().toISOString(),
          })
          .eq('subscription_id', data.subscription_id);

        if (updateErr) {
          await supabase
            .from('user_plan_subscription')
            .update({
              status: 'expired',
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', effectiveUserId)
            .eq('status', 'active');
        }
      } catch {}

      status = 'expired';
      data.status = 'expired';

      try {
        await supabase
          .from('user')
          .update({ updated_at: new Date().toISOString() })
          .eq('user_id', effectiveUserId);
      } catch {}

      logAuditEvent({
        user_id: effectiveUserId,
        user_type: 'patient',
        performer_name: u?.full_name || u?.email || 'Patient',
        action: 'Subscription Expired',
        log_type: 'subscription',
        target: `User #${effectiveUserId}`,
        details: 'Account downgraded from Pro to Free due to period expiration.',
        metadata: {
          subscriptionId: data.subscription_id,
          expiredAt: periodEndRaw,
          planName: planObj?.name || 'Pro',
        },
      }).catch(() => {});
    }

    const isActive = wasActive && !isLapsed;

    // Purely dynamic determination from live Supabase plan attributes (no plan name checks)
    const isPaidActive =
      isActive &&
      (Number(planObj?.price ?? 0) > 0 || planObj?.scan_limit === -1);

    const isProOrPremium = isPaidActive && planObj?.scan_limit === -1;

    const isBasic = isPaidActive && !isProOrPremium;

    const planType: 'free' | 'basic' | 'pro' | 'premium' = isProOrPremium
      ? 'premium'
      : isBasic
      ? 'basic'
      : 'free';

    const statusLabel: 'Premium Active' | 'Basic Active' | 'No Active Subscription' =
      isProOrPremium
        ? 'Premium Active'
        : isBasic
        ? 'Basic Active'
        : 'No Active Subscription';

    const remainingDays =
      isPaidActive && periodEndMs !== null
        ? Math.max(0, Math.ceil((periodEndMs - Date.now()) / 86400000))
        : null;

    // -------------------------------------------------------------------------
    // 14-DAY EXPIRATION REMINDER EMAIL TRIGGER:
    // Checks current_period_end and triggers 2-week reminder Edge Function
    // -------------------------------------------------------------------------
    if (
      isPaidActive &&
      remainingDays !== null &&
      remainingDays > 0 &&
      remainingDays <= 14
    ) {
      const remCheckKey = `rem14_${data.subscription_id}_${periodEndRaw}`;
      if (!triggeredSubscriptionEmailChecks.has(remCheckKey)) {
        triggeredSubscriptionEmailChecks.add(remCheckKey);
        supabase.functions
          .invoke('subscription-reminder-2weeks', { body: { mode: 'process' } })
          .catch((e) => console.warn('[Store] subscription-reminder-2weeks invoke notice:', e));
      }
    }

    const isYearly =
      data.billing_cycle === 'yearly' ||
      planObj?.billing_type === 'yearly';

    let usedScans = 0;
    let scansCountVerified = false;
    let resolvedActiveScanLimit = 0;
    let activeError: string | null = null;
    let freeUsageAmbiguous = false;

    if (isPaidActive) {
      const paidLimit = resolveMobilePlanScanLimit(planObj?.scan_limit, -2);
      const limitVerified = paidLimit !== -2;
      resolvedActiveScanLimit = limitVerified ? paidLimit : 0;

      const cycleStartRaw = data.current_period_start || data.started_at || null;
      const cycleStartMs = cycleStartRaw ? Date.parse(cycleStartRaw) : NaN;

      if (Number.isFinite(cycleStartMs)) {
        try {
          let query = supabase
            .from('ai_scan_result')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', effectiveUserId)
            .in('status', [...MOBILE_CONSUMED_SCAN_STATUSES])
            .gte('scanned_at', new Date(cycleStartMs).toISOString());

          if (periodEndMs !== null && Number.isFinite(periodEndMs) && periodEndMs >= cycleStartMs) {
            query = query.lte('scanned_at', new Date(periodEndMs).toISOString());
          }

          const { count, error: countErr } = await query;
          if (!countErr && typeof count === 'number') {
            usedScans = count;
            scansCountVerified = limitVerified;
          }
        } catch {}
      }
      if (resolvedActiveScanLimit === -1) {
        scansCountVerified = true;
      }
    } else {
      const freeUsage = await calculateMobileOneTimeFreeScanUsage(effectiveUserId);
      usedScans = freeUsage.freeScansUsed;
      scansCountVerified = freePlanVerified && freeUsage.verified;
      resolvedActiveScanLimit = freeScanLimit;
      activeError = freePlanConfig.error || freeUsage.error;
      freeUsageAmbiguous = freeUsage.ambiguous;
    }

    let planFeatures: string[] = Array.isArray(planObj?.plan_feature)
      ? planObj.plan_feature.map((f: any) => f.feature_text).filter(Boolean)
      : [];

    if (planFeatures.length === 0 && isPaidActive) {
      planFeatures = [
        resolvedActiveScanLimit === -1
          ? 'Unlimited AI Skin Scans'
          : `${resolvedActiveScanLimit} AI Skin ${resolvedActiveScanLimit === 1 ? 'Scan' : 'Scans'} per billing cycle`,
        'Unlimited Nearby Clinic Suggestions',
        'Unlimited AI Skin Analysis Results',
        'Access to Clinic Directory',
      ];
    } else if (!isPaidActive) {
      planFeatures = freeFeatures;
    }

    const rawNetPrice = isPaidActive ? Number(planObj?.price ?? 0) : 0;
    const pricing = calculatePricing(rawNetPrice);

    return {
      userId: effectiveUserId,
      email: data.payment_email || u?.email || '',
      plan: planType,
      subscriptionId: data.subscription_id,
      planId: data.plan_id || planObj?.plan_id,
      planName: isPaidActive
        ? planObj?.name || (isProOrPremium ? 'Pro' : 'Basic')
        : freePlanData?.name || 'Free Plan',
      planDescription: isPaidActive
        ? planObj?.description || ''
        : freePlanData?.description || '',
      planFeatures,
      billingCycle: isYearly ? 'yearly' : 'monthly',
      startDate: data.current_period_start || data.started_at,
      endDate: periodEndRaw || data.renews_at,
      status: data.status,
      statusLabel,
      cancelAtPeriodEnd: Boolean(data.cancel_at_period_end || status === 'cancelling'),
      isExpired: isLapsed || status === 'expired',
      remainingDays,
      basePrice: pricing.basePrice,
      vatAmount: pricing.vatAmount,
      totalPrice: pricing.totalPrice,
      scansUsed: usedScans,
      scansCountVerified,
      scanLimit: resolvedActiveScanLimit,
      paymentMethod: data.payment_method || undefined,
      mobileNumber: data.payment_mobile_number || undefined,
      billingAddress: data.billing_address || undefined,
      freePlanActive: isPaidActive ? true : freePlanActive,
      freePlanVerified: isPaidActive ? true : freePlanVerified,
      freePlanAmbiguous: isPaidActive ? false : freePlanConfig.ambiguous || freeUsageAmbiguous,
      freePlanConfiguredLimit: freePlanConfig.configuredScanLimit,
      freePlanError: isPaidActive ? null : activeError,
    };
  } catch (err) {
    console.warn('[Store] getUserSubscription error:', err);
    return null;
  }
}

export async function cancelSubscriptionAtPeriodEnd(
  userId: string,
  subscriptionId?: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  if (subscriptionId) {
    const { error } = await supabase
      .from('user_plan_subscription')
      .update({
        cancel_at_period_end: true,
        cancelled_at: nowIso,
        updated_at: nowIso,
      })
      .eq('subscription_id', subscriptionId)
      .eq('status', 'active');
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('user_plan_subscription')
      .update({
        cancel_at_period_end: true,
        cancelled_at: nowIso,
        updated_at: nowIso,
      })
      .eq('user_id', userId)
      .eq('status', 'active');
    if (error) throw error;
  }
}

export async function resumeSubscription(
  userId: string,
  subscriptionId?: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  if (subscriptionId) {
    const { error } = await supabase
      .from('user_plan_subscription')
      .update({
        cancel_at_period_end: false,
        cancelled_at: null,
        updated_at: nowIso,
      })
      .eq('subscription_id', subscriptionId)
      .eq('status', 'active');
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('user_plan_subscription')
      .update({
        cancel_at_period_end: false,
        cancelled_at: null,
        updated_at: nowIso,
      })
      .eq('user_id', userId)
      .eq('status', 'active');
    if (error) throw error;
  }
}



export async function setUserSubscription(userId: string, record: SubscriptionRecord): Promise<void> {

  try {

    if (record.plan === 'free') {

      // Cancel active subscription in user_plan_subscription

      await supabase

        .from('user_plan_subscription')

        .update({

          status: 'cancelled',

          updated_at: new Date().toISOString(),

        })

        .eq('user_id', userId)

        .eq('status', 'active');

      return;

    }



    const { data: plans } = await supabase.from('plan').select('*');

    let targetPlan: any = record.planId
      ? plans?.find((p: any) => p.plan_id === record.planId) ?? null
      : null;

    if (targetPlan) {
      // Plan already resolved from the exact plan the patient paid for (record.planId).
    } else if (record.plan === 'premium' || record.plan === 'pro') {

      if (record.billingCycle === 'yearly') {

        targetPlan =

          plans?.find((p: any) => p.name.toLowerCase().includes('annual')) ||

          plans?.find((p: any) => p.plan_id === '00000000-0000-0000-0000-000000000004');

      } else {

        targetPlan =

          plans?.find((p: any) => p.name.toLowerCase() === 'pro') ||

          plans?.find((p: any) => p.plan_id === '00000000-0000-0000-0000-000000000003');

      }

    } else {

      targetPlan = plans?.find((p: any) => p.name.toLowerCase().includes(record.plan));

    }



    if (!targetPlan) {

      targetPlan = plans?.find((p: any) => p.name.toLowerCase() === 'pro') || plans?.[0];

    }



    const now = new Date();

    const periodEnd = new Date(now);

    if (record.billingCycle === 'yearly') {

      periodEnd.setFullYear(periodEnd.getFullYear() + 1);

    } else {

      periodEnd.setMonth(periodEnd.getMonth() + 1);

    }



    if (targetPlan) {

      const subRow = {

        user_id: userId,

        plan_id: targetPlan.plan_id,

        status: 'active',

        billing_cycle: record.billingCycle || 'monthly',

        started_at: now.toISOString(),

        current_period_start: now.toISOString(),

        current_period_end: periodEnd.toISOString(),

        renews_at: periodEnd.toISOString(),

        payment_method: record.paymentMethod || 'GCash',

        updated_at: now.toISOString(),

      };



      const { error: upsertErr } = await supabase

        .from('user_plan_subscription')

        .upsert(subRow, { onConflict: 'user_id' });



      if (upsertErr) {

        await supabase.from('user_plan_subscription').insert(subRow);

      }



      await supabase

        .from('user')

        .update({ updated_at: now.toISOString() })

        .eq('user_id', userId);

    }

  } catch (err: any) {

    console.error('[Store] Failed to save subscription for user:', userId, err?.message ?? err);

    throw err;

  }

}



export async function getAppointments(userId: string): Promise<Appointment[]> {

  try {

    const { data, error } = await supabase

      .from('patient_appointment')

      .select(`

        appointment_id,

        user_id,

        clinic_id,

        assigned_doctor_id,

        date,

        time,

        batch_time,

        queue_number,

        check_in_status,

        doctor_status,

        doctor_note,

        clinic_note,

        status,

        patient_name,

        patient_email,

        patient_contact,

        patient_address,

        notes,

        skin_photo_url,

        ai_condition_name,

        ai_confidence,

        created_at,

        clinic:clinic_id (name, address, phone),

        doctor:assigned_doctor_id (doctor_name, photo_url, prc_license)

      `)

      .eq('user_id', userId)

      .order('created_at', { ascending: false });



    if (error || !data) return [];



    return data.map((a: any) => ({

      id: a.appointment_id,

      userId: a.user_id,

      clinicId: a.clinic_id,

      clinicName: a.clinic?.name || 'Dermatology Clinic',

      clinicAddress: a.clinic?.address || '',

      clinicPhone: a.clinic?.phone || '',

      assignedDoctorId: a.assigned_doctor_id,

      doctorName: a.doctor?.doctor_name || undefined,

      doctorPhotoUrl: a.doctor?.photo_url || undefined,

      doctorPrcLicense: a.doctor?.prc_license || undefined,

      consultationType: 'face-to-face',

      conditionName: a.ai_condition_name || undefined,

      notes: a.notes || undefined,

      clinicNote: a.clinic_note || a.doctor_note || undefined,

      patientName: a.patient_name || undefined,

      patientEmail: a.patient_email || undefined,

      patientAddress: a.patient_address || undefined,

      patientContact: a.patient_contact || undefined,

      date: a.date ? (typeof a.date === 'string' && a.date.includes('T') ? a.date.split('T')[0] : a.date) : undefined,

      time: a.batch_time || a.time || undefined,

      batchTime: a.batch_time || undefined,

      queueNumber: a.queue_number || undefined,

      checkInStatus: a.check_in_status || 'scheduled',

      doctorStatus: a.doctor_status || undefined,

      status: a.status || 'pending',

      skinPhotoUri: a.skin_photo_url || undefined,

      paymentStatus: (a.payment_status || (a.clinic_note && a.clinic_note.includes('Paid online') ? 'paid' : undefined)) as any,

      paymentReference: a.payment_reference || (a.clinic_note ? (a.clinic_note.match(/Ref:\s*([^,\s)]+)/)?.[1] || undefined) : undefined),

      paymentAmount: a.payment_amount != null ? Number(a.payment_amount) : (a.clinic_note ? (a.clinic_note.match(/Amount:\s*[₱P]?([0-9.]+)/)?.[1] ? Number(a.clinic_note.match(/Amount:\s*[₱P]?([0-9.]+)/)[1]) : undefined) : undefined),

      paidAt: a.paid_at || undefined,

      createdAt: a.created_at,

    }));

  } catch (err) {

    console.warn('[Store] getAppointments error:', err);

    return [];

  }

}



export async function saveAppointment(appt: Partial<Appointment> & { userId: string; [key: string]: any }): Promise<string> {

  try {

    const rawTime = appt.batchTime || appt.time || '09:00';

    const timeFormatted = rawTime.includes(':') ? (rawTime.split(':').length === 2 ? `${rawTime}:00` : rawTime) : '09:00:00';

    const rawDate = appt.date || new Date().toISOString().split('T')[0];

    const dateFormatted = rawDate.includes('T') ? rawDate : `${rawDate}T${timeFormatted.slice(0, 5)}:00+08:00`;



    const payload: any = {

      user_id: appt.userId,

      clinic_id: appt.clinicId || null,

      assigned_doctor_id: appt.assignedDoctorId || null,

      date: dateFormatted,

      time: timeFormatted,

      batch_time: rawTime.slice(0, 5),

      ...(appt.queueNumber != null ? { queue_number: appt.queueNumber } : (!appt.id ? { queue_number: 1 } : {})),

      check_in_status: appt.checkInStatus || 'scheduled',

      status: appt.status || 'pending',

      doctor_status: 'pending-review',

      schedule_sent_to_doctor: true,

      patient_name: appt.patientName || null,

      patient_email: appt.patientEmail || null,

      patient_contact: appt.patientContact || null,

      patient_address: appt.patientAddress || null,

      patient_gender: appt.patientGender || null,

      patient_birthdate: appt.patientBirthdate || null,

      emergency_contact_name: (appt as any).emergencyContactName || null,

      emergency_contact_phone: (appt as any).emergencyContactPhone || null,

      emergency_contact_relationship: (appt as any).emergencyContactRelationship || null,

      primary_scan_id: (appt as any).primaryScanId || null,

      condition_id: appt.conditionId || (appt as any).condition_id || null,

      ai_condition_name: appt.conditionName || (appt as any).ai_condition_name || null,

      ai_confidence: (appt as any).confidence != null ? Number((appt as any).confidence) : ((appt as any).ai_confidence != null ? Number((appt as any).ai_confidence) : null),

      questionnaire_answers: (appt as any).questionnaireAnswers || (appt as any).questionnaire_answers || null,

      notes: appt.notes || null,

      clinic_note: appt.clinicNote || (appt.doctorName ? `Assigned to ${appt.doctorName} for pre-consultation review.` : null),

      skin_photo_url: appt.skinPhotoUri || null,

    };



    if ((appt as any).paymentStatus || (appt as any).payment_status) {

      payload.payment_status = (appt as any).paymentStatus || (appt as any).payment_status;

      payload.payment_reference = (appt as any).paymentReference || (appt as any).payment_reference || null;

      payload.payment_amount = (appt as any).paymentAmount != null ? Number((appt as any).paymentAmount) : null;

      payload.paid_at = (appt as any).paidAt || (appt as any).paid_at || new Date().toISOString();

    }



    if (appt.id && !appt.id.startsWith('appt_') && appt.id.includes('-')) {

      payload.appointment_id = appt.id;

      const { data, error } = await supabase

        .from('patient_appointment')

        .upsert(payload)

        .select('appointment_id')

        .single();

      if (error) throw error;

      return data.appointment_id;

    } else {

      let insertPayload = { ...payload };

      for (let attempt = 0; attempt < 5; attempt++) {

        const { data, error } = await supabase

          .from('patient_appointment')

          .insert(insertPayload)

          .select('appointment_id')

          .maybeSingle();



        if (!error && data?.appointment_id) {

          return data.appointment_id;

        }



        if (error) {

          const missingColMatch =

            error.message.match(/Could not find the '([^']+)' column/i) ||

            error.message.match(/column patient_appointment\.([^ ]+) does not exist/i) ||

            error.message.match(/column \"([^\"]+)\" of relation \"patient_appointment\" does not exist/i);

          if (missingColMatch && missingColMatch[1]) {

            delete insertPayload[missingColMatch[1]];

            continue;

          }

          const candidateCols = [

            'paid_at',

            'payment_amount',

            'payment_reference',

            'payment_status',

            'payment_hold_expires_at',

            'primary_scan_id',

            'check_in_status',

            'batch_time',

            'emergency_contact_name',

            'emergency_contact_phone',

            'emergency_contact_relationship',

            'patient_gender',

            'patient_birthdate',

          ];

          let strippedCandidate = false;

          for (const col of candidateCols) {

            if (error.message.includes(col) && insertPayload[col] !== undefined) {

              delete insertPayload[col];

              strippedCandidate = true;

            }

          }

          if (strippedCandidate) {

            continue;

          }

          throw error;

        }

        break;

      }

      return 'appt_' + Date.now();

    }

  } catch (err: any) {

    console.error('[Store] saveAppointment error:', err?.message ?? err);

    throw err;

  }

}



export async function cancelAppointment(appointmentId: string): Promise<void> {
  let apptInfo: any = null;
  try {
    const { data } = await supabase
      .from('patient_appointment')
      .select('appointment_id, user_id, clinic_name, doctor_name, appointment_date, appointment_time, patient_name')
      .eq('appointment_id', appointmentId)
      .maybeSingle();
    apptInfo = data;
  } catch (_) {}

  const result = await releaseAppointmentHoldSafely(appointmentId, {
    confirmedCancelledOrFailed: true,
  });
  if (!result.success && !result.alreadyInactive) {
    throw new Error(result.message || result.code || 'Failed to cancel appointment');
  }

  if (apptInfo) {
    logAuditEvent({
      user_id: apptInfo.user_id,
      user_type: 'patient',
      performer_name: apptInfo.patient_name || 'Patient',
      action: 'Appointment Cancelled',
      log_type: 'appointment',
      target: `${apptInfo.clinic_name || 'Clinic'} - ${apptInfo.appointment_date || ''} ${apptInfo.appointment_time || ''}`,
      details: `Cancelled appointment with ${apptInfo.doctor_name || apptInfo.clinic_name || 'doctor'} scheduled for ${apptInfo.appointment_date || ''}`,
      metadata: {
        appointment_id: appointmentId,
        platform: 'Mobile App',
      },
    }).catch(() => {});
  }
}

export async function rescheduleAppointment(
  appointmentId: string,
  newDate: string,
  newTime: string,
  reason?: string
): Promise<void> {
  let apptInfo: any = null;
  try {
    const { data } = await supabase
      .from('patient_appointment')
      .select('appointment_id, user_id, clinic_name, doctor_name, appointment_date, appointment_time, patient_name')
      .eq('appointment_id', appointmentId)
      .maybeSingle();
    apptInfo = data;
  } catch (_) {}

  const { error } = await supabase
    .from('patient_appointment')
    .update({
      appointment_date: newDate,
      appointment_time: newTime,
      batch_time: newTime,
      status: 'pending',
      notes: reason ? `Rescheduled: ${reason}` : undefined,
    })
    .eq('appointment_id', appointmentId);
  if (error) throw error;

  if (apptInfo) {
    logAuditEvent({
      user_id: apptInfo.user_id,
      user_type: 'patient',
      performer_name: apptInfo.patient_name || 'Patient',
      action: 'Appointment Reschedule Requested',
      log_type: 'appointment',
      target: `${apptInfo.clinic_name || 'Clinic'} - ${newDate} ${newTime}`,
      details: `Requested reschedule for appointment with ${apptInfo.doctor_name || apptInfo.clinic_name || 'doctor'} to ${newDate} at ${newTime}`,
      metadata: {
        appointment_id: appointmentId,
        new_date: newDate,
        new_time: newTime,
        reason,
        platform: 'Mobile App',
      },
    }).catch(() => {});
  }
}



export async function getAllAppointments(): Promise<Appointment[]> {

  const { data } = await supabase.from('patient_appointment').select('*');

  return (data || []) as any;

}



// ─── Notification Preferences ─────────────────────────────────────────────────

export async function getNotifPrefs(userId: string): Promise<NotifPrefs> {

  try {

    const { data } = await supabase

      .from('user_notification_settings')

      .select('*')

      .eq('user_id', userId)

      .maybeSingle();



    if (data) {

      return {

        appointmentReminders: data.appointment_reminders ?? true,

        scanResultAlerts: data.scan_alert ?? true,

      };

    }

  } catch {}

  return { appointmentReminders: true, scanResultAlerts: true };

}



export async function saveNotifPrefs(userId: string, prefs: NotifPrefs): Promise<void> {

  try {

    await supabase.from('user_notification_settings').upsert({

      user_id: userId,

      appointment_reminders: prefs.appointmentReminders,

      scan_alert: prefs.scanResultAlerts,

      updated_at: new Date().toISOString(),

    });

  } catch (err) {

    console.warn('[Store] saveNotifPrefs error:', err);

  }

}



// ─── Admin Notifications & Tickets ───────────────────────────────────────────

export async function pushAdminNotification(

  entry: Omit<AdminNotificationEntry, 'id' | 'timestamp' | 'read'>

): Promise<void> {

  try {

    await supabase.from('admin_alert').insert({

      type: entry.type,

      title: entry.title,

      description: entry.message,

      is_resolved: false,

    });

  } catch {}

}



export async function addHelpdeskTicket(
  ticket: Omit<HelpdeskTicket, 'id' | 'createdAt' | 'status'>
): Promise<{ id: string }> {
  const id = `ticket_${Date.now()}`;
  try {
    await supabase.from('user_support_ticket').insert({
      user_id: ticket.userId,
      subject: ticket.subject,
      message: ticket.message,
      status: 'open',
      category: ticket.category || 'General Support',
    });
  } catch (err) {
    console.warn('[Store] addHelpdeskTicket error:', err);
  }
  return { id };
}



// ─── App Notifications (Supabase + Realtime Synced) ───────────────────────────

const READ_NOTIFS_KEY_PREFIX = 'dermai_patient_read_ids_';



export async function getLocalReadIds(userId: string): Promise<Set<string>> {

  try {

    const raw = await AsyncStorage.getItem(`${READ_NOTIFS_KEY_PREFIX}${userId}`);

    if (raw) {

      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) return new Set(parsed);

    }

  } catch {}

  return new Set();

}



export async function saveLocalReadId(userId: string, id: string): Promise<void> {

  try {

    const set = await getLocalReadIds(userId);

    set.add(id);

    await AsyncStorage.setItem(`${READ_NOTIFS_KEY_PREFIX}${userId}`, JSON.stringify([...set]));

  } catch {}

}



export async function saveAllLocalReadIds(userId: string, ids: string[]): Promise<void> {

  try {

    const set = await getLocalReadIds(userId);

    ids.forEach((id) => set.add(id));

    await AsyncStorage.setItem(`${READ_NOTIFS_KEY_PREFIX}${userId}`, JSON.stringify([...set]));

  } catch {}

}



export function deduplicateAppNotificationItems(items: AppNotification[]): AppNotification[] {
  if (!Array.isArray(items) || items.length === 0) return [];

  const isUuid = (str: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

  const seenIds = new Set<string>();
  const seenBroadcastIds = new Set<string>();
  const seenContentKeys = new Set<string>();
  const seenApptActions = new Set<string>();

  // Sort so persistent database records with UUID IDs take precedence over synthetic fallback IDs
  const sorted = [...items].sort((a, b) => {
    const aIsUuid = isUuid(a.id);
    const bIsUuid = isUuid(b.id);
    if (aIsUuid && !bIsUuid) return -1;
    if (!aIsUuid && bIsUuid) return 1;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  const unique: AppNotification[] = [];

  for (const item of sorted) {
    if (!item || !item.id) continue;

    // A. Direct ID check
    if (seenIds.has(item.id)) continue;

    // B. Broadcast ID check
    const bId =
      item.metadata?.broadcast_id ||
      (item.id.startsWith('broadcast-') ||
      item.id.startsWith('clinic-broadcast-') ||
      item.id.startsWith('doc-broadcast-')
        ? item.id.replace(/^(clinic-|doc-)?broadcast-/, '')
        : undefined);

    if (bId) {
      if (seenBroadcastIds.has(bId)) continue;
      seenBroadcastIds.add(bId);
    }

    // B2. Appointment + Action deduplication
    const apptId =
      item.metadata?.appointment_id ||
      item.metadata?.appointmentId ||
      (item.id.startsWith('appt-rejected-')
        ? item.id.replace('appt-rejected-', '')
        : item.id.startsWith('appt-completed-')
        ? item.id.replace('appt-completed-', '')
        : item.id.startsWith('appt-cancelled-')
        ? item.id.replace('appt-cancelled-', '')
        : item.id.startsWith('appt-accepted-')
        ? item.id.replace('appt-accepted-', '')
        : undefined);

    const normType = (item.type || item.metadata?.type || '').toLowerCase().replace(/_/g, '-');
    const isDoctorAction = normType.includes('doctor-');

    const isRejectionAction =
      normType === 'appointment-rejected' ||
      normType === 'appointment-declined' ||
      item.metadata?.subtype === 'doctor-declined' ||
      item.metadata?.subtype === 'schedule-conflict' ||
      /review update|schedule conflict|declined|rejected/i.test(item.title || '');

    if (apptId && isRejectionAction) {
      const rejectKey = `${apptId}:::rejected`;
      if (seenApptActions.has(rejectKey)) continue;
      seenApptActions.add(rejectKey);
    } else if (apptId && (isDoctorAction || normType === 'appointment-cancelled' || normType === 'appointment-request')) {
      const apptActionKey = `${apptId}:::${normType}`;
      if (seenApptActions.has(apptActionKey)) continue;
      seenApptActions.add(apptActionKey);
    }

    // C. Content Fingerprint: normalized title + body
    const normTitle = (item.title || '').trim().toLowerCase();
    const normMsg = (item.message || '').trim().toLowerCase();
    const contentKey = `${normTitle}:::${normMsg}`;

    if (normTitle && normMsg && seenContentKeys.has(contentKey)) {
      continue;
    }

    seenIds.add(item.id);
    if (normTitle && normMsg) {
      seenContentKeys.add(contentKey);
    }
    unique.push(item);
  }

  return unique.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

export async function getAppNotifications(userId: string): Promise<AppNotification[]> {
  if (!userId) return [];

  const readSet = await getLocalReadIds(userId);
  const items: AppNotification[] = [];

  try {
    // Run notification + live clinic/admin avatar queries in parallel
    const [
      { data: dbNotifs, error: dbNotifsErr },
      { data: broadcasts },
      { data: appointments },
      { data: tickets },
      { data: scanRows },
      { data: clinicsData },
      { data: adminUsers },
    ] = await Promise.all([
      supabase
        .from('user_notification')
        .select('notif_id, type, subtype, title, body, is_read, metadata, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(40),

      supabase
        .from('admin_broadcast')
        .select('broadcast_id, title, message, audience, sent_at')
        .in('audience', ['all', 'patients', 'patient'])
        .order('sent_at', { ascending: false })
        .limit(10),

      supabase
        .from('patient_appointment')
        .select(`
          appointment_id,
          clinic_id,
          date,
          time,
          status,
          check_in_status,
          doctor_status,
          doctor_note,
          clinic_note,
          created_at,
          assigned_doctor_id,
          doctor_reviewed_at,
          questionnaire_answers,
          clinic:clinic_id (clinic_id, name, logo_url)
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20),

      supabase
        .from('user_support_ticket')
        .select('ticket_id, subject, response, status, updated_at, created_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(10),

      supabase
        .from('ai_scan_result')
        .select(`
          analysis_id,
          confidence_score,
          body_part,
          scanned_at,
          status,
          skin_condition:condition_id (
            name,
            local_name
          )
        `)
        .eq('user_id', userId)
        .eq('status', 'completed')
        .order('scanned_at', { ascending: false })
        .limit(20),

      supabase
        .from('clinic')
        .select('clinic_id, name, logo_url, clinic_photo (photo_url, sort_order)'),

      supabase
        .from('user')
        .select('user_id, full_name, avatar_url, email, role')
        .or('role.eq.admin,email.eq.dermaisupport@gmail.com,user_id.eq.03c4dbd4-5d15-4c78-872e-93811b3afa23')
        .limit(10),
    ]);

    if (dbNotifsErr) {
      console.warn('[Store] user_notification query error:', dbNotifsErr.message);
    }

    // Build live clinic lookup maps by clinic_id, normalized clinic name, and appointment_id
    const clinicById = new Map<string, { name: string; logo: string | null }>();
    const clinicByName = new Map<string, { name: string; logo: string | null }>();
    (clinicsData || []).forEach((c: any) => {
      const photos = Array.isArray(c.clinic_photo) ? c.clinic_photo : [];
      const fallbackPhoto = photos.length > 0 ? photos[0]?.photo_url : null;
      const rawLogo = c.logo_url || c.avatar_url || c.profile_image || fallbackPhoto || null;
      const resolvedLogo = rawLogo ? (resolveAvatarUrl(rawLogo) || rawLogo) : null;
      const entry = {
        name: c.name || 'Clinic',
        logo: resolvedLogo,
      };
      if (c.clinic_id != null) {
        clinicById.set(String(c.clinic_id), entry);
      }
      if (c.name) {
        clinicByName.set(String(c.name).trim().toLowerCase(), entry);
      }
    });

    // Build admin avatar lookup for support & broadcast notifications
    let defaultAdminAvatar: string | null = null;
    (adminUsers || []).forEach((au: any) => {
      if (!defaultAdminAvatar && au.avatar_url) {
        defaultAdminAvatar = resolveAvatarUrl(au.avatar_url) || au.avatar_url || null;
      }
    });

    // Build lookup maps for clinic enrichment & reselection status
    const clinicByApptId = new Map<string, { name: string; logo: string | null }>();
    const apptById = new Map<string, any>();
    (appointments || []).forEach((appt: any) => {
      if (!appt.appointment_id) return;
      apptById.set(String(appt.appointment_id), appt);
      const cObj = Array.isArray(appt.clinic) ? appt.clinic[0] : appt.clinic;
      const fromClinicDirectory =
        (appt.clinic_id != null ? clinicById.get(String(appt.clinic_id)) : undefined) ||
        (cObj?.name ? clinicByName.get(String(cObj.name).trim().toLowerCase()) : undefined);
      const rawLogo = cObj?.logo_url || fromClinicDirectory?.logo || null;
      const resolvedLogo = rawLogo ? (resolveAvatarUrl(rawLogo) || rawLogo) : null;
      clinicByApptId.set(String(appt.appointment_id), {
        name: cObj?.name || fromClinicDirectory?.name || 'Clinic',
        logo: resolvedLogo,
      });
    });

    const isApptReselectionResolved = (targetApptId?: string): boolean => {
      if (!targetApptId) return false;
      const appt = apptById.get(String(targetApptId));
      if (!appt) return false;
      const qa = appt.questionnaire_answers || {};
      if (
        qa.reselection_status === 'reselected' ||
        qa.reselection_required === false ||
        qa.workflow_status === 'pending_doctor_review'
      ) {
        return true;
      }
      const docSt = String(appt.doctor_status || '').toLowerCase();
      if (docSt && docSt !== 'rejected' && docSt !== 'declined' && docSt !== 'reselection_required') {
        return true;
      }
      return false;
    };

    // 1. Direct user_notification records for this patient
    if (dbNotifs) {
      dbNotifs.forEach((n: any) => {
        // Suppress all subscription/plan notifications (receipts & confirmations are handled strictly via email)
        if (
          n.type === 'subscription_expired' ||
          n.type === 'subscription-expired' ||
          n.subtype === 'subscription_expired' ||
          n.subtype === 'subscription-expired' ||
          n.type === 'subscription' ||
          n.subtype === 'subscription' ||
          n.subtype === 'subscription_upgraded' ||
          n.category === 'subscription' ||
          n.category === 'PLAN' ||
          n.metadata?.category === 'subscription' ||
          n.metadata?.category === 'PLAN' ||
          n.subtype?.includes('subscription') ||
          n.type?.includes('subscription') ||
          /pro subscription|subscription|plan activated|welcome to dermai pro/i.test(n.title || '')
        ) {
          return;
        }

        const isBroadcast = n.type === 'broadcast' || n.subtype === 'admin_announcement';
        const isMaintenance = n.subtype === 'maintenance_alert' || n.type === 'maintenance_alert';
        const isTicket =
          n.type === 'support_ticket' ||
          n.type === 'support' ||
          n.type === 'support-ticket-received' ||
          n.type === 'support_ticket_received' ||
          n.type === 'support-ticket-resolved' ||
          n.type === 'support_ticket_resolved' ||
          n.subtype === 'support' ||
          n.subtype === 'support_ticket' ||
          n.subtype === 'support-ticket-received' ||
          n.subtype === 'support_ticket_received' ||
          n.subtype === 'support-ticket-resolved' ||
          n.subtype === 'support_ticket_resolved' ||
          n.type?.includes('ticket') ||
          n.type?.includes('support') ||
          n.subtype?.includes('ticket') ||
          n.subtype?.includes('support') ||
          n.metadata?.category === 'support' ||
          n.metadata?.category === 'ticket' ||
          /support ticket|ticket received|ticket resolved|ticket updated/i.test(n.title || '');

        const isAdminSystem = isBroadcast || isMaintenance;

        const isApptCompleted =
          n.type === 'appointment-completed' ||
          n.type === 'appointment_completed' ||
          n.subtype === 'reviewed' ||
          n.subtype === 'appointment-completed';

        const isPaymentConfirmed =
          n.type === 'payment-confirmed' ||
          n.type === 'payment_confirmed' ||
          n.type === 'appointment-payment-confirmed' ||
          n.subtype === 'payment_confirmed' ||
          n.subtype === 'payment-confirmed' ||
          n.subtype === 'payment' ||
          /payment.*(confirm|verifi|receiv)/i.test(n.title || '') ||
          /payment.*(confirm|verifi)/i.test(n.subtype || '') ||
          /payment.*(confirm|verifi)/i.test(n.body || '');

        const isApptRejected =
          n.type === 'appointment-rejected' ||
          n.type === 'appointment_rejected' ||
          n.subtype === 'doctor-declined' ||
          n.subtype === 'doctor_declined' ||
          n.subtype === 'rejected' ||
          n.subtype === 'declined' ||
          n.subtype === 'schedule-conflict' ||
          n.subtype === 'schedule_conflict' ||
          /review update|schedule conflict|declined|rejected/i.test(n.title || '') ||
          /schedule conflict|consultation will be reassigned|was declined/i.test(n.body || '');

        const isScheduleApproved =
          !isApptCompleted &&
          !isApptRejected &&
          (
            n.type === 'appointment-scheduled' ||
            n.type === 'appointment_scheduled' ||
            n.type === 'appointment-accepted' ||
            n.type === 'appointment_accepted' ||
            n.type === 'appointment-approved' ||
            n.type === 'appointment_approved' ||
            n.type === 'doctor-confirmed-schedule' ||
            n.type === 'doctor_confirmed_schedule' ||
            n.type === 'schedule-confirmed' ||
            n.type === 'schedule_confirmed' ||
            n.subtype === 'doctor-confirmed-schedule' ||
            n.subtype === 'doctor_confirmed_schedule' ||
            n.subtype === 'appointment-approved' ||
            n.subtype === 'appointment_approved' ||
            n.subtype === 'schedule-confirmed' ||
            n.subtype === 'schedule_confirmed' ||
            n.subtype === 'confirmed' ||
            n.subtype === 'doctor-approved' ||
            n.subtype === 'doctor_approved' ||
            n.subtype === 'reassigned' ||
            /doctor confirmed schedule|appointment confirmed|schedule confirmed|reschedule request approved/i.test(n.title || '') ||
            /approved your consultation schedule|schedule.*confirmed|has been confirmed|has been reassigned/i.test(n.body || '')
          );

        const isApptMissed =
          n.type === 'appointment-missed' ||
          n.type === 'appointment_missed' ||
          n.type === 'appointment-no-show' ||
          n.type === 'appointment_no_show' ||
          n.type === 'no-show' ||
          n.type === 'no_show' ||
          n.subtype === 'appointment-missed' ||
          n.subtype === 'appointment_missed' ||
          n.subtype === 'appointment-no-show' ||
          n.subtype === 'appointment_no_show' ||
          n.subtype === 'no-show' ||
          n.subtype === 'no_show' ||
          /missed\s*\/\s*no-show|appointment marked as missed|no-show/i.test(n.title || '') ||
          /recorded as no-show|marked as missed/i.test(n.body || '');

        const isScan =
          n.type === 'scan' ||
          n.type === 'scan_result' ||
          n.type === 'scan-completed' ||
          n.category === 'scan' ||
          n.metadata?.category === 'skin_scan';

        const isSub =
          n.type === 'subscription' ||
          n.subtype === 'subscription' ||
          n.category === 'subscription';

        const needsClinicEnrichment = !isTicket && !isAdminSystem && (isApptCompleted || isPaymentConfirmed || isApptRejected || isScheduleApproved || isApptMissed || n.type?.includes('appointment'));

        const apptId = (n.metadata?.appointment_id || n.metadata?.appointmentId) as string | undefined;
        const metaClinicId = (n.metadata?.clinic_id || n.metadata?.clinicId) as string | undefined;
        const metaClinicName = (n.metadata?.clinic_name || n.metadata?.clinicName || n.metadata?.sender_name) as string | undefined;
        let clinicEnrichment: { name: string; logo: string | null; appointmentId?: string } | undefined;

        if (needsClinicEnrichment) {
          if (apptId) {
            const matchedClinic = clinicByApptId.get(String(apptId));
            if (matchedClinic) {
              clinicEnrichment = {
                name: matchedClinic.name,
                logo: matchedClinic.logo,
                appointmentId: apptId,
              };
            }
          }

          if (!clinicEnrichment && metaClinicId) {
            const matchedById = clinicById.get(String(metaClinicId));
            if (matchedById) {
              clinicEnrichment = {
                name: matchedById.name,
                logo: matchedById.logo,
                appointmentId: apptId,
              };
            }
          }

          if (!clinicEnrichment && metaClinicName) {
            const matchedByName = clinicByName.get(String(metaClinicName).trim().toLowerCase());
            if (matchedByName) {
              clinicEnrichment = {
                name: matchedByName.name,
                logo: matchedByName.logo,
                appointmentId: apptId,
              };
            }
          }

          if (!clinicEnrichment && clinicByName.size > 0) {
            const combinedText = `${n.title || ''} ${n.body || ''}`.toLowerCase();
            for (const [lowerName, entry] of clinicByName.entries()) {
              if (lowerName.length >= 3 && combinedText.includes(lowerName)) {
                clinicEnrichment = {
                  name: entry.name,
                  logo: entry.logo,
                  appointmentId: apptId,
                };
                break;
              }
            }
          }

          if (!clinicEnrichment && appointments && appointments.length > 0) {
            const notifTime = new Date(n.created_at).getTime();
            const closest = appointments.reduce((best: any, appt: any) => {
              const apptTime = new Date(appt.doctor_reviewed_at || appt.created_at || 0).getTime();
              const bestTime = new Date(best.doctor_reviewed_at || best.created_at || 0).getTime();
              return Math.abs(apptTime - notifTime) < Math.abs(bestTime - notifTime) ? appt : best;
            });
            const matchedClosest = clinicByApptId.get(String(closest.appointment_id));
            const cObj = Array.isArray(closest.clinic) ? closest.clinic[0] : closest.clinic;
            if (matchedClosest || cObj?.name) {
              clinicEnrichment = {
                name: matchedClosest?.name || cObj?.name || 'Clinic',
                logo: matchedClosest?.logo || (cObj?.logo_url ? (resolveAvatarUrl(cObj.logo_url) || cObj.logo_url) : null),
                appointmentId: closest.appointment_id,
              };
            }
          }
        }

        const resolvedApptId = apptId || clinicEnrichment?.appointmentId || n.metadata?.appointment_id;
        const isRejectedResolved =
          isApptRejected &&
          (Boolean(n.metadata?.reselection_resolved) || isApptReselectionResolved(resolvedApptId));

        const resolvedSenderName =
          (needsClinicEnrichment && clinicEnrichment?.name) ||
          n.metadata?.clinic_name ||
          n.metadata?.sender_name ||
          (isTicket ? 'DERMAI Support' : isAdminSystem ? 'Platform Administrator' : undefined);

        const rawMetadataAvatar =
          n.metadata?.clinic_logo ||
          n.metadata?.avatar_url ||
          n.metadata?.logo_url ||
          n.metadata?.profile_image ||
          n.metadata?.sender_avatar;
        const resolvedMetadataAvatar = rawMetadataAvatar
          ? (resolveAvatarUrl(rawMetadataAvatar) || rawMetadataAvatar)
          : undefined;

        const resolvedSenderAvatar =
          (needsClinicEnrichment && clinicEnrichment?.logo) ||
          resolvedMetadataAvatar ||
          (resolvedSenderName ? clinicByName.get(String(resolvedSenderName).trim().toLowerCase())?.logo : undefined) ||
          ((isTicket || isAdminSystem) && defaultAdminAvatar ? defaultAdminAvatar : undefined);

        items.push({
          id: n.notif_id,
          userId,
          type: isApptCompleted
            ? 'appointment-completed'
            : isPaymentConfirmed
            ? (n.type || 'appointment-payment-confirmed')
            : isApptRejected
            ? 'appointment-rejected'
            : isScheduleApproved
            ? (n.type || 'appointment-scheduled')
            : isApptMissed
            ? (n.type && n.type !== 'system' ? n.type : 'appointment-no-show')
            : isScan
            ? 'scan'
            : (n.type || 'general'),
          subtype: n.subtype || undefined,
          category: (!isTicket && (n.type?.includes('appointment') || needsClinicEnrichment))
            ? 'appointment'
            : isScan
            ? 'scan'
            : isTicket
            ? 'ticket'
            : isBroadcast || isMaintenance
            ? 'broadcast'
            : isSub
            ? 'subscription'
            : 'general',
          title: n.title || 'Notification',
          message: n.body || '',
          senderName: resolvedSenderName,
          senderType: needsClinicEnrichment ? 'clinic' : isTicket || isAdminSystem ? 'admin' : undefined,
          senderAvatar: resolvedSenderAvatar,
          timestamp: n.created_at || new Date().toISOString(),
          read: Boolean(n.is_read || readSet.has(n.notif_id) || isRejectedResolved),
          metadata: {
            ...n.metadata,
            appointment_id: resolvedApptId,
            reselection_resolved: isRejectedResolved,
          },
        });
      });
    }

    // 2. Live patient appointments from patient_appointment (synthetic fallback)
    if (appointments) {
      appointments.forEach((appt: any) => {
        const clinicObj = Array.isArray(appt.clinic) ? appt.clinic[0] : appt.clinic;
        const matchedClinic = clinicByApptId.get(String(appt.appointment_id));
        const clinicName = matchedClinic?.name || clinicObj?.name || 'Clinic';
        const clinicLogo =
          matchedClinic?.logo ||
          (clinicObj?.logo_url ? (resolveAvatarUrl(clinicObj.logo_url) || clinicObj.logo_url) : null);
        const dateStr = appt.date
          ? new Date(appt.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : 'scheduled date';
        const timeStr = appt.time ? ` at ${appt.time}` : '';

        // A. Confirmed / Accepted Appointment
        if (appt.status === 'confirmed' || appt.doctor_status === 'approved') {
          const notifId = `appt-accepted-${appt.appointment_id}`;
          items.push({
            id: notifId,
            userId,
            type: 'appointment-accepted',
            subtype: 'appointment-scheduled',
            category: 'appointment',
            title: `Appointment Confirmed`,
            message: `Your appointment at ${clinicName} on ${dateStr}${timeStr} has been confirmed.`,
            senderName: clinicName,
            senderType: 'clinic',
            senderAvatar: clinicLogo,
            timestamp: appt.created_at || new Date().toISOString(),
            read: readSet.has(notifId),
            metadata: { appointment_id: appt.appointment_id },
          });
        }

        // B1. Doctor-Initiated Decline
        if (appt.doctor_status === 'rejected' && appt.status !== 'cancelled' && !isApptReselectionResolved(appt.appointment_id)) {
          const notifId = `appt-rejected-${appt.appointment_id}`;
          const noteText = appt.doctor_note ? ` Note: "${appt.doctor_note}".` : '';
          const rejectMsg = `Your appointment request at ${clinicName} on ${dateStr} was declined.${noteText} You can select another available doctor within 24 hours. If no selection is made within 24 hours, the clinic will automatically assign an available doctor to your booking.`;

          items.push({
            id: notifId,
            userId,
            type: 'appointment-rejected',
            subtype: 'appointment-rejected',
            category: 'appointment',
            title: `Appointment Declined`,
            message: rejectMsg,
            senderName: clinicName,
            senderType: 'clinic',
            senderAvatar: clinicLogo,
            timestamp: appt.doctor_reviewed_at || appt.created_at || new Date().toISOString(),
            read: readSet.has(notifId),
            metadata: {
              appointment_id: appt.appointment_id,
              declined_at: appt.doctor_reviewed_at || appt.created_at || new Date().toISOString(),
            },
          });
        }

        // B2. Patient or Admin Cancellation
        if (appt.status === 'cancelled') {
          const notifId = `appt-cancelled-${appt.appointment_id}`;
          const noteText = appt.clinic_note ? ` Note: "${appt.clinic_note}".` : '';
          const cancelMsg = `Your consultation request with ${clinicName} on ${dateStr} was cancelled.${noteText}`;

          items.push({
            id: notifId,
            userId,
            type: 'appointment-cancelled',
            subtype: 'appointment-cancelled',
            category: 'appointment',
            title: `Appointment Cancelled`,
            message: cancelMsg,
            senderName: clinicName,
            senderType: 'clinic',
            senderAvatar: clinicLogo,
            timestamp: appt.created_at || new Date().toISOString(),
            read: readSet.has(notifId),
            metadata: { appointment_id: appt.appointment_id },
          });
        }

        // C. Completed Consultation
        if (appt.status === 'completed') {
          const notifId = `appt-completed-${appt.appointment_id}`;
          items.push({
            id: notifId,
            userId,
            type: 'appointment-completed',
            subtype: 'appointment-completed',
            category: 'appointment',
            title: `Consultation Completed`,
            message: `Your consultation at ${clinicName} has been concluded. Your doctor notes and final diagnosis are ready for review.`,
            senderName: clinicName,
            senderType: 'clinic',
            senderAvatar: clinicLogo,
            timestamp: appt.created_at || new Date().toISOString(),
            read: readSet.has(notifId),
            metadata: { appointment_id: appt.appointment_id },
          });
        }
      });
    }

    // 3. Support Ticket updates
    if (tickets) {
      tickets.forEach((ticket: any) => {
        const fullTicketId = String(ticket.ticket_id || '').toLowerCase();
        const shortTicketId = fullTicketId.slice(0, 8);
        const alreadyNotified = items.some((i) => {
          const metaTicketId = String(i.metadata?.ticket_id || '').toLowerCase();
          if (metaTicketId && (metaTicketId === fullTicketId || metaTicketId.includes(shortTicketId))) {
            return true;
          }
          if (i.category === 'ticket' || i.type?.includes('ticket')) {
            const bodyLower = (i.message || '').toLowerCase();
            if (shortTicketId && bodyLower.includes(shortTicketId)) return true;
          }
          return false;
        });

        if (
          !alreadyNotified &&
          (ticket.response || (ticket.status !== 'open' && ticket.status !== 'pending' && ticket.status !== 'submitted'))
        ) {
          const notifId = `ticket-update-${ticket.ticket_id}`;
          const replySummary = ticket.response ? ` Response: "${ticket.response}"` : '';
          items.push({
            id: notifId,
            userId,
            type: 'ticket-updated',
            subtype: 'ticket-update',
            category: 'ticket',
            title: `Support Ticket Updated`,
            message: `Your ticket "${ticket.subject}" is now ${ticket.status}.${replySummary}`,
            senderName: 'DERMAI Support',
            senderType: 'admin',
            senderAvatar: defaultAdminAvatar,
            timestamp: ticket.updated_at || ticket.created_at || new Date().toISOString(),
            read: readSet.has(notifId),
            metadata: { ticket_id: ticket.ticket_id },
          });
        }
      });
    }

    // 4. Broadcast announcements sent by administrator
    if (broadcasts) {
      broadcasts.forEach((b: any) => {
        const normBTitle = (b.title || '').trim().toLowerCase();
        const normBMsg = (b.message || '').trim().toLowerCase();
        const alreadyDelivered = items.some((i) => {
          if (i.metadata?.broadcast_id === b.broadcast_id) return true;
          const iTitle = (i.title || '').trim().toLowerCase();
          const iMsg = (i.message || '').trim().toLowerCase();
          return iTitle === normBTitle && iMsg === normBMsg;
        });
        if (alreadyDelivered) return;

        const notifId = `broadcast-${b.broadcast_id}`;
        items.push({
          id: notifId,
          userId,
          type: 'broadcast',
          subtype: 'admin_announcement',
          category: 'broadcast',
          title: b.title,
          message: b.message,
          senderName: 'Platform Administrator',
          senderType: 'admin',
          senderAvatar: defaultAdminAvatar,
          timestamp: b.sent_at || new Date().toISOString(),
          read: readSet.has(notifId),
          metadata: {
            broadcast_id: b.broadcast_id,
            subtype: 'admin_announcement',
          },
        });
      });
    }

    // 5. AI Skin Assessment (Scan) Results
    if (scanRows) {
      scanRows.forEach((s: any) => {
        const condObj = Array.isArray(s.skin_condition) ? s.skin_condition[0] : s.skin_condition;
        const conditionName = condObj?.name || 'Skin Condition';
        const rawConf = Number(s.confidence_score ?? 0);
        const confPercent = rawConf <= 1 && rawConf > 0 ? Math.round(rawConf * 100) : Math.round(rawConf);
        const bodyPartText = s.body_part ? ` on ${s.body_part}` : '';
        const notifId = `scan-${s.analysis_id}`;

        items.push({
          id: notifId,
          userId,
          type: 'scan_result',
          category: 'scan',
          title: `AI Skin Assessment: ${conditionName}`,
          message: `Detected ${conditionName}${bodyPartText} with ${confPercent}% confidence score.`,
          senderName: 'DERMAI AI Scanner',
          senderType: 'system',
          timestamp: s.scanned_at || new Date().toISOString(),
          read: true,
          metadata: {
            analysis_id: s.analysis_id,
            condition_name: conditionName,
            confidence_score: confPercent,
            body_part: s.body_part,
            category: 'skin_scan',
          },
        });
      });
    }
  } catch (err) {
    console.warn('[Store] getAppNotifications error:', err);
  }

  return deduplicateAppNotificationItems(items);
}

export async function addAppNotification(
  userId: string,
  notif: Omit<AppNotification, 'id' | 'timestamp' | 'read'>
): Promise<void> {
  try {
    await supabase.from('user_notification').insert({
      user_id: userId,
      type: notif.type,
      subtype: notif.subtype || null,
      title: notif.title,
      body: notif.message,
      is_read: false,
    });
  } catch (err) {
    console.warn('[Store] addAppNotification error:', err);
  }
}

export async function markAppNotificationRead(userId: string, id: string): Promise<void> {
  try {
    await saveLocalReadId(userId, id);

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUuid) {
      await supabase
        .from('user_notification')
        .update({ is_read: true })
        .eq('notif_id', id)
        .eq('user_id', userId);
    }
  } catch (err) {
    console.warn('[Store] markAppNotificationRead error:', err);
  }
}

export async function markAllAppNotificationsRead(userId: string, ids: string[]): Promise<void> {
  try {
    await saveAllLocalReadIds(userId, ids);

    // 1. Mark all unread DB notifications for this user in Supabase
    if (userId) {
      await supabase
        .from('user_notification')
        .update({ is_read: true })
        .eq('user_id', userId)
        .eq('is_read', false);
    }

    // 2. Also ensure explicit UUIDs are marked as read
    const uuidIds = ids.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
    if (uuidIds.length > 0) {
      await supabase
        .from('user_notification')
        .update({ is_read: true })
        .in('notif_id', uuidIds)
        .eq('user_id', userId);
    }
  } catch (err) {
    console.warn('[Store] markAllAppNotificationsRead error:', err);
  }
}

export function subscribeToAppNotifications(userId: string, onUpdate: () => void) {
  if (!userId) return () => {};

  // Same tables the website listens to (RLS limits events to this patient's own rows)
  const channel = supabase
    .channel(`mobile_notifs_${userId}_${Date.now()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_notification', filter: `user_id=eq.${userId}` }, () => onUpdate())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'patient_appointment', filter: `user_id=eq.${userId}` }, () => onUpdate())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_support_ticket', filter: `user_id=eq.${userId}` }, () => onUpdate())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_broadcast' }, () => onUpdate())
    .subscribe();

  // Fallback refresh whenever the app returns to the foreground
  const appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') onUpdate();
  });

  return () => {
    supabase.removeChannel(channel);
    appStateSub.remove();
  };
}

export async function syncAppointmentNotifications(

  _userId: string,

  _appointments: Appointment[],

): Promise<boolean> {

  // Live appointment statuses are now directly fetched from Supabase.

  return false;

}



export async function uploadProfileImage(_userId: string, imageUri: string): Promise<string> {

  return imageUri;

}



// ─── Clinics ──────────────────────────────────────────────────────────────────

export function resolveAvatarUrl(path?: string | null): string | undefined {
  if (!path || typeof path !== 'string') return undefined;
  const trimmed = path.trim();
  if (!trimmed) return undefined;

  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:')
  ) {
    return trimmed;
  }

  try {
    let bucket = 'avatars';
    let cleanPath = trimmed;

    if (trimmed.startsWith('avatars/')) {
      bucket = 'avatars';
      cleanPath = trimmed.replace(/^avatars\//, '');
    } else if (trimmed.startsWith('clinic-photos/')) {
      bucket = 'clinic-photos';
      cleanPath = trimmed.replace(/^clinic-photos\//, '');
    } else if (trimmed.startsWith('doctors/')) {
      bucket = 'clinic-photos';
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(cleanPath);
    return data?.publicUrl || undefined;
  } catch (err) {
    console.warn('[Store] Failed to resolve storage publicUrl:', trimmed, err);
    return undefined;
  }
}

export async function getClinics(): Promise<ClinicRecord[]> {

  try {

    const { data, error } = await supabase

      .from('clinic')

      .select(`

        clinic_id,

        name,

        address,

        phone,

        email,

        district,

        city,

        latitude,

        longitude,

        consultation_fee,

        logo_url,

        verified,

        status,

        description,

        clinic_photo (

          photo_url,

          sort_order

        ),

        clinic_service_offered (

          service_name

        ),

        clinic_doctor (

          doctor_id,

          doctor_name,

          email,

          photo_url,

          user_id,

          duty_days,

          duty_start_time,

          duty_end_time,

          duty_schedule,

          status,

          user:user_id (

            avatar_url

          ),

          doctor_specializations (

            specializations ( name )

          )

        ),

        clinic_operating_hours (

          day_of_week,

          open_time,

          close_time

        )

      `)

      .or('status.eq.approved,status.eq.verified,status.eq.active')

      .order('name', { ascending: true });



    if (error || !data || data.length === 0) {

      return SAMPLE_CLINICS.map((c) => ({

        ...c,

        id: String(c.id),

        doctors: c.doctors.map((d, i) => ({

          id: `doc_${i}`,

          name: d.name,

          specialization: d.specialization,

          dutyDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],

          dutyStartTime: '09:00',

          dutyEndTime: '17:00',

        })),

      }));

    }



    return data.map((c: any) => {

      const realServices = (c.clinic_service_offered || [])

        .map((s: any) => s.service_name)

        .filter(Boolean);



      const realDoctors = (c.clinic_doctor || [])

        .filter((d: any) => d.status === 'Active' || d.status === 'active' || !d.status)

        .map((d: any) => {

          const spec = Array.isArray(d.doctor_specializations)

            ? d.doctor_specializations

                .map((ds: any) => ds.specializations?.name || ds.specialization?.name)

                .filter(Boolean)

                .join(', ')

            : '';

          const rawPhoto = d.photo_url || undefined;
          const resolvedAvatar = resolveAvatarUrl(rawPhoto);

          return {

            id: d.doctor_id,

            name: d.doctor_name,

            specialization: spec || 'Dermatologist',

            dutyDays: d.duty_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],

            dutyStartTime: d.duty_start_time || '09:00',

            dutyEndTime: d.duty_end_time || '17:00',

            dutySchedule: d.duty_schedule,

            avatar_url: resolvedAvatar,

            avatarUrl: resolvedAvatar,

            photo_url: resolvedAvatar,

            userId: d.user_id,

          };

        });



      const photos = (c.clinic_photo || [])

        .map((p: any) => p.photo_url)

        .filter(Boolean);



      return {

        id: String(c.clinic_id),

        name: c.name,

        address: c.address || '',

        phone: c.phone || '',

        email: c.email || '',

        description: c.description || undefined,

        photos: photos.length > 0 ? photos : undefined,

        hours: c.clinic_operating_hours?.length

          ? `${c.clinic_operating_hours[0].day_of_week}: ${c.clinic_operating_hours[0].open_time} - ${c.clinic_operating_hours[0].close_time}`

          : 'Mon-Sat: 9:00 AM - 5:00 PM',

        verified: c.verified ?? false,

        district: c.district || 'Cebu City',

        city: c.city || 'Cebu City',

        lat: Number(c.latitude) || 10.3157,

        lng: Number(c.longitude) || 123.8854,

        consultationFee: c.consultation_fee ? String(c.consultation_fee) : '500',

        logoUrl: c.logo_url || undefined,

        doctors: realDoctors,

        operatingHours: c.clinic_operating_hours || [],

        openTime: c.clinic_operating_hours?.[0]?.open_time ? String(c.clinic_operating_hours[0].open_time).slice(0, 5) : '08:00',

        closeTime: c.clinic_operating_hours?.[0]?.close_time ? String(c.clinic_operating_hours[0].close_time).slice(0, 5) : '18:00',

        conditionsTreated: realServices.length > 0 ? realServices : ['General Dermatology', 'Acne Treatment', 'Skin Allergy'],

      };

    });

  } catch (err) {

    console.warn('[Store] getClinics fallback:', err);

    return SAMPLE_CLINICS.map((c) => ({

      ...c,

      id: String(c.id),

      doctors: c.doctors.map((d, i) => ({

        id: `doc_${i}`,

        name: d.name,

        specialization: d.specialization,

      })),

    }));

  }

}



// ─── Saved Clinics ────────────────────────────────────────────────────────────

export async function getSavedClinics(userId: string): Promise<string[]> {

  try {

    const { data } = await supabase

      .from('user_saved_clinic')

      .select('clinic_id')

      .eq('user_id', userId);

    return (data || []).map((d: any) => String(d.clinic_id));

  } catch {

    return [];

  }

}



export async function saveClinic(userId: string, clinicId: string | number): Promise<void> {

  try {

    await supabase.from('user_saved_clinic').upsert({

      user_id: userId,

      clinic_id: String(clinicId),

    });

  } catch (err) {

    console.warn('[Store] saveClinic error:', err);

  }

}



export async function unsaveClinic(userId: string, clinicId: string | number): Promise<void> {

  try {

    await supabase

      .from('user_saved_clinic')

      .delete()

      .eq('user_id', userId)

      .eq('clinic_id', String(clinicId));

  } catch (err) {

    console.warn('[Store] unsaveClinic error:', err);

  }

}



export async function getBillingHistory(userId?: string): Promise<BillingHistoryItem[]> {
  try {
    let effectiveUserId = userId || '';
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user?.id) {
        effectiveUserId = sessionData.session.user.id;
      }
    } catch {}

    if (!effectiveUserId) return [];

    const [paymentsRes, apptsRes] = await Promise.all([
      supabase
        .from('user_payment')
        .select(`
          payment_id,
          amount,
          payment_date,
          method,
          status,
          plan_id,
          billing_cycle,
          reference_number,
          paymongo_payment_id,
          plan:plan_id (
            price,
            name
          )
        `)
        .eq('user_id', effectiveUserId)
        .order('payment_date', { ascending: false }),
      supabase
        .from('patient_appointment')
        .select(`
          appointment_id,
          date,
          time,
          batch_time,
          status,
          payment_status,
          payment_method,
          payment_reference,
          payment_amount,
          patient_name,
          patient_contact,
          created_at,
          ai_condition_name,
          clinic_id,
          assigned_doctor_id,
          clinic:clinic_id ( name )
        `)
        .eq('user_id', effectiveUserId)
        .order('created_at', { ascending: false }),
    ]);

    const payments = paymentsRes.data || [];
    const userAppts = apptsRes.data || [];
    const historyList: BillingHistoryItem[] = [];

    if (payments.length > 0) {
      payments.forEach((p: any) => {
        const planObj = Array.isArray(p.plan) ? p.plan[0] : p.plan;
        const rawAmount = Number(p.amount ?? 0);

        let resolvedTotal = rawAmount;
        let resolvedBase = 0;
        let resolvedVat = 0;

        if (planObj?.price != null && Number(planObj.price) > 0) {
          const planBase = Number(planObj.price);
          const calc = calculatePricing(planBase);
          resolvedBase = calc.basePrice;
          resolvedVat = calc.vatAmount;
          resolvedTotal = calc.totalPrice;
        } else if (rawAmount === 177.68) {
          const calc = calculatePricing(177.68);
          resolvedBase = calc.basePrice;
          resolvedVat = calc.vatAmount;
          resolvedTotal = calc.totalPrice;
        } else if (rawAmount > 0) {
          const split = splitVat(rawAmount);
          resolvedBase = split.net;
          resolvedVat = split.vat;
          resolvedTotal = rawAmount;
        }

        const formattedAmount = `₱${resolvedTotal.toLocaleString('en-PH', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;

        const isAppointment = Boolean(!p.plan_id || !planObj || rawAmount === 500);
        const description = isAppointment
          ? 'Book Appointment'
          : planObj?.name
          ? `${planObj.name} Subscription`
          : 'DermAI Subscription';

        const dateIso = p.payment_date || new Date().toISOString();

        historyList.push({
          paymentId: String(p.payment_id || p.reference_number || p.paymongo_payment_id),
          paymentDate: dateIso,
          date: new Date(dateIso).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }),
          amount: formattedAmount,
          rawAmount,
          baseAmount: resolvedBase,
          vatAmount: resolvedVat,
          totalAmount: resolvedTotal,
          method: p.method || 'GCash',
          status: p.status === 'success' ? 'Paid' : String(p.status || 'Paid'),
          description,
          isAppointment,
          appointmentId: null,
          paymentReference: p.reference_number || null,
          paymongoPaymentId: p.paymongo_payment_id || null,
          billingCycle: p.billing_cycle === 'yearly' ? 'yearly' : 'monthly',
        });
      });
    }

    if (userAppts.length > 0) {
      userAppts.forEach((appt: any) => {
        const alreadyExists = historyList.some(
          (h) =>
            h.appointmentId === appt.appointment_id ||
            (h.paymentReference && h.paymentReference.includes(appt.appointment_id)) ||
            (appt.payment_reference &&
              (h.paymongoPaymentId === appt.payment_reference ||
                h.paymentReference === appt.payment_reference))
        );
        if (!alreadyExists) {
          const dateStr = appt.created_at || appt.date || new Date().toISOString();
          const fee = Number(appt.payment_amount) > 0 ? Number(appt.payment_amount) : 500;
          const split = splitVat(fee);
          historyList.push({
            paymentId: appt.appointment_id,
            paymentDate: dateStr,
            date: new Date(dateStr).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            }),
            amount: `₱${fee.toLocaleString('en-PH', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`,
            rawAmount: fee,
            baseAmount: split.net,
            vatAmount: split.vat,
            totalAmount: fee,
            method: appt.payment_method || 'GCash',
            status: appt.status === 'cancelled' ? 'Cancelled' : 'Paid',
            description: 'Book Appointment',
            isAppointment: true,
            appointmentId: appt.appointment_id,
            paymentReference:
              appt.payment_reference || `pay_${String(appt.appointment_id).replace(/-/g, '').slice(0, 16)}`,
            paymongoPaymentId:
              appt.payment_reference || `pay_${String(appt.appointment_id).replace(/-/g, '').slice(0, 16)}`,
          });
        }
      });
    }

    historyList.sort(
      (a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime()
    );
    return historyList;
  } catch (err) {
    console.warn('[Store] getBillingHistory error:', err);
    return [];
  }
}

export async function getUserPayments(userId: string): Promise<PlatformTransaction[]> {
  try {
    const history = await getBillingHistory(userId);
    return history.map((item) => ({
      id: item.paymentId,
      userId,
      amount: item.totalAmount,
      method: item.method,
      billingCycle: item.billingCycle || 'monthly',
      status: item.status.toLowerCase() === 'paid' ? 'paid' : (item.status.toLowerCase() as any),
      date: item.paymentDate,
      plan: item.description,
      userEmail: '',
      userName: '',
    }));
  } catch (err) {
    console.warn('[Store] getUserPayments error:', err);
    return [];
  }
}



export function generatePaymentReference(): string {

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  const randomHex = Math.random().toString(36).substring(2, 8).toUpperCase();

  return `TXN-${dateStr}-${randomHex}`;

}



export async function recordUserPayment(params: {

  userId: string;

  amount: number;

  method: 'gcash' | 'maya' | string;

  referenceNumber: string;

  clinicName?: string;

}): Promise<boolean> {

  try {

    const { error } = await supabase.from('user_payment').insert({

      user_id: params.userId,

      amount: params.amount,

      method: params.method.toLowerCase() === 'maya' ? 'Maya' : 'GCash',

      status: 'success',

      reference_number: params.referenceNumber,

      paymongo_payment_id: params.referenceNumber,

      payment_date: new Date().toISOString(),

    });

    if (error) {

      console.warn('[Store] recordUserPayment error:', error.message);

      return false;

    }

    return true;

  } catch (err) {

    console.warn('[Store] recordUserPayment exception:', err);

    return false;

  }

}



export async function getOccupiedSlotsForDate(

  clinicId: string,

  date: string,

  doctorId?: string

): Promise<any[]> {

  try {

    const { data, error } = await supabase.rpc('get_occupied_appointment_slots', {

      p_clinic_id: clinicId,

      p_date: date,

      p_doctor_id: doctorId || null,

    });

    if (error) {

      console.warn('[Store] getOccupiedSlotsForDate error:', error.message);

      return [];

    }

    return Array.isArray(data) ? data : [];

  } catch (err: any) {

    console.warn('[Store] getOccupiedSlotsForDate exception:', err?.message);

    return [];

  }

}



/**
 * Sanitizes patient-entered symptoms / reason for visit text.
 * Strictly guarantees that no payment metadata (e.g. [Payment: ...], Paid online via...)
 * is ever appended or persisted into the patient's symptoms or notes field.
 */
export function sanitizePatientSymptoms(text?: string | null): string | null {
  if (!text) return null;
  const clean = text
    .replace(/\[Payment:.*?\]/gi, '')
    .replace(/(?:^|\n)?\s*Payment:\s*Paid online[^\n\r]*/gi, '')
    .trim();
  return clean || null;
}

export async function acquireAppointmentSlotHold(params: {

  clinicId: string;

  doctorId?: string;

  date: string;

  time: string;

  batchTime?: string;

  patientName: string;

  patientEmail?: string;

  patientContact?: string;

  patientAddress?: string;

  patientGender?: string;

  patientBirthdate?: string;

  emergencyContactName?: string;

  emergencyContactPhone?: string;

  emergencyContactRelationship?: string;

  notes?: string;

  clinicNote?: string;

  questionnaireAnswers?: any;

  skinPhotoUrl?: string;

  aiConditionName?: string;

  aiConfidence?: number;

  conditionId?: string;

  primaryScanId?: string;

  holdDurationMinutes?: number;

  userId?: string;

}): Promise<{

  success: boolean;

  appointmentId?: string;

  paymentReference?: string;

  paymentAmount?: number;

  holdExpiresAt?: string;

  message?: string;

  code?: string;

}> {

  const isValidUuid = (val?: string | null): boolean => {

    if (!val) return false;

    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(val).trim());

  };



  const timeFormatted = params.time.includes(':')

    ? (params.time.split(':').length === 2 ? params.time + ':00' : params.time)

    : '09:00:00';



  const rpcPayload = {

    p_clinic_id: params.clinicId,

    p_doctor_id: isValidUuid(params.doctorId) ? params.doctorId : null,

    p_date: params.date,

    p_time: timeFormatted,

    p_batch_time: params.batchTime || params.time.slice(0, 5),

    p_patient_name: params.patientName,

    p_patient_email: params.patientEmail || null,

    p_patient_contact: params.patientContact || null,

    p_patient_address: params.patientAddress || null,

    p_patient_gender: params.patientGender || null,

    p_patient_birthdate: params.patientBirthdate || null,

    p_emergency_contact_name: params.emergencyContactName || null,

    p_emergency_contact_phone: params.emergencyContactPhone || null,

    p_emergency_contact_relationship: params.emergencyContactRelationship || null,

    p_notes: sanitizePatientSymptoms(params.notes),

    p_clinic_note: params.clinicNote || null,

    p_questionnaire_answers: params.questionnaireAnswers || null,

    p_skin_photo_url: params.skinPhotoUrl || null,

    p_ai_condition_name: params.aiConditionName || null,

    p_ai_confidence: params.aiConfidence != null ? params.aiConfidence : null,

    p_condition_id: isValidUuid(params.conditionId) ? params.conditionId : null,

    p_primary_scan_id: isValidUuid(params.primaryScanId) ? params.primaryScanId : null,

    p_hold_duration_minutes: params.holdDurationMinutes || 10,

    p_user_id: isValidUuid(params.userId) ? params.userId : null,

  };



  try {

    const { data, error } = await supabase.rpc('acquire_appointment_slot_hold', rpcPayload);

    if (!error && data) {

      if (typeof data === 'object') {

        if (data.success) {

          return {

            success: true,

            appointmentId: data.appointment_id,

            paymentReference: data.payment_reference,

            paymentAmount: Number(data.payment_amount ?? data.fee ?? 500),

            holdExpiresAt: data.hold_expires_at,

          };

        } else {

          return {

            success: false,

            code: data.code || data.error || 'HOLD_FAILED',

            message: data.message || 'Failed to acquire appointment hold.',

          };

        }

      }

    }

    if (error) {

      return {

        success: false,

        code: error.code || 'DB_ERROR',

        message: error.message || 'Database error acquiring slot hold.',

      };

    }

  } catch (err: any) {

    return {

      success: false,

      code: 'EXCEPTION',

      message: err?.message || 'Error acquiring slot hold.',

    };

  }



  return { success: false, message: 'Could not acquire slot hold.' };

}



export interface ReleaseHoldOptions {

  reason?: string;

  confirmedCancelledOrFailed?: boolean;

  paymentIntentId?: string;

  clientKey?: string;

}



/**

 * Safely and idempotently releases a temporary slot hold after a failed or cancelled checkout.

 * Enforces:

 * 1. An appointment is NEVER cancelled if it has already been marked 'paid' in DB or PayMongo.

 * 2. If payment status is uncertain or verification timed out, the hold is preserved.

 * 3. Authoritative RPC 'cancel_appointment_hold' is prioritized with row-level locks.

 * 4. Cancellation is strictly idempotent.

 */

export async function releaseAppointmentHoldSafely(

  appointmentId: string | null | undefined,

  options?: ReleaseHoldOptions

): Promise<{

  success: boolean;

  message?: string;

  code?: string;

  alreadyPaid?: boolean;

  alreadyInactive?: boolean;

}> {

  if (!appointmentId) {

    return { success: true, message: 'No appointment ID to release.' };

  }



  // 1. Guard against releasing holds when payment status is uncertain or unverified

  if (options && options.confirmedCancelledOrFailed === false) {

    return {

      success: false,

      code: 'ERR_HOLD_PRESERVED',

      message: 'Hold preserved: payment status is uncertain.',

    };

  }



  // 1B. Server-side authoritative verification via paymongo-payment Edge Function

  try {

    const { data: edgeData, error: edgeErr } = await supabase.functions.invoke('paymongo-payment', {

      body: {

        action: 'safe_cancel_booking_hold',

        appointmentId,

        paymentIntentId: options?.paymentIntentId,

        clientKey: options?.clientKey,

      },

    });

    if (!edgeErr && edgeData) {

      if (edgeData.alreadyPaid || edgeData.code === 'ERR_ALREADY_PAID') {

        return {

          success: false,

          code: 'ERR_ALREADY_PAID',

          alreadyPaid: true,

          message: edgeData.message || 'Payment has succeeded on PayMongo; hold cannot be cancelled.',

        };

      }

      if (edgeData.code === 'ERR_PAYMENT_UNCERTAIN' || edgeData.code === 'ERR_HOLD_PRESERVED') {

        return {

          success: false,

          code: edgeData.code,

          message: edgeData.message || 'Payment is currently in progress; hold preserved.',

        };

      }

      if (edgeData.success) {

        return {

          success: true,

          message: edgeData.message || 'Hold successfully cancelled.',

        };

      }

      return {

        success: false,

        code: edgeData.code || 'ERR_CANCEL_REFUSED',

        message: edgeData.message || 'Hold cancellation was refused.',

      };

    }

  } catch (edgeInvokeErr) {

    console.warn('[store] safe_cancel_booking_hold Edge Function invoke warning:', edgeInvokeErr);

  }



  // 2. If paymentIntentId and clientKey are provided, verify with PayMongo directly

  if (options?.paymentIntentId && options?.clientKey) {

    try {

      const check = await verifyPayMongoIntentOnce(options.paymentIntentId, options.clientKey);

      if (check.status === 'succeeded') {

        console.warn(`[store] PayMongo intent ${options.paymentIntentId} already succeeded! Refusing hold release.`);

        return {

          success: false,

          code: 'ERR_ALREADY_PAID',

          alreadyPaid: true,

          message: 'Payment has succeeded on PayMongo; hold cannot be cancelled.',

        };

      }

      if (check.status === 'awaiting_next_action' || check.status === 'processing' || check.status === 'awaiting_payment_method') {

        console.warn(`[store] PayMongo intent ${options.paymentIntentId} is still in flight (${check.status}); preserving hold.`);

        return {

          success: false,

          code: 'ERR_PAYMENT_UNCERTAIN',

          message: 'Payment is currently in progress; hold preserved.',

        };

      }

    } catch (checkErr) {

      console.warn('[store] PayMongo pre-cancellation check failed; preserving hold:', checkErr);

      return {

        success: false,

        code: 'ERR_PAYMENT_UNCERTAIN',

        message: 'Could not verify payment status; hold preserved.',

      };

    }

  }



  try {

    // 3. Authoritative database pre-check: verify record exists and is not already paid

    const { data: currentAppt, error: checkErr } = await supabase

      .from('patient_appointment')

      .select('appointment_id, payment_status, status')

      .eq('appointment_id', appointmentId)

      .maybeSingle();



    if (checkErr) {

      console.warn('[store] Hold pre-check warning:', checkErr.message);

    }



    if (currentAppt) {

      // Guard: NEVER cancel an appointment that has been marked paid

      if (currentAppt.payment_status === 'paid') {

        console.warn(`[store] Appointment ${appointmentId} is already paid; skipping release.`);

        return {

          success: false,

          code: 'ERR_ALREADY_PAID',

          alreadyPaid: true,

          message: 'Appointment is already paid.',

        };

      }



      // Idempotency: if already cancelled or expired, return early

      if (

        currentAppt.payment_status === 'cancelled' ||

        currentAppt.payment_status === 'expired' ||

        currentAppt.status === 'cancelled'

      ) {

        return {

          success: true,

          alreadyInactive: true,

          message: 'Hold is already inactive.',

        };

      }

    }



    // 4. Attempt atomic RPC cancel_appointment_hold

    const { data: rpcData, error: rpcErr } = await supabase.rpc('cancel_appointment_hold', {

      p_appointment_id: appointmentId,

    });



    if (!rpcErr && rpcData?.success) {

      return { success: true, message: rpcData.message };

    }



    return {

      success: false,

      code: rpcData?.code || rpcData?.error || rpcErr?.code,

      alreadyPaid: (rpcData?.code || '').toUpperCase() === 'ERR_ALREADY_PAID',

      message: rpcData?.message || rpcErr?.message || 'Failed to cancel hold',

    };

  } catch (err: any) {

    return {

      success: false,

      code: 'EXCEPTION',

      message: err?.message || 'Error releasing hold',

    };

  }

}



export async function cancelAppointmentSlotHold(

  appointmentId: string,

  options?: ReleaseHoldOptions

): Promise<{ success: boolean; message?: string; code?: string; alreadyPaid?: boolean }> {

  return releaseAppointmentHoldSafely(appointmentId, {

    confirmedCancelledOrFailed: options?.confirmedCancelledOrFailed ?? true,

    ...options,

  });

}

