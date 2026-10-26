// Storybook coverage of the People area (#849): every component in the people `_components`
// folder has a sibling `<name>.stories.tsx` with a default meta and at least one story, so the
// Storybook workflow runs each one with axe in light and dark. The components that print client or
// matter names also carry Tamil and Kannada stories. A new People component without stories
// fails here.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const PEOPLE = path.join(import.meta.dirname, '../app/(app)/w/[slug]/people/_components');

const components = readdirSync(PEOPLE)
  .filter((file) => file.endsWith('.tsx') && !file.endsWith('.stories.tsx'))
  .sort();

/** Components that render client names, matter titles or language labels. */
const NAME_COMPONENTS = [
  'contact-card',
  'contact-form',
  'contact-list',
  'language-pref-field',
  'linked-matters',
];

describe('people stories', () => {
  it('finds the people components', () => {
    expect(components.length).toBeGreaterThanOrEqual(5);
  });

  it.each(components)('%s has stories', (file) => {
    const stories = path.join(PEOPLE, file.replace(/\.tsx$/, '.stories.tsx'));
    expect(existsSync(stories), `missing ${path.basename(stories)}`).toBe(true);
    const source = readFileSync(stories, 'utf8');
    expect(source).toMatch(/export default meta;/);
    expect(source).toMatch(/export const [A-Z]\w*: Story/);
  });

  it.each(NAME_COMPONENTS)('%s has Tamil and Kannada stories', (name) => {
    const source = readFileSync(path.join(PEOPLE, `${name}.stories.tsx`), 'utf8');
    expect(source, `${name}: Tamil story`).toMatch(/export const \w*Tamil\w*: Story/);
    expect(source, `${name}: Kannada story`).toMatch(/export const \w*Kannada\w*: Story/);
    expect(source).toMatch(/locale: 'ta'/);
    expect(source).toMatch(/locale: 'kn'/);
  });

  it('every NAME_COMPONENTS entry is a real component', () => {
    for (const name of NAME_COMPONENTS) expect(components).toContain(`${name}.tsx`);
  });
});
