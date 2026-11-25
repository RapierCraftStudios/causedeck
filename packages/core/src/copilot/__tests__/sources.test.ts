// The full-text query of the matter copilot's document pages (#1182): stop and question words are
// dropped and the remaining terms are OR'd as prefixes, never AND'd.
import { describe, expect, it } from 'vitest';

import { tsQueryOf } from '../sources.ts';

const BAIL =
  'What does a court weigh when granting regular bail, and what did the Supreme Court say about delay in trial?';

describe('tsQueryOf', () => {
  it('drops stop words and ORs the remaining prefix terms', () => {
    const query = tsQueryOf(BAIL);
    const terms = query?.split(' | ') ?? [];
    for (const stop of ['what:*', 'does:*', 'did:*', 'say:*', 'the:*', 'and:*'])
      expect(terms).not.toContain(stop);
    expect(terms).toEqual(
      expect.arrayContaining([
        'weigh:*',
        'granting:*',
        'regular:*',
        'bail:*',
        'delay:*',
        'trial:*',
      ]),
    );
    expect(query).not.toContain('&');
  });

  it('is null when only stop words are left', () => {
    expect(tsQueryOf('what did they say about it')).toBeNull();
  });
});
