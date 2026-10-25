// The outward guard (#735, ADR 0039): an update to a client or counsel states facts; it gives no
// advice, makes no commitment, quotes no fee, predicts no outcome and cites no authority. A
// sentence that does is removed. Phrase sets exist for English, Tamil and Kannada; Tamil and
// Kannada text is also checked against the English set because lawyers mix the two.
import type { Language } from '@causedeck/validators/outward-draft';

export const GUARD_CATEGORIES = ['advice', 'commitment', 'fee', 'prediction', 'citation'] as const;
export type GuardCategory = (typeof GUARD_CATEGORIES)[number];

type PhraseSet = Readonly<Record<GuardCategory, readonly string[]>>;

export const GUARD_PHRASES: Readonly<Record<Language, PhraseSet>> = {
  en: {
    advice: [
      'i advise',
      'we advise',
      'i recommend',
      'we recommend',
      'you should',
      'you must',
      'my advice',
      'i suggest',
      'it would be wise',
    ],
    commitment: [
      'i promise',
      'we promise',
      'i guarantee',
      'we guarantee',
      'i assure you',
      'we will ensure',
      'rest assured',
      'without fail',
    ],
    fee: [
      'our fee',
      'my fee',
      'professional fee',
      'legal fees',
      'invoice',
      'retainer',
      'per hearing',
      'fee of rs',
    ],
    prediction: [
      'likely to win',
      'likely to lose',
      'chances of success',
      'we will win',
      'we should win',
      'bound to succeed',
      'expect the court to',
      'probably be dismissed',
      'good chance',
    ],
    citation: [
      'supreme court held',
      'high court held',
      'as held in',
      'in the case of',
      'case law',
      'precedent',
      'ratio of',
      'landmark judgment',
    ],
  },
  ta: {
    advice: [
      'நான் பரிந்துரைக்கிறேன்',
      'நாங்கள் பரிந்துரைக்கிறோம்',
      'நீங்கள் செய்ய வேண்டும்',
      'என் அறிவுரை',
      'நான் அறிவுறுத்துகிறேன்',
      'நீங்கள் கண்டிப்பாக',
      'செய்வது நல்லது',
    ],
    commitment: [
      'உறுதி அளிக்கிறேன்',
      'நான் வாக்குறுதி',
      'நிச்சயமாக செய்வோம்',
      'உத்தரவாதம்',
      'கவலைப்பட வேண்டாம்',
      'நிச்சயம் முடித்து தருவோம்',
      'தவறாமல் செய்வேன்',
    ],
    fee: [
      'எங்கள் கட்டணம்',
      'என் கட்டணம்',
      'வழக்கறிஞர் கட்டணம்',
      'கட்டணம் ரூ',
      'முன்பணம்',
      'ஒரு விசாரணைக்கு',
      'பில் தொகை',
    ],
    prediction: [
      'வெற்றி பெற வாய்ப்பு',
      'தோல்வி அடைய வாய்ப்பு',
      'நாம் வெற்றி பெறுவோம்',
      'தள்ளுபடி ஆகும்',
      'நிச்சயம் வெல்வோம்',
      'நீதிமன்றம் ஏற்கும்',
      'வழக்கு நமக்கு சாதகமாக',
    ],
    citation: [
      'உச்ச நீதிமன்ற தீர்ப்பின்படி',
      'உயர் நீதிமன்றம் தீர்ப்பளித்தது',
      'வழக்கு சட்டம்',
      'முன்னுதாரணம்',
      'தீர்ப்பை மேற்கோள்',
      'சட்டப்பிரிவு',
      'வழக்கில் கூறியபடி',
    ],
  },
  kn: {
    advice: [
      'ನಾನು ಶಿಫಾರಸು ಮಾಡುತ್ತೇನೆ',
      'ನಾವು ಶಿಫಾರಸು ಮಾಡುತ್ತೇವೆ',
      'ನೀವು ಮಾಡಬೇಕು',
      'ನನ್ನ ಸಲಹೆ',
      'ನಾನು ಸೂಚಿಸುತ್ತೇನೆ',
      'ನೀವು ಖಂಡಿತ',
      'ಮಾಡುವುದು ಉತ್ತಮ',
    ],
    commitment: [
      'ಭರವಸೆ ನೀಡುತ್ತೇನೆ',
      'ನಾನು ಮಾತು ಕೊಡುತ್ತೇನೆ',
      'ಖಂಡಿತ ಮಾಡುತ್ತೇವೆ',
      'ಖಾತರಿ',
      'ಚಿಂತಿಸಬೇಡಿ',
      'ಖಂಡಿತ ಮುಗಿಸಿಕೊಡುತ್ತೇವೆ',
      'ತಪ್ಪದೆ ಮಾಡುತ್ತೇನೆ',
    ],
    fee: [
      'ನಮ್ಮ ಶುಲ್ಕ',
      'ನನ್ನ ಶುಲ್ಕ',
      'ವಕೀಲರ ಶುಲ್ಕ',
      'ಶುಲ್ಕ ರೂ',
      'ಮುಂಗಡ ಹಣ',
      'ಒಂದು ವಿಚಾರಣೆಗೆ',
      'ಬಿಲ್ ಮೊತ್ತ',
    ],
    prediction: [
      'ಗೆಲ್ಲುವ ಸಾಧ್ಯತೆ',
      'ಸೋಲುವ ಸಾಧ್ಯತೆ',
      'ನಾವು ಗೆಲ್ಲುತ್ತೇವೆ',
      'ವಜಾ ಆಗುತ್ತದೆ',
      'ಖಂಡಿತ ಗೆಲ್ಲುತ್ತೇವೆ',
      'ನ್ಯಾಯಾಲಯ ಒಪ್ಪುತ್ತದೆ',
      'ಪ್ರಕರಣ ನಮಗೆ ಅನುಕೂಲ',
    ],
    citation: [
      'ಸುಪ್ರೀಂ ಕೋರ್ಟ್ ತೀರ್ಪಿನಂತೆ',
      'ಹೈಕೋರ್ಟ್ ತೀರ್ಪು ನೀಡಿದೆ',
      'ಪ್ರಕರಣ ಕಾನೂನು',
      'ಪೂರ್ವನಿದರ್ಶನ',
      'ತೀರ್ಪನ್ನು ಉಲ್ಲೇಖ',
      'ಕಾಯ್ದೆಯ ಸೆಕ್ಷನ್',
      'ಪ್ರಕರಣದಲ್ಲಿ ಹೇಳಿದಂತೆ',
    ],
  },
};

/** Report citations whatever the language: `AIR 2019 SC 12`, `(2019) 4 SCC 1`, `A v. B`, `s. 138`. */
const CITATION_PATTERNS: readonly RegExp[] = [
  /\bAIR\s+\d{4}\b/iu,
  /\(\d{4}\)\s*\d+\s*[A-Z]{2,}\b/u,
  /\b\d{4}\s+SCC\b/iu,
  /\b[A-Z][\w.]*\s+v(?:s)?\.\s+[A-Z]/u,
  /\b(?:section|sec\.|s\.)\s*\d+[A-Za-z]?\b/iu,
];

export interface GuardViolation {
  category: GuardCategory;
  phrase: string;
  sentence: string;
}

export interface GuardResult {
  /** True when nothing was removed. */
  ok: boolean;
  /** The text with the offending sentences removed. */
  text: string;
  violations: GuardViolation[];
}

const SENTENCE = /[^.!?।\n]+(?:[.!?।]+|\n|$)/gu;
/** A full stop after an abbreviation does not end a sentence (`A v. B`, `s. 138`). */
const ABBREVIATION = /\b(v|vs|s|sec|no|ors|anr)\.(?=\s)/giu;
const DOT = '\u0001';

function setsFor(language: Language): PhraseSet[] {
  return language === 'en' ? [GUARD_PHRASES.en] : [GUARD_PHRASES[language], GUARD_PHRASES.en];
}

function violationOf(
  sentence: string,
  language: Language,
): Omit<GuardViolation, 'sentence'> | null {
  const lower = sentence.toLowerCase();
  for (const set of setsFor(language)) {
    for (const category of GUARD_CATEGORIES) {
      const phrase = set[category].find((p) => lower.includes(p));
      if (phrase !== undefined) return { category, phrase };
    }
  }
  for (const pattern of CITATION_PATTERNS) {
    const hit = pattern.exec(sentence);
    if (hit !== null) return { category: 'citation', phrase: hit[0] };
  }
  return null;
}

/** Remove every sentence that advises, commits, quotes a fee, predicts an outcome or cites. */
export function guardOutward(text: string, language: Language): GuardResult {
  const violations: GuardViolation[] = [];
  const kept: string[] = [];
  for (const match of text.replace(ABBREVIATION, `$1${DOT}`).matchAll(SENTENCE)) {
    const sentence = match[0].replaceAll(DOT, '.');
    const found = violationOf(sentence, language);
    if (found === null) kept.push(sentence);
    else violations.push({ ...found, sentence: sentence.trim() });
  }
  return { ok: violations.length === 0, text: kept.join('').trim(), violations };
}
