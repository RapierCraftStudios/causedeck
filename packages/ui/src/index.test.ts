import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findStoryProblems } from '../scripts/check-stories';
import * as ui from './index';
import { packageName } from './index';

const pkg = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8'),
) as { exports: Record<string, string> };

/** Display and feedback components from #131: folder name and its main named exports. */
const DISPLAY_AND_FEEDBACK = {
  'icon-button': ['IconButton'],
  badge: ['Badge', 'badgeVariants'],
  avatar: ['Avatar'],
  separator: ['Separator'],
  skeleton: ['Skeleton', 'SkeletonGroup'],
  progress: ['Progress'],
  card: ['Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'CardFooter'],
  alert: ['Alert', 'AlertTitle', 'AlertDescription'],
  'empty-state': ['EmptyState'],
  'scroll-area': ['ScrollArea', 'ScrollBar'],
  resizable: ['ResizablePanelGroup', 'ResizablePanel', 'ResizableHandle'],
  sonner: ['Toaster', 'toast', 'MAX_VISIBLE_TOASTS'],
  chart: ['ChartContainer', 'ChartTooltip', 'ChartTooltipContent', 'ChartLegend'],
} as const;

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

  it.each(Object.entries(DISPLAY_AND_FEEDBACK))(
    'exports %s from the root and a per-component subpath',
    async (name, exports) => {
      expect(pkg.exports[`./${name}`]).toBe(`./src/components/${name}/index.ts`);
      const subpath = (await import(`./components/${name}/index.ts`)) as Record<string, unknown>;
      for (const exported of exports) {
        expect(ui).toHaveProperty(exported);
        expect(subpath[exported]).toBe((ui as Record<string, unknown>)[exported]);
      }
    },
  );

  it('ships stories, tests and the shared state stories for every component', () => {
    expect(findStoryProblems(path.join(import.meta.dirname, 'components'))).toEqual([]);
  });
});
