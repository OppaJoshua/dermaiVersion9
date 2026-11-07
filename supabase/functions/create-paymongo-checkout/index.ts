export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const PAYMONGO_API = "https://api.paymongo.com/v1";

Deno.serve(async (req: Request) => {
  // Handle browser preflight check instantly
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const secretKey = Deno.env.get('PAYMONGO_SECRET_KEY');
    if (!secretKey) {
      return new Response(
        JSON.stringify({ error: 'PAYMONGO_SECRET_KEY is not configured in Supabase Secrets' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      );
    }

    const body = await req.json();
    const {
      amount,
      payment_method,
      paymentMethod,
      phone,
      mobile_number,
      patientContact,
      appointment_id,
      appointmentId,
      clinic_id: _clinic_id,
      clinicId: _clinicId,
      patient_email,
      patientEmail,
      email,
      patient_name,
      patientName,
      patient_address,
      patientAddress,
      success_url,
      cancel_url,
      return_url,
      returnUrl,
    } = body;

    const effectiveApptId = (appointment_id || appointmentId || '').trim();
    const effectivePhone = (phone || mobile_number || patientContact || '').trim();
    const effectiveEmail = (patient_email || patientEmail || email || '').trim();
    const effectiveName = (patient_name || patientName || 'Patient').trim();
    const effectiveAddress = (patient_address || patientAddress || 'Cebu City').trim();
    const effectiveMethod =
      (payment_method || paymentMethod || 'gcash') === 'maya'
        ? 'paymaya'
        : (payment_method || paymentMethod || 'gcash');
    const effectiveReturnUrl =
      success_url || return_url || returnUrl || 'dermaimobile://';
    const effectiveCancelUrl =
      cancel_url || return_url || returnUrl || 'dermaimobile://';

    const numAmount = Number(amount);
    if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
      return new Response(
        JSON.stringify({ error: 'Valid payment amount is required' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    const amountInCents = Math.round(numAmount * 100);

    // Call PayMongo Checkout Sessions API with automated email receipt
    const authHeader = `Basic ${btoa(secretKey + ':')}`;
    const checkoutSessionPayload = {
      data: {
        attributes: {
          send_email_receipt: true,
          show_description: true,
          show_line_items: true,
          line_items: [
            {
              currency: 'PHP',
              amount: amountInCents,
              name: 'Online Dermatological Consultation',
              description: `Appointment Ref: ${effectiveApptId || 'Online Consultation'}`,
              quantity: 1,
            },
          ],
          payment_method_types: [effectiveMethod === 'paymaya' ? 'paymaya' : 'gcash'],
          reference_number: effectiveApptId || undefined,
          description: `DermAI Consultation Fee - ${effectiveApptId}`,
          success_url: effectiveReturnUrl,
          cancel_url: effectiveCancelUrl,
          billing: {
            name: effectiveName,
            email: effectiveEmail || 'billing@dermai.com',
            phone: effectivePhone,
            address: {
              line1: effectiveAddress,
              city: 'Cebu City',
              country: 'PH',
            },
          },
        },
      },
    };

    const pmRes = await fetch(`${PAYMONGO_API}/checkout_sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(checkoutSessionPayload),
    });

    const pmData = await pmRes.json();

    if (!pmRes.ok || pmData.errors) {
      const errMsg =
        pmData.errors?.[0]?.detail || 'Failed to create PayMongo checkout session';
      console.warn('[create-paymongo-checkout] PayMongo API error:', errMsg, pmData);
      return new Response(
        JSON.stringify({ error: errMsg, details: pmData.errors }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: pmRes.status >= 400 ? pmRes.status : 400,
        }
      );
    }

    const sessionAttrs = pmData?.data?.attributes;
    const checkoutUrl = sessionAttrs?.checkout_url;
    const paymentIntentId =
      sessionAttrs?.payment_intent?.id ||
      sessionAttrs?.payment_intent_id ||
      pmData?.data?.id;
    const clientKey = sessionAttrs?.client_key || '';

    const data = {
      success: true,
      checkout_url: checkoutUrl,
      checkoutUrl: checkoutUrl,
      paymentIntentId,
      clientKey,
      data: pmData.data,
    };

    // Ensure all successful Response returns include the CORS headers
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: unknown) {
    console.error('[create-paymongo-checkout] Unhandled error:', error);
    // Ensure all error Response returns also include CORS headers
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
