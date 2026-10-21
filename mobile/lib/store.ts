import AsyncStorage from '@react-native-async-storage/async-storage';
import { evaluateDiseaseMapping, normalizeAnswers } from '@/lib/diseaseMappingService';
import { getConditionGuide } from '@/lib/conditionGuides';
import { CONDITION_UUIDS, getConditionUUID } from '@/lib/aiApi';
import { supabase } from '@/lib/supabase';
import { SAMPLE_CLINICS } from '@/lib/constants';

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
  scanLimit?: number;
  isDemoAccount?: boolean;
  status?: string;
  cardLast4?: string;
  cardExpiry?: string;
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
}

// ─── Auth Functions ───────────────────────────────────────────────────────────
export async function getCurrentUserEmail(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email ?? null;
}

export async function clearCurrentUser(): Promise<void> {
  try {
    await supabase.auth.signOut();
  } catch (err: any) {
    console.error('[Store] Sign out error:', err?.message);
    throw err;
  }
}

export async function getCurrentUser(): Promise<PatientAccount | null> {
  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return null;

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

    return {
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
  } catch (err) {
    console.warn('[Store] getCurrentUser exception:', err);
    return null;
  }
}

export async function savePatientAccount(account: PatientAccount): Promise<void> {
  try {
    // 1. Fetch existing user row and auth metadata so we never wipe out fields when logging in
    const { data: existing } = await supabase
      .from('user')
      .select('*')
      .eq('user_id', account.id)
      .maybeSingle();

    const { data: authData } = await supabase.auth.getUser();
    const meta = authData?.user?.user_metadata || {};

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

    const results: ScanResult[] = await Promise.all(
      data.map(async (s: any) => {
        const condObj = Array.isArray(s.skin_condition) ? s.skin_condition[0] : s.skin_condition;
        let imageUrl = s.photo_url || undefined;
        let wideImageUrl = s.photo_url_wide || undefined;

        if (imageUrl && !imageUrl.startsWith('http') && !imageUrl.startsWith('file:') && !imageUrl.startsWith('data:')) {
          try {
            const { data: signed } = await supabase.storage
              .from('scan-uploads')
              .createSignedUrl(imageUrl, 3600);
            if (signed?.signedUrl) imageUrl = signed.signedUrl;
          } catch {}
        }

        if (wideImageUrl && !wideImageUrl.startsWith('http') && !wideImageUrl.startsWith('file:') && !wideImageUrl.startsWith('data:')) {
          try {
            const { data: signedWide } = await supabase.storage
              .from('scan-uploads')
              .createSignedUrl(wideImageUrl, 3600);
            if (signedWide?.signedUrl) wideImageUrl = signedWide.signedUrl;
          } catch {}
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
      })
    );
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

    if (error) console.warn('[Store] saveScanResult insert error:', error.message);

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
    const isPaid = sub?.plan === 'premium' || sub?.plan === 'pro' || sub?.scanLimit === -1;
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
export async function getUserSubscription(userId: string): Promise<SubscriptionRecord | null> {
  try {
    // 1. Query active subscription first (prioritize status = 'active')
    let { data, error } = await supabase
      .from('user_plan_subscription')
      .select('*, plan:plan_id(*)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // 2. If no active row found, fetch latest subscription row
    if (!data) {
      const fallback = await supabase
        .from('user_plan_subscription')
        .select('*, plan:plan_id(*)')
        .eq('user_id', userId)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      data = fallback.data;
      error = fallback.error;
    }

    const { data: u } = await supabase.from('user').select('email, free_scans_used').eq('user_id', userId).maybeSingle();

    if (!data || error) {
      return {
        userId,
        email: u?.email || '',
        plan: 'free',
        billingCycle: 'monthly',
        scansUsed: u?.free_scans_used ?? 0,
        scanLimit: 3,
        status: 'active',
      };
    }

    let planObj: any = Array.isArray(data.plan) ? data.plan[0] : data.plan;

    // Fallback: If join didn't populate planObj, query plan table by plan_id
    if (!planObj && data.plan_id) {
      try {
        const { data: p } = await supabase.from('plan').select('*').eq('plan_id', data.plan_id).maybeSingle();
        if (p) planObj = p;
      } catch {}
    }

    const pName = (planObj?.name || '').toLowerCase();
    const status = String(data.status || '').toLowerCase();
    const periodEndRaw = data.current_period_end || data.renews_at;
    const periodEndMs = periodEndRaw ? new Date(periodEndRaw).getTime() : null;
    const isLapsed = periodEndMs !== null ? periodEndMs <= Date.now() : false;
    const isActive = (status === 'active' || status === 'cancelling' || status === 'pending_downgrade') && !isLapsed;

    // Purely dynamic determination from live Supabase plan attributes
    const isProOrPremium =
      isActive &&
      (planObj?.scan_limit === -1 ||
        Number(planObj?.price ?? 0) > 0 ||
        pName.includes('pro') ||
        pName.includes('premium') ||
        pName.includes('annual'));

    const isBasic = isActive && pName.includes('basic') && planObj?.scan_limit !== -1;

    const planType: 'free' | 'basic' | 'pro' | 'premium' = isProOrPremium
      ? 'premium'
      : isBasic
      ? 'basic'
      : 'free';

    const isYearly =
      data.billing_cycle === 'yearly' ||
      planObj?.billing_type === 'yearly' ||
      pName.includes('annual') ||
      pName.includes('yearly');

    return {
      userId,
      email: u?.email || '',
      plan: planType,
      billingCycle: isYearly ? 'yearly' : 'monthly',
      startDate: data.started_at,
      endDate: periodEndRaw || data.renews_at,
      status: data.status,
      scansUsed: u?.free_scans_used ?? 0,
      scanLimit: isProOrPremium ? -1 : (planObj?.scan_limit ?? 3),
    };
  } catch (err) {
    console.warn('[Store] getUserSubscription error:', err);
    return null;
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

      if (record.scansUsed !== undefined) {
        await supabase
          .from('user')
          .update({ free_scans_used: record.scansUsed })
          .eq('user_id', userId);
      }
      return;
    }

    const { data: plans } = await supabase.from('plan').select('*');
    let targetPlan: any = null;
    if (record.plan === 'premium' || record.plan === 'pro') {
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
        payment_method: 'Credit / Debit Card',
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
      queue_number: appt.queueNumber || 1,
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
  const { error } = await supabase
    .from('patient_appointment')
    .update({ status: 'cancelled' })
    .eq('appointment_id', appointmentId);
  if (error) throw error;
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

export async function getAppNotifications(userId: string): Promise<AppNotification[]> {
  if (!userId) return [];
  const readSet = await getLocalReadIds(userId);
  const items: AppNotification[] = [];

  try {
    // 1. Direct user_notification records for this patient
    const { data: dbNotifs } = await supabase
      .from('user_notification')
      .select('notif_id, type, subtype, title, body, is_read, created_at, metadata')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(40);

    if (dbNotifs) {
      dbNotifs.forEach((n: any) => {
        const isBroadcast = n.type === 'broadcast' || n.subtype === 'admin_announcement';
        const isMaintenance = n.subtype === 'maintenance_alert' || n.type === 'maintenance_alert';
        const isTicket = n.type === 'support_ticket' || n.type?.includes('ticket');
        const isAppt = n.type?.includes('appointment');
        const isScan = n.type === 'scan';
        const isSub = n.type === 'subscription';

        items.push({
          id: n.notif_id,
          userId,
          type: n.type || 'general',
          subtype: n.subtype || undefined,
          category: isAppt
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
          senderName:
            (n.metadata as any)?.sender_name ||
            (isTicket ? 'DERMAI Support' : isBroadcast || isMaintenance ? 'Platform Administrator' : undefined),
          senderType: isTicket || isBroadcast ? 'admin' : undefined,
          timestamp: n.created_at || new Date().toISOString(),
          read: Boolean(n.is_read || readSet.has(n.notif_id)),
          metadata: n.metadata,
        });
      });
    }

    // 2. Broadcast announcements sent by administrator
    const { data: broadcasts } = await supabase
      .from('admin_broadcast')
      .select('broadcast_id, title, message, audience, sent_at')
      .in('audience', ['all', 'patients', 'patient'])
      .order('sent_at', { ascending: false })
      .limit(10);

    if (broadcasts) {
      broadcasts.forEach((b: any) => {
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
          timestamp: b.sent_at || new Date().toISOString(),
          read: readSet.has(notifId),
          metadata: { broadcast_id: b.broadcast_id },
        });
      });
    }

    // 3. Live patient appointments from patient_appointment
    const { data: appointments } = await supabase
      .from('patient_appointment')
      .select(`
        appointment_id,
        date,
        time,
        status,
        doctor_status,
        doctor_note,
        clinic_note,
        created_at,
        clinic:clinic_id (name, logo_url)
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (appointments) {
      appointments.forEach((appt: any) => {
        const clinicObj = Array.isArray(appt.clinic) ? appt.clinic[0] : appt.clinic;
        const clinicName = clinicObj?.name || 'Clinic';
        const clinicLogo = clinicObj?.logo_url || null;
        const dateStr = appt.date
          ? new Date(appt.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : 'scheduled date';
        const timeStr = appt.time ? ` at ${appt.time}` : '';

        // Confirmed / Accepted Appointment
        if (appt.status === 'confirmed' || appt.doctor_status === 'approved') {
          const notifId = `appt-accepted-${appt.appointment_id}`;
          items.push({
            id: notifId,
            userId,
            type: 'appointment',
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

        // Cancelled / Rejected Appointment
        if (appt.status === 'cancelled' || appt.doctor_status === 'rejected') {
          const notifId = `appt-rejected-${appt.appointment_id}`;
          const noteText = appt.doctor_note ? ` Note: "${appt.doctor_note}".` : '';
          items.push({
            id: notifId,
            userId,
            type: 'appointment',
            subtype: 'appointment-rejected',
            category: 'appointment',
            title: `Appointment Declined`,
            message: `Your appointment request at ${clinicName} on ${dateStr} was declined.${noteText} You can select another available doctor or schedule.`,
            senderName: clinicName,
            senderType: 'clinic',
            senderAvatar: clinicLogo,
            timestamp: appt.created_at || new Date().toISOString(),
            read: readSet.has(notifId),
            metadata: { appointment_id: appt.appointment_id },
          });
        }

        // Completed Consultation
        if (appt.status === 'completed') {
          const notifId = `appt-completed-${appt.appointment_id}`;
          items.push({
            id: notifId,
            userId,
            type: 'appointment',
            subtype: 'appointment-completed',
            category: 'appointment',
            title: `Consultation Completed`,
            message: `Your consultation at ${clinicName} has concluded. Your doctor notes and assessment are ready for review.`,
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

    // 4. Support Ticket updates
    const { data: tickets } = await supabase
      .from('user_support_ticket')
      .select('ticket_id, subject, response, status, updated_at, created_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(10);

    if (tickets) {
      tickets.forEach((ticket: any) => {
        if (ticket.response || (ticket.status !== 'open' && ticket.status !== 'pending' && ticket.status !== 'submitted')) {
          const notifId = `ticket-update-${ticket.ticket_id}`;
          const replySummary = ticket.response ? ` Response: "${ticket.response}"` : '';
          items.push({
            id: notifId,
            userId,
            type: 'ticket',
            subtype: 'ticket-update',
            category: 'ticket',
            title: `Support Ticket Updated`,
            message: `Your ticket "${ticket.subject}" is now ${ticket.status}.${replySummary}`,
            senderName: 'DERMAI Support',
            senderType: 'admin',
            timestamp: ticket.updated_at || ticket.created_at || new Date().toISOString(),
            read: readSet.has(notifId),
            metadata: { ticket_id: ticket.ticket_id },
          });
        }
      });
    }
  } catch (err) {
    console.warn('[Store] getAppNotifications error:', err);
  }

  // De-duplicate by ID and broadcast_id, sorting newest first
  const seen = new Set<string>();
  const seenBroadcastIds = new Set<string>();
  const unique = items.filter((item) => {
    if (seen.has(item.id)) return false;
    const bId = item.metadata?.broadcast_id;
    if (bId) {
      if (seenBroadcastIds.has(bId)) return false;
      seenBroadcastIds.add(bId);
    }
    seen.add(item.id);
    return true;
  });

  return unique.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
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
      await supabase.from('user_notification').update({ is_read: true }).eq('notif_id', id);
    }
  } catch (err) {
    console.warn('[Store] markAppNotificationRead error:', err);
  }
}

export async function markAllAppNotificationsRead(userId: string, ids: string[]): Promise<void> {
  try {
    await saveAllLocalReadIds(userId, ids);
    const uuidIds = ids.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
    if (uuidIds.length > 0) {
      await supabase.from('user_notification').update({ is_read: true }).in('notif_id', uuidIds);
    }
  } catch (err) {
    console.warn('[Store] markAllAppNotificationsRead error:', err);
  }
}

export function subscribeToAppNotifications(userId: string, onUpdate: () => void) {
  if (!userId) return () => {};
  const channel = supabase
    .channel(`mobile_notifs_${userId}_${Date.now()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_notification', filter: `user_id=eq.${userId}` }, () => onUpdate())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_broadcast' }, () => onUpdate())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'patient_appointment', filter: `user_id=eq.${userId}` }, () => onUpdate())
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
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
          duty_days,
          duty_start_time,
          duty_end_time,
          status,
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
          return {
            id: d.doctor_id,
            name: d.doctor_name,
            specialization: spec || 'Dermatologist',
            dutyDays: d.duty_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
            dutyStartTime: d.duty_start_time || '09:00',
            dutyEndTime: d.duty_end_time || '17:00',
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

export async function getUserPayments(userId: string): Promise<PlatformTransaction[]> {
  try {
    const { data, error } = await supabase
      .from('user_payment')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error || !data) return [];
    return data.map((p: any) => ({
      id: String(p.payment_id || p.id),
      userId: p.user_id,
      amount: Number(p.amount) || 0,
      method: p.method || 'card',
      billingCycle: p.billing_cycle || 'monthly',
      status: p.status === 'success' ? 'paid' : p.status || 'paid',
      date: p.created_at || new Date().toISOString(),
      plan: p.billing_cycle === 'yearly' ? 'DermAI Pro Plan — Annual' : 'DermAI Pro Plan — Monthly',
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
