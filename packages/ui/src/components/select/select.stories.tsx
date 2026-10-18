import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Scale } from 'lucide-react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { COURTS, FORM, INDIC, INDIC_FORM, LONG_LABEL } from '../__fixtures__/labels';
import { Field } from '../field/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  type SelectProps,
  type SelectTriggerProps,
} from './select';

interface CourtSelectProps extends SelectProps {
  trigger?: SelectTriggerProps;
  label?: string;
  placeholder?: string;
  error?: string;
}

function CourtSelect({
  trigger,
  label = FORM.court.label,
  placeholder = FORM.court.placeholder,
  error,
  ...props
}: CourtSelectProps) {
  return (
    <Field label={label} hint={FORM.court.hint} error={error}>
      <Select {...props}>
        <SelectTrigger {...trigger}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>High Courts</SelectLabel>
            {COURTS.slice(0, 4).map((court) => (
              <SelectItem key={court.value} value={court.value}>
                {court.label}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectSeparator />
          {COURTS.slice(4).map((court) => (
            <SelectItem
              key={court.value}
              value={court.value}
              disabled={'disabled' in court && court.disabled}
            >
              {court.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

const meta = {
  title: 'Components/Select',
  component: CourtSelect,
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CourtSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Popups render in a portal on <body>, outside the story canvas. */
const popup = within(document.body);

export const Default: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('combobox', { name: FORM.court.label });
    await expect(trigger.getBoundingClientRect().height).toBe(36);
    await userEvent.click(trigger);
    await userEvent.click(await popup.findByRole('option', { name: COURTS[1].label }));
    await expect(trigger).toHaveTextContent(COURTS[1].label);
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByRole('combobox'));
    await expect(canvas.getByRole('combobox')).toBeEnabled();
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('combobox')).toHaveFocus();
  },
};

/** Keyboard: Enter opens, arrows move, Enter picks, Escape closes. */
export const Active: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('combobox');
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    await popup.findByRole('listbox');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
    await expect(trigger).not.toHaveTextContent(FORM.court.placeholder);
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox')).toBeDisabled();
  },
};

export const ReadOnly: Story = {
  args: { readOnly: true, defaultValue: COURTS[0].value },
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('combobox');
    await userEvent.click(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  },
};

export const Loading: Story = {
  args: { trigger: { loading: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox')).toHaveAttribute('aria-busy', 'true');
  },
};

export const Invalid: Story = {
  args: { error: FORM.court.error },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
  },
};

export const WithIcon: Story = {
  args: { trigger: { icon: <Scale /> } },
};

export const LongText: Story = {
  args: { label: LONG_LABEL, placeholder: LONG_LABEL },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox').getBoundingClientRect().width).toBeLessThanOrEqual(
      320,
    );
  },
};

export const RtlNeutral: Story = {
  args: { trigger: { icon: <Scale /> }, error: FORM.court.error },
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
    placeholder: INDIC_FORM.ta.choose,
    trigger: { loading: true, labels: { loading: INDIC.ta.loading } },
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
    placeholder: INDIC_FORM.kn.choose,
    trigger: { loading: true, labels: { loading: INDIC.kn.loading } },
  },
  decorators: [
    (Story) => (
      <div lang="kn">
        <Story />
      </div>
    ),
  ],
};
