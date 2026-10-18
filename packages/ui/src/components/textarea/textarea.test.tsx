// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Field } from '../field/field';
import { Textarea } from './textarea';

describe('Textarea', () => {
  it('shares the control look and accepts text', async () => {
    render(<Textarea aria-label="Hearing notes" />);
    const textarea = screen.getByRole('textbox', { name: 'Hearing notes' });
    expect(textarea).toHaveClass('bg-surface-raised', 'border-line-strong', 'min-h-20');
    await userEvent.type(textarea, 'Adjourned');
    expect(textarea).toHaveValue('Adjourned');
  });

  it('wires to a Field: invalid, described, required', () => {
    render(
      <Field label="Hearing notes" hint="Private." error="Too long." required>
        <Textarea />
      </Field>,
    );
    const textarea = screen.getByRole('textbox', { name: /Hearing notes/ });
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(textarea).toBeRequired();
    expect(textarea).toHaveAccessibleDescription('Private. Too long.');
  });

  it('read-only and disabled', () => {
    render(
      <>
        <Textarea aria-label="a" readOnly />
        <Textarea aria-label="b" disabled />
      </>,
    );
    expect(screen.getByRole('textbox', { name: 'a' })).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: 'a' })).toHaveAttribute('data-readonly');
    expect(screen.getByRole('textbox', { name: 'b' })).toBeDisabled();
  });
});
