import { describe, expect, it } from 'vitest';

import {
  findSpokenDates,
  knOrdinal,
  parseSpokenDate,
  SPOKEN_DATE_VOCABULARY,
  taOrdinal,
} from './spoken-dates.ts';

const H = '2026-10-23'; // a Friday

describe('English', () => {
  it.each([
    ['fourteenth of November', '2026-11-14'],
    ['on the fourteenth of November', '2026-11-14'],
    ['on 14th November', '2026-11-14'],
    ['on November 14th', '2026-11-14'],
    ['14/11', '2026-11-14'],
    ['14/11/2027', '2027-11-14'],
    ['14th November', '2026-11-14'],
    ['November 14th', '2026-11-14'],
    ['twenty first of December 2026', '2026-12-21'],
    ['on the 14th', '2026-11-14'],
    ['on the 25th', '2026-10-25'],
    ['after two weeks', '2026-11-06'],
    ['in 3 days', '2026-10-26'],
    ['after two months', '2026-12-23'],
    ['next Tuesday', '2026-10-27'],
    ['next Friday', '2026-10-30'],
  ])('reads %s as %s', (phrase, date) => {
    expect(parseSpokenDate(phrase, H)).toBe(date);
  });

  it('takes the first such date after the hearing when the year is missing', () => {
    expect(parseSpokenDate('10/10', H)).toBe('2027-10-10');
    expect(parseSpokenDate('23/10', H)).toBe('2027-10-23');
    expect(parseSpokenDate('29th February', '2027-03-01')).toBe('2028-02-29');
  });

  it('refuses impossible dates and partial phrases', () => {
    expect(parseSpokenDate('31st November', H)).toBeNull();
    expect(parseSpokenDate('30/2', H)).toBeNull();
    expect(parseSpokenDate('14/11 sharp', H)).toBeNull();
    expect(parseSpokenDate('next Tuesday', 'not-a-date')).toBeNull();
  });

  it('clamps month arithmetic to the last day of the month', () => {
    expect(parseSpokenDate('after one months', '2026-01-31')).toBe('2026-02-28');
  });
});

describe('Tamil and Kannada', () => {
  it.each([
    ['நவம்பர் பதினான்காம் தேதி', '2026-11-14'],
    ['பதினான்காம் தேதி', '2026-11-14'],
    ['நவம்பர் 14ஆம் தேதி', '2026-11-14'],
    ['இரண்டு வாரங்கள் கழித்து', '2026-11-06'],
    ['அடுத்த செவ்வாய்க்கிழமை', '2026-10-27'],
    ['ನವೆಂಬರ್ ಹದಿನಾಲ್ಕನೇ ತಾರೀಖು', '2026-11-14'],
    ['ಹದಿನಾಲ್ಕನೇ ತಾರೀಖು', '2026-11-14'],
    ['ಎರಡು ವಾರಗಳ ನಂತರ', '2026-11-06'],
    ['ಮುಂದಿನ ಮಂಗಳವಾರ', '2026-10-27'],
  ])('reads %s as %s', (phrase, date) => {
    expect(parseSpokenDate(phrase, H)).toBe(date);
  });

  it('derives ordinals from cardinals', () => {
    expect(taOrdinal('நான்கு')).toBe('நான்காம்');
    expect(knOrdinal('ಹದಿನಾಲ್ಕು')).toBe('ಹದಿನಾಲ್ಕನೇ');
  });

  it('finds dates inside code-switched speech with the right span', () => {
    const text = 'அடுத்த hearing fourteenth of November, counter ஒன்று வாரம் கழித்து';
    const [found] = findSpokenDates(text, H);
    expect(found?.date).toBe('2026-11-14');
    expect(text.slice(found?.span.start, found?.span.end)).toBe('fourteenth of November');
  });
});

// Property tests: 500 generated phrases per language. Expected dates come from plain calendar
// arithmetic here, not from the parser.
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pad = (n: number): string => String(n).padStart(2, '0');
const iso = (t: Date): string =>
  `${String(t.getUTCFullYear())}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;

const V = SPOKEN_DATE_VOCABULARY;
type Lang = 'en' | 'ta' | 'kn';

describe.each(['en', 'ta', 'kn'] as const)('property: %s phrases', (lang: Lang) => {
  const rand = rng(lang.charCodeAt(0) * 1000 + lang.charCodeAt(1));
  const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
  const month = (m: number): string => {
    const name = V[lang].months[m] as string | readonly string[];
    return typeof name === 'string' ? name : (name[0] as string);
  };

  function generate(): { phrase: string; date: string; hearing: string } {
    const start = new Date(Date.UTC(2024, 0, 1) + int(0, 1500) * 86_400_000);
    const hearing = iso(start);
    const at = (days: number): Date => new Date(start.getTime() + days * 86_400_000);
    const kind = int(0, 3);
    if (kind === 0) {
      const target = at(int(1, 300));
      const d = target.getUTCDate();
      const m = target.getUTCMonth();
      const card = V[lang].cardinals[d - 1] as string;
      const forms = {
        en: `${V.en.ordinals[d - 1] as string} of ${month(m)}`,
        ta: `${month(m)} ${taOrdinal(card)} தேதி`,
        kn: `${month(m)} ${knOrdinal(card)} ತಾರೀಖು`,
      };
      return { phrase: forms[lang], date: iso(target), hearing };
    }
    if (kind === 1) {
      const target = at(int(1, 300));
      return {
        phrase: `${String(target.getUTCDate())}/${String(target.getUTCMonth() + 1)}`,
        date: iso(target),
        hearing,
      };
    }
    if (kind === 2) {
      const n = int(2, 20);
      const word = V[lang].cardinals[n - 1] as string;
      const forms = {
        en: `after ${word} weeks`,
        ta: `${word} வாரங்கள் கழித்து`,
        kn: `${word} ವಾರಗಳ ನಂತರ`,
      };
      return { phrase: forms[lang], date: iso(at(7 * n)), hearing };
    }
    const weekday = int(0, 6);
    const delta = (weekday - start.getUTCDay() + 7) % 7 || 7;
    const name = V[lang].weekdays[weekday] as string;
    const forms = { en: `next ${name}`, ta: `அடுத்த ${name}`, kn: `ಮುಂದಿನ ${name}` };
    return { phrase: forms[lang], date: iso(at(delta)), hearing };
  }

  it('reads 500 generated phrases to the date they state, with an exact span', () => {
    for (let i = 0; i < 500; i += 1) {
      const { phrase, date, hearing } = generate();
      expect(parseSpokenDate(phrase, hearing), `${phrase} @ ${hearing}`).toBe(date);
      const text = `Case noted. ${phrase}, order passed.`;
      const found = findSpokenDates(text, hearing);
      expect(found, text).toHaveLength(1);
      expect(text.slice(found[0]?.span.start, found[0]?.span.end)).toBe(found[0]?.phrase);
      expect(found[0]?.date).toBe(date);
    }
  });

  it('never returns a date the text does not state (zero hallucinated dates)', () => {
    const noise = [
      'Case 12345 of 2026 listed before the bench.',
      'The matter stands adjourned sine die.',
      'Counsel for the first respondent was absent.',
      'வழக்கு 3091/2022 ஒத்திவைக்கப்பட்டது.',
      'ಪ್ರಕರಣ ಮುಂದೂಡಲಾಯಿತು, ಆದೇಶ ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ.',
      'Fee of 14 rupees, item 3 and page 25.',
    ];
    for (let i = 0; i < 500; i += 1) {
      const sentence = noise[i % noise.length] as string;
      expect(findSpokenDates(sentence, '2026-10-23'), sentence).toEqual([]);
    }
    for (let i = 0; i < 500; i += 1) {
      const { phrase, hearing } = generate();
      const text = `${noise[i % noise.length] as string} ${phrase}`;
      for (const found of findSpokenDates(text, hearing)) {
        expect(text.slice(found.span.start, found.span.end)).toBe(found.phrase);
      }
    }
  });
});
