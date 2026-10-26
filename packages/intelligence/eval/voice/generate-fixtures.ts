// Generates the synthetic voice transcripts under `fixtures/voice/` (#541): invented hearing notes
// in English, Tamil, Kannada and mixed speech, each with the labels the eval scores against. No
// real speech, party or case appears. Seeded, so the committed files are reproducible:
//   node --experimental-strip-types eval/voice/generate-fixtures.ts
// Expected dates are computed here with plain calendar arithmetic, independently of the parser.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { knOrdinal, SPOKEN_DATE_VOCABULARY, taOrdinal } from '../../src/structure/spoken-dates.ts';

const PER_LANGUAGE = 48;
const root = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/voice');

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Lang = 'en' | 'ta' | 'kn';
const rand = rng(541);
const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T;

const pad = (n: number): string => String(n).padStart(2, '0');
const iso = (t: Date): string =>
  `${String(t.getUTCFullYear())}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
const plusDays = (t: Date, n: number): Date => new Date(t.getTime() + n * 86_400_000);
const suffix = (d: number): string =>
  d % 10 === 1 && d !== 11
    ? 'st'
    : d % 10 === 2 && d !== 12
      ? 'nd'
      : d % 10 === 3 && d !== 13
        ? 'rd'
        : 'th';
/** `phrase` with `word` in front unless it already starts with a preposition. */
const withPrep = (word: string, phrase: string): string =>
  /^(on|after|next)\s/.test(phrase) ? phrase : `${word} ${phrase}`;
const title = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const V = SPOKEN_DATE_VOCABULARY;

interface Phrase {
  text: string;
  date: string;
}

/** A spoken date after `hearing`, in the style of `lang`; `date` is what it means. */
function datePhrase(lang: Lang, hearing: Date): Phrase {
  const style = int(0, 4);
  if (style === 3) {
    const weekday = int(0, 6);
    const delta = (weekday - hearing.getUTCDay() + 7) % 7 || 7;
    const date = iso(plusDays(hearing, delta));
    const name = V[lang].weekdays[weekday] as string;
    return {
      text: lang === 'en' ? `next ${name}` : `${lang === 'ta' ? 'அடுத்த' : 'ಮುಂದಿನ'} ${name}`,
      date,
    };
  }
  if (style === 4) {
    const n = int(2, 8);
    const date = iso(plusDays(hearing, 7 * n));
    if (lang === 'en') return { text: `after ${V.en.cardinals[n - 1] as string} weeks`, date };
    const word = V[lang].cardinals[n - 1] as string;
    return {
      text: lang === 'ta' ? `${word} வாரங்கள் கழித்து` : `${word} ವಾರಗಳ ನಂತರ`,
      date,
    };
  }
  const near = style === 2;
  const target = plusDays(hearing, near ? int(1, 27) : int(1, 120));
  const d = target.getUTCDate();
  const m = target.getUTCMonth();
  const date = iso(target);
  const monthName = V[lang].months[m] as string | readonly string[];
  const month = typeof monthName === 'string' ? monthName : (monthName[0] as string);
  if (lang === 'en') {
    if (near) return { text: `on the ${String(d)}${suffix(d)}`, date };
    const forms = [
      `${V.en.ordinals[d - 1] as string} of ${title(month)}`,
      `${String(d)}/${String(m + 1)}`,
      `${title(month)} ${String(d)}${suffix(d)}`,
    ];
    return { text: pick(forms), date };
  }
  const card = V[lang].cardinals[d - 1] as string;
  if (lang === 'ta') {
    const ord = taOrdinal(card);
    if (near) return { text: `${ord} தேதி`, date };
    return { text: pick([`${month} ${ord} தேதி`, `${String(d)}/${String(m + 1)}`]), date };
  }
  const ord = knOrdinal(card);
  if (near) return { text: `${ord} ತಾರೀಖು`, date };
  return { text: pick([`${month} ${ord} ತಾರೀಖು`, `${String(d)}/${String(m + 1)}`]), date };
}

interface Voice {
  outcome: string[];
  reason: string[];
  next: (p: string) => string;
  direction: (what: string, due: string | null) => string;
  directionWhat: string[];
  task: string[];
  taskSentence: (t: string) => string;
  matter: (n: number, y: number) => string;
}

const VOICES: Record<Lang, Voice> = {
  en: {
    outcome: [
      'The matter was adjourned.',
      'Arguments were heard and the matter stands adjourned.',
      'The court heard both sides and the matter was adjourned again.',
    ],
    reason: [
      'The opposite counsel sought time.',
      'The bench was not available.',
      'Pleadings are incomplete.',
    ],
    next: (p) => `Next hearing ${withPrep('on', p)}.`,
    direction: (what, due) =>
      due === null
        ? `The court directed ${what}.`
        : `The court directed ${what} ${withPrep('by', due)}.`,
    directionWhat: [
      'the respondent to file a counter affidavit',
      'the petitioner to file the rejoinder',
      'the State to produce the original records',
      'both sides to exchange written submissions',
    ],
    task: [
      'call the client about the vakalatnama',
      'collect the certified copy',
      'update the junior on the listing',
    ],
    taskSentence: (t) => `Remind me to ${t}.`,
    matter: (n, y) => `In case ${String(n)} of ${String(y)} today.`,
  },
  ta: {
    outcome: ['வழக்கு ஒத்திவைக்கப்பட்டது.', 'வாதங்கள் கேட்கப்பட்டு வழக்கு ஒத்திவைக்கப்பட்டது.'],
    reason: ['எதிர் தரப்பு வழக்கறிஞர் கால அவகாசம் கேட்டார்.', 'பதில் மனு தாக்கல் செய்யப்படவில்லை.'],
    next: (p) => `அடுத்த விசாரணை ${p}.`,
    direction: (what, due) =>
      due === null ? `${what} உத்தரவிட்டது.` : `${what} ${due} உத்தரவிட்டது.`,
    directionWhat: [
      'எதிர்மனுதாரர் பதில் மனுவை தாக்கல் செய்ய',
      'மனுதாரர் எதிர்வாதத்தை தாக்கல் செய்ய',
      'அரசு அசல் ஆவணங்களை சமர்ப்பிக்க',
    ],
    task: ['கட்சிக்காரரை அழைக்க', 'சான்றிட்ட நகலை வாங்க', 'ஜூனியருக்கு தெரிவிக்க'],
    taskSentence: (t) => `${t} நினைவூட்டு.`,
    matter: (n, y) => `வழக்கு ${String(n)}/${String(y)} இன்று.`,
  },
  kn: {
    outcome: ['ಪ್ರಕರಣವನ್ನು ಮುಂದೂಡಲಾಯಿತು.', 'ವಾದ ಆಲಿಸಿ ಪ್ರಕರಣವನ್ನು ಮುಂದೂಡಲಾಯಿತು.'],
    reason: ['ಎದುರು ವಕೀಲರು ಸಮಯ ಕೇಳಿದರು.', 'ಪೀಠ ಲಭ್ಯವಿರಲಿಲ್ಲ.'],
    next: (p) => `ಮುಂದಿನ ವಿಚಾರಣೆ ${p}.`,
    direction: (what, due) => (due === null ? `${what} ಆದೇಶಿಸಿತು.` : `${what} ${due} ಆದೇಶಿಸಿತು.`),
    directionWhat: [
      'ಪ್ರತಿವಾದಿ ಆಕ್ಷೇಪಣೆ ಸಲ್ಲಿಸಲು',
      'ಅರ್ಜಿದಾರ ಪ್ರತ್ಯುತ್ತರ ಸಲ್ಲಿಸಲು',
      'ಸರ್ಕಾರ ಮೂಲ ದಾಖಲೆ ಹಾಜರುಪಡಿಸಲು',
    ],
    task: ['ಕಕ್ಷಿದಾರರಿಗೆ ಕರೆ ಮಾಡಲು', 'ಪ್ರಮಾಣಿತ ಪ್ರತಿ ಪಡೆಯಲು', 'ಜೂನಿಯರ್‌ಗೆ ತಿಳಿಸಲು'],
    taskSentence: (t) => `${t} ನೆನಪಿಸು.`,
    matter: (n, y) => `ಪ್ರಕರಣ ${String(n)}/${String(y)} ಇಂದು.`,
  },
};

interface Fixture {
  id: string;
  language: Lang | 'mixed';
  hearingDate: string;
  text: string;
  expected: {
    nextDate: { date: string; phrase: string };
    directions: { text: string; dueDate: string | null }[];
    tasks: string[];
  };
}

function build(id: string, language: Fixture['language'], lang: Lang, dateLang: Lang): Fixture {
  const hearing = new Date(Date.UTC(2025, 0, 1) + int(0, 540) * 86_400_000);
  const v = VOICES[lang];
  const sentences: string[] = [v.matter(int(100, 99_999), int(2019, 2026)), pick(v.outcome)];
  if (rand() < 0.6) sentences.push(pick(v.reason));
  const next = datePhrase(dateLang, hearing);
  sentences.push(v.next(next.text));
  const directions: Fixture['expected']['directions'] = [];
  for (let i = 0; i < int(1, 2); i += 1) {
    const dated = rand() < 0.6;
    const due = dated ? datePhrase(dateLang, hearing) : null;
    const text = v.direction(pick(v.directionWhat), due?.text ?? null);
    sentences.push(text);
    directions.push({ text, dueDate: due?.date ?? null });
  }
  const tasks: string[] = [];
  if (rand() < 0.5) {
    const t = pick(v.task);
    sentences.push(v.taskSentence(t));
    tasks.push(t);
  }
  return {
    id,
    language,
    hearingDate: iso(hearing),
    text: sentences.join(' '),
    expected: { nextDate: { date: next.date, phrase: next.text }, directions, tasks },
  };
}

for (const language of ['en', 'ta', 'kn', 'mixed'] as const) {
  const dir = join(root, language);
  mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= PER_LANGUAGE; i += 1) {
    const id = `${language}-${pad(i)}`;
    const fixture =
      language === 'mixed'
        ? // Tamil or Kannada speech with English date phrases mixed in.
          build(id, language, pick(['ta', 'kn'] as const), 'en')
        : build(id, language, language, language);
    writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
  }
}
