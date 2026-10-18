import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Scale } from 'lucide-react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { COURTS, FORM, INDIC, INDIC_FORM, LONG_LABEL } from '../__fixtures__/labels';
import { Field } from '../field/field';
import { Combobox, type ComboboxProps } from './combobox';

interface CourtComboboxProps extends Omit<ComboboxProps, 'options'> {
  label?: string;
  error?: string;
}

function CourtCombobox({ label = FORM.court.label, error, ...props }: CourtComboboxProps) {
  return (
    <Field label={label} hint={FORM.court.hint} error={error}>
      <Combobox options={COURTS} placeholder={FORM.court.placeholder} {...props} />
    </Field>
  );
}

const meta = {
  title: 'Components/Combobox',
  component: CourtCombobox,
  args: { onValueChange: fn() },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CourtCombobox>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Popups render in a portal on <body>, outside the story canvas. */
const popup = within(document.body);

const activeText = (input: HTMLElement) => {
  const id = input.getAttribute('aria-activedescendant');
  return id ? (document.getElementById(id)?.textContent ?? '') : '';
};

/** Type to filter, ArrowDown to move, Enter to pick. */
export const Default: Story = {
  play: async ({ canvas, args }) => {
    const input = canvas.getByRole('combobox', { name: FORM.court.label });
    await expect(input.getBoundingClientRect().height).toBe(36);
    await userEvent.type(input, 'karn');
    await expect(popup.getAllByRole('option')).toHaveLength(2);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(input).toHaveValue(COURTS[3].label);
    await expect(args.onValueChange).toHaveBeenCalledWith(COURTS[3].value);
  },
};

/** Keyboard walk-through: open, move (wrapping, skipping disabled), Home/End, Escape, Tab. */
export const Keyboard: Story = {
  play: async ({ canvas, args }) => {
    const input = canvas.getByRole('combobox');
    await userEvent.tab();
    await expect(input).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}');
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    const listbox = popup.getByRole('listbox', { name: FORM.court.label });
    await waitFor(() => expect(listbox).toBeVisible());
    await expect(activeText(input)).toBe(COURTS[0].label);

    await userEvent.keyboard('{ArrowUp}');
    await expect(activeText(input)).toBe(COURTS[5].label);
    await userEvent.keyboard('{ArrowUp}');
    // COURTS[4] is disabled and skipped.
    await expect(activeText(input)).toBe(COURTS[3].label);

    await userEvent.keyboard('{Home}');
    await expect(activeText(input)).toBe(COURTS[0].label);
    await userEvent.keyboard('{End}');
    await expect(activeText(input)).toBe(COURTS[5].label);

    await userEvent.keyboard('{Escape}');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(args.onValueChange).not.toHaveBeenCalled();

    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await expect(input).toHaveValue(COURTS[1].label);
    await expect(input).toHaveFocus();

    await userEvent.keyboard('{Escape}');
    await expect(input).toHaveValue('');
    await expect(args.onValueChange).toHaveBeenLastCalledWith(null);

    await userEvent.keyboard('{ArrowDown}{Tab}');
    await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'false'));
    await expect(input).not.toHaveFocus();
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    const input = canvas.getByRole('combobox');
    await userEvent.click(input);
    await userEvent.hover(popup.getByRole('option', { name: COURTS[2].label }));
    await expect(activeText(input)).toBe(COURTS[2].label);
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('combobox')).toHaveFocus();
  },
};

/** Pressing an option picks it and keeps focus in the input. */
export const Active: Story = {
  play: async ({ canvas }) => {
    const input = canvas.getByRole('combobox');
    await userEvent.click(input);
    await userEvent.click(popup.getByRole('option', { name: COURTS[5].label }));
    await expect(input).toHaveValue(COURTS[5].label);
    await expect(input).toHaveFocus();
  },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: COURTS[0].value },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox')).toBeDisabled();
  },
};

export const ReadOnly: Story = {
  args: { readOnly: true, defaultValue: COURTS[0].value },
  play: async ({ canvas }) => {
    const input = canvas.getByRole('combobox');
    await userEvent.click(input);
    await userEvent.keyboard('{ArrowDown}');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
  },
};

export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvas }) => {
    const input = canvas.getByRole('combobox');
    await expect(input).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(input);
    await expect(popup.getByRole('status')).toHaveTextContent('Loading options');
  },
};

export const Empty: Story = {
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole('combobox'), 'Supreme');
    await expect(popup.getByRole('status')).toHaveTextContent('No matches');
  },
};

export const Invalid: Story = {
  args: { error: FORM.court.error },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
  },
};

export const WithIcon: Story = {
  args: { icon: <Scale /> },
};

export const LongText: Story = {
  args: { label: LONG_LABEL, defaultValue: COURTS[3].value },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('combobox'));
    await expect(popup.getByRole('listbox').getBoundingClientRect().width).toBeLessThanOrEqual(320);
  },
};

export const RtlNeutral: Story = {
  args: { icon: <Scale />, error: FORM.court.error },
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
    loading: true,
    labels: { loading: INDIC.ta.loading, empty: INDIC_FORM.ta.empty },
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
    loading: true,
    labels: { loading: INDIC.kn.loading, empty: INDIC_FORM.kn.empty },
  },
  decorators: [
    (Story) => (
      <div lang="kn">
        <Story />
      </div>
    ),
  ],
};
