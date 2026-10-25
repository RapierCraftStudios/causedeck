// @vitest-environment jsdom
// Portfolio screens (#666): summary, case table (next date, stage, adverse order), the alert
// switches through the preference action, and the import report.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../shell/__tests__/helpers.tsx';
import {
  PortfolioAlertSettings,
  PortfolioCaseTable,
  PortfolioSummaryCards,
  type PortfolioAlertCell,
} from '../portfolio-view.tsx';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

afterEach(cleanup);

describe('portfolio view (#666)', () => {
  it('shows the summary counts', () => {
    renderWithIntl(
      <PortfolioSummaryCards
        summary={{
          total: 7,
          byStage: [{ stage: 'Evidence', count: 7 }],
          withAdverseOrder: 2,
          upcoming: 3,
          overdue: 1,
        }}
      />,
    );
    expect(document.querySelector('[data-summary="total"] dd')?.textContent).toBe('7');
    expect(document.querySelector('[data-summary="overdue"] dd')?.textContent).toBe('1');
    expect(document.querySelector('[data-summary="adverse"] dd')?.textContent).toBe('2');
  });

  it('lists next date, stage and adverse order, with a dash for an unpolled case', () => {
    renderWithIntl(
      <PortfolioCaseTable
        cases={[
          {
            id: 'c1',
            cnr: 'MHAU019999992026',
            caseNumber: null,
            stage: 'Evidence',
            nextDate: '2026-11-05',
            lastAdverseOrderAt: '2026-10-01T00:00:00.000Z',
            lastAdverseOrderRef: null,
          },
          {
            id: 'c2',
            cnr: null,
            caseNumber: 'WP/1/2026',
            stage: null,
            nextDate: null,
            lastAdverseOrderAt: null,
            lastAdverseOrderRef: null,
          },
        ]}
      />,
    );
    const rows = document.querySelectorAll('[data-case-id]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('2026-11-05');
    expect(rows[0]?.textContent).toContain('Evidence');
    expect(rows[0]?.querySelector('[data-adverse]')).not.toBeNull();
    expect(rows[1]?.textContent).toContain('WP/1/2026');
    expect(rows[1]?.querySelector('[data-adverse]')).toBeNull();
  });

  it('shows the empty line without cases', () => {
    renderWithIntl(<PortfolioCaseTable cases={[]} />);
    expect(document.querySelector('[data-portfolio-cases-empty]')).not.toBeNull();
  });

  it('toggles an alert channel through the preference action and rolls back on failure', async () => {
    const cells: PortfolioAlertCell[] = [
      { category: 'portfolio.adverse_order', channel: 'email', enabled: true, locked: false },
    ];
    const setPreference = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { code: 'FORBIDDEN', message: 'no' } });
    renderWithIntl(
      <PortfolioAlertSettings workspaceId="w1" cells={cells} setPreference={setPreference} />,
    );
    const toggle = screen.getByRole('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(setPreference).toHaveBeenCalledWith({
        workspaceId: 'w1',
        category: 'portfolio.adverse_order',
        channel: 'email',
        enabled: false,
      });
    });
    await waitFor(() => {
      expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    });
  });
});
