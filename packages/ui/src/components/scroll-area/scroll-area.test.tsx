// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MATTERS } from '../__fixtures__/labels';
import { ScrollArea } from './scroll-area';

describe('ScrollArea', () => {
  it('has a focusable, named viewport so keyboard users can scroll', () => {
    render(
      <ScrollArea label="Matters" className="h-40">
        <ul>
          {MATTERS.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </ScrollArea>,
    );
    const region = screen.getByRole('region', { name: 'Matters' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toHaveAttribute('data-slot', 'scroll-area-viewport');
    expect(screen.getByText(MATTERS[0])).toBeInTheDocument();
  });

  it('has no region role without a label', () => {
    const { container } = render(<ScrollArea>Content</ScrollArea>);
    expect(screen.queryByRole('region')).toBeNull();
    expect(container.querySelector('[data-slot="scroll-area-viewport"]')).toHaveAttribute(
      'tabindex',
      '0',
    );
  });
});
