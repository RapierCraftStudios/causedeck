// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MATTER_COLUMNS, MATTER_ROWS, matterRows, type MatterRow } from '../__fixtures__/data';
import {
  createDataTableColumnHelper,
  DataTable,
  DEFAULT_DATA_TABLE_LABELS,
  type DataTableProps,
} from './data-table';

// Radix menus measure their content; jsdom has no ResizeObserver.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

const col = createDataTableColumnHelper<MatterRow>();
const columns = col.columns([
  col.accessor('title', { header: MATTER_COLUMNS.title }),
  col.accessor('court', { header: MATTER_COLUMNS.court }),
  col.accessor('feeDue', { header: MATTER_COLUMNS.feeDue, meta: { align: 'end' } }),
]);

type Props = Partial<DataTableProps<MatterRow>>;

function renderTable(props: Props = {}) {
  return render(
    <DataTable
      label="Matters"
      columns={columns}
      data={MATTER_ROWS}
      getRowId={(row) => row.id}
      getRowLabel={(row) => row.title}
      {...props}
    />,
  );
}

const bodyRows = () =>
  screen.getAllByRole('row').filter((row) => row.hasAttribute('data-row-index'));

/** Pretend the viewport is a phone (or not) for `useMediaQuery`. */
function mockMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

describe('DataTable', () => {
  it('renders a named table with every row', () => {
    renderTable();
    expect(screen.getByRole('table', { name: 'Matters' })).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(MATTER_ROWS.length);
  });

  it('sorts when a header is clicked and reflects it in aria-sort', async () => {
    const onSortingChange = vi.fn();
    renderTable({ onSortingChange });
    const header = screen.getByRole('columnheader', { name: MATTER_COLUMNS.feeDue });
    expect(header).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(within(header).getByRole('button'));
    const sortedOnce = header.getAttribute('aria-sort');
    expect(sortedOnce === 'ascending' || sortedOnce === 'descending').toBe(true);
    const fees = () => bodyRows().map((row) => Number(row.lastElementChild?.textContent));
    const expected = [...MATTER_ROWS.map((row) => row.feeDue)].sort((a, b) => a - b);
    expect(fees()).toEqual(sortedOnce === 'ascending' ? expected : [...expected].reverse());
    await userEvent.click(within(header).getByRole('button'));
    expect(header.getAttribute('aria-sort')).not.toBe(sortedOnce);
    expect(onSortingChange).toHaveBeenCalledTimes(2);
  });

  it('hides a column from the column menu', async () => {
    renderTable({ enableColumnVisibility: true });
    expect(screen.getByRole('columnheader', { name: MATTER_COLUMNS.court })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: DEFAULT_DATA_TABLE_LABELS.columns }));
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: MATTER_COLUMNS.court }));
    expect(screen.queryByRole('columnheader', { name: MATTER_COLUMNS.court })).toBeNull();
  });

  it('honours controlled column visibility', () => {
    renderTable({ columnVisibility: { court: false } });
    expect(screen.queryByRole('columnheader', { name: MATTER_COLUMNS.court })).toBeNull();
  });

  it('Space toggles the focused row and arrows move focus', async () => {
    const onRowSelectionChange = vi.fn();
    renderTable({ enableRowSelection: true, onRowSelectionChange });
    const grid = screen.getByRole('grid', { name: 'Matters' });
    expect(grid).toHaveAttribute('aria-multiselectable', 'true');
    const [first, second] = bodyRows();
    expect(first).toHaveAttribute('tabindex', '0');
    expect(second).toHaveAttribute('tabindex', '-1');

    first?.focus();
    await userEvent.keyboard(' ');
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveAttribute('data-state', 'selected');
    expect(onRowSelectionChange).toHaveBeenLastCalledWith({ 'm-1': true });

    await userEvent.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute('aria-selected', 'false');
    await userEvent.keyboard(' ');
    expect(second).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard(' ');
    expect(second).toHaveAttribute('aria-selected', 'false');
  });

  it('opens a row on click and on Enter, and reports the focused row', async () => {
    const onRowActivate = vi.fn();
    const onActiveRowChange = vi.fn();
    renderTable({
      onRowActivate,
      onActiveRowChange,
      getRowClassName: (row) => (row.id === 'm-2' ? 'bg-warning-soft' : undefined),
    });
    const [first, second] = bodyRows();
    expect(second).toHaveClass('bg-warning-soft');
    expect(first).not.toHaveClass('bg-warning-soft');

    first?.focus();
    expect(onActiveRowChange).toHaveBeenLastCalledWith(MATTER_ROWS[0], 0);
    await userEvent.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    expect(onActiveRowChange).toHaveBeenLastCalledWith(MATTER_ROWS[1], 1);
    await userEvent.keyboard('{Enter}');
    expect(onRowActivate).toHaveBeenLastCalledWith(MATTER_ROWS[1], 1);

    await userEvent.click(within(first as HTMLElement).getAllByRole('cell')[0] as HTMLElement);
    expect(onRowActivate).toHaveBeenLastCalledWith(MATTER_ROWS[0], 0);
    expect(onRowActivate).toHaveBeenCalledTimes(2);
  });

  it('leaves Enter and clicks alone without onRowActivate', async () => {
    renderTable();
    const [first] = bodyRows();
    expect(first).not.toHaveClass('cursor-pointer');
    first?.focus();
    await userEvent.keyboard('{Enter}');
    expect(first).toHaveFocus();
  });

  it('Shift+arrows extend the selection and shrink it again', async () => {
    renderTable({ enableRowSelection: true });
    const rows = bodyRows();
    rows[0]?.focus();
    await userEvent.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}');
    expect(rows[2]).toHaveFocus();
    expect(rows.slice(0, 3).map((row) => row.getAttribute('aria-selected'))).toEqual([
      'true',
      'true',
      'true',
    ]);
    expect(rows[3]).toHaveAttribute('aria-selected', 'false');
    await userEvent.keyboard('{Shift>}{ArrowUp}{/Shift}');
    expect(rows[2]).toHaveAttribute('aria-selected', 'false');
    expect(rows[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('selects all from the header checkbox and names row checkboxes', async () => {
    renderTable({ enableRowSelection: true });
    expect(
      screen.getByRole('checkbox', { name: `Select row: ${MATTER_ROWS[0]?.title ?? ''}` }),
    ).toBeInTheDocument();
    const all = screen.getByRole('checkbox', { name: DEFAULT_DATA_TABLE_LABELS.selectAll });
    await userEvent.click(all);
    for (const row of bodyRows()) expect(row).toHaveAttribute('aria-selected', 'true');
    expect(all).toBeChecked();
  });

  it('Shift+click on a checkbox selects the range from the last toggled row', async () => {
    renderTable({ enableRowSelection: true });
    const user = userEvent.setup();
    const boxes = bodyRows().map((row) => within(row).getByRole('checkbox'));
    await user.click(boxes[1] as HTMLElement);
    await user.keyboard('{Shift>}');
    await user.click(boxes[3] as HTMLElement);
    await user.keyboard('{/Shift}');
    expect(bodyRows().map((row) => row.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'true',
      'true',
      'false',
      'false',
    ]);
  });

  it('density toggle switches rows between 44 px and 32 px', async () => {
    const onDensityChange = vi.fn();
    renderTable({ enableDensityToggle: true, onDensityChange });
    for (const row of bodyRows()) expect(row.className).toMatch(/\bh-11\b/);
    await userEvent.click(screen.getByRole('radio', { name: DEFAULT_DATA_TABLE_LABELS.compact }));
    expect(onDensityChange).toHaveBeenCalledWith('compact');
    for (const row of bodyRows()) expect(row.className).toMatch(/\bh-8\b/);
  });

  it('shows skeleton rows in a busy status while loading', () => {
    renderTable({ loading: true, skeletonRows: 4 });
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent(DEFAULT_DATA_TABLE_LABELS.loading);
    expect(document.querySelectorAll('[data-slot="data-table-skeleton-row"]')).toHaveLength(4);
    expect(bodyRows()).toHaveLength(0);
  });

  it('renders the empty slot when there are no rows', () => {
    const { unmount } = renderTable({ data: [] });
    expect(screen.getByText(DEFAULT_DATA_TABLE_LABELS.empty)).toBeInTheDocument();
    unmount();
    renderTable({ data: [], empty: <p>No matters listed this week.</p> });
    expect(screen.getByText('No matters listed this week.')).toBeInTheDocument();
  });

  it('error state shows an alert whose retry calls onRetry', async () => {
    const onRetry = vi.fn();
    renderTable({ data: [], status: 'error', onRetry });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(DEFAULT_DATA_TABLE_LABELS.errorTitle);
    expect(screen.queryByText(DEFAULT_DATA_TABLE_LABELS.empty)).toBeNull();
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('offline keeps the saved rows under a banner', () => {
    renderTable({ status: 'offline' });
    expect(screen.getByRole('status')).toHaveTextContent('You are offline. Showing saved data.');
    expect(bodyRows()).toHaveLength(MATTER_ROWS.length);
  });

  it('permission denied hides the data behind a lock message', () => {
    renderTable({ status: 'denied' });
    expect(screen.getByRole('status')).toHaveTextContent(
      'You do not have access to this. Ask the workspace owner.',
    );
    expect(document.querySelector('[data-slot="alert-icon"] svg.lucide-lock')).not.toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('routes every built-in string through labels', async () => {
    renderTable({
      enableRowSelection: true,
      enableColumnVisibility: true,
      status: 'offline',
      labels: { selectAll: 'அனைத்தையும்', columns: 'நெடுவரிசைகள்', offline: 'ஆஃப்லைன்' },
    });
    expect(screen.getByRole('checkbox', { name: 'அனைத்தையும்' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('ஆஃப்லைன்');
    await userEvent.click(screen.getByRole('button', { name: 'நெடுவரிசைகள்' }));
  });

  it('uses mobileRender for a card list below 768 px', () => {
    mockMatchMedia(true);
    renderTable({ mobileRender: (row) => <strong>{row.title}</strong> });
    expect(screen.queryByRole('table')).toBeNull();
    const list = screen.getByRole('list', { name: 'Matters' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(MATTER_ROWS.length);
  });

  it('keeps the table on wide screens even with mobileRender', () => {
    mockMatchMedia(false);
    renderTable({ mobileRender: (row) => <strong>{row.title}</strong> });
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('virtualised mode renders a window of a 5,000-row list', () => {
    // jsdom has no layout: give the scroll container a 480 px viewport.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(480);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1024);
    renderTable({ data: matterRows(5000), virtualized: true });
    const rendered = bodyRows().length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(200);
    expect(screen.getByRole('table')).toHaveAttribute('aria-rowcount', '5001');
    expect(bodyRows()[0]).toHaveAttribute('aria-rowindex', '2');
  });
});
