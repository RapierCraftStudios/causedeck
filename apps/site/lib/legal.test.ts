import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SUBPROCESSORS } from '../content/legal/sub-processors.ts';
import { checkLegalStatus } from '../scripts/legal-status.ts';
import { scanText } from '../scripts/rule36-lint.ts';

import { parseFrontmatter, parseLegalFrontmatter } from './frontmatter.ts';
import {
  draftSlugs,
  extractHeadings,
  isLegalOwned,
  LEGAL_SLUGS,
  loadAllLegalPages,
  loadLegalPage,
  missingFromPublicList,
  renderFeed,
  subprocessorFeedItems,
} from './legal.ts';
import { legalChrome } from './legal-chrome.ts';

const root = path.join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const base = { title: 'T', description: 'D', date: '2026-01-01', version: '1', status: 'draft' };
const history = [{ date: '2026-01-01', summary: 'First draft' }];

describe('legal frontmatter (R7, R13)', () => {
  it('requires status, version and history, and rejects an effective date on a draft', () => {
    expect(parseLegalFrontmatter({ ...base, history }, 'a.mdx').status).toBe('draft');
    expect(() => parseLegalFrontmatter({ ...base }, 'a.mdx')).toThrow(/history/);
    expect(() => parseLegalFrontmatter({ ...base, history: [] }, 'a.mdx')).toThrow();
    expect(() =>
      parseLegalFrontmatter({ ...base, history, effectiveDate: '2026-02-01' }, 'a.mdx'),
    ).toThrow(/effectiveDate/);
  });
  it('requires an effective date on a final page', () => {
    expect(() => parseLegalFrontmatter({ ...base, history, status: 'final' }, 'a.mdx')).toThrow(
      /effectiveDate/,
    );
    expect(
      parseLegalFrontmatter(
        { ...base, history, status: 'final', effectiveDate: '2026-02-01' },
        'a.mdx',
      ).effectiveDate,
    ).toBe('2026-02-01');
  });
  it('still accepts plain pages and rejects unknown keys', () => {
    expect(
      parseFrontmatter({ title: 'T', description: 'D', date: '2026-01-01' }, 'a.mdx').noindex,
    ).toBe(false);
    expect(() => parseFrontmatter({ ...base, history, extra: 1 }, 'a.mdx')).toThrow();
  });
});

describe('legal pages (R1, R2, R7, R13)', () => {
  it('loads all five pages as noindex drafts with version history and no effective date', async () => {
    const pages = await loadAllLegalPages();
    expect(pages.map((page) => page.slug[1])).toEqual([...LEGAL_SLUGS]);
    for (const page of pages) {
      expect(page.legal.status).toBe('draft');
      expect(page.noindex).toBe(true);
      expect(page.legal.effectiveDate).toBeUndefined();
      expect(page.legal.history.length).toBeGreaterThan(0);
      expect(page.legal.version).toBeTruthy();
    }
  });
  it('flags drafts for the production gate', async () => {
    const pages = await loadAllLegalPages();
    expect(draftSlugs(pages)).toHaveLength(6);
    expect(draftSlugs([{ slug: ['legal', 'terms'], legal: { status: 'final' } }])).toEqual([]);
  });
  it('fails the gate on drafts unless ALLOW_DRAFT_LEGAL=1 (R2)', () => {
    expect(checkLegalStatus(['legal/terms'], undefined).ok).toBe(false);
    expect(checkLegalStatus(['legal/terms'], '0').ok).toBe(false);
    expect(checkLegalStatus(['legal/terms'], '1').ok).toBe(true);
    expect(checkLegalStatus([], undefined).ok).toBe(true);
  });
  it('owns the legal slugs so the catch-all route skips them', () => {
    expect(isLegalOwned(['legal', 'terms'])).toBe(true);
    expect(isLegalOwned(['legal', 'draft-notice'])).toBe(false);
    expect(isLegalOwned(['about'])).toBe(false);
  });
  it('extracts the table of contents from level-2 headings', () => {
    expect(extractHeadings('# T\n\n## One Two\ntext\n### Skip\n## Three')).toEqual([
      { id: 'one-two', text: 'One Two' },
      { id: 'three', text: 'Three' },
    ]);
  });
  it('keeps every body to placeholders: each section has a counsel marker', () => {
    for (const slug of ['terms', 'privacy', 'dpa'] as const) {
      expect(read(`content/legal/${slug}.mdx`)).toContain('TODO(counsel)');
    }
  });
});

describe('sub-processor list (R3, R4)', () => {
  it('has the required services with purpose, data categories, region and date', () => {
    const ids = SUBPROCESSORS.map((row) => row.id);
    for (const id of [
      'hosting-vps',
      'cloudflare',
      'aws-ses',
      'aws-bedrock',
      'sarvam',
      'indian-kanoon',
      'razorpay',
      'sentry',
    ]) {
      expect(ids).toContain(id);
    }
    for (const row of SUBPROCESSORS) {
      expect(row.purpose).toBeTruthy();
      expect(row.dataCategories.length).toBeGreaterThan(0);
      expect(row.region).toBeTruthy();
      expect(row.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(SUBPROCESSORS.find((row) => row.id === 'aws-ses')?.region).toContain('ap-south-1');
  });
  it('lists every service in infra/sub-processors.json', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(root, '../../infra/sub-processors.json'), 'utf8'),
    ) as { services: { id: string }[] };
    expect(missingFromPublicList(manifest, SUBPROCESSORS)).toEqual([]);
  });
  it('reports a manifest service missing from the public list', () => {
    const manifest = { services: [{ id: 'cloudflare' }, { id: 'new-vendor' }] };
    expect(missingFromPublicList(manifest, SUBPROCESSORS)).toEqual(['new-vendor']);
  });
});

describe('change feed (R7)', () => {
  it('lists sub-processor changes and history newest first as valid-looking RSS', async () => {
    const page = await loadLegalPage('sub-processors');
    const items = subprocessorFeedItems(
      [...page.legal.history, { date: '2027-01-02', summary: 'Added <Vendor> & co' }],
      'https://x.test',
    );
    expect(items[0]?.date).toBe('2027-01-02');
    const xml = renderFeed(items, 'https://x.test');
    expect(xml).toContain('<rss version="2.0">');
    expect(xml).toContain('https://x.test/legal/sub-processors/');
    expect(xml).toContain('Added &lt;Vendor&gt; &amp; co');
    expect(xml).toContain('Sub-processor effective: Razorpay');
  });
});

describe('required statements (R5, R6, R8, R12)', () => {
  it('states the positioning on Terms and About', () => {
    expect(read('content/legal/terms.mdx')).toContain('software for advocates, not legal services');
    expect(read('content/about.mdx')).toContain('software for advocates, not legal services');
    expect(read('content/legal/terms.mdx')).toMatch(/no lawyer-client relationship or privilege/);
  });
  it('states the AI disclosure points plainly', () => {
    const text = read('content/legal/ai-disclosure.mdx');
    expect(text).toMatch(/India-only mode is on by default/);
    expect(text).toMatch(/AI proposes and the lawyer confirms/);
    expect(text).toMatch(/outputs may be wrong/);
    expect(text).toMatch(/not used to train/);
    expect(text).toMatch(/Citations are never generated/);
    expect(text).toMatch(/Bedrock/);
    expect(text).toMatch(/Sarvam/);
  });
  it('gives the DPA roles as placeholders and links to the list and security page', () => {
    const text = read('content/legal/dpa.mdx');
    expect(text).toMatch(/Data Fiduciary: the advocate or chamber/);
    expect(text).toMatch(/Data Processor: CauseDeck/);
    expect(text).toContain('(/legal/sub-processors/)');
    expect(text).toContain('(/security/)');
    expect(read('content/legal/privacy.mdx')).toMatch(/Data Fiduciary[\s\S]*Data Processor/);
  });
  it('passes the Rule 36 lint', () => {
    for (const slug of LEGAL_SLUGS) {
      expect(scanText(`${slug}.mdx`, read(`content/legal/${slug}.mdx`))).toEqual([]);
    }
    expect(scanText('sub-processors.ts', read('content/legal/sub-processors.ts'))).toEqual([]);
  });
});

describe('chrome strings (R11)', () => {
  it('falls back to English for the ta and kn stubs', () => {
    const en = legalChrome('en');
    expect(en.draftBanner).toBe('Draft pending counsel review');
    expect(legalChrome('ta')).toEqual(en);
    expect(legalChrome('kn')).toEqual(en);
    expect(en.languageNote).toMatch(/English only/);
  });
});
