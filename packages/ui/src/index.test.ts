import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findPatternStoryProblems, findStoryProblems } from '../scripts/check-stories';
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

/** Data and date components from #133: folder name and its main named exports. */
const DATA_AND_DATES = {
  table: ['Table', 'TableHeader', 'TableBody', 'TableRow', 'TableHead', 'TableCell'],
  'data-table': ['DataTable', 'createDataTableColumnHelper', 'DEFAULT_DATA_TABLE_LABELS'],
  calendar: ['Calendar', 'DEFAULT_CALENDAR_LABELS', 'IST_TIME_ZONE'],
  'date-picker': [
    'DatePicker',
    'parseDateInput',
    'formatDisplayDate',
    'DEFAULT_DATE_PICKER_LABELS',
  ],
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

  it('exports the form controls from the root', () => {
    for (const name of [
      'Input',
      'Textarea',
      'Label',
      'Field',
      'useFieldControl',
      'Select',
      'SelectTrigger',
      'Combobox',
      'Checkbox',
      'RadioGroup',
      'Switch',
      'Slider',
      'Toggle',
      'ToggleGroup',
      'Form',
      'FormField',
      'useZodForm',
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

  it.each(Object.entries(DATA_AND_DATES))(
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

  it('ships the data-state copy from #8 as English label defaults', () => {
    expect(ui.DEFAULT_DATA_TABLE_LABELS).toMatchObject({
      offline: 'You are offline. Showing saved data.',
      denied: 'You do not have access to this. Ask the workspace owner.',
      retry: 'Try again',
    });
    expect(ui.DEFAULT_DATE_PICKER_LABELS.placeholder).toBe('dd/mm/yyyy');
  });

  it('ships stories, tests and the shared state stories for every component', () => {
    expect(findStoryProblems(path.join(import.meta.dirname, 'components'))).toEqual([]);
  });

  it('exports the trust patterns from the root and the ./patterns subpath', async () => {
    expect(pkg.exports['./patterns']).toBe('./src/patterns/index.ts');
    const patterns = (await import('./patterns')) as Record<string, unknown>;
    for (const name of [
      'ProvenanceChip',
      'ProvenancePopoverBody',
      'LevelBadge',
      'LevelLegend',
      'LEVEL_META',
      'LEVELS',
      'StageBadge',
      'STAGE_MAP',
      'PROCEEDING_STAGES',
      'LISTING_STAGES',
      'ProposalCard',
      'ProposalCardGroup',
      'useProposalShortcuts',
      'ActivityItem',
      'UndoButton',
      'undoWindow',
      'ObligationRow',
      'CourtItemChip',
      'MemoryCard',
      'MEMORY_SCOPES',
      'MEMORY_SCOPE_META',
    ]) {
      expect(ui, name).toHaveProperty(name);
      expect(patterns[name]).toBe((ui as Record<string, unknown>)[name]);
    }
  });

  it('ships stories and tests for every pattern', () => {
    expect(findPatternStoryProblems(path.join(import.meta.dirname, 'patterns'))).toEqual([]);
  });
});
