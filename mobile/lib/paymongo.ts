import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from './platform';
import { supabase } from './supabase';

export type PaymentOutcomeStatus =
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'uncertain'
  | 'timeout';

export class PayMongoPaymentError extends Error {
  status: PaymentOutcomeStatus;
  paymentIntentId?: string;
  isConfirmedTerminal: boolean;

  constructor(
    message: string,
    status: PaymentOutcomeStatus,
    paymentIntentId?: string
  ) {
    super(message);
    this.name = 'PayMongoPaymentError';
    this.status = status;
    this.paymentIntentId = paymentIntentId;
    this.isConfirmedTerminal = status === 'failed' || status === 'cancelled';
  }
}

export const PAYMONGO_PUBLIC_KEY =
  process.env.EXPO_PUBLIC_PAYMONGO_PUBLIC_KEY || 'pk_test_XLaXbV4y3Y4xHzqMXvPuaezd';

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

export function encodeBase64(input: string): string {
  let str = input;
  let output = '';
  for (
    let block = 0, charCode: number, i = 0, map = BASE64_CHARS;
    str.charAt(i | 0) || ((map = '='), i % 1);
    output += map.charAt(63 & (block >> (8 - (i % 1) * 8)))
  ) {
    charCode = str.charCodeAt((i += 3 / 4));
    if (charCode > 0xff) {
      throw new Error('encodeBase64: string contains characters outside of Latin1 range.');
    }
    block = (block << 8) | charCode;
  }
  return output;
}

/**
 * Extracts descriptive error messages from Supabase Edge Function error responses.
 */
export async function extractEdgeFunctionError(err: any): Promise<{
  status?: number;
  message: string;
  rawError?: any;
}> {
  if (!err) return { message: 'An unexpected payment error occurred.' };
  let status: number | undefined;
  let detailMessage: string | null = null;
  let rawBody: any = null;

  const res: Response | undefined =
    err?.context && typeof err.context.clone === 'function' ? err.context : undefined;

  if (res) {
    status = res.status;
    try {
      const cloned = res.clone();
      const text = await cloned.text();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          rawBody = parsed;
          if (parsed && typeof parsed === 'object') {
            detailMessage =
              parsed.error?.message ||
              (typeof parsed.error === 'string' ? parsed.error : null) ||
              parsed.errors?.[0]?.detail ||
              parsed.message ||
              null;
          }
        } catch {
          detailMessage = text;
        }
      }
    } catch {}
  }

  const message =
    detailMessage ||
    err.message ||
    (typeof err === 'string' ? err : 'Edge Function request failed.');

  return { status, message, rawError: rawBody || err };
}

/**
 * Enforces an active, valid Supabase user session before payment processing.
 * Refreshes stale sessions or throws an explicit error instead of continuing anonymously.
 */
export async function requireAuthSession(): Promise<{
  access_token: string;
  userId: string;
  userEmail: string;
}> {
  let { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) {
    try {
      const refreshRes = await supabase.auth.refreshSession();
      session = refreshRes.data?.session;
    } catch {}
  }

  if (!session?.access_token || !session?.user?.id) {
    throw new Error(
      'Authentication required: Active patient session not found. Please log in before proceeding with payment.'
    );
  }

  return {
    access_token: session.access_token,
    userId: session.user.id,
    userEmail: session.user.email || '',
  };
}

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://yxteeadjgavejpiriewj.supabase.co';

export function getMobileDeepLinkSuccessUri(
  appointmentId?: string,
  extraParams?: Record<string, string>
): string {
  const isExpoGo =
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
    (Constants as any).appOwnership === 'expo';

  const queryParams: Record<string, string> = {
    status: 'success',
    ...(extraParams || {}),
  };
  if (appointmentId) {
    queryParams.appointment_id = appointmentId;
    queryParams.booking_id = appointmentId;
  }

  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    const qs = new URLSearchParams(queryParams).toString();
    return `${window.location.origin}/payment-success?${qs}`;
  }

  const targetPath = 'payment-success';
  return isExpoGo
    ? makeRedirectUri({ path: targetPath, queryParams })
    : makeRedirectUri({ scheme: 'dermaimobile', path: targetPath, queryParams });
}

export function getMobilePaymentSuccessUri(
  appointmentId?: string,
  extraParams?: Record<string, string>
): string {
  const queryParams: Record<string, string> = {
    status: 'success',
    ...(extraParams || {}),
  };
  if (appointmentId) {
    queryParams.appointment_id = appointmentId;
    queryParams.booking_id = appointmentId;
  }

  // 1. Mobile Web (running in browser)
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    const qs = new URLSearchParams(queryParams).toString();
    return `${window.location.origin}/payment-success?${qs}`;
  }

  // 2. Mobile Native (Expo Go vs Development / Standalone build)
  const mobileDeepLink = getMobileDeepLinkSuccessUri(appointmentId, extraParams);

  // PayMongo gateway requires an HTTP/HTTPS return_url.
  // We use our HTTPS Supabase Edge Function bounce endpoint with the embedded mobile target deep link:
  const bounceParams = new URLSearchParams({
    ...queryParams,
    app_redirect: mobileDeepLink,
  });

  return `${SUPABASE_URL}/functions/v1/paymongo-payment?${bounceParams.toString()}`;
}

export function getMobilePaymentCancelUri(appointmentId?: string): string {
  const isExpoGo =
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
    (Constants as any).appOwnership === 'expo';

  const queryParams: Record<string, string> = { status: 'cancel' };
  if (appointmentId) {
    queryParams.appointment_id = appointmentId;
    queryParams.booking_id = appointmentId;
  }

  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    const qs = new URLSearchParams(queryParams).toString();
    return `${window.location.origin}/payment-success?${qs}`;
  }

  const targetPath = 'payment-success';
  const mobileDeepLink = isExpoGo
    ? makeRedirectUri({ path: targetPath, queryParams })
    : makeRedirectUri({ scheme: 'dermaimobile', path: targetPath, queryParams });

  const bounceParams = new URLSearchParams({
    ...queryParams,
    app_redirect: mobileDeepLink,
  });

  return `${SUPABASE_URL}/functions/v1/paymongo-payment?${bounceParams.toString()}`;
}

export function getMobilePaymentRedirectUri(
  flow: 'booking' | 'subscription' = 'booking',
  extraQuery = ''
): string {
  const extraParams: Record<string, string> = { flow };
  if (extraQuery) {
    const parsed = new URLSearchParams(extraQuery);
    parsed.forEach((val, key) => {
      extraParams[key] = val;
    });
  }
  return getMobilePaymentSuccessUri(undefined, extraParams);
}

function getPayMongoReturnUrl(
  flow: 'booking' | 'subscription',
  extraParams?: Record<string, string>
): string {
  return getMobilePaymentSuccessUri(undefined, {
    flow,
    ...(extraParams || {}),
  });
}

async function createPayMongoPaymentMethod(params: {
  paymentMethod: 'gcash' | 'maya';
  name: string;
  email: string;
  phone: string;
  address: string;
}): Promise<string> {
  const pmType = params.paymentMethod === 'maya' ? 'paymaya' : 'gcash';

  const pmResponse = await fetch('https://api.paymongo.com/v1/payment_methods', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + encodeBase64(PAYMONGO_PUBLIC_KEY + ':'),
    },
    body: JSON.stringify({
      data: {
        attributes: {
          type: pmType,
          billing: {
            name: params.name,
            email: params.email,
            phone: params.phone,
            address: {
              line1: params.address || 'Cebu City',
              city: 'Cebu City',
              country: 'PH',
            },
          },
        },
      },
    }),
  });

  const pmJson = await pmResponse.json();
  if (!pmResponse.ok || pmJson.errors) {
    throw new Error(
      pmJson.errors?.[0]?.detail || 'Failed to initialize e-wallet payment method with PayMongo.'
    );
  }

  return pmJson.data.id as string;
}

export async function verifyPayMongoIntentOnce(
  paymentIntentId: string,
  clientKey: string
): Promise<{
  status: string;
  paymongoPaymentId?: string;
  raw?: any;
}> {
  let authHeaders: Record<string, string> = {};
  try {
    const session = await requireAuthSession();
    authHeaders = { Authorization: `Bearer ${session.access_token}` };
  } catch {}

  const { data: verifyData, error: verifyError } = await supabase.functions.invoke(
    'paymongo-payment',
    {
      headers: authHeaders,
      body: {
        action: 'verify_payment_intent',
        paymentIntentId,
        clientKey,
      },
    }
  );

  if (verifyError) {
    return { status: 'uncertain' };
  }

  const intentStatus: string =
    verifyData?.status ||
    verifyData?.attributes?.status ||
    verifyData?.data?.attributes?.status ||
    'pending';

  const payments =
    verifyData?.attributes?.payments ||
    verifyData?.data?.attributes?.payments ||
    verifyData?.payments ||
    [];

  const paymongoPaymentId = payments[0]?.id || verifyData?.paymentIntentId || paymentIntentId;

  // If payment succeeded and email receipt was not yet dispatched, trigger send_receipt_email retry
  // Mirrors web/src/pages/patient/PaymentSuccessPage.tsx lines 236-252
  if (intentStatus === 'succeeded' && verifyData?.fulfillment?.emailDispatched === false) {
    try {
      await supabase.functions.invoke('paymongo-payment', {
        headers: authHeaders,
        body: {
          action: 'send_receipt_email',
          paymentIntentId,
          clientKey,
        },
      });
    } catch (retryErr) {
      console.warn('[PayMongo] send_receipt_email retry warning:', retryErr);
    }
  }

  return {
    status: intentStatus,
    paymongoPaymentId,
    raw: verifyData,
  };
}

export async function openAndVerifyPayMongoCheckout(params: {
  redirectUrl: string;
  paymentIntentId: string;
  clientKey: string;
  appointmentId?: string;
  flow?: 'booking' | 'subscription';
  extraParams?: Record<string, string>;
}): Promise<{
  succeeded: boolean;
  paymongoPaymentId: string;
  status: PaymentOutcomeStatus;
  isConfirmedTerminal: boolean;
  redirectedInBrowser?: boolean;
}> {
  const { redirectUrl, paymentIntentId, clientKey, appointmentId, extraParams } = params;
  const deepLinkSuccessUrl = getMobileDeepLinkSuccessUri(appointmentId, extraParams);

  // On Web, persist pending credentials and redirect directly to PayMongo Checkout page
  // (Mirrors web/src/pages/patient/SubscriptionUpgradePage.tsx line 428)
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      window.sessionStorage?.setItem('dermai_pending_payment_intent_id', paymentIntentId);
      window.sessionStorage?.setItem('dermai_pending_payment_intent_client_key', clientKey);
    } catch {}
    window.location.href = redirectUrl;
    return {
      succeeded: true,
      paymongoPaymentId: paymentIntentId,
      status: 'succeeded',
      isConfirmedTerminal: false,
      redirectedInBrowser: true,
    };
  }

  let authResult: WebBrowser.WebBrowserAuthSessionResult | null = null;
  try {
    // In-app authentication session using registered mobile deep link scheme
    authResult = await WebBrowser.openAuthSessionAsync(redirectUrl, deepLinkSuccessUrl);
  } catch (browserErr) {
    console.warn('[PayMongo] WebBrowser.openAuthSessionAsync warning:', browserErr);
    try {
      await Linking.openURL(redirectUrl);
    } catch {}
  }

  const isSuccessRedirect =
    authResult?.type === 'success' &&
    (!authResult.url ||
      authResult.url.includes('success') ||
      authResult.url.includes('booking_id') ||
      authResult.url.includes('payment_intent'));

  const isUserCancel = authResult?.type === 'cancel' || authResult?.type === 'dismiss';

  // 1. Authoritative verification via live Supabase Edge Function verify_payment_intent
  // Auto-fulfills DB records and dispatches email receipt server-side
  let authHeaders: Record<string, string> = {};
  let userId = '';
  try {
    const session = await requireAuthSession();
    authHeaders = { Authorization: `Bearer ${session.access_token}` };
    userId = session.userId;
  } catch {}

  try {
    const { data: vData } = await supabase.functions.invoke('paymongo-payment', {
      headers: authHeaders,
      body: {
        action: 'verify_payment_intent',
        paymentIntentId,
        clientKey,
      },
    });
    if (
      (vData?.status === 'succeeded' || vData?.attributes?.status === 'succeeded') &&
      vData?.fulfillment?.emailDispatched === false
    ) {
      await supabase.functions.invoke('paymongo-payment', {
        headers: authHeaders,
        body: {
          action: 'send_receipt_email',
          paymentIntentId,
          clientKey,
        },
      });
    }
  } catch (verifyErr) {
    console.warn('[PayMongo] verify_payment_intent invocation notice:', verifyErr);
  }

  // 2. Authoritative database check against Supabase
  if (appointmentId) {
    for (let retry = 0; retry < 5; retry++) {
      try {
        const { data: apptRow } = await supabase
          .from('patient_appointment')
          .select('appointment_id, payment_status, payment_reference, queue_number, status')
          .eq('appointment_id', appointmentId)
          .maybeSingle();

        if (apptRow?.payment_status === 'paid' || apptRow?.status === 'confirmed' || apptRow?.status === 'scheduled') {
          return {
            succeeded: true,
            paymongoPaymentId: apptRow.payment_reference || paymentIntentId,
            status: 'succeeded',
            isConfirmedTerminal: false,
          };
        }
      } catch (dbErr) {
        console.warn('[PayMongo] Database check retry warning:', dbErr);
      }
      if (retry < 4) {
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
  } else if (params.flow === 'subscription' && userId) {
    for (let retry = 0; retry < 4; retry++) {
      try {
        const { data: payRow } = await supabase
          .from('user_payment')
          .select('payment_id, paymongo_payment_id, reference_number, status')
          .eq('user_id', userId)
          .eq('paymongo_payment_intent_id', paymentIntentId)
          .maybeSingle();

        if (payRow && payRow.status === 'success') {
          return {
            succeeded: true,
            paymongoPaymentId:
              payRow.paymongo_payment_id || payRow.reference_number || paymentIntentId,
            status: 'succeeded',
            isConfirmedTerminal: false,
          };
        }
      } catch {}
      // Not confirmed yet (Maya can lag behind GCash): re-run server-side fulfillment, then poll again.
      try {
        await supabase.functions.invoke('paymongo-payment', {
          headers: authHeaders,
          body: { action: 'verify_payment_intent', paymentIntentId, clientKey },
        });
      } catch {}
      if (retry < 3) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  // 3. Check directly from PayMongo Intent via verifyPayMongoIntentOnce
  const finalCheck = await verifyPayMongoIntentOnce(paymentIntentId, clientKey);
  if (finalCheck.status === 'succeeded' || isSuccessRedirect) {
    return {
      succeeded: true,
      paymongoPaymentId: finalCheck.paymongoPaymentId || paymentIntentId,
      status: 'succeeded',
      isConfirmedTerminal: false,
    };
  }

  if (finalCheck.status === 'failed' || finalCheck.status === 'cancelled') {
    return {
      succeeded: false,
      paymongoPaymentId: paymentIntentId,
      status: finalCheck.status as PaymentOutcomeStatus,
      isConfirmedTerminal: true,
    };
  }

  if (isUserCancel) {
    return {
      succeeded: false,
      paymongoPaymentId: paymentIntentId,
      status: 'cancelled',
      isConfirmedTerminal: false,
    };
  }

  return {
    succeeded: false,
    paymongoPaymentId: paymentIntentId,
    status: 'uncertain',
    isConfirmedTerminal: false,
  };
}

export async function processPayMongoBookingPayment(params: {
  amount: number;
  paymentMethod: 'gcash' | 'maya';
  clinicId: string | number;
  clinicName: string;
  doctorId?: string;
  doctorName?: string;
  appointmentDate: string;
  appointmentTime: string;
  appointmentId: string;
  patientName: string;
  patientEmail: string;
  patientContact: string;
  patientAddress: string;
}): Promise<{
  paymongoPaymentId: string;
  paymentIntentId: string;
}> {
  // Enforce valid authenticated session
  const authSession = await requireAuthSession();
  const authHeaders = {
    Authorization: `Bearer ${authSession.access_token}`,
  };

  // Step 1: Create PayMongo booking intent directly via live Edge Function 'paymongo-payment'
  // Exactly matching working web implementation in AppointmentPage.tsx
  const { data: intentData, error: intentError } = await supabase.functions.invoke(
    'paymongo-payment',
    {
      headers: authHeaders,
      body: {
        action: 'create_booking_intent',
        amount: params.amount,
        paymentMethod: params.paymentMethod, // 'gcash' or 'maya'
        clinicId: String(params.clinicId),
        clinicName: params.clinicName,
        doctorId: params.doctorId,
        doctorName: params.doctorName,
        appointmentDate: params.appointmentDate,
        appointmentTime: params.appointmentTime,
        appointmentId: params.appointmentId,
        appointment_id: params.appointmentId,
        patientName: params.patientName,
        patientEmail: params.patientEmail,
        patientContact: params.patientContact,
      },
    }
  );

  if (intentError) {
    const extracted = await extractEdgeFunctionError(intentError);
    console.warn('[processPayMongoBookingPayment] PayMongo intent creation error:', extracted);
    throw new Error(extracted.message || 'Failed to initialize PayMongo booking checkout.');
  }

  const paymentIntentId = intentData?.paymentIntentId || intentData?.id;
  const clientKey = intentData?.clientKey || intentData?.client_key;

  if (!paymentIntentId || !clientKey) {
    throw new Error('Invalid checkout response from server. Missing payment intent credentials.');
  }

  // Step 2: Register payment method directly with PayMongo API (client-side, identical to web)
  const paymentMethodId = await createPayMongoPaymentMethod({
    paymentMethod: params.paymentMethod,
    name: params.patientName,
    email: params.patientEmail,
    phone: params.patientContact,
    address: params.patientAddress,
  });

  const successUrl = getMobilePaymentSuccessUri(params.appointmentId, {
    payment_intent: paymentIntentId,
    client_key: clientKey,
  });

  // Step 3: Attach Payment Method via live Edge Function 'paymongo-payment'
  const { data: attachData, error: attachError } = await supabase.functions.invoke(
    'paymongo-payment',
    {
      headers: authHeaders,
      body: {
        action: 'attach_payment_method',
        paymentIntentId,
        paymentMethodId,
        clientKey,
        returnUrl: successUrl,
      },
    }
  );

  if (attachError) {
    const extracted = await extractEdgeFunctionError(attachError);
    console.warn('[processPayMongoBookingPayment] PayMongo attach payment method error:', extracted);
    throw new Error(extracted.message || 'Failed to attach PayMongo payment method.');
  }

  const status = attachData?.attributes?.status || attachData?.status;
  const redirectUrl = attachData?.attributes?.next_action?.redirect?.url;

  if (status === 'succeeded') {
    const check = await verifyPayMongoIntentOnce(paymentIntentId, clientKey);
    return {
      paymongoPaymentId: check.paymongoPaymentId || paymentIntentId,
      paymentIntentId,
    };
  }

  if (status === 'awaiting_next_action' && redirectUrl) {
    // Step 4: Open in WebBrowser with dermaimobile:// & verify payment completion against Supabase
    const result = await openAndVerifyPayMongoCheckout({
      redirectUrl,
      paymentIntentId,
      clientKey,
      appointmentId: params.appointmentId,
      flow: 'booking',
      extraParams: {
        payment_intent: paymentIntentId,
        client_key: clientKey,
      },
    });

    if (!result.succeeded) {
      if (result.status === 'failed') {
        throw new PayMongoPaymentError(
          'Payment was declined or failed on PayMongo.',
          'failed',
          paymentIntentId
        );
      }
      if (result.status === 'cancelled') {
        throw new PayMongoPaymentError(
          'Payment was cancelled on the PayMongo authorization page.',
          'cancelled',
          paymentIntentId
        );
      }
      throw new PayMongoPaymentError(
        'Payment authorization could not be verified immediately. Hold is preserved.',
        'uncertain',
        paymentIntentId
      );
    }

    return {
      paymongoPaymentId: result.paymongoPaymentId,
      paymentIntentId,
    };
  }

  throw new Error(`Unexpected payment status from gateway: ${status || 'unknown'}`);
}

export async function processPayMongoSubscriptionPayment(params: {
  userId: string;
  planId?: string;
  billingCycle: 'monthly' | 'yearly';
  paymentMethod: 'gcash' | 'maya';
  fullName: string;
  email: string;
  address: string;
  mobileNumber: string;
}): Promise<{
  paymongoPaymentId: string;
  paymentIntentId: string;
  clientKey: string;
  amount: number;
  basePrice: number;
  vatAmount: number;
  planId: string;
  planName: string;
  redirectedInBrowser?: boolean;
}> {
  // Enforce valid authenticated session
  const authSession = await requireAuthSession();
  const authHeaders = {
    Authorization: `Bearer ${authSession.access_token}`,
  };

  // Resolve active plan from Supabase `plan` table matching website SubscriptionUpgradePage
  let planId =
    params.planId ||
    (params.billingCycle === 'yearly'
      ? '00000000-0000-0000-0000-000000000004'
      : '00000000-0000-0000-0000-000000000003');
  let planName = params.billingCycle === 'yearly' ? 'Pro (Annual)' : 'Pro';
  let netPrice = params.billingCycle === 'yearly' ? 1784.82 : 177.68;

  try {
    const { data: plans } = await supabase.from('plan').select('*').eq('status', 'active');
    if (plans && plans.length > 0) {
      const matched =
        (params.planId ? plans.find((p: any) => p.plan_id === params.planId) : null) ||
        plans.find(
          (p: any) =>
            p.billing_type === params.billingCycle && Number(p.price) > 0
        ) ||
        plans.find((p: any) =>
          params.billingCycle === 'yearly'
            ? p.name?.toLowerCase().includes('annual') || p.name?.toLowerCase().includes('year')
            : p.name?.toLowerCase() === 'pro' || p.name?.toLowerCase().includes('month')
        );
      if (matched) {
        planId = matched.plan_id;
        planName = matched.name || planName;
        if (Number(matched.price) > 0) {
          netPrice = Number(matched.price);
        }
      }
    }
  } catch {}

  const basePrice = Math.round(netPrice * 100) / 100;
  const totalPrice = Math.round(basePrice * 1.12 * 100) / 100;
  const vatAmount = Math.round((totalPrice - basePrice) * 100) / 100;
  const amountInCentavos = Math.round(totalPrice * 100);

  // Step 1: Create Subscription PaymentIntent via Supabase Edge Function
  const { data: intentData, error: intentError } = await supabase.functions.invoke(
    'paymongo-payment',
    {
      headers: authHeaders,
      body: {
        action: 'create_intent',
        paymentMethod: params.paymentMethod,
        userId: authSession.userId || params.userId,
        planId,
        billingCycle: params.billingCycle,
        fullName: params.fullName,
        email: params.email,
        address: params.address,
        mobileNumber: params.mobileNumber,
        basePrice,
        vatAmount,
        totalPrice,
        amountInCentavos,
        amount: amountInCentavos,
      },
    }
  );

  if (intentError || !intentData?.paymentIntentId) {
    const extracted = await extractEdgeFunctionError(intentError);
    throw new Error(
      extracted.message || 'Failed to create subscription payment intent.'
    );
  }

  const { paymentIntentId, clientKey } = intentData;
  const resolvedTotal = Number(intentData.totalPrice || totalPrice);
  const resolvedBase = Number(intentData.basePrice || basePrice);
  const resolvedVat = Number(intentData.vatAmount || vatAmount);

  // Step 2: Create Payment Method (GCash / Maya) directly with PayMongo
  const paymentMethodId = await createPayMongoPaymentMethod({
    paymentMethod: params.paymentMethod,
    name: params.fullName,
    email: params.email,
    phone: params.mobileNumber,
    address: params.address,
  });

  // Step 3: Attach Payment Method to PaymentIntent via Edge Function
  // Uses HTTPS Edge Function bounce on Native or /payment-success on Web
  const returnUrl = getPayMongoReturnUrl('subscription', {
    cycle: params.billingCycle,
    method: params.paymentMethod,
    payment_intent: paymentIntentId,
    payment_intent_client_key: clientKey,
    client_key: clientKey,
  });

  const { data: attachData, error: attachError } = await supabase.functions.invoke(
    'paymongo-payment',
    {
      headers: authHeaders,
      body: {
        action: 'attach_payment_method',
        paymentIntentId,
        paymentMethodId,
        clientKey,
        returnUrl,
      },
    }
  );

  if (attachError) {
    const extracted = await extractEdgeFunctionError(attachError);
    throw new Error(
      extracted.message || 'Failed to attach payment method.'
    );
  }

  const status = attachData?.attributes?.status || attachData?.status;
  const redirectUrl = attachData?.attributes?.next_action?.redirect?.url;

  if (status === 'succeeded') {
    const check = await verifyPayMongoIntentOnce(paymentIntentId, clientKey);
    return {
      paymongoPaymentId: check.paymongoPaymentId || paymentIntentId,
      paymentIntentId,
      clientKey,
      amount: resolvedTotal,
      basePrice: resolvedBase,
      vatAmount: resolvedVat,
      planId,
      planName,
    };
  }

  if (status === 'awaiting_next_action' && redirectUrl) {
    // Step 4: Redirect user to PayMongo Test Checkout page & verify
    const result = await openAndVerifyPayMongoCheckout({
      redirectUrl,
      paymentIntentId,
      clientKey,
      flow: 'subscription',
      extraParams: {
        flow: 'subscription',
        cycle: params.billingCycle,
        method: params.paymentMethod,
        payment_intent: paymentIntentId,
        payment_intent_client_key: clientKey,
        client_key: clientKey,
      },
    });

    if (!result.succeeded) {
      throw new Error(
        'Payment was not completed or was declined on the PayMongo authorization page.'
      );
    }

    return {
      paymongoPaymentId: result.paymongoPaymentId,
      paymentIntentId,
      clientKey,
      amount: resolvedTotal,
      basePrice: resolvedBase,
      vatAmount: resolvedVat,
      planId,
      planName,
      redirectedInBrowser: result.redirectedInBrowser,
    };
  }

  throw new Error(`Unexpected payment status: ${status || 'unknown'}`);
}
