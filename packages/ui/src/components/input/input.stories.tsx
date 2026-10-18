import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { FileText, Search } from 'lucide-react';
import { expect, userEvent } from 'storybook/test';

import { FORM, INDIC, INDIC_FORM, LONG_LABEL } from '../__fixtures__/labels';
import { Field } from '../field/field';
import { Input } from './input';

const meta = {
  title: 'Components/Input',
  component: Input,
  args: { placeholder: 'M/s ... v. ...' },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
  render: (args) => (
    <Field label={FORM.matter.label} hint={FORM.matter.hint}>
      <Input {...args} />
    </Field>
  ),
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox', { name: FORM.matter.label });
    await userEvent.type(input, 'Kaveri');
    await expect(input).toHaveValue('Kaveri');
    await expect(input.getBoundingClientRect().height).toBe(36);
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox');
    await userEvent.hover(input);
    await expect(input.className).toMatch(/\bhover:border-line-control\b/);
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    const input = canvas.getByRole('textbox');
    await expect(input).toHaveFocus();
    const style = getComputedStyle(input);
    await expect(style.outlineWidth).toBe('2px');
    await expect(style.outlineOffset).toBe('2px');
  },
};

/** Pressing the field puts the caret in it. */
export const Active: Story = {
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox');
    await userEvent.pointer({ keys: '[MouseLeft>]', target: input });
    await expect(input).toHaveFocus();
    await userEvent.pointer({ keys: '[/MouseLeft]', target: input });
  },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: FORM.matter.value },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox')).toBeDisabled();
  },
};

export const ReadOnly: Story = {
  args: { readOnly: true, defaultValue: FORM.matter.value },
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox');
    await userEvent.type(input, 'x');
    await expect(input).toHaveValue(FORM.matter.value);
  },
};

export const Loading: Story = {
  args: { loading: true, startIcon: <Search /> },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox')).toHaveAttribute('aria-busy', 'true');
    await expect(canvas.getByRole('status', { name: 'Loading' })).toBeVisible();
  },
};

export const Invalid: Story = {
  render: (args) => (
    <Field label={FORM.matter.label} hint={FORM.matter.hint} error={FORM.matter.error} required>
      <Input {...args} />
    </Field>
  ),
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox', { name: /Matter title/ });
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveAccessibleDescription(`${FORM.matter.hint} ${FORM.matter.error}`);
  },
};

export const WithIcon: Story = {
  args: { startIcon: <Search />, endIcon: <FileText /> },
};

export const LongText: Story = {
  args: { defaultValue: LONG_LABEL },
  render: (args) => (
    <Field label={LONG_LABEL} hint={LONG_LABEL}>
      <Input {...args} />
    </Field>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox').getBoundingClientRect().width).toBeLessThanOrEqual(
      320,
    );
  },
};

/** Icons and padding use logical sides, so they swap in RTL. */
export const RtlNeutral: Story = {
  args: { startIcon: <Search />, loading: true },
  render: (args) => (
    <div dir="rtl">
      <Field label={FORM.matter.label} error={FORM.matter.error}>
        <Input {...args} />
      </Field>
    </div>
  ),
};

export const Tamil: Story = {
  render: (args) => (
    <div lang="ta">
      <Field label={INDIC_FORM.ta.matter} hint={INDIC_FORM.ta.hint} error={INDIC_FORM.ta.error}>
        <Input {...args} loading labels={{ loading: INDIC.ta.loading }} />
      </Field>
    </div>
  ),
};

export const Kannada: Story = {
  render: (args) => (
    <div lang="kn">
      <Field label={INDIC_FORM.kn.matter} hint={INDIC_FORM.kn.hint} error={INDIC_FORM.kn.error}>
        <Input {...args} loading labels={{ loading: INDIC.kn.loading }} />
      </Field>
    </div>
  ),
};
