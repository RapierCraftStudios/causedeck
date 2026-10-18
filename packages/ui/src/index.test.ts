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
