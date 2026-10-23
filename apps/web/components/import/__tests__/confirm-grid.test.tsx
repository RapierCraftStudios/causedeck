// @vitest-environment jsdom
// The confirm grid (#551): one row per matter sorted by next date, a conflict blocks the confirm
// until a date is picked, keyboard shortcuts, merge/rename in place, the issues panel with the
// recovery copy, and the first output after confirming.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConfirmInput } from '../../../lib/import/plan-edit.ts';

import { PLAN } from './fixtures.ts';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { catalogs } = await import('../../../__tests__/helpers/intl.ts');
const { renderWithIntl, mockMatchMedia, stubResizeObserver } =
  await import('../../shell/__tests__/helpers.tsx');
const { ConfirmGrid } = await import('../confirm-grid.tsx');

const en = catalogs.en.bootstrapImport;

const APPLIED = {
  ok: true as const,
  data: {
    batchId: 'b',
    planHash: 'h',
    rootActivityId: 'r',
    created: { matters: 2, proceedings: 3, hearings: 1, documents: 0 },
    duplicates: 0,
    excluded: 0,
    unresolvedProceedingKeys: [],
  },
};

function setup(over: Partial<React.ComponentProps<typeof ConfirmGrid>> = {}) {
  mockMatchMedia();
  stubResizeObserver();
  Element.prototype.scrollIntoView = vi.fn();
  const onConfirm = vi.fn<(input: ConfirmInput) => Promise<typeof APPLIED>>(() =>
    Promise.resolve(APPLIED),
  );
  const props = {
    plan: PLAN,
    courtDayHref: '/w/x/today',
    onConfirm,
    onUndo: vi.fn(() => Promise.resolve({ ok: true as const, data: null })),
    onAddIdentifiers: vi.fn(),
    onRetryFile: vi.fn(),
    onKeepFile: vi.fn(),
    ...over,
  };
  renderWithIntl(<ConfirmGrid {...props} />);
  return { onConfirm, props };
}

const rowTitles = () =>
  screen
    .getAllByRole('listitem')
    .filter((li) => li.dataset['slot'] === 'matter-row')
    .map((li) => within(li).getByLabelText<HTMLInputElement>(en.grid.title).value);

afterEach(() => {
  cleanup();
});

describe('ConfirmGrid', () => {
  it('lists one row per matter sorted by next date', () => {
    setup();
    expect(rowTitles()).toEqual(['Early v State', 'Late v State', 'Clash v State']);
  });

  it('blocks the confirm until the conflicting date is picked', () => {
    const { onConfirm } = setup();
    const confirm = screen.getByRole<HTMLButtonElement>('button', { name: /Confirm 3 matters/ });
    expect(confirm.disabled).toBe(true);
    expect(screen.getByText(en.blockedNote)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Use .*17/ }));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ dirty: false, excluded: [], resolvedDates: { '2': '2026-11-17' } }),
    );
  });

  it('a left-out conflicting matter does not block the rest', () => {
    setup();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Clash v State' }));
    const confirm = screen.getByRole<HTMLButtonElement>('button', { name: /Confirm 2 matters/ });
    expect(confirm.disabled).toBe(false);
  });

  it('Space leaves the active row out and Cmd+Enter confirms', () => {
    const { onConfirm } = setup();
    const row = screen.getByRole('checkbox', { name: 'Include Clash v State' });
    fireEvent.click(row.closest('li') as HTMLElement);
    fireEvent.keyDown(row.closest('li') as HTMLElement, { key: ' ' });
    expect(row.getAttribute('data-state')).toBe('unchecked');
    fireEvent.keyDown(row.closest('li') as HTMLElement, { key: 'Enter', metaKey: true });
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ excluded: [['2', '3'].join('\n')] }),
    );
  });

  it('m merges the active row into the next one and the grouping is sent dirty', () => {
    const { onConfirm } = setup();
    const early = screen.getByDisplayValue('Early v State').closest('li') as HTMLElement;
    fireEvent.click(early);
    fireEvent.keyDown(early, { key: 'm' });
    expect(rowTitles()).toEqual(['Late v State', 'Clash v State']);
    fireEvent.click(screen.getByRole('button', { name: /Use .*17/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm 2 matters/ }));
    const input = onConfirm.mock.calls[0]?.[0];
    expect(input?.dirty).toBe(true);
    expect(input?.groups.find((g) => g.tempId === 'm_late')?.proceedingKeys).toEqual(['1', '4']);
  });

  it('renames inline', () => {
    setup();
    const input = screen.getByDisplayValue('Late v State');
    fireEvent.change(input, { target: { value: 'Renamed v State' } });
    fireEvent.blur(input);
    expect(rowTitles()).toContain('Renamed v State');
  });

  it('? opens the shortcuts', async () => {
    setup();
    fireEvent.keyDown(screen.getByRole('list', { name: en.grid.label }), { key: '?' });
    await waitFor(() => {
      expect(screen.getByText(en.shortcuts.confirm)).toBeTruthy();
    });
  });

  it('lists the issues with the recovery copy and one action each', () => {
    const { props } = setup({
      fileIssues: [
        { kind: 'missing_identifiers' },
        { kind: 'unreadable_file', fileId: 'f1', name: 'scan.jpg' },
        { kind: 'a0_only', fileId: 'f2', name: 'list.pdf' },
      ],
    });
    const panel = screen.getByRole('region', { name: en.issues.title });
    expect(within(panel).getByText(en.issues.unreadableCopy)).toBeTruthy();
    expect(within(panel).getAllByRole('listitem').length).toBeGreaterThanOrEqual(5);
    fireEvent.click(within(panel).getByRole('button', { name: en.issues.addIdentifiers }));
    fireEvent.click(within(panel).getByRole('button', { name: en.issues.retry }));
    expect(props.onAddIdentifiers).toHaveBeenCalled();
    expect(props.onRetryFile).toHaveBeenCalledWith('f1');
  });

  it('after confirming, offers the first court-day view', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Use .*17/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm 3 matters/ }));
    expect((await screen.findByRole('link', { name: en.result.next })).getAttribute('href')).toBe(
      '/w/x/today',
    );
  });
});
