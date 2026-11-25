// @vitest-environment jsdom
// Statute section view (#1126): the text with its synthetic or public-domain label, the last text of
// a repealed section, the history with validity ranges, the counterpart link or "no counterpart
// recorded", and each authority linking the court PDF at the cited page with masked titles only.
import type {
  SectionAuthority,
  SectionHistoryView,
  SectionVersionView,
  SectionView as SectionViewData,
} from '@causedeck/core/statutes';
import { cleanup, configure, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';

import { SectionView, statutePath } from '../components/research/section-view.tsx';

import { catalogs } from './helpers/intl.ts';

configure({ asyncUtilTimeout: 8000 });
afterEach(cleanup);

const BNSS = 'bharatiya nagarik suraksha sanhita';
const CRPC = 'code of criminal procedure';

const act = (key: string, shortName: string) => ({
  key,
  title: `The ${shortName}`,
  shortName,
  sourceNote: 'Gazette facts',
  synthetic: false,
});

const synthetic: SectionVersionView = {
  text: 'SYNTHETIC: the High Court may direct release on bail.',
  validFrom: '2024-07-01',
  validTo: null,
  amendedBy: null,
  sourceNote: 'A paraphrase written for the demo.',
  synthetic: true,
};

const bnss483: SectionViewData = {
  act: act(BNSS, 'BNSS'),
  section: '483',
  heading: 'Special powers of High Court or Court of Session regarding bail',
  version: synthetic,
  counterpart: {
    kind: 'recorded',
    statute: BNSS,
    section: '483',
    counterparts: [{ statute: CRPC, section: '439', inForce: null }],
    codeInForce: null,
  },
};

const history = (versions: SectionVersionView[]): SectionHistoryView => ({
  statute: BNSS,
  act: act(BNSS, 'BNSS'),
  section: '483',
  heading: bnss483.heading,
  versions,
});

const authority: SectionAuthority = {
  judgmentId: '00000000-0000-4000-8000-0000000000j1',
  title: null,
  titleMasked: true,
  neutralCitation: '2025:MHC:101',
  court: 'MHC',
  courtLevel: 'high_court',
  judgmentDate: '2025-02-03',
  page: 4,
  sourceUrl: 'https://court.example/j1.pdf',
  citedStatute: CRPC,
  citedSection: '439',
  citedByCount: 0,
};

function view(props: Partial<Parameters<typeof SectionView>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      <SectionView
        slug="chennai-solo"
        section={bnss483}
        history={history([synthetic])}
        authorities={[authority]}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

const slot = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLElement>(`[data-slot="${name}"]`);

describe('SectionView (#1126)', () => {
  it('shows the seeded text with the synthetic label and its source note', () => {
    const { container } = view();
    expect(slot(container, 'section-text')?.textContent).toBe(synthetic.text);
    const label = slot(container, 'section-label')?.textContent ?? '';
    expect(label).toContain('Synthetic paraphrase, not the bare-act wording');
    expect(label).toContain('A paraphrase written for the demo.');
    expect(screen.getByText('In force from 2024-07-01')).toBeTruthy();
  });

  it('labels a public-domain text as such', () => {
    const bare = { ...synthetic, synthetic: false, sourceNote: 'Bare act, India Code' };
    const { container } = view({ section: { ...bnss483, version: bare } });
    const label = slot(container, 'section-label')?.textContent ?? '';
    expect(label).toContain('Public-domain bare act text');
    expect(label).not.toContain('Synthetic');
  });

  it('shows the last text of a repealed section, marked as not in force', () => {
    const old: SectionVersionView = {
      ...synthetic,
      validFrom: '1974-04-01',
      validTo: '2024-07-01',
    };
    const { container } = view({ section: { ...bnss483, version: null }, history: history([old]) });
    expect(slot(container, 'section-text')?.textContent).toBe(old.text);
    expect(slot(container, 'section-repealed')?.textContent).toContain(
      'Not in force since 2024-07-01',
    );
  });

  it('lists every version with its validity range, oldest first', () => {
    const first: SectionVersionView = {
      ...synthetic,
      validFrom: '1870-01-01',
      validTo: '1956-01-01',
      amendedBy: 'Act 26 of 1955',
    };
    const { container } = view({ history: history([first, synthetic]) });
    const items = within(slot(container, 'section-history') as HTMLElement).getAllByRole(
      'listitem',
    );
    expect(items.map((li) => li.textContent)).toEqual([
      '1870-01-01 to 1956-01-01Amended by Act 26 of 1955',
      '2024-07-01 to date',
    ]);
  });

  it('links the CODE_MAP counterpart, or says none is recorded', () => {
    const { container } = view();
    const link = within(slot(container, 'section-counterpart') as HTMLElement).getByRole('link');
    expect(link.getAttribute('href')).toBe(
      '/w/chennai-solo/research/statutes/code%20of%20criminal%20procedure/439',
    );
    expect(link.textContent).toBe('Code Of Criminal Procedure s. 439');
    cleanup();
    const none = view({
      section: {
        ...bnss483,
        counterpart: {
          kind: 'none',
          statute: BNSS,
          section: '483',
          reason: 'no counterpart recorded',
        },
      },
    });
    expect(slot(none.container, 'section-counterpart')).toBeNull();
    expect(slot(none.container, 'section-no-counterpart')?.textContent).toBe(
      'No counterpart recorded.',
    );
  });

  it('links each authority to the court PDF at the cited page, title withheld when masked', () => {
    const { container } = view();
    const card = slot(container, 'section-authority') as HTMLElement;
    expect(within(card).getByRole('heading').textContent).toBe('Title withheld');
    expect(card.textContent).toContain(
      '2025:MHC:101 · MHC · High Court · Decided 2025-02-03 · p. 4',
    );
    const link = within(card).getByRole('link');
    // #1191: the in-app reader at the cited page, same tab.
    expect(link.getAttribute('href')).toBe(
      '/w/chennai-solo/research/judgments/00000000-0000-4000-8000-0000000000j1?page=4#cited',
    );
    expect(link.getAttribute('target')).toBeNull();
  });

  it('links the reader even without a source URL, and an empty state without authorities', () => {
    const { container } = view({ authorities: [{ ...authority, sourceUrl: null }] });
    expect(
      within(slot(container, 'section-authority') as HTMLElement)
        .getByRole('link')
        .getAttribute('href'),
    ).toMatch(/^\/w\/chennai-solo\/research\/judgments\//);
    cleanup();
    const empty = view({ authorities: [] });
    expect(slot(empty.container, 'section-authorities-empty')?.textContent).toBe(
      'No judgment in the corpus cites this section yet.',
    );
  });

  it('builds statute paths with encoded segments', () => {
    expect(statutePath('w1', 'bnss', '483')).toBe('/w/w1/research/statutes/bnss/483');
  });
});
