// check-stories: n/a Disabled (a whole table is never disabled; rows that cannot be selected and actions in cells carry their own disabled state)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CalendarClock, Scale } from 'lucide-react';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import {
  INDIC_DATA,
  MATTER_COLUMNS,
  MATTER_ROWS,
  matterRows,
  type MatterRow,
} from '../__fixtures__/data';
import { INDIC, LONG_LABEL } from '../__fixtures__/labels';
import {
  createDataTableColumnHelper,
  DataTable,
  DEFAULT_DATA_TABLE_LABELS,
  type DataTableProps,
} from './data-table';

const fee = (value: number) => `₹${value.toLocaleString('en-IN')}`;
const hearing = (iso: string) => iso.split('-').reverse().join('/');

const col = createDataTableColumnHelper<MatterRow>();

const makeColumns = (headers: Record<keyof typeof MATTER_COLUMNS, string>, withIcon = false) =>
  col.columns([
    col.accessor('title', { header: headers.title }),
    col.accessor('court', { header: headers.court }),
    col.accessor('stage', {
      header: headers.stage,
      cell: (info) => <Badge tone="neutral">{info.getValue()}</Badge>,
    }),
    col.accessor('nextHearing', {
      header: headers.nextHearing,
      cell: (info) =>
        withIcon ? (
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock aria-hidden="true" className="text-ink-muted size-4" />
            {hearing(info.getValue())}
          </span>
        ) : (
          hearing(info.getValue())
        ),
    }),
    col.accessor('feeDue', {
      header: headers.feeDue,
      meta: { align: 'end' },
      cell: (info) => fee(info.getValue()),
    }),
  ]);

const COLUMNS = makeColumns(MATTER_COLUMNS);

type MattersProps = Omit<DataTableProps<MatterRow>, 'columns' | 'label'> & {
  columns?: DataTableProps<MatterRow>['columns'];
  label?: string;
};

function Matters({ columns = COLUMNS, label = 'Matters', ...props }: MattersProps) {
  return (
    <DataTable
      label={label}
      columns={columns}
      getRowId={(row) => row.id}
      getRowLabel={(row) => row.title}
      {...props}
    />
  );
}

/** Comfortable rows: 40 px with a fine pointer (mouse, trackpad), 44 px on touch. */
const comfortablePx = () => (window.matchMedia('(pointer: fine)').matches ? 40 : 44);

const meta = {
  title: 'Components/DataTable',
  component: Matters,
  args: {
    data: MATTER_ROWS,
    enableRowSelection: true,
    enableColumnVisibility: true,
    enableDensityToggle: true,
    stickyHeader: true,
    onRowSelectionChange: fn(),
    onSortingChange: fn(),
  },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Matters>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Data rows only (not the header or virtualisation spacers). */
const bodyRows = (canvas: { getAllByRole: (role: 'row') => HTMLElement[] }) =>
  canvas.getAllByRole('row').filter((row) => row.hasAttribute('data-row-index'));

/** Sort by clicking a header; aria-sort follows. */
export const Default: Story = {
  play: async ({ canvas, args }) => {
    const header = canvas.getByRole('columnheader', { name: MATTER_COLUMNS.feeDue });
    await expect(header).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(within(header).getByRole('button'));
    await expect(header).not.toHaveAttribute('aria-sort', 'none');
    await expect(args.onSortingChange).toHaveBeenCalled();
    await expect(bodyRows(canvas)[0]?.getBoundingClientRect().height).toBe(comfortablePx());
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    const row = bodyRows(canvas)[0] as HTMLElement;
    await userEvent.hover(row);
    await expect(row.className).toMatch(/\bhover:bg-surface-sunken\b/);
  },
};

/** Tab reaches the toolbar, then the sort buttons, then the first row (one tab stop for rows). */
export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    const first = bodyRows(canvas)[0] as HTMLElement;
    first.focus();
    await expect(first).toHaveFocus();
    await expect(first.matches(':focus-visible')).toBe(true);
    await expect(bodyRows(canvas)[1]).toHaveAttribute('tabindex', '-1');
  },
};

/** Pressing a sort header: the button takes the press and sorts. */
export const Active: Story = {
  play: async ({ canvas }) => {
    const button = within(
      canvas.getByRole('columnheader', { name: MATTER_COLUMNS.title }),
    ).getByRole('button');
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: button },
      { keys: '[/MouseLeft]', target: button },
    ]);
    await expect(canvas.getByRole('columnheader', { name: MATTER_COLUMNS.title })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  },
};

/** Keyboard selection: Space toggles the focused row, Shift+Down extends, Shift+Up shrinks. */
export const KeyboardSelection: Story = {
  play: async ({ canvas, args }) => {
    const rows = bodyRows(canvas);
    (rows[0] as HTMLElement).focus();
    await userEvent.keyboard(' ');
    await expect(rows[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}');
    await expect(rows[2]).toHaveFocus();
    await expect(rows[1]).toHaveAttribute('aria-selected', 'true');
    await expect(rows[2]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Shift>}{ArrowUp}{/Shift}');
    await expect(rows[2]).toHaveAttribute('aria-selected', 'false');
    await userEvent.keyboard('{ArrowDown}{ArrowDown} ');
    await expect(rows[3]).toHaveAttribute('aria-selected', 'true');
    await expect(getComputedStyle(rows[3] as HTMLElement).borderInlineStartWidth).toBe('2px');
    await expect(args.onRowSelectionChange).toHaveBeenCalled();
  },
};

export const ColumnVisibility: Story = {
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole('button', { name: DEFAULT_DATA_TABLE_LABELS.columns }));
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await page.findByRole('menuitemcheckbox', { name: MATTER_COLUMNS.court }),
    );
    await expect(canvas.queryByRole('columnheader', { name: MATTER_COLUMNS.court })).toBeNull();
    await userEvent.keyboard('{Escape}');
  },
};

export const DensityToggle: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('radio', { name: DEFAULT_DATA_TABLE_LABELS.compact }));
    await waitFor(() => expect(bodyRows(canvas)[0]?.getBoundingClientRect().height).toBe(32));
  },
};

export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  },
};

export const Empty: Story = {
  args: {
    data: [],
    empty: (
      <div className="grid justify-items-center gap-3 py-8 text-center">
        <p className="text-ink-muted text-sm">No matters are listed this week.</p>
        <Button size="sm">Add matter</Button>
      </div>
    ),
  },
};

/** Error: inline danger alert with a retry. */
export const Invalid: Story = {
  args: { data: [], status: 'error' },
  render: (args) => {
    function Demo() {
      const [failed, setFailed] = useState(true);
      return (
        <Matters
          {...args}
          status={failed ? 'error' : undefined}
          data={failed ? [] : MATTER_ROWS}
          onRetry={() => {
            setFailed(false);
          }}
        />
      );
    }
    return <Demo />;
  },
  play: async ({ canvas }) => {
    const alert = canvas.getByRole('alert');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await expect(canvas.queryByRole('alert')).toBeNull();
    await expect(bodyRows(canvas)).toHaveLength(MATTER_ROWS.length);
  },
};

export const Offline: Story = {
  args: { status: 'offline' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'You are offline. Showing saved data.',
    );
  },
};

export const PermissionDenied: Story = {
  args: { status: 'denied' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'You do not have access to this. Ask the workspace owner.',
    );
    await expect(canvas.queryByRole('grid')).toBeNull();
  },
};

/** Phones: a card list from `mobileRender` (forced here; `layout="auto"` switches below 768 px). */
export const Mobile: Story = {
  args: {
    layout: 'cards',
    mobileRender: (row) => (
      <div className="grid gap-1">
        <p className="text-ink font-medium">{row.title}</p>
        <p className="text-ink-muted text-xs">
          {row.court} · {hearing(row.nextHearing)}
        </p>
        <p className="text-sm tabular-nums">{fee(row.feeDue)}</p>
      </div>
    ),
  },
  decorators: [
    (Story) => (
      <div className="w-90">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('grid')).toBeNull();
    await expect(within(canvas.getByRole('list')).getAllByRole('listitem')).toHaveLength(
      MATTER_ROWS.length,
    );
  },
};

/**
 * Manual perf check: 5,000 rows, virtualised. Scroll quickly with the Performance panel open;
 * frames should stay at 60 fps (only the rows in view are in the DOM).
 */
export const Virtualized5000: Story = {
  args: { data: matterRows(5000), virtualized: true, scrollClassName: 'max-h-120' },
  play: async ({ canvas }) => {
    const rendered = bodyRows(canvas).length;
    await expect(rendered).toBeGreaterThan(0);
    await expect(rendered).toBeLessThan(100);
    await expect(canvas.getByRole('grid')).toHaveAttribute('aria-rowcount', '5001');
  },
};

export const WithIcon: Story = {
  args: { columns: makeColumns(MATTER_COLUMNS, true), toolbar: <Scale aria-hidden="true" /> },
};

export const LongText: Story = {
  args: { data: [{ ...MATTER_ROWS[0], title: LONG_LABEL } as MatterRow, ...MATTER_ROWS.slice(1)] },
};

export const RtlNeutral: Story = {
  args: { defaultRowSelection: { 'm-1': true } },
  decorators: [
    (Story) => (
      <div dir="rtl">
        <Story />
      </div>
    ),
  ],
};

const indicLabels = (lang: 'ta' | 'kn') => ({
  ...DEFAULT_DATA_TABLE_LABELS,
  loading: INDIC[lang].loading,
  empty: INDIC_DATA[lang].empty,
  offline: INDIC[lang].offline,
  selectAll: INDIC_DATA[lang].selectAll,
  selectRow: INDIC_DATA[lang].selectRow,
  columns: INDIC_DATA[lang].columns,
});

export const Tamil: Story = {
  args: {
    columns: makeColumns(INDIC_DATA.ta),
    labels: indicLabels('ta'),
    status: 'offline',
  },
  decorators: [
    (Story) => (
      <div lang="ta">
        <Story />
      </div>
    ),
  ],
};

export const Kannada: Story = {
  args: {
    columns: makeColumns(INDIC_DATA.kn),
    labels: indicLabels('kn'),
    status: 'offline',
  },
  decorators: [
    (Story) => (
      <div lang="kn">
        <Story />
      </div>
    ),
  ],
};
