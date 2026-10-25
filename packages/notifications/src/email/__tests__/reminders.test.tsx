// Court-day reminder emails (#64): counts and a deep link only, never party names; each template
// honours its own category so a member can switch the kind off.
import { describe, expect, it } from 'vitest';

import { CATEGORIES } from '../../categories.ts';
import { isMandatoryTemplate, renderEmail, TEMPLATES } from '../render.ts';

const APP = 'https://app.causedeck.test';
const PREFS = `${APP}/settings/notifications`;

describe('reminder emails', () => {
  it('evening brief shows the counts and the open button, in plain text too', async () => {
    const email = await renderEmail(
      'evening-brief',
      {
        listings: 6,
        halls: 3,
        clashes: 1,
        lowReadiness: 2,
        obligations: 4,
        url: `${APP}/w/iyer/tomorrow`,
        preferencesUrl: PREFS,
      },
      'en',
    );
    expect(email.html).toContain(`href="${APP}/w/iyer/tomorrow"`);
    expect(email.text).toContain(`${APP}/w/iyer/tomorrow`);
    expect(email.text).toMatch(/6/);
  });

  it('maps each template to a non-mandatory reminder category', () => {
    expect(TEMPLATES['evening-brief'].category).toBe('reminder.evening');
    expect(TEMPLATES['morning-diff'].category).toBe('reminder.morning');
    expect(TEMPLATES['outcome-missing'].category).toBe('reminder.outcome_missing');
    for (const name of ['evening-brief', 'morning-diff', 'outcome-missing'] as const) {
      expect(isMandatoryTemplate(name)).toBe(false);
      const category = TEMPLATES[name].category;
      expect(category && CATEGORIES[category].mandatory).toBe(false);
    }
  });
});
