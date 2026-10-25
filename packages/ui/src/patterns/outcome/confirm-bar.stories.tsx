import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { ConfirmBar } from './confirm-bar';

const meta = {
  title: 'Patterns/Outcome/ConfirmBar',
  component: ConfirmBar,
  args: { confirmLabel: 'Confirm outcome', shortcut: 'Ctrl Enter', onConfirm: fn() },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ConfirmBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Ready: every decision made, Confirm is enabled. */
export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Confirm outcome' });
    await userEvent.click(button);
    await expect(args.onConfirm).toHaveBeenCalledTimes(1);
  },
};

/** Empty: nothing decided yet, Confirm is disabled and the reason is described. */
export const Empty: Story = {
  args: { blockedReason: 'Choose the next date, or mark it none or to be notified.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Confirm outcome' });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAccessibleDescription(/next date/);
  },
};

export const Loading: Story = {
  args: { pending: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Confirm outcome' }),
    ).toBeDisabled();
  },
};

export const ErrorState: Story = {
  args: { note: <p role="alert">Couldn't confirm the outcome. Try again.</p> },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent("Couldn't confirm");
  },
};

export const Offline: Story = {
  args: {
    note: <p>Saved on this device. It will be applied when you are back online.</p>,
    status: 'Saved on this device.',
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent(
      'Saved on this device.',
    );
  },
};

export const Denied: Story = {
  args: { blockedReason: 'You cannot confirm outcomes.' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Confirm outcome' }),
    ).toBeDisabled();
  },
};
