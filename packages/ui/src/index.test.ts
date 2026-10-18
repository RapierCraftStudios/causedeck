import { describe, expect, it } from 'vitest';

import * as ui from './index';
import { packageName } from './index';

describe('@causedeck/ui', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@causedeck/ui');
  });

  it('exports the overlay and navigation components from the root entry', () => {
    for (const name of [
      'Accordion',
      'AlertDialog',
      'Breadcrumb',
      'Collapsible',
      'Command',
      'CommandDialog',
      'ContextMenu',
      'Dialog',
      'Drawer',
      'DropdownMenu',
      'HoverCard',
      'Menubar',
      'Pagination',
      'Popover',
      'Sheet',
      'ShortcutsDialog',
      'Tabs',
      'Tooltip',
    ]) {
      expect(ui, name).toHaveProperty(name);
    }
  });

  it('ships English label defaults for built-in strings (translated by #24)', () => {
    expect(ui.DEFAULT_DIALOG_LABELS).toEqual({ close: 'Close' });
    expect(ui.DEFAULT_SHEET_LABELS).toEqual({ close: 'Close' });
    expect(ui.DEFAULT_COMMAND_LABELS.placeholder).toBe('Type a command or search');
    expect(ui.DEFAULT_SHORTCUTS_DIALOG_LABELS.title).toBe('Keyboard shortcuts');
    expect(ui.DEFAULT_BREADCRUMB_LABELS).toEqual({ nav: 'Breadcrumb', more: 'More pages' });
    expect(ui.DEFAULT_PAGINATION_LABELS).toMatchObject({ previous: 'Previous', next: 'Next' });
  });
});
