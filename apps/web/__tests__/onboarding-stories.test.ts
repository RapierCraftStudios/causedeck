// Storybook coverage of the onboarding wizard (#92): every client component in components/onboarding
// that renders UI is exercised by `onboarding.stories.tsx` (run with axe in light and dark by the
// Storybook workflow). A new wizard component must be added to the stories.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const DIR = path.join(import.meta.dirname, '../components/onboarding');
const stories = readFileSync(path.join(DIR, 'onboarding.stories.tsx'), 'utf8');

/** Components the stories render (the rest are hooks, helpers or composed inside these). */
const COVERED = [
  'path-chooser',
  'stepper',
  'workspace-step',
  'profile-form',
  'court-picker',
  'invite-table',
  'role-explainer',
  'delegation-form',
  'brief-format-form',
  'first-day-reveal',
  'wizard-shell',
  'preview',
];

describe('onboarding stories', () => {
  it('has a default meta and unique, prefixed story names', () => {
    expect(stories).toMatch(/export default meta;/);
    const names = [...stories.matchAll(/export const (\w+): Story/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThanOrEqual(12);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^Onboarding/);
  });

  it.each(COVERED)('renders %s', (file) => {
    expect(stories).toContain(`./${file}.tsx`);
  });

  it('never renders an async server component', () => {
    expect(stories).not.toMatch(/async function|await getTranslations/);
  });
});
