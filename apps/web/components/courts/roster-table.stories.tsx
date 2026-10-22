// Roster table (#435): a forum's roster versions as cards (the one in force badged "Active today")
// and the halls of the roster in force; a forum with no roster covering today; a roster with no
// halls; a long portfolio; dark mode; the Import button online and offline; the load error.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, waitFor } from 'storybook/test';

import { rosterCards, rosterHalls } from './__tests__/fixtures.ts';
import { RosterImportLink, RostersLoadError, RosterTable } from './roster-table.tsx';

/** Answer `navigator.onLine` with `online` until the returned cleanup runs. */
function stubOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  return () => {
    // The own property shadows the prototype getter; removing it restores the real value.
    Reflect.deleteProperty(navigator, 'onLine');
  };
}

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

/** Offline: Import roster is disabled, with the note that importing needs a connection. */
export const ImportButtonOffline: Story = {
  beforeEach: () => stubOnline(false),
  render: () => <RosterImportLink href="/w/demo/courts/rosters/import?forum=demo.forum" />,
  play: async ({ canvas, canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector('[data-roster-import="offline"]')).not.toBeNull(),
    );
    await expect(canvas.getByRole('button', { name: 'Import roster' })).toBeDisabled();
    await expect(canvas.getByText('Importing a roster needs a connection.')).toBeVisible();
    await expect(canvas.queryByRole('link')).toBeNull();
  },
};

export const LoadError: Story = {
  render: () => <RostersLoadError />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Could not load rosters.')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible();
  },
};

export const Tamil: Story = { globals: { locale: 'ta' } };

export const Kannada: Story = { globals: { locale: 'kn' } };
