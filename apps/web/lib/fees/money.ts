// Money for the fee screens (#871): paise in, rupees with Indian digit grouping out. Amounts are
// integer paise everywhere; a rupee string typed into a form converts here and nowhere else.

/** `₹1,23,456.00` for a count of paise, grouped the Indian way whatever the UI language. */
export function formatPaise(paise: number, locale = 'en'): string {
  const language = locale.split('-')[0] ?? 'en';
  return new Intl.NumberFormat(`${language}-IN`, {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(paise / 100);
}

/** Paise for a typed rupee amount (`"1500"`, `"1,500.50"`); null when it is not a money amount. */
export function rupeesToPaise(value: string): number | null {
  const cleaned = value.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(paise) ? paise : null;
}
