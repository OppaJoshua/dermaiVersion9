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
  answers: Record<string, string>;
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
  status: 'pending' | 'validated' | 'flagged';
  secondaryCondition?: string;
  secondaryConfidence?: number;
  isGovernmentReportable?: boolean;
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

export interface AppNotification {
  id: string;
  userId: string;
  type: 'appointment' | 'scan' | 'subscription' | 'general';
  subtype?: 'appointment-scheduled' | 'appointment-rejected';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  relatedId?: string;
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
      .select('*, skin_condition(name, local_name, description)')
      .eq('user_id', userId)
      .order('scanned_at', { ascending: false });

    if (error || !data) return [];

    return data.map((s: any) => ({
      id: s.analysis_id,
      userId: s.user_id,
      date: s.scanned_at,
      imageUri: s.photo_url || undefined,
      answers: s.questionnaire_answers || {},
      condition: s.skin_condition?.name || 'Skin Analysis Result',
      confidence: Number(s.confidence_score) || 0,
      severity: (s.confidence_score > 75 ? 'severe' : s.confidence_score > 50 ? 'moderate' : 'mild') as any,
      category: 'Dermatology',
      description: s.skin_condition?.description || '',
      symptoms: [],
      careTips: [],
      referralSuggested: s.referral_suggested || false,
      localName: s.skin_condition?.local_name || undefined,
      status: s.status || 'pending',
    }));
  } catch (err) {
    console.warn('[Store] getSkinHistory error:', err);
    return [];
  }
}

export async function saveScanResult(userId: string, result: ScanResult): Promise<void> {
  try {
    const { error } = await supabase.from('ai_scan_result').insert({
      user_id: userId,
      confidence_score: result.confidence,
      status: result.confidence < 60 ? 'flagged' : 'pending',
      scanned_at: result.date || new Date().toISOString(),
      referral_suggested: result.referralSuggested,
      photo_url: result.imageUri || null,
      questionnaire_answers: result.answers || {},
    });

    if (error) console.warn('[Store] saveScanResult insert error:', error.message);

    // Increment free_scans_used for user
    const { data: u } = await supabase.from('user').select('free_scans_used').eq('user_id', userId).maybeSingle();
    if (u) {
      await supabase.from('user').update({ free_scans_used: (u.free_scans_used || 0) + 1 }).eq('user_id', userId);
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
    const { data, error } = await supabase
      .from('user_plan_subscription')
      .select('*, plan(*)')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

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

    const pName = data.plan?.name?.toLowerCase() || '';
    const planType = pName.includes('pro') ? 'pro' : pName.includes('basic') ? 'basic' : 'free';

    return {
      userId,
      email: u?.email || '',
      plan: planType,
      billingCycle: data.billing_cycle || 'monthly',
      startDate: data.started_at,
      endDate: data.renews_at,
      status: data.status,
      scansUsed: u?.free_scans_used ?? 0,
      scanLimit: data.plan?.scan_limit ?? 3,
    };
  } catch (err) {
    console.warn('[Store] getUserSubscription error:', err);
    return null;
  }
}

export async function setUserSubscription(userId: string, record: SubscriptionRecord): Promise<void> {
  try {
    // Find matching plan from live table
    const { data: plans } = await supabase.from('plan').select('*');
    const targetPlan = plans?.find((p: any) => p.name.toLowerCase().includes(record.plan)) || plans?.[0];

    if (targetPlan) {
      await supabase.from('user_plan_subscription').insert({
        user_id: userId,
        plan_id: targetPlan.plan_id,
        billing_cycle: record.billingCycle || 'monthly',
        status: 'active',
        started_at: new Date().toISOString(),
      });
    }
  } catch (err: any) {
    console.error('[Store] Failed to save subscription for user:', userId, err?.message ?? err);
    throw err;
  }
}

// ─── Appointments ─────────────────────────────────────────────────────────────
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
        doctor:assigned_doctor_id (doctor_name)
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
      createdAt: a.created_at,
    }));
  } catch (err) {
    console.warn('[Store] getAppointments error:', err);
    return [];
  }
}

export async function saveAppointment(appt: Partial<Appointment> & { userId: string }): Promise<string> {
  try {
    const payload: any = {
      user_id: appt.userId,
      clinic_id: appt.clinicId || null,
      assigned_doctor_id: appt.assignedDoctorId || null,
      date: appt.date || null,
      time: appt.time || null,
      batch_time: appt.batchTime || appt.time || null,
      queue_number: appt.queueNumber || 1,
      check_in_status: appt.checkInStatus || 'scheduled',
      status: appt.status || 'pending',
      patient_name: appt.patientName || null,
      patient_email: appt.patientEmail || null,
      patient_contact: appt.patientContact || null,
      patient_address: appt.patientAddress || null,
      notes: appt.notes || null,
      clinic_note: appt.clinicNote || null,
      skin_photo_url: appt.skinPhotoUri || null,
      ai_condition_name: appt.conditionName || null,
      ai_confidence: appt.conditionId && !isNaN(Number(appt.conditionId)) ? Number(appt.conditionId) : null,
    };

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
      const { data, error } = await supabase
        .from('patient_appointment')
        .insert(payload)
        .select('appointment_id')
        .single();
      if (error) throw error;
      return data.appointment_id;
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

// ─── App Notifications ────────────────────────────────────────────────────────
export async function getAppNotifications(userId: string): Promise<AppNotification[]> {
  try {
    const { data, error } = await supabase
      .from('user_notification')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error || !data) return [];
    return data.map((n: any) => ({
      id: n.notif_id,
      userId: n.user_id,
      type: n.type || 'general',
      subtype: n.subtype || undefined,
      title: n.title,
      message: n.body || '',
      timestamp: n.created_at,
      read: n.is_read ?? false,
    }));
  } catch (err) {
    console.warn('[Store] getAppNotifications error:', err);
    return [];
  }
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

export async function markAppNotificationRead(_userId: string, id: string): Promise<void> {
  try {
    await supabase.from('user_notification').update({ is_read: true }).eq('notif_id', id);
  } catch (err) {
    console.warn('[Store] markAppNotificationRead error:', err);
  }
}

export async function syncAppointmentNotifications(
  userId: string,
  appointments: Appointment[],
): Promise<boolean> {
  const existing = await getAppNotifications(userId);
  let created = false;
  for (const appt of appointments) {
    if (appt.status === 'scheduled' || appt.status === 'confirmed') {
      const already = existing.some(
        (n) => n.title.includes(appt.clinicName) && n.subtype === 'appointment-scheduled',
      );
      if (!already) {
        await addAppNotification(userId, {
          userId,
          type: 'appointment',
          subtype: 'appointment-scheduled',
          title: `Appointment Confirmed with ${appt.clinicName}! ✅`,
          message: `Your appointment at ${appt.clinicName}${appt.date ? ` on ${appt.date}` : ''}${appt.time ? ` at ${appt.time}` : ''} has been scheduled.`,
        });
        created = true;
      }
    }
  }
  return created;
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
        clinic_doctor (
          doctor_id,
          doctor_name,
          duty_days,
          duty_start_time,
          duty_end_time,
          status
        ),
        clinic_operating_hours (
          day_of_week,
          open_time,
          close_time
        )
      `)
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

    return data.map((c: any) => ({
      id: c.clinic_id,
      name: c.name,
      address: c.address || '',
      phone: c.phone || '',
      email: c.email || '',
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
      doctors: (c.clinic_doctor || [])
        .filter((d: any) => d.status === 'Active' || !d.status)
        .map((d: any) => ({
          id: d.doctor_id,
          name: d.doctor_name,
          specialization: 'Dermatologist',
          dutyDays: d.duty_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
          dutyStartTime: d.duty_start_time || '09:00',
          dutyEndTime: d.duty_end_time || '17:00',
        })),
      conditionsTreated: ['Acne Vulgaris', 'Atopic Dermatitis (Eczema)', 'Psoriasis', 'Tinea Corporis (Buni)', 'Melasma'],
    }));
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
