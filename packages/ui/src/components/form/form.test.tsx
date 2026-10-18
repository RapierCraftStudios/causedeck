// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { COURTS } from '../__fixtures__/labels';
import { Checkbox } from '../checkbox/checkbox';
import { Combobox } from '../combobox/combobox';
import { Input } from '../input/input';
import { Form, FormField, useZodForm } from './form';

// Radix Checkbox measures itself; jsdom has no ResizeObserver.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const schema = z.object({
  title: z.string().trim().min(1, 'Enter the matter title.'),
  court: z.string({ error: 'Choose a court.' }).min(1, 'Choose a court.'),
  urgent: z.boolean(),
});

function HearingForm({ onSubmit }: { onSubmit: (values: z.output<typeof schema>) => void }) {
  const form = useZodForm(schema, { defaultValues: { title: '', court: '', urgent: false } });
  return (
    <Form form={form} onSubmit={onSubmit}>
      <FormField
        control={form.control}
        name="title"
        label="Matter title"
        hint="As listed."
        render={({ field }) => <Input {...field} />}
      />
      <FormField
        control={form.control}
        name="court"
        label="Court"
        render={({ field }) => (
          <Combobox
            options={COURTS}
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
        name="urgent"
        label="Mark as urgent"
        orientation="horizontal"
        render={({ field }) => (
          <Checkbox
            checked={field.value}
            onCheckedChange={(v) => {
              field.onChange(v === true);
            }}
          />
        )}
      />
      <button type="submit">Save</button>
    </Form>
  );
}

describe('Form (react-hook-form + zod)', () => {
  it('shows zod errors on the fields and blocks submit', async () => {
    const onSubmit = vi.fn();
    render(<HearingForm onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const title = await screen.findByRole('textbox', { name: 'Matter title' });
    await waitFor(() => expect(title).toHaveAttribute('aria-invalid', 'true'));
    expect(title).toHaveAccessibleDescription('As listed. Enter the matter title.');
    expect(screen.getByRole('combobox', { name: 'Court' })).toHaveAccessibleDescription(
      'Choose a court.',
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits parsed values and clears errors once valid', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<HearingForm onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const title = screen.getByRole('textbox', { name: 'Matter title' });
    await user.type(title, '  Kaveri Textiles  ');
    const court = screen.getByRole('combobox', { name: 'Court' });
    // Clicking opens the list with the first option active.
    await user.click(court);
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('checkbox', { name: 'Mark as urgent' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      title: 'Kaveri Textiles',
      court: COURTS[0].value,
      urgent: true,
    });
    expect(title).not.toHaveAttribute('aria-invalid');
  });

  it('renders a noValidate form', () => {
    const { container } = render(<HearingForm onSubmit={vi.fn()} />);
    expect(container.querySelector('form')).toHaveAttribute('novalidate');
  });
});
