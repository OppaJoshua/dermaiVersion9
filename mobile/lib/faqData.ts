import { supabase } from '@/lib/supabase';

export interface FAQItem {
  id: string;
  q: string;
  a: string;
  category?: string;
}

/**
 * Exact FAQ data synchronized with Patient Web Application HelpPage.tsx
 */
export const PATIENT_FAQS: FAQItem[] = [
  {
    id: 'ai-skin-scan',
    q: 'How does the AI skin scan work?',
    a: 'You answer a short questionnaire and upload a photo of the affected skin area. Our AI analyzes the image and gives you a preliminary assessment with a confidence score. It is not a medical diagnosis.',
    category: 'AI Scan & Screening',
  },
  {
    id: 'health-data-privacy',
    q: 'Is my health data private?',
    a: 'Yes. Your scan results and personal information are stored securely and are not shared with third parties without your consent.',
    category: 'Privacy & Security',
  },
  {
    id: 'book-appointment',
    q: 'How do I book an appointment?',
    a: 'Go to Search Clinic under Appointment Booking in the sidebar, choose a verified clinic, and fill out the appointment form. You will receive a confirmation once the clinic reviews your request.',
    category: 'Appointments',
  },
  {
    id: 'plan-difference',
    q: 'What is the difference between the Free and Pro plan?',
    a: 'The Free plan gives you 3 skin scans per account. The Pro plan (₱199/month or ₱1,999/year) gives you unlimited scans and full access to all features.',
    category: 'Subscription & Plans',
  },
  {
    id: 'cancel-subscription',
    q: 'How do I cancel my subscription?',
    a: 'You can cancel your subscription at any time from the Billing page under Settings. Your Pro access will remain active until the end of the billing period.',
    category: 'Subscription & Plans',
  },
];

/**
 * Dynamically queries FAQs from Supabase if an `faq_articles` table exists,
 * otherwise safely returns the mirrored authoritative web constant list.
 */
export async function getFaqsAsync(): Promise<FAQItem[]> {
  try {
    const { data, error } = await supabase
      .from('faq_articles')
      .select('id, question, answer, category')
      .order('display_order', { ascending: true });

    if (!error && Array.isArray(data) && data.length > 0) {
      return data.map((item: any) => ({
        id: String(item.id),
        q: item.question || item.q,
        a: item.answer || item.a,
        category: item.category,
      }));
    }
  } catch {
    // Fallback to static web constants
  }
  return PATIENT_FAQS;
}

