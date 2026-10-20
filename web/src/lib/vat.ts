// Save as: src/lib/vat.ts
//
// plan.price in the database is the NET (base) price entered by the admin.
// Pricing Formula:
// vat_amount = round(base_price * 0.12, 2)
// total_price = round(base_price + vat_amount, 2)
// For base_price = 177.68, vat_amount = 21.32 and total_price = 199.00.

export const VAT_RATE = 0.12;

/**
 * Calculates VAT amount and gross total price from a base price (excl. VAT).
 * Formula:
 * vat_amount = round(base_price * 0.12, 2)
 * total_price = round(base_price + vat_amount, 2)
 */
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

/** Net (base) price -> VAT-inclusive price the patient sees and pays. */
export function withVat(net: number): number {
  return calculatePricing(net).totalPrice;
}

/**
 * Splits gross total into base and VAT.
 * If known basePrice is provided, uses exact forward formula:
 * vat = round(basePrice * 0.12, 2)
 * Otherwise backward-calculates from gross total.
 */
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

const vat = {
  VAT_RATE,
  calculatePricing,
  withVat,
  splitVat,
};

export default vat;