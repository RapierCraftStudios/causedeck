// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Switch } from './switch';

describe('Switch', () => {
  it('toggles with click and Space', async () => {
    render(<Switch aria-label="Remind me" />);
    const toggle = screen.getByRole('switch', { name: 'Remind me' });
    await userEvent.click(toggle);
    expect(toggle).toBeChecked();
    await userEvent.keyboard(' ');
    expect(toggle).not.toBeChecked();
  });

  it('read-only ignores input', async () => {
    render(<Switch aria-label="Remind me" readOnly defaultChecked />);
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-readonly', 'true');
    await userEvent.click(toggle);
    expect(toggle).toBeChecked();
  });

  it('thumb motion is instant under reduced motion and mirrors in RTL', () => {
    render(<Switch aria-label="Remind me" />);
    const thumb = screen.getByRole('switch').querySelector('[data-slot="switch-thumb"]');
    expect(thumb).toHaveClass(
      'motion-reduce:transition-none',
      'rtl:data-[state=checked]:-translate-x-4',
    );
  });

  it('aria-invalid', () => {
    render(<Switch aria-label="Remind me" aria-invalid />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-invalid', 'true');
  });
});
