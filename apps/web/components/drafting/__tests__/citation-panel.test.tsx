// @vitest-environment jsdom
// The Citations panel (#1137): why each non-verified citation is not verified, the corpus link
// (`#page=` when the pinpoint page is known), and the open count covering every non-verified
// citation nobody acknowledged.
import en from '@causedeck/i18n/messages/en.json';
import { CITATION_REASONS } from '@causedeck/validators/citation';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../shell/__tests__/helpers.tsx';
import { CitationPanel, openCitationIds, type CitationView } from '../citation-panel.tsx';

afterEach(cleanup);

const reasons = en.drafting.checks.citations.reason as Record<string, string>;

function view(over: Partial<CitationView> & Pick<CitationView, 'id' | 'status'>): CitationView {
  return { blockId: 'b1', raw: `2023 INSC ${over.id}`, acknowledged: false, ...over };
}

function renderPanel(citations: CitationView[], onAcknowledge = vi.fn()) {
  renderWithIntl(
    <CitationPanel
      citations={citations}
      onCheck={vi.fn()}
      onJump={vi.fn()}
      onAcknowledge={onAcknowledge}
    />,
  );
}

function reasonOf(id: string): string | null {
  return (
    document.querySelector(`[data-citation-id="${id}"] [data-slot="citation-reason"]`)
      ?.textContent ?? null
  );
}

describe('openCitationIds', () => {
  it('lists every non-verified citation nobody acknowledged', () => {
    expect(
      openCitationIds([
        view({ id: 'v', status: 'verified' }),
        view({ id: 'n', status: 'not_found' }),
        view({ id: 'u', status: 'unknown', reason: 'pinpoint_not_found' }),
        view({ id: 'a', status: 'unknown', acknowledged: true }),
      ]),
    ).toEqual(['n', 'u']);
    expect(openCitationIds([])).toEqual([]);
  });
});

describe('CitationPanel', () => {
  it.each(CITATION_REASONS)('shows the %s reason', (reason) => {
    renderPanel([view({ id: '1', status: 'unknown', reason })]);
    expect(reasonOf('1')).toBe(reasons[reason]);
    expect(reasons[reason]).toBeTruthy();
  });

  it('calls a not-found citation without a reason unresolved, an unknown one unknown', () => {
    renderPanel([
      view({ id: '1', status: 'not_found' }),
      view({ id: '2', status: 'unknown' }),
      view({ id: '3', status: 'verified' }),
    ]);
    expect(reasonOf('1')).toBe(reasons.unresolved);
    expect(reasonOf('2')).toBe(reasons.unknown);
    expect(reasonOf('3')).toBeNull();
  });

  it('links the corpus source at the pinpoint page, plain without one, not at all without a source', () => {
    renderPanel([
      view({ id: '1', status: 'unknown', sourceUrl: 'https://corpus.example/a.pdf', page: 7 }),
      view({ id: '2', status: 'verified', sourceUrl: 'https://corpus.example/b.pdf' }),
      view({ id: '3', status: 'not_found' }),
    ]);
    const links = screen.getAllByRole('link', { name: en.drafting.checks.citations.openSource });
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://corpus.example/a.pdf#page=7',
      'https://corpus.example/b.pdf',
    ]);
    expect(links[0]?.getAttribute('rel')).toBe('noreferrer noopener');
    expect(links[0]?.getAttribute('target')).toBe('_blank');
    expect(document.querySelector('[data-citation-id="3"] a')).toBeNull();
  });

  it('counts unknown and not-found citations as blocking, not verified or acknowledged ones', () => {
    const onAcknowledge = vi.fn();
    renderPanel(
      [
        view({ id: '1', status: 'not_found' }),
        view({ id: '2', status: 'unknown', reason: 'quote_not_found' }),
        view({ id: '3', status: 'verified' }),
        view({ id: '4', status: 'unknown', acknowledged: true }),
      ],
      onAcknowledge,
    );
    expect(screen.getByRole('status').textContent).toContain('2 citations are not verified');
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge unverified citations' }));
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('offers the acknowledgement for an unknown citation on its own (#1136)', () => {
    renderPanel([view({ id: '1', status: 'verified' }), view({ id: '2', status: 'unknown' })]);
    expect(screen.getByRole('button', { name: 'Acknowledge unverified citations' })).toBeTruthy();
  });

  it('does not block when only verified and acknowledged citations remain', () => {
    renderPanel([
      view({ id: '1', status: 'verified' }),
      view({ id: '2', status: 'unknown', acknowledged: true }),
    ]);
    expect(screen.queryByRole('button', { name: 'Acknowledge unverified citations' })).toBeNull();
  });
});
