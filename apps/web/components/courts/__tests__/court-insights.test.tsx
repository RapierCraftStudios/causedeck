// @vitest-environment jsdom
// Court insights (#512): the figures, `Not enough data` for a withheld figure, and the data window
// and coverage statements the page must always show.
import type { CourtInsights, InsightCell } from '@causedeck/intelligence';
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

const { renderWithIntl } = await import('../../shell/__tests__/helpers.tsx');
const { CourtInsightsView } = await import('../court-insights.tsx');

afterEach(cleanup);

const withheld = { value: null, n: null };

const cell = (over: Partial<InsightCell> = {}): InsightCell => ({
  forumId: 'f1',
  caseTypeCode: 'WP',
  stage: 'admission',
  period: '2026',
  listingDelayDays: { value: 12, n: 9 },
  adjournmentRate: { value: 0.4, n: 9 },
  disposalDays: { value: 180, n: 6 },
  backlog: { value: 7, n: 7 },
  suppressed: false,
  ...over,
});

const insights = (cells: InsightCell[]): CourtInsights => ({
  window: { from: '2021-01-01', to: '2026-10-24' },
  minCell: 5,
  coverage: { proceedings: 21, hearings: 33 },
  forums: [{ id: 'f1', code: 'in.tn.madras-hc', court: 'Madras High Court' }],
  cells,
});

const filters = { forumId: '', caseType: '' };

describe('CourtInsightsView (#512)', () => {
  it('shows median listing delay, adjournment rate and time to disposal with window and coverage', () => {
    renderWithIntl(<CourtInsightsView insights={insights([cell()])} filters={filters} />);
    const row = screen.getByRole('row', { name: /Madras High Court/ });
    expect(within(row).getByText('12 days')).toBeTruthy();
    expect(within(row).getByText('40%')).toBeTruthy();
    expect(within(row).getByText('180 days')).toBeTruthy();
    expect(screen.getByText('Data window: 2021-01-01 to 2026-10-24.')).toBeTruthy();
    expect(screen.getByText(/21 matters and 33 hearings in this workspace/)).toBeTruthy();
    expect(screen.getByText(/fewer than 5 observations are withheld/)).toBeTruthy();
  });

  it('reads a withheld figure as not enough data and hides fully withheld cells', () => {
    const partial = cell({ disposalDays: withheld });
    const hidden = cell({
      caseTypeCode: 'CRP',
      listingDelayDays: withheld,
      adjournmentRate: withheld,
      disposalDays: withheld,
      backlog: withheld,
      suppressed: true,
    });
    renderWithIntl(<CourtInsightsView insights={insights([partial, hidden])} filters={filters} />);
    expect(screen.getAllByText('Not enough data')).toHaveLength(1);
    expect(screen.queryByText('CRP')).toBeNull();
  });

  it('has no judge or bench control', () => {
    renderWithIntl(<CourtInsightsView insights={insights([cell()])} filters={filters} />);
    expect(screen.queryByLabelText(/judge|bench/i)).toBeNull();
  });
});
