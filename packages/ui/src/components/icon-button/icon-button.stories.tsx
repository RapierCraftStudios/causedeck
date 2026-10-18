import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Pencil, Trash2, Upload } from 'lucide-react';
import { expect, fn, userEvent } from 'storybook/test';

import { INDIC, LONG_LABEL } from '../__fixtures__/labels';
import { IconButton } from './icon-button';

const VARIANTS = ['primary', 'secondary', 'ghost', 'outline', 'destructive'] as const;
const SIZES = ['sm', 'md', 'lg'] as const;

const meta = {
  title: 'Components/IconButton',
  component: IconButton,
  args: { label: 'Edit matter', children: <Pencil />, onClick: fn() },
  argTypes: {
    variant: { control: 'inline-radio', options: VARIANTS },
    size: { control: 'inline-radio', options: SIZES },
  },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Edit matter' }));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

export const Variants: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      {VARIANTS.map((variant) => (
        <IconButton key={variant} {...args} variant={variant} label={`Edit (${variant})`} />
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      {SIZES.map((size) => (
        <IconButton key={size} {...args} size={size} label={`Edit ${size}`} />
      ))}
    </div>
  ),
  play: async ({ canvas }) => {
    const boxes = SIZES.map((size) =>
      canvas.getByRole('button', { name: `Edit ${size}` }).getBoundingClientRect(),
    );
    await expect(boxes.map((b) => [b.width, b.height])).toEqual([
      [32, 32],
      [36, 36],
      [44, 44],
    ]);
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    const button = canvas.getByRole('button');
    await userEvent.hover(button);
    await expect(button).toHaveAttribute('title', 'Edit matter');
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.tab();
    const button = canvas.getByRole('button');
    await expect(button).toHaveFocus();
    await expect(button.matches(':focus-visible')).toBe(true);
    await userEvent.keyboard('{Enter}');
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

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
  args: { loading: true, variant: 'secondary' },
  play: async ({ canvas }) => {
    const button = canvas.getByRole('button', { name: 'Edit matter Loading' });
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect(button.getBoundingClientRect().width).toBe(36);
  },
};

export const Invalid: Story = {
  args: {
    'aria-invalid': true,
    variant: 'outline',
    label: 'Upload failed, retry',
    children: <Upload />,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button')).toHaveAttribute('aria-invalid', 'true');
  },
};

export const WithIcon: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <IconButton {...args} label="Edit matter">
        <Pencil />
      </IconButton>
      <IconButton {...args} variant="destructive" label="Delete draft">
        <Trash2 />
      </IconButton>
    </div>
  ),
};

/** The label is the accessible name and native tooltip; the button stays square. */
export const LongText: Story = {
  args: { label: LONG_LABEL },
  play: async ({ canvas }) => {
    const button = canvas.getByRole('button', { name: LONG_LABEL });
    await expect(button.getBoundingClientRect().width).toBe(36);
  },
};

export const RtlNeutral: Story = {
  render: (args) => (
    <div dir="rtl" className="flex items-center gap-3">
      <IconButton {...args} />
      <IconButton {...args} loading />
    </div>
  ),
};

export const Tamil: Story = {
  render: (args) => (
    <div lang="ta" className="flex items-center gap-3">
      <IconButton {...args} label={INDIC.ta.upload}>
        <Upload />
      </IconButton>
      <IconButton {...args} label={INDIC.ta.save} loading labels={{ loading: INDIC.ta.loading }} />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: INDIC.ta.upload })).toBeInTheDocument();
  },
};

export const Kannada: Story = {
  render: (args) => (
    <div lang="kn" className="flex items-center gap-3">
      <IconButton {...args} label={INDIC.kn.upload}>
        <Upload />
      </IconButton>
      <IconButton {...args} label={INDIC.kn.save} loading labels={{ loading: INDIC.kn.loading }} />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: INDIC.kn.upload })).toBeInTheDocument();
  },
};
