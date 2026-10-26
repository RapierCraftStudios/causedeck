// Storybook coverage of the enquiry log (#875, #87 part 3): every component in the enquiries
// `_components` folder has a sibling `<name>.stories.tsx` with a default meta and at least one
// story, so the Storybook workflow runs each one with axe in light and dark. The components that
// print enquirer or matter names also carry Tamil and Kannada stories. Story export names are
// unique across every story file in apps/web.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const APP = path.join(import.meta.dirname, '..');
const ENQUIRIES = path.join(APP, 'app/(app)/w/[slug]/people/enquiries/_components');

/** An async server component cannot render in Storybook; the e2e specs cover the notice. */
const NOT_STORYBOOKABLE: Record<string, string> = {
  'gated-notice.tsx':
    'async server component (getTranslations); covered by e2e/tests/people/enquiries',
};

const components = readdirSync(ENQUIRIES)
  .filter((file) => file.endsWith('.tsx') && !file.endsWith('.stories.tsx'))
  .filter((file) => !(file in NOT_STORYBOOKABLE))
  .sort();

/** Components that render enquirer names, matter titles or translated copy for them. */
const NAME_COMPONENTS = ['conflict-panel', 'enquiry-form', 'enquiry-list', 'outcome-dialog'];

function storyFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...storyFiles(full));
    else if (entry.name.endsWith('.stories.tsx')) out.push(full);
  }
  return out;
}

describe('enquiry stories', () => {
  it('finds the enquiry components', () => {
    expect(components.length).toBeGreaterThanOrEqual(4);
  });

  it.each(components)('%s has stories', (file) => {
    const stories = path.join(ENQUIRIES, file.replace(/\.tsx$/, '.stories.tsx'));
    expect(existsSync(stories), `missing ${path.basename(stories)}`).toBe(true);
    const source = readFileSync(stories, 'utf8');
    expect(source).toMatch(/export default meta;/);
    expect(source).toMatch(/export const [A-Z]\w*: Story/);
  });

  it.each(NAME_COMPONENTS)('%s has Tamil and Kannada stories', (name) => {
    const source = readFileSync(path.join(ENQUIRIES, `${name}.stories.tsx`), 'utf8');
    expect(source, `${name}: Tamil story`).toMatch(/export const \w*Tamil\w*: Story/);
    expect(source, `${name}: Kannada story`).toMatch(/export const \w*Kannada\w*: Story/);
    expect(source).toMatch(/locale: 'ta'/);
    expect(source).toMatch(/locale: 'kn'/);
  });

  it('every NAME_COMPONENTS entry is a real component', () => {
    for (const name of NAME_COMPONENTS) expect(components).toContain(`${name}.tsx`);
  });

  it('covers the empty, loading, error, offline and denied states', () => {
    const source = readFileSync(path.join(ENQUIRIES, 'enquiry-list.stories.tsx'), 'utf8');
    for (const state of ['Empty', 'Loading', 'Error', 'Offline', 'Denied']) {
      expect(source, state).toMatch(new RegExp(`export const EnquiryList${state}: Story`));
    }
  });

  it('story export names are unique across apps/web', () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const file of storyFiles(APP)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/^export const ([A-Z]\w*): Story\b/gm)) {
        const name = match[1] ?? '';
        const first = seen.get(name);
        if (first !== undefined && first !== file) {
          duplicates.push(`${name}: ${path.relative(APP, first)} and ${path.relative(APP, file)}`);
        }
        seen.set(name, file);
      }
    }
    // Pre-existing stories in other areas reuse names such as Default and Empty; only the enquiry
    // exports must not collide with anything.
    const enquiryClashes = duplicates.filter((d) => d.includes('enquiries/_components'));
    expect(enquiryClashes).toEqual([]);
  });
});
