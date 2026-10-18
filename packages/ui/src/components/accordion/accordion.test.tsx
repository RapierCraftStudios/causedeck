// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  accordionContentClasses,
} from './accordion';

describe('Accordion', () => {
  it('expands a region labelled by its trigger', async () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="a">
          <AccordionTrigger>Hearings</AccordionTrigger>
          <AccordionContent>Listed on 14 Nov</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );
    const trigger = screen.getByRole('button', { name: 'Hearings' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('data-slot', 'accordion-trigger');
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Hearings' })).toHaveTextContent('Listed on 14 Nov');
  });

  it('animates height over 200 ms with tokens', () => {
    expect(accordionContentClasses).toContain('data-[state=open]:animate-accordion-down');
    expect(accordionContentClasses).toContain('data-[state=closed]:animate-accordion-up');
    expect(accordionContentClasses).toContain('duration-(--dur-base)');
    expect(accordionContentClasses).toContain('ease-standard');
  });
});
