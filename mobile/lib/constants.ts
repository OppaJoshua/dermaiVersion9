export const COLORS = {
  primary: '#be185d',
  primaryDark: '#9d174d',
  primaryLight: '#fce7f3',
  primaryXLight: '#fdf2f8',
  secondary: '#f472b6',
  background: '#fdf2f8',
  surface: '#ffffff',
  text: '#1f2937',
  textSecondary: '#6b7280',
  textLight: '#9ca3af',
  border: '#f3e8ee',
  borderDark: '#fbcfe8',
  success: '#16a34a',
  successLight: '#dcfce7',
  warning: '#d97706',
  warningLight: '#fef3c7',
  danger: '#dc2626',
  dangerLight: '#fee2e2',
  info: '#2563eb',
  infoLight: '#dbeafe',
  shadow: 'rgba(190, 24, 93, 0.15)',
  overlay: 'rgba(0, 0, 0, 0.5)',
};

export const APP_NAME = 'DermAI';
export const APP_VERSION = '1.0.0';

export const SEVERITY_COLORS = {
  mild: { bg: '#dcfce7', text: '#16a34a', label: 'Mild' },
  moderate: { bg: '#fef3c7', text: '#d97706', label: 'Moderate' },
  severe: { bg: '#fee2e2', text: '#dc2626', label: 'Severe' },
};

export const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: '#fef3c7', text: '#d97706', label: 'Pending' },
  confirmed: { bg: '#dbeafe', text: '#2563eb', label: 'Confirmed' },
  completed: { bg: '#dcfce7', text: '#16a34a', label: 'Completed' },
  cancelled: { bg: '#fee2e2', text: '#dc2626', label: 'Cancelled' },
  open: { bg: '#fef3c7', text: '#d97706', label: 'Open' },
  'in-progress': { bg: '#dbeafe', text: '#2563eb', label: 'In Progress' },
  resolved: { bg: '#dcfce7', text: '#16a34a', label: 'Resolved' },
  free: { bg: '#f3f4f6', text: '#6b7280', label: 'Free' },
  premium: { bg: '#fce7f3', text: '#be185d', label: 'Premium' },
};

// Sample clinics for Cebu — mirrors web FindClinicsPage/AppointmentPage exactly
export const CEBU_DISTRICTS = [
  'Cebu City',
  'Mandaue City',
  'Lapu-Lapu City',
  'Talisay City',
  'Consolacion',
  'Liloan',
  'Minglanilla',
  'Naga City',
  'Carcar City',
  'Danao City',
  'Toledo City',
  'Other',
];

export const SAMPLE_CLINICS = [
  {
    id: 1,
    name: 'Cebu Skin Institute',
    address: 'Mango Ave, Cebu City',
    phone: '(032) 234-5678',
    facebook: 'https://facebook.com/cebuskinstitute',
    hours: 'Mon-Sat: 8:00 AM - 5:00 PM',
    verified: true,
    district: 'Cebu City',
    lat: 10.315,
    lng: 123.885,
    consultationFee: '600',
    doctors: [
      { name: 'Dr. Maria Santos', specialization: 'Fungal & Parasitic Infections' },
      { name: 'Dr. Juan Reyes', specialization: 'Acne & Inflammatory Conditions' },
    ],
    conditionsTreated: [
      'Tinea Versicolor (Anapaw)',
      'Tinea Corporis (Buni)',
      'Acne Vulgaris (Taghiyawat)',
      'Atopic Dermatitis (Eczema)',
      'Melasma (Dark Patches)',
    ],
  },
  {
    id: 2,
    name: 'SkinMD Dermatology Center',
    address: 'AS Fortuna St, Mandaue City',
    phone: '(032) 345-6789',
    facebook: 'https://facebook.com/skinmdcenter',
    hours: 'Mon-Fri: 9:00 AM - 6:00 PM',
    verified: true,
    district: 'Mandaue City',
    lat: 10.333,
    lng: 123.932,
    consultationFee: '650',
    doctors: [
      { name: 'Dr. Anna Cruz', specialization: 'Pigmentation & Dermatitis' },
    ],
    conditionsTreated: [
      'Melasma (Dark Patches)',
      'Contact Dermatitis (Skin Allergy)',
      'Prickly Heat (Bungang Araw)',
      'Atopic Dermatitis (Eczema)',
    ],
  },
  {
    id: 3,
    name: 'DermaPlus Clinic',
    address: 'Osmeña Blvd, Cebu City',
    phone: '(032) 456-7890',
    facebook: 'https://facebook.com/dermaplusclinic',
    hours: 'Mon-Sat: 8:00 AM - 7:00 PM',
    verified: true,
    district: 'Cebu City',
    lat: 10.307,
    lng: 123.893,
    consultationFee: '550',
    doctors: [
      { name: 'Dr. Ramon Lopez', specialization: 'Bacterial & Fungal Infections' },
    ],
    conditionsTreated: [
      'Tinea Corporis (Buni)',
      "Tinea Pedis (Athlete's Foot)",
      'Impetigo (Nana sa Balat)',
      'Contact Dermatitis (Skin Allergy)',
    ],
  },
  {
    id: 4,
    name: 'Cebu Dermatology Associates',
    address: 'Gov. M. Cuenco Ave, Cebu City',
    phone: '(032) 567-8901',
    facebook: 'https://facebook.com/cebudermassoc',
    hours: 'Tue-Sat: 9:00 AM - 5:00 PM',
    verified: false,
    district: 'Cebu City',
    lat: 10.32,
    lng: 123.91,
    consultationFee: '600',
    doctors: [
      { name: 'Dr. Lisa Fernandez', specialization: 'General Dermatology' },
    ],
    conditionsTreated: ['Acne Vulgaris (Taghiyawat)', 'Tinea Versicolor (Anapaw)'],
  },
  {
    id: 5,
    name: 'Island Skin Care Center',
    address: 'ML Quezon National Highway, Lapu-Lapu City',
    phone: '(032) 678-9012',
    facebook: 'https://facebook.com/islandskincare',
    hours: 'Mon-Fri: 8:30 AM - 4:30 PM',
    verified: false,
    district: 'Lapu-Lapu City',
    lat: 10.31,
    lng: 123.953,
    consultationFee: '550',
    doctors: [
      { name: 'Dr. Miguel Torres', specialization: 'Skin Allergies' },
    ],
    conditionsTreated: ['Contact Dermatitis (Skin Allergy)', 'Atopic Dermatitis (Eczema)'],
  },
  {
    id: 6,
    name: 'SkinVita Derma Clinic',
    address: 'Talisay City, Cebu',
    phone: '(032) 789-0123',
    facebook: 'https://facebook.com/skinvitaclinic',
    hours: 'Mon-Sat: 9:00 AM - 6:00 PM',
    verified: true,
    district: 'Talisay City',
    lat: 10.246,
    lng: 123.849,
    consultationFee: '600',
    doctors: [
      { name: 'Dr. Patricia Mercado', specialization: 'Acne & Skincare' },
    ],
    conditionsTreated: [
      'Acne Vulgaris (Taghiyawat)',
      'Prickly Heat (Bungang Araw)',
      'Tinea Versicolor (Anapaw)',
      'Melasma (Dark Patches)',
    ],
  },
];

export const PREMIUM_FEATURES = [
  'Unlimited AI skin scans per month',
  'Detailed diagnostic reports with PDF export',
  'Priority appointment booking',
  'Direct chat with dermatologists',
  'Personalized skincare routine recommendations',
  'Early access to new features',
];

export const MAX_FREE_SCANS = 3; // 3 free scans for non-premium users
