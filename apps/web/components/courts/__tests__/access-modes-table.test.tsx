// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithIntl } from '../../shell/__tests__/helpers.tsx';
import { AccessModesTable, resourceKey } from '../access-modes-table.tsx';

import { forumDetail } from './fixtures.ts';

afterEach(cleanup);

describe('AccessModesTable (#400)', () => {
  it('is a table of resource, mode and counsel note', () => {
    renderWithIntl(<AccessModesTable modes={forumDetail().accessModes} />);
    const table = screen.getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Resource', 'Mode', 'Counsel note']);
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((th) => th.textContent),
    ).toEqual(['Case status', 'Court-sanctioned updates']);
  });

  it('explains user_supplied and shows the counsel note', () => {
    const { container } = renderWithIntl(<AccessModesTable modes={forumDetail().accessModes} />);
    const row = container.querySelector('[data-access-resource="case-status"]');
    expect(row?.querySelector('[data-access-help]')?.textContent).toBe(
      'Share the list or forward the court email',
    );
    expect(row?.textContent).toContain('The lawyer shares the list; nothing is fetched.');
    expect(row?.querySelector('[data-legal-review-pending]')).toBeNull();
  });

  it('tags a row without a counsel note "Legal review pending"', () => {
    const { container } = renderWithIntl(<AccessModesTable modes={forumDetail().accessModes} />);
    const row = container.querySelector('[data-access-resource="sanctioned-push"]');
    expect(row?.querySelector('[data-legal-review-pending]')?.textContent).toBe(
      'Legal review pending',
    );
    expect(row?.querySelector('[data-access-mode="official"]')?.textContent).toBe('Official feed');
    expect(row?.querySelector('[data-access-help]')).toBeNull();
  });

  it('shows an unknown resource as stored, and a note with none', () => {
    renderWithIntl(
      <AccessModesTable
        modes={[
          {
            resource: 'judgments',
            mode: 'none',
            enabled: false,
            counselNote: null,
            legalReviewPending: true,
          },
        ]}
      />,
    );
    expect(screen.getByRole('rowheader').textContent).toBe('judgments');
    cleanup();
    const { container } = renderWithIntl(<AccessModesTable modes={[]} />);
    expect(container.querySelector('[data-access-modes-empty]')).not.toBeNull();
    expect(resourceKey('Cause-List')).toBe('cause_list');
  });
});
