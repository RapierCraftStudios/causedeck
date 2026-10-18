// Visual regression cases (#134): every story in the built Storybook's index.json, in light and
// dark, at the three layout widths. Pure so the enumeration is unit-tested without a browser.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const THEMES = ['light', 'dark'] as const;
export const WIDTHS = [360, 768, 1280] as const;
export const VIEWPORT_HEIGHT = 900;
/** Story tag that opts a story out of screenshots (genuinely non-deterministic output only). */
export const SKIP_TAG = 'skip-visual';

export type Theme = (typeof THEMES)[number];
export type Width = (typeof WIDTHS)[number];

/** The parts of Storybook's `index.json` (v5) the harness reads. */
export interface IndexEntry {
  id: string;
  title: string;
  name: string;
  type: 'story' | 'docs';
  tags?: string[];
}

export interface StoryIndex {
  v: number;
  entries: Record<string, IndexEntry>;
}

export interface VisualCase {
  id: string;
  title: string;
  name: string;
  theme: Theme;
  width: Width;
  /** Baseline path under `__screenshots__/`: `<story id>/<theme>-<width>.png`. */
  snapshot: string;
}

/** One case per story, theme and width, sorted by story id so runs and baselines are stable. */
export function visualCases(index: StoryIndex): VisualCase[] {
  return Object.values(index.entries)
    .filter((entry) => entry.type === 'story' && !(entry.tags ?? []).includes(SKIP_TAG))
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap(({ id, title, name }) =>
      THEMES.flatMap((theme) =>
        WIDTHS.map((width) => ({
          id,
          title,
          name,
          theme,
          width,
          snapshot: `${id}/${theme}-${String(width)}.png`,
        })),
      ),
    );
}

/** The story's iframe with the `theme` global from `.storybook/preview.tsx` set. */
export function storyUrl(id: string, theme: Theme): string {
  return `iframe.html?id=${encodeURIComponent(id)}&viewMode=story&globals=theme:${theme}`;
}

/** Reads `<dir>/index.json` from a `build-storybook` output directory. */
export function readIndex(dir: string): StoryIndex {
  const file = path.join(dir, 'index.json');
  if (!existsSync(file)) {
    throw new Error(
      `${file} not found: run \`pnpm --filter @causedeck/ui build-storybook\` before the visual tests.`,
    );
  }
  return JSON.parse(readFileSync(file, 'utf8')) as StoryIndex;
}
