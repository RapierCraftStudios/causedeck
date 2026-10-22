// Next-date card (#390): the Overview's hero. Confirmed and proposed dates (`Confirm` only for
// members who may write, off while offline), no date, and the server's failure. The action is
// mocked with `fn()`.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';

import type { ListingView } from '../../lib/matters/workspace.ts';
import type { Result } from '../../lib/safe-action.ts';
import {
  NextDateCard,
  type ChosenNextDate,
  type ConfirmNextDateAction,
} from './next-date-card.tsx';

const listing = (over: Partial<ListingView> = {}): ListingView => ({
  listingId: '00000000-0000-4000-8000-0000000d0001',
  proceedingId: '00000000-0000-4000-8000-0000000c0001',
  date: '2026-11-02',
  text: 'Mon, 02 Nov 2026',
  relative: 'in 12 days',
  proposed: false,
  stage: 'hearing',
  source: { kind: 'manual', state: 'confirmed', sourceRef: null, confidence: null },
  ...over,
});

const confirmed = (): Promise<Result<ChosenNextDate>> =>
  Promise.resolve({
    ok: true,
    data: {
      listingId: '00000000-0000-4000-8000-0000000d0001',
      date: '2026-11-02',
      confirmationState: 'confirmed',
    },
  });

const proposed = listing({
  proposed: true,
  source: { kind: 'adapter', state: 'proposed', sourceRef: null, confidence: 0.82 },
});

const meta = {
  title: 'Matters/NextDateCard',
  component: NextDateCard,
  args: {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    nextDate: listing(),
    canWrite: true,
    action: fn<ConfirmNextDateAction>(confirmed),
  },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NextDateCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Confirmed: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Mon, 02 Nov 2026')).toBeVisible();
    await expect(canvas.getByText('Confirmed')).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Confirm' })).toBeNull();
  },
};

export const Proposed: Story = {
  args: { nextDate: proposed },
  play: async ({ canvas, userEvent, args }) => {
    await expect(canvas.getByText('To confirm')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm' }));
    await expect(args.action).toHaveBeenCalled();
  },
};

/** A viewer: the state is shown, `Confirm` is absent. */
export const ReadOnly: Story = {
  args: { nextDate: proposed, canWrite: false },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Confirm' })).toBeNull();
  },
};

export const Offline: Story = {
  args: { nextDate: proposed, offline: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  },
};

export const Failed: Story = {
  args: {
    nextDate: proposed,
    action: fn<ConfirmNextDateAction>(() =>
      Promise.resolve({ ok: false, error: { code: 'INTERNAL', message: '' } }),
    ),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm' }));
    await expect(await canvas.findByRole('alert')).toBeVisible();
  },
};

export const NoNextDate: Story = {
  args: { nextDate: null },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No next date')).toBeVisible();
  },
};

export const Tamil: Story = {
  args: { nextDate: listing({ stage: 'hearing', text: 'திங்., 02 நவ. 2026' }) },
  globals: { locale: 'ta' },
};

export const Kannada: Story = {
  args: { nextDate: listing({ stage: 'hearing', text: 'ಸೋಮ, 02 ನವೆಂ 2026' }) },
  globals: { locale: 'kn' },
};
