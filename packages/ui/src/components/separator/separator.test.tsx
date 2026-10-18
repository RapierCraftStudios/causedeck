// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Separator } from './separator';

describe('Separator', () => {
  it('is a decorative horizontal hairline by default', () => {
    const { container } = render(<Separator />);
    const line = container.firstElementChild;
    expect(line).toHaveAttribute('data-orientation', 'horizontal');
    expect(line).toHaveAttribute('role', 'none');
    expect(line).toHaveClass('bg-line');
  });

  it('exposes role=separator with orientation when not decorative', () => {
    render(<Separator decorative={false} orientation="vertical" />);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical');
  });

  it('stays visible in forced-colours mode', () => {
    const { container } = render(<Separator />);
    expect(container.firstElementChild?.className).toContain('forced-colors:bg-[CanvasText]');
  });
});
