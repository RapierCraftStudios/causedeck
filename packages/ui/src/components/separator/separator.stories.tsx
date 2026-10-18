// check-stories: n/a Hover, FocusVisible, Active, Disabled, Loading, Invalid, WithIcon, LongText, Tamil, Kannada (a decorative hairline: not interactive, renders no text)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { Separator } from './separator';

const meta = {
  title: 'Components/Separator',
  component: Separator,
  decorators: [
    (Story) => (
      <div className="text-ink w-72 font-sans text-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="grid gap-3">
      <p>Matter details</p>
      <Separator {...args} />
      <p>Hearings</p>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const line = canvasElement.querySelector('[data-slot="separator"]');
    await expect(line?.getBoundingClientRect().height).toBe(1);
  },
};

export const Vertical: Story = {
  render: () => (
    <div className="flex h-5 items-center gap-3">
      <span>Matters</span>
      <Separator orientation="vertical" decorative={false} />
      <span>Calendar</span>
    </div>
  ),
  play: async ({ canvas }) => {
    const line = canvas.getByRole('separator');
    await expect(line).toHaveAttribute('aria-orientation', 'vertical');
    await expect(line.getBoundingClientRect().width).toBe(1);
  },
};

export const RtlNeutral: Story = {
  render: () => (
    <div dir="rtl" className="flex h-5 items-center gap-3">
      <span>Matters</span>
      <Separator orientation="vertical" />
      <span>Calendar</span>
    </div>
  ),
};
