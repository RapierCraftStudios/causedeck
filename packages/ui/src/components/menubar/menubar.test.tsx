// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarShortcut,
  MenubarTrigger,
} from './menubar';

// jsdom has no ResizeObserver; Radix popper measures with it.
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

function Example() {
  return (
    <Menubar>
      <MenubarMenu>
        <MenubarTrigger>Matter</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>
            Open matter <MenubarShortcut>Ctrl+O</MenubarShortcut>
          </MenubarItem>
          <MenubarItem variant="destructive">Archive matter</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>View</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>Compact</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
}

describe('Menubar', () => {
  it('renders a menubar of menu triggers', () => {
    render(<Example />);
    expect(screen.getByRole('menubar')).toHaveAttribute('data-slot', 'menubar');
    expect(screen.getAllByRole('menuitem').map((t) => t.textContent)).toEqual(['Matter', 'View']);
  });

  it('moves between menus with the arrow keys and opens with ArrowDown', async () => {
    render(<Example />);
    await userEvent.tab();
    expect(screen.getByRole('menuitem', { name: 'Matter' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('menuitem', { name: 'View' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}{ArrowDown}');
    const menu = screen.getByRole('menu');
    expect(menu).toHaveAttribute('data-slot', 'menubar-content');
    expect(screen.getByRole('menuitem', { name: 'Archive matter' })).toHaveAttribute(
      'data-variant',
      'destructive',
    );
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('uses the shared floating menu surface (tokens only)', async () => {
    render(<Example />);
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    const menu = screen.getByRole('menu');
    for (const cls of ['bg-surface-overlay', 'shadow-3', 'z-popover']) {
      expect(menu.className).toContain(cls);
    }
    expect(menu.className).toContain('data-[state=closed]:duration-(--dur-exit)');
  });
});
