// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  popoverContentClasses,
} from './popover';

// Radix popper measures its content; jsdom has no ResizeObserver.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

function Example() {
  return (
    <Popover>
      <PopoverTrigger>Next hearing</PopoverTrigger>
      <PopoverContent aria-label="Next hearing details">
        14 Nov 2026, Court 12
        <PopoverClose>Done</PopoverClose>
      </PopoverContent>
    </Popover>
  );
}

describe('Popover', () => {
  it('opens a dialog wired to its trigger', async () => {
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Next hearing' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    const content = screen.getByRole('dialog', { name: 'Next hearing details' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', content.id);
    expect(content).toHaveAttribute('data-slot', 'popover-content');
    expect(content).toHaveAttribute('data-state', 'open');
  });

  it('closes on Escape and on its close button, returning focus to the trigger', async () => {
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Next hearing' });
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a floating layer: overlay surface, shadow, popover stacking, 150/100 ms motion', () => {
    for (const token of [
      'bg-surface-overlay',
      'shadow-3',
      'z-popover',
      'data-[state=open]:duration-(--dur-fast)',
      'data-[state=open]:ease-enter',
      'data-[state=closed]:duration-(--dur-exit)',
      'data-[state=closed]:ease-exit',
      'data-[side=bottom]:slide-in-from-top-1',
    ]) {
      expect(popoverContentClasses).toContain(token);
    }
  });
});
