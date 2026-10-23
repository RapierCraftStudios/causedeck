// Unicode blocks of the scripts the pipeline tells apart (en, ta, kn). Digits are script-neutral,
// whether ASCII, Tamil or Kannada: a case number such as "W.P. No. 1234/2024" doesn't read as
// English text, and a run of Tamil or Kannada digits alone carries no language.
export const SCRIPTS = ['latin', 'tamil', 'kannada'] as const;
export type Script = (typeof SCRIPTS)[number];

export type ScriptCounts = Record<Script, number>;

export const TAMIL_RANGE = [0x0b80, 0x0bff] as const;
export const KANNADA_RANGE = [0x0c80, 0x0cff] as const;
/** Digit code points inside the Tamil and Kannada blocks (U+0BE6–U+0BEF, U+0CE6–U+0CEF). */
const TAMIL_DIGITS = [0x0be6, 0x0bef] as const;
const KANNADA_DIGITS = [0x0ce6, 0x0cef] as const;

/** The script of a code point, or `null` for punctuation, digits, spaces and other scripts. */
export function scriptOf(codePoint: number): Script | null {
  if (
    (codePoint >= TAMIL_DIGITS[0] && codePoint <= TAMIL_DIGITS[1]) ||
    (codePoint >= KANNADA_DIGITS[0] && codePoint <= KANNADA_DIGITS[1])
  ) {
    return null;
  }
  if ((codePoint >= 0x41 && codePoint <= 0x5a) || (codePoint >= 0x61 && codePoint <= 0x7a)) {
    return 'latin';
  }
  if (codePoint >= TAMIL_RANGE[0] && codePoint <= TAMIL_RANGE[1]) return 'tamil';
  if (codePoint >= KANNADA_RANGE[0] && codePoint <= KANNADA_RANGE[1]) return 'kannada';
  return null;
}

export function emptyCounts(): ScriptCounts {
  return { latin: 0, tamil: 0, kannada: 0 };
}

export function countScripts(text: string): ScriptCounts {
  const counts = emptyCounts();
  for (const char of text) {
    const script = scriptOf(char.codePointAt(0) ?? 0);
    if (script !== null) counts[script] += 1;
  }
  return counts;
}

export function addCounts(a: ScriptCounts, b: ScriptCounts): ScriptCounts {
  return {
    latin: a.latin + b.latin,
    tamil: a.tamil + b.tamil,
    kannada: a.kannada + b.kannada,
  };
}
