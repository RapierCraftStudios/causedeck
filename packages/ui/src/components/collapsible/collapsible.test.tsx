// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  collapsibleContentClasses,
} from './collapsible';

describe('Collapsible', () => {
  it('toggles its content and wires aria-controls', async () => {
    render(
      <Collapsible>
        <CollapsibleTrigger>Show parties</CollapsibleTrigger>
        <CollapsibleContent>M/s Kaveri Textiles</CollapsibleContent>
      </Collapsible>,
    );
    const trigger = screen.getByRole('button', { name: 'Show parties' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const content = screen.getByText('M/s Kaveri Textiles');
    expect(content).toHaveAttribute('data-slot', 'collapsible-content');
    expect(trigger.getAttribute('aria-controls')).toBe(content.id);
  });

  it('animates height over 200 ms with tokens', () => {
    expect(collapsibleContentClasses).toContain('data-[state=open]:animate-collapsible-down');
    expect(collapsibleContentClasses).toContain('duration-(--dur-base)');
  });
});
