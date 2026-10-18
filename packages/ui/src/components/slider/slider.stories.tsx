// check-stories: n/a Loading (a slider applies instantly; pending saves show on the surrounding form)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CalendarClock, CalendarDays } from 'lucide-react';
import type { ReactNode } from 'react';
import { expect, fn, userEvent } from 'storybook/test';

import { FORM, LONG_LABEL } from '../__fixtures__/labels';
import { Field } from '../field/field';
import { Slider, type SliderProps } from './slider';

interface LeadTimeProps extends SliderProps {
  label?: ReactNode;
  error?: string;
  withIcons?: boolean;
}

function LeadTime({ label = FORM.days.label, error, withIcons = false, ...props }: LeadTimeProps) {
  const slider = <Slider max={14} {...props} />;
  return (
    <Field label={label} hint={FORM.days.hint} error={error}>
      {withIcons ? (
        <div className="text-ink-muted flex items-center gap-3 [&_svg]:size-4 [&_svg]:shrink-0">
          <CalendarClock aria-hidden="true" />
          {slider}
          <CalendarDays aria-hidden="true" />
        </div>
      ) : (
        slider
      )}
    </Field>
  );
}

const meta = {
  title: 'Components/Slider',
  component: LeadTime,
  args: { defaultValue: [3], onValueChange: fn() },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LeadTime>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, args }) => {
    const thumb = canvas.getByRole('slider', { name: FORM.days.label });
    thumb.focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    await expect(thumb).toHaveAttribute('aria-valuenow', '5');
    await userEvent.keyboard('{End}');
    await expect(args.onValueChange).toHaveBeenLastCalledWith([14]);
  },
};

export const Range: Story = {
  args: { defaultValue: [2, 7] },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('slider', { name: `${FORM.days.label} Minimum` })).toBeVisible();
    await expect(canvas.getByRole('slider', { name: `${FORM.days.label} Maximum` })).toBeVisible();
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByRole('slider'));
    await expect(canvas.getByRole('slider')).toHaveAttribute('aria-valuenow', '3');
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('slider')).toHaveFocus();
  },
};

export const Active: Story = {
  play: async ({ canvas }) => {
    const thumb = canvas.getByRole('slider');
    await userEvent.pointer({ keys: '[MouseLeft>]', target: thumb });
    await expect(thumb).toHaveFocus();
    await userEvent.pointer({ keys: '[/MouseLeft]', target: thumb });
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('slider')).toHaveAttribute('data-disabled');
  },
};

export const ReadOnly: Story = {
  args: { readOnly: true },
  play: async ({ canvas }) => {
    const thumb = canvas.getByRole('slider');
    thumb.focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(thumb).toHaveAttribute('aria-valuenow', '3');
  },
};

export const Invalid: Story = {
  args: { error: 'Choose at least one day.' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('slider')).toHaveAttribute('aria-invalid', 'true');
  },
};

export const WithIcon: Story = { args: { withIcons: true } };

export const LongText: Story = { args: { label: LONG_LABEL } };

export const RtlNeutral: Story = {
  args: { defaultValue: [2, 7], dir: 'rtl' },
  decorators: [
    (Story) => (
      <div dir="rtl">
        <Story />
      </div>
    ),
  ],
};

export const Tamil: Story = {
  args: { label: 'நினைவூட்டல் நாட்கள்', labels: { minimum: 'குறைந்தது', maximum: 'அதிகபட்சம்' } },
  decorators: [
    (Story) => (
      <div lang="ta">
        <Story />
      </div>
    ),
  ],
};

export const Kannada: Story = {
  args: { label: 'ಜ್ಞಾಪನೆ ದಿನಗಳು', labels: { minimum: 'ಕನಿಷ್ಠ', maximum: 'ಗರಿಷ್ಠ' } },
  decorators: [
    (Story) => (
      <div lang="kn">
        <Story />
      </div>
    ),
  ],
};
