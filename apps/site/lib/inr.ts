// Rupee formatter for the pricing page: integer paise in, Indian digit grouping out (₹1,19,900).
// Amounts only ever come from content/pricing.ts.
function group(whole: string): string {
  if (whole.length <= 3) return whole;
  const head = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${head},${whole.slice(-3)}`;
}

/** `formatInr(119_900)` is `₹1,199`; paise are shown only when not a whole rupee. */
export function formatInr(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new RangeError(`INR amounts are non-negative integer paise: ${String(paise)}`);
  }
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  const fraction = rest === 0 ? '' : `.${String(rest).padStart(2, '0')}`;
  return `₹${group(String(rupees))}${fraction}`;
}
