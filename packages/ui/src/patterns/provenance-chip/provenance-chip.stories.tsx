import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { ANCHORS, SOURCES } from '../__fixtures__/trust';
import type { ProvenanceSource } from '../types';
import { ProvenanceChip, ProvenanceChipSkeleton } from './provenance-chip';

const meta = {
  title: 'Patterns/ProvenanceChip',
  component: ProvenanceChip,
  args: {
    source: SOURCES.confirmed,
    anchor: ANCHORS.madras,
    presentation: 'popover',
    onOpenSource: fn(),
    onReportWrong: fn(),
  },
  argTypes: {
    presentation: { control: 'inline-radio', options: ['auto', 'popover', 'sheet'] },
  },
  // Room above the chip for the popover, which opens upwards.
  decorators: [
    (Story) => (
      <div className="flex min-h-96 items-end justify-center p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProvenanceChip>;

export default meta;
type Story = StoryObj<typeof meta>;

const chipOf = (canvasElement: HTMLElement) =>
  within(canvasElement).getByRole('button', { name: /^Source:/ });
const body = () => within(document.body);

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const chip = chipOf(canvasElement);
    await expect(chip).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(chip).toHaveAccessibleName(
      'Source: Order, p.2, from Order dated 12 March 2026, page 2. Confirmed.',
    );
  },
};

/** Hover lifts the chip, turns the border brass and opens the hover card. */
export const Hover: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.hover(chipOf(canvasElement));
    const card = await body().findByRole('tooltip');
    await expect(card).toHaveTextContent('Page 2 of 5 · Extracted by Lawyer OS · 97% confidence');
  },
};

/** Keyboard focus opens the card as a description; focus stays on the chip. */
export const FocusVisible: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    const chip = chipOf(canvasElement);
    await expect(chip).toHaveFocus();
    await expect(chip.matches(':focus-visible')).toBe(true);
    await expect(await body().findByRole('tooltip')).toBeInTheDocument();
  },
};

/** Enter or Space opens the card as a dialog and moves focus in; Esc closes and returns focus. */
export const Active: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.tab();
    const chip = chipOf(canvasElement);
    await userEvent.keyboard('{Enter}');
    const dialog = await body().findByRole('dialog');
    const open = within(dialog).getByRole('button', { name: 'Open source' });
    await waitFor(() => expect(open).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(body().queryByRole('dialog')).toBeNull());
    await expect(chip).toHaveFocus();
    await userEvent.keyboard(' ');
    await userEvent.click(
      within(await body().findByRole('dialog')).getByRole('button', { name: 'Open source' }),
    );
    await expect(args.onOpenSource).toHaveBeenCalledOnce();
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    await expect(chipOf(canvasElement)).toBeDisabled();
  },
};

/** Loading skeleton with the chip's footprint. */
export const Loading: Story = {
  render: () => <ProvenanceChipSkeleton />,
};

/** Error: the lawyer rejected this source; it stays visible, struck through. */
export const Invalid: Story = {
  args: { source: SOURCES.rejected, anchor: undefined },
  play: async ({ canvasElement }) => {
    await expect(chipOf(canvasElement)).toHaveAccessibleName(/Rejected/);
  },
};

const KINDS: ProvenanceSource[] = [
  SOURCES.confirmed,
  SOURCES.lowConfidence,
  SOURCES.adapter,
  SOURCES.proposed,
  SOURCES.import,
  SOURCES.manual,
  SOURCES.system,
];

/** Every source kind with its icon. */
export const WithIcon: Story = {
  render: (args) => (
    <div className="flex max-w-xl flex-wrap gap-2">
      {KINDS.map((source) => (
        <ProvenanceChip key={source.kind} {...args} source={source} anchor={undefined} />
      ))}
    </div>
  ),
};

export const LongText: Story = {
  args: { source: SOURCES.longLabel },
  decorators: [
    (Story) => (
      <div className="max-w-60">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    await expect(chipOf(canvasElement).getBoundingClientRect().width).toBeLessThanOrEqual(240);
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
  args: { source: SOURCES.tamil, anchor: ANCHORS.tamil, defaultOpen: true },
  decorators: [
    (Story) => (
      <div lang="ta">
        <Story />
      </div>
    ),
  ],
};

export const Kannada: Story = {
  args: { source: SOURCES.kannada, anchor: ANCHORS.kannada, defaultOpen: true },
  decorators: [
    (Story) => (
      <div lang="kn">
        <Story />
      </div>
    ),
  ],
};

export const Proposed: Story = {
  args: { source: SOURCES.proposed, anchor: ANCHORS.karnataka },
};

export const Edited: Story = {
  args: { source: SOURCES.edited, anchor: undefined },
};

/** Facts the lawyer typed in: pencil mark and `Entered by you`. */
export const Manual: Story = {
  args: { source: SOURCES.manual, anchor: undefined },
  play: async ({ canvasElement }) => {
    await expect(chipOf(canvasElement)).toHaveTextContent('Entered by you');
  },
};

/** Confidence below 90% shows the dot. */
export const LowConfidence: Story = {
  args: { source: SOURCES.lowConfidence, anchor: undefined },
};

/** The popover as it opens: quote in serif italic with the matched span marked. */
export const PopoverOpen: Story = {
  args: { defaultOpen: true },
};

/** Offline: the source still opens; its actions are disabled with the reason. */
export const Offline: Story = {
  args: { offline: true, defaultOpen: true },
  play: async () => {
    await expect(await body().findByRole('button', { name: 'Open source' })).toBeDisabled();
  },
};

/** Permission denied: actions are hidden behind a view-only note. */
export const PermissionDenied: Story = {
  args: { viewOnly: true, defaultOpen: true },
  play: async () => {
    await expect(await body().findByText(/View only/)).toBeInTheDocument();
    await expect(body().queryByRole('button', { name: 'Open source' })).toBeNull();
  },
};

/** Touch: a tap opens a bottom sheet dialog; hover does nothing. */
export const MobileSheet: Story = {
  args: { presentation: 'sheet' },
  play: async ({ canvasElement }) => {
    const chip = chipOf(canvasElement);
    await userEvent.hover(chip);
    await expect(body().queryByRole('dialog')).toBeNull();
    await userEvent.click(chip);
    await expect(
      await body().findByRole('dialog', { name: 'Order dated 12 March 2026' }),
    ).toBeInTheDocument();
  },
};
