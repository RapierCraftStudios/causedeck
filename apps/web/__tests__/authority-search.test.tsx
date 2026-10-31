// @vitest-environment jsdom
// Fact-pattern search (#896): the plan shows as editable chips, editing a chip searches again with the
// edited plan and never plans again (the `rerun` action, not `search`), results show the court,
// citation, masked title, role-labelled passages, outcome, cited-by and the court PDF link, and an
// answer shows unsupported claims as unsupported, never as verified.
import type { AuthoritySearchResult } from '@causedeck/core/research';
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthoritySearch } from '../components/research/authority-search.tsx';
import { FindAuthoritiesButton } from '../components/research/find-authorities-button.tsx';

import { catalogs } from './helpers/intl.ts';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

// The host is shared by many lanes: give async UI updates room.
configure({ asyncUtilTimeout: 8000 });

afterEach(cleanup);

const WS = '00000000-0000-4000-8000-00000000a001';
const plan: AuthoritySearchResult['plan'] = {
  query: 'surgery without consent',
  factDescription: 'surgery without consent',
  keywords: ['surgery', 'consent'],
  subjectAreas: ['medical_negligence'],
  statutes: [{ statute: 'bharatiya nyaya sanhita', section: '106' }],
  courts: [],
  courtLevel: 'high_court',
  dateFrom: null,
  dateTo: null,
  outcome: null,
  offenceDate: null,
  planner: 'heuristic',
};

const result = (over: Partial<AuthoritySearchResult> = {}): AuthoritySearchResult => ({
  plan,
  chips: [
    {
      statute: 'bharatiya nyaya sanhita',
      section: '106',
      counterparts: [{ statute: 'indian penal code', section: '304a', inForce: null }],
    },
  ],
  hits: [
    {
      judgmentId: 'j1',
      court: 'MHC',
      courtLevel: 'high_court',
      judgmentDate: '2019-03-04',
      neutralCitation: '2019:MHC:1234',
      title: 'Meera Rao v. Sunrise Nursing Home',
      titleMasked: false,
      outcome: 'allowed',
      citedByCount: 3,
      sourceUrl: 'https://court.example/j1.pdf',
      score: 0.9,
      segments: [
        {
          segmentId: 's1',
          role: 'facts',
          pageFrom: 2,
          pageTo: 2,
          text: 'No written consent was taken.',
          score: 0.9,
        },
        {
          segmentId: 's2',
          role: 'reasoning',
          pageFrom: 3,
          pageTo: 4,
          text: 'This is medical negligence.',
          score: 0.8,
        },
      ],
    },
    {
      judgmentId: 'j2',
      court: 'KHC',
      courtLevel: 'high_court',
      judgmentDate: null,
      neutralCitation: null,
      title: null,
      titleMasked: true,
      outcome: 'unknown',
      citedByCount: 0,
      sourceUrl: null,
      score: 0.5,
      segments: [
        {
          segmentId: 's3',
          role: 'decision',
          pageFrom: 1,
          pageTo: 1,
          text: 'Disposed.',
          score: 0.5,
        },
      ],
    },
  ],
  counts: { lexical: 2, vector: 2, fused: 3, reranked: true },
  costPaise: 0,
  answer: null,
  answerFailed: false,
  usage: { used: 1, limit: 30 },
  ...over,
});

function setup(first: AuthoritySearchResult, next?: AuthoritySearchResult) {
  const search = vi.fn(() => Promise.resolve({ ok: true as const, data: first }));
  const rerun = vi.fn(() => Promise.resolve({ ok: true as const, data: next ?? first }));
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en}>
      <AuthoritySearch
        workspaceId={WS}
        initialQuery="surgery without consent"
        subjectAreas={['medical_negligence', 'bail']}
        actions={{ search, rerun }}
      />
    </NextIntlClientProvider>,
  );
  return { search, rerun };
}

const chipsList = (): HTMLElement =>
  document.querySelector('[data-slot="authority-chips"]') as HTMLElement;

/** A button that is enabled again once the transition that rendered the results has settled. */
const enabled = async (name: string): Promise<HTMLElement> => {
  const button = await screen.findByRole('button', { name });
  await waitFor(() => {
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
  return button;
};

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Search' }));

describe('AuthoritySearch', () => {
  it('shows the plan as chips and the results with every field', async () => {
    const { search } = setup(result());
    submit();
    await screen.findByText('Meera Rao v. Sunrise Nursing Home');
    expect(search).toHaveBeenCalledWith({ workspaceId: WS, query: 'surgery without consent' });
    expect(within(chipsList()).getByText('Medical negligence')).toBeTruthy();
    expect(
      screen.getByText(/Bharatiya Nyaya Sanhita s\. 106 \(also Indian Penal Code s\. 304A\)/),
    ).toBeTruthy();
    expect(screen.getByText('Court level: High Court')).toBeTruthy();
    expect(screen.getByText(/2019:MHC:1234 · MHC · High Court · Decided/)).toBeTruthy();
    expect(screen.getByText(/Outcome: Allowed · Cited by 3 judgments in the corpus/)).toBeTruthy();
    expect(screen.getByText('Facts · p. 2')).toBeTruthy();
    expect(screen.getByText('Reasoning · pp. 3 to 4')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Open court PDF' });
    expect(link.getAttribute('href')).toBe('https://court.example/j1.pdf#page=2');
    expect(link.getAttribute('rel')).toBe('noreferrer noopener');
    expect(screen.getByText('Title withheld')).toBeTruthy();
    expect(screen.getByText('1 of 30 searches used this month')).toBeTruthy();
  });

  it('editing a chip searches again with the edited plan and does not plan again', async () => {
    const edited = result({ plan: { ...plan, subjectAreas: [] } });
    const { search, rerun } = setup(result(), edited);
    submit();
    await screen.findByText('Meera Rao v. Sunrise Nursing Home');
    fireEvent.click(await enabled('Remove filter: Medical negligence'));
    await waitFor(() => {
      expect(rerun).toHaveBeenCalledWith({
        workspaceId: WS,
        plan: { ...plan, subjectAreas: [] },
      });
    });
    expect(search).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(within(chipsList()).queryByText('Medical negligence')).toBeNull();
    });
  });

  it('adds a statute filter through the same re-run', async () => {
    const { rerun } = setup(result());
    submit();
    await screen.findByText('Meera Rao v. Sunrise Nursing Home');
    fireEvent.click(screen.getByText('Add a filter'));
    fireEvent.change(screen.getByLabelText('Statute (for example IPC)'), {
      target: { value: 'NDPS' },
    });
    fireEvent.change(screen.getByLabelText('Section'), { target: { value: '37' } });
    await waitFor(() => {
      expect(
        (screen.getAllByRole('button', { name: 'Add' })[0] as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0] as HTMLElement);
    await waitFor(() => {
      expect(rerun).toHaveBeenCalledTimes(1);
    });
    const [call] = rerun.mock.calls[0] as unknown as [{ plan: typeof plan }];
    expect(call.plan.statutes).toEqual([...plan.statutes, { statute: 'NDPS', section: '37' }]);
  });

  it('shows an answer with unsupported claims marked and never verified', async () => {
    const answered = result({
      answer: {
        noAuthority: false,
        claims: [
          {
            statement: 'No consent',
            segmentId: 's1',
            judgmentId: 'j1',
            quote: 'No written consent',
            verified: true,
          },
          {
            statement: 'Invented',
            segmentId: 's1',
            judgmentId: 'j1',
            quote: 'paid Rs 5 lakh',
            verified: false,
          },
        ],
      },
    });
    const { rerun } = setup(result(), answered);
    submit();
    await screen.findByText('Meera Rao v. Sunrise Nursing Home');
    fireEvent.click(await enabled('Summarise with sources'));
    const box = await screen.findByText('Summary with sources');
    expect(rerun).toHaveBeenCalledWith({ workspaceId: WS, plan, answer: true });
    const scope = within(box.closest('[data-slot="authority-answer"]') as HTMLElement);
    expect(scope.getAllByText('Quote verified')).toHaveLength(1);
    expect(scope.getByText('Unsupported: the quote was not found in the passage')).toBeTruthy();
  });

  it('no hits is "no matching authority found", with no summary button', async () => {
    setup(result({ hits: [] }));
    submit();
    await screen.findByText(/No matching authority found/);
    expect(screen.queryByRole('button', { name: 'Summarise with sources' })).toBeNull();
  });

  it('shows the server message when the search is refused', async () => {
    const search = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        error: { message: "You have reached this month's limit of 30 authority searches." },
      }),
    );
    render(
      <NextIntlClientProvider locale="en" messages={catalogs.en}>
        <AuthoritySearch
          workspaceId={WS}
          initialQuery="surgery"
          subjectAreas={[]}
          actions={{ search, rerun: search }}
        />
      </NextIntlClientProvider>,
    );
    submit();
    expect((await screen.findByRole('alert')).textContent).toContain('limit of 30');
  });
});

describe('FindAuthoritiesButton', () => {
  const renderButton = (
    action: (raw: unknown) => Promise<{ ok: true; data: { query: string } } | { ok: false }>,
  ) =>
    render(
      <NextIntlClientProvider locale="en" messages={catalogs.en}>
        <FindAuthoritiesButton
          workspaceId={WS}
          workspaceSlug="chambers"
          matterId="m1"
          action={action}
        />
      </NextIntlClientProvider>,
    );

  it('opens the search page seeded with the matter facts and runs nothing', async () => {
    const action = vi.fn(() =>
      Promise.resolve({ ok: true as const, data: { query: 'indian penal code section 304A' } }),
    );
    renderButton(action);
    fireEvent.click(screen.getByRole('button', { name: 'Find authorities' }));
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(
        '/w/chambers/research?q=indian%20penal%20code%20section%20304A',
      );
    });
    expect(action).toHaveBeenCalledWith({ workspaceId: WS, matterId: 'm1' });
  });

  it('says so when the matter could not be read', async () => {
    renderButton(() => Promise.resolve({ ok: false as const }));
    fireEvent.click(screen.getByRole('button', { name: 'Find authorities' }));
    expect((await screen.findByRole('alert')).textContent).toContain('could not be prepared');
  });
});
