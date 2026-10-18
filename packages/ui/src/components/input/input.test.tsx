// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Search } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { controlClasses, controlHeight, DEFAULT_INPUT_LABELS, Input } from './input';

describe('Input', () => {
  it('is a 36 px text input with the token control look', async () => {
    render(<Input aria-label="Matter title" />);
    const input = screen.getByRole('textbox', { name: 'Matter title' });
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveClass('h-9', 'bg-surface-raised', 'border', 'border-line-strong');
    await userEvent.type(input, 'Kaveri');
    expect(input).toHaveValue('Kaveri');
  });

  it('focus is a 2 px --ring outline offset 2 plus an --accent border', () => {
    for (const cls of [
      'focus-visible:outline-2',
      'focus-visible:outline-ring',
      'outline-offset-2',
      'focus-visible:border-accent',
    ]) {
      expect(controlClasses.split(' ')).toContain(cls);
    }
    expect(controlHeight).toContain('h-9');
  });

  it('invalid: aria-invalid, --danger border and an icon', () => {
    render(<Input aria-label="Matter title" aria-invalid />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(controlClasses).toContain('aria-invalid:border-danger');
    expect(input.parentElement?.querySelector('[data-slot="input-end"] svg')).toHaveClass(
      'text-danger',
    );
  });

  it('read-only keeps the value, is not editable and is styled', async () => {
    render(<Input aria-label="Matter title" readOnly defaultValue="Fixed" />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('readonly');
    expect(input).toHaveAttribute('data-readonly');
    await userEvent.type(input, 'x');
    expect(input).toHaveValue('Fixed');
    expect(controlClasses).toContain('data-readonly:bg-surface-sunken');
  });

  it('disabled', () => {
    render(<Input aria-label="Matter title" disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('loading shows a labelled spinner and aria-busy', () => {
    render(<Input aria-label="Search" loading labels={{ loading: 'ஏற்றுகிறது' }} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status', { name: 'ஏற்றுகிறது' })).toBeInTheDocument();
    expect(DEFAULT_INPUT_LABELS.loading).toBe('Loading');
  });

  it('start icon is decorative and pads the inline start (RTL-safe)', () => {
    render(<Input aria-label="Search" startIcon={<Search />} />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveClass('ps-9');
    expect(input.parentElement?.querySelector('[aria-hidden="true"]')).toHaveClass('start-3');
  });

  it('only uses token utilities (no arbitrary colours)', () => {
    expect(controlClasses).not.toMatch(/-\[(#|rgb|hsl|oklch)/);
  });
});
