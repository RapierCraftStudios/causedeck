// NCLT case numbers (#38, ADR 0018): `CP(IB) No. 132/BB/2022` is prefix `CP(IB)`, number 132,
// bench `BB` (Bengaluru) and year 2022; applications read `IA No. 275/2021`, `IA 275/21` or
// `IA(IB) No. 12/BB/2024`. A cell can hold several numbers, separated by commas, semicolons or
// line breaks, and a bare `276/21` after `IA No. 275/21` takes the prefix before it. Pure.
import { expandYear, type YearOptions } from '../normalise/case-number.ts';
import { compactCaseType, parseCaseType } from '../normalise/case-type.ts';

export interface NcltCaseNumber {
  /** As printed, e.g. `CP(IB)`. */
  prefix: string;
  /** Compact code after the config's aliases, e.g. `CPIB`. */
  code: string;
  /** Leading zeros stripped. */
  number: string;
  /** Bench code, `BB` for Bengaluru; null when the number has none. */
  bench: string | null;
  year: number;
}

export interface NcltCaseNumberOptions extends YearOptions {
  /** `nomenclature.caseTypes`: code -> extra spellings. */
  aliases?: Readonly<Record<string, readonly string[]>>;
}

// prefix? (No.|Nos.)? number / (bench /)? year
const REFERENCE =
  /(?:\b([A-Z][A-Za-z.]*(?:\s*\(\s*[A-Za-z.]+\s*\))?)\s*)?(?:\bNos?\.?\s*)?\b(\d{1,7})\s*\/\s*(?:([A-Z]{1,4})\s*\/\s*)?(\d{4}|\d{2})\b/g;
const NO_WORD = /^nos?\.?$/i;

/** Every case number in `text`, in order; a number without a prefix takes the previous one's. */
export function parseNcltCaseNumbers(
  text: string,
  options: NcltCaseNumberOptions = {},
): NcltCaseNumber[] {
  const out: NcltCaseNumber[] = [];
  let previous: { prefix: string; code: string } | null = null;
  for (const match of text.matchAll(REFERENCE)) {
    const rawPrefix = match[1]?.trim();
    let prefix: { prefix: string; code: string } | null = previous;
    if (rawPrefix !== undefined && rawPrefix !== '' && !NO_WORD.test(rawPrefix)) {
      const parsed = parseCaseType(rawPrefix, { aliases: options.aliases ?? {}, seatSuffixes: [] });
      prefix = { prefix: rawPrefix, code: parsed?.caseType ?? compactCaseType(rawPrefix) };
    }
    const year = expandYear(match[4] ?? '', options);
    if (prefix === null || year === null) continue;
    previous = prefix;
    out.push({
      prefix: prefix.prefix,
      code: prefix.code,
      number: (match[2] ?? '').replace(/^0+(?=\d)/, ''),
      bench: match[3] ?? null,
      year,
    });
  }
  return out;
}

/** The first case number in `text`, or null. */
export function parseNcltCaseNumber(
  text: string,
  options: NcltCaseNumberOptions = {},
): NcltCaseNumber | null {
  return parseNcltCaseNumbers(text, options)[0] ?? null;
}
