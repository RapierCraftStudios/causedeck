// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithIntl } from '../../shell/__tests__/helpers.tsx';
import { BenchNoticeAlerts, type BenchNoticeAlertView } from '../bench-notice-alerts.tsx';

afterEach(cleanup);

function alert(overrides: Partial<BenchNoticeAlertView> = {}): BenchNoticeAlertView {
  return {
    noticeId: 'n-1',
    title: 'Special bench for W.P. matters',
    url: 'https://mhc.example.test/notices/special-bench.pdf',
    kind: 'circular',
    type: 'special_bench',
    sourceName: 'Madras High Court',
    matterId: 'm-1',
    matterTitle: 'Rao v State',
    listDates: ['2026-11-05', '2026-11-06'],
    ...overrides,
  };
}

describe('BenchNoticeAlerts (#496)', () => {
  it('renders nothing when there is no alert', () => {
    const { container } = renderWithIntl(<BenchNoticeAlerts alerts={[]} />);
    expect(container.querySelector('[data-slot="bench-notice-alerts"]')).toBeNull();
  });

  it('shows the change, dates, source and the official notice as an external link', () => {
    const { container } = renderWithIntl(<BenchNoticeAlerts alerts={[alert()]} slug="demo" />);
    const row = container.querySelector('[data-bench-alert="n-1:m-1"]');
    expect(row?.textContent).toContain('Special bench');
    expect(row?.textContent).toContain('Special bench for W.P. matters');
    expect(row?.textContent).toContain('2026-11-05, 2026-11-06');
    expect(row?.querySelector('[data-provenance="source"]')?.textContent).toBe(
      'Source: Madras High Court',
    );
    expect(screen.getByRole('link', { name: 'Rao v State' }).getAttribute('href')).toBe(
      '/w/demo/matters/m-1',
    );
    const link = screen.getByRole('link', { name: /Open the official notice/ });
    expect(link.getAttribute('href')).toBe('https://mhc.example.test/notices/special-bench.pdf');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('leaves the matter title out without a slug and never links a non-http(s) URL', () => {
    renderWithIntl(<BenchNoticeAlerts alerts={[alert({ url: 'javascript:alert(1)' })]} />);
    expect(screen.queryByText('Rao v State')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
