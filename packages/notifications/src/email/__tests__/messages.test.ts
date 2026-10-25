import compile from 'icu-minify/compile';
import { describe, expect, it } from 'vitest';

import { formatMessage } from '../messages.ts';

describe('formatMessage', () => {
  const source = 'Expires in {minutes} minutes, {count, plural, one {# update} other {# updates}}.';

  it('formats an ICU source string', () => {
    expect(formatMessage(source, 'en', { minutes: 10, count: 2 })).toBe(
      'Expires in 10 minutes, 2 updates.',
    );
  });

  it('formats a message precompiled by the next-intl build (not a string)', () => {
    const compiled: unknown = compile(source);
    expect(typeof compiled).not.toBe('string');
    expect(formatMessage(compiled, 'en', { minutes: 10, count: 1 })).toBe(
      'Expires in 10 minutes, 1 update.',
    );
  });

  it('reports a missing message', () => {
    expect(formatMessage(undefined, 'en')).toBeNull();
  });
});
