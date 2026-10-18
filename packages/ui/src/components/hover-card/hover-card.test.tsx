// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  hoverCardContentClasses,
} from './hover-card';

// Radix popper measures its content; jsdom has no ResizeObserver.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

describe('HoverCard', () => {
  it('renders the preview with its slot and open state', () => {
    render(
      <HoverCard open>
        <HoverCardTrigger href="#matter">
          M/s Kaveri Textiles v. State of Tamil Nadu
        </HoverCardTrigger>
        <HoverCardContent>W.P. No. 1234 of 2026</HoverCardContent>
      </HoverCard>,
    );
    expect(screen.getByRole('link')).toHaveAttribute('data-state', 'open');
    const content = screen.getByText('W.P. No. 1234 of 2026');
    expect(content).toHaveAttribute('data-slot', 'hover-card-content');
    expect(content).toHaveAttribute('data-state', 'open');
  });

  it('stays closed until hovered or focused', () => {
    render(
      <HoverCard>
        <HoverCardTrigger href="#matter">Matter</HoverCardTrigger>
        <HoverCardContent>Preview</HoverCardContent>
      </HoverCard>,
    );
    expect(screen.queryByText('Preview')).toBeNull();
  });

  it('shares the floating surface and menu motion', () => {
    for (const token of [
      'bg-surface-overlay',
      'shadow-3',
      'z-popover',
      'data-[state=closed]:duration-(--dur-exit)',
    ]) {
      expect(hoverCardContentClasses).toContain(token);
    }
  });
});
