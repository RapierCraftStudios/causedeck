// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Badge, badgeVariants, type BadgeTone } from './badge';

const TONES: BadgeTone[] = ['neutral', 'accent', 'success', 'warning', 'danger', 'info', 'outline'];

describe('Badge', () => {
  it('renders neutral text by default', () => {
    render(<Badge>Filed</Badge>);
    const badge = screen.getByText('Filed');
    expect(badge.tagName).toBe('SPAN');
    expect(badge).toHaveAttribute('data-tone', 'neutral');
  });

  it.each(TONES)('has a token-styled %s tone', (tone) => {
    const classes = badgeVariants({ tone });
    expect(classes).toMatch(/\bbg-(surface-sunken|transparent|[a-z]+-soft)\b/);
    expect(classes).not.toMatch(/\[#|oklch\(/);
  });

  it('keeps a border in forced-colours mode', () => {
    expect(badgeVariants()).toContain('forced-colors:border-current');
  });

  it('renders its child as the badge when asChild', () => {
    render(
      <Badge asChild tone="accent">
        <a href="#listed">Listed</a>
      </Badge>,
    );
    expect(screen.getByRole('link', { name: 'Listed' })).toHaveAttribute('data-slot', 'badge');
  });
});
