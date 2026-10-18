// check-stories: n/a Hover, Active, Loading, Invalid (static text; hover, press and invalid styling belong to the control it names)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Scale } from 'lucide-react';
import { expect, userEvent } from 'storybook/test';

import { FORM, INDIC_FORM, LONG_LABEL } from '../__fixtures__/labels';
import { Input } from '../input/input';
import { Label } from './label';

const meta = {
  title: 'Components/Label',
  component: Label,
  args: { children: FORM.matter.label, htmlFor: 'matter' },
  render: (args) => (
    <div className="flex w-80 flex-col gap-1.5">
      <Label {...args} />
      <Input id="matter" />
    </div>
  ),
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText(FORM.matter.label));
    await expect(canvas.getByRole('textbox', { name: FORM.matter.label })).toHaveFocus();
  },
};

/** Tabbing to the control shows its focus ring; the label itself is not focusable. */
export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('textbox')).toHaveFocus();
  },
};

export const Required: Story = {
  args: { required: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: /Matter title\s*required/ })).toBeVisible();
  },
};

export const Disabled: Story = {
  render: (args) => (
    <div className="flex w-80 flex-col gap-1.5">
      <Input id="matter" disabled className="peer order-2" />
      <Label {...args} className="order-1" />
    </div>
  ),
};

export const WithIcon: Story = {
  args: {
    children: (
      <>
        <Scale aria-hidden="true" />
        {FORM.court.label}
      </>
    ),
  },
};

export const LongText: Story = { args: { children: LONG_LABEL, required: true } };

export const RtlNeutral: Story = {
  args: { required: true },
  render: (args) => (
    <div dir="rtl" className="flex w-80 flex-col gap-1.5">
      <Label {...args} />
      <Input id="matter" />
    </div>
  ),
};

export const Tamil: Story = {
  args: { children: INDIC_FORM.ta.matter, required: true, labels: { required: 'அவசியம்' } },
  render: (args) => (
    <div lang="ta" className="flex w-80 flex-col gap-1.5">
      <Label {...args} />
      <Input id="matter" />
    </div>
  ),
};

export const Kannada: Story = {
  args: { children: INDIC_FORM.kn.matter, required: true, labels: { required: 'ಅಗತ್ಯ' } },
  render: (args) => (
    <div lang="kn" className="flex w-80 flex-col gap-1.5">
      <Label {...args} />
      <Input id="matter" />
    </div>
  ),
};
