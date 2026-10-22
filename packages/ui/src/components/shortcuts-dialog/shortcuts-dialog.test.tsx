// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SHORTCUTS_DIALOG_LABELS,
  ShortcutsDialog,
  groupShortcuts,
  type Shortcut,
} from './shortcuts-dialog';

const SHORTCUTS: Shortcut[] = [
  { keys: 'mod+k', description: 'Open the command palette', group: 'General' },
  { keys: 'g then t', description: 'Go to today', group: 'Navigation' },
  { keys: 'n', description: 'Add note' },
];

describe('groupShortcuts', () => {
  it('lists ungrouped shortcuts first, then groups in first-seen order', () => {
    expect(groupShortcuts(SHORTCUTS).map(([group, items]) => [group, items.length])).toEqual([
      ['', 1],
      ['General', 1],
      ['Navigation', 1],
    ]);
  });
});

describe('ShortcutsDialog', () => {
  it('opens on ? with English default labels and closes on Escape', async () => {
    render(<ShortcutsDialog shortcuts={SHORTCUTS} mac={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.keyboard('?');
    const dialog = screen.getByRole('dialog', { name: DEFAULT_SHORTCUTS_DIALOG_LABELS.title });
    expect(dialog).toHaveAccessibleDescription(DEFAULT_SHORTCUTS_DIALOG_LABELS.description);
    expect(screen.getByText('Ctrl+K')).toBeInTheDocument();
    expect(screen.getByText('G then T')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('makes the shortcut list keyboard-scrollable (axe scrollable-region-focusable)', async () => {
    render(<ShortcutsDialog shortcuts={SHORTCUTS} mac={false} />);
    await userEvent.keyboard('?');
    const dialog = screen.getByRole('dialog', { name: DEFAULT_SHORTCUTS_DIALOG_LABELS.title });
    const list = dialog.querySelector<HTMLElement>('[data-slot="shortcuts-list"]');
    expect(list).not.toBeNull();
    expect(list).toHaveAttribute('tabindex', '0');
    expect(list).toHaveAccessibleName(DEFAULT_SHORTCUTS_DIALOG_LABELS.title);
    expect(list).toHaveClass('overflow-y-auto');
  });

  it('marks list focus with a light 1 px inset ring-token line, not a 2 px outline', async () => {
    render(<ShortcutsDialog shortcuts={SHORTCUTS} mac={false} />);
    await userEvent.keyboard('?');
    const list = screen.getByRole('region', { name: DEFAULT_SHORTCUTS_DIALOG_LABELS.title });
    expect(list).toHaveClass(
      'focus-visible:outline-ring',
      'focus-visible:outline-solid!',
      'focus-visible:outline-1!',
      'focus-visible:-outline-offset-1!',
    );
    expect(list).not.toHaveClass('focus-visible:outline-2');
  });

  it('ignores ? while typing in a field', async () => {
    render(
      <>
        <input aria-label="Note" />
        <ShortcutsDialog shortcuts={SHORTCUTS} />
      </>,
    );
    await userEvent.type(screen.getByLabelText('Note'), 'Why?');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('can be controlled with the hotkey turned off, and relabelled', async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <ShortcutsDialog
        shortcuts={SHORTCUTS}
        enableHotkey={false}
        open={false}
        onOpenChange={onOpenChange}
      />,
    );
    await userEvent.keyboard('?');
    expect(onOpenChange).not.toHaveBeenCalled();
    rerender(
      <ShortcutsDialog
        shortcuts={SHORTCUTS}
        enableHotkey={false}
        open
        onOpenChange={onOpenChange}
        mac={false}
        labels={{ title: 'விசைப்பலகை குறுக்குவழிகள்', close: 'மூடு', then: 'பின்' }}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'விசைப்பலகை குறுக்குவழிகள்' })).toBeInTheDocument();
    expect(screen.getByText('G பின் T')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'மூடு' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
