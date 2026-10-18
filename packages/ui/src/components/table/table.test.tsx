// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MATTER_COLUMNS, MATTER_ROWS } from '../__fixtures__/data';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type TableDensity,
} from './table';

function Example({
  density,
  selectedId,
}: {
  density?: TableDensity | undefined;
  selectedId?: string | undefined;
}) {
  return (
    <Table density={density} aria-label="Matters">
      <TableCaption>Upcoming hearings</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>{MATTER_COLUMNS.title}</TableHead>
          <TableHead className="text-end">{MATTER_COLUMNS.feeDue}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {MATTER_ROWS.slice(0, 3).map((row) => (
          <TableRow key={row.id} selected={row.id === selectedId}>
            <TableCell>{row.title}</TableCell>
            <TableCell className="text-end">{row.feeDue}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

describe('Table', () => {
  it('renders table semantics with data slots', () => {
    render(<Example />);
    const table = screen.getByRole('table', { name: 'Matters' });
    expect(table).toHaveAttribute('data-slot', 'table');
    expect(within(table).getAllByRole('rowgroup')).toHaveLength(2);
    expect(within(table).getAllByRole('columnheader')).toHaveLength(2);
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getAllByRole('cell')).toHaveLength(6);
    expect(table.closest('[data-slot="table-container"]')).not.toBeNull();
  });

  it('uses tabular numerals', () => {
    render(<Example />);
    expect(screen.getByRole('table').className).toMatch(/\btabular-nums\b/);
  });

  it('rows are 44 px comfortable by default and 32 px compact', () => {
    const { unmount } = render(<Example />);
    for (const row of screen.getAllByRole('row')) expect(row.className).toMatch(/\bh-11\b/);
    expect(screen.getByRole('table')).toHaveAttribute('data-density', 'comfortable');
    unmount();
    render(<Example density="compact" />);
    for (const row of screen.getAllByRole('row')) {
      expect(row.className).toMatch(/\bh-8\b/);
      expect(row.className).not.toMatch(/\bh-11\b/);
    }
  });

  it('hover uses --surface-sunken; selected uses --accent-soft and a 2 px start bar', () => {
    render(<Example selectedId={MATTER_ROWS[1]?.id} />);
    const [, first, second] = screen.getAllByRole('row');
    expect(first?.className).toMatch(/\bhover:bg-surface-sunken\b/);
    expect(first).not.toHaveAttribute('data-state');
    expect(second).toHaveAttribute('data-state', 'selected');
    expect(second?.className).toMatch(/\bdata-\[state=selected\]:bg-accent-soft\b/);
    expect(second?.className).toMatch(/\bborder-s-2\b/);
    expect(second?.className).toMatch(/\bdata-\[state=selected\]:border-s-accent\b/);
  });

  it('sticky header pins to the top of the scroll container', () => {
    render(
      <Table>
        <TableHeader sticky>
          <TableRow>
            <TableHead>{MATTER_COLUMNS.title}</TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    );
    const header = screen.getAllByRole('rowgroup')[0];
    expect(header).toHaveAttribute('data-sticky');
    expect(header?.className).toMatch(/\bsticky\b/);
    expect(header?.className).toMatch(/\bz-sticky\b/);
  });
});
