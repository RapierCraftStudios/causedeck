// check-stories: n/a Hover, Active (the form is a container; hover and press styling belong to its controls)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Save, Search } from 'lucide-react';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { z } from 'zod';

import { COURTS, FORM, INDIC, INDIC_FORM, LONG_LABEL } from '../__fixtures__/labels';
import { Button } from '../button/button';
import { Checkbox } from '../checkbox/checkbox';
import { Combobox } from '../combobox/combobox';
import { Input } from '../input/input';
import { Textarea } from '../textarea/textarea';
import { Form, FormField, useZodForm } from './form';

const hearingSchema = z.object({
  title: z.string().trim().min(1, FORM.matter.error),
  court: z.string().min(1, FORM.court.error),
  notes: z.string().max(2000, FORM.notes.error),
  urgent: z.boolean(),
});

type Hearing = z.output<typeof hearingSchema>;

interface HearingFormProps {
  onSubmit: (values: Hearing) => void | Promise<void>;
  defaultValues?: Partial<Hearing>;
  disabled?: boolean;
  readOnly?: boolean;
  withIcon?: boolean;
  /** Copy overrides for the label-variant stories. */
  copy?: { title: string; hint: string; court: string; choose: string; save: string };
  saveLoadingLabel?: string;
}

function HearingForm({
  onSubmit,
  defaultValues,
  disabled = false,
  readOnly = false,
  withIcon = false,
  copy = {
    title: FORM.matter.label,
    hint: FORM.matter.hint,
    court: FORM.court.label,
    choose: FORM.court.placeholder,
    save: 'Save hearing',
  },
  saveLoadingLabel,
}: HearingFormProps) {
  const form = useZodForm(hearingSchema, {
    defaultValues: { title: '', court: '', notes: '', urgent: false, ...defaultValues },
  });
  return (
    <Form form={form} onSubmit={onSubmit} className="flex w-96 flex-col gap-4">
      <FormField
        control={form.control}
        name="title"
        label={copy.title}
        hint={copy.hint}
        required
        disabled={disabled}
        readOnly={readOnly}
        render={({ field }) => <Input {...field} startIcon={withIcon ? <Search /> : undefined} />}
      />
      <FormField
        control={form.control}
        name="court"
        label={copy.court}
        required
        disabled={disabled}
        readOnly={readOnly}
        render={({ field }) => (
          <Combobox
            options={COURTS}
            placeholder={copy.choose}
            value={field.value || null}
            onValueChange={(value) => {
              field.onChange(value ?? '');
            }}
            onBlur={field.onBlur}
            name={field.name}
          />
        )}
      />
      <FormField
        control={form.control}
        name="notes"
        label={FORM.notes.label}
        hint={FORM.notes.hint}
        disabled={disabled}
        readOnly={readOnly}
        render={({ field }) => <Textarea {...field} />}
      />
      <FormField
        control={form.control}
        name="urgent"
        label={FORM.urgent.label}
        orientation="horizontal"
        disabled={disabled}
        readOnly={readOnly}
        render={({ field }) => (
          <Checkbox
            name={field.name}
            checked={field.value}
            onCheckedChange={(checked) => {
              field.onChange(checked === true);
            }}
            onBlur={field.onBlur}
          />
        )}
      />
      <Button
        type="submit"
        className="self-start"
        disabled={disabled || readOnly}
        loading={form.formState.isSubmitting}
        {...(saveLoadingLabel ? { labels: { loading: saveLoadingLabel } } : {})}
      >
        {withIcon ? <Save aria-hidden="true" /> : null}
        {copy.save}
      </Button>
    </Form>
  );
}

const meta = {
  title: 'Components/Form',
  component: HearingForm,
  args: { onSubmit: fn() },
} satisfies Meta<typeof HearingForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Fill in and submit: the handler gets the zod-parsed values. */
export const Default: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.type(canvas.getByRole('textbox', { name: /Matter title/ }), FORM.matter.value);
    await userEvent.click(canvas.getByRole('combobox', { name: /Court/ }));
    await userEvent.keyboard('{Enter}');
    await userEvent.click(canvas.getByRole('button', { name: 'Save hearing' }));
    await waitFor(() => expect(args.onSubmit).toHaveBeenCalledOnce());
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('textbox', { name: /Matter title/ })).toHaveFocus();
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: /Matter title/ })).toBeDisabled();
  },
};

export const ReadOnly: Story = {
  args: {
    readOnly: true,
    defaultValues: { title: FORM.matter.value, court: COURTS[0].value, notes: FORM.notes.value },
  },
};

/** While the async submit runs the button shows its spinner. */
export const Loading: Story = {
  args: {
    defaultValues: { title: FORM.matter.value, court: COURTS[0].value },
    onSubmit: fn(() => new Promise<void>(() => {})),
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save hearing' }));
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: /Save hearing/ })).toHaveAttribute(
        'aria-busy',
        'true',
      ),
    );
  },
};

/** Submitting empty shows the zod messages under each field (icon + text), not colour alone. */
export const Invalid: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save hearing' }));
    const title = canvas.getByRole('textbox', { name: /Matter title/ });
    await waitFor(() => expect(title).toHaveAttribute('aria-invalid', 'true'));
    await expect(title).toHaveAccessibleDescription(`${FORM.matter.hint} ${FORM.matter.error}`);
    await expect(canvas.getByRole('combobox', { name: /Court/ })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};

export const WithIcon: Story = { args: { withIcon: true } };

export const LongText: Story = {
  args: { defaultValues: { title: LONG_LABEL, notes: `${LONG_LABEL}. ${LONG_LABEL}.` } },
};

export const RtlNeutral: Story = {
  args: { withIcon: true },
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
    copy: {
      title: INDIC_FORM.ta.matter,
      hint: INDIC_FORM.ta.hint,
      court: INDIC_FORM.ta.court,
      choose: INDIC_FORM.ta.choose,
      save: INDIC.ta.save,
    },
    saveLoadingLabel: INDIC.ta.loading,
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
    copy: {
      title: INDIC_FORM.kn.matter,
      hint: INDIC_FORM.kn.hint,
      court: INDIC_FORM.kn.court,
      choose: INDIC_FORM.kn.choose,
      save: INDIC.kn.save,
    },
    saveLoadingLabel: INDIC.kn.loading,
  },
  decorators: [
    (Story) => (
      <div lang="kn">
        <Story />
      </div>
    ),
  ],
};
