// Roster table (#435): a forum's roster versions as cards (the one in force badged "Active today")
// and the halls of the roster in force; a forum with no roster covering today; a roster with no
// halls; a long portfolio; dark mode; the offline Import button.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { rosterCards, rosterHalls } from './__tests__/fixtures.ts';
import { RosterImportLink, RosterTable } from './roster-table.tsx';

const meta = {
  title: 'Courts/RosterTable',
  component: RosterTable,
  args: { rosters: rosterCards(), activeRosterId: 'roster-oct', halls: rosterHalls() },
} satisfies Meta<typeof RosterTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('table')).toBeVisible();
    await expect(canvas.getByText('Active today')).toBeVisible();
  },
};

export const NoneInForce: Story = {
  args: {
    rosters: rosterCards().map((roster) => ({ ...roster, status: 'superseded' as const })),
    activeRosterId: null,
    halls: [],
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('table')).toBeNull();
    await expect(canvas.getByText('No roster in force today')).toBeVisible();
  },
};

export const NoHalls: Story = { args: { halls: [] } };

export const LongPortfolio: Story = {
  args: {
    halls: [
      {
        entryId: 'entry-long',
        hallNo: '14',
        portfolioText:
          'Writ petitions relating to service matters of the State Government, local bodies and ' +
          'statutory corporations filed from 2015 onwards, together with connected writ appeals ' +
          'and contempt petitions arising out of orders in such matters (fictional)',
        benchLabel: 'Justice D. Malar (fictional)',
      },
    ],
  },
};

export const Dark: Story = { globals: { theme: 'dark' } };

export const ImportButton: Story = {
  render: () => <RosterImportLink href="/w/demo/courts/rosters/import?forum=demo.forum" />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Import roster' })).toBeVisible();
  },
};

export const Tamil: Story = { globals: { locale: 'ta' } };

export const Kannada: Story = { globals: { locale: 'kn' } };
