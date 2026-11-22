// @vitest-environment jsdom
// The grounded copilot (#1115): with `copilot.enabled` off both routes are a plain 404; the panel shows
// verified claims with their pinpoint and corpus link, lists a claim the server could not verify
// apart under "Not verified" (never among the claims or in the answer), says "no authority found",
// says AI is off for a sensitive matter, and shows a failed call as an error with no claims. #1132: a
// claim whose statement is its quote prints the sentence once, the pinpoint reads `page N · para M`
// and the usage line has plural forms in en, ta and kn.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CopilotAnswer } from '@causedeck/core/copilot';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
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
    expect(claims[0]?.textContent).toContain('page 4 · para 12');
    expect(claims[0]?.querySelector('a[href^="https://court.example/j1.pdf"]')).not.toBeNull();
    expect(claims[0]?.textContent).not.toContain('struck off');
    const unsupported = container.querySelectorAll('[data-slot="copilot-unsupported"]');
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0]?.textContent).toContain(en.notVerified);
    expect(unsupported[0]?.textContent).toContain('struck off');
  });

  it('prints a claim whose quote equals its statement once, with its source line', () => {
    const sentence = 'No written consent was taken for the surgery.';
    const { container } = panel({
      ...ANSWER,
      claims: [{ ...(ANSWER.claims[0] as CopilotAnswer['claims'][number]), statement: sentence, quote: ` ${sentence.toLowerCase()} ` }],
      unsupported: [],
    });
    const claim = container.querySelector('[data-slot="copilot-claim"]');
    const text = (claim?.textContent ?? '').toLowerCase();
    expect(text.split(sentence.toLowerCase())).toHaveLength(2);
    expect(claim?.querySelector('blockquote')).not.toBeNull();
    expect(claim?.querySelector('[data-slot="copilot-source"]')?.textContent).toContain(
      'page 4 · para 12',
    );
  });

  it('keeps the statement and the quote when they differ', () => {
    const { container } = panel(ANSWER);
    const claim = container.querySelector('[data-slot="copilot-claim"]');
    expect(claim?.textContent).toContain('Consent was never obtained.');
    expect(claim?.querySelector('blockquote')?.textContent).toBe('no written consent was taken');
  });

  it('uses plural forms in the usage line', () => {
    const usage = (used: number, limit: number | null) => {
      cleanup();
      const { container } = panel({ ...ANSWER, usage: { used, limit } });
      return container.querySelector('[data-slot="copilot-usage"]')?.textContent ?? '';
    };
    expect(usage(1, 30)).toBe('1 of 30 question used this month');
    expect(usage(2, 30)).toBe('2 of 30 questions used this month');
    expect(usage(1, null)).toBe('1 question this month');
    expect(usage(2, null)).toBe('2 questions this month');
  });

  it.each([
    ['ta', 'இந்த மாதம் 1 கேள்வி', 'இந்த மாதம் 2 கேள்விகள்'],
    ['kn', 'ಈ ತಿಂಗಳು 1 ಪ್ರಶ್ನೆ', 'ಈ ತಿಂಗಳು 2 ಪ್ರಶ್ನೆಗಳು'],
  ] as const)('has plural usage forms in %s', (locale, one, other) => {
    const t = createTranslator({
      locale,
      messages: catalogs[locale],
      namespace: 'research.copilot',
    });
    expect(t('usageUnlimited', { used: 1 })).toBe(one);
    expect(t('usageUnlimited', { used: 2 })).toBe(other);
    expect(t('usage', { used: 1, limit: 30 })).not.toBe(t('usage', { used: 2, limit: 30 }));
    expect(t('usage', { used: 2, limit: 30 })).toContain('2');
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
