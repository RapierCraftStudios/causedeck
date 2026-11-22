// @vitest-environment jsdom
// The grounded copilot (#1115): with `copilot.enabled` off both routes are a plain 404; the panel shows
// verified claims with their pinpoint and corpus link, lists a claim the server could not verify
// apart under "Not verified" (never among the claims or in the answer), says "no authority found",
// says AI is off for a sensitive matter, and shows a failed call as an error with no claims.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CopilotAnswer } from '@causedeck/core/copilot';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CopilotPanel } from '../components/copilot/copilot-panel.tsx';
import type { WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const state = vi.hoisted((): { context: WorkspaceContext | null; flagOn: boolean } => ({
  context: null,
  flagOn: true,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getLocale: () => Promise.resolve('en'),
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
}));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(state.context),
}));
vi.mock('../lib/flags.ts', () => ({
  requireWorkspaceFlag: (key: string) => {
    if (key !== 'copilot.enabled' || !state.flagOn) throw new Error('NEXT_NOT_FOUND');
    return Promise.resolve();
  },
}));
vi.mock('../app/(app)/w/[slug]/matters/[id]/copilot/actions.ts', () => ({
  askCopilotAction: vi.fn(),
}));

const { default: CopilotPage } = await import('../app/(app)/w/[slug]/copilot/page.tsx');
const { default: MatterCopilotPage } =
  await import('../app/(app)/w/[slug]/matters/[id]/copilot/page.tsx');

const en = catalogs.en.research.copilot;
const MATTER = '00000000-0000-4000-8000-0000000000aa';

const withIntl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

const ANSWER: CopilotAnswer = {
  claims: [
    {
      statement: 'Consent was never obtained.',
      sourceId: 'seg:s1',
      kind: 'seg',
      quote: 'no written consent was taken',
      pinpoint: { page: 4, paragraph: 12 },
      documentId: null,
      judgmentId: 'j1',
    },
  ],
  unsupported: [
    {
      statement: 'The surgeon was struck off.',
      sourceId: 'seg:made-up',
      quote: 'struck off the rolls',
      reason: 'unknown_source',
    },
  ],
  answerText: 'Consent was never obtained.',
  noAuthority: false,
  judgments: {
    j1: {
      id: 'j1',
      title: 'Rao v. Nursing Home',
      court: 'MHC',
      neutralCitation: '2019:MHC:99999',
      sourceUrl: 'https://court.example/j1.pdf',
    },
  },
  aiBlocked: false,
  usage: { used: 1, limit: 30 },
};

const panel = (answer?: CopilotAnswer, ask = vi.fn()) =>
  withIntl(
    <CopilotPanel
      workspaceId="ws"
      matterId={MATTER}
      ask={ask}
      {...(answer === undefined ? {} : { initialAnswer: answer })}
    />,
  );

beforeEach(() => {
  state.context = testWorkspaceContext('demo', 'advocate');
  state.flagOn = true;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('copilot routes', () => {
  it('are a plain 404 for both routes while copilot.enabled is off', async () => {
    state.flagOn = false;
    await expect(CopilotPage({ params: Promise.resolve({ slug: 'demo' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    await expect(
      MatterCopilotPage({ params: Promise.resolve({ slug: 'demo', id: MATTER }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('render the panel when the flag is on', async () => {
    const { container } = withIntl(
      await MatterCopilotPage({ params: Promise.resolve({ slug: 'demo', id: MATTER }) }),
    );
    expect(container.querySelector('[data-route="matter-copilot"]')).not.toBeNull();
    cleanup();
    const workspace = withIntl(await CopilotPage({ params: Promise.resolve({ slug: 'demo' }) }));
    expect(workspace.container.querySelector('[data-route="copilot"]')).not.toBeNull();
  });
});

describe('copilot panel', () => {
  it('shows a verified claim with its pinpoint and corpus link, and the unverified one apart', () => {
    const { container } = panel(ANSWER);
    const claims = container.querySelectorAll('[data-slot="copilot-claim"]');
    expect(claims).toHaveLength(1);
    expect(claims[0]?.textContent).toContain('page 4, paragraph 12');
    expect(claims[0]?.querySelector('a[href^="https://court.example/j1.pdf"]')).not.toBeNull();
    expect(claims[0]?.textContent).not.toContain('struck off');
    const unsupported = container.querySelectorAll('[data-slot="copilot-unsupported"]');
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0]?.textContent).toContain(en.notVerified);
    expect(unsupported[0]?.textContent).toContain('struck off');
  });

  it('says no authority found', () => {
    const { container } = panel({
      ...ANSWER,
      claims: [],
      unsupported: [],
      answerText: '',
      noAuthority: true,
      judgments: {},
    });
    expect(container.querySelector('[data-slot="copilot-no-authority"]')?.textContent).toBe(
      en.noAuthority,
    );
    expect(container.querySelector('[data-slot="copilot-claim"]')).toBeNull();
  });

  it('says AI is off for a sensitive matter', () => {
    const { container } = panel({ ...ANSWER, claims: [], unsupported: [], aiBlocked: true });
    expect(container.querySelector('[data-slot="copilot-ai-off"]')?.textContent).toBe(en.aiOff);
    expect(container.querySelector('[data-slot="copilot-claim"]')).toBeNull();
  });

  it('shows a failed call as an error and no claims', async () => {
    const ask = vi.fn().mockResolvedValue({ ok: false, error: { message: '' } });
    const { container } = panel(undefined, ask);
    fireEvent.change(screen.getByLabelText(en.questionLabel), {
      target: { value: 'Is written consent needed?' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.submit }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(en.error);
    });
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ matterId: MATTER }));
    expect(container.querySelector('[data-slot="copilot-claim"]')).toBeNull();
  });
});
