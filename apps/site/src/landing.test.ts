import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LANDING,
  POSITIONING_LINE,
  SAMPLE_BOARD,
  SAMPLE_LABEL,
  landingCopy,
} from '../content/landing.ts';
import { contactEmail, signInHref } from '../lib/landing.ts';
import { readSiteEnv } from '../lib/env.ts';
import { softwareApplicationJsonLd } from '../lib/seo.ts';
import { scanText } from '../scripts/rule36-lint.ts';

const root = path.join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

const landingFiles = [
  'content/landing.ts',
  'app/page.tsx',
  'app/contact/page.tsx',
  ...readdirSync(path.join(root, 'components/landing')).map((f) => `components/landing/${f}`),
];

/** Every string in the English copy, flattened. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(strings);
  return [];
}

describe('hero (R3)', () => {
  const { hero } = landingCopy();
  it('keeps the positioning and never self-describes as legal services', () => {
    expect(hero.headline).toBe('Walk into court prepared.');
    expect(hero.subhead).toContain('software for advocates');
    expect(hero.subhead).not.toMatch(/legal services/i);
    expect(hero.primaryCta).toBe('Start free');
    expect(hero.secondaryCta).toBe('See how a court day runs');
  });
});

describe('Rule 36 (R4)', () => {
  it.each(landingFiles)('%s has no denylisted copy or forbidden component names', (file) => {
    expect(scanText(file, read(file))).toEqual([]);
  });
  it('has no language addressed to litigants or outcome claims', () => {
    const text = strings(landingCopy()).join('\n');
    expect(text).not.toMatch(/\b(litigants?|win|wins|won|success stories|rated|ratings?)\b/i);
    expect(text).not.toMatch(/!/);
    expect(text).not.toMatch(/\bAI-powered|revolutioni[sz]e|trusted by\b/i);
  });
});

describe('positioning line (R5)', () => {
  it('is the exact required sentence and sits in the footer', () => {
    expect(POSITIONING_LINE).toBe(
      'CauseDeck is software for advocates. It does not provide legal services or legal advice, and it does not advertise or recommend any lawyer.',
    );
    expect(read('components/site-footer.tsx')).toContain('{POSITIONING_LINE}');
  });
});

describe('automation claims (R8)', () => {
  it('says prepares and proposes, never files, sends or handles for you', () => {
    const text = strings(landingCopy()).join('\n');
    expect(text).toMatch(/\bprepares\b/);
    expect(text).toMatch(/\bproposes?\b/);
    expect(text).not.toMatch(/\b(files|sends|submits)\b/i);
    expect(text).not.toMatch(/handles?\b[^.]*\bfor you/i);
    // The only mentions of acting are the advocate's own: "you send and you file".
    expect(text).toMatch(/You confirm, you send and you file/);
  });
});

describe('trust section (R7)', () => {
  it('lists five claims, each linking into the security page', () => {
    const { claims } = landingCopy().trust;
    expect(claims.map((c) => c.id)).toEqual(['india', 'ai', 'control', 'training', 'sources']);
    for (const claim of claims) expect(claim.href).toMatch(/^\/security\/#[a-z-]+$/);
  });
});

describe('sample data (R6)', () => {
  it('labels visuals and uses both courts', () => {
    expect(SAMPLE_LABEL).toBe('Illustrative, sample data');
    expect(SAMPLE_BOARD.map((c) => c.court)).toEqual([
      'Madras High Court',
      'High Court of Karnataka',
    ]);
    expect(read('components/landing/court-day-preview.tsx')).toContain('SAMPLE_LABEL');
  });
});

describe('primary CTA (R9)', () => {
  it('points at the app sign-in, or /contact/ when the app URL is not configured', () => {
    expect(signInHref('https://app.example.in', true)).toBe('https://app.example.in/sign-in');
    expect(signInHref('https://app.example.in', false)).toBe('/contact/');
    expect(readSiteEnv({}).appUrlConfigured).toBe(false);
    expect(readSiteEnv({ NEXT_PUBLIC_APP_URL: '' }).appUrlConfigured).toBe(false);
    expect(readSiteEnv({ NEXT_PUBLIC_APP_URL: 'https://app.x.test' }).appUrlConfigured).toBe(true);
  });
  it('collects nothing: no form, input or newsletter in the page sources', () => {
    for (const file of landingFiles) {
      expect(read(file)).not.toMatch(/<form|<input|<textarea|newsletter|subscribe/i);
    }
    expect(contactEmail('https://causedeck.example')).toBe('hello@causedeck.example');
  });
});

describe('locales (R13)', () => {
  it('has complete English and ta/kn stubs that fall back to it', () => {
    expect(Object.keys(LANDING).sort()).toEqual(['en', 'kn', 'ta']);
    expect(landingCopy('ta')).toEqual(landingCopy('en'));
    expect(landingCopy('kn').hero.headline).toBe('Walk into court prepared.');
  });
  it('puts the Noto Tamil and Kannada faces in the font stacks', () => {
    const css = read('app/globals.css');
    expect(css).toContain('var(--font-tamil)');
    expect(css).toContain('var(--font-kannada)');
  });
});

describe('metadata and structured data (R14)', () => {
  it('is a SoftwareApplication, never a LegalService, with page metadata', () => {
    expect(softwareApplicationJsonLd()['@type']).toBe('SoftwareApplication');
    const page = read('app/page.tsx');
    expect(page).toContain('pageMetadata(');
    expect(page).toContain('softwareApplicationJsonLd()');
    expect(page).not.toMatch(/LegalService|Attorney|AggregateRating|Review/);
    expect(read('app/opengraph-image.tsx')).toContain('ImageResponse');
  });
});
