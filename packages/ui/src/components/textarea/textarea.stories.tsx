// check-stories: n/a Loading, WithIcon (multi-line text has no async state or adornments; loading lives on the submit Button)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent } from 'storybook/test';

import { FORM, INDIC_FORM, LONG_LABEL } from '../__fixtures__/labels';
import { Field } from '../field/field';
import { Textarea } from './textarea';

const meta = {
  title: 'Components/Textarea',
  component: Textarea,
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
  render: (args) => (
    <Field label={FORM.notes.label} hint={FORM.notes.hint}>
      <Textarea {...args} />
    </Field>
  ),
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    const textarea = canvas.getByRole('textbox', { name: FORM.notes.label });
    await userEvent.type(textarea, 'Adjourned to 14 Nov.');
    await expect(textarea).toHaveValue('Adjourned to 14 Nov.');
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByRole('textbox'));
    await expect(canvas.getByRole('textbox')).toBeEnabled();
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('textbox')).toHaveFocus();
  },
};

export const Active: Story = {
  play: async ({ canvas }) => {
    const textarea = canvas.getByRole('textbox');
    await userEvent.pointer({ keys: '[MouseLeft>]', target: textarea });
    await expect(textarea).toHaveFocus();
    await userEvent.pointer({ keys: '[/MouseLeft]', target: textarea });
  },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: FORM.notes.value },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox')).toBeDisabled();
  },
};

export const ReadOnly: Story = {
  args: { readOnly: true, defaultValue: FORM.notes.value },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox')).toHaveAttribute('readonly');
  },
};

export const Invalid: Story = {
  args: { defaultValue: FORM.notes.value },
  render: (args) => (
    <Field label={FORM.notes.label} hint={FORM.notes.hint} error={FORM.notes.error}>
      <Textarea {...args} />
    </Field>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  },
};

export const LongText: Story = {
  args: { defaultValue: `${LONG_LABEL}. ${LONG_LABEL}. ${LONG_LABEL}.` },
};

export const RtlNeutral: Story = {
  render: (args) => (
    <div dir="rtl">
      <Field label={FORM.notes.label} error={FORM.notes.error}>
        <Textarea {...args} />
      </Field>
    </div>
  ),
};

export const Tamil: Story = {
  render: (args) => (
    <div lang="ta">
      <Field label={INDIC_FORM.ta.matter} hint={INDIC_FORM.ta.hint} error={INDIC_FORM.ta.error}>
        <Textarea {...args} />
      </Field>
    </div>
  ),
};

export const Kannada: Story = {
  render: (args) => (
    <div lang="kn">
      <Field label={INDIC_FORM.kn.matter} hint={INDIC_FORM.kn.hint} error={INDIC_FORM.kn.error}>
        <Textarea {...args} />
      </Field>
    </div>
  ),
};
