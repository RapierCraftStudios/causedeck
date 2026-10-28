// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ClashBracket } from './clash-bracket';
import { HallHeader } from './hall-header';
import { ItemNumeral } from './item-numeral';

describe('court-day primitives', () => {
  it('ItemNumeral shows the number, or a dash with a screen-reader label', () => {
    const { rerender } = render(<ItemNumeral itemNo="12A" />);
    expect(screen.getByText('12A')).toBeTruthy();
    rerender(<ItemNumeral itemNo={null} unnumberedLabel="Sans numéro" />);
    expect(screen.getByText('Sans numéro').className).toContain('sr-only');
  });

  it('HallHeader renders heading, detail and actions', () => {
    render(<HallHeader title="Hall 4" detail="3 items" actions={<button>Set</button>} sticky />);
    expect(screen.getByRole('heading', { name: 'Hall 4' })).toBeTruthy();
    expect(screen.getByText('3 items')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set' })).toBeTruthy();
  });

  it('ClashBracket is a note with an icon beside the factual text', () => {
    const { container } = render(<ClashBracket title="Clash" statement="Same date, two halls." />);
    expect(screen.getByRole('note').textContent).toContain('Same date, two halls.');
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
