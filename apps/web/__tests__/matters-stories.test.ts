// Storybook coverage of the matters area (#394): every component in components/matters has a sibling
// `<name>.stories.tsx` with a default meta and at least one story, so the Storybook workflow runs
// each one with axe in light and dark. A new matters component without stories fails here. The
// components that print party names, titles or people also carry Tamil and Kannada stories (Noto
// fallback and line height).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const MATTERS = path.join(import.meta.dirname, '../components/matters');

const components = readdirSync(MATTERS)
  .filter((file) => file.endsWith('.tsx') && !file.endsWith('.stories.tsx'))
  .sort();

/** Components that render party names, matter titles or people: stories in both scripts. */
const PARTY_NAME_COMPONENTS = [
  'date-conflict-card',
  'matter-card',
  'matter-header',
  'matter-overview',
  'matters-list',
  'matters-table',
  'next-date-card',
  'people-panel',
  'person-form',
  'proceeding-row',
  'proceeding-tree',
];

describe('matters stories', () => {
  it('finds the matters components', () => {
    expect(components.length).toBeGreaterThanOrEqual(24);
  });

  it.each(components)('%s has stories', (file) => {
    const stories = path.join(MATTERS, file.replace(/\.tsx$/, '.stories.tsx'));
    expect(existsSync(stories), `missing ${path.basename(stories)}`).toBe(true);
    const source = readFileSync(stories, 'utf8');
    expect(source).toMatch(/export default meta;/);
    expect(source).toMatch(/export const [A-Z]\w*: Story/);
  });

  it.each(PARTY_NAME_COMPONENTS)('%s has Tamil and Kannada stories', (name) => {
    const source = readFileSync(path.join(MATTERS, `${name}.stories.tsx`), 'utf8');
    expect(source, `${name}: Tamil story`).toMatch(/export const \w*Tamil\w*: Story/);
    expect(source, `${name}: Kannada story`).toMatch(/export const \w*Kannada\w*: Story/);
    expect(source).toMatch(/locale: 'ta'/);
    expect(source).toMatch(/locale: 'kn'/);
  });
});
