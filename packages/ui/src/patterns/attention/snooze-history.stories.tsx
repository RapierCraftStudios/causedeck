// check-stories: n/a Hover, FocusVisible, Active, Disabled, Loading, Invalid, WithIcon, RtlNeutral (the lift button is a plain button; Pending covers the busy state; no icon, invalid or RTL variant)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { SnoozeHistory } from './snooze-history';

const ITEMS = [
  {
    id: 's1',
    ruleLabel: 'No next date',
    statusText: 'Snoozed until 2026-11-20',
    reasonText: 'Reason: waiting for the registry',
  },
  { id: 's2', ruleLabel: 'All flags', statusText: 'Dismissed as intentionally dormant' },
];

const meta = {
  title: 'Patterns/SnoozeHistory',
  component: SnoozeHistory,
  args: {
    title: 'Snoozes and dismissals',
    empty: 'No snoozes or dismissals on this matter.',
    liftLabel: 'Lift snooze',
    items: ITEMS,
    onLift: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-2xl p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SnoozeHistory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Snoozed until 2026-11-20')).toBeInTheDocument();
    await userEvent.click(c.getAllByRole('button', { name: 'Lift snooze' })[0] as HTMLElement);
    await expect(args.onLift).toHaveBeenCalledWith('s1');
  },
};
export const Empty: Story = { args: { items: [] } };
export const ReadOnly: Story = {
  render: (args) => (
    <SnoozeHistory
      title={args.title}
      empty={args.empty}
      liftLabel={args.liftLabel}
      items={args.items}
    />
  ),
};
export const Pending: Story = { args: { pending: true } };

export const LongText: Story = {
  args: {
    items: [
      {
        id: 'l1',
        ruleLabel: 'No next date recorded since the last hearing',
        statusText: 'Snoozed until 2026-11-20 by the supervising advocate',
        reasonText:
          'Reason: waiting for the registry to publish the corrected cause list for the bench after the vacation',
      },
    ],
  },
};
export const Tamil: Story = {
  args: {
    items: [
      { id: 't1', ruleLabel: 'அடுத்த தேதி இல்லை', statusText: '2026-11-20 வரை ஒத்திவைக்கப்பட்டது' },
    ],
  },
};
export const Kannada: Story = {
  args: {
    items: [
      { id: 'k1', ruleLabel: 'ಮುಂದಿನ ದಿನಾಂಕ ಇಲ್ಲ', statusText: '2026-11-20 ರವರೆಗೆ ಮುಂದೂಡಲಾಗಿದೆ' },
    ],
  },
};
