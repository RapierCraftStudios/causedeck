// check-stories: n/a Hover, FocusVisible, Active, Invalid, WithIcon (pointer and focus states come from ProposalCard; the tray has no icon or invalid state)
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
export const LongText: Story = {
  args: {
    proposals: [
      {
        id: 'p3',
        title: 'Papers to carry',
        statement:
          'You usually carry the vakalat copy, the certified order copy and the court fee receipts for first hearings in the High Court. Remember this?',
        evidence: 'Added by hand in 3 briefs',
      },
    ],
  },
};
export const RtlNeutral: Story = {
  decorators: [
    (Story) => (
      <div dir="rtl">
        <Story />
      </div>
    ),
  ],
};
export const Tamil: Story = {
  args: {
    proposals: [
      {
        id: 'p4',
        title: 'ஆவணங்கள்',
        statement: 'வக்காலத்து நகலை எடுத்துச் செல்லவா?',
        evidence: '3 சுருக்கங்களில்',
      },
    ],
  },
};
export const Kannada: Story = {
  args: {
    proposals: [
      {
        id: 'p5',
        title: 'ದಾಖಲೆಗಳು',
        statement: 'ವಕಾಲತ್ತು ಪ್ರತಿಯನ್ನು ಒಯ್ಯಬೇಕೇ?',
        evidence: '3 ಸಂಕ್ಷಿಪ್ತಗಳಲ್ಲಿ',
      },
    ],
  },
};
export const Disabled: Story = { args: { disabled: true } };
