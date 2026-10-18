// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { COURT_ITEMS } from '../__fixtures__/trust';
import { CourtItemChip, CourtItemChipSkeleton, timeOfDay } from './court-item-chip';

describe('timeOfDay', () => {
  it('splits the court day at lunch and 17:00', () => {
    expect(timeOfDay('10:30')).toBe('morning');
    expect(timeOfDay('12:59')).toBe('morning');
    expect(timeOfDay('13:00')).toBe('afternoon');
    expect(timeOfDay('16:59')).toBe('afternoon');
    expect(timeOfDay('17:00')).toBe('evening');
  });
});

describe('CourtItemChip', () => {
  it('renders item no., hall, StageBadge, time cue and ProvenanceChip from fixtures', () => {
    const { container } = render(<CourtItemChip {...COURT_ITEMS.morning} />);
    expect(screen.getByText('Item 12')).toHaveClass('tabular-nums');
    expect(screen.getByText('Court Hall 4')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="stage-badge"]')).toHaveAttribute(
      'data-stage',
      'listed',
    );
    expect(container.querySelector('[data-slot="court-item-time"]')).toHaveAttribute(
      'data-time-of-day',
      'morning',
    );
    expect(container.querySelector('[data-slot="provenance-chip"]')).toHaveAttribute(
      'data-kind',
      'adapter',
    );
    expect(screen.getByRole('group')).toHaveAccessibleName(
      'Item 12, Court Hall 4, Listed, 10:30, Before lunch',
    );
  });

  it('marks after-lunch listings', () => {
    const { container } = render(<CourtItemChip {...COURT_ITEMS.afternoon} />);
    expect(container.querySelector('[data-slot="court-item-time"]')).toHaveAttribute(
      'data-time-of-day',
      'afternoon',
    );
    expect(container.querySelector('[data-slot="stage-badge"]')).toHaveTextContent('Part-heard');
  });

  it('takes a plain onSelect callback, by click or keyboard', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<CourtItemChip {...COURT_ITEMS.defects} onSelect={onSelect} />);
    const button = screen.getByRole('button', {
      // Named by its visible text plus spoken separators; spacing around them varies by engine.
      name: /^Item 7\s*,\s*Registry\s*,\s*Defects\s*,\s*09:45\s*,\s*Before lunch$/,
    });
    await user.click(button);
    button.focus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('has a loading skeleton', () => {
    const { container } = render(<CourtItemChipSkeleton />);
    expect(container.querySelector('[data-slot="court-item-skeleton"]')).not.toBeNull();
  });

  it('imports nothing from core, db or apps', () => {
    const source = readFileSync(path.join(import.meta.dirname, 'court-item-chip.tsx'), 'utf8');
    expect(source).not.toMatch(/from\s+['"]@causedeck\/(core|db|web|mobile)/);
    expect(source).not.toMatch(/from\s+['"](\.\.\/){3,}/);
  });
});
