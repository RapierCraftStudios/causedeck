// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Field } from '../field/field';
import {
  DEFAULT_SELECT_LABELS,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';

function Court(props: { readOnly?: boolean; loading?: boolean; error?: string }) {
  return (
    <Field label="Court" hint="Where." error={props.error}>
      <Select readOnly={props.readOnly} defaultValue="mhc">
        <SelectTrigger loading={props.loading}>
          <SelectValue placeholder="Choose a court" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="mhc">Madras High Court</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

describe('Select', () => {
  it('trigger is a 36 px combobox with the control look, named by the Field', () => {
    render(<Court />);
    const trigger = screen.getByRole('combobox', { name: 'Court' });
    expect(trigger).toHaveClass('h-9', 'bg-surface-raised', 'border-line-strong');
    expect(trigger).toHaveAttribute('aria-describedby');
    expect(trigger).not.toHaveAttribute('aria-invalid');
  });

  it('invalid: aria-invalid plus an icon', () => {
    render(<Court error="Choose a court." />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    expect(trigger.querySelector('svg.text-danger')).not.toBeNull();
  });

  it('read-only: aria-readonly and does not open', () => {
    render(<Court readOnly />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAttribute('aria-readonly', 'true');
    expect(trigger).toHaveAttribute('data-readonly');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('loading: aria-busy, disabled, spinner with the loading label', () => {
    render(<Court loading />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAttribute('aria-busy', 'true');
    expect(trigger).toBeDisabled();
    expect(screen.getByRole('status', { name: DEFAULT_SELECT_LABELS.loading })).toBeInTheDocument();
  });
});
