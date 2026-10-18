// check-stories: n/a Loading (choices apply instantly; pending saves show on the surrounding form)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Gavel } from 'lucide-react';
import type { ReactNode } from 'react';
import { expect, fn, userEvent, waitFor } from 'storybook/test';

import { FORM, INDIC_FORM, LONG_LABEL, STAGES } from '../__fixtures__/labels';
import { Field } from '../field/field';
import { Label } from '../label/label';
import { RadioGroup, RadioGroupItem, type RadioGroupProps } from './radio-group';

interface StageProps extends RadioGroupProps {
  label?: ReactNode;
  error?: string;
  optionLabels?: readonly ReactNode[];
}

function Stage({ label = FORM.stage.label, error, optionLabels, ...props }: StageProps) {
  return (
    <Field label={label} hint={FORM.stage.hint} error={error}>
      <RadioGroup {...props}>
        {STAGES.map((stage, index) => (
          <div key={stage.value} className="flex items-center gap-2.5">
            <RadioGroupItem value={stage.value} id={`stage-${stage.value}`} />
            <Label htmlFor={`stage-${stage.value}`} className="font-normal">
              {optionLabels?.[index] ?? stage.label}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </Field>
  );
}

const meta = {
  title: 'Components/RadioGroup',
  component: Stage,
  args: { onValueChange: fn(), defaultValue: 'filed' },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Stage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('radiogroup', { name: FORM.stage.label })).toBeVisible();
    await userEvent.click(canvas.getByText('Listed'));
    await expect(canvas.getByRole('radio', { name: 'Listed' })).toBeChecked();
    await expect(args.onValueChange).toHaveBeenCalledWith('listed');
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByRole('radio', { name: 'Numbered' }));
    await expect(canvas.getByRole('radio', { name: 'Numbered' })).not.toBeChecked();
  },
};

/** Tab enters the group on the checked radio; arrows move and select. */
export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('radio', { name: 'Filed' })).toHaveFocus();
    // Radix selects on focus while the arrow key is down; roving focus moves on the next tick.
    await userEvent.keyboard('{ArrowDown>}');
    await waitFor(() => expect(canvas.getByRole('radio', { name: 'Numbered' })).toBeChecked());
    await userEvent.keyboard('{/ArrowDown}');
    await expect(canvas.getByRole('radio', { name: 'Numbered' })).toHaveFocus();
  },
};

export const Active: Story = {
  play: async ({ canvas }) => {
    const radio = canvas.getByRole('radio', { name: 'Reserved' });
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: radio },
      { keys: '[/MouseLeft]', target: radio },
    ]);
    await expect(radio).toBeChecked();
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvas }) => {
    for (const radio of canvas.getAllByRole('radio')) await expect(radio).toBeDisabled();
  },
};

export const ReadOnly: Story = {
  args: { readOnly: true },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('radio', { name: 'Listed' }));
    await expect(canvas.getByRole('radio', { name: 'Filed' })).toBeChecked();
  },
};

export const Invalid: Story = {
  args: { error: FORM.stage.error, defaultValue: undefined },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('radiogroup')).toHaveAttribute('aria-invalid', 'true');
  },
};

export const WithIcon: Story = {
  args: {
    label: (
      <>
        <Gavel aria-hidden="true" />
        {FORM.stage.label}
      </>
    ),
  },
};

export const LongText: Story = {
  args: { optionLabels: [LONG_LABEL, LONG_LABEL] },
};

export const RtlNeutral: Story = {
  args: { error: FORM.stage.error },
  decorators: [
    (Story) => (
      <div dir="rtl">
        <Story />
      </div>
    ),
  ],
};

export const Tamil: Story = {
  args: {
    label: INDIC_FORM.ta.court,
    optionLabels: [
      'தாக்கல் செய்யப்பட்டது',
      'எண்ணிடப்பட்டது',
      'பட்டியலிடப்பட்டது',
      'ஒதுக்கப்பட்டது',
    ],
  },
  decorators: [
    (Story) => (
      <div lang="ta">
        <Story />
      </div>
    ),
  ],
};

export const Kannada: Story = {
  args: {
    label: INDIC_FORM.kn.court,
    optionLabels: ['ದಾಖಲಿಸಲಾಗಿದೆ', 'ಸಂಖ್ಯೆ ನೀಡಲಾಗಿದೆ', 'ಪಟ್ಟಿ ಮಾಡಲಾಗಿದೆ', 'ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ'],
  },
  decorators: [
    (Story) => (
      <div lang="kn">
        <Story />
      </div>
    ),
  ],
};
