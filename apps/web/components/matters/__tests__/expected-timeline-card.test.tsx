// @vitest-environment jsdom
// Expected timeline card (#655): figures with their observation counts, and `Not enough data` for a
// withheld figure.
import type { ExpectedTimeline, MatterExpectedTimeline } from '@causedeck/intelligence';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

const { renderWithIntl } = await import('../../shell/__tests__/helpers.tsx');
const { ExpectedTimelineCard } = await import('../expected-timeline-card.tsx');

afterEach(cleanup);

const row = (over: Partial<ExpectedTimeline> = {}): ExpectedTimeline => ({
  forumId: 'f1',
  caseTypeCode: 'WP',
  stage: 'admission',
  byStage: true,
  listingDelayDays: { value: 12, n: 9 },
  disposalDays: { value: 180, n: 6 },
  withheld: false,
  ...over,
});

const timeline = (timelines: ExpectedTimeline[]): MatterExpectedTimeline => ({
  minCell: 5,
  forums: [{ id: 'f1', court: 'Madras High Court' }],
  timelines,
});

describe('ExpectedTimelineCard (#655)', () => {
  it('shows the medians with their observation counts', () => {
    renderWithIntl(<ExpectedTimelineCard timeline={timeline([row()])} />);
    expect(screen.getByText('Madras High Court, WP')).toBeTruthy();
    expect(screen.getByText(/12 days/)).toBeTruthy();
    expect(screen.getByText(/180 days/)).toBeTruthy();
    expect(screen.getByText('(Based on 9 matters)')).toBeTruthy();
    expect(screen.getByText(/fewer than 5 matters are withheld/)).toBeTruthy();
  });

  it('reads a withheld figure as not enough data', () => {
    const withheld = { value: null, n: null };
    renderWithIntl(
      <ExpectedTimelineCard
        timeline={timeline([
          row({ listingDelayDays: withheld, disposalDays: withheld, withheld: true }),
        ])}
      />,
    );
    expect(screen.getAllByText('Not enough data')).toHaveLength(2);
    expect(screen.queryByText(/days/)).toBeNull();
  });

  it('renders nothing for a matter without proceedings', () => {
    const { container } = renderWithIntl(<ExpectedTimelineCard timeline={timeline([])} />);
    expect(container.querySelector('[data-slot="matter-expected-timeline"]')).toBeNull();
  });
});
