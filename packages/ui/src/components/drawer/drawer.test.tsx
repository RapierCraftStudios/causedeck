// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Drawer, DrawerContent, DrawerDescription, DrawerTitle, DrawerTrigger } from './drawer';

// vaul reads matchMedia on mount; jsdom has none.
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
}));

function Example() {
  return (
    <Drawer>
      <DrawerTrigger>Add note</DrawerTrigger>
      <DrawerContent>
        <DrawerTitle>Add note</DrawerTitle>
        <DrawerDescription>Notes are saved to the matter.</DrawerDescription>
      </DrawerContent>
    </Drawer>
  );
}

describe('Drawer', () => {
  it('opens a titled bottom drawer with a handle on the overlay layer', async () => {
    render(<Example />);
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
    const drawer = screen.getByRole('dialog', { name: 'Add note' });
    expect(drawer).toHaveAccessibleDescription('Notes are saved to the matter.');
    expect(drawer).toHaveAttribute('data-slot', 'drawer-content');
    expect(drawer).toHaveAttribute('data-vaul-drawer-direction', 'bottom');
    expect(drawer.className).toContain('z-modal');
    expect(drawer.className).toContain('bg-surface-overlay');
    expect(drawer.querySelector('[data-slot="sheet-handle"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('replaces the vaul timing with the sheet tokens', async () => {
    render(<Example />);
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
    const { className } = screen.getByRole('dialog');
    expect(className).toContain('data-[vaul-drawer]:duration-(--dur-slow)!');
    expect(className).toContain('data-[vaul-drawer]:[animation-duration:var(--dur-slow)]!');
  });
});
