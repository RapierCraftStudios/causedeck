// @vitest-environment jsdom
// The limitation tracker (#941, #84 part 3): the page (flag off is a 404, a denied load is the
// permission page, the standing label and notices show), the actions (flag off is NOT_FOUND before
// core runs; a clerk is denied) and the list (Propose is off without a reviewed rule, a clerk sees
// no Confirm, Confirm calls the action).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSession } from '../lib/auth.ts';
import type { WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const WS = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000b0101';
const MATTER = '00000000-0000-4000-8000-0000000a0001';
const COMP = '00000000-0000-4000-8000-0000000d0001';

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
const limitation = vi.hoisted(() => ({
  listLimitations: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
  listRules: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
  computeLimitation: vi.fn(() => Promise.resolve({ id: 'c1', expiresOn: '2027-01-31' })),
  confirmLimitation: vi.fn(() =>
    Promise.resolve({ computationId: 'c1', obligationId: 'o1', dueDate: '2027-01-31' }),
  ),
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
vi.mock('@causedeck/core/limitation', () => limitation);
// Async server components cannot render under jsdom; stand in with the same copy.
vi.mock('../app/(app)/w/[slug]/limitation/_components/gated-notice.tsx', () => ({
  LimitationGatedNotice: () => <p>{catalogs.en.limitation.gatedNotice}</p>,
}));
vi.mock('../app/(app)/w/[slug]/limitation/_components/no-rules-notice.tsx', () => ({
  NoRulesNotice: () => <p>{catalogs.en.limitation.noRules.title}</p>,
}));

const { default: LimitationPage } = await import('../app/(app)/w/[slug]/limitation/page.tsx');
const actions = await import('../app/(app)/w/[slug]/limitation/actions.ts');
const { LimitationList } =
  await import('../app/(app)/w/[slug]/limitation/_components/limitation-list.tsx');

const en = catalogs.en.limitation;
const RULE = {
  id: '00000000-0000-4000-8000-0000000c0001',
  code: 'synthetic_appeal',
  title: 'Synthetic appeal period',
  statute: 'Fictional Act',
  periodValue: 90,
  periodUnit: 'days',
  startEvent: 'judgment_date',
  condonable: true,
  citation: null,
  tableVersion: '1',
  reviewed: true,
  draft: false,
};
const COMPUTATION = {
  id: COMP,
  matterId: MATTER,
  expiresOn: '2027-01-31',
  status: 'proposed',
  ruleId: RULE.id,
  ruleCode: RULE.code,
  ruleVersion: '1',
  startDate: '2026-11-02',
  excludedDays: 0,
  notes: [],
};

const withIntl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );
const renderPage = async () =>
  withIntl(
    await LimitationPage({
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

describe('limitation page', () => {
  it('is a 404 while limitation.enabled is off, and core never runs', async () => {
    state.flag = false;
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(limitation.listLimitations).not.toHaveBeenCalled();
  });

  it('shows the verify label, the notices and the empty state to an advocate', async () => {
    await renderPage();
    expect(document.querySelector('[data-route="limitation"]')).not.toBeNull();
    expect(screen.getByText(en.verifyLabel)).toBeTruthy();
    expect(screen.getByText(en.gatedNotice)).toBeTruthy();
    expect(screen.getByText(en.noRules.title)).toBeTruthy();
    expect(screen.getByText(en.empty.title)).toBeTruthy();
  });

  it('shows the permission page when core denies the load', async () => {
    limitation.listLimitations.mockRejectedValueOnce(
      Object.assign(new Error('no'), { code: 'FORBIDDEN' }),
    );
    await renderPage();
    expect(document.querySelector('[data-route="limitation"]')).toBeNull();
  });
});

describe('limitation actions', () => {
  it('are NOT_FOUND while the flag is off, and core never runs', async () => {
    state.flag = false;
    expect(
      await actions.computeLimitationAction({
        workspaceId: WS,
        matterId: MATTER,
        ruleCode: 'synthetic_appeal',
        startDate: '2026-11-02',
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(
      await actions.confirmLimitationAction({ workspaceId: WS, computationId: COMP }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(limitation.computeLimitation).not.toHaveBeenCalled();
    expect(limitation.confirmLimitation).not.toHaveBeenCalled();
  });

  it('confirm returns only the id and the due date for an advocate', async () => {
    expect(await actions.confirmLimitationAction({ workspaceId: WS, computationId: COMP })).toEqual(
      { ok: true, data: { id: 'c1', expiresOn: '2027-01-31' } },
    );
  });

  it('are denied for a clerk', async () => {
    runtime.memberRoleFor.mockResolvedValueOnce('clerk');
    const result = await actions.confirmLimitationAction({ workspaceId: WS, computationId: COMP });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(limitation.confirmLimitation).not.toHaveBeenCalled();
  });
});

describe('limitation list', () => {
  const done = () => Promise.resolve({ ok: true as const, data: { id: 'c', expiresOn: 'x' } });
  const renderList = (over: { canWrite?: boolean; rules?: unknown[] } = {}) => {
    const confirm = vi.fn(done);
    withIntl(
      <LimitationList
        workspaceId={WS}
        computations={[COMPUTATION] as never}
        rules={(over.rules ?? [RULE]) as never}
        canWrite={over.canWrite ?? true}
        actions={{ compute: vi.fn(done), confirm }}
      />,
    );
    return confirm;
  };

  it('confirms a proposal from its button and with Enter on the selected card', async () => {
    const confirm = renderList();
    fireEvent.click(screen.getByRole('button', { name: en.card.confirm }));
    await waitFor(() => {
      expect(confirm).toHaveBeenCalledTimes(1);
    });
    expect(confirm).toHaveBeenCalledWith({ workspaceId: WS, computationId: COMP });
    const card = document.querySelector('[data-slot="limitation-card"]') as HTMLElement;
    fireEvent.focus(card);
    fireEvent.keyDown(card, { key: 'Enter' });
    await waitFor(() => {
      expect(confirm).toHaveBeenCalledTimes(2);
    });
  });

  it('opens the propose form with p and closes it with Esc', async () => {
    renderList();
    fireEvent.keyDown(document.body, { key: 'p' });
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('turns Propose off without a reviewed rule', () => {
    renderList({ rules: [{ ...RULE, reviewed: false, draft: true }] });
    expect(
      (screen.getAllByRole('button', { name: en.form.trigger })[0] as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows a clerk no Propose and no Confirm', () => {
    renderList({ canWrite: false, rules: [] });
    expect(screen.queryByRole('button', { name: en.form.trigger })).toBeNull();
    expect(screen.queryByRole('button', { name: en.card.confirm })).toBeNull();
  });
});
