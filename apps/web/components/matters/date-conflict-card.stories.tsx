// The Conflict card (#390): two sources disagree on a proceeding's next date. Both sides stand side
// by side, nothing is preselected, and only members who may write the matter get the choices.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent } from 'storybook/test';

import type { ConflictView, ListingView } from '../../lib/matters/workspace.ts';

import { DateConflictCard } from './date-conflict-card.tsx';

const listing = (
  overrides: Partial<ListingView> & Pick<ListingView, 'listingId'>,
): ListingView => ({
  proceedingId: 'p-1',
  date: '2026-11-02',
  text: 'Mon, 02 Nov 2026',
  relative: 'in 12 days',
  proposed: false,
  stage: 'listed',
  source: { kind: 'manual', state: 'confirmed', sourceRef: null, confidence: null },
  ...overrides,
});

const conflict: ConflictView = {
  proceedingId: 'p-1',
  current: listing({ listingId: 'l-1' }),
  proposed: listing({
    listingId: 'l-2',
    date: '2026-11-09',
    text: 'Mon, 09 Nov 2026',
    relative: 'in 19 days',
    proposed: true,
    source: { kind: 'adapter', state: 'proposed', sourceRef: 'cause-list', confidence: 0.8 },
  }),
  others: [],
};

const meta = {
  title: 'Matters/DateConflictCard',
  component: DateConflictCard,
  args: {
    workspaceId: 'ws-1',
    conflict,
    canWrite: true,
    action: fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { listingId: 'l-1', date: '2026-11-02', confirmationState: 'confirmed' },
      }),
    ),
  },
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DateConflictCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Writer: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('region')).toBeVisible();
    await expect(canvas.getByRole('button', { name: /Choose A/ })).toBeVisible();
    await expect(canvas.getByRole('button', { name: /Choose B/ })).toBeVisible();
  },
};

export const EnterManually: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Enter manually/ }));
    await expect(canvas.getByLabelText('Next date')).toBeVisible();
  },
};

export const Reader: Story = {
  args: { canWrite: false },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: /Choose A/ })).toBeNull();
  },
};

export const Offline: Story = {
  args: { offline: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('region')).toBeVisible();
  },
};

export const Tamil: Story = { globals: { locale: 'ta' } };

export const Kannada: Story = { globals: { locale: 'kn' } };
