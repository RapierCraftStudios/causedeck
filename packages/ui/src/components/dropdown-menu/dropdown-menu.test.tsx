// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { menuMotion } from '../../lib/overlay';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  dropdownSheetClasses,
} from './dropdown-menu';

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

function Example({ layout = 'auto' }: { layout?: 'auto' | 'menu' | 'sheet' }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>Matter actions</DropdownMenuTrigger>
      <DropdownMenuContent layout={layout}>
        <DropdownMenuItem>Open matter</DropdownMenuItem>
        <DropdownMenuItem variant="destructive">Archive matter</DropdownMenuItem>
        <DropdownMenuCheckboxItem checked>Pinned</DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

async function open() {
  const trigger = screen.getByRole('button', { name: 'Matter actions' });
  trigger.focus();
  await userEvent.keyboard('{Enter}');
  return screen.getByRole('menu');
}

describe('DropdownMenu', () => {
  it('opens a menu of items from the keyboard', async () => {
    render(<Example />);
    const menu = await open();
    expect(menu).toHaveAttribute('data-slot', 'dropdown-menu-content');
    expect(menu).toHaveAttribute('data-layout', 'menu');
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    expect(screen.getByRole('menuitem', { name: 'Archive matter' })).toHaveAttribute(
      'data-variant',
      'destructive',
    );
    expect(screen.getByRole('menuitemcheckbox', { name: 'Pinned' })).toBeChecked();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    render(<Example />);
    await open();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Matter actions' })).toHaveFocus();
  });

  it('renders a bottom sheet list on touch widths', async () => {
    render(<Example layout="sheet" />);
    const menu = await open();
    expect(menu).toHaveAttribute('data-layout', 'sheet');
    expect(menu.className).toContain('rounded-t-xl');
    expect(menu.className).toContain('env(safe-area-inset-bottom)');
    expect(menu.className).toContain('min-h-(--hit)');
  });

  it('fades and moves 4 px in over 150 ms and out over 100 ms', () => {
    expect(menuMotion).toContain('data-[state=open]:duration-(--dur-fast)');
    expect(menuMotion).toContain('data-[state=open]:ease-enter');
    expect(menuMotion).toContain('data-[state=closed]:duration-(--dur-exit)');
    expect(menuMotion).toContain('data-[state=closed]:ease-exit');
    expect(menuMotion).toContain('slide-in-from-top-1');
    expect(dropdownSheetClasses).toContain('z-popover');
  });
});
