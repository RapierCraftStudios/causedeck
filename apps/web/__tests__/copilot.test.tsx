// @vitest-environment jsdom
// The grounded copilot (#1115): with `copilot.enabled` off both routes are a plain 404; the panel shows
// verified claims with their pinpoint and corpus link, lists a claim the server could not verify
// apart under "Not verified" (never among the claims or in the answer), says "no authority found",
// says AI is off for a sensitive matter, and shows a failed call as an error with no claims. #1132: a
// claim whose statement is its quote prints the sentence once, the pinpoint reads `page N · para M`
// and the usage line has plural forms in en, ta and kn. #1168: the panel is a thread with a written
// answer whose [n] markers are citation chips (only for verified claims; hover or focus highlights the
// source), sources in a rail (lg) or a sheet, a composer (Enter sends, Shift+Enter does not), suggested
// questions from the matter, and loading, error/plan-limit with retry, no-authority, AI-off and
// offline states.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CopilotAnswer } from '@causedeck/core/copilot';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseAnswer } from '../components/copilot/copilot-answer.tsx';
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
vi.mock('../app/(app)/w/[slug]/drafts/[id]/authority-actions.ts', () => ({
  insertAuthorityAction: vi.fn(),
}));
// #1144: the matter page loads the matter's drafts as insert targets in one workspace transaction.
const drafting = vi.hoisted(() => ({ listDrafts: vi.fn(), getDraft: vi.fn() }));
vi.mock('@causedeck/core/runtime', () => ({
  inWorkspace: (_actor: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock('@causedeck/core/drafting', () => drafting);
vi.mock('../src/health.ts', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
// #1168: the matter page reads the overview for the context chips; a failure must not fail the page.
const overview = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../lib/matters/workspace.ts', () => ({ loadMatterOverview: overview.load }));

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
  answer: 'Consent was never obtained. [1]',
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
  drafting.listDrafts.mockResolvedValue([]);
  overview.load.mockResolvedValue({ kind: 'not-found' });
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
    expect(container.querySelector('[data-slot="copilot-unsupported"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Not verified (1)' }));
    const unsupported = container.querySelectorAll('[data-slot="copilot-unsupported"]');
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0]?.textContent).toContain(en.unsupportedTitle);
    expect(unsupported[0]?.textContent).toContain('struck off');
    expect(unsupported[0]?.textContent).toContain(en.reason.unknown_source);
  });

  it('prints a claim whose quote equals its statement once, with its source line', () => {
    const sentence = 'No written consent was taken for the surgery.';
    const { container } = panel({
      ...ANSWER,
      claims: [
        {
          ...(ANSWER.claims[0] as CopilotAnswer['claims'][number]),
          statement: sentence,
          quote: ` ${sentence.toLowerCase()} `,
        },
      ],
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

describe('copilot conversation (#1168)', () => {
  const CHIPS: CopilotAnswer = {
    ...ANSWER,
    answer: 'Consent was never obtained [1]. Costs were awarded [9].',
  };
  const question = () => screen.getByLabelText(en.questionLabel);
  const type = (text: string) => {
    fireEvent.change(question(), { target: { value: text } });
  };

  it('turns verified markers into chips and drops a marker with no verified claim', () => {
    const { container } = panel(CHIPS);
    const prose = container.querySelector('[data-slot="copilot-answer"]');
    expect(prose?.textContent).toBe('Consent was never obtained1. Costs were awarded.');
    const chips = container.querySelectorAll('[data-slot="copilot-cite"]');
    expect(chips).toHaveLength(1);
    expect(chips[0]?.getAttribute('aria-label')).toBe('Source 1');
    expect(prose?.textContent).not.toContain('[');
    expect(parseAnswer('A [2] b [0] c [1]', 1)).toEqual([
      { kind: 'text', text: 'A b c' },
      { kind: 'cite', n: 1 },
    ]);
  });

  it('shows no chip at all when no claim verified', () => {
    const { container } = panel({ ...CHIPS, claims: [], noAuthority: true });
    expect(container.querySelector('[data-slot="copilot-cite"]')).toBeNull();
  });

  it('highlights the source while its chip is focused or hovered', () => {
    const { container } = panel(CHIPS);
    const chip = screen.getByRole('button', { name: 'Source 1' });
    const source = () => container.querySelector('[data-slot="copilot-claim"]');
    fireEvent.focus(chip);
    expect(source()?.getAttribute('data-active')).toBe('true');
    fireEvent.blur(chip);
    expect(source()?.getAttribute('data-active')).toBeNull();
    fireEvent.mouseEnter(chip);
    expect(source()?.getAttribute('data-active')).toBe('true');
  });

  it('appends follow-ups to the thread and keeps earlier turns; Enter sends, Shift+Enter does not', async () => {
    const ask = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: CHIPS })
      .mockResolvedValueOnce({ ok: true, data: { ...ANSWER, answer: 'Second answer [1].' } });
    const { container } = panel(undefined, ask);
    type('First question?');
    fireEvent.keyDown(question(), { key: 'Enter', shiftKey: true });
    expect(ask).not.toHaveBeenCalled();
    fireEvent.keyDown(question(), { key: 'Enter' });
    await waitFor(() => {
      expect(container.querySelectorAll('[data-slot="copilot-answer"]')).toHaveLength(1);
    });
    expect((question() as HTMLTextAreaElement).value).toBe('');
    type('Second question?');
    fireEvent.click(screen.getByRole('button', { name: en.submit }));
    await waitFor(() => {
      expect(container.querySelectorAll('[data-slot="copilot-answer"]')).toHaveLength(2);
    });
    const asked = [...container.querySelectorAll('[data-slot="copilot-question"]')].map(
      (q) => q.textContent,
    );
    expect(asked).toEqual(['You: First question?', 'You: Second question?']);
    expect(container.querySelectorAll('[data-slot="copilot-turn"]')).toHaveLength(2);
    const ids = ask.mock.calls.map(([input]) => (input as { requestId: string }).requestId);
    expect(new Set(ids).size).toBe(2);
  });

  it('suggests questions built from the matter and sends the one picked', async () => {
    const ask = vi.fn().mockResolvedValue({ ok: true, data: ANSWER });
    const { container } = withIntl(
      <CopilotPanel
        workspaceId="ws"
        matterId={MATTER}
        ask={ask}
        matterContext={{ title: 'Rao v. Nursing Home', stage: 'Evidence', nextDate: '2026-12-03' }}
      />,
    );
    const suggestions = [...container.querySelectorAll('[data-slot="copilot-suggestion"]')];
    expect(suggestions.length).toBeGreaterThanOrEqual(3);
    expect(suggestions.length).toBeLessThanOrEqual(4);
    const text = suggestions.map((b) => b.textContent);
    expect(text[0]).toContain('Rao v. Nursing Home');
    expect(text.some((q) => q.includes('Dec 3, 2026'))).toBe(true);
    expect(text.some((q) => q.includes('Evidence'))).toBe(true);
    const chips = container.querySelector('[data-slot="copilot-context"]')?.textContent ?? '';
    expect(chips).toContain('Rao v. Nursing Home');
    expect(chips).toContain('Next date: Dec 3, 2026');
    fireEvent.click(suggestions[0] as Element);
    await waitFor(() => {
      expect(ask).toHaveBeenCalledWith(expect.objectContaining({ question: text[0] }));
    });
    expect(container.querySelector('[data-slot="copilot-empty"]')).toBeNull();
  });

  it('suggests corpus questions on the workspace copilot', () => {
    const { container } = withIntl(<CopilotPanel workspaceId="ws" ask={vi.fn()} />);
    expect(container.querySelectorAll('[data-slot="copilot-suggestion"]')).toHaveLength(3);
    expect(container.textContent).toContain(en.suggestions.corpusBail);
    expect(container.textContent).toContain(en.suggestions.corpusWrit);
  });

  it('starter questions fit bail and writ matters, not medical negligence (#1194)', () => {
    const medical = /consent|surgery|surgeon|negligence|hospital|doctor|medical/i;
    const texts = (node: ParentNode) =>
      [...node.querySelectorAll('[data-slot="copilot-suggestion"]')].map((b) => b.textContent);
    const corpus = withIntl(<CopilotPanel workspaceId="ws" ask={vi.fn()} />);
    const corpusTexts = texts(corpus.container);
    expect(corpusTexts.some((q) => /bail/i.test(q))).toBe(true);
    expect(corpusTexts.some((q) => /writ/i.test(q))).toBe(true);
    for (const q of corpusTexts) expect(q).not.toMatch(medical);
    cleanup();
    const matter = withIntl(
      <CopilotPanel
        workspaceId="ws"
        matterId={MATTER}
        ask={vi.fn()}
        matterContext={{ title: 'Kumar v. State', stage: null, nextDate: null }}
      />,
    );
    const matterTexts = texts(matter.container);
    expect(matterTexts).toContain(en.suggestions.matterOrders);
    for (const q of matterTexts) expect(q).not.toMatch(medical);
    // No catalog keeps a medical-negligence starter (the placeholder text is not a starter).
    for (const locale of ['en', 'kn', 'ta'] as const) {
      const keys = Object.keys(catalogs[locale].research.copilot.suggestions);
      expect(keys).not.toContain('corpusConsent');
      expect(keys).not.toContain('matterDocuments');
    }
  });

  it('shows the searching skeleton while it waits', async () => {
    const ask = vi.fn(() => new Promise(() => undefined));
    const { container } = panel(undefined, ask);
    type('Is consent needed?');
    fireEvent.click(screen.getByRole('button', { name: en.submit }));
    await waitFor(() => {
      expect(container.querySelector('[data-slot="copilot-loading"]')).not.toBeNull();
    });
    expect(screen.getByRole('status').textContent).toContain(en.searching);
    expect(screen.getByRole('button', { name: en.asking })).toHaveProperty('disabled', true);
  });

  it('retries a failed question with the same request id', async () => {
    const ask = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'INTERNAL', message: '' } })
      .mockResolvedValueOnce({ ok: true, data: CHIPS });
    const { container } = panel(undefined, ask);
    type('Is consent needed?');
    fireEvent.click(screen.getByRole('button', { name: en.submit }));
    fireEvent.click(await screen.findByRole('button', { name: en.retry }));
    await waitFor(() => {
      expect(container.querySelector('[data-slot="copilot-answer"]')).not.toBeNull();
    });
    const [first, second] = ask.mock.calls.map(([input]) => input as { requestId: string });
    expect(second?.requestId).toBe(first?.requestId);
    expect(container.querySelector('[data-slot="copilot-error"]')).toBeNull();
  });

  it('shows the plan limit with the server message and a retry', async () => {
    const message = 'This workspace has used its 30 copilot questions this month.';
    const ask = vi.fn().mockResolvedValue({ ok: false, error: { code: 'CONFLICT', message } });
    const { container } = panel(undefined, ask);
    type('Is consent needed?');
    fireEvent.click(screen.getByRole('button', { name: en.submit }));
    await waitFor(() => {
      expect(container.querySelector('[data-slot="copilot-plan-limit"]')).not.toBeNull();
    });
    const limit = container.querySelector('[data-slot="copilot-plan-limit"]')?.textContent;
    expect(limit).toContain(en.planLimit);
    expect(limit).toContain(message);
    expect(screen.getByRole('button', { name: en.retry })).not.toBeNull();
    expect(container.querySelector('[data-slot="copilot-answer"]')).toBeNull();
  });

  it('sends nothing while offline and says so', async () => {
    const ask = vi.fn();
    const online = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    try {
      const { container } = panel(undefined, ask);
      window.dispatchEvent(new Event('offline'));
      await waitFor(() => {
        expect(container.querySelector('[data-slot="copilot-offline"]')?.textContent).toBe(
          en.offline,
        );
      });
      type('Is consent needed?');
      fireEvent.keyDown(question(), { key: 'Enter' });
      expect(screen.getByRole('button', { name: en.submit })).toHaveProperty('disabled', true);
      for (const button of container.querySelectorAll('[data-slot="copilot-suggestion"]')) {
        expect(button).toHaveProperty('disabled', true);
      }
      expect(ask).not.toHaveBeenCalled();
    } finally {
      delete (navigator as { onLine?: boolean }).onLine;
      if (online !== undefined) Object.defineProperty(Navigator.prototype, 'onLine', online);
    }
  });

  it('the matter page passes the matter context, and still renders when it cannot be read', async () => {
    overview.load.mockResolvedValue({
      kind: 'overview',
      overview: {
        header: { title: 'Rao v. Nursing Home' },
        nextDate: { date: '2026-12-03', stage: 'Evidence' },
      },
    });
    const page = await MatterCopilotPage({ params: Promise.resolve({ slug: 'demo', id: MATTER }) });
    const { container } = withIntl(page);
    expect(container.querySelector('[data-slot="copilot-context"]')?.textContent).toContain(
      'Rao v. Nursing Home',
    );
    cleanup();
    overview.load.mockRejectedValue(new Error('db down'));
    const fallback = withIntl(
      await MatterCopilotPage({ params: Promise.resolve({ slug: 'demo', id: MATTER }) }),
    );
    expect(fallback.container.querySelector('[data-route="matter-copilot"]')).not.toBeNull();
    expect(fallback.container.querySelector('[data-slot="copilot-context"]')).toBeNull();
  });
});

describe('insert into draft (#1144)', () => {
  const ten = catalogs.en.drafting.copilotInsert;
  const DRAFTS = [
    {
      id: 'd1',
      title: 'Written statement',
      versionId: 'v1',
      href: '/w/demo/drafts/d1',
      blocks: [
        { key: 'b.0', label: 'Submissions' },
        { key: 'b.1', label: 'Consent was never obtained.' },
      ],
    },
  ];

  it('is absent without drafts or an insert action', () => {
    panel(ANSWER);
    expect(screen.queryByRole('button', { name: ten.insert })).toBeNull();
  });

  it('is absent for a claim that is not a judgment', () => {
    withIntl(
      <CopilotPanel
        workspaceId="ws"
        matterId={MATTER}
        ask={vi.fn()}
        initialAnswer={{
          ...ANSWER,
          claims: ANSWER.claims.map((c) => ({ ...c, kind: 'fact' as const, judgmentId: null })),
        }}
        drafts={DRAFTS}
        insert={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: ten.insert })).toBeNull();
  });

  it('sends the claim’s judgment, quote and pinpoint unaltered after the chosen block', async () => {
    const insert = vi.fn().mockResolvedValue({ ok: true, data: { versionId: 'v2' } });
    withIntl(
      <CopilotPanel
        workspaceId="ws"
        matterId={MATTER}
        ask={vi.fn()}
        initialAnswer={ANSWER}
        drafts={DRAFTS}
        insert={insert}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: ten.insert }));
    fireEvent.change(screen.getByLabelText(ten.after), { target: { value: 'b.0' } });
    fireEvent.click(screen.getByRole('button', { name: ten.confirm }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain(ten.inserted);
    });
    expect(insert).toHaveBeenCalledWith({
      workspaceId: 'ws',
      draftId: 'd1',
      versionId: 'v1',
      afterBlockId: 'b.0',
      candidateRef: { judgmentId: 'j1', quote: 'no written consent was taken', para: 12 },
    });
  });

  it('the matter page offers the matter’s drafts to a member who may write them', async () => {
    drafting.listDrafts.mockResolvedValue([{ id: 'd1', title: 'Written statement' }]);
    drafting.getDraft.mockResolvedValue({
      version: { id: 'v1', blocks: [{ type: 'paragraph', text: 'Consent was never obtained.' }] },
    });
    const page = await MatterCopilotPage({ params: Promise.resolve({ slug: 'demo', id: MATTER }) });
    expect(drafting.listDrafts).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      matterId: MATTER,
    });
    const { container } = withIntl(page);
    expect(container.querySelector('[data-route="matter-copilot"]')).not.toBeNull();
  });
});
