// Save as: src/lib/vat.ts
//
// plan.price in the database is the NET (base) price entered by the admin.
// Patients see and pay the VAT-inclusive price: net x 1.12.
// Keep VAT_RATE in sync with the copy in supabase/functions/paymongo-payment/index.ts

export const VAT_RATE = 0.12;

/** Net (admin) price -> VAT-inclusive price the patient sees and pays. */
export function withVat(net: number): number {
  const netCentavos = Math.round((Number(net) || 0) * 100);
  const vatCentavos = Math.round(netCentavos * VAT_RATE);
  return (netCentavos + vatCentavos) / 100;
}

/** VAT-inclusive total -> net and VAT parts, for receipts and records. */
export function splitVat(gross: number) {
  const total = Number(gross) || 0;
  const net = Math.round((total / (1 + VAT_RATE)) * 100) / 100;
  const vat = Math.round((total - net) * 100) / 100;
  return { net, vat };
}

const vat = {
  VAT_RATE,
  withVat,
  splitVat,
};

export default vat;