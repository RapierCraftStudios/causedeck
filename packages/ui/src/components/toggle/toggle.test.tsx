// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Toggle, toggleVariants } from './toggle';

describe('Toggle', () => {
  it('is a pressed/unpressed button', async () => {
    render(<Toggle aria-label="Urgent only">Urgent</Toggle>);
    const toggle = screen.getByRole('button', { name: 'Urgent only' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('sizes sm/md/lg are 32/36/44 px and use tokens only', () => {
    expect(toggleVariants({ size: 'sm' })).toContain('h-8');
    expect(toggleVariants({ size: 'md' })).toContain('h-9');
    expect(toggleVariants({ size: 'lg' })).toContain('h-11');
    expect(toggleVariants({})).not.toMatch(/-\[(#|rgb|hsl|oklch)/);
  });

  it('passes aria-invalid and disabled', () => {
    render(
      <Toggle aria-invalid disabled>
        Urgent
      </Toggle>,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
