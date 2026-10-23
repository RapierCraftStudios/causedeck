// Table and DataTable in a real browser: measured row heights per density, the 2 px selected
// bar, the sticky header while scrolling, virtualised windows and the phone card list.
import '../styles/globals.css';

import { render, screen, within } from '@testing-library/react';
import { page } from '@vitest/browser/context';
import { afterEach, describe, expect, it } from 'vitest';

import { MATTER_COLUMNS, MATTER_ROWS, matterRows, type MatterRow } from './__fixtures__/data';
import { createDataTableColumnHelper, DataTable, type DataTableProps } from './data-table';
import { Table, TableBody, TableCell, TableRow } from './table';

const col = createDataTableColumnHelper<MatterRow>();
const columns = col.columns([
  col.accessor('title', { header: MATTER_COLUMNS.title }),
  col.accessor('court', { header: MATTER_COLUMNS.court }),
  col.accessor('feeDue', { header: MATTER_COLUMNS.feeDue, meta: { align: 'end' } }),
]);

function Matters(props: Partial<DataTableProps<MatterRow>>) {
  return (
    <DataTable
      label="Matters"
      columns={columns}
      data={MATTER_ROWS}
      getRowId={(row) => row.id}
      {...props}
    />
  );
}

const bodyRows = () =>
  screen.getAllByRole('row').filter((row) => row.hasAttribute('data-row-index'));

const height = (element: Element | undefined) =>
  Math.round(element?.getBoundingClientRect().height ?? 0);

afterEach(async () => {
  await page.viewport(1280, 900);
});

/** Comfortable rows: 40 px with a fine pointer (mouse, trackpad), 44 px on touch (#183). */
const comfortablePx = () => (window.matchMedia('(pointer: fine)').matches ? 40 : 44);

describe('row density', () => {
  it('comfortable rows measure 40 px with a fine pointer (44 px on touch), compact rows 32 px', () => {
    expect(window.matchMedia('(pointer: fine)').matches).toBe(true);
    const { unmount } = render(<Matters />);
    for (const row of bodyRows()) expect(height(row)).toBe(comfortablePx());
    unmount();
    render(<Matters density="compact" />);
    for (const row of bodyRows()) expect(height(row)).toBe(32);
  });

  it('keeps the comfortable height with Tamil text in the cells', () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell lang="ta">அடுத்த விசாரணை</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(height(screen.getByRole('row'))).toBe(comfortablePx());
  });
});

describe('selection', () => {
  it('selected rows show a 2 px inline-start bar in --accent on --accent-soft', () => {
    render(<Matters enableRowSelection defaultRowSelection={{ 'm-2': true }} />);
    const [plain, selected] = bodyRows();
    const style = getComputedStyle(selected as HTMLElement);
    expect(style.borderInlineStartWidth).toBe('2px');
    const probe = document.createElement('span');
    probe.className = 'text-accent bg-accent-soft';
    document.body.append(probe);
    expect(style.borderInlineStartColor).toBe(getComputedStyle(probe).color);
    expect(style.backgroundColor).toBe(getComputedStyle(probe).backgroundColor);
    probe.remove();
    // Unselected rows reserve the bar (transparent) so selecting never shifts the layout.
    expect(getComputedStyle(plain as HTMLElement).borderInlineStartWidth).toBe('2px');
    expect(getComputedStyle(plain as HTMLElement).borderInlineStartColor).toBe('rgba(0, 0, 0, 0)');
  });
});

describe('sticky header', () => {
  it('keeps the header at the top of the scroll container', () => {
    render(<Matters data={matterRows(40)} stickyHeader scrollClassName="max-h-72" />);
    const header = screen.getAllByRole('rowgroup')[0] as HTMLElement;
    const container = header.closest('[data-slot="data-table-scroll"]') as HTMLElement;
    expect(container.scrollHeight).toBeGreaterThan(container.clientHeight);
    container.scrollTop = 600;
    expect(Math.round(header.getBoundingClientRect().top)).toBe(
      Math.round(container.getBoundingClientRect().top + container.clientTop),
    );
  });
});

describe('virtualised', () => {
  it('renders only the rows in view of 5,000 and follows the scroll', async () => {
    render(<Matters data={matterRows(5000)} virtualized />);
    expect(bodyRows().length).toBeLessThan(60);
    const container = document.querySelector<HTMLElement>('[data-slot="data-table-scroll"]');
    if (!container) throw new Error('no scroll container');
    container.scrollTop = comfortablePx() * 2500;
    await expect
      .poll(() => bodyRows().some((row) => row.getAttribute('data-row-index') === '2505'))
      .toBe(true);
    expect(bodyRows().length).toBeLessThan(60);
  });

  it('spaces virtual rows by their rendered height, with no gaps', async () => {
    render(<Matters data={matterRows(200)} virtualized />);
    await expect.poll(() => bodyRows().length).toBeGreaterThan(3);
    const [first, second] = bodyRows();
    const step = Math.round(
      (second?.getBoundingClientRect().top ?? 0) - (first?.getBoundingClientRect().top ?? 0),
    );
    expect(step).toBe(height(first));
    expect(step).toBe(comfortablePx());
  });
});

describe('phone layout', () => {
  it('collapses to the mobileRender card list below 768 px', async () => {
    await page.viewport(360, 800);
    render(<Matters mobileRender={(row) => <strong>{row.title}</strong>} />);
    await expect.poll(() => screen.queryByRole('table')).toBeNull();
    const list = screen.getByRole('list', { name: 'Matters' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(MATTER_ROWS.length);
  });

  it('shows the table from 768 px', async () => {
    await page.viewport(768, 900);
    render(<Matters mobileRender={(row) => <strong>{row.title}</strong>} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});
