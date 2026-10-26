// Access modes table (#400): the adapter's registry rows, with the counsel note or a "Legal review
// pending" tag; unknown resources show as stored.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { forumDetail } from './__tests__/fixtures.ts';
import { AccessModesTable } from './access-modes-table.tsx';

const meta = {
  title: 'Courts/AccessModesTable',
  component: AccessModesTable,
  args: { modes: forumDetail().accessModes },
} satisfies Meta<typeof AccessModesTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('table')).toBeVisible();
  },
};

/** A resource outside the registry labels shows as stored. */
export const UnknownResource: Story = {
  args: {
    modes: [
      ...forumDetail().accessModes,
      {
        resource: 'judgment-archive',
        mode: 'user_supplied',
        enabled: true,
        counselNote: null,
        legalReviewPending: true,
      },
    ],
  },
};

export const Empty: Story = { args: { modes: [] } };

export const LongText: Story = {
  args: {
    modes: [
      {
        resource: 'cause_list',
        mode: 'user_supplied',
        enabled: true,
        counselNote:
          'The lawyer downloads the daily cause list from the official site and shares the PDF with CauseDeck; nothing is fetched, scraped or stored beyond the lawyer’s own workspace.',
        legalReviewPending: false,
      },
    ],
  },
};

export const Tamil: Story = { globals: { locale: 'ta' } };

export const Kannada: Story = { globals: { locale: 'kn' } };
