// Name normalisation for conflict checks (#500, D-048). A name becomes a phonetic key so that
// `முருகன்`, `ಮುರುಗನ್` and `Murugan` meet: Tamil (U+0B80-0BFF) and Kannada (U+0C80-0CFF) are read
// letter by letter into Latin, then honorifics, company suffixes and organisation abbreviations are
// dropped or expanded, spelling variants (voicing, aspiration, vowel length, doubled letters) are
// folded, and the tokens are sorted so word order does not matter. The key is for matching only,
// never shown, and a match is a prompt for the advocate, not a verdict.

const CONSONANTS: Readonly<Record<string, string>> = {
  // Tamil
  க: 'k', ங: 'ng', ச: 's', ஞ: 'ny', ட: 't', ண: 'n', த: 't', ந: 'n', ப: 'p', ம: 'm', ய: 'y',
  ர: 'r', ல: 'l', வ: 'v', ழ: 'l', ள: 'l', ற: 'r', ன: 'n', ஜ: 'j', ஷ: 'sh', ஸ: 's', ஹ: 'h',
  // Kannada
  ಕ: 'k', ಖ: 'kh', ಗ: 'g', ಘ: 'gh', ಙ: 'ng', ಚ: 'ch', ಛ: 'chh', ಜ: 'j', ಝ: 'jh', ಞ: 'ny',
  ಟ: 't', ಠ: 'th', ಡ: 'd', ಢ: 'dh', ಣ: 'n', ತ: 't', ಥ: 'th', ದ: 'd', ಧ: 'dh', ನ: 'n',
  ಪ: 'p', ಫ: 'ph', ಬ: 'b', ಭ: 'bh', ಮ: 'm', ಯ: 'y', ರ: 'r', ಱ: 'r', ಲ: 'l', ವ: 'v',
  ಶ: 'sh', ಷ: 'sh', ಸ: 's', ಹ: 'h', ಳ: 'l',
};

const VOWELS: Readonly<Record<string, string>> = {
  அ: 'a', ஆ: 'aa', இ: 'i', ஈ: 'ii', உ: 'u', ஊ: 'uu', எ: 'e', ஏ: 'ee', ஐ: 'ai', ஒ: 'o', ஓ: 'oo', ஔ: 'au',
  ಅ: 'a', ಆ: 'aa', ಇ: 'i', ಈ: 'ii', ಉ: 'u', ಊ: 'uu', ಋ: 'ru', ಎ: 'e', ಏ: 'ee', ಐ: 'ai', ಒ: 'o', ಓ: 'oo', ಔ: 'au',
};

const VOWEL_SIGNS: Readonly<Record<string, string>> = {
  ா: 'aa', ி: 'i', ீ: 'ii', ு: 'u', ூ: 'uu', ெ: 'e', ே: 'ee', ை: 'ai', ொ: 'o', ோ: 'oo', ௌ: 'au',
  ಾ: 'aa', ಿ: 'i', ೀ: 'ii', ು: 'u', ೂ: 'uu', ೃ: 'ru', ೆ: 'e', ೇ: 'ee', ೈ: 'ai', ೊ: 'o', ೋ: 'oo', ೌ: 'au',
};

const VIRAMAS = new Set(['்', '್']);
const NASAL_SIGNS: Readonly<Record<string, string>> = { ஂ: 'm', ಂ: 'm', ஃ: 'h', ಃ: 'h' };

const HONORIFICS = new Set([
  'sri', 'shri', 'smt', 'kum', 'mr', 'mrs', 'ms', 'miss', 'dr', 'adv', 'advocate', 'thiru',
  'tmt', 'selvi', 'late', 'the',
]);
const COMPANY_SUFFIXES = new Set([
  'pvt', 'private', 'ltd', 'limited', 'llp', 'inc', 'co', 'company', 'corp', 'corporation', 'and',
]);
/** Organisation abbreviations, expanded so `Govt` and `Government` agree. */
const ORGANISATION_ALIASES: Readonly<Record<string, string>> = {
  govt: 'government',
  dept: 'department',
  assn: 'association',
  bros: 'brothers',
  engg: 'engineering',
  inds: 'industries',
  mfg: 'manufacturing',
  svcs: 'services',
  intl: 'international',
};

/** Tamil and Kannada letters read into Latin; everything else passes through. */
export function transliterate(text: string): string {
  let out = '';
  let pendingA = false;
  const flush = () => {
    if (pendingA) out += 'a';
    pendingA = false;
  };
  for (const ch of text.normalize('NFC')) {
    const consonant = CONSONANTS[ch];
    if (consonant !== undefined) {
      flush();
      out += consonant;
      pendingA = true;
    } else if (VOWEL_SIGNS[ch] !== undefined) {
      pendingA = false;
      out += VOWEL_SIGNS[ch];
    } else if (VIRAMAS.has(ch)) {
      pendingA = false;
    } else if (VOWELS[ch] !== undefined) {
      flush();
      out += VOWELS[ch];
    } else if (NASAL_SIGNS[ch] !== undefined) {
      flush();
      out += NASAL_SIGNS[ch];
    } else {
      flush();
      out += ch;
    }
  }
  flush();
  return out;
}

/** Spelling variants folded to one form: voicing, aspiration, vowel length, doubled letters. */
function fold(token: string): string {
  return token
    .replace(/(ow|ou)/g, 'au')
    .replace(/zh/g, 'l')
    .replace(/x/g, 'ks')
    .replace(/(ch|sh|z|j)/g, 's')
    .replace(/(aa|ii|ee|oo|uu)/g, (m) => (m === 'ee' ? 'i' : m === 'oo' || m === 'uu' ? 'u' : m[0]!))
    .replace(/(kh|gh|g|q|c)/g, 'k')
    .replace(/(th|dh|d)/g, 't')
    .replace(/(ph|bh|b|f)/g, 'p')
    .replace(/w/g, 'v')
    .replace(/h/g, '')
    .replace(/(.)\1+/g, '$1')
    .replace(/o/g, 'u')
    .replace(/e/g, 'i');
}

/** The sorted phonetic tokens of a name; empty when nothing but titles and suffixes remain. */
export function nameTokens(name: string): string[] {
  const words = transliterate(name)
    .toLowerCase()
    .replace(/m\/s\b/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w !== '')
    .map((w) => ORGANISATION_ALIASES[w] ?? w)
    .filter((w) => !HONORIFICS.has(w) && !COMPANY_SUFFIXES.has(w));
  return words.map(fold).filter((w) => w !== '').sort();
}

/** The matching key of a name: its phonetic tokens, sorted and joined. */
export function nameKey(name: string): string {
  return nameTokens(name).join(' ');
}

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length] ?? 0;
}

/** Keys shorter than this must be equal: a near miss on a short name is noise. */
const MIN_FUZZY_LENGTH = 6;
const FUZZY_THRESHOLD = 0.85;

/** 1 for equal keys, a similarity in [FUZZY_THRESHOLD, 1) for a near miss, 0 for no match. */
export function nameSimilarity(a: string, b: string): number {
  const ka = nameKey(a);
  const kb = nameKey(b);
  if (ka === '' || kb === '') return 0;
  if (ka === kb) return 1;
  if (Math.min(ka.length, kb.length) < MIN_FUZZY_LENGTH) return 0;
  const score = 1 - distance(ka, kb) / Math.max(ka.length, kb.length);
  return score >= FUZZY_THRESHOLD ? score : 0;
}
