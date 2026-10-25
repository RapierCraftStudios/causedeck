import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { ScopeChip } from '../scope-chip/scope-chip';
import { ProposalTray } from './proposal-tray';

const proposals = [
  {
    id: 'p1',
    title: 'Papers to carry',
    statement: 'You usually carry the vakalat copy for first hearings. Remember this?',
    evidence: 'Added by hand in 3 briefs',
    scopeChip: <ScopeChip scope="user" />,
  },
  {
    id: 'p2',
    title: 'Brief format',
    statement: 'One page, headnote first.',
    evidence: 'Edited the same way 3 times',
    scopeChip: <ScopeChip scope="user" />,
  },
];

const meta = {
  title: 'Patterns/ProposalTray',
  component: ProposalTray,
  args: { proposals, onSave: fn(), onEdit: fn(), onDismiss: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-sm p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProposalTray>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Save: Papers to carry' }));
    await expect(args.onSave).toHaveBeenCalledWith('p1');
  },
};
export const Empty: Story = { args: { proposals: [] } };
export const Loading: Story = { args: { disabled: true } };
export const Error: Story = { args: { disabled: true, proposals: proposals.slice(0, 1) } };
export const Offline: Story = { args: { offline: true } };
export const Denied: Story = { args: { viewOnly: true } };
