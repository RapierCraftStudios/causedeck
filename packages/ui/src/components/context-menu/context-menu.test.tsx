// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from './context-menu';

// Radix popper measures its content; jsdom has no ResizeObserver.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

function Example({ onSelect }: { onSelect?: () => void }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger>Cause list row</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>Matter</ContextMenuLabel>
        <ContextMenuItem onSelect={onSelect}>
          Add hearing <ContextMenuShortcut>H</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" disabled>
          Archive matter
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuCheckboxItem checked>Hearing reminders</ContextMenuCheckboxItem>
        <ContextMenuRadioGroup value="list">
          <ContextMenuRadioItem value="list">List view</ContextMenuRadioItem>
        </ContextMenuRadioGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

describe('ContextMenu', () => {
  it('opens a menu on right-click with every item kind', () => {
    render(<Example />);
    fireEvent.contextMenu(screen.getByText('Cause list row'));
    const menu = screen.getByRole('menu');
    expect(menu).toHaveAttribute('data-slot', 'context-menu-content');
    expect(screen.getByRole('menuitem', { name: /Add hearing/ })).toHaveAttribute(
      'data-slot',
      'context-menu-item',
    );
    expect(screen.getByRole('menuitemcheckbox', { name: 'Hearing reminders' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemradio', { name: 'List view' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('separator')).toHaveAttribute('data-slot', 'context-menu-separator');
  });

  it('marks destructive and disabled items', () => {
    render(<Example />);
    fireEvent.contextMenu(screen.getByText('Cause list row'));
    const archive = screen.getByRole('menuitem', { name: 'Archive matter' });
    expect(archive).toHaveAttribute('data-variant', 'destructive');
    expect(archive).toHaveAttribute('aria-disabled', 'true');
  });

  it('runs an item on Enter and closes', async () => {
    const onSelect = vi.fn();
    render(<Example onSelect={onSelect} />);
    fireEvent.contextMenu(screen.getByText('Cause list row'));
    screen.getByRole('menuitem', { name: /Add hearing/ }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
