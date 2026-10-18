// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Tooltip, TooltipContent, TooltipTrigger, tooltipContentClasses } from './tooltip';

// Radix popper measures its content; jsdom has no ResizeObserver.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

describe('Tooltip', () => {
  it('shows on keyboard focus and describes its trigger', async () => {
    render(
      <Tooltip>
        <TooltipTrigger>Reschedule</TooltipTrigger>
        <TooltipContent>Move the hearing to the next listed date</TooltipContent>
      </Tooltip>,
    );
    await userEvent.tab();
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Move the hearing to the next listed date');
    expect(screen.getByRole('button', { name: 'Reschedule' })).toHaveAttribute(
      'aria-describedby',
      tip.id,
    );
    expect(document.querySelector('[data-slot="tooltip-content"]')).not.toBeNull();
  });

  it('hides on Escape', async () => {
    render(
      <Tooltip>
        <TooltipTrigger>Reschedule</TooltipTrigger>
        <TooltipContent>Move the hearing</TooltipContent>
      </Tooltip>,
    );
    await userEvent.tab();
    await screen.findByRole('tooltip');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('uses tooltip stacking and the 150 ms enter / 100 ms exit tokens', () => {
    for (const token of [
      'z-tooltip',
      'animate-in',
      'duration-(--dur-fast)',
      'ease-enter',
      'data-[state=closed]:duration-(--dur-exit)',
      'data-[state=closed]:ease-exit',
    ]) {
      expect(tooltipContentClasses).toContain(token);
    }
  });
});
