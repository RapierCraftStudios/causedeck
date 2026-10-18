// @vitest-environment jsdom
// Every form control gets aria-invalid and aria-describedby (hint + error) from its Field, and
// each Field generates unique ids.
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox } from '../checkbox/checkbox';
import { Combobox } from '../combobox/combobox';
import { Input } from '../input/input';
import { RadioGroup, RadioGroupItem } from '../radio-group/radio-group';
import { Select, SelectTrigger, SelectValue } from '../select/select';
import { Slider } from '../slider/slider';
import { Switch } from '../switch/switch';
import { Textarea } from '../textarea/textarea';
import { ToggleGroup, ToggleGroupItem } from '../toggle-group/toggle-group';
import { Field, FieldError, useFieldControl } from './field';

// Radix Slider measures its thumbs; jsdom has no ResizeObserver.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const COURTS = [{ value: 'mhc', label: 'Madras High Court' }];

/** Each control, plus the role that carries its ARIA state. */
const CONTROLS: [string, string, () => ReactNode][] = [
  ['Input', 'textbox', () => <Input />],
  ['Textarea', 'textbox', () => <Textarea />],
  [
    'Select',
    'combobox',
    () => (
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
      </Select>
    ),
  ],
  ['Combobox', 'combobox', () => <Combobox options={COURTS} />],
  ['Checkbox', 'checkbox', () => <Checkbox />],
  [
    'RadioGroup',
    'radiogroup',
    () => (
      <RadioGroup>
        <RadioGroupItem value="a" aria-label="A" />
      </RadioGroup>
    ),
  ],
  ['Switch', 'switch', () => <Switch />],
  ['Slider', 'slider', () => <Slider defaultValue={[3]} max={10} />],
  [
    'ToggleGroup',
    // type="single" toggle groups are radio groups.
    'radiogroup',
    () => (
      <ToggleGroup type="single">
        <ToggleGroupItem value="day">Day</ToggleGroupItem>
      </ToggleGroup>
    ),
  ],
];

describe('Field', () => {
  it.each(CONTROLS)('%s: labelled, described by hint and error, aria-invalid', (_, role, make) => {
    render(
      <Field label="Court" hint="Where it is listed." error="Choose a court.">
        {make()}
      </Field>,
    );
    const control = screen.getByRole(role, { name: /Court/ });
    const hint = screen.getByText('Where it is listed.');
    const error = screen.getByText('Choose a court.').closest('[data-slot="field-error"]');
    expect(control).toHaveAttribute('aria-invalid', 'true');
    expect(control.getAttribute('aria-describedby')?.split(' ')).toEqual([hint.id, error?.id]);
    expect(control).toHaveAccessibleDescription('Where it is listed. Choose a court.');
  });

  it.each(CONTROLS)('%s: valid without an error, described by the hint only', (_, role, make) => {
    render(
      <Field label="Court" hint="Where it is listed.">
        {make()}
      </Field>,
    );
    const control = screen.getByRole(role, { name: /Court/ });
    expect(control).not.toHaveAttribute('aria-invalid');
    expect(control).toHaveAttribute('aria-describedby', screen.getByText('Where it is listed.').id);
  });

  it.each(CONTROLS)('%s: no aria-describedby without hint or error', (_, role, make) => {
    render(<Field label="Court">{make()}</Field>);
    expect(screen.getByRole(role, { name: /Court/ })).not.toHaveAttribute('aria-describedby');
  });

  it('generates unique ids per field and links the label to the control', () => {
    render(
      <>
        <Field label="Matter title" hint="As listed." error="Required.">
          <Input />
        </Field>
        <Field label="Court" hint="Where." error="Required.">
          <Input />
        </Field>
      </>,
    );
    const first = screen.getByRole('textbox', { name: 'Matter title' });
    const second = screen.getByRole('textbox', { name: 'Court' });
    const ids = [first, second].flatMap((el) => [
      el.id,
      ...(el.getAttribute('aria-describedby')?.split(' ') ?? []),
    ]);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    for (const id of ids) expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
  });

  it('shows the error as icon plus text below the control (never colour alone)', () => {
    render(
      <Field label="Matter title" error="Enter the matter title.">
        <Input />
      </Field>,
    );
    const error = screen.getByText('Enter the matter title.').closest('p');
    expect(error).toHaveAttribute('data-slot', 'field-error');
    expect(error?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    const input = screen.getByRole('textbox');
    // The message follows the control in document order.
    expect(input.compareDocumentPosition(error as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByRole('textbox')).toHaveClass('aria-invalid:border-danger');
  });

  it('passes required, disabled and read-only to the control', () => {
    render(
      <Field label="Matter title" required disabled readOnly>
        <Input />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: /Matter title/ });
    expect(input).toBeRequired();
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('readonly');
    expect(screen.getByText('required')).toHaveClass('sr-only');
  });

  it('keeps caller ids and lets explicit props win', () => {
    render(
      <>
        <p id="extra">Extra</p>
        <Field label="Matter title" hint="Hint" controlId="matter">
          <Input aria-describedby="extra" aria-invalid />
        </Field>
      </>,
    );
    const input = screen.getByRole('textbox', { name: 'Matter title' });
    expect(input.id).toBe('matter');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')?.split(' ')).toEqual([
      screen.getByText('Hint').id,
      'extra',
    ]);
  });

  it('useFieldControl works without a Field', () => {
    function Probe() {
      const control = useFieldControl({ 'aria-invalid': 'false' });
      return <span data-testid="probe" {...control.ariaProps} />;
    }
    render(<Probe />);
    expect(screen.getByTestId('probe')).not.toHaveAttribute('aria-invalid');
  });

  it('FieldError renders standalone with an icon', () => {
    render(<FieldError id="e">Bad</FieldError>);
    expect(document.getElementById('e')?.querySelector('svg')).not.toBeNull();
  });
});
