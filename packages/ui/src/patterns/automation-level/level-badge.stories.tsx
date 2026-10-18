// check-stories: n/a Invalid (a level is static metadata; it has no invalid state)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { PATTERN_INDIC } from '../__fixtures__/trust';
import { PatternSkeleton } from '../states/loading-skeletons';
import { LEVELS } from '../types';
import { LevelBadge } from './level-badge';
import { LevelLegend } from './level-legend';

const meta = {
  title: 'Patterns/LevelBadge',
  component: LevelBadge,
  args: { level: 'L2', onLearnMore: fn() },
  argTypes: { level: { control: 'inline-radio', options: LEVELS } },
  decorators: [
    (Story) => (
      <div className="flex min-h-40 items-end justify-center p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LevelBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

const badgeOf = (canvasElement: HTMLElement) =>
  within(canvasElement).getByRole('button', { name: /^Automation level/ });

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(badgeOf(canvasElement)).toHaveTextContent('Needs your confirmation');
  },
};

/** Every level: ladder filled to the level, label and colour. */
export const AllLevels: Story = {
  render: (args) => (
    <div className="flex flex-col items-start gap-2">
      {LEVELS.map((level) => (
        <LevelBadge key={level} {...args} level={level} />
      ))}
    </div>
  ),
};

export const Hover: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.hover(badgeOf(canvasElement));
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent(
      'It applies only after you confirm it.',
    );
  },
};

export const FocusVisible: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    const badge = badgeOf(canvasElement);
    await expect(badge).toHaveFocus();
    await expect(badge.matches(':focus-visible')).toBe(true);
  },
};

/** Pressing the badge opens the privacy page through the callback. */
export const Active: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(badgeOf(canvasElement));
    await expect(args.onLearnMore).toHaveBeenCalledOnce();
  },
};

/** Without a callback the badge is a static label that still explains itself on focus. */
export const Disabled: Story = {
  render: (args) => <LevelBadge level={args.level} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button')).toBeNull();
  },
};

export const WithIcon: Story = {
  args: { level: 'L3' },
};

export const LongText: Story = {
  args: { level: 'L4' },
  decorators: [
    (Story) => (
      <div className="max-w-32">
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
  render: (args) => (
    <div lang="ta" className="flex flex-col items-start gap-2">
      <LevelBadge {...args} level="L1" />
      <span className="text-ink text-sm">{PATTERN_INDIC.ta.suggested}</span>
    </div>
  ),
};

export const Kannada: Story = {
  render: (args) => (
    <div lang="kn" className="flex flex-col items-start gap-2">
      <LevelBadge {...args} level="L1" />
      <span className="text-ink text-sm">{PATTERN_INDIC.kn.suggested}</span>
    </div>
  ),
};

/** The legend lists every level with its meaning. */
export const Legend: Story = {
  render: (args) => <LevelLegend className="max-w-sm" onLearnMore={args.onLearnMore} />,
};

/** The 20 px placeholder while the row it belongs to loads. */
export const Loading: Story = {
  render: () => <PatternSkeleton pattern="level-badge" />,
};
