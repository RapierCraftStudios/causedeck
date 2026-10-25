import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { SourceCompare } from './source-compare';

const meta = {
  title: 'Patterns/Outcome/SourceCompare',
  component: SourceCompare,
  args: {
    title: 'The next date differs from the one on file',
    current: {
      label: 'On file',
      value: '01/04/2026',
      source: 'Cause list',
      chooseLabel: 'Keep this date',
    },
    proposed: {
      label: 'Proposed',
      value: '10/04/2026',
      source: 'Voice note',
      chooseLabel: 'Use this date',
    },
    onChoose: fn(),
  },
} satisfies Meta<typeof SourceCompare>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Both dates side by side with their sources; nothing changes until one is picked. */
export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('01/04/2026')).toBeVisible();
    await expect(canvas.getByText('10/04/2026')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Keep this date' }));
    await expect(args.onChoose).toHaveBeenCalledWith('current');
  },
};

export const Empty: Story = {
  args: { chosen: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole('button')).toHaveLength(2);
  },
};

export const Loading: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Use this date' }),
    ).toBeDisabled();
  },
};

export const ErrorState: Story = {
  args: { chosen: 'proposed' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Use this date' }),
    ).toBeVisible();
  },
};

export const Offline: Story = {
  args: { chosen: 'current' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Keep this date' }),
    ).toBeVisible();
  },
};

export const Denied: Story = {
  args: { disabled: true, chosen: 'current' },
  play: async ({ canvasElement }) => {
    for (const button of within(canvasElement).getAllByRole('button'))
      await expect(button).toBeDisabled();
  },
};
