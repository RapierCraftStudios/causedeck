import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { Toaster } from '../../components/sonner';
import { ACTIVITIES, NOW, SOURCES } from '../__fixtures__/trust';
import { ActivityEmpty, ActivityItem, ActivityItemSkeleton } from './activity-item';

const meta = {
  title: 'Patterns/ActivityItem',
  component: ActivityItem,
  args: { ...ACTIVITIES.attached, now: NOW, onUndo: fn(), onRedo: fn(), onOpenSource: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-2xl p-4">
        <Story />
        <Toaster />
      </div>
    ),
  ],
} satisfies Meta<typeof ActivityItem>;

export default meta;
type Story = StoryObj<typeof meta>;

const body = () => within(document.body);
const undoOf = (canvasElement: HTMLElement) =>
  within(canvasElement).getByRole('button', { name: 'Undo' });

/** Who, what, source, level and time; Undo with the 7-day countdown at right. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(undoOf(canvasElement)).toHaveAccessibleDescription('Undo available for 6 days');
    await expect(canvasElement.querySelector('[data-slot="level-badge"]')).toHaveAttribute(
      'data-level',
      'L3',
    );
  },
};

/** Hovering the time shows the absolute date and time. */
export const Hover: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByText('yesterday'));
    await expect(await body().findByRole('tooltip')).toHaveTextContent('17 Oct 2026');
  },
};

/** Fully keyboard operable: Tab reaches the chip, the time and Undo in order. */
export const FocusVisible: Story = {
  play: async ({ canvasElement }) => {
    const undo = undoOf(canvasElement);
    while (document.activeElement !== undo) await userEvent.tab();
    await expect(undo.matches(':focus-visible')).toBe(true);
  },
};

/** Undo from the keyboard: the toast offers Redo and the live region announces `Undone`. */
export const Active: Story = {
  play: async ({ canvasElement, args }) => {
    const undo = undoOf(canvasElement);
    undo.focus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onUndo).toHaveBeenCalledOnce();
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('Undone');
    await expect(canvasElement.querySelector('[data-slot="activity-item"]')).toHaveAttribute(
      'data-undone',
    );
    const redo = await body().findByRole('button', { name: 'Redo' });
    redo.focus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onRedo).toHaveBeenCalledOnce();
    await waitFor(() => expect(undoOf(canvasElement)).toBeInTheDocument());
  },
};

/** Offline: Undo is disabled and says why. */
export const Disabled: Story = {
  args: { offline: true },
  play: async ({ canvasElement }) => {
    await expect(undoOf(canvasElement)).toBeDisabled();
    await expect(undoOf(canvasElement)).toHaveAccessibleDescription(/offline/);
  },
};

export const Loading: Story = {
  render: () => <ActivityItemSkeleton />,
};

/** Error: the undo failed. */
export const Invalid: Story = {
  args: { error: 'Could not undo. Try again.' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('Could not undo');
  },
};

/** A timeline: rail, icons, several sources and levels, one past its window. */
export const WithIcon: Story = {
  render: (args) => (
    <div>
      <ActivityItem {...args} />
      <ActivityItem {...ACTIVITIES.hearing} now={NOW} onUndo={args.onUndo} />
      <ActivityItem {...ACTIVITIES.expired} now={NOW} onUndo={args.onUndo} />
    </div>
  ),
};

export const LongText: Story = {
  args: {
    sentence:
      'Attached the order dated 12 March 2026 and the certified copy application receipt to W.P. No. 1234 of 2026 (M/s Kaveri Textiles v. State of Tamil Nadu) and moved the next hearing to 14 November 2026',
    source: SOURCES.longLabel,
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
  args: { ...ACTIVITIES.tamil },
  decorators: [
    (Story) => (
      <div lang="ta">
        <Story />
      </div>
    ),
  ],
};

export const Kannada: Story = {
  args: { ...ACTIVITIES.kannada },
  decorators: [
    (Story) => (
      <div lang="kn">
        <Story />
      </div>
    ),
  ],
};

/** The last day of the window counts hours. */
export const LastDay: Story = {
  args: { ...ACTIVITIES.hearing },
  play: async ({ canvasElement }) => {
    await expect(undoOf(canvasElement)).toHaveAccessibleDescription('Undo available for 4 hours');
  },
};

/** After 7 days the button is replaced by `Undo window ended`. */
export const Expired: Story = {
  args: { ...ACTIVITIES.expired },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Undo window ended')).toBeInTheDocument();
    await expect(within(canvasElement).queryByRole('button', { name: 'Undo' })).toBeNull();
  },
};

/** Undone rows fade (icon and rail to 60%, text muted and struck through) with an `Undone` label. */
export const Undone: Story = {
  args: { undone: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Undone')).toBeInTheDocument();
  },
};

/** Permission denied: Undo is hidden behind a view-only note. */
export const PermissionDenied: Story = {
  args: { viewOnly: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: 'Undo' })).toBeNull();
    await expect(within(canvasElement).getByText('View only')).toBeInTheDocument();
  },
};

export const Empty: Story = {
  render: () => <ActivityEmpty />,
};
