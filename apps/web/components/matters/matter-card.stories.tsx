// A matter on the phone list (#388): title, parties, forum, stage, next date with its confirmation
// state, proceedings, owner and updated. Tamil and Kannada party names check the Noto fallback and
// line height.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import type { MatterRowView } from '../../lib/matters/graph-deps.ts';

import { MatterCard } from './matter-card.tsx';

const row = (overrides: Partial<MatterRowView> = {}): MatterRowView => ({
  id: 'm-1',
  href: '/w/demo/matters/m-1',
  title: 'Ilango v. Fictional Housing Board',
  sensitive: false,
  petitioner: 'Ilango',
  respondent: 'Fictional Housing Board',
  forum: 'Madras High Court',
  stage: 'numbered',
  proceedingCount: 3,
  nextDate: { text: 'Mon, 02 Nov 2026', relative: 'in 12 days', confirmed: true },
  owner: 'Meera Rao',
  updated: '20 Oct 2026',
  updatedAt: '2026-10-20T10:00:00Z',
  ...overrides,
});

const meta = {
  title: 'Matters/MatterCard',
  component: MatterCard,
  args: { row: row(), index: 0 },
  decorators: [
    (Story) => (
      <ul className="max-w-sm">
        <Story />
      </ul>
    ),
  ],
} satisfies Meta<typeof MatterCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Confirmed: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link')).toHaveAttribute('href', '/w/demo/matters/m-1');
    await expect(canvas.getByText('Confirmed')).toBeVisible();
  },
};

export const ToConfirm: Story = {
  args: {
    row: row({ nextDate: { text: 'Mon, 09 Nov 2026', relative: 'in 19 days', confirmed: false } }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('To confirm')).toBeVisible();
  },
};

export const NoNextDate: Story = {
  args: { row: row({ nextDate: null, stage: null, owner: null, forum: null }) },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No next date')).toBeVisible();
    await expect(canvas.getByText('No owner')).toBeVisible();
  },
};

export const Sensitive: Story = {
  args: { row: row({ sensitive: true }) },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Sensitive')).toBeVisible();
  },
};

export const Active: Story = {
  args: { active: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link')).toHaveAttribute('data-active', '');
  },
};

export const Tamil: Story = {
  args: {
    row: row({
      title: 'இளங்கோ எதிர் தமிழ்நாடு வீட்டுவசதி வாரியம் (கற்பனை)',
      petitioner: 'இளங்கோ',
      respondent: 'தமிழ்நாடு வீட்டுவசதி வாரியம் (கற்பனை)',
      owner: 'மீரா ராவ்',
    }),
  },
  globals: { locale: 'ta' },
};

export const Kannada: Story = {
  args: {
    row: row({
      title: 'ಸುರೇಶ ವಿರುದ್ಧ ಕಾಲ್ಪನಿಕ ನಗರಾಭಿವೃದ್ಧಿ ಪ್ರಾಧಿಕಾರ',
      petitioner: 'ಸುರೇಶ',
      respondent: 'ಕಾಲ್ಪನಿಕ ನಗರಾಭಿವೃದ್ಧಿ ಪ್ರಾಧಿಕಾರ',
      forum: 'ಕರ್ನಾಟಕ ಉಚ್ಚ ನ್ಯಾಯಾಲಯ',
      owner: 'ಮೀರಾ ರಾವ್',
    }),
  },
  globals: { locale: 'kn' },
};
