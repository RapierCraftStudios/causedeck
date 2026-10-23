// Matters table (#388, >= 768 px): the list's rows with sortable headers, the next date with its
// confirmation word, stage, proceedings, owner and updated. Tamil and Kannada party names check
// the Noto fallback and line height.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import type { MatterRowView } from '../../lib/matters/graph-deps.ts';
import { MattersTable } from './matters-table.tsx';

const row = (id: string, over: Partial<MatterRowView>): MatterRowView => ({
  id,
  href: `/w/demo/matters/${id}`,
  title: 'Rao v. State of Tamil Nadu',
  sensitive: false,
  petitioner: 'K. Rao',
  respondent: 'State of Tamil Nadu',
  forum: 'Madras High Court',
  stage: 'hearing',
  proceedingCount: 2,
  nextDate: { text: 'Mon, 02 Nov 2026', relative: 'in 12 days', confirmed: true },
  owner: 'Meera Iyer',
  updated: '20 Oct 2026',
  updatedAt: '2026-10-20T04:00:00.000Z',
  ...over,
});

const ROWS = [
  row('00000000-0000-4000-8000-0000000b0001', {}),
  row('00000000-0000-4000-8000-0000000b0002', {
    title: 'Selvi v. Fictional Transport Corporation',
    petitioner: 'Selvi',
    respondent: 'Fictional Transport Corporation',
    sensitive: true,
    nextDate: { text: 'Fri, 06 Nov 2026', relative: 'in 16 days', confirmed: false },
    proceedingCount: 1,
  }),
  row('00000000-0000-4000-8000-0000000b0003', {
    title: 'Ilango v. Fictional Housing Board',
    petitioner: null,
    respondent: null,
    forum: null,
    stage: null,
    nextDate: null,
    owner: null,
    proceedingCount: 0,
  }),
];

const TAMIL_ROWS = [
  row('00000000-0000-4000-8000-0000000b0011', {
    title: 'முருகன் எதிர் தமிழ்நாடு அரசு',
    petitioner: 'முருகன் இளங்கோவன்',
    respondent: 'தமிழ்நாடு அரசு',
  }),
  row('00000000-0000-4000-8000-0000000b0012', {
    title: 'செல்வி எதிர் கற்பனை வீட்டு வசதி வாரியம்',
    petitioner: 'செல்வி',
    respondent: 'கற்பனை வீட்டு வசதி வாரியம்',
  }),
];

const KANNADA_ROWS = [
  row('00000000-0000-4000-8000-0000000b0021', {
    title: 'ಲಕ್ಷ್ಮಿ ವಿರುದ್ಧ ಕರ್ನಾಟಕ ಸರ್ಕಾರ',
    petitioner: 'ಲಕ್ಷ್ಮಿ ಗೌಡ',
    respondent: 'ಕರ್ನಾಟಕ ಸರ್ಕಾರ',
  }),
  row('00000000-0000-4000-8000-0000000b0022', {
    title: 'ರಮೇಶ್ ವಿರುದ್ಧ ಕಾಲ್ಪನಿಕ ನಗರ ಪಾಲಿಕೆ',
    petitioner: 'ರಮೇಶ್',
    respondent: 'ಕಾಲ್ಪನಿಕ ನಗರ ಪಾಲಿಕೆ',
  }),
];

const meta = {
  title: 'Matters/MattersTable',
  component: MattersTable,
  args: { rows: ROWS, state: { sort: 'next_date' }, slug: 'demo' },
} satisfies Meta<typeof MattersTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('table', { name: 'Matters' })).toBeVisible();
    await expect(canvas.getAllByRole('row')).toHaveLength(ROWS.length + 1);
    await expect(canvas.getByText('To confirm')).toBeVisible();
  },
};

export const SortedByUpdated: Story = {
  args: { state: { sort: 'updated' } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('columnheader', { name: 'Updated' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  },
};

export const ActiveRow: Story = {
  args: { activeIndex: 1 },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('row')[2]).toHaveAttribute('aria-selected', 'true');
  },
};

export const Tamil: Story = {
  args: { rows: TAMIL_ROWS },
  globals: { locale: 'ta' },
};

export const Kannada: Story = {
  args: { rows: KANNADA_ROWS },
  globals: { locale: 'kn' },
};
