// Pricing, security, about and changelog (#91): amounts, Rule 36 copy, claims, metadata, sitemap.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import PricingPage, { metadata as pricingMeta } from '../app/pricing/page.tsx';
import SecurityPage, { metadata as securityMeta } from '../app/security/page.tsx';
import sitemap from '../app/sitemap.ts';
import AboutPage, { generateMetadata as aboutMeta } from '../app/about/page.tsx';
import ChangelogPage, { metadata as changelogMeta } from '../app/changelog/page.tsx';
import {
  GST_RATE_PERCENT,
  PLAN_PRICES,
  PRICING_COPY,
  pricingCopy,
  UPI_AUTOPAY_CAP_PAISE,
} from '../content/pricing.ts';
import { SECURITY_COPY, SECURITY_SECTIONS } from '../content/security.ts';
import { buildChangelogRss, loadChangelog, scanChangelog, sortEntries } from '../lib/changelog.ts';
import { formatInr } from '../lib/inr.ts';
import { loadAllLegalPages } from '../lib/legal.ts';
import { isPageOwned } from '../lib/pages.ts';
import {
  pricingJsonLd,
  planSignInHref,
  annualSavingPaise,
  chamberExamplePaise,
} from '../lib/pricing.ts';
import { scanSite, scanText } from '../scripts/rule36-lint.ts';

const root = path.join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('formatInr', () => {
  it('uses Indian grouping and drops zero paise', () => {
    expect(formatInr(0)).toBe('₹0');
    expect(formatInr(49_900)).toBe('₹499');
    expect(formatInr(119_900)).toBe('₹1,199');
    expect(formatInr(1_500_000)).toBe('₹15,000');
    expect(formatInr(1_234_567_800)).toBe('₹1,23,45,678');
    expect(formatInr(19_950)).toBe('₹199.50');
  });
  it('rejects fractional or negative paise', () => {
    expect(() => formatInr(1.5)).toThrow(RangeError);
    expect(() => formatInr(-1)).toThrow(RangeError);
  });
});

describe('pricing data follows the billing catalogue', () => {
  // The site does not depend on @causedeck/validators, so the constants are read from its source.
  const plans = readFileSync(path.join(root, '../../packages/validators/src/plans.ts'), 'utf8');
  const list = (name: string) =>
    [
      ...(new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]+)\\]`).exec(plans)?.[1] ?? '').matchAll(
        /[\d_]+/g,
      ),
    ].map((m) => Number(m[0].replaceAll('_', '')));
  const constant = (name: string) =>
    Number((new RegExp(`${name}\\s*=\\s*([\\d_]+)`).exec(plans)?.[1] ?? 'NaN').replaceAll('_', ''));
  const price = (id: string) => PLAN_PRICES.find((p) => p.id === id);

  it('matches the first price band of each plan', () => {
    expect(price('junior')?.monthlyPaise).toBe(0);
    expect(price('advocate')?.monthlyPaise).toBe(list('ADVOCATE_TIERS')[0]);
    expect(price('advocate')?.annualPaise).toBe(
      (list('ADVOCATE_TIERS')[0] ?? 0) * constant('ANNUAL_MONTHS'),
    );
    expect(price('chamber')?.monthlyPaise).toBe(list('CHAMBER_SEAT_BANDS')[0]);
    expect(price('chamber')?.clerkSeatPaise).toBe(constant('CLERK_SEAT_PRICE_PAISE'));
    expect(price('chamber')?.minSeats).toBe(constant('MIN_CHAMBER_SEATS'));
    expect(UPI_AUTOPAY_CAP_PAISE).toBe(constant('UPI_AUTOPAY_MANDATE_CAP_PAISE'));
    expect(GST_RATE_PERCENT * 100).toBe(constant('GST_RATE_BPS'));
    expect(price('junior')?.maxActiveMatters).toBe(15);
    expect(plans).toContain("id: 'junior'");
    expect(plans).toContain('maxActiveMatters: 15');
  });
  it('derives the saving and the chamber example', () => {
    expect(annualSavingPaise('advocate')).toBe(99_800);
    expect(chamberExamplePaise(3)).toBe(3 * 49_900 + 19_900);
  });
});

describe('pricing page', () => {
  const html = renderToStaticMarkup(<PricingPage />);
  const body = text(html);
  it('shows the three plans in rupees with a GST note, clerk seat and UPI Autopay', () => {
    for (const name of ['Junior', 'Advocate', 'Chamber']) expect(body).toContain(name);
    expect(body).toContain('₹499');
    expect(body).toContain('₹4,990');
    expect(body).toContain('₹199');
    expect(body).toContain('18% GST');
    expect(body).toContain('Clerk seat');
    expect(body).toContain('UPI Autopay');
    expect(body).toContain('not final');
  });
  it('only renders amounts that come from pricing.ts', () => {
    const allowed = new Set<string>(
      [
        ...PLAN_PRICES.flatMap((p) => [p.monthlyPaise, p.annualPaise, p.clerkSeatPaise]).filter(
          (v): v is number => v !== null && v > 0,
        ),
        UPI_AUTOPAY_CAP_PAISE,
        annualSavingPaise('advocate'),
        chamberExamplePaise(3),
      ].map((paise) => formatInr(paise)),
    );
    for (const match of body.matchAll(/₹[\d,]+(?:\.\d{2})?/g)) expect(allowed).toContain(match[0]);
  });
  it('links each plan to sign-in with a plan parameter and takes no payment', () => {
    for (const plan of ['junior', 'advocate', 'chamber'] as const) {
      expect(html).toContain(`href="${planSignInHref(plan)}"`);
      expect(planSignInHref(plan, 'https://app.x.test')).toBe(
        `https://app.x.test/sign-in?plan=${plan}`,
      );
    }
    expect(html).not.toMatch(/<form|<input[^>]*type="(text|tel|email|card)"/);
  });
  it('has no per-case, success-based, referral or fee-share element', () => {
    const everything = JSON.stringify(PRICING_COPY);
    expect(everything).not.toMatch(
      /per[- ]case|success|referral|commission|revenue[- ]share|fee[- ]share|legal fees?|percentage of/i,
    );
  });
  it('has a toggle without client JavaScript and a scoped comparison table', () => {
    expect(html).toContain('type="radio"');
    expect(html).not.toContain('<script src');
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
  });
  it('emits SoftwareApplication JSON-LD with INR offers', () => {
    const ld = pricingJsonLd('https://x.test');
    expect(ld['@type']).toBe('SoftwareApplication');
    const offers = ld.offers as { priceCurrency: string; price: string }[];
    expect(offers.map((o) => o.price)).toEqual(['0.00', '499.00', '499.00']);
    expect(offers.every((o) => o.priceCurrency === 'INR')).toBe(true);
    expect(html).toContain('application/ld+json');
  });
  it('keeps ta and kn as stubs that fall back to English', () => {
    expect(PRICING_COPY.ta).toEqual({});
    expect(pricingCopy('kn').title).toBe(pricingCopy('en').title);
  });
});

describe('security page', () => {
  it('has every section anchor the landing page links to', async () => {
    const html = renderToStaticMarkup(await SecurityPage());
    for (const id of [
      'data-in-india',
      'ai-processing',
      'you-stay-in-control',
      'no-training',
      'sources',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    for (const section of SECURITY_SECTIONS) expect(html).toContain(`id="${section.id}"`);
    expect(html).toContain('aria-label="On this page"');
  });
  it('states the compliance posture and claims no certification', async () => {
    const body = text(renderToStaticMarkup(await SecurityPage()));
    expect(body).toMatch(/six hours/);
    expect(body).toContain('180 days');
    expect(body).toContain('India-only');
    expect(body).toContain('does not train models');
    expect(body).toContain('We do not claim any security certification');
    expect(body.replace('We do not claim any security certification today', '')).not.toMatch(
      /\bISO\b|SOC ?2|certified|compliant with/i,
    );
  });
  it('lists the nine controls, each with proof, and a text alternative for the diagram', async () => {
    expect(SECURITY_COPY.en.controls).toHaveLength(9);
    for (const control of SECURITY_COPY.en.controls)
      expect(control.proof.label.length).toBeGreaterThan(0);
    const html = renderToStaticMarkup(await SecurityPage());
    expect(html).toContain('<title id="flow-title">');
    expect(html).toContain('<desc id="flow-desc">');
    expect(html).not.toMatch(/animation|@keyframes/);
  });
  it('lists each section in the table of contents in the order of the page', () => {
    const source = read('content/security.mdx');
    const ids = [...source.matchAll(/<Section id="([^"]+)"/g)].map((m) => m[1]);
    // The controls table sits in the last section.
    expect(ids).toEqual(SECURITY_SECTIONS.map((s) => s.id));
  });
});

describe('about page', () => {
  it('states the positioning and the permanent exclusions', async () => {
    const body = text(renderToStaticMarkup(await AboutPage()));
    expect(body).toContain('software for advocates');
    expect(body).toContain('Not a legal service');
    for (const exclusion of [
      'No directory of lawyers',
      'No ratings or rankings',
      'No lead generation',
      'No generated citations',
      'No judge analytics',
    ]) {
      expect(body).toContain(exclusion);
    }
  });
});

describe('changelog', () => {
  it('loads entries newest first with a version and a date', async () => {
    const entries = await loadChangelog();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.map((e) => e.date)).toEqual([...entries.map((e) => e.date)].sort().reverse());
    const html = renderToStaticMarkup(await ChangelogPage());
    expect(html).toContain('Version 0.1.0');
    expect(html).toContain('feed.xml');
  });
  it('sorts by date, then by version', () => {
    const sorted = sortEntries([
      { date: '2026-01-01', version: '0.2.0' },
      { date: '2026-02-01', version: '0.10.0' },
      { date: '2026-02-01', version: '0.9.0' },
    ]);
    expect(sorted.map((e) => e.version)).toEqual(['0.10.0', '0.9.0', '0.2.0']);
  });
  it.each([
    'Fixed a bug for a customer in Chennai.',
    'Imported W.P. 17976 of 2019 correctly.',
    'Fixed the view of Raman v. State.',
    'Mail ops@firm.example for help.',
    'Call 9876543210.',
    'Improved the outcome field.',
  ])('fails an entry that mentions customer or case details: %s', (line) => {
    expect(scanChangelog('x.mdx', `---\ntitle: t\n---\n\n- ${line}`)).not.toHaveLength(0);
  });
  it('passes the shipped entries and the front matter is not scanned', async () => {
    expect(scanChangelog('x.mdx', '---\ntitle: client\n---\n\n- Added a board.')).toEqual([]);
    await expect(loadChangelog()).resolves.toBeDefined();
  });
  it('builds an RSS feed', () => {
    const rss = buildChangelogRss(
      [{ version: '1.0.0', date: '2026-01-02', title: 'A & B', description: 'd' }],
      'https://x.test/changelog/',
    );
    expect(rss).toContain('<rss version="2.0">');
    expect(rss).toContain('A &amp; B');
    expect(rss).toContain('https://x.test/changelog/#v1.0.0');
  });
});

describe('metadata, sitemap and rule 36', () => {
  it('gives each page unique metadata with a canonical URL', async () => {
    const metas = [pricingMeta, securityMeta, changelogMeta, await aboutMeta()];
    const titles = metas.map((m) => (typeof m.title === 'string' ? m.title : ''));
    expect(new Set(titles).size).toBe(4);
    expect(new Set(metas.map((m) => m.description)).size).toBe(4);
    expect(metas.map((m) => m.alternates?.canonical)).toEqual([
      expect.stringMatching(/\/pricing\/$/),
      expect.stringMatching(/\/security\/$/),
      expect.stringMatching(/\/changelog\/$/),
      expect.stringMatching(/\/about\/$/),
    ]);
  });
  it('lists the four pages in the sitemap once each', async () => {
    const urls = (await sitemap()).map((entry) => entry.url);
    for (const page of ['pricing', 'security', 'about', 'changelog']) {
      expect(urls.filter((url) => url.endsWith(`/${page}/`))).toHaveLength(1);
    }
    expect(urls.some((url) => url.includes('/changelog/0-1-0'))).toBe(false);
  });
  it('lists the open-data attribution on the Data sources and licences page and in the API terms (#890)', async () => {
    const attribution =
      'Dattam Labs, Indian Supreme Court and High Court Judgments, AWS Open Data, CC-BY-4.0';
    expect(read('content/legal/data-sources.mdx')).toContain(attribution);
    expect(read('content/developers/api.md')).toContain(attribution);
    // A draft legal page stays out of the sitemap with the rest; it is on the legal index.
    const slugs = (await loadAllLegalPages()).map((page) => page.slug[1]);
    expect(slugs).toContain('data-sources');
  });
  it('leaves the owned slugs to their own routes', () => {
    expect(isPageOwned(['security'])).toBe(true);
    expect(isPageOwned(['changelog', '0-1-0'])).toBe(true);
    expect(isPageOwned(['legal', 'terms'])).toBe(false);
  });
  it('passes the Rule 36 lint across the whole site, including the new pages', () => {
    expect(scanSite(root)).toEqual([]);
  });
  it('flags a bad phrase on the new pages (the lint reaches them)', () => {
    expect(scanText('app/pricing/page.tsx', 'See our testimonials')).not.toHaveLength(0);
  });
  it('links the new pages from the header and footer', () => {
    for (const file of ['components/site-header.tsx', 'components/site-footer.tsx']) {
      for (const href of ['/pricing/', '/changelog/', '/about/']) {
        expect(read(file)).toContain(href);
      }
    }
    expect(read('components/site-footer.tsx')).toContain('/security/');
    expect(read('components/site-header.tsx')).toContain('/security/');
  });
});
