// @vitest-environment jsdom
// The enquiry log (#874, #87 part 2): the page (flag off is a 404, roles below advocate are denied),
// the actions (flag off is NOT_FOUND before core runs), and the conflict panel (the warning text, the
// live-region count, the decisions, and never a verdict).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSession } from '../lib/auth.ts';
import type { WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const ENQ = '00000000-0000-4000-8000-0000000e0001';

const state = vi.hoisted(
  (): { context: WorkspaceContext | null; flag: boolean; session: AppSession | null } => ({
    context: null,
    flag: true,
    session: null,
  }),
);
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const runtime = vi.hoisted(() => ({
  memberRoleFor: vi.fn(() => Promise.resolve('advocate')),
  ownerGraceFor: vi.fn(() => Promise.resolve(null)),
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
  recordAccessDeniedFor: vi.fn(() => Promise.resolve()),
}));
const intake = vi.hoisted(() => ({
  listEnquiries: vi.fn(() => Promise.resolve([])),
  logEnquiry: vi.fn(() => Promise.resolve({ id: 'e1', status: 'logged' })),
  updateEnquiry: vi.fn(),
  runConflictCheck: vi.fn(),
  acceptEnquiry: vi.fn(),
  closeEnquiry: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getLocale: () => Promise.resolve('en'),
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/auth.ts', () => ({
  getSession: () => Promise.resolve(state.session),
  requireSession: () => Promise.resolve(state.session),
}));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(state.context),
}));
vi.mock('../lib/env.ts', () => ({ isDev: () => false }));
vi.mock('../lib/flags.ts', () => ({
  requireWorkspaceFlag: () => {
    if (!state.flag) throw new Error('NEXT_NOT_FOUND');
    return Promise.resolve();
  },
}));
vi.mock('../src/health.ts', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@causedeck/flags/server', () => ({ isEnabled: () => Promise.resolve(state.flag) }));
vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('@causedeck/core/intake', () => intake);
// An async server component cannot render under jsdom; stand in with the same copy.
vi.mock('../app/(app)/w/[slug]/people/enquiries/_components/gated-notice.tsx', () => ({
  GatedNotice: () => <p>{catalogs.en.enquiry.gatedNotice}</p>,
}));

const { default: EnquiriesPage } = await import('../app/(app)/w/[slug]/people/enquiries/page.tsx');
const actions = await import('../app/(app)/w/[slug]/people/enquiries/actions.ts');
const { ConflictPanel } =
  await import('../app/(app)/w/[slug]/people/enquiries/_components/conflict-panel.tsx');

const en = catalogs.en.enquiry;
const withIntl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );
const renderPage = async () =>
  withIntl(
    await EnquiriesPage({
      params: Promise.resolve({ slug: 'demo' }),
      searchParams: Promise.resolve({}),
    }),
  );

beforeEach(() => {
  state.context = testWorkspaceContext('demo', 'advocate');
  state.flag = true;
  state.session = {
    session: { id: 's1' },
    user: { id: USER, name: 'Asha', email: 'a@x.test', twoFactorEnabled: true },
  } as unknown as AppSession;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('enquiries page', () => {
  it('is a 404 while intake.enquiry_log is off', async () => {
    state.flag = false;
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(intake.listEnquiries).not.toHaveBeenCalled();
  });

  it.each(['clerk', 'junior', 'viewer'] as const)('denies a %s without loading', async (role) => {
    state.context = testWorkspaceContext('demo', role);
    await renderPage();
    expect(document.querySelector('[data-route="enquiries"]')).toBeNull();
    expect(intake.listEnquiries).not.toHaveBeenCalled();
  });

  it('shows the empty log and the standing notice to an advocate', async () => {
    await renderPage();
    expect(document.querySelector('[data-route="enquiries"]')).not.toBeNull();
    expect(screen.getByText(en.empty.title)).toBeTruthy();
    expect(screen.getByText(en.gatedNotice)).toBeTruthy();
    expect(intake.listEnquiries).toHaveBeenCalledTimes(1);
  });
});

describe('enquiry actions', () => {
  it('are NOT_FOUND while the flag is off, and core never runs', async () => {
    state.flag = false;
    expect(
      await actions.logEnquiryAction({ workspaceId: WS, enquirerName: 'A', summary: 'S' }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await actions.closeEnquiryAction({ workspaceId: WS, enquiryId: ENQ })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(intake.logEnquiry).not.toHaveBeenCalled();
    expect(intake.closeEnquiry).not.toHaveBeenCalled();
  });

  it('log an enquiry for an advocate and return only the id and status', async () => {
    const result = await actions.logEnquiryAction({
      workspaceId: WS,
      enquirerName: 'Asha',
      summary: 'Bail matter',
    });
    expect(result).toEqual({ ok: true, data: { id: 'e1', status: 'logged' } });
    expect(intake.logEnquiry).toHaveBeenCalledTimes(1);
  });

  it('are denied for a clerk', async () => {
    runtime.memberRoleFor.mockResolvedValueOnce('clerk');
    const result = await actions.logEnquiryAction({
      workspaceId: WS,
      enquirerName: 'Asha',
      summary: 'Bail matter',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(intake.logEnquiry).not.toHaveBeenCalled();
  });
});

describe('ConflictPanel', () => {
  const hit = {
    checked: 'Murugan',
    side: 'adverse',
    matterId: 'm1',
    matterTitle: 'Murugan v State',
    matchedName: 'Murugan',
    existingRole: 'client' as const,
    score: 1,
    reason: 'Same name',
  };
  const result = { checkedAt: '2026-10-01T00:00:00Z', partyCount: 1, hits: [hit] };

  it('warns, counts in a live region and offers the three decisions', () => {
    const onDecide = vi.fn();
    withIntl(
      <ConflictPanel
        result={result}
        running={false}
        disabled={false}
        error={null}
        onDecide={onDecide}
      />,
    );
    expect(screen.getByText('Possible conflict. Review before you proceed.')).toBeTruthy();
    const live = document.querySelector('[data-conflict-count]') as HTMLElement;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe('1 match found');
    fireEvent.click(document.querySelector('[data-conflict-decision="refer"]') as HTMLElement);
    expect(onDecide).toHaveBeenCalledWith('refer', '');
  });

  it('never says conflicted or clear, with or without hits', () => {
    for (const r of [result, { ...result, hits: [] }]) {
      const { container, unmount } = withIntl(
        <ConflictPanel
          result={r}
          running={false}
          disabled={false}
          error={null}
          onDecide={vi.fn()}
        />,
      );
      expect(container.textContent).not.toMatch(
        /\b(you are conflicted|is conflicted|all clear|no conflict)\b/i,
      );
      unmount();
    }
    expect(en.conflict.noHits).toContain('not a clearance');
  });
});
