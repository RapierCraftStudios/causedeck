// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MATTER_TITLE } from '../__fixtures__/labels';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './card';

describe('Card', () => {
  it('renders the slots with radius-lg, a line border and a serif lg title', () => {
    const { container } = render(
      <Card>
        <CardHeader>
          <CardTitle>{MATTER_TITLE}</CardTitle>
          <CardDescription>Next hearing 14 Nov 2026</CardDescription>
          <CardAction>
            <button type="button">More</button>
          </CardAction>
        </CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>,
    );
    const card = container.firstElementChild;
    expect(card).toHaveAttribute('data-slot', 'card');
    expect(card).toHaveClass('rounded-lg', 'border', 'border-line', 'bg-surface-raised');
    expect(card?.className).not.toMatch(/\bshadow-/);
    // Compact record cards: 16 px padding and 12 px gaps.
    expect(card).toHaveClass('py-4', 'gap-3');
    for (const slot of ['card-header', 'card-content', 'card-footer']) {
      expect(container.querySelector(`[data-slot="${slot}"]`)).toHaveClass('px-4');
    }
    expect(screen.getByText(MATTER_TITLE)).toHaveClass('font-serif', 'text-lg');
    expect(screen.getByText('Next hearing 14 Nov 2026')).toHaveClass('text-xs', 'text-ink-subtle');
    expect(screen.getByRole('button', { name: 'More' }).parentElement).toHaveAttribute(
      'data-slot',
      'card-action',
    );
  });

  it('renders the title as the given heading when asChild', () => {
    render(
      <CardTitle asChild>
        <h2>{MATTER_TITLE}</h2>
      </CardTitle>,
    );
    expect(screen.getByRole('heading', { level: 2, name: MATTER_TITLE })).toHaveClass('font-serif');
  });
});
