// Unicode blocks of the scripts the pipeline tells apart (en, ta, kn). Digits written in Tamil or
// Kannada count for their script; ASCII digits are script-neutral so a case number such as
// "W.P. No. 1234/2024" does not read as English text.
export const SCRIPTS = ['latin', 'tamil', 'kannada'] as const;
export type Script = (typeof SCRIPTS)[number];

export type ScriptCounts = Record<Script, number>;

export const TAMIL_RANGE = [0x0b80, 0x0bff] as const;
export const KANNADA_RANGE = [0x0c80, 0x0cff] as const;

/** The script of a code point, or `null` for punctuation, ASCII digits, spaces and other scripts. */
export function scriptOf(codePoint: number): Script | null {
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
