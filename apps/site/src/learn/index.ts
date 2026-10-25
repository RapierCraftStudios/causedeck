// Practice school (#511, D-049): markdown lessons under `apps/site/content/learn/<slug>/<locale>.md`
// with a small front-matter block. A lesson is live only when a practising advocate's name and the
// review date are filled in; nothing here invents a reviewer.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { LEARN_FIXTURES, type LearnFixtureId } from './fixtures';
import { signupHref } from './signup-link';
import { LEARN_LOCALES, LEARN_SLUGS, type LearnLocale, type LearnSlug } from './slugs';

export type { LearnLocale, LearnSlug };

const CONTENT_DIR = path.resolve(import.meta.dirname, '..', '..', 'content', 'learn');

export interface LearnModule {
  slug: LearnSlug;
  locale: LearnLocale;
  title: string;
  order: number;
  /** Touches law: shown with the scales mark and always needs an advocate's review. */
  law: boolean;
  fixture: LearnFixtureId;
  reviewer: string | null;
  reviewedOn: string | null;
  body: string;
  signupHref: string;
}

export interface ReviewLabel {
  mark: '⚖' | '';
  reviewer: string;
  reviewedOn: string;
}

/** Live means reviewed and dated. */
export function isLive(m: Pick<LearnModule, 'reviewer' | 'reviewedOn'>): boolean {
  return m.reviewer !== null && m.reviewedOn !== null && /^\d{4}-\d{2}-\d{2}$/.test(m.reviewedOn);
}

/** The reviewer and date shown on a live module page; null while the module is a draft. */
export function reviewLabel(m: LearnModule): ReviewLabel | null {
  if (!isLive(m) || m.reviewer === null || m.reviewedOn === null) return null;
  return { mark: m.law ? '⚖' : '', reviewer: m.reviewer, reviewedOn: m.reviewedOn };
}

export function parseModule(source: string): LearnModule {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source);
  if (!match) throw new Error('learn module has no front matter');
  const fields = new Map<string, string>();
  for (const line of (match[1] ?? '').split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) fields.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  const need = (key: string): string => {
    const v = fields.get(key);
    if (v === undefined || v === '') throw new Error(`learn module is missing ${key}`);
    return v;
  };
  const optional = (key: string): string | null => {
    const v = fields.get(key);
    return v === undefined || v === '' ? null : v;
  };
  const slug = need('slug') as LearnSlug;
  const locale = need('locale') as LearnLocale;
  const fixture = need('fixture') as LearnFixtureId;
  if (!LEARN_SLUGS.includes(slug)) throw new Error(`unknown learn module: ${slug}`);
  if (!LEARN_LOCALES.includes(locale)) throw new Error(`unknown learn locale: ${locale}`);
  if (!(fixture in LEARN_FIXTURES)) throw new Error(`unknown learn fixture: ${fixture}`);
  const law = need('law');
  if (law !== 'true' && law !== 'false') throw new Error('learn module law must be true or false');
  return {
    slug,
    locale,
    title: need('title'),
    order: Number(need('order')),
    law: law === 'true',
    fixture,
    reviewer: optional('reviewer'),
    reviewedOn: optional('reviewedOn'),
    body: (match[2] ?? '').trim(),
    signupHref: signupHref(slug),
  };
}

export function loadModule(slug: LearnSlug, locale: LearnLocale, dir = CONTENT_DIR): LearnModule {
  return parseModule(readFileSync(path.join(dir, slug, `${locale}.md`), 'utf8'));
}

export function loadModules(locale: LearnLocale, dir = CONTENT_DIR): LearnModule[] {
  return LEARN_SLUGS.map((slug) => loadModule(slug, locale, dir));
}

/** Modules a visitor can see: reviewed and dated only. */
export function liveModules(locale: LearnLocale, dir = CONTENT_DIR): LearnModule[] {
  return loadModules(locale, dir).filter(isLive);
}
