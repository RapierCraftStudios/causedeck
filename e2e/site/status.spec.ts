// Status page (#772) over the exported site. The page is static and fetches a signed
// `status.json` in the browser, so each spec intercepts that request with a snapshot signed the way
// core signs it (HMAC-SHA256 over canonical JSON, the public dev key the build verifies with). The
// states covered: operational, degraded, outage, stale, unverified and unavailable (fallback), an
// incident appearing after the next publish, axe in the project's colour scheme (the config runs
// every spec in light and dark at 360, 768 and 1280 px) and visual baselines. Baselines are not
// committed: dispatch the site workflow with update_snapshots (pinned Playwright image) and commit
// the artifact; until then the visual specs skip.
import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { expectNoViolations } from '../fixtures/a11y.ts';

// Same value as DEV_STATUS_VERIFY_KEY in apps/site/lib/env.ts (the build default).
const VERIFY_KEY = 'dev-only-insecure-status-signing-key-change-me';
const NOW = new Date('2026-03-12T04:00:00.000Z');
const STATUS_JSON = '**/status/status.json';

type State = 'operational' | 'degraded' | 'down';
type IncidentState = 'investigating' | 'identified' | 'monitoring' | 'resolved';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

interface Options {
  overall?: State;
  components?: [State, State, State];
  incidents?: Record<string, unknown>[];
  ageSec?: number;
  key?: string;
}

function snapshot({
  overall = 'operational',
  components = ['operational', 'operational', 'operational'],
  incidents = [],
  ageSec = 5,
  key = VERIFY_KEY,
}: Options = {}): Record<string, unknown> {
  const unsigned = {
    version: 1,
    generatedAt: new Date(NOW.getTime() - ageSec * 1000).toISOString(),
    overall,
    components: [
      { id: 'database', name: 'Database', status: components[0] },
      { id: 'storage', name: 'Storage', status: components[1] },
      { id: 'court', name: 'Court', status: components[2] },
    ],
    incidents,
  };
  const value = createHmac('sha256', key).update(canonicalJson(unsigned)).digest('hex');
  return { ...unsigned, signature: { alg: 'HS256', value } };
}

function incident(
  state: IncidentState,
  severity: 'degraded' | 'down',
  title: string,
): Record<string, unknown> {
  const startedAt = new Date(NOW.getTime() - 40 * 60_000).toISOString();
  const at = new Date(NOW.getTime() - 10 * 60_000).toISOString();
  return {
    id: '7b0d6a52-3c1e-4f0a-9a52-0e6f5a2a9c11',
    title,
    severity,
    state,
    component: 'database',
    startedAt,
    resolvedAt: state === 'resolved' ? at : null,
    updates: [{ state, body: `We are ${state} this incident.`, at }],
  };
}

async function serve(page: Page, body: unknown, status = 200): Promise<void> {
  await page.route(STATUS_JSON, (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

async function open(page: Page): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await page.goto('/status/');
}

test('operational: the banner, three components and the feeds', async ({ page }) => {
  await serve(page, snapshot());
  await open(page);
  await expect(page.getByRole('heading', { level: 1, name: 'CauseDeck status' })).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'All systems operational' }),
  ).toBeVisible();
  await expect(page.locator('li[data-state="operational"]')).toHaveCount(3);
  await expect(page.getByText('Parsing of documents you share')).toBeVisible();
  await expect(page.getByText('No incidents in the last 30 days.')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'RSS' })).toHaveAttribute('href', '/status/feed.xml');
  await expect(page.getByRole('link', { name: 'Atom' })).toHaveAttribute(
    'href',
    '/status/atom.xml',
  );
  await expectNoViolations(page);
});

test('degraded: an open incident is listed with its update', async ({ page }) => {
  await serve(
    page,
    snapshot({
      overall: 'degraded',
      components: ['degraded', 'operational', 'operational'],
      incidents: [incident('investigating', 'degraded', 'Slow case search')],
    }),
  );
  await open(page);
  await expect(page.getByText('Some systems are degraded')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Current incidents' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Slow case search' })).toBeVisible();
  await expect(page.getByText('We are investigating this incident.')).toBeVisible();
  await expectNoViolations(page);
});

test('outage: the down state is shown in text, not colour alone', async ({ page }) => {
  await serve(
    page,
    snapshot({
      overall: 'down',
      components: ['down', 'operational', 'operational'],
      incidents: [incident('identified', 'down', 'Application unavailable')],
    }),
  );
  await open(page);
  await expect(page.getByText('Some systems are down')).toBeVisible();
  await expect(page.locator('li[data-state="down"]')).toContainText('Down');
  await expectNoViolations(page);
});

test('stale: data older than five minutes carries a warning', async ({ page }) => {
  await serve(page, snapshot({ ageSec: 20 * 60 }));
  await open(page);
  await expect(page.getByText('This status may be out of date')).toBeVisible();
  await expectNoViolations(page);
});

test('unverified: a snapshot with a bad signature is not shown', async ({ page }) => {
  await serve(page, snapshot({ key: 'some-other-key' }));
  await open(page);
  await expect(page.getByText('Status data could not be verified')).toBeVisible();
  await expect(page.getByText('All systems operational')).toHaveCount(0);
  await expectNoViolations(page);
});

test('fallback: an unreachable status.json shows a retry that recovers', async ({ page }) => {
  await page.route(STATUS_JSON, (route) => route.fulfill({ status: 503, body: 'down' }));
  await open(page);
  await expect(page.getByText('We could not load the status data.')).toBeVisible();
  await expectNoViolations(page);
  await page.unroute(STATUS_JSON);
  await serve(page, snapshot());
  await page.getByRole('button', { name: 'Status unavailable, retry' }).click();
  await expect(page.getByText('All systems operational')).toBeVisible();
});

test('an incident published after the first load appears on the next publish cycle', async ({
  page,
}) => {
  // The site e2e has no admin or database; the publish step is a new signed snapshot on the same URL.
  await serve(page, snapshot());
  await open(page);
  await expect(page.getByText('All systems operational')).toBeVisible();
  await page.unroute(STATUS_JSON);
  await serve(
    page,
    snapshot({
      overall: 'degraded',
      components: ['operational', 'degraded', 'operational'],
      incidents: [incident('monitoring', 'degraded', 'Delayed document uploads')],
    }),
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Delayed document uploads' })).toBeVisible();
  await expect(page.getByText('Some systems are degraded')).toBeVisible();
});

test('history lists resolved incidents', async ({ page }) => {
  await serve(page, snapshot({ incidents: [incident('resolved', 'degraded', 'Brief slowdown')] }));
  await page.clock.setFixedTime(NOW);
  await page.goto('/status/history/');
  await expect(page.getByRole('heading', { name: 'Resolved incidents' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Brief slowdown' })).toBeVisible();
  await expectNoViolations(page);
});

test('no horizontal overflow', async ({ page }) => {
  await serve(
    page,
    snapshot({ incidents: [incident('investigating', 'degraded', 'Slow search')] }),
  );
  await open(page);
  await expect(page.getByRole('status').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

const VISUALS: { name: string; options: Options }[] = [
  { name: 'status-operational', options: {} },
  {
    name: 'status-degraded',
    options: {
      overall: 'degraded',
      components: ['degraded', 'operational', 'operational'],
      incidents: [incident('investigating', 'degraded', 'Slow case search')],
    },
  },
  {
    name: 'status-outage',
    options: {
      overall: 'down',
      components: ['down', 'operational', 'operational'],
      incidents: [incident('identified', 'down', 'Application unavailable')],
    },
  },
];

for (const visual of VISUALS) {
  test(`${visual.name} @visual`, async ({ page }, testInfo) => {
    const file = `${visual.name}.png`;
    test.skip(
      testInfo.config.updateSnapshots === 'none' &&
        !existsSync(testInfo.snapshotPath(file, { kind: 'screenshot' })),
      'no baseline yet: dispatch the site workflow with update_snapshots',
    );
    await serve(page, snapshot(visual.options));
    await open(page);
    await expect(page.getByRole('status').first()).toBeVisible();
    await expect(page.locator('main')).toHaveScreenshot(file);
  });
}
