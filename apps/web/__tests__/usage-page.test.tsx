// @vitest-environment jsdom
// `/w/[slug]/settings/usage` (#223): the view model (percent and level at the 80%/100% thresholds,
// formatInr amounts, the IST reset date, seconds to minutes, unlimited, empty) and the server page
// with every design-spec state: loading, error, empty, permission-denied, warning/exceeded meters
// with an icon and text beside the colour, and ta. Every string comes from the catalogs.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UsageViewInput } from '../app/(app)/w/[slug]/settings/usage/usage-view.ts';
import type { WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations, type TestLocale } from './helpers/intl.ts';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const page = vi.hoisted(
  (): {
    context: WorkspaceContext | null;
    dev: boolean;
    locale: TestLocale;
    counters: Record<string, number>;
    budgetPaise: number | null;
    entitlements: {
      ocr_pages: number | null;
      capture_minutes: number | null;
      max_active_matters: number | null;
    };
    fail: boolean;
  } => ({
    context: null,
    dev: true,
    locale: 'en',
    counters: {},
    budgetPaise: null,
    entitlements: { ocr_pages: null, capture_minutes: null, max_active_matters: null },
    fail: false,
  }),
);
const withWorkspace = vi.hoisted(() =>
  vi.fn((_db: unknown, _scope: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    fn({ scoped: true }),
  ),
);
const getUsage = vi.hoisted(() =>
  vi.fn((_ctx: unknown, key: string) =>
    page.fail ? Promise.reject(new Error('db down')) : Promise.resolve(page.counters[key] ?? 0),
  ),
);
const logger = vi.hoisted(() => ({ error: vi.fn() }));
const reportError = vi.hoisted(() => vi.fn());
const ShellOfflineBanner = vi.hoisted(() => () => null);

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations(page.locale)(namespace),
  getLocale: () => Promise.resolve(page.locale),
}));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(page.context),
}));
vi.mock('../lib/env.ts', () => ({ isDev: () => page.dev }));
vi.mock('../lib/report-error.ts', () => ({ reportError }));
vi.mock('../src/health.ts', () => ({ logger }));
vi.mock('../components/shell/offline-banner.tsx', () => ({ ShellOfflineBanner }));
vi.mock('@causedeck/db', () => ({ db: { fake: 'db' }, withWorkspace }));
vi.mock('@causedeck/core/usage', async () => {
  const { USAGE_KEYS } = await import('../../../packages/core/src/usage/keys.ts');
  const { nextPeriodStart } = await import('../../../packages/core/src/usage/period.ts');
  return {
    USAGE_KEYS,
    SOFT_LIMIT_BPS: 8_000,
    nextPeriodStart,
    getUsage,
    getAiBudget: () => Promise.resolve({ budgetPaise: page.budgetPaise, source: 'entitlement' }),
  };
});
vi.mock('@causedeck/core/billing', () => ({
  getWorkspaceEntitlements: () => Promise.resolve(page.entitlements),
}));

const { toUsageView } = await import('../app/(app)/w/[slug]/settings/usage/usage-view.ts');
const { default: UsagePage } = await import('../app/(app)/w/[slug]/settings/usage/page.tsx');
const { default: UsageErrorBoundary } =
  await import('../app/(app)/w/[slug]/settings/usage/error.tsx');
const { default: UsageLoading } = await import('../app/(app)/w/[slug]/settings/usage/loading.tsx');
const { nextPeriodStart } = await import('../../../packages/core/src/usage/period.ts');

const en = catalogs.en.usage;

const WORKSPACE = {
  id: '00000000-0000-4000-8000-00000000a001',
  slug: 'chennai-solo',
  name: 'Iyer Chambers',
};

const LIMITS: UsageViewInput['limits'] = {
  aiBudgetPaise: 17_500,
  ocrPages: 100,
  captureMinutes: 60,
  maxActiveMatters: 50,
};

function view(
  counters: UsageViewInput['counters'],
  overrides: Partial<UsageViewInput> = {},
): ReturnType<typeof toUsageView> {
  const now = new Date('2026-03-15T06:00:00Z');
  return toUsageView({
    counters,
    limits: LIMITS,
    resetAt: nextPeriodStart(now),
    locale: 'en',
    ...overrides,
  });
}

const meter = (result: ReturnType<typeof toUsageView>, id: string) => {
  const found = result.meters.find((m) => m.id === id);
  if (!found) throw new Error(`no meter ${id}`);
  return found;
};

describe('usage view model', () => {
  it.each([
    [0, 0, 'ok'],
    [79, 79, 'ok'],
    [80, 80, 'warning'],
    [100, 100, 'exceeded'],
    [120, 120, 'exceeded'],
  ] as const)('%i of 100 OCR pages is %i%% and %s', (used, percent, level) => {
    const ocr = meter(view({ 'ocr.pages': used }), 'ocr');
    expect(ocr.percent).toBe(percent);
    expect(ocr.level).toBe(level);
    expect(ocr.used).toBe(String(used));
    expect(ocr.limit).toBe('100');
  });

  it('formats AI spend against the budget with formatInr', () => {
    const ai = meter(view({ 'ai.spend_paise': 11_200 }), 'ai');
    expect(ai).toEqual({
      id: 'ai',
      used: '₹112.00',
      limit: '₹175.00',
      percent: 64,
      level: 'ok',
      resetDate: '1 Apr',
    });
  });

  it('resets monthly meters on the 1st of next month in IST, and never active matters', () => {
    const at = (iso: string) => view({}, { resetAt: nextPeriodStart(new Date(iso)) });
    expect(meter(at('2026-03-31T18:29:00Z'), 'ai').resetDate).toBe('1 Apr');
    expect(meter(at('2026-03-31T18:30:00Z'), 'ai').resetDate).toBe('1 May');
    const result = view({});
    expect(meter(result, 'ocr').resetDate).toBe('1 Apr');
    expect(meter(result, 'stt').resetDate).toBe('1 Apr');
    expect(meter(result, 'matters').resetDate).toBeNull();
  });

  it('shows transcription seconds as whole minutes', () => {
    const stt = meter(view({ 'stt.seconds': 2_999 }), 'stt');
    expect(stt.used).toMatch(/^49 min/);
    expect(stt.limit).toMatch(/^60 min/);
    expect(stt.percent).toBe(83);
    expect(stt.level).toBe('warning');
  });

  it('has no percent or level for an unlimited resource', () => {
    const result = view(
      { 'ai.spend_paise': 999_999 },
      { limits: { ...LIMITS, aiBudgetPaise: null } },
    );
    expect(meter(result, 'ai')).toMatchObject({ limit: null, percent: null, level: 'ok' });
    expect(result.breakdown.find((row) => row.id === 'aiSpend')?.limit).toBeNull();
  });

  it('is empty when nothing is metered, with every breakdown row', () => {
    const result = view({ 'ai.spend_paise': 0, 'ocr.pages': 0 });
    expect(result.empty).toBe(true);
    expect(view({ 'storage.bytes': 1 }).empty).toBe(false);
    expect(result.breakdown.map((row) => row.id)).toEqual([
      'aiSpend',
      'tokensIn',
      'tokensOut',
      'ocr',
      'stt',
      'storage',
      'matters',
    ]);
  });
});

const withIntl = (ui: ReactNode, locale: TestLocale = 'en') =>
  render(
    <NextIntlClientProvider locale={locale} messages={catalogs[locale]} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

/** Render the page, resolving the async usage section inside its Suspense boundary. */
async function renderPage(search: Record<string, string> = {}) {
  const tree = (await UsagePage({
    params: Promise.resolve({ slug: WORKSPACE.slug }),
    searchParams: Promise.resolve(search),
  })) as ReactElement<{ children?: unknown }>;
  const children = tree.props.children;
  if (!Array.isArray(children)) {
    withIntl(tree, page.locale);
    return;
  }
  // Children: the offline banner (mocked out), the header, then the skeleton or the Suspense body.
  const [, header, body] = children as [ReactElement, ReactElement, ReactElement];
  const section = (body.props as { children?: ReactElement }).children;
  let content: ReactNode = body;
  if (section && typeof section.type === 'function') {
    const Section = section.type as (props: unknown) => Promise<ReactNode>;
    content = await Section(section.props);
  }
  withIntl(
    <div>
      {header}
      {content}
    </div>,
    page.locale,
  );
}

beforeEach(() => {
  page.context = {
    user: { id: 'u-owner', name: 'Meenakshi Iyer', email: 'owner@x.test' },
    workspace: WORKSPACE,
    role: 'owner',
    memberships: [],
  };
  page.dev = true;
  page.locale = 'en';
  page.counters = {
    'ai.spend_paise': 11_200,
    'ai.tokens_in': 1_234_567,
    'ai.tokens_out': 4_321,
    'ocr.pages': 85,
    'stt.seconds': 3_600,
    'storage.bytes': 5 * 1024 * 1024,
    'matters.active': 12,
  };
  page.budgetPaise = 17_500;
  page.entitlements = { ocr_pages: 100, capture_minutes: 60, max_active_matters: null };
  page.fail = false;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('usage page (server)', () => {
  it('is not found for a non-member', async () => {
    page.context = null;
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('shows a progressbar per limited meter with aria values and the AI reset copy', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.title);
    expect(withWorkspace).toHaveBeenCalledWith(
      { fake: 'db' },
      { workspaceId: WORKSPACE.id, userId: 'u-owner' },
      expect.any(Function),
    );
    expect(getUsage).toHaveBeenCalledTimes(8);

    // Active matters are unlimited here: no bar, the plain value and `No limit on your plan`.
    const bars = screen.getAllByRole('progressbar');
    expect(bars.map((bar) => bar.getAttribute('aria-label'))).toEqual([
      en.meters.ai,
      en.meters.ocr,
      en.meters.stt,
    ]);
    const ai = screen.getByRole('progressbar', { name: en.meters.ai });
    expect(ai.getAttribute('aria-valuenow')).toBe('64');
    expect(ai.getAttribute('aria-valuemin')).toBe('0');
    expect(ai.getAttribute('aria-valuemax')).toBe('100');
    expect(ai.getAttribute('aria-valuetext')).toBe('64% used, ₹112.00 of ₹175.00');

    const aiCard = document.querySelector('[data-meter="ai"]') as HTMLElement;
    expect(aiCard.textContent).toContain('₹112.00 of ₹175.00');
    expect(aiCard.textContent).toContain('64% used');
    expect(aiCard.querySelector('[data-slot="usage-meter-reset"]')?.textContent).toMatch(
      /^AI processing budget resets on 1 [A-Z][a-z]{2}$/,
    );
    const matters = document.querySelector('[data-meter="matters"]') as HTMLElement;
    expect(matters.textContent).toContain(en.unlimited);
    expect(matters.querySelector('[data-slot="usage-meter-reset"]')).toBeNull();

    const table = screen.getByRole('table');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(7);
    expect(table.querySelector('[data-row="tokensIn"]')?.textContent).toContain('12,34,567');
  });

  it('pairs warning and exceeded colours with an icon and level text', async () => {
    await renderPage();
    const ocr = document.querySelector('[data-meter="ocr"]') as HTMLElement;
    expect(ocr.dataset.level).toBe('warning');
    expect(ocr.querySelector('[data-slot="progress"]')?.getAttribute('data-tone')).toBe('warning');
    const warning = ocr.querySelector('[data-slot="usage-meter-level"]') as HTMLElement;
    expect(warning.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(warning.textContent).toContain(en.level.warning);

    const stt = document.querySelector('[data-meter="stt"]') as HTMLElement;
    expect(stt.dataset.level).toBe('exceeded');
    expect(stt.querySelector('[data-slot="progress"]')?.getAttribute('data-tone')).toBe('danger');
    const exceeded = stt.querySelector('[data-slot="usage-meter-level"]') as HTMLElement;
    expect(exceeded.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(exceeded.textContent).toContain(en.level.exceeded);

    const ai = document.querySelector('[data-meter="ai"]') as HTMLElement;
    expect(ai.querySelector('[data-slot="usage-meter-level"]')).toBeNull();
  });

  it('uses the calm AI warning copy at 80%', async () => {
    page.counters = { 'ai.spend_paise': 14_000 };
    await renderPage();
    const ai = document.querySelector('[data-meter="ai"]') as HTMLElement;
    expect(ai.textContent).toContain(
      "You have used 80% of this month's AI processing budget. Existing work is not affected.",
    );
  });

  it.each(['advocate', 'junior', 'clerk', 'viewer'] as const)(
    'denies a %s without loading usage',
    async (role) => {
      if (page.context) page.context.role = role;
      await renderPage();
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
        catalogs.en.shell.permissionDenied.title,
      );
      const denied = document.querySelector('[data-pattern-state="permission-denied"]');
      expect(denied?.textContent).toContain('Only workspace owners can see usage.');
      expect(withWorkspace).not.toHaveBeenCalled();
      expect(getUsage).not.toHaveBeenCalled();
    },
  );

  it('shows the error state with Try again when loading fails', async () => {
    page.fail = true;
    await renderPage();
    expect(screen.getByRole('alert').textContent).toContain('Could not load usage.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(router.refresh).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('shows the empty state above zeroed meters', async () => {
    page.counters = {};
    await renderPage();
    const empty = document.querySelector('[data-pattern-state="empty"]');
    expect(empty?.textContent).toContain('No usage yet this month.');
    expect(screen.getAllByRole('progressbar')[0]?.getAttribute('aria-valuenow')).toBe('0');
  });

  it('previews the loading, error and empty states in development only', async () => {
    await renderPage({ __state: 'loading' });
    expect(document.querySelector('[data-slot="usage-skeleton"]')).not.toBeNull();
    expect(withWorkspace).not.toHaveBeenCalled();
    cleanup();
    await renderPage({ __state: 'error' });
    expect(screen.getByRole('alert').textContent).toContain(en.error.title);
    expect(logger.error).not.toHaveBeenCalled();
    cleanup();
    await renderPage({ __state: 'empty' });
    expect(document.querySelector('[data-slot="usage-empty"]')).not.toBeNull();
    cleanup();
    page.dev = false;
    await renderPage({ __state: 'error' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the shell offline banner above the usage content', async () => {
    const tree = (await UsagePage({
      params: Promise.resolve({ slug: WORKSPACE.slug }),
      searchParams: Promise.resolve({}),
    })) as ReactElement<{ children: ReactElement[] }>;
    expect(tree.props.children[0]?.type).toBe(ShellOfflineBanner);
  });

  it('renders ta strings under the ta locale', async () => {
    page.locale = 'ta';
    await renderPage();
    const ta = catalogs.ta.usage;
    const text = document.body.textContent;
    expect(text).toContain(ta.title);
    expect(text).toContain(ta.meters.ai);
    expect(text).toContain(ta.breakdown.title);
    for (const leak of [en.meters.ai, en.breakdown.title, en.unlimited]) {
      expect(text).not.toContain(leak);
    }
  });
});

describe('usage route boundaries', () => {
  it('the error boundary reports the error and retries with reset', () => {
    const reset = vi.fn();
    withIntl(<UsageErrorBoundary error={new Error('boom')} reset={reset} />);
    expect(screen.getByRole('alert').textContent).toContain(en.error.title);
    fireEvent.click(screen.getByRole('button', { name: en.error.retry }));
    expect(reset).toHaveBeenCalled();
    expect(reportError).toHaveBeenCalled();
    expect(screen.queryByText('boom')).toBeNull();
  });

  it('the loading boundary shows skeleton meters and rows', () => {
    withIntl(<UsageLoading />);
    expect(document.querySelectorAll('[data-slot="usage-skeleton-meter"]')).toHaveLength(4);
    expect(document.querySelectorAll('[data-slot="usage-skeleton-row"]')).toHaveLength(4);
  });
});
