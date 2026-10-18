// check-stories: n/a Hover, Active (layout wrapper; hover and press styling belong to the control)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Search } from 'lucide-react';
import { expect, userEvent } from 'storybook/test';

import { COURTS, FORM, INDIC_FORM, LONG_LABEL } from '../__fixtures__/labels';
import { Checkbox } from '../checkbox/checkbox';
import { Combobox } from '../combobox/combobox';
import { Input } from '../input/input';
import { Switch } from '../switch/switch';
import { Field } from './field';

const meta = {
  title: 'Components/Field',
  component: Field,
  args: {
    label: FORM.matter.label,
    hint: FORM.matter.hint,
    children: <Input />,
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Label + control + hint; the field generates the ids. */
export const Default: Story = {
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox', { name: FORM.matter.label });
    await expect(input).toHaveAccessibleDescription(FORM.matter.hint);
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('textbox')).toHaveFocus();
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox')).toBeDisabled();
  },
};

export const ReadOnly: Story = {
  args: { readOnly: true, children: <Input defaultValue={FORM.matter.value} /> },
};

export const Loading: Story = {
  args: {
    label: FORM.court.label,
    hint: FORM.court.hint,
    children: <Combobox options={COURTS} loading />,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox')).toHaveAttribute('aria-busy', 'true');
  },
};

/** Error: danger border, icon and message below; described by hint and error. */
export const Invalid: Story = {
  args: { error: FORM.matter.error, required: true },
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox', { name: /Matter title/ });
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveAccessibleDescription(`${FORM.matter.hint} ${FORM.matter.error}`);
  },
};

export const Horizontal: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Field label={FORM.urgent.label} hint={FORM.urgent.hint} orientation="horizontal">
        <Checkbox />
      </Field>
      <Field label={FORM.remind.label} hint={FORM.remind.hint} orientation="horizontal">
        <Switch />
      </Field>
    </div>
  ),
};

export const WithIcon: Story = {
  args: { children: <Input startIcon={<Search />} /> },
};

export const LongText: Story = {
  args: { label: LONG_LABEL, hint: LONG_LABEL, error: LONG_LABEL },
};

export const RtlNeutral: Story = {
  render: (args) => (
    <div dir="rtl">
      <Field {...args} error={FORM.matter.error} />
    </div>
  ),
};

export const Tamil: Story = {
  args: { label: INDIC_FORM.ta.matter, hint: INDIC_FORM.ta.hint, error: INDIC_FORM.ta.error },
  render: (args) => (
    <div lang="ta">
      <Field {...args} required labels={{ required: 'அவசியம்' }} />
    </div>
  ),
};

export const Kannada: Story = {
  args: { label: INDIC_FORM.kn.matter, hint: INDIC_FORM.kn.hint, error: INDIC_FORM.kn.error },
  render: (args) => (
    <div lang="kn">
      <Field {...args} required labels={{ required: 'ಅಗತ್ಯ' }} />
    </div>
  ),
};
