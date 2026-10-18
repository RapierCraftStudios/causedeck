// check-stories: n/a Loading (a toggle applies instantly; pending saves show on the surrounding form)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Flame } from 'lucide-react';
import { expect, fn, userEvent } from 'storybook/test';

import { INDIC_FORM, LONG_LABEL } from '../__fixtures__/labels';
import { Toggle } from './toggle';

const meta = {
  title: 'Components/Toggle',
  component: Toggle,
  args: { children: 'Urgent only', onPressedChange: fn() },
  argTypes: {
    variant: { control: 'inline-radio', options: ['default', 'outline'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
  },
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, args }) => {
    const toggle = canvas.getByRole('button', { name: 'Urgent only' });
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(args.onPressedChange).toHaveBeenCalledWith(true);
  },
};

export const Sizes: Story = {
  args: { variant: 'outline' },
  render: (args) => (
    <div className="flex items-center gap-3">
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <Toggle key={size} {...args} size={size}>
          {size}
        </Toggle>
      ))}
    </div>
  ),
  play: async ({ canvas }) => {
    const heights = ['sm', 'md', 'lg'].map(
      (name) => canvas.getByRole('button', { name }).getBoundingClientRect().height,
    );
    await expect(heights).toEqual([32, 36, 44]);
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByRole('button'));
    await expect(canvas.getByRole('button').className).toMatch(/\bhover:bg-surface-sunken\b/);
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('button')).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(canvas.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  },
};

export const Active: Story = {
  args: { defaultPressed: true, variant: 'outline' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button')).toHaveAttribute('data-state', 'on');
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button')).toBeDisabled();
  },
};

export const Invalid: Story = {
  args: { 'aria-invalid': true, variant: 'outline' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button')).toHaveAttribute('aria-invalid', 'true');
  },
};

export const WithIcon: Story = {
  args: {
    children: (
      <>
        <Flame aria-hidden="true" />
        Urgent only
      </>
    ),
  },
};

export const IconOnly: Story = {
  args: { 'aria-label': 'Urgent only', children: <Flame aria-hidden="true" />, variant: 'outline' },
};

export const LongText: Story = {
  args: { children: <span className="truncate">{LONG_LABEL}</span>, className: 'max-w-80' },
};

export const RtlNeutral: Story = {
  args: { ...WithIcon.args, defaultPressed: true },
  decorators: [
    (Story) => (
      <div dir="rtl">
        <Story />
      </div>
    ),
  ],
};

export const Tamil: Story = {
  args: { children: INDIC_FORM.ta.urgent, variant: 'outline' },
  decorators: [
    (Story) => (
      <div lang="ta">
        <Story />
      </div>
    ),
  ],
};

export const Kannada: Story = {
  args: { children: INDIC_FORM.kn.urgent, variant: 'outline' },
  decorators: [
    (Story) => (
      <div lang="kn">
        <Story />
      </div>
    ),
  ],
};
