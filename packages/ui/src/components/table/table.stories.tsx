// check-stories: n/a FocusVisible, Active, Disabled, Loading, Invalid (a static table has no interactive or pending state; DataTable owns focus, selection, loading and errors)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CalendarClock } from 'lucide-react';
import { expect, userEvent } from 'storybook/test';

import { INDIC_DATA, MATTER_COLUMNS, MATTER_ROWS, matterRows } from '../__fixtures__/data';
import { LONG_LABEL } from '../__fixtures__/labels';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type TableProps,
} from './table';

const fee = (value: number) => `₹${value.toLocaleString('en-IN')}`;

interface MattersProps extends TableProps {
  headers?: { title: string; court: string; nextHearing: string; feeDue: string };
  selectedId?: string;
  withIcon?: boolean;
  firstTitle?: string;
  rows?: typeof MATTER_ROWS;
  sticky?: boolean;
}

function Matters({
  headers = MATTER_COLUMNS,
  selectedId,
  withIcon = false,
  firstTitle,
  rows = MATTER_ROWS,
  sticky = false,
  ...props
}: MattersProps) {
  return (
    <Table aria-label="Matters" {...props}>
      <TableCaption>Hearings listed this term</TableCaption>
      <TableHeader sticky={sticky}>
        <TableRow>
          <TableHead>{headers.title}</TableHead>
          <TableHead>{headers.court}</TableHead>
          <TableHead>{headers.nextHearing}</TableHead>
          <TableHead className="text-end">{headers.feeDue}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={row.id} selected={row.id === selectedId}>
            <TableCell>{index === 0 && firstTitle ? firstTitle : row.title}</TableCell>
            <TableCell>{row.court}</TableCell>
            <TableCell>
              <span className="inline-flex items-center gap-1.5">
                {withIcon ? (
                  <CalendarClock aria-hidden="true" className="text-ink-muted size-4" />
                ) : null}
                {row.nextHearing.split('-').reverse().join('/')}
              </span>
            </TableCell>
            <TableCell className="text-end">{fee(row.feeDue)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Comfortable rows: 40 px with a fine pointer (mouse, trackpad), 44 px on touch. */
const comfortablePx = () => (window.matchMedia('(pointer: fine)').matches ? 40 : 44);

const meta = {
  title: 'Components/Table',
  component: Matters,
  args: { density: 'comfortable' },
  argTypes: { density: { control: 'inline-radio', options: ['comfortable', 'compact'] } },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Matters>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    const table = canvas.getByRole('table', { name: 'Matters' });
    const row = canvas.getAllByRole('row')[1];
    await expect(row?.getBoundingClientRect().height).toBe(comfortablePx());
    await expect(getComputedStyle(table).fontVariantNumeric).toContain('tabular-nums');
  },
};

/** 32 px rows for dense lists. */
export const Compact: Story = {
  args: { density: 'compact' },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('row')[1]?.getBoundingClientRect().height).toBe(32);
  },
};

/** Selected: `--accent-soft` with a 2 px accent bar on the inline-start edge. */
export const Selected: Story = {
  args: { selectedId: MATTER_ROWS[1]?.id ?? '' },
  play: async ({ canvas }) => {
    const row = canvas.getAllByRole('row')[2];
    await expect(row).toHaveAttribute('data-state', 'selected');
    await expect(getComputedStyle(row as HTMLElement).borderInlineStartWidth).toBe('2px');
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    const row = canvas.getAllByRole('row')[1] as HTMLElement;
    await userEvent.hover(row);
    await expect(row.className).toMatch(/\bhover:bg-surface-sunken\b/);
  },
};

/** The header stays put while the body scrolls. */
export const StickyHeader: Story = {
  args: {
    sticky: true,
    rows: matterRows(30),
    containerClassName: 'max-h-72',
    containerProps: { tabIndex: 0 },
  },
  play: async ({ canvas }) => {
    const header = canvas.getAllByRole('rowgroup')[0] as HTMLElement;
    const container = header.closest('[data-slot="table-container"]') as HTMLElement;
    container.scrollTop = 400;
    await expect(Math.round(header.getBoundingClientRect().top)).toBe(
      Math.round(container.getBoundingClientRect().top),
    );
  },
};

export const WithIcon: Story = { args: { withIcon: true } };

export const LongText: Story = {
  args: { firstTitle: LONG_LABEL },
  decorators: [
    (Story) => (
      <div className="w-160">
        <Story />
      </div>
    ),
  ],
};

export const RtlNeutral: Story = {
  args: { selectedId: MATTER_ROWS[0]?.id ?? '' },
  decorators: [
    (Story) => (
      <div dir="rtl">
        <Story />
      </div>
    ),
  ],
};

export const Tamil: Story = {
  args: { headers: INDIC_DATA.ta },
  decorators: [
    (Story) => (
      <div lang="ta">
        <Story />
      </div>
    ),
  ],
};

export const Kannada: Story = {
  args: { headers: INDIC_DATA.kn },
  decorators: [
    (Story) => (
      <div lang="kn">
        <Story />
      </div>
    ),
  ],
};
