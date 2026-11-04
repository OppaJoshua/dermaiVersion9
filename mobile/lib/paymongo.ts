import { Platform } from './platform';
const webBrowserModuleName = 'expo-web-browser';
function getWebBrowser(): {
  openBrowserAsync: (url: string, options?: any) => Promise<any>;
  dismissBrowser: () => void;
} {
  try {
    return (globalThis as any).mockWebBrowser || require(webBrowserModuleName);
  } catch {
    return {
      openBrowserAsync: async () => ({ type: 'dismiss' }),
      dismissBrowser: () => {},
    };
  }
}
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

function getPayMongoReturnUrl(flow: 'booking' | 'subscription', extraQuery = ''): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    const base = `${window.location.origin}/patient/payment-success`;
    return extraQuery ? `${base}?${extraQuery}` : base;
  }
  // PayMongo requires an https:// or http:// return_url when attaching a payment method.
  // On mobile, WebBrowser intercepts/polls the payment intent status and closes automatically once authorized.
  const base = 'https://yxteeadjgavejpiriewj.supabase.co/functions/v1/paymongo-payment';
  const query = `mobile_return=1&flow=${flow}${extraQuery ? `&${extraQuery}` : ''}`;
  return `${base}?${query}`;
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
  const { data: verifyData, error: verifyError } = await supabase.functions.invoke(
    'paymongo-payment',
    {
      body: {
        action: 'verify_payment_intent',
        paymentIntentId,
        clientKey,
      },
    }
  );

  if (verifyError || !verifyData?.success) {
    return { status: verifyError ? 'uncertain' : 'pending' };
  }

  const intentStatus: string = verifyData?.data?.status || 'pending';
  const payments = verifyData?.data?.payments || [];
  const paymongoPaymentId = payments[0]?.id || paymentIntentId;

  return {
    status: intentStatus,
    paymongoPaymentId,
    raw: verifyData?.data,
  };
}

export async function openAndVerifyPayMongoCheckout(params: {
  redirectUrl: string;
  paymentIntentId: string;
  clientKey: string;
}): Promise<{
  succeeded: boolean;
  paymongoPaymentId: string;
  status: PaymentOutcomeStatus;
  isConfirmedTerminal: boolean;
}> {
  const { redirectUrl, paymentIntentId, clientKey } = params;

  let resolved = false;
  let browserFinished = false;
  let sawNextActionOrProcessing = false;

  // Poll verify_payment_intent in the background while the user is on the PayMongo Test Checkout page
  const pollPromise = (async () => {
    const startTime = Date.now();
    const maxWaitMs = 5 * 60 * 1000; // 5 minutes max

    // Wait 2s before first check so the browser has time to load the PayMongo test page
    await new Promise((r) => setTimeout(r, 2000));

    while (!resolved && !browserFinished && Date.now() - startTime < maxWaitMs) {
      try {
        const check = await verifyPayMongoIntentOnce(paymentIntentId, clientKey);
        if (check.status === 'succeeded') {
          resolved = true;
          try {
            getWebBrowser().dismissBrowser();
          } catch {}
          return {
            succeeded: true,
            paymongoPaymentId: check.paymongoPaymentId || paymentIntentId,
            status: 'succeeded' as const,
            isConfirmedTerminal: false,
          };
        }

        if (check.status === 'awaiting_next_action' || check.status === 'processing') {
          sawNextActionOrProcessing = true;
        } else if (
          sawNextActionOrProcessing &&
          (check.status === 'awaiting_payment_method' ||
            check.status === 'failed' ||
            check.status === 'cancelled')
        ) {
          // User clicked "Fail Test Payment" or cancelled on the PayMongo Test Checkout page
          resolved = true;
          try {
            getWebBrowser().dismissBrowser();
          } catch {}
          const isTerm = check.status === 'failed' || check.status === 'cancelled';
          return {
            succeeded: false,
            paymongoPaymentId: paymentIntentId,
            status: (isTerm ? check.status : 'cancelled') as PaymentOutcomeStatus,
            isConfirmedTerminal: true,
          };
        }
      } catch {}

      await new Promise((r) => setTimeout(r, 2200));
    }

    return null;
  })();

  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(redirectUrl, '_blank');
      // On web, wait for polling to resolve
      const webPollResult = await pollPromise;
      if (webPollResult) return webPollResult;
    } else {
      await getWebBrowser().openBrowserAsync(redirectUrl, {
        showTitle: true,
        enableBarCollapsing: true,
        dismissButtonStyle: 'done',
      });
    }
  } finally {
    browserFinished = true;
  }

  // If polling already caught the result, return it
  if (resolved) {
    const pollResult = await pollPromise;
    if (pollResult) return pollResult;
  }

  // Browser was closed by the user after clicking "Authorize Test Payment" or "Done" — verify authoritative final status
  let lastKnownStatus = 'uncertain';
  for (let retry = 0; retry < 3; retry++) {
    const finalCheck = await verifyPayMongoIntentOnce(paymentIntentId, clientKey);
    lastKnownStatus = finalCheck.status;
    if (finalCheck.status === 'succeeded') {
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
    if (retry < 2) {
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  // If status is not definitively failed or cancelled, it is UNCERTAIN (e.g. browser dismissed, network lag, processing).
  // The hold MUST be preserved!
  const isTerminal = lastKnownStatus === 'failed' || lastKnownStatus === 'cancelled';
  return {
    succeeded: false,
    paymongoPaymentId: paymentIntentId,
    status: (isTerminal ? lastKnownStatus : 'uncertain') as PaymentOutcomeStatus,
    isConfirmedTerminal: isTerminal,
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
  // Step 1: Create Booking PaymentIntent via Supabase Edge Function
  const { data: intentData, error: intentError } = await supabase.functions.invoke(
    'paymongo-payment',
    {
      body: {
        action: 'create_booking_intent',
        amount: params.amount,
        paymentMethod: params.paymentMethod,
        clinicId: String(params.clinicId),
        clinicName: params.clinicName,
        doctorId: params.doctorId,
        doctorName: params.doctorName || 'Assigned Doctor',
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

  if (intentError || !intentData?.success) {
    throw new Error(
      intentData?.error || intentError?.message || 'Failed to create booking payment intent.'
    );
  }

  const { paymentIntentId, clientKey } = intentData;

  // Step 2: Create Payment Method (GCash / Maya) directly with PayMongo
  const paymentMethodId = await createPayMongoPaymentMethod({
    paymentMethod: params.paymentMethod,
    name: params.patientName,
    email: params.patientEmail,
    phone: params.patientContact,
    address: params.patientAddress,
  });

  // Step 3: Attach Payment Method to PaymentIntent via Edge Function
  const returnUrl = getPayMongoReturnUrl(
    'booking',
    `appointment_id=${encodeURIComponent(params.appointmentId)}&method=${params.paymentMethod}`
  );

  const { data: attachData, error: attachError } = await supabase.functions.invoke(
    'paymongo-payment',
    {
      body: {
        action: 'attach_payment_method',
        paymentIntentId,
        paymentMethodId,
        clientKey,
        returnUrl,
      },
    }
  );

  if (attachError || !attachData?.success) {
    throw new Error(
      attachData?.error || attachError?.message || 'Failed to attach payment method.'
    );
  }

  const status = attachData.data?.attributes?.status;
  const redirectUrl = attachData.data?.attributes?.next_action?.redirect?.url;

  if (status === 'succeeded') {
    const check = await verifyPayMongoIntentOnce(paymentIntentId, clientKey);
    return {
      paymongoPaymentId: check.paymongoPaymentId || paymentIntentId,
      paymentIntentId,
    };
  }

  if (status === 'awaiting_next_action' && redirectUrl) {
    // Step 4: Redirect user to PayMongo Test Checkout page & verify
    const result = await openAndVerifyPayMongoCheckout({
      redirectUrl,
      paymentIntentId,
      clientKey,
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

  throw new Error(`Unexpected payment status: ${status || 'unknown'}`);
}

export async function processPayMongoSubscriptionPayment(params: {
  userId: string;
  billingCycle: 'monthly' | 'yearly';
  paymentMethod: 'gcash' | 'maya';
  fullName: string;
  email: string;
  address: string;
  mobileNumber: string;
}): Promise<{
  paymongoPaymentId: string;
  paymentIntentId: string;
  amount: number;
}> {
  // Resolve active plan from Supabase `plan` table matching website SubscriptionUpgradePage
  let planId =
    params.billingCycle === 'yearly'
      ? '00000000-0000-0000-0000-000000000004'
      : '00000000-0000-0000-0000-000000000003';
  let planPrice = params.billingCycle === 'yearly' ? 1999 : 199;

  try {
    const { data: plans } = await supabase.from('plan').select('*').eq('status', 'active');
    if (plans && plans.length > 0) {
      const matched =
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
        if (Number(matched.price) > 0) {
          planPrice = Number(matched.price);
        }
      }
    }
  } catch {}

  // Step 1: Create Subscription PaymentIntent via Supabase Edge Function
  const { data: intentData, error: intentError } = await supabase.functions.invoke(
    'paymongo-payment',
    {
      body: {
        action: 'create_intent',
        paymentMethod: params.paymentMethod,
        userId: params.userId,
        planId,
        billingCycle: params.billingCycle,
        fullName: params.fullName,
        email: params.email,
        address: params.address,
        mobileNumber: params.mobileNumber,
      },
    }
  );

  if (intentError || !intentData?.success) {
    throw new Error(
      intentData?.error || intentError?.message || 'Failed to create subscription payment intent.'
    );
  }

  const { paymentIntentId, clientKey } = intentData;

  // Step 2: Create Payment Method (GCash / Maya) directly with PayMongo
  const paymentMethodId = await createPayMongoPaymentMethod({
    paymentMethod: params.paymentMethod,
    name: params.fullName,
    email: params.email,
    phone: params.mobileNumber,
    address: params.address,
  });

  // Step 3: Attach Payment Method to PaymentIntent via Edge Function
  const returnUrl = getPayMongoReturnUrl(
    'subscription',
    `cycle=${params.billingCycle}&method=${params.paymentMethod}`
  );

  const { data: attachData, error: attachError } = await supabase.functions.invoke(
    'paymongo-payment',
    {
      body: {
        action: 'attach_payment_method',
        paymentIntentId,
        paymentMethodId,
        clientKey,
        returnUrl,
      },
    }
  );

  if (attachError || !attachData?.success) {
    throw new Error(
      attachData?.error || attachError?.message || 'Failed to attach payment method.'
    );
  }

  const status = attachData.data?.attributes?.status;
  const redirectUrl = attachData.data?.attributes?.next_action?.redirect?.url;

  if (status === 'succeeded') {
    const check = await verifyPayMongoIntentOnce(paymentIntentId, clientKey);
    return {
      paymongoPaymentId: check.paymongoPaymentId || paymentIntentId,
      paymentIntentId,
      amount: planPrice,
    };
  }

  if (status === 'awaiting_next_action' && redirectUrl) {
    // Step 4: Redirect user to PayMongo Test Checkout page & verify
    const result = await openAndVerifyPayMongoCheckout({
      redirectUrl,
      paymentIntentId,
      clientKey,
    });

    if (!result.succeeded) {
      throw new Error(
        'Payment was not completed or was declined on the PayMongo authorization page.'
      );
    }

    return {
      paymongoPaymentId: result.paymongoPaymentId,
      paymentIntentId,
      amount: planPrice,
    };
  }

  throw new Error(`Unexpected payment status: ${status || 'unknown'}`);
}

