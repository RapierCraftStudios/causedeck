// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Field } from '../field/field';
import { Slider } from './slider';

// Radix Slider measures its thumbs; jsdom has no ResizeObserver.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

describe('Slider', () => {
  it('arrow keys change the value', async () => {
    const onValueChange = vi.fn();
    render(
      <Field label="Lead time" hint="Days before.">
        <Slider defaultValue={[3]} max={10} onValueChange={onValueChange} />
      </Field>,
    );
    const thumb = screen.getByRole('slider', { name: 'Lead time' });
    expect(thumb).toHaveAccessibleDescription('Days before.');
    thumb.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(thumb).toHaveAttribute('aria-valuenow', '4');
    expect(onValueChange).toHaveBeenCalledWith([4]);
  });

  it('range thumbs are named field label + minimum/maximum', () => {
    render(
      <Field label="Fee">
        <Slider defaultValue={[2, 8]} max={10} labels={{ minimum: 'From', maximum: 'To' }} />
      </Field>,
    );
    expect(screen.getByRole('slider', { name: 'Fee From' })).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByRole('slider', { name: 'Fee To' })).toHaveAttribute('aria-valuenow', '8');
  });

  it('read-only ignores keys', async () => {
    render(<Slider aria-label="Lead time" readOnly defaultValue={[3]} max={10} />);
    const thumb = screen.getByRole('slider', { name: 'Lead time' });
    expect(thumb).toHaveAttribute('aria-readonly', 'true');
    thumb.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(thumb).toHaveAttribute('aria-valuenow', '3');
  });

  it('invalid marks the thumbs', () => {
    render(<Slider aria-label="Lead time" aria-invalid defaultValue={[3]} />);
    expect(screen.getByRole('slider')).toHaveAttribute('aria-invalid', 'true');
  });
});
