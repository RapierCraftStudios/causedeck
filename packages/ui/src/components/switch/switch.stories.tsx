// check-stories: n/a Loading (a switch applies instantly; pending saves show on the surrounding form)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { BellRing } from 'lucide-react';
import type { ReactNode } from 'react';
import { expect, fn, userEvent } from 'storybook/test';

import { FORM, INDIC_FORM, LONG_LABEL } from '../__fixtures__/labels';
import { Field } from '../field/field';
import { Switch, type SwitchProps } from './switch';

interface RemindProps extends SwitchProps {
  label?: ReactNode;
  error?: string;
}

function Remind({ label = FORM.remind.label, error, ...props }: RemindProps) {
  return (
    <Field label={label} hint={FORM.remind.hint} error={error} orientation="horizontal">
      <Switch {...props} />
    </Field>
  );
}

const meta = {
  title: 'Components/Switch',
  component: Remind,
  args: { onCheckedChange: fn() },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Remind>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, args }) => {
    const toggle = canvas.getByRole('switch', { name: FORM.remind.label });
    await userEvent.click(toggle);
    await expect(toggle).toBeChecked();
    await expect(args.onCheckedChange).toHaveBeenCalledWith(true);
  },
};

export const Checked: Story = { args: { defaultChecked: true } };

export const Hover: Story = {
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByRole('switch'));
    await expect(canvas.getByRole('switch')).not.toBeChecked();
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('switch')).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(canvas.getByRole('switch')).toBeChecked();
  },
};

export const Active: Story = {
  play: async ({ canvas }) => {
    const toggle = canvas.getByRole('switch');
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: toggle },
      { keys: '[/MouseLeft]', target: toggle },
    ]);
    await expect(toggle).toBeChecked();
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('switch')).toBeDisabled();
  },
};

export const ReadOnly: Story = {
  args: { readOnly: true, defaultChecked: true },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('switch'));
    await expect(canvas.getByRole('switch')).toBeChecked();
  },
};

export const Invalid: Story = {
  args: { error: 'Turn on reminders to get the cause-list alert.' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('switch')).toHaveAttribute('aria-invalid', 'true');
  },
};

export const WithIcon: Story = {
  args: {
    label: (
      <>
        <BellRing aria-hidden="true" />
        {FORM.remind.label}
      </>
    ),
  },
};

export const LongText: Story = { args: { label: LONG_LABEL } };

/** The thumb travels toward the inline end, so it mirrors in RTL. */
export const RtlNeutral: Story = {
  args: { defaultChecked: true },
  decorators: [
    (Story) => (
      <div dir="rtl">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvas }) => {
    const toggle = canvas.getByRole('switch');
    const thumb = toggle.querySelector('[data-slot="switch-thumb"]') as HTMLElement;
    // Checked thumb sits at the inline end: the left edge in RTL.
    await expect(
      thumb.getBoundingClientRect().left - toggle.getBoundingClientRect().left,
    ).toBeLessThan(4);
  },
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
