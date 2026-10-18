import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { MEMORIES, NOW, SOURCES } from '../__fixtures__/trust';
import { OfflineBanner } from '../states/offline-banner';
import { MEMORY_SCOPES } from '../types';
import { MemoryCard, MemoryCardSkeleton } from './memory-card';

const meta = {
  title: 'Patterns/MemoryCard',
  component: MemoryCard,
  args: { ...MEMORIES.M2, onConfirm: fn(), onEdit: fn(), onDelete: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-md p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MemoryCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const button = (canvasElement: HTMLElement, name: RegExp) =>
  within(canvasElement).getByRole('button', { name });

/** A proposed memory: Lawyer OS saves it only after you confirm. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Working preferences')).toBeInTheDocument();
    await expect(button(canvasElement, /^Confirm memory/)).toBeEnabled();
  },
};

export const Hover: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.hover(button(canvasElement, /^Confirm memory/));
  },
};

export const FocusVisible: Story = {
  play: async ({ canvasElement }) => {
    const confirm = button(canvasElement, /^Confirm memory/);
    while (document.activeElement !== confirm) await userEvent.tab();
    await expect(confirm.matches(':focus-visible')).toBe(true);
  },
};

/** Confirm, Edit and Delete call back with nothing else. */
export const Active: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(button(canvasElement, /^Confirm memory/));
    await userEvent.click(button(canvasElement, /^Edit memory/));
    await userEvent.click(button(canvasElement, /^Delete memory/));
    await expect(args.onConfirm).toHaveBeenCalledOnce();
    await expect(args.onEdit).toHaveBeenCalledOnce();
    await expect(args.onDelete).toHaveBeenCalledOnce();
  },
};

/** Offline: actions are disabled and the card says why. */
export const Disabled: Story = {
  args: { offline: true },
  play: async ({ canvasElement }) => {
    await expect(button(canvasElement, /^Confirm memory/)).toBeDisabled();
  },
};

export const Loading: Story = {
  render: () => <MemoryCardSkeleton />,
};

export const Invalid: Story = {
  args: { error: 'Could not save this memory. Try again.' },
};

/** One card per scope, M1-M7. */
export const WithIcon: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      {MEMORY_SCOPES.map((scope) => (
        <MemoryCard
          key={scope}
          {...MEMORIES[scope]}
          onConfirm={args.onConfirm}
          onEdit={args.onEdit}
          onDelete={args.onDelete}
        />
      ))}
    </div>
  ),
};

export const LongText: Story = {
  args: {
    title: 'Briefing counsel for Malnad Coffee Growers and connected petitions',
    value:
      'Wants a WhatsApp summary after each hearing with the next date, what the bench said and the documents to carry, in English and Kannada',
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
  args: {
    ...MEMORIES.M6,
    value: 'தமிழில் புதுப்பிப்புகளை விரும்புகிறார்',
    source: SOURCES.tamil,
  },
};

export const Kannada: Story = {
  args: {
    ...MEMORIES.M4,
    value: 'ಊಟದ ನಂತರ ಹೊಸ ಅರ್ಜಿಗಳನ್ನು ಕೇಳುತ್ತದೆ',
    source: SOURCES.kannada,
  },
};

/** Confirmed: no Confirm, Edit and Delete stay. */
export const Confirmed: Story = {
  args: { ...MEMORIES.M3 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: /^Confirm/ })).toBeNull();
  },
};

export const PermissionDenied: Story = {
  args: { viewOnly: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('View only')).toBeInTheDocument();
  },
};

/** Offline: the banner says when memory was saved; Confirm, Edit and Delete are disabled. */
export const Offline: Story = {
  args: { offline: true },
  render: (args) => (
    <div className="flex flex-col gap-3">
      <OfflineBanner savedAt={NOW} />
      <MemoryCard {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/^You are offline\. Showing saved data/),
    ).toBeVisible();
    await expect(button(canvasElement, /^Edit memory/)).toBeDisabled();
  },
};
