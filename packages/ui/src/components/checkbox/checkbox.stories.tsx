// check-stories: n/a Loading (a checkbox applies instantly; pending saves show on the surrounding form)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Flame } from 'lucide-react';
import type { ReactNode } from 'react';
import { expect, fn, userEvent } from 'storybook/test';

import { FORM, INDIC_FORM, LONG_LABEL } from '../__fixtures__/labels';
import { Field } from '../field/field';
import { Checkbox, type CheckboxProps } from './checkbox';

interface UrgentProps extends CheckboxProps {
  label?: ReactNode;
  error?: string;
}

function Urgent({ label = FORM.urgent.label, error, ...props }: UrgentProps) {
  return (
    <Field label={label} hint={FORM.urgent.hint} error={error} orientation="horizontal">
      <Checkbox {...props} />
    </Field>
  );
}

const meta = {
  title: 'Components/Checkbox',
  component: Urgent,
  args: { onCheckedChange: fn() },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Urgent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, args }) => {
    const box = canvas.getByRole('checkbox', { name: FORM.urgent.label });
    await userEvent.click(canvas.getByText(FORM.urgent.label));
    await expect(box).toBeChecked();
    await expect(args.onCheckedChange).toHaveBeenCalledWith(true);
  },
};

export const Checked: Story = { args: { defaultChecked: true } };

export const Indeterminate: Story = {
  args: { checked: 'indeterminate' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('checkbox')).toHaveAttribute('aria-checked', 'mixed');
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByRole('checkbox'));
    await expect(canvas.getByRole('checkbox').className).toMatch(/\bhover:border-accent\b/);
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('checkbox')).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(canvas.getByRole('checkbox')).toBeChecked();
  },
};

export const Active: Story = {
  play: async ({ canvas }) => {
    const box = canvas.getByRole('checkbox');
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: box },
      { keys: '[/MouseLeft]', target: box },
    ]);
    await expect(box).toBeChecked();
  },
};

export const Disabled: Story = {
  args: { disabled: true, defaultChecked: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('checkbox')).toBeDisabled();
  },
};

export const ReadOnly: Story = {
  args: { readOnly: true, defaultChecked: true },
  play: async ({ canvas }) => {
    const box = canvas.getByRole('checkbox');
    await userEvent.click(box);
    await expect(box).toBeChecked();
  },
};

export const Invalid: Story = {
  args: { error: 'Confirm before saving.' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('checkbox')).toHaveAttribute('aria-invalid', 'true');
  },
};

export const WithIcon: Story = {
  args: {
    label: (
      <>
        <Flame aria-hidden="true" />
        {FORM.urgent.label}
      </>
    ),
  },
};

export const LongText: Story = { args: { label: LONG_LABEL } };

export const RtlNeutral: Story = {
  args: { defaultChecked: true, error: 'Confirm before saving.' },
  decorators: [
    (Story) => (
      <div dir="rtl">
        <Story />
      </div>
    ),
  ],
};

export const Tamil: Story = {
  args: { label: INDIC_FORM.ta.urgent },
  decorators: [
    (Story) => (
      <div lang="ta">
        <Story />
      </div>
    ),
  ],
};

export const Kannada: Story = {
  args: { label: INDIC_FORM.kn.urgent },
  decorators: [
    (Story) => (
      <div lang="kn">
        <Story />
      </div>
    ),
  ],
};
