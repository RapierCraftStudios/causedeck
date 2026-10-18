import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { FileUp, Save } from 'lucide-react';
import { expect, fn, userEvent, within } from 'storybook/test';

import { INDIC, LONG_LABEL } from '../__fixtures__/labels';
import { Button } from './button';

const VARIANTS = ['primary', 'secondary', 'ghost', 'outline', 'destructive', 'link'] as const;
const SIZES = ['sm', 'md', 'lg'] as const;

const meta = {
  title: 'Components/Button',
  component: Button,
  args: { children: 'Save draft', onClick: fn() },
  argTypes: {
    variant: { control: 'inline-radio', options: VARIANTS },
    size: { control: 'inline-radio', options: SIZES },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save draft' }));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      {VARIANTS.map((variant) => (
        <Button key={variant} {...args} variant={variant}>
          {variant}
        </Button>
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      {SIZES.map((size) => (
        <Button key={size} {...args} size={size}>
          {size}
        </Button>
      ))}
    </div>
  ),
  play: async ({ canvas }) => {
    const heights = SIZES.map(
      (size) => canvas.getByRole('button', { name: size }).getBoundingClientRect().height,
    );
    await expect(heights).toEqual([32, 36, 44]);
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    const button = canvas.getByRole('button');
    await userEvent.hover(button);
    await expect(button).toBeEnabled();
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    const button = canvas.getByRole('button');
    await expect(button).toHaveFocus();
    await expect(button.matches(':focus-visible')).toBe(true);
  },
};

/** Press and hold: every variant has an `active:` style; releasing the pointer clicks. */
export const Active: Story = {
  play: async ({ canvas, args }) => {
    const button = canvas.getByRole('button');
    await expect(button.className).toMatch(/\bactive:/);
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: button },
      { keys: '[/MouseLeft]', target: button },
    ]);
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvas, args }) => {
    const button = canvas.getByRole('button');
    await expect(button).toBeDisabled();
    await userEvent.click(button, { pointerEventsCheck: 0 });
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

export const Loading: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <Button {...args}>Save draft</Button>
      <Button {...args} loading>
        Save draft
      </Button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [idle, busy] = canvas.getAllByRole('button');
    if (!idle || !busy) throw new Error('expected two buttons');
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute('aria-busy', 'true');
    await expect(canvas.getByRole('button', { name: 'Save draft Loading' })).toBe(busy);
    // No layout shift: the loading button keeps the idle button's box.
    const a = idle.getBoundingClientRect();
    const b = busy.getBoundingClientRect();
    await expect([b.width, b.height]).toEqual([a.width, a.height]);
  },
};

export const Invalid: Story = {
  args: { 'aria-invalid': true, variant: 'outline', children: 'Fix 2 errors' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button')).toHaveAttribute('aria-invalid', 'true');
  },
};

export const WithIcon: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <Button {...args}>
        <Save aria-hidden="true" />
        Save draft
      </Button>
      <Button {...args} variant="outline">
        <FileUp aria-hidden="true" />
        Upload
      </Button>
    </div>
  ),
};

export const LongText: Story = {
  args: { children: LONG_LABEL },
  render: (args) => (
    <div className="max-w-80">
      <Button {...args} className="max-w-full">
        <span className="truncate">{args.children}</span>
      </Button>
    </div>
  ),
  play: async ({ canvas }) => {
    const button = canvas.getByRole('button', { name: LONG_LABEL });
    await expect(button.getBoundingClientRect().width).toBeLessThanOrEqual(320);
  },
};

/** Layout uses logical properties and gap, so the icon follows the reading direction. */
export const RtlNeutral: Story = {
  render: (args) => (
    <div dir="rtl" className="flex items-center gap-3">
      <Button {...args}>
        <Save aria-hidden="true" />
        Save draft
      </Button>
      <Button {...args} loading>
        Save draft
      </Button>
    </div>
  ),
};

export const Tamil: Story = {
  render: (args) => (
    <div lang="ta" className="flex items-center gap-3">
      <Button {...args}>{INDIC.ta.save}</Button>
      <Button {...args} variant="outline">
        <FileUp aria-hidden="true" />
        {INDIC.ta.upload}
      </Button>
      <Button {...args} loading labels={{ loading: INDIC.ta.loading }}>
        {INDIC.ta.save}
      </Button>
    </div>
  ),
};

export const Kannada: Story = {
  render: (args) => (
    <div lang="kn" className="flex items-center gap-3">
      <Button {...args}>{INDIC.kn.save}</Button>
      <Button {...args} variant="outline">
        <FileUp aria-hidden="true" />
        {INDIC.kn.upload}
      </Button>
      <Button {...args} loading labels={{ loading: INDIC.kn.loading }}>
        {INDIC.kn.save}
      </Button>
    </div>
  ),
};

export const AsLink: Story = {
  render: (args) => (
    <Button asChild variant={args.variant ?? 'primary'}>
      <a href="#matters">Open matters</a>
    </Button>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Open matters' })).toHaveAttribute(
      'data-slot',
      'button',
    );
  },
};
