// Layout checks that need a real browser: token sizes and no shift when loading.
import '../../styles/globals.css';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';

describe('Button layout', () => {
  it.each([
    ['sm', 32],
    ['md', 36],
    ['lg', 44],
  ] as const)('size %s is %d px tall', (size, height) => {
    render(<Button size={size}>Save draft</Button>);
    expect(screen.getByRole('button').getBoundingClientRect().height).toBe(height);
  });

  it('keeps its box when loading (no layout shift)', () => {
    render(
      <div>
        <Button data-testid="idle">File vakalatnama</Button>
        <Button data-testid="busy" loading>
          File vakalatnama
        </Button>
      </div>,
    );
    const idle = screen.getByTestId('idle').getBoundingClientRect();
    const busy = screen.getByTestId('busy').getBoundingClientRect();
    expect([busy.width, busy.height]).toEqual([idle.width, idle.height]);
  });
});
