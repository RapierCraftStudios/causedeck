// check-stories: n/a Disabled, Invalid (a listing has no disabled or invalid state; it comes from the cause list)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { COURT_ITEMS, PATTERN_INDIC } from '../__fixtures__/trust';
import { LISTING_STAGES } from '../types';
import { CourtItemChip, CourtItemChipSkeleton } from './court-item-chip';

const meta = {
  title: 'Patterns/CourtItemChip',
  component: CourtItemChip,
  args: { ...COURT_ITEMS.morning, onSelect: fn() },
  decorators: [
    (Story) => (
      <div className="p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CourtItemChip>;

export default meta;
type Story = StoryObj<typeof meta>;

const selectOf = (canvasElement: HTMLElement) =>
  within(canvasElement).getByRole('button', { name: /^Item / });

export const Default: Story = {
  play: async ({ canvasElement }) => {
    // Named by its visible text, with spoken separators.
    await expect(selectOf(canvasElement)).toHaveAccessibleName(
      /^Item 12\s*,\s*Court Hall 4\s*,\s*Listed\s*,\s*10:30\s*,\s*Before lunch$/,
    );
  },
};

export const Hover: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.hover(selectOf(canvasElement));
  },
};

export const FocusVisible: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await expect(selectOf(canvasElement)).toHaveFocus();
  },
};

export const Active: Story = {
  play: async ({ canvasElement, args }) => {
    selectOf(canvasElement).focus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onSelect).toHaveBeenCalledOnce();
  },
};

export const Loading: Story = {
  render: () => <CourtItemChipSkeleton />,
};

/** Time-of-day cues: before lunch, after lunch. */
export const WithIcon: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-2">
      <CourtItemChip {...COURT_ITEMS.morning} />
      <CourtItemChip {...COURT_ITEMS.afternoon} />
      <CourtItemChip {...COURT_ITEMS.defects} />
    </div>
  ),
};

export const LongText: Story = {
  args: { hall: 'Court Hall 12, Hon’ble Division Bench (Writ Appeals and connected matters)' },
  decorators: [
    (Story) => (
      <div className="max-w-80">
        <Story />
      </div>
    ),
  ],
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
    hall: 'நீதிமன்ற அறை 4',
    stageLabel: PATTERN_INDIC.ta.listed,
    labels: { item: (n) => `வரிசை ${String(n)}` },
  },
};

export const Kannada: Story = {
  args: {
    hall: 'ನ್ಯಾಯಾಲಯ ಸಭಾಂಗಣ 4',
    stageLabel: PATTERN_INDIC.kn.listed,
    labels: { item: (n) => `ಕ್ರಮ ${String(n)}` },
  },
};

/** Every listing stage. */
export const Stages: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-2">
      {LISTING_STAGES.map((stage, i) => (
        <CourtItemChip key={stage} {...COURT_ITEMS.afternoon} itemNo={60 + i} stage={stage} />
      ))}
    </div>
  ),
};
