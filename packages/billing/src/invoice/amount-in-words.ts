// Invoice total in English words (#254, #29). Rule 46 of the CGST Rules does not require it, but
// Indian invoices conventionally print it, and #29 asks for it. Indian grouping: crore, lakh,
// thousand, so 1,00,00,000 rupees is "One Crore", never "Ten Million". Pure and client-safe.

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
] as const;

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
] as const;

/** 1-99 in words. */
function belowHundred(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  const tens = TENS[Math.floor(n / 10)] ?? '';
  const ones = ONES[n % 10] ?? '';
  return ones ? `${tens} ${ones}` : tens;
}

/** 1-999 in words. */
function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(`${ONES[hundreds] ?? ''} Hundred`);
  if (rest > 0) parts.push(belowHundred(rest));
  return parts.join(' ');
}

/** A whole number in words with Indian grouping. `0` is "Zero". */
export function numberInWordsIndian(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(
      `numberInWordsIndian: expected a non-negative safe integer, got ${String(n)}`,
    );
  }
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  // Above 99 crore the crore count itself is spelled out recursively ("One Hundred Crore").
  if (crore > 0) parts.push(`${numberInWordsIndian(crore)} Crore`);
  if (lakh > 0) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rest > 0) parts.push(belowThousand(rest));
  return parts.join(' ');
}

/**
 * An integer-paise amount in words, e.g. `118050` is
 * "Rupees One Thousand One Hundred Eighty and Fifty Paise Only". Whole-rupee amounts omit the
 * paise clause; amounts under a rupee read "Rupees Zero and ... Paise Only".
 */
export function amountInWords(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new RangeError(
      `amountInWords: expected non-negative integer paise, got ${String(paise)}`,
    );
  }
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  // Always "Rupees", as on Indian cheques and invoices ("Rupees One Only").
  const rupeeWords = `Rupees ${numberInWordsIndian(rupees)}`;
  if (rest === 0) return `${rupeeWords} Only`;
  const paiseWords = `${belowHundred(rest)} ${rest === 1 ? 'Paisa' : 'Paise'}`;
  return `${rupeeWords} and ${paiseWords} Only`;
}
