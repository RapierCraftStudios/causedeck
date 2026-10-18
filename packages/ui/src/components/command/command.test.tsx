// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  DEFAULT_COMMAND_LABELS,
} from './command';

// cmdk measures and scrolls the list; jsdom implements neither.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
Element.prototype.scrollIntoView = function scrollIntoView() {};

function Palette({ onRun = vi.fn() }: { onRun?: (id: string) => void }) {
  return (
    <Command>
      <CommandInput />
      <CommandEmpty />
      <CommandList>
        <CommandItem
          value="Add hearing"
          onSelect={() => {
            onRun('hearing');
          }}
        >
          Add hearing
        </CommandItem>
        <CommandItem
          value="Add note"
          onSelect={() => {
            onRun('note');
          }}
        >
          Add note
        </CommandItem>
      </CommandList>
    </Command>
  );
}

describe('Command', () => {
  it('has English defaults routed through labels', () => {
    expect(DEFAULT_COMMAND_LABELS).toMatchObject({
      label: 'Command palette',
      placeholder: 'Type a command or search',
      empty: 'No results found.',
    });
    render(<Palette />);
    expect(screen.getByRole('combobox')).toHaveAttribute('placeholder', 'Type a command or search');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('filters as you type and runs the selected item with Enter', async () => {
    const onRun = vi.fn();
    render(<Palette onRun={onRun} />);
    await userEvent.type(screen.getByRole('combobox'), 'note');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await userEvent.keyboard('{Enter}');
    expect(onRun).toHaveBeenCalledWith('note');
  });

  it('shows the empty label, overridable per locale', async () => {
    render(
      <Command>
        <CommandInput labels={{ placeholder: 'தேடு' }} />
        <CommandEmpty labels={{ empty: 'முடிவுகள் இல்லை' }} />
        <CommandList>
          <CommandItem value="Add note">Add note</CommandItem>
        </CommandList>
      </Command>,
    );
    const input = screen.getByRole('combobox');
    expect(input).toHaveAttribute('placeholder', 'தேடு');
    await userEvent.type(input, 'zzz');
    expect(screen.getByText('முடிவுகள் இல்லை')).toBeInTheDocument();
  });

  it('opens as a titled dialog that is full screen on phones', () => {
    render(
      <CommandDialog open onOpenChange={() => undefined}>
        <CommandInput />
        <CommandList>
          <CommandItem value="Add note">Add note</CommandItem>
        </CommandList>
      </CommandDialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    expect(dialog).toHaveAccessibleDescription(DEFAULT_COMMAND_LABELS.description);
    expect(dialog).toHaveAttribute('data-slot', 'command-dialog');
    for (const cls of [
      'max-md:inset-0',
      'max-md:h-dvh',
      'max-md:max-w-none',
      'max-md:rounded-none',
    ]) {
      expect(dialog.className).toContain(cls);
    }
  });
});
