// Storybook coverage of the courts area (#426): every component in components/courts has a sibling
// `<name>.stories.tsx` with a default meta and at least one story, so the Storybook workflow runs
// each one with axe in light and dark. A new courts component without stories fails here.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const COURTS = path.join(import.meta.dirname, '../components/courts');

const components = readdirSync(COURTS)
  .filter((file) => file.endsWith('.tsx') && !file.endsWith('.stories.tsx'))
  .sort();

describe('courts stories', () => {
  it('finds the courts components', () => {
    expect(components.length).toBeGreaterThanOrEqual(13);
  });

  it.each(components)('%s has stories', (file) => {
    const stories = path.join(COURTS, file.replace(/\.tsx$/, '.stories.tsx'));
    expect(existsSync(stories), `missing ${path.basename(stories)}`).toBe(true);
    const source = readFileSync(stories, 'utf8');
    expect(source).toMatch(/export default meta;/);
    expect(source).toMatch(/export const [A-Z]\w*: Story/);
  });
});
