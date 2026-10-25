import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { LEARN_FIXTURES } from './fixtures';
import { isLive, liveModules, loadModule, loadModules, parseModule, reviewLabel } from './index';
import { signupHref } from './signup-link';
import { LEARN_LOCALES, LEARN_SLUGS } from './slugs';

const DISCLAIMER_WORD: Record<string, string> = {
  en: 'not legal advice',
  ta: 'சட்ட ஆலோசனை அல்ல',
  kn: 'ಕಾನೂನು ಸಲಹೆಯಲ್ಲ',
};
const LAW: Record<string, boolean> = {
  'court-day-practice': false,
  'reading-cause-lists': false,
  'listings-and-mentions': true,
  'filing-and-defect-cures': true,
  'limitation-basics': true,
  'using-the-os': false,
};

describe('learn modules', () => {
  it('ships six modules in each of en, ta and kn with the front matter and disclaimer', () => {
    expect(LEARN_SLUGS).toHaveLength(6);
    for (const locale of LEARN_LOCALES) {
      const modules = loadModules(locale);
      expect(modules.map((m) => m.order)).toEqual([1, 2, 3, 4, 5, 6]);
      for (const m of modules) {
        expect(m.locale).toBe(locale);
        expect(m.title.length).toBeGreaterThan(0);
        expect(m.law).toBe(LAW[m.slug]);
        expect(m.body).toContain(DISCLAIMER_WORD[locale]);
      }
    }
  });

  it('keeps a module not live until a reviewer and a date are present', () => {
    for (const locale of LEARN_LOCALES) {
      for (const m of loadModules(locale)) {
        // A module is live only once reviewed; the committed drafts carry no invented reviewer.
        expect(isLive(m)).toBe(m.reviewer !== null && m.reviewedOn !== null);
        expect(reviewLabel(m)).toBe(null);
      }
      expect(liveModules(locale)).toEqual([]);
    }
    const reviewed = loadModule('limitation-basics', 'en');
    expect(isLive({ ...reviewed, reviewer: 'Adv. Example', reviewedOn: '2031-02-01' })).toBe(true);
    expect(isLive({ ...reviewed, reviewer: 'Adv. Example', reviewedOn: null })).toBe(false);
    expect(isLive({ ...reviewed, reviewer: null, reviewedOn: '2031-02-01' })).toBe(false);
    expect(
      reviewLabel({ ...reviewed, reviewer: 'Adv. Example', reviewedOn: '2031-02-01' }),
    ).toEqual({ mark: '⚖', reviewer: 'Adv. Example', reviewedOn: '2031-02-01' });
  });

  it('rejects a module with a bad slug, locale, fixture or flag', () => {
    const good = readFileSync(
      path.resolve(import.meta.dirname, '../../content/learn/using-the-os/en.md'),
      'utf8',
    );
    expect(() => parseModule(good.replace('slug: using-the-os', 'slug: nope'))).toThrow(/unknown/);
    expect(() => parseModule(good.replace('locale: en', 'locale: hi'))).toThrow(/locale/);
    expect(() => parseModule(good.replace('fixture: cause-list-sample', 'fixture: real'))).toThrow(
      /fixture/,
    );
    expect(() => parseModule(good.replace('law: false', 'law: maybe'))).toThrow(/law/);
    expect(() => parseModule('no front matter')).toThrow(/front matter/);
  });
});

describe('learn examples use only fictional fixtures', () => {
  it('marks every fixture fictional and keeps real-data patterns out', () => {
    const text = JSON.stringify(LEARN_FIXTURES);
    for (const f of Object.values(LEARN_FIXTURES)) expect(f.fictional).toBe(true);
    expect(text).not.toMatch(/[A-Z]{4}\d{12}/); // a CNR
    expect(text).not.toMatch(/\d{10}/); // a phone number
    expect(text).not.toMatch(/@/); // an email
    expect(text).not.toMatch(/[A-Z]{2}\/\d{3,5}\/\d{4}/); // an enrolment number
    expect(text).toContain('fictional');
    for (const date of text.match(/\d{4}-\d{2}-\d{2}/g) ?? [])
      expect(date >= '2031-01-01').toBe(true);
  });

  it('points every module at an existing fixture and leaves real identifiers out of the lessons', () => {
    for (const locale of LEARN_LOCALES) {
      for (const m of loadModules(locale)) {
        expect(LEARN_FIXTURES[m.fixture].fictional).toBe(true);
        expect(m.body).not.toMatch(/[A-Z]{4}\d{12}|\d{10}|@/);
      }
    }
  });
});

describe('learn signup prompts', () => {
  it('links every module to the education signup with its slug only', () => {
    for (const locale of LEARN_LOCALES) {
      for (const m of loadModules(locale)) {
        expect(m.signupHref).toBe(`/sign-in?channel=education&module=${m.slug}`);
        expect(m.signupHref).toBe(signupHref(m.slug));
      }
    }
    expect(() => signupHref('x' as never)).toThrow(/unknown/);
  });
});
