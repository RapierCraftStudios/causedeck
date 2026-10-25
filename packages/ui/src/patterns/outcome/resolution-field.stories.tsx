import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { ResolutionField } from './resolution-field';

const meta = {
  title: 'Patterns/Outcome/ResolutionField',
  component: ResolutionField,
  args: {
    proposed: '10/04/2026',
    source: <span>Voice note</span>,
    resolution: { kind: 'unresolved' },
    onResolve: fn(),
    onTypedText: fn(),
  },
} satisfies Meta<typeof ResolutionField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A confident proposal still needs the lawyer's action: nothing is pressed. */
export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Confirm 10/04/2026' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm 10/04/2026' }));
    await expect(args.onResolve).toHaveBeenCalledWith({
      kind: 'value',
      value: '10/04/2026',
      source: 'proposal',
    });
  },
};

/** Empty: no anchored date, so only typing, none or deferred are offered. */
export const Empty: Story = {
  args: { proposed: undefined, source: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: /^Confirm/ })).toBeNull();
    await expect(canvas.getByRole('button', { name: 'No next date / disposed' })).toBeVisible();
  },
};

export const Loading: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'To be notified' }),
    ).toBeDisabled();
  },
};

export const ErrorState: Story = {
  args: { typedText: '31/02/2026', typedError: 'Enter a real date as dd/mm/yyyy.' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('real date');
  },
};

export const Offline: Story = {
  args: { resolution: { kind: 'deferred' } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'To be notified' }),
    ).toHaveAttribute('aria-pressed', 'true');
  },
};

export const Denied: Story = {
  args: { disabled: true, resolution: { kind: 'none' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('group', { name: 'Next date' })).toBeDisabled();
  },
};
